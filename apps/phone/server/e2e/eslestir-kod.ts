/**
 * Düzenek için eşleştirme kodu: `src/eslestir.ts` komutunun eşi, tek farkı Tailscale adresinin
 * sabit `100.64.0.1` olması (gerçek adres QR'a girmesin). Aynı veritabanına ikinci süreç olarak yazar.
 * Çıktı stdout'ta tek satır JSON: {kod, qr}. Yalnız geçici LOCALAPPDATA ile çalıştırılır.
 */
import { ayarKur } from "../src/ayar.ts";
import { depoKur } from "../src/depo.ts";
import { disDunyaKur, dosyaPortuKur } from "../src/dis-dunya.ts";
import { eslestirmeBaslat } from "../src/eslestir.ts";
import { gunlukKur } from "../src/gunluk.ts";

const ortam: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) ortam[k] = v;

// Ayrı süreçtir, `baslangicMs`'i kullanmaz (`src/eslestir.ts` gibi).
const ayar = await ayarKur({ dosya: dosyaPortuKur(), ortam, execPath: process.execPath, baslangicMs: Date.now() });
const dis = await disDunyaKur({ yollar: ayar.yollar });
const gunluk = gunlukKur({ kayit: dis.kayit, saat: dis.saat, azamiBayt: 5 * 1024 * 1024, azamiDosya: 3 });
const depo = depoKur({ yol: ayar.yollar.vt, saat: dis.saat, gunluk, anaSohbetAdi: ayar.asistanAdi });
try {
  const s = eslestirmeBaslat({
    depo,
    anahtar: dis.anahtar,
    sistem: { ...dis.sistem, tailscaleAdresi: () => "100.64.0.1" },
    rastgele: dis.rastgele,
    saat: dis.saat,
    wsPort: ayar.wsPort,
  });
  if (!s.ok) {
    process.stderr.write(`eslestirme_hatasi ${s.code} ${s.detail ?? ""}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({ kod: s.deger.kod, qr: s.deger.qr })}\n`);
  }
} finally {
  depo.kapat();
}
