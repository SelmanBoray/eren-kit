import { z } from "zod";
import { iyiBicimliMi } from "./kanonik.ts";
import { PROTOKOL_SURUMU, SINIRLAR, SOHBET_SURUMU } from "./sinirlar.ts";

// Node ve Hermes aynı doğrulama yolundan geçsin, çalışma anında kod üretilmesin.
z.config({ jitless: true });

export const Surum = z.literal(PROTOKOL_SURUMU);
export const SohbetSurum = z.literal(SOHBET_SURUMU);

/**
 * Bilinmeyen alan politikası tek yerde: her mesaj bu iki kurucudan birinden geçer ve fazla alanı
 * reddeder. `mesaj`: v1 (`/cihaz`, boru, eşleştirme). `sohbetMesaj`: `/sohbet` (`SOHBET_SURUMU`).
 */
export function mesaj<T extends string, S extends z.ZodRawShape>(type: T, alanlar: S) {
  return z.strictObject({ v: Surum, type: z.literal(type), ...alanlar });
}

export function sohbetMesaj<T extends string, S extends z.ZodRawShape>(type: T, alanlar: S) {
  return z.strictObject({ v: SohbetSurum, type: z.literal(type), ...alanlar });
}

export const OpakId = z
  .string()
  .min(1)
  .max(SINIRLAR.OPAK_ID)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Tam sayı olması `isler/<id>` yolunda dizin geçişini baştan kapatır. */
export const IsId = z.number().int().min(1);

export const SeqNo = z.number().int().min(0);
export const ZamanMs = z.number().int().min(0);

export const Jeton = z
  .string()
  .min(SINIRLAR.JETON_MIN)
  .max(SINIRLAR.JETON_MAX)
  .regex(/^[A-Za-z0-9_-]+$/);

export const PlanHash = z.string().regex(/^[0-9a-f]{64}$/);

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const Nonce = z.string().min(SINIRLAR.NONCE_MIN).max(SINIRLAR.NONCE_MAX).regex(BASE64);
/** P-256 açık anahtarı: SPKI DER, standart base64. */
export const AcikAnahtar = z.string().min(1).max(SINIRLAR.ACIK_ANAHTAR_MAX).regex(BASE64);
/** ECDSA P-256 + SHA-256 imzası: DER, standart base64. */
export const Imza = z.string().min(1).max(SINIRLAR.IMZA_MAX).regex(BASE64);

export const PaketAdi = z
  .string()
  .min(1)
  .max(SINIRLAR.PAKET_ADI)
  .regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/);

/**
 * Kontrol, biçim ve yön karakterleri: C0 (sekme ve satır sonları hariç), DEL, C1, yumuşak tire,
 * sıfır genişlikler, yön işaretleri, satır ayırıcıları, BOM. Onay ekranında görünen metni gerçek
 * metinden ayırabilirlerdi.
 */
export function gorunmezBirimMi(birim: number): boolean {
  return (
    (birim < 0x20 && birim !== 0x09 && birim !== 0x0a && birim !== 0x0d) ||
    (birim >= 0x7f && birim <= 0x9f) ||
    birim === 0xad ||
    birim === 0x061c ||
    (birim >= 0x200b && birim <= 0x200f) ||
    (birim >= 0x2028 && birim <= 0x202e) ||
    (birim >= 0x2060 && birim <= 0x206f) ||
    birim === 0xfeff
  );
}

function gorunmezVarMi(metin: string): boolean {
  for (let i = 0; i < metin.length; i++) {
    if (gorunmezBirimMi(metin.charCodeAt(i))) return true;
  }
  return false;
}

const SATIR_SONU = /[\t\n\r]/;

/** Kullanıcıya onaylatılan çok satırlı metin. */
export function planMetni(en: number, boy: number) {
  return z
    .string()
    .min(en)
    .max(boy)
    .refine((s) => !gorunmezVarMi(s) && iyiBicimliMi(s), {
      message: "görünmez karakter ya da bozuk vekil",
    });
}

/** Kullanıcıya onaylatılan tek satırlık metin: bir madde başka bir maddeymiş gibi görünemez. */
export function planSatiri(en: number, boy: number) {
  return z
    .string()
    .min(en)
    .max(boy)
    .refine((s) => !gorunmezVarMi(s) && !SATIR_SONU.test(s) && iyiBicimliMi(s), {
      message: "satır sonu, görünmez karakter ya da bozuk vekil",
    });
}

export const IS_TURLERI = ["pc", "telefon"] as const;
export const IsTuru = z.enum(IS_TURLERI);
export type IsTuru = z.infer<typeof IsTuru>;

/** Biten işin kapalı durum listesi. */
export const IS_BITIS_DURUMLARI = ["tamam", "hata", "yarim", "iptal", "limit_durdu"] as const;
export const IsBitisDurumu = z.enum(IS_BITIS_DURUMLARI);
export type IsBitisDurumu = z.infer<typeof IsBitisDurumu>;

export const IzinModu = z.enum(["oku", "yaz"]);
export type IzinModu = z.infer<typeof IzinModu>;

export type ImzaRolu = "pc" | "telefon";
export type Kanal = "sohbet" | "cihaz";

/**
 * Karşılıklı sınamada imzalanan metin. Alanlar satır sonu içeremez, bu yüzden birleştirme tek
 * anlamlıdır. Rol ve kanal metne girdiği için imza başka yöne ya da başka kanala taşınamaz.
 * İmzalanan baytlar bu metnin UTF-8 halidir. Önek iki kanalda da `PROTOKOL_SURUMU`'dur
 * (`eren-auth-v1`), `/sohbet` `SOHBET_SURUMU`'nda da: Kotlin `KimlikMetni.kt` aynı metni kurar.
 */
export function kimlikImzaMetni(girdi: {
  rol: ImzaRolu;
  kanal: Kanal;
  device_id: string;
  client_nonce: string;
  server_nonce: string;
}): string {
  return [
    `eren-auth-v${PROTOKOL_SURUMU}`,
    girdi.rol,
    girdi.kanal,
    girdi.device_id,
    girdi.client_nonce,
    girdi.server_nonce,
  ].join("\n");
}
