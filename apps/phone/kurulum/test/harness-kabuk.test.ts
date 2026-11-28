import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KABUKLAR, KabukHatasi, kabukArgumani, komutSatiri } from "../harness/kabuk.ts";
import type { Kabuk } from "../harness/kabuk.ts";
import { gosterMetni, mcpEkleArgumanlari, mcpEkleKomutu, mcpKaydiSatiri, mcpKaydiSatirlari, yollar } from "../claude-code.ts";
import * as codex from "../harness/codex.ts";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const BOSLUKLU = yollar({ LOCALAPPDATA: "C:\\Users\\Ad Soyad\\AppData\\Local", USERPROFILE: "C:\\Users\\Ad Soyad" }, NODE);
const DUZ = yollar({ LOCALAPPDATA: "C:\\ornek\\Yerel", USERPROFILE: "C:\\ornek\\Kullanici" }, "C:\\ornek\\node.exe");

test("PowerShell: -- her zaman tırnaklı ('--'), ad ve bayraklar çıplak, boşluklu yol tek tırnaklı; tek ve akıllı tırnaklar ikilenir", () => {
  const ps = (a: string) => kabukArgumani("powershell", a);
  assert.equal(ps("--"), "'--'");
  for (const a of ["-s", "--rol", "--disable-warning=ExperimentalWarning", "mcp", "eren-ajanda", "pc_oturumu", "C:\\x\\kopru.ts"]) assert.equal(ps(a), a);
  assert.equal(ps(NODE), "'C:\\Program Files\\nodejs\\node.exe'");
  assert.equal(ps("C:\\O'Brien\\a’b‘c"), "'C:\\O''Brien\\a’’b‘‘c'");
  // `.ps1`'e çıplak verilince bozulan biçimler tırnaklanır (ölçüldü: `a,b` → `a b`, `-s:x` → `-s:` `x`).
  for (const a of ["a,b", "-s:user", "1e3", "C:\\x$y", "C:\\a`b", "--a=C:\\x"]) assert.equal(ps(a), `'${a}'`, a);
  assert.throws(() => ps(""), KabukHatasi);
  assert.throws(() => ps('C:\\a"b'), KabukHatasi);
  assert.throws(() => ps("C:\\a b\\"), KabukHatasi, "5.1 sondaki \\ ile kapanan tırnağı bozar");
  assert.equal(ps("son\\"), "son\\", "boşluksuz: çıplak (gerçek kabuk ölçümü aşağıda)");
});

test("Git Bash: ters eğik çizgili her yol tek tırnaklı, -- çıplak, ' kapatılıp kaçışlanır; / ile başlayan yol reddedilir", () => {
  const sh = (a: string) => kabukArgumani("bash", a);
  assert.equal(sh("--"), "--");
  assert.equal(sh("C:\\x\\kopru.ts"), "'C:\\x\\kopru.ts'");
  assert.equal(sh("C:\\O'Brien"), "'C:\\O'\\''Brien'");
  assert.equal(sh("--disable-warning=ExperimentalWarning"), "--disable-warning=ExperimentalWarning");
  assert.equal(sh(""), "''");
  assert.throws(() => sh("/c/x"), KabukHatasi);
  assert.throws(() => sh("--a=/c/x"), KabukHatasi);
});

test("cmd: çift tırnak, sondaki ters eğik çizgiler ikilenir; % ve \" reddedilir", () => {
  const c = (a: string) => kabukArgumani("cmd", a);
  assert.equal(c("--"), "--");
  assert.equal(c("C:\\x\\kopru.ts"), "C:\\x\\kopru.ts");
  assert.equal(c(NODE), '"C:\\Program Files\\nodejs\\node.exe"');
  assert.equal(c("C:\\a b\\"), '"C:\\a b\\\\"');
  assert.equal(c("C:\\O'Brien & Co"), '"C:\\O\'Brien & Co"');
  assert.throws(() => c("C:\\%TEMP%\\x"), KabukHatasi);
  assert.throws(() => c('a"b'), KabukHatasi);
  for (const k of KABUKLAR) assert.throws(() => kabukArgumani(k, "a\nb"), KabukHatasi, k);
});

test("goster: MCP kaydı üç kabuk için etiketli; PowerShell satırında '--', bugünkü mcpEkleKomutu o satırdır", () => {
  assert.equal(mcpEkleKomutu(BOSLUKLU), mcpKaydiSatiri(BOSLUKLU, "powershell"));
  assert.match(mcpEkleKomutu(BOSLUKLU), / -s user '--' 'C:\\Program Files\\nodejs\\node\.exe' /);
  const m = gosterMetni(BOSLUKLU, "C:\\Users\\Ad Soyad\\.claude\\settings.json");
  for (const k of KABUKLAR) assert.ok(m.includes(`     ${mcpKaydiSatiri(BOSLUKLU, k)}\n`), k);
  assert.ok(m.includes("   PowerShell (7 ve 5.1):\n") && m.includes("   Git Bash:\n") && m.includes("   cmd:\n"));
  assert.deepEqual(mcpKaydiSatirlari(BOSLUKLU, "bash"), [`   ${mcpKaydiSatiri(BOSLUKLU, "bash")}`]);
  // Bir kabukta yazılamayan yol: o kabuk için satır yerine neden; ötekiler durur.
  const yuzde = { ...BOSLUKLU, kopruBetigi: "C:\\Users\\%x%\\kopru.ts" };
  const s = mcpKaydiSatirlari(yuzde);
  assert.match(s[5]!, /cmd için güvenli satır yazılamıyor: % içeren/);
  assert.ok(s[1]!.includes("'C:\\Users\\%x%\\kopru.ts'"));
});

// --- Gerçek kabuklarda ölçüm ---------------------------------------------------------------------
// Ölçülen: üretilen satırın `--`'yı, boşluklu yolları ve özel karakterleri npm biçimli bir kısayoldan
// (`.ps1`: `& <exe> $args`, `.cmd`: `"<exe>" %*`, sh: `exec <exe> "$@"`) aynen geçirmesi. Program adının
// `claude` olması gerekmez: kısayollar başka hiçbir yerde bulunmayan `SAHTE` adını taşır; PATH gölgelemesi
// tutmasa bile gerçek `claude` çalışmaz (komut bulunamaz, test düşer). Ad her kabukta çıplak yazılır, yani
// satırın geri kalanı `claude` ile üretilenle aynıdır (aşağıda sınanır). exe yerine argümanları JSON yazan
// Node betiği. Kabuk bulunamazsa ya da bu makinede betik çalıştıramıyorsa (ör. yürütme ilkesi grup ilkesiyle
// zorlanmış) o düzen gerekçesiyle atlanır (alt test olarak, sayılır); tırnaklama hatası atlatılmaz.

const SAHTE = "eren-kabuk-olcum-kisayolu";

interface Sonuc {
  status: number | null;
  cikti: string[];
  hata: string;
}

interface Duzen {
  ad: string;
  kabuk: Kabuk;
  kisayol: "ps1" | "cmd" | "sh";
  calistir: (satirlar: readonly string[], env: NodeJS.ProcessEnv, dizin: string) => Sonuc;
  /** PowerShell: `-ExecutionPolicy Bypass` ile açılan süreçte etkin yürütme ilkesi (grup ilkesi bunu ezebilir). */
  etkinIlke?: (env: NodeJS.ProcessEnv) => string;
}

const ortamDegeri = (ad: string): string | undefined => Object.entries(process.env).find(([k]) => k.toUpperCase() === ad)?.[1];

const sonuc = (r: ReturnType<typeof spawnSync>): Sonuc => ({
  status: r.error === undefined ? r.status : null,
  cikti: String(r.stdout ?? "").trim().split(/\r?\n/),
  hata: r.error !== undefined ? r.error.message : String(r.stderr ?? ""),
});

function psDuzeni(ad: string, exe: string, kisayol: "ps1" | "cmd"): Duzen {
  return {
    ad,
    kabuk: "powershell",
    kisayol,
    calistir: (satirlar, env, dizin) => {
      const f = join(dizin, `${ad.replace(/\W/g, "_")}.ps1`);
      writeFileSync(f, `\uFEFF${satirlar.join("\n")}\n`, "utf8"); // 5.1 BOM'suz betiği ANSI okur
      return sonuc(spawnSync(exe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f], { encoding: "utf8", env }));
    },
    // -Command betik dosyası değildir; Restricted/AllSigned altında da çalışır.
    etkinIlke: (env) =>
      sonuc(spawnSync(exe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "Get-ExecutionPolicy"], { encoding: "utf8", env })).cikti[0]?.trim() ?? "",
  };
}

/** Bütün düzenler; bulunamayanın yanında atlanma gerekçesi. */
function duzenler(): Array<{ duzen: Duzen; atla?: string }> {
  const d: Array<{ duzen: Duzen; atla?: string }> = [];
  const pwsh = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"], { encoding: "utf8" });
  const pwshYok = pwsh.error === undefined && pwsh.status === 0 ? undefined : "pwsh bulunamadı";
  d.push({ duzen: psDuzeni("pwsh/.ps1", "pwsh", "ps1"), atla: pwshYok }, { duzen: psDuzeni("pwsh/.cmd", "pwsh", "cmd"), atla: pwshYok });
  const ps51 = join(ortamDegeri("SYSTEMROOT") ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const ps51Yok = existsSync(ps51) ? undefined : "powershell.exe (5.1) bulunamadı";
  d.push({ duzen: psDuzeni("powershell 5.1/.ps1", ps51, "ps1"), atla: ps51Yok }, { duzen: psDuzeni("powershell 5.1/.cmd", ps51, "cmd"), atla: ps51Yok });
  // Git Bash (System32\bash.exe WSL'dir, kullanılmaz).
  const bash = join(ortamDegeri("PROGRAMFILES") ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  d.push({
    duzen: {
      ad: "Git Bash",
      kabuk: "bash",
      kisayol: "sh",
      calistir: (satirlar, env, dizin) => {
        const f = join(dizin, "olcum.sh");
        writeFileSync(f, `${satirlar.join("\n")}\n`, "utf8");
        return sonuc(spawnSync(bash, [f], { encoding: "utf8", env }));
      },
    },
    atla: existsSync(bash) ? undefined : "Git Bash bulunamadı",
  });
  const comspec = ortamDegeri("COMSPEC") ?? "cmd.exe";
  d.push({
    duzen: {
      ad: "cmd",
      kabuk: "cmd",
      kisayol: "cmd",
      // Satır `cmd /d /s /c "<satır>"` ile, yazıldığı gibi (Node kaçışlamaz): etkileşimli kabuğa yapıştırmanın aynısı.
      calistir: (satirlar, env) => {
        const cikti: string[] = [];
        for (const s of satirlar) {
          const r = sonuc(spawnSync(comspec, ["/d", "/s", "/c", `"${s}"`], { encoding: "utf8", env, windowsVerbatimArguments: true }));
          if (r.status !== 0) return r;
          cikti.push(r.cikti.join("\n"));
        }
        return { status: 0, cikti, hata: "" };
      },
    },
  });
  return d;
}

const psTek = (a: string): string => `'${a.replaceAll("'", "''")}'`;

/** Sahte kısayolları kurar: `<kok>\ps1\<SAHTE>.ps1`, `<kok>\cmd\<SAHTE>.cmd`, `<kok>\sh\<SAHTE>`. */
function kisayollar(kok: string): void {
  const yaz = join(kok, "yaz.js");
  // Argümanları JSON olarak, ASCII dışını \u ile yazar (kabukların kod sayfasından bağımsız).
  writeFileSync(
    yaz,
    'process.stdout.write(JSON.stringify({ kim: process.argv[2], args: process.argv.slice(3) }).replace(/[\\u007f-\\uffff]/g, (c) => "\\\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\\n");\n',
    "utf8",
  );
  for (const d of ["ps1", "cmd", "sh"]) mkdirSync(join(kok, d));
  writeFileSync(join(kok, "ps1", `${SAHTE}.ps1`), `#!/usr/bin/env pwsh\n& ${psTek(process.execPath)} ${psTek(yaz)} ps1   $args\nexit $LASTEXITCODE\n`, "utf8");
  writeFileSync(join(kok, "cmd", `${SAHTE}.cmd`), `@ECHO off\r\nSETLOCAL\r\n"${process.execPath}" "${yaz}" cmd   %*\r\n`, "utf8");
  writeFileSync(join(kok, "sh", SAHTE), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${yaz.replaceAll("'", "'\\''")}' sh   "$@"\n`, "utf8");
}

/** Kısayol dizini PATH'in başında, gerisi aynı ortam. */
function kisayolOrtami(kok: string, kisayol: Duzen["kisayol"]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const yolAdi = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[yolAdi] = `${join(kok, kisayol)};${env[yolAdi] ?? ""}`;
  return env;
}

// Yürütme ilkesinin betiği reddettiğini gösteren, dilden bağımsız PowerShell hata kimlikleri (5.1 yazar;
// pwsh'in kısa hata görünümü yazmaz, onun için etkin ilkeye bakılır).
const ILKE_HATASI = /UnauthorizedAccess|PSSecurityException|SecurityError/;
// Yerel, imzasız betiği reddeden ilkeler (RemoteSigned yerel dosyaya izin verir).
const ENGELLEYEN_ILKE = new Set(["Restricted", "AllSigned"]);

const ilkSatir = (s: string): string => s.trim().split(/\r?\n/)[0] ?? "";

/**
 * Düzen bu makinede çalışabiliyor mu: önce tırnaklanacak hiçbir şeyi olmayan bir betik (`echo`), sonra tek düz
 * argümanla kısayol. Buradaki başarısızlık kabuğun ya da ilkenin sorunudur, tırnaklama hatası değil. Atlama
 * gerekçesi döner; kısayol adımında yalnız PowerShell yürütme ilkesi engeli atlatılır, başka her hata düşer.
 */
function yokla(d: Duzen, env: NodeJS.ProcessEnv, kok: string): string | undefined {
  const bos = d.calistir(["echo eren-yoklama"], env, kok);
  if (bos.status !== 0 || bos.cikti[0] !== "eren-yoklama") return `kabuk betik çalıştıramıyor (çıkış ${bos.status}): ${ilkSatir(bos.hata)}`;
  const r = d.calistir([`${SAHTE} yoklama`], env, kok);
  if (r.status === 0 && r.cikti[0] === JSON.stringify({ kim: d.kisayol, args: ["yoklama"] })) return undefined;
  const ilke = d.etkinIlke?.(env);
  if (d.kabuk === "powershell" && (ILKE_HATASI.test(r.hata) || (ilke !== undefined && ENGELLEYEN_ILKE.has(ilke)))) {
    return `yürütme ilkesi (${ilke ?? "?"}) kısayol betiğini reddetti: ${ilkSatir(r.hata)}`;
  }
  assert.fail(`${d.ad}: düz argümanlı kısayol çağrısı başarısız (çıkış ${r.status}): ${r.cikti.join(" | ")} ${r.hata}`);
}

const DURUMLAR: ReadonlyArray<{ ad: string; args: string[]; psCmdHaric?: true }> = [
  { ad: "MCP kaydı, boşluklu yollar", args: mcpEkleArgumanlari(BOSLUKLU) },
  { ad: "MCP kaydı, düz yollar", args: mcpEkleArgumanlari(DUZ) },
  // Codex (`codex mcp add … --env K=V -- …`): `=` içeren argüman ve aynı yollar.
  { ad: "Codex MCP kaydı, boşluklu yollar", args: codex.mcpEkleArgumanlari(BOSLUKLU, "C:\\Users\\Ad Soyad\\AppData\\Local\\eren-kit") },
  { ad: "Codex MCP kaydı, düz yollar", args: codex.mcpEkleArgumanlari(DUZ, "C:\\ornek\\Yerel\\eren-kit") },
  {
    ad: "özel karakterli yollar",
    args: ["--", "-s", "C:\\Program Files (x86)\\a,b;c=d\\node.exe", "C:\\Users\\O'Brien & Co\\ä ö\\kopru.ts", "son\\", "C:\\a b\\x’y‘z", "C:\\x!y", "C:\\a$b\\c`d", "1e3", "a,b"],
  },
  // PowerShell `.cmd`'yi çağırırken boşluksuz argümanı tırnaksız verir; cmd onu yeniden ayrıştırır (`^`, `&`
  // bozulur; ölçüldü). npm'in varsayılanında PowerShell `.ps1`'e çözülür; `.cmd` düzeni bu durumda atlanır.
  { ad: "cmd özel karakterleri boşluksuz", args: ["C:\\x^y&z", "C:\\a(b)"], psCmdHaric: true },
];

test("sahte program adı her kabukta çıplak; MCP satırı claude yerine bu adla, geri kalanı bayt bayt aynı", () => {
  for (const k of KABUKLAR) {
    assert.equal(kabukArgumani(k, SAHTE), SAHTE, k);
    for (const y of [BOSLUKLU, DUZ]) {
      const satir = mcpKaydiSatiri(y, k);
      assert.ok(satir.startsWith("claude "), k);
      assert.equal(komutSatiri(k, SAHTE, mcpEkleArgumanlari(y)), `${SAHTE}${satir.slice("claude".length)}`, k);
      const kok = "C:\\Users\\Ad Soyad\\AppData\\Local\\eren-kit";
      const cs = codex.mcpKaydiSatiri(y, kok, k);
      assert.ok(cs.startsWith("codex "), k);
      assert.equal(komutSatiri(k, SAHTE, codex.mcpEkleArgumanlari(y, kok)), `${SAHTE}${cs.slice("codex".length)}`, k);
    }
  }
});

test("gerçek kabuklarda: üretilen satır sahte kısayola tam aynı argümanları geçirir (PowerShell .ps1 ve .cmd, Git Bash, cmd)", { skip: process.platform !== "win32" }, async (t) => {
  const kok = mkdtempSync(join(tmpdir(), "eren-kabuk-"));
  try {
    kisayollar(kok);
    const calisan: Duzen[] = [];
    for (const { duzen: d, atla } of duzenler()) {
      const env = kisayolOrtami(kok, d.kisayol);
      const neden = atla ?? yokla(d, env, kok);
      await t.test(d.ad, { skip: neden ?? false }, () => {
        const durumlar = DURUMLAR.filter((u) => !(u.psCmdHaric === true && d.kabuk === "powershell" && d.kisayol === "cmd"));
        const satirlar = durumlar.map((u) => komutSatiri(d.kabuk, SAHTE, u.args));
        const r = d.calistir(satirlar, env, kok);
        assert.equal(r.status, 0, `${d.ad}: ${r.hata}`);
        assert.equal(r.cikti.length, durumlar.length, `${d.ad}: ${r.cikti.join(" | ")}`);
        durumlar.forEach((u, i) => {
          assert.deepEqual(JSON.parse(r.cikti[i]!), { kim: d.kisayol, args: u.args }, `${d.ad} / ${u.ad}: ${satirlar[i]}`);
        });
      });
      if (neden === undefined) calisan.push(d);
    }
    // Bugüne kadarki satır (düz `--`) PowerShell'in .ps1 kısayolunda `--`'yı kaybediyordu: ölçüm bunu yakalar.
    const ps = calisan.find((d) => d.kabuk === "powershell" && d.kisayol === "ps1");
    await t.test("eski düz -- satırı .ps1'de --'yı kaybeder (ölçümün kendisi)", { skip: ps === undefined ? "çalışabilen PowerShell .ps1 düzeni yok" : false }, () => {
      const yeni = komutSatiri("powershell", SAHTE, mcpEkleArgumanlari(BOSLUKLU));
      assert.ok(yeni.includes(" '--' "), yeni);
      const eski = yeni.replace(" '--' ", " -- ");
      const r = ps!.calistir([eski], kisayolOrtami(kok, "ps1"), kok);
      assert.equal(r.status, 0, r.hata);
      const args = (JSON.parse(r.cikti[0]!) as { args: string[] }).args;
      assert.equal(args.includes("--"), false, "düz -- .ps1'de yutulmalıydı (ölçümün kendisi sınanır)");
      assert.deepEqual(args, mcpEkleArgumanlari(BOSLUKLU).filter((a) => a !== "--"), "yalnız -- kaybolur");
    });
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
});
