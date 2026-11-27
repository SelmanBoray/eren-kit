// PC'deki normal Claude Code oturumlarının ajanda kaydı (docs/AJANDA.md "PC oturumları", docs/SERVIS.md
// "Claude Code oturumları"). Kullanıcının Claude Code yapılandırmasına YALNIZ açıkça istenince dokunur:
//
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts goster          (varsayılan; hiçbir şey değiştirmez)
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-ekle  [--ayar <settings.json>]
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-kaldir [--ayar <settings.json>]
//
// `kanca-ekle` ve `kanca-kaldir` ayar dosyasının yanına zaman damgalı yedek bırakır, yalnız bu aracın
// kendi kanca girdilerini (komutunda `kopru.ts` ve `--kanca` geçen) ekler ya da çıkarır; başka hiçbir
// anahtara ve kancaya dokunmaz, iki kez çalıştırmak bir kez çalıştırmakla aynıdır. MCP sunucusunun kaydı
// (`claude mcp add`) bu betikte yoktur: `goster` tam komutu yazar, kullanıcı kendisi çalıştırır.
// Yollar kurulu sürümdendir (`<veri kökü>\uygulama\guncel\server\src\kopru.ts`); Node bu betiği çalıştıran Node'dur.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import win32 from "node:path/win32";
import { ortamDegeri, uygulamaKoku, veriKoku } from "./ortam.ts";
import type { Ortam } from "./ortam.ts";

/** Kullanıcının Claude Code'una kayıtlı MCP sunucusunun adı (`server/src/eslestir.ts` `CLAUDE_CODE_MCP_ADI`). */
export const MCP_ADI = "eren-ajanda";
/** Kancanın en uzun süresi (sn). Kanca servise en çok 2 sn harcar; Node açılışı dahil bol pay. */
export const KANCA_SURESI_SN = 10;

export type KancaOlayi = "UserPromptSubmit" | "PreToolUse" | "Stop";
/** Claude Code olayı → `kopru.ts --kanca` olayı. */
export const KANCA_OLAYLARI: Readonly<Record<KancaOlayi, string>> = {
  UserPromptSubmit: "istem",
  PreToolUse: "arac",
  Stop: "tur_sonu",
};
export const ARAC_ESLESTIRICI = `mcp__${MCP_ADI}__.*`;

export interface Yollar {
  nodeExe: string;
  kopruBetigi: string;
  anahtarDosyasi: string;
}

export const yollar = (ortam: Ortam, nodeExe: string): Yollar => {
  const kok = veriKoku(ortam);
  return {
    nodeExe,
    kopruBetigi: win32.join(uygulamaKoku(kok), "guncel", "server", "src", "kopru.ts"),
    anahtarDosyasi: win32.join(kok, "ajanda-pc.anahtar"),
  };
};

/** `~/.claude/settings.json` (kullanıcı kapsamı). */
export const varsayilanAyarYolu = (ortam: Ortam): string => {
  const up = ortamDegeri(ortam, "USERPROFILE");
  if (up === undefined || !win32.isAbsolute(up)) throw new Error("USERPROFILE tanımlı ve mutlak yol olmalı");
  return win32.join(up, ".claude", "settings.json");
};

const ileri = (yol: string): string => yol.replaceAll("\\", "/");

/**
 * `server/src/eslestir.ts` `kancaKomutu` ile aynı biçim: ileri eğik çizgili, tırnaklı yollar; sonda `|| true`
 * (kanca 2 ile çıkarsa Claude Code istemi siler, aracı durdurur ya da Stop'ta yanıtı sürdürür; geri alınmış
 * eski bir `kopru.ts` `--kanca`'yı tanımaz ve 2 ile çıkar).
 */
export const kancaKomutu = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">, olay: string): string =>
  `"${ileri(y.nodeExe)}" --disable-warning=ExperimentalWarning "${ileri(y.kopruBetigi)}" --kanca ${olay} || true`;

/** Komut bu aracın kancası mı (yolu ne olursa olsun: sürüm ve kök değişse de tanınır). */
export const bizimKancaMi = (komut: unknown): boolean =>
  typeof komut === "string" && /kopru\.ts"?\s+--kanca\s+(istem|arac|tur_sonu)\b/.test(komut);

/** `claude mcp add` argümanları ve PowerShell'e yapıştırılacak hali. */
export const mcpEkleArgumanlari = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">): string[] => [
  "mcp", "add", MCP_ADI, "-s", "user", "--", y.nodeExe, "--disable-warning=ExperimentalWarning", y.kopruBetigi, "--rol", "pc_oturumu",
];
const psTirnak = (a: string): string => (/^[A-Za-z0-9_.:\\/=-]+$/.test(a) ? a : `'${a.replaceAll("'", "''")}'`);
export const mcpEkleKomutu = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">): string => `claude ${mcpEkleArgumanlari(y).map(psTirnak).join(" ")}`;
export const MCP_KALDIR_KOMUTU = `claude mcp remove ${MCP_ADI} -s user`;

type Json = Record<string, unknown>;
const nesneMi = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export class AyarHatasi extends Error {
  override name = "AyarHatasi";
}

/** Bu aracın kanca grupları (olay başına bir grup). */
export const kancaGruplari = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">): Record<KancaOlayi, Json> => {
  const grup = (olay: KancaOlayi): Json => ({
    ...(olay === "PreToolUse" ? { matcher: ARAC_ESLESTIRICI } : {}),
    hooks: [{ type: "command", command: kancaKomutu(y, KANCA_OLAYLARI[olay]), timeout: KANCA_SURESI_SN }],
  });
  return { UserPromptSubmit: grup("UserPromptSubmit"), PreToolUse: grup("PreToolUse"), Stop: grup("Stop") };
};

/**
 * Ayardan bu aracın kancalarını çıkarır (saf; girdi değişmez). Gruptaki öteki kancalar kalır; boşalan grup,
 * boşalan olay ve boşalan `hooks` silinir. Tanınmayan biçim (dizi olmayan olay, nesne olmayan grup)
 * olduğu gibi bırakılır.
 */
export function kancalariCikar(ayar: Json): { ayar: Json; cikan: number } {
  const kopya = structuredClone(ayar);
  let cikan = 0;
  const hooks = kopya["hooks"];
  if (!nesneMi(hooks)) return { ayar: kopya, cikan };
  for (const olay of Object.keys(hooks)) {
    const gruplar = hooks[olay];
    if (!Array.isArray(gruplar)) continue;
    const kalan: unknown[] = [];
    for (const g of gruplar) {
      if (!nesneMi(g) || !Array.isArray(g["hooks"])) {
        kalan.push(g);
        continue;
      }
      const ic = (g["hooks"] as unknown[]).filter((h) => !(nesneMi(h) && bizimKancaMi(h["command"])));
      cikan += (g["hooks"] as unknown[]).length - ic.length;
      if (ic.length > 0) kalan.push({ ...g, hooks: ic });
    }
    if (kalan.length > 0) hooks[olay] = kalan;
    else delete hooks[olay];
  }
  if (Object.keys(hooks).length === 0) delete kopya["hooks"];
  return { ayar: kopya, cikan };
}

/** Önce eski girdilerimizi çıkarır, sonra güncellerini olayların sonuna ekler (idempotent). */
export function kancalariEkle(ayar: Json, y: Pick<Yollar, "nodeExe" | "kopruBetigi">): Json {
  if (ayar["hooks"] !== undefined && !nesneMi(ayar["hooks"])) throw new AyarHatasi('ayardaki "hooks" bir nesne değil; elle bakılmalı');
  const { ayar: temiz } = kancalariCikar(ayar);
  const hooks: Json = nesneMi(temiz["hooks"]) ? temiz["hooks"] : {};
  for (const [olay, grup] of Object.entries(kancaGruplari(y))) {
    const var_ = hooks[olay];
    if (var_ !== undefined && !Array.isArray(var_)) throw new AyarHatasi(`ayardaki hooks.${olay} bir dizi değil; elle bakılmalı`);
    hooks[olay] = [...((var_ as unknown[] | undefined) ?? []), grup];
  }
  return { ...temiz, hooks };
}

/** Ayar dosyası metni → nesne. Yoksa `{}`; bozuksa ya da nesne değilse atar (dosyaya dokunulmaz). */
export function ayarCoz(metin: string | null): Json {
  if (metin === null || metin.trim() === "") return {};
  let j: unknown;
  try {
    j = JSON.parse(metin);
  } catch {
    throw new AyarHatasi("ayar dosyası geçerli JSON değil; hiçbir şey değişmedi");
  }
  if (!nesneMi(j)) throw new AyarHatasi("ayar dosyası bir JSON nesnesi değil; hiçbir şey değişmedi");
  return j;
}

/** `goster` çıktısı: kayıt, kancalar, izin önerisi, kaldırma. Hiçbir şey değiştirmez. */
export function gosterMetni(y: Yollar, ayarYolu: string): string {
  const json = JSON.stringify({ hooks: Object.fromEntries(Object.entries(kancaGruplari(y)).map(([o, g]) => [o, [g]])) }, null, 2);
  return [
    "PC'deki Claude Code oturumlarının ajanda kaydı (kullanıcının onayıyla, bir kez):",
    "",
    "0. Anahtar (servisin veri kökünde; yoksa araçlar \"anahtar yok\" der):",
    "   eren eslestir --claude-code",
    `   Dosya: ${y.anahtarDosyasi}`,
    "",
    "1. MCP köprüsü (kullanıcı kapsamı; ~/.claude.json'a yazılır):",
    `   ${mcpEkleKomutu(y)}`,
    "",
    `2. Kancalar (${ayarYolu}; bu betik yedekleyip ekler: kanca-ekle). Elle eklenecekse "hooks"a:`,
    json.split("\n").map((s) => `   ${s}`).join("\n"),
    "",
    "3. İsteğe bağlı izin (her çağrıda sorulmasın): settings.json permissions.allow'a",
    `   "mcp__${MCP_ADI}__ajanda_ekle", "mcp__${MCP_ADI}__ajanda_guncelle", "mcp__${MCP_ADI}__ajanda_listele"`,
    "",
    "Kaldırma: kanca-kaldir; " + MCP_KALDIR_KOMUTU + "; eren eslestir --claude-code --kaldir",
    "",
  ].join("\n");
}

const zamanDamgasi = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** Yedekle, yaz (geçici dosya + yeniden adlandırma). Yedek yolunu döner (dosya yoksa `null`). */
function ayarYaz(yol: string, ayar: Json, simdiMs: number): string | null {
  let yedek: string | null = null;
  if (existsSync(yol)) {
    yedek = `${yol}.yedek-${zamanDamgasi(simdiMs)}`;
    copyFileSync(yol, yedek);
  } else {
    mkdirSync(win32.dirname(yol), { recursive: true });
  }
  const gecici = `${yol}.yeni-${process.pid}`;
  writeFileSync(gecici, `${JSON.stringify(ayar, null, 2)}\n`, "utf8");
  renameSync(gecici, yol);
  return yedek;
}

const ayarOku = (yol: string): string | null => (existsSync(yol) ? readFileSync(yol, "utf8") : null);

export function calis(argv: readonly string[], ortam: Ortam = process.env, nodeExe: string = process.execPath): number {
  const [komut = "goster", ...geri] = argv;
  const i = geri.indexOf("--ayar");
  const verilen = i >= 0 ? geri[i + 1] : undefined;
  if (i >= 0 && (verilen === undefined || !win32.isAbsolute(verilen))) {
    console.error("--ayar mutlak bir settings.json yolu ister");
    return 2;
  }
  const bilinmeyen = geri.filter((a, j) => !(j === i || j === i + 1));
  if (bilinmeyen.length > 0) {
    console.error(`Bilinmeyen seçenek: ${bilinmeyen.join(" ")}`);
    return 2;
  }
  try {
    const y = yollar(ortam, nodeExe);
    const ayarYolu = verilen ?? varsayilanAyarYolu(ortam);
    switch (komut) {
      case "goster":
        process.stdout.write(gosterMetni(y, ayarYolu));
        return 0;
      case "kanca-ekle": {
        const yeni = kancalariEkle(ayarCoz(ayarOku(ayarYolu)), y);
        const yedek = ayarYaz(ayarYolu, yeni, Date.now());
        console.log(`Kancalar eklendi: ${ayarYolu}${yedek === null ? "" : ` (yedek: ${yedek})`}`);
        console.log("Açık Claude Code oturumları kancaları yeniden açılınca görür. MCP kaydı için: goster (adım 1).");
        return 0;
      }
      case "kanca-kaldir": {
        const metin = ayarOku(ayarYolu);
        if (metin === null) {
          console.log(`Ayar dosyası yok (${ayarYolu}); kaldırılacak kanca yok.`);
          return 0;
        }
        const { ayar, cikan } = kancalariCikar(ayarCoz(metin));
        if (cikan === 0) {
          console.log("Bu aracın kancası yok; hiçbir şey değişmedi.");
          return 0;
        }
        const yedek = ayarYaz(ayarYolu, ayar, Date.now());
        console.log(`${cikan} kanca kaldırıldı: ${ayarYolu} (yedek: ${yedek ?? "-"}). MCP kaydı için: ${MCP_KALDIR_KOMUTU}`);
        return 0;
      }
      default:
        console.error(`Bilinmeyen komut: ${komut} (goster | kanca-ekle | kanca-kaldir)`);
        return 2;
    }
  } catch (e) {
    console.error(`claude-code: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = calis(process.argv.slice(2));
