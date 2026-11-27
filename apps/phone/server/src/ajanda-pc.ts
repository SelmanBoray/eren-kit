import { AJANDA_PC_SINIRLARI, type AjandaYerelAn, OpakId } from "@eren/protocol";
import { MODUL } from "./ajanda-ortak.ts";
import type {
  AjandaPcBaglami,
  AjandaTurBaglami,
  Gunluk,
  PcKancaIsleyicileri,
  RastgelePortu,
  SaatPortu,
  TakvimPortu,
} from "./sozlesme.ts";

/**
 * PC defteri: PC'deki normal Claude Code oturumlarının turlarını bellekte tutar (`docs/AJANDA.md` "PC
 * oturumları", MODULLER.md "PC oturumları"). Servis bu oturumların mesajlarını görmez; Claude Code'un
 * kendi kancaları (kanca süreci `kopru.ts --kanca`, rol `pc_kanca`) ona üç şey söyler:
 * - `pc_istem` (UserPromptSubmit): kullanıcı bu oturumda mesaj gönderdi. Varış anı servisin saatiyle,
 *   kullanıcının o anki dilimiyle bir kez yerel ana çevrilir ve saklanır (telefon yolundaki mesaj anının
 *   eşi); kanca bunu damga olarak modelin bağlamına yazar. Metin yalnız `alinti` denetimi içindir.
 * - `pc_arac` (PreToolUse, yalnız ajanda araçları): şu çağrı kimliği (`tool_use_id`) bu oturumdadır ve
 *   ana ajandan mı, alt agent'tan mı geliyor.
 * - `pc_tur_sonu` (Stop): ana ajanın yanıtı bitti.
 *
 * Köprünün çağrısı (`pc_oturumu`, `arac_cagri_id`) gelince `tur` turu kurar. İnsan turu YALNIZ: aynı
 * çağrı kimliği için tasdik var (en çok `TASDIK_OMRU_DK` önce, tek kullanımlık), alt agent değil, o
 * oturumun son istemi açık (tur sonu gelmedi), istem kimliği tutuyor (ikisi de varsa) ve istemden bu yana
 * en çok `INSAN_TURU_DK` geçti. Geri kalan her durum sentetiktir (mesaj anı çağrının anı): kayıt taslak
 * doğar, taslak olmayan kayda dokunamaz. Model ya da köprü turu insan ilan edemez; ilan eden kancadır.
 *
 * Depoya yazmaz; servis yeniden başlayınca defter boştur (o an süren turun çağrıları sentetik sayılır).
 * Boyut sınırlı (`OTURUM_ADET`, `TASDIK_ADET`; en eskiler atılır). Metin günlüğe girmez.
 */

export interface PcTuru {
  tur: AjandaTurBaglami;
  /** Kaynak izinin `oturum_id`'si: tasdikteki oturum, yoksa köprünün bildirdiği, yoksa bağlantı kimliği. */
  oturum_id: string;
  /** Günlük ve test içindir: kararın nedeni. */
  karar: "insan" | "tasdik_yok" | "alt_agent" | "tur_disi";
}

export interface PcDefteri {
  readonly kanca: PcKancaIsleyicileri;
  /** Hiç `null` dönmez. `simdi` çağrının servis anı. */
  tur(baglam: AjandaPcBaglami, simdi: number): PcTuru;
}

export interface PcDefteriBagimliliklari {
  takvim: TakvimPortu;
  saat: SaatPortu;
  rastgele: Pick<RastgelePortu, "opakId">;
  gunluk: Gunluk;
}

interface Istem {
  istem_id?: string;
  turn_id: string;
  varis_ms: number;
  mesaj_ani: AjandaYerelAn;
  metin: string;
  acik: boolean;
}

interface Tasdik {
  oturum_id: string;
  istem_id?: string;
  alt_agent: boolean;
  ms: number;
}

const DAKIKA = 60_000;

/** Ekleme sırası en yeniyi sona alır; sınır aşılınca baştakiler (en eskiler) atılır. */
function sinirliKoy<K, V>(m: Map<K, V>, k: K, v: V, sinir: number): void {
  m.delete(k);
  m.set(k, v);
  while (m.size > sinir) {
    const ilk = m.keys().next();
    if (ilk.done === true) break;
    m.delete(ilk.value);
  }
}

export function pcDefteriKur(b: PcDefteriBagimliliklari): PcDefteri {
  const { takvim, saat, rastgele, gunluk } = b;
  const istemler = new Map<string, Istem>();
  const tasdikler = new Map<string, Tasdik>();
  const an = (ms: number): AjandaYerelAn => takvim.yerelAn(ms, takvim.kullaniciDilimi());

  const kanca: PcKancaIsleyicileri = {
    pc_istem(g) {
      const varis_ms = saat.simdiMs();
      const mesaj_ani = an(varis_ms);
      const kayit: Istem = { turn_id: rastgele.opakId("pct"), varis_ms, mesaj_ani, metin: g.metin, acik: true };
      if (g.istem_id !== undefined) kayit.istem_id = g.istem_id;
      sinirliKoy(istemler, g.oturum_id, kayit, AJANDA_PC_SINIRLARI.OTURUM_ADET);
      gunluk.bilgi(MODUL, "pc_istem", { oturum_id: g.oturum_id });
      return { mesaj_ani };
    },
    pc_arac(g) {
      const t: Tasdik = { oturum_id: g.oturum_id, alt_agent: g.alt_agent, ms: saat.simdiMs() };
      if (g.istem_id !== undefined) t.istem_id = g.istem_id;
      sinirliKoy(tasdikler, g.arac_cagri_id, t, AJANDA_PC_SINIRLARI.TASDIK_ADET);
      return {};
    },
    pc_tur_sonu(g) {
      const i = istemler.get(g.oturum_id);
      if (i !== undefined) i.acik = false;
      return {};
    },
  };

  const tur = (baglam: AjandaPcBaglami, simdi: number): PcTuru => {
    let tasdik: Tasdik | undefined;
    if (baglam.arac_cagri_id !== undefined) {
      tasdik = tasdikler.get(baglam.arac_cagri_id);
      // Tek kullanımlık: aynı kimlikle ikinci çağrı tasdiksizdir.
      tasdikler.delete(baglam.arac_cagri_id);
      if (tasdik !== undefined && simdi - tasdik.ms > AJANDA_PC_SINIRLARI.TASDIK_OMRU_DK * DAKIKA) tasdik = undefined;
    }
    const bildirilen = baglam.oturum_id !== undefined && OpakId.safeParse(baglam.oturum_id).success ? baglam.oturum_id : undefined;
    const oturum_id = tasdik?.oturum_id ?? bildirilen ?? baglam.baglanti_id;
    const sentetik = (karar: PcTuru["karar"]): PcTuru => ({
      tur: { tur_kokeni: "sentetik", turn_id: rastgele.opakId("pct"), mesaj_ani: an(simdi) },
      oturum_id,
      karar,
    });
    if (tasdik === undefined) return sentetik("tasdik_yok");
    if (tasdik.alt_agent) return sentetik("alt_agent");
    const i = istemler.get(tasdik.oturum_id);
    if (
      i === undefined ||
      !i.acik ||
      (tasdik.istem_id !== undefined && i.istem_id !== undefined && tasdik.istem_id !== i.istem_id) ||
      simdi - i.varis_ms > AJANDA_PC_SINIRLARI.INSAN_TURU_DK * DAKIKA ||
      simdi < i.varis_ms
    ) {
      return sentetik("tur_disi");
    }
    const insan: AjandaTurBaglami = { tur_kokeni: "insan", turn_id: i.turn_id, mesaj_ani: i.mesaj_ani, insan_metni: i.metin };
    if (i.istem_id !== undefined) insan.kaynak_msg_id = i.istem_id;
    return { tur: insan, oturum_id, karar: "insan" };
  };

  return { kanca, tur };
}
