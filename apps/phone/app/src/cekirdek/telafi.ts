/**
 * Kalıcı olay telafisi. Her olay önce kalıcı günlüğe eklenir, ancak sonra uygulanır; `seq <= last_seq`
 * atılır. `last_seq` = günlüğe eklenmiş en büyük `seq`; `hello{last_seq}` bu değerle gider,
 * `welcome{head_seq}` sonrası eksikler sırayla gelir. TASARIM.md "JS modülleri"; protocol README
 * `/sohbet` 2-3.
 *
 * `last_seq` dosyası olay başına yazılmaz: yüklemede günlüğün en büyük `seq`'i zaten hesaplanır.
 * Dosyanın tek gerçek işi, kırpmanın günlükten düşürdüğü en büyük `seq`'i saklamaktır (yoksa sunucu
 * kırpılmış olayı yeniden yollar ve olay ikinci kez uygulanır). Bu yüzden dosya yalnız (1) kırpma en
 * büyük `seq`'i düşürecekse kırpmadan ÖNCE, (2) sıra boşalınca (toplu telafi başına bir kez) yazılır.
 * Yazılan değer hep önceden günlüğe eklenmiş bir `seq`'tir; yüklemede günlükle `max` alınır, eski
 * kurulumda kalan dosya da aynı anlamdadır.
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
  /** Olay günlükte (kalıcı) ve `sonSeq()` ilerledi; `seq` sırasıyla, her olay için bir kez. */
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
  // Diskteki `last_seq`'in bilinen değeri; yalnız gereksiz yazımı önler.
  let kayitliSeq = 0;
  let zincir: Promise<void> = Promise.resolve();

  // `s` günlüğe önceden eklenmiş olmalı. Diskte zaten `>= s` varsa yazmaz. Yazılamazsa `false`.
  // `depo.yaz` eşzamanlı çağrılır: arada gelen `sifirla`'nın silmesi depoda bu yazımdan sonra sıralanır.
  // Yazım beklenirken `sifirla` geldiyse bellekteki değer eski nesle aittir, güncellenmez.
  const seqYaz = async (s: number): Promise<boolean> => {
    if (s <= kayitliSeq) return true;
    const n = nesil;
    try {
      await depo.yaz(TELAFI_ANAHTARLARI.sonSeq, String(s));
      if (n === nesil) kayitliSeq = s;
      return true;
    } catch {
      return false;
    }
  };

  // Canlı mezar taşı ya da `chat_deleted`: günlük o anki haliyle kırpılır. Okunamaz ya da yazılamazsa
  // (atomik) günlük olduğu gibi kalır; olay yine uygulanır, bir sonraki `yukle` aynı kırpmayı yapar.
  // Tetikleyen `o` günlüğün en büyük `seq`'idir ve bugünkü kurallarda kalır; kalmasaydı önce `last_seq`
  // yazılır, yazılamazsa günlük kırpılmaz.
  const kirp = async (o: KaliciOlay, k: Kirpma, n: number): Promise<void> => {
    if (!kalirMi(o, k) && !(await seqYaz(o.seq))) return;
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
    // Olay günlükte: `last_seq` burada yazılmaz, yüklemede günlüğün en büyük `seq`'i hesaba katılır.
    sonSeq = o.seq;
    const k = canliKirpma(o);
    if (k !== null) {
      await kirp(o, k, n);
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
      const kayitli = Number(await depo.oku(TELAFI_ANAHTARLARI.sonSeq));
      // Arada `sifirla` geldiyse okunan her şey silinmiş geçmişe aittir: durum değişmez, liste boş.
      if (n !== nesil) return [];
      kayitliSeq = seqMi(kayitli) ? kayitli : 0;
      // Kırpma `last_seq`'e dokunmaz; yine de en büyük `seq` kırpmadan önce alınır.
      const enBuyuk = liste.length > 0 ? liste[liste.length - 1]!.seq : 0;
      if (mezarlar.size > 0 || silinenler.size > 0) {
        const k: Kirpma = { mezarlar, silinenler };
        liste = liste.filter((o) => kalirMi(o, k));
        const kalan = satirlar.filter((_, i) => kalirMi(hamlar[i], k));
        const kalanEnBuyuk = liste.length > 0 ? liste[liste.length - 1]!.seq : 0;
        // Arada `sifirla` geldiyse silinen günlük yeniden yazılmasın. Kırpma en büyük `seq`'i
        // düşürecekse o önce `last_seq`'e yazılır; yazılamazsa günlük kırpılmaz (liste yine kırpılmış).
        if (
          kalan.length !== satirlar.length &&
          n === nesil &&
          (kalanEnBuyuk >= enBuyuk || (await seqYaz(enBuyuk))) &&
          n === nesil
        ) {
          try {
            await depo.satirlariYaz(TELAFI_ANAHTARLARI.olaylar, kalan);
          } catch {
            // Liste yine kırpılmış döner; günlük bir sonraki yüklemede yeniden kırpılır.
          }
        }
      }
      if (n !== nesil) return [];
      sonSeq = Math.max(enBuyuk, kayitliSeq);
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
            // Toplu telafi başına tek `last_seq` yazımı; doğruluk için gerekmez (bkz. dosya başı).
            const n2 = nesil;
            await seqYaz(sonSeq);
            // Yazım beklenirken `sifirla` geldiyse boşalan parti silinmiş geçmişe aitti.
            if (n2 === nesil) bosaldi();
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
      kayitliSeq = 0;
      return sirayaKoy(async () => {
        try {
          await depo.sil(TELAFI_ANAHTARLARI.olaylar);
          // Eski kurulumda ya da kırpma/boşalma sonrası duran dosya da silinir.
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
