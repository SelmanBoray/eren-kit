// `eren-device` yerel (Expo) modülünün tek giriş sarmalayıcısı.
// Native tarafı: `android/.../ErenDeviceModule.kt`, Expo adı `Name("ErenDevice")`.
// Yüzey `ErenDevice.types.ts` ile donmuştur; yapısal sınır orada (cmd/cmd_result/payload/token yok).
import { requireNativeModule } from "expo";
import type { ErenDeviceModulu } from "./src/ErenDevice.types";

export type * from "./src/ErenDevice.types";

export default requireNativeModule<ErenDeviceModulu>("ErenDevice");
