import {
  AJANDA_PC_SINIRLARI,
  OpakId,
  PC_VARSAYILAN_UYARLAYICI,
  type PcAktor,
  type PcEtkilesim,
  type PcKancaGirdisi,
  type PcTurKarari,
  pcUyarlayiciTanindiMi,
  sha256Hex,
  utf8Bayt,
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
 * önce, tek kullanımlık), uyarlayıcı tanınıyor, tasdik bu köprünün harness sürecinin (T5, `surecUyusmazligi`;
 * süreç kimliksiz ya da eski çerçevede uygulanmaz), aktör `ana`, etkileşim `etkilesimli`. Bu durumda ana ajanın çağrısı kullanıcının emri sayılır (insan turunun bütün
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
  /** Kaynak izinin `oturum_id`'si: tüketilen tasdikteki oturum, yoksa köprünün bildirdiği, yoksa bağlantı kimliği. */
  oturum_id: string;
  /** Kararın nedeni: köprüye döner (modele sabit metin), günlüğe girer. */
  karar: PcTurKarari;
  /**
   * Çağrı kimliği geldiyse çağrının izi (defterin tuzlu izi, `pcDefteriKur`): defterin neden olayları
   * (`pc_tasdik_yetersiz`, `pc_surec_uyusmuyor`) aynı değeri `cagri_izi` alanında taşır; araçlar bunu pc
   * `arac` olayına koyar, teşhis nedeni sırayla değil izle bağlar (`eslestir` `tasdikReddiNedenleri`).
   */
  cagri_izi?: string;
}

/** Tuzun rastgele kaynağından alınan opak kimlik sayısı (her biri 9 bayt: toplam 144 bit). */
const IZ_TUZU_PARCA = 2;

export interface PcDefteri {
  /** Kanca işleyicisi; `kopruKapandi` alanı defterinkidir (boru sunucusu her köprü kapanışında çağırır). */
  readonly kanca: PcKancaIsleyicileri;
  /** Hiç `null` dönmez. `simdi` çağrının servis anı. */
  tur(baglam: AjandaPcBaglami, simdi: number): PcTuru;
  /**
   * Köprü bağlantısı kapandı (`AjandaPcBaglami.baglanti_id`; boru sunucusu bildirir, kapanış hangi
   * yönden olursa olsun). Yalnız o bağlantının durumu (eski köprünün ilk görüşü) silinir; tasdiklere ve
   * başka bağlantılara dokunulmaz. Kapanış hiç gelmezse kayıt kalır ve zararsızdır (servis bağlantı kimliğini
   * bir daha vermez). Bilinmeyen kimlik ya da köprü olmayan bağlantı zararsızdır. Eşzamanlıdır, atmaz.
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
  /** H1 öncesi çerçeve (eski kanca süreci): T5 uygulanmaz, karar bugünkü gibi. */
  eski: boolean;
  oturum_id: string;
  istem_id?: string;
  aktor: PcAktor;
  etkilesim: PcEtkilesim;
  surec_id?: string;
  ms: number;
}

const DAKIKA = 60_000;
/**
 * Eski köprü bağlantılarının hatırlanan ilk görüş sayısı (bağlantı → harness süreci). Her kayıt bağlantı
 * kapanınca silinir (`kopruKapandi`); sınır yalnız kapanışı hiç gelmeyen bağlantılar içindir, en eskiler atılır.
 */
const ILK_GORUS_ADET = AJANDA_PC_SINIRLARI.TASDIK_ADET;

/**
 * T5 reddinin türü (`pc_surec_uyusmuyor` olayının `kopru_surec` alanı): `bildirildi` köprünün hello'da
 * bildirdiği süreç (ebeveyni) tasdikin harness süreci değil; `ilk_gorus` eski köprünün bağlantısı başka bir
 * harness sürecinin tasdikiyle bağlanmıştı.
 */
type SurecUyusmazligi = "bildirildi" | "ilk_gorus";

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
  /**
   * Çağrı izinin tuzu: defter kurulurken servisin rastgele kaynağından, yalnız bu kapanışta (bellek) durur;
   * günlüğe, depoya, dönüşe girmez. Çağrı kimliği (Claude `tool_use_id`) harness transkriptinde açıktır: tuzsuz
   * iz, transkripti olan birinin kimlikten yeniden hesaplayıp günlüğü transkriptle ilişkilendirmesine yeterdi.
   * Tuzla iz kimlikten hesaplanamaz ve servis süreci ömrüyle sınırlıdır: yeniden başlayan servisin izleri
   * eskilerle eşleşmez (teşhis o zaman nedensiz kalır, kurulum yönlendirmesine düşer).
   */
  const izTuzu = Array.from({ length: IZ_TUZU_PARCA }, () => rastgele.opakId("t")).join("");
  /** Çağrının günlük izi: tuzlu, alan ayrımlı SHA-256'nın ilk 12 onaltılığı. Aynı süreçte aynı çağrının olaylarını eşler. */
  const cagriIzi = (arac_cagri_id: string): string => sha256Hex(utf8Bayt(`eren-pc-cagri-izi\u0000${izTuzu}\u0000${arac_cagri_id}`)).slice(0, 12);
  const tasdikler = new Map<string, Tasdik>();
  /**
   * Yalnız eski köprü (hello'da süreç bildirmeyen) bağlantıları: bağlantı → ilk tükettiği tasdikin harness süreci.
   * Bağlantı başınadır, bağlantılar arası hiçbir durum yoktur; bağlantı kapanınca silinir.
   */
  const ilkGorus = new Map<string, string>();

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
    // Boru sunucusunun kapanış bildirimi (`PcKancaIsleyicileri.kopruKapandi`); çağrıldığında tanımlıdır.
    kopruKapandi: (baglanti_id) => kopruKapandi(baglanti_id),
  };

  /**
   * T5: bir harness sürecinin kancasından gelen tasdiki başka bir sürecin köprüsü tüketemez. Durumsuz kural,
   * bağlantılar arası paylaşılan durum yoktur (`docs/HARNESS.md` 4.2 "Uygulanan (H1)"):
   * - Tasdik eski çerçeveyse ya da süreç kimliği (`surec_id`, Claude: `CLAUDE_PID`) taşımıyorsa T5 uygulanmaz
   *   (eski çerçevenin bugünkü kuralı). Süreç kimliği olmayan yeni çerçeve de aynı kuralı alır: karşılaştırılacak
   *   bir süreç yoktur ve oturum kimliğine dayanan her bağ `/clear` ya da `--continue`'da kilitlenir.
   * - Yeni köprü (hello'da süreç bildiren; Claude: `process.ppid`): bildirilen süreç tasdikinkine eşitse
   *   tüketilir, değilse ret (`bildirildi`). Köprüyü sarmalayıcı (`cmd /c`, `npx`) başlattıysa ebeveyn harness
   *   değildir ve o pencere hep taslak kalır: güvenli yön.
   * - Eski köprü (süreç bildirmeyen): bağlantı başına ilk görüş. Bağlantı ilk tükettiği tasdikin sürecine
   *   bağlanır ve sonra yalnız onu tüketir (`ilk_gorus`). Bağ bağlantıyla ölür (`kopruKapandi`).
   *   Bu bir zayıflamadır, kısa bir yarış penceresi değil: süreç bildirmeyen köprünün HER yeni bağlantısının
   *   (açılış, /mcp, kopup yeniden bağlanma, servisin yeniden başlaması) ilk tükettiği tasdik süreç denetimsizdir;
   *   o bağlantının ilk çağrısı başka bir sürecin bekleyen tasdikinin kimliğini sunarsa tüketir (karar o
   *   tasdike göre, `insan` olabilir). T5 burada yalnız bağlantı içinde geçerlidir ve her yeniden bağlanmada
   *   sıfırlanır. Güncellemeden önce açılmış köprülerle sınırlı değildir: güncel köprü de hello düşüşünün kilit
   *   koşulunda süreç bildirmeden bağlanabilir (`kopru.ts` `helloMerdiveni`, üst basamak yoklaması; HARNESS.md 4.2).
   *   Dürüst köprü başka sürecin çağrı kimliğini bilemez (güven modelinin içinde). Günlüğe giren bağlanma anı
   *   değildir: bağlantı ilk süreç kimlikli tasdikini tüketirken bir kez `pc_kopru_surecsiz` yazılır (teşhis söyler);
   *   hiç böyle tasdik tüketmeyen süreçsiz bağlantı iz bırakmaz.
   * Ret tasdiki silmez: sahibi (kendi sürecinin köprüsü) hâlâ kullanabilir.
   *
   * Neden oturum kimliği değil: Claude Code `/clear`'da oturum kimliğini yeniler, MCP sürecini yeniden
   * başlatmaz; `--continue`'da köprünün `CLAUDE_CODE_SESSION_ID`'si kancanın oturumundan farklıdır. Süreç kimliği
   * ikisinde de değişmez ve iki Claude Code penceresinde ayrıdır.
   */
  const surecUyusmazligi = (tasdik: Tasdik, baglam: AjandaPcBaglami): SurecUyusmazligi | null => {
    if (tasdik.eski || tasdik.surec_id === undefined) return null;
    if (baglam.kopru_surec_id !== undefined) return baglam.kopru_surec_id === tasdik.surec_id ? null : "bildirildi";
    const bagli = ilkGorus.get(baglam.baglanti_id);
    if (bagli === undefined) {
      sinirliKoy(ilkGorus, baglam.baglanti_id, tasdik.surec_id, ILK_GORUS_ADET);
      // Bağlantı başına bir kez: bu bağlantının ilk süreç kimlikli tasdiki süreç denetimsiz tüketildi. Kimlik (süreç, çağrı,
      // bağlantı) girmez; yalnız tasdikin oturumu (teşhis son 6 karakterini gösterir). Karar değişmez.
      gunluk.uyari(MODUL, "pc_kopru_surecsiz", { oturum_id: tasdik.oturum_id });
      return null;
    }
    return bagli === tasdik.surec_id ? null : "ilk_gorus";
  };

  /** Bağlantı başına durumu (eski köprünün ilk görüşü) temizler; tasdiklere dokunmaz. Aynı köprünün yeni bağlantısı yeniden ilk görüştür. */
  const kopruKapandi = (baglanti_id: string): void => {
    ilkGorus.delete(baglanti_id);
  };

  /**
   * Sıra `PC_TUR_KARARLARI` açıklamasıyla aynı. Tasdik eşleşince silinir (tek kullanımlık); eskiyse ya da
   * tanınmayan uyarlayıcınınsa da silinir. Süreç uyuşmuyorsa (T5) SİLİNMEZ: sahibi hâlâ kullanabilir.
   */
  const kararVer = (baglam: AjandaPcBaglami, simdi: number): { karar: PcTurKarari; tasdik?: Tasdik } => {
    if (baglam.arac_cagri_id === undefined) return { karar: "cagri_kimligi_yok" };
    const id = baglam.arac_cagri_id;
    // Neden olaylarının çağrı izi (`PcTuru.cagri_izi`); kimliğin kendisi günlüğe girmez.
    const iz = cagriIzi(id);
    const tasdik = tasdikler.get(id);
    if (tasdik === undefined || simdi - tasdik.ms > AJANDA_PC_SINIRLARI.TASDIK_OMRU_DK * DAKIKA || simdi < tasdik.ms) {
      tasdikler.delete(id);
      return { karar: "tasdik_yok" };
    }
    if (!pcUyarlayiciTanindiMi(tasdik.uyarlayici.ad, tasdik.uyarlayici.surum)) {
      tasdikler.delete(id);
      gunluk.uyari(MODUL, "pc_tasdik_yetersiz", { neden: "uyarlayici", uyarlayici: tasdik.uyarlayici.ad, surum: tasdik.uyarlayici.surum, cagri_izi: iz });
      return { karar: "tasdik_yok" };
    }
    const uyusmazlik = surecUyusmazligi(tasdik, baglam);
    if (uyusmazlik !== null) {
      gunluk.uyari(MODUL, "pc_surec_uyusmuyor", { oturum_id: tasdik.oturum_id, kopru_surec: uyusmazlik, cagri_izi: iz });
      return { karar: "tasdik_yok" };
    }
    tasdikler.delete(id);
    if (tasdik.aktor === "alt") return { karar: "alt_agent", tasdik };
    if (tasdik.aktor !== "ana") {
      gunluk.uyari(MODUL, "pc_tasdik_yetersiz", { neden: "aktor", cagri_izi: iz });
      return { karar: "tasdik_yok", tasdik };
    }
    if (tasdik.etkilesim === "etkilesimsiz") return { karar: "etkilesimsiz", tasdik };
    if (tasdik.etkilesim !== "etkilesimli") {
      gunluk.uyari(MODUL, "pc_tasdik_yetersiz", { neden: "etkilesim", cagri_izi: iz });
      return { karar: "tasdik_yok", tasdik };
    }
    return { karar: "insan", tasdik };
  };

  const tur = (baglam: AjandaPcBaglami, simdi: number): PcTuru => {
    const bildirilen = baglam.oturum_id !== undefined && OpakId.safeParse(baglam.oturum_id).success ? baglam.oturum_id : undefined;
    const { karar, tasdik } = kararVer(baglam, simdi);
    const oturum_id = tasdik?.oturum_id ?? bildirilen ?? baglam.baglanti_id;
    const izi = baglam.arac_cagri_id === undefined ? {} : { cagri_izi: cagriIzi(baglam.arac_cagri_id) };
    // Mesaj anı: çağrının servise varışı (yalın yolda mesajın geliş anı bilinmez).
    const mesaj_ani = takvim.yerelAn(simdi, takvim.kullaniciDilimi());
    if (karar !== "insan" || tasdik === undefined) {
      return { tur: { tur_kokeni: "sentetik", turn_id: rastgele.opakId("pct"), mesaj_ani }, oturum_id, karar, ...izi };
    }
    // İstem kimliği turun kimliğidir (aynı istemin çağrıları aynı tur); yoksa çağrı başına yeni.
    const turn_id = tasdik.istem_id === undefined ? rastgele.opakId("pct") : `pci:${tasdik.oturum_id}:${tasdik.istem_id}`;
    // Kullanıcının metni servise gelmez: alıntı saklanmaz (`insan_metni` boş).
    const insan: AjandaTurBaglami = { tur_kokeni: "insan", turn_id, mesaj_ani, insan_metni: "" };
    if (tasdik.istem_id !== undefined) insan.kaynak_msg_id = tasdik.istem_id;
    return { tur: insan, oturum_id, karar, ...izi };
  };

  return { kanca, tur, kopruKapandi };
}
