/**
 * Asistanın şu anki etkinliği: `assistant_activity` çerçevesi gelen etkinliği tutar. Kalıcı
 * değildir: kopukta atılır. Turu bitiren kalıcı olay (`assistant_message`, `turn_aborted`)
 * durumu siler. Depo saftır: saat parametreyle gelir, zamanlayıcı yoktur.
 */
import type { AkisEtkinligi, AssistantActivity } from "@eren/protocol";
import type { KaliciOlay } from "./sozlesme.ts";

export interface EtkinlikDurumu {
  turn_id: string;
  etkinlik: AkisEtkinligi;
  /** Etkinliğin başladığı an, TELEFONUN saatiyle (ms). */
  baslangic_ms: number;
}

export interface Etkinlik {
  /** Gelen çerçeve; simdiMs telefonun o anki saati. */
  cerceve(c: AssistantActivity, simdiMs: number): void;
  /** Kalıcı olay: turu bitiren olay (`assistant_message`, `turn_aborted`) durumu siler. */
  olay(o: KaliciOlay): void;
  /** Servisin açık bitiş çerçevesi (`assistant_activity_end`): tur bitti sayılır. */
  bitti(turn_id: string): void;
  /** Bağlantı koptu: durum atılır. */
  koptu(): void;
  sifirla(): void;
  /** Değişmedikçe aynı nesne döner. */
  durum(): EtkinlikDurumu | null;
}

export type EtkinlikFabrikasi = () => Etkinlik;

const BITEN_TUR_HAFIZASI = 64;

export const etkinlikKur: EtkinlikFabrikasi = () => {
  let suren: EtkinlikDurumu | null = null;
  // Bitmiş turun geç gelen çerçevesi durumu diriltmesin.
  let bitenler: string[] = [];

  const bittiMi = (turn_id: string): boolean => bitenler.includes(turn_id);

  const bitir = (turn_id: string): void => {
    if (bittiMi(turn_id)) return;
    bitenler.push(turn_id);
    if (bitenler.length > BITEN_TUR_HAFIZASI) bitenler.shift();
  };

  return {
    cerceve: (c, simdiMs) => {
      if (bittiMi(c.turn_id)) return;
      // Servis saati ile telefon saati karşılaştırılmaz; yalnız geçen süre kullanılır.
      suren = { turn_id: c.turn_id, etkinlik: c.etkinlik, baslangic_ms: simdiMs - c.gecen_ms };
    },

    olay: (o) => {
      if (o.type !== "assistant_message" && o.type !== "turn_aborted") return;
      bitir(o.turn_id);
      if (suren !== null && suren.turn_id === o.turn_id) suren = null;
    },

    bitti: (turn_id) => {
      bitir(turn_id);
      if (suren !== null && suren.turn_id === turn_id) suren = null;
    },

    koptu: () => {
      suren = null;
    },

    sifirla: () => {
      suren = null;
      bitenler = [];
    },

    durum: () => suren,
  };
};
