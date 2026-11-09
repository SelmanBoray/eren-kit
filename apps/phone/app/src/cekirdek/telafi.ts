/**
 * Kalıcı olay telafisi. Her olay önce kalıcı günlüğe eklenir, sonra `last_seq` yazılır, ancak
 * sonra uygulanır; `seq <= last_seq` atılır. `hello{last_seq}` bu değerle gider, `welcome{head_seq}`
 * sonrası eksikler sırayla gelir. TASARIM.md "JS modülleri"; protocol README `/sohbet` 2-3.
 *
 * Mezar taşı (`chat_cleared`): olay her zamanki gibi eklenir ve `last_seq` ilerler, sonra günlük
 * yalnız `seq > sinir_seq` olan satırlarla atomik yeniden yazılır (`satirlariYaz`); mezar taşı kalır,
 * `last_seq` değişmez. Kırpma yazılamazsa olay yine uygulanır, `yukle` kırpmayı yineler. MODULLER.md
 * "Telefon çekirdeği", Dilim 1, **Mezar taşı**.
 *
 * Dilim 2 (TASARIM.md "Telafi"): kırpma sohbet başınadır (`sohbetAnahtari`). Yaşam döngüsü olayları
 * (`SOHBET_YASAM_OLAYLARI`) hiç kırpılmaz. `chat_deleted` o sohbetin yaşam döngüsü dışındaki bütün
 * satırlarını (mezar taşları dahil) kırpar; canlıda mezar taşı gibi, `last_seq`'ten sonra.
 */
import { ANA_SOHBET_ID, Olay, SOHBET_YASAM_OLAYLARI, sohbetAnahtari } from "@eren/protocol";
import type { DepoPortu, KaliciOlay, MezarTasi } from "./sozlesme.ts";

export const TELAFI_ANAHTARLARI = {
  /** Olay günlüğü: satır başına bir olay JSON'u. */
  olaylar: "sohbet_olaylari",
  /** Kalıcı `last_seq`, ondalık metin. */
  sonSeq: "sohbet_son_seq",
} as const;

/** `geride`: bilgisayarın geçmişi telefondakinin gerisinde; yerel geçmiş sıfırlanmalı. */
export type WelcomeSonucu = "tamam" | "geride";

export interface Telafi {
  /**
   * Günlüğü okur, `seq` sırasıyla tekrarsız döner. Bağlanmadan önce bir kez çağrılır. Günlükte
   * mezar taşı ya da `chat_deleted` varsa `kalirMi` kurallarıyla kırpılır (yaşam döngüsü olayları
   * kalır) ve kırpılmış günlük diske yazılır; yazılamazsa liste yine kırpılmış döner.
   */
  yukle(): Promise<KaliciOlay[]>;
  /** `hello.last_seq`: kalıcı olarak uygulanmış en büyük `seq`. */
  sonSeq(): number;
  welcome(head_seq: number): WelcomeSonucu;
  /** `welcome`'daki `head_seq`'e henüz ulaşılmadı. */
  esitleniyor(): boolean;
  /** Gelen `event.event`. Sıraya girer; kalıcı olunca `uygulandi` çağrılır. */
  olay(o: KaliciOlay): void;
  koptu(): void;
  /** Bekleyenleri atar, `sonSeq` hemen 0 olur, günlük ve `last_seq` silinir. Silinemezse atar. */
  sifirla(): Promise<void>;
  /** Sıradaki bütün işler bitince çözülür. */
  bosalt(): Promise<void>;
}

export interface TelafiBagimliliklari {
  depo: DepoPortu;
  /** Olay günlükte ve `last_seq` ilerledi; `seq` sırasıyla, her olay için bir kez. */
  uygulandi(o: KaliciOlay): void;
  /** Sırada bekleyen olay kalmadı ve en az biri uygulandı. */
  bosaldi(): void;
  /** Olay günlüğe yazılamadı: bu bağlantının kalan olayları atıldı, yeniden bağlanılmalı. */
  yazilamadi(): void;
}

export type TelafiFabrikasi = (b: TelafiBagimliliklari) => Telafi;

const seqMi = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

const cozumle = (satir: string): unknown => {
  try {
    return JSON.parse(satir) as unknown;
  } catch {
    return undefined;
  }
};

/** Kırpmanın girdisi: sohbet anahtarı → en yeni mezar taşı, ve silinmiş sohbetler (`ana` hiç girmez). */
interface Kirpma {
  readonly mezarlar: ReadonlyMap<string, MezarTasi>;
  readonly silinenler: ReadonlySet<string>;
}

const YASAM_TURLERI: ReadonlySet<unknown> = new Set<unknown>(SOHBET_YASAM_OLAYLARI);

/**
 * Kırpmada satır kalır mı (TASARIM.md "Telafi", sırayla):
 * 1. JSON nesnesi değilse ya da `seq` sayı değilse kalmaz.
 * 2. Yaşam döngüsü olayı her zaman kalır (silinmiş sohbetinki dahil).
 * 3. Sohbeti silinmişse kalmaz (mezar taşları dahil).
 * 4. Sohbetin mezar taşı varsa: en yenisi ve sonrası kalır, `seq > sinir_seq` olan mezar taşı
 *    olmayanlar kalır, eski mezar taşları gider (tek not). Başka sohbetin satırlarına dokunulmaz.
 */
const kalirMi = (ham: unknown, k: Kirpma): boolean => {
  if (typeof ham !== "object" || ham === null) return false;
  const { seq, type } = ham as { seq?: unknown; type?: unknown };
  if (typeof seq !== "number") return false;
  if (YASAM_TURLERI.has(type)) return true;
  const anahtar = sohbetAnahtari(ham);
  if (k.silinenler.has(anahtar)) return false;
  const m = k.mezarlar.get(anahtar);
  if (m === undefined || seq >= m.seq) return true;
  return seq > m.sinir_seq && type !== "chat_cleared";
};

const BOS_MEZARLAR: ReadonlyMap<string, MezarTasi> = new Map();
const BOS_SILINENLER: ReadonlySet<string> = new Set();

/** Canlı olayın kırpması; kırpma gerektirmeyen olayda `null`. `chat_deleted{ana}` hiçbir şey silmez. */
const canliKirpma = (o: KaliciOlay): Kirpma | null => {
  if (o.type === "chat_cleared") {
    return { mezarlar: new Map([[sohbetAnahtari(o), o]]), silinenler: BOS_SILINENLER };
  }
  if (o.type === "chat_deleted") {
    const anahtar = sohbetAnahtari(o);
    if (anahtar === ANA_SOHBET_ID) return null;
    return { mezarlar: BOS_MEZARLAR, silinenler: new Set([anahtar]) };
  }
  return null;
};

export const telafiKur: TelafiFabrikasi = ({ depo, uygulandi, bosaldi, yazilamadi }) => {
  let sonSeq = 0;
  // Sıraya alınmış en büyük `seq`: `head_seq` bundan gerideyse bilgisayarın geçmişi geride kalmıştır.
  let siradaki = 0;
  let hedef: number | null = null;
  // Sıfırlama ya da yazım hatası nesli artırır; eski nesilden kalan iş durumu değiştirmez.
  let nesil = 0;
  // Günlük silinemediyse yeni olay eskisinin üstüne karışmasın diye kabul durur.
  let bozuk = false;
  let bekleyen = 0;
  let uygulanan = 0;
  let zincir: Promise<void> = Promise.resolve();

  // Canlı mezar taşı ya da `chat_deleted`: günlük o anki haliyle kırpılır. Okunamaz ya da yazılamazsa
  // (atomik) günlük olduğu gibi kalır; olay yine uygulanır, bir sonraki `yukle` aynı kırpmayı yapar.
  const kirp = async (k: Kirpma, n: number): Promise<void> => {
    try {
      const satirlar = await depo.satirlar(TELAFI_ANAHTARLARI.olaylar);
      if (n !== nesil) return;
      const kalan = satirlar.filter((s) => kalirMi(cozumle(s), k));
      if (kalan.length !== satirlar.length) {
        await depo.satirlariYaz(TELAFI_ANAHTARLARI.olaylar, kalan);
      }
    } catch {
      // Kırpılmamış günlük doğru sonucu verir: `yukle` aynı mezar taşıyla yeniden kırpar.
    }
  };

  const kaydet = async (o: KaliciOlay, n: number): Promise<void> => {
    if (n !== nesil || o.seq <= sonSeq) return;
    try {
      await depo.ekle(TELAFI_ANAHTARLARI.olaylar, JSON.stringify(o));
    } catch {
      if (n !== nesil) return;
      nesil++;
      siradaki = sonSeq;
      hedef = null;
      yazilamadi();
      return;
    }
    if (n !== nesil) return;
    try {
      await depo.yaz(TELAFI_ANAHTARLARI.sonSeq, String(o.seq));
    } catch {
      // Olay günlükte: yüklemede günlüğün en büyük `seq`'i de hesaba katılır.
    }
    if (n !== nesil) return;
    sonSeq = o.seq;
    const k = canliKirpma(o);
    if (k !== null) {
      await kirp(k, n);
      if (n !== nesil) return;
    }
    uygulanan++;
    uygulandi(o);
  };

  const sirayaKoy = (is: () => Promise<void>): Promise<void> => {
    const adim = zincir.then(is);
    zincir = adim.catch(() => undefined);
    return adim;
  };

  return {
    yukle: async () => {
      const n = nesil;
      const satirlar = await depo.satirlar(TELAFI_ANAHTARLARI.olaylar);
      const hamlar = satirlar.map(cozumle);
      const gorulen = new Set<number>();
      const mezarlar = new Map<string, MezarTasi>();
      const silinenler = new Set<string>();
      let liste: KaliciOlay[] = [];
      for (const ham of hamlar) {
        if (ham === undefined) continue;
        const c = Olay.safeParse(ham);
        if (!c.success || gorulen.has(c.data.seq)) continue;
        gorulen.add(c.data.seq);
        liste.push(c.data);
        if (c.data.type === "chat_cleared") {
          const anahtar = sohbetAnahtari(c.data);
          const onceki = mezarlar.get(anahtar);
          if (onceki === undefined || c.data.seq > onceki.seq) mezarlar.set(anahtar, c.data);
        } else if (c.data.type === "chat_deleted") {
          const anahtar = sohbetAnahtari(c.data);
          if (anahtar !== ANA_SOHBET_ID) silinenler.add(anahtar);
        }
      }
      liste.sort((a, b) => a.seq - b.seq);
      // Kırpma `last_seq`'e dokunmaz; yine de en büyük `seq` kırpmadan önce alınır.
      const enBuyuk = liste.length > 0 ? liste[liste.length - 1]!.seq : 0;
      if (mezarlar.size > 0 || silinenler.size > 0) {
        const k: Kirpma = { mezarlar, silinenler };
        liste = liste.filter((o) => kalirMi(o, k));
        const kalan = satirlar.filter((_, i) => kalirMi(hamlar[i], k));
        // Arada `sifirla` geldiyse silinen günlük yeniden yazılmasın.
        if (kalan.length !== satirlar.length && n === nesil) {
          try {
            await depo.satirlariYaz(TELAFI_ANAHTARLARI.olaylar, kalan);
          } catch {
            // Liste yine kırpılmış döner; günlük bir sonraki yüklemede yeniden kırpılır.
          }
        }
      }
      const kayitli = Number(await depo.oku(TELAFI_ANAHTARLARI.sonSeq));
      sonSeq = Math.max(enBuyuk, seqMi(kayitli) ? kayitli : 0);
      siradaki = sonSeq;
      return liste;
    },

    sonSeq: () => sonSeq,

    welcome: (head_seq) => {
      if (head_seq < Math.max(sonSeq, siradaki)) return "geride";
      hedef = head_seq;
      return "tamam";
    },

    esitleniyor: () => hedef !== null && sonSeq < hedef,

    olay: (o) => {
      if (bozuk) return;
      const n = nesil;
      if (o.seq > siradaki) siradaki = o.seq;
      bekleyen++;
      // Dinleyicinin hatası sırayı durdurmaz; olay zaten kalıcıdır.
      sirayaKoy(async () => {
        try {
          await kaydet(o, n);
        } finally {
          bekleyen--;
          if (bekleyen === 0 && uygulanan > 0) {
            uygulanan = 0;
            bosaldi();
          }
        }
      }).catch(() => undefined);
    },

    koptu: () => {
      hedef = null;
    },

    sifirla: () => {
      nesil++;
      sonSeq = 0;
      siradaki = 0;
      hedef = null;
      uygulanan = 0;
      return sirayaKoy(async () => {
        try {
          await depo.sil(TELAFI_ANAHTARLARI.olaylar);
          await depo.sil(TELAFI_ANAHTARLARI.sonSeq);
        } catch (e) {
          bozuk = true;
          nesil++;
          throw e;
        }
      });
    },

    bosalt: () => zincir,
  };
};
