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
 */
import type {
  AnahtarPortu,
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
  DosyaPortu,
  Gunluk,
  GunlukAlanlari,
  HttpPortu,
  IptalEt,
  KapatilabilirSunucu,
  KayitPortu,
  MasaustuDurumu,
  RamOkumasi,
  RastgelePortu,
  SaatPortu,
  SistemPortu,
  SohbetSecimi,
  SurecKaydi,
  SurecKapisi,
  SurecKimligi,
  SurecPortu,
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
}

export interface SahteWs extends WsSunucuPortu {
  cagrilar: CagriDefteri;
  /** Son `dinle` isteği (host, port, azamiCerceve). */
  istek(): WsSunucuIstegi | null;
  readonly kapatildi: boolean;
  /** Yeni bağlantı açar ve sunucunun `baglanti` işleyicisini çağırır. */
  baglan(yol: WsYolu, uzakIp?: string): SahteWsBaglantisi;
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
    baglan: (yol, uzakIp = "100.64.0.20") => {
      if (!istek) throw new Error("sahte ws: dinle çağrılmadı");
      const mesajlar: Array<(m: string) => void> = [];
      const kapanislar: Array<() => void> = [];
      const gonderilenler: string[] = [];
      let kapanis: { kod: number; neden: string } | null = null;
      const kapanisYay = (): void => {
        for (const f of [...kapanislar]) f();
      };
      const b: SahteWsBaglantisi = {
        yol,
        uzakIp,
        gonderilenler,
        get kapanis() {
          return kapanis;
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

export interface SahteBoru extends BoruSunucuPortu {
  cagrilar: CagriDefteri;
  istek(): BoruSunucuIstegi | null;
  readonly kapatildi: boolean;
  baglan(): SahteBoruBaglantisi;
  sonrakiDinlemeHatasi(hata: Error): void;
}

export function sahteBoru(): SahteBoru {
  const cagrilar = new CagriDefteri();
  let istek: BoruSunucuIstegi | null = null;
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
    baglan: () => {
      if (!istek) throw new Error("sahte boru: dinle çağrılmadı");
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
  };
}
