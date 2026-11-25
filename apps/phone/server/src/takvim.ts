import type { AjandaYerelAn } from "@eren/protocol";
import type { TakvimFabrikasi } from "./sozlesme.ts";

/**
 * Saat dilimi portu (`TakvimPortu`). Dilim veritabanı `Intl`'dir ve servis içinde YALNIZ burada
 * kullanılır (MODULLER.md A0.4). Sistemin dilimini `ana` verir (`sistemDilimi`), her çağrıda yeniden okunur.
 *
 * Duvar saatinden ana çeviri java.time `ZonedDateTime.of(LocalDateTime, ZoneId)` kuralıdır (uygulama da
 * onu kullanır): geçerli tek ofset varsa o; yaz saati çakışmasında önceki (geçişten önceki, büyük)
 * ofset, yani erken an; boşlukta saat boşluk kadar ileri alınır, yani an = duvar saati − geçişten
 * önceki ofset. Ofset saniye çözünürlüğünde ölçülür (1900'lerin yerel ortalama saatleri saniyeli).
 */

const DAKIKA_MS = 60_000;
const GUN_MS = 86_400_000;
const TARIH = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

const iki = (n: number): string => String(n).padStart(2, "0");

export const takvimKur: TakvimFabrikasi = (b) => {
  /** Dilim başına biçimleyici (fabrika ömrü boyunca); yalnız bilinen dilimler girer. */
  const bicimleyiciler = new Map<string, Intl.DateTimeFormat>();
  /** `Intl`'in kanonik adları: büyük/küçük harf denetimi için (java.time adları harfe duyarlıdır). */
  let kanonikler: Map<string, string> | undefined;

  const kanonikAdlar = (): Map<string, string> => {
    if (kanonikler === undefined) {
      kanonikler = new Map();
      for (const ad of Intl.supportedValuesOf("timeZone")) kanonikler.set(ad.toLowerCase(), ad);
    }
    return kanonikler;
  };

  const dilimBiliniyorMu = (ad: string): boolean => {
    if (typeof ad !== "string" || ad.length === 0) return false;
    if (bicimleyiciler.has(ad)) return true;
    // `Intl` ofset biçimini ("+03:00") de kabul eder; o bir dilim adı değildir.
    if (!/^[A-Za-z]/.test(ad)) return false;
    let f: Intl.DateTimeFormat;
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: ad,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return false;
    }
    // `Intl` harfe duyarsızdır ("europe/istanbul"), uygulamanın `ZoneId.of`'u değil: kanonik adın
    // harf farkı reddedilir. Takma adlar ("Etc/UTC", "US/Eastern") kanoniğe çevrilir, onlar kalır.
    const cozulen = f.resolvedOptions().timeZone;
    const kanonik = kanonikAdlar().get(ad.toLowerCase()) ?? (cozulen.toLowerCase() === ad.toLowerCase() ? cozulen : undefined);
    if (kanonik !== undefined && kanonik !== ad) return false;
    bicimleyiciler.set(ad, f);
    return true;
  };

  const bicimleyici = (ad: string): Intl.DateTimeFormat => {
    if (!dilimBiliniyorMu(ad)) throw new RangeError("takvim: bilinmeyen saat dilimi");
    return bicimleyiciler.get(ad) as Intl.DateTimeFormat;
  };

  /** Anın dilimdeki duvar saati, saniye çözünürlüğünde, "UTC'deymiş gibi" epoch ms. */
  const duvar = (f: Intl.DateTimeFormat, ms: number): number => {
    const p: Record<string, number> = {};
    for (const parca of f.formatToParts(new Date(ms))) {
      if (parca.type !== "literal") p[parca.type] = Number(parca.value);
    }
    const tarih = new Date(0);
    tarih.setUTCFullYear(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1);
    tarih.setUTCHours(p.hour ?? 0, p.minute ?? 0, p.second ?? 0, 0);
    return tarih.getTime();
  };

  /** Anda geçerli ofset (ms, saniyeye yuvarlı an üzerinden). */
  const ofset = (f: Intl.DateTimeFormat, ms: number): number => {
    const saniye = Math.floor(ms / 1000) * 1000;
    return duvar(f, saniye) - saniye;
  };

  return {
    kullaniciDilimi: () => b.sistemDilimi(),

    dilimBiliniyorMu,

    yerelAn(ms, saat_dilimi): AjandaYerelAn {
      const f = bicimleyici(saat_dilimi);
      if (!Number.isFinite(ms)) throw new RangeError("takvim: geçersiz an");
      const d = new Date(duvar(f, Math.floor(ms / DAKIKA_MS) * DAKIKA_MS));
      return {
        tarih: `${String(d.getUTCFullYear()).padStart(4, "0")}-${iki(d.getUTCMonth() + 1)}-${iki(d.getUTCDate())}`,
        saat: `${iki(d.getUTCHours())}:${iki(d.getUTCMinutes())}`,
        saat_dilimi,
      };
    },

    anCevir(tarih, saat, saat_dilimi) {
      const f = bicimleyici(saat_dilimi);
      const g = TARIH.exec(tarih);
      const s = SAAT.exec(saat);
      if (g === null || s === null) throw new RangeError("takvim: bozuk tarih ya da saat");
      const d = new Date(0);
      d.setUTCFullYear(Number(g[1]), Number(g[2]) - 1, Number(g[3]));
      d.setUTCHours(Number(s[1]), Number(s[2]), 0, 0);
      if (d.getUTCDate() !== Number(g[3]) || d.getUTCMonth() !== Number(g[2]) - 1) {
        throw new RangeError("takvim: takvimde olmayan gün");
      }
      const yerel = d.getTime();
      // Aday ofsetler: duvar saatinin bir gün öncesi, kendisi ve bir gün sonrası çevresindeki ofsetler.
      const adaylar = [...new Set([ofset(f, yerel - GUN_MS), ofset(f, yerel), ofset(f, yerel + GUN_MS)])];
      const gecerli = adaylar.filter((o) => ofset(f, yerel - o) === o);
      // Tek ofset ya da çakışma: önceki (büyük) ofset, yani erken an.
      if (gecerli.length > 0) return yerel - Math.max(...gecerli);
      // Boşluk: geçişten önceki ofset (en erken adayın anında geçerli olan).
      return yerel - ofset(f, yerel - Math.max(...adaylar));
    },
  };
};
