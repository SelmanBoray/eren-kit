/**
 * Duman düzeneğinin kendi sınaması (model yok, canlı boruya dokunulmaz, `~/.claude`'a yazılmaz):
 *
 *   node --disable-warning=ExperimentalWarning test/duman/duzenek-sinama.ts
 *
 * - Boru kuralı (`boru-kural.ts`): canlı ad alanı önekli boruya, zaten önekli aynen, başka her boru hata.
 * - Kaydedicinin kapalı başarısızlığı (`mcpYonlendir` ve gerçek kaydedici süreci): yönlendirilemeyen köprü
 *   yapılandırmasında 91 ile çıkar, "gerçek claude" (burada işaret bırakan bir betik) hiç başlamaz.
 * - Önyükleme süreçte (`boru-yonlendir.ts`): `eren-*` adı bu sınamanın dinlediği duman borusuna ulaşır;
 *   başka uygulamanın borusu, başka belirteçli duman borusu, başka adla dinleme ve net katmanını atlayan
 *   yerel tanıtıcı çağrısı reddedilir; denetim günlüğü bunları yazar. Canlı adlar (eren-kopru, eren-ajanda,
 *   eren-servis-tekil, eren-bekci) bu süreç sınamasında HİÇ kullanılmaz: önyükleme bozuk olsa bile bağlantı
 *   var olmayan `eren-sinama`'ya gider. Canlı adların çevirisi saf kural sınamasında ve tam provada görülür.
 * - Argüman doğrulaması (`kosu.ts secenekleriAyristir`) ve `--cikti --sakla`'nın depoya dizin açmaması.
 * - `sahte-claude.ts` içe aktarılınca hiçbir şey yapmaz (giriş korunur).
 *
 * `.test.ts` değildir: `npm test` koşturmaz. Çıkış 0 = hepsi geçti.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canliBoruMu, hedefCoz } from "./boru-kural.ts";
import { mcpYonlendir, YONLENDIRME_HATASI_KODU } from "./kaydedici.ts";
import { ArgumanHatasi, secenekleriAyristir } from "./kosu.ts";
import type { BoruOlayi } from "./tipler.ts";

const DUMAN = dirname(fileURLToPath(import.meta.url));
const SERVER = join(DUMAN, "..", "..");
const NODE_BAYRAK = "--disable-warning=ExperimentalWarning";

let gecen = 0;
let kalan = 0;
const denet = (ad: string, ok: boolean, detay = ""): void => {
  process.stdout.write(`${ok ? "GECTI" : "KALDI"}  ${ad}${detay === "" ? "" : `  — ${detay}`}\n`);
  if (ok) gecen++;
  else kalan++;
};
const atar = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e instanceof Error ? e.constructor.name : "hata");
  }
};

// ---------------------------------------------------------------------------------------------
// 1. Boru kuralı (saf)
// ---------------------------------------------------------------------------------------------

function kuralSinamasi(): void {
  const b = "0123456789ab";
  const on = `\\\\.\\pipe\\eren-duman-${b}-`;
  const durumlar: Array<[string, string | null]> = [
    ["\\\\.\\pipe\\eren-kopru", `${on}kopru`],
    ["\\\\.\\pipe\\eren-ajanda", `${on}ajanda`],
    ["\\\\.\\pipe\\eren-servis-tekil", `${on}servis-tekil`],
    ["\\\\.\\pipe\\eren-bekci", `${on}bekci`],
    ["//./pipe/EREN-KOPRU", `${on}kopru`],
    ["\\\\?\\pipe\\eren-ajanda", `${on}ajanda`],
    [`${on}kopru`, `${on}kopru`],
    ["127.0.0.1", null],
    ["C:\\yol\\dosya", null],
  ];
  for (const [g, beklenen] of durumlar) {
    const c = hedefCoz(g, b);
    denet(`kural: ${g} → ${beklenen ?? "boru değil"}`, c === beklenen, String(c));
    if (c !== null) denet(`kural: ${g} sonucu canlı ad alanında değil`, !canliBoruMu(c));
  }
  for (const g of ["\\\\.\\pipe\\baska-uygulama", "\\\\.\\pipe\\eren-duman-ffffffffffff-kopru", "//./pipe/mojo.1234"]) {
    denet(`kural: ${g} reddedilir`, atar(() => hedefCoz(g, b)) === "EREN_DUMAN_BORU_RED");
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Kaydedicinin kapalı başarısızlığı
// ---------------------------------------------------------------------------------------------

const NODE = "C:\\ornek\\node\\node.exe";
const KOPRU = "C:\\ornek\\server\\src\\kopru.ts";
const kopruTanimi = (ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "stdio",
  command: NODE,
  args: [KOPRU, "--rol", "eren"],
  env: { EREN_KOPRU_JETON: "ornek" },
  ...ek,
});
const BOZUKLAR: Array<[string, string]> = [
  ["sarmalayıcı (cmd /c node kopru.ts)", JSON.stringify({ mcpServers: { eren: kopruTanimi({ command: "C:\\Windows\\System32\\cmd.exe", args: ["/c", NODE, KOPRU, "--rol", "eren"] }) } })],
  ["adı değişmiş node (node24.exe)", JSON.stringify({ mcpServers: { eren: kopruTanimi({ command: "C:\\ornek\\node\\node24.exe" }) } })],
  ["PATH'ten node (uzantısız)", JSON.stringify({ mcpServers: { eren: kopruTanimi({ command: "node" }) } })],
  ["args dize (dizi değil)", JSON.stringify({ mcpServers: { eren: kopruTanimi({ args: `${KOPRU} --rol eren` }) } })],
  ["yalnız jetonla tanınan köprü (python)", JSON.stringify({ mcpServers: { x: { command: "C:\\py\\python.exe", args: ["k.py"], env: { EREN_KOPRU_JETON: "j" } } } })],
  ["ayrıştırılamayan metin", '{"mcpServers": {"eren": '],
  ["mcpServers dizi", JSON.stringify({ mcpServers: [kopruTanimi()] })],
];

function yonlendirmeSinamasi(): void {
  const iyi = mcpYonlendir(JSON.stringify({ mcpServers: { eren: kopruTanimi(), "eren-ajanda": kopruTanimi({ args: [KOPRU, "--rol", "ana_oturum"] }) } }), NODE, "file:///x?onek=0123456789ab");
  const kopya = iyi.tur === "kopya" ? (JSON.parse(iyi.metin) as { mcpServers: Record<string, { args: string[] }> }) : null;
  denet(
    "mcpYonlendir: doğrudan node.exe kopru.ts → kopya, args başında --import",
    kopya !== null && Object.values(kopya.mcpServers).every((s) => s.args[0] === "--import" && s.args[1] === "file:///x?onek=0123456789ab"),
    iyi.tur,
  );
  for (const [ad, metin] of BOZUKLAR) {
    const r = mcpYonlendir(metin, NODE, "file:///x?onek=0123456789ab");
    denet(`mcpYonlendir: ${ad} → hata`, r.tur === "hata", r.tur === "hata" ? r.neden : r.tur);
  }
  denet("mcpYonlendir: boş mcpServers → aynen", mcpYonlendir('{"mcpServers":{}}', NODE, "u").tur === "aynen");
  denet("mcpYonlendir: köprüsüz, node'suz sunucu → aynen", mcpYonlendir(JSON.stringify({ mcpServers: { cu: { command: "C:\\x\\cu.exe", args: [] } } }), NODE, "u").tur === "aynen");
}

function kaydediciSurecSinamasi(t: string): void {
  const kayit = join(t, "kayit");
  mkdirSync(kayit, { recursive: true });
  const isaretci = join(t, "isaretci.mjs");
  writeFileSync(
    isaretci,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(join(t, "isaret-"))} + process.pid + ".json", JSON.stringify(process.argv.slice(2)));\n`,
  );
  const ayar = join(t, "kaydedici-ayar.json");
  writeFileSync(ayar, JSON.stringify({ gercekClaude: process.execPath, kayitDizini: kayit, model: null, onyukleme: "file:///x?onek=0123456789ab" }));
  const isaretler = (): string[] => readdirSync(t).filter((a) => a.startsWith("isaret-"));
  const kos = (mcp: string): { kod: number | null; stderr: string } => {
    const yol = join(t, `mcp-${randomBytes(4).toString("hex")}.json`);
    writeFileSync(yol, mcp);
    const r = spawnSync(process.execPath, [NODE_BAYRAK, join(DUMAN, "kaydedici.ts"), ayar, isaretci, "--mcp-config", yol], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    return { kod: r.status, stderr: r.stderr ?? "" };
  };
  // Süreç sınamasında köprünün komutu bu makinenin node'u olmalı (kaydedici process.execPath ile eşler).
  const yerel = (m: string): string => m.split(JSON.stringify(NODE).slice(1, -1)).join(JSON.stringify(process.execPath).slice(1, -1));
  for (const [ad, metin] of BOZUKLAR.slice(0, 3)) {
    const once = isaretler().length;
    const r = kos(yerel(metin));
    denet(`kaydedici süreci: ${ad} → ${YONLENDIRME_HATASI_KODU} ile çıktı, gerçek claude başlamadı`, r.kod === YONLENDIRME_HATASI_KODU && isaretler().length === once, `kod ${r.kod}, ${r.stderr.trim()}`);
  }
  const once = isaretler().length;
  const r = kos(yerel(JSON.stringify({ mcpServers: { eren: kopruTanimi() } })));
  const yeni = isaretler().slice(once);
  let argv: string[] = [];
  if (yeni[0] !== undefined) argv = JSON.parse(readFileSync(join(t, yeni[0]), "utf8")) as string[];
  const kopyaYolu = argv[argv.indexOf("--mcp-config") + 1] ?? "";
  const kopyaMetni = existsSync(kopyaYolu) ? readFileSync(kopyaYolu, "utf8") : "";
  denet(
    "kaydedici süreci (olumlu denetim): doğru köprü → gerçek claude başladı, mcp kopyasında --import",
    r.kod === 0 && yeni.length === 1 && kopyaYolu.startsWith(kayit) && kopyaMetni.includes('"--import","file:///x?onek=0123456789ab"'),
    `kod ${r.kod}, işaret ${yeni.length}`,
  );
  const jsonl = readdirSync(kayit).filter((a) => /^\d+\.jsonl$/.test(a));
  const hatalar = jsonl.filter((a) => readFileSync(join(kayit, a), "utf8").includes('"yonlendirme":{"tur":"hata"'));
  denet("kaydedici kaydı: kapalı başarısızlıklar baslat kaydında yonlendirme=hata olarak görünür", hatalar.length === 3, `${hatalar.length}/${jsonl.length}`);
}

// ---------------------------------------------------------------------------------------------
// 3. Önyükleme süreçte
// ---------------------------------------------------------------------------------------------

const COCUK = `
import net from "node:net";
if (typeof globalThis[Symbol.for("eren-duman-boru-yonlendir")] !== "string") { console.log(JSON.stringify({ hata: "onyukleme yok" })); process.exit(50); }
const sonuc = {};
const dene = async (ad, f) => { try { sonuc[ad] = await f(); } catch (e) { sonuc[ad] = { atti: e.code ?? e.message }; } };
const baglan = (yol) => new Promise((coz, red) => { const s = net.connect(yol); s.once("connect", () => { s.end(); coz({ baglandi: true }); }); s.once("error", red); });
await dene("eren_ad_alani", () => baglan("\\\\\\\\.\\\\pipe\\\\eren-sinama"));
await dene("ileri_egik_buyuk", () => baglan("//./pipe/EREN-SINAMA"));
await dene("baska_uygulama", () => baglan("\\\\\\\\.\\\\pipe\\\\baska-uygulama-" + process.pid));
await dene("baska_belirtec", () => baglan("\\\\\\\\.\\\\pipe\\\\eren-duman-ffffffffffff-kopru"));
await dene("baska_dinleme", () => new Promise((coz, red) => { const s = net.createServer(); s.once("error", red); s.listen("\\\\\\\\.\\\\pipe\\\\baska-dinleme-" + process.pid, () => { s.close(); coz({ dinledi: true }); }); }));
await dene("yerel_katman", () => { const { Pipe, PipeConnectWrap, constants } = process.binding("pipe_wrap"); const h = new Pipe(constants.SOCKET); const req = new PipeConnectWrap(); req.oncomplete = () => {}; const r = h.connect(req, "\\\\\\\\.\\\\pipe\\\\baska-yerel-" + process.pid); h.close(); return { donen: r }; });
console.log(JSON.stringify(sonuc));
`;

async function onyuklemeSinamasi(t: string): Promise<void> {
  const b = randomBytes(6).toString("hex");
  const kok = join(tmpdir(), `eren-duman-${b}`);
  mkdirSync(kok, { recursive: true });
  const url = `${pathToFileURL(join(DUMAN, "boru-yonlendir.ts")).href}?onek=${b}`;
  try {
    const belirtecsiz = spawnSync(process.execPath, [NODE_BAYRAK, "--import", pathToFileURL(join(DUMAN, "boru-yonlendir.ts")).href, "-e", ""], { encoding: "utf8", windowsHide: true });
    denet("önyükleme: belirteçsiz süreç 97 ile düşer", belirtecsiz.status === 97, String(belirtecsiz.status));

    let gelen = 0;
    const sunucu = net.createServer((c) => {
      gelen++;
      c.end();
    });
    await new Promise<void>((coz, red) => {
      sunucu.once("error", red);
      sunucu.listen(`\\\\.\\pipe\\eren-duman-${b}-sinama`, () => coz());
    });
    const cocuk = join(t, "cocuk.mjs");
    writeFileSync(cocuk, COCUK);
    // Eşzamansız: dinleyici bu süreçte, olay döngüsü açık kalmalı.
    const r = await spawnAsync(process.execPath, [NODE_BAYRAK, "--import", url, cocuk]);
    await new Promise<void>((coz) => sunucu.close(() => coz()));
    let s: Record<string, { baglandi?: boolean; atti?: string; dinledi?: boolean }> = {};
    try {
      s = JSON.parse(r.cikti.trim().split("\n").at(-1) ?? "{}") as typeof s;
    } catch {
      // aşağıdaki denetimler kalır
    }
    denet("önyükleme: eren-* adı duman borusuna ulaştı (sınamanın dinleyicisi)", s["eren_ad_alani"]?.baglandi === true, JSON.stringify(s["eren_ad_alani"]));
    denet("önyükleme: //./pipe/EREN-... (eğik çizgi, büyük harf) de çevrildi", s["ileri_egik_buyuk"]?.baglandi === true, JSON.stringify(s["ileri_egik_buyuk"]));
    denet("önyükleme: dinleyiciye gelen bağlantı 2", gelen === 2, String(gelen));
    for (const ad of ["baska_uygulama", "baska_belirtec", "baska_dinleme", "yerel_katman"]) {
      denet(`önyükleme: ${ad} reddedildi (EREN_DUMAN_BORU_RED)`, s[ad]?.atti === "EREN_DUMAN_BORU_RED", JSON.stringify(s[ad]));
    }
    const gunluk = join(kok, "boru");
    const olaylar: BoruOlayi[] = existsSync(gunluk)
      ? readdirSync(gunluk).flatMap((a) =>
          readFileSync(join(gunluk, a), "utf8")
            .split("\n")
            .filter((x) => x !== "")
            .map((x) => JSON.parse(x) as BoruOlayi),
        )
      : [];
    const baglan = olaylar.filter((o): o is Extract<BoruOlayi, { t: "baglan" }> => o.t === "baglan");
    denet("günlük: yuklendi 1", olaylar.filter((o) => o.t === "yuklendi").length === 1);
    denet(
      "günlük: yerel katmanda 2 bağlantı, ikisi de duman borusuna, canlı ad alanına 0",
      baglan.length === 2 && baglan.every((o) => o.hedef === `\\\\.\\pipe\\eren-duman-${b}-sinama`) && !baglan.some((o) => canliBoruMu(o.hedef)),
      baglan.map((o) => o.hedef).join(", "),
    );
    denet("günlük: red 4", olaylar.filter((o) => o.t === "red").length === 4, String(olaylar.filter((o) => o.t === "red").length));
    denet("önyüklemeli süreç 0 ile çıktı", r.kod === 0, `${r.kod} ${r.hata.slice(0, 200)}`);
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
}

function spawnAsync(exe: string, args: string[]): Promise<{ kod: number | null; cikti: string; hata: string }> {
  return new Promise((coz) => {
    const p = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let cikti = "";
    let hata = "";
    p.stdout.on("data", (x: Buffer) => (cikti += x.toString("utf8")));
    p.stderr.on("data", (x: Buffer) => (hata += x.toString("utf8")));
    const zaman = setTimeout(() => p.kill(), 30_000);
    p.once("close", (kod) => {
      clearTimeout(zaman);
      coz({ kod, cikti, hata });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Argümanlar (D3) ve içe aktarma güvenliği (D4)
// ---------------------------------------------------------------------------------------------

function argumanSinamasi(t: string): void {
  const hata = (argv: string[]): string | null => {
    try {
      secenekleriAyristir(argv);
      return null;
    } catch (e) {
      return e instanceof ArgumanHatasi ? e.message : `beklenmeyen: ${String(e)}`;
    }
  };
  const durumlar: Array<[string[], string]> = [
    [["--kuru", "--cikti", "--sakla"], "değer ister"],
    [["--kuru", "--cikti"], "değer ister"],
    [["--kuru", "--cikti", join(SERVER, "duman-cikti")], "git çalışma ağacı"],
    [["--kuru", "--cikti", join(DUMAN, "..", "..", "..", "..", "..", "x")], "git çalışma ağacı"],
    [["--kuru", "--bilinmeyen"], "bilinmeyen"],
    [["--kuru", "--evet"], "birden çok kip"],
    [["--kuru", "--kuru"], "yinelenen"],
    [["--temizle", "--sakla"], "değer ister"],
    [["--temizle", "xyz"], "12 hane"],
    [["--kuru", "--claude", "claude.exe"], "mutlak yolu"],
  ];
  for (const [argv, beklenen] of durumlar) {
    const h = hata(argv);
    denet(`argüman: ${argv.join(" ")} → reddedildi (${beklenen})`, h !== null && h.includes(beklenen), String(h));
  }
  const iyi = (() => {
    try {
      return secenekleriAyristir(["--sahte-claude", "--cikti", join(t, "cikti"), "--sakla"]);
    } catch (e) {
      return String(e);
    }
  })();
  denet("argüman: --sahte-claude --cikti <depo dışı> --sakla kabul", typeof iyi === "object" && iyi.kip === "sahte" && iyi.sakla && iyi.cikti !== null, typeof iyi === "string" ? iyi : "");

  // Uçtan uca: eski kodda `--cikti --sakla` çıktıyı depo içine (`apps/phone/server/--sakla`) açardı.
  const r = spawnSync(process.execPath, [NODE_BAYRAK, join(DUMAN, "kosu.ts"), "--sahte-claude", "--cikti", "--sakla"], { cwd: SERVER, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  denet("kosu.ts --sahte-claude --cikti --sakla: 2 ile çıktı, hiçbir şey başlamadı, depoda --sakla dizini yok", r.status === 2 && !existsSync(join(SERVER, "--sakla")) && !(r.stdout ?? "").includes("belirteç"), `${r.status} ${(r.stderr ?? "").trim()}`);
}

function iceAktarmaSinamasi(): void {
  const url = pathToFileURL(join(DUMAN, "sahte-claude.ts")).href;
  const r = spawnSync(process.execPath, [NODE_BAYRAK, "--input-type=module", "-e", `await import(${JSON.stringify(url)}); process.stdout.write("hayatta");`], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  denet("sahte-claude.ts içe aktarılınca hiçbir şey yazmaz, içe aktaranı sonlandırmaz", r.status === 0 && r.stdout === "hayatta", JSON.stringify((r.stdout ?? "").slice(0, 120)));
}

// ---------------------------------------------------------------------------------------------

async function calistir(): Promise<number> {
  const t = mkdtempSync(join(tmpdir(), "eren-duzenek-sinama-"));
  try {
    kuralSinamasi();
    yonlendirmeSinamasi();
    kaydediciSurecSinamasi(t);
    if (kalan > 0) {
      process.stdout.write("kural ya da kaydedici sınaması kaldı: süreç içi önyükleme sınaması atlandı\n");
    } else await onyuklemeSinamasi(t);
    argumanSinamasi(t);
    iceAktarmaSinamasi();
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
  process.stdout.write(`\nDUZENEK SINAMASI: ${kalan === 0 ? "BASARILI" : "BASARISIZ"} (${gecen} geçti, ${kalan} kaldı)\n`);
  return kalan === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await calistir());
