/**
 * Bellekte `AjandaEkDiski` (ek yedeği çekirdeğinin testleri). Gerçek portun sözleşmesini taklit eder:
 * özet olmayan değer atar, yarımın onaylı uzunluğu ayrı tutulur (onaysız kuyruk çökme taklidi), her
 * çağrı `cagrilar`'a yazılır. sha256 protokolün saf işlevinden.
 */
import { sha256Hex } from "@eren/protocol";
import type { AjandaEkDiski, AjandaEkIsareti, AjandaEkYarimi } from "../src/ajanda-ekler.ts";

const OZET = /^[0-9a-f]{64}$/;

export interface SahteYarim {
  veri: Uint8Array;
  onay: number;
  degisme_ms: number;
}

export interface SahteEkDiski {
  disk: AjandaEkDiski;
  tamlar: Map<string, Uint8Array>;
  yarimlar: Map<string, SahteYarim>;
  isaretler: Map<string, AjandaEkIsareti>;
  /** `"yontem"` ya da `"yontem:<ozet>"`; özetin geçtiği her çağrı. */
  cagrilar: string[];
  /** Adı verilen yöntem bir sonraki çağrıda atar (bir kez). */
  atsin: Set<string>;
  /**
   * Okunamayan önek dizini taklidi: bu öneklerle başlayan tam dosyalar `tamListesi`'nde görünmez, her önek
   * için `okunamadi` bir kez çağrılır (gerçek port gibi).
   */
  okunamayanOnekler: Set<string>;
}

const birlesik = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
};

export function sahteEkDiski(simdi: () => number): SahteEkDiski {
  const tamlar = new Map<string, Uint8Array>();
  const yarimlar = new Map<string, SahteYarim>();
  const isaretler = new Map<string, AjandaEkIsareti>();
  const cagrilar: string[] = [];
  const atsin = new Set<string>();
  const okunamayanOnekler = new Set<string>();

  const giris = (yontem: string, ozet?: string): void => {
    cagrilar.push(ozet === undefined ? yontem : `${yontem}:${ozet}`);
    if (atsin.delete(yontem)) throw new Error("sahte_disk_hatasi");
    if (ozet !== undefined && !OZET.test(ozet)) throw new Error("gecersiz_ozet");
  };

  const durum = (ozet: string): number | null => {
    const y = yarimlar.get(ozet);
    if (y === undefined) return null;
    if (y.veri.length > y.onay) y.veri = y.veri.slice(0, y.onay);
    return y.onay;
  };

  const disk: AjandaEkDiski = {
    tamBoyutu: async (ozet) => {
      giris("tamBoyutu", ozet);
      return tamlar.get(ozet)?.length ?? null;
    },
    tamOku: async (ozet, ofset, azami) => {
      giris("tamOku", ozet);
      return (tamlar.get(ozet) ?? new Uint8Array(0)).slice(ofset, ofset + azami);
    },
    tamOzeti: async (ozet) => {
      giris("tamOzeti", ozet);
      const v = tamlar.get(ozet);
      if (v === undefined) throw new Error("tam_yok");
      return { bayt: v.length, ozet: sha256Hex(v) };
    },
    tamSil: async (ozet) => {
      giris("tamSil", ozet);
      tamlar.delete(ozet);
    },
    tamListesi: async (okunamadi) => {
      giris("tamListesi");
      for (const _ of okunamayanOnekler) okunamadi?.(Object.assign(new Error("EPERM"), { name: "Error" }));
      return [...tamlar]
        .filter(([ozet]) => !okunamayanOnekler.has(ozet.slice(0, 2)))
        .map(([ozet, v]) => ({ ozet, bayt: v.length }));
    },
    yarimDurumu: async (ozet) => {
      giris("yarimDurumu", ozet);
      return durum(ozet);
    },
    yarimaEkle: async (ozet, ofset, veri) => {
      giris("yarimaEkle", ozet);
      const mevcut = durum(ozet) ?? 0;
      if (mevcut !== ofset) throw new Error("ofset_uyusmuyor");
      const y = yarimlar.get(ozet) ?? { veri: new Uint8Array(0), onay: 0, degisme_ms: 0 };
      y.veri = birlesik(y.veri, veri);
      y.onay = y.veri.length;
      y.degisme_ms = simdi();
      yarimlar.set(ozet, y);
      return y.onay;
    },
    yarimOzeti: async (ozet) => {
      giris("yarimOzeti", ozet);
      const n = durum(ozet) ?? 0;
      const v = yarimlar.get(ozet)?.veri ?? new Uint8Array(0);
      return { bayt: n, ozet: sha256Hex(v) };
    },
    yarimiTamamla: async (ozet) => {
      giris("yarimiTamamla", ozet);
      const y = yarimlar.get(ozet);
      if (y === undefined) throw new Error("yarim_yok");
      if (!tamlar.has(ozet)) tamlar.set(ozet, y.veri);
      yarimlar.delete(ozet);
    },
    yarimSil: async (ozet) => {
      giris("yarimSil", ozet);
      yarimlar.delete(ozet);
    },
    yarimListesi: async () => {
      giris("yarimListesi");
      return [...yarimlar].map(([ozet, y]): AjandaEkYarimi => ({ ozet, bayt: y.veri.length, degisme_ms: y.degisme_ms }));
    },
    isaretleriOku: async () => {
      giris("isaretleriOku");
      return new Map(isaretler);
    },
    isaretleriYaz: async (m) => {
      giris("isaretleriYaz");
      // Gerçek port gibi: özet olmayan anahtar ya da geçersiz değer atar, hiçbir şey yazılmaz.
      for (const [k, v] of m) {
        if (!OZET.test(k)) throw new Error("gecersiz_ozet");
        // Gerçek port gibi: eksi gözlenen süre, eksi ya da tam sayı olmayan `rev` de atar (okuyucu onları
        // 0/`null` sayardı; yazılan değer okunanla aynı kalmalı).
        const revGecerli = v.rev === null || (Number.isSafeInteger(v.rev) && v.rev >= 0);
        if (!Number.isFinite(v.ilk_ms) || !Number.isFinite(v.gozlenen_ms) || v.gozlenen_ms < 0 || !revGecerli) {
          throw new Error("gecersiz_isaret");
        }
      }
      isaretler.clear();
      for (const [k, v] of m) isaretler.set(k, { ...v });
    },
  };
  return { disk, tamlar, yarimlar, isaretler, cagrilar, atsin, okunamayanOnekler };
}
