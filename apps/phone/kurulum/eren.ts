// Telefon servisini yöneten küçük komut: eren durum | yeniden-baslat | dur | baslat | log [n] [--bekci]
// ("eren" komut adıdır.) Veri kökü ve görev adı ortamdan: ortam.ts.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { bekciIstegi, guncelSha } from "./kur.ts";
import { ESKI_KOK_BAYRAGI, ayniYolMu, eskiKurulumSorunlari, gorevAdi, uygulamaKoku, veriKoku } from "./ortam.ts";
import type { Ortam } from "./ortam.ts";

const PORT = 47821;

export type LogOlayi = {
  readonly ts_ms: number;
  readonly seviye: string;
  readonly modul: string;
  readonly olay: string;
};

const YARDIM = `Kullanım: eren <komut>
  durum                 görev, bekçi, servis ve son olaylar
  yeniden-baslat        bekçiye "yenile" der (güncel sürümden yeniden başlatır)
  dur                   görevi kapatır, sonra bekçiye "kapan" der (kalıcı durur)
  baslat                görevi açar (/enable), sonra çalıştırır (/run)
                        (dur ve baslat eski kurulumla çakışmada hiçbir şeye dokunmadan durur;
                        eski veri kökü doluyken bilerek sürdürmek için ${ESKI_KOK_BAYRAGI})
  log [n] [--bekci]     son n (varsayılan 20) olay; --bekci ile bekci.log
  yardim | -h           bu yardım`;

export const sureMetni = (ms: number): string => {
  const dk = Math.floor(Math.max(0, ms) / 60000);
  if (dk < 1) return "1 dk'dan az";
  const gun = Math.floor(dk / 1440);
  const sa = Math.floor((dk % 1440) / 60);
  const d = dk % 60;
  const parcalar: string[] = [];
  if (gun > 0) parcalar.push(`${gun} gün`);
  if (gun > 0 || sa > 0) parcalar.push(`${sa} sa`);
  parcalar.push(`${d} dk`);
  return parcalar.join(" ");
};

const yerelSaat = (ms: number): string => {
  const t = new Date(ms);
  const iki = (n: number): string => String(n).padStart(2, "0");
  return `${iki(t.getHours())}:${iki(t.getMinutes())}:${iki(t.getSeconds())}`;
};

export const olayBicimle = (o: LogOlayi): string =>
  `${yerelSaat(o.ts_ms)} ${o.seviye} ${o.modul} ${o.olay}`;

// Dosyanın sonundan en çok `bayt` baytı okur (büyük log'u baştan okumamak için).
const sonBaytlariOku = (yol: string, bayt: number): string => {
  const fd = openSync(yol, "r");
  try {
    const boyut = fstatSync(fd).size;
    const baslangic = Math.max(0, boyut - bayt);
    const tampon = Buffer.alloc(boyut - baslangic);
    readSync(fd, tampon, 0, tampon.length, baslangic);
    return tampon.toString("utf8");
  } finally {
    closeSync(fd);
  }
};

export const sonOlaylar = (yol: string, n: number): readonly LogOlayi[] => {
  if (!existsSync(yol) || n <= 0) return [];
  let metin: string;
  try {
    metin = sonBaytlariOku(yol, Math.max(65536, n * 2048));
  } catch {
    return [];
  }
  const sonuc: LogOlayi[] = [];
  for (const satir of metin.split("\n")) {
    if (satir.trim() === "") continue;
    try {
      const j: unknown = JSON.parse(satir);
      if (typeof j !== "object" || j === null) continue;
      const k = j as Record<string, unknown>;
      if (typeof k.ts_ms !== "number") continue;
      sonuc.push({
        ts_ms: k.ts_ms,
        seviye: typeof k.seviye === "string" ? k.seviye : "?",
        modul: typeof k.modul === "string" ? k.modul : "?",
        olay: typeof k.olay === "string" ? k.olay : "?",
      });
    } catch {
      // bozuk satır (ya da okuma penceresinin yarım ilk satırı): atla
    }
  }
  return sonuc.slice(-n);
};

/** `<veri kökü>\logs` (servis ve bekçi günlükleri). Ortam geçersizse fırlatır. */
export const logDizini = (ortam: Ortam = process.env): string => join(veriKoku(ortam), "logs");

const calistir = (dosya: string, args: readonly string[]): { ok: boolean; cikti: string } => {
  try {
    const cikti = execFileSync(dosya, [...args], {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    return { ok: true, cikti };
  } catch {
    return { ok: false, cikti: "" };
  }
};

const gorevDurumu = (gorev: string): string => {
  const r = calistir("schtasks", ["/query", "/tn", gorev, "/fo", "csv", "/nh"]);
  if (!r.ok) return "görev kayıtlı değil";
  const satir = r.cikti.split(/\r?\n/).find((s) => s.trim() !== "");
  if (satir === undefined) return "görev kayıtlı değil";
  const alanlar = satir.split('","').map((s) => s.replace(/^"|"$/g, ""));
  const durum = alanlar[2] ?? "durum bilinmiyor";
  if (/disabled|devre/i.test(durum)) return "kayıtlı, görev kapalı — eren baslat ile aç";
  return `kayıtlı (${durum})`;
};

const portDinleniyor = (): boolean => {
  const r = calistir("netstat", ["-ano", "-p", "tcp"]);
  if (!r.ok) return false;
  return r.cikti
    .split(/\r?\n/)
    .some((s) => s.includes(`:${PORT} `) && s.includes("LISTENING"));
};

const sayi = (v: unknown): number | null => (typeof v === "number" ? v : null);

const durumKomutu = async (): Promise<number> => {
  const gorev = gorevAdi(process.env);
  console.log(`Veri kökü: ${veriKoku(process.env)}`);
  console.log(`Görev '${gorev}': ${gorevDurumu(gorev)}`);
  const yoklama = { gorevVar: (ad: string) => calistir("schtasks", ["/query", "/tn", ad]).ok, varMi: existsSync };
  for (const s of eskiKurulumSorunlari(process.env, yoklama)) console.log(`UYARI: ${s}`);

  const d = await bekciIstegi("durum");
  let surum: string | null = null;
  if (d === null) {
    console.log("Bekçi: bekçi çalışmıyor");
  } else if (d.ok !== true) {
    console.log(`Bekçi: bekçi cevap vermedi: ${String(d.hata ?? "bilinmeyen")}`);
  } else {
    console.log(`Bekçi: pid ${String(d.bekci_pid)}, durum ${String(d.durum)}`);
    const anaPid = sayi(d.ana_pid);
    const anaBas = sayi(d.ana_baslangic_ms);
    if (anaPid === null) {
      console.log("Ana servis: çalışmıyor");
    } else {
      const sure = anaBas === null ? "?" : sureMetni(Date.now() - anaBas);
      console.log(`Ana servis: pid ${anaPid}, çalışma süresi ${sure}`);
    }
    const kod = sayi(d.son_cikis_kodu);
    const yb = sayi(d.yeniden_baslatma) ?? 0;
    const sonCikis = kod !== null ? String(kod) : yb > 0 ? "öldürüldü/başlatılamadı (kod yok)" : "yok";
    console.log(`Yeniden başlatma: ${yb}, son çıkış: ${sonCikis}`);
    surum = typeof d.surum === "string" ? d.surum : null;
    if (typeof d.veri_koku === "string") {
      console.log(`Bekçinin veri kökü: ${d.veri_koku}`);
      if (!ayniYolMu(d.veri_koku, veriKoku(process.env))) {
        console.log("UYARI: bekçi bu kabuğun veri kökünden başka bir kökte çalışıyor (Görev Zamanlayıcı kalıcı ortamı görür)");
      }
    }
  }

  let guncel: string | null = null;
  try {
    guncel = guncelSha(uygulamaKoku(veriKoku(process.env)));
  } catch {
    guncel = null;
  }
  console.log(`Sürüm: çalışan ${surum ?? "bilinmiyor"}, güncel ${guncel ?? "yok"}`);
  console.log(`Port ${PORT}: ${portDinleniyor() ? "dinleniyor" : "dinlenmiyor"}`);

  for (const [ad, dosya] of [["servis.log", "servis.log"], ["bekci.log", "bekci.log"]] as const) {
    console.log(`\n${ad} son 5 olay:`);
    const olaylar = sonOlaylar(join(logDizini(), dosya), 5);
    if (olaylar.length === 0) console.log("  (olay yok)");
    for (const o of olaylar) console.log(`  ${olayBicimle(o)}`);
  }
  return 0;
};

const bekciyeSoyle = async (komut: "yenile" | "kapan", basari: string): Promise<number> => {
  const c = await bekciIstegi(komut);
  if (c === null) {
    console.error("Bekçi çalışmıyor; komut iletilemedi. Başlatmak için: eren baslat");
    return 1;
  }
  if (c.ok !== true) {
    console.error(`Bekçi cevap vermedi: ${String(c.hata ?? "bilinmeyen hata")}`);
    return 1;
  }
  console.log(basari);
  return 0;
};

export type Bag = {
  readonly schtasks: (args: readonly string[]) => boolean;
  readonly bekci: (komut: "durum" | "kapan", ms?: number) => Promise<Record<string, unknown> | null>;
  readonly uyu: (ms: number) => Promise<void>;
  readonly simdi: () => number;
  readonly canli: (pid: number) => boolean;
  /** Yol var mı (eski kurulum izi); verilmezse existsSync. */
  readonly varMi?: (yol: string) => boolean;
};

export type Secenek = { readonly eskiKokuYoksay?: boolean };

/**
 * `kur.ts` ile aynı eski kurulum koruması (ortam.ts `eskiKurulumSorunlari`): eski görev kayıtlıyken başka
 * adla görev kapatmak/açmak eski görevi bırakır (5 dk içinde servisi geri açar ya da ikinci servis doğar).
 * Sorun varsa hiçbir şeye dokunmadan yazar ve false döner. Görev yoklaması `schtasks /query` (değiştirmez).
 */
const eskiKurulumDenetle = (b: Bag, ortam: Ortam, komut: string, secenek: Secenek): boolean => {
  const sorunlar = eskiKurulumSorunlari(
    ortam,
    { gorevVar: (ad) => b.schtasks(["/query", "/tn", ad]), varMi: b.varMi ?? existsSync },
    { eskiKokuYoksay: secenek.eskiKokuYoksay === true },
  );
  if (sorunlar.length === 0) return true;
  console.error(`eren ${komut} durdu, hiçbir şey değişmedi:\n- ${sorunlar.join("\n- ")}`);
  return false;
};

const pidCanli = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const gercekBag: Bag = {
  schtasks: (args) => calistir("schtasks", args).ok,
  bekci: (komut, ms) => bekciIstegi(komut, ms),
  uyu: (ms) => new Promise((coz) => setTimeout(coz, ms)),
  simdi: () => Date.now(),
  canli: pidCanli,
};

// Bekçi borusu açık ve kapanmıyor mu?
const bekciAyakta = async (b: Bag): Promise<boolean> => {
  const d = await b.bekci("durum", 1000);
  return d !== null && d.ok === true && d.durum !== "kapaniyor";
};

export const durKomutu = async (b: Bag = gercekBag, ortam: Ortam = process.env, secenek: Secenek = {}): Promise<number> => {
  const gorev = gorevAdi(ortam);
  if (!eskiKurulumDenetle(b, ortam, "dur", secenek)) return 1;
  const gorevVar = b.schtasks(["/query", "/tn", gorev]);
  if (gorevVar) {
    if (!b.schtasks(["/change", "/tn", gorev, "/disable"])) {
      console.error("Görev kapatılamadı; servis durdurulmadı (yoksa 5 dk içinde geri gelirdi).");
      return 1;
    }
    console.log(`Görev '${gorev}' kapatıldı (eren baslat ile açılır).`);
  } else {
    console.log(`Görev '${gorev}' kayıtlı değil; servis geri gelmez, doğrudan kapatılıyor.`);
  }
  const d = await b.bekci("durum", 2000);
  const pid = d !== null && d.ok === true ? sayi(d.bekci_pid) : null;
  const c = await b.bekci("kapan");
  if (c === null) {
    console.error("Bekçi çalışmıyor; kapatılacak bir şey yok.");
    return 1;
  }
  if (c.ok !== true) {
    console.error(`Bekçi cevap vermedi: ${String(c.hata ?? "bilinmeyen hata")}`);
    return 1;
  }
  console.log("Kapatma istendi, bekçinin bitmesi bekleniyor...");
  const bitis = b.simdi() + 60000;
  while (b.simdi() < bitis) {
    const boruYok = (await b.bekci("durum", 1000)) === null;
    if (boruYok && (pid === null || !b.canli(pid))) {
      console.log("Servis durdu.");
      return 0;
    }
    await b.uyu(500);
  }
  console.error("Bekçi 60 sn içinde durmadı.");
  return 1;
};

export const baslatKomutu = async (b: Bag = gercekBag, ortam: Ortam = process.env, secenek: Secenek = {}): Promise<number> => {
  const gorev = gorevAdi(ortam);
  if (!eskiKurulumDenetle(b, ortam, "baslat", secenek)) return 1;
  if (!b.schtasks(["/change", "/tn", gorev, "/enable"])) {
    console.error(`Görev '${gorev}' açılamadı (kayıtlı değil olabilir). Önce gorev-kaydet.ts çalıştırılmalı.`);
    return 1;
  }
  if (await bekciAyakta(b)) {
    console.log("Görev açıldı; bekçi zaten çalışıyor.");
    return 0;
  }
  for (let deneme = 1; deneme <= 3; deneme++) {
    const kosuldu = b.schtasks(["/run", "/tn", gorev]);
    if (kosuldu) {
      const bitis = b.simdi() + 10000;
      while (b.simdi() < bitis) {
        if (await bekciAyakta(b)) {
          console.log("Görev başlatıldı, bekçi ayakta.");
          return 0;
        }
        await b.uyu(500);
      }
    }
    if (deneme < 3) await b.uyu(1000);
  }
  console.error("Görev başlatılamadı: bekçi 3 denemede de ortaya çıkmadı (eski görev örneği hâlâ kapanıyor olabilir; biraz sonra tekrar dene).");
  return 1;
};

const logKomutu = (args: readonly string[]): number => {
  const bekci = args.includes("--bekci");
  const sayiArg = args.find((a) => /^\d+$/.test(a));
  const n = sayiArg === undefined ? 20 : Math.max(1, Number(sayiArg));
  const olaylar = sonOlaylar(join(logDizini(), bekci ? "bekci.log" : "servis.log"), n);
  if (olaylar.length === 0) console.log("(olay yok)");
  for (const o of olaylar) console.log(olayBicimle(o));
  return 0;
};

export const calis = async (argv: readonly string[]): Promise<number> => {
  try {
    return await komutCalistir(argv);
  } catch (e) {
    // Ortam hatası (ör. EREN_KIT_DATA_DIR göreli): yığın izi yerine tek satır.
    console.error(`eren: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
};

const komutCalistir = async (argv: readonly string[]): Promise<number> => {
  const [komut, ...geri] = argv;
  switch (komut) {
    case "durum":
      return durumKomutu();
    case "yeniden-baslat":
      return bekciyeSoyle("yenile", "Yeniden başlatma istendi.");
    case "dur":
    case "baslat": {
      const bilinmeyen = geri.find((a) => a !== ESKI_KOK_BAYRAGI);
      if (bilinmeyen !== undefined) {
        console.error(`Bilinmeyen seçenek: ${bilinmeyen}\n${YARDIM}`);
        return 2;
      }
      const secenek = { eskiKokuYoksay: geri.includes(ESKI_KOK_BAYRAGI) };
      return komut === "dur" ? durKomutu(gercekBag, process.env, secenek) : baslatKomutu(gercekBag, process.env, secenek);
    }
    case "log":
      return logKomutu(geri);
    case undefined:
    case "yardim":
    case "-h":
    case "--help":
      console.log(YARDIM);
      return 0;
    default:
      console.error(`Bilinmeyen komut: ${komut}\n${YARDIM}`);
      return 2;
  }
};

if (import.meta.main) {
  process.exitCode = await calis(process.argv.slice(2));
}
