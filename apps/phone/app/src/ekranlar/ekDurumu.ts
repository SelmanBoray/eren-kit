/**
 * Sohbet ekranındaki ek kararları (U5b): saf işlevler, Expo/RN yok. Ek düğmesinin açık/kapalı hali,
 * Gönder'in dolu sayılması, bekleyen mesajda "Kaldır"ın görünmesi, balondaki eklerin ilerlemeleri ve
 * balonun `memo` karşılaştırması. Metinler `medyaMetni.ts`'te.
 */
import { MEDYA_SINIRLARI } from "@eren/protocol";
import type { BekleyenOge, EkBilgisi, EkGorunumu, EkIlerlemesi, GorunumOgesi, MedyaId } from "../cekirdek/index.ts";
import {
  EK_BAGLANTI_BEKLENIYOR_METNI,
  EK_DOLU_ETIKETI,
  EK_DUGME_ETIKETI,
  EK_KAPALI_METNI,
  ekRedMetni,
} from "./medyaMetni.ts";

/**
 * Ek düğmesi. `gizli`: sohbete yazılamaz ya da seçici yok. `kapali`: görünür ama seçici açılmaz;
 * dokununca `neden` not satırında söylenir (ekran okuyucuya da ipucu olarak). `acik`: alt sayfa açılır.
 */
export type EkDugmesi =
  | { durum: "gizli" }
  | { durum: "kapali"; etiket: string; neden: string }
  | { durum: "acik"; etiket: string };

export interface EkDugmesiGirdisi {
  /** `CekirdekDurumu.medyaDestekli`; yalnız `=== true` açıktır. */
  medyaDestekli: boolean | undefined;
  /** `SohbetDurumu.baglanti === "bagli"`. */
  bagli: boolean;
  /** Listede olmayan ya da PC'de kurulamamış sohbet. */
  yazilamaz: boolean;
  /** Seçici portu verildi mi. */
  seciciVar: boolean;
  /** Şeritteki ek sayısı. */
  adet: number;
}

export function ekDugmesi(g: EkDugmesiGirdisi): EkDugmesi {
  if (g.yazilamaz || !g.seciciVar) return { durum: "gizli" };
  if (g.medyaDestekli !== true) {
    // Bağlıyken servis `medya1` demedi: eski servis. Bağlı değilken bu süreçte hiç `welcome` görülmemiş
    // olabilir (kopunca son değer korunur): eski servis mi bilinmez, bağlantı beklenir.
    const neden = g.bagli ? EK_KAPALI_METNI : EK_BAGLANTI_BEKLENIYOR_METNI;
    return { durum: "kapali", etiket: EK_DUGME_ETIKETI, neden };
  }
  if (g.adet >= MEDYA_SINIRLARI.EK_ADET) {
    return { durum: "kapali", etiket: EK_DOLU_ETIKETI, neden: ekRedMetni("adet_asildi") };
  }
  return { durum: "acik", etiket: EK_DUGME_ETIKETI };
}

/** Seçicinin açılacağı kalan hak: `EK_ADET - adet`, en az 0. */
export const kalanEkHakki = (adet: number): number => Math.max(0, MEDYA_SINIRLARI.EK_ADET - adet);

/** Gönder görünür mü: metin (boşluksuz) ya da en az bir ek var. Ek varken metin boş olabilir. */
export const gonderDolu = (metin: string, ekAdet: number): boolean => metin.trim() !== "" || ekAdet > 0;

/** Bekleyen öğenin ekleri (yalnız `user_message`); yoksa boş. */
export function bekleyenEkleri(b: BekleyenOge): readonly EkBilgisi[] {
  return b.mesaj.type === "user_message" ? (b.mesaj.ekler ?? BOS) : BOS;
}

/**
 * Bekleyen balonda "Kaldır" görünür mü: ekli `user_message`, bu bağlantıda henüz yollanmamış
 * (`kuyrukta`). Yollanmış ya da teslim edilmiş öğe kaldırılamaz (çekirdek `kaldirilamaz` der).
 * Eksiz mesajda gösterilmez: tıkanmayı yalnız ekli mesaj yapar.
 */
export const bekleyenKaldirilabilir = (b: BekleyenOge): boolean =>
  b.durum === "kuyrukta" && bekleyenEkleri(b).length > 0;

/** Eklerin sırasıyla ilerlemeleri; görünümü olmayan ek `null`. */
export function ekIlerlemeleri(
  ekler: readonly EkBilgisi[],
  gorunumler: ReadonlyMap<MedyaId, EkGorunumu>,
): (EkIlerlemesi | null)[] {
  return ekler.map((e) => gorunumler.get(e.medya_id)?.ilerleme ?? null);
}

/**
 * Balonun `memo` karşılaştırması için: iki görünüm haritasında bu eklerin görünümleri aynı nesne mi.
 * Çekirdek içerik değişmedikçe aynı `EkGorunumu` nesnelerini verir; harita başka bir ekin
 * değişmesiyle yenilenebilir, o zaman bu balon yeniden çizilmez.
 */
export function ekGorunumleriEsit(
  ekler: readonly EkBilgisi[] | undefined,
  a: ReadonlyMap<MedyaId, EkGorunumu> | undefined,
  b: ReadonlyMap<MedyaId, EkGorunumu> | undefined,
): boolean {
  if (ekler === undefined || ekler.length === 0 || a === b) return true;
  for (const e of ekler) if (a?.get(e.medya_id) !== b?.get(e.medya_id)) return false;
  return true;
}

/** Zaman çizelgesi öğesinin ekleri (yalnız ekli kullanıcı balonu); yoksa `undefined`. */
export const ogeEkleri = (o: GorunumOgesi): readonly EkBilgisi[] | undefined =>
  o.tur === "kullanici" ? o.ekler : undefined;

const BOS: readonly EkBilgisi[] = [];
