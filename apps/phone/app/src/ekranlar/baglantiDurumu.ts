/**
 * Bağlantı durumunun görünüm kararı: tek kaynak (TASARIM.md 6.1, 6.2). Sohbet ekranı, Durum ve
 * Kurulum üst çubukları ve çekmece alt bilgisi aynı kararı buradan alır. Saf TS: tipler ve saf
 * `asistanAdi.ts` dışında içe aktarmaz, React Native'e çalışma anında dokunmaz.
 *
 * Geçici/kalıcı ayrımı: çekirdek PC'ye ulaşılamadığında da `hata`'yı doldurur (`baglanti_kapandi`).
 * Bunlar "bağlantı yok, yeniden denenecek" sayılır (uyarı dili); hata dili kalıcı hatalara
 * (eşleşme, kimlik, sürüm, depo) ayrılır. Yoksa PC her ulaşılamadığında ekran hata rengine boyanır.
 */
import type {
  AkisDurumu,
  BaglantiOzeti,
  SohbetErenDurumu,
  SohbetHatasi,
} from "../cekirdek/index.ts";
import { VARSAYILAN_ASISTAN_ADI } from "../asistanAdi.ts";
import type { RenkAdi } from "./tema.ts";
import type { HatDurumu } from "./UstCubuk.tsx";

/** Kendiliğinden düzelen, "bağlantı yok" sayılan hatalar. */
export const GECICI_HATALAR: ReadonlySet<SohbetHatasi> = new Set<SohbetHatasi>([
  "baglanti_kapandi",
  "el_sikisma_zaman_asimi",
  "oturum_yok",
  "zaman_asimi",
]);

/** 6.1 ilk satırı ve 6.2 "Bağlantı hatası": bağlı değil ve kalıcı bir hata var. */
export function kaliciHataVar(d: BaglantiOzeti): boolean {
  return d.baglanti !== "bagli" && d.hata !== null && !GECICI_HATALAR.has(d.hata);
}

/**
 * 6.2: kalıcı hatada düz hata rengi; bağlı ve eşitleme yoksa ayraç; bağlanırken ve eşitlenirken
 * akar; kapalıyken (yeniden denenecek) düz uyarı.
 */
export function hatHesapla(d: BaglantiOzeti): HatDurumu {
  if (kaliciHataVar(d)) return "hata";
  if (d.baglanti === "bagli") return d.esitleniyor ? "baglaniyor" : "bagli";
  if (d.baglanti === "kapali") return "kopuk";
  return "baglaniyor";
}

/** `UstCubukProps["altBaslik"]` ile aynı şekil: `renk` nokta, `metinRenk` metin (yoksa `metinIkincil`). */
export interface AltBaslikBilgisi {
  metin: string;
  renk: RenkAdi;
  metinRenk?: RenkAdi;
}

/** `altBaslikHesapla`'nın seçili sohbete özgü girdisi: `SohbetDurumu.akis` ve `ozet?.eren`. */
export interface SohbetAltBaslikGirdisi {
  akis: AkisDurumu | null;
  eren: SohbetErenDurumu | null;
}

/**
 * 6.1 tablosu: yukarıdan aşağı ilk tutan kazanır. Asistan satırları yalnız `sohbet` verilince
 * değerlendirilir; `hazir`, `uyuyor` ve `null` düz "Bağlı" olur. `asistanAdi`: görünen asistan adı
 * (ekranlar `platform/asistanAdi.ts`'in `ASISTAN_ADI`'sini verir); verilmezse "Claude".
 */
export function altBaslikHesapla(
  d: BaglantiOzeti,
  sohbet?: SohbetAltBaslikGirdisi | null,
  asistanAdi: string = VARSAYILAN_ASISTAN_ADI,
): AltBaslikBilgisi {
  if (kaliciHataVar(d)) return { metin: "Bağlantı yok", renk: "hata", metinRenk: "hata" };
  if (d.baglanti === "kapali") {
    return d.sonrakiDenemeMs !== null
      ? { metin: "Bağlantı yok, yeniden denenecek", renk: "uyari" }
      : { metin: "Bağlantı yok", renk: "uyari" };
  }
  if (d.baglanti === "baglaniyor") return { metin: "Bağlanıyor", renk: "bilgi" };
  if (d.baglanti === "el_sikisma") return { metin: "Kimlik doğrulanıyor", renk: "bilgi" };
  if (d.esitleniyor) return { metin: "Eksik mesajlar alınıyor", renk: "bilgi" };
  if (sohbet) {
    if (sohbet.akis !== null || sohbet.eren === "tur_suruyor") {
      return { metin: `${asistanAdi} yazıyor`, renk: "basari" };
    }
    if (sohbet.eren === "baslatiliyor") return { metin: `${asistanAdi} başlatılıyor`, renk: "basari" };
    if (sohbet.eren === "sirada") {
      return { metin: `${asistanAdi} sırada, mesajın bekliyor`, renk: "uyari" };
    }
    if (sohbet.eren === "kapali") return { metin: `Bağlı, ${asistanAdi} kapalı`, renk: "uyari" };
  }
  return { metin: "Bağlı", renk: "basari" };
}
