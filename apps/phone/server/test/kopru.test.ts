import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  EREN_ARACLARI,
  KOPRU_BORU_ADI,
  KOPRU_FIILLERI,
  OpakId,
  PLAN_BEKLEME_NEDENLERI,
  ROL_FIILLERI,
  SORU_ARACLARI,
  TELEFON_ARACLARI,
} from "@eren/protocol";
import type { KopruRolu } from "@eren/protocol";
import type { BoruBaglantisi } from "../src/sozlesme.ts";
import { sahteGunluk, sahteRastgele } from "./sahte.ts";
// VARSAYIM: üretim `kopru.ts` testlenebilir giriş olarak `kopruCalistir` dışa aktarır. Gerçek ad
// ya da imza farklıysa yalnız aşağıdaki `kur` değişir (şef bağlar).
import { kopruCalistir, PLAN_BEKLEME_NEDENI_METNI } from "../src/kopru.ts";

const JETON = "j".repeat(43);

// --- Sahte servis tarafı (köprü boruya istemci olarak bağlanır) --------------------------------

interface Baglanti {
  b: BoruBaglantisi & { tetikleKapanis(): void };
  gelen: Array<Record<string, unknown>>;
  kapandi: boolean;
}

type Davranis = (istek: Record<string, unknown>, bag: Baglanti, servis: SahteServis) => void;

class SahteServis {
  baglantilar: Baglanti[] = [];
  /** `baglan` çağrı sayısı, reddedilenler dahil. */
  baglanDenemesi = 0;
  reddedilecek = 0;
  davranis: Davranis = () => {};
  /** Hello'ya `kopru_ret` ile cevap verilecekse kodu. */
  ret: string | null = null;

  get son(): Baglanti {
    const b = this.baglantilar.at(-1);
    assert.ok(b, "bağlantı yok");
    return b;
  }

  istekler(fiil?: string): Array<Record<string, unknown>> {
    return this.baglantilar
      .flatMap((b) => b.gelen)
      .filter((m) => m["type"] === "istek" && (fiil === undefined || m["fiil"] === fiil));
  }

  tumGelenler(): Array<Record<string, unknown>> {
    return this.baglantilar.flatMap((b) => b.gelen);
  }

  baglan = async (ad: string): Promise<BoruBaglantisi> => {
    this.baglanDenemesi += 1;
    assert.equal(ad, KOPRU_BORU_ADI);
    if (this.reddedilecek > 0) {
      this.reddedilecek -= 1;
      throw new Error("boru yok");
    }
    const satirlar: Array<(s: string) => void> = [];
    const kapanislar: Array<() => void> = [];
    const bag: Baglanti = {
      gelen: [],
      kapandi: false,
      b: {
        satirYaz: (s) => {
          if (bag.kapandi) return;
          assert.ok(!s.includes("\n"), "çerçeve tek satır olmalı");
          const m = JSON.parse(s) as Record<string, unknown>;
          bag.gelen.push(m);
          queueMicrotask(() => this.isle(m, bag));
        },
        kapat: () => bag.b.tetikleKapanis(),
        satirDinle: (f) => void satirlar.push(f),
        kapanisDinle: (f) => void kapanislar.push(f),
        tetikleKapanis: () => {
          if (bag.kapandi) return;
          bag.kapandi = true;
          for (const f of kapanislar) f();
        },
      },
    };
    (bag as unknown as { yolla: (s: string) => void }).yolla = (s) => {
      if (!bag.kapandi) for (const f of satirlar) f(s);
    };
    this.baglantilar.push(bag);
    return bag.b;
  };

  yolla(bag: Baglanti, m: Record<string, unknown>): void {
    (bag as unknown as { yolla: (s: string) => void }).yolla(JSON.stringify({ v: 1, ...m }) + "\n");
  }

  yanit(bag: Baglanti, istek_id: unknown, govde: Record<string, unknown>): void {
    this.yolla(bag, { type: "yanit", istek_id, ...govde });
  }

  kopar(): void {
    this.son.b.tetikleKapanis();
  }

  private isle(m: Record<string, unknown>, bag: Baglanti): void {
    if (m["type"] === "kopru_hello") {
      if (this.ret) this.yolla(bag, { type: "kopru_ret", code: this.ret });
      else this.yolla(bag, { type: "kopru_welcome", rol: m["rol"] });
      return;
    }
    this.davranis(m, bag, this);
  }
}

async function bekleKosul(f: () => boolean, ad = "koşul"): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (f()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`${ad} gerçekleşmedi`);
}

// --- Düzenek -----------------------------------------------------------------------------------

interface Duzenek {
  servis: SahteServis;
  istemci: Client;
  bekleme: number[];
  kapat(): Promise<void>;
}

const acik: Duzenek[] = [];
afterEach(async () => {
  for (const d of acik.splice(0)) await d.kapat();
});

async function kur(rol: KopruRolu, ayarla?: (s: SahteServis) => void): Promise<Duzenek> {
  const servis = new SahteServis();
  ayarla?.(servis);
  const [mcpKopru, mcpIstemci] = InMemoryTransport.createLinkedPair();
  const bekleme: number[] = [];
  const calisan = await kopruCalistir(
    { rol, jeton: JETON, boruAdi: KOPRU_BORU_ADI },
    {
      transport: mcpKopru,
      baglan: servis.baglan,
      rastgele: sahteRastgele(),
      gunluk: sahteGunluk(),
      // Gerçek bekleme yok: süreler kaydedilir, hemen çözülür.
      bekle: async (ms: number) => {
        bekleme.push(ms);
      },
    },
  );
  const istemci = new Client({ name: "sahte-model", version: "0.0.0" }, { capabilities: {} });
  await istemci.connect(mcpIstemci);
  const d: Duzenek = {
    servis,
    istemci,
    bekleme,
    kapat: async () => {
      await istemci.close().catch(() => {});
      await calisan.kapat();
    },
  };
  acik.push(d);
  return d;
}

function metin(sonuc: unknown): string {
  const icerik = (sonuc as { content: Array<{ type: string; text?: string }> }).content;
  return icerik.map((c) => c.text ?? "").join("\n");
}

function hataMi(sonuc: unknown): boolean {
  return (sonuc as { isError?: boolean }).isError === true;
}

const TELEFON_OK = { ok: true, foreground: null };

// --- Testler -----------------------------------------------------------------------------------

describe("kopru: araç listesi", () => {
  const beklenen: Record<KopruRolu, string[]> = {
    eren: Object.keys(EREN_ARACLARI),
    soru: Object.keys(SORU_ARACLARI),
    telefon: Object.keys(TELEFON_ARACLARI),
  };

  for (const rol of ["eren", "soru", "telefon"] as const) {
    it(`${rol} rolü yalnız kendi araçlarını yayınlar`, async () => {
      const d = await kur(rol);
      const { tools } = await d.istemci.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), [...beklenen[rol]].sort());
      for (const t of tools) assert.equal(t.inputSchema.type, "object");
    });

    it(`${rol} rolü hello'yu ayarın rolü ve jetonuyla yollar`, async () => {
      const d = await kur(rol);
      await bekleKosul(() => d.servis.baglantilar.length > 0 && d.servis.son.gelen.length > 0);
      const hello = d.servis.baglantilar[0]!.gelen[0]!;
      assert.equal(hello["type"], "kopru_hello");
      assert.equal(hello["rol"], rol);
      assert.equal(hello["jeton"], JETON);
    });
  }

  it("soru rolünde soru_id modele açılmaz, girdi şemasında yoktur", async () => {
    const d = await kur("soru");
    const { tools } = await d.istemci.listTools();
    const props = Object.keys((tools[0]!.inputSchema.properties ?? {}) as object);
    assert.ok(!props.includes("soru_id"));
  });

  it("hiçbir rolde kullanıcı mesajı fiili yoktur", async () => {
    const hepsi = new Set<string>();
    for (const rol of ["eren", "soru", "telefon"] as const) {
      const d = await kur(rol);
      const { tools } = await d.istemci.listTools();
      for (const t of tools) {
        hepsi.add(t.name);
        assert.ok(
          (ROL_FIILLERI[rol] as readonly string[]).includes(t.name),
          `${rol}: ${t.name} rolün fiili değil`,
        );
        assert.ok(KOPRU_FIILLERI.includes(t.name as never));
        assert.doesNotMatch(t.name, /mesaj|sohbet|message|chat|kullanici_mesaj|send/i);
      }
    }
    assert.ok(hepsi.size > 0);
  });

  it("boruya giden her istek rolün izinli fiilidir", async () => {
    const d = await kur("telefon", (s) => {
      s.davranis = (m, bag, sv) => sv.yanit(bag, m["istek_id"], { ok: true, sonuc: TELEFON_OK });
    });
    await d.istemci.callTool({ name: "foreground", arguments: {} });
    const fiiller = d.servis.istekler().map((m) => m["fiil"] as string);
    assert.deepEqual(fiiller, ["foreground"]);
    for (const f of fiiller) assert.ok((ROL_FIILLERI.telefon as readonly string[]).includes(f));
  });
});

describe("kopru: çağrı ve sonuç", () => {
  it("eren aracı boru isteğine döner, sonuç JSON metni olur", async () => {
    const sonuc = { projeler: [{ ad: "ornek", yol: "C:\\ornek" }] };
    const d = await kur("eren", (s) => {
      s.davranis = (m, bag, sv) => sv.yanit(bag, m["istek_id"], { ok: true, sonuc });
    });
    const r = await d.istemci.callTool({ name: "projeler", arguments: {} });
    assert.ok(!hataMi(r));
    assert.deepEqual(JSON.parse(metin(r)), sonuc);
    const [istek] = d.servis.istekler("projeler");
    assert.ok(OpakId.safeParse(istek!["istek_id"]).success);
    assert.deepEqual(istek!["girdi"], {});
  });

  describe("uygulamalar", () => {
    const LISTE = {
      telefon_bagli: true,
      uygulamalar: [
        { paket: "com.whatsapp", ad: "WhatsApp", durum: "acik" },
        { paket: "com.ziraat.ziraatmobil", ad: "Ziraat Mobil", durum: "hassas" },
        { paket: "com.android.settings", ad: "Ayarlar", durum: "degismez" },
      ],
    };
    const kurListe = () =>
      kur("eren", (s) => {
        s.davranis = (m, bag, sv) => sv.yanit(bag, m["istek_id"], { ok: true, sonuc: LISTE });
      });

    it("sonuç sıkı metin olur; kapalılar işaretli, boruya {} gider", async () => {
      const d = await kurListe();
      const r = await d.istemci.callTool({ name: "uygulamalar", arguments: {} });
      assert.ok(!hataMi(r));
      const t = metin(r);
      assert.ok(t.startsWith("uygulamalar: telefon_bagli=evet toplam=3 gosterilen=3\n"), t);
      assert.ok(t.includes('\ncom.whatsapp "WhatsApp"'));
      assert.ok(t.includes('\ncom.ziraat.ziraatmobil [kapalı:hassas] "Ziraat Mobil"'));
      assert.ok(t.includes('\ncom.android.settings [kapalı:degismez] "Ayarlar"'));
      const [istek] = d.servis.istekler("uygulamalar");
      assert.deepEqual(istek!["girdi"], {});
    });

    it("ara köprüde süzer, boruya gitmez", async () => {
      const d = await kurListe();
      const r = await d.istemci.callTool({ name: "uygulamalar", arguments: { ara: "ziraat" } });
      const t = metin(r);
      assert.ok(t.includes("eslesen=1 gosterilen=1"), t);
      assert.ok(t.includes("com.ziraat.ziraatmobil [kapalı:hassas]"));
      assert.ok(!t.includes("com.whatsapp"));
      assert.deepEqual(d.servis.istekler("uygulamalar")[0]!["girdi"], {});
    });

    it("geçersiz ara boruya çıkmadan gecersiz_mesaj olur", async () => {
      const d = await kurListe();
      const durumlar: Array<[Record<string, unknown>, string]> = [
        [{ ara: "" }, "ara: en az 1 karakter"],
        [{ ara: 5 }, "ara: beklenen tür string"],
        [{ baska: true }, "baska: bilinmeyen alan"],
      ];
      for (const [args, satir] of durumlar) {
        const r = await d.istemci.callTool({ name: "uygulamalar", arguments: args });
        assert.ok(hataMi(r));
        assert.ok(metin(r).startsWith(`hata: gecersiz_mesaj\n${satir}`), metin(r));
      }
      assert.equal(d.servis.istekler("uygulamalar").length, 0);
    });

    it("şemaya uymayan servis sonucu ic_hata olur", async () => {
      const d = await kur("eren", (s) => {
        s.davranis = (m, bag, sv) =>
          sv.yanit(bag, m["istek_id"], { ok: true, sonuc: { telefon_bagli: true } });
      });
      const r = await d.istemci.callTool({ name: "uygulamalar", arguments: {} });
      assert.ok(hataMi(r));
      assert.equal(metin(r).trim(), "hata: ic_hata");
    });

    it("araç tanımı ara girdisini yayınlar, büyümesi 300 karakteri aşmaz", async () => {
      const d = await kur("eren");
      const { tools } = await d.istemci.listTools();
      const t = tools.find((x) => x.name === "uygulamalar")!;
      assert.deepEqual(Object.keys(t.inputSchema.properties ?? {}), ["ara"]);
      assert.equal(t.inputSchema.required, undefined);
      const eski =
        "Telefondaki uygulamaları ve durumlarını listeler.".length +
        JSON.stringify({ type: "object", properties: {}, additionalProperties: false }).length;
      const yeni = (t.description ?? "").length + JSON.stringify(t.inputSchema).length;
      assert.ok(yeni - eski <= 300, `büyüme ${yeni - eski}`);
    });
  });

  it("boru hatası isError:true ve 'hata: <code>' olur, detail modele gitmez", async () => {
    const d = await kur("eren", (s) => {
      s.davranis = (m, bag, sv) =>
        sv.yanit(bag, m["istek_id"], { ok: false, code: "ic_hata", detail: "GIZLI-AYRINTI-42" });
    });
    const r = await d.istemci.callTool({ name: "projeler", arguments: {} });
    assert.ok(hataMi(r));
    assert.equal(metin(r).trim(), "hata: ic_hata");
    assert.ok(!JSON.stringify(r).includes("GIZLI-AYRINTI-42"));
  });

  it("rol_fiil_izinsiz de aynı biçimde hata olur", async () => {
    const d = await kur("eren", (s) => {
      s.davranis = (m, bag, sv) =>
        sv.yanit(bag, m["istek_id"], { ok: false, code: "rol_fiil_izinsiz", detail: "ic-ayrinti" });
    });
    const r = await d.istemci.callTool({ name: "oturumlar", arguments: {} });
    assert.ok(hataMi(r));
    assert.equal(metin(r).trim(), "hata: rol_fiil_izinsiz");
    assert.ok(!JSON.stringify(r).includes("ic-ayrinti"));
  });
});

describe("kopru: plan_oner", () => {
  const HASH = "a".repeat(64);
  const PC = { baslik: "Ornek is", tur: "pc", cwd: "C:\\ornek", gorev_metni: "Ornek gorev" };
  const TELEFON = {
    baslik: "Telefon isi",
    tur: "telefon",
    cwd: "",
    gorev_metni: "Ekrani oku",
    telefon_izin_istegi: { uygulamalar: ["com.whatsapp"], mod: "oku" },
  };
  const yanitla = (sonuc: unknown) => (s: SahteServis) => {
    s.davranis = (m, bag, sv) => sv.yanit(bag, m["istek_id"], sonuc as Record<string, unknown>);
  };

  it("araç açıklaması onay kartı/başlatmaz demez, eski plan alanlarını anmaz", async () => {
    const d = await kur("eren");
    const { tools } = await d.istemci.listTools();
    const t = tools.find((x) => x.name === "plan_oner")!;
    const aciklama = t.description ?? "";
    assert.ok(!aciklama.includes("İş başlatmaz"), aciklama);
    assert.ok(!aciklama.includes("planı önerir"), aciklama);
    assert.ok(aciklama.includes("hemen başlar"), aciklama);
    assert.ok(!JSON.stringify(t).includes("kesin_yapil"));
    assert.ok(!Object.keys(t.inputSchema.properties ?? {}).some((k) => k.startsWith("kesin_")));
  });

  const basari = async (sonuc: Record<string, unknown>): Promise<string> => {
    const d = await kur("eren", yanitla({ ok: true, sonuc: { plan_id: "plan_x1", plan_hash: HASH, ...sonuc } }));
    const r = await d.istemci.callTool({ name: "plan_oner", arguments: PC });
    assert.ok(!hataMi(r), metin(r));
    assert.deepEqual(d.servis.istekler("plan_oner")[0]!["girdi"], PC);
    const t = metin(r);
    assert.ok(!t.includes(HASH), t);
    assert.ok(!t.includes("onay_bekliyor") && !t.includes("telefonda_baslatiliyor"), t);
    return t;
  };

  it("basladi: iş başladı der, 'başlattım' dedirtir; plan/onay söylemi yok", async () => {
    const t = await basari({ durum: "basladi", is_id: 7 });
    assert.ok(t.startsWith("plan_oner: iş başladı (iş 7, plan plan_x1)."), t);
    assert.ok(t.includes('"başlattım" de'), t);
    assert.ok(!/onay(?!dan söz etme)/.test(t), t);
    const t2 = await basari({ durum: "basladi" });
    assert.ok(t2.startsWith("plan_oner: iş başladı (plan plan_x1)."), t2);
  });

  it("telefonda_baslatiliyor: telefonda başlatılıyor der; onayı yalnız iş başlamazsa söyletir", async () => {
    const t = await basari({ durum: "telefonda_baslatiliyor" });
    assert.ok(t.startsWith("plan_oner: iş telefona gitti, telefonda başlatılıyor (plan plan_x1)."), t);
    assert.ok(t.includes("onaydan yalnız iş başlamazsa söz et"), t);
    // Not metni konusma-metin.planSonucuMetni ile aynı kalıpta.
    assert.ok(t.includes('"İş <no> başladı (plan plan_x1)."'), t);
  });

  it("onay_bekliyor: gerçekten onay beklendiğini açıkça söyler", async () => {
    const t = await basari({ durum: "onay_bekliyor" });
    assert.ok(t.startsWith("plan_oner: iş başlamadı, kullanıcının telefonda onayı bekleniyor (plan plan_x1)."), t);
    assert.ok(!t.includes("Neden:"), t);
  });

  it("onay_bekliyor: her neden kısa Türkçe ile söylenir; ham kod ve hash modele gitmez", async () => {
    const beklenen: Record<(typeof PLAN_BEKLEME_NEDENLERI)[number], string> = {
      tam_yetki_kapali: "tam yetki kapalı olduğu için onay bekliyor",
      kirli_kaynak: "kaynak kirli",
      tur_bitti: "turu bittiği ya da değiştiği için onay gerekiyor",
      limit_kilitli: "limiti kilitli olduğu için başlayamadı",
      baslatma_hatasi: "başlatma hatası",
    };
    for (const neden of PLAN_BEKLEME_NEDENLERI) {
      const t = await basari({ durum: "onay_bekliyor", neden });
      assert.ok(t.startsWith("plan_oner: iş başlamadı, kullanıcının telefonda onayı bekleniyor (plan plan_x1)."), t);
      assert.ok(t.includes(`Neden: ${PLAN_BEKLEME_NEDENI_METNI[neden]}.`), t);
      assert.ok(t.includes(beklenen[neden]), t);
      assert.ok(t.includes("nedeni tek cümleyle söyle"), t);
      assert.ok(!PLAN_BEKLEME_NEDENLERI.some((k) => t.includes(k)), t);
    }
  });

  it("katı protokol şeması: neden/is_id yanlış durumla ya da bilinmeyen alan ic_hata olur", async () => {
    for (const sonuc of [
      { durum: "basladi", neden: "tur_bitti" },
      { durum: "onay_bekliyor", is_id: 3 },
      { durum: "onay_bekliyor", neden: "baska" },
      { durum: "basladi", fazla: 1 },
    ]) {
      const d = await kur("eren", yanitla({ ok: true, sonuc: { plan_id: "plan_x1", plan_hash: HASH, ...sonuc } }));
      const r = await d.istemci.callTool({ name: "plan_oner", arguments: PC });
      assert.ok(hataMi(r), JSON.stringify(sonuc));
      assert.equal(metin(r), "hata: ic_hata");
    }
  });

  it("bilinmeyen durum ic_hata olur", async () => {
    const d = await kur("eren", yanitla({ ok: true, sonuc: { plan_id: "plan_x1", plan_hash: HASH, durum: "baska" } }));
    const r = await d.istemci.callTool({ name: "plan_oner", arguments: PC });
    assert.ok(hataMi(r));
    assert.equal(metin(r), "hata: ic_hata");
  });

  it("eski kesin_* alanı boruya çıkmadan gecersiz_mesaj; alan adı ve 'bilinmeyen alan' modele gider", async () => {
    const d = await kur("eren");
    const r = await d.istemci.callTool({
      name: "plan_oner",
      arguments: { ...PC, kesin_yapilacaklar: ["a"], kesin_yapilmayacaklar: [] },
    });
    assert.ok(hataMi(r));
    const t = metin(r);
    assert.ok(t.startsWith("hata: gecersiz_mesaj\n"), t);
    assert.ok(t.includes("kesin_yapilacaklar: bilinmeyen alan"), t);
    assert.ok(t.includes("kesin_yapilmayacaklar: bilinmeyen alan"), t);
    assert.equal(d.servis.istekler("plan_oner").length, 0);
  });

  it("telefon planında cwd dolu: alan yolu ve kural metni gider, girdi değeri gitmez", async () => {
    const d = await kur("eren");
    const r = await d.istemci.callTool({ name: "plan_oner", arguments: { ...TELEFON, cwd: "C:\\GIZLI-YOL-77" } });
    assert.ok(hataMi(r));
    const t = metin(r);
    assert.equal(t, "hata: gecersiz_mesaj\ncwd: telefon planında cwd boş olur");
    assert.ok(!t.includes("GIZLI-YOL-77"));
    assert.equal(d.servis.istekler("plan_oner").length, 0);
  });

  it("eksik alan, sınır ve enum ihlalleri alan yoluyla; değer metni sızmaz", async () => {
    const d = await kur("eren");
    const { gorev_metni: _g, ...eksik } = PC;
    const r1 = await d.istemci.callTool({ name: "plan_oner", arguments: eksik });
    assert.match(metin(r1), /^hata: gecersiz_mesaj\ngorev_metni: beklenen tür string/);
    const r2 = await d.istemci.callTool({ name: "plan_oner", arguments: { ...PC, tur: "GIZLI-TUR" } });
    assert.ok(metin(r2).includes("tur: izinli değerler: pc, telefon"), metin(r2));
    assert.ok(!metin(r2).includes("GIZLI-TUR"));
    const r3 = await d.istemci.callTool({ name: "plan_oner", arguments: { ...PC, baslik: "x".repeat(5000) } });
    assert.match(metin(r3), /\nbaslik: en çok \d+ karakter/);
    const r4 = await d.istemci.callTool({
      name: "plan_oner",
      arguments: { ...TELEFON, telefon_izin_istegi: { uygulamalar: ["com.a", "com.b"], mod: "yaz" } },
    });
    assert.ok(metin(r4).includes("telefon_izin_istegi.uygulamalar: yazma izni tek paket içindir"), metin(r4));
    assert.equal(d.servis.istekler("plan_oner").length, 0);
  });

  it("anahtar adı güvenli kalıba uymuyorsa '?' yazılır", async () => {
    const d = await kur("eren");
    const r = await d.istemci.callTool({ name: "plan_oner", arguments: { ...PC, "gizli veri: 123": 1 } });
    const t = metin(r);
    assert.ok(t.includes("?: bilinmeyen alan"), t);
    assert.ok(!t.includes("gizli veri"));
  });

  it("servisin plan_gecersiz ayrıntısı yalnız izin listesindeyse modele gider", async () => {
    const d1 = await kur("eren", yanitla({ ok: false, code: "plan_gecersiz", detail: "cwd" }));
    const r1 = await d1.istemci.callTool({ name: "plan_oner", arguments: PC });
    assert.equal(metin(r1), "hata: plan_gecersiz\ncwd: klasör bulunamadı");
    const d2 = await kur("eren", yanitla({ ok: false, code: "plan_gecersiz", detail: "GIZLI-AYRINTI-9" }));
    const r2 = await d2.istemci.callTool({ name: "plan_oner", arguments: PC });
    assert.equal(metin(r2), "hata: plan_gecersiz");
  });
});

describe("kopru: iptal", () => {
  it("MCP notifications/cancelled boruya iptal{istek_id} olarak gider", async () => {
    // Yanıt hiç gelmez: çağrı askıda kalır.
    const d = await kur("eren");
    const ac = new AbortController();
    const cagri = d.istemci
      .callTool({ name: "oturumlar", arguments: {} }, undefined, { signal: ac.signal })
      .catch((e: unknown) => e);
    await bekleKosul(() => d.servis.istekler("oturumlar").length === 1, "istek");
    const istekId = d.servis.istekler("oturumlar")[0]!["istek_id"];
    ac.abort();
    await cagri;
    await bekleKosul(() => d.servis.tumGelenler().some((m) => m["type"] === "iptal"), "iptal");
    const iptaller = d.servis.tumGelenler().filter((m) => m["type"] === "iptal");
    assert.equal(iptaller.length, 1);
    assert.equal(iptaller[0]!["istek_id"], istekId);
    assert.equal(iptaller[0]!["v"], 1);
  });
});

describe("kopru: soru", () => {
  const SORU = { soru: "Hangisi?", secenekler: ["a", "b"] };

  it("soru_id köprüde üretilir ve boru isteğinde taşınır", async () => {
    const d = await kur("soru", (s) => {
      s.davranis = (m, bag, sv) =>
        sv.yanit(bag, m["istek_id"], { ok: true, sonuc: { durum: "cevaplandi", cevap: "a" } });
    });
    const r = await d.istemci.callTool({ name: "kullaniciya_sor", arguments: SORU });
    assert.ok(!hataMi(r));
    assert.deepEqual(JSON.parse(metin(r)), { durum: "cevaplandi", cevap: "a" });
    const [istek] = d.servis.istekler("kullaniciya_sor");
    const girdi = istek!["girdi"] as Record<string, unknown>;
    assert.ok(OpakId.safeParse(girdi["soru_id"]).success);
    assert.equal(girdi["soru"], SORU.soru);
  });

  it("MCP çağrısı zaman aşımına düşmez: araç çağrısı beklerken servis yanıtı geç gelir", async () => {
    let tut: (() => void) | null = null;
    const d = await kur("soru", (s) => {
      s.davranis = (m, bag, sv) => {
        tut = () =>
          sv.yanit(bag, m["istek_id"], { ok: true, sonuc: { durum: "zaman_asimi" } });
      };
    });
    const cagri = d.istemci.callTool({ name: "kullaniciya_sor", arguments: SORU });
    await bekleKosul(() => tut !== null, "istek");
    (tut as unknown as () => void)();
    const r = await cagri;
    assert.deepEqual(JSON.parse(metin(r)), { durum: "zaman_asimi" });
  });

  it("boru koparsa yeniden bağlanıp soru_bekle{soru_id} yollar, soru_bulunamadi'da aynı soru_id ile yeniden sorar", async () => {
    const d = await kur("soru", (s) => {
      s.davranis = (m, bag, sv) => {
        if (m["fiil"] === "soru_bekle") {
          sv.yanit(bag, m["istek_id"], { ok: false, code: "soru_bulunamadi" });
        } else if (m["fiil"] === "kullaniciya_sor" && sv.baglantilar.length >= 2) {
          sv.yanit(bag, m["istek_id"], { ok: true, sonuc: { durum: "cevaplandi", cevap: "b" } });
        }
        // İlk bağlantıda kullaniciya_sor yanıtsız kalır.
      };
    });
    const cagri = d.istemci.callTool({ name: "kullaniciya_sor", arguments: SORU });
    await bekleKosul(() => d.servis.istekler("kullaniciya_sor").length === 1, "ilk soru");
    const ilkId = (d.servis.istekler("kullaniciya_sor")[0]!["girdi"] as Record<string, unknown>)[
      "soru_id"
    ];

    d.servis.kopar();
    const r = await cagri;

    assert.ok(!hataMi(r));
    assert.deepEqual(JSON.parse(metin(r)), { durum: "cevaplandi", cevap: "b" });
    assert.equal(d.servis.baglantilar.length, 2);
    // İkinci bağlantı yeniden el sıkışır, sonra beklemeyi sürdürür.
    const ikinci = d.servis.baglantilar[1]!.gelen;
    assert.equal(ikinci[0]!["type"], "kopru_hello");
    assert.equal(ikinci[0]!["jeton"], JETON);
    const bekle = ikinci.find((m) => m["fiil"] === "soru_bekle");
    assert.ok(bekle, "soru_bekle gitmedi");
    assert.deepEqual(bekle["girdi"], { soru_id: ilkId });
    const yeniden = ikinci.find((m) => m["fiil"] === "kullaniciya_sor");
    assert.ok(yeniden, "kullaniciya_sor yeniden gitmedi");
    assert.equal((yeniden["girdi"] as Record<string, unknown>)["soru_id"], ilkId);
    assert.equal((yeniden["girdi"] as Record<string, unknown>)["soru"], SORU.soru);
  });

  it("yeniden bağlanınca soru_bekle cevap getirirse soru tekrar sorulmaz", async () => {
    const d = await kur("soru", (s) => {
      s.davranis = (m, bag, sv) => {
        if (m["fiil"] === "soru_bekle") {
          sv.yanit(bag, m["istek_id"], { ok: true, sonuc: { durum: "cevaplandi", cevap: "a" } });
        }
      };
    });
    const cagri = d.istemci.callTool({ name: "kullaniciya_sor", arguments: SORU });
    await bekleKosul(() => d.servis.istekler("kullaniciya_sor").length === 1, "ilk soru");
    d.servis.kopar();
    const r = await cagri;
    assert.deepEqual(JSON.parse(metin(r)), { durum: "cevaplandi", cevap: "a" });
    assert.equal(d.servis.istekler("kullaniciya_sor").length, 1);
    assert.equal(d.servis.istekler("soru_bekle").length, 1);
  });
});

describe("kopru: telefon yeniden denenmez", () => {
  for (const code of ["telefon_bagli_degil", "belirsiz"] as const) {
    it(`${code}: isError, 'hata: ${code}', tek istek çerçevesi`, async () => {
      const d = await kur("telefon", (s) => {
        s.davranis = (m, bag, sv) =>
          sv.yanit(bag, m["istek_id"], { ok: false, code, detail: "ayrinti-sizmamali" });
      });
      const r = await d.istemci.callTool({ name: "click", arguments: { x: 1, y: 2 } });
      assert.ok(hataMi(r));
      assert.equal(metin(r).trim(), `hata: ${code}`);
      assert.ok(!JSON.stringify(r).includes("ayrinti-sizmamali"));
      // Biraz zaman tanı: gizli bir yeniden deneme olsaydı ortaya çıkardı.
      for (let i = 0; i < 20; i += 1) await new Promise((r2) => setImmediate(r2));
      assert.equal(d.servis.istekler().length, 1);
      assert.equal(d.servis.istekler("click").length, 1);
    });
  }

  it("istek gittikten sonra boru koparsa araç hata döner, yeniden bağlanınca ikinci istek gitmez", async () => {
    const d = await kur("telefon"); // yanıt yok
    const cagri = d.istemci.callTool({ name: "click", arguments: { x: 1, y: 2 } });
    await bekleKosul(() => d.servis.istekler("click").length === 1, "istek");
    d.servis.kopar();
    const r = await cagri;
    assert.ok(hataMi(r));
    assert.equal(metin(r).trim(), "hata: belirsiz");
    await bekleKosul(() => d.servis.baglantilar.length === 2, "yeniden bağlanma");
    for (let i = 0; i < 20; i += 1) await new Promise((r2) => setImmediate(r2));
    assert.equal(d.servis.istekler("click").length, 1);
    assert.equal(d.servis.istekler().length, 1);
  });
});

describe("kopru: yeniden bağlanma aralığı", () => {
  it("1, 2, 4... 30 sn üst sınırla artar", async () => {
    const d = await kur("eren", (s) => {
      s.reddedilecek = 7;
    });
    await bekleKosul(() => d.servis.baglantilar.length === 1, "bağlantı");
    assert.deepEqual(d.bekleme.slice(0, 7), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});
