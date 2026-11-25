import { z } from "zod";
import {
  AjandaAciklama,
  AjandaAlani,
  AjandaAlinti,
  AjandaBaslik,
  AjandaKaydi,
  AjandaRetNedeni,
  KayitDurumu,
  KayitId,
  KayitTuru,
  Revizyon,
} from "./ajanda.ts";
import {
  AjandaZamani,
  AjandaZamaniGirdisi,
  ajandaSatiri,
  HatirlatmaGirdileri,
  Saat,
  SaatDilimi,
  Tarih,
  zamanKurallari,
} from "./ajanda-zaman.ts";
import { cozumle } from "./cozumle.ts";
import { KopruIptal, KopruRet, KopruYanit } from "./kopru.ts";
import { AJANDA_AZAMI_CERCEVE, AJANDA_SINIRLARI, PROTOKOL_SURUMU } from "./sinirlar.ts";
import { Jeton, mesaj, OpakId } from "./temel.ts";

/**
 * Ajanda araçları ve ajanda borusu. Mevcut boru (`KOPRU_BORU_ADI`, `ROL_FIILLERI`) değişmez: ajanda
 * kendi borusunda, kendi rolüyle konuşur; çerçeve biçimi ve zarf (`kopru_hello`, `istek`, `iptal`,
 * `kopru_welcome`, `kopru_ret`, `yanit`) aynıdır, `v` = `PROTOKOL_SURUMU`.
 *
 * Kaynak izi (yol, sohbet, tur kökeni) araç girdisinde YOKTUR: servis jetonun kapsamından ve çağrı
 * anındaki turun kökeninden kurar. Model kaydı insan kökenli ya da kesin (taslak değil) ilan edemez.
 */

export const AJANDA_BORU_ADI = "\\\\.\\pipe\\eren-ajanda";

/**
 * `ana_oturum`: telefondaki bir sohbetin ana oturumu (jeton kapsamı `sohbet_id` + nesil; kaynak
 * `sohbet_araci`). Sonraki dilimin PC oturumu rolü (`pc_araci`) buraya eklenecek.
 */
export const AJANDA_KOPRU_ROLLERI = ["ana_oturum"] as const;
export const AjandaKopruRolu = z.enum(AJANDA_KOPRU_ROLLERI);
export type AjandaKopruRolu = z.infer<typeof AjandaKopruRolu>;

export const AJANDA_ROL_FIILLERI = {
  ana_oturum: ["ajanda_ekle", "ajanda_guncelle", "ajanda_listele"],
} as const;
export type AjandaFiili = (typeof AJANDA_ROL_FIILLERI)[AjandaKopruRolu][number];
export const AJANDA_FIILLERI: readonly AjandaFiili[] = [...AJANDA_ROL_FIILLERI.ana_oturum];

export function ajandaFiilRoldeIzinliMi(rol: AjandaKopruRolu, fiil: string): boolean {
  return (AJANDA_ROL_FIILLERI[rol] as readonly string[]).includes(fiil);
}

// Girdi ve çıktılar

const ZAMAN_ACIKLAMASI =
  "Kullanıcının söylediği zaman. Söylenmeyeni uydurma: saat yoksa kesinlik gun, gün aralığıysa donem, " +
  "takvime oturmuyorsa belirsiz. ifade alanına kullanıcının sözünü birebir yaz. saat_dilimi verilmezse " +
  "kullanıcınınki kullanılır.";
const HATIRLATMA_ACIKLAMASI =
  "Verilmezse ve zaman kesinliği an ise varsayılan (1 saat önce) kurulur; [] hiç kurmaz. once yalnız " +
  "kesinlik an iken.";
const ALINTI_ACIKLAMASI = "Kaydı doğuran kullanıcı sözünden kısa, birebir parça (isteğe bağlı).";

/** Model kayıt kimliği, kaynak, taslak ya da tekrar veremez (tekrar sonraki dilimde). */
export const AjandaEkleGirdi = z
  .strictObject({
    tur: KayitTuru.describe("gorev: yapılacak iş; randevu: belirli zamandaki buluşma; not: önemli bilgi."),
    baslik: AjandaBaslik.describe("Kısa, tek satır."),
    aciklama: AjandaAciklama.optional(),
    zaman: AjandaZamaniGirdisi.optional().describe(ZAMAN_ACIKLAMASI),
    hatirlatmalar: HatirlatmaGirdileri.optional().describe(HATIRLATMA_ACIKLAMASI),
    alinti: AjandaAlinti.optional().describe(ALINTI_ACIKLAMASI),
  })
  .superRefine(zamanKurallari);
export type AjandaEkleGirdi = z.infer<typeof AjandaEkleGirdi>;

/**
 * - `eklendi`: `taslak` doğruysa tur insan kökenli değildi, hatırlatma kullanıcı onaylayınca kurulur.
 *   `zaman` servisin sakladığı (saat dilimi doldurulmuş) haldir.
 * - `zaten_var`: aynı tekilleştirme anahtarlı silinmemiş kayıt var; yeni kayıt yok.
 */
export const AjandaEkleCikti = z.discriminatedUnion("sonuc", [
  z.strictObject({
    sonuc: z.literal("eklendi"),
    kayit_id: KayitId,
    revizyon: Revizyon,
    taslak: z.boolean(),
    zaman: AjandaZamani.optional(),
    hatirlatma_sayisi: z.number().int().min(0).max(AJANDA_SINIRLARI.HATIRLATMA_ADET),
  }),
  z.strictObject({ sonuc: z.literal("zaten_var"), kayit_id: KayitId }),
  z.strictObject({ sonuc: z.literal("ret"), neden: AjandaRetNedeni }),
]);
export type AjandaEkleCikti = z.infer<typeof AjandaEkleCikti>;

/** `null` alanı kaldırır. `durum` modelin tek durum yoludur (silme yoktur). */
export const AjandaAracDegisikligi = z
  .strictObject({
    tur: KayitTuru.optional(),
    baslik: AjandaBaslik.optional(),
    aciklama: AjandaAciklama.nullable().optional(),
    zaman: AjandaZamaniGirdisi.nullable().optional().describe(ZAMAN_ACIKLAMASI),
    hatirlatmalar: HatirlatmaGirdileri.optional(),
    durum: KayitDurumu.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: "boş değişiklik" });

export const AjandaGuncelleGirdi = z.strictObject({ kayit_id: KayitId, degisiklik: AjandaAracDegisikligi });
export type AjandaGuncelleGirdi = z.infer<typeof AjandaGuncelleGirdi>;

/**
 * `korunan_alanlar`: kullanıcının emriyle konmuş (`elle_alanlar`), bu çağrı emir olmadığı için
 * (tur insan mesajıyla başlamadı) uygulanmayan alanlar. İnsan turunda hep boştur.
 * `degismedi`: uygulanacak bir şey kalmadı (aynı değer ya da hepsi korunuyor).
 */
export const AjandaGuncelleCikti = z.discriminatedUnion("sonuc", [
  z.strictObject({
    sonuc: z.literal("guncellendi"),
    kayit_id: KayitId,
    revizyon: Revizyon,
    korunan_alanlar: z.array(AjandaAlani),
  }),
  z.strictObject({ sonuc: z.literal("degismedi"), kayit_id: KayitId, korunan_alanlar: z.array(AjandaAlani) }),
  z.strictObject({ sonuc: z.literal("ret"), neden: AjandaRetNedeni }),
]);
export type AjandaGuncelleCikti = z.infer<typeof AjandaGuncelleCikti>;

/**
 * Silinmiş kayıt hiç listelenmez. Tarih süzgeci verilirse yalnız tarihi aralığa değen kayıtlar
 * (`an`/`gun`: tarihi; `donem`: aralığı); tarihsiz ve `belirsiz` kayıtlar yalnız süzgeç yokken.
 * `durumlar` verilmezse `["acik"]`. `ara`: başlık ve açıklamada büyük/küçük harf duyarsız alt dize.
 * Sıra: tarihliler tarih ve saate göre artan, sonra tarihsizler oluşturma sırasıyla.
 */
export const AjandaListeleGirdi = z
  .strictObject({
    baslangic: Tarih.optional(),
    bitis: Tarih.optional(),
    turler: z.array(KayitTuru).min(1).max(3).optional(),
    durumlar: z.array(KayitDurumu).min(1).max(3).optional(),
    ara: ajandaSatiri(1, AJANDA_SINIRLARI.ARAMA).optional(),
    en_fazla: z.number().int().min(1).max(AJANDA_SINIRLARI.LISTE_ADET).optional(),
  })
  .refine((g) => g.baslangic === undefined || g.bitis === undefined || g.baslangic <= g.bitis, {
    message: "bitis baslangictan önce",
    path: ["bitis"],
  });
export type AjandaListeleGirdi = z.infer<typeof AjandaListeleGirdi>;

/** `simdi`: kullanıcının yerel günü ve saati (göreli tarihleri çözmek için). `toplam`: süzgece uyan. */
export const AjandaListeleCikti = z
  .strictObject({
    simdi: z.strictObject({ tarih: Tarih, saat: Saat, saat_dilimi: SaatDilimi }),
    kayitlar: z.array(AjandaKaydi).max(AJANDA_SINIRLARI.LISTE_ADET),
    toplam: z.number().int().min(0),
  })
  .refine((c) => c.toplam >= c.kayitlar.length, { message: "toplam gösterilenden az" })
  .refine((c) => c.kayitlar.every((k) => !k.silindi), { message: "silinmiş kayıt listelenmez" });
export type AjandaListeleCikti = z.infer<typeof AjandaListeleCikti>;

/** Fiil başına boru girdi ve çıktı şemaları; köprü MCP girdisini `jsonSemasi(girdi)` ile yayınlar. */
export const AJANDA_ARACLARI = {
  ajanda_ekle: { girdi: AjandaEkleGirdi, cikti: AjandaEkleCikti },
  ajanda_guncelle: { girdi: AjandaGuncelleGirdi, cikti: AjandaGuncelleCikti },
  ajanda_listele: { girdi: AjandaListeleGirdi, cikti: AjandaListeleCikti },
} as const;

// Ajanda borusu

function istek<F extends AjandaFiili, G extends z.ZodType>(fiil: F, girdi: G) {
  return mesaj("istek", { istek_id: OpakId, fiil: z.literal(fiil), girdi });
}

export const AjandaKopruIstek = z.discriminatedUnion("fiil", [
  istek("ajanda_ekle", AjandaEkleGirdi),
  istek("ajanda_guncelle", AjandaGuncelleGirdi),
  istek("ajanda_listele", AjandaListeleGirdi),
]);
export type AjandaKopruIstek = z.infer<typeof AjandaKopruIstek>;

/** İlk mesaj. Rol, sohbet ve nesil yalnız jetondan türer. */
export const AjandaKopruHello = mesaj("kopru_hello", { rol: AjandaKopruRolu, jeton: Jeton });
export const AjandaKopruWelcome = mesaj("kopru_welcome", { rol: AjandaKopruRolu });

export const AjandaKopruYukari = z.discriminatedUnion("type", [AjandaKopruHello, AjandaKopruIstek, KopruIptal]);
export type AjandaKopruYukari = z.infer<typeof AjandaKopruYukari>;
/** `yanit.sonuc`, `AJANDA_ARACLARI[fiil].cikti` ile doğrulanır; boru hataları `HataKodu` (`kopru_ret`, `yanit.code`). */
export const AjandaKopruAsagi = z.discriminatedUnion("type", [AjandaKopruWelcome, KopruRet, KopruYanit]);
export type AjandaKopruAsagi = z.infer<typeof AjandaKopruAsagi>;

export const ajandaKopruYukariCoz = (ham: string) =>
  cozumle(AjandaKopruYukari, ham, AJANDA_AZAMI_CERCEVE.BORU, PROTOKOL_SURUMU);
export const ajandaKopruAsagiCoz = (ham: string) =>
  cozumle(AjandaKopruAsagi, ham, AJANDA_AZAMI_CERCEVE.BORU, PROTOKOL_SURUMU);
