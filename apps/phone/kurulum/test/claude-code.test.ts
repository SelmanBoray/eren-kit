import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARAC_ESLESTIRICI,
  AyarHatasi,
  ayarCoz,
  bizimKancaMi,
  calis,
  gosterMetni,
  KANCA_OLAYLARI,
  kancaDurumu,
  kancaDurumuCoz,
  kancaGruplari,
  kabukBicimiKomutu,
  kancaGirdisi,
  kancalariCikar,
  kancalariEkle,
  kayitYonergesi,
  mcpEkleKomutu,
  yollar,
} from "../claude-code.ts";

const ORTAM = { LOCALAPPDATA: "C:\\ornek\\Yerel", USERPROFILE: "C:\\ornek\\Kullanici" };
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const Y = yollar(ORTAM, NODE);

test("yollar kurulu sürümün (guncel) köprüsünü, hafif kancasını ve veri kökündeki anahtarı gösterir; sürüm dizini yok", () => {
  assert.deepEqual(Y, {
    nodeExe: NODE,
    kopruBetigi: "C:\\ornek\\Yerel\\eren-kit\\uygulama\\guncel\\server\\src\\kopru.ts",
    kancaBetigi: "C:\\ornek\\Yerel\\eren-kit\\uygulama\\guncel\\server\\src\\kanca.ts",
    anahtarDosyasi: "C:\\ornek\\Yerel\\eren-kit\\ajanda-pc.anahtar",
  });
  const ozel = yollar({ ...ORTAM, EREN_KIT_DATA_DIR: "D:\\veri" }, NODE);
  assert.equal(ozel.kopruBetigi, "D:\\veri\\uygulama\\guncel\\server\\src\\kopru.ts");
  assert.equal(ozel.kancaBetigi, "D:\\veri\\uygulama\\guncel\\server\\src\\kanca.ts");
  // Tek kaynak: yollar yalnız ortamdan (veri kökü) türer; betiğin kendi yeri hiçbir yola girmez.
  const kaynak = readFileSync(new URL("../claude-code.ts", import.meta.url), "utf8");
  assert.equal(/import\.meta\.(url|filename|dirname)/.test(kaynak), false);
  for (const metin of [gosterMetni(Y, "C:\\a\\settings.json"), kayitYonergesi(ORTAM, NODE), JSON.stringify(kancalariEkle({}, Y))]) {
    assert.equal(/surumler/i.test(metin), false);
  }
});

test("server/src altında yollardaki betikler var (kurulu sürümde de aynı göreli yer)", () => {
  for (const ad of ["kopru.ts", "kanca.ts"]) assert.ok(existsSync(new URL(`../../server/src/${ad}`, import.meta.url)), ad);
});

test("kanca yürütme biçimindedir (command + args, kabuk yok): yollar olduğu gibi, tırnak ve || true yok", () => {
  assert.deepEqual(kancaGirdisi(Y, "arac"), {
    type: "command",
    command: NODE,
    args: ["--disable-warning=ExperimentalWarning", "C:\\ornek\\Yerel\\eren-kit\\uygulama\\guncel\\server\\src\\kanca.ts", "arac"],
    timeout: 10,
  });
  const g = JSON.stringify(kancaGirdisi(Y, "arac"));
  assert.equal(/\|\||\\"/.test(g), false, "kabuk sözdizimi kaldı");
  assert.equal(bizimKancaMi(kancaGirdisi(Y, "arac")), true);
  assert.equal(bizimKancaMi(kancaGirdisi(Y, "istem")), true);
  // Yürütme biçiminde başkasının kancası tanınmaz; köprünün eski --kanca biçimi tanınır.
  assert.equal(bizimKancaMi({ type: "command", command: "node", args: ["C:\\baska\\kanca.ts", "arac"] }), false);
  assert.equal(bizimKancaMi({ type: "command", command: "node", args: ["C:\\x\\server\\src\\kanca.ts", "baska"] }), false);
  assert.equal(bizimKancaMi({ type: "command", command: "node", args: ["C:\\x\\server\\src\\kopru.ts", "--kanca", "arac"] }), true);
  assert.equal(bizimKancaMi({ type: "command", args: ["C:\\x\\server\\src\\kanca.ts", "arac"] }), false, "command yok");
});

test("önceki kabuk biçimi tırnaklı ve ileri eğik çizgili; kendi kancamız (yeni ve eski biçim) tanınır, başkası tanınmaz", () => {
  const k = kabukBicimiKomutu(Y, "istem");
  assert.equal(k, '"C:/Program Files/nodejs/node.exe" --disable-warning=ExperimentalWarning "C:/ornek/Yerel/eren-kit/uygulama/guncel/server/src/kanca.ts" istem || true');
  assert.equal(bizimKancaMi(k), true);
  assert.equal(bizimKancaMi(kabukBicimiKomutu(Y, "tur_sonu")), true);
  // Önceki biçim (köprünün `--kanca`'sı, sürüm dizinli yol): kanca-ekle onu yenisiyle değiştirir.
  const eski = '"C:/x/node.exe" --disable-warning=ExperimentalWarning "C:/ornek/Yerel/eren-kit/uygulama/surumler/abc/server/src/kopru.ts" --kanca arac || true';
  assert.equal(bizimKancaMi(eski), true);
  const temiz = kancalariEkle({ hooks: { PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [{ type: "command", command: eski }] }] } }, Y);
  assert.deepEqual((temiz["hooks"] as Record<string, unknown>)["PreToolUse"], [{ matcher: ARAC_ESLESTIRICI, hooks: [kancaGirdisi(Y, "arac")] }]);
  assert.equal(bizimKancaMi('python -I "C:/x/hook.py" || true'), false);
  assert.equal(bizimKancaMi('node "C:/baska/kanca.ts" istem'), false);
  assert.equal(bizimKancaMi("node kopru.ts --rol eren"), false);
  assert.equal(bizimKancaMi(undefined), false);
  assert.match(mcpEkleKomutu(Y), /^claude mcp add eren-ajanda -s user -- 'C:\\Program Files\\nodejs\\node\.exe' --disable-warning=ExperimentalWarning C:\\ornek\\Yerel\\eren-kit\\uygulama\\guncel\\server\\src\\kopru\.ts --rol pc_oturumu$/);
});

test("yalın yol: tek kanca, yalnız ajanda araçlarından önce (PreToolUse, eşleyici mcp__eren-ajanda__.*); istem ve tur sonu yok", () => {
  assert.deepEqual(KANCA_OLAYLARI, { PreToolUse: "arac" });
  assert.deepEqual(kancaGruplari(Y), {
    PreToolUse: { matcher: "mcp__eren-ajanda__.*", hooks: [kancaGirdisi(Y, "arac")] },
  });
  assert.deepEqual(Object.keys(kancalariEkle({}, Y)["hooks"] as object), ["PreToolUse"]);
});

test("kanca ekleme: başka kancalara ve anahtarlara dokunmaz, idempotent; eski sürüm yolu yenisiyle değişir", () => {
  const baska = { type: "command", command: 'python -I "C:/x/hook.py" || true' };
  const ayar = {
    model: "opus",
    permissions: { allow: ["Bash(git status)"] },
    hooks: { UserPromptSubmit: [{ hooks: [baska] }], SessionStart: [{ hooks: [baska] }] },
  };
  const bir = kancalariEkle(ayar, Y);
  assert.deepEqual(ayar.hooks.UserPromptSubmit, [{ hooks: [baska] }], "girdi değişti");
  assert.equal(bir["model"], "opus");
  assert.deepEqual(bir["permissions"], { allow: ["Bash(git status)"] });
  const h = bir["hooks"] as Record<string, Array<Record<string, unknown>>>;
  assert.deepEqual(h["SessionStart"], [{ hooks: [baska] }]);
  assert.deepEqual(h["UserPromptSubmit"], [{ hooks: [baska] }], "başkasının istem kancası durur, bizimki eklenmez");
  assert.deepEqual(h["PreToolUse"], [{ matcher: ARAC_ESLESTIRICI, hooks: [kancaGirdisi(Y, "arac")] }]);
  assert.equal(h["Stop"], undefined);
  assert.deepEqual(kancalariEkle(bir, Y), bir, "ikinci ekleme aynı");
  const yeniY = yollar({ ...ORTAM, EREN_KIT_DATA_DIR: "D:\\veri" }, NODE);
  const yeni = kancalariEkle(bir, yeniY)["hooks"] as Record<string, Array<Record<string, Array<Record<string, unknown>>>>>;
  assert.equal(yeni["PreToolUse"]!.length, 1);
  assert.deepEqual(yeni["PreToolUse"]![0]!["hooks"]![0], kancaGirdisi(yeniY, "arac"));
});

test("kabuk biçimli araç kancası kurulu sayılır ama ayrıca bildirilir; kanca-ekle onu yürütme biçimine çevirir", () => {
  const kabuk = { type: "command", command: kabukBicimiKomutu(Y, "arac"), timeout: 10 };
  const ayar = { hooks: { PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [kabuk] }] } };
  assert.deepEqual(kancaDurumuCoz(ayar), { arac: true, eski: 0, kabuk: 1 });
  const yeni = kancalariEkle(ayar, Y);
  assert.deepEqual(yeni, { hooks: { PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [kancaGirdisi(Y, "arac")] }] } });
  assert.deepEqual(kancaDurumuCoz(yeni), { arac: true, eski: 0, kabuk: 0 });
});

test("önceki kurulumdan geçiş: kanca-ekle eski istem ve tur sonu kancalarını çıkarır, yalnız araç öncesini bırakır", () => {
  const baska = { type: "command", command: "echo x" };
  const onceki = {
    hooks: {
      UserPromptSubmit: [{ hooks: [baska] }, { hooks: [{ type: "command", command: kabukBicimiKomutu(Y, "istem"), timeout: 10 }] }],
      PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [kancaGirdisi(Y, "arac")] }],
      Stop: [{ hooks: [{ type: "command", command: kabukBicimiKomutu(Y, "tur_sonu"), timeout: 10 }] }],
    },
  };
  assert.deepEqual(kancaDurumuCoz(onceki), { arac: true, eski: 2, kabuk: 0 });
  const yeni = kancalariEkle(onceki, Y);
  assert.deepEqual(yeni, {
    hooks: {
      UserPromptSubmit: [{ hooks: [baska] }],
      PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [kancaGirdisi(Y, "arac")] }],
    },
  });
  assert.deepEqual(kancaDurumuCoz(yeni), { arac: true, eski: 0, kabuk: 0 });
});

test("kanca durumu: yok, kurulu, eşleyicisiz ya da yanlış olaydaki araç kancası eski sayılır; dosya yoksa ve bozuksa", () => {
  assert.deepEqual(kancaDurumuCoz({}), { arac: false, eski: 0, kabuk: 0 });
  assert.deepEqual(kancaDurumuCoz(kancalariEkle({}, Y)), { arac: true, eski: 0, kabuk: 0 });
  for (const komut of [kancaGirdisi(Y, "arac"), { type: "command", command: kabukBicimiKomutu(Y, "arac") }]) {
    assert.deepEqual(kancaDurumuCoz({ hooks: { PreToolUse: [{ hooks: [komut] }] } }), { arac: false, eski: 1, kabuk: 0 }, "eşleyicisiz: her araçta çalışır");
    assert.deepEqual(kancaDurumuCoz({ hooks: { PostToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [komut] }] } }), { arac: false, eski: 1, kabuk: 0 });
  }
  assert.deepEqual(kancaDurumuCoz({ hooks: { PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [{ type: "command", command: "echo x" }] }] } }), { arac: false, eski: 0, kabuk: 0 });
  const kopruKancasi = { type: "command", command: '"C:/x/node.exe" "C:/x/server/src/kopru.ts" --kanca arac || true' };
  assert.deepEqual(kancaDurumuCoz({ hooks: { PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [kopruKancasi] }] } }), { arac: false, eski: 1, kabuk: 0 });
  const dizin = mkdtempSync(join(tmpdir(), "eren-claude-code-durum-"));
  try {
    const ortam = { ...ORTAM, USERPROFILE: dizin };
    const yol = join(dizin, ".claude", "settings.json");
    const bos = { ayarYolu: yol, eski: 0, kabuk: 0, kapatan: [] };
    assert.deepEqual(kancaDurumu(ortam), { ...bos, arac: false });
    assert.equal(calis(["kanca-ekle"], ortam, NODE), 0);
    assert.deepEqual(kancaDurumu(ortam), { ...bos, arac: true });
    writeFileSync(yol, "{bozuk", "utf8");
    const bozuk = kancaDurumu(ortam);
    assert.equal(bozuk.arac, null);
    assert.match(bozuk.hata ?? "", /geçerli JSON değil/);
    // BOM'lu dosya okunur (Claude Code da okur); UTF-16 doğru nedenle okunamaz.
    writeFileSync(yol, `\uFEFF${JSON.stringify(kancalariEkle({}, Y))}`, "utf8");
    assert.deepEqual(kancaDurumu(ortam), { ...bos, arac: true });
    writeFileSync(yol, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("{}", "utf16le")]));
    assert.match(kancaDurumu(ortam).hata ?? "", /UTF-16/);
    assert.equal(kancaDurumu({ LOCALAPPDATA: ORTAM.LOCALAPPDATA }).arac, null, "USERPROFILE yok: atmaz");
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});

test("kanca durumu: kancaları kapatan ayarlar (kullanıcıda ve yönetilen ayarda disableAllHooks, allowManagedHooksOnly) bildirilir", () => {
  const dizin = mkdtempSync(join(tmpdir(), "eren-claude-code-kapali-"));
  try {
    const pf = join(dizin, "ProgramFiles");
    const ortam = { ...ORTAM, USERPROFILE: dizin, ProgramFiles: pf };
    const yol = join(dizin, ".claude", "settings.json");
    assert.equal(calis(["kanca-ekle"], ortam, NODE), 0);
    assert.deepEqual(kancaDurumu(ortam).kapatan, []);
    writeFileSync(yol, JSON.stringify({ ...kancalariEkle({}, Y), disableAllHooks: true }), "utf8");
    const d = kancaDurumu(ortam);
    assert.equal(d.arac, true, "kanca yazılı");
    assert.deepEqual(d.kapatan, ["kullanıcı ayarında disableAllHooks: true"]);
    writeFileSync(yol, JSON.stringify(kancalariEkle({}, Y)), "utf8");
    const yYol = join(pf, "ClaudeCode", "managed-settings.json");
    mkdirSync(join(pf, "ClaudeCode"), { recursive: true });
    writeFileSync(yYol, JSON.stringify({ allowManagedHooksOnly: true, disableAllHooks: true }), "utf8");
    assert.deepEqual(kancaDurumu(ortam).kapatan, [
      `yönetilen ayarda disableAllHooks: true (${yYol})`,
      `yönetilen ayarda allowManagedHooksOnly: true (${yYol}; kullanıcı kancaları çalışmaz)`,
    ]);
    writeFileSync(yYol, "{bozuk", "utf8");
    assert.deepEqual(kancaDurumu(ortam).kapatan, [], "okunamayan yönetilen ayar teşhisi durdurmaz");
    assert.equal(kancaDurumu(ortam).arac, true);
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});

test("kanca kaldırma yalnız bizimkini çıkarır; boşalan grup ve olay gider, karışık grupta öteki kalır", () => {
  const baska = { type: "command", command: "echo x" };
  const ayar = kancalariEkle({ hooks: { Stop: [{ hooks: [baska] }] } }, Y);
  // Elle birleştirilmiş grup: bizimki (eski istem kancası) ile başkası aynı grupta.
  (ayar["hooks"] as Record<string, unknown[]>)["UserPromptSubmit"] = [{ hooks: [baska, { type: "command", command: kabukBicimiKomutu(Y, "istem") }] }];
  const { ayar: temiz, cikan } = kancalariCikar(ayar);
  assert.equal(cikan, 2);
  assert.deepEqual(temiz, { hooks: { Stop: [{ hooks: [baska] }], UserPromptSubmit: [{ hooks: [baska] }] } });
  assert.deepEqual(kancalariCikar(kancalariEkle({}, Y)), { ayar: {}, cikan: 1 });
  assert.deepEqual(kancalariCikar({ a: 1 }), { ayar: { a: 1 }, cikan: 0 });
});

test("bozuk ayar dosyasına dokunulmaz", () => {
  assert.deepEqual(ayarCoz(null), {});
  assert.deepEqual(ayarCoz("  "), {});
  assert.throws(() => ayarCoz("{bozuk"), AyarHatasi);
  assert.throws(() => ayarCoz("[1]"), AyarHatasi);
  assert.throws(() => kancalariEkle({ hooks: [] as unknown as Record<string, unknown> }, Y), AyarHatasi);
  assert.throws(() => kancalariEkle({ hooks: { PreToolUse: {} } }, Y), AyarHatasi);
  // Eklemediğimiz olayın tanınmayan biçimi olduğu gibi kalır.
  assert.deepEqual((kancalariEkle({ hooks: { Stop: {} } }, Y)["hooks"] as Record<string, unknown>)["Stop"], {});
});

test("goster hiçbir şey değiştirmez ve tam komutları yazar; kayıt yönergesi aynı metin, adım 0'sız", () => {
  const m = gosterMetni(Y, "C:\\ornek\\Kullanici\\.claude\\settings.json");
  assert.ok(m.includes(mcpEkleKomutu(Y)));
  assert.ok(m.includes("eren eslestir --claude-code\n"));
  assert.ok(m.includes("claude mcp remove eren-ajanda -s user"));
  assert.ok(m.includes(`"command": ${JSON.stringify(NODE)}`));
  assert.ok(m.includes(`${JSON.stringify(Y.kancaBetigi)},`) && m.includes('"args": ['));
  assert.equal(m.includes("|| true"), false, "kabuk biçimi önerilmez");
  assert.equal(/UserPromptSubmit|"Stop"|kanca\.ts\\" (istem|tur_sonu)/.test(m), false, "yalın yolda istem ve tur sonu kancası yok");
  assert.ok(m.includes("eren eslestir --claude-code --teshis"));
  const y = kayitYonergesi(ORTAM, NODE);
  assert.equal(y, gosterMetni(Y, "C:\\ornek\\Kullanici\\.claude\\settings.json", false));
  assert.equal(y.includes("0. Anahtar"), false);
  assert.ok(y.includes(mcpEkleKomutu(Y)));
});

test("komut satırı: kanca-ekle yedekler ve yazar, kanca-kaldir geri alır; bozuk dosyada 1 ve dosya aynı", () => {
  const dizin = mkdtempSync(join(tmpdir(), "eren-claude-code-"));
  try {
    const yol = join(dizin, "settings.json");
    writeFileSync(yol, JSON.stringify({ model: "opus" }), "utf8");
    assert.equal(calis(["kanca-ekle", "--ayar", yol], ORTAM, NODE), 0);
    const eklendi = JSON.parse(readFileSync(yol, "utf8")) as Record<string, unknown>;
    assert.equal(eklendi["model"], "opus");
    assert.deepEqual(Object.keys(eklendi["hooks"] as object), ["PreToolUse"]);
    assert.equal(readdirSync(dizin).filter((d) => d.includes(".yedek-")).length, 1);
    assert.equal(calis(["kanca-kaldir", "--ayar", yol], ORTAM, NODE), 0);
    assert.deepEqual(JSON.parse(readFileSync(yol, "utf8")), { model: "opus" });
    assert.equal(calis(["kanca-kaldir", "--ayar", yol], ORTAM, NODE), 0, "ikinci kaldırma");

    writeFileSync(yol, "{bozuk", "utf8");
    assert.equal(calis(["kanca-ekle", "--ayar", yol], ORTAM, NODE), 1);
    assert.equal(readFileSync(yol, "utf8"), "{bozuk");
    assert.equal(calis(["kanca-ekle", "--ayar", "goreli.json"], ORTAM, NODE), 2);
    assert.equal(calis(["bilinmeyen"], ORTAM, NODE), 2);
    // Yoksa dosya (ve klasör) oluşturulur.
    const yeni = join(dizin, "yok", "settings.json");
    assert.equal(calis(["kanca-ekle", "--ayar", yeni], ORTAM, NODE), 0);
    assert.ok(Object.keys(JSON.parse(readFileSync(yeni, "utf8")) as object).includes("hooks"));
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});

test("yedek hiçbir zaman ezilmez: aynı milisaniyedeki ikinci işlem ayrı yedek alır, ilk yedek özgün içeriği tutar", () => {
  const dizin = mkdtempSync(join(tmpdir(), "eren-claude-code-yedek-"));
  try {
    const yol = join(dizin, "settings.json");
    const ozgun = JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo x" }] }] } });
    writeFileSync(yol, ozgun, "utf8");
    const sabit = () => 1_795_000_000_123;
    assert.equal(calis(["kanca-ekle", "--ayar", yol], ORTAM, NODE, sabit), 0);
    assert.equal(calis(["kanca-kaldir", "--ayar", yol], ORTAM, NODE, sabit), 0);
    assert.equal(calis(["kanca-ekle", "--ayar", yol], ORTAM, NODE, sabit), 0);
    const yedekler = readdirSync(dizin).filter((d) => d.includes(".yedek-")).sort();
    assert.equal(yedekler.length, 3, yedekler.join(","));
    assert.match(yedekler[0]!, /^settings\.json\.yedek-\d{8}T\d{9}Z$/, "milisaniyeli damga");
    assert.equal(readFileSync(join(dizin, yedekler[0]!), "utf8"), ozgun, "ilk yedek özgün içerik");
    assert.deepEqual(yedekler.slice(1), [`${yedekler[0]}-1`, `${yedekler[0]}-2`]);
    assert.equal(readdirSync(dizin).filter((d) => d.includes(".yeni-")).length, 0, "geçici dosya kaldı");
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});

test("BOM'lu ayar okunur ve BOM'lu kalır; UTF-16 ve bozuk JSON doğru nedenle reddedilir, dosya aynı kalır", () => {
  const dizin = mkdtempSync(join(tmpdir(), "eren-claude-code-bom-"));
  const hata = console.error;
  const yazilan: string[] = [];
  console.error = (...a: unknown[]) => void yazilan.push(a.join(" "));
  try {
    const yol = join(dizin, "settings.json");
    writeFileSync(yol, `﻿${JSON.stringify({ model: "opus" })}`, "utf8");
    assert.equal(calis(["kanca-ekle", "--ayar", yol], ORTAM, NODE), 0);
    const metin = readFileSync(yol, "utf8");
    assert.ok(metin.startsWith("﻿"), "BOM kayboldu");
    assert.equal((JSON.parse(metin.slice(1)) as Record<string, unknown>)["model"], "opus");
    assert.equal(calis(["kanca-kaldir", "--ayar", yol], ORTAM, NODE), 0);
    assert.ok(readFileSync(yol, "utf8").startsWith("﻿"));

    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify({ model: "opus" }), "utf16le")]);
    writeFileSync(yol, utf16);
    assert.equal(calis(["kanca-ekle", "--ayar", yol], ORTAM, NODE), 1);
    assert.deepEqual(readFileSync(yol), utf16, "UTF-16 dosya değişti");
    assert.match(yazilan.at(-1) ?? "", /UTF-16/);
    assert.doesNotMatch(yazilan.at(-1) ?? "", /geçerli JSON değil/);

    writeFileSync(yol, '{"a": 1,}', "utf8");
    assert.equal(calis(["kanca-ekle", "--ayar", yol], ORTAM, NODE), 1);
    assert.match(yazilan.at(-1) ?? "", /geçerli JSON değil \(.+\)/, "ayrıştırıcının nedeni yazılır");
    assert.equal(readFileSync(yol, "utf8"), '{"a": 1,}');
  } finally {
    console.error = hata;
    rmSync(dizin, { recursive: true, force: true });
  }
});

test("bağlantılı ayar: junction ve sembolik bağ korunur (yazma hedefe), sabit bağın öteki adı da yeni içeriği görür; kırık bağ reddedilir", (t) => {
  const dizin = mkdtempSync(join(tmpdir(), "eren-claude-code-bag-"));
  try {
    const ozgun = JSON.stringify({ model: "opus" });
    // Junction: ~/.claude bir klasör bağlantısı (ör. dotfiles deposu).
    const gercekKlasor = join(dizin, "dotfiles");
    mkdirSync(gercekKlasor);
    writeFileSync(join(gercekKlasor, "settings.json"), ozgun, "utf8");
    const bag = join(dizin, "claude-bag");
    symlinkSync(gercekKlasor, bag, "junction");
    assert.equal(calis(["kanca-ekle", "--ayar", join(bag, "settings.json")], ORTAM, NODE), 0);
    assert.ok(lstatSync(bag).isSymbolicLink(), "junction düz klasöre döndü");
    assert.ok(Object.keys(JSON.parse(readFileSync(join(gercekKlasor, "settings.json"), "utf8")) as object).includes("hooks"));

    // Sabit bağ: iki ad aynı dosya; yerinde yazılır, ikisi de yeni içeriği görür.
    const sabitA = join(dizin, "a.json");
    const sabitB = join(dizin, "b.json");
    writeFileSync(sabitA, ozgun, "utf8");
    linkSync(sabitA, sabitB);
    assert.equal(calis(["kanca-ekle", "--ayar", sabitA], ORTAM, NODE), 0);
    assert.equal(readFileSync(sabitB, "utf8"), readFileSync(sabitA, "utf8"));
    assert.equal(statSync(sabitA).nlink, 2, "sabit bağ ayrıldı");

    // Dosya sembolik bağı (Windows'ta geliştirici kipi ya da yetki ister; yoksa bu parça atlanır).
    const hedef = join(gercekKlasor, "hedef.json");
    writeFileSync(hedef, ozgun, "utf8");
    const dosyaBagi = join(dizin, "settings.json");
    try {
      symlinkSync(hedef, dosyaBagi, "file");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EPERM") {
        t.diagnostic("dosya sembolik bağı oluşturulamadı (EPERM); o parça atlandı");
        return;
      }
      throw e;
    }
    assert.equal(calis(["kanca-ekle", "--ayar", dosyaBagi], ORTAM, NODE), 0);
    assert.ok(lstatSync(dosyaBagi).isSymbolicLink(), "sembolik bağ düz dosyaya döndü");
    assert.ok(Object.keys(JSON.parse(readFileSync(hedef, "utf8")) as object).includes("hooks"), "hedef güncellenmedi");
    const yedek = readdirSync(dizin).find((d) => d.startsWith("settings.json.yedek-"));
    assert.ok(yedek !== undefined, "yedek bağın yanında değil");
    assert.equal(readFileSync(join(dizin, yedek), "utf8"), ozgun);
    // Kırık bağ: hedef silinince dosya yok sayılıp bağın üstüne yazılmaz.
    rmSync(hedef);
    assert.equal(calis(["kanca-ekle", "--ayar", dosyaBagi], ORTAM, NODE), 1);
    assert.ok(lstatSync(dosyaBagi).isSymbolicLink());
    assert.equal(existsSync(hedef), false);
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});
