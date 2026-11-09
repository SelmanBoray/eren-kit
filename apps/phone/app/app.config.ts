// Dinamik Expo yapılandırması: durağan kısım app.json'da; burada yalnız ada bağlı alanlar derleme anında
// `EREN_KIT_ASSISTANT_NAME`'den kurulur. Android `package` (dev.eren.app) app.json'da kalır, değişmez:
// kurulu uygulama aynı kimlikle güncellenir.
import type { ConfigContext, ExpoConfig } from "expo/config";
import { ASISTAN_ADI_ORTAMI, asistanAdiUret, uygulamaAdiUret } from "./src/asistanAdi.ts";

type Ortam = Readonly<Record<string, string | undefined>>;

/**
 * Saf: durağan yapılandırma + ortam → son yapılandırma. Launcher adı (`name`) ortam verilmişse o,
 * yoksa "eren-kit"; uygulama içindeki asistan adı (`extra.asistanAdi`) ortam verilmişse o, yoksa "Claude".
 */
export function yapilandirmaKur(config: Partial<ExpoConfig>, ortam: Ortam): ExpoConfig {
  const ham = ortam[ASISTAN_ADI_ORTAMI];
  return {
    ...config,
    name: uygulamaAdiUret(ham),
    slug: config.slug ?? "eren-kit",
    extra: { ...config.extra, asistanAdi: asistanAdiUret(ham) },
  };
}

export default ({ config }: ConfigContext): ExpoConfig => yapilandirmaKur(config, process.env);
