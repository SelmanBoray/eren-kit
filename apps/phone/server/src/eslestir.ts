/**
 * Yerel `eren eslestir` komutu. Saf çekirdek `eslestirmeBaslat`; komut satırı ince bir kabuktur
 * ve yalnız bu dosya doğrudan çalıştırılınca devreye girer. MODULLER.md "### eslestir" [karar].
 *
 * Eşleşme yönetimi (`--liste`, `--kaldir <device_id>`): saf `argumanCoz`, `listeMetni`,
 * `cihazKaldirKomutu`; depo tarafı `depo.ts` `CihazYonetimi`. Kaldırma servisin dışındadır: servis onu
 * `cihazGetir` üzerinden her kimlik denetiminde ve `gateway` yoklamasında görür.
 *
 * Ajanda dalgası (`--ajanda`): `ajandaEslestirmeBaslat` aynı kod üreteci ve süreyle `kapsam:"ajanda"`
 * pencere açar, QR `AjandaEslestirmeQr`'dır. Kapsamı telefon değil bu komut belirler; tek pencere
 * kuralını depo uygular (yeni pencere öteki kapsamınkini siler). `--liste --ajanda` yalnız ajanda
 * cihazlarını gösterir, `--kaldir <kimlik> --ajanda` yalnız ajanda cihazını kaldırır.
 *
 * PC ajanları (`--pc-ajan <ad>`, docs/HARNESS.md 4.3): ajanda anahtarını üretir, listeler, kaldırır ve
 * teşhis eder. Ad kapalı listededir (`kurulum/harness/tur.ts` `PC_AJAN_ADLARI`); uyarlayıcı aynı sürümün
 * kurulum dizininden göreli yüklenir. `--claude-code`, `--pc-ajan claude-code`'un eski adıdır, çıktısı aynı.
 * Anahtar ajandan bağımsızdır (tek ortak anahtar); ada göre değişen yalnız kayıt yönergesi, kanca teşhisi
 * ve görünen metindir. Yalnız taslak ajan (Codex CLI; uyarlayıcının `taslakNedeni`'si var, kancası yok):
 * yönerge yalnız MCP kaydını gösterir, teşhis kanca aramaz, kayıtların neden taslak doğduğunu söyler.
 * `--yonerge` kayıt yönergesini anahtara ve depoya dokunmadan yazar (alt komutsuz çağrı anahtarı yeniler).
 * Teşhis `arac` olaylarını köprünün bildirdiği ajana (`uyarlayici`) göre ayırır: seçilen ajanın özeti yalnız
 * kendi çağrılarından kurulur, ötekiler ayrı satırdadır; hiçbir `arac` alanı taşımıyorsa (eski günlük) ayırmaz.
 */
import {
  AJANDA_PC_MCP_ADI,
  AJANDA_PC_SINIRLARI,
  AJANDA_QR_SURUMU,
  AjandaEslestirmeQr as AjandaEslestirmeQrSemasi,
  ESKI_CIHAZ_KAPSAMI,
  EslestirmeQr as EslestirmeQrSemasi,
  kacir,
  PROTOKOL_SURUMU,
  sha256Hex,
  utf8Bayt,
  type CihazKapsami,
  type PcTurKarari,
} from "@eren/protocol";
import type { CihazYonetimi, EslesmeOzeti } from "./depo.ts";
import type {
  AjandaEslestirmeBaslatici,
  AjandaPcAnahtarOzeti,
  EslestirmeBagimliliklari,
  EslestirmeBaslatici,
  EslestirmeKaydi,
  Sonuc,
} from "./sozlesme.ts";

const KOD_UZUNLUGU = 8;
const KOD_ALFABESI = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const GECERLILIK_MS = 5 * 60 * 1000;
// 256 % 36 = 4: bu eşiğin üstündeki baytlar atılır, dağılım eşit kalır.
const KABUL_ESIGI = 256 - (256 % KOD_ALFABESI.length);

function kodUret(baytlar: (adet: number) => Uint8Array): string {
  let kod = "";
  while (kod.length < KOD_UZUNLUGU) {
    for (const b of baytlar(KOD_UZUNLUGU * 2)) {
      if (b >= KABUL_ESIGI) continue;
      kod += KOD_ALFABESI[b % KOD_ALFABESI.length];
      if (kod.length === KOD_UZUNLUGU) break;
    }
  }
  return kod;
}

/** Telefondaki `parmakIzi` ile aynı: SPKI DER'in SHA-256'sı, büyük harf hex, 4'lü gruplar. */
export function parmakIzi(acikAnahtarB64: string): string {
  const ikili = atob(acikAnahtarB64);
  const der = Uint8Array.from(ikili, (c) => c.charCodeAt(0));
  return (sha256Hex(der).toUpperCase().match(/.{4}/g) ?? []).join(" ");
}

/** QR'ın iki kapsamda ortak alanları. */
interface QrTemeli {
  host: string;
  port: number;
  kod: string;
  server_public_key: string;
}

type QrDogrulama<Q> = { success: true; data: Q } | { success: false };

/**
 * İki kapsamın ortak çekirdeği. Sıra sabittir (adres, kod, saat, QR doğrulaması, depo): QR şemadan
 * geçmezse depoya hiç yazılmaz, önceki pencere bozulmaz. `kapsam` yalnız ajanda penceresinde verilir;
 * sohbet penceresi kaydı bugünkü gibi kapsam alanı olmadan yazılır.
 */
function pencereAc<Q>(
  b: EslestirmeBagimliliklari,
  qrKur: (temel: QrTemeli) => QrDogrulama<Q>,
  kapsam?: "ajanda",
): Sonuc<{ qr: Q; kod: string; sonMs: number }, "ic_hata"> {
  const host = b.sistem.tailscaleAdresi();
  if (host === null) return { ok: false, code: "ic_hata", detail: "tailscale_adresi_yok" };

  const kod = kodUret((adet) => b.rastgele.baytlar(adet));
  const sonMs = b.saat.simdiMs() + GECERLILIK_MS;

  const qr = qrKur({ host, port: b.wsPort, kod, server_public_key: b.anahtar.acikAnahtar() });
  if (!qr.success) return { ok: false, code: "ic_hata", detail: "qr_gecersiz" };

  const kayit: EslestirmeKaydi = { kod_ozeti: sha256Hex(utf8Bayt(kod)), son_ms: sonMs, yanlis_deneme: 0 };
  if (kapsam !== undefined) kayit.kapsam = kapsam;
  try {
    b.depo.eslestirmeYaz(kayit);
  } catch {
    return { ok: false, code: "ic_hata", detail: "depo_yazilamadi" };
  }
  return { ok: true, deger: { qr: qr.data, kod, sonMs } };
}

export const eslestirmeBaslat: EslestirmeBaslatici = (b) =>
  pencereAc(b, (t) => EslestirmeQrSemasi.safeParse({ v: PROTOKOL_SURUMU, ...t }));

/** `eslestir --ajanda`: aynı kod ve süre; QR `AjandaEslestirmeQr` (`v` = `AJANDA_QR_SURUMU`, kanal sürümünden ayrı), pencere `kapsam:"ajanda"`. */
export const ajandaEslestirmeBaslat: AjandaEslestirmeBaslatici = (b) =>
  pencereAc(b, (t) => AjandaEslestirmeQrSemasi.safeParse({ v: AJANDA_QR_SURUMU, ...t, kanal: "ajanda" }), "ajanda");

// ---------------------------------------------------------------------------------------------
// Eşleşme yönetimi: saf parçalar (test edilir), komut satırı aşağıda.
// ---------------------------------------------------------------------------------------------

/** `gateway` yoklama aralığıyla aynı sayı; yalnız kullanıcıya söylenir. */
const KAPANIS_SURESI_SN = 2;
/** Terminale giden kullanıcı metni (etiket, verilen kimlik) için üst sınır. */
const AZAMI_GORUNEN = 64;

export const KULLANIM = [
  "Kullanım:",
  "  eslestir                     Yeni eşleştirme kodu üretir (5 dakika, tek kullanımlık).",
  "  eslestir --liste             Eşleşmiş ve kaldırılmış cihazları listeler.",
  "  eslestir --kaldir <kimlik>   Cihazın eşleşmesini kaldırır; açık bağlantıları da kapanır.",
  "",
  "Ajanda uygulaması (yalnız /ajanda kanalı; sohbeti açamaz):",
  "  eslestir --ajanda                     Ajanda için eşleştirme kodu üretir (5 dakika, tek kullanımlık).",
  "  eslestir --ajanda --liste             Yalnız ajanda cihazlarını listeler.",
  "  eslestir --ajanda --kaldir <kimlik>   Ajanda cihazının eşleşmesini kaldırır (sohbet cihazına dokunmaz).",
  "",
  "Aynı anda tek eşleştirme penceresi açıktır: yeni kod (hangi kapsamda olursa olsun) öncekini geçersiz kılar.",
  "",
  "PC'deki Claude Code oturumları (ajanda araçları ve araç öncesi kancası; docs/SERVIS.md \"Claude Code oturumları\"):",
  "  eslestir --claude-code            Yeni ajanda anahtarı üretir (öncekini geçersiz kılar), kayıt komutlarını yazar.",
  "  eslestir --claude-code --liste    Anahtar geçmişini ve anahtar dosyasının durumunu gösterir.",
  "  eslestir --claude-code --kaldir   Anahtarı geçersiz kılar ve dosyasını siler (PC oturumları ajandaya erişemez).",
  "  eslestir --claude-code --teshis   Kanca kurulumunu, son PC kanca olaylarını ve tur kararlarını gösterir (metin yok).",
  "  eslestir --claude-code --yonerge  Kayıt komutlarını yazar; anahtara dokunmaz.",
  "",
  "PC ajanları (harness'lar; docs/HARNESS.md 4.3):",
  "  eslestir --pc-ajan <ad> [--liste | --kaldir | --teshis | --yonerge]",
  "      Yukarıdakilerin aynısı, adı verilen PC ajanı için. Geçerli adlar: claude-code, codex.",
  "      --claude-code, --pc-ajan claude-code'un kısa adıdır (çıktısı aynı); ikisi birlikte verilmez.",
  "      Ajanda anahtarı bütün PC ajanlarında ortaktır: hangi adla üretilse ya da kaldırılsa hepsini etkiler.",
  "      Ada göre değişen kayıt yönergesi ve kanca teşhisidir. Bilinmeyen ad geçerli adlarla reddedilir.",
  "      codex (Codex CLI) yalnız taslaktır: kanca kurulmaz, Codex'ten gelen kayıtlar telefondan onaylanır.",
].join("\n");

/**
 * PC ailesinin komutları. `ajan` yalnız `claude-code` dışındaki bir ad verilince bulunur (henüz doğrulanmamış;
 * `pcAjanSec`); yoksa ajan `claude-code`'dur, böylece `--pc-ajan claude-code` ile `--claude-code` aynı komuttur.
 */
export type PcKomutu =
  | { tur: "pc_anahtar"; ajan?: string }
  | { tur: "pc_liste"; ajan?: string }
  | { tur: "pc_kaldir"; ajan?: string }
  | { tur: "pc_teshis"; ajan?: string }
  /** Yalnız kayıt yönergesi: anahtara, dosyasına ve depoya dokunmaz. */
  | { tur: "pc_yonerge"; ajan?: string };

/** PC ailesinin komutu mu (`pcKomutu`'na gider). */
const pcKomutuMu = (k: EslestirKomutu): k is PcKomutu =>
  k.tur === "pc_anahtar" || k.tur === "pc_liste" || k.tur === "pc_kaldir" || k.tur === "pc_teshis" || k.tur === "pc_yonerge";

/** `kapsam` yalnız `--ajanda` verilince bulunur; yoksa komut bugünkü (sohbet) davranışındadır. */
export type EslestirKomutu =
  | { tur: "kod"; kapsam?: "ajanda" }
  | { tur: "liste"; kapsam?: "ajanda" }
  | { tur: "kaldir"; device_id: string; kapsam?: "ajanda" }
  | PcKomutu
  | { tur: "yardim" }
  | { tur: "hata"; ileti: string };

const YARDIM_SECENEKLERI: readonly string[] = ["-h", "--help", "--yardim"];

const PC_ALT_KOMUTLARI = ["--liste", "--kaldir", "--teshis", "--yonerge"] as const;
const CLAUDE_CODE_SECENEGI = "--claude-code";
const PC_AJAN_SECENEGI = "--pc-ajan";
/** `--claude-code`'un ve kurulum dizini yokken bile bilinen tek ajanın adı. */
export const VARSAYILAN_PC_AJANI = "claude-code";

/**
 * PC ailesinin seçenekleri: `--claude-code` ya da `--pc-ajan <ad>` (biri, bir kez; ikisi birlikte hata),
 * üstüne en çok biri `--liste`, (değersiz) `--kaldir`, `--teshis` ya da `--yonerge`, bir kez. `--claude-code` verilince
 * hata iletileri bugünküdür. Ad burada yalnız biçimce denetlenir; kapalı listeye karşı `pcAjanSec` denetler.
 */
function pcArgumanCoz(argv: readonly string[]): EslestirKomutu {
  const aile = argv.includes(CLAUDE_CODE_SECENEGI) ? CLAUDE_CODE_SECENEGI : PC_AJAN_SECENEGI;
  const birlikte = `${CLAUDE_CODE_SECENEGI} ve ${PC_AJAN_SECENEGI} birlikte verilmez (${CLAUDE_CODE_SECENEGI}, ${PC_AJAN_SECENEGI} ${VARSAYILAN_PC_AJANI}'un kısa adıdır)`;
  const gorulen = new Set<string>();
  let ajan: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (YARDIM_SECENEKLERI.includes(a)) return { tur: "yardim" };
    if (a === PC_AJAN_SECENEGI) {
      if (gorulen.has(CLAUDE_CODE_SECENEGI)) return { tur: "hata", ileti: birlikte };
      if (gorulen.has(a)) return { tur: "hata", ileti: `${a} bir kez verilir` };
      const ad = argv[i + 1];
      if (ad !== undefined && YARDIM_SECENEKLERI.includes(ad)) return { tur: "yardim" };
      if (ad === undefined || ad.trim() === "" || ad.startsWith("-")) {
        return { tur: "hata", ileti: `${PC_AJAN_SECENEGI} bir ajan adı ister (ör. ${PC_AJAN_SECENEGI} ${VARSAYILAN_PC_AJANI})` };
      }
      gorulen.add(a);
      ajan = ad;
      i++;
      continue;
    }
    if (a === CLAUDE_CODE_SECENEGI && gorulen.has(PC_AJAN_SECENEGI)) return { tur: "hata", ileti: birlikte };
    if (a !== CLAUDE_CODE_SECENEGI && !(PC_ALT_KOMUTLARI as readonly string[]).includes(a)) {
      return { tur: "hata", ileti: `${aile} ile kullanılamaz: ${gorunur(a)}` };
    }
    if (gorulen.has(a)) return { tur: "hata", ileti: `${a} bir kez verilir` };
    gorulen.add(a);
  }
  const alt = PC_ALT_KOMUTLARI.filter((k) => gorulen.has(k));
  if (alt.length > 1) return { tur: "hata", ileti: `${alt.join(" ve ")} birlikte verilmez` };
  const ek = ajan === undefined || ajan === VARSAYILAN_PC_AJANI ? {} : { ajan };
  if (gorulen.has("--liste")) return { tur: "pc_liste", ...ek };
  if (gorulen.has("--kaldir")) return { tur: "pc_kaldir", ...ek };
  if (gorulen.has("--teshis")) return { tur: "pc_teshis", ...ek };
  if (gorulen.has("--yonerge")) return { tur: "pc_yonerge", ...ek };
  return { tur: "pc_anahtar", ...ek };
}

/**
 * Seçenekler herhangi bir sırada; `--kaldir`'ın hemen ardından kimlik gelir. Hata: bilinmeyen seçenek,
 * yinelenen `--ajanda`, `--liste` ile `--kaldir` birlikte, eksik ya da fazla değer. `--claude-code` ve
 * `--pc-ajan <ad>` ayrı bir komut ailesidir (`pcArgumanCoz`): `--kaldir` orada değer almaz, `--ajanda` ile
 * birleşmez.
 */
export function argumanCoz(argv: readonly string[]): EslestirKomutu {
  if (argv.includes(CLAUDE_CODE_SECENEGI) || argv.includes(PC_AJAN_SECENEGI)) return pcArgumanCoz(argv);
  let ajanda = false;
  let eylem: { tur: "liste" } | { tur: "kaldir"; device_id: string } | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (YARDIM_SECENEKLERI.includes(a)) return { tur: "yardim" };
    if (a === "--ajanda") {
      if (ajanda) return { tur: "hata", ileti: "--ajanda bir kez verilir" };
      ajanda = true;
      continue;
    }
    if (a === "--liste" || a === "--kaldir") {
      if (eylem !== null) return { tur: "hata", ileti: "--liste ve --kaldir birlikte ya da iki kez verilmez" };
      if (a === "--liste") {
        eylem = { tur: "liste" };
        continue;
      }
      const id = argv[i + 1];
      if (id === undefined || id.trim() === "" || id.startsWith("--")) return { tur: "hata", ileti: "--kaldir bir cihaz kimliği ister" };
      eylem = { tur: "kaldir", device_id: id };
      i++;
      continue;
    }
    if (!a.startsWith("-") && eylem?.tur === "liste") return { tur: "hata", ileti: "--liste ek değer almaz" };
    if (!a.startsWith("-") && eylem?.tur === "kaldir") return { tur: "hata", ileti: "--kaldir tek kimlik alır" };
    return { tur: "hata", ileti: `bilinmeyen seçenek: ${gorunur(a)}` };
  }
  const kapsam = ajanda ? { kapsam: "ajanda" as const } : {};
  if (eylem === null) return { tur: "kod", ...kapsam };
  return { ...eylem, ...kapsam };
}

/** Telefonun yolladığı etiket ve kullanıcı girdisi terminale tek satır, kaçırılmış gider. */
const gorunur = (metin: string): string => kacir(metin, AZAMI_GORUNEN);

/** Yerel saatle `YYYY-AA-GG SS:DD`. */
export function yerelZaman(ms: number): string {
  const t = new Date(ms);
  const iki = (n: number): string => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${iki(t.getMonth() + 1)}-${iki(t.getDate())} ${iki(t.getHours())}:${iki(t.getMinutes())}`;
}

const kapsamOf = (e: Pick<EslesmeOzeti, "kapsam">): CihazKapsami => e.kapsam ?? ESKI_CIHAZ_KAPSAMI;

/** Sohbet cihazının satırı bugünküyle bayt bayt aynı; ajanda cihazına sonda `[ajanda]` eklenir. */
const satir = (e: EslesmeOzeti, zaman: (ms: number) => string): string => {
  const etiket = e.etiket === null ? "-" : `"${gorunur(e.etiket)}"`;
  const iptal = e.iptal_ms === null ? "" : `  kaldırıldı ${zaman(e.iptal_ms)}`;
  const kapsam = kapsamOf(e) === "ajanda" ? "  [ajanda]" : "";
  return `  ${e.device_id}  ${e.platform}  ${etiket}  eşleşme ${zaman(e.eslesme_ms)}${iptal}${kapsam}`;
};

/**
 * Liste çıktısı. Açık anahtar ve IP `EslesmeOzeti`'nde yoktur, burada da yazılmaz. Son görülme
 * tutulmuyor: sütun yok. `kapsam: "ajanda"` verilirse yalnız ajanda cihazları, kendi başlıklarıyla.
 */
export function listeMetni(
  liste: readonly EslesmeOzeti[],
  zaman: (ms: number) => string = yerelZaman,
  kapsam?: "ajanda",
): string {
  const secili = kapsam === undefined ? liste : liste.filter((e) => kapsamOf(e) === kapsam);
  const etkin = secili.filter((e) => e.iptal_ms === null);
  const kaldirilmis = secili.filter((e) => e.iptal_ms !== null);
  const baslik = kapsam === undefined ? "Eşleşmiş cihazlar" : "Eşleşmiş ajanda cihazları";
  const parcalar = [`${baslik} (${etkin.length}):`];
  if (etkin.length === 0) parcalar.push("  (yok)");
  for (const e of etkin) parcalar.push(satir(e, zaman));
  if (kaldirilmis.length > 0) {
    const ad = kapsam === undefined ? "Kaldırılmış" : "Kaldırılmış ajanda cihazları";
    parcalar.push(`${ad} (${kaldirilmis.length}; yetkisi yok, geçmişi durur):`);
    for (const e of kaldirilmis) parcalar.push(satir(e, zaman));
  }
  return `${parcalar.join("\n")}\n`;
}

export interface KomutCiktisi {
  kod: number;
  cikti: string;
  hata: string;
}

/**
 * `--kaldir`: yeni kaldırma ve zaten kaldırılmış 0, bilinmeyen kimlik 1. Kapsamsız çağrı her iki
 * kapsamda kaldırır (depo yapar). `kapsam: "ajanda"` (`--ajanda --kaldir`) yalnız ajanda cihazını
 * kaldırır: kimlik sohbet cihazınınsa hiçbir şey değişmez, 1 döner. Sohbet cihazının metinleri bugünkü.
 */
export function cihazKaldirKomutu(
  depo: Pick<CihazYonetimi, "cihazKaldir" | "eslesmeler">,
  device_id: string,
  zaman: (ms: number) => string = yerelZaman,
  kapsam?: "ajanda",
): KomutCiktisi {
  const id = gorunur(device_id);
  const onceki = depo.eslesmeler().find((e) => e.device_id === device_id);
  const cihazKapsami = onceki === undefined ? null : kapsamOf(onceki);
  if (kapsam !== undefined && cihazKapsami !== null && cihazKapsami !== kapsam) {
    return {
      kod: 1,
      cikti: "",
      hata: `Bu kimlik ajanda cihazı değil (${cihazKapsami} cihazı), kaldırılmadı: ${id}\nSohbet cihazını kaldırmak için --ajanda olmadan: eslestir --kaldir <kimlik>\n`,
    };
  }
  const ajanda = cihazKapsami === "ajanda";
  const s = kapsam !== undefined && cihazKapsami === null ? ({ sonuc: "bulunamadi" } as const) : depo.cihazKaldir(device_id);
  switch (s.sonuc) {
    case "kaldirildi":
      return {
        kod: 0,
        cikti:
          `Eşleşme kaldırıldı: ${id}${ajanda ? " (ajanda)" : ""}\n` +
          `Bu kimlikle yeni bağlantı kabul edilmez; servis çalışıyorsa açık bağlantıları en geç ${KAPANIS_SURESI_SN} sn içinde kapanır.\n` +
          (ajanda
            ? "Ajanda uygulamasını yeniden kullanmak için yeni eşleştirme gerekir: eslestir --ajanda (yeni kimlik).\n"
            : "Telefonu yeniden kullanmak için yeni eşleştirme gerekir (yeni kimlik).\n"),
        hata: "",
      };
    case "zaten_kaldirilmis":
      return { kod: 0, cikti: `Eşleşme zaten kaldırılmış: ${id}${ajanda ? " (ajanda)" : ""} (${zaman(s.iptal_ms)})\n`, hata: "" };
    case "bulunamadi":
      return {
        kod: 1,
        cikti: "",
        hata: `${kapsam === undefined ? "Cihaz" : "Ajanda cihazı"} bulunamadı: ${id}\nKimlikleri görmek için: eslestir ${kapsam === undefined ? "" : "--ajanda "}--liste\n`,
      };
  }
}

/**
 * Kod üretiminin terminal çıktısı. İlk satır QR verisi (tek satır JSON; uygulama bunu okur), sonra
 * parmak izi ve kısa kod. Sohbet çıktısı bugünküyle aynıdır. Ajandada sonda kapsam satırı; öteki
 * kapsamın hâlâ süresi dolmamış penceresi kapandıysa (tek pencere) bir not satırı.
 */
export function kodMetni(
  s: { qr: { server_public_key: string }; kod: string; sonMs: number },
  g: { simdiMs: number; kapsam?: "ajanda"; oncekiPencere?: Pick<EslestirmeKaydi, "son_ms" | "kapsam"> | null },
): string {
  const dakika = Math.round((s.sonMs - g.simdiMs) / 60000);
  const satirlar = [
    JSON.stringify(s.qr),
    `Parmak izi: ${parmakIzi(s.qr.server_public_key)}`,
    `Kod:${s.kod}  (${dakika} dakika geçerli, tek kullanımlık)`,
  ];
  if (g.kapsam === "ajanda") {
    satirlar.push("Kapsam: ajanda (yalnız ajanda uygulamasıyla eşleşir; sohbet kanalını açamaz).");
  }
  const o = g.oncekiPencere;
  const yeniKapsam: CihazKapsami = g.kapsam ?? ESKI_CIHAZ_KAPSAMI;
  if (o !== undefined && o !== null && o.son_ms > g.simdiMs && (o.kapsam ?? ESKI_CIHAZ_KAPSAMI) !== yeniKapsam) {
    satirlar.push(`Not: açık ${o.kapsam ?? ESKI_CIHAZ_KAPSAMI} eşleştirme penceresi kapandı (aynı anda tek pencere).`);
  }
  return `${satirlar.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// PC ajanlarının oturumları (`--pc-ajan <ad>`, eski adıyla `--claude-code`; AJANDA.md "PC oturumları",
// HARNESS.md 4.3). Saf parçalar test edilir.
// Düz anahtar yalnız anahtar dosyasına yazılır: terminale, günlüğe ve depoya girmez (depoda özeti).
// ---------------------------------------------------------------------------------------------

/** Kullanıcının Claude Code'una kayıtlı MCP sunucusunun adı; araçlar `mcp__eren-ajanda__<fiil>`. */
export const CLAUDE_CODE_MCP_ADI = AJANDA_PC_MCP_ADI;

/**
 * Yeni PC anahtarı: güvenli üreteçten jeton, depoya özeti (öncekiler aynı işlemde iptal). Dosyaya yazmak
 * çağıranındır; yazılamazsa çağıran `ajandaPcAnahtarlariniIptalEt` ile yeni anahtarı da geçersiz kılar.
 */
export function pcAnahtariUret(b: {
  depo: { ajandaPcAnahtariYaz(ozet: string, ms: number): void };
  rastgele: { jeton(): string };
  saat: { simdiMs(): number };
}): { jeton: string; ozet: string } {
  const jeton = b.rastgele.jeton();
  const ozet = sha256Hex(utf8Bayt(jeton));
  b.depo.ajandaPcAnahtariYaz(ozet, b.saat.simdiMs());
  return { jeton, ozet };
}

/** Anahtar dosyasının yeri (terminal çıktıları için). */
export interface ClaudeCodeYollari {
  anahtarDosyasi: string;
}

/**
 * Kayıt yönergesinin TEK kaynağı ajanın uyarlayıcısıdır (Claude Code: `kurulum/harness/claude-code.ts`,
 * `kurulum/claude-code.ts` üzerinden de; `kayitYonergesi`): `claude mcp add` komutu
 * ve kanca komutları oradaki `yollar`'dan, yani veri kökünden (`<veri kökü>\uygulama\guncel\...`) türer.
 * Bu dosyanın kendi yolu (`import.meta`) yazılan hiçbir yola girmez: servis `guncel` bağlantısından
 * çalışırken Node bu dosyayı `surumler\<sürüm>\...` gerçek yoluna çevirir; o yol bir sonraki güncellemede
 * eskir ve eski sürüm silinince kırılırdı. Burada yalnız kod yüklenir (aynı sürümün `kurulum` dizini).
 */
export interface KayitYonergesiModulu {
  kayitYonergesi(ortam: Readonly<Record<string, string | undefined>>, nodeExe: string): string;
  /** Kullanıcı ayarındaki kanca durumu (`--teshis`; yalnız okur). */
  kancaDurumu(ortam: Readonly<Record<string, string | undefined>>): ClaudeCodeKancaDurumu;
}

/**
 * Kullanıcının Claude Code ayarında (`~/.claude/settings.json`) bu aracın kancaları: `arac` araç öncesi
 * kancası (`PreToolUse`, `mcp__eren-ajanda__.*`) kurulu mu (`null`: ayar okunamadı, `hata` nedeni); `eski`
 * önceki kurulumun artık kullanılmayan kancaları (istem, tur sonu, eski biçim); `kabuk` kurulu araç
 * kancalarından kaçı kabuk biçiminde (Git Bash'e bağlı); `kapatan` kancaları kapatan, okunabilen ayarlar
 * (`disableAllHooks`, `allowManagedHooksOnly`). `kurulum/claude-code.ts` üretir; yeni alanlar isteğe bağlıdır.
 */
export interface ClaudeCodeKancaDurumu {
  ayarYolu: string;
  arac: boolean | null;
  eski: number;
  kabuk?: number;
  kapatan?: readonly string[];
  hata?: string;
}

/**
 * Bir PC ajanı uyarlayıcısının eslestir'in kullandığı yüzü (`kurulum/harness/tur.ts` `PcAjani`'nin alt kümesi;
 * yapısal, kurulum modülü tip olarak içe aktarılmaz). Kancalı ajanda `kancaDurumu` vardır; yalnız taslak ajanda
 * (`TaslakPcAjani`) yoktur, onun yerine `taslakNedeni` vardır.
 */
export interface PcAjaniModulu {
  readonly ad: string;
  /** Kullanıcıya görünen ad (ör. "Claude Code"). */
  readonly gorunenAd: string;
  kayitYonergesi(ortam: Readonly<Record<string, string | undefined>>, nodeExe: string): string;
  /** Kullanıcı ayarındaki kanca durumu (`--teshis`; yalnız okur). Yalnız taslak ajanda yok. */
  kancaDurumu?(ortam: Readonly<Record<string, string | undefined>>): ClaudeCodeKancaDurumu;
  /** Yalnız taslak ajan (T6): kayıtların neden hep taslak doğduğu. */
  readonly taslakNedeni?: string;
}

/** `kurulum/harness/tur.ts`: kapalı ad listesi ve adla uyarlayıcı (`null`: listede yok). */
export interface PcAjanKaydi {
  readonly PC_AJAN_ADLARI: readonly string[];
  pcAjani(ad: string): PcAjaniModulu | null;
}

/**
 * Aynı sürümün kurulum dizini (kur.ts `kurulum`'u alt dizinleriyle sürüme kopyalar; depoda da aynı göreli
 * yer). Yalnız kod yüklemek için; hiçbir komut yoluna girmez.
 */
const KURULUM_DIZINI = new URL("../../kurulum/", import.meta.url);

/** Uyarlayıcı kaydı (`kurulum/harness/tur.ts`); kurulum dizini yoksa atar. */
export const pcAjanKaydiYukle = async (): Promise<PcAjanKaydi> =>
  (await import(new URL("harness/tur.ts", KURULUM_DIZINI).href)) as PcAjanKaydi;

/**
 * Claude Code uyarlayıcısı, kayıttan (`kurulum/harness/claude-code.ts`; `kurulum/claude-code.ts` aynı işlevleri
 * yeniden dışa verir). Geri uyum için kalır; komut `pcAjanKaydiYukle` + `pcAjanSec` kullanır.
 */
export const kayitYonergesiYukle = async (): Promise<KayitYonergesiModulu> => {
  const ajan = (await pcAjanKaydiYukle()).pcAjani(VARSAYILAN_PC_AJANI);
  if (ajan === null || ajan.kancaDurumu === undefined) throw new Error(`${VARSAYILAN_PC_AJANI} uyarlayıcısı kayıtta yok`);
  return ajan as KayitYonergesiModulu;
};

/**
 * Çıktılarda ajana göre değişen parçalar: ad (seçenek), görünen ad ve yalnız taslak ajanda kayıtların neden hep
 * taslak doğduğu (`taslakNedeni`; kancalı ajanda alan yoktur).
 */
export interface PcAjanGorunumu {
  readonly ad: string;
  readonly gorunenAd: string;
  readonly taslakNedeni?: string;
}

/** Claude Code'un görünümü; kurulum dizini yokken de bilinir ve bugünkü bütün çıktılar bununla yazılır. */
export const CLAUDE_CODE_GORUNUMU: PcAjanGorunumu = { ad: VARSAYILAN_PC_AJANI, gorunenAd: "Claude Code" };

const claudeCodeMu = (g: PcAjanGorunumu): boolean => g.ad === VARSAYILAN_PC_AJANI;

/** Kullanıcıya önerilen seçenek: Claude Code'da belgelerdeki `--claude-code`, ötekilerde `--pc-ajan <ad>`. */
const pcSecenegi = (g: PcAjanGorunumu): string => (claudeCodeMu(g) ? CLAUDE_CODE_SECENEGI : `${PC_AJAN_SECENEGI} ${g.ad}`);

/** Claude Code dışındaki ajanların anahtar çıktılarına eklenir (anahtar ajandan bağımsızdır). */
const ORTAK_ANAHTAR_NOTU = "  Bu anahtar bütün PC ajanlarında ortaktır: yenilemek ya da kaldırmak hepsini etkiler.";

/**
 * Verilen adın uyarlayıcısı (saf). `kayit` `null` ise kurulum dizini yüklenemedi: yalnız `claude-code` geçer
 * (uyarlayıcısız; çağıran bugünkü yedek metinleri yazar). Ad kapalı listede değilse açık ileti, geçerli adlarla.
 */
export function pcAjanSec(
  ad: string,
  kayit: PcAjanKaydi | null,
): { ok: true; ajan: PcAjaniModulu | null; gorunum: PcAjanGorunumu } | { ok: false; ileti: string } {
  if (kayit === null) {
    if (ad === VARSAYILAN_PC_AJANI) return { ok: true, ajan: null, gorunum: CLAUDE_CODE_GORUNUMU };
    return {
      ok: false,
      ileti: `bilinmeyen PC ajanı: ${gorunur(ad)} (uyarlayıcılar yüklenemedi: kurulum dizini yok; geçerli ad: ${VARSAYILAN_PC_AJANI})`,
    };
  }
  const ajan = kayit.pcAjani(ad);
  if (ajan === null) return { ok: false, ileti: `bilinmeyen PC ajanı: ${gorunur(ad)} (geçerli adlar: ${kayit.PC_AJAN_ADLARI.join(", ")})` };
  const taslak = typeof ajan.taslakNedeni === "string" && ajan.taslakNedeni !== "" ? { taslakNedeni: ajan.taslakNedeni } : {};
  return { ok: true, ajan, gorunum: { ad: ajan.ad, gorunenAd: ajan.gorunenAd, ...taslak } };
}

/** Yalnız taslak ajanın görünümü mü (kancasız; kayıtları her zaman taslak). */
const yalnizTaslakMi = (g: PcAjanGorunumu): g is PcAjanGorunumu & { taslakNedeni: string } =>
  typeof g.taslakNedeni === "string" && g.taslakNedeni !== "";

/** Yönerge yüklenemezse (kurulum dizini yok): elle nereye bakılacağı. */
export const KAYIT_YONERGESI_YEDEK =
  "Kayıt komutları için: node --disable-warning=ExperimentalWarning kurulum\\claude-code.ts goster (docs/SERVIS.md \"Claude Code oturumları\").\n";

/** Ajanın yönergesi üretilemezse yazılan satır; Claude Code'da bugünkü `KAYIT_YONERGESI_YEDEK`. */
export const kayitYonergesiYedegi = (g: PcAjanGorunumu): string =>
  claudeCodeMu(g) ? KAYIT_YONERGESI_YEDEK : `${g.gorunenAd} kayıt yönergesi üretilemedi; uyarlayıcı: kurulum\\harness (docs/HARNESS.md 4.3).\n`;

/**
 * `--yonerge` çıktısı: anahtarın değişmediğini söyleyen baş satır, sonra uyarlayıcının yönergesi olduğu gibi.
 * Anahtar yoksa köprü bağlanamaz; nasıl bakılacağı ve üretileceği yazılır (üretmek öncekini geçersiz kılar).
 */
export function pcYonergeMetni(yonerge: string, ajan: PcAjanGorunumu = CLAUDE_CODE_GORUNUMU): string {
  const s = pcSecenegi(ajan);
  return (
    `${ajan.gorunenAd} kayıt yönergesi. Ajanda anahtarı üretilmedi, değişmedi (durum: eslestir ${s} --liste; ` +
    `anahtar yoksa: eslestir ${s}, bu öncekini geçersiz kılar).\n\n${yonerge}`
  );
}

/**
 * Anahtar üretiminin terminal çıktısı: ne değişti, dosya nerede, ve kayıt yönergesi (uyarlayıcının
 * `kayitYonergesi` metni, olduğu gibi). Anahtarın kendisi yok. `ajan` verilmezse Claude Code (bugünkü metin).
 */
export function pcAnahtarMetni(
  y: ClaudeCodeYollari,
  oncekiEtkin: number,
  yonerge: string,
  ajan: PcAjanGorunumu = CLAUDE_CODE_GORUNUMU,
): string {
  const satirlar = [
    `${ajan.gorunenAd} ajanda anahtarı üretildi${oncekiEtkin > 0 ? " (önceki anahtar artık geçersiz; açık PC oturumları yeni dosyayı kendiliğinden okur)" : ""}.`,
    `Anahtar dosyası: ${y.anahtarDosyasi}`,
    `  Yalnız bu Windows kullanıcısı okuyabilir (veri kökü). İçeriğini hiçbir yere yapıştırmayın; sızarsa: eslestir ${pcSecenegi(ajan)} (yeniler).`,
    ...(claudeCodeMu(ajan) ? [] : [ORTAK_ANAHTAR_NOTU]),
    "",
  ];
  return `${satirlar.join("\n")}\n${yonerge}`;
}

// --- `--claude-code --teshis`: servis günlüğünden PC kararları (içerik yok) ---------------------

/** Teşhiste gösterilen olaylar ve YALNIZ bu alanlar (izin listesi: başka alan hiç yazılmaz). */
const TESHIS_ALANLARI: Readonly<Record<string, readonly string[]>> = {
  // Yeni alanlar (`uyarlayici` … `cerceve`) eski kayıtlarda yoktur; olmayan alan yazılmaz, eski satır aynı kalır.
  // `surec_kimligi` kimliğin kendisi değil, yalnız `var`/`yok`'tur (ajanda-pc `varYok`).
  pc_arac: ["alt_agent", "etkilesimsiz", "istem_kimligi", "uyarlayici", "aktor", "etkilesim", "surec_kimligi", "cerceve"],
  // `arac.uyarlayici`: köprünün hello'da bildirdiği PC ajanı (9ce01ff); bildirmeyen köprünün satırında yoktur.
  arac: ["fiil", "tur_kokeni", "pc_karar", "cagri_kimligi", "sonuc", "neden", "uyarlayici"],
  // `tasdik_yok` kararının kanca kurulumu dışındaki nedenleri (ajanda-pc `kararVer`; `arac`'tan hemen önce yazılır).
  pc_tasdik_yetersiz: ["neden", "uyarlayici", "surum"],
  // `pc_oturum_uyusmuyor`: eski servis sürümünün T5 olayı (eski günlükte görünür, gösterimi değişmedi).
  pc_oturum_uyusmuyor: ["surec_kimligi"],
  pc_surec_uyusmuyor: ["kopru_surec"],
  // Süreç bildirmeyen köprü bağlantısı ilk süreç kimlikli tasdikini (süreç denetimsiz) tüketti; bağlantı başına bir
  // kez, bağlanırken değil. Hiç böyle tasdik tüketmeyen süreçsiz bağlantı iz bırakmaz.
  pc_kopru_surecsiz: [],
  el_sikisma: ["rol"],
  el_sikisma_ret: ["rol", "code", "neden"],
};

/**
 * Son kararın kullanıcıya açıklaması (`PC_TUR_KARARLARI`). Sentetik kararların hepsinde kayıt taslak
 * doğar; alt agent ve etkileşimsiz oturum için bu beklenen davranıştır, öteki ikisi kurulum sorunudur.
 * Çağrının ajanı bilinmediği (günlük ajanı ayırmıyor) Claude Code görünümünün metinleridir: `cagri_kimligi_yok`
 * başka bir PC ajanından (yalnız taslak ajanın köprüsü çağrı kimliği hiç göndermez) da gelebilir. Ajanı
 * `claude-code` diye bilinen çağrıda o karar `CLAUDE_CAGRI_KIMLIGI_YOK_METNI` ile söylenir.
 */
export const TESHIS_KARAR_METNI: Readonly<Record<PcTurKarari, string>> = {
  insan: "ana oturumun çağrısı; kayıt doğrudan (taslaksız) yazıldı. Kurulum doğru.",
  cagri_kimligi_yok:
    "kayıtlar TASLAK doğuyor: Claude Code çağrı kimliğini MCP isteğinde göndermiyor (sürüm farkı) ya da çağrı başka bir " +
    "PC ajanından (ör. Codex CLI çağrı kimliğini hiç göndermez; onun için beklenen); bu günlük çağrının ajanını göstermiyor. " +
    "Claude Code'unsa kanca bunu düzeltemez, kayıtları uygulamadan onaylayın.",
  tasdik_yok:
    "kayıtlar TASLAK doğuyor: araç öncesi kanca bu çağrıyı servise bildirmedi. Kanca kurulu değilse kurun " +
    "(kurulum\\claude-code.ts kanca-ekle) ve Claude Code'u yeniden açın; kuruluysa servis o an yanıt vermemiş, " +
    "izin sorusu uzun beklemiş ya da servis arada yeniden başlamış olabilir.",
  alt_agent: "son çağrı bir alt agent'tandı; alt agent'ın kaydı her zaman taslaktır (beklenen).",
  etkilesimsiz: "son çağrı -p ya da Agent SDK oturumundandı; kaydı taslaktır (beklenen).",
};

/** Ajanı `claude-code` diye bilinen çağrının `cagri_kimligi_yok`'u (köprü hello'da `uyarlayici` bildirdi). */
export const CLAUDE_CAGRI_KIMLIGI_YOK_METNI =
  "kayıtlar TASLAK doğuyor: Claude Code çağrı kimliğini MCP isteğinde göndermiyor (sürüm farkı); kanca bunu düzeltemez, " +
  "kayıtları uygulamadan onaylayın.";
const TESHIS_MODULLERI: ReadonlySet<string> = new Set(["ajanda", "ajanda-kopru-sunucu"]);
const TESHIS_SATIR = 40;
/** Alan değerleri kapalı listelerden gelir; yine de yalnız bu kalıba uyan değer yazılır. */
const TESHIS_DEGERI = /^[A-Za-z0-9_-]{1,40}$/;

const teshisDegeri = (v: unknown): string | null => {
  if (typeof v === "boolean") return v ? "evet" : "hayir";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && TESHIS_DEGERI.test(v) ? v : null;
};

/** Oturum kimliğinin yalnız son 6 karakteri (satırları eşlemeye yeter). */
const kisaOturum = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(v) ? `…${v.slice(-6)}` : null);

const KANCA_EKLE_KOMUTU = "node --disable-warning=ExperimentalWarning kurulum\\claude-code.ts kanca-ekle";

/** Kanca bağlantısının el sıkışma reddi (`ajanda-kopru-sunucu`) → kullanıcıya nedeni. */
const KANCA_RET_NEDENI: Readonly<Record<string, string>> = {
  pc_kanca_siniri: `servis kanca bağlantılarını sınırda reddetti (aynı anda ${AJANDA_PC_SINIRLARI.KANCA_BAGLANTI_ADET}'ten çok kanca)`,
  pc_baglanti_siniri: "servisin PC bağlantı sınırı doluydu (çok açık oturum; eski servis sürümünde köprüler ve kancalar aynı sınırı paylaşır)",
  pc_anahtar_gecersiz:
    "kancanın okuduğu anahtar servistekiyle uyuşmuyor (anahtar az önce yenilendi mi; Claude Code başka bir veri kökünü mü görüyor: EREN_KIT_DATA_DIR)",
  pc_kapali: "servis PC oturumları kapalı açıldı",
};

/**
 * Kanca ayarda kurulu görünürken son çağrı tasdiksiz (`tasdik_yok`) kaldıysa olası nedenler, günlükte
 * görülenden başlayarak. Ayar dosyası kurulu demek kancanın çalıştığını göstermez.
 */
type TeshisOlayi = { olay: string; alanlar: Record<string, string> };

/** Günlükteki kanca bağlantısı retlerinin kullanıcıya nedenleri (tekilleştirilmiş). */
const kancaRetNedenleri = (olaylar: readonly TeshisOlayi[]): string[] =>
  [...new Set(olaylar.filter((o) => o.olay === "el_sikisma_ret" && o.alanlar["rol"] === "pc_kanca").map((o) => o.alanlar["neden"] ?? "bilinmiyor"))].map(
    (r) => `günlükte kanca reddi: ${KANCA_RET_NEDENI[r] ?? r}`,
  );

/** Tasdik geldi ama karar yine `tasdik_yok`: servisin günlüğe yazdığı neden olayları (ajanda-pc `kararVer`). */
const TASDIK_REDDI_OLAYLARI: ReadonlySet<string> = new Set(["pc_tasdik_yetersiz", "pc_oturum_uyusmuyor", "pc_surec_uyusmuyor"]);

/** Süreç bildirmeyen köprünün (`pc_kopru_surecsiz`, `ilk_gorus`) kullanıcıya önerisi. */
const SURECSIZ_COZUM = "Tam koruma için Claude Code penceresini yeniden açın ya da /mcp ile yeniden bağlayın.";

/**
 * Günlükte süreç bildirmeyen köprü bağlantısı görüldüyse (`pc_kopru_surecsiz`, ajanda-pc `surecUyusmazligi`) uyarı
 * satırları; yoksa boş (eski günlükte bu olay yoktur, çıktı değişmez). Olay bağlanma anı değildir: süreçsiz bağlantı
 * ilk süreç kimlikli tasdikini tüketirken bir kez yazılır. Bağlantının hâlâ açık olduğunu göstermez; yokluğu da
 * düzeldiğini kanıtlamaz (aynı bağlantı ikinci kez yazmaz, tasdik tüketmeyen bağlantı hiç yazmaz). "Eski sürüm" kesin
 * denmez ve yeniden açmanın düzelttiği vaat edilmez: güncel köprü de uyumluluk düşüşünde süreç bildirmeden bağlanabilir
 * ve düşüş yeni bağlantıda yinelenebilir.
 */
function surecsizKopruSatirlari(olaylar: ReadonlyArray<TeshisOlayi & { oturum: string | null; ts: number }>, zaman: (ms: number) => string): string[] {
  const goruldu = olaylar.filter((o) => o.olay === "pc_kopru_surecsiz");
  if (goruldu.length === 0) return [];
  const oturumlar = [...new Set(goruldu.map((o) => o.oturum).filter((v): v is string => v !== null))];
  return [
    `Uyarı: köprü süreç bildirmedi (eski sürüm ya da uyumluluk düşüşü; pc_kopru_surecsiz${oturumlar.length === 0 ? "" : `, oturum ${oturumlar.join(", ")}`}).`,
    `  En son ${zaman(Math.max(...goruldu.map((o) => o.ts)))}'da görüldü. Olay, süreç bildirmeyen bir bağlantı ilk süreç kimlikli tasdikini`,
    "  tüketirken bir kez yazılır: bağlantının hâlâ açık olduğunu göstermez, sonradan görünmemesi de düzeldiğini kanıtlamaz.",
    "  Bu bağlantılarda süreç eşitliği yalnız bağlantı içinde geçerli: her yeniden bağlanmada ilk tasdik süreç denetimsiz",
    `  tüketilir. ${SURECSIZ_COZUM}`,
    "  Servis o an yeniden başlıyorsa ya da eski sürümdeyse düşüş yeni bağlantıda yinelenebilir: servisin güncel ve",
    "  ayakta olduğundan emin olup yeniden deneyin.",
  ];
}

/** Neden olayı ile kendi `arac`'ı arasındaki en uzun süre (aynı eşzamanlı blok; `depo.islem` bekleyebilir). */
const TASDIK_REDDI_ARALIK_MS = 2000;

/**
 * Çağrı izi (ajanda-pc defterinin tuzlu, kısaltılmış tek yönlü özeti). Teşhis onu hesaplamaz, yalnız eşitlik için
 * karşılaştırır; yazmaz. Tuz servis süreci ömrüyle sınırlıdır: servis yeniden başladıysa eski izler yeni `arac`'la
 * eşleşmez, neden sahipsiz kalır (güvenli taraf: kurulum yönlendirmesi, yanlış neden değil).
 */
const CAGRI_IZI = /^[0-9a-f]{12}$/;
const cagriIzi = (v: unknown): string | null => (typeof v === "string" && CAGRI_IZI.test(v) ? v : null);

/**
 * Teşhis modüllerinin günlük satırları sırasıyla: gösterilen olay ya da `null` (gösterilmeyen satır: `arac_hatasi`,
 * `arac_girdisi_gecersiz`, sohbet `arac` …). `iz`: satırın çağrı izi (`cagri_izi`; eski satırda yok).
 */
type TeshisZinciri = ReadonlyArray<(TeshisOlayi & { ts: number; iz?: string | null }) | null>;

/**
 * Son `arac` olayının kendi neden olayları. İzli günlük: son `arac` çağrı izi (`cagri_izi`) taşıyorsa nedenleri
 * yalnız aynı izi taşıyan, ondan önceki ve aynı izli bir önceki `arac`'tan sonraki neden olaylarıdır (aynı çağrı
 * kimliği yeniden sunulduysa önceki sunuşun nedeni sonrakine geçmez); sıra ve süre aranmaz (araya başka çağrı girse
 * de, blok uzasa da), izsiz ya da başka izli (başka çağrı, başka servis süreci) neden sayılmaz. İzsiz `arac` (eski günlük ya da
 * izi yazmayan sürüm) için bugünkü kural: neden olayında çağrı kimliği yoktur (`pc_tasdik_yetersiz` hiç
 * kimlik taşımaz; `pc_oturum_uyusmuyor`'unki tasdikin oturumudur, `arac`'ınki köprününki), eşleme sırayladır:
 * servis nedeni kararla aynı eşzamanlı blokta, `arac`'tan HEMEN önce yazar (araya teşhis modüllerinden satır
 * giremez). Bu yüzden yalnız son `arac`'a bitişik neden olayları sayılır; araya başka herhangi bir satır
 * (`arac_hatasi`, `arac_girdisi_gecersiz`, başka bir çağrının olayı) girdiyse ya da zaman aralığı blok için
 * fazlaysa neden sahipsizdir, söylenmez (kurulum yönlendirmesi kalır). Kullanıcıya nedenleri (tekilleştirilmiş).
 * `secili`: hangi `arac`'ın sayıldığı (teşhisin ajan ayrımı; verilmezse hepsi). Neden olayları ajansızdır, eşleme
 * aynı kalır: yalnız hedef `arac` seçilen ajanın son çağrısıdır.
 */
function tasdikReddiNedenleri(zincir: TeshisZinciri, secili: (o: TeshisOlayi) => boolean = () => true): string[] {
  let son = -1;
  for (let i = zincir.length - 1; i >= 0; i--) {
    const o = zincir[i];
    if (o !== null && o !== undefined && o.olay === "arac" && secili(o)) {
      son = i;
      break;
    }
  }
  if (son < 0) return [];
  const sonArac = zincir[son];
  if (sonArac === null || sonArac === undefined) return [];
  const bulunan: TeshisOlayi[] = [];
  const iz = sonArac.iz ?? null;
  // Neden yalnız kendisinden sonraki ilk aynı izli `arac`'ındır: aynı izli önceki bir `arac`'ta durulur (aynı
  // çağrı kimliği yeniden sunulduysa öncekinin nedeni sonrakine geçmez).
  for (let i = son - 1; iz !== null && i >= 0; i--) {
    const o = zincir[i];
    if (o === null || o === undefined || o.iz !== iz) continue;
    if (o.olay === "arac") break;
    if (TASDIK_REDDI_OLAYLARI.has(o.olay)) bulunan.unshift(o);
  }
  for (let i = son - 1; iz === null && i >= 0; i--) {
    const o = zincir[i];
    if (o === null || o === undefined || !TASDIK_REDDI_OLAYLARI.has(o.olay)) break;
    const fark = sonArac.ts - o.ts;
    if (fark < 0 || fark > TASDIK_REDDI_ARALIK_MS) break;
    bulunan.unshift(o);
  }
  const metinler = bulunan.map((o) => {
    if (o.olay === "pc_oturum_uyusmuyor") {
      return (
        "tasdik başka bir köprüye bağlı (pc_oturum_uyusmuyor): kanca bu çağrıyı bildirdi, ama tasdik onu bildiren " +
        "Claude Code sürecine bağlı başka bir MCP köprüsünün; bu çağrıyı getiren köprü onu kullanamaz (bu çarpışma tasdiki silmez). " +
        "Olası: aynı Claude Code sürecinde MCP köprüsü yeniden başladı (/mcp ile yeniden bağlanma) ya da köprü başka " +
        "bir Claude Code sürecinden açıldı. Bir sonraki çağrıda kendiliğinden düzelir (köprü kapanınca o sürecin bağı " +
        "bırakılır, yeni köprünün sonraki çağrısı doğrudan kayıt olur); sürerse ve iki köprü aynı anda açıksa Claude Code " +
        "penceresini kapatıp yeniden açın. Kanca kurulumu doğru, yeniden kurmak gerekmez."
      );
    }
    if (o.olay === "pc_surec_uyusmuyor") {
      if (o.alanlar["kopru_surec"] === "ilk_gorus") {
        return (
          "süreç bildirmeyen köprü başka bir Claude Code sürecine bağlı (pc_surec_uyusmuyor, ilk_gorus): bu çağrıyı getiren " +
          "MCP köprüsü sürecini bildirmedi (eski sürüm ya da uyumluluk düşüşü); bağlantısı ilk tükettiği tasdikin Claude Code " +
          "sürecine bağlandı, bu tasdik başka bir süreçten (tasdik silinmez, sahibine kalır). Böyle bir köprüde süreç " +
          `eşitliği yalnız bağlantı içinde geçerlidir: her yeniden bağlanmada ilk tasdik süreç denetimsiz tüketilir. ${SURECSIZ_COZUM} ` +
          "Kanca kurulumu doğru, yeniden kurmak gerekmez."
        );
      }
      return (
        "köprünün ebeveyni harness süreci değil (pc_surec_uyusmuyor): kanca bu çağrıyı bildirdi, ama çağrıyı getiren MCP " +
        "köprüsünün ebeveyni (hello'da bildirdiği süreç) tasdiki veren Claude Code süreci değil; tasdik kullanılmadı " +
        "(silinmez, sahibine kalır). Olası: köprü bir sarmalayıcıyla başlatılıyor (cmd /c, npx, sh -c): MCP kaydını " +
        "sarmalayıcısız yapın (kurulum\\claude-code.ts goster); ya da köprü başka bir Claude Code sürecinin. Sarmalayıcı " +
        "durdukça bu pencerenin bütün kayıtları taslak doğar (güvenli taraf). Kanca kurulumu doğru, yeniden kurmak gerekmez."
      );
    }
    const neden = o.alanlar["neden"];
    if (neden === "uyarlayici") {
      const ad = o.alanlar["uyarlayici"] ?? "?";
      const surum = o.alanlar["surum"] ?? "?";
      return (
        `tasdik yetersiz (pc_tasdik_yetersiz): kanca tasdiki bu servisin tanımadığı bir uyarlayıcıyla ya da sürümle ` +
        `gönderdi (uyarlayici=${ad} surum=${surum}). Kanca ile servis farklı sürümlerden: güncellemeden sonra servis ` +
        "yeniden başlatılmadıysa yeniden başlatın; kanca komutu başka bir kurulumun (ör. geliştirme kopyası) dosyasını " +
        "çalıştırıyorsa ayardaki yolu bu kuruluma çevirin."
      );
    }
    if (neden === "aktor" || neden === "etkilesim") {
      const ne = neden === "aktor" ? "çağrının ana ajandan mı alt agent'tan mı geldiğini (aktor)" : "oturumun etkileşimli olup olmadığını (etkilesim)";
      return (
        `tasdik yetersiz (pc_tasdik_yetersiz): kanca ${ne} "bilinmiyor" bildirdi; ajanın uyarlayıcısı bu bilgiyi ` +
        "veremiyor, güvenli taraf taslaktır. Kanca kurulu ve çalışıyor; kayıtları uygulamadan onaylayın."
      );
    }
    return "tasdik yetersiz (pc_tasdik_yetersiz): servis tasdiki yetersiz buldu; kanca kurulu ve çalışıyor, kayıtları uygulamadan onaylayın.";
  });
  return [...new Set(metinler)];
}

function tasdikYokNedenleri(olaylar: readonly TeshisOlayi[], kurulum: ClaudeCodeKancaDurumu): string[] {
  const nedenler: string[] = [];
  for (const n of kurulum.kapatan ?? []) nedenler.push(`kancaları kapatan ayar: ${n}`);
  nedenler.push(...kancaRetNedenleri(olaylar));
  if (!olaylar.some((o) => o.olay === "pc_arac")) {
    nedenler.push(
      "kanca hiç servise ulaşmadı: Claude Code kanca-ekle'den sonra yeniden açılmadı; ya da proje ayarı " +
        "(<proje>\\.claude\\settings.json, settings.local.json) disableAllHooks ile kancaları kapatıyor; ya da kanca " +
        "komutu çalışamıyor (Node yolu değişti: kanca-ekle yeniden yazar)",
    );
  } else {
    nedenler.push(
      `kanca öteki çağrılarda ulaşıyor; bu çağrıda servis o an yanıt vermedi ya da arada yeniden başladı, ya da izin sorusu ` +
        `${AJANDA_PC_SINIRLARI.TASDIK_OMRU_DK} dakikadan uzun bekledi`,
    );
  }
  return nedenler;
}

/**
 * Kanca kurulumunun satırları (`--teshis`'in başı). `null`: kurulum modülü yüklenemedi. Claude Code'un satırları
 * bugünküdür (olay adı, `kanca-ekle` komutu); öteki ajanlarda olay adı ve kurma komutu yerine kayıt yönergesi
 * gösterilir (uyarlayıcı sözleşmesi bunları henüz vermiyor).
 */
function kurulumSatirlari(k: ClaudeCodeKancaDurumu | null, ajan: PcAjanGorunumu): string[] {
  if (yalnizTaslakMi(ajan)) return taslakKurulumSatirlari(ajan);
  if (k === null) return ["Kurulum: kanca durumu okunamadı (kurulum dizini yok)."];
  const claude = claudeCodeMu(ajan);
  const kanca = claude ? "araç öncesi kanca (PreToolUse, mcp__eren-ajanda__.*)" : "araç öncesi kanca";
  const kur = claude
    ? `Kurmak için: ${KANCA_EKLE_KOMUTU} (sonra Claude Code'u yeniden açın).`
    : `Kurmak için kayıt yönergesine bakın (eslestir ${pcSecenegi(ajan)} --yonerge; sonra ${ajan.gorunenAd} oturumlarını yeniden açın).`;
  const satirlar = [`Kurulum (${k.ayarYolu}):`];
  satirlar.push(
    k.arac === null
      ? `  araç öncesi kanca: ayar dosyası okunamadı (${k.hata ?? "geçerli JSON değil"}).`
      : k.arac
        ? `  ${kanca}: ayarda kurulu.`
        : `  ${kanca}: YOK. Bu durumda bütün kayıtlar taslak doğar. ${kur}`,
  );
  if (!claude) {
    for (const neden of k.kapatan ?? []) {
      satirlar.push(`  UYARI: kancaları kapatan ayar: ${neden}. Bu durdukça kanca hiç çalışmaz, bütün kayıtlar taslak doğar.`);
    }
    if (k.eski > 0) satirlar.push(`  bu aracın eski kancaları: ${k.eski} (kanca kurulumu onları temizler).`);
    return satirlar;
  }
  if (k.arac === true && (k.kabuk ?? 0) > 0) {
    satirlar.push(
      "  kanca eski kabuk biçiminde: Git Bash'le çalışır, Git Bash bulunamazsa Claude Code PowerShell'e düşer ve orada " +
        "çalışmaz. kanca-ekle onu kabuktan bağımsız yürütme biçimine çevirir.",
    );
  }
  for (const neden of k.kapatan ?? []) {
    satirlar.push(`  UYARI: kancaları kapatan ayar: ${neden}. Bu durdukça kanca hiç çalışmaz, bütün kayıtlar taslak doğar.`);
  }
  if (k.eski > 0) {
    satirlar.push(
      `  eski kancalar (istem / tur sonu / eski biçim): ${k.eski}. Artık hiçbir şey yapmazlar ama her mesajda çalışırlar; ` +
        "kanca-ekle onları temizler.",
    );
  }
  return satirlar;
}

/**
 * Yalnız taslak ajanın (Codex CLI) kurulum satırları: kanca aranmaz ve "kurun" denmez; kayıtların neden hep
 * taslak doğduğu uyarlayıcının metniyle (`taslakNedeni`) yazılır.
 */
function taslakKurulumSatirlari(ajan: PcAjanGorunumu & { taslakNedeni: string }): string[] {
  return [
    `Kurulum (${ajan.gorunenAd}): yalnız taslak. Araç öncesi kanca yok ve kurulmaz (bilerek).`,
    "  Bu ajanın bütün kayıtları TASLAK doğar ve telefondan onaylanır; bu bir kurulum hatası değildir.",
    `  Neden: ${ajan.taslakNedeni}`,
  ];
}

/** Yalnız taslak ajanın sınama özetine, günlük PC ajanlarını ayırmıyorsa eklenen satırlar. */
const taslakOzetSatirlari = (ajan: PcAjanGorunumu): string[] => [
  `Not (${ajan.gorunenAd}): köprüsü çağrı kimliğini göndermez; çağrıları günlükte pc_karar=cagri_kimligi_yok olarak`,
  "  görünür, kayıt taslak doğar (beklenen). Bu günlük PC ajanlarını ayırmıyor (servis ya da köprüler ajanı",
  "  bildirmeyen sürümden): insan, tasdik_yok, alt_agent ya da etkilesimsiz kararları başka bir PC ajanının",
  "  (ör. Claude Code) çağrılarıdır.",
];

/** `arac` olayının PC ajanı: köprünün hello'da bildirdiği `uyarlayici` (izinli değer); bildirmeyen köprüde `null`. */
const aracAjani = (o: TeshisOlayi): string | null => o.alanlar["uyarlayici"] ?? null;

/** Ajan adından önerilen teşhis seçeneği (öteki ajanların satırı). */
const adSecenegi = (ad: string): string => (ad === VARSAYILAN_PC_AJANI ? CLAUDE_CODE_SECENEGI : `${PC_AJAN_SECENEGI} ${ad}`);

/**
 * Ajan ayrımlı günlükte seçilen ajanın dışındaki `arac` olayları, ajan başına bir satır (özete girmezler). Ajanı
 * bilinmeyen (alanı olmayan: eski köprü ya da düşüşte `uyarlayici`'sız basamak) çağrı için ne ajan ne kararın nedeni
 * kesin söylenir. Bilinen ajanlar adla sıralı, bilinmeyen en sonda.
 */
function otekiAjanSatirlari(araclar: readonly TeshisOlayi[], ajan: PcAjanGorunumu): string[] {
  const gruplar = new Map<string, TeshisOlayi[]>();
  const bilinmeyen: TeshisOlayi[] = [];
  for (const o of araclar) {
    const ad = aracAjani(o);
    if (ad === ajan.ad) continue;
    if (ad === null) bilinmeyen.push(o);
    else gruplar.set(ad, [...(gruplar.get(ad) ?? []), o]);
  }
  if (gruplar.size === 0 && bilinmeyen.length === 0) return [];
  const sonKarari = (l: readonly TeshisOlayi[]): string => l.at(-1)?.alanlar["pc_karar"] ?? "?";
  const satirlar = ["Öteki PC ajanlarının çağrıları (yukarıdaki özete girmedi):"];
  for (const ad of [...gruplar.keys()].sort()) {
    const l = gruplar.get(ad) ?? [];
    satirlar.push(`  - ${ad}: ${l.length} çağrı, son karar ${sonKarari(l)}. Ayrıntı: eslestir ${adSecenegi(ad)} --teshis`);
  }
  if (bilinmeyen.length > 0) {
    satirlar.push(
      `  - ajanı bilinmeyen: ${bilinmeyen.length} çağrı, son karar ${sonKarari(bilinmeyen)}. Köprü ajanını bildirmedi ` +
        "(güncellemeden önce açılmış oturum ya da uyumluluk düşüşü); hangi ajanın olduğu ve kararın nedeni buradan söylenemez.",
    );
  }
  return satirlar;
}

/**
 * Yalnız taslak ajanın sınama özeti. Kanca ve çağrı kimliği bu ajanda bilerek yoktur: "HAYIR" diye alarm verilmez.
 * Köprüsü çağrı kimliği okumadığından çağrısı her zaman `cagri_kimligi_yok`'tur; başka karar bu ajanın değildir
 * (ayrımsız günlükte) ya da beklenmeyendir (ajanı bu diye bilinen çağrıda). Kanca kurulumu ve tasdik nedenleri yazılmaz.
 */
function taslakOzeti(ajan: PcAjanGorunumu, araclar: readonly TeshisOlayi[], ayrim: boolean): string[] {
  const sonKarar = araclar.at(-1)?.alanlar["pc_karar"];
  const anlam =
    sonKarar === undefined
      ? ""
      : sonKarar === "cagri_kimligi_yok"
        ? ayrim
          ? " (kayıt TASLAK doğdu: beklenen, telefondan onaylayın)"
          : ` (kayıt TASLAK doğdu: ${ajan.gorunenAd} çağrısıysa beklenen, telefondan onaylayın)`
        : ayrim
          ? ` (beklenmeyen: ${ajan.gorunenAd} köprüsü çağrı kimliği göndermez; köprü başka bir sürümden olabilir)`
          : ` (bir ${ajan.gorunenAd} çağrısının kararı değil: köprüsü çağrı kimliği göndermez, çağrıları hep cagri_kimligi_yok olur; ` +
            `başka bir PC ajanının, ör. Claude Code: eslestir ${CLAUDE_CODE_SECENEGI} --teshis)`;
  return [
    `Sınama (${ajan.gorunenAd}, yalnız taslak${ayrim ? `; yalnız ${ajan.gorunenAd} çağrıları` : ""}):`,
    "  araç öncesi kanca: yok, kurulmaz (beklenen)",
    "  çağrı kimliği: köprü okumaz (beklenen; çağrıların kararı cagri_kimligi_yok)",
    ...(ayrim ? [`  ${ajan.gorunenAd} çağrısı: ${araclar.length === 0 ? "olay yok" : String(araclar.length)}`] : []),
    `  son PC araç kararı: ${sonKarar ?? "olay yok"}${anlam}`,
  ];
}

/**
 * Servis günlüğünün (JSON satırları) PC kanca ve PC araç olaylarından teşhis metni: önce kanca kurulumu
 * (`kurulum`; verilmezse yazılmaz), sonra en yeni `TESHIS_SATIR` olay, her biri izin listesindeki
 * alanlarla; sonra özet (araç öncesi kanca servise ulaşıyor mu, çağrı kimliği geliyor mu, son karar ve
 * kullanıcıya anlamı). Metin, kayıt alanı, anahtar ya da tam kimlik yazılmaz. `ajan` verilmezse Claude Code
 * (bugünkü metin). Olay satırları hep aynıdır; özet `arac.uyarlayici` varsa yalnız seçilen ajanın çağrılarından kurulur
 * (öteki ajanlar ve ajanı bilinmeyenler ayrı satırda, `otekiAjanSatirlari`), hiçbir `arac` onu taşımıyorsa bütün
 * çağrılardan (eski günlük: çıktı bugünkü; Claude Code'un `cagri_kimligi_yok` metni başka ajan ihtimalini anar).
 * Yalnız taslak ajanın özeti `taslakOzeti`'dir (kanca ve çağrı kimliği alarmı yok).
 */
export function pcTeshisMetni(
  satirlar: readonly string[],
  zaman: (ms: number) => string = yerelZaman,
  kurulum?: ClaudeCodeKancaDurumu | null,
  ajan: PcAjanGorunumu = CLAUDE_CODE_GORUNUMU,
): string {
  // Yalnız taslak ajanda kurulum satırları kanca durumundan bağımsızdır, her zaman yazılır.
  const bas = kurulum === undefined && !yalnizTaslakMi(ajan) ? "" : `${kurulumSatirlari(kurulum ?? null, ajan).join("\n")}\n\n`;
  const olaylar: Array<{ ts: number; olay: string; alanlar: Record<string, string>; oturum: string | null; iz: string | null }> = [];
  // Neden olaylarını kendi `arac`'ına bağlamak için teşhis modüllerinin bütün satırları (`tasdikReddiNedenleri`).
  const zincir: Array<(typeof olaylar)[number] | null> = [];
  for (const s of satirlar) {
    let j: unknown;
    try {
      j = JSON.parse(s);
    } catch {
      continue;
    }
    if (typeof j !== "object" || j === null || Array.isArray(j)) continue;
    const k = j as Record<string, unknown>;
    if (typeof k["modul"] !== "string" || !TESHIS_MODULLERI.has(k["modul"])) continue;
    const olay = typeof k["olay"] === "string" ? k["olay"] : "";
    const izinli = Object.hasOwn(TESHIS_ALANLARI, olay) ? TESHIS_ALANLARI[olay] : undefined;
    // `arac` yalnız PC yolundaysa; el sıkışma yalnız PC rollerindeyse.
    if (
      izinli === undefined ||
      (olay === "arac" && k["yol"] !== "pc_araci") ||
      ((olay === "el_sikisma" || olay === "el_sikisma_ret") && k["rol"] !== "pc_oturumu" && k["rol"] !== "pc_kanca")
    ) {
      zincir.push(null);
      continue;
    }
    const alanlar: Record<string, string> = {};
    for (const a of izinli) {
      const d = teshisDegeri(k[a]);
      if (d !== null) alanlar[a] = d;
    }
    const o = { ts: typeof k["ts_ms"] === "number" ? k["ts_ms"] : 0, olay, alanlar, oturum: kisaOturum(k["oturum_id"]), iz: cagriIzi(k["cagri_izi"]) };
    olaylar.push(o);
    zincir.push(o);
  }
  const son = olaylar.slice(-TESHIS_SATIR);
  if (son.length === 0) {
    // Yönergeyi göstermek anahtarı yenilememeli: Claude Code'da bugünkü `goster`, ötekilerde `--yonerge`.
    const kayitYeri = claudeCodeMu(ajan) ? "kurulum\\claude-code.ts goster" : `kayıt yönergesi: eslestir ${pcSecenegi(ajan)} --yonerge`;
    return (
      `${bas}Servis günlüğünde PC kanca ya da PC araç olayı yok.\n` +
      `  MCP köprüsü kayıtlı mı (${kayitYeri}), anahtar var mı (eslestir ${pcSecenegi(ajan)} --liste)?\n` +
      `  Yeni bir ${ajan.gorunenAd} oturumunda bir kayıt isteyip yeniden bakın.\n`
    );
  }
  const satir = son.map((o) => {
    const alan = Object.entries(o.alanlar).map(([a, d]) => `${a}=${d}`).join(" ");
    return `  ${zaman(o.ts)}  ${o.olay}${o.oturum === null ? "" : ` oturum=${o.oturum}`}${alan === "" ? "" : ` ${alan}`}`;
  });
  const olaySatirlari = `${bas}Son PC olayları (en yeni sonda; metin ve kayıt alanı yazılmaz):\n${satir.join("\n")}\n\n`;
  const butunAraclar = son.filter((o) => o.olay === "arac");
  // Ajan ayrımı: en az bir `arac` ajanını taşıyorsa (servis ve köprü `uyarlayici`'yı bilen sürümden) özet yalnız seçilen
  // ajanın çağrılarından kurulur, ötekiler ayrı satırda. Hiçbiri taşımıyorsa (eski günlük) bugünkü gibi hepsi sayılır.
  const ayrim = butunAraclar.some((o) => aracAjani(o) !== null);
  const kendisi = (o: TeshisOlayi): boolean => !ayrim || aracAjani(o) === ajan.ad;
  const araclar = butunAraclar.filter(kendisi);
  const otekiler = ayrim ? otekiAjanSatirlari(butunAraclar, ajan) : [];
  if (yalnizTaslakMi(ajan)) {
    const ozet = [...taslakOzeti(ajan, araclar, ayrim), ...otekiler, ...surecsizKopruSatirlari(son, zaman)];
    if (!ayrim) ozet.push(...taslakOzetSatirlari(ajan));
    return `${olaySatirlari}${ozet.join("\n")}\n`;
  }
  // Kanca olayları (`pc_arac`) yalnız kancalı ajandandır (bugün Claude Code); ajan ayrımına girmez.
  const tasdikler = son.filter((o) => o.olay === "pc_arac");
  const evetHayir = (kosul: boolean, bos: boolean): string => (bos ? "olay yok" : kosul ? "evet" : "HAYIR");
  const sonKarar = araclar.at(-1)?.alanlar["pc_karar"];
  // Tasdik geldi ama servis kullanmadı (başka köprüye bağlı ya da yetersiz): kanca kurulumu değil; "kurun" denmez.
  const reddiNedenleri = sonKarar === "tasdik_yok" ? tasdikReddiNedenleri(zincir, kendisi) : [];
  // Ayarda kurulu ama tasdik gelmedi: genel metin ("kurulu değilse kurun") yanlış yere yollar; nedenler ayrı.
  const kuruluAmaTasdiksiz =
    reddiNedenleri.length === 0 && sonKarar === "tasdik_yok" && kurulum !== undefined && kurulum !== null && kurulum.arac === true;
  // Ajanı `claude-code` diye bilinen çağrının çağrı kimliksizliği kesindir; ayrımsız günlükte başka ajan ihtimali anılır.
  const kesinKimliksiz = ayrim && claudeCodeMu(ajan) && sonKarar === "cagri_kimligi_yok";
  const anlam = reddiNedenleri.length > 0
    ? " (kayıtlar TASLAK doğuyor: kanca bu çağrıyı bildirdi ama servis tasdiki kullanmadı; neden aşağıda)"
    : kuruluAmaTasdiksiz
    ? " (kayıtlar TASLAK doğuyor: kanca ayarda kurulu görünüyor ama bu çağrıda tasdik gelmedi; olası nedenler aşağıda)"
    : kesinKimliksiz
    ? ` (${CLAUDE_CAGRI_KIMLIGI_YOK_METNI})`
    : sonKarar !== undefined && Object.hasOwn(TESHIS_KARAR_METNI, sonKarar)
      ? ` (${TESHIS_KARAR_METNI[sonKarar as PcTurKarari]})`
      : "";
  const ozet = [
    ayrim
      ? `Sınama (AJANDA.md "Kurulumdan sonra sınama"; yalnız ${ajan.gorunenAd} çağrıları):`
      : "Sınama (AJANDA.md \"Kurulumdan sonra sınama\"):",
    `  araç öncesi kanca servise ulaşıyor mu: ${tasdikler.length > 0 ? "evet" : araclar.length > 0 ? "HAYIR" : "olay yok"}`,
    `  çağrı kimliği MCP isteğinde geliyor mu: ${evetHayir(araclar.some((o) => o.alanlar["cagri_kimligi"] === "var"), araclar.length === 0)}`,
    `  istem kimliği geliyor mu (araç öncesi): ${evetHayir(tasdikler.some((o) => o.alanlar["istem_kimligi"] === "var"), tasdikler.length === 0)}`,
    `  son PC araç kararı: ${sonKarar ?? "olay yok"}${anlam}`,
  ];
  if (reddiNedenleri.length > 0) {
    ozet.push("Günlükte görülen neden (kanca çalışıyor; kurulum sorunu değil):");
    for (const n of reddiNedenleri) ozet.push(`  - ${n}`);
  } else if (kuruluAmaTasdiksiz) {
    ozet.push("Olası nedenler (kurulu görünüyor ama tasdik gelmedi):");
    for (const n of tasdikYokNedenleri(son, kurulum)) ozet.push(`  - ${n}`);
  } else if (sonKarar === "tasdik_yok" && kancaRetNedenleri(son).length > 0) {
    // Kurulum bilinmese de günlükteki ret nedeni söylenir ("kancayı kurun"dan önce).
    ozet.push("Günlükte görülen neden:");
    for (const n of kancaRetNedenleri(son)) ozet.push(`  - ${n}`);
  }
  ozet.push(...otekiler, ...surecsizKopruSatirlari(son, zaman));
  return `${olaySatirlari}${ozet.join("\n")}\n`;
}

/** `--claude-code --liste`: anahtar geçmişi (özetsiz) ve dosyanın varlığı. `ajan` verilmezse Claude Code. */
export function pcListeMetni(
  anahtarlar: readonly AjandaPcAnahtarOzeti[],
  dosyaVar: boolean,
  y: Pick<ClaudeCodeYollari, "anahtarDosyasi">,
  zaman: (ms: number) => string = yerelZaman,
  ajan: PcAjanGorunumu = CLAUDE_CODE_GORUNUMU,
): string {
  const etkin = anahtarlar.filter((a) => a.iptal_ms === null);
  const satirlar = [`${ajan.gorunenAd} ajanda anahtarı: ${etkin.length === 0 ? "yok (PC oturumları ajandaya erişemez)" : "etkin"}`];
  for (const a of etkin) satirlar.push(`  etkin, üretildi ${zaman(a.olusturma_ms)}`);
  const iptal = anahtarlar.filter((a) => a.iptal_ms !== null);
  if (iptal.length > 0) {
    satirlar.push(`Geçersiz kılınmış anahtarlar (${iptal.length}):`);
    for (const a of iptal) satirlar.push(`  üretildi ${zaman(a.olusturma_ms)}  geçersiz ${zaman(a.iptal_ms ?? 0)}`);
  }
  satirlar.push(`Anahtar dosyası: ${y.anahtarDosyasi} (${dosyaVar ? "var" : "yok"})`);
  if (etkin.length > 0 && !dosyaVar) satirlar.push(`UYARI: anahtar etkin ama dosyası yok; yenilemek için: eslestir ${pcSecenegi(ajan)}`);
  if (!claudeCodeMu(ajan)) satirlar.push(ORTAK_ANAHTAR_NOTU.trimStart());
  return `${satirlar.join("\n")}\n`;
}

/** `--claude-code --kaldir` çıktısı. `ajan` verilmezse Claude Code (bugünkü metin). */
export function pcKaldirMetni(iptalEdilen: number, dosyaSilindi: boolean, ajan: PcAjanGorunumu = CLAUDE_CODE_GORUNUMU): string {
  const claude = claudeCodeMu(ajan);
  if (iptalEdilen === 0 && !dosyaSilindi) return `${ajan.gorunenAd} ajanda anahtarı zaten yok; hiçbir şey değişmedi.\n`;
  return (
    `${ajan.gorunenAd} ajanda anahtarı geçersiz kılındı` +
    (dosyaSilindi ? " ve dosyası silindi" : "") +
    `. Açık PC oturumlarının köprüsü bir sonraki çağrıda reddedilir; kayıtlı MCP sunucusu ${yalnizTaslakMi(ajan) ? "" : "ve kanca "}durur, ` +
    (claude
      ? "kaldırmak için docs/SERVIS.md \"Claude Code oturumları\".\n"
      : `kaldırmak için ajanın kayıt yönergesindeki kaldırma adımı.\nAnahtar bütün PC ajanlarında ortaktı: hiçbiri ajandaya erişemez.\n`)
  );
}

// ---------------------------------------------------------------------------------------------
// Komut satırı. Düz kod yalnız terminale yazılır; günlüğe ve depoya girmez.
// ---------------------------------------------------------------------------------------------

/**
 * PC ailesi (`--claude-code`, `--pc-ajan <ad>`): yalnız veri kökü ve depo (ayar ön koşulları gerekmez). Ad her
 * şeyden önce doğrulanır: bilinmeyen adda anahtara, depoya ve günlüğe dokunulmaz, 2 döner. Anahtar, dosyası ve
 * günlük olayları ajandan bağımsızdır; uyarlayıcıdan gelen yalnız yönerge, kanca durumu ve görünen ad. `--yonerge`
 * yalnız yönergeyi yazar (veri kökü, depo, anahtar ve günlük açılmaz); alt komutsuz çağrı anahtarı yeniler.
 */
async function pcKomutu(komut: PcKomutu): Promise<number> {
  let kayit: PcAjanKaydi | null = null;
  try {
    kayit = await pcAjanKaydiYukle();
  } catch {
    kayit = null; // kurulum dizini yok: yalnız claude-code, bugünkü yedek metinlerle
  }
  const secim = pcAjanSec(komut.ajan ?? VARSAYILAN_PC_AJANI, kayit);
  if (!secim.ok) {
    process.stderr.write(`eslestir: ${secim.ileti}\n${KULLANIM}\n`);
    return 2;
  }
  const { ajan, gorunum } = secim;
  const yonergeYaz = (ortam: Readonly<Record<string, string | undefined>>): string => {
    let yonerge = kayitYonergesiYedegi(gorunum);
    try {
      if (ajan !== null) yonerge = ajan.kayitYonergesi(ortam, process.execPath);
    } catch {
      // yönerge üretilemedi (ör. USERPROFILE yok): elle bakılacak yer yazılır
    }
    return yonerge;
  };
  if (komut.tur === "pc_yonerge") {
    // Yalnız yazar: veri köküne, depoya, anahtara ve günlüğe dokunulmaz.
    process.stdout.write(pcYonergeMetni(yonergeYaz({ ...(process.env as Record<string, string>) }), gorunum));
    return 0;
  }

  const { asistanAdiUret, yollariUret } = await import("./ayar.ts");
  const { depoAc } = await import("./depo.ts");
  const { gunlukKur } = await import("./gunluk.ts");
  const { disDunyaKur, dosyaPortuKur } = await import("./dis-dunya.ts");
  const { ajandaPcAnahtarYolu, ortamDegeri } = await import("./veri-koku.ts");
  const { closeSync, existsSync, fstatSync, openSync, readSync, rmSync } = await import("node:fs");

  const ortam = { ...(process.env as Record<string, string>) };
  const yollar = yollariUret(ortam);
  if (komut.tur === "pc_teshis") {
    // Yalnız okur: servis günlüğünün sonu (önce dönmüş eski dosya, sonra güncel). Depo açılmaz.
    const sonu = (yol: string, bayt: number): string[] => {
      if (!existsSync(yol)) return [];
      const fd = openSync(yol, "r");
      try {
        const boyut = fstatSync(fd).size;
        const tampon = Buffer.alloc(Math.min(boyut, bayt));
        readSync(fd, tampon, 0, tampon.length, boyut - tampon.length);
        return tampon.toString("utf8").split("\n");
      } finally {
        closeSync(fd);
      }
    };
    const eski = yollar.log.replace(/\.log$/, ".1.log");
    // Kanca kurulumu: ajanın kullanıcı ayarı yalnız okunur (uyarlayıcı; yoksa ya da atarsa `null`). Yalnız
    // taslak ajanın kancası yoktur: ayarı hiç okunmaz, teşhis kurulum satırlarını görünümden yazar.
    let kurulum: ClaudeCodeKancaDurumu | null = null;
    try {
      kurulum = ajan === null || ajan.kancaDurumu === undefined ? null : ajan.kancaDurumu(ortam);
    } catch {
      kurulum = null;
    }
    process.stdout.write(pcTeshisMetni([...sonu(eski, 1024 * 1024), ...sonu(yollar.log, 2 * 1024 * 1024)], yerelZaman, kurulum, gorunum));
    return 0;
  }
  const anaSohbetAdi = asistanAdiUret(ortamDegeri(ortam, "EREN_KIT_ASSISTANT_NAME"));
  const dis = await disDunyaKur({ yollar });
  const gunluk = gunlukKur({ kayit: dis.kayit, saat: dis.saat, azamiBayt: 5 * 1024 * 1024, azamiDosya: 3 });
  const depo = depoAc({ yol: yollar.vt, saat: dis.saat, gunluk, anaSohbetAdi });
  const y: ClaudeCodeYollari = { anahtarDosyasi: ajandaPcAnahtarYolu(yollar.kok) };
  try {
    if (komut.tur === "pc_liste") {
      process.stdout.write(pcListeMetni(depo.ajandaPcAnahtarlari(), existsSync(y.anahtarDosyasi), y, yerelZaman, gorunum));
      return 0;
    }
    if (komut.tur === "pc_kaldir") {
      const iptal = depo.ajandaPcAnahtarlariniIptalEt(dis.saat.simdiMs());
      const vardi = existsSync(y.anahtarDosyasi);
      if (vardi) rmSync(y.anahtarDosyasi, { force: true });
      gunluk.uyari("eslestir", "pc_anahtari_kaldirildi", { iptal });
      process.stdout.write(pcKaldirMetni(iptal, vardi, gorunum));
      return 0;
    }
    const oncekiEtkin = depo.ajandaPcAnahtarlari().filter((a) => a.iptal_ms === null).length;
    const { jeton } = pcAnahtariUret({ depo, rastgele: dis.rastgele, saat: dis.saat });
    try {
      await dosyaPortuKur().atomikYaz(y.anahtarDosyasi, `${jeton}\n`);
    } catch {
      // Dosyasız etkin anahtar kimsenin işine yaramaz: geçersiz kıl, kullanıcı yeniden dener.
      depo.ajandaPcAnahtarlariniIptalEt(dis.saat.simdiMs());
      process.stderr.write(`Anahtar dosyası yazılamadı (${y.anahtarDosyasi}); anahtar geçersiz kılındı, yeniden deneyin.\n`);
      return 1;
    }
    gunluk.uyari("eslestir", "pc_anahtari_uretildi", { onceki_etkin: oncekiEtkin });
    process.stdout.write(pcAnahtarMetni(y, oncekiEtkin, yonergeYaz(ortam), gorunum));
    return 0;
  } finally {
    depo.kapat();
  }
}

async function komutCalistir(argv: readonly string[]): Promise<number> {
  const komut = argumanCoz(argv);
  if (komut.tur === "yardim") {
    process.stdout.write(`${KULLANIM}\n`);
    return 0;
  }
  if (komut.tur === "hata") {
    process.stderr.write(`eslestir: ${komut.ileti}\n${KULLANIM}\n`);
    return 2;
  }
  if (pcKomutuMu(komut)) return pcKomutu(komut);

  const { ayarKur, asistanAdiUret, yollariUret } = await import("./ayar.ts");
  const { depoAc } = await import("./depo.ts");
  const { gunlukKur } = await import("./gunluk.ts");
  const { disDunyaKur, dosyaPortuKur } = await import("./dis-dunya.ts");
  const { ortamDegeri } = await import("./veri-koku.ts");

  const ortam = { ...(process.env as Record<string, string>) };
  // Eşleşme yönetimi (`--liste`, `--kaldir`) yalnız veri kökünü ister. `ayarKur` servisin ön koşullarını
  // da doğrular (`claude.exe` bulunamazsa atar): kaybolan telefonun yetkisini geri almak `claude`'un
  // kurulu olmasına bağlı olmamalı. Kök ve asistan adı aynı kuraldan (`yollariUret`, `asistanAdiUret`;
  // `EREN_KIT_ASSISTANT_NAME` = ayar.ts `ASISTAN_ADI_ORTAMI`). Kod üretmek (`wsPort`) tam ayarı ister.
  const yonetim = komut.tur === "liste" || komut.tur === "kaldir";
  const ayar = yonetim
    ? null
    : await ayarKur({ dosya: dosyaPortuKur(), ortam, execPath: process.execPath, baslangicMs: Date.now() });
  const yollar = ayar?.yollar ?? yollariUret(ortam);
  const anaSohbetAdi = ayar?.asistanAdi ?? asistanAdiUret(ortamDegeri(ortam, "EREN_KIT_ASSISTANT_NAME"));
  const dis = await disDunyaKur({ yollar });
  const gunluk = gunlukKur({ kayit: dis.kayit, saat: dis.saat, azamiBayt: 5 * 1024 * 1024, azamiDosya: 3 });
  const depo = depoAc({ yol: yollar.vt, saat: dis.saat, gunluk, anaSohbetAdi });
  try {
    if (komut.tur === "liste") {
      process.stdout.write(listeMetni(depo.eslesmeler(), yerelZaman, komut.kapsam));
      return 0;
    }
    if (komut.tur === "kaldir") {
      const s = cihazKaldirKomutu(depo, komut.device_id, yerelZaman, komut.kapsam);
      if (s.kod === 0) gunluk.uyari("eslestir", "eslesme_kaldirildi", { device_id: komut.device_id });
      process.stdout.write(s.cikti);
      process.stderr.write(s.hata);
      return s.kod;
    }
    if (ayar === null) return 1; // yukarıdaki iki dal döndü; tip daraltması
    const bag = {
      depo,
      anahtar: dis.anahtar,
      sistem: dis.sistem,
      rastgele: dis.rastgele,
      saat: dis.saat,
      wsPort: ayar.wsPort,
    };
    const oncekiPencere = depo.eslestirmeOku();
    const s = komut.kapsam === "ajanda" ? ajandaEslestirmeBaslat(bag) : eslestirmeBaslat(bag);
    if (!s.ok) {
      process.stderr.write(`Eşleştirme başlatılamadı: ${s.detail ?? s.code}\n`);
      return 1;
    }
    process.stdout.write(kodMetni(s.deger, { simdiMs: dis.saat.simdiMs(), oncekiPencere, ...(komut.kapsam ? { kapsam: komut.kapsam } : {}) }));
    return 0;
  } finally {
    depo.kapat();
  }
}

if (import.meta.main) {
  komutCalistir(process.argv.slice(2)).then(
    (kod) => {
      process.exitCode = kod;
    },
    (e: unknown) => {
      // Neden görünsün (ör. ayar ya da veri kökü hatası); yığın izi yazılmaz.
      process.stderr.write(`eslestir: ${e instanceof Error && e.message !== "" ? e.message : "beklenmeyen hata"}\n`);
      process.exitCode = 1;
    },
  );
}
