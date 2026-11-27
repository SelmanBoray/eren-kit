import {
  AJANDA_PC_SINIRLARI,
  OpakId,
  PC_VARSAYILAN_UYARLAYICI,
  type PcAktor,
  type PcEtkilesim,
  type PcKancaGirdisi,
  type PcTurKarari,
  pcUyarlayiciTanindiMi,
} from "@eren/protocol";
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
 * Tasdik çerçevesi harness'tan bağımsızdır (`PcTasdikGirdi`: uyarlayıcı, çağrı ve oturum kimliği, aktör,
 * etkileşim, isteğe bağlı harness süreci; `docs/HARNESS.md` 4.2); H1 öncesi Claude çerçevesi de kabul edilir
 * ve aynı karara çevrilir (`tasdikKur`). Köprünün çağrısı (`pc_oturumu`, `arac_cagri_id`) gelince `tur`
 * kararı verir. İnsan turu YALNIZ: çağrı kimliği var, aynı kimlik için tasdik var (en çok `TASDIK_OMRU_DK`
 * önce, tek kullanımlık), uyarlayıcı tanınıyor, tasdik bu köprüye bağlanıyor (T5, `bagla`; eski çerçevede
 * uygulanmaz), aktör `ana`, etkileşim `etkilesimli`. Bu durumda ana ajanın çağrısı kullanıcının emri sayılır (insan turunun bütün
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
  /**
   * Köprü bağlantısı kapandı (`AjandaPcBaglami.baglanti_id`; boru sunucusu bildirir, kapanış hangi
   * yönden olursa olsun). O bağlantının taşıdığı T5 bağları bırakılır: aynı köprü kimliğinin açık başka
   * bağlantısı bağı kullanmadıysa bağ silinir ve süreç bir sonraki tasdikinde yeniden ilk görüşle bağlanır.
   * Bilinmeyen kimlik ya da köprü olmayan bağlantı zararsızdır. Eşzamanlıdır, atmaz.
   */
  kopruKapandi(baglanti_id: string): void;
}

export interface PcDefteriBagimliliklari {
  takvim: TakvimPortu;
  saat: SaatPortu;
  rastgele: Pick<RastgelePortu, "opakId">;
  gunluk: Gunluk;
}

/** Normalize tasdik (çerçeve hangisi olursa olsun). */
interface Tasdik {
  uyarlayici: { ad: string; surum: number };
  /** H1 öncesi çerçeve (eski kanca süreci): oturum bağı (T5) uygulanmaz, karar bugünkü gibi. */
  eski: boolean;
  oturum_id: string;
  istem_id?: string;
  aktor: PcAktor;
  etkilesim: PcEtkilesim;
  surec_id?: string;
  ms: number;
}

const DAKIKA = 60_000;
/** Bellekteki oturum bağı sayısı (harness süreci ya da oturum → köprü); eskiler atılır. */
const BAG_ADET = AJANDA_PC_SINIRLARI.TASDIK_ADET;
/**
 * Bir bağın hatırladığı köprü bağlantısı sayısı. Aynı anda en çok bu kadar köprü bağlantısı açık olur;
 * fazlası kapanışı gelmemiş bağlantılardır, en eskiler atılır.
 */
const BAG_BAGLANTI_ADET = AJANDA_PC_SINIRLARI.BAGLANTI_ADET;

/** T5 bağı: köprünün kimliği ve bağı kullanan (tasdik tüketen) bağlantıları. */
interface Bag {
  kopru: string;
  baglantilar: Set<string>;
}

/** Eski çerçeve `claude-code` uyarlayıcısının çerçevesidir; alanları birebir karşılığına çevrilir. */
function tasdikKur(g: PcKancaGirdisi<"pc_arac">, ms: number): { cagri_id: string; tasdik: Tasdik } {
  if ("arac_cagri_id" in g) {
    const t: Tasdik = {
      uyarlayici: { ad: PC_VARSAYILAN_UYARLAYICI, surum: 1 },
      eski: true,
      oturum_id: g.oturum_id,
      aktor: g.alt_agent ? "alt" : "ana",
      etkilesim: g.etkilesimsiz ? "etkilesimsiz" : "etkilesimli",
      ms,
    };
    if (g.istem_id !== undefined) t.istem_id = g.istem_id;
    return { cagri_id: g.arac_cagri_id, tasdik: t };
  }
  const t: Tasdik = { uyarlayici: g.uyarlayici, eski: false, oturum_id: g.oturum_id, aktor: g.aktor, etkilesim: g.etkilesim, ms };
  if (g.istem_id !== undefined) t.istem_id = g.istem_id;
  if (g.surec_id !== undefined) t.surec_id = g.surec_id;
  return { cagri_id: g.cagri_id, tasdik: t };
}

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
  /** T5 bağı: `s:<harness süreci>` (yoksa `o:<oturum>`) → onu tüketen köprünün kimliği ve bağlantıları. */
  const baglar = new Map<string, Bag>();

  const kanca: PcKancaIsleyicileri = {
    pc_arac(g) {
      const { cagri_id, tasdik: t } = tasdikKur(g, saat.simdiMs());
      sinirliKoy(tasdikler, cagri_id, t, AJANDA_PC_SINIRLARI.TASDIK_ADET);
      // `alt_agent`/`etkilesimsiz` teşhisin okuduğu alanlardır (eslestir `TESHIS_ALANLARI`); adları kalır.
      gunluk.bilgi(MODUL, "pc_arac", {
        oturum_id: t.oturum_id,
        alt_agent: t.aktor === "alt",
        etkilesimsiz: t.etkilesim === "etkilesimsiz",
        istem_kimligi: varYok(t.istem_id),
        uyarlayici: t.uyarlayici.ad,
        aktor: t.aktor,
        etkilesim: t.etkilesim,
        surec_kimligi: varYok(t.surec_id),
        cerceve: t.eski ? "eski" : "normal",
      });
      return {};
    },
  };

  /**
   * T5: tasdik onu tüketen köprüye bağlanır. Köprünün kimliği bildirdiği oturumdur (Claude:
   * `CLAUDE_CODE_SESSION_ID`, köprü süreci açılırken; yoksa rastgele `pck_`), o da yoksa bağlantı.
   * Eşleşir: tasdikin oturumu köprününkiyle aynı (kesin kanıt; bağ ona taşınır), ya da tasdikin harness
   * süreci (yoksa oturumu) zaten bu köprüye bağlı, ya da henüz hiçbir köprüye bağlı değil (ilk görüş; bağ
   * kurulur). Eşleşmez: başka bir köprüye bağlı. Neden oturum eşitliği yetmez: Claude Code `/clear`'da
   * oturum kimliğini yeniler, MCP sunucusunu yeniden başlatmaz (2.1.332 ikili dosyası); köprünün oturumu
   * eskir, kancanınki yenidir. Süreç kimliği `/clear`'da değişmez, iki Claude Code penceresinde ayrıdır.
   *
   * Bağ, onu kullanan köprü bağlantılarının hepsi kapanınca bırakılır (`kopruKapandi`). Neden gerekir:
   * `/mcp` yeniden bağlanması, oturum bildirmeyen (`pck_`) ya da hiç bildirmeyen (`b:`) köprünün yeniden
   * açılışı köprünün kimliğini değiştirir; ölü köprüye bağlı kalan süreç, sonraki `/clear`'dan sonra tam
   * eşleşme de bulamaz ve her çağrısı taslak olurdu. Açık köprünün bağı bırakılmaz: aynı anda açık iki
   * köprüde A'nın tasdikini B'ninki tüketemez. Kapanış hiç gelmezse bağ kalır (eski davranış: taslak).
   */
  const bagla = (tasdik: Tasdik, kopru: string, baglanti_id: string): boolean => {
    const anahtar = tasdik.surec_id !== undefined ? `s:${tasdik.surec_id}` : `o:${tasdik.oturum_id}`;
    const bagli = baglar.get(anahtar);
    if (tasdik.oturum_id !== kopru && bagli !== undefined && bagli.kopru !== kopru) return false;
    // Aynı köprü bağlantılarını biriktirir; devralan (tam eşleşen başka köprü) yeni kümeyle başlar.
    const baglantilar = bagli !== undefined && bagli.kopru === kopru ? bagli.baglantilar : new Set<string>();
    baglantilar.delete(baglanti_id);
    baglantilar.add(baglanti_id);
    while (baglantilar.size > BAG_BAGLANTI_ADET) {
      const ilk = baglantilar.values().next();
      if (ilk.done === true) break;
      baglantilar.delete(ilk.value);
    }
    sinirliKoy(baglar, anahtar, { kopru, baglantilar }, BAG_ADET);
    return true;
  };

  const kopruKapandi = (baglanti_id: string): void => {
    let birakilan = 0;
    for (const [anahtar, bag] of baglar) {
      if (!bag.baglantilar.delete(baglanti_id) || bag.baglantilar.size > 0) continue;
      baglar.delete(anahtar);
      birakilan++;
    }
    if (birakilan > 0) gunluk.bilgi(MODUL, "pc_bag_birakildi", { baglanti_id, adet: birakilan });
  };

  /**
   * Sıra `PC_TUR_KARARLARI` açıklamasıyla aynı. Tasdik eşleşince silinir (tek kullanımlık); eskiyse ya da
   * tanınmayan uyarlayıcınınsa da silinir. Başka köprüye bağlıysa SİLİNMEZ: sahibi hâlâ kullanabilir.
   */
  const kararVer = (baglam: AjandaPcBaglami, simdi: number, kopru: string): { karar: PcTurKarari; tasdik?: Tasdik } => {
    if (baglam.arac_cagri_id === undefined) return { karar: "cagri_kimligi_yok" };
    const id = baglam.arac_cagri_id;
    const tasdik = tasdikler.get(id);
    if (tasdik === undefined || simdi - tasdik.ms > AJANDA_PC_SINIRLARI.TASDIK_OMRU_DK * DAKIKA || simdi < tasdik.ms) {
      tasdikler.delete(id);
      return { karar: "tasdik_yok" };
    }
    if (!pcUyarlayiciTanindiMi(tasdik.uyarlayici.ad, tasdik.uyarlayici.surum)) {
      tasdikler.delete(id);
      gunluk.uyari(MODUL, "pc_tasdik_yetersiz", { neden: "uyarlayici", uyarlayici: tasdik.uyarlayici.ad, surum: tasdik.uyarlayici.surum });
      return { karar: "tasdik_yok" };
    }
    if (!tasdik.eski && !bagla(tasdik, kopru, baglam.baglanti_id)) {
      gunluk.uyari(MODUL, "pc_oturum_uyusmuyor", { oturum_id: tasdik.oturum_id, surec_kimligi: varYok(tasdik.surec_id) });
      return { karar: "tasdik_yok" };
    }
    tasdikler.delete(id);
    if (tasdik.aktor === "alt") return { karar: "alt_agent", tasdik };
    if (tasdik.aktor !== "ana") {
      gunluk.uyari(MODUL, "pc_tasdik_yetersiz", { neden: "aktor" });
      return { karar: "tasdik_yok", tasdik };
    }
    if (tasdik.etkilesim === "etkilesimsiz") return { karar: "etkilesimsiz", tasdik };
    if (tasdik.etkilesim !== "etkilesimli") {
      gunluk.uyari(MODUL, "pc_tasdik_yetersiz", { neden: "etkilesim" });
      return { karar: "tasdik_yok", tasdik };
    }
    return { karar: "insan", tasdik };
  };

  const tur = (baglam: AjandaPcBaglami, simdi: number): PcTuru => {
    const bildirilen = baglam.oturum_id !== undefined && OpakId.safeParse(baglam.oturum_id).success ? baglam.oturum_id : undefined;
    // Bağlantı kimliği servisin; `b:` öneki hiçbir oturum kimliğiyle çakışmasın diye.
    const { karar, tasdik } = kararVer(baglam, simdi, bildirilen ?? `b:${baglam.baglanti_id}`);
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

  return { kanca, tur, kopruKapandi };
}
