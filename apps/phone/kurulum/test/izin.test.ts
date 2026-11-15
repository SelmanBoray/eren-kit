/**
 * Veri kökünün erişim izni (izin.ts, denetim bulgusu B1): kökü oluşturma, denetleme, eren-kit kökünü
 * daraltma ve daraltmayı reddetme dalları. Karar testleri sahte bağlarla; gerçek izin denemeleri yalnız
 * os.tmpdir() altındaki geçici klasörlerde (Windows). Gerçek veri köküne ve %LOCALAPPDATA%'ya dokunmaz.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { IZIN_DUZELT_KOMUTU, IzinHatasi, gercekIzinBaglari, veriKokuIzniniSagla } from "../izin.ts";
import type { IzinBaglari } from "../izin.ts";

const BEN = "S-1-5-21-1111111111-2222222222-3333333333-1001";
const GUVENLI = `O:${BEN}D:PAI(A;OICI;FA;;;${BEN})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`;
const ACIK = `O:${BEN}D:AI(A;OICIID;FA;;;${BEN})(A;OICIID;FA;;;SY)(A;OICIID;0x1301bf;;;AU)`;

const sahte = (o: {
  ilk: string | null;
  olustu?: boolean;
  son?: string | null;
  varOlanlar?: readonly string[];
  bos?: boolean;
}) => {
  const kipler: string[] = [];
  const yazilanlar: string[] = [];
  const cikti = (sddl: string, olustu: boolean) => JSON.stringify({ sid: BEN, sddl, olustu, duzeltildi: false });
  const b: IzinBaglari = {
    calistir: (betik) => {
      const kip = /\$kip='(\w+)'/.exec(betik)?.[1] ?? "?";
      kipler.push(kip);
      if (kip === "hazirla") return o.ilk === null ? null : cikti(o.ilk, o.olustu ?? false);
      return o.son === null || o.son === undefined ? null : cikti(o.son, false);
    },
    varMi: (y) => (o.varOlanlar ?? []).some((v) => y.toLowerCase().endsWith(v.toLowerCase())),
    bosMu: () => o.bos ?? false,
    yaz: (s) => yazilanlar.push(s),
  };
  return { b, kipler, yazilanlar };
};

describe("veriKokuIzniniSagla (sahte bağlar)", () => {
  test("yeni oluşturulan kök: daraltma gerekmez, bilgi yazılır", () => {
    const s = sahte({ ilk: GUVENLI, olustu: true });
    assert.equal(veriKokuIzniniSagla("C:\\veri\\eren", s.b), "olusturuldu");
    assert.deepEqual(s.kipler, ["hazirla"]);
    assert.match(s.yazilanlar[0] ?? "", /oluşturuldu/);
  });

  test("zaten güvenli kök: dokunulmaz, sessiz", () => {
    const s = sahte({ ilk: GUVENLI });
    assert.equal(veriKokuIzniniSagla("C:\\veri\\eren", s.b), "guvenli");
    assert.deepEqual(s.kipler, ["hazirla"]);
    assert.deepEqual(s.yazilanlar, []);
  });

  test("başka hesaplara açık eren-kit kökü (uygulama ya da eren.db var) daraltılır, uyarı yazılır", () => {
    for (const isaret of ["\\uygulama", "\\eren.db"]) {
      const s = sahte({ ilk: ACIK, son: GUVENLI, varOlanlar: [isaret] });
      assert.equal(veriKokuIzniniSagla("C:\\eren-veri", s.b), "daraltildi");
      assert.deepEqual(s.kipler, ["hazirla", "duzelt"]);
      assert.match(s.yazilanlar[0] ?? "", /^UYARI: veri kökü başka hesaplara açıktı \(S-1-5-11 erişebiliyor \(üst klasörden kalıtım\)\)/);
      assert.match(s.yazilanlar[0] ?? "", /yeniden eşleştirin/);
    }
  });

  test("boş kök de eren-kit'in sayılır ve daraltılır", () => {
    const s = sahte({ ilk: ACIK, son: GUVENLI, bos: true });
    assert.equal(veriKokuIzniniSagla("C:\\eren-veri", s.b), "daraltildi");
  });

  test("eren-kit'e ait görünmeyen dolu kök daraltılmaz; --izin-duzelt (bilerek) daraltır", () => {
    const s = sahte({ ilk: ACIK, son: GUVENLI });
    assert.throws(() => veriKokuIzniniSagla("C:\\Belgeler", s.b), (e: unknown) => {
      assert.ok(e instanceof IzinHatasi);
      assert.match(e.message, /eren-kit'e ait görünmüyor/);
      assert.ok(e.message.includes(IZIN_DUZELT_KOMUTU));
      return true;
    });
    assert.deepEqual(s.kipler, ["hazirla"], "daraltma denenmemeli");
    assert.equal(veriKokuIzniniSagla("C:\\Belgeler", s.b, { bilerek: true }), "daraltildi");
  });

  test("sürücü kökü bilerek bile daraltılmaz", () => {
    for (const kok of ["D:\\", "d:/", "\\\\sunucu\\pay\\"]) {
      const s = sahte({ ilk: ACIK, son: GUVENLI, bos: true });
      assert.throws(() => veriKokuIzniniSagla(kok, s.b, { bilerek: true }), /sürücü kökü/, kok);
      assert.deepEqual(s.kipler, ["hazirla"]);
    }
  });

  test("izinler okunamazsa ya da daraltma sonrası hâlâ açıksa durur", () => {
    assert.throws(() => veriKokuIzniniSagla("C:\\v", sahte({ ilk: null }).b), /okunamadı/);
    const kalan = sahte({ ilk: ACIK, son: ACIK, bos: true });
    assert.throws(() => veriKokuIzniniSagla("C:\\v", kalan.b), /daraltılamadı \(S-1-5-11/);
    const basarisiz = sahte({ ilk: ACIK, son: null, bos: true });
    assert.throws(() => veriKokuIzniniSagla("C:\\v", basarisiz.b), /daraltılamadı \(izinler değiştirilemedi\)/);
  });
});

describe("veriKokuIzniniSagla (gerçek, geçici klasör)", { skip: process.platform !== "win32" }, () => {
  let taban = "";
  before(() => {
    taban = fs.mkdtempSync(path.join(os.tmpdir(), "eren-kurulum-izin-"));
  });
  after(() => fs.rmSync(taban, { recursive: true, force: true }));

  const sessiz = (): IzinBaglari => ({ ...gercekIzinBaglari(), yaz: () => {} });
  const icacls = (...arg: string[]) => spawnSync("icacls", arg, { encoding: "utf8", windowsHide: true });
  /** Users (S-1-5-32-545) okuma izni: "başka hesap" yerine geçer. */
  const disariAc = (yol: string) => assert.equal(icacls(yol, "/grant", "*S-1-5-32-545:(OI)(CI)(RX)").status, 0);
  /** SDDL'de Users (takma adı BU) için ACE var mı; icacls çıktısı yerelleştirildiği için SDDL okunur. */
  const usersVarMi = (yol: string): boolean => {
    const b64 = Buffer.from(yol, "utf16le").toString("base64");
    const sddl = gercekIzinBaglari().calistir(
      `(Get-Acl -LiteralPath ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))).Sddl`,
    );
    assert.ok(sddl !== null, "SDDL okunamadı");
    return /;(?:BU|S-1-5-32-545)\)/.test(sddl);
  };

  test("olmayan kök oluşturulur; ikinci çağrı güvenli", () => {
    const kok = path.join(taban, "yeni", "veri");
    assert.equal(veriKokuIzniniSagla(kok, sessiz()), "olusturuldu");
    assert.equal(veriKokuIzniniSagla(kok, sessiz()), "guvenli");
  });

  test("eren-kit kökü daraltılır; içerideki dosyaların kalıtılan izni de daralır", () => {
    const kok = path.join(taban, "acik");
    fs.mkdirSync(path.join(kok, "uygulama", "guncel"), { recursive: true });
    fs.writeFileSync(path.join(kok, "sunucu-anahtar.pem"), "sir");
    fs.writeFileSync(path.join(kok, "uygulama", "guncel", "ana.ts"), "kod");
    disariAc(kok);
    assert.ok(usersVarMi(path.join(kok, "sunucu-anahtar.pem")), "deneme kurulumu: dosya Users'a açık olmalı");
    assert.equal(veriKokuIzniniSagla(kok, sessiz()), "daraltildi");
    assert.equal(veriKokuIzniniSagla(kok, sessiz()), "guvenli");
    for (const dosya of ["sunucu-anahtar.pem", path.join("uygulama", "guncel", "ana.ts")]) {
      assert.ok(!usersVarMi(path.join(kok, dosya)), `${dosya} hâlâ Users'a açık`);
      assert.equal(fs.readFileSync(path.join(kok, dosya), "utf8").length > 0, true, "kullanıcı okuyabilmeli");
    }
  });

  test("PowerShell 7'den devralınan PSModulePath ile de oluşturur ve daraltır", (t) => {
    const r = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$env:PSModulePath"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    const ps7 = r.status === 0 ? r.stdout.trim() : "";
    if (ps7 === "") {
      t.skip("pwsh 7 yok");
      return;
    }
    const b: IzinBaglari = { ...gercekIzinBaglari({ ...process.env, PSModulePath: ps7 }), yaz: () => {} };
    assert.equal(veriKokuIzniniSagla(path.join(taban, "ps7", "veri"), b), "olusturuldu");
    const kok = path.join(taban, "ps7-acik");
    fs.mkdirSync(path.join(kok, "uygulama"), { recursive: true });
    disariAc(kok);
    assert.equal(veriKokuIzniniSagla(kok, b), "daraltildi");
    assert.ok(!usersVarMi(kok));
  });

  test("eren-kit'e ait görünmeyen dolu kök dokunulmadan reddedilir", () => {
    const kok = path.join(taban, "baska");
    fs.mkdirSync(kok);
    fs.writeFileSync(path.join(kok, "not.txt"), "x");
    disariAc(kok);
    assert.throws(() => veriKokuIzniniSagla(kok, sessiz()), IzinHatasi);
    assert.ok(usersVarMi(kok), "reddedilen köke dokunulmamalı");
  });
});
