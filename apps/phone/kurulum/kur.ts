/**
 * Telefon servisinin sürümlü dağıtımı.
 *
 * Temiz bir commit'i test eder, `<veri kökü>\uygulama\surumler\<sha>\` altına kopyalar,
 * `guncel` junction'ını yeni sürüme çevirir ve bekçiye yeniden başlatmasını söyler. Sorun çıkarsa
 * `--geri-al` önceki sürüme döner. Düzen ve komut satırı: ortak sözleşmenin "Kurulum dizini düzeni"
 * ve "kurulum/kur.ts" bölümleri.
 *
 *   node --disable-warning=ExperimentalWarning kurulum/kur.ts [--kirli] [--testsiz] [--eski-koku-yoksay]
 *   node --disable-warning=ExperimentalWarning kurulum/kur.ts --geri-al [--eski-koku-yoksay]
 *   node --disable-warning=ExperimentalWarning kurulum/kur.ts --durum
 *   node --disable-warning=ExperimentalWarning kurulum/kur.ts --yalniz-test
 *
 * Veri kökü (`EREN_KIT_DATA_DIR`, yoksa `%LOCALAPPDATA%\eren-kit`), görev adı (`EREN_KIT_PHONE_TASK_NAME`,
 * yoksa `eren-kit-telefon`) ve eski kurulum korumaları `ortam.ts`'tedir.
 *
 * Dışa aktarılan fonksiyonlar içe aktarılınca yan etki yapmaz; ana iş en alttaki
 * `if (import.meta.main)` bloğundadır.
 *
 * Junction notları (Node 24.14.1, Windows 11'de ölçüldü): junction hedefi var olmadan kurulabilir;
 * junction içeren dizin ve junction'ın kendisi yeniden adlandırılabilir; `unlinkSync`, `rmdirSync`
 * ve `rmSync` (özyinelemeli dahil) junction'ın yalnız kendisini kaldırır, hedefe dokunmaz. Yine de
 * silme burada kendi yürüyücümüzle yapılır: bağlar `lstat` ile tanınıp tek tek kaldırılır, Node'un
 * `rmSync` gerçeklemesi değişse de hedefler korunur.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { connect } from "node:net";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { veriKokuIzniniSagla } from "./izin.ts";
import type { IzinSonucu } from "./izin.ts";
import {
  ESKI_KOK_BAYRAGI,
  VERI_KOKU_ORTAMI,
  ayniYolMu,
  eskiKurulumSorunlari,
  gorevAdi,
  kaliciOrtamKarsilastir,
  kaliciOrtamOku,
  servisVeriKoku,
  uygulamaKoku,
  veriKoku,
} from "./ortam.ts";
import type { KaliciOrtam, Ortam } from "./ortam.ts";

export { uygulamaKoku, veriKoku } from "./ortam.ts";

/**
 * surum.json. `agac`: temiz kurulumda kaynak ağacının (`apps/phone`) git ağaç kimliği; aynı içerik için sürüm
 * yeniden kullanılır (`temizSurumAdi`). Kirli kurulumda ve bu alandan önceki sürümlerde yok.
 */
export type SurumBilgisi = { readonly sha: string; readonly dal: string; readonly tarih_ms: number; readonly agac?: string };

const BORU_ONEKI = "\\\\.\\pipe\\";
const BEKCI_BORU_ADI = "eren-bekci";
/** ana.ts'in tekil kilidi (dis-dunya.ts TEKIL_KILIT_BORUSU). Bekçi yokken açıksa servis bekçisiz çalışıyor. */
const TEKIL_BORU_ADI = "eren-servis-tekil";
const BEKCI_BORUSU = BORU_ONEKI + BEKCI_BORU_ADI;
const YENI_EKI = ".yeni";
const SIL_EKI = ".sil";
const SURUM_DOSYASI = "surum.json";
const GECMIS_DOSYASI = "gecmis.json";
const GECMIS_SINIRI = 200;
/**
 * Sürüm adı: kaynak ağacına dokunan son commit'in kısa sha'sı (eski kurulumlarda o anki HEAD'inki) ya da
 * `--kirli`'de `<sha>-k<zaman>`. Nokta yok: `.yeni`/`.sil` ile çakışmaz.
 */
const SHA_DESENI = /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;
/** MAX_PATH (260) altında pay: hiçbir hedef yol `\\?\` önekine ihtiyaç duymasın. */
const YOL_SINIRI = 240;
/**
 * server/src'deki giriş dosyaları. Duman testine yalnız `if (import.meta.main)` korumalıysa girer
 * (2026-11-08: dördü de korumalı, tek üst düzey ifadeleri bu koruma); korumasızsa yalnız dış paketleri yüklenir.
 */
const GIRIS_DOSYALARI = new Set(["ana.ts", "kopru.ts", "eslestir.ts", "bekci-ana.ts"]);
const UYARI_BAYRAGI = "--disable-warning=ExperimentalWarning";
const CEVAP_SINIRI = 65_536;
const KAPANMA_BEKLEME_MS = 60_000;
const BASLAMA_BEKLEME_MS = 60_000;
/** Yeni ana bu kadar ayakta kalmadan başarı sayılmaz (ikinci örnek/erken çıkış hemen ölür). */
const KARARLI_MS = 5_000;
/** `schtasks /run`'dan sonra bekçi borusunun gelmesi için süre; gelmezse /run en çok RUN_YINELEME kez yinelenir. */
const BORU_GELME_MS = 10_000;
const RUN_YINELEME = 2;
const TUTULAN_SURUM = 3;
const BEKCISIZ_MESAJ =
  "bekçisiz çalışan bir servis var (\\\\.\\pipe\\eren-servis-tekil açık, bekçi borusu yok); önce onu durdurun " +
  "(iş oturumlarını korumak için taskkill'de /T kullanmadan). Bekçisi yeni ölmüş bir ana kapanıyorsa biraz sonra yeniden deneyin";

class KurHatasi extends Error {
  override name = "KurHatasi";
}

type Sayac = { dosya: number; bayt: number };

// ---------------------------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------------------------

const hataKodu = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e && typeof e.code === "string" ? e.code : undefined;

const tekSatir = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/\s*\r?\n\s*/g, " ").trim();

/** Eşzamanlı bekleme (yalnız kısa yeniden denemeler için). */
const uyu = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const bekle = (ms: number): Promise<void> => new Promise((coz) => setTimeout(coz, ms));

/** Windows'ta virüs tarayıcısı ya da dizin gezgini kısa süre tutamak tutabilir: geçici hatalarda yeniden dene. */
const tekrarla = <T>(is: () => T, deneme = 10, beklemeMs = 200): T => {
  for (let i = 1; ; i++) {
    try {
      return is();
    } catch (e) {
      const kod = hataKodu(e);
      const gecici = kod === "EPERM" || kod === "EBUSY" || kod === "EACCES" || kod === "ENOTEMPTY";
      if (!gecici || i >= deneme) throw e;
      uyu(beklemeMs);
    }
  }
};

const lstatVeya = (yol: string): Stats | null => {
  try {
    return lstatSync(yol);
  } catch (e) {
    if (hataKodu(e) === "ENOENT") return null;
    throw e;
  }
};

const shaDogrula = (sha: string): void => {
  if (!SHA_DESENI.test(sha)) throw new KurHatasi(`geçersiz sürüm adı: ${JSON.stringify(sha)}`);
};

const yolUzunluguDenetle = (yol: string): void => {
  if (yol.length > YOL_SINIRI) {
    throw new KurHatasi(`hedef yol ${yol.length} karakter (sınır ${YOL_SINIRI}): ${yol}`);
  }
};

const ayniYol = (a: string, b: string): boolean => {
  const n = (p: string): string => resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  if (n(a) === n(b)) return true;
  try {
    return n(realpathSync(a)) === n(realpathSync(b));
  } catch {
    return false;
  }
};

const surumlerDizini = (kok: string): string => join(kok, "surumler");

/** Adlandırılmış boru var mı: `\\.\pipe\` listesine bakar, bağlanmaz (sunucunun bağlantısını tüketmez). */
const boruVar = (ad: string): boolean => {
  let adlar: string[];
  try {
    adlar = readdirSync(BORU_ONEKI);
  } catch (e) {
    throw new KurHatasi(`adlandırılmış borular listelenemedi: ${tekSatir(e)}`);
  }
  const aranan = ad.toLowerCase();
  return adlar.some((n) => n.toLowerCase() === aranan);
};

const surecYasiyor = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return hataKodu(e) === "EPERM"; // var ama yetki yok
  }
};

// ---------------------------------------------------------------------------------------------
// Silme: bağlar kendileri kaldırılır, hedefleri izlenmez
// ---------------------------------------------------------------------------------------------

/** Junction ya da sembolik bağın KENDİSİNİ kaldırır; hedefine dokunmaz. */
const baglantiKaldir = (yol: string): void => {
  tekrarla(() => {
    try {
      unlinkSync(yol);
    } catch (e) {
      const kod = hataKodu(e);
      if (kod === "EPERM" || kod === "EISDIR") rmdirSync(yol);
      else throw e;
    }
  });
};

/** Dizin ağacını siler. Bağlara (junction/symlink) girmez, yalnız bağın kendisini kaldırır. */
const agacSil = (yol: string): void => {
  const st = lstatVeya(yol);
  if (st === null) return;
  if (st.isSymbolicLink()) {
    baglantiKaldir(yol);
    return;
  }
  if (st.isDirectory()) {
    for (const ad of readdirSync(yol)) agacSil(join(yol, ad));
    tekrarla(() => rmdirSync(yol));
    return;
  }
  tekrarla(() => {
    try {
      unlinkSync(yol);
    } catch (e) {
      if (hataKodu(e) !== "EPERM") throw e;
      chmodSync(yol, 0o666); // salt okunur dosya
      unlinkSync(yol);
    }
  });
};

// ---------------------------------------------------------------------------------------------
// Kopyalama
// ---------------------------------------------------------------------------------------------

/** Ağacı kopyalar. `haric` yalnız en üst düzeydeki adlara uygulanır; `node_modules\.bin` her düzeyde atlanır. */
const agacKopyala = (
  kaynak: string,
  hedef: string,
  sayac: Sayac,
  haric: ReadonlySet<string> = new Set(),
  derinlik = 0,
): void => {
  if (derinlik > 64) throw new KurHatasi(`dizin çok derin ya da döngülü bağ var: ${kaynak}`);
  yolUzunluguDenetle(hedef);
  mkdirSync(hedef, { recursive: true });
  const nodeModulesIci = basename(kaynak).toLowerCase() === "node_modules";
  for (const e of readdirSync(kaynak, { withFileTypes: true })) {
    if (haric.has(e.name)) continue;
    if (nodeModulesIci && e.name === ".bin") continue;
    const k = join(kaynak, e.name);
    const h = join(hedef, e.name);
    let dizinMi = e.isDirectory();
    let dosyaMi = e.isFile();
    if (e.isSymbolicLink()) {
      let st: Stats;
      try {
        st = statSync(k);
      } catch {
        continue; // kırık bağ: taşınacak içerik yok
      }
      dizinMi = st.isDirectory();
      dosyaMi = st.isFile();
    }
    if (dizinMi) {
      agacKopyala(k, h, sayac, new Set(), derinlik + 1);
    } else if (dosyaMi) {
      yolUzunluguDenetle(h);
      copyFileSync(k, h);
      sayac.dosya += 1;
      sayac.bayt += statSync(k).size;
    }
  }
};

const dosyaKopyala = (kaynak: string, hedef: string, sayac: Sayac): void => {
  if (!existsSync(kaynak)) throw new KurHatasi(`kaynakta eksik: ${kaynak}`);
  yolUzunluguDenetle(hedef);
  mkdirSync(dirname(hedef), { recursive: true });
  copyFileSync(kaynak, hedef);
  sayac.dosya += 1;
  sayac.bayt += statSync(kaynak).size;
};

const dizinKopyala = (kaynak: string, hedef: string, sayac: Sayac, haric?: ReadonlySet<string>): void => {
  const st = lstatVeya(kaynak);
  if (st === null || !statSync(kaynak).isDirectory()) throw new KurHatasi(`kaynakta eksik dizin: ${kaynak}`);
  agacKopyala(kaynak, hedef, sayac, haric);
};

/** Kopyalanmayan geliştirme paketleri ve yerel bağlar. */
const paketHaricMi = (ad: string): boolean => {
  if (ad.startsWith(".")) return true; // .bin, .package-lock.json, .cache
  const ilk = ad.split("/")[0] ?? ad;
  return ad === "typescript" || ilk === "@types" || ilk === "@eren";
};

/**
 * package-lock.json'dan `onek` (kök için "", workspace için "server/") altındaki üst düzey
 * çalışma zamanı paketleri: `dev` ve `link` olmayanlar. Kilit dosyası (ya da `packages`) yoksa null:
 * o zaman node_modules'taki her şey (hariç tutulanlar dışında) kopyalanır.
 *
 * Neden kilit dosyası: geliştirme node_modules'u kilitte olmayan yabancı paketler içerebilir
 * (2026-11-08 ölçümü: 448 paket / 301 MB / en uzun göreli yol 200; kilide göre 92 paket / 16,7 MB).
 */
const kilittekiPaketler = (kaynakKok: string, onek: string): Set<string> | null => {
  const yol = join(kaynakKok, "package-lock.json");
  if (!existsSync(yol)) return null;
  let veri: unknown;
  try {
    veri = JSON.parse(readFileSync(yol, "utf8"));
  } catch {
    throw new KurHatasi(`package-lock.json okunamadı: ${yol}`);
  }
  const paketler = typeof veri === "object" && veri !== null && "packages" in veri ? veri.packages : null;
  if (typeof paketler !== "object" || paketler === null) return null;
  const kacisli = onek.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const desen = new RegExp(`^${kacisli}node_modules/((?:@[^/]+/)?[^/]+)$`);
  const sonuc = new Set<string>();
  for (const [anahtar, deger] of Object.entries(paketler)) {
    const m = desen.exec(anahtar);
    const ad = m?.[1];
    if (ad === undefined) continue;
    const d = (typeof deger === "object" && deger !== null ? deger : {}) as { dev?: unknown; link?: unknown };
    if (d.dev === true || d.link === true) continue;
    sonuc.add(ad);
  }
  return sonuc;
};

const ustDuzeyPaketler = (nm: string): string[] => {
  const adlar: string[] = [];
  for (const e of readdirSync(nm, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (e.name.startsWith("@")) {
      for (const alt of readdirSync(join(nm, e.name))) adlar.push(`${e.name}/${alt}`);
    } else {
      adlar.push(e.name);
    }
  }
  return adlar.sort();
};

const nodeModulesKopyala = (kaynakNm: string, hedefNm: string, izinli: ReadonlySet<string> | null, sayac: Sayac): void => {
  if (!existsSync(kaynakNm)) return;
  const adlar = izinli === null ? ustDuzeyPaketler(kaynakNm) : [...izinli].sort();
  for (const ad of adlar) {
    if (paketHaricMi(ad)) continue;
    const parcalar = ad.split("/");
    const k = join(kaynakNm, ...parcalar);
    if (!existsSync(k)) continue; // kilitte olup kurulmamış (isteğe bağlı/platforma özgü) paket
    agacKopyala(k, join(hedefNm, ...parcalar), sayac);
  }
};

const surumTarihi = (surumDizini: string): number | null => {
  try {
    const v: unknown = JSON.parse(readFileSync(join(surumDizini, SURUM_DOSYASI), "utf8"));
    const t = typeof v === "object" && v !== null && "tarih_ms" in v ? v.tarih_ms : null;
    return typeof t === "number" && Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
};

type KurulumSonucu = { readonly yol: string; readonly yeni: boolean; readonly dosya: number; readonly bayt: number };

const surumKur = (o: { kaynakKok: string; hedefKok: string; bilgi: SurumBilgisi }): KurulumSonucu => {
  const { sha, dal, tarih_ms, agac } = o.bilgi;
  shaDogrula(sha);
  const kaynak = resolve(o.kaynakKok);
  const kok = resolve(o.hedefKok);
  const surumler = surumlerDizini(kok);
  const son = join(surumler, sha);
  const yeni = son + YENI_EKI;

  if (existsSync(join(son, SURUM_DOSYASI))) return { yol: son, yeni: false, dosya: 0, bayt: 0 };
  if (lstatVeya(son) !== null) {
    if (guncelSha(kok) === sha) throw new KurHatasi(`güncel sürüm dizini bozuk (${SURUM_DOSYASI} yok): ${son}`);
    agacSil(son); // yarım kalmış eski deneme
  }

  mkdirSync(surumler, { recursive: true });
  agacSil(yeni);
  mkdirSync(yeni);
  const sayac: Sayac = { dosya: 0, bayt: 0 };
  try {
    dosyaKopyala(join(kaynak, "package.json"), join(yeni, "package.json"), sayac);
    for (const paket of ["server", "protocol"]) {
      dosyaKopyala(join(kaynak, paket, "package.json"), join(yeni, paket, "package.json"), sayac);
      dizinKopyala(join(kaynak, paket, "src"), join(yeni, paket, "src"), sayac);
    }
    if (existsSync(join(kaynak, "kurulum"))) {
      dizinKopyala(join(kaynak, "kurulum"), join(yeni, "kurulum"), sayac, new Set(["test", "node_modules"]));
    }

    nodeModulesKopyala(join(kaynak, "node_modules"), join(yeni, "node_modules"), kilittekiPaketler(kaynak, ""), sayac);
    for (const paket of ["server", "protocol"]) {
      // hoist edilemeyen workspace bağımlılıkları (bugün yok)
      const nm = join(kaynak, paket, "node_modules");
      if (existsSync(nm)) nodeModulesKopyala(nm, join(yeni, paket, "node_modules"), kilittekiPaketler(kaynak, `${paket}/`), sayac);
    }

    // Node node_modules altındaki .ts'i çalıştırmaz: protocol gerçek dizin olarak dışarıda durur,
    // node_modules\@eren\protocol ona junction'dır. Junction mutlak yol saklar; yeniden adlandırma
    // sonrası geçerli olsun diye SON yolu gösterir (o ana dek sarkık durur, zararsız).
    const erenDizini = join(yeni, "node_modules", "@eren");
    mkdirSync(erenDizini, { recursive: true });
    symlinkSync(join(son, "protocol"), join(erenDizini, "protocol"), "junction");

    const surum = agac === undefined ? { sha, dal, tarih_ms } : { sha, dal, tarih_ms, agac };
    writeFileSync(join(yeni, SURUM_DOSYASI), JSON.stringify(surum, null, 2) + "\n");
    tekrarla(() => renameSync(yeni, son));
  } catch (e) {
    try {
      agacSil(yeni);
    } catch {
      // asıl hatayı gölgeleme; artık bir sonraki eskileriTemizle'de silinir
    }
    throw e;
  }
  return { yol: son, yeni: true, dosya: sayac.dosya, bayt: sayac.bayt };
};

// ---------------------------------------------------------------------------------------------
// Geçmiş
// ---------------------------------------------------------------------------------------------

type GecmisKaydi = { readonly sha: string; readonly tarih_ms: number };

const gecmisOku = (kok: string): GecmisKaydi[] => {
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(join(kok, GECMIS_DOSYASI), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const sonuc: GecmisKaydi[] = [];
  for (const g of v as unknown[]) {
    if (typeof g !== "object" || g === null) continue;
    const { sha, tarih_ms } = g as { sha?: unknown; tarih_ms?: unknown };
    if (typeof sha === "string" && SHA_DESENI.test(sha) && typeof tarih_ms === "number" && Number.isFinite(tarih_ms)) {
      sonuc.push({ sha, tarih_ms });
    }
  }
  return sonuc;
};

const gecmisYaz = (kok: string, liste: readonly GecmisKaydi[]): void => {
  const yol = join(kok, GECMIS_DOSYASI);
  const gecici = yol + YENI_EKI;
  const govde = liste.length === 0 ? "[]" : `[\n${liste.map((g) => `  ${JSON.stringify(g)}`).join(",\n")}\n]`;
  writeFileSync(gecici, govde + "\n");
  tekrarla(() => renameSync(gecici, yol));
};

// ---------------------------------------------------------------------------------------------
// Dışa aktarılan çekirdek (sözleşmedeki imzalar)
// ---------------------------------------------------------------------------------------------

/**
 * `surumler\<sha>\` düzenini kurar (önce `<sha>.yeni\`, tamamlanınca yeniden adlandırır), surum.json
 * yazar, `node_modules\@eren\protocol` junction'ını kurar. Sürüm zaten tamsa dokunmadan yolunu döner.
 */
export const surumKopyala = (o: { kaynakKok: string; hedefKok: string; bilgi: SurumBilgisi }): string => surumKur(o).yol;

/**
 * `guncel` junction'ını `surumler\<sha>`'ya çevirir ve gecmis.json'a ekler. Sıra: yeni junction
 * `guncel.yeni` olarak hazırlanır, eski junction hedefine dokunmadan kaldırılır, yenisi yeniden
 * adlandırılır. Sürüm tam değilse (surum.json yok) hata fırlatır.
 */
export const guncelYap = (hedefKok: string, sha: string): void => {
  guncelCevir(hedefKok, sha);
  const kok = resolve(hedefKok);
  const gecmis = [...gecmisOku(kok), { sha, tarih_ms: Date.now() }];
  gecmisYaz(kok, gecmis.slice(-GECMIS_SINIRI));
};

/**
 * Otomatik geri alma: guncel'i `onceki`'ye çevirir ve düşen sürümün geçmiş kaydını GERİ ÇEKER
 * (yeni kayıt eklemez). Böylece geçmiş dağıtımdan önceki hâline döner ve `oncekiSha` düşen sürümü
 * döndürmez; elle `--geri-al` onu yeniden etkinleştiremez.
 */
const otomatikGeriAl = (hedefKok: string, dusen: string, onceki: string): void => {
  guncelCevir(hedefKok, onceki);
  const kok = resolve(hedefKok);
  const gecmis = gecmisOku(kok);
  if (gecmis.at(-1)?.sha === dusen) gecmisYaz(kok, gecmis.slice(0, -1));
};

/**
 * Sürümün `protocol/src/sinirlar.ts`'indeki `SOHBET_SURUMU`. Dosya metin olarak okunur, kod
 * çalıştırılmaz (eski/bozuk sürüm içe aktarılmaz). Sabit ya da dosya yoksa null.
 */
const sohbetSurumu = (hedefKok: string, sha: string): number | null => {
  try {
    const yol = join(surumlerDizini(resolve(hedefKok)), sha, "protocol", "src", "sinirlar.ts");
    const m = /^export const SOHBET_SURUMU\s*=\s*(\d+)/m.exec(readFileSync(yol, "utf8"));
    return m?.[1] === undefined ? null : Number(m[1]);
  } catch {
    return null;
  }
};

/** Geri alınan sürüm `/sohbet` protokolünde şimdikinden geriyse tek satır uyarı yazar; geri almayı engellemez. */
const sohbetUyarisi = (hedefKok: string, geriAlinan: string, simdiki: string): void => {
  const yeni = sohbetSurumu(hedefKok, simdiki);
  if (yeni === null) return;
  const eski = sohbetSurumu(hedefKok, geriAlinan);
  if (eski !== null && eski >= yeni) return;
  console.error(
    `Uyarı: geri alınan sürüm (${geriAlinan}, sohbet ${eski === null ? "sürümü tanımsız" : `v${eski}`}) telefon uygulamasının ` +
      `sohbet protokolünden (v${yeni}) eski; telefon sohbeti ileri sürüme dönene kadar bağlanamaz.`,
  );
};

/** guncel junction'ını çevirir; geçmişe dokunmaz. */
const guncelCevir = (hedefKok: string, sha: string): void => {
  shaDogrula(sha);
  const kok = resolve(hedefKok);
  const surum = join(surumlerDizini(kok), sha);
  if (!existsSync(join(surum, SURUM_DOSYASI))) throw new KurHatasi(`sürüm yok ya da tam değil: ${sha}`);

  const guncel = join(kok, "guncel");
  const gecici = guncel + YENI_EKI;
  agacSil(gecici); // önceki yarım denemeden kalan
  symlinkSync(surum, gecici, "junction");

  const eski = lstatVeya(guncel);
  let eskiHedef: string | null = null;
  try {
    if (eski !== null) {
      if (!eski.isSymbolicLink()) throw new KurHatasi(`guncel bir junction değil, elle bakılmalı: ${guncel}`);
      eskiHedef = readlinkSync(guncel);
      baglantiKaldir(guncel);
    }
    tekrarla(() => renameSync(gecici, guncel));
  } catch (e) {
    try {
      if (eskiHedef !== null && lstatVeya(guncel) === null) symlinkSync(eskiHedef, guncel, "junction");
      agacSil(gecici);
    } catch {
      // asıl hatayı gölgeleme
    }
    throw e;
  }
};

/** `guncel`'in işaret ettiği sürüm adı; junction yoksa ya da `surumler` dışını gösteriyorsa null. */
export const guncelSha = (hedefKok: string): string | null => {
  const kok = resolve(hedefKok);
  const guncel = join(kok, "guncel");
  const st = lstatVeya(guncel);
  if (st === null || !st.isSymbolicLink()) return null;
  let hedef: string;
  try {
    hedef = readlinkSync(guncel);
  } catch {
    return null;
  }
  hedef = hedef.replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "");
  const ad = basename(hedef);
  if (!SHA_DESENI.test(ad)) return null;
  return ayniYol(dirname(hedef), surumlerDizini(kok)) ? ad : null;
};

/** gecmis.json'da, sondan geriye, güncelden FARKLI ilk sha; güncel yoksa ya da bulunamazsa null. */
export const oncekiSha = (hedefKok: string): string | null => {
  const kok = resolve(hedefKok);
  const g = guncelSha(kok);
  if (g === null) return null;
  const gecmis = gecmisOku(kok);
  for (let i = gecmis.length - 1; i >= 0; i--) {
    const s = gecmis[i]?.sha;
    if (s !== undefined && s !== g) return s;
  }
  return null;
};

/**
 * surumler altında surum.json'daki tarih_ms'e göre en yeni `tut` tam sürümü + güncel'i + önceki'yi
 * tutar, gerisini siler ve silinen sürüm adlarını döner. `.yeni`/`.sil` ile biten yarım dizinler ve
 * surum.json'u olmayan yarım sürümler de silinir. Kullanımda olduğu için yeniden adlandırılamayan
 * sürüm atlanır (bir sonraki çağrıda yeniden denenir).
 */
export const eskileriTemizle = (hedefKok: string, tut: number): readonly string[] => {
  if (!Number.isInteger(tut) || tut < 0) throw new RangeError(`tut negatif olmayan tam sayı olmalı: ${tut}`);
  const kok = resolve(hedefKok);
  const surumler = surumlerDizini(kok);
  if (!existsSync(surumler)) return [];
  const korunan = new Set<string>();
  const g = guncelSha(kok);
  const o = oncekiSha(kok);
  if (g !== null) korunan.add(g);
  if (o !== null) korunan.add(o);

  const tamlar: { ad: string; tarih: number }[] = [];
  const yarimlar: string[] = [];
  for (const e of readdirSync(surumler, { withFileTypes: true })) {
    if (e.name.endsWith(YENI_EKI) || e.name.endsWith(SIL_EKI)) {
      try {
        agacSil(join(surumler, e.name));
      } catch {
        // kullanımda; sonraki temizlikte
      }
      continue;
    }
    if (!e.isDirectory() || !SHA_DESENI.test(e.name)) continue; // tanımadığımız şeye dokunma
    const tarih = surumTarihi(join(surumler, e.name));
    if (tarih === null) yarimlar.push(e.name);
    else tamlar.push({ ad: e.name, tarih });
  }
  tamlar.sort((a, b) => b.tarih - a.tarih || (a.ad < b.ad ? 1 : a.ad > b.ad ? -1 : 0));
  for (const t of tamlar.slice(0, tut)) korunan.add(t.ad);

  const silinen: string[] = [];
  for (const ad of [...tamlar.map((t) => t.ad), ...yarimlar]) {
    if (korunan.has(ad)) continue;
    const yol = join(surumler, ad);
    const silYolu = yol + SIL_EKI;
    try {
      agacSil(silYolu);
      // Önce yeniden adlandır: kullanımdaysa burada hızla düşer ve yarım silinmiş bir sürüm adı kalmaz.
      tekrarla(() => renameSync(yol, silYolu), 3, 100);
    } catch {
      continue;
    }
    silinen.push(ad);
    try {
      agacSil(silYolu);
    } catch {
      // .sil artığı sonraki temizlikte gider
    }
  }
  return silinen;
};

/**
 * Bekçi kontrol borusuna tek istek gönderir. Boru yoksa (ENOENT, bekçi çalışmıyor) null döner.
 * Bekçi varken cevap alınamazsa reddetmez, `{ ok: false, hata }` döner: "zaman_asimi",
 * "baglanti_hatasi" (+ kod), "bozuk_cevap" ya da "cevapsiz_kapandi".
 */
export const bekciIstegi = (
  komut: "durum" | "yenile" | "kapan",
  zamanAsimiMs = 3000,
): Promise<Record<string, unknown> | null> =>
  new Promise((coz) => {
    const sure = Number.isFinite(zamanAsimiMs) && zamanAsimiMs > 0 ? zamanAsimiMs : 3000;
    const parcalar: Buffer[] = [];
    let uzunluk = 0;
    let bitti = false;
    const sok = connect(BEKCI_BORUSU);
    const bitir = (sonuc: Record<string, unknown> | null): void => {
      if (bitti) return;
      bitti = true;
      clearTimeout(zamanlayici);
      sok.destroy();
      coz(sonuc);
    };
    const coz_ = (metin: string): void => {
      try {
        const v: unknown = JSON.parse(metin);
        if (typeof v === "object" && v !== null && !Array.isArray(v)) bitir(v as Record<string, unknown>);
        else bitir({ ok: false, hata: "bozuk_cevap" });
      } catch {
        bitir({ ok: false, hata: "bozuk_cevap" });
      }
    };
    const zamanlayici = setTimeout(() => bitir({ ok: false, hata: "zaman_asimi" }), sure);
    sok.on("connect", () => {
      sok.write(`${JSON.stringify({ komut })}\n`);
    });
    sok.on("data", (p: Buffer) => {
      parcalar.push(p);
      uzunluk += p.length;
      const tum = Buffer.concat(parcalar, uzunluk);
      const i = tum.indexOf(0x0a);
      if (i >= 0) coz_(tum.subarray(0, i).toString("utf8"));
      else if (uzunluk > CEVAP_SINIRI) bitir({ ok: false, hata: "bozuk_cevap" });
    });
    sok.on("close", () => {
      if (bitti) return;
      const metin = Buffer.concat(parcalar, uzunluk).toString("utf8").trim();
      if (metin.length > 0) coz_(metin);
      else bitir({ ok: false, hata: "cevapsiz_kapandi" });
    });
    sok.on("error", (e) => {
      const kod = hataKodu(e);
      if (kod === "ENOENT") bitir(null);
      else bitir({ ok: false, hata: "baglanti_hatasi", kod: kod ?? null });
    });
  });

// ---------------------------------------------------------------------------------------------
// Komut satırı (yalnız import.meta.main'den çağrılır)
// ---------------------------------------------------------------------------------------------

const YARDIM = [
  "Kullanım: node --disable-warning=ExperimentalWarning kurulum/kur.ts [seçenek]",
  "  (seçeneksiz)   temiz commit'i test et, kur, güncel yap, servisi yeniden başlat",
  "  --kirli        commit'lenmemiş değişiklik varken de kur (uyarır; sürüm adı <sha>-k<zaman>)",
  "  --testsiz      test kapısını atla",
  "  --geri-al      önceki sürüme dön ve servisi yeniden başlat",
  "  --durum        güncel sürüm, geçmiş ve bekçi durumu (salt okunur)",
  "  --yalniz-test  yalnız test kapısını çalıştır, kurma",
  "  --izin-duzelt  veri kökünü yalnız bu hesaba, SYSTEM'e ve Administrators'a açık olacak biçimde daralt",
  "                 (servis başka hesaplara açık kökle açılmaz; kur ve --geri-al eren-kit kökünü kendiliğinden daraltır)",
  `  ${ESKI_KOK_BAYRAGI}  eski veri kökü doluyken bilerek yeni veri köküne kur (kur ve --geri-al ile)`,
  "Ortam (kalıcı kullanıcı ortamında olmalı): EREN_KIT_DATA_DIR (veri kökü, mutlak yol),",
  "  EREN_KIT_PHONE_TASK_NAME (görev adı, yoksa eren-kit-telefon)",
].join("\n");

const kaynakKoku = (): string => resolve(import.meta.dirname, "..");

/** Kurulum hedefi: `<veri kökü>\uygulama`; ortam geçersizse fırlatır. */
export const hedefKoku = (ortam: Ortam = process.env): string => uygulamaKoku(veriKoku(ortam));

const uygulamaKokuOrtamdan = (): string => hedefKoku(process.env);

/** Etkin görev adı; her çağrıda ortamdan okunur (içe aktarma ortam okumaz). */
const gorev = (): string => gorevAdi(process.env);

const gorevKayitliMi = (ad: string): boolean => {
  const r = spawnSync("schtasks", ["/query", "/tn", ad], { stdio: "ignore", windowsHide: true });
  return r.error === undefined && r.status === 0;
};

/**
 * guncel'i değiştiren kiplerden (kur, --geri-al) önce: eski kurulumla çakışma (iki görev, bölünmüş veri)
 * ve kabuk ortamı ile kalıcı ortam farkı (servis başka veri köküne yazardı). Sorun varsa hiçbir şeye
 * dokunmadan fırlatır; uyarıları yalnız yazar.
 */
const kurulumOnDenetimi = (eskiKokuYoksay: boolean): void => {
  const sorunlar = eskiKurulumSorunlari(process.env, { gorevVar: gorevKayitliMi, varMi: existsSync }, { eskiKokuYoksay });
  const { hatalar, uyarilar } = kaliciOrtamKarsilastir(process.env, kaliciOrtamOku());
  for (const u of uyarilar) console.error(`UYARI: ${u}`);
  const tum = [...sorunlar, ...hatalar];
  if (tum.length > 0) throw new KurHatasi(`kurulum durdu, hiçbir şey değişmedi: ${tum.join(" | ")}`);
};

const git = (kok: string, ...arg: string[]): string => {
  const r = spawnSync("git", ["-C", kok, ...arg], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error !== undefined) throw new KurHatasi(`git çalıştırılamadı: ${r.error.message}`);
  if (r.status !== 0) throw new KurHatasi(`git ${arg.join(" ")} başarısız: ${tekSatir(r.stderr || `çıkış ${r.status}`)}`);
  return r.stdout;
};

/**
 * `kok` ağacındaki commit'lenmemiş değişiklikler (izlenmeyen dosyalar dahil). Kaynak, toplu bir deponun
 * alt klasörü olabilir (ör. `apps/phone`): `-- .` yalnız bu ağaca bakar, depodaki başka paketler sayılmaz.
 */
export const kirliSatirlar = (kok: string): string[] =>
  git(kok, "status", "--porcelain", "--", ".")
    .split(/\r?\n/)
    .filter((s) => s.length > 0);

/**
 * HEAD'deki `kok` ağacının git ağaç kimliği (`HEAD:./`, `-C kok`'a göreli). Yalnız bu ağaca giren commit
 * değiştirir; depoya giren ilgisiz commit değiştirmez. "Test edilen kod kopyalanan kod mu" denetimi bunu karşılaştırır.
 */
export const kaynakKimligi = (kok: string): string => git(kok, "rev-parse", "HEAD:./").trim();

/** git'i çalıştırır; başarısızsa (ör. tanınmayan ad) null döner, fırlatmaz. */
const gitDene = (kok: string, ...arg: string[]): string | null => {
  const r = spawnSync("git", ["-C", kok, ...arg], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  return r.error === undefined && r.status === 0 ? r.stdout.trim() : null;
};

/** Git'te commit olarak aranabilecek sürüm adı (eski biçim: kısa sha). Kirli (`-k`) adlar ve başka şeyler değil. */
const COMMIT_ADI_DESENI = /^[0-9a-f]{7,64}$/;

/**
 * Kurulu `ad` sürümünün kaynak ağacı kimliği: surum.json'daki `agac`; yoksa (eski biçim: kurulum anındaki
 * HEAD'in kısa sha'sı) o commit'teki aynı alt ağaç git'ten. Bilinemiyorsa null.
 */
const kuruluSurumAgaci = (kaynak: string, kok: string, ad: string): string | null => {
  try {
    const v: unknown = JSON.parse(readFileSync(join(surumlerDizini(kok), ad, SURUM_DOSYASI), "utf8"));
    const a = typeof v === "object" && v !== null && "agac" in v ? v.agac : null;
    if (typeof a === "string" && a.length > 0) return a;
  } catch {
    return null; // surum.json yok ya da bozuk: tam sürüm değil
  }
  return COMMIT_ADI_DESENI.test(ad) ? gitDene(kaynak, "rev-parse", "--verify", "-q", `${ad}:./`) : null;
};

/**
 * Temiz kaynağın sürüm adı; kaynak ağacının (`kok`, ör. `apps/phone`) İÇERİĞİNE bağlıdır, depo HEAD'ine değil:
 * toplu depoya giren ilgisiz commit yeni sürüm üretmez.
 * 1. Kurulu bir sürüm aynı içerikteyse onun adı (önce guncel, sonra önceki, sonra en yeniden eskiye).
 *    Eski biçim adlar (kurulumdaki HEAD) da tanınır; `--durum`, `--geri-al` ve guncel onları görmeye devam eder.
 * 2. Yoksa kaynak ağacına dokunan son commit'in kısa sha'sı.
 */
export const temizSurumAdi = (kaynak: string, hedefKok: string, agac: string = kaynakKimligi(kaynak)): string => {
  const kok = resolve(hedefKok);
  const surumler = surumlerDizini(kok);
  if (existsSync(surumler)) {
    const adaylar: string[] = [];
    const ekle = (ad: string | null): void => {
      if (ad !== null && !adaylar.includes(ad)) adaylar.push(ad);
    };
    ekle(guncelSha(kok));
    ekle(oncekiSha(kok));
    const tamlar = readdirSync(surumler, { withFileTypes: true })
      .filter((e) => e.isDirectory() && SHA_DESENI.test(e.name))
      .map((e) => ({ ad: e.name, tarih: surumTarihi(join(surumler, e.name)) }))
      .filter((t): t is { ad: string; tarih: number } => t.tarih !== null)
      .sort((a, b) => b.tarih - a.tarih);
    for (const t of tamlar) ekle(t.ad);
    for (const ad of adaylar) {
      if (/-k/.test(ad)) continue; // kirli kurulum: içeriği commit'le eşleşmez
      if (kuruluSurumAgaci(kaynak, kok, ad) === agac) return ad;
    }
  }
  const ad = git(kaynak, "log", "-1", "--abbrev=10", "--format=%h", "--", ".").trim();
  if (ad.length === 0) throw new KurHatasi(`kaynak ağacına dokunan commit bulunamadı: ${kaynak}`);
  return ad;
};

const mb = (bayt: number): string => `${(bayt / 1_048_576).toFixed(1)} MB`;
const sn = (ms: number): string => `${(ms / 1000).toFixed(1)} sn`;
const tarihMetni = (ms: number): string => new Date(ms).toLocaleString("tr-TR");

// --- test kapısı -------------------------------------------------------------------------------

type Adim = { readonly ad: string; readonly dosya: string; readonly argumanlar: readonly string[]; readonly cwd: string };

const npmCli = (): string => {
  const adaylar = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")];
  for (const a of adaylar) if (a !== undefined && a.endsWith(".js") && existsSync(a)) return a;
  throw new KurHatasi("npm-cli.js bulunamadı (node.exe'nin yanında npm yok)");
};

/** `cwd`'ye göre göreli, `/` ayraçlı, sıralı test dosyaları (node --test glob gibi yorumlar; `\` kaçış olur). */
const testDosyalari = (cwd: string, altDizin: string, haric: ReadonlySet<string>): string[] => {
  const kok = join(cwd, altDizin);
  if (!existsSync(kok)) return [];
  const sonuc: string[] = [];
  const yuru = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const y = join(d, e.name);
      if (e.isDirectory()) yuru(y);
      else if (e.isFile() && e.name.endsWith(".test.ts") && !haric.has(e.name)) sonuc.push(relative(cwd, y).split(sep).join("/"));
    }
  };
  yuru(kok);
  return sonuc.sort();
};

const testAdimlari = (kaynak: string): readonly Adim[] => {
  const node = process.execPath;
  const npm = npmCli();
  const server = join(kaynak, "server");
  // dis-dunya.test.ts canlı servisle aynı tekil boruyu kullanır; servis açıkken çakışır.
  const serverTestleri = testDosyalari(server, "test", new Set(["dis-dunya.test.ts"]));
  if (serverTestleri.length === 0) throw new KurHatasi("server testleri bulunamadı");
  const kurulumTestleri = testDosyalari(kaynak, "kurulum/test", new Set());
  const adimlar: Adim[] = [
    { ad: "server tip denetimi", dosya: node, argumanlar: [npm, "run", "typecheck", "-w", "server"], cwd: kaynak },
    {
      ad: `server testleri (${serverTestleri.length} dosya, dis-dunya hariç)`,
      dosya: node,
      argumanlar: [UYARI_BAYRAGI, "--test", ...serverTestleri],
      cwd: server,
    },
    { ad: "protocol testleri", dosya: node, argumanlar: [npm, "test", "-w", "protocol"], cwd: kaynak },
  ];
  // dis-dunya.test.ts'ten yalnız transkript.sil grubu: tekil boru testi kapı dışında kalır
  // (desen grup adına uyar; uymayan grubun testleri de kancaları da koşmaz, 2026-11-08 ölçüldü).
  if (existsSync(join(server, "test", "dis-dunya.test.ts"))) {
    adimlar.splice(2, 0, {
      ad: "server transkript testleri (dis-dunya.test.ts, yalnız transkript)",
      dosya: node,
      argumanlar: [UYARI_BAYRAGI, "--test", "--test-name-pattern=transkript", "test/dis-dunya.test.ts"],
      cwd: server,
    });
  }
  if (existsSync(join(kaynak, "kurulum", "tsconfig.json"))) {
    const tsc = join(kaynak, "node_modules", "typescript", "bin", "tsc");
    if (!existsSync(tsc)) throw new KurHatasi(`typescript bulunamadı: ${tsc}`);
    adimlar.push({ ad: "kurulum tip denetimi", dosya: node, argumanlar: [tsc, "--noEmit", "-p", "kurulum/tsconfig.json"], cwd: kaynak });
  }
  if (kurulumTestleri.length > 0) {
    adimlar.push({
      ad: `kurulum testleri (${kurulumTestleri.length} dosya)`,
      dosya: node,
      argumanlar: [UYARI_BAYRAGI, "--test", ...kurulumTestleri],
      cwd: kaynak,
    });
  }
  return adimlar;
};

const testKapisi = (kaynak: string): void => {
  for (const a of testAdimlari(kaynak)) {
    console.log(`[test] ${a.ad}`);
    const bas = Date.now();
    const r = spawnSync(a.dosya, [...a.argumanlar], { cwd: a.cwd, stdio: "inherit", windowsHide: true });
    if (r.error !== undefined) throw new KurHatasi(`test kapısı çalıştırılamadı: ${a.ad}: ${r.error.message}`);
    if (r.status !== 0) throw new KurHatasi(`test kapısı düştü: ${a.ad} (çıkış ${r.status ?? r.signal})`);
    console.log(`[test] ${a.ad}: geçti (${sn(Date.now() - bas)})`);
  }
};

// --- duman testi -------------------------------------------------------------------------------

const tsDosyalari = (dizin: string): string[] => {
  const sonuc: string[] = [];
  const yuru = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const y = join(d, e.name);
      if (e.isDirectory()) yuru(y);
      else if (e.isFile() && e.name.endsWith(".ts")) sonuc.push(y);
    }
  };
  yuru(dizin);
  return sonuc.sort();
};

/** Giriş dosyası `if (import.meta.main)` korumalı mı (içe aktarılınca iş başlatmaz). */
const mainKorumali = (yol: string): boolean => /^if \(import\.meta\.main\)/m.test(readFileSync(yol, "utf8"));

/** Dosyaların çalışma zamanında içe aktardığı dış paketler (korumasız giriş dosyaları için). */
const girisPaketleri = (dosyalar: readonly string[]): string[] => {
  const desen = /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  const sonuc = new Set<string>();
  for (const yol of dosyalar) {
    for (const m of readFileSync(yol, "utf8").matchAll(desen)) {
      const s = m[1];
      if (s !== undefined && !s.startsWith(".") && !s.startsWith("/") && !s.startsWith("node:")) sonuc.add(s);
    }
  }
  return [...sonuc].sort();
};

/**
 * Yeni sürüm dizininden, ayrı bir node sürecinde: server/src'deki tüm modülleri (giriş dosyaları
 * `import.meta.main` korumalıysa onlar da) içe aktarır; korumasız giriş dosyalarının yalnız dış
 * paketlerini yükler; `@eren/protocol`'ün sürümün kendi protocol'üne çözüldüğünü denetler.
 * Düşerse hata fırlatır.
 */
const dumanTesti = (surumYolu: string): number => {
  const src = join(surumYolu, "server", "src");
  const tum = tsDosyalari(src);
  const disarida = tum.filter((y) => dirname(y) === src && GIRIS_DOSYALARI.has(basename(y)) && !mainKorumali(y));
  if (disarida.length > 0) {
    console.log(`Duman testinde yalnız paketleri yüklenen (import.meta.main koruması yok): ${disarida.map((y) => basename(y)).join(", ")}`);
  }
  const moduller = tum.filter((y) => !disarida.includes(y));
  const hedefler = [...moduller.map((m) => pathToFileURL(m).href), ...girisPaketleri(disarida)];
  const surumUrl = pathToFileURL(surumYolu + sep).href.toLowerCase();
  const betik = [
    `const hedefler = ${JSON.stringify(hedefler)};`,
    "let k = 0;",
    "const ilk = (e) => String((e && e.message) || e).split('\\n')[0];",
    "for (const u of hedefler) { try { await import(u); } catch (e) { k++; console.error('duman: ' + u + ': ' + ilk(e)); } }",
    "try {",
    "  const p = import.meta.resolve('@eren/protocol');",
    `  if (!p.toLowerCase().startsWith(${JSON.stringify(surumUrl)})) { k++; console.error('duman: @eren/protocol sürüm dışına çözüldü: ' + p); }`,
    "} catch (e) { k++; console.error('duman: @eren/protocol çözülemedi: ' + ilk(e)); }",
    "process.exit(k === 0 ? 0 : 1);",
  ].join("\n");
  const r = spawnSync(process.execPath, [UYARI_BAYRAGI, "--input-type=module", "-e", betik], {
    cwd: join(surumYolu, "server"),
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
    timeout: 120_000,
  });
  if (r.error !== undefined) throw new KurHatasi(`duman testi çalıştırılamadı: ${r.error.message}`);
  if (r.status !== 0) throw new KurHatasi(`duman testi düştü (${hedefler.length} hedef); güncel değişmedi`);
  return hedefler.length;
};

// --- servis yeniden başlatma -------------------------------------------------------------------

type GorevDurumu = { readonly tur: "yok" | "kapali" | "hazir" | "calisiyor" | "bilinmiyor"; readonly ham: string };

/**
 * `schtasks /query /tn <görev> /fo csv /nh` → 3. sütun. İngilizce: Ready/Running/Disabled; Türkçe MUI'de
 * "Devre dışı" (çıktı OEM kod sayfasında, yalnız ASCII "devre" kısmına güvenilir).
 */
const gorevDurumu = (): GorevDurumu => {
  const r = spawnSync("schtasks", ["/query", "/tn", gorev(), "/fo", "csv", "/nh"], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.error !== undefined || r.status !== 0) return { tur: "yok", ham: "" };
  return gorevDurumuCoz(r.stdout);
};

/** Saf: CSV'nin ilk satırındaki 3. tırnaklı alan (tarih alanında virgül olabilir). */
const gorevDurumuCoz = (cikti: string): GorevDurumu => {
  const satir = cikti.split(/\r?\n/).find((s) => s.trim().length > 0) ?? "";
  const alanlar = [...satir.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
  const ham = (alanlar[2] ?? "").trim();
  const k = ham.toLowerCase();
  const tur =
    k.includes("disabled") || k.includes("devre")
      ? "kapali"
      : k.includes("running") || k.includes("yor") // "Çalışıyor"
        ? "calisiyor"
        : k.includes("ready") || k.includes("haz")
          ? "hazir"
          : "bilinmiyor";
  return { tur, ham };
};

/** Görev kapalıysa (Disabled) `/run` tutmaz: guncel değişmeden ÖNCE dur. */
const gorevKapaliDenetle = (): void => {
  if (gorevDurumu().tur === "kapali") throw new KurHatasi(`'${gorev()}' görevi kapalı (Disabled); önce \`eren baslat\``);
};

/** `schtasks /run`; başarıda null, değilse kısa sebep (fırlatmaz: gorevuBaslat yineler). */
const gorevCalistir = (): string | null => {
  const r = spawnSync("schtasks", ["/run", "/tn", gorev()], { stdio: "ignore", windowsHide: true });
  if (r.error !== undefined) return `schtasks çalıştırılamadı: ${r.error.message}`;
  if (r.status !== 0) return `schtasks /run /tn ${gorev()} çıkış ${r.status}`;
  return null;
};

const gorevKaydetSatiri = (kaynak: string): string =>
  `Görev Zamanlayıcı'da '${gorev()}' görevi yok; kaydetmek için: node ${UYARI_BAYRAGI} "${join(kaynak, "kurulum", "gorev-kaydet.ts")}"`;

/** Bekçi borusu kaybolana VE bekçi süreci gerçekten bitene kadar bekler (boru süreçten önce kapanır). */
const bekciBitsin = async (pid: number | null, sinirMs: number): Promise<boolean> => {
  const son = Date.now() + sinirMs;
  while (Date.now() < son) {
    if (!boruVar(BEKCI_BORU_ADI) && (pid === null || !surecYasiyor(pid))) return true;
    await bekle(250);
  }
  return false;
};

const boruGelsin = async (ad: string, sinirMs: number): Promise<boolean> => {
  const son = Date.now() + sinirMs;
  while (Date.now() < son) {
    if (boruVar(ad)) return true;
    await bekle(250);
  }
  return false;
};

/**
 * `schtasks /run`; görev örneği (conhost) henüz bitmemişse IgnoreNew yeni çalıştırmayı sessizce yok
 * sayabilir ya da sıfır dışı dönebilir: her iki durumda bekçi borusu BORU_GELME_MS içinde gelmezse en çok
 * RUN_YINELEME kez yineler.
 */
const gorevuBaslat = async (): Promise<void> => {
  let sonHata: string | null = null;
  for (let deneme = 0; deneme <= RUN_YINELEME; deneme++) {
    if (deneme > 0) {
      console.error(`UYARI: bekçi borusu ${BORU_GELME_MS / 1000} sn içinde gelmedi; schtasks /run yineleniyor (${deneme}/${RUN_YINELEME})`);
    }
    const h = gorevCalistir();
    if (h !== null) {
      sonHata = h;
      console.error(`UYARI: ${h}`);
    }
    if (await boruGelsin(BEKCI_BORU_ADI, BORU_GELME_MS)) return;
  }
  throw new KurHatasi(`görev ${RUN_YINELEME + 1} kez çalıştırıldı, bekçi borusu gelmedi${sonHata === null ? "" : ` (son: ${sonHata})`}`);
};

/** Bekçi yokken tekil kilit borusu açıksa elle başlatılmış bir servis var: yeni ana'lar ikinci örnek olur. */
const bekcisizServisDenetle = async (): Promise<void> => {
  if ((await bekciIstegi("durum")) !== null) return;
  if (boruVar(TEKIL_BORU_ADI)) throw new KurHatasi(BEKCISIZ_MESAJ);
};

export const durumOzeti = (d: Record<string, unknown> | null): string => {
  if (d === null) return "bekçi yok";
  if (d.ok !== true) return `bekçi cevap vermedi: ${String(d.hata)}`;
  return [
    `durum ${String(d.durum)}`,
    `sürüm ${String(d.surum)}`,
    `ana pid ${String(d.ana_pid)}`,
    `son çıkış kodu ${String(d.son_cikis_kodu)}`,
    `yeniden başlatma ${String(d.yeniden_baslatma)}`,
  ].join(", ");
};

/** Başarı: yeni sürümde (`sha` null ise herhangi), tetikten sonra başlamış bir ana en az KARARLI_MS ayakta. */
const kararliMi = (d: Record<string, unknown>, sha: string | null, tetik: number, bekciYeni: boolean, simdi: number): boolean => {
  const anaBas = d.ana_baslangic_ms;
  const bekciBas = d.bekci_baslangic_ms;
  return (
    d.ok === true &&
    d.durum === "calisiyor" &&
    typeof d.ana_pid === "number" &&
    (sha === null || d.surum === sha) &&
    typeof anaBas === "number" &&
    anaBas >= tetik &&
    simdi - anaBas >= KARARLI_MS &&
    (!bekciYeni || (typeof bekciBas === "number" && bekciBas >= tetik))
  );
};

/** Servis beklenenden başka bir veri kökünde çalışıyor: geri alma akışı bunu ayrı ele alır. */
class VeriKokuHatasi extends KurHatasi {
  override name = "VeriKokuHatasi";
}

/** Servis günlüğünde aranacak son bölüm: başlangıç kaydı birkaç saniye önce yazıldı. */
const GUNLUK_OKUMA_BAYT = 1_048_576;

const dosyaSonu = (yol: string, bayt: number): string | null => {
  let fd: number;
  try {
    fd = openSync(yol, "r");
  } catch {
    return null;
  }
  try {
    const boyut = fstatSync(fd).size;
    const bas = Math.max(0, boyut - bayt);
    const tampon = Buffer.alloc(boyut - bas);
    readSync(fd, tampon, 0, tampon.length, bas);
    return tampon.toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
};

/**
 * `<logDizini>\servis.log` (dönmüşse `servis.1.log`) içinde bu pid'li ana'nın `enErkenMs`'ten sonraki
 * başlangıç kaydı (`modul:"ana", olay:"basladi"`) var mı. Ana bu kaydı kendi veri kökünün günlüğüne yazar:
 * beklenen kökte bulunması, ana'nın o kökte çalıştığının kanıtıdır.
 */
export const anaBasladiGunlukte = (logDizini: string, pid: number, enErkenMs: number): boolean => {
  for (const ad of ["servis.log", "servis.1.log"]) {
    const metin = dosyaSonu(join(logDizini, ad), GUNLUK_OKUMA_BAYT);
    if (metin === null) continue;
    for (const satir of metin.split("\n")) {
      if (!satir.includes('"basladi"')) continue;
      try {
        const j = JSON.parse(satir) as Record<string, unknown>;
        if (j.modul === "ana" && j.olay === "basladi" && j.pid === pid && typeof j.ts_ms === "number" && j.ts_ms >= enErkenMs) {
          return true;
        }
      } catch {
        // yarım ya da bozuk satır
      }
    }
  }
  return false;
};

export type DogrulamaKarari =
  | { readonly tur: "tamam"; readonly kanit: string }
  | { readonly tur: "bekle"; readonly sebep: string | null }
  | { readonly tur: "uyusmuyor"; readonly servisKoku: string };

/**
 * Cevap veren bekçi bu dağıtımın bekçisi mi: yeniden başlatıldıysa tetikten sonra başlamış olmalı (eski bekçi
 * kapanırken hâlâ cevap verebilir); görevsiz yenilemede bekçi aynıdır, kökü yeni ana'nın da köküdür.
 */
const bekciBuDagitimdan = (d: Record<string, unknown>, tetik: number, bekciYeni: boolean): boolean =>
  !bekciYeni || (typeof d.bekci_baslangic_ms === "number" && d.bekci_baslangic_ms >= tetik);

/**
 * Yeni sürüm kararlı mı VE beklenen veri kökünde mi. Kök iki yoldan doğrulanır:
 * 1. Bekçi durum cevabında `veri_koku` bildiriyorsa (bu sürümden itibaren) o. Farklıysa kararlılık
 *    BEKLENMEDEN hemen `uyusmuyor`: yanlış kökte açılan ana orada eren.db ve sunucu-anahtar.pem oluşturur,
 *    hiç kararlı olamazsa da uyuşmazlık başka türlü bildirilmez. Ana, bekçinin ortamını değiştirmeden
 *    devralır: kökü bekçininkiyle aynıdır.
 * 2. Bildirmiyorsa (eski bekçi: geri alınan sürüm ya da görevsiz yenileme) beklenen kökün servis günlüğünde
 *    bu ana'nın başlangıç kaydı aranır; yoksa `bekle` (zaman aşımında doğrulanamadı hatası).
 * Kök uyuşmazlığı dışında, kararlı değilse `bekle`. `sha` null: herhangi bir sürüm (`eren baslat`).
 */
export const servisDogrula = (
  d: Record<string, unknown>,
  o: {
    readonly sha: string | null;
    readonly tetik: number;
    readonly bekciYeni: boolean;
    readonly beklenenKok: string;
    readonly anaBasladi?: (logDizini: string, pid: number, enErkenMs: number) => boolean;
    /** Saat (testlerde sahte); verilmezse Date.now. */
    readonly simdi?: () => number;
  },
): DogrulamaKarari => {
  const bildirilen = d.ok === true ? d.veri_koku : undefined;
  if (typeof bildirilen === "string" && bekciBuDagitimdan(d, o.tetik, o.bekciYeni) && !ayniYol(bildirilen, o.beklenenKok)) {
    return { tur: "uyusmuyor", servisKoku: bildirilen };
  }
  if (!kararliMi(d, o.sha, o.tetik, o.bekciYeni, (o.simdi ?? Date.now)())) return { tur: "bekle", sebep: null };
  if (typeof bildirilen === "string") return { tur: "tamam", kanit: "bekçinin bildirdiği kök" };
  const pid = d.ana_pid as number; // kararliMi sayı olduğunu denetledi
  const anaBas = typeof d.ana_baslangic_ms === "number" ? d.ana_baslangic_ms : o.tetik;
  const logDizini = join(o.beklenenKok, "logs");
  const ara = o.anaBasladi ?? anaBasladiGunlukte;
  // 1 sn pay: ana kaydı bekçinin başlatma anından hemen sonra yazar, saat aynı.
  if (ara(logDizini, pid, Math.min(anaBas, o.tetik) - 1000)) return { tur: "tamam", kanit: "beklenen kökteki servis günlüğü" };
  return {
    tur: "bekle",
    sebep: `bekçi veri kökünü bildirmiyor ve ${join(logDizini, "servis.log")} içinde ana pid ${pid} için başlangıç kaydı yok`,
  };
};

export const veriKokuMesaji = (beklenen: string, servis: string): string =>
  `servis beklenen veri kökünde çalışmıyor: beklenen ${beklenen}, servisin kullandığı ${servis}. ` +
  "Görev Zamanlayıcı'nın başlattığı servis kalıcı ortamı görür; değişken yeni yazıldıysa Görev Zamanlayıcı onu henüz " +
  "görmüyor olabilir (oturumu kapatıp açın)";

/** `servisiDogrulaBekle`'nin dış dünyası: kur.ts'te gerçek boru ve saat, `eren baslat` testlerinde sahte. */
export type DogrulamaBagi = {
  readonly durum: () => Promise<Record<string, unknown> | null>;
  readonly uyu: (ms: number) => Promise<void>;
  readonly simdi: () => number;
  readonly anaBasladi?: (logDizini: string, pid: number, enErkenMs: number) => boolean;
};

export type BeklemeSonucu =
  | { readonly tur: "tamam"; readonly kanit: string; readonly d: Record<string, unknown> }
  | { readonly tur: "uyusmuyor"; readonly servisKoku: string }
  | { readonly tur: "zaman_asimi"; readonly kokSebebi: string | null; readonly d: Record<string, unknown> | null };

/**
 * Bekçiye saniyede bir `durum` sorup `servisDogrula` kararını bekler (`kur` ve `eren baslat` ortak).
 * Kök uyuşmazlığı ilk cevapta döner; kararlı ve kökü kanıtlı olunca `tamam`; sınırda `zaman_asimi`.
 */
export const servisiDogrulaBekle = async (
  o: { readonly sha: string | null; readonly tetik: number; readonly bekciYeni: boolean; readonly beklenenKok: string },
  bag: DogrulamaBagi,
  sinirMs: number = BASLAMA_BEKLEME_MS,
): Promise<BeklemeSonucu> => {
  const son = bag.simdi() + sinirMs;
  let d: Record<string, unknown> | null = null;
  let kokSebebi: string | null = null;
  while (bag.simdi() < son) {
    d = await bag.durum();
    if (d !== null) {
      const k = servisDogrula(d, { ...o, simdi: bag.simdi, ...(bag.anaBasladi === undefined ? {} : { anaBasladi: bag.anaBasladi }) });
      if (k.tur === "tamam") return { tur: "tamam", kanit: k.kanit, d };
      if (k.tur === "uyusmuyor") return k;
      kokSebebi = k.sebep;
    }
    await bag.uyu(1000);
  }
  return { tur: "zaman_asimi", kokSebebi, d };
};

const yeniSurumuBekle = async (sha: string, tetik: number, bekciYeni: boolean, beklenenKok: string): Promise<void> => {
  const r = await servisiDogrulaBekle(
    { sha, tetik, bekciYeni, beklenenKok },
    { durum: () => bekciIstegi("durum", 2000), uyu: bekle, simdi: Date.now },
  );
  if (r.tur === "tamam") {
    console.log(`Servis ${sha} sürümünde, ${beklenenKok} veri kökünde çalışıyor (ana pid ${String(r.d.ana_pid)}; kanıt: ${r.kanit}).`);
    return;
  }
  if (r.tur === "uyusmuyor") throw new VeriKokuHatasi(veriKokuMesaji(beklenenKok, r.servisKoku));
  if (r.kokSebebi !== null) {
    throw new KurHatasi(`servis ${sha} sürümünde çalışıyor ama ${beklenenKok} veri kökünde çalıştığı doğrulanamadı: ${r.kokSebebi}`);
  }
  throw new KurHatasi(`servis ${BASLAMA_BEKLEME_MS / 1000} sn içinde ${sha} sürümünde kararlı çalışmadı (${durumOzeti(r.d)})`);
};

/**
 * Yanlış veri kökünde çalışan servisi durdurur: görev kayıtlıysa önce kapatılır (yoksa 5 dk içinde aynı
 * yanlış kökle geri gelir), sonra bekçiye kapan. Fırlatmaz; ne yapıldığını tek satırda döner.
 */
const yanlisKoktekiServisiDurdur = async (): Promise<string> => {
  const parcalar: string[] = [];
  try {
    if (gorevDurumu().tur !== "yok") {
      const r = spawnSync("schtasks", ["/change", "/tn", gorev(), "/disable"], { stdio: "ignore", windowsHide: true });
      parcalar.push(
        r.error === undefined && r.status === 0
          ? `'${gorev()}' görevi kapatıldı (eren baslat ile açılır)`
          : `'${gorev()}' görevi kapatılamadı: servis 5 dk içinde aynı köke yeniden başlayabilir`,
      );
    }
    const ilk = await bekciIstegi("durum");
    const pid = ilk !== null && typeof ilk.bekci_pid === "number" ? ilk.bekci_pid : null;
    const c = await bekciIstegi("kapan");
    if (c === null) parcalar.push("bekçi zaten çalışmıyor");
    else if (c.ok !== true) parcalar.push(`bekçi kapan isteğini kabul etmedi (${String(c.hata)})`);
    else parcalar.push((await bekciBitsin(pid, KAPANMA_BEKLEME_MS)) ? "servis durduruldu" : "bekçi 60 sn içinde kapanmadı");
  } catch (e) {
    parcalar.push(`servis durdurulamadı: ${tekSatir(e)}`);
  }
  return parcalar.join(", ");
};

/**
 * Hangi adımda düştüğü: "kapanma" = eski bekçi kapanmadı (eski servis büyük olasılıkla hâlâ çalışıyor),
 * "baslatma" = bekçi/ana başlatılamadı, "dogrulama" = yeni sürüm kararlı ayağa kalkmadı.
 */
type YenilemeSonucu =
  | { readonly tamam: true }
  | { readonly tamam: false; readonly asama: "kapanma" | "baslatma" | "dogrulama" | "veri_koku"; readonly sebep: string };

/**
 * Sözleşme adım 7-8. Görev kayıtlı değilse ve bekçi yoksa yalnız kayıt satırını yazar. Fırlatmaz.
 * Doğrulama sürümle birlikte veri kökünü de kapsar ("veri_koku" = servis başka kökte çalışıyor).
 */
const servisiYenile = async (kaynak: string, sha: string): Promise<YenilemeSonucu> => {
  let asama: "kapanma" | "baslatma" | "dogrulama" = "kapanma";
  try {
    const beklenenKok = veriKoku(process.env);
    const gorevKayitli = gorevDurumu().tur !== "yok";
    const ilk = await bekciIstegi("durum");
    const tetik = Date.now();
    let bekciYeni = false;
    if (ilk !== null) {
      if (gorevKayitli) {
        console.log("Bekçiye kapan gönderiliyor…");
        const c = await bekciIstegi("kapan");
        if (c !== null && c.ok !== true) throw new KurHatasi(`bekçi kapan isteğini kabul etmedi: ${String(c.hata)}`);
        const pid = typeof ilk.bekci_pid === "number" ? ilk.bekci_pid : null;
        if (!(await bekciBitsin(pid, KAPANMA_BEKLEME_MS))) {
          throw new KurHatasi(`bekçi (pid ${String(pid)}) ${KAPANMA_BEKLEME_MS / 1000} sn içinde kapanmadı`);
        }
        await bekle(1000); // görev örneği (conhost) de bitsin; yetmezse gorevuBaslat yineler
        asama = "baslatma";
        await gorevuBaslat();
        bekciYeni = true;
      } else {
        // Görev yokken bekçiyi kapatmak servisi geri dönüşsüz durdurur: yalnız ana'yı yenile.
        console.error(`UYARI: '${gorev()}' görevi kayıtlı değil; bekçiye yalnız yenile gönderiliyor (bekçinin kendisi eski sürümde kalır).`);
        console.error(gorevKaydetSatiri(kaynak));
        asama = "baslatma";
        const c = await bekciIstegi("yenile");
        if (c === null) throw new KurHatasi("bekçi yenile sırasında kayboldu");
        if (c.ok !== true) throw new KurHatasi(`bekçi yenile isteğini kabul etmedi: ${String(c.hata)}`);
      }
    } else if (gorevKayitli) {
      asama = "baslatma";
      await gorevuBaslat();
      bekciYeni = true;
    } else {
      console.log(gorevKaydetSatiri(kaynak));
      return { tamam: true };
    }
    asama = "dogrulama";
    console.log(`${sha} sürümünün ayağa kalkması bekleniyor…`);
    await yeniSurumuBekle(sha, tetik, bekciYeni, beklenenKok);
    return { tamam: true };
  } catch (e) {
    return { tamam: false, asama: e instanceof VeriKokuHatasi ? "veri_koku" : asama, sebep: tekSatir(e) };
  }
};

/**
 * Servis yanlış kökte: önceki sürüm de aynı ortamla aynı yanlış köke açılırdı, yeniden başlatmak çözmez.
 * Önce servis durdurulur ve görev kapatılır, sonra guncel geri alınır (varsa); geri alma düşerse bu da
 * mesaja girer, servis yine durmuş olur. Yanlış kökte oluşan dosyalara dokunulmaz.
 */
export type KokHatasiBag = {
  /** Servisi durdurur, görevi kapatır; fırlatmaz, ne yapıldığını tek satırda döner. */
  readonly durdur: () => Promise<string>;
  readonly geriAl: (hedefKok: string, dusen: string, onceki: string) => void;
};

const gercekKokHatasiBag: KokHatasiBag = { durdur: () => yanlisKoktekiServisiDurdur(), geriAl: otomatikGeriAl };

export const veriKokuHatasindanCik = async (
  hedef: string,
  sha: string,
  onceki: string | null,
  sebep: string,
  bag: KokHatasiBag = gercekKokHatasiBag,
): Promise<never> => {
  // Önce durdur: geri alma düşse bile servis yanlış kökte çalışmayı sürdürmesin, görev kapansın.
  let durdurma: string;
  try {
    durdurma = await bag.durdur();
  } catch (e) {
    durdurma = `servis durdurulamadı: ${tekSatir(e)}`; // durdur fırlatmaz; yine de mesaj kaybolmasın
  }
  let guncelNotu: string;
  if (onceki !== null && onceki !== sha) {
    try {
      bag.geriAl(hedef, sha, onceki);
      console.error(`otomatik geri alındı: ${sha} → ${onceki}`);
      sohbetUyarisi(hedef, onceki, sha);
      guncelNotu = `otomatik geri alındı: ${sha} → ${onceki}`;
    } catch (e) {
      let simdiki: string | null = null;
      try {
        simdiki = guncelSha(hedef);
      } catch {
        // guncel okunamadı
      }
      guncelNotu =
        `${sha} → ${onceki} otomatik geri alma da başarısız oldu (${tekSatir(e)}); guncel ${simdiki ?? "okunamadı"}, ` +
        "elle bakılmalı (`kur.ts --durum`, gerekirse `kur.ts --geri-al`)";
    }
  } else {
    guncelNotu = `guncel ${sha} olarak kaldı (geri alınacak önceki sürüm yok)`;
  }
  throw new KurHatasi(
    `${sebep}; servis yanlış köke yazmasın diye durduruldu, yeniden başlatılmadı: ${durdurma}; ${guncelNotu}. ` +
      "Yanlış kökte oluşmuş olabilecek eren.db ve sunucu-anahtar.pem'e dokunulmadı. " +
      "Ortamı düzeltip (oturumu kapatıp açın) `eren baslat` ile başlatın, `eren durum` ile veri kökünü denetleyin, sonra kurulumu yineleyin",
  );
};

/**
 * Adım 6-8: guncel'i `sha`'ya çevirir ve servisi yeniden başlatır. Düşerse ve önceki sürüm varsa
 * guncel kendiliğinden ona döner ve (eski bekçi kapanmamışsa hariç) bir kez daha yeniden başlatılır;
 * geri alınan sürüm de ayakta kalmazsa durumu söyleyip durur (döngü yok). Başarısızlıkta hep fırlatır.
 */
const etkinlestir = async (kaynak: string, hedef: string, sha: string): Promise<void> => {
  // guncel değişmeden ÖNCE
  gorevKapaliDenetle();
  await bekcisizServisDenetle();
  const onceki = guncelSha(hedef);
  guncelYap(hedef, sha);
  console.log(`guncel: ${onceki ?? "yok"} → ${sha}`);
  const s = await servisiYenile(kaynak, sha);
  if (s.tamam) return;
  if (s.asama === "veri_koku") await veriKokuHatasindanCik(hedef, sha, onceki, s.sebep);
  if (onceki === null) {
    throw new KurHatasi(`${s.sebep}; önceki sürüm yok, otomatik geri alma yapılamadı (guncel ${sha})`);
  }
  if (onceki === sha) {
    throw new KurHatasi(`${s.sebep}; yeniden dağıtılan ${sha} zaten günceldi, otomatik geri alma yapılmadı (guncel ${sha})`);
  }
  otomatikGeriAl(hedef, sha, onceki);
  console.error(`otomatik geri alındı: ${sha} → ${onceki}`);
  sohbetUyarisi(hedef, onceki, sha);
  if (s.asama === "kapanma") {
    throw new KurHatasi(`${s.sebep}; otomatik geri alındı: ${sha} → ${onceki} (eski bekçi kapanmadığı için yeniden başlatılmadı)`);
  }
  const g = await servisiYenile(kaynak, onceki);
  if (!g.tamam) {
    if (g.asama === "veri_koku") {
      const durdurma = await yanlisKoktekiServisiDurdur();
      throw new KurHatasi(
        `${s.sebep}; otomatik geri alındı: ${sha} → ${onceki}, ama ${g.sebep}; servis yeniden başlatılmadı: ${durdurma}. ` +
          "Ortamı düzeltip (oturumu kapatıp açın) `eren baslat` ile başlatın",
      );
    }
    throw new KurHatasi(
      `${s.sebep}; otomatik geri alındı: ${sha} → ${onceki}, ama ${onceki} de ayakta kalmadı: ${g.sebep}; servis kapalı olabilir, elle bakılmalı`,
    );
  }
  throw new KurHatasi(`${s.sebep}; otomatik geri alındı: ${sha} → ${onceki}, servis ${onceki} sürümünde çalışıyor`);
};

// --- kipler ------------------------------------------------------------------------------------

const kur = async (o: { kirli: boolean; testsiz: boolean; eskiKokuYoksay: boolean }): Promise<number> => {
  const kaynak = kaynakKoku();
  const hedef = uygulamaKokuOrtamdan();
  kurulumOnDenetimi(o.eskiKokuYoksay);

  // (1) temiz ağaç (yalnız kaynak ağacı; toplu depodaki başka paketler sayılmaz)
  const kirli = kirliSatirlar(kaynak);
  const kimlik = kaynakKimligi(kaynak);
  if (kirli.length > 0 && !o.kirli) {
    throw new KurHatasi(`çalışma ağacı temiz değil (${kirli.length} değişiklik); commit'leyin ya da --kirli ile geçin`);
  }
  // (2) sürüm adı/dal. Ad kaynak ağacının içeriğine bağlı (temizSurumAdi): depoya giren ilgisiz commit yeni sürüm
  // üretmez. Kirli kurulum ayrı adla gider: aynı adın temiz kopyasını gölgelemesin, yeniden kullanılmasın.
  const kisa = temizSurumAdi(kaynak, hedef, kimlik);
  const dal = git(kaynak, "rev-parse", "--abbrev-ref", "HEAD").trim();
  const sha = kirli.length > 0 ? `${kisa}-k${Date.now().toString(36)}` : kisa;
  if (kirli.length > 0) console.error(`UYARI: ${kirli.length} commit'lenmemiş değişiklikle kuruluyor; sürüm adı ${sha}`);
  console.log(`Kaynak ${kaynak} (dal ${dal}, sürüm ${sha}) → ${hedef}`);
  // erken düş; etkinlestir guncel'den hemen önce yeniden bakar
  gorevKapaliDenetle();
  await bekcisizServisDenetle();

  // (3) test kapısı
  if (o.testsiz) console.log("Test kapısı atlandı (--testsiz).");
  else testKapisi(kaynak);

  // (4) kopya. Önce kökün izni: kod ve sırlar başka hesaba açık köke yazılmaz; kök yoksa yalnız bu hesaba
  // açık oluşur, eren-kit'in kökü başka hesaplara açıksa daraltılır (izin.ts). Yeni servis aynı kuralla
  // açılmayı reddeder; daraltma kopyadan önce olmazsa güncelleme var olan kurulumu düşürürdü.
  veriKokuIzniniSagla(veriKoku(process.env));
  const bas = Date.now();
  const s = surumKur({ kaynakKok: kaynak, hedefKok: hedef, bilgi: { sha, dal, tarih_ms: Date.now(), ...(kirli.length === 0 ? { agac: kimlik } : {}) } });
  if (s.yeni) console.log(`Kopyalandı: ${s.yol} (${s.dosya} dosya, ${mb(s.bayt)}, ${sn(Date.now() - bas)})`);
  else console.log(`Sürüm zaten kurulu, yeniden kullanılıyor: ${s.yol}`);

  // Testten/kopyadan sonra kaynak ağacı değiştiyse kopya test edilen kod değildir. Depoya giren ilgisiz
  // commit HEAD'i değiştirir ama kaynak ağacını değiştirmez: sürüm adı ve içerik aynı kalır.
  if (kirli.length === 0) {
    if (kaynakKimligi(kaynak) !== kimlik || kirliSatirlar(kaynak).length > 0) {
      if (s.yeni) agacSil(s.yol);
      throw new KurHatasi("kurulum sırasında çalışma ağacı değişti; kopya silindi, yeniden deneyin");
    }
  }

  // (5) duman testi
  const n = dumanTesti(s.yol);
  console.log(`Duman testi geçti (${n} hedef).`);

  // (6-8) guncel, yeniden başlatma, doğrulama; düşerse otomatik geri alma (fırlatır, 9 atlanır)
  await etkinlestir(kaynak, hedef, sha);

  // (9) temizlik
  const silinen = eskileriTemizle(hedef, TUTULAN_SURUM);
  if (silinen.length > 0) console.log(`Silinen eski sürümler: ${silinen.join(", ")}`);
  return 0;
};

const geriAl = async (eskiKokuYoksay: boolean): Promise<number> => {
  const hedef = uygulamaKokuOrtamdan();
  kurulumOnDenetimi(eskiKokuYoksay);
  const g = guncelSha(hedef);
  const o = oncekiSha(hedef);
  if (o === null) throw new KurHatasi("geri alınacak önceki sürüm yok");
  gorevKapaliDenetle();
  await bekcisizServisDenetle();
  veriKokuIzniniSagla(veriKoku(process.env));
  guncelYap(hedef, o);
  console.log(`guncel: ${g ?? "yok"} → ${o}`);
  if (g !== null) sohbetUyarisi(hedef, o, g);
  const s = await servisiYenile(kaynakKoku(), o);
  if (!s.tamam && s.asama === "veri_koku") {
    const durdurma = await yanlisKoktekiServisiDurdur();
    throw new KurHatasi(
      `${s.sebep} (guncel ${o}); servis yanlış köke yazmasın diye durduruldu: ${durdurma}. ` +
        "Ortamı düzeltip (oturumu kapatıp açın) `eren baslat` ile başlatın",
    );
  }
  if (!s.tamam) throw new KurHatasi(`${s.sebep} (guncel ${o}; elle geri almada otomatik geri dönüş yapılmaz)`);
  return 0;
};

const surumSatiri = (kok: string, sha: string): string => {
  const yol = join(surumlerDizini(kok), sha);
  try {
    const v = JSON.parse(readFileSync(join(yol, SURUM_DOSYASI), "utf8")) as { dal?: unknown; tarih_ms?: unknown };
    const t = typeof v.tarih_ms === "number" ? tarihMetni(v.tarih_ms) : "?";
    return `${sha} (dal ${String(v.dal)}, kopya ${t})`;
  } catch {
    return `${sha} (${SURUM_DOSYASI} okunamadı)`;
  }
};

const durumKomutu = async (): Promise<number> => {
  const kok = uygulamaKokuOrtamdan();
  console.log(`Veri kökü: ${veriKoku(process.env)}`);
  console.log(`Uygulama kökü: ${kok}${existsSync(kok) ? "" : " (henüz yok)"}`);
  for (const s of eskiKurulumSorunlari(process.env, { gorevVar: gorevKayitliMi, varMi: existsSync })) {
    console.log(`UYARI: ${s}`);
  }
  const g = guncelSha(kok);
  console.log(`Güncel sürüm: ${g === null ? "yok" : surumSatiri(kok, g)}`);
  const o = oncekiSha(kok);
  console.log(`Önceki sürüm: ${o ?? "yok"}`);
  const surumler = surumlerDizini(kok);
  const kurulu = existsSync(surumler)
    ? readdirSync(surumler, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];
  console.log(`Kurulu sürümler (${kurulu.length}): ${kurulu.length === 0 ? "-" : kurulu.join(", ")}`);
  const gecmis = gecmisOku(kok);
  console.log(`Geçmiş (${gecmis.length} kayıt${gecmis.length > 10 ? ", son 10" : ""}):`);
  for (const k of gecmis.slice(-10)) console.log(`  ${tarihMetni(k.tarih_ms)}  ${k.sha}`);
  const gd = gorevDurumu();
  console.log(`Görev '${gorev()}': ${gd.tur === "yok" ? "kayıtlı değil" : `kayıtlı, ${gd.ham || "durum bilinmiyor"}`}`);
  if (gd.tur === "kapali") console.log("UYARI: görev kapalı (Disabled); kur.ts bu durumda guncel'i değiştirmeden durur, önce `eren baslat`");
  const d = await bekciIstegi("durum");
  const tekil = boruVar(TEKIL_BORU_ADI);
  console.log(`Servis tekil kilidi (${TEKIL_BORU_ADI}): ${tekil ? "açık" : "kapalı"}`);
  if (d === null) {
    console.log("Bekçi: çalışmıyor (kontrol borusu yok)");
    if (tekil) console.log("UYARI: bekçisiz çalışan bir servis var; kur.ts bu durumda guncel'i değiştirmeden durur");
  } else if (d.ok !== true) {
    console.log(`Bekçi: cevap alınamadı (${String(d.hata)})`);
  } else {
    const bas = typeof d.bekci_baslangic_ms === "number" ? tarihMetni(d.bekci_baslangic_ms) : "?";
    console.log(`Bekçi: pid ${String(d.bekci_pid)}, başlangıç ${bas}, durum ${String(d.durum)}`);
    const anaBas = typeof d.ana_baslangic_ms === "number" ? tarihMetni(d.ana_baslangic_ms) : "?";
    console.log(d.ana_pid === null ? "Ana: çalışmıyor" : `Ana: pid ${String(d.ana_pid)}, başlangıç ${anaBas}`);
    console.log(`Bekçinin sürümü: ${String(d.surum)}, ana yolu: ${String(d.ana_yolu)}`);
    if (typeof d.veri_koku === "string") {
      console.log(`Bekçinin veri kökü: ${d.veri_koku}`);
      if (!ayniYol(d.veri_koku, veriKoku(process.env))) {
        console.log("UYARI: bekçi bu kabuğun veri kökünden başka bir kökte çalışıyor (Görev Zamanlayıcı kalıcı ortamı görür)");
      }
    }
    console.log(
      `Yeniden başlatma: ${String(d.yeniden_baslatma)}, son çıkış kodu: ${String(d.son_cikis_kodu)}, son nabız: ${
        typeof d.son_nabiz_ms === "number" ? tarihMetni(d.son_nabiz_ms) : "yok"
      }`,
    );
  }
  return 0;
};

export type IzinDuzeltBaglari = {
  /** Bu kabuğun ortamı. */
  readonly ortam: Ortam;
  /** Görev Zamanlayıcı'nın göreceği kalıcı ortam (`kaliciOrtamOku`); null = okunamadı. */
  readonly kaliciOrtam: () => KaliciOrtam;
  /** Kökü daraltır (`veriKokuIzniniSagla(kok, …, { bilerek: true })`). */
  readonly sagla: (kok: string) => IzinSonucu;
  /** Kullanıcının terminaline bilgi satırı. */
  readonly yaz: (satir: string) => void;
  /** Kullanıcının terminaline uyarı satırı. */
  readonly uyar: (satir: string) => void;
};

const gercekIzinDuzeltBaglari = (): IzinDuzeltBaglari => ({
  ortam: process.env,
  kaliciOrtam: () => kaliciOrtamOku(process.env),
  sagla: (kok) => veriKokuIzniniSagla(kok, undefined, { bilerek: true }),
  yaz: (satir) => console.log(satir),
  uyar: (satir) => console.error(satir),
});

/**
 * `--izin-duzelt`: servisin gerçekten kullanacağı veri kökünü daraltır ve hangisi olduğunu terminale yazar.
 * Görev Zamanlayıcı'nın başlattığı servis kalıcı ortamı görür; kabuktaki `EREN_KIT_DATA_DIR` ondan farklıysa
 * kabuğun kökü değil servisinki düzeltilir ve fark söylenir (servisin açılma hatası bilerek yol yazmaz).
 * Kalıcı ortam okunamazsa bu kabuğun kökü, uyarıyla. Önce hedef kök, daraltmadan sonra sonucu yazılır
 * (düzeltildi / oluşturuldu / değişiklik gerekmedi); başarısızlıkta sonuç satırı uyarı olarak çıkar, hata yeniden atılır.
 */
export const izinDuzeltKomutu = (b: IzinDuzeltBaglari = gercekIzinDuzeltBaglari()): number => {
  const servis = servisVeriKoku(b.ortam, b.kaliciOrtam());
  let kok: string;
  if (servis === null) {
    kok = veriKoku(b.ortam);
    b.uyar(
      `UYARI: kalıcı kullanıcı ortamı okunamadı; servisin göreceği ${VERI_KOKU_ORTAMI} bilinmiyor, bu kabuğun veri kökü düzeltiliyor. ` +
        "Servis yine açılmazsa kalıcı ortamdaki değeri denetleyin.",
    );
  } else {
    kok = servis;
    let kabuk: string | null = null;
    try {
      kabuk = veriKoku(b.ortam);
    } catch {
      kabuk = null; // kabuktaki değer geçersiz; servis onu zaten görmez
    }
    if (kabuk === null || !ayniYolMu(kabuk, servis)) {
      b.uyar(
        `UYARI: bu kabuğun veri kökü (${kabuk ?? "geçersiz"}) servisinkinden farklı; Görev Zamanlayıcı'nın başlattığı servis ` +
          `kalıcı ortamı gördüğü için servisin kökü düzeltiliyor. Kabuktaki ${VERI_KOKU_ORTAMI}'i kaldırın ya da kalıcı ortama yazın.`,
      );
    }
  }
  // Önce hedef, sonra gerçek sonuç: başarısız ya da gereksiz işlem "düzeltildi" gibi görünmez.
  b.yaz(`Hedef veri kökü (${servis === null ? "bu kabuğun" : "servisin kullanacağı"}): ${kok}`);
  let sonuc: IzinSonucu;
  try {
    sonuc = b.sagla(kok);
  } catch (e) {
    b.uyar(`Sonuç: veri kökü düzeltilemedi (nedeni aşağıdaki kur: satırında): ${kok}`);
    throw e;
  }
  if (sonuc === "daraltildi") b.yaz(`Sonuç: düzeltildi; izinler yalnız bu hesap, SYSTEM ve Administrators kalacak biçimde daraltıldı: ${kok}`);
  else if (sonuc === "olusturuldu") b.yaz(`Sonuç: kök yoktu; yalnız bu hesaba, SYSTEM'e ve Administrators'a açık olarak oluşturuldu: ${kok}`);
  else b.yaz(`Sonuç: değişiklik gerekmedi; kök zaten yalnız bu hesaba, SYSTEM'e ve Administrators'a açık: ${kok}`);
  return 0;
};

const calistir = async (argv: readonly string[]): Promise<number> => {
  const bilinen = new Set([
    "--kirli",
    "--testsiz",
    "--geri-al",
    "--durum",
    "--yalniz-test",
    "--izin-duzelt",
    ESKI_KOK_BAYRAGI,
    "-h",
    "--help",
    "--yardim",
  ]);
  const bilinmeyen = argv.find((a) => !bilinen.has(a));
  if (bilinmeyen !== undefined) {
    console.error(`kur: bilinmeyen seçenek: ${bilinmeyen}`);
    console.error(YARDIM);
    return 2;
  }
  if (argv.some((a) => a === "-h" || a === "--help" || a === "--yardim")) {
    console.log(YARDIM);
    return 0;
  }
  const kipler = ["--geri-al", "--durum", "--yalniz-test", "--izin-duzelt"].filter((k) => argv.includes(k));
  if (kipler.length > 1) {
    console.error(`kur: bu seçenekler birlikte kullanılamaz: ${kipler.join(" ")}`);
    return 2;
  }
  try {
    if (argv.includes("--durum")) return await durumKomutu();
    if (argv.includes("--izin-duzelt")) return izinDuzeltKomutu();
    if (argv.includes("--yalniz-test")) {
      testKapisi(kaynakKoku());
      console.log("Test kapısı geçti.");
      return 0;
    }
    const eskiKokuYoksay = argv.includes(ESKI_KOK_BAYRAGI);
    if (argv.includes("--geri-al")) return await geriAl(eskiKokuYoksay);
    return await kur({ kirli: argv.includes("--kirli"), testsiz: argv.includes("--testsiz"), eskiKokuYoksay });
  } catch (e) {
    console.error(`kur: ${tekSatir(e)}`);
    return 1;
  }
};

if (import.meta.main) {
  process.exitCode = await calistir(process.argv.slice(2));
}
