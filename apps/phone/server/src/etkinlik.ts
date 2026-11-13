/**
 * Asistanın o anki etkinliği: akış olaylarından türeyen saf durum makinesi. Telefona araç adı, girdisi
 * ya da çıktısı gitmez; yalnız sabit bir kategori (`AkisEtkinligi`) gider, eşleme burada yapılır.
 * Yalnız tip içe aktarır: çalışma zamanında protokol paketine bağımlılık yoktur.
 */
import type { AkisEtkinligi } from "@eren/protocol";
import type { AkisOlayi } from "./sozlesme.ts";

/** Servis köprüsünün araç öneki (`mcp__eren__<fiil>`; fiiller `apps/phone/protocol/src/kopru.ts`'de). */
const KOPRU_ONEKI = "mcp__eren__";
/** Plan öneren köprü fiilinin tam adı: `is_bilgisi`nden ayrı, kendi kategorisi var. */
const PLAN_ONER_ADI = "mcp__eren__plan_oner";
/**
 * Bilgisayar kullanımı MCP sunucusunun adı. `konusma-metin.ts` `COMPUTER_USE_SUNUCUSU`'nu verir ama o
 * dosya çalışma zamanında `@eren/protocol` çeker; burada içe aktarılamaz, değer elle yinelenir.
 */
const EKRAN_ONEKI = "mcp__computer-use-windows__";

/** `acikAraclar` üst sınırı: taşarsa en eski düşer. */
const ACIK_ARAC_AZAMI = 64;

const KOMUT_ADLARI: ReadonlySet<string> = new Set(["PowerShell", "Bash"]);
const OKUMA_ADLARI: ReadonlySet<string> = new Set(["Read", "Glob", "Grep", "NotebookRead"]);
const YAZMA_ADLARI: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const WEB_ADLARI: ReadonlySet<string> = new Set(["WebFetch", "WebSearch"]);

/** Araç adından telefona gidecek kategori. Bilinmeyen her ad "arac". */
export const aracKategorisi = (aracAdi: string): AkisEtkinligi => {
  if (typeof aracAdi !== "string") return "arac";
  if (KOMUT_ADLARI.has(aracAdi)) return "komut";
  if (OKUMA_ADLARI.has(aracAdi)) return "dosya_okuma";
  if (YAZMA_ADLARI.has(aracAdi)) return "dosya_yazma";
  if (WEB_ADLARI.has(aracAdi)) return "web";
  if (aracAdi === PLAN_ONER_ADI) return "plan";
  if (aracAdi.startsWith(KOPRU_ONEKI)) return "is_bilgisi";
  if (aracAdi.startsWith(EKRAN_ONEKI)) return "ekran";
  return "arac";
};

export interface EtkinlikDurumu {
  readonly etkinlik: AkisEtkinligi;
  /** Bu etkinliğin başladığı an (servis saati, ms). */
  readonly baslangic_ms: number;
  /** Başlamış, sonucu henüz dönmemiş araçlar; başlama sırasıyla. */
  readonly acikAraclar: readonly { readonly id: string; readonly kategori: AkisEtkinligi }[];
}

type AcikArac = EtkinlikDurumu["acikAraclar"][number];

/** Görünür bir tur açıldığındaki ilk durum: "dusunuyor". */
export const etkinlikBaslangici = (simdiMs: number): EtkinlikDurumu => ({
  etkinlik: "dusunuyor",
  baslangic_ms: simdiMs,
  acikAraclar: [],
});

type Gecis = { durum: EtkinlikDurumu; degisti: boolean };

/** Açık araç listesi değişti, görünen etkinlik `yeni`: değiştiyse süreyi sıfırlar. */
const uygula = (
  durum: EtkinlikDurumu,
  acikAraclar: readonly AcikArac[],
  yeni: AkisEtkinligi,
  simdiMs: number,
): Gecis => {
  if (yeni === durum.etkinlik) return { durum: { ...durum, acikAraclar }, degisti: false };
  return { durum: { etkinlik: yeni, baslangic_ms: simdiMs, acikAraclar }, degisti: true };
};

const DEGISMEDI = (durum: EtkinlikDurumu): Gecis => ({ durum, degisti: false });

/** Sona ekler; en çok `ACIK_ARAC_AZAMI` girdi tutar (en eskisi düşer). */
const ekle = (acik: readonly AcikArac[], yeniler: readonly AcikArac[]): readonly AcikArac[] => {
  const birlesik = [...acik, ...yeniler];
  return birlesik.length > ACIK_ARAC_AZAMI ? birlesik.slice(birlesik.length - ACIK_ARAC_AZAMI) : birlesik;
};

const kimlikVar = (kimlik: unknown): kimlik is string => typeof kimlik === "string" && kimlik !== "";

/** Bir akış olayını uygular. Görünen etkinlik değiştiyse `degisti: true`. Girdiyi değiştirmez. */
export const etkinlikGecisi = (durum: EtkinlikDurumu, olay: AkisOlayi, simdiMs: number): Gecis => {
  switch (olay.tur) {
    case "model_basladi":
      // Açık araç varken yeni model çağrısı görünen etkinliği değiştirmez (araç hâlâ çalışıyor).
      return durum.acikAraclar.length === 0 ? uygula(durum, durum.acikAraclar, "dusunuyor", simdiMs) : DEGISMEDI(durum);

    case "metin_parcasi":
      return uygula(durum, durum.acikAraclar, "yaziyor", simdiMs);

    case "blok_basladi": {
      if (olay.blok === "dusunme") return uygula(durum, durum.acikAraclar, "dusunuyor", simdiMs);
      if (olay.blok === "metin") return uygula(durum, durum.acikAraclar, "yaziyor", simdiMs);
      if (olay.blok !== "arac") return DEGISMEDI(durum);
      const kategori = aracKategorisi(olay.arac_adi ?? "");
      if (!kimlikVar(olay.arac_id)) return uygula(durum, durum.acikAraclar, kategori, simdiMs);
      // Aynı araç `assistant` yoluyla önce gelmiş olabilir: ikinci kez eklenmez, hiçbir şey değişmez.
      if (durum.acikAraclar.some((a) => a.id === olay.arac_id)) return DEGISMEDI(durum);
      return uygula(durum, ekle(durum.acikAraclar, [{ id: olay.arac_id, kategori }]), kategori, simdiMs);
    }

    case "assistant": {
      const araclar = Array.isArray(olay.araclar) ? olay.araclar : [];
      const yeniler: AcikArac[] = [];
      for (const arac of araclar) {
        if (arac === null || typeof arac !== "object" || !kimlikVar(arac.id)) continue;
        if (durum.acikAraclar.some((a) => a.id === arac.id)) continue;
        if (yeniler.some((a) => a.id === arac.id)) continue;
        yeniler.push({ id: arac.id, kategori: aracKategorisi(arac.ad) });
      }
      const sonYeni = yeniler[yeniler.length - 1];
      if (sonYeni === undefined) return DEGISMEDI(durum);
      return uygula(durum, ekle(durum.acikAraclar, yeniler), sonYeni.kategori, simdiMs);
    }

    case "arac_sonucu": {
      const idler = Array.isArray(olay.arac_idler) ? olay.arac_idler : [];
      const kalan = durum.acikAraclar.filter((a) => !idler.includes(a.id));
      if (kalan.length === durum.acikAraclar.length) return DEGISMEDI(durum);
      const sonAcik = kalan[kalan.length - 1];
      return uygula(durum, kalan, sonAcik === undefined ? "dusunuyor" : sonAcik.kategori, simdiMs);
    }

    default:
      return DEGISMEDI(durum);
  }
};
