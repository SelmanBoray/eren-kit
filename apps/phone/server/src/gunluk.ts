/**
 * JSON satırı günlüğü: `{ts_ms, seviye, modul, olay, ...alanlar}`. Yalnız `KayitPortu`'na yazar,
 * stdout'a asla. Hiç atmaz. Gizli anahtarlar maskelenir, uzun metin kırpılır. MODULLER.md, "gunluk".
 */
import type { GunlukAlanlari, GunlukBagimliliklari, GunlukFabrikasi } from "./sozlesme.ts";

const GIZLI_ANAHTARLAR: ReadonlySet<string> = new Set([
  "jeton",
  "token",
  "signature",
  "imza",
  "text",
  "metin",
  "cevap",
  "ozet",
  "gorev",
  "gorev_metni",
  "soru",
  "rapor",
  "kod",
]);

const AZAMI_METIN = 500;
const ZORUNLU_ANAHTARLAR: ReadonlySet<string> = new Set(["ts_ms", "seviye", "modul", "olay"]);

/** Büyük küçük harf duyarsız; Türkçe `İ`/`ı` farkı da aynı anahtara iner. */
const anahtarNormalle = (k: string): string =>
  k.toLowerCase().replace(/̇/g, "").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g");

/** İlk 500 UTF-16 birimi (vekil çifti bölünmez) + `...[kirpildi N]`. */
const metinKirp = (s: string): string => {
  if (s.length <= AZAMI_METIN) return s;
  let son = AZAMI_METIN;
  const kod = s.charCodeAt(son - 1);
  if (kod >= 0xd800 && kod <= 0xdbff) son -= 1;
  return `${s.slice(0, son)}...[kirpildi ${s.length - son}]`;
};

const degerTemizle = (v: unknown): string | number | boolean | null | undefined => {
  if (v === null) return null;
  if (typeof v === "string") return metinKirp(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (v === undefined) return undefined;
  // Tipler izin vermez ama çalışma anında nesne gelirse içeriği sızdırma.
  return "[desteklenmeyen]";
};

function satirKur(
  seviye: "bilgi" | "uyari" | "hata",
  modul: string,
  olay: string,
  alanlar: GunlukAlanlari | undefined,
  tsMs: number,
): string {
  const nesne: Record<string, unknown> = { ts_ms: tsMs, seviye, modul, olay };
  if (alanlar !== undefined && alanlar !== null && typeof alanlar === "object") {
    for (const ham of Object.keys(alanlar)) {
      const ad = ZORUNLU_ANAHTARLAR.has(ham) ? `alan_${ham}` : ham;
      const deger = GIZLI_ANAHTARLAR.has(anahtarNormalle(ham))
        ? "[gizli]"
        : degerTemizle((alanlar as Record<string, unknown>)[ham]);
      if (deger !== undefined) nesne[ad] = deger;
    }
  }
  return JSON.stringify(nesne);
}

export const gunlukKur: GunlukFabrikasi = (b: GunlukBagimliliklari) => {
  const yaz =
    (seviye: "bilgi" | "uyari" | "hata") =>
    (modul: string, olay: string, alanlar?: GunlukAlanlari): void => {
      let satir: string;
      try {
        let ts = 0;
        try {
          ts = b.saat.simdiMs();
        } catch {
          // saat bozuksa 0
        }
        satir = satirKur(seviye, String(modul), String(olay), alanlar, ts);
      } catch {
        return;
      }
      try {
        b.kayit.satirEkle(satir);
      } catch {
        // port hatası yutulur
      }
      try {
        if (b.kayit.boyut() > b.azamiBayt) b.kayit.dondur(b.azamiDosya);
      } catch {
        // port hatası yutulur
      }
    };
  return { bilgi: yaz("bilgi"), uyari: yaz("uyari"), hata: yaz("hata") };
};
