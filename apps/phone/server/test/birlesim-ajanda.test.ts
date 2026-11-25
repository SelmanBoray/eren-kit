/**
 * Ajanda birleşim testi (MODULLER.md "Ajanda dalgası" > "ana", `docs/AJANDA.md` "Araç yolu" kabul
 * senaryosu). `servisKur` gerçek modülleri kurar (takvim, ajanda, ajanda borusu, konuşma, gateway, depo);
 * modüller arasında sahte yoktur. Dış dünya sahtedir: telefon ve ajanda uygulaması sahte WebSocket'ten
 * gerçek P-256 imzayla, `claude` sahte süreçten gerçek biçimli satırlarla konuşur. Model tarafı gerçek
 * `kopru.ts`'tir (`ajandaKopruCalistir`, bellek içi MCP + bellek içi boru çifti): araç çağrısı modelin
 * gördüğü MCP yüzünden servisin ajanda borusuna, oradan ajanda modülüne gider. Giden her `/ajanda` ve
 * `/sohbet` çerçevesi kablo şemasından geçer.
 */
import assert from "node:assert/strict";
import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as imzaAt,
  timingSafeEqual,
  verify as imzaDogrula,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ANA_SOHBET_ID,
  AJANDA_BORU_ADI,
  AJANDA_ROL_FIILLERI,
  AJANDA_SURUMU,
  AjandaKaydi,
  ajandaAsagiCoz,
  ajandaKimlikImzaMetni,
  KOPRU_BORU_ADI,
  kimlikImzaMetni,
  kopruAsagiCoz,
  mesajAniDamgasi,
  PROTOKOL_SURUMU,
  ROL_FIILLERI,
  SOHBET_SURUMU,
  sohbetAsagiCoz,
} from "@eren/protocol";
import { servisKur } from "../src/ana.ts";
import type { Servis, ServisGirdisi } from "../src/ana.ts";
import { ayarKur } from "../src/ayar.ts";
import { ajandaEslestirmeBaslat, eslestirmeBaslat } from "../src/eslestir.ts";
import { ajandaKopruCalistir } from "../src/kopru.ts";
import type { AnahtarPortu, Ayar, BoruBaglantisi, BoruSunucuIstegi } from "../src/sozlesme.ts";
import { sahteDunya, sahteGunluk, sahteRastgele } from "./sahte.ts";
import type { SahteBoruBaglantisi, SahteBoruluSurec, SahteDunya, SahteWsBaglantisi } from "./sahte.ts";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------------------------
// Sabitler: kabul senaryosunun saati. 2026-11-25 23:58 Europe/Istanbul (UTC+3) = 20:58 UTC.
// ---------------------------------------------------------------------------------------------

const DILIM = "Europe/Istanbul";
const T0 = Date.UTC(2026, 10, 25, 20, 58, 0);
const DAKIKA = 60_000;
const YEREL = "C:\\ornek\\Yerel";
const KULLANICI = "C:\\ornek\\Kullanici";
const NODE_EXE = "C:\\ornek\\node.exe";
const CLAUDE_EXE = "C:\\ornek\\bin\\claude.exe";
const YEREL_AYAR = "C:\\ornek\\Yerel\\eren-kit\\ayar.local.json";
const TELEFON_IP = "100.64.0.20";
const MODEL = "claude-ornek";
const ANA = { sohbet_id: ANA_SOHBET_ID } as const;
/** Kayıt metni günlüğe girmemeli (`AJANDA.md` A0.2): bu dizge hiçbir günlük satırında görünmez. */
const BASLIK = "Dişçi ☕️";
const KABUL_METNI = "yarın 3'te dişçi ☕️";

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r));
};

// ---------------------------------------------------------------------------------------------
// Gerçek P-256
// ---------------------------------------------------------------------------------------------

const imzala = (anahtar: KeyObject, metin: string): string =>
  imzaAt("sha256", Buffer.from(metin, "utf8"), anahtar).toString("base64");

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

function cihazAnahtari(): { ozel: KeyObject; acik: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { ozel: privateKey, acik: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}

// ---------------------------------------------------------------------------------------------
// WebSocket uçları: giden her çerçeve kablo şemasından geçer
// ---------------------------------------------------------------------------------------------

interface Uc {
  c: SahteWsBaglantisi;
  kareler(): J[];
  tur(t: string): J[];
  gonder(m: J): Promise<void>;
}

function ucSar(c: SahteWsBaglantisi): Uc {
  const coz = c.yol === "/ajanda" ? ajandaAsagiCoz : sohbetAsagiCoz;
  const kareler = (): J[] =>
    c.gonderilenler.map((m) => {
      const r = coz(m);
      assert.ok(r.ok, `giden çerçeve şemaya uymuyor (${c.yol}): ${m.slice(0, 300)}`);
      return r.mesaj as J;
    });
  return {
    c,
    kareler,
    tur: (t) => kareler().filter((k) => k["type"] === t),
    gonder: async (m) => {
      c.mesajGonder(JSON.stringify(m));
      await bosalt();
    },
  };
}

/** Kimlik öncesi ret: yalnız `error` (şemadan bağımsız, `/sohbet` ve `/cihaz` aynı biçim) ve kapanış. */
const hamKareler = (c: SahteWsBaglantisi): J[] => c.gonderilenler.map((m) => JSON.parse(m) as J);

// ---------------------------------------------------------------------------------------------
// Bellek içi boru çifti: sahte `BoruSunucuPortu`'nun isteğine gerçek `kopru.ts` istemcisini bağlar
// ---------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------
// `claude` satırları
// ---------------------------------------------------------------------------------------------

const argDegeri = (s: SahteBoruluSurec, bayrak: string): string => {
  const a = s.istek.argv;
  const i = a.indexOf(bayrak);
  assert.ok(i >= 0, `argv'de ${bayrak} yok`);
  return a[i + 1]!;
};

const oturumKimligi = (s: SahteBoruluSurec): string => {
  const a = s.istek.argv;
  const i = Math.max(a.indexOf("--session-id"), a.indexOf("--resume"));
  return a[i + 1]!;
};

const initSatiri = (s: SahteBoruluSurec): string =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: oturumKimligi(s),
    tools: [
      ...ROL_FIILLERI.eren.map((f) => `mcp__eren__${f}`),
      ...AJANDA_ROL_FIILLERI.ana_oturum.map((f) => `mcp__eren-ajanda__${f}`),
    ],
    mcp_servers: [
      { name: "eren", status: "connected" },
      { name: "eren-ajanda", status: "connected" },
    ],
    apiKeySource: "none",
    model: MODEL,
  });

const sonucSatiri = (s: SahteBoruluSurec, metin: string): string =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    stop_reason: "end_turn",
    result: metin,
    session_id: oturumKimligi(s),
    modelUsage: { [MODEL]: { contextWindow: 1_000_000 } },
    usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 1 },
  });

// ---------------------------------------------------------------------------------------------
// Ortam
// ---------------------------------------------------------------------------------------------

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

interface AjandaUcu extends Uc {
  /** Son `kayit` çerçevelerinin revizyon sırası. */
  kayitlar(): AjandaKaydi[];
}

interface AjandaCihazi {
  device_id: string;
  baglan(hello?: J): Promise<AjandaUcu>;
}

let msgNo = 0;

async function ortamKur(sec: { depoYolu?: string; ajanda?: ServisGirdisi["ajanda"] } = {}) {
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
  const ajandaSecenegi: ServisGirdisi["ajanda"] = sec.ajanda ?? { sistemDilimi: () => DILIM };
  const dunya = { ...d.dunya, anahtar };
  const servisler: Servis[] = [];
  temizlikler.push(async () => {
    for (const s of servisler) await s.kapat();
  });

  const o = {
    d,
    ayar,
    anahtar,
    get servis(): Servis {
      const s = servisler.at(-1);
      assert.ok(s, "servis kurulmadı");
      return s;
    },
    baslat: async (ajanda: ServisGirdisi["ajanda"] = ajandaSecenegi): Promise<Servis> => {
      const s = servisKur({ dunya, ayar, depoYolu, ...(ajanda === undefined ? {} : { ajanda }) });
      servisler.push(s);
      await s.baslat();
      await bosalt();
      return s;
    },
    ilerlet: async (ms: number): Promise<void> => {
      let kalan = ms;
      while (kalan > 0) {
        const a = Math.min(1000, kalan);
        d.zaman.ilerlet(a);
        kalan -= a;
        await bosalt();
      }
    },

    // Ana oturum
    eren: (): SahteBoruluSurec => {
      const nesil = o.servis.sohbetler.nesil(ANA);
      const yol = ayar.erenMcpYolu(nesil);
      const s = d.surec.borulular().filter((x) => argDegeri(x, "--mcp-config") === yol).at(-1);
      assert.ok(s, `nesil ${nesil} için ana oturum süreci yok`);
      return s;
    },
    mcp: (s: SahteBoruluSurec): J => {
      const metin = d.dosya.icerik(argDegeri(s, "--mcp-config"));
      assert.ok(metin !== null, "ana oturum mcp dosyası yok");
      return JSON.parse(metin) as J;
    },
    erenSatiri: async (s: SahteBoruluSurec, satir: string): Promise<void> => {
      s.stdoutSatiriGonder(satir);
      await bosalt();
    },
    /** Ana oturumun stdin'indeki kullanıcı satırları (son `n`). */
    kullaniciSatirlari: (s: SahteBoruluSurec): J[] =>
      s.yazilanlar.map((x) => JSON.parse(x) as J).filter((l) => l["type"] === "user"),

    /**
     * Ana oturumun ajanda köprüsü: mcp dosyasındaki jeton ve argümanlarla gerçek `kopru.ts` ajanda kipi;
     * model tarafı bellek içi MCP istemcisi.
     */
    ajandaKoprusu: async (s: SahteBoruluSurec): Promise<{ istemci: Client; jeton: string }> => {
      const giris = o.mcp(s)["mcpServers"]["eren-ajanda"] as J | undefined;
      assert.ok(giris, "mcp dosyasında eren-ajanda yok");
      assert.deepEqual(giris["args"], [ayar.kopruBetigi, "--rol", "ana_oturum"]);
      const jeton = giris["env"]["EREN_KOPRU_JETON"] as string;
      const [mcpKopru, mcpIstemci] = InMemoryTransport.createLinkedPair();
      const calisan = await ajandaKopruCalistir(
        { rol: "ana_oturum", jeton, boruAdi: AJANDA_BORU_ADI },
        {
          transport: mcpKopru,
          baglan: async (ad) => {
            const istek = d.boru.istek(ad);
            if (istek === null) throw new Error(`boru dinlenmiyor: ${ad}`);
            return boruCifti(istek);
          },
          rastgele: sahteRastgele(777),
          gunluk: sahteGunluk(),
          bekle: async () => {
            await new Promise<void>((r) => setImmediate(r));
          },
        },
      );
      const istemci = new Client({ name: "sahte-model", version: "0.0.0" }, { capabilities: {} });
      await istemci.connect(mcpIstemci);
      temizlikler.push(async () => {
        await istemci.close().catch(() => {});
        await calisan.kapat();
      });
      return { istemci, jeton };
    },
    /** Modelin araç çağrısı: MCP `tools/call`; modele giden tek metin içeriği döner. */
    arac: async (istemci: Client, fiil: string, girdi: J): Promise<string> => {
      const r = await istemci.callTool({ name: fiil, arguments: girdi });
      await bosalt();
      const icerik = r.content as Array<{ type: string; text: string }>;
      assert.equal(icerik.length, 1, `tek metin içeriği değil: ${JSON.stringify(r)}`);
      assert.equal(r.structuredContent, undefined, "structuredContent modele gitmemeli");
      return icerik[0]!.text;
    },

    // Telefon (sohbet kapsamı)
    sohbetCihazi: async (): Promise<{ device_id: string; baglan(yol: "/sohbet" | "/cihaz"): Promise<Uc> }> => {
      const { ozel, acik } = cihazAnahtari();
      const b = eslestirmeBaslat({ depo: o.servis.depo, anahtar, sistem: d.sistem, rastgele: d.rastgele, saat: d.saat, wsPort: ayar.wsPort });
      assert.ok(b.ok);
      const e = ucSar(d.ws.baglan("/sohbet", TELEFON_IP));
      await e.gonder({ v: PROTOKOL_SURUMU, type: "pair_request", kod: b.deger.kod, public_key: acik, platform: "android", etiket: "sohbet" });
      const pr = e.tur("pair_result")[0];
      assert.ok(pr?.["ok"], JSON.stringify(pr));
      e.c.istemciKopar();
      const device_id = pr["device_id"] as string;
      return {
        device_id,
        baglan: async (yol) => {
          const kanal = yol === "/sohbet" ? "sohbet" : "cihaz";
          const v = yol === "/sohbet" ? SOHBET_SURUMU : PROTOKOL_SURUMU;
          const u = ucSar(d.ws.baglan(yol, TELEFON_IP));
          const client_nonce = randomBytes(32).toString("base64");
          await u.gonder({ v, type: "hello", device_id, client_nonce, ...(yol === "/sohbet" ? { last_seq: 0 } : {}) });
          const ch = u.tur("auth_challenge")[0];
          assert.ok(ch, `auth_challenge yok (${yol})`);
          const ortak = { kanal, device_id, client_nonce, server_nonce: ch["server_nonce"] as string } as const;
          await u.gonder({ v, type: "auth_response", signature: imzala(ozel, kimlikImzaMetni({ rol: "telefon", ...ortak })) });
          assert.equal(u.tur("welcome").length, 1, `welcome yok (${yol})`);
          return u;
        },
      };
    },
    kullaniciMesaji: async (u: Uc, text: string): Promise<J> => {
      const client_msg_id = `msg_${++msgNo}`;
      await u.gonder({ v: SOHBET_SURUMU, type: "user_message", sohbet_id: ANA_SOHBET_ID, input: "yazi", text, client_msg_id });
      const ack = u.tur("ack").find((k) => k["client_msg_id"] === client_msg_id);
      assert.ok(ack, "ack gelmedi");
      return ack;
    },

    // Ajanda uygulaması (ajanda kapsamı)
    ajandaCihazi: async (): Promise<AjandaCihazi & { ozel: KeyObject }> => {
      const { ozel, acik } = cihazAnahtari();
      const b = ajandaEslestirmeBaslat({ depo: o.servis.depo, anahtar, sistem: d.sistem, rastgele: d.rastgele, saat: d.saat, wsPort: ayar.wsPort });
      assert.ok(b.ok);
      assert.equal(b.deger.qr.kanal, "ajanda");
      const e = ucSar(d.ws.baglan("/ajanda", TELEFON_IP));
      await e.gonder({ v: AJANDA_SURUMU, type: "pair_request", kod: b.deger.kod, public_key: acik, platform: "android", etiket: "ajanda" });
      const pr = e.tur("pair_result")[0];
      assert.ok(pr?.["ok"], JSON.stringify(e.kareler()));
      assert.equal(pr["kapsam"], "ajanda");
      e.c.istemciKopar();
      const device_id = pr["device_id"] as string;
      return {
        device_id,
        ozel,
        baglan: async (hello: J = { son_rev: 0 }) => {
          const u = ucSar(d.ws.baglan("/ajanda", TELEFON_IP));
          const client_nonce = randomBytes(32).toString("base64");
          await u.gonder({ v: AJANDA_SURUMU, type: "hello", device_id, client_nonce, ...hello });
          const ch = u.tur("auth_challenge")[0];
          assert.ok(ch, `/ajanda auth_challenge yok: ${JSON.stringify(u.kareler())}`);
          const ortak = { device_id, client_nonce, server_nonce: ch["server_nonce"] as string };
          assert.ok(
            imzaTutarMi(anahtar.acikAnahtar(), ajandaKimlikImzaMetni({ rol: "pc", ...ortak }), ch["server_signature"] as string),
            "PC'nin /ajanda imzası doğrulanamadı",
          );
          await u.gonder({ v: AJANDA_SURUMU, type: "auth_response", signature: imzala(ozel, ajandaKimlikImzaMetni({ rol: "telefon", ...ortak })) });
          assert.equal(u.tur("welcome").length, 1, `/ajanda welcome yok: ${JSON.stringify(u.kareler())}`);
          return { ...u, kayitlar: () => u.tur("kayit").map((k) => AjandaKaydi.parse(k["kayit"])) };
        },
      };
    },
    islem: async (u: Uc, islem_id: string, islem: J): Promise<J> => {
      await u.gonder({ v: AJANDA_SURUMU, type: "islem", islem_id, islem });
      const s = u.tur("islem_sonucu").filter((k) => k["islem_id"] === islem_id).at(-1);
      assert.ok(s, `islem_sonucu yok: ${islem_id}`);
      return s;
    },
  };
  return o;
}

type Ortam = Awaited<ReturnType<typeof ortamKur>>;

/** Servis ayakta, ana oturum hazır (ilk tur yok), telefonun sohbeti ve ajanda uygulaması bağlı, köprü bağlı. */
async function hazirla(o: Ortam) {
  await o.baslat();
  const eren = o.eren();
  await o.erenSatiri(eren, initSatiri(eren));
  const tel = await o.sohbetCihazi();
  const sohbet = await tel.baglan("/sohbet");
  const ajCihaz = await o.ajandaCihazi();
  const ajanda = await ajCihaz.baglan();
  const { istemci, jeton } = await o.ajandaKoprusu(eren);
  return { eren, tel, sohbet, ajCihaz, ajanda, istemci, jeton };
}

const yarinUcte = (dayanak: J): J => ({
  tur: "randevu",
  baslik: BASLIK,
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", ifade: "yarın 3'te" },
  alinti: "dişçi",
  dayanak,
});

// ---------------------------------------------------------------------------------------------
// Senaryolar
// ---------------------------------------------------------------------------------------------

describe("birleşim: ajanda (kabul senaryosu)", () => {
  it("insan mesajı -> mesaj anı damgası -> ajanda_ekle (gerçek köprü, boru, ajanda) -> kayıt -> /ajanda kayit; geç çağrıda yanlış dayanak reddedilir", async () => {
    const o = await ortamKur();
    const { eren, sohbet, ajanda, istemci } = await hazirla(o);

    // Bağlanınca ilk telafi: boş depo, tam, esitlendi{0}.
    const w = ajanda.tur("welcome")[0]!;
    assert.equal(w["tam"], true);
    assert.equal(w["bas_rev"], 0);
    assert.deepEqual(ajanda.tur("esitlendi").map((k) => k["rev"]), [0]);
    // Ana oturumun mcp dosyasında iki köprü, ajanda araçları modele görünür.
    assert.deepEqual(Object.keys(o.mcp(eren)["mcpServers"]).slice(0, 2), ["eren", "eren-ajanda"]);
    const { tools } = await istemci.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...AJANDA_ROL_FIILLERI.ana_oturum].sort());
    assert.ok(tools.every((t) => t.outputSchema === undefined), "outputSchema yayınlanmamalı");

    // 23:58'de yazılan mesaj: damga varış anıdır, telefon ve saklanan metin damgasızdır.
    const ack = await o.kullaniciMesaji(sohbet, KABUL_METNI);
    assert.equal(ack["ok"], true, JSON.stringify(ack));
    const satir = o.kullaniciSatirlari(eren).at(-1)!;
    assert.deepEqual(satir["origin"], { kind: "human" });
    const damga = mesajAniDamgasi({ tarih: "2026-11-25", saat: "23:58", saat_dilimi: DILIM });
    assert.equal(satir["message"]["content"], `${damga}\n${KABUL_METNI}`);
    const echo = sohbet.tur("event").map((k) => k["event"] as J).filter((e) => e["type"] === "user_echo").at(-1)!;
    assert.equal(echo["text"], KABUL_METNI, "telefona giden metne damga girdi");

    // Model aracı geç çağırır (00:01). Şimdiye göre çözülmüş dayanak reddedilir, hiçbir şey yazılmaz.
    await o.ilerlet(3 * DAKIKA);
    const ret = await o.arac(istemci, "ajanda_ekle", yarinUcte({ tarih: "2026-11-26", saat: "00:01" }));
    assert.match(ret, /neden=dayanak_uyusmuyor/);
    assert.match(ret, /mesaj_ani=2026-11-25 \S+ 23:58 Europe\/Istanbul/);
    assert.equal(ajanda.kayitlar().length, 0, "reddedilen çağrı kayıt yayınladı");

    // Mesaj anına göre çözülen çağrı: kayıt doğar, /ajanda'ya `kayit` gider.
    const tamam = await o.arac(istemci, "ajanda_ekle", yarinUcte({ tarih: "2026-11-25", saat: "23:58" }));
    assert.match(tamam, /^ajanda_ekle: eklendi \(kayit \S+\) durum=acik zaman=2026-11-26 15:00 Europe\/Istanbul hatirlatma=1 kurulacak=1\./);
    assert.ok(!tamam.includes(BASLIK) && !tamam.includes("yarın 3'te"), "araç çıktısı kayıt metni taşıdı");
    const kayitlar = ajanda.kayitlar();
    assert.equal(kayitlar.length, 1);
    const k = kayitlar[0]!;
    assert.equal(k.baslik, BASLIK);
    assert.equal(k.taslak, false);
    assert.deepEqual(k.zaman, { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM, ifade: "yarın 3'te" });
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 60 }]);
    assert.equal(k.kaynak.yol, "sohbet_araci");
    assert.equal(k.kaynak.tur_kokeni, "insan");
    assert.equal(k.kaynak.sohbet_id, ANA_SOHBET_ID);
    assert.equal(k.kaynak.kaynak_msg_id, ack["client_msg_id"]);
    assert.equal(k.kaynak.alinti, "dişçi");
    assert.equal(k.olusturma_ms, T0 + 3 * DAKIKA);
    assert.deepEqual(o.servis.ajanda!.telafiSayfasi({ sonRev: 0, ustRev: k.revizyon, adet: 10 }), [k]);

    // Tur bitince araç turu bulamaz: kayıt yazılmaz.
    await o.erenSatiri(eren, sonucSatiri(eren, "Yarın 15:00 dişçi kaydedildi."));
    const tursuz = await o.arac(istemci, "ajanda_ekle", { tur: "not", baslik: "tursuz" });
    assert.match(tursuz, /açık bir konuşma turuna bağlanamadı/);
    assert.equal(ajanda.kayitlar().length, 1);

    // Kayıt metni hiçbir günlük satırında yok (A0.2).
    const gunluk = o.d.kayit.satirlar.join("\n");
    for (const yasak of [BASLIK, "Dişçi", "yarın 3'te", "tursuz"]) assert.ok(!gunluk.includes(yasak), `günlükte: ${yasak}`);
  });

  it("uygulamadan elle ekleme, tamamlama ve geri alma işlenir, sonuç döner, kayıt yayınlanır; aynı islem_id ikinci kez uygulanmaz", async () => {
    const o = await ortamKur();
    const { ajanda } = await hazirla(o);

    const ekle = await o.islem(ajanda, "i1", { islem: "ekle", kayit_id: "k_elle_1", tur: "gorev", baslik: "Süt al", hatirlatmalar: [], girdi_yolu: "elle" });
    assert.equal(ekle["ok"], true, JSON.stringify(ekle));
    assert.equal(ekle["kayit_id"], "k_elle_1");
    const r1 = ekle["rev"] as number;
    const tamam = await o.islem(ajanda, "i2", { islem: "durum", kayit_id: "k_elle_1", durum: "tamam" });
    assert.equal(tamam["ok"], true);
    const geri = await o.islem(ajanda, "i3", { islem: "durum", kayit_id: "k_elle_1", durum: "acik" });
    assert.equal(geri["ok"], true);
    assert.ok(r1 < (tamam["rev"] as number) && (tamam["rev"] as number) < (geri["rev"] as number), "revizyon tek sayaçtan artmadı");

    const kayitlar = ajanda.kayitlar();
    assert.deepEqual(kayitlar.map((k) => [k.revizyon, k.durum]), [[r1, "acik"], [tamam["rev"], "tamam"], [geri["rev"], "acik"]]);
    assert.equal(kayitlar[0]!.kaynak.yol, "elle");
    assert.equal(kayitlar[0]!.kaynak.tur_kokeni, "insan");
    assert.equal(kayitlar[0]!.taslak, false);

    // Tekrarsızlık: aynı islem_id aynı sonucu alır, yeni revizyon ve yayın yok.
    const once = ajanda.kayitlar().length;
    const tekrar = await o.islem(ajanda, "i2", { islem: "durum", kayit_id: "k_elle_1", durum: "tamam" });
    assert.deepEqual(tekrar, tamam);
    assert.equal(ajanda.kayitlar().length, once);
    assert.equal(o.servis.depo.ajandaKaydiGetir("k_elle_1")?.durum, "acik");

    // Gövdesi geçersiz işlem bağlantıyı kapatmaz, kalıcı `gecersiz_islem` alır.
    const gecersiz = await o.islem(ajanda, "i4", { islem: "durum", kayit_id: "k_elle_1", durum: "yok_boyle" });
    assert.deepEqual([gecersiz["ok"], gecersiz["code"]], [false, "gecersiz_islem"]);
    assert.equal(ajanda.c.kapanis, null);
  });

  it("sentetik turda (servis notu) eklenen kayıt taslak doğar; araç taslağı onaylayamaz", async () => {
    const o = await ortamKur();
    const { eren, sohbet, ajanda, istemci } = await hazirla(o);
    const erenKopru = o.d.boru.baglan(KOPRU_BORU_ADI);
    const kopruKareleri = (b: SahteBoruBaglantisi): J[] => b.yazilanlar.map((m) => {
      const r = kopruAsagiCoz(m);
      assert.ok(r.ok);
      return r.mesaj as J;
    });
    erenKopru.satirGonder(JSON.stringify({ v: 1, type: "kopru_hello", rol: "eren", jeton: o.mcp(eren)["mcpServers"]["eren"]["env"]["EREN_KOPRU_JETON"] }));
    await bosalt();
    assert.equal(kopruKareleri(erenKopru)[0]?.["type"], "kopru_welcome");

    // Telefon planı karta düşer, kullanıcı reddeder: servis ana oturuma sentetik not yollar (yeni tur).
    erenKopru.satirGonder(JSON.stringify({
      v: 1,
      type: "istek",
      istek_id: "p1",
      fiil: "plan_oner",
      girdi: { baslik: "Telefon isi", tur: "telefon", cwd: "", gorev_metni: "Mesajlara bak", telefon_izin_istegi: { uygulamalar: ["com.ornek.mesaj"], mod: "oku" } },
    }));
    await bosalt();
    const plan = kopruKareleri(erenKopru).find((k) => k["istek_id"] === "p1");
    assert.equal(plan?.["ok"], true, JSON.stringify(plan));
    const { plan_id, plan_hash } = plan!["sonuc"] as J;
    await o.ilerlet(2 * DAKIKA);
    await sohbet.gonder({ v: SOHBET_SURUMU, type: "plan_decision", plan_id, plan_hash, karar: "ret", client_msg_id: "karar1" });
    const sentetik = o.kullaniciSatirlari(eren).at(-1)!;
    assert.equal(sentetik["isSynthetic"], true, JSON.stringify(sentetik));
    const an = mesajAniDamgasi({ tarih: "2026-11-26", saat: "00:00", saat_dilimi: DILIM });
    assert.ok((sentetik["message"]["content"] as string).startsWith(`${an}\n`), "sentetik satırın damgası varış anı değil");

    // Sentetik turda ekleme: taslak, kaynakta sentetik köken, hatırlatma kurulmaz uyarısı modele.
    const metin = await o.arac(istemci, "ajanda_ekle", {
      tur: "gorev",
      baslik: "Plan reddedildi notu",
      zaman: { kesinlik: "gun", tarih: "2026-11-27" },
      dayanak: { tarih: "2026-11-26", saat: "00:00" },
    });
    assert.match(metin, /^ajanda_ekle: eklendi \(kayit \S+\) durum=acik taslak /);
    assert.match(metin, /kaydedildi deme/);
    const k = ajanda.kayitlar().at(-1)!;
    assert.equal(k.taslak, true);
    assert.equal(k.kaynak.tur_kokeni, "sentetik");
    assert.equal(k.kaynak.kaynak_msg_id, undefined);
    const onay = await o.arac(istemci, "ajanda_guncelle", { kayit_id: k.kayit_id, degisiklik: { onayla: true } });
    assert.match(onay, /neden=sentetik_turda_izinsiz/);
    assert.equal(o.servis.depo.ajandaKaydiGetir(k.kayit_id)?.taslak, true);
  });

  it("kopup yeniden bağlanınca kısmi telafi: yalnız kaçırılan revizyonlar, sonra esitlendi ve canlı", async () => {
    const o = await ortamKur();
    const { eren, sohbet, ajCihaz, ajanda, istemci } = await hazirla(o);
    await o.kullaniciMesaji(sohbet, KABUL_METNI);
    await o.arac(istemci, "ajanda_ekle", yarinUcte({ tarih: "2026-11-25", saat: "23:58" }));
    const gorulen = ajanda.kayitlar().at(-1)!;
    const depo_id = ajanda.tur("welcome")[0]!["depo_id"] as string;
    await o.erenSatiri(eren, sonucSatiri(eren, "tamam"));

    ajanda.c.istemciKopar();
    await bosalt();
    await o.kullaniciMesaji(sohbet, "cuma akşam kitap kulübü");
    await o.arac(istemci, "ajanda_ekle", { tur: "randevu", baslik: "Kitap kulübü", zaman: { kesinlik: "gun", tarih: "2026-11-27" }, dayanak: { tarih: "2026-11-25", saat: "23:58" } });
    await o.erenSatiri(eren, sonucSatiri(eren, "tamam"));
    const kacan = o.servis.depo.ajandaKayitlari({}).find((x) => x.baslik === "Kitap kulübü")!;
    assert.ok(kacan.revizyon > gorulen.revizyon);

    const yeni = await ajCihaz.baglan({
      son_rev: gorulen.revizyon,
      depo_id,
      son_rev_izi: { kayit_id: gorulen.kayit_id, guncelleme_ms: gorulen.guncelleme_ms },
    });
    const w = yeni.tur("welcome")[0]!;
    assert.deepEqual([w["tam"], w["bas_rev"], w["depo_id"]], [false, kacan.revizyon, depo_id]);
    assert.deepEqual(yeni.kayitlar().map((x) => x.kayit_id), [kacan.kayit_id]);
    assert.deepEqual(yeni.kareler().map((x) => x["type"]), ["auth_challenge", "welcome", "kayit", "esitlendi"]);

    // Uyuşmayan iz (aynı depo kimliği, revizyon yeniden kullanılmış): tam telafi.
    const tam = await ajCihaz.baglan({ son_rev: gorulen.revizyon, depo_id, son_rev_izi: { kayit_id: gorulen.kayit_id, guncelleme_ms: 1 } });
    assert.equal(tam.tur("welcome")[0]!["tam"], true);
    assert.equal(tam.kayitlar().length, 2);
  });

  it("ajanda cihazı /sohbet ve /cihaz açamaz (sınamadan önce kanal_desteklenmiyor); sohbet cihazı /ajanda açamaz", async () => {
    const o = await ortamKur();
    const { tel, ajCihaz } = await hazirla(o);
    for (const yol of ["/sohbet", "/cihaz"] as const) {
      const c = o.d.ws.baglan(yol, TELEFON_IP);
      const v = yol === "/sohbet" ? SOHBET_SURUMU : PROTOKOL_SURUMU;
      c.mesajGonder(JSON.stringify({ v, type: "hello", device_id: ajCihaz.device_id, client_nonce: randomBytes(32).toString("base64"), ...(yol === "/sohbet" ? { last_seq: 0 } : {}) }));
      await bosalt();
      const kareler = hamKareler(c);
      assert.deepEqual(kareler.map((k) => [k["type"], k["code"]]), [["error", "kanal_desteklenmiyor"]], `${yol}: ${JSON.stringify(kareler)}`);
      assert.notEqual(c.kapanis, null, `${yol} kapanmadı`);
    }
    // İnsan mesajı da gönderemez: kimlik yoksa iş mesajı işlenmez.
    const c = o.d.ws.baglan("/sohbet", TELEFON_IP);
    c.mesajGonder(JSON.stringify({ v: SOHBET_SURUMU, type: "user_message", sohbet_id: ANA_SOHBET_ID, input: "yazi", text: "x", client_msg_id: "m" }));
    await bosalt();
    assert.equal(hamKareler(c).some((k) => k["type"] === "ack"), false);

    const s = o.d.ws.baglan("/ajanda", TELEFON_IP);
    s.mesajGonder(JSON.stringify({ v: AJANDA_SURUMU, type: "hello", device_id: tel.device_id, son_rev: 0, client_nonce: randomBytes(32).toString("base64") }));
    await bosalt();
    assert.deepEqual(hamKareler(s).map((k) => [k["type"], k["code"]]), [["error", "kanal_desteklenmiyor"]]);
  });

  it("servis yeniden kurulunca (aynı veritabanı) kayıtlar, revizyon ve depo kimliği korunur; önceki ömrün ajanda jetonu geçersiz", async () => {
    const dizin = mkdtempSync(join(tmpdir(), "eren-birlesim-ajanda-"));
    temizlikler.unshift(() => rmSync(dizin, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const o = await ortamKur({ depoYolu: join(dizin, "eren.db") });
    const { eren, sohbet, ajCihaz, ajanda, istemci, jeton } = await hazirla(o);
    await o.kullaniciMesaji(sohbet, KABUL_METNI);
    await o.arac(istemci, "ajanda_ekle", yarinUcte({ tarih: "2026-11-25", saat: "23:58" }));
    await o.islem(ajanda, "i1", { islem: "ekle", kayit_id: "k_elle_1", tur: "not", baslik: "Not", hatirlatmalar: [], girdi_yolu: "elle" });
    await o.erenSatiri(eren, sonucSatiri(eren, "tamam"));
    const son = ajanda.kayitlar().at(-1)!;
    const depo_id = ajanda.tur("welcome")[0]!["depo_id"] as string;
    // Konuşmanın kendi iptal noktalarına uğramayan bir kapsamın jetonu (ör. sonra silinen sohbetin nesli):
    // yalnız açılıştaki `jetonlariniSil` temizler.
    const sahipsiz = o.servis.ajandaKopru!.jetonUret({ rol: "ana_oturum", sohbet_id: "sohbet_eski", nesil: 99 });

    await o.servis.kapat();
    assert.notEqual(ajanda.c.kapanis, null, "kapanışta /ajanda bağlantısı kapanmadı");
    assert.equal(o.d.boru.kapatildiMi(AJANDA_BORU_ADI), true, "kapanışta ajanda borusu kapanmadı");

    await o.baslat();
    // Önceki ömrün jetonları ajanda borusunda geçmez.
    for (const j of [jeton, sahipsiz]) {
      const eski = o.d.boru.baglan(AJANDA_BORU_ADI);
      eski.satirGonder(JSON.stringify({ v: 1, type: "kopru_hello", rol: "ana_oturum", jeton: j }));
      await bosalt();
      assert.equal((JSON.parse(eski.yazilanlar[0]!) as J)["type"], "kopru_ret");
    }

    const yeni = await ajCihaz.baglan({ son_rev: son.revizyon, depo_id, son_rev_izi: { kayit_id: son.kayit_id, guncelleme_ms: son.guncelleme_ms } });
    const w = yeni.tur("welcome")[0]!;
    assert.deepEqual([w["tam"], w["bas_rev"], w["depo_id"]], [false, son.revizyon, depo_id]);
    assert.equal(yeni.kayitlar().length, 0);
    assert.equal(o.servis.depo.ajandaKayitlari({}).length, 2);
    // Revizyon sayacı sürer: yeni işlem öncekinden büyük revizyon alır.
    const r = await o.islem(yeni, "i2", { islem: "durum", kayit_id: "k_elle_1", durum: "tamam" });
    assert.ok((r["rev"] as number) > son.revizyon);
    // Yeni ömrün ana oturumu yeni ajanda jetonuyla bağlanır.
    const { istemci: yeniIstemci } = await o.ajandaKoprusu(o.eren());
    assert.equal((await yeniIstemci.listTools()).tools.length, AJANDA_ROL_FIILLERI.ana_oturum.length);
  });
});

describe("birleşim: ajanda kapalıyken (ajanda: false) servis ajanda öncesi gibi", () => {
  it("/ajanda dinlenmez, ajanda borusu açılmaz, mcp dosyasında yalnız eren, kullanıcı satırı damgasız", async () => {
    const o = await ortamKur({ ajanda: false });
    await o.baslat();
    const s = o.servis;
    assert.deepEqual([s.takvim, s.ajanda, s.ajandaKopru], [null, null, null]);
    assert.deepEqual(Object.keys(o.d.ws.istek()!.azamiCerceve).sort(), ["/cihaz", "/sohbet"]);
    assert.equal(o.d.boru.istek(AJANDA_BORU_ADI), null);
    assert.notEqual(o.d.boru.istek(KOPRU_BORU_ADI), null);

    const eren = o.eren();
    assert.deepEqual(Object.keys(o.mcp(eren)["mcpServers"]), ["eren"]);
    await o.erenSatiri(eren, initSatiri(eren));
    const tel = await o.sohbetCihazi();
    const sohbet = await tel.baglan("/sohbet");
    await o.kullaniciMesaji(sohbet, "merhaba");
    assert.equal(o.kullaniciSatirlari(eren).at(-1)!["message"]["content"], "merhaba");

    // Yol dinlenmese de gelen bağlantı işlenmez, kapanır.
    const a = o.d.ws.baglan("/ajanda", TELEFON_IP);
    assert.deepEqual(a.kapanis, { kod: 1008, neden: "kanal_desteklenmiyor" });
  });

  it("seçenek verilmezse ajanda açıktır ve dilim sistemden okunur", async () => {
    const o = await ortamKur({ ajanda: undefined });
    const s = servisKur({ dunya: { ...o.d.dunya, anahtar: o.anahtar }, ayar: o.ayar, depoYolu: ":memory:" });
    try {
      assert.ok(s.ajanda !== null && s.ajandaKopru !== null);
      assert.equal(s.takvim!.kullaniciDilimi(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    } finally {
      s.depo.kapat();
    }
  });
});
