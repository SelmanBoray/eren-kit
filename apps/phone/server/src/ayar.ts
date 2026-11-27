/**
 * Yollar, sabitler, süreç ortamları, repo dışı ekler. Kişisel değer burada yoktur: hepsi
 * `ayar.local.json`, `kimlik.local.md`, `projeler.json`'dan gelir. Eksik ya da bozuk ayar
 * başlangıçta `AyarHatasi` ile durur; hata metinleri yalnız alan adı taşır, değer taşımaz
 * (Telegram jetonu hiçbir hata metnine girmez).
 */
import win32 from "node:path/win32";
import { fileURLToPath } from "node:url";
import { AJANDA_SINIRLARI, PC_SERVIS_OTURUMU_ORTAMI, ProjelerCikti } from "@eren/protocol";
import type { McpProfili, ServisBilgisi } from "@eren/protocol";
import { ortamDegeri, veriKokuCoz, VERI_KOKU_ORTAMI } from "./veri-koku.ts";
import type {
  Ayar,
  AyarFabrikasi,
  AyarBagimliliklari,
  DosyaPortu,
  ErenYollari,
  IsNo,
  IsYollari,
  McpSunucuTanimi,
  Ortam,
  Sureler,
  TelegramAyari,
} from "./sozlesme.ts";

export class AyarHatasi extends Error {
  constructor(mesaj: string) {
    super(mesaj);
    this.name = "AyarHatasi";
  }
}

const VARSAYILAN_SURELER: Sureler = {
  kilitYoklamaMs: 5000,
  torunYoklamaMs: 10000,
  isYoklamaMs: 2000,
  ramYoklamaMs: 30000,
  soruZamanAsimiMs: 82800000,
  devirOzetiBeklemeMs: 120000,
  deltaTamponMs: 80,
  bildirimAckMs: 30000,
  komutPayiMs: 15000,
  erenYenidenBaslatmaMs: 30000,
};

const VARSAYILAN_WS_PORT = 47821;
const VARSAYILAN_EREN_MODELI = "opus";
const VARSAYILAN_TELEFON_IS_MODELI = "opus";
const VARSAYILAN_RAM_DUSUK_MB = 2048;
const VARSAYILAN_EREN_CANLI_AZAMI = 2;
const VARSAYILAN_EREN_BOSTA_KAPAT_DK = 30;
/** Ad verilmediyse güvenlik metninde kullanılan genel sözcük: kişisel değil, güvenliği gevşetmez. */
const VARSAYILAN_KULLANICI_ADI = "kullanıcı";
/** Kullanıcıya görünen ve persona metinlerine giren asistan adı; kodda sabit kişilik yok. */
const ASISTAN_ADI_ORTAMI = "EREN_KIT_ASSISTANT_NAME";
const VARSAYILAN_ASISTAN_ADI = "Claude";
const ASISTAN_ADI_SINIRI = 40;
const MIB = 1024 * 1024;
/**
 * `ajanda_ek_kota_mb`: ek yedeğine (`ajanda-ekler.ts`) ayrılan alan, MiB, tam sayı. Alt sınır bir kaydın
 * bütün eklerinin (`EK_ADET` × `EK_BAYT` = 32 MiB) iki katı; üst sınır 1 TiB. Varsayılan `EK_TOPLAM_BAYT`.
 */
const EK_KOTA_MB_EN_AZ = 64;
const EK_KOTA_MB_EN_COK = 1_048_576;

/**
 * PC iş ortamının (tam ve hafif) kapatma anahtarları. Ölçüm (2026-11-09, boş cwd, tam profil): `isler-komut.ts`
 * yasak araç listesi ve `syncClaudeAiSkills:false` ile birlikte ilk istek 44.059 → 33.444, alt agent
 * 25.056 → 18.140; SessionStart hook ek bağlamı bayt bayt korundu.
 * `CLAUDE_CODE_DISABLE_ATTACHMENTS` bilerek yok: skill ve ertelenmiş araç listesini de keser.
 */
const PC_IS_KAPATMA_ANAHTARLARI: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
  CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1",
};

/** Ana sohbet ve telefon işi: PC anahtarları + `ATTACHMENTS` (bu oturumlar skill/hook kullanmaz). */
const KAPATMA_ANAHTARLARI: Readonly<Record<string, string>> = {
  ...PC_IS_KAPATMA_ANAHTARLARI,
  CLAUDE_CODE_DISABLE_ATTACHMENTS: "1",
};

const IZINLI_ANAHTARLAR = new Set([
  "kullanici_adi",
  "ws_port",
  "claude_exe",
  "eren_modeli",
  "pc_is_modeli",
  "telefon_is_modeli",
  "ram_dusuk_mb",
  "eren_canli_azami",
  "eren_bosta_kapat_dk",
  "tam_yetki",
  "telegram",
  "computer_use",
  "rea",
  "ajanda_ek_kota_mb",
]);

const nesneMi = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const bosMetinDegil = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";

/**
 * Gösterilecek asistan adı; packages/bellek `asistan.py` ile aynı kural: yazdırılamaz karakterler
 * (Python `str.isprintable` karşılığı: C* ve boşluk dışı Z*) atılır, boşluklar teklenir,
 * en çok 40 karakter, sonuç boşsa "Claude".
 */
export function asistanAdiUret(ham: string | undefined): string {
  let temiz = "";
  for (const c of ham ?? "") {
    if (c === " " || !/[\p{C}\p{Z}]/u.test(c)) temiz += c;
  }
  const ad = temiz.split(" ").filter((p) => p !== "").join(" ");
  if (ad === "") return VARSAYILAN_ASISTAN_ADI;
  return [...ad].slice(0, ASISTAN_ADI_SINIRI).join("").trimEnd();
}

function claudeSil(ortam: Ortam): Record<string, string> {
  const cikti: Record<string, string> = {};
  for (const [k, v] of Object.entries(ortam)) {
    const b = k.toUpperCase();
    if (b.startsWith("CLAUDE") || b.startsWith("ANTHROPIC")) continue;
    cikti[k] = v;
  }
  return cikti;
}

function metinAlani(o: Record<string, unknown>, ad: string): string | undefined {
  const v = o[ad];
  if (v === undefined) return undefined;
  if (!bosMetinDegil(v)) throw new AyarHatasi(`ayar.local.json: ${ad} boş olmayan metin olmalı`);
  return v;
}

function modelAlani(o: Record<string, unknown>, ad: string): string | undefined {
  const v = o[ad];
  if (v === undefined) return undefined;
  // Boş ya da "-" ile başlayan değer komut satırına bayrak olarak karışabilir.
  if (!bosMetinDegil(v) || v.startsWith("-")) throw new AyarHatasi(`ayar.local.json: ${ad} geçerli bir model adı olmalı`);
  return v;
}

function tamSayiAlani(o: Record<string, unknown>, ad: string, en: number, enCok: number): number | undefined {
  const v = o[ad];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < en || v > enCok) {
    throw new AyarHatasi(`ayar.local.json: ${ad} ${en}-${enCok} arasında tam sayı olmalı`);
  }
  return v;
}

function mantikAlani(o: Record<string, unknown>, ad: string): boolean | undefined {
  const v = o[ad];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new AyarHatasi(`ayar.local.json: ${ad} true ya da false olmalı`);
  return v;
}

function mcpTanimi(o: Record<string, unknown>, ad: string): McpSunucuTanimi | null {
  const v = o[ad];
  if (v === undefined) return null;
  if (!nesneMi(v)) throw new AyarHatasi(`ayar.local.json: ${ad} nesne olmalı`);
  for (const k of Object.keys(v)) {
    if (k !== "command" && k !== "args" && k !== "env") throw new AyarHatasi(`ayar.local.json: ${ad}.${k} bilinmeyen alan`);
  }
  if (!bosMetinDegil(v["command"])) throw new AyarHatasi(`ayar.local.json: ${ad}.command boş olmayan metin olmalı`);
  const args = v["args"];
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
    throw new AyarHatasi(`ayar.local.json: ${ad}.args metin dizisi olmalı`);
  }
  const tanim: { command: string; args: readonly string[]; env?: Ortam } = {
    command: v["command"],
    args: [...(args as string[])],
  };
  const env = v["env"];
  if (env !== undefined) {
    if (!nesneMi(env) || !Object.values(env).every((x) => typeof x === "string")) {
      throw new AyarHatasi(`ayar.local.json: ${ad}.env metin değerli nesne olmalı`);
    }
    tanim.env = { ...(env as Record<string, string>) };
  }
  return tanim;
}

function telegramTanimi(o: Record<string, unknown>): TelegramAyari | null {
  const v = o["telegram"];
  if (v === undefined) return null;
  // Değerler hata metnine girmez: yalnız alan adı.
  if (!nesneMi(v)) throw new AyarHatasi("ayar.local.json: telegram nesne olmalı");
  for (const k of Object.keys(v)) {
    if (k !== "jeton" && k !== "sohbet_id") throw new AyarHatasi("ayar.local.json: telegram içinde bilinmeyen alan");
  }
  const jeton = v["jeton"];
  const sohbet = v["sohbet_id"];
  if (!bosMetinDegil(jeton)) throw new AyarHatasi("ayar.local.json: telegram.jeton boş olmayan metin olmalı");
  let sohbetId: string;
  if (bosMetinDegil(sohbet)) sohbetId = sohbet;
  else if (typeof sohbet === "number" && Number.isSafeInteger(sohbet)) sohbetId = String(sohbet);
  else throw new AyarHatasi("ayar.local.json: telegram.sohbet_id metin ya da tam sayı olmalı");
  return { jeton, sohbetId };
}

async function yerelAyarOku(dosya: DosyaPortu, yol: string): Promise<Record<string, unknown>> {
  const ham = await dosya.oku(yol);
  if (ham === null) return {};
  let j: unknown;
  try {
    j = JSON.parse(ham.replace(/^﻿/, ""));
  } catch {
    throw new AyarHatasi("ayar.local.json: JSON okunamadı");
  }
  if (!nesneMi(j)) throw new AyarHatasi("ayar.local.json: nesne olmalı");
  for (const k of Object.keys(j)) {
    if (!IZINLI_ANAHTARLAR.has(k)) throw new AyarHatasi(`ayar.local.json: ${k} bilinmeyen alan`);
  }
  return j;
}

async function claudeExeBul(
  dosya: DosyaPortu,
  ortam: Ortam,
  belirtilen: string | undefined,
): Promise<string> {
  const exeMi = (y: string): boolean => y.toLowerCase().endsWith(".exe");
  if (belirtilen !== undefined) {
    if (!exeMi(belirtilen)) throw new AyarHatasi("claude_exe .exe olmak zorunda (.cmd/.bat verilemez)");
    if ((await dosya.boyut(belirtilen)) === null) throw new AyarHatasi("claude_exe dosyası yok");
    return belirtilen;
  }
  const path = ortamDegeri(ortam, "PATH");
  if (path !== undefined) {
    for (const ham of path.split(";")) {
      const d = ham.trim().replace(/^"(.*)"$/, "$1");
      if (d === "" || !win32.isAbsolute(d)) continue;
      const aday = win32.join(d, "claude.exe");
      if ((await dosya.boyut(aday)) !== null) return aday;
    }
  }
  const appdata = ortamDegeri(ortam, "APPDATA");
  if (appdata !== undefined && win32.isAbsolute(appdata)) {
    const aday = win32.join(appdata, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if ((await dosya.boyut(aday)) !== null) return aday;
  }
  throw new AyarHatasi("claude.exe bulunamadı (claude_exe, PATH ve npm yolu denendi)");
}

/** kur.ts `SHA_DESENI` ile aynı: kurulumdaki sürüm adı. */
const SURUM_DESENI = /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;

/** `<sürüm>/server/src/ayar.ts` -> `<sürüm>/surum.json`. Yok, bozuk ya da desene uymuyorsa `null`. */
async function surumOku(dosya: DosyaPortu): Promise<string | null> {
  try {
    const yol = win32.normalize(fileURLToPath(new URL("../../surum.json", import.meta.url)));
    const ham = await dosya.oku(yol);
    if (ham === null) return null;
    const j: unknown = JSON.parse(ham.replace(/^﻿/, ""));
    if (!nesneMi(j)) return null;
    const sha = j["sha"];
    return typeof sha === "string" && SURUM_DESENI.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export function yollariUret(ortam: Ortam): ErenYollari {
  const la = ortamDegeri(ortam, "LOCALAPPDATA");
  if (la === undefined || !win32.isAbsolute(la)) {
    throw new AyarHatasi("LOCALAPPDATA tanımlı ve mutlak yol olmalı");
  }
  const up = ortamDegeri(ortam, "USERPROFILE");
  if (up === undefined || !win32.isAbsolute(up)) {
    throw new AyarHatasi("USERPROFILE tanımlı ve mutlak yol olmalı");
  }
  // Kök kuralı tek yerde (`veri-koku.ts`): bekçi günlüğü ve e2e de aynısını kullanır.
  const veriKoku = veriKokuCoz(ortam);
  if (!veriKoku.ok) {
    throw new AyarHatasi(
      veriKoku.hata === "ozel_kok_goreli" ? `${VERI_KOKU_ORTAMI} mutlak yol olmalı` : "LOCALAPPDATA tanımlı ve mutlak yol olmalı",
    );
  }
  const kok = veriKoku.kok;
  return {
    kok,
    vt: win32.join(kok, "eren.db"),
    log: win32.join(kok, "logs", "servis.log"),
    islerDizini: win32.join(kok, "isler"),
    erenCwd: win32.join(kok, "eren-cwd"),
    erenMcpDizini: win32.join(kok, "eren-mcp"),
    anahtar: win32.join(kok, "sunucu-anahtar.pem"),
    kimlikEki: win32.join(kok, "kimlik.local.md"),
    projeler: win32.join(kok, "projeler.json"),
    yerelAyar: win32.join(kok, "ayar.local.json"),
    limitKilit: win32.join(la, "ClaudeLimitKilit", "kilit.json"),
    claudeProjeleri: win32.join(up, ".claude", "projects"),
  };
}

/**
 * Sözleşmedeki `Ayar`'a ek, yalnız `ana`'nın okuduğu servis ayarları. `Ayar`'ın kendisi değişmez (sözleşme
 * dosyası bu dilimin dışında): `ayarKur` bunu döner ve hâlâ bir `AyarFabrikasi`'dir.
 */
export interface ServisEkAyari {
  /** Ek yedeği kotası, bayt (`ajanda_ek_kota_mb` × 1 MiB; yoksa `EK_TOPLAM_BAYT`). */
  readonly ajandaEkKotaBayt: number;
}

export const ayarKur = (async (b: AyarBagimliliklari): Promise<Ayar & ServisEkAyari> => {
  const yollar = yollariUret(b.ortam);
  const yerel = await yerelAyarOku(b.dosya, yollar.yerelAyar);

  const kullaniciAdi = metinAlani(yerel, "kullanici_adi") ?? VARSAYILAN_KULLANICI_ADI;
  const asistanAdi = asistanAdiUret(ortamDegeri(b.ortam, ASISTAN_ADI_ORTAMI));
  const wsPort = tamSayiAlani(yerel, "ws_port", 1, 65535) ?? VARSAYILAN_WS_PORT;
  const ramDusukMb = tamSayiAlani(yerel, "ram_dusuk_mb", 0, 10_000_000) ?? VARSAYILAN_RAM_DUSUK_MB;
  const erenCanliAzami = tamSayiAlani(yerel, "eren_canli_azami", 1, 4) ?? VARSAYILAN_EREN_CANLI_AZAMI;
  const erenBostaKapatDk = tamSayiAlani(yerel, "eren_bosta_kapat_dk", 1, 1440) ?? VARSAYILAN_EREN_BOSTA_KAPAT_DK;
  const ekKotaMb = tamSayiAlani(yerel, "ajanda_ek_kota_mb", EK_KOTA_MB_EN_AZ, EK_KOTA_MB_EN_COK);
  const erenModeli = modelAlani(yerel, "eren_modeli") ?? VARSAYILAN_EREN_MODELI;
  const pcIsModeli = modelAlani(yerel, "pc_is_modeli") ?? null;
  const telefonIsModeli = modelAlani(yerel, "telefon_is_modeli") ?? VARSAYILAN_TELEFON_IS_MODELI;
  const tamYetki = mantikAlani(yerel, "tam_yetki") ?? true;
  const computerUse = mcpTanimi(yerel, "computer_use");
  const rea = mcpTanimi(yerel, "rea");
  const telegram = telegramTanimi(yerel);
  const claudeExe = await claudeExeBul(b.dosya, b.ortam, metinAlani(yerel, "claude_exe"));

  if (!bosMetinDegil(b.execPath)) throw new AyarHatasi("execPath boş olamaz");

  const ortamKopyasi: Ortam = { ...b.ortam };
  const kopruBetigi = win32.normalize(fileURLToPath(new URL("./kopru.ts", import.meta.url)));
  const sureler: Sureler = { ...VARSAYILAN_SURELER };
  const servis: ServisBilgisi = Object.freeze({ surum: await surumOku(b.dosya), baslangic_ms: b.baslangicMs });

  const kapatmali = (): Ortam => ({ ...claudeSil(ortamKopyasi), ...KAPATMA_ANAHTARLARI });

  return {
    yollar,
    servis,
    isYollari(is_id: IsNo): IsYollari {
      if (!Number.isSafeInteger(is_id) || is_id < 1) throw new AyarHatasi("is_id pozitif tam sayı olmalı");
      const dizin = win32.join(yollar.islerDizini, String(is_id));
      return {
        dizin,
        gorev: win32.join(dizin, "gorev.txt"),
        mcp: win32.join(dizin, "mcp.json"),
        out: win32.join(dizin, "out.jsonl"),
        err: win32.join(dizin, "err.txt"),
        bosCwd: win32.join(dizin, "cwd"),
      };
    },
    claudeExe,
    nodeExe: b.execPath,
    kopruBetigi,
    erenMcpYolu(nesil: number): string {
      if (!Number.isSafeInteger(nesil) || nesil < 1) throw new AyarHatasi("nesil pozitif tam sayı olmalı");
      return win32.join(yollar.erenMcpDizini, `${nesil}.json`);
    },
    erenModeli,
    erenCanliAzami,
    erenBostaKapatMs: erenBostaKapatDk * 60000,
    pcIsModeli,
    telefonIsModeli,
    wsPort,
    ramDusukMb,
    sureler: Object.freeze(sureler),
    kullaniciAdi,
    asistanAdi,
    tamYetki,
    computerUse,
    mcpProfilSunucusu(profil: McpProfili): McpSunucuTanimi | null {
      return profil === "rea" ? rea : null;
    },
    erenOrtami: kapatmali,
    telefonIsOrtami: kapatmali,
    // `tam` profil kullanıcı ayarlarını (kancalar dahil) yükler: işaret, PC ajanda kancasının bu oturumda
    // hiçbir şey yapmamasını sağlar (AJANDA.md "PC oturumları", "Servisin kendi oturumları").
    pcIsOrtami: () => ({ ...claudeSil(ortamKopyasi), ...PC_IS_KAPATMA_ANAHTARLARI, [PC_SERVIS_OTURUMU_ORTAMI]: "1" }),
    async kimlikEki(): Promise<string> {
      return (await b.dosya.oku(yollar.kimlikEki)) ?? "";
    },
    async projeler() {
      // Bozuk dosya: boş liste. Sözleşmede günlük bağımlılığı yok, bkz. rapor.
      try {
        const ham = await b.dosya.oku(yollar.projeler);
        if (ham === null) return { projeler: [] };
        const r = ProjelerCikti.safeParse(JSON.parse(ham.replace(/^﻿/, "")));
        return r.success ? r.data : { projeler: [] };
      } catch {
        return { projeler: [] };
      }
    },
    async telegram(): Promise<TelegramAyari | null> {
      return telegram === null ? null : { ...telegram };
    },
    ajandaEkKotaBayt: ekKotaMb === undefined ? AJANDA_SINIRLARI.EK_TOPLAM_BAYT : ekKotaMb * MIB,
  };
}) satisfies AyarFabrikasi;
