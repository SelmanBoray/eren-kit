import { kacir } from "@eren/protocol";
import { z } from "zod";
import type { UygulamalarCiktiTipi } from "./sozlesme.ts";

/**
 * `uygulamalar` aracının modele giden metni. Boru girdisi `{}` kalır (protokol değişmez); `ara`
 * yalnız köprüde uygulanır. Her satır `paket [kapalı:<durum>] "ad"` biçimindedir: paket boşluksuz
 * olduğundan ilk sözcüktür, işaret güvenilmez addan önce gelir. İşaretsiz satır `acik`tır.
 */
export const UYGULAMA_SATIR_BUTCESI = 3_500;

export const UygulamalarAracGirdi = z.strictObject({
  ara: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Ad ya da paket parçası; virgülle birden çok (ör. whatsapp, ziraat). Harf ve aksan farkı yok."),
});
export type UygulamalarAracGirdi = z.infer<typeof UygulamalarAracGirdi>;

type Uygulama = UygulamalarCiktiTipi["uygulamalar"][number];

/** Büyük/küçük harf, Türkçe I/ı ve aksan farkını siler. */
function sade(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replaceAll("ı", "i");
}

const KACIS = /\\(?:u([0-9a-fA-F]{4})|(["\\nrt]))/g;
const TEK_KACIS: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", n: "\n", r: "\r", t: "\t" };

/**
 * `kacir`ın tersi. `cihaz` adı `kacir`dan geçirip yollar; her ters bölü bir kaçış başlattığı için
 * çözüm tek anlamlıdır. Geçerli kaçış başlatmayan ters bölü (ham gelmiş ad) olduğu gibi kalır.
 * Kırpma işareti `…` düz karakter olarak kalır.
 */
export function kacirCoz(metin: string): string {
  return metin.replace(KACIS, (_tum, hex: string | undefined, tek: string | undefined) =>
    hex !== undefined ? String.fromCharCode(Number.parseInt(hex, 16)) : (TEK_KACIS[tek ?? ""] ?? ""),
  );
}

/**
 * Ad güvenilmezdir. Gerçek ad (`kacirCoz`) bir kez `kacir` ile kaçırılıp tırnağa alınır: `"`, `\`,
 * satır sonu, sekme, denetim, yön ve satır ayırıcı karakterleri kaçar. Ad köprüye ham gelse de
 * satırı bölemez, tırnaktan çıkamaz, satır başı ya da `[kapalı:...]` işareti gibi görünemez.
 */
function adYaz(gercekAd: string): string {
  return `"${kacir(gercekAd, gercekAd.length)}"`;
}

interface Kayit {
  u: Uygulama;
  /** Kaçırılmamış ad. */
  ad: string;
}

function satir({ u, ad }: Kayit): string {
  const a = adYaz(ad);
  return u.durum === "acik" ? `${u.paket} ${a}` : `${u.paket} [kapalı:${u.durum}] ${a}`;
}

export function uygulamaMetniKur(cikti: UygulamalarCiktiTipi, girdi: UygulamalarAracGirdi): string {
  const terimler = (girdi.ara ?? "")
    .split(",")
    .map(sade)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const eslesen = cikti.uygulamalar
    .map((u): Kayit => ({ u, ad: kacirCoz(u.ad) }))
    .filter(({ u, ad }) => {
      if (terimler.length === 0) return true;
      const p = sade(u.paket);
      const a = sade(ad);
      return terimler.some((t) => p.includes(t) || a.includes(t));
    });
  // Açıklar önce: sınır kesince kullanıcının iş verebileceği uygulamalar kalsın.
  const sirali = eslesen.toSorted(
    (x, y) =>
      Number(x.u.durum !== "acik") - Number(y.u.durum !== "acik") ||
      x.ad.localeCompare(y.ad, "tr") ||
      x.u.paket.localeCompare(y.u.paket),
  );
  const satirlar: string[] = [];
  let boy = 0;
  for (const u of sirali) {
    const s = satir(u);
    if (boy + s.length + 1 > UYGULAMA_SATIR_BUTCESI) break;
    satirlar.push(s);
    boy += s.length + 1;
  }
  const kalan = sirali.length - satirlar.length;
  const ust =
    `uygulamalar: telefon_bagli=${cikti.telefon_bagli ? "evet" : "hayir"} ` +
    `toplam=${cikti.uygulamalar.length}` +
    (terimler.length > 0 ? ` eslesen=${sirali.length}` : "") +
    ` gosterilen=${satirlar.length}\n` +
    "satır: paket [kapalı:durum] \"ad\"; işaretsiz satır telefon işine açık, kapalı olan telefon işinde kullanılamaz.";
  const alt =
    kalan > 0
      ? `\nkesildi: ${kalan} uygulama gösterilmedi (önce açıklar); ara ile daralt.`
      : sirali.length === 0 && terimler.length > 0
        ? "\neşleşen yok: telefonda kurulu olmayabilir ya da başka adla geçiyor."
        : "";
  return [ust, ...satirlar].join("\n") + alt;
}
