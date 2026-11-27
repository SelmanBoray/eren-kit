import { AJANDA_PC_SINIRLARI, type AjandaYerelAn, OpakId, type PcIstemKaynagi, type PcTurKarari } from "@eren/protocol";
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
 * kendi kancaları (kanca süreci `kanca.ts`, rol `pc_kanca`) ona üç şey söyler:
 * - `pc_istem` (UserPromptSubmit): bu oturumda bir istem gönderildi ve kaynağı (`source`). Varış anı
 *   servisin saatiyle, kullanıcının o anki dilimiyle bir kez yerel ana çevrilir ve saklanır (telefon
 *   yolundaki mesaj anının eşi); kanca bunu damga olarak modelin bağlamına yazar. YALNIZ `kaynak:"user"`
 *   istem insan turu açar ve metin taşır (metin yalnız `alinti` denetimi içindir). Başka kaynaklı istem
 *   (bildirim turu, döngü uyanışı, zamanlanmış görev, `-p`/SDK, tanınmayan ya da bildirilmeyen kaynak)
 *   oturumun son istemi olur ve açık insan turunu kapatır; metni yoktur.
 * - `pc_arac` (PreToolUse, yalnız ajanda araçları): şu çağrı kimliği (`tool_use_id`) bu oturumdadır,
 *   şu istemin (`prompt_id`) turundadır ve ana ajandan mı, alt agent'tan mı geliyor.
 * - `pc_tur_sonu` (Stop): ana ajanın yanıtı bitti.
 *
 * Köprünün çağrısı (`pc_oturumu`, `arac_cagri_id`) gelince `tur` turu kurar. İnsan turu YALNIZ: aynı
 * çağrı kimliği için tasdik var (en çok `TASDIK_OMRU_DK` önce, tek kullanımlık), alt agent değil, o
 * oturumun son istemini kullanıcı yazdı (`kaynak:"user"`), tur sonu gelmedi, istem ile tasdik aynı istem
 * kimliğini taşıyor (ikisi de dolu ve eşit) ve istemden bu yana en çok `INSAN_TURU_DK` geçti (yedek
 * sınır). Geri kalan her durum sentetiktir (mesaj anı çağrının anı): kayıt taslak doğar, taslak olmayan
 * kayda dokunamaz; karar (`PcTurKarari`) köprüye döner, köprü nedenini modele söyler. Model ya da köprü
 * turu insan ilan edemez; ilan eden kancadır.
 *
 * Depoya yazmaz; servis yeniden başlayınca defter boştur (o an süren turun çağrıları sentetik sayılır).
 * Boyut sınırlı (`OTURUM_ADET`, `TASDIK_ADET`; en eskiler atılır). Günlüğe yalnız kararın nedenleri
 * girer (kaynak, istem kimliği var mı, alt agent mı); metin ve istem kimliğinin kendisi girmez.
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

interface Istem {
  kaynak: PcIstemKaynagi;
  istem_id?: string;
  turn_id: string;
  varis_ms: number;
  mesaj_ani: AjandaYerelAn;
  /** Yalnız `kaynak:"user"`; öteki kaynaklarda boş. */
  metin: string;
  /** Yalnız `kaynak:"user"` istem açık doğar; tur sonu ya da sonraki başka kaynaklı istem kapatır. */
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

const varYok = (v: unknown): "var" | "yok" => (v === undefined ? "yok" : "var");

export function pcDefteriKur(b: PcDefteriBagimliliklari): PcDefteri {
  const { takvim, saat, rastgele, gunluk } = b;
  const istemler = new Map<string, Istem>();
  const tasdikler = new Map<string, Tasdik>();
  const an = (ms: number): AjandaYerelAn => takvim.yerelAn(ms, takvim.kullaniciDilimi());

  const kanca: PcKancaIsleyicileri = {
    pc_istem(g) {
      const varis_ms = saat.simdiMs();
      const mesaj_ani = an(varis_ms);
      const kullanici = g.kaynak === "user";
      const kayit: Istem = {
        kaynak: g.kaynak,
        turn_id: rastgele.opakId("pct"),
        varis_ms,
        mesaj_ani,
        metin: kullanici ? (g.metin ?? "") : "",
        acik: kullanici,
      };
      if (g.istem_id !== undefined) kayit.istem_id = g.istem_id;
      const onceki = istemler.get(g.oturum_id);
      sinirliKoy(istemler, g.oturum_id, kayit, AJANDA_PC_SINIRLARI.OTURUM_ADET);
      gunluk.bilgi(MODUL, "pc_istem", {
        oturum_id: g.oturum_id,
        kaynak: g.kaynak,
        istem_kimligi: varYok(g.istem_id),
        // Kullanıcı dışı istem açık insan turunu kapattı mı (teşhis).
        acik_tur_kapandi: !kullanici && onceki?.acik === true,
      });
      return { mesaj_ani };
    },
    pc_arac(g) {
      const t: Tasdik = { oturum_id: g.oturum_id, alt_agent: g.alt_agent, ms: saat.simdiMs() };
      if (g.istem_id !== undefined) t.istem_id = g.istem_id;
      sinirliKoy(tasdikler, g.arac_cagri_id, t, AJANDA_PC_SINIRLARI.TASDIK_ADET);
      gunluk.bilgi(MODUL, "pc_arac", { oturum_id: g.oturum_id, alt_agent: g.alt_agent, istem_kimligi: varYok(g.istem_id) });
      return {};
    },
    pc_tur_sonu(g) {
      const i = istemler.get(g.oturum_id);
      const acikti = i?.acik === true;
      if (i !== undefined) i.acik = false;
      gunluk.bilgi(MODUL, "pc_tur_sonu", { oturum_id: g.oturum_id, acik_tur_kapandi: acikti });
      return {};
    },
  };

  /** Tasdik ve oturumun son istemi verildiğinde karar (sıra `PC_TUR_KARARLARI` açıklamasıyla aynı). */
  const kararVer = (tasdik: Tasdik | undefined, i: Istem | undefined, simdi: number): PcTurKarari => {
    if (tasdik === undefined) return "tasdik_yok";
    if (tasdik.alt_agent) return "alt_agent";
    if (i === undefined) return "istem_yok";
    if (i.kaynak === "yok") return "kaynak_yok";
    if (i.kaynak !== "user") return "kaynak_kullanici_degil";
    if (!i.acik) return "tur_bitti";
    if (tasdik.istem_id === undefined || i.istem_id === undefined) return "istem_kimligi_yok";
    if (tasdik.istem_id !== i.istem_id) return "istem_kimligi_uyusmuyor";
    if (simdi - i.varis_ms > AJANDA_PC_SINIRLARI.INSAN_TURU_DK * DAKIKA || simdi < i.varis_ms) return "sure_doldu";
    return "insan";
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
    const i = tasdik === undefined ? undefined : istemler.get(tasdik.oturum_id);
    const karar = kararVer(tasdik, i, simdi);
    if (karar !== "insan" || i === undefined) {
      return {
        tur: { tur_kokeni: "sentetik", turn_id: rastgele.opakId("pct"), mesaj_ani: an(simdi) },
        oturum_id,
        karar: karar === "insan" ? "istem_yok" : karar,
      };
    }
    const insan: AjandaTurBaglami = { tur_kokeni: "insan", turn_id: i.turn_id, mesaj_ani: i.mesaj_ani, insan_metni: i.metin };
    if (i.istem_id !== undefined) insan.kaynak_msg_id = i.istem_id;
    return { tur: insan, oturum_id, karar };
  };

  return { kanca, tur };
}
