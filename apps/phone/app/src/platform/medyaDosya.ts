/**
 * `MedyaDosyaPortu` gerçeği. Hazırlanan ekler `Paths.document/eren-medya/` altında durur (seçici
 * önbelleği silinebilir; uygulama kapanıp açılınca yükleme buradan sürer). Fotoğraf
 * `expo-image-manipulator` ile uzun kenarı en çok `FOTO_UZUN_KENAR` olacak biçimde JPEG'e yeniden
 * kodlanır (EXIF/GPS düşer); video olduğu gibi kopyalanır, kapağı `expo-video-thumbnails` ile alınır.
 * Parça okuma `expo-file-system` `FileHandle` ile. Hiçbir yöntem adres ya da içerik günlüğe yazmaz.
 */
import { MEDYA_SINIRLARI, turBaytSiniri, type MedyaMime } from "@eren/protocol";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { getThumbnailAsync } from "expo-video-thumbnails";
import type { HazirEk, HazirlaSonucu, MedyaDosyaPortu, SeciliEk } from "../cekirdek/sozlesme.ts";

export const MEDYA_KLASORU = "eren-medya";
/** Küçültülen fotoğrafın JPEG kalitesi. */
export const FOTO_KALITE = 0.8;
/** Video kapağının JPEG kalitesi. */
export const KAPAK_KALITE = 0.7;

const MIME_UZANTI: Readonly<Record<MedyaMime, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "video/webm": "webm",
};

/** Saf. Kopyanın uzantısı (`MedyaMime` kapalı listesi; bilinmeyen `bin`). */
export const uzantiAl = (mime: string): string => MIME_UZANTI[mime as MedyaMime] ?? "bin";

/** Saf. `medya_id` dosya adına güvenle girer mi (`OpakId` kalıbı: yol ayracı, nokta yok). */
export const dosyaAdinaUygun = (medya_id: string): boolean =>
  medya_id.length >= 1 && medya_id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(medya_id);

/**
 * Saf. Kapağın alınacağı an, ms: ilk kare çoğu zaman siyah olduğu için en çok 1 sn, kısa videoda
 * sürenin yarısı; süre bilinmiyorsa 0.
 */
export const kapakAni = (sure_ms: number | null): number =>
  sure_ms !== null && Number.isFinite(sure_ms) && sure_ms > 0 ? Math.min(1000, Math.floor(sure_ms / 2)) : 0;

/** Saf. `[ofset, ofset+uzunluk)` ile `[0, boyut)`'un kesişiminin uzunluğu. */
export const okunacakUzunluk = (boyut: number, ofset: number, uzunluk: number): number =>
  Math.max(0, Math.min(uzunluk, boyut - ofset));

const tamSayiMi = (x: number): boolean => Number.isSafeInteger(x) && x >= 0;

/** Dosyanın baytı; yoksa ya da okunamıyorsa `null`. */
const dosyaBoyutu = (f: File): number | null => {
  try {
    const bilgi = f.info();
    return bilgi.exists && typeof bilgi.size === "number" ? bilgi.size : null;
  } catch {
    return null;
  }
};

const sessizSil = (f: File): void => {
  try {
    if (f.exists) f.delete();
  } catch {
    // Kayıtsız kalan dosya açılış süpürmesinde silinir.
  }
};

/** Önbellekteki geçici çıktıyı kalıcı hedefe taşır; taşınamazsa kopyalar ve kaynağı siler. */
const yerlestir = async (kaynak: File, hedef: File): Promise<void> => {
  try {
    await kaynak.move(hedef, { overwrite: true });
  } catch {
    await kaynak.copy(hedef, { overwrite: true });
    sessizSil(kaynak);
  }
};

class HazirlamaHatasi extends Error {
  readonly neden: "okunamadi" | "cok_buyuk" | "hata";
  constructor(neden: "okunamadi" | "cok_buyuk" | "hata") {
    super(neden);
    this.neden = neden;
  }
}

export const medyaDosyaKur = (klasorAdi = MEDYA_KLASORU): MedyaDosyaPortu => {
  const klasor = new Directory(Paths.document, klasorAdi);
  const klasorOneki = (): string => (klasor.uri.endsWith("/") ? klasor.uri : `${klasor.uri}/`);

  const klasoruHazirla = (): void => {
    if (!klasor.exists) klasor.create({ intermediates: true, idempotent: true });
  };

  /** Fotoğrafı küçültüp JPEG'e çevirir; başarıda hedefin en/boyu. Düşerse atar. */
  const fotoKucult = async (kaynakUri: string, hedef: File): Promise<{ genislik: number; yukseklik: number }> => {
    const kenar = MEDYA_SINIRLARI.FOTO_UZUN_KENAR;
    // `maxWidth`/`maxHeight` kod çözerken küçültür (tam boy bit eşlem belleğe hiç alınmaz) ve
    // en/boy oranını korur: ikisi de verilince uzun kenar `kenar`'ı aşamaz.
    const baglam = ImageManipulator.manipulate(kaynakUri, { maxWidth: kenar, maxHeight: kenar });
    try {
      const resim = await baglam.renderAsync();
      try {
        const sonuc = await resim.saveAsync({ format: SaveFormat.JPEG, compress: FOTO_KALITE, base64: false });
        await yerlestir(new File(sonuc.uri), hedef);
        return { genislik: sonuc.width, yukseklik: sonuc.height };
      } finally {
        resim.release();
      }
    } finally {
      baglam.release();
    }
  };

  /** Video kapağı; alınamazsa `null` (hata değil). */
  const kapakAl = async (videoUri: string, hedef: File, sure_ms: number | null): Promise<string | null> => {
    try {
      const sonuc = await getThumbnailAsync(videoUri, { time: kapakAni(sure_ms), quality: KAPAK_KALITE });
      await yerlestir(new File(sonuc.uri), hedef);
      return hedef.exists ? hedef.uri : null;
    } catch {
      sessizSil(hedef);
      return null;
    }
  };

  /** Hedefin baytını sınırla denetler; geçmezse atar. */
  const boyutDenetle = (hedef: File, sinir: number): number => {
    const b = dosyaBoyutu(hedef);
    if (b === null || b < 1) throw new HazirlamaHatasi("hata");
    if (b > sinir) throw new HazirlamaHatasi("cok_buyuk");
    return b;
  };

  const hazirla = async (ek: SeciliEk, medya_id: string): Promise<HazirlaSonucu> => {
    if (!dosyaAdinaUygun(medya_id)) return { ok: false, neden: "hata" };
    // Bu çağrının yazdığı dosyalar: başarısızlıkta hepsi silinir (yarım dosya kalmaz).
    const yazilanlar: File[] = [];
    try {
      let kaynak: File;
      try {
        kaynak = new File(ek.uri);
        if (!kaynak.exists) return { ok: false, neden: "okunamadi" };
      } catch {
        return { ok: false, neden: "okunamadi" };
      }
      try {
        klasoruHazirla();
      } catch {
        return { ok: false, neden: "hata" };
      }

      if (ek.tur === "foto") {
        const jpeg = new File(klasor, `${medya_id}.jpg`);
        yazilanlar.push(jpeg);
        try {
          const { genislik, yukseklik } = await fotoKucult(ek.uri, jpeg);
          const boyut = boyutDenetle(jpeg, MEDYA_SINIRLARI.FOTO_BAYT);
          const hazir: HazirEk = {
            uri: jpeg.uri,
            mime: "image/jpeg",
            boyut,
            genislik: genislik >= 1 ? Math.round(genislik) : null,
            yukseklik: yukseklik >= 1 ? Math.round(yukseklik) : null,
            sure_ms: null,
            onizleme_uri: jpeg.uri,
          };
          return { ok: true, ek: hazir };
        } catch {
          // Küçültücü düştü (çözülemeyen biçim, bellek): özgün dosya `FOTO_BAYT` sınırıyla gider; PC
          // yine normalize eder. Özgünün EXIF'i durur (PC güven bölgesi).
          sessizSil(jpeg);
        }
        const kopya = new File(klasor, `${medya_id}.${uzantiAl(ek.mime)}`);
        yazilanlar.push(kopya);
        await kaynak.copy(kopya, { overwrite: true });
        const boyut = boyutDenetle(kopya, MEDYA_SINIRLARI.FOTO_BAYT);
        return {
          ok: true,
          ek: {
            uri: kopya.uri,
            mime: ek.mime,
            boyut,
            genislik: ek.genislik,
            yukseklik: ek.yukseklik,
            sure_ms: null,
            onizleme_uri: kopya.uri,
          },
        };
      }

      // Video: önce seçicinin beyanıyla erken ret (kopyalamadan), sonra kopyanın gerçek baytıyla.
      const sinir = turBaytSiniri("video");
      if (ek.boyut > sinir) return { ok: false, neden: "cok_buyuk" };
      const kopya = new File(klasor, `${medya_id}.${uzantiAl(ek.mime)}`);
      yazilanlar.push(kopya);
      await kaynak.copy(kopya, { overwrite: true });
      const boyut = boyutDenetle(kopya, sinir);
      const kapak = new File(klasor, `${medya_id}.kapak.jpg`);
      yazilanlar.push(kapak);
      const onizleme_uri = await kapakAl(kopya.uri, kapak, ek.sure_ms);
      return {
        ok: true,
        ek: {
          uri: kopya.uri,
          mime: ek.mime,
          boyut,
          genislik: ek.genislik,
          yukseklik: ek.yukseklik,
          sure_ms: ek.sure_ms,
          onizleme_uri,
        },
      };
    } catch (e) {
      for (const f of yazilanlar) sessizSil(f);
      return { ok: false, neden: e instanceof HazirlamaHatasi ? e.neden : "hata" };
    }
  };

  return {
    hazirla,

    async boyut(uri: string): Promise<number | null> {
      try {
        return dosyaBoyutu(new File(uri));
      } catch {
        return null;
      }
    },

    async oku(uri: string, ofset: number, uzunluk: number): Promise<Uint8Array> {
      if (!tamSayiMi(ofset) || !tamSayiMi(uzunluk)) throw new Error("gecersiz_aralik");
      const f = new File(uri);
      if (!f.exists) throw new Error("dosya_yok");
      const tutamac = f.open(FileMode.ReadOnly);
      try {
        const boyut = tutamac.size;
        if (boyut === null) throw new Error("okunamadi");
        const istenen = okunacakUzunluk(boyut, ofset, uzunluk);
        if (istenen === 0) return new Uint8Array(0);
        tutamac.offset = ofset;
        const ilk = await tutamac.readBytes(istenen);
        if (ilk.length === istenen) return ilk;
        // `readBytes` istenenden az dönebilir: dosya sonuna ya da istenene dek sürdür.
        const tampon = new Uint8Array(istenen);
        tampon.set(ilk, 0);
        let dolu = ilk.length;
        while (dolu < istenen) {
          const parca = await tutamac.readBytes(istenen - dolu);
          if (parca.length === 0) break;
          tampon.set(parca, dolu);
          dolu += parca.length;
        }
        return dolu === istenen ? tampon : tampon.slice(0, dolu);
      } finally {
        tutamac.close();
      }
    },

    async sil(uri: string): Promise<void> {
      // Yalnız kendi klasörümüz: opak adres bozulsa bile uygulama dışı bir dosya silinmez.
      if (!uri.startsWith(klasorOneki())) throw new Error("klasor_disi");
      const f = new File(uri);
      if (f.exists) f.delete();
    },

    async listele(): Promise<readonly string[]> {
      if (!klasor.exists) return [];
      return klasor.list().flatMap((o) => (o instanceof File ? [o.uri] : []));
    },
  };
};
