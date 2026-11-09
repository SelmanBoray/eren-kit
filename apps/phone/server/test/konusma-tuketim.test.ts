/**
 * `konusma` tüketim kaydı (sözleşme "Sohbet (`konusma.ts` `sonucIsle`)" maddesi, ST5): her `result` için
 * `depo.tuketimEkle` bir kez; `kaynak:"sohbet"`, `is_id:null`, `nesil` = oturumun nesli, `turn_id`/`rol` açık turdan
 * (tursuz sonuçta `null`), fark alanı varsa model başına `model_farki`, yoksa `usage`'dan tek `ana_usage`.
 * `tuketimEkle` hatası turu bozmaz. Kalıp `konusma.test.ts`'ten: sahte süreç, gerçek `depoKur(:memory:)`,
 * `tuketimEkle` çağrıları depo sarmalayıcısıyla yakalanır (gerçek depoya da geçer).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANA_SOHBET_ID } from "@eren/protocol";
import type { Olay } from "@eren/protocol";
import { akisKur } from "../src/akis.ts";
import { depoKur } from "../src/depo.ts";
import { konusmaKur } from "../src/konusma.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import type { Ayar, Depo, DogrulanmisInsanMesaji, SurecPortu, TuketimKaydi } from "../src/sozlesme.ts";
import { sahteDunya, sahteKapi } from "./sahte.ts";
import type { SahteBoruluSurec, SahteDunya } from "./sahte.ts";

type J = Record<string, any>;

const ANA = ANA_SOHBET_ID;
const MODEL = "claude-opus-ornek";
const ALT_MODEL = "claude-haiku-ornek";
const ERENMCP_DIZINI = "C:\\ornek\\eren-kit\\eren-mcp";
const mcpYolu = (nesil: number): string => `${ERENMCP_DIZINI}\\${nesil}.json`;
const ORTAM = { PATH: "C:\\ornek\\bin" };

const sahteAyar = (): Ayar =>
  ({
    yollar: {
      kok: "C:\\ornek\\eren-kit",
      vt: "C:\\ornek\\eren-kit\\eren.db",
      log: "C:\\ornek\\eren-kit\\logs\\servis.log",
      islerDizini: "C:\\ornek\\eren-kit\\isler",
      erenCwd: "C:\\ornek\\eren-kit\\eren-cwd",
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
    tamYetki: true,
    servis: { surum: null, baslangic_ms: 1_700_000_000_000 },
    computerUse: null,
    claudeExe: "C:\\ornek\\npm\\claude.exe",
    nodeExe: "C:\\ornek\\node\\node.exe",
    kopruBetigi: "C:\\ornek\\eren-kit\\src\\kopru.ts",
    erenModeli: "opus",
    kullaniciAdi: "Ornek",
    asistanAdi: "Claude",
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
    pcIsOrtami: () => ({ ...ORTAM }),
    kimlikEki: async () => "",
  }) as unknown as Ayar;

interface Duzen {
  d: SahteDunya;
  depo: Depo;
  konusma: ReturnType<typeof konusmaKur>;
  surecler: SahteBoruluSurec[];
  /** Her `tuketimEkle` çağrısının kayıt kümesi (atan çağrı dahil). */
  cagrilar: TuketimKaydi[][];
}

function kur(sec: { tuketimAtar?: boolean } = {}): Duzen {
  const d = sahteDunya();
  const veriyolu = veriyoluKur({ gunluk: d.gunluk });
  const depo = depoKur({ yol: ":memory:", saat: d.saat, veriyolu, gunluk: d.gunluk });
  if (depo.sohbetGetir({ sohbet_id: ANA }) === null) depo.sohbetEkle({ sohbet_id: ANA, ad: "Ornek sohbet", olusturma_ms: d.zaman.simdi(), son_etkinlik_ms: d.zaman.simdi() });
  let sayac = 0;
  const nesilAyir = (): number => {
    sayac = Math.max(sayac, depo.enBuyukNesil()) + 1;
    return sayac;
  };
  const surecler: SahteBoruluSurec[] = [];
  const surec: SurecPortu = {
    boruluBaslat: async (istek) => {
      const s = await d.surec.boruluBaslat(istek);
      surecler.push(s as SahteBoruluSurec);
      return s;
    },
    ayrikBaslat: (istek) => d.surec.ayrikBaslat(istek),
    aracCalistir: (istek) => d.surec.aracCalistir(istek),
    anlikGoruntu: () => d.surec.anlikGoruntu(),
    surecVarMi: (kimlik) => d.surec.surecVarMi(kimlik),
    agaciOldur: (pid) => d.surec.agaciOldur(pid),
    tekOldur: (pid) => d.surec.tekOldur(pid),
  };
  const cagrilar: TuketimKaydi[][] = [];
  const sarili: Depo = {
    ...depo,
    tuketimEkle: (kayitlar) => {
      cagrilar.push(kayitlar.map((k) => ({ ...k })));
      if (sec.tuketimAtar) throw new Error("tuketim yazilamadi (sahte)");
      depo.tuketimEkle(kayitlar);
    },
  };
  let jeton = 0;
  const konusma = konusmaKur({
    sohbet_id: ANA,
    kapi: sahteKapi(),
    nesilAyir,
    ayar: sahteAyar(),
    depo: sarili,
    kilit: { baslatmaSerbestMi: () => true },
    kopru: {
      jetonUret: () => `jeton-ornek-${String(++jeton).padStart(4, "0")}-`.padEnd(40, "x"),
      jetonlariIptalEt: () => {},
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
  return { d, depo, konusma, surecler, cagrilar };
}

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
};

const satir = (o: unknown): string => JSON.stringify(o);

const oturumKimligi = (s: SahteBoruluSurec): string => {
  const a = s.istek.argv;
  const i = Math.max(a.indexOf("--session-id"), a.indexOf("--resume"));
  return a[i + 1]!;
};

const initSatiri = (s: SahteBoruluSurec): string =>
  satir({
    type: "system",
    subtype: "init",
    session_id: oturumKimligi(s),
    tools: ["mcp__eren__plan_oner", "mcp__eren__rapor_oku"],
    mcp_servers: [{ name: "eren", status: "connected" }],
    apiKeySource: "none",
    model: MODEL,
  });

const asistan = (id: string, input: number): string =>
  satir({
    type: "assistant",
    message: {
      id,
      model: MODEL,
      usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 },
    },
  });

/** Gerçek kayıt alan adlarıyla `usage` (ana döngü). */
const USAGE = { input_tokens: 11, cache_creation_input_tokens: 22, cache_read_input_tokens: 33, output_tokens: 44 };

/** İki modelli fark alanı (gerçek alan adları). */
const FARK = {
  [MODEL]: { inputTokens: 100, outputTokens: 200, cacheReadInputTokens: 300, cacheCreationInputTokens: 400, costUSD: 1.25 },
  [ALT_MODEL]: { inputTokens: 5, outputTokens: 6, cacheReadInputTokens: 7, cacheCreationInputTokens: 8, costUSD: 0.03 },
};

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
    usage: USAGE,
    ...ek,
  });

const insan = (h: Duzen, n: number, text = `merhaba ${n}`): void => {
  h.konusma.insanMesajiAl({
    device_id: "cihaz1",
    client_msg_id: `msg${n}`,
    sohbet_id: ANA,
    input: "yazi",
    text,
  } as unknown as DogrulanmisInsanMesaji);
};

const satirlar = (s: SahteBoruluSurec): J[] => s.yazilanlar.map((x) => JSON.parse(x) as J);
const icerik = (l: J): string => (l["message"] as { content: string }).content;
const devirIstendi = (s: SahteBoruluSurec): boolean =>
  satirlar(s).some((l) => l["isSynthetic"] === true && icerik(l).includes("devir_ozeti"));
const olayTur = (h: Duzen, type: Olay["type"]): Olay[] => h.depo.olaylariGetir(0, 10_000).filter((o) => o.type === type);

async function ac(h: Duzen): Promise<SahteBoruluSurec> {
  await h.konusma.baslat();
  h.konusma.uyandir();
  await bosalt();
  const s = h.surecler.at(-1);
  assert.ok(s, "süreç açılmalıydı");
  s.stdoutSatiriGonder(initSatiri(s));
  await bosalt();
  return s;
}

/** Açık devir turunun kimliği (`gorunur:false`, `kaynak:"devir"`). */
const acikDevirTuru = (h: Duzen): string => {
  const t = h.depo.acikTurlar({ sohbet_id: ANA }).filter((x) => x.kaynak === "devir");
  assert.equal(t.length, 1, "tek açık devir turu");
  return t[0]!.turn_id;
};

/** Kaydın model-dışı ortak alanları. */
const ortak = (k: TuketimKaydi) => ({
  kaynak: k.kaynak,
  sohbet_id: k.sohbet_id,
  is_id: k.is_id,
  nesil: k.nesil,
  turn_id: k.turn_id,
  rol: k.rol,
});

const modelSatiri = (k: TuketimKaydi) => ({
  model: k.model,
  girdi: k.girdi,
  cikti: k.cikti,
  cache_okuma: k.cache_okuma,
  cache_yazma: k.cache_yazma,
  maliyet_usd: k.maliyet_usd,
  olcum: k.olcum,
});

const FARK_SATIRLARI = [
  { model: MODEL, girdi: 100, cikti: 200, cache_okuma: 300, cache_yazma: 400, maliyet_usd: 1.25, olcum: "model_farki" },
  { model: ALT_MODEL, girdi: 5, cikti: 6, cache_okuma: 7, cache_yazma: 8, maliyet_usd: 0.03, olcum: "model_farki" },
];

const modelSirali = (l: TuketimKaydi[]) => [...l].sort((a, b) => a.model.localeCompare(b.model)).map(modelSatiri);
const beklenenSirali = (l: typeof FARK_SATIRLARI) => [...l].sort((a, b) => a.model.localeCompare(b.model));

describe("sohbet tüketimi: sonucIsle → tuketimEkle", () => {
  it("normal kullanıcı turu: turn_id, rol normal, nesil, model başına model_farki satırı", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    const turn_id = h.konusma.aktifTur()!.turn_id;
    const nesil = h.konusma.nesil();
    assert.equal(h.cagrilar.length, 0, "sonuçtan önce kayıt yok");
    s.stdoutSatiriGonder(sonuc({ model_usage_since_last_result: FARK }));
    await bosalt();
    assert.equal(h.cagrilar.length, 1, "bir result = bir tuketimEkle");
    const k = h.cagrilar[0]!;
    assert.equal(k.length, 2, "model başına bir satır");
    for (const x of k) {
      assert.deepEqual(ortak(x), { kaynak: "sohbet", sohbet_id: ANA, is_id: null, nesil, turn_id, rol: "normal" });
    }
    assert.deepEqual(modelSirali(k), beklenenSirali(FARK_SATIRLARI));
  });

  it("tursuz result (arka plan bildirimi): satır yazılır, turn_id ve rol null, nesil oturumunki", async () => {
    const h = kur();
    const s = await ac(h);
    // Önce olağan bir tur biter; sonra açık tur yokken CLI kendiliğinden result yollar.
    insan(h, 1);
    await bosalt();
    s.stdoutSatiriGonder(sonuc({ result: "ilk" }));
    await bosalt();
    assert.equal(h.konusma.aktifTur(), null, "tur kapalı");
    const once = h.cagrilar.length;
    s.stdoutSatiriGonder(sonuc({ result: "bildirim sonrası", model_usage_since_last_result: FARK }));
    await bosalt();
    assert.equal(h.cagrilar.length, once + 1);
    const k = h.cagrilar.at(-1)!;
    assert.equal(k.length, 2);
    for (const x of k) {
      assert.deepEqual(ortak(x), {
        kaynak: "sohbet",
        sohbet_id: ANA,
        is_id: null,
        nesil: h.konusma.nesil(),
        turn_id: null,
        rol: null,
      });
    }
    assert.deepEqual(modelSirali(k), beklenenSirali(FARK_SATIRLARI));
  });

  it("fark alanı olmayan result: usage'dan tek ana_usage satırı, maliyet null, model oturumunki", async () => {
    const h = kur();
    const s = await ac(h);
    insan(h, 1);
    await bosalt();
    const turn_id = h.konusma.aktifTur()!.turn_id;
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.cagrilar.length, 1);
    const k = h.cagrilar[0]!;
    assert.equal(k.length, 1, "tek satır");
    assert.deepEqual(ortak(k[0]!), {
      kaynak: "sohbet",
      sohbet_id: ANA,
      is_id: null,
      nesil: h.konusma.nesil(),
      turn_id,
      rol: "normal",
    });
    assert.deepEqual(modelSatiri(k[0]!), {
      model: MODEL,
      girdi: 11,
      cache_yazma: 22,
      cache_okuma: 33,
      cikti: 44,
      maliyet_usd: null,
      olcum: "ana_usage",
    });
  });

  it("devir: özet isteme turu devir_istek (eski nesil), yeni oturumun ilk turu devir_ilk ve nesil bir artmış", async () => {
    const h = kur();
    const s1 = await ac(h);
    const nesil1 = h.konusma.nesil();
    insan(h, 1);
    await bosalt();
    const normalTur = h.konusma.aktifTur()!.turn_id;
    s1.stdoutSatiriGonder(asistan("m1", 250_000));
    s1.stdoutSatiriGonder(sonuc({ result: "ilk cevap", model_usage_since_last_result: FARK }));
    await bosalt();
    assert.equal(devirIstendi(s1), true, "eşik aşıldı, devir istendi");
    assert.equal(h.cagrilar.length, 1);
    assert.deepEqual(
      h.cagrilar[0]!.map((x) => [x.turn_id, x.rol, x.nesil]),
      [
        [normalTur, "normal", nesil1],
        [normalTur, "normal", nesil1],
      ],
    );

    // Özet isteme turu (eski oturum).
    const istekTuru = acikDevirTuru(h);
    assert.notEqual(istekTuru, normalTur);
    assert.deepEqual(h.konusma.devirOzetiAl("OZET", h.konusma.nesil()), { kabul: true });
    s1.stdoutSatiriGonder(asistan("m2", 1000));
    s1.stdoutSatiriGonder(sonuc({ result: "devir turu metni", model_usage_since_last_result: FARK }));
    await bosalt();
    assert.equal(h.cagrilar.length, 2, "devir_istek sonucu bir kez");
    const istek = h.cagrilar[1]!;
    assert.equal(istek.length, 2);
    for (const x of istek) {
      assert.deepEqual(ortak(x), {
        kaynak: "sohbet",
        sohbet_id: ANA,
        is_id: null,
        nesil: nesil1,
        turn_id: istekTuru,
        rol: "devir_istek",
      });
    }
    assert.deepEqual(modelSirali(istek), beklenenSirali(FARK_SATIRLARI));

    // Yeni oturumun ilk turu.
    await bosalt();
    const s2 = h.surecler.at(-1)!;
    assert.notEqual(s2, s1, "yeni süreç açıldı");
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    const ilkTur = acikDevirTuru(h);
    assert.notEqual(ilkTur, istekTuru);
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.equal(h.konusma.nesil(), nesil1 + 1, "devir tamamlandı");
    assert.equal(h.cagrilar.length, 3, "devir_ilk sonucu bir kez");
    const ilk = h.cagrilar[2]!;
    assert.equal(ilk.length, 1, "fark alanı yok: tek ana_usage");
    assert.deepEqual(ortak(ilk[0]!), {
      kaynak: "sohbet",
      sohbet_id: ANA,
      is_id: null,
      nesil: nesil1 + 1,
      turn_id: ilkTur,
      rol: "devir_ilk",
    });
    assert.equal(ilk[0]!.olcum, "ana_usage");
    assert.equal(ilk[0]!.model, MODEL);
  });

  it("tuketimEkle atarsa tur olağan biçimde tamamlanır (kullanıcıya giden sonuç aynı) ve sıradaki tur akar", async () => {
    const calistir = async (tuketimAtar: boolean) => {
      const h = kur({ tuketimAtar });
      const s = await ac(h);
      insan(h, 1);
      await bosalt();
      const id = h.konusma.aktifTur()!.turn_id;
      insan(h, 2, "kuyrukta");
      await bosalt();
      s.stdoutSatiriGonder(sonuc({ result: "Merhaba dünya", model_usage_since_last_result: FARK }));
      await bosalt();
      const a = olayTur(h, "assistant_message") as Array<Extract<Olay, { type: "assistant_message" }>>;
      return {
        h,
        s,
        cevaplar: a.map((o) => [o.text, o.turn_id === id]),
        abort: olayTur(h, "turn_aborted").length,
        bitis: h.depo.turGetir(id)?.bitis ?? null,
        sonrakiYazildi: satirlar(s).some((l) => typeof l["message"]?.["content"] === "string" && icerik(l) === "kuyrukta"),
        aktifSonraki: h.konusma.aktifTur()?.turn_id !== id && h.konusma.aktifTur() !== null,
      };
    };
    const olagan = await calistir(false);
    const atan = await calistir(true);
    assert.equal(atan.h.cagrilar.length, 1, "tuketimEkle çağrıldı (ve attı)");
    assert.deepEqual(atan.cevaplar, [["Merhaba dünya", true]]);
    assert.deepEqual(atan.cevaplar, olagan.cevaplar);
    assert.equal(atan.abort, 0);
    assert.equal(atan.bitis, "tamam");
    assert.equal(atan.bitis, olagan.bitis);
    assert.equal(atan.sonrakiYazildi, true, "kuyruktaki tur akar");
    assert.equal(atan.aktifSonraki, olagan.aktifSonraki);
  });

  it("aynı result iki kez sayılmaz: her result bir kayıt kümesi, tur başına bir küme", async () => {
    const h = kur();
    const s = await ac(h);
    const turlar: string[] = [];
    for (let n = 1; n <= 3; n++) {
      insan(h, n);
      await bosalt();
      turlar.push(h.konusma.aktifTur()!.turn_id);
      s.stdoutSatiriGonder(sonuc({ result: `cevap ${n}`, model_usage_since_last_result: FARK }));
      await bosalt();
      await bosalt();
    }
    assert.equal(h.cagrilar.length, 3, "üç result = üç çağrı");
    assert.deepEqual(
      h.cagrilar.map((k) => [k.length, ...new Set(k.map((x) => x.turn_id))]),
      turlar.map((t) => [2, t]),
    );
    // Gerçek depoda da her tur bir küme: toplam üç kat, fazlası yok.
    const ozet = h.depo.tuketimOzeti({ gunBaslangicMs: 0, yediGunBaslangicMs: 0, isAdet: 0 });
    const t = ozet.son_7_gun.sohbet;
    assert.deepEqual(
      [t.girdi, t.cikti, t.cache_okuma, t.cache_yazma, t.sonuc_adet],
      [3 * 105, 3 * 206, 3 * 307, 3 * 408, 3],
    );
  });
});
