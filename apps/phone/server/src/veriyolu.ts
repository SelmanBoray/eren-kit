/**
 * `ServisOlaylari`'nı taşıyan eşzamanlı yayın. Dinleyiciler kayıt sırasıyla çalışır; atan dinleyici
 * günlüğe yazılır, sıradakini durdurmaz, yayınlayana hata dönmez. MODULLER.md, "veriyolu".
 */
import type { ServisOlayAdi, VeriyoluFabrikasi } from "./sozlesme.ts";

interface Kayit {
  readonly f: (veri: never) => unknown;
  silindi: boolean;
}

export const veriyoluKur: VeriyoluFabrikasi = ({ gunluk }) => {
  const dinleyiciler = new Map<ServisOlayAdi, Kayit[]>();

  const hataYaz = (olay: string, e: unknown): void => {
    try {
      gunluk.hata("veriyolu", "dinleyici_hata", {
        olay,
        hata_turu: e instanceof Error ? e.name : typeof e,
      });
    } catch {
      // günlük de atarsa yayın yine bozulmaz
    }
  };

  return {
    yayinla(ad, veri) {
      const liste = dinleyiciler.get(ad);
      if (liste === undefined) return;
      // Anlık görüntü: yayın sırasında eklenen dinleyici bu yayını görmez.
      for (const k of liste.slice()) {
        if (k.silindi) continue;
        try {
          const sonuc = (k.f as (v: unknown) => unknown)(veri);
          if (sonuc !== null && typeof sonuc === "object" && typeof (sonuc as { then?: unknown }).then === "function") {
            (sonuc as Promise<unknown>).then(undefined, (e: unknown) => hataYaz(ad, e));
          }
        } catch (e) {
          hataYaz(ad, e);
        }
      }
    },
    dinle(ad, f) {
      const k: Kayit = { f: f as (veri: never) => unknown, silindi: false };
      const liste = dinleyiciler.get(ad);
      if (liste === undefined) dinleyiciler.set(ad, [k]);
      else liste.push(k);
      return () => {
        if (k.silindi) return;
        k.silindi = true;
        const l = dinleyiciler.get(ad);
        if (l === undefined) return;
        const i = l.indexOf(k);
        if (i >= 0) l.splice(i, 1);
        if (l.length === 0) dinleyiciler.delete(ad);
      };
    },
  };
};
