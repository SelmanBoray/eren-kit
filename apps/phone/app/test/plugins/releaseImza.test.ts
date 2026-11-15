// plugins/with-release-imza.js: release APK'nın debug anahtarıyla imzalanmasını engelleyen build.gradle dönüşümü.
// fixtures/app-build.gradle, `expo prebuild` çıktısındaki gerçek android/app/build.gradle'ın kopyasıdır (android/ git'te
// izlenmez). Yerelde prebuild çıktısı varsa dönüşüm onun üzerinde de sınanır.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

type Denetim = { tur: "yok" } | { tur: "uyar" | "dur"; ileti: string };

interface ReleaseImzaPlugin {
  releaseImzaUygula(metin: string): string;
  eskiAndroidDenetle(
    projeKoku: string | undefined,
    argv: string[],
    bag: { varMi(yol: string): boolean; oku(yol: string): string },
  ): Denetim;
  AYARLAR: Record<string, string>;
  KONTROL_BAGLANAN_GOREVLER: string;
  BLOK_BASI: string;
  BLOK_SONU: string;
}

const BURASI = dirname(fileURLToPath(import.meta.url));
const UYGULAMA = join(BURASI, "..", "..");
const plugin = createRequire(import.meta.url)(join(UYGULAMA, "plugins", "with-release-imza.js")) as ReleaseImzaPlugin;
const { releaseImzaUygula, AYARLAR, KONTROL_BAGLANAN_GOREVLER, BLOK_BASI, BLOK_SONU } = plugin;

const FIXTURE = readFileSync(join(BURASI, "fixtures", "app-build.gradle"), "utf8");
const YEREL_PREBUILD = join(UYGULAMA, "android", "app", "build.gradle");

/** `{` ile eşleşen `}`'e kadar `ad { ... }` gövdesi (sınama için kaba ayraç sayımı yeter). */
function govde(metin: string, ad: string, bas = 0): string {
  const i = metin.indexOf(`${ad} {`, bas);
  assert.ok(i >= 0, `${ad} bloğu yok`);
  let derinlik = 0;
  for (let j = metin.indexOf("{", i); j < metin.length; j++) {
    if (metin[j] === "{") derinlik++;
    if (metin[j] === "}" && --derinlik === 0) return metin.slice(i, j + 1);
  }
  throw new Error(`${ad} kapanmıyor`);
}

/** Şablonun kendi `android { }` bloğu (üretilmiş bloktan önce). */
function sablonAndroid(metin: string): string {
  return govde(metin.slice(0, metin.indexOf(BLOK_BASI)), "\nandroid");
}

function uretilmisBlok(metin: string): string {
  const bas = metin.indexOf(BLOK_BASI);
  const son = metin.indexOf(BLOK_SONU);
  assert.ok(bas >= 0 && son > bas, "üretilmiş blok yok");
  return metin.slice(bas, son + BLOK_SONU.length);
}

function ortakDogrula(girdi: string): void {
  // Ön koşul: şablon gerçekten release'i debug anahtarıyla imzalıyor (bulgunun kaynağı).
  assert.match(govde(govde(girdi, "buildTypes"), "release"), /signingConfig signingConfigs\.debug/);

  const cikti = releaseImzaUygula(girdi);
  const android = sablonAndroid(cikti);
  const turler = govde(android, "buildTypes");

  // Release'te debug imzası kalmadı; debug derleme türü ve debug imza ayarı aynen duruyor.
  assert.doesNotMatch(govde(turler, "release"), /signingConfigs\.debug/);
  assert.equal(govde(turler, "debug"), govde(govde(girdi, "buildTypes"), "debug"));
  assert.equal(govde(android, "signingConfigs"), govde(girdi, "signingConfigs"));

  // Blok bir kez, dosyanın sonunda; release imzası yalnız kullanıcı keystore'una ya da null'a bağlanıyor.
  const blok = uretilmisBlok(cikti);
  assert.equal(cikti.split(BLOK_BASI).length, 2);
  assert.ok(cikti.trimEnd().endsWith(BLOK_SONU));
  assert.match(blok, /signingConfig = erenImzaHazir \? signingConfigs\.erenKitRelease : null/);
  assert.doesNotMatch(blok, /signingConfig\s*=?\s*signingConfigs\.debug/);
  for (const ad of Object.values(AYARLAR)) assert.ok(blok.includes(`'${ad}'`), `${ad} okunmuyor`);
  assert.match(blok, /providers\.gradleProperty\(ad\)\.orElse\(providers\.environmentVariable\(ad\)\)/);

  // Kontrol görevi tanımlı, release yoluna bağlı ve debug sertifikasını reddediyor.
  assert.match(blok, /tasks\.register\('erenKitReleaseImzaKontrol'\)/);
  assert.match(blok, /gorev\.dependsOn\(erenImzaKontrol\)/);
  assert.ok(blok.includes(`gorev.name ==~ '${KONTROL_BAGLANAN_GOREVLER}'`));
  assert.match(blok, /CN=Android Debug/);
  assert.match(blok, /5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25/);

  // Sırsız: blokta parola ya da yol değeri yok, yalnız ayar adları.
  assert.doesNotMatch(blok, /storePassword\s*=?\s*'[^']/);

  // İdempotent: prebuild (--clean olmadan) dönüşümü yeniden uygulayabilir.
  assert.equal(releaseImzaUygula(cikti), cikti);
}

describe("with-release-imza: build.gradle dönüşümü", () => {
  it("prebuild şablonu (fixture): release debug'a düşmez, debug değişmez, kontrol bağlı", () => {
    ortakDogrula(FIXTURE);
  });

  it("yerel prebuild çıktısı (varsa): aynı garanti", { skip: !existsSync(YEREL_PREBUILD) }, () => {
    const yerel = readFileSync(YEREL_PREBUILD, "utf8");
    // Yerel ağaç bu plugin'le üretilmişse geri dönüşte de aynı sonuç çıkmalı; değilse ham şablon gibi sınanır.
    if (yerel.includes(BLOK_BASI)) assert.equal(releaseImzaUygula(yerel), yerel.replace(/\r\n/g, "\n"));
    else ortakDogrula(yerel);
  });

  it("CRLF satır sonlu şablonda da çalışır", () => {
    const cikti = releaseImzaUygula(FIXTURE.replace(/\n/g, "\r\n"));
    assert.equal(cikti, releaseImzaUygula(FIXTURE));
  });

  it("kontrol görevi yalnız release paketleme/imzalama görevlerine bağlanır", () => {
    const desen = new RegExp(KONTROL_BAGLANAN_GOREVLER);
    for (const ad of ["preReleaseBuild", "packageRelease", "signReleaseBundle", "preProdReleaseBuild", "packageReleaseBundle"]) {
      assert.ok(desen.test(ad), `${ad} kontrolsüz kalır`);
    }
    for (const ad of [
      "preDebugBuild",
      "packageDebug",
      "signDebugBundle",
      "packageReleaseResources",
      "preReleaseUnitTestBuild",
      "compileReleaseKotlin",
      "erenKitReleaseImzaKontrol",
    ]) {
      assert.ok(!desen.test(ad), `${ad} gereksiz yere bağlanıyor`);
    }
  });

  it("release bloğu bulunamazsa prebuild durur (sessizce geçmez)", () => {
    const releasesiz = FIXTURE.replace(/\n {8}release \{/, "\n        staging {");
    assert.throws(() => releaseImzaUygula(releasesiz), /buildTypes\.release/);
    assert.throws(() => releaseImzaUygula("apply plugin: 'x'\n"), /android/);
  });

  it("release'te tanınmayan biçimde debug imzası kalırsa prebuild durur", () => {
    const tuhaf = FIXTURE.replace(
      /(release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig(android.signingConfigs.debug)",
    );
    assert.notEqual(tuhaf, FIXTURE);
    assert.throws(() => releaseImzaUygula(tuhaf), /debug imza/);
  });

  it("'signingConfig = signingConfigs.debug' biçimi de sökülür", () => {
    const esitli = FIXTURE.replace(
      /(release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig = signingConfigs.debug",
    );
    const cikti = releaseImzaUygula(esitli);
    assert.doesNotMatch(govde(govde(sablonAndroid(cikti), "buildTypes"), "release"), /signingConfigs\.debug/);
  });
});

describe("with-release-imza: plugin'den önce üretilmiş android/ klasörü", () => {
  const KOK = join(BURASI, "sahte-proje");
  const GRADLE = join(KOK, "android", "app", "build.gradle");
  /** `gradle` null: android/ yok. */
  const bag = (gradle: string | null) => ({
    varMi: (yol: string) => gradle !== null && yol === GRADLE,
    oku: (yol: string) => {
      assert.equal(yol, GRADLE);
      return gradle ?? "";
    },
  });
  const cli = (...a: string[]) => ["node", "expo", ...a];

  it("eski android/ ile release yolu durur: run:android --variant release ve Android export:embed", () => {
    for (const argv of [
      cli("run:android", "--variant", "release"),
      cli("run:android", "--variant=Release"),
      cli("export:embed", "--platform", "android", "--dev", "false"),
    ]) {
      const d = plugin.eskiAndroidDenetle(KOK, argv, bag(FIXTURE));
      assert.equal(d.tur, "dur", argv.join(" "));
      assert.match(d.tur === "dur" ? d.ileti : "", /expo prebuild -p android --clean/);
    }
  });

  it("eski android/ ile debug derlemesi ve başka komutlar yalnız uyarır", () => {
    for (const argv of [cli("run:android"), cli("run:android", "--variant", "debug"), cli("start")]) {
      assert.equal(plugin.eskiAndroidDenetle(KOK, argv, bag(FIXTURE)).tur, "uyar", argv.join(" "));
    }
    assert.equal(plugin.eskiAndroidDenetle(KOK, cli("export:embed", "--platform", "ios"), bag(FIXTURE)).tur, "uyar");
  });

  it("prebuild, plugin'i almış android/, android/ yokluğu ve bilinmeyen kök dokunulmaz", () => {
    const release = cli("run:android", "--variant", "release");
    assert.equal(plugin.eskiAndroidDenetle(KOK, cli("prebuild", "-p", "android"), bag(FIXTURE)).tur, "yok");
    assert.equal(plugin.eskiAndroidDenetle(KOK, release, bag(releaseImzaUygula(FIXTURE))).tur, "yok");
    assert.equal(plugin.eskiAndroidDenetle(KOK, release, bag(null)).tur, "yok");
    assert.equal(plugin.eskiAndroidDenetle(undefined, release, bag(FIXTURE)).tur, "yok");
  });
});
