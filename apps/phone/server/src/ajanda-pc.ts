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
  /**
   * Çağrı kimliği geldiyse çağrının izi (defterin tuzlu izi, `pcDefteriKur`): defterin neden olayları
   * (`pc_tasdik_yetersiz`, `pc_oturum_uyusmuyor`) aynı değeri `cagri_izi` alanında taşır; araçlar bunu pc
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
   * yönden olursa olsun). O bağlantıyı kullanan üye (köprü kimliği), açık başka bağlantısı kalmadıysa bağdan
   * ayrılır; üyesi kalmayan bağ silinir ve süreç bir sonraki tasdikinde yeniden ilk görüşle bağlanır.
   * Bırakılan bağın bekleyen (tüketilmemiş) tasdikleri de silinir: kapanan köprü onları artık kullanamaz,
   * bağ boşken başka bir köprü de ilk görüşle onları alamaz (yarış: kapanıştan önce gelen tasdik taslak olur).
   * Bağ başka üyeyle sürüyorsa bekleyen tasdiklere dokunulmaz (onlar o üyelerin olabilir).
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
  /** T5 reddinde tasdiki sunan köprü kimliği (kanıtla katılım); ikinci bir köprü de sunduysa `null` (çekişmeli). */
  sunan?: string | null;
}

const DAKIKA = 60_000;
/** Bellekteki oturum bağı sayısı (harness süreci ya da oturum → köprü); eskiler atılır. */
const BAG_ADET = AJANDA_PC_SINIRLARI.TASDIK_ADET;
/**
 * Bir bağın hatırladığı üye (köprü kimliği) sayısı ve bir üyenin hatırladığı köprü bağlantısı sayısı. Aynı
 * anda en çok bu kadar köprü bağlantısı açık olur; fazlası kapanışı gelmemiş bağlantılardır, en eskiler atılır.
 */
const BAG_BAGLANTI_ADET = AJANDA_PC_SINIRLARI.BAGLANTI_ADET;
/** Bir üyenin hatırladığı, tükettiği tasdik oturumu sayısı (kanıtla katılımın engeli; en eskiler atılır). */
const UYE_OTURUM_ADET = 8;
/**
 * Kanıtla katılım (`bagla`) için kanıt tasdikinin en az yaşı. Dürüst sahibin MCP isteği kancanın hemen
 * ardından gelir (kanca en çok `KANCA_SURESI_MS` sürer); bu kadar beklemiş ve hâlâ kimsenin sunmadığı tasdik,
 * aynı mesajdaki koşut çağrıların yarışından ayrılır. Ölçülmedi; değer kancanın sınırına dayanır.
 */
const KANIT_ARALIGI_MS = AJANDA_PC_SINIRLARI.KANCA_SURESI_MS;

/** Bağın bir üyesi (köprü kimliği): bağı kullanan bağlantıları ve tükettiği tasdiklerin oturumları. */
interface Uye {
  baglantilar: Set<string>;
  oturumlar: Set<string>;
}

/** T5 bağı: anahtarın (harness süreci ya da oturum) üyeleri, köprü kimliğine göre. */
interface Bag {
  uyeler: Map<string, Uye>;
}

/** Reddedilen ilk sunuş: köprünün, kimsenin sahiplenmediği bir tasdiki sunduğunun kaydı (kanıtla katılım). */
interface Aday {
  anahtar: string;
  oturum_id: string;
  cagri_id: string;
  tasdik: Tasdik;
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

/** Kümede `sinirliKoy`: en yeni sona, sınır aşılınca en eskiler atılır. */
function sinirliEkle<T>(s: Set<T>, v: T, sinir: number): void {
  s.delete(v);
  s.add(v);
  while (s.size > sinir) {
    const ilk = s.values().next();
    if (ilk.done === true) break;
    s.delete(ilk.value);
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
  /** T5 bağı: `s:<harness süreci>` (yoksa `o:<oturum>`) → onu tüketen köprü kimlikleri (üyeler) ve bağlantıları. */
  const baglar = new Map<string, Bag>();
  /** Kanıtla katılım adayları: köprü kimliği → reddedilen ilk sunuşu (`bagla`). */
  const adaylar = new Map<string, Aday>();

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

  const bagAnahtari = (t: Tasdik): string => (t.surec_id !== undefined ? `s:${t.surec_id}` : `o:${t.oturum_id}`);

  /**
   * T5: tasdik onu tüketen köprüye bağlanır. Köprünün kimliği bildirdiği oturumdur (Claude:
   * `CLAUDE_CODE_SESSION_ID`, köprü süreci açılırken; yoksa rastgele `pck_`), o da yoksa bağlantı. Bağın
   * anahtarı tasdikin harness sürecidir (yoksa oturumu); bir bağın birden çok üyesi (köprü kimliği) olabilir:
   * tek harness sürecinde birden çok oturum çalışabilir (doğrulanmadı: süreç içi agent teams, masaüstü
   * uygulaması ya da IDE uzantısı), her birinin kendi köprüsü olur ve hepsi aynı süreç kimliğini taşır.
   *
   * Eşleşir (bu sırayla):
   * - üye: köprü bu bağın üyesi;
   * - tam: tasdikin oturumu köprününkiyle aynı (köprünün beyanı; üye olarak katılır, kimseyi çıkarmaz);
   * - ilk görüş: bağın üyesi yok ve köprü başka bir harness sürecinin bağında üye değil;
   * - kanıt: köprü başka sürecin bağında üye değil ve daha önce bu sürecin, aynı oturumun bir tasdikini sunup
   *   reddedilmişti; o tasdik hâlâ bekliyor (kimse sunmadı, başka köprü de sunmadı), en az `KANIT_ARALIGI_MS`
   *   eski ve oturumu hiçbir üyenin tükettiği oturum değil. Dayanağı: çağrı kimliği her çağrıda yenidir ve
   *   dürüst köprü yalnız kendi MCP isteğinde aldığı kimliği sunar; dürüst sahibi onu hemen sunacağı için,
   *   sahipsiz kalan tasdik sunanındır. Kanıt tasdiki silinir (çağrısı zaten taslak döndü).
   * Eşleşmez: geri kalan her durum; tasdik silinmez, sahibine kalır. Başka sürecin bağında üye olan köprü
   * yalnız tam eşleşmeyle katılır (bir köprü tek bir Claude Code sürecinin çocuğudur). Oturum bağları
   * (`o:`, süreç kimliği olmayan kanca) bu sayıma girmez: onların anahtarı her `/clear`'da yenidir.
   *
   * Neden oturum eşitliği yetmez: Claude Code `/clear`'da oturum kimliğini yeniler, MCP sunucusunu yeniden
   * başlatmaz (2.1.332 ikili dosyası); köprünün oturumu eskir, kancanınki yenidir. Süreç kimliği `/clear`'da
   * değişmez, iki Claude Code penceresinde ayrıdır. Neden devralma (tam eşleşmede bağı taşıma) değil: aynı
   * süreçteki iki köprü bağı karşılıklı devralır, `/clear` yapmış oturumun köprüsü (oturumu eski) bağı geri
   * alamaz ve o oturum taslağa düşerdi.
   *
   * Üye, onun bağlantılarının hepsi kapanınca ayrılır; üyesi kalmayan bağ bırakılır (`kopruKapandi`). Neden
   * gerekir: `/mcp` yeniden bağlanması, oturum bildirmeyen (`pck_`) ya da hiç bildirmeyen (`b:`) köprünün
   * yeniden açılışı köprünün kimliğini değiştirir. Kapanış hiç gelmezse (yetim köprü) ölü üye kalır; yeni
   * köprü ilk çağrısında taslak alır, sonraki çağrısında kanıtla katılır.
   */
  const bagla = (tasdik: Tasdik, kopru: string, baglanti_id: string, cagri_id: string, simdi: number): boolean => {
    const anahtar = bagAnahtari(tasdik);
    const bag = baglar.get(anahtar);
    const uye = bag?.uyeler.get(kopru);
    let kanit: Aday | undefined;
    if (uye === undefined && tasdik.oturum_id !== kopru) {
      const serbest = !anahtar.startsWith("s:") || !baskaSureceBagli(kopru, anahtar);
      const bos = bag === undefined || bag.uyeler.size === 0;
      if (serbest && !bos) kanit = kanitBul(kopru, anahtar, bag, tasdik, cagri_id, simdi);
      if (!serbest || (!bos && kanit === undefined)) {
        // Sunanı tasdike yaz: ikinci bir köprü de sunarsa tasdik kimsenin kanıtı olmaz.
        tasdik.sunan = tasdik.sunan === undefined || tasdik.sunan === kopru ? kopru : null;
        if (serbest) adayYaz(kopru, anahtar, tasdik, cagri_id);
        return false;
      }
    }
    if (kanit !== undefined) {
      tasdikler.delete(kanit.cagri_id);
      gunluk.bilgi(MODUL, "pc_bag_katildi", { yol: "kanit" });
    }
    adaylar.delete(kopru);
    const b: Bag = bag ?? { uyeler: new Map() };
    const u: Uye = uye ?? { baglantilar: new Set(), oturumlar: new Set() };
    sinirliEkle(u.baglantilar, baglanti_id, BAG_BAGLANTI_ADET);
    sinirliEkle(u.oturumlar, tasdik.oturum_id, UYE_OTURUM_ADET);
    sinirliKoy(b.uyeler, kopru, u, BAG_BAGLANTI_ADET);
    sinirliKoy(baglar, anahtar, b, BAG_ADET);
    return true;
  };

  /** Köprü kimliği başka bir harness sürecinin (`s:`) bağında üye mi. */
  const baskaSureceBagli = (kopru: string, anahtar: string): boolean => {
    for (const [a, bag] of baglar) if (a !== anahtar && a.startsWith("s:") && bag.uyeler.has(kopru)) return true;
    return false;
  };

  /** Aday hâlâ kanıt mı: tasdiki bekliyor (tüketilmedi, silinmedi, yerine başkası konmadı) ve onu yalnız bu köprü sundu. */
  const adayGecerli = (kopru: string, a: Aday): boolean => tasdikler.get(a.cagri_id) === a.tasdik && a.tasdik.sunan === kopru;

  const kanitBul = (kopru: string, anahtar: string, bag: Bag | undefined, tasdik: Tasdik, cagri_id: string, simdi: number): Aday | undefined => {
    const a = adaylar.get(kopru);
    if (a === undefined || bag === undefined || a.anahtar !== anahtar || a.oturum_id !== tasdik.oturum_id || a.cagri_id === cagri_id) return undefined;
    if (!adayGecerli(kopru, a) || simdi - a.tasdik.ms < KANIT_ARALIGI_MS) return undefined;
    for (const u of bag.uyeler.values()) if (u.oturumlar.has(tasdik.oturum_id)) return undefined;
    return a;
  };

  /** Reddedilen sunuşu aday olarak yazar; aynı süreç ve oturumun geçerli eski adayı varsa o kalır (daha eski kanıt). */
  const adayYaz = (kopru: string, anahtar: string, tasdik: Tasdik, cagri_id: string): void => {
    const eski = adaylar.get(kopru);
    if (eski !== undefined && eski.anahtar === anahtar && eski.oturum_id === tasdik.oturum_id && adayGecerli(kopru, eski)) return;
    sinirliKoy(adaylar, kopru, { anahtar, oturum_id: tasdik.oturum_id, cagri_id, tasdik }, BAG_ADET);
  };

  const kopruKapandi = (baglanti_id: string): void => {
    const birakilan = new Set<string>();
    for (const [anahtar, bag] of baglar) {
      let vardi = false;
      for (const [kopru, uye] of bag.uyeler) {
        if (!uye.baglantilar.delete(baglanti_id)) continue;
        vardi = true;
        if (uye.baglantilar.size === 0) bag.uyeler.delete(kopru);
      }
      if (!vardi || bag.uyeler.size > 0) continue;
      baglar.delete(anahtar);
      birakilan.add(anahtar);
    }
    if (birakilan.size === 0) return;
    // Bırakılan bağın bekleyen tasdikleri (eski çerçevede bağ yoktur, dokunulmaz).
    let silinen = 0;
    for (const [id, t] of tasdikler) {
      if (t.eski || !birakilan.has(bagAnahtari(t))) continue;
      tasdikler.delete(id);
      silinen++;
    }
    gunluk.bilgi(MODUL, "pc_bag_birakildi", { baglanti_id, adet: birakilan.size, ...(silinen > 0 ? { tasdik: silinen } : {}) });
  };

  /**
   * Sıra `PC_TUR_KARARLARI` açıklamasıyla aynı. Tasdik eşleşince silinir (tek kullanımlık); eskiyse ya da
   * tanınmayan uyarlayıcınınsa da silinir. Başka köprüye bağlıysa SİLİNMEZ: sahibi hâlâ kullanabilir.
   */
  const kararVer = (baglam: AjandaPcBaglami, simdi: number, kopru: string): { karar: PcTurKarari; tasdik?: Tasdik } => {
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
    if (!tasdik.eski && !bagla(tasdik, kopru, baglam.baglanti_id, id, simdi)) {
      gunluk.uyari(MODUL, "pc_oturum_uyusmuyor", { oturum_id: tasdik.oturum_id, surec_kimligi: varYok(tasdik.surec_id), cagri_izi: iz });
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
    // Bağlantı kimliği servisin; `b:` öneki hiçbir oturum kimliğiyle çakışmasın diye.
    const { karar, tasdik } = kararVer(baglam, simdi, bildirilen ?? `b:${baglam.baglanti_id}`);
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
