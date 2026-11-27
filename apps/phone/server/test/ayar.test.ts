import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import win32 from "node:path/win32";
import { asistanAdiUret, ayarKur, AyarHatasi, yollariUret } from "../src/ayar.ts";
import type { Ayar, Ortam } from "../src/sozlesme.ts";
import { sahteDosya } from "./sahte.ts";
import type { SahteDosya } from "./sahte.ts";

const LA = "C:\\ornek\\AppData\\Local";
const KOK = "C:\\ornek\\AppData\\Local\\eren-kit";
const APPDATA = "C:\\ornek\\AppData\\Roaming";
const NPM_EXE = `${APPDATA}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
const EXE = "C:\\ornek\\arac\\claude.exe";
const NODE = "C:\\ornek\\node\\node.exe";
const UP = "C:\\ornek\\kullanici";
const BASLANGIC = 1_700_000_000_000;
const JETON = "jeton-ornek-123456:GIZLI-DEGER";

const DORT = {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
  CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1",
  CLAUDE_CODE_DISABLE_ATTACHMENTS: "1",
};

function ortamYap(ek: Record<string, string> = {}): Ortam {
  return { LOCALAPPDATA: LA, APPDATA, USERPROFILE: UP, PATH: "", ...ek } as Ortam;
}

interface Kurulum {
  dosya: SahteDosya;
  ortam: Ortam;
}

function hazir(yerel?: unknown, ortamEk: Record<string, string> = {}): Kurulum {
  const dosya = sahteDosya();
  dosya.yaz(EXE, "x");
  if (yerel !== undefined) {
    dosya.yaz(`${KOK}\\ayar.local.json`, typeof yerel === "string" ? yerel : JSON.stringify(yerel));
  }
  return { dosya, ortam: ortamYap({ PATH: "C:\\ornek\\arac", ...ortamEk }) };
}

const kur = (k: Kurulum): Promise<Ayar> => ayarKur({ dosya: k.dosya, ortam: k.ortam, execPath: NODE, baslangicMs: BASLANGIC });

async function hataAl(f: () => Promise<unknown>): Promise<Error> {
  try {
    await f();
  } catch (e) {
    return e as Error;
  }
  assert.fail("hata bekleniyordu");
}

describe("ayar: varsayılanlar", () => {
  it("ayar.local.json yokken belgedeki her varsayılan", async () => {
    const a = await kur(hazir());
    assert.equal(a.wsPort, 47821);
    assert.equal(a.erenModeli, "opus");
    assert.equal(a.pcIsModeli, null);
    assert.equal(a.telefonIsModeli, "opus");
    assert.equal(a.ramDusukMb, 2048);
    assert.deepEqual({ ...a.sureler }, {
      kilitYoklamaMs: 5000,
      torunYoklamaMs: 10000,
      isYoklamaMs: 2000,
      ramYoklamaMs: 30000,
      soruZamanAsimiMs: 82800000,
      devirOzetiBeklemeMs: 120000,
      deltaTamponMs: 80,
      bildirimAckMs: 30000,
      komutPayiMs: 15000,
      erenYenidenBaslatmaMs: 30000,
    });
    assert.equal(a.computerUse, null);
    assert.equal(a.mcpProfilSunucusu("rea"), null);
    assert.equal(await a.telegram(), null);
    assert.equal(await a.kimlikEki(), "");
    assert.equal(a.nodeExe, NODE);
  });

  it("süreler dondurulmuştur", async () => {
    const a = await kur(hazir());
    assert.ok(Object.isFrozen(a.sureler));
  });

  it("yerel ayar değerleri varsayılanı ezer; BOM atılır", async () => {
    const k = hazir("\uFEFF" + JSON.stringify({
      kullanici_adi: "Deneme",
      ws_port: 5000,
      eren_modeli: "sonnet",
      pc_is_modeli: "haiku",
      telefon_is_modeli: "sonnet",
      ram_dusuk_mb: 512,
    }));
    const a = await kur(k);
    assert.equal(a.kullaniciAdi, "Deneme");
    assert.equal(a.wsPort, 5000);
    assert.equal(a.erenModeli, "sonnet");
    assert.equal(a.pcIsModeli, "haiku");
    assert.equal(a.telefonIsModeli, "sonnet");
    assert.equal(a.ramDusukMb, 512);
  });

  it("computer_use ve rea tanımları okunur", async () => {
    const a = await kur(hazir({
      computer_use: { command: "C:\\ornek\\cu.exe", args: ["--a"], env: { X: "1" } },
      rea: { command: "C:\\ornek\\rea.exe", args: [] },
    }));
    assert.deepEqual(a.computerUse, { command: "C:\\ornek\\cu.exe", args: ["--a"], env: { X: "1" } });
    assert.deepEqual(a.mcpProfilSunucusu("rea"), { command: "C:\\ornek\\rea.exe", args: [] });
  });
});

describe("ayar: ortam temizliği", () => {
  const kirli = {
    CLAUDE_X: "a",
    claude_x: "b",
    Claude_Y: "c",
    ANTHROPIC_API_KEY: "d",
    Anthropic_Y: "e",
    anthropic_z: "f",
    CLAUDECODE: "1",
    BASKA: "kalir",
    Path_Benzeri: "kalir2",
  };

  it("pcIsOrtami: CLAUDE*/ANTHROPIC* büyük küçük harf duyarsız silinir, üç anahtar eklenir, ATTACHMENTS EKLENMEZ", async () => {
    const a = await kur(hazir(undefined, kirli));
    const o = a.pcIsOrtami();
    for (const ad of Object.keys(kirli)) {
      if (/^(claude|anthropic)/i.test(ad)) assert.equal(ad in o, false, ad);
    }
    assert.equal(o["BASKA"], "kalir");
    assert.equal(o["Path_Benzeri"], "kalir2");
    assert.equal(o["LOCALAPPDATA"], LA);
    const uc = Object.keys(DORT).filter((ad) => ad !== "CLAUDE_CODE_DISABLE_ATTACHMENTS");
    assert.equal(uc.length, 3);
    for (const ad of uc) assert.equal(o[ad], "1", ad);
    assert.equal("CLAUDE_CODE_DISABLE_ATTACHMENTS" in o, false);
    const kalanClaude = Object.keys(o).filter((k) => /^(claude|anthropic)/i.test(k)).sort();
    assert.deepEqual(kalanClaude, uc.sort());
    // Servisin kendi oturumu işareti: PC ajanda kancası bu oturumda hiçbir şey yapmaz.
    assert.equal(o["EREN_KIT_SERVIS_OTURUMU"], "1");
  });

  it("servis oturumu işareti yalnız PC iş ortamında (ana sohbet ve telefon işi kullanıcı kancası yüklemez)", async () => {
    const a = await kur(hazir(undefined, kirli));
    assert.equal("EREN_KIT_SERVIS_OTURUMU" in a.erenOrtami(), false);
    assert.equal("EREN_KIT_SERVIS_OTURUMU" in a.telefonIsOrtami(), false);
  });

  it("erenOrtami ve telefonIsOrtami: silinir, sonra tam dört anahtar eklenir", async () => {
    const a = await kur(hazir(undefined, kirli));
    for (const o of [a.erenOrtami(), a.telefonIsOrtami()]) {
      assert.equal("claude_x" in o, false);
      assert.equal("Anthropic_Y" in o, false);
      assert.equal("ANTHROPIC_API_KEY" in o, false);
      assert.equal("CLAUDECODE" in o, false);
      assert.equal(o["BASKA"], "kalir");
      for (const [ad, d] of Object.entries(DORT)) assert.equal(o[ad], d, ad);
      const kalanClaude = Object.keys(o).filter((k) => /^(claude|anthropic)/i.test(k)).sort();
      assert.deepEqual(kalanClaude, Object.keys(DORT).sort());
    }
  });

  it("girdide bulunan kapatma anahtarının eski değeri ezilir (erenOrtami) ve pc'de silinir", async () => {
    const a = await kur(hazir(undefined, { CLAUDE_CODE_DISABLE_ATTACHMENTS: "0" }));
    assert.equal(a.erenOrtami()["CLAUDE_CODE_DISABLE_ATTACHMENTS"], "1");
    assert.equal("CLAUDE_CODE_DISABLE_ATTACHMENTS" in a.pcIsOrtami(), false);
  });

  it("girdi ortamı değişmez; sonradan değişse de çıktı etkilenmez; her çağrı yeni nesne", async () => {
    const k = hazir(undefined, { CLAUDE_X: "a", BASKA: "1" });
    const once = JSON.stringify(k.ortam);
    const a = await kur(k);
    (a.erenOrtami() as Record<string, string>)["BASKA"] = "bozuldu";
    (a.pcIsOrtami() as Record<string, string>)["BASKA"] = "bozuldu";
    assert.equal(JSON.stringify(k.ortam), once);
    (k.ortam as Record<string, string>)["BASKA"] = "sonradan";
    assert.equal(a.erenOrtami()["BASKA"], "1");
    assert.equal(a.pcIsOrtami()["BASKA"], "1");
    assert.notEqual(a.erenOrtami(), a.erenOrtami());
  });
});

describe("ayar: claudeExe", () => {
  it(".cmd ve .bat reddedilir (büyük harf dahil)", async () => {
    for (const ad of ["C:\\ornek\\claude.cmd", "C:\\ornek\\claude.bat", "C:\\ornek\\CLAUDE.CMD", "C:\\ornek\\claude"]) {
      const k = hazir({ claude_exe: ad });
      k.dosya.yaz(ad, "x");
      const h = await hataAl(() => kur(k));
      assert.ok(h instanceof AyarHatasi, ad);
      assert.match(h.message, /\.exe/);
    }
  });

  it("claude_exe verilmişse ve dosya yoksa atar", async () => {
    const h = await hataAl(() => kur(hazir({ claude_exe: "C:\\ornek\\yok\\claude.exe" })));
    assert.ok(h instanceof AyarHatasi);
  });

  it("sıra 1: claude_exe, PATH ve npm yoluna önceliklidir", async () => {
    const k = hazir({ claude_exe: "C:\\ornek\\ozel\\claude.exe" });
    k.dosya.yaz("C:\\ornek\\ozel\\claude.exe", "x");
    k.dosya.yaz(NPM_EXE, "x");
    assert.equal((await kur(k)).claudeExe, "C:\\ornek\\ozel\\claude.exe");
  });

  it("sıra 2: claude_exe yoksa PATH'teki claude.exe, npm yoluna önceliklidir", async () => {
    const k = hazir();
    k.dosya.yaz(NPM_EXE, "x");
    assert.equal((await kur(k)).claudeExe, EXE);
  });

  it("PATH girdileri sırayla denenir; boş, göreli ve tırnaklı girdiler işlenir", async () => {
    const dosya = sahteDosya();
    dosya.yaz("C:\\ornek\\ikinci\\claude.exe", "x");
    dosya.yaz("C:\\ornek\\ucuncu\\claude.exe", "x");
    const ortam = ortamYap({ PATH: ";göreli\\dizin; \"C:\\ornek\\ikinci\" ;C:\\ornek\\ucuncu" });
    const a = await ayarKur({ dosya, ortam, execPath: NODE, baslangicMs: BASLANGIC });
    assert.equal(a.claudeExe, "C:\\ornek\\ikinci\\claude.exe");
  });

  it("PATH adı büyük küçük harf duyarsız aranır (Path)", async () => {
    const dosya = sahteDosya();
    dosya.yaz(EXE, "x");
    const ortam = { LOCALAPPDATA: LA, USERPROFILE: UP, Path: "C:\\ornek\\arac" } as Ortam;
    assert.equal((await ayarKur({ dosya, ortam, execPath: NODE, baslangicMs: BASLANGIC })).claudeExe, EXE);
  });

  it("sıra 3: PATH'te yoksa %APPDATA%\\npm\\...\\claude.exe", async () => {
    const dosya = sahteDosya();
    dosya.yaz(NPM_EXE, "x");
    const a = await ayarKur({ dosya, ortam: ortamYap({ PATH: "C:\\ornek\\bos" }), execPath: NODE, baslangicMs: BASLANGIC });
    assert.equal(a.claudeExe, NPM_EXE);
  });

  it("hiçbiri yoksa atar", async () => {
    const dosya = sahteDosya();
    const h = await hataAl(() => ayarKur({ dosya, ortam: ortamYap({ PATH: "C:\\ornek\\bos" }), execPath: NODE, baslangicMs: BASLANGIC }));
    assert.ok(h instanceof AyarHatasi);
  });

  it("PATH'teki claude.cmd yok sayılır (yalnız claude.exe aranır)", async () => {
    const dosya = sahteDosya();
    dosya.yaz("C:\\ornek\\arac\\claude.cmd", "x");
    await hataAl(() => ayarKur({ dosya, ortam: ortamYap({ PATH: "C:\\ornek\\arac" }), execPath: NODE, baslangicMs: BASLANGIC }));
  });
});

describe("ayar: LOCALAPPDATA ve yollar", () => {
  it("LOCALAPPDATA yoksa, boşsa ya da göreliyse başlangıçta atar", async () => {
    for (const ortam of [
      { PATH: "C:\\ornek\\arac" },
      { LOCALAPPDATA: "", PATH: "C:\\ornek\\arac" },
      { LOCALAPPDATA: "gorelidizin", PATH: "C:\\ornek\\arac" },
    ] as Ortam[]) {
      const dosya = sahteDosya();
      dosya.yaz(EXE, "x");
      const h = await hataAl(() => ayarKur({ dosya, ortam, execPath: NODE, baslangicMs: BASLANGIC }));
      assert.ok(h instanceof AyarHatasi);
      assert.match(h.message, /LOCALAPPDATA/);
    }
  });

  it("yollar: belgedeki yerleşim", async () => {
    const a = await kur(hazir());
    assert.deepEqual({ ...a.yollar }, {
      kok: KOK,
      vt: `${KOK}\\eren.db`,
      log: `${KOK}\\logs\\servis.log`,
      islerDizini: `${KOK}\\isler`,
      erenCwd: `${KOK}\\eren-cwd`,
      erenMcpDizini: `${KOK}\\eren-mcp`,
      anahtar: `${KOK}\\sunucu-anahtar.pem`,
      kimlikEki: `${KOK}\\kimlik.local.md`,
      projeler: `${KOK}\\projeler.json`,
      yerelAyar: `${KOK}\\ayar.local.json`,
      limitKilit: `${LA}\\ClaudeLimitKilit\\kilit.json`,
      claudeProjeleri: `${UP}\\.claude\\projects`,
    });
  });

  it("limit kilidi veri kökünün dışındadır", async () => {
    const a = await kur(hazir());
    assert.equal(a.yollar.limitKilit.startsWith(KOK + "\\"), false);
  });

  it("LOCALAPPDATA sonundaki ayraç ve ortam adı büyük küçük harf farkı yolu bozmaz", async () => {
    const dosya = sahteDosya();
    dosya.yaz(EXE, "x");
    const ortam = { localappdata: LA + "\\", USERPROFILE: UP, PATH: "C:\\ornek\\arac" } as Ortam;
    const a = await ayarKur({ dosya, ortam, execPath: NODE, baslangicMs: BASLANGIC });
    assert.equal(a.yollar.kok, KOK);
  });

  it("isYollari: iş dizini düzeni", async () => {
    const a = await kur(hazir());
    assert.deepEqual({ ...a.isYollari(42) }, {
      dizin: `${KOK}\\isler\\42`,
      gorev: `${KOK}\\isler\\42\\gorev.txt`,
      mcp: `${KOK}\\isler\\42\\mcp.json`,
      out: `${KOK}\\isler\\42\\out.jsonl`,
      err: `${KOK}\\isler\\42\\err.txt`,
      bosCwd: `${KOK}\\isler\\42\\cwd`,
    });
  });

  it("isYollari: pozitif tam sayı dışı reddedilir (dizin geçişi yok)", async () => {
    const a = await kur(hazir());
    for (const v of [0, -1, 1.5, NaN, Infinity, "../x" as unknown as number]) {
      assert.throws(() => a.isYollari(v), AyarHatasi, String(v));
    }
  });

  it("kopruBetigi mutlak yol ve kopru.ts ile biter", async () => {
    const a = await kur(hazir());
    assert.match(a.kopruBetigi, /^[A-Za-z]:\\/);
    assert.match(a.kopruBetigi, /\\src\\kopru\.ts$/);
  });

  it("execPath boşsa atar", async () => {
    const k = hazir();
    await hataAl(() => ayarKur({ dosya: k.dosya, ortam: k.ortam, execPath: "", baslangicMs: BASLANGIC }));
  });
});

describe("ayar: eksik ve bozuk dosyalar", () => {
  it("ayar.local.json bozuksa AyarHatasi", async () => {
    const h = await hataAl(() => kur(hazir("{ bozuk")));
    assert.ok(h instanceof AyarHatasi);
  });

  it("ayar.local.json nesne değilse ya da bilinmeyen alan varsa atar", async () => {
    for (const y of ["[]", "5", "null", '{"bilinmeyen": 1}']) {
      const h = await hataAl(() => kur(hazir(y)));
      assert.ok(h instanceof AyarHatasi, y);
    }
  });

  it("geçersiz alan türleri ve aralıklar atar", async () => {
    const kotu: unknown[] = [
      { ws_port: 0 },
      { ws_port: 65536 },
      { ws_port: 1.5 },
      { ws_port: "5000" },
      { ram_dusuk_mb: -1 },
      { eren_modeli: "" },
      { eren_modeli: "--bayrak" },
      { pc_is_modeli: "-x" },
      { telefon_is_modeli: 3 },
      { kullanici_adi: "  " },
      { computer_use: "x" },
      { computer_use: { command: "", args: [] } },
      { computer_use: { command: "a", args: "b" } },
      { computer_use: { command: "a", args: [1] } },
      { computer_use: { command: "a", args: [], env: { X: 1 } } },
      { computer_use: { command: "a", args: [], fazla: 1 } },
      { rea: [] },
    ];
    for (const y of kotu) {
      const h = await hataAl(() => kur(hazir(y)));
      assert.ok(h instanceof AyarHatasi, JSON.stringify(y));
    }
  });

  it("sınır değerleri kabul edilir (ws_port 1 ve 65535, ram_dusuk_mb 0)", async () => {
    assert.equal((await kur(hazir({ ws_port: 1 }))).wsPort, 1);
    assert.equal((await kur(hazir({ ws_port: 65535 }))).wsPort, 65535);
    assert.equal((await kur(hazir({ ram_dusuk_mb: 0 }))).ramDusukMb, 0);
  });

  it("dosya portu okuma hatası başlangıçta yayılır", async () => {
    const k = hazir();
    k.dosya.hataVer("oku", new Error("disk"));
    await hataAl(() => kur(k));
  });

  it("kimlikEki: dosya varsa içeriği, yoksa boş metin", async () => {
    const k = hazir();
    const a = await kur(k);
    assert.equal(await a.kimlikEki(), "");
    k.dosya.yaz(`${KOK}\\kimlik.local.md`, "# ek\nmetin");
    assert.equal(await a.kimlikEki(), "# ek\nmetin");
  });

  it("projeler: dosya yoksa boş liste", async () => {
    const a = await kur(hazir());
    assert.deepEqual(await a.projeler(), { projeler: [] });
  });

  it("projeler: geçerli dosya ProjelerCikti'dan geçer (BOM'lu da)", async () => {
    const k = hazir();
    const a = await kur(k);
    const veri = { projeler: [{ ad: "Ornek", yol: "C:\\ornek\\proje", not: "n" }, { ad: "Iki", yol: "C:\\ornek\\iki" }] };
    k.dosya.yaz(`${KOK}\\projeler.json`, "\uFEFF" + JSON.stringify(veri));
    assert.deepEqual(await a.projeler(), veri);
  });

  it("projeler: bozuk JSON, şemaya uymayan ve fazla alanlı dosya boş liste verir, atmaz", async () => {
    const k = hazir();
    const a = await kur(k);
    for (const ic of [
      "{ bozuk",
      "[]",
      "null",
      JSON.stringify({ projeler: [{ ad: 1, yol: "C:\\ornek" }] }),
      JSON.stringify({ projeler: [{ ad: "a" }] }),
      JSON.stringify({ projeler: [{ ad: "a", yol: "b", fazla: 1 }] }),
      JSON.stringify({ projeler: [], fazla: 1 }),
    ]) {
      k.dosya.yaz(`${KOK}\\projeler.json`, ic);
      assert.deepEqual(await a.projeler(), { projeler: [] }, ic);
    }
  });

  it("projeler: okuma hatası da boş liste verir", async () => {
    const k = hazir();
    const a = await kur(k);
    k.dosya.hataVer("oku", new Error("disk"));
    assert.deepEqual(await a.projeler(), { projeler: [] });
  });
});

describe("ayar: telegram jetonu", () => {
  it("geçerli telegram ayarı okunur; sohbet_id sayı ise metne çevrilir; kopya döner", async () => {
    const a = await kur(hazir({ telegram: { jeton: JETON, sohbet_id: 12345 } }));
    const t = await a.telegram();
    assert.deepEqual(t, { jeton: JETON, sohbetId: "12345" });
    t!.jeton = "degisti";
    assert.equal((await a.telegram())!.jeton, JETON);
    const b = await kur(hazir({ telegram: { jeton: JETON, sohbet_id: "-100" } }));
    assert.equal((await b.telegram())!.sohbetId, "-100");
  });

  it("bozuk telegram ayarlarında hata metni jetonu içermez", async () => {
    const kotu: unknown[] = [
      { telegram: { jeton: JETON } },
      { telegram: { jeton: JETON, sohbet_id: 1.5 } },
      { telegram: { jeton: JETON, sohbet_id: [JETON] } },
      { telegram: { jeton: JETON, sohbet_id: "1", fazla: JETON } },
      { telegram: { jeton: JETON, sohbet_id: "1", [JETON]: 1 } },
      { telegram: [JETON] },
      { telegram: JETON },
      { telegram: { jeton: "", sohbet_id: "1" } },
      { telegram: { jeton: 5, sohbet_id: "1" } },
    ];
    for (const y of kotu) {
      const h = await hataAl(() => kur(hazir(y)));
      assert.ok(h instanceof AyarHatasi, JSON.stringify(y));
      assert.equal(h.message.includes(JETON), false, h.message);
      assert.equal((h.stack ?? "").includes(JETON), false);
    }
  });

  it("başka bir alandaki hata da jetonu hata metnine sokmaz", async () => {
    const h = await hataAl(() => kur(hazir({ telegram: { jeton: JETON, sohbet_id: "1" }, ws_port: 0 })));
    assert.ok(h instanceof AyarHatasi);
    assert.equal(h.message.includes(JETON), false);
  });

  it("bozuk JSON metnindeki jeton hata metnine girmez", async () => {
    const h = await hataAl(() => kur(hazir(`{"telegram": {"jeton": "${JETON}", }`)));
    assert.ok(h instanceof AyarHatasi);
    assert.equal(h.message.includes(JETON), false);
  });

  it("kurulum sırasında console ve stdout/stderr'e hiçbir şey yazılmaz (jeton günlüğe girmez)", async () => {
    const yazilan: string[] = [];
    const yedek: Array<[string, unknown]> = [];
    for (const ad of ["log", "info", "warn", "error", "debug"] as const) {
      yedek.push([ad, console[ad]]);
      console[ad] = (...a: unknown[]) => void yazilan.push(a.join(" "));
    }
    const so = process.stdout.write;
    const se = process.stderr.write;
    process.stdout.write = ((s: unknown) => (yazilan.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: unknown) => (yazilan.push(String(s)), true)) as typeof process.stderr.write;
    try {
      const k = hazir({ telegram: { jeton: JETON, sohbet_id: "1" } });
      const a = await kur(k);
      await a.telegram();
      await a.projeler();
      await hataAl(() => kur(hazir({ telegram: { jeton: JETON } })));
    } finally {
      process.stdout.write = so;
      process.stderr.write = se;
      for (const [ad, f] of yedek) (console as unknown as Record<string, unknown>)[ad] = f;
    }
    assert.deepEqual(yazilan, []);
  });

  it("jeton ortam kopyalarına ve yollara sızmaz; dosyaya hiçbir şey yazılmaz", async () => {
    const k = hazir({ telegram: { jeton: JETON, sohbet_id: "1" } });
    const a = await kur(k);
    const hepsi = JSON.stringify([a.yollar, a.erenOrtami(), a.pcIsOrtami(), a.telefonIsOrtami(), a.sureler, a.isYollari(1)]);
    assert.equal(hepsi.includes(JETON), false);
    assert.equal(k.dosya.cagrilar.say("atomikYaz"), 0);
  });
});

describe("ayar: dilim 2 (eren mcp yolu, canlı azami, boşta kapatma)", () => {
  it("varsayılanlar: eren_canli_azami 2, eren_bosta_kapat_dk 30 (1.800.000 ms)", async () => {
    const a = await kur(hazir());
    assert.equal(a.erenCanliAzami, 2);
    assert.equal(a.erenBostaKapatMs, 30 * 60_000);
    assert.equal(a.erenBostaKapatMs, 1_800_000);
  });

  it("eren_canli_azami sınırları: 1 ve 4 kabul, 0 ve 5 AyarHatasi", async () => {
    assert.equal((await kur(hazir({ eren_canli_azami: 1 }))).erenCanliAzami, 1);
    assert.equal((await kur(hazir({ eren_canli_azami: 4 }))).erenCanliAzami, 4);
    assert.equal((await kur(hazir({ eren_canli_azami: 3 }))).erenCanliAzami, 3);
    for (const v of [0, 5]) {
      const h = await hataAl(() => kur(hazir({ eren_canli_azami: v })));
      assert.ok(h instanceof AyarHatasi, String(v));
    }
  });

  it("eren_bosta_kapat_dk sınırları: 1 ve 1440 kabul (ms'ye çevrilir), 0 ve 1441 AyarHatasi", async () => {
    assert.equal((await kur(hazir({ eren_bosta_kapat_dk: 1 }))).erenBostaKapatMs, 60_000);
    assert.equal((await kur(hazir({ eren_bosta_kapat_dk: 1440 }))).erenBostaKapatMs, 1440 * 60_000);
    assert.equal((await kur(hazir({ eren_bosta_kapat_dk: 45 }))).erenBostaKapatMs, 45 * 60_000);
    for (const v of [0, 1441]) {
      const h = await hataAl(() => kur(hazir({ eren_bosta_kapat_dk: v })));
      assert.ok(h instanceof AyarHatasi, String(v));
    }
  });

  it("tip dışı değerler AyarHatasi (ondalık, metin, null, NaN-benzeri, nesne, mantıksal, negatif)", async () => {
    for (const alan of ["eren_canli_azami", "eren_bosta_kapat_dk"]) {
      for (const v of [1.5, "2", null, true, [2], { a: 1 }, -1]) {
        const h = await hataAl(() => kur(hazir({ [alan]: v })));
        assert.ok(h instanceof AyarHatasi, `${alan}=${JSON.stringify(v)}`);
      }
    }
  });

  it("iki alan birlikte verilebilir ve birbirini etkilemez", async () => {
    const a = await kur(hazir({ eren_canli_azami: 4, eren_bosta_kapat_dk: 5 }));
    assert.equal(a.erenCanliAzami, 4);
    assert.equal(a.erenBostaKapatMs, 300_000);
  });

  it("erenMcpYolu(nesil): <erenMcpDizini>\\<nesil>.json", async () => {
    const a = await kur(hazir());
    assert.equal(a.yollar.erenMcpDizini, `${KOK}\\eren-mcp`);
    assert.equal(a.erenMcpYolu(7), `${KOK}\\eren-mcp\\7.json`);
    assert.equal(a.erenMcpYolu(1), `${a.yollar.erenMcpDizini}\\1.json`);
    assert.notEqual(a.erenMcpYolu(1), a.erenMcpYolu(2));
    assert.equal("erenMcp" in a.yollar, false);
  });

  it("erenMcpYolu: pozitif güvenli tam sayı dışı reddedilir", async () => {
    const a = await kur(hazir());
    for (const v of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "../x" as unknown as number, "3" as unknown as number]) {
      assert.throws(() => a.erenMcpYolu(v), AyarHatasi, String(v));
    }
    assert.equal(a.erenMcpYolu(Number.MAX_SAFE_INTEGER), `${KOK}\\eren-mcp\\${Number.MAX_SAFE_INTEGER}.json`);
  });
});

describe("ayar: tam_yetki", () => {
  const tam = (a: Ayar): unknown => (a as unknown as Record<string, unknown>)["tamYetki"];

  it("yoksa true; true ve false okunur", async () => {
    assert.equal(tam(await kur(hazir())), true);
    assert.equal(tam(await kur(hazir({ tam_yetki: true }))), true);
    assert.equal(tam(await kur(hazir({ tam_yetki: false }))), false);
  });

  it("boolean olmayan değer AyarHatasi", async () => {
    for (const v of ["true", 1, 0, null, [true], { a: 1 }]) {
      const h = await hataAl(() => kur(hazir({ tam_yetki: v })));
      assert.ok(h instanceof AyarHatasi, JSON.stringify(v));
    }
  });
});

describe("ayar: USERPROFILE ve claudeProjeleri", () => {
  it("USERPROFILE yoksa, boşsa ya da göreliyse atar", async () => {
    for (const up of [undefined, "", "gorelidizin"]) {
      const k = hazir();
      const ortam = { ...k.ortam } as Record<string, string>;
      delete ortam["USERPROFILE"];
      if (up !== undefined) ortam["USERPROFILE"] = up;
      const h = await hataAl(() => ayarKur({ dosya: k.dosya, ortam, execPath: NODE, baslangicMs: BASLANGIC }));
      assert.ok(h instanceof AyarHatasi);
      assert.match(h.message, /USERPROFILE/);
    }
  });

  it("USERPROFILE adı büyük küçük harf duyarsız; yol .claude\\projects", async () => {
    const k = hazir();
    const ortam = { ...k.ortam } as Record<string, string>;
    delete ortam["USERPROFILE"];
    ortam["userprofile"] = UP + "\\";
    const a = await ayarKur({ dosya: k.dosya, ortam, execPath: NODE, baslangicMs: BASLANGIC });
    assert.equal(a.yollar.claudeProjeleri, `${UP}\\.claude\\projects`);
  });
});

describe("ayar: servis bilgisi", () => {
  // ayar.ts iki üst dizin: <surum>/server/src/ayar.ts -> <surum>/surum.json
  const SURUM_JSON = win32.normalize(fileURLToPath(new URL("../../surum.json", new URL("../src/ayar.ts", import.meta.url))));

  it("surum.json yoksa surum null; baslangic_ms geçirilir", async () => {
    const a = await kur(hazir());
    assert.deepEqual({ ...a.servis }, { surum: null, baslangic_ms: BASLANGIC });
  });

  it("surum.json varsa sha okunur (BOM'lu ve kirli kurulum adı dahil)", async () => {
    const k = hazir();
    k.dosya.yaz(SURUM_JSON, JSON.stringify({ sha: "abc1234", tarih_ms: 1 }));
    assert.equal((await kur(k)).servis.surum, "abc1234");
    k.dosya.yaz(SURUM_JSON, "﻿" + JSON.stringify({ sha: "abc1234-k1700000000" }));
    assert.equal((await kur(k)).servis.surum, "abc1234-k1700000000");
  });

  it("surum.json bozuksa ya da sha geçersizse null; atmaz", async () => {
    for (const ic of ["{ bozuk", "[]", "null", "{}", JSON.stringify({ sha: 5 }), JSON.stringify({ sha: "" }),
      JSON.stringify({ sha: "../x" }), JSON.stringify({ sha: "a".repeat(65) })]) {
      const k = hazir();
      k.dosya.yaz(SURUM_JSON, ic);
      assert.equal((await kur(k)).servis.surum, null, ic);
    }
  });
});

// eren-kit nötrleştirmesi (iskelet 95c5d09'daki server/test/ayar.test.ts'ten taşındı).
describe("ayar: eren-kit asistan adı ve veri kökü", () => {
  const kitKur = async (ek: Record<string, string> = {}) => {
    const dosya = sahteDosya();
    dosya.yaz("C:\\bin\\claude.exe", "x");
    return ayarKur({
      dosya,
      ortam: { LOCALAPPDATA: "C:\\Yerel", USERPROFILE: UP, PATH: "C:\\bin", ...ek } as Ortam,
      execPath: "C:\\bin\\node.exe",
      baslangicMs: BASLANGIC,
    });
  };

  it("asistan adı EREN_KIT_ASSISTANT_NAME'den gelir, yoksa nötr varsayılan", async () => {
    assert.equal((await kitKur()).asistanAdi, "Claude");
    assert.equal((await kitKur({ EREN_KIT_ASSISTANT_NAME: "  " })).asistanAdi, "Claude");
    assert.equal((await kitKur({ EREN_KIT_ASSISTANT_NAME: "Örnek Asistan" })).asistanAdi, "Örnek Asistan");
  });

  it("veri kökü LOCALAPPDATA altında proje ad alanıdır", async () => {
    const a = await kitKur();
    assert.equal(a.yollar.kok, "C:\\Yerel\\eren-kit");
    assert.equal(a.claudeExe, "C:\\bin\\claude.exe");
  });

  it("asistan adı bellek/asistan.py kuralıyla temizlenir", () => {
    assert.equal(asistanAdiUret(undefined), "Claude");
    assert.equal(asistanAdiUret("\t\n\u0007"), "Claude");
    assert.equal(asistanAdiUret("  Örnek   Asistan  "), "Örnek Asistan");
    // Kontrol, biçim ve boşluk dışı ayırıcılar atılır; sekme boşluğa dönmez.
    assert.equal(asistanAdiUret("Ör\u0000nek\u200b\tAd\u00a0\u2028x"), "ÖrnekAdx");
    assert.equal(asistanAdiUret("a".repeat(39) + " b"), "a".repeat(39));
    assert.equal(asistanAdiUret("ş".repeat(45)), "ş".repeat(40));
    assert.equal(asistanAdiUret("\u{1F600}".repeat(41)), "\u{1F600}".repeat(40));
  });

  it("EREN_KIT_DATA_DIR veri kökünü belirler, göreli yol reddedilir", async () => {
    const a = await kitKur({ EREN_KIT_DATA_DIR: "D:\\Veri\\kit" });
    assert.equal(a.yollar.kok, "D:\\Veri\\kit");
    assert.equal(a.yollar.vt, "D:\\Veri\\kit\\eren.db");
    assert.equal(a.yollar.anahtar, "D:\\Veri\\kit\\sunucu-anahtar.pem");
    assert.equal(a.yollar.yerelAyar, "D:\\Veri\\kit\\ayar.local.json");
    // Paylaşılan Claude limit kilidi veri kökünü izlemez.
    assert.equal(a.yollar.limitKilit, "C:\\Yerel\\ClaudeLimitKilit\\kilit.json");
    const ortam = (ek: Record<string, string>) => ({ LOCALAPPDATA: "C:\\Yerel", USERPROFILE: UP, ...ek }) as Ortam;
    assert.equal(yollariUret(ortam({ EREN_KIT_DATA_DIR: "E:/a/../b" })).kok, "E:\\b");
    assert.throws(() => yollariUret(ortam({ EREN_KIT_DATA_DIR: "veri" })), /EREN_KIT_DATA_DIR mutlak yol olmalı/);
    // Yerel ayar dosyası da özel kökten okunur.
    const dosya = sahteDosya();
    dosya.yaz("C:\\bin\\claude.exe", "x");
    dosya.yaz("D:\\Veri\\ayar.local.json", JSON.stringify({ ws_port: 50001 }));
    const b = await ayarKur({
      dosya,
      ortam: { LOCALAPPDATA: "C:\\Yerel", USERPROFILE: UP, PATH: "C:\\bin", EREN_KIT_DATA_DIR: "D:\\Veri" } as Ortam,
      execPath: "C:\\bin\\node.exe",
      baslangicMs: BASLANGIC,
    });
    assert.equal(b.wsPort, 50001);
  });
});

describe("ayar: medya", () => {
  const FF = "C:\\ornek\\ffmpeg\\bin";
  const MODEL = `${KOK}\\modeller\\ggml-large-v3-turbo-q5_0.bin`;
  const araclarla = (yerel?: unknown): Kurulum => {
    const k = hazir(yerel, { PATH: `C:\\ornek\\arac;${FF}` });
    k.dosya.yaz(`${FF}\\ffmpeg.exe`, "x");
    k.dosya.yaz(`${FF}\\ffprobe.exe`, "x");
    return k;
  };

  it("araçlar PATH'te yoksa medya null", async () => {
    assert.equal((await kur(hazir())).medya, null);
    const k = hazir({ claude_exe: EXE }, { PATH: FF });
    k.dosya.yaz(`${FF}\\ffmpeg.exe`, "x");
    assert.equal((await kur(k)).medya, null);
  });

  it("PATH'ten bulur; varsayılanlar; model yoksa null", async () => {
    const m = (await kur(araclarla())).medya;
    assert.ok(m);
    assert.equal(m.ffmpeg, `${FF}\\ffmpeg.exe`);
    assert.equal(m.ffprobe, `${FF}\\ffprobe.exe`);
    assert.equal(m.kok, `${KOK}\\medya`);
    assert.equal(m.dokumModeli, null);
    assert.equal(m.dokumVadModeli, null);
    assert.equal(m.dokumDili, "auto");
    assert.equal(m.kotaBayt, 10240 * 1024 * 1024);
    assert.equal(m.sinirlar.gorselNesilSiniri, 60);
    assert.equal(m.sinirlar.supurmeAraligiMs, 600_000);
  });

  it("varsayılan model dosyası varsa açık", async () => {
    const k = araclarla();
    k.dosya.yaz(MODEL, "x");
    assert.equal((await kur(k)).medya?.dokumModeli, "modeller/ggml-large-v3-turbo-q5_0.bin");
  });

  it("açık yollar, vad, dil, kota", async () => {
    const k = hazir({
      ffmpeg_yolu: "D:\\a\\ffmpeg.exe",
      ffprobe_yolu: "D:\\a\\ffprobe.exe",
      dokum_modeli: "modeller\\o.bin",
      dokum_vad_modeli: "modeller/v.bin",
      dokum_dili: "tr",
      medya_kota_mb: 500,
    });
    k.dosya.yaz("D:\\a\\ffmpeg.exe", "x");
    k.dosya.yaz("D:\\a\\ffprobe.exe", "x");
    k.dosya.yaz(`${KOK}\\modeller\\o.bin`, "x");
    const m = (await kur(k)).medya;
    assert.ok(m);
    assert.equal(m.ffmpeg, "D:\\a\\ffmpeg.exe");
    assert.equal(m.dokumModeli, "modeller/o.bin");
    assert.equal(m.dokumVadModeli, null);
    assert.equal(m.dokumDili, "tr");
    assert.equal(m.kotaBayt, 500 * 1024 * 1024);
  });

  it("belirtilen ffmpeg yolu yoksa medya null (PATH'e düşmez)", async () => {
    const k = araclarla({ ffmpeg_yolu: "D:\\yok\\ffmpeg.exe" });
    assert.equal((await kur(k)).medya, null);
  });

  it("geçersiz değerler AyarHatasi", async () => {
    for (const yerel of [
      { ffmpeg_yolu: "ffmpeg.exe" },
      { dokum_modeli: "..\\x.bin" },
      { dokum_modeli: "a/../../x.bin" },
      { dokum_modeli: "C:\\x.bin" },
      { dokum_vad_modeli: "/x.bin" },
      { dokum_dili: "en" },
      { medya_kota_mb: 99 },
      { medya_kota_mb: 1.5 },
      { medya_kota_mb: "10" },
    ]) {
      const e = await hataAl(() => kur(araclarla(yerel)));
      assert.ok(e instanceof AyarHatasi, JSON.stringify(yerel));
    }
  });
});
