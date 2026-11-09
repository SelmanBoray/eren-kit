/**
 * Çalışma anında görünen asistan adı: derleme anında `app.config.ts`'in `extra.asistanAdi`'ye yazdığı değer.
 * Gömülü yapılandırma `expo-constants`'ın yerel modülünden (`ExponentConstants.manifest`) okunur; bu
 * modül `expo`'nun bağımlılığı olarak zaten bağlıdır. `expo-constants` JS paketi uygulamanın doğrudan
 * bağımlılığı olmadığı için aynı okuma burada `expo`'nun `requireOptionalNativeModule`'üyle yapılır.
 * Modül ya da yapılandırma yoksa (geliştirme, test) "Claude".
 */
import { requireOptionalNativeModule } from "expo";
import { asistanAdiOku } from "../asistanAdi.ts";

function gomuluExtra(): unknown {
  try {
    const m = requireOptionalNativeModule<{ manifest?: unknown }>("ExponentConstants");
    const ham = m?.manifest;
    // Android yapılandırmayı JSON metni olarak verir, iOS nesne olarak.
    const yapilandirma: unknown = typeof ham === "string" ? JSON.parse(ham) : ham;
    if (typeof yapilandirma !== "object" || yapilandirma === null) return undefined;
    return (yapilandirma as { extra?: unknown }).extra;
  } catch {
    return undefined;
  }
}

/** Derleme anında belirlenen, uygulama boyunca değişmeyen görünen asistan adı. */
export const ASISTAN_ADI: string = asistanAdiOku(gomuluExtra());
