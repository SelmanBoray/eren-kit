/**
 * Kullanıcıya görünen asistan adı ve uygulama (launcher) adı. Saf modül: içe aktarma yok; hem derleme
 * anında `app.config.ts` hem çalışma anında `platform/asistanAdi.ts` kullanır, testler doğrudan çağırır.
 *
 * Kaynak derleme anındaki `EREN_KIT_ASSISTANT_NAME` ortam değişkenidir. Temizleme kuralı
 * `server/src/ayar.ts` → `asistanAdiUret` ile aynıdır (o da packages/bellek `asistan.py` ile aynı):
 * yazdırılamaz karakterler (C* ve boşluk dışı Z*) atılır, boşluklar teklenir, en çok 40 karakter.
 */

export const ASISTAN_ADI_ORTAMI = "EREN_KIT_ASSISTANT_NAME";
/** Ortam verilmediğinde ya da temizlenince boş kaldığında görünen asistan adı. */
export const VARSAYILAN_ASISTAN_ADI = "Claude";
/**
 * Ortam verilmediğinde launcher'daki uygulama adı. "Claude" burada kullanılmaz: resmi uygulamayla karışır.
 */
export const VARSAYILAN_UYGULAMA_ADI = "eren-kit";
const ASISTAN_ADI_SINIRI = 40;

/** Temizlenmiş ad; ortam yoksa ya da yalnız yazdırılamaz/boşluk karakteri varsa "". */
function temizle(ham: string | undefined): string {
  let temiz = "";
  for (const c of ham ?? "") {
    if (c === " " || !/[\p{C}\p{Z}]/u.test(c)) temiz += c;
  }
  const ad = temiz.split(" ").filter((p) => p !== "").join(" ");
  return [...ad].slice(0, ASISTAN_ADI_SINIRI).join("").trimEnd();
}

/** Görünen asistan adı: temizlenmiş ortam değeri, boşsa "Claude". */
export function asistanAdiUret(ham: string | undefined): string {
  const ad = temizle(ham);
  return ad === "" ? VARSAYILAN_ASISTAN_ADI : ad;
}

/** Launcher adı: ortam verilmişse (temizlenmiş) o, yoksa "eren-kit". */
export function uygulamaAdiUret(ham: string | undefined): string {
  const ad = temizle(ham);
  return ad === "" ? VARSAYILAN_UYGULAMA_ADI : ad;
}

/**
 * Expo config `extra`'sından asistan adı. `extra.asistanAdi` yoksa ya da metin değilse "Claude";
 * varsa aynı temizlemeden yeniden geçer (yerleşik yapılandırma elle değiştirilmiş olabilir).
 */
export function asistanAdiOku(extra: unknown): string {
  const ham =
    typeof extra === "object" && extra !== null ? (extra as { asistanAdi?: unknown }).asistanAdi : undefined;
  return asistanAdiUret(typeof ham === "string" ? ham : undefined);
}
