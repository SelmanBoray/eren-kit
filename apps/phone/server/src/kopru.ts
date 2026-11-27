import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  AJANDA_AZAMI_CERCEVE,
  AJANDA_BORU_ADI,
  AJANDA_ROL_FIILLERI,
  AracCagriId,
  OpakId,
  PcAracSonucu,
  pcTurNotu,
  ajandaAracAciklamalari,
  ajandaAraclari,
  ajandaKopruAsagiCoz,
  AjandaKopruRolu,
  ajandaMcpSonucu,
  ajandaPcAracAciklamalari,
  AjandaMcpSonucu,
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
  PlanOnerCikti,
  PROTOKOL_SURUMU,
  RaporOkuCikti,
  SORU_ARACLARI,
  TELEFON_ARACLARI,
  UygulamalarCikti,
} from "@eren/protocol";
import type {
  AjandaAracCiktisi,
  AjandaFiili,
  AjandaKopruAsagi,
  AjandaPcCagri,
  CozumSonucu,
  HataKodu,
  KopruAsagi,
  KopruFiili,
} from "@eren/protocol";
import { z } from "zod";
import { ekranMetniKur } from "./ekran-metni.ts";
import { ajandaPcAnahtarYolu, veriKokuCoz } from "./veri-koku.ts";
import type {
  AjandaKopruIstemciAyari,
  AjandaMcpSunucuAdi,
  BoruBaglantisi,
  Gunluk,
  KopruIstemciAyari,
  RastgelePortu,
} from "./sozlesme.ts";
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
    "İşi yeni bir oturuma verir. Onay gerekmiyorsa hemen başlar, gerekiyorsa telefonda onay kartı açar; " +
    "sonuç hangisinin olduğunu söyler. " +
    "PC işinde iş profilini sen seçersin (profil alanı; verilmezse tam). " +
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
  /** `detail` yalnız `planGecersizDetayi` izin listesinden geçerse modele ulaşır. */
  | { tur: "hata"; code: HataKodu; detail?: string }
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
  /** `ek`: zarfa eklenen alanlar (yalnız PC köprüsünün `cagri`'sı). */
  istekYolla(fiil: KopruFiili | AjandaFiili, girdi: unknown, sinyal: AbortSignal, ek?: Record<string, unknown>): Promise<BoruYaniti>;
  soruIptaliBiriktir(soruId: string): void;
  durdur(): void;
  /** Bekleme aralığındaki yeniden bağlanma döngüsünü hemen denemeye geçirir (PC köprüsü, çağrı gelince). */
  uyandir(): void;
  /** Hazırsa hemen `null`; değilse süren ya da sıradaki denemenin sonunu bekler (en çok bir deneme). */
  denemeBekle(sinyal: AbortSignal): Promise<HataKodu | "kopuk" | null>;
  /** Son bağlanma denemesinin engeli: anahtar yok ya da servis `kopru_ret` verdi (PC metni için). */
  sonEngel(): "anahtar_yok" | HataKodu | null;
}

/** Borunun aşağı çözücüsü: `eren` borusunda `kopruAsagiCoz`, ajanda borusunda `ajandaKopruAsagiCoz`. */
type AsagiCozucu = (satir: string) => CozumSonucu<KopruAsagi | AjandaKopruAsagi>;

/**
 * `aracV3Dinle` (yalnız ajanda kipi): her `kopru_welcome`'da servisin v3 araç yüzü açık mı (`arac_v3`),
 * bekleyenler uyanmadan önce çağrılır.
 */
function boruIstemciKur(
  ayar: KopruIstemciAyari | AjandaKopruIstemciAyari,
  b: KopruBagimliliklari,
  asagiCoz: AsagiCozucu = kopruAsagiCoz,
  aracV3Dinle?: (acik: boolean) => void,
): BoruIstemci {
  const { gunluk, rastgele } = b;
  let acik: BoruBaglantisi | null = null;
  /** Yalnız `kopru_welcome` sonrası dolu. */
  let hazir: BoruBaglantisi | null = null;
  let denemede = false;
  let durdu = false;
  let kaliciHata: HataKodu | null = null;
  // PC köprüsü (`jetonOku` verildi): anahtar her denemede dosyadan okunur, `jeton_gecersiz` kalıcı değildir
  // (kullanıcı anahtarı yenileyince köprü yeniden başlamadan bağlanır); engel yalnız metin içindir.
  const jetonOku = "jetonOku" in ayar ? ayar.jetonOku : undefined;
  let sonEngel: "anahtar_yok" | HataKodu | null = null;
  let uyandirici: (() => void) | null = null;
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
  const baglantiYurut = (bag: BoruBaglantisi, jeton: string): Promise<boolean> =>
    new Promise((coz) => {
      let karsilandi = false;
      const elSikisma = setTimeout(() => bag.kapat(), EL_SIKISMA_MS);
      acik = bag;

      bag.satirDinle((satir) => {
        const cozum = asagiCoz(satir);
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
          aracV3Dinle?.((m as { arac_v3?: unknown }).arac_v3 === true);
          hazir = bag;
          denemede = false;
          sonEngel = null;
          gunluk.bilgi(MODUL, "boru_baglandi", { rol: ayar.rol });
          biriktirilenleriYolla(bag);
          denemeBitti();
        } else if (m.type === "kopru_ret") {
          gunluk.uyari(MODUL, "boru_reddedildi", { code: m.code });
          sonEngel = m.code;
          // Jeton yalnız iş bitince silinir, bir daha geçerli olmaz: denemeye değmez. PC anahtarı
          // dosyadan yenilenebilir: kalıcı değil, sonraki deneme dosyayı yeniden okur.
          if (m.code === "jeton_gecersiz" && jetonOku === undefined) kaliciHata = m.code;
          bag.kapat();
        } else {
          const bekleyen = bekleyenler.get(m.istek_id);
          if (bekleyen === undefined) return;
          bekleyenler.delete(m.istek_id);
          bekleyen(
            m.ok
              ? { tur: "basari", sonuc: m.sonuc }
              : { tur: "hata", code: m.code ?? "ic_hata", detail: m.detail },
          );
          // PC: anahtar bağlantı açıkken iptal edildi. Bağlantı bırakılır; yeniden bağlanma dosyayı yeniden okur.
          if (!m.ok && m.code === "jeton_gecersiz" && jetonOku !== undefined) {
            sonEngel = "jeton_gecersiz";
            bag.kapat();
          }
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
          jeton,
        }),
      );
    });

  /** Bekleme ya da `uyandir`: hangisi önce. */
  const aralikBekle = async (ms: number): Promise<void> => {
    const uyan = Promise.withResolvers<void>();
    uyandirici = uyan.resolve;
    try {
      await Promise.race([b.bekle(ms), uyan.promise]);
    } finally {
      uyandirici = null;
    }
  };

  return {
    calistir: async () => {
      let gecikme = ILK_GECIKME_MS;
      while (!durdu && kaliciHata === null) {
        denemede = true;
        let karsilandi = false;
        let jeton: string | null = ayar.jeton;
        if (jetonOku !== undefined) {
          try {
            jeton = jetonOku();
          } catch {
            jeton = null;
          }
        }
        if (jeton === null) {
          // PC anahtarı yok (henüz üretilmedi ya da kaldırıldı): denemeden bekle.
          sonEngel = "anahtar_yok";
        } else {
          try {
            const bag = await b.baglan(ayar.boruAdi);
            if (durdu) {
              bag.kapat();
              break;
            }
            karsilandi = await baglantiYurut(bag, jeton);
          } catch {
            gunluk.uyari(MODUL, "boru_baglanamadi");
            // Boru yok: engel servisin kendisidir (metin "ulaşılamıyor").
            sonEngel = null;
          }
        }
        denemede = false;
        denemeBitti();
        if (durdu || kaliciHata !== null) break;
        if (karsilandi) {
          gunluk.uyari(MODUL, "boru_koptu");
          gecikme = ILK_GECIKME_MS;
        }
        await aralikBekle(gecikme);
        gecikme = Math.min(gecikme * 2, AZAMI_GECIKME_MS);
      }
    },

    uyandir: () => {
      uyandirici?.();
    },

    denemeBekle: async (sinyal) => {
      if (hazir !== null) return null;
      if (kaliciHata !== null) return kaliciHata;
      if (durdu || sinyal.aborted) return "kopuk";
      await denemeBitisi(sinyal);
      return hazir !== null ? null : (kaliciHata ?? "kopuk");
    },

    sonEngel: () => sonEngel,

    hazirBekle: async (sinyal, surekli) => {
      for (;;) {
        if (kaliciHata !== null) return kaliciHata;
        if (hazir !== null) return null;
        if (durdu || sinyal.aborted || (!surekli && !denemede)) return "kopuk";
        await denemeBitisi(sinyal);
      }
    },

    istekYolla: (fiil, girdi, sinyal, ek = {}) => {
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
          JSON.stringify({ v: PROTOKOL_SURUMU, type: "istek", istek_id, fiil, girdi, ...ek }),
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

/** Servisin `detail`'i modele gitmez. `ek` yalnız köprünün kurduğu kısa metindir (alan yolu ve kural). */
function hataSonucu(code: HataKodu, ek?: string): CallToolResult {
  const text = ek === undefined || ek === "" ? `hata: ${code}` : `hata: ${code}\n${ek}`;
  return { isError: true, content: [{ type: "text", text }] };
}

type SemaSorunu = z.ZodError["issues"][number];

/** Modele en çok bu kadar sorun satırı gider; düzeltip yeniden çağırınca kalanı görür. */
const AZAMI_SORUN = 5;
/** Yol parçası, tür ve biçim adları yalnız bu kalıba uyarsa yazılır; uymayan `?` olur. */
const GUVENLI_AD = /^[A-Za-z0-9_]{1,40}$/;
const KURAL_METNI = 80;

const guvenliAd = (ad: unknown): string =>
  typeof ad === "number" ? String(ad) : typeof ad === "string" && GUVENLI_AD.test(ad) ? ad : "?";

const yolMetni = (yol: readonly PropertyKey[]): string =>
  yol.length === 0 ? "girdi" : yol.map(guvenliAd).join(".");

const birimli = (sinir: number | bigint, origin: string): string =>
  origin === "string" ? `${sinir} karakter` : origin === "array" ? `${sinir} öğe` : String(sinir);

/** Şemanın kuralı; girdideki değer hiç yazılmaz. `custom` iletileri protokolün sabit metinleridir. */
const kuralMetni = (s: SemaSorunu): string => {
  switch (s.code) {
    case "invalid_type":
      return `beklenen tür ${guvenliAd(s.expected)} (alan eksik olabilir)`;
    case "too_big":
      return `en çok ${birimli(s.maximum, s.origin)}`;
    case "too_small":
      return `en az ${birimli(s.minimum, s.origin)}`;
    case "invalid_format":
      return `biçim geçersiz (${guvenliAd(s.format)})`;
    case "invalid_value":
      return `izinli değerler: ${s.values.map((d) => guvenliAd(String(d))).join(", ")}`;
    case "custom":
      return s.message.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, KURAL_METNI);
    default:
      return "geçersiz";
  }
};

/** `gecersiz_mesaj` ekine: her satır `alan.yolu: kural`. Bilinmeyen anahtar kendi satırını alır. */
export const semaHatasiMetni = (sorunlar: readonly SemaSorunu[]): string => {
  const satirlar: string[] = [];
  for (const s of sorunlar) {
    if (s.code === "unrecognized_keys") {
      for (const k of s.keys) satirlar.push(`${yolMetni([...s.path, k])}: bilinmeyen alan, kaldır`);
    } else {
      satirlar.push(`${yolMetni(s.path)}: ${kuralMetni(s)}`);
    }
  }
  const tekil = [...new Set(satirlar)];
  const kesik = tekil.slice(0, AZAMI_SORUN);
  if (tekil.length > kesik.length) kesik.push(`(+${tekil.length - kesik.length} sorun daha)`);
  return kesik.join("\n");
};

/**
 * Servisin `plan_gecersiz` ayrıntısı modele yalnız bu listeden geçerse gider (`planlar.planOner`).
 * Şema kuralları köprüde zaten denetlenir; bunlar yalnız serviste anlaşılabilenlerdir.
 */
const PLAN_GECERSIZ_DETAYI: Readonly<Record<string, string>> = {
  cwd: "cwd: klasör bulunamadı",
  gorev_metni: "gorev_metni: komut satırına sığmıyor, kısalt",
};

const planGecersizDetayi = (detail: string | undefined): string | undefined =>
  detail !== undefined && Object.hasOwn(PLAN_GECERSIZ_DETAYI, detail) ? PLAN_GECERSIZ_DETAYI[detail] : undefined;

/** Başlama notunun kalıbı; `konusma-metin.planSonucuMetni` ile aynı. */
const baslamaNotu = (plan_id: string): string => `"İş <no> başladı (plan ${plan_id})."`;

/** `onay_bekliyor` nedeninin modele giden kısa açıklaması; asistan bunu kullanıcıya tek cümleyle aktarır. */
export const PLAN_BEKLEME_NEDENI_METNI: Readonly<Record<NonNullable<PlanOnerCikti["neden"]>, string>> = {
  tam_yetki_kapali: "PC'de tam yetki kapalı olduğu için onay bekliyor",
  kirli_kaynak: "plan telefondan okunan güvenilmez veriye dayandığı (kaynak kirli) için onay gerekiyor",
  tur_bitti: "kullanıcının turu bittiği ya da değiştiği için onay gerekiyor",
  limit_kilitli: "kullanım limiti kilitli olduğu için başlayamadı",
  baslatma_hatasi: "başlatma hatası yüzünden başlayamadı",
};

/**
 * Modele giden kısa ve doğru metin: iş başladı mı, telefonda mı, yoksa gerçekten onay mı bekliyor (ve
 * neden). Girdi protokolün `PlanOnerCikti`'sidir; `plan_hash` metne girmez, modele gitmez.
 */
export const planOnerMetni = ({ plan_id, durum, is_id, neden }: PlanOnerCikti): string => {
  switch (durum) {
    case "basladi":
      return (
        `plan_oner: iş başladı (${is_id === undefined ? "" : `iş ${is_id}, `}plan ${plan_id}). ` +
        'Kullanıcıya kısaca "başlattım" de; plan ya da onaydan söz etme.'
      );
    case "telefonda_baslatiliyor":
      return (
        `plan_oner: iş telefona gitti, telefonda başlatılıyor (plan ${plan_id}). Telefonda tam yetki ve ` +
        "uygulama açıksa kendiliğinden başlar, değilse kullanıcı telefonda onaylar; servis hangisi olduğunu " +
        `şu an bilemez. Başlayınca ${baslamaNotu(plan_id)} notu gelir. Kullanıcıya "telefonda başlatıyorum" de; ` +
        "onaydan yalnız iş başlamazsa söz et."
      );
    case "onay_bekliyor":
      return (
        `plan_oner: iş başlamadı, kullanıcının telefonda onayı bekleniyor (plan ${plan_id}). ` +
        (neden === undefined
          ? "Kullanıcıya bunu kısaca söyle. "
          : `Neden: ${PLAN_BEKLEME_NEDENI_METNI[neden]}. Kullanıcıya nedeni tek cümleyle söyle. `) +
        `Onaylanınca ${baslamaNotu(plan_id)} notu gelir.`
      );
  }
};

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
    if (fiil === "plan_oner") {
      const r = PlanOnerCikti.safeParse(ham);
      if (!r.success) return icHata(fiil);
      return metinSonucu(planOnerMetni(r.data));
    }
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
        return hataSonucu(
          y.code,
          fiil === "plan_oner" && y.code === "plan_gecersiz" ? planGecersizDetayi(y.detail) : undefined,
        );
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
    if (!girdi.success) return hataSonucu("gecersiz_mesaj", semaHatasiMetni(girdi.error.issues));
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

  return mcpBaslat(`eren-${ayar.rol}`, tools, aracCagir, boru, b);
}

/**
 * Araç listesi bağlantıya göre değişen kip (ajanda: servisin v3 araç yüzü). `listele` `tools/list`'te
 * çağrılır; `degisince` listenin değiştiğini bildirecek işlevi alır (`notifications/tools/list_changed`).
 */
interface DegisenAraclar {
  listele(): Promise<Tool[]>;
  degisince(bildir: () => void): void;
}

/** MCP sunucusunu kurar, boru döngüsünü başlatır; iki kip (`eren|soru|telefon` ve ajanda) için aynı. */
async function mcpBaslat(
  ad: string,
  tools: Tool[] | DegisenAraclar,
  aracCagir: (ad: string, ham: unknown, sinyal: AbortSignal, meta: unknown) => Promise<CallToolResult>,
  boru: BoruIstemci,
  b: KopruBagimliliklari,
): Promise<KopruCalisani> {
  const { gunluk } = b;
  const sabit = Array.isArray(tools);
  const server = new Server(
    { name: ad, version: "1.0.0" },
    { capabilities: { tools: sabit ? {} : { listChanged: true } } },
  );
  if (Array.isArray(tools)) {
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  } else {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await tools.listele() }));
    tools.degisince(() => {
      server.sendToolListChanged().catch(() => gunluk.uyari(MODUL, "arac_listesi_bildirilemedi"));
    });
  }
  // `notifications/cancelled` SDK'da `ekstra.signal`'i keser, oradan `iptal` çerçevesi çıkar.
  // `_meta` yalnız PC köprüsünde okunur (Claude Code'un çağrı kimliği); öteki kipler yok sayar.
  server.setRequestHandler(CallToolRequestSchema, (istek, ekstra) =>
    aracCagir(istek.params.name, istek.params.arguments, ekstra.signal, istek.params._meta),
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

// --- Ajanda kipi (`--rol ana_oturum`) -----------------------------------------------------------

const AJANDA_MCP_SUNUCU_ADI: AjandaMcpSunucuAdi = "eren-ajanda";

/**
 * Boru düzeyi hatanın modele giden kısa sabit metni (`isError`). Servisin `detail`'i hiç gitmez.
 * Kayıt yazılıp yazılmadığı kesin biliniyorsa söylenir; bilinmiyorsa listeye bakmaya yönlendirir.
 */
const AJANDA_HATA_EKI: Readonly<Partial<Record<HataKodu, string>>> = {
  tur_gecersiz: "ajanda: bu çağrı açık bir konuşma turuna bağlanamadı; hiçbir şey yazılmadı.",
  ic_hata: "ajanda: servis isteği tamamlayamadı; hiçbir şey yazılmadı.",
  belirsiz: "ajanda: bağlantı yanıttan önce koptu; yazılıp yazılmadığı bilinmiyor, ajanda_listele ile bak.",
  jeton_gecersiz: "ajanda: bu oturumun ajanda yetkisi yok.",
};

const ajandaHataSonucu = (code: HataKodu): CallToolResult => hataSonucu(code, AJANDA_HATA_EKI[code]);

/** Boru yok (servis kapalı ya da yeniden başlıyor): istek hiç çıkmadı. */
const AJANDA_KOPUK_SONUCU = (): CallToolResult =>
  hataSonucu("ic_hata", "ajanda: servise şu an ulaşılamıyor; hiçbir şey yazılmadı, biraz sonra yeniden dene.");

// --- PC köprüsü (`--rol pc_oturumu`; AJANDA.md "PC oturumları") ---------------------------------

/** Claude Code'un MCP `tools/call` isteğinde çağrı kimliğini taşıyan `_meta` anahtarı (kancadaki `tool_use_id`). */
export const CLAUDE_CODE_ARAC_KIMLIGI = "claudecode/toolUseId";
/** Boru hazır değilken çağrının yeniden bağlanmayı beklediği en uzun süre (servis yeniden başlıyor olabilir). */
export const PC_BAGLANTI_BEKLEME_MS = 3_000;
/** O bekleme içinde boru yokken iki deneme arası. */
const PC_YENIDEN_DENEME_MS = 250;

/**
 * PC köprüsünün bağlantısız metinleri (`isError`). Kayıt yazılmadığı kesindir; model kullanıcıya söyler,
 * yazılmamış kaydı "kaydettim" diye anlatmaz. Kuyruk yoktur (bilinçli: AJANDA.md "PC oturumları").
 */
export const PC_KOPUK_METNI =
  "ajanda: eren servisine şu an ulaşılamıyor (kapalı ya da yeniden başlıyor); hiçbir şey yazılmadı. " +
  "Kullanıcıya kaydın yazılmadığını söyle; biraz sonra yeniden dene.";
export const PC_ANAHTAR_YOK_METNI =
  "ajanda: bu bilgisayarda Claude Code ajanda anahtarı yok; hiçbir şey yazılmadı. Kullanıcıya söyle: " +
  "anahtar `eren eslestir --claude-code` ile üretilir.";
export const PC_ANAHTAR_GECERSIZ_METNI =
  "ajanda: Claude Code ajanda anahtarı geçersiz ya da kaldırılmış; hiçbir şey yazılmadı. Kullanıcıya söyle: " +
  "yeni anahtar `eren eslestir --claude-code` ile üretilir.";

/**
 * İlk `tools/list`'in süren bağlantı denemesinin karşılamasını en çok bekleyeceği süre (servis açıksa
 * milisaniyeler sürer); dolarsa ya da deneme yoksa v2 araç yüzü yayınlanır.
 */
export const ARAC_LISTESI_BEKLEME_MS = 3_000;

/**
 * Stdio köprünün ajanda kipi: `AJANDA_BORU_ADI`'na `ana_oturum` jetonuyla bağlanır, yalnız
 * `AJANDA_ROL_FIILLERI[rol]` araçlarını `jsonSemasi(ajandaAraclari(v3)[fiil].girdi)` ile yayınlar
 * (`outputSchema` yok); `description` sözleşmedeki `ajandaAracAciklamalari(v3)[fiil]`'dir (PC'de
 * `ajandaPcAracAciklamalari`), birebir (v2: gece sorusu ve günü adıyla söyleme kuralı orada durur, köprüde
 * ayrı metin yoktur). Girdi boruya çıkmadan şemayla denetlenir; sonuç `ajandaAraclari(v3)[fiil].cikti`
 * ile yeniden doğrulanır ve modele YALNIZ `ajandaMcpSonucu`'nun tek metin içeriği gider (çit her
 * çağrıda güvenli üreteçten, 128 bit). Bir kez gider, yeniden denenmez. Boru koparsa `eren` kipiyle
 * aynı aralıkla yeniden bağlanır.
 *
 * Araç yüzü (v2 ya da v3) servisin ayarıdır (`ajanda_arac_v3`), köprü onu her `kopru_welcome`'dan öğrenir
 * (`arac_v3`); hiç karşılanmadıysa v2. İlk `tools/list` süren denemenin karşılamasını bekler
 * (`ARAC_LISTESI_BEKLEME_MS`); yüz sonra değişirse (servis başka ayarla yeniden başladı)
 * `notifications/tools/list_changed` gider. Girdi ve çıktı her çağrıda o anki yüzün şemasıyla denetlenir:
 * eski listeye güvenip v3 alanı veren çağrı kapalı serviste "bilinmeyen alan" alır.
 */
export async function ajandaKopruCalistir(
  ayar: AjandaKopruIstemciAyari,
  b: KopruBagimliliklari,
): Promise<KopruCalisani> {
  const { gunluk, rastgele } = b;
  const pc = ayar.rol === "pc_oturumu";
  const fiiller: readonly AjandaFiili[] = AJANDA_ROL_FIILLERI[ayar.rol];
  const yuzKur = (acik: boolean): Tool[] => {
    const aciklamalar = pc ? ajandaPcAracAciklamalari(acik) : ajandaAracAciklamalari(acik);
    return fiiller.map((fiil) => ({
      name: fiil,
      description: aciklamalar[fiil],
      inputSchema: jsonSemasi(ajandaAraclari(acik)[fiil].girdi) as Tool["inputSchema"],
    }));
  };
  const yuzler = { v2: yuzKur(false), v3: yuzKur(true) };
  /** Son `kopru_welcome`'ın `arac_v3`'ü; hiç karşılanmadıysa `null` (v2 sayılır). */
  let v3: boolean | null = null;
  /** Modele en son verilen listenin yüzü; `null`: henüz listelenmedi. */
  let listelenen: boolean | null = null;
  let listeDegisti: (() => void) | null = null;
  const boru = boruIstemciKur(ayar, b, ajandaKopruAsagiCoz, (acik) => {
    v3 = acik;
    if (listelenen !== null && listelenen !== acik) {
      listelenen = acik;
      gunluk.bilgi(MODUL, "arac_yuzu_degisti", { arac_v3: acik });
      listeDegisti?.();
    }
  });
  const yuzAcik = (): boolean => v3 === true;
  const araclar = (): ReturnType<typeof ajandaAraclari> => ajandaAraclari(yuzAcik());
  const degisenAraclar = {
    listele: async (): Promise<Tool[]> => {
      if (v3 === null) {
        const sure = new AbortController();
        const zaman = setTimeout(() => sure.abort(), ARAC_LISTESI_BEKLEME_MS);
        try {
          await boru.hazirBekle(sure.signal, false);
        } finally {
          clearTimeout(zaman);
        }
      }
      listelenen = yuzAcik();
      return listelenen ? yuzler.v3 : yuzler.v2;
    },
    degisince: (bildir: () => void): void => {
      listeDegisti = bildir;
    },
  };
  const oturumId = ayar.oturumId !== undefined && OpakId.safeParse(ayar.oturumId).success ? ayar.oturumId : undefined;

  /** PC: `cagri` zarfı. Çağrı kimliği Claude Code'un `_meta`'sından; geçersizse yok (tur sentetik olur). */
  const pcCagri = (meta: unknown): Record<string, unknown> => {
    const id = typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>)[CLAUDE_CODE_ARAC_KIMLIGI] : undefined;
    const r = AracCagriId.safeParse(id);
    const cagri: AjandaPcCagri = {};
    if (r.success) cagri.arac_cagri_id = r.data;
    if (oturumId !== undefined) cagri.oturum_id = oturumId;
    return { cagri };
  };

  /**
   * PC: boru hazır değilse döngüyü uyandırıp en çok `PC_BAGLANTI_BEKLEME_MS` yeniden dener (servis yeniden
   * başlıyor olabilir). Anahtar yoksa ya da servis anahtarı reddettiyse beklemez: engel kesindir.
   */
  const pcHazirBekle = async (sinyal: AbortSignal): Promise<HataKodu | "kopuk" | null> => {
    const sure = new AbortController();
    const bitir = (): void => sure.abort();
    sinyal.addEventListener("abort", bitir, { once: true });
    void b.bekle(PC_BAGLANTI_BEKLEME_MS).then(bitir);
    const ara = Promise.withResolvers<void>();
    sure.signal.addEventListener("abort", () => ara.resolve(), { once: true });
    try {
      for (;;) {
        boru.uyandir();
        const r = await boru.denemeBekle(sure.signal);
        if (r !== "kopuk") return r;
        if (boru.sonEngel() !== null || sure.signal.aborted) return "kopuk";
        // Boru yok: kısa ara, sonra yeniden dene.
        await Promise.race([b.bekle(PC_YENIDEN_DENEME_MS), ara.promise]);
      }
    } finally {
      sinyal.removeEventListener("abort", bitir);
    }
  };

  /** PC: bağlantı yokken modele giden metin, engelin nedenine göre. Hepsinde "hiçbir şey yazılmadı". */
  const pcKopukSonucu = (): CallToolResult => {
    const engel = boru.sonEngel();
    if (engel === "anahtar_yok") return hataSonucu("jeton_gecersiz", PC_ANAHTAR_YOK_METNI);
    if (engel === "jeton_gecersiz") return hataSonucu("jeton_gecersiz", PC_ANAHTAR_GECERSIZ_METNI);
    return hataSonucu("ic_hata", PC_KOPUK_METNI);
  };
  const citUret = (): string => rastgele.hex64() + rastgele.hex64();

  const icHata = (fiil: string): CallToolResult => {
    gunluk.uyari(MODUL, "gecersiz_sonuc", { fiil });
    return ajandaHataSonucu("ic_hata");
  };

  /**
   * Tek yol: şemadan geçen çıktı → `ajandaMcpSonucu` → yalnız onun alanları. PC köprüsünde yanıt
   * `PcAracSonucu`'dur (çıktı + servisin tur kararı); sentetik kararda yazan araçların tek metnine sabit
   * `pcTurNotu` satırı eklenir (kaydın neden taslak doğduğu; kayıt metni taşımaz). Liste metnine eklenmez.
   */
  const sonucCevir = (fiil: AjandaFiili, ham: unknown): CallToolResult => {
    let govde = ham;
    let not: string | null = null;
    if (pc) {
      const s = PcAracSonucu.safeParse(ham);
      if (!s.success) return icHata(fiil);
      govde = s.data.cikti;
      if (fiil !== "ajanda_listele") not = pcTurNotu(s.data.karar);
    }
    const sema: z.ZodType = araclar()[fiil].cikti;
    const r = sema.safeParse(govde);
    if (!r.success) return icHata(fiil);
    const mcp = AjandaMcpSonucu.parse(ajandaMcpSonucu({ fiil, cikti: r.data } as AjandaAracCiktisi, citUret));
    const content: CallToolResult["content"] = not === null ? mcp.content : [{ type: "text", text: `${mcp.content[0].text}\n${not}` }];
    return mcp._meta === undefined ? { content } : { content, _meta: mcp._meta };
  };

  const aracCagir = async (ad: string, ham: unknown, sinyal: AbortSignal, meta: unknown): Promise<CallToolResult> => {
    const fiil = fiiller.find((f) => f === ad);
    if (fiil === undefined) return hataSonucu("rol_fiil_izinsiz");
    // Servis şemaya uymayan çerçevede boruyu kapatır: bozuk girdi boruya çıkmamalı. Şema o anki yüzün.
    const denetle = () => (araclar()[fiil].girdi as z.ZodType).safeParse(ham ?? {});
    let girdi = denetle();
    if (!girdi.success) return hataSonucu("gecersiz_mesaj", semaHatasiMetni(girdi.error.issues));
    const kopuk = pc ? pcKopukSonucu : AJANDA_KOPUK_SONUCU;
    try {
      const once = yuzAcik();
      const engel = pc ? await pcHazirBekle(sinyal) : await boru.hazirBekle(sinyal, false);
      if (pc && sinyal.aborted) return iptalSonucu();
      if (engel !== null) return engel === "kopuk" ? kopuk() : ajandaHataSonucu(engel);
      // Beklerken yeniden karşılandı ve yüz değişti: yeni yüzün şemasıyla yeniden denetlenir.
      if (yuzAcik() !== once) {
        girdi = denetle();
        if (!girdi.success) return hataSonucu("gecersiz_mesaj", semaHatasiMetni(girdi.error.issues));
      }
      const y = await boru.istekYolla(fiil, girdi.data, sinyal, pc ? pcCagri(meta) : undefined);
      switch (y.tur) {
        case "basari":
          return sonucCevir(fiil, y.sonuc);
        case "hata":
          return pc && y.code === "jeton_gecersiz" ? hataSonucu(y.code, PC_ANAHTAR_GECERSIZ_METNI) : ajandaHataSonucu(y.code);
        case "koptu":
          // PC: anahtar istek sırasında iptal edildiyse servis `kopru_ret` verip kapatır.
          return pc && boru.sonEngel() === "jeton_gecersiz" ? hataSonucu("jeton_gecersiz", PC_ANAHTAR_GECERSIZ_METNI) : ajandaHataSonucu("belirsiz");
        case "yollanmadi":
          return kopuk();
        case "iptal":
          return iptalSonucu();
      }
    } catch {
      return icHata(fiil);
    }
  };

  return mcpBaslat(AJANDA_MCP_SUNUCU_ADI, degisenAraclar, aracCagir, boru, b);
}

function soketBaglantisi(soket: Socket, azamiSatir: number = AZAMI_CERCEVE.KOPRU): BoruBaglantisi {
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
          if (bayt + son - bas > azamiSatir) {
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
        if (bayt > azamiSatir) {
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

function boruyaBaglan(ad: string, azamiSatir: number = AZAMI_CERCEVE.KOPRU): Promise<BoruBaglantisi> {
  return new Promise((coz, reddet) => {
    const soket = connect(ad);
    soket.once("error", reddet);
    soket.once("connect", () => {
      soket.off("error", reddet);
      // Hatanın ardından `close` gelir, kapanışı o bildirir.
      soket.on("error", () => {});
      coz(soketBaglantisi(soket, azamiSatir));
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

/**
 * PC anahtar dosyası (`<veri kökü>\ajanda-pc.anahtar`, `eslestir --claude-code` yazar). Her çağrıda
 * yeniden okunur; yoksa, okunamazsa ya da biçimi geçersizse `null`.
 */
function pcAnahtariOku(): string | null {
  const kok = veriKokuCoz(process.env);
  if (!kok.ok) return null;
  try {
    const j = Jeton.safeParse(readFileSync(ajandaPcAnahtarYolu(kok.kok), "utf8").trim());
    return j.success ? j.data : null;
  } catch {
    return null;
  }
}

async function giris(): Promise<void> {
  const argumanlar = process.argv.slice(2);
  const i = argumanlar.indexOf("--rol");
  const rolArgumani = i >= 0 ? argumanlar[i + 1] : undefined;
  const rol = KopruRolu.safeParse(rolArgumani);
  const ajandaRol = AjandaKopruRolu.safeParse(rolArgumani);
  const pcKoprusu = ajandaRol.success && ajandaRol.data === "pc_oturumu";
  // PC köprüsünün jetonu ortamdan değil anahtar dosyasından gelir (her denemede yeniden okunur).
  const jeton = pcKoprusu ? { success: true as const, data: "" } : Jeton.safeParse(process.env.EREN_KOPRU_JETON);
  if (!jeton.success || (!rol.success && !ajandaRol.success) || (ajandaRol.success && ajandaRol.data === "pc_kanca")) {
    process.stderr.write(
      "kullanim: kopru --rol eren|soru|telefon|ana_oturum (jeton EREN_KOPRU_JETON'da) | --rol pc_oturumu (Claude Code kancası: kanca.ts)\n",
    );
    process.exitCode = 2;
    return;
  }
  const ortak = (baglan: KopruBagimliliklari["baglan"]): KopruBagimliliklari => ({
    transport: new StdioServerTransport(),
    baglan,
    rastgele: {
      opakId: (on) => `${on}_${randomBytes(16).toString("base64url")}`,
      hex64: () => randomBytes(8).toString("hex"),
    },
    gunluk: stderrGunluk(),
    bekle: (ms) => new Promise((coz) => setTimeout(coz, ms)),
  });
  const calisan = rol.success
    ? await kopruCalistir(
        { rol: rol.data, jeton: jeton.data, boruAdi: KOPRU_BORU_ADI },
        ortak(boruyaBaglan),
      )
    : ajandaRol.success
      ? await ajandaKopruCalistir(
          pcKoprusu
            ? {
                rol: ajandaRol.data,
                jeton: "",
                boruAdi: AJANDA_BORU_ADI,
                jetonOku: pcAnahtariOku,
                oturumId: process.env.CLAUDE_CODE_SESSION_ID ?? `pck_${randomBytes(16).toString("base64url")}`,
              }
            : { rol: ajandaRol.data, jeton: jeton.data, boruAdi: AJANDA_BORU_ADI },
          ortak((ad) => boruyaBaglan(ad, AJANDA_AZAMI_CERCEVE.BORU)),
        )
      : null;
  if (calisan === null) return;
  // `StdioServerTransport` stdin'in bitişini izlemez; izlenmezse model ölünce köprü yetim kalır.
  const bitir = (): void => void calisan.kapat();
  process.stdin.once("end", bitir);
  process.stdin.once("close", bitir);
  process.stdout.once("error", bitir);
  await calisan.kapandi;
  process.exit(0);
}

if (import.meta.main) await giris();
