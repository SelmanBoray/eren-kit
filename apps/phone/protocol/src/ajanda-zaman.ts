import { z } from "zod";
import { iyiBicimliMi, kanonikJson } from "./kanonik.ts";
import { AJANDA_SINIRLARI } from "./sinirlar.ts";

/**
 * Ajandanın zaman, hatırlatma ve tekrar şemaları. Saat dilimi veritabanı kullanılmaz (Hermes ve
 * Kotlin aynı sonucu versin diye): burada yalnız biçim ve takvim geçerliliği denetlenir. Duvar
 * saatinden ana çeviri ve yaz saati kuralı: `docs/AJANDA.md`, "Zaman".
 */

// Metin

/**
 * Ajanda metninde yasak kod noktaları (iki uç dahil; tek istisna bağlamındaki
 * `AJANDA_EMOJI_BIRLESTIRICILERI`) ve modele hep kaçışla giden kod noktaları (`ajandaKacir`, istisnasız).
 * Kod noktasına bakılır, UTF-16 birimine değil:
 * etiket (U+E0000-E0FFF) ve değişken seçici (U+FE00-FE0F, U+E0100-E01EF) karakterleri görünmeden
 * metin taşıyabilir. Kapsam: kontrol karakterleri (C0, DEL, C1; sekme ve satır sonları hariç, onlar
 * şemada ayrıca denetlenir), Unicode `Default_Ignorable_Code_Point` kümesinin tamamı, satır ve
 * paragraf ayırıcıları, ara metin işaretleri (U+FFF9-FFFB), Mısır hiyeroglif biçim denetimleri.
 * `gorunmezBirimMi`'nin (eski kanallar) üst kümesidir. Liste kapalıdır ve vektörde birebir durur:
 * Unicode sürümüne göre değişmesin diye çalışma anı özellik tablosu kullanılmaz.
 */
export const AJANDA_GORUNMEZ_ARALIKLARI: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfffb],
  [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

export function ajandaGorunmezMi(kodNoktasi: number): boolean {
  for (const [bas, son] of AJANDA_GORUNMEZ_ARALIKLARI) {
    if (kodNoktasi < bas) return false;
    if (kodNoktasi <= son) return true;
  }
  return false;
}

/**
 * Gündelik emojinin parçası olan üç tablo karakteri: sıfır genişlikli birleştirici (U+200D, aile ve
 * meslek emojileri) ve sunum seçicileri (U+FE0E metin, U+FE0F emoji: `☕️`, `❤️`). Tablodadırlar ve
 * modele hep görünür kaçışla gider (`ajandaKacir`); kayıt metninde yalnız bağlamında kabul edilir
 * (`ajandaGorunmezVarMi`). Öteki değişken seçiciler (U+FE00-FE0D, U+E0100-E01EF) ve etiketler, bayt
 * kaçırma yolu oldukları için hiçbir bağlamda kabul edilmez.
 */
export const AJANDA_EMOJI_BIRLESTIRICILERI = [0x200d, 0xfe0e, 0xfe0f] as const;

/** Sunum seçicisinin ve birleştiricinin dayanabileceği karakter: tabloda değil, boşluk değil. */
function emojiTabaniMi(k: number | undefined): boolean {
  return k !== undefined && k !== 0x20 && k !== 0x09 && k !== 0x0a && k !== 0x0d && !ajandaGorunmezMi(k);
}

/**
 * Metinde kabul edilmeyen görünmez kod noktası var mı. Tablodaki her kod noktası yasaktır; tek
 * istisna `AJANDA_EMOJI_BIRLESTIRICILERI`'nin bağlamıdır (kod noktası dizisinde):
 * - U+FE0E, U+FE0F: hemen önünde taban karakter (tabloda değil, boşluk değil) varsa.
 * - U+200D: önünde taban ya da kabul edilmiş U+FE0F, hemen arkasında taban varsa.
 * Böylece seçici ya da birleştirici zincirlenemez, başta, sonda ve boşluk yanında duramaz: görünür
 * karakter başına en çok bir seçici ve bir birleştirici. Eşsiz vekil burada sayılmaz (`iyiBicimliMi`).
 */
export function ajandaGorunmezVarMi(metin: string): boolean {
  const kn = Array.from(metin, (c) => c.codePointAt(0)!);
  for (let i = 0; i < kn.length; i++) {
    const k = kn[i]!;
    if (!ajandaGorunmezMi(k)) continue;
    const once = kn[i - 1];
    if ((k === 0xfe0e || k === 0xfe0f) && emojiTabaniMi(once)) continue;
    if (k === 0x200d && (emojiTabaniMi(once) || once === 0xfe0f) && emojiTabaniMi(kn[i + 1])) continue;
    return true;
  }
  return false;
}

/**
 * Uygulamanın giriş temizliği: `ajandaGorunmezVarMi`'nin kabul etmediği her kod noktasını ve eşsiz
 * vekili atar; bağlamındaki emoji birleştiricilerini korur (`☕️`, aile emojisi olduğu gibi kalır).
 * Çıktı hep `ajandaGorunmezVarMi` yanlış ve iyi biçimlidir; geçerli metinde kimliktir. Satır sonu,
 * sekme ve kenar boşluğu bu işin dışındadır (alanın kuralı). Köprü ve servis temizlemez, doğrular:
 * `ifade` ve `alinti` birebir saklanır.
 */
export function ajandaMetniTemizle(metin: string): string {
  const cikti: number[] = [];
  let bekleyenZwj = false; // son eklenen U+200D: arkasından taban gelmezse atılır
  for (const c of metin) {
    const k = c.codePointAt(0)!;
    if (k >= 0xd800 && k <= 0xdfff) continue;
    if (bekleyenZwj && !emojiTabaniMi(k)) cikti.pop();
    bekleyenZwj = false;
    const son = cikti[cikti.length - 1];
    if (!ajandaGorunmezMi(k)) cikti.push(k);
    else if ((k === 0xfe0e || k === 0xfe0f) && emojiTabaniMi(son)) cikti.push(k);
    else if (k === 0x200d && (emojiTabaniMi(son) || son === 0xfe0f)) {
      cikti.push(k);
      bekleyenZwj = true;
    }
  }
  if (bekleyenZwj) cikti.pop();
  let sonuc = "";
  for (const k of cikti) sonuc += String.fromCodePoint(k);
  return sonuc;
}

const SATIR_SONU = /[\t\n\r]/;

/**
 * Ajandanın tek satırlık metni: satır sonu, sekme, kabul edilmeyen görünmez kod noktası
 * (`ajandaGorunmezVarMi`), bozuk vekil yok; uzunluk UTF-16 birimi; baştaki ya da sondaki boşluk yok.
 */
export function ajandaSatiri(en: number, boy: number) {
  return z
    .string()
    .min(en)
    .max(boy)
    .refine((s) => s.length <= boy, { message: "çok uzun (UTF-16 birimi)" })
    .refine((s) => !SATIR_SONU.test(s) && iyiBicimliMi(s), { message: "satır sonu ya da bozuk vekil" })
    .refine((s) => !ajandaGorunmezVarMi(s), { message: "görünmez ya da yok sayılan karakter" })
    .refine((s) => s.trim() === s, { message: "baştaki ya da sondaki boşluk" });
}

/** Ajandanın çok satırlı metni: `\t \n \r` serbest, kabul edilmeyen görünmez kod noktası yok, boş olamaz. */
export function ajandaMetni(boy: number) {
  return z
    .string()
    .min(1)
    .max(boy)
    .refine((s) => s.length <= boy, { message: "çok uzun (UTF-16 birimi)" })
    .refine((s) => iyiBicimliMi(s), { message: "bozuk vekil" })
    .refine((s) => !ajandaGorunmezVarMi(s), { message: "görünmez ya da yok sayılan karakter" })
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

const iki = (n: number) => (n < 10 ? "0" : "") + n;

/** `tarihGunNo`'nun tersi: gün numarasından `YYYY-MM-DD` (proleptik Gregoryen). */
export function gunNoTarih(gunNo: number): string {
  const z = gunNo + 719_468;
  const devir = Math.floor(z / 146_097);
  const devirGunu = z - devir * 146_097;
  const devirYili = Math.floor(
    (devirGunu - Math.floor(devirGunu / 1_460) + Math.floor(devirGunu / 36_524) - Math.floor(devirGunu / 146_096)) / 365,
  );
  const yilGunu = devirGunu - (365 * devirYili + Math.floor(devirYili / 4) - Math.floor(devirYili / 100));
  const mp = Math.floor((5 * yilGunu + 2) / 153);
  const gun = yilGunu - Math.floor((153 * mp + 2) / 5) + 1;
  const ay = mp < 10 ? mp + 3 : mp - 9;
  const yil = devirYili + devir * 400 + (ay <= 2 ? 1 : 0);
  return `${String(yil).padStart(4, "0")}-${iki(ay)}-${iki(gun)}`;
}

/** Haftanın günü: 0 pazartesi ... 6 pazar (`HAFTA_GUNLERI` sırası). */
export function haftaGunuNo(tarih: string): number {
  return (((tarihGunNo(tarih) + 3) % 7) + 7) % 7;
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

/**
 * Saatsiz gün kaydında kullanıcının söylediği gün bölümü (v2): "yarın akşama" → `gun` + `aksam`.
 * Saat değildir ve saat yerine geçmez (kayıt saatsiz kalır, takvimde saatli görünmez); yalnız gün
 * hatırlatmasının saatini (`GUN_HATIRLATMA_SAATLERI`) ve görünümü belirler. İkindi, akşamüstü gibi
 * sözler en yakın bölüme eşlenir; söylenmediyse alan yoktur (uydurulmaz).
 */
export const GUN_BOLUMLERI = ["sabah", "ogle", "ogleden_sonra", "aksam", "gece"] as const;
export const GunBolumu = z
  .enum(GUN_BOLUMLERI)
  .describe(
    "Saat söylenmedi ama günün bölümü söylendiyse: sabah, ogle (öğlen), ogleden_sonra (ikindi dahil), aksam (akşamüstü dahil), gece. Söylenmediyse verme.",
  );
export type GunBolumu = z.infer<typeof GunBolumu>;

/**
 * Saatsiz gün kaydının gün hatırlatması saati (v2, yerel duvar saati, kaydın diliminde): gün
 * bölümünün olağan başından yaklaşık bir saat önce, kullanıcı o bölüm için hazırlanabilsin diye.
 * Bölüm yoksa `GUN_HATIRLATMA_VARSAYILAN_SAATI` (o günün sabahı). Tablo kapalıdır, vektörde birebir durur.
 */
export const GUN_HATIRLATMA_SAATLERI: Readonly<Record<GunBolumu, string>> = {
  sabah: "08:00",
  ogle: "11:00",
  ogleden_sonra: "13:00",
  aksam: "17:00",
  gece: "20:00",
};
export const GUN_HATIRLATMA_VARSAYILAN_SAATI = "09:00";

/** Saatsiz gün kaydının gün hatırlatması saati: bölümün saati, bölüm yoksa varsayılan. */
export function gunHatirlatmaSaati(gun_bolumu?: GunBolumu | undefined): string {
  return gun_bolumu === undefined ? GUN_HATIRLATMA_VARSAYILAN_SAATI : GUN_HATIRLATMA_SAATLERI[gun_bolumu];
}

/** Modele giden açıklamalarda gün hatırlatması tablosu: `sabah 08:00, ogle 11:00, ...; bölüm yoksa 09:00`. */
export function gunHatirlatmaTablosuMetni(): string {
  const bolumler = GUN_BOLUMLERI.map((b) => `${b} ${GUN_HATIRLATMA_SAATLERI[b]}`).join(", ");
  return `${bolumler}; bölüm yoksa ${GUN_HATIRLATMA_VARSAYILAN_SAATI}`;
}

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
 * (servis varsayılan dilimi koyar). Saat söylenmediyse `gun` (gün bölümü söylendiyse `gun_bolumu`,
 * v2), gün aralığıysa `donem`, takvime oturmuyorsa `belirsiz`: saat ya da gün uydurulmaz.
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
      .strictObject({
        kesinlik: z.literal("gun"),
        tarih: Tarih,
        gun_bolumu: GunBolumu.optional(),
        saat_dilimi: dilim,
        ifade: Ifade.optional(),
      })
      .describe("Gün belli, saat söylenmedi (günün bölümü söylendiyse gun_bolumu)."),
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

/**
 * Araç çıktısındaki zaman: kaydın zamanı, `ifade` olmadan. Kayıt metni modele yalnız `ajandaKacir`
 * ve çit yolundan gider; şema `ifade`'yi reddeder (`belirsiz` yalnız kesinliğini taşır).
 */
export const AjandaZamanOzeti = z.discriminatedUnion("kesinlik", [
  z.strictObject({
    kesinlik: z.literal("an"),
    tarih: Tarih,
    saat: Saat,
    sure_dk: z.number().int().min(1).max(AJANDA_SINIRLARI.SURE_DK).optional(),
    saat_dilimi: SaatDilimi,
  }),
  z.strictObject({ kesinlik: z.literal("gun"), tarih: Tarih, gun_bolumu: GunBolumu.optional(), saat_dilimi: SaatDilimi }),
  z
    .strictObject({ kesinlik: z.literal("donem"), baslangic: Tarih, bitis: Tarih, saat_dilimi: SaatDilimi })
    .refine(donemGecerliMi, { message: "bitis baslangictan önce ya da dönem çok uzun", path: ["bitis"] }),
  z.strictObject({ kesinlik: z.literal("belirsiz") }),
]);
export type AjandaZamanOzeti = z.infer<typeof AjandaZamanOzeti>;

/** Kaydın zamanından araç çıktısının zamanı: `ifade` atılır. */
export function ajandaZamanOzeti(zaman: AjandaZamani): AjandaZamanOzeti {
  const { ifade: _ifade, ...ozet } = zaman;
  return ozet;
}

/**
 * Zamanın "ne zaman" çekirdeği: kesinlik, gün(ler), saat, gün bölümü, dilim. `ifade` (kullanıcının
 * sözü) ve `sure_dk` (sürenin uzunluğu) girmez: aynı randevu başka sözle ya da süre eklenerek
 * anıldığında aynı çekirdek çıkar. `gun_bolumu` (v2) saat gibi "ne zaman"dır ve girer ("sabah koşu" ile
 * "akşam koşu" ayrı kayıttır); yoksa çekirdek v1'deki ile bayt bayt aynıdır, saklı anahtarlar
 * değişmez. Hatırlatma hiç girmez. Tekilleştirme anahtarı bundan hesaplanır (`ajandaTekilAnahtari`).
 */
export function zamanCekirdegi(zaman: AjandaZamani): AjandaZamanOzeti {
  const ozet = ajandaZamanOzeti(zaman);
  if (ozet.kesinlik !== "an") return ozet;
  const { sure_dk: _sure, ...cekirdek } = ozet;
  return cekirdek;
}

// Hatırlatma

function hatirlatmaSemasi<D extends z.ZodType>(dilim: D) {
  return z.discriminatedUnion("tur", [
    z
      .strictObject({
        tur: z.literal("once"),
        dk: z.number().int().min(0).max(AJANDA_SINIRLARI.HATIRLATMA_ONCE_DK),
      })
      .describe(
        "Saatli kayıtta olayın anından dk dakika önce. Saatsiz gün kaydında o günün gün hatırlatması " +
          `saatinde (${gunHatirlatmaTablosuMetni()}); dk 1440 ve üstüyse tam gün sayısı kadar önceki gün ` +
          "aynı saatte. Tekrar eden kayıtta her örnek için. Dönem, belirsiz ya da zamansız kayıtta bekler " +
          "(çalmaz), gün ya da saat verilince kurulur.",
      ),
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
 * Girdide `hatirlatmalar` verilmeyen kayda (zaman kesinliği ne olursa olsun) servisin koyduğu liste.
 * Saatli kayıtta olaydan 1 saat önce; saatsiz gün kaydında (v2) o günün gün hatırlatması saatinde
 * (`gunHatirlatmaSaati`: gün bölümüne göre, yoksa 09:00). Liste kaydın zamanına bağlıdır, mutlak bir
 * ana değil: gün değişince hatırlatma yeni güne gider; kayıt sonradan saatlenince saatli kural,
 * saati kalkınca gün hatırlatması kendiliğinden geçerli olur (liste hiç yeniden yazılmaz). Dönem,
 * belirsiz ve zamansız kayıtta bekler. Açık boş dizi ("hatırlatma istemiyorum") varsayılanı almaz ve
 * öyle kalır. Uygulamanın elle ekleme ekranı da bununla açılır.
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
 * olmalı). `gunler` yalnız haftalıkta, hafta sırasıyla ve tekil. Örnek günleri `tekrarOrnekleri`
 * tanımlar. `bitis_tarihi` ile `adet` birlikte verilemez; ikisi de yoksa sonsuz.
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
 * Tekrarın örnek günleri, artan sırayla; `enAz` verilirse ondan önceki günler atlanır (sayım yine
 * çapadan yapılır). Tanım (dilimsiz takvim günü):
 * - `gunluk`: çapa + k·aralik gün. `haftalik` (`gunler` yok): çapa + 7·k·aralik gün.
 * - `haftalik` + `gunler`: haftalar pazartesi başlar; çapanın haftasından itibaren her `aralik`'inci
 *   haftada listedeki günler, çapadan önceki günler hariç. Çapanın günü listede yoksa çapa örnek değildir.
 * - `aylik`: çapanın ay günü, çapanın ayından itibaren her `aralik`'inci ay; o gün ayda yoksa (31, 30,
 *   29 Şubat) o ay örnek yoktur. `yillik`: çapanın ayı ve günü, her `aralik`'inci yıl; 29 Şubat yalnız artık yılda.
 * - `adet`: çapadan sayılan örnek sayısı (atlanan ay sayılmaz). `bitis_tarihi`: son gün dahil.
 *   Hiçbir örnek `YIL_MAX`'ı geçmez.
 */
export function* tekrarOrnekleri(capa: string, t: Tekrar, enAz?: string): Generator<string> {
  const capaNo = tarihGunNo(capa);
  const sonNo = Math.min(
    t.bitis_tarihi === undefined ? Number.POSITIVE_INFINITY : tarihGunNo(t.bitis_tarihi),
    tarihGunNo(`${AJANDA_SINIRLARI.YIL_MAX}-12-31`),
  );
  const enAzNo = enAz === undefined ? capaNo : Math.max(capaNo, tarihGunNo(enAz));
  // Adet sayılacaksa çapadan yürünür (en çok TEKRAR_ADET örnek); yoksa enAz'a atlanır.
  const basNo = t.adet === undefined ? enAzNo : capaNo;
  const capaYil = Number(capa.slice(0, 4));
  const capaAy = Number(capa.slice(5, 7));
  const capaGun = Number(capa.slice(8, 10));
  const basTarih = gunNoTarih(basNo);
  const basYil = Number(basTarih.slice(0, 4));
  const basAy = Number(basTarih.slice(5, 7));

  // Dönem k'nın aday günleri (artan); dönemler de artan.
  let adaylar: (k: number) => number[];
  let k0: number;
  if (t.siklik === "gunluk" || (t.siklik === "haftalik" && t.gunler === undefined)) {
    const adim = t.siklik === "gunluk" ? t.aralik : 7 * t.aralik;
    adaylar = (k) => [capaNo + k * adim];
    k0 = Math.max(0, Math.floor((basNo - capaNo) / adim));
  } else if (t.siklik === "haftalik") {
    const hafta0 = capaNo - haftaGunuNo(capa);
    const sira = t.gunler!.map((g) => HAFTA_GUNLERI.indexOf(g));
    const adim = 7 * t.aralik;
    adaylar = (k) => sira.map((s) => hafta0 + k * adim + s);
    k0 = Math.max(0, Math.floor((basNo - hafta0) / adim));
  } else if (t.siklik === "aylik") {
    const ay0 = capaYil * 12 + (capaAy - 1);
    adaylar = (k) => {
      const ay = ay0 + k * t.aralik;
      const yil = Math.floor(ay / 12);
      const ayNo = (ay % 12) + 1;
      if (yil > AJANDA_SINIRLARI.YIL_MAX) return [Number.POSITIVE_INFINITY];
      return capaGun <= aydakiGun(yil, ayNo) ? [tarihGunNo(`${yil}-${iki(ayNo)}-${iki(capaGun)}`)] : [];
    };
    k0 = Math.max(0, Math.floor((basYil * 12 + (basAy - 1) - ay0) / t.aralik));
  } else {
    adaylar = (k) => {
      const yil = capaYil + k * t.aralik;
      if (yil > AJANDA_SINIRLARI.YIL_MAX) return [Number.POSITIVE_INFINITY];
      return capaGun <= aydakiGun(yil, capaAy) ? [tarihGunNo(`${yil}-${iki(capaAy)}-${iki(capaGun)}`)] : [];
    };
    k0 = Math.max(0, Math.floor((basYil - capaYil) / t.aralik));
  }

  let sayac = 0;
  for (let k = k0; ; k++) {
    for (const gun of adaylar(k)) {
      if (gun > sonNo) return;
      if (gun < capaNo) continue;
      sayac++;
      if (t.adet !== undefined && sayac > t.adet) return;
      if (gun >= enAzNo) yield gunNoTarih(gun);
    }
  }
}

/** `tarih` serinin bir örnek günü mü (`tekrarOrnekleri` tanımıyla). */
export function ornekGunuMu(capa: string, t: Tekrar, tarih: string): boolean {
  if (!gercekTarihMi(tarih) || tarih < capa) return false;
  for (const gun of tekrarOrnekleri(capa, t, tarih)) return gun === tarih;
  return false;
}

/** Artan sıralı `tarihler`in hepsi örnek günü mü; adetli seride tek yürüyüşle. */
export function ornekGunleriMi(capa: string, t: Tekrar, tarihler: readonly string[]): boolean {
  if (tarihler.length === 0) return true;
  if (t.adet === undefined) return tarihler.every((d) => ornekGunuMu(capa, t, d));
  let i = 0;
  for (const gun of tekrarOrnekleri(capa, t)) {
    if (tarihler[i]! < gun) return false;
    if (tarihler[i] === gun) i++;
    if (i === tarihler.length) return true;
  }
  return false;
}

/**
 * Zaman, hatırlatma ve tekrarın birbirine bağlı kuralları: tekrar `an` ya da `gun` ister ve bitişi
 * çapadan önce olamaz. `once` hatırlatması her zamanla kaydedilebilir; `an`'da olaydan önce, `gun`'da
 * gün hatırlatması saatinde çalar, öteki kesinliklerde bekler. Kayıt, ekleme ve araç girdisi bunu paylaşır.
 */
export function zamanKurallari(
  g: {
    zaman?: { kesinlik: string; tarih?: string } | null | undefined;
    tekrar?: Tekrar | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const kesinlik = g.zaman?.kesinlik;
  if (g.tekrar !== undefined && g.tekrar !== null) {
    if (kesinlik !== "an" && kesinlik !== "gun") {
      ctx.addIssue({ code: "custom", path: ["tekrar"], message: "tekrar zaman kesinliği an ya da gun ister" });
    } else if (g.tekrar.bitis_tarihi !== undefined && g.zaman?.tarih !== undefined && g.tekrar.bitis_tarihi < g.zaman.tarih) {
      ctx.addIssue({ code: "custom", path: ["tekrar", "bitis_tarihi"], message: "tekrar bitişi çapadan önce" });
    }
  }
}
