/**
 * Bekçinin (supervisor) saf karar çekirdeği: olay -> eylem listesi. Saat okumaz, zamanlayıcı kurmaz,
 * süreç başlatmaz; zamanı yalnız olaylardaki `simdi`'den bilir. G/Ç `bekci-ana.ts`'tedir.
 * Ortak sözleşme, "Bekçi karar çekirdeği (server/src/bekci.ts)".
 *
 * Eylem sırası: günlük kaydı tetiklediği eylemden önce gelir, `cik` her zaman sondadır
 * (G/Ç `cik`'ta süreçten çıkar, ardından gelen eylem uygulanmazdı).
 * Günlüğe yalnız sayı, kimlik ve kapalı liste değeri yazılır; yol ve metin yazılmaz.
 */

export type BekciAyari = {
  readonly geriCekilmeMs: readonly number[];
  readonly kararliMs: number;
  readonly nabizAraligiMs: number;
  readonly nabizKacirmaSiniri: number;
  readonly kapanmaBeklemeMs: number;
  readonly erkenCikisMs: number;
  readonly erkenCikisMinBeklemeMs: number;
  readonly firtinaPencereMs: number;
  readonly firtinaSiniri: number;
  readonly firtinaBeklemeMs: number;
};

export type BekciOlayi =
  | { readonly tur: "basla"; readonly simdi: number }
  | { readonly tur: "ana_basladi"; readonly simdi: number; readonly pid: number }
  | { readonly tur: "ana_baslatilamadi"; readonly simdi: number }
  | { readonly tur: "ana_cikti"; readonly simdi: number; readonly kod: number | null }
  | { readonly tur: "nabiz_cevap"; readonly simdi: number; readonly n: number }
  | { readonly tur: "tik"; readonly simdi: number }
  | { readonly tur: "komut"; readonly simdi: number; readonly komut: "yenile" | "kapan" };

export type BekciEylemi =
  | { readonly tur: "ana_baslat" }
  | { readonly tur: "nabiz_gonder"; readonly n: number }
  | { readonly tur: "kapat_iste" }
  | { readonly tur: "zorla_oldur" }
  | {
      readonly tur: "gunluk";
      readonly seviye: "bilgi" | "uyari" | "hata";
      readonly olay: string;
      readonly alanlar: Readonly<Record<string, number | string | boolean | null>>;
    }
  | { readonly tur: "cik"; readonly kod: number };

export type BekciDurumu = {
  readonly durum: "baslatiliyor" | "calisiyor" | "bekliyor" | "kapaniyor";
  readonly anaPid: number | null;
  readonly anaBaslangicMs: number | null;
  readonly yenidenBaslatma: number;
  readonly sonCikisKodu: number | null;
  readonly sonNabizMs: number | null;
};

export type Bekci = {
  readonly olay: (o: BekciOlayi) => readonly BekciEylemi[];
  readonly durum: () => BekciDurumu;
};

type Alanlar = Readonly<Record<string, number | string | boolean | null>>;
type Seviye = "bilgi" | "uyari" | "hata";

/**
 * İç aşama. `baslamadi`: `basla` gelmedi. `bitti`: `cik` verildi, sonraki her olay yok sayılır.
 * Dışarıya `BekciDurumu.durum`'un dört değerinden biri olarak görünür.
 */
type Asama = "baslamadi" | "baslatiliyor" | "calisiyor" | "bekliyor" | "kapaniyor" | "bitti";

const VARSAYILAN: BekciAyari = Object.freeze({
  geriCekilmeMs: Object.freeze([1000, 2000, 5000, 10000, 30000, 60000]),
  kararliMs: 600000,
  nabizAraligiMs: 30000,
  nabizKacirmaSiniri: 3,
  kapanmaBeklemeMs: 40000,
  erkenCikisMs: 15000,
  erkenCikisMinBeklemeMs: 30000,
  firtinaPencereMs: 600000,
  firtinaSiniri: 8,
  firtinaBeklemeMs: 300000,
});

const sonluSayi = (d: number | undefined, varsayilan: number): number =>
  typeof d === "number" && Number.isFinite(d) ? d : varsayilan;

/** Verilmeyen ya da sonlu olmayan alan varsayılana düşer; boş geri çekilme listesi varsayılan listeye. */
const ayarCoz = (ayar: Partial<BekciAyari> | undefined): BekciAyari => {
  const a = ayar ?? {};
  const geri = a.geriCekilmeMs;
  return {
    geriCekilmeMs:
      geri !== undefined && geri.length > 0 && geri.every((x) => Number.isFinite(x))
        ? [...geri]
        : VARSAYILAN.geriCekilmeMs,
    kararliMs: sonluSayi(a.kararliMs, VARSAYILAN.kararliMs),
    nabizAraligiMs: sonluSayi(a.nabizAraligiMs, VARSAYILAN.nabizAraligiMs),
    nabizKacirmaSiniri: Math.max(1, sonluSayi(a.nabizKacirmaSiniri, VARSAYILAN.nabizKacirmaSiniri)),
    kapanmaBeklemeMs: sonluSayi(a.kapanmaBeklemeMs, VARSAYILAN.kapanmaBeklemeMs),
    erkenCikisMs: sonluSayi(a.erkenCikisMs, VARSAYILAN.erkenCikisMs),
    erkenCikisMinBeklemeMs: sonluSayi(a.erkenCikisMinBeklemeMs, VARSAYILAN.erkenCikisMinBeklemeMs),
    firtinaPencereMs: sonluSayi(a.firtinaPencereMs, VARSAYILAN.firtinaPencereMs),
    firtinaSiniri: Math.max(1, sonluSayi(a.firtinaSiniri, VARSAYILAN.firtinaSiniri)),
    firtinaBeklemeMs: sonluSayi(a.firtinaBeklemeMs, VARSAYILAN.firtinaBeklemeMs),
  };
};

const gunluk = (seviye: Seviye, olay: string, alanlar: Alanlar = {}): BekciEylemi => ({
  tur: "gunluk",
  seviye,
  olay,
  alanlar,
});

const ANA_BASLAT: BekciEylemi = { tur: "ana_baslat" };
const KAPAT_ISTE: BekciEylemi = { tur: "kapat_iste" };
const ZORLA_OLDUR: BekciEylemi = { tur: "zorla_oldur" };
const CIK_0: BekciEylemi = { tur: "cik", kod: 0 };

export const bekciKur = (ayar?: Partial<BekciAyari>): Bekci => {
  const a = ayarCoz(ayar);

  let asama: Asama = "baslamadi";
  // Yalnız `kapaniyor`'da dolu. `kapan` her zaman kazanır, `yenile`'ye düşmez.
  let istek: "yenile" | "kapan" | null = null;

  let anaPid: number | null = null;
  let anaBaslangicMs: number | null = null;
  let yenidenBaslatma = 0;
  let sonCikisKodu: number | null = null;
  let sonNabizMs: number | null = null;

  // Geri çekilme: ardışık başarısız deneme sayısı, bekleme bitişi, fırtına penceresindeki çıkış anları.
  let ardisikBasarisiz = 0;
  let beklemeBitisMs = 0;
  let firtinaAnlari: number[] = [];

  // Nabız: son gönderilen n (0 = bu ana için hiç gönderilmedi), son gönderim ya da ana başlangıç anı,
  // en son gönderilenin cevabı bekleniyor mu, üst üste cevapsız kalan nabız sayısı.
  let nabizN = 0;
  let nabizRefMs = 0;
  let cevapBekleniyor = false;
  let kacirilan = 0;

  // Kapanma: kapat isteme anı ve son zorla öldürme anı (null = öldürme verilmedi).
  let kapatIstemeMs: number | null = null;
  let oldurmeMs: number | null = null;

  let sonSimdi: number | null = null;

  /**
   * Olaydaki `simdi`'yi alır. Saat geri giderse kayıtlı anlar aynı farkla kaydırılır: süreler korunur,
   * nabız ve bekleme süreleri geri sıçrama kadar kör kalmaz. Sonlu olmayan değer son bilinen ana düşer.
   */
  const zamanAl = (ham: number): number => {
    const simdi = Number.isFinite(ham) ? ham : (sonSimdi ?? 0);
    if (sonSimdi !== null && simdi < sonSimdi) {
      const fark = simdi - sonSimdi;
      const kaydir = (t: number | null): number | null => (t === null ? null : t + fark);
      anaBaslangicMs = kaydir(anaBaslangicMs);
      sonNabizMs = kaydir(sonNabizMs);
      kapatIstemeMs = kaydir(kapatIstemeMs);
      oldurmeMs = kaydir(oldurmeMs);
      nabizRefMs += fark;
      beklemeBitisMs += fark;
      firtinaAnlari = firtinaAnlari.map((t) => t + fark);
    }
    sonSimdi = simdi;
    return simdi;
  };

  const yasamHesapla = (simdi: number): number | null =>
    anaBaslangicMs === null ? null : Math.max(0, simdi - anaBaslangicMs);

  /** Ana artık yok: süreçle ilgili her alan temizlenir. `sonNabizMs` tanı için kalır, yeni ana'da sıfırlanır. */
  const anaBirak = (): void => {
    anaPid = null;
    anaBaslangicMs = null;
    nabizN = 0;
    cevapBekleniyor = false;
    kacirilan = 0;
    kapatIstemeMs = null;
    oldurmeMs = null;
    istek = null;
  };

  const baslat = (): BekciEylemi => {
    asama = "baslatiliyor";
    return ANA_BASLAT;
  };

  const bitir = (): BekciEylemi => {
    asama = "bitti";
    return CIK_0;
  };

  /** İstenmemiş çıkış ya da başlatılamama (madde 4, 5, 6). `yasamMs` null: ana hiç yaşamadı. */
  const geriCekil = (simdi: number, kod: number | null, yasamMs: number | null): BekciEylemi[] => {
    if (yasamMs !== null && yasamMs >= a.kararliMs) ardisikBasarisiz = 0;
    const geri = a.geriCekilmeMs;
    let bekleme = geri[Math.min(ardisikBasarisiz, geri.length - 1)] ?? 0;
    ardisikBasarisiz++;

    const erken = yasamMs !== null && yasamMs < a.erkenCikisMs;
    if (erken) bekleme = Math.max(bekleme, a.erkenCikisMinBeklemeMs);

    yenidenBaslatma++;
    firtinaAnlari = firtinaAnlari.filter((t) => simdi - t < a.firtinaPencereMs);
    firtinaAnlari.push(simdi);
    const firtina = firtinaAnlari.length >= a.firtinaSiniri;
    // Fırtına beklemeyi hiçbir zaman kısaltmaz.
    if (firtina) bekleme = Math.max(bekleme, a.firtinaBeklemeMs);

    sonCikisKodu = kod;
    anaBirak();
    asama = "bekliyor";
    beklemeBitisMs = simdi + bekleme;

    const eylemler: BekciEylemi[] = [gunluk("uyari", "ana_cikti", { kod, yasam_ms: yasamMs, bekleme_ms: bekleme })];
    if (erken) eylemler.push(gunluk("uyari", "ana_erken_cikti", { yasam_ms: yasamMs, bekleme_ms: bekleme }));
    if (firtina) {
      eylemler.push(
        gunluk("hata", "firtina", {
          sayi: firtinaAnlari.length,
          pencere_ms: a.firtinaPencereMs,
          bekleme_ms: bekleme,
        }),
      );
    }
    return eylemler;
  };

  /** `kapaniyor`'da gelen çıkış bekçinin istediği çıkıştır (madde 7, 8): sayaçlar ve fırtına değişmez. */
  const istenenCikis = (simdi: number, kod: number | null): BekciEylemi[] => {
    const yasamMs = yasamHesapla(simdi);
    const yenile = istek === "yenile";
    sonCikisKodu = kod;
    anaBirak();
    if (yenile) {
      ardisikBasarisiz = 0;
      return [gunluk("bilgi", "ana_cikti", { kod, yasam_ms: yasamMs, bekleme_ms: 0 }), baslat()];
    }
    return [gunluk("bilgi", "ana_cikti", { kod, yasam_ms: yasamMs, bekleme_ms: null }), bitir()];
  };

  /** Öldürme verildi ama çıkış gelmedi: her `kapanmaBeklemeMs`'de bir yeniden öldür (taskkill düşmüş olabilir). */
  const oldurmeyiYinele = (simdi: number): BekciEylemi[] => {
    if (oldurmeMs === null || simdi - oldurmeMs < a.kapanmaBeklemeMs) return [];
    oldurmeMs = simdi;
    return [gunluk("uyari", "zorla_oldurme_yinelendi", { pid: anaPid }), ZORLA_OLDUR];
  };

  /** Madde 3: aralık dolunca önceki nabız cevapsızsa kaçırma sayılır; sınıra ulaşınca nabız yerine öldürme. */
  const nabizTik = (simdi: number): BekciEylemi[] => {
    if (simdi - nabizRefMs < a.nabizAraligiMs) return [];
    if (cevapBekleniyor) kacirilan++;
    if (kacirilan >= a.nabizKacirmaSiniri) {
      oldurmeMs = simdi;
      return [gunluk("uyari", "ana_donmus", { pid: anaPid, kacirilan, son_n: nabizN }), ZORLA_OLDUR];
    }
    nabizN++;
    nabizRefMs = simdi;
    cevapBekleniyor = true;
    return [{ tur: "nabiz_gonder", n: nabizN }];
  };

  const tik = (simdi: number): readonly BekciEylemi[] => {
    switch (asama) {
      case "bekliyor":
        return simdi >= beklemeBitisMs ? [baslat()] : [];
      case "calisiyor":
        return oldurmeMs !== null ? oldurmeyiYinele(simdi) : nabizTik(simdi);
      case "kapaniyor":
        if (oldurmeMs !== null) return oldurmeyiYinele(simdi);
        if (kapatIstemeMs !== null && simdi - kapatIstemeMs >= a.kapanmaBeklemeMs) {
          oldurmeMs = simdi;
          return [ZORLA_OLDUR];
        }
        return [];
      default:
        return [];
    }
  };

  const komut = (simdi: number, k: "yenile" | "kapan"): readonly BekciEylemi[] => {
    switch (asama) {
      case "baslamadi":
        return k === "kapan" ? [bitir()] : [];
      case "bekliyor":
        if (k === "kapan") return [bitir()];
        ardisikBasarisiz = 0;
        return [baslat()];
      case "baslatiliyor":
        // Ana henüz doğrulanmadı (pid yok): `kapan` hemen çıkar; başlatılan ana IPC kopunca kendini kapatır.
        // `yenile`: başlatılan ana zaten güncel yoldan geliyor, yalnız geri çekilme sıfırlanır.
        if (k === "kapan") return [bitir()];
        ardisikBasarisiz = 0;
        return [];
      case "calisiyor":
        istek = k;
        asama = "kapaniyor";
        kapatIstemeMs = simdi;
        // Donma yüzünden öldürme zaten verildiyse kapat istenmez; yeniden öldürme sayacı sürer.
        return oldurmeMs !== null ? [] : [KAPAT_ISTE];
      case "kapaniyor":
        if (k === "kapan") istek = "kapan";
        return [];
      default:
        return [];
    }
  };

  const olay = (o: BekciOlayi): readonly BekciEylemi[] => {
    if (asama === "bitti") return [];
    const simdi = zamanAl(o.simdi);
    switch (o.tur) {
      case "basla":
        if (asama !== "baslamadi") return [];
        return [gunluk("bilgi", "bekci_basladi"), baslat()];

      case "ana_basladi":
        if (asama !== "baslatiliyor") return [];
        anaPid = o.pid;
        anaBaslangicMs = simdi;
        nabizN = 0;
        nabizRefMs = simdi;
        cevapBekleniyor = false;
        kacirilan = 0;
        sonNabizMs = null;
        kapatIstemeMs = null;
        oldurmeMs = null;
        istek = null;
        asama = "calisiyor";
        return [];

      case "ana_baslatilamadi":
        if (asama !== "baslatiliyor") return [];
        return geriCekil(simdi, null, null);

      case "ana_cikti":
        if (asama === "kapaniyor") return istenenCikis(simdi, o.kod);
        if (asama === "calisiyor" || asama === "baslatiliyor") return geriCekil(simdi, o.kod, yasamHesapla(simdi));
        // Ana zaten yok (yinelenen ya da gecikmiş olay).
        return [];

      case "nabiz_cevap":
        // Yalnız en son gönderilen n'in cevabı sayılır; geç gelen eski n yok sayılır.
        if ((asama === "calisiyor" || asama === "kapaniyor") && nabizN > 0 && o.n === nabizN) {
          kacirilan = 0;
          cevapBekleniyor = false;
          sonNabizMs = simdi;
        }
        return [];

      case "tik":
        return tik(simdi);

      case "komut":
        return komut(simdi, o.komut);

      default:
        return [];
    }
  };

  const durum = (): BekciDurumu => ({
    durum: asama === "baslamadi" ? "bekliyor" : asama === "bitti" ? "kapaniyor" : asama,
    anaPid,
    anaBaslangicMs,
    yenidenBaslatma,
    sonCikisKodu,
    sonNabizMs,
  });

  return { olay, durum };
};
