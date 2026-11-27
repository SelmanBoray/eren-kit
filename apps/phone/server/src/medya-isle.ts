/**
 * Medya işleyici (S3a): koklama, `ffprobe` ölçümü, fotoğraf normalleştirme, video kareleri, whisper dökümü.
 * Kararı veren her şey saf ve dışa açık (koklama tablosu, mime tablosu, argv kurucuları, ölçek ve süzgeç
 * dizgeleri, kare zamanları, zaman aşımı, SRT ayrıştırıcı); `medyaIsleyiciKur` bunları `SurecPortu.aracCalistir`
 * ile birleştirir. Dosyaya kendisi dokunmaz: çıktıyı araç yazar, başarıyı çağıran (S4) portla sınar.
 *
 * Güvenli argv (her çağrı): `-hide_banner -loglevel error`, koklanan biçimin demuxer'ı `-f` ile açıkça,
 * `-protocol_whitelist file`, girdi her zaman `asil.<bicim>`, yollar veri köküne göreli ve `/`'li
 * (`goreliYol`), `cwd` = veri kökü. ffmpeg'de ayrıca `-nostdin -y` ve çıktıda `-map_metadata -1`.
 * [ölçüm, ffprobe 8.1] `ffprobe` `-nostdin`'i tanımaz ("Option not found") ve stdin'i okumaz; ona verilmez.
 */
import type { MedyaMime, MedyaTuru } from "@eren/protocol";
import type {
  AracCalismasi,
  AracSonucu,
  DokumMetni,
  KareSirasi,
  MedyaBicimi,
  MedyaDosyaAdi,
  MedyaIsleyiciFabrikasi,
  MedyaOlcumu,
  MedyaServisSinirlari,
} from "./sozlesme.ts";

// ---------------------------------------------------------------------------------------------
// Koklama
// ---------------------------------------------------------------------------------------------

/** `kokla`'nın baktığı en çok bayt. */
export const KOKLAMA_AZAMI_BAYT = 64;
/** Bundan kısa girdi tanınmaz (`ftyp` markası 12. bayta dek uzanır; gerçek bir medya dosyası çok daha büyüktür). */
export const KOKLAMA_EN_AZ_BAYT = 12;

/** `ftyp` ana markası → biçim (MODULLER.md "S3a"). Listede olmayan marka tanınmaz. */
export const FTYP_MARKALARI: Readonly<Record<string, MedyaBicimi>> = {
  heic: "heic",
  heix: "heic",
  mif1: "heic",
  msf1: "heic",
  isom: "mp4",
  iso2: "mp4",
  mp41: "mp4",
  mp42: "mp4",
  avc1: "mp4",
  "qt  ": "mov",
  "3gp4": "3gp",
  "3gp5": "3gp",
  "3gp6": "3gp",
};

const esit = (b: Uint8Array, ofset: number, beklenen: readonly number[]): boolean =>
  beklenen.every((x, i) => b[ofset + i] === x);
const ascii = (b: Uint8Array, ofset: number, uzunluk: number): string =>
  String.fromCharCode(...b.subarray(ofset, ofset + uzunluk));

const JPEG = [0xff, 0xd8, 0xff] as const;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const EBML = [0x1a, 0x45, 0xdf, 0xa3] as const;

/**
 * Baş baytlardan biçim; uzantıya da istemcinin beyanına da bakmaz. Metin (HLS `#EXTM3U`, concat listesi),
 * boş, `KOKLAMA_EN_AZ_BAYT`'tan kısa ya da tabloda olmayan girdi `null`. En çok `KOKLAMA_AZAMI_BAYT` okunur.
 */
export function kokla(girdi: Uint8Array): MedyaBicimi | null {
  const b = girdi.subarray(0, KOKLAMA_AZAMI_BAYT);
  if (b.length < KOKLAMA_EN_AZ_BAYT) return null;
  if (esit(b, 0, JPEG)) return "jpg";
  if (esit(b, 0, PNG)) return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (esit(b, 0, EBML)) return "webm";
  if (ascii(b, 4, 4) === "ftyp") return FTYP_MARKALARI[ascii(b, 8, 4)] ?? null;
  return null;
}

/** Biçimin türü. */
export const BICIM_TURU: Readonly<Record<MedyaBicimi, MedyaTuru>> = {
  jpg: "foto",
  png: "foto",
  webp: "foto",
  heic: "foto",
  mp4: "video",
  mov: "video",
  "3gp": "video",
  webm: "video",
};

/**
 * Biçimin kabul ettiği beyan mime'ları. [karar] ISO BMFF videoları (`mp4`/`mov`/`3gp`) tek ailedir: aynı
 * demuxer'la açılır ve telefonların marka/mime etiketi sık uyuşmaz (ör. `3gp6` markalı dosya `video/mp4`
 * diye gelir); koklanan demuxer kullanıldığı için bu gevşeklik güvenliği etkilemez. Fotoğraflar birebir.
 */
export const BICIM_MIMELERI: Readonly<Record<MedyaBicimi, readonly MedyaMime[]>> = {
  jpg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif"],
  mp4: ["video/mp4", "video/quicktime", "video/3gpp"],
  mov: ["video/mp4", "video/quicktime", "video/3gpp"],
  "3gp": ["video/mp4", "video/quicktime", "video/3gpp"],
  webm: ["video/webm"],
};

/** Koklanan biçim beyan edilen `tur` ile ve `mime` ile uyuşuyor mu. Hiç atmaz. */
export function beyanaUyar(bicim: MedyaBicimi, tur: MedyaTuru, mime: MedyaMime): boolean {
  const mimeler = BICIM_MIMELERI[bicim] as readonly unknown[] | undefined;
  return BICIM_TURU[bicim] === tur && mimeler !== undefined && mimeler.includes(mime);
}

/**
 * Biçim → ffmpeg demuxer'ı (gerçek ffmpeg testiyle sabit). `*_pipe` demuxer'ları dosya adını desen olarak
 * yorumlamaz (`image2`'nin aksine); `mov` HEIC'i de açar; `matroska` WebM'in demuxer'ıdır.
 */
export const BICIM_DEMUXER: Readonly<Record<MedyaBicimi, string>> = {
  jpg: "jpeg_pipe",
  png: "png_pipe",
  webp: "webp_pipe",
  heic: "mov",
  mp4: "mov",
  mov: "mov",
  "3gp": "mov",
  webm: "matroska",
};

// ---------------------------------------------------------------------------------------------
// Hesaplar
// ---------------------------------------------------------------------------------------------

type KareSinirlari = Pick<MedyaServisSinirlari, "kareEnAz" | "kareEnCok" | "kareAraligiMs">;

/** `clamp(ceil(sure / kareAraligiMs), kareEnAz, kareEnCok)`; geçersiz süre (sonlu değil, ≤ 0) 0. */
export function kareSayisi(sure_ms: number, s: KareSinirlari): number {
  if (!Number.isFinite(sure_ms) || sure_ms <= 0) return 0;
  return Math.min(s.kareEnCok, Math.max(s.kareEnAz, Math.ceil(sure_ms / s.kareAraligiMs)));
}

/** Kare zamanları (ms, tam sayı, artan): `floor((i + 0,5) * sure / N)`. Geçersiz süre boş liste. */
export function kareZamanlari(sure_ms: number, s: KareSinirlari): number[] {
  const n = kareSayisi(sure_ms, s);
  return Array.from({ length: n }, (_, i) => Math.floor(((i + 0.5) * sure_ms) / n));
}

/** Döküm zaman aşımı: `max(dokumZamanAsimiEnAzMs, dokumZamanAsimiKat * sure_ms)`; geçersiz süre en az değer. */
export function dokumZamanAsimiMs(
  sure_ms: number,
  s: Pick<MedyaServisSinirlari, "dokumZamanAsimiEnAzMs" | "dokumZamanAsimiKat">,
): number {
  const sure = Number.isFinite(sure_ms) && sure_ms > 0 ? sure_ms : 0;
  return Math.max(s.dokumZamanAsimiEnAzMs, Math.ceil(s.dokumZamanAsimiKat * sure));
}

/**
 * Ölçek çarpanı (saf, testte süzgeç dizgesinin aynasıdır): `min(1, uzunKenar / max(w, h), sqrt(piksel / (w h)))`;
 * `piksel` `null` ise alan sınırı yok. Hiç büyütmez.
 */
export function olcekCarpani(genislik: number, yukseklik: number, uzunKenar: number, piksel: number | null): number {
  let f = Math.min(1, uzunKenar / Math.max(genislik, yukseklik));
  if (piksel !== null) f = Math.min(f, Math.sqrt(piksel / (genislik * yukseklik)));
  return f;
}

/** `olcekCarpani` ile hedef boyut: `max(1, trunc(kenar * f))`. */
export function olcekBoyutu(
  genislik: number,
  yukseklik: number,
  uzunKenar: number,
  piksel: number | null,
): { genislik: number; yukseklik: number } {
  const f = olcekCarpani(genislik, yukseklik, uzunKenar, piksel);
  return { genislik: Math.max(1, Math.trunc(genislik * f)), yukseklik: Math.max(1, Math.trunc(yukseklik * f)) };
}

const tamSayi = (n: number): string => {
  if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError("ölçek sınırı pozitif tam sayı olmalı");
  return String(n);
};

/**
 * `olcekBoyutu`'nun ffmpeg `scale` süzgeci karşılığı. `iw`/`ih` ffmpeg'in kendiliğinden döndürmesinden
 * (EXIF yönü, video görüntü matrisi) SONRAKİ boyutlardır, bu yüzden ölçüm gerekmez. İfadedeki virgüller
 * tek tırnak içinde (süzgeç çizgesi düzeyi). Sınırlar pozitif tam sayı değilse ATAR (yalnız ayardan gelir).
 */
export function olcekSuzgeci(uzunKenar: number, piksel: number | null): string {
  const l = tamSayi(uzunKenar);
  const p = piksel === null ? null : tamSayi(piksel);
  const f = p === null ? `min(1,${l}/max(iw,ih))` : `min(1,min(${l}/max(iw,ih),sqrt(${p}/(iw*ih))))`;
  return `scale=w='max(1,trunc(iw*${f}))':h='max(1,trunc(ih*${f}))'`;
}

/**
 * Süzgeç seçeneği değerinin iki düzeyli kaçışı (ffmpeg-filters "Notes on filtergraph escaping"):
 * (1) seçenek düzeyi `\ ' :`, (2) çizge düzeyi `\ ' [ ] , ;`. Windows yolundaki `C:` böylece `C\\:` olur.
 * [ölçüm, ffmpeg 8.1] mutlak `C:/...` model yolu bu kaçışla açıldı.
 */
export function suzgecDegeriKacir(deger: string): string {
  return deger.replace(/[\\':]/g, "\\$&").replace(/[\\'[\],;]/g, "\\$&");
}

/** Whisper süzgecinin `queue`'su, saniye. [ölçüm] 60 sn TR seste 3 sn: 137 sn; 20 sn: 26 sn; 30 sn: 23 sn (GPU). */
export const WHISPER_KUYRUK_SN = 20;

/** `aresample=16000,whisper=model=..:language=..:queue=20:format=srt:destination=..[:vad_model=..]`. */
export function whisperSuzgeci(g: {
  model: string;
  dil: "auto" | "tr";
  hedef: string;
  vadModeli: string | null;
}): string {
  const k = suzgecDegeriKacir;
  const secenekler = [
    `model=${k(g.model)}`,
    `language=${k(g.dil)}`,
    `queue=${WHISPER_KUYRUK_SN}`,
    "format=srt",
    `destination=${k(g.hedef)}`,
  ];
  if (g.vadModeli !== null) secenekler.push(`vad_model=${k(g.vadModeli)}`);
  return `aresample=16000,whisper=${secenekler.join(":")}`;
}

/** `-ss` değeri, saniye, 3 ondalık; geçersiz ya da negatif zaman 0. */
export function ssDegeri(zaman_ms: number): string {
  const z = Number.isFinite(zaman_ms) && zaman_ms > 0 ? zaman_ms : 0;
  return (z / 1000).toFixed(3);
}

// ---------------------------------------------------------------------------------------------
// argv kurucuları (girdi ve çıktı veri köküne göreli yollar)
// ---------------------------------------------------------------------------------------------

const FFMPEG_ON = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"] as const;
const girisSecenekleri = (bicim: MedyaBicimi): string[] => ["-protocol_whitelist", "file", "-f", BICIM_DEMUXER[bicim]];
/** Tek JPEG çıktısı: `image2` + `-update 1` dosya adını desen saymaz, kodlayıcı açık. */
const JPEG_CIKTI = ["-map_metadata", "-1", "-frames:v", "1", "-update", "1", "-c:v", "mjpeg"] as const;

/**
 * `ffprobe` argv'si (JSON). Fotoğrafta ilk kare de okunur (`-read_intervals %+#1`): [ölçüm, ffmpeg 8.1]
 * JPEG'in EXIF yönü akış düzeyinde görünmez, yalnız karenin görüntü matrisinde (`rotation: -90`) görünür.
 */
export function olcumArgv(girdi: string, bicim: MedyaBicimi): string[] {
  const foto = BICIM_TURU[bicim] === "foto";
  const alanlar =
    "format=duration:stream=index,codec_type,width,height,duration:stream_disposition=attached_pic" +
    ":stream_side_data=rotation" +
    (foto ? ":frame=width,height:frame_side_data=rotation" : "");
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...girisSecenekleri(bicim),
    ...(foto ? ["-read_intervals", "%+#1"] : []),
    "-show_entries",
    alanlar,
    "-of",
    "json",
    "-i",
    girdi,
  ];
}

/** Fotoğraf → `gorsel.jpg`: uzun kenar ≤ `gorselUzunKenar`, alan ≤ `gorselPiksel`, `-q:v 3`, üst veri yok. */
export function gorselArgv(
  girdi: string,
  cikti: string,
  bicim: MedyaBicimi,
  s: Pick<MedyaServisSinirlari, "gorselUzunKenar" | "gorselPiksel">,
): string[] {
  return [
    ...FFMPEG_ON,
    ...girisSecenekleri(bicim),
    "-i",
    girdi,
    "-an",
    "-sn",
    "-dn",
    "-vf",
    olcekSuzgeci(s.gorselUzunKenar, s.gorselPiksel),
    ...JPEG_CIKTI,
    "-q:v",
    "3",
    "-f",
    "image2",
    cikti,
  ];
}

/** Video karesi: `-ss` girişten önce (hızlı ve doğru arama), uzun kenar `kareUzunKenar`, `-q:v 4`. */
export function kareArgv(
  girdi: string,
  cikti: string,
  bicim: MedyaBicimi,
  zaman_ms: number,
  s: Pick<MedyaServisSinirlari, "kareUzunKenar">,
): string[] {
  return [
    ...FFMPEG_ON,
    ...girisSecenekleri(bicim),
    "-ss",
    ssDegeri(zaman_ms),
    "-i",
    girdi,
    "-an",
    "-sn",
    "-dn",
    "-vf",
    olcekSuzgeci(s.kareUzunKenar, null),
    ...JPEG_CIKTI,
    "-q:v",
    "4",
    "-f",
    "image2",
    cikti,
  ];
}

/** Döküm: ses → whisper süzgeci → `destination`; ffmpeg çıktısı `-f null -`. */
export function dokumArgv(girdi: string, bicim: MedyaBicimi, suzgec: string): string[] {
  return [
    ...FFMPEG_ON,
    ...girisSecenekleri(bicim),
    "-i",
    girdi,
    "-vn",
    "-sn",
    "-dn",
    "-af",
    suzgec,
    "-map_metadata",
    "-1",
    "-f",
    "null",
    "-",
  ];
}

// ---------------------------------------------------------------------------------------------
// ffprobe JSON
// ---------------------------------------------------------------------------------------------

const nesne = (x: unknown): Record<string, unknown> | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
const dizi = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
/** Pozitif sonlu sayı (sayı ya da ffprobe'un sayısal dizgesi); değilse `null`. */
const pozitif = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const kenar = (x: unknown): number | null => {
  const n = pozitif(x);
  return n !== null && Number.isSafeInteger(n) ? n : null;
};
/** Yan verideki ilk sonlu `rotation`; yoksa `null`. */
const donme = (yanVeri: unknown): number | null => {
  for (const y of dizi(yanVeri)) {
    const r = nesne(y)?.["rotation"];
    if (typeof r === "number" && Number.isFinite(r)) return r;
  }
  return null;
};
/** Dönme 90°'nin tek katıysa görüntü genişliği ile yüksekliği yer değiştirir. */
const ceyrekTek = (r: number | null): boolean => r !== null && Math.abs(Math.round(r / 90)) % 2 === 1;

/**
 * `olcumArgv` çıktısı → `MedyaOlcumu`. `genislik`/`yukseklik` GÖRÜNTÜ boyutudur (dönme uygulanmış: portre
 * telefon videosu 1280x720 + `rotation: 90` → 720x1280); akış seçimi: kapak resmi (`attached_pic`) olmayan
 * en büyük alanlı video akışı. Süre `format.duration`, yoksa o akışın süresi. JSON çözülemez ya da hiç akış
 * yoksa `null`. Hiç atmaz.
 */
export function olcumCoz(stdout: string): MedyaOlcumu | null {
  let kok: Record<string, unknown> | null;
  try {
    kok = nesne(JSON.parse(stdout));
  } catch {
    return null;
  }
  if (kok === null) return null;
  const akislar = dizi(kok["streams"]).map(nesne).filter((a) => a !== null);
  if (akislar.length === 0) return null;

  const videolar = akislar.filter(
    (a) => a["codec_type"] === "video" && nesne(a["disposition"])?.["attached_pic"] !== 1,
  );
  const alan = (a: Record<string, unknown>): number => (kenar(a["width"]) ?? 0) * (kenar(a["height"]) ?? 0);
  const video = videolar.reduce<Record<string, unknown> | null>(
    (en, a) => (en === null || alan(a) > alan(en) ? a : en),
    null,
  );

  const sureSn = pozitif(nesne(kok["format"])?.["duration"]) ?? (video === null ? null : pozitif(video["duration"]));
  let genislik = video === null ? null : kenar(video["width"]);
  let yukseklik = video === null ? null : kenar(video["height"]);
  let r = video === null ? null : donme(video["side_data_list"]);
  if (r === null) {
    // Fotoğrafın ilk karesi (EXIF yönü yalnız karede görünür).
    const kare = nesne(dizi(kok["frames"])[0]);
    if (kare !== null) {
      r = donme(kare["side_data_list"]);
      genislik ??= kenar(kare["width"]);
      yukseklik ??= kenar(kare["height"]);
    }
  }
  if (ceyrekTek(r)) [genislik, yukseklik] = [yukseklik, genislik];

  return {
    sure_ms: sureSn === null ? null : Math.round(sureSn * 1000),
    genislik,
    yukseklik,
    video_akisi: videolar.length > 0,
    ses_akisi: akislar.some((a) => a["codec_type"] === "audio"),
  };
}

// ---------------------------------------------------------------------------------------------
// SRT → `[mm:ss] metin`
// ---------------------------------------------------------------------------------------------

/** `00:00:01,000 --> 00:00:03,500` (virgül ya da nokta). Saat 1-3 hane; dakika ve saniye 00-59. */
const ZAMAN_SATIRI =
  /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})\s*-->\s*\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3}(?:\s.*)?$/;

export interface Altyazi {
  bas_ms: number;
  metin: string;
}

/**
 * Saf SRT ayrıştırıcı. Zaman satırı yeni altyazı açar, boş satır kapatır; altyazı dışındaki satır (sıra
 * numarası, bozuk satır) ve metni boş altyazı atlanır; çok satırlı altyazı tek boşlukla birleşir; boşluklar
 * sadeleşir. Boş satır eksik olsa da sonraki zaman satırından hemen önceki salt sayı satırı sıra numarası sayılır.
 */
export function srtCoz(srt: string): Altyazi[] {
  const satirlar = srt.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const sonuc: { bas_ms: number; parcalar: string[] }[] = [];
  let acik: { bas_ms: number; parcalar: string[] } | null = null;
  for (let i = 0; i < satirlar.length; i++) {
    const t = (satirlar[i] as string).trim();
    if (t === "") {
      acik = null;
      continue;
    }
    const m = ZAMAN_SATIRI.exec(t);
    if (m !== null) {
      const [sa, dk, sn, ms] = [m[1], m[2], m[3], m[4]].map((x) => Number(x)) as [number, number, number, number];
      acik = { bas_ms: ((sa * 60 + dk) * 60 + sn) * 1000 + ms, parcalar: [] };
      sonuc.push(acik);
      continue;
    }
    if (acik === null) continue;
    if (/^\d+$/.test(t) && ZAMAN_SATIRI.test((satirlar[i + 1] ?? "").trim())) continue;
    acik.parcalar.push(t);
  }
  return sonuc
    .map((a) => ({ bas_ms: a.bas_ms, metin: a.parcalar.join(" ").replace(/\s+/g, " ").trim() }))
    .filter((a) => a.metin !== "");
}

const iki = (n: number): string => String(n).padStart(2, "0");

/** `[mm:ss]`; `saatli` ise `[s:mm:ss]` (dakika 60'ı aşmaz). */
export function damga(ms: number, saatli: boolean): string {
  const toplam = Math.floor(Math.max(0, ms) / 1000);
  const sa = Math.floor(toplam / 3600);
  const dk = Math.floor((toplam % 3600) / 60);
  const sn = toplam % 60;
  return saatli ? `[${sa}:${iki(dk)}:${iki(sn)}]` : `[${iki(Math.floor(toplam / 60))}:${iki(sn)}]`;
}

/**
 * SRT → `DokumMetni`: her altyazı bir satır, `[mm:ss] metin`; herhangi bir altyazı bir saati aşıyorsa
 * bütün satırlar `[s:mm:ss]`. `azami` UTF-16 birimini aşarsa sığan tam satırlar kalır (hiçbiri sığmazsa ilk
 * satır vekil çifti bölünmeden kesilir), `kirpildi: true`.
 */
export function dokumMetniKur(srt: string, azami: number): DokumMetni {
  const altyazilar = srtCoz(srt);
  const saatli = altyazilar.some((a) => a.bas_ms >= 3_600_000);
  const satirlar = altyazilar.map((a) => `${damga(a.bas_ms, saatli)} ${a.metin}`);
  const tam = satirlar.join("\n");
  const sinir = Math.max(0, Math.floor(azami));
  if (tam.length <= sinir) return { metin: tam, kirpildi: false };
  let metin = "";
  for (const s of satirlar) {
    const aday = metin === "" ? s : `${metin}\n${s}`;
    if (aday.length > sinir) break;
    metin = aday;
  }
  if (metin === "") {
    let kesim = sinir;
    const onceki = tam.charCodeAt(kesim - 1);
    if (kesim > 0 && onceki >= 0xd800 && onceki <= 0xdbff) kesim--;
    metin = tam.slice(0, kesim);
  }
  return { metin, kirpildi: true };
}

// ---------------------------------------------------------------------------------------------
// İşleyici
// ---------------------------------------------------------------------------------------------

const asil = (bicim: MedyaBicimi): MedyaDosyaAdi => `asil.${bicim}` as const;
const kareAdi = (sira: KareSirasi): MedyaDosyaAdi => `kare-0${sira}.jpg` as const;
const CIKTISIZ: AracCalismasi = { zamanAsimi: false };

export const medyaIsleyiciKur: MedyaIsleyiciFabrikasi = (b) => {
  const s = b.ayar.sinirlar;

  /** Yol kurma ya da başlatma hatası `null` (çıktı yok); hiç atmaz. */
  const calistir = async (exe: string, argv: () => string[], zamanAsimiMs: number): Promise<AracSonucu | null> => {
    try {
      return await b.surec.aracCalistir({ exe, argv: argv(), cwd: b.veriKoku, zamanAsimiMs });
    } catch {
      return null;
    }
  };
  const bitis = (r: AracSonucu | null): AracCalismasi => (r === null ? CIKTISIZ : { zamanAsimi: r.zamanAsimi });
  const goreli = (no: number, ad: MedyaDosyaAdi): string => b.dosya.goreliYol(no, ad);

  return {
    kokla,
    beyanaUyar,
    kareZamanlari: (sure_ms) => kareZamanlari(sure_ms, s),

    olc: async (no, bicim) => {
      const r = await calistir(b.ayar.ffprobe, () => olcumArgv(goreli(no, asil(bicim)), bicim), s.olcumZamanAsimiMs);
      if (r === null || r.zamanAsimi) return null;
      return olcumCoz(r.stdout);
    },

    gorselUret: async (no, bicim) =>
      bitis(
        await calistir(
          b.ayar.ffmpeg,
          () => gorselArgv(goreli(no, asil(bicim)), goreli(no, "gorsel.jpg"), bicim, s),
          s.gorselZamanAsimiMs,
        ),
      ),

    kareUret: async (no, bicim, sira, zaman_ms) =>
      bitis(
        await calistir(
          b.ayar.ffmpeg,
          () => kareArgv(goreli(no, asil(bicim)), goreli(no, kareAdi(sira)), bicim, zaman_ms, s),
          s.kareZamanAsimiMs,
        ),
      ),

    dokumUret: async (no, bicim, sure_ms) => {
      const model = b.ayar.dokumModeli;
      if (model === null) return CIKTISIZ;
      return bitis(
        await calistir(
          b.ayar.ffmpeg,
          () =>
            dokumArgv(
              goreli(no, asil(bicim)),
              bicim,
              whisperSuzgeci({
                model,
                dil: b.ayar.dokumDili,
                hedef: goreli(no, "dokum.srt"),
                vadModeli: b.ayar.dokumVadModeli,
              }),
            ),
          dokumZamanAsimiMs(sure_ms, s),
        ),
      );
    },

    dokumMetni: (srt) => dokumMetniKur(srt, s.dokumMetni),
  };
};
