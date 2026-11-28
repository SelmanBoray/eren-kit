// Codex CLI uyarlayıcısı (kurulum/harness/codex.ts): yalnız taslak (docs/HARNESS.md 3.1 T6; ölçüm
// docs/HARNESS-H3-OLCUM.md bölüm 6). Sabitlenen: kanca yok; kurulum kullanıcının Codex yapılandırmasına
// yazmaz ve dosya okumaz; yönerge dürüst (taslak doğar, telefondan onaylanır, nedeni, exec için approval_mode);
// köprü sarmalayıcısız ve `--uyarlayici codex` ile kaydedilir; Claude Code uyarlayıcısı değişmez.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pcAjani, yalnizTaslakMi } from "../harness/tur.ts";
import * as codex from "../harness/codex.ts";
import * as claude from "../harness/claude-code.ts";
import { KABUKLAR } from "../harness/kabuk.ts";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const ORTAM = { LOCALAPPDATA: "C:\\Users\\Ad Soyad\\AppData\\Local", USERPROFILE: "C:\\Users\\Ad Soyad" };
const KOK = "C:\\Users\\Ad Soyad\\AppData\\Local\\eren-kit";

test("codex yalnız taslaktır: kanca kurma, kaldırma ve durum işlevi yok; nedeni uyarlayıcıda", () => {
  const a = pcAjani("codex");
  assert.ok(a !== null);
  assert.equal(a, codex.CODEX);
  assert.equal(a.gorunenAd, "Codex CLI");
  assert.equal(yalnizTaslakMi(a), true);
  assert.equal(a.tasdik, "yalniz_taslak");
  const nesne = a as unknown as Record<string, unknown>;
  for (const ad of ["kancaKur", "kancaKaldir", "kancaDurumu"]) assert.equal(nesne[ad], undefined, ad);
  assert.deepEqual(Object.keys(a).sort(), ["ad", "gorunenAd", "kayitYonergesi", "mcpKaydiYonergesi", "tasdik", "taslakNedeni"]);
  if (!yalnizTaslakMi(a)) return;
  assert.match(a.taslakNedeni, /alt oturumdan \(review\)/);
  assert.match(a.taslakNedeni, /etkileşimli mi etkileşimsiz mi \(codex exec\)/);
  assert.match(a.taslakNedeni, /Codex'ten gelen bütün kayıtlar taslak doğar, telefondan onaylanır/);
});

test("kurulum ~/.codex'e ve global Codex'e yazmaz: kaynakta dosya ve süreç modülü yok; yönerge sahte kullanıcı dizinine dokunmaz", () => {
  const kaynak = readFileSync(new URL("../harness/codex.ts", import.meta.url), "utf8");
  for (const m of ["node:fs", "node:child_process", "\"fs\"", "\"child_process\"", "json-ayar"]) assert.equal(kaynak.includes(m), false, m);
  // Değer içe aktarımları yalnız saf yardımcılar: ortam (yol birleştirme), Claude Code'un yol ve ad sabitleri, kabuk.
  const iceAktarimlar = [...kaynak.matchAll(/^import (?!type)[^;]* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(iceAktarimlar, ["../ortam.ts", "./claude-code.ts", "./kabuk.ts"]);
  // Sahte kullanıcı ve CODEX_HOME dizini: yönerge ve satırlar üretildikten sonra ikisi de boş kalır.
  const dizin = mkdtempSync(join(tmpdir(), "eren-harness-codex-"));
  try {
    const kullanici = join(dizin, "kullanici");
    const codexHome = join(dizin, "codex-home");
    mkdirSync(kullanici);
    mkdirSync(codexHome);
    const ortam = { LOCALAPPDATA: join(dizin, "yerel"), USERPROFILE: kullanici, CODEX_HOME: codexHome };
    const a = pcAjani("codex")!;
    a.kayitYonergesi(ortam, NODE);
    for (const k of KABUKLAR) a.mcpKaydiYonergesi(ortam, NODE, k);
    a.mcpKaydiYonergesi(ortam, NODE);
    assert.deepEqual(readdirSync(kullanici), []);
    assert.deepEqual(readdirSync(codexHome), []);
    assert.deepEqual(readdirSync(dizin).sort(), ["codex-home", "kullanici"], "veri kökü de oluşturulmadı");
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});

test("yönerge dürüst: taslak doğar ve telefondan onaylanır, nedeni, kanca yok, exec için approval_mode; komutu kullanıcı çalıştırır", () => {
  const m = pcAjani("codex")!.kayitYonergesi(ORTAM, NODE);
  assert.match(m, /Codex'ten gelen kayıtlar TASLAK doğar ve telefondan \(Ajanda uygulaması\) onaylanır\./);
  assert.match(m, /bir alt oturumdan \(review\) mı geldiğini\nve oturumun etkileşimli mi etkileşimsiz mi \(codex exec\) olduğunu ayıramıyor/);
  assert.match(m, /ölçüldü: Codex 0\.172\.0/);
  assert.match(m, /Bu kurulum oraya yazmaz; komutu kendiniz çalıştırın/);
  assert.match(m, /2\. Kanca yok: kurmayın\./);
  assert.match(m, /codex exec \(etkileşimsiz\)[\s\S]*approval_mode = "approve" gerekir/);
  // exec maddesi: ölçülen gereklilik ile bilinmeyen yer ayrı; taslak cümlesi tek anlamlı (onaylanıp çalışan çağrı).
  assert.match(m, /Ölçülen yalnız bu gerekliliktir \(Codex 0\.172\.0,\n\s+docs\/HARNESS-H3-OLCUM\.md Ö10\)/);
  assert.match(m, /config\.toml'daki tam yeri[\s\S]*ölçülmedi, bilinmiyor/);
  assert.match(m, /Ayarla exec'te çalışan çağrının kaydı da, etkileşimli oturumdaki gibi, taslak doğar\./);
  assert.equal(/Onaysız çalışan/.test(m), false, "iki türlü okunan eski cümle yok");
  // Sentetik tur onaylanmış kayda dokunamaz: yönerge bunu ve örneğini söyler.
  assert.match(m, /Codex onaylanmış \(taslak olmayan\) kayda dokunamaz: "dişçiyi 11'e al" gibi bir değişiklik, kayıt telefonda\n\s+onaylandıysa reddedilir/);
  assert.match(m, /--teshis[\s\S]*cagri_kimligi_yok/);
  assert.match(m, /Kaldırma: codex mcp remove eren-ajanda;/);
  // Ölçülmemiş olan "çalışır" diye vaat edilmez: uçtan uca kayıt ölçülmedi diye işaretli.
  assert.equal(/Kayıtlar yine çalışır/.test(m), false, "ölçülmemiş iddia");
  assert.match(m, /Ölçülmedi: bu köprünün Codex altında servise bağlanıp kayıt\n\s+yazması uçtan uca denenmedi/);
  // "Onaylanmış kayda dokunamaz" dürüst köprü varsayımına dayanır; varsayım ve güven sınırı yazılı.
  assert.match(m, /köprülerin dürüst olduğu varsayımına dayanır\. Güven sınırı Windows kullanıcısıdır: kabuk erişimi olan bir\n\s+model \(sandbox izin verirse\) kancaya sahte girdi verip/);
  // Yönergeyi yeniden görmek anahtarı yenilemez: önerilen komut --yonerge.
  assert.match(m, /anahtara dokunmadan yeniden görmek: eren eslestir --pc-ajan codex --yonerge\n/);
  // Kanca kurma yönergesi, Claude'a özgü komut ya da "insan" vaadi yok.
  for (const yasak of [/kanca-ekle/, /PreToolUse/, /hooks/, /claude mcp/, /--claude-code/, /"insan"/, /settings\.json/]) assert.equal(yasak.test(m), false, String(yasak));
  // MCP satırları yönergede, kabuk başına.
  assert.ok(m.includes(`${pcAjani("codex")!.mcpKaydiYonergesi(ORTAM, NODE)}\n`));
});

test("MCP kaydı: sarmalayıcısız node.exe, --uyarlayici codex, veri kökü --env ile; kabuk satırları komutSatiri'dır", () => {
  const y = claude.yollar(ORTAM, NODE);
  const args = codex.mcpEkleArgumanlari(y, KOK);
  assert.deepEqual(args, [
    "mcp", "add", "eren-ajanda", "--env", `EREN_KIT_DATA_DIR=${KOK}`,
    "--", NODE, "--disable-warning=ExperimentalWarning", y.kopruBetigi, "--rol", "pc_oturumu", "--uyarlayici", "codex",
  ]);
  const komut = args.slice(args.indexOf("--") + 1);
  const SARMALAYICI = /^(cmd(\.exe)?|npx(\.cmd)?|npm(\.cmd)?|sh|bash|pwsh|powershell|wsl|start|env|\/c|-c|\/k)$/i;
  for (const a of komut) assert.equal(SARMALAYICI.test(a), false, `sarmalayıcı öğesi: ${a}`);
  assert.match(y.kopruBetigi, /\\uygulama\\guncel\\server\\src\\kopru\.ts$/, "guncel junction'ı (sürümden bağımsız)");
  // Veri kökü kurulumun kuralından (EREN_KIT_DATA_DIR verilmişse o).
  const ozel = codex.mcpKaydiSatirlari(claude.yollar({ ...ORTAM, EREN_KIT_DATA_DIR: "D:\\veri" }, NODE), "D:\\veri", "bash");
  assert.match(ozel[0]!, /--env 'EREN_KIT_DATA_DIR=D:\\veri'/);
  assert.equal(pcAjani("codex")!.mcpKaydiYonergesi(ORTAM, NODE, "powershell"), `   ${codex.mcpKaydiSatiri(y, KOK, "powershell")}`);
  const ps = codex.mcpKaydiSatiri(y, KOK, "powershell");
  assert.ok(ps.includes(" '--' "), "PowerShell'de -- tırnaklı (npm .ps1 kısayolu düz --'yı yutar)");
  const hepsi = codex.mcpKaydiSatirlari(y, KOK);
  assert.deepEqual(hepsi.filter((s) => s.endsWith(":")), ["   PowerShell (7 ve 5.1):", "   Git Bash:", "   cmd (Codex'te ölçülmedi):"]);
});

test("Claude Code uyarlayıcısı değişmedi: kancalı, aynı nesne, yönergesinde Codex yok; codex eklenmesi onun çıktısına dokunmaz", () => {
  const c = pcAjani("claude-code");
  assert.equal(c, claude.CLAUDE_CODE);
  assert.equal(yalnizTaslakMi(c), false);
  assert.equal(c.tasdik, undefined, "Claude Code nesnesi bu dilimde değişmedi");
  for (const ad of ["kancaKur", "kancaKaldir", "kancaDurumu"] as const) assert.equal(typeof c[ad], "function", ad);
  const m = c.kayitYonergesi(ORTAM, NODE);
  assert.equal(m, claude.gosterMetni(claude.yollar(ORTAM, NODE), claude.varsayilanAyarYolu(ORTAM), false));
  assert.equal(/codex|--uyarlayici/i.test(m), false);
  assert.ok(claude.mcpEkleArgumanlari(claude.yollar(ORTAM, NODE)).every((a) => a !== "--uyarlayici"), "canlı kayıt bayraksız kalır");
});
