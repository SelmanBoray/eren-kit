import { AJANDA_AZAMI_CERCEVE, PROTOKOL_SURUMU } from "./sinirlar.ts";

/**
 * PC kancasının bağımlılıksız çekirdeği (`docs/AJANDA.md` "PC oturumları"). Tek kanca vardır: Claude
 * Code'un araç çağrısı öncesi kancası (`PreToolUse`, eşleyici `mcp__eren-ajanda__.*`); yalnız ajanda
 * aracından önce ayrı bir süreç olarak çalışır (`server/src/kanca.ts`). İstem ve tur sonu kancası yoktur:
 * kullanıcının mesaj metni servise gitmez, mesajlara gecikme eklenmez. Bu dosya `./sinirlar.ts` (kendisi
 * de bağımlılıksız) dışında hiçbir şey içe aktarmaz: zod ve protokolün geri kalanını yüklemek her çağrıya
 * ~0,3 sn eklerdi. Paketin `@eren/protocol/kanca` girişidir.
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
 * - `TASDIK_OMRU_DK`: `pc_arac` tasdikinin geçerliliği. Kancayla çağrı arasına izin sorusu girebilir;
 *   kullanıcı izni bundan uzun bekletirse tasdik düşer ve çağrı güvenli tarafa (taslak) iner.
 * - `TASDIK_ADET`: bellekteki tasdik sayısı (eskiler atılır).
 * - `BAGLANTI_ADET`: aynı anda el sıkışmış PC bağlantısı.
 * - `KANCA_SURESI_MS`: kancanın servisle bütün işi (bağlan, el sık, tek istek, yanıt) bu süreyi aşamaz.
 */
export const AJANDA_PC_SINIRLARI = {
  TASDIK_OMRU_DK: 10,
  TASDIK_ADET: 256,
  BAGLANTI_ADET: 32,
  KANCA_SURESI_MS: 2000,
} as const;

/** Kancanın tasdik ettiği araçlar: `AJANDA_ROL_FIILLERI.pc_oturumu` ile aynı (test sınar). */
export const PC_KANCA_ARAC_FIILLERI = ["ajanda_ekle", "ajanda_guncelle", "ajanda_listele"] as const;

/**
 * Servisin kendi başlattığı Claude Code oturumlarının ortamında (`ayar.pcIsOrtami`) bu değişken `1`'dir;
 * kanca orada hiçbir şey yapmaz (servise gitmez). Yalnız yetki düşürür: değişkeni koyabilen biri en çok
 * kendi oturumunun kaydını taslağa düşürür.
 */
export const PC_SERVIS_OTURUMU_ORTAMI = "EREN_KIT_SERVIS_OTURUMU";

/**
 * Claude Code'un kanca sürecine (ve MCP sunucularına) verdiği giriş türü. Etkileşimli terminal `cli`,
 * `-p` `sdk-cli` (ölçüldü: 2.1.332, `-p` oturumunun ve içindeki alt agent'ın kancasında; etkileşimli
 * oturumun kabuğundan açılan `claude -p`'de de `sdk-cli`), Agent SDK `sdk-ts`/`sdk-py`; masaüstü ve
 * eklenti başka değerler verir. Kapalı liste değildir: YALNIZ `PC_ETKILESIMSIZ_GIRISLER` insan turu
 * saymamayı gerektirir (betik ya da başka bir ajanın açtığı oturum); geri kalan her değer etkileşimli sayılır.
 */
export const CLAUDE_CODE_GIRIS_ORTAMI = "CLAUDE_CODE_ENTRYPOINT";
export const PC_ETKILESIMSIZ_GIRISLER = ["sdk-cli", "sdk-ts", "sdk-py"] as const;
export const pcEtkilesimsizMi = (giris: unknown): boolean =>
  typeof giris === "string" && (PC_ETKILESIMSIZ_GIRISLER as readonly string[]).includes(giris);

/** Claude Code olayı (`kanca.ts <olay>`). Yalnız araç öncesi; eski kurulumun `istem`/`tur_sonu`'su hiçbir şey yapmaz. */
export type PcKancaOlayi = "arac";
export const PC_KANCA_OLAYLARI: readonly PcKancaOlayi[] = ["arac"];

/** Kancanın servise verdiği girdi; şeması `ajanda-pc.ts` `PC_KANCA_ARACLARI.pc_arac`. */
export interface PcAracKancaGirdisi {
  oturum_id: string;
  istem_id?: string;
  arac_cagri_id: string;
  alt_agent: boolean;
  etkilesimsiz: boolean;
}
export type PcKancaIstegi = { fiil: "pc_arac"; girdi: PcAracKancaGirdisi };

/** `OpakId` (`temel.ts`) ve `AracCagriId` (`ajanda-arac.ts`) ile aynı kalıplar; test sınar. */
const OPAK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ARAC_CAGRI_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** `Jeton` (`temel.ts`) ile aynı. */
const JETON = /^[A-Za-z0-9_-]{32,128}$/;

const opakId = (v: unknown): string | undefined => (typeof v === "string" && OPAK_ID.test(v) ? v : undefined);
const doluDizge = (v: unknown): boolean => typeof v === "string" && v !== "";

export const pcJetonuMu = (v: unknown): v is string => typeof v === "string" && JETON.test(v);

/**
 * `PreToolUse` JSON'undan servise gidecek tasdik (saf). Geçersiz ya da bu kancanın işi olmayan girdi
 * `null`: kanca hiçbir şey yollamaz (oturumu bozmaz). Alanlar (ölçüldü: 2.1.332, gerçek `claude -p`):
 * `session_id`, `tool_use_id` (MCP isteğinin `_meta["claudecode/toolUseId"]`'siyle aynı değer),
 * `tool_name` (`mcp__eren-ajanda__<fiil>`), `prompt_id` (alt agent'ın çağrısında da ana turunki); alt
 * agent'ın (ön plan ya da arka plan) çağrısında `agent_id` ve `agent_type` dolu, ana ajanınkinde yok.
 * `giris` kanca sürecinin `CLAUDE_CODE_ENTRYPOINT`'idir (`pcEtkilesimsizMi`). Araç girdisi (`tool_input`)
 * okunmaz, servise gitmez.
 */
export function pcAracKancaGirdisi(ham: unknown, giris: unknown): PcKancaIstegi | null {
  if (typeof ham !== "object" || ham === null || Array.isArray(ham)) return null;
  const h = ham as Record<string, unknown>;
  const oturum_id = opakId(h["session_id"]);
  if (oturum_id === undefined) return null;
  const id = h["tool_use_id"];
  const ad = h["tool_name"];
  if (typeof id !== "string" || !ARAC_CAGRI_ID.test(id) || typeof ad !== "string") return null;
  const onek = `mcp__${AJANDA_PC_MCP_ADI}__`;
  if (!ad.startsWith(onek) || !(PC_KANCA_ARAC_FIILLERI as readonly string[]).includes(ad.slice(onek.length))) return null;
  const istemId = opakId(h["prompt_id"]);
  const istem = istemId === undefined ? {} : { istem_id: istemId };
  return {
    fiil: "pc_arac",
    girdi: { oturum_id, ...istem, arac_cagri_id: id, alt_agent: doluDizge(h["agent_id"]), etkilesimsiz: pcEtkilesimsizMi(giris) },
  };
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
