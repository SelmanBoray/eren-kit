/**
 * Bitiş sınıflaması ve rapor gövdesi. Saf. Tablo sırası MODULLER.md, "isler", "Bitiş durumu".
 */
import { IsRaporu, kacir } from "@eren/protocol";
import type { IsBitisDurumu } from "@eren/protocol";
import type { AkisOlayi, BitisNedeni, IsSonResult, RaporKaynagi } from "./sozlesme.ts";

const LIMIT_ONEKI = "[limit-kilit]";

const bosMu = (d: unknown): boolean =>
  d === null ||
  d === undefined ||
  (typeof d === "object" && !Array.isArray(d) && Object.keys(d).length === 0);

export const sonResultOzeti = (o: Extract<AkisOlayi, { tur: "result" }>): IsSonResult => ({
  is_error: o.is_error,
  metin_limit_onekli: o.metin.startsWith(LIMIT_ONEKI),
  structured_bos: bosMu(o.structured_output),
  structured_output: o.structured_output ?? null,
});

/**
 * Geçerli rapor, sonradan gelen raporsuz result tarafından silinmez: arka plan agent
 * bildirimi oturumu bir tur daha döndürüp `structured_output`'suz result yazabilir.
 * Önceki korunurken yeni result'ın `[limit-kilit]` önekini kaybetmemek için
 * `metin_limit_onekli` ikisinin VEYA'sıdır; diğer alanlar öncekinden kalır.
 */
export const sonResultSec = (onceki: IsSonResult | null, yeni: IsSonResult): IsSonResult =>
  onceki !== null &&
  IsRaporu.safeParse(onceki.structured_output).success &&
  !IsRaporu.safeParse(yeni.structured_output).success
    ? { ...onceki, metin_limit_onekli: onceki.metin_limit_onekli || yeni.metin_limit_onekli }
    : yeni;

export interface BitisGirdisi {
  durdurma: BitisNedeni | null;
  sonResult: IsSonResult | null;
  raporVerVar: boolean;
  kilitAktif: boolean;
  /** Tablo dışı kesin sonuç: başlatılamadı, telefon köprüsü bağlanmadı, süreç hiç başlatılmadı. */
  zorunlu: IsBitisDurumu | null;
}

/** Sıra anlamlıdır, ilk tutan kazanır. `subtype`'a bakılmaz, çıkış kodu zaten yoktur. */
export const bitisDurumuBul = (g: BitisGirdisi): IsBitisDurumu => {
  if (g.durdurma === "limit") return "limit_durdu";
  if (g.durdurma !== null && g.durdurma !== "dogal") return "iptal";
  if (g.zorunlu !== null) return g.zorunlu;
  if (g.sonResult === null) return g.kilitAktif ? "limit_durdu" : "yarim";
  if (g.sonResult.metin_limit_onekli) return "limit_durdu";
  if (g.sonResult.is_error) return "hata";
  if (g.raporVerVar) return "tamam";
  if (g.sonResult.structured_bos) return g.kilitAktif ? "limit_durdu" : "yarim";
  return IsRaporu.safeParse(g.sonResult.structured_output).success ? "tamam" : "hata";
};

export interface RaporSecimi {
  rapor: IsRaporu | null;
  kaynak: RaporKaynagi | null;
}

/** Öncelik: son `result.structured_output`, sonra `rapor_ver`. */
export const raporSec = (sonResult: IsSonResult | null, raporVerilen: IsRaporu | null): RaporSecimi => {
  if (sonResult !== null) {
    const r = IsRaporu.safeParse(sonResult.structured_output);
    if (r.success) return { rapor: r.data, kaynak: "result" };
  }
  if (raporVerilen !== null) {
    const r = IsRaporu.safeParse(raporVerilen);
    if (r.success) return { rapor: r.data, kaynak: "rapor_ver" };
  }
  return { rapor: null, kaynak: null };
};

const BOLUMLER = [
  { baslik: "Yapılanlar:", alan: "yapildi" },
  { baslik: "Yapılmayanlar:", alan: "yapilmadi" },
  { baslik: "Dosyalar:", alan: "dosyalar" },
  { baslik: "Açık noktalar:", alan: "acik_noktalar" },
] as const;

/**
 * Kirli işin `rapor_oku` gövdesi yerine giden sabit servis notu `[karar 2026-11-07]`: kabuğu olan ana oturuma
 * telefondan okunan metin hiç ulaşmaz. Rapor telefonda `job_finished.rapor`'dan gösterilir.
 */
export const KIRLI_RAPOR_NOTU =
  "Rapor gövdesi verilmez: bu iş telefondan okunan veriye dayanıyor. Rapor kullanıcıya telefonda gösterildi.";

export interface RaporGovdesi {
  govde: string;
  kirpildi: boolean;
}

/**
 * Başlıklar servisindir ve her zaman yazılır; maddeler tırnak içinde tek satıra kaçırılır, başlık
 * ya da çit taklit edemez. Sığmayan madde bütün olarak atlanır: yarım madde anlam değiştirebilir.
 */
export const raporGovdesi = (rapor: IsRaporu, sinir: number): RaporGovdesi => {
  let kullanilan = BOLUMLER.map((b) => b.baslik).join("\n").length;
  let kirpildi = false;
  const satirlar: string[] = [];
  for (const bolum of BOLUMLER) {
    satirlar.push(bolum.baslik);
    for (const madde of rapor[bolum.alan]) {
      const satir = `- "${kacir(madde)}"`;
      if (kullanilan + 1 + satir.length > sinir) {
        kirpildi = true;
        continue;
      }
      kullanilan += 1 + satir.length;
      satirlar.push(satir);
    }
  }
  return { govde: satirlar.join("\n"), kirpildi };
};
