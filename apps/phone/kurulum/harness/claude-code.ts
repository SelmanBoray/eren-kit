// Claude Code uyarlayıcısı (`PcAjani`, harness/tur.ts): PC'deki normal Claude Code oturumlarının ajanda kaydı
// (docs/AJANDA.md "PC oturumları", docs/SERVIS.md "Claude Code oturumları"). Komut satırı girişi ve geri uyum
// için bütün dışa verimler `kurulum/claude-code.ts`'ten de verilir; kullanıcının Claude Code yapılandırmasına
// YALNIZ açıkça istenince dokunur:
//
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts goster          (varsayılan; hiçbir şey değiştirmez)
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-ekle  [--ayar <settings.json>]
//   node --disable-warning=ExperimentalWarning kurulum/claude-code.ts kanca-kaldir [--ayar <settings.json>]
//
// `kanca-ekle` ve `kanca-kaldir` ayar dosyasının yanına zaman damgalı yedek bırakır (hiçbir yedeği ezmez;
// güvenli yazıcı harness/json-ayar.ts), yalnız bu aracın kendi kanca girdilerini (`bizimKancaMi`: `kanca.ts
// <olay>` ya da eski biçim `kopru.ts --kanca <olay>`) ekler ya da çıkarır; başka hiçbir anahtara ve kancaya
// dokunmaz, iki kez çalıştırmak bir kez çalıştırmakla aynıdır. Yalın yolda tek kanca vardır: ajanda
// araçlarından önce `PreToolUse` (`kanca.ts arac`), yürütme biçiminde (`command` + `args`, kabuksuz;
// `kancaGirdisi`). Önceki kurulumun istem (`UserPromptSubmit`) ve tur sonu (`Stop`) kancaları artık hiçbir şey
// yapmaz; `kanca-ekle` onları çıkarır, kabuk biçimli araç kancasını yürütme biçimine çevirir. MCP sunucusunun
// kaydı (`claude mcp add`) bu betikte yoktur: `goster` tam komutu kabuk başına (PowerShell, Git Bash, cmd;
// harness/kabuk.ts) yazar, kullanıcı kendisi çalıştırır.
//
// Yolların TEK kaynağı `yollar`'dır: veri kökünden `<veri kökü>\uygulama\guncel\server\src\...` (kurulu
// sürüm; `guncel` bağlantısını kur.ts her dağıtımda yeni sürüme çevirir, eski sürümleri siler). Bu betiğin
// ya da çalışan herhangi bir dosyanın kendi yolu kullanılmaz: o yol `surumler\<sürüm>`'e çözülür ve bir
// sonraki güncellemede eskir. `eren eslestir --claude-code` de kayıt yönergesini buradan alır
// (`kayitYonergesi`). Node bu betiği çalıştıran Node'dur.
import win32 from "node:path/win32";
import { ortamDegeri, uygulamaKoku, veriKoku } from "../ortam.ts";
import type { Ortam } from "../ortam.ts";
import { AyarHatasi, ayarCoz, ayarOku, ayarYaz, nesneMi } from "./json-ayar.ts";
import type { Json } from "./json-ayar.ts";
import { KABUK_ADI, KABUKLAR, KabukHatasi, komutSatiri } from "./kabuk.ts";
import type { Kabuk } from "./kabuk.ts";
import type { KancaDurumu, KancaSecenegi, KancaSonucu, PcAjani } from "./tur.ts";

export { AyarHatasi, ayarCoz } from "./json-ayar.ts";
export type { KancaDurumu } from "./tur.ts";

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

/** Kanca girdisi (Claude Code `hooks.<olay>[].hooks[]`); `args` varsa yürütme biçimidir (kabuk yok). */
export interface KancaGirdisi {
  type: "command";
  command: string;
  args: string[];
  timeout: number;
}

/**
 * Kancanın girdisi, YÜRÜTME biçiminde (exec form): `command` Node'un kendisi, `args` argümanları; Claude
 * Code süreci kabuksuz, doğrudan başlatır. Kabuk biçimi (`"…node.exe" … || true`) kabuğa bağlıydı: ölçüldü
 * (2.1.332), Claude Code kancayı Git Bash'le (`bash -c`) çalıştırıyor, Git Bash yoksa PowerShell'e düşüyor
 * ve orada tırnaklı yolla başlayan komut ayrıştırılamıyor. Yürütme biçiminde kabuk, tırnak ve kaçış yoktur;
 * yollar Windows biçiminde kalır. `kanca.ts` her durumda 0 döner; Node kendisi hiçbir hatada 2 ("engelle")
 * ile çıkmaz (dosya yoksa 1: engellemeyen kanca hatası), bu yüzden `|| true` gerekmez.
 */
export const kancaGirdisi = (y: Pick<Yollar, "nodeExe" | "kancaBetigi">, olay: string): KancaGirdisi => ({
  type: "command",
  command: y.nodeExe,
  args: ["--disable-warning=ExperimentalWarning", y.kancaBetigi, olay],
  timeout: KANCA_SURESI_SN,
});

/**
 * Önceki kurulumların kabuk biçimli komutu (yalnız tanımak ve sınamak için; artık yazılmaz): Git Bash'te
 * çalışır, PowerShell'de çalışmaz. `kanca-ekle` bunu yürütme biçimiyle değiştirir.
 */
export const kabukBicimiKomutu = (y: Pick<Yollar, "nodeExe" | "kancaBetigi">, olay: string): string =>
  `"${ileri(y.nodeExe)}" --disable-warning=ExperimentalWarning "${ileri(y.kancaBetigi)}" ${olay} || true`;

const KANCA_OLAY_ADI = /^(istem|arac|tur_sonu)$/;
const KANCA_BETIGI = /[\\/]server[\\/]src[\\/]kanca\.ts$/i;
const KOPRU_BETIGI = /kopru\.ts$/i;

/** Bu aracın kancasının kimliği: biçim, betik (`kanca.ts` ya da eski `kopru.ts --kanca`) ve olay. */
interface KancaKimligi {
  bicim: "yurutme" | "kabuk";
  betik: "kanca" | "kopru";
  olay: string;
}
type Betik = Omit<KancaKimligi, "bicim">;

/** Kabuk biçimli komut bu aracın kancası mı; öyleyse betiği ve olayı (`istem`, `arac`, `tur_sonu`). */
const kabukBetigi = (komut: string): Betik | null => {
  const k = /[\\/]server[\\/]src[\\/]kanca\.ts"?\s+(istem|arac|tur_sonu)\b/.exec(komut)?.[1];
  if (k !== undefined) return { betik: "kanca", olay: k };
  const e = /kopru\.ts"?\s+--kanca\s+(istem|arac|tur_sonu)\b/.exec(komut)?.[1];
  return e === undefined ? null : { betik: "kopru", olay: e };
};

/** Yürütme biçimli argümanlar bu aracın kancası mı; öyleyse betiği ve olayı. */
const argBetigi = (args: readonly unknown[]): Betik | null => {
  for (let i = 0; i + 1 < args.length; i++) {
    const a = args[i];
    const b = args[i + 1];
    if (typeof a !== "string" || typeof b !== "string") continue;
    if (KANCA_BETIGI.test(a) && KANCA_OLAY_ADI.test(b)) return { betik: "kanca", olay: b };
    const c = args[i + 2];
    if (KOPRU_BETIGI.test(a) && b === "--kanca" && typeof c === "string" && KANCA_OLAY_ADI.test(c)) return { betik: "kopru", olay: c };
  }
  return null;
};

/** Bu aracın kancasıysa kimliği; değilse `null`. Girdi kanca nesnesi ya da kabuk biçimli komut dizgesi. */
function kancaKimligi(kanca: unknown): KancaKimligi | null {
  if (typeof kanca === "string") {
    const b = kabukBetigi(kanca);
    return b === null ? null : { bicim: "kabuk", ...b };
  }
  if (!nesneMi(kanca) || typeof kanca["command"] !== "string") return null;
  if (Array.isArray(kanca["args"])) {
    const b = argBetigi(kanca["args"] as unknown[]);
    return b === null ? null : { bicim: "yurutme", ...b };
  }
  const b = kabukBetigi(kanca["command"]);
  return b === null ? null : { bicim: "kabuk", ...b };
}

/**
 * Bu aracın kancası mı (yolu ne olursa olsun: sürüm ve kök değişse de tanınır). Yürütme biçimi (`args`'ta
 * `server\src\kanca.ts <olay>`), önceki kabuk biçimi, istem ve tur sonu kancaları ile eski köprü biçimi
 * (`kopru.ts --kanca <olay>`) tanınır ki `kanca-ekle` onları çıkarıp yalnız bugünkü kancayı bıraksın.
 */
export const bizimKancaMi = (kanca: unknown): boolean => kancaKimligi(kanca) !== null;

/** `claude mcp add` argümanları (programsız). Kabuğa göre satır: `mcpKaydiSatiri`. */
export const mcpEkleArgumanlari = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">): string[] => [
  "mcp", "add", MCP_ADI, "-s", "user", "--", y.nodeExe, "--disable-warning=ExperimentalWarning", y.kopruBetigi, "--rol", "pc_oturumu",
];

/** `claude mcp add` satırı, verilen kabuğa yapıştırılacak hali; yazılamıyorsa `KabukHatasi` (harness/kabuk.ts). */
export const mcpKaydiSatiri = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">, kabuk: Kabuk): string =>
  komutSatiri(kabuk, "claude", mcpEkleArgumanlari(y));

/**
 * PowerShell'e (7 ve 5.1) yapıştırılacak `claude mcp add` satırı. `--` tırnaklıdır (`'--'`): npm'in
 * `claude.ps1` kısayolu düz `--`'yı yutar (ölçüldü; harness/kabuk.ts).
 */
export const mcpEkleKomutu = (y: Pick<Yollar, "nodeExe" | "kopruBetigi">): string => mcpKaydiSatiri(y, "powershell");
export const MCP_KALDIR_KOMUTU = `claude mcp remove ${MCP_ADI} -s user`;

/**
 * MCP kaydı satırları, `goster`'in adım 1'inin gövdesi (girintili). `kabuk` verilirse yalnız o kabuğun
 * satırı; verilmezse PowerShell, Git Bash ve cmd için etiketli birer satır. Bir kabukta yollar güvenle
 * yazılamıyorsa satır yerine nedeni yazılır (öteki kabuklar kullanılır).
 */
export function mcpKaydiSatirlari(y: Pick<Yollar, "nodeExe" | "kopruBetigi">, kabuk?: Kabuk): string[] {
  const satir = (k: Kabuk): string => {
    try {
      return mcpKaydiSatiri(y, k);
    } catch (e) {
      if (!(e instanceof KabukHatasi)) throw e;
      return `(bu yollarla ${KABUK_ADI[k]} için güvenli satır yazılamıyor: ${e.message}; başka bir kabuk kullanın)`;
    }
  };
  if (kabuk !== undefined) return [`   ${satir(kabuk)}`];
  return KABUKLAR.flatMap((k) => [`   ${KABUK_ADI[k]}:`, `     ${satir(k)}`]);
}

/** Bu aracın kanca grupları (olay başına bir grup; yalın yolda yalnız `PreToolUse`). */
export const kancaGruplari = (y: Pick<Yollar, "nodeExe" | "kancaBetigi">): Record<KancaOlayi, Json> => ({
  PreToolUse: {
    matcher: ARAC_ESLESTIRICI,
    hooks: [kancaGirdisi(y, KANCA_OLAYLARI.PreToolUse)],
  },
});

/**
 * Ayardaki kanca durumu (saf): `arac` araç öncesi kancası `PreToolUse`'ta `ARAC_ESLESTIRICI` eşleyicili
 * bir grupta kurulu mu; `kabuk` bunlardan kaçı önceki kabuk biçiminde (Git Bash'te çalışır, PowerShell'e
 * düşülürse çalışmaz); `eski` bu aracın öteki kancaları (önceki kurulumun istem/tur sonu kancaları, eski
 * köprü biçimi, yanlış olaydaki ya da eşleyicisiz araç kancası). `kanca-ekle` hepsini düzeltir.
 */
export function kancaDurumuCoz(ayar: Json): { arac: boolean; eski: number; kabuk: number } {
  let arac = false;
  let eski = 0;
  let kabuk = 0;
  const hooks = ayar["hooks"];
  if (!nesneMi(hooks)) return { arac, eski, kabuk };
  for (const [olay, gruplar] of Object.entries(hooks)) {
    if (!Array.isArray(gruplar)) continue;
    for (const g of gruplar) {
      if (!nesneMi(g) || !Array.isArray(g["hooks"])) continue;
      for (const h of g["hooks"] as unknown[]) {
        const k = kancaKimligi(h);
        if (k === null) continue;
        if (olay === "PreToolUse" && g["matcher"] === ARAC_ESLESTIRICI && k.betik === "kanca" && k.olay === "arac") {
          arac = true;
          if (k.bicim === "kabuk") kabuk++;
        } else eski++;
      }
    }
  }
  return { arac, eski, kabuk };
}

/** Claude Code'un yönetilen (kurumsal) ayar dosyası; Windows'ta `%ProgramFiles%\ClaudeCode\managed-settings.json`. */
export const yonetilenAyarYolu = (ortam: Ortam): string | null => {
  const pf = ortamDegeri(ortam, "ProgramFiles");
  return pf === undefined || !win32.isAbsolute(pf) ? null : win32.join(pf, "ClaudeCode", "managed-settings.json");
};

/**
 * Kancaları bu kurulumdan bağımsız kapatan, okunabilen ayarlar: kullanıcı ayarında ya da yönetilen ayarda
 * `disableAllHooks: true`, yönetilen ayarda `allowManagedHooksOnly: true`. Proje ayarları (`<proje>\.claude\
 * settings*.json`) buradan görülmez (hangi proje bilinmez); teşhis metni onları ayrıca anar.
 */
export function kapatanAyarlar(kullanici: Json, yonetilen: Json | null, yonetilenYol: string): string[] {
  const nedenler: string[] = [];
  if (kullanici["disableAllHooks"] === true) nedenler.push("kullanıcı ayarında disableAllHooks: true");
  if (yonetilen !== null && yonetilen["disableAllHooks"] === true) nedenler.push(`yönetilen ayarda disableAllHooks: true (${yonetilenYol})`);
  if (yonetilen !== null && yonetilen["allowManagedHooksOnly"] === true) {
    nedenler.push(`yönetilen ayarda allowManagedHooksOnly: true (${yonetilenYol}; kullanıcı kancaları çalışmaz)`);
  }
  return nedenler;
}

/** Kullanıcı ayarındaki kanca durumu (`eren eslestir --claude-code --teshis`; yalnız okur, hiç atmaz). */
export function kancaDurumu(ortam: Ortam): KancaDurumu {
  let ayarYolu = "~\\.claude\\settings.json";
  try {
    ayarYolu = varsayilanAyarYolu(ortam);
    const ayar = ayarCoz(ayarOku(ayarYolu).metin);
    const yYol = yonetilenAyarYolu(ortam);
    let yonetilen: Json | null = null;
    try {
      yonetilen = yYol === null ? null : ayarCoz(ayarOku(yYol).metin);
    } catch {
      yonetilen = null; // okunamayan yönetilen ayar teşhisi durdurmaz
    }
    return { ayarYolu, ...kancaDurumuCoz(ayar), kapatan: kapatanAyarlar(ayar, yonetilen, yYol ?? "") };
  } catch (e) {
    const hata = e instanceof AyarHatasi ? e.message : "ayar dosyası okunamadı";
    return { ayarYolu, arac: null, eski: 0, kabuk: 0, kapatan: [], hata };
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
      const ic = (g["hooks"] as unknown[]).filter((h) => !(nesneMi(h) && bizimKancaMi(h)));
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
    "1. MCP köprüsü (kullanıcı kapsamı; ~/.claude.json'a yazılır). Komutu yapıştıracağınız kabuğa göre seçin:",
    ...mcpKaydiSatirlari(y),
    "",
    `2. Tek kanca: ajanda araçlarından önce (PreToolUse, ${ARAC_ESLESTIRICI}). Ana oturumun kaydını alt agent'ınkinden`,
    "   ayırır; kurulu değilse bütün kayıtlar taslak doğar. Başka hiçbir araçta ve mesajda çalışmaz, mesaj metnini okumaz.",
    "   Yürütme biçimindedir (command + args): kabuk kullanılmaz, Git Bash'e ya da PowerShell'e bağlı değildir.",
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

/** Araç öncesi kancayı kurar: okur, eski girdilerimizi çıkarıp güncelini ekler, yedekleyip yazar. */
export function kancaKur(ortam: Ortam, nodeExe: string, secenek: KancaSecenegi = {}): KancaSonucu {
  const y = yollar(ortam, nodeExe);
  const ayarYolu = secenek.ayarYolu ?? varsayilanAyarYolu(ortam);
  const okunan = ayarOku(ayarYolu);
  const onceki = ayarCoz(okunan.metin);
  const { eski, kabuk } = kancaDurumuCoz(onceki);
  const yeni = kancalariEkle(onceki, y);
  // İçerik (JSON değeri) değişti mi: dosya yoksa ya da yeni ayar öncekinden farklıysa. Yazma ve yedek bugünkü
  // CLI davranışıyla aynı kalır (her seferinde); `degisti` yalnız içeriğin gerçekten değişip değişmediğini söyler.
  const degisti = okunan.metin === null || JSON.stringify(yeni) !== JSON.stringify(onceki);
  const yedek = ayarYaz(ayarYolu, yeni, secenek.simdiMs ?? Date.now(), okunan.bom);
  const satirlar = [`Araç öncesi kanca eklendi: ${ayarYolu}${yedek === null ? "" : ` (yedek: ${yedek})`}`];
  if (eski > 0) satirlar.push(`Önceki kurulumun ${eski} eski kancası (istem / tur sonu / eski biçim) çıkarıldı.`);
  if (kabuk > 0) satirlar.push("Kabuk biçimli eski araç kancası yürütme biçimine çevrildi (kabuktan bağımsız).");
  satirlar.push("Açık Claude Code oturumları kancaları yeniden açılınca görür. MCP kaydı için: goster (adım 1).");
  return { ayarYolu, degisti, yedek, satirlar };
}

/** Bu aracın kancalarını kaldırır; yoksa dosyaya dokunmaz. */
export function kancaKaldir(ortam: Ortam, secenek: KancaSecenegi = {}): KancaSonucu {
  const ayarYolu = secenek.ayarYolu ?? varsayilanAyarYolu(ortam);
  const okunan = ayarOku(ayarYolu);
  if (okunan.metin === null) {
    return { ayarYolu, degisti: false, yedek: null, satirlar: [`Ayar dosyası yok (${ayarYolu}); kaldırılacak kanca yok.`] };
  }
  const { ayar, cikan } = kancalariCikar(ayarCoz(okunan.metin));
  if (cikan === 0) return { ayarYolu, degisti: false, yedek: null, satirlar: ["Bu aracın kancası yok; hiçbir şey değişmedi."] };
  const yedek = ayarYaz(ayarYolu, ayar, secenek.simdiMs ?? Date.now(), okunan.bom);
  return {
    ayarYolu,
    degisti: true,
    yedek,
    satirlar: [`${cikan} kanca kaldırıldı: ${ayarYolu} (yedek: ${yedek ?? "-"}). MCP kaydı için: ${MCP_KALDIR_KOMUTU}`],
  };
}

/** Claude Code uyarlayıcısı (`pcAjani("claude-code")`). */
export const CLAUDE_CODE: PcAjani = {
  ad: "claude-code",
  gorunenAd: "Claude Code",
  mcpKaydiYonergesi: (ortam, nodeExe, kabuk) => mcpKaydiSatirlari(yollar(ortam, nodeExe), kabuk).join("\n"),
  kayitYonergesi,
  kancaDurumu,
  kancaKur,
  kancaKaldir,
};

export function calis(
  argv: readonly string[],
  ortam: Ortam = process.env,
  nodeExe: string = process.execPath,
  simdiMs: () => number = Date.now,
): number {
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
      case "kanca-ekle":
        for (const s of kancaKur(ortam, nodeExe, { ayarYolu, simdiMs: simdiMs() }).satirlar) console.log(s);
        return 0;
      case "kanca-kaldir":
        for (const s of kancaKaldir(ortam, { ayarYolu, simdiMs: simdiMs() }).satirlar) console.log(s);
        return 0;
      default:
        console.error(`Bilinmeyen komut: ${komut} (goster | kanca-ekle | kanca-kaldir)`);
        return 2;
    }
  } catch (e) {
    console.error(`claude-code: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
