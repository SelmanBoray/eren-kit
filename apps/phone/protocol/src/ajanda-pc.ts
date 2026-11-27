import { z } from "zod";
import {
  AJANDA_ARAC_ACIKLAMALARI,
  AjandaKopruHello,
  AjandaYerelAn,
  AracCagriId,
  type AjandaFiili,
} from "./ajanda-arac.ts";
import { cozumle } from "./cozumle.ts";
import { AJANDA_AZAMI_CERCEVE, PROTOKOL_SURUMU } from "./sinirlar.ts";
import { mesaj, OpakId } from "./temel.ts";

/**
 * PC'deki normal Claude Code oturumlarının ajanda yolu (`docs/AJANDA.md` "PC oturumları"). Kablo
 * yalnız ajanda borusudur (`AJANDA_BORU_ADI`, `v` = `PROTOKOL_SURUMU`); `/ajanda` kanalı, kayıt şeması
 * ve uygulamanın aynaladığı kurallar değişmez (kayıt `kaynak.yol:"pc_araci"`, `oturum_id` ile doğar;
 * ikisi v1'den beri şemadadır).
 *
 * İki rol aynı PC anahtarıyla bağlanır:
 * - `pc_oturumu`: kullanıcının Claude Code'una kayıtlı MCP köprüsü; araçları `ana_oturum`'unkilerle aynı.
 * - `pc_kanca`: aynı Claude Code'un kancaları. Servis turun kökenini, mesaj anını ve insan metnini
 *   bunlardan kurar: `UserPromptSubmit` → `pc_istem`, ajanda aracından önce `PreToolUse` → `pc_arac`
 *   (çağrı kimliği `tool_use_id` ve alt agent bilgisi), `Stop` → `pc_tur_sonu`.
 * Kancaları modelin kendisi tetikleyemez (Claude Code çalıştırır), ama aynı kullanıcının her süreci
 * anahtarı okuyabilir: güven sınırı işletim sistemi kullanıcısıdır (`docs/GUVENLIK.md`).
 */

/**
 * PC yolunun sınırları. `AJANDA_SINIRLARI`'na girmez: uygulama bunları görmez, `/ajanda` sürümünü etkilemez.
 * - `ISTEM_METNI`: kancanın servise verdiği istem metninin üst sınırı (karakter); yalnız `alinti` denetimi
 *   içindir, bellekte tutulur, günlüğe ve depoya girmez. Uzun istem kancada kırpılır.
 * - `INSAN_TURU_DK`: istemden sonra çağrının insan turu sayıldığı en uzun süre (uzun otonom turda
 *   sonradan okunan güvenilmez içeriğe dayanan kayıt taslak doğsun).
 * - `TASDIK_OMRU_DK`: `pc_arac` tasdikinin geçerliliği (izin sorusu araya girebilir).
 * - `OTURUM_ADET`, `TASDIK_ADET`: bellekteki istem ve tasdik kaydı sayısı (eskiler atılır).
 * - `BAGLANTI_ADET`: aynı anda el sıkışmış PC bağlantısı.
 */
export const AJANDA_PC_SINIRLARI = {
  ISTEM_METNI: 4000,
  INSAN_TURU_DK: 30,
  TASDIK_OMRU_DK: 10,
  OTURUM_ADET: 64,
  TASDIK_ADET: 256,
  BAGLANTI_ADET: 32,
} as const;

/**
 * PC yolundan doğan kayıtların tekilleştirme kapsamı (`ajandaTekilAnahtari` `kapsam`): bütün PC oturumları
 * tek kapsamdır; aynı şey iki oturumda söylenince ikinci kayıt doğmaz. Telefon sohbetlerinin kapsamı
 * (`sohbet:<id>`) değişmez, PC ile telefon arasında tekilleştirme yoktur.
 */
export const PC_TEKIL_KAPSAMI = "pc";

/** Claude Code'un araç adı öneki: `mcp__<sunucu>__<fiil>`; kayıt adı `eren-ajanda`. */
export const AJANDA_PC_MCP_ADI = "eren-ajanda";

/**
 * PC köprüsünün araç açıklamaları: sözleşmedekiler (`AJANDA_ARAC_ACIKLAMALARI`) birebir, yazan iki araca
 * PC eki. Damga telefon yolunda kullanıcı mesajının başında, PC'de ise kancanın eklediği bağlamdadır.
 */
const PC_ZAMAN_EKI =
  " PC oturumu: [mesaj_ani: ...] damgası kullanıcı mesajına kanca bağlamı olarak eklenir; görmüyorsan " +
  "önce ajanda_listele{en_fazla:1} çağır ve çıktıdaki mesaj_ani'yi dayanak al. Kullanıcı mesajı olmadan " +
  "(alt agent, arka plan) yapılan ekleme taslak doğar; taslağı kaydedildi diye anlatma.";

export const AJANDA_PC_ARAC_ACIKLAMALARI: Readonly<Record<AjandaFiili, string>> = {
  ajanda_ekle: AJANDA_ARAC_ACIKLAMALARI.ajanda_ekle + PC_ZAMAN_EKI,
  ajanda_guncelle: AJANDA_ARAC_ACIKLAMALARI.ajanda_guncelle + PC_ZAMAN_EKI,
  ajanda_listele: AJANDA_ARAC_ACIKLAMALARI.ajanda_listele,
};

// Kanca çerçeveleri (rol `pc_kanca`)

/** Claude Code oturum kimliği (UUID); kaynak izinde `oturum_id`. */
const OturumId = OpakId;

/**
 * `UserPromptSubmit`: kullanıcı bir mesaj gönderdi. `metin` istemin başı (`ISTEM_METNI`'ne kırpılmış);
 * `istem_id` Claude Code'un `prompt_id`'si (varsa). Çıktı: servisin varışta hesapladığı mesaj anı;
 * kanca bunu `mesajAniDamgasi` ile modelin bağlamına yazar.
 */
export const PcIstemGirdi = z.strictObject({
  oturum_id: OturumId,
  istem_id: OpakId.optional(),
  metin: z.string().max(AJANDA_PC_SINIRLARI.ISTEM_METNI),
});
export const PcIstemCikti = z.strictObject({ mesaj_ani: AjandaYerelAn });

/** `PreToolUse` (yalnız ajanda araçları): bu çağrı kimliği bu oturumun bu isteminde; alt agent mı. */
export const PcAracGirdi = z.strictObject({
  oturum_id: OturumId,
  istem_id: OpakId.optional(),
  arac_cagri_id: AracCagriId,
  alt_agent: z.boolean(),
});

/** `Stop`: ana ajanın yanıtı bitti; sonraki çağrılar (arka plan, bildirim turu) insan turu değildir. */
export const PcTurSonuGirdi = z.strictObject({ oturum_id: OturumId });

const BosCikti = z.strictObject({});

export const PC_KANCA_ARACLARI = {
  pc_istem: { girdi: PcIstemGirdi, cikti: PcIstemCikti },
  pc_arac: { girdi: PcAracGirdi, cikti: BosCikti },
  pc_tur_sonu: { girdi: PcTurSonuGirdi, cikti: BosCikti },
} as const;
export type PcKancaFiili = keyof typeof PC_KANCA_ARACLARI;
export const PC_KANCA_FIILLERI = Object.keys(PC_KANCA_ARACLARI) as readonly PcKancaFiili[];
export type PcKancaGirdisi<F extends PcKancaFiili> = z.infer<(typeof PC_KANCA_ARACLARI)[F]["girdi"]>;
export type PcKancaCiktisi<F extends PcKancaFiili> = z.infer<(typeof PC_KANCA_ARACLARI)[F]["cikti"]>;

function kancaIstegi<F extends PcKancaFiili>(fiil: F) {
  return mesaj("istek", { istek_id: OpakId, fiil: z.literal(fiil), girdi: PC_KANCA_ARACLARI[fiil].girdi });
}

export const PcKancaIstek = z.discriminatedUnion("fiil", [
  kancaIstegi("pc_istem"),
  kancaIstegi("pc_arac"),
  kancaIstegi("pc_tur_sonu"),
]);
export type PcKancaIstek = z.infer<typeof PcKancaIstek>;

/**
 * `pc_kanca` bağlantısının yukarı çerçeveleri: ilk mesaj `kopru_hello` (rol `pc_kanca`, PC anahtarı), sonra
 * kanca istekleri. Aşağı yön `AjandaKopruAsagi`'dır (`yanit.sonuc` `PC_KANCA_ARACLARI[fiil].cikti` ile).
 */
export const PcKancaYukari = z.discriminatedUnion("type", [AjandaKopruHello, PcKancaIstek]);
export type PcKancaYukari = z.infer<typeof PcKancaYukari>;

export const pcKancaYukariCoz = (ham: string) => cozumle(PcKancaYukari, ham, AJANDA_AZAMI_CERCEVE.BORU, PROTOKOL_SURUMU);

/**
 * Kancanın Claude Code'dan aldığı JSON'dan servise gidecek girdi (saf; kanca süreci kullanır). Geçersiz ya
 * da bu kancanın işi olmayan girdi `null`: kanca hiçbir şey yollamaz (oturumu bozmaz).
 * - `istem`: `session_id`, `prompt`, isteğe bağlı `prompt_id`. Alt agent bağlamında (`agent_id` dolu)
 *   gelen istem insan mesajı sayılmaz.
 * - `arac`: `session_id`, `tool_use_id`, `tool_name` (`mcp__eren-ajanda__<fiil>`), isteğe bağlı
 *   `prompt_id`; `agent_id` doluysa alt agent.
 * - `tur_sonu`: `session_id`.
 */
export type PcKancaOlayi = "istem" | "arac" | "tur_sonu";
export const PC_KANCA_OLAYLARI: readonly PcKancaOlayi[] = ["istem", "arac", "tur_sonu"];

export type PcKancaIstegi =
  | { fiil: "pc_istem"; girdi: PcKancaGirdisi<"pc_istem"> }
  | { fiil: "pc_arac"; girdi: PcKancaGirdisi<"pc_arac"> }
  | { fiil: "pc_tur_sonu"; girdi: PcKancaGirdisi<"pc_tur_sonu"> };

const dizge = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export function pcKancaGirdisi(olay: PcKancaOlayi, ham: unknown, fiiller: readonly string[]): PcKancaIstegi | null {
  if (typeof ham !== "object" || ham === null || Array.isArray(ham)) return null;
  const h = ham as Record<string, unknown>;
  const oturum = OpakId.safeParse(h["session_id"]);
  if (!oturum.success) return null;
  const istemId = OpakId.safeParse(h["prompt_id"]);
  const istem = istemId.success ? { istem_id: istemId.data } : {};
  const altAgent = dizge(h["agent_id"]) !== undefined;
  if (olay === "istem") {
    if (altAgent) return null;
    const p = h["prompt"];
    if (typeof p !== "string") return null;
    // UTF-16 birimiyle kırpılır (şema sınırı da öyle); yarım kalan vekil çifti atılır.
    let metin = p.slice(0, AJANDA_PC_SINIRLARI.ISTEM_METNI);
    if (/[\uD800-\uDBFF]$/.test(metin)) metin = metin.slice(0, -1);
    return { fiil: "pc_istem", girdi: { oturum_id: oturum.data, ...istem, metin } };
  }
  if (olay === "arac") {
    const id = AracCagriId.safeParse(h["tool_use_id"]);
    const ad = dizge(h["tool_name"]);
    if (!id.success || ad === undefined) return null;
    const onek = `mcp__${AJANDA_PC_MCP_ADI}__`;
    if (!ad.startsWith(onek) || !fiiller.includes(ad.slice(onek.length))) return null;
    return { fiil: "pc_arac", girdi: { oturum_id: oturum.data, ...istem, arac_cagri_id: id.data, alt_agent: altAgent } };
  }
  return { fiil: "pc_tur_sonu", girdi: { oturum_id: oturum.data } };
}
