/**
 * Veri kökü izni (denetim bulgusu B1): kural (`kok-izni.ts`), servisin açılış denetimi
 * (`dis-dunya.ts` `veriKokuIzniHazirla`) ve `ana.ts`'in güvensiz kökle açılmayı reddetmesi.
 * Gerçek izin denemeleri yalnız `os.tmpdir()` altındaki geçici klasörlerde yapılır.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { veriKokuIzniHazirla } from "../src/dis-dunya.ts";
import {
  IZIN_DUZELT_KOMUTU,
  izinBetigi,
  izinCiktisiCoz,
  kokIzniHataMetni,
  korumaliSddl,
  posixKokIzniDegerlendir,
  sddlCoz,
  SID,
  sorunMetni,
  windowsKokIzniDegerlendir,
  windowsPowerShellOrtami,
} from "../src/kok-izni.ts";

const win = process.platform === "win32";

/**
 * PowerShell 7 oturumunun `PSModulePath`'i (PS7 kuruluysa). Node pwsh 7'den başlatılınca bu değeri
 * devralır; Windows PowerShell 5.1 alt süreci onu aynen kullanırsa PS7'nin Security modülünü yüklemeye
 * çalışır ve `Get-Acl`/`Set-Acl` düşer. Testler bu değeri bilerek vererek o üst kabuğu taklit eder.
 */
const ps7ModulYolu = ((): string | null => {
  if (!win) return null;
  const r = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$env:PSModulePath"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  const v = r.status === 0 ? r.stdout.trim() : "";
  return v === "" ? null : v;
})();

/** `PSModulePath`'i geçici olarak değiştirip `f`'i çalıştırır. */
async function modulYoluyla<T>(deger: string, f: () => Promise<T>): Promise<T> {
  const anahtar = Object.keys(process.env).find((k) => k.toUpperCase() === "PSMODULEPATH") ?? "PSModulePath";
  const eski = process.env[anahtar];
  process.env[anahtar] = deger;
  try {
    return await f();
  } finally {
    if (eski === undefined) delete process.env[anahtar];
    else process.env[anahtar] = eski;
  }
}
const BEN = "S-1-5-21-1111111111-2222222222-3333333333-1001";
const BASKA = "S-1-5-21-1111111111-2222222222-3333333333-1002";
const GRUP = "S-1-5-21-1111111111-2222222222-3333333333-513";

describe("kok-izni: SDDL çözümü", () => {
  it("sahip, DACL bayrakları ve ACE'ler; takma adlar açılır", () => {
    const c = sddlCoz(`O:${BEN}G:${GRUP}D:PAI(A;OICI;FA;;;SY)(A;OICIID;0x1200a9;;;BU)(D;;FA;;;${BASKA})`);
    assert.ok(c);
    assert.equal(c.sahip, BEN);
    assert.equal(c.dacl?.bayraklar, "PAI");
    assert.deepEqual(
      c.dacl?.aceler.map((a) => [a.tur, a.bayraklar, a.sid]),
      [
        ["A", "OICI", SID.SYSTEM],
        ["A", "OICIID", "S-1-5-32-545"],
        ["D", "", BASKA],
      ],
    );
  });

  it("takma adlı sahip, DACL'siz tanım, SACL bölümü", () => {
    assert.equal(sddlCoz("O:BAG:SYD:(A;;FA;;;BA)")?.sahip, SID.ADMINISTRATORS);
    assert.equal(sddlCoz(`O:${BEN}G:${GRUP}`)?.dacl, null);
    assert.equal(sddlCoz(`O:${BEN}D:P(A;;FA;;;SY)S:AI(AU;SA;FA;;;WD)`)?.dacl?.aceler.length, 1);
  });

  it("koşullu ACE (iç içe parantez) okunur", () => {
    const c = sddlCoz(`O:${BEN}D:(XA;;FA;;;WD;(Member_of {SID(BA)}))(A;;FA;;;SY)`);
    assert.deepEqual(c?.dacl?.aceler.map((a) => a.sid), ["S-1-1-0", SID.SYSTEM]);
  });

  it("bozuk tanım null", () => {
    for (const bozuk of ["X:Y", `O:${BEN}D:(A;;FA;;;SY`, `O:${BEN}D:(A;;FA)`, `O:${BEN}D:ZZ(A;;FA;;;SY)`, "O:!!"]) {
      assert.equal(sddlCoz(bozuk), null, bozuk);
    }
    assert.deepEqual(sddlCoz(""), { sahip: null, dacl: null });
  });
});

describe("kok-izni: Windows kuralı", () => {
  const degerlendir = (sddl: string) => windowsKokIzniDegerlendir(sddl, BEN);

  it("korumalı tanım güvenli; profil klasörünün olağan tanımı güvenli", () => {
    assert.deepEqual(degerlendir(korumaliSddl(BEN)), { guvenli: true });
    assert.deepEqual(
      degerlendir(`O:${BEN}G:${GRUP}D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${BEN})`),
      { guvenli: true },
    );
    // CREATOR OWNER ve OWNER RIGHTS izinlidir; reddeden ACE zararsızdır.
    assert.deepEqual(degerlendir(`O:${BEN}D:P(A;OICIIO;FA;;;CO)(A;;FA;;;OW)(A;;FA;;;${BEN})(D;;FA;;;WD)`), { guvenli: true });
  });

  it("sürücü kökünden kalıtılan Authenticated Users ve Users güvensiz (kalıtım işaretli)", () => {
    const s = degerlendir(`O:${BEN}D:AI(A;OICIID;FA;;;BA)(A;OICIID;FA;;;SY)(A;OICIID;0x1200a9;;;BU)(A;OICIID;0x1301bf;;;AU)(A;ID;FA;;;${BEN})`);
    assert.equal(s.guvenli, false);
    assert.deepEqual(!s.guvenli && s.sorunlar, [
      { tur: "erisim", kimlik: "S-1-5-32-545", kalitimla: true },
      { tur: "erisim", kimlik: "S-1-5-11", kalitimla: true },
    ]);
  });

  it("yalnız okuma izni olan başka hesap da güvensiz (sırlar okunur); aynı SID bir kez sayılır", () => {
    const s = degerlendir(`O:${BEN}D:P(A;OICI;0x1200a9;;;${BASKA})(A;;FR;;;${BASKA})(A;OICI;FA;;;${BEN})`);
    assert.deepEqual(!s.guvenli && s.sorunlar, [{ tur: "erisim", kimlik: BASKA, kalitimla: false }]);
  });

  it("CREATOR GROUP, Everyone ve bilinmeyen ACE türü güvensiz", () => {
    for (const ace of ["(A;OICIIO;FA;;;CG)", "(A;;FA;;;WD)", "(ZZ;;FA;;;WD)"]) {
      assert.equal(degerlendir(`O:${BEN}D:P${ace}(A;;FA;;;${BEN})`).guvenli, false, ace);
    }
  });

  it("sahibi başka hesap güvensiz; SYSTEM ve Administrators sahipliği kabul", () => {
    const s = degerlendir(`O:${BASKA}D:P(A;OICI;FA;;;${BEN})`);
    assert.deepEqual(!s.guvenli && s.sorunlar, [{ tur: "sahip", kimlik: BASKA }]);
    assert.equal(degerlendir(`O:SYD:P(A;OICI;FA;;;${BEN})`).guvenli, true);
    assert.equal(degerlendir(`O:BAD:P(A;OICI;FA;;;${BEN})`).guvenli, true);
  });

  it("DACL yok ya da NO_ACCESS_CONTROL güvensiz; çözülemeyen tanım ve geçersiz kullanıcı SID'i güvensiz", () => {
    assert.deepEqual(degerlendir(`O:${BEN}G:${GRUP}`), { guvenli: false, sorunlar: [{ tur: "dacl_yok" }] });
    assert.deepEqual(degerlendir(`O:${BEN}D:NO_ACCESS_CONTROL`), { guvenli: false, sorunlar: [{ tur: "dacl_yok" }] });
    assert.deepEqual(degerlendir("bozuk"), { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] });
    assert.deepEqual(windowsKokIzniDegerlendir(korumaliSddl(BEN), "SY"), { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] });
    assert.deepEqual(degerlendir(`D:P(A;;FA;;;${BEN})`), { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] });
  });

  it("ileti yol taşımaz, düzeltme komutunu söyler", () => {
    const m = kokIzniHataMetni([{ tur: "erisim", kimlik: "S-1-5-11", kalitimla: true }, { tur: "sahip", kimlik: BASKA }]);
    assert.match(m, /^veri kökü başka hesaplara açık: S-1-5-11 erişebiliyor \(üst klasörden kalıtım\); sahibi başka bir hesap/);
    assert.ok(m.includes(IZIN_DUZELT_KOMUTU));
    assert.equal(sorunMetni({ tur: "kip", kip: "755" }), "kip 755 (grup ya da başkaları erişebilir)");
  });
});

describe("kok-izni: POSIX kuralı", () => {
  it("0700 ve kullanıcının sahipliği güvenli; grup/başkaları biti ya da başka sahip güvensiz", () => {
    assert.deepEqual(posixKokIzniDegerlendir({ uid: 501, kip: 0o40700, kullaniciUid: 501 }), { guvenli: true });
    assert.deepEqual(posixKokIzniDegerlendir({ uid: 501, kip: 0o40755, kullaniciUid: 501 }), {
      guvenli: false,
      sorunlar: [{ tur: "kip", kip: "755" }],
    });
    assert.deepEqual(posixKokIzniDegerlendir({ uid: 502, kip: 0o40710, kullaniciUid: 501 }), {
      guvenli: false,
      sorunlar: [
        { tur: "sahip", kimlik: "uid 502" },
        { tur: "kip", kip: "710" },
      ],
    });
  });
});

describe("kok-izni: PowerShell betiği ve çıktısı", () => {
  it("yol betiğe yalnız base64 olarak girer (tırnak ve $ kaçmaz)", () => {
    const yol = "C:\\a'b $(Remove-Item x)\\`c";
    const b = izinBetigi(yol, "hazirla");
    assert.ok(!b.includes("a'b"));
    assert.ok(!b.includes("Remove-Item"));
    assert.ok(b.includes(Buffer.from(yol, "utf16le").toString("base64")));
    assert.ok(b.includes("$kip='hazirla'"));
  });

  it("betik ACL'yi cmdlet'le değil .NET'le okur (Security modülüne bağlı değil)", () => {
    for (const kip of ["oku", "hazirla", "duzelt"] as const) {
      const b = izinBetigi("C:\\k", kip);
      assert.ok(!/\b(?:Get|Set)-Acl\b/.test(b), kip);
    }
  });

  it("alt süreç ortamından PSModulePath (her yazımla) ve tanımsız değerler çıkar, gerisi aynen kalır", () => {
    assert.deepEqual(
      windowsPowerShellOrtami({ PSModulePath: "C:\\ps7", psmodulepath: "x", Path: "C:\\bin", SystemRoot: "C:\\W", BOS: undefined }),
      { Path: "C:\\bin", SystemRoot: "C:\\W" },
    );
  });

  it("çıktı: son JSON satırı okunur; bozuk çıktı null", () => {
    assert.deepEqual(izinCiktisiCoz(`\uFEFFuyarı\n{"sid":"${BEN}","sddl":"O:SY","olustu":true,"duzeltildi":false}\r\n`), {
      sid: BEN,
      sddl: "O:SY",
      olustu: true,
      duzeltildi: false,
    });
    assert.equal(izinCiktisiCoz(""), null);
    assert.equal(izinCiktisiCoz('{"sid":1}'), null);
  });
});

describe("veriKokuIzniHazirla (sahte PowerShell)", () => {
  it("Windows: hazırla kipinde betik çalışır, sonuç kuralla değerlendirilir", async () => {
    const betikler: string[] = [];
    const sonuc = await veriKokuIzniHazirla("C:\\kok", {
      platform: "win32",
      powershell: async (b) => {
        betikler.push(b);
        return JSON.stringify({ sid: BEN, sddl: `O:${BEN}D:AI(A;OICIID;FA;;;${BEN})(A;OICIID;0x1200a9;;;BU)`, olustu: false, duzeltildi: false });
      },
    });
    assert.equal(betikler.length, 1);
    assert.ok(betikler[0]!.includes("$kip='hazirla'"));
    assert.deepEqual(sonuc, { guvenli: false, sorunlar: [{ tur: "erisim", kimlik: "S-1-5-32-545", kalitimla: true }] });
  });

  it("PowerShell atarsa ya da çıktı bozuksa güvensiz (kapalı başarısızlık), atmaz", async () => {
    const atan = await veriKokuIzniHazirla("C:\\kok", { platform: "win32", powershell: async () => Promise.reject(new Error("x")) });
    assert.deepEqual(atan, { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] });
    const bozuk = await veriKokuIzniHazirla("C:\\kok", { platform: "win32", powershell: async () => "ne" });
    assert.deepEqual(bozuk, { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] });
  });
});

describe("veriKokuIzniHazirla (gerçek, geçici klasör)", { skip: !win }, () => {
  let taban = "";
  before(() => {
    taban = mkdtempSync(join(tmpdir(), "eren-kok-izni-"));
  });
  after(() => rmSync(taban, { recursive: true, force: true }));

  it("olmayan kök yalnız kullanıcıya açık oluşturulur (kalıtım kesik), sonra yine güvenli okunur", async () => {
    const kok = join(taban, "yeni", "veri");
    assert.deepEqual(await veriKokuIzniHazirla(kok), { guvenli: true });
    assert.ok(existsSync(kok));
    assert.deepEqual(await veriKokuIzniHazirla(kok), { guvenli: true });
    // Alt dosya kökten kalıtır: yalnız üç kimlik.
    writeFileSync(join(kok, "sir.txt"), "x");
    const r = spawnSync("icacls", [join(kok, "sir.txt")], { encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.split(/\r?\n/).filter((s) => s.includes("(I)")).length, 3, r.stdout);
  });

  it("başka hesaba açık var olan köke dokunmaz, güvensiz der", async () => {
    const kok = join(taban, "acik");
    mkdirSync(kok);
    const g = spawnSync("icacls", [kok, "/grant", "*S-1-5-32-545:(OI)(CI)(RX)"], { windowsHide: true });
    assert.equal(g.status, 0);
    const s = await veriKokuIzniHazirla(kok);
    assert.equal(s.guvenli, false);
    assert.ok(!s.guvenli && s.sorunlar.some((x) => x.tur === "erisim" && x.kimlik === "S-1-5-32-545" && !x.kalitimla));
    assert.equal((await veriKokuIzniHazirla(kok)).guvenli, false, "servis kökü kendisi daraltmaz");
  });

  it("PowerShell 7'den devralınan PSModulePath ile de aynı sonuç (okunamadı değil)", { skip: ps7ModulYolu === null ? "pwsh 7 yok" : false }, async (t) => {
    const yol = ps7ModulYolu!;
    // Hatanın bu makinede gerçekten oluştuğunu göster (bilgi; PS7 sürümüne göre değişebilir).
    const ham = spawnSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Get-Acl -LiteralPath $env:SystemRoot | Out-Null"],
      { encoding: "utf8", windowsHide: true, env: { ...process.env, PSModulePath: yol } },
    );
    t.diagnostic(`ham Get-Acl PS7 PSModulePath ile: çıkış ${ham.status}`);
    const yeni = join(taban, "ps7", "veri");
    assert.deepEqual(await modulYoluyla(yol, () => veriKokuIzniHazirla(yeni)), { guvenli: true });
    const acik = join(taban, "ps7-acik");
    mkdirSync(acik);
    assert.equal(spawnSync("icacls", [acik, "/grant", "*S-1-5-32-545:(OI)(CI)(RX)"], { windowsHide: true }).status, 0);
    const s = await modulYoluyla(yol, () => veriKokuIzniHazirla(acik));
    assert.ok(!s.guvenli && s.sorunlar.some((x) => x.tur === "erisim" && x.kimlik === "S-1-5-32-545"), JSON.stringify(s));
  });
});

describe("ana.ts: başka hesaba açık kökle açılmaz", { skip: !win }, () => {
  let taban = "";
  before(() => {
    taban = mkdtempSync(join(tmpdir(), "eren-kok-ana-"));
  });
  after(() => rmSync(taban, { recursive: true, force: true }));

  it("çıkış kodu 1, günlükte ayar hatası; anahtar ve veritabanı oluşmaz", async () => {
    const kok = join(taban, "veri");
    mkdirSync(kok);
    // claude_exe denetimi geçsin diye var olan bir .exe (node); servis buna hiç ulaşmamalı.
    writeFileSync(join(kok, "ayar.local.json"), JSON.stringify({ claude_exe: process.execPath }));
    assert.equal(spawnSync("icacls", [kok, "/grant", "*S-1-5-32-545:(OI)(CI)(RX)"], { windowsHide: true }).status, 0);
    const ana = fileURLToPath(new URL("../src/ana.ts", import.meta.url));
    const ortam = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "EREN_KIT_DATA_DIR" && k.toUpperCase() !== "PSMODULEPATH"),
    );
    const cocuk = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", ana], {
      // PS7 varsa servis PowerShell 7 oturumundan başlatılmış gibi: devralınan PSModulePath ile.
      env: { ...ortam, LOCALAPPDATA: taban, EREN_KIT_DATA_DIR: kok, ...(ps7ModulYolu === null ? {} : { PSModulePath: ps7ModulYolu }) },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let hata = "";
    cocuk.stderr.on("data", (p: Buffer) => (hata += p.toString("utf8")));
    const kod = await new Promise<number | null>((coz) => {
      const t = setTimeout(() => {
        cocuk.kill();
        coz(null);
      }, 60_000);
      cocuk.once("exit", (k) => {
        clearTimeout(t);
        coz(k);
      });
    });
    assert.equal(kod, 1, hata);
    const gunluk = readFileSync(join(kok, "logs", "servis.log"), "utf8");
    assert.match(gunluk, /"olay":"baslatma_hatasi"/);
    assert.match(gunluk, /veri kökü başka hesaplara açık: S-1-5-32-545 erişebiliyor/);
    assert.ok(!gunluk.includes(kok.replaceAll("\\", "\\\\")), "günlük yol taşımamalı");
    assert.ok(!existsSync(join(kok, "sunucu-anahtar.pem")));
    assert.ok(!existsSync(join(kok, "eren.db")));
  });
});
