/**
 * `eren-device` yerel modülüne tek geçit. Modül yoksa (iPad, geliştirme, Expo Go) her çağrı
 * `desteklenmiyor` verir; ekranlar yine açılır.
 */
import type {
  AyarHedefi,
  CihazDurumu,
  DikteSonucu,
  EslesmeBilgisi,
  EslestirSonucu,
  ErenDeviceModulu,
  IzinIsteSonucu,
  KisayolMesaji,
  OtoIzinSonucu,
} from "../../modules/eren-device/src/ErenDevice.types.ts";
import type { KimlikPortu, SesPortu } from "../cekirdek/sozlesme.ts";

export type Desteklenmiyor = { desteklenmiyor: true };
export type Sonuc<T> = { ok: true; deger: T } | { ok: false; neden: "desteklenmiyor" | "hata" };

export interface ErenCihaz {
  desteklenir: boolean;
  durum(): Promise<Sonuc<CihazDurumu>>;
  eslesme(): Promise<EslesmeBilgisi | null>;
  eslestir(): Promise<Sonuc<EslestirSonucu>>;
  izinIste(plan_json: string, plan_hash: string): Promise<Sonuc<IzinIsteSonucu>>;
  ayarAc(hedef: AyarHedefi): Promise<Sonuc<true>>;
  dikte(): Promise<Sonuc<DikteSonucu>>;
  tanilamaAc(): Promise<Sonuc<true>>;
  uygulamaListesiAc(): Promise<Sonuc<true>>;
  denetimAc(grant_id?: string): Promise<Sonuc<true>>;
  otoIzin(plan_json: string, plan_hash: string): Promise<Sonuc<OtoIzinSonucu>>;
  tamYetkiAc(): Promise<Sonuc<"acildi" | "iptal">>;
  tamYetkiKapat(): Promise<Sonuc<true>>;
  kisayolAl(): Promise<Sonuc<KisayolMesaji | null>>;
  kisayolTuket(id: string): Promise<Sonuc<true>>;
  sesKisayoluKur(): Promise<Sonuc<"kuruldu" | "yetki_yok" | "hata">>;
  kisayolKutucuguEkle(): Promise<Sonuc<"eklendi" | "zaten" | "reddedildi" | "desteklenmiyor">>;
  /** `kisayolGeldi` olayına abone olur; modül yoksa ya da hata olursa boş kapatıcı döner. */
  kisayolGeldiDinle(f: (veri: { id: string }) => void): () => void;
  /** Sohbet çekirdeğinin kimlik portu; modül yoksa eşleşme `null` döner. */
  kimlikPortu(): KimlikPortu;
  /** Sohbet çekirdeğinin ses portu (cevabı sesli okur); modül yoksa hiçbir çağrı patlamaz. */
  sesPortu(): SesPortu;
}

type Modul = ErenDeviceModulu;

const modulYukle = (): Modul | null => {
  try {
    // Dinamik require: modül derlemede yoksa uygulama yine açılır.
    const { requireOptionalNativeModule } = require("expo-modules-core") as {
      requireOptionalNativeModule: (ad: string) => unknown;
    };
    return (requireOptionalNativeModule("ErenDevice") as Modul | null) ?? null;
  } catch {
    return null;
  }
};

const yok = { ok: false, neden: "desteklenmiyor" } as const;

export const erenCihazKur = (): ErenCihaz => {
  const m = modulYukle();
  const sar = async <T>(f: (m: Modul) => Promise<T>): Promise<Sonuc<T>> => {
    if (m === null) return yok;
    try {
      return { ok: true, deger: await f(m) };
    } catch {
      return { ok: false, neden: "hata" };
    }
  };
  return {
    desteklenir: m !== null,
    durum: () => sar((x) => x.durum()),
    eslesme: async () => {
      if (m === null) return null;
      try {
        return await m.eslesme();
      } catch {
        return null;
      }
    },
    eslestir: () => sar((x) => x.eslestir()),
    izinIste: (j, h) => sar((x) => x.izinIste(j, h)),
    ayarAc: (h) => sar(async (x) => (await x.ayarAc(h), true as const)),
    dikte: () => sar((x) => x.dikte()),
    tanilamaAc: () => sar(async (x) => (await x.tanilamaAc(), true as const)),
    uygulamaListesiAc: () => sar(async (x) => (await x.uygulamaListesiAc(), true as const)),
    denetimAc: (g) => sar(async (x) => (await x.denetimAc(g), true as const)),
    otoIzin: (j, h) => sar((x) => x.otoIzin(j, h)),
    tamYetkiAc: () => sar((x) => x.tamYetkiAc()),
    tamYetkiKapat: () => sar(async (x) => (await x.tamYetkiKapat(), true as const)),
    kisayolAl: () => sar((x) => x.kisayolAl()),
    kisayolTuket: (id) => sar(async (x) => (await x.kisayolTuket(id), true as const)),
    sesKisayoluKur: () => sar((x) => x.sesKisayoluKur()),
    kisayolKutucuguEkle: () => sar((x) => x.kisayolKutucuguEkle()),
    kisayolGeldiDinle: (f) => {
      if (m === null) return () => {};
      try {
        const ab = m.addListener("kisayolGeldi", f) as unknown;
        if (typeof ab === "function") return ab as () => void;
        const kapat = (ab as { remove?: () => void } | null)?.remove;
        return typeof kapat === "function" ? () => (ab as { remove: () => void }).remove() : () => {};
      } catch {
        return () => {};
      }
    },
    sesPortu: () => ({
      seslendir: async (metin) => {
        if (m === null) return false;
        try {
          return (await m.seslendir(metin, "tr-TR")) === true;
        } catch {
          return false;
        }
      },
      durdur: async () => {
        if (m === null) return;
        try {
          await m.seslendirmeyiDurdur();
        } catch {
          // Sessizce dön: durdurma asla reddetmez.
        }
      },
      durumDinle: (f) => {
        if (m === null) return () => {};
        try {
          const ab = m.addListener("seslendirmeDurumu", (v) => f(v.konusuyor === true)) as unknown;
          if (typeof ab === "function") return ab as () => void;
          const kapat = (ab as { remove?: () => void } | null)?.remove;
          return typeof kapat === "function" ? () => (ab as { remove: () => void }).remove() : () => {};
        } catch {
          return () => {};
        }
      },
    }),
    kimlikPortu: () => ({
      eslesme: async () => {
        if (m === null) return null;
        return m.eslesme();
      },
      sohbetHello: async () => {
        if (m === null) throw new Error("desteklenmiyor");
        return m.sohbetHello();
      },
      sohbetSinama: async (o, n, s) => {
        if (m === null) throw new Error("desteklenmiyor");
        return m.sohbetSinama(o, n, s);
      },
    }),
  };
};
