// PC'deki normal Claude Code oturumlarının ajanda kaydı (docs/AJANDA.md "PC oturumları", docs/SERVIS.md
// "Claude Code oturumları"). Kullanıcının Claude Code yapılandırmasına YALNIZ açıkça istenince dokunur:
//
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts goster          (varsayılan; hiçbir şey değiştirmez)
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-ekle  [--ayar <settings.json>]
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-kaldir [--ayar <settings.json>]
//
// `kanca-ekle` ve `kanca-kaldir` ayar dosyasının yanına zaman damgalı yedek bırakır, yalnız bu aracın
// kendi kanca girdilerini (`bizimKancaMi`: komutunda `kanca.ts <olay>` ya da eski biçim `kopru.ts --kanca
// <olay>` geçen) ekler ya da çıkarır; başka hiçbir anahtara ve kancaya dokunmaz, iki kez çalıştırmak bir
// kez çalıştırmakla aynıdır. Yalın yolda tek kanca vardır: ajanda araçlarından önce `PreToolUse`
// (`kanca.ts arac`). Önceki kurulumun istem (`UserPromptSubmit`) ve tur sonu (`Stop`) kancaları artık
// hiçbir şey yapmaz; `kanca-ekle` onları da çıkarır. MCP sunucusunun kaydı (`claude mcp add`) bu betikte
// yoktur: `goster` tam komutu yazar, kullanıcı kendisi çalıştırır.
//
// Yolların TEK kaynağı `yollar`'dır: veri kökünden `<veri kökü>\uygulama\guncel\server\src\...` (kurulu
// sürüm; `guncel` bağlantısını kur.ts her dağıtımda yeni sürüme çevirir, eski sürümleri siler). Bu betiğin
// ya da çalışan herhangi bir dosyanın kendi yolu kullanılmaz: o yol `surumler\<sürüm>`'e çözülür ve bir
// sonraki güncellemede eskir. `eren eslestir --claude-code` de kayıt yönergesini buradan alır
// (`kayitYonergesi`). Node bu betiği çalıştıran Node'dur.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import win32 from "node:path/win32";
import { ortamDegeri, uygulamaKoku, veriKoku } from "./ortam.ts";
import type { Ortam } from "./ortam.ts";

/** Kullanıcının Claude Code'una kayıtlı MCP sunucusunun adı (`protocol` `AJANDA_PC_MCP_ADI`). */
export const MCP_ADI = "eren-ajanda";
/** Kancanın en uzun süresi (sn). Kanca servise en çok 2 sn harcar, en geç 3 sn'de kendini kapatır; bol pay. */
export const KANCA_SURESI_SN = 10;

/** Yalın yol: tek Claude Code olayı, yalnız ajanda araçlarında (`ARAC_ESLESTIRICI`). */
export type KancaOlayi = "PreToolUse";
/** Claude Code olayı → `kanca.ts` olayı. */
export const KANCA_OLAYLARI: Readonly<Record<KancaOlayi, string>> = {
  PreToolUse: "arac",
};
export const ARAC_ESLESTIRICI = `mcp__${MCP_ADI}__.*`;

export interface Yollar {
  nodeExe: string;
  /** MCP köprüsü (`--rol pc_oturumu`). */
  kopruBetigi: string;
  /** Hafif kanca girişi (`server/src/kanca.ts`; MCP kitaplığını ve zod'u yüklemez). */
  kancaBetigi: string;
  anahtarDosyasi: string;
}

export const yollar = (ortam: Ortam, nodeExe: string): Yollar => {
  const kok = veriKoku(ortam);
  const src = win32.join(uygulamaKoku(kok), "guncel", "server", "src");
  return {
    nodeExe,
    kopruBetigi: win32.join(src, "kopru.ts"),
    kancaBetigi: win32.join(src, "kanca.ts"),
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
 * Kancanın tam komutu. Claude Code kancayı kabukta çalıştırır (Windows'ta Git Bash): yollar ileri eğik
 * çizgili ve tırnaklı. Sondaki `|| true`: kanca hiçbir koşulda 2 ile çıkmasın (2 kancada "engelle" demektir:
 * PreToolUse'ta aracı durdurur); `kanca.ts` her durumda 0 döner, ama eski
 * bir sürüme geri dönülürse dosya bulunamaz ve Node 1 ile çıkar.
 */
export const kancaKomutu = (y: Pick<Yollar, "nodeExe" | "kancaBetigi">, olay: string): string =>
  `"${ileri(y.nodeExe)}" --disable-warning=ExperimentalWarning "${ileri(y.kancaBetigi)}" ${olay} || true`;

/**
 * Komut bu aracın kancası mı (yolu ne olursa olsun: sürüm ve kök değişse de tanınır). Önceki kurulumların
 * istem ve tur sonu kancaları ile eski biçim (`kopru.ts --kanca <olay>`) da tanınır ki `kanca-ekle` onları
 * çıkarıp yalnız araç öncesi kancayı bıraksın.
 */
export const bizimKancaMi = (komut: unknown): boolean =>
  typeof komut === "string" &&
  (/[\\/]server[\\/]src[\\/]kanca\.ts"?\s+(istem|arac|tur_sonu)\b/.test(komut) || /kopru\.ts"?\s+--kanca\s+(istem|arac|tur_sonu)\b/.test(komut));

/** Bugünkü araç öncesi kancanın komutu mu (`kanca.ts arac`). */
const aracKancasiMi = (komut: unknown): boolean => typeof komut === "string" && /[\\/]server[\\/]src[\\/]kanca\.ts"?\s+arac\b/.test(komut);

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

/** Bu aracın kanca grupları (olay başına bir grup; yalın yolda yalnız `PreToolUse`). */
export const kancaGruplari = (y: Pick<Yollar, "nodeExe" | "kancaBetigi">): Record<KancaOlayi, Json> => ({
  PreToolUse: {
    matcher: ARAC_ESLESTIRICI,
    hooks: [{ type: "command", command: kancaKomutu(y, KANCA_OLAYLARI.PreToolUse), timeout: KANCA_SURESI_SN }],
  },
});

/**
 * Ayardaki kanca durumu (saf): `arac` araç öncesi kancası `PreToolUse`'ta `ARAC_ESLESTIRICI` eşleyicili
 * bir grupta kurulu mu; `eski` bu aracın öteki kancaları (önceki kurulumun istem/tur sonu kancaları, eski
 * biçim, yanlış olaydaki ya da eşleyicisiz araç kancası). `kanca-ekle` ikisini de düzeltir.
 */
export function kancaDurumuCoz(ayar: Json): { arac: boolean; eski: number } {
  let arac = false;
  let eski = 0;
  const hooks = ayar["hooks"];
  if (!nesneMi(hooks)) return { arac, eski };
  for (const [olay, gruplar] of Object.entries(hooks)) {
    if (!Array.isArray(gruplar)) continue;
    for (const g of gruplar) {
      if (!nesneMi(g) || !Array.isArray(g["hooks"])) continue;
      for (const h of g["hooks"] as unknown[]) {
        if (!nesneMi(h) || !bizimKancaMi(h["command"])) continue;
        if (olay === "PreToolUse" && g["matcher"] === ARAC_ESLESTIRICI && aracKancasiMi(h["command"])) arac = true;
        else eski++;
      }
    }
  }
  return { arac, eski };
}

/** Kullanıcı ayarındaki kanca durumu (`eren eslestir --claude-code --teshis`; yalnız okur, hiç atmaz). */
export function kancaDurumu(ortam: Ortam): { ayarYolu: string; arac: boolean | null; eski: number } {
  let ayarYolu = "~\\.claude\\settings.json";
  try {
    ayarYolu = varsayilanAyarYolu(ortam);
    return { ayarYolu, ...kancaDurumuCoz(ayarCoz(ayarOku(ayarYolu))) };
  } catch {
    return { ayarYolu, arac: null, eski: 0 };
  }
}

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
export function kancalariEkle(ayar: Json, y: Pick<Yollar, "nodeExe" | "kancaBetigi">): Json {
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

/**
 * `goster` çıktısı: kayıt, kancalar, izin önerisi, sınama, kaldırma. Hiçbir şey değiştirmez. `anahtarAdimi`
 * yanlışsa (anahtar az önce üretildi: `eren eslestir --claude-code`) adım 0 yazılmaz.
 */
export function gosterMetni(y: Yollar, ayarYolu: string, anahtarAdimi = true): string {
  const json = JSON.stringify({ hooks: Object.fromEntries(Object.entries(kancaGruplari(y)).map(([o, g]) => [o, [g]])) }, null, 2);
  return [
    "PC'deki Claude Code oturumlarının ajanda kaydı (kullanıcının onayıyla, bir kez):",
    "",
    ...(anahtarAdimi
      ? ["0. Anahtar (servisin veri kökünde; yoksa araçlar \"anahtar yok\" der):", "   eren eslestir --claude-code", `   Dosya: ${y.anahtarDosyasi}`, ""]
      : []),
    "1. MCP köprüsü (kullanıcı kapsamı; ~/.claude.json'a yazılır):",
    `   ${mcpEkleKomutu(y)}`,
    "",
    `2. Tek kanca: ajanda araçlarından önce (PreToolUse, ${ARAC_ESLESTIRICI}). Ana oturumun kaydını alt agent'ınkinden`,
    "   ayırır; kurulu değilse bütün kayıtlar taslak doğar. Başka hiçbir araçta ve mesajda çalışmaz, mesaj metnini okumaz.",
    `   ${ayarYolu}; bu betik yedekleyip ekler (önceki kurulumun istem/tur sonu kancalarını da çıkarır): kanca-ekle.`,
    '   Elle eklenecekse "hooks"a:',
    json.split("\n").map((s) => `   ${s}`).join("\n"),
    "",
    "3. İsteğe bağlı izin (her çağrıda sorulmasın): settings.json permissions.allow'a",
    `   "mcp__${MCP_ADI}__ajanda_ekle", "mcp__${MCP_ADI}__ajanda_guncelle", "mcp__${MCP_ADI}__ajanda_listele"`,
    "",
    "4. Sınama: yeni bir Claude Code oturumu açın, bir kayıt isteyin (\"yarın 10'da dişçi, ajandaya ekle\"),",
    "   sonra: eren eslestir --claude-code --teshis  (kanca \"kurulu\", son karar \"insan\" olmalı; docs/AJANDA.md \"Kurulumdan sonra sınama\")",
    "",
    "Kaldırma: kanca-kaldir; " + MCP_KALDIR_KOMUTU + "; eren eslestir --claude-code --kaldir",
    "",
  ].join("\n");
}

/**
 * `eren eslestir --claude-code`'un anahtardan sonra yazdığı kayıt yönergesi (`server/src/eslestir.ts`
 * bunu yükler ve olduğu gibi yazar): `goster` ile aynı metin, adım 0'sız, yollar `yollar(ortam, nodeExe)`'den.
 */
export const kayitYonergesi = (ortam: Ortam, nodeExe: string): string =>
  gosterMetni(yollar(ortam, nodeExe), varsayilanAyarYolu(ortam), false);

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
        const onceki = ayarCoz(ayarOku(ayarYolu));
        const { eski } = kancaDurumuCoz(onceki);
        const yeni = kancalariEkle(onceki, y);
        const yedek = ayarYaz(ayarYolu, yeni, Date.now());
        console.log(`Araç öncesi kanca eklendi: ${ayarYolu}${yedek === null ? "" : ` (yedek: ${yedek})`}`);
        if (eski > 0) console.log(`Önceki kurulumun ${eski} eski kancası (istem / tur sonu / eski biçim) çıkarıldı.`);
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
