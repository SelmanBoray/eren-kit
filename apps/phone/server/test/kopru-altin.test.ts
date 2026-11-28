/**
 * H5.0 altın kaydı: köprünün MCP'ye sunduğu araç tanımları (`HARNESS-H5-PLAN.md` "H5.0"). Yalnız test.
 *
 * Kayıt `test/altin/kopru-araclar.json`. Her köprü rolü ve kipi için gerçek köprü (`kopruCalistir`,
 * `ajandaKopruCalistir`) bellek içi MCP taşımasıyla açılır; model yerine elle JSON-RPC konuşulur
 * (`initialize`, `notifications/initialized`, `tools/list`) ve sunucunun yanıtı olduğu gibi (anahtar sırası,
 * `description`, `inputSchema`, varsa ek alanlar) kayda geçer. Canlı boru, veri kökü ve servis yoktur: boru
 * sahte (yalnız el sıkışmayı yanıtlar) ya da hiç açılmaz.
 *
 * Senaryolar (`senaryoAdlari`): `KopruRolu`'nun her rolü (araç listesi bağlantıdan bağımsız), ajanda rollerinin
 * her biri v2 (servis `arac_v3` vermez), v3 (verir) ve `servis_yok` (boru açılmaz: v2 ama `listChanged`) ile; PC
 * rolü ayrıca her köprü uyarlayıcısıyla (`PC_KOPRU_UYARLAYICILARI`). Liste kaynaktaki sıralamalardan üretilir:
 * yeni rol ya da uyarlayıcı kayıtta yoksa test kırmızıdır ve yeniden üretme komutunu söyler.
 *
 * Kayıt yalnız `EREN_ALTIN_YAZ=1` ile yeniden yazılır (`KOPRU_YENIDEN_URET`). H5.3 bu kaydı değiştirmemelidir.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  AJANDA_BORU_ADI,
  AJANDA_ROL_FIILLERI,
  AjandaKopruRolu,
  ajandaPcRoluMu,
  EREN_ARACLARI,
  IS_PROFILI_ACIKLAMASI,
  KopruRolu,
  SORU_ARACLARI,
  TELEFON_ARACLARI,
} from "@eren/protocol";
import { ajandaKopruCalistir, kopruCalistir, PC_KOPRU_UYARLAYICILARI } from "../src/kopru.ts";
import type { KopruBagimliliklari, KopruCalisani, PcKopruUyarlayiciAdi } from "../src/kopru.ts";
import type { BoruBaglantisi } from "../src/sozlesme.ts";
import { kayitDenetle, kayitOku, normallestir } from "./altin-kayit.ts";
import type { KayitDosyasi } from "./altin-kayit.ts";
import { sahteGunluk, sahteRastgele } from "./sahte.ts";

const TEST_KOMUTU = "test/kopru-altin.test.ts";
const KOPRU_YENIDEN_URET =
  `apps/phone/server içinde: PowerShell \`$env:EREN_ALTIN_YAZ='1'; node --disable-warning=ExperimentalWarning --test ${TEST_KOMUTU}; Remove-Item Env:EREN_ALTIN_YAZ\`` +
  ` (bash: \`EREN_ALTIN_YAZ=1 node --disable-warning=ExperimentalWarning --test ${TEST_KOMUTU}\`)`;
const DOSYA: KayitDosyasi = { kayit: "kopru-araclar", yenidenUret: KOPRU_YENIDEN_URET };

const JETON = "j".repeat(43);
/** Model tarafının ilan ettiği sürüm; sunucu destekliyorsa aynısını döner (kayda girmez). */
const MCP_SURUMU = "2025-06-18";

/**
 * Köprü başlatmayan ajanda rolleri. `pc_kanca` kanca sürecinin rolüdür (`kanca.ts`); `giris` köprüyü bu rolle
 * açmaz, rolün aracı da yoktur (aşağıdaki test bunu denetler).
 */
const KOPRUSUZ_AJANDA_ROLLERI: Readonly<Partial<Record<AjandaKopruRolu, string>>> = {
  pc_kanca: "kanca rolü; kopru giris'i reddeder, araç yok",
};

/** Ajanda araç yüzleri ve servis durumu. */
const AJANDA_DURUMLARI = ["v2", "v3", "servis_yok"] as const;
type AjandaDurumu = (typeof AJANDA_DURUMLARI)[number];

/** `kopruCalistir` rollerinin araç tablosu (köprünün `ROL_ARACLARI`'nın karşılığı; yeni rol tsc'de kırılır). */
const KOPRU_ROL_TABLOLARI: Readonly<Record<KopruRolu, Readonly<Record<string, unknown>>>> = {
  eren: EREN_ARACLARI,
  soru: SORU_ARACLARI,
  telefon: TELEFON_ARACLARI,
};

type Senaryo =
  | { tur: "kopru"; rol: KopruRolu }
  | { tur: "ajanda"; rol: AjandaKopruRolu; durum: AjandaDurumu; uyarlayici?: PcKopruUyarlayiciAdi };

const ajandaRolleri = (): AjandaKopruRolu[] =>
  AjandaKopruRolu.options.filter((r) => !Object.hasOwn(KOPRUSUZ_AJANDA_ROLLERI, r));
const uyarlayicilar = (): PcKopruUyarlayiciAdi[] => Object.keys(PC_KOPRU_UYARLAYICILARI) as PcKopruUyarlayiciAdi[];

/** Kaynağın sıralamalarından senaryo listesi (ad → senaryo). Kayıt bu sırayla yazılır. */
function senaryolar(): Map<string, Senaryo> {
  const m = new Map<string, Senaryo>();
  for (const rol of KopruRolu.options) m.set(rol, { tur: "kopru", rol });
  for (const rol of ajandaRolleri()) {
    if (ajandaPcRoluMu(rol)) {
      for (const u of uyarlayicilar()) {
        for (const durum of AJANDA_DURUMLARI) m.set(`${rol}/${u}/${durum}`, { tur: "ajanda", rol, durum, uyarlayici: u });
      }
    } else {
      for (const durum of AJANDA_DURUMLARI) m.set(`${rol}/${durum}`, { tur: "ajanda", rol, durum });
    }
  }
  return m;
}

// --- Sahte boru: yalnız el sıkışma ------------------------------------------------------------------

/** Ajanda borusu: her hello'ya `kopru_welcome`; `aracV3` ise hello'da isteyene `arac_v3:true`. İstek yanıtsız. */
function sahteAjandaBorusu(aracV3: boolean): (ad: string) => Promise<BoruBaglantisi> {
  return async (ad) => {
    assert.equal(ad, AJANDA_BORU_ADI);
    const satirlar: Array<(s: string) => void> = [];
    const kapanislar: Array<() => void> = [];
    let kapali = false;
    const kapat = (): void => {
      if (kapali) return;
      kapali = true;
      for (const f of kapanislar) f();
    };
    return {
      satirYaz: (s) => {
        if (kapali) return;
        const m = JSON.parse(s) as Record<string, unknown>;
        if (m["type"] !== "kopru_hello") return;
        const yanit = { v: 1, type: "kopru_welcome", rol: m["rol"], ...(aracV3 && m["arac_v3"] === true ? { arac_v3: true } : {}) };
        queueMicrotask(() => {
          if (!kapali) for (const f of satirlar) f(JSON.stringify(yanit));
        });
      },
      kapat,
      satirDinle: (f) => void satirlar.push(f),
      kapanisDinle: (f) => void kapanislar.push(f),
    };
  };
}

const boruYok = async (): Promise<BoruBaglantisi> => {
  throw new Error("boru yok");
};

// --- Elle MCP istemcisi -------------------------------------------------------------------------

interface Yuz {
  sunucu: unknown;
  yetenekler: unknown;
  /** Varsa `initialize` sonucundaki öbür alanlar (`instructions`...); `protocolVersion` kayda girmez. */
  initialize_ek: Record<string, unknown>;
  tools_list: unknown;
}

async function yuzAl(ac: (b: KopruBagimliliklari) => Promise<KopruCalisani>, baglan: KopruBagimliliklari["baglan"]): Promise<Yuz> {
  const [mcpKopru, mcpIstemci] = InMemoryTransport.createLinkedPair();
  const calisan = await ac({
    transport: mcpKopru,
    baglan,
    rastgele: sahteRastgele(),
    gunluk: sahteGunluk(),
    // Gerçek bekleme yok, olay döngüsüne nefes aldırır (boru yokken sonsuz mikro görev olmasın).
    bekle: async () => {
      await new Promise<void>((r) => setImmediate(r));
    },
  });
  const bekleyen = new Map<number, (m: Record<string, unknown>) => void>();
  mcpIstemci.onmessage = (m: JSONRPCMessage) => {
    const r = m as Record<string, unknown>;
    if (typeof r["id"] === "number") bekleyen.get(r["id"])?.(r);
  };
  await mcpIstemci.start();
  const iste = (id: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> =>
    new Promise((coz, red) => {
      const t = setTimeout(() => red(new Error(`${method} yanıtsız`)), 5_000);
      bekleyen.set(id, (m) => {
        clearTimeout(t);
        coz(m);
      });
      void mcpIstemci.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
    });
  try {
    const init = await iste(1, "initialize", {
      protocolVersion: MCP_SURUMU,
      capabilities: {},
      clientInfo: { name: "sahte-model", version: "0.0.0" },
    });
    assert.ok(init["result"] !== undefined, `initialize hata: ${JSON.stringify(init["error"])}`);
    await mcpIstemci.send({ jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage);
    const liste = await iste(2, "tools/list", {});
    assert.ok(liste["result"] !== undefined, `tools/list hata: ${JSON.stringify(liste["error"])}`);
    const { protocolVersion: _surum, serverInfo, capabilities, ...ek } = init["result"] as Record<string, unknown>;
    return { sunucu: serverInfo, yetenekler: capabilities, initialize_ek: ek, tools_list: liste["result"] };
  } finally {
    await mcpIstemci.close().catch(() => {});
    await calisan.kapat();
  }
}

function senaryoCalistir(s: Senaryo): Promise<Yuz> {
  if (s.tur === "kopru") {
    return yuzAl((b) => kopruCalistir({ rol: s.rol, jeton: JETON, boruAdi: "eren-kopru-sahte" }, b), boruYok);
  }
  const baglan = s.durum === "servis_yok" ? boruYok : sahteAjandaBorusu(s.durum === "v3");
  const pc = ajandaPcRoluMu(s.rol);
  return yuzAl(
    (b) =>
      ajandaKopruCalistir(
        pc
          ? { rol: s.rol, jeton: "", boruAdi: AJANDA_BORU_ADI, jetonOku: () => JETON, oturumId: "pck_altin0000000000000000" }
          : { rol: s.rol, jeton: JETON, boruAdi: AJANDA_BORU_ADI },
        b,
        s.uyarlayici === undefined ? undefined : PC_KOPRU_UYARLAYICILARI[s.uyarlayici],
      ),
    baglan,
  );
}

type KayitliListe = { tools?: Array<{ name: string }>; ayni?: string };

/** Kayıttaki senaryonun araç adları; `{ayni}` andığı senaryodan çözülür. */
const aracAdlari = (kayit: Record<string, unknown>, ad: string): string[] => {
  const liste = (kayit[ad] as { tools_list?: KayitliListe } | undefined)?.tools_list;
  if (liste?.ayni !== undefined) return aracAdlari(kayit, liste.ayni);
  return (liste?.tools ?? []).map((t) => t.name);
};

// --- Testler ------------------------------------------------------------------------------------

describe("H5.0 köprü araç tanımları altın kaydı (test/altin/kopru-araclar.json)", () => {
  it("her rol, uyarlayıcı ve yüz için tools/list (ad, description, inputSchema, ek alanlar) kayıtla bayt bayt aynı", async () => {
    const kayit: Record<string, unknown> = {};
    // Aynı araç listesi bir kez açık yazılır; sonrakiler ilk yazıldığı senaryoyu anar (`{ayni}`). Karşılaştırma
    // yine tam içerikle yapılır: liste değişirse ya farklılaşır ya da açık yazılan değişir.
    const yazilan = new Map<string, string>();
    for (const [ad, s] of senaryolar()) {
      const yuz = normallestir(await senaryoCalistir(s)) as Yuz;
      const metin = JSON.stringify(yuz.tools_list);
      const onceki = yazilan.get(metin);
      if (onceki === undefined) yazilan.set(metin, ad);
      kayit[ad] = onceki === undefined ? yuz : { ...yuz, tools_list: { ayni: onceki } };
    }
    kayit["sabitler"] = { IS_PROFILI_ACIKLAMASI };
    kayitDenetle(
      DOSYA,
      {
        aciklama:
          "Köprünün MCP yüzü: her köprü rolünün initialize (sunucu adı, yetenekler) ve tools/list yanıtı, olduğu gibi. " +
          "Ajanda rolleri v2/v3 yüzü ve servis yokken; PC rolü her köprü uyarlayıcısıyla. sabitler: protokolün " +
          "PlanOnerGirdi.profil açıklaması. H5.3 bu kaydı değiştirmez.",
      },
      kayit,
    );
  });

  it("bayatlama: kaynaktaki her rol, ajanda rolü ve köprü uyarlayıcısı kayıtta senaryo olarak var", () => {
    const kayit = kayitOku(DOSYA);
    const beklenen = [...senaryolar().keys(), "sabitler"];
    const eksik = beklenen.filter((a) => !Object.hasOwn(kayit, a));
    const fazla = Object.keys(kayit).filter((a) => !beklenen.includes(a));
    assert.deepEqual(
      { eksik, fazla },
      { eksik: [], fazla: [] },
      `Köprüde yeni rol/uyarlayıcı ya da yüz var, kayıt bayat. Yeniden üret: ${KOPRU_YENIDEN_URET}`,
    );
  });

  it("bayatlama: kayıttaki araç adları rol tablolarıyla aynı (yeni araç kayıtsız kalmaz)", () => {
    const kayit = kayitOku(DOSYA);
    const ipucu = (ad: string): string => `${ad}: köprüde araç eklendi/çıktı, kayıt bayat. Yeniden üret: ${KOPRU_YENIDEN_URET}`;
    for (const rol of KopruRolu.options) {
      assert.deepEqual(aracAdlari(kayit, rol), Object.keys(KOPRU_ROL_TABLOLARI[rol]), ipucu(rol));
    }
    for (const [ad, s] of senaryolar()) {
      if (s.tur === "ajanda") assert.deepEqual(aracAdlari(kayit, ad), [...AJANDA_ROL_FIILLERI[s.rol]], ipucu(ad));
    }
  });

  it("köprüsüz ajanda rollerinin aracı yok (kapsam dışı bırakmanın gerekçesi)", () => {
    for (const rol of Object.keys(KOPRUSUZ_AJANDA_ROLLERI) as AjandaKopruRolu[]) {
      assert.deepEqual([...AJANDA_ROL_FIILLERI[rol]], [], `${rol} araç kazandı: KOPRUSUZ_AJANDA_ROLLERI'nden çıkar ve yeniden üret: ${KOPRU_YENIDEN_URET}`);
    }
  });

  it("IS_PROFILI_ACIKLAMASI bugünkü metin; eren plan_oner şemasındaki profil açıklaması o", () => {
    assert.equal(
      IS_PROFILI_ACIKLAMASI,
      "Yalnız pc planında; telefon planında yok sayılır. Verilmezse tam. " +
        "hafif: dosya oluşturma ya da taşıma, sistem bilgisi, kısa komutlar, tek adımlı iş; " +
        "kullanıcı ayarları, hook'lar ve eklentiler yüklenmez, model sonnet. " +
        "tam: kod yazma ya da düzenleme, çok adımlı iş, araştırma, kullanıcının ayarlarını ve " +
        "orkestrasını gerektiren her iş. Emin değilsen tam.",
    );
    const kayit = kayitOku(DOSYA) as Record<string, { tools_list: { tools: Array<{ name: string; inputSchema: { properties: Record<string, { description?: string }> } }> } }>;
    const plan = kayit["eren"]!.tools_list.tools.find((t) => t.name === "plan_oner");
    assert.equal(plan?.inputSchema.properties["profil"]?.description, IS_PROFILI_ACIKLAMASI);
  });
});
