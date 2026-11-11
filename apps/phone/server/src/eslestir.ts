/**
 * Yerel `eren eslestir` komutu. Saf çekirdek `eslestirmeBaslat`; komut satırı ince bir kabuktur
 * ve yalnız bu dosya doğrudan çalıştırılınca devreye girer. MODULLER.md "### eslestir" [karar].
 *
 * Eşleşme yönetimi (`--liste`, `--kaldir <device_id>`): saf `argumanCoz`, `listeMetni`,
 * `cihazKaldirKomutu`; depo tarafı `depo.ts` `CihazYonetimi`. Kaldırma servisin dışındadır: servis onu
 * `cihazGetir` üzerinden her kimlik denetiminde ve `gateway` yoklamasında görür.
 */
import { EslestirmeQr as EslestirmeQrSemasi, kacir, PROTOKOL_SURUMU, sha256Hex, utf8Bayt } from "@eren/protocol";
import type { CihazYonetimi, EslesmeOzeti } from "./depo.ts";
import type { EslestirmeBaslatici } from "./sozlesme.ts";

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

export const eslestirmeBaslat: EslestirmeBaslatici = (b) => {
  const host = b.sistem.tailscaleAdresi();
  if (host === null) return { ok: false, code: "ic_hata", detail: "tailscale_adresi_yok" };

  const kod = kodUret((adet) => b.rastgele.baytlar(adet));
  const sonMs = b.saat.simdiMs() + GECERLILIK_MS;

  const qr = EslestirmeQrSemasi.safeParse({
    v: PROTOKOL_SURUMU,
    host,
    port: b.wsPort,
    kod,
    server_public_key: b.anahtar.acikAnahtar(),
  });
  if (!qr.success) return { ok: false, code: "ic_hata", detail: "qr_gecersiz" };

  try {
    b.depo.eslestirmeYaz({ kod_ozeti: sha256Hex(utf8Bayt(kod)), son_ms: sonMs, yanlis_deneme: 0 });
  } catch {
    return { ok: false, code: "ic_hata", detail: "depo_yazilamadi" };
  }
  return { ok: true, deger: { qr: qr.data, kod, sonMs } };
};

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
].join("\n");

export type EslestirKomutu =
  | { tur: "kod" }
  | { tur: "liste" }
  | { tur: "kaldir"; device_id: string }
  | { tur: "yardim" }
  | { tur: "hata"; ileti: string };

export function argumanCoz(argv: readonly string[]): EslestirKomutu {
  if (argv.length === 0) return { tur: "kod" };
  const [ilk, ...geri] = argv;
  if (ilk === "-h" || ilk === "--help" || ilk === "--yardim") return { tur: "yardim" };
  if (ilk === "--liste") {
    return geri.length === 0 ? { tur: "liste" } : { tur: "hata", ileti: "--liste ek değer almaz" };
  }
  if (ilk === "--kaldir") {
    const id = geri[0];
    if (id === undefined || id.trim() === "" || id.startsWith("--")) return { tur: "hata", ileti: "--kaldir bir cihaz kimliği ister" };
    if (geri.length > 1) return { tur: "hata", ileti: "--kaldir tek kimlik alır" };
    return { tur: "kaldir", device_id: id };
  }
  return { tur: "hata", ileti: `bilinmeyen seçenek: ${gorunur(ilk ?? "")}` };
}

/** Telefonun yolladığı etiket ve kullanıcı girdisi terminale tek satır, kaçırılmış gider. */
const gorunur = (metin: string): string => kacir(metin, AZAMI_GORUNEN);

/** Yerel saatle `YYYY-AA-GG SS:DD`. */
export function yerelZaman(ms: number): string {
  const t = new Date(ms);
  const iki = (n: number): string => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${iki(t.getMonth() + 1)}-${iki(t.getDate())} ${iki(t.getHours())}:${iki(t.getMinutes())}`;
}

const satir = (e: EslesmeOzeti, zaman: (ms: number) => string): string => {
  const etiket = e.etiket === null ? "-" : `"${gorunur(e.etiket)}"`;
  const iptal = e.iptal_ms === null ? "" : `  kaldırıldı ${zaman(e.iptal_ms)}`;
  return `  ${e.device_id}  ${e.platform}  ${etiket}  eşleşme ${zaman(e.eslesme_ms)}${iptal}`;
};

/**
 * Liste çıktısı. Açık anahtar ve IP `EslesmeOzeti`'nde yoktur, burada da yazılmaz. Son görülme
 * tutulmuyor: sütun yok.
 */
export function listeMetni(liste: readonly EslesmeOzeti[], zaman: (ms: number) => string = yerelZaman): string {
  const etkin = liste.filter((e) => e.iptal_ms === null);
  const kaldirilmis = liste.filter((e) => e.iptal_ms !== null);
  const parcalar = [`Eşleşmiş cihazlar (${etkin.length}):`];
  if (etkin.length === 0) parcalar.push("  (yok)");
  for (const e of etkin) parcalar.push(satir(e, zaman));
  if (kaldirilmis.length > 0) {
    parcalar.push(`Kaldırılmış (${kaldirilmis.length}; yetkisi yok, geçmişi durur):`);
    for (const e of kaldirilmis) parcalar.push(satir(e, zaman));
  }
  return `${parcalar.join("\n")}\n`;
}

export interface KomutCiktisi {
  kod: number;
  cikti: string;
  hata: string;
}

/** `--kaldir`: yeni kaldırma ve zaten kaldırılmış 0, bilinmeyen kimlik 1. */
export function cihazKaldirKomutu(
  depo: Pick<CihazYonetimi, "cihazKaldir">,
  device_id: string,
  zaman: (ms: number) => string = yerelZaman,
): KomutCiktisi {
  const s = depo.cihazKaldir(device_id);
  const id = gorunur(device_id);
  switch (s.sonuc) {
    case "kaldirildi":
      return {
        kod: 0,
        cikti:
          `Eşleşme kaldırıldı: ${id}\n` +
          `Bu kimlikle yeni bağlantı kabul edilmez; servis çalışıyorsa açık bağlantıları en geç ${KAPANIS_SURESI_SN} sn içinde kapanır.\n` +
          "Telefonu yeniden kullanmak için yeni eşleştirme gerekir (yeni kimlik).\n",
        hata: "",
      };
    case "zaten_kaldirilmis":
      return { kod: 0, cikti: `Eşleşme zaten kaldırılmış: ${id} (${zaman(s.iptal_ms)})\n`, hata: "" };
    case "bulunamadi":
      return { kod: 1, cikti: "", hata: `Cihaz bulunamadı: ${id}\nKimlikleri görmek için: eslestir --liste\n` };
  }
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

  const { ayarKur } = await import("./ayar.ts");
  const { depoAc } = await import("./depo.ts");
  const { gunlukKur } = await import("./gunluk.ts");
  const { disDunyaKur, dosyaPortuKur } = await import("./dis-dunya.ts");

  const ayar = await ayarKur({
    dosya: dosyaPortuKur(),
    ortam: { ...(process.env as Record<string, string>) },
    execPath: process.execPath,
    baslangicMs: Date.now(),
  });
  const dis = await disDunyaKur({ yollar: ayar.yollar });
  const gunluk = gunlukKur({ kayit: dis.kayit, saat: dis.saat, azamiBayt: 5 * 1024 * 1024, azamiDosya: 3 });
  const depo = depoAc({ yol: ayar.yollar.vt, saat: dis.saat, gunluk, anaSohbetAdi: ayar.asistanAdi });
  try {
    if (komut.tur === "liste") {
      process.stdout.write(listeMetni(depo.eslesmeler()));
      return 0;
    }
    if (komut.tur === "kaldir") {
      const s = cihazKaldirKomutu(depo, komut.device_id);
      if (s.kod === 0) gunluk.uyari("eslestir", "eslesme_kaldirildi", { device_id: komut.device_id });
      process.stdout.write(s.cikti);
      process.stderr.write(s.hata);
      return s.kod;
    }
    const s = eslestirmeBaslat({
      depo,
      anahtar: dis.anahtar,
      sistem: dis.sistem,
      rastgele: dis.rastgele,
      saat: dis.saat,
      wsPort: ayar.wsPort,
    });
    if (!s.ok) {
      process.stderr.write(`Eşleştirme başlatılamadı: ${s.detail ?? s.code}\n`);
      return 1;
    }
    const dakika = Math.round((s.deger.sonMs - dis.saat.simdiMs()) / 60000);
    process.stdout.write(`${JSON.stringify(s.deger.qr)}\n`);
    process.stdout.write(`Parmak izi: ${parmakIzi(s.deger.qr.server_public_key)}\n`);
    process.stdout.write(`Kod:${s.deger.kod}  (${dakika} dakika geçerli, tek kullanımlık)\n`);
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
    () => {
      process.stderr.write("eslestir: beklenmeyen hata\n");
      process.exitCode = 1;
    },
  );
}
