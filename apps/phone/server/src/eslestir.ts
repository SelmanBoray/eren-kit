/**
 * Yerel `eren eslestir` komutu. Saf çekirdek `eslestirmeBaslat`; komut satırı ince bir kabuktur
 * ve yalnız bu dosya doğrudan çalıştırılınca devreye girer. MODULLER.md "### eslestir" [karar].
 */
import { EslestirmeQr as EslestirmeQrSemasi, PROTOKOL_SURUMU, sha256Hex, utf8Bayt } from "@eren/protocol";
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
// Komut satırı. Düz kod yalnız terminale yazılır; günlüğe ve depoya girmez.
// ---------------------------------------------------------------------------------------------

async function komutCalistir(): Promise<number> {
  const { ayarKur } = await import("./ayar.ts");
  const { depoKur } = await import("./depo.ts");
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
  const depo = depoKur({ yol: ayar.yollar.vt, saat: dis.saat, gunluk, anaSohbetAdi: ayar.asistanAdi });
  try {
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
  komutCalistir().then(
    (kod) => {
      process.exitCode = kod;
    },
    () => {
      process.stderr.write("Eşleştirme başlatılamadı: beklenmeyen hata\n");
      process.exitCode = 1;
    },
  );
}
