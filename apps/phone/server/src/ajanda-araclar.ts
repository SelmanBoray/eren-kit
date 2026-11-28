import {
  AJANDA_SINIRLARI,
  type AjandaAlanDegisikligi,
  type AjandaFiili,
  type AjandaKaydi,
  type AjandaKayitOzeti,
  type AjandaKaynagi,
  type AjandaYazar,
  type AjandaYerelAn,
  type AjandaZamani,
  type AjandaAracKurali,
  ARAC_YOLLARI,
  ajandaAracCiktisiV2,
  ajandaAracEsBirlesimi,
  ajandaAracKaydi,
  ajandaAraclari,
  ajandaAracTekrari,
  ajandaAracVarsayilanHatirlatmalari,
  ajandaBildirimYokMu,
  ajandaBolgeAnahtari,
  AJANDA_ARAC_BOLGE_ADET,
  ajandaDegisikligiUygula,
  ajandaTekilAnahtari,
  ajandaTekilKarari,
  ajandaZamanDegisikligiCoz,
  dayanakGecerliMi,
  geceSorulduAyniTurdaMi,
  geceTeyidiEksikMi,
  kullaniciEmriMi,
  OpakId,
  PC_TEKIL_KAPSAMI,
  type PcTurKarari,
  tarihliGirdiMi,
  type ZamandaKorunan,
} from "@eren/protocol";
import type { PcDefteri } from "./ajanda-pc.ts";
import {
  degisiklikAni,
  dilimlerBilinir,
  dogrulaVeYaz,
  dogumParcasi,
  fark,
  govde,
  hatirlatmaDoldur,
  kayitOzeti,
  MODUL,
  verilenAlanlar,
  type YeniHal,
  zamanDoldur,
} from "./ajanda-ortak.ts";
import type {
  AjandaBagimliliklari,
  AjandaFiilCiktisi,
  AjandaFiilGirdisi,
  AjandaFiilIsleyici,
  AjandaFiilIsleyiciler,
  AjandaKopruBaglami,
  AjandaTurBaglami,
} from "./sozlesme.ts";

/**
 * Ajanda borusunun fiil işleyicileri (`AjandaYoneticisi.araclar`): `ajanda_ekle`, `ajanda_guncelle`,
 * `ajanda_listele`. Kurallar `docs/AJANDA.md` "Araç yolu", "Çakışma ve otomasyon kuralları".
 *
 * - Turun kökeni ve mesaj anı YALNIZ `turBaglami`'ndan (jetonun sohbeti + nesli); yoksa `tur_gecersiz`,
 *   hiçbir şey yazılmaz. Yazar `{yol:"sohbet_araci", tur_kokeni, sohbet_id}`.
 * - PC oturumu (`pc_oturumu`, AJANDA.md "PC oturumları"): tur PC defterinden (`ajanda-pc.ts`; ana
 *   ajanın kancayla tasdikli çağrısı insan, öteki her çağrı sentetik; mesaj anı her zaman çağrının
 *   servise vardığı an); defterin kararı sonuçla döner (`pc_karar`).
 *   Yazar `{yol:"pc_araci", tur_kokeni, oturum_id}`,
 *   tekil kapsam `PC_TEKIL_KAPSAMI`; kurallar (taslak, alan koruması, dayanak, gece, tekilleştirme,
 *   alıntı) telefon yolundakilerle aynıdır.
 * - Takvime bağlı girdi `dayanakGecerliMi(dayanak, mesaj_ani)` ister (`dayanak_uyusmuyor`); hemen
 *   ardından (v2) `geceTeyidiEksikMi(girdi, mesaj_ani, tur_kokeni)` doğruysa `gece_teyidi_gerekli`
 *   (insan turunda, mesaj anı 00:00-04:00, takvime bağlı ve `dayanak.gece_teyidi` yok; sentetik turda
 *   hiç); ikisi de kayda dokunmadan önce, güncellemede kayıt aranmadan önce. Servis reddi verdiği
 *   turu sohbet başına bellekte tutar: aynı turda gelen `soruldu` da reddedilir (`geceSorulduAyniTurdaMi`,
 *   çıktıda `ayni_tur:true`); `gun_acik` aynı turda geçerlidir. Dilimsiz
 *   zaman ve `mutlak` hatırlatma turun mesaj anının dilimini alır; dilim veritabanında yoksa
 *   `saat_dilimi_bilinmiyor`.
 * - Ekleme: tekil anahtar (`sohbet:<id>` kapsamı) → `ajandaTekilKarari`; emir olmayan turda taslak
 *   doğar; emirde açık eşe `ajandaAracEsBirlesimi` işlenir (eş taslaksa aynı yazımda onay; eş başka bir
 *   konuşma bağlamının taslağıysa, PC'de başka oturum, insanın vermediği alan taşınmaz). Emirle doğan
 *   kayıtta açıkça verilen alanlar `elle_alanlar`'a girer (varsayılan hatırlatma girmez).
 * - Güncelleme: sentetik turda taslak olmayan kayda değişiklik ya da herhangi bir onay
 *   `sentetik_turda_izinsiz`; elle alanlar korunur (`korunan_alanlar`). Zaman kaydın var olan
 *   zamanıyla birleşir (`ajandaZamanDegisikligiCoz`: verilmeyen saat, süre, gün bölümü korunur, `null`
 *   kaldırır); taşınanlar `zamanda_korunan`, gün hatırlatmasının saati değiştiyse eskisi
 *   `onceki_gun_hatirlatmasi` ile döner.
 * - Sürüm 3 (`docs/AJANDA.md` "Sürüm 3", "Araç yolu"): `simge`, `bolge` (yalnız ad), `varis`,
 *   `baglantilar` ve dar `tekrar` (`ajandaAracTekrari`: günlük ya da haftalık, bitişsiz, yalnız varışlı
 *   kayıtta) girer; `bolge_konumu` ve `ekler` araç girdisinde yoktur. Tekil anahtara bölge (varsa) girer.
 *   Hatırlatma verilmezse varsayılan kaydın zamanına göredir (`ajandaAracVarsayilanHatirlatmalari`): saatli
 *   ya da tarihli tek seferlik varışlı kayıtta olağan varsayılan (varış ona eklenir), zamansız varışlı
 *   kayıtta ve tekrarda `[]` (bildirim yalnız varıştan).
 *   Güncellemede birleşmiş kayıt araç kuralını bozarsa (`varis` bölgesiz; asistanın kurduğu tekrar
 *   varışsız; asistanın kurmadığı tekrar değişiyor) `tutarsiz_kayit` + `kural` (`aracKuraliBozuk`).
 *   Tekrarın sahibi onu son yazan geçmiş satırıdır (`tekrarAracinMi`): yazarı asistan aracı yolu
 *   (`ARAC_YOLLARI`) değilse (kullanıcı telefonda kurdu) araç o tekrarı ne değiştirir ne kaldırır
 *   (`tekrar_kullanicinin`; eşe eklemede de); "yalnız varışlı" kuralı ona uygulanmaz, varış ve bölge
 *   seriye dokunmadan kalkar. v3 öncesinde araç tekrara hiç dokunamıyordu: güvenlik çizgisi budur.
 *   Bir bölge adı veren başarılı çağrıda konumlu, silinmemiş, aynı eşleşme
 *   anahtarlı hiçbir kayıt yoksa `bolge_yeni:true` (`bolgeYeniMi`). Sentetik turdaki varışlı ekleme de
 *   taslak doğar (kural değişmedi).
 * - Gizlilik: liste kayıtları YALNIZ `ajandaAracKaydi`'dan geçerek döner (konum düşer, ekler sayıya iner);
 *   boru sınırı (`ajanda-kopru-sunucu.ts`) çıktıyı katı `AJANDA_ARACLARI[fiil].cikti` ile denetler, süzgeci
 *   atlayan kayıt `ic_hata` olur, sızmaz. Günlüğe kayıt alanı (bölge adı, konum) girmez.
 * - v3 araç yüzü (`b.aracV3`, ayar `ajanda_arac_v3`; verilmezse kapalı): kapalıyken girdi v2 şemasıyla
 *   denetlenir (`ajandaAraclari(false)`: v3 alanı geçmez, araçla v3 alanlı kayıt doğmaz) ve her çıktı v2
 *   yüzüne iner (`ajandaAracCiktisiV2`: özet `varis`, `bolge_yeni`, `kural`, `bolgeler` yok; liste kaydı v2
 *   görünümü; varışlı kayıtta yanlış "bildirim yok" uyarısı doğmasın diye `v2Yuzu`). v3 telefonun yazdığı
 *   v3 alanları kayıtta kalır; eş birleşmesi ve güncelleme onlara dokunmaz.
 *   Telefon sohbeti ve PC oturumu aynı yüzü görür. Ayar açıkken çıktının yüzünü bağlantının yüzü belirler
 *   (işleyicinin dördüncü argümanı `v3Yuz`, boru sunucusu `bag.v3`'ü verir; verilmezse ayar): v2 yüzlü
 *   bağlantı (eski köprü, düz hello'ya düşmüş köprü) ayar kapalıykenki v2 yüzünü aynen alır. Girdi şeması da
 *   aynı yüzden: v2 yüzlü bağlantının v3 alanı ayar açıkken de "bilinmeyen alan" ile reddedilir.
 * - Her işleyici eşzamanlıdır (araya `await` girmez) ve tek `depo.islem` içinde yazar.
 */

type Cikti<F extends AjandaFiili> = AjandaFiilCiktisi<F>;

/**
 * Çağrının yolu: kim yazıyor, turu ne, kayıt hangi kapsamda tekilleşir. Telefon sohbeti
 * (`ana_oturum`): yol `sohbet_araci`, kapsam `sohbet:<id>`, gece reddi sohbet başına. PC oturumu
 * (`pc_oturumu`, AJANDA.md "PC oturumları"): yol `pc_araci`, `oturum_id`, kapsam `PC_TEKIL_KAPSAMI`,
 * gece reddi oturum başına; tur PC defterinden.
 */
interface Cagri {
  tur: AjandaTurBaglami;
  yazar: AjandaYazar;
  /** `tekil_anahtar`, `kaynak_msg_id`, `alinti` dışındaki kaynak izi. */
  kaynakTemeli: Pick<AjandaKaynagi, "yol" | "tur_kokeni" | "sohbet_id" | "oturum_id">;
  tekilKapsam: string;
  /** Gece reddinin aynı tur kuralının anahtarı (sohbet ya da oturum). */
  geceAnahtari: string;
  /** Günlük alanları: kimlik, metin yok. */
  iz: Record<string, string | number>;
  /** Yalnız PC: defterin kararı (köprüye döner). */
  pcKarar?: PcTurKarari;
  /** Çıktının yüzü v3 mü: ayar açık ve bağlantının yüzü v3 (`isleyici`'nin `v3Yuz`'u). */
  v3Yuz: boolean;
}

type Govde<F extends AjandaFiili> = (girdi: AjandaFiilGirdisi<F>, c: Cagri, simdi: number) => Cikti<F>;

/** Araçta modelin dokunabildiği alanlar (kaynak, konum ve ek yok; tekrar yalnız dar araç tekrarı). */
type AracAlanlari = Pick<
  AjandaAlanDegisikligi,
  "tur" | "baslik" | "aciklama" | "zaman" | "hatirlatmalar" | "durum" | "tekrar" | "simge" | "bolge" | "varis" | "baglantilar"
>;

/**
 * Birleşmiş kaydın araç kuralları (güncelleme). `onceki`: değişiklikten önceki kayıt; `aracinTekrari`: onun
 * tekrarını asistan mı kurdu (`tekrarAracinMi`; tekrarsızda önemsiz).
 * - `tekrar_kullanicinin`: asistanın kurmadığı tekrar bu değişiklikle değişiyor ya da kalkıyor.
 * - `varis_bolge_ister`: varış bölgesiz kaldı.
 * - `tekrar_varis_ister`: birleşmiş kayıtta varışsız kalan tekrar asistanınki (bu değişiklikle kuruldu ya da
 *   asistanın kurduğu tekrardan varış kalktı). Kullanıcının tekrarı varışsız kalabilir: kural ona uygulanmaz.
 */
function aracKuraliBozuk(
  onceki: AjandaKaydi,
  k: AjandaKaydi,
  uygulanan: readonly string[],
  aracinTekrari: () => boolean,
): AjandaAracKurali | null {
  const tekrarDegisti = uygulanan.includes("tekrar");
  if (tekrarDegisti && onceki.tekrar !== undefined && !aracinTekrari()) return "tekrar_kullanicinin";
  if (k.varis !== undefined && k.bolge === undefined) return "varis_bolge_ister";
  if (k.tekrar !== undefined && k.varis === undefined && (tekrarDegisti || (uygulanan.includes("varis") && aracinTekrari()))) {
    return "tekrar_varis_ister";
  }
  return null;
}

/** Büyük/küçük harf duyarsız arama katlaması (Türkçe I/İ/ı dahil). */
const katla = (s: string): string => s.normalize("NFC").toLocaleLowerCase("tr").replaceAll("ı", "i");

function araligaDeger(z: AjandaZamani | undefined, bas: string | undefined, bit: string | undefined): boolean {
  if (z === undefined || z.kesinlik === "belirsiz") return false;
  const ilk = z.kesinlik === "donem" ? z.baslangic : z.tarih;
  const son = z.kesinlik === "donem" ? z.bitis : z.tarih;
  return (bas === undefined || son >= bas) && (bit === undefined || ilk <= bit);
}

/** Tarihlilerin sıra anahtarı: gün, sonra saat (saatsiz gün günün başında). Tarihsizde `undefined`. */
function siraAnahtari(z: AjandaZamani | undefined): string | undefined {
  if (z === undefined || z.kesinlik === "belirsiz") return undefined;
  if (z.kesinlik === "an") return `${z.tarih} ${z.saat}`;
  return `${z.kesinlik === "donem" ? z.baslangic : z.tarih} `;
}

/** Hatırlatması olmayan özetin hatırlatma hali (`v2Yuzu`). */
const BOS_HATIRLATMA = { toplam: 0, kurulacak: 0, saatsiz: 0, gecmis: 0 } as const;

/**
 * v2 yüzde (ayar kapalı ya da bağlantı v2 yüzlü) özet boş hatırlatmaya iner mi: varışlı kayıtta zaman hatırlatmalarından hiçbiri kurulmayacaksa
 * (`ajandaBildirimYokMu`). v2 yüzü varışı söyleyemez; gerçek sayılarla v2 metni "hiçbir bildirim gelmeyecek"
 * derdi, oysa telefon varışta bildirim verir. Bu yanlış iddia kullanıcıya yanlış bir şey söyletir; boş hatırlatma
 * ("hatirlatma=yok") ise etkide doğrudur (zamandan bildirim gelmeyecek) ve v2 şemasında söylenebilen tek doğru
 * haldir. Bilinen bedel: hatırlatmalar geçmişte dursa da kapalı yüz onları göstermez (açık yüz gösterir).
 */
const v2HatirlatmasizMi = (o: AjandaKayitOzeti): boolean => o.varis !== undefined && ajandaBildirimYokMu(o);

/**
 * v2 yüzde çıktının v2 yüzü (`ajandaAracCiktisiV2`). v3 telefonun yazdığı varışlı kayıtta özetten
 * `varis` düşer; `v2HatirlatmasizMi` ise özetin hatırlatması boş hatırlatmaya iner (metin `hatirlatma=yok.`
 * der, bildirim iddiası ve v3 alanı taşımaz). Güncellemenin `onceki_gun_hatirlatmasi`'sı aynı yüzden
 * hesaplanır (`guncelle`): not özetle çelişmez. Varışsız kayıtta ve öteki hallerde çıktı
 * `ajandaAracCiktisiV2`'ninkidir, baytları değişmez.
 */
function v2Yuzu(fiil: AjandaFiili, ham: unknown): unknown {
  const v2 = ajandaAracCiktisiV2({ fiil, cikti: ham } as never).cikti as { kayit?: unknown };
  const kayit = (ham as { kayit?: AjandaKayitOzeti }).kayit;
  if (kayit !== undefined && v2.kayit !== undefined && v2HatirlatmasizMi(kayit)) {
    v2.kayit = { ...(v2.kayit as object), hatirlatma: { ...BOS_HATIRLATMA } };
  }
  return v2;
}

export function ajandaAraclariKur(b: AjandaBagimliliklari, pc?: PcDefteri): AjandaFiilIsleyiciler {
  const { depo, takvim, saat, rastgele, gunluk } = b;
  const v3 = b.aracV3 === true;
  // Girdi şeması bağlantının yüzünden (`Cagri.v3Yuz`): ayar açıkken de v2 yüzlü bağlantı v2 şemasıyla denetlenir.
  const v3Araclari = ajandaAraclari(true);
  const v2Araclari = ajandaAraclari(false);
  const ozet = (k: AjandaKaydi, simdi: number) => kayitOzeti(k, simdi, takvim);

  /**
   * Kaydın şimdiki tekrarını asistan aracı mı kurdu: tekrarı son yazan (ekleme ya da tekrarı değiştiren)
   * geçmiş satırının yazarı `ARAC_YOLLARI`'nda mı. Tekrar yoksa ya da geçmişte böyle bir satır bulunmazsa
   * hayır (bilinmeyen sahip kullanıcınındır: araç dokunmaz). Geçmiş `rev` azalan, sayfa sayfa okunur.
   */
  const tekrarAracinMi = (k: AjandaKaydi): boolean => {
    if (k.tekrar === undefined) return false;
    const SAYFA = 100;
    let once_rev: number | undefined;
    for (;;) {
      const sayfa = depo.ajandaGecmisi({ kayit_id: k.kayit_id, adet: SAYFA, ...(once_rev === undefined ? {} : { once_rev }) });
      const satir = sayfa.find((g) => g.sonraki.tekrar !== undefined);
      if (satir !== undefined) return (ARAC_YOLLARI as readonly string[]).includes(satir.yazar.yol);
      if (sayfa.length < SAYFA) return false;
      once_rev = sayfa[sayfa.length - 1]!.rev;
    }
  };

  /**
   * `bolge_yeni`: kaydın bölgesinin konumu ajandada yok, yani konumu olan, silinmemiş, aynı eşleşme
   * anahtarlı hiçbir kayıt yok (yazılan kayıt dahil; çağıran yazımdan sonra sorar). Yalnız çağrı bir bölge
   * adı verdiyse ve kayıt silinmemişse sorulur. Konumun yalnız varlığına bakılır, değeri hiçbir yere çıkmaz.
   */
  const bolgeYeni = (verilen: string | null | undefined, k: AjandaKaydi): { bolge_yeni?: true } => {
    if (verilen === undefined || verilen === null || k.bolge === undefined || k.silindi) return {};
    const anahtar = ajandaBolgeAnahtari(k.bolge);
    const konumlu = depo
      .ajandaKayitlari()
      .some((x) => x.bolge_konumu !== undefined && x.bolge !== undefined && ajandaBolgeAnahtari(x.bolge) === anahtar);
    return konumlu ? {} : { bolge_yeni: true };
  };

  /** Telefon sohbeti: tur `turBaglami`'ndan (jetonun sohbeti + nesli); yoksa `null` (`tur_gecersiz`). */
  const sohbetCagrisi = (fiil: AjandaFiili, baglam: Extract<AjandaKopruBaglami, { rol: "ana_oturum" }>): Omit<Cagri, "v3Yuz"> | null => {
    let tur: AjandaTurBaglami | null;
    try {
      tur = b.turBaglami({ sohbet_id: baglam.sohbet_id }, baglam.nesil);
    } catch {
      tur = null;
    }
    if (tur === null) {
      gunluk.uyari(MODUL, "tur_gecersiz", { fiil, sohbet_id: baglam.sohbet_id, nesil: baglam.nesil });
      return null;
    }
    return {
      tur,
      yazar: { yol: "sohbet_araci", tur_kokeni: tur.tur_kokeni, sohbet_id: baglam.sohbet_id },
      kaynakTemeli: { yol: "sohbet_araci", tur_kokeni: tur.tur_kokeni, sohbet_id: baglam.sohbet_id },
      tekilKapsam: `sohbet:${baglam.sohbet_id}`,
      geceAnahtari: baglam.sohbet_id,
      iz: { sohbet_id: baglam.sohbet_id },
    };
  };

  /** PC oturumu: tur PC defterinden; hiç `null` değildir (tasdik yoksa sentetik). Defter yoksa `null`. */
  const pcCagrisi = (fiil: AjandaFiili, baglam: Extract<AjandaKopruBaglami, { rol: "pc_oturumu" }>, simdi: number): Omit<Cagri, "v3Yuz"> | null => {
    if (pc === undefined) {
      gunluk.uyari(MODUL, "tur_gecersiz", { fiil, yol: "pc_araci" });
      return null;
    }
    const { tur, oturum_id, karar, cagri_izi } = pc.tur(baglam, simdi);
    return {
      tur,
      yazar: { yol: "pc_araci", tur_kokeni: tur.tur_kokeni, oturum_id },
      kaynakTemeli: { yol: "pc_araci", tur_kokeni: tur.tur_kokeni, oturum_id },
      tekilKapsam: PC_TEKIL_KAPSAMI,
      geceAnahtari: `pc:${oturum_id}`,
      // `cagri_kimligi`: Claude Code'un MCP isteğinde çağrı kimliği geldi mi (teşhis; AJANDA.md "Kurulumdan sonra sınama").
      iz: { yol: "pc_araci", oturum_id, pc_karar: karar, cagri_kimligi: baglam.arac_cagri_id === undefined ? "yok" : "var", ...(cagri_izi === undefined ? {} : { cagri_izi }) },
      pcKarar: karar,
    };
  };

  /**
   * Ortak zarf: iptal, tur bağlamı, girdi doğrulaması, tek `depo.islem`. Çıktı kurulamazsa (`tur_gecersiz`,
   * `ic_hata`) `ok:false`; alan kararları (ret dahil) `ok:true` çıktının içindedir.
   */
  const isleyici =
    <F extends AjandaFiili>(fiil: F, f: Govde<F>): AjandaFiilIsleyici<F> =>
    async (girdi, baglam, sinyal, v3Yuz?: boolean) => {
      if (sinyal.aborted) return { ok: false, code: "ic_hata" };
      const simdi = saat.simdiMs();
      const yol = baglam.rol === "pc_oturumu" ? pcCagrisi(fiil, baglam, simdi) : sohbetCagrisi(fiil, baglam);
      if (yol === null) return { ok: false, code: "tur_gecersiz" };
      // Yüz: ayar kapalıysa hep v2; açıksa bağlantının yüzü (verilmezse v3).
      const cagri: Cagri = { ...yol, v3Yuz: v3 && v3Yuz !== false };
      // Girdi de çıktı gibi bağlantının yüzünden: v2 yüzde (ayar kapalı ya da bağlantı v2 yüzlü) v2 şeması;
      // köprü atlanırsa ya da kurallara uymazsa da v3 alanı işleyiciye geçmez ("bilinmeyen alan").
      const semasi = (cagri.v3Yuz ? v3Araclari : v2Araclari)[fiil].girdi as unknown as {
        safeParse(g: unknown): { success: boolean; data?: unknown; error?: { issues: readonly { code: string }[] } };
      };
      const p = semasi.safeParse(girdi);
      if (!p.success) {
        const bilinmeyen = p.error?.issues.some((i) => i.code === "unrecognized_keys") === true;
        gunluk.uyari(MODUL, "arac_girdisi_gecersiz", { fiil, ...(bilinmeyen ? { bilinmeyen_alan: true } : {}) });
        return { ok: false, code: "ic_hata" };
      }
      const t = cagri.tur;
      try {
        const ham = depo.islem(() => f(p.data as AjandaFiilGirdisi<F>, cagri, simdi));
        // v2 yüzde (ayar kapalı ya da bağlantı v2 yüzlü) çıktı v2 yüzüne iner (v3 telefonun yazdığı kaydın
        // alanları modele çıkmaz); iki v2 yüzü aynıdır.
        const cikti = (cagri.v3Yuz ? ham : v2Yuzu(fiil, ham)) as Cikti<F>;
        const c = cikti as { sonuc?: string; neden?: string; kayit?: { kayit_id: string; revizyon: number } };
        gunluk.bilgi(MODUL, "arac", {
          fiil,
          tur_kokeni: t.tur_kokeni,
          ...cagri.iz,
          sonuc: c.sonuc ?? "liste",
          neden: c.neden ?? null,
          kayit_id: c.kayit?.kayit_id ?? null,
          rev: c.kayit?.revizyon ?? null,
        });
        return cagri.pcKarar === undefined ? { ok: true, deger: cikti } : { ok: true, deger: cikti, pc_karar: cagri.pcKarar };
      } catch (e) {
        gunluk.hata(MODUL, "arac_hatasi", { fiil, hata: e instanceof Error ? e.name : "bilinmiyor" });
        return { ok: false, code: "ic_hata" };
      }
    };

  const yeniKayitId = (): string => {
    for (let i = 0; i < 8; i++) {
      const id = rastgele.opakId("k");
      if (depo.ajandaKaydiGetir(id) === null) return id;
    }
    throw new Error("ajanda: boş kayıt kimliği üretilemedi");
  };

  const dayanakTutar = (g: Parameters<typeof tarihliGirdiMi>[0], dayanak: AjandaFiilGirdisi<"ajanda_ekle">["dayanak"], an: AjandaYerelAn) =>
    !tarihliGirdiMi(g) || (dayanak !== undefined && dayanakGecerliMi(dayanak, an));

  /**
   * Sohbet başına `gece_teyidi_gerekli` reddinin verildiği son tur (`turn_id`, rastgele ve tur başına
   * tek). Yalnız bellekte: servis yeniden başlarsa tur da biter. Boyu sohbet sayısıyla sınırlı.
   */
  const geceReddiTuru = new Map<string, string>();

  /** Gece aralığı kararı (dayanaktan sonra, kayda dokunmadan önce): ret ya da `null`. */
  const geceReddi = (g: Parameters<typeof geceTeyidiEksikMi>[0], c: Cagri): { neden: "gece_teyidi_gerekli"; ayni_tur?: true } | null => {
    const tur = c.tur;
    if (geceTeyidiEksikMi(g, tur.mesaj_ani, tur.tur_kokeni)) {
      geceReddiTuru.set(c.geceAnahtari, tur.turn_id);
      return { neden: "gece_teyidi_gerekli" };
    }
    const istendi = geceReddiTuru.get(c.geceAnahtari) === tur.turn_id;
    if (geceSorulduAyniTurdaMi(g, tur.mesaj_ani, tur.tur_kokeni, istendi)) return { neden: "gece_teyidi_gerekli", ayni_tur: true };
    return null;
  };

  const ekle: Govde<"ajanda_ekle"> = (g, c, simdi) => {
    const tur = c.tur;
    const mesaj_ani = tur.mesaj_ani;
    const ret = (neden: Extract<Cikti<"ajanda_ekle">, { sonuc: "ret" }>["neden"], kural?: AjandaAracKurali): Cikti<"ajanda_ekle"> => ({
      sonuc: "ret",
      mesaj_ani,
      neden,
      ...(kural !== undefined && { kural }),
    });
    if (!dayanakTutar(g, g.dayanak, mesaj_ani)) return ret("dayanak_uyusmuyor");
    // v2: dayanaktan hemen sonra, kayda dokunmadan önce gece aralığı teyidi (aynı turda soruldu da ret).
    const gece = geceReddi(g, c);
    if (gece !== null) return { sonuc: "ret", mesaj_ani, ...gece };
    const yazar = c.yazar;
    const emir = kullaniciEmriMi(yazar);
    const dilim = mesaj_ani.saat_dilimi;
    const zaman = g.zaman === undefined ? undefined : zamanDoldur(g.zaman, dilim);
    const hatirlatmalar = g.hatirlatmalar?.map((h) => hatirlatmaDoldur(h, dilim));
    if (!dilimlerBilinir(takvim, zaman, hatirlatmalar)) return ret("saat_dilimi_bilinmiyor");
    const tekrar = g.tekrar === undefined ? undefined : ajandaAracTekrari(g.tekrar);
    // Çağrının verdiği alanlar, saklanacak halde (eşe birleşme ve doğan kaydın `elle_alanlar`'ı).
    const verilen = {
      tur: g.tur,
      baslik: g.baslik,
      aciklama: g.aciklama,
      zaman,
      hatirlatmalar,
      tekrar,
      simge: g.simge,
      bolge: g.bolge,
      varis: g.varis,
      baglantilar: g.baglantilar,
    };

    const tekil_anahtar = ajandaTekilAnahtari({ kapsam: c.tekilKapsam, tur: g.tur, baslik: g.baslik, zaman, bolge: g.bolge });
    const esler = depo.ajandaTekilEsler(tekil_anahtar);
    const karar = ajandaTekilKarari(esler, yazar);

    if (karar.karar !== "ekle") {
      const es = esler[karar.sira] as AjandaKaydi;
      // Emir olmayan otomasyonda eş olduğu gibi kalır.
      if (!emir) return { sonuc: "zaten_var", mesaj_ani, kayit: ozet(es, simdi), uygulanan_alanlar: [], ...bolgeYeni(g.bolge, es) };
      // Kullanıcının bu turda söylediği eşe işlenir (v3 alanları dahil; bölge anahtarda: aynı yer). Eş başka
      // bir konuşma bağlamının taslağıysa (PC'de başka oturum) taslağın alanları taşınmaz: kayıt insanın
      // çağrısının doğuracağı haldir (`ajandaAracEsBirlesimi`); varsayılan hatırlatma iki yolda da aynı kural.
      const bir = ajandaAracEsBirlesimi(es, verilen, yazar);
      // Asistanın kurmadığı tekrar eşe eklemeyle de değişmez (aynı tekrarı söylemek değişiklik değildir).
      if (g.tekrar !== undefined && es.tekrar !== undefined && bir.uygulanan.includes("tekrar") && !tekrarAracinMi(es)) {
        return ret("tutarsiz_kayit", "tekrar_kullanicinin");
      }
      const onay = karar.karar === "onayla";
      if (!onay && bir.uygulanan.length === 0) {
        return { sonuc: "zaten_var", mesaj_ani, kayit: ozet(es, simdi), uygulanan_alanlar: [], ...bolgeYeni(g.bolge, es) };
      }
      const yeni: YeniHal = { ...govde(bir.kayit), ...(onay ? { taslak: false } : {}) };
      const ts = degisiklikAni(simdi, es);
      const { onceki, sonraki } = fark(govde(es), yeni);
      const yazim = dogrulaVeYaz(depo, yeni, es.revizyon, { islem: onay ? "onayla" : "guncelle", yazar, onceki, sonraki }, ts);
      if (!yazim.ok) return ret(yazim.neden);
      return {
        sonuc: onay ? "onaylandi" : "zaten_var",
        mesaj_ani,
        kayit: ozet(yazim.deger, ts),
        uygulanan_alanlar: bir.soylenen,
        ...bolgeYeni(g.bolge, yazim.deger),
      };
    }

    if (depo.ajandaKayitSayisi() >= AJANDA_SINIRLARI.KAYIT_ADET) return ret("kayit_siniri");
    const kaynak: AjandaKaynagi = { ...c.kaynakTemeli, tekil_anahtar };
    if (tur.tur_kokeni === "insan") {
      if (tur.kaynak_msg_id !== undefined && OpakId.safeParse(tur.kaynak_msg_id).success) kaynak.kaynak_msg_id = tur.kaynak_msg_id;
      // Alıntı yalnız turun insan mesajında birebir geçiyorsa saklanır.
      if (g.alinti !== undefined && tur.insan_metni.includes(g.alinti)) kaynak.alinti = g.alinti;
    }
    const yeni: YeniHal = {
      kayit_id: yeniKayitId(),
      tur: g.tur,
      baslik: g.baslik,
      // Verilmezse varsayılan, kaydın zamanına göre (`ajandaAracVarsayilanHatirlatmalari`): varışsız ya da
      // takvime oturan tek seferlik varışlı kayıtta olağan varsayılan; zamansız varışlı kayıtta ve tekrarda `[]`.
      // Verilen `[]` hiç kurmaz.
      hatirlatmalar: hatirlatmalar ?? ajandaAracVarsayilanHatirlatmalari({ zaman, tekrar, varis: g.varis }),
      ornekler: [],
      durum: "acik",
      // İnsan kökenli olmayan turdan gelen ekleme taslak doğar.
      taslak: !emir,
      silindi: false,
      elle_alanlar: emir ? verilenAlanlar(verilen) : [],
      kaynak,
      olusturma_ms: simdi,
    };
    if (g.aciklama !== undefined) yeni.aciklama = g.aciklama;
    if (zaman !== undefined) yeni.zaman = zaman;
    if (tekrar !== undefined) yeni.tekrar = tekrar;
    if (g.simge !== undefined) yeni.simge = g.simge;
    if (g.bolge !== undefined) yeni.bolge = g.bolge;
    if (g.varis !== undefined) yeni.varis = g.varis;
    if (g.baglantilar !== undefined) yeni.baglantilar = g.baglantilar;
    const yazim = dogrulaVeYaz(depo, yeni, 1, { islem: "ekle", yazar, onceki: {}, sonraki: dogumParcasi(yeni) }, simdi);
    if (!yazim.ok) return ret(yazim.neden);
    return { sonuc: "eklendi", mesaj_ani, kayit: ozet(yazim.deger, simdi), ...bolgeYeni(g.bolge, yazim.deger) };
  };

  const guncelle: Govde<"ajanda_guncelle"> = (g, c, simdi) => {
    const tur = c.tur;
    const mesaj_ani = tur.mesaj_ani;
    const ret = (neden: Extract<Cikti<"ajanda_guncelle">, { sonuc: "ret" }>["neden"], kural?: AjandaAracKurali): Cikti<"ajanda_guncelle"> => ({
      sonuc: "ret",
      mesaj_ani,
      neden,
      ...(kural !== undefined && { kural }),
    });
    const d = g.degisiklik;
    if (!dayanakTutar(d, g.dayanak, mesaj_ani)) return ret("dayanak_uyusmuyor");
    // v2: sıra dayanak → gece → kayıt (kayıt aranmadan önce; yoksa da teyit istenir).
    const gece = geceReddi(g, c);
    if (gece !== null) return { sonuc: "ret", mesaj_ani, ...gece };
    const k = depo.ajandaKaydiGetir(g.kayit_id);
    if (k === null) return ret("kayit_bulunamadi");
    if (k.silindi) return ret("kayit_silinmis");
    const yazar = c.yazar;
    const emir = kullaniciEmriMi(yazar);
    // Sentetik tur yalnız taslağı düzenleyebilir, hiçbir şeyi onaylayamaz.
    if (!emir && (d.onayla === true || !k.taslak)) return ret("sentetik_turda_izinsiz");

    const dilim = mesaj_ani.saat_dilimi;
    const degisiklik: AracAlanlari = {};
    if (d.tur !== undefined) degisiklik.tur = d.tur;
    if (d.baslik !== undefined) degisiklik.baslik = d.baslik;
    if (d.aciklama !== undefined) degisiklik.aciklama = d.aciklama;
    // v2: zaman kaydın var olan zamanıyla birleşir; verilmeyen saat, süre ve gün bölümü korunur.
    let zamandaKorunan: ZamandaKorunan[] = [];
    if (d.zaman === null) degisiklik.zaman = null;
    else if (d.zaman !== undefined) {
      const cozum = ajandaZamanDegisikligiCoz(k.zaman, d.zaman);
      degisiklik.zaman = zamanDoldur(cozum.zaman, dilim);
      zamandaKorunan = cozum.korunan;
    }
    if (d.hatirlatmalar !== undefined) degisiklik.hatirlatmalar = d.hatirlatmalar.map((h) => hatirlatmaDoldur(h, dilim));
    if (d.durum !== undefined) degisiklik.durum = d.durum;
    // v3 (bölge konumu ve ekler araç girdisinde yok; bölge başka yere değişirse konumu birleştirme düşürür).
    if (d.tekrar !== undefined) degisiklik.tekrar = d.tekrar === null ? null : ajandaAracTekrari(d.tekrar);
    if (d.simge !== undefined) degisiklik.simge = d.simge;
    if (d.bolge !== undefined) degisiklik.bolge = d.bolge;
    if (d.varis !== undefined) degisiklik.varis = d.varis;
    if (d.baglantilar !== undefined) degisiklik.baglantilar = d.baglantilar;
    if (!dilimlerBilinir(takvim, degisiklik.zaman, degisiklik.hatirlatmalar)) return ret("saat_dilimi_bilinmiyor");

    const bir = ajandaDegisikligiUygula(k, degisiklik, yazar);
    let aracin: boolean | undefined;
    const kural = aracKuraliBozuk(k, bir.kayit, bir.uygulanan, () => (aracin ??= tekrarAracinMi(k)));
    if (kural !== null) return ret("tutarsiz_kayit", kural);
    const onay = d.onayla === true && k.taslak;
    if (bir.uygulanan.length === 0 && !onay) {
      return { sonuc: "degismedi", mesaj_ani, kayit: ozet(k, simdi), korunan_alanlar: bir.korunan, ...bolgeYeni(d.bolge, k) };
    }
    const yeni: YeniHal = { ...govde(bir.kayit), ...(onay ? { taslak: false } : {}) };
    const ts = degisiklikAni(simdi, k);
    const { onceki, sonraki } = fark(govde(k), yeni);
    const girdi = {
      islem: bir.uygulanan.length === 0 ? ("onayla" as const) : ("guncelle" as const),
      yazar,
      onceki,
      sonraki,
      ...(bir.korunan.length > 0 ? { korunan_alanlar: bir.korunan } : {}),
    };
    const yazim = dogrulaVeYaz(depo, yeni, k.revizyon, girdi, ts);
    if (!yazim.ok) return ret(yazim.neden);
    const sonOzet = ozet(yazim.deger, ts);
    const cikti: Extract<Cikti<"ajanda_guncelle">, { sonuc: "guncellendi" }> = {
      sonuc: "guncellendi",
      mesaj_ani,
      kayit: sonOzet,
      korunan_alanlar: bir.korunan,
    };
    if (bir.uygulanan.includes("zaman")) {
      if (zamandaKorunan.length > 0) cikti.zamanda_korunan = zamandaKorunan;
      // Gün hatırlatmasının saati değiştiyse (ya da kalktıysa) eskisi: model kullanıcıya söyler. Modelin gördüğü
      // yüzden (v2 yüzde `v2HatirlatmasizMi` özeti boşaltır): not özetle çelişmez.
      const gorunen = (o: AjandaKayitOzeti) => (!c.v3Yuz && v2HatirlatmasizMi(o) ? undefined : o.hatirlatma.gun_hatirlatmasi);
      const onceki = gorunen(ozet(k, ts));
      const sonraki = gorunen(sonOzet);
      if (onceki !== undefined && (sonraki === undefined || sonraki.saat !== onceki.saat)) cikti.onceki_gun_hatirlatmasi = onceki;
    }
    if (bolgeYeni(d.bolge, yazim.deger).bolge_yeni === true) cikti.bolge_yeni = true;
    return cikti;
  };

  /**
   * Kullanılan bölge adları (v3): silinmemiş her kayıttan, eşleşme anahtarı başına bir ad (en son güncellenen
   * kaydın yazılışı), en son kullanılan önce, en çok `AJANDA_ARAC_BOLGE_ADET`. Hiç yoksa alan yok.
   */
  const bolgeAdlari = (): { bolgeler?: string[] } => {
    const enSon = new Map<string, { ad: string; ms: number }>();
    for (const k of depo.ajandaKayitlari()) {
      if (k.bolge === undefined) continue;
      const anahtar = ajandaBolgeAnahtari(k.bolge);
      const onceki = enSon.get(anahtar);
      if (onceki === undefined || k.guncelleme_ms >= onceki.ms) enSon.set(anahtar, { ad: k.bolge, ms: k.guncelleme_ms });
    }
    if (enSon.size === 0) return {};
    const sirali = [...enSon.entries()].sort(([a, x], [b, y]) => y.ms - x.ms || (a < b ? -1 : a > b ? 1 : 0));
    return { bolgeler: sirali.slice(0, AJANDA_ARAC_BOLGE_ADET).map(([, v]) => v.ad) };
  };

  const listele: Govde<"ajanda_listele"> = (g, { tur }) => {
    // Silinmiş kayıt hiç listelenmez (depo varsayılanı).
    let liste = depo.ajandaKayitlari({ durumlar: g.durumlar ?? ["acik"], ...(g.turler === undefined ? {} : { turler: g.turler }) });
    if (g.bolge !== undefined) {
      const anahtar = ajandaBolgeAnahtari(g.bolge);
      liste = liste.filter((k) => k.bolge !== undefined && ajandaBolgeAnahtari(k.bolge) === anahtar);
    }
    if (g.baslangic !== undefined || g.bitis !== undefined) liste = liste.filter((k) => araligaDeger(k.zaman, g.baslangic, g.bitis));
    if (g.ara !== undefined) {
      const aranan = katla(g.ara);
      liste = liste.filter((k) => katla(k.baslik).includes(aranan) || (k.aciklama !== undefined && katla(k.aciklama).includes(aranan)));
    }
    // Tarihliler gün ve saate göre artan (eşitte oluşturma sırası), sonra tarihsizler oluşturma sırasıyla.
    const tarihli = liste
      .map((k, i) => ({ k, i, a: siraAnahtari(k.zaman) }))
      .filter((x): x is { k: AjandaKaydi; i: number; a: string } => x.a !== undefined)
      .sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.i - y.i))
      .map((x) => x.k);
    const tarihsiz = liste.filter((k) => siraAnahtari(k.zaman) === undefined);
    const sirali = [...tarihli, ...tarihsiz];
    // `en_fazla` yoksa protokol varsayılanı; varsa istenen, şema zaten `LISTE_ADET` ile sınırlar (yine de kırpılır).
    const adet = Math.min(g.en_fazla ?? AJANDA_SINIRLARI.LISTE_VARSAYILAN, AJANDA_SINIRLARI.LISTE_ADET);
    return {
      mesaj_ani: tur.mesaj_ani,
      // Gizlilik süzgeci: kayıt araç yoluna yalnız buradan çıkar (`ajandaAracKaydi`: konum yok, ekler yalnız sayı).
      kayitlar: sirali.slice(0, adet).map(ajandaAracKaydi),
      toplam: sirali.length,
      ...(v3 ? bolgeAdlari() : {}),
    };
  };

  return {
    ajanda_ekle: isleyici("ajanda_ekle", ekle),
    ajanda_guncelle: isleyici("ajanda_guncelle", guncelle),
    ajanda_listele: isleyici("ajanda_listele", listele),
  };
}
