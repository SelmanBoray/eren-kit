import { z } from "zod";
import { kanonikJson } from "./kanonik.ts";
import { AJANDA_SINIRLARI } from "./sinirlar.ts";
import { planMetni, planSatiri } from "./temel.ts";

/**
 * Ajandanın zaman, hatırlatma ve tekrar şemaları. Saat dilimi veritabanı kullanılmaz (Hermes ve
 * Kotlin aynı sonucu versin diye): burada yalnız biçim ve takvim geçerliliği denetlenir. Duvar
 * saatinden ana çeviri ve yaz saati kuralı: `docs/AJANDA.md`, "Zaman".
 */

// Metin

/**
 * Ajandanın tek satırlık metni: satır sonu, sekme, görünmez ve yön karakteri, bozuk vekil yok;
 * uzunluk UTF-16 birimi (zod `max` kod noktası sayar); baştaki ya da sondaki boşluk yok.
 */
export function ajandaSatiri(en: number, boy: number) {
  return planSatiri(en, boy)
    .refine((s) => s.length <= boy, { message: "çok uzun (UTF-16 birimi)" })
    .refine((s) => s.trim() === s, { message: "baştaki ya da sondaki boşluk" });
}

/** Ajandanın çok satırlı metni: `\t \n \r` serbest, görünmez ve yön karakteri yok, boş olamaz. */
export function ajandaMetni(boy: number) {
  return planMetni(1, boy)
    .refine((s) => s.length <= boy, { message: "çok uzun (UTF-16 birimi)" })
    .refine((s) => s.trim().length > 0, { message: "yalnız boşluk" });
}

// Takvim

const TARIH_DESENI = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAAT_DESENI = /^([01]\d|2[0-3]):([0-5]\d)$/;

function artikYilMi(yil: number): boolean {
  return (yil % 4 === 0 && yil % 100 !== 0) || yil % 400 === 0;
}

function aydakiGun(yil: number, ay: number): number {
  if (ay === 2) return artikYilMi(yil) ? 29 : 28;
  return ay === 4 || ay === 6 || ay === 9 || ay === 11 ? 30 : 31;
}

/** `YYYY-MM-DD` gerçek bir Gregoryen günü ve `YIL_MIN`-`YIL_MAX` içindeyse doğrudur. */
export function gercekTarihMi(metin: string): boolean {
  const e = TARIH_DESENI.exec(metin);
  if (e === null) return false;
  const yil = Number(e[1]);
  const ay = Number(e[2]);
  const gun = Number(e[3]);
  if (yil < AJANDA_SINIRLARI.YIL_MIN || yil > AJANDA_SINIRLARI.YIL_MAX) return false;
  return ay >= 1 && ay <= 12 && gun >= 1 && gun <= aydakiGun(yil, ay);
}

/** 1970-01-01'den bu yana gün (proleptik Gregoryen, saat dilimsiz). Geçerli tarih ister. */
export function tarihGunNo(tarih: string): number {
  const e = TARIH_DESENI.exec(tarih);
  if (e === null || !gercekTarihMi(tarih)) throw new RangeError("geçersiz tarih");
  const ay = Number(e[2]);
  const gun = Number(e[3]);
  const yil = Number(e[1]) - (ay <= 2 ? 1 : 0);
  const devir = Math.floor(yil / 400);
  const devirYili = yil - devir * 400;
  const yilGunu = Math.floor((153 * ((ay + 9) % 12) + 2) / 5) + gun - 1;
  const devirGunu = devirYili * 365 + Math.floor(devirYili / 4) - Math.floor(devirYili / 100) + yilGunu;
  return devir * 146_097 + devirGunu - 719_468;
}

/** Yerel takvim günü, `YYYY-MM-DD`. Sözlük sırası takvim sırasıdır. */
export const Tarih = z
  .string()
  .regex(TARIH_DESENI)
  .refine(gercekTarihMi, { message: "takvimde olmayan gün ya da yıl sınır dışı" })
  .describe("Yerel takvim günü, YYYY-MM-DD.");
export type Tarih = z.infer<typeof Tarih>;

/** Yerel duvar saati, `HH:MM`, 24 saat. Saniye yoktur. */
export const Saat = z.string().regex(SAAT_DESENI).describe("Yerel duvar saati, HH:MM (24 saat).");
export type Saat = z.infer<typeof Saat>;

/**
 * IANA saat dilimi adı (`Europe/Istanbul`, `America/Argentina/Buenos_Aires`, `Etc/GMT+3`, `UTC`).
 * Burada yalnız biçim denetlenir; adın gerçekten var olduğunu servis denetler
 * (`saat_dilimi_bilinmiyor`).
 */
export const SaatDilimi = z
  .string()
  .min(1)
  .max(AJANDA_SINIRLARI.SAAT_DILIMI)
  .regex(/^(?:UTC|[A-Z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2})$/)
  .describe("IANA saat dilimi adı, örnek Europe/Istanbul.");
export type SaatDilimi = z.infer<typeof SaatDilimi>;

// Zaman

export const ZAMAN_KESINLIKLERI = ["an", "gun", "donem", "belirsiz"] as const;
export const ZamanKesinligi = z.enum(ZAMAN_KESINLIKLERI);
export type ZamanKesinligi = z.infer<typeof ZamanKesinligi>;

const Ifade = ajandaSatiri(1, AJANDA_SINIRLARI.ZAMAN_IFADESI).describe(
  "Kullanıcının zaman ifadesi, birebir (örnek: yarın 3'te). Yorumlanmaz, düzeltilmez.",
);

function donemGecerliMi(d: { baslangic: string; bitis: string }): boolean {
  if (!gercekTarihMi(d.baslangic) || !gercekTarihMi(d.bitis)) return true; // alan hatası zaten var
  const fark = tarihGunNo(d.bitis) - tarihGunNo(d.baslangic);
  return fark >= 0 && fark < AJANDA_SINIRLARI.DONEM_GUN;
}

/**
 * Zamanın dört biçimi. `dilim` kablo kaydında zorunlu `SaatDilimi`, araç girdisinde isteğe bağlıdır
 * (servis varsayılan dilimi koyar). Saat söylenmediyse `gun`, gün aralığıysa `donem`, takvime
 * oturmuyorsa `belirsiz`: saat ya da gün uydurulmaz.
 */
function zamanSemasi<D extends z.ZodType>(dilim: D) {
  return z.discriminatedUnion("kesinlik", [
    z
      .strictObject({
        kesinlik: z.literal("an"),
        tarih: Tarih,
        saat: Saat,
        /** Randevunun süresi, dakika. Yoksa bitiş bilinmiyor. */
        sure_dk: z.number().int().min(1).max(AJANDA_SINIRLARI.SURE_DK).optional(),
        saat_dilimi: dilim,
        ifade: Ifade.optional(),
      })
      .describe("Gün ve saat belli."),
    z
      .strictObject({ kesinlik: z.literal("gun"), tarih: Tarih, saat_dilimi: dilim, ifade: Ifade.optional() })
      .describe("Gün belli, saat söylenmedi."),
    z
      .strictObject({
        kesinlik: z.literal("donem"),
        baslangic: Tarih,
        bitis: Tarih,
        saat_dilimi: dilim,
        ifade: Ifade.optional(),
      })
      .refine(donemGecerliMi, { message: "bitis baslangictan önce ya da dönem çok uzun", path: ["bitis"] })
      .describe("Gün aralığı (iki uç dahil), örnek: gelecek hafta."),
    z
      .strictObject({ kesinlik: z.literal("belirsiz"), ifade: Ifade })
      .describe("Takvime oturmayan zaman (örnek: bir ara); yalnız ifade saklanır."),
  ]);
}

/** Kablo kaydının zamanı: saat dilimi (belirsiz hariç) zorunlu. */
export const AjandaZamani = zamanSemasi(SaatDilimi);
export type AjandaZamani = z.infer<typeof AjandaZamani>;

/** Araç girdisinin zamanı: saat dilimi verilmezse servis varsayılanı koyar. */
export const AjandaZamaniGirdisi = zamanSemasi(SaatDilimi.optional());
export type AjandaZamaniGirdisi = z.infer<typeof AjandaZamaniGirdisi>;

// Hatırlatma

function hatirlatmaSemasi<D extends z.ZodType>(dilim: D) {
  return z.discriminatedUnion("tur", [
    z
      .strictObject({
        tur: z.literal("once"),
        dk: z.number().int().min(0).max(AJANDA_SINIRLARI.HATIRLATMA_ONCE_DK),
      })
      .describe("Kaydın anından dk dakika önce. Yalnız kesinlik an iken; tekrar eden kayıtta her örnek için."),
    z
      .strictObject({ tur: z.literal("mutlak"), tarih: Tarih, saat: Saat, saat_dilimi: dilim })
      .describe("Belirli bir yerel an (bir kez)."),
  ]);
}

export const Hatirlatma = hatirlatmaSemasi(SaatDilimi);
export type Hatirlatma = z.infer<typeof Hatirlatma>;
export const HatirlatmaGirdisi = hatirlatmaSemasi(SaatDilimi.optional());
export type HatirlatmaGirdisi = z.infer<typeof HatirlatmaGirdisi>;

function tekilMi(liste: readonly unknown[]): boolean {
  return new Set(liste.map((o) => kanonikJson(o))).size === liste.length;
}

function hatirlatmaListesi<S extends z.ZodType>(oge: S) {
  return z
    .array(oge)
    .max(AJANDA_SINIRLARI.HATIRLATMA_ADET)
    .refine(tekilMi, { message: "yinelenen hatırlatma" });
}

export const Hatirlatmalar = hatirlatmaListesi(Hatirlatma);
export const HatirlatmaGirdileri = hatirlatmaListesi(HatirlatmaGirdisi);

/**
 * Girdide `hatirlatmalar` verilmeyen ve zamanı `an` olan kayda servisin koyduğu liste. Açık boş
 * dizi ("hatırlatma istemiyorum") varsayılanı almaz. Uygulamanın elle ekleme ekranı da bununla açılır.
 */
export const AJANDA_VARSAYILAN_HATIRLATMALAR: readonly Hatirlatma[] = [{ tur: "once", dk: 60 }];

// Tekrar

export const HAFTA_GUNLERI = ["pzt", "sal", "car", "per", "cum", "cmt", "paz"] as const;
export const HaftaGunu = z.enum(HAFTA_GUNLERI);
export type HaftaGunu = z.infer<typeof HaftaGunu>;

export const TEKRAR_SIKLIKLARI = ["gunluk", "haftalik", "aylik", "yillik"] as const;
export const TekrarSikligi = z.enum(TEKRAR_SIKLIKLARI);

/**
 * Tekrar kuralı (RFC 5545 RRULE'un altkümesi). Çapa kaydın `zaman.tarih`'idir (zaman `an` ya da `gun`
 * olmalı). `gunler` yalnız haftalıkta, hafta sırasıyla ve tekil. Aylıkta ayda olmayan gün (31)
 * o ay atlanır. `bitis_tarihi` ile `adet` birlikte verilemez; ikisi de yoksa sonsuz.
 * İlk dilimde üreten yoktur (araç ve elle ekleme vermez); kablo kabul eder.
 */
export const Tekrar = z
  .strictObject({
    siklik: TekrarSikligi,
    aralik: z.number().int().min(1).max(AJANDA_SINIRLARI.TEKRAR_ARALIK),
    gunler: z.array(HaftaGunu).min(1).max(7).optional(),
    bitis_tarihi: Tarih.optional(),
    adet: z.number().int().min(1).max(AJANDA_SINIRLARI.TEKRAR_ADET).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.gunler !== undefined) {
      if (t.siklik !== "haftalik") {
        ctx.addIssue({ code: "custom", path: ["gunler"], message: "gunler yalnız haftalık tekrarda" });
      }
      const sira = t.gunler.map((g) => HAFTA_GUNLERI.indexOf(g));
      if (!sira.every((s, i) => i === 0 || sira[i - 1]! < s)) {
        ctx.addIssue({ code: "custom", path: ["gunler"], message: "gunler hafta sırasıyla ve tekil" });
      }
    }
    if (t.bitis_tarihi !== undefined && t.adet !== undefined) {
      ctx.addIssue({ code: "custom", path: ["adet"], message: "bitis_tarihi ile adet birlikte olmaz" });
    }
  });
export type Tekrar = z.infer<typeof Tekrar>;

/**
 * Zaman, hatırlatma ve tekrarın birbirine bağlı kuralları: `once` hatırlatması `an` ister; tekrar
 * `an` ya da `gun` ister ve bitişi çapadan önce olamaz. Kayıt, ekleme ve araç girdisi bunu paylaşır.
 */
export function zamanKurallari(
  g: {
    zaman?: { kesinlik: string; tarih?: string } | null | undefined;
    hatirlatmalar?: readonly { tur: string }[] | undefined;
    tekrar?: Tekrar | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const kesinlik = g.zaman?.kesinlik;
  if (g.hatirlatmalar?.some((h) => h.tur === "once") === true && kesinlik !== "an") {
    ctx.addIssue({ code: "custom", path: ["hatirlatmalar"], message: "once hatırlatması zaman kesinliği an ister" });
  }
  if (g.tekrar !== undefined && g.tekrar !== null) {
    if (kesinlik !== "an" && kesinlik !== "gun") {
      ctx.addIssue({ code: "custom", path: ["tekrar"], message: "tekrar zaman kesinliği an ya da gun ister" });
    } else if (g.tekrar.bitis_tarihi !== undefined && g.zaman?.tarih !== undefined && g.tekrar.bitis_tarihi < g.zaman.tarih) {
      ctx.addIssue({ code: "custom", path: ["tekrar", "bitis_tarihi"], message: "tekrar bitişi çapadan önce" });
    }
  }
}
