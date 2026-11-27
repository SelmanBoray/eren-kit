import { AJANDA_PC_SINIRLARI, OpakId, type PcTurKarari } from "@eren/protocol";
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
 * PC defteri: PC'deki normal Claude Code oturumlarının ajanda çağrılarının tasdiklerini bellekte tutar
 * (`docs/AJANDA.md` "PC oturumları", MODULLER.md "PC oturumları"). Servis bu oturumların mesajlarını
 * görmez. Yalın yol: tek kanca vardır, ajanda aracından önce Claude Code'un `PreToolUse`'u (kanca süreci
 * `kanca.ts`, rol `pc_kanca`) → `pc_arac`: şu çağrı kimliği (`tool_use_id`) bu oturumdadır, ana ajandan
 * mı alt agent'tan mı (`agent_id`), etkileşimli oturumdan mı (`CLAUDE_CODE_ENTRYPOINT`), hangi istemin
 * turunda (`prompt_id`, varsa).
 *
 * Köprünün çağrısı (`pc_oturumu`, `arac_cagri_id`) gelince `tur` kararı verir. İnsan turu YALNIZ: çağrı
 * kimliği var, aynı kimlik için tasdik var (en çok `TASDIK_OMRU_DK` önce, tek kullanımlık), alt agent
 * değil, etkileşimsiz değil. Bu durumda ana ajanın çağrısı kullanıcının emri sayılır (insan turunun bütün
 * kuralları: taslaksız ekleme, onay, korunan alanlar, gece teyidi). Geri kalan her durum sentetiktir:
 * kayıt taslak doğar, taslak olmayan kayda dokunamaz; karar (`PcTurKarari`) köprüye döner, köprü nedenini
 * modele söyler. Alt agent'ın çağrısı hiçbir yoldan insan olamaz: tasdik alt agent diyorsa sentetik,
 * tasdik yoksa ya da eşleşmiyorsa da sentetik (kimin olduğu bilinmeden). Model ya da köprü turu insan
 * ilan edemez; ilan eden kancadır.
 *
 * Mesaj anı her çağrıda çağrının servise vardığı andır (kullanıcının o anki dilimiyle; istem kancası yok,
 * mesajın geliş anı bilinmez). İnsan turunun kimliği (`turn_id`, gece reddinin aynı tur kuralı) istem
 * kimliğidir; o yoksa çağrı başına yenidir (kural o oturumda uygulanamaz, teşhis gösterir).
 *
 * Depoya yazmaz; servis yeniden başlayınca defter boştur (araya düşen çağrı sentetik sayılır). Boyut
 * sınırlı (`TASDIK_ADET`; en eskiler atılır). Günlüğe yalnız kararın nedenleri girer; istem kimliğinin
 * kendisi ve araç girdisi girmez.
 */

export interface PcTuru {
  tur: AjandaTurBaglami;
  /** Kaynak izinin `oturum_id`'si: tasdikteki oturum, yoksa köprünün bildirdiği, yoksa bağlantı kimliği. */
  oturum_id: string;
  /** Kararın nedeni: köprüye döner (modele sabit metin), günlüğe girer. */
  karar: PcTurKarari;
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

interface Tasdik {
  oturum_id: string;
  istem_id?: string;
  alt_agent: boolean;
  etkilesimsiz: boolean;
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

const varYok = (v: unknown): "var" | "yok" => (v === undefined ? "yok" : "var");

export function pcDefteriKur(b: PcDefteriBagimliliklari): PcDefteri {
  const { takvim, saat, rastgele, gunluk } = b;
  const tasdikler = new Map<string, Tasdik>();

  const kanca: PcKancaIsleyicileri = {
    pc_arac(g) {
      const t: Tasdik = { oturum_id: g.oturum_id, alt_agent: g.alt_agent, etkilesimsiz: g.etkilesimsiz, ms: saat.simdiMs() };
      if (g.istem_id !== undefined) t.istem_id = g.istem_id;
      sinirliKoy(tasdikler, g.arac_cagri_id, t, AJANDA_PC_SINIRLARI.TASDIK_ADET);
      gunluk.bilgi(MODUL, "pc_arac", {
        oturum_id: g.oturum_id,
        alt_agent: g.alt_agent,
        etkilesimsiz: g.etkilesimsiz,
        istem_kimligi: varYok(g.istem_id),
      });
      return {};
    },
  };

  /** Sıra `PC_TUR_KARARLARI` açıklamasıyla aynı. Tasdik bulunursa silinir (tek kullanımlık), eskiyse yok sayılır. */
  const kararVer = (baglam: AjandaPcBaglami, simdi: number): { karar: PcTurKarari; tasdik?: Tasdik } => {
    if (baglam.arac_cagri_id === undefined) return { karar: "cagri_kimligi_yok" };
    const tasdik = tasdikler.get(baglam.arac_cagri_id);
    tasdikler.delete(baglam.arac_cagri_id);
    if (tasdik === undefined || simdi - tasdik.ms > AJANDA_PC_SINIRLARI.TASDIK_OMRU_DK * DAKIKA || simdi < tasdik.ms) {
      return { karar: "tasdik_yok" };
    }
    if (tasdik.alt_agent) return { karar: "alt_agent", tasdik };
    if (tasdik.etkilesimsiz) return { karar: "etkilesimsiz", tasdik };
    return { karar: "insan", tasdik };
  };

  const tur = (baglam: AjandaPcBaglami, simdi: number): PcTuru => {
    const { karar, tasdik } = kararVer(baglam, simdi);
    const bildirilen = baglam.oturum_id !== undefined && OpakId.safeParse(baglam.oturum_id).success ? baglam.oturum_id : undefined;
    const oturum_id = tasdik?.oturum_id ?? bildirilen ?? baglam.baglanti_id;
    // Mesaj anı: çağrının servise varışı (yalın yolda mesajın geliş anı bilinmez).
    const mesaj_ani = takvim.yerelAn(simdi, takvim.kullaniciDilimi());
    if (karar !== "insan" || tasdik === undefined) {
      return { tur: { tur_kokeni: "sentetik", turn_id: rastgele.opakId("pct"), mesaj_ani }, oturum_id, karar };
    }
    // İstem kimliği turun kimliğidir (aynı istemin çağrıları aynı tur); yoksa çağrı başına yeni.
    const turn_id = tasdik.istem_id === undefined ? rastgele.opakId("pct") : `pci:${tasdik.oturum_id}:${tasdik.istem_id}`;
    // Kullanıcının metni servise gelmez: alıntı saklanmaz (`insan_metni` boş).
    const insan: AjandaTurBaglami = { tur_kokeni: "insan", turn_id, mesaj_ani, insan_metni: "" };
    if (tasdik.istem_id !== undefined) insan.kaynak_msg_id = tasdik.istem_id;
    return { tur: insan, oturum_id, karar };
  };

  return { kanca, tur };
}
