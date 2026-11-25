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
  AJANDA_SURUMU,
  AjandaEslestirmeQr as AjandaEslestirmeQrSemasi,
  ESKI_CIHAZ_KAPSAMI,
  EslestirmeQr as EslestirmeQrSemasi,
  kacir,
  PROTOKOL_SURUMU,
  sha256Hex,
  utf8Bayt,
  type CihazKapsami,
} from "@eren/protocol";
import type { CihazYonetimi, EslesmeOzeti } from "./depo.ts";
import type {
  AjandaEslestirmeBaslatici,
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
].join("\n");

/** `kapsam` yalnız `--ajanda` verilince bulunur; yoksa komut bugünkü (sohbet) davranışındadır. */
export type EslestirKomutu =
  | { tur: "kod"; kapsam?: "ajanda" }
  | { tur: "liste"; kapsam?: "ajanda" }
  | { tur: "kaldir"; device_id: string; kapsam?: "ajanda" }
  | { tur: "yardim" }
  | { tur: "hata"; ileti: string };

const YARDIM_SECENEKLERI: readonly string[] = ["-h", "--help", "--yardim"];

/**
 * Seçenekler herhangi bir sırada; `--kaldir`'ın hemen ardından kimlik gelir. Hata: bilinmeyen seçenek,
 * yinelenen `--ajanda`, `--liste` ile `--kaldir` birlikte, eksik ya da fazla değer.
 */
export function argumanCoz(argv: readonly string[]): EslestirKomutu {
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
// Komut satırı. Düz kod yalnız terminale yazılır; günlüğe ve depoya girmez.
// ---------------------------------------------------------------------------------------------

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
