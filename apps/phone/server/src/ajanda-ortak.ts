import {
  AJANDA_ALANLARI,
  type AjandaAlani,
  AjandaKaydi,
  type AjandaKayitOzeti,
  type AjandaParca,
  type AjandaRetNedeni,
  type AjandaZamani,
  type AjandaZamaniGirdisi,
  ajandaZamanOzeti,
  type Hatirlatma,
  type HatirlatmaGirdisi,
  hatirlatmaOzeti,
  kanonikJson,
} from "@eren/protocol";
import type { AjandaBagimliliklari, AjandaDegisiklikYazimi, TakvimPortu } from "./sozlesme.ts";

/**
 * Ajanda modülünün iç yardımcıları (`ajanda.ts` ve `ajanda-araclar.ts` paylaşır): adım sonucu, geçmiş
 * parçası (fark), dilim doldurma ve denetimi, doğrulayıp yazma, araç çıktısının kayıt özeti. Kayıt
 * metni hiçbir yerde günlüğe gitmez; burada günlük yok.
 */

export const MODUL = "ajanda";

/** Bir kural adımının sonucu: değer ya da kapalı listeden ret nedeni. */
export type Adim<T> = { ok: true; deger: T } | { ok: false; neden: AjandaRetNedeni };
export const reddet = (neden: AjandaRetNedeni): { ok: false; neden: AjandaRetNedeni } => ({ ok: false, neden });

/** Kaydın yazılacak hali: `revizyon` ve `guncelleme_ms`'i depo koyar. */
export type YeniHal = AjandaDegisiklikYazimi["kayit"];
export type GecmisGovdesi = AjandaDegisiklikYazimi["girdi"];

export type AjandaDeposu = AjandaBagimliliklari["depo"];

export function govde(k: AjandaKaydi): YeniHal {
  const { revizyon: _r, guncelleme_ms: _g, ...geri } = k;
  return geri;
}

/** Geçmişte izlenen alanlar: kayıt alanları + taslak ve silinme. `ornekler` ayrıca (tam liste). */
const IZLENEN = [...AJANDA_ALANLARI, "taslak", "silindi"] as const;

/**
 * İki hal arasındaki fark: yalnız değişen alanların öncesi ve sonrası (`AjandaParca`). Olmayan alan
 * `null`. `ornekler` değiştiyse iki tam liste (budama ya da `ORNEK_ADET` atması geçmişte durur).
 */
export function fark(
  once: YeniHal,
  sonra: YeniHal,
  sec: { ornekler?: boolean } = {},
): { onceki: AjandaParca; sonraki: AjandaParca } {
  const onceki: Record<string, unknown> = {};
  const sonraki: Record<string, unknown> = {};
  for (const alan of IZLENEN) {
    const a = once[alan] ?? null;
    const s = sonra[alan] ?? null;
    if (kanonikJson(a) === kanonikJson(s)) continue;
    onceki[alan] = a;
    sonraki[alan] = s;
  }
  if (sec.ornekler !== false && kanonikJson(once.ornekler) !== kanonikJson(sonra.ornekler)) {
    onceki.ornekler = once.ornekler;
    sonraki.ornekler = sonra.ornekler;
  }
  return { onceki: onceki as AjandaParca, sonraki: sonraki as AjandaParca };
}

/** Doğan kaydın geçmiş parçası: kaydın var olan alanları, durum ve taslak. */
export function dogumParcasi(k: YeniHal): AjandaParca {
  const p: Record<string, unknown> = {};
  for (const alan of AJANDA_ALANLARI) if (k[alan] !== undefined) p[alan] = k[alan];
  p.taslak = k.taslak;
  return p as AjandaParca;
}

/** Kaydın var olan alanları (kanonik sırada): emirle doğan kaydın `elle_alanlar`'ı için. */
export function verilenAlanlar(g: Partial<Record<AjandaAlani, unknown>>, haric: readonly AjandaAlani[] = ["durum"]): AjandaAlani[] {
  return AJANDA_ALANLARI.filter((a) => !haric.includes(a) && g[a] !== undefined);
}

// Dilim

/** Araç zamanının dilimi verilmemişse turun mesaj anının dilimi (`AJANDA.md` "Araç yolu"). */
export function zamanDoldur(z: AjandaZamaniGirdisi, dilim: string): AjandaZamani {
  if (z.kesinlik === "belirsiz") return z;
  return { ...z, saat_dilimi: z.saat_dilimi ?? dilim };
}

export function hatirlatmaDoldur(h: HatirlatmaGirdisi, dilim: string): Hatirlatma {
  if (h.tur === "once") return h;
  return { ...h, saat_dilimi: h.saat_dilimi ?? dilim };
}

/** Zamanın ve `mutlak` hatırlatmaların dilimi servisin veritabanında var mı (`saat_dilimi_bilinmiyor`). */
export function dilimlerBilinir(
  takvim: TakvimPortu,
  zaman: AjandaZamani | null | undefined,
  hatirlatmalar: readonly Hatirlatma[] | undefined,
): boolean {
  if (zaman !== null && zaman !== undefined && zaman.kesinlik !== "belirsiz" && !takvim.dilimBiliniyorMu(zaman.saat_dilimi)) {
    return false;
  }
  return (hatirlatmalar ?? []).every((h) => h.tur !== "mutlak" || takvim.dilimBiliniyorMu(h.saat_dilimi));
}

/** Kaydın kendi dilimi (`belirsiz` ya da zamansızda yok). */
export function kayitDilimi(k: Pick<AjandaKaydi, "zaman">): string | undefined {
  return k.zaman === undefined || k.zaman.kesinlik === "belirsiz" ? undefined : k.zaman.saat_dilimi;
}

// Yazım

/**
 * Yeni hali `AjandaKaydi` ile doğrular (bozuksa `tutarsiz_kayit`, hiçbir şey yazılmaz), sonra depoya
 * tek değişiklik olarak yazar. Depo atarsa (veritabanı, iç tutarlılık) hata yukarı gider: çağıran
 * işlemi geri alır ve `ic_hata` döner.
 */
export function dogrulaVeYaz(
  depo: AjandaDeposu,
  yeni: YeniHal,
  revizyon: number,
  girdi: GecmisGovdesi,
  ts_ms: number,
): Adim<AjandaKaydi> {
  if (!AjandaKaydi.safeParse({ ...yeni, revizyon, guncelleme_ms: ts_ms }).success) return reddet("tutarsiz_kayit");
  return { ok: true, deger: depo.ajandaDegisiklikYaz({ kayit: yeni, girdi, ts_ms }) };
}

/**
 * Değişikliğin anı: servis saati, ama kaydın son güncellemesinden geri değil (saat geri alınsa da
 * `guncelleme_ms >= olusturma_ms` ve kayıt başına zaman sırası korunur).
 */
export function degisiklikAni(simdi: number, onceki: Pick<AjandaKaydi, "guncelleme_ms"> | null): number {
  return onceki === null ? simdi : Math.max(simdi, onceki.guncelleme_ms);
}

/** Araç çıktısının kayıt özeti: metin taşımaz (`AjandaKayitOzeti`). */
export function kayitOzeti(k: AjandaKaydi, simdiMs: number, takvim: TakvimPortu): AjandaKayitOzeti {
  const ozet: AjandaKayitOzeti = {
    kayit_id: k.kayit_id,
    revizyon: k.revizyon,
    durum: k.durum,
    taslak: k.taslak,
    silindi: k.silindi,
    hatirlatma: hatirlatmaOzeti(k, simdiMs, takvim.anCevir),
  };
  if (k.zaman !== undefined) ozet.zaman = ajandaZamanOzeti(k.zaman);
  return ozet;
}
