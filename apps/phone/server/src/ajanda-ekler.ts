/**
 * Ajanda ek yedeği (`ek_yedegi`; `docs/AJANDA.md` "Sürüm 3" > "Ek yedeği"; kullanıcı kararı: fotoğraflar
 * PC'de de yedeklenir). Telefonun kayıt eklerinin baytlarını PC'de içerik adresli saklar, geri verir,
 * süresi geçeni temizler. Çekirdek mantıktır: dosya sistemine yalnız `AjandaEkDiski` portundan dokunur
 * (gerçeği `dis-dunya.ts` `ajandaEkDiskiKur`; testte bellekte sahte disk). Çerçeveleri `gateway-ajanda.ts`
 * verir: yalnız v3 bağlantıda, kimlik sonrası, `esitlendi`'den sonra ve kesişimde `ek_yedegi` varken.
 *
 * Kurallar:
 * - Önce üstveri. `ek_yukle` yalnız silinmemiş `kayit_id` kaydının `ekler`'inde aynı `ek_id`, `ozet` ve
 *   `bayt` geçiyorsa kabul edilir (`ek_bilinmiyor`); dosya tamamlanırken aynı denetim yinelenir.
 * - Yükleme dur-bekle. Parça yalnız `ofset == alinan` ise yazılır, her parçaya `ek_durum` döner. `alinan`
 *   diskte onaylanmış (kalıcı) uzunluktur: port parçayı yazar, diske indirir, sonra onaylar; çökmeden sonra
 *   onaysız kuyruk kesilir. Son parçada uzunluk ve sha256 doğrulanır; tutmazsa yarım silinir
 *   (`ozet_uyusmuyor`). Doğrulanan yarım tek adımda son adına taşınır (atomik).
 * - İndirme penceredir: `ek_iste` → en çok `EK_PENCERE` `ek_parca`, sonra `ek_durum{gonderilen}`.
 * - Aynı özete her işlem tek sırada (`sirada`): iki bağlantı aynı yarıma birlikte yazamaz, temizlik o an
 *   okunan ya da az önce "tamam" denen dosyayı silemez.
 * - Retler yalnız `ek_ret`, bağlantı kapanmaz. İşleyici hiç atmaz: beklenmeyen hata `ic_hata` (geçici).
 * - Saklama: bir özet silinmemiş bir kaydın `ekler`'inde geçtiği sürece tutulur. Başvurusuzluk periyodik
 *   taramayla izlenir (`temizle`): kayıtlarda geçmeyen dosya ilk görüldüğü an işaretlenir (portun kalıcı
 *   işaret kümesi), işaretten `EK_SAKLAMA_GUN` sonra silinir; yeniden başvurulursa işaret kalkar. Tarama
 *   kaydın değiştiği yoldan (araç, uygulama, geri yükleme) bağımsızdır, göç gerektirmez.
 * - Günlüğe yalnız `ek_id`, bayt, sayı ve kod girer; içerik, özet ve yol hiç girmez (hata yalnız türüyle).
 * - Servis görseli açmaz, çözmez, küçültmez; `mime` okunmaz.
 */
import { AJANDA_SINIRLARI, AJANDA_SURUMU } from "@eren/protocol";
import type { AjandaAsagi, AjandaEkRetKodu, AjandaSurumluYukari } from "@eren/protocol";
import type { Depo, Gunluk, GunlukAlanlari, IptalEt, SaatPortu, ZamanlayiciPortu } from "./sozlesme.ts";

const MODUL = "ajanda_ekler";

/** `welcome.yetenekler`'deki ad: servis bunu yalnız bu modül kuruluyken sunar (`ana`). */
export const AJANDA_EK_YETENEGI = "ek_yedegi";

/** Veri kökü altındaki klasör (`<veri kökü>\ajanda-ekler`). */
export const AJANDA_EK_KLASORU = "ajanda-ekler";

const GUN_MS = 24 * 60 * 60 * 1000;

/**
 * Servisin kendi sınırları (kablo sınırı değildir; kablonunkiler `AJANDA_SINIRLARI.EK_*`). Amaç: hatalı ya
 * da kötü niyetli bir istemci diski dolduramasın, belleği şişiremesin.
 */
export const AJANDA_EK_SINIRLARI = {
  /**
   * Bir kaydın eklerine (üstverideki `bayt` toplamı) ayrılan en çok bayt. Şemanın tavanı (`EK_ADET` ×
   * `EK_BAYT` = 32 MiB) burada açıkça denetlenir: şema genişlese de kayıt başına sınır kalır. Kayıt başına
   * ek sayısı şemadan (`EK_ADET`, `ek_id` tekil); kabul edilen her dosya üstveriyle eşleşmek zorunda.
   */
  KAYIT_BAYT: AJANDA_SINIRLARI.EK_ADET * AJANDA_SINIRLARI.EK_BAYT,
  /**
   * Diskte aynı anda duran en çok yarım dosya (bütün bağlantılar). Üst sınır 32 × `EK_BAYT` = 128 MiB;
   * yarımlar kotaya da sayılır. Dolduğunda yeni yükleme `ic_hata` (geçici) alır, sürenler etkilenmez.
   */
  YARIM_ADET: 32,
  /** Dokunulmayan yarımın silindiği süre. */
  YARIM_SURE_MS: GUN_MS,
  /**
   * Bağlantı başına açık yükleme. Dur-bekle istemci bir tane tutar; aşılırsa en eski unutulur (yarımı
   * diskte kalır, `ek_yukle` ile kaldığı yerden sürer). Unutulan yüklemenin parçası `ic_hata` alır.
   */
  BAGLANTI_YUKLEME: 2,
  /**
   * Bağlantı başına işlenmeyi bekleyen ek çerçevesi (bellekte en çok bu kadar parça, ~342 KiB'lık). Dur-bekle
   * istemci 1'i aşmaz; aşan çerçeve işlenmeden `ic_hata` alır.
   */
  BAGLANTI_BEKLEYEN: 4,
  /** Periyodik temizliğin aralığı; saklama ve yarım süreleri bu kadar geç kalabilir (erken değil). */
  TEMIZLIK_ARALIGI_MS: 60 * 60 * 1000,
  /** Hiçbir silinmemiş kayıtta geçmeyen dosyanın tutulduğu süre (işaretten). */
  SAKLAMA_MS: AJANDA_SINIRLARI.EK_SAKLAMA_GUN * GUN_MS,
} as const;

/** Yol yalnız bundan kurulur: 64 küçük harf onaltılık (sha256). */
const OZET_DESENI = /^[0-9a-f]{64}$/;
export const ajandaEkOzetiMi = (s: unknown): s is string => typeof s === "string" && OZET_DESENI.test(s);

// ---------------------------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------------------------

export interface AjandaEkDosyasi {
  readonly ozet: string;
  readonly bayt: number;
}

export interface AjandaEkYarimi {
  readonly ozet: string;
  /** Diskteki uzunluk (onaylanmamış kuyruk dahil olabilir; kota için üst kestirim). */
  readonly bayt: number;
  /** Son yazımın anı (dosya sisteminin saati). */
  readonly degisme_ms: number;
}

/**
 * Ek dosyalarının tek kapısı. Her yöntem `ozet`'i yeniden doğrular (64 onaltılık değilse atar, hiçbir
 * yola dokunmaz); yol yalnız özetten kurulur, istemci metni girmez. Bağ (junction, sembolik) izlenmez.
 * Gerçeği `dis-dunya.ts` `ajandaEkDiskiKur(<veri kökü>\ajanda-ekler)`.
 */
export interface AjandaEkDiski {
  /** Tamamlanmış dosyanın (`<ozet[0:2]>\<ozet>`) uzunluğu; yoksa `null`. */
  tamBoyutu(ozet: string): Promise<number | null>;
  /** `ofset`'ten en çok `azamiBayt`; sonundaysa boş. */
  tamOku(ozet: string, ofset: number, azamiBayt: number): Promise<Uint8Array>;
  /** Yoksa sessizce döner. */
  tamSil(ozet: string): Promise<void>;
  tamListesi(): Promise<AjandaEkDosyasi[]>;
  /**
   * Yarımın (`yarim\<ozet>`) kalıcı olarak onaylanmış uzunluğu; yarım yoksa `null`. Onaylanmamış kuyruğu
   * (çökmede yarım kalan yazım) keser: dönen değer diskte doğru ve kalıcı bayttır.
   */
  yarimDurumu(ozet: string): Promise<number | null>;
  /**
   * `ofset` onaylı uzunluğa eşit olmalı (değilse atar, yazmaz). Parçayı yazar, diske indirir, SONRA yeni
   * uzunluğu onaylar; döner: yeni onaylı uzunluk. Yarım yoksa (`ofset` 0) oluşturur.
   */
  yarimaEkle(ozet: string, ofset: number, veri: Uint8Array): Promise<number>;
  /** Yarımın onaylı kısmının uzunluğu ve sha256'sı (küçük harf onaltılık). */
  yarimOzeti(ozet: string): Promise<{ bayt: number; ozet: string }>;
  /** Yarımı son adına tek adımda taşır (aynı birim); son ad zaten varsa yarımı siler. */
  yarimiTamamla(ozet: string): Promise<void>;
  /** Yarımı ve onayını siler; yoksa sessizce döner. */
  yarimSil(ozet: string): Promise<void>;
  yarimListesi(): Promise<AjandaEkYarimi[]>;
  /** Başvurusuzluk işaretleri: özet → ilk görüldüğü an (ms). Bozuk ya da yoksa boş (saklama uzar, kısalmaz). */
  isaretleriOku(): Promise<Map<string, number>>;
  /** Bütün kümeyi atomik yazar. */
  isaretleriYaz(isaretler: ReadonlyMap<string, number>): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Modül yüzü
// ---------------------------------------------------------------------------------------------

type EkYukle = Extract<AjandaSurumluYukari, { type: "ek_yukle" }>;
type EkParcaYukari = Extract<AjandaSurumluYukari, { type: "ek_parca" }>;
type EkIste = Extract<AjandaSurumluYukari, { type: "ek_iste" }>;

/** Gateway'in bu modüle verdiği çerçeveler (çözücüden geçmiş). */
export type AjandaEkCercevesi = EkYukle | EkParcaYukari | EkIste;
/** Bu modülün ürettiği aşağı çerçeveler (en yeni sürümde; gateway bağlantı sürümüne uyarlar). */
export type AjandaEkYaniti = Extract<AjandaAsagi, { type: "ek_durum" | "ek_parca" | "ek_ret" }>;

export interface AjandaEkOturumuGirdisi {
  /** Yanıt çerçevesi. Bağlantı kapandıysa çağıran yok sayar; atmamalı. */
  gonder(m: AjandaEkYaniti): void;
}

/** Bağlantı başına durum: açık yüklemeler ve bekleyen çerçeve sayacı. */
export interface AjandaEkOturumu {
  /** Çerçeveyi sıraya alır; yanıtlar `gonder` ile, sonra. Hiç atmaz. */
  cerceve(m: AjandaEkCercevesi): void;
  /** Bağlantı kapandı: açık yüklemeler unutulur (yarımlar diskte kalır), yanıt gitmez. */
  kapat(): void;
}

export interface AjandaEkTemizlikSonucu {
  silinen: number;
  silinen_bayt: number;
  yarim_silinen: number;
  isaretlenen: number;
  tutulan: number;
}

export interface AjandaEkleri {
  oturumAc(g: AjandaEkOturumuGirdisi): AjandaEkOturumu;
  /** Bir temizlik turu (süren varsa onu bekler). Atar yalnız tarama okunamazsa; o zaman hiçbir şey silinmez. */
  temizle(): Promise<AjandaEkTemizlikSonucu>;
  /** Periyodik temizliği kurar ve ilk turu arkada başlatır. */
  baslat(): void;
  /** Süren bütün işler bitince çözülür. Atmaz. */
  bekle(): Promise<void>;
  /** Yeni çerçeveyi `ic_hata` ile reddeder, periyodu keser, süren işleri bekler. */
  kapat(): Promise<void>;
}

export interface AjandaEkleriBagimliliklari {
  disk: AjandaEkDiski;
  depo: Pick<Depo, "ajandaKaydiGetir" | "ajandaKayitlari">;
  saat: SaatPortu;
  zamanlayici: Pick<ZamanlayiciPortu, "herAralik">;
  gunluk: Gunluk;
  /** Bütün eklere ayrılan alan (tam + yarım). Verilmezse `EK_TOPLAM_BAYT`. */
  kotaBayt?: number;
}

interface Yukleme {
  readonly ek_id: string;
  readonly kayit_id: string;
  readonly ozet: string;
  readonly bayt: number;
}

interface OturumDurumu {
  readonly gonder: (m: AjandaEkYaniti) => void;
  /** Ekleme sırası en eskiden en yeniye (son dokunulan sona taşınır). */
  readonly yuklemeler: Map<string, Yukleme>;
  bekleyen: number;
  kapali: boolean;
}

const hataTuru = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

const toplam = (l: ReadonlyArray<{ bayt: number }>): number => l.reduce((a, f) => a + f.bayt, 0);

export const ajandaEkleriKur = (d: AjandaEkleriBagimliliklari): AjandaEkleri => {
  const { disk, depo, saat, gunluk } = d;
  const kota = d.kotaBayt ?? AJANDA_SINIRLARI.EK_TOPLAM_BAYT;
  const S = AJANDA_EK_SINIRLARI;

  let kapali = false;
  let periyot: IptalEt | null = null;
  const surenler = new Set<Promise<void>>();
  const siralar = new Map<string, Promise<void>>();
  /** Bir ek çerçevesinin bu özete son dokunduğu an: temizlik tur başından sonra dokunulanı silmez. */
  const dokunulan = new Map<string, number>();
  let surenTemizlik: Promise<AjandaEkTemizlikSonucu> | null = null;

  // Günlük atsa bile işleyici düşmesin.
  const yaz = (seviye: "bilgi" | "uyari" | "hata", olay: string, alanlar?: GunlukAlanlari): void => {
    try {
      gunluk[seviye](MODUL, olay, alanlar);
    } catch {
      // günlük yazılamadı; yapılacak başka şey yok
    }
  };

  /** Arka işi izler (`bekle`/`kapat` bekler); iş hiç reddedilmez. */
  const izle = (f: () => Promise<void>): void => {
    const p = f().catch((e: unknown) => yaz("hata", "ek_arka_hatasi", { hata_turu: hataTuru(e) }));
    surenler.add(p);
    void p.then(() => surenler.delete(p));
  };

  /** Aynı özete işlemler gelme sırasıyla, biri bitmeden öteki başlamaz. Sıra hata yüzünden tıkanmaz. */
  const sirada = <T>(ozet: string, f: () => Promise<T>): Promise<T> => {
    const onceki = siralar.get(ozet) ?? Promise.resolve();
    const sonuc = onceki.then(f);
    const kuyruk = sonuc.then(
      () => undefined,
      () => undefined,
    );
    siralar.set(ozet, kuyruk);
    void kuyruk.then(() => {
      if (siralar.get(ozet) === kuyruk) siralar.delete(ozet);
    });
    return sonuc;
  };

  const dokun = (ozet: string): void => {
    dokunulan.set(ozet, saat.simdiMs());
  };

  // ------------------------------------------------------------------------------------------
  // Yanıtlar
  // ------------------------------------------------------------------------------------------

  const yolla = (o: OturumDurumu, m: AjandaEkYaniti): void => {
    if (o.kapali) return;
    try {
      o.gonder(m);
    } catch (e) {
      yaz("hata", "ek_gonderim_hatasi", { hata_turu: hataTuru(e) });
    }
  };

  const ret = (o: OturumDurumu, ek_id: string, code: AjandaEkRetKodu): void => {
    yaz(code === "ic_hata" ? "hata" : "uyari", "ek_ret", { ek_id, code });
    yolla(o, { v: AJANDA_SURUMU, type: "ek_ret", ek_id, code });
  };

  const alindi = (o: OturumDurumu, ek_id: string, alinan: number, tamam: boolean): void => {
    yolla(o, { v: AJANDA_SURUMU, type: "ek_durum", ek_id, alinan, tamam });
  };

  // ------------------------------------------------------------------------------------------
  // Üstveri ve yükleme
  // ------------------------------------------------------------------------------------------

  /** Kayıt bu eki aynı üstveriyle taşıyor mu ve kayıt başına sınır içinde mi; tutmazsa ret kodu. */
  const ustveriDenetle = (y: Yukleme): AjandaEkRetKodu | null => {
    const kayit = depo.ajandaKaydiGetir(y.kayit_id);
    if (kayit === null || kayit.silindi) return "ek_bilinmiyor";
    const ekler = kayit.ekler ?? [];
    const ek = ekler.find((e) => e.ek_id === y.ek_id);
    if (ek === undefined || ek.ozet !== y.ozet || ek.bayt !== y.bayt) return "ek_bilinmiyor";
    if (y.bayt > AJANDA_SINIRLARI.EK_BAYT || ekler.length > AJANDA_SINIRLARI.EK_ADET || toplam(ekler) > S.KAYIT_BAYT) {
      return "ek_cok_buyuk";
    }
    return null;
  };

  /** Bağlantının açık yüklemesi; en eskisi sınırda unutulur. Dokunulan sona taşınır. */
  const yuklemeKaydet = (o: OturumDurumu, y: Yukleme): void => {
    o.yuklemeler.delete(y.ek_id);
    o.yuklemeler.set(y.ek_id, y);
    while (o.yuklemeler.size > S.BAGLANTI_YUKLEME) {
      const en_eski = o.yuklemeler.keys().next().value;
      if (en_eski === undefined) break;
      o.yuklemeler.delete(en_eski);
    }
  };

  /** Sırada çağrılır: yarımın tam boyda olduğu bilinir. Doğrular, taşır, yanıtlar. */
  const tamamla = async (o: OturumDurumu, y: Yukleme): Promise<void> => {
    o.yuklemeler.delete(y.ek_id);
    const h = await disk.yarimOzeti(y.ozet);
    if (h.bayt !== y.bayt || h.ozet !== y.ozet) {
      await disk.yarimSil(y.ozet);
      return ret(o, y.ek_id, "ozet_uyusmuyor");
    }
    // Yükleme sürerken ek kayıttan çıkmış ya da kayıt silinmiş olabilir: gelişigüzel dosya kalmasın.
    const red = ustveriDenetle(y);
    if (red !== null) {
      await disk.yarimSil(y.ozet);
      return ret(o, y.ek_id, red);
    }
    await disk.yarimiTamamla(y.ozet);
    yaz("bilgi", "ek_saklandi", { ek_id: y.ek_id, bayt: y.bayt });
    alindi(o, y.ek_id, y.bayt, true);
  };

  const yukleAl = async (o: OturumDurumu, m: EkYukle): Promise<void> => {
    const y: Yukleme = { ek_id: m.ek_id, kayit_id: m.kayit_id, ozet: m.ozet, bayt: m.bayt };
    // Savunma: şema zaten denetler; özet olmayan değer hiçbir yola, porta ulaşmaz.
    if (!ajandaEkOzetiMi(y.ozet)) return ret(o, y.ek_id, "ek_bilinmiyor");
    const red = ustveriDenetle(y);
    if (red !== null) return ret(o, y.ek_id, red);
    await sirada(y.ozet, async () => {
      dokun(y.ozet);
      const tam = await disk.tamBoyutu(y.ozet);
      if (tam !== null) {
        // İçerik adresli: aynı görsel başka kayıttan zaten gelmiş. Yükleme yapılmaz.
        o.yuklemeler.delete(y.ek_id);
        if (tam !== y.bayt) return ret(o, y.ek_id, "ozet_uyusmuyor");
        return alindi(o, y.ek_id, y.bayt, true);
      }
      let alinan = await disk.yarimDurumu(y.ozet);
      if (alinan !== null && alinan > y.bayt) {
        // Bildirilenden uzun yarım bu ekin olamaz (özet aynıysa boy da aynıdır): baştan.
        await disk.yarimSil(y.ozet);
        alinan = null;
      }
      const yarimlar = await disk.yarimListesi();
      if (alinan === null && yarimlar.filter((x) => x.ozet !== y.ozet).length >= S.YARIM_ADET) {
        yaz("uyari", "ek_yarim_siniri", { ek_id: y.ek_id, adet: yarimlar.length });
        return ret(o, y.ek_id, "ic_hata");
      }
      // Kota: tamamlanmışlar + bütün yarımlar (bu ekinki dahil) + bu ekin kalanı.
      const kullanilan = toplam(await disk.tamListesi()) + toplam(yarimlar);
      if (kullanilan + (y.bayt - (alinan ?? 0)) > kota) return ret(o, y.ek_id, "kota_asildi");
      yuklemeKaydet(o, y);
      // Çökmeden önce son parçası onaylanmış ama doğrulanmamış yarım: şimdi tamamlanır.
      if (alinan === y.bayt) return tamamla(o, y);
      alindi(o, y.ek_id, alinan ?? 0, false);
    });
  };

  const parcaAl = async (o: OturumDurumu, m: EkParcaYukari): Promise<void> => {
    const y = o.yuklemeler.get(m.ek_id);
    // `ek_yukle` yok (ya da unutuldu): istemci `ek_yukle` ile yeniden başlar.
    if (y === undefined) return ret(o, m.ek_id, "ic_hata");
    yuklemeKaydet(o, y);
    const veri = Buffer.from(m.veri, "base64");
    await sirada(y.ozet, async () => {
      dokun(y.ozet);
      const tam = await disk.tamBoyutu(y.ozet);
      if (tam !== null) {
        o.yuklemeler.delete(y.ek_id);
        if (tam !== y.bayt) return ret(o, y.ek_id, "ozet_uyusmuyor");
        return alindi(o, y.ek_id, y.bayt, true);
      }
      const alinan = (await disk.yarimDurumu(y.ozet)) ?? 0;
      // Yanlış ofset: yazılmaz, istemci `alinan`'dan sürer.
      if (m.ofset !== alinan) return alindi(o, y.ek_id, alinan, false);
      if (alinan + veri.length > y.bayt) {
        o.yuklemeler.delete(y.ek_id);
        await disk.yarimSil(y.ozet);
        return ret(o, y.ek_id, "ozet_uyusmuyor");
      }
      const yeni = await disk.yarimaEkle(y.ozet, alinan, veri);
      if (yeni < y.bayt) return alindi(o, y.ek_id, yeni, false);
      return tamamla(o, y);
    });
  };

  // ------------------------------------------------------------------------------------------
  // İndirme
  // ------------------------------------------------------------------------------------------

  const isteAl = async (o: OturumDurumu, m: EkIste): Promise<void> => {
    if (!ajandaEkOzetiMi(m.ozet)) return ret(o, m.ek_id, "ek_yok");
    await sirada(m.ozet, async () => {
      dokun(m.ozet);
      const boyut = await disk.tamBoyutu(m.ozet);
      if (boyut === null) return ret(o, m.ek_id, "ek_yok");
      // İstemcinin bildiği dosya bu değil (ofset sonun ötesinde).
      if (m.ofset > boyut) return ret(o, m.ek_id, "ozet_uyusmuyor");
      let ofset = m.ofset;
      for (let i = 0; i < AJANDA_SINIRLARI.EK_PENCERE && ofset < boyut; i++) {
        if (o.kapali) return;
        const parca = await disk.tamOku(m.ozet, ofset, Math.min(AJANDA_SINIRLARI.EK_PARCA, boyut - ofset));
        if (parca.length === 0) return ret(o, m.ek_id, "ic_hata");
        yolla(o, {
          v: AJANDA_SURUMU,
          type: "ek_parca",
          ek_id: m.ek_id,
          ofset,
          veri: Buffer.from(parca.buffer, parca.byteOffset, parca.length).toString("base64"),
        });
        ofset += parca.length;
      }
      yolla(o, { v: AJANDA_SURUMU, type: "ek_durum", ek_id: m.ek_id, gonderilen: ofset, tamam: ofset === boyut });
    });
  };

  // ------------------------------------------------------------------------------------------
  // Temizlik
  // ------------------------------------------------------------------------------------------

  /** Silinmemiş kayıtların eklerindeki özetler. Eşzamanlı okuma; atarsa tur hiçbir şey silmeden düşer. */
  const basvurulanlar = (): Set<string> => {
    const s = new Set<string>();
    for (const k of depo.ajandaKayitlari()) {
      if (k.silindi) continue;
      for (const e of k.ekler ?? []) s.add(e.ozet);
    }
    return s;
  };

  const temizlikTuru = async (): Promise<AjandaEkTemizlikSonucu> => {
    const bas = saat.simdiMs();
    const sonuc: AjandaEkTemizlikSonucu = { silinen: 0, silinen_bayt: 0, yarim_silinen: 0, isaretlenen: 0, tutulan: 0 };
    // Tur başından sonra bir çerçevenin dokunduğu özet bu turda silinmez.
    const dokunuldu = (ozet: string): boolean => (dokunulan.get(ozet) ?? -Infinity) >= bas;

    for (const y of await disk.yarimListesi()) {
      if (bas - y.degisme_ms < S.YARIM_SURE_MS) continue;
      await sirada(y.ozet, async () => {
        if (dokunuldu(y.ozet)) return;
        await disk.yarimSil(y.ozet);
        sonuc.yarim_silinen += 1;
      });
    }

    const tamlar = await disk.tamListesi();
    const isaretler = await disk.isaretleriOku();
    let degisti = false;
    const mevcut = new Set(tamlar.map((f) => f.ozet));
    for (const ozet of [...isaretler.keys()]) {
      if (mevcut.has(ozet)) continue;
      isaretler.delete(ozet);
      degisti = true;
    }
    // Ek yoksa kayıtlar taranmaz (eki olmayan kurulumda maliyet yok).
    const basvurulan = tamlar.length === 0 ? new Set<string>() : basvurulanlar();
    const silinecek: AjandaEkDosyasi[] = [];
    for (const f of tamlar) {
      if (basvurulan.has(f.ozet)) {
        sonuc.tutulan += 1;
        if (isaretler.delete(f.ozet)) degisti = true;
        continue;
      }
      const ilk = isaretler.get(f.ozet);
      if (ilk === undefined) {
        isaretler.set(f.ozet, bas);
        degisti = true;
        sonuc.isaretlenen += 1;
      } else if (bas - ilk >= S.SAKLAMA_MS) {
        silinecek.push(f);
      } else {
        sonuc.tutulan += 1;
      }
    }
    // İşaretler silmeden önce yazılır: çökme olursa silinmemiş dosyanın işareti kalır, sonraki tur siler.
    if (degisti) await disk.isaretleriYaz(isaretler);
    degisti = false;
    for (const f of silinecek) {
      await sirada(f.ozet, async () => {
        if (dokunuldu(f.ozet)) {
          sonuc.tutulan += 1;
          return;
        }
        await disk.tamSil(f.ozet);
        isaretler.delete(f.ozet);
        degisti = true;
        sonuc.silinen += 1;
        sonuc.silinen_bayt += f.bayt;
      });
    }
    if (degisti) await disk.isaretleriYaz(isaretler);
    for (const [ozet, ms] of dokunulan) if (ms < bas) dokunulan.delete(ozet);
    yaz("bilgi", "ek_temizlik", { ...sonuc });
    return sonuc;
  };

  const temizle = (): Promise<AjandaEkTemizlikSonucu> => {
    surenTemizlik ??= temizlikTuru().finally(() => {
      surenTemizlik = null;
    });
    return surenTemizlik;
  };

  const temizleArkada = (): void => {
    if (kapali) return;
    izle(async () => {
      try {
        await temizle();
      } catch (e) {
        yaz("hata", "ek_temizlik_hatasi", { hata_turu: hataTuru(e) });
      }
    });
  };

  // ------------------------------------------------------------------------------------------
  // Yüz
  // ------------------------------------------------------------------------------------------

  const isle = (o: OturumDurumu, m: AjandaEkCercevesi): Promise<void> => {
    switch (m.type) {
      case "ek_yukle":
        return yukleAl(o, m);
      case "ek_parca":
        return parcaAl(o, m);
      case "ek_iste":
        return isteAl(o, m);
    }
  };

  const bekle = async (): Promise<void> => {
    while (surenler.size > 0) await Promise.all([...surenler]);
  };

  return {
    oturumAc: (g) => {
      const o: OturumDurumu = { gonder: (m) => g.gonder(m), yuklemeler: new Map(), bekleyen: 0, kapali: false };
      return {
        cerceve: (m) => {
          if (o.kapali) return;
          if (kapali || o.bekleyen >= S.BAGLANTI_BEKLEYEN) {
            if (!kapali) yaz("uyari", "ek_bekleyen_siniri", { ek_id: m.ek_id });
            return ret(o, m.ek_id, "ic_hata");
          }
          o.bekleyen += 1;
          izle(async () => {
            try {
              await isle(o, m);
            } catch (e) {
              yaz("hata", "ek_hatasi", { ek_id: m.ek_id, hata_turu: hataTuru(e) });
              ret(o, m.ek_id, "ic_hata");
            } finally {
              o.bekleyen -= 1;
            }
          });
        },
        kapat: () => {
          o.kapali = true;
          o.yuklemeler.clear();
        },
      };
    },
    temizle,
    baslat: () => {
      if (kapali || periyot !== null) return;
      periyot = d.zamanlayici.herAralik(S.TEMIZLIK_ARALIGI_MS, temizleArkada);
      temizleArkada();
    },
    bekle,
    kapat: async () => {
      kapali = true;
      periyot?.();
      periyot = null;
      await bekle();
    },
  };
};
