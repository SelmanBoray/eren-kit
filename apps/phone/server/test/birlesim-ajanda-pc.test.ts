/**
 * PC oturumları birleşim testi (`docs/AJANDA.md` "PC oturumları"). `servisKur` gerçek modülleri kurar
 * (takvim, ajanda, ajanda borusu, gateway, depo). Model tarafı gerçek `kopru.ts`'tir: PC köprüsü
 * (`ajandaKopruCalistir`, rol `pc_oturumu`, bellek içi MCP) ve Claude Code'un araç öncesi kancası
 * (`pcKancaCalistir`, Claude Code 2.1.332'de ölçülen biçimde `PreToolUse` JSON'u). Yalın yol: istem ve tur
 * sonu kancası yoktur. PC anahtarı gerçek `eslestir --claude-code` çekirdeğiyle
 * (`pcAnahtariUret`) üretilir; dosya yerine bellekte tutulur. Ajanda uygulaması sahte WebSocket'ten
 * gerçek P-256 imzayla bağlanır; giden her `/ajanda` çerçevesi kablo şemasından geçer.
 */
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, randomBytes, sign as imzaAt, timingSafeEqual, verify as imzaDogrula } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  AJANDA_BORU_ADI,
  AJANDA_PC_ARAC_ACIKLAMALARI,
  AJANDA_ROL_FIILLERI,
  AJANDA_SURUMU,
  AjandaKaydi,
  type AjandaYerelAn,
  GUVENILMEZ_META,
  ajandaAsagiCoz,
  ajandaKimlikImzaMetni,
} from "@eren/protocol";
import { servisKur } from "../src/ana.ts";
import type { Servis } from "../src/ana.ts";
import { ayarKur } from "../src/ayar.ts";
import { ajandaEslestirmeBaslat, pcAnahtariUret } from "../src/eslestir.ts";
import {
  ajandaKopruCalistir,
  CLAUDE_CODE_ARAC_KIMLIGI,
  PC_ANAHTAR_GECERSIZ_METNI,
  PC_ANAHTAR_YOK_METNI,
  PC_KOPUK_METNI,
} from "../src/kopru.ts";
import { pcKancaCalistir } from "../src/kanca.ts";
import type { AnahtarPortu, Ayar, BoruBaglantisi, BoruSunucuIstegi } from "../src/sozlesme.ts";
import { sahteDunya, sahteGunluk, sahteRastgele } from "./sahte.ts";
import type { SahteDunya, SahteWsBaglantisi } from "./sahte.ts";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 2026-11-25 14:30 Europe/Istanbul (UTC+3).
const DILIM = "Europe/Istanbul";
const T0 = Date.UTC(2026, 10, 25, 11, 30, 0);
const DAKIKA = 60_000;
const YEREL = "C:\\ornek\\Yerel";
const KULLANICI = "C:\\ornek\\Kullanici";
const NODE_EXE = "C:\\ornek\\node.exe";
const CLAUDE_EXE = "C:\\ornek\\bin\\claude.exe";
const YEREL_AYAR = "C:\\ornek\\Yerel\\eren-kit\\ayar.local.json";
const TELEFON_IP = "100.64.0.20";
const OTURUM = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const BASLIK = "Dişçi ☕️";
const AN_1430: AjandaYerelAn = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r));
};
const uyu = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms).unref());

// --- Gerçek P-256 ----------------------------------------------------------------------------

const imzala = (anahtar: KeyObject, metin: string): string => imzaAt("sha256", Buffer.from(metin, "utf8"), anahtar).toString("base64");

const imzaTutarMi = (acik: string, metin: string, imza: string): boolean => {
  try {
    const k = createPublicKey({ key: Buffer.from(acik, "base64"), format: "der", type: "spki" });
    return imzaDogrula("sha256", Buffer.from(metin, "utf8"), k, Buffer.from(imza, "base64"));
  } catch {
    return false;
  }
};

function gercekAnahtar(): AnahtarPortu {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const acik = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return {
    acikAnahtar: () => acik,
    imzala: (metin) => imzala(privateKey, metin),
    dogrula: imzaTutarMi,
    sabitZamanEsit: (a, b) => {
      const x = Buffer.from(a, "utf8");
      const y = Buffer.from(b, "utf8");
      return x.length === y.length && timingSafeEqual(x, y);
    },
  };
}

// --- /ajanda ucu: giden her çerçeve kablo şemasından geçer --------------------------------------

interface AjandaUcu {
  c: SahteWsBaglantisi;
  tur(t: string): J[];
  gonder(m: J): Promise<void>;
  kayitlar(): AjandaKaydi[];
}

function ucSar(c: SahteWsBaglantisi): AjandaUcu {
  const kareler = (): J[] =>
    c.gonderilenler.map((m) => {
      const r = ajandaAsagiCoz(m);
      assert.ok(r.ok, `giden /ajanda çerçevesi şemaya uymuyor: ${m.slice(0, 300)}`);
      return r.mesaj as J;
    });
  const tur = (t: string): J[] => kareler().filter((k) => k["type"] === t);
  return {
    c,
    tur,
    gonder: async (m) => {
      c.mesajGonder(JSON.stringify(m));
      await bosalt();
    },
    kayitlar: () => tur("kayit").map((k) => AjandaKaydi.parse(k["kayit"])),
  };
}

// --- Bellek içi boru çifti: sahte `BoruSunucuPortu`'nun isteğine gerçek istemciyi bağlar --------

function boruCifti(istek: BoruSunucuIstegi): BoruBaglantisi {
  const sunucuyaGelen: Array<(s: string) => void> = [];
  const istemciyeGelen: Array<(s: string) => void> = [];
  const kapanislar: Array<() => void> = [];
  let kapandi = false;
  const kapat = (): void => {
    if (kapandi) return;
    kapandi = true;
    for (const f of kapanislar.splice(0)) f();
  };
  const ilet = (hedef: Array<(s: string) => void>, s: string): void => {
    setImmediate(() => {
      if (!kapandi) for (const f of [...hedef]) f(s);
    });
  };
  istek.baglanti({
    satirYaz: (s) => {
      if (!kapandi) ilet(istemciyeGelen, s);
    },
    kapat,
    satirDinle: (f) => void sunucuyaGelen.push(f),
    kapanisDinle: (f) => void kapanislar.push(f),
  });
  return {
    satirYaz: (s) => {
      if (kapandi) return;
      if (s.length > istek.azamiSatir) return kapat();
      ilet(sunucuyaGelen, s);
    },
    kapat,
    satirDinle: (f) => void istemciyeGelen.push(f),
    kapanisDinle: (f) => void kapanislar.push(f),
  };
}

// --- Ortam -----------------------------------------------------------------------------------

const temizlikler: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of temizlikler.splice(0).reverse()) {
    try {
      await f();
    } catch {
      // Temizlik testin kendi sonucunu örtmesin.
    }
  }
});

async function ortamKur(sec: { depoYolu?: string } = {}) {
  const d: SahteDunya = sahteDunya({ baslangicMs: T0, servisPid: 4000 });
  const anahtar = gercekAnahtar();
  d.dosya.yaz(CLAUDE_EXE, "");
  d.dosya.yaz(YEREL_AYAR, JSON.stringify({ kullanici_adi: "Deneme", claude_exe: CLAUDE_EXE, tam_yetki: false }));
  const ayar: Ayar = await ayarKur({
    dosya: d.dosya,
    ortam: { LOCALAPPDATA: YEREL, USERPROFILE: KULLANICI, PATH: "C:\\ornek\\bin" },
    execPath: NODE_EXE,
    baslangicMs: T0 - 5_000,
  });
  const depoYolu = sec.depoYolu ?? ":memory:";
  const dunya = { ...d.dunya, anahtar };
  const servisler: Servis[] = [];
  temizlikler.push(async () => {
    for (const s of servisler) await s.kapat();
  });
  /** Anahtar dosyasının içeriği (`null`: dosya yok). Köprü ve kanca her bağlanışta okur. */
  const dosya: { anahtar: string | null } = { anahtar: null };

  /** Boru dinlenmiyorsa (servis kapalı) gerçek adlı boru gibi bağlantı reddedilir. */
  const baglan = async (ad: string): Promise<BoruBaglantisi> => {
    const istek = d.boru.istek(ad);
    if (istek === null || d.boru.kapatildiMi(ad)) throw new Error(`boru dinlenmiyor: ${ad}`);
    return boruCifti(istek);
  };

  const o = {
    d,
    dosya,
    get servis(): Servis {
      const s = servisler.at(-1);
      assert.ok(s, "servis kurulmadı");
      return s;
    },
    baslat: async (): Promise<Servis> => {
      const s = servisKur({ dunya, ayar, depoYolu, ajanda: { sistemDilimi: () => DILIM } });
      servisler.push(s);
      await s.baslat();
      await bosalt();
      return s;
    },
    ilerlet: async (ms: number): Promise<void> => {
      d.zaman.ilerlet(ms);
      await bosalt();
    },
    /** `eren eslestir --claude-code`: depoya özet, "dosyaya" anahtar. */
    anahtarUret: (): string => {
      const { jeton } = pcAnahtariUret({ depo: o.servis.depo, rastgele: d.rastgele, saat: d.saat });
      dosya.anahtar = jeton;
      return jeton;
    },
    /** Kullanıcının Claude Code'una kayıtlı PC köprüsü: gerçek `kopru.ts`, model tarafı bellek içi MCP. */
    pcKoprusu: async (oturumId: string = OTURUM): Promise<Client> => {
      const [mcpKopru, mcpIstemci] = InMemoryTransport.createLinkedPair();
      const calisan = await ajandaKopruCalistir(
        { rol: "pc_oturumu", jeton: "", boruAdi: AJANDA_BORU_ADI, jetonOku: () => dosya.anahtar, oturumId },
        { transport: mcpKopru, baglan, rastgele: sahteRastgele(901), gunluk: sahteGunluk(), bekle: (ms) => uyu(Math.min(ms, 20)) },
      );
      const istemci = new Client({ name: "sahte-claude-code", version: "0.0.0" }, { capabilities: {} });
      await istemci.connect(mcpIstemci);
      temizlikler.push(async () => {
        await istemci.close().catch(() => {});
        await calisan.kapat();
      });
      return istemci;
    },
    /** Claude Code'un araç öncesi kancası (stdin JSON'u); `giris` kanca sürecinin `CLAUDE_CODE_ENTRYPOINT`'i. */
    kanca: (girdi: J, giris = "cli", surec?: string): Promise<void> =>
      pcKancaCalistir(JSON.stringify(girdi), {
        baglan,
        jetonOku: () => dosya.anahtar,
        bekle: uyu,
        servisOturumu: false,
        giris,
        surec,
      }),
    /** Modelin çağrısı; `aracId` Claude Code'un `_meta`'daki çağrı kimliği. Modele giden tek metin döner. */
    arac: async (istemci: Client, fiil: string, girdi: J, aracId?: string): Promise<{ metin: string; hata: boolean; meta: unknown }> => {
      const r = await istemci.callTool({ name: fiil, arguments: girdi, ...(aracId === undefined ? {} : { _meta: { [CLAUDE_CODE_ARAC_KIMLIGI]: aracId } }) });
      await bosalt();
      const icerik = r.content as Array<{ type: string; text: string }>;
      assert.equal(icerik.length, 1, `tek metin içeriği değil: ${JSON.stringify(r)}`);
      assert.equal(icerik[0]!.type, "text");
      assert.equal(r.structuredContent, undefined, "structuredContent modele gitmemeli");
      return { metin: icerik[0]!.text, hata: r.isError === true, meta: r._meta };
    },
    ajandaUygulamasi: async (): Promise<AjandaUcu> => {
      const { privateKey: ozel, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const acik = publicKey.export({ type: "spki", format: "der" }).toString("base64");
      const b = ajandaEslestirmeBaslat({ depo: o.servis.depo, anahtar, sistem: d.sistem, rastgele: d.rastgele, saat: d.saat, wsPort: ayar.wsPort });
      assert.ok(b.ok);
      const e = ucSar(d.ws.baglan("/ajanda", TELEFON_IP));
      await e.gonder({ v: AJANDA_SURUMU, type: "pair_request", kod: b.deger.kod, public_key: acik, platform: "android", etiket: "ajanda" });
      const pr = e.tur("pair_result")[0];
      assert.ok(pr?.["ok"], "ajanda eşleşmedi");
      e.c.istemciKopar();
      const device_id = pr["device_id"] as string;
      const u = ucSar(d.ws.baglan("/ajanda", TELEFON_IP));
      const client_nonce = randomBytes(32).toString("base64");
      await u.gonder({ v: AJANDA_SURUMU, type: "hello", device_id, client_nonce, son_rev: 0 });
      const ch = u.tur("auth_challenge")[0];
      assert.ok(ch, "auth_challenge yok");
      const ortak = { device_id, client_nonce, server_nonce: ch["server_nonce"] as string };
      await u.gonder({ v: AJANDA_SURUMU, type: "auth_response", signature: imzala(ozel, ajandaKimlikImzaMetni({ rol: "telefon", ...ortak })) });
      assert.equal(u.tur("welcome").length, 1, "/ajanda welcome yok");
      return u;
    },
  };
  return o;
}

type Ortam = Awaited<ReturnType<typeof ortamKur>>;

/** Claude Code'un PreToolUse girdisi (ölçülen alanlar; alt agent'ta `agent_id` ve `agent_type` dolu). */
const aracGirdisi = (fiil: string, tool_use_id: string, prompt_id: string, agent_id?: string): J => ({
  session_id: OTURUM,
  transcript_path: "C:\\ornek\\transkript.jsonl",
  cwd: "C:\\ornek\\proje",
  prompt_id,
  permission_mode: "default",
  ...(agent_id === undefined ? {} : { agent_id, agent_type: "general-purpose" }),
  effort: { level: "medium" },
  hook_event_name: "PreToolUse",
  tool_name: `mcp__eren-ajanda__${fiil}`,
  tool_input: {},
  tool_use_id,
  mcp_server: { name: "eren-ajanda", source: "user" },
});

const disci = (dayanak: J): J => ({
  tur: "randevu",
  baslik: BASLIK,
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", ifade: "yarın 3'te" },
  alinti: "yarın 3'te dişçi",
  dayanak,
});

/** Servis, ajanda uygulaması ve PC anahtarı hazır; köprü bağlı. */
async function hazirla(o: Ortam) {
  await o.baslat();
  const ajanda = await o.ajandaUygulamasi();
  o.anahtarUret();
  const istemci = await o.pcKoprusu();
  return { ajanda, istemci };
}

/** Claude Code'un sırası: araç öncesi kanca (tasdik), bittikten sonra MCP çağrısı (aynı `tool_use_id`). */
async function anaCagrisi(o: Ortam, istemci: Client, fiil: string, girdi: J, aracId: string, istemId = "istem-1", agentId?: string) {
  await o.kanca(aracGirdisi(fiil, aracId, istemId, agentId));
  return o.arac(istemci, fiil, girdi, aracId);
}

// ---------------------------------------------------------------------------------------------

describe("birleşim: PC oturumu (araç öncesi kancalı Claude Code)", () => {
  it("ana ajan: listele şimdiki anı verir; üç araç gerçek köprü → boru → ajanda; kayıt /ajanda'ya taslaksız; kaynak pc_araci ve insan; liste çitli", async () => {
    const o = await ortamKur();
    const { ajanda, istemci } = await hazirla(o);

    const { tools } = await istemci.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...AJANDA_ROL_FIILLERI.pc_oturumu].sort());
    for (const t of tools) {
      assert.equal(t.description, AJANDA_PC_ARAC_ACIKLAMALARI[t.name as keyof typeof AJANDA_PC_ARAC_ACIKLAMALARI]);
      assert.equal(t.outputSchema, undefined);
    }

    // Damga yok: model "şimdi"yi araç yolundan öğrenir (açıklamadaki yönerge: önce listele).
    const simdi = await anaCagrisi(o, istemci, "ajanda_listele", { en_fazla: 1 }, "toolu_lis0");
    assert.match(simdi.metin, /^ajanda: mesaj_ani=2026-11-25 Çarşamba 14:30 Europe\/Istanbul/);
    assert.ok(!simdi.metin.includes("pc_tur:"));

    const ekle = await anaCagrisi(o, istemci, "ajanda_ekle", disci({ tarih: AN_1430.tarih, saat: AN_1430.saat }), "toolu_ekle1");
    assert.equal(ekle.hata, false, ekle.metin);
    assert.match(ekle.metin, /^ajanda_ekle: eklendi \(kayit \S+\) durum=acik zaman=2026-11-26 Perşembe 15:00 Europe\/Istanbul \(mesaj anına göre yarın\)/);
    assert.ok(!ekle.metin.includes(BASLIK) && !ekle.metin.includes("yarın 3'te dişçi"), "araç çıktısı kayıt metni taşıdı");
    const k = ajanda.kayitlar().at(-1)!;
    assert.equal(k.baslik, BASLIK);
    assert.equal(k.taslak, false);
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 60 }]);
    assert.deepEqual(
      { yol: k.kaynak.yol, tur_kokeni: k.kaynak.tur_kokeni, oturum_id: k.kaynak.oturum_id, msg: k.kaynak.kaynak_msg_id, alinti: k.kaynak.alinti },
      // Kullanıcının mesaj metni servise gitmez: alıntı doğrulanamaz, saklanmaz.
      { yol: "pc_araci", tur_kokeni: "insan", oturum_id: OTURUM, msg: "istem-1", alinti: undefined },
    );
    assert.equal(k.kaynak.sohbet_id, undefined);

    const guncelle = await anaCagrisi(o, istemci, "ajanda_guncelle", { kayit_id: k.kayit_id, degisiklik: { aciklama: "Kontrol" } }, "toolu_gun1");
    assert.match(guncelle.metin, /^ajanda_guncelle: güncellendi/);
    const k2 = ajanda.kayitlar().at(-1)!;
    assert.equal(k2.kayit_id, k.kayit_id);
    assert.ok(k2.revizyon > k.revizyon);
    assert.equal(k2.aciklama, "Kontrol");

    const liste = await anaCagrisi(o, istemci, "ajanda_listele", {}, "toolu_lis1");
    assert.equal(liste.hata, false);
    assert.deepEqual(liste.meta, GUVENILMEZ_META);
    const satirlar = liste.metin.split("\n");
    const ac = satirlar.findIndex((s) => s.startsWith("<<<okunan-metin "));
    assert.ok(ac >= 0, "liste çitli değil");
    const cit = satirlar[ac]!.slice("<<<okunan-metin ".length, -">>>".length);
    assert.ok(satirlar.includes(`<<<okunan-metin-sonu ${cit}>>>`), "çit kapanmıyor");
    // Başlık kaçışlı (emoji birleştirici görünür kaçış), çiğ hali metinde yok.
    assert.ok(!liste.metin.includes(BASLIK), "başlık kaçışsız gitti");
    assert.match(liste.metin, /Dişçi ☕\\u\{fe0f\}|Dişçi ☕\\ufe0f/);

    // Alt agent (aynı oturum, aynı prompt_id; Claude Code `agent_id` verir): ekleme taslak doğar.
    const sonra = await anaCagrisi(o, istemci, "ajanda_ekle", { tur: "not", baslik: "Arka plan notu" }, "toolu_ekle2", "istem-1", "a690393e919d1ad35");
    assert.match(sonra.metin, /taslak/);
    // Kaydın neden taslak doğduğu modele sabit satırla söylenir; ana ajanın çağrısında bu satır yoktur.
    assert.match(sonra.metin, /\npc_tur: sentetik \(alt_agent\)\. .*alt agent'ın kaydı her zaman taslaktır/);
    assert.ok(!ekle.metin.includes("pc_tur:") && !guncelle.metin.includes("pc_tur:") && !liste.metin.includes("pc_tur:"));
    const t = ajanda.kayitlar().at(-1)!;
    assert.equal(t.baslik, "Arka plan notu");
    assert.equal(t.taslak, true);
    assert.equal(t.kaynak.tur_kokeni, "sentetik");

    const gunluk = o.d.kayit.satirlar.join("\n");
    for (const gizli of [BASLIK, "Dişçi", "Kontrol", "istem-1", o.dosya.anahtar!]) assert.ok(!gunluk.includes(gizli), `günlükte: ${gizli}`);
  });

  it("kancasız ya da alt agent'tan çağrı: kayıt taslak doğar, dayanak çağrının anı; taslak olmayana dokunamaz", async () => {
    const o = await ortamKur();
    const { ajanda, istemci } = await hazirla(o);
    // Kanca kurulu değil: tasdik yok. Asistan saati bilmez; yanlış dayanak reddedilir ve şimdiki an döner.
    const yanlis = await o.arac(istemci, "ajanda_ekle", disci({ tarih: "2026-11-25", saat: "09:00" }), "toolu_x1");
    assert.match(yanlis.metin, /neden=dayanak_uyusmuyor/);
    assert.match(yanlis.metin, /mesaj_ani=2026-11-25 \S+ 14:30 Europe\/Istanbul/);
    const c = await o.arac(istemci, "ajanda_ekle", disci({ tarih: "2026-11-25", saat: "14:30" }), "toolu_x2");
    assert.match(c.metin, /ajanda_ekle: eklendi/);
    assert.match(c.metin, /pc_tur: sentetik \(tasdik_yok\)\. .*araç öncesi kancası bu çağrıyı servise bildirmedi/);
    assert.match(c.metin, /Teşhis: eren eslestir --claude-code --teshis/);
    const k = ajanda.kayitlar().at(-1)!;
    assert.equal(k.taslak, true);
    assert.deepEqual([k.kaynak.yol, k.kaynak.tur_kokeni, k.kaynak.oturum_id, k.kaynak.alinti], ["pc_araci", "sentetik", OTURUM, undefined]);
    // Claude Code çağrı kimliğini vermedi: tasdik olsa da eşleşemez.
    await o.kanca(aracGirdisi("ajanda_ekle", "toolu_x3", "istem-1"));
    const kimliksiz = await o.arac(istemci, "ajanda_ekle", { ...disci({ tarih: "2026-11-25", saat: "14:30" }), baslik: "Kimliksiz" });
    assert.match(kimliksiz.metin, /pc_tur: sentetik \(cagri_kimligi_yok\)/);
    assert.equal(ajanda.kayitlar().at(-1)!.taslak, true);

    // Ana ajanın tasdikli çağrısı taslağı kesinleştirir; sonra alt agent onu değiştiremez.
    const onay = await anaCagrisi(o, istemci, "ajanda_guncelle", { kayit_id: k.kayit_id, degisiklik: { onayla: true } }, "toolu_on");
    assert.match(onay.metin, /güncellendi/);
    assert.equal(o.servis.depo.ajandaKaydiGetir(k.kayit_id)?.taslak, false);
    const alt = await anaCagrisi(o, istemci, "ajanda_guncelle", { kayit_id: k.kayit_id, degisiklik: { durum: "iptal" } }, "toolu_alt", "istem-1", "agent-7");
    assert.match(alt.metin, /neden=sentetik_turda_izinsiz/);
    assert.match(alt.metin, /pc_tur: sentetik \(alt_agent\)/);
    assert.equal(o.servis.depo.ajandaKaydiGetir(k.kayit_id)?.durum, "acik");
  });

  it("-p oturumu (sdk-cli) taslak; bildirim turunda ana ajanın çağrısı insan sayılır (kalan risk: yalnız talimatla önlenir)", async () => {
    const o = await ortamKur();
    const { ajanda, istemci } = await hazirla(o);
    // Etkileşimsiz oturum (`claude -p`, Agent SDK): ana ajan da olsa taslak.
    await o.kanca(aracGirdisi("ajanda_ekle", "toolu_p1", "istem-p"), "sdk-cli");
    const p = await o.arac(istemci, "ajanda_ekle", disci({ tarih: "2026-11-25", saat: "14:30" }), "toolu_p1");
    assert.match(p.metin, /pc_tur: sentetik \(etkilesimsiz\)/);
    assert.equal(ajanda.kayitlar().at(-1)!.taslak, true);
    // Bildirim turu (ölçüldü: yeni prompt_id, agent_id yok): kanca kullanıcı turundan ayıramaz.
    const r = await anaCagrisi(o, istemci, "ajanda_ekle", { ...disci({ tarih: "2026-11-25", saat: "14:30" }), baslik: "Bildirimden" }, "toolu_b1", "istem-bildirim");
    assert.match(r.metin, /ajanda_ekle: eklendi/);
    assert.ok(!r.metin.includes("pc_tur:"));
    assert.equal(ajanda.kayitlar().at(-1)!.taslak, false, "kalan risk değişti: belgeyi güncelle (AJANDA.md Kalan açıklar)");
  });

  it("T5: iki Claude Code penceresi; B'nin köprüsü A'nın tasdikini tüketemez, A'nınki kullanır; /clear sonrası A sürer", async () => {
    const o = await ortamKur();
    const { ajanda, istemci: a } = await hazirla(o);
    const OTURUM_B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    const b = await o.pcKoprusu(OTURUM_B);
    const SUREC_A = "3060";
    const simdi = disci({ tarih: "2026-11-25", saat: "14:30" });
    // A'nın ilk çağrısı (kanca süreç kimliğiyle): A'nın Claude Code süreci A'nın köprüsüne bağlanır.
    await o.kanca(aracGirdisi("ajanda_ekle", "toolu_t1", "istem-1"), "cli", SUREC_A);
    const a1 = await o.arac(a, "ajanda_ekle", simdi, "toolu_t1");
    assert.ok(!a1.metin.includes("pc_tur:"), a1.metin);
    // A'nın sıradaki tasdiki B'nin köprüsünden sunulur: taslak, iz B'nin oturumu.
    await o.kanca(aracGirdisi("ajanda_ekle", "toolu_t2", "istem-2"), "cli", SUREC_A);
    const b1 = await o.arac(b, "ajanda_ekle", { ...simdi, baslik: "B'den" }, "toolu_t2");
    assert.match(b1.metin, /pc_tur: sentetik \(tasdik_yok\)/);
    const bk = ajanda.kayitlar().at(-1)!;
    assert.equal(bk.taslak, true);
    assert.equal(bk.kaynak.oturum_id, OTURUM_B);
    const a2 = await o.arac(a, "ajanda_ekle", { ...simdi, baslik: "A'dan" }, "toolu_t2");
    assert.ok(!a2.metin.includes("pc_tur:"), a2.metin);
    assert.equal(ajanda.kayitlar().at(-1)!.taslak, false);
    // /clear: kancanın oturumu yenilenir, köprününki (MCP sunucusu yeniden başlamaz) eskir.
    const temiz = { ...aracGirdisi("ajanda_ekle", "toolu_t3", "istem-3"), session_id: "5d6e7f80-1a2b-4c3d-8e9f-a0b1c2d3e4f5" };
    await o.kanca(temiz, "cli", SUREC_A);
    const a3 = await o.arac(a, "ajanda_ekle", { ...simdi, baslik: "Temizden sonra" }, "toolu_t3");
    assert.ok(!a3.metin.includes("pc_tur:"), a3.metin);
    assert.equal(ajanda.kayitlar().at(-1)!.taslak, false);
  });
});

describe("birleşim: PC anahtarı ve servisin yokluğu", () => {
  it("anahtar yokken, iptal edilince ve yenilenince: köprü yeniden başlamadan doğru metni verir, hiçbir şey yazılmaz", async () => {
    const o = await ortamKur();
    await o.baslat();
    const ajanda = await o.ajandaUygulamasi();
    const istemci = await o.pcKoprusu();
    const yok = await o.arac(istemci, "ajanda_listele", {});
    assert.equal(yok.hata, true);
    assert.equal(yok.metin, `hata: jeton_gecersiz\n${PC_ANAHTAR_YOK_METNI}`);
    // Kanca anahtarsız: servise gitmez, sessiz geçer (oturumu engellemez).
    await o.kanca(aracGirdisi("ajanda_listele", "toolu_a0", "istem-1"));

    o.anahtarUret();
    const r1 = await o.arac(istemci, "ajanda_listele", {});
    assert.equal(r1.hata, false, r1.metin);

    assert.equal(o.servis.depo.ajandaPcAnahtarlariniIptalEt(o.d.saat.simdiMs()), 1);
    const r2 = await o.arac(istemci, "ajanda_ekle", { tur: "not", baslik: "Yazılmamalı" });
    assert.equal(r2.metin, `hata: jeton_gecersiz\n${PC_ANAHTAR_GECERSIZ_METNI}`);
    const r3 = await o.arac(istemci, "ajanda_ekle", { tur: "not", baslik: "Yazılmamalı" });
    assert.equal(r3.metin, `hata: jeton_gecersiz\n${PC_ANAHTAR_GECERSIZ_METNI}`);
    assert.equal(o.servis.depo.ajandaKayitlari({}).length, 0);
    assert.equal(ajanda.kayitlar().length, 0);

    // Yeni anahtar: aynı köprü dosyayı yeniden okur ve bağlanır.
    o.anahtarUret();
    const r4 = await o.arac(istemci, "ajanda_ekle", { tur: "not", baslik: "Yazılmalı" });
    assert.match(r4.metin, /ajanda_ekle: eklendi/);
    assert.equal(ajanda.kayitlar().length, 1);
  });

  it("servis kapalıyken: araç açık metinle yazılmadı der, kanca sessiz geçer; yeniden başlayınca aynı anahtarla sürer", async () => {
    const dizin = mkdtempSync(join(tmpdir(), "eren-birlesim-ajanda-pc-"));
    temizlikler.unshift(() => rmSync(dizin, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const o = await ortamKur({ depoYolu: join(dizin, "eren.db") });
    const { istemci } = await hazirla(o);
    assert.match((await anaCagrisi(o, istemci, "ajanda_listele", {}, "toolu_l1")).metin, /^ajanda: mesaj_ani=/);

    await o.servis.kapat();
    await bosalt();
    const kapali = await o.arac(istemci, "ajanda_ekle", disci({ tarih: "2026-11-25", saat: "14:30" }), "toolu_k1");
    assert.equal(kapali.hata, true);
    assert.equal(kapali.metin, `hata: ic_hata\n${PC_KOPUK_METNI}`);
    await o.ilerlet(DAKIKA);
    // Servis kapalıyken kanca: tasdik servise ulaşmaz, sessiz geçer.
    await o.kanca(aracGirdisi("ajanda_ekle", "toolu_k2", "istem-2"));

    // Yeniden başlama: anahtar depoda durur (yeniden eşleştirme yok); bellekteki defter boştur.
    await o.baslat();
    const ajanda = await o.ajandaUygulamasi();
    const once = await o.arac(istemci, "ajanda_ekle", disci({ tarih: "2026-11-25", saat: "14:31" }), "toolu_k2");
    assert.match(once.metin, /ajanda_ekle: eklendi/, once.metin);
    assert.match(once.metin, /pc_tur: sentetik \(tasdik_yok\)/);
    assert.equal(ajanda.kayitlar().at(-1)!.taslak, true, "servise ulaşmayan tasdik insan turu sayıldı");
    // Yeni tasdik: ana ajanın çağrısı doğrudan yazılır.
    const sonra = await anaCagrisi(o, istemci, "ajanda_ekle", { ...disci({ tarih: "2026-11-25", saat: "14:31" }), baslik: "Dişçi 2" }, "toolu_k3", "istem-3");
    assert.match(sonra.metin, /ajanda_ekle: eklendi/);
    assert.equal(ajanda.kayitlar().at(-1)!.taslak, false);
  });
});
