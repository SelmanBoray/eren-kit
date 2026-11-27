import { AJANDA_AZAMI_CERCEVE, AJANDA_SINIRLARI, PROTOKOL_SURUMU } from "./sinirlar.ts";

/**
 * PC kancasının bağımlılıksız çekirdeği (`docs/AJANDA.md` "PC oturumları"). Claude Code kancası
 * (`server/src/kanca.ts`) her kullanıcı mesajında, ajanda aracından önce ve her tur sonunda ayrı bir
 * süreç olarak çalışır; kullanıcının makinesindeki bütün Claude Code oturumlarını bekletir. Bu yüzden bu
 * dosya `./sinirlar.ts` (kendisi de bağımlılıksız) dışında hiçbir şey içe aktarmaz: zod ve protokolün geri
 * kalanını yüklemek her mesaja ~0,3 sn eklerdi. Paketin `@eren/protocol/kanca` girişidir.
 *
 * Şemalı eşleri `ajanda-pc.ts`'tedir (`PcKancaYukari`, `PC_KANCA_ARACLARI`); servis kanca çerçevelerini
 * yalnız onlarla kabul eder. Testler buradaki elle yazılmış denetimlerin şemalarla aynı kararı verdiğini
 * sınar (`protocol/test/ajanda-pc.test.ts`).
 */

/** Ajanda borusunun adı (`ajanda-arac.ts` buradan yeniden dışa aktarır). */
export const AJANDA_BORU_ADI = "\\\\.\\pipe\\eren-ajanda";

/** Claude Code'un araç adı öneki: `mcp__<sunucu>__<fiil>`; kayıt adı `eren-ajanda`. */
export const AJANDA_PC_MCP_ADI = "eren-ajanda";

/**
 * PC yolunun sınırları. `AJANDA_SINIRLARI`'na girmez: uygulama bunları görmez, `/ajanda` sürümünü etkilemez.
 * - `ISTEM_METNI`: kancanın servise verdiği istem metninin üst sınırı (karakter); yalnız `alinti` denetimi
 *   içindir, bellekte tutulur, günlüğe ve depoya girmez. Uzun istem kancada kırpılır. Yalnız kullanıcının
 *   yazdığı istemde (`kaynak:"user"`) gider.
 * - `INSAN_TURU_DK`: istemden sonra çağrının insan turu sayıldığı en uzun süre (yedek sınır: uzun otonom
 *   turda sonradan okunan güvenilmez içeriğe dayanan kayıt taslak doğsun).
 * - `TASDIK_OMRU_DK`: `pc_arac` tasdikinin geçerliliği (izin sorusu araya girebilir).
 * - `OTURUM_ADET`, `TASDIK_ADET`: bellekteki istem ve tasdik kaydı sayısı (eskiler atılır).
 * - `BAGLANTI_ADET`: aynı anda el sıkışmış PC bağlantısı.
 * - `KANCA_SURESI_MS`: kancanın servisle bütün işi (bağlan, el sık, tek istek, yanıt) bu süreyi aşamaz.
 */
export const AJANDA_PC_SINIRLARI = {
  ISTEM_METNI: 4000,
  INSAN_TURU_DK: 30,
  TASDIK_OMRU_DK: 10,
  OTURUM_ADET: 64,
  TASDIK_ADET: 256,
  BAGLANTI_ADET: 32,
  KANCA_SURESI_MS: 2000,
} as const;

/** Kancanın tasdik ettiği araçlar: `AJANDA_ROL_FIILLERI.pc_oturumu` ile aynı (test sınar). */
export const PC_KANCA_ARAC_FIILLERI = ["ajanda_ekle", "ajanda_guncelle", "ajanda_listele"] as const;

/**
 * Claude Code'un `UserPromptSubmit` girdisindeki `source` değerleri (2.1.332 şeması): `user` etkileşimli
 * yazım kutusundan kullanıcının gönderdiği istem; `sdk` etkileşimsiz giriş (`-p`, Agent SDK); `system`
 * makinenin açtığı tur (bildirim, eş/kanal mesajı, kendiliğinden sürdürme); `loop_wakeup` döngü uyanışı;
 * `schedule_wakeup` zamanlanmış görev; `poll_event` olay kanalı. YALNIZ `user` insan turu açar.
 * Kancanın servise verdiği kaynak bunlardan biri, ya da `diger` (tanınmayan değer) ya da `yok` (alan
 * gelmedi; şema "alan yayılırken bazı yüklerde olmayabilir" der). İkisi de insan turu açmaz.
 */
export const PC_ISTEM_KAYNAKLARI = ["user", "sdk", "system", "loop_wakeup", "schedule_wakeup", "poll_event"] as const;
export const PC_ISTEM_KAYNAGI_DEGERLERI = [...PC_ISTEM_KAYNAKLARI, "diger", "yok"] as const;
export type PcIstemKaynagi = (typeof PC_ISTEM_KAYNAGI_DEGERLERI)[number];

/**
 * Servisin kendi başlattığı Claude Code oturumlarının ortamında (`ayar.pcIsOrtami`) bu değişken `1`'dir;
 * kanca orada hiçbir şey yapmaz (servise gitmez, damga yazmaz). Yalnız yetki düşürür: değişkeni koyabilen
 * biri en çok kendi oturumunun kaydını taslağa düşürür.
 */
export const PC_SERVIS_OTURUMU_ORTAMI = "EREN_KIT_SERVIS_OTURUMU";

export type PcKancaOlayi = "istem" | "arac" | "tur_sonu";
export const PC_KANCA_OLAYLARI: readonly PcKancaOlayi[] = ["istem", "arac", "tur_sonu"];

/** Kancanın servise verdiği girdiler; şemaları `ajanda-pc.ts` `PC_KANCA_ARACLARI`. */
export interface PcIstemKancaGirdisi {
  oturum_id: string;
  istem_id?: string;
  kaynak: PcIstemKaynagi;
  /** Yalnız `kaynak:"user"`. */
  metin?: string;
}
export interface PcAracKancaGirdisi {
  oturum_id: string;
  istem_id?: string;
  arac_cagri_id: string;
  alt_agent: boolean;
}
export interface PcTurSonuKancaGirdisi {
  oturum_id: string;
}
export type PcKancaIstegi =
  | { fiil: "pc_istem"; girdi: PcIstemKancaGirdisi }
  | { fiil: "pc_arac"; girdi: PcAracKancaGirdisi }
  | { fiil: "pc_tur_sonu"; girdi: PcTurSonuKancaGirdisi };

/** `OpakId` (`temel.ts`) ve `AracCagriId` (`ajanda-arac.ts`) ile aynı kalıplar; test sınar. */
const OPAK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ARAC_CAGRI_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** `Jeton` (`temel.ts`) ile aynı. */
const JETON = /^[A-Za-z0-9_-]{32,128}$/;

const opakId = (v: unknown): string | undefined => (typeof v === "string" && OPAK_ID.test(v) ? v : undefined);
const doluDizge = (v: unknown): boolean => typeof v === "string" && v !== "";

export const pcJetonuMu = (v: unknown): v is string => typeof v === "string" && JETON.test(v);

/** Claude Code'un `source`'u → kapalı liste. */
export function pcIstemKaynagi(v: unknown): PcIstemKaynagi {
  if (v === undefined || v === null) return "yok";
  return (PC_ISTEM_KAYNAKLARI as readonly unknown[]).includes(v) ? (v as PcIstemKaynagi) : "diger";
}

/**
 * Kancanın Claude Code'dan aldığı JSON'dan servise gidecek istek (saf). Geçersiz ya da bu kancanın işi
 * olmayan girdi `null`: kanca hiçbir şey yollamaz (oturumu bozmaz).
 * - `istem`: `session_id`, `source`, `prompt`, isteğe bağlı `prompt_id`. Metin YALNIZ `source:"user"`
 *   iken gider (`ISTEM_METNI`'ne kırpılır); öteki kaynaklarda istek gider ama metinsizdir (servis o
 *   oturumun açık insan turunu kapatır). Alt agent bağlamında (`agent_id` dolu) gelen istem yok sayılır.
 * - `arac`: `session_id`, `tool_use_id`, `tool_name` (`mcp__eren-ajanda__<fiil>`), isteğe bağlı
 *   `prompt_id`; `agent_id` doluysa alt agent.
 * - `tur_sonu`: `session_id`.
 */
export function pcKancaGirdisi(olay: PcKancaOlayi, ham: unknown): PcKancaIstegi | null {
  if (typeof ham !== "object" || ham === null || Array.isArray(ham)) return null;
  const h = ham as Record<string, unknown>;
  const oturum_id = opakId(h["session_id"]);
  if (oturum_id === undefined) return null;
  const istemId = opakId(h["prompt_id"]);
  const istem = istemId === undefined ? {} : { istem_id: istemId };
  const altAgent = doluDizge(h["agent_id"]);
  if (olay === "istem") {
    if (altAgent) return null;
    const p = h["prompt"];
    if (typeof p !== "string") return null;
    const kaynak = pcIstemKaynagi(h["source"]);
    if (kaynak !== "user") return { fiil: "pc_istem", girdi: { oturum_id, ...istem, kaynak } };
    // UTF-16 birimiyle kırpılır (şema sınırı da öyle); yarım kalan vekil çifti atılır.
    let metin = p.slice(0, AJANDA_PC_SINIRLARI.ISTEM_METNI);
    if (/[\uD800-\uDBFF]$/.test(metin)) metin = metin.slice(0, -1);
    return { fiil: "pc_istem", girdi: { oturum_id, ...istem, kaynak, metin } };
  }
  if (olay === "arac") {
    const id = h["tool_use_id"];
    const ad = h["tool_name"];
    if (typeof id !== "string" || !ARAC_CAGRI_ID.test(id) || typeof ad !== "string") return null;
    const onek = `mcp__${AJANDA_PC_MCP_ADI}__`;
    if (!ad.startsWith(onek) || !(PC_KANCA_ARAC_FIILLERI as readonly string[]).includes(ad.slice(onek.length))) return null;
    return { fiil: "pc_arac", girdi: { oturum_id, ...istem, arac_cagri_id: id, alt_agent: altAgent } };
  }
  return { fiil: "pc_tur_sonu", girdi: { oturum_id } };
}

// Mesaj anı damgası (`ajanda-metin.ts` `mesajAniDamgasi` ile bayt bayt aynı; test sınar).

export interface KancaYerelAn {
  tarih: string;
  saat: string;
  saat_dilimi: string;
}

const TARIH = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAAT = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SAAT_DILIMI = /^(?:UTC|[A-Z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2})$/;
/** Pazar'dan başlar (`Date.getUTCDay`). */
const GUN_ADLARI = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"] as const;

const gunNo = (tarih: string): number | null => {
  const e = TARIH.exec(tarih);
  if (e === null) return null;
  const yil = Number(e[1]);
  const ay = Number(e[2]);
  const gun = Number(e[3]);
  if (yil < AJANDA_SINIRLARI.YIL_MIN || yil > AJANDA_SINIRLARI.YIL_MAX || ay < 1 || ay > 12 || gun < 1) return null;
  const d = new Date(Date.UTC(yil, ay - 1, gun));
  return d.getUTCMonth() === ay - 1 && d.getUTCDate() === gun ? d.getUTCDay() : null;
};

/** `AjandaYerelAn` şemasının bağımlılıksız eşi: fazladan alan yok, üç alan biçimine uygun. */
export function kancaYerelAnMi(v: unknown): v is KancaYerelAn {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const anahtarlar = Object.keys(o);
  if (anahtarlar.length !== 3) return false;
  const { tarih, saat, saat_dilimi } = o;
  return (
    typeof tarih === "string" &&
    gunNo(tarih) !== null &&
    typeof saat === "string" &&
    SAAT.test(saat) &&
    typeof saat_dilimi === "string" &&
    saat_dilimi.length <= AJANDA_SINIRLARI.SAAT_DILIMI &&
    SAAT_DILIMI.test(saat_dilimi)
  );
}

/** `[mesaj_ani: 2026-11-25 Çarşamba 14:30 Europe/Istanbul]`. Geçersiz anda `null`. */
export function kancaDamgasi(an: unknown): string | null {
  if (!kancaYerelAnMi(an)) return null;
  const g = gunNo(an.tarih);
  if (g === null) return null;
  return `[mesaj_ani: ${an.tarih} ${GUN_ADLARI[g]} ${an.saat} ${an.saat_dilimi}]`;
}

// Kanca borusunun satırları (`pc_kanca` rolü). Yukarı yön `PcKancaYukari` şemasına uyar (test sınar).

export const kancaHelloSatiri = (jeton: string): string =>
  JSON.stringify({ v: PROTOKOL_SURUMU, type: "kopru_hello", rol: "pc_kanca", jeton });

export const kancaIstekSatiri = (istek_id: string, istek: PcKancaIstegi): string =>
  JSON.stringify({ v: PROTOKOL_SURUMU, type: "istek", istek_id, fiil: istek.fiil, girdi: istek.girdi });

/** Bir satırın ayrıştırma öncesi üst sınırı (`AJANDA_AZAMI_CERCEVE.BORU`, UTF-16 birimi). */
export const KANCA_AZAMI_SATIR = AJANDA_AZAMI_CERCEVE.BORU;

export type KancaAsagi =
  | { tur: "karsilandi" }
  | { tur: "ret" }
  /** Bu isteğin başarılı yanıtı; `sonuc` doğrulanmamıştır (çağıran kendi denetimiyle okur). */
  | { tur: "yanit"; sonuc: unknown }
  /** Bu isteğin hata yanıtı. */
  | { tur: "hata" }
  /** Başka bir isteğin yanıtı ya da tanınmayan ama zararsız çerçeve: yok sayılır. */
  | { tur: "ilgisiz" }
  /** JSON değil, sürüm uyuşmuyor ya da çok uzun: bağlantı bırakılır. */
  | { tur: "bozuk" };

/** Servisin aşağı satırı (`AjandaKopruAsagi`'nın kancanın okuduğu kadarı). */
export function kancaAsagiCoz(satir: string, istek_id: string): KancaAsagi {
  if (satir.length > KANCA_AZAMI_SATIR) return { tur: "bozuk" };
  let m: unknown;
  try {
    m = JSON.parse(satir);
  } catch {
    return { tur: "bozuk" };
  }
  if (typeof m !== "object" || m === null || Array.isArray(m)) return { tur: "bozuk" };
  const o = m as Record<string, unknown>;
  if (o["v"] !== PROTOKOL_SURUMU) return { tur: "bozuk" };
  if (o["type"] === "kopru_welcome") return o["rol"] === "pc_kanca" ? { tur: "karsilandi" } : { tur: "bozuk" };
  if (o["type"] === "kopru_ret") return { tur: "ret" };
  if (o["type"] === "yanit") {
    if (o["istek_id"] !== istek_id) return { tur: "ilgisiz" };
    return o["ok"] === true && "sonuc" in o ? { tur: "yanit", sonuc: o["sonuc"] } : { tur: "hata" };
  }
  return { tur: "bozuk" };
}
