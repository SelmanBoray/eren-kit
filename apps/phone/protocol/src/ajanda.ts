import { z } from "zod";
import {
  ajandaMetni,
  ajandaSatiri,
  AjandaZamani,
  type Hatirlatma,
  Hatirlatmalar,
  Tarih,
  Tekrar,
  zamanKurallari,
} from "./ajanda-zaman.ts";
import { cozumle } from "./cozumle.ts";
import { HataKodu } from "./hatalar.ts";
import { kanonikJson, sha256Hex, utf8Bayt } from "./kanonik.ts";
import { AJANDA_AZAMI_CERCEVE, AJANDA_SINIRLARI, AJANDA_SURUMU, SINIRLAR } from "./sinirlar.ts";
import { EslestirmeKodu, EslestirmeQr, SohbetId } from "./sohbet.ts";
import { AcikAnahtar, Imza, type ImzaRolu, type Kanal, Nonce, OpakId, ZamanMs } from "./temel.ts";

/**
 * Ajanda: `/ajanda` kanalı, kayıt modeli, eşleştirme kapsamı. Kararlar ve akış `docs/AJANDA.md`'de;
 * araç ve boru şemaları `ajanda-arac.ts`'te, modele giden metin `ajanda-metin.ts`'te.
 */

export const AjandaSurum = z.literal(AJANDA_SURUMU);

/** `/ajanda` mesaj kurucusu: `v` = `AJANDA_SURUMU`, bilinmeyen alan hata. */
export function ajandaMesaj<T extends string, S extends z.ZodRawShape>(type: T, alanlar: S) {
  return z.strictObject({ v: AjandaSurum, type: z.literal(type), ...alanlar });
}

// Kapsam

/**
 * Eşleşmiş cihazın kapsamı. Telefon beyan etmez: PC'deki eşleştirme komutu açtığı pencereye yazar,
 * eşleşen cihaz kaydına geçer. Kapsam alanı olmayan eski cihaz kaydı `ESKI_CIHAZ_KAPSAMI`'dır.
 */
export const CIHAZ_KAPSAMLARI = ["sohbet", "ajanda"] as const;
export const CihazKapsami = z.enum(CIHAZ_KAPSAMLARI);
export type CihazKapsami = z.infer<typeof CihazKapsami>;
export const ESKI_CIHAZ_KAPSAMI: CihazKapsami = "sohbet";

/** Bütün WebSocket yolları. `Kanal` (`eren-auth-v1` imza metni) bilerek genişletilmez. */
export const CIHAZ_KANALLARI = ["sohbet", "cihaz", "ajanda"] as const;
export type CihazKanali = Kanal | "ajanda";

/** Kapsam başına açılabilen yollar. Kesişmez: ajanda cihazı `/sohbet`'i, eski cihaz `/ajanda`'yı açamaz. */
export const KAPSAM_KANALLARI = {
  sohbet: ["sohbet", "cihaz"],
  ajanda: ["ajanda"],
} as const satisfies Record<CihazKapsami, readonly CihazKanali[]>;

/** Kapsamın eşleştirmesinin yapıldığı yol: pencerenin kapsamı bu değilse `eslestirme_kapali`. */
export const KAPSAM_ESLESTIRME_KANALI = {
  sohbet: "sohbet",
  ajanda: "ajanda",
} as const satisfies Record<CihazKapsami, CihazKanali>;

/** `hello` anında taze okunan cihaz kaydının kapsamı bu yolu açabiliyor mu. Değilse `kanal_desteklenmiyor`. */
export function kanalKapsamdaMi(kapsam: CihazKapsami, kanal: string): boolean {
  return (KAPSAM_KANALLARI[kapsam] as readonly string[]).includes(kanal);
}

export const AJANDA_IMZA_ONEKI = `eren-ajanda-auth-v${AJANDA_SURUMU}`;

/**
 * `/ajanda` karşılıklı sınamasında imzalanan metin (UTF-8 baytları, ECDSA P-256 + SHA-256, DER).
 * Önek `eren-auth-v1` değildir ve kanal ile kapsam satırları metne girer: ajanda imzası `/sohbet`
 * ya da `/cihaz` imzası olarak kullanılamaz, tersi de. Alanlar satır sonu içeremez (şema).
 */
export function ajandaKimlikImzaMetni(girdi: {
  rol: ImzaRolu;
  device_id: string;
  client_nonce: string;
  server_nonce: string;
}): string {
  return [
    AJANDA_IMZA_ONEKI,
    girdi.rol,
    "kanal:ajanda",
    "kapsam:ajanda",
    girdi.device_id,
    girdi.client_nonce,
    girdi.server_nonce,
  ].join("\n");
}

/**
 * Ajanda eşleştirme QR'ı. `EslestirmeQr` alanları + `kanal:"ajanda"`: eski uygulama bu QR'ı (fazla
 * alan) reddeder, ajanda uygulaması eski QR'ı (`kanal` yok) reddeder.
 */
export const AjandaEslestirmeQr = z.strictObject({
  ...EslestirmeQr.shape,
  v: AjandaSurum,
  kanal: z.literal("ajanda"),
});
export type AjandaEslestirmeQr = z.infer<typeof AjandaEslestirmeQr>;

// Hata ve ret

/** `/ajanda` `error` ve `pair_result.code` kümesi: `HATA_KODLARI`'nın altkümesi, yeni kod yok. */
export const AJANDA_KANAL_HATALARI = [
  "protokol_uyumsuz",
  "gecersiz_mesaj",
  "mesaj_cok_buyuk",
  "zaman_asimi",
  "ic_hata",
  "yetkisiz",
  "imza_gecersiz",
  "ip_uyusmuyor",
  "cihaz_bilinmiyor",
  "kanal_desteklenmiyor",
  "eslestirme_kapali",
  "eslestirme_kodu_gecersiz",
] as const;
export const AjandaKanalHatasi = HataKodu.extract(AJANDA_KANAL_HATALARI);
export type AjandaKanalHatasi = z.infer<typeof AjandaKanalHatasi>;

/**
 * Bir işlemin (telefon `islem`i ya da araç çağrısı) kapalı ret listesi. `HATA_KODLARI`'na girmez:
 * `/sohbet` ve v1 kümeleri değişmesin.
 * - `kayit_bulunamadi`: kimlik yok. `kayit_silinmis`: mezar taşına `geri_yukle` dışında işlem.
 * - `kimlik_cakisiyor`: `ekle`'nin `kayit_id`'si başka işlemle zaten kullanılmış.
 * - `tutarsiz_kayit`: değişiklik uygulanınca kayıt `AjandaKaydi` kurallarını bozuyor.
 * - `saat_dilimi_bilinmiyor`: biçimi doğru ama servisin dilim veritabanında yok.
 * - `ornek_gecersiz`: `ornek_tarihi` tekrarsız kayıtta ya da serinin örneği değil; ya da `ORNEK_ADET` doldu.
 * - `kayit_siniri`: `KAYIT_ADET` doldu.
 * - `sentetik_turda_izinsiz`: insan kökenli olmayan turdan taslak olmayan kayda değişiklik.
 */
export const AJANDA_RET_NEDENLERI = [
  "kayit_bulunamadi",
  "kayit_silinmis",
  "kimlik_cakisiyor",
  "tutarsiz_kayit",
  "saat_dilimi_bilinmiyor",
  "ornek_gecersiz",
  "kayit_siniri",
  "sentetik_turda_izinsiz",
  "ic_hata",
] as const;
export const AjandaRetNedeni = z.enum(AJANDA_RET_NEDENLERI);
export type AjandaRetNedeni = z.infer<typeof AjandaRetNedeni>;

// Kayıt

export const KAYIT_TURLERI = ["gorev", "randevu", "not"] as const;
export const KayitTuru = z.enum(KAYIT_TURLERI);
export type KayitTuru = z.infer<typeof KayitTuru>;

/** Kaydın (tekrar ediyorsa serinin) durumu. Hatırlatma yalnız `acik`'ta kurulur. */
export const KAYIT_DURUMLARI = ["acik", "tamam", "iptal"] as const;
export const KayitDurumu = z.enum(KAYIT_DURUMLARI);
export type KayitDurumu = z.infer<typeof KayitDurumu>;

/** Tekrar eden kaydın bir örneğinin `acik` dışındaki durumu (açık örnek satır taşımaz). */
export const ORNEK_DURUMLARI = ["tamam", "iptal"] as const;
export const OrnekDurumu = z.enum(ORNEK_DURUMLARI);

/**
 * Kaydın doğduğu (ya da değişikliğin geldiği) yol. İlk dilimde üreten: `sohbet_araci` (telefondaki
 * sohbetin ana oturumu) ve `elle` (ajanda uygulaması). Sonraki dilimlerin yolları şimdiden listededir.
 */
export const KAYNAK_YOLLARI = ["sohbet_araci", "pc_araci", "arka_plan", "sesli_not", "elle"] as const;
export const KaynakYolu = z.enum(KAYNAK_YOLLARI);
export type KaynakYolu = z.infer<typeof KaynakYolu>;

/** İnsan elinden (uygulama) gelen yollar; geri kalanı otomasyondur (alan izi bunu kullanır). */
export const INSAN_YOLLARI = ["elle", "sesli_not"] as const satisfies readonly KaynakYolu[];

export function otomasyonMu(yol: KaynakYolu): boolean {
  return !(INSAN_YOLLARI as readonly string[]).includes(yol);
}

/**
 * Turun kökeni: `insan` yalnız doğrulanmış `/sohbet` insan mesajının başlattığı turda ya da insan
 * yolunda; servis belirler, araç girdisinde yoktur.
 */
export const TUR_KOKENLERI = ["insan", "sentetik"] as const;
export const TurKokeni = z.enum(TUR_KOKENLERI);
export type TurKokeni = z.infer<typeof TurKokeni>;

/** Alan izi ve değişikliklerin alan kümesi, sırası kanoniktir. */
export const AJANDA_ALANLARI = ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar", "tekrar", "durum"] as const;
export const AjandaAlani = z.enum(AJANDA_ALANLARI);
export type AjandaAlani = z.infer<typeof AjandaAlani>;

const AlanListesi = z
  .array(AjandaAlani)
  .max(AJANDA_ALANLARI.length)
  .refine((l) => l.every((a, i) => i === 0 || AJANDA_ALANLARI.indexOf(l[i - 1]!) < AJANDA_ALANLARI.indexOf(a)), {
    message: "alanlar kanonik sırada ve tekil",
  });

export const KayitId = OpakId;
/** Servisin ajanda deposunun kimliği; depo yeniden kurulunca değişir. */
export const DepoId = OpakId;
/** PC'nin verdiği tek artan revizyon. Her değişiklik tam bir kaydın revizyonunu artırır. */
export const Revizyon = z.number().int().min(1);
export const SonRevizyon = z.number().int().min(0);

export const TekilAnahtar = z
  .string()
  .min(1)
  .max(AJANDA_SINIRLARI.TEKIL_ANAHTAR)
  .regex(/^[A-Za-z0-9:._-]+$/);

export const AjandaBaslik = ajandaSatiri(1, AJANDA_SINIRLARI.BASLIK);
export const AjandaAciklama = ajandaMetni(AJANDA_SINIRLARI.ACIKLAMA);
export const AjandaAlinti = ajandaSatiri(1, AJANDA_SINIRLARI.ALINTI);

/**
 * Kaydın kaynak izi. Kayıt doğarken servis yazar, sonra değişmez. Hiçbir alanı eylem değildir.
 * - `elle`, `sesli_not`: `device_id` zorunlu, `tur_kokeni` `insan`, sohbet alanları yok.
 * - `sohbet_araci`: `sohbet_id` zorunlu; `kaynak_msg_id` turu başlatan insan mesajı (sentetik turda yok).
 * - `arka_plan`: `sohbet_id` ya da `oturum_id`. `pc_araci`: `oturum_id` zorunlu.
 * - `alinti`: kaydı doğuran insan sözünden kısa parça; servis yalnız turun insan mesajında birebir
 *   geçiyorsa saklar.
 */
export const AjandaKaynagi = z
  .strictObject({
    yol: KaynakYolu,
    tur_kokeni: TurKokeni,
    sohbet_id: SohbetId.optional(),
    oturum_id: OpakId.optional(),
    kaynak_msg_id: OpakId.optional(),
    device_id: OpakId.optional(),
    alinti: AjandaAlinti.optional(),
    tekil_anahtar: TekilAnahtar.optional(),
  })
  .superRefine((k, ctx) => {
    const hata = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const insanYolu = !otomasyonMu(k.yol);
    if (insanYolu) {
      if (k.device_id === undefined) hata("device_id", "insan yolunda device_id zorunlu");
      if (k.tur_kokeni !== "insan") hata("tur_kokeni", "insan yolu insan kökenlidir");
      if (k.sohbet_id !== undefined || k.oturum_id !== undefined || k.kaynak_msg_id !== undefined) {
        hata("yol", "insan yolunda sohbet ve oturum alanı yok");
      }
    } else if (k.device_id !== undefined) {
      hata("device_id", "device_id yalnız insan yolunda");
    }
    if (k.yol === "sohbet_araci" && k.sohbet_id === undefined) hata("sohbet_id", "sohbet_araci sohbet_id ister");
    if (k.yol === "pc_araci" && k.oturum_id === undefined) hata("oturum_id", "pc_araci oturum_id ister");
    if (k.yol === "arka_plan" && k.sohbet_id === undefined && k.oturum_id === undefined) {
      hata("yol", "arka_plan sohbet_id ya da oturum_id ister");
    }
    if (k.kaynak_msg_id !== undefined && k.tur_kokeni !== "insan") hata("kaynak_msg_id", "kaynak_msg_id yalnız insan turunda");
  });
export type AjandaKaynagi = z.infer<typeof AjandaKaynagi>;

/** Bir değişikliği yapan: kaynak izinin değişiklik başına hali (geçmişte). */
export const AjandaYazar = z.strictObject({
  yol: KaynakYolu,
  tur_kokeni: TurKokeni,
  device_id: OpakId.optional(),
  sohbet_id: SohbetId.optional(),
  oturum_id: OpakId.optional(),
});
export type AjandaYazar = z.infer<typeof AjandaYazar>;

export const AjandaOrnegi = z.strictObject({ tarih: Tarih, durum: OrnekDurumu });

const GOVDE_ALANLARI = {
  tur: KayitTuru,
  baslik: AjandaBaslik,
  aciklama: AjandaAciklama.optional(),
  zaman: AjandaZamani.optional(),
  hatirlatmalar: Hatirlatmalar,
  tekrar: Tekrar.optional(),
};

/**
 * Kaydın PC'deki güncel hali; `/ajanda` `kayit` çerçevesi bunu taşır. Eylemsiz veridir: URL, intent,
 * komut alanı yoktur; metinler düz metin gösterilir. Kurallar: `zamanKurallari`; `ornekler` yalnız
 * tekrarda, tarih sırasıyla tekil ve çapadan sonra; `elle_alanlar` kanonik sırada.
 * - `taslak`: insan kökenli olmayan turda doğdu; kullanıcı `onayla`yana kadar hatırlatma kurulmaz.
 * - `silindi`: mezar taşı; içerik `geri_yukle` için durur, hatırlatma kurulmaz.
 * - `elle_alanlar`: kullanıcının uygulamadan değiştirdiği alanlar; otomasyon bunları değiştiremez.
 */
export const AjandaKaydi = z
  .strictObject({
    kayit_id: KayitId,
    revizyon: Revizyon,
    ...GOVDE_ALANLARI,
    ornekler: z.array(AjandaOrnegi).max(AJANDA_SINIRLARI.ORNEK_ADET),
    durum: KayitDurumu,
    taslak: z.boolean(),
    silindi: z.boolean(),
    elle_alanlar: AlanListesi,
    kaynak: AjandaKaynagi,
    olusturma_ms: ZamanMs,
    guncelleme_ms: ZamanMs,
  })
  .superRefine((k, ctx) => {
    zamanKurallari(k, ctx);
    if (k.ornekler.length > 0) {
      if (k.tekrar === undefined) {
        ctx.addIssue({ code: "custom", path: ["ornekler"], message: "ornekler yalnız tekrar eden kayıtta" });
      } else if (!k.ornekler.every((o, i) => i === 0 || k.ornekler[i - 1]!.tarih < o.tarih)) {
        ctx.addIssue({ code: "custom", path: ["ornekler"], message: "ornekler tarih sırasıyla ve tekil" });
      } else if (k.zaman !== undefined && "tarih" in k.zaman && k.ornekler[0]!.tarih < k.zaman.tarih) {
        ctx.addIssue({ code: "custom", path: ["ornekler"], message: "örnek çapadan önce" });
      }
    }
    if (k.guncelleme_ms < k.olusturma_ms) {
      ctx.addIssue({ code: "custom", path: ["guncelleme_ms"], message: "güncelleme oluşturmadan önce" });
    }
  });
export type AjandaKaydi = z.infer<typeof AjandaKaydi>;

/** Telefon hatırlatmayı yalnız buna göre kurar (örnek başına `ornekler` durumu ayrıca atlanır). */
export function hatirlatmaEtkinMi(kayit: Pick<AjandaKaydi, "taslak" | "silindi" | "durum">): boolean {
  return !kayit.taslak && !kayit.silindi && kayit.durum === "acik";
}

// İşlemler (telefon -> PC)

/**
 * Kısmi değişiklik. Verilmeyen alan değişmez; `null` alanı kaldırır. Durum ayrı işlemdir (`durum`).
 * Kurallar birleşmiş kayıt üzerinde servis tarafından denetlenir (`tutarsiz_kayit`).
 */
export const AjandaDegisiklik = z
  .strictObject({
    tur: KayitTuru.optional(),
    baslik: AjandaBaslik.optional(),
    aciklama: AjandaAciklama.nullable().optional(),
    zaman: AjandaZamani.nullable().optional(),
    hatirlatmalar: Hatirlatmalar.optional(),
    tekrar: Tekrar.nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: "boş değişiklik" });
export type AjandaDegisiklik = z.infer<typeof AjandaDegisiklik>;

/** Uygulamanın yolladığı işlemler. Hepsi idempotenttir (`islem_id`); her başarılı değişiklik bir revizyon. */
export const AjandaIslem = z.discriminatedUnion("islem", [
  /** Kimliği uygulama üretir (çevrimdışı kuyrukta bekleyebilsin). */
  z
    .strictObject({
      islem: z.literal("ekle"),
      kayit_id: KayitId,
      ...GOVDE_ALANLARI,
      girdi_yolu: z.enum(INSAN_YOLLARI),
    })
    .superRefine(zamanKurallari),
  /** `temel_revizyon`: kullanıcının düzenlediği hal. Reddetmez (varış sırası kazanır), geçmişe yazılır. */
  z.strictObject({
    islem: z.literal("guncelle"),
    kayit_id: KayitId,
    temel_revizyon: Revizyon,
    degisiklik: AjandaDegisiklik,
  }),
  /** `ornek_tarihi` verilirse yalnız o örnek (`acik` örnek satırını kaldırır); yoksa kaydın kendisi. */
  z.strictObject({
    islem: z.literal("durum"),
    kayit_id: KayitId,
    durum: KayitDurumu,
    ornek_tarihi: Tarih.optional(),
  }),
  /** Taslağı kesinleştirir: hatırlatmalar bundan sonra kurulur. */
  z.strictObject({ islem: z.literal("onayla"), kayit_id: KayitId }),
  /** Yumuşak silme. */
  z.strictObject({ islem: z.literal("sil"), kayit_id: KayitId }),
  z.strictObject({ islem: z.literal("geri_yukle"), kayit_id: KayitId }),
]);
export type AjandaIslem = z.infer<typeof AjandaIslem>;

export const AJANDA_ISLEMLERI = ["ekle", "guncelle", "durum", "onayla", "sil", "geri_yukle"] as const;

// Geçmiş

/** Değişikliğin öncesi ya da sonrası: yalnız değişen alanlar. `null`: alan yoktu / kaldırıldı. */
export const AjandaParca = z.strictObject({
  tur: KayitTuru.optional(),
  baslik: AjandaBaslik.optional(),
  aciklama: AjandaAciklama.nullable().optional(),
  zaman: AjandaZamani.nullable().optional(),
  hatirlatmalar: Hatirlatmalar.optional(),
  tekrar: Tekrar.nullable().optional(),
  durum: KayitDurumu.optional(),
  taslak: z.boolean().optional(),
  silindi: z.boolean().optional(),
  /** Yalnız `ornek_tarihi`'li girdide: o örneğin durumu, `null` açık. */
  ornek_durumu: OrnekDurumu.nullable().optional(),
});
export type AjandaParca = z.infer<typeof AjandaParca>;

export const AjandaGecmisGirdisi = z.strictObject({
  rev: Revizyon,
  ts_ms: ZamanMs,
  islem: z.enum(AJANDA_ISLEMLERI),
  yazar: AjandaYazar,
  /** `guncelle`'de kullanıcının düzenlediği hal. */
  temel_revizyon: Revizyon.optional(),
  /** Otomasyonun değiştiremediği alanlar. */
  korunan_alanlar: AlanListesi.optional(),
  ornek_tarihi: Tarih.optional(),
  onceki: AjandaParca,
  sonraki: AjandaParca,
});
export type AjandaGecmisGirdisi = z.infer<typeof AjandaGecmisGirdisi>;

// Yukarı: ajanda uygulaması -> PC

/** Kapsam alanı yoktur: kapsamı PC'deki eşleştirme penceresi belirler. */
export const AjandaPairRequest = ajandaMesaj("pair_request", {
  kod: EslestirmeKodu,
  public_key: AcikAnahtar,
  platform: z.literal("android"),
  /** Yalnız listede ayırt etmek için. Güvenilmez etiket, hiçbir karara girmez. */
  etiket: z.string().max(SINIRLAR.CIHAZ_ETIKETI).optional(),
});
/**
 * `son_rev`: uygulamanın uyguladığı en büyük revizyon. `depo_id`: en son `welcome`'daki; yoksa ya da
 * değiştiyse servis `tam` telafi yapar.
 */
export const AjandaHello = ajandaMesaj("hello", {
  device_id: OpakId,
  son_rev: SonRevizyon,
  depo_id: DepoId.optional(),
  client_nonce: Nonce,
});
export const AjandaAuthResponse = ajandaMesaj("auth_response", { signature: Imza });
/** Kimlik sonrası. Aynı `islem_id` yeniden gelirse aynı `islem_sonucu` döner, ikinci kez uygulanmaz. */
export const AjandaIslemMesaji = ajandaMesaj("islem", { islem_id: OpakId, islem: AjandaIslem });
/** Bir kaydın geçmişi, en yeniden geriye sayfa sayfa. `once_rev`: bu revizyondan küçükler. */
export const AjandaGecmisIste = ajandaMesaj("gecmis_iste", {
  istek_id: OpakId,
  kayit_id: KayitId,
  once_rev: Revizyon.optional(),
});

export const AjandaYukari = z.discriminatedUnion("type", [
  AjandaPairRequest,
  AjandaHello,
  AjandaAuthResponse,
  AjandaIslemMesaji,
  AjandaGecmisIste,
]);
export type AjandaYukari = z.infer<typeof AjandaYukari>;

// Aşağı: PC -> ajanda uygulaması

export const AjandaPairResult = ajandaMesaj("pair_result", {
  ok: z.boolean(),
  device_id: OpakId.optional(),
  server_public_key: AcikAnahtar.optional(),
  kapsam: z.literal("ajanda").optional(),
  code: AjandaKanalHatasi.optional(),
}).refine(
  (s) =>
    s.ok
      ? s.device_id !== undefined && s.server_public_key !== undefined && s.kapsam !== undefined && s.code === undefined
      : s.code !== undefined && s.device_id === undefined && s.server_public_key === undefined && s.kapsam === undefined,
  { message: "ok ile alanlar uyuşmuyor" },
);
/** `server_signature` = `ajandaKimlikImzaMetni({ rol: "pc", ... })` imzası. */
export const AjandaAuthChallenge = ajandaMesaj("auth_challenge", { server_nonce: Nonce, server_signature: Imza });
/**
 * `tam`: uygulama yerel kopyasını atar, ardından 0'dan bütün kayıtlar gelir (`depo_id` yok ya da
 * farklı, ya da `son_rev > bas_rev`). Değilse `son_rev`'ten büyük revizyonlu kayıtlar gelir.
 */
export const AjandaWelcome = ajandaMesaj("welcome", {
  depo_id: DepoId,
  bas_rev: SonRevizyon,
  tam: z.boolean(),
  server_time_ms: ZamanMs,
});
/** Bir kaydın güncel hali. Telafide ve canlıda revizyon kesin artan sırayla gelir. */
export const AjandaKayitMesaji = ajandaMesaj("kayit", { kayit: AjandaKaydi });
/** Telafi bitti; `rev` o anki `bas_rev`. Sonrası canlıdır. */
export const AjandaEsitlendi = ajandaMesaj("esitlendi", { rev: SonRevizyon });
/**
 * `islem`'in sonucu. `ok` ve `rev`: değişikliğin revizyonu; yan etkisiz `ok`'ta (aynı değer, zaten
 * silinmiş) `rev` yok. `korunan_alanlar` yalnız otomasyon yolunda dolabilir, uygulamaya hep boş/yok.
 * `ok:false` yeniden yollanmaz; uygulama iyimser değişikliğini geri alır.
 */
export const AjandaIslemSonucu = ajandaMesaj("islem_sonucu", {
  islem_id: OpakId,
  ok: z.boolean(),
  kayit_id: KayitId.optional(),
  rev: Revizyon.optional(),
  korunan_alanlar: AlanListesi.optional(),
  code: AjandaRetNedeni.optional(),
}).refine((s) => (s.ok ? s.code === undefined : s.code !== undefined && s.rev === undefined), {
  message: "ok, rev ve code tutarsız",
});
export const AjandaGecmis = ajandaMesaj("gecmis", {
  istek_id: OpakId,
  kayit_id: KayitId,
  girdiler: z
    .array(AjandaGecmisGirdisi)
    .max(AJANDA_SINIRLARI.GECMIS_SAYFA)
    .refine((l) => l.every((g, i) => i === 0 || l[i - 1]!.rev > g.rev), { message: "rev kesin azalan olmalı" }),
  devami: z.boolean(),
  code: AjandaRetNedeni.optional(),
}).refine((s) => s.code === undefined || (s.girdiler.length === 0 && !s.devami), {
  message: "code ile girdi olmaz",
});
export const AjandaErrorMesaji = ajandaMesaj("error", {
  code: AjandaKanalHatasi,
  detail: z.string().max(SINIRLAR.HATA_DETAYI).optional(),
});

export const AjandaAsagi = z.discriminatedUnion("type", [
  AjandaPairResult,
  AjandaAuthChallenge,
  AjandaWelcome,
  AjandaKayitMesaji,
  AjandaEsitlendi,
  AjandaIslemSonucu,
  AjandaGecmis,
  AjandaErrorMesaji,
]);
export type AjandaAsagi = z.infer<typeof AjandaAsagi>;

/** `/ajanda` çözücüleri: tek sürüm `AJANDA_SURUMU`, sınır `AJANDA_AZAMI_CERCEVE.KANAL`. */
export const ajandaYukariCoz = (ham: string) => cozumle(AjandaYukari, ham, AJANDA_AZAMI_CERCEVE.KANAL, AJANDA_SURUMU);
export const ajandaAsagiCoz = (ham: string) => cozumle(AjandaAsagi, ham, AJANDA_AZAMI_CERCEVE.KANAL, AJANDA_SURUMU);

// Saf yardımcılar (servis ve uygulama aynı sonucu versin)

/** `ajandaDegisikligiUygula` girdisi: kablo `AjandaDegisiklik`'i ve araç değişikliğinin ortak üst kümesi. */
export type AjandaAlanDegisikligi = {
  tur?: KayitTuru | undefined;
  baslik?: string | undefined;
  aciklama?: string | null | undefined;
  zaman?: AjandaZamani | null | undefined;
  hatirlatmalar?: Hatirlatma[] | undefined;
  tekrar?: Tekrar | null | undefined;
  durum?: KayitDurumu | undefined;
};

export type AjandaBirlesimi = {
  /** Yeni hal; `revizyon`, `guncelleme_ms` çağıranındır. Şemadan geçirilmemiştir. */
  kayit: AjandaKaydi;
  uygulanan: AjandaAlani[];
  korunan: AjandaAlani[];
};

/**
 * Alan düzeyinde birleştirme. Değeri aynı olan alan atlanır. `otomasyon` iken `elle_alanlar`'daki
 * alan değişmez, `korunan`'a girer; insan yolunda uygulanan alanlar `elle_alanlar`'a eklenir. Silinmiş
 * kayıt, sentetik tur ve revizyon kararları çağıranındır; sonuç `AjandaKaydi` ile doğrulanmalıdır.
 */
export function ajandaDegisikligiUygula(
  kayit: AjandaKaydi,
  degisiklik: AjandaAlanDegisikligi,
  otomasyon: boolean,
): AjandaBirlesimi {
  const yeni: Record<string, unknown> = { ...kayit };
  const uygulanan: AjandaAlani[] = [];
  const korunan: AjandaAlani[] = [];
  for (const alan of AJANDA_ALANLARI) {
    const deger = degisiklik[alan];
    if (deger === undefined) continue;
    const simdiki = kayit[alan];
    const ayni = deger === null ? simdiki === undefined : simdiki !== undefined && kanonikJson(deger) === kanonikJson(simdiki);
    if (ayni) continue;
    if (otomasyon && kayit.elle_alanlar.includes(alan)) {
      korunan.push(alan);
      continue;
    }
    if (deger === null) delete yeni[alan];
    else yeni[alan] = deger;
    uygulanan.push(alan);
  }
  const elle_alanlar = otomasyon
    ? [...kayit.elle_alanlar]
    : AJANDA_ALANLARI.filter((a) => kayit.elle_alanlar.includes(a) || uygulanan.includes(a));
  return { kayit: { ...(yeni as AjandaKaydi), elle_alanlar }, uygulanan, korunan };
}

/**
 * Otomatik eklemenin tekilleştirme anahtarı: aynı kapsamda (ör. `sohbet:<id>`) aynı tür, başlık ve
 * zaman aynı anahtarı verir. `"t1:" + sha256(kanonik JSON)`. Servis silinmemiş eşini bulursa eklemez.
 */
export function ajandaTekilAnahtari(girdi: {
  kapsam: string;
  tur: KayitTuru;
  baslik: string;
  zaman?: AjandaZamani | undefined;
}): string {
  const govde = { kapsam: girdi.kapsam, tur: girdi.tur, baslik: girdi.baslik, zaman: girdi.zaman ?? null };
  return "t1:" + sha256Hex(utf8Bayt(kanonikJson(govde)));
}
