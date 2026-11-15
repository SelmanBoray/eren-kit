/**
 * Veri kökünün erişim izni (kurulum tarafı). Kök özel anahtarı, veritabanını, köprü jetonlarını ve
 * zamanlanmış görevin çalıştırdığı kodu (`uygulama\`) tutar; başka bir yerel hesaba açıksa o hesap
 * sırları okur ya da kodu değiştirip kullanıcının kimliğiyle çalıştırır.
 *
 * - Kök yoksa yalnız kullanıcıya, SYSTEM'e ve Administrators'a açık olarak tek adımda oluşturulur.
 * - Varsa denetlenir; başka hesaplara açıksa ve kök eren-kit'e aitse (içinde `uygulama` ya da `eren.db`
 *   var ya da boş) daraltılır: kalıtım kesilir, yalnız bu üç kimlik tam denetim alır, sahibi başkasıysa
 *   sahiplik alınır. eren-kit'e ait görünmeyen kök yalnız `--izin-duzelt` ile (bilerek) daraltılır;
 *   sürücü kökü hiç daraltılmaz.
 *
 * Kural tek yerdedir: `server/src/kok-izni.ts` (servis aynı kuralla açılmayı reddeder). `ortam.ts`'teki
 * veri kökü kuralının aksine kopyalanmaz: güvenlik kuralının iki kopyası ayrışırsa kurulumun kabul ettiği
 * kökü servis reddeder ya da tersi. O dosya saf ve bağımlılıksızdır.
 *
 * İçe aktarma yan etkisizdir; süreç başlatan tek yer `gercekIzinBaglari().calistir`'dır.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import win32 from "node:path/win32";
import {
  IZIN_DUZELT_KOMUTU,
  izinBetigi,
  izinCiktisiCoz,
  sorunMetni,
  windowsKokIzniDegerlendir,
  windowsPowerShellOrtami,
} from "../server/src/kok-izni.ts";
import type { IzinCiktisi, KokIzniSorunu } from "../server/src/kok-izni.ts";

export { IZIN_DUZELT_KOMUTU, windowsPowerShellOrtami };

export class IzinHatasi extends Error {
  override name = "IzinHatasi";
}

export type IzinBaglari = {
  /** Betiği Windows PowerShell'de çalıştırır; stdout, başarısızsa `null`. */
  readonly calistir: (betik: string) => string | null;
  readonly varMi: (yol: string) => boolean;
  /** Dizin boş mu (okunamazsa `false`). */
  readonly bosMu: (yol: string) => boolean;
  readonly yaz: (satir: string) => void;
};

export const gercekIzinBaglari = (ortam: Readonly<Record<string, string | undefined>> = process.env): IzinBaglari => ({
  calistir: (betik) => {
    const kok = ortam["SystemRoot"] ?? ortam["windir"] ?? "C:\\Windows";
    const ps = win32.join(kok, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const r = spawnSync(
      ps,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(betik, "utf16le").toString("base64")],
      // PS7'den devralınan `PSModulePath` 5.1'de `Set-Acl`/`Get-Acl` modülünü bozar (`windowsPowerShellOrtami`).
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 60_000, env: windowsPowerShellOrtami(ortam) },
    );
    return r.error === undefined && r.status === 0 ? r.stdout : null;
  },
  varMi: existsSync,
  bosMu: (yol) => {
    try {
      return readdirSync(yol).length === 0;
    } catch {
      return false;
    }
  },
  yaz: (satir) => console.error(satir),
});

export type IzinSonucu = "olusturuldu" | "guvenli" | "daraltildi";

const sorunlarMetni = (s: readonly KokIzniSorunu[]): string => s.map(sorunMetni).join("; ");

const surucuKokuMu = (kok: string): boolean => {
  const n = win32.normalize(kok);
  return win32.parse(n).root.toLowerCase() === n.toLowerCase();
};

/** eren-kit'in kendi kökü mü: kurulum klasörü ya da veritabanı var, ya da kök boş. */
const erenKokuMu = (kok: string, b: IzinBaglari): boolean =>
  b.varMi(win32.join(kok, "uygulama")) || b.varMi(win32.join(kok, "eren.db")) || b.bosMu(kok);

const calistirVeCoz = (b: IzinBaglari, kok: string, kip: "hazirla" | "duzelt"): IzinCiktisi | null => {
  const cikti = b.calistir(izinBetigi(kok, kip));
  return cikti === null ? null : izinCiktisiCoz(cikti);
};

/**
 * Kökü güvenli duruma getirir ya da `IzinHatasi` atar. `bilerek`: `--izin-duzelt` (eren-kit'e ait
 * görünmeyen kökü de daraltır). Kökün kendisi dışında hiçbir şeye dokunmaz; alt öğelerin kalıtılan
 * izinleri Windows tarafından yeniden hesaplanır.
 */
export const veriKokuIzniniSagla = (
  kok: string,
  b: IzinBaglari = gercekIzinBaglari(),
  o: { readonly bilerek?: boolean } = {},
): IzinSonucu => {
  const ilk = calistirVeCoz(b, kok, "hazirla");
  if (ilk === null) {
    throw new IzinHatasi(`veri kökünün izinleri okunamadı (Windows PowerShell çalışmadı ya da kök bir dosya): ${kok}`);
  }
  const durum = windowsKokIzniDegerlendir(ilk.sddl, ilk.sid);
  if (durum.guvenli) {
    if (ilk.olustu) b.yaz(`Veri kökü oluşturuldu; yalnız bu hesaba, SYSTEM'e ve Administrators'a açık: ${kok}`);
    return ilk.olustu ? "olusturuldu" : "guvenli";
  }

  const sorun = sorunlarMetni(durum.sorunlar);
  if (surucuKokuMu(kok)) {
    throw new IzinHatasi(`veri kökü başka hesaplara açık (${sorun}) ve bir sürücü kökü; daraltılmaz. EREN_KIT_DATA_DIR'i ayrı bir klasöre verin: ${kok}`);
  }
  if (o.bilerek !== true && !erenKokuMu(kok, b)) {
    throw new IzinHatasi(
      `veri kökü başka hesaplara açık (${sorun}) ve eren-kit'e ait görünmüyor (içinde 'uygulama' ya da 'eren.db' yok, boş da değil): ${kok}. ` +
        `Ayrı, boş bir klasör verin ya da bu klasörü bilerek daraltın: ${IZIN_DUZELT_KOMUTU}`,
    );
  }

  const son = calistirVeCoz(b, kok, "duzelt");
  const sonDurum = son === null ? null : windowsKokIzniDegerlendir(son.sddl, son.sid);
  if (sonDurum === null || !sonDurum.guvenli) {
    const kalan = sonDurum === null ? "izinler değiştirilemedi" : sorunlarMetni(sonDurum.sorunlar);
    throw new IzinHatasi(
      `veri kökü başka hesaplara açık (${sorun}) ve daraltılamadı (${kalan}): ${kok}. Klasörün sahibi başka bir hesapsa ` +
        "yönetici olarak sahipliği alın ya da EREN_KIT_DATA_DIR'i bu hesabın oluşturduğu yeni bir klasöre verin",
    );
  }
  b.yaz(
    `UYARI: veri kökü başka hesaplara açıktı (${sorun}); izinler yalnız bu hesap, SYSTEM ve Administrators kalacak biçimde daraltıldı: ${kok}. ` +
      "O hesaplara güvenmiyorsanız kökteki kod ve sırlar ele geçirilmiş olabilir: telefon eşleşmelerini kaldırıp yeniden eşleştirin, " +
      "sunucu anahtarını (sunucu-anahtar.pem) ve Telegram jetonunu yenileyin.",
  );
  return "daraltildi";
};
