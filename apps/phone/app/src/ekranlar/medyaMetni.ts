/**
 * Medya eklerinin kullanıcıya görünen Türkçe metinleri: saf işlevler (Expo/RN ve `Intl` yok; ondalık ayırıcı virgül).
 * Sınırlar `MEDYA_SINIRLARI`'ndan gelir; metindeki "5 dakika" ve "250 MB" onun türevidir (testte sabitlenir).
 */
import { MEDYA_SINIRLARI, type MedyaTuru } from "@eren/protocol";
import type {
  EkIlerlemesi,
  EkRedNedeni,
  GidenHataKodu,
  GonderRedNedeni,
  MedyaKaynagi,
  MedyaSecimSonucu,
} from "../cekirdek/sozlesme.ts";

const KIB = 1024;
const MIB = 1024 * 1024;
const VIDEO_DAKIKA = Math.round(MEDYA_SINIRLARI.VIDEO_SURE_MS / 60_000);
const VIDEO_MB = Math.round(MEDYA_SINIRLARI.VIDEO_BAYT / MIB);

/** Ek düğmesinin görünen adı ve erişilebilirlik etiketleri. */
export const EK_DUGME_METNI = "Ekle";
export const EK_DUGME_ETIKETI = "Fotoğraf ya da video ekle";
export const EK_DOLU_ETIKETI = `Ek sınırına ulaşıldı, en çok ${MEDYA_SINIRLARI.EK_ADET} ek eklenebilir`;
export const EK_KAPALI_METNI = "Bu PC servisi ek desteklemiyor; servisi güncelle.";
export const EK_SECENEKLERI_BASLIGI = "Ek ekle";

/** `AltSayfa` seçenekleri, sırasıyla. */
export const EK_SECENEKLERI: readonly { kaynak: MedyaKaynagi; metin: string }[] = [
  { kaynak: "galeri", metin: "Galeriden seç" },
  { kaynak: "foto_cek", metin: "Fotoğraf çek" },
  { kaynak: "video_cek", metin: "Video çek" },
];

/** 850 KB, 3,4 MB. 1 KB altı "N B"; MB'de bir ondalık, ",0" yazılmaz. */
export const baytMetni = (bayt: number): string => {
  const b = Number.isFinite(bayt) && bayt > 0 ? bayt : 0;
  if (b < KIB) return `${Math.round(b)} B`;
  const kb = Math.round(b / KIB);
  if (kb < KIB) return `${kb} KB`;
  const onda = Math.round((b / MIB) * 10);
  return `${Math.floor(onda / 10)}${onda % 10 === 0 ? "" : `,${onda % 10}`} MB`;
};

/** m:ss: 42 sn → "0:42", 245 sn → "4:05". Saniye aşağı yuvarlanır; geçersiz değer "0:00". */
export const sureMetni = (ms: number): string => {
  const toplam = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${Math.floor(toplam / 60)}:${String(toplam % 60).padStart(2, "0")}`;
};

/** Seçimde reddedilen ek için tek cümle. */
export const ekRedMetni = (neden: EkRedNedeni): string => {
  switch (neden) {
    case "tur_desteklenmiyor":
      return "Bu dosya türü desteklenmiyor; yalnız fotoğraf ve video eklenebilir.";
    case "okunamadi":
      return "Dosya okunamadı.";
    case "zaten_ekli":
      return "Bu dosya zaten ekli.";
    case "video_uzun":
      return `Video ${VIDEO_DAKIKA} dakikadan uzun; en çok ${VIDEO_DAKIKA} dakikalık video eklenebilir.`;
    case "cok_buyuk":
      return `Video ${VIDEO_MB} MB'tan büyük; eklenemez.`;
    case "ikinci_video":
      return "Bir mesaja en çok bir video eklenebilir.";
    case "adet_asildi":
      return `Bir mesaja en çok ${MEDYA_SINIRLARI.EK_ADET} ek eklenebilir.`;
  }
};

/** Seçici açılamadığında not satırı. `ok` olmayan sonucun nedeni. */
export const secimHataMetni = (neden: Extract<MedyaSecimSonucu, { ok: false }>["neden"]): string =>
  neden === "izin_yok" ? "Kamera izni verilmedi. Galeriden seçebilirsin." : "Seçici açılamadı. Tekrar dene.";

/** Sunucunun `media_state.code` ya da yerel hata kodu için ek metni; ek ile ilgisiz kod `null`. */
export const medyaHataMetni = (kod: GidenHataKodu): string | null => {
  switch (kod) {
    case "medya_yok":
      return "Ek PC'de bulunamadı";
    case "medya_reddedildi":
      return "PC eki kabul etmedi";
    case "medya_siniri":
      return "PC'de ek sınırı doldu";
    case "ek_bulunamadi":
      return "Ek telefonda bulunamadı";
    default:
      return null;
  }
};

const GENEL_RED_METNI = "PC eki kabul etmedi";

const yuzde = (alinan: number, boyut: number): number =>
  boyut > 0 ? Math.max(0, Math.min(100, Math.floor((alinan / boyut) * 100))) : 0;

/** Tek ekin durum metni; gösterilecek bir şey yoksa (`hazir`, `kismi`, `null`) `null`. */
export const ekIlerlemeMetni = (i: EkIlerlemesi | null): string | null => {
  if (i === null) return null;
  switch (i.durum) {
    case "bekliyor":
      return "Sırada";
    case "yukleniyor":
      return `Yükleniyor %${yuzde(i.alinan, i.boyut)}`;
    case "kabul":
      if (i.isleme === "isleniyor") return "PC'de işleniyor";
      if (i.isleme === "hata") return "PC eki işleyemedi";
      return i.isleme === null ? "Yüklendi" : null;
    case "reddedildi":
      return medyaHataMetni(i.kod) ?? GENEL_RED_METNI;
    case "yerel_yok":
      return "Ek telefonda bulunamadı";
  }
};

/** Bekleyen mesaj balonunun tek satırı: ilk hata, yoksa bayt ağırlıklı yükleme yüzdesi, yoksa sıra/işleme; yoksa `null`. */
export const mesajIlerlemeMetni = (ler: readonly (EkIlerlemesi | null)[]): string | null => {
  for (const i of ler) {
    if (i?.durum === "reddedildi" || i?.durum === "yerel_yok") return ekIlerlemeMetni(i);
  }
  let alinan = 0;
  let boyut = 0;
  let yukleniyor = false;
  let bekliyor = false;
  let isleniyor = false;
  for (const i of ler) {
    if (i === null) continue;
    if (i.durum === "yukleniyor") {
      yukleniyor = true;
      alinan += i.alinan;
      boyut += i.boyut;
    } else if (i.durum === "bekliyor") bekliyor = true;
    else if (i.durum === "kabul" && i.isleme !== "hazir" && i.isleme !== "kismi") isleniyor = true;
  }
  if (yukleniyor) return `%${yuzde(alinan, boyut)} yüklendi`;
  if (bekliyor) return "Sırada";
  return isleniyor ? "PC'de işleniyor" : null;
};

/** Yeni `GonderRedNedeni`'ler için not satırı; eski nedenler başka yerde işlenir (`null`). */
export const medyaGonderRedMetni = (neden: GonderRedNedeni): string | null => {
  switch (neden) {
    case "medya_desteklenmiyor":
      return EK_KAPALI_METNI;
    case "ek_hazirlanamadi":
      return "Ek hazırlanamadı; dosyayı kaldırıp yeniden ekle.";
    case "ek_siniri":
      return "Yüklenmeyi bekleyen çok ek var; biraz bekleyip tekrar dene.";
    default:
      return null;
  }
};

/** Şeritteki ek için ekran okuyucu etiketleri. */
export const ekSeritiEtiketi = (tur: MedyaTuru, sira: number, toplam: number, sure_ms: number | null): string =>
  `${tur === "video" ? "Video" : "Fotoğraf"} ${sira} / ${toplam}${tur === "video" && sure_ms !== null ? `, ${sureMetni(sure_ms)}` : ""}`;
export const EK_KALDIR_ETIKETI = "Eki kaldır";
