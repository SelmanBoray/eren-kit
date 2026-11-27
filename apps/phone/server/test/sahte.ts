/**
 * Dış dünyanın sahtesi: gerçek süreç, dosya, saat, ağ yok; hepsi belirli (deterministik).
 *
 * Kullanım:
 *   const d = sahteDunya();                       // d.dunya: DisDunya; tek tek: d.saat, d.surec, d.dosya...
 *   d.zaman.ilerlet(5000);                        // saat 5 sn ilerler, vadesi gelen zamanlayıcılar sırayla tetiklenir
 *   d.dosya.yaz("C:/x/a.json", "{}");             // bellek içi dosya; d.dosya.dosyalar() ile oku
 *   const s = await d.dunya.surec.boruluBaslat({ exe: "claude", argv: [], cwd: "C:/x", ortam: {} });
 *   d.surec.sonBorulu().stdoutSatiriGonder('{"type":"init"}');  // test beslemesi; s.satirYaz çıktısı: .yazilanlar
 *   d.surec.sonBorulu().cik(0);                   // çıkış: cikisDinle dinleyicileri çağrılır, kod .cikisKodu'nda
 *   d.surec.baslatmalar;                          // her başlatma: { tur, istek } (komut, argüman, ortam burada)
 *   d.surec.oldurmalar;                           // taskkill kayıtları: { tur: "agac" | "tek", pid }
 *   d.dosya.cagrilar.say("atomikYaz");            // her sahte `cagrilar` ile ne çağrıldığını sorgulatır
 *   d.transkript.sonrakiSonuc({ silinen: 2, bulunamayan: 0, silinemeyen: 1, reddedilen: 0 }); d.transkript.silinenIstekler;
 * Hata vermek için: d.surec.sonrakiBaslatmaHatasi(new Error("x")), d.dosya.hataVer("oku", err), d.http.hataVer(err).
 * Ajanda dalgası: d.boru.baglan(AJANDA_BORU_ADI) (iki adlı boru), d.takvim (sabit ofsetli `TakvimPortu`;
 * `d.takvim.dilim = "Asia/Tokyo"` kullanıcının dilimini değiştirir; `DisDunya`'da değildir).
 * Medya dalgası: d.medyaDosya (bellek içi `MedyaDosyaPortu`; `DisDunya`'da değildir), sahteMedyaIsleyici(d.medyaDosya)
 * (araç çıktısını sahte dosyaya yazar), sahteMedyaYoneticisi() (S5/S6/S7 yüzleri), sahteMedyaAyari(),
 * sahteMedyaBaytlari("mp4", 4096) (koklamadan geçen baş baytlı içerik).
 */
import { base64BaytUzunlugu, mimeTuru } from "@eren/protocol";
import type { EkBilgisi, EkListesi, MedyaTuru, SohbetId } from "@eren/protocol";
import type {
  AnahtarPortu,
  AracCalismasi,
  AracIstegi,
  AracSonucu,
  AyrikSurec,
  AyrikSurecIstegi,
  BoruBaglantisi,
  BoruluSurec,
  BoruluSurecIstegi,
  BoruSunucuIstegi,
  BoruSunucuPortu,
  DisDunya,
  DokumMetni,
  DosyaPortu,
  Gunluk,
  GunlukAlanlari,
  HttpPortu,
  IptalEt,
  KapatilabilirSunucu,
  KareSirasi,
  KayitPortu,
  MasaustuDurumu,
  MediaStateGovdesi,
  MedyaAyari,
  MedyaBaglamaHatasi,
  MedyaBicimi,
  MedyaDosyaAdi,
  MedyaDosyaPortu,
  MedyaIcerigiDurumu,
  MedyaIsleyici,
  MedyaOlcumu,
  MedyaServisSinirlari,
  MedyaYoneticisi,
  RamOkumasi,
  RastgelePortu,
  SaatPortu,
  SistemPortu,
  Sonuc,
  SohbetSecimi,
  SurecKaydi,
  SurecKapisi,
  SurecKimligi,
  SurecPortu,
  TakvimPortu,
  TekilKilitPortu,
  TranskriptPortu,
  TranskriptSilmeSonucu,
  WsBaglantisi,
  WsSunucuIstegi,
  WsSunucuPortu,
  WsYolu,
  ZamanlayiciPortu,
} from "../src/sozlesme.ts";

// ---------------------------------------------------------------------------------------------
// Çağrı defteri: her sahtede `cagrilar`
// ---------------------------------------------------------------------------------------------

export interface Cagri {
  ad: string;
  args: readonly unknown[];
}

export class CagriDefteri {
  readonly liste: Cagri[] = [];
  ekle(ad: string, ...args: unknown[]): void {
    this.liste.push({ ad, args });
  }
  /** `ad` verilmezse hepsi. */
  say(ad?: string): number {
    return ad === undefined ? this.liste.length : this.liste.filter((c) => c.ad === ad).length;
  }
  hepsi(ad: string): Cagri[] {
    return this.liste.filter((c) => c.ad === ad);
  }
  son(ad?: string): Cagri | undefined {
    const l = ad === undefined ? this.liste : this.hepsi(ad);
    return l[l.length - 1];
  }
  temizle(): void {
    this.liste.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Saat + zamanlayıcı: elle ilerler
// ---------------------------------------------------------------------------------------------

interface Zamanlayici {
  id: number;
  vade: number;
  aralik: number | null;
  f: () => void;
}

export interface SahteZaman {
  saat: SaatPortu;
  zamanlayici: ZamanlayiciPortu;
  cagrilar: CagriDefteri;
  /** Saati `ms` ilerletir; vadesi gelenleri vade sırasıyla (eşitse kayıt sırasıyla) tetikler. */
  ilerlet(ms: number): void;
  /** Saati verilen ana taşır (geriye gidemez), yolda tetikler. */
  git(mutlakMs: number): void;
  simdi(): number;
  bekleyenSayisi(): number;
}

export function sahteZaman(baslangicMs = 1_700_000_000_000): SahteZaman {
  let simdi = baslangicMs;
  let sayac = 0;
  const liste: Zamanlayici[] = [];
  const cagrilar = new CagriDefteri();

  const kaydet = (ms: number, f: () => void, tekrar: boolean): IptalEt => {
    const z: Zamanlayici = { id: ++sayac, vade: simdi + ms, aralik: tekrar ? Math.max(ms, 1) : null, f };
    liste.push(z);
    return () => {
      const i = liste.indexOf(z);
      if (i >= 0) liste.splice(i, 1);
    };
  };

  const git = (hedef: number): void => {
    if (hedef < simdi) throw new Error("sahte saat geriye gitmez");
    for (;;) {
      let en: Zamanlayici | undefined;
      for (const z of liste) {
        if (z.vade <= hedef && (en === undefined || z.vade < en.vade || (z.vade === en.vade && z.id < en.id))) en = z;
      }
      if (en === undefined) break;
      simdi = Math.max(simdi, en.vade);
      if (en.aralik === null) liste.splice(liste.indexOf(en), 1);
      else en.vade += en.aralik;
      en.f();
    }
    simdi = hedef;
  };

  return {
    saat: {
      simdiMs: () => {
        cagrilar.ekle("simdiMs");
        return simdi;
      },
    },
    zamanlayici: {
      sonra: (ms, f) => {
        cagrilar.ekle("sonra", ms);
        return kaydet(ms, f, false);
      },
      herAralik: (ms, f) => {
        cagrilar.ekle("herAralik", ms);
        return kaydet(ms, f, true);
      },
    },
    cagrilar,
    ilerlet: (ms) => git(simdi + ms),
    git,
    simdi: () => simdi,
    bekleyenSayisi: () => liste.length,
  };
}

// ---------------------------------------------------------------------------------------------
// Rastgele: sabit tohum
// ---------------------------------------------------------------------------------------------

export interface SahteRastgele extends RastgelePortu {
  cagrilar: CagriDefteri;
}

export function sahteRastgele(tohum = 12345): SahteRastgele {
  let durum = tohum >>> 0;
  const sonraki = (): number => {
    durum = (durum + 0x6d2b79f5) >>> 0;
    let t = durum;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cagrilar = new CagriDefteri();
  const bayt = (n: number): Uint8Array => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = Math.floor(sonraki() * 256);
    return b;
  };
  const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
  return {
    cagrilar,
    baytlar: (adet) => {
      cagrilar.ekle("baytlar", adet);
      return bayt(adet);
    },
    uuid: () => {
      cagrilar.ekle("uuid");
      const b = bayt(16);
      b[6] = (b[6]! & 0x0f) | 0x40;
      b[8] = (b[8]! & 0x3f) | 0x80;
      const h = hex(b);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    opakId: (on) => {
      cagrilar.ekle("opakId", on);
      return on + b64url(bayt(9));
    },
    jeton: () => {
      cagrilar.ekle("jeton");
      return b64url(bayt(32));
    },
    hex64: () => {
      cagrilar.ekle("hex64");
      return hex(bayt(8));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Dosya: bellek içi
// ---------------------------------------------------------------------------------------------

export type DosyaIslemi = "oku" | "atomikYaz" | "aralikOku" | "boyut" | "dizinOlustur" | "dizinVarMi" | "dosyaSil";

export interface SahteDosya extends DosyaPortu {
  cagrilar: CagriDefteri;
  /** Testten dosya koyar (portu çağırmaz, kaydetmez). */
  yaz(yol: string, icerik: string): void;
  /** Testten dosyanın sonuna ekler (örn. `out.jsonl` büyümesi). */
  ekle(yol: string, icerik: string): void;
  /** Testten dosya siler (portu çağırmaz, kaydetmez). Port yöntemi `dosyaSil`dır; ad çakışmasın diye bu ayrı kalır. */
  sil(yol: string): void;
  /** Yoksa `null`. */
  icerik(yol: string): string | null;
  dosyalar(): Record<string, string>;
  dizinler(): string[];
  /** Verilen işlemin bir sonraki çağrısı atar (bir kez). */
  hataVer(islem: DosyaIslemi, hata: Error): void;
}

const yolDuzelt = (y: string): string => y.replaceAll("\\", "/");

export function sahteDosya(): SahteDosya {
  const dosyalar = new Map<string, string>();
  const dizinler = new Set<string>();
  const hatalar = new Map<DosyaIslemi, Error[]>();
  const cagrilar = new CagriDefteri();

  const kontrol = (islem: DosyaIslemi, ...args: unknown[]): void => {
    cagrilar.ekle(islem, ...args);
    const h = hatalar.get(islem)?.shift();
    if (h) throw h;
  };
  const enc = new TextEncoder();
  const bayt = (s: string): Uint8Array => enc.encode(s);

  return {
    cagrilar,
    oku: async (yol) => {
      kontrol("oku", yol);
      return dosyalar.get(yolDuzelt(yol)) ?? null;
    },
    atomikYaz: async (yol, icerik) => {
      kontrol("atomikYaz", yol, icerik);
      dosyalar.set(yolDuzelt(yol), icerik);
    },
    aralikOku: async (yol, ofset, azamiBayt) => {
      kontrol("aralikOku", yol, ofset, azamiBayt);
      const i = dosyalar.get(yolDuzelt(yol));
      if (i === undefined) return new Uint8Array(0);
      return bayt(i).slice(ofset, ofset + azamiBayt);
    },
    boyut: async (yol) => {
      kontrol("boyut", yol);
      const i = dosyalar.get(yolDuzelt(yol));
      return i === undefined ? null : bayt(i).length;
    },
    dizinOlustur: async (yol) => {
      kontrol("dizinOlustur", yol);
      dizinler.add(yolDuzelt(yol).replace(/\/+$/, ""));
    },
    dizinVarMi: async (yol) => {
      kontrol("dizinVarMi", yol);
      const d = yolDuzelt(yol).replace(/\/+$/, "");
      if (dizinler.has(d)) return true;
      for (const k of dizinler) if (k.startsWith(d + "/")) return true;
      for (const k of dosyalar.keys()) if (k.startsWith(d + "/")) return true;
      return false;
    },
    dosyaSil: async (yol) => {
      kontrol("dosyaSil", yol);
      dosyalar.delete(yolDuzelt(yol));
    },
    yaz: (yol, icerik) => void dosyalar.set(yolDuzelt(yol), icerik),
    ekle: (yol, icerik) => {
      const y = yolDuzelt(yol);
      dosyalar.set(y, (dosyalar.get(y) ?? "") + icerik);
    },
    sil: (yol) => void dosyalar.delete(yolDuzelt(yol)),
    icerik: (yol) => dosyalar.get(yolDuzelt(yol)) ?? null,
    dosyalar: () => Object.fromEntries(dosyalar),
    dizinler: () => [...dizinler],
    hataVer: (islem, hata) => {
      const l = hatalar.get(islem) ?? [];
      l.push(hata);
      hatalar.set(islem, l);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Günlük dosyası ve Gunluk
// ---------------------------------------------------------------------------------------------

export interface SahteKayit extends KayitPortu {
  cagrilar: CagriDefteri;
  satirlar: string[];
  dondurmeler: number[];
  /** `boyut()` bu değeri verir; `null`: satırların bayt toplamı. */
  boyutuZorla(bayt: number | null): void;
}

export function sahteKayit(): SahteKayit {
  const cagrilar = new CagriDefteri();
  const satirlar: string[] = [];
  const dondurmeler: number[] = [];
  let zorla: number | null = null;
  return {
    cagrilar,
    satirlar,
    dondurmeler,
    satirEkle: (s) => {
      cagrilar.ekle("satirEkle", s);
      satirlar.push(s);
    },
    boyut: () => {
      cagrilar.ekle("boyut");
      return zorla ?? satirlar.reduce((t, s) => t + Buffer.byteLength(s) + 1, 0);
    },
    dondur: (azamiDosya) => {
      cagrilar.ekle("dondur", azamiDosya);
      dondurmeler.push(azamiDosya);
    },
    boyutuZorla: (b) => {
      zorla = b;
    },
  };
}

export interface GunlukGirdisi {
  seviye: "bilgi" | "uyari" | "hata";
  modul: string;
  olay: string;
  alanlar: GunlukAlanlari | undefined;
}

export interface SahteGunluk extends Gunluk {
  girdiler: GunlukGirdisi[];
  /** Verilen `olay` adıyla yazılanlar (isteğe bağlı seviye). */
  bul(olay: string, seviye?: GunlukGirdisi["seviye"]): GunlukGirdisi[];
}

export function sahteGunluk(): SahteGunluk {
  const girdiler: GunlukGirdisi[] = [];
  const yaz = (seviye: GunlukGirdisi["seviye"]) => (modul: string, olay: string, alanlar?: GunlukAlanlari) => {
    girdiler.push({ seviye, modul, olay, alanlar });
  };
  return {
    girdiler,
    bilgi: yaz("bilgi"),
    uyari: yaz("uyari"),
    hata: yaz("hata"),
    bul: (olay, seviye) => girdiler.filter((g) => g.olay === olay && (seviye === undefined || g.seviye === seviye)),
  };
}

// ---------------------------------------------------------------------------------------------
// Süreç
// ---------------------------------------------------------------------------------------------

export interface SahteBoruluSurec extends BoruluSurec {
  readonly istek: BoruluSurecIstegi;
  /** `satirYaz` ile yazılanlar (sonlandırıcısız, çağrıldığı gibi). */
  readonly yazilanlar: string[];
  readonly stdinKapandi: boolean;
  /** `cik` çağrılana dek `null`. */
  readonly cikisKodu: number | null;
  readonly canli: boolean;
  /** Test beslemesi: süreç stdout'a bir satır yazdı. */
  stdoutSatiriGonder(satir: string): void;
  stderrParcasiGonder(parca: string): void;
  /** Süreç kendiliğinden çıktı. İkinci çağrı etkisiz. */
  cik(kod: number): void;
  /** `true`: `satirYaz` bundan sonra `false` döner (kırık boru). */
  boruyuKir(): void;
}

export interface SahteAyrikSurec extends AyrikSurec {
  readonly istek: AyrikSurecIstegi;
  readonly canli: boolean;
  readonly cikisKodu: number | null;
  cik(kod: number): void;
}

export type BaslatmaKaydi =
  | { tur: "borulu"; istek: BoruluSurecIstegi; surec: SahteBoruluSurec }
  | { tur: "ayrik"; istek: AyrikSurecIstegi; surec: SahteAyrikSurec };

export interface AracKaydi {
  istek: AracIstegi;
}

export type AracCevabi = AracSonucu | Error | ((istek: AracIstegi) => AracSonucu | Error);

export interface OldurmeKaydi {
  tur: "agac" | "tek";
  pid: number;
}

export interface SahteSurec extends SurecPortu {
  cagrilar: CagriDefteri;
  baslatmalar: BaslatmaKaydi[];
  araclar: AracKaydi[];
  oldurmalar: OldurmeKaydi[];
  /** Hizmet sürecinin kendi PID'i: başlatılanların `ppid`'i. */
  readonly servisPid: number;
  borulular(): SahteBoruluSurec[];
  ayriklar(): SahteAyrikSurec[];
  sonBorulu(): SahteBoruluSurec;
  sonAyrik(): SahteAyrikSurec;
  /** Dışarıdan var olan bir süreç ekler (yetim, torun...). `olusturmaMs` verilmezse saat. */
  surecEkle(k: { pid: number; ppid?: number; ad?: string; olusturmaMs?: number }): SurecKaydi;
  /** Süreç tablosundan düşer, kimseye haber vermez (ölü sayılır). */
  surecSil(pid: number): void;
  /** Başlatılan süreçlere sıradaki PID. */
  sonrakiPid(pid: number): void;
  /** Sıradaki `boruluBaslat`/`ayrikBaslat` bir kez atar. */
  sonrakiBaslatmaHatasi(hata: Error): void;
  /** `aracCalistir` cevabı: sabit ya da işlev; kuyruk sırasıyla bir kez, bitince `varsayilan`. */
  aracCevabiKuyruga(c: AracCevabi): void;
  aracVarsayilani(c: AracCevabi): void;
}

export function sahteSurec(zaman: SahteZaman, servisPid = 4000): SahteSurec {
  interface Girdi {
    kayit: SurecKaydi;
    canli: boolean;
    cikisDinleyicileri: Array<() => void>;
    olum: (kod: number) => void;
  }
  const tablo = new Map<number, Girdi>();
  const cagrilar = new CagriDefteri();
  const baslatmalar: BaslatmaKaydi[] = [];
  const araclar: AracKaydi[] = [];
  const oldurmalar: OldurmeKaydi[] = [];
  let pidSayaci = 5000;
  let baslatmaHatasi: Error | null = null;
  const aracKuyrugu: AracCevabi[] = [];
  let aracVarsayilan: AracCevabi = { zamanAsimi: false, stdout: "", stderr: "" };

  const yeniPid = (): number => pidSayaci++;
  const ekleKayit = (pid: number, ppid: number, ad: string, olusturmaMs: number): Girdi => {
    const g: Girdi = {
      kayit: { pid, ppid, ad, olusturmaMs },
      canli: true,
      cikisDinleyicileri: [],
      olum: () => {},
    };
    tablo.set(pid, g);
    return g;
  };
  const oldur = (pid: number, kod: number): void => {
    const g = tablo.get(pid);
    if (!g || !g.canli) return;
    g.canli = false;
    tablo.delete(pid);
    g.olum(kod);
    for (const f of g.cikisDinleyicileri) f();
  };
  const cocuklar = (pid: number): number[] => [...tablo.values()].filter((g) => g.kayit.ppid === pid).map((g) => g.kayit.pid);
  const agacOldur = (pid: number): void => {
    for (const c of cocuklar(pid)) agacOldur(c);
    oldur(pid, 1);
  };

  const cikisDinleyici = (g: Girdi, f: () => void): void => {
    if (!g.canli) f();
    else g.cikisDinleyicileri.push(f);
  };

  const hataKontrol = (): void => {
    if (baslatmaHatasi) {
      const h = baslatmaHatasi;
      baslatmaHatasi = null;
      throw h;
    }
  };

  const surec: SahteSurec = {
    cagrilar,
    baslatmalar,
    araclar,
    oldurmalar,
    servisPid,
    boruluBaslat: async (istek) => {
      cagrilar.ekle("boruluBaslat", istek);
      hataKontrol();
      const pid = yeniPid();
      const olusturmaMs = zaman.simdi();
      const g = ekleKayit(pid, servisPid, "claude.exe", olusturmaMs);
      const stdout: Array<(s: string) => void> = [];
      const stderr: Array<(s: string) => void> = [];
      const yazilanlar: string[] = [];
      let stdinKapandi = false;
      let kirik = false;
      let cikisKodu: number | null = null;
      g.olum = (kod) => {
        cikisKodu = kod;
      };
      const s: SahteBoruluSurec = {
        pid,
        olusturmaMs,
        istek,
        yazilanlar,
        get stdinKapandi() {
          return stdinKapandi;
        },
        get cikisKodu() {
          return cikisKodu;
        },
        get canli() {
          return g.canli;
        },
        satirYaz: (satir) => {
          if (kirik || stdinKapandi || !g.canli) return false;
          yazilanlar.push(satir);
          return true;
        },
        stdinKapat: () => {
          stdinKapandi = true;
        },
        stdoutSatirDinle: (f) => void stdout.push(f),
        stderrDinle: (f) => void stderr.push(f),
        cikisDinle: (f) => cikisDinleyici(g, f),
        stdoutSatiriGonder: (satir) => {
          for (const f of [...stdout]) f(satir);
        },
        stderrParcasiGonder: (parca) => {
          for (const f of [...stderr]) f(parca);
        },
        cik: (kod) => oldur(pid, kod),
        boruyuKir: () => {
          kirik = true;
        },
      };
      baslatmalar.push({ tur: "borulu", istek, surec: s });
      return s;
    },
    ayrikBaslat: async (istek) => {
      cagrilar.ekle("ayrikBaslat", istek);
      hataKontrol();
      const pid = yeniPid();
      const olusturmaMs = zaman.simdi();
      const g = ekleKayit(pid, servisPid, "claude.exe", olusturmaMs);
      let cikisKodu: number | null = null;
      g.olum = (kod) => {
        cikisKodu = kod;
      };
      const s: SahteAyrikSurec = {
        pid,
        olusturmaMs,
        istek,
        get canli() {
          return g.canli;
        },
        get cikisKodu() {
          return cikisKodu;
        },
        cikisDinle: (f) => cikisDinleyici(g, f),
        cik: (kod) => oldur(pid, kod),
      };
      baslatmalar.push({ tur: "ayrik", istek, surec: s });
      return s;
    },
    aracCalistir: async (istek) => {
      cagrilar.ekle("aracCalistir", istek);
      araclar.push({ istek });
      const c = aracKuyrugu.shift() ?? aracVarsayilan;
      const sonuc = typeof c === "function" ? c(istek) : c;
      if (sonuc instanceof Error) throw sonuc;
      return sonuc;
    },
    anlikGoruntu: async () => {
      cagrilar.ekle("anlikGoruntu");
      return [...tablo.values()].map((g) => ({ ...g.kayit }));
    },
    surecVarMi: async (kimlik: SurecKimligi) => {
      cagrilar.ekle("surecVarMi", kimlik);
      const g = tablo.get(kimlik.pid);
      return g !== undefined && Math.abs(g.kayit.olusturmaMs - kimlik.olusturmaMs) <= 1000;
    },
    agaciOldur: async (pid) => {
      cagrilar.ekle("agaciOldur", pid);
      oldurmalar.push({ tur: "agac", pid });
      agacOldur(pid);
    },
    tekOldur: async (pid) => {
      cagrilar.ekle("tekOldur", pid);
      oldurmalar.push({ tur: "tek", pid });
      oldur(pid, 1);
    },
    borulular: () => baslatmalar.flatMap((b) => (b.tur === "borulu" ? [b.surec] : [])),
    ayriklar: () => baslatmalar.flatMap((b) => (b.tur === "ayrik" ? [b.surec] : [])),
    sonBorulu: () => {
      const l = surec.borulular();
      const s = l[l.length - 1];
      if (!s) throw new Error("sahte: boruluBaslat hiç çağrılmadı");
      return s;
    },
    sonAyrik: () => {
      const l = surec.ayriklar();
      const s = l[l.length - 1];
      if (!s) throw new Error("sahte: ayrikBaslat hiç çağrılmadı");
      return s;
    },
    surecEkle: (k) => {
      const g = ekleKayit(k.pid, k.ppid ?? 1, k.ad ?? "node.exe", k.olusturmaMs ?? zaman.simdi());
      return { ...g.kayit };
    },
    surecSil: (pid) => void tablo.delete(pid),
    sonrakiPid: (pid) => {
      pidSayaci = pid;
    },
    sonrakiBaslatmaHatasi: (h) => {
      baslatmaHatasi = h;
    },
    aracCevabiKuyruga: (c) => void aracKuyrugu.push(c),
    aracVarsayilani: (c) => {
      aracVarsayilan = c;
    },
  };
  return surec;
}

// ---------------------------------------------------------------------------------------------
// Sistem, http, anahtar, tekil kilit
// ---------------------------------------------------------------------------------------------

export interface SahteSistem extends SistemPortu {
  cagrilar: CagriDefteri;
  ram: RamOkumasi;
  tailscale: string | null;
  masaustu: MasaustuDurumu;
}

export function sahteSistem(): SahteSistem {
  const cagrilar = new CagriDefteri();
  const s: SahteSistem = {
    cagrilar,
    ram: { bosMb: 8000, toplamMb: 16000 },
    tailscale: "100.64.0.10",
    masaustu: "bagli",
    ramOku: () => {
      cagrilar.ekle("ramOku");
      return { ...s.ram };
    },
    tailscaleAdresi: () => {
      cagrilar.ekle("tailscaleAdresi");
      return s.tailscale;
    },
    masaustuDurumu: async () => {
      cagrilar.ekle("masaustuDurumu");
      return s.masaustu;
    },
  };
  return s;
}

export interface HttpIstegi {
  url: string;
  govde: unknown;
  zamanAsimiMs: number;
}

export interface SahteHttp extends HttpPortu {
  cagrilar: CagriDefteri;
  istekler: HttpIstegi[];
  /** Sıradaki cevap durumu (bir kez); bitince `varsayilanDurum`. */
  durumKuyruga(durum: number): void;
  varsayilanDurum: number;
  /** Sıradaki çağrı ağ hatasıyla atar (bir kez). */
  hataVer(hata: Error): void;
}

export function sahteHttp(): SahteHttp {
  const cagrilar = new CagriDefteri();
  const istekler: HttpIstegi[] = [];
  const kuyruk: Array<number | Error> = [];
  const h: SahteHttp = {
    cagrilar,
    istekler,
    varsayilanDurum: 200,
    durumKuyruga: (d) => void kuyruk.push(d),
    hataVer: (e) => void kuyruk.push(e),
    postJson: async (url, govde, zamanAsimiMs) => {
      cagrilar.ekle("postJson", url, govde, zamanAsimiMs);
      istekler.push({ url, govde, zamanAsimiMs });
      const c = kuyruk.shift() ?? h.varsayilanDurum;
      if (c instanceof Error) throw c;
      return { durum: c };
    },
  };
  return h;
}

export interface SahteAnahtar extends AnahtarPortu {
  cagrilar: CagriDefteri;
}

/** Gerçek şifreleme yok: imza, (açık anahtar, metin) ikilisinden türeyen belirli bir metindir. */
export function sahteAnahtar(acikAnahtar = Buffer.from("sahte-acik-anahtar").toString("base64")): SahteAnahtar {
  const cagrilar = new CagriDefteri();
  const imza = (acik: string, metin: string): string => Buffer.from(`imza|${acik}|${metin}`).toString("base64");
  return {
    cagrilar,
    acikAnahtar: () => {
      cagrilar.ekle("acikAnahtar");
      return acikAnahtar;
    },
    imzala: (metin) => {
      cagrilar.ekle("imzala", metin);
      return imza(acikAnahtar, metin);
    },
    dogrula: (acik, metin, i) => {
      cagrilar.ekle("dogrula", acik, metin, i);
      return i === imza(acik, metin);
    },
    sabitZamanEsit: (a, b) => {
      cagrilar.ekle("sabitZamanEsit", a, b);
      return a === b;
    },
  };
}

export interface SahteTekilKilit extends TekilKilitPortu {
  cagrilar: CagriDefteri;
  /** `al()` bunu döner. */
  alinabilir: boolean;
}

export function sahteTekilKilit(): SahteTekilKilit {
  const cagrilar = new CagriDefteri();
  const k: SahteTekilKilit = {
    cagrilar,
    alinabilir: true,
    al: async () => {
      cagrilar.ekle("al");
      return k.alinabilir;
    },
  };
  return k;
}

// ---------------------------------------------------------------------------------------------
// WebSocket ve boru sunucuları
// ---------------------------------------------------------------------------------------------

export interface SahteWsBaglantisi extends WsBaglantisi {
  /** `gonder` ile giden metinler. */
  readonly gonderilenler: string[];
  /** `kapat` ile verilen kod ve neden; kapanmadıysa `null`. */
  readonly kapanis: { kod: number; neden: string } | null;
  /** Test beslemesi: istemci metin yolladı. */
  mesajGonder(metin: string): void;
  /** Karşı taraf kopardı: `kapanisDinle` dinleyicileri çağrılır. */
  istemciKopar(): void;
  /** `kimlikDogrulandi` çağrıldı mı (kimlik öncesi bayt sınırı kalktı mı). */
  readonly kimlikDogrulandiMi: boolean;
}

export interface SahteWs extends WsSunucuPortu {
  cagrilar: CagriDefteri;
  /** Son `dinle` isteği (host, port, azamiCerceve). */
  istek(): WsSunucuIstegi | null;
  readonly kapatildi: boolean;
  /**
   * Yeni bağlantı açar ve sunucunun `baglanti` işleyicisini çağırır. `yetenekler`: adres sorgusunda
   * bildirilmiş jetonlar (gerçekte `dis-dunya` ayrıştırır); verilmezse boş küme (eski istemci).
   */
  baglan(yol: WsYolu, uzakIp?: string, yetenekler?: Iterable<string>): SahteWsBaglantisi;
  /** Sıradaki `dinle` atar (bir kez). */
  sonrakiDinlemeHatasi(hata: Error): void;
}

export function sahteWs(): SahteWs {
  const cagrilar = new CagriDefteri();
  let istek: WsSunucuIstegi | null = null;
  let kapatildi = false;
  let dinlemeHatasi: Error | null = null;
  return {
    cagrilar,
    get kapatildi() {
      return kapatildi;
    },
    istek: () => istek,
    sonrakiDinlemeHatasi: (h) => {
      dinlemeHatasi = h;
    },
    dinle: async (i): Promise<KapatilabilirSunucu> => {
      cagrilar.ekle("dinle", i);
      if (dinlemeHatasi) {
        const h = dinlemeHatasi;
        dinlemeHatasi = null;
        throw h;
      }
      istek = i;
      kapatildi = false;
      return {
        kapat: async () => {
          cagrilar.ekle("sunucuKapat");
          kapatildi = true;
        },
      };
    },
    baglan: (yol, uzakIp = "100.64.0.20", yetenekler = []) => {
      if (!istek) throw new Error("sahte ws: dinle çağrılmadı");
      const mesajlar: Array<(m: string) => void> = [];
      const kapanislar: Array<() => void> = [];
      const gonderilenler: string[] = [];
      let kapanis: { kod: number; neden: string } | null = null;
      let kimlikDogrulandiMi = false;
      const kapanisYay = (): void => {
        for (const f of [...kapanislar]) f();
      };
      const b: SahteWsBaglantisi = {
        yol,
        uzakIp,
        yetenekler: new Set(yetenekler),
        gonderilenler,
        get kapanis() {
          return kapanis;
        },
        get kimlikDogrulandiMi() {
          return kimlikDogrulandiMi;
        },
        kimlikDogrulandi: () => {
          kimlikDogrulandiMi = true;
        },
        gonder: (m) => {
          if (kapanis === null) gonderilenler.push(m);
        },
        kapat: (kod, neden) => {
          if (kapanis !== null) return;
          kapanis = { kod, neden };
          kapanisYay();
        },
        mesajDinle: (f) => void mesajlar.push(f),
        kapanisDinle: (f) => void kapanislar.push(f),
        mesajGonder: (m) => {
          if (kapanis !== null) return;
          for (const f of [...mesajlar]) f(m);
        },
        istemciKopar: () => {
          if (kapanis !== null) return;
          kapanis = { kod: 1006, neden: "" };
          kapanisYay();
        },
      };
      istek.baglanti(b);
      return b;
    },
  };
}

export interface SahteBoruBaglantisi extends BoruBaglantisi {
  /** `satirYaz` ile giden satırlar. */
  readonly yazilanlar: string[];
  readonly kapandi: boolean;
  /** Test beslemesi: istemci satır yolladı. `azamiSatir` aşılırsa gerçek gibi kapatır, iletmez. */
  satirGonder(satir: string): void;
  istemciKopar(): void;
}

/**
 * Ajanda dalgası: aynı port birden çok adlı boruyu dinleyebilir (`eren` ve `eren-ajanda`). Ad verilmeyen
 * yardımcılar en son `dinle`'ye bakar (eski kullanım aynen çalışır); ad verilen o borunun isteğine.
 */
export interface SahteBoru extends BoruSunucuPortu {
  cagrilar: CagriDefteri;
  /** `ad` yoksa en son dinlenen borunun isteği; varsa o adın son isteği. */
  istek(ad?: string): BoruSunucuIstegi | null;
  /** En son dinlenen boru kapatıldı mı. */
  readonly kapatildi: boolean;
  /** Ajanda dalgası: o adlı boru kapatıldı mı (hiç dinlenmediyse `false`). */
  kapatildiMi(ad: string): boolean;
  /** `ad` yoksa en son dinlenen boruya, varsa o adlıya bağlanır. Dinlenmemişse atar. */
  baglan(ad?: string): SahteBoruBaglantisi;
  sonrakiDinlemeHatasi(hata: Error): void;
}

export function sahteBoru(): SahteBoru {
  const cagrilar = new CagriDefteri();
  const istekler = new Map<string, BoruSunucuIstegi>();
  const kapatilanlar = new Set<string>();
  let son: BoruSunucuIstegi | null = null;
  let dinlemeHatasi: Error | null = null;
  return {
    cagrilar,
    get kapatildi() {
      return son !== null && kapatilanlar.has(son.ad);
    },
    kapatildiMi: (ad) => kapatilanlar.has(ad),
    istek: (ad) => (ad === undefined ? son : (istekler.get(ad) ?? null)),
    sonrakiDinlemeHatasi: (h) => {
      dinlemeHatasi = h;
    },
    dinle: async (i): Promise<KapatilabilirSunucu> => {
      cagrilar.ekle("dinle", i);
      if (dinlemeHatasi) {
        const h = dinlemeHatasi;
        dinlemeHatasi = null;
        throw h;
      }
      istekler.set(i.ad, i);
      son = i;
      kapatilanlar.delete(i.ad);
      return {
        kapat: async () => {
          cagrilar.ekle("sunucuKapat", i.ad);
          kapatilanlar.add(i.ad);
        },
      };
    },
    baglan: (ad) => {
      const istek = ad === undefined ? son : (istekler.get(ad) ?? null);
      if (!istek) throw new Error(`sahte boru: dinle çağrılmadı${ad === undefined ? "" : ` (${ad})`}`);
      const azamiSatir = istek.azamiSatir;
      const satirlar: Array<(s: string) => void> = [];
      const kapanislar: Array<() => void> = [];
      const yazilanlar: string[] = [];
      let kapandi = false;
      const kapat = (): void => {
        if (kapandi) return;
        kapandi = true;
        for (const f of [...kapanislar]) f();
      };
      const b: SahteBoruBaglantisi = {
        yazilanlar,
        get kapandi() {
          return kapandi;
        },
        satirYaz: (s) => {
          if (!kapandi) yazilanlar.push(s);
        },
        kapat,
        satirDinle: (f) => void satirlar.push(f),
        kapanisDinle: (f) => void kapanislar.push(f),
        satirGonder: (s) => {
          if (kapandi) return;
          if (s.length > azamiSatir) {
            kapat();
            return;
          }
          for (const f of [...satirlar]) f(s);
        },
        istemciKopar: kapat,
      };
      istek.baglanti(b);
      return b;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Transkript silme (Dilim 1)
// ---------------------------------------------------------------------------------------------

const UUID_BICIMI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TranskriptSonucu = TranskriptSilmeSonucu | ((oturum: string) => Partial<TranskriptSilmeSonucu>);

export interface SahteTranskript extends TranskriptPortu {
  cagrilar: CagriDefteri;
  /** Her `sil` çağrısının aldığı oturum listesi (UUID olmayanlar dahil, çağrıldığı gibi). */
  silinenIstekler: Array<readonly string[]>;
  /** UUID olarak kabul edilip "silinen" sayılan oturumlar (tüm çağrılar, sırayla). */
  silinenOturumlar: string[];
  /** Sıradaki `sil` için sonuç (bir kez, aynen döner) ya da işlev. İşlev UUID'li her oturum için kısmi sayı döner. */
  sonrakiSonuc(s: TranskriptSonucu): void;
  /** Sıradaki `sil` çağrısını (portun "hiç atmaz" sözüne rağmen) hatayla düşürmek için. */
  sonrakiHata(hata: Error): void;
  /** Kuyruk boşken UUID'li her oturumun sonucu. Varsayılan: `{ silinen: 1 }`. */
  varsayilan: Partial<TranskriptSilmeSonucu>;
}

export function sahteTranskript(): SahteTranskript {
  const cagrilar = new CagriDefteri();
  const kuyruk: TranskriptSonucu[] = [];
  const hatalar: Error[] = [];
  const t: SahteTranskript = {
    cagrilar,
    silinenIstekler: [],
    silinenOturumlar: [],
    varsayilan: { silinen: 1 },
    sonrakiSonuc: (s) => void kuyruk.push(s),
    sonrakiHata: (h) => void hatalar.push(h),
    sil: async (oturumlar) => {
      cagrilar.ekle("sil", oturumlar);
      t.silinenIstekler.push([...oturumlar]);
      const h = hatalar.shift();
      if (h) throw h;
      const c = kuyruk.shift();
      const sonuc: TranskriptSilmeSonucu = { silinen: 0, bulunamayan: 0, silinemeyen: 0, reddedilen: 0 };
      if (c !== undefined && typeof c !== "function") {
        const gecerli = oturumlar.filter((o) => UUID_BICIMI.test(o));
        t.silinenOturumlar.push(...gecerli);
        return { ...c };
      }
      for (const o of oturumlar) {
        if (!UUID_BICIMI.test(o)) {
          sonuc.reddedilen++;
          continue;
        }
        const k = { silinen: 0, bulunamayan: 0, silinemeyen: 0, ...(c ? c(o) : t.varsayilan) };
        sonuc.silinen += k.silinen;
        sonuc.bulunamayan += k.bulunamayan;
        sonuc.silinemeyen += k.silinemeyen;
        if (k.silinen > 0) t.silinenOturumlar.push(o);
      }
      return sonuc;
    },
  };
  return t;
}

// ---------------------------------------------------------------------------------------------
// Süreç kapısı (Dilim 2)
// ---------------------------------------------------------------------------------------------

type KapiSohbeti = SohbetSecimi["sohbet_id"];

export interface SahteKapi extends SurecKapisi {
  cagrilar: CagriDefteri;
  /** Her `yuvaIste` çağrısının sohbeti (yinelenenler dahil), sırayla. */
  istekler: KapiSohbeti[];
  /** Her `yuvaBirak` çağrısının sohbeti (tutmayanlar dahil), sırayla. */
  birakmalar: KapiSohbeti[];
  /** `devirSerbestMi` çağrı sayısı. */
  devirSorulari: number;
  /** Yeni yuva isteklerine verilecek cevap. Varsayılan `true`. Zaten tutulan yuva etkilenmez. */
  izin(izinli: boolean): void;
  /** `devirSerbestMi` cevabı. Varsayılan `true`. */
  devirIzni(izinli: boolean): void;
  /** Şu an yuva tutan sohbetler (ayrılma sırasıyla). */
  yuvadakiler(): KapiSohbeti[];
}

export function sahteKapi(): SahteKapi {
  const cagrilar = new CagriDefteri();
  const tutulan = new Set<KapiSohbeti>();
  let izinli = true;
  let devirli = true;
  const k: SahteKapi = {
    cagrilar,
    istekler: [],
    birakmalar: [],
    devirSorulari: 0,
    izin: (b) => {
      izinli = b;
    },
    devirIzni: (b) => {
      devirli = b;
    },
    yuvadakiler: () => [...tutulan],
    yuvaIste: (sohbet) => {
      cagrilar.ekle("yuvaIste", sohbet.sohbet_id);
      k.istekler.push(sohbet.sohbet_id);
      if (tutulan.has(sohbet.sohbet_id)) return true;
      if (!izinli) return false;
      tutulan.add(sohbet.sohbet_id);
      return true;
    },
    devirSerbestMi: () => {
      cagrilar.ekle("devirSerbestMi");
      k.devirSorulari++;
      return devirli;
    },
    yuvaBirak: (sohbet) => {
      cagrilar.ekle("yuvaBirak", sohbet.sohbet_id);
      k.birakmalar.push(sohbet.sohbet_id);
      tutulan.delete(sohbet.sohbet_id);
    },
  };
  return k;
}

// ---------------------------------------------------------------------------------------------
// Takvim (ajanda dalgası): sabit ofsetli dilimler, yaz saati yok
// ---------------------------------------------------------------------------------------------

/** Sahtenin bildiği dilimler ve UTC'den ofsetleri (dakika). Yaz saati sınamaları gerçek `takvim.ts`'tedir. */
export const SAHTE_DILIMLER: Readonly<Record<string, number>> = {
  "Europe/Istanbul": 180,
  UTC: 0,
  "Etc/UTC": 0,
  "Asia/Tokyo": 540,
  "America/Sao_Paulo": -180,
};

export interface SahteTakvim extends TakvimPortu {
  cagrilar: CagriDefteri;
  /** `kullaniciDilimi()`'nin döndüğü dilim; test değiştirebilir (kullanıcının dilimi değişti). */
  dilim: string;
  /** Bilinen dilimler (ad → dakika ofseti); test ekleyebilir. */
  readonly ofsetler: Map<string, number>;
}

const iki = (n: number): string => String(n).padStart(2, "0");

/**
 * `TakvimPortu` sahtesi. `yerelAn` saniyeyi keser; `anCevir` `YYYY-AA-GG` + `SS:DD` ister. Bilinmeyen
 * dilimde (ya da bozuk tarih/saatte) iki işlev de atar, `dilimBiliniyorMu` `false` döner.
 */
export function sahteTakvim(dilim = "Europe/Istanbul", ofsetler: Readonly<Record<string, number>> = SAHTE_DILIMLER): SahteTakvim {
  const cagrilar = new CagriDefteri();
  const harita = new Map(Object.entries(ofsetler));
  const ofset = (ad: string): number => {
    const o = harita.get(ad);
    if (o === undefined) throw new RangeError(`sahte takvim: bilinmeyen dilim ${ad}`);
    return o;
  };
  const t: SahteTakvim = {
    cagrilar,
    dilim,
    ofsetler: harita,
    kullaniciDilimi: () => {
      cagrilar.ekle("kullaniciDilimi");
      return t.dilim;
    },
    dilimBiliniyorMu: (ad) => {
      cagrilar.ekle("dilimBiliniyorMu", ad);
      return harita.has(ad);
    },
    yerelAn: (ms, saat_dilimi) => {
      cagrilar.ekle("yerelAn", ms, saat_dilimi);
      const d = new Date(Math.floor(ms / 60_000) * 60_000 + ofset(saat_dilimi) * 60_000);
      return {
        tarih: `${String(d.getUTCFullYear()).padStart(4, "0")}-${iki(d.getUTCMonth() + 1)}-${iki(d.getUTCDate())}`,
        saat: `${iki(d.getUTCHours())}:${iki(d.getUTCMinutes())}`,
        saat_dilimi,
      };
    },
    anCevir: (tarih, saat, saat_dilimi) => {
      cagrilar.ekle("anCevir", tarih, saat, saat_dilimi);
      const g = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tarih);
      const s = /^(\d{2}):(\d{2})$/.exec(saat);
      if (g === null || s === null) throw new RangeError("sahte takvim: bozuk tarih ya da saat");
      const utc = Date.UTC(Number(g[1]), Number(g[2]) - 1, Number(g[3]), Number(s[1]), Number(s[2]));
      return utc - ofset(saat_dilimi) * 60_000;
    },
  };
  return t;
}

// ---------------------------------------------------------------------------------------------
// Medya dalgası: ayar, dosya portu, işleyici, yönetici yüzü
// ---------------------------------------------------------------------------------------------

/** `MedyaServisSinirlari`'nın test değerleri: MODULLER.md "Medya dalgası" > S8'deki sabitlerle aynı. */
export const SAHTE_MEDYA_SINIRLARI: MedyaServisSinirlari = {
  yarimOmurMs: 24 * 3_600_000,
  islemeAzamiMs: 600_000,
  gorselNesilSiniri: 60,
  dokumMetni: 20_000,
  gorselUzunKenar: 1568,
  gorselPiksel: 1_150_000,
  gorselAzamiBayt: 3_750_000,
  kareUzunKenar: 768,
  kareEnAz: 3,
  kareEnCok: 8,
  kareAraligiMs: 10_000,
  videoSurePayi: 0.1,
  olcumZamanAsimiMs: 30_000,
  gorselZamanAsimiMs: 30_000,
  kareZamanAsimiMs: 30_000,
  dokumZamanAsimiEnAzMs: 120_000,
  dokumZamanAsimiKat: 3,
  supurmeAraligiMs: 600_000,
};

/** Sahte veri kökü (kişisel yol yok). `sahteMedyaAyari().kok` bunun `\medya`'sıdır. */
export const SAHTE_VERI_KOKU = "C:\\ornek\\eren-kit";

/** Medya açık bir `MedyaAyari`; `ust` alanları üzerine yazar. */
export function sahteMedyaAyari(ust: Partial<MedyaAyari> = {}): MedyaAyari {
  return {
    kok: `${SAHTE_VERI_KOKU}\\medya`,
    ffmpeg: "C:\\ornek\\ffmpeg\\bin\\ffmpeg.exe",
    ffprobe: "C:\\ornek\\ffmpeg\\bin\\ffprobe.exe",
    dokumModeli: "modeller/ggml-large-v3-turbo-q5_0.bin",
    dokumVadModeli: null,
    dokumDili: "auto",
    kotaBayt: 10240 * 1024 * 1024,
    sinirlar: SAHTE_MEDYA_SINIRLARI,
    ...ust,
  };
}

export const SAHTE_MEDYA_BICIMLERI: readonly MedyaBicimi[] = ["jpg", "png", "webp", "heic", "mp4", "mov", "3gp", "webm"];
const KARE_SIRALARI: readonly KareSirasi[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** `MedyaDosyaAdi`'nın çalışma anı listesi: sahte port da gerçeği gibi listede olmayan adı reddeder. */
export const SAHTE_MEDYA_DOSYA_ADLARI: ReadonlySet<string> = new Set<string>([
  ...SAHTE_MEDYA_BICIMLERI.map((b) => `asil.${b}`),
  "gorsel.jpg",
  ...KARE_SIRALARI.map((i) => `kare-0${i}.jpg`),
  "dokum.srt",
  "dokum.txt",
]);

const FOTO_BICIMLERI: ReadonlySet<MedyaBicimi> = new Set<MedyaBicimi>(["jpg", "png", "webp", "heic"]);
const bicimTuru = (b: MedyaBicimi): MedyaTuru => (FOTO_BICIMLERI.has(b) ? "foto" : "video");

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
/** Biçim başına baş baytlar (tasarım 2.4 koklama tablosu); `sahteMedyaBaytlari` ve sahte `kokla` bunu kullanır. */
const BAS_BAYTLARI: Readonly<Record<MedyaBicimi, readonly number[]>> = {
  jpg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")],
  heic: [0, 0, 0, 0x18, ...ascii("ftypheic")],
  mp4: [0, 0, 0, 0x18, ...ascii("ftypisom")],
  mov: [0, 0, 0, 0x14, ...ascii("ftypqt  ")],
  "3gp": [0, 0, 0, 0x18, ...ascii("ftyp3gp4")],
  webm: [0x1a, 0x45, 0xdf, 0xa3],
};

/** `boyut` baytlık içerik: başı biçimin baş baytları, gerisi sabit dolgu (`0x2a`). */
export function sahteMedyaBaytlari(bicim: MedyaBicimi, boyut: number): Uint8Array {
  const b = new Uint8Array(boyut).fill(0x2a);
  b.set(BAS_BAYTLARI[bicim].slice(0, boyut));
  return b;
}

const FTYP_MARKALARI: Readonly<Record<string, MedyaBicimi>> = {
  heic: "heic",
  heix: "heic",
  mif1: "heic",
  msf1: "heic",
  isom: "mp4",
  iso2: "mp4",
  mp41: "mp4",
  mp42: "mp4",
  avc1: "mp4",
  "qt  ": "mov",
  "3gp4": "3gp",
  "3gp5": "3gp",
  "3gp6": "3gp",
};

/** Tasarım 2.4'teki koklama tablosunun sahte karşılığı. Gerçek tablo S3a'nındır; bu yalnız test içindir. */
function sahteKokla(bas: Uint8Array): MedyaBicimi | null {
  const m = (i: number, d: readonly number[]): boolean => d.every((x, k) => bas[i + k] === x);
  const metin = (i: number, n: number): string => String.fromCharCode(...bas.slice(i, i + n));
  if (m(0, [0xff, 0xd8, 0xff])) return "jpg";
  if (m(0, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (bas.length >= 12 && metin(0, 4) === "RIFF" && metin(8, 4) === "WEBP") return "webp";
  if (bas.length >= 12 && metin(4, 4) === "ftyp") return FTYP_MARKALARI[metin(8, 4)] ?? null;
  if (m(0, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  return null;
}

export type MedyaDosyaIslemi =
  | "parcaEkle"
  | "parcaBoyutu"
  | "parcaOku"
  | "parcaSil"
  | "tasi"
  | "parcalar"
  | "boyut"
  | "oku"
  | "yaz"
  | "dizinSil"
  | "dizinler";

export interface SahteMedyaDosya extends MedyaDosyaPortu {
  cagrilar: CagriDefteri;
  readonly kok: string;
  /** Testten `gelen\<no>.part` koyar (portu çağırmaz, kaydetmez). */
  parcaKoy(no: number, bayt: Uint8Array): void;
  /** `.part` içeriği; yoksa `null`. */
  parcaIcerigi(no: number): Uint8Array | null;
  /** Testten dizine dosya koyar, dizini de kurar (portu çağırmaz). Metin UTF-8 yazılır. */
  koy(no: number, ad: MedyaDosyaAdi, icerik: Uint8Array | string): void;
  /** Dosya içeriği; yoksa `null`. */
  icerik(no: number, ad: MedyaDosyaAdi): Uint8Array | null;
  /** Testten boş dizin kurar (sahipsiz dizin süpürmesi için). */
  dizinKoy(no: number): void;
  dizinVarMi(no: number): boolean;
  /** Dizindeki dosya adları; dizin yoksa boş. */
  dosyaAdlari(no: number): string[];
  /** `true`: `dizinSil(no)` `false` döner ve dokunmaz (Windows kilidi). */
  kilitle(no: number, kilitli?: boolean): void;
  /** Verilen işlemin bir sonraki çağrısı atar (bir kez). `dizinSil` atmaz, `false` döner (port sözü). */
  hataVer(islem: MedyaDosyaIslemi, hata: Error): void;
}

/** Bellek içi `MedyaDosyaPortu`. `no` ve `ad` denetimi gerçeğiyle aynı: geçersizde atar. */
export function sahteMedyaDosya(kok = `${SAHTE_VERI_KOKU}\\medya`): SahteMedyaDosya {
  const cagrilar = new CagriDefteri();
  const parcaHaritasi = new Map<number, Uint8Array>();
  const dizinHaritasi = new Map<number, Map<string, Uint8Array>>();
  const kilitliler = new Set<number>();
  const hatalar = new Map<MedyaDosyaIslemi, Error[]>();
  const enc = new TextEncoder();

  const kontrol = (islem: MedyaDosyaIslemi, ...args: unknown[]): void => {
    cagrilar.ekle(islem, ...args);
    const h = hatalar.get(islem)?.shift();
    if (h) throw h;
  };
  const noDenetle = (no: number): void => {
    if (!Number.isSafeInteger(no) || no <= 0) throw new RangeError(`sahte medya dosya: geçersiz no ${String(no)}`);
  };
  const adDenetle = (ad: string): void => {
    if (!SAHTE_MEDYA_DOSYA_ADLARI.has(ad)) throw new RangeError(`sahte medya dosya: geçersiz ad ${ad}`);
  };
  const dizin = (no: number): Map<string, Uint8Array> => {
    let d = dizinHaritasi.get(no);
    if (d === undefined) {
      d = new Map();
      dizinHaritasi.set(no, d);
    }
    return d;
  };
  const sirali = (l: Iterable<number>): number[] => [...l].sort((a, b) => a - b);

  return {
    cagrilar,
    kok,
    yol: (no, ad) => {
      noDenetle(no);
      adDenetle(ad);
      return `${kok}\\${no}\\${ad}`;
    },
    dizinYolu: (no) => {
      noDenetle(no);
      return `${kok}\\${no}`;
    },
    goreliYol: (no, ad) => {
      noDenetle(no);
      adDenetle(ad);
      return `medya/${no}/${ad}`;
    },
    parcaEkle: async (no, ofset, bayt) => {
      kontrol("parcaEkle", no, ofset, bayt.length);
      noDenetle(no);
      const eski = parcaHaritasi.get(no) ?? new Uint8Array(0);
      if (eski.length !== ofset) throw new Error(`sahte medya dosya: ofset ${ofset}, dosya boyu ${eski.length}`);
      const yeni = new Uint8Array(eski.length + bayt.length);
      yeni.set(eski);
      yeni.set(bayt, eski.length);
      parcaHaritasi.set(no, yeni);
      return yeni.length;
    },
    parcaBoyutu: async (no) => {
      kontrol("parcaBoyutu", no);
      noDenetle(no);
      return parcaHaritasi.get(no)?.length ?? null;
    },
    parcaOku: async (no, ofset, azamiBayt) => {
      kontrol("parcaOku", no, ofset, azamiBayt);
      noDenetle(no);
      return parcaHaritasi.get(no)?.slice(ofset, ofset + azamiBayt) ?? new Uint8Array(0);
    },
    parcaSil: async (no) => {
      kontrol("parcaSil", no);
      noDenetle(no);
      parcaHaritasi.delete(no);
    },
    tasi: async (no, bicim) => {
      kontrol("tasi", no, bicim);
      noDenetle(no);
      const ad = `asil.${bicim}`;
      adDenetle(ad);
      const p = parcaHaritasi.get(no);
      if (p === undefined) throw new Error(`sahte medya dosya: ${no}.part yok`);
      const d = dizin(no);
      if (d.has(ad)) throw new Error(`sahte medya dosya: ${no}\\${ad} zaten var`);
      d.set(ad, p);
      parcaHaritasi.delete(no);
    },
    parcalar: async () => {
      kontrol("parcalar");
      return sirali(parcaHaritasi.keys());
    },
    boyut: async (no, ad) => {
      kontrol("boyut", no, ad);
      noDenetle(no);
      adDenetle(ad);
      return dizinHaritasi.get(no)?.get(ad)?.length ?? null;
    },
    oku: async (no, ad, azamiBayt) => {
      kontrol("oku", no, ad, azamiBayt);
      noDenetle(no);
      adDenetle(ad);
      const b = dizinHaritasi.get(no)?.get(ad);
      if (b === undefined) return null;
      if (b.length > azamiBayt) throw new RangeError(`sahte medya dosya: ${ad} ${b.length} > ${azamiBayt}`);
      return b.slice();
    },
    yaz: async (no, ad, bayt) => {
      kontrol("yaz", no, ad, bayt.length);
      noDenetle(no);
      adDenetle(ad);
      const d = dizinHaritasi.get(no);
      if (d === undefined) throw new Error(`sahte medya dosya: ${no} dizini yok`);
      d.set(ad, bayt.slice());
    },
    dizinSil: async (no) => {
      try {
        kontrol("dizinSil", no);
        noDenetle(no);
      } catch {
        return false;
      }
      if (kilitliler.has(no)) return false;
      dizinHaritasi.delete(no);
      return true;
    },
    dizinler: async () => {
      kontrol("dizinler");
      return sirali(dizinHaritasi.keys());
    },
    parcaKoy: (no, bayt) => void parcaHaritasi.set(no, bayt.slice()),
    parcaIcerigi: (no) => parcaHaritasi.get(no)?.slice() ?? null,
    koy: (no, ad, icerik) => {
      adDenetle(ad);
      dizin(no).set(ad, typeof icerik === "string" ? enc.encode(icerik) : icerik.slice());
    },
    icerik: (no, ad) => dizinHaritasi.get(no)?.get(ad)?.slice() ?? null,
    dizinKoy: (no) => void dizin(no),
    dizinVarMi: (no) => dizinHaritasi.has(no),
    dosyaAdlari: (no) => [...(dizinHaritasi.get(no)?.keys() ?? [])].sort(),
    kilitle: (no, kilitli = true) => {
      if (kilitli) kilitliler.add(no);
      else kilitliler.delete(no);
    },
    hataVer: (islem, hata) => {
      const l = hatalar.get(islem) ?? [];
      l.push(hata);
      hatalar.set(islem, l);
    },
  };
}

/** Sahte işleyicinin araç adımları. */
export type MedyaAdimi = "olc" | "gorselUret" | "kareUret" | "dokumUret";
/** `basarili`: çıktı yazılır; `bos`: araç bitti ama çıktı yok (çözülemedi); `zaman_asimi`: çıktı yok, `zamanAsimi: true`. */
export type MedyaAdimDavranisi = "basarili" | "bos" | "zaman_asimi";

export interface SahteMedyaIsleyici extends MedyaIsleyici {
  cagrilar: CagriDefteri;
  /** `olc` cevabı; işlevse kayda göre. Varsayılan: videoda 20 sn 1280x720 sesli, fotoğrafta 1600x1200. */
  olcum: MedyaOlcumu | null | ((no: number, bicim: MedyaBicimi) => MedyaOlcumu | null);
  /** `dokumUret`'in yazdığı SRT. */
  srt: string;
  /** Verilirse her araç adımı (olc, üretimler) önce bunu bekler: "süren işleme" sınamaları için. */
  bekletme: Promise<void> | null;
  /** Adımın davranışı, değiştirilene dek kalıcı. Varsayılan hepsi `basarili`. `olc`'ta `bos`/`zaman_asimi` → `null`. */
  adimDavranisi(adim: MedyaAdimi, d: MedyaAdimDavranisi): void;
}

/**
 * `MedyaIsleyici` sahtesi: araç çıktısını `dosya`'ya yazar (gerçek ffmpeg gibi `boyut > 0` dosya), böylece
 * S4 başarıyı port üzerinden sınar. `kokla` tasarım tablosunun sahtesi, `beyanaUyar` gevşek (yalnız tür
 * ailesi: biçimin türü = `tur` = `mimeTuru(mime)`), `kareZamanlari` tasarım formülü, `dokumMetni` basit SRT.
 */
export function sahteMedyaIsleyici(dosya: SahteMedyaDosya, sinirlar: MedyaServisSinirlari = SAHTE_MEDYA_SINIRLARI): SahteMedyaIsleyici {
  const cagrilar = new CagriDefteri();
  const davranis = new Map<MedyaAdimi, MedyaAdimDavranisi>();
  const jpeg = (): Uint8Array => sahteMedyaBaytlari("jpg", 64);
  const bekle = async (): Promise<void> => {
    if (i.bekletme !== null) await i.bekletme;
  };
  const uret = async (adim: MedyaAdimi, yaz: () => void): Promise<AracCalismasi> => {
    await bekle();
    const d = davranis.get(adim) ?? "basarili";
    if (d === "basarili") yaz();
    return { zamanAsimi: d === "zaman_asimi" };
  };

  const i: SahteMedyaIsleyici = {
    cagrilar,
    olcum: (_no, bicim) =>
      bicimTuru(bicim) === "video"
        ? { sure_ms: 20_000, genislik: 1280, yukseklik: 720, video_akisi: true, ses_akisi: true }
        : { sure_ms: null, genislik: 1600, yukseklik: 1200, video_akisi: true, ses_akisi: false },
    srt: "1\n00:00:01,000 --> 00:00:03,000\nmerhaba\n\n2\n00:00:04,500 --> 00:00:06,000\nnasılsın\n",
    bekletme: null,
    adimDavranisi: (adim, d) => void davranis.set(adim, d),
    kokla: (bas) => {
      cagrilar.ekle("kokla", bas.length);
      return sahteKokla(bas.slice(0, 64));
    },
    beyanaUyar: (bicim, tur, mime) => {
      cagrilar.ekle("beyanaUyar", bicim, tur, mime);
      return bicimTuru(bicim) === tur && mimeTuru(mime) === tur;
    },
    kareZamanlari: (sure_ms) => {
      cagrilar.ekle("kareZamanlari", sure_ms);
      const n = Math.min(sinirlar.kareEnCok, Math.max(sinirlar.kareEnAz, Math.ceil(sure_ms / sinirlar.kareAraligiMs)));
      return Array.from({ length: n }, (_, k) => Math.floor(((k + 0.5) * sure_ms) / n));
    },
    olc: async (no, bicim) => {
      cagrilar.ekle("olc", no, bicim);
      await bekle();
      if ((davranis.get("olc") ?? "basarili") !== "basarili") return null;
      return typeof i.olcum === "function" ? i.olcum(no, bicim) : i.olcum;
    },
    gorselUret: async (no, bicim) => {
      cagrilar.ekle("gorselUret", no, bicim);
      return uret("gorselUret", () => dosya.koy(no, "gorsel.jpg", jpeg()));
    },
    kareUret: async (no, bicim, sira, zaman_ms) => {
      cagrilar.ekle("kareUret", no, bicim, sira, zaman_ms);
      return uret("kareUret", () => dosya.koy(no, `kare-0${sira}.jpg`, jpeg()));
    },
    dokumUret: async (no, bicim, sure_ms) => {
      cagrilar.ekle("dokumUret", no, bicim, sure_ms);
      return uret("dokumUret", () => dosya.koy(no, "dokum.srt", i.srt));
    },
    dokumMetni: (srt): DokumMetni => {
      cagrilar.ekle("dokumMetni", srt.length);
      const satirlar: string[] = [];
      for (const blok of srt.replaceAll("\r\n", "\n").split(/\n\s*\n/)) {
        const l = blok.split("\n").filter((s) => s.trim() !== "");
        const z = l.findIndex((s) => s.includes("-->"));
        if (z < 0) continue;
        const m = /^(\d+):(\d{2}):(\d{2})/.exec(l[z]!.trim());
        const metin = l.slice(z + 1).join(" ").trim();
        if (m === null || metin === "") continue;
        const sa = Number(m[1]);
        const damga = sa > 0 ? `${sa}:${m[2]}:${m[3]}` : `${m[2]}:${m[3]}`;
        satirlar.push(`[${damga}] ${metin}`);
      }
      const tam = satirlar.join("\n");
      const kirpildi = tam.length > sinirlar.dokumMetni;
      return { metin: kirpildi ? tam.slice(0, sinirlar.dokumMetni) : tam, kirpildi };
    },
  };
  return i;
}

/** Sahte yöneticinin bildiği ek kaydı (testten `ekKoy` ile). */
export interface SahteMedyaEki {
  no: number;
  device_id: string;
  sohbet_id: SohbetId;
  ek: EkBilgisi;
  durum: "yukleniyor" | "kabul" | "reddedildi" | "silinecek";
  /** Bağlandığı kuyruk satırı; `null`: bağlanmamış. */
  kuyruk_id: number | null;
}

export interface SahteMedyaYoneticisi extends MedyaYoneticisi {
  cagrilar: CagriDefteri;
  /** Testten ek koyar (varsayılan `kabul`, bağlanmamış). `ekleriDenetle`/`ekleriBagla`/`ekDizinleri` buna bakar. */
  ekKoy(device_id: string, sohbet_id: SohbetId, ek: EkBilgisi, durum?: SahteMedyaEki["durum"]): SahteMedyaEki;
  /** `(device_id, medya_id)` kaydı; yoksa `undefined`. */
  ek(device_id: string, medya_id: string): SahteMedyaEki | undefined;
  /** Kuyruk satırına bağlı eklerin `medya_id`'leri, bağlama sırasıyla. */
  bagliEkler(kuyruk_id: number): readonly string[];
  /** Bağlı satırın `icerik` cevabı; verilmezse bağlı satır `bekliyor`, bağsız satır `yok`. */
  icerikAyarla(kuyruk_id: number, d: MedyaIcerigiDurumu): void;
  /** Sıradaki `yuklemeBaslat` ya da `parca` cevabı (bir kez, sırayla). Yoksa varsayılan `yukleniyor`. */
  sonrakiDurum(d: MediaStateGovdesi): void;
  /** `nesil` → görsel sayısı. */
  readonly nesilGorselleri: Map<number, number>;
  /** `sohbetMedyasiniSil` çağrılan sohbetler, sırayla. */
  readonly silinenSohbetler: SohbetId[];
}

/**
 * Yönetici yüzlerinin (gateway, konuşma, temizlik) programlanabilir sahtesi; S4'ün gerçek davranışı DEĞİL.
 * `ekleriDenetle` ve `ekleriBagla` sözleşmedeki sırayla sınar (yok/`yukleniyor` → `medya_yok`, `reddedildi` →
 * `medya_reddedildi`, başka sohbet, bağlı, `tur`/`mime`/`boyut` farkı → `medya_yok`); `ekleriBagla` tutmazsa atar.
 * `yuklemeBaslat` varsayılanı `yukleniyor{alinan:0}`, `parca` varsayılanı `yukleniyor{alinan: ofset + bayt}`.
 */
export function sahteMedyaYoneticisi(kok = `${SAHTE_VERI_KOKU}\\medya`): SahteMedyaYoneticisi {
  const cagrilar = new CagriDefteri();
  const ekler = new Map<string, SahteMedyaEki>();
  const baglar = new Map<number, string[]>();
  const icerikler = new Map<number, MedyaIcerigiDurumu>();
  const durumlar: MediaStateGovdesi[] = [];
  let sayac = 0;
  const anahtar = (device_id: string, medya_id: string): string => `${device_id}\u0000${medya_id}`;

  const denetle = (device_id: string, sohbet: SohbetSecimi, l: EkListesi): Sonuc<void, MedyaBaglamaHatasi> => {
    for (const e of l) {
      const k = ekler.get(anahtar(device_id, e.medya_id));
      if (k === undefined) return { ok: false, code: "medya_yok" };
      if (k.durum === "reddedildi") return { ok: false, code: "medya_reddedildi" };
      if (k.durum !== "kabul" || k.sohbet_id !== sohbet.sohbet_id || k.kuyruk_id !== null) return { ok: false, code: "medya_yok" };
      if (k.ek.tur !== e.tur || k.ek.mime !== e.mime || k.ek.boyut !== e.boyut) return { ok: false, code: "medya_yok" };
    }
    return { ok: true, deger: undefined };
  };

  const y: SahteMedyaYoneticisi = {
    cagrilar,
    nesilGorselleri: new Map(),
    silinenSohbetler: [],
    ekKoy: (device_id, sohbet_id, ek, durum = "kabul") => {
      const k: SahteMedyaEki = { no: ++sayac, device_id, sohbet_id, ek, durum, kuyruk_id: null };
      ekler.set(anahtar(device_id, ek.medya_id), k);
      return k;
    },
    ek: (device_id, medya_id) => ekler.get(anahtar(device_id, medya_id)),
    bagliEkler: (kuyruk_id) => [...(baglar.get(kuyruk_id) ?? [])],
    icerikAyarla: (kuyruk_id, d) => void icerikler.set(kuyruk_id, d),
    sonrakiDurum: (d) => void durumlar.push(d),
    baslat: async () => {
      cagrilar.ekle("baslat");
    },
    yuklemeBaslat: async (device_id, m) => {
      cagrilar.ekle("yuklemeBaslat", device_id, m);
      return durumlar.shift() ?? { medya_id: m.medya_id, durum: "yukleniyor", alinan: 0 };
    },
    parca: async (device_id, m) => {
      cagrilar.ekle("parca", device_id, m.medya_id, m.ofset);
      return durumlar.shift() ?? { medya_id: m.medya_id, durum: "yukleniyor", alinan: m.ofset + base64BaytUzunlugu(m.veri) };
    },
    iptal: (device_id, m) => {
      cagrilar.ekle("iptal", device_id, m.medya_id);
    },
    ekleriDenetle: (device_id, sohbet, l) => {
      cagrilar.ekle("ekleriDenetle", device_id, sohbet.sohbet_id, l.map((e) => e.medya_id));
      return denetle(device_id, sohbet, l);
    },
    ekleriBagla: (g) => {
      cagrilar.ekle("ekleriBagla", g.device_id, g.sohbet.sohbet_id, g.kuyruk_id, g.client_msg_id);
      const s = denetle(g.device_id, g.sohbet, g.ekler);
      if (!s.ok) throw new Error(`sahte medya: bağlanamadı (${s.code})`);
      const l = baglar.get(g.kuyruk_id) ?? [];
      for (const e of g.ekler) {
        ekler.get(anahtar(g.device_id, e.medya_id))!.kuyruk_id = g.kuyruk_id;
        l.push(e.medya_id);
      }
      baglar.set(g.kuyruk_id, l);
    },
    icerik: (g) => {
      cagrilar.ekle("icerik", g.kuyruk_id);
      if (!baglar.has(g.kuyruk_id)) return { durum: "yok" };
      return icerikler.get(g.kuyruk_id) ?? { durum: "bekliyor" };
    },
    icerikBirak: (kuyruk_id) => {
      cagrilar.ekle("icerikBirak", kuyruk_id);
      icerikler.delete(kuyruk_id);
    },
    nesilGorselSayisi: (nesil) => {
      cagrilar.ekle("nesilGorselSayisi", nesil);
      return y.nesilGorselleri.get(nesil) ?? 0;
    },
    nesilGorselEkle: (nesil, adet) => {
      cagrilar.ekle("nesilGorselEkle", nesil, adet);
      y.nesilGorselleri.set(nesil, (y.nesilGorselleri.get(nesil) ?? 0) + adet);
    },
    ekDizinleri: (sohbet, medya_idler) => {
      cagrilar.ekle("ekDizinleri", sohbet.sohbet_id, [...medya_idler]);
      const sonuc: string[] = [];
      for (const id of medya_idler) {
        for (const k of ekler.values()) {
          if (k.ek.medya_id === id && k.sohbet_id === sohbet.sohbet_id && k.kuyruk_id !== null && k.durum !== "silinecek") {
            sonuc.push(`${kok}\\${k.no}`);
            break;
          }
        }
      }
      return sonuc;
    },
    sohbetMedyasiniSil: async (sohbet) => {
      cagrilar.ekle("sohbetMedyasiniSil", sohbet.sohbet_id);
      y.silinenSohbetler.push(sohbet.sohbet_id);
      for (const k of ekler.values()) if (k.sohbet_id === sohbet.sohbet_id) k.durum = "silinecek";
    },
    bekle: async () => {
      cagrilar.ekle("bekle");
    },
    kapat: async () => {
      cagrilar.ekle("kapat");
    },
  };
  return y;
}

// ---------------------------------------------------------------------------------------------
// Hepsi bir arada
// ---------------------------------------------------------------------------------------------

export interface SahteDunyaSecenekleri {
  baslangicMs?: number;
  tohum?: number;
  servisPid?: number;
  acikAnahtar?: string;
}

export interface SahteDunya {
  /** Modüllere verilecek `DisDunya`; alanları aşağıdaki sahtelerin kendisidir. */
  dunya: DisDunya;
  zaman: SahteZaman;
  saat: SaatPortu;
  zamanlayici: ZamanlayiciPortu;
  rastgele: SahteRastgele;
  dosya: SahteDosya;
  kayit: SahteKayit;
  surec: SahteSurec;
  sistem: SahteSistem;
  ws: SahteWs;
  boru: SahteBoru;
  http: SahteHttp;
  anahtar: SahteAnahtar;
  tekilKilit: SahteTekilKilit;
  transkript: SahteTranskript;
  gunluk: SahteGunluk;
  /** Ajanda dalgası. `DisDunya`'da DEĞİL (`TakvimPortu` `ana`'da `takvimKur` ile kurulur); varsayılan `Europe/Istanbul`. */
  takvim: SahteTakvim;
  /** Medya dalgası. `DisDunya`'da DEĞİL (`ana` `medyaDosyaKur({kok})` ile kurar); kök `sahteMedyaAyari().kok`. */
  medyaDosya: SahteMedyaDosya;
}

export function sahteDunya(sec: SahteDunyaSecenekleri = {}): SahteDunya {
  const zaman = sahteZaman(sec.baslangicMs);
  const rastgele = sahteRastgele(sec.tohum);
  const dosya = sahteDosya();
  const kayit = sahteKayit();
  const surec = sahteSurec(zaman, sec.servisPid);
  const sistem = sahteSistem();
  const ws = sahteWs();
  const boru = sahteBoru();
  const http = sahteHttp();
  const anahtar = sahteAnahtar(sec.acikAnahtar);
  const tekilKilit = sahteTekilKilit();
  const transkript = sahteTranskript();
  const gunluk = sahteGunluk();
  return {
    dunya: {
      saat: zaman.saat,
      zamanlayici: zaman.zamanlayici,
      rastgele,
      dosya,
      kayit,
      surec,
      sistem,
      ws,
      boru,
      http,
      anahtar,
      tekilKilit,
      transkript,
    },
    zaman,
    saat: zaman.saat,
    zamanlayici: zaman.zamanlayici,
    rastgele,
    dosya,
    kayit,
    surec,
    sistem,
    ws,
    boru,
    http,
    anahtar,
    tekilKilit,
    transkript,
    gunluk,
    takvim: sahteTakvim(),
    medyaDosya: sahteMedyaDosya(),
  };
}
