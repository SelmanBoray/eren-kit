/**
 * Bir sohbetin ana oturumu (dilim 2: sohbet başına bir örnek, örnekleri `sohbetler` kurar): başlatma, stdin
 * satırları, tur, akış, kesme, doluluk, devir, kurtarma, yuva (canlı sınırı), uyutma. Ana oturum tam yetkili
 * normal bir oturumdur, bağlamı dolduracak işleri `plan_oner` ile verir; stdin'e aynı anda tek satır
 * gider, sonraki `result`'tan sonra. Modül düzeyinde durum yok: aynı süreçte birden çok örnek yaşar.
 * MODULLER.md, "konusma" ve "Dilim 2" > "konusma (örnek)".
 */
import { citleSar, kacir, SINIRLAR, SOHBET_SINIRLARI } from "@eren/protocol";
import type {
  AkisOlayi,
  BoruluSurec,
  DogrulanmisInsanMesaji,
  ErenKuyrukSatiri,
  IptalEt,
  IsKaydi,
  IsNo,
  JetonKapsami,
  KonusmaFabrikasi,
  MesajKullanimi,
  NesilKaydi,
  SohbetErenDurumuTipi,
  SohbetSecimi,
  SonlandirmaSonucu,
  TurBitisi,
  TurKaynagi,
  TurSonucuSinifi,
  YeniSayfaSonucu,
} from "./sozlesme.ts";
import type { DevirIsi } from "./konusma-metin.ts";
import { tuketimKayitlari } from "./tuketim.ts";
import {
  DEVIR_ISTEGI,
  devirMetni,
  erenMcpMetni,
  initReddiMetni,
  isBittiMetni,
  kirp,
  kurtarmaNotu,
  planSonucuMetni,
  sistemIstemi,
  soruDurumuMetni,
  uzlastirmaMetni,
  yarimVekilleBitiyorMu,
  yenidenBasladiMetni,
} from "./konusma-metin.ts";

/**
 * Ana sohbet sürecinin `--tools` listesi: sistem isteminin gerektirdiği en küçük yerleşik araç kümesi
 * (PC'de komut, dosya okuma/yazma, arama, web). Varsayılan 33 yerleşik araç tanımı (yalnız Workflow 22.389 karakter)
 * her istekte modele gider; liste ilk istek girdisini 29.298 → 14.365 token'a indirir (gerçek `claude`, 2026-11-09).
 * MCP araçları (`mcp__eren__*`, computer-use) bu listeden bağımsızdır ve görünmeye devam eder.
 */
const ANA_SOHBET_ARACLARI = "PowerShell,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch";

const SENTETIK_BIRLESME = 8;
/** Pencere bilinmiyorsa. Bilinirken eşik `akis.devirEsigi`'nden gelir. */
const VARSAYILAN_ESIK = 200000;
const ESKI_OLDURME_MS = 5000;
/** Yeni sayfada stdin kapandıktan sonra eski sürecin kendi çıkışı için beklenen en uzun süre. */
const KAPANIS_PAYI_MS = 2000;
const KISMI_YAZMA_ARALIGI_MS = 1000;
const RESUME_DENEME = 2;
const ARDISIK_HATA_SINIRI = 2;
const KONUSMA_ADEDI = 10;
const AKTIF_IS_ADEDI = 50;
const SON_IS_ADEDI = 10;
/** `init` ilk stdin satırından önce gelmez `[eren-surec §1]`: boşta bekleyen süreç bu paydan sonra hazır sayılır. */
const HAZIR_PAYI_MS = 10000;

const BITISLER: Readonly<Record<TurSonucuSinifi, TurBitisi>> = { tamam: "tamam", kesildi: "kesildi", hata: "hata" };

type TurRolu = "normal" | "devir_istek" | "devir_ilk";
type BaslatmaKipi = "yeni" | "devam";

interface Tur {
  readonly turn_id: string;
  /** Turu başlatan satırın kaynağı; insan turu yalnız kuyruğun `insan` satırından doğar. */
  readonly kaynak: TurKaynagi;
  readonly gorunur: boolean;
  readonly rol: TurRolu;
  /** Turun şu ana kadarki metni; `ASISTAN_METNI`'ni aşmaz. */
  metin: string;
  /** `metin`'in telefona gitmiş kısmının uzunluğu: sonraki `offset`. */
  gonderilen: number;
  sonKismiMs: number;
  tamponZamani: IptalEt | null;
  /** Telefonun gördüğü son parçadan sonra yeni parça gelmese de kısmi metni yazan tek atımlık zamanlayıcı. */
  kismiZamani: IptalEt | null;
}

interface Calisan {
  readonly surec: BoruluSurec;
  readonly nesil: number;
  readonly session_id: string;
  readonly kip: BaslatmaKipi;
  readonly baslangicMs: number;
  tur: Tur | null;
  model: string | null;
  kullanim: MesajKullanimi | null;
  dolu: number | null;
  pencere: number | null;
  initGoruldu: boolean;
  ilkSonuc: boolean;
  hazirlandi: boolean;
  hazirZamani: IptalEt | null;
  /** Servis kendi kapatıyor: çıkışı kurtarma başlatmaz, satırları okunmaz. */
  bilincli: boolean;
  bitti: boolean;
  kirik: boolean;
  oldurme: IptalEt | null;
  stderrBirim: number;
}

interface Devir {
  /**
   * Adayın nesli: aday aşamasında, süreç açılmadan hemen önce `nesilAyir()`'dan; o ana dek `null`.
   * Nesil tüm sohbetlerde tekildir: aynı sohbetin önceki nesli bundan türetilmez.
   */
  nesil: number | null;
  /** Devredilen (eski) neslin numarası; eski süreç ölse de kalır. Jeton iptali, `bitis_ms`, özet denetimi. */
  readonly eskiNesil: number;
  /** `null`: eski süreç yok (yalnız veritabanıyla yeni nesil) ya da beklerken öldü. */
  eski: Calisan | null;
  asama: "ozet" | "aday";
  ozet: string | null;
  zaman: IptalEt | null;
  aday: Calisan | null;
}

const bosluk = /\s/;

/** Bekleyen kısımda son boşluğun bir sonrası; boşluk yoksa `bas`. Parçalar kelime hizalı gelmez. */
const sonBoslukSonu = (metin: string, bas: number): number => {
  for (let i = metin.length - 1; i >= bas; i--) {
    if (bosluk.test(metin.charAt(i))) return i + 1;
  }
  return bas;
};

// Satır kurucular: biçim MODULLER.md tablosuyla bire bir, anahtar sırası dahil. `client_composed` her
// satırda `@yol` korumasıdır. Başka satır kurucu yoktur.

/** İnsan kökenli satırın tek kod noktası. Girdisi yalnız `insanMesajiAl`'ın yazdığı kuyruk satırı. */
const insanSatiriKur = (satir: ErenKuyrukSatiri): string => {
  if (satir.kaynak !== "insan") throw new Error("konusma: kuyruk satırı insan kaynaklı değil");
  return JSON.stringify({
    type: "user",
    parent_tool_use_id: null,
    client_composed: true,
    origin: { kind: "human" },
    message: { role: "user", content: satir.metin },
  });
};

/**
 * Kuyruğa (yalnız ana oturuma) giden insan metni. v4 kısayol mesajı önekle gider: kullanıcının o an baktığı
 * uygulama; ad ve paket `kacir` ile tırnak içinde tek satır (bağlam telefonun beyanıdır, satır
 * kıramaz). `user_echo` ve telefon öneksiz metni görür; önek kuyruğa yazılırken konur, şema değişmez.
 */
const erenMetniKur = (mesaj: {
  input: string;
  text: string;
  baglam?: { paket: string; ad: string } | undefined;
}): string => {
  if (mesaj.input !== "kisayol") return mesaj.text;
  const b = mesaj.baglam;
  const onek =
    b === undefined
      ? "[telefon kısayolu]"
      : `[telefon kısayolu: kullanıcı şu an "${kacir(b.ad, SOHBET_SINIRLARI.BAGLAM_ADI)}" (${kacir(b.paket, SINIRLAR.PAKET_ADI)}) uygulamasına bakıyor]`;
  return `${onek}\n${mesaj.text}`;
};

const sentetikSatirKur = (metin: string): string =>
  JSON.stringify({
    type: "user",
    parent_tool_use_id: null,
    client_composed: true,
    isSynthetic: true,
    message: { role: "user", content: metin },
  });

const kesmeSatiriKur = (request_id: string): string =>
  JSON.stringify({ type: "control_request", request_id, request: { subtype: "interrupt" } });

/** Bilinçli kapatma isteği (`uyut`): süreç kapanıp mcp dosyası silinince çözülür. */
interface Uyutma {
  readonly cozler: Array<() => void>;
  readonly soz: Promise<void>;
}

export const konusmaKur: KonusmaFabrikasi = ({
  sohbet_id,
  kapi,
  nesilAyir,
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
}) => {
  const sureler = ayar.sureler;
  const computerUse = ayar.computerUse ?? null;
  const masaustu = computerUse !== null;
  /** PC tam yetki anahtarı (dilim 3b): `masaustu` gibi servis ömrü boyunca sabit, istemde söylenir. */
  const tamYetki = ayar.tamYetki;
  /** Bu örneğin sohbeti: her sohbet kapsamlı depo çağrısının ve kapı isteğinin son parametresi. */
  const sohbet: SohbetSecimi = { sohbet_id };
  const kapsam = (nesil: number): JetonKapsami => ({ rol: "eren", sohbet_id, nesil });
  let baslatCagrildi = false;
  /** Kurtarma bitmeden kilit olayı süreç açmasın. */
  let baslatildi = false;
  let kapandi = false;
  /** `sonlandir` çağrıldı: kalıcı kapanış (`kapandi` da doğru), `insanMesajiAl` atar, olay yayınlanmaz. */
  let sonlandirildi = false;
  let sonlandirmaSozu: Promise<SonlandirmaSonucu> | null = null;
  /** `init` denetimi geçmedi: bu servis ömründe otomatik başlatma ve devir yok. */
  let reddedildi = false;
  let baslatmaSuruyor = false;
  let etkin: Calisan | null = null;
  let devir: Devir | null = null;
  let nesilNo = depo.sonNesil(sohbet)?.nesil ?? 0;
  // Yuva (dilim 2, `SurecKapisi`): sohbet başına tek birim; süreç, aday ve başlatma kalmayınca bırakılır.
  let yuvaTutuyor = false;
  /** `yuvaIste` `false` döndü: yönetici yer açılınca `uyandir()` der. Durum `sirada`. */
  let sirada = false;
  /** `baslat` bitmeden `uyandir` çağrıldı: kurtarma bitince bir kez denenir. */
  let uyandirBekliyor = false;
  /**
   * Kilit yüzünden süreci kapandı ya da açılamadı (süreç vardı, açılıyordu, sıradaydı, çökme sonrası
   * bekliyordu ya da açılış denemesi kilide takıldı): kilit açılınca yeniden açılır.
   */
  let kilittenOnceCanli = false;
  /** `uyut` istendi, süreç henüz kapatılmadı (tur, devir, sayfa ya da başlatma bitince kapanır). */
  let uyutmaIstegi: Uyutma | null = null;
  /** `uyut` ile kapatılan süreç: çıkışı ve mcp dosyasının silinmesi beklenir; yuva o ana dek tutulur. */
  let uyutulan: { readonly c: Calisan; readonly istek: Uyutma } | null = null;
  /** Boşa düştüğü an (`bostaBeri`). */
  let bostaMs: number | null = null;
  // Nesil mcp dosyası: (açılan ya da yaşayan) süreç sayısı; sıfıra inince silinir.
  const mcpKullanim = new Map<number, number>();
  const mcpSilmeleri = new Map<number, Promise<void>>();
  let sonDurum: SohbetErenDurumuTipi = "uyuyor";
  let yenidenZamani: IptalEt | null = null;
  let kurtarmaZamani: IptalEt | null = null;
  let yenidenBildir = false;
  let bekleyenNot: string | null = null;
  let resumeHatasi = 0;
  let ardisikHata = 0;
  const emekliler = new Set<Calisan>();
  /** Başlatılmış, çıkışı görülmemiş her süreç: yeni sayfa hepsini eski oturum sayar. */
  const canlilar = new Set<Calisan>();
  /** Süren başlatma ve devir adayı işleri: yeni sayfa bunlar sonuçlanmadan eski süreçleri saymaz. */
  const arkaIsler = new Set<Promise<void>>();
  // Yeni sayfa (Dilim 1). `sayfaSuruyor`: kuyruk akmaz, `insanTuru` `null`, temizlenemez.
  let sayfaSuruyor = false;
  let sayfaSozu: Promise<YeniSayfaSonucu> | null = null;
  /** Sonraki açılış `--resume` yapmaz, ilk satırsız yeni oturum açar; yeni nesil açılınca iner. */
  let sayfaBekliyor = false;
  /** Her yeni sayfada artar: sayfadan önce başlamış bir açılış kendi sürecini kapatır. */
  let sayfaNo = 0;

  const hataYaz = (olay: string, e: unknown): void => {
    // İleti yazılmaz: içinde güvenilmez metin olabilir.
    gunluk.hata("konusma", olay, { sohbet_id, hata_turu: e instanceof Error ? e.name : typeof e });
  };

  const guvenli = (olay: string, f: () => void): void => {
    try {
      f();
    } catch (e) {
      hataYaz(olay, e);
    }
  };

  const arkaPlan = (olay: string, p: Promise<void>): void => {
    p.catch((e: unknown) => hataYaz(olay, e));
  };

  /** Süren işi izler: yeni sayfa, sonuçlanmadan eski süreçleri saymaz. */
  const izle = (p: Promise<void>): Promise<void> => {
    arkaIsler.add(p);
    const sil = (): void => void arkaIsler.delete(p);
    p.then(sil, sil);
    return p;
  };

  /** Kilit okunamazsa serbest sayılmaz (başlatma kapısı kapalı). */
  const kilitSerbest = (): boolean => {
    try {
      return kilit.baslatmaSerbestMi();
    } catch (e) {
      hataYaz("kilit_okunamadi", e);
      return false;
    }
  };

  /** Kuyrukta bu sohbetin satırı var mı (insan ya da sentetik). Okunamazsa `false`. */
  const kuyrukDolu = (): boolean => {
    try {
      return depo.kuyrukBasi(sohbet) !== null;
    } catch (e) {
      hataYaz("kuyruk_okunamadi", e);
      return false;
    }
  };

  const durumHesapla = (): SohbetErenDurumuTipi => {
    if (!kapandi) {
      if (sayfaSuruyor || devir !== null || baslatmaSuruyor) return "baslatiliyor";
      if (etkin !== null) {
        if (etkin.tur !== null) return "tur_suruyor";
        return etkin.hazirlandi ? "hazir" : "baslatiliyor";
      }
    }
    // Süreç yok: kapanmış, `init` reddi, kilit ya da çökme sonrası bekleme `kapali`; yuva bekliyorsa `sirada`.
    if (kapandi || reddedildi || !kilitSerbest() || yenidenZamani !== null || kurtarmaZamani !== null) return "kapali";
    return sirada ? "sirada" : "uyuyor";
  };

  /** Süreç, aday, süren başlatma, yeni sayfa, uyutma ya da sonlandırma varsa yuva gerekir. */
  const yuvaGerekli = (): boolean =>
    !kapandi && (etkin !== null || devir !== null || baslatmaSuruyor || sayfaSuruyor || uyutulan !== null);

  const yuvaDenetle = (): void => {
    if (!yuvaTutuyor || yuvaGerekli()) return;
    yuvaTutuyor = false;
    kapi.yuvaBirak(sohbet);
  };

  /** Hazır, tur yok, kuyruk boş, devir/sayfa/başlatma/uyutma yok. */
  const bostaMi = (): boolean => {
    const c = etkin;
    if (kapandi || c === null || !c.hazirlandi || c.tur !== null || c.kirik || c.bitti) return false;
    if (sayfaSuruyor || devir !== null || baslatmaSuruyor || uyutmaIstegi !== null || uyutulan !== null) return false;
    return bekleyenNot === null && !kuyrukDolu();
  };

  const bostaGuncelle = (): void => {
    if (!bostaMi()) bostaMs = null;
    else if (bostaMs === null) bostaMs = saat.simdiMs();
  };

  /** Her durum değişiminin ortak sonu: yuva denetimi, boşta anı, uyutma isteği, `eren_durumu` yayını. */
  const durumYenile = (): void => {
    if (sonlandirildi) return;
    uyutmaIlerle();
    yuvaDenetle();
    bostaGuncelle();
    const yeni = durumHesapla();
    if (yeni === sonDurum) return;
    sonDurum = yeni;
    veriyolu.yayinla("eren_durumu", { sohbet_id, durum: yeni });
  };

  // ---- uyutma (dilim 2) ----

  const uyutmaCoz = (istek: Uyutma): void => {
    for (const coz of istek.cozler.splice(0)) coz();
  };

  /**
   * İstek varken her tur sınırında ve durum değişiminde: süreç boştaysa kapatılır, süreç yoksa istek
   * çözülür; tur, devir, sayfa ya da başlatma sürüyorsa beklenir. Servis kararıdır: resume hatası
   * sayılmaz, `eren_yeniden_basladi` yazılmaz. Süreç yokken de `uyutmaBitti` gibi: yuva bırakılır, iş
   * bekliyorsa (kuyruk ya da kurtarma notu) yeniden yuva istenir, yer yoksa `sirada`.
   */
  function uyutmaIlerle(): void {
    const istek = uyutmaIstegi;
    if (istek === null) return;
    if (!kapandi && (sayfaSuruyor || devir !== null || baslatmaSuruyor)) return;
    const c = etkin;
    if (!kapandi && c !== null) {
      if (c.tur !== null) return;
      uyutmaIstegi = null;
      etkin = null;
      c.bilincli = true;
      hazirIsaretle(c);
      uyutulan = { c, istek };
      guvenli("uyutma_jetonu", () => kopru.jetonlariIptalEt(kapsam(c.nesil)));
      gunluk.bilgi("konusma", "uyutuldu", { sohbet_id, nesil: c.nesil });
      if (c.bitti) uyutmaBitti(c);
      else surecKapat(c);
      durumYenile();
      return;
    }
    // Süreç yok (ör. tur sürerken öldü; `cikisIsle` uyutma istendiği için yeniden başlatmayı kurmadı).
    // Yuva önce bırakılır: sıradaki alır; bu sohbetin işi varsa ardından yeniden istenir.
    uyutmaIstegi = null;
    yuvaDenetle();
    uyutmaCoz(istek);
    if (!kapandi && (bekleyenNot !== null || kuyrukDolu())) guvenli("uyandir", uyandir);
  }

  /** Uyutulan süreç çıktı: mcp dosyası silinince yuva bırakılır, `uyut` çözülür; kuyruk doluysa yeniden yuva istenir. */
  const uyutmaBitti = (c: Calisan): void => {
    const u = uyutulan;
    if (u === null || u.c !== c) return;
    void (mcpSilmeleri.get(c.nesil) ?? Promise.resolve()).then(() => {
      if (uyutulan !== u) return;
      uyutulan = null;
      durumYenile();
      uyutmaCoz(u.istek);
      if (!kapandi && kuyrukDolu()) guvenli("uyandir", uyandir);
    });
  };

  // ---- akış tamponu ----

  const tamponZamaniIptal = (tur: Tur): void => {
    if (tur.tamponZamani === null) return;
    tur.tamponZamani();
    tur.tamponZamani = null;
  };

  const kismiZamaniIptal = (tur: Tur): void => {
    if (tur.kismiZamani === null) return;
    tur.kismiZamani();
    tur.kismiZamani = null;
  };

  const kismiYaz = (tur: Tur): void => {
    kismiZamaniIptal(tur);
    depo.turKismiYaz(tur.turn_id, tur.metin.slice(0, tur.gonderilen));
    tur.sonKismiMs = saat.simdiMs();
  };

  const tamponGonder = (tur: Tur, kip: "bosluk" | "hepsi"): void => {
    let hedef = kip === "hepsi" ? tur.metin.length : sonBoslukSonu(tur.metin, tur.gonderilen);
    if (yarimVekilleBitiyorMu(tur.metin, hedef)) hedef--;
    if (hedef <= tur.gonderilen) return;
    while (tur.gonderilen < hedef) {
      const text = kirp(tur.metin.slice(tur.gonderilen, hedef), SINIRLAR.DELTA_METNI);
      veriyolu.yayinla("tur_delta", { sohbet_id, turn_id: tur.turn_id, offset: tur.gonderilen, text });
      tur.gonderilen += text.length;
    }
    const gecen = saat.simdiMs() - tur.sonKismiMs;
    if (gecen >= KISMI_YAZMA_ARALIGI_MS) {
      kismiYaz(tur);
    } else if (tur.kismiZamani === null) {
      // Son parça aralık içinde geldiyse bu atım olmadan kalıcı olmaz.
      tur.kismiZamani = zamanlayici.sonra(KISMI_YAZMA_ARALIGI_MS - gecen, () => {
        tur.kismiZamani = null;
        guvenli("kismi_yazma", () => kismiYaz(tur));
      });
    }
  };

  const parcaEkle = (tur: Tur, text: string): void => {
    const eklenen = kirp(text, SINIRLAR.ASISTAN_METNI - tur.metin.length);
    if (eklenen === "") return;
    tur.metin += eklenen;
    if (bosluk.test(eklenen)) tamponGonder(tur, "bosluk");
    if (tur.gonderilen >= tur.metin.length) {
      tamponZamaniIptal(tur);
    } else if (tur.tamponZamani === null) {
      tur.tamponZamani = zamanlayici.sonra(sureler.deltaTamponMs, () => {
        tur.tamponZamani = null;
        guvenli("tampon", () => tamponGonder(tur, "hepsi"));
      });
    }
  };

  // ---- süreç ----

  const surecKapat = (c: Calisan): void => {
    if (c.bitti) return; // PID yeniden kullanılmış olabilir
    c.surec.stdinKapat();
    arkaPlan("surec_oldurme", surec.agaciOldur(c.surec.pid));
  };

  /** Stdin gitti ama süreç yaşıyor olabilir: öldür, çıkış olayı olağan kurtarmayı başlatır. */
  const boruKirildi = (c: Calisan): void => {
    if (c.kirik || c.bitti) return;
    c.kirik = true;
    gunluk.uyari("konusma", "stdin_yazilamadi", { sohbet_id, nesil: c.nesil });
    arkaPlan("surec_oldurme", surec.agaciOldur(c.surec.pid));
  };

  // ---- nesil mcp dosyası (dilim 2: `ayar.erenMcpYolu(nesil)`, iki ana oturum aynı dosyayı paylaşmaz) ----

  /**
   * Silme hiç atmaz (günlüğe yazar). Söz, dosya yeniden yazılana dek `mcpSilmeleri`'nde kalır: aynı nesli
   * yeniden yazan onu bekler, ikinci temizlik yeniden silmez.
   */
  const mcpSil = (nesil: number): Promise<void> => {
    const p = (async () => {
      await dosya.dosyaSil(ayar.erenMcpYolu(nesil));
    })().catch((e: unknown) => hataYaz("mcp_silinemedi", e));
    mcpSilmeleri.set(nesil, p);
    return p;
  };

  /** Bu neslin dosyasını kullanan (açılan ya da yaşayan) süreç kalmadıysa siler. */
  const mcpBirak = (nesil: number): void => {
    const kalan = (mcpKullanim.get(nesil) ?? 1) - 1;
    if (kalan > 0) {
      mcpKullanim.set(nesil, kalan);
      return;
    }
    mcpKullanim.delete(nesil);
    void mcpSil(nesil);
  };

  /** Süreç kalmadıysa ve silinmediyse siler; süren silme varsa onu bekler. Kurtarma ve sonlandırma için. */
  const mcpTemizle = (nesil: number): Promise<void> => {
    if (nesil <= 0) return Promise.resolve();
    const suren = mcpSilmeleri.get(nesil);
    if (suren !== undefined && (mcpKullanim.get(nesil) ?? 0) === 0) return suren;
    return mcpSil(nesil);
  };

  const argvKur = (mcpYolu: string, session_id: string, kip: BaslatmaKipi, istem: string): string[] => [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--replay-user-messages",
    // İzin istemi çıkmaz `[karar 2026-11-07]`; sınır istemde ve telefondaki Kotlin kapısındadır. Yerleşik araçlar `ANA_SOHBET_ARACLARI` ile kısıtlıdır.
    "--dangerously-skip-permissions",
    "--tools",
    ANA_SOHBET_ARACLARI,
    "--strict-mcp-config",
    "--mcp-config",
    mcpYolu,
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--system-prompt",
    istem,
    "--model",
    ayar.erenModeli,
    kip === "yeni" ? "--session-id" : "--resume",
    session_id,
  ];

  const hazirIsaretle = (c: Calisan): void => {
    c.hazirlandi = true;
    if (c.hazirZamani === null) return;
    c.hazirZamani();
    c.hazirZamani = null;
  };

  /** Her başlatmada yeni jeton: düz hali saklanmaz. Devamda aynı nesilin eski jetonu sahipsiz kalır, iptal edilir. */
  const sureciBaslat = async (nesil: number, session_id: string, kip: BaslatmaKipi): Promise<Calisan> => {
    // Süreçten ÖNCE kalıcı kayıt: nesil kaydına hiç girmese de (başarısız aday, kayıttan önce ölen servis)
    // transkripti geçmişi silmede bulunur. Yazılamazsa süreç açılmaz.
    if (kip === "yeni") depo.oturumKaydet(session_id, saat.simdiMs(), sohbet);
    if (kip === "devam") kopru.jetonlariIptalEt(kapsam(nesil));
    const jeton = kopru.jetonUret(kapsam(nesil));
    // Her başlatmada (resume dahil) neslin kendi dosyası yazılır; başlatma başarısızsa silinir.
    mcpKullanim.set(nesil, (mcpKullanim.get(nesil) ?? 0) + 1);
    let s: BoruluSurec;
    try {
      const mcpYolu = ayar.erenMcpYolu(nesil);
      const suren = mcpSilmeleri.get(nesil);
      if (suren !== undefined) {
        await suren;
        if (mcpSilmeleri.get(nesil) === suren) mcpSilmeleri.delete(nesil);
      }
      await dosya.atomikYaz(mcpYolu, erenMcpMetni(ayar.nodeExe, ayar.kopruBetigi, jeton, computerUse));
      const istem = sistemIstemi(await ayar.kimlikEki(), masaustu, tamYetki, ayar.asistanAdi);
      s = await surec.boruluBaslat({
        exe: ayar.claudeExe,
        argv: argvKur(mcpYolu, session_id, kip, istem),
        cwd: ayar.yollar.erenCwd,
        ortam: ayar.erenOrtami(),
      });
    } catch (e) {
      mcpBirak(nesil);
      throw e;
    }
    const c: Calisan = {
      surec: s,
      nesil,
      session_id,
      kip,
      baslangicMs: saat.simdiMs(),
      tur: null,
      model: null,
      kullanim: null,
      dolu: null,
      pencere: null,
      initGoruldu: false,
      ilkSonuc: false,
      hazirlandi: false,
      hazirZamani: null,
      bilincli: false,
      bitti: false,
      kirik: false,
      oldurme: null,
      stderrBirim: 0,
    };
    canlilar.add(c);
    s.stdoutSatirDinle((satir) => guvenli("satir_isleme", () => satirIsle(c, satir)));
    // İçerik okunmaz, güvenilmez metin olabilir; yalnız miktar günlüğe gider.
    s.stderrDinle((parca) => {
      c.stderrBirim += parca.length;
    });
    c.hazirZamani = zamanlayici.sonra(HAZIR_PAYI_MS, () => {
      c.hazirZamani = null;
      c.hazirlandi = true;
      durumYenile();
    });
    s.cikisDinle(() => guvenli("cikis_isleme", () => cikisIsle(c)));
    gunluk.bilgi("konusma", "surec_basladi", { sohbet_id, nesil, pid: s.pid, kip });
    return c;
  };

  // ---- tur ----

  /** Satır önce yazılır: kırık boruda kuyruk yerinde kalır, açılınca aynı sırayla akar. */
  const turuYaz = (
    c: Calisan,
    satir: string,
    g: { kaynak: TurKaynagi; gorunur: boolean; rol: TurRolu; idler: readonly number[] },
  ): boolean => {
    if (!c.surec.satirYaz(satir)) return false;
    const turn_id = rastgele.opakId("tur");
    const simdi = saat.simdiMs();
    depo.islem(() => {
      depo.turEkle({
        turn_id,
        sohbet_id,
        nesil: c.nesil,
        kaynak: g.kaynak,
        gorunur: g.gorunur,
        baslangic_ms: simdi,
        bitis_ms: null,
        bitis: null,
        kismi_metin: "",
      });
      if (g.idler.length > 0) depo.kuyruktanSil(g.idler);
    });
    c.tur = {
      turn_id,
      kaynak: g.kaynak,
      gorunur: g.gorunur,
      rol: g.rol,
      metin: "",
      gonderilen: 0,
      sonKismiMs: Number.NEGATIVE_INFINITY,
      tamponZamani: null,
      kismiZamani: null,
    };
    if (g.gorunur) veriyolu.yayinla("tur_basladi", { sohbet_id, turn_id });
    durumYenile();
    return true;
  };

  const pompala = (): void => {
    // Uyutma istendi: sıradaki kuyruk satırı açılmaz, süreç boştaysa kapanır.
    if (uyutmaIstegi !== null) {
      uyutmaIlerle();
      return;
    }
    const c = etkin;
    if (kapandi || sayfaSuruyor || devir !== null || baslatmaSuruyor || c === null || c.tur !== null || c.kirik) return;
    let yazildi: boolean;
    if (bekleyenNot !== null) {
      yazildi = turuYaz(c, sentetikSatirKur(bekleyenNot), { kaynak: "sentetik", gorunur: true, rol: "normal", idler: [] });
      if (yazildi) bekleyenNot = null;
    } else {
      const sentetikler = depo.kuyrukSentetikBasi(SENTETIK_BIRLESME, sohbet);
      if (sentetikler.length > 0) {
        yazildi = turuYaz(c, sentetikSatirKur(sentetikler.map((s) => s.metin).join("\n")), {
          kaynak: "sentetik",
          gorunur: true,
          rol: "normal",
          idler: sentetikler.map((s) => s.id),
        });
      } else {
        const bas = depo.kuyrukBasi(sohbet);
        if (bas === null) return;
        // Kaynak kuyruk satırından gelir; `insanSatiriKur` insan dışı satırda atar, tur açılmaz.
        yazildi = turuYaz(c, insanSatiriKur(bas), { kaynak: bas.kaynak, gorunur: true, rol: "normal", idler: [bas.id] });
      }
    }
    if (!yazildi) boruKirildi(c);
  };

  /** Kuyruğa satır gelmesi de açılış denemesidir: süreç yoksa yuva istenir. */
  const sentetikEkle = (metin: string): void => {
    depo.kuyrugaEkle("sentetik", metin, saat.simdiMs(), sohbet);
    pompala();
    if (etkin === null) guvenli("uyandir", uyandir);
  };

  /** Sonucu `result`'tan gelmeyen tur: kayıt kapanır, görünürse telefona bildirilir. */
  const turuKapat = (c: Calisan, bitis: TurBitisi, neden: "surec_oldu" | "limit_kilit" | "hata" | null): void => {
    const tur = c.tur;
    if (tur === null) return;
    tamponZamaniIptal(tur);
    if (tur.gorunur) tamponGonder(tur, "hepsi");
    kismiZamaniIptal(tur);
    c.tur = null;
    const ms = saat.simdiMs();
    depo.islem(() => {
      if (tur.gorunur && neden !== null) {
        depo.olayEkle({ type: "turn_aborted", sohbet_id, turn_id: tur.turn_id, neden, kismi_metin: tur.metin });
      }
      depo.turBitir(tur.turn_id, bitis, tur.metin, ms);
      if (!sonlandirildi) depo.sohbetEtkinlikYaz(sohbet, ms);
    });
    if (tur.gorunur && !sonlandirildi) veriyolu.yayinla("tur_bitti", { sohbet_id, turn_id: tur.turn_id });
  };

  const normalTurBitir = (c: Calisan, tur: Tur, sinif: TurSonucuSinifi, sonucMetni: string): void => {
    tamponZamaniIptal(tur);
    tamponGonder(tur, "hepsi");
    kismiZamaniIptal(tur);
    c.tur = null;
    const ms = saat.simdiMs();
    depo.islem(() => {
      if (sinif === "tamam") {
        const text = kirp(sonucMetni !== "" ? sonucMetni : tur.metin, SINIRLAR.ASISTAN_METNI);
        if (text !== "") depo.olayEkle({ type: "assistant_message", sohbet_id, turn_id: tur.turn_id, text });
      } else {
        depo.olayEkle({
          type: "turn_aborted",
          sohbet_id,
          turn_id: tur.turn_id,
          neden: sinif === "kesildi" ? "kullanici_kesti" : "hata",
          kismi_metin: tur.metin,
        });
      }
      depo.turBitir(tur.turn_id, BITISLER[sinif], tur.metin, ms);
      depo.sohbetEtkinlikYaz(sohbet, ms);
    });
    veriyolu.yayinla("tur_bitti", { sohbet_id, turn_id: tur.turn_id });
  };

  // ---- devir ----

  const devirZamaniIptal = (d: Devir): void => {
    if (d.zaman === null) return;
    d.zaman();
    d.zaman = null;
  };

  /** Bekleyen işi bırakır, adayı öldürür. Eski sürece ve kuyruğa dokunmaz. */
  const devirIptal = (d: Devir, bitis: TurBitisi): void => {
    devirZamaniIptal(d);
    devir = null;
    const aday = d.aday;
    if (aday !== null) {
      aday.bilincli = true;
      turuKapat(aday, bitis, null);
      surecKapat(aday);
    }
    if (d.nesil !== null) kopru.jetonlariIptalEt(kapsam(d.nesil));
  };

  const yenidenIptal = (): void => {
    if (yenidenZamani === null) return;
    yenidenZamani();
    yenidenZamani = null;
  };

  /** Çökme ya da başarısız açılış sonrası bekleme; dolunca açılış yeniden denenir (yuva yeniden istenir). */
  const yenidenPlanla = (): void => {
    if (kapandi || reddedildi || yenidenZamani !== null) return;
    yenidenZamani = zamanlayici.sonra(sureler.erenYenidenBaslatmaMs, () => {
      yenidenZamani = null;
      guvenli("yeniden_baslatma", acmayiDene);
      guvenli("durum", durumYenile);
    });
  };

  const yenidenBildirimiYaz = (): void => {
    if (!yenidenBildir) return;
    yenidenBildir = false;
    depo.olayEkle({
      type: "system_notice",
      sohbet_id,
      seviye: "uyari",
      kod: "eren_yeniden_basladi",
      metin: yenidenBasladiMetni(ayar.asistanAdi),
    });
  };

  /** Başarısız: yeni öldürülür, eski sürer, sonraki tur sınırında yeniden denenir. Eski yoksa beklenip denenir. */
  const adayBasarisiz = (d: Devir): void => {
    if (devir !== d) return;
    devirIptal(d, "hata");
    const eski = d.eski;
    if (eski === null) {
      yenidenPlanla();
      durumYenile();
      return;
    }
    // Zaman aşımından kalan özet turu kuyruğu sonsuza dek tutmasın.
    if (eski.tur !== null && !eski.surec.satirYaz(kesmeSatiriKur(rastgele.opakId("kes")))) boruKirildi(eski);
    pompala();
    durumYenile();
  };

  const devirBasarili = (d: Devir, aday: Calisan, tur: Tur): void => {
    devirZamaniIptal(d);
    const ms = saat.simdiMs();
    const ozet_kabul = d.ozet !== null;
    const eski = d.eski;
    if (eski !== null) {
      // Zaman aşımından sonra eski tur hâlâ açık olabilir.
      turuKapat(eski, "hata", null);
      eski.bilincli = true;
      emekliler.add(eski);
      eski.surec.stdinKapat();
      eski.oldurme = zamanlayici.sonra(ESKI_OLDURME_MS, () => {
        eski.oldurme = null;
        if (!eski.bitti) arkaPlan("surec_oldurme", surec.agaciOldur(eski.surec.pid));
      });
    }
    // Eski neslin numarası ayrı tutulur: araya başka sohbetin nesli girmiş olabilir (`nesil - 1` değil).
    kopru.jetonlariIptalEt(kapsam(d.eskiNesil));
    aday.tur = null;
    devir = null;
    etkin = aday;
    nesilNo = aday.nesil;
    resumeHatasi = 0;
    ardisikHata = 0;
    depo.islem(() => {
      depo.nesilEkle({
        nesil: aday.nesil,
        sohbet_id,
        session_id: aday.session_id,
        baslangic_ms: aday.baslangicMs,
        bitis_ms: null,
        ozet_kabul,
        pid: aday.surec.pid,
        olusturma_ms: aday.surec.olusturmaMs,
        son_dolu: aday.dolu,
        pencere: aday.pencere,
      });
      depo.nesilGuncelle(d.eskiNesil, { bitis_ms: ms });
      depo.turBitir(tur.turn_id, "tamam", "", ms);
      depo.olayEkle({ type: "eren_handover", sohbet_id, nesil: aday.nesil, ozet_kabul });
    });
    yenidenBildirimiYaz();
    gunluk.bilgi("konusma", "devir_bitti", { sohbet_id, nesil: aday.nesil, eski_nesil: d.eskiNesil, ozet_kabul });
    pompala();
    durumYenile();
  };

  /**
   * Son mezar taşından sonra başlamamış ve bitmemiş iş silinmiş sohbete aittir: başlığı nota girmez.
   * Mezar taşı okunamazsa hiçbir iş girmez.
   */
  const mezarSonrasiMi = (): ((i: IsKaydi) => boolean) => {
    let sinir: number;
    try {
      sinir = depo.sonMezarTasi(sohbet)?.ts_ms ?? Number.NEGATIVE_INFINITY;
    } catch (e) {
      hataYaz("mezar_tasi_okunamadi", e);
      return () => false;
    }
    return (i) => i.baslangic_ms > sinir || (i.bitis_ms !== null && i.bitis_ms > sinir);
  };

  /**
   * Soru metni, rapor gövdesi, plan metni bu çağrıda hiç okunmaz: yalnız kimlik, başlık, durum. Dilim 2:
   * yalnız bu sohbetin işleri, planları, soruları ve son konuşması.
   */
  const devirNotu = (ozet: string | null): string => {
    const isler = new Map<IsNo, DevirIsi>();
    const notaGirer = mezarSonrasiMi();
    for (const i of [...depo.isListele(true, AKTIF_IS_ADEDI, sohbet), ...depo.isListele(false, SON_IS_ADEDI, sohbet)]) {
      if (notaGirer(i)) isler.set(i.is_id, { is_id: i.is_id, baslik: i.baslik, durum: i.durum });
    }
    return devirMetni({
      asistanAdi: ayar.asistanAdi,
      citliOzet: ozet === null ? null : citleSar(rastgele.hex64(), ozet),
      isler: [...isler.values()],
      planlar: depo
        .bekleyenPlanlar(sohbet)
        .map((p) => ({ plan_id: p.plan.plan_id, baslik: p.plan.baslik, durum: p.durum })),
      sorular: depo.bekleyenSorular(sohbet).map((s) => ({ soru_id: s.soru_id, is_id: s.is_id, durum: s.durum })),
      // Kısayol satırı ana oturuma ilk gittiği önekle (aynı kurucu) görünür; yeni nesil hangi uygulamadan
      // söz edildiğini kaybetmez. Kısayol olmayan satır aynen.
      konusma: depo.sonKonusma(KONUSMA_ADEDI, sohbet).map(({ kisayol, ...k }) =>
        kisayol === undefined ? k : { ...k, metin: erenMetniKur({ input: "kisayol", text: k.metin, baglam: kisayol.baglam }) },
      ),
    });
  };

  const adayAsamasi = (d: Devir): Promise<void> => izle(adayAsamasiYap(d));

  const adayAsamasiYap = async (d: Devir): Promise<void> => {
    devirZamaniIptal(d);
    d.asama = "aday";
    if (!kilit.baslatmaSerbestMi()) {
      devirIptal(d, "limit_kilit");
      pompala();
      durumYenile();
      return;
    }
    // Yeni nesil tam şimdi, eşzamanlı: başka sohbetin eşzamanlı devriyle aynı numara çıkmaz.
    const nesil = nesilAyir();
    d.nesil = nesil;
    let c: Calisan;
    try {
      c = await sureciBaslat(nesil, rastgele.uuid(), "yeni");
    } catch (e) {
      hataYaz("devir_baslatilamadi", e);
      adayBasarisiz(d);
      return;
    }
    if (devir !== d) {
      // Beklerken kilit ya da kapanış devri iptal etti.
      c.bilincli = true;
      surecKapat(c);
      kopru.jetonlariIptalEt(kapsam(nesil));
      return;
    }
    d.aday = c;
    if (c.bitti) {
      adayBasarisiz(d);
      return;
    }
    const satir = sentetikSatirKur(devirNotu(d.ozet));
    if (!turuYaz(c, satir, { kaynak: "devir", gorunur: false, rol: "devir_ilk", idler: [] })) {
      adayBasarisiz(d);
      return;
    }
    d.zaman = zamanlayici.sonra(sureler.devirOzetiBeklemeMs, () => {
      d.zaman = null;
      guvenli("devir_zaman_asimi", () => adayBasarisiz(d));
    });
  };

  const devirBaslat = (eski: Calisan): void => {
    const d: Devir = { nesil: null, eskiNesil: eski.nesil, eski, asama: "ozet", ozet: null, zaman: null, aday: null };
    devir = d;
    if (!turuYaz(eski, sentetikSatirKur(DEVIR_ISTEGI), { kaynak: "devir", gorunur: false, rol: "devir_istek", idler: [] })) {
      devir = null;
      boruKirildi(eski);
      return;
    }
    d.zaman = zamanlayici.sonra(sureler.devirOzetiBeklemeMs, () => {
      d.zaman = null;
      if (devir === d && d.asama === "ozet") arkaPlan("devir_aday", adayAsamasi(d));
    });
    gunluk.bilgi("konusma", "devir_basladi", { sohbet_id, eski_nesil: d.eskiNesil });
  };

  /**
   * Tur sınırı: devir gerekiyorsa o başlar, gerekmiyorsa kuyruk akar. Uyutma istendiyse devir başlamaz.
   * Devir canlı sınırından muaftır ama RAM kapısından geçer (`devirSerbestMi`); geçmezse sonraki tur
   * sınırında yeniden denenir.
   */
  const turSiniri = (c: Calisan): void => {
    if (c === etkin && devir === null && uyutmaIstegi === null && !reddedildi && kilitSerbest()) {
      const hataDevri = ardisikHata >= ARDISIK_HATA_SINIRI;
      const doluDevri =
        c.dolu !== null && c.dolu >= (c.pencere === null ? VARSAYILAN_ESIK : akis.devirEsigi(c.pencere));
      if ((hataDevri || doluDevri) && kapi.devirSerbestMi()) {
        if (hataDevri) {
          // Red sonrası oturumun kullanılabilirliği ölçülmedi: özet istenmez.
          const d: Devir = { nesil: null, eskiNesil: c.nesil, eski: c, asama: "aday", ozet: null, zaman: null, aday: null };
          devir = d;
          arkaPlan("devir_aday", adayAsamasi(d));
          return;
        }
        devirBaslat(c);
        return;
      }
    }
    pompala();
  };

  // ---- akış olayları ----

  const initDenetle = (c: Calisan, olay: Extract<AkisOlayi, { tur: "init" }>): void => {
    const kaynakUygun = olay.apiKeySource === "none";
    if (kaynakUygun) return;
    reddedildi = true;
    gunluk.hata("konusma", "init_reddi", { sohbet_id, nesil: c.nesil, anahtar_kaynagi_uygun: kaynakUygun });
    depo.olayEkle({ type: "system_notice", sohbet_id, seviye: "kritik", kod: "diger", metin: initReddiMetni(ayar.asistanAdi) });
    const d = devir;
    if (d !== null && d.aday === c) {
      // Eski süreç eski sürümle yaşıyor olabilir, sürer; yalnız yeniden devir denenmez.
      adayBasarisiz(d);
      return;
    }
    if (d !== null && d.eski === c) devirIptal(d, "hata");
    c.bilincli = true;
    if (etkin === c) etkin = null;
    turuKapat(c, "hata", "hata");
    surecKapat(c);
    durumYenile();
  };

  const sonucIsle = (c: Calisan, olay: Extract<AkisOlayi, { tur: "result" }>): void => {
    if (!c.initGoruldu) gunluk.uyari("konusma", "init_gorulmedi", { sohbet_id, nesil: c.nesil });
    // Tüketim her `result` için bir kez (boru ofsetsiz), tursuz ve devir sonuçları dahil; yardımcı kayıt, hatası turu bozmaz.
    guvenli("tuketim_yazilamadi", () =>
      depo.tuketimEkle(
        tuketimKayitlari(olay, {
          ts_ms: saat.simdiMs(),
          kaynak: "sohbet",
          sohbet_id,
          is_id: null,
          turn_id: c.tur?.turn_id ?? null,
          nesil: c.nesil,
          rol: c.tur?.rol ?? null,
          model: c.model,
        }),
      ),
    );
    // Yalnız init'i görülmüş, hatasız sonuç oturumun sağlam açıldığını kanıtlar; hata sonucu çıkışta resume hatası sayılır.
    const saglam = c.initGoruldu && !olay.is_error;
    if (saglam) c.ilkSonuc = true;
    hazirIsaretle(c);
    // Yalnız resume'un kendi sonucu resume'u kanıtlar; aday sonucu sayacı silerse bozuk oturuma dönülür.
    if (c.kip === "devam" && saglam) resumeHatasi = 0;
    c.pencere = akis.pencereSec(olay.pencereler, c.model) ?? c.pencere;
    if (c.kullanim !== null) c.dolu = akis.dolulukHesapla(c.kullanim);
    if (c === etkin && c.dolu !== null) depo.nesilGuncelle(c.nesil, { son_dolu: c.dolu, pencere: c.pencere });
    const tur = c.tur;
    if (tur === null) {
      pompala();
      return;
    }
    const sinif = akis.turSonucuSinifla(olay);
    if (tur.rol === "normal") {
      ardisikHata = sinif === "hata" ? ardisikHata + 1 : 0;
      normalTurBitir(c, tur, sinif, olay.metin);
      turSiniri(c);
      durumYenile();
      return;
    }
    if (tur.rol === "devir_ilk") {
      const d = devir;
      if (d === null || d.aday !== c) return;
      if (olay.is_error) adayBasarisiz(d);
      else devirBasarili(d, c, tur);
      return;
    }
    c.tur = null;
    depo.turBitir(tur.turn_id, BITISLER[sinif], "", saat.simdiMs());
    const d = devir;
    if (d !== null && d.eski === c && d.asama === "ozet") {
      if (sinif !== "tamam") d.ozet = null;
      arkaPlan("devir_aday", adayAsamasi(d));
      return;
    }
    pompala();
    durumYenile();
  };

  const satirIsle = (c: Calisan, satir: string): void => {
    if (c.bilincli || c.bitti || kapandi) return;
    const olay = akis.satirCoz(satir);
    if (olay === null) return;
    switch (olay.tur) {
      case "init":
        c.initGoruldu = true;
        if (olay.model !== null) c.model = olay.model;
        initDenetle(c, olay);
        if (!c.bilincli) {
          hazirIsaretle(c);
          durumYenile();
        }
        return;
      case "assistant":
        if (olay.model !== null) c.model = olay.model;
        // Aynı `message_id` tekrarında da sonuncu geçerli: toplanmaz.
        if (olay.kullanim !== null) c.kullanim = olay.kullanim;
        return;
      case "metin_parcasi":
        if (c.tur !== null && c.tur.gorunur) parcaEkle(c.tur, olay.text);
        return;
      case "rate_limit":
        veriyolu.yayinla("limit_dolulugu", {
          doluluk: { besSaat: olay.besSaat, yediGun: olay.yediGun, olcumMs: saat.simdiMs() },
        });
        return;
      case "result":
        sonucIsle(c, olay);
        return;
      default:
        // `--replay-user-messages` yankısı dahil geri kalanı yok sayılır.
        return;
    }
  };

  const cikisIsle = (c: Calisan): void => {
    if (c.bitti) return;
    c.bitti = true;
    hazirIsaretle(c);
    if (c.oldurme !== null) {
      c.oldurme();
      c.oldurme = null;
    }
    emekliler.delete(c);
    canlilar.delete(c);
    // O sürecin çıkışı görüldü: neslin dosyasını kullanan kalmadıysa silinir.
    mcpBirak(c.nesil);
    gunluk.bilgi("konusma", "surec_cikti", {
      sohbet_id,
      nesil: c.nesil,
      pid: c.surec.pid,
      stderr_birim: c.stderrBirim,
    });
    if (uyutulan !== null && uyutulan.c === c) {
      uyutmaBitti(c);
      return;
    }
    if (c.bilincli || kapandi) return;
    const d = devir;
    if (d !== null && d.aday === c) {
      adayBasarisiz(d);
      return;
    }
    if (d !== null && d.eski === c) {
      if (d.asama === "aday") {
        // Aday sürüyor: kapatılacak eski kalmadı, başarısız olursa yeniden denenir.
        d.eski = null;
        etkin = null;
        turuKapat(c, "surec_oldu", null);
        durumYenile();
        return;
      }
      devirIptal(d, "surec_oldu");
    }
    if (c !== etkin) return;
    etkin = null;
    const tur = c.tur;
    if (tur !== null && tur.gorunur) bekleyenNot = kurtarmaNotu(tur.metin);
    // Uzun boşta kalıp ölen süreç sağlam açılmıştı, resume hatası sayılmaz.
    if (
      c.kip === "devam" &&
      !c.ilkSonuc &&
      (tur !== null || saat.simdiMs() - c.baslangicMs < sureler.erenYenidenBaslatmaMs)
    ) {
      resumeHatasi++;
    }
    turuKapat(c, "surec_oldu", "surec_oldu");
    yenidenBildir = true;
    // Uyutma bekliyordu: süreç zaten gitti, yeniden başlatma beklemesi kurulmaz. İstek `durumYenile`'de
    // (`uyutmaIlerle`) çözülür; kuyruk ya da kurtarma notu bekliyorsa orada yeniden yuva istenir.
    if (uyutmaIstegi === null) yenidenPlanla();
    durumYenile();
  };

  // ---- başlatma ----

  const acilisYap = async (son: NesilKaydi | null): Promise<void> => {
    const kip: BaslatmaKipi = son === null ? "yeni" : "devam";
    // Hiç nesil yoksa yeni numara tam şimdi (eşzamanlı) ayrılır; resume kendi neslini açar.
    const nesil = son === null ? nesilAyir() : son.nesil;
    const session_id = son === null ? rastgele.uuid() : son.session_id;
    const sayfa = sayfaNo;
    let c: Calisan;
    try {
      c = await sureciBaslat(nesil, session_id, kip);
    } catch (e) {
      hataYaz("baslatilamadi", e);
      if (sayfa !== sayfaNo) return;
      if (kip === "devam") resumeHatasi++;
      yenidenPlanla();
      return;
    }
    // Beklerken yeni sayfa açıldı: bu süreç silinmiş geçmişin oturumudur, yaşamaz.
    if (kapandi || sayfa !== sayfaNo || !kilit.baslatmaSerbestMi()) {
      c.bilincli = true;
      surecKapat(c);
      return;
    }
    if (c.bitti) {
      if (kip === "devam") resumeHatasi++;
      yenidenPlanla();
      return;
    }
    if (son === null) {
      depo.nesilEkle({
        nesil,
        sohbet_id,
        session_id,
        baslangic_ms: c.baslangicMs,
        bitis_ms: null,
        ozet_kabul: null,
        pid: c.surec.pid,
        olusturma_ms: c.surec.olusturmaMs,
        son_dolu: null,
        pencere: null,
      });
    } else {
      depo.nesilGuncelle(nesil, { pid: c.surec.pid, olusturma_ms: c.surec.olusturmaMs });
    }
    nesilNo = nesil;
    etkin = c;
    yenidenBildirimiYaz();
  };

  /**
   * Yeni sayfa: yeni `uuid`, `nesil+1`, yeni jeton, `--session-id`; ilk satır yok (devir özeti, durum
   * notu, son konuşma, kurtarma notu, yarım metin YOK). Açılamazsa olağan yeniden deneme yine buraya gelir:
   * `sayfaBekliyor` yeni nesil açılana kadar iner, eski oturuma hiçbir yoldan dönülmez.
   */
  const sayfaAc = async (son: NesilKaydi | null): Promise<void> => {
    const nesil = nesilAyir();
    const session_id = rastgele.uuid();
    let c: Calisan;
    try {
      c = await sureciBaslat(nesil, session_id, "yeni");
    } catch (e) {
      hataYaz("yeni_oturum_baslatilamadi", e);
      kopru.jetonlariIptalEt(kapsam(nesil));
      yenidenPlanla();
      return;
    }
    if (kapandi || !kilit.baslatmaSerbestMi()) {
      c.bilincli = true;
      surecKapat(c);
      kopru.jetonlariIptalEt(kapsam(nesil));
      return;
    }
    if (c.bitti) {
      kopru.jetonlariIptalEt(kapsam(nesil));
      yenidenPlanla();
      return;
    }
    const ms = saat.simdiMs();
    depo.islem(() => {
      depo.nesilEkle({
        nesil,
        sohbet_id,
        session_id,
        baslangic_ms: c.baslangicMs,
        bitis_ms: null,
        ozet_kabul: null,
        pid: c.surec.pid,
        olusturma_ms: c.surec.olusturmaMs,
        son_dolu: null,
        pencere: null,
      });
      if (son !== null) depo.nesilGuncelle(son.nesil, { bitis_ms: ms });
    });
    sayfaBekliyor = false;
    bekleyenNot = null;
    yenidenBildir = false;
    resumeHatasi = 0;
    ardisikHata = 0;
    nesilNo = nesil;
    etkin = c;
    gunluk.bilgi("konusma", "yeni_oturum_acildi", { sohbet_id, nesil });
  };

  /**
   * Son mezar taşı son neslin başlangıcından yeniyse o nesil silinmiş geçmişi bilir: `--resume` yapılmaz.
   * Okunamazsa da yapılmaz: silinmiş geçmişi bilen bir ana oturuma dönmektense bağlamsız yeni oturum.
   */
  const mezarTasiYeni = (son: NesilKaydi | null): boolean => {
    if (son === null) return false;
    try {
      const mezar = depo.sonMezarTasi(sohbet);
      return mezar !== null && mezar.ts_ms > son.baslangic_ms;
    } catch (e) {
      hataYaz("mezar_tasi_okunamadi", e);
      return true;
    }
  };

  /**
   * Her `--resume` kararı buradan geçer: açılış, uyandırma, kilit açılışı, süreç ölünce yeniden başlatma.
   * Çağıran yuvayı almıştır (`acmayiDene`) ya da tutuyordur (yeni sayfa). İlk `await`'ten önce
   * `baslatmaSuruyor` olur: durum `baslatiliyor`, ikinci açılış başlamaz.
   */
  const baslatmaYap = async (): Promise<void> => {
    if (!baslatildi || kapandi || reddedildi || baslatmaSuruyor || etkin !== null || devir !== null) return;
    if (!kilitSerbest()) {
      // Açılmak isteyen (yuvayı almış) örnek kilit açılınca açılır.
      kilittenOnceCanli = true;
      return;
    }
    yenidenIptal();
    baslatmaSuruyor = true;
    durumYenile();
    try {
      const son = depo.sonNesil(sohbet);
      if (sayfaBekliyor || mezarTasiYeni(son)) {
        if (!sayfaBekliyor) gunluk.bilgi("konusma", "mezar_tasi_yeni_oturum", { sohbet_id, nesil: son?.nesil ?? 0 });
        sayfaBekliyor = true;
        // Açık tur `turn_aborted{surec_oldu}` ile kapanmıştır; yarım metni yeni oturuma gitmez.
        bekleyenNot = null;
        await sayfaAc(son);
      } else if (son !== null && resumeHatasi >= RESUME_DENEME) {
        const d: Devir = { nesil: null, eskiNesil: son.nesil, eski: null, asama: "aday", ozet: null, zaman: null, aday: null };
        devir = d;
        await adayAsamasi(d);
      } else {
        await acilisYap(son);
      }
    } catch (e) {
      // Depo okunamadı ya da kayıt yazılamadı: süreç yok, bekleyip yeniden denenir (yuva bırakılır).
      hataYaz("baslatma", e);
      yenidenPlanla();
    } finally {
      baslatmaSuruyor = false;
    }
    guvenli("pompa", pompala);
    durumYenile();
  };

  /**
   * Açılış denemesi (dilim 2): koşullar tutuyorsa `kapi.yuvaIste` EŞZAMANLI sorulur; `true` ise açılış arkada
   * başlar (bu çağrı dönerken durum `baslatiliyor`), `false` ise `sirada`. Koşullar tutmuyorsa yuva sorulmaz.
   * Çökme sonrası bekleme sürerken zamanlayıcı açar.
   */
  const acmayiDene = (): void => {
    if (!baslatildi || kapandi || reddedildi) return;
    if (etkin !== null || devir !== null || baslatmaSuruyor || sayfaSuruyor || uyutulan !== null) return;
    if (yenidenZamani !== null || kurtarmaZamani !== null) return;
    if (!kilitSerbest()) {
      // Açılış istendi ama kilit kapalı: kilit açılınca bu örnek açılır (yuva o an istenir).
      kilittenOnceCanli = true;
      durumYenile();
      return;
    }
    if (!kapi.yuvaIste(sohbet)) {
      if (!sirada) gunluk.bilgi("konusma", "yuva_bekleniyor", { sohbet_id });
      sirada = true;
      durumYenile();
      return;
    }
    yuvaTutuyor = true;
    sirada = false;
    arkaPlan("baslatma", izle(baslatmaYap()));
    // Açılış başlamadıysa (kilit arada değişti) tutulan yuva burada bırakılır.
    durumYenile();
  };

  /** `Konusma.uyandir`. `baslat` bitmeden çağrılırsa kurtarma bitince bir kez denenir. Hiç atmaz. */
  function uyandir(): void {
    if (kapandi) return;
    if (!baslatildi) {
      uyandirBekliyor = true;
      return;
    }
    acmayiDene();
  }

  /**
   * Kayıtlı sürecin ölü olduğu kesinleşmeden `false`. Canlılık bilinemiyorsa öldürmeyi denemeyiz: kimlik
   * doğrulanmadan PID'e saldırmak yeniden kullanılmış bir PID'i vurabilir. Bu yüzden bekleyip yeniden denenir.
   */
  const eskiSurecTemiz = async (): Promise<boolean> => {
    const son = depo.sonNesil(sohbet);
    if (son === null || son.pid === null || son.olusturma_ms === null) return true;
    try {
      if (await surec.surecVarMi({ pid: son.pid, olusturmaMs: son.olusturma_ms })) {
        await surec.agaciOldur(son.pid);
      }
      return true;
    } catch (e) {
      hataYaz("kurtarma_surec_belirsiz", e);
      return false;
    }
  };

  const kurtarmaYap = async (): Promise<void> => {
    const ms = saat.simdiMs();
    for (const t of depo.acikTurlar(sohbet)) {
      depo.islem(() => {
        if (t.gorunur) {
          depo.olayEkle({
            type: "turn_aborted",
            sohbet_id,
            turn_id: t.turn_id,
            neden: "surec_oldu",
            kismi_metin: t.kismi_metin,
          });
        }
        depo.turBitir(t.turn_id, "surec_oldu", t.kismi_metin, ms);
      });
      if (t.gorunur) bekleyenNot = kurtarmaNotu(t.kismi_metin);
    }
  };

  /**
   * Kurtarma (dilim 1 akışı, bu sohbetin satırları): sahipsiz eski süreç, açık turlar, son neslin mcp
   * dosyası. Süreç AÇMAZ (dilim 2): sonunda kuyruk doluysa ya da `uyandir` beklediyse açılış denenir
   * (yuva istenir), değilse durum `uyuyor`.
   */
  const acilisDene = async (): Promise<void> => {
    if (kapandi) return;
    if (!(await eskiSurecTemiz())) {
      if (kapandi) return;
      kurtarmaZamani = zamanlayici.sonra(sureler.erenYenidenBaslatmaMs, () => {
        kurtarmaZamani = null;
        arkaPlan("kurtarma_yeniden", acilisDene());
      });
      durumYenile();
      return;
    }
    await kurtarmaYap();
    if (kapandi) return;
    const son = depo.sonNesil(sohbet);
    if (son !== null) await mcpTemizle(son.nesil);
    if (kapandi) return;
    baslatildi = true;
    const bekliyordu = uyandirBekliyor;
    uyandirBekliyor = false;
    if (bekliyordu || kuyrukDolu()) acmayiDene();
    durumYenile();
  };

  const kilitAktif = (): void => {
    kilittenOnceCanli =
      kilittenOnceCanli ||
      etkin !== null ||
      devir !== null ||
      baslatmaSuruyor ||
      sayfaSuruyor ||
      yenidenZamani !== null ||
      sirada;
    yenidenIptal();
    const d = devir;
    if (d !== null) devirIptal(d, "limit_kilit");
    const c = etkin;
    if (c !== null) {
      etkin = null;
      c.bilincli = true;
      turuKapat(c, "limit_kilit", "limit_kilit");
      surecKapat(c);
    }
    durumYenile();
  };

  /** Kilit açıldı: kilitten önce süreci olan (ya da sıradaki) ya da kuyruğu dolu örnek açılır. */
  const kilitSerbestKaldi = (): void => {
    const ac = kilittenOnceCanli || sirada || kuyrukDolu();
    kilittenOnceCanli = false;
    if (ac) acmayiDene();
    durumYenile();
  };

  // ---- yeni sayfa (Dilim 1, "Geçmişi sil" 5) ----

  const erenJetonlariniIptalEt = (nesiller: Iterable<number>): void => {
    for (const nesil of new Set(nesiller)) {
      if (nesil > 0) kopru.jetonlariIptalEt(kapsam(nesil));
    }
  };

  /** Satırları okunmaz, çıkışı kurtarma başlatmaz, açık turu kapanır, stdin kapanır. Öldürme sonra. */
  const emekliyeAyir = (c: Calisan, neden: "surec_oldu" | null): void => {
    c.bilincli = true;
    hazirIsaretle(c);
    if (c.oldurme !== null) {
      c.oldurme();
      c.oldurme = null;
    }
    turuKapat(c, neden === null ? "hata" : "surec_oldu", neden);
    if (!c.bitti) c.surec.stdinKapat();
  };

  /** Hepsi çıkınca ya da `ms` dolunca, hangisi önce. */
  const cikislariBekle = (cs: readonly Calisan[], ms: number): Promise<void> =>
    new Promise<void>((coz) => {
      if (cs.length === 0) {
        coz();
        return;
      }
      let kalan = cs.length;
      let bitti = false;
      const bitir = (): void => {
        if (bitti) return;
        bitti = true;
        zaman();
        coz();
      };
      const zaman = zamanlayici.sonra(ms, bitir);
      for (const c of cs) {
        c.surec.cikisDinle(() => {
          kalan--;
          if (kalan === 0) bitir();
        });
      }
    });

  /**
   * Eşzamanlı, ilk `await`'ten önce: süren devir bırakılır, bütün canlı süreçler emekliye ayrılır, jetonları
   * iptal. `neden` etkin sürecin açık turunun olayıdır; sonlandırmada `null` (olaylar silindi, yazılmaz).
   * Dönüş: dokunulan nesiller (jeton iptali ve mcp temizliği için).
   */
  const eskileriBirak = (eskiler: Set<Calisan>, neden: "surec_oldu" | null): number[] => {
    const nesiller: number[] = [nesilNo];
    const d = devir;
    if (d !== null) {
      // Bekleyen aday açılırsa `devir !== d` görür, kendini kapatır; doğrulama aşağıda.
      devirZamaniIptal(d);
      devir = null;
      if (d.nesil !== null) nesiller.push(d.nesil);
    }
    const c = etkin;
    etkin = null;
    if (c !== null) {
      eskiler.add(c);
      emekliyeAyir(c, neden);
    }
    for (const e of canlilar) {
      if (eskiler.has(e)) continue;
      eskiler.add(e);
      emekliyeAyir(e, null);
    }
    for (const e of eskiler) nesiller.push(e.nesil);
    erenJetonlariniIptalEt(nesiller);
    return nesiller;
  };

  /**
   * Süren başlatmalar sonuçlanınca (açtıkları süreç de eskidir) hepsi öldürülür, çıkış doğrulanır. Önceki
   * servis ömründen kalan kayıtlı süreç de denetlenir: kurtarma onu henüz kapatmamış olabilir. Canlılık
   * okunamazsa `false`: transkript silinmez (Windows kilidi).
   */
  const eskileriOldur = async (eskiler: Set<Calisan>, nesiller: number[]): Promise<boolean> => {
    while (arkaIsler.size > 0) await Promise.allSettled([...arkaIsler]);
    const yeniler: number[] = [];
    for (const e of canlilar) {
      if (eskiler.has(e)) continue;
      eskiler.add(e);
      emekliyeAyir(e, null);
      yeniler.push(e.nesil);
    }
    erenJetonlariniIptalEt(yeniler);
    nesiller.push(...yeniler);
    if (etkin !== null && eskiler.has(etkin)) etkin = null;
    // Stdin kapandı: kısa süre kendi çıkışı beklenir, sonra ağaç öldürülür. Kabuk çocukları da: `/T /F`.
    await cikislariBekle(
      [...eskiler].filter((e) => !e.bitti),
      KAPANIS_PAYI_MS,
    );
    await Promise.all(
      [...eskiler]
        .filter((e) => !e.bitti)
        .map((e) => surec.agaciOldur(e.surec.pid).catch((h: unknown) => hataYaz("surec_oldurme", h))),
    );
    // Çıkış olayı görülmüş olsa da: doğrulamanın tanımı `surecVarMi` (kimlik PID + oluşma anı, yeniden kullanılmış PID'i vurmaz).
    let cikti = true;
    for (const e of eskiler) {
      try {
        if (await surec.surecVarMi({ pid: e.surec.pid, olusturmaMs: e.surec.olusturmaMs })) cikti = false;
      } catch (h) {
        hataYaz("eski_surec_belirsiz", h);
        cikti = false;
      }
    }
    const son = depo.sonNesil(sohbet);
    if (son !== null && son.pid !== null && son.olusturma_ms !== null) {
      const pid = son.pid;
      if (![...eskiler].some((e) => e.surec.pid === pid)) {
        const kimlik = { pid, olusturmaMs: son.olusturma_ms };
        try {
          if (await surec.surecVarMi(kimlik)) {
            await surec.agaciOldur(pid);
            if (await surec.surecVarMi(kimlik)) cikti = false;
          }
        } catch (h) {
          hataYaz("eski_surec_belirsiz", h);
          cikti = false;
        }
      }
    }
    return cikti;
  };

  /**
   * Yeni sayfanın oturumu kaydedilmeden önce okunur: yeni oturum içinde olamaz. Kayıtlı oturumlar (nesil
   * kaydı olmayan aday dahil) ve bütün nesillerin oturumları: oturum kaydından önceki nesiller kayıtta yoktur
   * (ek göç 2 geriye doldurmaz). Silinmiş transkript yeniden denenirse bulunamayan sayılır.
   */
  const eskiOturumlar = (): string[] => {
    const kimlikler = new Set<string>();
    try {
      for (const s of depo.kayitliOturumlar(sohbet)) kimlikler.add(s);
    } catch (e) {
      hataYaz("oturum_kayitlari_okunamadi", e);
    }
    try {
      for (const n of depo.nesiller(sohbet)) kimlikler.add(n.session_id);
    } catch (e) {
      hataYaz("nesiller_okunamadi", e);
    }
    return [...kimlikler];
  };

  /**
   * Hiç atmaz. Sonda sayfa biter, kuyruk akar. Dilim 2: yeni nesil yalnız örnek yuva tutuyorsa (süreci
   * vardı ya da açılıyordu) ve uyutma istenmediyse açılır; değilse `sayfaBekliyor` sonraki açılışı yeni
   * oturuma çevirir, kuyruk doluysa yuva istenir.
   */
  const sayfaYap = async (eskiler: Set<Calisan>, nesiller: number[]): Promise<YeniSayfaSonucu> => {
    let eski_oturumlar: string[] = [];
    let eski_surec_cikti = false;
    let yeni_nesil_acildi = false;
    try {
      eski_surec_cikti = await eskileriOldur(eskiler, nesiller);
      eski_oturumlar = eskiOturumlar();
      // Kilit, `init` reddi, kapanış, bitmemiş kurtarma ya da yuva yok (ölümde bırakıldı, uyuyor,
      // sırada): açılmaz; sonraki açılış (ilk mesaj ya da yönetici) yeni oturumdur.
      if (yuvaTutuyor && uyutmaIstegi === null) {
        await baslatmaYap();
        yeni_nesil_acildi = !sayfaBekliyor;
      }
    } catch (e) {
      hataYaz("yeni_sayfa", e);
    } finally {
      sayfaSuruyor = false;
    }
    gunluk.bilgi("konusma", "yeni_sayfa", {
      sohbet_id,
      eski_oturum: eski_oturumlar.length,
      eski_surec_cikti,
      yeni_nesil_acildi,
    });
    if (!kapandi) {
      guvenli("pompa", pompala);
      guvenli("durum", durumYenile);
      if (etkin === null && kuyrukDolu()) guvenli("uyandir", acmayiDene);
    }
    return { eski_oturumlar, eski_surec_cikti, yeni_nesil_acildi };
  };

  // ---- sonlandırma (dilim 2, `chat_delete`) ----

  const sonlandirmaYap = async (
    eskiler: Set<Calisan>,
    nesiller: number[],
    bekleyenSayfa: Promise<YeniSayfaSonucu> | null,
  ): Promise<SonlandirmaSonucu> => {
    let eski_oturumlar: string[] = [];
    let eski_surec_cikti = false;
    try {
      if (bekleyenSayfa !== null) await bekleyenSayfa;
      eski_surec_cikti = await eskileriOldur(eskiler, nesiller);
      eski_oturumlar = eskiOturumlar();
      // Çıkış görülmese de (doğrulanamayan süreç) neslin dosyası kalmaz.
      await Promise.all([...new Set(nesiller)].map((n) => mcpTemizle(n)));
    } catch (e) {
      hataYaz("sonlandirma", e);
    }
    if (yuvaTutuyor) {
      yuvaTutuyor = false;
      guvenli("yuva_birakma", () => kapi.yuvaBirak(sohbet));
    }
    gunluk.bilgi("konusma", "sonlandirildi", { sohbet_id, eski_oturum: eski_oturumlar.length, eski_surec_cikti });
    return { eski_oturumlar, eski_surec_cikti };
  };

  /** Bu sohbete ait mi: dilim 2'de her örnek yalnız kendi `sohbet_id`'li olayına tepki verir. */
  const benim = (o: { sohbet_id: string }): boolean => o.sohbet_id === sohbet_id;

  // Fabrikada dinlenir: `isler_uzlastirildi`, `baslat`'tan önce yayınlanır.
  const dinleyiciler: IptalEt[] = [
    veriyolu.dinle("kilit_degisti", ({ durum }) => {
      if (kapandi || !baslatildi) return;
      // `belirsiz`: canlıya dokunulmaz, ölürse kapı `acmayiDene`'de kapalıdır.
      if (durum.tur === "aktif") kilitAktif();
      else if (durum.tur === "serbest") kilitSerbestKaldi();
      else durumYenile();
    }),
    veriyolu.dinle("is_bitti", (o) => {
      if (benim(o)) sentetikEkle(isBittiMetni(o.is_id, o.durum, o.kirli));
    }),
    veriyolu.dinle("soru_durumu", (o) => {
      if (benim(o)) sentetikEkle(soruDurumuMetni(o.is_id, o.durum));
    }),
    veriyolu.dinle("plan_sonuclandi", (o) => {
      if (benim(o)) sentetikEkle(planSonucuMetni(o.plan_id, o.sonuc, o.is_id));
    }),
    veriyolu.dinle("isler_uzlastirildi", ({ sohbetler }) => {
      // Toplamlar küreseldir: not yalnız bu sohbetin kendi sayılarıyla, girdisi varsa.
      if (!Object.hasOwn(sohbetler, sohbet_id)) return;
      const o = sohbetler[sohbet_id];
      if (o !== undefined) sentetikEkle(uzlastirmaMetni(o.sahiplenilen, o.biten));
    }),
  ];
  let dinliyor = true;
  const dinleyicileriBirak = (): void => {
    if (!dinliyor) return;
    dinliyor = false;
    for (const iptal of dinleyiciler) iptal();
  };

  sonDurum = durumHesapla();

  return {
    sohbet_id,

    async baslat() {
      if (baslatCagrildi || kapandi) return;
      baslatCagrildi = true;
      await acilisDene();
    },

    uyandir() {
      guvenli("uyandir", uyandir);
    },

    uyut() {
      if (kapandi) return Promise.resolve();
      if (uyutmaIstegi !== null) return uyutmaIstegi.soz;
      if (uyutulan !== null) return uyutulan.istek.soz;
      // Süreç, aday, başlatma ve sayfa yoksa kapatılacak bir şey yok.
      if (etkin === null && devir === null && !baslatmaSuruyor && !sayfaSuruyor) return Promise.resolve();
      const cozler: Array<() => void> = [];
      const soz = new Promise<void>((coz) => {
        cozler.push(coz);
      });
      uyutmaIstegi = { cozler, soz };
      gunluk.bilgi("konusma", "uyutma_istendi", { sohbet_id });
      guvenli("uyutma", uyutmaIlerle);
      guvenli("durum", durumYenile);
      return soz;
    },

    bostaBeri() {
      bostaGuncelle();
      return bostaMs;
    },

    durum: durumHesapla,

    aktifTur() {
      const tur = etkin?.tur ?? null;
      if (tur === null || !tur.gorunur) return null;
      tamponZamaniIptal(tur);
      tamponGonder(tur, "hepsi");
      return { turn_id: tur.turn_id, text: tur.metin.slice(0, tur.gonderilen) };
    },

    nesil: () => nesilNo,

    insanTuru() {
      const c = etkin;
      if (kapandi || sayfaSuruyor || devir !== null || c === null || c.bilincli || c.bitti || c.kirik) return null;
      const tur = c.tur;
      if (tur === null || tur.kaynak !== "insan" || tur.rol !== "normal") return null;
      return tur.turn_id;
    },

    insanMesajiAl(mesaj) {
      // Savunma: yanlış sohbete insan satırı yazılmaz; silinmiş sohbet mesaj almaz. Hiçbir şey yazılmadan atar.
      if (mesaj.sohbet_id !== sohbet_id) throw new Error("konusma: mesaj bu sohbetin değil");
      if (sonlandirildi) throw new Error("konusma: sohbet sonlandırıldı");
      const ms = saat.simdiMs();
      const seq = depo.islem(() => {
        const olay = depo.olayEkle({
          type: "user_echo",
          sohbet_id,
          client_msg_id: mesaj.client_msg_id,
          input: mesaj.input,
          text: mesaj.text,
          ...(mesaj.baglam !== undefined && { baglam: mesaj.baglam }),
        });
        // Olay öneksiz (telefonun gördüğü), kuyruk satırı ana oturuma gidecek metin (kısayolda önekli).
        depo.kuyrugaEkle("insan", erenMetniKur(mesaj), ms, sohbet);
        depo.sohbetEtkinlikYaz(sohbet, ms);
        return olay.seq;
      });
      // Mesaj kaydedildi: akıştaki hata kabulü geri almaz. Süreç yoksa yuva istenir (uyuyor/sirada).
      guvenli("pompa", pompala);
      if (etkin === null) guvenli("uyandir", uyandir);
      return { seq };
    },

    kes(turn_id) {
      const durum = durumHesapla();
      if (durum !== "hazir" && durum !== "tur_suruyor") return { ok: false, code: "eren_hazir_degil" };
      const c = etkin;
      const tur = c?.tur ?? null;
      if (c === null || tur === null || !tur.gorunur) return { ok: false, code: "tur_gecersiz" };
      if (turn_id !== undefined && turn_id !== tur.turn_id) return { ok: false, code: "tur_gecersiz" };
      if (!c.surec.satirYaz(kesmeSatiriKur(rastgele.opakId("kes")))) {
        boruKirildi(c);
        return { ok: false, code: "eren_hazir_degil" };
      }
      return { ok: true, deger: undefined };
    },

    devirOzetiAl(ozet, nesil) {
      const d = devir;
      // Yalnız devredilen neslin ana oturumu (jeton nesli) özet verebilir: başka sohbetin ya da eski neslin değil.
      if (kapandi || d === null || d.asama !== "ozet" || d.eski === null || nesil !== d.eskiNesil) {
        return { kabul: false };
      }
      d.ozet = ozet;
      return { kabul: true };
    },

    temizlenebilirMi() {
      if (kapandi || sayfaSuruyor || devir !== null || baslatmaSuruyor || uyutulan !== null) return false;
      const c = etkin;
      // `boruluBaslat` ile hazır olma arası da başlatmadır; kurtarma notu turu açık turdur.
      if (c !== null && (c.tur !== null || !c.hazirlandi)) return false;
      for (const e of canlilar) if (e.tur !== null) return false;
      // Önceki ömürden açık kalmış tur: kurtarma onu yarım metniyle kapatır, mezar taşından sonra yazılırdı.
      try {
        return depo.acikTurlar(sohbet).length === 0;
      } catch (e) {
        hataYaz("acik_turlar_okunamadi", e);
        return false;
      }
    },

    yeniSayfa() {
      if (sayfaSuruyor && sayfaSozu !== null) return sayfaSozu;
      sayfaNo++;
      sayfaSuruyor = true;
      sayfaBekliyor = true;
      // Temizlik kuyruğu sildi: yuva beklemesi biter (durum `baslatiliyor`, sonra `uyuyor`; yönetici
      // `eren_durumu`'ndan sıradan çıkarır). Sayfa sonunda kuyruk yeniden dolmuşsa yuva yeniden istenir.
      // Kilitte sıradaki sohbetin "kilit açılınca aç" işareti silinen kuyruğa aitti; kuyruk yeniden dolarsa
      // kilitSerbestKaldi `kuyrukDolu` ile yine yuva ister.
      if (sirada) kilittenOnceCanli = false;
      sirada = false;
      // Silinmiş geçmişin notları yeni oturuma gitmez.
      bekleyenNot = null;
      yenidenBildir = false;
      yenidenIptal();
      const eskiler = new Set<Calisan>();
      let nesiller: number[] = [];
      guvenli("yeni_sayfa_birakma", () => {
        nesiller = eskileriBirak(eskiler, "surec_oldu");
      });
      if (!kapandi) guvenli("durum", durumYenile);
      const p = sayfaYap(eskiler, nesiller);
      sayfaSozu = p;
      return p;
    },

    sonlandir() {
      if (sonlandirmaSozu !== null) return sonlandirmaSozu;
      // Eşzamanlı ön ek: kalıcı kapanış, dinleyiciler, devir, süreçler, jetonlar; `insanTuru()` `null`.
      sonlandirildi = true;
      kapandi = true;
      sirada = false;
      uyandirBekliyor = false;
      if (kurtarmaZamani !== null) {
        kurtarmaZamani();
        kurtarmaZamani = null;
      }
      dinleyicileriBirak();
      yenidenIptal();
      const bekleyenSayfa = sayfaSuruyor ? sayfaSozu : null;
      const uyutmalar = [uyutmaIstegi, uyutulan?.istek ?? null];
      uyutmaIstegi = null;
      uyutulan = null;
      const eskiler = new Set<Calisan>();
      let nesiller: number[] = [];
      guvenli("sonlandirma_birakma", () => {
        nesiller = eskileriBirak(eskiler, null);
      });
      for (const u of uyutmalar) if (u !== null) uyutmaCoz(u);
      const p = sonlandirmaYap(eskiler, nesiller, bekleyenSayfa);
      sonlandirmaSozu = p;
      return p;
    },

    async kapat() {
      if (kapandi) return;
      kapandi = true;
      sirada = false;
      uyandirBekliyor = false;
      if (kurtarmaZamani !== null) {
        kurtarmaZamani();
        kurtarmaZamani = null;
      }
      dinleyicileriBirak();
      yenidenIptal();
      const uyutmalar = [uyutmaIstegi, uyutulan?.istek ?? null];
      uyutmaIstegi = null;
      const d = devir;
      devir = null;
      const kapanacak = new Set<Calisan>(emekliler);
      if (d !== null) {
        devirZamaniIptal(d);
        if (d.aday !== null) kapanacak.add(d.aday);
        if (d.nesil !== null) kopru.jetonlariIptalEt(kapsam(d.nesil));
      }
      if (etkin !== null) kapanacak.add(etkin);
      for (const c of canlilar) kapanacak.add(c);
      etkin = null;
      const bekleyen: Promise<void>[] = [];
      for (const c of kapanacak) {
        c.bilincli = true;
        hazirIsaretle(c);
        if (c.oldurme !== null) {
          c.oldurme();
          c.oldurme = null;
        }
        const tur = c.tur;
        if (tur !== null && tur.gorunur) {
          // Tur açık kalır: sonraki `baslat` kurtarma akışıyla kapatır, not bu metinden kurulur.
          tamponZamaniIptal(tur);
          tamponGonder(tur, "hepsi");
          kismiZamaniIptal(tur);
          depo.turKismiYaz(tur.turn_id, tur.metin);
        }
        if (!c.bitti) {
          c.surec.stdinKapat();
          bekleyen.push(surec.agaciOldur(c.surec.pid).catch((e: unknown) => hataYaz("surec_oldurme", e)));
        }
      }
      await Promise.all(bekleyen);
      const sayfa = sayfaSuruyor ? sayfaSozu : null;
      if (sayfa !== null) {
        // Sayfa yeni süreç açmaz (kapandı), ama beklerken açılmış olanı kalmasın.
        await sayfa;
        const kalan = [...canlilar].filter((c) => !c.bitti);
        for (const c of kalan) {
          c.bilincli = true;
          c.surec.stdinKapat();
        }
        await Promise.all(kalan.map((c) => surec.agaciOldur(c.surec.pid).catch((e: unknown) => hataYaz("surec_oldurme", e))));
      }
      uyutulan = null;
      for (const u of uyutmalar) if (u !== null) uyutmaCoz(u);
      // Kapandı: yuva gerekmez, tutuyorsa bırakılır.
      durumYenile();
    },
  };
};
