import {
  AJANDA_AZAMI_CERCEVE,
  AJANDA_SINIRLARI,
  AJANDA_SURUMU,
  type AjandaGecmisGirdisi,
  AjandaIslem,
  type AjandaKaydi,
  type AjandaYazar,
  AjandaYetenekler,
  ajandaDegisikligiUygula,
  ajandaOrnekDurumuUygula,
  ajandaTelafiTamMi,
  type KayitDurumu,
  SINIRLAR,
} from "@eren/protocol";
import { ajandaAraclariKur } from "./ajanda-araclar.ts";
import { pcDefteriKur } from "./ajanda-pc.ts";
import {
  type Adim,
  dilimlerBilinir,
  degisiklikAni,
  dogrulaVeYaz,
  dogumParcasi,
  fark,
  govde,
  kayitDilimi,
  MODUL,
  reddet,
  verilenAlanlar,
  type YeniHal,
} from "./ajanda-ortak.ts";
import type { AjandaFabrikasi, AjandaGecmisSayfasi, AjandaIslemSonucuGovdesi } from "./sozlesme.ts";

/**
 * Ajanda modülü: bütün ajanda değişikliklerinin TEK kapısı (MODULLER.md "Ajanda dalgası" > "ajanda",
 * `docs/AJANDA.md`). Telefon işlemi (`islemUygula`) ve araç çağrısı (`araclar`, `ajanda-araclar.ts`)
 * aynı eşzamanlı sıradan, her biri tek `depo.islem` içinde geçer: değişiklik, geçmiş satırı ve
 * tekrarsızlık kaydı birlikte yazılır ya da hiçbiri. Kuralların kendisi `protocol`'dendir.
 *
 * Elle (uygulamadan) yazar `{yol: girdi_yolu | "elle", tur_kokeni: "insan", device_id}`: her zaman
 * kullanıcı emridir (`kullaniciEmriMi`), korunan alan doğmaz. Elle eklemede kaydın verilen bütün
 * alanları (`durum` hariç; `hatirlatmalar` ekranda hep verilir) `elle_alanlar`'a girer. Elle ekleme
 * otomatik ekleme değildir: tekil anahtar almaz, tekilleştirilmez.
 *
 * Sürüm 3 alanları (`simge`, `bolge`, `bolge_konumu`, `varis`, `baglantilar`, `ekler`) öteki alanlar gibi
 * işlenir: kurallar (kaldırma `null`'ı, bölge başka yere değişince konumun düşmesi, `elle_alanlar`,
 * korunan alanlar) `ajandaDegisikligiUygula`'dadır, geçmiş parçası `fark`/`dogumParcasi` ile
 * `AJANDA_ALANLARI`'ndan türer. Eski sürümün işlemi bu alanları taşımaz, bu yüzden onlara dokunmaz.
 * `bolge_konumu` hiçbir günlük satırına girmez (öteki kayıt alanları gibi).
 */

/**
 * Servisin bugün sunduğu yetenekler (`ana` bağlar). Boş: `ek_yedegi` ek saklama dilimiyle gelir. Yetenek
 * yalnız davranışı uygulandığında eklenir; hiçbiri asistan motoruna bağlı değildir.
 */
export const AJANDA_SUNULAN_YETENEKLER: readonly string[] = [];

type Sonuc = AjandaIslemSonucuGovdesi;

const basarili = (kayit_id: string, rev?: number): Sonuc => (rev === undefined ? { ok: true, kayit_id } : { ok: true, kayit_id, rev });

export const ajandaKur: AjandaFabrikasi = (b) => {
  const { depo, takvim, saat, rastgele, gunluk } = b;
  // Kanonik (tekil, ASCII artan) ve biçimce geçerli: geçersiz ad kurulumda atar (yapılandırma hatası).
  const yetenekler: readonly string[] = Object.freeze(AjandaYetenekler.parse([...new Set(b.yetenekler ?? [])].sort()));
  const yeniDepoId = (): string => rastgele.opakId("d");
  // PC oturumlarının turları (bellek; `ajanda-pc.ts`). Araçların `pc_oturumu` çağrısı ve kancalar paylaşır.
  const pc = pcDefteriKur({ takvim, saat, rastgele, gunluk });

  /** Var olan, silinmemiş kayıt ya da ret. */
  const canliKayit = (kayit_id: string): Adim<AjandaKaydi> => {
    const k = depo.ajandaKaydiGetir(kayit_id);
    if (k === null) return reddet("kayit_bulunamadi");
    if (k.silindi) return reddet("kayit_silinmis");
    return { ok: true, deger: k };
  };

  const sonucaCevir = (kayit_id: string, a: Adim<AjandaKaydi>): Sonuc =>
    a.ok ? basarili(kayit_id, a.deger.revizyon) : { ok: false, kayit_id, code: a.neden };

  /** Mevcut kayda değişiklik: doğrula, yaz. `girdi` parçaları `fark`'tan. */
  const degistir = (
    onceki: AjandaKaydi,
    yeni: YeniHal,
    yazar: AjandaYazar,
    islem: "guncelle" | "durum" | "onayla" | "sil" | "geri_yukle",
    simdi: number,
    ek: { temel_revizyon?: number } = {},
  ): Sonuc => {
    const ts = degisiklikAni(simdi, onceki);
    const { onceki: o, sonraki: s } = fark(govde(onceki), yeni);
    const girdi = { islem, yazar, onceki: o, sonraki: s, ...(ek.temel_revizyon === undefined ? {} : { temel_revizyon: ek.temel_revizyon }) };
    return sonucaCevir(onceki.kayit_id, dogrulaVeYaz(depo, yeni, onceki.revizyon, girdi, ts));
  };

  const ekle = (islem: Extract<AjandaIslem, { islem: "ekle" }>, yazar: AjandaYazar, device_id: string, simdi: number): Sonuc => {
    const { kayit_id } = islem;
    if (depo.ajandaKaydiGetir(kayit_id) !== null) return { ok: false, kayit_id, code: "kimlik_cakisiyor" };
    if (!dilimlerBilinir(takvim, islem.zaman, islem.hatirlatmalar)) return { ok: false, kayit_id, code: "saat_dilimi_bilinmiyor" };
    if (depo.ajandaKayitSayisi() >= AJANDA_SINIRLARI.KAYIT_ADET) return { ok: false, kayit_id, code: "kayit_siniri" };
    const yeni: YeniHal = {
      kayit_id,
      tur: islem.tur,
      baslik: islem.baslik,
      hatirlatmalar: islem.hatirlatmalar,
      ornekler: [],
      durum: "acik",
      taslak: false,
      silindi: false,
      elle_alanlar: verilenAlanlar(islem),
      kaynak: { yol: islem.girdi_yolu, tur_kokeni: "insan", device_id },
      olusturma_ms: simdi,
    };
    if (islem.aciklama !== undefined) yeni.aciklama = islem.aciklama;
    if (islem.zaman !== undefined) yeni.zaman = islem.zaman;
    if (islem.tekrar !== undefined) yeni.tekrar = islem.tekrar;
    // v3 alanları (eski sürümün `ekle`'si taşımaz). `bolge_konumu` ve `varis` yalnız `bolge` ile (şema).
    if (islem.simge !== undefined) yeni.simge = islem.simge;
    if (islem.bolge !== undefined) yeni.bolge = islem.bolge;
    if (islem.bolge_konumu !== undefined) yeni.bolge_konumu = islem.bolge_konumu;
    if (islem.varis !== undefined) yeni.varis = islem.varis;
    if (islem.baglantilar !== undefined) yeni.baglantilar = islem.baglantilar;
    if (islem.ekler !== undefined) yeni.ekler = islem.ekler;
    const girdi = { islem: "ekle" as const, yazar, onceki: {}, sonraki: dogumParcasi(yeni) };
    return sonucaCevir(kayit_id, dogrulaVeYaz(depo, yeni, 1, girdi, simdi));
  };

  const durumUygula = (
    k: AjandaKaydi,
    durum: KayitDurumu,
    ornek_tarihi: string | undefined,
    yazar: AjandaYazar,
    simdi: number,
  ): Sonuc => {
    if (ornek_tarihi === undefined) {
      const bir = ajandaDegisikligiUygula(k, { durum }, yazar);
      if (bir.uygulanan.length === 0) return basarili(k.kayit_id);
      return degistir(k, govde(bir.kayit), yazar, "durum", simdi);
    }
    // `bugun`: kaydın dilimindeki yerel gün (zamansız kayıt zaten `ornek_gecersiz`).
    const bugun = takvim.yerelAn(simdi, kayitDilimi(k) ?? takvim.kullaniciDilimi()).tarih;
    const s = ajandaOrnekDurumuUygula(k, ornek_tarihi, durum, bugun);
    if (!s.ok) return { ok: false, kayit_id: k.kayit_id, code: s.neden };
    if (!s.degisti) return basarili(k.kayit_id);
    const yeni: YeniHal = { ...govde(k), ornekler: s.ornekler };
    const once = k.ornekler.find((o) => o.tarih === ornek_tarihi)?.durum ?? null;
    const atildi = s.atilan.length > 0;
    const girdi = {
      islem: "durum" as const,
      yazar,
      ornek_tarihi,
      onceki: { ornek_durumu: once, ...(atildi ? { ornekler: k.ornekler } : {}) },
      sonraki: { ornek_durumu: durum === "acik" ? null : durum, ...(atildi ? { ornekler: s.ornekler } : {}) },
    };
    const ts = degisiklikAni(simdi, k);
    return sonucaCevir(k.kayit_id, dogrulaVeYaz(depo, yeni, k.revizyon, girdi, ts));
  };

  /** İşlemin kendisi (tekrarsızlık dışarıda). Atarsa çağıran `ic_hata` döner, hiçbir şey yazılmaz. */
  const islemCalistir = (device_id: string, ham: AjandaIslem, simdi: number): Sonuc => {
    const p = AjandaIslem.safeParse(ham);
    if (!p.success) return { ok: false, code: "gecersiz_islem" };
    const islem = p.data;
    const yazar: AjandaYazar = { yol: islem.islem === "ekle" ? islem.girdi_yolu : "elle", tur_kokeni: "insan", device_id };
    if (islem.islem === "ekle") return ekle(islem, yazar, device_id, simdi);

    const k = depo.ajandaKaydiGetir(islem.kayit_id);
    if (k === null) return { ok: false, kayit_id: islem.kayit_id, code: "kayit_bulunamadi" };
    if (islem.islem === "sil") {
      // Zaten silinmiş kayda `sil` yan etkisizdir.
      if (k.silindi) return basarili(k.kayit_id);
      return degistir(k, { ...govde(k), silindi: true }, yazar, "sil", simdi);
    }
    if (islem.islem === "geri_yukle") {
      if (!k.silindi) return basarili(k.kayit_id);
      return degistir(k, { ...govde(k), silindi: false }, yazar, "geri_yukle", simdi);
    }
    // Silme otomasyonu da elle düzenlemeyi de yener: mezar taşına yalnız `geri_yukle`.
    if (k.silindi) return { ok: false, kayit_id: k.kayit_id, code: "kayit_silinmis" };
    switch (islem.islem) {
      case "guncelle": {
        const d = islem.degisiklik;
        const zaman = d.zaman ?? undefined;
        if (!dilimlerBilinir(takvim, zaman, d.hatirlatmalar)) return { ok: false, kayit_id: k.kayit_id, code: "saat_dilimi_bilinmiyor" };
        const bir = ajandaDegisikligiUygula(k, d, yazar);
        if (bir.uygulanan.length === 0) return basarili(k.kayit_id);
        return degistir(k, govde(bir.kayit), yazar, "guncelle", simdi, { temel_revizyon: islem.temel_revizyon });
      }
      case "durum":
        return durumUygula(k, islem.durum, islem.ornek_tarihi, yazar, simdi);
      case "onayla":
        if (!k.taslak) return basarili(k.kayit_id);
        return degistir(k, { ...govde(k), taslak: false }, yazar, "onayla", simdi);
    }
  };

  /** Tek `depo.islem`: tekrarsızlık bakışı, işlem ve kalıcı sonuç birlikte. Atan her şey `ic_hata`. */
  const tekrarsiz = (device_id: string, islem_id: string, tur: string, f: (simdi: number) => Sonuc): Sonuc => {
    try {
      return depo.islem(() => {
        const kayitli = depo.ajandaIslemSonucuBul(device_id, islem_id);
        if (kayitli !== null) {
          gunluk.bilgi(MODUL, "islem_tekrari", { device_id, islem: tur, ok: kayitli.ok });
          return kayitli;
        }
        const simdi = saat.simdiMs();
        const sonuc = f(simdi);
        depo.ajandaIslemSonucuYaz(device_id, islem_id, sonuc, simdi);
        gunluk.bilgi(MODUL, "islem", {
          device_id,
          islem: tur,
          ok: sonuc.ok,
          code: sonuc.code ?? null,
          kayit_id: sonuc.kayit_id ?? null,
          rev: sonuc.rev ?? null,
        });
        return sonuc;
      });
    } catch (e) {
      // Hata metni kayıt içeriği taşıyabilir: yalnız türü yazılır.
      gunluk.hata(MODUL, "islem_hatasi", { device_id, islem: tur, hata: e instanceof Error ? e.name : "bilinmiyor" });
      return { ok: false, code: "ic_hata" };
    }
  };

  const GECMIS_SAYFA = AJANDA_SINIRLARI.GECMIS_SAYFA;

  /**
   * Sayfanın çerçeve sınırına sığan öneki. `GECMIS_SAYFA` girdi v3 alanlarıyla `AJANDA_AZAMI_CERCEVE.KANAL`'ı
   * aşabilir (her alanı değiştiren yirmi `guncelle`: ~2,2 M birim; protokol testi `ajanda-cerceve-boyu`),
   * istemci de onu `mesaj_cok_buyuk` ile reddeder. Bu yüzden sayfa, `gecmis` çerçevesinin en uzun
   * zarfıyla (`istek_id` `OPAK_ID` uzunlukta, `devami:true`) birlikte sınıra sığan kadar girdiyle kesilir;
   * kalanı `devami:true` ile sonraki sayfaya kalır (sözleşme "en çok `GECMIS_SAYFA`" der, istemci
   * `once_rev`'i son girdiden alır). Ölçü kablodaki gibi UTF-16 birimidir (`JSON.stringify(...).length`)
   * ve v3 halidir: v2'ye uyarlama yalnız alan atar, kısaltır. İlk girdi her zaman girer: şemanın en büyük
   * tek girdisi bile sınırın 1/16'sının altındadır (aynı test), boş sayfa `devami:true` ile istemciyi
   * döngüye sokardı.
   */
  const boyaSigan = (kayit_id: string, adaylar: AjandaGecmisGirdisi[]): AjandaGecmisGirdisi[] => {
    const zarf = { v: AJANDA_SURUMU, type: "gecmis", istek_id: "i".repeat(SINIRLAR.OPAK_ID), kayit_id, girdiler: [], devami: true };
    let boy = JSON.stringify(zarf).length;
    const sigan: AjandaGecmisGirdisi[] = [];
    for (const g of adaylar) {
      const ek = JSON.stringify(g).length + (sigan.length > 0 ? 1 : 0);
      if (sigan.length > 0 && boy + ek > AJANDA_AZAMI_CERCEVE.KANAL) break;
      sigan.push(g);
      boy += ek;
    }
    return sigan;
  };

  return {
    baslat() {
      depo.ajandaDepoKimligi(yeniDepoId);
      gunluk.bilgi(MODUL, "basladi", {
        bas_rev: depo.ajandaBasRev(),
        kayit_sayisi: depo.ajandaKayitSayisi(),
        yetenekler: yetenekler.join(","),
      });
    },

    islemUygula(device_id, islem_id, islem) {
      const tur = typeof islem === "object" && islem !== null && typeof islem.islem === "string" ? islem.islem : "bilinmiyor";
      return tekrarsiz(device_id, islem_id, tur, (simdi) => islemCalistir(device_id, islem, simdi));
    },

    gecersizIslem(device_id, islem_id) {
      return tekrarsiz(device_id, islem_id, "gecersiz", () => ({ ok: false, code: "gecersiz_islem" }));
    },

    karsila(hello) {
      return depo.islem(() => {
        const depo_id = depo.ajandaDepoKimligi(yeniDepoId);
        const bas_rev = depo.ajandaBasRev();
        const izdeki = hello.son_rev > 0 ? (depo.ajandaGecmisSatiri(hello.son_rev) ?? undefined) : undefined;
        const tam = ajandaTelafiTamMi({ hello, depo_id, bas_rev, izdeki });
        gunluk.bilgi(MODUL, "karsilama", { son_rev: hello.son_rev, bas_rev, tam });
        return { depo_id, bas_rev, tam };
      });
    },

    telafiSayfasi(g) {
      return depo.ajandaRevAraligi(g);
    },

    gecmis(kayit_id, once_rev): AjandaGecmisSayfasi {
      if (depo.ajandaKaydiGetir(kayit_id) === null) {
        return { kayit_id, girdiler: [], devami: false, code: "kayit_bulunamadi" };
      }
      const satirlar = depo.ajandaGecmisi({
        kayit_id,
        adet: GECMIS_SAYFA + 1,
        ...(once_rev === undefined ? {} : { once_rev }),
      });
      const girdiler = boyaSigan(kayit_id, satirlar.slice(0, GECMIS_SAYFA));
      return { kayit_id, girdiler, devami: satirlar.length > girdiler.length };
    },

    yetenekler,
    araclar: ajandaAraclariKur(b, pc),
    pcKanca: pc.kanca,
  };
};
