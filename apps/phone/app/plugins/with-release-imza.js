const { withAppBuildGradle } = require("expo/config-plugins");

// Expo prebuild şablonu release derlemesini herkesin bildiği debug anahtarıyla imzalar
// (`release { signingConfig signingConfigs.debug }`). Aynı anahtarla imzalanmış kötü bir APK, kurulu uygulamanın
// "güncellemesi" olarak kurulup Keystore'daki telefon anahtarını, eşleşmeyi ve tam yetkiyi devralabilir.
// Bu plugin:
//   1. release derleme türündeki debug imza satırını söker;
//   2. dosya sonuna, imzayı yalnız kullanıcının kendi keystore'undan kuran bir blok ekler (ayarlar repo dışından:
//      ~/.gradle/gradle.properties, -P bayrağı ya da aynı adlı ortam değişkeni);
//   3. her release paketleme/imzalama yoluna bir kontrol görevi bağlar: ayar eksikse, son imza ayarı debug'sa ya da
//      keystore'daki sertifika Android debug sertifikasıysa derleme açık bir hatayla durur.
// Ayar yokken release imza ayarı `null` kalır (kontrol atlansa bile çıktı imzasızdır, debug imzalı değil).
// Debug derlemesi etkilenmez. Şablon tanınmazsa prebuild durur (sessizce güvencesiz geçmez).

const BLOK_BASI = "// @generated begin eren-kit-release-imza";
const BLOK_SONU = "// @generated end eren-kit-release-imza";
const SOKULEN_SATIR =
  "// eren-kit: release imzası dosya sonundaki eren-kit-release-imza bloğunda kurulur; debug anahtarı kullanılmaz.";

/** Ayar adları: gradle özelliği ya da ortam değişkeni olarak aynı adla verilir. */
const AYARLAR = {
  storeFile: "EREN_KIT_RELEASE_STORE_FILE",
  storePassword: "EREN_KIT_RELEASE_STORE_PASSWORD",
  keyAlias: "EREN_KIT_RELEASE_KEY_ALIAS",
  keyPassword: "EREN_KIT_RELEASE_KEY_PASSWORD",
};

/** Kontrol görevinin bağlandığı app görevleri: release ön derleme, APK paketleme ve AAB imzalama. */
const KONTROL_BAGLANAN_GOREVLER = "^(pre[A-Za-z]*ReleaseBuild|package[A-Za-z]*Release(Bundle)?|sign[A-Za-z]*ReleaseBundle)$";

/** React Native / Expo şablonundaki herkese açık debug.keystore sertifikasının SHA-1 parmak izi. */
const SABLON_DEBUG_SHA1 = "5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25";

const groovyAyarListesi = Object.entries(AYARLAR)
  .map(([alan, ad]) => `    ${alan}: '${ad}',`)
  .join("\n");

const GROOVY_BLOK = `${BLOK_BASI}
// expo prebuild üretir (plugins/with-release-imza.js); burada elle düzenleme, plugin'i değiştir.
// Release APK yalnız kullanıcının kendi keystore'uyla imzalanır; debug anahtarına düşüş yoktur.
def erenImzaAdlari = [
${groovyAyarListesi}
]
def erenImza = erenImzaAdlari.collectEntries { alan, ad ->
    def deger = providers.gradleProperty(ad).orElse(providers.environmentVariable(ad)).getOrNull()
    [(alan): (deger != null && deger.trim()) ? deger.trim() : null]
}
def erenImzaEksik = erenImzaAdlari.findAll { alan, ad -> erenImza[alan] == null }.values().toList()
def erenImzaHazir = erenImzaEksik.isEmpty()

android {
    signingConfigs {
        if (erenImzaHazir) {
            erenKitRelease {
                storeFile = file(erenImza.storeFile)
                storePassword = erenImza.storePassword
                keyAlias = erenImza.keyAlias
                keyPassword = erenImza.keyPassword
            }
        }
    }
    buildTypes {
        release {
            signingConfig = erenImzaHazir ? signingConfigs.erenKitRelease : null
        }
    }
}

// Kontrol, başka bir betik ya da plugin sonradan değiştirmiş olsa bile AGP'nin kullanacağı son ayara bakar.
def erenSonImza = [:]
afterEvaluate {
    def son = android.buildTypes.findByName('release')?.signingConfig
    erenSonImza.ad = son?.name
    erenSonImza.storeFile = son?.storeFile
    erenSonImza.storePassword = son?.storePassword
    erenSonImza.keyAlias = son?.keyAlias
}

def erenImzaKontrol = tasks.register('erenKitReleaseImzaKontrol') {
    group = 'verification'
    description = 'Release imzasinin kullanicinin kendi keystore\\'u oldugunu dogrular; debug anahtarini reddeder.'
    def eksik = erenImzaEksik
    def son = erenSonImza
    def tarif = [
        'Release APK herkesin bildigi Android debug anahtariyla imzalanmaz: o anahtarla imzalanmis herhangi bir APK',
        'kurulu uygulamanin guncellemesi gibi kurulup telefon anahtarini, eslesmeyi ve tam yetkiyi devralabilir.',
        'Kendi keystore\\'unu repo disinda olustur (bir kez; kaybedersen ayni imzayla guncelleme yapamazsin, yedekle):',
        '  keytool -genkeypair -v -storetype PKCS12 -keystore <repo-disi-yol>/eren-kit-release.p12 -alias eren-kit -keyalg RSA -keysize 4096 -validity 10000',
        'Sonra dort ayari repo disindan ver: ~/.gradle/gradle.properties dosyasina (yolda / kullan) ya da ayni adli ortam degiskeni olarak:',
        '  EREN_KIT_RELEASE_STORE_FILE=<keystore\\'un mutlak yolu>',
        '  EREN_KIT_RELEASE_STORE_PASSWORD=<keystore parolasi>',
        '  EREN_KIT_RELEASE_KEY_ALIAS=eren-kit',
        '  EREN_KIT_RELEASE_KEY_PASSWORD=<anahtar parolasi; PKCS12 keystore\\'da keystore parolasiyla ayni>',
        'Gelistirme icin debug derlemesi (npx expo run:android) bu ayarlar olmadan calisir. Ayrinti: apps/phone/README.md.',
    ].join('\\n')
    def dur = { String neden -> new GradleException('eren-kit: release derlemesi durduruldu: ' + neden + '\\n\\n' + tarif) }
    doLast {
        if (!eksik.isEmpty()) {
            throw dur('release imza anahtari tanimli degil (eksik: ' + eksik.join(', ') + ').')
        }
        if (son.ad == null) {
            throw dur('release derleme turunun imza ayari yok.')
        }
        if (son.ad == 'debug' || son.keyAlias == 'androiddebugkey' || son.storeFile?.name == 'debug.keystore') {
            throw dur('release imzasi debug anahtarina ayarlanmis (imza ayari: ' + son.ad + ', alias: ' + son.keyAlias + ').')
        }
        if (son.storeFile == null || !son.storeFile.isFile()) {
            throw dur('keystore dosyasi bulunamadi: ' + son.storeFile)
        }
        def depo
        try {
            depo = java.security.KeyStore.getInstance(son.storeFile, (son.storePassword ?: '').toCharArray())
        } catch (Exception hata) {
            throw dur('keystore acilamadi (parola yanlis ya da dosya bozuk): ' + hata.message)
        }
        def sertifika = depo.getCertificate(son.keyAlias)
        if (sertifika == null) {
            throw dur('keystore\\'da "' + son.keyAlias + '" adli anahtar yok.')
        }
        def ozne = sertifika.subjectX500Principal.name
        def sha1 = java.security.MessageDigest.getInstance('SHA-1').digest(sertifika.encoded)
            .collect { String.format('%02X', it) }.join(':')
        if (ozne.contains('CN=Android Debug') || sha1 == '${SABLON_DEBUG_SHA1}') {
            throw dur('keystore\\'daki sertifika bir Android debug sertifikasi (' + ozne + ', SHA-1 ' + sha1 + ').')
        }
        logger.lifecycle('eren-kit: release imzasi: ' + ozne + ' (SHA-1 ' + sha1 + ')')
    }
}
tasks.configureEach { gorev ->
    if (gorev.name ==~ '${KONTROL_BAGLANAN_GOREVLER}') {
        gorev.dependsOn(erenImzaKontrol)
    }
}
${BLOK_SONU}
`;

/** `acilis` konumundaki `{` ile eşleşen `}` konumu; dizge ve yorum içindeki ayraçlar sayılmaz. */
function kapanisBul(metin, acilis) {
  let derinlik = 0;
  for (let i = acilis; i < metin.length; i++) {
    const c = metin[i];
    const s = metin[i + 1];
    if (c === "/" && s === "/") {
      while (i < metin.length && metin[i] !== "\n") i++;
    } else if (c === "/" && s === "*") {
      const son = metin.indexOf("*/", i + 2);
      i = son === -1 ? metin.length : son + 1;
    } else if (c === "'" || c === '"') {
      i++;
      while (i < metin.length && metin[i] !== c) {
        if (metin[i] === "\\") i++;
        i++;
      }
    } else if (c === "{") {
      derinlik++;
    } else if (c === "}") {
      derinlik--;
      if (derinlik === 0) return i;
    }
  }
  return -1;
}

/** `ust` aralığında `ad {` bloğunu bulur: [gövde başı, gövde sonu] ya da null. */
function blokBul(metin, ad, bas = 0, son = metin.length) {
  const desen = new RegExp(`(^|[^A-Za-z0-9_.])${ad}\\s*\\{`, "g");
  desen.lastIndex = bas;
  const eslesme = desen.exec(metin);
  if (!eslesme || eslesme.index >= son) return null;
  const acilis = eslesme.index + eslesme[0].length - 1;
  const kapanis = kapanisBul(metin, acilis);
  if (kapanis === -1 || kapanis > son) return null;
  return [acilis + 1, kapanis];
}

function surecDur(neden) {
  return new Error(
    `with-release-imza: ${neden} Expo şablonu değişmiş olabilir; release imzası güvenceye alınamadığı için prebuild durduruldu.`,
  );
}

/** Üretilmiş bloğu (varsa) söker; yeniden uygulamayı idempotent yapar. */
function bloguSok(metin) {
  const bas = metin.indexOf(BLOK_BASI);
  if (bas === -1) return metin;
  const sonIndeks = metin.indexOf(BLOK_SONU, bas);
  if (sonIndeks === -1) throw surecDur("üretilmiş bloğun sonu bulunamadı.");
  let kes = sonIndeks + BLOK_SONU.length;
  if (metin[kes] === "\n") kes++;
  let basKes = bas;
  if (basKes > 0 && metin[basKes - 1] === "\n" && metin[basKes - 2] === "\n") basKes--;
  return metin.slice(0, basKes) + metin.slice(kes);
}

/**
 * Saf dönüşüm: app/build.gradle (Groovy) metni → release imzası kullanıcı keystore'una bağlanmış metin.
 * Şablon tanınmazsa ya da release bloğunda debug imzası kalırsa hata fırlatır.
 */
function releaseImzaUygula(gradleMetni) {
  let metin = bloguSok(gradleMetni.replace(/\r\n/g, "\n"));

  const android = blokBul(metin, "android");
  if (!android) throw surecDur("`android { }` bloğu bulunamadı.");
  const turler = blokBul(metin, "buildTypes", android[0], android[1]);
  if (!turler) throw surecDur("`android.buildTypes { }` bloğu bulunamadı.");
  const release = blokBul(metin, "release", turler[0], turler[1]);
  if (!release) throw surecDur("`buildTypes.release { }` bloğu bulunamadı.");

  const govde = metin
    .slice(release[0], release[1])
    .replace(/^([ \t]*)signingConfig\s*=?\s*signingConfigs\.debug[ \t]*$/m, `$1${SOKULEN_SATIR}`);
  if (/signingConfigs\s*\.\s*debug|getByName\(\s*['"]debug['"]\s*\)/.test(govde)) {
    throw surecDur("release bloğunda tanınmayan bir debug imza ataması kaldı.");
  }
  metin = metin.slice(0, release[0]) + govde + metin.slice(release[1]);

  return `${metin.replace(/\n*$/, "\n")}\n${GROOVY_BLOK}`;
}

function withReleaseImza(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw surecDur(`app/build.gradle dili '${cfg.modResults.language}', yalnız groovy destekleniyor.`);
    }
    cfg.modResults.contents = releaseImzaUygula(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withReleaseImza;
module.exports.releaseImzaUygula = releaseImzaUygula;
module.exports.AYARLAR = AYARLAR;
module.exports.KONTROL_BAGLANAN_GOREVLER = KONTROL_BAGLANAN_GOREVLER;
module.exports.BLOK_BASI = BLOK_BASI;
module.exports.BLOK_SONU = BLOK_SONU;
