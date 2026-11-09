/**
 * Bekçinin G/Ç katmanı (giriş noktası). Kontrol borusu `\\.\pipe\eren-bekci` (aynı zamanda tekil kilit),
 * ana süreç (Node IPC), `bekci.log`, 1 sn'lik tik. Karar `bekci.ts`'tedir: burası olay verir, dönen eylemi
 * uygular, saati yalnız burası okur. stdout/stderr'e yazmaz (`conhost --headless` ölünce EPIPE).
 * Mimari taramasından muaf; ortak sözleşme "G/Ç katmanı".
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import win32 from "node:path/win32";
import { parseArgs } from "node:util";
import { bekciKur } from "./bekci.ts";
import { veriKokuCoz } from "./veri-koku.ts";
import type { BekciDurumu, BekciEylemi, BekciOlayi } from "./bekci.ts";

const MODUL = "bekci";
const KONTROL_BORUSU = "\\\\.\\pipe\\eren-bekci";
const GUNLUK_AZAMI_BAYT = 1024 * 1024;
/** `bekci.log` dışında tutulan eski dosya: `bekci.1.log`, `bekci.2.log`. */
const GUNLUK_YEDEK = 2;
const AZAMI_DEGER_UZUNLUGU = 200;
const TIK_MS = 1000;
const ISTEK_SURESI_MS = 2000;
const AZAMI_SATIR_BAYT = 4096;
/** `cik` geldiğinde henüz yazılan cevapların boruya inmesi için en çok bu kadar beklenir. */
const CIKIS_BEKLEME_MS = 1000;
/**
 * Ana'nın kendi nazik kapanış sınırından (30 sn) uzun: ana `detached` değil, bekçi çıkınca iş nesnesiyle
 * sert ölür. Ana daha önce çıkarsa beklenmez.
 */
const OLUMCUL_BEKLEME_MS = 35_000;
const TASKKILL_ZAMAN_ASIMI_MS = 15_000;
const KAPANIS_SINYALLERI: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];
const ZORUNLU_ANAHTARLAR: ReadonlySet<string> = new Set(["ts_ms", "seviye", "modul", "olay"]);

type Deger = number | string | boolean | null;
type Alanlar = Readonly<Record<string, Deger>>;
type Seviye = "bilgi" | "uyari" | "hata";
type Cevap = Readonly<Record<string, unknown>>;
type IpcMesaji = { readonly tur: "nabiz"; readonly n: number } | { readonly tur: "kapat" };
type Istek = "durum" | "yenile" | "kapan";

const bos = (): void => {};

const hataKodu = (e: unknown): string | undefined => {
  const k = (e as { code?: unknown } | null | undefined)?.code;
  return typeof k === "string" ? k : undefined;
};

/** Hata iletisi yazılmaz (yol taşıyabilir): yalnız tür adı ve `code`. */
const hataAlanlari = (e: unknown): Alanlar => {
  const kod = hataKodu(e);
  return { hata_turu: e instanceof Error ? e.name : typeof e, ...(kod !== undefined ? { hata_kodu: kod } : {}) };
};

// ---------------------------------------------------------------------------------------------
// Günlük: `servis.log` ile aynı JSON satırı, `modul:"bekci"`, 1 MB'ta döner
// ---------------------------------------------------------------------------------------------

interface Gunluk {
  yaz(seviye: Seviye, olay: string, alanlar?: Alanlar): void;
}

const degerTemizle = (v: unknown): Deger => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.length > AZAMI_DEGER_UZUNLUGU ? v.slice(0, AZAMI_DEGER_UZUNLUGU) : v;
  if (typeof v === "boolean") return v;
  return null;
};

/**
 * `gunluk.ts` yeniden kullanılmaz: `kod` anahtarını `[gizli]` yapar, çekirdeğin `ana_cikti {kod}` alanı
 * çıkış kodudur. `dis-dunya.ts`'in kayıt portu dışa aktarılmaz; burası onun küçük kopyası.
 */
const gunlukKur = (dizin: string | null): Gunluk => {
  if (dizin === null) return { yaz: bos };
  const yol = win32.join(dizin, "bekci.log");
  const yedek = (n: number): string => win32.join(dizin, `bekci.${n}.log`);
  let boyut = 0;
  try {
    boyut = statSync(yol).size;
  } catch {
    boyut = 0;
  }
  const dondur = (): void => {
    try {
      rmSync(yedek(GUNLUK_YEDEK), { force: true });
      for (let n = GUNLUK_YEDEK - 1; n >= 1; n -= 1) {
        if (existsSync(yedek(n))) renameSync(yedek(n), yedek(n + 1));
      }
      if (existsSync(yol)) renameSync(yol, yedek(1));
      boyut = 0;
    } catch {
      try {
        boyut = statSync(yol).size;
      } catch {
        boyut = 0;
      }
    }
  };
  return {
    yaz: (seviye, olay, alanlar = {}) => {
      try {
        const nesne: Record<string, unknown> = { ts_ms: Date.now(), seviye, modul: MODUL, olay };
        for (const [k, v] of Object.entries(alanlar)) {
          nesne[ZORUNLU_ANAHTARLAR.has(k) ? `alan_${k}` : k] = degerTemizle(v);
        }
        const satir = `${JSON.stringify(nesne)}\n`;
        try {
          appendFileSync(yol, satir);
        } catch (e) {
          if (hataKodu(e) !== "ENOENT") throw e;
          mkdirSync(dizin, { recursive: true });
          appendFileSync(yol, satir);
        }
        boyut += Buffer.byteLength(satir);
        if (boyut > GUNLUK_AZAMI_BAYT) dondur();
      } catch {
        // günlük hatası bekçiyi düşürmez
      }
    },
  };
};

/**
 * Veri kökü: servisle aynı kural (`EREN_KIT_DATA_DIR`, yoksa `%LOCALAPPDATA%\eren-kit`); çözülemezse null.
 * `ayar.ts` içe aktarılmaz: bekçi `@eren/protocol`'e bağlı kalmasın; kural bağımlılıksız `veri-koku.ts`'ten.
 * Ana bekçinin ortamını değiştirmeden devralır (`spawn`'a `env` verilmez): ana'nın kökü de budur.
 */
const veriKokuBul = (): string | null => {
  const r = veriKokuCoz(process.env);
  return r.ok ? r.kok : null;
};

/** `<veri kökü>\logs`. */
const gunlukDizini = (kok: string | null): string | null => (kok === null ? null : win32.join(kok, "logs"));

/**
 * Kontrol borusunun `durum` cevabı. `veri_koku`: kurulum, yeni sürümün beklenen veri kökünde çalıştığını
 * bununla doğrular (Görev Zamanlayıcı kalıcı ortamı görmezse servis başka köke açılır).
 */
export const durumCevabiYap = (g: {
  readonly bekciPid: number;
  readonly baslangicMs: number;
  readonly durum: BekciDurumu;
  readonly surum: string | null;
  readonly anaYolu: string;
  readonly veriKoku: string | null;
}): Readonly<Record<string, unknown>> => ({
  ok: true,
  bekci_pid: g.bekciPid,
  bekci_baslangic_ms: g.baslangicMs,
  durum: g.durum.durum,
  ana_pid: g.durum.anaPid,
  ana_baslangic_ms: g.durum.anaBaslangicMs,
  yeniden_baslatma: g.durum.yenidenBaslatma,
  son_cikis_kodu: g.durum.sonCikisKodu,
  son_nabiz_ms: g.durum.sonNabizMs,
  surum: g.surum,
  ana_yolu: g.anaYolu,
  veri_koku: g.veriKoku,
});

// ---------------------------------------------------------------------------------------------
// Yollar, sürüm, öldürme
// ---------------------------------------------------------------------------------------------

/** `<sürüm>\server\src\ana.ts` → `<sürüm>`. */
const surumDizini = (anaYolu: string): string => win32.dirname(win32.dirname(win32.dirname(anaYolu)));

/** Junction realpath ile çözülür: `guncel` değil, çalışacak sürümün `surum.json`'u okunur. */
const surumOku = (anaYolu: string): string | null => {
  try {
    const metin = readFileSync(win32.join(surumDizini(realpathSync(anaYolu)), "surum.json"), "utf8");
    const j: unknown = JSON.parse(metin.replace(/^\uFEFF/, ""));
    const sha = typeof j === "object" && j !== null ? (j as { sha?: unknown }).sha : undefined;
    return typeof sha === "string" && sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
};

const dizinMi = (yol: string): boolean => {
  try {
    return statSync(yol).isDirectory();
  } catch {
    return false;
  }
};

const sistemKoku = (): string => process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
const taskkillYolu = (): string => win32.join(sistemKoku(), "System32", "taskkill.exe");

/** Varsayılan: bekçinin kendi dizinindeki `ana.ts`. `argv[1]` junction'ı korur (`import.meta` realpath verir). */
const argumanlariCoz = (): { readonly anaYolu: string } | null => {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { ana: { type: "string" } },
      strict: true,
      allowPositionals: false,
    });
    if (values.ana !== undefined) return values.ana === "" ? null : { anaYolu: win32.resolve(values.ana) };
    const kendisi = process.argv[1] ?? import.meta.filename;
    return { anaYolu: win32.join(win32.dirname(win32.resolve(kendisi)), "ana.ts") };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------
// Kontrol borusu
// ---------------------------------------------------------------------------------------------

const istekCoz = (satir: string): Istek | "bozuk_istek" | "bilinmeyen_komut" => {
  let j: unknown;
  try {
    j = JSON.parse(satir);
  } catch {
    return "bozuk_istek";
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return "bozuk_istek";
  const komut = (j as { komut?: unknown }).komut;
  if (typeof komut !== "string") return "bozuk_istek";
  return komut === "durum" || komut === "yenile" || komut === "kapan" ? komut : "bilinmeyen_komut";
};

/** Dinleme `EADDRINUSE` verirse başka bekçi var. */
const boruAc = (baglanti: (s: Socket) => void): Promise<Server | "mesgul"> =>
  new Promise((coz, reddet) => {
    const sunucu = createServer(baglanti);
    sunucu.once("error", (e) => {
      if (hataKodu(e) === "EADDRINUSE") coz("mesgul");
      else reddet(e);
    });
    sunucu.listen(KONTROL_BORUSU, () => {
      sunucu.removeAllListeners("error");
      sunucu.on("error", bos);
      coz(sunucu);
    });
  });

// ---------------------------------------------------------------------------------------------
// Giriş
// ---------------------------------------------------------------------------------------------

const giris = async (): Promise<void> => {
  process.stdout.on("error", bos);
  process.stderr.on("error", bos);

  const baslangicMs = Date.now();
  const veriKoku = veriKokuBul();
  const gunluk = gunlukKur(gunlukDizini(veriKoku));

  let cocuk: ChildProcess | null = null;
  let sunucu: Server | null = null;
  let tik: NodeJS.Timeout | null = null;
  let surum: string | null = null;
  /** `cik` ya da ölümcül hata: çekirdeğe olay verilmez, eylem uygulanmaz. */
  let bitiyor = false;
  let cikisKodu: number | null = null;
  let olumculBasladi = false;
  const acikBaglantilar = new Set<Socket>();

  const canli = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;

  // Kontrol borusu ve ana henüz yokken de çalışır: o zaman doğrudan `exit(1)`.
  const olumcul = (olay: string, e: unknown): void => {
    if (olumculBasladi) process.exit(1);
    olumculBasladi = true;
    bitiyor = true;
    gunluk.yaz("hata", olay, hataAlanlari(e));
    if (tik !== null) clearInterval(tik);
    try {
      sunucu?.close();
    } catch {
      // kapanmasa da süreç birazdan çıkar
    }
    const c = cocuk;
    if (c === null || !canli(c) || !c.connected) process.exit(1);
    try {
      c.send({ tur: "kapat" } satisfies IpcMesaji, bos);
    } catch {
      process.exit(1);
    }
    c.once("exit", () => process.exit(1));
    setTimeout(() => process.exit(1), OLUMCUL_BEKLEME_MS);
  };
  process.on("uncaughtException", (e, kaynak) => {
    olumcul(kaynak === "unhandledRejection" ? "yakalanmamis_ret" : "yakalanmamis_hata", e);
  });

  const argumanlar = argumanlariCoz();
  if (argumanlar === null) {
    gunluk.yaz("hata", "arguman_hatasi");
    process.exit(1);
  }
  const { anaYolu } = argumanlar;
  const bekci = bekciKur();

  // --- olay kuyruğu: eylem uygularken doğan olay (ör. eşzamanlı başlatma hatası) sıraya girer ---
  const kuyruk: BekciOlayi[] = [];
  let isleniyor = false;
  const olayVer = (o: BekciOlayi): void => {
    if (bitiyor) return;
    kuyruk.push(o);
    if (isleniyor) return;
    isleniyor = true;
    try {
      for (let s = kuyruk.shift(); s !== undefined; s = kuyruk.shift()) {
        for (const eylem of bekci.olay(s)) {
          if (bitiyor) return;
          uygula(eylem);
        }
      }
    } finally {
      isleniyor = false;
    }
  };

  // --- ana süreç ---
  const ipcGonder = (m: IpcMesaji): void => {
    const c = cocuk;
    if (c === null || !canli(c) || !c.connected) {
      if (m.tur === "kapat") gunluk.yaz("uyari", "ipc_yok", { tur: m.tur });
      return;
    }
    try {
      c.send(m, (hata) => {
        if (hata) gunluk.yaz("uyari", "ipc_gonderilemedi", { tur: m.tur, ...hataAlanlari(hata) });
      });
    } catch (hata) {
      gunluk.yaz("uyari", "ipc_gonderilemedi", { tur: m.tur, ...hataAlanlari(hata) });
    }
  };

  const anaBaslat = (): void => {
    if (cocuk !== null) {
      // Çekirdek tek ana bekler; ikinci süreç açılmaz.
      gunluk.yaz("uyari", "ana_zaten_var", { pid: cocuk.pid ?? null });
      return;
    }
    surum = surumOku(anaYolu);
    const ust = surumDizini(anaYolu);
    let c: ChildProcess;
    try {
      c = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", anaYolu], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
        detached: false,
        cwd: dizinMi(ust) ? ust : process.cwd(),
      });
    } catch (hata) {
      gunluk.yaz("hata", "ana_baslatilamadi", hataAlanlari(hata));
      olayVer({ tur: "ana_baslatilamadi", simdi: Date.now() });
      return;
    }
    cocuk = c;
    let sonlandi = false;
    const sonlan = (o: BekciOlayi): void => {
      if (sonlandi) return;
      sonlandi = true;
      if (cocuk === c) cocuk = null;
      olayVer(o);
    };
    c.once("spawn", () => {
      const pid = c.pid;
      if (pid === undefined) return;
      gunluk.yaz("bilgi", "ana_baslatildi", { pid, surum_var: surum !== null });
      olayVer({ tur: "ana_basladi", simdi: Date.now(), pid });
    });
    c.on("error", (hata) => {
      // `pid` yoksa başlatma hatasıdır; sonrakiler (ör. IPC) yalnız yazılır.
      if (c.pid === undefined) {
        gunluk.yaz("hata", "ana_baslatilamadi", hataAlanlari(hata));
        sonlan({ tur: "ana_baslatilamadi", simdi: Date.now() });
      } else {
        gunluk.yaz("uyari", "ana_surec_hatasi", hataAlanlari(hata));
      }
    });
    c.on("message", (m: unknown) => {
      if (typeof m !== "object" || m === null || cocuk !== c) return;
      const { tur, n } = m as { tur?: unknown; n?: unknown };
      if (tur === "nabiz_cevap" && typeof n === "number" && Number.isSafeInteger(n)) {
        olayVer({ tur: "nabiz_cevap", simdi: Date.now(), n });
      }
    });
    c.once("exit", (kod) => sonlan({ tur: "ana_cikti", simdi: Date.now(), kod }));
  };

  /** Ağaç öldürme yok: `detached` iş süreçleri yaşamalı. Önce süreç tutamacıyla, olmazsa `/T`'siz `taskkill`. */
  const zorlaOldur = (): void => {
    const c = cocuk;
    if (c === null || !canli(c)) return;
    const pid = c.pid ?? null;
    let yontem = "kill";
    let oldu = false;
    try {
      oldu = c.kill("SIGKILL");
    } catch {
      oldu = false;
    }
    if (!oldu && pid !== null) {
      yontem = "taskkill";
      try {
        const t = spawn(taskkillYolu(), ["/PID", String(pid), "/F"], {
          stdio: "ignore",
          windowsHide: true,
          detached: false,
        });
        t.on("error", bos);
        const sure = setTimeout(() => t.kill(), TASKKILL_ZAMAN_ASIMI_MS);
        t.once("exit", () => clearTimeout(sure));
      } catch {
        yontem = "yok";
      }
    }
    gunluk.yaz("uyari", "ana_zorla_olduruldu", { pid, yontem });
  };

  // --- çıkış ---
  const cikisiBitir = (): void => {
    if (cikisKodu !== null && acikBaglantilar.size === 0) process.exit(cikisKodu);
  };
  const cikis = (kod: number): void => {
    if (bitiyor) return;
    bitiyor = true;
    cikisKodu = kod;
    if (tik !== null) clearInterval(tik);
    gunluk.yaz("bilgi", "bekci_cikiyor", { kod });
    sunucu?.close();
    setTimeout(() => process.exit(kod), CIKIS_BEKLEME_MS);
    cikisiBitir();
  };

  const uygula = (e: BekciEylemi): void => {
    switch (e.tur) {
      case "ana_baslat":
        anaBaslat();
        return;
      case "nabiz_gonder":
        ipcGonder({ tur: "nabiz", n: e.n });
        return;
      case "kapat_iste":
        ipcGonder({ tur: "kapat" });
        return;
      case "zorla_oldur":
        zorlaOldur();
        return;
      case "gunluk":
        gunluk.yaz(e.seviye, e.olay, e.alanlar);
        return;
      case "cik":
        cikis(e.kod);
        return;
    }
  };

  // --- kontrol borusu bağlantısı: tek satır istek, tek satır cevap, kapat ---
  const durumCevabi = (): Cevap =>
    durumCevabiYap({ bekciPid: process.pid, baslangicMs, durum: bekci.durum(), surum, anaYolu, veriKoku });

  const baglantiIsle = (soket: Socket): void => {
    acikBaglantilar.add(soket);
    let cevaplandi = false;
    let tampon: Buffer = Buffer.alloc(0);
    const sure = setTimeout(() => soket.destroy(), ISTEK_SURESI_MS);
    soket.on("error", () => soket.destroy());
    soket.once("close", () => {
      clearTimeout(sure);
      acikBaglantilar.delete(soket);
      cikisiBitir();
    });
    const cevapla = (c: Cevap): void => {
      cevaplandi = true;
      clearTimeout(sure);
      soket.end(`${JSON.stringify(c)}\n`, () => soket.destroy());
      setTimeout(() => soket.destroy(), ISTEK_SURESI_MS).unref();
    };
    soket.on("data", (parca: Buffer) => {
      if (cevaplandi) return;
      tampon = tampon.length === 0 ? parca : Buffer.concat([tampon, parca]);
      const i = tampon.indexOf(0x0a);
      if (i < 0 ? tampon.length > AZAMI_SATIR_BAYT : i > AZAMI_SATIR_BAYT) {
        cevapla({ ok: false, hata: "bozuk_istek" });
        return;
      }
      if (i < 0) return;
      const istek = istekCoz(tampon.subarray(0, i).toString("utf8"));
      if (istek === "bozuk_istek" || istek === "bilinmeyen_komut") {
        cevapla({ ok: false, hata: istek });
        return;
      }
      if (istek === "durum") {
        cevapla(durumCevabi());
        return;
      }
      // Cevap önce yazılır: `kapan` ana yokken hemen `cik` üretir.
      cevapla({ ok: true });
      gunluk.yaz("bilgi", "komut_alindi", { komut: istek });
      olayVer({ tur: "komut", simdi: Date.now(), komut: istek });
    });
  };

  try {
    const sonuc = await boruAc(baglantiIsle);
    if (sonuc === "mesgul") {
      gunluk.yaz("bilgi", "bekci_ikinci_ornek", { pid: process.pid });
      process.exit(0);
    }
    sunucu = sonuc;
  } catch (e) {
    gunluk.yaz("hata", "boru_acilamadi", hataAlanlari(e));
    process.exit(1);
  }

  olayVer({ tur: "basla", simdi: Date.now() });
  tik = setInterval(() => olayVer({ tur: "tik", simdi: Date.now() }), TIK_MS);
  for (const sinyal of KAPANIS_SINYALLERI) {
    process.on(sinyal, () => {
      gunluk.yaz("bilgi", "sinyal", { sinyal });
      olayVer({ tur: "komut", simdi: Date.now(), komut: "kapan" });
    });
  }
};

if (import.meta.main) await giris();
