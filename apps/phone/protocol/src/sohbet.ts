import { z } from "zod";
import { HataKodu, HataKoduV1 } from "./hatalar.ts";
import { IsProfili, Plan } from "./plan.ts";
import { IsRaporu } from "./rapor.ts";
import { PROTOKOL_SURUMU, SINIRLAR, SOHBET_SINIRLARI, SOHBET_SURUMU } from "./sinirlar.ts";
import {
  AcikAnahtar,
  Imza,
  IsBitisDurumu,
  IsId,
  IsTuru,
  mesaj,
  Nonce,
  OpakId,
  PaketAdi,
  PlanHash,
  planSatiri,
  SeqNo,
  sohbetMesaj,
  Surum,
  ZamanMs,
} from "./temel.ts";

/**
 * `/sohbet`'te v1'de (`PROTOKOL_SURUMU`) kalan türler: Kotlin eşleştirme ekranı `pair_request`'i
 * kurar, `pair_result`'u `v == 1` ile doğrular (EslestirmeActivity.kt). Geri kalan her `/sohbet`
 * mesajı `SOHBET_SURUMU` taşır. QR içeriği (`EslestirmeQr`) de v1'dir, çerçeve değildir.
 */
export const SOHBET_V1_TURLERI = ["pair_request", "pair_result"] as const;

/** `/sohbet` çerçevesinin `type`'ına göre beklenen `v`. Çözücü ve giden çerçeve kurucuları kullanır. */
export function sohbetSurumu(type: unknown): typeof PROTOKOL_SURUMU | typeof SOHBET_SURUMU {
  return type === "pair_request" || type === "pair_result" ? PROTOKOL_SURUMU : SOHBET_SURUMU;
}

/**
 * Varsayılan sohbetin kimliği. Dilim 2'den önceki bütün geçmiş ona aittir; `sohbet_id` taşımayan
 * her kayıt (eski olay, küresel olay, eski outbox öğesi) bu sohbete sayılır. Silinemez, yalnız temizlenir.
 */
export const ANA_SOHBET_ID = "ana" as const;
/**
 * `ana`'nın ilk adı. Servis göçü `ana`'yı bu adla ekler ve `ana` için `chat_created` olayı yoktur:
 * telefon, `ana` için `chat_renamed` görmediyse bu adı gösterir. Yeniden adlandırılabilir.
 */
export const ANA_SOHBET_ADI = "Claude";
/**
 * Kullanıcı ad vermeden açılan sohbetin adı. Kablo boş ad taşımaz: telefon `chat_create.ad`'a bunu
 * koyar. Telefonun ilk mesajdan otomatik adlandırması (`chat_rename`) yalnız adı hâlâ bu olan sohbete yapılır.
 */
export const VARSAYILAN_SOHBET_ADI = "Yeni sohbet";

/**
 * Bir kaydın (olay, mesaj, depo satırı) sohbet anahtarı: `sohbet_id ?? "ana"`. v3'te sohbete bağlı
 * her olay ve mesaj `sohbet_id` taşır; alanı olmayan (eski ya da küresel) kayıt `"ana"` sayılır.
 * Okuyan kod sohbet anahtarını elle değil yalnız bununla okur.
 */
export function sohbetAnahtari(kayit: object): string {
  const id = (kayit as { sohbet_id?: unknown }).sohbet_id;
  return typeof id === "string" ? id : ANA_SOHBET_ID;
}

/**
 * Sohbet kimliği (v3): opak, telefon üretir (`ana` hariç), servis yalnız saklar. Böylece `chat_create`
 * çevrimdışıyken outbox'ta bekleyebilir; aynı kimlik ikinci kez gelirse servis yeni sohbet açmaz.
 */
export const SohbetId = OpakId;
export type SohbetId = z.infer<typeof SohbetId>;

/**
 * Sohbet adı (v3). Kullanıcı metnidir: günlüğe ve Telegram'a girmez. Tek satır (`planSatiri`: satır
 * sonu, sekme, görünmez ve yön karakteri, bozuk vekil yok), en çok `SOHBET_SINIRLARI.SOHBET_ADI`
 * UTF-16 birimi, boş olamaz, başında ve sonunda boşluk yok (yalnız boşluktan da oluşamaz). Telefon
 * yollamadan önce kırpar, boşsa `VARSAYILAN_SOHBET_ADI` koyar.
 *
 * Uzunluk `.length` ile ayrıca denetlenir: zod 4.6 `max`'ı kod noktası sayar (emoji 1), sınır ise
 * telefonun `maxLength`'i gibi UTF-16 birimidir (emoji 2).
 */
export const SohbetAdi = planSatiri(1, SOHBET_SINIRLARI.SOHBET_ADI)
  .refine((s) => s.length <= SOHBET_SINIRLARI.SOHBET_ADI, { message: "çok uzun (UTF-16 birimi)" })
  .refine((s) => s.trim() === s, { message: "baştaki ya da sondaki boşluk" });
export type SohbetAdi = z.infer<typeof SohbetAdi>;

/** `server_status.sohbetler[].eren`'in ilk dört değeri: süreci olan (ya da açılmaya çalışılan) ana oturum. */
export const EREN_DURUMLARI = ["baslatiliyor", "hazir", "tur_suruyor", "kapali"] as const;
export const ErenDurumu = z.enum(EREN_DURUMLARI);
export type ErenDurumu = z.infer<typeof ErenDurumu>;

/**
 * Sohbet başına ana oturum durumu (v3). `uyuyor`: süreç yok, servis kararı (henüz açılmadı ya da boşta
 * kapatıldı); mesaj gelince `--resume` ile açılır. `sirada`: süreç gerekiyor ama canlı ana oturum sınırı
 * ya da RAM kapısı yüzünden bekliyor; mesajlar kuyrukta. `kapali`: kilit, başlangıç reddi ya da
 * çökme sonrası bekleme (dilim 1 anlamı).
 */
export const SOHBET_EREN_DURUMLARI = [...EREN_DURUMLARI, "uyuyor", "sirada"] as const;
export const SohbetErenDurumu = z.enum(SOHBET_EREN_DURUMLARI);
export type SohbetErenDurumu = z.infer<typeof SohbetErenDurumu>;

export const GIRDI_YOLLARI = ["yazi", "dikte", "kisayol"] as const;
export const GirdiYolu = z.enum(GIRDI_YOLLARI);
export type GirdiYolu = z.infer<typeof GirdiYolu>;

/**
 * Kısayol bağlamı (v4): kullanıcının kısayolu kullandığı an baktığı uygulama. Yalnız `input === "kisayol"`
 * iken izinlidir (`yalnizKisayolda`). `paket` Android paket adı deseni (en çok `PAKET_ADI`); `ad` 1-80
 * UTF-16 birimi, C0/C1 kontrol karakteri yok.
 */
export const KisayolBaglami = z.strictObject({
  paket: PaketAdi,
  ad: z
    .string()
    .min(1)
    .max(SOHBET_SINIRLARI.BAGLAM_ADI)
    .refine((s) => s.length <= SOHBET_SINIRLARI.BAGLAM_ADI, { message: "çok uzun (UTF-16 birimi)" })
    .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s), { message: "kontrol karakteri" }),
});
export type KisayolBaglami = z.infer<typeof KisayolBaglami>;

const BAGLAM_KURALI = { message: "baglam yalnız input kisayol iken geçerli", path: ["baglam"] };
function yalnizKisayolda(s: { input: string; baglam?: unknown }): boolean {
  return s.baglam === undefined || s.input === "kisayol";
}

const EslestirmeKodu = z
  .string()
  .min(SINIRLAR.ESLESTIRME_KODU_MIN)
  .max(SINIRLAR.ESLESTIRME_KODU_MAX)
  .regex(/^[A-Z0-9]+$/);

function tailscaleAdresiMi(adres: string): boolean {
  const eslesme = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(adres);
  if (eslesme === null) return false;
  const ikinci = Number(eslesme[1]);
  return ikinci >= 64 && ikinci <= 127 && Number(eslesme[2]) <= 255 && Number(eslesme[3]) <= 255;
}

/** QR kodun içeriği. Adres yalnız Tailscale aralığından (100.64.0.0/10) olabilir. */
export const EslestirmeQr = z.strictObject({
  v: Surum,
  host: z.string().max(15).refine(tailscaleAdresiMi, "Tailscale adresi değil"),
  port: z.number().int().min(1).max(65535),
  kod: EslestirmeKodu,
  server_public_key: AcikAnahtar,
});
export type EslestirmeQr = z.infer<typeof EslestirmeQr>;

// Yukarı: telefon -> bilgisayar

export const Hello = sohbetMesaj("hello", {
  device_id: OpakId,
  last_seq: SeqNo,
  client_nonce: Nonce,
});
/** v1: Kotlin kurar. */
export const PairRequest = mesaj("pair_request", {
  kod: EslestirmeKodu,
  public_key: AcikAnahtar,
  platform: z.enum(["android", "ipad"]),
  /** Yalnız listede ayırt etmek için. Güvenilmez etiket, hiçbir karara girmez. */
  etiket: z.string().max(SINIRLAR.CIHAZ_ETIKETI).optional(),
});
/** `/sohbet` kimlik yanıtı (`SOHBET_SURUMU`). `/cihaz`'ınki ayrıdır: `CihazAuthResponse` (v1). */
export const AuthResponse = sohbetMesaj("auth_response", { signature: Imza });
/** v3: `sohbet_id` zorunlu. v4: `input:"kisayol"` ile isteğe bağlı `baglam`. Sohbet yoksa ya da silinmişse `ack{ok:false, code:"sohbet_bulunamadi"}`. */
export const UserMessage = sohbetMesaj("user_message", {
  client_msg_id: OpakId,
  sohbet_id: SohbetId,
  input: GirdiYolu,
  text: z.string().min(1).max(SINIRLAR.KULLANICI_METNI),
  baglam: KisayolBaglami.optional(),
}).refine(yalnizKisayolda, BAGLAM_KURALI);
/** v3: `sohbet_id` zorunlu; yalnız o sohbetin ana oturumu kesilir. */
export const Interrupt = sohbetMesaj("interrupt", {
  client_msg_id: OpakId,
  sohbet_id: SohbetId,
  /** Verilirse yalnız bu tur kesilir; outbox'tan geç gelen kesme yeni turu öldüremez. */
  turn_id: OpakId.optional(),
});
export const PlanDecision = sohbetMesaj("plan_decision", {
  client_msg_id: OpakId,
  plan_id: OpakId,
  plan_hash: PlanHash,
  karar: z.enum(["onay", "ret"]),
});
export const QuestionAnswer = sohbetMesaj("question_answer", {
  client_msg_id: OpakId,
  soru_id: OpakId,
  cevap: z.string().min(1).max(SINIRLAR.CEVAP_METNI),
});
export const JobCancel = sohbetMesaj("job_cancel", { client_msg_id: OpakId, is_id: IsId });
/**
 * Sohbetin geçmişini sil (v2'de geldi, v3'te `sohbet_id` zorunlu). Yalnız kimliği bitmiş bağlantıdan
 * işlenir; telefon yalnız bağlıyken yollar, kopunca yeniden yollamaz. `client_msg_id` ile tekrarsızdır.
 * O sohbette ana oturum turu, devir, çalışan iş ya da bekleyen soru varsa `ack{ok:false, code:"sohbet_mesgul"}`;
 * sohbet yoksa ya da silinmişse `sohbet_bulunamadi`. Başarıda `ack.seq` o sohbetin mezar taşının
 * (`chat_cleared{sohbet_id}`) numarasıdır. Başka sohbetlere dokunulmaz.
 */
export const ChatClear = sohbetMesaj("chat_clear", { client_msg_id: OpakId, sohbet_id: SohbetId });
/**
 * Yeni sohbet (v3). Kimliği telefon üretir: çevrimdışıyken outbox'ta bekleyebilir, o sohbetin ilk
 * `user_message`'ından önce aynı kuyruğa girer. Servis kimliğe göre idempotenttir: kimlik silinmemiş
 * bir sohbetinse (`ana` dahil) yan etkisiz `ok` (yeni olay yok, `ack.seq` yok, ad değişmez); silinmiş
 * bir sohbetinse `sohbet_bulunamadi` (kimlik yeniden kullanılmaz). Silinmemiş sohbet sayısı
 * `SOHBET_SINIRLARI.SOHBET_ADET` ise `sohbet_siniri`. ana oturum süreci hemen açılmaz, ilk mesajda açılır.
 * Başarıda `ack.seq` `chat_created` olayının numarasıdır.
 */
export const ChatCreate = sohbetMesaj("chat_create", {
  client_msg_id: OpakId,
  sohbet_id: SohbetId,
  ad: SohbetAdi,
});
/**
 * Sohbeti yeniden adlandır (v3). `ana` da adlandırılabilir. Outbox'ta bekleyebilir. Sohbet yoksa ya da
 * silinmişse `sohbet_bulunamadi`. Ad aynıysa yan etkisiz `ok` (olay yok, `ack.seq` yok); değiştiyse
 * `ack.seq` `chat_renamed`'in numarasıdır.
 */
export const ChatRename = sohbetMesaj("chat_rename", {
  client_msg_id: OpakId,
  sohbet_id: SohbetId,
  ad: SohbetAdi,
});
/**
 * Sohbeti sil (v3). `ana` için `sohbet_silinemez`; yoksa ya da zaten silinmişse `sohbet_bulunamadi`;
 * o sohbette tur, devir, çalışan iş ya da bekleyen soru varsa `sohbet_mesgul`. Başarıda servis tek
 * işlemde o sohbetin `SILINMEZ_OLAY_TURLERI` dışındaki bütün olaylarını siler, bekleyen planlarını
 * iptal eder ve `chat_deleted` yazar (ayrıca `chat_cleared` yazılmaz); sonra ana oturum sürecini kapatır ve
 * transkriptlerini siler. İş kayıtları kalır. `ack.seq` `chat_deleted`'in numarasıdır. Telefon
 * `chat_clear` gibi yalnız bağlıyken yollar (iki adım onaydan sonra), kopunca yeniden yollamaz.
 */
export const ChatDelete = sohbetMesaj("chat_delete", { client_msg_id: OpakId, sohbet_id: SohbetId });

/**
 * Tüketim isteği: telefon token tüketimini ister. `client_msg_id` taşımaz, `ack` almaz, outbox'a girmez.
 * Yanıt `usage_report`, `istek_id` ile eşleşir.
 */
export const UsageRequest = sohbetMesaj("usage_request", { istek_id: OpakId });

export const SohbetYukari = z.discriminatedUnion("type", [
  Hello,
  PairRequest,
  AuthResponse,
  UserMessage,
  Interrupt,
  PlanDecision,
  QuestionAnswer,
  JobCancel,
  ChatClear,
  ChatCreate,
  ChatRename,
  ChatDelete,
  UsageRequest,
]);
export type SohbetYukari = z.infer<typeof SohbetYukari>;

// Kalıcı olaylar: `events` tablosunun satırları

/**
 * Olay zarfı: `seq`, `ts_ms`, `type` ve (v3) isteğe bağlı `sohbet_id`. Sohbete bağlı her olay (konuşma,
 * plan, iş, soru, devir, mezar taşı, sohbetin ana oturumunun notu) servisçe `sohbet_id` ile yazılır, `ana`
 * dahil. Alanı olmayan olay küreseldir (kilit, RAM, servis yeniden başladı, uzlaştırma, ADB notları)
 * ya da v3'ten eskidir; ikisi de `sohbetAnahtari` ile `ana` sayılır. Yaşam döngüsü olaylarında
 * (`chat_created`, `chat_renamed`, `chat_deleted`) alan zorunludur.
 *
 * Tip: `{ ...zarf, ...alanlar }` genel `S` ile `typeof zarf & S` kesişimi çıkarır; `alanlar` zarfın
 * bir alanını (`sohbet_id`) ezince iki şema kesişir ve `z.infer` alanı `undefined`'a çökertir.
 * Çalışma anında ezen `alanlar`'dır; tip de bunu söylesin diye çakışan zarf alanları `Omit` ile düşülür.
 */
function olay<T extends string, S extends z.ZodRawShape>(type: T, alanlar: S) {
  const zarf = {
    seq: z.number().int().min(1),
    ts_ms: ZamanMs,
    type: z.literal(type),
    sohbet_id: SohbetId.optional(),
  };
  return z.strictObject({ ...zarf, ...alanlar } as Omit<typeof zarf, keyof S> & S);
}

export const OLAY_TURLERI = [
  "user_echo",
  "assistant_message",
  "turn_aborted",
  "plan_proposed",
  "plan_resolved",
  "job_started",
  "job_finished",
  "question_asked",
  "question_resolved",
  "eren_handover",
  "system_notice",
  "chat_cleared",
  "chat_created",
  "chat_renamed",
  "chat_deleted",
] as const;

/**
 * Servisin geçmiş silmesinde (`chat_clear`, `chat_delete`) hiç silinmeyen olay türleri: mezar taşları
 * ve sohbet yaşam döngüsü olayları. Telefon sohbet listesini bunlardan kurar; ayrı liste isteği yoktur.
 * Telefon kendi günlüğünde o sohbetin eski mezar taşlarını siler (tek not kalır) ama yaşam döngüsü
 * olaylarını tutar. Depo bu listeyi okur, türleri elle yazmaz.
 */
export const SILINMEZ_OLAY_TURLERI = ["chat_cleared", "chat_created", "chat_renamed", "chat_deleted"] as const;

/** Sohbet yaşam döngüsü olayları (v3): telefon bunlardan görünüm öğesi değil sohbet listesi kurar. */
export const SOHBET_YASAM_OLAYLARI = ["chat_created", "chat_renamed", "chat_deleted"] as const;

export const Olay = z.discriminatedUnion("type", [
  olay("user_echo", {
    client_msg_id: OpakId,
    input: GirdiYolu,
    text: z.string().max(SINIRLAR.KULLANICI_METNI),
    baglam: KisayolBaglami.optional(),
  }).refine(yalnizKisayolda, BAGLAM_KURALI),
  olay("assistant_message", {
    turn_id: OpakId,
    text: z.string().max(SINIRLAR.ASISTAN_METNI),
  }),
  olay("turn_aborted", {
    turn_id: OpakId,
    neden: z.enum(["kullanici_kesti", "surec_oldu", "limit_kilit", "hata"]),
    /** Telefonda görünmüş yarım metin. */
    kismi_metin: z.string().max(SINIRLAR.ASISTAN_METNI).optional(),
  }),
  olay("plan_proposed", { plan: Plan, plan_hash: PlanHash }),
  olay("plan_resolved", {
    plan_id: OpakId,
    plan_hash: PlanHash,
    sonuc: z.enum(["onaylandi", "reddedildi", "iptal"]),
    is_id: IsId.optional(),
  }),
  olay("job_started", {
    is_id: IsId,
    plan_id: OpakId,
    plan_hash: PlanHash,
    baslik: z.string().max(SINIRLAR.PLAN_BASLIK),
    tur: IsTuru,
    /**
     * Yalnız `tur:"pc"` işte yazılır; telefon işinde ve bu alandan önceki kayıtlarda yoktur. İş
     * kartında gösterilir. Plan özetine girmez: onay ekranı göstermez, telefon doğrulamaz.
     */
    profil: IsProfili.optional(),
  }),
  olay("job_finished", {
    is_id: IsId,
    durum: IsBitisDurumu,
    /** Telefon işinin raporu her zaman kirlidir. */
    kirli: z.boolean(),
    rapor: IsRaporu.optional(),
  }),
  olay("question_asked", {
    soru_id: OpakId,
    is_id: IsId,
    soru: z.string().min(1).max(SINIRLAR.SORU_METNI),
    secenekler: z
      .array(z.string().max(SINIRLAR.SECENEK_METNI))
      .max(SINIRLAR.SECENEK_ADET)
      .optional(),
  }),
  olay("question_resolved", {
    soru_id: OpakId,
    is_id: IsId,
    sonuc: z.enum(["cevaplandi", "zaman_asimi", "iptal"]),
    cevap: z.string().max(SINIRLAR.CEVAP_METNI).optional(),
  }),
  olay("eren_handover", {
    nesil: z.number().int().min(1),
    /** Yanlışsa devir yalnız veritabanı bilgisiyle yapılmıştır. */
    ozet_kabul: z.boolean(),
  }),
  olay("system_notice", {
    seviye: z.enum(["bilgi", "uyari", "kritik"]),
    kod: z.enum([
      "ram_dusuk",
      "limit_kilit_aktif",
      "limit_kilit_bitti",
      "eren_yeniden_basladi",
      "servis_yeniden_basladi",
      "is_uzlastirildi",
      "diger",
    ]),
    metin: z.string().max(SINIRLAR.SISTEM_NOTU),
  }),
  /**
   * Mezar taşı: bir sohbetin geçmişi silindi. O sohbetin (`sohbetAnahtari`; alansız eski mezar taşı
   * `ana`'nındır) `seq <= sinir_seq` olan ve `SILINMEZ_OLAY_TURLERI` dışındaki bütün olayları
   * servisten silinmiştir; telefon da kendi günlüğünden siler, yerine tek "Geçmiş silindi" notu koyar.
   * Başka sohbetlerin olaylarına dokunulmaz. `sinir_seq`, silmeyle aynı işlemde silmeden hemen önce
   * okunan küresel `head_seq`'tir: silinen en büyük `seq`'e eşit ya da ondan büyüktür. Mezar taşı hiç
   * silinmez ve yazıldığı an en yeni olaydır, yani her zaman `sinir_seq < seq`. Bu bağ depoda
   * kurulur: depo olayı `seq` yer tutucusuyla doğruladığı için şemada denetlenmez.
   */
  olay("chat_cleared", { sinir_seq: SeqNo }),
  /**
   * Yaşam döngüsü (v3): sohbet açıldı. `sohbet_id` zorunlu. `ana` için yazılmaz (göçle vardır). Hiç
   * silinmez; telefon sohbet listesini bu olaylardan kurar.
   */
  olay("chat_created", { sohbet_id: SohbetId, ad: SohbetAdi }),
  /** Yaşam döngüsü (v3): sohbetin adı değişti; en yeni `chat_renamed` geçerlidir. Hiç silinmez. */
  olay("chat_renamed", { sohbet_id: SohbetId, ad: SohbetAdi }),
  /**
   * Yaşam döngüsü (v3): sohbet silindi. O sohbetin `SILINMEZ_OLAY_TURLERI` dışındaki bütün olayları
   * aynı işlemde servisten silinmiştir; telefon da siler ve sohbeti listeden kaldırır. Kimlik bir daha
   * kullanılmaz. `ana` için yazılmaz. Hiç silinmez.
   */
  olay("chat_deleted", { sohbet_id: SohbetId }),
]);
export type Olay = z.infer<typeof Olay>;

// Aşağı: bilgisayar -> telefon

/** `/sohbet` sınaması (`SOHBET_SURUMU`). `/cihaz`'ınki ayrıdır: `CihazAuthChallenge` (v1). */
export const AuthChallenge = sohbetMesaj("auth_challenge", {
  server_nonce: Nonce,
  /** Bilgisayarın `kimlikImzaMetni({ rol: "pc", ... })` imzası. */
  server_signature: Imza,
});
export const Welcome = sohbetMesaj("welcome", { head_seq: SeqNo, server_time_ms: ZamanMs });
/** v1: Kotlin `v == 1` ve alan kümesiyle doğrular. Kod kümesi de v1'dir. */
export const PairResult = mesaj("pair_result", {
  ok: z.boolean(),
  device_id: OpakId.optional(),
  server_public_key: AcikAnahtar.optional(),
  code: HataKoduV1.optional(),
}).refine(
  (s) =>
    s.ok
      ? s.device_id !== undefined && s.server_public_key !== undefined && s.code === undefined
      : s.code !== undefined && s.device_id === undefined && s.server_public_key === undefined,
  { message: "ok ile alanlar uyuşmuyor" },
);
export const Ack = sohbetMesaj("ack", {
  client_msg_id: OpakId,
  ok: z.boolean(),
  /**
   * Yazılan olayın numarası: `user_message` → `user_echo`, `chat_clear` → `chat_cleared`,
   * `chat_create` → `chat_created`, `chat_rename` → `chat_renamed`, `chat_delete` → `chat_deleted`.
   * Yan etkisiz `ok`'ta (zaten var olan sohbet, aynı ad) yoktur.
   */
  seq: z.number().int().min(1).optional(),
  code: HataKodu.optional(),
}).refine((s) => (s.ok ? s.code === undefined : s.code !== undefined), {
  message: "ok ile code uyuşmuyor",
});
/** v3: `sohbet_id` zorunlu; tur o sohbetindir. */
export const AssistantDelta = sohbetMesaj("assistant_delta", {
  sohbet_id: SohbetId,
  turn_id: OpakId,
  /** Bu parçanın turun metnindeki başlangıcı, UTF-16 birimi. */
  offset: z.number().int().min(0),
  text: z.string().max(SINIRLAR.DELTA_METNI),
});
/** v3: `sohbet_id` zorunlu. Telafide her canlı tur (sohbet başına en çok bir) için bir tane gelir. */
export const StreamSnapshot = sohbetMesaj("stream_snapshot", {
  sohbet_id: SohbetId,
  turn_id: OpakId,
  /** Turun şu ana kadarki metni. Sonraki `assistant_delta.offset` bu metnin üzerine oturur. */
  text: z.string().max(SINIRLAR.ASISTAN_METNI),
});

/**
 * Asistanın o anki etkinliği (`assistant_activity.etkinlik`). Kapalı liste: yeni değer eklemek yeni bir
 * yetenek jetonu gerektirir (`SOHBET_YETENEKLERI`), çünkü jetonu olmayan telefon bilinmeyen değeri reddeder.
 */
export const AKIS_ETKINLIKLERI = [
  "dusunuyor",
  "yaziyor",
  "komut",
  "dosya_okuma",
  "dosya_yazma",
  "web",
  "plan",
  "is_bilgisi",
  "ekran",
  "arac",
] as const;
export const AkisEtkinligi = z.enum(AKIS_ETKINLIKLERI);
export type AkisEtkinligi = z.infer<typeof AkisEtkinligi>;

/**
 * `/sohbet` WebSocket adresindeki yetenek sorgusu: `?yetenek=etkinlik1`. Değer virgülle ayrılmış jeton
 * listesidir. Sürüm artmaz: jetonu istemeyen bağlantıya ilgili çerçeve hiç gönderilmez.
 */
export const SOHBET_YETENEK_PARAMETRESI = "yetenek";
export const SOHBET_YETENEKLERI = { ETKINLIK: "etkinlik1" } as const;

/**
 * Tur sürerken asistanın ne yaptığı (kalıcı değil). Yalnız `yetenek=etkinlik1` isteyen bağlantıya gider.
 * `gecen_ms`: etkinliğin başlangıcından beri geçen süre (en çok 24 saat).
 */
export const AssistantActivity = sohbetMesaj("assistant_activity", {
  sohbet_id: SohbetId,
  turn_id: OpakId,
  etkinlik: AkisEtkinligi,
  gecen_ms: z.number().int().min(0).max(86_400_000),
  /**
   * Bu turu başlatan insan mesajının `client_msg_id`'si (`user_message`/`user_echo` ile aynı şema).
   * Tur insan mesajıyla başlamadıysa (servis/sentetik tur) alan hiç yoktur; `null` geçersizdir.
   */
  kaynak_msg_id: OpakId.optional(),
});
export type AssistantActivity = z.infer<typeof AssistantActivity>;

/**
 * Görünür bir tur hangi nedenle olursa olsun kapandı (etkinlik göstergesi kapanır). `AssistantActivity`
 * ile aynı yetenek jetonuna (`etkinlik1`) bağlıdır, yalnız canlı gönderilir, telafide yeniden oynatılmaz.
 * Aynı turun bitiş olayına (`assistant_message` / `turn_aborted`) göre sırası garanti edilmez.
 */
export const AssistantActivityEnd = sohbetMesaj("assistant_activity_end", {
  sohbet_id: SohbetId,
  turn_id: OpakId,
});
export type AssistantActivityEnd = z.infer<typeof AssistantActivityEnd>;
export const EventMesaji = sohbetMesaj("event", { event: Olay });

/** Kurulumdaki sürüm adı: kısa `sha` ya da `--kirli` kurulumda `<sha>-k<zaman>` (kur.ts `SHA_DESENI`). */
const ServisSurumu = z
  .string()
  .min(1)
  .max(SOHBET_SINIRLARI.SERVIS_SURUMU)
  .regex(/^[0-9A-Za-z][0-9A-Za-z-]*$/);

export const ServisBilgisi = z.strictObject({
  /** Çalışan sürümün `surum.json` `sha`'sı. Geliştirme kopyasından çalışıyorsa `null`. */
  surum: ServisSurumu.nullable(),
  /** Servis sürecinin başladığı an, epoch ms. */
  baslangic_ms: ZamanMs,
});
export type ServisBilgisi = z.infer<typeof ServisBilgisi>;

/** `server_status.sohbetler`'in öğesi (v3). */
export const SohbetDurumu = z.strictObject({
  sohbet_id: SohbetId,
  eren: SohbetErenDurumu,
});
export type SohbetDurumu = z.infer<typeof SohbetDurumu>;

/**
 * Silinmemiş her sohbetin (`ana` dahil, sırası anlamsız) ana oturum durumu: en çok `SOHBET_ADET` öğe,
 * kimlikler tekil, `ana` her zaman vardır. Sohbet adları burada yoktur: olaylardan gelir.
 */
export const SohbetDurumlari = z
  .array(SohbetDurumu)
  .min(1)
  .max(SOHBET_SINIRLARI.SOHBET_ADET)
  .refine((l) => new Set(l.map((s) => s.sohbet_id)).size === l.length, { message: "yinelenen sohbet_id" })
  .refine((l) => l.some((s) => s.sohbet_id === ANA_SOHBET_ID), { message: "ana yok" });

/** v3: `eren` kalktı, yerine `sohbetler`. Geri kalan alanlar küreseldir. */
export const ServerStatus = sohbetMesaj("server_status", {
  sohbetler: SohbetDurumlari,
  kilitli: z.boolean(),
  aktif_is: z.number().int().min(0),
  ram_bos_mb: z.number().int().min(0),
  ram_toplam_mb: z.number().int().min(0),
  ram_dusuk: z.boolean(),
  /** Durum ekranında gösterilir. Servis hep yazar. */
  servis: ServisBilgisi,
  limit: z
    .strictObject({
      bes_saat: z.number().min(0).max(1).optional(),
      bes_saat_sifirlanma_ms: z.number().int().min(0).optional(),
      haftalik: z.number().min(0).max(1).optional(),
      haftalik_sifirlanma_ms: z.number().int().min(0).optional(),
    })
    .optional(),
});
/** `/sohbet` hatası (`SOHBET_SURUMU`). `/cihaz`'ınki ayrıdır: `CihazErrorMesaji` (v1, v1 kod kümesi). */
export const ErrorMesaji = sohbetMesaj("error", {
  code: HataKodu,
  detail: z.string().max(SINIRLAR.HATA_DETAYI).optional(),
});

/** Negatif olmayan güvenli tam sayı sayaç (token, sonuç adedi). */
export const Sayac = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export type Sayac = z.infer<typeof Sayac>;

/** Bir kapsamın tüketim toplamı. `maliyet_usd` yalnız en az bir satırda maliyet varsa yazılır. */
export const TuketimToplami = z.strictObject({
  girdi: Sayac,
  cache_yazma: Sayac,
  cache_okuma: Sayac,
  cikti: Sayac,
  sonuc_adet: Sayac,
  maliyet_usd: z.number().min(0).max(1e7).optional(),
});
export type TuketimToplami = z.infer<typeof TuketimToplami>;

/** Aynı kapsamın iki dökümü: ana oturum (sohbet) ve iş. */
export const TuketimIkilisi = z.strictObject({
  sohbet: TuketimToplami,
  is: TuketimToplami,
});
export type TuketimIkilisi = z.infer<typeof TuketimIkilisi>;

/**
 * Tüketim raporu: `usage_request`'in yanıtı (`istek_id` ile eşleşir). `sohbetler`: silinmemiş, satırı olan sohbetlerin tüm zaman toplamı
 * (işleri ayrık dahil); kimlikler tekil. `isler`: en çok `TUKETIM_IS_ADET` öğe, `is_id` kesin azalan
 * (tekilliği de içerir).
 */
export const UsageReport = sohbetMesaj("usage_report", {
  istek_id: OpakId,
  olcum_ms: ZamanMs,
  gun_baslangic_ms: ZamanMs,
  bugun: TuketimIkilisi,
  son_7_gun: TuketimIkilisi,
  sohbetler: z
    .array(z.strictObject({ sohbet_id: SohbetId, toplam: TuketimIkilisi }))
    .max(SOHBET_SINIRLARI.SOHBET_ADET)
    .refine((l) => new Set(l.map((s) => s.sohbet_id)).size === l.length, { message: "yinelenen sohbet_id" }),
  silinmis_sohbetler: TuketimIkilisi.optional(),
  isler: z
    .array(z.strictObject({ is_id: IsId, toplam: TuketimToplami }))
    .max(SOHBET_SINIRLARI.TUKETIM_IS_ADET)
    .refine((l) => l.every((s, i) => i === 0 || l[i - 1]!.is_id > s.is_id), {
      message: "is_id kesin azalan olmalı (tekil)",
    }),
});
export type UsageReport = z.infer<typeof UsageReport>;

export const SohbetAsagi = z.discriminatedUnion("type", [
  AuthChallenge,
  Welcome,
  PairResult,
  Ack,
  AssistantDelta,
  StreamSnapshot,
  AssistantActivity,
  AssistantActivityEnd,
  EventMesaji,
  ServerStatus,
  ErrorMesaji,
  UsageReport,
]);
export type SohbetAsagi = z.infer<typeof SohbetAsagi>;
