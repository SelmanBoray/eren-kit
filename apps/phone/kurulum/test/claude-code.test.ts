import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  kancaKomutu,
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

test("kanca komutu tırnaklı ve ileri eğik çizgili; kendi kancamız (yeni ve eski biçim) tanınır, başkası tanınmaz", () => {
  const k = kancaKomutu(Y, "istem");
  assert.equal(k, '"C:/Program Files/nodejs/node.exe" --disable-warning=ExperimentalWarning "C:/ornek/Yerel/eren-kit/uygulama/guncel/server/src/kanca.ts" istem || true');
  assert.equal(bizimKancaMi(k), true);
  assert.equal(bizimKancaMi(kancaKomutu(Y, "tur_sonu")), true);
  // Önceki biçim (köprünün `--kanca`'sı, sürüm dizinli yol): kanca-ekle onu yenisiyle değiştirir.
  const eski = '"C:/x/node.exe" --disable-warning=ExperimentalWarning "C:/ornek/Yerel/eren-kit/uygulama/surumler/abc/server/src/kopru.ts" --kanca arac || true';
  assert.equal(bizimKancaMi(eski), true);
  const temiz = kancalariEkle({ hooks: { PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [{ type: "command", command: eski }] }] } }, Y);
  assert.deepEqual((temiz["hooks"] as Record<string, unknown>)["PreToolUse"], [{ matcher: ARAC_ESLESTIRICI, hooks: [{ type: "command", command: kancaKomutu(Y, "arac"), timeout: 10 }] }]);
  assert.equal(bizimKancaMi('python -I "C:/x/hook.py" || true'), false);
  assert.equal(bizimKancaMi('node "C:/baska/kanca.ts" istem'), false);
  assert.equal(bizimKancaMi("node kopru.ts --rol eren"), false);
  assert.equal(bizimKancaMi(undefined), false);
  assert.match(mcpEkleKomutu(Y), /^claude mcp add eren-ajanda -s user -- 'C:\\Program Files\\nodejs\\node\.exe' --disable-warning=ExperimentalWarning C:\\ornek\\Yerel\\eren-kit\\uygulama\\guncel\\server\\src\\kopru\.ts --rol pc_oturumu$/);
});

test("yalın yol: tek kanca, yalnız ajanda araçlarından önce (PreToolUse, eşleyici mcp__eren-ajanda__.*); istem ve tur sonu yok", () => {
  assert.deepEqual(KANCA_OLAYLARI, { PreToolUse: "arac" });
  assert.deepEqual(kancaGruplari(Y), {
    PreToolUse: { matcher: "mcp__eren-ajanda__.*", hooks: [{ type: "command", command: kancaKomutu(Y, "arac"), timeout: 10 }] },
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
  assert.deepEqual(h["PreToolUse"], [{ matcher: ARAC_ESLESTIRICI, hooks: [{ type: "command", command: kancaKomutu(Y, "arac"), timeout: 10 }] }]);
  assert.equal(h["Stop"], undefined);
  assert.deepEqual(kancalariEkle(bir, Y), bir, "ikinci ekleme aynı");
  const yeniY = yollar({ ...ORTAM, EREN_KIT_DATA_DIR: "D:\\veri" }, NODE);
  const yeni = kancalariEkle(bir, yeniY)["hooks"] as Record<string, Array<Record<string, Array<Record<string, unknown>>>>>;
  assert.equal(yeni["PreToolUse"]!.length, 1);
  assert.equal(yeni["PreToolUse"]![0]!["hooks"]![0]!["command"], kancaKomutu(yeniY, "arac"));
});

test("önceki kurulumdan geçiş: kanca-ekle eski istem ve tur sonu kancalarını çıkarır, yalnız araç öncesini bırakır", () => {
  const baska = { type: "command", command: "echo x" };
  const onceki = {
    hooks: {
      UserPromptSubmit: [{ hooks: [baska] }, { hooks: [{ type: "command", command: kancaKomutu(Y, "istem"), timeout: 10 }] }],
      PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [{ type: "command", command: kancaKomutu(Y, "arac"), timeout: 10 }] }],
      Stop: [{ hooks: [{ type: "command", command: kancaKomutu(Y, "tur_sonu"), timeout: 10 }] }],
    },
  };
  assert.deepEqual(kancaDurumuCoz(onceki), { arac: true, eski: 2 });
  const yeni = kancalariEkle(onceki, Y);
  assert.deepEqual(yeni, {
    hooks: {
      UserPromptSubmit: [{ hooks: [baska] }],
      PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [{ type: "command", command: kancaKomutu(Y, "arac"), timeout: 10 }] }],
    },
  });
  assert.deepEqual(kancaDurumuCoz(yeni), { arac: true, eski: 0 });
});

test("kanca durumu: yok, kurulu, eşleyicisiz ya da yanlış olaydaki araç kancası eski sayılır; dosya yoksa ve bozuksa", () => {
  assert.deepEqual(kancaDurumuCoz({}), { arac: false, eski: 0 });
  assert.deepEqual(kancaDurumuCoz(kancalariEkle({}, Y)), { arac: true, eski: 0 });
  const komut = { type: "command", command: kancaKomutu(Y, "arac") };
  assert.deepEqual(kancaDurumuCoz({ hooks: { PreToolUse: [{ hooks: [komut] }] } }), { arac: false, eski: 1 }, "eşleyicisiz: her araçta çalışır");
  assert.deepEqual(kancaDurumuCoz({ hooks: { PostToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [komut] }] } }), { arac: false, eski: 1 });
  assert.deepEqual(kancaDurumuCoz({ hooks: { PreToolUse: [{ matcher: ARAC_ESLESTIRICI, hooks: [{ type: "command", command: "echo x" }] }] } }), { arac: false, eski: 0 });
  const dizin = mkdtempSync(join(tmpdir(), "eren-claude-code-durum-"));
  try {
    const ortam = { ...ORTAM, USERPROFILE: dizin };
    const yol = join(dizin, ".claude", "settings.json");
    assert.deepEqual(kancaDurumu(ortam), { ayarYolu: yol, arac: false, eski: 0 });
    assert.equal(calis(["kanca-ekle"], ortam, NODE), 0);
    assert.deepEqual(kancaDurumu(ortam), { ayarYolu: yol, arac: true, eski: 0 });
    writeFileSync(yol, "{bozuk", "utf8");
    assert.deepEqual(kancaDurumu(ortam), { ayarYolu: yol, arac: null, eski: 0 });
    assert.equal(kancaDurumu({ LOCALAPPDATA: ORTAM.LOCALAPPDATA }).arac, null, "USERPROFILE yok: atmaz");
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
});

test("kanca kaldırma yalnız bizimkini çıkarır; boşalan grup ve olay gider, karışık grupta öteki kalır", () => {
  const baska = { type: "command", command: "echo x" };
  const ayar = kancalariEkle({ hooks: { Stop: [{ hooks: [baska] }] } }, Y);
  // Elle birleştirilmiş grup: bizimki (eski istem kancası) ile başkası aynı grupta.
  (ayar["hooks"] as Record<string, unknown[]>)["UserPromptSubmit"] = [{ hooks: [baska, { type: "command", command: kancaKomutu(Y, "istem") }] }];
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
  assert.ok(m.includes(JSON.stringify(kancaKomutu(Y, "arac")).slice(1, -1)));
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
