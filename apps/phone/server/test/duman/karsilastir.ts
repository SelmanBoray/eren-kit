/**
 * Duman koşusunun karşılaştırma adımı: gerçek `claude` süreçlerinin kaydı (`DumanKaydi`) ↔ H4.0 altın
 * kayıtları (`test/altin/claude-*.json`).
 *
 *   node --disable-warning=ExperimentalWarning test/duman/karsilastir.ts <kayit.json>     karşılaştır
 *   node --disable-warning=ExperimentalWarning test/duman/karsilastir.ts --oz-sinama      sahte kayıtla sına
 *   node --disable-warning=ExperimentalWarning test/duman/karsilastir.ts --alanlar        ayrılan alanlar
 *
 * Yöntem: iki taraf da aynı "karşılaştırma uzayına" çevrilir, sonra yapı yapı (anahtar sırası dahil)
 * karşılaştırılır. Gerçek taraf önce gerçek değer → altının sahte değeri eşlemesinden geçer (geçici kök →
 * `C:\ornek\Yerel\eren-kit`...), sonra H4.0'ın kendi normalleştirmesinden (`altin-kayit.ts` `normallestir`:
 * `<server>`, `YerTutucular` ile ilk görülme sırasıyla `<uuid:N>`, `<opak:kes:N>`). Son olarak iki tarafa da
 * aynı kurallar uygulanır: `AYRILAN_ALANLAR` (sahte süreçten gelen, gerçekte farklı olması beklenen alanlar).
 * Ayrılan her alanın kendi denetimi vardır (gönderilen metin, ortamda silinen anahtar yok...); hiçbiri
 * sessizce yutulmaz.
 *
 * Altın taraf: `baslatma.yeni_takvim` (servis ajandayı hep kurar; medya, computer-use, kimlik eki ve asistan
 * adı düzenekte kapalı), `konusma.kesme` (takvimli insan satırı ve kesme), `konusma.sentetik_ve_birlesik`
 * (sentetik satırın biçimi), `isler.pc_hafif`. Uzun metinler (`<metin:N>`) `uzun_metinler`'den açılır: sistem
 * istemi ve JSON şeması bayt bayt karşılaştırılır.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { altinOku, bicimle, jsonKaydi, normallestir, SERVER_DIZINI, YerTutucular } from "../altin-kayit.ts";
import { BIN, NODE_EXE, YEREL } from "../altin-duzen.ts";
import type { DumanKaydi, SurecKaydi } from "./tipler.ts";
import { DUMAN_KAYIT_SURUMU } from "./tipler.ts";

// ---------------------------------------------------------------------------------------------
// Altının sahte değerleri (altin-duzen.ts, surucu-altin.test.ts)
// ---------------------------------------------------------------------------------------------

const ALTIN_VERI_KOKU = `${YEREL}\\eren-kit`;
/** `surucu-altin.test.ts` `pcPlan` (dışa verilmiyor; test dosyası içe aktarılırsa testleri koşar). */
const ALTIN_PROJE = "C:\\ornek\\proje";
const ALTIN_GOREV_METNI = "Ornek gorev metni, cok satirli\nikinci satir ş ğ ü.";
const ALTIN_CLAUDE = `${BIN}\\claude.exe`;
const CU_SUNUCUSU = "computer-use-windows";

/** Sahte süreçten gelen ve gerçekte farklı olması beklenen alanlar: neden ayrıldı, yerine ne denetlenir. */
export const AYRILAN_ALANLAR: ReadonlyArray<{ alan: string; neden: string; kural: string }> = [
  {
    alan: "yollar (veri kökü, LOCALAPPDATA, iş cwd'si, claude_exe, node.exe, server dizini)",
    neden: "Altın sahte dosya sistemiyle (`C:\\ornek\\...`) alındı; duman geçici kökte, claude_exe başlatıcıdır.",
    kural: "Gerçek değer altının sahte değerine eşlenir (uzundan kısaya); eşlenemeyen yol fark olarak görünür.",
  },
  {
    alan: "--session-id, kesme request_id",
    neden: "Altında sahte rastgele port (belirli değerler); gerçekte randomUUID ve opakId('kes').",
    kural: "H4.0 YerTutucular: ilk görülme sırasıyla <uuid:N>, <opak:kes:N>. Biçim (uuid, kes öneki) ayrıca denetlenir.",
  },
  {
    alan: "mcp env EREN_KOPRU_JETON",
    neden: "Altında testin köprü taklidi `jeton-<rol>-N` üretir; gerçekte 32 bayt base64url.",
    kural: "İki tarafta da <jeton>; gerçek jetonun boş olmadığı ve sunucular arasında farklı olduğu denetlenir.",
  },
  {
    alan: "--model değeri",
    neden: "Altın varsayılan `opus` (ana) ve sabit `sonnet` (hafif iş); duman ayarı `eren_modeli: haiku`, kaydedici gerçek sürece `haiku` verir.",
    kural: "İki tarafta da <model>; bayrağın yeri ve varlığı karşılaştırılır. Servis argv'si ile gerçek argv'deki modeller rapora yazılır.",
  },
  {
    alan: "damga [mesaj_ani: ...]",
    neden: "Altında sahte saat (2026-11-25 12:00); gerçekte koşu anı.",
    kural: "[mesaj_ani: <damga>]; damganın biçimi (tarih, gün, saat, dilim) düzenli ifadeyle denetlenir.",
  },
  {
    alan: "insan satırının metni",
    neden: "Altında `Uzun bir şey anlat.`; dumanda ilk mesaj başka metin.",
    kural: "<metin>; metinler düzeneğin gönderdiğiyle sırasıyla eşit olmalı.",
  },
  {
    alan: "sentetik satırın metni",
    neden: "İş numarası ve sonucu koşunun kendisinden gelir (altında iş 7, plan_1).",
    kural: "<metin>; biçim (anahtarlar, sıra, isSynthetic) karşılaştırılır, metin rapora yazılır.",
  },
  {
    alan: "ortam (anahtar sırası ve CLAUDE/ANTHROPIC dışı değerler)",
    neden: "Altında sahte ortam; gerçekte makine ortamı ve libuv ortam bloğunu sıralar (sıra süreçten görünmez).",
    kural: "Yalnız CLAUDE*/ANTHROPIC* ve EREN_KIT_SERVIS_OTURUMU anahtarları, adına göre sıralı, değerleriyle karşılaştırılır.",
  },
  {
    alan: "PC işi: -p metni ve gorev.txt'nin görev kısmı",
    neden: "Altın planı başka metinle; dumanda kısa ve kişisel veri içermeyen görev.",
    kural: "Baştaki görev metni <gorev_metni> olur; servisin eklediği sonek bayt bayt karşılaştırılır.",
  },
  {
    alan: "PC işi: mcp.json'daki computer-use-windows",
    neden: "Altında `islerDuzeni` computer-use'u varsayılan açar; duman ayarında computer_use yok (sahte exe başlatılamaz).",
    kural: "Altın beklentisinden bu sunucu çıkarılır; geri kalan yapı bayt bayt.",
  },
  {
    alan: "stdout, pid, outYol/errYol",
    neden: "Altında stdout testin girdisidir; pid sahte; out/err dosya tanıtıcısı süreç düzeyinde görünmez.",
    kural: "Karşılaştırılmaz; stdout `gozlemle` ile davranış denetimine girer (init, köprüler, sonuçlar).",
  },
];

// ---------------------------------------------------------------------------------------------
// Fark
// ---------------------------------------------------------------------------------------------

export interface Fark {
  yol: string;
  beklenen: string;
  gercek: string;
}

const kisa = (v: unknown): string => {
  const s = v === undefined ? "<yok>" : JSON.stringify(v);
  return s.length <= 160 ? s : `${s.slice(0, 157)}...`;
};

function dizgeFarki(yol: string, b: string, g: string, cikti: Fark[]): void {
  let i = 0;
  while (i < b.length && i < g.length && b[i] === g[i]) i++;
  const bas = Math.max(0, i - 30);
  cikti.push({ yol: `${yol} (ilk fark ${i}. karakterde)`, beklenen: kisa(b.slice(bas, i + 60)), gercek: kisa(g.slice(bas, i + 60)) });
}

/** Yapı yapı karşılaştırma; nesnelerde anahtar sırası da (bayt bayt JSON). */
export function farkBul(yol: string, beklenen: unknown, gercek: unknown, cikti: Fark[] = []): Fark[] {
  if (typeof beklenen === "string" && typeof gercek === "string") {
    if (beklenen !== gercek) dizgeFarki(yol, beklenen, gercek, cikti);
    return cikti;
  }
  if (Array.isArray(beklenen) && Array.isArray(gercek)) {
    const n = Math.max(beklenen.length, gercek.length);
    for (let i = 0; i < n; i++) farkBul(`${yol}[${i}]`, beklenen[i], gercek[i], cikti);
    return cikti;
  }
  const nesne = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
  if (nesne(beklenen) && nesne(gercek)) {
    const bk = Object.keys(beklenen);
    const gk = Object.keys(gercek);
    const ortak = bk.filter((k) => gk.includes(k));
    const gOrtak = gk.filter((k) => bk.includes(k));
    if (ortak.join("\u0000") !== gOrtak.join("\u0000")) cikti.push({ yol: `${yol} (anahtar sırası)`, beklenen: kisa(bk), gercek: kisa(gk) });
    for (const k of [...bk, ...gk.filter((x) => !bk.includes(x))]) farkBul(`${yol}.${k}`, beklenen[k], gercek[k], cikti);
    return cikti;
  }
  if (JSON.stringify(beklenen) !== JSON.stringify(gercek)) cikti.push({ yol, beklenen: kisa(beklenen), gercek: kisa(gercek) });
  return cikti;
}

// ---------------------------------------------------------------------------------------------
// Ortak karşılaştırma uzayı (iki tarafa da)
// ---------------------------------------------------------------------------------------------

const DAMGA = /^\[mesaj_ani: (\d{4}-\d\d-\d\d) (\S+) (\d\d:\d\d) ([^\]]+)\]\n/;
const YER = { model: "<model>", jeton: "<jeton>", damga: "[mesaj_ani: <damga>]\n", metin: "<metin>", gorev: "<gorev_metni>" };

/** argv: `--model` değeri; `-p` görevinin baştaki plan metni. */
function argvUzayi(argv: readonly unknown[], gorevMetni: string | null): unknown[] {
  return argv.map((a, i) => {
    if (i > 0 && argv[i - 1] === "--model") return YER.model;
    if (i === 1 && argv[0] === "-p" && gorevMetni !== null && typeof a === "string" && a.startsWith(gorevMetni)) {
      return YER.gorev + a.slice(gorevMetni.length);
    }
    return a;
  });
}

/** mcp yapılandırması: köprü jetonu. */
function mcpUzayi(icerik: unknown): unknown {
  const kopya = JSON.parse(JSON.stringify(icerik ?? null)) as { mcpServers?: Record<string, { env?: Record<string, unknown> }> } | null;
  for (const s of Object.values(kopya?.mcpServers ?? {})) {
    if (s?.env !== undefined && typeof s.env["EREN_KOPRU_JETON"] === "string") s.env["EREN_KOPRU_JETON"] = YER.jeton;
  }
  return kopya;
}

/** Ortam: yalnız Claude'a özgü ve servis işareti anahtarları, ada göre sıralı. */
function ortamUzayi(anahtarlar: readonly string[], deger: (a: string) => string | undefined): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  for (const a of [...anahtarlar].filter((x) => /^(claude|anthropic)/i.test(x) || x === "EREN_KIT_SERVIS_OTURUMU").sort()) o[a] = deger(a);
  return o;
}

type SatirTuru = "insan" | "sentetik" | "kesme" | "diger";

interface SatirUzayi {
  tur: SatirTuru;
  satir: unknown;
  /** Damgadan sonraki metin (insan ve sentetik). */
  metin: string | null;
  damga: string | null;
}

function satirUzayi(kayit: unknown): SatirUzayi {
  const o = JSON.parse(JSON.stringify(kayit)) as Record<string, unknown>;
  if (o["type"] === "control_request") return { tur: "kesme", satir: o, metin: null, damga: null };
  const mesaj = o["message"] as { content?: unknown } | undefined;
  if (o["type"] === "user" && mesaj !== undefined && typeof mesaj.content === "string") {
    const m = DAMGA.exec(mesaj.content);
    const damga = m === null ? null : m[0];
    const metin = m === null ? mesaj.content : mesaj.content.slice(m[0].length);
    mesaj.content = (m === null ? "" : YER.damga) + YER.metin;
    const tur: SatirTuru = o["isSynthetic"] === true ? "sentetik" : (o["origin"] as { kind?: unknown } | undefined)?.kind === "human" ? "insan" : "diger";
    return { tur, satir: o, metin, damga };
  }
  return { tur: "diger", satir: o, metin: null, damga: null };
}

// ---------------------------------------------------------------------------------------------
// Altın taraf
// ---------------------------------------------------------------------------------------------

interface Beklenen {
  ana: { exe: unknown; argv: unknown[]; cwd: unknown; ortam: unknown; mcp: unknown };
  insan: unknown;
  sentetik: unknown;
  kesme: unknown;
  is: { exe: unknown; argv: unknown[]; cwd: unknown; ortam: unknown; mcp: unknown; gorev_txt: unknown };
}

const izStdin = (iz: unknown[]): unknown[] =>
  (iz as unknown[][]).filter((e) => Array.isArray(e) && e[0] === "stdin").map((e) => e[2]);

function metinAc(argv: readonly unknown[], tablo: Record<string, unknown>): unknown[] {
  return argv.map((a) => (typeof a === "string" && /^<metin:\d+>$/.test(a) ? tablo[a] : a));
}

export function beklenenKur(): Beklenen {
  const b = altinOku("baslatma");
  const k = altinOku("konusma");
  const i = altinOku("isler");
  const yt = b["yeni_takvim"] as { baslatma: { exe: string; argv: string[]; cwd: string; ortam: Record<string, string> }; mcp: unknown };
  const bUzun = b["uzun_metinler"] as Record<string, unknown>;
  const kesmeStdin = izStdin((k["kesme"] as { iz: unknown[] }).iz);
  const sentetikStdin = izStdin((k["sentetik_ve_birlesik"] as { iz: unknown[] }).iz);
  const ph = i["pc_hafif"] as {
    istek: { exe: string; argv: string[]; cwd: string; ortam: Record<string, string> };
    mcp_json: { mcpServers: Record<string, unknown> };
    gorev_txt: string;
  };
  const iUzun = i["uzun_metinler"] as Record<string, unknown>;
  const isMcp = JSON.parse(JSON.stringify(ph.mcp_json)) as { mcpServers: Record<string, unknown> };
  delete isMcp.mcpServers[CU_SUNUCUSU];
  const insan = kesmeStdin.map(satirUzayi).find((s) => s.tur === "insan");
  const kesme = kesmeStdin.map(satirUzayi).find((s) => s.tur === "kesme");
  const sentetik = sentetikStdin.map(satirUzayi).find((s) => s.tur === "sentetik");
  if (insan === undefined || kesme === undefined || sentetik === undefined) throw new Error("altın: beklenen stdin satırı yok");
  return {
    ana: {
      exe: yt.baslatma.exe,
      argv: argvUzayi(metinAc(yt.baslatma.argv, bUzun), null),
      cwd: yt.baslatma.cwd,
      ortam: ortamUzayi(Object.keys(yt.baslatma.ortam), (a) => yt.baslatma.ortam[a]),
      mcp: { yol: (yt.mcp as { yol: unknown }).yol, icerik: mcpUzayi((yt.mcp as { icerik: unknown }).icerik) },
    },
    insan: insan.satir,
    sentetik: sentetik.satir,
    kesme: kesme.satir,
    is: {
      exe: ph.istek.exe,
      argv: argvUzayi(metinAc(ph.istek.argv, iUzun), ALTIN_GOREV_METNI),
      cwd: ph.istek.cwd,
      ortam: ortamUzayi(Object.keys(ph.istek.ortam), (a) => ph.istek.ortam[a]),
      mcp: isMcp,
      gorev_txt: ph.gorev_txt.startsWith(ALTIN_GOREV_METNI) ? YER.gorev + ph.gorev_txt.slice(ALTIN_GOREV_METNI.length) : ph.gorev_txt,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Gerçek taraf
// ---------------------------------------------------------------------------------------------

const kacisla = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Gerçek yol → altın yolu (büyük küçük harf duyarsız, uzundan kısaya; `/` ayraçlı hali de). */
function yolEsleyici(k: DumanKaydi): (s: string) => string {
  const ciftler: Array<[string, string]> = [
    [k.esleme.veriKoku, ALTIN_VERI_KOKU],
    [k.esleme.proje, ALTIN_PROJE],
    [k.esleme.claudeExe, ALTIN_CLAUDE],
    [k.esleme.localAppData, YEREL],
    [k.esleme.nodeExe, NODE_EXE],
  ];
  const kurallar = ciftler
    .filter(([a]) => a !== "")
    .flatMap(([a, b]): Array<[string, string]> => [[a, b], [a.replaceAll("\\", "/"), b.replaceAll("\\", "/")]])
    .sort((x, y) => y[0].length - x[0].length)
    .map(([a, b]) => [new RegExp(kacisla(a), "gi"), b] as const);
  return (s) => kurallar.reduce((m, [re, b]) => m.replace(re, () => b), s);
}

function derinEsle(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => derinEsle(x, f));
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [a, d] of Object.entries(v)) o[f(a)] = derinEsle(d, f);
    return o;
  }
  return v;
}

const anaMi = (s: SurecKaydi): boolean => s.argv.includes("--input-format");
const isMi = (s: SurecKaydi): boolean => s.argv[0] === "-p" && !s.argv.includes("--input-format");
const degerAl = (argv: readonly string[], bayrak: string): string | null => {
  const i = argv.indexOf(bayrak);
  return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
};

export interface Sonuc {
  farklar: Fark[];
  /** Ayrılan alanların ayrı denetimleri ve bilgi satırları. */
  denetimler: Array<{ ad: string; gecti: boolean; detay: string }>;
  bilgiler: string[];
}

export function karsilastir(k: DumanKaydi, beklenen: Beklenen = beklenenKur()): Sonuc {
  const farklar: Fark[] = [];
  const denetimler: Sonuc["denetimler"] = [];
  const bilgiler: string[] = [];
  const denet = (ad: string, gecti: boolean, detay = ""): void => {
    denetimler.push({ ad, gecti, detay });
  };
  if (k.surum !== DUMAN_KAYIT_SURUMU) denet("kayıt sürümü", false, String(k.surum));
  const esle = yolEsleyici(k);

  const anaSurecler = k.surecler.filter(anaMi);
  const isSurecleri = k.surecler.filter(isMi);
  denet("tek ana oturum süreci", anaSurecler.length === 1, `${anaSurecler.length} süreç`);
  denet("tek PC iş süreci", isSurecleri.length === 1, `${isSurecleri.length} süreç`);
  const diger = k.surecler.filter((s) => !anaMi(s) && !isMi(s));
  if (diger.length > 0) bilgiler.push(`sınıflanmamış süreç: ${diger.length} (${diger.map((s) => s.argv.slice(0, 3).join(" ")).join(" | ")})`);

  // --- ana oturum: başlatma
  const ana = anaSurecler[0];
  if (ana !== undefined) {
    const yt = new YerTutucular();
    const oturum = degerAl(ana.argv, "--session-id");
    if (oturum !== null) yt.ad(oturum, "uuid");
    denet("ana: --session-id uuid biçiminde", oturum !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(oturum), String(oturum));
    const mcpHam = ana.mcp?.icerik ?? null;
    const mcpNesne = mcpHam === null ? null : jsonKaydi(mcpHam);
    const jetonlar = Object.values((mcpNesne as { mcpServers?: Record<string, { env?: Record<string, string> }> } | null)?.mcpServers ?? {}).map(
      (s) => s.env?.["EREN_KOPRU_JETON"] ?? "",
    );
    denet("ana: köprü jetonları dolu ve farklı", jetonlar.length > 0 && jetonlar.every((j) => j.length >= 32) && new Set(jetonlar).size === jetonlar.length, `${jetonlar.length} jeton`);
    const gercek = normallestir(
      derinEsle(
        {
          exe: k.esleme.claudeExe,
          argv: argvUzayi(ana.argv, null),
          cwd: ana.cwd,
          ortam: ortamUzayi(ana.ortam.anahtarlar, (a) => ana.ortam.degerler[a]),
          mcp: { yol: ana.mcp?.yol ?? null, icerik: mcpUzayi(mcpNesne) },
        },
        esle,
      ),
      yt,
    );
    farkBul("ana.baslatma", beklenen.ana, gercek, farklar);
    bilgiler.push(`ana model: servis argv ${degerAl(ana.argv, "--model")}, gerçek argv ${degerAl(ana.gercek_argv, "--model")}`);

    // --- ana oturum: stdin
    const satirlar = ana.stdin.map((s) => {
      const u = satirUzayi(normallestir(derinEsle(jsonKaydi(s), esle), yt));
      if (u.tur === "kesme") {
        const r = u.satir as { request_id?: unknown };
        if (typeof r.request_id === "string") {
          denet("kesme: request_id opakId('kes') biçiminde", /^kes[A-Za-z0-9_-]{12}$/.test(r.request_id), r.request_id);
          yt.ad(r.request_id, "opak:kes");
          r.request_id = normallestir(r.request_id, yt);
        }
      }
      return u;
    });
    bilgiler.push(`ana stdin sırası: ${satirlar.map((s) => s.tur).join(" → ") || "(boş)"}`);
    const insanlar = satirlar.filter((s) => s.tur === "insan");
    insanlar.forEach((s, i) => farkBul(`ana.stdin.insan[${i}]`, beklenen.insan, s.satir, farklar));
    satirlar.filter((s) => s.tur === "sentetik").forEach((s, i) => {
      farkBul(`ana.stdin.sentetik[${i}]`, beklenen.sentetik, s.satir, farklar);
      bilgiler.push(`sentetik[${i}] metni: ${kisa(s.metin)}`);
    });
    satirlar.filter((s) => s.tur === "kesme").forEach((s, i) => farkBul(`ana.stdin.kesme[${i}]`, beklenen.kesme, s.satir, farklar));
    satirlar.filter((s) => s.tur === "diger").forEach((s, i) => farkBul(`ana.stdin.diger[${i}]`, "<beklenmeyen satır türü>", s.satir, farklar));
    const metinler = insanlar.map((s) => s.metin);
    denet("insan satırlarının metni gönderilenle aynı", JSON.stringify(metinler) === JSON.stringify([k.gonderilen.mesaj, k.gonderilen.kesme]), kisa(metinler));
    const damgalar = satirlar.filter((s) => s.tur === "insan" || s.tur === "sentetik").map((s) => s.damga);
    denet("damga biçimi", damgalar.length > 0 && damgalar.every((d) => d !== null && DAMGA.test(d)), kisa(damgalar));
    denet("kesme satırı var", satirlar.some((s) => s.tur === "kesme"));
    denet("sentetik iş satırı var", satirlar.some((s) => s.tur === "sentetik"));
  }

  // --- PC hafif iş
  const is = isSurecleri[0];
  if (is !== undefined) {
    const yt = new YerTutucular();
    const oturum = degerAl(is.argv, "--session-id");
    if (oturum !== null) yt.ad(oturum, "uuid");
    const gorevTxt = k.gorev_txt;
    const gercek = normallestir(
      derinEsle(
        {
          exe: k.esleme.claudeExe,
          argv: argvUzayi(is.argv, k.gonderilen.gorev_metni),
          cwd: is.cwd,
          ortam: ortamUzayi(is.ortam.anahtarlar, (a) => is.ortam.degerler[a]),
          mcp: typeof is.mcp?.icerik === "string" ? jsonKaydi(is.mcp.icerik) : null,
          gorev_txt: gorevTxt !== null && gorevTxt.startsWith(k.gonderilen.gorev_metni) ? YER.gorev + gorevTxt.slice(k.gonderilen.gorev_metni.length) : gorevTxt,
        },
        esle,
      ),
      yt,
    );
    farkBul("is", beklenen.is, gercek, farklar);
    denet("iş: -p metni gorev.txt ile aynı", is.argv[1] === gorevTxt, `${is.argv[1]?.length ?? 0} / ${gorevTxt?.length ?? 0} kr`);
    bilgiler.push(`iş model: servis argv ${degerAl(is.argv, "--model")}, gerçek argv ${degerAl(is.gercek_argv, "--model")}`);
  }
  return { farklar, denetimler, bilgiler };
}

// ---------------------------------------------------------------------------------------------
// Davranış gözlemi (stdout; altında karşılığı yok, kör noktanın diğer yarısı)
// ---------------------------------------------------------------------------------------------

const satirlariCoz = (s: SurecKaydi): Array<Record<string, unknown>> =>
  s.stdout.flatMap((x) => {
    try {
      const o: unknown = JSON.parse(x);
      return o !== null && typeof o === "object" ? [o as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });

export function gozlemle(k: DumanKaydi): Sonuc {
  const denetimler: Sonuc["denetimler"] = [];
  const bilgiler: string[] = [];
  const denet = (ad: string, gecti: boolean, detay = ""): void => {
    denetimler.push({ ad, gecti, detay });
  };
  let usd = 0;
  let istek = 0;
  for (const s of k.surecler) {
    const tur = anaMi(s) ? "ana" : isMi(s) ? "iş" : "diğer";
    const ol = satirlariCoz(s);
    const init = ol.find((o) => o["type"] === "system" && o["subtype"] === "init");
    const sonuclar = ol.filter((o) => o["type"] === "result");
    for (const r of sonuclar) usd += typeof r["total_cost_usd"] === "number" ? r["total_cost_usd"] : 0;
    istek += ol.filter((o) => o["type"] === "stream_event" && (o["event"] as { type?: unknown } | undefined)?.type === "message_start").length;
    denet(`${tur}: init geldi, apiKeySource none`, init?.["apiKeySource"] === "none", String(init?.["apiKeySource"] ?? "init yok"));
    const mcp = (init?.["mcp_servers"] ?? []) as Array<{ name?: string; status?: string }>;
    if (tur === "ana") {
      for (const ad of ["eren", "eren-ajanda"]) {
        const d = mcp.find((m) => m.name === ad)?.status;
        denet(`ana: ${ad} köprüsü connected (yönlendirilmiş boru)`, d === "connected", String(d));
      }
      denet("ana: mesaj turu success ile bitti", sonuclar.some((r) => r["subtype"] === "success" && r["is_error"] === false));
      const kesik = sonuclar.find((r) => typeof r["terminal_reason"] === "string" && (r["terminal_reason"] as string).startsWith("aborted"));
      denet("ana: kesilen tur aborted_* ile bitti", kesik !== undefined, String(kesik?.["terminal_reason"] ?? "yok"));
    }
    if (tur === "iş") {
      const r = sonuclar.at(-1);
      denet("iş: result is_error false, structured_output dolu", r?.["is_error"] === false && r?.["structured_output"] != null, String(r?.["subtype"] ?? "result yok"));
      denet("iş: süreç 0 ile çıktı", s.cikis === 0, String(s.cikis));
    }
    bilgiler.push(`${tur} pid ${s.pid}: ${s.stdin.length} stdin, ${s.stdout.length} stdout satırı, ${sonuclar.length} result, çıkış ${s.cikis}`);
  }
  bilgiler.push(`model isteği (message_start, alt ajanlar dahil): ${istek}; total_cost_usd toplamı: ${usd.toFixed(4)}`);
  return { farklar: [], denetimler, bilgiler };
}

export function raporla(baslik: string, s: Sonuc): string {
  const satirlar = [`== ${baslik}`];
  if (s.farklar.length === 0) satirlar.push("altınla: AYNI");
  else {
    satirlar.push(`altınla: FARK (${s.farklar.length})`);
    for (const f of s.farklar) satirlar.push(`  ${f.yol}\n    beklenen: ${f.beklenen}\n    gerçek:   ${f.gercek}`);
  }
  for (const d of s.denetimler) satirlar.push(`  [${d.gecti ? "GECTI" : "KALDI"}] ${d.ad}${d.detay === "" ? "" : ` :: ${d.detay}`}`);
  for (const b of s.bilgiler) satirlar.push(`  bilgi: ${b}`);
  return satirlar.join("\n");
}

export const basarili = (s: Sonuc): boolean => s.farklar.length === 0 && s.denetimler.every((d) => d.gecti);

// ---------------------------------------------------------------------------------------------
// Öz sınama: altından üretilmiş sahte "gerçek" kayıt (gerçek claude yok)
// ---------------------------------------------------------------------------------------------

const SAHTE_KOK = "C:\\Users\\ornek\\AppData\\Local\\Temp\\eren-duman-0123456789ab";

/** Altın kayıtları gerçek bir koşunun kaydı gibi geri çevirir: geçici yollar, rastgele kimlikler, başka model ve saat. */
export function altindanSahteKayit(): DumanKaydi {
  const esleme = {
    veriKoku: `${SAHTE_KOK}\\eren-kit`,
    localAppData: SAHTE_KOK,
    proje: `${SAHTE_KOK}\\proje`,
    claudeExe: `${SAHTE_KOK}\\bin\\claude.exe`,
    nodeExe: "C:\\Program Files\\nodejs\\node.exe",
  };
  const gonderilen = { mesaj: "merhaba", kesme: "Uzun bir şey anlat.", gorev_metni: "Duman gorevi: yalniz tamam yaz." };
  const ters = (s: string, uuid: string): string =>
    s
      .split(ALTIN_VERI_KOKU).join(esleme.veriKoku)
      .split(ALTIN_PROJE).join(esleme.proje)
      .split(ALTIN_CLAUDE).join(esleme.claudeExe)
      .split(NODE_EXE).join(esleme.nodeExe)
      .split(YEREL).join(esleme.localAppData)
      .split("<server>").join(SERVER_DIZINI)
      .split("<uuid:1>").join(uuid);
  const b = altinOku("baslatma");
  const i = altinOku("isler");
  const k = altinOku("konusma");
  const yt = b["yeni_takvim"] as { baslatma: { argv: string[]; cwd: string; ortam: Record<string, string> }; mcp: { yol: string; icerik: unknown } };
  const anaUuid = randomUUID();
  const anaArgv = metinAc(yt.baslatma.argv, b["uzun_metinler"] as Record<string, unknown>).map((a, n, d) =>
    n > 0 && d[n - 1] === "--model" ? "haiku" : ters(String(a), anaUuid),
  );
  const mcp = derinEsle(yt.mcp.icerik, (s) => ters(s, anaUuid)) as { mcpServers: Record<string, { env: Record<string, string> }> };
  for (const s of Object.values(mcp.mcpServers)) s.env["EREN_KOPRU_JETON"] = Buffer.from(randomUUID() + randomUUID()).toString("base64url");
  const ortamKur = (gercek: Record<string, string>): SurecKaydi["ortam"] => {
    const degerler: Record<string, string> = { EREN_KIT_DATA_DIR: esleme.veriKoku };
    for (const [a, d] of Object.entries(gercek)) if (/^(claude|anthropic|eren_)/i.test(a)) degerler[a] = d;
    return { anahtarlar: ["ALLUSERSPROFILE", "EREN_KIT_DATA_DIR", "LOCALAPPDATA", "Path", "SystemRoot", ...Object.keys(degerler).filter((a) => a !== "EREN_KIT_DATA_DIR")].sort(), degerler };
  };
  const damgali = (metin: string): string => `[mesaj_ani: 2026-11-28 Cumartesi 14:03 Europe/Istanbul]\n${metin}`;
  const kesmeStdin = izStdin((k["kesme"] as { iz: unknown[] }).iz) as Array<Record<string, unknown>>;
  const sentetikStdin = izStdin((k["sentetik_ve_birlesik"] as { iz: unknown[] }).iz) as Array<Record<string, unknown>>;
  const insanSablon = kesmeStdin.find((o) => o["type"] === "user")!;
  const insan = (metin: string): string => JSON.stringify({ ...insanSablon, message: { role: "user", content: damgali(metin) } });
  const sentetikSablon = sentetikStdin.find((o) => o["isSynthetic"] === true)!;
  const stdin = [
    insan(gonderilen.mesaj),
    JSON.stringify({ ...sentetikSablon, message: { role: "user", content: damgali("İş 1 bitti, durum: tamam.") } }),
    insan(gonderilen.kesme),
    JSON.stringify({ type: "control_request", request_id: "kesAbCdEf12_-34", request: { subtype: "interrupt" } }),
  ];
  const ana: SurecKaydi = {
    pid: 7001,
    baslangic_ms: 1,
    argv: anaArgv,
    gercek_argv: anaArgv,
    cwd: ters(yt.baslatma.cwd, anaUuid),
    ortam: ortamKur(yt.baslatma.ortam),
    mcp: { yol: ters(yt.mcp.yol, anaUuid), icerik: JSON.stringify(mcp) },
    stdin,
    stdout: [
      JSON.stringify({ type: "system", subtype: "init", apiKeySource: "none", mcp_servers: [{ name: "eren", status: "connected" }, { name: "eren-ajanda", status: "connected" }] }),
      JSON.stringify({ type: "result", subtype: "success", is_error: false, terminal_reason: "completed", total_cost_usd: 0.001 }),
      JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming" }),
    ],
    stderr: "",
    cikis: null,
  };
  const ph = i["pc_hafif"] as { istek: { argv: string[]; cwd: string; ortam: Record<string, string> }; gorev_txt: string };
  const isUuid = randomUUID();
  const sonek = ph.gorev_txt.slice(ALTIN_GOREV_METNI.length);
  const isArgv = metinAc(ph.istek.argv, i["uzun_metinler"] as Record<string, unknown>).map((a, n, d) =>
    n === 1 ? gonderilen.gorev_metni + sonek : n > 0 && d[n - 1] === "--model" ? "haiku" : ters(String(a), isUuid),
  );
  const isSurec: SurecKaydi = {
    pid: 7002,
    baslangic_ms: 2,
    argv: isArgv,
    gercek_argv: isArgv,
    cwd: esleme.proje,
    ortam: ortamKur(ph.istek.ortam),
    mcp: { yol: `${esleme.veriKoku}\\isler\\1\\mcp.json`, icerik: JSON.stringify({ mcpServers: {} }) },
    stdin: [],
    stdout: [
      JSON.stringify({ type: "system", subtype: "init", apiKeySource: "none", mcp_servers: [] }),
      JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { yapildi: [] } }),
    ],
    stderr: "",
    cikis: 0,
  };
  return { surum: DUMAN_KAYIT_SURUMU, esleme, gonderilen, surecler: [ana, isSurec], gorev_txt: gonderilen.gorev_metni + sonek };
}

interface Bozma {
  ad: string;
  bekle: "ayni" | "fark";
  /** "fark" ise en az bir fark ya da kalan denetim yolunda geçmeli. */
  yer?: string;
  boz: (k: DumanKaydi) => void;
}

const anaOf = (k: DumanKaydi): SurecKaydi => k.surecler.find(anaMi)!;
const isOf = (k: DumanKaydi): SurecKaydi => k.surecler.find(isMi)!;

const BOZMALAR: readonly Bozma[] = [
  { ad: "değişiklik yok", bekle: "ayni", boz: () => {} },
  {
    ad: "ayrılan alanlar değişir (model, saat, uuid, jeton): yine aynı",
    bekle: "ayni",
    boz: (k) => {
      const a = anaOf(k);
      a.argv[a.argv.indexOf("--model") + 1] = "sonnet";
      a.stdin[0] = a.stdin[0]!.replace("2026-11-28 Cumartesi 14:03", "2027-01-02 Cumartesi 09:41");
    },
  },
  { ad: "ana argv'den --verbose düşer", bekle: "fark", yer: "ana.baslatma.argv", boz: (k) => void anaOf(k).argv.splice(anaOf(k).argv.indexOf("--verbose"), 1) },
  {
    ad: "ana ortamda ANTHROPIC_API_KEY kalır",
    bekle: "fark",
    yer: "ana.baslatma.ortam",
    boz: (k) => {
      const o = anaOf(k).ortam;
      o.anahtarlar.push("ANTHROPIC_API_KEY");
      o.degerler["ANTHROPIC_API_KEY"] = "sizinti";
    },
  },
  {
    ad: "insan satırında anahtar sırası değişir",
    bekle: "fark",
    yer: "ana.stdin.insan[0]",
    boz: (k) => {
      const a = anaOf(k);
      const o = JSON.parse(a.stdin[0]!) as Record<string, unknown>;
      const { origin, ...geri } = o;
      a.stdin[0] = JSON.stringify({ origin, ...geri });
    },
  },
  {
    ad: "mcp'de alwaysLoad false",
    bekle: "fark",
    yer: "ana.baslatma.mcp",
    boz: (k) => {
      const a = anaOf(k);
      a.mcp!.icerik = a.mcp!.icerik!.replace('"alwaysLoad":true', '"alwaysLoad":false');
    },
  },
  {
    ad: "kesme alt türü yanlış",
    bekle: "fark",
    yer: "ana.stdin.kesme[0]",
    boz: (k) => {
      const a = anaOf(k);
      a.stdin[3] = a.stdin[3]!.replace('"interrupt"', '"interupt"');
    },
  },
  {
    ad: "iş argv'sinde --setting-sources boş değil",
    bekle: "fark",
    yer: "is.argv",
    boz: (k) => {
      const s = isOf(k);
      s.argv[s.argv.indexOf("--setting-sources") + 1] = "user";
    },
  },
  {
    ad: "iş görev soneki değişir",
    bekle: "fark",
    yer: "is.argv[1]",
    boz: (k) => {
      const s = isOf(k);
      s.argv[1] = s.argv[1]!.replace("Kullanıcıya soru sorma.", "Kullaniciya soru sorma.");
    },
  },
  { ad: "iş ortamında servis işareti yok", bekle: "fark", yer: "is.ortam", boz: (k) => void (isOf(k).ortam.anahtarlar = isOf(k).ortam.anahtarlar.filter((a) => a !== "EREN_KIT_SERVIS_OTURUMU")) },
  { ad: "ikinci insan metni gönderilenden farklı", bekle: "fark", yer: "insan satırlarının metni", boz: (k) => void (k.gonderilen.kesme = "Başka metin.") },
];

export function ozSinama(): boolean {
  const beklenen = beklenenKur();
  let hepsi = true;
  for (const b of BOZMALAR) {
    const k = altindanSahteKayit();
    b.boz(k);
    const s = karsilastir(k, beklenen);
    const kalan = s.denetimler.filter((d) => !d.gecti);
    const ayni = s.farklar.length === 0 && kalan.length === 0;
    const yerde = b.yer === undefined || s.farklar.some((f) => f.yol.startsWith(b.yer!)) || kalan.some((d) => d.ad.startsWith(b.yer!));
    const gecti = b.bekle === "ayni" ? ayni : !ayni && yerde;
    hepsi &&= gecti;
    const ozet = ayni ? "AYNI" : [...s.farklar.map((f) => f.yol), ...kalan.map((d) => `denetim: ${d.ad}`)].join("; ");
    process.stdout.write(`[${gecti ? "GECTI" : "KALDI"}] ${b.ad} → ${ozet}\n`);
  }
  const g = gozlemle(altindanSahteKayit());
  const gGecti = g.denetimler.every((d) => d.gecti);
  hepsi &&= gGecti;
  process.stdout.write(`[${gGecti ? "GECTI" : "KALDI"}] gözlem denetimleri sahte stdout'ta geçer\n`);
  return hepsi;
}

// ---------------------------------------------------------------------------------------------
// Komut satırı
// ---------------------------------------------------------------------------------------------

if (import.meta.main) {
  const a = process.argv.slice(2);
  if (a[0] === "--oz-sinama") {
    const ok = ozSinama();
    process.stdout.write(ok ? "öz sınama: GECTI\n" : "öz sınama: KALDI\n");
    process.exit(ok ? 0 : 1);
  } else if (a[0] === "--alanlar") {
    process.stdout.write(`${bicimle(AYRILAN_ALANLAR)}\n`);
  } else if (a[0] !== undefined) {
    const k = JSON.parse(readFileSync(a[0], "utf8")) as DumanKaydi;
    const s = karsilastir(k);
    const g = gozlemle(k);
    process.stdout.write(`${raporla("argv / stdin / ortam / mcp ↔ altın", s)}\n${raporla("davranış (stdout)", g)}\n`);
    const ok = basarili(s) && basarili(g);
    process.stdout.write(ok ? "SONUC: BASARILI\n" : "SONUC: BASARISIZ\n");
    process.exit(ok ? 0 : 1);
  } else {
    process.stderr.write("kullanım: karsilastir.ts <kayit.json> | --oz-sinama | --alanlar\n");
    process.exit(2);
  }
}
