/**
 * `MedyaSeciciPortu` gerçeği (`expo-image-picker`). Galeri Android Photo Picker'dır (depolama izni
 * istemez); kamera izni yalnız kamera kaynağında, çalışma anında istenir. Sınır denetimi yapmaz: her
 * öğe ekranda `ekleriDenetle`'den geçer. Söz hiç reddedilmez. Günlüğe adres ya da içerik yazmaz.
 */
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { MEDYA_SINIRLARI } from "@eren/protocol";
import type { HamMedya, MedyaKaynagi, MedyaSecimSonucu, MedyaSeciciPortu } from "../cekirdek/sozlesme.ts";

/**
 * Kamera videosunun kayıt üst sınırı, sn. `MEDYA_SINIRLARI.VIDEO_SURE_MS` (300 sn) kameranın birkaç
 * ms taşmasıyla aşılmasın diye 5 sn altında. Android'de uygulanması kamera uygulamasına bağlıdır.
 */
export const KAMERA_VIDEO_AZAMI_SN = 295;

/** Seçicinin döndürdüğü öğenin bu dosyanın kullandığı alanları (`ImagePickerAsset`'in alt kümesi). */
export interface SeciciOgesi {
  uri: string;
  type?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

// Uzantıdan mime: yalnız `MEDYA_MIME`'daki türler; başkası `null` (denetim `tur_desteklenmiyor` der).
const UZANTI_MIME: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  "3gp": "video/3gpp",
  webm: "video/webm",
};

// Seçicilerin bilinen eş adları, kapalı listedeki karşılığına.
const MIME_ES_ADI: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "video/3gp": "video/3gpp",
};

const uzantisi = (ad: string): string | null => {
  const yol = ad.split(/[?#]/, 1)[0] ?? "";
  const son = yol.slice(yol.lastIndexOf("/") + 1);
  const nokta = son.lastIndexOf(".");
  return nokta > 0 && nokta < son.length - 1 ? son.slice(nokta + 1).toLowerCase() : null;
};

/**
 * Saf. Seçicinin `mimeType`'ı (küçük harfe, parametresiz, eş adı düzeltilmiş); yoksa dosya adının, o da
 * yoksa adresin uzantısından. Bilinmiyorsa `null`.
 */
export function mimeCikar(mimeType: string | null | undefined, fileName: string | null | undefined, uri: string): string | null {
  if (typeof mimeType === "string") {
    const m = (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase();
    if (m !== "") return MIME_ES_ADI[m] ?? m;
  }
  for (const ad of [fileName, uri]) {
    if (typeof ad !== "string" || ad === "") continue;
    const u = uzantisi(ad);
    if (u !== null) return UZANTI_MIME[u] ?? null;
  }
  return null;
}

/** Saf. Pozitif sonlu sayı ise tam sayıya yuvarlar (0 ya da yuvarlanınca 0 olan değer dahil `null`). */
export function pozitifTam(x: number | null | undefined): number | null {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const t = Math.round(x);
  return t >= 1 ? t : null;
}

/**
 * Saf. Seçici öğesini `HamMedya`'ya çevirir. `boyutOku` seçici boyut vermediğinde dosyadan okur
 * (`null`: okunamadı). `sure_ms` yalnız videoda.
 */
export function hamMedyaKur(o: SeciciOgesi, boyutOku: (uri: string) => number | null): HamMedya {
  const tur = o.type === "image" ? "foto" : o.type === "video" ? "video" : null;
  const boyut = pozitifTam(o.fileSize) ?? boyutOku(o.uri);
  return {
    uri: o.uri,
    tur,
    mime: mimeCikar(o.mimeType, o.fileName, o.uri),
    boyut,
    sure_ms: tur === "video" ? pozitifTam(o.duration) : null,
    genislik: pozitifTam(o.width),
    yukseklik: pozitifTam(o.height),
  };
}

/** Saf. Kaynağa göre seçici seçenekleri (`kalan` >= 1 varsayılır). */
export function seciciSecenekleri(kaynak: MedyaKaynagi, kalan: number): ImagePicker.ImagePickerOptions {
  const ortak = { exif: false, base64: false } as const;
  switch (kaynak) {
    case "galeri":
      return { ...ortak, mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: kalan };
    case "foto_cek":
      return { ...ortak, mediaTypes: ["images"] };
    case "video_cek":
      return { ...ortak, mediaTypes: ["videos"], videoMaxDuration: KAMERA_VIDEO_AZAMI_SN };
  }
}

// Seçicinin boyut vermediği öğe için dosyadan okur. Silinmiş ya da okunamayan dosya `null`.
const dosyaBoyutu = (uri: string): number | null => {
  try {
    const bilgi = new File(uri).info();
    return bilgi.exists ? pozitifTam(bilgi.size) : null;
  } catch {
    return null;
  }
};

/**
 * Port + Android'e özgü kurtarma (U5b). Android seçici ya da kamera açıkken `MainActivity`'yi
 * öldürürse sonuç kaybolur; uygulama yeniden açılınca `bekleyenSonuc` onu `getPendingResultAsync` ile
 * alır. Süreç başına bir kez sorar (sonraki çağrılar `null`). `null`: bekleyen sonuç yok ya da
 * kullanıcı vazgeçmişti. Kaynak bilinmez; en çok `EK_ADET` öğe döner (sınırları `ekleriDenetle` uygular).
 * Söz hiç reddedilmez. Port arayüzü (`sozlesme.ts`) değişmez: ekran yöntemi isteğe bağlı sınar.
 */
export interface MedyaSecici extends MedyaSeciciPortu {
  bekleyenSonuc(): Promise<MedyaSecimSonucu | null>;
}

export const medyaSeciciKur = (): MedyaSecici => {
  let soruldu = false;
  return {
    sec: secimYap,
    async bekleyenSonuc(): Promise<MedyaSecimSonucu | null> {
      if (soruldu) return null;
      soruldu = true;
      try {
        const r = await ImagePicker.getPendingResultAsync();
        if (r === null || r === undefined) return null;
        if ("code" in r) return { ok: false, neden: "hata" };
        if (r.canceled || !Array.isArray(r.assets) || r.assets.length === 0) return null;
        const ogeler = r.assets.slice(0, MEDYA_SINIRLARI.EK_ADET).map((o) => hamMedyaKur(o, dosyaBoyutu));
        return { ok: true, ogeler };
      } catch {
        return null;
      }
    },
  };
};

async function secimYap(kaynak: MedyaKaynagi, kalan: number): Promise<MedyaSecimSonucu> {
  const hak = Number.isFinite(kalan) ? Math.floor(kalan) : 0;
  if (hak < 1) return { ok: true, ogeler: [] };
  try {
    let sonuc: ImagePicker.ImagePickerResult;
    if (kaynak === "galeri") {
      sonuc = await ImagePicker.launchImageLibraryAsync(seciciSecenekleri(kaynak, hak));
    } else {
      const izin = await ImagePicker.requestCameraPermissionsAsync();
      if (!izin.granted) return { ok: false, neden: "izin_yok" };
      sonuc = await ImagePicker.launchCameraAsync(seciciSecenekleri(kaynak, hak));
    }
    if (sonuc.canceled || !Array.isArray(sonuc.assets)) return { ok: true, ogeler: [] };
    // Kamera tek öğe verir; galeri `selectionLimit`'i her sağlayıcıda uygulamayabilir.
    const ogeler = sonuc.assets.slice(0, kaynak === "galeri" ? hak : 1).map((o) => hamMedyaKur(o, dosyaBoyutu));
    return { ok: true, ogeler };
  } catch {
    return { ok: false, neden: "hata" };
  }
}
