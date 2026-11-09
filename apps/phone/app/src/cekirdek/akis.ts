/**
 * Süren turun akış metni: `stream_snapshot` taban kurar, `offset`'li `assistant_delta` üstüne
 * oturur. Kalıcı değildir: kopukta atılır, yeniden bağlanınca snapshot yeniden kurar. Turun tam
 * metni kalıcı `assistant_message` olayıyla gelir ve akışı kapatır. TASARIM.md "JS modülleri".
 */
import { SINIRLAR } from "@eren/protocol";
import type { AkisDurumu, GelenCerceve, KaliciOlay } from "./sozlesme.ts";

export type AkisCercevesi = Extract<GelenCerceve, { type: "assistant_delta" | "stream_snapshot" }>;

export interface Akis {
  /** Görünen metin değiştiyse `true`. */
  cerceve(c: AkisCercevesi): boolean;
  /** Kalıcı olay: turu bitiren olay (`assistant_message`, `turn_aborted`) akışı kapatır. */
  olay(o: KaliciOlay): boolean;
  /** Bağlantı koptu: akış atılır, gelecek snapshot yeniden kurar. */
  koptu(): boolean;
  sifirla(): void;
  /** Değişmedikçe aynı nesne döner. */
  durum(): AkisDurumu | null;
}

export type AkisFabrikasi = () => Akis;

const BITEN_TUR_HAFIZASI = 64;

export const akisKur: AkisFabrikasi = () => {
  let suren: AkisDurumu | null = null;
  // Bitmiş turun geç gelen parçası ya da snapshot'ı akışı diriltmesin.
  let bitenler: string[] = [];

  const bittiMi = (turn_id: string): boolean => bitenler.includes(turn_id);

  const bitir = (turn_id: string): void => {
    if (bittiMi(turn_id)) return;
    bitenler.push(turn_id);
    if (bitenler.length > BITEN_TUR_HAFIZASI) bitenler.shift();
  };

  const kur = (turn_id: string, metin: string): boolean => {
    if (metin.length > SINIRLAR.ASISTAN_METNI) return false;
    if (suren !== null && suren.turn_id === turn_id && suren.metin === metin) return false;
    if (suren !== null && suren.turn_id !== turn_id) bitir(suren.turn_id);
    suren = { turn_id, metin };
    return true;
  };

  return {
    cerceve: (c) => {
      if (bittiMi(c.turn_id)) return false;
      if (c.type === "stream_snapshot") return kur(c.turn_id, c.text);

      if (suren === null || suren.turn_id !== c.turn_id) {
        // Yeni tur yalnız baştan başlar; ortadan gelen parçanın tabanı yoktur.
        return c.offset === 0 ? kur(c.turn_id, c.text) : false;
      }
      const uzunluk = suren.metin.length;
      // Boşluk: kayıp parça bu bağlantıda telafi edilemez, tam metni olay getirir.
      if (c.offset > uzunluk) return false;
      // Yinelenen ya da zaten kapsanan parça.
      if (c.offset + c.text.length <= uzunluk) return false;
      return kur(c.turn_id, suren.metin.slice(0, c.offset) + c.text);
    },

    olay: (o) => {
      if (o.type !== "assistant_message" && o.type !== "turn_aborted") return false;
      bitir(o.turn_id);
      if (suren === null || suren.turn_id !== o.turn_id) return false;
      suren = null;
      return true;
    },

    koptu: () => {
      if (suren === null) return false;
      suren = null;
      return true;
    },

    sifirla: () => {
      suren = null;
      bitenler = [];
    },

    durum: () => suren,
  };
};
