import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KABUKLAR, KabukHatasi, kabukArgumani, komutSatiri } from "../harness/kabuk.ts";
import type { Kabuk } from "../harness/kabuk.ts";
import { gosterMetni, mcpEkleArgumanlari, mcpEkleKomutu, mcpKaydiSatiri, mcpKaydiSatirlari, yollar } from "../claude-code.ts";

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
// Sahte `claude` kısayolları npm'inkilerin aynısıdır (`.ps1`: `& <exe> $args`, `.cmd`: `"<exe>" %*`,
// sh: `exec <exe> "$@"`); exe yerine argümanları JSON yazan Node betiği. Kabuk bulunamazsa o kabuk atlanır.

interface Duzen {
  ad: string;
  kabuk: Kabuk;
  kisayol: "ps1" | "cmd" | "sh";
  calistir: (satirlar: readonly string[], env: NodeJS.ProcessEnv, dizin: string) => string[];
}

const ortamDegeri = (ad: string): string | undefined => Object.entries(process.env).find(([k]) => k.toUpperCase() === ad)?.[1];

function psDuzeni(ad: string, exe: string, kisayol: "ps1" | "cmd"): Duzen {
  return {
    ad,
    kabuk: "powershell",
    kisayol,
    calistir: (satirlar, env, dizin) => {
      const f = join(dizin, `${ad.replace(/\W/g, "_")}.ps1`);
      writeFileSync(f, `\uFEFF${satirlar.join("\n")}\n`, "utf8"); // 5.1 BOM'suz betiği ANSI okur
      const r = spawnSync(exe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f], { encoding: "utf8", env });
      assert.equal(r.status, 0, `${ad}: ${r.stderr}`);
      return r.stdout.trim().split(/\r?\n/);
    },
  };
}

function duzenler(): { duzenler: Duzen[]; atlanan: string[] } {
  const atlanan: string[] = [];
  const d: Duzen[] = [];
  const pwsh = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"], { encoding: "utf8" });
  if (pwsh.error === undefined && pwsh.status === 0) d.push(psDuzeni("pwsh/.ps1", "pwsh", "ps1"), psDuzeni("pwsh/.cmd", "pwsh", "cmd"));
  else atlanan.push("pwsh");
  const ps51 = join(ortamDegeri("SYSTEMROOT") ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (existsSync(ps51)) d.push(psDuzeni("powershell 5.1/.ps1", ps51, "ps1"), psDuzeni("powershell 5.1/.cmd", ps51, "cmd"));
  else atlanan.push("powershell.exe");
  // Git Bash (System32\bash.exe WSL'dir, kullanılmaz).
  const bash = join(ortamDegeri("PROGRAMFILES") ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  if (existsSync(bash)) {
    d.push({
      ad: "Git Bash",
      kabuk: "bash",
      kisayol: "sh",
      calistir: (satirlar, env, dizin) => {
        const f = join(dizin, "olcum.sh");
        writeFileSync(f, `${satirlar.join("\n")}\n`, "utf8");
        const r = spawnSync(bash, [f], { encoding: "utf8", env });
        assert.equal(r.status, 0, `bash: ${r.stderr}`);
        return r.stdout.trim().split(/\r?\n/);
      },
    });
  } else atlanan.push("Git Bash");
  const comspec = ortamDegeri("COMSPEC") ?? "cmd.exe";
  d.push({
    ad: "cmd",
    kabuk: "cmd",
    kisayol: "cmd",
    // Satır `cmd /d /s /c "<satır>"` ile, yazıldığı gibi (Node kaçışlamaz): etkileşimli kabuğa yapıştırmanın aynısı.
    calistir: (satirlar, env) =>
      satirlar.map((s) => {
        const r = spawnSync(comspec, ["/d", "/s", "/c", `"${s}"`], { encoding: "utf8", env, windowsVerbatimArguments: true });
        assert.equal(r.status, 0, `cmd: ${r.stderr}`);
        return r.stdout.trim();
      }),
  });
  return { duzenler: d, atlanan };
}

const psTek = (a: string): string => `'${a.replaceAll("'", "''")}'`;

/** Sahte kısayolları kurar: `<kok>\ps1\claude.ps1`, `<kok>\cmd\claude.cmd`, `<kok>\sh\claude`. */
function kisayollar(kok: string): void {
  const yaz = join(kok, "yaz.js");
  // Argümanları JSON olarak, ASCII dışını \u ile yazar (kabukların kod sayfasından bağımsız).
  writeFileSync(
    yaz,
    'process.stdout.write(JSON.stringify({ kim: process.argv[2], args: process.argv.slice(3) }).replace(/[\\u007f-\\uffff]/g, (c) => "\\\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\\n");\n',
    "utf8",
  );
  for (const d of ["ps1", "cmd", "sh"]) mkdirSync(join(kok, d));
  writeFileSync(join(kok, "ps1", "claude.ps1"), `#!/usr/bin/env pwsh\n& ${psTek(process.execPath)} ${psTek(yaz)} ps1   $args\nexit $LASTEXITCODE\n`, "utf8");
  writeFileSync(join(kok, "cmd", "claude.cmd"), `@ECHO off\r\nSETLOCAL\r\n"${process.execPath}" "${yaz}" cmd   %*\r\n`, "utf8");
  writeFileSync(join(kok, "sh", "claude"), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${yaz.replaceAll("'", "'\\''")}' sh   "$@"\n`, "utf8");
}

const DURUMLAR: ReadonlyArray<{ ad: string; args: string[]; psCmdHaric?: true }> = [
  { ad: "MCP kaydı, boşluklu yollar", args: mcpEkleArgumanlari(BOSLUKLU) },
  { ad: "MCP kaydı, düz yollar", args: mcpEkleArgumanlari(DUZ) },
  {
    ad: "özel karakterli yollar",
    args: ["--", "-s", "C:\\Program Files (x86)\\a,b;c=d\\node.exe", "C:\\Users\\O'Brien & Co\\ä ö\\kopru.ts", "son\\", "C:\\a b\\x’y‘z", "C:\\x!y", "C:\\a$b\\c`d", "1e3", "a,b"],
  },
  // PowerShell `.cmd`'yi çağırırken boşluksuz argümanı tırnaksız verir; cmd onu yeniden ayrıştırır (`^`, `&`
  // bozulur; ölçüldü). npm'in varsayılanında PowerShell `.ps1`'e çözülür; `.cmd` düzeni bu durumda atlanır.
  { ad: "cmd özel karakterleri boşluksuz", args: ["C:\\x^y&z", "C:\\a(b)"], psCmdHaric: true },
];

test("gerçek kabuklarda: üretilen satır sahte claude kısayoluna tam aynı argümanları geçirir (PowerShell .ps1 ve .cmd, Git Bash, cmd)", { skip: process.platform !== "win32" }, (t) => {
  const kok = mkdtempSync(join(tmpdir(), "eren-kabuk-"));
  try {
    kisayollar(kok);
    const { duzenler: liste, atlanan } = duzenler();
    if (atlanan.length > 0) t.diagnostic(`bulunamayan kabuk, atlandı: ${atlanan.join(", ")}`);
    for (const d of liste) {
      const env: NodeJS.ProcessEnv = { ...process.env };
      const yolAdi = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
      env[yolAdi] = `${join(kok, d.kisayol)};${env[yolAdi] ?? ""}`;
      const durumlar = DURUMLAR.filter((u) => !(u.psCmdHaric === true && d.kabuk === "powershell" && d.kisayol === "cmd"));
      const satirlar = durumlar.map((u) => komutSatiri(d.kabuk, "claude", u.args));
      const ciktilar = d.calistir(satirlar, env, kok);
      assert.equal(ciktilar.length, durumlar.length, `${d.ad}: ${ciktilar.join(" | ")}`);
      durumlar.forEach((u, i) => {
        assert.deepEqual(JSON.parse(ciktilar[i]!), { kim: d.kisayol, args: u.args }, `${d.ad} / ${u.ad}: ${satirlar[i]}`);
      });
    }
    // Bugüne kadarki satır (düz `--`) PowerShell'in .ps1 kısayolunda `--`'yı kaybediyordu: ölçüm bunu yakalar.
    const ps = liste.find((d) => d.kabuk === "powershell" && d.kisayol === "ps1");
    if (ps !== undefined) {
      const env: NodeJS.ProcessEnv = { ...process.env };
      const yolAdi = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
      env[yolAdi] = `${join(kok, "ps1")};${env[yolAdi] ?? ""}`;
      const eski = mcpKaydiSatiri(BOSLUKLU, "powershell").replace(" '--' ", " -- ");
      const args = (JSON.parse(ps.calistir([eski], env, kok)[0]!) as { args: string[] }).args;
      assert.equal(args.includes("--"), false, "düz -- .ps1'de yutulmalıydı (ölçümün kendisi sınanır)");
    }
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
});
