/**
 * Kurulumun ortamdan aldığı üç değer ve eski kurulum korumaları.
 *
 * - Veri kökü: `EREN_KIT_DATA_DIR` (mutlak yol zorunlu) varsa o, yoksa `%LOCALAPPDATA%\eren-kit`.
 *   Kural `server/src/veri-koku.ts` (`veriKokuCoz`) ile birebir aynıdır; kurulum sunucu kaynağını içe
 *   aktarmaz, kopyalar. Biri değişirse öteki de değişmeli.
 * - Uygulama kökü: `<veri kökü>\uygulama`.
 * - Görev adı: `EREN_KIT_PHONE_TASK_NAME`, yoksa `eren-kit-telefon`.
 *
 * Eski kurulum: önceki sürümler veriyi `%LOCALAPPDATA%\Eren` altına yazıyor ve görevi `Eren` adıyla
 * kaydediyordu. Bu iki ad kişilik adı değil, yalnız eski kurulumu tanımak için kullanılan sabit
 * tanımlayıcılardır. Ortam değişkenleri verilmeden kurulursa ikinci bir görev (iki servis) ya da
 * ikinci bir veri kökü (bölünmüş veri) doğardı: `eskiKurulumSorunlari` bunları önceden söyler.
 *
 * Görev Zamanlayıcı'nın başlattığı servis yalnız KALICI ortamı (kullanıcı/makine) görür; bir kabukta
 * geçici verilen değişken servise ulaşmaz. `kaliciOrtamKarsilastir` bu farkı yakalar.
 *
 * İçe aktarma yan etkisizdir; süreç başlatan tek işlev `kaliciOrtamOku`'dur.
 */
import { spawnSync } from "node:child_process";
import win32 from "node:path/win32";
import { windowsPowerShellOrtami } from "./izin.ts";

export type Ortam = Readonly<Record<string, string | undefined>>;

export const VERI_KOKU_ORTAMI = "EREN_KIT_DATA_DIR";
export const GOREV_ADI_ORTAMI = "EREN_KIT_PHONE_TASK_NAME";
export const ASISTAN_ADI_ORTAMI = "EREN_KIT_ASSISTANT_NAME";
export const VARSAYILAN_VERI_KLASORU = "eren-kit";
export const VARSAYILAN_GOREV_ADI = "eren-kit-telefon";
/** Eski kurulumun görev adı ve `%LOCALAPPDATA%` altındaki klasör adı (yalnız tanıma için). */
export const ESKI_KURULUM_ADI = "Eren";
/** Eski veri kökü ayrı bir yolla kurulmak istenirse verilen açık bayrak. */
export const ESKI_KOK_BAYRAGI = "--eski-koku-yoksay";

export class OrtamHatasi extends Error {
  override name = "OrtamHatasi";
}

/** Büyük küçük harf duyarsız ortam okuması; boş değer yok sayılır (`veri-koku.ts` ile aynı). */
export const ortamDegeri = (ortam: Ortam, ad: string): string | undefined => {
  const hedef = ad.toUpperCase();
  for (const [k, v] of Object.entries(ortam)) {
    if (k.toUpperCase() === hedef && typeof v === "string" && v !== "") return v;
  }
  return undefined;
};

/** Veri kökü. `EREN_KIT_DATA_DIR` göreliyse ya da (yokken) LOCALAPPDATA tanımsız/göreliyse fırlatır. */
export const veriKoku = (ortam: Ortam): string => {
  const ozel = ortamDegeri(ortam, VERI_KOKU_ORTAMI);
  if (ozel !== undefined) {
    if (!win32.isAbsolute(ozel)) throw new OrtamHatasi(`${VERI_KOKU_ORTAMI} mutlak yol olmalı`);
    return win32.normalize(ozel);
  }
  const la = ortamDegeri(ortam, "LOCALAPPDATA");
  if (la === undefined || !win32.isAbsolute(la)) throw new OrtamHatasi("LOCALAPPDATA tanımlı ve mutlak yol olmalı");
  return win32.join(la, VARSAYILAN_VERI_KLASORU);
};

/** `<veri kökü>\uygulama`. Yalnız yol birleştirir. */
export const uygulamaKoku = (veriKokuYolu: string): string => win32.join(veriKokuYolu, "uygulama");

/**
 * Görev Zamanlayıcı görev adı. Kenar boşlukları atılır; boşsa varsayılan. Komut satırını ya da
 * `schtasks /fo csv` çıktısını bozacak karakterler (denetim karakteri, `"`) reddedilir.
 */
export const gorevAdi = (ortam: Ortam): string => {
  const ham = ortamDegeri(ortam, GOREV_ADI_ORTAMI)?.trim() ?? "";
  if (ham === "") return VARSAYILAN_GOREV_ADI;
  if (/[\u0000-\u001f\u007f"]/.test(ham)) throw new OrtamHatasi(`${GOREV_ADI_ORTAMI} denetim karakteri ya da " içeremez`);
  return ham;
};

const yolAnahtari = (p: string): string => win32.normalize(p).replace(/[\\/]+$/, "").toLowerCase();

export const ayniYolMu = (a: string, b: string): boolean => yolAnahtari(a) === yolAnahtari(b);

export type Yoklama = {
  /** Bu adla bir görev kayıtlı mı (`schtasks /query /tn <ad>`). */
  readonly gorevVar: (ad: string) => boolean;
  /** Bu yol var mı. */
  readonly varMi: (yol: string) => boolean;
};

/** Eski veri kökü: `%LOCALAPPDATA%\Eren`. LOCALAPPDATA yoksa null. */
export const eskiVeriKoku = (ortam: Ortam): string | null => {
  const la = ortamDegeri(ortam, "LOCALAPPDATA");
  return la === undefined || !win32.isAbsolute(la) ? null : win32.join(la, ESKI_KURULUM_ADI);
};

/**
 * Eski kurulumla çakışmalar; boş dizi = sorun yok. İki kural:
 * 1. Eski `Eren` görevi kayıtlı ve etkin görev adı başka: kurulum ikinci bir görev/servis demektir.
 *    Bayrakla geçilemez; ya görev adı eskiye bağlanır ya eski görev önce silinir.
 * 2. Eski veri kökünde kurulum izi (`uygulama` ya da `eren.db`) var ve etkin veri kökü başka:
 *    veri bölünür. Bilerek yeni kökle kurmak için `--eski-koku-yoksay`.
 */
export const eskiKurulumSorunlari = (
  ortam: Ortam,
  yoklama: Yoklama,
  secenek: { readonly eskiKokuYoksay?: boolean } = {},
): string[] => {
  const sorunlar: string[] = [];
  const kok = veriKoku(ortam);
  const gorev = gorevAdi(ortam);
  const eskiKok = eskiVeriKoku(ortam);
  const surdurme =
    `mevcut kurulumu sürdürmek için kalıcı kullanıcı ortamında ${GOREV_ADI_ORTAMI}=${ESKI_KURULUM_ADI}` +
    (eskiKok === null ? "" : ` ve ${VERI_KOKU_ORTAMI}=${eskiKok}`) +
    " ayarlayın, sonra yeni bir kabuk açın";
  if (gorev.toLowerCase() !== ESKI_KURULUM_ADI.toLowerCase() && yoklama.gorevVar(ESKI_KURULUM_ADI)) {
    sorunlar.push(
      `eski '${ESKI_KURULUM_ADI}' görevi kayıtlı, etkin görev adı '${gorev}': devam edilirse iki görev (iki servis) olur; ` +
        `${surdurme}; ya da eski görevi önce silin`,
    );
  }
  if (
    eskiKok !== null &&
    !ayniYolMu(kok, eskiKok) &&
    secenek.eskiKokuYoksay !== true &&
    (yoklama.varMi(win32.join(eskiKok, "uygulama")) || yoklama.varMi(win32.join(eskiKok, "eren.db")))
  ) {
    sorunlar.push(
      `eski veri kökü dolu (${eskiKok}), etkin veri kökü ${kok}: devam edilirse veri bölünür; ` +
        `${surdurme}; bilerek yeni kökle kurmak için ${ESKI_KOK_BAYRAGI}`,
    );
  }
  return sorunlar;
};

/** Kalıcı ortamdaki değer (kullanıcı, yoksa makine). `null` = okunamadı. */
export type KaliciOrtam = Ortam | null;

/**
 * Kurulumun okuduğu değerlerle Görev Zamanlayıcı'nın başlatacağı servisin göreceği kalıcı değerleri
 * karşılaştırır. Veri kökü farkı hatadır (servis başka köke yazar: veri bölünür); görev adı ve asistan
 * adı farkı uyarıdır.
 */
export const kaliciOrtamKarsilastir = (
  surec: Ortam,
  kalici: KaliciOrtam,
): { readonly hatalar: string[]; readonly uyarilar: string[] } => {
  const hatalar: string[] = [];
  const uyarilar: string[] = [];
  if (kalici === null) {
    uyarilar.push(
      `kalıcı kullanıcı ortamı okunamadı; ${VERI_KOKU_ORTAMI}, ${GOREV_ADI_ORTAMI} ve ${ASISTAN_ADI_ORTAMI} ` +
        "servisin göreceği değerlerle karşılaştırılamadı",
    );
    return { hatalar, uyarilar };
  }
  const goster = (v: string | undefined): string => (v === undefined ? "(yok)" : `"${v}"`);
  const fark = (ad: string, a: string | undefined, b: string | undefined): string =>
    `${ad} bu kabukta ${goster(a)}, kalıcı ortamda ${goster(b)}: Görev Zamanlayıcı'nın başlattığı servis kalıcı değeri görür. ` +
    `Kalıcı ortama yazın ([Environment]::SetEnvironmentVariable("${ad}", "<değer>", "User")) ya da kabuktaki değeri kaldırın, sonra yeni bir kabuk açın`;

  const vs = ortamDegeri(surec, VERI_KOKU_ORTAMI);
  const vk = ortamDegeri(kalici, VERI_KOKU_ORTAMI);
  if (vs !== vk && (vs === undefined || vk === undefined || !ayniYolMu(vs, vk))) {
    hatalar.push(`${fark(VERI_KOKU_ORTAMI, vs, vk)}; yoksa veri bölünür`);
  }
  const gs = ortamDegeri(surec, GOREV_ADI_ORTAMI)?.trim() || undefined;
  const gk = ortamDegeri(kalici, GOREV_ADI_ORTAMI)?.trim() || undefined;
  if ((gs ?? VARSAYILAN_GOREV_ADI).toLowerCase() !== (gk ?? VARSAYILAN_GOREV_ADI).toLowerCase()) {
    uyarilar.push(fark(GOREV_ADI_ORTAMI, gs, gk));
  }
  const as = ortamDegeri(surec, ASISTAN_ADI_ORTAMI);
  const ak = ortamDegeri(kalici, ASISTAN_ADI_ORTAMI);
  if (as !== ak) uyarilar.push(fark(ASISTAN_ADI_ORTAMI, as, ak));
  return { hatalar, uyarilar };
};

/**
 * Üç değişkenin kalıcı değerini okur: kullanıcı kapsamı, yoksa makine kapsamı (`REG_EXPAND_SZ`
 * açılmış olarak). Windows PowerShell çalıştırır; okunamazsa null.
 */
export const kaliciOrtamOku = (ortam: Ortam = process.env): KaliciOrtam => {
  const kok = ortamDegeri(ortam, "SystemRoot") ?? ortamDegeri(ortam, "windir") ?? "C:\\Windows";
  const ps = win32.join(kok, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const adlar = [VERI_KOKU_ORTAMI, GOREV_ADI_ORTAMI, ASISTAN_ADI_ORTAMI].map((a) => `'${a}'`).join(",");
  const betik =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $s=@{}; " +
    `foreach($n in @(${adlar})){ $v=[Environment]::GetEnvironmentVariable($n,'User'); ` +
    "if([string]::IsNullOrEmpty($v)){ $v=[Environment]::GetEnvironmentVariable($n,'Machine') }; $s[$n]=$v }; " +
    "$s | ConvertTo-Json -Compress";
  const r = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", betik], {
    encoding: "utf8",
    windowsHide: true,
    // PS7'den devralınan `PSModulePath` 5.1'in modül yüklemesini bozabilir (izin.ts `windowsPowerShellOrtami`).
    env: windowsPowerShellOrtami(ortam),
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 20_000,
  });
  if (r.error !== undefined || r.status !== 0) return null;
  try {
    const v: unknown = JSON.parse(r.stdout.replace(/^\uFEFF/, "").trim());
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const sonuc: Record<string, string | undefined> = {};
    for (const [k, d] of Object.entries(v)) if (typeof d === "string" && d !== "") sonuc[k] = d;
    return sonuc;
  } catch {
    return null;
  }
};
