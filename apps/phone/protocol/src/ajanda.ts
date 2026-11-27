import { z } from "zod";
import {
  AjandaBaglantilar,
  AjandaBolge,
  AjandaBolgeKonumu,
  ajandaBolgeAnahtari,
  ajandaBolgeYeriDegisirMi,
  AjandaEkBayti,
  AjandaEkler,
  AjandaEkOzeti,
  AjandaEkRetKodu,
  AjandaEkVerisi,
  ajandaBase64Bayti,
  AjandaSimge,
  AjandaVaris,
  AjandaYetenekler,
  v3AlanKurallari,
  type AjandaBaglanti,
  type AjandaEki,
} from "./ajanda-alan.ts";
import {
  AJANDA_VARSAYILAN_HATIRLATMALAR,
  ajandaMetni,
  ajandaSatiri,
  AjandaZamani,
  gercekTarihMi,
  type Hatirlatma,
  Hatirlatmalar,
  ornekGunleriMi,
  ornekGunuMu,
  Tarih,
  Tekrar,
  zamanCekirdegi,
  zamanKurallari,
} from "./ajanda-zaman.ts";
import { type CozumSonucu, semaylaDenetle, surumluCozumle } from "./cozumle.ts";
import { HataKodu } from "./hatalar.ts";
import { kanonikJson, sha256Hex, utf8Bayt } from "./kanonik.ts";
import {
  AJANDA_AZAMI_CERCEVE,
  AJANDA_QR_SURUMU,
  AJANDA_SINIRLARI,
  AJANDA_SURUMLERI,
  AJANDA_SURUMU,
  type AjandaSurumNo,
  SINIRLAR,
} from "./sinirlar.ts";
import { EslestirmeKodu, EslestirmeQr, SohbetId } from "./sohbet.ts";
import { AcikAnahtar, Imza, type ImzaRolu, type Kanal, Nonce, OpakId, ZamanMs } from "./temel.ts";

/**
 * Ajanda: `/ajanda` kanalı, kayıt modeli, eşleştirme kapsamı. Kararlar ve akış `docs/AJANDA.md`'de;
 * araç ve boru şemaları `ajanda-arac.ts`'te, modele giden metin `ajanda-metin.ts`'te.
 */

export const AjandaSurum = z.literal(AJANDA_SURUMU);

/**
 * `/ajanda` mesaj kurucusu: `v` = verilen sürüm (varsayılan `AJANDA_SURUMU`), bilinmeyen alan hata.
 * Sürümün bütün çerçeveleri `ajandaCerceveSemalari`'nda kurulur.
 */
export function ajandaMesaj<T extends string, S extends z.ZodRawShape, V extends AjandaSurumNo = typeof AJANDA_SURUMU>(
  type: T,
  alanlar: S,
  v: V = AJANDA_SURUMU as V,
) {
  return z.strictObject({ v: z.literal(v), type: z.literal(type), ...alanlar });
}

// Kapsam

/**
 * Eşleşmiş cihazın kapsamı. Telefon beyan etmez: PC'deki eşleştirme komutu açtığı pencereye yazar,
 * eşleşen cihaz kaydına geçer. Kapsam alanı olmayan eski cihaz kaydı `ESKI_CIHAZ_KAPSAMI`'dır.
 */
export const CIHAZ_KAPSAMLARI = ["sohbet", "ajanda"] as const;
export const CihazKapsami = z.enum(CIHAZ_KAPSAMLARI);
export type CihazKapsami = z.infer<typeof CihazKapsami>;
export const ESKI_CIHAZ_KAPSAMI: CihazKapsami = "sohbet";

/** Bütün WebSocket yolları. `Kanal` (`eren-auth-v1` imza metni) bilerek genişletilmez. */
export const CIHAZ_KANALLARI = ["sohbet", "cihaz", "ajanda"] as const;
export type CihazKanali = Kanal | "ajanda";

/** Kapsam başına açılabilen yollar. Kesişmez: ajanda cihazı `/sohbet`'i, eski cihaz `/ajanda`'yı açamaz. */
export const KAPSAM_KANALLARI = {
  sohbet: ["sohbet", "cihaz"],
  ajanda: ["ajanda"],
} as const satisfies Record<CihazKapsami, readonly CihazKanali[]>;

/** Kapsamın eşleştirmesinin yapıldığı yol: pencerenin kapsamı bu değilse `eslestirme_kapali`. */
export const KAPSAM_ESLESTIRME_KANALI = {
  sohbet: "sohbet",
  ajanda: "ajanda",
} as const satisfies Record<CihazKapsami, CihazKanali>;

/** `hello` anında taze okunan cihaz kaydının kapsamı bu yolu açabiliyor mu. Değilse `kanal_desteklenmiyor`. */
export function kanalKapsamdaMi(kapsam: CihazKapsami, kanal: string): boolean {
  return (KAPSAM_KANALLARI[kapsam] as readonly string[]).includes(kanal);
}

/**
 * Ajanda imza metninin öneki. Kanal sürümünden (`AJANDA_SURUMU`) bilerek türemez: kimlik metninin
 * biçimi değişmedikçe sabit kalır (`/sohbet` v5'in `eren-auth-v1` kullanması gibi); kanal sürümü
 * artınca eşleşmiş cihazın imzası ve vektördeki gerçek P-256 imzası geçerli kalır.
 */
export const AJANDA_IMZA_ONEKI = "eren-ajanda-auth-v1";

/**
 * `/ajanda` karşılıklı sınamasında imzalanan metin (UTF-8 baytları, ECDSA P-256 + SHA-256, DER).
 * Önek `eren-auth-v1` değildir ve kanal ile kapsam satırları metne girer: ajanda imzası `/sohbet`
 * ya da `/cihaz` imzası olarak kullanılamaz, tersi de. Alanlar satır sonu içeremez (şema).
 */
export function ajandaKimlikImzaMetni(girdi: {
  rol: ImzaRolu;
  device_id: string;
  client_nonce: string;
  server_nonce: string;
}): string {
  return [
    AJANDA_IMZA_ONEKI,
    girdi.rol,
    "kanal:ajanda",
    "kapsam:ajanda",
    girdi.device_id,
    girdi.client_nonce,
    girdi.server_nonce,
  ].join("\n");
}

/**
 * Ajanda eşleştirme QR'ı. `EslestirmeQr` alanları + `kanal:"ajanda"`: eski uygulama bu QR'ı (fazla
 * alan) reddeder, ajanda uygulaması eski QR'ı (`kanal` yok) reddeder. `v` kanal sürümü değil
 * `AJANDA_QR_SURUMU`'dur: kanal sürümü artınca da her sürümün uygulaması bu QR'ı okur.
 */
export const AjandaEslestirmeQr = z.strictObject({
  ...EslestirmeQr.shape,
  v: z.literal(AJANDA_QR_SURUMU),
  kanal: z.literal("ajanda"),
});
export type AjandaEslestirmeQr = z.infer<typeof AjandaEslestirmeQr>;

// Hata ve ret

/** `/ajanda` `error` ve `pair_result.code` kümesi: `HATA_KODLARI`'nın altkümesi, yeni kod yok. */
export const AJANDA_KANAL_HATALARI = [
  "protokol_uyumsuz",
  "gecersiz_mesaj",
  "mesaj_cok_buyuk",
  "zaman_asimi",
  "ic_hata",
  "yetkisiz",
  "imza_gecersiz",
  "ip_uyusmuyor",
  "cihaz_bilinmiyor",
  "kanal_desteklenmiyor",
  "eslestirme_kapali",
  "eslestirme_kodu_gecersiz",
] as const;
export const AjandaKanalHatasi = HataKodu.extract(AJANDA_KANAL_HATALARI);
export type AjandaKanalHatasi = z.infer<typeof AjandaKanalHatasi>;

/**
 * Bir işlemin (telefon `islem`i ya da araç çağrısı) kapalı ret listesi. `HATA_KODLARI`'na girmez:
 * `/sohbet` ve v1 kümeleri değişmesin.
 * - `kayit_bulunamadi`: kimlik yok. `kayit_silinmis`: mezar taşına `geri_yukle` dışında işlem.
 * - `kimlik_cakisiyor`: `ekle`'nin `kayit_id`'si başka işlemle zaten kullanılmış.
 * - `tutarsiz_kayit`: değişiklik uygulanınca kayıt `AjandaKaydi` kurallarını bozuyor.
 * - `saat_dilimi_bilinmiyor`: biçimi doğru ama servisin dilim veritabanında yok.
 * - `ornek_gecersiz`: `ornek_tarihi` tekrarsız kayıtta ya da serinin örneği değil; ya da budamadan
 *   sonra da `ORNEK_ADET` aşılıyor (`ajandaOrnekDurumuUygula`).
 * - `kayit_siniri`: `KAYIT_ADET` doldu.
 * - `sentetik_turda_izinsiz`: insan kökenli olmayan turdan taslak olmayan kayda değişiklik ya da onay.
 * - `dayanak_uyusmuyor`: yalnız araç; modelin `dayanak`'ı turun mesaj anıyla uyuşmuyor (`dayanakGecerliMi`).
 * - `gece_teyidi_gerekli` (v2): yalnız araç; insan turunun mesaj anı gece aralığında (00:00-04:00) ve
 *   takvime bağlı çağrı `dayanak.gece_teyidi` taşımıyor (`geceTeyidiEksikMi`). Kayıt yazılmaz; model
 *   kullanıcıya hangi günü kastettiğini sorar. `/ajanda`'da hiç gönderilmez.
 * - `gecersiz_islem`: yalnız `islem_sonucu`; zarf ve `islem_id` geçerli ama işlemin gövdesi servisin
 *   şemasından geçmedi (`ajandaYukariCoz` sonucunda `islem_id`). Bağlantı kapanmaz.
 * - `ic_hata`: geçici (`AJANDA_GECICI_RET_NEDENLERI`); öteki nedenler kalıcıdır.
 */
export const AJANDA_RET_NEDENLERI = [
  "kayit_bulunamadi",
  "kayit_silinmis",
  "kimlik_cakisiyor",
  "tutarsiz_kayit",
  "saat_dilimi_bilinmiyor",
  "ornek_gecersiz",
  "kayit_siniri",
  "sentetik_turda_izinsiz",
  "dayanak_uyusmuyor",
  "gece_teyidi_gerekli",
  "gecersiz_islem",
  "ic_hata",
] as const;
export const AjandaRetNedeni = z.enum(AJANDA_RET_NEDENLERI);
export type AjandaRetNedeni = z.infer<typeof AjandaRetNedeni>;

/**
 * Geçici ret: işlem uygulanmadı ve tekrarsızlık kaydı yazılmadı; aynı `islem_id` ile yeniden
 * yollanır, iyimser değişiklik durur, `ISLEM_DENEME` sınırı vardır (`ajandaKuyrukKarari`). Öteki
 * nedenler kalıcıdır (aynı kimlik hep aynı sonucu alır).
 */
export const AJANDA_GECICI_RET_NEDENLERI = ["ic_hata"] as const satisfies readonly AjandaRetNedeni[];

export function ajandaRetGeciciMi(neden: AjandaRetNedeni): boolean {
  return (AJANDA_GECICI_RET_NEDENLERI as readonly string[]).includes(neden);
}

// Kayıt

export const KAYIT_TURLERI = ["gorev", "randevu", "not"] as const;
export const KayitTuru = z.enum(KAYIT_TURLERI);
export type KayitTuru = z.infer<typeof KayitTuru>;

/** Kaydın (tekrar ediyorsa serinin) durumu. Hatırlatma yalnız `acik`'ta kurulur. */
export const KAYIT_DURUMLARI = ["acik", "tamam", "iptal"] as const;
export const KayitDurumu = z.enum(KAYIT_DURUMLARI);
export type KayitDurumu = z.infer<typeof KayitDurumu>;

/** Tekrar eden kaydın bir örneğinin `acik` dışındaki durumu (açık örnek satır taşımaz). */
export const ORNEK_DURUMLARI = ["tamam", "iptal"] as const;
export const OrnekDurumu = z.enum(ORNEK_DURUMLARI);

/**
 * Kaydın doğduğu (ya da değişikliğin geldiği) yol. Üretenler: `sohbet_araci` (telefondaki sohbetin ana
 * oturumu), `pc_araci` (PC'deki normal Claude Code oturumları, `ajanda-pc.ts`) ve `elle` (ajanda
 * uygulaması). Sonraki dilimlerin yolları (`arka_plan`, `sesli_not`) şimdiden listededir.
 */
export const KAYNAK_YOLLARI = ["sohbet_araci", "pc_araci", "arka_plan", "sesli_not", "elle"] as const;
export const KaynakYolu = z.enum(KAYNAK_YOLLARI);
export type KaynakYolu = z.infer<typeof KaynakYolu>;

/** İnsan elinden (uygulama) gelen yollar; geri kalanı otomasyondur (alan izi: `kullaniciEmriMi`). */
export const INSAN_YOLLARI = ["elle", "sesli_not"] as const satisfies readonly KaynakYolu[];

export function otomasyonMu(yol: KaynakYolu): boolean {
  return !(INSAN_YOLLARI as readonly string[]).includes(yol);
}

/**
 * Turun kökeni: `insan` yalnız doğrulanmış `/sohbet` insan mesajının başlattığı turda ya da insan
 * yolunda; servis belirler, araç girdisinde yoktur.
 */
export const TUR_KOKENLERI = ["insan", "sentetik"] as const;
export const TurKokeni = z.enum(TUR_KOKENLERI);
export type TurKokeni = z.infer<typeof TurKokeni>;

/** v2'nin alan kümesi (dondurulmuş). */
const AJANDA_ALANLARI_V2 = ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar", "tekrar", "durum"] as const;

/** v3'te eklenen kayıt alanları (hepsi isteğe bağlı, `ajanda-alan.ts`). */
export const AJANDA_V3_ALANLARI = ["simge", "bolge", "bolge_konumu", "varis", "baglantilar", "ekler"] as const;

/**
 * Alan izi ve değişikliklerin alan kümesi (en yeni sürüm), sırası kanoniktir. Yeni sürümün alanları
 * sona eklenir: her eski sürümün kümesi bunun önekidir, süzülen liste o sürümde de kanoniktir.
 */
export const AJANDA_ALANLARI = [...AJANDA_ALANLARI_V2, ...AJANDA_V3_ALANLARI] as const;
export const AjandaAlani = z.enum(AJANDA_ALANLARI);
export type AjandaAlani = z.infer<typeof AjandaAlani>;

/** Sürümün alan kümesi (`AJANDA_ALANLARI`'nın öneki). */
export const AJANDA_SURUM_ALANLARI = {
  2: AJANDA_ALANLARI_V2,
  3: AJANDA_ALANLARI,
} as const satisfies { [V in AjandaSurumNo]: readonly AjandaAlani[] };

/** Sürümün alan listesi şeması (`elle_alanlar`, `korunan_alanlar`): kanonik sırada ve tekil. */
function alanListesi<A extends readonly [string, ...string[]]>(alanlar: A) {
  return z
    .array(z.enum(alanlar))
    .max(alanlar.length)
    .refine((l) => l.every((a, i) => i === 0 || alanlar.indexOf(l[i - 1]!) < alanlar.indexOf(a)), {
      message: "alanlar kanonik sırada ve tekil",
    });
}

export const KayitId = OpakId;
/** Servisin ajanda deposunun kimliği; depo yeniden kurulunca değişir. */
export const DepoId = OpakId;
/** PC'nin verdiği tek artan revizyon. Her değişiklik tam bir kaydın revizyonunu artırır. */
export const Revizyon = z.number().int().min(1);
export const SonRevizyon = z.number().int().min(0);

export const TekilAnahtar = z
  .string()
  .min(1)
  .max(AJANDA_SINIRLARI.TEKIL_ANAHTAR)
  .regex(/^[A-Za-z0-9:._-]+$/);

export const AjandaBaslik = ajandaSatiri(1, AJANDA_SINIRLARI.BASLIK);
export const AjandaAciklama = ajandaMetni(AJANDA_SINIRLARI.ACIKLAMA);
export const AjandaAlinti = ajandaSatiri(1, AJANDA_SINIRLARI.ALINTI);

/**
 * Kaydın kaynak izi. Kayıt doğarken servis yazar, sonra değişmez. Hiçbir alanı eylem değildir.
 * - `elle`, `sesli_not`: `device_id` zorunlu, `tur_kokeni` `insan`, sohbet alanları yok.
 * - `sohbet_araci`: `sohbet_id` zorunlu; `kaynak_msg_id` turu başlatan insan mesajı (sentetik turda yok).
 * - `arka_plan`: `sohbet_id` ya da `oturum_id`. `pc_araci`: `oturum_id` zorunlu.
 * - `alinti`: kaydı doğuran insan sözünden kısa parça; servis yalnız turun insan mesajında birebir
 *   geçiyorsa saklar.
 */
export const AjandaKaynagi = z
  .strictObject({
    yol: KaynakYolu,
    tur_kokeni: TurKokeni,
    sohbet_id: SohbetId.optional(),
    oturum_id: OpakId.optional(),
    kaynak_msg_id: OpakId.optional(),
    device_id: OpakId.optional(),
    alinti: AjandaAlinti.optional(),
    tekil_anahtar: TekilAnahtar.optional(),
  })
  .superRefine((k, ctx) => {
    const hata = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const insanYolu = !otomasyonMu(k.yol);
    if (insanYolu) {
      if (k.device_id === undefined) hata("device_id", "insan yolunda device_id zorunlu");
      if (k.tur_kokeni !== "insan") hata("tur_kokeni", "insan yolu insan kökenlidir");
      if (k.sohbet_id !== undefined || k.oturum_id !== undefined || k.kaynak_msg_id !== undefined) {
        hata("yol", "insan yolunda sohbet ve oturum alanı yok");
      }
    } else if (k.device_id !== undefined) {
      hata("device_id", "device_id yalnız insan yolunda");
    }
    if (k.yol === "sohbet_araci" && k.sohbet_id === undefined) hata("sohbet_id", "sohbet_araci sohbet_id ister");
    if (k.yol === "pc_araci" && k.oturum_id === undefined) hata("oturum_id", "pc_araci oturum_id ister");
    if (k.yol === "arka_plan" && k.sohbet_id === undefined && k.oturum_id === undefined) {
      hata("yol", "arka_plan sohbet_id ya da oturum_id ister");
    }
    if (k.kaynak_msg_id !== undefined && k.tur_kokeni !== "insan") hata("kaynak_msg_id", "kaynak_msg_id yalnız insan turunda");
  });
export type AjandaKaynagi = z.infer<typeof AjandaKaynagi>;

/** Bir değişikliği yapan: kaynak izinin değişiklik başına hali (geçmişte). */
export const AjandaYazar = z.strictObject({
  yol: KaynakYolu,
  tur_kokeni: TurKokeni,
  device_id: OpakId.optional(),
  sohbet_id: SohbetId.optional(),
  oturum_id: OpakId.optional(),
});
export type AjandaYazar = z.infer<typeof AjandaYazar>;

export const AjandaOrnegi = z.strictObject({ tarih: Tarih, durum: OrnekDurumu });

const GOVDE_ALANLARI = {
  tur: KayitTuru,
  baslik: AjandaBaslik,
  aciklama: AjandaAciklama.optional(),
  zaman: AjandaZamani.optional(),
  hatirlatmalar: Hatirlatmalar,
  tekrar: Tekrar.optional(),
};

/** v3 kayıt ve `ekle` alanları: hepsi isteğe bağlı, üst düzey (`ajanda-alan.ts`). */
const V3_GOVDE_ALANLARI = {
  simge: AjandaSimge.optional(),
  bolge: AjandaBolge.optional(),
  bolge_konumu: AjandaBolgeKonumu.optional(),
  varis: AjandaVaris.optional(),
  baglantilar: AjandaBaglantilar.optional(),
  ekler: AjandaEkler.optional(),
};

/** v3 değişiklik ve geçmiş parçası alanları: `null` kaldırır. */
const V3_DEGISIKLIK_ALANLARI = {
  simge: AjandaSimge.nullable().optional(),
  bolge: AjandaBolge.nullable().optional(),
  bolge_konumu: AjandaBolgeKonumu.nullable().optional(),
  varis: AjandaVaris.nullable().optional(),
  baglantilar: AjandaBaglantilar.nullable().optional(),
  ekler: AjandaEkler.nullable().optional(),
};

/**
 * Sürüm başına gövde eklemeleri. Yeni sürüm buraya bir satır ekler (önceki sürümün alanları + yenileri);
 * kurallar (`kayitKurallari`, `v3AlanKurallari`) bütün sürümlerde aynı işlevdir, yeni alan yoksa boş geçer.
 */
const SURUM_GOVDE_EKLERI = {
  2: { govde: {}, degisiklik: {} },
  3: { govde: V3_GOVDE_ALANLARI, degisiklik: V3_DEGISIKLIK_ALANLARI },
} as const satisfies { [V in AjandaSurumNo]: { govde: z.ZodRawShape; degisiklik: z.ZodRawShape } };

/** Kayıt kurallarının baktığı alanlar (her sürümün kaydı buna uyar). */
type KayitKuralGirdisi = {
  zaman?: AjandaZamani | undefined;
  tekrar?: Tekrar | undefined;
  ornekler: { tarih: string; durum: string }[];
  olusturma_ms: number;
  guncelleme_ms: number;
  bolge?: unknown;
  bolge_konumu?: unknown;
  varis?: unknown;
};

function kayitKurallari(k: KayitKuralGirdisi, ctx: z.RefinementCtx): void {
  zamanKurallari(k, ctx);
  v3AlanKurallari(k, ctx);
  if (k.ornekler.length > 0) {
    if (k.tekrar === undefined) {
      ctx.addIssue({ code: "custom", path: ["ornekler"], message: "ornekler yalnız tekrar eden kayıtta" });
    } else if (!k.ornekler.every((o, i) => i === 0 || k.ornekler[i - 1]!.tarih < o.tarih)) {
      ctx.addIssue({ code: "custom", path: ["ornekler"], message: "ornekler tarih sırasıyla ve tekil" });
    } else if (k.zaman !== undefined && "tarih" in k.zaman && k.ornekler[0]!.tarih < k.zaman.tarih) {
      ctx.addIssue({ code: "custom", path: ["ornekler"], message: "örnek çapadan önce" });
    } else if (
      k.zaman !== undefined &&
      "tarih" in k.zaman &&
      gercekTarihMi(k.zaman.tarih) &&
      Tekrar.safeParse(k.tekrar).success &&
      k.ornekler.every((o) => gercekTarihMi(o.tarih)) &&
      !ornekGunleriMi(k.zaman.tarih, k.tekrar, k.ornekler.map((o) => o.tarih))
    ) {
      ctx.addIssue({ code: "custom", path: ["ornekler"], message: "örnek serinin günü değil" });
    }
  }
  if (k.guncelleme_ms < k.olusturma_ms) {
    ctx.addIssue({ code: "custom", path: ["guncelleme_ms"], message: "güncelleme oluşturmadan önce" });
  }
}

export const AJANDA_ISLEMLERI = ["ekle", "guncelle", "durum", "onayla", "sil", "geri_yukle"] as const;

/**
 * Bir sürümün gövde şemaları: kayıt, değişiklik, işlem, geçmiş parçası ve girdisi, alan listesi. Her
 * sürüm kendi içinde katıdır; v3 şemaları v2'ninkilerin üstüne yalnız isteğe bağlı alan ekler. Dışa
 * verilen adlar (`AjandaKaydi`, `AjandaIslem`, ...) en yeni sürümündür: servis içeride bununla çalışır,
 * eski sürüme `ajandaAsagiSurume` uyarlar.
 */
function ajandaGovdeSemalari<A extends readonly [string, ...string[]], G extends z.ZodRawShape, D extends z.ZodRawShape>(
  alanlar: A,
  ek: { govde: G; degisiklik: D },
) {
  const AlanListesi = alanListesi(alanlar);

  /**
   * Kaydın PC'deki güncel hali; `/ajanda` `kayit` çerçevesi bunu taşır. Eylemsiz veridir: intent ya da
   * komut alanı yoktur; metinler düz metin gösterilir, bağlantılar (v3) yalnız kullanıcı dokununca açılır.
   * Kurallar: `zamanKurallari`; `ornekler` yalnız tekrarda, tarih sırasıyla tekil ve her biri serinin
   * örnek günü (`ornekGunuMu`); `elle_alanlar` kanonik sırada; v3'te `bolge_konumu` ve `varis` yalnız
   * `bolge` varken (`v3AlanKurallari`). `guncelleme_ms`, kaydın güncel revizyonunu yazan geçmiş
   * satırının `ts_ms`'idir (telafi izi bu eşitliğe dayanır: `ajandaTelafiTamMi`).
   * - `taslak`: insan kökenli olmayan turda doğdu; kullanıcı `onayla`yana kadar hatırlatma kurulmaz.
   * - `silindi`: mezar taşı; içerik `geri_yukle` için durur, hatırlatma kurulmaz.
   * - `elle_alanlar`: kullanıcının emriyle (uygulamadan ya da insan turundaki araçla) değişen alanlar;
   *   emir olmayan otomasyon (sentetik tur, arka plan) bunları değiştiremez.
   */
  const Kaydi = z
    .strictObject({
      kayit_id: KayitId,
      revizyon: Revizyon,
      ...GOVDE_ALANLARI,
      ...ek.govde,
      ornekler: z.array(AjandaOrnegi).max(AJANDA_SINIRLARI.ORNEK_ADET),
      durum: KayitDurumu,
      taslak: z.boolean(),
      silindi: z.boolean(),
      elle_alanlar: AlanListesi,
      kaynak: AjandaKaynagi,
      olusturma_ms: ZamanMs,
      guncelleme_ms: ZamanMs,
    })
    .superRefine((k, ctx) => kayitKurallari(k as KayitKuralGirdisi, ctx));

  /**
   * Kısmi değişiklik. Verilmeyen alan değişmez; `null` alanı kaldırır. Durum ayrı işlemdir (`durum`).
   * Kurallar birleşmiş kayıt üzerinde servis tarafından denetlenir (`tutarsiz_kayit`).
   */
  const Degisiklik = z
    .strictObject({
      tur: KayitTuru.optional(),
      baslik: AjandaBaslik.optional(),
      aciklama: AjandaAciklama.nullable().optional(),
      zaman: AjandaZamani.nullable().optional(),
      hatirlatmalar: Hatirlatmalar.optional(),
      tekrar: Tekrar.nullable().optional(),
      ...ek.degisiklik,
    })
    .refine((d) => Object.values(d).some((x) => x !== undefined), { message: "boş değişiklik" });

  /** Uygulamanın yolladığı işlemler. Hepsi idempotenttir (`islem_id`); her başarılı değişiklik bir revizyon. */
  const Islem = z.discriminatedUnion("islem", [
    /** Kimliği uygulama üretir (çevrimdışı kuyrukta bekleyebilsin). */
    z
      .strictObject({
        islem: z.literal("ekle"),
        kayit_id: KayitId,
        ...GOVDE_ALANLARI,
        ...ek.govde,
        girdi_yolu: z.enum(INSAN_YOLLARI),
      })
      .superRefine((g, ctx) => {
        const girdi = g as Parameters<typeof zamanKurallari>[0] & Parameters<typeof v3AlanKurallari>[0];
        zamanKurallari(girdi, ctx);
        v3AlanKurallari(girdi, ctx);
      }),
    /** `temel_revizyon`: kullanıcının düzenlediği hal. Reddetmez (varış sırası kazanır), geçmişe yazılır. */
    z.strictObject({
      islem: z.literal("guncelle"),
      kayit_id: KayitId,
      temel_revizyon: Revizyon,
      degisiklik: Degisiklik,
    }),
    /** `ornek_tarihi` verilirse yalnız o örnek (`acik` örnek satırını kaldırır); yoksa kaydın kendisi. */
    z.strictObject({
      islem: z.literal("durum"),
      kayit_id: KayitId,
      durum: KayitDurumu,
      ornek_tarihi: Tarih.optional(),
    }),
    /** Taslağı kesinleştirir: hatırlatmalar bundan sonra kurulur. */
    z.strictObject({ islem: z.literal("onayla"), kayit_id: KayitId }),
    /** Yumuşak silme. */
    z.strictObject({ islem: z.literal("sil"), kayit_id: KayitId }),
    z.strictObject({ islem: z.literal("geri_yukle"), kayit_id: KayitId }),
  ]);

  /** Değişikliğin öncesi ya da sonrası: yalnız değişen alanlar. `null`: alan yoktu / kaldırıldı. */
  const Parca = z.strictObject({
    tur: KayitTuru.optional(),
    baslik: AjandaBaslik.optional(),
    aciklama: AjandaAciklama.nullable().optional(),
    zaman: AjandaZamani.nullable().optional(),
    hatirlatmalar: Hatirlatmalar.optional(),
    tekrar: Tekrar.nullable().optional(),
    ...ek.degisiklik,
    durum: KayitDurumu.optional(),
    taslak: z.boolean().optional(),
    silindi: z.boolean().optional(),
    /** Yalnız `ornek_tarihi`'li girdide: o örneğin durumu, `null` açık. */
    ornek_durumu: OrnekDurumu.nullable().optional(),
    /** Tekrar ya da çapa değişince budanan, ya da `ORNEK_ADET` için atılan örnek satırları: tam liste. */
    ornekler: z.array(AjandaOrnegi).max(AJANDA_SINIRLARI.ORNEK_ADET).optional(),
  });

  const GecmisGirdisi = z.strictObject({
    rev: Revizyon,
    ts_ms: ZamanMs,
    islem: z.enum(AJANDA_ISLEMLERI),
    yazar: AjandaYazar,
    /** `guncelle`'de kullanıcının düzenlediği hal. */
    temel_revizyon: Revizyon.optional(),
    /** Otomasyonun değiştiremediği alanlar. */
    korunan_alanlar: AlanListesi.optional(),
    ornek_tarihi: Tarih.optional(),
    onceki: Parca,
    sonraki: Parca,
  });

  return { AlanListesi, Kaydi, Degisiklik, Islem, Parca, GecmisGirdisi };
}

/** Sürüm başına gövde şemaları (`AJANDA_SURUMLERI` ile birebir). */
export const AJANDA_GOVDE_SEMALARI = {
  2: ajandaGovdeSemalari(AJANDA_SURUM_ALANLARI[2], SURUM_GOVDE_EKLERI[2]),
  3: ajandaGovdeSemalari(AJANDA_SURUM_ALANLARI[3], SURUM_GOVDE_EKLERI[3]),
} as const;

const YENI_GOVDE = AJANDA_GOVDE_SEMALARI[AJANDA_SURUMU];

export const AjandaKaydi = YENI_GOVDE.Kaydi;
export type AjandaKaydi = z.infer<typeof AjandaKaydi>;
export const AjandaDegisiklik = YENI_GOVDE.Degisiklik;
export type AjandaDegisiklik = z.infer<typeof AjandaDegisiklik>;
export const AjandaIslem = YENI_GOVDE.Islem;
export type AjandaIslem = z.infer<typeof AjandaIslem>;
export const AjandaParca = YENI_GOVDE.Parca;
export type AjandaParca = z.infer<typeof AjandaParca>;
export const AjandaGecmisGirdisi = YENI_GOVDE.GecmisGirdisi;
export type AjandaGecmisGirdisi = z.infer<typeof AjandaGecmisGirdisi>;

/** Telefon hatırlatmayı yalnız buna göre kurar (örnek başına `ornekler` durumu ayrıca atlanır). */
export function hatirlatmaEtkinMi(kayit: Pick<AjandaKaydi, "taslak" | "silindi" | "durum">): boolean {
  return !kayit.taslak && !kayit.silindi && kayit.durum === "acik";
}

// Çerçeveler: sürüme göre kurulur

/**
 * Telafi izi: uygulamanın sunucu kopyasında revizyonu `son_rev` olan kaydın kimliği ve
 * `guncelleme_ms`'i. Servis kendi geçmişindeki `son_rev` satırıyla karşılaştırır; tutmazsa (yedekten
 * geri yükleme, sayaç geriye gitti) `tam` telafi yapar (`ajandaTelafiTamMi`).
 */
export const AjandaRevIzi = z.strictObject({ kayit_id: KayitId, guncelleme_ms: ZamanMs });
export type AjandaRevIzi = z.infer<typeof AjandaRevIzi>;

/**
 * Sürüm başına `hello` ve `welcome` eklemeleri. v3: `yetenekler` (açık küme, biçim katı;
 * `ajanda-alan.ts`). `hello.yetenekler` istemcinin istedikleri (yoksa hiç), `welcome.yetenekler`
 * kesişimdir (`ajandaYetenekKesisimi`), v3'te her zaman yollanır.
 */
const SURUM_CERCEVE_EKLERI = {
  2: { hello: {}, welcome: {} },
  3: { hello: { yetenekler: AjandaYetenekler.optional() }, welcome: { yetenekler: AjandaYetenekler } },
} as const satisfies { [V in AjandaSurumNo]: { hello: z.ZodRawShape; welcome: z.ZodRawShape } };

/**
 * Bir sürümün bütün sürümlerde bulunan `/ajanda` çerçeveleri. Her sürüm kendi içinde katıdır (bilinmeyen
 * alan hata) ve yalnız kendi `v`'sini kabul eder. Sürüme bağlı alan `SURUM_CERCEVE_EKLERI`'nden, gövde
 * şemaları `AJANDA_GOVDE_SEMALARI`'ndan gelir; yalnız bir sürümden itibaren var olan çerçeveler (v3: ek
 * yedeği, `ajandaEkCerceveleri`) birleşimlere `AJANDA_CERCEVE_SEMALARI`'nda eklenir.
 */
function ajandaCerceveSemalari<
  V extends AjandaSurumNo,
  I extends z.ZodType,
  K extends z.ZodType,
  L extends z.ZodType<readonly string[]>,
  GG extends z.ZodType<{ rev: number }>,
  H extends z.ZodRawShape,
  W extends z.ZodRawShape,
>(v: V, G: { Islem: I; Kaydi: K; AlanListesi: L; GecmisGirdisi: GG }, ek: { hello: H; welcome: W }) {
  const mesaj = <T extends string, S extends z.ZodRawShape>(type: T, alanlar: S) => ajandaMesaj(type, alanlar, v);

  // Yukarı: ajanda uygulaması -> PC

  /** Kapsam alanı yoktur: kapsamı PC'deki eşleştirme penceresi belirler. */
  const PairRequest = mesaj("pair_request", {
    kod: EslestirmeKodu,
    public_key: AcikAnahtar,
    platform: z.literal("android"),
    /** Yalnız listede ayırt etmek için. Güvenilmez etiket, hiçbir karara girmez. */
    etiket: z.string().max(SINIRLAR.CIHAZ_ETIKETI).optional(),
  });
  /**
   * `son_rev`: uygulamanın uyguladığı en büyük revizyon. `depo_id`: en son `welcome`'daki.
   * `son_rev_izi`: `son_rev` > 0 iken yollanır; yoksa servis `tam` telafi yapar.
   */
  const Hello = mesaj("hello", {
    device_id: OpakId,
    son_rev: SonRevizyon,
    depo_id: DepoId.optional(),
    son_rev_izi: AjandaRevIzi.optional(),
    client_nonce: Nonce,
    ...ek.hello,
  });
  const AuthResponse = mesaj("auth_response", { signature: Imza });
  /**
   * Kimlik sonrası. Aynı `islem_id` yeniden gelirse aynı `islem_sonucu` döner, ikinci kez uygulanmaz.
   * Gövdesi geçersiz işlem `gecersiz_islem` alır, bağlantı kapanmaz (`ajandaYukariCoz`).
   */
  const IslemMesaji = mesaj("islem", { islem_id: OpakId, islem: G.Islem });
  /** Bir kaydın geçmişi, en yeniden geriye sayfa sayfa. `once_rev`: bu revizyondan küçükler. */
  const GecmisIste = mesaj("gecmis_iste", {
    istek_id: OpakId,
    kayit_id: KayitId,
    once_rev: Revizyon.optional(),
  });

  // Aşağı: PC -> ajanda uygulaması

  const PairResult = mesaj("pair_result", {
    ok: z.boolean(),
    device_id: OpakId.optional(),
    server_public_key: AcikAnahtar.optional(),
    kapsam: z.literal("ajanda").optional(),
    code: AjandaKanalHatasi.optional(),
  }).refine(
    (s) =>
      s.ok
        ? s.device_id !== undefined && s.server_public_key !== undefined && s.kapsam !== undefined && s.code === undefined
        : s.code !== undefined && s.device_id === undefined && s.server_public_key === undefined && s.kapsam === undefined,
    { message: "ok ile alanlar uyuşmuyor" },
  );
  /** `server_signature` = `ajandaKimlikImzaMetni({ rol: "pc", ... })` imzası. */
  const AuthChallenge = mesaj("auth_challenge", { server_nonce: Nonce, server_signature: Imza });
  /**
   * `tam` (`ajandaTelafiTamMi`): 0'dan bütün kayıtlar gelir. Uygulama bunları ayrı toplar; görünen
   * kopya, kurulu alarmlar, `son_rev` ve `depo_id` `esitlendi`'ye kadar değişmez, `esitlendi`'de
   * toplanan kopyanın yerine geçer, kopmada atılır (`ajandaEsitlemeAdimi`). Sonucu gelmemiş işlem
   * kuyruğu her durumda korunur. Değilse `son_rev`'ten büyük revizyonlu kayıtlar gelir.
   */
  const Welcome = mesaj("welcome", {
    depo_id: DepoId,
    bas_rev: SonRevizyon,
    tam: z.boolean(),
    server_time_ms: ZamanMs,
    ...ek.welcome,
  });
  /** Bir kaydın güncel hali. Telafide ve canlıda revizyon kesin artan sırayla gelir. */
  const KayitMesaji = mesaj("kayit", { kayit: G.Kaydi });
  /** Telafi bitti; `rev` o anki `bas_rev`. Sonrası canlıdır. */
  const Esitlendi = mesaj("esitlendi", { rev: SonRevizyon });
  /**
   * `islem`'in sonucu. `ok` ve `rev`: değişikliğin revizyonu; yan etkisiz `ok`'ta (aynı değer, zaten
   * silinmiş) `rev` yok. `korunan_alanlar` yalnız emir olmayan otomasyonda dolabilir, uygulamaya hep boş/yok.
   * Uygulamanın kuyruktaki işlemle ne yapacağı `ajandaKuyrukKarari`'dır (geçici ret ve kopmada deneme
   * sınırı, kalıcı retle ret listesi).
   */
  const IslemSonucu = mesaj("islem_sonucu", {
    islem_id: OpakId,
    ok: z.boolean(),
    kayit_id: KayitId.optional(),
    rev: Revizyon.optional(),
    korunan_alanlar: G.AlanListesi.optional(),
    code: AjandaRetNedeni.optional(),
  }).refine((s) => (s.ok ? s.code === undefined : s.code !== undefined && s.rev === undefined), {
    message: "ok, rev ve code tutarsız",
  });
  const Gecmis = mesaj("gecmis", {
    istek_id: OpakId,
    kayit_id: KayitId,
    girdiler: z
      .array(G.GecmisGirdisi)
      .max(AJANDA_SINIRLARI.GECMIS_SAYFA)
      .refine((l) => l.every((g, i) => i === 0 || l[i - 1]!.rev > g.rev), { message: "rev kesin azalan olmalı" }),
    devami: z.boolean(),
    code: AjandaRetNedeni.optional(),
  }).refine((s) => s.code === undefined || (s.girdiler.length === 0 && !s.devami), {
    message: "code ile girdi olmaz",
  });
  /** Zarfı bütün sürümlerde dondurulmuştur (`ajandaDonmusHataOku`); kod kümesi sürümündür. */
  const ErrorMesaji = mesaj("error", {
    code: AjandaKanalHatasi,
    detail: z.string().max(SINIRLAR.HATA_DETAYI).optional(),
  });

  /** `islem` çerçevesinin zarfı: gövdeye bakmadan `islem_id`'yi okumak için. */
  const IslemZarfi = mesaj("islem", { islem_id: OpakId, islem: z.unknown().optional() });

  return {
    PairRequest,
    Hello,
    AuthResponse,
    IslemMesaji,
    GecmisIste,
    PairResult,
    AuthChallenge,
    Welcome,
    KayitMesaji,
    Esitlendi,
    IslemSonucu,
    Gecmis,
    ErrorMesaji,
    IslemZarfi,
    /** Birleşimlerin ortak üyeleri (sürüme özgü çerçeveler `AJANDA_CERCEVE_SEMALARI`'nda eklenir). */
    yukari: [PairRequest, Hello, AuthResponse, IslemMesaji, GecmisIste] as const,
    asagi: [PairResult, AuthChallenge, Welcome, KayitMesaji, Esitlendi, IslemSonucu, Gecmis, ErrorMesaji] as const,
  };
}

/**
 * Ek yedeği çerçeveleri (v3'ten; `docs/AJANDA.md` "Ek yedeği"). Şema şimdiden tanımlıdır, davranış
 * `ek_yedegi` yeteneğine bağlıdır: servis saklamayı uygulayınca yeteneği ilan eder; kesişimde yoksa
 * uygulama yüklemez, indirmez. İkili veri yalnız bir kaydın `ekler`'inde aynı `ek_id`, `ozet` ve `bayt`
 * ile geçiyorsa kabul edilir. Retler `ek_ret` ile, bağlantı kapanmaz.
 * - Yükleme (dur-bekle): `ek_yukle` → `ek_durum{alinan}`; sonra her `ek_parca` (yukarı) → `ek_durum`.
 *   Servis yalnız `ofset == alinan` ise yazar; yanlış ofsete de `ek_durum` döner, istemci oradan sürer.
 * - İndirme: `ek_iste{ofset}` → en çok `EK_PENCERE` `ek_parca` (aşağı), sonra `ek_durum{gonderilen}`.
 */
function ajandaEkCerceveleri<V extends AjandaSurumNo>(v: V) {
  const mesaj = <T extends string, S extends z.ZodRawShape>(type: T, alanlar: S) => ajandaMesaj(type, alanlar, v);
  const Ofset = z.number().int().min(0).max(AJANDA_SINIRLARI.EK_BAYT);

  const EkYukle = mesaj("ek_yukle", {
    istek_id: OpakId,
    kayit_id: KayitId,
    ek_id: OpakId,
    ozet: AjandaEkOzeti,
    bayt: AjandaEkBayti,
  });
  /** İki yönde aynı şekil. `veri` 1..`EK_PARCA` bayt kanonik base64; parça `EK_BAYT`'ı aşmaz. */
  const EkParca = mesaj("ek_parca", {
    ek_id: OpakId,
    ofset: Ofset,
    veri: AjandaEkVerisi,
  }).refine((p) => p.ofset + ajandaBase64Bayti(p.veri) <= AJANDA_SINIRLARI.EK_BAYT, {
    message: "parça ek sınırını aşıyor",
    path: ["ofset"],
  });
  const EkIste = mesaj("ek_iste", {
    istek_id: OpakId,
    ek_id: OpakId,
    ozet: AjandaEkOzeti,
    ofset: Ofset,
  });
  /**
   * Yüklemede `alinan` (serviste o `ozet` için kalıcı olarak alınmış bayt), indirmede `gonderilen`:
   * tam biri. `tamam`: dosya bütün ve özeti doğrulanmış.
   */
  const EkDurum = mesaj("ek_durum", {
    ek_id: OpakId,
    alinan: Ofset.optional(),
    gonderilen: Ofset.optional(),
    tamam: z.boolean(),
  }).refine((d) => (d.alinan === undefined) !== (d.gonderilen === undefined), {
    message: "alinan ya da gonderilen: tam biri",
  });
  const EkRet = mesaj("ek_ret", { ek_id: OpakId, code: AjandaEkRetKodu });

  return { EkYukle, EkParca, EkIste, EkDurum, EkRet };
}

const V2_CERCEVELERI = ajandaCerceveSemalari(2, AJANDA_GOVDE_SEMALARI[2], SURUM_CERCEVE_EKLERI[2]);
const V3_CERCEVELERI = ajandaCerceveSemalari(3, AJANDA_GOVDE_SEMALARI[3], SURUM_CERCEVE_EKLERI[3]);
const V3_EK_CERCEVELERI = ajandaEkCerceveleri(3);

/**
 * Sürüm tablosu: `AJANDA_SURUMLERI`'nin her sürümü için o sürümün çerçeve şemaları ve birleşimleri.
 * Yeni sürüm buraya bir satır (önceki sürümün sürüme özgü çerçeveleri + kendi yenileri), gövde eklemesi
 * `SURUM_GOVDE_EKLERI`'ne, alan eklemesi `SURUM_CERCEVE_EKLERI`'ne, aşağı uyarlaması
 * `ASAGI_UYARLAMALARI`'na eklenir.
 */
export const AJANDA_CERCEVE_SEMALARI = {
  2: {
    ...V2_CERCEVELERI,
    Yukari: z.discriminatedUnion("type", [...V2_CERCEVELERI.yukari]),
    Asagi: z.discriminatedUnion("type", [...V2_CERCEVELERI.asagi]),
  },
  3: {
    ...V3_CERCEVELERI,
    ...V3_EK_CERCEVELERI,
    Yukari: z.discriminatedUnion("type", [
      ...V3_CERCEVELERI.yukari,
      V3_EK_CERCEVELERI.EkYukle,
      V3_EK_CERCEVELERI.EkParca,
      V3_EK_CERCEVELERI.EkIste,
    ]),
    Asagi: z.discriminatedUnion("type", [
      ...V3_CERCEVELERI.asagi,
      V3_EK_CERCEVELERI.EkDurum,
      V3_EK_CERCEVELERI.EkParca,
      V3_EK_CERCEVELERI.EkRet,
    ]),
  },
} as const;

/** `v` bu tarafın sürüm kümesinde mi. Tabloyu güvenilmez değerle indekslemeden önce sorulur. */
export function ajandaSurumuMu(v: unknown): v is AjandaSurumNo {
  return (AJANDA_SURUMLERI as readonly unknown[]).includes(v);
}

const semalar = (v: AjandaSurumNo) => AJANDA_CERCEVE_SEMALARI[v];

/** En yeni sürüm (`AJANDA_SURUMU`): servis içeride bununla çalışır; adlar ve açıklamalar bunundur. */
const YENI = AJANDA_CERCEVE_SEMALARI[AJANDA_SURUMU];

export const AjandaPairRequest = YENI.PairRequest;
export const AjandaHello = YENI.Hello;
export const AjandaAuthResponse = YENI.AuthResponse;
export const AjandaIslemMesaji = YENI.IslemMesaji;
export const AjandaGecmisIste = YENI.GecmisIste;
export const AjandaEkYukle = YENI.EkYukle;
export const AjandaEkParca = YENI.EkParca;
export const AjandaEkIste = YENI.EkIste;
export const AjandaYukari = YENI.Yukari;
export type AjandaYukari = z.infer<typeof AjandaYukari>;

export const AjandaPairResult = YENI.PairResult;
export const AjandaAuthChallenge = YENI.AuthChallenge;
export const AjandaWelcome = YENI.Welcome;
export const AjandaKayitMesaji = YENI.KayitMesaji;
export const AjandaEsitlendi = YENI.Esitlendi;
export const AjandaIslemSonucu = YENI.IslemSonucu;
export const AjandaGecmis = YENI.Gecmis;
export const AjandaErrorMesaji = YENI.ErrorMesaji;
export const AjandaEkDurum = YENI.EkDurum;
export const AjandaEkRet = YENI.EkRet;
export const AjandaAsagi = YENI.Asagi;
export type AjandaAsagi = z.infer<typeof AjandaAsagi>;

/** Herhangi bir desteklenen sürümün çerçevesi (çözücü sonucu; sürümü `v`'sidir). */
export type AjandaSurumluYukari = z.infer<(typeof AJANDA_CERCEVE_SEMALARI)[AjandaSurumNo]["Yukari"]>;
export type AjandaSurumluAsagi = z.infer<(typeof AJANDA_CERCEVE_SEMALARI)[AjandaSurumNo]["Asagi"]>;

/**
 * `ajandaYukariCoz` sonucu. `islem_id` yalnız şu halde vardır: çerçeve `gecersiz_mesaj`, ama zarfı
 * (`v`, `type:"islem"`, geçerli `islem_id`, başka alan yok) geçerli; yani yalnız işlemin gövdesi
 * şemadan geçmedi. Servis bu halde bağlantıyı kapatmaz, `islem_sonucu{islem_id, ok:false,
 * code:"gecersiz_islem"}` döner ve tekrarsızlık kaydına yazar: iki taraftaki doğrulama bir yerde
 * ayrışsa da tek işlem kuyruğu tıkayamaz, kullanıcının ret listesine düşer.
 */
export type AjandaYukariCozumu = CozumSonucu<AjandaSurumluYukari> & { islem_id?: string };

const kabulKumesi = (baglanti: AjandaSurumNo | undefined): readonly number[] =>
  baglanti === undefined ? AJANDA_SURUMLERI : [baglanti];

/**
 * `/ajanda` çözücüleri, sınır `AJANDA_AZAMI_CERCEVE.KANAL`. `baglanti`: bağlantının sabitlenmiş sürümü.
 * Verilirse yalnız o sürüm kabul edilir (başka sayı `v` `protokol_uyumsuz`); verilmezse (ilk yukarı
 * çerçeve, sürüm henüz sabitlenmedi) `AJANDA_SURUMLERI`'nden herhangi biri, sabitlenecek sürüm
 * `mesaj.v`'dir. Çerçeve her halde yalnız kendi sürümünün şemasıyla denetlenir.
 */
export function ajandaYukariCoz(ham: string, baglanti?: AjandaSurumNo): AjandaYukariCozumu {
  const sonuc = surumluCozumle<AjandaSurumluYukari>(ham, AJANDA_AZAMI_CERCEVE.KANAL, kabulKumesi(baglanti), (v) =>
    semalar(v as AjandaSurumNo).Yukari,
  );
  if (sonuc.ok || sonuc.kod !== "gecersiz_mesaj") return sonuc;
  let deger: unknown;
  try {
    deger = JSON.parse(ham);
  } catch {
    return sonuc;
  }
  // `gecersiz_mesaj` ile gelen sayı `v` kabul kümesindedir; değilse zarf zaten tutmaz.
  const v = typeof deger === "object" && deger !== null ? (deger as { v?: unknown }).v : undefined;
  const zarf = (ajandaSurumuMu(v) ? semalar(v) : YENI).IslemZarfi.safeParse(deger);
  return zarf.success ? { ...sonuc, islem_id: zarf.data.islem_id } : sonuc;
}
export const ajandaAsagiCoz = (ham: string, baglanti?: AjandaSurumNo): CozumSonucu<AjandaSurumluAsagi> =>
  surumluCozumle<AjandaSurumluAsagi>(ham, AJANDA_AZAMI_CERCEVE.KANAL, kabulKumesi(baglanti), (v) =>
    semalar(v as AjandaSurumNo).Asagi,
  );

// Sürüm uyumu (`docs/AJANDA.md` "Kanal akışı")

/** Nesneden verilen anahtarları atar; kalanların sırası korunur (uyarlanan baytlar öngörülebilir). */
function alanlariAt<T extends object>(o: T, atilan: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !atilan.has(k)));
}

const V3_ALAN_KUMESI: ReadonlySet<string> = new Set(AJANDA_V3_ALANLARI);

/**
 * Alan listesini (`elle_alanlar`, `korunan_alanlar`) eski sürümün kümesine süzer. Genişleme kuralı 1'in
 * bilinçli istisnasıdır: bu listeleri yalnız servis yazar, istemci hiç yazmaz (`guncelle` onları
 * taşımaz), bu yüzden eski sürüme süzülmüş liste geri yazılıp servisteki tam listeyi silemez. Kanonik
 * sıra korunur (eski küme yeninin önekidir).
 */
function alanListesiniSuz(l: readonly AjandaAlani[], kume: readonly string[]): AjandaAlani[] {
  return l.filter((a) => kume.includes(a));
}

/** v3 → v2: kayıttan, alan listelerinden ve geçmiş parçalarından v3 alanları; `welcome`'dan `yetenekler`. */
function v3tenV2ye(m: AjandaAsagi): Record<string, unknown> | null {
  const v2 = AJANDA_SURUM_ALANLARI[2];
  const kayit = (k: AjandaKaydi) => ({ ...alanlariAt(k, V3_ALAN_KUMESI), elle_alanlar: alanListesiniSuz(k.elle_alanlar, v2) });
  const girdi = (g: AjandaGecmisGirdisi) => {
    const yeni: Record<string, unknown> = { ...g, onceki: alanlariAt(g.onceki, V3_ALAN_KUMESI), sonraki: alanlariAt(g.sonraki, V3_ALAN_KUMESI) };
    if (g.korunan_alanlar !== undefined) yeni.korunan_alanlar = alanListesiniSuz(g.korunan_alanlar, v2);
    return yeni;
  };
  switch (m.type) {
    case "welcome":
      return alanlariAt(m, new Set(["yetenekler"]));
    case "kayit":
      return { ...m, kayit: kayit(m.kayit) };
    case "islem_sonucu":
      return m.korunan_alanlar === undefined ? m : { ...m, korunan_alanlar: alanListesiniSuz(m.korunan_alanlar, v2) };
    case "gecmis":
      return { ...m, girdiler: m.girdiler.map(girdi) };
    // v2'de karşılığı yok: ek yedeği yalnız v3 bağlantıda (`ek_yedegi` yeteneği de yalnız v3'te ilan edilir).
    case "ek_durum":
    case "ek_parca":
    case "ek_ret":
      return null;
    default:
      return m;
  }
}

/**
 * En yeni modelden sürümün çerçevesine: o sürümün bilmediği alanları ve kapalı liste öğelerini
 * çıkarır; o sürümde karşılığı olmayan çerçevede `null`. En yeni sürümde kimliktir; `v`'yi
 * `ajandaAsagiSurume` yazar. Ret nedeni ve kanal hata kodu kümeleri v2'den beri değişmedi (v3 yeni öğe
 * eklemez; ek çerçevelerinin kendi `ek_ret` kümesi vardır); yeni sürüm bu kümelere öğe eklerse onu
 * burada eski sürümün bir öğesine eşlemelidir, yoksa `islem_sonucu`/`gecmis` eski sürümün şemasından
 * geçmez ve kuyruk tıkanır (test: "her ret nedeni ve kanal hata kodu eski her sürüme uyarlanır").
 */
const ASAGI_UYARLAMALARI: { [V in AjandaSurumNo]: (m: AjandaAsagi) => Record<string, unknown> | null } = {
  2: v3tenV2ye,
  3: (m) => m,
};

/**
 * Servisin yollayacağı çerçeveyi bağlantı sürümüne uyarlar ve o sürümün şemasıyla denetler. Servis
 * içeride en yeni modelle (`AjandaAsagi`) çalışır; her aşağı çerçeve yollanmadan önce buradan geçer.
 * Başarıda `mesaj` uyarlanan nesnedir (alan sırası girdininki: kimlikte JSON baytları değişmez; eski
 * sürümde yalnız atılan alanlar eksilir). Girdi değişmez. `ok:false` servisin hatasıdır, çerçeve
 * yollanmaz; `yollar` değeri içermez. O sürümde karşılığı olmayan çerçeve (v2'de `ek_*`)
 * `protokol_uyumsuz` + `yollar:["type"]`: servis o çerçeveyi o bağlantıya hiç üretmemelidir.
 */
export function ajandaAsagiSurume(m: AjandaAsagi, v: AjandaSurumNo): CozumSonucu<AjandaSurumluAsagi> {
  if (!ajandaSurumuMu(v)) return { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] };
  const uyarlanan = ASAGI_UYARLAMALARI[v](m);
  if (uyarlanan === null) return { ok: false, kod: "protokol_uyumsuz", yollar: ["type"] };
  const aday = { ...uyarlanan, v };
  const denetim = semaylaDenetle(semalar(v).Asagi, aday);
  return denetim.ok ? { ok: true, mesaj: aday as AjandaSurumluAsagi } : denetim;
}

/**
 * `error` zarfı bütün sürümlerde dondurulmuştur: `{v, type:"error", code, detail?}`. İstemci kendi
 * kümesinde olmayan sürümün ret çerçevesini de bununla okur; `code` herhangi bir metindir (başka
 * sürümün kod kümesi), `detail` yalnız biçimce denetlenir. Üst sınır çerçeve sınırıdır.
 */
const AjandaDonmusHata = z.strictObject({
  v: z.number().int().min(1),
  type: z.literal("error"),
  code: z.string(),
  detail: z.string().optional(),
});
export type AjandaDonmusHata = { v: number; code: string; detail?: string };

/**
 * Dondurulmuş `error` zarfını sürüm kümesinden bağımsız okur: uyuyorsa `{v, code, detail?}`, değilse
 * (JSON değil, çok büyük, başka tür, `v` yok ya da 1'den küçük tam sayı değil, `code` metin değil, fazla
 * alan) `null`. Sürümü henüz sabitlenmemiş bağlantıda istemci başka bir sürümün `v`'siyle gelen hatayı
 * (`zaman_asimi`, `gecersiz_mesaj`, ...) geri düşüş değil o kodun kendisi olarak bununla okur; yalnız
 * `protokol_uyumsuz` geri düşüştür (`ajandaRetSurumuOku`). Vektör `ajanda-surum.json` `donmus_hata`.
 */
export function ajandaDonmusHataOku(ham: string): AjandaDonmusHata | null {
  if (ham.length > AJANDA_AZAMI_CERCEVE.KANAL) return null;
  let deger: unknown;
  try {
    deger = JSON.parse(ham);
  } catch {
    return null;
  }
  const zarf = AjandaDonmusHata.safeParse(deger);
  if (!zarf.success) return null;
  const { v, code, detail } = zarf.data;
  return detail === undefined ? { v, code } : { v, code, detail };
}

/**
 * Ret sürümü: ham çerçeve dondurulmuş `error` zarfına uyuyor (`ajandaDonmusHataOku`) ve `code`
 * `protokol_uyumsuz` ise `v`'si (servisin en yüksek sürümü); değilse `null`. Sürüm kümesinden
 * bağımsızdır. Vektör `ajanda-surum.json` `ret_surumu`.
 */
export function ajandaRetSurumuOku(ham: string): number | null {
  const hata = ajandaDonmusHataOku(ham);
  return hata !== null && hata.code === "protokol_uyumsuz" ? hata.v : null;
}

/** `protokol_uyumsuz` sonrası istemcinin kararı: bir alt sürümle yeniden dene ya da uyuşmazlığın yönü. */
export type AjandaGeriDususu =
  | { karar: "yeniden_dene"; surum: number }
  | { karar: "uygulama_eski" }
  | { karar: "servis_eski" }
  | { karar: "bilinmiyor" };

/**
 * İstemcinin geri düşüş kuralı (uygulama aynısını uygular; vektör `ajanda-surum.json` `geri_dusus`).
 * `denenen`: bağlantının açıldığı sürüm. `ret`: ret çerçevesinden `ajandaRetSurumuOku` ile okunan
 * sürüm; çerçeve yok ya da okunamadıysa (yalnız kapanış 1002) `null`. `kume`: istemcinin sürümleri.
 * - `ret` okunduysa: kümede ve denenenden küçükse onunla yeniden; kümenin en büyüğünden büyükse
 *   uygulama eski; en küçüğünden küçükse servis eski; başka hal (denenenle aynı ya da büyük) bilinmiyor.
 * - `null`: kümede denenenden küçük en büyük sürümle yeniden; yoksa bilinmiyor.
 * Her yeniden deneme denenenden kesin küçüktür: zincir kümenin boyundan kısa biter. İlk bağlantı
 * kümenin en büyüğüyle açılır; düşülen sürüm süreç boyunca tutulur (çağıranın işi).
 */
export function ajandaGeriDusus(
  denenen: number,
  ret: number | null,
  kume: readonly number[] = AJANDA_SURUMLERI,
): AjandaGeriDususu {
  if (kume.length === 0) return { karar: "bilinmiyor" };
  if (ret === null) {
    const alt = kume.filter((s) => s < denenen);
    return alt.length > 0 ? { karar: "yeniden_dene", surum: Math.max(...alt) } : { karar: "bilinmiyor" };
  }
  if (ret < denenen && kume.includes(ret)) return { karar: "yeniden_dene", surum: ret };
  if (ret > Math.max(...kume)) return { karar: "uygulama_eski" };
  if (ret < Math.min(...kume)) return { karar: "servis_eski" };
  return { karar: "bilinmiyor" };
}

// Saf yardımcılar (servis ve uygulama aynı sonucu versin)

/** `ajandaDegisikligiUygula` girdisi: kablo `AjandaDegisiklik`'i ve araç değişikliğinin ortak üst kümesi. */
export type AjandaAlanDegisikligi = {
  tur?: KayitTuru | undefined;
  baslik?: string | undefined;
  aciklama?: string | null | undefined;
  zaman?: AjandaZamani | null | undefined;
  hatirlatmalar?: Hatirlatma[] | undefined;
  tekrar?: Tekrar | null | undefined;
  durum?: KayitDurumu | undefined;
  // v3
  simge?: string | null | undefined;
  bolge?: string | null | undefined;
  bolge_konumu?: AjandaBolgeKonumu | null | undefined;
  varis?: AjandaVaris | null | undefined;
  baglantilar?: AjandaBaglanti[] | null | undefined;
  ekler?: AjandaEki[] | null | undefined;
};

export type AjandaBirlesimi = {
  /** Yeni hal; `revizyon`, `guncelleme_ms` çağıranındır. Şemadan geçirilmemiştir. */
  kayit: AjandaKaydi;
  /** Değişen alanlar, kanonik sırada (bölge yüzünden düşen `bolge_konumu` dahil). */
  uygulanan: AjandaAlani[];
  korunan: AjandaAlani[];
  /** Tekrar kalktığı, çapa ya da kural değiştiği için atılan örnek satırları (geçmişe `ornekler` olarak yazılır). */
  budanan_ornekler: AjandaKaydi["ornekler"];
};

/**
 * Seriye artık ait olmayan örnek satırlarını atar: tekrar yoksa hepsi; zamanın günü yoksa (tekrar
 * zaten tutarsız) dokunmaz; değilse çapadan önceki ve serinin günü olmayanlar.
 */
function ornekleriBuda(k: AjandaKaydi): { kalan: AjandaKaydi["ornekler"]; budanan: AjandaKaydi["ornekler"] } {
  if (k.tekrar === undefined) return { kalan: [], budanan: [...k.ornekler] };
  if (k.zaman === undefined || !("tarih" in k.zaman)) return { kalan: [...k.ornekler], budanan: [] };
  const capa = k.zaman.tarih;
  const tekrar = k.tekrar;
  const kalan = k.ornekler.filter((o) => ornekGunuMu(capa, tekrar, o.tarih));
  return { kalan, budanan: k.ornekler.filter((o) => !kalan.includes(o)) };
}

/** Asistan aracı yolları: insan turundaki çağrıları kullanıcının kendi emridir. */
export const ARAC_YOLLARI = ["sohbet_araci", "pc_araci"] as const satisfies readonly KaynakYolu[];

/**
 * Değişiklik kullanıcının emri mi: insan yolu (`elle`, `sesli_not`) ya da insan turundaki araç
 * çağrısı. Sentetik turdaki araç çağrısı ve arka plan çıkarımı (insan mesajından da olsa) emir değildir.
 */
export function kullaniciEmriMi(yazar: { yol: KaynakYolu; tur_kokeni: TurKokeni }): boolean {
  if (!otomasyonMu(yazar.yol)) return true;
  return (ARAC_YOLLARI as readonly string[]).includes(yazar.yol) && yazar.tur_kokeni === "insan";
}

/**
 * Alan düzeyinde birleştirme. Değeri aynı olan alan atlanır. Emir olmayan değişiklikte
 * (`kullaniciEmriMi` yanlış) `elle_alanlar`'daki alan değişmez, `korunan`'a girer. Emir olan
 * değişiklikte (uygulamadan elle ya da insan turundaki araç çağrısı) her alan uygulanır ve uygulanan
 * alanlar `elle_alanlar`'a eklenir: kullanıcının açıkça istediği değer de sonraki otomasyona karşı
 * korunur. `tekrar` ya da `zaman` uygulanınca seriye ait olmayan örnek satırları budanır (tekrar
 * kaldırılabilir, çapa ileri alınabilir). Zaman (gün, gün bölümü, kesinlik) değişince hatırlatma
 * listesine dokunulmaz: `once` kaydın o anki zamanından hesaplanır (`hatirlatmaHalleri`), gün değişince
 * gün hatırlatması yeni güne gider, saat gelince saatli kurala geçer.
 *
 * Bölge ve konum (v3): `bolge` başka bir yere (`ajandaBolgeYeriDegisirMi`: eşleşme anahtarı farklı) değişir
 * ya da kaldırılırsa ve aynı değişiklikte `bolge_konumu` verilmediyse konum da kalkar (`uygulanan`'a girer:
 * geçmişe yazılır, emirde `elle_alanlar`'a eklenir). Yalnız yazılışı değişen ad (büyük/küçük harf, boşluk)
 * aynı yerdir, konum kalır. Emir olmayan otomasyonda `bolge_konumu` korunuyorsa (`elle_alanlar`) ve kayıtta
 * konum varsa, konumu düşürecek `bolge` değişikliği de korunur: kullanıcının koyduğu konum otomasyonla
 * kaybolmaz. `varis` bölgeye bağlıdır ama kendiliğinden kalkmaz: `bolge` kaldırılıp `varis` bırakılırsa
 * sonuç `tutarsiz_kayit`'tır.
 *
 * Silinmiş kayıt, sentetik tur ve revizyon kararları çağıranındır; sonuç `AjandaKaydi` ile doğrulanmalıdır.
 * Vektörler: `ajanda-kurallar.json` `birlestirme`, `ajanda-v3.json` `bolge_konumu`.
 */
export function ajandaDegisikligiUygula(
  kayit: AjandaKaydi,
  degisiklik: AjandaAlanDegisikligi,
  yazar: { yol: KaynakYolu; tur_kokeni: TurKokeni },
): AjandaBirlesimi {
  const otomasyon = !kullaniciEmriMi(yazar);
  const yeni: Record<string, unknown> = { ...kayit };
  const uygulanan: AjandaAlani[] = [];
  const korunan: AjandaAlani[] = [];
  const konumKorunur = otomasyon && kayit.bolge_konumu !== undefined && kayit.elle_alanlar.includes("bolge_konumu");
  for (const alan of AJANDA_ALANLARI) {
    const deger = degisiklik[alan];
    if (deger === undefined) continue;
    const simdiki = kayit[alan];
    const ayni = deger === null ? simdiki === undefined : simdiki !== undefined && kanonikJson(deger) === kanonikJson(simdiki);
    if (ayni) continue;
    const konumuDusurur = alan === "bolge" && ajandaBolgeYeriDegisirMi(kayit.bolge, deger === null ? undefined : (deger as string));
    if (otomasyon && (kayit.elle_alanlar.includes(alan) || (konumuDusurur && konumKorunur))) {
      korunan.push(alan);
      continue;
    }
    if (deger === null) delete yeni[alan];
    else yeni[alan] = deger;
    uygulanan.push(alan);
  }
  if (
    uygulanan.includes("bolge") &&
    degisiklik.bolge_konumu === undefined &&
    yeni.bolge_konumu !== undefined &&
    ajandaBolgeYeriDegisirMi(kayit.bolge, yeni.bolge as string | undefined)
  ) {
    delete yeni.bolge_konumu;
    uygulanan.push("bolge_konumu");
  }
  uygulanan.sort((a, b) => AJANDA_ALANLARI.indexOf(a) - AJANDA_ALANLARI.indexOf(b));
  const elle_alanlar = otomasyon
    ? [...kayit.elle_alanlar]
    : AJANDA_ALANLARI.filter((a) => kayit.elle_alanlar.includes(a) || uygulanan.includes(a));
  let sonuc: AjandaKaydi = { ...(yeni as AjandaKaydi), elle_alanlar };
  let budanan_ornekler: AjandaKaydi["ornekler"] = [];
  if ((uygulanan.includes("tekrar") || uygulanan.includes("zaman")) && sonuc.ornekler.length > 0) {
    const b = ornekleriBuda(sonuc);
    sonuc = { ...sonuc, ornekler: b.kalan };
    budanan_ornekler = b.budanan;
  }
  return { kayit: sonuc, uygulanan, korunan, budanan_ornekler };
}

/**
 * Otomatik eklemenin tekilleştirme anahtarı: aynı kapsamda (ör. `sohbet:<id>`) aynı tür, birebir aynı
 * başlık ve aynı çözülmüş zaman (`zamanCekirdegi`: `ifade` ve `sure_dk` girmez, `gun_bolumu` girer,
 * hatırlatma girmez) aynı anahtarı verir;
 * "yarın 3'te" ile "bugün 3'te" aynı güne çözüldüyse aynı kayıttır. Girdi saklanacak haldir: servis
 * dilimi doldurduktan sonra hesaplar (`AjandaZamani`, dilim zorunlu). Anahtar kayıt doğarken
 * `kaynak.tekil_anahtar`'a yazılır, sonra değişmez; eşler aynı anahtarı saklayan kayıtlardır.
 * `"t1:" + sha256(kanonik JSON {kapsam, tur, baslik, zaman: çekirdek | null[, bolge]})`. v3: `bolge`
 * yalnız verilmişse, eşleşme anahtarıyla (`ajandaBolgeAnahtari`) girer; yoksa baytlar v2 ile aynıdır.
 * Öteki v3 alanları girmez. Eşin eklemeyi engelleyip engellemediği `ajandaTekilKarari`'dır. Anahtar
 * tekil indeks değildir.
 */
export function ajandaTekilAnahtari(girdi: {
  kapsam: string;
  tur: KayitTuru;
  baslik: string;
  zaman?: AjandaZamani | undefined;
  bolge?: string | undefined;
}): string {
  const zaman = girdi.zaman === undefined ? null : zamanCekirdegi(girdi.zaman);
  const govde: Record<string, unknown> = { kapsam: girdi.kapsam, tur: girdi.tur, baslik: girdi.baslik, zaman };
  if (girdi.bolge !== undefined) govde.bolge = ajandaBolgeAnahtari(girdi.bolge);
  return "t1:" + sha256Hex(utf8Bayt(kanonikJson(govde)));
}

/**
 * Kullanıcının emriyle (`kullaniciEmriMi`) gelen eklemenin açık bir eşi varsa (`ajandaTekilKarari`:
 * `onayla` ya da `zaten_var`) kullanıcının bu turda söylediği ve eşte farklı olan alanlar: yeni kayıt
 * açılmaz ama söylenen kayda yansır. Girdi saklanacak haldir (dilim doldurulmuş) ve yalnız açıkça
 * verilen alanları taşır; varsayılan hatırlatma eşe uygulanmaz.
 * - `aciklama`, `hatirlatmalar`: verilmişse.
 * - `zaman`: anahtar aynı olduğu için gün ve saat aynıdır; yalnız yeni bir `sure_dk` eşin zamanına
 *   işlenir. Eşin `ifade`'si (kaydı doğuran söz) korunur.
 * Servis sonucu `ajandaDegisikligiUygula(es, degisiklik, yazar)` ile uygular (boşsa değişiklik yok);
 * eş taslaksa aynı işlemde onaylar. Emir olmayan otomasyonda çağrılmaz: eş olduğu gibi kalır.
 * Asistan aracının eş yolu bunu `ajandaAracEsBirlesimi` içinden kullanır (v3 alanları, varsayılan
 * hatırlatma ve başka bağlamın taslağı orada); bu işlevin sonucu ve vektörü (`es_degisikligi`) değişmedi.
 */
export function ajandaEsDegisikligi(
  es: Pick<AjandaKaydi, "zaman">,
  girdi: { aciklama?: string | undefined; zaman?: AjandaZamani | undefined; hatirlatmalar?: Hatirlatma[] | undefined },
): AjandaAlanDegisikligi {
  const degisiklik: AjandaAlanDegisikligi = {};
  if (girdi.aciklama !== undefined) degisiklik.aciklama = girdi.aciklama;
  if (girdi.hatirlatmalar !== undefined) degisiklik.hatirlatmalar = girdi.hatirlatmalar;
  const z = es.zaman;
  const sure = girdi.zaman?.kesinlik === "an" ? girdi.zaman.sure_dk : undefined;
  if (z?.kesinlik === "an" && sure !== undefined && sure !== z.sure_dk) degisiklik.zaman = { ...z, sure_dk: sure };
  return degisiklik;
}

/**
 * Asistan aracıyla (`ajanda_ekle`) doğan kaydın varsayılan hatırlatması: araç `hatirlatmalar` vermediyse
 * kurulan liste. Varsayılan kaydın ZAMANINA göredir, varışın varlığına göre değil:
 * - varışsız kayıt: olağan varsayılan (`AJANDA_VARSAYILAN_HATIRLATMALAR`, zaman kesinliği ne olursa olsun);
 * - varışlı, takvime oturan tek seferlik kayıt (`an`, `gun`, `donem`): yine olağan varsayılan, varış ona
 *   eklenir ("1'de iş yerinde olmak lazım": önceden bildirim de, bölgeye girişte hatırlatma da);
 * - varışlı ama zamansız (zaman yok ya da `belirsiz`: "markete gidince süt al") ya da tekrar eden kayıt
 *   ("her iş günü imza"): `[]`, bildirim yalnız varıştan gelir (yoksa her örnek günü zaman bildirimi gelirdi).
 * Kullanıcı açıkça hatırlatma istemezse model `[]` verir; verilen liste her zaman olduğu gibi yazılır.
 */
export function ajandaAracVarsayilanHatirlatmalari(k: {
  zaman?: AjandaZamani | undefined;
  tekrar?: Tekrar | undefined;
  varis?: AjandaVaris | undefined;
}): Hatirlatma[] {
  const yalnizVaris = k.varis !== undefined && (k.tekrar !== undefined || k.zaman === undefined || k.zaman.kesinlik === "belirsiz");
  return yalnizVaris ? [] : AJANDA_VARSAYILAN_HATIRLATMALAR.map((h) => ({ ...h }));
}

/** Yazar ve kaynak izinin bağlam alanları (`AjandaYazar`, `AjandaKaynagi` ikisi de uyar). */
type BaglamIzi = { yol: KaynakYolu; tur_kokeni: TurKokeni; sohbet_id?: string | undefined; oturum_id?: string | undefined };

/**
 * Eş taslak başka bir konuşma bağlamının otomasyonundan mı (`ajandaAracEsBirlesimi`). Doğru yalnız:
 * eş taslaksa, taslağı doğuran (`kaynak`) kullanıcı emri değilse (sentetik tur, arka plan) ve kaynağın
 * bağlamı yazarınkinden farklıysa. Bağlam yazarın kendi kimliğidir: PC'de `oturum_id` (Claude Code
 * oturumu; aynı oturumdaki ana ajan ile kendi alt agent'ı aynı bağlamdır), telefon sohbetinde
 * `sohbet_id`. Telefonun tekil kapsamı sohbettir (`sohbet:<id>`): aynı anahtarlı eş aynı sohbettendir,
 * sonuç orada hep yanlıştır (davranış değişmez). Kimliği olmayan yazar (uygulama) için yanlış.
 * Vakalar: `test/ajanda-es-taslak.test.ts`.
 */
export function ajandaEsBaskaBaglamdanMi(es: { taslak: boolean; kaynak: BaglamIzi }, yazar: BaglamIzi): boolean {
  if (!es.taslak || kullaniciEmriMi(es.kaynak)) return false;
  if (yazar.oturum_id !== undefined) return es.kaynak.oturum_id !== yazar.oturum_id;
  if (yazar.sohbet_id !== undefined) return es.kaynak.sohbet_id !== yazar.sohbet_id;
  return false;
}

/**
 * Asistan aracının eklemede verdiği alanlar, saklanacak halde (dilim doldurulmuş, tekrar kablo biçiminde:
 * `ajandaAracTekrari`). `durum` yoktur (araçla doğan kayıt açıktır).
 */
export type AjandaAracEsGirdisi = {
  tur: KayitTuru;
  baslik: string;
  aciklama?: string | undefined;
  zaman?: AjandaZamani | undefined;
  hatirlatmalar?: Hatirlatma[] | undefined;
  tekrar?: Tekrar | undefined;
  simge?: string | undefined;
  bolge?: string | undefined;
  varis?: AjandaVaris | undefined;
  baglantilar?: AjandaBaglanti[] | undefined;
};

export type AjandaAracEsBirlesimi = AjandaBirlesimi & {
  /** Kullanıcının bu çağrıda söylediği ve eşte değişen alanlar, kanonik sırada (çıktının `uygulanan_alanlar`'ı). */
  soylenen: AjandaAlani[];
  /** Başka bağlamın taslağından taşınmayan alanlar, kanonik sırada: kalktı ya da (`hatirlatmalar`) varsayılana döndü. */
  tasinmayan: AjandaAlani[];
  /** `ajandaEsBaskaBaglamdanMi`. */
  baska_baglam: boolean;
};

/** Değişiklik uygulanınca alanın alacağı değer (`null` kaldırır, verilmeyen kalır). */
function sonrakiDeger<A extends "zaman" | "tekrar" | "varis">(es: AjandaKaydi, d: AjandaAlanDegisikligi, alan: A): AjandaKaydi[A] {
  const v = d[alan];
  return (v === undefined ? es[alan] : v === null ? undefined : v) as AjandaKaydi[A];
}

const kanonikSirada = (l: readonly AjandaAlani[]): AjandaAlani[] => AJANDA_ALANLARI.filter((a) => l.includes(a));

/**
 * Kullanıcı emriyle gelen eklemenin açık eşe (`ajandaTekilKarari`: `onayla` ya da `zaten_var`) birleşmesi,
 * asistan aracı yolunda. Sonuç `ajandaDegisikligiUygula`'nınkidir (`kayit`, `uygulanan`, `korunan`,
 * `budanan_ornekler`); çağıran onayda `taslak:false` yapar ve geçmişi `fark` ile yazar. Yalnız emirde çağrılır.
 *
 * - Olağan eş (taslak olmayan ya da aynı bağlamın taslağı): `ajandaEsDegisikligi` (verilen `aciklama`,
 *   `hatirlatmalar`, yeni `sure_dk`) ve verilen `simge`, `varis`, `tekrar`, `baglantilar` eşe işlenir; eşin
 *   öteki alanları kalır (aynı sohbette onay taslağın alanlarını taşır; telefon yolu bugünkü gibi).
 * - Başka bağlamın taslağı (`ajandaEsBaskaBaglamdanMi`): insanın bu çağrıda vermediği alan taşınmaz. Sonuç
 *   kayıt, insanın çağrısı tek başına ne doğuracaksa odur: verilen her alan verilen değeri alır (`zaman`
 *   kullanıcının `ifade`'siyle, `bolge` onun yazılışıyla), verilmeyen alan kalkar, `hatirlatmalar` verilmediyse
 *   varsayılana (`ajandaAracVarsayilanHatirlatmalari`) döner; `elle_alanlar` doğan kaydınkidir (verilen
 *   alanlar). İstisna: eşin `elle_alanlar`'ındaki alan (bir kullanıcı emri ya da uygulama koymuştur) kalır.
 *   Kimlik, kaynak izi, oluşturma anı ve geçmiş korunur; taşınmayanlar geçmiş satırında öncesiyle ve
 *   sonrasıyla (kalkan alan `null`) görünür.
 * - Varsayılan hatırlatma iki yolda da tutarlıdır: `hatirlatmalar` verilmediyse ve eşin `elle_alanlar`'ında
 *   değilse, eşin listesi kendi hali için varsayılansa (başka bağlamda her zaman) birleşmiş halin varsayılanına
 *   geçer (ör. tarihli eşe varış ve tekrar işlenince `[]`). Varsayılan `elle_alanlar`'a ve `soylenen`'e girmez.
 */
export function ajandaAracEsBirlesimi(es: AjandaKaydi, girdi: AjandaAracEsGirdisi, yazar: BaglamIzi): AjandaAracEsBirlesimi {
  const baska_baglam = ajandaEsBaskaBaglamdanMi(es, yazar);
  const verilen = girdi as Partial<Record<AjandaAlani, unknown>>;
  const d: Record<string, unknown> = {};
  const tasinmayan: AjandaAlani[] = [];
  if (!baska_baglam) {
    Object.assign(d, ajandaEsDegisikligi(es, girdi));
    for (const alan of ["simge", "varis", "tekrar", "baglantilar"] as const) if (verilen[alan] !== undefined) d[alan] = verilen[alan];
  } else {
    for (const alan of AJANDA_ALANLARI) {
      if (alan === "durum" || alan === "hatirlatmalar") continue;
      if (verilen[alan] !== undefined) d[alan] = verilen[alan];
      else if (es[alan] !== undefined && !es.elle_alanlar.includes(alan)) {
        d[alan] = null;
        tasinmayan.push(alan);
      }
    }
    if (girdi.hatirlatmalar !== undefined) d.hatirlatmalar = girdi.hatirlatmalar;
  }
  const degisiklik = d as AjandaAlanDegisikligi;
  let varsayilan = false;
  if (girdi.hatirlatmalar === undefined && !es.elle_alanlar.includes("hatirlatmalar")) {
    const esVarsayilani = kanonikJson(es.hatirlatmalar) === kanonikJson(ajandaAracVarsayilanHatirlatmalari(es));
    const hedef = ajandaAracVarsayilanHatirlatmalari({
      zaman: sonrakiDeger(es, degisiklik, "zaman"),
      tekrar: sonrakiDeger(es, degisiklik, "tekrar"),
      varis: sonrakiDeger(es, degisiklik, "varis"),
    });
    if ((baska_baglam || esVarsayilani) && kanonikJson(hedef) !== kanonikJson(es.hatirlatmalar)) {
      degisiklik.hatirlatmalar = hedef;
      varsayilan = true;
      if (baska_baglam) tasinmayan.push("hatirlatmalar");
    }
  }
  const bir = ajandaDegisikligiUygula(es, degisiklik, yazar);
  const elle_alanlar = baska_baglam
    ? AJANDA_ALANLARI.filter((a) => es.elle_alanlar.includes(a) || (a !== "durum" && verilen[a] !== undefined))
    : bir.kayit.elle_alanlar.filter((a) => a !== "hatirlatmalar" || !varsayilan || es.elle_alanlar.includes(a));
  return {
    ...bir,
    kayit: { ...bir.kayit, elle_alanlar },
    soylenen: bir.uygulanan.filter((a) => !tasinmayan.includes(a) && !(varsayilan && a === "hatirlatmalar")),
    tasinmayan: kanonikSirada(tasinmayan).filter((a) => bir.uygulanan.includes(a)),
    baska_baglam,
  };
}
