/**
 * İş oturumları: başlatma, izleme, bitirme, öldürme, uzlaştırma; rapor; sorular; RAM.
 * MODULLER.md, "isler". Bitiş süreç çıkışıdır, `result` değil; çıkış kodu yoktur, okunmaz.
 */
import win32 from "node:path/win32";
import { citleSar, IS_BITIS_DURUMLARI, SINIRLAR, VARSAYILAN_IS_PROFILI } from "@eren/protocol";
import type {
  HataKodu,
  IsBitisDurumu,
  IsProfili,
  IsTuru,
  KullaniciyaSorCikti,
  Plan,
  SohbetId,
} from "@eren/protocol";
import {
  gorevMetni,
  pcArgv,
  pcMcpYapilandirmasi,
  telefonArgv,
  telefonMcpYapilandirmasi,
} from "./isler-komut.ts";
import { bitisDurumuBul, KIRLI_RAPOR_NOTU, raporGovdesi, raporSec, sonResultOzeti, sonResultSec } from "./isler-rapor.ts";
import type {
  AkisOlayi,
  AyrikSurecIstegi,
  BitisNedeni,
  IptalEt,
  IsBaslatmaHatasi,
  IsKaydi,
  IslerFabrikasi,
  IsNo,
  IsSonResult,
  IsYoneticisi,
  JetonKapsami,
  McpSunucuDurumu,
  OlayGirdisi,
  OturumDurumu,
  RamOzeti,
  SohbetSecimi,
  SoruDurumu,
  SoruKaydi,
  Sonuc,
  SurecKaydi,
  SurecKimligi,
  UzlastirmaOzeti,
} from "./sozlesme.ts";

type SistemNotu = Extract<OlayGirdisi, { type: "system_notice" }>;

/** Oluşma anı `Win32_Process`'ten gelir, `surecVarMi` ile aynı pay: MODULLER.md, "dis-dunya". */
const KIMLIK_PAYI_MS = 1000;
/**
 * Başlatma anından sürecin doğuşuna kadar en çok geçen süre. Görüntü taraması `CreateProcess`'ten
 * önce olur; güncellemeyle yenilenen büyük `claude.exe`'de saniyeler sürebilir.
 */
const BASLATMA_PAYI_MS = 30_000;
const RAM_HISTEREZIS_MB = 512;
const PARCA_BAYT = 256 * 1024;
/** Ekran görüntülü tek satır on MiB'ı bulur. Üstü atlanır: iş sonsuza dek aynı ofsette takılmasın. */
const AZAMI_SATIR_BAYT = 64 * 1024 * 1024;
const OKUMA_HATASI_SINIRI = 5;
const TUM_AKTIFLER = 1_000_000;

/** 0.5.0: işlere `eren-soru` verilmez; PC işi köprü beklemez, telefon işi yalnız `eren-telefon`'u. */
const BEKLENEN_KOPRULER: Readonly<Record<IsTuru, readonly string[]>> = {
  pc: [],
  telefon: ["eren-telefon"],
};

const BITIS_DURUMLARI: ReadonlySet<string> = new Set(IS_BITIS_DURUMLARI);

const bitmisMi = (d: OturumDurumu): d is IsBitisDurumu => BITIS_DURUMLARI.has(d);

const hata = <K extends HataKodu>(code: K): { ok: false; code: K } => ({ ok: false, code });

const hataTuru = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

const ayniSurec = (a: SurecKimligi, b: SurecKimligi): boolean =>
  a.pid === b.pid && Math.abs(a.olusturmaMs - b.olusturmaMs) <= KIMLIK_PAYI_MS;

const pidAnahtari = (k: SurecKimligi): string => `${k.pid}:${k.olusturmaMs}`;

const baslatmaPenceresinde = (baslatmaMs: number, olusturmaMs: number): boolean =>
  olusturmaMs >= baslatmaMs - KIMLIK_PAYI_MS && olusturmaMs <= baslatmaMs + BASLATMA_PAYI_MS;

type KimlikAramasi = "bulundu" | "yok" | "belirsiz";

const mbTamSayi = (d: number): number => (Number.isFinite(d) ? Math.max(0, Math.floor(d)) : 0);

const kayittanCikti = (s: SoruKaydi): KullaniciyaSorCikti | null => {
  if (s.durum === "bekliyor") return null;
  if (s.durum === "cevaplandi") return { durum: "cevaplandi", cevap: s.cevap ?? "" };
  return { durum: s.durum };
};

interface AktifIs {
  readonly is_id: IsNo;
  /** Dilim 2: işin (= planın) sohbeti. İşin bütün olayları ve yayınları bunu taşır. */
  readonly sohbet_id: SohbetId;
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly tur: IsTuru;
  readonly kirli: boolean;
  /**
   * Kilit `aktif` olunca servis durdurur: telefon işi ve hafif PC işi. Tam PC işi limit modunu kullanıcı
   * ayarından yükler, kendini dondurur; hafif profilde (`--setting-sources ""`) limit modu yüklenmez.
   */
  readonly kilitteDurur: boolean;
  readonly out: string;
  kimlik: SurecKimligi | null;
  /** Süreç başlatıldı ama `pid` kayda geçmedi: başlatma anı. Süreç bununla aranır. */
  beklenenOlusma: number | null;
  belirsizBildirildi: boolean;
  ofset: number;
  /** Aynı işin yoklama, durdurma ve bitişi üst üste binmez. */
  sira: Promise<unknown>;
  yoklamaKuyrukta: boolean;
  basliyor: boolean;
  baslama: Promise<void>;
  durdurmaSozu: Promise<void> | null;
  initDenetlendi: boolean;
  telefonKoprusuz: boolean;
  zorunlu: IsBitisDurumu | null;
  okumaHatasi: number;
  bitti: boolean;
  pidler: Set<string>;
}

interface Bekleyen {
  coz(cikti: KullaniciyaSorCikti): void;
}

export const islerKur: IslerFabrikasi = ({
  ayar,
  depo,
  kilit,
  kopru,
  akis,
  surec,
  dosya,
  sistem,
  saat,
  zamanlayici,
  rastgele,
  veriyolu,
  gunluk,
}) => {
  const aktifler = new Map<IsNo, AktifIs>();
  const bekleyenler = new Map<string, Set<Bekleyen>>();
  const zamanAsimlari = new Map<string, IptalEt>();
  const ayirici = akis.satirAyirici();
  const claudeAdi = win32.basename(ayar.claudeExe).toLowerCase();
  let kapali = false;
  let torunYoklaniyor = false;
  let ramOkundu = false;
  let ramDurumu: RamOzeti = { bosMb: 0, toplamMb: 0, dusuk: false };

  /**
   * `sohbet_id`: işe ait uyarıda işin sohbeti; `null` küresel nottur (`ram_dusuk`, `is_uzlastirildi`),
   * alansız yazılır. Açık `null`: işe ait bir notun sohbeti unutulamasın.
   */
  const notEkle = (
    sohbet_id: SohbetId | null,
    seviye: SistemNotu["seviye"],
    kod: SistemNotu["kod"],
    metin: string,
  ): void => {
    depo.olayEkle({ type: "system_notice", seviye, kod, metin, ...(sohbet_id === null ? {} : { sohbet_id }) });
  };

  const sohbettenMi = (k: IsKaydi, sohbet: SohbetSecimi): boolean => k.sohbet_id === sohbet.sohbet_id;

  const sirala = <T>(a: AktifIs, f: () => Promise<T>): Promise<T> => {
    const sonuc = a.sira.then(f);
    a.sira = sonuc.then(
      () => undefined,
      () => undefined,
    );
    return sonuc;
  };

  /**
   * İş satırı profil taşımaz; profil planın kaydındadır (`PlanKaydi.profil`). Kayıt yoksa ya da okunamazsa
   * `tam` (sütun varsayılanı, Dilim 1 öncesi davranış).
   */
  const kayitliProfil = (plan_id: string): IsProfili => {
    try {
      return depo.planGetir(plan_id)?.profil === "hafif" ? "hafif" : VARSAYILAN_IS_PROFILI;
    } catch (e) {
      gunluk.uyari("isler", "profil_okunamadi", { hata_turu: hataTuru(e) });
      return VARSAYILAN_IS_PROFILI;
    }
  };

  /** `profil` başlatmada istekten gelir; uzlaştırmada verilmez, planın kaydından okunur. */
  const aktifKur = (k: IsKaydi, profil?: IsProfili): AktifIs => ({
    is_id: k.is_id,
    sohbet_id: k.sohbet_id,
    plan_id: k.plan_id,
    plan_hash: k.plan_hash,
    tur: k.tur,
    kirli: k.kirli,
    kilitteDurur: k.tur === "telefon" || (profil ?? kayitliProfil(k.plan_id)) === "hafif",
    out: ayar.isYollari(k.is_id).out,
    kimlik: k.pid !== null && k.olusturma_ms !== null ? { pid: k.pid, olusturmaMs: k.olusturma_ms } : null,
    beklenenOlusma: k.pid === null ? k.olusturma_ms : null,
    belirsizBildirildi: false,
    ofset: k.out_ofset,
    sira: Promise.resolve(),
    yoklamaKuyrukta: false,
    basliyor: false,
    baslama: Promise.resolve(),
    durdurmaSozu: null,
    initDenetlendi: false,
    telefonKoprusuz: false,
    // Başlatma anı da yoksa süreç hiç başlatılmamıştır: `[karar]` yarım, kilit durumundan bağımsız.
    zorunlu: k.pid === null && k.olusturma_ms === null ? "yarim" : null,
    okumaHatasi: 0,
    bitti: false,
    pidler: new Set(depo.isPidleri(k.is_id).map(pidAnahtari)),
  });

  /**
   * Bitişte iptal edilen kapsamlar. 0.5.0'dan beri yeni işe soru jetonu üretilmez; soru kapsamı yine iptal
   * edilir: güncellemeden önce başlamış, uzlaştırmayla sahiplenilen işin jetonu açık kalmasın.
   */
  const jetonKapsamlari = (a: AktifIs): JetonKapsami[] => {
    const soru: JetonKapsami = { rol: "soru", is_id: a.is_id };
    if (a.tur !== "telefon") return [soru];
    return [soru, { rol: "telefon", is_id: a.is_id, plan_id: a.plan_id, plan_hash: a.plan_hash }];
  };

  // --- Sorular -----------------------------------------------------------------------------------

  const soruSonrasi = (soru_id: string, is_id: IsNo, sohbet_id: SohbetId, cikti: KullaniciyaSorCikti): void => {
    const iptal = zamanAsimlari.get(soru_id);
    if (iptal !== undefined) {
      iptal();
      zamanAsimlari.delete(soru_id);
    }
    // Olayda metin yok: ana oturuma cevap gidemesin diye `[karar]`.
    veriyolu.yayinla("soru_durumu", { soru_id, is_id, sohbet_id, durum: cikti.durum });
    const kume = bekleyenler.get(soru_id);
    if (kume !== undefined) for (const b of [...kume]) b.coz(cikti);
  };

  const soruyuKapat = (soru_id: string, durum: Exclude<SoruDurumu, "bekliyor">, cevap: string | null): void => {
    const s = depo.soruGetir(soru_id);
    if (s === null || s.durum !== "bekliyor") return;
    // Sorunun sohbeti işinkidir (`sorular` ⋈ `isler`). Yabancı anahtar işi garanti eder.
    const isKaydi = depo.isGetir(s.is_id);
    if (isKaydi === null) {
      gunluk.hata("isler", "soru_isi_yok", { soru_id, is_id: s.is_id });
      return;
    }
    const sohbet_id = isKaydi.sohbet_id;
    depo.islem(() => {
      depo.soruGuncelle(soru_id, durum, cevap);
      depo.olayEkle({
        type: "question_resolved",
        soru_id,
        is_id: s.is_id,
        sonuc: durum,
        ...(cevap === null ? {} : { cevap }),
        sohbet_id,
      });
      if (depo.bekleyenSorular(s.is_id).length === 0 && depo.isGetir(s.is_id)?.durum === "soru_bekliyor") {
        depo.isGuncelle(s.is_id, { durum: "calisiyor" });
      }
    });
    soruSonrasi(soru_id, s.is_id, sohbet_id, cevap === null ? { durum } : { durum, cevap });
  };

  const zamanAsimiKur = (s: SoruKaydi): void => {
    if (kapali || zamanAsimlari.has(s.soru_id)) return;
    const iptal = zamanlayici.sonra(Math.max(0, s.son_ms - saat.simdiMs()), () => {
      zamanAsimlari.delete(s.soru_id);
      if (kapali) return;
      try {
        soruyuKapat(s.soru_id, "zaman_asimi", null);
      } catch (e) {
        gunluk.hata("isler", "soru_zaman_asimi_hatasi", { soru_id: s.soru_id, hata_turu: hataTuru(e) });
      }
    });
    zamanAsimlari.set(s.soru_id, iptal);
  };

  /**
   * Kayıt her çağrıda yeniden okunur: cevap bu çağrıdan önce gelmişse bekleyen açılmaz, hemen döner.
   * `baglanti_koptu`da kayıt `bekliyor` kalır, köprü `soru_bekle` ile geri gelir; buradaki `iptal`
   * yalnız bu çağrının sonucudur ve kopmuş bağlantıya gittiği için kimseye ulaşmaz.
   */
  const soruyuBekle = (soru_id: string, sinyal: AbortSignal): Promise<KullaniciyaSorCikti> => {
    const s = depo.soruGetir(soru_id);
    if (s === null) return Promise.resolve({ durum: "iptal" });
    const biten = kayittanCikti(s);
    if (biten !== null) return Promise.resolve(biten);
    zamanAsimiKur(s);
    return new Promise<KullaniciyaSorCikti>((coz) => {
      const kume = bekleyenler.get(soru_id) ?? new Set<Bekleyen>();
      bekleyenler.set(soru_id, kume);
      const kesildi = (): void => {
        try {
          if (sinyal.reason === "model_iptal" && !kapali) soruyuKapat(soru_id, "iptal", null);
        } catch (e) {
          gunluk.hata("isler", "soru_iptal_hatasi", { soru_id, hata_turu: hataTuru(e) });
        }
        bekleyen.coz({ durum: "iptal" });
      };
      const bekleyen: Bekleyen = {
        coz(cikti) {
          sinyal.removeEventListener("abort", kesildi);
          kume.delete(bekleyen);
          if (kume.size === 0 && bekleyenler.get(soru_id) === kume) bekleyenler.delete(soru_id);
          coz(cikti);
        },
      };
      kume.add(bekleyen);
      if (sinyal.aborted) kesildi();
      else sinyal.addEventListener("abort", kesildi, { once: true });
    });
  };

  // --- Öldürme ve süpürme ------------------------------------------------------------------------

  const torunKaydet = async (liste: readonly AktifIs[]): Promise<void> => {
    const goruntu = await surec.anlikGoruntu();
    if (kapali) return;
    const pidle = new Map<number, SurecKaydi>();
    const cocuklar = new Map<number, SurecKaydi[]>();
    for (const s of goruntu) {
      pidle.set(s.pid, s);
      const l = cocuklar.get(s.ppid);
      if (l === undefined) cocuklar.set(s.ppid, [s]);
      else l.push(s);
    }
    const simdi = saat.simdiMs();
    for (const a of liste) {
      const yigin: SurecKaydi[] = [];
      // Kayıtlılar da tohumdur: kökü ölmüş dalın yeni çocukları yalnız böyle bulunur.
      for (const t of [...depo.isPidleri(a.is_id), ...(a.kimlik === null ? [] : [a.kimlik])]) {
        const s = pidle.get(t.pid);
        if (s !== undefined && ayniSurec(s, t)) yigin.push(s);
      }
      const gorulen = new Set<number>();
      for (let ebeveyn = yigin.pop(); ebeveyn !== undefined; ebeveyn = yigin.pop()) {
        if (gorulen.has(ebeveyn.pid)) continue;
        gorulen.add(ebeveyn.pid);
        for (const c of cocuklar.get(ebeveyn.pid) ?? []) {
          // Windows'ta `ppid` bayatlar: ebeveyninden yaşlı "çocuk" PID çakışmasıdır, bizim değildir.
          if (c.olusturmaMs + KIMLIK_PAYI_MS < ebeveyn.olusturmaMs) continue;
          yigin.push(c);
          const anahtar = pidAnahtari(c);
          if (a.pidler.has(anahtar)) continue;
          a.pidler.add(anahtar);
          depo.isPidEkle({ is_id: a.is_id, pid: c.pid, olusturmaMs: c.olusturmaMs, ad: c.ad, ilk_gorulme_ms: simdi });
        }
      }
    }
  };

  const sagKalanlar = async (hedefler: readonly SurecKimligi[]): Promise<SurecKimligi[]> => {
    const pidle = new Map((await surec.anlikGoruntu()).map((s) => [s.pid, s]));
    return hedefler.filter((h) => {
      const s = pidle.get(h.pid);
      return s !== undefined && ayniSurec(s, h);
    });
  };

  /** Ölü köke `/T` çalışmaz, yetim ancak kayıtla ölür. Sağlama anlık görüntüdür, çıkış kodu değil. */
  const supur = async (a: AktifIs): Promise<void> => {
    const hedefler = [...depo.isPidleri(a.is_id), ...(a.kimlik === null ? [] : [a.kimlik])];
    if (hedefler.length === 0) return;
    let kalan: number;
    try {
      const saglar = await sagKalanlar(hedefler);
      for (const s of saglar) {
        try {
          await surec.tekOldur(s.pid);
        } catch (e) {
          gunluk.uyari("isler", "tek_oldurme_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
        }
      }
      kalan = saglar.length === 0 ? 0 : (await sagKalanlar(hedefler)).length;
    } catch (e) {
      gunluk.hata("isler", "supurme_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
      notEkle(a.sohbet_id, "uyari", "diger", `İş ${a.is_id}: sağ kalan süreçler sayılamadı.`);
      return;
    }
    if (kalan > 0) {
      gunluk.uyari("isler", "sag_kalan_surec", { is_id: a.is_id, adet: kalan });
      notEkle(a.sohbet_id, "uyari", "diger", `İş ${a.is_id}: öldürme sonrası ${kalan} süreç hâlâ çalışıyor.`);
    }
  };

  /**
   * `pid` kayda geçmeden ölen servisin bıraktığı süreç. Aday: adı `claudeExe`, ebeveyni yaşamıyor,
   * başlatma penceresinde doğmuş, hiçbir aktif işin kaydında değil. Tek aday başka kayıtsız işin
   * penceresine de düşmüyorsa sahiplenilir. Penceresinde aday yoksa süreç ölüdür. Aksi belirsizdir:
   * ne sahiplenilir ne öldürülür ne de iş bitmiş sayılır; başkasının süreci ölmesin, izinsiz
   * oturum da kayıtsız kalmasın. Her yoklamada yeniden bakılır.
   */
  const kimlikAra = async (a: AktifIs): Promise<KimlikAramasi> => {
    if (a.kimlik !== null) return "bulundu";
    if (a.beklenenOlusma === null) return "yok";
    const goruntu = await surec.anlikGoruntu();
    const beklenen = a.beklenenOlusma;
    if (a.kimlik !== null) return "bulundu";
    if (beklenen === null || a.bitti) return "yok";
    const pidle = new Map(goruntu.map((s) => [s.pid, s]));
    const kayitli: SurecKimligi[] = [];
    const digerBaslatmalar: number[] = [];
    for (const k of depo.isListele(true, TUM_AKTIFLER)) {
      if (k.pid !== null && k.olusturma_ms !== null) kayitli.push({ pid: k.pid, olusturmaMs: k.olusturma_ms });
      else if (k.pid === null && k.olusturma_ms !== null && k.is_id !== a.is_id) digerBaslatmalar.push(k.olusturma_ms);
      kayitli.push(...depo.isPidleri(k.is_id));
    }
    const adaylar = goruntu.filter((s) => {
      if (s.ad.toLowerCase() !== claudeAdi || !baslatmaPenceresinde(beklenen, s.olusturmaMs)) return false;
      // Gerçek ebeveyn çocuktan önce doğar. Servis öldüyse PID'i ya boştur ya sonra doğan başkasınındır.
      const ebeveyn = pidle.get(s.ppid);
      if (ebeveyn !== undefined && ebeveyn.olusturmaMs <= s.olusturmaMs) return false;
      return !kayitli.some((k) => ayniSurec(s, k));
    });
    const [tek, ...fazla] = adaylar;
    if (tek === undefined) {
      a.beklenenOlusma = null;
      return "yok";
    }
    if (fazla.length === 0 && !digerBaslatmalar.some((t) => baslatmaPenceresinde(t, tek.olusturmaMs))) {
      depo.isGuncelle(a.is_id, { pid: tek.pid, olusturma_ms: tek.olusturmaMs });
      a.kimlik = { pid: tek.pid, olusturmaMs: tek.olusturmaMs };
      a.beklenenOlusma = null;
      gunluk.bilgi("isler", "kayitsiz_surec_sahiplenildi", { is_id: a.is_id });
      return "bulundu";
    }
    if (!a.belirsizBildirildi) {
      a.belirsizBildirildi = true;
      gunluk.uyari("isler", "kayitsiz_surec_belirsiz", { is_id: a.is_id, adet: adaylar.length });
      notEkle(
        a.sohbet_id,
        "uyari",
        "diger",
        `İş ${a.is_id}: servis süreci kaydetmeden kapandı; ${adaylar.length} aday var, hiçbiri kesin değil. ` +
          "Öldürülemez, adaylar bitince iş kapanır.",
      );
    }
    return "belirsiz";
  };

  const oldur = async (a: AktifIs): Promise<void> => {
    if (a.kimlik === null && a.beklenenOlusma !== null) {
      try {
        if ((await kimlikAra(a)) === "belirsiz") {
          notEkle(a.sohbet_id, "uyari", "diger", `İş ${a.is_id}: süreci kesinleşmediği için öldürülmedi.`);
        }
      } catch (e) {
        gunluk.uyari("isler", "kimlik_arama_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
        notEkle(a.sohbet_id, "uyari", "diger", `İş ${a.is_id}: süreci aranamadı, öldürülmedi.`);
      }
    }
    // Ölü kökün PID'i başkasına geçmiş olabilir: `/T` yalnız kimlik tutarsa.
    if (a.kimlik !== null) {
      try {
        if (await surec.surecVarMi(a.kimlik)) await surec.agaciOldur(a.kimlik.pid);
      } catch (e) {
        gunluk.uyari("isler", "agac_oldurme_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
      }
    }
    await supur(a);
  };

  // --- Bitiş -------------------------------------------------------------------------------------

  const bitir = async (a: AktifIs): Promise<void> => {
    if (a.bitti || kapali) return;
    const k = depo.isGetir(a.is_id);
    if (k === null) {
      a.bitti = true;
      aktifler.delete(a.is_id);
      return;
    }
    const kilitAktif = kilit.durum().tur === "aktif";
    // Bekçi `/T` kullanmaz, kilitli çıkışta torunlar yetim kalır. Doğal çıkışta süpürme yok:
    // serbest iş bilerek arka plan süreci bırakmış olabilir.
    if (kilitAktif && k.durdurma === null) await supur(a);
    if (a.bitti || kapali) return;

    const raporVerilen = k.rapor_kaynak === "rapor_ver" ? k.rapor : null;
    const durum = bitisDurumuBul({
      durdurma: k.durdurma,
      sonResult: k.son_result,
      raporVerVar: raporVerilen !== null,
      kilitAktif,
      zorunlu: a.zorunlu,
    });
    const secim = raporSec(k.son_result, raporVerilen);
    const acikSorular = depo.islem(() => {
      depo.isGuncelle(a.is_id, {
        durum,
        bitis_ms: saat.simdiMs(),
        rapor: secim.rapor,
        rapor_kaynak: secim.kaynak,
      });
      depo.olayEkle({
        type: "job_finished",
        is_id: a.is_id,
        durum,
        kirli: a.kirli,
        ...(secim.rapor === null ? {} : { rapor: secim.rapor }),
        sohbet_id: a.sohbet_id,
      });
      const sorular = depo.bekleyenSorular(a.is_id);
      for (const s of sorular) {
        depo.soruGuncelle(s.soru_id, "iptal", null);
        depo.olayEkle({
          type: "question_resolved",
          soru_id: s.soru_id,
          is_id: a.is_id,
          sonuc: "iptal",
          sohbet_id: a.sohbet_id,
        });
      }
      return sorular;
    });
    a.bitti = true;
    aktifler.delete(a.is_id);
    gunluk.bilgi("isler", "is_bitti", { is_id: a.is_id, durum, kirli: a.kirli });

    for (const s of acikSorular) soruSonrasi(s.soru_id, a.is_id, a.sohbet_id, { durum: "iptal" });
    for (const kapsam of jetonKapsamlari(a)) {
      try {
        kopru.jetonlariIptalEt(kapsam);
      } catch (e) {
        gunluk.hata("isler", "jeton_iptal_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
      }
    }
    veriyolu.yayinla("is_bitti", {
      is_id: a.is_id,
      plan_id: a.plan_id,
      tur: a.tur,
      durum,
      kirli: a.kirli,
      sohbet_id: a.sohbet_id,
    });
    veriyolu.yayinla("is_sayisi_degisti", { aktif: aktifler.size });
  };

  // --- Akış okuma --------------------------------------------------------------------------------

  const kopruleriDenetle = (a: AktifIs, sunucular: readonly McpSunucuDurumu[]): string[] => {
    a.initDenetlendi = true;
    return BEKLENEN_KOPRULER[a.tur].filter(
      (ad) => !sunucular.some((s) => s.name === ad && s.status === "connected"),
    );
  };

  /** Satırların etkisi ve ofset tek işlemde: yeniden başlayan servis aynı satırı iki kez sayamaz. */
  const partiIsle = (a: AktifIs, satirlar: readonly string[], tuketilen: number): void => {
    const yeniResultlar: IsSonResult[] = [];
    let init: Extract<AkisOlayi, { tur: "init" }> | null = null;
    let limit: Extract<AkisOlayi, { tur: "rate_limit" }> | null = null;
    for (const satir of satirlar) {
      const o = akis.satirCoz(satir);
      if (o === null) continue;
      if (o.tur === "init") init ??= o;
      // Gelen result öncekini ezer, ama geçerli rapor raporsuz sonrakine yenilmez (`sonResultSec`).
      else if (o.tur === "result") yeniResultlar.push(sonResultOzeti(o));
      else if (o.tur === "rate_limit") limit = o;
    }
    const eksikKopruler = init !== null && !a.initDenetlendi ? kopruleriDenetle(a, init.mcp_servers) : [];
    const ofset = a.ofset + tuketilen;
    depo.islem(() => {
      const mevcut = depo.isGetir(a.is_id);
      const calisiyor = init !== null && mevcut?.durum === "baslatiliyor";
      let sonResult: IsSonResult | null = null;
      if (yeniResultlar.length > 0) {
        sonResult = mevcut?.son_result ?? null;
        for (const y of yeniResultlar) sonResult = sonResultSec(sonResult, y);
      }
      depo.isGuncelle(a.is_id, {
        out_ofset: ofset,
        ...(sonResult === null ? {} : { son_result: sonResult }),
        ...(calisiyor ? { durum: "calisiyor" as const } : {}),
      });
      for (const ad of eksikKopruler) notEkle(a.sohbet_id, "uyari", "diger", `İş ${a.is_id}: ${ad} bağlı değil.`);
    });
    a.ofset = ofset;
    if (eksikKopruler.length > 0) {
      gunluk.uyari("isler", "kopru_bagli_degil", { is_id: a.is_id, adet: eksikKopruler.length });
    }
    // `-p` yavaş MCP'yi beklemez; araçsız telefon işi yalnız yanlış rapor üretir.
    if (a.tur === "telefon" && eksikKopruler.includes("eren-telefon")) a.telefonKoprusuz = true;
    if (limit !== null) {
      veriyolu.yayinla("limit_dolulugu", {
        doluluk: { besSaat: limit.besSaat, yediGun: limit.yediGun, olcumMs: saat.simdiMs() },
      });
    }
  };

  /** Dosya sonuna kadar okur. Yarım satır ofsete girmez, sonraki okumada baştan gelir. */
  const dosyayiOku = async (a: AktifIs): Promise<boolean> => {
    let boy = PARCA_BAYT;
    try {
      for (;;) {
        const baytlar = await dosya.aralikOku(a.out, a.ofset, boy);
        if (kapali || a.bitti) return false;
        if (baytlar.length === 0) break;
        const { satirlar, tuketilen } = ayirici.ayir(baytlar);
        if (tuketilen === 0) {
          if (baytlar.length < boy) break;
          if (boy < AZAMI_SATIR_BAYT) {
            boy *= 2;
            continue;
          }
          a.ofset += baytlar.length;
          depo.isGuncelle(a.is_id, { out_ofset: a.ofset });
          gunluk.uyari("isler", "dev_satir_atlandi", { is_id: a.is_id, bayt: baytlar.length });
          boy = PARCA_BAYT;
          continue;
        }
        partiIsle(a, satirlar, tuketilen);
        if (baytlar.length < boy) break;
        boy = PARCA_BAYT;
      }
      a.okumaHatasi = 0;
      return true;
    } catch (e) {
      a.okumaHatasi++;
      gunluk.uyari("isler", "akis_okuma_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
      return false;
    }
  };

  const canliMi = async (a: AktifIs): Promise<boolean> => {
    if (a.kimlik === null && a.beklenenOlusma === null) return false;
    try {
      // Kimliği belirsiz süreç canlı sayılır: bitmiş sayılırsa kayıtsız sürer.
      if (a.kimlik === null) return (await kimlikAra(a)) !== "yok";
      return await surec.surecVarMi(a.kimlik);
    } catch (e) {
      // Bilinmiyor: canlı sayılır, sonraki yoklama yeniden sorar.
      gunluk.uyari("isler", "surec_sorgu_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
      return true;
    }
  };

  const yoklamaGovdesi = async (a: AktifIs): Promise<void> => {
    if (a.bitti || kapali || a.basliyor) return;
    // Önce canlılık, sonra okuma: ölü süreç artık yazmaz, bu okuma dosyanın sonuna ulaşır.
    const canli = await canliMi(a);
    const okundu = await dosyayiOku(a);
    if (a.bitti || kapali) return;
    if (canli) {
      if (!a.telefonKoprusuz) return;
      a.zorunlu = "hata";
      await oldur(a);
      await dosyayiOku(a);
      await bitir(a);
      return;
    }
    // Geçici okuma hatasında son `result` kaybolmasın; ama iş sonsuza dek aktif de kalmasın.
    if (!okundu && a.okumaHatasi < OKUMA_HATASI_SINIRI) return;
    await bitir(a);
  };

  const yoklaIs = async (a: AktifIs): Promise<void> => {
    if (a.yoklamaKuyrukta || a.bitti) return;
    a.yoklamaKuyrukta = true;
    try {
      await sirala(a, async () => {
        a.yoklamaKuyrukta = false;
        await yoklamaGovdesi(a);
      });
    } catch (e) {
      a.yoklamaKuyrukta = false;
      gunluk.hata("isler", "yoklama_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
    }
  };

  const torunYokla = async (): Promise<void> => {
    if (kapali || torunYoklaniyor || aktifler.size === 0) return;
    torunYoklaniyor = true;
    try {
      await torunKaydet([...aktifler.values()]);
    } catch (e) {
      gunluk.uyari("isler", "torun_kayit_hatasi", { hata_turu: hataTuru(e) });
    } finally {
      torunYoklaniyor = false;
    }
  };

  // --- RAM ---------------------------------------------------------------------------------------

  const ramYokla = (): void => {
    if (kapali) return;
    try {
      const okuma = sistem.ramOku();
      const bosMb = mbTamSayi(okuma.bosMb);
      const toplamMb = mbTamSayi(okuma.toplamMb);
      const dusuk = bosMb < (ramDurumu.dusuk ? ayar.ramDusukMb + RAM_HISTEREZIS_MB : ayar.ramDusukMb);
      const onceki = ramDurumu;
      const ilk = !ramOkundu;
      ramOkundu = true;
      ramDurumu = { bosMb, toplamMb, dusuk };
      if (dusuk && !onceki.dusuk) notEkle(null, "uyari", "ram_dusuk", `RAM düşük: ${bosMb} MB boş.`);
      const degisti = bosMb !== onceki.bosMb || toplamMb !== onceki.toplamMb || dusuk !== onceki.dusuk;
      if (degisti && !ilk) veriyolu.yayinla("ram_degisti", { ram: { ...ramDurumu } });
    } catch (e) {
      gunluk.uyari("isler", "ram_okuma_hatasi", { hata_turu: hataTuru(e) });
    }
  };

  // --- Başlatma ve durdurma ----------------------------------------------------------------------

  const baslatmaGovdesi = async (
    a: AktifIs,
    plan: Plan,
    profil: IsProfili,
    sessionId: string,
  ): Promise<Sonuc<IsNo, IsBaslatmaHatasi>> => {
    const yollar = ayar.isYollari(a.is_id);
    try {
      const gorev = gorevMetni(plan);
      await dosya.dizinOlustur(yollar.dizin);
      if (plan.tur === "telefon") await dosya.dizinOlustur(yollar.bosCwd);
      await dosya.atomikYaz(yollar.gorev, gorev);

      const mcp =
        plan.tur === "telefon"
          ? telefonMcpYapilandirmasi(
              ayar,
              kopru.jetonUret({ rol: "telefon", is_id: a.is_id, plan_id: a.plan_id, plan_hash: a.plan_hash }),
            )
          : pcMcpYapilandirmasi(ayar, plan);
      await dosya.atomikYaz(yollar.mcp, JSON.stringify(mcp));

      if (plan.tur === "pc") {
        const masaustu = await sistem.masaustuDurumu().catch(() => "bilinmiyor" as const);
        if (masaustu === "kopuk") {
          // computer-use pencere listesini okur, screenshot hata verir ve hata metni yanıltıcıdır.
          notEkle(a.sohbet_id, "uyari", "diger", `İş ${a.is_id}: masaüstü oturumu kopuk, ekran görüntüsü alınamaz.`);
        }
      }

      // Yazımlar sürerken kilit kapanmış ya da iş durdurulmuş olabilir.
      if (kapali) return hata("ic_hata");
      const kilitKapali = !kilit.baslatmaSerbestMi();
      const durdurma = depo.isGetir(a.is_id)?.durdurma ?? null;
      if (kilitKapali || durdurma !== null) {
        if (durdurma === null) depo.isGuncelle(a.is_id, { durdurma: "limit" });
        await bitir(a);
        return hata(kilitKapali ? "limit_kilitli" : "ic_hata");
      }

      const girdi = { gorev, sessionId, mcpYol: yollar.mcp };
      const istek: AyrikSurecIstegi =
        plan.tur === "telefon"
          ? {
              exe: ayar.claudeExe,
              argv: telefonArgv(girdi, ayar.telefonIsModeli, ayar.kullaniciAdi),
              cwd: yollar.bosCwd,
              ortam: ayar.telefonIsOrtami(),
              outYol: yollar.out,
              errYol: yollar.err,
            }
          : {
              exe: ayar.claudeExe,
              argv: pcArgv(girdi, profil, ayar.pcIsModeli),
              cwd: plan.cwd,
              ortam: ayar.pcIsOrtami(),
              outYol: yollar.out,
              errYol: yollar.err,
            };
      // `pid` ancak oluşma anı okununca gelir (0,5-2 sn). O arada ölen servisin süreci kayıtsız
      // kalmasın: `pid` yokken `olusturma_ms` başlatma anıdır, uzlaştırma süreci bununla arar.
      // Yazımla başlatma arasında `await` yok.
      depo.isGuncelle(a.is_id, { olusturma_ms: saat.simdiMs() });
      const s = await surec.ayrikBaslat(istek);
      a.kimlik = { pid: s.pid, olusturmaMs: s.olusturmaMs };
      a.zorunlu = null;
      a.basliyor = false;
      depo.isGuncelle(a.is_id, { pid: s.pid, olusturma_ms: s.olusturmaMs });
      s.cikisDinle(() => {
        void yoklaIs(a);
      });
      gunluk.bilgi("isler", "is_basladi", { is_id: a.is_id, tur: a.tur });
      veriyolu.yayinla("is_basladi", { is_id: a.is_id, plan_id: a.plan_id, tur: a.tur, sohbet_id: a.sohbet_id });
      return { ok: true, deger: a.is_id };
    } catch (e) {
      // Hata metni görev metnini ya da yolu taşıyabilir: yalnız türü yazılır.
      gunluk.hata("isler", "is_baslatilamadi", { is_id: a.is_id, hata_turu: hataTuru(e) });
      a.basliyor = false;
      a.zorunlu = "hata";
      try {
        // `ayrikBaslat` attıysa süreç kesin açılmadı (ya da dış dünya öldürdü): başlatma izi silinir,
        // yoksa servis ölümüyle bitiş tablosuna düşen iş ile ayırt edilemez ve yeniden onay engellenir.
        if (a.kimlik === null) depo.isGuncelle(a.is_id, { olusturma_ms: null });
        if (a.kimlik !== null) await oldur(a);
        await bitir(a);
      } catch (e2) {
        gunluk.hata("isler", "bitis_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e2) });
      }
      return hata("ic_hata");
    }
  };

  const durdurmaYurut = async (a: AktifIs): Promise<void> => {
    try {
      await a.baslama;
      await sirala(a, async () => {
        if (a.bitti || kapali) return;
        await oldur(a);
        await dosyayiOku(a);
        await bitir(a);
      });
    } finally {
      a.durdurmaSozu = null;
    }
  };

  const durdur: IsYoneticisi["durdur"] = async (is_id, neden, sahip) => {
    const k = depo.isGetir(is_id);
    // Sahip (ana oturumun `oturum_durdur`'u) yalnız kendi sohbetinin işini durdurur; başkasınınki yokmuş gibi
    // (`zaten_bitmis` bile değil: var olduğu sızmaz). Sahipsiz çağrı (kullanıcı, izin, kilit) süzgeçsiz.
    if (k === null || (sahip !== undefined && !sohbettenMi(k, sahip))) return hata("is_bulunamadi");
    if (bitmisMi(k.durum)) return { ok: true, deger: { is_id, sonuc: "zaten_bitmis" } };
    let a = aktifler.get(is_id);
    if (a === undefined) {
      // Uzlaştırmadan önce gelen istek: satır aktif ama henüz sahiplenilmemiş.
      a = aktifKur(k);
      aktifler.set(is_id, a);
    }
    if (a.durdurmaSozu !== null) {
      await a.durdurmaSozu;
      return { ok: true, deger: { is_id, sonuc: "zaten_bitmis" } };
    }
    if (k.durdurma === null) depo.isGuncelle(is_id, { durdurma: neden });
    a.durdurmaSozu = durdurmaYurut(a);
    await a.durdurmaSozu;
    return { ok: true, deger: { is_id, sonuc: "durduruldu" } };
  };

  const arkaPlandaDurdur = (is_id: IsNo, neden: Exclude<BitisNedeni, "dogal">): void => {
    durdur(is_id, neden).catch((e: unknown) => {
      gunluk.hata("isler", "durdurma_hatasi", { is_id, hata_turu: hataTuru(e) });
    });
  };

  // --- Kurulum: yoklamalar ve dinleyiciler -------------------------------------------------------

  ramYokla();

  const iptaller: IptalEt[] = [
    zamanlayici.herAralik(ayar.sureler.isYoklamaMs, () => {
      for (const a of [...aktifler.values()]) void yoklaIs(a);
    }),
    zamanlayici.herAralik(ayar.sureler.torunYoklamaMs, () => {
      void torunYokla();
    }),
    zamanlayici.herAralik(ayar.sureler.ramYoklamaMs, ramYokla),
    // Tam PC işlerine dokunulmaz, mod kendini dondurur; kökü ölürse yoklama süpürür. Hafif PC işi limit
    // modunu yüklemez: telefon işiyle aynı yoldan durur. `belirsiz`: kimse ölmez.
    veriyolu.dinle("kilit_degisti", ({ durum }) => {
      if (durum.tur !== "aktif") return;
      for (const a of [...aktifler.values()]) if (a.kilitteDurur) arkaPlandaDurdur(a.is_id, "limit");
    }),
    // Yalnız kullanıcının `Durdur`'u. Diğer nedenlerde oturum `denied` alır, kendi biter.
    veriyolu.dinle("izin_gitti", ({ plan_id, neden }) => {
      if (neden !== "kullanici_durdurdu") return;
      const k = depo.isPlanaGore(plan_id);
      if (k !== null && !bitmisMi(k.durum)) arkaPlandaDurdur(k.is_id, "izin_durduruldu");
    }),
  ];

  return {
    async uzlastir() {
      let sahiplenilen = 0;
      let biten = 0;
      // Map: kimlik telefon metnidir, `__proto__` gibi bir anahtar düz nesnede prototipe yazardı.
      const sohbetSayilari = new Map<SohbetId, UzlastirmaOzeti>();
      const satirlar = depo.isListele(true, TUM_AKTIFLER).reverse();
      for (const k of satirlar) {
        if (aktifler.has(k.is_id)) continue;
        const a = aktifKur(k);
        aktifler.set(a.is_id, a);
        try {
          const canli = await canliMi(a);
          await sirala(a, async () => {
            const okundu = await dosyayiOku(a);
            if (!canli && okundu) await bitir(a);
          });
          // Kilit olayı bu modül kurulmadan yayınlandı: telefon ve hafif PC işinin tepkisi burada kalır.
          if (canli && !a.bitti && (k.durdurma !== null || (a.kilitteDurur && kilit.durum().tur === "aktif"))) {
            await durdur(a.is_id, k.durdurma === null || k.durdurma === "dogal" ? "limit" : k.durdurma);
          }
        } catch (e) {
          // İş aktif listede kalır, yoklama yeniden dener; bir satır açılışı durdurmaz.
          gunluk.hata("isler", "uzlastirma_hatasi", { is_id: a.is_id, hata_turu: hataTuru(e) });
        }
        let ozet = sohbetSayilari.get(a.sohbet_id);
        if (ozet === undefined) {
          ozet = { sahiplenilen: 0, biten: 0 };
          sohbetSayilari.set(a.sohbet_id, ozet);
        }
        if (a.bitti) {
          biten++;
          ozet.biten++;
        } else {
          sahiplenilen++;
          ozet.sahiplenilen++;
        }
      }
      for (const s of depo.bekleyenSorular()) zamanAsimiKur(s);
      if (sahiplenilen + biten > 0) {
        // Küresel not (alansız); sohbet başına sayılar yalnız yayında, her örnek kendi girdisini okur.
        notEkle(
          null,
          "bilgi",
          "is_uzlastirildi",
          `Servis yeniden başladı: ${sahiplenilen} iş sahiplenildi, ${biten} iş bitti.`,
        );
        veriyolu.yayinla("isler_uzlastirildi", {
          sahiplenilen,
          biten,
          sohbetler: Object.fromEntries(sohbetSayilari),
        });
        veriyolu.yayinla("is_sayisi_degisti", { aktif: aktifler.size });
      }
      return { sahiplenilen, biten };
    },

    async baslat({ plan, plan_hash, profil, sohbet_id }) {
      if (kapali) return hata("ic_hata");
      if (!kilit.baslatmaSerbestMi()) return hata("limit_kilitli");

      // Telefon işinde yok sayılır. Yalnız açık `hafif` hafiftir: alanı vermeyen eski çağıran `tam` alır.
      const pcProfili: IsProfili = profil === "hafif" ? "hafif" : VARSAYILAN_IS_PROFILI;
      const sessionId = rastgele.uuid();
      let a: AktifIs;
      try {
        a = depo.islem(() => {
          const is_id = depo.isEkle({
            // Planın sohbeti, depodaki plan kaydından (`planlar` verir). Sorular da bu işin sohbetidir.
            sohbet_id,
            plan_id: plan.plan_id,
            plan_hash,
            baslik: plan.baslik,
            tur: plan.tur,
            cwd: plan.cwd,
            durum: "baslatiliyor",
            // Zincir geçişlidir: kirli rapora dayanan PC işinin raporu da kirlidir.
            kirli: plan.tur === "telefon" || (plan.kirli_kaynak?.length ?? 0) > 0,
            session_id: sessionId,
            pid: null,
            olusturma_ms: null,
            baslangic_ms: saat.simdiMs(),
            bitis_ms: null,
            out_ofset: 0,
            rapor: null,
            rapor_kaynak: null,
            son_result: null,
            durdurma: null,
          });
          if (plan.tur === "telefon") depo.isGuncelle(is_id, { cwd: ayar.isYollari(is_id).bosCwd });
          depo.olayEkle({
            type: "job_started",
            is_id,
            plan_id: plan.plan_id,
            plan_hash,
            baslik: plan.baslik,
            tur: plan.tur,
            ...(plan.tur === "pc" ? { profil: pcProfili } : {}),
            sohbet_id,
          });
          const k = depo.isGetir(is_id);
          if (k === null) throw new Error("is_satiri_yok");
          return aktifKur(k, pcProfili);
        });
      } catch (e) {
        gunluk.hata("isler", "is_satiri_yazilamadi", { hata_turu: hataTuru(e) });
        return hata("ic_hata");
      }

      a.basliyor = true;
      let baslamaBitti = (): void => {};
      a.baslama = new Promise<void>((coz) => {
        baslamaBitti = coz;
      });
      aktifler.set(a.is_id, a);
      veriyolu.yayinla("is_sayisi_degisti", { aktif: aktifler.size });
      try {
        return await baslatmaGovdesi(a, plan, pcProfili, sessionId);
      } finally {
        a.basliyor = false;
        baslamaBitti();
      }
    },

    durdur,

    // Dilim 2 (M4): ana oturum yalnız kendi sohbetinin işlerini görür. Süzgeç depoda, adet sınırından önce.
    oturumlar(girdi, sohbet) {
      const kayitlar = depo.isListele(girdi.yalniz_aktif === true, SINIRLAR.OTURUM_ADET, sohbet);
      return {
        oturumlar: kayitlar.map((k) => ({
          is_id: k.is_id,
          baslik: k.baslik,
          tur: k.tur,
          durum: k.durum,
          baslangic_ms: k.baslangic_ms,
          ...(k.bitis_ms === null ? {} : { bitis_ms: k.bitis_ms }),
          kirli: k.kirli,
        })),
        ram_bos_mb: ramDurumu.bosMb,
        ram_toplam_mb: ramDurumu.toplamMb,
        ram_dusuk: ramDurumu.dusuk,
      };
    },

    raporOku(is_id, sohbet) {
      const k = depo.isGetir(is_id);
      // Başka sohbetin işi yokmuş gibi: gövde okunmaz, `kirli_okundu` yayınlanmaz, `rapor_yok` bile denmez.
      if (k === null || !sohbettenMi(k, sohbet)) return hata("is_bulunamadi");
      if (!bitmisMi(k.durum) || k.rapor === null) return hata("rapor_yok");
      const cit = rastgele.hex64();
      if (k.kirli) {
        // Gövde verilmese de yayınlanır: ana oturum kabuğuyla iş dosyalarını okumuş olabilir, zincir ihtiyatlı kalır.
        // `sohbet_id` OKUYANIN sohbeti (burada işinkiyle aynı; süzgeç başkasınınkini zaten keser).
        veriyolu.yayinla("kirli_okundu", { is_id, sohbet_id: sohbet.sohbet_id });
        if (!ayar.tamYetki) {
          return {
            ok: true,
            deger: { is_id, durum: k.durum, kirli: true, cit, govde: KIRLI_RAPOR_NOTU, kirpildi: false },
          };
        }
        // Tam yetki: gövde de çitli döner, `kirli: true` kalır.
        const t = raporGovdesi(k.rapor, SINIRLAR.RAPOR_GOVDE - citleSar(cit, "").length);
        return {
          ok: true,
          deger: { is_id, durum: k.durum, kirli: true, cit, govde: citleSar(cit, t.govde), kirpildi: t.kirpildi },
        };
      }
      const { govde, kirpildi } = raporGovdesi(k.rapor, SINIRLAR.RAPOR_GOVDE - citleSar(cit, "").length);
      return {
        ok: true,
        deger: { is_id, durum: k.durum, kirli: k.kirli, cit, govde: citleSar(cit, govde), kirpildi },
      };
    },

    raporVer(is_id, rapor) {
      const k = depo.isGetir(is_id);
      if (k === null) return hata("is_bulunamadi");
      if (bitmisMi(k.durum)) return hata("is_zaten_bitti");
      if (k.rapor !== null) return hata("rapor_zaten_verildi");
      depo.isGuncelle(is_id, { rapor, rapor_kaynak: "rapor_ver" });
      return { ok: true, deger: { kabul: true } };
    },

    async soruSor(is_id, girdi, sinyal) {
      const { soru_id } = girdi;
      const mevcut = depo.soruGetir(soru_id);
      if (mevcut !== null) {
        // Başka işin soru kimliğine bağlanılmaz: o sorunun cevabı bu işe sızardı.
        if (mevcut.is_id !== is_id) return hata("is_zaten_bitti");
        return { ok: true, deger: await soruyuBekle(soru_id, sinyal) };
      }
      const k = depo.isGetir(is_id);
      if (k === null || bitmisMi(k.durum)) return hata("is_zaten_bitti");
      if (kilit.durum().tur === "aktif") return hata("limit_kilitli");
      if (sinyal.aborted) return { ok: true, deger: { durum: "iptal" } };

      const simdi = saat.simdiMs();
      depo.islem(() => {
        depo.soruEkle({
          soru_id,
          is_id,
          soru: girdi.soru,
          secenekler: girdi.secenekler ?? null,
          durum: "bekliyor",
          cevap: null,
          olusturma_ms: simdi,
          son_ms: simdi + ayar.sureler.soruZamanAsimiMs,
        });
        depo.olayEkle({
          type: "question_asked",
          soru_id,
          is_id,
          soru: girdi.soru,
          ...(girdi.secenekler === undefined ? {} : { secenekler: girdi.secenekler }),
          sohbet_id: k.sohbet_id,
        });
        depo.isGuncelle(is_id, { durum: "soru_bekliyor" });
      });
      const bekleme = soruyuBekle(soru_id, sinyal);
      veriyolu.yayinla("soru_durumu", { soru_id, is_id, sohbet_id: k.sohbet_id, durum: "soruldu" });
      return { ok: true, deger: await bekleme };
    },

    async soruBekle(is_id, girdi, sinyal) {
      const s = depo.soruGetir(girdi.soru_id);
      if (s === null || s.is_id !== is_id) return hata("soru_bulunamadi");
      return { ok: true, deger: await soruyuBekle(girdi.soru_id, sinyal) };
    },

    soruCevapla(soru_id, cevap) {
      const s = depo.soruGetir(soru_id);
      if (s === null) return hata("soru_bulunamadi");
      if (s.durum !== "bekliyor") return hata("soru_zaten_cevaplandi");
      soruyuKapat(soru_id, "cevaplandi", cevap);
      return { ok: true, deger: undefined };
    },

    // Bellekteki aktifler: başlatılan, sahiplenilen ve durdurulmakta olan işler. Sohbetsiz: hepsi.
    aktifSayisi(sohbet) {
      if (sohbet === undefined) return aktifler.size;
      let adet = 0;
      for (const a of aktifler.values()) if (a.sohbet_id === sohbet.sohbet_id) adet++;
      return adet;
    },

    ram() {
      return { ...ramDurumu };
    },

    kapat() {
      if (kapali) return;
      kapali = true;
      for (const iptal of iptaller) iptal();
      // Sorular depoda `bekliyor` kalır: sonraki açılış zamanlayıcıyı yeniden kurar, köprü `soru_bekle` ile döner.
      for (const iptal of zamanAsimlari.values()) iptal();
      zamanAsimlari.clear();
    },
  };
};
