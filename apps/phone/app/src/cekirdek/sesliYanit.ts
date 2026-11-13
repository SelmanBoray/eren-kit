/**
 * Sesli yanıt kararı: bu çalışmada sesle (`dikte`, `kisayol`) gönderilmiş mesajın cevabı gelince
 * okunacak metni verir. Saf durum makinesi: port, zamanlayıcı, saat ve yan etki yok; okuma
 * `seslendirici.ts`'te.
 *
 * Bağ servisten açıkça gelir: `assistant_activity.kaynak_msg_id` bu turu başlatan insan mesajının
 * `client_msg_id`'sidir (protokol `AssistantActivity`), `turKaynagi` ile buraya geçer. Çerçeve sırası,
 * `server_status` ya da yankı tahmini kullanılmaz. Eski servis bu alanı hiç yollamaz: o zaman hiçbir
 * cevap okunmaz (yanlış okumaktansa okumamak).
 *
 * Üç küme, birbirinden bağımsız ve çağrı sırasından bağımsız dolar:
 * - `sesliler`: bu çalışmada sesle gönderilmiş, `unut` edilmemiş `client_msg_id`'ler.
 * - `kaynaklar`: `turn_id` → servisin bildirdiği kaynak `client_msg_id`.
 * - `bitenler`: bitiş olayı işlenmiş `turn_id`'ler (aynı cevap ikinci kez dönmez, geç bağ yazılmaz).
 * Karar yalnız `assistant_message` anında verilir: turun bildirilmiş kaynağı `sesliler`'de ise metin
 * döner. Kaynağı bildirilmemiş tur (sentetik tur, eski servis, başka cihazın ya da yazıyla gönderilmiş
 * mesaj) hiçbir sırayla okunmaz: yazılı mesaj `sesliler`'e hiç girmez.
 */
import type { KaliciOlay } from "./sozlesme.ts";

/** Bellek sınırları: cevabı hiç gelmeyen mesaj ve tur birikmez; aşılınca en eskisi düşer. */
export const SESLI_YANIT_SINIRLARI = {
  /** Sesle gönderilmiş, cevabı henüz okunmamış mesaj. */
  SESLI: 32,
  /** Kaynağı bildirilmiş, bitiş olayı henüz gelmemiş tur. */
  KAYNAK: 64,
  /** Bitmiş `turn_id` hafızası: yinelenen olay ya da geç gelen etkinlik çerçevesi turu diriltmesin. */
  BITEN: 64,
} as const;

export interface SesliYanit {
  /** Bu cihaz bu çalışmada bu mesajı sesle (dikte/kisayol) gönderdi. */
  sesliGonderildi(client_msg_id: string): void;
  /** Mesaj reddedildi/vazgeçildi; cevabı okunmayacak. */
  unut(client_msg_id: string): void;
  /** Servis bildirdi: bu turu bu mesaj başlattı. */
  turKaynagi(turn_id: string, kaynak_msg_id: string): void;
  /** Kalıcı olay. Okunacak Markdown'u ya da null döner. */
  olay(o: KaliciOlay): string | null;
  /** Yerel geçmiş sıfırlandı: her şey unutulur. */
  sifirla(): void;
}

export type SesliYanitFabrikasi = () => SesliYanit;

/** Ekleme sırasını koruyan sınırlı küme: yeniden ekleme sona taşır, taşan en eski düşer. */
const sinirliEkle = <K, V>(m: Map<K, V>, k: K, v: V, sinir: number): void => {
  m.delete(k);
  m.set(k, v);
  while (m.size > sinir) {
    const enEski = m.keys().next();
    if (enEski.done === true) return;
    m.delete(enEski.value);
  }
};

export const sesliYanitKur: SesliYanitFabrikasi = () => {
  const sesliler = new Map<string, true>();
  const kaynaklar = new Map<string, string>();
  const bitenler = new Map<string, true>();

  const turBitti = (turn_id: string): void => {
    kaynaklar.delete(turn_id);
    sinirliEkle(bitenler, turn_id, true, SESLI_YANIT_SINIRLARI.BITEN);
  };

  return {
    sesliGonderildi: (client_msg_id) => {
      sinirliEkle(sesliler, client_msg_id, true, SESLI_YANIT_SINIRLARI.SESLI);
    },

    unut: (client_msg_id) => {
      sesliler.delete(client_msg_id);
    },

    turKaynagi: (turn_id, kaynak_msg_id) => {
      // Bitmiş turun geç gelen (ya da yeniden bağlanınca yinelenen) çerçevesi bağ kurmaz.
      if (bitenler.has(turn_id)) return;
      sinirliEkle(kaynaklar, turn_id, kaynak_msg_id, SESLI_YANIT_SINIRLARI.KAYNAK);
    },

    olay: (o) => {
      switch (o.type) {
        case "assistant_message": {
          if (bitenler.has(o.turn_id)) return null;
          const kaynak = kaynaklar.get(o.turn_id);
          turBitti(o.turn_id);
          if (kaynak === undefined || !sesliler.has(kaynak)) return null;
          // Mesajın cevabı bir kez okunur.
          sesliler.delete(kaynak);
          return o.text;
        }
        case "turn_aborted":
          turBitti(o.turn_id);
          return null;
        default:
          return null;
      }
    },

    sifirla: () => {
      sesliler.clear();
      kaynaklar.clear();
      bitenler.clear();
    },
  };
};
