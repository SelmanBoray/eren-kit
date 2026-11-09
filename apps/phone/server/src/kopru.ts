import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  AZAMI_CERCEVE,
  CmdAdi,
  CmdSonucu,
  EREN_ARACLARI,
  Jeton,
  jsonSemasi,
  KOPRU_BORU_ADI,
  KOPRU_FIIL_SEMALARI,
  kopruAsagiCoz,
  KopruRolu,
  PROTOKOL_SURUMU,
  RaporOkuCikti,
  SORU_ARACLARI,
  TELEFON_ARACLARI,
  UygulamalarCikti,
} from "@eren/protocol";
import type { HataKodu, KopruFiili } from "@eren/protocol";
import type { z } from "zod";
import { ekranMetniKur } from "./ekran-metni.ts";
import type { BoruBaglantisi, Gunluk, KopruIstemciAyari, RastgelePortu } from "./sozlesme.ts";
import { UygulamalarAracGirdi, uygulamaMetniKur } from "./uygulama-metni.ts";

const MODUL = "kopru";
const ILK_GECIKME_MS = 1_000;
const AZAMI_GECIKME_MS = 30_000;
/** Servisin `kopru_hello` için tanıdığı süreyle aynı. */
const EL_SIKISMA_MS = 10_000;

interface AracSemasi {
  readonly girdi: z.ZodType;
  readonly cikti: z.ZodType;
}

const ROL_ARACLARI: Readonly<Record<KopruRolu, Readonly<Record<string, AracSemasi>>>> = {
  eren: EREN_ARACLARI,
  soru: SORU_ARACLARI,
  telefon: TELEFON_ARACLARI,
};

/** Yalnız köprüde uygulanan girdi: modele bu şema yayınlanır, boruya `{}` gider. */
const YEREL_GIRDILER: Readonly<Record<string, z.ZodType>> = {
  uygulamalar: UygulamalarAracGirdi,
};

const ARAC_ACIKLAMALARI: Readonly<Record<string, string>> = {
  plan_oner:
    "İş planı önerir. İş başlatmaz, telefonda onay kartı açar. " +
    "Pc planında iş profilini sen seçersin (profil alanı; verilmezse tam). " +
    "hafif: dosya oluşturma ya da taşıma, sistem bilgisi, kısa komut, tek adımlı iş; hızlı ve ucuzdur, " +
    "kullanıcı ayarları, hook'lar ve orkestra yüklenmez. " +
    "tam: kod yazma ya da düzenleme, çok adımlı iş, araştırma, orkestra gereken her iş; varsayılandır. " +
    "Emin değilsen tam.",
  oturumlar: "İş oturumlarını ve bilgisayarın bellek durumunu listeler.",
  rapor_oku: "Biten bir işin raporunu okur.",
  projeler: "Kayıtlı projeleri listeler.",
  uygulamalar:
    "Telefondaki uygulamaları ve telefon işine açık/kapalı durumlarını listeler. " +
    "Liste uzunsa kesilir; adı bilinen uygulama için ara ver.",
  oturum_durdur: "Bir iş oturumunu durdurur.",
  devir_ozeti: "Konuşma devri için özeti teslim eder.",
  kullaniciya_sor: "Kullanıcıya telefondan soru sorar ve cevabı bekler.",
  foreground: "Telefonda ön plandaki pencereyi söyler.",
  elements: "Ekrandaki erişilebilirlik öğelerini listeler.",
  screenshot: "Ekran görüntüsü alır.",
  zoom: "Ekranın bir bölgesinin görüntüsünü alır.",
  click: "Bir öğeye ya da koordinata dokunur.",
  type_text: "Odaktaki alana metin yazar.",
  key: "Sistem tuşuna basar.",
  scroll: "Ekranı kaydırır.",
  drag: "İki nokta arasında sürükler.",
  wait: "Verilen saniye kadar bekler.",
  open_app: "Bir uygulamayı paket adıyla açar.",
  rapor_ver: "İşin bitiş raporunu verir.",
};

export interface KopruBagimliliklari {
  /** MCP tarafı. Süreçte stdio, testte bellek içi. */
  transport: Transport;
  /** Boruya bağlanır, açılamazsa reddeder. */
  baglan: (boruAdi: string) => Promise<BoruBaglantisi>;
  rastgele: Pick<RastgelePortu, "opakId" | "hex64">;
  gunluk: Gunluk;
  /** Yeniden bağlanma aralığı. */
  bekle: (ms: number) => Promise<void>;
}

export interface KopruCalisani {
  /** MCP kapandığında da çözülür. */
  readonly kapandi: Promise<void>;
  kapat(): Promise<void>;
}

type BoruYaniti =
  | { tur: "basari"; sonuc: unknown }
  | { tur: "hata"; code: HataKodu }
  /** İstek yollandı, yanıt gelmeden boru koptu: sonuç bilinmiyor. */
  | { tur: "koptu" }
  /** Boru yoktu, istek çıkmadı. */
  | { tur: "yollanmadi" }
  | { tur: "iptal" };

interface BoruIstemci {
  calistir(): Promise<void>;
  /**
   * `null`: bağlantı hazır. `surekli` değilse yalnız süren denemenin sonucunu bekler.
   * `kopuk`: bağlantı yok; kalıcı retse o kod.
   */
  hazirBekle(sinyal: AbortSignal, surekli: boolean): Promise<HataKodu | "kopuk" | null>;
  istekYolla(fiil: KopruFiili, girdi: unknown, sinyal: AbortSignal): Promise<BoruYaniti>;
  soruIptaliBiriktir(soruId: string): void;
  durdur(): void;
}

function boruIstemciKur(ayar: KopruIstemciAyari, b: KopruBagimliliklari): BoruIstemci {
  const { gunluk, rastgele } = b;
  let acik: BoruBaglantisi | null = null;
  /** Yalnız `kopru_welcome` sonrası dolu. */
  let hazir: BoruBaglantisi | null = null;
  let denemede = false;
  let durdu = false;
  let kaliciHata: HataKodu | null = null;
  const bekleyenler = new Map<string, (y: BoruYaniti) => void>();
  const denemeDinleyicileri = new Set<() => void>();
  const biriken = new Set<string>();

  const denemeBitti = (): void => {
    for (const f of [...denemeDinleyicileri]) f();
  };

  const denemeBitisi = (sinyal: AbortSignal): Promise<void> =>
    new Promise((coz) => {
      const bitti = (): void => {
        denemeDinleyicileri.delete(bitti);
        sinyal.removeEventListener("abort", bitti);
        coz();
      };
      denemeDinleyicileri.add(bitti);
      sinyal.addEventListener("abort", bitti, { once: true });
    });

  // Kopukken iptal edilen soru serviste bekler kalmasın: beklemeye bağlanıp hemen iptal edilir.
  const biriktirilenleriYolla = (bag: BoruBaglantisi): void => {
    for (const soru_id of biriken) {
      const istek_id = rastgele.opakId("istek");
      bag.satirYaz(
        JSON.stringify({
          v: PROTOKOL_SURUMU,
          type: "istek",
          istek_id,
          fiil: "soru_bekle",
          girdi: { soru_id },
        }),
      );
      bag.satirYaz(JSON.stringify({ v: PROTOKOL_SURUMU, type: "iptal", istek_id }));
    }
    biriken.clear();
  };

  /** Bağlantı kapanınca çözülür. `true`: el sıkışma başarılıydı. */
  const baglantiYurut = (bag: BoruBaglantisi): Promise<boolean> =>
    new Promise((coz) => {
      let karsilandi = false;
      const elSikisma = setTimeout(() => bag.kapat(), EL_SIKISMA_MS);
      acik = bag;

      bag.satirDinle((satir) => {
        const cozum = kopruAsagiCoz(satir);
        if (!cozum.ok) {
          gunluk.uyari(MODUL, "gecersiz_cerceve", {
            kod: cozum.kod,
            yollar: cozum.yollar.join(","),
          });
          bag.kapat();
          return;
        }
        const m = cozum.mesaj;
        if (m.type === "kopru_welcome") {
          if (karsilandi) return;
          karsilandi = true;
          clearTimeout(elSikisma);
          hazir = bag;
          denemede = false;
          gunluk.bilgi(MODUL, "boru_baglandi", { rol: ayar.rol });
          biriktirilenleriYolla(bag);
          denemeBitti();
        } else if (m.type === "kopru_ret") {
          gunluk.uyari(MODUL, "boru_reddedildi", { code: m.code });
          // Jeton yalnız iş bitince silinir, bir daha geçerli olmaz: denemeye değmez.
          if (m.code === "jeton_gecersiz") kaliciHata = m.code;
          bag.kapat();
        } else {
          const bekleyen = bekleyenler.get(m.istek_id);
          if (bekleyen === undefined) return;
          bekleyenler.delete(m.istek_id);
          bekleyen(
            m.ok ? { tur: "basari", sonuc: m.sonuc } : { tur: "hata", code: m.code ?? "ic_hata" },
          );
        }
      });

      bag.kapanisDinle(() => {
        clearTimeout(elSikisma);
        acik = null;
        hazir = null;
        const kopanlar = [...bekleyenler.values()];
        bekleyenler.clear();
        for (const f of kopanlar) f({ tur: "koptu" });
        coz(karsilandi);
      });

      bag.satirYaz(
        JSON.stringify({
          v: PROTOKOL_SURUMU,
          type: "kopru_hello",
          rol: ayar.rol,
          jeton: ayar.jeton,
        }),
      );
    });

  return {
    calistir: async () => {
      let gecikme = ILK_GECIKME_MS;
      while (!durdu && kaliciHata === null) {
        denemede = true;
        let karsilandi = false;
        try {
          const bag = await b.baglan(ayar.boruAdi);
          if (durdu) {
            bag.kapat();
            break;
          }
          karsilandi = await baglantiYurut(bag);
        } catch {
          gunluk.uyari(MODUL, "boru_baglanamadi");
        }
        denemede = false;
        denemeBitti();
        if (durdu || kaliciHata !== null) break;
        if (karsilandi) {
          gunluk.uyari(MODUL, "boru_koptu");
          gecikme = ILK_GECIKME_MS;
        }
        await b.bekle(gecikme);
        gecikme = Math.min(gecikme * 2, AZAMI_GECIKME_MS);
      }
    },

    hazirBekle: async (sinyal, surekli) => {
      for (;;) {
        if (kaliciHata !== null) return kaliciHata;
        if (hazir !== null) return null;
        if (durdu || sinyal.aborted || (!surekli && !denemede)) return "kopuk";
        await denemeBitisi(sinyal);
      }
    },

    istekYolla: (fiil, girdi, sinyal) => {
      const bag = hazir;
      if (bag === null) return Promise.resolve({ tur: "yollanmadi" });
      if (sinyal.aborted) return Promise.resolve({ tur: "iptal" });
      return new Promise((coz) => {
        const istek_id = rastgele.opakId("istek");
        const iptalEt = (): void => {
          if (!bekleyenler.delete(istek_id)) return;
          bag.satirYaz(JSON.stringify({ v: PROTOKOL_SURUMU, type: "iptal", istek_id }));
          coz({ tur: "iptal" });
        };
        sinyal.addEventListener("abort", iptalEt, { once: true });
        bekleyenler.set(istek_id, (y) => {
          sinyal.removeEventListener("abort", iptalEt);
          coz(y);
        });
        bag.satirYaz(
          JSON.stringify({ v: PROTOKOL_SURUMU, type: "istek", istek_id, fiil, girdi }),
        );
      });
    },

    soruIptaliBiriktir: (soruId) => {
      biriken.add(soruId);
    },

    durdur: () => {
      durdu = true;
      acik?.kapat();
      denemeBitti();
    },
  };
}

function metinSonucu(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** `detail` modele gitmez. */
function hataSonucu(code: HataKodu): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `hata: ${code}` }] };
}

/** İptal edilen çağrının yanıtını SDK yollamaz, bu metin kimseye ulaşmaz. */
function iptalSonucu(): CallToolResult {
  return { isError: true, content: [{ type: "text", text: "iptal" }] };
}

function evetHayir(deger: boolean): string {
  return deger ? "evet" : "hayir";
}

export async function kopruCalistir(
  ayar: KopruIstemciAyari,
  b: KopruBagimliliklari,
): Promise<KopruCalisani> {
  const { gunluk, rastgele } = b;
  const boru = boruIstemciKur(ayar, b);
  const araclar = ROL_ARACLARI[ayar.rol];
  const tools: Tool[] = Object.entries(araclar).map(([name, arac]) => ({
    name,
    description: ARAC_ACIKLAMALARI[name],
    inputSchema: jsonSemasi(YEREL_GIRDILER[name] ?? arac.girdi) as Tool["inputSchema"],
  }));

  const icHata = (fiil: string): CallToolResult => {
    gunluk.uyari(MODUL, "gecersiz_sonuc", { fiil });
    return hataSonucu("ic_hata");
  };

  const telefonSonucu = (sonuc: CmdSonucu): CallToolResult => {
    const content: CallToolResult["content"] = [
      { type: "text", text: ekranMetniKur(sonuc, rastgele) },
    ];
    if (sonuc.payload?.kind === "image") {
      content.push({
        type: "image",
        data: sonuc.payload.image_base64,
        mimeType: sonuc.payload.mime,
      });
    }
    return { content };
  };

  const sonucCevir = (fiil: KopruFiili, ham: unknown, yerel?: unknown): CallToolResult => {
    if (fiil === "uygulamalar") {
      const r = UygulamalarCikti.safeParse(ham);
      if (!r.success) return icHata(fiil);
      return metinSonucu(uygulamaMetniKur(r.data, (yerel ?? {}) as UygulamalarAracGirdi));
    }
    if (fiil === "rapor_oku") {
      const r = RaporOkuCikti.safeParse(ham);
      if (!r.success) return icHata(fiil);
      const { is_id, durum, kirli, kirpildi, govde } = r.data;
      return metinSonucu(
        `rapor: is_id=${is_id} durum=${durum} kirli=${evetHayir(kirli)} ` +
          `kirpildi=${evetHayir(kirpildi)}
${govde}`,
      );
    }
    if (CmdAdi.safeParse(fiil).success) {
      const r = CmdSonucu.safeParse(ham);
      return r.success ? telefonSonucu(r.data) : icHata(fiil);
    }
    const sema: z.ZodType = KOPRU_FIIL_SEMALARI[fiil].cikti;
    const r = sema.safeParse(ham);
    if (!r.success) return icHata(fiil);
    return metinSonucu(JSON.stringify(r.data));
  };

  /** Ana oturum ve telefon fiilleri. Bir kez gider, yeniden denenmez. `[karar]` */
  const tekSeferlik = async (
    fiil: KopruFiili,
    girdi: unknown,
    sinyal: AbortSignal,
    yerel?: unknown,
  ): Promise<CallToolResult> => {
    const kopukKodu: HataKodu = ayar.rol === "telefon" ? "telefon_bagli_degil" : "ic_hata";
    const engel = await boru.hazirBekle(sinyal, false);
    if (engel !== null) return hataSonucu(engel === "kopuk" ? kopukKodu : engel);
    const y = await boru.istekYolla(fiil, girdi, sinyal);
    switch (y.tur) {
      case "basari":
        return sonucCevir(fiil, y.sonuc, yerel);
      case "hata":
        return hataSonucu(y.code);
      case "koptu":
        return hataSonucu("belirsiz");
      case "yollanmadi":
        return hataSonucu(kopukKodu);
      case "iptal":
        return iptalSonucu();
    }
  };

  /** Cevap gelene dek sürer, kopmalar modele yansımaz. `[karar; is-oturumu §7]` */
  const soruSor = async (girdi: object, sinyal: AbortSignal): Promise<CallToolResult> => {
    const soru_id = rastgele.opakId("soru");
    let fiil: "kullaniciya_sor" | "soru_bekle" = "kullaniciya_sor";
    let yollandi = false;
    for (;;) {
      const engel = await boru.hazirBekle(sinyal, true);
      if (engel !== null) {
        if (sinyal.aborted && yollandi) boru.soruIptaliBiriktir(soru_id);
        return engel === "kopuk" ? iptalSonucu() : hataSonucu(engel);
      }
      const y = await boru.istekYolla(
        fiil,
        fiil === "kullaniciya_sor" ? { soru_id, ...girdi } : { soru_id },
        sinyal,
      );
      switch (y.tur) {
        case "basari":
          return sonucCevir(fiil, y.sonuc);
        case "hata":
          if (y.code !== "soru_bulunamadi" || fiil !== "soru_bekle") return hataSonucu(y.code);
          fiil = "kullaniciya_sor";
          break;
        case "koptu":
          yollandi = true;
          fiil = "soru_bekle";
          break;
        case "yollanmadi":
          break;
        case "iptal":
          return iptalSonucu();
      }
    }
  };

  const aracCagir = async (
    ad: string,
    ham: unknown,
    sinyal: AbortSignal,
  ): Promise<CallToolResult> => {
    const arac = Object.hasOwn(araclar, ad) ? araclar[ad] : undefined;
    if (arac === undefined) return hataSonucu("rol_fiil_izinsiz");
    // Servis şemaya uymayan çerçevede boruyu kapatır: bozuk girdi boruya çıkmamalı.
    const yerel = Object.hasOwn(YEREL_GIRDILER, ad) ? YEREL_GIRDILER[ad] : undefined;
    const girdi = (yerel ?? arac.girdi).safeParse(ham ?? {});
    if (!girdi.success) return hataSonucu("gecersiz_mesaj");
    try {
      return ayar.rol === "soru"
        ? await soruSor(girdi.data as object, sinyal)
        : yerel !== undefined
          ? await tekSeferlik(ad as KopruFiili, {}, sinyal, girdi.data)
          : await tekSeferlik(ad as KopruFiili, girdi.data, sinyal);
    } catch {
      return icHata(ad);
    }
  };

  const server = new Server(
    { name: `eren-${ayar.rol}`, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  // `notifications/cancelled` SDK'da `ekstra.signal`'i keser, oradan `iptal` çerçevesi çıkar.
  server.setRequestHandler(CallToolRequestSchema, (istek, ekstra) =>
    aracCagir(istek.params.name, istek.params.arguments, ekstra.signal),
  );
  server.onerror = () => gunluk.uyari(MODUL, "mcp_hatasi");

  const kapanis = Promise.withResolvers<void>();
  let kapaniyor = false;
  const kapat = async (): Promise<void> => {
    if (!kapaniyor) {
      kapaniyor = true;
      // Önce boru: süreç biterken süren soru `model_iptal` sayılmasın, `baglanti_koptu` görsün.
      boru.durdur();
      await server.close().catch(() => gunluk.uyari(MODUL, "mcp_kapanis_hatasi"));
      kapanis.resolve();
    }
    return kapanis.promise;
  };
  server.onclose = () => void kapat();

  boru.calistir().catch(() => gunluk.hata(MODUL, "boru_dongusu_bitti"));
  await server.connect(b.transport);
  return { kapandi: kapanis.promise, kapat };
}

function soketBaglantisi(soket: Socket): BoruBaglantisi {
  let parcalar: Buffer[] = [];
  let bayt = 0;
  return {
    satirYaz: (satir) => {
      if (!soket.destroyed) soket.write(satir + "\n");
    },
    kapat: () => {
      soket.destroy();
    },
    satirDinle: (f) => {
      soket.on("data", (veri: Buffer) => {
        let bas = 0;
        for (let son = veri.indexOf(0x0a); son !== -1; son = veri.indexOf(0x0a, bas)) {
          if (bayt + son - bas > AZAMI_CERCEVE.KOPRU) {
            soket.destroy();
            return;
          }
          parcalar.push(veri.subarray(bas, son));
          const satir = Buffer.concat(parcalar).toString("utf8");
          parcalar = [];
          bayt = 0;
          bas = son + 1;
          f(satir);
          if (soket.destroyed) return;
        }
        bayt += veri.length - bas;
        if (bayt > AZAMI_CERCEVE.KOPRU) {
          soket.destroy();
          return;
        }
        parcalar.push(veri.subarray(bas));
      });
    },
    kapanisDinle: (f) => {
      soket.once("close", () => f());
    },
  };
}

function boruyaBaglan(ad: string): Promise<BoruBaglantisi> {
  return new Promise((coz, reddet) => {
    const soket = connect(ad);
    soket.once("error", reddet);
    soket.once("connect", () => {
      soket.off("error", reddet);
      // Hatanın ardından `close` gelir, kapanışı o bildirir.
      soket.on("error", () => {});
      coz(soketBaglantisi(soket));
    });
  });
}

/** Stdout MCP'nindir. Alanlar `Gunluk` kuralı gereği içerik taşımaz. */
function stderrGunluk(): Gunluk {
  const yaz =
    (seviye: string): Gunluk["bilgi"] =>
    (modul, olay, alanlar) => {
      process.stderr.write(JSON.stringify({ seviye, modul, olay, ...alanlar }) + "\n");
    };
  return { bilgi: yaz("bilgi"), uyari: yaz("uyari"), hata: yaz("hata") };
}

async function giris(): Promise<void> {
  const argumanlar = process.argv.slice(2);
  const i = argumanlar.indexOf("--rol");
  const rol = KopruRolu.safeParse(i >= 0 ? argumanlar[i + 1] : undefined);
  const jeton = Jeton.safeParse(process.env.EREN_KOPRU_JETON);
  if (!rol.success || !jeton.success) {
    process.stderr.write("kullanim: kopru --rol eren|soru|telefon, jeton EREN_KOPRU_JETON'da\n");
    process.exitCode = 2;
    return;
  }
  const calisan = await kopruCalistir(
    { rol: rol.data, jeton: jeton.data, boruAdi: KOPRU_BORU_ADI },
    {
      transport: new StdioServerTransport(),
      baglan: boruyaBaglan,
      rastgele: {
        opakId: (on) => `${on}_${randomBytes(16).toString("base64url")}`,
        hex64: () => randomBytes(8).toString("hex"),
      },
      gunluk: stderrGunluk(),
      bekle: (ms) => new Promise((coz) => setTimeout(coz, ms)),
    },
  );
  // `StdioServerTransport` stdin'in bitişini izlemez; izlenmezse model ölünce köprü yetim kalır.
  const bitir = (): void => void calisan.kapat();
  process.stdin.once("end", bitir);
  process.stdin.once("close", bitir);
  process.stdout.once("error", bitir);
  await calisan.kapandi;
  process.exit(0);
}

if (import.meta.main) await giris();
