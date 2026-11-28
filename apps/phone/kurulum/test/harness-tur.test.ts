import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PC_AJAN_ADLARI, pcAjani } from "../harness/tur.ts";
import * as uyarlayici from "../harness/claude-code.ts";
import * as giris from "../claude-code.ts";

const NODE = "C:\\Program Files\\nodejs\\node.exe";

test("kapalı ad listesi: claude-code ve codex; bilinmeyen ad, nesne anahtarı ve harf farkı null", () => {
  assert.deepEqual(PC_AJAN_ADLARI, ["claude-code", "codex"]);
  const a = pcAjani("claude-code");
  assert.ok(a !== null);
  assert.equal(a.ad, "claude-code");
  assert.equal(a.gorunenAd, "Claude Code");
  const c = pcAjani("codex");
  assert.ok(c !== null);
  assert.equal(c.ad, "codex");
  for (const ad of ["Codex", "codex-cli", "Claude-Code", "", "__proto__", "toString", "constructor"]) assert.equal(pcAjani(ad), null, ad);
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

test("MCP kaydı köprüyü sarmalayıcısız başlatır: '--'dan sonra node.exe'nin kendisi (T5: köprünün ebeveyni Claude Code)", () => {
  // Köprü hello'da `process.ppid`'i bildirir; servis onu kancanın `CLAUDE_PID`'iyle karşılaştırır. Arada
  // cmd /c, npx ya da sh -c olursa ebeveyn harness olmaz ve o pencerenin kayıtları taslak doğar.
  const y = uyarlayici.yollar({ LOCALAPPDATA: "C:\\Users\\Ad\\AppData\\Local", USERPROFILE: "C:\\Users\\Ad" }, NODE);
  const args = uyarlayici.mcpEkleArgumanlari(y);
  const komut = args.slice(args.indexOf("--") + 1);
  assert.equal(komut[0], NODE, "komut node.exe'nin kendisi");
  assert.match(komut[0]!, /\\node\.exe$/i);
  assert.deepEqual(komut.slice(1), ["--disable-warning=ExperimentalWarning", y.kopruBetigi, "--rol", "pc_oturumu"]);
  const SARMALAYICI = /^(cmd(\.exe)?|npx(\.cmd)?|npm(\.cmd)?|sh|bash|pwsh|powershell|wsl|start|env|\/c|-c|\/k)$/i;
  for (const a of komut) assert.equal(SARMALAYICI.test(a), false, `sarmalayıcı öğesi: ${a}`);
  // Kabuklara yazılan satırlar aynı komutu taşır (kabuk yalnız `claude mcp add`'i çalıştırır, köprüyü değil).
  for (const satir of uyarlayici.mcpKaydiSatirlari(y)) assert.equal(/\b(npx|cmd \/c|sh -c)\b/i.test(satir), false, satir);
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
    assert.equal(r.yedek, null, "güncel kanca: yedek alınmaz");
    assert.deepEqual(r.satirlar, [`Araç öncesi kanca zaten kurulu: ${yol}; hiçbir şey değişmedi.`]);
    assert.equal(readFileSync(yol, "utf8"), CANLI_METIN, "uyarlayıcı üzerinden: değişmedi");
    assert.deepEqual(giris.kancaDurumu(ortam), beklenen);
    // Hiçbiri değiştirmediği için hiç yedek kalmaz.
    assert.equal(readdirSync(join(dizin, ".claude")).filter((d) => d.includes(".yedek-")).length, 0);
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
    // Güncel kancada yazma ve yedek yok, tek satır yazılır.
    assert.equal(ikinci.yedek, null);
    assert.deepEqual(ikinci.satirlar, [`Araç öncesi kanca zaten kurulu: ${yol}; hiçbir şey değişmedi.`]);
    assert.equal(readdirSync(join(dizin, ".claude")).filter((d) => d.includes(".yedek-")).length, 0);
    assert.equal(a.kancaKaldir(ortam, secenek).degisti, true, "kaldırma");
    assert.equal(a.kancaKaldir(ortam, secenek).degisti, false, "ikinci kaldırma");
    writeFileSync(yol, '{\n  "model": "opus"\n}\n', "utf8");
    const kancasiz = a.kancaKur(ortam, NODE, { ...secenek, simdiMs: 3 });
    assert.equal(kancasiz.degisti, true, "kancasız ayara ekleme");
    assert.equal(typeof kancasiz.yedek, "string", "kancasız ayar: yedek alınır");
    assert.match(kancasiz.satirlar[0]!, /^Araç öncesi kanca eklendi: .* \(yedek: /);
    assert.equal(a.kancaKur(ortam, NODE, { ...secenek, simdiMs: 4 }).degisti, false);
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});
