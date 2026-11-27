/**
 * Geri almada ajanda sürümü koruması (docs/AJANDA.md "Geri alma kısıtı", "Sürüm uyumu" kural 8).
 *
 * Eski ajanda sürümünün servisi depoda kendi kayıt şemasına uymayan tek bir kayıt görünce tam telafiyi
 * bütün kayıtlar için `ic_hata` ile keser: telefonun ajanda eşitlemesi sessiz bir yeniden bağlanma
 * döngüsüne girer. Veri bozulmaz (şema değişmedi). Bu modül geri alınacak sürümün `AJANDA_SURUMU`'nu
 * ve depoda o sürümün çözemeyeceği kayıt olup olmadığını bulur, kurulum da buna göre uyarır.
 *
 * - Eski sürümün ajanda sürümü: `surumler/<sha>/protocol/src/sinirlar.ts` METİN olarak okunur (kod
 *   çalıştırılmaz, `sohbetSurumu` ile aynı düzen). Sabit 3f02bfc'den beri bu dosyadadır.
 * - Eski sürümün kayıt şeması: kaynak ağacının protokolündeki `AJANDA_GOVDE_SEMALARI[eski].Kaydi`.
 *   Servisin eski bağlantılara indirdiği şema budur; kaynak protokol eski sürümleri birebir taşır.
 *   v1 tabloda yoktur: v2 şeması ve `zaman.gun_bolumu` yokluğu (v2'nin v1'e eklediği tek kayıt alanı).
 * - Depo: `eren.db` salt okunur açılır (`readOnly`, `busy_timeout`); göç çalışmaz, yazılmaz. WAL
 *   kipinde servis açıkken de kapalıyken de okunabilir, okuyucu yazıcıyı beklemez. Silinmiş kayıtlar da
 *   sayılır: tam telafide onlar da gider.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncTipi } from "node:sqlite";
import { AJANDA_GOVDE_SEMALARI } from "../protocol/src/ajanda.ts";
import { AJANDA_SURUMLERI, AJANDA_SURUMU } from "../protocol/src/sinirlar.ts";

/** Sürüm dizinindeki `AJANDA_SURUMU`; dosya ya da sabit yoksa (ajanda öncesi sürüm) null. */
export const ajandaSurumuOku = (surumDizini: string): number | null => {
  try {
    const m = /^export const AJANDA_SURUMU\s*=\s*(\d+)/m.exec(readFileSync(join(surumDizini, "protocol", "src", "sinirlar.ts"), "utf8"));
    return m?.[1] === undefined ? null : Number(m[1]);
  } catch {
    return null;
  }
};

/**
 * Kaydı `surum` ajanda sürümünün kayıt şeması çözebilir mi. Çözemezse sorunlu alan yollarını döner
 * (ör. `bolge`, `zaman.gun_bolumu`), çözebilirse boş liste. `surum` kaynak protokolün en yeni
 * sürümünden ileriyse bilinemez: boş liste (denetim yalnız kaynağın bildiği eski sürümler içindir).
 */
export const eskiSurumunSorunlari = (kayit: unknown, surum: number): string[] => {
  if (surum >= AJANDA_SURUMU) return [];
  const enEski = AJANDA_SURUMLERI[0];
  const semaSurumu = (surum < enEski ? enEski : surum) as keyof typeof AJANDA_GOVDE_SEMALARI;
  const sorunlar = new Set<string>();
  const r = AJANDA_GOVDE_SEMALARI[semaSurumu].Kaydi.safeParse(kayit);
  if (!r.success) {
    for (const i of r.error.issues) {
      const yol = i.path.map(String);
      if (i.code === "unrecognized_keys") for (const k of i.keys) sorunlar.add([...yol, k].join("."));
      else sorunlar.add(yol.length > 0 ? yol.join(".") : "kayıt");
    }
  }
  if (surum < 2) {
    const zaman = (kayit as { zaman?: unknown } | null)?.zaman;
    if (typeof zaman === "object" && zaman !== null && "gun_bolumu" in zaman) sorunlar.add("zaman.gun_bolumu");
  }
  return [...sorunlar].sort();
};

export type DepoDenetimi =
  | { readonly tur: "uyumlu"; readonly toplam: number }
  | { readonly tur: "uyumsuz"; readonly toplam: number; readonly adet: number; readonly silinmis: number; readonly alanlar: readonly string[] }
  | { readonly tur: "okunamadi"; readonly sebep: string };

const sqliteAc = (yol: string): DatabaseSyncTipi => {
  // Tembel yükleme: kur.ts'i içe aktaran (eren.ts) her komut deneysel modülü yüklemesin.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(yol, { readOnly: true });
};

/** Depodaki ajanda kayıtlarını `surum`'ün şemasıyla denetler; salt okur, fırlatmaz. Depo ya da tablo yoksa uyumlu. */
export const depoyuDenetle = (vtYolu: string, surum: number): DepoDenetimi => {
  if (surum >= AJANDA_SURUMU || !existsSync(vtYolu)) return { tur: "uyumlu", toplam: 0 };
  let db: DatabaseSyncTipi | null = null;
  try {
    db = sqliteAc(vtYolu);
    db.exec("PRAGMA busy_timeout = 5000");
    const tablo = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ajanda_kayitlari'").get();
    if (tablo === undefined) return { tur: "uyumlu", toplam: 0 };
    const alanlar = new Set<string>();
    let toplam = 0;
    let adet = 0;
    let silinmis = 0;
    for (const satir of db.prepare("SELECT silindi, veri FROM ajanda_kayitlari").iterate()) {
      toplam += 1;
      let kayit: unknown;
      try {
        kayit = JSON.parse(String(satir.veri));
      } catch {
        kayit = null; // çözülemeyen satırı eski servis de çözemez
      }
      const s = kayit === null ? ["kayıt"] : eskiSurumunSorunlari(kayit, surum);
      if (s.length === 0) continue;
      adet += 1;
      if (Number(satir.silindi) !== 0) silinmis += 1;
      for (const a of s) alanlar.add(a);
    }
    return adet === 0 ? { tur: "uyumlu", toplam } : { tur: "uyumsuz", toplam, adet, silinmis, alanlar: [...alanlar].sort() };
  } catch (e) {
    return { tur: "okunamadi", sebep: (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0] ?? "" };
  } finally {
    try {
      db?.close();
    } catch {
      // kapanış hatası sonucu değiştirmez
    }
  }
};

/**
 * Geri alınan sürüm (`geriAlinanDizini`) depodaki ajanda kayıtlarını çözemiyorsa ya da bu
 * denetlenemediyse tek satır uyarı metni; sorun yoksa null. Geri almayı engellemez (gerekçe kur.ts
 * `etkinlestir`): veri bozulmaz, kararsız sürümde kalmak servisin tamamını düşürür.
 */
export const ajandaGeriAlmaUyarisi = (geriAlinan: string, geriAlinanDizini: string, vtYolu: string): string | null => {
  const eski = ajandaSurumuOku(geriAlinanDizini);
  if (eski === null || eski >= AJANDA_SURUMU) return null;
  const d = depoyuDenetle(vtYolu, eski);
  const etki =
    `eski servis ajanda tam telafisini bütün kayıtlar için ic_hata ile keser, telefonun ajanda eşitlemesi ` +
    `ajanda v${AJANDA_SURUMU} servisine dönülene kadar yeniden bağlanma döngüsünde kalır (veri bozulmaz; AJANDA.md "Geri alma kısıtı")`;
  if (d.tur === "uyumlu") return null;
  if (d.tur === "okunamadi") {
    return `Uyarı: geri alınan sürüm (${geriAlinan}, ajanda v${eski}) için depodaki ajanda kayıtları denetlenemedi (${d.sebep}); ` +
      `v${eski} şemasına uymayan kayıt varsa ${etki}.`;
  }
  const sil = d.silinmis > 0 ? `, ${d.silinmis}'i silinmiş` : "";
  return `Uyarı: geri alınan sürüm (${geriAlinan}, ajanda v${eski}) depodaki ${d.toplam} ajanda kaydından ${d.adet}'ini çözemez` +
    `${sil} (alanlar: ${d.alanlar.join(", ")}): ${etki}.`;
};
