/**
 * JS sohbet çekirdeğinin ekranlara açılan tek yüzeyi (Dilim 2: çoklu sohbet). `baglanti`, `telafi`,
 * `outbox`, `secim` ve sohbet defterini portlarla kurar, her sohbet için ayrı bir `olaylar` + `akis`
 * örneği tutar ve gelen olayları `sohbetAnahtari` ile doğru sohbete yönlendirir. Tek WebSocket, tek
 * telafi günlüğü, tek outbox, tek `last_seq`: `seq` bütün sohbetlerde küreseldir.
 *
 * Ekranlar `cekirdekKur(portlar)`'ın döndüğü `Cekirdek`'i kullanır: `durum()` + `abone()` ile
 * küresel durumu (liste, seçili sohbet, çalışan işler, bağlantı), `sohbet(id)` tutamacıyla tek
 * sohbetin durumunu ve eylemlerini. React: `useSyncExternalStore(c.abone, c.durum)` ve sohbet başına
 * `useSyncExternalStore(s.abone, s.durum)`; ikisi de değişmedikçe aynı nesneyi döner.
 *
 * JS izin üretmez ve `/cihaz`'ı görmez: telefon planında onay ekranı `izinIste(kart.plan_json,
 * kart.plan_hash)` ile köprüden açılır; burada yalnız `plan_decision` yollanır.
 *
 * Davranış: TASARIM.md "Dilim 2: çoklu sohbet" (Olay yönlendirme, Sohbet listesi 6, Okunmamış,
 * Seçili sohbet, Mezar taşı ve silinen sohbet, Yönetim işlemleri) ve Ç6. İmzalar: sozlesme.ts.
 */
import {
  ANA_SOHBET_ID,
  SOHBET_SINIRLARI,
  SOHBET_SURUMU,
  SOHBET_YASAM_OLAYLARI,
  VARSAYILAN_SOHBET_ADI,
  sohbetAnahtari,
} from "@eren/protocol";
import type { SohbetAdi, SohbetId } from "@eren/protocol";
import { akisKur } from "./akis.ts";
import type { Akis } from "./akis.ts";
import { baglantiKur } from "./baglanti.ts";
import type { KimlikliCerceve, WelcomeCercevesi } from "./baglanti.ts";
import { olaylarKur } from "./olaylar.ts";
import type { GorunumOgesi, IsKarti, Olaylar } from "./olaylar.ts";
import { outboxKur } from "./outbox.ts";
import { secimDeposuKur } from "./secim.ts";
import { adHazirla, otomatikAd, ozetleriKur, sohbetDefteriKur } from "./sohbetler.ts";
import { telafiKur } from "./telafi.ts";
import { tuketimKur } from "./tuketim.ts";
import type {
  AckCercevesi,
  BekleyenOge,
  CalisanIs,
  CekirdekDurumu,
  CekirdekFabrikasi,
  GeciciIsTuru,
  GecmisSilSonucu,
  GidenGovde,
  GidenHatasi,
  GonderSonucu,
  IptalEt,
  IsMesaji,
  KaliciOlay,
  MezarTasi,
  OutboxOgesi,
  Sohbet,
  SohbetDurumu,
  SohbetHatasi,
  SohbetOzeti,
  SohbetYasamOlayi,
  SohbetYonetimMesaji,
  SunucuDurumu,
  TuketimDurumu,
} from "./sozlesme.ts";

// Ekran yüzeyi: tipler sözleşmededir, ekranlar onları buradan alır.
export type {
  AdlandirSonucu,
  AkisDurumu,
  BaglantiDurumu,
  BaglantiOzeti,
  BekleyenDurumu,
  BekleyenOge,
  CalisanIs,
  Cekirdek,
  CekirdekDurumu,
  CekirdekPortlari,
  CekirdekSecenekleri,
  GecmisSilHatasi,
  GecmisSilSonucu,
  GecmisSilindiNotu,
  GidenHataKodu,
  GidenHatasi,
  GonderRedNedeni,
  GonderSonucu,
  IptalEt,
  IsMesaji,
  MesajBaglami,
  PlanKarari,
  Sohbet,
  SohbetAcSonucu,
  SohbetDurumu,
  SohbetHatasi,
  SohbetKurulumu,
  SohbetOzeti,
  SohbetSilHatasi,
  SohbetSilSonucu,
  SonMesaj,
  SunucuDurumu,
  TuketimDurumu,
  TuketimRaporu,
} from "./sozlesme.ts";
export type { ServisBilgisi, SohbetAdi, SohbetErenDurumu, SohbetId } from "@eren/protocol";
export type { BaglantiHatasi, YerelBaglantiHatasi } from "./baglanti.ts";
export type {
  AsistanBalonu,
  DevirNotu,
  GizlenenPlan,
  GorunumOgesi,
  IsKarti,
  KesilenTur,
  KullaniciBalonu,
  PlanKartDurumu,
  PlanKarti,
  RaporKarti,
  SistemNotu,
  SoruKartDurumu,
  SoruKarti,
} from "./olaylar.ts";
export { adHazirla } from "./sohbetler.ts";

// Toplu telafide görünüm her olayda değil, bu kadar olayda bir ve sıra boşalınca yenilenir.
const TOPLU_BILDIRIM = 64;

// Canlı `job_finished`'tan bu kadar sonra tüketim istenir; aradaki olaylar tek isteğe birleşir.
const IS_BITTI_TUKETIM_MS = 3_000;

/**
 * `gecmisiSil` ve `sil`: bu sürede `ack` gelmezse `zaman_asimi` döner ve bağlantı yenilenir (yol
 * sessizce ölmüş olabilir). Silme servise ulaştıysa olayı yeniden bağlanınca telafiyle gelir.
 */
export const GECMIS_SIL_SURESI_MS = 20_000;

/**
 * Bağlantı bekçisi: sessizce ölmüş yol (PC uyudu, elektrik gitti; soket düzgün kapanmadı). Servis ping
 * atmaz; telefon da boşta hiçbir şey yollamaz ve zamanlayıcı kurmaz. Bekçi yalnız bu bağlantıda
 * yollanmış, `ack`'i henüz gelmemiş iş mesajı varken kuruludur; gelen her çerçeve canlılık kanıtıdır.
 * - `YANIT_MS`: `ack`'i hemen dönen (kısa) bir mesaj beklenirken bu kadar hiç çerçeve gelmezse yol
 *   ölüdür: bağlantı kapatılır, yeniden bağlanma döngüsü başlar, mesaj yeniden bağlanınca outbox
 *   kurallarıyla yeniden yollanır (servis aynı `client_msg_id`'ye kayıtlı `ack`'i döner, çift iş olmaz).
 * - `YOKLAMA_MS`: yalnız `ack`'i iş başlayınca ya da bitince gelen (`GEC_YANITLI_TURLER`) mesajlar
 *   beklenirken bu kadar sessizlikte tek bir `usage_request` yoklaması yollanır (servis onu hemen
 *   yanıtlar; yanıt `tuketim`'in bekleyen isteği değildir, yok sayılır). Ardından bu kadar daha hiç
 *   çerçeve gelmezse yol ölüdür. Toplam yine `YANIT_MS`.
 * Geçici silmelerin (`chat_clear`, `chat_delete`) kendi süresi vardır (`GECMIS_SIL_SURESI_MS`).
 */
export const BEKCI_SURELERI = { YANIT_MS: 20_000, YOKLAMA_MS: 10_000 } as const;

/** `ack`'i iş başladıktan (`plan_decision`) ya da durduktan (`job_cancel`) sonra gelen türler. */
const GEC_YANITLI_TURLER: ReadonlySet<string> = new Set<IsMesaji["type"]>(["plan_decision", "job_cancel"]);

/** Bir sohbetin görünüm örnekleri: yalnız o sohbetin olaylarını görür. */
interface Ornek {
  readonly olaylar: Olaylar;
  readonly akis: Akis;
}

type KullaniciMesaji = Extract<IsMesaji, { type: "user_message" }>;
type KurulumMesaji = Extract<IsMesaji, { type: "chat_create" | "chat_rename" }>;
type SilmeGovdesi = Extract<GidenGovde, { type: GeciciIsTuru }>;

/**
 * `ack ok` almış, yaşam döngüsü olayı henüz uygulanmamış `chat_create`/`chat_rename`. O sohbetin
 * `seq`'i `seq`'ten küçük olmayan bir yaşam döngüsü olayı uygulanınca çıkar.
 */
interface KurulumTeslimi {
  readonly mesaj: KurulumMesaji;
  readonly seq: number;
}

type KararMesaji = Extract<IsMesaji, { type: "plan_decision" | "question_answer" | "job_cancel" }>;

/**
 * `ack ok` almış, kartı (plan, soru, iş) henüz sonuçlanmamış karar. Servis kararın olayını `ack`'ten
 * önce yazar ve yollar (`gateway.ts`); telefon olayı önce diske yazıp sonra uygular. Arada kart
 * yeniden "bekliyor" görünmesin, aynı karar ikinci kez yollanmasın diye kayıt `bekleyenler`'de
 * `teslim_edildi` olarak durur. Kart sonuçlanınca, kart kalkınca ya da `ack` anına dek alınmış
 * olaylar (`esikSeq`) uygulanıp kart hâlâ bekliyorsa (olay gelmeyecek) düşer: takılı kalmaz.
 */
interface KararTeslimi {
  readonly mesaj: KararMesaji;
  readonly esikSeq: number;
}

interface SilmeIstegi {
  coz: (s: GecmisSilSonucu) => void;
  sure: IptalEt;
}

interface Tutamac {
  readonly sohbet: Sohbet;
  readonly dinleyiciler: Set<(d: SohbetDurumu) => void>;
  kirli: boolean;
}

/** Geçici türler (`GeciciIsTuru`): sonuçları yalnız çağıranın sözündedir, listelerde görünmez. */
const GECICI_TUR_KAYDI: Record<GeciciIsTuru, true> = { chat_clear: true, chat_delete: true };
const geciciMi = (m: IsMesaji): boolean => Object.hasOwn(GECICI_TUR_KAYDI, m.type);

/** `bekleyenler`'de görünen türler: sohbet yönetim mesajları dışındakiler. */
const BEKLEYEN_TUR_KAYDI: Record<Exclude<IsMesaji["type"], SohbetYonetimMesaji["type"]>, true> = {
  user_message: true,
  interrupt: true,
  plan_decision: true,
  question_answer: true,
  job_cancel: true,
};
const bekleyenMi = (m: IsMesaji): boolean => Object.hasOwn(BEKLEYEN_TUR_KAYDI, m.type);

const YASAM_TURLERI: ReadonlySet<string> = new Set<string>(SOHBET_YASAM_OLAYLARI);
const yasamOlayiMi = (o: KaliciOlay): o is SohbetYasamOlayi => YASAM_TURLERI.has(o.type);

const BOS_OGELER: readonly GorunumOgesi[] = [];
const BOS_BEKLEYENLER: readonly BekleyenOge[] = [];
const BOS_HATALAR: readonly GidenHatasi[] = [];
const BOS_KUYRUK: readonly OutboxOgesi[] = [];
const BOS_TESLIMLER: readonly SohbetYonetimMesaji[] = [];
const BOS_CALISANLAR: readonly CalisanIs[] = [];

/** Aynı anahtarlar, her alan `===`. */
const sigEsit = <T extends object>(a: T, b: T): boolean => {
  const anahtarlar = Object.keys(a) as (keyof T)[];
  if (anahtarlar.length !== Object.keys(b).length) return false;
  return anahtarlar.every((k) => a[k] === b[k]);
};

const ayniDizi = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Yeni dizi eskisiyle öğe öğe eşitse eski dizi: abonelerin gördüğü kimlik değişmesin. */
const diziKoru = <T>(eski: readonly T[], yeni: readonly T[], esit: (a: T, b: T) => boolean): readonly T[] =>
  eski.length === yeni.length && eski.every((x, i) => esit(x, yeni[i] as T)) ? eski : yeni;

const ayni = <T>(a: T, b: T): boolean => a === b;

const bekleyenEsit = (a: BekleyenOge, b: BekleyenOge): boolean =>
  a.client_msg_id === b.client_msg_id && a.mesaj === b.mesaj && a.durum === b.durum;

/** Liste satırı sığ eşit mi; `sonMesaj` içeriğiyle karşılaştırılır (`ozetleriKur` her seferinde yeni nesne verebilir). */
const ozetEsit = (a: SohbetOzeti, b: SohbetOzeti): boolean => {
  const anahtarlar = Object.keys(a) as (keyof SohbetOzeti)[];
  if (anahtarlar.length !== Object.keys(b).length) return false;
  for (const k of anahtarlar) {
    if (k !== "sonMesaj" && a[k] !== b[k]) return false;
  }
  const x = a.sonMesaj;
  const y = b.sonMesaj;
  return x === y || (x !== null && y !== null && x.kim === y.kim && x.metin === y.metin);
};

export const cekirdekKur: CekirdekFabrikasi = ({ ws, kimlik, depo, saat }, secenekler = {}) => {
  const dinleyiciler = new Set<(durum: CekirdekDurumu) => void>();
  let onbellek: CekirdekDurumu | null = null;
  let kirli = true;
  let hata: SohbetHatasi | null = null;
  let sunucu: SunucuDurumu | null = null;
  let yuklendi = false;
  let yukleme: Promise<void> | null = null;
  let toplu = 0;

  // `ana`'nın yer tutucu adı görünen asistan adıdır; sunucudan gelen ad onu ezer.
  const anaAdi = secenekler.asistanAdi;
  const defter = sohbetDefteriKur(anaAdi);
  // Yükleme bitmeden liste yalnız `ana`dır: hiç olay görmemiş bir defterin kaydı.
  const bosKayitlar = sohbetDefteriKur(anaAdi).kayitlar();
  const ornekler = new Map<SohbetId, Ornek>();
  const tutamaclar = new Map<SohbetId, Tutamac>();

  // `ack` gelmiş, `user_echo`'su henüz uygulanmamış kullanıcı mesajları (bütün sohbetler).
  const kullaniciTeslimleri = new Map<string, KullaniciMesaji>();
  // `ack ok` almış, kartı henüz sonuçlanmamış kararlar (bütün sohbetler).
  const kararTeslimleri = new Map<string, KararTeslimi>();
  // Gelen olay çerçevelerinin en büyük `seq`'i (kalıcı olmasını beklemeden): karar teslimlerinin eşiği.
  let alinanSeq = 0;
  // Bağlantı bekçisi (`BEKCI_SURELERI`): yalnız `ack` beklenirken kurulu.
  let bekci: IptalEt | null = null;
  // Son canlılık kanıtı: gelen son çerçeve ya da bekçinin kurulduğu an.
  let sonKanitMs = 0;
  // Yanıtı (ya da başka bir çerçeve) beklenen yoklamanın yollandığı an.
  let yoklamaMs: number | null = null;
  let yoklamaSayac = 0;
  let kurulumTeslimleri: readonly KurulumTeslimi[] = [];
  let teslimDizisi: readonly SohbetYonetimMesaji[] = BOS_TESLIMLER;
  // Sohbet başına son mezar taşının `sinir_seq`'i: bu `seq`'e kadarki yankılar silinmiştir.
  const sinirlar = new Map<SohbetId, number>();
  // Mezar taşıyla silinen hatalar: `hataKapat` diske yazana dek de görünmesin.
  const silinenHatalar = new Set<string>();
  // Yoldaki tek silme isteği (`chat_clear` ya da `chat_delete`, hangi sohbette olursa olsun).
  let silmeIstegi: SilmeIstegi | null = null;

  // Seçim kaydı (`SecimKaydi`): yüklemeden önce yazılmaz.
  let secili: SohbetId = ANA_SOHBET_ID;
  let tabanSeq = 0;
  let okundu = new Map<SohbetId, number>();
  let okunduSurum = 0;
  // Yerel sıfırlamadan sonra ilk `welcome.head_seq` taban olur.
  let tabanBekleniyor = false;
  // Son `welcome.head_seq`: bundan büyük `seq`'li olaylar canlıdır, küçük-eşitler telafide yeniden
  // gelenlerdir. İlk `welcome`'a dek hiçbir olay canlı sayılmaz.
  let canliEsikSeq = Number.POSITIVE_INFINITY;
  // Canlı `job_finished` sonrası bekleyen tek tüketim isteği.
  let isBittiTuketim: IptalEt | null = null;
  // Modülün son bildirdiği durum: nesne kimliği yalnız değişince yenilenir (`sigEsit` önbelleği).
  let tuketimDurumu: TuketimDurumu = { durum: "yok" };
  const secimDeposu = secimDeposuKur({ depo });

  // Kendi önbellekleri: girdiler aynıysa aynı sonuç (nesne kimliği korunur).
  let listeOnbellek: {
    anahtar: readonly unknown[];
    liste: readonly SohbetOzeti[];
    harita: ReadonlyMap<SohbetId, SohbetOzeti>;
  } | null = null;
  let hataOnbellek: { kaynak: readonly GidenHatasi[]; sonuc: readonly GidenHatasi[] } | null = null;
  let calisanOnbellek: { anahtar: readonly unknown[]; sonuc: readonly CalisanIs[] } | null = null;
  const calisanNesneleri = new WeakMap<IsKarti, CalisanIs>();

  const secimYaz = (): void => {
    if (!yuklendi) return;
    secimDeposu.yaz({ acik: secili, taban_seq: tabanSeq, okundu: Object.fromEntries(okundu) });
  };

  const okunduSil = (sohbet_id: SohbetId): void => {
    if (!okundu.delete(sohbet_id)) return;
    okunduSurum++;
    secimYaz();
  };

  const ornekAl = (sohbet_id: SohbetId): Ornek => {
    let o = ornekler.get(sohbet_id);
    if (o === undefined) {
      o = { olaylar: olaylarKur(), akis: akisKur() };
      ornekler.set(sohbet_id, o);
    }
    return o;
  };

  /** Kartın (plan, soru, iş) bulunduğu sohbet; bulunamazsa `ana`. */
  const kartSohbeti = (var_: (o: Olaylar) => boolean): SohbetId => {
    for (const [id, o] of ornekler) {
      if (var_(o.olaylar)) return id;
    }
    return ANA_SOHBET_ID;
  };

  /** Bir yukarı mesajın sohbeti (TASARIM.md "Olay yönlendirme"). */
  const mesajSohbeti = (m: IsMesaji): SohbetId => {
    switch (m.type) {
      case "plan_decision":
        return kartSohbeti((o) => o.plan(m.plan_id) !== null);
      case "question_answer":
        return kartSohbeti((o) => o.soru(m.soru_id) !== null);
      case "job_cancel":
        return kartSohbeti((o) => o.is(m.is_id) !== null);
      default:
        return sohbetAnahtari(m);
    }
  };

  const kurulumTeslimleriYaz = (yeni: readonly KurulumTeslimi[]): void => {
    kurulumTeslimleri = yeni;
    teslimDizisi = yeni.length === 0 ? BOS_TESLIMLER : yeni.map((t) => t.mesaj);
  };

  // `outbox.koptu` hatayı `silmeHatalariniKapat`'tan önce bildirir: arada da görünmesin.
  const gizliHataMi = (h: GidenHatasi): boolean => geciciMi(h.mesaj) || silinenHatalar.has(h.client_msg_id);

  const gorunurHatalar = (): readonly GidenHatasi[] => {
    const kaynak = outbox.hatalar();
    if (hataOnbellek !== null && hataOnbellek.kaynak === kaynak) return hataOnbellek.sonuc;
    const sonuc = kaynak.some(gizliHataMi) ? kaynak.filter((h) => !gizliHataMi(h)) : kaynak;
    hataOnbellek = { kaynak, sonuc };
    return sonuc;
  };

  /** Sohbet listesi (`ozetleriKur`); girdileri aynıysa önceki sonuç, satırlar sığ eşitse eski nesneler. */
  const listeAl = (): { liste: readonly SohbetOzeti[]; harita: ReadonlyMap<SohbetId, SohbetOzeti> } => {
    const kayitlar = yuklendi ? defter.kayitlar() : bosKayitlar;
    const kuyruk = yuklendi ? outbox.ogeler() : BOS_KUYRUK;
    const hatalar = yuklendi ? gorunurHatalar() : BOS_HATALAR;
    const teslimler = yuklendi ? teslimDizisi : BOS_TESLIMLER;
    const sunucuSohbetleri = yuklendi ? (sunucu?.sohbetler ?? null) : null;
    const anahtar: unknown[] = [yuklendi, kayitlar, kuyruk, hatalar, teslimler, sunucuSohbetleri, okunduSurum, tabanSeq];
    if (yuklendi) {
      // Özet akıştan yalnız varlığını kullanır (`yaziyor`): her parçada liste yeniden kurulmasın.
      for (const [id, o] of ornekler) anahtar.push(id, o.olaylar.ogeler(), o.akis.durum() !== null);
    }
    if (listeOnbellek !== null && ayniDizi(listeOnbellek.anahtar, anahtar)) return listeOnbellek;
    const ham = ozetleriKur({
      kayitlar,
      kuyruk,
      hatalar,
      teslimler,
      sunucu: sunucuSohbetleri,
      gorunum: (id) => {
        if (!yuklendi) return null;
        const o = ornekler.get(id);
        return o === undefined ? null : { ogeler: o.olaylar.ogeler(), akis: o.akis.durum() };
      },
      okunduSeq: (id) => Math.max(tabanSeq, okundu.get(id) ?? 0),
      anaAdi,
    });
    const eski = listeOnbellek;
    const satirlar = ham.map((s) => {
      const e = eski?.harita.get(s.sohbet_id);
      return e !== undefined && ozetEsit(e, s) ? e : s;
    });
    const liste = eski === null ? satirlar : diziKoru(eski.liste, satirlar, ayni);
    const harita = eski !== null && liste === eski.liste ? eski.harita : new Map(liste.map((s) => [s.sohbet_id, s]));
    listeOnbellek = { anahtar, liste, harita };
    return listeOnbellek;
  };

  const ozetBul = (sohbet_id: SohbetId): SohbetOzeti | null => listeAl().harita.get(sohbet_id) ?? null;

  /** Eylem yapılabilir sohbet: listede ve `kurulamadi` değil. */
  const kullanilirMi = (sohbet_id: SohbetId): boolean => {
    const oz = ozetBul(sohbet_id);
    return oz !== null && oz.kurulum !== "kurulamadi";
  };

  /** Bütün sohbetlerdeki `suruyor` iş kartları, `seq` sırasıyla. */
  const calisanIslerAl = (): readonly CalisanIs[] => {
    if (!yuklendi) return BOS_CALISANLAR;
    const anahtar: unknown[] = [];
    for (const [id, o] of ornekler) anahtar.push(id, o.olaylar.ogeler());
    if (calisanOnbellek !== null && ayniDizi(calisanOnbellek.anahtar, anahtar)) return calisanOnbellek.sonuc;
    const yeni: CalisanIs[] = [];
    for (const [id, o] of ornekler) {
      for (const oge of o.olaylar.ogeler()) {
        if (oge.tur !== "is" || oge.durum !== "suruyor") continue;
        let c = calisanNesneleri.get(oge);
        if (c === undefined) {
          c = { sohbet_id: id, is: oge };
          calisanNesneleri.set(oge, c);
        }
        yeni.push(c);
      }
    }
    yeni.sort((a, b) => a.is.seq - b.is.seq);
    const sonuc = calisanOnbellek === null ? yeni : diziKoru(calisanOnbellek.sonuc, yeni, ayni);
    calisanOnbellek = { anahtar, sonuc };
    return sonuc;
  };

  /**
   * Seçili sohbet listede yoksa (silindi, yerel kaldırıldı) en son etkin sohbet seçilir: defterde
   * kaydı olan ilk satır (liste kuralı 5: kayıtlılar `sonEtkinlikMs` azalan). Başta duran kayıtsız
   * satırlar (kurulamadı, bekliyor, teslim) atlanır; etkinlikleri bilinmez. `ana` hep kayıtlıdır.
   */
  const seciliDenetle = (): void => {
    const { liste, harita } = listeAl();
    if (harita.has(secili)) return;
    secili = liste.find((s) => s.sonEtkinlikMs !== null)?.sohbet_id ?? ANA_SOHBET_ID;
    secimYaz();
  };

  // Birden çok adımlı güncellemenin arasında (`outbox.ack` öğeyi kuyruktan çıkardı, teslim henüz
  // eklenmedi) bildirim yapılmaz: sohbet bir anlığına listeden düşüp seçim kaymasın, ekran titremesin.
  let ertele = 0;
  const ertelenmis = <T>(f: () => T): T => {
    ertele++;
    try {
      return f();
    } finally {
      ertele--;
    }
  };

  const bildir = (): void => {
    kirli = true;
    for (const t of tutamaclar.values()) t.kirli = true;
    if (ertele > 0) return;
    if (yuklendi) seciliDenetle();
    if (dinleyiciler.size > 0) {
      const d = durum();
      for (const f of [...dinleyiciler]) {
        try {
          f(d);
        } catch {
          // Bir ekranın hatası ötekileri durdurmaz.
        }
      }
    }
    for (const t of [...tutamaclar.values()]) {
      if (t.dinleyiciler.size === 0) continue;
      const d = t.sohbet.durum();
      for (const f of [...t.dinleyiciler]) {
        try {
          f(d);
        } catch {
          // Bir ekranın hatası ötekileri durdurmaz.
        }
      }
    }
  };

  // --- Bağlantı bekçisi (`BEKCI_SURELERI`) ---------------------------------------------------------

  const bekciDurdur = (): void => {
    yoklamaMs = null;
    if (bekci === null) return;
    const iptal = bekci;
    bekci = null;
    iptal();
  };

  /** Bu bağlantıda yollanmış, `ack`'i gelmemiş mesajlar: kısa olan var mı, geç yanıtlı olan var mı. */
  const yanitBekleyenler = (): { kisa: boolean; gec: boolean } => {
    let kisa = false;
    let gec = false;
    for (const g of outbox.ogeler()) {
      if (!g.yollandi || geciciMi(g.mesaj)) continue;
      if (GEC_YANITLI_TURLER.has(g.mesaj.type)) gec = true;
      else kisa = true;
    }
    return { kisa, gec };
  };

  const bekciKur = (kisa: boolean): void => {
    const simdi = saat.simdiMs();
    const son = kisa
      ? sonKanitMs + BEKCI_SURELERI.YANIT_MS
      : (yoklamaMs ?? sonKanitMs) + BEKCI_SURELERI.YOKLAMA_MS;
    bekci = saat.sonra(Math.max(1, son - simdi), bekciCalis);
  };

  // Süre doldu: arada çerçeve geldiyse kalan süreyle yeniden kurulur (çerçeve başına zamanlayıcı yok).
  const bekciCalis = (): void => {
    bekci = null;
    const { kisa, gec } = yanitBekleyenler();
    if (!kisa && !gec) {
      yoklamaMs = null;
      return;
    }
    const simdi = saat.simdiMs();
    if (kisa) {
      if (simdi - sonKanitMs >= BEKCI_SURELERI.YANIT_MS) {
        bekciDurdur();
        baglanti.kopar("normal");
        return;
      }
    } else if (yoklamaMs !== null) {
      if (simdi - yoklamaMs >= BEKCI_SURELERI.YOKLAMA_MS) {
        bekciDurdur();
        baglanti.kopar("normal");
        return;
      }
    } else if (simdi - sonKanitMs >= BEKCI_SURELERI.YOKLAMA_MS) {
      yoklamaMs = simdi;
      yoklamaSayac++;
      // Yollanamazsa (bağlı değil) bir sonraki çalışmada kopar: zararsız.
      baglanti.sorguGonder({ v: SOHBET_SURUMU, type: "usage_request", istek_id: `yoklama-${yoklamaSayac}` });
    }
    bekciKur(kisa);
  };

  /** Outbox her değiştiğinde: `ack` beklenen mesaj yoksa bekçi durur, varsa (kurulu değilse) kurulur. */
  const bekciDenetle = (): void => {
    const { kisa, gec } = yanitBekleyenler();
    if (!kisa && !gec) {
      bekciDurdur();
      return;
    }
    if (bekci !== null) return;
    sonKanitMs = saat.simdiMs();
    yoklamaMs = null;
    bekciKur(kisa);
  };

  /** Gelen her çerçeve: yol canlı. */
  const canlilikKaniti = (): void => {
    sonKanitMs = saat.simdiMs();
    yoklamaMs = null;
  };

  const outbox = outboxKur({
    depo,
    saat,
    degisti: () => {
      bekciDenetle();
      bildir();
    },
  });

  /**
   * `ack ok` almış `chat_create`'in outbox'ta tutulan disk kopyasını bırakır: olayı telafi günlüğüne
   * yazıldı (telafi `uygulandi`'yı kalıcı olunca çağırır) ya da hiç gerekmiyor. Kuyrukta yollanmış
   * bir kopyası da kalkar; geç gelen `ack`'i bilinmeyen `ack` gibi zararsızdır.
   */
  const kurulumBirak = (uyar: (m: IsMesaji) => boolean): void => {
    outbox.kaldir((m) => m.type === "chat_create" && uyar(m)).catch(() => undefined);
  };

  const silmeBitir = (s: GecmisSilSonucu): void => {
    const istek = silmeIstegi;
    if (istek === null) return;
    silmeIstegi = null;
    istek.sure();
    istek.coz(s);
  };

  // Geçici türlerin (`chat_clear`, `chat_delete`) sonucu yalnız çağıranın sözünden döner: hatalara
  // düşen kaydı kalmaz.
  const silmeHatalariniKapat = (): void => {
    for (const h of outbox.hatalar()) {
      if (geciciMi(h.mesaj)) outbox.hataKapat(h.client_msg_id).catch(() => undefined);
    }
  };

  /**
   * Mezar taşı yalnız kendi sohbetine: yankıları silinen kullanıcı mesajları teslimlerden kalkar.
   * Canlıda o sohbetin gönderilemeyen mesajları da silinir (metinleri telefonda kalmaz); `kapanacak`
   * kart silinmeden önce bulunmuştur. Yüklemede atlanır: o anki hatalar mezar taşından sonra düşmüş
   * olabilir, öncekiler mezar taşı ilk geldiğinde silinmişti.
   */
  const mezarTasiUygula = (o: MezarTasi, sohbet_id: SohbetId, kapanacak: readonly GidenHatasi[] | null): void => {
    sinirlar.set(sohbet_id, Math.max(sinirlar.get(sohbet_id) ?? 0, o.sinir_seq));
    for (const [client_msg_id, mesaj] of kullaniciTeslimleri) {
      if (sohbetAnahtari(mesaj) === sohbet_id) kullaniciTeslimleri.delete(client_msg_id);
    }
    if (kapanacak === null) return;
    for (const h of kapanacak) {
      silinenHatalar.add(h.client_msg_id);
      outbox.hataKapat(h.client_msg_id).catch(() => undefined);
    }
    hataOnbellek = null;
  };

  /** Silinen sohbet (TASARIM.md "Mezar taşı ve silinen sohbet"). Seçiliyse `bildir` başkasını seçer. */
  const sohbetSilindi = (sohbet_id: SohbetId, canli: boolean): void => {
    // Örnek kalkmadan önce: plan/soru/iş kararlarının sohbeti kart dururken bulunur.
    if (canli && yuklendi) outbox.kaldir((m) => mesajSohbeti(m) === sohbet_id).catch(() => undefined);
    ornekler.delete(sohbet_id);
    sinirlar.delete(sohbet_id);
    for (const [client_msg_id, mesaj] of kullaniciTeslimleri) {
      if (sohbetAnahtari(mesaj) === sohbet_id) kullaniciTeslimleri.delete(client_msg_id);
    }
    const kalan = kurulumTeslimleri.filter((t) => sohbetAnahtari(t.mesaj) !== sohbet_id);
    if (kalan.length !== kurulumTeslimleri.length) kurulumTeslimleriYaz(kalan);
    okunduSil(sohbet_id);
  };

  const yasamUygula = (o: SohbetYasamOlayi, canli: boolean): void => {
    defter.olay(o);
    const sohbet_id = sohbetAnahtari(o);
    const kalan = kurulumTeslimleri.filter((t) => !(sohbetAnahtari(t.mesaj) === sohbet_id && t.seq <= o.seq));
    if (kalan.length !== kurulumTeslimleri.length) kurulumTeslimleriYaz(kalan);
    if (canli && yuklendi && o.type === "chat_created") kurulumBirak((m) => sohbetAnahtari(m) === sohbet_id);
    if (o.type === "chat_deleted" && defter.silindiMi(sohbet_id)) sohbetSilindi(sohbet_id, canli);
  };

  /** `canli`: olay şimdi geldi (telafi), diskten yeniden kurulmuyor. */
  const uygula = (o: KaliciOlay, canli: boolean): void => {
    if (yasamOlayiMi(o)) {
      yasamUygula(o, canli);
      return;
    }
    const sohbet_id = sohbetAnahtari(o);
    if (defter.silindiMi(sohbet_id)) return;
    const kapanacak =
      canli && o.type === "chat_cleared"
        ? outbox.hatalar().filter((h) => mesajSohbeti(h.mesaj) === sohbet_id)
        : null;
    const ornek = ornekAl(sohbet_id);
    ornek.olaylar.ekle(o);
    ornek.akis.olay(o);
    if (o.type === "user_echo") kullaniciTeslimleri.delete(o.client_msg_id);
    if (o.type === "chat_cleared") mezarTasiUygula(o, sohbet_id, kapanacak);
  };

  const telafi = telafiKur({
    depo,
    uygulandi: (o) => {
      ertelenmis(() => uygula(o, true));
      kararTeslimleriniDenetle();
      // Yalnız `welcome.head_seq`'ten sonraki (canlı) bitişler: telafide yeniden gelenler değil.
      if (o.type === "job_finished" && o.seq > canliEsikSeq) isBittiTuketimPlanla();
      if (++toplu >= TOPLU_BILDIRIM) {
        toplu = 0;
        bildir();
      }
    },
    bosaldi: () => {
      toplu = 0;
      bildir();
    },
    yazilamadi: () => {
      hata = "depo_hatasi";
      baglanti.kopar("uzun");
      bildir();
    },
  });

  const sifirla = async (): Promise<void> => {
    const silme = telafi.sifirla();
    baglanti.kopar("normal");
    ornekler.clear();
    defter.sifirla();
    kullaniciTeslimleri.clear();
    kararTeslimleri.clear();
    alinanSeq = 0;
    // Bellekten düşen teslimlerin disk kopyası da gider: sonraki açılışta sohbet geri gelmesin.
    const tutulan = new Set(kurulumTeslimleri.map((t) => t.mesaj.client_msg_id));
    if (tutulan.size > 0) kurulumBirak((m) => tutulan.has(m.client_msg_id));
    kurulumTeslimleriYaz([]);
    // Yeni geçmişin `seq`'leri baştan başlar: eski sınır yeni `ack`'leri yanlış eler.
    sinirlar.clear();
    okundu = new Map();
    okunduSurum++;
    tabanSeq = 0;
    tabanBekleniyor = true;
    if (!listeAl().harita.has(secili)) secili = ANA_SOHBET_ID;
    secimYaz();
    bildir();
    try {
      await silme;
    } catch {
      // Eski günlük kaldı: yeni geçmiş üstüne karışmasın diye bağlanmayı bırak.
      hata = "depo_hatasi";
      baglanti.durdur();
      bildir();
    }
  };

  const kullaniciTeslimiAl = (m: KullaniciMesaji, seq: number | null): void => {
    const sohbet_id = sohbetAnahtari(m);
    if (defter.silindiMi(sohbet_id)) return;
    if (ornekler.get(sohbet_id)?.olaylar.yankiVar(m.client_msg_id) === true) return;
    // Yankısı mezar taşıyla silinmiş (yeniden yollanınca servisin kayıtlı `ack`'i): hiç gelmeyecek.
    const sinir = sinirlar.get(sohbet_id);
    if (seq !== null && sinir !== undefined && seq <= sinir) return;
    kullaniciTeslimleri.set(m.client_msg_id, m);
  };

  /** Kararın kartı (hangi sohbette olursa olsun) hâlâ karar bekliyor mu; kart yoksa `false`. */
  const kararKartiBekliyorMu = (m: KararMesaji): boolean => {
    for (const o of ornekler.values()) {
      switch (m.type) {
        case "plan_decision": {
          const k = o.olaylar.plan(m.plan_id);
          if (k !== null) return k.durum === "bekliyor";
          break;
        }
        case "question_answer": {
          const k = o.olaylar.soru(m.soru_id);
          if (k !== null) return k.durum === "bekliyor";
          break;
        }
        case "job_cancel": {
          const k = o.olaylar.is(m.is_id);
          if (k !== null) return k.durum === "suruyor";
          break;
        }
      }
    }
    return false;
  };

  /** Teslim, `ack` anına dek alınmış olaylar uygulanmadıkça ve kart beklerken sürer. */
  const kararTeslimiSurerMi = (t: KararTeslimi): boolean =>
    telafi.sonSeq() < t.esikSeq && kararKartiBekliyorMu(t.mesaj);

  /** Her uygulanan olaydan sonra: kartı sonuçlanan ya da olayı gelmeyecek teslimler düşer. */
  const kararTeslimleriniDenetle = (): void => {
    if (kararTeslimleri.size === 0) return;
    for (const [client_msg_id, t] of kararTeslimleri) {
      if (!kararTeslimiSurerMi(t)) kararTeslimleri.delete(client_msg_id);
    }
  };

  /**
   * Karar `ack ok`: servis olayı `ack`'ten önce yolladı. Olay henüz uygulanmadıysa (kart bekliyor,
   * `telafi` sırasında) teslime girer; uygulandıysa ya da hiç alınmadıysa girmez.
   */
  const kararTeslimiAl = (m: KararMesaji): void => {
    const t: KararTeslimi = { mesaj: m, esikSeq: alinanSeq };
    if (kararTeslimiSurerMi(t)) kararTeslimleri.set(m.client_msg_id, t);
  };

  /** Aynı karta ait karar kuyrukta ya da teslimde (`ack` almış, olayı uygulanmamış). */
  const kararYoldaMi = (uyar: (m: IsMesaji) => boolean): boolean => {
    if (kuyruktaMi(uyar)) return true;
    for (const t of kararTeslimleri.values()) {
      if (uyar(t.mesaj)) return true;
    }
    return false;
  };

  /**
   * `chat_create`/`chat_rename` `ack ok`: olayı henüz uygulanmadıysa teslimlere girer, böylece `ack`
   * ile olay arasında sohbet ya da ad geri gidip gelmez. Yan etkisiz `ok` (`seq` yok) girmez; tek
   * istisna, defterde henüz olmayan sohbetin `chat_create`'i: servis "zaten var" dedi ama olayı bu
   * telefonda henüz uygulanmadı (ilk `ack` kaybolmuş, yeniden yollanmış); o sohbetin herhangi bir
   * yaşam döngüsü olayına dek listede kalsın. Teslime girdiyse `true`.
   */
  const kurulumTeslimiAl = (m: KurulumMesaji, seq: number | null): boolean => {
    const sohbet_id = sohbetAnahtari(m);
    if (defter.silindiMi(sohbet_id)) return false;
    if (seq !== null) {
      if (telafi.sonSeq() >= seq) return false;
    } else if (m.type !== "chat_create" || defter.kayitlar().has(sohbet_id)) {
      return false;
    }
    kurulumTeslimleriYaz([...kurulumTeslimleri, { mesaj: m, seq: seq ?? 0 }]);
    return true;
  };

  /** Çağıran ardından `bildir` eder. */
  const ackAl = (a: AckCercevesi): void => ertelenmis(() => ackIsle(a));

  const ackIsle = (a: AckCercevesi): void => {
    const s = outbox.ack(a);
    if (s === null) return;
    const m = s.mesaj;
    switch (m.type) {
      case "chat_clear":
      case "chat_delete":
        // Yolda en çok bir silme olur (`zaten_yollandi`): bu `ack` yoldaki isteğindir.
        if (!s.ok) silmeHatalariniKapat();
        silmeBitir(s.ok ? { ok: true } : { ok: false, kod: s.kod });
        return;
      case "chat_create":
      case "chat_rename":
        // Teslime girmeyen `chat_create`'in (olayı zaten uygulandı ya da sohbet silindi) disk
        // kopyası hemen bırakılır; girenin kopyası `chat_created` uygulanınca.
        if (s.ok && !kurulumTeslimiAl(m, s.seq) && m.type === "chat_create") {
          kurulumBirak((x) => x.client_msg_id === m.client_msg_id);
        }
        return;
      case "user_message":
        if (s.ok) kullaniciTeslimiAl(m, s.seq);
        return;
      case "plan_decision":
      case "question_answer":
      case "job_cancel":
        if (s.ok) kararTeslimiAl(m);
        return;
      default:
        return;
    }
  };

  const cerceveAl = (c: KimlikliCerceve): void => {
    canlilikKaniti();
    switch (c.type) {
      case "event":
        if (c.event.seq > alinanSeq) alinanSeq = c.event.seq;
        telafi.olay(c.event);
        return;
      case "ack":
        ackAl(c);
        bildir();
        return;
      case "assistant_delta":
      case "stream_snapshot": {
        const sohbet_id = sohbetAnahtari(c);
        if (defter.silindiMi(sohbet_id)) return;
        if (ornekAl(sohbet_id).akis.cerceve(c)) bildir();
        return;
      }
      case "server_status": {
        const { v: _v, type: _t, ...govde } = c;
        sunucu = govde;
        bildir();
        return;
      }
      case "usage_report":
        tuketim.rapor(c);
        return;
    }
  };

  const kimlikTamam = (w: WelcomeCercevesi): void => {
    hata = null;
    canliEsikSeq = w.head_seq;
    if (telafi.welcome(w.head_seq) === "geride") {
      // Bilgisayarın geçmişi telefondakinin gerisinde (veritabanı yenilenmiş): yeni olaylar eski
      // `seq`'leri yeniden kullanır ve atılırdı. Yerel geçmiş silinir, baştan çekilir.
      void sifirla();
      return;
    }
    if (tabanBekleniyor) {
      // Sıfırlamadan sonra baştan çekilen eski geçmiş okunmamış görünmesin.
      tabanBekleniyor = false;
      tabanSeq = w.head_seq;
      okundu = new Map();
      okunduSurum++;
      secimYaz();
    }
    outbox.kimlikTamam((m) => baglanti.gonder(m));
    bildir();
    tuketim.iste();
  };

  const baglanti = baglantiKur({
    ws,
    kimlik,
    saat,
    sonSeq: () => telafi.sonSeq(),
    dinleyici: {
      durumDegisti: bildir,
      hata: (h) => {
        hata = h;
        bildir();
      },
      kimlikTamam,
      cerceve: cerceveAl,
      koptu: () => {
        bekciDurdur();
        // Geçici silme istekleri kuyruktan hatalara düştü: yeniden yollanmaz, sonucu belirsizdir.
        outbox.koptu();
        silmeHatalariniKapat();
        silmeBitir({ ok: false, kod: "baglanti_koptu" });
        for (const o of ornekler.values()) o.akis.koptu();
        telafi.koptu();
        sunucu = null;
        isBittiTuketimIptal();
        tuketim.koptu();
        bildir();
      },
    },
  });

  // Tüketim raporu: istek bellekte, outbox'a ve kalıcı kuyruğa girmez (`sorguGonder` doğrudan yollar).
  const tuketim = tuketimKur({
    saat,
    gonder: (m) => baglanti.sorguGonder(m),
    bildir: () => {
      tuketimDurumu = tuketim.durum();
      bildir();
    },
  });
  tuketimDurumu = tuketim.durum();

  const isBittiTuketimIptal = (): void => {
    if (isBittiTuketim === null) return;
    const iptal = isBittiTuketim;
    isBittiTuketim = null;
    iptal();
  };

  const isBittiTuketimPlanla = (): void => {
    if (isBittiTuketim !== null) return;
    isBittiTuketim = saat.sonra(IS_BITTI_TUKETIM_MS, () => {
      isBittiTuketim = null;
      // Zorla: art arda biten işlerde ikinci işin tüketimi tazelik kuralına takılmasın.
      tuketim.iste(true);
    });
  };

  const durum = (): CekirdekDurumu => {
    if (!kirli && onbellek !== null) return onbellek;
    kirli = false;
    const yeni: CekirdekDurumu = {
      baglanti: baglanti.durum(),
      sonrakiDenemeMs: baglanti.sonrakiDenemeMs(),
      hata,
      esitleniyor: telafi.esitleniyor(),
      sunucu,
      yuklendi,
      sohbetler: listeAl().liste,
      secili,
      calisanIsler: calisanIslerAl(),
      tuketim: tuketimDurumu,
    };
    if (onbellek !== null && sigEsit(onbellek, yeni)) return onbellek;
    onbellek = yeni;
    return yeni;
  };

  const hazirMi = async (): Promise<boolean> => {
    if (yuklendi) return true;
    if (yukleme === null) return false;
    try {
      await yukleme;
      return true;
    } catch {
      return false;
    }
  };

  const yolla = async (govde: GidenGovde, gecici = false): Promise<GonderSonucu> => {
    const s = await outbox.ekle(govde, { gecici });
    return s.ok ? s : { ok: false, neden: s.neden };
  };

  const kuyruktaMi = (uyar: (m: IsMesaji) => boolean): boolean => outbox.ogeler().some((g) => uyar(g.mesaj));

  /** Bu sohbette kullanıcı mesajı var mı: görünümde, teslimde ya da kuyrukta (otomatik ad). */
  const kullaniciMesajiVar = (sohbet_id: SohbetId): boolean => {
    if (ornekler.get(sohbet_id)?.olaylar.ogeler().some((o) => o.tur === "kullanici") === true) return true;
    for (const m of kullaniciTeslimleri.values()) {
      if (sohbetAnahtari(m) === sohbet_id) return true;
    }
    return kuyruktaMi((m) => m.type === "user_message" && sohbetAnahtari(m) === sohbet_id);
  };

  /** Kurulamamış sohbetin bütün yerel artıkları (kuyruk ve hatalar) ve okunmuş girdisi. */
  const yerelKaldir = async (sohbet_id: SohbetId): Promise<void> => {
    okunduSil(sohbet_id);
    await outbox.kaldir((m) => mesajSohbeti(m) === sohbet_id);
  };

  /**
   * Geçici silme (`chat_clear`, `chat_delete`): yalnız bağlıyken, tek yuva, `ack`/kopma/20 sn çözer.
   * Kuyrukta bekleyen silme, bilinmeyen bir anda gelecekteki geçmişi silebilirdi.
   */
  const silmeYolla = async (govde: SilmeGovdesi): Promise<GecmisSilSonucu> => {
    if (baglanti.durum() !== "bagli") return { ok: false, kod: "bagli_degil" };
    if (silmeIstegi !== null) return { ok: false, kod: "zaten_yollandi" };
    // Söz `ekle`'den önce kurulur: `ack` ya da kopma yazım sürerken de gelebilir.
    let coz: (s: GecmisSilSonucu) => void = () => undefined;
    const sonuc = new Promise<GecmisSilSonucu>((r) => {
      coz = r;
    });
    const istek: SilmeIstegi = { coz, sure: () => undefined };
    silmeIstegi = istek;
    // Ping yok ve bekçi geçici silmeleri izlemez: sessizce ölmüş yolda söz ve ekran sonsuza dek beklerdi.
    istek.sure = saat.sonra(GECMIS_SIL_SURESI_MS, () => {
      if (silmeIstegi !== istek) return;
      silmeBitir({ ok: false, kod: "zaman_asimi" });
      baglanti.kopar("normal");
    });
    const s = await outbox.ekle(govde, { gecici: true });
    if (!s.ok && silmeIstegi === istek) {
      // `gecersiz`: kendi kurduğumuz mesaj şemaya uymadı, telefonun iç hatası.
      silmeBitir({ ok: false, kod: s.neden === "depo_hatasi" ? "depo_hatasi" : "ic_hata" });
    }
    return sonuc;
  };

  const bekleyenlerKur = (sohbet_id: SohbetId, ornek: Ornek | undefined): readonly BekleyenOge[] => {
    const sonuc: BekleyenOge[] = [];
    for (const [client_msg_id, mesaj] of kullaniciTeslimleri) {
      if (sohbetAnahtari(mesaj) === sohbet_id) sonuc.push({ client_msg_id, mesaj, durum: "teslim_edildi" });
    }
    // `ack`'i gelmiş, kartı henüz sonuçlanmamış kararlar: kart arada yeniden "bekliyor" görünmesin.
    for (const [client_msg_id, t] of kararTeslimleri) {
      if (mesajSohbeti(t.mesaj) === sohbet_id) sonuc.push({ client_msg_id, mesaj: t.mesaj, durum: "teslim_edildi" });
    }
    for (const g of outbox.ogeler()) {
      if (!bekleyenMi(g.mesaj) || mesajSohbeti(g.mesaj) !== sohbet_id) continue;
      // `ack`'ten önce gelen yankı: balon iki kez görünmesin.
      if (g.mesaj.type === "user_message" && ornek?.olaylar.yankiVar(g.client_msg_id) === true) continue;
      sonuc.push({ client_msg_id: g.client_msg_id, mesaj: g.mesaj, durum: g.yollandi ? "yollandi" : "kuyrukta" });
    }
    return sonuc.length === 0 ? BOS_BEKLEYENLER : sonuc;
  };

  const tutamacKur = (sohbet_id: SohbetId): Tutamac => {
    let onbellekS: SohbetDurumu | null = null;
    let bekleyenler: readonly BekleyenOge[] = BOS_BEKLEYENLER;
    let hatalar: readonly GidenHatasi[] = BOS_HATALAR;

    const durumS = (): SohbetDurumu => {
      if (!t.kirli && onbellekS !== null) return onbellekS;
      t.kirli = false;
      const ornek = ornekler.get(sohbet_id);
      bekleyenler = diziKoru(bekleyenler, bekleyenlerKur(sohbet_id, ornek), bekleyenEsit);
      hatalar = diziKoru(
        hatalar,
        gorunurHatalar().filter((h) => mesajSohbeti(h.mesaj) === sohbet_id),
        ayni,
      );
      const yeni: SohbetDurumu = {
        baglanti: baglanti.durum(),
        sonrakiDenemeMs: baglanti.sonrakiDenemeMs(),
        hata,
        esitleniyor: telafi.esitleniyor(),
        sunucu,
        sohbet_id,
        ozet: ozetBul(sohbet_id),
        ogeler: ornek?.olaylar.ogeler() ?? BOS_OGELER,
        akis: ornek?.akis.durum() ?? null,
        bekleyenler,
        hatalar,
      };
      if (onbellekS !== null && sigEsit(onbellekS, yeni)) return onbellekS;
      onbellekS = yeni;
      return yeni;
    };

    const sohbet: Sohbet = {
      sohbet_id,

      durum: durumS,

      abone: (f) => {
        t.dinleyiciler.add(f);
        try {
          f(durumS());
        } catch {
          // Dinleyicinin hatası aboneliği bozmaz.
        }
        return () => {
          t.dinleyiciler.delete(f);
        };
      },

      mesajYolla: async (metin, input, baglam) => {
        // Bağlam yalnız kısayolla: başka yolla gelmişse çağıranın hatasıdır, hiçbir şey yazılmaz.
        if (baglam !== undefined && input !== "kisayol") return { ok: false, neden: "gecersiz" };
        if (!(await hazirMi())) return { ok: false, neden: "baslamadi" };
        const oz = ozetBul(sohbet_id);
        if (oz === null || oz.kurulum === "kurulamadi") return { ok: false, neden: "sohbet_bulunamadi" };
        // Koşul mesajdan önce: bu, sohbetin ilk kullanıcı mesajı mı.
        const otomatik = !oz.ana && oz.ad === VARSAYILAN_SOHBET_ADI && !kullaniciMesajiVar(sohbet_id);
        // Bağlamın şeması (paket deseni, ad uzunluğu) outbox'ta kablo şemasıyla doğrulanır.
        const s = await yolla({
          type: "user_message",
          sohbet_id,
          input,
          text: metin,
          ...(baglam !== undefined ? { baglam: { paket: baglam.paket, ad: baglam.ad } } : {}),
        });
        // Arada kullanıcı adlandırdıysa onun adı kalır.
        if (s.ok && otomatik && ozetBul(sohbet_id)?.ad === VARSAYILAN_SOHBET_ADI) {
          const ad = otomatikAd(metin);
          if (ad !== null) {
            try {
              await outbox.ekle({ type: "chat_rename", sohbet_id, ad });
            } catch {
              // Otomatik adın sonucu yutulur.
            }
          }
        }
        return s;
      },

      planKarari: async (plan_id, plan_hash, karar) => {
        if (!(await hazirMi())) return { ok: false, neden: "baslamadi" };
        if (!kullanilirMi(sohbet_id)) return { ok: false, neden: "sohbet_bulunamadi" };
        const kart = ornekler.get(sohbet_id)?.olaylar.plan(plan_id) ?? null;
        if (kart === null || kart.plan_hash !== plan_hash) return { ok: false, neden: "plan_yok" };
        if (kart.durum !== "bekliyor") return { ok: false, neden: "plan_sonuclandi" };
        if (kararYoldaMi((m) => m.type === "plan_decision" && m.plan_id === plan_id)) {
          return { ok: false, neden: "zaten_yollandi" };
        }
        return yolla({ type: "plan_decision", plan_id, plan_hash, karar });
      },

      soruCevapla: async (soru_id, cevap) => {
        if (!(await hazirMi())) return { ok: false, neden: "baslamadi" };
        if (!kullanilirMi(sohbet_id)) return { ok: false, neden: "sohbet_bulunamadi" };
        const kart = ornekler.get(sohbet_id)?.olaylar.soru(soru_id) ?? null;
        if (kart === null) return { ok: false, neden: "soru_yok" };
        if (kart.durum !== "bekliyor") return { ok: false, neden: "soru_sonuclandi" };
        if (kararYoldaMi((m) => m.type === "question_answer" && m.soru_id === soru_id)) {
          return { ok: false, neden: "zaten_yollandi" };
        }
        return yolla({ type: "question_answer", soru_id, cevap });
      },

      isIptal: async (is_id) => {
        if (!(await hazirMi())) return { ok: false, neden: "baslamadi" };
        if (!kullanilirMi(sohbet_id)) return { ok: false, neden: "sohbet_bulunamadi" };
        const kart = ornekler.get(sohbet_id)?.olaylar.is(is_id) ?? null;
        if (kart === null) return { ok: false, neden: "is_yok" };
        if (kart.durum !== "suruyor") return { ok: false, neden: "is_bitti" };
        if (kararYoldaMi((m) => m.type === "job_cancel" && m.is_id === is_id)) {
          return { ok: false, neden: "zaten_yollandi" };
        }
        return yolla({ type: "job_cancel", is_id });
      },

      kes: async (turn_id) => {
        if (!(await hazirMi())) return { ok: false, neden: "baslamadi" };
        if (!kullanilirMi(sohbet_id)) return { ok: false, neden: "sohbet_bulunamadi" };
        const hedef = turn_id ?? ornekler.get(sohbet_id)?.akis.durum()?.turn_id;
        if (hedef !== undefined) return yolla({ type: "interrupt", sohbet_id, turn_id: hedef });
        // Hedefsiz kesme kuyrukta bekleyip sonradan başlayan bir turu öldürebilirdi.
        if (baglanti.durum() !== "bagli") return { ok: false, neden: "bagli_degil" };
        return yolla({ type: "interrupt", sohbet_id }, true);
      },

      hataKapat: async (client_msg_id) => {
        if (!(await hazirMi())) return;
        const h = outbox.hatalar().find((x) => x.client_msg_id === client_msg_id);
        if (h !== undefined && h.mesaj.type === "chat_create") {
          const hedef = sohbetAnahtari(h.mesaj);
          if (ozetBul(hedef)?.kurulum === "kurulamadi") {
            // Kurulamamış sohbetin hatası kapanınca sohbet de bütün artıklarıyla kalkar.
            await yerelKaldir(hedef).catch(() => undefined);
            return;
          }
        }
        await outbox.hataKapat(client_msg_id);
      },

      gecmisiSil: async () => {
        if (!(await hazirMi())) return { ok: false, kod: "baslamadi" };
        if (!kullanilirMi(sohbet_id)) return { ok: false, kod: "sohbet_bulunamadi" };
        return silmeYolla({ type: "chat_clear", sohbet_id });
      },

      adlandir: async (ad) => {
        if (!(await hazirMi())) return { ok: false, neden: "baslamadi" };
        const oz = ozetBul(sohbet_id);
        if (oz === null || oz.kurulum === "kurulamadi") return { ok: false, neden: "sohbet_bulunamadi" };
        const yeniAd = adHazirla(ad);
        if (yeniAd === null) return { ok: false, neden: "gecersiz" };
        if (yeniAd === oz.ad) return { ok: true, degisti: false };
        const s = await outbox.ekle({ type: "chat_rename", sohbet_id, ad: yeniAd });
        return s.ok ? { ok: true, degisti: true } : { ok: false, neden: s.neden };
      },

      sil: async () => {
        if (!(await hazirMi())) return { ok: false, kod: "baslamadi" };
        if (sohbet_id === ANA_SOHBET_ID) return { ok: false, kod: "sohbet_silinemez" };
        const oz = ozetBul(sohbet_id);
        if (oz === null) return { ok: false, kod: "sohbet_bulunamadi" };
        if (oz.kurulum === "kurulamadi") {
          // PC'de hiç oluşmadı: kablo yok, yalnız bu telefondan kalkar.
          try {
            await yerelKaldir(sohbet_id);
            return { ok: true };
          } catch {
            return { ok: false, kod: "depo_hatasi" };
          }
        }
        return silmeYolla({ type: "chat_delete", sohbet_id });
      },

      okundu: () => {
        if (!yuklendi || ozetBul(sohbet_id) === null) return;
        const seq = telafi.sonSeq();
        if (okundu.get(sohbet_id) === seq) return;
        okundu.set(sohbet_id, seq);
        okunduSurum++;
        secimYaz();
        bildir();
      },
    };

    const t: Tutamac = { sohbet, dinleyiciler: new Set(), kirli: true };
    return t;
  };

  /** `baslat` sırası: telafi → outbox → seçim → olaylar → silinmiş artıklar → taban → `acik` → `yuklendi`. */
  const yukle = async (): Promise<void> => {
    const gecmis = await telafi.yukle();
    await outbox.yukle();
    const kayit = await secimDeposu.yukle();
    okundu = new Map(kayit === null ? [] : Object.entries(kayit.okundu));
    const okunduOnce = okundu.size;
    for (const o of gecmis) uygula(o, false);
    // Silinmiş sohbetlerin artıkları ve olayı günlükte olan sohbetin `chat_create`'i (bırakılması
    // diske ulaşmadan süreç ölmüş): yollanmasınlar.
    const artikMi = (m: IsMesaji): boolean =>
      defter.silindiMi(mesajSohbeti(m)) || (m.type === "chat_create" && defter.kayitlar().has(sohbetAnahtari(m)));
    if (outbox.ogeler().some((g) => artikMi(g.mesaj)) || outbox.hatalar().some((h) => artikMi(h.mesaj))) {
      outbox.kaldir(artikMi).catch(() => undefined);
    }
    // İlk Dilim 2 açılışı: eski geçmiş okunmamış görünmesin.
    tabanSeq = kayit === null ? telafi.sonSeq() : kayit.taban_seq;
    secili = kayit?.acik ?? ANA_SOHBET_ID;
    okunduSurum++;
    let yaz = kayit === null || okundu.size !== okunduOnce;
    yuklendi = true;
    silmeHatalariniKapat();
    if (!listeAl().harita.has(secili)) {
      secili = ANA_SOHBET_ID;
      yaz = true;
    }
    if (yaz) secimYaz();
  };

  return {
    baslat: async () => {
      if (!yuklendi) {
        if (yukleme === null) {
          const p = yukle();
          yukleme = p;
          p.catch(() => {
            if (yukleme === p) yukleme = null;
          });
        }
        try {
          await yukleme;
        } catch (e) {
          hata = "depo_hatasi";
          bildir();
          throw e;
        }
      }
      if (hata === "depo_hatasi") hata = null;
      baglanti.baslat();
      bildir();
    },

    kapat: () => {
      baglanti.durdur();
      bekciDurdur();
      bildir();
    },

    simdiBaglan: () => baglanti.simdiBaglan(),

    tuketimIste: () => tuketim.iste(),

    durum,

    abone: (f) => {
      dinleyiciler.add(f);
      try {
        f(durum());
      } catch {
        // Dinleyicinin hatası aboneliği bozmaz.
      }
      return () => {
        dinleyiciler.delete(f);
      };
    },

    sohbet: (sohbet_id) => {
      let t = tutamaclar.get(sohbet_id);
      if (t === undefined) {
        t = tutamacKur(sohbet_id);
        tutamaclar.set(sohbet_id, t);
      }
      return t.sohbet;
    },

    sohbetAc: async (ad) => {
      if (!(await hazirMi())) return { ok: false, neden: "baslamadi" };
      let yeniAd: SohbetAdi = VARSAYILAN_SOHBET_ADI;
      if (ad !== undefined && ad.trim() !== "") {
        const h = adHazirla(ad);
        if (h === null) return { ok: false, neden: "gecersiz" };
        yeniAd = h;
      }
      // Kurulamamışlar sayılmaz: PC'de yer tutmazlar.
      const sayi = listeAl().liste.filter((s) => s.kurulum !== "kurulamadi").length;
      if (sayi >= SOHBET_SINIRLARI.SOHBET_ADET) return { ok: false, neden: "sohbet_siniri" };
      const sohbet_id = outbox.sohbetIdUret();
      const s = await outbox.ekle({ type: "chat_create", sohbet_id, ad: yeniAd });
      if (!s.ok) return { ok: false, neden: s.neden };
      if (ozetBul(sohbet_id) !== null) {
        secili = sohbet_id;
        secimYaz();
      }
      bildir();
      return { ok: true, sohbet_id };
    },

    sec: (sohbet_id) => {
      if (!listeAl().harita.has(sohbet_id)) return false;
      if (secili !== sohbet_id) {
        secili = sohbet_id;
        secimYaz();
        bildir();
      }
      return true;
    },
  };
};
