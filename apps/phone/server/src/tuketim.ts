/**
 * Tüketim yardımcıları. Saf: zaman girdi olarak gelir. Ayrıntı: tuketim tablosu, sozlesme.ts `TuketimKaydi`.
 */
import type { AkisOlayi, TuketimKaydi } from "./sozlesme.ts";

/** Kaydı yazan çağıranın verdiği bağlam: `ts_ms`, kaynak ve kimlikler. */
export interface TuketimBaglami {
  ts_ms: number;
  kaynak: TuketimKaydi["kaynak"];
  sohbet_id: TuketimKaydi["sohbet_id"];
  is_id: TuketimKaydi["is_id"];
  turn_id: string | null;
  nesil: number | null;
  rol: TuketimKaydi["rol"];
  /** Bilinen init modeli; yoksa `null` (`ana_usage` satırında "bilinmiyor"). */
  model: string | null;
}

const sifirMi = (k: { girdi: number; cache_yazma: number; cache_okuma: number; cikti: number }): boolean =>
  k.girdi === 0 && k.cache_yazma === 0 && k.cache_okuma === 0 && k.cikti === 0;

/**
 * `model_kullanimlari` varsa (`[]` dahil) model başına satır (`model_farki`); yoksa `ana_kullanim`'dan
 * tek satır (`ana_usage`, maliyet bilinmez). Dört sayısı 0 olan satır üretilmez.
 */
export const tuketimKayitlari = (
  sonuc: Extract<AkisOlayi, { tur: "result" }>,
  b: TuketimBaglami,
): TuketimKaydi[] => {
  const ortak = {
    ts_ms: b.ts_ms,
    kaynak: b.kaynak,
    sohbet_id: b.sohbet_id,
    is_id: b.is_id,
    turn_id: b.turn_id,
    nesil: b.nesil,
    rol: b.rol,
  };
  if (sonuc.model_kullanimlari !== null) {
    return sonuc.model_kullanimlari
      .filter((k) => !sifirMi(k))
      .map((k) => ({
        ...ortak,
        model: k.model,
        girdi: k.girdi,
        cache_yazma: k.cache_yazma,
        cache_okuma: k.cache_okuma,
        cikti: k.cikti,
        maliyet_usd: k.maliyet_usd,
        olcum: "model_farki" as const,
      }));
  }
  const a = sonuc.ana_kullanim;
  if (a === null || sifirMi(a)) return [];
  return [
    {
      ...ortak,
      model: b.model ?? "bilinmiyor",
      girdi: a.girdi,
      cache_yazma: a.cache_yazma,
      cache_okuma: a.cache_okuma,
      cikti: a.cikti,
      maliyet_usd: null,
      olcum: "ana_usage",
    },
  ];
};

export interface GunSinirlari {
  gunBaslangicMs: number;
  yediGunBaslangicMs: number;
}

/**
 * PC yerel saat diliminde bugünün gece yarısı ve bugün dahil 7 takvim gününün başı. Takvim hesabı:
 * yaz/kış saati geçişinde 24 saat çıkarmak yerine yerel gün alanı değiştirilir.
 */
export const gunSinirlari = (simdiMs: number): GunSinirlari => {
  const s = new Date(simdiMs);
  const y = s.getFullYear();
  const a = s.getMonth();
  const g = s.getDate();
  return {
    gunBaslangicMs: new Date(y, a, g).getTime(),
    yediGunBaslangicMs: new Date(y, a, g - 6).getTime(),
  };
};
