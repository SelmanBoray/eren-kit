import { z } from "zod";
import { HataKodu } from "./hatalar.ts";
import { MEDYA_SINIRLARI } from "./sinirlar.ts";
import { OpakId, sohbetMesaj } from "./temel.ts";

/**
 * Medya eki (fotoğraf, video): yetenek jetonu `medya1` (`SOHBET_YETENEKLERI.MEDYA`). Sürüm artmaz
 * (`SOHBET_SURUMU` aynı): bu dosyadaki çerçeveler ve `user_message`/`user_echo`'nun `ekler` alanı
 * yalnız `?yetenek=...,medya1` isteyen bağlantıda yaşar. Jetonsuz bağlantıdan gelen `media_*` çerçevesi
 * bağlantıyı `yetkisiz` ile kapatır, `ekler`'li `user_message` `ack{ok:false, code:"gecersiz_mesaj"}`
 * alır; jetonsuz bağlantıya `media_state` hiç gitmez, `user_echo` `olayiYetenegeGoreYansit` ile gider.
 *
 * Kablo yalnız tür, boyut ve kimlik taşır: dosya yolu, dosya adı ve içerik özeti yoktur. Telefonun
 * beyanı (`mime`, `sure_ms`, `genislik`, `yukseklik`) hiçbir karara tek başına girmez; PC koklar ve
 * `ffprobe` ile yeniden ölçer.
 *
 * Bu dosya `sohbet.ts`'i içe aktarmaz (döngü olmasın): `sohbet_id` alanları `OpakId`'dir, `SohbetId`
 * ile aynı şema.
 */

/**
 * Ek kimliği: opak, telefon üretir (`m-<donem>-<sayac>`), servis yalnız saklar. Servis kayıtları
 * `(device_id, medya_id)` ile tutar: başka cihazın eki adlandırılamaz.
 */
export const MedyaId = OpakId;
export type MedyaId = z.infer<typeof MedyaId>;

export const MEDYA_TURLERI = ["foto", "video"] as const;
export const MedyaTuru = z.enum(MEDYA_TURLERI);
export type MedyaTuru = z.infer<typeof MedyaTuru>;

/** Tür başına kapalı mime listesi. `tur` ile `mime` ailesi uyuşmalıdır (`mimeTuru`). */
export const MEDYA_MIME = {
  foto: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  video: ["video/mp4", "video/quicktime", "video/3gpp", "video/webm"],
} as const;
export const MEDYA_MIMELERI = [...MEDYA_MIME.foto, ...MEDYA_MIME.video] as const;
export const MedyaMime = z.enum(MEDYA_MIMELERI);
export type MedyaMime = z.infer<typeof MedyaMime>;

/** `mime`'ın ait olduğu tür; listede yoksa `undefined`. Hiç atmaz. */
export function mimeTuru(mime: unknown): MedyaTuru | undefined {
  if ((MEDYA_MIME.foto as readonly unknown[]).includes(mime)) return "foto";
  if ((MEDYA_MIME.video as readonly unknown[]).includes(mime)) return "video";
  return undefined;
}

/** Türün dosya bayt sınırı (`FOTO_BAYT` ya da `VIDEO_BAYT`). */
export function turBaytSiniri(tur: MedyaTuru): number {
  return tur === "video" ? MEDYA_SINIRLARI.VIDEO_BAYT : MEDYA_SINIRLARI.FOTO_BAYT;
}

const Kenar = z.number().int().min(1).max(MEDYA_SINIRLARI.BOYUT_KENAR);

/** `EkBilgisi` ile `media_begin`'in ortak alanları. */
const EK_ALANLARI = {
  medya_id: MedyaId,
  tur: MedyaTuru,
  mime: MedyaMime,
  /** Dosyanın ham bayt sayısı; türün sınırını aşamaz (`turBaytSiniri`). */
  boyut: z.number().int().min(1).max(MEDYA_SINIRLARI.VIDEO_BAYT),
  /** Yalnız video: seçicinin döndürdüğü süre (beyan). */
  sure_ms: z.number().int().min(1).max(MEDYA_SINIRLARI.VIDEO_SURE_MS).optional(),
  genislik: Kenar.optional(),
  yukseklik: Kenar.optional(),
};

// Ortak kurallar. Şemanın taban denetimi tutmasa da çağrılabilirler: hiç atmazlar.
type EkOzu = { tur: MedyaTuru; mime: MedyaMime; boyut: number; sure_ms?: number | undefined };
const mimeTuruTutar = (s: EkOzu) => mimeTuru(s.mime) === s.tur;
const boyutTuruTutar = (s: EkOzu) => typeof s.boyut === "number" && s.boyut <= turBaytSiniri(s.tur);
const sureYalnizVideoda = (s: EkOzu) => s.sure_ms === undefined || s.tur === "video";
const MIME_KURALI = { message: "mime türle uyuşmuyor", path: ["mime"] };
const BOYUT_KURALI = { message: "boyut türün bayt sınırını aşıyor", path: ["boyut"] };
const SURE_KURALI = { message: "sure_ms yalnız videoda", path: ["sure_ms"] };

/**
 * Mesaja eklenmiş bir ekin kablo bilgisi (`user_message.ekler`, `user_echo.ekler`). Yol, ad, içerik
 * yoktur. `boyut` 1..türün sınırı; `sure_ms` yalnız videoda, 1..`VIDEO_SURE_MS`; `genislik`/`yukseklik`
 * 1..`BOYUT_KENAR`.
 */
export const EkBilgisi = z
  .strictObject(EK_ALANLARI)
  .refine(mimeTuruTutar, MIME_KURALI)
  .refine(boyutTuruTutar, BOYUT_KURALI)
  .refine(sureYalnizVideoda, SURE_KURALI);
export type EkBilgisi = z.infer<typeof EkBilgisi>;

/** Bir mesajın ekleri: 1..`EK_ADET`, `medya_id` tekil, en çok bir video. Boş dizi geçersizdir (alan hiç yazılmaz). */
export const EkListesi = z
  .array(EkBilgisi)
  .min(1)
  .max(MEDYA_SINIRLARI.EK_ADET)
  .refine((l) => new Set(l.map((e) => e?.medya_id)).size === l.length, { message: "yinelenen medya_id" })
  .refine((l) => l.filter((e) => e?.tur === "video").length <= 1, { message: "en çok bir video" });
export type EkListesi = z.infer<typeof EkListesi>;

/**
 * Eklerin kısa özeti: `[2 fotoğraf]`, `[video]`, `[1 fotoğraf, 1 video]`; ek yoksa boş metin. Jetonsuz
 * bağlantıya giden `user_echo` metninin öneki (`olayiYetenegeGoreYansit`) ve servisin düz metin izleri bunu kullanır.
 */
export function ekOneki(ekler: readonly { tur: MedyaTuru }[]): string {
  let foto = 0;
  let video = 0;
  for (const e of ekler) {
    if (e.tur === "video") video++;
    else foto++;
  }
  if (foto > 0 && video > 0) return `[${foto} fotoğraf, ${video} video]`;
  if (video > 0) return video === 1 ? "[video]" : `[${video} video]`;
  if (foto > 0) return `[${foto} fotoğraf]`;
  return "";
}

// Parça verisi (standart base64)

/** `media_chunk.veri`'nin en çok uzunluğu: `4 * ceil(PARCA_BAYT / 3)` karakter. */
export const PARCA_BASE64_AZAMI = 4 * Math.ceil(MEDYA_SINIRLARI.PARCA_BAYT / 3);

function base64HarfiMi(c: number): boolean {
  return (
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x2b || // +
    c === 0x2f // /
  );
}

/**
 * Geçerli bir base64 metninin çözülmüş bayt sayısı: `uzunluk / 4 * 3 - dolgu`. Girdi
 * `parcaVerisiGecerliMi`'den geçmiş olmalıdır; servis `ofset + uzunluk > boyut` denetimini bununla yapar.
 */
export function base64BaytUzunlugu(veri: string): number {
  const dolgu = veri.endsWith("==") ? 2 : veri.endsWith("=") ? 1 : 0;
  return (veri.length / 4) * 3 - dolgu;
}

/**
 * `media_chunk.veri` denetimi. Sırası: önce uzunluk (boş değil, en çok `PARCA_BASE64_AZAMI`, 4'ün
 * katı), sonra alfabe (standart base64: `A-Z a-z 0-9 + /`; `=` yalnız sonda, en çok iki), en sonda
 * çözülmüş bayt sayısı en çok `PARCA_BAYT`. URL güvenli alfabe (`-`, `_`), boşluk ve satır sonu
 * geçersizdir. Düzenli ifade kullanmaz (Hermes'te uzun metinde geri izleme olmasın). Hiç atmaz.
 */
export function parcaVerisiGecerliMi(veri: unknown): boolean {
  if (typeof veri !== "string") return false;
  const n = veri.length;
  if (n === 0 || n > PARCA_BASE64_AZAMI || n % 4 !== 0) return false;
  for (let i = 0; i < n; i++) {
    const c = veri.charCodeAt(i);
    if (base64HarfiMi(c)) continue;
    // `=`: yalnız son karakter, ya da sondan ikinci ve son karakter de `=` ise.
    if (c === 0x3d && (i === n - 1 || (i === n - 2 && veri.charCodeAt(n - 1) === 0x3d))) continue;
    return false;
  }
  return base64BaytUzunlugu(veri) <= MEDYA_SINIRLARI.PARCA_BAYT;
}

// Yukarı: telefon -> bilgisayar. `usage_request` gibi: `client_msg_id` taşımaz, `ack` almaz, outbox'a girmez.

/**
 * Yüklemeyi aç ya da sür. Servis kaydı `(device_id, medya_id)` ile açar ya da bulur (idempotent) ve
 * `media_state` döner: bitmemişse `yukleniyor{alinan}` (telefon `alinan`'dan sürer; servis yarım
 * yüklemeyi sildiyse `alinan: 0`), bitmişse `kabul` ya da `reddedildi`. Aynı kimlik farklı
 * `sohbet_id`/`tur`/`mime`/`boyut` ile gelirse `reddedildi{medya_reddedildi}`; bekleyen kayıt sınırı ya
 * da disk kotası doluysa `reddedildi{medya_siniri}`.
 */
export const MediaBegin = sohbetMesaj("media_begin", { ...EK_ALANLARI, sohbet_id: OpakId })
  .refine(mimeTuruTutar, MIME_KURALI)
  .refine(boyutTuruTutar, BOYUT_KURALI)
  .refine(sureYalnizVideoda, SURE_KURALI);
export type MediaBegin = z.infer<typeof MediaBegin>;

/**
 * Bir parça: `veri` en çok `PARCA_BAYT` ham baytın standart base64'ü (`parcaVerisiGecerliMi`).
 * `ofset` 0..`VIDEO_BAYT - 1`; kaydın `boyut`'una göre denetimi serviste. Servis yalnız
 * `ofset == alinan` olan parçayı yazar, başka ofsetteki parçayı yazmadan güncel `alinan`'ı döner;
 * `ofset + uzunluk > boyut` ise kayıt reddedilir. Pencere 2 parça, aynı anda tek ek.
 */
export const MediaChunk = sohbetMesaj("media_chunk", {
  medya_id: MedyaId,
  ofset: z
    .number()
    .int()
    .min(0)
    .max(MEDYA_SINIRLARI.VIDEO_BAYT - 1),
  veri: z.string().refine(parcaVerisiGecerliMi, { message: "standart base64 değil ya da parça sınırını aşıyor" }),
});
export type MediaChunk = z.infer<typeof MediaChunk>;

/**
 * Yüklemeyi bırak: servis yarım ya da mesaja bağlanmamış kaydı siler. Yanıtı yoktur; bilinmeyen ya da
 * zaten bir mesaja bağlı kimlik sessizce yok sayılır (idempotent).
 */
export const MediaCancel = sohbetMesaj("media_cancel", { medya_id: MedyaId });
export type MediaCancel = z.infer<typeof MediaCancel>;

/** `media_*` yukarı türleri: servis bunları yalnız `medya1` isteyen bağlantıdan kabul eder. */
export const MEDYA_YUKARI_TURLERI = ["media_begin", "media_chunk", "media_cancel"] as const;

// Aşağı: bilgisayar -> telefon

export const MEDYA_DURUMLARI = ["yukleniyor", "kabul", "reddedildi"] as const;
export const MedyaDurumu = z.enum(MEDYA_DURUMLARI);
export type MedyaDurumu = z.infer<typeof MedyaDurumu>;

/**
 * PC'deki işleme durumu (yalnız `kabul` ile): `isleniyor`; `hazir` (fotoğraf ya da kareler + döküm);
 * `kismi` (kareler var, döküm yok); `hata` (kare de yok; mesaj yine gider, dosya yolu verilir).
 */
export const MEDYA_ISLEME_DURUMLARI = ["isleniyor", "hazir", "kismi", "hata"] as const;
export const MedyaIslemeDurumu = z.enum(MEDYA_ISLEME_DURUMLARI);
export type MedyaIslemeDurumu = z.infer<typeof MedyaIslemeDurumu>;

/**
 * Yüklemenin durumu. Kalıcı değildir, telafide yeniden oynatılmaz: yeniden bağlanan telefon bitmemiş
 * her eki `media_begin` ile yeniden sorar. Yalnız eki yükleyen cihazın `medya1` bağlantılarına gider.
 * - `yukleniyor`: `alinan` zorunlu (servisin diskteki baytı, telefonun süreceği ofset).
 * - `kabul`: doğrulandı, mesaja bağlanabilir; `isleme` isteğe bağlı, işleme ilerledikçe yeniden gelir.
 * - `reddedildi`: `code` zorunlu (`medya_reddedildi`, `medya_siniri`, `medya_yok` ya da genel bir kod).
 * `alinan` yalnız `yukleniyor`'da, `code` yalnız `reddedildi`'de, `isleme` yalnız `kabul`'de bulunur.
 */
export const MediaState = sohbetMesaj("media_state", {
  medya_id: MedyaId,
  durum: MedyaDurumu,
  alinan: z.number().int().min(0).max(MEDYA_SINIRLARI.VIDEO_BAYT).optional(),
  isleme: MedyaIslemeDurumu.optional(),
  code: HataKodu.optional(),
})
  .refine((s) => (s.durum === "yukleniyor") === (s.alinan !== undefined), {
    message: "alinan yalnız ve her zaman yukleniyor ile",
    path: ["alinan"],
  })
  .refine((s) => (s.durum === "reddedildi") === (s.code !== undefined), {
    message: "code yalnız ve her zaman reddedildi ile",
    path: ["code"],
  })
  .refine((s) => s.isleme === undefined || s.durum === "kabul", {
    message: "isleme yalnız kabul ile",
    path: ["isleme"],
  });
export type MediaState = z.infer<typeof MediaState>;

/** Medya aşağı türleri: yalnız `medya1` isteyen bağlantıya gider. */
export const MEDYA_ASAGI_TURLERI = ["media_state"] as const;
