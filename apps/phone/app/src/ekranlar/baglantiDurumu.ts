/**
 * Bağlantı durumunun görünüm kararı: tek kaynak (TASARIM.md 6.1, 6.2). Sohbet ekranı, Durum ve
 * Kurulum üst çubukları ve çekmece alt bilgisi aynı kararı buradan alır. Saf TS: tipler, saf
 * `asistanAdi.ts` ve saf `etkinlikMetni.ts` dışında içe aktarmaz, React Native'e çalışma anında
 * dokunmaz. Şimdiki zaman parametreyle gelir (`simdiMs`); burada saat okunmaz.
 *
 * Geçici/kalıcı ayrımı: çekirdek PC'ye ulaşılamadığında da `hata`'yı doldurur (`baglanti_kapandi`).
 * Bunlar "bağlantı yok, yeniden denenecek" sayılır (uyarı dili); hata dili kalıcı hatalara
 * (eşleşme, kimlik, sürüm, depo) ayrılır. Yoksa PC her ulaşılamadığında ekran hata rengine boyanır.
 */
import type {
  AkisDurumu,
  BaglantiOzeti,
  EtkinlikDurumu,
  SohbetErenDurumu,
  SohbetHatasi,
} from "../cekirdek/index.ts";
import { VARSAYILAN_ASISTAN_ADI } from "../asistanAdi.ts";
import { etkinlikMetni } from "./etkinlikMetni.ts";
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

/**
 * `altBaslikHesapla`'nın seçili sohbete özgü girdisi: `SohbetDurumu.akis`, `ozet?.eren` ve
 * `SohbetDurumu.etkinlik`. `simdiMs`: telefonun şimdiki saati (etkinliğin `baslangic_ms`'iyle aynı
 * saat); verilmezse süre gösterilmez.
 */
export interface SohbetAltBaslikGirdisi {
  akis: AkisDurumu | null;
  eren: SohbetErenDurumu | null;
  etkinlik?: EtkinlikDurumu | null;
  simdiMs?: number;
}

/** Tur sürüyor mu: bu sohbette akış var ya da asistan `tur_suruyor`. */
export function turSuruyor(s: SohbetAltBaslikGirdisi): boolean {
  return s.akis !== null || s.eren === "tur_suruyor";
}

/**
 * Ekranda gösterilecek etkinlik: tur sürüyorsa ve etkinlik süren akışın turuna aitse (akış yoksa
 * her tura) `etkinlik`; değilse `null`. `null` iken ekran etkinliksiz (bugünkü) haliyle çizilir.
 */
export function gorunenEtkinlik(s: SohbetAltBaslikGirdisi): EtkinlikDurumu | null {
  const e = s.etkinlik ?? null;
  if (e === null || !turSuruyor(s)) return null;
  if (s.akis !== null && s.akis.turn_id !== e.turn_id) return null;
  return e;
}

/** Etkinliğin geçen süresi: şimdi − başlangıç; eksiye düşerse ya da sayı değilse 0. */
export function etkinlikGecenMs(e: EtkinlikDurumu, simdiMs: number | undefined): number {
  if (simdiMs === undefined) return 0;
  const g = simdiMs - e.baslangic_ms;
  return Number.isFinite(g) && g > 0 ? g : 0;
}

/**
 * Saniyelik sayaç gerekli mi: gösterilecek bir etkinlik var ve metni süre taşıyor (`yaziyor` süre
 * taşımaz). Yanlışken ekranda zamanlayıcı çalışmaz.
 */
export function etkinlikSayaciGerekli(s: SohbetAltBaslikGirdisi): boolean {
  const e = gorunenEtkinlik(s);
  return e !== null && e.etkinlik !== "yaziyor";
}

/** İlk harfi Türkçe kurala göre büyütür ("internette" → "İnternette", "ılık" → "Ilık"). */
export function basHarfBuyuk(metin: string): string {
  const [ilk, ...kalan] = Array.from(metin);
  if (ilk === undefined) return metin;
  const buyuk = ilk === "i" ? "İ" : ilk === "ı" ? "I" : ilk.toUpperCase();
  return buyuk + kalan.join("");
}

/** Akış balonu altındaki etiket: `metin` görünen (süreli), `erisim` ekran okuyucu etiketi (süresiz). */
export interface EtkinlikEtiketi {
  metin: string;
  erisim: string;
}

/**
 * Akış balonu (ya da metinsiz balon) altındaki etkinlik etiketi; gösterilecek etkinlik yoksa `null`
 * (balon bugünkü "Yazıyor" etiketiyle çizilir). Görünen metin bugünkü "Yazıyor" gibi büyük harfle
 * başlar ve süre taşır; erişim etiketi her saniye değişmesin diye süresizdir ve asistan adını taşır.
 */
export function etkinlikEtiketiHesapla(
  s: SohbetAltBaslikGirdisi,
  asistanAdi: string = VARSAYILAN_ASISTAN_ADI,
): EtkinlikEtiketi | null {
  const e = gorunenEtkinlik(s);
  if (e === null) return null;
  return {
    metin: basHarfBuyuk(etkinlikMetni(e.etkinlik, etkinlikGecenMs(e, s.simdiMs))),
    erisim: `${asistanAdi} ${etkinlikMetni(e.etkinlik, 0)}`,
  };
}

/**
 * 6.1 tablosu: yukarıdan aşağı ilk tutan kazanır. Asistan satırları yalnız `sohbet` verilince
 * değerlendirilir; `hazir`, `uyuyor` ve `null` düz "Bağlı" olur. `asistanAdi`: görünen asistan adı
 * (ekranlar `platform/asistanAdi.ts`'in `ASISTAN_ADI`'sini verir); verilmezse "Claude". Tur sürerken
 * gösterilecek bir etkinlik varsa "{ad} yazıyor" yerine "{ad} komut çalıştırıyor · 42 sn" gibi.
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
    if (turSuruyor(sohbet)) {
      const e = gorunenEtkinlik(sohbet);
      const ne = e !== null ? etkinlikMetni(e.etkinlik, etkinlikGecenMs(e, sohbet.simdiMs)) : "yazıyor";
      return { metin: `${asistanAdi} ${ne}`, renk: "basari" };
    }
    if (sohbet.eren === "baslatiliyor") return { metin: `${asistanAdi} başlatılıyor`, renk: "basari" };
    if (sohbet.eren === "sirada") {
      return { metin: `${asistanAdi} sırada, mesajın bekliyor`, renk: "uyari" };
    }
    if (sohbet.eren === "kapali") return { metin: `Bağlı, ${asistanAdi} kapalı`, renk: "uyari" };
  }
  return { metin: "Bağlı", renk: "basari" };
}
