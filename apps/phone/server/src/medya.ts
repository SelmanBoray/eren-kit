/**
 * Medya yöneticisi (Medya dalgası, S4). Medya tablolarının TEK YAZARI (`MedyaDeposu` üzerinden).
 * MODULLER.md "Medya dalgası" > "Akışlar" ve "S4 yönetici"; arayüz `sozlesme.ts` `MedyaYoneticisi`.
 *
 * - Yükleme: kayıt başına (`device_id` + `medya_id`) sıralı; yeni kayıt açılışı servis genelinde sıralı
 *   (bekleyen sınırı ve kota tek bakışta). Son parçada doğrulama: koklama + `beyanaUyar` → (araç sırası)
 *   → `tasi` → fotoğrafta `gorselUret`, videoda `olc`. Doğrulama parça yanıtını bekletir.
 * - Araç kilidi: servis genelinde bir anda TEK araç (ffmpeg/ffprobe), doğrulamanınkiler dahil (büyük
 *   PNG/HEIC çözmek ~1 GB tutar; eşzamanlı fotoğraflar belleği katlamasın). Bekleyen doğrulama işçinin
 *   sıradaki adımından önce alır, süren adımı kesmez. Sıra `.part` taşınmadan beklenir.
 * - İşleme: servis başına TEK işçi. Video: kareler, sonra döküm. Her adımın başarısı = araç zaman
 *   aşımına uğramadı VE çıktı var ve boyutu > 0. Adımdan önce o adımın eski çıktısı boşaltılır (eski bir
 *   çalışmanın dosyası başarı sayılmasın), başarısız ya da geç biten adımın yarım çıktısı da boşaltılır.
 *   Port tek dosya silmez; boş (0 bayt) dosya "çıktı yok"tur. Kuyruk başındaki mesajın ekleri (`icerik`)
 *   sırada öne alınır: gönderilmemiş yüklemeler onu bekletmesin.
 * - `islemeAzamiMs` işçi kaydı aldığı an başlar (sırada beklenen süre sayılmaz: sıradaki kayıt hiç
 *   işlenmeden kapanmaz). Dolunca süren araç iptal edilir (işçi beklemeden sıradakine geçer) ve kayıt elde
 *   olanla biter (`kismi`/`hata`, neden `zaman_asimi`); kesilen aracın çıktısı içeriğe alınmaz. Böylece
 *   dökümün etkin sınırı `min(kendi zaman aşımı, kalan süre)` olur ve bir mesajın beklemesi sınırlıdır:
 *   süren kaydın kalanı + kendi eklerinin işlemesi.
 * - Kota: asıl dosya + türetilenler (`turetilen_bayt`, doğrulamada ve her işleme sonunda diskten ölçülür).
 * - Kapanış: süren araç iptal edilir; kayıtlar uzlaştırılabilir kalır (`MedyaYoneticisi.kapat`).
 * - İçerik: `icerik` eşzamanlıdır; bloklar arkada portla okunur, bitince `medya_durumu` yayınlanır.
 * - Silme: süren işleme varsa bitince; silinemeyen satır kalır, süpürmede yeniden denenir.
 * Günlüğe yalnız `no`, `medya_id`, sayı ve kapalı liste değeri yazılır (yol, ad, içerik yok).
 */
import { MEDYA_SINIRLARI, base64BaytUzunlugu, parcaVerisiGecerliMi } from "@eren/protocol";
import { medyaIcerigiKur } from "./medya-metin.ts";
import type {
  HazirEk,
  IptalEt,
  KareSirasi,
  MediaStateGovdesi,
  MedyaBaglamaHatasi,
  MedyaBaslangici,
  MedyaBicimi,
  MedyaDosyaAdi,
  MedyaFabrikasi,
  MedyaHatasi,
  MedyaIcerigiDurumu,
  MedyaIslemeNedeni,
  MedyaKaydi,
  MedyaYoneticisi,
  SohbetSecimi,
} from "./sozlesme.ts";
import type { EkListesi, MedyaIslemeDurumu } from "@eren/protocol";

/** Koklama için `.part`'ın başından okunan bayt (`MedyaIsleyici.kokla` en çok 64 bayta bakar). */
const KOKLAMA_BAYT = 64;
/** `dokum.srt`'nin okunacak en çok baytı (5 dk konuşmanın SRT'si bunun çok altındadır). */
const SRT_AZAMI_BAYT = 8 * 1024 * 1024;
/** Yeni kayıt açılışının servis geneli sıra anahtarı (kimlik anahtarlarında `\u0000` iki parçayı ayırır). */
const OLUSTURMA = "\u0001olustur";
/** `KareSirasi`'nın üst sınırı (dosya adı listesi `kare-01`..`kare-08`). */
const KARE_EN_COK = 8;

const BITMIS_ISLEMELER: ReadonlySet<MedyaIslemeDurumu> = new Set<MedyaIslemeDurumu>(["hazir", "kismi", "hata"]);
const bos = (): void => {};
const kareAdi = (sira: number): MedyaDosyaAdi => `kare-0${sira as KareSirasi}.jpg`;
/** Kotaya sayılan türetilen dosyalar (`turetilen_bayt`). */
const TURETILENLER: readonly MedyaDosyaAdi[] = [
  "gorsel.jpg",
  ...Array.from({ length: KARE_EN_COK }, (_, i) => kareAdi(i + 1)),
  "dokum.srt",
  "dokum.txt",
];
const asilAdi = (k: MedyaKaydi): MedyaDosyaAdi | null => (k.bicim === null ? null : `asil.${k.bicim}`);

/** İşçinin üzerinde çalıştığı kaydın bellekteki ilerlemesi (zaman aşımı elde olanla bitirmek için). */
interface Ilerleme {
  /** Zaman aşımı ya da silme: işçi sıradaki adıma geçmez, geç gelen çıktıyı boşaltır, DB'ye yazmaz. */
  bitti: boolean;
  uretilen: number;
  /** Şu an çalışan aracın çıktısı; yoksa `null`. */
  adim: MedyaDosyaAdi | null;
  /** Süre dolunca ya da kapanışta süren aracı keser (`MedyaIsleyici` yöntemlerinin `iptal`'i). */
  iptal: AbortController;
}

/** Doğrulamanın araç kısmının sonucu. `kapandi`: kapanış kesti, red sayılmaz (kayıt `yukleniyor` kalır). */
type Dogrulama = "kabul" | "red" | "kapandi";

interface Onbellek {
  sohbet_id: string;
  /** Kayıtların `no:isleme` imzası: değişirse önbellek geçersizdir. */
  imza: string;
  ekler: readonly HazirEk[];
}

type Denetim = { ok: true; nolar: number[] } | { ok: false; code: MedyaBaglamaHatasi };

export const medyaKur: MedyaFabrikasi = (b): MedyaYoneticisi => {
  const { depo, dosya, isleyici, saat, zamanlayici, veriyolu, gunluk } = b;
  const s = b.ayar.sinirlar;
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8");

  let kapali = false;
  let basladi = false;
  /** Kapanışta doğrulamanın süren aracını keser (işçininkini `Ilerleme.iptal`). */
  const kapanis = new AbortController();
  let supurmeIptal: IptalEt | null = null;
  let supuruyor: Promise<void> | null = null;

  // ---- günlük ----
  const hataTuru = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
  const hataYaz = (olay: string, e: unknown, alanlar: Record<string, string | number | null> = {}): void => {
    try {
      gunluk.hata("medya", olay, { ...alanlar, hata_turu: hataTuru(e) });
    } catch {
      // günlük de atarsa akış bozulmaz
    }
  };
  const bilgi = (olay: string, alanlar: Record<string, string | number | boolean | null>): void => {
    try {
      gunluk.bilgi("medya", olay, alanlar);
    } catch {
      // yok sayılır
    }
  };
  const uyari = (olay: string, alanlar: Record<string, string | number | boolean | null>): void => {
    try {
      gunluk.uyari("medya", olay, alanlar);
    } catch {
      // yok sayılır
    }
  };

  // ---- sıralama: aynı anahtardaki işler üst üste binmez ----
  const kuyruklar = new Map<string, Promise<void>>();
  const sirayla = <T>(anahtar: string, is: () => Promise<T>): Promise<T> => {
    const once = kuyruklar.get(anahtar) ?? Promise.resolve();
    const sonuc = once.then(is);
    const kuyruk = sonuc.then(bos, bos);
    kuyruklar.set(anahtar, kuyruk);
    void kuyruk.then(() => {
      if (kuyruklar.get(anahtar) === kuyruk) kuyruklar.delete(anahtar);
    });
    return sonuc;
  };
  const anahtar = (device_id: string, medya_id: string): string => `${device_id}\u0000${medya_id}`;

  // ---- araç kilidi: servis genelinde bir anda tek araç (doğrulama dahil) ----
  // Bırakılan kilit doğrudan sıradakine geçer (arada kimse kapmaz). Öncelikli: doğrulama (telefon parça
  // yanıtını bekliyor); arka: işçinin adımları. Kapanışta bekleyenler sırayla uyanır, araç çalıştırmadan döner.
  const aracSirasi = { oncelikli: [] as Array<() => void>, arka: [] as Array<() => void> };
  let aracMesgul = false;
  const aracBirak = (): void => {
    const sonraki = aracSirasi.oncelikli.shift() ?? aracSirasi.arka.shift();
    if (sonraki === undefined) aracMesgul = false;
    else sonraki();
  };
  const aracla = async <T>(oncelikli: boolean, is: () => Promise<T>): Promise<T> => {
    if (aracMesgul) await new Promise<void>((r) => (oncelikli ? aracSirasi.oncelikli : aracSirasi.arka).push(r));
    else aracMesgul = true;
    try {
      return await is();
    } finally {
      aracBirak();
    }
  };

  // ---- kablo gövdeleri ----
  const red = (medya_id: string, code: MedyaHatasi): MediaStateGovdesi => ({ medya_id, durum: "reddedildi", code });
  const govde = (k: MedyaKaydi): MediaStateGovdesi => {
    switch (k.durum) {
      case "yukleniyor":
        return { medya_id: k.medya_id, durum: "yukleniyor", alinan: k.alinan };
      case "kabul":
        return { medya_id: k.medya_id, durum: "kabul", ...(k.isleme !== null && { isleme: k.isleme }) };
      case "reddedildi":
        return red(k.medya_id, k.red_kodu ?? "medya_reddedildi");
      case "silinecek":
        return red(k.medya_id, "medya_yok");
    }
  };
  const yayinla = (k: MedyaKaydi): void => {
    try {
      veriyolu.yayinla("medya_durumu", { device_id: k.device_id, sohbet_id: k.sohbet_id, durum: govde(k) });
    } catch (e) {
      hataYaz("durum_yayinlanamadi", e, { no: k.no });
    }
  };

  // ---- depo yardımcıları ----
  const getir = (no: number): MedyaKaydi | null => {
    try {
      return depo.medyaKaydiGetir(no);
    } catch (e) {
      hataYaz("kayit_okunamadi", e, { no });
      return null;
    }
  };
  const guncelle = (no: number, alanlar: Parameters<typeof depo.medyaGuncelle>[1]): void => {
    depo.medyaGuncelle(no, { ...alanlar, guncelleme_ms: saat.simdiMs() });
  };
  const islemeBitti = (k: MedyaKaydi): boolean => k.isleme !== null && BITMIS_ISLEMELER.has(k.isleme);

  // ---- dosya yardımcıları (hiç atmaz) ----
  const boyutOku = async (no: number, ad: MedyaDosyaAdi): Promise<number | null> => {
    try {
      return await dosya.boyut(no, ad);
    } catch {
      return null;
    }
  };
  /** Çıktıyı "yok" hâline getirir: varsa ve boş değilse 0 bayta indirir. */
  const bosalt = async (no: number, ad: MedyaDosyaAdi): Promise<void> => {
    const n = await boyutOku(no, ad);
    if (n === null || n === 0) return;
    try {
      await dosya.yaz(no, ad, new Uint8Array(0));
    } catch (e) {
      hataYaz("cikti_bosaltilamadi", e, { no });
    }
  };
  /** Türetilen dosyaların diskteki toplamını `turetilen_bayt`'a yazar (`guncelleme_ms`'e dokunmaz). Atmaz. */
  const turetilenYaz = async (no: number): Promise<void> => {
    let toplam = 0;
    for (const ad of TURETILENLER) toplam += (await boyutOku(no, ad)) ?? 0;
    try {
      const k = depo.medyaKaydiGetir(no);
      if (k === null || k.durum !== "kabul" || k.turetilen_bayt === toplam) return;
      depo.medyaGuncelle(no, { turetilen_bayt: toplam });
    } catch (e) {
      hataYaz("turetilen_yazilamadi", e, { no });
    }
  };
  /** `.part` ve dizin; ikisi de gittiyse `true`. */
  const dosyalariSil = async (no: number): Promise<boolean> => {
    let tamam = true;
    try {
      await dosya.parcaSil(no);
    } catch (e) {
      hataYaz("parca_silinemedi", e, { no });
      tamam = false;
    }
    if (!(await dosya.dizinSil(no).catch(() => false))) tamam = false;
    return tamam;
  };

  // ---- bellek durumu ----
  /** Doğrulamadaki `ffprobe` sonucu: işçi videonun sesi var mı diye yeniden ölçmesin. */
  const sesAkislari = new Map<number, boolean>();
  /** Zaman aşımıyla bitmiş kaydın süren aracının çıktısı: içeriğe alınmaz (`<no>/<ad>`). */
  const haric = new Set<string>();
  const onbellek = new Map<number, Onbellek>();
  const yuklemeler = new Map<number, Promise<void>>();
  const siliniyor = new Map<number, Promise<void>>();

  // ---- işleme kuyruğu (tek işçi) ----
  const bekleyenler: number[] = [];
  let aktif: { no: number; ilerleme: Ilerleme; promise: Promise<void> } | null = null;
  const sonTarihler = new Map<number, IptalEt>();

  const sonTarihIptal = (no: number): void => {
    const iptal = sonTarihler.get(no);
    if (iptal !== undefined) {
      sonTarihler.delete(no);
      iptal();
    }
  };

  /** İşlemenin sonucunu yazar ve yayınlar. Kayıt yoksa sessiz. */
  const bitir = (no: number, isleme: MedyaIslemeDurumu, neden: MedyaIslemeNedeni | null, kare_adet: number | null): void => {
    sonTarihIptal(no);
    try {
      const k = depo.medyaKaydiGetir(no);
      if (k === null) return;
      guncelle(no, {
        isleme,
        isleme_nedeni: isleme === "hazir" ? null : (neden ?? "hata"),
        kare_adet: k.tur === "video" ? kare_adet : null,
      });
      bilgi("isleme_bitti", { no, medya_id: k.medya_id, isleme, neden: isleme === "hazir" ? null : (neden ?? "hata") });
      const son = depo.medyaKaydiGetir(no);
      if (son !== null && son.durum === "kabul") yayinla(son);
    } catch (e) {
      hataYaz("isleme_yazilamadi", e, { no });
    }
  };

  /** Yalnız işçinin süren kaydı için kurulur (`calistir`): sıradaki kaydın süresi işlenmeden dolmaz. */
  const zamanAsimi = (no: number): void => {
    sonTarihler.delete(no);
    if (aktif === null || aktif.no !== no) return;
    const il = aktif.ilerleme;
    if (il.bitti) return;
    il.bitti = true;
    if (il.adim !== null) haric.add(`${no}/${il.adim}`);
    const k = getir(no);
    const video = k?.tur === "video";
    bitir(no, video && il.uretilen > 0 ? "kismi" : "hata", "zaman_asimi", il.uretilen);
    // Süren araç kesilir: işçi aracın kendi zaman aşımını (döküm 15 dk'ya dek) beklemeden sıradakine geçer.
    il.iptal.abort();
  };

  /** `one`: kuyruk başındaki mesajın eki; sırada en öne alınır (süren kaydı kesmez). */
  const kuyrugaAl = (no: number, one = false): void => {
    if (kapali || aktif?.no === no || siliniyor.has(no)) return;
    const i = bekleyenler.indexOf(no);
    if (i >= 0) {
      if (one && i > 0) {
        bekleyenler.splice(i, 1);
        bekleyenler.unshift(no);
      }
      return;
    }
    if (one) bekleyenler.unshift(no);
    else bekleyenler.push(no);
    calistir();
  };

  const calistir = (): void => {
    if (aktif !== null || kapali) return;
    const no = bekleyenler.shift();
    if (no === undefined) return;
    const ilerleme: Ilerleme = { bitti: false, uretilen: 0, adim: null, iptal: new AbortController() };
    // Süre işçi kaydı aldığı an başlar.
    sonTarihIptal(no);
    sonTarihler.set(no, zamanlayici.sonra(s.islemeAzamiMs, () => zamanAsimi(no)));
    const is = isle(no, ilerleme)
      .catch((e: unknown) => hataYaz("isleme_hatasi", e, { no }))
      .then(() => (kapali ? undefined : turetilenYaz(no)));
    const promise = is.finally(() => {
      sonTarihIptal(no);
      if (aktif?.no === no) aktif = null;
      calistir();
    });
    aktif = { no, ilerleme, promise };
  };

  /** İşçi sıradaki adıma geçebilir mi: kayıt `kabul`, süre dolmadı, servis açık. */
  const devam = (no: number, il: Ilerleme): boolean => {
    if (il.bitti || kapali) return false;
    const k = getir(no);
    return k !== null && k.durum === "kabul";
  };

  /**
   * Bir aracı araç kilidiyle çalıştırır; başarı = zaman aşımı yok VE çıktı boyutu > 0. Başarısız ya da geç
   * çıktı boşaltılır. Sıra beklerken süre dolduysa ya da servis kapandıysa araç hiç çalışmaz.
   */
  const adim = async (
    no: number,
    il: Ilerleme,
    ad: MedyaDosyaAdi,
    calis: (iptal: AbortSignal) => Promise<{ zamanAsimi: boolean }>,
  ): Promise<{ ok: boolean; zamanAsimi: boolean }> => {
    await bosalt(no, ad); // eski çalışmanın çıktısı başarı sayılmasın
    let zamanAsimi = false;
    await aracla(false, async () => {
      if (il.bitti || kapali) return;
      il.adim = ad;
      try {
        zamanAsimi = (await calis(il.iptal.signal)).zamanAsimi;
      } catch (e) {
        hataYaz("arac_hatasi", e, { no });
      }
      il.adim = null;
    });
    const n = zamanAsimi || il.bitti ? null : await boyutOku(no, ad);
    const ok = !il.bitti && !zamanAsimi && n !== null && n > 0;
    if (!ok) await bosalt(no, ad);
    return { ok, zamanAsimi };
  };

  const isle = async (no: number, il: Ilerleme): Promise<void> => {
    const k = getir(no);
    if (k === null || k.durum !== "kabul" || islemeBitti(k) || k.bicim === null) {
      sonTarihIptal(no);
      return;
    }
    const bicim = k.bicim;
    guncelle(no, { isleme: "isleniyor", isleme_nedeni: null, kare_adet: null });
    const baslayan = getir(no);
    if (baslayan !== null && baslayan.durum === "kabul") yayinla(baslayan);

    if (k.tur === "foto") {
      // Normalde fotoğraf doğrulamada `hazir` olur; buraya yalnız yarıda kalmış bir kayıt düşer.
      const r = await adim(no, il, "gorsel.jpg", (iptal) => isleyici.gorselUret(no, bicim, iptal));
      if (!devam(no, il)) return;
      bitir(no, r.ok ? "hazir" : "hata", r.zamanAsimi ? "zaman_asimi" : "hata", null);
      return;
    }

    const zamanlar = k.sure_ms === null ? [] : isleyici.kareZamanlari(k.sure_ms);
    let kareZamanAsimi = false;
    for (let i = 0; i < zamanlar.length && i < KARE_EN_COK; i++) {
      if (!devam(no, il)) return;
      const sira = (i + 1) as KareSirasi;
      const z = zamanlar[i] as number;
      const r = await adim(no, il, kareAdi(sira), (iptal) => isleyici.kareUret(no, bicim, sira, z, iptal));
      if (il.bitti) return;
      if (r.ok) il.uretilen += 1;
      else if (r.zamanAsimi) kareZamanAsimi = true;
    }
    if (!devam(no, il)) return;
    if (il.uretilen === 0) {
      bitir(no, "hata", kareZamanAsimi ? "zaman_asimi" : "hata", 0);
      return;
    }

    // Döküm. Ses akışı doğrulamada ölçüldü; servis o arada yeniden başladıysa yeniden ölçülür.
    let ses = sesAkislari.get(no);
    if (ses === undefined) {
      let sesli = true;
      await aracla(false, async () => {
        if (il.bitti || kapali) return;
        try {
          sesli = (await isleyici.olc(no, bicim, il.iptal.signal))?.ses_akisi ?? true;
        } catch {
          sesli = true;
        }
      });
      ses = sesli;
      if (!devam(no, il)) return;
    }
    if (!ses) return bitir(no, "kismi", "ses_yok", il.uretilen);
    if (b.ayar.dokumModeli === null) return bitir(no, "kismi", "model_yok", il.uretilen);
    let ramDusuk = false;
    try {
      ramDusuk = b.sistem.ramOku().bosMb < b.ramDusukMb;
    } catch {
      ramDusuk = false;
    }
    if (ramDusuk) {
      uyari("dokum_atlandi_ram_dusuk", { no });
      return bitir(no, "kismi", "hata", il.uretilen);
    }
    await bosalt(no, "dokum.txt");
    const sure = k.sure_ms ?? 0;
    const r = await adim(no, il, "dokum.srt", (iptal) => isleyici.dokumUret(no, bicim, sure, iptal));
    if (!devam(no, il)) return;
    if (!r.ok) return bitir(no, "kismi", r.zamanAsimi ? "zaman_asimi" : "hata", il.uretilen);
    try {
      const srt = await dosya.oku(no, "dokum.srt", SRT_AZAMI_BAYT);
      if (srt === null || srt.length === 0) throw new Error("medya: döküm okunamadı");
      const dm = isleyici.dokumMetni(dec.decode(srt));
      await dosya.yaz(no, "dokum.txt", enc.encode(dm.metin));
    } catch (e) {
      hataYaz("dokum_yazilamadi", e, { no });
      if (!devam(no, il)) return;
      await bosalt(no, "dokum.srt");
      return bitir(no, "kismi", "hata", il.uretilen);
    }
    if (!devam(no, il)) return;
    bitir(no, "hazir", null, il.uretilen);
  };

  // ---- silme ----

  /** `silinecek` kaydın dosyalarını siler, satırı kaldırır. Süren işlemesini bekler. Hiç reddetmez. */
  const kayitSil = (no: number): Promise<void> => {
    const once = siliniyor.get(no);
    if (once !== undefined) return once;
    const p = (async () => {
      const i = bekleyenler.indexOf(no);
      if (i >= 0) bekleyenler.splice(i, 1);
      sonTarihIptal(no);
      if (aktif !== null && aktif.no === no) await aktif.promise.catch(bos);
      const k = getir(no);
      if (k === null || k.durum !== "silinecek") return;
      const tamam = await sirayla(anahtar(k.device_id, k.medya_id), () => dosyalariSil(no));
      if (!tamam) {
        uyari("medya_silinemedi", { no, medya_id: k.medya_id });
        return;
      }
      depo.medyaKaydiSil(no);
      sesAkislari.delete(no);
      for (const h of [...haric]) if (h.startsWith(`${no}/`)) haric.delete(h);
      bilgi("medya_silindi", { no, medya_id: k.medya_id });
    })()
      .catch((e: unknown) => hataYaz("medya_silme_hatasi", e, { no }))
      .finally(() => siliniyor.delete(no));
    siliniyor.set(no, p);
    return p;
  };

  /** Kaydı `silinecek` yapar (geri dönmez). */
  const silinecekYap = (k: MedyaKaydi): void => {
    if (k.durum !== "silinecek") guncelle(k.no, { durum: "silinecek" });
  };

  // ---- kota ----

  /** `boyut` bayt yer açar: gerekirse en eski gönderilmiş medyayı siler. Sığıyorsa `true`. */
  const yerAc = async (boyut: number): Promise<boolean> => {
    const kota = b.ayar.kotaBayt;
    if (depo.medyaDiskBayti() + boyut <= kota) return true;
    const adaylar = depo.medyaTahliyeAdaylari().filter((k) => aktif?.no !== k.no);
    const serbest = adaylar.reduce((t, k) => t + k.boyut + k.turetilen_bayt, 0);
    // Hepsini silmek de yetmeyecekse hiçbirine dokunulmaz.
    if (depo.medyaDiskBayti() - serbest + boyut > kota) return false;
    for (const k of adaylar) {
      if (depo.medyaDiskBayti() + boyut <= kota) break;
      const guncel = getir(k.no);
      if (guncel === null || guncel.durum !== "kabul") continue;
      silinecekYap(guncel);
      bilgi("medya_tahliye", { no: k.no, medya_id: k.medya_id, boyut: k.boyut + k.turetilen_bayt });
      await kayitSil(k.no);
    }
    return depo.medyaDiskBayti() + boyut <= kota;
  };

  // ---- yükleme ----

  /** Kaydı reddeder: dosyaları siler, `reddedildi` yazar (kayıt `silinecek`se o kalır), yayınlar. */
  const reddet = async (k: MedyaKaydi, kod: MedyaHatasi): Promise<MediaStateGovdesi> => {
    try {
      if (!(await dosyalariSil(k.no))) uyari("red_dosyasi_silinemedi", { no: k.no });
      guncelle(k.no, { durum: "reddedildi", red_kodu: kod });
      bilgi("medya_reddedildi", { no: k.no, medya_id: k.medya_id, code: kod });
      const son = getir(k.no);
      if (son === null) return red(k.medya_id, "medya_yok");
      yayinla(son);
      return govde(son);
    } catch (e) {
      hataYaz("red_yazilamadi", e, { no: k.no });
      return red(k.medya_id, kod);
    }
  };

  /**
   * Doğrulamanın araç kilidi altındaki kısmı: eski dizini temizler, `.part`'ı taşır, fotoğrafta `gorselUret`,
   * videoda `olc`; geçerse `kabul` yazar. Kendisi reddetmez (`red`'de çağıran `reddet` der); atabilir.
   */
  const tasiVeSina = async (k: MedyaKaydi, bicim: MedyaBicimi): Promise<Dogrulama> => {
    const no = k.no;
    if (kapali) return "kapandi"; // sıra beklerken kapandı: `.part` yerinde, açılışta yeniden doğrulanır
    // Yarıda kalmış eski bir doğrulamanın dizini (taşıma sonrası çökme) temizlenir.
    if (!(await dosya.dizinSil(no))) return "red";
    await dosya.tasi(no, bicim);
    if (k.tur === "foto") {
      const r = await isleyici.gorselUret(no, bicim, kapanis.signal);
      if (kapali) return "kapandi";
      const n = r.zamanAsimi ? null : await boyutOku(no, "gorsel.jpg");
      if (n === null || n <= 0) return "red";
      guncelle(no, { durum: "kabul", bicim, isleme: "hazir", isleme_nedeni: null, turetilen_bayt: n });
      return "kabul";
    }
    const o = await isleyici.olc(no, bicim, kapanis.signal);
    if (kapali) return "kapandi";
    const azami = MEDYA_SINIRLARI.VIDEO_SURE_MS * (1 + s.videoSurePayi);
    if (o === null || !o.video_akisi || o.sure_ms === null || o.sure_ms <= 0 || o.sure_ms > azami) return "red";
    sesAkislari.set(no, o.ses_akisi);
    guncelle(no, {
      durum: "kabul",
      bicim,
      isleme: null,
      isleme_nedeni: null,
      sure_ms: o.sure_ms,
      genislik: o.genislik,
      yukseklik: o.yukseklik,
    });
    return "kabul";
  };

  /**
   * `alinan == boyut`: koklama, (araç sırası) taşıma, fotoğrafta `gorselUret`, videoda `olc`. Kapanış
   * keserse red sayılmaz: kayıt `yukleniyor` kalır (açılışta `.part` duruyorsa yeniden doğrulanır,
   * taşınmışsa çökme sonrasıyla aynı: `alinan` 0'a iner), yanıt `reddedildi{medya_yok}` (kapanmış yönetici gibi).
   */
  const dogrula = async (k: MedyaKaydi): Promise<MediaStateGovdesi> => {
    const no = k.no;
    let sonuc: Dogrulama;
    try {
      const bas = await dosya.parcaOku(no, 0, KOKLAMA_BAYT);
      const bicim = isleyici.kokla(bas);
      if (bicim === null || !isleyici.beyanaUyar(bicim, k.tur, k.mime)) return await reddet(k, "medya_reddedildi");
      sonuc = await aracla(true, () => tasiVeSina(k, bicim));
    } catch (e) {
      if (kapali) sonuc = "kapandi";
      else {
        hataYaz("dogrulama_hatasi", e, { no });
        sonuc = "red";
      }
    }
    if (sonuc === "kapandi") return red(k.medya_id, "medya_yok");
    if (sonuc === "red") return await reddet(k, "medya_reddedildi");
    const son = getir(no);
    if (son === null) return red(k.medya_id, "medya_yok");
    if (son.durum === "kabul") {
      bilgi("medya_kabul", { no, medya_id: son.medya_id, bicim: son.bicim });
      yayinla(son);
      if (!islemeBitti(son)) kuyrugaAl(no);
    }
    return govde(son);
  };

  /** Var olan `yukleniyor` kayıt: `alinan` diskten; tamamsa doğrulama. Kayıt sırası içinden çağrılır. */
  const yarimiSur = async (k: MedyaKaydi): Promise<MediaStateGovdesi> => {
    let disk: number | null;
    try {
      disk = await dosya.parcaBoyutu(k.no);
    } catch (e) {
      hataYaz("parca_boyutu_okunamadi", e, { no: k.no });
      return reddet(k, "medya_reddedildi");
    }
    const alinan = disk ?? 0;
    if (alinan > k.boyut) return reddet(k, "medya_reddedildi");
    if (alinan !== k.alinan) depo.medyaGuncelle(k.no, { alinan });
    const guncel = getir(k.no);
    if (guncel === null) return red(k.medya_id, "medya_yok");
    if (guncel.durum !== "yukleniyor") return govde(guncel);
    if (alinan === k.boyut) return dogrula(guncel);
    return govde(guncel);
  };

  const yeniKayit = async (device_id: string, m: MedyaBaslangici): Promise<MediaStateGovdesi> => {
    if (kapali) return red(m.medya_id, "medya_yok");
    const sohbet = depo.sohbetGetir({ sohbet_id: m.sohbet_id });
    if (sohbet === null || sohbet.silinme_ms !== null) return red(m.medya_id, "medya_yok");
    if (depo.medyaBekleyenSayisi(device_id) >= MEDYA_SINIRLARI.BEKLEYEN_YUKLEME) return red(m.medya_id, "medya_siniri");
    if (!(await yerAc(m.boyut))) {
      uyari("kota_dolu", { medya_id: m.medya_id, boyut: m.boyut });
      return red(m.medya_id, "medya_siniri");
    }
    if (kapali) return red(m.medya_id, "medya_yok");
    const k = depo.medyaKaydiAc({
      device_id,
      medya_id: m.medya_id,
      sohbet_id: m.sohbet_id,
      tur: m.tur,
      mime: m.mime,
      boyut: m.boyut,
      olusturma_ms: saat.simdiMs(),
    });
    bilgi("yukleme_acildi", { no: k.no, medya_id: k.medya_id, tur: k.tur, boyut: k.boyut });
    return govde(k);
  };

  const baslatIc = async (device_id: string, m: MedyaBaslangici): Promise<MediaStateGovdesi> => {
    if (kapali) return red(m.medya_id, "medya_yok");
    const k = depo.medyaKaydiBul(device_id, m.medya_id);
    if (k === null) return sirayla(OLUSTURMA, () => yeniKayit(device_id, m));
    if (k.sohbet_id !== m.sohbet_id || k.tur !== m.tur || k.mime !== m.mime || k.boyut !== m.boyut) {
      return red(m.medya_id, "medya_reddedildi");
    }
    if (k.durum === "yukleniyor") return yarimiSur(k);
    return govde(k);
  };

  const parcaIc = async (device_id: string, m: { medya_id: string; ofset: number; veri: string }): Promise<MediaStateGovdesi> => {
    if (kapali) return red(m.medya_id, "medya_yok");
    const k = depo.medyaKaydiBul(device_id, m.medya_id);
    if (k === null) return red(m.medya_id, "medya_yok");
    if (k.durum !== "yukleniyor") return govde(k);
    if (m.ofset !== k.alinan) return govde(k);
    if (!parcaVerisiGecerliMi(m.veri)) return reddet(k, "medya_reddedildi");
    const uzunluk = base64BaytUzunlugu(m.veri);
    if (m.ofset + uzunluk > k.boyut) return reddet(k, "medya_reddedildi");
    const bayt = Buffer.from(m.veri, "base64");
    if (bayt.length !== uzunluk) return reddet(k, "medya_reddedildi");
    let yeni: number;
    try {
      yeni = await dosya.parcaEkle(k.no, m.ofset, bayt);
    } catch (e) {
      hataYaz("parca_yazilamadi", e, { no: k.no });
      return reddet(k, "medya_reddedildi");
    }
    guncelle(k.no, { alinan: yeni });
    const guncel = getir(k.no);
    if (guncel === null) return red(m.medya_id, "medya_yok");
    if (guncel.durum !== "yukleniyor") return govde(guncel);
    if (yeni === guncel.boyut) return dogrula(guncel);
    return govde(guncel);
  };

  // ---- ek denetimi ----

  const denetle = (device_id: string, sohbet: SohbetSecimi, ekler: EkListesi): Denetim => {
    const nolar: number[] = [];
    for (const e of ekler) {
      const k = depo.medyaKaydiBul(device_id, e.medya_id);
      if (k === null) return { ok: false, code: "medya_yok" };
      if (k.durum === "reddedildi") return { ok: false, code: "medya_reddedildi" };
      if (k.durum !== "kabul" || k.sohbet_id !== sohbet.sohbet_id || k.bagli_msg_id !== null) {
        return { ok: false, code: "medya_yok" };
      }
      if (k.tur !== e.tur || k.mime !== e.mime || k.boyut !== e.boyut) return { ok: false, code: "medya_yok" };
      nolar.push(k.no);
    }
    return { ok: true, nolar };
  };

  // ---- içerik önbelleği ----

  const base64 = (bayt: Uint8Array): string => Buffer.from(bayt.buffer, bayt.byteOffset, bayt.byteLength).toString("base64");

  /** Görsel dosyası base64; yoksa, boşsa, sınırı aşıyorsa ya da okunamazsa `null`. */
  const gorselOku = async (no: number, ad: MedyaDosyaAdi): Promise<string | null> => {
    if (haric.has(`${no}/${ad}`)) return null;
    try {
      const bayt = await dosya.oku(no, ad, s.gorselAzamiBayt);
      return bayt === null || bayt.length === 0 ? null : base64(bayt);
    } catch {
      return null;
    }
  };

  const hazirEk = async (k: MedyaKaydi): Promise<HazirEk> => {
    const ad = asilAdi(k);
    const yol = ad === null ? dosya.dizinYolu(k.no) : dosya.yol(k.no, ad);
    if (k.tur === "foto") return { tur: "foto", yol, gorsel: await gorselOku(k.no, "gorsel.jpg") };
    const zamanlar = k.isleme === "hata" || k.sure_ms === null ? [] : isleyici.kareZamanlari(k.sure_ms);
    const kareler: { zaman_ms: number; base64: string }[] = [];
    for (let i = 0; i < zamanlar.length && i < KARE_EN_COK; i++) {
      const b64 = await gorselOku(k.no, kareAdi(i + 1));
      if (b64 !== null) kareler.push({ zaman_ms: zamanlar[i] as number, base64: b64 });
    }
    let dokum: Extract<HazirEk, { tur: "video" }>["dokum"] = { var: false, neden: k.isleme_nedeni ?? "hata" };
    if (k.isleme === "hazir" && !haric.has(`${k.no}/dokum.srt`)) {
      try {
        const srt = await dosya.oku(k.no, "dokum.srt", SRT_AZAMI_BAYT);
        if (srt === null || srt.length === 0) throw new Error("medya: döküm yok");
        const dm = isleyici.dokumMetni(dec.decode(srt));
        dokum = { var: true, metin: dm.metin, kirpildi: dm.kirpildi };
      } catch {
        dokum = { var: false, neden: "hata" };
      }
    }
    return { tur: "video", yol, sure_ms: k.sure_ms, kareler, dokum };
  };

  /** Okuma bir yerde patlasa da ek düşmez: görselsiz, döküm `hata` notuyla gider (önbellek her zaman kurulur). */
  const hazirEkGuvenli = async (k: MedyaKaydi): Promise<HazirEk> => {
    try {
      return await hazirEk(k);
    } catch (e) {
      hataYaz("ek_okunamadi", e, { no: k.no });
      let yol: string;
      try {
        yol = dosya.dizinYolu(k.no);
      } catch {
        yol = "";
      }
      return k.tur === "foto"
        ? { tur: "foto", yol, gorsel: null }
        : { tur: "video", yol, sure_ms: k.sure_ms, kareler: [], dokum: { var: false, neden: "hata" } };
    }
  };

  const imzasi = (kayitlar: readonly MedyaKaydi[]): string => kayitlar.map((k) => `${k.no}:${k.isleme ?? ""}`).join(",");

  const onbellegeYukle = (kuyruk_id: number, kayitlar: readonly MedyaKaydi[], imza: string): void => {
    const p = (async () => {
      const ekler: HazirEk[] = [];
      for (const k of kayitlar) ekler.push(await hazirEkGuvenli(k));
      // Yükleme sürerken satır bırakıldı ya da kayıtlar değiştiyse önbelleğe yazılmaz.
      const simdiki = depo.kuyrukMedyalari(kuyruk_id).filter((k) => k.durum === "kabul");
      if (simdiki.length === 0 || imzasi(simdiki) !== imza) return;
      const ilk = kayitlar[0] as MedyaKaydi;
      onbellek.set(kuyruk_id, { sohbet_id: ilk.sohbet_id, imza, ekler });
      const guncel = getir(ilk.no);
      if (guncel !== null) yayinla(guncel);
    })()
      .catch((e: unknown) => hataYaz("icerik_yuklenemedi", e, { kuyruk_id }))
      .finally(() => yuklemeler.delete(kuyruk_id));
    yuklemeler.set(kuyruk_id, p);
  };

  // ---- süpürme ----

  const supurIc = async (): Promise<void> => {
    const esik = saat.simdiMs() - s.yarimOmurMs;
    const suresiDolan = [
      ...depo.medyaKayitlari({ durumlar: ["yukleniyor"], guncellemeOnce: esik }),
      ...depo.medyaKayitlari({ durumlar: ["kabul"], bagli: false, guncellemeOnce: esik }),
    ];
    for (const k of suresiDolan) {
      silinecekYap(k);
      bilgi("suresi_doldu", { no: k.no, medya_id: k.medya_id, durum: k.durum });
    }
    for (const k of depo.medyaKayitlari({ durumlar: ["reddedildi"], guncellemeOnce: esik })) {
      const tamam = await sirayla(anahtar(k.device_id, k.medya_id), () => dosyalariSil(k.no));
      if (tamam) depo.medyaKaydiSil(k.no);
      else {
        const guncel = getir(k.no);
        if (guncel !== null) silinecekYap(guncel);
      }
    }
    for (const k of depo.medyaKayitlari({ durumlar: ["silinecek"] })) await kayitSil(k.no);
    if (depo.medyaDiskBayti() > b.ayar.kotaBayt && !(await yerAc(0))) uyari("kota_asildi", { bayt: depo.medyaDiskBayti() });
  };

  const supur = (): Promise<void> => {
    if (kapali) return Promise.resolve();
    if (supuruyor !== null) return supuruyor;
    const p = supurIc()
      .catch((e: unknown) => hataYaz("supurme_hatasi", e))
      .finally(() => {
        supuruyor = null;
      });
    supuruyor = p;
    return p;
  };

  // ---- açılış uzlaştırması ----

  const uzlastir = async (): Promise<void> => {
    const yetim = depo.medyaYetimBaglariSil();
    if (yetim > 0) bilgi("yetim_bag_silindi", { adet: yetim });

    // Yarım yüklemeler: `alinan` diskten; tamamlanmış olanlar yeniden doğrulanır.
    for (const k of depo.medyaKayitlari({ durumlar: ["yukleniyor"] })) {
      await sirayla(anahtar(k.device_id, k.medya_id), async () => {
        const guncel = getir(k.no);
        if (guncel !== null && guncel.durum === "yukleniyor") await yarimiSur(guncel);
      });
    }

    // Sahipsiz dizinler ve `.part`'lar. Dizin yalnız `kabul`/`silinecek` kaydındır; `.part` yalnız `yukleniyor`'un.
    const satirlar = new Map(depo.medyaKayitlari().map((k) => [k.no, k] as const));
    try {
      for (const no of await dosya.dizinler()) {
        const k = satirlar.get(no);
        if (k !== undefined && (k.durum === "kabul" || k.durum === "silinecek")) continue;
        if (await dosya.dizinSil(no)) bilgi("sahipsiz_dizin_silindi", { no });
        else uyari("sahipsiz_dizin_silinemedi", { no });
      }
    } catch (e) {
      hataYaz("dizinler_okunamadi", e);
    }
    try {
      for (const no of await dosya.parcalar()) {
        if (satirlar.get(no)?.durum === "yukleniyor") continue;
        try {
          await dosya.parcaSil(no);
          bilgi("sahipsiz_parca_silindi", { no });
        } catch (e) {
          hataYaz("sahipsiz_parca_silinemedi", e, { no });
        }
      }
    } catch (e) {
      hataYaz("parcalar_okunamadi", e);
    }

    // İşlemesi bitmemiş kabul kayıtları yeniden kuyruğa.
    for (const k of depo.medyaKayitlari({ durumlar: ["kabul"] })) if (!islemeBitti(k)) kuyrugaAl(k.no);

    // `silinecek`lerin silmesi yeniden denenir.
    for (const k of depo.medyaKayitlari({ durumlar: ["silinecek"] })) await kayitSil(k.no);
  };

  // ---- yönetici ----

  return {
    baslat: async () => {
      if (basladi || kapali) return;
      basladi = true;
      try {
        await uzlastir();
      } catch (e) {
        hataYaz("uzlastirma_hatasi", e);
      }
      if (!kapali) supurmeIptal = zamanlayici.herAralik(s.supurmeAraligiMs, () => void supur());
    },

    yuklemeBaslat: async (device_id, m) => {
      if (kapali) return red(m.medya_id, "medya_yok");
      try {
        return await sirayla(anahtar(device_id, m.medya_id), () => baslatIc(device_id, m));
      } catch (e) {
        hataYaz("yukleme_baslatilamadi", e, { medya_id: m.medya_id });
        return red(m.medya_id, "medya_reddedildi");
      }
    },

    parca: async (device_id, m) => {
      if (kapali) return red(m.medya_id, "medya_yok");
      try {
        return await sirayla(anahtar(device_id, m.medya_id), () => parcaIc(device_id, m));
      } catch (e) {
        hataYaz("parca_hatasi", e, { medya_id: m.medya_id });
        return red(m.medya_id, "medya_reddedildi");
      }
    },

    iptal: (device_id, m) => {
      if (kapali) return;
      void sirayla(anahtar(device_id, m.medya_id), async (): Promise<number | null> => {
        const k = depo.medyaKaydiBul(device_id, m.medya_id);
        if (k === null || k.bagli_msg_id !== null) return null;
        silinecekYap(k);
        bilgi("yukleme_iptal", { no: k.no, medya_id: k.medya_id, durum: k.durum });
        return k.no;
      })
        .then((no) => (no === null ? undefined : kayitSil(no)))
        .catch((e: unknown) => hataYaz("iptal_hatasi", e, { medya_id: m.medya_id }));
    },

    ekleriDenetle: (device_id, sohbet, ekler) => {
      if (kapali) return { ok: false, code: "medya_yok" };
      try {
        const d = denetle(device_id, sohbet, ekler);
        return d.ok ? { ok: true, deger: undefined } : { ok: false, code: d.code };
      } catch (e) {
        hataYaz("ek_denetimi_hatasi", e);
        return { ok: false, code: "medya_yok" };
      }
    },

    ekleriBagla: (g) => {
      if (kapali) throw new Error("medya: yönetici kapalı");
      const d = denetle(g.device_id, g.sohbet, g.ekler);
      if (!d.ok) throw new Error(`medya: ekler bağlanamaz (${d.code})`);
      depo.medyaKuyrugaBagla({ kuyruk_id: g.kuyruk_id, client_msg_id: g.client_msg_id, nolar: d.nolar, ms: saat.simdiMs() });
    },

    icerik: ({ kuyruk_id, kullanici_metni }): MedyaIcerigiDurumu => {
      try {
        const kayitlar = depo.kuyrukMedyalari(kuyruk_id).filter((k) => k.durum === "kabul");
        if (kayitlar.length === 0) return { durum: "yok" };
        // İşleme tetiği depodan (bağlama işlemi geri alınabilirdi). Kuyruk başındaki satırın ekleri sırada
        // öne alınır, mesajdaki sırayla (sondan başa öne konur).
        const bitmemis = kayitlar.filter((k) => !islemeBitti(k));
        for (const k of [...bitmemis].reverse()) kuyrugaAl(k.no, true);
        if (bitmemis.length > 0) return { durum: "bekliyor" };
        const imza = imzasi(kayitlar);
        const o = onbellek.get(kuyruk_id);
        if (o !== undefined && o.imza === imza) {
          const icerik = medyaIcerigiKur({ ekler: o.ekler, kullanici_metni, cit: () => b.rastgele.hex64() });
          return { durum: "hazir", icerik, gorsel_adet: icerik.filter((x) => x.tur === "gorsel").length };
        }
        if (o !== undefined) onbellek.delete(kuyruk_id);
        if (!kapali && !yuklemeler.has(kuyruk_id)) onbellegeYukle(kuyruk_id, kayitlar, imza);
        return { durum: "bekliyor" };
      } catch (e) {
        // Kullanıcı mesajı düşmesin: ekler okunamıyorsa satır düz metin gider.
        hataYaz("icerik_kurulamadi", e, { kuyruk_id });
        return { durum: "yok" };
      }
    },

    icerikBirak: (kuyruk_id) => {
      onbellek.delete(kuyruk_id);
    },

    nesilGorselSayisi: (nesil) => depo.nesilGorselSayisi(nesil),
    nesilGorselEkle: (nesil, adet) => depo.nesilGorselEkle(nesil, adet),

    ekDizinleri: (sohbet, medya_idler) => {
      try {
        const kayitlar = depo.medyaKayitlari({ sohbet, bagli: true }).filter((k) => k.durum !== "silinecek");
        const sonuc: string[] = [];
        for (const id of medya_idler) {
          const k = kayitlar.find((x) => x.medya_id === id);
          if (k !== undefined) sonuc.push(dosya.dizinYolu(k.no));
        }
        return sonuc;
      } catch (e) {
        hataYaz("ek_dizinleri_hatasi", e);
        return [];
      }
    },

    sohbetMedyasiniSil: async (sohbet) => {
      try {
        for (const [id, o] of onbellek) if (o.sohbet_id === sohbet.sohbet_id) onbellek.delete(id);
        if (kapali) return;
        const l = depo.medyaKayitlari({ sohbet, durumlar: ["silinecek"] });
        await Promise.all(l.map((k) => kayitSil(k.no)));
      } catch (e) {
        hataYaz("sohbet_medyasi_silinemedi", e);
      }
    },

    bekle: async () => {
      for (let tur = 0; tur < 1000; tur++) {
        const sozler: Promise<unknown>[] = [
          ...(aktif === null ? [] : [aktif.promise]),
          ...siliniyor.values(),
          ...yuklemeler.values(),
          ...kuyruklar.values(),
          ...(supuruyor === null ? [] : [supuruyor]),
        ];
        if (sozler.length === 0 && (bekleyenler.length === 0 || kapali)) {
          // Zincirlenmiş `then`'ler (işçinin bir sonrakine geçişi) bir tur daha görülsün.
          await Promise.resolve();
          if (aktif === null && siliniyor.size === 0 && yuklemeler.size === 0 && kuyruklar.size === 0) return;
          continue;
        }
        await Promise.allSettled(sozler);
      }
    },

    kapat: async () => {
      if (kapali) return;
      kapali = true;
      supurmeIptal?.();
      supurmeIptal = null;
      for (const no of [...sonTarihler.keys()]) sonTarihIptal(no);
      bekleyenler.length = 0;
      // Süren araç (işçinin ya da doğrulamanın) kesilir: kapanış onun zaman aşımını beklemez. İşçinin
      // kaydı `kabul` + `isleniyor` kalır (açılışta yeniden kuyruğa); araç sırası bekleyenler araçsız döner.
      kapanis.abort();
      aktif?.ilerleme.iptal.abort();
      // Kesilen araç, silmeler, okumalar ve kayıt sıraları biter; yenisi başlamaz.
      for (let tur = 0; tur < 1000; tur++) {
        const sozler: Promise<unknown>[] = [
          ...(aktif === null ? [] : [aktif.promise]),
          ...siliniyor.values(),
          ...yuklemeler.values(),
          ...kuyruklar.values(),
          ...(supuruyor === null ? [] : [supuruyor]),
        ];
        if (sozler.length === 0) break;
        await Promise.allSettled(sozler);
      }
      onbellek.clear();
      bilgi("kapandi", {});
    },
  };
};
