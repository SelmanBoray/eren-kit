/**
 * `konusma` modülü: MODULLER.md "### konusma", "Bitti" listesi; Dilim 2: "Modül maddeleri (Dilim 2)" > "konusma
 * (örnek)". Sahte `BoruluSurec`, sahte `SurecKapisi` (`sahteKapi`), gerçek `depoKur(:memory:)`, `akisKur`,
 * `veriyoluKur`. Beklentiler belgeden yazıldı; üretim kodunun o anki haline uydurulmadı.
 * Sentetik metinlerin bölüm ayırıcısı ve devir satırının iç düzeni belgede sabitlenmediği için `includes` ile sınanır.
 *
 * Dilim 2: `baslat()` süreç AÇMAZ; dilim 1 testlerinde `sohbetler`'in açılıştaki `uyandir()`'ı `basla(h)` ile
 * taklit edilir (baslat + uyandir). Varsayılan sohbet `ana`; `nesilAyir` `sohbetler`'deki gibi
 * `max(sayac, depo.enBuyukNesil()) + 1`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANA_SOHBET_ID, ROL_FIILLERI, SINIRLAR } from "@eren/protocol";
import type { Olay } from "@eren/protocol";
import { akisKur } from "../src/akis.ts";
import { depoKur } from "../src/depo.ts";
import { konusmaKur } from "../src/konusma.ts";
import { sistemIstemi } from "../src/konusma-metin.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import type {
  Ayar,
  Depo,
  DogrulanmisInsanMesaji,
  IsKaydi,
  JetonKapsami,
  LimitKilitDurumu,
  MezarTasiOlayi,
  OlayGirdisi,
  ServisOlaylari,
  SohbetSecimi,
  SurecPortu,
  TurKaydi,
  YeniSayfaSonucu,
} from "../src/sozlesme.ts";
import { sahteDunya, sahteKapi } from "./sahte.ts";
import type { SahteBoruluSurec, SahteDunya, SahteKapi } from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Donanım
// ---------------------------------------------------------------------------------------------

type J = Record<string, any>;

const ANA = ANA_SOHBET_ID;
const ANA_S: SohbetSecimi = { sohbet_id: ANA };

const MODEL = "claude-opus-ornek";
const NODE = "C:\\ornek\\node\\node.exe";
const KOPRU = "C:\\ornek\\eren-kit\\src\\kopru.ts";
const EXE = "C:\\ornek\\npm\\claude.exe";
const ERENCWD = "C:\\ornek\\eren-kit\\eren-cwd";
const ERENMCP_DIZINI = "C:\\ornek\\eren-kit\\eren-mcp";
/** `Ayar.erenMcpYolu(nesil)` sahtesi: `<erenMcpDizini>\<nesil>.json` (dilim 2: nesil başına dosya). */
const mcpYolu = (nesil: number): string => {
  if (!Number.isSafeInteger(nesil) || nesil < 1) throw new Error(`gecersiz nesil ${nesil}`);
  return `${ERENMCP_DIZINI}\\${nesil}.json`;
};
const ORTAM = {
  PATH: "C:\\ornek\\bin",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
  CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1",
  CLAUDE_CODE_DISABLE_ATTACHMENTS: "1",
};

const CU_SUNUCU = { command: "C:\ornek\cu\cu.exe", args: ["--ornek"] };
const CU_ARACLARI = ["screenshot", "zoom", "elements", "windows", "focus", "click", "type_text", "key", "scroll", "drag", "move", "wait"];
const PC_ARACLARI = ["PowerShell", "Bash", "Read", "Glob", "Grep"];

const sahteAyar = (
  kimlikEki = "",
  computerUse: Ayar["computerUse"] = null,
  asistanAdi = "Claude",
  tamYetki = true,
): Ayar =>
  ({
    yollar: {
      kok: "C:\\ornek\\eren-kit",
      vt: "C:\\ornek\\eren-kit\\eren.db",
      log: "C:\\ornek\\eren-kit\\logs\\servis.log",
      islerDizini: "C:\\ornek\\eren-kit\\isler",
      erenCwd: ERENCWD,
      erenMcpDizini: ERENMCP_DIZINI,
      anahtar: "C:\\ornek\\eren-kit\\sunucu-anahtar.pem",
      kimlikEki: "C:\\ornek\\eren-kit\\kimlik.local.md",
      projeler: "C:\\ornek\\eren-kit\\projeler.json",
      yerelAyar: "C:\\ornek\\eren-kit\\ayar.local.json",
      limitKilit: "C:\\ornek\\ClaudeLimitKilit\\kilit.json",
      claudeProjeleri: "C:\\ornek\\kullanici\\.claude\\projects",
    },
    erenMcpYolu: mcpYolu,
    erenCanliAzami: 2,
    erenBostaKapatMs: 30 * 60_000,
    tamYetki,
    servis: { surum: null, baslangic_ms: 1_700_000_000_000 },
    computerUse,
    claudeExe: EXE,
    nodeExe: NODE,
    kopruBetigi: KOPRU,
    erenModeli: "opus",
    kullaniciAdi: "Ornek",
    asistanAdi,
    sureler: {
      kilitYoklamaMs: 5000,
      torunYoklamaMs: 10000,
      isYoklamaMs: 2000,
      ramYoklamaMs: 30000,
      soruZamanAsimiMs: 82_800_000,
      devirOzetiBeklemeMs: 120_000,
      deltaTamponMs: 80,
      bildirimAckMs: 30000,
      komutPayiMs: 15000,
      erenYenidenBaslatmaMs: 30000,
    },
    erenOrtami: () => ({ ...ORTAM }),
    telefonIsOrtami: () => ({ ...ORTAM }),
    pcIsOrtami: () => ({ PATH: ORTAM.PATH }),
    kimlikEki: async () => kimlikEki,
  }) as unknown as Ayar;

/** Anahtar sırasından bağımsız kapsam metni (`sira` girdileri). */
const kapsamMetni = (k: JetonKapsami): string =>
  JSON.stringify(Object.fromEntries(Object.entries(k).sort(([a], [b]) => a.localeCompare(b))));

/** Ana oturum jeton kapsamı (dilim 2: `{rol:"eren", sohbet_id, nesil}`). */
const erenKapsami = (nesil: number, sohbet_id: string = ANA): JetonKapsami => ({ rol: "eren", sohbet_id, nesil });

/** `sohbetler`'in `nesilAyir`'ı gibi: bellek sayacı `max(sayac, depo.enBuyukNesil()) + 1`. */
const nesilAyiriciKur = (depo: Depo): { ayir: () => number; verilenler: number[] } => {
  let sayac = 0;
  const verilenler: number[] = [];
  return {
    verilenler,
    ayir: () => {
      sayac = Math.max(sayac, depo.enBuyukNesil()) + 1;
      verilenler.push(sayac);
      return sayac;
    },
  };
};

interface Duzen {
  d: SahteDunya;
  depo: Depo;
  veriyolu: ReturnType<typeof veriyoluKur>;
  konusma: ReturnType<typeof konusmaKur>;
  /** Bu örneğin sohbeti. */
  sohbet_id: string;
  sec: SohbetSecimi;
  kapi: SahteKapi;
  nesil: { ayir: () => number; verilenler: number[] };
  kopru: { uretilen: Array<{ kapsam: JetonKapsami; jeton: string }>; iptal: JetonKapsami[] };
  /** Bu örneğin başlattığı süreçler (aynı dünyayı paylaşan iki örnekte ayırmak için). */
  surecler: SahteBoruluSurec[];
  kilitle(serbest: boolean): void;
  /** Hem bayrağı çevirir hem `kilit_degisti` yayınlar. */
  kilitDegis(durum: LimitKilitDurumu): void;
  olaylar: Array<{ ad: string; veri: unknown }>;
  /**
   * Çağrı sırası (Dilim 1, `yeniSayfa` sırası): `boruluBaslat:<session-id|resume>:<uuid>`, `stdinKapat:<pid>`,
   * `agaciOldur:<pid>`, `jetonUret:<kapsam>`, `jetonIptal:<kapsam>`, `oturumKaydet:<uuid>`. Sahte süreç portu
   * olduğu gibi çağrılır (`h.d.surec.x = ...` ile değiştirilen yöntem de geçer). Kapsam `kapsamMetni` ile.
   */
  sira: string[];
}

function kur(
  sec: {
    kilitli?: boolean;
    kimlikEki?: string;
    computerUse?: Ayar["computerUse"];
    /** `Ayar.asistanAdi`; verilmezse "Claude". */
    asistanAdi?: string;
    /** Dilim 3b: `ayar.tamYetki` (gerçek varsayılan gibi `true`). */
    tamYetki?: boolean;
    depoSarici?: (d: Depo) => Depo;
    /** Servis yeniden kurulumu ya da ikinci örnek: aynı dünya ve aynı depo üzerinde yeni `konusmaKur`. */
    d?: SahteDunya;
    depo?: Depo;
    /** İkinci örnek: aynı veriyolu. */
    veriyolu?: ReturnType<typeof veriyoluKur>;
    /** Dilim 2. Varsayılan `ana`. */
    sohbet_id?: string;
    /** Dilim 2. İki örnek aynı kapıyı ve aynı nesil ayırıcıyı paylaşır (`sohbetler` gibi). */
    kapi?: SahteKapi;
    nesil?: { ayir: () => number; verilenler: number[] };
  } = {},
): Duzen {
  const d = sec.d ?? sahteDunya();
  const veriyolu = sec.veriyolu ?? veriyoluKur({ gunluk: d.gunluk });
  const depo = sec.depo ?? depoKur({ yol: ":memory:", saat: d.saat, veriyolu, gunluk: d.gunluk });
  const sohbet_id = sec.sohbet_id ?? ANA;
  if (depo.sohbetGetir({ sohbet_id }) === null) {
    depo.sohbetEkle({ sohbet_id, ad: "Ornek sohbet", olusturma_ms: d.zaman.simdi(), son_etkinlik_ms: d.zaman.simdi() });
  }
  const kapi = sec.kapi ?? sahteKapi();
  const nesil = sec.nesil ?? nesilAyiriciKur(depo);
  let serbest = !sec.kilitli;
  const kopru: Duzen["kopru"] = { uretilen: [], iptal: [] };
  const surecler: SahteBoruluSurec[] = [];
  let sayac = 0;
  const olaylar: Duzen["olaylar"] = [];
  for (const ad of ["tur_delta", "tur_basladi", "tur_bitti", "eren_durumu"] as const) {
    veriyolu.dinle(ad, (veri) => {
      if ((veri as { sohbet_id?: string }).sohbet_id === sohbet_id) olaylar.push({ ad, veri });
    });
  }
  const sira: string[] = [];
  // Her çağrı o anki `d.surec` yöntemine gider: testlerin `h.d.surec.surecVarMi = ...` değişikliği geçerli kalır.
  const surec: SurecPortu = {
    boruluBaslat: async (istek) => {
      const a = istek.argv;
      const i = a.indexOf("--session-id");
      const kip = i >= 0 ? "session-id" : "resume";
      sira.push(`boruluBaslat:${kip}:${a[(i >= 0 ? i : a.indexOf("--resume")) + 1]}`);
      const s = await d.surec.boruluBaslat(istek);
      surecler.push(s as SahteBoruluSurec);
      const kapat = s.stdinKapat;
      s.stdinKapat = () => {
        sira.push(`stdinKapat:${s.pid}`);
        kapat();
      };
      return s;
    },
    ayrikBaslat: (istek) => d.surec.ayrikBaslat(istek),
    aracCalistir: (istek) => d.surec.aracCalistir(istek),
    anlikGoruntu: () => d.surec.anlikGoruntu(),
    surecVarMi: (kimlik) => d.surec.surecVarMi(kimlik),
    agaciOldur: (pid) => {
      sira.push(`agaciOldur:${pid}`);
      return d.surec.agaciOldur(pid);
    },
    tekOldur: (pid) => d.surec.tekOldur(pid),
  };
  const tabanDepo = sec.depoSarici ? sec.depoSarici(depo) : depo;
  const konusmaDeposu: Depo = {
    ...tabanDepo,
    oturumKaydet: (session_id, ts_ms, sohbet) => {
      sira.push(`oturumKaydet:${session_id}`);
      tabanDepo.oturumKaydet(session_id, ts_ms, sohbet);
    },
  };
  const konusma = konusmaKur({
    sohbet_id,
    kapi,
    nesilAyir: nesil.ayir,
    ayar: sahteAyar(sec.kimlikEki ?? "", sec.computerUse ?? null, sec.asistanAdi ?? "Claude", sec.tamYetki ?? true),
    depo: konusmaDeposu,
    kilit: { baslatmaSerbestMi: () => serbest },
    kopru: {
      jetonUret: (kapsam) => {
        const jeton = `jeton-ornek-${String(++sayac).padStart(4, "0")}-`.padEnd(40, "x");
        kopru.uretilen.push({ kapsam, jeton });
        sira.push(`jetonUret:${kapsamMetni(kapsam)}`);
        return jeton;
      },
      jetonlariIptalEt: (kapsam) => {
        kopru.iptal.push(kapsam);
        sira.push(`jetonIptal:${kapsamMetni(kapsam)}`);
      },
    },
    akis: akisKur(),
    surec,
    dosya: d.dosya,
    saat: d.saat,
    zamanlayici: d.zamanlayici,
    rastgele: d.rastgele,
    veriyolu,
    gunluk: d.gunluk,
  });
  return {
    d,
    depo,
    veriyolu,
    konusma,
    sohbet_id,
    sec: { sohbet_id },
    kapi,
    nesil,
    kopru,
    surecler,
    olaylar,
    sira,
    kilitle: (s) => {
      serbest = s;
    },
    kilitDegis: (durum) => {
      serbest = durum.tur === "serbest";
      veriyolu.yayinla("kilit_degisti", { durum });
    },
  };
}

/** Aynı dünya, depo, veriyolu, kapı ve nesil ayırıcıyla ikinci örnek (`sohbetler`'in kurduğu gibi). */
const ikinci = (h: Duzen, sohbet_id: string, ek: { kilitli?: boolean } = {}): Duzen =>
  kur({ d: h.d, depo: h.depo, veriyolu: h.veriyolu, kapi: h.kapi, nesil: h.nesil, sohbet_id, ...ek });

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
};

/** `sohbetler`'in açılışı gibi: örneğin `baslat()`'ı, sonra `uyandir()`. Dilim 1 testlerinin "başlat"ı budur. */
async function basla(h: Duzen): Promise<void> {
  await h.konusma.baslat();
  h.konusma.uyandir();
}

const satir = (o: unknown): string => JSON.stringify(o);

const oturumKimligi = (s: SahteBoruluSurec): string => {
  const a = s.istek.argv;
  const i = Math.max(a.indexOf("--session-id"), a.indexOf("--resume"));
  return a[i + 1]!;
};

const mcpConfig = (s: SahteBoruluSurec): string => s.istek.argv[s.istek.argv.indexOf("--mcp-config") + 1]!;

const initSatiri = (s: SahteBoruluSurec, ek: Record<string, unknown> = {}): string =>
  satir({
    type: "system",
    subtype: "init",
    session_id: oturumKimligi(s),
    tools: ["mcp__eren__plan_oner", "mcp__eren__rapor_oku"],
    mcp_servers: [{ name: "eren", status: "connected" }],
    apiKeySource: "none",
    model: MODEL,
    ...ek,
  });

const asistan = (id: string, input: number, cc = 0, cr = 0): string =>
  satir({
    type: "assistant",
    message: {
      id,
      model: MODEL,
      usage: { input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: 10 },
    },
  });

const parca = (text: string, ek: Record<string, unknown> = {}): string =>
  satir({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    ...ek,
  });

const sonuc = (ek: Record<string, unknown> = {}): string =>
  satir({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    stop_reason: "end_turn",
    result: "tamam",
    session_id: "ornek",
    modelUsage: { [MODEL]: { contextWindow: 1_000_000 } },
    usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 1 },
    ...ek,
  });

const insan = (h: Duzen, n: number, text = `merhaba ${n}`, sohbet_id = h.sohbet_id): { seq: number } =>
  h.konusma.insanMesajiAl({
    device_id: "cihaz1",
    client_msg_id: `msg${n}`,
    sohbet_id,
    input: "yazi",
    text,
  } as unknown as DogrulanmisInsanMesaji);

/** `devir_ozeti` fiili: köprü jetonunun nesli etkin (devredilen) nesildir. */
const ozetVer = (h: Duzen, ozet: string, nesil = h.konusma.nesil()): ReturnType<Duzen["konusma"]["devirOzetiAl"]> =>
  h.konusma.devirOzetiAl(ozet, nesil);

const satirlar = (s: SahteBoruluSurec): J[] => s.yazilanlar.map((x) => JSON.parse(x) as J);
const icerik = (l: J): string => (l["message"] as { content: string }).content;
const olayTur = (h: Duzen, type: Olay["type"]): Olay[] => h.depo.olaylariGetir(0, 10_000).filter((o) => o.type === type);
/** Sohbete bağlı olay girdisi: protokoldeki `olay()` zarfı bazı türlerde `sohbet_id`'yi tipte göstermiyor (bilinen geçici sorun). */
const olayGirdisi = (o: Record<string, unknown>): OlayGirdisi => o as unknown as OlayGirdisi;

/** Başlat (+ uyandır), `init` gönder, ana oturum hazır. */
async function ac(h: Duzen): Promise<SahteBoruluSurec> {
  await basla(h);
  await bosalt();
  const s = h.surecler.at(-1);
  assert.ok(s, "süreç açılmalıydı");
  s.stdoutSatiriGonder(initSatiri(s));
  await bosalt();
  return s;
}

const yeniAcilan = async (h: Duzen, onceki: number): Promise<SahteBoruluSurec> => {
  await bosalt();
  const l = h.d.surec.borulular();
  assert.equal(l.length, onceki + 1, "yeni süreç başlamalıydı");
  return l[l.length - 1]!;
};

const devirIstendi = (s: SahteBoruluSurec): boolean =>
  satirlar(s).some((l) => l["isSynthetic"] === true && icerik(l).includes("devir_ozeti"));

/** Bir insan turu: gönder, beslemeleri ver. */
async function turYap(h: Duzen, s: SahteBoruluSurec, n: number, ...cikti: string[]): Promise<void> {
  insan(h, n);
  await bosalt();
  for (const c of cikti) s.stdoutSatiriGonder(c);
  await bosalt();
}

const sentetikTumu = (h: Duzen): J[] => h.d.surec.borulular().flatMap((s) => satirlar(s));

/** Veriyolu olayları (dilim 2: `sohbet_id` zorunlu; varsayılan `ana`). */
const isBittiYay = (
  h: Duzen,
  is_id: number,
  ek: Partial<ServisOlaylari["is_bitti"]> = {},
): void =>
  h.veriyolu.yayinla("is_bitti", { is_id, plan_id: "p", tur: "pc", durum: "tamam", kirli: false, sohbet_id: ANA, ...ek });

const turKaydi = (ek: Partial<TurKaydi> = {}): TurKaydi => ({
  turn_id: "tur1",
  sohbet_id: ANA,
  nesil: 1,
  kaynak: "insan",
  gorunur: true,
  baslangic_ms: 1000,
  bitis_ms: null,
  bitis: null,
  kismi_metin: "",
  ...ek,
});

const nesilKaydi = (ek: Partial<Parameters<Depo["nesilEkle"]>[0]> = {}): Parameters<Depo["nesilEkle"]>[0] => ({
  nesil: 1,
  sohbet_id: ANA,
  session_id: "11111111-1111-4111-8111-111111111111",
  baslangic_ms: 1000,
  bitis_ms: null,
  ozet_kabul: null,
  pid: null,
  olusturma_ms: null,
  son_dolu: null,
  pencere: null,
  ...ek,
});

/** İş + bekleyen soru: devir satırı durumu taşır, soru metnini değil. */
function isVeSoru(depo: Depo, sohbet_id: string = ANA): number {
  const plan = {
    plan_id: "plan1",
    baslik: "Ornek is basligi",
    tur: "pc" as const,
    cwd: "C:\\ornek\\proje",
    gorev_metni: "gorev",
    kesin_yapilacaklar: ["a"],
    kesin_yapilmayacaklar: [],
  };
  depo.planEkle({ plan, plan_hash: "a".repeat(64), durum: "onaylandi", is_id: null, olusturma_ms: 1000, profil: "tam", sohbet_id });
  const kayit: Omit<IsKaydi, "is_id"> = {
    sohbet_id,
    plan_id: "plan1",
    plan_hash: "a".repeat(64),
    baslik: "Ornek is basligi",
    tur: "pc",
    cwd: "C:\\ornek\\proje",
    durum: "calisiyor",
    kirli: false,
    session_id: "22222222-2222-4222-8222-222222222222",
    pid: null,
    olusturma_ms: null,
    baslangic_ms: 5000,
    bitis_ms: null,
    out_ofset: 0,
    rapor: null,
    rapor_kaynak: null,
    son_result: null,
    durdurma: null,
  };
  const is_id = depo.isEkle(kayit);
  depo.soruEkle({
    soru_id: "soru1",
    is_id,
    soru: "GIZLI-SORU-XYZ",
    secenekler: null,
    durum: "bekliyor",
    cevap: null,
    olusturma_ms: 6000,
    son_ms: 6000,
  });
  return is_id;
}

// ---------------------------------------------------------------------------------------------
// Komut, ortam, durum
// ---------------------------------------------------------------------------------------------

describe("komut ve ortam", () => {
  it("ilk açılış: tam argv, ortam, cwd, boruluBaslat, durum geçişleri", async () => {
    const h = kur();
    // Dilim 2: süreç yok ve kilit, init reddi, çökme beklemesi, kapanma yok → `uyuyor` (dilim 1: `kapali`).
    assert.equal(h.konusma.durum(), "uyuyor");
    // Dilim 2: baslat süreç açmaz (uyuyor); uyandir yuva ister ve açar.
    await h.konusma.baslat();
    await bosalt();
    assert.equal(h.d.surec.cagrilar.say("boruluBaslat"), 0, "baslat süreç açmaz");
    assert.equal(h.konusma.durum(), "uyuyor");
    assert.deepEqual(h.kapi.istekler, [], "kuyruk boşken baslat yuva istemez");
    h.konusma.uyandir();
    assert.deepEqual(h.kapi.istekler, [ANA], "yuvaIste uyandir içinde eşzamanlı");
    await bosalt();
    assert.equal(h.konusma.durum(), "baslatiliyor");
    assert.equal(h.d.surec.cagrilar.say("boruluBaslat"), 1);
    assert.equal(h.d.surec.cagrilar.say("ayrikBaslat"), 0);
    const s = h.d.surec.sonBorulu();
    assert.equal(s.istek.exe, EXE);
    assert.equal(s.istek.cwd, ERENCWD);
    assert.deepEqual(s.istek.ortam, ORTAM);

    const argv = [...s.istek.argv];
    const ai = argv.indexOf("--system-prompt");
    assert.deepEqual(argv.slice(0, ai), [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--replay-user-messages",
      "--dangerously-skip-permissions",
      "--tools",
      "PowerShell,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch",
      "--strict-mcp-config",
      "--mcp-config",
      mcpYolu(1),
      "--setting-sources",
      "",
      "--disable-slash-commands",
    ]);
    assert.deepEqual(argv.slice(ai + 2), ["--model", "opus", "--session-id", oturumKimligi(s)]);
    assert.equal(argv.includes("--resume"), false);
    assert.equal(argv.filter((a) => a === "--tools").length, 1);
    assert.equal(argv.includes("--allowedTools"), false);
    assert.equal(argv.includes("--permission-prompts"), false);

    s.stdoutSatiriGonder(initSatiri(s));
    await bosalt();
    assert.equal(h.konusma.durum(), "hazir");
    insan(h, 1);
    await bosalt();
    assert.equal(h.konusma.durum(), "tur_suruyor");
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.konusma.durum(), "hazir");
    assert.equal(h.depo.sonNesil(h.sec)?.nesil, 1);
    assert.equal(h.konusma.nesil(), 1);
  });

  it("argv: computerUse dolu ya da boş: --tools tam sekiz araç, --allowedTools ve --permission-prompts yok, skip-permissions var", async () => {
    for (const cu of [null, CU_SUNUCU]) {
      const h = kur({ computerUse: cu });
      await basla(h);
      await bosalt();
      const argv = h.d.surec.sonBorulu().istek.argv;
      assert.equal(argv.includes("--dangerously-skip-permissions"), true);
      assert.equal(argv[argv.indexOf("--tools") + 1], "PowerShell,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch");
      for (const y of ["--allowedTools", "--permission-prompts"]) assert.equal(argv.includes(y), false, y);
    }
  });

  it("eren-mcp.json: computer-use-windows yalnız ayar doluyken; env yalnız ayarda varsa; alwaysLoad", async () => {
    const bos = kur();
    await basla(bos);
    await bosalt();
    const m0 = JSON.parse(bos.d.dosya.icerik(mcpYolu(1)) ?? "null") as J;
    assert.deepEqual(Object.keys(m0["mcpServers"]), ["eren"]);

    const dolu = kur({ computerUse: CU_SUNUCU });
    await basla(dolu);
    await bosalt();
    const m1 = JSON.parse(dolu.d.dosya.icerik(mcpYolu(1)) ?? "null") as J;
    assert.deepEqual(Object.keys(m1["mcpServers"]).sort(), ["computer-use-windows", "eren"]);
    assert.deepEqual(m1["mcpServers"]["computer-use-windows"], {
      type: "stdio",
      command: CU_SUNUCU.command,
      args: CU_SUNUCU.args,
      alwaysLoad: true,
    });

    const envli = kur({ computerUse: { ...CU_SUNUCU, env: { ORNEK: "1" } } });
    await basla(envli);
    await bosalt();
    const m2 = JSON.parse(envli.d.dosya.icerik(mcpYolu(1)) ?? "null") as J;
    assert.deepEqual(m2["mcpServers"]["computer-use-windows"]["env"], { ORNEK: "1" });
  });

  it("eren-mcp.json: eren sunucusu, jeton ortamda, argümanda değil; jeton nesil kapsamlı", async () => {
    const h = kur();
    await basla(h);
    await bosalt();
    assert.deepEqual(
      h.kopru.uretilen.map((u) => u.kapsam),
      [erenKapsami(1)],
    );
    const jeton = h.kopru.uretilen[0]!.jeton;
    const mcp = JSON.parse(h.d.dosya.icerik(mcpYolu(1)) ?? "null") as J;
    assert.deepEqual(mcp["mcpServers"]["eren"], {
      type: "stdio",
      command: NODE,
      args: [KOPRU, "--rol", "eren"],
      env: { EREN_KOPRU_JETON: jeton },
      alwaysLoad: true,
    });
    const s = h.d.surec.sonBorulu();
    assert.equal(
      s.istek.argv.some((a) => a.includes(jeton)),
      false,
      "jeton argümanda geçmez",
    );
  });

  it("sistem istemi: en çok 2000 karakter, içerik anahtarları, kimlikEki sonda, her başlatmada aynı", async () => {
    const al = (s: SahteBoruluSurec): string => s.istek.argv[s.istek.argv.indexOf("--system-prompt") + 1]!;
    const h = kur({ kimlikEki: "EK-KIMLIK-METNI" });
    const s1 = await ac(h);
    const istem = al(s1);
    assert.ok(istem.trimEnd().endsWith("EK-KIMLIK-METNI"));
    for (const k of ["devir_ozeti", "plan_oner", "rapor_oku"]) assert.ok(istem.includes(k), k);

    const bos = kur();
    const sb = await ac(bos);
    assert.ok(al(sb).length <= 2000, `istem ${al(sb).length} karakter`);

    s1.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    const s2 = h.d.surec.sonBorulu();
    assert.notEqual(s2, s1);
    assert.equal(al(s2), istem);
  });

  it("sistem istemi asistan adını ayardan alır: varsayılan Claude, verilen ad, 40 karakterlik adla da 2000 sınırı", async () => {
    const al = (s: SahteBoruluSurec): string => s.istek.argv[s.istek.argv.indexOf("--system-prompt") + 1]!;
    const varsayilan = al(await ac(kur()));
    assert.ok(varsayilan.startsWith("Adın Claude: "), varsayilan.slice(0, 40));
    const ozel = al(await ac(kur({ asistanAdi: "Örnek Asistan" })));
    assert.ok(ozel.startsWith("Adın Örnek Asistan: "), ozel.slice(0, 40));
    assert.equal(ozel.includes("Claude:"), false);
    const uzun = al(await ac(kur({ asistanAdi: "ş".repeat(40), computerUse: CU_SUNUCU })));
    assert.ok(uzun.length <= 2000, `istem ${uzun.length} karakter`);
  });

  it("resume: oturum bayrağı dışında aynı bayraklar", async () => {
    const h = kur();
    const S = "33333333-3333-4333-8333-333333333333";
    h.depo.nesilEkle(nesilKaydi({ session_id: S }));
    await basla(h);
    await bosalt();
    const argv = [...h.d.surec.sonBorulu().istek.argv];
    assert.deepEqual(argv.slice(-2), ["--resume", S]);
    assert.equal(argv.includes("--session-id"), false);
    const ref = kur();
    await basla(ref);
    await bosalt();
    const rA = ref.d.surec.sonBorulu().istek.argv;
    assert.deepEqual(argv.slice(0, -2), rA.slice(0, -2));
  });
});

// ---------------------------------------------------------------------------------------------
// Stdin satırları
// ---------------------------------------------------------------------------------------------

describe("stdin satır biçimleri", () => {
  it("kullanıcı satırı bire bir JSON, metin bayt bayt, @ süzülmez", async () => {
    const h = kur();
    const s = await ac(h);
    const metin = '  @C:\\ornek\\a.txt ve @"x y" ve @goreli çok\nikinci satır \u{1F600}  ';
    insan(h, 1, metin);
    await bosalt();
    assert.equal(s.yazilanlar.length, 1);
    assert.equal(
      s.yazilanlar[0],
      JSON.stringify({
        type: "user",
        parent_tool_use_id: null,
        client_composed: true,
        origin: { kind: "human" },
        message: { role: "user", content: metin },
      }),
    );
  });

  it("servis (sentetik) satırı bire bir JSON; origin yok", async () => {
    const h = kur();
    const s = await ac(h);
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 7, plan_id: "plan1", tur: "pc", durum: "tamam", kirli: false });
    await bosalt();
    assert.equal(s.yazilanlar.length, 1);
    assert.equal(
      s.yazilanlar[0],
      JSON.stringify({
        type: "user",
        parent_tool_use_id: null,
        client_composed: true,
        isSynthetic: true,
        message: { role: "user", content: "İş 7 bitti, durum: tamam." },
      }),
    );
    assert.equal("origin" in satirlar(s)[0]!, false);
  });

  it("kesme satırı bire bir JSON: control_request/interrupt", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    const r = h.konusma.kes();
    assert.equal(r.ok, true);
    const l = satirlar(s);
    const k = l[l.length - 1]!;
    assert.deepEqual(Object.keys(k), ["type", "request_id", "request"]);
    assert.equal(k["type"], "control_request");
    assert.equal(typeof k["request_id"], "string");
    assert.ok((k["request_id"] as string).length > 0);
    assert.deepEqual(k["request"], { subtype: "interrupt" });
    assert.equal(s.canli, true, "süreç ayakta kalır");
    assert.deepEqual(h.d.surec.oldurmalar, []);
  });

  it("sentetik kalıplar: her olay için sabit metin", async () => {
    const h = kur();
    const s = await ac(h);
    const isB = (tur: "pc" | "telefon", durum: "tamam" | "hata", kirli: boolean) => (): void =>
      h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 7, plan_id: "p", tur, durum, kirli });
    const soru = (durum: "soruldu" | "cevaplandi") => (): void =>
      h.veriyolu.yayinla("soru_durumu", { sohbet_id: ANA, soru_id: "s1", is_id: 7, durum });
    const durumlar: Array<[() => void, string]> = [
      [isB("pc", "tamam", false), "İş 7 bitti, durum: tamam."],
      [isB("telefon", "tamam", true), "İş 7 bitti, durum: tamam, kirli."],
      [isB("pc", "hata", false), "İş 7 bitti, durum: hata."],
      [soru("soruldu"), "İş 7 kullanıcıya soru sordu."],
      [soru("cevaplandi"), "İş 7 sorusu: cevaplandı."],
      [
        () => h.veriyolu.yayinla("plan_sonuclandi", { sohbet_id: ANA, plan_id: "plan1", sonuc: "onaylandi", is_id: 7 }),
        "Plan plan1: onaylandı, iş 7.",
      ],
      [() => h.veriyolu.yayinla("plan_sonuclandi", { sohbet_id: ANA, plan_id: "plan1", sonuc: "reddedildi" }), "Plan plan1: reddedildi."],
      [
        () => h.veriyolu.yayinla("isler_uzlastirildi", { sahiplenilen: 2, biten: 1, sohbetler: { [ANA]: { sahiplenilen: 2, biten: 1 } } }),
        "Servis yeniden başladı: 2 iş sahiplenildi, 1 iş bitti.",
      ],
    ];
    for (const [yay, beklenen] of durumlar) {
      const once = s.yazilanlar.length;
      yay();
      await bosalt();
      assert.equal(s.yazilanlar.length, once + 1, beklenen);
      const l = satirlar(s)[once]!;
      assert.equal(icerik(l), beklenen);
      assert.equal(l["isSynthetic"], true);
      s.stdoutSatiriGonder(sonuc());
      await bosalt();
    }
  });

  it("client_composed her satırda: kullanıcı, sentetik, kurtarma notu, devir isteği, devir ilk satırı", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi());
    h.depo.turEkle({
      turn_id: "tur1",
      sohbet_id: ANA,
      nesil: 1,
      kaynak: "insan",
      gorunur: true,
      baslangic_ms: 1000,
      bitis_ms: null,
      bitis: null,
      kismi_metin: "yarım cevap",
    });
    const s1 = await ac(h); // ilk satır: kurtarma notu
    insan(h, 1);
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 7, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    for (let i = 0; i < 3; i++) {
      s1.stdoutSatiriGonder(sonuc());
      await bosalt();
    }
    await turYap(h, s1, 2, asistan("md", 300_000), sonuc()); // devir isteği
    s1.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    const s2 = await yeniAcilan(h, 1);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    const tum = sentetikTumu(h);
    assert.ok(tum.length >= 6, `satır sayısı ${tum.length}`);
    for (const l of tum) {
      assert.equal(l["client_composed"], true, JSON.stringify(l).slice(0, 100));
      assert.equal(l["type"], "user");
      assert.equal(l["parent_tool_use_id"], null);
      assert.ok(l["origin"] !== undefined || l["isSynthetic"] === true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Tek satır, birleşme, kuyruk, seq
// ---------------------------------------------------------------------------------------------

describe("tur ve kuyruk", () => {
  it("tek satır kuralı: result gelmeden ikinci satır yazılmaz; turn_id satırla bire bir", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    insan(h, 2);
    insan(h, 3);
    await bosalt();
    assert.equal(s.yazilanlar.length, 1);
    const t1 = h.konusma.aktifTur()!.turn_id;
    assert.equal(h.depo.acikTurlar(h.sec).length, 1);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(s.yazilanlar.length, 2);
    const t2 = h.konusma.aktifTur()!.turn_id;
    assert.notEqual(t1, t2);
    assert.equal(h.depo.acikTurlar(h.sec).length, 1);
    assert.equal(h.depo.turGetir(t1)?.bitis, "tamam");
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(s.yazilanlar.length, 3);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(s.yazilanlar.length, 3);
    assert.equal(h.konusma.aktifTur(), null);
    assert.deepEqual(satirlar(s).map(icerik), ["merhaba 1", "merhaba 2", "merhaba 3"]);
  });

  it("--replay-user-messages yankısı yok sayılır", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    const once = h.depo.basSeq();
    const olaySayisi = h.depo.olaylariGetir(0, 1000).length;
    s.stdoutSatiriGonder(
      satir({ type: "user", isReplay: true, message: { role: "user", content: "merhaba 1" }, parent_tool_use_id: null }),
    );
    await bosalt();
    assert.equal(h.depo.olaylariGetir(0, 1000).length, olaySayisi);
    assert.equal(h.depo.basSeq(), once);
    assert.equal(s.yazilanlar.length, 1);
    assert.equal(h.depo.acikTurlar(h.sec).length, 1);
  });

  it("sentetik satırlar birleşir (tek satır, tek tur); araya giren kullanıcı mesajı birleşmez", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    const ev = (n: number): void =>
      h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: n, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    ev(1);
    ev(2);
    insan(h, 2);
    ev(3);
    await bosalt();
    assert.equal(s.yazilanlar.length, 1);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    let l = satirlar(s);
    assert.equal(l.length, 2);
    assert.equal(l[1]!["isSynthetic"], true);
    assert.ok(icerik(l[1]!).includes("İş 1 bitti, durum: tamam."));
    assert.ok(icerik(l[1]!).includes("İş 2 bitti, durum: tamam."));
    assert.equal(icerik(l[1]!).includes("İş 3"), false);
    const turBirlesik = h.konusma.aktifTur()!.turn_id;
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    l = satirlar(s);
    assert.equal(l.length, 3);
    assert.equal(icerik(l[2]!), "merhaba 2");
    assert.deepEqual(l[2]!["origin"], { kind: "human" });
    assert.equal("isSynthetic" in l[2]!, false);
    assert.notEqual(h.konusma.aktifTur()!.turn_id, turBirlesik);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    l = satirlar(s);
    assert.equal(l.length, 4);
    assert.ok(icerik(l[3]!).includes("İş 3 bitti, durum: tamam."));
    assert.equal(h.depo.kuyrukBasi(h.sec), null);
  });

  it("birleşme en çok 8 satır", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    for (let n = 1; n <= 10; n++) {
      h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: n, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    }
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    const say = (m: string): number => (m.match(/İş \d+ bitti, durum: tamam\./g) ?? []).length;
    assert.equal(say(icerik(satirlar(s)[1]!)), 8);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(say(icerik(satirlar(s)[2]!)), 2);
  });

  it("kuyruk ana oturum kapalıyken dolar, açılınca sırayla akar", async () => {
    const h = kur({ kilitli: true });
    await basla(h);
    await bosalt();
    assert.equal(h.d.surec.baslatmalar.length, 0);
    insan(h, 1, "ilk");
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 5, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    insan(h, 2, "ikinci");
    await bosalt();
    assert.equal(h.d.surec.baslatmalar.length, 0);
    assert.equal(h.depo.kuyrukBasi(h.sec)?.kaynak, "insan");
    assert.equal(h.depo.kuyrukBasi(h.sec)?.metin, "ilk");

    h.kilitDegis({ tur: "serbest" });
    await bosalt();
    const s = h.d.surec.sonBorulu();
    s.stdoutSatiriGonder(initSatiri(s));
    await bosalt();
    assert.deepEqual(satirlar(s).map(icerik), ["ilk"]);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.ok(icerik(satirlar(s)[1]!).includes("İş 5 bitti"));
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(icerik(satirlar(s)[2]!), "ikinci");
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.depo.kuyrukBasi(h.sec), null);
    assert.equal(s.yazilanlar.length, 3);
  });

  it("insanMesajiAl: seq user_echo'nun seq'i ve artan; kuyruk satırı insan; metin değişmez", () => {
    const h = kur({ kilitli: true });
    const m = "  @x\n boşluk  ";
    const a = insan(h, 1, m);
    h.depo.olayEkle({ type: "system_notice", seviye: "bilgi", kod: "diger", metin: "ara" });
    const b = insan(h, 2, "ikinci");
    assert.ok(b.seq > a.seq + 1);
    const ec = olayTur(h, "user_echo") as Array<Extract<Olay, { type: "user_echo" }>>;
    assert.deepEqual(
      ec.map((o) => [o.seq, o.client_msg_id, o.input, o.text]),
      [
        [a.seq, "msg1", "yazi", m],
        [b.seq, "msg2", "yazi", "ikinci"],
      ],
    );
    const k = h.depo.kuyrukBasi(h.sec)!;
    assert.equal(k.kaynak, "insan");
    assert.equal(k.metin, m);
  });

  it("insanMesajiAl: user_echo + kuyruk tek işlemde (kuyruk yazımı atarsa echo kalmaz)", () => {
    const h = kur({
      kilitli: true,
      depoSarici: (d) => ({
        ...d,
        kuyrugaEkle: () => {
          throw new Error("yazim hatasi");
        },
      }),
    });
    assert.throws(() => insan(h, 1));
    assert.equal(olayTur(h, "user_echo").length, 0);
    assert.equal(h.depo.kuyrukBasi(h.sec), null);
  });
});

// ---------------------------------------------------------------------------------------------
// Akış: delta tamponu, offset
// ---------------------------------------------------------------------------------------------

describe("delta tamponu", () => {
  const deltalar = (h: Duzen): Array<{ turn_id: string; offset: number; text: string }> =>
    h.olaylar.filter((o) => o.ad === "tur_delta").map((o) => o.veri as ServisOlaylari["tur_delta"]);

  it("80 ms dolunca tek delta; offset UTF-16 birimi", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    s.stdoutSatiriGonder(parca("Mer"));
    s.stdoutSatiriGonder(parca("haba"));
    assert.equal(deltalar(h).length, 0);
    h.d.zaman.ilerlet(79);
    assert.equal(deltalar(h).length, 0);
    h.d.zaman.ilerlet(1);
    const turId = h.konusma.aktifTur()!.turn_id;
    assert.deepEqual(deltalar(h), [{ sohbet_id: ANA, turn_id: turId, offset: 0, text: "Merhaba" }]);
    s.stdoutSatiriGonder(parca("\u{1F600}"));
    h.d.zaman.ilerlet(80);
    s.stdoutSatiriGonder(parca("ab"));
    h.d.zaman.ilerlet(80);
    assert.deepEqual(
      deltalar(h).map((d) => [d.offset, d.text]),
      [
        [0, "Merhaba"],
        [7, "\u{1F600}"],
        [9, "ab"],
      ],
    );
  });

  it("boşluk karakterinde zaman beklenmeden boşaltır", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    s.stdoutSatiriGonder(parca("bir iki "));
    assert.equal(
      deltalar(h)
        .map((d) => d.text)
        .join(""),
      "bir iki ",
    );
    assert.equal(deltalar(h)[0]!.offset, 0);
  });

  it("aktifTur() önce tamponu boşaltır", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    s.stdoutSatiriGonder(parca("xyz"));
    assert.equal(deltalar(h).length, 0);
    assert.equal(h.konusma.aktifTur()?.text, "xyz");
    assert.equal(
      deltalar(h)
        .map((d) => d.text)
        .join(""),
      "xyz",
    );
  });

  it("DELTA_METNI üstü parçalanır, offset'ler bitişik", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    s.stdoutSatiriGonder(parca("a".repeat(40_000)));
    h.d.zaman.ilerlet(80);
    const d = deltalar(h);
    assert.ok(d.length >= 3);
    let beklenen = 0;
    for (const x of d) {
      assert.ok(x.text.length <= SINIRLAR.DELTA_METNI);
      assert.equal(x.offset, beklenen);
      beklenen += x.text.length;
    }
    assert.equal(beklenen, 40_000);
  });

  it("parent_tool_use_id dolu parça görünmez", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    s.stdoutSatiriGonder(parca("alt agent", { parent_tool_use_id: "toolu_ornek" }));
    h.d.zaman.ilerlet(200);
    assert.equal(deltalar(h).length, 0);
    assert.equal(h.konusma.aktifTur()?.text, "");
  });

  it("turKismiYaz saniyede en çok bir", async () => {
    const sayac = { n: 0 };
    const h = kur({
      depoSarici: (d) => ({
        ...d,
        turKismiYaz: (t, m) => {
          sayac.n++;
          d.turKismiYaz(t, m);
        },
      }),
    });
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    for (let i = 0; i < 10; i++) {
      s.stdoutSatiriGonder(parca(`kelime${i} `));
      h.d.zaman.ilerlet(90);
    }
    assert.ok(sayac.n <= 1, `${sayac.n} yazım`);
  });

  it("tur_basladi ve tur_bitti aynı turn_id ile yayınlanır", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    const id = h.konusma.aktifTur()!.turn_id;
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.deepEqual(
      h.olaylar.filter((o) => o.ad === "tur_basladi" || o.ad === "tur_bitti"),
      [
        { ad: "tur_basladi", veri: { sohbet_id: ANA, turn_id: id } },
        { ad: "tur_bitti", veri: { sohbet_id: ANA, turn_id: id } },
      ],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// result sınıfları (subtype hep "success")
// ---------------------------------------------------------------------------------------------

describe("result sınıfları", () => {
  type Abort = Extract<Olay, { type: "turn_aborted" }>;
  type Asistan = Extract<Olay, { type: "assistant_message" }>;

  it("tamam: assistant_message result metniyle, aynı turn_id", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    const id = h.konusma.aktifTur()!.turn_id;
    s.stdoutSatiriGonder(sonuc({ result: "Merhaba dünya" }));
    await bosalt();
    const a = olayTur(h, "assistant_message") as Asistan[];
    assert.equal(a.length, 1);
    assert.equal(a[0]!.text, "Merhaba dünya");
    assert.equal(a[0]!.turn_id, id);
    assert.equal(h.depo.turGetir(id)?.bitis, "tamam");
  });

  it("tamam: result metni boşsa biriken metin; ikisi de boşsa olay yok; ASISTAN_METNI'nde kırpılır", async () => {
    const h = kur();
    const s = await ac(h);
    await turYap(h, s, 1, parca("biriken metin"), sonuc({ result: "" }));
    let a = olayTur(h, "assistant_message") as Asistan[];
    assert.deepEqual(
      a.map((o) => o.text),
      ["biriken metin"],
    );
    await turYap(h, s, 2, sonuc({ result: "" }));
    a = olayTur(h, "assistant_message") as Asistan[];
    assert.equal(a.length, 1);
    await turYap(h, s, 3, sonuc({ result: "b".repeat(SINIRLAR.ASISTAN_METNI + 5000) }));
    a = olayTur(h, "assistant_message") as Asistan[];
    assert.equal(a.length, 2);
    assert.equal(a[1]!.text.length, SINIRLAR.ASISTAN_METNI);
  });

  for (const terminal of ["aborted_streaming", "aborted_tools"]) {
    it(`kesildi (subtype success + ${terminal}): kullanici_kesti, kısmi metinle`, async () => {
      const h = kur();
      const s = await ac(h);
      insan(h, 1);
      await bosalt();
      const id = h.konusma.aktifTur()!.turn_id;
      s.stdoutSatiriGonder(parca("yarım kal "));
      s.stdoutSatiriGonder(sonuc({ terminal_reason: terminal, result: "" }));
      await bosalt();
      const t = olayTur(h, "turn_aborted") as Abort[];
      assert.equal(t.length, 1);
      assert.equal(t[0]!.neden, "kullanici_kesti");
      assert.equal(t[0]!.turn_id, id);
      assert.equal(t[0]!.kismi_metin, "yarım kal ");
      assert.equal(olayTur(h, "assistant_message").length, 0);
      assert.equal(h.depo.turGetir(id)?.bitis, "kesildi");
    });
  }

  it("hata (subtype success + is_error): turn_aborted hata, kısmi metinle", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    const id = h.konusma.aktifTur()!.turn_id;
    s.stdoutSatiriGonder(parca("kısmen "));
    s.stdoutSatiriGonder(sonuc({ is_error: true, stop_reason: "refusal", result: "red" }));
    await bosalt();
    const t = olayTur(h, "turn_aborted") as Abort[];
    assert.equal(t.length, 1);
    assert.equal(t[0]!.neden, "hata");
    assert.equal(t[0]!.kismi_metin, "kısmen ");
    assert.equal(olayTur(h, "assistant_message").length, 0);
    assert.equal(h.depo.turGetir(id)?.bitis, "hata");
  });

  it("aborted_ öneki is_error'dan önce: kesildi", async () => {
    const h = kur();
    const s = await ac(h);
    await turYap(h, s, 1, sonuc({ is_error: true, terminal_reason: "aborted_streaming" }));
    const t = olayTur(h, "turn_aborted") as Abort[];
    assert.deepEqual(
      t.map((x) => x.neden),
      ["kullanici_kesti"],
    );
  });

  it("kes: durum ve turn_id denetimi", async () => {
    const h = kur();
    await basla(h);
    await bosalt();
    const kod = (r: ReturnType<typeof h.konusma.kes>): string | null => (r.ok ? null : r.code);
    assert.equal(kod(h.konusma.kes()), "eren_hazir_degil");
    const s = h.d.surec.sonBorulu();
    s.stdoutSatiriGonder(initSatiri(s));
    await bosalt();
    assert.equal(kod(h.konusma.kes()), "tur_gecersiz");
    insan(h, 1);
    await bosalt();
    assert.equal(kod(h.konusma.kes("baska-tur")), "tur_gecersiz");
    const kesmeSay = (): number => satirlar(s).filter((l) => l["type"] === "control_request").length;
    assert.equal(kesmeSay(), 0);
    assert.equal(h.konusma.kes(h.konusma.aktifTur()!.turn_id).ok, true);
    assert.equal(kesmeSay(), 1);
  });
});

// ---------------------------------------------------------------------------------------------
// init denetimi
// ---------------------------------------------------------------------------------------------

describe("init ret dalları", () => {
  const reddet = async (ek: Record<string, unknown>, cu: Ayar["computerUse"] = null): Promise<void> => {
    const h = kur({ computerUse: cu });
    await basla(h);
    await bosalt();
    const s = h.d.surec.sonBorulu();
    s.stdoutSatiriGonder(initSatiri(s, ek));
    await bosalt();
    assert.ok(
      h.d.surec.oldurmalar.some((o) => o.pid === s.pid),
      "süreç öldürülmeli",
    );
    assert.equal(s.canli, false);
    const n = olayTur(h, "system_notice") as Array<Extract<Olay, { type: "system_notice" }>>;
    assert.ok(n.some((x) => x.seviye === "kritik" && x.kod === "diger"));
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 1, "otomatik yeniden deneme yok");
    assert.notEqual(h.konusma.durum(), "hazir");
    insan(h, 1);
    await bosalt();
    assert.equal(s.yazilanlar.length, 0);
  };

  it("apiKeySource none değil (abonelikten çıkma)", () => reddet({ apiKeySource: "ANTHROPIC_API_KEY" }));
  it("ret notu asistan adını ayardan alır", async () => {
    for (const [asistanAdi, ad] of [[undefined, "Claude"], ["Nova", "Nova"]] as const) {
      const h = kur(asistanAdi === undefined ? {} : { asistanAdi });
      await basla(h);
      await bosalt();
      const s = h.d.surec.sonBorulu();
      s.stdoutSatiriGonder(initSatiri(s, { apiKeySource: "ANTHROPIC_API_KEY" }));
      await bosalt();
      const n = olayTur(h, "system_notice") as Array<Extract<Olay, { type: "system_notice" }>>;
      assert.deepEqual(
        n.filter((x) => x.seviye === "kritik").map((x) => x.metin),
        [`${ad} durduruldu: başlangıç denetimi geçmedi (abonelik dışı kimlik). Otomatik yeniden deneme yok.`],
      );
    }
  });
  it("apiKeySource yok", () => reddet({ apiKeySource: null }));

  for (const arac of ["Edit", "Write", "WebFetch", "Agent", "NotebookEdit"]) {
    it(`bilinmeyen yerleşik araç kabul (${arac})`, async () => {
      const h = kur();
      await basla(h);
      await bosalt();
      const s = h.d.surec.sonBorulu();
      s.stdoutSatiriGonder(initSatiri(s, { tools: ["mcp__eren__plan_oner", "Bash", arac] }));
      await bosalt();
      assert.equal(s.canli, true);
      assert.deepEqual(h.d.surec.oldurmalar, []);
    });
  }

  it("kabuk ve okuma araçları kabul", async () => {
    const h = kur();
    await basla(h);
    await bosalt();
    const s = h.d.surec.sonBorulu();
    s.stdoutSatiriGonder(initSatiri(s, { tools: ["mcp__eren__plan_oner", ...PC_ARACLARI] }));
    await bosalt();
    assert.equal(s.canli, true);
    assert.equal(h.konusma.durum(), "hazir");
    assert.deepEqual(h.d.surec.oldurmalar, []);
  });

  it("computer-use araçları ayar doluyken kabul", async () => {
    const h = kur({ computerUse: CU_SUNUCU });
    await basla(h);
    await bosalt();
    const s = h.d.surec.sonBorulu();
    const tools = ["mcp__eren__plan_oner", ...PC_ARACLARI, ...CU_ARACLARI.map((a) => `mcp__computer-use-windows__${a}`)];
    s.stdoutSatiriGonder(initSatiri(s, { tools }));
    await bosalt();
    assert.equal(s.canli, true);
    assert.equal(h.konusma.durum(), "hazir");
    assert.deepEqual(h.d.surec.oldurmalar, []);
  });

  it("temiz init kabul: yalnız mcp__eren__ araçları ve apiKeySource none", async () => {
    const h = kur();
    const s = await ac(h);
    assert.equal(s.canli, true);
    assert.equal(h.konusma.durum(), "hazir");
    assert.deepEqual(h.d.surec.oldurmalar, []);
  });
});

// ---------------------------------------------------------------------------------------------
// Doluluk ve devir eşiği
// ---------------------------------------------------------------------------------------------

describe("doluluk ve devir eşiği", () => {
  const tetikler = async (usage: string[], resultEk: Record<string, unknown> = {}): Promise<boolean> => {
    const h = kur();
    const s = await ac(h);
    await turYap(h, s, 1, ...usage, sonuc(resultEk));
    return devirIstendi(s);
  };

  it("result.usage eşiği tetiklemez (turdaki çağrıların toplamı doluluk değildir)", async () => {
    const buyuk = { input_tokens: 900_000, cache_creation_input_tokens: 900_000, cache_read_input_tokens: 900_000 };
    assert.equal(await tetikler([asistan("m1", 1000)], { usage: buyuk }), false);
  });

  it("üç alandan her biri tek başına eşiği (200000) tetikler", async () => {
    assert.equal(await tetikler([asistan("m1", 200_000)]), true);
    assert.equal(await tetikler([asistan("m1", 0, 200_000)]), true);
    assert.equal(await tetikler([asistan("m1", 0, 0, 200_000)]), true);
  });

  it("toplam: alanlar toplanır; eşiğin bir altı tetiklemez", async () => {
    assert.equal(await tetikler([asistan("m1", 100_000, 60_000, 40_000)]), true);
    assert.equal(await tetikler([asistan("m1", 100_000, 60_000, 39_999)]), false);
  });

  it("aynı message_id tekrarında toplanmaz, sonuncu alınır", async () => {
    // toplansaydı 240000
    assert.equal(await tetikler([asistan("m1", 120_000), asistan("m1", 120_000)]), false);
    // sonuncu küçükse eşik altı (en büyüğü değil)
    assert.equal(await tetikler([asistan("m1", 250_000), asistan("m1", 100_000)]), false);
    // sonuncu büyükse tetikler
    assert.equal(await tetikler([asistan("m1", 100_000), asistan("m1", 250_000)]), true);
  });

  it("farklı message_id: yalnız son mesajın kullanımı sayılır", async () => {
    assert.equal(await tetikler([asistan("m1", 150_000), asistan("m2", 60_000)]), false);
  });

  it("küçük pencerede eşik %50 (300000 -> 150000); 1.000.000'luk pencerede 200000 tavanı", async () => {
    const kucuk = { modelUsage: { [MODEL]: { contextWindow: 300_000 } } };
    assert.equal(await tetikler([asistan("m1", 150_000)], kucuk), true);
    assert.equal(await tetikler([asistan("m1", 149_999)], kucuk), false);
    assert.equal(await tetikler([asistan("m1", 160_000)]), false, "1M pencerede 160000 eşik altı");
  });

  it("pencere bilinmiyorsa eşik 200000", async () => {
    const yok = { modelUsage: {} };
    assert.equal(await tetikler([asistan("m1", 199_999)], yok), false);
    assert.equal(await tetikler([asistan("m1", 200_000)], yok), true);
  });

  it("nesiller'e son_dolu ve pencere yazılır", async () => {
    const h = kur();
    const s = await ac(h);
    await turYap(h, s, 1, asistan("m1", 100_000, 20_000, 40_000), sonuc({ modelUsage: { [MODEL]: { contextWindow: 1_000_000 } } }));
    assert.equal(h.depo.sonNesil(h.sec)?.son_dolu, 160_000);
    assert.equal(h.depo.sonNesil(h.sec)?.pencere, 1_000_000);
  });

  it("kilit serbest değilken devir başlatılmaz", async () => {
    const h = kur();
    const s = await ac(h);
    h.kilitle(false);
    await turYap(h, s, 1, asistan("m1", 300_000), sonuc());
    assert.equal(devirIstendi(s), false);
  });
});

// ---------------------------------------------------------------------------------------------
// Devir
// ---------------------------------------------------------------------------------------------

describe("devir", () => {
  /** İlk tur eşiği aşar; devir isteği eski ana oturuma gider. */
  async function devirBasla(h: Duzen): Promise<SahteBoruluSurec> {
    const s1 = await ac(h);
    await turYap(h, s1, 1, asistan("m1", 250_000), sonuc({ result: "ilk cevap" }));
    assert.equal(devirIstendi(s1), true);
    return s1;
  }
  const devirTuruBitir = async (s1: SahteBoruluSurec, ek: Record<string, unknown> = {}): Promise<void> => {
    s1.stdoutSatiriGonder(asistan("m2", 1000));
    s1.stdoutSatiriGonder(sonuc({ result: "devir turu metni", ...ek }));
    await bosalt();
  };
  const ilkSatir = (s: SahteBoruluSurec): J => satirlar(s)[0]!;

  it("devir notunda kısayol mesajı ana oturuma gittiği önekle görünür (kaçışlı); yazı mesajı aynen", async () => {
    const h = kur();
    h.depo.olayEkle({
      sohbet_id: ANA,
      type: "user_echo",
      client_msg_id: "dn1",
      input: "kisayol",
      text: "bunu özetle",
      baglam: { paket: "com.whatsapp", ad: 'Wa"tsApp' },
    } as never);
    h.depo.olayEkle({
      sohbet_id: ANA,
      type: "user_echo",
      client_msg_id: "dn2",
      input: "yazi",
      text: "düz-yazi-metni",
    });
    const s1 = await devirBasla(h);
    assert.deepEqual(ozetVer(h, "OZET"), { kabul: true });
    await devirTuruBitir(s1);
    const s2 = await yeniAcilan(h, 1);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    const c = icerik(ilkSatir(s2));
    assert.ok(c.includes("telefon kısayolu: kullanıcı şu an"), "önek devir notunda");
    assert.ok(c.includes("com.whatsapp"));
    assert.ok(c.includes("bunu özetle"));
    assert.equal(c.includes('Wa"tsApp'), false, "ad kaçışsız girmez");
    assert.ok(c.includes("düz-yazi-metni"));
    assert.equal(c.includes("[telefon kısayolu]"), false, "yazı mesajına önek konmaz");
  });
  type Devir = Extract<Olay, { type: "eren_handover" }>;
  const devirOlaylari = (h: Duzen): Devir[] => olayTur(h, "eren_handover") as Devir[];

  it("devir isteği gorunur:false sentetik turdur; kuyruk durur; devirOzetiAl bekleme dışında kabul etmez", async () => {
    const h = kur();
    assert.deepEqual(ozetVer(h, "erken"), { kabul: false });
    const s1 = await devirBasla(h);
    const istek = satirlar(s1).find((l) => l["isSynthetic"] === true && icerik(l).includes("devir_ozeti"))!;
    assert.ok(istek);
    assert.equal("origin" in istek, false);
    assert.ok(h.depo.acikTurlar(h.sec).some((t) => t.kaynak === "devir" && t.gorunur === false));
    const once = s1.yazilanlar.length;
    insan(h, 2, "devir sırasında gelen");
    await bosalt();
    assert.equal(s1.yazilanlar.length, once, "devir sürerken kuyruk akmaz");
    // devir sırasında kes eren_hazir_degil
    const r = h.konusma.kes();
    assert.equal(r.ok ? null : r.code, "eren_hazir_degil");
  });

  it("devir: özet kabul, yeni süreç --session-id/nesil+1/yeni jeton, ilk satır özet+DB durumu+son konuşma, eski kapanır", async () => {
    const h = kur();
    const is_id = isVeSoru(h.depo);
    for (let i = 1; i <= 12; i++) {
      h.depo.olayEkle({
        sohbet_id: ANA,
        type: "user_echo",
        client_msg_id: `eski${i}`,
        input: "yazi",
        text: `satir-${String.fromCharCode(64 + i)}-son${i === 12 ? " ‮ bidi" : ""}`,
      });
    }
    const s1 = await devirBasla(h);
    assert.deepEqual(ozetVer(h, "OZET-METNI-ORNEK"), { kabul: true });
    insan(h, 2, "bekleyen");
    await devirTuruBitir(s1);

    const s2 = await yeniAcilan(h, 1);
    const argv = [...s2.istek.argv];
    assert.equal(argv.includes("--resume"), false);
    const yeniUuid = argv[argv.indexOf("--session-id") + 1]!;
    assert.notEqual(yeniUuid, oturumKimligi(s1));
    assert.deepEqual(
      h.kopru.uretilen.map((u) => u.kapsam),
      [
        erenKapsami(1),
        erenKapsami(2),
      ],
    );
    const mcp = JSON.parse(h.d.dosya.icerik(mcpYolu(2)) ?? "null") as J;
    assert.equal(mcp["mcpServers"]["eren"]["env"]["EREN_KOPRU_JETON"], h.kopru.uretilen[1]!.jeton);
    assert.equal(s1.canli, true, "yeni doğrulanmadan eski kapanmaz");

    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    assert.equal(s2.yazilanlar.length, 1, "yeni ana oturumun ilk ve tek satırı");
    const l = ilkSatir(s2);
    assert.equal(l["isSynthetic"], true);
    assert.equal(l["client_composed"], true);
    const c = icerik(l);
    const ozetYeri = c.indexOf("OZET-METNI-ORNEK");
    assert.ok(ozetYeri >= 0);
    assert.ok(c.lastIndexOf("<<<okunan-metin", ozetYeri) >= 0 && c.indexOf("<<<okunan-metin-sonu", ozetYeri) > ozetYeri, "özet citleSar içinde");
    assert.ok(c.includes("Ornek is basligi"));
    assert.ok(c.includes(`${is_id}`));
    assert.ok(c.includes("soru1") || c.includes("bekliyor"));
    assert.equal(c.includes("GIZLI-SORU-XYZ"), false, "soru metni yok");
    for (const harf of "ABCDE") assert.equal(c.includes(`satir-${harf}-son`), false, `son 10 dışında ${harf}`);
    for (const harf of "FGHIJKL") assert.ok(c.includes(`satir-${harf}-son`), harf);
    assert.equal(c.includes("‮"), false, "bidi karakter kaçırılmış");

    // yeni ana oturumun ilk result'ı hatasız: eski kapanır, nesil ancak şimdi 2 olur
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.equal(h.depo.sonNesil(h.sec)?.nesil, 2);
    assert.equal(h.konusma.nesil(), 2);
    assert.equal(s1.stdinKapandi, true);
    assert.equal(h.d.surec.oldurmalar.some((o) => o.pid === s1.pid), false, "5 sn dolmadan öldürülmez");
    h.d.zaman.ilerlet(5000);
    await bosalt();
    assert.ok(h.d.surec.oldurmalar.some((o) => o.tur === "agac" && o.pid === s1.pid));
    assert.deepEqual(h.kopru.iptal, [erenKapsami(1)]);
    assert.deepEqual(
      devirOlaylari(h).map((o) => [o.nesil, o.ozet_kabul]),
      [[2, true]],
    );
    // devir turu telefonda görünmez: olay yok
    const metinler = (olayTur(h, "assistant_message") as Array<Extract<Olay, { type: "assistant_message" }>>).map((o) => o.text);
    assert.equal(metinler.includes("devir turu metni"), false);
    // kuyruk akar
    assert.equal(icerik(satirlar(s2)[1]!), "bekleyen");
  });

  it("özet gelmezse: result sonunda ozet_kabul false, yalnız DB ile devam (özet çiti yok)", async () => {
    const h = kur();
    isVeSoru(h.depo);
    const s1 = await devirBasla(h);
    await devirTuruBitir(s1);
    const s2 = await yeniAcilan(h, 1);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    assert.equal(icerik(ilkSatir(s2)).includes("<<<okunan-metin"), false);
    assert.ok(icerik(ilkSatir(s2)).includes("Ornek is basligi"));
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.deepEqual(
      devirOlaylari(h).map((o) => [o.nesil, o.ozet_kabul]),
      [[2, false]],
    );
  });

  it("devirOzetiBeklemeMs dolarsa: ozet_kabul false ve devam", async () => {
    const h = kur();
    const s1 = await devirBasla(h);
    h.d.zaman.ilerlet(119_999);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 1);
    h.d.zaman.ilerlet(1);
    const s2 = await yeniAcilan(h, 1);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.equal(devirOlaylari(h)[0]?.ozet_kabul, false);
    void s1;
  });

  it("tur hatalıysa özet kabul sayılmaz", async () => {
    const h = kur();
    const s1 = await devirBasla(h);
    assert.deepEqual(ozetVer(h, "ozet"), { kabul: true });
    await devirTuruBitir(s1, { is_error: true, stop_reason: "refusal" });
    const s2 = await yeniAcilan(h, 1);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.equal(devirOlaylari(h)[0]?.ozet_kabul, false);
  });

  it("yeni ana oturumun ilk result'ı hatalıysa: yeni öldürülür, eski sürer, sonraki tur sınırında yeniden denenir", async () => {
    const h = kur();
    const s1 = await devirBasla(h);
    ozetVer(h, "ozet");
    await devirTuruBitir(s1);
    const s2 = await yeniAcilan(h, 1);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    s2.stdoutSatiriGonder(sonuc({ is_error: true, stop_reason: "refusal" }));
    await bosalt();
    h.d.zaman.ilerlet(10_000);
    await bosalt();
    assert.ok(h.d.surec.oldurmalar.some((o) => o.pid === s2.pid));
    assert.equal(s1.stdinKapandi, false);
    assert.equal(s1.canli, true);
    assert.equal(devirOlaylari(h).length, 0);
    assert.deepEqual(h.kopru.iptal.filter((k) => k.rol === "eren" && (k as { nesil: number }).nesil === 1), []);
    // eski ana oturum çalışmaya devam eder
    const once = s1.yazilanlar.length;
    insan(h, 5, "devam");
    await bosalt();
    assert.equal(s1.yazilanlar.length, once + 1);
    s1.stdoutSatiriGonder(asistan("m9", 300_000));
    s1.stdoutSatiriGonder(sonuc());
    await bosalt();
    const devirSayisi = satirlar(s1).filter((l) => l["isSynthetic"] === true && icerik(l).includes("devir_ozeti")).length;
    assert.equal(devirSayisi, 2, "tur sınırında yeniden denendi");
  });

  it("art arda iki hata turu: özet istenmez, yalnız veritabanıyla devir", async () => {
    const h = kur();
    isVeSoru(h.depo);
    const s1 = await ac(h);
    const hata = sonuc({ is_error: true, stop_reason: "refusal", result: "red" });
    await turYap(h, s1, 1, hata);
    assert.equal(h.d.surec.borulular().length, 1, "tek hata yetmez");
    await turYap(h, s1, 2, hata);
    assert.equal(devirIstendi(s1), false);
    const s2 = await yeniAcilan(h, 1);
    assert.equal(s2.istek.argv.includes("--resume"), false);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    assert.equal(icerik(ilkSatir(s2)).includes("<<<okunan-metin"), false);
    assert.ok(icerik(ilkSatir(s2)).includes("Ornek is basligi"));
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.deepEqual(
      devirOlaylari(h).map((o) => [o.nesil, o.ozet_kabul]),
      [[2, false]],
    );
  });

  it("hata, tamam, hata ardışık değildir: devir yok", async () => {
    const h = kur();
    const s1 = await ac(h);
    const hata = sonuc({ is_error: true, stop_reason: "refusal", result: "red" });
    await turYap(h, s1, 1, hata);
    await turYap(h, s1, 2, sonuc());
    await turYap(h, s1, 3, hata);
    assert.equal(h.d.surec.borulular().length, 1);
  });

  it("soru cevabı ve rapor gövdesi hiçbir stdin satırında yok (devir dahil)", async () => {
    const h = kur();
    const is_id = isVeSoru(h.depo);
    h.depo.olayEkle({ sohbet_id: ANA, type: "question_asked", soru_id: "soru1", is_id, soru: "GIZLI-SORU-XYZ" });
    h.depo.olayEkle({ sohbet_id: ANA, type: "question_resolved", soru_id: "soru1", is_id, sonuc: "cevaplandi", cevap: "GIZLI-CEVAP-XYZ" });
    h.depo.olayEkle({
      sohbet_id: ANA,
      type: "job_finished",
      is_id,
      durum: "tamam",
      kirli: false,
      rapor: { yapildi: ["GIZLI-RAPOR-XYZ"], yapilmadi: [], dosyalar: [], acik_noktalar: [] },
    });
    const s1 = await ac(h);
    h.veriyolu.yayinla("soru_durumu", { sohbet_id: ANA, soru_id: "soru1", is_id, durum: "soruldu" });
    await bosalt();
    s1.stdoutSatiriGonder(sonuc());
    await bosalt();
    h.veriyolu.yayinla("soru_durumu", { sohbet_id: ANA, soru_id: "soru1", is_id, durum: "cevaplandi" });
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id, plan_id: "plan1", tur: "pc", durum: "tamam", kirli: false });
    await bosalt();
    s1.stdoutSatiriGonder(sonuc());
    await bosalt();
    await turYap(h, s1, 9, asistan("m1", 300_000), sonuc());
    ozetVer(h, "ozet");
    await devirTuruBitir(s1);
    const s2 = await yeniAcilan(h, 1);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    const hepsi = h.d.surec.borulular().flatMap((s) => s.yazilanlar).join("\n");
    assert.ok(hepsi.length > 0);
    for (const gizli of ["GIZLI-SORU-XYZ", "GIZLI-CEVAP-XYZ", "GIZLI-RAPOR-XYZ"]) {
      assert.equal(hepsi.includes(gizli), false, gizli);
    }
    assert.ok(hepsi.includes("kullanıcıya soru sordu"));
    assert.ok(hepsi.includes("sorusu: cevaplandı."));
  });
});

// ---------------------------------------------------------------------------------------------
// Kurtarma
// ---------------------------------------------------------------------------------------------

describe("kurtarma", () => {
  const acikTur = (kismi: string) => ({
    turn_id: "tur1",
    sohbet_id: ANA,
    nesil: 1,
    kaynak: "insan" as const,
    gorunur: true,
    baslangic_ms: 1000,
    bitis_ms: null,
    bitis: null,
    kismi_metin: kismi,
  });

  it("canlı kayıtlı süreç öldürülür, açık tur surec_oldu, --resume ve ilk satır kurtarma notu", async () => {
    const h = kur();
    const T = h.d.zaman.simdi();
    h.d.surec.surecEkle({ pid: 777, ppid: 1, olusturmaMs: T });
    h.depo.nesilEkle(nesilKaydi({ pid: 777, olusturma_ms: T }));
    h.depo.turEkle(acikTur("yarım cevap"));
    const s = await ac(h);
    assert.deepEqual(h.d.surec.oldurmalar, [{ tur: "agac", pid: 777 }]);
    const t = olayTur(h, "turn_aborted") as Array<Extract<Olay, { type: "turn_aborted" }>>;
    assert.equal(t.length, 1);
    assert.equal(t[0]!.turn_id, "tur1");
    assert.equal(t[0]!.neden, "surec_oldu");
    assert.equal(t[0]!.kismi_metin, "yarım cevap");
    assert.deepEqual(s.istek.argv.slice(-2), ["--resume", "11111111-1111-4111-8111-111111111111"]);
    const l = satirlar(s);
    assert.equal(l.length, 1);
    assert.equal(l[0]!["isSynthetic"], true);
    assert.ok(icerik(l[0]!).includes("yarım cevap"));
    assert.ok(icerik(l[0]!).includes("araç sonucu bilinmiyor, yan etki olmuş olabilir"));
  });

  it("PID aynı oluşma anı farklı süreç öldürülmez", async () => {
    const h = kur();
    const T = h.d.zaman.simdi();
    h.d.surec.surecEkle({ pid: 777, ppid: 1, olusturmaMs: T + 600_000 });
    h.depo.nesilEkle(nesilKaydi({ pid: 777, olusturma_ms: T }));
    await basla(h);
    await bosalt();
    assert.deepEqual(h.d.surec.oldurmalar, []);
  });

  it("kurtarma notundaki yarım metin 2000 karakterle sınırlı", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi());
    h.depo.turEkle(acikTur("Ж".repeat(3000)));
    const s = await ac(h);
    const c = icerik(satirlar(s)[0]!);
    const say = c.split("Ж").length - 1;
    assert.ok(say > 0 && say <= 2000, `${say} karakter`);
  });

  it("hiç nesil yoksa --session-id ile ilk açılış, kurtarma notu yok", async () => {
    const h = kur();
    const s = await ac(h);
    assert.ok(s.istek.argv.includes("--session-id"));
    assert.equal(s.yazilanlar.length, 0);
  });

  it("açık tur olmadan resume: not yok", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi());
    const s = await ac(h);
    assert.equal(s.yazilanlar.length, 0);
  });

  it("süreç çalışırken ölürse: açık tur surec_oldu, erenYenidenBaslatmaMs sonra --resume ve bildirim", async () => {
    const h = kur();
    const s1 = await ac(h);
    insan(h, 1);
    await bosalt();
    s1.stdoutSatiriGonder(parca("yarım "));
    s1.cik(1);
    await bosalt();
    const t = olayTur(h, "turn_aborted") as Array<Extract<Olay, { type: "turn_aborted" }>>;
    assert.deepEqual(
      t.map((x) => [x.neden, x.kismi_metin]),
      [["surec_oldu", "yarım "]],
    );
    h.d.zaman.ilerlet(29_999);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 1);
    h.d.zaman.ilerlet(1);
    const s2 = await yeniAcilan(h, 1);
    assert.deepEqual(s2.istek.argv.slice(-2), ["--resume", oturumKimligi(s1)]);
    const n = olayTur(h, "system_notice") as Array<Extract<Olay, { type: "system_notice" }>>;
    assert.ok(n.some((x) => x.kod === "eren_yeniden_basladi"));
    assert.deepEqual(
      n.filter((x) => x.kod === "eren_yeniden_basladi").map((x) => x.metin),
      ["Claude süreci beklenmedik biçimde kapandı, yeniden başlatıldı."],
      "görünen ad Ayar.asistanAdi (varsayılan Claude)",
    );
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    assert.ok(icerik(satirlar(s2)[0]!).includes("yarım"));
  });

  it("resume iki kez başarısızsa yalnız DB ile yeni nesil (--session-id)", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi());
    await basla(h);
    await bosalt();
    const kullanilan: string[] = [];
    for (let i = 0; i < 8; i++) {
      const l = h.d.surec.borulular();
      const son = l[l.length - 1]!;
      const resume = son.istek.argv.includes("--resume");
      kullanilan.push(resume ? "resume" : "yeni");
      if (!resume) break;
      son.cik(1);
      await bosalt();
      h.d.zaman.ilerlet(30_000);
      await bosalt();
      if (h.d.surec.borulular().length === l.length) break;
    }
    assert.deepEqual(kullanilan, ["resume", "resume", "yeni"]);
    const son = h.d.surec.sonBorulu();
    son.stdoutSatiriGonder(initSatiri(son));
    await bosalt();
    son.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.equal(h.depo.sonNesil(h.sec)?.nesil, 2);
    assert.notEqual(h.depo.sonNesil(h.sec)?.session_id, "11111111-1111-4111-8111-111111111111");
  });

  it("init'siz hatalı result basıp çıkan resume iki kez sayılır, üçüncüde --session-id ile nesil+1", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi());
    await basla(h);
    await bosalt();
    for (let i = 0; i < 2; i++) {
      const l = h.d.surec.borulular();
      const son = l[l.length - 1]!;
      assert.ok(son.istek.argv.includes("--resume"));
      son.stdoutSatiriGonder(sonuc({ is_error: true, subtype: "error_during_execution", result: "" }));
      await bosalt();
      son.cik(1);
      await bosalt();
      h.d.zaman.ilerlet(30_000);
      await bosalt();
    }
    const son = h.d.surec.sonBorulu();
    assert.equal(son.istek.argv.includes("--resume"), false);
    assert.ok(son.istek.argv.includes("--session-id"));
    son.stdoutSatiriGonder(initSatiri(son));
    await bosalt();
    son.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.equal(h.depo.sonNesil(h.sec)?.nesil, 2);
  });

  it("init + başarılı result resume sayacını sıfırlar", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi());
    await basla(h);
    await bosalt();
    let son = h.d.surec.sonBorulu();
    son.stdoutSatiriGonder(sonuc({ is_error: true, result: "" }));
    await bosalt();
    son.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    son = h.d.surec.sonBorulu();
    assert.ok(son.istek.argv.includes("--resume"));
    son.stdoutSatiriGonder(initSatiri(son));
    await bosalt();
    son.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    // Sayaç sıfırlandı: tekrar bir hata daha, hâlâ resume.
    son.stdoutSatiriGonder(sonuc({ is_error: true, result: "" }));
    await bosalt();
    const sayi = h.d.surec.borulular().length;
    son.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    const yeni = h.d.surec.borulular();
    assert.equal(yeni.length, sayi + 1);
    assert.ok(yeni[yeni.length - 1]!.istek.argv.includes("--resume"));
  });
});

// ---------------------------------------------------------------------------------------------
// Limit kilidi
// ---------------------------------------------------------------------------------------------

describe("kilit", () => {
  it("kilitliyken başlatma yok; mesaj kabul edilir; kilit açılınca --resume ile döner, kuyruk akar", async () => {
    const h = kur({ kilitli: true });
    h.depo.nesilEkle(nesilKaydi());
    await basla(h);
    await bosalt();
    assert.equal(h.d.surec.baslatmalar.length, 0);
    assert.equal(h.konusma.durum(), "kapali");
    const { seq } = insan(h, 1, "kilitliyken");
    assert.ok(seq >= 1);
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.d.surec.baslatmalar.length, 0);

    h.kilitDegis({ tur: "serbest" });
    await bosalt();
    const s = h.d.surec.sonBorulu();
    assert.deepEqual(s.istek.argv.slice(-2), ["--resume", "11111111-1111-4111-8111-111111111111"]);
    s.stdoutSatiriGonder(initSatiri(s));
    await bosalt();
    assert.equal(icerik(satirlar(s).at(-1)!), "kilitliyken");
  });

  it("aktif: ana oturum kapanır, sürüyorsa tur limit_kilit ile kesilir, durum kapali, yeniden başlatma yok", async () => {
    const h = kur();
    const s1 = await ac(h);
    insan(h, 1);
    await bosalt();
    s1.stdoutSatiriGonder(parca("kısmi "));
    h.kilitDegis({ tur: "aktif", sifirlanmaMs: h.d.zaman.simdi() + 3_600_000, yuzde: 98 });
    await bosalt();
    assert.equal(h.konusma.durum(), "kapali");
    assert.equal(s1.stdinKapandi || !s1.canli, true);
    const t = olayTur(h, "turn_aborted") as Array<Extract<Olay, { type: "turn_aborted" }>>;
    assert.deepEqual(
      t.map((x) => [x.neden, x.kismi_metin]),
      [["limit_kilit", "kısmi "]],
    );
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 1, "kilitliyken yeniden başlatılmaz");

    h.kilitDegis({ tur: "serbest" });
    await bosalt();
    const s2 = await yeniAcilan(h, 1);
    assert.deepEqual(s2.istek.argv.slice(-2), ["--resume", oturumKimligi(s1)]);
  });

  it("kilitliyken süreç ölürse yeniden başlatılmaz, açılınca başlar", async () => {
    const h = kur();
    const s1 = await ac(h);
    h.kilitle(false);
    s1.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(60_000);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 1);
    h.kilitDegis({ tur: "serbest" });
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 2);
  });

  it("belirsiz: canlı süreç ve tur dokunulmaz; ölürse başlatılmaz", async () => {
    const h = kur();
    const s1 = await ac(h);
    insan(h, 1);
    await bosalt();
    h.kilitDegis({ tur: "belirsiz", neden: "bozuk" });
    await bosalt();
    assert.equal(s1.canli, true);
    assert.equal(s1.stdinKapandi, false);
    assert.equal(olayTur(h, "turn_aborted").length, 0);
    assert.notEqual(h.konusma.durum(), "kapali");
    s1.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(60_000);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// Limit doluluğu ve kapanış
// ---------------------------------------------------------------------------------------------

describe("diğer", () => {
  it("rate_limit olayı limit_dolulugu yayınlar (olcumMs saat)", async () => {
    const h = kur();
    const s = await ac(h);
    const alinan: Array<ServisOlaylari["limit_dolulugu"]> = [];
    h.veriyolu.dinle("limit_dolulugu", (v) => alinan.push(v));
    s.stdoutSatiriGonder(
      satir({
        type: "rate_limit_event",
        rate_limit_info: {
          unifiedWindows: {
            five_hour: { utilization: 0.5, resetsAt: 1_800_000_000 },
            seven_day: { utilization: 0.25, resetsAt: 1_800_100_000 },
          },
        },
      }),
    );
    await bosalt();
    assert.equal(alinan.length, 1);
    assert.deepEqual(alinan[0]!.doluluk.besSaat, { yuzde: 50, sifirlanmaMs: 1_800_000_000_000 });
    assert.deepEqual(alinan[0]!.doluluk.yediGun, { yuzde: 25, sifirlanmaMs: 1_800_100_000_000 });
    assert.equal(alinan[0]!.doluluk.olcumMs, h.d.zaman.simdi());
  });

  it("kapat: süreç kapanır, yeniden başlatma yok", async () => {
    const h = kur();
    const s = await ac(h);
    await h.konusma.kapat();
    await bosalt();
    assert.equal(h.konusma.durum(), "kapali");
    assert.equal(s.stdinKapandi || !s.canli, true);
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// Regresyonlar
// ---------------------------------------------------------------------------------------------

describe("regresyon: kurtarmada belirsiz canlılık", () => {
  it("surecVarMi iki kez atarsa baslat reddetmez, başlatma ve öldürme yok; iki aralık sonra agaciOldur + tek boruluBaslat", async () => {
    const h = kur();
    const T = h.d.zaman.simdi();
    h.d.surec.surecEkle({ pid: 777, ppid: 1, olusturmaMs: T });
    h.depo.nesilEkle(nesilKaydi({ pid: 777, olusturma_ms: T }));
    const gercek = h.d.surec.surecVarMi.bind(h.d.surec);
    let atilan = 0;
    h.d.surec.surecVarMi = async (k) => {
      if (atilan < 2) {
        atilan++;
        throw new Error("sorgu hatasi");
      }
      return gercek(k);
    };
    await basla(h);
    await bosalt();
    assert.equal(h.d.surec.cagrilar.say("boruluBaslat"), 0);
    assert.deepEqual(h.d.surec.oldurmalar, []);
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    assert.equal(atilan, 2);
    assert.equal(h.d.surec.cagrilar.say("boruluBaslat"), 0);
    assert.deepEqual(h.d.surec.oldurmalar, []);
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    assert.deepEqual(h.d.surec.oldurmalar, [{ tur: "agac", pid: 777 }]);
    assert.equal(h.d.surec.cagrilar.say("boruluBaslat"), 1);
  });
});

describe("regresyon: turKismiYaz son parçadan sonra", () => {
  const kurKayitli = (): { h: Duzen; yazimlar: Array<{ id: string; metin: string }> } => {
    const yazimlar: Array<{ id: string; metin: string }> = [];
    const h = kur({
      depoSarici: (d) => ({
        ...d,
        turKismiYaz: (id, metin) => {
          yazimlar.push({ id, metin });
          d.turKismiYaz(id, metin);
        },
      }),
    });
    return { h, yazimlar };
  };

  it("yeni parça gelmese de ~1 sn sonra gönderilen metnin tamamı yazılır, sonra ek yazım olmaz", async () => {
    const { h, yazimlar } = kurKayitli();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    s.stdoutSatiriGonder(parca("bir "));
    h.d.zaman.ilerlet(100);
    s.stdoutSatiriGonder(parca("iki "));
    h.d.zaman.ilerlet(100);
    const once = yazimlar.length;
    assert.ok(once <= 1);
    h.d.zaman.ilerlet(1000);
    assert.ok(yazimlar.length >= 1);
    assert.equal(yazimlar.at(-1)!.metin, "bir iki ");
    assert.equal(yazimlar.at(-1)!.id, h.konusma.aktifTur()!.turn_id);
    const sonra = yazimlar.length;
    h.d.zaman.ilerlet(10_000);
    assert.equal(yazimlar.length, sonra, "ek yazım yok");
  });

  it("tur kapanınca bekleyen yazım iptal edilir", async () => {
    const { h, yazimlar } = kurKayitli();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    s.stdoutSatiriGonder(parca("bir "));
    h.d.zaman.ilerlet(10);
    s.stdoutSatiriGonder(parca("iki "));
    s.stdoutSatiriGonder(sonuc({ result: "bir iki " }));
    await bosalt();
    const sonra = yazimlar.length;
    h.d.zaman.ilerlet(10_000);
    await bosalt();
    assert.equal(yazimlar.length, sonra, "kapanıştan sonra yazım yok");
  });
});

describe("insanTuru", () => {
  const isBitti = (h: Duzen, n: number): void =>
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: n, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });

  it("insan turunda açık turun turn_id'sini verir; tur bitince null", async () => {
    const h = kur();
    const s = await ac(h);
    assert.equal(h.konusma.insanTuru(), null, "tur yokken");
    insan(h, 1);
    await bosalt();
    const id = h.konusma.insanTuru();
    assert.equal(id, h.konusma.aktifTur()!.turn_id);
    assert.notEqual(id, null);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.konusma.insanTuru(), null);
  });

  it("sentetik ve birleşik sentetik turda null", async () => {
    const h = kur();
    const s = await ac(h);
    isBitti(h, 1);
    await bosalt();
    assert.equal(h.konusma.insanTuru(), null);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    isBitti(h, 2);
    isBitti(h, 3);
    insan(h, 1);
    await bosalt();
    assert.equal(h.konusma.insanTuru(), null, "birleşik sentetik tur");
  });

  it("kurtarma notu turunda null", async () => {
    const h = kur();
    const T = h.d.zaman.simdi();
    h.d.surec.surecEkle({ pid: 777, ppid: 1, olusturmaMs: T });
    h.depo.nesilEkle(nesilKaydi({ pid: 777, olusturma_ms: T }));
    h.depo.turEkle({
      turn_id: "tur1",
      sohbet_id: ANA,
      nesil: 1,
      kaynak: "insan",
      gorunur: true,
      baslangic_ms: 1000,
      bitis_ms: null,
      bitis: null,
      kismi_metin: "yarım cevap",
    });
    const s = await ac(h);
    assert.equal(satirlar(s)[0]!["isSynthetic"], true);
    assert.equal(h.konusma.insanTuru(), null);
  });

  it("devir turunda null", async () => {
    const h = kur();
    const s1 = await ac(h);
    await turYap(h, s1, 1, asistan("m1", 250_000), sonuc({ result: "ilk cevap" }));
    assert.equal(devirIstendi(s1), true);
    assert.equal(h.konusma.insanTuru(), null);
  });

  it("süreç ölünce null", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    assert.notEqual(h.konusma.insanTuru(), null);
    s.cik(1);
    await bosalt();
    assert.equal(h.konusma.insanTuru(), null);
  });

  it("kapanıştan sonra null", async () => {
    const h = kur();
    await ac(h);
    insan(h, 1);
    await bosalt();
    assert.notEqual(h.konusma.insanTuru(), null);
    await h.konusma.kapat();
    await bosalt();
    assert.equal(h.konusma.insanTuru(), null);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 1 (K3): temizlenebilirMi, yeniSayfa, mezar taşında --resume kararı. MODULLER.md "konusma", "Dilim 1".
// Mezar taşı gerçek akıştaki gibi `yeniSayfa`'dan önce yazılır (temizlik 3.2); doğrudan `olayEkle` ile, `depo`'nun
// `gecmisiTemizle`'sine bağlanmadan.
// ---------------------------------------------------------------------------------------------

/** Saat 1 sn ilerler (mezar taşı etkin nesilden yeni olsun), mezar taşı yazılır. */
const mezarYaz = (h: Duzen): MezarTasiOlayi => {
  h.d.zaman.ilerlet(1000);
  return h.depo.olayEkle(olayGirdisi({ type: "chat_cleared", sohbet_id: h.sohbet_id, sinir_seq: h.depo.basSeq() })) as MezarTasiOlayi;
};

const initVerilenler = new WeakSet<SahteBoruluSurec>();
/** `init` bir sürece en çok bir kez gönderilir. */
const initGonder = (s: SahteBoruluSurec): void => {
  if (initVerilenler.has(s) || !s.canli) return;
  initVerilenler.add(s);
  s.stdoutSatiriGonder(initSatiri(s));
};

/**
 * `yeniSayfa` sözünü çözdürür: "kısa bekleme" süresi belgede sabit olmadığından saat 250 ms adımlarla en çok
 * 60 sn ilerler. Çağrıdan sonra açılan her yeni sürece (`init: false` değilse) bir kez `init` gönderilir:
 * söz `init`'i bekliyor olsa da olmasa da çalışır.
 */
async function sayfaBitir(h: Duzen, p: Promise<YeniSayfaSonucu>, sec: { init?: boolean } = {}): Promise<YeniSayfaSonucu> {
  let sonucu: YeniSayfaSonucu | undefined;
  let hata: unknown;
  let atti = false;
  p.then(
    (r) => {
      sonucu = r;
    },
    (e: unknown) => {
      atti = true;
      hata = e;
    },
  );
  const onceki = h.d.surec.borulular().length;
  for (let i = 0; i < 240; i++) {
    await bosalt();
    if (sec.init !== false) for (const s of h.d.surec.borulular().slice(onceki)) initGonder(s);
    await bosalt();
    if (sonucu !== undefined || atti) break;
    h.d.zaman.ilerlet(250);
  }
  assert.equal(atti, false, `yeniSayfa atmaz: ${String(hata)}`);
  assert.ok(sonucu, "yeniSayfa 60 sn içinde çözülmeli");
  return sonucu;
}

const resumeHedefi = (argv: readonly string[]): string | null => {
  const i = argv.indexOf("--resume");
  return i < 0 ? null : argv[i + 1]!;
};

/** `--session-id` ile, `--resume`'suz açılmış; uuid eski oturumların hiçbiri değil. Yeni uuid'i döner. */
const yeniOturumla = (argv: readonly string[], eskiler: readonly string[]): string => {
  assert.equal(argv.includes("--resume"), false, `--resume yapılmamalıydı: ${resumeHedefi(argv)}`);
  const i = argv.indexOf("--session-id");
  assert.ok(i >= 0, "--session-id ile açılmalıydı");
  const yeni = argv[i + 1]!;
  assert.match(yeni, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  for (const e of eskiler) assert.notEqual(yeni, e, "yeni oturum eski bir oturum kimliğini kullanamaz");
  return yeni;
};

const acikInsanTuru = (kismi: string) => ({
  turn_id: "tur1",
  sohbet_id: ANA,
  nesil: 1,
  kaynak: "insan" as const,
  gorunur: true,
  baslangic_ms: 1000,
  bitis_ms: null,
  bitis: null,
  kismi_metin: kismi,
});

describe("Dilim 1: temizlenebilirMi", () => {
  it("hazir'da doğru; başlatılırken (boruluBaslat ile init arası) yanlış", async () => {
    const h = kur();
    await basla(h);
    await bosalt();
    assert.equal(h.konusma.durum(), "baslatiliyor");
    assert.equal(h.konusma.temizlenebilirMi(), false, "init gelmeden");
    const s = h.d.surec.sonBorulu();
    s.stdoutSatiriGonder(initSatiri(s));
    await bosalt();
    assert.equal(h.konusma.durum(), "hazir");
    assert.equal(h.konusma.temizlenebilirMi(), true);
  });

  it("kilitli kapali'da doğru", async () => {
    const h = kur({ kilitli: true });
    h.depo.nesilEkle(nesilKaydi());
    await basla(h);
    await bosalt();
    assert.equal(h.konusma.durum(), "kapali");
    assert.equal(h.d.surec.borulular().length, 0);
    assert.equal(h.konusma.temizlenebilirMi(), true);
  });

  it("açık insan turunda yanlış, tur bitince doğru", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    assert.equal(h.konusma.durum(), "tur_suruyor");
    assert.equal(h.konusma.temizlenebilirMi(), false);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.konusma.temizlenebilirMi(), true);
  });

  it("sentetik ve birleşik sentetik turda yanlış", async () => {
    const h = kur();
    const s = await ac(h);
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 7, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    await bosalt();
    assert.equal(s.yazilanlar.length, 1);
    assert.equal(h.konusma.temizlenebilirMi(), false, "sentetik tur");
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.konusma.temizlenebilirMi(), true);
    insan(h, 1);
    await bosalt();
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 8, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 9, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.ok(icerik(satirlar(s).at(-1)!).includes("İş 9 bitti"), "birleşik sentetik tur açık");
    assert.equal(h.konusma.temizlenebilirMi(), false, "birleşik sentetik tur");
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.konusma.temizlenebilirMi(), true);
  });

  it("kurtarma notu turunda yanlış", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi());
    h.depo.turEkle(acikInsanTuru("yarım cevap"));
    const s = await ac(h);
    assert.equal(satirlar(s).length, 1);
    assert.equal(satirlar(s)[0]!["isSynthetic"], true, "kurtarma notu");
    assert.equal(h.konusma.temizlenebilirMi(), false);
    s.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.equal(h.konusma.temizlenebilirMi(), true);
  });

  it("devir isteği turunda, özet beklerken ve yeni ana oturumun ilk turu bitene dek yanlış; devir bitince doğru", async () => {
    const h = kur();
    const s1 = await ac(h);
    await turYap(h, s1, 1, asistan("m1", 250_000), sonuc({ result: "ilk cevap" }));
    assert.equal(devirIstendi(s1), true);
    assert.equal(h.konusma.temizlenebilirMi(), false, "devir isteği turu");
    assert.deepEqual(ozetVer(h, "ozet"), { kabul: true });
    assert.equal(h.konusma.temizlenebilirMi(), false, "özet alındı, devir turu sürüyor");
    s1.stdoutSatiriGonder(asistan("m2", 1000));
    s1.stdoutSatiriGonder(sonuc({ result: "devir turu metni" }));
    await bosalt();
    const s2 = await yeniAcilan(h, 1);
    assert.equal(h.konusma.temizlenebilirMi(), false, "yeni ana oturum init bekliyor");
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    assert.equal(s2.yazilanlar.length, 1, "devir ilk satırı");
    assert.equal(h.konusma.temizlenebilirMi(), false, "devir ilk turu");
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    h.d.zaman.ilerlet(5000);
    await bosalt();
    assert.equal(olayTur(h, "eren_handover").length, 1);
    assert.equal(h.konusma.temizlenebilirMi(), true);
  });

  it("eşzamanlı ve yan etkisiz: satır, olay, süreç, zamanlayıcı yok", async () => {
    const h = kur();
    const s = await ac(h);
    const seq = h.depo.basSeq();
    const cagri = h.d.surec.cagrilar.say();
    const zaman = h.d.zaman.bekleyenSayisi();
    const yayin = h.olaylar.length;
    for (let i = 0; i < 3; i++) assert.equal(typeof h.konusma.temizlenebilirMi(), "boolean");
    assert.equal(s.yazilanlar.length, 0);
    assert.equal(h.depo.basSeq(), seq);
    assert.equal(h.d.surec.cagrilar.say(), cagri);
    assert.equal(h.d.zaman.bekleyenSayisi(), zaman);
    assert.equal(h.olaylar.length, yayin);
  });
});

describe("Dilim 1: yeniSayfa", () => {
  it("çağrı anında (ilk await'ten önce): temizlenebilirMi yanlış, insanTuru null, durum baslatiliyor yayını", async () => {
    const h = kur();
    await ac(h);
    mezarYaz(h);
    const p = h.konusma.yeniSayfa();
    assert.equal(h.konusma.temizlenebilirMi(), false, "sayfa sırasında");
    assert.equal(h.konusma.insanTuru(), null);
    assert.equal(h.konusma.durum(), "baslatiliyor");
    const durumlar = h.olaylar
      .filter((o) => o.ad === "eren_durumu")
      .map((o) => (o.veri as ServisOlaylari["eren_durumu"]).durum);
    assert.equal(durumlar.at(-1), "baslatiliyor", "eren_durumu yayınlandı");
    await sayfaBitir(h, p);
    assert.equal(h.konusma.durum(), "hazir");
    assert.equal(h.konusma.temizlenebilirMi(), true, "sayfa bitip yeni süreç hazırken");
  });

  it("sıra: eski süreç stdinKapat → agaciOldur ve eski jeton iptali, ANCAK SONRA yeni boruluBaslat", async () => {
    const h = kur();
    const s1 = await ac(h);
    await turYap(h, s1, 1, sonuc({ result: "cevap" }));
    mezarYaz(h);
    h.sira.length = 0;
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    const eskiIptal = `jetonIptal:${kapsamMetni(erenKapsami(1))}`;
    const iKapat = h.sira.indexOf(`stdinKapat:${s1.pid}`);
    const iOldur = h.sira.indexOf(`agaciOldur:${s1.pid}`);
    const iIptal = h.sira.indexOf(eskiIptal);
    const iBaslat = h.sira.findIndex((x) => x.startsWith("boruluBaslat:"));
    assert.ok(iKapat >= 0, `eski süreçte stdinKapat yok: ${h.sira.join(", ")}`);
    assert.ok(iOldur >= 0, `eski süreçte agaciOldur yok: ${h.sira.join(", ")}`);
    assert.ok(iIptal >= 0, `eski neslin eren jetonu iptal edilmedi: ${h.sira.join(", ")}`);
    assert.ok(iBaslat >= 0, "yeni süreç açılmadı");
    assert.ok(iKapat < iOldur, "önce stdinKapat, sonra agaciOldur");
    assert.ok(iOldur < iBaslat, "eski süreç öldürülmeden yeni süreç açıldı");
    assert.ok(iIptal < iBaslat, "eski jeton iptal edilmeden yeni süreç açıldı");
    assert.equal(h.sira.filter((x) => x.startsWith("boruluBaslat:")).length, 1, "tek yeni süreç");
    assert.equal(s1.canli, false);
    assert.deepEqual(satirlar(s1).map(icerik), ["merhaba 1"], "eski sürece sayfada satır gitmez");
    assert.equal(r.eski_surec_cikti, true);
    assert.equal(r.yeni_nesil_acildi, true);
  });

  it("yeni süreç: farklı uuid ile --session-id, --resume yok, aynı bayraklar, nesil+1 yeni jeton; ilk satır yok", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    await turYap(h, s1, 1, parca("biraz metin "), sonuc({ result: "cevap" }));
    mezarYaz(h);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(h.d.surec.borulular().length, 2);
    const s2 = h.d.surec.sonBorulu();
    const B = yeniOturumla(s2.istek.argv, [A]);
    // Dilim 2: --mcp-config yeni neslin dosyası; oturum kimliği ve mcp yolu dışında aynı bayraklar.
    assert.equal(mcpConfig(s1), mcpYolu(1));
    assert.equal(mcpConfig(s2), mcpYolu(2));
    const mcpsiz = (a: readonly string[]): string[] => a.slice(0, -1).map((x, i, l) => (l[i - 1] === "--mcp-config" ? "<mcp>" : x));
    assert.deepEqual(mcpsiz(s2.istek.argv), mcpsiz(s1.istek.argv), "oturum kimliği ve mcp yolu dışında aynı bayraklar");
    assert.equal(s2.istek.exe, EXE);
    assert.equal(s2.istek.cwd, ERENCWD);

    // Jeton: yeni nesil kapsamlı yeni jeton, eren-mcp.json yeniden yazıldı; eski jeton iptal, yeni değil.
    assert.deepEqual(
      h.kopru.uretilen.map((u) => u.kapsam),
      [
        erenKapsami(1),
        erenKapsami(2),
      ],
    );
    const mcp = JSON.parse(h.d.dosya.icerik(mcpYolu(2)) ?? "null") as J;
    assert.equal(mcp["mcpServers"]["eren"]["env"]["EREN_KOPRU_JETON"], h.kopru.uretilen[1]!.jeton);
    assert.ok(h.kopru.iptal.some((k) => k.rol === "eren" && k.nesil === 1));
    assert.equal(
      h.kopru.iptal.some((k) => k.rol === "eren" && k.nesil === 2),
      false,
      "yeni neslin jetonu iptal edilmez",
    );

    // Sonuç: eski oturumlar yalnız eski nesil; yeni oturum içinde yok.
    assert.deepEqual([...r.eski_oturumlar], [A]);
    assert.equal(r.eski_oturumlar.includes(B), false);

    // İlk satır yok: devir notu, özet, DB durumu, son konuşma, kurtarma notu.
    initGonder(s2);
    await bosalt();
    h.d.zaman.ilerlet(5000);
    await bosalt();
    assert.equal(s2.yazilanlar.length, 0, "yeni sürecin stdin'ine ilk satır gitmez");
    assert.equal(h.konusma.durum(), "hazir");

    // Bilinçli kapatılan eski süreç için yeniden başlatma yok: tek ana oturum.
    h.d.zaman.ilerlet(60_000);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 2, "eski sürecin ölümü yeniden başlatma tetiklemez");
    assert.equal(s2.canli, true);

    // Yeni oturumda tur akar; nesil 2 yeni oturumla kalıcı.
    insan(h, 2, "yeni sayfada ilk");
    await bosalt();
    assert.deepEqual(satirlar(s2).map(icerik), ["yeni sayfada ilk"]);
    assert.deepEqual(satirlar(s2)[0]!["origin"], { kind: "human" });
    assert.equal(h.konusma.insanTuru(), h.konusma.aktifTur()?.turn_id);
    s2.stdoutSatiriGonder(sonuc({ result: "tamam" }));
    await bosalt();
    assert.equal(h.konusma.nesil(), 2);
    assert.equal(h.depo.sonNesil(h.sec)?.nesil, 2);
    assert.equal(h.depo.sonNesil(h.sec)?.session_id, B);

    // Sayfadan sonra mezar taşı artık son nesilden eski: çökmede yeni oturuma --resume (yeni sayfa döngüye girmez).
    s2.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(30_000);
    const s3 = await yeniAcilan(h, 2);
    assert.equal(resumeHedefi(s3.istek.argv), B);
  });

  it("eski_oturumlar önceki BÜTÜN nesillerin oturumlarını içerir, yeninin değil", async () => {
    const h = kur();
    const A = "11111111-1111-4111-8111-111111111111";
    const B = "33333333-3333-4333-8333-333333333333";
    h.depo.nesilEkle(nesilKaydi({ nesil: 1, session_id: A, baslangic_ms: 1000, bitis_ms: 2000, ozet_kabul: true }));
    h.depo.nesilEkle(nesilKaydi({ nesil: 2, session_id: B, baslangic_ms: 3000 }));
    const s1 = await ac(h);
    assert.equal(resumeHedefi(s1.istek.argv), B);
    mezarYaz(h);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    const s2 = h.d.surec.sonBorulu();
    assert.notEqual(s2, s1);
    const C = yeniOturumla(s2.istek.argv, [A, B]);
    assert.deepEqual([...r.eski_oturumlar].sort(), [A, B].sort());
    assert.equal(r.eski_oturumlar.includes(C), false);
    assert.ok(
      h.kopru.uretilen.some((u) => u.kapsam.rol === "eren" && u.kapsam.nesil === 3),
      "yeni jeton nesil 3",
    );
    assert.ok(
      h.kopru.iptal.some((k) => k.rol === "eren" && k.nesil === 2),
      "etkin eski neslin jetonu iptal",
    );
    await turYap(h, s2, 1, sonuc({ result: "" }));
    assert.equal(h.konusma.nesil(), 3);
    assert.equal(h.depo.sonNesil(h.sec)?.session_id, C);
  });

  it("sayfa sırasında gelen insan mesajı kaybolmaz: eski sürece gitmez, kuyrukta bekler, yeni oturumda tek tur olarak akar", async () => {
    const h = kur();
    const s1 = await ac(h);
    mezarYaz(h);
    const p = h.konusma.yeniSayfa();
    const m1 = insan(h, 7, "sayfa sırasında bir");
    await bosalt();
    h.d.zaman.ilerlet(100);
    await bosalt();
    const m2 = insan(h, 8, "sayfa sırasında iki");
    assert.equal(s1.yazilanlar.length, 0, "eski sürece satır gitmez");
    const echo = olayTur(h, "user_echo") as Array<Extract<Olay, { type: "user_echo" }>>;
    assert.deepEqual(
      echo.map((o) => [o.seq, o.text]),
      [
        [m1.seq, "sayfa sırasında bir"],
        [m2.seq, "sayfa sırasında iki"],
      ],
    );
    await sayfaBitir(h, p);
    assert.equal(s1.yazilanlar.length, 0, "eski sürece satır gitmez");
    const s2 = h.d.surec.sonBorulu();
    assert.notEqual(s2, s1);
    initGonder(s2);
    await bosalt();
    assert.deepEqual(satirlar(s2).map(icerik), ["sayfa sırasında bir"], "ilk insan mesajı tek satır, birleşmez");
    assert.deepEqual(satirlar(s2)[0]!["origin"], { kind: "human" });
    assert.equal("isSynthetic" in satirlar(s2)[0]!, false);
    assert.notEqual(h.konusma.insanTuru(), null, "yeni oturumdaki insan turu");
    s2.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.deepEqual(satirlar(s2).map(icerik), ["sayfa sırasında bir", "sayfa sırasında iki"]);
    s2.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.depo.kuyrukBasi(h.sec), null);
    assert.equal(s2.yazilanlar.length, 2);
  });

  it("yarım tur notu atılır: çökme sonrası beklerken sayfa açılırsa yarım metin yeni oturuma gitmez, bekleyen yeniden başlatma ikinci süreç açmaz", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    insan(h, 1);
    await bosalt();
    s1.stdoutSatiriGonder(parca("YARIM-METIN "));
    s1.cik(1);
    await bosalt();
    const t = olayTur(h, "turn_aborted") as Array<Extract<Olay, { type: "turn_aborted" }>>;
    assert.deepEqual(
      t.map((x) => [x.neden, x.kismi_metin]),
      [["surec_oldu", "YARIM-METIN "]],
    );
    mezarYaz(h);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(r.eski_surec_cikti, true, "süreç zaten yoktu");
    // Dilim 2: ölümde yuva bırakıldı (SurecKapisi yorumu); yuva tutmayan örnekte sayfa süreç açmaz.
    assert.equal(r.yeni_nesil_acildi, false);
    assert.deepEqual([...r.eski_oturumlar], [A]);
    for (let i = 0; i < 4; i++) {
      h.d.zaman.ilerlet(30_000);
      await bosalt();
      for (const s of h.d.surec.borulular().slice(1)) initGonder(s);
      await bosalt();
    }
    assert.ok(h.d.surec.borulular().length <= 2, "bekleyen çökme yeniden başlatması ikinci ana oturum açmaz");
    // Sonraki açılış (bekleyen yeniden başlatma ya da ilk mesaj) yeni oturumdur, kurtarma notu yok.
    insan(h, 2, "sayfa sonrası");
    await bosalt();
    for (const s of h.d.surec.borulular().slice(1)) initGonder(s);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 2, "tek yeni ana oturum");
    const s2 = h.d.surec.sonBorulu();
    yeniOturumla(s2.istek.argv, [A]);
    assert.equal(s2.canli, true);
    assert.deepEqual(satirlar(s2).map(icerik), ["sayfa sonrası"], "kurtarma notu yok, ilk satır insan mesajı");
    const hepsi = h.d.surec
      .borulular()
      .slice(1)
      .flatMap((s) => s.yazilanlar)
      .join("\n");
    assert.equal(hepsi.includes("YARIM-METIN"), false);
    assert.equal(hepsi.includes("araç sonucu bilinmiyor"), false);
  });

  it("kilitliyken: eski süreç kapanır, yeni süreç açılmaz (yeni_nesil_acildi false); kilit açılınca --session-id, --resume yok", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    mezarYaz(h);
    h.kilitle(false);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(r.yeni_nesil_acildi, false);
    assert.equal(r.eski_surec_cikti, true);
    assert.deepEqual([...r.eski_oturumlar], [A]);
    assert.equal(s1.canli, false);
    assert.ok(h.d.surec.oldurmalar.some((o) => o.tur === "agac" && o.pid === s1.pid));
    assert.ok(h.kopru.iptal.some((k) => k.rol === "eren" && k.nesil === 1));
    assert.equal(h.d.surec.borulular().length, 1, "kilitliyken yeni süreç yok");
    assert.equal(h.konusma.durum(), "kapali");
    assert.equal(h.konusma.temizlenebilirMi(), true, "kilitli kapali");
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 1);

    h.kilitDegis({ tur: "serbest" });
    const s2 = await yeniAcilan(h, 1);
    yeniOturumla(s2.istek.argv, [A]);
    initGonder(s2);
    await bosalt();
    assert.equal(s2.yazilanlar.length, 0, "ilk satır yok");
  });

  it("kilitli ve süreç yokken: öldürme yok, eski_surec_cikti true; kilit açılınca --session-id", async () => {
    const h = kur({ kilitli: true });
    const A = "11111111-1111-4111-8111-111111111111";
    h.depo.nesilEkle(nesilKaydi({ session_id: A }));
    await basla(h);
    await bosalt();
    mezarYaz(h);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(r.eski_surec_cikti, true);
    assert.equal(r.yeni_nesil_acildi, false);
    assert.deepEqual([...r.eski_oturumlar], [A]);
    assert.deepEqual(h.d.surec.oldurmalar, []);
    assert.equal(h.d.surec.borulular().length, 0);
    // Dilim 2: kilitliyken `uyandir` (basla) açamadı; akış 3: "kilit serbest değilse kapali kalır (kilit açılınca açılır)".
    h.kilitDegis({ tur: "serbest" });
    const s = await yeniAcilan(h, 0);
    yeniOturumla(s.istek.argv, [A]);
  });

  it("yeni süreç açılamazsa: yeniSayfa atmaz, eski oturuma hiçbir yoldan --resume yapılmaz", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    mezarYaz(h);
    h.d.surec.sonrakiBaslatmaHatasi(new Error("baslatma hatasi"));
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(r.yeni_nesil_acildi, false);
    assert.equal(r.eski_surec_cikti, true);
    assert.equal(s1.canli, false);
    const argvOf = (c: { args: readonly unknown[] }): readonly string[] => (c.args[0] as { argv: readonly string[] }).argv;
    const ilkDeneme = h.d.surec.cagrilar.hepsi("boruluBaslat")[1];
    assert.ok(ilkDeneme, "sayfa yeni süreci denedi");
    yeniOturumla(argvOf(ilkDeneme), [A]);

    // Sonraki her --resume kararı: zaman (çökme sonrası yeniden başlatma) ve kilit aktif → serbest.
    for (let i = 0; i < 4; i++) {
      h.d.zaman.ilerlet(30_000);
      await bosalt();
    }
    h.kilitDegis({ tur: "aktif", sifirlanmaMs: h.d.zaman.simdi() + 3_600_000, yuzde: 98 });
    await bosalt();
    h.kilitDegis({ tur: "serbest" });
    await bosalt();
    const denemeler = h.d.surec.cagrilar.hepsi("boruluBaslat").slice(1);
    assert.ok(denemeler.length >= 2, "kilit açılınca ana oturum yeniden açılmayı denemeli");
    for (const c of denemeler) assert.notEqual(resumeHedefi(argvOf(c)), A, "eski oturuma --resume yapıldı");
  });

  /** `agaciOldur` kaydedilir ama süreci öldürmez: çıkış gözlenmez, doğrulama `surecVarMi`'ye kalır. */
  const olmeyenSurec = (h: Duzen): void => {
    h.d.surec.agaciOldur = async (pid) => {
      h.d.surec.oldurmalar.push({ tur: "agac", pid });
    };
  };

  it("eski süreç öldürmeden sağ çıkarsa: yeniSayfa atmaz, eski_surec_cikti false", async () => {
    const h = kur();
    const s1 = await ac(h);
    mezarYaz(h);
    olmeyenSurec(h);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.ok(h.d.surec.oldurmalar.some((o) => o.tur === "agac" && o.pid === s1.pid), "öldürme denendi");
    assert.equal(s1.canli, true);
    assert.equal(r.eski_surec_cikti, false, "çıkış doğrulanmadı: transkript silinmemeli");
  });

  it("çıkışı gözlenmemiş eski süreçte surecVarMi atarsa: yeniSayfa atmaz, eski_surec_cikti false", async () => {
    const h = kur();
    await ac(h);
    mezarYaz(h);
    olmeyenSurec(h);
    h.d.surec.surecVarMi = async () => {
      throw new Error("sorgu hatasi");
    };
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(r.eski_surec_cikti, false);
  });
});

describe("Dilim 1: mezar taşı ve --resume kararı", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  /** Mezar taşı yazılır, son nesil ondan `fark` ms sonra başlamış sayılır (negatif: mezar taşı yeni). */
  const hazirla = (h: Duzen, fark: number): void => {
    const m = h.depo.olayEkle(olayGirdisi({ type: "chat_cleared", sohbet_id: h.sohbet_id, sinir_seq: h.depo.basSeq() })) as MezarTasiOlayi;
    h.depo.nesilEkle(nesilKaydi({ session_id: A, baslangic_ms: m.ts_ms + fark }));
  };

  it("açılışta mezar taşı son neslin başlangıcından yeniyse --resume yok: --session-id, yarım metin yeni oturuma gitmez, açık tur yine surec_oldu", async () => {
    const h = kur();
    hazirla(h, -1);
    h.depo.turEkle(acikInsanTuru("YARIM-METIN"));
    const s = await ac(h);
    const B = yeniOturumla(s.istek.argv, [A]);
    const t = olayTur(h, "turn_aborted") as Array<Extract<Olay, { type: "turn_aborted" }>>;
    assert.deepEqual(
      t.map((x) => [x.turn_id, x.neden, x.kismi_metin]),
      [["tur1", "surec_oldu", "YARIM-METIN"]],
    );
    await bosalt();
    assert.equal(s.yazilanlar.length, 0, "kurtarma notu ve yarım metin yok");
    await turYap(h, s, 1, sonuc({ result: "" }));
    assert.equal(satirlar(s).map(icerik).join("\n").includes("YARIM-METIN"), false);
    assert.equal(h.depo.sonNesil(h.sec)?.nesil, 2);
    assert.equal(h.depo.sonNesil(h.sec)?.session_id, B);
  });

  it("açılışta mezar taşı son neslin başlangıcından eskiyse --resume var", async () => {
    const h = kur();
    hazirla(h, 1);
    await basla(h);
    await bosalt();
    assert.equal(resumeHedefi(h.d.surec.sonBorulu().istek.argv), A);
  });

  it("kilit açılınca: mezar taşı yeniyse --resume yok", async () => {
    const h = kur({ kilitli: true });
    hazirla(h, -1);
    await basla(h);
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 0);
    // Dilim 2: kilitliyken `uyandir` (basla) açamadı; akış 3: "kilit serbest değilse kapali kalır (kilit açılınca açılır)".
    h.kilitDegis({ tur: "serbest" });
    const s = await yeniAcilan(h, 0);
    yeniOturumla(s.istek.argv, [A]);
  });

  it("süreç ölünce yeniden başlatmada: mezar taşı yeniyse --resume yok", async () => {
    const h = kur();
    const s1 = await ac(h);
    const S = oturumKimligi(s1);
    mezarYaz(h);
    s1.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(30_000);
    const s2 = await yeniAcilan(h, 1);
    yeniOturumla(s2.istek.argv, [S]);
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 1, gözden geçirme sonrası: ana oturum kaydı (`Depo.oturumKaydet/kayitliOturumlar`) ve
// yeni sayfadan sonraki devir notu.
// ---------------------------------------------------------------------------------------------

/** `--session-id` ile yapılan her başlatma denemesinden önce o uuid `oturumKaydet` ile kaydedilmiş. Açılış sayısını döner. */
const kayitliAcildi = (h: Duzen): number => {
  const acilislar = h.sira.filter((x) => x.startsWith("boruluBaslat:session-id:"));
  for (const a of acilislar) {
    const id = a.slice("boruluBaslat:session-id:".length);
    const iKayit = h.sira.indexOf(`oturumKaydet:${id}`);
    assert.ok(iKayit >= 0, `oturum kaydedilmedi: ${id}`);
    assert.ok(iKayit < h.sira.indexOf(a), `oturumKaydet boruluBaslat'tan sonra: ${id}`);
  }
  return acilislar.length;
};

/** Bitmiş iş (plan + iş satırı); başlık hem planda hem işte. */
function bitmisIs(depo: Depo, baslik: string, baslangic_ms: number, bitis_ms: number, sohbet_id: string = ANA): number {
  const plan_id = `plan-${baslik.toLowerCase()}`;
  const plan = {
    plan_id,
    baslik,
    tur: "pc" as const,
    cwd: "C:\\ornek\\proje",
    gorev_metni: "gorev",
    kesin_yapilacaklar: ["a"],
    kesin_yapilmayacaklar: [],
  };
  depo.planEkle({ plan, plan_hash: "b".repeat(64), durum: "onaylandi", is_id: null, olusturma_ms: baslangic_ms, profil: "tam", sohbet_id });
  return depo.isEkle({
    sohbet_id,
    plan_id,
    plan_hash: "b".repeat(64),
    baslik,
    tur: "pc",
    cwd: "C:\\ornek\\proje",
    durum: "tamam",
    kirli: false,
    session_id: "44444444-4444-4444-8444-444444444444",
    pid: null,
    olusturma_ms: null,
    baslangic_ms,
    bitis_ms,
    out_ofset: 0,
    rapor: null,
    rapor_kaynak: null,
    son_result: null,
    durdurma: null,
  });
}

/** Devir isteği, özet, devir turu biter; aday açılır, `init` alır. Adayı döner (ilk satırı yazılmış). */
async function devirAdayi(h: Duzen, s: SahteBoruluSurec, n: number): Promise<SahteBoruluSurec> {
  await turYap(h, s, n, asistan(`m${n}`, 250_000), sonuc({ result: "cevap" }));
  assert.equal(devirIstendi(s), true);
  assert.deepEqual(ozetVer(h, "ozet"), { kabul: true });
  const once = h.d.surec.borulular().length;
  s.stdoutSatiriGonder(asistan(`m${n}b`, 1000));
  s.stdoutSatiriGonder(sonuc({ result: "devir turu metni" }));
  await bosalt();
  const aday = await yeniAcilan(h, once);
  aday.stdoutSatiriGonder(initSatiri(aday));
  await bosalt();
  return aday;
}

describe("Dilim 1: ana oturum kaydı", () => {
  it("yeni --session-id ile her açılıştan ÖNCE oturumKaydet: ilk nesil, devir adayı, yeni sayfa", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    assert.equal(kayitliAcildi(h), 1, "ilk nesil");
    assert.ok(h.depo.kayitliOturumlar(h.sec).includes(A));

    const aday = await devirAdayi(h, s1, 1);
    const B = oturumKimligi(aday);
    assert.notEqual(B, A);
    assert.equal(kayitliAcildi(h), 2, "devir adayı");
    aday.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    h.d.zaman.ilerlet(5000);
    await bosalt();
    assert.equal(h.konusma.nesil(), 2);

    mezarYaz(h);
    await sayfaBitir(h, h.konusma.yeniSayfa());
    const C = oturumKimligi(h.d.surec.sonBorulu());
    assert.equal(kayitliAcildi(h), 3, "yeni sayfa");
    assert.deepEqual([...h.depo.kayitliOturumlar(h.sec)], [A, B, C], "kayıt sırası açılış sırası");
  });

  it("resume iki kez başarısız olunca açılan yeni nesil de önce kaydedilir", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi());
    await basla(h);
    await bosalt();
    for (let i = 0; i < 2; i++) {
      h.d.surec.sonBorulu().cik(1);
      await bosalt();
      h.d.zaman.ilerlet(30_000);
      await bosalt();
    }
    const son = h.d.surec.sonBorulu();
    assert.ok(son.istek.argv.includes("--session-id"));
    assert.equal(kayitliAcildi(h), 1);
    assert.equal(h.sira.some((x) => x === "oturumKaydet:11111111-1111-4111-8111-111111111111"), false, "resume kaydedilmez");
  });

  it("gözden geçirme senaryosu: devir adayı başarısız, aynı depoda yeni konusmaKur, yeniSayfa: eski_oturumlar adayın uuid'ini içerir", async () => {
    const h1 = kur();
    const s1 = await ac(h1);
    const A = oturumKimligi(s1);
    const aday = await devirAdayi(h1, s1, 1);
    const Y = oturumKimligi(aday);
    aday.stdoutSatiriGonder(sonuc({ is_error: true, stop_reason: "refusal" }));
    await bosalt();
    h1.d.zaman.ilerlet(10_000);
    await bosalt();
    assert.ok(h1.d.surec.oldurmalar.some((o) => o.pid === aday.pid), "aday öldürüldü");
    assert.equal(olayTur(h1, "eren_handover").length, 0, "devir olmadı");

    // Servis yeniden kurulur: bellek içi durum gider, depo kalır.
    await h1.konusma.kapat();
    await bosalt();
    const h2 = kur({ d: h1.d, depo: h1.depo });
    const once = h2.d.surec.borulular().length;
    await basla(h2);
    const s3 = await yeniAcilan(h2, once);
    assert.equal(resumeHedefi(s3.istek.argv), A, "yeniden kurulumda etkin nesil sürdürülür");
    initGonder(s3);
    await bosalt();

    mezarYaz(h2);
    const r = await sayfaBitir(h2, h2.konusma.yeniSayfa());
    const Z = oturumKimligi(h2.d.surec.sonBorulu());
    assert.notEqual(Z, A);
    assert.ok(r.eski_oturumlar.includes(Y), "başarısız devir adayının oturumu eski_oturumlar'da olmalı");
    assert.ok(r.eski_oturumlar.includes(A));
    assert.equal(r.eski_oturumlar.includes(Z), false, "yeni sayfanın kendi oturumu yok");
  });

  it("aynı servis ömründe de: başarısız devir adayının uuid'i eski_oturumlar'da", async () => {
    const h = kur();
    const s1 = await ac(h);
    const aday = await devirAdayi(h, s1, 1);
    const Y = oturumKimligi(aday);
    aday.stdoutSatiriGonder(sonuc({ is_error: true, stop_reason: "refusal" }));
    await bosalt();
    h.d.zaman.ilerlet(10_000);
    await bosalt();
    mezarYaz(h);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.ok(r.eski_oturumlar.includes(Y));
    assert.ok(r.eski_oturumlar.includes(oturumKimligi(s1)));
  });

  it("eski_oturumlar yeni sayfanın kendi oturumunu içermez (kayıt açılıştan önce olsa da); ikinci sayfada öncekininkini içerir", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    mezarYaz(h);
    const r1 = await sayfaBitir(h, h.konusma.yeniSayfa());
    const s2 = h.d.surec.sonBorulu();
    const B = oturumKimligi(s2);
    assert.ok(h.depo.kayitliOturumlar(h.sec).includes(B), "yeni sayfanın oturumu kayıtlı");
    assert.deepEqual([...r1.eski_oturumlar], [A]);

    initGonder(s2);
    await bosalt();
    await turYap(h, s2, 1, sonuc({ result: "" }));
    mezarYaz(h);
    const r2 = await sayfaBitir(h, h.konusma.yeniSayfa());
    const C = oturumKimligi(h.d.surec.sonBorulu());
    assert.deepEqual([...r2.eski_oturumlar].sort(), [A, B].sort());
    assert.equal(r2.eski_oturumlar.includes(C), false);
  });
});

describe("Dilim 1: yeni sayfadan sonraki devir notu", () => {
  it("mezar taşından önce biten işin başlığı yok, mezar taşından sonra biten işinki var", async () => {
    const h = kur();
    await ac(h);
    const t0 = h.d.zaman.simdi();
    bitmisIs(h.depo, "ESKI-IS-BASLIGI", t0 - 5000, t0 - 1000);
    const mezar = mezarYaz(h);
    assert.ok(mezar.ts_ms > t0 - 1000);
    await sayfaBitir(h, h.konusma.yeniSayfa());
    const s2 = h.d.surec.sonBorulu();
    initGonder(s2);
    await bosalt();
    h.d.zaman.ilerlet(2000);
    const t1 = h.d.zaman.simdi();
    bitmisIs(h.depo, "YENI-IS-BASLIGI", t1 - 1000, t1);
    assert.ok(t1 - 1000 > mezar.ts_ms);

    const aday = await devirAdayi(h, s2, 1);
    assert.equal(aday.yazilanlar.length, 1, "devir ilk satırı");
    const c = icerik(satirlar(aday)[0]!);
    assert.ok(c.includes("YENI-IS-BASLIGI"), "mezar taşından sonra biten iş notta olmalı");
    assert.equal(c.includes("ESKI-IS-BASLIGI"), false, "mezar taşından önce biten iş notta olmamalı");
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 2: sohbet başına örnek. MODULLER.md "Dilim 2: çoklu sohbet" > "Modül maddeleri (Dilim 2)" > "konusma
// (örnek)" Bitti; `sozlesme.ts` `Konusma` / `SurecKapisi` / `KonusmaBagimliliklari` yorumları.
// ---------------------------------------------------------------------------------------------

const B_SOHBET = "sohbetB";
const C_SOHBET = "sohbetC";

/** Bir sözü çözdürür (`sayfaBitir` gibi): saat 250 ms adımlarla en çok 60 sn; yeni süreçlere bir kez `init`. */
async function sozBekle<T>(h: Duzen, p: Promise<T>, sec: { init?: boolean } = {}): Promise<T> {
  let sonucu: { v: T } | undefined;
  let hata: unknown;
  let atti = false;
  p.then(
    (v) => {
      sonucu = { v };
    },
    (e: unknown) => {
      atti = true;
      hata = e;
    },
  );
  const onceki = h.d.surec.borulular().length;
  for (let i = 0; i < 240; i++) {
    await bosalt();
    if (sec.init !== false) for (const s of h.d.surec.borulular().slice(onceki)) initGonder(s);
    await bosalt();
    if (sonucu !== undefined || atti) break;
    h.d.zaman.ilerlet(250);
  }
  assert.equal(atti, false, `söz atmamalı: ${String(hata)}`);
  assert.ok(sonucu, "söz 60 sn içinde çözülmeli");
  return sonucu.v;
}

const yolEsit = (a: unknown, b: string): boolean =>
  typeof a === "string" && a.replaceAll("\\", "/") === b.replaceAll("\\", "/");
const silinenYollar = (h: Duzen): unknown[] => h.d.dosya.cagrilar.hepsi("dosyaSil").map((c) => c.args[0]);
const silindiMi = (h: Duzen, yol: string): boolean => silinenYollar(h).some((y) => yolEsit(y, yol));
const durumYayinlari = (h: Duzen): string[] =>
  h.olaylar.filter((o) => o.ad === "eren_durumu").map((o) => (o.veri as ServisOlaylari["eren_durumu"]).durum);
const yenidenBasladiNotu = (h: Duzen): boolean =>
  (olayTur(h, "system_notice") as Array<Extract<Olay, { type: "system_notice" }>>).some(
    (x) => x.kod === "eren_yeniden_basladi",
  );
const olaySohbeti = (o: Olay): string | undefined => (o as { sohbet_id?: string }).sohbet_id;

/** Birden çok örnekte kilit bayrağını çevirir, tek `kilit_degisti` yayınlar (veriyolu ortak). */
const hepsiKilit = (hs: Duzen[], durum: LimitKilitDurumu): void => {
  for (const h of hs) h.kilitle(durum.tur === "serbest");
  hs[0]!.veriyolu.yayinla("kilit_degisti", { durum });
};

/** İlk tur eşiği aşar; devir isteği eski ana oturuma gider (`devir` bloğundaki `devirBasla` gibi). */
async function devirIste(h: Duzen, s: SahteBoruluSurec, n = 1): Promise<void> {
  await turYap(h, s, n, asistan(`d${n}`, 250_000), sonuc({ result: "ilk cevap" }));
  assert.equal(devirIstendi(s), true, "devir istenmeliydi");
}
const devirTuru = async (s: SahteBoruluSurec): Promise<void> => {
  s.stdoutSatiriGonder(asistan("dt", 1000));
  s.stdoutSatiriGonder(sonuc({ result: "devir turu metni" }));
  await bosalt();
};

describe("Dilim 2: baslat, uyandir ve kapı", () => {
  it("baslat süreç açmaz (uyuyor, yuva istemez); uyandir yuva ister ve açar; ikinci uyandir ikinci süreç açmaz", async () => {
    const h = kur();
    await h.konusma.baslat();
    await bosalt();
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.d.surec.cagrilar.say("boruluBaslat"), 0);
    assert.equal(h.konusma.durum(), "uyuyor");
    assert.deepEqual(h.kapi.istekler, []);
    h.konusma.uyandir();
    assert.deepEqual(h.kapi.istekler, [ANA]);
    await bosalt();
    assert.equal(h.surecler.length, 1);
    h.konusma.uyandir();
    await bosalt();
    assert.equal(h.surecler.length, 1, "süreç varken uyandir yeni süreç açmaz");
    initGonder(h.surecler[0]!);
    await bosalt();
    assert.equal(h.konusma.durum(), "hazir");
    assert.deepEqual(durumYayinlari(h).slice(-2), ["baslatiliyor", "hazir"], "eren_durumu sohbet_id'li");
  });

  it("insanMesajiAl süreç yokken uyandir der: yuva istenir, süreç açılır, mesaj ilk satır", async () => {
    const h = kur();
    await h.konusma.baslat();
    await bosalt();
    assert.equal(h.surecler.length, 0);
    insan(h, 1, "ilk mesaj");
    assert.deepEqual(h.kapi.istekler, [ANA]);
    await bosalt();
    const s = h.surecler[0];
    assert.ok(s, "süreç açılmalıydı");
    initGonder(s);
    await bosalt();
    assert.deepEqual(satirlar(s).map(icerik), ["ilk mesaj"]);
  });

  it("yuva yok → sirada, süreç yok, kendiliğinden açılmaz; yuva gelince (yönetici uyandir) açılış ve kuyruk akar", async () => {
    const h = kur();
    h.kapi.izin(false);
    await h.konusma.baslat();
    await bosalt();
    insan(h, 1, "sırada bekleyen");
    await bosalt();
    assert.deepEqual(h.kapi.istekler, [ANA]);
    assert.equal(h.surecler.length, 0, "yuva yokken süreç açılmaz");
    assert.equal(h.konusma.durum(), "sirada");
    assert.equal(durumYayinlari(h).at(-1), "sirada", "eren_durumu sirada yayınlandı");
    assert.equal(h.depo.kuyrukBasi(h.sec)?.metin, "sırada bekleyen", "mesaj kuyrukta bekler");
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.surecler.length, 0, "sıradayken kendi kendine açılmaz");

    h.kapi.izin(true);
    h.konusma.uyandir();
    await bosalt();
    assert.equal(h.surecler.length, 1);
    const s = h.surecler[0]!;
    assert.ok(s.istek.argv.includes("--session-id"), "nesil yokken yeni oturum");
    assert.notEqual(h.konusma.durum(), "sirada");
    initGonder(s);
    await bosalt();
    assert.deepEqual(satirlar(s).map(icerik), ["sırada bekleyen"]);
  });

  it("kuyruk doluyken baslat yuva ister: yuva yoksa sirada, uyandir ile açılır", async () => {
    const h = kur();
    h.depo.kuyrugaEkle("insan", "önceden bekleyen", 1000, h.sec);
    h.kapi.izin(false);
    await h.konusma.baslat();
    await bosalt();
    assert.deepEqual(h.kapi.istekler, [ANA]);
    assert.equal(h.surecler.length, 0);
    assert.equal(h.konusma.durum(), "sirada");
    h.kapi.izin(true);
    h.konusma.uyandir();
    await bosalt();
    const s = h.surecler[0];
    assert.ok(s, "süreç açılmalıydı");
    initGonder(s);
    await bosalt();
    assert.deepEqual(satirlar(s).map(icerik), ["önceden bekleyen"]);
  });

  it("süreç ölünce yeniden başlatma da yuva ister: yuva yoksa sirada, gelince --resume", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    s1.cik(1);
    await bosalt();
    h.kapi.izin(false);
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    assert.equal(h.surecler.length, 1, "yuva yokken yeniden başlatılmaz");
    assert.equal(h.kapi.istekler.length, 2, "yeniden başlatma yuva istedi");
    assert.equal(h.konusma.durum(), "sirada");
    h.kapi.izin(true);
    h.konusma.uyandir();
    await bosalt();
    assert.equal(h.surecler.length, 2);
    assert.equal(resumeHedefi(h.surecler[1]!.istek.argv), A);
  });

  it("kilit serbest: yalnız kilitten önce canlı olan ya da kuyruğu dolan örnek açılır", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const c = ikinci(a, C_SOHBET);
    const sa = await ac(a);
    await b.konusma.baslat();
    await c.konusma.baslat();
    await bosalt();
    assert.equal(b.surecler.length + c.surecler.length, 0);

    hepsiKilit([a, b, c], { tur: "aktif", sifirlanmaMs: a.d.zaman.simdi() + 3_600_000, yuzde: 98 });
    await bosalt();
    assert.equal(a.konusma.durum(), "kapali");
    assert.equal(sa.stdinKapandi || !sa.canli, true);
    assert.deepEqual(a.kapi.birakmalar, [ANA], "kilitte tek yuvaBirak");
    insan(c, 1, "kilitliyken C");
    await bosalt();
    assert.equal(c.surecler.length, 0, "kilitliyken açılmaz");
    a.d.zaman.ilerlet(10 * 60_000);
    await bosalt();

    hepsiKilit([a, b, c], { tur: "serbest" });
    await bosalt();
    assert.equal(a.surecler.length, 2, "önceden canlı örnek yeniden açılır");
    assert.equal(resumeHedefi(a.surecler[1]!.istek.argv), oturumKimligi(sa));
    assert.equal(c.surecler.length, 1, "kuyruğu dolu örnek açılır");
    assert.equal(b.surecler.length, 0, "uyuyan, kuyruğu boş örnek açılmaz");
    assert.equal(b.konusma.durum(), "uyuyor");
  });
});

describe("Dilim 2: yuva bırakma", () => {
  it("süreç ölünce tek yuvaBirak; yeniden açılış yine yuvaIste", async () => {
    const h = kur();
    const s = await ac(h);
    assert.deepEqual(h.kapi.birakmalar, []);
    s.cik(1);
    await bosalt();
    assert.deepEqual(h.kapi.birakmalar, [ANA]);
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    assert.equal(h.surecler.length, 2);
    assert.deepEqual(h.kapi.istekler, [ANA, ANA]);
    assert.deepEqual(h.kapi.birakmalar, [ANA], "yeniden açılışta ek bırakma yok");
  });

  it("yeni sayfada yuvaBirak yok, yuva tutulur", async () => {
    const h = kur();
    await ac(h);
    mezarYaz(h);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(r.yeni_nesil_acildi, true);
    assert.deepEqual(h.kapi.birakmalar, []);
    assert.deepEqual(h.kapi.yuvadakiler(), [ANA]);
  });

  it("yuva tutmayan (uyuyan) örnekte yeni sayfa süreç açmaz: yeni_nesil_acildi false", async () => {
    const h = kur();
    await h.konusma.baslat();
    await bosalt();
    mezarYaz(h);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(r.yeni_nesil_acildi, false);
    assert.equal(h.surecler.length, 0);
  });

  it("sıradayken temizlenen sohbet sırada kalmaz: sayfa başında sirada'dan çıkar, sayfa sürerken gelen uyandir süreç açmaz, kuyruk boşsa uyuyor", async () => {
    // Regresyon (gözden geçirme, hata 2): `yeniSayfa` `sirada`'yı sıfırlamıyordu; temizlik sırasında yer
    // boşalınca `uyandir` `sayfaSuruyor` yüzünden erken dönüyor, boş sohbet süresiz `sirada` görünüyordu.
    const h = kur();
    h.kapi.izin(false);
    await h.konusma.baslat();
    await bosalt();
    insan(h, 1, "temizlenecek");
    await bosalt();
    assert.equal(h.konusma.durum(), "sirada");
    assert.equal(h.konusma.temizlenebilirMi(), true, "sıradayken temizlenebilir");
    // Temizlik: kuyruk dahil geçmiş silinir (mezar taşı), sonra yeni sayfa.
    h.d.zaman.ilerlet(1000);
    h.depo.gecmisiTemizle(h.sec);
    assert.equal(h.depo.kuyrukBasi(h.sec), null);
    const p = h.konusma.yeniSayfa();
    assert.notEqual(durumYayinlari(h).at(-1), "sirada", "sayfa başında sirada'dan çıkış yayınlandı (yönetici sıradan çıkarır)");
    // Sayfa sürerken yer boşaldı: yönetici sıradakine uyandir der.
    h.kapi.izin(true);
    h.konusma.uyandir();
    const r = await sayfaBitir(h, p);
    assert.equal(r.yeni_nesil_acildi, false);
    assert.equal(h.konusma.durum(), "uyuyor", "kuyruğu boş, temizlenmiş sohbet sırada kalmaz");
    assert.equal(durumYayinlari(h).at(-1), "uyuyor");
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.surecler.length, 0, "işi olmayan sohbet için süreç açılmaz");
    assert.deepEqual(h.kapi.istekler, [ANA], "yeniden yuva istenmez");

    // Sonraki mesaj yine yuva ister ve yeni oturum açar.
    insan(h, 2, "sayfa sonrası");
    await bosalt();
    assert.equal(h.surecler.length, 1);
    yeniOturumla(h.surecler[0]!.istek.argv, []);
  });

  it("kilitliyken sıradaki sohbet temizlenirse kilit kalkınca işi olmadığı için süreç açılmaz, yuva istenmez", async () => {
    const h = kur();
    h.kapi.izin(false);
    await h.konusma.baslat();
    await bosalt();
    insan(h, 1, "temizlenecek");
    await bosalt();
    assert.equal(h.konusma.durum(), "sirada");
    h.kilitDegis({ tur: "aktif", sifirlanmaMs: h.d.zaman.simdi() + 3_600_000, yuzde: 98 });
    await bosalt();
    h.d.zaman.ilerlet(1000);
    h.depo.gecmisiTemizle(h.sec);
    const r = await sayfaBitir(h, h.konusma.yeniSayfa());
    assert.equal(r.yeni_nesil_acildi, false);
    const onceki = h.kapi.istekler.length;
    h.kapi.izin(true);
    h.kilitDegis({ tur: "serbest" });
    await bosalt();
    assert.equal(h.surecler.length, 0, "işi olmayan sohbet için süreç açılmaz");
    assert.equal(h.kapi.istekler.length, onceki, "kilit kalkınca yuva istenmez");
    assert.equal(h.konusma.durum(), "uyuyor");
  });

  it("devirde yuvaBirak yok; devirSerbestMi soruldu", async () => {
    const h = kur();
    const s1 = await ac(h);
    await devirIste(h, s1);
    assert.ok(h.kapi.devirSorulari >= 1, "devir öncesi devirSerbestMi");
    assert.deepEqual(ozetVer(h, "ozet"), { kabul: true });
    await devirTuru(s1);
    const s2 = await yeniAcilan(h, 1);
    initGonder(s2);
    await bosalt();
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    h.d.zaman.ilerlet(5000);
    await bosalt();
    assert.equal(olayTur(h, "eren_handover").length, 1);
    assert.equal(s1.canli, false);
    assert.deepEqual(h.kapi.birakmalar, [], "eski sürecin çıkışı yuvayı bırakmaz");
    assert.deepEqual(h.kapi.yuvadakiler(), [ANA]);
  });
});

describe("Dilim 2: uyut ve bostaBeri", () => {
  it("boştayken uyut hemen kapatır: jeton iptal, mcp dosyası silinir, yuvaBirak, uyuyor, olay yok; sonraki mesaj --resume aynı nesil", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    const seq = h.depo.basSeq();
    await sozBekle(h, h.konusma.uyut());
    assert.equal(s1.canli, false);
    assert.equal(s1.stdinKapandi, true);
    assert.equal(h.konusma.durum(), "uyuyor");
    assert.deepEqual(h.kapi.birakmalar, [ANA]);
    assert.ok(h.kopru.iptal.some((k) => kapsamMetni(k) === kapsamMetni(erenKapsami(1))), "jeton iptal");
    assert.ok(silindiMi(h, mcpYolu(1)), "nesil mcp dosyası silindi");
    assert.equal(h.depo.basSeq(), seq, "uyutma olay yazmaz");
    assert.equal(olayTur(h, "turn_aborted").length, 0);
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.surecler.length, 1, "uyuyan ana oturum kendiliğinden açılmaz");

    insan(h, 2, "uyandıran");
    await bosalt();
    assert.equal(h.surecler.length, 2);
    const s2 = h.surecler[1]!;
    assert.equal(resumeHedefi(s2.istek.argv), A, "aynı nesil --resume");
    assert.equal(mcpConfig(s2), mcpYolu(1));
    assert.notEqual(h.d.dosya.icerik(mcpYolu(1)), null, "resume'da dosya yeniden yazılır");
    assert.equal(kapsamMetni(h.kopru.uretilen.at(-1)!.kapsam), kapsamMetni(erenKapsami(1)));
    initGonder(s2);
    await bosalt();
    assert.deepEqual(satirlar(s2).map(icerik), ["uyandıran"], "kurtarma notu yok");
    assert.equal(h.konusma.nesil(), 1);
    assert.equal(yenidenBasladiNotu(h), false, "eren_yeniden_basladi yazılmaz");
  });

  it("tur sürerken uyut: tur bitince kapanır, sıradaki kuyruk satırı eski sürece gitmez; kuyruk dolu olduğu için yeniden yuva ister", async () => {
    const h = kur();
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    insan(h, 1);
    insan(h, 2);
    await bosalt();
    const t1 = h.konusma.aktifTur()!.turn_id;
    const p = h.konusma.uyut();
    await bosalt();
    assert.equal(s1.canli, true, "tur sürerken kapanmaz");
    assert.equal(s1.stdinKapandi, false);
    s1.stdoutSatiriGonder(sonuc({ result: "bitti" }));
    await sozBekle(h, p);
    assert.equal(s1.canli, false);
    assert.deepEqual(satirlar(s1).map(icerik), ["merhaba 1"], "sonraki kuyruk satırı açılmadan kapandı");
    assert.equal(h.depo.turGetir(t1)?.bitis, "tamam");
    assert.equal(olayTur(h, "turn_aborted").length, 0);
    await bosalt();
    assert.equal(h.surecler.length, 2, "kuyruk dolu: yeniden yuva istendi ve açıldı");
    const s2 = h.surecler[1]!;
    assert.equal(resumeHedefi(s2.istek.argv), A);
    initGonder(s2);
    await bosalt();
    assert.deepEqual(satirlar(s2).map(icerik), ["merhaba 2"]);
    assert.equal(yenidenBasladiNotu(h), false);
  });

  it("tur sürerken uyut, kuyruk boş: tur bitince kapanır ve uyuyor", async () => {
    const h = kur();
    const s1 = await ac(h);
    insan(h, 1);
    await bosalt();
    const p = h.konusma.uyut();
    await bosalt();
    assert.equal(s1.canli, true);
    s1.stdoutSatiriGonder(sonuc());
    await sozBekle(h, p);
    assert.equal(s1.canli, false);
    assert.equal(h.konusma.durum(), "uyuyor");
    assert.equal(h.surecler.length, 1);
    assert.deepEqual(h.kapi.birakmalar, [ANA]);
  });

  it("bostaBeri: süreç yok, başlatma, tur ve kuyruk varken null; boşa düştüğü an, beklerken değişmez", async () => {
    const h = kur();
    assert.equal(h.konusma.bostaBeri(), null, "baslat öncesi");
    await h.konusma.baslat();
    await bosalt();
    assert.equal(h.konusma.bostaBeri(), null, "uyuyor");
    h.konusma.uyandir();
    await bosalt();
    assert.equal(h.konusma.bostaBeri(), null, "başlatılıyor (init yok)");
    const s = h.surecler[0]!;
    h.d.zaman.ilerlet(700);
    const t0 = h.d.zaman.simdi();
    initGonder(s);
    await bosalt();
    assert.equal(h.konusma.bostaBeri(), t0, "hazır oldu");
    h.d.zaman.ilerlet(5000);
    assert.equal(h.konusma.bostaBeri(), t0, "beklerken değişmez");

    insan(h, 1);
    insan(h, 2);
    await bosalt();
    assert.equal(h.konusma.bostaBeri(), null, "tur");
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.konusma.bostaBeri(), null, "kuyruktaki ikinci tur");
    h.d.zaman.ilerlet(1000);
    const t1 = h.d.zaman.simdi();
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.konusma.bostaBeri(), t1, "son tur bitti");

    isBittiYay(h, 7);
    await bosalt();
    assert.equal(h.konusma.bostaBeri(), null, "sentetik tur");
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.notEqual(h.konusma.bostaBeri(), null);

    await sozBekle(h, h.konusma.uyut());
    assert.equal(h.konusma.bostaBeri(), null, "uyuduktan sonra");
  });

  it("bostaBeri devir sürerken null", async () => {
    const h = kur();
    const s1 = await ac(h);
    await devirIste(h, s1);
    assert.equal(h.konusma.bostaBeri(), null, "devir isteği turu");
    ozetVer(h, "ozet");
    await devirTuru(s1);
    const s2 = await yeniAcilan(h, 1);
    assert.equal(h.konusma.bostaBeri(), null, "aday açılırken");
    initGonder(s2);
    await bosalt();
    assert.equal(h.konusma.bostaBeri(), null, "devir ilk turu");
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    h.d.zaman.ilerlet(5000);
    await bosalt();
    assert.notEqual(h.konusma.bostaBeri(), null, "devir bitti, boşta");
  });

  it("boşta kapatma resume hatası sayılmaz: üç uyut/uyandır döngüsü hep --resume aynı oturum, yeni nesil yok", async () => {
    const h = kur();
    const A = "11111111-1111-4111-8111-111111111111";
    h.depo.nesilEkle(nesilKaydi({ session_id: A }));
    await ac(h);
    for (let i = 0; i < 3; i++) {
      await sozBekle(h, h.konusma.uyut(), { init: false });
      assert.equal(h.konusma.durum(), "uyuyor");
      h.konusma.uyandir();
      await bosalt();
      const s = h.surecler.at(-1)!;
      assert.equal(resumeHedefi(s.istek.argv), A, `döngü ${i + 1}: --resume`);
      initGonder(s);
      await bosalt();
    }
    assert.equal(h.surecler.length, 4);
    assert.equal(h.depo.sonNesil(h.sec)?.nesil, 1);
    assert.equal(h.depo.sonNesil(h.sec)?.session_id, A);
    assert.deepEqual(h.nesil.verilenler, [], "nesilAyir hiç çağrılmadı");
    assert.equal(yenidenBasladiNotu(h), false);
    for (const u of h.kopru.uretilen) assert.equal(kapsamMetni(u.kapsam), kapsamMetni(erenKapsami(1)));
  });

  /**
   * Tur sürerken `uyut`, ikinci mesaj kuyrukta; süreç tur ortasında ölür. `yerVar` `false`: yuvayı başka
   * sohbet bekliyor (canlı sınırı), kapı yeni isteğe `false` der. Dönüş: ölen süreç ve oturumu.
   */
  async function uyutmaBeklerkenOlum(h: Duzen, yerVar: boolean): Promise<{ s1: SahteBoruluSurec; A: string }> {
    const s1 = await ac(h);
    const A = oturumKimligi(s1);
    insan(h, 1);
    await bosalt();
    assert.equal(h.konusma.durum(), "tur_suruyor");
    const p = h.konusma.uyut();
    insan(h, 2, "ikinci mesaj"); // tur sürüyor: kuyrukta bekler
    s1.stdoutSatiriGonder(parca("YARIM-METIN "));
    await bosalt();
    assert.equal(s1.canli, true, "tur sürerken kapanmaz");
    h.kapi.izin(yerVar);
    s1.cik(1);
    await sozBekle(h, p, { init: false });
    assert.equal(s1.canli, false);
    assert.deepEqual(h.kapi.birakmalar, [ANA], "yuva bırakıldı");
    assert.equal(h.depo.kuyrukBasi(h.sec)?.metin, "ikinci mesaj", "ikinci mesaj kuyrukta");
    return { s1, A };
  }

  it("uyutma beklerken süreç tur ortasında ölürse: yuva bırakılır, iş beklediği için yeniden yuva istenir (yer yoksa sirada), yuva gelince kurtarma notu ve ikinci mesaj işlenir", async () => {
    // Regresyon (gözden geçirme, hata 1): `cikisIsle` uyutma istendiği için yeniden başlatmayı atlıyor,
    // `uyutmaIlerle` isteği çözüp yuvayı bırakıyor ama kuyruğa bakmıyordu: sohbet `uyuyor`'da kalıyordu.
    const h = kur();
    const { A } = await uyutmaBeklerkenOlum(h, false);
    assert.deepEqual(h.kapi.istekler, [ANA, ANA], "kuyruk ve kurtarma notu bekliyor: yeniden yuva istendi");
    assert.equal(h.konusma.durum(), "sirada");
    h.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(h.surecler.length, 1, "sıradayken kendiliğinden açılmaz");

    // Yönetici yer açınca uyandir der.
    h.kapi.izin(true);
    h.konusma.uyandir();
    await bosalt();
    assert.equal(h.surecler.length, 2);
    const s2 = h.surecler[1]!;
    assert.equal(resumeHedefi(s2.istek.argv), A, "aynı oturum --resume");
    initGonder(s2);
    await bosalt();
    const l = satirlar(s2);
    assert.equal(l.length, 1);
    assert.equal(l[0]!["isSynthetic"], true, "ilk satır kurtarma notu");
    assert.ok(icerik(l[0]!).includes("YARIM-METIN"));
    s2.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.deepEqual(satirlar(s2).slice(1).map(icerik), ["ikinci mesaj"]);
    assert.equal(h.depo.kuyrukBasi(h.sec), null);
  });

  it("uyutma beklerken süreç ölürse ve yer varsa: başka çağrı beklemeden yeniden açılır, iş işlenir", async () => {
    const h = kur();
    const { A } = await uyutmaBeklerkenOlum(h, true);
    await bosalt();
    assert.deepEqual(h.kapi.istekler, [ANA, ANA], "yeniden yuva istendi");
    assert.equal(h.surecler.length, 2, "yer var: hemen açıldı");
    const s2 = h.surecler[1]!;
    assert.equal(resumeHedefi(s2.istek.argv), A);
    initGonder(s2);
    await bosalt();
    assert.ok(icerik(satirlar(s2)[0]!).includes("YARIM-METIN"), "kurtarma notu");
    s2.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.deepEqual(satirlar(s2).slice(1).map(icerik), ["ikinci mesaj"]);
  });
});

describe("Dilim 2: sonlandir", () => {
  it("süreç kapanır, jeton iptal, mcp dosyası silinir, yuvaBirak; eski_oturumlar yalnız bu sohbetin; sonrası insanMesajiAl atar, açılış yok", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const sa = await ac(a);
    await turYap(a, sa, 1, sonuc({ result: "cevap" }));
    const sb = await ac(b);
    const A = oturumKimligi(sa);
    const B = oturumKimligi(sb);
    const bNesil = b.konusma.nesil();

    const p = a.konusma.sonlandir();
    assert.throws(() => insan(a, 9, "sonlandırıldıktan sonra"), "eşzamanlı ön ek: insanMesajiAl atar");
    assert.equal(a.konusma.insanTuru(), null);
    const r = await sozBekle(a, p);
    assert.equal(r.eski_surec_cikti, true);
    assert.deepEqual([...r.eski_oturumlar], [A]);
    assert.equal(r.eski_oturumlar.includes(B), false, "başka sohbetin oturumu yok");
    assert.equal(sa.canli, false);
    assert.ok(a.kopru.iptal.some((k) => kapsamMetni(k) === kapsamMetni(erenKapsami(1))));
    assert.ok(silindiMi(a, mcpYolu(1)));
    assert.equal(silindiMi(a, mcpYolu(bNesil)), false, "B'nin dosyasına dokunulmaz");
    assert.deepEqual(a.kapi.birakmalar, [ANA]);
    assert.equal(olayTur(a, "turn_aborted").length, 0);
    assert.equal(sb.canli, true, "B sürer");
    assert.deepEqual(a.kapi.yuvadakiler(), [B_SOHBET]);

    a.konusma.uyandir();
    isBittiYay(a, 7);
    a.d.zaman.ilerlet(10 * 60_000);
    await bosalt();
    assert.equal(a.surecler.length, 1, "sonlandırılmış örnek açılmaz");
    assert.equal(a.depo.kuyrukBasi(a.sec), null, "dinleyiciler iptal: sentetik yazılmaz");
    assert.throws(() => insan(a, 10));
    assert.equal(a.konusma.durum(), "kapali");
  });

  it("süreç yokken (uyuyor) sonlandir: öldürme yok, eski_surec_cikti true", async () => {
    const h = kur();
    const A = "11111111-1111-4111-8111-111111111111";
    h.depo.nesilEkle(nesilKaydi({ session_id: A }));
    await h.konusma.baslat();
    await bosalt();
    const r = await sozBekle(h, h.konusma.sonlandir());
    assert.equal(r.eski_surec_cikti, true);
    assert.deepEqual([...r.eski_oturumlar], [A]);
    assert.deepEqual(h.d.surec.oldurmalar, []);
  });
});

describe("Dilim 2: nesil başına mcp dosyası", () => {
  it("açılışta <nesil>.json yazılır ve --mcp-config o yol; süreç çıkınca dosyaSil; resume'da yeniden yazılır", async () => {
    const h = kur();
    const s1 = await ac(h);
    assert.equal(mcpConfig(s1), mcpYolu(1));
    assert.ok(h.d.dosya.cagrilar.hepsi("atomikYaz").some((c) => yolEsit(c.args[0], mcpYolu(1))));
    assert.notEqual(h.d.dosya.icerik(mcpYolu(1)), null);
    assert.equal(silindiMi(h, mcpYolu(1)), false, "süreç yaşarken silinmez");
    s1.cik(1);
    await bosalt();
    assert.ok(silindiMi(h, mcpYolu(1)), "çıkışta silindi");
    assert.equal(h.d.dosya.icerik(mcpYolu(1)), null);
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    const s2 = h.surecler[1];
    assert.ok(s2, "yeniden başlatıldı");
    assert.equal(mcpConfig(s2), mcpYolu(1));
    assert.notEqual(h.d.dosya.icerik(mcpYolu(1)), null, "yeniden yazıldı");
  });

  it("başlatma başarısız olunca dosya silinir", async () => {
    const h = kur();
    h.d.surec.sonrakiBaslatmaHatasi(new Error("baslatma hatasi"));
    await basla(h);
    await bosalt();
    assert.ok(silindiMi(h, mcpYolu(1)));
    assert.equal(h.d.dosya.icerik(mcpYolu(1)), null);
  });

  it("baslat kurtarmada son neslin dosyası silinir (süreç açmadan)", async () => {
    const h = kur();
    h.depo.nesilEkle(nesilKaydi({ nesil: 3 }));
    h.d.dosya.yaz(mcpYolu(3), "{}");
    await h.konusma.baslat();
    await bosalt();
    assert.equal(h.surecler.length, 0);
    assert.ok(silindiMi(h, mcpYolu(3)));
    assert.equal(h.d.dosya.icerik(mcpYolu(3)), null);
  });

  it("dosyaSil atarsa akış sürer: yeniden başlatma yine olur", async () => {
    const h = kur();
    const s1 = await ac(h);
    h.d.dosya.hataVer("dosyaSil", new Error("silinemedi"));
    s1.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    assert.equal(h.surecler.length, 2);
  });

  it("devirde aday kendi neslinin dosyasıyla açılır; eski süreç çıkınca eski dosya silinir, yenisi kalır", async () => {
    const h = kur();
    const s1 = await ac(h);
    await devirIste(h, s1);
    ozetVer(h, "ozet");
    await devirTuru(s1);
    const s2 = await yeniAcilan(h, 1);
    assert.equal(mcpConfig(s2), mcpYolu(2));
    assert.notEqual(h.d.dosya.icerik(mcpYolu(2)), null);
    assert.notEqual(h.d.dosya.icerik(mcpYolu(1)), null, "eski süreç yaşarken eski dosya kalır");
    initGonder(s2);
    await bosalt();
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    h.d.zaman.ilerlet(5000);
    await bosalt();
    assert.equal(s1.canli, false);
    assert.ok(silindiMi(h, mcpYolu(1)));
    assert.equal(silindiMi(h, mcpYolu(2)), false);
    assert.notEqual(h.d.dosya.icerik(mcpYolu(2)), null);
  });
});

describe("Dilim 2: devir kapısı ve nesil denetimi", () => {
  it("devirSerbestMi false iken devir başlamaz; sonraki tur sınırında yeniden denenir", async () => {
    const h = kur();
    h.kapi.devirIzni(false);
    const s = await ac(h);
    await turYap(h, s, 1, asistan("m1", 250_000), sonuc());
    assert.ok(h.kapi.devirSorulari >= 1, "devirSerbestMi soruldu");
    assert.equal(devirIstendi(s), false, "devir isteği gitmez");
    assert.equal(h.surecler.length, 1, "aday açılmaz");
    assert.equal(h.konusma.durum(), "hazir");
    h.kapi.devirIzni(true);
    await turYap(h, s, 2, asistan("m2", 250_000), sonuc());
    assert.equal(devirIstendi(s), true, "sonraki tur sınırında devir");
  });

  it("devirOzetiAl(ozet, nesil): devir yokken ve yanlış nesille {kabul:false}; devredilen nesille kabul", async () => {
    const h = kur();
    const s1 = await ac(h);
    assert.deepEqual(ozetVer(h, "erken", 1), { kabul: false }, "devir yok");
    await devirIste(h, s1);
    assert.deepEqual(ozetVer(h, "yanlis", 2), { kabul: false }, "adayın nesli");
    assert.deepEqual(ozetVer(h, "yanlis", 0), { kabul: false });
    assert.deepEqual(ozetVer(h, "yanlis", 99), { kabul: false });
    assert.deepEqual(ozetVer(h, "dogru", 1), { kabul: true });
  });

  it("araya başka sohbetin nesli girince: aday nesilAyir'dan, özet yalnız eski nesilden, jeton iptali ve bitis_ms eski nesle", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const sa = await ac(a);
    const sb = await ac(b);
    assert.equal(a.konusma.nesil(), 1);
    assert.equal(b.konusma.nesil(), 2);
    await devirIste(a, sa);
    assert.deepEqual(ozetVer(a, "B nesli", 2), { kabul: false }, "başka sohbetin nesli özet veremez");
    assert.deepEqual(ozetVer(a, "OZET-A", 1), { kabul: true });
    await devirTuru(sa);
    const aday = a.surecler.at(-1)!;
    assert.notEqual(aday, sa);
    assert.equal(mcpConfig(aday), mcpYolu(3), "aday nesli 3 (nesil + 1 değil, nesilAyir)");
    assert.equal(kapsamMetni(a.kopru.uretilen.at(-1)!.kapsam), kapsamMetni(erenKapsami(3)));
    initGonder(aday);
    await bosalt();
    aday.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    a.d.zaman.ilerlet(5000);
    await bosalt();
    assert.equal(a.konusma.nesil(), 3);
    assert.deepEqual(a.kopru.iptal.map(kapsamMetni), [kapsamMetni(erenKapsami(1))], "yalnız A'nın eski nesli iptal");
    assert.deepEqual(b.kopru.iptal, []);
    const nesillerA = a.depo.nesiller(a.sec);
    assert.deepEqual(
      nesillerA.map((n) => n.nesil),
      [1, 3],
    );
    assert.notEqual(nesillerA[0]!.bitis_ms, null, "eski nesil kapandı");
    assert.equal(a.depo.sonNesil(b.sec)?.nesil, 2);
    assert.equal(a.depo.sonNesil(b.sec)?.bitis_ms, null, "B'nin nesline dokunulmaz");
    const dv = olayTur(a, "eren_handover") as Array<Extract<Olay, { type: "eren_handover" }>>;
    assert.deepEqual(
      dv.map((o) => [olaySohbeti(o), o.nesil, o.ozet_kabul]),
      [[ANA, 3, true]],
    );
    assert.equal(sb.canli, true);
    assert.equal(b.konusma.nesil(), 2);
  });
});

describe("Dilim 2: iki örnek aynı depoda", () => {
  it("nesil tekilliği: iki örnek aynı nesilAyir'ı paylaşınca aynı anda açılsalar da numaralar farklı; mcp yolları ve jeton kapsamları kendi", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    await Promise.all([a.konusma.baslat(), b.konusma.baslat()]);
    a.konusma.uyandir();
    b.konusma.uyandir();
    await bosalt();
    assert.equal(a.surecler.length, 1);
    assert.equal(b.surecler.length, 1);
    const na = (a.kopru.uretilen[0]!.kapsam as { nesil: number }).nesil;
    const nb = (b.kopru.uretilen[0]!.kapsam as { nesil: number }).nesil;
    assert.notEqual(na, nb, "iki örnek aynı nesil numarasını aldı");
    assert.deepEqual([...a.nesil.verilenler].sort(), [1, 2]);
    assert.equal(kapsamMetni(a.kopru.uretilen[0]!.kapsam), kapsamMetni(erenKapsami(na, ANA)));
    assert.equal(kapsamMetni(b.kopru.uretilen[0]!.kapsam), kapsamMetni(erenKapsami(nb, B_SOHBET)));
    assert.equal(mcpConfig(a.surecler[0]!), mcpYolu(na));
    assert.equal(mcpConfig(b.surecler[0]!), mcpYolu(nb));
    const jetonu = (yol: string): unknown => (JSON.parse(a.d.dosya.icerik(yol) ?? "null") as J)["mcpServers"]["eren"]["env"]["EREN_KOPRU_JETON"];
    assert.equal(jetonu(mcpYolu(na)), a.kopru.uretilen[0]!.jeton);
    assert.equal(jetonu(mcpYolu(nb)), b.kopru.uretilen[0]!.jeton);
    assert.deepEqual(a.kapi.yuvadakiler().sort(), [ANA, B_SOHBET].sort());
  });

  it("nesil numarası depodaki en büyük nesli aşar (başka sohbetin nesilleri dahil)", async () => {
    const a = kur();
    a.depo.nesilEkle(nesilKaydi({ nesil: 5, sohbet_id: B_SOHBET, session_id: "55555555-5555-4555-8555-555555555555" }));
    const sa = await ac(a);
    assert.ok(sa.istek.argv.includes("--session-id"), "ana'nın nesli yok: yeni oturum, B'ninkine --resume yok");
    assert.equal(mcpConfig(sa), mcpYolu(6));
    assert.equal(a.konusma.nesil(), 6);
  });

  it("A'nın kuyruğu B'nin stdin'ine gitmez; user_echo ve kuyruk sohbet kapsamlı", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const sa = await ac(a);
    const sb = await ac(b);
    insan(a, 1, "A-METNI");
    insan(b, 2, "B-METNI");
    await bosalt();
    assert.deepEqual(satirlar(sa).map(icerik), ["A-METNI"]);
    assert.deepEqual(satirlar(sb).map(icerik), ["B-METNI"]);
    const ec = olayTur(a, "user_echo");
    assert.deepEqual(
      ec.map((o) => [olaySohbeti(o), (o as Extract<Olay, { type: "user_echo" }>).text]),
      [
        [ANA, "A-METNI"],
        [B_SOHBET, "B-METNI"],
      ],
    );
    insan(a, 3, "A-IKINCI");
    await bosalt();
    assert.equal(a.depo.kuyrukBasi(b.sec), null, "A'nın satırı B'nin kuyruğunda değil");
    assert.equal(a.depo.kuyrukBasi(a.sec)?.metin, "A-IKINCI");
    assert.equal(satirlar(sb).length, 1);
  });

  it("is_bitti, soru_durumu, plan_sonuclandi yalnız sohbet_id'si eşleşen örneğe sentetik", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const sa = await ac(a);
    const sb = await ac(b);
    isBittiYay(a, 7, { sohbet_id: B_SOHBET });
    await bosalt();
    assert.equal(sa.yazilanlar.length, 0, "A'ya gitmez");
    assert.deepEqual(satirlar(sb).map(icerik), ["İş 7 bitti, durum: tamam."]);
    sb.stdoutSatiriGonder(sonuc());
    await bosalt();
    a.veriyolu.yayinla("soru_durumu", { soru_id: "s1", is_id: 7, sohbet_id: B_SOHBET, durum: "soruldu" });
    await bosalt();
    sb.stdoutSatiriGonder(sonuc());
    await bosalt();
    a.veriyolu.yayinla("plan_sonuclandi", { plan_id: "plan1", sohbet_id: B_SOHBET, sonuc: "reddedildi" });
    await bosalt();
    assert.equal(sa.yazilanlar.length, 0);
    assert.deepEqual(satirlar(sb).map(icerik), [
      "İş 7 bitti, durum: tamam.",
      "İş 7 kullanıcıya soru sordu.",
      "Plan plan1: reddedildi.",
    ]);
    assert.equal(a.depo.kuyrukBasi(a.sec), null);
  });

  it("isler_uzlastirildi yalnız girdisi olan örneğe, kendi sayılarıyla", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const sa = await ac(a);
    const sb = await ac(b);
    a.veriyolu.yayinla("isler_uzlastirildi", {
      sahiplenilen: 5,
      biten: 3,
      sohbetler: { [B_SOHBET]: { sahiplenilen: 2, biten: 1 } },
    });
    await bosalt();
    assert.equal(sa.yazilanlar.length, 0, "girdisi olmayan örnek yazmaz");
    assert.deepEqual(satirlar(sb).map(icerik), ["Servis yeniden başladı: 2 iş sahiplenildi, 1 iş bitti."]);
  });

  it("insanMesajiAl yanlış sohbet_id'de atar; olay, kuyruk ve satır yok", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const sa = await ac(a);
    const seq = a.depo.basSeq();
    assert.throws(() => insan(a, 1, "yanlış yer", B_SOHBET));
    await bosalt();
    assert.equal(a.depo.basSeq(), seq);
    assert.equal(olayTur(a, "user_echo").length, 0);
    assert.equal(a.depo.kuyrukBasi(a.sec), null);
    assert.equal(a.depo.kuyrukBasi(b.sec), null);
    assert.equal(sa.yazilanlar.length, 0);
  });

  it("mezar taşı kuralı sohbet başına: B'nin temizliği A'nın --resume'unu bozmaz", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const A = "11111111-1111-4111-8111-111111111111";
    a.depo.nesilEkle(nesilKaydi({ session_id: A, baslangic_ms: a.d.zaman.simdi() }));
    mezarYaz(b);
    const s = await ac(a);
    assert.equal(resumeHedefi(s.istek.argv), A);
  });

  it("A'nın süreci ölünce yalnız A yeniden başlar; B'nin yuvası ve süreci etkilenmez", async () => {
    const a = kur();
    const b = ikinci(a, B_SOHBET);
    const sa = await ac(a);
    const sb = await ac(b);
    sa.cik(1);
    await bosalt();
    assert.deepEqual(a.kapi.birakmalar, [ANA]);
    a.d.zaman.ilerlet(30_000);
    await bosalt();
    assert.equal(a.surecler.length, 2);
    assert.equal(b.surecler.length, 1);
    assert.equal(sb.canli, true);
    assert.equal(b.konusma.durum(), "hazir");
  });
});

// ---------------------------------------------------------------------------------------------
// Dilim 3b: kısayol mesajı (v4 `input:"kisayol"`, `baglam`) ve tam yetki istemi
// ---------------------------------------------------------------------------------------------

describe("Dilim 3b: kısayol mesajı ve tam yetki", () => {
  type Baglam = { paket: string; ad: string };
  const kisayol = (h: Duzen, n: number, text: string, baglam?: Baglam): { seq: number } =>
    h.konusma.insanMesajiAl({
      device_id: "cihaz1",
      client_msg_id: `kisa${n}`,
      sohbet_id: h.sohbet_id,
      input: "kisayol",
      text,
      ...(baglam !== undefined && { baglam }),
    } as unknown as DogrulanmisInsanMesaji);
  const echolar = (h: Duzen): Array<Extract<Olay, { type: "user_echo" }>> =>
    olayTur(h, "user_echo") as Array<Extract<Olay, { type: "user_echo" }>>;
  const ONEK_WA = '[telefon kısayolu: kullanıcı şu an "WhatsApp" (com.whatsapp) uygulamasına bakıyor]';

  it("baglam'lı kısayol: ana oturuma önek + yeni satır + metin (insan satırı); user_echo öneksiz, baglam'ı taşır", async () => {
    const h = kur();
    const s = await ac(h);
    const metin = "bunu özetle\nikinci satır";
    const { seq } = kisayol(h, 1, metin, { paket: "com.whatsapp", ad: "WhatsApp" });
    await bosalt();
    assert.equal(s.yazilanlar.length, 1);
    assert.equal(
      s.yazilanlar[0],
      JSON.stringify({
        type: "user",
        parent_tool_use_id: null,
        client_composed: true,
        origin: { kind: "human" },
        message: { role: "user", content: `${ONEK_WA}\n${metin}` },
      }),
    );
    const ec = echolar(h);
    assert.equal(ec.length, 1);
    assert.equal(ec[0]!.seq, seq);
    assert.equal(ec[0]!.input, "kisayol");
    assert.equal(ec[0]!.text, metin, "kullanıcıya görünen metin öneksiz");
    assert.deepEqual(ec[0]!.baglam, { paket: "com.whatsapp", ad: "WhatsApp" });
    assert.notEqual(h.konusma.insanTuru(), null, "kısayol turu insan turudur");
  });

  it("baglam'sız kısayol: yalnız [telefon kısayolu] öneki; user_echo'da baglam alanı yok", async () => {
    const h = kur();
    const s = await ac(h);
    kisayol(h, 1, "hava nasıl");
    await bosalt();
    assert.deepEqual(satirlar(s).map(icerik), ["[telefon kısayolu]\nhava nasıl"]);
    assert.deepEqual(satirlar(s)[0]!["origin"], { kind: "human" });
    const ec = echolar(h);
    assert.equal(ec[0]!.text, "hava nasıl");
    assert.equal("baglam" in ec[0]!, false);
  });

  it("önek kuyruğa yazılırken konur: süreç yokken kuyruk satırı önekli, echo öneksiz; açılınca aynen gider", async () => {
    const h = kur({ kilitli: true });
    kisayol(h, 1, "sonra bak", { paket: "com.whatsapp", ad: "WhatsApp" });
    const k = h.depo.kuyrukBasi(h.sec)!;
    assert.equal(k.kaynak, "insan");
    assert.equal(k.metin, `${ONEK_WA}\nsonra bak`);
    assert.equal(echolar(h)[0]!.text, "sonra bak");
    h.kilitle(true);
    const s = await ac(h);
    await bosalt();
    assert.deepEqual(satirlar(s).map(icerik), [`${ONEK_WA}\nsonra bak`]);
    assert.equal(h.depo.kuyrukBasi(h.sec), null);
  });

  it("ad kaçışlı: tırnak, ters bölü ve yön/görünmez karakter öneki bozamaz; paket aynen", async () => {
    const h = kur();
    const s = await ac(h);
    const ad = 'Kötü" (com.x) uygulamasına bakıyor] \\ \u202E\u200B son';
    kisayol(h, 1, "metin", { paket: "com.ornek.uygulama", ad });
    await bosalt();
    const icerikMetni = icerik(satirlar(s)[0]!);
    assert.equal(
      icerikMetni,
      '[telefon kısayolu: kullanıcı şu an "Kötü\\" (com.x) uygulamasına bakıyor] \\\\ \\u202e\\u200b son" (com.ornek.uygulama) uygulamasına bakıyor]\nmetin',
    );
    assert.equal(icerikMetni.split("\n").length, 2, "önek tek satır");
    assert.equal(echolar(h)[0]!.baglam?.ad, ad, "olay günlüğü kaçışsız, telefonun gönderdiği ad");
  });

  it("yazı ve dikte öneksiz (baglam yok); kısayol olmayan girdide baglam reddedilir, hiçbir şey yazılmaz", async () => {
    const h = kur();
    const s = await ac(h);
    for (const [n, input] of [[1, "yazi"], [2, "dikte"]] as const) {
      h.konusma.insanMesajiAl({
        device_id: "cihaz1",
        client_msg_id: `g${n}`,
        sohbet_id: h.sohbet_id,
        input,
        text: `düz ${n}`,
      } as unknown as DogrulanmisInsanMesaji);
      await bosalt();
      s.stdoutSatiriGonder(sonuc());
      await bosalt();
    }
    assert.deepEqual(satirlar(s).map(icerik), ["düz 1", "düz 2"]);
    const seq = h.depo.basSeq();
    assert.throws(() =>
      h.konusma.insanMesajiAl({
        device_id: "cihaz1",
        client_msg_id: "g3",
        sohbet_id: h.sohbet_id,
        input: "yazi",
        text: "baglamli yazi",
        baglam: { paket: "com.whatsapp", ad: "WhatsApp" },
      } as unknown as DogrulanmisInsanMesaji),
    );
    await bosalt();
    assert.equal(h.depo.basSeq(), seq, "olay yazılmadı");
    assert.equal(h.depo.kuyrukBasi(h.sec), null, "kuyruk satırı yok");
    assert.equal(s.yazilanlar.length, 2);
  });

  it("sistem istemi tam yetkiyi ayardan alır: sistemIstemi(kimlikEki, masaustu, ayar.tamYetki)", async () => {
    const al = (s: SahteBoruluSurec): string => s.istek.argv[s.istek.argv.indexOf("--system-prompt") + 1]!;
    const acik = await ac(kur({ kimlikEki: "EK", tamYetki: true }));
    const kapali = await ac(kur({ kimlikEki: "EK", tamYetki: false }));
    const masaustuAcik = await ac(kur({ kimlikEki: "EK", tamYetki: true, computerUse: CU_SUNUCU }));
    assert.equal(al(acik), sistemIstemi("EK", false, true, "Claude"));
    assert.equal(al(kapali), sistemIstemi("EK", false, false, "Claude"));
    assert.equal(al(masaustuAcik), sistemIstemi("EK", true, true, "Claude"));
    assert.notEqual(al(acik), al(kapali), "tam yetki istemi değiştirmeli");
  });
});
