/**
 * Plan kartının durum satırı (0.5.0, sözleşme §3). Kart yalnız gerçekten onay beklenirken "onay"
 * der; onaysız (tam yetkiyle ya da otomatik izinle) başlayan işte iş durumunu gösterir.
 *
 * Eldeki bilgi: `plan_resolved.sonuc` ("onaylandi" onayla mı tam yetkiyle mi başladığını ayırmaz),
 * kartın `is_id`'si ile aynı sohbetteki iş kartının durumu, bu sohbetin kuyruktaki/hatalardaki
 * `plan_decision`'ı ve oto izin deposu. `plan_proposed` onay beklenip beklenmediğini taşımaz: tam
 * yetkiyle hemen başlayacak PC planı `plan_resolved` gelene dek "bekliyor" görünür.
 */
import type { BekleyenOge, GidenHatasi, IsKarti, PlanKarti, SohbetDurumu } from "../cekirdek/index.ts";
import type { RenkAdi } from "./tema.ts";

export interface PlanKartiDurumu {
  metin: string;
  renk: RenkAdi;
  /** Kullanıcıdan gerçekten karar bekleniyor: kenar vurgusu, karar düğmeleri ve "onay" dili. */
  onayBekleniyor: boolean;
}

/** Bu planın yoldaki kararı: kuyrukta ya da servisin "telefon izni bekleniyor" diye tuttuğu. */
export type YoldakiKarar = "onay" | "ret" | null;

const IS_DURUMU: Record<IsKarti["durum"], { metin: string; renk: RenkAdi }> = {
  suruyor: { metin: "Çalışıyor", renk: "bilgi" },
  tamam: { metin: "Bitti", renk: "basari" },
  hata: { metin: "Hatayla bitti", renk: "hata" },
  yarim: { metin: "Yarım kaldı", renk: "uyari" },
  limit_durdu: { metin: "Limitte durdu", renk: "uyari" },
  iptal: { metin: "İptal edildi", renk: "metinSonuk" },
};

export const ONAY_BEKLENIYOR_METNI = "Onayını bekliyor";
export const BASLATILIYOR_METNI = "Başlatılıyor";

/** Saf: kartın `is_id`'sinin iş kartı durumu; iş yoksa ya da görünmüyorsa `null`. */
export function isDurumuBul(ogeler: SohbetDurumu["ogeler"], is_id: number | null): IsKarti["durum"] | null {
  if (is_id === null) return null;
  for (const o of ogeler) if (o.tur === "is" && o.is_id === is_id) return o.durum;
  return null;
}

/**
 * Saf: bu planın yoldaki kararı. Kuyruktaki `plan_decision` ve servisin kabul edip telefon iznini
 * beklediği (`izin_bekleniyor`) karar sayılır; başka hatayla düşen karar sayılmaz (yeniden verilebilir).
 */
export function yoldakiKarar(
  plan_id: string,
  bekleyenler: readonly BekleyenOge[],
  hatalar: readonly GidenHatasi[],
): YoldakiKarar {
  for (const b of bekleyenler) {
    if (b.mesaj.type === "plan_decision" && b.mesaj.plan_id === plan_id) return b.mesaj.karar;
  }
  for (const h of hatalar) {
    if (h.mesaj.type === "plan_decision" && h.mesaj.plan_id === plan_id && h.kod === "izin_bekleniyor") {
      return h.mesaj.karar;
    }
  }
  return null;
}

/**
 * Saf: kartın durum satırı.
 * - `onaylandi`: iş durumu ("Çalışıyor", "Bitti", ...); iş kartı henüz görünmüyorsa "Başladı".
 * - `bekliyor`: otomatik deneme sürüyor ya da onay kararı yoldaysa "Başlatılıyor"; ret yoldaysa
 *   "Reddediliyor"; yoksa kullanıcıdan karar bekleniyor.
 */
export function planKartiDurumu(
  durum: PlanKarti["durum"],
  isDurumu: IsKarti["durum"] | null,
  karar: YoldakiKarar,
  otoDeneniyor: boolean,
): PlanKartiDurumu {
  switch (durum) {
    case "onaylandi":
      return isDurumu === null
        ? { metin: "Başladı", renk: "basari", onayBekleniyor: false }
        : { ...IS_DURUMU[isDurumu], onayBekleniyor: false };
    case "reddedildi":
      return { metin: "Reddedildi", renk: "metinSonuk", onayBekleniyor: false };
    case "iptal":
      return { metin: "İptal edildi", renk: "metinSonuk", onayBekleniyor: false };
    case "bekliyor":
      if (karar === "ret") return { metin: "Reddediliyor", renk: "metinSonuk", onayBekleniyor: false };
      if (karar === "onay" || otoDeneniyor) return { metin: BASLATILIYOR_METNI, renk: "bilgi", onayBekleniyor: false };
      return { metin: ONAY_BEKLENIYOR_METNI, renk: "vurgu", onayBekleniyor: true };
  }
}
