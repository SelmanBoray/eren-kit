// Telefon uygulaması için bir kerelik adb kurulumu: WRITE_SECURE_SETTINGS izni ve kullanım erişimi.
// Kullanım: node --disable-warning=ExperimentalWarning kurulum/telefon.ts
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PAKET = "dev.eren.app";
const IZIN = "android.permission.WRITE_SECURE_SETTINGS";
const APPOP = "GET_USAGE_STATS";

export type AdbCihaz = { seri: string; durum: string };

/** `adb devices` çıktısını ayrıştırır; başlık ve daemon satırları atlanır. */
export const adbCihazlari = (cikti: string): AdbCihaz[] => {
  const sonuc: AdbCihaz[] = [];
  for (const satir of cikti.split(/\r?\n/)) {
    const s = satir.trim();
    if (s === "" || s.startsWith("List of devices") || s.startsWith("*")) continue;
    const m = /^(\S+)\s+(\S+)/.exec(s);
    if (m) sonuc.push({ seri: m[1]!, durum: m[2]! });
  }
  return sonuc;
};

/** `dumpsys package` çıktısında izin: verilmişse true, reddedilmişse false, satır yoksa null. */
export const izinVerildiMi = (dumpsys: string, izin: string): boolean | null => {
  let bulundu = false;
  for (const satir of dumpsys.split(/\r?\n/)) {
    const m = /^\s*([\w.]+):\s*granted=(true|false)\b/.exec(satir);
    if (m === null || m[1] !== izin) continue;
    if (m[2] === "true") return true;
    bulundu = true;
  }
  return bulundu ? false : null;
};

/** `appops get` çıktısından `APPOP: mod` modunu döner (ör. "allow"); tanınmazsa null. */
export const appopModu = (cikti: string, appop: string): string | null => {
  for (const satir of cikti.split(/\r?\n/)) {
    const m = /^\s*([A-Z_0-9]+):\s*([a-z_]+)/.exec(satir);
    if (m !== null && m[1] === appop) return m[2]!;
  }
  return null;
};

type Sonuc = { kod: number; cikti: string };

const calistir = (adb: string, argumanlar: string[]): Sonuc => {
  const r = spawnSync(adb, argumanlar, { encoding: "utf8", windowsHide: true });
  if (r.error) return { kod: 1, cikti: String(r.error.message) };
  return { kod: r.status ?? 1, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

const adbBul = (): string | null => {
  const yol = spawnSync("adb", ["version"], { encoding: "utf8", windowsHide: true });
  if (!yol.error && yol.status === 0) return "adb";
  const yerel = process.env["LOCALAPPDATA"];
  if (yerel !== undefined) {
    const aday = join(yerel, "Android", "Sdk", "platform-tools", "adb.exe");
    if (existsSync(aday)) return aday;
  }
  return null;
};

const ilkSatir = (s: string): string => s.split(/\r?\n/)[0] ?? "";

const ana = (): number => {
  let hata = false;
  const yaz = (m: string): void => void process.stdout.write(`${m}\n`);
  const bitir = (m: string): number => {
    process.stderr.write(`${m}\n`);
    return 1;
  };

  const adb = adbBul();
  if (adb === null) {
    return bitir(
      "adb bulunamadı. Android platform-tools kurun (https://developer.android.com/tools/releases/platform-tools) " +
        "ve adb'yi PATH'e ekleyin ya da %LOCALAPPDATA%\\Android\\Sdk\\platform-tools altına açın.",
    );
  }
  yaz(`adb: ${adb}`);

  const liste = calistir(adb, ["devices"]);
  if (liste.kod !== 0) return bitir(`adb devices çalışmadı: ${liste.cikti}`);
  const cihazlar = adbCihazlari(liste.cikti);
  if (cihazlar.length === 0) {
    return bitir(
      "Bağlı telefon yok. Telefonu USB ile bağlayın; Geliştirici seçenekleri'nde 'USB hata ayıklama' ve " +
        "'USB hata ayıklama (Güvenlik ayarları)' açık olsun, sonra yeniden çalıştırın.",
    );
  }
  if (cihazlar.length > 1) {
    return bitir(`Birden çok cihaz bağlı (${cihazlar.map((c) => c.seri).join(", ")}). Yalnız telefonu bırakıp diğerlerini çıkarın.`);
  }
  const cihaz = cihazlar[0]!;
  if (cihaz.durum === "unauthorized") {
    return bitir("Telefon yetkilendirilmemiş (unauthorized). Telefon ekranındaki 'USB hata ayıklamaya izin ver' sorusunu onaylayıp yeniden çalıştırın.");
  }
  if (cihaz.durum !== "device") {
    return bitir(`Telefon kullanıma hazır değil (durum: ${cihaz.durum}). Kabloyu çıkarıp takın, USB hata ayıklamayı kontrol edin.`);
  }
  yaz(`Adım 2 tamam: cihaz bağlı (${cihaz.seri}).`);

  const kurulu = calistir(adb, ["shell", "pm", "path", PAKET]);
  if (kurulu.kod !== 0 || !/package:/.test(kurulu.cikti)) {
    return bitir(`Uygulama telefonda kurulu değil (${PAKET}). Önce uygulamayı kurun.`);
  }
  yaz(`Adım 3 tamam: ${PAKET} kurulu.`);

  const ver = calistir(adb, ["shell", "pm", "grant", PAKET, IZIN]);
  if (ver.kod !== 0 || /exception|error|denied/i.test(ver.cikti)) {
    hata = true;
    const guvenlik = /SecurityException|INJECT_EVENTS|neither user/i.test(ver.cikti);
    yaz(
      `Adım 4 HATA: ${IZIN} verilemedi: ${ilkSatir(ver.cikti)}` +
        (guvenlik ? " Bazı üreticilerin (ör. MIUI tabanlı) sürümlerinde Geliştirici seçenekleri'nde 'USB hata ayıklama (Güvenlik ayarları)' açık olmalı (SIM/Mi hesabı gerekebilir)." : ""),
    );
  } else yaz(`Adım 4 tamam: ${IZIN} verildi.`);

  const op = calistir(adb, ["shell", "appops", "set", PAKET, APPOP, "allow"]);
  if (op.kod !== 0 || /exception|error/i.test(op.cikti)) {
    hata = true;
    yaz(`Adım 5 HATA: ${APPOP} açılamadı: ${ilkSatir(op.cikti)}`);
  } else yaz(`Adım 5 tamam: ${APPOP} allow yapıldı.`);

  const dump = calistir(adb, ["shell", "dumpsys", "package", PAKET]);
  if (izinVerildiMi(dump.cikti, IZIN) === true) yaz(`Adım 6a tamam: ${IZIN} granted=true.`);
  else {
    hata = true;
    yaz(`Adım 6a HATA: ${IZIN} doğrulanamadı (granted=true görülmedi).`);
  }
  const get = calistir(adb, ["shell", "appops", "get", PAKET, APPOP]);
  if (appopModu(get.cikti, APPOP) === "allow") yaz(`Adım 6b tamam: ${APPOP} allow.`);
  else {
    hata = true;
    yaz(`Adım 6b HATA: ${APPOP} allow değil (${ilkSatir(get.cikti) || "çıktı yok"}).`);
  }

  yaz(
    "UYARI: Kurulum bitince USB hata ayıklamayı kapatın. Açık kalırsa telefonun güvenlik katmanları atlanabilir; " +
      "uygulama da açıkken kırmızı uyarı gösterir.",
  );
  return hata ? 1 : 0;
};

if (import.meta.main) process.exit(ana());
