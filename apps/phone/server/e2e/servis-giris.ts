/**
 * Uçtan uca düzeneğin servis girişi. Sıra `src/ana.ts` `giris` ile aynıdır; tek fark sarılan dış
 * dünyadır:
 * - `sistem.tailscaleAdresi()` hep `100.64.0.1` döner (gerçek Tailscale kullanılmaz),
 * - `ws.dinle` gerçekte `127.0.0.1`'de, düzeneğin seçtiği boş portta dinler,
 * - her WebSocket bağlantısının `uzakIp`'i `100.64.0.2` görünür,
 * - ana oturumun (`boruluBaslat`) stdin ve stdout satırları gözlem için dosyaya kopyalanır; davranış değişmez.
 * Bu sarmalama gateway'in ağ denetimlerini (gerçek adres, gerçek uzak IP) atlar; onlar birim testlerde.
 *
 * Ortam: LOCALAPPDATA (geçici), EREN_KIT_DATA_DIR (düzeneğin veri kökü), E2E_WS_PORT, E2E_TEE (ana oturum satır kopyası), E2E_DURUM (hazır işareti).
 * Stdin'den "kapat" satırı düzenli kapanış ister (Windows'ta dışarıdan sinyal yollanamaz).
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { servisKur } from "../src/ana.ts";
import { ayarKur } from "../src/ayar.ts";
import { disDunyaKur, dosyaPortuKur } from "../src/dis-dunya.ts";
import { gunlukKur } from "../src/gunluk.ts";
import type { BoruluSurec, DisDunya, Ortam, WsBaglantisi } from "../src/sozlesme.ts";

const SAHTE_PC_IP = "100.64.0.1";
const SAHTE_TELEFON_IP = "100.64.0.2";

const port = Number(process.env["E2E_WS_PORT"]);
const teeYolu = process.env["E2E_TEE"] ?? "";
const durumYolu = process.env["E2E_DURUM"] ?? "";

const teeYaz = (kayit: Record<string, unknown>): void => {
  if (teeYolu === "") return;
  try {
    appendFileSync(teeYolu, `${JSON.stringify({ ts: Date.now(), ...kayit })}\n`);
  } catch {
    // gözlem kaybı servisi durdurmaz
  }
};

const argDegeri = (argv: readonly string[], bayrak: string): string | null => {
  const i = argv.indexOf(bayrak);
  return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
};

const baglantiSar = (b: WsBaglantisi): WsBaglantisi => ({
  yol: b.yol,
  uzakIp: SAHTE_TELEFON_IP,
  yetenekler: b.yetenekler,
  gonder: (m) => b.gonder(m),
  kapat: (k, n) => b.kapat(k, n),
  mesajDinle: (f) => b.mesajDinle(f),
  kapanisDinle: (f) => b.kapanisDinle(f),
  kimlikDogrulandi: () => b.kimlikDogrulandi(),
});

const sar = (d: DisDunya): DisDunya => ({
  ...d,
  sistem: { ...d.sistem, tailscaleAdresi: () => SAHTE_PC_IP },
  ws: {
    dinle: (istek) =>
      d.ws.dinle({ ...istek, host: "127.0.0.1", port, baglanti: (b) => istek.baglanti(baglantiSar(b)) }),
  },
  surec: {
    ...d.surec,
    boruluBaslat: async (istek) => {
      const s = await d.surec.boruluBaslat(istek);
      const resume = argDegeri(istek.argv, "--resume");
      teeYaz({
        pid: s.pid,
        olusturmaMs: s.olusturmaMs,
        yon: "basla",
        kip: resume === null ? "yeni" : "resume",
        session_id: resume ?? argDegeri(istek.argv, "--session-id"),
        model: argDegeri(istek.argv, "--model"),
        bayraklar: istek.argv.filter((a) => a.startsWith("--")),
      });
      const sarili: BoruluSurec = {
        pid: s.pid,
        olusturmaMs: s.olusturmaMs,
        satirYaz: (satir) => {
          teeYaz({ pid: s.pid, yon: "in", satir });
          return s.satirYaz(satir);
        },
        stdinKapat: () => {
          teeYaz({ pid: s.pid, yon: "stdin_kapat" });
          s.stdinKapat();
        },
        stdoutSatirDinle: (f) =>
          s.stdoutSatirDinle((satir) => {
            teeYaz({ pid: s.pid, yon: "out", satir });
            f(satir);
          }),
        stderrDinle: (f) => s.stderrDinle(f),
        cikisDinle: (f) =>
          s.cikisDinle(() => {
            teeYaz({ pid: s.pid, yon: "cikis" });
            f();
          }),
      };
      return sarili;
    },
  },
});

const ortamKopyasi = (): Ortam => {
  const kopya: Record<string, string> = {};
  for (const [ad, deger] of Object.entries(process.env)) if (deger !== undefined) kopya[ad] = deger;
  return kopya;
};

const bos = (): void => {};

const giris = async (): Promise<void> => {
  // `src/ana.ts` gibi: süreç başında bir kez, `server_status.servis.baslangic_ms`.
  const baslangicMs = Date.now();
  process.on("uncaughtException", (e) => {
    process.stderr.write(`e2e servis: yakalanmamis_hata ${e instanceof Error ? e.name : typeof e}\n`);
    process.exit(1);
  });
  process.stdout.on("error", bos);
  process.stderr.on("error", bos);
  if (!Number.isInteger(port) || port <= 0) throw new Error("E2E_WS_PORT yok");

  const ayar = await ayarKur({
    dosya: dosyaPortuKur(),
    ortam: ortamKopyasi(),
    execPath: process.execPath,
    baslangicMs,
  });
  const dunya = sar(await disDunyaKur({ yollar: ayar.yollar }));
  const g = gunlukKur({ kayit: dunya.kayit, saat: dunya.saat, azamiBayt: 10 * 1024 * 1024, azamiDosya: 5 });
  const { kok, log, islerDizini, erenCwd, vt } = ayar.yollar;
  for (const dizin of [kok, log.replace(/\\[^\\]+$/, ""), islerDizini, erenCwd]) await dunya.dosya.dizinOlustur(dizin);

  if (!(await dunya.tekilKilit.al())) {
    g.bilgi("e2e", "ikinci_ornek");
    process.exit(0);
  }

  const servis = servisKur({ dunya, ayar, depoYolu: vt });
  let kapaniyor = false;
  const kapat = (neden: string): void => {
    if (kapaniyor) return;
    kapaniyor = true;
    g.bilgi("e2e", "kapaniyor", { neden });
    setTimeout(() => process.exit(1), 30_000).unref();
    void servis.kapat().finally(() => process.exit(0));
  };
  const satirlar = createInterface({ input: process.stdin });
  satirlar.on("line", (s) => {
    if (s.trim() === "kapat") kapat("stdin");
  });

  await servis.baslat();
  g.bilgi("e2e", "basladi", { pid: process.pid, port });
  if (durumYolu !== "") writeFileSync(durumYolu, JSON.stringify({ hazir: true, pid: process.pid, port, ts: Date.now() }));
};

await giris();
