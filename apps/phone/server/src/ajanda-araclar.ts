import {
  AJANDA_ARACLARI,
  AJANDA_SINIRLARI,
  AJANDA_VARSAYILAN_HATIRLATMALAR,
  type AjandaAlanDegisikligi,
  type AjandaFiili,
  type AjandaKaydi,
  type AjandaKaynagi,
  type AjandaYazar,
  type AjandaYerelAn,
  type AjandaZamani,
  ajandaDegisikligiUygula,
  ajandaEsDegisikligi,
  ajandaTekilAnahtari,
  ajandaTekilKarari,
  dayanakGecerliMi,
  geceTeyidiEksikMi,
  kullaniciEmriMi,
  OpakId,
  tarihliGirdiMi,
} from "@eren/protocol";
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
 * - Takvime bağlı girdi `dayanakGecerliMi(dayanak, mesaj_ani)` ister (`dayanak_uyusmuyor`); hemen
 *   ardından (v2) `geceTeyidiEksikMi(girdi, mesaj_ani, tur_kokeni)` doğruysa `gece_teyidi_gerekli`
 *   (insan turunda, mesaj anı 00:00-04:00, takvime bağlı ve `dayanak.gece_teyidi` yok; sentetik turda
 *   hiç); ikisi de kayda dokunmadan önce, güncellemede kayıt aranmadan önce. Dilimsiz
 *   zaman ve `mutlak` hatırlatma turun mesaj anının dilimini alır; dilim veritabanında yoksa
 *   `saat_dilimi_bilinmiyor`.
 * - Ekleme: tekil anahtar (`sohbet:<id>` kapsamı) → `ajandaTekilKarari`; emir olmayan turda taslak
 *   doğar; emirde açık eşe `ajandaEsDegisikligi` işlenir (eş taslaksa aynı yazımda onay). Emirle doğan
 *   kayıtta açıkça verilen alanlar `elle_alanlar`'a girer (varsayılan hatırlatma girmez).
 * - Güncelleme: sentetik turda taslak olmayan kayda değişiklik ya da herhangi bir onay
 *   `sentetik_turda_izinsiz`; elle alanlar korunur (`korunan_alanlar`).
 * - Her işleyici eşzamanlıdır (araya `await` girmez) ve tek `depo.islem` içinde yazar.
 */

type Cikti<F extends AjandaFiili> = AjandaFiilCiktisi<F>;
type Govde<F extends AjandaFiili> = (girdi: AjandaFiilGirdisi<F>, tur: AjandaTurBaglami, baglam: AjandaKopruBaglami, simdi: number) => Cikti<F>;

/** Araçta modelin dokunabildiği alanlar (tekrar ve kaynak yok). */
type AracAlanlari = Pick<AjandaAlanDegisikligi, "tur" | "baslik" | "aciklama" | "zaman" | "hatirlatmalar" | "durum">;

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

export function ajandaAraclariKur(b: AjandaBagimliliklari): AjandaFiilIsleyiciler {
  const { depo, takvim, saat, rastgele, gunluk } = b;
  const ozet = (k: AjandaKaydi, simdi: number) => kayitOzeti(k, simdi, takvim);

  const yazarKur = (tur: AjandaTurBaglami, baglam: AjandaKopruBaglami): AjandaYazar => ({
    yol: "sohbet_araci",
    tur_kokeni: tur.tur_kokeni,
    sohbet_id: baglam.sohbet_id,
  });

  /**
   * Ortak zarf: iptal, tur bağlamı, girdi doğrulaması, tek `depo.islem`. Çıktı kurulamazsa (`tur_gecersiz`,
   * `ic_hata`) `ok:false`; alan kararları (ret dahil) `ok:true` çıktının içindedir.
   */
  const isleyici =
    <F extends AjandaFiili>(fiil: F, f: Govde<F>): AjandaFiilIsleyici<F> =>
    async (girdi, baglam, sinyal) => {
      if (sinyal.aborted) return { ok: false, code: "ic_hata" };
      let tur: AjandaTurBaglami | null;
      try {
        tur = b.turBaglami({ sohbet_id: baglam.sohbet_id }, baglam.nesil);
      } catch {
        tur = null;
      }
      if (tur === null) {
        gunluk.uyari(MODUL, "tur_gecersiz", { fiil, sohbet_id: baglam.sohbet_id, nesil: baglam.nesil });
        return { ok: false, code: "tur_gecersiz" };
      }
      const semasi = AJANDA_ARACLARI[fiil].girdi as unknown as { safeParse(g: unknown): { success: boolean; data?: unknown } };
      const p = semasi.safeParse(girdi);
      if (!p.success) {
        gunluk.uyari(MODUL, "arac_girdisi_gecersiz", { fiil });
        return { ok: false, code: "ic_hata" };
      }
      const t = tur;
      try {
        const cikti = depo.islem(() => f(p.data as AjandaFiilGirdisi<F>, t, baglam, saat.simdiMs()));
        const c = cikti as { sonuc?: string; neden?: string; kayit?: { kayit_id: string; revizyon: number } };
        gunluk.bilgi(MODUL, "arac", {
          fiil,
          tur_kokeni: t.tur_kokeni,
          sohbet_id: baglam.sohbet_id,
          sonuc: c.sonuc ?? "liste",
          neden: c.neden ?? null,
          kayit_id: c.kayit?.kayit_id ?? null,
          rev: c.kayit?.revizyon ?? null,
        });
        return { ok: true, deger: cikti };
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

  const ekle: Govde<"ajanda_ekle"> = (g, tur, baglam, simdi) => {
    const mesaj_ani = tur.mesaj_ani;
    const ret = (neden: Extract<Cikti<"ajanda_ekle">, { sonuc: "ret" }>["neden"]): Cikti<"ajanda_ekle"> => ({ sonuc: "ret", mesaj_ani, neden });
    if (!dayanakTutar(g, g.dayanak, mesaj_ani)) return ret("dayanak_uyusmuyor");
    // v2: dayanaktan hemen sonra, kayda dokunmadan önce gece aralığı teyidi.
    if (geceTeyidiEksikMi(g, mesaj_ani, tur.tur_kokeni)) return ret("gece_teyidi_gerekli");
    const yazar = yazarKur(tur, baglam);
    const emir = kullaniciEmriMi(yazar);
    const dilim = mesaj_ani.saat_dilimi;
    const zaman = g.zaman === undefined ? undefined : zamanDoldur(g.zaman, dilim);
    const hatirlatmalar = g.hatirlatmalar?.map((h) => hatirlatmaDoldur(h, dilim));
    if (!dilimlerBilinir(takvim, zaman, hatirlatmalar)) return ret("saat_dilimi_bilinmiyor");

    const tekil_anahtar = ajandaTekilAnahtari({ kapsam: `sohbet:${baglam.sohbet_id}`, tur: g.tur, baslik: g.baslik, zaman });
    const esler = depo.ajandaTekilEsler(tekil_anahtar);
    const karar = ajandaTekilKarari(esler, yazar);

    if (karar.karar !== "ekle") {
      const es = esler[karar.sira] as AjandaKaydi;
      // Emir olmayan otomasyonda eş olduğu gibi kalır.
      if (!emir) return { sonuc: "zaten_var", mesaj_ani, kayit: ozet(es, simdi), uygulanan_alanlar: [] };
      const bir = ajandaDegisikligiUygula(es, ajandaEsDegisikligi(es, { aciklama: g.aciklama, zaman, hatirlatmalar }), yazar);
      const onay = karar.karar === "onayla";
      if (!onay && bir.uygulanan.length === 0) {
        return { sonuc: "zaten_var", mesaj_ani, kayit: ozet(es, simdi), uygulanan_alanlar: [] };
      }
      const yeni: YeniHal = { ...govde(bir.kayit), ...(onay ? { taslak: false } : {}) };
      const ts = degisiklikAni(simdi, es);
      const { onceki, sonraki } = fark(govde(es), yeni);
      const yazim = dogrulaVeYaz(depo, yeni, es.revizyon, { islem: onay ? "onayla" : "guncelle", yazar, onceki, sonraki }, ts);
      if (!yazim.ok) return ret(yazim.neden);
      return { sonuc: onay ? "onaylandi" : "zaten_var", mesaj_ani, kayit: ozet(yazim.deger, ts), uygulanan_alanlar: bir.uygulanan };
    }

    if (depo.ajandaKayitSayisi() >= AJANDA_SINIRLARI.KAYIT_ADET) return ret("kayit_siniri");
    const kaynak: AjandaKaynagi = { yol: "sohbet_araci", tur_kokeni: tur.tur_kokeni, sohbet_id: baglam.sohbet_id, tekil_anahtar };
    if (tur.tur_kokeni === "insan") {
      if (tur.kaynak_msg_id !== undefined && OpakId.safeParse(tur.kaynak_msg_id).success) kaynak.kaynak_msg_id = tur.kaynak_msg_id;
      // Alıntı yalnız turun insan mesajında birebir geçiyorsa saklanır.
      if (g.alinti !== undefined && tur.insan_metni.includes(g.alinti)) kaynak.alinti = g.alinti;
    }
    const verilen = { tur: g.tur, baslik: g.baslik, aciklama: g.aciklama, zaman, hatirlatmalar };
    const yeni: YeniHal = {
      kayit_id: yeniKayitId(),
      tur: g.tur,
      baslik: g.baslik,
      // Verilmezse varsayılan (zaman kesinliği ne olursa olsun); `[]` hiç kurmaz.
      hatirlatmalar: hatirlatmalar ?? AJANDA_VARSAYILAN_HATIRLATMALAR.map((h) => ({ ...h })),
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
    const yazim = dogrulaVeYaz(depo, yeni, 1, { islem: "ekle", yazar, onceki: {}, sonraki: dogumParcasi(yeni) }, simdi);
    if (!yazim.ok) return ret(yazim.neden);
    return { sonuc: "eklendi", mesaj_ani, kayit: ozet(yazim.deger, simdi) };
  };

  const guncelle: Govde<"ajanda_guncelle"> = (g, tur, baglam, simdi) => {
    const mesaj_ani = tur.mesaj_ani;
    const ret = (neden: Extract<Cikti<"ajanda_guncelle">, { sonuc: "ret" }>["neden"]): Cikti<"ajanda_guncelle"> => ({
      sonuc: "ret",
      mesaj_ani,
      neden,
    });
    const d = g.degisiklik;
    if (!dayanakTutar(d, g.dayanak, mesaj_ani)) return ret("dayanak_uyusmuyor");
    // v2: sıra dayanak → gece → kayıt (kayıt aranmadan önce; yoksa da teyit istenir).
    if (geceTeyidiEksikMi(g, mesaj_ani, tur.tur_kokeni)) return ret("gece_teyidi_gerekli");
    const k = depo.ajandaKaydiGetir(g.kayit_id);
    if (k === null) return ret("kayit_bulunamadi");
    if (k.silindi) return ret("kayit_silinmis");
    const yazar = yazarKur(tur, baglam);
    const emir = kullaniciEmriMi(yazar);
    // Sentetik tur yalnız taslağı düzenleyebilir, hiçbir şeyi onaylayamaz.
    if (!emir && (d.onayla === true || !k.taslak)) return ret("sentetik_turda_izinsiz");

    const dilim = mesaj_ani.saat_dilimi;
    const degisiklik: AracAlanlari = {};
    if (d.tur !== undefined) degisiklik.tur = d.tur;
    if (d.baslik !== undefined) degisiklik.baslik = d.baslik;
    if (d.aciklama !== undefined) degisiklik.aciklama = d.aciklama;
    if (d.zaman !== undefined) degisiklik.zaman = d.zaman === null ? null : zamanDoldur(d.zaman, dilim);
    if (d.hatirlatmalar !== undefined) degisiklik.hatirlatmalar = d.hatirlatmalar.map((h) => hatirlatmaDoldur(h, dilim));
    if (d.durum !== undefined) degisiklik.durum = d.durum;
    if (!dilimlerBilinir(takvim, degisiklik.zaman, degisiklik.hatirlatmalar)) return ret("saat_dilimi_bilinmiyor");

    const bir = ajandaDegisikligiUygula(k, degisiklik, yazar);
    const onay = d.onayla === true && k.taslak;
    if (bir.uygulanan.length === 0 && !onay) {
      return { sonuc: "degismedi", mesaj_ani, kayit: ozet(k, simdi), korunan_alanlar: bir.korunan };
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
    return { sonuc: "guncellendi", mesaj_ani, kayit: ozet(yazim.deger, ts), korunan_alanlar: bir.korunan };
  };

  const listele: Govde<"ajanda_listele"> = (g, tur) => {
    // Silinmiş kayıt hiç listelenmez (depo varsayılanı).
    let liste = depo.ajandaKayitlari({ durumlar: g.durumlar ?? ["acik"], ...(g.turler === undefined ? {} : { turler: g.turler }) });
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
      kayitlar: sirali.slice(0, adet),
      toplam: sirali.length,
    };
  };

  return {
    ajanda_ekle: isleyici("ajanda_ekle", ekle),
    ajanda_guncelle: isleyici("ajanda_guncelle", guncelle),
    ajanda_listele: isleyici("ajanda_listele", listele),
  };
}
