/**
 * Ses portunun sarmalayıcısı: Markdown cevabı `konusmaMetni` ile düz metne çevirip okur, okumayı
 * keser ve portun bildirdiği "okuma sürüyor" bilgisini tutar. Portun hiçbir hatası (atma, reddetme)
 * dışarı çıkmaz.
 *
 * Sıra: `durdur` porta hemen gider; sonuçlanmamış bir `seslendir` isteğini (yerel taraf motor hazır
 * olana dek bekletebilir) beklemez. Yerel taraf `durdur`'da ve yeni istekte bekleyeni `false` ile
 * bitirir. Yeni `seslendir` ise kendi `durdur`'u ve önceki `seslendir` sonuçlanınca çağrılır: iki
 * okuma isteği iç içe girmez. Arada yeni bir `oku`/`durdur` gelmişse eski okuma hiç başlamaz.
 * `seslendir`'in sonucu durumu etkilemez; `konusuyor` yalnız `durumDinle`'den gelir.
 */
import { konusmaMetni } from "./konusmaMetni.ts";
import type { SesPortu } from "./sozlesme.ts";

export interface Seslendirici {
  /** Okunacak metin boşsa hiçbir şey yapmaz; değilse süren okumayı keser ve bunu okur. */
  oku(markdown: string): void;
  /** Süren ya da sırada bekleyen okumayı keser. */
  durdur(): void;
  /** Port son bildiriminde okuma sürüyor dedi. */
  konusuyor(): boolean;
}

export interface SeslendiriciBagimliliklari {
  ses: SesPortu;
  /** `konusuyor()` değişti. */
  degisti(): void;
}

export type SeslendiriciFabrikasi = (b: SeslendiriciBagimliliklari) => Seslendirici;

/** Port çağrısını yutar: eşzamanlı atma da reddetme de. */
const guvenli = async (f: () => Promise<unknown>): Promise<void> => {
  try {
    await f();
  } catch {
    // Ses portunun hatası sohbet akışını bozmaz.
  }
};

export const seslendiriciKur: SeslendiriciFabrikasi = ({ ses, degisti }) => {
  let konusuyor = false;
  // Her `oku`/`durdur` artırır: sırada bekleyen eski okuma başlamaz.
  let nesil = 0;
  // Son `seslendir` isteğinin (ve onu bekleyen adımların) sonuçlanması; asla reddetmez.
  let sonOkuma: Promise<void> = Promise.resolve();

  const durdurGonder = (): Promise<void> => guvenli(() => ses.durdur());

  try {
    ses.durumDinle((k) => {
      if (k === konusuyor) return;
      konusuyor = k;
      degisti();
    });
  } catch {
    // Durum dinlenemezse `konusuyor` hep `false` kalır; okuma yine çalışır.
  }

  return {
    oku: (markdown) => {
      let metin: string;
      try {
        metin = konusmaMetni(markdown).trim();
      } catch {
        return;
      }
      if (metin === "") return;
      const n = ++nesil;
      const durdu = durdurGonder();
      const onceki = sonOkuma;
      sonOkuma = (async () => {
        await durdu;
        await onceki;
        if (n !== nesil) return;
        await guvenli(() => ses.seslendir(metin));
      })();
    },

    durdur: () => {
      nesil++;
      void durdurGonder();
    },

    konusuyor: () => konusuyor,
  };
};
