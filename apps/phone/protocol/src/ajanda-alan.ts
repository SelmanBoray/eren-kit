import { z } from "zod";
import { ajandaSatiri, Saat } from "./ajanda-zaman.ts";
import { AJANDA_SINIRLARI } from "./sinirlar.ts";
import { OpakId, ZamanMs } from "./temel.ts";

/**
 * Sürüm 3'ün kayıt alanları (`simge`, `bolge`, `bolge_konumu`, `varis`, `baglantilar`, `ekler`), yetenek
 * adları ve saf yardımcıları (bölge eşleşme anahtarı, URL, yetenek kesişimi). Hepsi isteğe bağlı, üst
 * düzey alandır (genişleme kuralları: `docs/AJANDA.md` "Sürüm uyumu"); kuralları yalnız yeni alanlara
 * bağlıdır, böylece v2 istemcinin yazabildiği hiçbir değer onları geçersiz kılmaz. Kayda, işleme ve
 * çerçevelere `ajanda.ts` sürüme göre ekler. Uygulama (Rust) aynı kuralları vektörle sınar
 * (`vektorler/ajanda-v3.json`).
 */

// Simge

/**
 * Simge anahtarı: açık küme, biçimi katı. Bilinmeyen anahtar korunur ve varsayılan simgeyle gösterilir;
 * kümeye öğe eklemek sürüm artışı değildir. `AJANDA_SIMGELERI` yalnız öneridir, doğrulama değildir.
 */
export const SIMGE_DESENI = /^[a-z][a-z0-9_]{0,31}$/;
export const AjandaSimge = z.string().max(AJANDA_SINIRLARI.SIMGE).regex(SIMGE_DESENI);
export type AjandaSimge = z.infer<typeof AjandaSimge>;

/** Önerilen simge anahtarları (genel, kişisel değil). `genel` varsayılan çizimdir: bilinmeyen anahtarda ve eşleşme yokken gösterilir. Bugünkü 21 anahtar ASCII sırasıyla, ardından sonradan eklenenler. */
export const AJANDA_SIMGELERI = [
  "genel",
  "araba",
  "banka",
  "dis",
  "dogum_gunu",
  "doktor",
  "ev",
  "fatura",
  "ilac",
  "is",
  "kahve",
  "kargo",
  "kitap",
  "market",
  "okul",
  "sac",
  "seyahat",
  "spor",
  "telefon",
  "temizlik",
  "toplanti",
  "yemek",
  "kamp",
  "evcil",
  "bitki",
  "tamir",
  "camasir",
  "eglence",
  "mektup",
] as const;

// Bölge

/** Bölge adı: tek satır. Eşleşme (aynı yer mi) adla değil `ajandaBolgeAnahtari` ile yapılır. */
export const AjandaBolge = ajandaSatiri(1, AJANDA_SINIRLARI.BOLGE);

/**
 * Bölgenin konumu: tam sayı mikroderece (WGS84 × 10⁶) ve yarıçap. Yalnız `bolge` varken. Yalnız yedektir:
 * araç çıktısına, model metnine, günlüklere ve geçmişin modele giden görünümüne girmez.
 */
export const AjandaBolgeKonumu = z.strictObject({
  enlem_e6: z.number().int().min(-90_000_000).max(90_000_000),
  boylam_e6: z.number().int().min(-180_000_000).max(180_000_000),
  yaricap_m: z.number().int().min(AJANDA_SINIRLARI.BOLGE_YARICAP_MIN).max(AJANDA_SINIRLARI.BOLGE_YARICAP_MAX),
});
export type AjandaBolgeKonumu = z.infer<typeof AjandaBolgeKonumu>;

/**
 * Unicode `White_Space` özelliğinin tamamı (Rust `char::is_whitespace` ile aynı küme). JS `\s` bilerek
 * kullanılmaz: U+FEFF'i içerir, U+0085'i içermez.
 */
const BOSLUK = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

/**
 * Türkçe harflerin ayrışık yazılışı (taban + birleşen işaret) ve birleşik karşılığı. Tam NFC bilerek
 * kullanılmaz: `String.prototype.normalize` Hermes'te güvenilmezdir (paket kaynağında yasak,
 * `icerik.test.ts`) ve tam tablo her dilde ayrı bir Unicode sürümü bağımlılığıdır. Bu tablo kapalıdır,
 * Rust aynısını kopyalar.
 */
const TURKCE_BIRLESIK: Readonly<Record<string, string>> = {
  "C\u0327": "\u00c7",
  "c\u0327": "\u00e7",
  "S\u0327": "\u015e",
  "s\u0327": "\u015f",
  "G\u0306": "\u011e",
  "g\u0306": "\u011f",
  "I\u0307": "\u0130",
  "O\u0308": "\u00d6",
  "o\u0308": "\u00f6",
  "U\u0308": "\u00dc",
  "u\u0308": "\u00fc",
  "A\u0302": "\u00c2",
  "a\u0302": "\u00e2",
  "I\u0302": "\u00ce",
  "i\u0302": "\u00ee",
  "U\u0302": "\u00db",
  "u\u0302": "\u00fb",
};
const TURKCE_AYRISIK = /[CcSs]\u0327|[Gg]\u0306|I\u0307|[OoUu]\u0308|[AaIiUu]\u0302/g;

/**
 * Bölge adının eşleşme anahtarı (servis ve uygulama aynı sonucu verir; vektör `ajanda-v3.json`
 * `bolge_anahtari`). Sırayla:
 * 1. Türkçe harflerin ayrışık yazılışı birleşik yazılışa (`TURKCE_BIRLESIK`, soldan sağa, örtüşmesiz).
 * 2. Her `White_Space` dizisi tek U+0020; baştaki ve sondaki U+0020 atılır.
 * 3. Kod noktası başına küçük harf, bağlamsız: `İ` (U+0130) → `i`, `I` → `ı` (U+0131), öteki her kod
 *    noktası Unicode varsayılan küçük harf eşlemesiyle tek başına (son sigma kuralı uygulanmaz).
 * Yerel ayara bağlı değildir (`toLocaleLowerCase` yok). Rust: 1. adım aynı tablo, 2. `char::is_whitespace`,
 * 3. `char::to_lowercase` (U+0130 ve `I` önce elle).
 */
export function ajandaBolgeAnahtari(ad: string): string {
  const sade = ad.replace(TURKCE_AYRISIK, (s) => TURKCE_BIRLESIK[s]!).replace(BOSLUK, " ");
  let bas = 0;
  let son = sade.length;
  while (bas < son && sade.charCodeAt(bas) === 0x20) bas++;
  while (son > bas && sade.charCodeAt(son - 1) === 0x20) son--;
  let cikti = "";
  for (const c of sade.slice(bas, son)) {
    cikti += c === "\u0130" ? "i" : c === "I" ? "\u0131" : c.toLowerCase();
  }
  return cikti;
}

/**
 * Bölge değişikliği konumu düşürür mü: eski ad vardı ve yeni ad yok ya da anahtarı başka
 * (`ajandaBolgeAnahtari`). Yalnız büyük/küçük harf ya da boşluk farkı aynı yerdir.
 */
export function ajandaBolgeYeriDegisirMi(eski: string | undefined, yeni: string | undefined): boolean {
  if (eski === undefined) return false;
  return yeni === undefined || ajandaBolgeAnahtari(eski) !== ajandaBolgeAnahtari(yeni);
}

// Varış

/** Varış penceresi: yerel duvar saati, `bas` < `bit` (gece yarısını aşmaz). */
export const AjandaVarisPenceresi = z
  .strictObject({ bas: Saat, bit: Saat })
  .refine((p) => p.bas < p.bit, { message: "bas bit'ten önce olmalı", path: ["bit"] });

/**
 * Bölgeye varışta hatırlatma; yalnız `bolge` varken. Anlamı kaydın zamanından türer, onunla
 * çelişemez (`docs/AJANDA.md`): `{}` "ilk girişte bir kez". `cikista` yalnız `true` yazılır (yokluğu
 * yanlıştır; tek anlamın tek yazılışı olsun).
 */
export const AjandaVaris = z.strictObject({
  pencere: AjandaVarisPenceresi.optional(),
  cikista: z.literal(true).optional(),
});
export type AjandaVaris = z.infer<typeof AjandaVaris>;

// Bağlantılar

/** RFC 3986'nın izin vermediği, tarayıcıların farklı yorumladığı yazdırılabilir ASCII karakterler. */
const URL_YASAK = '"<>\\^`{|}';
/** 1..63 karakter; harf ya da rakamla başlar ve biter, içte `_` ve `-` serbest. */
const ETIKET_DESENI = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?$/;
const IPV6_DESENI = /^\[[0-9A-Fa-f:.]{2,45}\]$/;
const PORT_DESENI = /^[1-9][0-9]{0,4}$/;

/**
 * URL geçerliyse alan adı (küçük harf ASCII; IPv6 köşeli ayraçlı), değilse `null`. `new URL`'ye
 * dayanmaz; adımlar Rust'ta birebir yazılır (vektör `ajanda-v3.json` `url`):
 * 1. Uzunluk 1..`BAGLANTI_URL`; her karakter yazdırılabilir ASCII (0x21..0x7E), `"<>\^`{|}` yok
 *    (boşluk, denetim ve ASCII dışı karakter de yok: yüzde kodlanmış olmalı).
 * 2. Küçük harf `https://` ya da `http://` ile başlar.
 * 3. Yetki: önekten sonra ilk `/`, `?` ya da `#`'e (yoksa sona) kadar.
 * 4. Yetkide `@` yok (kullanıcı bilgisi yok).
 * 5. Yetki `[`...`]` ile başlıyorsa IPv6 (`[` + 2..45 tane `0-9A-Fa-f:.` + `]`, içinde `:`), sonrası boş
 *    ya da `:port`. Değilse ilk `:`'a kadar ana bilgisayar adı: en çok 253, `.` ile ayrılmış etiketler,
 *    her etiket 1..63 tane `A-Za-z0-9_-`, ilk ve son karakteri harf ya da rakam (`http://-`, `http://_`,
 *    `-a.com`, `a_.com` geçmez); `:` varsa sonrası port.
 * 6. Port: baştaki sıfırsız 1..5 rakam, değeri 1..65535.
 * Yolun, sorgunun ve parçanın içeriği 1. adımdan başka denetlenmez.
 *
 * Yerel ve özel adresler (`127.0.0.1`, `[::1]`, `localhost`, `192.168.x.x`) bilinçli olarak geçer: bağlantı
 * eylemsizdir, telefon yalnız kullanıcı dokununca sistem tarayıcısında açar ve alan adını gösterir; ev ağındaki
 * cihaz ya da geliştirme sunucusu meşru bir nottur. Metinsel yasak listesi güvenlik de vermezdi: tarayıcı
 * `http://2130706433` ya da `http://0x7f.1`'i de `127.0.0.1` diye çözer (tam WHATWG IPv4 çözümlemesi gerekirdi).
 */
export function ajandaUrlAlanAdi(url: string): string | null {
  if (url.length < 1 || url.length > AJANDA_SINIRLARI.BAGLANTI_URL) return null;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c < 0x21 || c > 0x7e || URL_YASAK.includes(url[i]!)) return null;
  }
  let geri: string;
  if (url.startsWith("https://")) geri = url.slice(8);
  else if (url.startsWith("http://")) geri = url.slice(7);
  else return null;
  let yetkiSonu = geri.length;
  for (let i = 0; i < geri.length; i++) {
    const c = geri[i];
    if (c === "/" || c === "?" || c === "#") {
      yetkiSonu = i;
      break;
    }
  }
  const yetki = geri.slice(0, yetkiSonu);
  if (yetki.includes("@")) return null;
  let ana: string;
  let port: string | undefined;
  if (yetki.startsWith("[")) {
    const kapanis = yetki.indexOf("]");
    if (kapanis < 0) return null;
    ana = yetki.slice(0, kapanis + 1);
    const kalan = yetki.slice(kapanis + 1);
    if (kalan !== "") {
      if (!kalan.startsWith(":")) return null;
      port = kalan.slice(1);
    }
    if (!IPV6_DESENI.test(ana) || !ana.includes(":")) return null;
  } else {
    const iki = yetki.indexOf(":");
    ana = iki < 0 ? yetki : yetki.slice(0, iki);
    if (iki >= 0) port = yetki.slice(iki + 1);
    if (ana.length < 1 || ana.length > 253 || !ana.split(".").every((e) => ETIKET_DESENI.test(e))) return null;
  }
  if (port !== undefined && (!PORT_DESENI.test(port) || Number(port) > 65_535)) return null;
  return ana.toLowerCase();
}

export function ajandaUrlGecerliMi(url: string): boolean {
  return ajandaUrlAlanAdi(url) !== null;
}

/**
 * Bağlantı: eylemsiz veri. Telefon önizleme çekmez, yalnız kullanıcı dokununca sistem tarayıcısında
 * açar ve alan adını (`ajandaUrlAlanAdi`) gösterir. `baslik` kullanıcı metnidir (modele kaçışlı, çitli).
 */
export const AjandaBaglanti = z.strictObject({
  url: z.string().max(AJANDA_SINIRLARI.BAGLANTI_URL).refine(ajandaUrlGecerliMi, { message: "url geçersiz" }),
  baslik: ajandaSatiri(1, AJANDA_SINIRLARI.BAGLANTI_BASLIK).optional(),
});
export type AjandaBaglanti = z.infer<typeof AjandaBaglanti>;

/** En az bir öğe (yokluk alanın kendisinin yokluğudur), `url`'ler tekil. */
export const AjandaBaglantilar = z
  .array(AjandaBaglanti)
  .min(1)
  .max(AJANDA_SINIRLARI.KAYIT_BAGLANTI_ADET)
  .refine((l) => new Set(l.map((b) => b.url)).size === l.length, { message: "url tekil olmalı" });

// Ekler

/** Saklanan baytların sha256'sı, küçük harf onaltılık. */
export const AjandaEkOzeti = z.string().regex(/^[0-9a-f]{64}$/);

/** Açık küme, biçim katı (bugün telefon yalnız `image/jpeg` üretir). Servis için yalnız etikettir. */
export const AjandaEkMime = z
  .string()
  .max(AJANDA_SINIRLARI.EK_MIME)
  .regex(/^[a-z]+\/[a-z0-9.+-]+$/);

export const AjandaEkBayti = z.number().int().min(1).max(AJANDA_SINIRLARI.EK_BAYT);
const Kenar = z.number().int().min(1).max(AJANDA_SINIRLARI.EK_KENAR);

/**
 * Ek üstverisi. İkili veri yalnız telefonda (ve `ek_yedegi` ile serviste); "bu cihazda var mı" yerel
 * durumdur, eşitlenmez. `bayt` ve `ozet` küçültülmüş dosyanındır ve değişmez: ek değişirse yeni
 * `ek_id`. `genislik` ile `yukseklik` birlikte. `kapak` yalnız `true` yazılır. Öğeye sonradan alan
 * eklenmez (genişleme kuralı 4).
 */
export const AjandaEki = z
  .strictObject({
    ek_id: OpakId,
    mime: AjandaEkMime,
    bayt: AjandaEkBayti,
    genislik: Kenar.optional(),
    yukseklik: Kenar.optional(),
    ozet: AjandaEkOzeti,
    kapak: z.literal(true).optional(),
    olusturma_ms: ZamanMs,
  })
  .refine((e) => (e.genislik === undefined) === (e.yukseklik === undefined), {
    message: "genislik ve yukseklik birlikte",
    path: ["yukseklik"],
  });
export type AjandaEki = z.infer<typeof AjandaEki>;

/** En az bir öğe, `ek_id`'ler tekil, en çok bir `kapak`. */
export const AjandaEkler = z
  .array(AjandaEki)
  .min(1)
  .max(AJANDA_SINIRLARI.EK_ADET)
  .refine((l) => new Set(l.map((e) => e.ek_id)).size === l.length, { message: "ek_id tekil olmalı" })
  .refine((l) => l.filter((e) => e.kapak === true).length <= 1, { message: "en çok bir kapak" });

/** `ek_iste`/`ek_ret` ret kodları: kapalı küme (v3). Bağlantı kapanmaz. `ic_hata` geçicidir. */
export const AJANDA_EK_RET_KODLARI = [
  "ek_bilinmiyor",
  "ozet_uyusmuyor",
  "ek_cok_buyuk",
  "kota_asildi",
  "ek_yok",
  "ic_hata",
] as const;
export const AjandaEkRetKodu = z.enum(AJANDA_EK_RET_KODLARI);
export type AjandaEkRetKodu = z.infer<typeof AjandaEkRetKodu>;

/** `n` baytın dolgulu standart base64 uzunluğu. */
export function ajandaBase64Boyu(n: number): number {
  return Math.ceil(n / 3) * 4;
}

const BASE64_ABECE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Kanonik standart base64 mi: uzunluk 4'ün katı ve en az 4; sondaki en çok iki `=` dışında her karakter
 * standart abecede; dolgudan önceki kullanılmayan bitler sıfır (`==` öncesi karakterin abece sırası 16'nın,
 * `=` öncesininki 4'ün katı). Aynı baytların tek yazılışıdır (Rust `base64` STANDARD ile aynı). Düzenli
 * ifade bilerek kullanılmaz: 350 bin karakterde geri izleme sınırına takılır.
 */
export function kanonikBase64Mi(metin: string): boolean {
  if (metin.length < 4 || metin.length % 4 !== 0) return false;
  const dolgu = metin.endsWith("==") ? 2 : metin.endsWith("=") ? 1 : 0;
  const son = metin.length - dolgu;
  for (let i = 0; i < son; i++) if (!BASE64_ABECE.includes(metin[i]!)) return false;
  if (dolgu === 0) return true;
  const sira = BASE64_ABECE.indexOf(metin[son - 1]!);
  return sira % (dolgu === 2 ? 16 : 4) === 0;
}

/** Kanonik base64 metninin çözülmüş bayt sayısı (dolgu düşülür). */
export function ajandaBase64Bayti(metin: string): number {
  const dolgu = metin.endsWith("==") ? 2 : metin.endsWith("=") ? 1 : 0;
  return (metin.length / 4) * 3 - dolgu;
}

/** `ek_parca.veri`: 1..`EK_PARCA` bayt (uzunluk sınırı tek başına yetmez: 262145 bayt da 349528 karakterdir), kanonik base64. */
export const AjandaEkVerisi = z
  .string()
  .min(4)
  .max(ajandaBase64Boyu(AJANDA_SINIRLARI.EK_PARCA))
  .refine(kanonikBase64Mi, { message: "kanonik base64 değil" })
  .refine((s) => ajandaBase64Bayti(s) <= AJANDA_SINIRLARI.EK_PARCA, { message: "parça EK_PARCA'yı aşıyor" });

// Kural

/**
 * v3 alanlarının birbirine bağlı kuralları (kayıt ve `ekle`): `bolge_konumu` ve `varis` yalnız
 * `bolge` varken. Yalnız yeni alanlara bağlıdır (genişleme kuralı 2).
 */
export function v3AlanKurallari(
  g: { bolge?: unknown; bolge_konumu?: unknown; varis?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (g.bolge !== undefined) return;
  if (g.bolge_konumu !== undefined) ctx.addIssue({ code: "custom", path: ["bolge_konumu"], message: "bolge_konumu bolge ister" });
  if (g.varis !== undefined) ctx.addIssue({ code: "custom", path: ["varis"], message: "varis bolge ister" });
}

// Yetenekler

/**
 * Yetenek adı: açık küme, biçimi katı. Sürüm ŞEKLİ belirler, yetenek DAVRANIŞI (karşı taraf bunu
 * saklayacak/uygulayacak mı). Bilinmeyen ad yok sayılır; yetenek eklemek sürüm artışı değildir. Adlar
 * işlevle konur, hiçbiri asistan motoruna bağlı değildir.
 */
export const YETENEK_DESENI = /^[a-z][a-z0-9_]{1,31}$/;
export const AjandaYetenekAdi = z.string().max(AJANDA_SINIRLARI.YETENEK_ADI).regex(YETENEK_DESENI);

/** Bilinen yetenek adları (ASCII sırasıyla). Doğrulama değildir: liste açıktır. */
export const AJANDA_YETENEKLERI = ["ek_yedegi", "eslesme_birak", "ice_aktar"] as const;

/** Yetenek listesi: kesin artan ASCII sırası (tekil ve kanonik), en çok `YETENEK_ADET`. */
export const AjandaYetenekler = z
  .array(AjandaYetenekAdi)
  .max(AJANDA_SINIRLARI.YETENEK_ADET)
  .refine((l) => l.every((a, i) => i === 0 || l[i - 1]! < a), { message: "yetenekler artan sırada ve tekil" });

/**
 * `welcome.yetenekler`: istemcinin istedikleriyle (`hello.yetenekler`, yoksa hiç) servisin sunduklarının
 * kesişimi, kanonik sırada (tekil, ASCII artan). Bilinmeyen ad kesişime giremez. Vektör `ajanda-v3.json`
 * `yetenek_kesisimi`.
 */
export function ajandaYetenekKesisimi(istenen: readonly string[] | undefined, sunulan: readonly string[]): string[] {
  if (istenen === undefined) return [];
  const sunulanlar = new Set(sunulan);
  return [...new Set(istenen.filter((a) => sunulanlar.has(a)))].sort();
}
