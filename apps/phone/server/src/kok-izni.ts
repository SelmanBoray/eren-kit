/**
 * Veri kökünün erişim izni kuralı (saf, bağımlılıksız). Kök; özel anahtarı, veritabanını, köprü
 * jetonlarını ve zamanlanmış görevin çalıştırdığı kodu (`uygulama\`) tutar. Başka bir yerel hesap kökü
 * okuyabilirse sırları alır, yazabilirse kodu değiştirip kullanıcının kimliğiyle çalıştırır.
 *
 * Kural: kökün sahibi kullanıcının kendisi (ya da SYSTEM/Administrators) olmalı ve kökte izin veren
 * her ACE yalnız kullanıcıya, SYSTEM'e, Administrators'a ya da sahibe çözülen bir SID'e ait olmalı.
 * Reddeden ACE'ler zararsızdır. Çözülemeyen tanım güvensiz sayılır (kapalı başarısızlık).
 *
 * Servis (`dis-dunya.ts` `veriKokuIzniHazirla`) güvensiz kökle açılmaz; kurulum (`kurulum/kur.ts`)
 * aynı kuralla denetler ve kökü daraltır. Kural tek yerdedir: kurulum bu dosyayı içe aktarır.
 */

/** Windows sabit SID'leri. */
export const SID = {
  SYSTEM: "S-1-5-18",
  ADMINISTRATORS: "S-1-5-32-544",
  CREATOR_OWNER: "S-1-3-0",
  OWNER_RIGHTS: "S-1-3-4",
} as const;

/**
 * SDDL'deki iki harfli takma adlar. Yalnız dosya sisteminde görülebilecekler; tabloda olmayan takma ad
 * olduğu gibi kalır (izinli kümede olmadığı için güvensiz sayılır).
 */
const TAKMA_ADLAR: Readonly<Record<string, string>> = {
  SY: SID.SYSTEM,
  BA: SID.ADMINISTRATORS,
  CO: SID.CREATOR_OWNER,
  OW: SID.OWNER_RIGHTS,
  CG: "S-1-3-1",
  WD: "S-1-1-0",
  AN: "S-1-5-7",
  AU: "S-1-5-11",
  BU: "S-1-5-32-545",
  BG: "S-1-5-32-546",
  PU: "S-1-5-32-547",
  AO: "S-1-5-32-548",
  SO: "S-1-5-32-549",
  BO: "S-1-5-32-551",
  RU: "S-1-5-32-554",
  RD: "S-1-5-32-555",
  IU: "S-1-5-4",
  SU: "S-1-5-6",
  NU: "S-1-5-2",
  NS: "S-1-5-20",
  LS: "S-1-5-19",
  RC: "S-1-5-12",
  WR: "S-1-5-33",
  PS: "S-1-5-10",
  AC: "S-1-15-2-1",
};

/** Reddeden ACE türleri; geri kalan her tür izin veren sayılır (bilinmeyen tür de: kapalı başarısızlık). */
const RED_TURLERI = new Set(["D", "OD", "XD"]);

export interface SddlAce {
  readonly tur: string;
  readonly bayraklar: string;
  readonly haklar: string;
  /** Takma ad açılmış SID (büyük harf). */
  readonly sid: string;
}

export interface SddlCozumu {
  /** Takma ad açılmış sahip SID'i; tanımda yoksa `null`. */
  readonly sahip: string | null;
  /** `D:` yoksa `null` (DACL okunmadı). */
  readonly dacl: {
    readonly bayraklar: string;
    readonly aceler: readonly SddlAce[];
  } | null;
}

const sidAc = (ham: string): string => {
  const s = ham.trim().toUpperCase();
  return TAKMA_ADLAR[s] ?? s;
};

const SID_DESENI = /^(?:[A-Z]{2}|S-1-[0-9]+(?:-[0-9]+)*)/;

/**
 * SDDL metnini çözer: sahip, DACL bayrakları ve ACE'ler. Biçim bozuksa `null`. Koşullu ACE'lerin
 * (`XA`, iç içe parantez) kendisi okunur, koşul yok sayılır: izin veren tür olarak değerlendirilir.
 */
export function sddlCoz(sddl: string): SddlCozumu | null {
  const metin = sddl.trim();
  let i = 0;
  let sahip: string | null = null;
  let dacl: { bayraklar: string; aceler: SddlAce[] } | null = null;
  while (i < metin.length) {
    const bolum = metin.slice(i, i + 2);
    if (bolum === "O:" || bolum === "G:") {
      const m = SID_DESENI.exec(metin.slice(i + 2));
      if (m === null) return null;
      if (bolum === "O:") sahip = sidAc(m[0]);
      i += 2 + m[0].length;
      continue;
    }
    if (bolum === "D:" || bolum === "S:") {
      i += 2;
      const bayrakBas = i;
      while (i < metin.length && metin[i] !== "(" && !/^[DS]:/.test(metin.slice(i, i + 2))) i += 1;
      const bayraklar = metin.slice(bayrakBas, i);
      if (!/^(?:P|AI|AR|NO_ACCESS_CONTROL)*$/.test(bayraklar)) return null;
      const aceler: SddlAce[] = [];
      while (i < metin.length && metin[i] === "(") {
        let derinlik = 0;
        const bas = i;
        for (; i < metin.length; i += 1) {
          if (metin[i] === "(") derinlik += 1;
          else if (metin[i] === ")") {
            derinlik -= 1;
            if (derinlik === 0) break;
          }
        }
        if (derinlik !== 0) return null;
        const alanlar = metin.slice(bas + 1, i).split(";");
        i += 1;
        if (alanlar.length < 6) return null;
        const [tur, bayrak, haklar, , , sidHam] = alanlar as [string, string, string, string, string, string];
        if (!SID_DESENI.test(sidHam.trim().toUpperCase())) return null;
        aceler.push({ tur: tur.toUpperCase(), bayraklar: bayrak.toUpperCase(), haklar, sid: sidAc(sidHam) });
      }
      if (bolum === "D:") dacl = { bayraklar, aceler };
      continue;
    }
    return null;
  }
  return { sahip, dacl };
}

export type KokIzniSorunu =
  /** Kökün sahibi başka bir hesap: sahip DACL'i her an değiştirebilir. */
  | { readonly tur: "sahip"; readonly kimlik: string }
  /** Başka bir hesaba izin veren ACE. `kalitimla`: üst klasörden gelir (`ID` bayrağı). */
  | { readonly tur: "erisim"; readonly kimlik: string; readonly kalitimla: boolean }
  /** DACL yok ya da `NO_ACCESS_CONTROL`: herkes her şeyi yapar. */
  | { readonly tur: "dacl_yok" }
  /** POSIX: grup ya da başkaları için kip biti açık. */
  | { readonly tur: "kip"; readonly kip: string }
  /** İzin tanımı okunamadı ya da çözülemedi. */
  | { readonly tur: "cozulemedi" };

export type KokIzniSonucu =
  | { readonly guvenli: true }
  | { readonly guvenli: false; readonly sorunlar: readonly KokIzniSorunu[] };

/** Windows: kökün SDDL'ini kullanıcının SID'ine göre değerlendirir. */
export function windowsKokIzniDegerlendir(sddl: string, kullaniciSid: string): KokIzniSonucu {
  const c = sddlCoz(sddl);
  const ben = kullaniciSid.trim().toUpperCase();
  if (c === null || !/^S-1-[0-9]+(?:-[0-9]+)+$/.test(ben)) return { guvenli: false, sorunlar: [{ tur: "cozulemedi" }] };
  const sorunlar: KokIzniSorunu[] = [];
  const guvenilirSahip = new Set([ben, SID.SYSTEM, SID.ADMINISTRATORS]);
  if (c.sahip === null) sorunlar.push({ tur: "cozulemedi" });
  else if (!guvenilirSahip.has(c.sahip)) sorunlar.push({ tur: "sahip", kimlik: c.sahip });
  if (c.dacl === null || c.dacl.bayraklar.includes("NO_ACCESS_CONTROL")) {
    sorunlar.push({ tur: "dacl_yok" });
  } else {
    // CREATOR OWNER yalnız kalıtım şablonudur: alt öğeyi oluşturana döner; oluşturabilen zaten izinli
    // biridir. OWNER RIGHTS sahibe uygulanır; sahip yukarıda denetlendi. CREATOR GROUP izinli değildir:
    // birincil grup (çoğu makinede "None") bütün yerel kullanıcıları kapsar.
    const izinli = new Set([ben, SID.SYSTEM, SID.ADMINISTRATORS, SID.CREATOR_OWNER, SID.OWNER_RIGHTS]);
    const gorulen = new Set<string>();
    for (const ace of c.dacl.aceler) {
      if (RED_TURLERI.has(ace.tur) || izinli.has(ace.sid)) continue;
      const kalitimla = ace.bayraklar.includes("ID");
      const anahtar = `${ace.sid}|${kalitimla}`;
      if (gorulen.has(anahtar)) continue;
      gorulen.add(anahtar);
      sorunlar.push({ tur: "erisim", kimlik: ace.sid, kalitimla });
    }
  }
  return sorunlar.length === 0 ? { guvenli: true } : { guvenli: false, sorunlar };
}

/** POSIX (macOS, Linux): sahip kullanıcı olmalı, grup ve başkalarının hiçbir biti açık olmamalı. */
export function posixKokIzniDegerlendir(d: { readonly uid: number; readonly kip: number; readonly kullaniciUid: number }): KokIzniSonucu {
  const sorunlar: KokIzniSorunu[] = [];
  if (d.uid !== d.kullaniciUid && d.uid !== 0) sorunlar.push({ tur: "sahip", kimlik: `uid ${d.uid}` });
  if ((d.kip & 0o077) !== 0) sorunlar.push({ tur: "kip", kip: (d.kip & 0o777).toString(8).padStart(3, "0") });
  return sorunlar.length === 0 ? { guvenli: true } : { guvenli: false, sorunlar };
}

/**
 * Windows: kökün olması gereken tanımı. Sahip kullanıcı, kalıtım kesik (`P`), yalnız kullanıcı, SYSTEM
 * ve Administrators tam denetim; alt klasör ve dosyalara kalıtılır (`OICI`).
 */
export function korumaliSddl(kullaniciSid: string): string {
  const ben = kullaniciSid.trim().toUpperCase();
  return `O:${ben}D:PAI(A;OICI;FA;;;${ben})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`;
}

/**
 * Windows PowerShell 5.1 alt sürecine verilecek ortam: `PSModulePath` (büyük küçük harf duyarsız)
 * çıkarılır, tanımsız değerler atılır. PowerShell 7'den başlatılan node bu değişkeni PS7'nin modül
 * klasörleriyle devralır; 5.1 onu aynen kullanınca PS7'nin `Microsoft.PowerShell.Security` modülünü
 * yüklemeye çalışır ve `Get-Acl`/`Set-Acl` "module could not be loaded" ile düşer. Değişken yoksa 5.1
 * kendi varsayılanını kurar (kullanıcı, Program Files ve `$PSHOME` modülleri). Üst kabuk cmd, 5.1 ya da
 * 7 olsun alt süreç aynı ortamı görür.
 */
export function windowsPowerShellOrtami(ortam: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const sonuc: Record<string, string> = {};
  for (const [ad, deger] of Object.entries(ortam)) {
    if (deger === undefined || ad.toUpperCase() === "PSMODULEPATH") continue;
    sonuc[ad] = deger;
  }
  return sonuc;
}

/**
 * Windows PowerShell (5.1, .NET Framework) betiği; `-EncodedCommand` ile çalıştırılır. Yol betiğe
 * base64 (UTF-16LE) olarak girer: tırnak ve PowerShell kaçış kuralları devreye girmez.
 *
 * - `oku`: kök yoksa hata (`kok_yok`).
 * - `hazirla`: kök yoksa `korumaliSddl` tanımıyla TEK adımda oluşturur (`CreateDirectory(yol, güvenlik)`:
 *   oluşturma ile daraltma arasında açık pencere yok); varsa dokunmaz.
 * - `duzelt`: `hazirla` + kök varsa DACL'i `korumaliSddl` ile değiştirir (kalıtım kesilir, alt öğelerin
 *   kalıtılan ACE'leri Windows tarafından yeniden hesaplanır); sahip başkasıysa sahipliği de alır.
 *
 * Çıktı tek satır JSON: `{ sid, sddl, olustu, duzeltildi }` (`izinCiktisiCoz`).
 */
export function izinBetigi(yol: string, kip: "oku" | "hazirla" | "duzelt"): string {
  const b64 = Buffer.from(yol, "utf16le").toString("base64");
  return [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
    `$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}'))`,
    `$kip='${kip}'`,
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$hedef='O:'+$sid+'D:PAI(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'",
    "$olustu=$false; $duzeltildi=$false",
    "if (-not [IO.Directory]::Exists($p)) {",
    "  if ($kip -eq 'oku') { throw 'kok_yok' }",
    "  $ds=New-Object Security.AccessControl.DirectorySecurity",
    "  $ds.SetSecurityDescriptorSddlForm($hedef)",
    "  [void][IO.Directory]::CreateDirectory($p,$ds)",
    "  $olustu=$true",
    "} elseif ($kip -eq 'duzelt') {",
    "  $d=New-Object IO.DirectoryInfo($p)",
    "  $bolum='Access'",
    "  if ($d.GetAccessControl('Owner').GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { $bolum='Owner,Access' }",
    "  $ds=New-Object Security.AccessControl.DirectorySecurity",
    "  $ds.SetSecurityDescriptorSddlForm($hedef,[Security.AccessControl.AccessControlSections]$bolum)",
    "  $d.SetAccessControl($ds)",
    "  $duzeltildi=$true",
    "}",
    // Cmdlet değil .NET: modül yüklemesine bağlı kalmaz (bkz. `windowsPowerShellOrtami`).
    "$sddl=(New-Object IO.DirectoryInfo($p)).GetAccessControl('Owner,Group,Access').GetSecurityDescriptorSddlForm('Owner,Group,Access')",
    "ConvertTo-Json -Compress @{sid=$sid; sddl=$sddl; olustu=$olustu; duzeltildi=$duzeltildi}",
  ].join("\n");
}

export interface IzinCiktisi {
  readonly sid: string;
  readonly sddl: string;
  readonly olustu: boolean;
  readonly duzeltildi: boolean;
}

/** `izinBetigi` çıktısı; bozuksa `null`. */
export function izinCiktisiCoz(metin: string): IzinCiktisi | null {
  try {
    const satir = metin.replace(/^﻿/, "").trim().split(/\r?\n/).filter((s) => s.trim() !== "").at(-1) ?? "";
    const j: unknown = JSON.parse(satir);
    if (typeof j !== "object" || j === null) return null;
    const { sid, sddl, olustu, duzeltildi } = j as Record<string, unknown>;
    if (typeof sid !== "string" || typeof sddl !== "string") return null;
    return { sid, sddl, olustu: olustu === true, duzeltildi: duzeltildi === true };
  } catch {
    return null;
  }
}

/** Sorunun kısa, değer taşımayan açıklaması (servis günlüğüne de girer: yol yazılmaz). */
export function sorunMetni(s: KokIzniSorunu): string {
  switch (s.tur) {
    case "sahip":
      return `sahibi başka bir hesap (${s.kimlik})`;
    case "erisim":
      return `${s.kimlik} erişebiliyor${s.kalitimla ? " (üst klasörden kalıtım)" : ""}`;
    case "dacl_yok":
      return "erişim listesi yok (herkes erişebilir)";
    case "kip":
      return `kip ${s.kip} (grup ya da başkaları erişebilir)`;
    case "cozulemedi":
      return "izinler okunamadı";
  }
}

/** Kökü kurulumla daraltan komut (`apps/phone` içinden). */
export const IZIN_DUZELT_KOMUTU = "node --disable-warning=ExperimentalWarning kurulum/kur.ts --izin-duzelt";

/** Servisin açılmayı reddederken yazdığı ileti. Yol taşımaz. */
export function kokIzniHataMetni(sorunlar: readonly KokIzniSorunu[]): string {
  return (
    `veri kökü başka hesaplara açık: ${sorunlar.map(sorunMetni).join("; ")}. ` +
    `Servis bu kökle açılmaz; apps/phone içinde \`${IZIN_DUZELT_KOMUTU}\` ile daraltın`
  );
}
