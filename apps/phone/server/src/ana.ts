/**
 * Kurulum sırası, `FiilIsleyiciler` eşlemesi, kapanma. Bütün modüllerin değer olarak içe aktarıldığı
 * tek yer. Giriş kısmı yalnız dosya doğrudan çalıştırılınca işler. MODULLER.md, "ana".
 */
import { appendFileSync, mkdirSync } from "node:fs";
import win32 from "node:path/win32";
import { VARSAYILAN_IS_PROFILI } from "@eren/protocol";
import type { CmdAdi, CmdSonucu } from "@eren/protocol";
import { ajandaKopruSunucuKur } from "./ajanda-kopru-sunucu.ts";
import { ajandaKur } from "./ajanda.ts";
import { akisKur } from "./akis.ts";
import { AyarHatasi, ayarKur, medyaKapaliNedeni, yollariUret } from "./ayar.ts";
import { bildirimKur } from "./bildirim.ts";
import { cihazKur } from "./cihaz.ts";
import { depoKur } from "./depo.ts";
import { disDunyaKur, dosyaPortuKur, medyaDosyaKur, veriKokuIzniHazirla } from "./dis-dunya.ts";
import { gatewayKur } from "./gateway.ts";
import { gunlukKur } from "./gunluk.ts";
import { islerKur } from "./isler.ts";
import { kilitKur } from "./kilit.ts";
import { kokIzniHataMetni } from "./kok-izni.ts";
import { konusmaKur } from "./konusma.ts";
import { kopruSunucuKur } from "./kopru-sunucu.ts";
import { medyaIsleyiciKur } from "./medya-isle.ts";
import { medyaKur } from "./medya.ts";
import { planlarKur } from "./planlar.ts";
import { sohbetlerKur } from "./sohbetler.ts";
import { takvimKur } from "./takvim.ts";
import { temizlikKur } from "./temizlik.ts";
import { veriyoluKur } from "./veriyolu.ts";
import type {
  AjandaKopruSunucu,
  AjandaYoneticisi,
  Ayar,
  Bildirim,
  CihazYoneticisi,
  CmdArgumani,
  Depo,
  DisDunya,
  FiilIsleyiciler,
  Gateway,
  Gunluk,
  GunlukAlanlari,
  IsYoneticisi,
  KopruBaglami,
  KopruSunucu,
  LimitKilidi,
  MedyaAyari,
  MedyaDosyaPortu,
  MedyaIsleyici,
  MedyaYoneticisi,
  Ortam,
  PlanYoneticisi,
  SohbetYoneticisi,
  Sonuc,
  TakvimPortu,
  Temizlik,
  Veriyolu,
} from "./sozlesme.ts";

const MODUL = "ana";
const GUNLUK_AZAMI_BAYT = 10 * 1024 * 1024;
const GUNLUK_AZAMI_DOSYA = 5;
/** Örneklerin `kapat`'ı `taskkill` bekler (en çok 15 sn): takılan kapanış süreci sonsuza dek tutmasın. */
const KAPANIS_SINIRI_MS = 30_000;
/**
 * Medya dalgası. `medya.kapat()` süren ffmpeg/whisper aracını iptal sinyaliyle keser (süreç ağacı öldürülür),
 * bu yüzden çoğunlukla 1-2 sn'de döner; 5 dk videonun dökümü (en çok 900 sn) beklenmez. Bu sınır yalnız
 * güvenlik ağıdır: iptal tutmazsa kapanış en çok bu kadar bekler, sonra sürer. `KAPANIS_SINIRI_MS` (ve bekçinin
 * 40 sn'lik `kapanmaBeklemeMs`'i) içinde kalmalı, `sohbetler` (en çok 15 sn `taskkill`) ile toplamı 30 sn'nin altında.
 * Kesilen iş (ve sınırda bırakılan) kayıt `kabul` + `isleniyor` kalır; sonraki açılışta `medya.baslat()` o eki
 * yeniden kuyruğa alır (iş kaybolmaz, yalnız yinelenir).
 */
const MEDYA_KAPANIS_SINIRI_MS = 10_000;
const KAPANIS_SINYALLERI: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];

const ROL_HATASI = { ok: false, code: "rol_fiil_izinsiz" } as const;

/** Ajanda dalgası: kullanıcının IANA dilimi = PC'nin sistem dilimi, her çağrıda yeniden okunur (A0.4). */
const sistemDilimi = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export interface ServisGirdisi {
  dunya: DisDunya;
  ayar: Ayar;
  depoYolu: string;
  /**
   * Ajanda dalgası (MODULLER.md "Ajanda dalgası" > "ana"). Verilmezse ajanda açıktır ve dilim sistemden
   * okunur (`giris` hep böyle kurar). `{ sistemDilimi }` dilim kaynağını değiştirir (testler). `false`
   * ajandayı hiç kurmaz: takvim, ajanda modülü, ajanda borusu ve `/ajanda` yolu yoktur, `sohbetler` ve
   * `gateway` ajanda bağımlılıksız kurulur, davranış ajanda öncesiyle aynıdır (A0.6; birleşim testi sabitler).
   */
  ajanda?: false | { sistemDilimi: () => string };
  /**
   * Medya dalgası (MODULLER.md "Medya dalgası" > S9). Yalnız `ayar.medya` doluyken okunur; `ayar.medya`
   * `null`/yoksa medya hiç kurulmaz, bu alan yok sayılır. Verilmezse (`giris` hep böyle) gerçekleri kurulur:
   * `medyaDosyaKur({kok: ayar.medya.kok})` ve `dunya.surec` ile `medyaIsleyiciKur`. Testler sahte ya da
   * geçici dizinli port ve işleyici verir (sahte dünyanın süreci `aracCalistir` çalıştırmaz).
   */
  medya?: { dosya: MedyaDosyaPortu; isleyici: MedyaIsleyici };
}

export interface Servis {
  fiiller: FiilIsleyiciler;
  depo: Depo;
  veriyolu: Veriyolu;
  kilit: LimitKilidi;
  kopru: KopruSunucu;
  cihaz: CihazYoneticisi;
  isler: IsYoneticisi;
  planlar: PlanYoneticisi;
  /** Dilim 2: sohbet yöneticisi; `Konusma` örnekleri (sohbet başına bir) yalnız onun içindedir. */
  sohbetler: SohbetYoneticisi;
  /** Dilim 1: "geçmişi sil" düzenleyicisi; tek girişi `gateway`'in `/sohbet` `chat_clear` dalı. */
  temizlik: Temizlik;
  bildirim: Bildirim;
  gateway: Gateway;
  gunluk: Gunluk;
  /** Ajanda dalgası; `ServisGirdisi.ajanda === false` ise üçü de `null`. */
  takvim: TakvimPortu | null;
  ajanda: AjandaYoneticisi | null;
  ajandaKopru: AjandaKopruSunucu | null;
  /** Medya dalgası; `ayar.medya` `null` ise `null` (yüzler hiçbir modüle verilmez). */
  medya: MedyaYoneticisi | null;
  baslat(): Promise<void>;
  kapat(): Promise<void>;
}

const hataAlanlari = (e: unknown): GunlukAlanlari => {
  const kod = (e as { code?: unknown } | null | undefined)?.code;
  return {
    hata_turu: e instanceof Error ? e.name : typeof e,
    ...(typeof kod === "string" ? { hata_kodu: kod } : {}),
    // Yalnız `AyarHatasi`: metni alan adı taşır, değer taşımaz. Başka iletiler güvenilmez metin taşıyabilir.
    ...(e instanceof AyarHatasi ? { ayar_hatasi: e.message } : {}),
  };
};

const gunlukYap = (dunya: DisDunya): Gunluk =>
  gunlukKur({
    kayit: dunya.kayit,
    saat: dunya.saat,
    azamiBayt: GUNLUK_AZAMI_BAYT,
    azamiDosya: GUNLUK_AZAMI_DOSYA,
  });

interface FiilModulleri {
  ayar: Pick<Ayar, "projeler">;
  planlar: Pick<PlanYoneticisi, "planOner">;
  isler: Pick<
    IsYoneticisi,
    "oturumlar" | "raporOku" | "durdur" | "soruSor" | "soruBekle" | "raporVer"
  >;
  cihaz: Pick<CihazYoneticisi, "uygulamalar" | "komut">;
  sohbetler: Pick<SohbetYoneticisi, "devirOzetiAl">;
}

/**
 * Rol denetimi `kopru-sunucu`'dadır; buradaki dallar tipi daraltır, yanlış bağlamı da geçirmez.
 * Dilim 2 (M4): ana oturum fiillerinin sohbeti YALNIZ jeton bağlamından (`baglam.sohbet_id`) gelir; fiil
 * girdisinde sohbet alanı yoktur, model seçemez.
 */
const fiilleriKur = ({ ayar, planlar, isler, cihaz, sohbetler }: FiilModulleri): FiilIsleyiciler => {
  const komutFiili =
    <A extends CmdAdi>(ad: A) =>
    async (girdi: CmdArgumani<A>, baglam: KopruBaglami, sinyal: AbortSignal): Promise<Sonuc<CmdSonucu>> =>
      baglam.rol === "telefon" ? cihaz.komut(baglam, ad, girdi, sinyal) : ROL_HATASI;

  return {
    // `profil` plan dışıdır: taslaktan ayrılır, plana ve özetine sızamaz (`Plan` katıdır).
    // Tabloda `chat_clear` yok: boru fiili değildir, `gateway` → `temizlik`'tir.
    plan_oner: async (girdi, baglam) => {
      if (baglam.rol !== "eren") return ROL_HATASI;
      const { profil, ...taslak } = girdi;
      return planlar.planOner(taslak, profil ?? VARSAYILAN_IS_PROFILI, { sohbet_id: baglam.sohbet_id });
    },
    oturumlar: async (girdi, baglam) =>
      baglam.rol === "eren"
        ? { ok: true, deger: isler.oturumlar(girdi, { sohbet_id: baglam.sohbet_id }) }
        : ROL_HATASI,
    rapor_oku: async (girdi, baglam) =>
      baglam.rol === "eren" ? isler.raporOku(girdi.id, { sohbet_id: baglam.sohbet_id }) : ROL_HATASI,
    projeler: async () => ({ ok: true, deger: await ayar.projeler() }),
    uygulamalar: async () => ({ ok: true, deger: cihaz.uygulamalar() }),
    oturum_durdur: async (girdi, baglam) =>
      baglam.rol === "eren" ? isler.durdur(girdi.id, "eren", { sohbet_id: baglam.sohbet_id }) : ROL_HATASI,
    devir_ozeti: async (girdi, baglam) =>
      baglam.rol === "eren" ? { ok: true, deger: sohbetler.devirOzetiAl(baglam, girdi.ozet) } : ROL_HATASI,
    kullaniciya_sor: async (girdi, baglam, sinyal) =>
      baglam.rol === "soru" ? isler.soruSor(baglam.is_id, girdi, sinyal) : ROL_HATASI,
    soru_bekle: async (girdi, baglam, sinyal) =>
      baglam.rol === "soru" ? isler.soruBekle(baglam.is_id, girdi, sinyal) : ROL_HATASI,
    foreground: komutFiili("foreground"),
    elements: komutFiili("elements"),
    screenshot: komutFiili("screenshot"),
    zoom: komutFiili("zoom"),
    click: komutFiili("click"),
    type_text: komutFiili("type_text"),
    key: komutFiili("key"),
    scroll: komutFiili("scroll"),
    drag: komutFiili("drag"),
    wait: komutFiili("wait"),
    open_app: komutFiili("open_app"),
    rapor_ver: async (girdi, baglam) =>
      baglam.rol === "telefon" ? isler.raporVer(baglam.is_id, girdi) : ROL_HATASI,
  };
};

export function servisKur({ dunya, ayar, depoYolu, ajanda: ajandaSecenegi, medya: medyaSecenegi }: ServisGirdisi): Servis {
  const { saat, zamanlayici, rastgele, dosya, surec, sistem, ws, boru, http, anahtar, transkript } = dunya;
  const gunluk = gunlukYap(dunya);

  const veriyolu = veriyoluKur({ gunluk });
  const depo = depoKur({ yol: depoYolu, saat, veriyolu, gunluk, anaSohbetAdi: ayar.asistanAdi });
  const kilit = kilitKur({ ayar, depo, dosya, saat, zamanlayici, veriyolu, gunluk });

  // Medya dalgası (MODULLER.md "Medya dalgası" > "Akışlar" > "Açılış"). Yalnız `ayar.medya` doluyken kurulur
  // ve o zaman yüzleri `sohbetler`, `temizlik`, `gateway`'e verilir; yoksa hiçbirine anahtar eklenmez ve
  // davranış medya öncesiyle aynıdır (M0.1). Kapalı nedeni `ayarKur`'un bulduğudur (arama yinelenmez).
  const medyaAyari = ayar.medya ?? null;
  const medya: MedyaYoneticisi | null = medyaAyari === null ? null : medyaYoneticisiKur(medyaAyari);
  function medyaYoneticisiKur(m: MedyaAyari): MedyaYoneticisi {
    const medyaDosya = medyaSecenegi?.dosya ?? medyaDosyaKur({ kok: m.kok });
    const isleyici =
      medyaSecenegi?.isleyici ?? medyaIsleyiciKur({ surec, ayar: m, veriKoku: ayar.yollar.kok, dosya: medyaDosya });
    return medyaKur({
      ayar: m,
      ramDusukMb: ayar.ramDusukMb,
      depo,
      dosya: medyaDosya,
      isleyici,
      saat,
      zamanlayici,
      rastgele,
      sistem,
      veriyolu,
      gunluk,
    });
  }
  if (medyaAyari === null) {
    const neden = medyaKapaliNedeni(ayar);
    if (neden !== null) gunluk.uyari(MODUL, "medya_kapali", { neden });
  } else {
    // Yol yazılmaz (M0.4): yalnız modelin bulunup bulunmadığı.
    gunluk.bilgi(MODUL, "medya_acik", {
      dokum_modeli: medyaAyari.dokumModeli !== null,
      dokum_vad: medyaAyari.dokumVadModeli !== null,
      dokum_dili: medyaAyari.dokumDili,
      kota_mb: Math.round(medyaAyari.kotaBayt / (1024 * 1024)),
    });
  }

  const akis = akisKur();
  const kopru = kopruSunucuKur({ boru, depo, rastgele, anahtar, zamanlayici, gunluk });

  // Ajanda dalgası. Tek yazar `ajanda`; araç çağrısının turu `sohbetler`'den okunur. `sohbetler` aşağıda
  // kurulur: bağ geç çözülür (yalnız araç çağrısı anında, `baslat`'tan sonra), kurulum sırası değişmez.
  const ajandaAcik = ajandaSecenegi !== false;
  const takvim = ajandaAcik ? takvimKur({ sistemDilimi: ajandaSecenegi?.sistemDilimi ?? sistemDilimi }) : null;
  const ajanda =
    takvim === null
      ? null
      : ajandaKur({
          depo,
          takvim,
          saat,
          rastgele,
          gunluk,
          turBaglami: (sohbet, nesil) => sohbetler.konusma(sohbet)?.turBaglami?.(nesil) ?? null,
        });
  const ajandaKopru = ajanda === null ? null : ajandaKopruSunucuKur({ boru, depo, rastgele, anahtar, zamanlayici, gunluk });
  const cihaz = cihazKur({ ayar, saat, zamanlayici, rastgele, veriyolu, depo, gunluk });
  const isler = islerKur({
    ayar,
    depo,
    kilit,
    kopru,
    akis,
    surec,
    dosya,
    sistem,
    saat,
    zamanlayici,
    rastgele,
    veriyolu,
    gunluk,
  });
  const planlar = planlarKur({
    depo,
    isler,
    kilit,
    cihaz,
    nesil: (sohbet) => sohbetler.nesil(sohbet),
    // İnsan turu bilgisinin tek kaynağı o sohbetin örneğidir (yönetici yönlendirir); köprü bağlamı
    // buraya taşınmaz.
    insanTuru: (sohbet) => sohbetler.insanTuru(sohbet),
    tamYetki: () => ayar.tamYetki,
    dosya,
    rastgele,
    saat,
    veriyolu,
    gunluk,
  });
  // Örnekler (sohbet başına `Konusma`) yalnız yöneticinin içinde kurulur: `konusmaKur` kurucu olarak
  // verilir, sohbete özgü `sohbet_id`/`kapi`/`nesilAyir`'ı yönetici ekler. Aynı `veriyolu` bütün
  // örneklere ve yöneticinin kendi dinleyicilerine (`tur_bitti`, `eren_durumu`, `kilit_degisti`) gider.
  const sohbetler = sohbetlerKur({
    konusmaKur,
    ayar,
    depo,
    kilit,
    kopru,
    akis,
    surec,
    dosya,
    saat,
    zamanlayici,
    rastgele,
    veriyolu,
    gunluk,
    sistem,
    // A0.6: ikisi birlikte verilir ya da hiçbiri; yoksa örnekler ajanda öncesi gibi kurulur.
    ...(takvim !== null && ajandaKopru !== null && { takvim, ajandaKopru }),
    // Medya dalgası (S6): örneklere aynen geçer (ekli insan satırı, kuyruk başının içeriği, görsel bütçesi).
    ...(medya !== null && { medya }),
  });
  // `sohbetler`'den sonra, `gateway`'den önce. Transkript portu yalnız buraya bağlanır: dar porttur,
  // yalnız ana oturum nesillerinin oturum kimliklerini alır.
  const temizlik = temizlikKur({
    depo,
    sohbetler,
    isler,
    planlar,
    transkript,
    saat,
    gunluk,
    // Medya dalgası (S7): silme işleminden sonra o sohbetin medya dizinleri (beklenmez).
    ...(medya !== null && { medya }),
  });
  const bildirim = bildirimKur({ ayar, cihaz, http, zamanlayici, veriyolu, gunluk });
  const gateway = gatewayKur({
    ayar,
    depo,
    sohbetler,
    planlar,
    isler,
    temizlik,
    cihaz,
    kilit,
    sistem,
    ws,
    anahtar,
    rastgele,
    saat,
    zamanlayici,
    veriyolu,
    gunluk,
    // `/ajanda` yolu, dinleme sınırı, kayıt yayını aboneliği, yetki yoklaması ve kanal kapanışı gateway'de.
    ...(ajanda !== null && { ajanda }),
    // Medya dalgası (S5): `medya1` bağlantılarında `media_*`, `ekler` ön denetimi, `media_state` yayını.
    ...(medya !== null && { medya }),
  });

  const fiiller = fiilleriKur({ ayar, planlar, isler, cihaz, sohbetler });
  let kapanis: Promise<void> | null = null;

  /** `medya.kapat()`, en çok `MEDYA_KAPANIS_SINIRI_MS`; sınır dolarsa uyarı yazar ve kapanış sürer. */
  const medyaKapat = async (): Promise<void> => {
    if (medya === null) return;
    const bitti = await new Promise<boolean>((coz, reddet) => {
      const iptal = zamanlayici.sonra(MEDYA_KAPANIS_SINIRI_MS, () => coz(false));
      medya.kapat().then(
        () => {
          iptal();
          coz(true);
        },
        (e: unknown) => {
          iptal();
          reddet(e);
        },
      );
    });
    if (!bitti) gunluk.uyari(MODUL, "medya_kapanis_siniri", { sinir_ms: MEDYA_KAPANIS_SINIRI_MS });
  };

  return {
    fiiller,
    depo,
    veriyolu,
    kilit,
    kopru,
    cihaz,
    isler,
    planlar,
    sohbetler,
    temizlik,
    bildirim,
    gateway,
    gunluk,
    takvim,
    ajanda,
    ajandaKopru,
    medya,

    async baslat() {
      const adimlar: ReadonlyArray<() => unknown> = [
        // Fabrikalar eşzamanlı olduğu için ilk okuma burada. Modüllerden sonra olması şart: `cihaz`
        // kilidi yalnız `kilit_degisti`'nden öğrenir, açılıştaki aktif kilidi başka yerden göremez.
        () => kilit.baslat(),
        // Ajanda dalgası: depo kimliği gateway ve köprüden önce kurulur (`karsila` ve araçlar onu okur).
        () => ajanda?.baslat(),
        // Önceki ömrün ajanda jetonları ve açık bağlantıları: `sohbetler.baslat()` yenilerini üretmeden
        // önce (`eren` jetonlarını `sohbetler` kendisi siler). Silinen sayı ajanda borusunun günlüğünde.
        () => ajandaKopru?.jetonlariniSil(),
        // Ana oturumların köprüleri bağlanmadan dinliyor olmalı: `sohbetler.baslat()`'tan önce. Boru
        // açılamazsa (ad başka süreçte) `eren` borusu gibi açılış düşer: sahte bir sunucuya jeton gitmesin.
        // `eren` borusundan önce: iki boru bağımsızdır; sahte borunun adsız `baglan`'ı en son dinlenene
        // (`eren`) gittiği için eski birleşim testleri değişmeden kalır.
        // PC oturumları (AJANDA.md "PC oturumları"): araç öncesi kanca ajandanın PC defterine; PC anahtarı yoksa
        // PC rolleri yine reddedilir (`ajanda_pc_anahtarlari` boş).
        () => (ajanda === null ? undefined : ajandaKopru?.baslat(ajanda.araclar, ajanda.pcKanca)),
        () => kopru.baslat(fiiller),
        () => isler.uzlastir(),
        // Küresel, alansız: `ana`'da görünür. Önceki ömürde herhangi bir sohbette nesil açıldıysa.
        () => {
          if (depo.enBuyukNesil() <= 0) return;
          depo.olayEkle({
            type: "system_notice",
            seviye: "uyari",
            kod: "servis_yeniden_basladi",
            metin: "Servis yeniden başladı.",
          });
        },
        () => bildirim.baslat(),
        // Medya dalgası: açılış uzlaştırması (yetim bağlar, `alinan` diskten, yarım işlemenin yeniden
        // kuyruğu, silinecekler, sahipsiz dizinler) ilk `media_*` (`gateway`) ve ilk `icerik`
        // (`sohbetler`) çağrısından ÖNCE biter. Hiç atmaz; hatası `medya` günlüğündedir.
        () => medya?.baslat(),
        () => gateway.baslat(),
        // Ana oturum jetonlarını siler, örnekleri kurar ve kurtarır, açılış sırasıyla uyandırır (süreç
        // açılışı arkada sürer). `ana` bunları ayrıca yapmaz.
        () => sohbetler.baslat(),
      ];
      try {
        for (const adim of adimlar) {
          if (kapanis !== null) return;
          await adim();
        }
      } catch (e) {
        // Açılış sürerken kapanış geldiyse kapanan depo bu dala düşürür: hata değil.
        if (kapanis === null) throw e;
      }
    },

    kapat() {
      kapanis ??= (async () => {
        // İş oturumları `detached`'tır, kimse öldürmez: sonraki açılış sahiplenir.
        const adimlar: ReadonlyArray<readonly [string, () => unknown]> = [
          // Yeni tetik kesilir: kilit olayı burada telefon işlerini durdurmasın.
          ["kilit", () => kilit.kapat()],
          // `sohbetler`'den önce: örneklerin dinleyicileri gittikten sonra biten işin sentetik notu
          // kaybolurdu.
          ["isler", () => isler.kapat()],
          ["planlar", () => planlar.kapat()],
          ["bildirim", () => bildirim.kapat()],
          // `sohbetler`'den önce: süren yeni sayfa, sonlandırma (ve transkript silme) bitsin, sonra
          // örnekler kapansın.
          ["temizlik", () => temizlik.kapat()],
          // Yoklamalar durur, bütün örnekler paralel kapanır; açık tur kısmi metniyle kalır.
          ["sohbetler", () => sohbetler.kapat()],
          ["cihaz", () => cihaz.kapat()],
          // `/ajanda` bağlantıları ve kayıt yayını aboneliği burada kapanır.
          ["gateway", () => gateway.kapat()],
          // `gateway`'den sonra: kapanan yönetici `media_*`'ya `reddedildi{medya_yok}` döner, telefon bunu
          // kalıcı ret sayar; bağlantılar önce kapanmalı. `depo`'dan önce. Bekleme sınırlıdır (yukarıdaki not).
          ["medya", () => medyaKapat()],
          ["kopru", () => kopru.kapat()],
          ["ajandaKopru", () => ajandaKopru?.kapat()],
          ["depo", () => depo.kapat()],
        ];
        for (const [ad, adim] of adimlar) {
          try {
            await adim();
          } catch (e) {
            gunluk.hata(MODUL, "kapanis_hatasi", { adim: ad, ...hataAlanlari(e) });
          }
        }
      })();
      return kapanis;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Giriş: yalnız doğrudan çalıştırılınca
// ---------------------------------------------------------------------------------------------

const bos = (): void => {};

const ortamKopyasi = (): Ortam => {
  const kopya: Record<string, string> = {};
  for (const [ad, deger] of Object.entries(process.env)) {
    if (deger !== undefined) kopya[ad] = deger;
  }
  return kopya;
};

/** `gunluk` henüz yokken (bozuk ayar, bozuk anahtar): görünmez konsolda kaybolmasın. */
const erkenHataYaz = (ortam: Ortam, olay: string, e: unknown): void => {
  const satir = `${JSON.stringify({ ts_ms: Date.now(), seviye: "hata", modul: MODUL, olay, ...hataAlanlari(e) })}\n`;
  try {
    const log = yollariUret(ortam).log;
    mkdirSync(win32.dirname(log), { recursive: true });
    appendFileSync(log, satir);
  } catch {
    // `LOCALAPPDATA` yoksa dosya da yok: yalnız stderr kalır.
  }
  process.stderr.write(satir);
};

const giris = async (): Promise<void> => {
  // Süreç başında bir kez: `server_status.servis.baslangic_ms` (ana istisnadır, `Date.now` serbest).
  const baslangicMs = Date.now();
  // Eşzamanlı, ilk iş: kanal sonradan kopsa da "bekçi altında başlatıldık" bilgisi kalır.
  const bekciAltinda = typeof process.send === "function" && process.channel !== undefined;
  const ortam = ortamKopyasi();
  let gunluk: Gunluk | null = null;

  // Kurtarma periyodik tetikle olur (`PT5M`), ayrı koruyucu yok. Reddedilen söz de buraya düşer.
  const olumcul = (olay: string, e: unknown): never => {
    if (gunluk === null) erkenHataYaz(ortam, olay, e);
    else gunluk.hata(MODUL, olay, hataAlanlari(e));
    process.exit(1);
  };
  process.on("uncaughtException", (e, kaynak) => {
    olumcul(kaynak === "unhandledRejection" ? "yakalanmamis_ret" : "yakalanmamis_hata", e);
  });

  // `conhost` ölünce `EPIPE`. Stdout'a yazılmaz.
  process.stdout.on("error", bos);
  process.stderr.on("error", bos);

  try {
    const ayar = await ayarKur({ dosya: dosyaPortuKur(), ortam, execPath: process.execPath, baslangicMs });
    // Kökte anahtar, veritabanı, jeton ve çalışan kod durur: başka hesaba açık kökle açılmaz (kok-izni.ts).
    // `disDunyaKur` anahtarı okur/yazar; denetim ondan önce. Kök yoksa burada yalnız kullanıcıya açık oluşur.
    const izin = await veriKokuIzniHazirla(ayar.yollar.kok);
    if (!izin.guvenli) throw new AyarHatasi(kokIzniHataMetni(izin.sorunlar));
    const dunya = await disDunyaKur({ yollar: ayar.yollar });
    const g = gunlukYap(dunya);
    gunluk = g;

    const { kok, log, islerDizini, erenCwd, erenMcpDizini, vt } = ayar.yollar;
    // Dilim 2: nesil başına mcp dosyaları (`<erenMcpDizini>\<nesil>.json`) buraya yazılır.
    for (const dizin of [kok, win32.dirname(log), islerDizini, erenCwd, erenMcpDizini]) {
      await dunya.dosya.dizinOlustur(dizin);
    }

    // `schtasks /end` yalnız `conhost`'u öldürür, Node yaşar; `IgnoreNew` yetmez.
    if (!(await dunya.tekilKilit.al())) {
      g.bilgi(MODUL, "ikinci_ornek");
      process.exit(0);
    }

    const servis = servisKur({ dunya, ayar, depoYolu: vt });
    let kapaniyor = false;
    // Sinyal ve IPC aynı nazik yolu kullanır: 30 sn sınırı, kapanış sonrası `exit(0)`, takılırsa `exit(1)`.
    const kapat = (alanlar: GunlukAlanlari): void => {
      kapaniyor = true;
      g.bilgi(MODUL, "kapaniyor", alanlar);
      setTimeout(() => process.exit(1), KAPANIS_SINIRI_MS).unref();
      void servis.kapat().finally(() => process.exit(0));
    };
    for (const sinyal of KAPANIS_SINYALLERI) process.once(sinyal, () => kapat({ sinyal }));

    // Bekçi çocuğu olarak başlatıldıysa IPC kanalı vardır. Windows'ta sinyal gönderilemediğinden nabız
    // ve nazik kapanış buradan gelir. Kanal yoksa (elle başlatma) hiçbir şey kurulmaz.
    if (bekciAltinda) {
      const ipcKapat = (kaynak: string): void => {
        if (!kapaniyor) kapat({ kaynak });
      };
      process.on("message", (m: unknown) => {
        if (typeof m !== "object" || m === null) return;
        const { tur, n } = m as { tur?: unknown; n?: unknown };
        if (tur === "kapat") {
          ipcKapat("ipc_kapat");
        } else if (tur === "nabiz" && typeof n === "number" && Number.isFinite(n)) {
          try {
            // Kanal kapanmışsa atar ya da geri çağrıya hata verir: süreç çökmez.
            process.send?.({ tur: "nabiz_cevap", n }, bos);
          } catch {
            // Bekçi gitti: `disconnect` zaten nazik kapanışı başlatır.
          }
        }
      });
      process.on("disconnect", () => ipcKapat("ipc_kopuk"));
      // Bekçi başlatma sırasında öldüyse `disconnect` dinleyiciden önce gelip kaçmıştır: yetim kalma.
      if (!process.connected) ipcKapat("ipc_kopuk");
    }

    await servis.baslat();
    g.bilgi(MODUL, "basladi", { pid: process.pid, bekci_altinda: bekciAltinda });
  } catch (e) {
    olumcul("baslatma_hatasi", e);
  }
};

if (import.meta.main) await giris();
