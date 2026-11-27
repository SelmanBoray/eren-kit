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
 */
import {
  AJANDA_PC_MCP_ADI,
  AJANDA_SURUMU,
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

/** `eslestir --ajanda`: aynı kod ve süre; QR `AjandaEslestirmeQr`, pencere `kapsam:"ajanda"`. */
export const ajandaEslestirmeBaslat: AjandaEslestirmeBaslatici = (b) =>
  pencereAc(b, (t) => AjandaEslestirmeQrSemasi.safeParse({ v: AJANDA_SURUMU, ...t, kanal: "ajanda" }), "ajanda");

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
].join("\n");

/** `kapsam` yalnız `--ajanda` verilince bulunur; yoksa komut bugünkü (sohbet) davranışındadır. */
export type EslestirKomutu =
  | { tur: "kod"; kapsam?: "ajanda" }
  | { tur: "liste"; kapsam?: "ajanda" }
  | { tur: "kaldir"; device_id: string; kapsam?: "ajanda" }
  | { tur: "pc_anahtar" }
  | { tur: "pc_liste" }
  | { tur: "pc_kaldir" }
  | { tur: "pc_teshis" }
  | { tur: "yardim" }
  | { tur: "hata"; ileti: string };

const YARDIM_SECENEKLERI: readonly string[] = ["-h", "--help", "--yardim"];

const PC_ALT_KOMUTLARI = ["--liste", "--kaldir", "--teshis"] as const;

/** `--claude-code` seçenekleri: en çok biri `--liste`, (değersiz) `--kaldir` ya da `--teshis`, bir kez. */
function pcArgumanCoz(argv: readonly string[]): EslestirKomutu {
  const gorulen = new Set<string>();
  for (const a of argv) {
    if (YARDIM_SECENEKLERI.includes(a)) return { tur: "yardim" };
    if (a !== "--claude-code" && !(PC_ALT_KOMUTLARI as readonly string[]).includes(a)) {
      return { tur: "hata", ileti: `--claude-code ile kullanılamaz: ${gorunur(a)}` };
    }
    if (gorulen.has(a)) return { tur: "hata", ileti: `${a} bir kez verilir` };
    gorulen.add(a);
  }
  const alt = PC_ALT_KOMUTLARI.filter((k) => gorulen.has(k));
  if (alt.length > 1) return { tur: "hata", ileti: `${alt.join(" ve ")} birlikte verilmez` };
  if (gorulen.has("--liste")) return { tur: "pc_liste" };
  if (gorulen.has("--kaldir")) return { tur: "pc_kaldir" };
  if (gorulen.has("--teshis")) return { tur: "pc_teshis" };
  return { tur: "pc_anahtar" };
}

/**
 * Seçenekler herhangi bir sırada; `--kaldir`'ın hemen ardından kimlik gelir. Hata: bilinmeyen seçenek,
 * yinelenen `--ajanda`, `--liste` ile `--kaldir` birlikte, eksik ya da fazla değer. `--claude-code`
 * ayrı bir komut ailesidir (`pcArgumanCoz`): `--kaldir` orada değer almaz, `--ajanda` ile birleşmez.
 */
export function argumanCoz(argv: readonly string[]): EslestirKomutu {
  if (argv.includes("--claude-code")) return pcArgumanCoz(argv);
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
// PC'deki Claude Code oturumları (`--claude-code`; AJANDA.md "PC oturumları"). Saf parçalar test edilir.
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
 * Kayıt yönergesinin TEK kaynağı `kurulum/claude-code.ts`'tir (`kayitYonergesi`): `claude mcp add` komutu
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
 * kancası (`PreToolUse`, `mcp__eren-ajanda__.*`) kurulu mu (`null`: ayar okunamadı); `eski` önceki
 * kurulumun artık kullanılmayan kancaları (istem, tur sonu, eski biçim). `kurulum/claude-code.ts` üretir.
 */
export interface ClaudeCodeKancaDurumu {
  ayarYolu: string;
  arac: boolean | null;
  eski: number;
}

/** Aynı sürümün `kurulum/claude-code.ts`'i (kur.ts `kurulum`'u sürüme kopyalar; depoda da aynı göreli yer). */
export const kayitYonergesiYukle = async (): Promise<KayitYonergesiModulu> =>
  (await import(new URL("../../kurulum/claude-code.ts", import.meta.url).href)) as KayitYonergesiModulu;

/** Yönerge yüklenemezse (kurulum dizini yok): elle nereye bakılacağı. */
export const KAYIT_YONERGESI_YEDEK =
  "Kayıt komutları için: node --disable-warning=ExperimentalWarning kurulum\\claude-code.ts goster (docs/SERVIS.md \"Claude Code oturumları\").\n";

/**
 * Anahtar üretiminin terminal çıktısı: ne değişti, dosya nerede, ve kayıt yönergesi (`kurulum/claude-code.ts`
 * `kayitYonergesi`'nin metni, olduğu gibi). Anahtarın kendisi yok.
 */
export function pcAnahtarMetni(y: ClaudeCodeYollari, oncekiEtkin: number, yonerge: string): string {
  const satirlar = [
    `Claude Code ajanda anahtarı üretildi${oncekiEtkin > 0 ? " (önceki anahtar artık geçersiz; açık PC oturumları yeni dosyayı kendiliğinden okur)" : ""}.`,
    `Anahtar dosyası: ${y.anahtarDosyasi}`,
    "  Yalnız bu Windows kullanıcısı okuyabilir (veri kökü). İçeriğini hiçbir yere yapıştırmayın; sızarsa: eslestir --claude-code (yeniler).",
    "",
  ];
  return `${satirlar.join("\n")}\n${yonerge}`;
}

// --- `--claude-code --teshis`: servis günlüğünden PC kararları (içerik yok) ---------------------

/** Teşhiste gösterilen olaylar ve YALNIZ bu alanlar (izin listesi: başka alan hiç yazılmaz). */
const TESHIS_ALANLARI: Readonly<Record<string, readonly string[]>> = {
  pc_arac: ["alt_agent", "etkilesimsiz", "istem_kimligi"],
  arac: ["fiil", "tur_kokeni", "pc_karar", "cagri_kimligi", "sonuc", "neden"],
  el_sikisma: ["rol"],
  el_sikisma_ret: ["rol", "code", "neden"],
};

/**
 * Son kararın kullanıcıya açıklaması (`PC_TUR_KARARLARI`). Sentetik kararların hepsinde kayıt taslak
 * doğar; alt agent ve etkileşimsiz oturum için bu beklenen davranıştır, öteki ikisi kurulum sorunudur.
 */
export const TESHIS_KARAR_METNI: Readonly<Record<PcTurKarari, string>> = {
  insan: "ana oturumun çağrısı; kayıt doğrudan (taslaksız) yazıldı. Kurulum doğru.",
  cagri_kimligi_yok:
    "kayıtlar TASLAK doğuyor: Claude Code çağrı kimliğini MCP isteğinde göndermiyor (sürüm farkı); kanca bunu düzeltemez, " +
    "kayıtları uygulamadan onaylayın.",
  tasdik_yok:
    "kayıtlar TASLAK doğuyor: araç öncesi kanca bu çağrıyı servise bildirmedi. Kanca kurulu değilse kurun " +
    "(kurulum\\claude-code.ts kanca-ekle) ve Claude Code'u yeniden açın; kuruluysa servis o an yanıt vermemiş, " +
    "izin sorusu uzun beklemiş ya da servis arada yeniden başlamış olabilir.",
  alt_agent: "son çağrı bir alt agent'tandı; alt agent'ın kaydı her zaman taslaktır (beklenen).",
  etkilesimsiz: "son çağrı -p ya da Agent SDK oturumundandı; kaydı taslaktır (beklenen).",
};
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

/** Kanca kurulumunun satırları (`--teshis`'in başı). `null`: kurulum modülü yüklenemedi. */
function kurulumSatirlari(k: ClaudeCodeKancaDurumu | null): string[] {
  if (k === null) return ["Kurulum: kanca durumu okunamadı (kurulum dizini yok)."];
  const satirlar = [`Kurulum (${k.ayarYolu}):`];
  satirlar.push(
    k.arac === null
      ? "  araç öncesi kanca: ayar dosyası okunamadı (geçerli JSON değil)."
      : k.arac
        ? "  araç öncesi kanca (PreToolUse, mcp__eren-ajanda__.*): kurulu."
        : "  araç öncesi kanca (PreToolUse, mcp__eren-ajanda__.*): YOK. Bu durumda bütün kayıtlar taslak doğar. " +
          "Kurmak için: node --disable-warning=ExperimentalWarning kurulum\\claude-code.ts kanca-ekle (sonra Claude Code'u yeniden açın).",
  );
  if (k.eski > 0) {
    satirlar.push(
      `  eski kancalar (istem / tur sonu / eski biçim): ${k.eski}. Artık hiçbir şey yapmazlar ama her mesajda çalışırlar; ` +
        "kanca-ekle onları temizler.",
    );
  }
  return satirlar;
}

/**
 * Servis günlüğünün (JSON satırları) PC kanca ve PC araç olaylarından teşhis metni: önce kanca kurulumu
 * (`kurulum`; verilmezse yazılmaz), sonra en yeni `TESHIS_SATIR` olay, her biri izin listesindeki
 * alanlarla; sonra özet (araç öncesi kanca servise ulaşıyor mu, çağrı kimliği geliyor mu, son karar ve
 * kullanıcıya anlamı). Metin, kayıt alanı, anahtar ya da tam kimlik yazılmaz.
 */
export function pcTeshisMetni(
  satirlar: readonly string[],
  zaman: (ms: number) => string = yerelZaman,
  kurulum?: ClaudeCodeKancaDurumu | null,
): string {
  const bas = kurulum === undefined ? "" : `${kurulumSatirlari(kurulum).join("\n")}\n\n`;
  const olaylar: Array<{ ts: number; olay: string; alanlar: Record<string, string>; oturum: string | null }> = [];
  for (const s of satirlar) {
    let j: unknown;
    try {
      j = JSON.parse(s);
    } catch {
      continue;
    }
    if (typeof j !== "object" || j === null || Array.isArray(j)) continue;
    const k = j as Record<string, unknown>;
    const olay = typeof k["olay"] === "string" ? k["olay"] : "";
    const izinli = Object.hasOwn(TESHIS_ALANLARI, olay) ? TESHIS_ALANLARI[olay] : undefined;
    if (izinli === undefined || typeof k["modul"] !== "string" || !TESHIS_MODULLERI.has(k["modul"])) continue;
    // `arac` yalnız PC yolundaysa; el sıkışma yalnız PC rollerindeyse.
    if (olay === "arac" && k["yol"] !== "pc_araci") continue;
    if ((olay === "el_sikisma" || olay === "el_sikisma_ret") && k["rol"] !== "pc_oturumu" && k["rol"] !== "pc_kanca") continue;
    const alanlar: Record<string, string> = {};
    for (const a of izinli) {
      const d = teshisDegeri(k[a]);
      if (d !== null) alanlar[a] = d;
    }
    olaylar.push({ ts: typeof k["ts_ms"] === "number" ? k["ts_ms"] : 0, olay, alanlar, oturum: kisaOturum(k["oturum_id"]) });
  }
  const son = olaylar.slice(-TESHIS_SATIR);
  if (son.length === 0) {
    return (
      `${bas}Servis günlüğünde PC kanca ya da PC araç olayı yok.\n` +
      "  MCP köprüsü kayıtlı mı (kurulum\\claude-code.ts goster), anahtar var mı (eslestir --claude-code --liste)?\n" +
      "  Yeni bir Claude Code oturumunda bir kayıt isteyip yeniden bakın.\n"
    );
  }
  const satir = son.map((o) => {
    const alan = Object.entries(o.alanlar).map(([a, d]) => `${a}=${d}`).join(" ");
    return `  ${zaman(o.ts)}  ${o.olay}${o.oturum === null ? "" : ` oturum=${o.oturum}`}${alan === "" ? "" : ` ${alan}`}`;
  });
  const araclar = son.filter((o) => o.olay === "arac");
  const tasdikler = son.filter((o) => o.olay === "pc_arac");
  const evetHayir = (kosul: boolean, bos: boolean): string => (bos ? "olay yok" : kosul ? "evet" : "HAYIR");
  const sonKarar = araclar.at(-1)?.alanlar["pc_karar"];
  const anlam = sonKarar !== undefined && Object.hasOwn(TESHIS_KARAR_METNI, sonKarar) ? ` (${TESHIS_KARAR_METNI[sonKarar as PcTurKarari]})` : "";
  const ozet = [
    "Sınama (AJANDA.md \"Kurulumdan sonra sınama\"):",
    `  araç öncesi kanca servise ulaşıyor mu: ${tasdikler.length > 0 ? "evet" : araclar.length > 0 ? "HAYIR" : "olay yok"}`,
    `  çağrı kimliği MCP isteğinde geliyor mu: ${evetHayir(araclar.some((o) => o.alanlar["cagri_kimligi"] === "var"), araclar.length === 0)}`,
    `  istem kimliği geliyor mu (araç öncesi): ${evetHayir(tasdikler.some((o) => o.alanlar["istem_kimligi"] === "var"), tasdikler.length === 0)}`,
    `  son PC araç kararı: ${sonKarar ?? "olay yok"}${anlam}`,
  ];
  return `${bas}Son PC olayları (en yeni sonda; metin ve kayıt alanı yazılmaz):\n${satir.join("\n")}\n\n${ozet.join("\n")}\n`;
}

/** `--claude-code --liste`: anahtar geçmişi (özetsiz) ve dosyanın varlığı. */
export function pcListeMetni(
  anahtarlar: readonly AjandaPcAnahtarOzeti[],
  dosyaVar: boolean,
  y: Pick<ClaudeCodeYollari, "anahtarDosyasi">,
  zaman: (ms: number) => string = yerelZaman,
): string {
  const etkin = anahtarlar.filter((a) => a.iptal_ms === null);
  const satirlar = [`Claude Code ajanda anahtarı: ${etkin.length === 0 ? "yok (PC oturumları ajandaya erişemez)" : "etkin"}`];
  for (const a of etkin) satirlar.push(`  etkin, üretildi ${zaman(a.olusturma_ms)}`);
  const iptal = anahtarlar.filter((a) => a.iptal_ms !== null);
  if (iptal.length > 0) {
    satirlar.push(`Geçersiz kılınmış anahtarlar (${iptal.length}):`);
    for (const a of iptal) satirlar.push(`  üretildi ${zaman(a.olusturma_ms)}  geçersiz ${zaman(a.iptal_ms ?? 0)}`);
  }
  satirlar.push(`Anahtar dosyası: ${y.anahtarDosyasi} (${dosyaVar ? "var" : "yok"})`);
  if (etkin.length > 0 && !dosyaVar) satirlar.push("UYARI: anahtar etkin ama dosyası yok; yenilemek için: eslestir --claude-code");
  return `${satirlar.join("\n")}\n`;
}

/** `--claude-code --kaldir` çıktısı. */
export function pcKaldirMetni(iptalEdilen: number, dosyaSilindi: boolean): string {
  if (iptalEdilen === 0 && !dosyaSilindi) return "Claude Code ajanda anahtarı zaten yok; hiçbir şey değişmedi.\n";
  return (
    "Claude Code ajanda anahtarı geçersiz kılındı" +
    (dosyaSilindi ? " ve dosyası silindi" : "") +
    ". Açık PC oturumlarının köprüsü bir sonraki çağrıda reddedilir; kayıtlı MCP sunucusu ve kanca durur, " +
    "kaldırmak için docs/SERVIS.md \"Claude Code oturumları\".\n"
  );
}

// ---------------------------------------------------------------------------------------------
// Komut satırı. Düz kod yalnız terminale yazılır; günlüğe ve depoya girmez.
// ---------------------------------------------------------------------------------------------

/** `--claude-code` ailesi: yalnız veri kökü ve depo (ayar ön koşulları gerekmez). */
async function pcKomutu(komut: Extract<EslestirKomutu, { tur: "pc_anahtar" | "pc_liste" | "pc_kaldir" | "pc_teshis" }>): Promise<number> {
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
    // Kanca kurulumu: kullanıcının Claude Code ayarı yalnız okunur (kurulum modülü; yüklenemezse `null`).
    let kurulum: ClaudeCodeKancaDurumu | null = null;
    try {
      kurulum = (await kayitYonergesiYukle()).kancaDurumu(ortam);
    } catch {
      kurulum = null;
    }
    process.stdout.write(pcTeshisMetni([...sonu(eski, 1024 * 1024), ...sonu(yollar.log, 2 * 1024 * 1024)], yerelZaman, kurulum));
    return 0;
  }
  const anaSohbetAdi = asistanAdiUret(ortamDegeri(ortam, "EREN_KIT_ASSISTANT_NAME"));
  const dis = await disDunyaKur({ yollar });
  const gunluk = gunlukKur({ kayit: dis.kayit, saat: dis.saat, azamiBayt: 5 * 1024 * 1024, azamiDosya: 3 });
  const depo = depoAc({ yol: yollar.vt, saat: dis.saat, gunluk, anaSohbetAdi });
  const y: ClaudeCodeYollari = { anahtarDosyasi: ajandaPcAnahtarYolu(yollar.kok) };
  try {
    if (komut.tur === "pc_liste") {
      process.stdout.write(pcListeMetni(depo.ajandaPcAnahtarlari(), existsSync(y.anahtarDosyasi), y));
      return 0;
    }
    if (komut.tur === "pc_kaldir") {
      const iptal = depo.ajandaPcAnahtarlariniIptalEt(dis.saat.simdiMs());
      const vardi = existsSync(y.anahtarDosyasi);
      if (vardi) rmSync(y.anahtarDosyasi, { force: true });
      gunluk.uyari("eslestir", "pc_anahtari_kaldirildi", { iptal });
      process.stdout.write(pcKaldirMetni(iptal, vardi));
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
    let yonerge = KAYIT_YONERGESI_YEDEK;
    try {
      yonerge = (await kayitYonergesiYukle()).kayitYonergesi(ortam, process.execPath);
    } catch {
      // kurulum dizini yok: elle bakılacak yer yazılır
    }
    process.stdout.write(pcAnahtarMetni(y, oncekiEtkin, yonerge));
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
  if (komut.tur === "pc_anahtar" || komut.tur === "pc_liste" || komut.tur === "pc_kaldir" || komut.tur === "pc_teshis") return pcKomutu(komut);

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
