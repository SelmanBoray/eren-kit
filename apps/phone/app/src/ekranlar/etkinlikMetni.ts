/**
 * Asistanın o anki etkinliğinin ekran metni. Saf TS: protokolden yalnız tip alır, çalışma anında
 * hiçbir şeye bağımlı değildir.
 */
import type { AkisEtkinligi } from "@eren/protocol";

const ETIKETLER: Record<AkisEtkinligi, string> = {
  dusunuyor: "düşünüyor",
  yaziyor: "yazıyor",
  komut: "komut çalıştırıyor",
  dosya_okuma: "dosyalara bakıyor",
  dosya_yazma: "dosya düzenliyor",
  web: "internette arıyor",
  plan: "iş başlatıyor",
  is_bilgisi: "işlere bakıyor",
  ekran: "bilgisayarı kullanıyor",
  arac: "araç kullanıyor",
};

/** Bu süreden (ms) önce süre eki gösterilmez. */
const EK_ESIGI_MS = 5000;

/** Etkinliği ve ne kadardır sürdüğünü ekranda gösterilecek küçük harfli metne çevirir. */
export const etkinlikMetni = (etkinlik: AkisEtkinligi, gecenMs: number): string => {
  const etiket = ETIKETLER[etkinlik];
  if (etkinlik === "yaziyor" || !Number.isFinite(gecenMs) || gecenMs < EK_ESIGI_MS) return etiket;
  const saniye = Math.floor(gecenMs / 1000);
  if (saniye < 60) return `${etiket} · ${saniye} sn`;
  const dk = Math.floor(saniye / 60);
  const sn = saniye % 60;
  return `${etiket} · ${sn === 0 ? `${dk} dk` : `${dk} dk ${sn} sn`}`;
};
