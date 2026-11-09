/**
 * Veri kökü, görev adı ve eski kurulum korumaları (ortam.ts) ile bunların kur.ts, eren.ts ve
 * gorev-kaydet.ts'e bağlanışı. Görev Zamanlayıcı'ya yazmaz, %LOCALAPPDATA%'ya dokunmaz: ortam sahte,
 * dosyalar os.tmpdir() altındaki geçici dizinde; alt süreçler yalnız salt okunur kiplerde çalışır.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ESKI_KOK_BAYRAGI,
  VARSAYILAN_GOREV_ADI,
  eskiKurulumSorunlari,
  gorevAdi,
  kaliciOrtamKarsilastir,
  uygulamaKoku,
  veriKoku,
} from "../ortam.ts";
import type { Ortam, Yoklama } from "../ortam.ts";
import { hedefKoku } from "../kur.ts";
import { baslatKomutu, durKomutu, logDizini } from "../eren.ts";
import type { Bag } from "../eren.ts";
import { gorevXml } from "../gorev-kaydet.ts";

const LA = "C:\\ornek\\Yerel";
const ESKI_KOK = "C:\\ornek\\Yerel\\Eren";
/** Mevcut kurulumu sürdüren üç değişken (sözleşme §4). */
const MEVCUT: Ortam = {
  LOCALAPPDATA: LA,
  EREN_KIT_DATA_DIR: ESKI_KOK,
  EREN_KIT_PHONE_TASK_NAME: "Eren",
  EREN_KIT_ASSISTANT_NAME: "Eren",
};

const KURULUM = path.resolve(import.meta.dirname, "..");
const UYARI = "--disable-warning=ExperimentalWarning";

/** Gerçek ortamdan EREN_KIT_* ayıklanmış kopya + verilen değerler (alt süreçler için). */
const altOrtam = (ek: Record<string, string>): NodeJS.ProcessEnv => {
  const o: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.toUpperCase().startsWith("EREN_KIT_")) o[k] = v;
  return { ...o, ...ek };
};

const geciciler: string[] = [];
const gecici = (): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "eren-ortam-")));
  geciciler.push(d);
  return d;
};
const temizle = (): void => {
  while (geciciler.length > 0) fs.rmSync(geciciler.pop() as string, { recursive: true, force: true });
};

/** Sahte yoklama: verilen görevler kayıtlı, verilen yollar var (büyük küçük harf duyarsız). */
const yoklama = (gorevler: readonly string[], yollar: readonly string[]): Yoklama => ({
  gorevVar: (ad) => gorevler.some((g) => g.toLowerCase() === ad.toLowerCase()),
  varMi: (y) => yollar.some((p) => p.toLowerCase() === y.toLowerCase()),
});
const ESKI_IZLER = [`${ESKI_KOK}\\uygulama`, `${ESKI_KOK}\\eren.db`];

// --- veri kökü --------------------------------------------------------------------------------

test("veriKoku ortamsız: %LOCALAPPDATA%\\eren-kit", () => {
  assert.equal(veriKoku({ LOCALAPPDATA: LA }), "C:\\ornek\\Yerel\\eren-kit");
  assert.equal(uygulamaKoku(veriKoku({ LOCALAPPDATA: LA })), "C:\\ornek\\Yerel\\eren-kit\\uygulama");
  assert.equal(hedefKoku({ LOCALAPPDATA: LA }), "C:\\ornek\\Yerel\\eren-kit\\uygulama");
});

test("veriKoku ortamlı: EREN_KIT_DATA_DIR olduğu gibi (normalize), anahtar büyük küçük harf duyarsız", () => {
  assert.equal(veriKoku({ LOCALAPPDATA: LA, EREN_KIT_DATA_DIR: "D:\\Veri\\kit" }), "D:\\Veri\\kit");
  assert.equal(veriKoku({ LOCALAPPDATA: LA, EREN_KIT_DATA_DIR: "E:/a/../b" }), "E:\\b");
  assert.equal(veriKoku({ LOCALAPPDATA: LA, eren_kit_data_dir: "D:\\Veri\\kit" }), "D:\\Veri\\kit");
  // LOCALAPPDATA yokken de özel kök yeter (server/src/veri-koku.ts ile aynı)
  assert.equal(veriKoku({ EREN_KIT_DATA_DIR: "D:\\Veri\\kit" }), "D:\\Veri\\kit");
  // boş değer yok sayılır
  assert.equal(veriKoku({ LOCALAPPDATA: LA, EREN_KIT_DATA_DIR: "" }), "C:\\ornek\\Yerel\\eren-kit");
  assert.equal(hedefKoku({ LOCALAPPDATA: LA, EREN_KIT_DATA_DIR: "D:\\Veri\\kit" }), "D:\\Veri\\kit\\uygulama");
});

test("veriKoku mevcut kurulum: üç değişkenle eski yolun aynısı", () => {
  assert.equal(hedefKoku(MEVCUT), "C:\\ornek\\Yerel\\Eren\\uygulama");
});

test("veriKoku göreli yol hatası: EREN_KIT_DATA_DIR mutlak olmalı; LOCALAPPDATA yok/göreli", () => {
  for (const goreli of ["veri", ".\\veri", "C:veri", "..\\x"]) {
    assert.throws(() => veriKoku({ LOCALAPPDATA: LA, EREN_KIT_DATA_DIR: goreli }), /EREN_KIT_DATA_DIR mutlak yol olmalı/, goreli);
    assert.throws(() => hedefKoku({ LOCALAPPDATA: LA, EREN_KIT_DATA_DIR: goreli }), /mutlak yol olmalı/);
  }
  assert.throws(() => veriKoku({}), /LOCALAPPDATA tanımlı ve mutlak yol olmalı/);
  assert.throws(() => veriKoku({ LOCALAPPDATA: "Yerel" }), /LOCALAPPDATA/);
});

// --- görev adı --------------------------------------------------------------------------------

test("gorevAdi ortamsız: eren-kit-telefon; ortamlı: verilen ad (kırpılır)", () => {
  assert.equal(VARSAYILAN_GOREV_ADI, "eren-kit-telefon");
  assert.equal(gorevAdi({}), "eren-kit-telefon");
  assert.equal(gorevAdi({ EREN_KIT_PHONE_TASK_NAME: "   " }), "eren-kit-telefon");
  assert.equal(gorevAdi({ EREN_KIT_PHONE_TASK_NAME: "Eren" }), "Eren");
  assert.equal(gorevAdi({ EREN_KIT_PHONE_TASK_NAME: "  Benim Görevim " }), "Benim Görevim");
  assert.equal(gorevAdi({ eren_kit_phone_task_name: "x" }), "x");
});

test("gorevAdi geçersiz: tırnak ya da denetim karakteri reddedilir", () => {
  assert.throws(() => gorevAdi({ EREN_KIT_PHONE_TASK_NAME: 'a"b' }), /EREN_KIT_PHONE_TASK_NAME/);
  assert.throws(() => gorevAdi({ EREN_KIT_PHONE_TASK_NAME: "a\nb" }), /EREN_KIT_PHONE_TASK_NAME/);
});

// --- eski kurulum korumaları ------------------------------------------------------------------

test("eski kurulum: temiz makinede ortamsız kurulum serbest", () => {
  assert.deepEqual(eskiKurulumSorunlari({ LOCALAPPDATA: LA }, yoklama([], [])), []);
});

test("eski kurulum: ortamsız + eski görev + dolu eski kök → iki sorun (iki servis, bölünmüş veri)", () => {
  const s = eskiKurulumSorunlari({ LOCALAPPDATA: LA }, yoklama(["Eren"], ESKI_IZLER));
  assert.equal(s.length, 2);
  assert.match(s[0] ?? "", /eski 'Eren' görevi kayıtlı.*eren-kit-telefon.*iki görev/);
  assert.match(s[0] ?? "", /EREN_KIT_PHONE_TASK_NAME=Eren/);
  assert.match(s[1] ?? "", /veri bölünür/);
  assert.ok((s[1] ?? "").includes(`EREN_KIT_DATA_DIR=${ESKI_KOK}`));
});

test("eski kurulum: bayrak yalnız veri kökü uyarısını geçer, eski görev uyarısını geçemez", () => {
  assert.deepEqual(eskiKurulumSorunlari({ LOCALAPPDATA: LA }, yoklama([], ESKI_IZLER), { eskiKokuYoksay: true }), []);
  const s = eskiKurulumSorunlari({ LOCALAPPDATA: LA }, yoklama([], [`${ESKI_KOK}\\eren.db`]));
  assert.equal(s.length, 1);
  assert.ok((s[0] ?? "").includes(ESKI_KOK_BAYRAGI));
  const g = eskiKurulumSorunlari({ LOCALAPPDATA: LA }, yoklama(["Eren"], []), { eskiKokuYoksay: true });
  assert.equal(g.length, 1);
  assert.match(g[0] ?? "", /görevi kayıtlı/);
});

test("eski kurulum: üç değişkenle (mevcut kurulum) sorun yok; ad ve yol büyük küçük harf/son ayraç duyarsız", () => {
  assert.deepEqual(eskiKurulumSorunlari(MEVCUT, yoklama(["Eren"], ESKI_IZLER)), []);
  const benzer: Ortam = { LOCALAPPDATA: LA, EREN_KIT_DATA_DIR: "c:\\ORNEK\\yerel\\eren\\", EREN_KIT_PHONE_TASK_NAME: "eren" };
  assert.deepEqual(eskiKurulumSorunlari(benzer, yoklama(["Eren"], ESKI_IZLER)), []);
});

test("eski kurulum: yalnız görev adı eskiye bağlı, veri kökü yeni → veri bölünmesi yakalanır", () => {
  const s = eskiKurulumSorunlari({ LOCALAPPDATA: LA, EREN_KIT_PHONE_TASK_NAME: "Eren" }, yoklama(["Eren"], ESKI_IZLER));
  assert.equal(s.length, 1);
  assert.match(s[0] ?? "", /veri bölünür/);
});

test("eski kurulum: eski klasör var ama kurulum izi (uygulama, eren.db) yoksa sorun sayılmaz", () => {
  assert.deepEqual(eskiKurulumSorunlari({ LOCALAPPDATA: LA }, yoklama([], [ESKI_KOK])), []);
});

// --- kalıcı ortam ------------------------------------------------------------------------------

test("kalıcı ortam: veri kökü yalnız kabukta → hata; aynı (harf/son ayraç farkı) → sorun yok", () => {
  const a = kaliciOrtamKarsilastir({ EREN_KIT_DATA_DIR: ESKI_KOK }, {});
  assert.equal(a.hatalar.length, 1);
  assert.match(a.hatalar[0] ?? "", /EREN_KIT_DATA_DIR.*kalıcı ortamda \(yok\).*veri bölünür/);
  const b = kaliciOrtamKarsilastir({}, { EREN_KIT_DATA_DIR: ESKI_KOK });
  assert.equal(b.hatalar.length, 1);
  const c = kaliciOrtamKarsilastir({ EREN_KIT_DATA_DIR: ESKI_KOK }, { EREN_KIT_DATA_DIR: `${ESKI_KOK.toLowerCase()}\\` });
  assert.deepEqual(c, { hatalar: [], uyarilar: [] });
  assert.deepEqual(kaliciOrtamKarsilastir(MEVCUT, MEVCUT), { hatalar: [], uyarilar: [] });
  assert.deepEqual(kaliciOrtamKarsilastir({}, {}), { hatalar: [], uyarilar: [] });
});

test("kalıcı ortam: görev adı ve asistan adı farkı yalnız uyarı; okunamazsa uyarı", () => {
  const r = kaliciOrtamKarsilastir({ EREN_KIT_PHONE_TASK_NAME: "Eren", EREN_KIT_ASSISTANT_NAME: "Nova" }, {});
  assert.equal(r.hatalar.length, 0);
  assert.equal(r.uyarilar.length, 2);
  assert.deepEqual(kaliciOrtamKarsilastir({ EREN_KIT_PHONE_TASK_NAME: "eren-kit-telefon" }, {}).uyarilar, []);
  const n = kaliciOrtamKarsilastir({ EREN_KIT_DATA_DIR: ESKI_KOK }, null);
  assert.equal(n.hatalar.length, 0);
  assert.match(n.uyarilar[0] ?? "", /okunamadı/);
});

// --- eren.ts bağlantısı -----------------------------------------------------------------------

/** schtasks çağrılarını kaydeden, her şeyi başarısız sayan sahte bağ. */
const sahteBag = (): { bag: Bag; cagrilar: string[][] } => {
  const cagrilar: string[][] = [];
  const bag: Bag = {
    schtasks: (args) => {
      cagrilar.push([...args]);
      return false;
    },
    bekci: async () => null,
    uyu: async () => {},
    simdi: () => 0,
    canli: () => false,
  };
  return { bag, cagrilar };
};

const sessiz = async <T>(is: () => Promise<T>): Promise<T> => {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return await is();
  } finally {
    console.log = log;
    console.error = error;
  }
};

const degistirenler = (c: readonly string[][]): string[][] => c.filter((a) => a[0] !== "/query");

test("eren dur/baslat ortamsız: görev adı eren-kit-telefon", async () => {
  const d = sahteBag();
  assert.equal(await sessiz(() => durKomutu(d.bag, { LOCALAPPDATA: LA })), 1);
  assert.ok(d.cagrilar.some((a) => a.join(" ") === "/query /tn eren-kit-telefon"), JSON.stringify(d.cagrilar));
  const b = sahteBag();
  assert.equal(await sessiz(() => baslatKomutu(b.bag, { LOCALAPPDATA: LA })), 1);
  assert.deepEqual(degistirenler(b.cagrilar), [["/change", "/tn", "eren-kit-telefon", "/enable"]]);
});

test("eren dur/baslat ortamlı: EREN_KIT_PHONE_TASK_NAME kullanılır", async () => {
  const d = sahteBag();
  await sessiz(() => durKomutu(d.bag, { LOCALAPPDATA: LA, EREN_KIT_PHONE_TASK_NAME: "Eren" }));
  assert.deepEqual(d.cagrilar[0], ["/query", "/tn", "Eren"]);
  const b = sahteBag();
  await sessiz(() => baslatKomutu(b.bag, { LOCALAPPDATA: LA, EREN_KIT_PHONE_TASK_NAME: "Eren" }));
  assert.deepEqual(degistirenler(b.cagrilar)[0], ["/change", "/tn", "Eren", "/enable"]);
});

/** Verilen görevler kayıtlı, schtasks değişiklikleri başarılı, bekçi ayakta; yapılan her şeyi kaydeder. */
const kayitliBag = (gorevler: readonly string[], yollar: readonly string[] = []) => {
  const cagrilar: string[][] = [];
  const bekciCagrilari: string[] = [];
  let kapandi = false;
  let saat = 0;
  const bag: Bag = {
    schtasks: (args) => {
      cagrilar.push([...args]);
      if (args[0] === "/query") return gorevler.some((g) => g.toLowerCase() === (args[2] ?? "").toLowerCase());
      return true;
    },
    bekci: async (komut) => {
      bekciCagrilari.push(komut);
      if (kapandi) return null; // kapan'dan sonra boru yok
      if (komut === "kapan") kapandi = true;
      return { ok: true, durum: "calisiyor", bekci_pid: 1 };
    },
    uyu: async (ms) => {
      saat += ms;
    },
    simdi: () => (saat += 1),
    canli: () => false,
    varMi: (y) => yollar.some((p) => p.toLowerCase() === y.toLowerCase()),
  };
  return { bag, cagrilar, bekciCagrilari };
};

/** console.error çıktısını toplar, console.log'u susturur. */
const hataCiktisi = async (is: () => Promise<number>): Promise<{ kod: number; hata: string }> => {
  const { log, error } = console;
  const satirlar: string[] = [];
  console.log = () => {};
  console.error = (...a: unknown[]) => satirlar.push(a.map(String).join(" "));
  try {
    return { kod: await is(), hata: satirlar.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
};

test("eren dur/baslat: eski kurulum varken ortamsız, hiçbir şeye dokunmadan açıklayıcı biçimde durur", async () => {
  for (const [ad, komut] of [["dur", durKomutu], ["baslat", baslatKomutu]] as const) {
    // eski 'Eren' görevi kayıtlı, etkin ad eren-kit-telefon
    const g = kayitliBag(["Eren"]);
    const r = await hataCiktisi(() => komut(g.bag, { LOCALAPPDATA: LA }));
    assert.equal(r.kod, 1, ad);
    assert.deepEqual(degistirenler(g.cagrilar), [], `${ad}: görev değiştirilmemeli`);
    assert.deepEqual(g.bekciCagrilari, [], `${ad}: bekçiye bir şey gönderilmemeli`);
    assert.match(r.hata, /eski 'Eren' görevi kayıtlı/, ad);
    assert.match(r.hata, /hiçbir şey değişmedi/, ad);

    // eski veri kökü dolu: kur gibi durur, bayrakla geçilir
    const k = kayitliBag([], ESKI_IZLER);
    const rk = await hataCiktisi(() => komut(k.bag, { LOCALAPPDATA: LA }));
    assert.equal(rk.kod, 1, ad);
    assert.deepEqual(degistirenler(k.cagrilar), [], ad);
    assert.deepEqual(k.bekciCagrilari, [], ad);
    assert.match(rk.hata, /veri bölünür/, ad);
    const kb = kayitliBag(["eren-kit-telefon"], ESKI_IZLER);
    await sessiz(() => komut(kb.bag, { LOCALAPPDATA: LA }, { eskiKokuYoksay: true }));
    assert.ok(degistirenler(kb.cagrilar).length > 0, `${ad}: ${ESKI_KOK_BAYRAGI} ile devam etmeli`);
  }
  // mevcut kurulumu sürdüren üç değişkenle eski görev hedeflenir
  const m = kayitliBag(["Eren"], ESKI_IZLER);
  await sessiz(() => durKomutu(m.bag, MEVCUT));
  assert.deepEqual(degistirenler(m.cagrilar), [["/change", "/tn", "Eren", "/disable"]]);
  assert.ok(m.bekciCagrilari.includes("kapan"));
});

test("eren logDizini: ortamsız / ortamlı / göreli", () => {
  assert.equal(logDizini({ LOCALAPPDATA: LA }), path.join(LA, "eren-kit", "logs"));
  assert.equal(logDizini(MEVCUT), path.join(ESKI_KOK, "logs"));
  assert.throws(() => logDizini({ LOCALAPPDATA: LA, EREN_KIT_DATA_DIR: "logs" }), /mutlak yol olmalı/);
});

test("eren log (alt süreç): günlüğü EREN_KIT_DATA_DIR'den okur; göreli yolda tek satır hata, çıkış 1", () => {
  try {
    const kok = gecici();
    fs.mkdirSync(path.join(kok, "logs"));
    const satir = JSON.stringify({ ts_ms: 1_700_000_000_000, seviye: "bilgi", modul: "deneme", olay: "ortam_okundu" });
    fs.writeFileSync(path.join(kok, "logs", "servis.log"), `${satir}\n`);
    const eren = path.join(KURULUM, "eren.ts");
    const r = spawnSync(process.execPath, [UYARI, eren, "log", "1"], {
      encoding: "utf8",
      env: altOrtam({ EREN_KIT_DATA_DIR: kok }),
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /bilgi deneme ortam_okundu/);
    const g = spawnSync(process.execPath, [UYARI, eren, "log"], {
      encoding: "utf8",
      env: altOrtam({ EREN_KIT_DATA_DIR: "goreli\\kok" }),
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(g.status, 1);
    assert.match(g.stderr, /^eren: EREN_KIT_DATA_DIR mutlak yol olmalı/);
  } finally {
    temizle();
  }
});

// --- gorev-kaydet.ts bağlantısı ---------------------------------------------------------------

test("gorevXml: açıklamada sabit kişilik adı yok", () => {
  const x = gorevXml({ kullanici: "makine\\kisi", nodeExe: "C:\\n\\node.exe", uygulamaKok: "C:\\k\\uygulama", baslangic: "2026-01-01T00:00:00" });
  assert.ok(!/\bEren\b/.test(x), x);
});

test("gorev-kaydet --goster (alt süreç, kaydetmez): ortamsız, ortamlı ve göreli yol", () => {
  const la = gecici();
  const calis = (ek: Record<string, string>) =>
    spawnSync(process.execPath, [UYARI, path.join(KURULUM, "gorev-kaydet.ts"), "--goster"], {
      encoding: "utf8",
      env: altOrtam({ LOCALAPPDATA: la, ...ek }),
      timeout: 15_000,
      windowsHide: true,
    });
  const calismaDizini = (xml: string): string => /<WorkingDirectory>([^<]*)<\/WorkingDirectory>/.exec(xml)?.[1] ?? "";
  try {
    const a = calis({});
    assert.equal(a.status, 0, a.stderr);
    assert.equal(calismaDizini(a.stdout), path.win32.join(la, "eren-kit", "uygulama", "guncel"));
    const b = calis({ EREN_KIT_DATA_DIR: "C:\\ornek\\veri" });
    assert.equal(b.status, 0, b.stderr);
    assert.equal(calismaDizini(b.stdout), "C:\\ornek\\veri\\uygulama\\guncel");
    const c = calis({ EREN_KIT_DATA_DIR: "veri" });
    assert.equal(c.status, 1);
    assert.match(c.stderr, /EREN_KIT_DATA_DIR mutlak yol olmalı/);
    assert.equal(c.stdout, "");
    assert.deepEqual(fs.readdirSync(la), [], "--goster hiçbir şey yazmamalı");
  } finally {
    temizle();
  }
});
