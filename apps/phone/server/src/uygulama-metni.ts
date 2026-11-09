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

/**
 * Ad güvenilmezdir: `cihaz`daki `kacir`a ek olarak burada da JSON dize kaçışıyla tırnağa alınır
 * (satır sonu, sekme, `"`, `\`, denetim karakteri; U+2028/2029 da). Ad satırı bölemez, kendi başına
 * satır başı gibi görünemez.
 */
function adYaz(ad: string): string {
  return JSON.stringify(ad).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

function satir(u: Uygulama): string {
  const ad = adYaz(u.ad);
  return u.durum === "acik" ? `${u.paket} ${ad}` : `${u.paket} [kapalı:${u.durum}] ${ad}`;
}

export function uygulamaMetniKur(cikti: UygulamalarCiktiTipi, girdi: UygulamalarAracGirdi): string {
  const terimler = (girdi.ara ?? "")
    .split(",")
    .map(sade)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const eslesen = cikti.uygulamalar.filter((u) => {
    if (terimler.length === 0) return true;
    const p = sade(u.paket);
    const a = sade(u.ad);
    return terimler.some((t) => p.includes(t) || a.includes(t));
  });
  // Açıklar önce: sınır kesince kullanıcının iş verebileceği uygulamalar kalsın.
  const sirali = eslesen.toSorted(
    (x, y) =>
      Number(x.durum !== "acik") - Number(y.durum !== "acik") ||
      x.ad.localeCompare(y.ad, "tr") ||
      x.paket.localeCompare(y.paket),
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
