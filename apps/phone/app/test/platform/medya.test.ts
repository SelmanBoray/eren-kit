/**
 * `platform/medyaSecici.ts` ve `platform/medyaDosya.ts` birim testleri. Expo yerel modülleri Node'da
 * yüklenemez; modül çözümleme kancasıyla bellek içi sahtelere yönlendirilir (`dosyaDepo.test.ts` deseni).
 * Sahteler yalnız adaptörlerin kullandığı yüzeyi taklit eder; cihaz davranışını (HEIC, kamera süresi,
 * izin) kanıtlamaz.
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

// ------------------------------------------------------------------------------------------------
// Sahte dosya sistemi
// ------------------------------------------------------------------------------------------------

const disk = new Map<string, Uint8Array>();
const dizinler = new Set<string>();
/** `readBytes` en çok bu kadar bayt döner (kısa okuma benzetimi). */
let okumaTavani = Infinity;

type Parca = string | { uri: string };
const birlestir = (parcalar: Parca[]): string =>
  parcalar.map((p) => (typeof p === "string" ? p : p.uri).replace(/\/$/, "")).join("/");

class SahteTutamac {
  offset: number | null = 0;
  private readonly veri: Uint8Array;
  constructor(veri: Uint8Array) {
    this.veri = veri;
  }
  get size(): number {
    return this.veri.length;
  }
  async readBytes(n: number): Promise<Uint8Array> {
    const o = this.offset ?? 0;
    const p = this.veri.slice(o, o + Math.min(n, okumaTavani));
    this.offset = o + p.length;
    return p;
  }
  close(): void {
    this.offset = null;
  }
}

class SahteDosya {
  readonly uri: string;
  constructor(...parcalar: Parca[]) {
    this.uri = birlestir(parcalar);
  }
  get exists(): boolean {
    return disk.has(this.uri);
  }
  info(): { exists: boolean; size?: number } {
    const v = disk.get(this.uri);
    return v === undefined ? { exists: false } : { exists: true, size: v.length };
  }
  delete(): void {
    if (!disk.delete(this.uri)) throw new Error("yok");
  }
  async copy(hedef: SahteDosya): Promise<void> {
    const v = disk.get(this.uri);
    if (v === undefined) throw new Error("yok");
    if (kopyaHatasi) throw new Error("yer yok");
    disk.set(hedef.uri, v.slice());
  }
  async move(hedef: SahteDosya): Promise<void> {
    await this.copy(hedef);
    disk.delete(this.uri);
  }
  open(): SahteTutamac {
    const v = disk.get(this.uri);
    if (v === undefined) throw new Error("yok");
    return new SahteTutamac(v);
  }
}

class SahteDizin {
  readonly uri: string;
  constructor(...parcalar: Parca[]) {
    this.uri = `${birlestir(parcalar)}/`;
  }
  get exists(): boolean {
    return dizinler.has(this.uri);
  }
  create(): void {
    dizinler.add(this.uri);
  }
  list(): (SahteDosya | SahteDizin)[] {
    const ogeler: (SahteDosya | SahteDizin)[] = [];
    for (const u of disk.keys()) if (u.startsWith(this.uri) && !u.slice(this.uri.length).includes("/")) ogeler.push(new SahteDosya(u));
    for (const d of dizinler) if (d !== this.uri && d.startsWith(this.uri)) ogeler.push(new SahteDizin(d.slice(0, -1)));
    return ogeler;
  }
}

let kopyaHatasi = false;

// ------------------------------------------------------------------------------------------------
// Sahte manipülatör, kapak, seçici
// ------------------------------------------------------------------------------------------------

let manipulatorDusur = false;
let sonYukleme: { maxWidth?: number; maxHeight?: number } | undefined;
let sonKayit: { format?: string; compress?: number } | undefined;
let ciktiSayac = 0;
let birakilan = 0;

const ImageManipulator = {
  manipulate(_kaynak: string, secenek?: { maxWidth?: number; maxHeight?: number }) {
    sonYukleme = secenek;
    return {
      async renderAsync() {
        if (manipulatorDusur) throw new Error("çözülemedi");
        return {
          width: 1568,
          height: 1176,
          async saveAsync(s: { format?: string; compress?: number }) {
            sonKayit = s;
            const uri = `onbellek/cikti-${++ciktiSayac}.jpg`;
            disk.set(uri, new Uint8Array(300));
            return { uri, width: 1568, height: 1176 };
          },
          release() {
            birakilan++;
          },
        };
      },
      release() {
        birakilan++;
      },
    };
  },
};

let kapakDusur = false;
let sonKapakSecenek: { time?: number; quality?: number } | undefined;
const getThumbnailAsync = async (_uri: string, s: { time?: number; quality?: number }) => {
  sonKapakSecenek = s;
  if (kapakDusur) throw new Error("kapak yok");
  const uri = `onbellek/kapak-${++ciktiSayac}.jpg`;
  disk.set(uri, new Uint8Array(40));
  return { uri, width: 320, height: 180 };
};

type Sonuc = { canceled: true; assets: null } | { canceled: false; assets: Record<string, unknown>[] };
let izinVerildi = true;
let seciciSonucu: Sonuc = { canceled: true, assets: null };
let seciciDusur = false;
const cagrilar: { ad: string; secenek?: Record<string, unknown> }[] = [];

const ImagePicker = {
  async requestCameraPermissionsAsync() {
    cagrilar.push({ ad: "izin" });
    return { granted: izinVerildi, status: izinVerildi ? "granted" : "denied", canAskAgain: true, expires: "never" };
  },
  async launchCameraAsync(secenek: Record<string, unknown>) {
    cagrilar.push({ ad: "kamera", secenek });
    if (seciciDusur) throw new Error("düştü");
    return seciciSonucu;
  },
  async launchImageLibraryAsync(secenek: Record<string, unknown>) {
    cagrilar.push({ ad: "galeri", secenek });
    if (seciciDusur) throw new Error("düştü");
    return seciciSonucu;
  },
};

(globalThis as Record<string, unknown>)["__sahteExpo"] = {
  fs: { File: SahteDosya, Directory: SahteDizin, Paths: { document: "belge" }, FileMode: { ReadOnly: "r" } },
  manip: { ImageManipulator, SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" } },
  kapak: { getThumbnailAsync },
  secici: ImagePicker,
};

const modul = (govde: string): string => "data:text/javascript," + encodeURIComponent(`const s = globalThis.__sahteExpo; ${govde}`);
const SAHTELER: Record<string, string> = {
  "expo-file-system": modul("export const { File, Directory, Paths, FileMode } = s.fs;"),
  "expo-image-manipulator": modul("export const { ImageManipulator, SaveFormat } = s.manip;"),
  "expo-video-thumbnails": modul("export const { getThumbnailAsync } = s.kapak;"),
  "expo-image-picker": modul(
    "export const { requestCameraPermissionsAsync, launchCameraAsync, launchImageLibraryAsync } = s.secici;",
  ),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = SAHTELER[specifier];
    if (url !== undefined) return { url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const secici = (await import("../../src/platform/medyaSecici.ts")) as typeof import("../../src/platform/medyaSecici.ts");
const dosya = (await import("../../src/platform/medyaDosya.ts")) as typeof import("../../src/platform/medyaDosya.ts");
const { MEDYA_SINIRLARI } = await import("@eren/protocol");

type SeciliEk = import("../../src/cekirdek/sozlesme.ts").SeciliEk;

const KLASOR = "belge/eren-medya/";

beforeEach(() => {
  disk.clear();
  dizinler.clear();
  okumaTavani = Infinity;
  kopyaHatasi = false;
  manipulatorDusur = false;
  kapakDusur = false;
  izinVerildi = true;
  seciciDusur = false;
  seciciSonucu = { canceled: true, assets: null };
  cagrilar.length = 0;
  sonYukleme = undefined;
  sonKayit = undefined;
  sonKapakSecenek = undefined;
  birakilan = 0;
});

// ------------------------------------------------------------------------------------------------
// medyaSecici
// ------------------------------------------------------------------------------------------------

describe("mimeCikar", () => {
  it("seçicinin mime'ını küçültür, parametreyi atar, eş adı düzeltir", () => {
    assert.equal(secici.mimeCikar("IMAGE/JPEG; q=1", null, "x"), "image/jpeg");
    assert.equal(secici.mimeCikar("image/jpg", null, "x"), "image/jpeg");
    assert.equal(secici.mimeCikar("video/3gp", null, "x"), "video/3gpp");
  });
  it("mime yoksa dosya adının, o da yoksa adresin uzantısından", () => {
    assert.equal(secici.mimeCikar(null, "IMG_1.HEIC", "file:///a/b.jpg"), "image/heic");
    assert.equal(secici.mimeCikar(undefined, null, "file:///a/b.MOV?x=1"), "video/quicktime");
    assert.equal(secici.mimeCikar("", "", "file:///a/klip.mp4"), "video/mp4");
  });
  it("bilinmeyen uzantı ve uzantısız ad null", () => {
    assert.equal(secici.mimeCikar(null, "a.gif", "file:///a.gif"), null);
    assert.equal(secici.mimeCikar(null, null, "file:///a.b/dosya"), null);
    assert.equal(secici.mimeCikar(null, null, "file:///a/.gizli"), null);
  });
});

describe("hamMedyaKur", () => {
  const boyutYok = (): number | null => null;
  it("video: süre yuvarlanır, en/boy 0 ise null", () => {
    const h = secici.hamMedyaKur(
      { uri: "u", type: "video", mimeType: "video/mp4", fileSize: 1234, duration: 2999.6, width: 0, height: 720 },
      boyutYok,
    );
    assert.deepEqual(h, { uri: "u", tur: "video", mime: "video/mp4", boyut: 1234, sure_ms: 3000, genislik: null, yukseklik: 720 });
  });
  it("foto: süre hep null; boyut yoksa dosyadan okunur", () => {
    const h = secici.hamMedyaKur({ uri: "u", type: "image", duration: 50, width: 10, height: 20 }, () => 77);
    assert.equal(h.tur, "foto");
    assert.equal(h.sure_ms, null);
    assert.equal(h.boyut, 77);
  });
  it("bilinmeyen tür null; süre 0 null", () => {
    const h = secici.hamMedyaKur({ uri: "u", type: "livePhoto", duration: 0 }, boyutYok);
    assert.equal(h.tur, null);
    assert.equal(h.boyut, null);
    assert.equal(secici.hamMedyaKur({ uri: "u", type: "video", duration: 0 }, boyutYok).sure_ms, null);
  });
});

describe("medyaSeciciKur", () => {
  const port = secici.medyaSeciciKur();

  it("kalan < 1 ise seçici açılmaz", async () => {
    assert.deepEqual(await port.sec("galeri", 0), { ok: true, ogeler: [] });
    assert.deepEqual(await port.sec("video_cek", -1), { ok: true, ogeler: [] });
    assert.equal(cagrilar.length, 0);
  });

  it("galeri: izin istemez, çoklu seçim, sınır kalan, EXIF/base64 yok; fazlası kesilir", async () => {
    seciciSonucu = {
      canceled: false,
      assets: [1, 2, 3].map((i) => ({ uri: `file:///onbellek/${i}.jpg`, type: "image", fileSize: 10, width: 1, height: 1 })),
    };
    const s = await port.sec("galeri", 2);
    assert.equal(cagrilar.length, 1);
    assert.equal(cagrilar[0]?.ad, "galeri");
    assert.deepEqual(cagrilar[0]?.secenek, {
      exif: false,
      base64: false,
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 2,
    });
    assert.ok(s.ok);
    assert.equal(s.ogeler.length, 2);
  });

  it("vazgeçme: ok + boş", async () => {
    assert.deepEqual(await port.sec("galeri", 4), { ok: true, ogeler: [] });
  });

  it("video_cek: önce izin, sonra 295 sn sınırlı kamera", async () => {
    seciciSonucu = { canceled: false, assets: [{ uri: "file:///v.mp4", type: "video", fileSize: 9, duration: 1000 }] };
    const s = await port.sec("video_cek", 4);
    assert.deepEqual(
      cagrilar.map((c) => c.ad),
      ["izin", "kamera"],
    );
    assert.equal(cagrilar[1]?.secenek?.["videoMaxDuration"], 295);
    assert.deepEqual(cagrilar[1]?.secenek?.["mediaTypes"], ["videos"]);
    assert.equal(secici.KAMERA_VIDEO_AZAMI_SN, 295);
    assert.ok(MEDYA_SINIRLARI.VIDEO_SURE_MS / 1000 > secici.KAMERA_VIDEO_AZAMI_SN);
    assert.ok(s.ok);
    assert.equal(s.ogeler[0]?.sure_ms, 1000);
  });

  it("kamera izni reddedilirse izin_yok, kamera açılmaz", async () => {
    izinVerildi = false;
    assert.deepEqual(await port.sec("foto_cek", 4), { ok: false, neden: "izin_yok" });
    assert.deepEqual(
      cagrilar.map((c) => c.ad),
      ["izin"],
    );
  });

  it("seçici atarsa hata; söz reddedilmez", async () => {
    seciciDusur = true;
    assert.deepEqual(await port.sec("galeri", 1), { ok: false, neden: "hata" });
  });

  it("boyut verilmezse dosyadan okunur; dosya yoksa null", async () => {
    disk.set("file:///a.jpg", new Uint8Array(55));
    seciciSonucu = {
      canceled: false,
      assets: [
        { uri: "file:///a.jpg", type: "image" },
        { uri: "file:///yok.jpg", type: "image" },
      ],
    };
    const s = await port.sec("galeri", 4);
    assert.ok(s.ok);
    assert.deepEqual(
      s.ogeler.map((o) => o.boyut),
      [55, null],
    );
  });
});

// ------------------------------------------------------------------------------------------------
// medyaDosya
// ------------------------------------------------------------------------------------------------

const foto = (o: Partial<SeciliEk> = {}): SeciliEk => ({
  uri: "onbellek/secilen.heic",
  tur: "foto",
  mime: "image/heic",
  boyut: 5000,
  sure_ms: null,
  genislik: 4000,
  yukseklik: 3000,
  ...o,
});
const video = (o: Partial<SeciliEk> = {}): SeciliEk => ({
  uri: "onbellek/secilen.mp4",
  tur: "video",
  mime: "video/mp4",
  boyut: 1000,
  sure_ms: 12_000,
  genislik: 1920,
  yukseklik: 1080,
  ...o,
});
const klasorDosyalari = (): string[] => [...disk.keys()].filter((u) => u.startsWith(KLASOR)).sort();

describe("medyaDosya saf yardımcılar", () => {
  it("uzantiAl, dosyaAdinaUygun, kapakAni, okunacakUzunluk", () => {
    assert.equal(dosya.uzantiAl("video/quicktime"), "mov");
    assert.equal(dosya.uzantiAl("image/jpeg"), "jpg");
    assert.equal(dosya.uzantiAl("x/y"), "bin");
    assert.ok(dosya.dosyaAdinaUygun("m-3-17"));
    for (const k of ["", "../x", "a.b", "a/b", "ü"]) assert.ok(!dosya.dosyaAdinaUygun(k), k);
    assert.equal(dosya.kapakAni(null), 0);
    assert.equal(dosya.kapakAni(600), 300);
    assert.equal(dosya.kapakAni(60_000), 1000);
    assert.equal(dosya.okunacakUzunluk(10, 8, 5), 2);
    assert.equal(dosya.okunacakUzunluk(10, 10, 5), 0);
    assert.equal(dosya.okunacakUzunluk(10, 20, 5), 0);
  });
});

describe("medyaDosyaKur.hazirla", () => {
  const port = dosya.medyaDosyaKur();

  it("foto: uzun kenar sınırıyla JPEG 0,8; kalıcı klasöre taşınır; önizleme kendisi", async () => {
    disk.set("onbellek/secilen.heic", new Uint8Array(5000));
    const s = await port.hazirla(foto(), "m-1-1");
    assert.deepEqual(sonYukleme, { maxWidth: MEDYA_SINIRLARI.FOTO_UZUN_KENAR, maxHeight: MEDYA_SINIRLARI.FOTO_UZUN_KENAR });
    assert.equal(sonKayit?.format, "jpeg");
    assert.equal(sonKayit?.compress, 0.8);
    assert.deepEqual(s, {
      ok: true,
      ek: {
        uri: `${KLASOR}m-1-1.jpg`,
        mime: "image/jpeg",
        boyut: 300,
        genislik: 1568,
        yukseklik: 1176,
        sure_ms: null,
        onizleme_uri: `${KLASOR}m-1-1.jpg`,
      },
    });
    assert.deepEqual(klasorDosyalari(), [`${KLASOR}m-1-1.jpg`]);
    assert.ok(![...disk.keys()].some((u) => u.startsWith("onbellek/cikti")), "önbellek çıktısı kalmaz");
    assert.equal(birakilan, 2);
  });

  it("foto: küçültücü düşerse özgün dosya kendi türüyle kopyalanır", async () => {
    disk.set("onbellek/secilen.heic", new Uint8Array(5000));
    manipulatorDusur = true;
    const s = await port.hazirla(foto(), "m-1-2");
    assert.ok(s.ok);
    assert.equal(s.ek.uri, `${KLASOR}m-1-2.heic`);
    assert.equal(s.ek.mime, "image/heic");
    assert.equal(s.ek.boyut, 5000);
    assert.equal(s.ek.genislik, 4000);
    assert.deepEqual(klasorDosyalari(), [`${KLASOR}m-1-2.heic`]);
  });

  it("foto: düşen küçültmede FOTO_BAYT aşılırsa cok_buyuk, dosya kalmaz", async () => {
    disk.set("onbellek/secilen.heic", new Uint8Array(MEDYA_SINIRLARI.FOTO_BAYT + 1));
    manipulatorDusur = true;
    assert.deepEqual(await port.hazirla(foto(), "m-1-3"), { ok: false, neden: "cok_buyuk" });
    assert.deepEqual(klasorDosyalari(), []);
  });

  it("kaynak yoksa okunamadi", async () => {
    assert.deepEqual(await port.hazirla(foto(), "m-1-4"), { ok: false, neden: "okunamadi" });
    assert.deepEqual(await port.hazirla(video(), "m-1-5"), { ok: false, neden: "okunamadi" });
  });

  it("geçersiz medya_id hata, hiçbir şey yazılmaz", async () => {
    disk.set("onbellek/secilen.heic", new Uint8Array(5));
    assert.deepEqual(await port.hazirla(foto(), "../kac"), { ok: false, neden: "hata" });
    assert.deepEqual(klasorDosyalari(), []);
  });

  it("video: aynen kopyalanır, kapak alınır", async () => {
    disk.set("onbellek/secilen.mp4", new Uint8Array(1000));
    const s = await port.hazirla(video({ mime: "video/quicktime" }), "m-2-1");
    assert.deepEqual(s, {
      ok: true,
      ek: {
        uri: `${KLASOR}m-2-1.mov`,
        mime: "video/quicktime",
        boyut: 1000,
        genislik: 1920,
        yukseklik: 1080,
        sure_ms: 12_000,
        onizleme_uri: `${KLASOR}m-2-1.kapak.jpg`,
      },
    });
    assert.deepEqual(sonKapakSecenek, { time: 1000, quality: 0.7 });
    assert.ok(disk.has("onbellek/secilen.mp4"), "kaynak silinmez");
  });

  it("video: kapak alınamazsa onizleme null, hata değil", async () => {
    disk.set("onbellek/secilen.mp4", new Uint8Array(1000));
    kapakDusur = true;
    const s = await port.hazirla(video(), "m-2-2");
    assert.ok(s.ok);
    assert.equal(s.ek.onizleme_uri, null);
    assert.deepEqual(klasorDosyalari(), [`${KLASOR}m-2-2.mp4`]);
  });

  it("video: kopya VIDEO_BAYT'ı aşarsa cok_buyuk, dosya kalmaz", async () => {
    disk.set("onbellek/secilen.mp4", new Uint8Array(MEDYA_SINIRLARI.VIDEO_BAYT + 1));
    assert.deepEqual(await port.hazirla(video({ boyut: 10 }), "m-2-3"), { ok: false, neden: "cok_buyuk" });
    assert.deepEqual(klasorDosyalari(), []);
  });

  it("kopyalama düşerse hata, yarım dosya kalmaz", async () => {
    disk.set("onbellek/secilen.mp4", new Uint8Array(1000));
    kopyaHatasi = true;
    assert.deepEqual(await port.hazirla(video(), "m-2-4"), { ok: false, neden: "hata" });
    assert.deepEqual(klasorDosyalari(), []);
  });
});

describe("medyaDosyaKur boyut/oku/sil/listele", () => {
  const port = dosya.medyaDosyaKur();
  const veri = Uint8Array.from({ length: 100 }, (_, i) => i);

  it("boyut: var olan dosyanın baytı, yoksa null", async () => {
    disk.set(`${KLASOR}a.mp4`, veri);
    assert.equal(await port.boyut(`${KLASOR}a.mp4`), 100);
    assert.equal(await port.boyut(`${KLASOR}yok.mp4`), null);
  });

  it("oku: ofset/uzunluk, dosya sonunda kısa, sonrasında boş", async () => {
    disk.set(`${KLASOR}a.mp4`, veri);
    assert.deepEqual([...(await port.oku(`${KLASOR}a.mp4`, 10, 5))], [10, 11, 12, 13, 14]);
    assert.deepEqual([...(await port.oku(`${KLASOR}a.mp4`, 97, 10))], [97, 98, 99]);
    assert.equal((await port.oku(`${KLASOR}a.mp4`, 100, 10)).length, 0);
    assert.equal((await port.oku(`${KLASOR}a.mp4`, 500, 10)).length, 0);
  });

  it("oku: kısa okumalar birleştirilir", async () => {
    disk.set(`${KLASOR}a.mp4`, veri);
    okumaTavani = 7;
    const p = await port.oku(`${KLASOR}a.mp4`, 3, 50);
    assert.deepEqual([...p], [...veri.slice(3, 53)]);
  });

  it("oku: dosya yoksa ya da aralık geçersizse reddeder", async () => {
    await assert.rejects(port.oku(`${KLASOR}yok.mp4`, 0, 1));
    disk.set(`${KLASOR}a.mp4`, veri);
    await assert.rejects(port.oku(`${KLASOR}a.mp4`, -1, 1));
    await assert.rejects(port.oku(`${KLASOR}a.mp4`, 0, 1.5));
  });

  it("sil: siler, yoksa sessiz; klasör dışını reddeder", async () => {
    disk.set(`${KLASOR}a.mp4`, veri);
    await port.sil(`${KLASOR}a.mp4`);
    assert.ok(!disk.has(`${KLASOR}a.mp4`));
    await port.sil(`${KLASOR}a.mp4`);
    disk.set("belge/eren-depo/olaylar", veri);
    await assert.rejects(port.sil("belge/eren-depo/olaylar"));
    assert.ok(disk.has("belge/eren-depo/olaylar"));
  });

  it("listele: klasör yoksa boş; yalnız klasördeki dosyalar", async () => {
    assert.deepEqual(await port.listele(), []);
    dizinler.add(KLASOR);
    dizinler.add(`${KLASOR}alt/`);
    disk.set(`${KLASOR}a.mp4`, veri);
    disk.set(`${KLASOR}a.kapak.jpg`, veri);
    disk.set("belge/baska.txt", veri);
    assert.deepEqual([...(await port.listele())].sort(), [`${KLASOR}a.kapak.jpg`, `${KLASOR}a.mp4`]);
  });
});
