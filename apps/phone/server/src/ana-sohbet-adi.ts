/**
 * `ana` sohbeti YENİ oluşturulurken (depo göçü ya da `sohbetler` açılış güvencesi) verilecek ad.
 * Kaynak `Ayar.asistanAdi` (`EREN_KIT_ASSISTANT_NAME`); kablodaki `SohbetAdi` kuralına (tek satır,
 * görünmez karakter yok, en çok 60 UTF-16 birimi) uymuyorsa protokolün nötr varsayılanı
 * `ANA_SOHBET_ADI`. Mevcut satırın adı hiçbir zaman buradan değiştirilmez. Saf.
 */
import { ANA_SOHBET_ADI, SohbetAdi } from "@eren/protocol";

export const anaSohbetAdiUret = (asistanAdi: string | undefined): string =>
  asistanAdi !== undefined && SohbetAdi.safeParse(asistanAdi).success ? asistanAdi : ANA_SOHBET_ADI;
