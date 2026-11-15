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
  sddlTakmaAc,
  SID,
  sorunMetni,
  windowsKokIzniDegerlendir,
  windowsPowerShellOrtami,
} from "../src/kok-izni.ts";
import type { KokIzniSonucu } from "../src/kok-izni.ts";

const win = process.platform === "win32";

/** Windows PowerShell 5.1'de betik çalıştırır (servisin ortamıyla: PSModulePath'siz); çıktı (hata ancak çıkış 0 değilse). */
const psCalistir = (betik: string): { status: number | null; cikti: string } => {
  const r = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(betik, "utf16le").toString("base64")],
    { encoding: "utf8", windowsHide: true, timeout: 60_000, env: windowsPowerShellOrtami(process.env) },
  );
  const cikti = (r.stdout ?? "").trim();
  return { status: r.status, cikti: r.status === 0 ? cikti : `${cikti} ${r.stderr ?? ""}`.trim() };
};

/**
 * Gerçek denemede güvenli beklenen sonuç. Düşerse ileti sorunların türünü ve kimliğini ve kökün ham
 * izin çıktısını (`sid`, `takma`, `sddl`; yol yok) taşır: CI'da neden günlükte görünür.
 */
const guvenliOlmali = (s: KokIzniSonucu, kok: string): void => {
  if (!s.guvenli) guvenliOlmaliSddl(s, psCalistir(izinBetigi(kok, "oku")).cikti);
};

/** `guvenliOlmali`'nın kök yerine hazır ham çıktıyla biçimi. */
const guvenliOlmaliSddl = (s: KokIzniSonucu, ham: string): void => {
  if (!s.guvenli) assert.fail(`güvenli bekleniyordu; sorunlar: ${JSON.stringify(s.sorunlar)}; ham izin: ${ham}`);
};

/** Yalnız izin veren ACE'lerin (sıralı, tekil) SID'leri. */
const izinliKimlikler = (aceler: readonly { tur: string; sid: string }[]): string[] =>
  [...new Set(aceler.filter((a) => !["D", "OD", "XD"].includes(a.tur)).map((a) => a.sid))].sort();

/** Sözleşmenin üç kimliği (sıralı): kullanıcı, SYSTEM, Administrators. */
const UC_KIMLIK = (sid: string): string[] => [sid.toUpperCase(), SID.SYSTEM, SID.ADMINISTRATORS].sort();

/**
 * Kökün (`izinBetigi` `oku`) ve altındaki öğelerin DACL'i, kullanıcının takma adı (`LA`...) açılmış.
 * `ileti`: düşen onaya eklenecek teşhis; yol yok, kullanıcının SID'i `BEN` yazılır.
 */
const izinIzi = (kok: string, adlar: readonly string[]): { sid: string; kok: string; alt: Record<string, string>; ileti: string } => {
  const ham = psCalistir(izinBetigi(kok, "oku")).cikti;
  const j = JSON.parse(ham.split(/\r?\n/).at(-1) ?? "{}") as { sid?: string; takma?: string };
  const c = izinCiktisiCoz(ham);
  assert.ok(c && j.sid && j.takma, "kök izni okunamadı");
  const b64 = adlar.map((a) => `'${Buffer.from(join(kok, a), "utf16le").toString("base64")}'`).join(",");
  const r = psCalistir(
    [
      "$ErrorActionPreference='Stop'",
      `foreach($b in @(${b64})){ $p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b)); (Get-Item -LiteralPath $p -Force).GetAccessControl('Access').GetSecurityDescriptorSddlForm('Access') }`,
    ].join("\n"),
  );
  assert.equal(r.status, 0, "alt öğe izni okunamadı");
  const satirlar = r.cikti.split(/\r?\n/).map((s) => s.trim());
  const alt: Record<string, string> = {};
  adlar.forEach((a, i) => (alt[a] = sddlTakmaAc(satirlar[i] ?? "", j.takma!, j.sid!)));
  // Makine SID'i de basılmaz: kullanıcı `BEN`, aynı makinenin öteki hesapları/grupları `S-1-5-21-MAKINE-<rid>`.
  const makine = /^S-1-5-21-\d+-\d+-\d+/.exec(c.sid)?.[0];
  const gizle = (s: string): string => {
    const t = s.split(c.sid).join("BEN");
    return makine === undefined ? t : t.split(makine).join("S-1-5-21-MAKINE");
  };
  const ileti = `takma ${j.takma === j.sid ? "yok" : j.takma}; kök ${gizle(c.sddl)}; ${adlar.map((a) => `${a} ${gizle(alt[a]!)}`).join("; ")}`;
  return { sid: c.sid, kok: c.sddl, alt, ileti };
};

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

/**
 * Ortamlar: kullanıcı SID'inin SDDL'deki yazımı. Windows makineye bağlı bazı SID'leri takma adla yazar:
 * makine etki alanının RID 500'ü (yerleşik Administrator; GitHub Actions'ın `runneradmin`'i) `LA`, RID
 * 501'i (Guest) `LG`. Başka etki alanının RID 500'ü (alan yöneticisi) tam SID kalır. Değerlendirme
 * servis ve kurulumla aynı yoldan: betik çıktısı → `izinCiktisiCoz` → `windowsKokIzniDegerlendir`.
 */
describe("kok-izni: ortamlar (betik çıktısından karar)", () => {
  const MAKINE = "S-1-5-21-1111111111-2222222222-3333333333";
  const ALAN = "S-1-5-21-4444444444-5555555555-6666666666";
  const YERLESIK_ADMIN = `${MAKINE}-500`;
  const MISAFIR = `${MAKINE}-501`;
  const ALAN_KULLANICISI = `${ALAN}-1105`;
  const ALAN_YONETICISI = `${ALAN}-500`;
  const MS_HESABI = `${MAKINE}-1001`; // Microsoft hesabıyla oturum: yerel SID, takma adsız.
  const karar = (o: { sid: string; takma?: unknown; sddl: string }): KokIzniSonucu => {
    const c = izinCiktisiCoz(JSON.stringify({ ...o, olustu: false, duzeltildi: false }));
    return c === null ? { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] } : windowsKokIzniDegerlendir(c.sddl, c.sid);
  };
  /** Windows'un `korumaliSddl` ile oluşturulan kökü geri okuyunca yazdığı biçim (`takma` yerinde). */
  const korumaliOkunan = (takma: string, grup: string) =>
    `O:${takma}G:${grup}D:PAI(A;OICI;FA;;;${takma})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`;

  it("yerleşik Administrator (CI'ın runneradmin'i): kendi oluşturduğu korumalı kök güvenli", () => {
    const sddl = korumaliOkunan("LA", `${MAKINE}-513`);
    // Eski davranış (takma adı bilmeyen kural) CI'daki iki sorunu tam üretir:
    assert.deepEqual(windowsKokIzniDegerlendir(sddl, YERLESIK_ADMIN), {
      guvenli: false,
      sorunlar: [
        { tur: "sahip", kimlik: "LA" },
        { tur: "erisim", kimlik: "LA", kalitimla: false },
      ],
    });
    assert.deepEqual(karar({ sid: YERLESIK_ADMIN, takma: "LA", sddl }), { guvenli: true });
    assert.deepEqual(karar({ sid: YERLESIK_ADMIN, takma: "la", sddl: korumaliOkunan("LA", "LA") }), { guvenli: true });
    // Profil altındaki kalıtılmış olağan tanım da.
    assert.deepEqual(
      karar({ sid: YERLESIK_ADMIN, takma: "LA", sddl: "O:LAG:LAD:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;LA)" }),
      { guvenli: true },
    );
  });

  it("Guest (LG), sıradan kullanıcı, Microsoft hesabı, alan hesabı, alan yöneticisi: korumalı kök güvenli", () => {
    assert.deepEqual(karar({ sid: MISAFIR, takma: "LG", sddl: korumaliOkunan("LG", `${MAKINE}-513`) }), { guvenli: true });
    for (const sid of [BEN, MS_HESABI, ALAN_KULLANICISI, ALAN_YONETICISI]) {
      assert.deepEqual(karar({ sid, takma: sid, sddl: korumaliOkunan(sid, `${MAKINE}-513`) }), { guvenli: true }, sid);
      assert.deepEqual(karar({ sid, sddl: korumaliOkunan(sid, `${MAKINE}-513`) }), { guvenli: true }, `${sid} takma yok`);
    }
  });

  it("yükseltilmiş yönetici kabuğu: Administrators'ın sahibi olduğu kalıtılmış kök güvenli", () => {
    for (const [sid, takma] of [[BEN, BEN], [ALAN_KULLANICISI, ALAN_KULLANICISI], [YERLESIK_ADMIN, "LA"]] as const) {
      const sddl = `O:BAG:SYD:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${takma})`;
      assert.deepEqual(karar({ sid, takma, sddl }), { guvenli: true }, sid);
    }
  });

  it("yerleşik Administrator: başka hesaba ya da gruba açık kök yine güvensiz", () => {
    const s = karar({
      sid: YERLESIK_ADMIN,
      takma: "LA",
      sddl: "O:LAD:AI(A;OICIID;FA;;;LA)(A;OICIID;0x1200a9;;;BU)(A;OICIID;0x1301bf;;;AU)(A;;FR;;;LG)",
    });
    assert.deepEqual(s, {
      guvenli: false,
      sorunlar: [
        { tur: "erisim", kimlik: "S-1-5-32-545", kalitimla: true },
        { tur: "erisim", kimlik: "S-1-5-11", kalitimla: true },
        { tur: "erisim", kimlik: "LG", kalitimla: false },
      ],
    });
    const sahip = karar({ sid: YERLESIK_ADMIN, takma: "LA", sddl: `O:${BASKA}D:PAI(A;OICI;FA;;;LA)` });
    assert.deepEqual(sahip, { guvenli: false, sorunlar: [{ tur: "sahip", kimlik: BASKA }] });
  });

  it("takma ad RID'den tahmin edilmez: başka hesabın LA'sı (yerel Administrator) güvensiz", () => {
    // Alan yöneticisi (alan RID 500) için Windows SID'i tam yazar; kökteki LA makinenin yerel
    // Administrator'ıdır, kullanıcı değil.
    for (const sid of [ALAN_YONETICISI, BEN, MS_HESABI]) {
      const s = karar({ sid, takma: sid, sddl: `O:${sid}D:PAI(A;OICI;FA;;;${sid})(A;OICI;FA;;;LA)` });
      assert.deepEqual(s, { guvenli: false, sorunlar: [{ tur: "erisim", kimlik: "LA", kalitimla: false }] }, sid);
      const o = karar({ sid, takma: sid, sddl: `O:LAD:PAI(A;OICI;FA;;;${sid})` });
      assert.deepEqual(o, { guvenli: false, sorunlar: [{ tur: "sahip", kimlik: "LA" }] }, sid);
    }
    // Yerleşik Administrator için LG (Guest) kullanıcı değildir.
    assert.equal(karar({ sid: YERLESIK_ADMIN, takma: "LA", sddl: "O:LGD:PAI(A;OICI;FA;;;LA)" }).guvenli, false);
  });

  it("beklenmedik takma (tür, biçim, başka SID) çözülemedi sayılır", () => {
    const sddl = korumaliOkunan("LA", "LA");
    for (const takma of [null, 5, "", "L;", "LAX", "S-1-5-32-544", SID.SYSTEM]) {
      assert.deepEqual(karar({ sid: YERLESIK_ADMIN, takma, sddl }), { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] }, String(takma));
    }
  });

  it("sddlTakmaAc yalnız SID yerlerini açar (sahip, grup, ACE hesabı); koşul ve haklar aynen", () => {
    const X = YERLESIK_ADMIN;
    assert.equal(
      sddlTakmaAc("O:LAG:LAD:PAI(A;OICI;FA;;;LA)(A;;FA;;;S-1-5-21-1-2-3-500)(XA;;FA;;;WD;(Member_of {SID(LA)}))(A;;FA;;;LAX)", "LA", X),
      `O:${X}G:${X}D:PAI(A;OICI;FA;;;${X})(A;;FA;;;S-1-5-21-1-2-3-500)(XA;;FA;;;WD;(Member_of {SID(LA)}))(A;;FA;;;LAX)`,
    );
    assert.equal(sddlTakmaAc(`O:${BEN}G:LAD:(A;;FA;;;BA)`, "LA", X), `O:${BEN}G:${X}D:(A;;FA;;;BA)`);
    assert.equal(sddlTakmaAc("O:LAD:(A;;FA;;;LA)", BEN, X), "O:LAD:(A;;FA;;;LA)");
  });
});

describe("kok-izni: Windows'un gerçek takma ad yazımı", { skip: !win }, () => {
  it("makine RID 500/501 takma adla yazılır, başka etki alanınınki tam; betiğin takma satırı bunu yakalar", () => {
    // Betiğin kendi satırları: kullanıcı SID'inin yazımı ve korumalı tanım. Yükseltme gerekmez:
    // tanım bellekte kurulur, Windows'un SDDL çeviricisi (kökü okuyanla aynı) geri yazar.
    const satirlar = izinBetigi("C:\\k", "oku").split("\n");
    const satir = (bas: string) => satirlar.find((s) => s.startsWith(bas)) ?? assert.fail(`betikte ${bas} yok`);
    const betik = (sidIfadesi: string) =>
      [
        "$ErrorActionPreference='Stop'",
        `$sid=${sidIfadesi}`,
        satir("$takma="),
        satir("$hedef="),
        "$sddl=(New-Object Security.AccessControl.RawSecurityDescriptor($hedef)).GetSddlForm('All')",
        "ConvertTo-Json -Compress @{sid=$sid; takma=$takma; sddl=$sddl}",
      ].join("\n");
    const takmaSid = (t: string) => `(New-Object Security.AccessControl.RawSecurityDescriptor('O:${t}')).Owner.Value`;
    for (const [ifade, beklenenTakma] of [
      [takmaSid("LA"), "LA"],
      [takmaSid("LG"), "LG"],
      ["'S-1-5-21-1-2-3-500'", null],
    ] as const) {
      const r = psCalistir(betik(ifade));
      assert.equal(r.status, 0, r.cikti);
      const ham = JSON.parse(r.cikti.split(/\r?\n/).at(-1)!) as { sid: string; takma: string; sddl: string };
      assert.equal(ham.takma, beklenenTakma ?? ham.sid, r.cikti);
      const c = izinCiktisiCoz(r.cikti);
      assert.ok(c, r.cikti);
      guvenliOlmaliSddl(windowsKokIzniDegerlendir(c.sddl, c.sid), r.cikti);
      if (beklenenTakma !== null) {
        // Takma adı açmayan eski yol CI'daki iki sorunu üretir.
        assert.deepEqual(windowsKokIzniDegerlendir(ham.sddl, ham.sid), {
          guvenli: false,
          sorunlar: [
            { tur: "sahip", kimlik: beklenenTakma },
            { tur: "erisim", kimlik: beklenenTakma, kalitimla: false },
          ],
        });
      }
    }
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
    guvenliOlmali(await veriKokuIzniHazirla(kok), kok);
    assert.ok(existsSync(kok));
    guvenliOlmali(await veriKokuIzniHazirla(kok), kok);
    // Alt dosya ve klasör kökten kalıtır: yalnız üç kimlik, hepsi kalıtılmış (`ID`), açık ACE yok.
    writeFileSync(join(kok, "sir.txt"), "x");
    mkdirSync(join(kok, "alt"));
    const iz = izinIzi(kok, ["sir.txt", "alt"]);
    const kokC = sddlCoz(iz.kok);
    assert.ok(kokC?.dacl, iz.ileti);
    // Kök: kalıtım kesik (`P`), otomatik kalıtım açık (`AI`), her ACE dosyaya ve klasöre kalıtılabilir.
    assert.ok(/P/.test(kokC.dacl.bayraklar) && /AI/.test(kokC.dacl.bayraklar), `kök bayrakları: ${iz.ileti}`);
    assert.deepEqual(izinliKimlikler(kokC.dacl.aceler), UC_KIMLIK(iz.sid), iz.ileti);
    for (const a of kokC.dacl.aceler) assert.ok(a.bayraklar.includes("OI") && a.bayraklar.includes("CI") && !a.bayraklar.includes("ID"), `kök ACE ${a.bayraklar}: ${iz.ileti}`);
    for (const [ad, sddl] of Object.entries(iz.alt)) {
      const c = sddlCoz(sddl);
      assert.ok(c?.dacl, `${ad}: ${iz.ileti}`);
      assert.deepEqual(izinliKimlikler(c.dacl.aceler), UC_KIMLIK(iz.sid), `${ad}: ${iz.ileti}`);
      for (const a of c.dacl.aceler) assert.ok(a.bayraklar.includes("ID"), `${ad} kalıtılmamış ACE (${a.bayraklar}): ${iz.ileti}`);
    }
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
    guvenliOlmali(await modulYoluyla(yol, () => veriKokuIzniHazirla(yeni)), yeni);
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
