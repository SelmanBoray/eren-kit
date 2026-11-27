// Kullanıcının terminale yapıştıracağı komut satırları: argüman listesi → kabuğa göre tırnaklanmış tek satır.
// Kurallar bu makinede, argümanları yazan sahte `claude` kısayollarıyla (npm'in `.ps1`, `.cmd` ve sh
// kısayollarının aynısı) gerçek kabuklarda ölçüldü (2026-11-27; test/harness-kabuk.test.ts aynı ölçümü yapar):
//
// - PowerShell (7.7 ve 5.1): `claude` önce npm'in `claude.ps1`'ine çözülür ve `.ps1` çağrılırken düz `--`
//   yutulur (`x -- a` → `x a`); tırnaklı `'--'` `.ps1`, `.cmd` ve doğrudan `.exe` çağrısında `--` geçer.
//   Tek tırnak içinde `'` ve akıllı tek tırnaklar (‘ ’ ‚ ‛) da dizgeyi kapatır: ikilenir. `.ps1`'e çıplak
//   `a,b` dizi olur (`a b`), `-s:x` ikiye bölünür: çıplak bırakılan biçimler dar tutulur.
// - Git Bash: tırnaksız ters eğik çizgi kaçış sayılır (`C:\x\k.ts` → `C:xk.ts`); Windows yolu tek tırnakla
//   verilir. `--` ile `'--'` aynıdır. MSYS, `/` ile başlayan argümanı Windows yoluna çevirir: desteklenmez.
// - cmd: tek tırnak tırnak değildir (`'C:\a b'` iki argüman olur); çift tırnak gerekir. Çift tırnak içinde
//   `& ( ) ^ ! ' $` olduğu gibi geçer; sondaki ters eğik çizgiler ikilenir (MSVCRT kuralı, `"son\\"` → `son\`).
//   `%` (ortam değişkeni açılımı) ve `"` güvenle yazılamaz: desteklenmez.
//
// Desteklenmeyen argüman `KabukHatasi` atar; yönerge o kabuk için satır yerine nedeni yazar.

export type Kabuk = "powershell" | "bash" | "cmd";
export const KABUKLAR: readonly Kabuk[] = ["powershell", "bash", "cmd"];
/** Kullanıcıya görünen ad. */
export const KABUK_ADI: Readonly<Record<Kabuk, string>> = {
  powershell: "PowerShell (7 ve 5.1)",
  bash: "Git Bash",
  cmd: "cmd",
};

export class KabukHatasi extends Error {
  override name = "KabukHatasi";
}

const DENETIM = /[\u0000-\u001f\u007f]/;

/** PowerShell'de çıplak kalabilen: harfle başlayan yol/ad ya da `-ad`, `--ad`, `--ad=deger` (`--` değil). */
const PS_CIPLAK = /^(?:[A-Za-z][A-Za-z0-9_.:\\/+-]*|--?[A-Za-z][A-Za-z0-9-]*(?:=[A-Za-z0-9_.+-]*)?)$/;
const BASH_CIPLAK = /^[A-Za-z0-9_.:/=+,@%-]+$/;
const CMD_CIPLAK = /^[A-Za-z0-9_.:\\/=+-]+$/;

function powershell(a: string): string {
  if (a === "") throw new KabukHatasi("boş argüman (Windows PowerShell 5.1 boş argümanı düşürür)");
  if (a.includes('"')) throw new KabukHatasi("çift tırnaklı argüman (Windows PowerShell 5.1 bozar)");
  if (/\s/.test(a) && a.endsWith("\\")) throw new KabukHatasi("boşluklu ve ters eğik çizgiyle biten argüman (Windows PowerShell 5.1 bozar)");
  if (PS_CIPLAK.test(a)) return a;
  return `'${a.replace(/['\u2018\u2019\u201a\u201b]/g, "$&$&")}'`;
}

function bash(a: string): string {
  if (a.startsWith("/") || a.includes("=/")) throw new KabukHatasi("/ ile başlayan yol (Git Bash onu Windows yoluna çevirir)");
  if (a !== "" && BASH_CIPLAK.test(a)) return a;
  return `'${a.replaceAll("'", "'\\''")}'`;
}

function cmd(a: string): string {
  if (a.includes('"')) throw new KabukHatasi("çift tırnaklı argüman (cmd'de güvenle yazılamaz)");
  if (a.includes("%")) throw new KabukHatasi("% içeren argüman (cmd ortam değişkeni olarak açabilir)");
  if (a !== "" && CMD_CIPLAK.test(a)) return a;
  return `"${a.replace(/(\\+)$/, "$1$1")}"`;
}

const TIRNAKCI: Readonly<Record<Kabuk, (a: string) => string>> = { powershell, bash, cmd };

/** Tek argümanın kabukta yazılışı; yazılamıyorsa `KabukHatasi`. */
export function kabukArgumani(kabuk: Kabuk, a: string): string {
  if (DENETIM.test(a)) throw new KabukHatasi("denetim karakterli argüman (satıra yapıştırılamaz)");
  return TIRNAKCI[kabuk](a);
}

/** `program` ve argümanları, kabuğa yapıştırılınca tam bu argümanları geçiren tek satır; yazılamıyorsa `KabukHatasi`. */
export const komutSatiri = (kabuk: Kabuk, program: string, args: readonly string[]): string =>
  [program, ...args].map((a) => kabukArgumani(kabuk, a)).join(" ");
