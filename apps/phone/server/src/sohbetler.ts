/**
 * Sohbet yöneticisi (Dilim 2): sohbet listesi ve örnek haritası, `chat_create`/`chat_rename`
 * işleyicisi, canlı ana oturum sınırının ve RAM kapısının gerçeği (`SurecKapisi`), boşta kapatma, tüm
 * sohbetlerde tekil `nesilAyir`, açılış sırası, `server_status.sohbetler`. MODULLER.md "Dilim 2" >
 * "Sırayla akışlar" ve "Modül maddeleri" > "sohbetler".
 *
 * Kullanıcı mesajı ALMAZ: insan satırının yolu yalnız gateway → örnektir; bu dosya örneklere sahip
 * olsa da o yönteme dokunmaz (`test/insan-noktasi.test.ts` (c) bu dosyanın metnini tarar).
 *
 * Kapı (yuva) modeli:
 * - Yuva sayısı = süreci olan ya da açılan sohbetler (`yuvadakiler`) + ayrılmış yuvalar (`ayrilmis`).
 *   Hiçbir an `ayar.erenCanliAzami`'yi geçmez; devir adayı sayılmaz (`devirSerbestMi` yalnız RAM).
 * - Sıra FIFO'dur, sohbet sırada bir kez bulunur. Yuva boşalınca sıranın başındakine yuva AYRILIR ve
 *   `uyandir()` denir; örnek o çağrının içinde `yuvaIste` sorar ve `true` alır. Kullanılmayan
 *   rezervasyon `uyandir` dönünce düşer, sıradakine geçilir. Sıradaki örnek `eren_durumu` ile
 *   `sirada`/`kapali` dışına geçerse (yuva beklemesi bitti, ör. yeni sayfa kuyruğunu sildi) sıradan çıkar.
 * - Yuvalar doluyken ret, sıraya giriş ve (o an boşaltılan yoksa) tek kurban: en uzun süredir boşta
 *   olan canlı sohbet, hiçbiri boşta değilse `son_etkinlik_ms`'i en eski canlı sohbet (isteyen hariç).
 * - RAM kapısı: boş RAM < `ramDusukMb + RAM_KAPISI_PAYI_MB` iken yeni yuva verilmez; sıra varken
 *   `ramYoklamaMs` arayla yeniden sınanır.
 * - Kilit serbest değilken sıra ilerletilmez (örnek zaten açmazdı); kilit açılınca ilerletilir.
 *   Kilitten önce süreci olan ya da kuyruğu dolu örneğin kendi `uyandir`'ı örneğin işidir.
 *
 * Günlüğe yalnız `sohbet_id` (opak kimlik), sayılar ve kapalı değerler yazılır. Sohbet adı kullanıcı
 * metnidir: ASLA günlüğe yazılmaz.
 */
import {
  ANA_SOHBET_ID,
  SOHBET_SINIRLARI,
} from "@eren/protocol";
import { anaSohbetAdiUret } from "./ana-sohbet-adi.ts";
import type {
  GunlukAlanlari,
  IptalEt,
  Konusma,
  KonusmaOrtakBagimliliklari,
  SohbetAdlandirmaHatasi,
  SohbetAktifTuru,
  SohbetDurumlariTipi,
  SohbetIslemSonucu,
  SohbetKaydi,
  SohbetlerFabrikasi,
  SohbetOlusturmaHatasi,
  SohbetSecimi,
  SurecKapisi,
  Sonuc,
} from "./sozlesme.ts";

/** Boş RAM bu kadar MB `ramDusukMb`'nin üstünde değilse yeni ana oturum süreci açılmaz. */
export const RAM_KAPISI_PAYI_MB = 768;
/** Boşta yoklamasının aralığı. */
export const BOSTA_YOKLAMA_MS = 60_000;

const MODUL = "sohbetler";

type Seviye = "bilgi" | "uyari" | "hata";
type SohbetNo = SohbetKaydi["sohbet_id"];

const hataTuru = (e: unknown): string =>
  e instanceof Error ? e.name : typeof e;
const secim = (sohbet_id: SohbetNo): SohbetSecimi => ({ sohbet_id });

type OlusturmaKarari =
  | { tur: "var" }
  | { tur: "silinmis" }
  | { tur: "sinir" }
  | { tur: "yeni"; seq: number };

type AdlandirmaKarari =
  { tur: "yok" } | { tur: "ayni" } | { tur: "yeni"; seq: number };

export const sohbetlerKur: SohbetlerFabrikasi = (b) => {
  const {
    ayar,
    depo,
    kilit,
    kopru,
    saat,
    zamanlayici,
    veriyolu,
    gunluk,
    sistem,
    surec,
  } = b;

  // ---- durum ----

  /** Silinmemiş sohbetlerin örnekleri; ekleme sırası `sohbetListesi` sırasıdır. */
  const ornekler = new Map<SohbetNo, Konusma>();
  /** Örneğin `baslat()` sözü: bir kez çağrılır. */
  const baslatSozleri = new Map<SohbetNo, Promise<void>>();

  /** Yuva tutan sohbetler (süreci olan ya da açılan). */
  const yuvadakiler = new Set<SohbetNo>();
  /** Yönetici tarafından `uyandir` çağrısı süresince ayrılmış yuvalar. */
  const ayrilmis = new Set<SohbetNo>();
  /** Yuva bekleyenler, FIFO, tekil. */
  let sira: SohbetNo[] = [];
  /** Canlı sınırı yüzünden şu an boşaltılan tek kurban. */
  let bosaltilan: SohbetNo | null = null;
  /** `uyut()`'u süren sohbetler (kurban ya da boşta kapatma): ikinci kez çağrılmaz. */
  const uyutulanlar = new Set<SohbetNo>();
  /** Yuvayı son alışından beri en az bir turu biten (`tur_bitti`) sohbetler: kurban adayı olabilir. */
  const turTamamlayanlar = new Set<SohbetNo>();
  /** Durum değişiminde kurban yeniden sınaması bir mikro göreve ertelendi mi. */
  let kurbanSinamasiBekliyor = false;
  let durumDinlemeIptal: IptalEt | null = null;
  let turDinlemeIptal: IptalEt | null = null;

  /**
   * Açılış sırası belirlenene kadar `true`: bu sürede kapı yeni yuva VERMEZ, isteyenleri not eder;
   * sıralama adımı onları (kuyruğu dolu sayarak) sırayla uyandırır.
   */
  let acilisSuruyor = true;
  const acilisIstekleri = new Set<SohbetNo>();

  let baslatCagrildi = false;
  /** `erenJetonlariniSil` yapıldı: bundan sonra kurulan örneğin `baslat`'ı hemen çağrılabilir. */
  let jetonlarSilindi = false;
  let kapandi = false;
  let kapanisSozu: Promise<void> | null = null;

  let nesilSayaci = 0;

  let ramYoklamaIptal: IptalEt | null = null;
  let bostaYoklamaIptal: IptalEt | null = null;
  let kilitDinlemeIptal: IptalEt | null = null;
  let ilerletiliyor = false;

  // ---- yardımcılar ----

  // Günlük atsa bile akış sürsün.
  const yaz = (
    seviye: Seviye,
    olay: string,
    alanlar?: GunlukAlanlari,
  ): void => {
    try {
      gunluk[seviye](MODUL, olay, alanlar);
    } catch {
      // günlük yazılamadı; yapılacak başka şey yok
    }
  };

  const yuvaSayisi = (): number => yuvadakiler.size + ayrilmis.size;
  const yuvaBosMu = (): boolean => yuvaSayisi() < ayar.erenCanliAzami;

  /** Okuma atarsa kapı açık sayılır (kapı bir sezgidir; okunamayan RAM ana oturumu kilitlemesin). */
  const ramYeterli = (): boolean => {
    try {
      return sistem.ramOku().bosMb >= ayar.ramDusukMb + RAM_KAPISI_PAYI_MB;
    } catch (e) {
      yaz("uyari", "ram_okunamadi", { hata_turu: hataTuru(e) });
      return true;
    }
  };

  const kilitSerbest = (): boolean => {
    try {
      return kilit.baslatmaSerbestMi();
    } catch (e) {
      yaz("uyari", "kilit_okunamadi", { hata_turu: hataTuru(e) });
      return false;
    }
  };

  const sonEtkinlik = (id: SohbetNo): number => {
    try {
      return depo.sohbetGetir(secim(id))?.son_etkinlik_ms ?? 0;
    } catch (e) {
      yaz("uyari", "etkinlik_okunamadi", {
        sohbet_id: id,
        hata_turu: hataTuru(e),
      });
      return 0;
    }
  };

  const kuyrukDolu = (id: SohbetNo): boolean => {
    try {
      return depo.kuyrukBasi(secim(id)) !== null;
    } catch (e) {
      yaz("uyari", "kuyruk_okunamadi", {
        sohbet_id: id,
        hata_turu: hataTuru(e),
      });
      return false;
    }
  };

  const bostaBeriOku = (k: Konusma): number | null => {
    try {
      return k.bostaBeri();
    } catch (e) {
      yaz("uyari", "bosta_okunamadi", {
        sohbet_id: k.sohbet_id,
        hata_turu: hataTuru(e),
      });
      return null;
    }
  };

  const uyandirGuvenli = (k: Konusma): void => {
    try {
      k.uyandir();
    } catch (e) {
      yaz("hata", "uyandir_hata", {
        sohbet_id: k.sohbet_id,
        hata_turu: hataTuru(e),
      });
    }
  };

  const siradanCikar = (id: SohbetNo): void => {
    if (sira.includes(id)) sira = sira.filter((s) => s !== id);
  };

  /** Sıra varken RAM (ve kilit) yeniden sınanır; sıra boşalınca yoklama durur. */
  const ramYoklamaAyarla = (): void => {
    if (!kapandi && sira.length > 0) {
      if (ramYoklamaIptal === null) {
        ramYoklamaIptal = zamanlayici.herAralik(ayar.sureler.ramYoklamaMs, () =>
          siraIlerlet(),
        );
      }
    } else if (ramYoklamaIptal !== null) {
      const iptal = ramYoklamaIptal;
      ramYoklamaIptal = null;
      iptal();
    }
  };

  const siraya = (id: SohbetNo): void => {
    if (!sira.includes(id)) {
      sira.push(id);
      yaz("bilgi", "sirada", { sohbet_id: id, sira: sira.length });
    }
    ramYoklamaAyarla();
  };

  /**
   * Bilinçli kapatma: tek giriş. Boşta kapatma ve kurban aynı yoldan; ikinci kez çağrılmaz. Söz
   * bitince (süreç çıktı) kurban işareti düşer.
   */
  const uyutBaslat = (k: Konusma, neden: "bosta" | "kurban"): void => {
    const id = k.sohbet_id;
    if (uyutulanlar.has(id)) return;
    uyutulanlar.add(id);
    yaz("bilgi", "uyutuluyor", { sohbet_id: id, neden });
    let soz: Promise<void>;
    try {
      soz = k.uyut();
    } catch (e) {
      soz = Promise.reject(e);
    }
    soz
      .catch((e: unknown) => {
        yaz("hata", "uyut_hata", { sohbet_id: id, hata_turu: hataTuru(e) });
      })
      .finally(() => {
        uyutulanlar.delete(id);
        if (bosaltilan === id) {
          bosaltilan = null;
          // Normalde `yuvaBirak` sırayı zaten ilerletti. Yuva hâlâ tutuluyorsa hemen yeni kurban
          // seçilmez (aynı örnek döngüye girmesin): sonraki istek ya da RAM yoklaması seçer.
          if (yuvadakiler.has(id))
            yaz("uyari", "kurban_yuva_birakmadi", { sohbet_id: id });
        }
      });
  };

  /**
   * Kurban adayı mı (canlı kilide karşı, şef kararı): boşta olan (`bostaBeri` dolu) her zaman aday.
   * Boşta değilse yalnız turu süren (`uyut` turu bitirip kapatır: o tur hizmet almış olur) ya da
   * yuvayı aldıktan sonra en az bir tur tamamlamış (`tur_bitti`) ve şu an başlatılmayan sohbet aday.
   * Yuvayı yeni almış, başlatılan ya da hiç tur işlememiş sohbet aday DEĞİLDİR: `uyut` onu turunu
   * açmadan kapatırdı, iki sohbet sınır 1'de birbirini sonsuza dek uyuturdu.
   */
  const bostaDegilAdayMi = (k: Konusma): boolean => {
    let durum: ReturnType<Konusma["durum"]>;
    try {
      durum = k.durum();
    } catch (e) {
      yaz("uyari", "durum_okunamadi", {
        sohbet_id: k.sohbet_id,
        hata_turu: hataTuru(e),
      });
      return false;
    }
    if (durum === "tur_suruyor") return true;
    return durum !== "baslatiliyor" && turTamamlayanlar.has(k.sohbet_id);
  };

  /**
   * Sıra bekliyor ve yuvalar doluysa, o an boşaltılan yoksa tek kurban seçer. Önce boşta olanların en
   * eskisi (`bostaBeri` en küçük), yoksa adaylar (`bostaDegilAdayMi`) içinde `son_etkinlik_ms`'i en
   * eski canlı sohbet; sıradakiler (ve isteyen) aday değildir. Aday yoksa kurban seçilmez, isteyen
   * sırada bekler: bir canlı sohbetin durumu değişince (`eren_durumu`, `tur_bitti`) yeniden bakılır.
   */
  const kurbanGerekirse = (): void => {
    if (kapandi || bosaltilan !== null || sira.length === 0 || yuvaBosMu())
      return;
    // Boşta kapatması zaten süren canlı sohbet varsa o kurban sayılır: ikinci süreç kapatılmaz.
    for (const id of uyutulanlar) {
      if (yuvadakiler.has(id)) {
        bosaltilan = id;
        return;
      }
    }
    const bekleyen = new Set(sira);
    let bostaKurban: { k: Konusma; ms: number } | null = null;
    let etkinlikKurban: { k: Konusma; ms: number } | null = null;
    for (const id of yuvadakiler) {
      if (bekleyen.has(id)) continue;
      const k = ornekler.get(id);
      if (k === undefined) continue;
      const bos = bostaBeriOku(k);
      if (bos !== null) {
        if (bostaKurban === null || bos < bostaKurban.ms)
          bostaKurban = { k, ms: bos };
      } else if (bostaKurban === null && bostaDegilAdayMi(k)) {
        const ms = sonEtkinlik(id);
        if (etkinlikKurban === null || ms < etkinlikKurban.ms)
          etkinlikKurban = { k, ms };
      }
    }
    const secilen = bostaKurban ?? etkinlikKurban;
    if (secilen === null) return;
    bosaltilan = secilen.k.sohbet_id;
    yaz("bilgi", "kurban_secildi", {
      sohbet_id: bosaltilan,
      bosta: bostaKurban !== null,
      yuva: yuvaSayisi(),
      sira: sira.length,
    });
    uyutBaslat(secilen.k, "kurban");
  };

  /**
   * Boş yuva, yeterli RAM ve serbest kilit varken sıranın başındakine yuva ayırır ve `uyandir()` der.
   * Rezervasyon `uyandir` dönünce kullanılmadıysa düşer. Yeniden girişte dıştaki döngü sürer.
   */
  const siraIlerlet = (): void => {
    if (kapandi || acilisSuruyor || ilerletiliyor) return;
    ilerletiliyor = true;
    try {
      while (sira.length > 0 && yuvaBosMu() && !kapandi) {
        if (!kilitSerbest() || !ramYeterli()) break;
        const id = sira.shift() as SohbetNo;
        const k = ornekler.get(id);
        if (k === undefined) continue;
        ayrilmis.add(id);
        uyandirGuvenli(k);
        if (ayrilmis.delete(id))
          yaz("bilgi", "rezervasyon_dustu", { sohbet_id: id });
      }
      kurbanGerekirse();
    } finally {
      ilerletiliyor = false;
      ramYoklamaAyarla();
    }
  };

  /**
   * Bir canlı sohbetin durumu değişti: bekleyen varken kurban seçilmemişse yeniden bakılır. Bir mikro
   * göreve ertelenir: olayı yayınlayan örneğin geçişinin ortasında ona `uyut` denmesin.
   */
  const kurbanSinamasiErtele = (): void => {
    if (kurbanSinamasiBekliyor || kapandi) return;
    if (bosaltilan !== null || sira.length === 0) return;
    kurbanSinamasiBekliyor = true;
    void Promise.resolve().then(() => {
      kurbanSinamasiBekliyor = false;
      if (!ilerletiliyor) kurbanGerekirse();
    });
  };

  // ---- kapı ----

  const kapi: SurecKapisi = {
    yuvaIste: (sohbet) => {
      const id = sohbet.sohbet_id;
      if (kapandi) return false;
      if (yuvadakiler.has(id)) return true;
      if (ayrilmis.delete(id)) {
        yuvadakiler.add(id);
        turTamamlayanlar.delete(id);
        yaz("bilgi", "yuva_verildi", {
          sohbet_id: id,
          yuva: yuvaSayisi(),
          ayrilmis: true,
        });
        return true;
      }
      if (!ornekler.has(id)) {
        yaz("uyari", "yuva_bilinmeyen_sohbet", { sohbet_id: id });
        return false;
      }
      if (acilisSuruyor) {
        acilisIstekleri.add(id);
        return false;
      }
      const sirada = sira.includes(id);
      const onundeYok = sira.length === 0 || (sirada && sira[0] === id);
      if (onundeYok && yuvaBosMu() && ramYeterli()) {
        if (sirada) sira.shift();
        yuvadakiler.add(id);
        turTamamlayanlar.delete(id);
        yaz("bilgi", "yuva_verildi", {
          sohbet_id: id,
          yuva: yuvaSayisi(),
          ayrilmis: false,
        });
        ramYoklamaAyarla();
        return true;
      }
      siraya(id);
      kurbanGerekirse();
      return false;
    },
    devirSerbestMi: () => !kapandi && ramYeterli(),
    yuvaBirak: (sohbet) => {
      const id = sohbet.sohbet_id;
      ayrilmis.delete(id);
      turTamamlayanlar.delete(id);
      if (!yuvadakiler.delete(id)) return;
      if (bosaltilan === id) bosaltilan = null;
      yaz("bilgi", "yuva_birakildi", { sohbet_id: id, yuva: yuvaSayisi() });
      siraIlerlet();
    },
  };

  const nesilAyir = (): number => {
    let enBuyuk = 0;
    try {
      enBuyuk = depo.enBuyukNesil();
    } catch (e) {
      yaz("hata", "en_buyuk_nesil_okunamadi", { hata_turu: hataTuru(e) });
    }
    nesilSayaci = Math.max(nesilSayaci, enBuyuk) + 1;
    return nesilSayaci;
  };

  // ---- örnekler ----

  const ortak: KonusmaOrtakBagimliliklari = {
    ayar,
    depo,
    kilit,
    // Örnek yalnız kendi iki fiilini görür; `erenJetonlariniSil` yöneticinin.
    kopru: {
      jetonUret: (kapsam) => kopru.jetonUret(kapsam),
      jetonlariIptalEt: (kapsam) => kopru.jetonlariIptalEt(kapsam),
    },
    akis: b.akis,
    surec,
    dosya: b.dosya,
    saat,
    zamanlayici,
    rastgele: b.rastgele,
    veriyolu,
    gunluk,
  };

  /** Örneği kurar ve haritaya ekler; kurucu atarsa `null`. `baslat` ayrıca tetiklenir. */
  const ornekKur = (id: SohbetNo): Konusma | null => {
    const var_ = ornekler.get(id);
    if (var_ !== undefined) return var_;
    try {
      const k = b.konusmaKur({ ...ortak, sohbet_id: id, kapi, nesilAyir });
      ornekler.set(id, k);
      return k;
    } catch (e) {
      yaz("hata", "ornek_kurulamadi", {
        sohbet_id: id,
        hata_turu: hataTuru(e),
      });
      return null;
    }
  };

  const baslatTetikle = (id: SohbetNo, k: Konusma): Promise<void> => {
    const var_ = baslatSozleri.get(id);
    if (var_ !== undefined) return var_;
    let soz: Promise<void>;
    try {
      soz = k.baslat();
    } catch (e) {
      soz = Promise.reject(e);
    }
    const guvenli = soz.catch((e: unknown) => {
      yaz("hata", "ornek_baslat_hata", {
        sohbet_id: id,
        hata_turu: hataTuru(e),
      });
    });
    baslatSozleri.set(id, guvenli);
    return guvenli;
  };

  // ---- açılış ----

  const anaGuvence = (): void => {
    if (depo.sohbetGetir(secim(ANA_SOHBET_ID)) !== null) return;
    const ms = saat.simdiMs();
    depo.sohbetEkle({
      sohbet_id: ANA_SOHBET_ID,
      ad: anaSohbetAdiUret(ayar.asistanAdi),
      olusturma_ms: ms,
      son_etkinlik_ms: ms,
    });
    yaz("bilgi", "ana_eklendi");
  };

  /** Silinmiş sohbetlerin son neslinde sahipsiz süreç kaldıysa öldürür; canlılık okunamazsa dokunmaz. */
  const sahipsizleriOldur = async (): Promise<void> => {
    let silinmisler: SohbetKaydi[];
    try {
      silinmisler = depo
        .sohbetListesi(true)
        .filter((s) => s.silinme_ms !== null);
    } catch (e) {
      yaz("hata", "silinmis_liste_okunamadi", { hata_turu: hataTuru(e) });
      return;
    }
    await Promise.all(
      silinmisler.map(async (s) => {
        try {
          const son = depo.sonNesil(secim(s.sohbet_id));
          if (son === null || son.pid === null || son.olusturma_ms === null)
            return;
          if (
            await surec.surecVarMi({
              pid: son.pid,
              olusturmaMs: son.olusturma_ms,
            })
          ) {
            await surec.agaciOldur(son.pid);
            yaz("bilgi", "sahipsiz_surec_olduruldu", {
              sohbet_id: s.sohbet_id,
              nesil: son.nesil,
            });
          }
        } catch (e) {
          yaz("uyari", "sahipsiz_surec_belirsiz", {
            sohbet_id: s.sohbet_id,
            hata_turu: hataTuru(e),
          });
        }
      }),
    );
  };

  /**
   * Kuyruğu dolu olanlar (açılış sırasında yuva isteyenler dahil) önce, sonra `son_etkinlik_ms`
   * yeniden eskiye; ilk `erenCanliAzami` tanesine ve kuyruğu dolu her örneğe `uyandir()`.
   */
  const acilisSirala = (): void => {
    const liste = [...ornekler.values()].map((k, i) => ({
      k,
      i,
      dolu: acilisIstekleri.has(k.sohbet_id) || kuyrukDolu(k.sohbet_id),
      etkinlik: sonEtkinlik(k.sohbet_id),
    }));
    liste.sort((x, y) => {
      if (x.dolu !== y.dolu) return x.dolu ? -1 : 1;
      if (x.etkinlik !== y.etkinlik) return y.etkinlik - x.etkinlik;
      return x.i - y.i;
    });
    acilisSuruyor = false;
    acilisIstekleri.clear();
    const uyandirilacak = liste.filter(
      (o, sirasi) => sirasi < ayar.erenCanliAzami || o.dolu,
    );
    yaz("bilgi", "acilis_sirasi", {
      sohbet: liste.length,
      dolu: liste.filter((o) => o.dolu).length,
      uyandirilan: uyandirilacak.length,
    });
    for (const o of uyandirilacak) {
      if (kapandi) return;
      // Kaldırılmış (araya giren silme) örneğe dokunulmaz.
      if (ornekler.get(o.k.sohbet_id) !== o.k) continue;
      uyandirGuvenli(o.k);
    }
  };

  const bostaYokla = (): void => {
    if (kapandi) return;
    const simdi = saat.simdiMs();
    for (const k of [...ornekler.values()]) {
      if (uyutulanlar.has(k.sohbet_id)) continue;
      const bos = bostaBeriOku(k);
      if (bos === null) continue;
      if (simdi - bos >= ayar.erenBostaKapatMs) uyutBaslat(k, "bosta");
    }
  };

  // ---- kurulum ----

  // Örnekler FABRİKADA, eşzamanlı kurulur (şef kararı): `ana`'nın açılış sırasında `sohbetler.baslat`'tan
  // önce yayınlanan `isler_uzlastirildi`, servis kapalıyken bitmiş işlerin `is_bitti`'si ve bağlı
  // `plan_sonuclandi` örneklerin veriyolu dinleyicilerine ulaşsın (dilim 1'de tek `konusma` gibi).
  // Kurulum süreç açmaz ve jeton üretmez; örneklerin `baslat()`'ı `erenJetonlariniSil`'den sonradır.
  try {
    anaGuvence();
  } catch (e) {
    yaz("hata", "ana_eklenemedi", { hata_turu: hataTuru(e) });
  }
  try {
    for (const s of depo.sohbetListesi()) ornekKur(s.sohbet_id);
  } catch (e) {
    yaz("hata", "sohbet_listesi_okunamadi", { hata_turu: hataTuru(e) });
  }

  // ---- yönetici ----

  return {
    baslat: async () => {
      if (kapandi || baslatCagrildi) return;
      baslatCagrildi = true;

      // Önceki ömrün eren jetonları ölür; hiçbir örnek süreç açmadan önce.
      try {
        const silinen = kopru.erenJetonlariniSil();
        yaz("bilgi", "eren_jetonlari_silindi", { silinen });
      } catch (e) {
        yaz("hata", "eren_jetonlari_silinemedi", { hata_turu: hataTuru(e) });
      }
      jetonlarSilindi = true;

      await sahipsizleriOldur();
      if (kapandi) return;

      await Promise.all([...ornekler].map(([id, k]) => baslatTetikle(id, k)));
      if (kapandi) return;

      turDinlemeIptal = veriyolu.dinle("tur_bitti", ({ sohbet_id }) => {
        if (yuvadakiler.has(sohbet_id)) turTamamlayanlar.add(sohbet_id);
        kurbanSinamasiErtele();
      });
      durumDinlemeIptal = veriyolu.dinle("eren_durumu", ({ sohbet_id, durum }) => {
        // Sıradaki örnek artık yuva beklemiyor (ör. yeni sayfa kuyruğunu sildi): sıradan çıkar, onun
        // için kurban seçilmez, yer açılınca uyandırılmaz. `kapali` (kilit) sırada bekler.
        if (durum !== "sirada" && durum !== "kapali" && sira.includes(sohbet_id)) {
          siradanCikar(sohbet_id);
          yaz("bilgi", "siradan_cikti", { sohbet_id, durum });
          ramYoklamaAyarla();
        }
        kurbanSinamasiErtele();
      });
      acilisSirala();
      if (kapandi) return;

      bostaYoklamaIptal = zamanlayici.herAralik(BOSTA_YOKLAMA_MS, bostaYokla);
      kilitDinlemeIptal = veriyolu.dinle("kilit_degisti", ({ durum }) => {
        if (durum.tur === "serbest") siraIlerlet();
      });
      // Açılış sırasında birikmiş sıra (araya giren istekler) ilerlesin.
      siraIlerlet();
      yaz("bilgi", "baslatildi", {
        sohbet: ornekler.size,
        yuva: yuvaSayisi(),
        sira: sira.length,
      });
    },

    konusma: (sohbet) => ornekler.get(sohbet.sohbet_id) ?? null,

    durumlar: () => {
      const sonuc: {
        sohbet_id: SohbetNo;
        eren: ReturnType<Konusma["durum"]>;
      }[] = [];
      const durumOku = (k: Konusma): ReturnType<Konusma["durum"]> => {
        try {
          return k.durum();
        } catch (e) {
          yaz("uyari", "durum_okunamadi", {
            sohbet_id: k.sohbet_id,
            hata_turu: hataTuru(e),
          });
          return "kapali";
        }
      };
      const ana = ornekler.get(ANA_SOHBET_ID);
      // `ana` her zaman var ve ilk: açılıştan önce örneği yoksa `kapali`.
      sonuc.push({
        sohbet_id: ANA_SOHBET_ID,
        eren: ana === undefined ? "kapali" : durumOku(ana),
      });
      for (const [id, k] of ornekler) {
        if (id === ANA_SOHBET_ID) continue;
        if (sonuc.length >= SOHBET_SINIRLARI.SOHBET_ADET) break;
        sonuc.push({ sohbet_id: id, eren: durumOku(k) });
      }
      return sonuc as SohbetDurumlariTipi;
    },

    aktifTurlar: () => {
      const sonuc: SohbetAktifTuru[] = [];
      for (const [id, k] of ornekler) {
        try {
          const t = k.aktifTur();
          if (t !== null)
            sonuc.push({ sohbet_id: id, turn_id: t.turn_id, text: t.text });
        } catch (e) {
          yaz("uyari", "aktif_tur_okunamadi", {
            sohbet_id: id,
            hata_turu: hataTuru(e),
          });
        }
      }
      return sonuc;
    },

    olustur: (sohbet, ad): Sonuc<SohbetIslemSonucu, SohbetOlusturmaHatasi> => {
      const id = sohbet.sohbet_id;
      if (kapandi) return { ok: false, code: "ic_hata" };
      let karar: OlusturmaKarari;
      try {
        karar = depo.islem((): OlusturmaKarari => {
          const kayit = depo.sohbetGetir(secim(id));
          if (kayit !== null)
            return kayit.silinme_ms === null
              ? { tur: "var" }
              : { tur: "silinmis" };
          if (depo.sohbetListesi().length >= SOHBET_SINIRLARI.SOHBET_ADET)
            return { tur: "sinir" };
          const ms = saat.simdiMs();
          depo.sohbetEkle({
            sohbet_id: id,
            ad,
            olusturma_ms: ms,
            son_etkinlik_ms: ms,
          });
          const olay = depo.olayEkle({
            type: "chat_created",
            sohbet_id: id,
            ad,
          });
          return { tur: "yeni", seq: olay.seq };
        });
      } catch (e) {
        yaz("hata", "olusturma_hata", {
          sohbet_id: id,
          hata_turu: hataTuru(e),
        });
        return { ok: false, code: "ic_hata" };
      }
      switch (karar.tur) {
        case "silinmis":
          yaz("bilgi", "olusturma_red", { sohbet_id: id, neden: "silinmis" });
          return { ok: false, code: "sohbet_bulunamadi" };
        case "sinir":
          yaz("bilgi", "olusturma_red", { sohbet_id: id, neden: "sinir" });
          return { ok: false, code: "sohbet_siniri" };
        case "var":
          // Yan etkisiz (idempotent). Örnek kurulamamışsa (kurucu atmıştı) onarılır.
          if (!ornekler.has(id)) {
            const k = ornekKur(id);
            if (k !== null && jetonlarSilindi) void baslatTetikle(id, k);
          }
          return { ok: true, deger: { seq: null } };
        case "yeni": {
          yaz("bilgi", "sohbet_olusturuldu", { sohbet_id: id, seq: karar.seq });
          const k = ornekKur(id);
          // Jetonlar silinmeden (açılıştan önce) kurulan örneğin `baslat`'ı açılışa kalır.
          if (k !== null && jetonlarSilindi) void baslatTetikle(id, k);
          veriyolu.yayinla("sohbet_listesi_degisti", {
            sohbet_id: id,
            olay: "olusturuldu",
          });
          return { ok: true, deger: { seq: karar.seq } };
        }
      }
    },

    adlandir: (
      sohbet,
      ad,
    ): Sonuc<SohbetIslemSonucu, SohbetAdlandirmaHatasi> => {
      const id = sohbet.sohbet_id;
      if (kapandi) return { ok: false, code: "ic_hata" };
      let karar: AdlandirmaKarari;
      try {
        karar = depo.islem((): AdlandirmaKarari => {
          const kayit = depo.sohbetGetir(secim(id));
          if (kayit === null || kayit.silinme_ms !== null)
            return { tur: "yok" };
          if (kayit.ad === ad) return { tur: "ayni" };
          depo.sohbetAdiYaz(secim(id), ad);
          const olay = depo.olayEkle({
            type: "chat_renamed",
            sohbet_id: id,
            ad,
          });
          return { tur: "yeni", seq: olay.seq };
        });
      } catch (e) {
        yaz("hata", "adlandirma_hata", {
          sohbet_id: id,
          hata_turu: hataTuru(e),
        });
        return { ok: false, code: "ic_hata" };
      }
      switch (karar.tur) {
        case "yok":
          return { ok: false, code: "sohbet_bulunamadi" };
        case "ayni":
          return { ok: true, deger: { seq: null } };
        case "yeni":
          yaz("bilgi", "sohbet_adlandirildi", {
            sohbet_id: id,
            seq: karar.seq,
          });
          return { ok: true, deger: { seq: karar.seq } };
      }
    },

    kaldir: (sohbet) => {
      const id = sohbet.sohbet_id;
      if (id === ANA_SOHBET_ID) return null;
      const k = ornekler.get(id);
      if (k === undefined) return null;
      ornekler.delete(id);
      baslatSozleri.delete(id);
      acilisIstekleri.delete(id);
      siradanCikar(id);
      turTamamlayanlar.delete(id);
      ayrilmis.delete(id);
      if (bosaltilan === id) bosaltilan = null;
      // Tutulan yuva süreç çıkana kadar sayılır: örneğin `sonlandir`'ı `yuvaBirak` der.
      yaz("bilgi", "sohbet_kaldirildi", {
        sohbet_id: id,
        yuvada: yuvadakiler.has(id),
      });
      ramYoklamaAyarla();
      veriyolu.yayinla("sohbet_listesi_degisti", {
        sohbet_id: id,
        olay: "silindi",
      });
      return k;
    },

    nesil: (sohbet) => ornekler.get(sohbet.sohbet_id)?.nesil() ?? 0,

    insanTuru: (sohbet) => ornekler.get(sohbet.sohbet_id)?.insanTuru() ?? null,

    devirOzetiAl: (baglam, ozet) => {
      const k = ornekler.get(baglam.sohbet_id);
      if (k === undefined) return { kabul: false };
      return k.devirOzetiAl(ozet, baglam.nesil);
    },

    kapat: () => {
      if (kapanisSozu !== null) return kapanisSozu;
      kapandi = true;
      for (const iptal of [
        bostaYoklamaIptal,
        ramYoklamaIptal,
        kilitDinlemeIptal,
        durumDinlemeIptal,
        turDinlemeIptal,
      ]) {
        try {
          iptal?.();
        } catch {
          // iptal atmamalı; atarsa kapanış sürer
        }
      }
      bostaYoklamaIptal = null;
      ramYoklamaIptal = null;
      kilitDinlemeIptal = null;
      durumDinlemeIptal = null;
      turDinlemeIptal = null;
      sira = [];
      ayrilmis.clear();
      acilisIstekleri.clear();
      bosaltilan = null;
      const ornekListesi = [...ornekler.values()];
      kapanisSozu = Promise.all(
        ornekListesi.map(async (k) => {
          try {
            await k.kapat();
          } catch (e) {
            yaz("hata", "ornek_kapat_hata", {
              sohbet_id: k.sohbet_id,
              hata_turu: hataTuru(e),
            });
          }
        }),
      ).then(() => {
        yaz("bilgi", "kapandi", { sohbet: ornekListesi.length });
      });
      return kapanisSozu;
    },
  };
};
