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
 * - `BAGLANTI_ADET`: aynı anda el sıkışmış `pc_oturumu` (MCP köprüsü, oturum başına bir) bağlantısı.
 * - `KANCA_BAGLANTI_ADET`: aynı anda el sıkışmış `pc_kanca` bağlantısı. Köprülerden AYRI sayılır: açık
 *   oturumlar köprü sınırını doldursa da kanca tıkanmaz. Kanca bağlantısı kısa ömürlüdür; servis onu
 *   el sıkışmadan en geç `KANCA_SURESI_MS` + 1 sn sonra kapatır, takılan kanca sınırı tutamaz.
 * - `KANCA_SURESI_MS`: kancanın servisle bütün işi (bağlan, el sık, tek istek, yanıt) bu süreyi aşamaz.
 */
export const AJANDA_PC_SINIRLARI = {
  TASDIK_OMRU_DK: 10,
  TASDIK_ADET: 256,
  BAGLANTI_ADET: 32,
  KANCA_BAGLANTI_ADET: 64,
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

/**
 * Claude Code'un kanca sürecine verdiği kendi süreç kimliği (ondalık PID). Kanıt (2.1.332, kurulu ikili
 * dosya): kanca ortamı `CLAUDE_PID: String(process.pid)` ile kurulur; MCP sunucularının ortamına bu alan
 * konmaz. Canlıda köprü süreçleri doğrudan `claude.exe`'nin çocuğudur (süreç ağacı, 2026-11-27). Değer
 * oturumdan bağımsızdır (`/clear` oturum kimliğini değiştirir, süreci değil): servis tasdiki köprüye bunun
 * üzerinden bağlar (T5, `server/src/ajanda-pc.ts`). Yoksa ya da geçersizse çerçeveye girmez.
 */
export const CLAUDE_CODE_SUREC_ORTAMI = "CLAUDE_PID";

/** Claude Code olayı (`kanca.ts <olay>`). Yalnız araç öncesi; eski kurulumun `istem`/`tur_sonu`'su hiçbir şey yapmaz. */
export type PcKancaOlayi = "arac";
export const PC_KANCA_OLAYLARI: readonly PcKancaOlayi[] = ["arac"];

/**
 * Tasdik çerçevesinin uyarlayıcıları (kapalı liste): ad → bu sürümün tanıdığı en yeni çerçeve sürümü.
 * Listede olmayan ad ya da daha yeni sürüm şemadan geçer ama servis onu insan turu için yeterli saymaz
 * (`tasdik_yok`, güvenli taraf). Köprünün `--uyarlayici` bayrağı da bu adları alır; varsayılan `claude-code`.
 */
export const PC_UYARLAYICILARI = { "claude-code": 1 } as const;
export type PcUyarlayiciAdi = keyof typeof PC_UYARLAYICILARI;
export const PC_VARSAYILAN_UYARLAYICI: PcUyarlayiciAdi = "claude-code";
export const pcUyarlayiciAdiMi = (ad: unknown): ad is PcUyarlayiciAdi => typeof ad === "string" && Object.hasOwn(PC_UYARLAYICILARI, ad);
/** Ad listede ve sürüm 1 ile o adın en yeni sürümü arasında mı. */
export const pcUyarlayiciTanindiMi = (ad: unknown, surum: unknown): boolean =>
  pcUyarlayiciAdiMi(ad) && typeof surum === "number" && Number.isInteger(surum) && surum >= 1 && surum <= PC_UYARLAYICILARI[ad];

/** Çağrıyı yapan: ana ajan, alt agent ya da uyarlayıcının ayıramadığı (`bilinmiyor`: güvenli taraf). */
export const PC_AKTORLER = ["ana", "alt", "bilinmiyor"] as const;
export type PcAktor = (typeof PC_AKTORLER)[number];
/** Oturumun türü: etkileşimli, etkileşimsiz (betik, SDK) ya da bilinmiyor (güvenli taraf). */
export const PC_ETKILESIMLER = ["etkilesimli", "etkilesimsiz", "bilinmiyor"] as const;
export type PcEtkilesim = (typeof PC_ETKILESIMLER)[number];

/**
 * Kancanın servise verdiği normalize tasdik çerçevesi (harness'tan bağımsız; `docs/HARNESS.md` 4.2);
 * şeması `ajanda-pc.ts` `PcTasdikGirdi`. Alanların hepsi harness'ın model dışı yürütme noktasından gelir
 * (T1): `cagri_id` harness'ın çağrı kimliği, `oturum_id` ve `istem_id` oturum ve tur, `surec_id` harness
 * sürecinin kimliği (oturumdan bağımsız, isteğe bağlı; T5 bağı için).
 */
export interface PcAracKancaGirdisi {
  uyarlayici: { ad: string; surum: number };
  cagri_id: string;
  oturum_id: string;
  istem_id?: string;
  aktor: PcAktor;
  etkilesim: PcEtkilesim;
  surec_id?: string;
}
/**
 * H1 öncesi çerçeve (Claude Code alanlarıyla). Servis bunu da kabul eder: kanca uzun ömürlü değildir (her
 * araç çağrısında `guncel` yolundan yeniden başlar), bu yüzden kabul geri alma içindir: junction eski
 * sürüme döner, servis bir süre yeni kalır, eski kanca eski çerçeveyi yollar. Kararı bugünkü gibidir
 * (`PcEskiAracGirdi`). Kanca artık yollamaz.
 */
export interface PcEskiAracKancaGirdisi {
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

/**
 * Alt agent mı: güvenli tarafa düşer. Ölçülen: ana ajanın girdisinde `agent_id` ve `agent_type` HİÇ yoktur;
 * alt agent'ınkinde ikisi de dolu dizgedir. Bu yüzden ikisinden biri, değeri ne olursa olsun (boş dizge,
 * `null`, sayı, nesne) anahtar olarak bulunursa çağrı alt agent sayılır: beklenmeyen biçim insan turu açamaz.
 */
const altAgentMi = (h: Record<string, unknown>): boolean => Object.hasOwn(h, "agent_id") || Object.hasOwn(h, "agent_type");

export const pcJetonuMu = (v: unknown): v is string => typeof v === "string" && JETON.test(v);

/**
 * `PreToolUse` JSON'undan servise gidecek tasdik (saf). Geçersiz ya da bu kancanın işi olmayan girdi
 * `null`: kanca hiçbir şey yollamaz (oturumu bozmaz). Alanlar (ölçüldü: 2.1.332, gerçek `claude -p`):
 * `session_id`, `tool_use_id` (MCP isteğinin `_meta["claudecode/toolUseId"]`'siyle aynı değer),
 * `tool_name` (`mcp__eren-ajanda__<fiil>`), `prompt_id` (alt agent'ın çağrısında da ana turunki); alt
 * agent'ın (ön plan ya da arka plan) çağrısında `agent_id` ve `agent_type` dolu, ana ajanınkinde yok;
 * ikisinden biri hangi değerle olursa olsun bulunursa alt agent sayılır (`altAgentMi`, güvenli taraf).
 * `giris` kanca sürecinin `CLAUDE_CODE_ENTRYPOINT`'idir (`pcEtkilesimsizMi`), `surec` `CLAUDE_PID`'i
 * (`CLAUDE_CODE_SUREC_ORTAMI`). Araç girdisi (`tool_input`) okunmaz, servise gitmez; JSON'daki başka hiçbir
 * alan (ör. `aktor`, `uyarlayici`) çerçeveye geçmez.
 *
 * Claude uyarlayıcısı (`claude-code`, sürüm 1): `tool_use_id → cagri_id`, `prompt_id → istem_id`,
 * `agent_id`/`agent_type` anahtarı varsa `aktor: alt`, yoksa `ana`; giriş `PC_ETKILESIMSIZ_GIRISLER`'den
 * biriyse `etkilesimsiz`, değilse `etkilesimli` (yasak listesi, bugünkü davranış). Bu uyarlayıcı
 * `bilinmiyor` üretmez.
 */
export function pcAracKancaGirdisi(ham: unknown, giris: unknown, surec?: unknown): PcKancaIstegi | null {
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
  const surecId = opakId(surec);
  return {
    fiil: "pc_arac",
    girdi: {
      uyarlayici: { ad: "claude-code", surum: PC_UYARLAYICILARI["claude-code"] },
      cagri_id: id,
      oturum_id,
      ...istem,
      aktor: altAgentMi(h) ? "alt" : "ana",
      etkilesim: pcEtkilesimsizMi(giris) ? "etkilesimsiz" : "etkilesimli",
      ...(surecId === undefined ? {} : { surec_id: surecId }),
    },
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
