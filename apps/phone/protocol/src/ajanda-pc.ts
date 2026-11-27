import { z } from "zod";
import {
  AJANDA_ARAC_ACIKLAMALARI,
  AjandaKopruHello,
  AjandaYerelAn,
  AracCagriId,
  type AjandaFiili,
} from "./ajanda-arac.ts";
import { AJANDA_PC_SINIRLARI, PC_ISTEM_KAYNAGI_DEGERLERI } from "./ajanda-pc-kanca.ts";
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
 *   bunlardan kurar: `UserPromptSubmit` → `pc_istem` (istemin kaynağıyla), ajanda aracından önce
 *   `PreToolUse` → `pc_arac` (çağrı kimliği `tool_use_id` ve alt agent bilgisi), `Stop` → `pc_tur_sonu`.
 * Kancaları modelin kendisi tetikleyemez (Claude Code çalıştırır), ama aynı kullanıcının her süreci
 * anahtarı okuyabilir: güven sınırı işletim sistemi kullanıcısıdır (`docs/GUVENLIK.md`).
 *
 * Kanca sürecinin kullandığı bağımlılıksız parçalar (sınırlar, kaynak listesi, Claude Code JSON'unun
 * okunuşu, damga, satırlar) `ajanda-pc-kanca.ts`'tedir; buradan yeniden dışa aktarılır.
 */

export {
  AJANDA_PC_MCP_ADI,
  AJANDA_PC_SINIRLARI,
  PC_ISTEM_KAYNAKLARI,
  PC_ISTEM_KAYNAGI_DEGERLERI,
  PC_KANCA_ARAC_FIILLERI,
  PC_KANCA_OLAYLARI,
  PC_SERVIS_OTURUMU_ORTAMI,
  pcIstemKaynagi,
  pcKancaGirdisi,
} from "./ajanda-pc-kanca.ts";
export type { PcKancaIstegi, PcKancaOlayi } from "./ajanda-pc-kanca.ts";

/**
 * PC yolundan doğan kayıtların tekilleştirme kapsamı (`ajandaTekilAnahtari` `kapsam`): bütün PC oturumları
 * tek kapsamdır; aynı şey iki oturumda söylenince ikinci kayıt doğmaz. Telefon sohbetlerinin kapsamı
 * (`sohbet:<id>`) değişmez, PC ile telefon arasında tekilleştirme yoktur.
 */
export const PC_TEKIL_KAPSAMI = "pc";

/**
 * PC köprüsünün araç açıklamaları: sözleşmedekiler (`AJANDA_ARAC_ACIKLAMALARI`) birebir, yazan iki araca
 * PC eki. Damga telefon yolunda kullanıcı mesajının başında, PC'de ise kancanın eklediği bağlamdadır.
 */
const PC_ZAMAN_EKI =
  " PC oturumu: [mesaj_ani: ...] damgası kullanıcı mesajına kanca bağlamı olarak eklenir; görmüyorsan " +
  "önce ajanda_listele{en_fazla:1} çağır ve çıktıdaki mesaj_ani'yi dayanak al. Kullanıcı mesajı olmadan " +
  "(alt agent, arka plan) yapılan ekleme taslak doğar; çıktıdaki pc_tur satırı nedenini söyler, " +
  "taslağı kaydedildi diye anlatma.";

export const AJANDA_PC_ARAC_ACIKLAMALARI: Readonly<Record<AjandaFiili, string>> = {
  ajanda_ekle: AJANDA_ARAC_ACIKLAMALARI.ajanda_ekle + PC_ZAMAN_EKI,
  ajanda_guncelle: AJANDA_ARAC_ACIKLAMALARI.ajanda_guncelle + PC_ZAMAN_EKI,
  ajanda_listele: AJANDA_ARAC_ACIKLAMALARI.ajanda_listele,
};

// Kanca çerçeveleri (rol `pc_kanca`)

/** Claude Code oturum kimliği (UUID); kaynak izinde `oturum_id`. */
const OturumId = OpakId;

export const PcIstemKaynagi = z.enum(PC_ISTEM_KAYNAGI_DEGERLERI);
export type PcIstemKaynagi = z.infer<typeof PcIstemKaynagi>;

/**
 * `UserPromptSubmit`: Claude Code bir istem gönderdi. `kaynak` Claude Code'un `source`'u (kapalı liste;
 * tanınmayan `diger`, gelmeyen `yok`). `metin` istemin başıdır (`ISTEM_METNI`'ne kırpılmış) ve YALNIZ
 * `kaynak:"user"` iken vardır: başka kaynaklı istemin metni servise gitmez, bellekte tutulmaz. `istem_id`
 * Claude Code'un `prompt_id`'si (varsa). Çıktı: servisin varışta hesapladığı mesaj anı; kanca bunu
 * damga olarak modelin bağlamına yazar.
 */
export const PcIstemGirdi = z
  .strictObject({
    oturum_id: OturumId,
    istem_id: OpakId.optional(),
    kaynak: PcIstemKaynagi,
    metin: z.string().max(AJANDA_PC_SINIRLARI.ISTEM_METNI).optional(),
  })
  .refine((g) => g.kaynak === "user" || g.metin === undefined, { message: "metin yalnız kullanıcının istemiyle gider" });
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

// Turun kökeni kararı (servisin PC defteri) ve köprüye dönüşü

/**
 * PC çağrısının tur kararı; `insan` dışındakilerin hepsi sentetiktir (kayıt taslak doğar, taslak olmayana
 * dokunulamaz). Sıra servisin denetim sırasıdır (`server/src/ajanda-pc.ts`):
 * - `tasdik_yok`: bu çağrı kimliği için `PreToolUse` kancası gelmedi (kanca kurulu değil, çağrı kimliği
 *   MCP isteğinde yok ya da tasdik eskidi / kullanıldı).
 * - `alt_agent`: çağrı bir alt agent'tan.
 * - `istem_yok`: servis bu oturumun hiç istemini görmedi (istem kancası yok ya da servis yeniden başladı).
 * - `kaynak_yok`: son istemin kaynağı bildirilmedi (`source` alanı gelmedi).
 * - `kaynak_kullanici_degil`: son istemi kullanıcı yazmadı (`sdk`, `system`, uyanış, zamanlanmış, olay, tanınmayan).
 * - `tur_bitti`: son istemden sonra `Stop` geldi.
 * - `istem_kimligi_yok`: istem ya da tasdik `prompt_id` taşımıyor.
 * - `istem_kimligi_uyusmuyor`: çağrı son istemin turuna ait değil.
 * - `sure_doldu`: istemden bu yana `INSAN_TURU_DK`'dan fazla geçti (yedek sınır).
 */
export const PC_TUR_KARARLARI = [
  "insan",
  "tasdik_yok",
  "alt_agent",
  "istem_yok",
  "kaynak_yok",
  "kaynak_kullanici_degil",
  "tur_bitti",
  "istem_kimligi_yok",
  "istem_kimligi_uyusmuyor",
  "sure_doldu",
] as const;
export const PcTurKarari = z.enum(PC_TUR_KARARLARI);
export type PcTurKarari = z.infer<typeof PcTurKarari>;

/**
 * `pc_oturumu` isteğinin başarılı yanıtının `sonuc`'u: aracın çıktısı (`AJANDA_ARACLARI[fiil].cikti`,
 * köprü ayrıca doğrular) ve turun kararı. `ana_oturum` yanıtı bugünkü gibi yalnız çıktıdır.
 */
export const PcAracSonucu = z.strictObject({ cikti: z.unknown(), karar: PcTurKarari });
export type PcAracSonucu = z.infer<typeof PcAracSonucu>;

/** Sentetik kararın modele giden nedeni (kullanıcıya tek cümleyle söylenecek); kayıt metni içermez. */
export const PC_TUR_NEDENI_METNI: Readonly<Record<Exclude<PcTurKarari, "insan">, string>> = {
  tasdik_yok: "Claude Code'un araç öncesi kancası bu çağrıyı servise bildirmedi (kancalar kurulu değil ya da çağrı kimliği gelmedi)",
  alt_agent: "çağrı bir alt agent'tan geldi",
  istem_yok: "servis bu oturumdaki son kullanıcı mesajını görmedi (istem kancası kurulu değil ya da servis yeniden başladı)",
  kaynak_yok: "Claude Code mesajın kimden geldiğini bildirmedi (bu Claude Code sürümü kaynak alanını göndermiyor olabilir)",
  kaynak_kullanici_degil: "bu turu kullanıcı değil sistem açtı (arka plan bildirimi, zamanlanmış görev, döngü uyanışı ya da -p/SDK oturumu)",
  tur_bitti: "kullanıcının mesajıyla başlayan tur bitmişti",
  istem_kimligi_yok: "Claude Code mesaj kimliğini bildirmedi",
  istem_kimligi_uyusmuyor: "çağrı kullanıcının son mesajından başka bir tura ait",
  sure_doldu: `kullanıcının mesajından bu yana ${AJANDA_PC_SINIRLARI.INSAN_TURU_DK} dakikadan fazla geçti`,
};

/**
 * Köprünün yazan araçların metnine eklediği satır (yalnız sentetik kararda; `insan`'da `null`). Sabit
 * metindir: kayıt metni, istem ya da kimlik taşımaz.
 */
export function pcTurNotu(karar: PcTurKarari): string | null {
  if (karar === "insan") return null;
  return (
    `pc_tur: sentetik (${karar}). Bu çağrı kullanıcının yazdığı bir mesaja bağlanamadı: eklenen kayıt taslak doğar ` +
    "(ajanda uygulamasında onay bekler), taslak olmayan kayda dokunulamaz. Kullanıcıya bunu ve nedenini tek " +
    `cümleyle söyle: ${PC_TUR_NEDENI_METNI[karar]}. Teşhis: eren eslestir --claude-code --teshis`
  );
}
