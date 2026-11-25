/**
 * `konusma` ajanda dalgası: MODULLER.md "Ajanda dalgası" > "konusma ve sohbetler", `AJANDA.md` "Mesaj anı" ve
 * "Ekiplerin gereksinimleri" > "Konuşma modülü". Sahte `BoruluSurec`, `sahteTakvim` (sabit ofsetli dilimler),
 * gerçek `depoKur(:memory:)`, `akisKur`, `veriyoluKur`. Ajanda köprüsü sahtesi çağrıları kaydeder.
 *
 * İzlenebilirlik ("Konuşma modülü" maddeleri → describe):
 * - "Her kuyruk satırının varış anı ... satırla sakla; ... başına mesajAniDamgasi koy (iletim anı değil)"
 *   → "varış anı ve damga", "yeniden başlatma", "sızma".
 * - "Turun mesaj anını ve kökenini servise ver" → "tur bağlamı".
 * - "Köprüye ana_oturum jetonu (sohbet_id + nesil) ve ajanda borusu bağlantısı" → "ajanda köprüsü ve jeton".
 * - A0.6 (bağımlılık yokken bugünkü gibi) → "ajanda kapalı".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANA_SOHBET_ID } from "@eren/protocol";
import type { Olay } from "@eren/protocol";
import { akisKur } from "../src/akis.ts";
import { depoKur } from "../src/depo.ts";
import { konusmaKur } from "../src/konusma.ts";
import { sistemIstemi } from "../src/konusma-metin.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import type {
  AjandaJetonKapsami,
  AjandaTurBaglami,
  Ayar,
  Depo,
  DogrulanmisInsanMesaji,
  JetonKapsami,
  SohbetSecimi,
} from "../src/sozlesme.ts";
import { sahteDunya, sahteKapi, sahteTakvim } from "./sahte.ts";
import type { SahteBoruluSurec, SahteDunya, SahteTakvim } from "./sahte.ts";

type J = Record<string, any>;

const ANA = ANA_SOHBET_ID;
const MODEL = "claude-opus-ornek";
const NODE = "C:\\ornek\\node\\node.exe";
const KOPRU = "C:\\ornek\\eren-kit\\src\\kopru.ts";
const ERENMCP_DIZINI = "C:\\ornek\\eren-kit\\eren-mcp";
const mcpYolu = (nesil: number): string => `${ERENMCP_DIZINI}\\${nesil}.json`;

/** 2026-11-25 Çarşamba, İstanbul (UTC+3) duvar saati → epoch ms; `sn` saniye kesilmeli. */
const ist = (gun: number, saat: number, dakika: number, sn = 0): number =>
  Date.UTC(2026, 10, gun, saat - 3, dakika, sn);

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
    nodeExe: NODE,
    kopruBetigi: KOPRU,
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
    erenOrtami: () => ({ PATH: "C:\\ornek\\bin" }),
    telefonIsOrtami: () => ({ PATH: "C:\\ornek\\bin" }),
    pcIsOrtami: () => ({ PATH: "C:\\ornek\\bin" }),
    kimlikEki: async () => "",
  }) as unknown as Ayar;

interface Duzen {
  d: SahteDunya;
  depo: Depo;
  veriyolu: ReturnType<typeof veriyoluKur>;
  konusma: ReturnType<typeof konusmaKur>;
  sec: SohbetSecimi;
  takvim: SahteTakvim;
  /** Ajanda köprüsünün ürettiği jetonlar (kapsamıyla). */
  ajandaJetonlari: Array<{ kapsam: AjandaJetonKapsami; jeton: string }>;
  /** Sıra defteri: `eren:uret:N`, `eren:iptal:N`, `ajanda:uret:N`, `ajanda:iptal:N`, `baslat:<kip>`. */
  sira: string[];
  /** `kuyrukEkiYaz` çağrıları (kuyruk kimliği, ek). */
  ekler: Array<Parameters<Depo["kuyrukEkiYaz"]>>;
  olaylar: Array<{ ad: string; veri: J }>;
  kilitDegis(serbest: boolean): void;
}

function kur(
  sec: {
    /** `false`: takvim ve ajandaKopru verilmez (ajanda kapalı). Varsayılan açık. */
    ajanda?: boolean;
    /** Yalnız takvim (köprü yok). */
    yalnizTakvim?: boolean;
    d?: SahteDunya;
    depo?: Depo;
    veriyolu?: ReturnType<typeof veriyoluKur>;
    takvim?: SahteTakvim;
    kilitli?: boolean;
    baslangicMs?: number;
    depoSarici?: (d: Depo) => Depo;
    ajandaJetonUretAtar?: boolean;
  } = {},
): Duzen {
  const d = sec.d ?? sahteDunya({ baslangicMs: sec.baslangicMs ?? ist(25, 12, 0) });
  const veriyolu = sec.veriyolu ?? veriyoluKur({ gunluk: d.gunluk });
  const depo = sec.depo ?? depoKur({ yol: ":memory:", saat: d.saat, veriyolu, gunluk: d.gunluk });
  if (depo.sohbetGetir({ sohbet_id: ANA }) === null) {
    depo.sohbetEkle({ sohbet_id: ANA, ad: "Ornek sohbet", olusturma_ms: d.zaman.simdi(), son_etkinlik_ms: d.zaman.simdi() });
  }
  const takvim = sec.takvim ?? d.takvim;
  let serbest = !sec.kilitli;
  const sira: string[] = [];
  const ajandaJetonlari: Duzen["ajandaJetonlari"] = [];
  const ekler: Duzen["ekler"] = [];
  const olaylar: Duzen["olaylar"] = [];
  for (const ad of ["tur_delta", "tur_basladi", "tur_bitti", "tur_etkinligi", "tur_etkinligi_bitti", "olay_yazildi"] as const) {
    veriyolu.dinle(ad, (veri) => olaylar.push({ ad, veri: veri as J }));
  }
  let sayac = 0;
  const taban = sec.depoSarici ? sec.depoSarici(depo) : depo;
  const konusmaDeposu: Depo = {
    ...taban,
    kuyrukEkiYaz: (id, ek) => {
      ekler.push([id, ek]);
      taban.kuyrukEkiYaz(id, ek);
    },
  };
  const ajandaAcik = sec.ajanda !== false;
  const konusma = konusmaKur({
    sohbet_id: ANA,
    kapi: sahteKapi(),
    nesilAyir: (() => {
      let n = 0;
      return () => (n = Math.max(n, depo.enBuyukNesil()) + 1);
    })(),
    ayar: sahteAyar(),
    depo: konusmaDeposu,
    kilit: { baslatmaSerbestMi: () => serbest },
    kopru: {
      jetonUret: (k: JetonKapsami) => {
        sira.push(`eren:uret:${"nesil" in k ? k.nesil : "?"}`);
        return `eren-jeton-${String(++sayac).padStart(4, "0")}`.padEnd(40, "x");
      },
      jetonlariIptalEt: (k: JetonKapsami) => void sira.push(`eren:iptal:${"nesil" in k ? k.nesil : "?"}`),
    },
    akis: akisKur(),
    surec: {
      ...d.surec,
      boruluBaslat: async (istek) => {
        sira.push(`baslat:${istek.argv.includes("--resume") ? "devam" : "yeni"}`);
        return d.surec.boruluBaslat(istek);
      },
    },
    dosya: d.dosya,
    saat: d.saat,
    zamanlayici: d.zamanlayici,
    rastgele: d.rastgele,
    veriyolu,
    gunluk: d.gunluk,
    ...(ajandaAcik && { takvim }),
    ...(ajandaAcik &&
      !sec.yalnizTakvim && {
        ajandaKopru: {
          jetonUret: (k: AjandaJetonKapsami) => {
            if (sec.ajandaJetonUretAtar) throw new Error("ajanda köprüsü yok");
            sira.push(`ajanda:uret:${k.nesil}`);
            const jeton = `ajanda-jeton-${String(++sayac).padStart(4, "0")}`.padEnd(40, "y");
            ajandaJetonlari.push({ kapsam: k, jeton });
            return jeton;
          },
          jetonlariIptalEt: (k: AjandaJetonKapsami) => {
            assert.equal(k.rol, "ana_oturum");
            assert.equal(k.sohbet_id, ANA);
            sira.push(`ajanda:iptal:${k.nesil}`);
          },
        },
      }),
  });
  return {
    d,
    depo,
    veriyolu,
    konusma,
    sec: { sohbet_id: ANA },
    takvim,
    ajandaJetonlari,
    sira,
    ekler,
    olaylar,
    kilitDegis: (s) => {
      serbest = s;
      veriyolu.yayinla("kilit_degisti", { durum: s ? { tur: "serbest" } : { tur: "aktif", bitis_ms: null } } as never);
    },
  };
}

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
};

/** Sahte saatli bekleme içeren sözü çözdürür (yeni sayfa, uyutma, sonlandırma): 250 ms adımlarla en çok 60 sn. */
async function sozBekle<T>(h: Duzen, p: Promise<T>): Promise<T> {
  let bitti = false;
  let deger: T | undefined;
  p.then((d) => {
    bitti = true;
    deger = d;
  });
  const onceki = h.d.surec.borulular().length;
  const initli = new Set<SahteBoruluSurec>();
  for (let i = 0; i < 240 && !bitti; i++) {
    await bosalt();
    for (const s of h.d.surec.borulular().slice(onceki)) {
      if (initli.has(s)) continue;
      initli.add(s);
      s.stdoutSatiriGonder(initSatiri(s));
    }
    await bosalt();
    if (!bitti) h.d.zaman.ilerlet(250);
  }
  assert.ok(bitti, "söz 60 sn içinde çözülmeli");
  return deger as T;
}

const satir = (o: unknown): string => JSON.stringify(o);
const oturumKimligi = (s: SahteBoruluSurec): string => {
  const a = s.istek.argv;
  return a[Math.max(a.indexOf("--session-id"), a.indexOf("--resume")) + 1]!;
};
const initSatiri = (s: SahteBoruluSurec, tools: string[] = ["mcp__eren__plan_oner"], apiKeySource = "none"): string =>
  satir({ type: "system", subtype: "init", session_id: oturumKimligi(s), tools, apiKeySource, model: MODEL });
const asistan = (id: string, input: number): string =>
  satir({
    type: "assistant",
    message: { id, model: MODEL, usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } },
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

const insan = (
  h: Duzen,
  n: number,
  text = `merhaba ${n}`,
  ek: { input?: string; baglam?: { paket: string; ad: string } } = {},
): { seq: number } =>
  h.konusma.insanMesajiAl({
    device_id: "cihaz1",
    client_msg_id: `msg${n}`,
    sohbet_id: ANA,
    input: ek.input ?? "yazi",
    text,
    ...(ek.baglam !== undefined && { baglam: ek.baglam }),
  } as unknown as DogrulanmisInsanMesaji);

const satirlar = (s: SahteBoruluSurec): J[] => s.yazilanlar.map((x) => JSON.parse(x) as J);
const icerik = (l: J): string => (l["message"] as { content: string }).content;
const sonIcerik = (s: SahteBoruluSurec): string => icerik(satirlar(s).at(-1)!);
const mcp = (h: Duzen, nesil: number): J => JSON.parse(h.d.dosya.icerik(mcpYolu(nesil)) ?? "null") as J;
const olaylarHepsi = (h: Duzen): Olay[] => h.depo.olaylariGetir(0, 10_000);

async function ac(h: Duzen): Promise<SahteBoruluSurec> {
  await h.konusma.baslat();
  h.konusma.uyandir();
  await bosalt();
  const s = h.d.surec.borulular().at(-1);
  assert.ok(s, "süreç açılmalıydı");
  s.stdoutSatiriGonder(initSatiri(s));
  await bosalt();
  return s;
}

const DAMGA_2358 = "[mesaj_ani: 2026-11-25 Çarşamba 23:58 Europe/Istanbul]";
const AN_2358 = { tarih: "2026-11-25", saat: "23:58", saat_dilimi: "Europe/Istanbul" };

// ---------------------------------------------------------------------------------------------

describe("ajanda kapalı (A0.6): takvim ve ajandaKopru yokken bugünkü gibi", () => {
  it("mcp dosyasında yalnız eren; stdin içerikleri damgasız ve bayt bayt eski biçim; ek yazılmaz; turBaglami null", async () => {
    const h = kur({ ajanda: false });
    const s = await ac(h);
    assert.deepEqual(Object.keys(mcp(h, 1)["mcpServers"]), ["eren"]);
    assert.equal(h.d.dosya.icerik(mcpYolu(1)), JSON.stringify({
      mcpServers: {
        eren: { type: "stdio", command: NODE, args: [KOPRU, "--rol", "eren"], env: { EREN_KOPRU_JETON: "eren-jeton-0001".padEnd(40, "x") }, alwaysLoad: true },
      },
    }));
    insan(h, 1, "yarın 3'te dişçi");
    await bosalt();
    assert.equal(
      s.yazilanlar.at(-1),
      '{"type":"user","parent_tool_use_id":null,"client_composed":true,"origin":{"kind":"human"},"message":{"role":"user","content":"yarın 3\'te dişçi"}}',
    );
    assert.equal(h.konusma.turBaglami?.(1), null);
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 7, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(
      s.yazilanlar.at(-1),
      '{"type":"user","parent_tool_use_id":null,"client_composed":true,"isSynthetic":true,"message":{"role":"user","content":"İş 7 bitti, durum: tamam."}}',
    );
    assert.deepEqual(h.ekler, [], "kuyruk eki yok");
    assert.equal(h.d.takvim.cagrilar.say(), 0, "takvim hiç çağrılmaz");
    assert.equal(h.sira.some((x) => x.startsWith("ajanda:")), false);
  });

  it("argv ajanda açıkken yalnız sistem isteminde farklı: kapalıyken ajanda öncesi istem, takvim varken damgalı istem", async () => {
    const kapali = kur({ ajanda: false });
    const acik = kur();
    const takvimli = kur({ yalnizTakvim: true });
    const s1 = await ac(kapali);
    const s2 = await ac(acik);
    const s3 = await ac(takvimli);
    const i = s1.istek.argv.indexOf("--system-prompt") + 1;
    assert.ok(i > 0);
    // Sahte ayar: kimlik eki boş, computer-use yok (masaüstü kapalı), tam yetki açık, ad "Claude".
    assert.equal(s1.istek.argv[i], sistemIstemi("", false, true, "Claude"));
    assert.equal(s1.istek.argv[i]!.includes("mesaj_ani"), false, "ajandasız istem damgadan söz etmez");
    for (const s of [s2, s3]) {
      assert.equal(s.istek.argv[i], sistemIstemi("", false, true, "Claude", true));
      assert.deepEqual(s.istek.argv.toSpliced(i, 1), s1.istek.argv.toSpliced(i, 1), "istem dışında argv aynı");
      assert.deepEqual(s.istek.ortam, s1.istek.ortam);
    }
  });

  it("yalnız takvim: damga var, ajanda köprüsü (jeton, mcp girdisi) yok", async () => {
    const h = kur({ yalnizTakvim: true, baslangicMs: ist(25, 23, 58) });
    const s = await ac(h);
    assert.deepEqual(Object.keys(mcp(h, 1)["mcpServers"]), ["eren"]);
    insan(h, 1, "selam");
    await bosalt();
    assert.equal(sonIcerik(s), `${DAMGA_2358}\nselam`);
  });
});

describe("ajanda köprüsü ve jeton", () => {
  it("mcp dosyasında eren-ajanda: kopru --rol ana_oturum, ajanda jetonu yalnız ortamda, kapsam sohbet+nesil", async () => {
    const h = kur();
    const s = await ac(h);
    assert.deepEqual(h.ajandaJetonlari.map((j) => j.kapsam), [{ rol: "ana_oturum", sohbet_id: ANA, nesil: 1 }]);
    const jeton = h.ajandaJetonlari[0]!.jeton;
    const sunucular = mcp(h, 1)["mcpServers"] as J;
    assert.deepEqual(Object.keys(sunucular), ["eren", "eren-ajanda"]);
    assert.deepEqual(sunucular["eren-ajanda"], {
      type: "stdio",
      command: NODE,
      args: [KOPRU, "--rol", "ana_oturum"],
      env: { EREN_KOPRU_JETON: jeton },
      alwaysLoad: true,
    });
    assert.notEqual(sunucular["eren"]["env"]["EREN_KOPRU_JETON"], jeton, "iki köprünün jetonu ayrı");
    assert.equal(s.istek.argv.some((a) => a.includes(jeton)), false, "jeton argümanda yok");
    assert.deepEqual(h.sira.slice(0, 3), ["eren:uret:1", "ajanda:uret:1", "baslat:yeni"]);
  });

  it("init denetimi araç listesine bakmaz: ajanda araçları olsa da olmasa da aynı kabul, abonelik dışı kaynak yine ret", async () => {
    const AJANDA_ARAC_LISTESI = ["mcp__eren__plan_oner", "mcp__eren-ajanda__ajanda_ekle", "mcp__eren-ajanda__ajanda_listele"];
    const initGonder = async (tools: string[], apiKeySource: string) => {
      const h = kur();
      await h.konusma.baslat();
      h.konusma.uyandir();
      await bosalt();
      const s = h.d.surec.borulular().at(-1)!;
      s.stdoutSatiriGonder(initSatiri(s, tools, apiKeySource));
      await bosalt();
      return { durum: h.konusma.durum(), canli: s.canli };
    };
    // Kabul ve ret yalnız `apiKeySource`'a bağlı: aynı kaynakla ajanda araçlarının varlığı sonucu değiştirmez.
    for (const kaynak of ["none", "ANTHROPIC_API_KEY"]) {
      const ajandali = await initGonder(AJANDA_ARAC_LISTESI, kaynak);
      const ajandasiz = await initGonder(["mcp__eren__plan_oner"], kaynak);
      assert.deepEqual(ajandali, ajandasiz, `apiKeySource=${kaynak}`);
      assert.equal(ajandali.canli, kaynak === "none", `apiKeySource=${kaynak}`);
      assert.equal(ajandali.durum === "hazir", kaynak === "none", `apiKeySource=${kaynak}`);
    }
  });

  it("devam (--resume): eski ajanda jetonu yenisi üretilmeden iptal, mcp yeni jetonla yeniden yazılır", async () => {
    const h = kur();
    const s1 = await ac(h);
    s1.cik(1);
    await bosalt();
    h.d.zaman.ilerlet(30_000);
    await bosalt();
    const s2 = h.d.surec.borulular().at(-1)!;
    assert.notEqual(s2, s1);
    assert.ok(s2.istek.argv.includes("--resume"));
    assert.deepEqual(h.sira, [
      "eren:uret:1",
      "ajanda:uret:1",
      "baslat:yeni",
      "eren:iptal:1",
      "ajanda:iptal:1",
      "eren:uret:1",
      "ajanda:uret:1",
      "baslat:devam",
    ]);
    assert.equal(mcp(h, 1)["mcpServers"]["eren-ajanda"]["env"]["EREN_KOPRU_JETON"], h.ajandaJetonlari[1]!.jeton);
  });

  it("devir: aday yeni neslin ajanda jetonunu alır; devir bitince eski neslin ajanda jetonu iptal, eski nesle bağlam yok", async () => {
    const h = kur();
    const s1 = await ac(h);
    insan(h, 1);
    await bosalt();
    s1.stdoutSatiriGonder(asistan("m1", 250_000));
    s1.stdoutSatiriGonder(sonuc());
    await bosalt();
    // Devir isteği turu (eski nesil, görünmez): sentetik bağlam, turun açıldığı an.
    const istekBaglami = h.konusma.turBaglami?.(1);
    assert.equal(istekBaglami?.tur_kokeni, "sentetik");
    assert.ok(sonIcerik(s1).startsWith("[mesaj_ani: 2026-11-25 Çarşamba 12:00 Europe/Istanbul]\n"));
    assert.deepEqual(h.konusma.devirOzetiAl("OZET", 1), { kabul: true });
    h.d.zaman.ilerlet(60_000);
    s1.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    const s2 = h.d.surec.borulular().at(-1)!;
    assert.notEqual(s2, s1);
    const yeni = h.ajandaJetonlari.at(-1)!;
    assert.equal(yeni.kapsam.nesil, 2);
    assert.equal(mcp(h, 2)["mcpServers"]["eren-ajanda"]["env"]["EREN_KOPRU_JETON"], yeni.jeton);
    s2.stdoutSatiriGonder(initSatiri(s2));
    await bosalt();
    // Devir ilk turu (aday): sentetik, damga turun açıldığı an (12:01).
    const ilk = satirlar(s2)[0]!;
    assert.ok(icerik(ilk).startsWith("[mesaj_ani: 2026-11-25 Çarşamba 12:01 Europe/Istanbul]\n"));
    const adayBaglami = h.konusma.turBaglami?.(2);
    assert.equal(adayBaglami?.tur_kokeni, "sentetik");
    assert.deepEqual(adayBaglami?.mesaj_ani, { tarih: "2026-11-25", saat: "12:01", saat_dilimi: "Europe/Istanbul" });
    assert.equal(h.sira.includes("ajanda:iptal:1"), false, "devir bitmeden eski jeton yaşar");
    s2.stdoutSatiriGonder(sonuc({ result: "" }));
    await bosalt();
    assert.ok(h.sira.includes("ajanda:iptal:1"));
    assert.ok(h.sira.indexOf("ajanda:iptal:1") > h.sira.indexOf("ajanda:uret:2"));
    assert.equal(h.konusma.turBaglami?.(1), null, "eski neslin turu yok");
  });

  it("yeni sayfa: eski neslin ajanda jetonu iptal, yeni nesil yeni jetonla açılır", async () => {
    const h = kur();
    await ac(h);
    await sozBekle(h, h.konusma.yeniSayfa());
    const i = h.sira.indexOf("ajanda:iptal:1");
    assert.ok(i >= 0);
    assert.ok(h.sira.indexOf("ajanda:uret:2") > i, "yeni jeton eski iptalden sonra");
    assert.equal(mcp(h, 2)["mcpServers"]["eren-ajanda"]["env"]["EREN_KOPRU_JETON"], h.ajandaJetonlari.at(-1)!.jeton);
  });

  it("uyutma ve sonlandırma ajanda jetonunu iptal eder", async () => {
    const h = kur();
    await ac(h);
    await sozBekle(h, h.konusma.uyut());
    assert.ok(h.sira.includes("ajanda:iptal:1"));

    const h2 = kur();
    await ac(h2);
    await sozBekle(h2, h2.konusma.sonlandir());
    assert.ok(h2.sira.includes("ajanda:iptal:1"));
    assert.equal(h2.konusma.turBaglami?.(1), null);
  });

  it("ajanda jetonu üretilemezse sohbet yine açılır, mcp dosyasında ajanda girdisi olmaz", async () => {
    const h = kur({ ajandaJetonUretAtar: true });
    const s = await ac(h);
    assert.equal(h.konusma.durum(), "hazir");
    assert.deepEqual(Object.keys(mcp(h, 1)["mcpServers"]), ["eren"]);
    insan(h, 1, "selam");
    await bosalt();
    assert.ok(sonIcerik(s).endsWith("\nselam"), "damga yine var (takvim verildi)");
  });
});

describe("tur bağlamı", () => {
  it("insan turu: köken insan, turn_id insanTuru ile aynı, öneksiz metin, kaynak_msg_id; başka nesil ve tur sonrası null", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 58, 41) });
    const s = await ac(h);
    insan(h, 1, "yarın 3'te dişçi ☕️");
    await bosalt();
    const b = h.konusma.turBaglami?.(1);
    const turn_id = h.konusma.insanTuru();
    assert.ok(turn_id !== null);
    assert.deepEqual(b, {
      tur_kokeni: "insan",
      turn_id,
      mesaj_ani: AN_2358,
      insan_metni: "yarın 3'te dişçi ☕️",
      kaynak_msg_id: "msg1",
    } satisfies AjandaTurBaglami);
    assert.equal(sonIcerik(s), `${DAMGA_2358}\nyarın 3'te dişçi ☕️`);
    assert.equal(h.konusma.turBaglami?.(2), null, "başka nesil");
    // Dönen nesne kopyadır: çağıranın değiştirmesi turu bozmaz.
    (b as { mesaj_ani: { saat: string } }).mesaj_ani.saat = "00:00";
    assert.deepEqual(h.konusma.turBaglami?.(1)?.mesaj_ani, AN_2358);
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(h.konusma.turBaglami?.(1), null, "tur bitti");
  });

  it("kısayol: model satırında damga + önek + metin; insan_metni öneksiz; user_echo öneksiz ve damgasız", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 58) });
    const s = await ac(h);
    insan(h, 1, "bunu özetle", { input: "kisayol", baglam: { paket: "com.ornek.uygulama", ad: "Ornek" } });
    await bosalt();
    assert.equal(
      sonIcerik(s),
      `${DAMGA_2358}\n[telefon kısayolu: kullanıcı şu an "Ornek" (com.ornek.uygulama) uygulamasına bakıyor]\nbunu özetle`,
    );
    const b = h.konusma.turBaglami?.(1);
    assert.equal(b?.tur_kokeni === "insan" ? b.insan_metni : null, "bunu özetle");
    const echo = olaylarHepsi(h).find((o) => o.type === "user_echo") as J;
    assert.equal(echo["text"], "bunu özetle");
    assert.deepEqual(echo["baglam"], { paket: "com.ornek.uygulama", ad: "Ornek" });
  });

  it("sentetik tur: köken sentetik, mesaj anı satırın varışı; insan_metni yok", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 58) });
    const s = await ac(h);
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 7, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    await bosalt();
    const l = satirlar(s).at(-1)!;
    assert.equal(l["isSynthetic"], true);
    assert.equal("origin" in l, false);
    assert.equal(icerik(l), `${DAMGA_2358}\nİş 7 bitti, durum: tamam.`);
    assert.deepEqual(h.konusma.turBaglami?.(1), {
      tur_kokeni: "sentetik",
      turn_id: h.depo.acikTurlar(h.sec)[0]!.turn_id,
      mesaj_ani: AN_2358,
    });
    assert.equal(h.konusma.insanTuru(), null);
  });

  it("birleşik sentetik: en yeni satırın varışı, tek damga en başta", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 50) });
    const s = await ac(h);
    insan(h, 1); // meşgul et
    await bosalt();
    const yay = (is_id: number): void =>
      h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    yay(1);
    h.d.zaman.git(ist(25, 23, 55));
    yay(2);
    h.d.zaman.git(ist(25, 23, 58, 59));
    yay(3);
    h.d.zaman.git(ist(26, 0, 1));
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    const c = sonIcerik(s);
    assert.equal(c, `${DAMGA_2358}\nİş 1 bitti, durum: tamam.\nİş 2 bitti, durum: tamam.\nİş 3 bitti, durum: tamam.`);
    assert.equal(c.split("[mesaj_ani:").length, 2, "tek damga");
    assert.deepEqual(h.konusma.turBaglami?.(1)?.mesaj_ani, AN_2358);
    assert.equal(h.konusma.turBaglami?.(1)?.tur_kokeni, "sentetik");
  });

  it("kurtarma notu turu: sentetik, turun açıldığı an", async () => {
    const h = kur({ baslangicMs: ist(26, 0, 1) });
    h.depo.nesilEkle({
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
    });
    h.depo.turEkle({
      turn_id: "tur1",
      sohbet_id: ANA,
      nesil: 1,
      kaynak: "insan",
      gorunur: true,
      baslangic_ms: 1000,
      bitis_ms: null,
      bitis: null,
      kismi_metin: "yarım",
    });
    const s = await ac(h);
    const c = icerik(satirlar(s)[0]!);
    assert.ok(c.startsWith("[mesaj_ani: 2026-11-26 Perşembe 00:01 Europe/Istanbul]\nSüreç yeniden başladı"), c);
    assert.equal(h.konusma.turBaglami?.(1)?.tur_kokeni, "sentetik");
    // devam: eski jeton iptal edildi, yenisi üretildi
    assert.deepEqual(h.sira.slice(0, 4), ["eren:iptal:1", "ajanda:iptal:1", "eren:uret:1", "ajanda:uret:1"]);
  });

  it("açık tur yokken, örnek kapanınca ve takvim yokken null", async () => {
    const h = kur();
    assert.equal(h.konusma.turBaglami?.(1), null, "süreç yok");
    const s = await ac(h);
    assert.equal(h.konusma.turBaglami?.(1), null, "hazır, tur yok");
    insan(h, 1);
    await bosalt();
    assert.notEqual(h.konusma.turBaglami?.(1), null);
    void s;
    await h.konusma.kapat();
    assert.equal(h.konusma.turBaglami?.(1), null, "kapandı");
  });

  it("takvim atarsa (dilim bilinmiyor): mesaj kabul edilir, damgasız gider, bağlam null (araç tur_gecersiz)", async () => {
    const h = kur();
    const s = await ac(h);
    h.takvim.dilim = "Mars/Olympus";
    insan(h, 1, "selam");
    await bosalt();
    assert.equal(sonIcerik(s), "selam");
    assert.equal(h.konusma.turBaglami?.(1), null);
    assert.equal(h.konusma.insanTuru() !== null, true, "insan turu yine açıldı");
  });
});

describe("varış anı ve damga", () => {
  it("23:58 varış, meşgul oturum, 00:01 iletim: damga ve turBaglami 23:58 (ertesi gün değil)", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 50) });
    const s = await ac(h);
    insan(h, 1, "ilk");
    await bosalt();
    h.d.zaman.git(ist(25, 23, 58, 30));
    insan(h, 2, "yarın 3'te dişçi");
    await bosalt();
    assert.equal(sonIcerik(s), "[mesaj_ani: 2026-11-25 Çarşamba 23:50 Europe/Istanbul]\nilk", "ikinci beklemede");
    h.d.zaman.git(ist(26, 0, 1));
    s.stdoutSatiriGonder(sonuc());
    await bosalt();
    assert.equal(sonIcerik(s), `${DAMGA_2358}\nyarın 3'te dişçi`);
    assert.deepEqual(h.konusma.turBaglami?.(1)?.mesaj_ani, AN_2358);
  });

  it("uyuyan oturum: 23:58 varan mesaj süreç 00:01'de açılınca 23:58 damgasıyla gider", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 58), kilitli: true });
    await h.konusma.baslat();
    insan(h, 1, "yarın 3'te dişçi");
    await bosalt();
    assert.equal(h.d.surec.borulular().length, 0);
    h.d.zaman.git(ist(26, 0, 1));
    h.kilitDegis(true);
    await bosalt();
    const s = h.d.surec.borulular().at(-1)!;
    s.stdoutSatiriGonder(initSatiri(s));
    await bosalt();
    assert.equal(sonIcerik(s), `${DAMGA_2358}\nyarın 3'te dişçi`);
    assert.deepEqual(h.konusma.turBaglami?.(1)?.mesaj_ani, AN_2358);
  });

  it("varış anı satırla saklanır (kuyrukEkiYaz, kaynak_msg_id); kullanıcının dilimi sonra değişse de varıştaki dilim geçerli", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 58), kilitli: true });
    await h.konusma.baslat();
    insan(h, 1, "selam");
    const bas = h.depo.kuyrukBasi(h.sec)!;
    assert.deepEqual(h.ekler, [[bas.id, { mesaj_ani: AN_2358, kaynak_msg_id: "msg1" }]]);
    assert.deepEqual(bas.mesaj_ani, AN_2358);
    assert.equal(bas.metin, "selam", "kuyruk metni damgasız");
    h.takvim.dilim = "Asia/Tokyo";
    h.kilitDegis(true);
    await bosalt();
    const s = h.d.surec.borulular().at(-1)!;
    s.stdoutSatiriGonder(initSatiri(s));
    await bosalt();
    assert.equal(sonIcerik(s), `${DAMGA_2358}\nselam`);
  });

  it("sentetik satırın eki de aynı işlemde yazılır", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 58), kilitli: true });
    await h.konusma.baslat();
    h.veriyolu.yayinla("is_bitti", { sohbet_id: ANA, is_id: 7, plan_id: "p", tur: "pc", durum: "tamam", kirli: false });
    const bas = h.depo.kuyrukBasi(h.sec)!;
    assert.equal(bas.kaynak, "sentetik");
    assert.deepEqual(bas.mesaj_ani, AN_2358);
    assert.equal(bas.kaynak_msg_id, undefined);
  });

  it("ek yazılamazsa mesaj yine kabul edilir; an varış ms'inden (olusturma_ms) hesaplanır", async () => {
    const h = kur({
      baslangicMs: ist(25, 23, 58),
      depoSarici: (d) => ({
        ...d,
        kuyrukEkiYaz: () => {
          throw new Error("ek yazılamadı");
        },
      }),
    });
    const s = await ac(h);
    h.d.zaman.git(ist(25, 23, 58, 10));
    const { seq } = insan(h, 1, "selam");
    assert.ok(seq > 0);
    await bosalt();
    assert.equal(sonIcerik(s), `${DAMGA_2358}\nselam`);
    assert.equal(h.konusma.turBaglami?.(1)?.tur_kokeni, "insan");
  });
});

describe("yeniden başlatma: kuyrukta kalan satır", () => {
  it("varış anı, kaynak_msg_id korunur; insan_metni kuyruk metni; damga varış anı", async () => {
    const d = sahteDunya({ baslangicMs: ist(25, 23, 58) });
    const veriyolu = veriyoluKur({ gunluk: d.gunluk });
    const depo = depoKur({ yol: ":memory:", saat: d.saat, veriyolu, gunluk: d.gunluk });
    const h1 = kur({ d, depo, veriyolu, kilitli: true });
    await h1.konusma.baslat();
    insan(h1, 1, "yarın 3'te dişçi");
    await h1.konusma.kapat();
    // Servis 00:05'te, kullanıcı başka dilimde yeniden başlar.
    d.zaman.git(ist(26, 0, 5));
    const takvim = sahteTakvim("Asia/Tokyo");
    const h2 = kur({ d, depo, veriyolu, takvim });
    const s = await ac(h2);
    assert.equal(sonIcerik(s), `${DAMGA_2358}\nyarın 3'te dişçi`);
    assert.deepEqual(h2.konusma.turBaglami?.(1), {
      tur_kokeni: "insan",
      turn_id: h2.konusma.insanTuru(),
      mesaj_ani: AN_2358,
      insan_metni: "yarın 3'te dişçi",
      kaynak_msg_id: "msg1",
    });
  });

  it("eki olmayan (eski kodun yazdığı) satır: an olusturma_ms'ten, o anki dilimle", async () => {
    const d = sahteDunya({ baslangicMs: ist(26, 0, 5) });
    const veriyolu = veriyoluKur({ gunluk: d.gunluk });
    const depo = depoKur({ yol: ":memory:", saat: d.saat, veriyolu, gunluk: d.gunluk });
    depo.kuyrugaEkle("insan", "eski satır", ist(25, 23, 58, 5), { sohbet_id: ANA });
    const h = kur({ d, depo, veriyolu });
    const s = await ac(h);
    assert.equal(sonIcerik(s), `${DAMGA_2358}\neski satır`);
    const b = h.konusma.turBaglami?.(1);
    assert.equal(b?.tur_kokeni, "insan");
    assert.equal(b !== null && b !== undefined && "kaynak_msg_id" in b, false, "kimlik bilinmiyor: alan yok");
  });
});

describe("sızma: damga yalnız modele giden metinde", () => {
  it("events, kuyruk metni, telefona giden olaylar ve sesli (dikte) eşleme damgasız; tur_etkinligi kaynak_msg_id korunur", async () => {
    const h = kur({ baslangicMs: ist(25, 23, 58) });
    const s = await ac(h);
    h.olaylar.length = 0;
    insan(h, 5, "sesli soru", { input: "dikte" });
    await bosalt();
    assert.equal(sonIcerik(s), `${DAMGA_2358}\nsesli soru`);
    const echo = olaylarHepsi(h).find((o) => o.type === "user_echo") as J;
    assert.deepEqual(
      { input: echo["input"], text: echo["text"], client_msg_id: echo["client_msg_id"] },
      { input: "dikte", text: "sesli soru", client_msg_id: "msg5" },
    );
    const etkinlik = h.olaylar.find((o) => o.ad === "tur_etkinligi")!;
    assert.equal(etkinlik.veri["kaynak_msg_id"], "msg5", "sesli cevap eşlemesi");
    s.stdoutSatiriGonder(sonuc({ result: "cevap" }));
    await bosalt();
    const tum = JSON.stringify(olaylarHepsi(h)) + JSON.stringify(h.olaylar);
    assert.equal(tum.includes("mesaj_ani"), false, "damga hiçbir olaya girmez");
    assert.equal(tum.includes("23:58"), false);
    assert.equal(JSON.stringify(h.depo.sonKonusma(10, h.sec)).includes("mesaj_ani"), false, "devir notunun kaynağı damgasız");
  });
});
