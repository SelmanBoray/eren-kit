/**
 * Token tüketim raporunun istek-yanıt durum makinesi. Telefon `usage_request` yollar, PC servisi
 * `usage_report` ile aynı `istek_id` üzerinden yanıtlar. Burada yalnız durum vardır: kablo çağırana
 * (`gonder`), zaman `SaatPortu`'na aittir. Tek bekleyen istek; zaman aşımı 15 sn; son rapor 10 sn
 * içindeyse yeniden istenmez. Ağdan okunan değer yoktur, kalıcı bir şey saklanmaz (bellek).
 */
import { SOHBET_SURUMU, type UsageReport } from "@eren/protocol";
import type { UsageRequest } from "./baglanti.ts";
import type { IptalEt, SaatPortu, TuketimDurumu, TuketimRaporu } from "./sozlesme.ts";

/** Bekleyen isteğe yanıt gelmezse `hata` olur. */
export const TUKETIM_ZAMAN_ASIMI_MS = 15_000;
/** Eldeki rapor bundan yeniyse `iste` yeni istek yollamaz. */
export const TUKETIM_TAZE_MS = 10_000;

export interface TuketimBagimliliklari {
  saat: SaatPortu;
  /** İsteği yolda mı bıraktı: `false` (bağlı değil vb.) ise hiçbir şey olmamış sayılır. */
  gonder: (m: UsageRequest) => boolean;
  /** Durum her değiştiğinde bir kez; ekran `durum()`'u okur. */
  bildir: () => void;
}

export interface Tuketim {
  /**
   * Yeni istek yollandıysa `true`; bekleyen var, rapor taze ya da `gonder` reddetti ise `false`.
   * `zorla === true` taze rapor kuralını atlar; bekleyen istek varken yine yollamaz.
   */
  iste(zorla?: boolean): boolean;
  /** `usage_report` çerçevesi; yalnız bekleyen `istek_id` ile eşleşirse kabul edilir. */
  rapor(c: UsageReport): void;
  /** Bağlantı koptu: bekleyen istek düşer, eldeki rapor (varsa) `hazir` kalır. */
  koptu(): void;
  durum(): TuketimDurumu;
}

export type TuketimFabrikasi = (b: TuketimBagimliliklari) => Tuketim;

export const tuketimKur: TuketimFabrikasi = ({ saat, gonder, bildir }) => {
  let sayac = 0;
  let bekleyen: string | null = null;
  let zamanlayici: IptalEt | null = null;
  let hata = false;
  // Eldeki son rapor ve alındığı an; bekleme ve hata durumlarında da korunur.
  let rapor: TuketimRaporu | null = null;
  let alindiMs = 0;

  const zamanlayiciyiIptalEt = (): void => {
    if (zamanlayici !== null) {
      const iptal = zamanlayici;
      zamanlayici = null;
      iptal();
    }
  };

  const durum = (): TuketimDurumu => {
    if (bekleyen !== null) return { durum: "bekleniyor", rapor };
    if (hata) return { durum: "hata", rapor };
    if (rapor !== null) return { durum: "hazir", rapor, alindiMs };
    return { durum: "yok" };
  };

  return {
    iste: (zorla) => {
      if (bekleyen !== null) return false;
      if (zorla !== true && rapor !== null && saat.simdiMs() - alindiMs < TUKETIM_TAZE_MS) return false;
      sayac++;
      const id = `tuketim-${sayac}`;
      // Yanıt `gonder` dönmeden gelirse eşleşebilsin diye bekleyen önceden kurulur.
      const onceki = hata;
      bekleyen = id;
      hata = false;
      let yollandi = false;
      try {
        yollandi = gonder({ v: SOHBET_SURUMU, type: "usage_request", istek_id: id });
      } finally {
        if (!yollandi && bekleyen === id) {
          bekleyen = null;
          hata = onceki;
        }
      }
      if (!yollandi) return false;
      // Yanıt ya da kopma `gonder` içinde geldiyse iş bitmiştir; zamanlayıcı kurulmaz.
      if (bekleyen === id) {
        zamanlayici = saat.sonra(TUKETIM_ZAMAN_ASIMI_MS, () => {
          if (bekleyen !== id) return;
          zamanlayici = null;
          bekleyen = null;
          hata = true;
          bildir();
        });
        bildir();
      }
      return true;
    },

    rapor: (c) => {
      if (bekleyen === null || c.istek_id !== bekleyen) return;
      zamanlayiciyiIptalEt();
      const { v: _v, type: _tur, istek_id: _id, ...govde } = c;
      rapor = govde;
      alindiMs = saat.simdiMs();
      bekleyen = null;
      hata = false;
      bildir();
    },

    koptu: () => {
      if (bekleyen === null && !hata) return;
      zamanlayiciyiIptalEt();
      bekleyen = null;
      hata = false;
      bildir();
    },

    durum,
  };
};
