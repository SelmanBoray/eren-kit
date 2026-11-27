import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PC_AJAN_ADLARI, pcAjani } from "../harness/tur.ts";
import * as uyarlayici from "../harness/claude-code.ts";
import * as giris from "../claude-code.ts";

const NODE = "C:\\Program Files\\nodejs\\node.exe";

test("kapalı ad listesi: yalnız claude-code; bilinmeyen ad, nesne anahtarı ve harf farkı null", () => {
  assert.deepEqual(PC_AJAN_ADLARI, ["claude-code"]);
  const a = pcAjani("claude-code");
  assert.ok(a !== null);
  assert.equal(a.ad, "claude-code");
  assert.equal(a.gorunenAd, "Claude Code");
  for (const ad of ["codex", "Claude-Code", "", "__proto__", "toString", "constructor"]) assert.equal(pcAjani(ad), null, ad);
});

test("uyarlayıcı bugünkü dışa verimlerin aynısıdır; kurulum/claude-code.ts bütün adları korur", async () => {
  const a = pcAjani("claude-code")!;
  assert.equal(a.kayitYonergesi, giris.kayitYonergesi);
  assert.equal(a.kancaDurumu, giris.kancaDurumu);
  assert.equal(giris.kayitYonergesi.length, 2, "kayitYonergesi(ortam, nodeExe)");
  assert.equal(giris.kancaDurumu.length, 1, "kancaDurumu(ortam)");
  // Bu dilimden önceki dışa verimler (adlar): hepsi hâlâ var ve uyarlayıcınınkiyle aynı nesne.
  const onceki = [
    "MCP_ADI", "KANCA_SURESI_SN", "KANCA_OLAYLARI", "ARAC_ESLESTIRICI", "yollar", "varsayilanAyarYolu", "kancaGirdisi",
    "kabukBicimiKomutu", "bizimKancaMi", "mcpEkleArgumanlari", "mcpEkleKomutu", "MCP_KALDIR_KOMUTU", "AyarHatasi",
    "kancaGruplari", "kancaDurumuCoz", "yonetilenAyarYolu", "kapatanAyarlar", "kancaDurumu", "kancalariCikar",
    "kancalariEkle", "ayarCoz", "gosterMetni", "kayitYonergesi", "calis",
  ];
  const g = giris as unknown as Record<string, unknown>;
  const u = uyarlayici as unknown as Record<string, unknown>;
  for (const ad of onceki) {
    assert.notEqual(g[ad], undefined, ad);
    assert.equal(g[ad], u[ad], ad);
  }
  // eslestir.ts'in yolu: aynı göreli yerden dinamik içe aktarma, iki işlev.
  const dinamik = (await import(new URL("../claude-code.ts", import.meta.url).href)) as Record<string, unknown>;
  assert.equal(typeof dinamik["kayitYonergesi"], "function");
  assert.equal(typeof dinamik["kancaDurumu"], "function");
  // Sabitler bayt bayt aynı.
  assert.equal(giris.MCP_ADI, "eren-ajanda");
  assert.equal(giris.ARAC_ESLESTIRICI, "mcp__eren-ajanda__.*");
  assert.equal(giris.MCP_KALDIR_KOMUTU, "claude mcp remove eren-ajanda -s user");
  assert.deepEqual(giris.mcpEkleArgumanlari({ nodeExe: "N", kopruBetigi: "K" }), ["mcp", "add", "eren-ajanda", "-s", "user", "--", "N", "--disable-warning=ExperimentalWarning", "K", "--rol", "pc_oturumu"]);
});

test("uyarlayıcı yolları yalnız ortamdan türetir: harness kaynaklarında import.meta yolu yok", () => {
  const dizin = new URL("../harness/", import.meta.url);
  const dosyalar = readdirSync(dizin).filter((d) => d.endsWith(".ts"));
  assert.ok(dosyalar.length >= 4, dosyalar.join(","));
  for (const d of dosyalar) assert.equal(/import\.meta\.(url|filename|dirname)/.test(readFileSync(new URL(d, dizin), "utf8")), false, d);
});

test("mcpKaydiYonergesi: kabuksuz üç kabuk, kabukla tek satır; kayıt yönergesindeki satırlarla aynı", () => {
  const a = pcAjani("claude-code")!;
  const ortam = { LOCALAPPDATA: "C:\\Users\\Ad Soyad\\AppData\\Local", USERPROFILE: "C:\\Users\\Ad Soyad" };
  const hepsi = a.mcpKaydiYonergesi(ortam, NODE);
  assert.ok(a.kayitYonergesi(ortam, NODE).includes(`${hepsi}\n`));
  const ps = a.mcpKaydiYonergesi(ortam, NODE, "powershell");
  assert.equal(ps, `   ${giris.mcpEkleKomutu(giris.yollar(ortam, NODE))}`);
  assert.ok(hepsi.includes(ps.trim()));
});

// Canlı kurulumun biçimi (sabit metin, koddan türetilmedi): PreToolUse, eşleyici `mcp__eren-ajanda__.*`,
// yürütme biçimi, `args` içinde `<veri kökü>\uygulama\guncel\server\src\kanca.ts arac`; yanında başka kancalar.
const CANLI_METIN = `{
  "model": "opus",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python -I \\"C:/x/hook.py\\" || true"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo bash"
          }
        ]
      },
      {
        "matcher": "mcp__eren-ajanda__.*",
        "hooks": [
          {
            "type": "command",
            "command": "C:\\\\Program Files\\\\nodejs\\\\node.exe",
            "args": [
              "--disable-warning=ExperimentalWarning",
              "C:\\\\Users\\\\Ornek\\\\AppData\\\\Local\\\\eren-kit\\\\uygulama\\\\guncel\\\\server\\\\src\\\\kanca.ts",
              "arac"
            ],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
`;

test("canlı kurulum korunur: kurulu kanca tanınır, kanca-ekle iki kez çalışınca dosya bayt bayt aynı, kancaDurumu aynı", () => {
  const dizin = mkdtempSync(join(tmpdir(), "eren-harness-canli-"));
  const log = console.log;
  console.log = () => undefined;
  try {
    const ortam = { LOCALAPPDATA: "C:\\Users\\Ornek\\AppData\\Local", USERPROFILE: dizin, ProgramFiles: join(dizin, "pf") };
    mkdirSync(join(dizin, ".claude"));
    const yol = join(dizin, ".claude", "settings.json");
    writeFileSync(yol, CANLI_METIN, "utf8");
    const beklenen = { ayarYolu: yol, arac: true, eski: 0, kabuk: 0, kapatan: [] };
    assert.deepEqual(giris.kancaDurumu(ortam), beklenen);
    assert.deepEqual(pcAjani("claude-code")!.kancaDurumu(ortam), beklenen);
    // Kurulu kancanın girdisi bugünkü kancaGirdisi'nin tam aynısı (eşleyici, komut, argümanlar, süre).
    const ayar = JSON.parse(CANLI_METIN) as { hooks: { PreToolUse: Array<{ matcher: string; hooks: unknown[] }> } };
    assert.deepEqual(giris.kancaGruplari(giris.yollar(ortam, NODE)).PreToolUse, ayar.hooks.PreToolUse[1]);
    assert.equal(giris.calis(["kanca-ekle"], ortam, NODE), 0);
    assert.equal(readFileSync(yol, "utf8"), CANLI_METIN, "bir kez: değişmedi");
    assert.equal(giris.calis(["kanca-ekle", "--ayar", yol], ortam, NODE), 0);
    assert.equal(readFileSync(yol, "utf8"), CANLI_METIN, "iki kez: değişmedi");
    const r = pcAjani("claude-code")!.kancaKur(ortam, NODE);
    assert.equal(r.ayarYolu, yol);
    assert.equal(r.degisti, false, "kanca zaten güncel: içerik değişmedi");
    assert.equal(typeof r.yedek, "string", "CLI ile aynı: yine yedeklenip yazılır");
    assert.equal(readFileSync(yol, "utf8"), CANLI_METIN, "uyarlayıcı üzerinden: değişmedi");
    assert.deepEqual(giris.kancaDurumu(ortam), beklenen);
    // Yedekler özgün içeriği tutar.
    const yedekler = readdirSync(join(dizin, ".claude")).filter((d) => d.includes(".yedek-"));
    assert.equal(yedekler.length, 3);
    for (const y of yedekler) assert.equal(readFileSync(join(dizin, ".claude", y), "utf8"), CANLI_METIN);
    // Kaldır ve geri kur: başkalarının kancası yerinde; bizimki yine PreToolUse'un sonunda, aynı metin.
    const k = pcAjani("claude-code")!.kancaKaldir(ortam);
    assert.equal(k.degisti, true);
    assert.deepEqual(giris.kancaDurumu(ortam), { ...beklenen, arac: false });
    assert.equal(pcAjani("claude-code")!.kancaKaldir(ortam).degisti, false, "ikinci kaldırma");
    assert.equal(pcAjani("claude-code")!.kancaKur(ortam, NODE).degisti, true, "kaldırmadan sonra kurma");
    assert.equal(readFileSync(yol, "utf8"), CANLI_METIN);
  } finally {
    console.log = log;
    rmSync(dizin, { recursive: true, force: true });
  }
});

test("degisti yalnız ayar içeriği değişince true: dosya yok, kancasız ayar, güncel kanca, kaldırma", () => {
  const dizin = mkdtempSync(join(tmpdir(), "eren-harness-degisti-"));
  try {
    const a = pcAjani("claude-code")!;
    const ortam = { LOCALAPPDATA: "C:\\Users\\Ornek\\AppData\\Local", USERPROFILE: dizin, ProgramFiles: join(dizin, "pf") };
    const yol = join(dizin, ".claude", "settings.json");
    const secenek = { ayarYolu: yol, simdiMs: 1 };
    assert.deepEqual([a.kancaKaldir(ortam, secenek).degisti, a.kancaKaldir(ortam, secenek).yedek], [false, null], "dosya yok: kaldırma");
    const ilk = a.kancaKur(ortam, NODE, secenek);
    assert.deepEqual([ilk.degisti, ilk.yedek], [true, null], "dosya yok: oluşturuldu");
    const ikinci = a.kancaKur(ortam, NODE, { ...secenek, simdiMs: 2 });
    assert.equal(ikinci.degisti, false, "güncel kanca");
    // Kullanıcıya yazılan satırlar degisti'den etkilenmez (yalnız yedek eklenir); yazma ve yedek sürer.
    assert.equal(typeof ikinci.yedek, "string");
    assert.deepEqual(ikinci.satirlar, [`${ilk.satirlar[0]} (yedek: ${ikinci.yedek})`, ...ilk.satirlar.slice(1)]);
    assert.equal(a.kancaKaldir(ortam, secenek).degisti, true, "kaldırma");
    assert.equal(a.kancaKaldir(ortam, secenek).degisti, false, "ikinci kaldırma");
    writeFileSync(yol, '{\n  "model": "opus"\n}\n', "utf8");
    const kancasiz = a.kancaKur(ortam, NODE, { ...secenek, simdiMs: 3 });
    assert.equal(kancasiz.degisti, true, "kancasız ayara ekleme");
    assert.equal(a.kancaKur(ortam, NODE, { ...secenek, simdiMs: 4 }).degisti, false);
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});
