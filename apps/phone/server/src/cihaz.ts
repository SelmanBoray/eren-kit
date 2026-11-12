/**
 * Kimliği doğrulanmış `/cihaz` bağlantısı: komut, izin kaydı, uygulama listesi, durum, bildirim.
 * MODULLER.md "cihaz"; kablo: protocol/CIHAZ.md. Komut kuyruklanmaz, hiçbir dalda yeniden denenmez.
 * Telefon jetonu yalnız bu kapanışın belleğindedir: günlüğe, olaya, diske, dışarıya çıkmaz.
 */
import { Cmd, cihazYukariCoz, kacir, Notify, PROTOKOL_SURUMU, SINIRLAR } from "@eren/protocol";
import type { CmdSonucu, GrantNedeni, UygulamaBilgisi } from "@eren/protocol";
import type {
  DogrulanmisCihazBaglantisi,
  CihazFabrikasi,
  CihazYoneticisi,
  IzinKaydi,
  KomutHatasi,
  Sonuc,
} from "./sozlesme.ts";

/** Sonuç, `deadline_ms`'ten bu kadar sonra da gelmediyse komut `belirsiz` sayılır. */
const SONUC_PAYI_MS = 2_000;
const KAPAT_KODU = 1008;
const AZAMI_BILDIRIM_KAYDI = 1_000;
const AZAMI_BITEN_PLAN = 1_000;
const AZAMI_GERI_CEKILEN = 1_000;

interface BellekIzni {
  grant_id: string;
  /** Yalnız bu kapanışta yaşar. */
  token: string;
  plan_id: string;
  plan_hash: string;
  mod: IzinKaydi["mod"];
  uygulamalar: readonly string[];
}

interface Bekleyen {
  baglanti: DogrulanmisCihazBaglantisi;
  coz: (s: Sonuc<CmdSonucu, KomutHatasi>) => void;
  son: number;
  ad: string;
  temizle: () => void;
}

const belirsiz: Sonuc<CmdSonucu, KomutHatasi> = { ok: false, code: "belirsiz" };

/** Kaçırılmış ad şema sınırını (120) aşarsa girdi kısaltılır: kaçış dizisi ortadan bölünmez. */
function uygulamaAdiKacir(ad: string): string {
  let boy: number = SINIRLAR.UYGULAMA_ADI;
  let cikti = kacir(ad, boy);
  while (cikti.length > SINIRLAR.UYGULAMA_ADI && boy > 0) {
    boy -= Math.max(1, cikti.length - SINIRLAR.UYGULAMA_ADI);
    if (boy < 0) boy = 0;
    cikti = kacir(ad, boy);
  }
  return cikti;
}

export const cihazKur: CihazFabrikasi = ({
  ayar,
  saat,
  zamanlayici,
  rastgele,
  veriyolu,
  depo,
  gunluk,
}) => {
  let aktif: DogrulanmisCihazBaglantisi | null = null;
  let kapali = false;
  let kilitAktif = false;
  let adbAcikti = false;
  let uygulamaListesi: readonly UygulamaBilgisi[] = [];
  const izinler = new Map<string, BellekIzni>();
  const bekleyenler = new Map<string, Bekleyen>();
  const bildirimler = new Map<string, boolean>();
  // Biten telefon planları: uzlaştırma gateway'den önce çalışınca izin listesi boştur,
  // izin olaydan sonra gelebilir. Bağlantı yenilense de korunur, sınırlıdır.
  const bitenPlanlar = new Map<string, GrantNedeni>();

  // Servis tarafında geri çekilmiş izinler: telefon bağlantı kopukken geri çekilen izni
  // sonradan yeniden yollarsa canlanmaz, özgün nedenle yeniden geri çekilir. Sınırlıdır.
  const geriCekilenler = new Map<string, GrantNedeni>();
  const geriCekilmisIsaretle = (grant_id: string, neden: GrantNedeni): void => {
    geriCekilenler.delete(grant_id);
    geriCekilenler.set(grant_id, neden);
    if (geriCekilenler.size > AZAMI_GERI_CEKILEN) {
      const eski = geriCekilenler.keys().next();
      if (!eski.done) geriCekilenler.delete(eski.value);
    }
  };

  /**
   * `gitmedi`: soket açık değil, çerçeve kesin gitmedi (gerçekleme `false` döner; sözleşmedeki imza
   * `void` olduğu için değer `unknown` okunur, `false` dışındaki her dönüş gitti sayılır).
   * `hata`: gönderim attı, çerçevenin akıbeti bilinmez.
   */
  const gonderIc = (b: DogrulanmisCihazBaglantisi, mesaj: unknown): "gitti" | "gitmedi" | "hata" => {
    try {
      const sonuc: unknown = b.baglanti.gonder(JSON.stringify(mesaj));
      if (sonuc !== false) return "gitti";
      gunluk.uyari("cihaz", "gonderim_basarisiz", { neden: "soket_kapali" });
      return "gitmedi";
    } catch {
      gunluk.uyari("cihaz", "gonderim_basarisiz");
      return "hata";
    }
  };

  const gonder = (b: DogrulanmisCihazBaglantisi, mesaj: unknown): boolean => gonderIc(b, mesaj) === "gitti";

  const bekleyeniBitir = (id: string, sonuc: Sonuc<CmdSonucu, KomutHatasi>): void => {
    const b = bekleyenler.get(id);
    if (b === undefined) return;
    bekleyenler.delete(id);
    b.temizle();
    b.coz(sonuc);
  };

  const baglantininBekleyenleriniBelirsizYap = (b: DogrulanmisCihazBaglantisi): void => {
    for (const [id, bek] of [...bekleyenler]) {
      if (bek.baglanti === b) bekleyeniBitir(id, belirsiz);
    }
  };

  /** Aktif bağlantıyı bırakır: bekleyenler `belirsiz`, kopukluk yayınlanır. Aktif değilse bir şey yapmaz. */
  const aktifiBirak = (b: DogrulanmisCihazBaglantisi): void => {
    if (aktif !== b) return;
    aktif = null;
    baglantininBekleyenleriniBelirsizYap(b);
    veriyolu.yayinla("cihaz_baglantisi", { bagli: false });
    gunluk.bilgi("cihaz", "baglanti_koptu");
  };

  // Bu modülün kendi kapattığı bağlantılar. `ws` kapanış olayını ancak karşı uç kapanış el sıkışmasını
  // yanıtlayınca ya da `closeTimeout` (30 sn) dolunca yayar; CLOSING'de `message` yayılmaya devam eder.
  // Bu yüzden sunucunun kapattığı bağlantı kapanış olayını beklemeden ölü sayılır: çerçevesi işlenmez,
  // aktifse hemen bırakılır.
  const oluler = new WeakSet<DogrulanmisCihazBaglantisi>();
  const sonlandir = (b: DogrulanmisCihazBaglantisi, kod: number, neden: string): void => {
    oluler.add(b);
    aktifiBirak(b);
    try {
      b.baglanti.kapat(kod, neden);
    } catch {
      // Zaten kapalı olabilir.
    }
  };

  const izniKaldir = (g: BellekIzni, neden: GrantNedeni): void => {
    izinler.delete(g.grant_id);
    veriyolu.yayinla("izin_gitti", { grant_id: g.grant_id, plan_id: g.plan_id, neden });
    gunluk.bilgi("cihaz", "izin_gitti", { grant_id: g.grant_id, neden });
  };

  const izinBulIc = (plan_id: string, plan_hash: string): BellekIzni | null => {
    let bulunan: BellekIzni | null = null;
    for (const g of izinler.values()) {
      if (g.plan_id === plan_id && g.plan_hash === plan_hash) bulunan = g;
    }
    return bulunan;
  };

  const izinGeriCek = (grant_id: string | null, neden: GrantNedeni): boolean => {
    const b = aktif;
    if (grant_id !== null) geriCekilmisIsaretle(grant_id, neden);
    else for (const g of izinler.values()) geriCekilmisIsaretle(g.grant_id, neden);
    if (b === null) {
      const hedef = [...izinler.values()].filter((g) => grant_id === null || g.grant_id === grant_id);
      for (const g of hedef) izniKaldir(g, neden);
      return false;
    }
    if (grant_id !== null && !izinler.has(grant_id)) return false;
    return gonder(b, { v: PROTOKOL_SURUMU, type: "grant_revoke", grant_id, neden });
  };

  const cmdSonucuIsle = (b: DogrulanmisCihazBaglantisi, m: CmdSonucuMesaji): void => {
    const bek = bekleyenler.get(m.cmd_id);
    if (bek === undefined || bek.baglanti !== b) {
      gunluk.uyari("cihaz", "gec_sonuc_atildi", { cmd_id: m.cmd_id });
      return;
    }
    if (saat.simdiMs() > bek.son) {
      // Zamanlayıcı henüz tetiklenmemiş olabilir: geç sonuç yine atılır.
      gunluk.uyari("cihaz", "gec_sonuc_atildi", { cmd_id: m.cmd_id });
      bekleyeniBitir(m.cmd_id, belirsiz);
      return;
    }
    const sonuc: CmdSonucu = { ok: m.ok, foreground: m.foreground };
    if (m.payload !== undefined) sonuc.payload = m.payload;
    if (m.denied !== undefined) sonuc.denied = m.denied;
    if (m.hata !== undefined) sonuc.hata = m.hata;
    // Yalnız tür ve kısa neden KODU yazılır; ekran, öğe metni, başlık ve payload asla.
    if (m.denied !== undefined) {
      gunluk.uyari("cihaz", "komut_sonucu", { cmd_id: m.cmd_id, ad: bek.ad, sonuc: "denied", neden: m.denied });
    } else if (m.hata !== undefined) {
      gunluk.uyari("cihaz", "komut_sonucu", { cmd_id: m.cmd_id, ad: bek.ad, sonuc: "hata", neden: m.hata });
    } else {
      gunluk.bilgi("cihaz", "komut_sonucu", { cmd_id: m.cmd_id, ad: bek.ad, sonuc: m.ok ? "ok" : "hata" });
    }
    bekleyeniBitir(m.cmd_id, { ok: true, deger: sonuc });
  };

  const grantIssuedIsle = (b: DogrulanmisCihazBaglantisi, m: GrantIssuedMesaji): void => {
    const cekilenNeden = geriCekilenler.get(m.grant_id);
    if (cekilenNeden !== undefined) {
      gonder(b, { v: PROTOKOL_SURUMU, type: "grant_revoke", grant_id: m.grant_id, neden: cekilenNeden });
      gunluk.bilgi("cihaz", "izin_geri_cekilmis_reddedildi", { grant_id: m.grant_id });
      return;
    }
    if (kilitAktif) {
      // Kilit sürerken yeni izin yaşatılmaz; bellekte tutulmaz, hiçbir tüketici görmez.
      gonder(b, { v: PROTOKOL_SURUMU, type: "grant_revoke", grant_id: m.grant_id, neden: "limit_kilit" });
      gunluk.bilgi("cihaz", "izin_kilitte_reddedildi", { grant_id: m.grant_id });
      return;
    }
    const bitenNeden = bitenPlanlar.get(m.plan_id);
    if (bitenNeden !== undefined) {
      // Plan zaten bitmiş: izin saklanmaz, hiçbir tüketici görmez, telefondan geri çekilir.
      gonder(b, { v: PROTOKOL_SURUMU, type: "grant_revoke", grant_id: m.grant_id, neden: bitenNeden });
      gunluk.bilgi("cihaz", "izin_bitmis_plan_reddedildi", { grant_id: m.grant_id });
      return;
    }
    const g: BellekIzni = {
      grant_id: m.grant_id,
      token: m.token,
      plan_id: m.plan_id,
      plan_hash: m.plan_hash,
      mod: m.mod,
      uygulamalar: [...m.uygulamalar],
    };
    izinler.set(g.grant_id, g);
    veriyolu.yayinla("izin_geldi", { izin: izinKaydi(g) });
    gunluk.bilgi("cihaz", "izin_geldi", { grant_id: g.grant_id, plan_id: g.plan_id, mod: g.mod });
  };

  const grantRevokedIsle = (m: GrantRevokedMesaji): void => {
    const g = izinler.get(m.grant_id);
    if (g === undefined) return;
    izniKaldir(g, m.neden);
  };

  const deviceStateIsle = (m: DeviceStateMesaji): void => {
    if (m.adb_enabled && !adbAcikti) {
      try {
        depo.olayEkle({
          type: "system_notice",
          seviye: "uyari",
          kod: "diger",
          metin: "Telefonda USB hata ayıklama (ADB) açıldı.",
        });
      } catch {
        gunluk.hata("cihaz", "adb_notu_yazilamadi");
      }
    }
    adbAcikti = m.adb_enabled;
  };

  const mesajIsle = (b: DogrulanmisCihazBaglantisi, ham: string): void => {
    if (b !== aktif || kapali || oluler.has(b)) return;
    const c = cihazYukariCoz(ham);
    if (!c.ok) {
      gunluk.uyari("cihaz", "gecersiz_cerceve", { code: c.kod, yollar: c.yollar.join(",") });
      gonder(b, { v: PROTOKOL_SURUMU, type: "error", code: c.kod });
      sonlandir(b, KAPAT_KODU, c.kod);
      return;
    }
    const m = c.mesaj;
    switch (m.type) {
      case "cmd_result":
        cmdSonucuIsle(b, m);
        return;
      case "grant_issued":
        grantIssuedIsle(b, m);
        return;
      case "grant_revoked":
        grantRevokedIsle(m);
        return;
      case "device_state":
        deviceStateIsle(m);
        return;
      case "app_list":
        uygulamaListesi = m.uygulamalar;
        return;
      case "notify_ack":
        if (bildirimler.has(m.notify_id)) bildirimler.set(m.notify_id, true);
        return;
      default:
        // El sıkışma bitti: hello/auth_response tekrarı protokol ihlalidir.
        gonder(b, { v: PROTOKOL_SURUMU, type: "error", code: "yetkisiz" });
        sonlandir(b, KAPAT_KODU, "yetkisiz");
    }
  };

  const baglandi = (b: DogrulanmisCihazBaglantisi): void => {
    if (kapali) {
      sonlandir(b, KAPAT_KODU, "kapali");
      return;
    }
    const eski = aktif;
    // Önce yenisi atanır: eskinin kapanış dinleyicisi ve çerçeveleri etkisiz kalır.
    aktif = b;
    // Telefon aktif izinleri welcome sonrası yeniden yollar; eski jetonlar yaşamaz.
    izinler.clear();
    if (eski !== null) {
      baglantininBekleyenleriniBelirsizYap(eski);
      sonlandir(eski, KAPAT_KODU, "yeni_baglanti");
    }
    b.baglanti.mesajDinle((ham) => {
      try {
        mesajIsle(b, ham);
      } catch {
        gunluk.hata("cihaz", "mesaj_islenemedi");
      }
    });
    // Kapanışı başka biri başlatmış olabilir (gateway: eşleşme kaldırıldı); gateway devrettiği bağlantıda
    // kapanış dinleyicisini kapatma çağrısı anında tetikler, `ws`'nin `close` olayını beklemez.
    b.baglanti.kapanisDinle(() => {
      oluler.add(b);
      aktifiBirak(b);
    });
    veriyolu.yayinla("cihaz_baglantisi", { bagli: true });
    gunluk.bilgi("cihaz", "baglandi", { device_id: b.device_id });
  };

  const komut: CihazYoneticisi["komut"] = (baglam, ad, args, sinyal) => {
    const b = aktif;
    if (b === null) return Promise.resolve({ ok: false, code: "telefon_bagli_degil" });
    if (kilitAktif) return Promise.resolve({ ok: false, code: "limit_kilitli" });
    const g = izinBulIc(baglam.plan_id, baglam.plan_hash);
    if (g === null) return Promise.resolve({ ok: false, code: "izin_bekleniyor" });
    if (sinyal.aborted) return Promise.resolve(belirsiz);

    const simdi = saat.simdiMs();
    const beklemeMs =
      ad === "wait" ? Math.ceil((args as { seconds: number }).seconds * 1000) : 0;
    const deadline = simdi + ayar.sureler.komutPayiMs + beklemeMs;
    const cmd_id = rastgele.opakId("c");

    const aday = Cmd.safeParse({
      v: PROTOKOL_SURUMU,
      type: "cmd",
      cmd_id,
      grant_id: g.grant_id,
      token: g.token,
      deadline_ms: deadline,
      name: ad,
      args,
    });
    if (!aday.success) {
      // Şemadan geçmeyen komut telefona gitmez; kapının reddi gibi döner.
      gunluk.uyari("cihaz", "komut_gecersiz", { ad });
      return Promise.resolve({
        ok: true,
        deger: { ok: false, foreground: null, denied: "gecersiz_arg" },
      });
    }

    return new Promise<Sonuc<CmdSonucu, KomutHatasi>>((coz) => {
      const son = deadline + SONUC_PAYI_MS;
      const iptalZaman = zamanlayici.sonra(Math.max(0, son - simdi), () => {
        gunluk.uyari("cihaz", "komut_zaman_asimi", { cmd_id });
        bekleyeniBitir(cmd_id, belirsiz);
      });
      const sinyalDinleyici = (): void => {
        gunluk.bilgi("cihaz", "komut_iptal", { cmd_id });
        bekleyeniBitir(cmd_id, belirsiz);
      };
      sinyal.addEventListener("abort", sinyalDinleyici, { once: true });
      bekleyenler.set(cmd_id, {
        baglanti: b,
        coz,
        son,
        ad,
        temizle: () => {
          iptalZaman();
          sinyal.removeEventListener("abort", sinyalDinleyici);
        },
      });
      // Soket kapalı: çerçeve gitmedi, telefon bağlı değildir; son teslimi beklemeden döner.
      // Gönderim hatası: çerçeve gitmiş olabilir, `belirsiz`. İkisinde de yeniden denenmez.
      const gidis = gonderIc(b, aday.data);
      if (gidis === "gitmedi") bekleyeniBitir(cmd_id, { ok: false, code: "telefon_bagli_degil" });
      else if (gidis === "hata") bekleyeniBitir(cmd_id, belirsiz);
      else gunluk.bilgi("cihaz", "komut_gitti", { cmd_id, ad });
    });
  };

  const unsubscribe: Array<() => void> = [
    veriyolu.dinle("kilit_degisti", ({ durum }) => {
      kilitAktif = durum.tur === "aktif";
      if (kilitAktif) izinGeriCek(null, "limit_kilit");
    }),
    veriyolu.dinle("is_bitti", ({ plan_id, tur, durum }) => {
      if (tur !== "telefon") return;
      const neden: GrantNedeni = durum === "iptal" ? "is_iptal" : "is_bitti";
      bitenPlanlar.delete(plan_id);
      bitenPlanlar.set(plan_id, neden);
      if (bitenPlanlar.size > AZAMI_BITEN_PLAN) {
        const eski = bitenPlanlar.keys().next();
        if (!eski.done) bitenPlanlar.delete(eski.value);
      }
      for (const g of [...izinler.values()]) {
        if (g.plan_id === plan_id) izinGeriCek(g.grant_id, neden);
      }
    }),
  ];

  return {
    baglandi,
    bagliMi: () => aktif !== null,
    komut,
    izinBul(plan_id, plan_hash) {
      const g = izinBulIc(plan_id, plan_hash);
      return g === null ? null : izinKaydi(g);
    },
    izinGeriCek,
    uygulamalar() {
      return {
        telefon_bagli: aktif !== null,
        uygulamalar: uygulamaListesi.map((u) => ({ ...u, ad: uygulamaAdiKacir(u.ad) })),
      };
    },
    bildir(girdi) {
      const b = aktif;
      if (b === null) return null;
      const notify_id = rastgele.opakId("n");
      const aday = Notify.safeParse({ v: PROTOKOL_SURUMU, type: "notify", notify_id, ...girdi });
      if (!aday.success) return null;
      if (!gonder(b, aday.data)) return null;
      bildirimler.set(notify_id, false);
      if (bildirimler.size > AZAMI_BILDIRIM_KAYDI) {
        const eski = bildirimler.keys().next();
        if (!eski.done) bildirimler.delete(eski.value);
      }
      return notify_id;
    },
    bildirimOnaylandiMi: (notify_id) => bildirimler.get(notify_id) === true,
    kapat() {
      if (kapali) return;
      kapali = true;
      for (const u of unsubscribe) u();
      const b = aktif;
      aktif = null;
      if (b !== null) {
        oluler.add(b);
        baglantininBekleyenleriniBelirsizYap(b);
        try {
          b.baglanti.kapat(1001, "servis_kapaniyor");
        } catch {
          // Zaten kapalı olabilir.
        }
        veriyolu.yayinla("cihaz_baglantisi", { bagli: false });
      }
      izinler.clear();
      bitenPlanlar.clear();
      geriCekilenler.clear();
    },
  };
};

/** Jetonsuz kopya: jeton bu modülden çıkmaz. */
function izinKaydi(g: BellekIzni): IzinKaydi {
  return {
    grant_id: g.grant_id,
    plan_id: g.plan_id,
    plan_hash: g.plan_hash,
    mod: g.mod,
    uygulamalar: [...g.uygulamalar],
  };
}

type Cozulen = Extract<ReturnType<typeof cihazYukariCoz>, { ok: true }>["mesaj"];
type CmdSonucuMesaji = Extract<Cozulen, { type: "cmd_result" }>;
type GrantIssuedMesaji = Extract<Cozulen, { type: "grant_issued" }>;
type GrantRevokedMesaji = Extract<Cozulen, { type: "grant_revoked" }>;
type DeviceStateMesaji = Extract<Cozulen, { type: "device_state" }>;
