/**
 * Ajanda borusunun sunucu ucu (`AJANDA_BORU_ADI`): el sıkışma, jeton ve rol denetimi, fiili ajanda
 * modülünün işleyicisine iletme, yanıt doğrulama. `kopru-sunucu`'nun bütün değişmezleri burada da
 * geçerlidir; mevcut boruya dokunmamak için ayrı örnektir (ortak kod yalnız protokol işlevleri).
 * Rol, sohbet ve nesil yalnız jetondan (`ajanda_jetonlari`) türer; `AjandaFiilIsleyiciler` dışında
 * kimse çağrılmaz; kayıt metni günlüğe girmez. MODULLER.md "Ajanda dalgası" > "ajanda-kopru-sunucu".
 */
import { z } from "zod";
import {
  AJANDA_ARACLARI,
  AJANDA_AZAMI_CERCEVE,
  AJANDA_BORU_ADI,
  OpakId,
  PROTOKOL_SURUMU,
  ajandaFiilRoldeIzinliMi,
  ajandaKopruYukariCoz,
  cozumle,
  mesaj,
  sha256Hex,
  utf8Bayt,
} from "@eren/protocol";
import type { AjandaFiili, AjandaKopruAsagi, AjandaKopruIstek, HataKodu, KopruYanit } from "@eren/protocol";
import type {
  AjandaFiilIsleyiciler,
  AjandaJetonKapsami,
  AjandaKopruBaglami,
  AjandaKopruSunucuFabrikasi,
  BoruBaglantisi,
  GunlukAlanlari,
  IptalEt,
  KapatilabilirSunucu,
  KopruIptalNedeni,
  Sonuc,
} from "./sozlesme.ts";

const MODUL = "ajanda-kopru-sunucu";
const HELLO_SURESI_MS = 10_000;

type GenelIsleyici = (
  girdi: unknown,
  baglam: AjandaKopruBaglami,
  sinyal: AbortSignal,
) => Promise<Sonuc<unknown, HataKodu>>;

/**
 * Tam çözüm başarısızken yalnız zarf: fiil bu rolde izinli değilse `rol_fiil_izinsiz` yanıtı için
 * (`ajandaFiilRoldeIzinliMi` her dizgeyi alır). İzinli fiilin girdisi şemaya uymuyorsa çerçeve
 * geçersizdir ve bağlantı kapanır (köprü girdiyi boruya çıkmadan denetler).
 */
const IstekZarfi = mesaj("istek", { istek_id: OpakId, fiil: z.string().max(64), girdi: z.unknown() });

interface Baglanti {
  readonly port: BoruBaglantisi;
  /** Yalnız depodaki ajanda jeton kaydından dolar. `null` iken `kopru_hello` bekleniyor. */
  baglam: AjandaKopruBaglami | null;
  readonly suren: Map<string, AbortController>;
  sureIptal: IptalEt | null;
  kapali: boolean;
}

/** `depo.ajandaJetonlariSil` ile aynı eşitlik: kapsamın bütün alanları. */
const kapsamEsit = (a: AjandaJetonKapsami, b: AjandaJetonKapsami): boolean =>
  a.rol === b.rol && a.sohbet_id === b.sohbet_id && a.nesil === b.nesil;

const jetonOzeti = (jeton: string): string => sha256Hex(utf8Bayt(jeton));

const hataYaniti = (istek_id: string, code: HataKodu): KopruYanit => ({
  v: PROTOKOL_SURUMU,
  type: "yanit",
  istek_id,
  ok: false,
  code,
});

/** `null`: işleyici sözleşmeye uymadı, çağıran `ic_hata` yollar. `detail` hiç taşınmaz. */
const sonucYaniti = (fiil: AjandaFiili, istek_id: string, sonuc: Sonuc<unknown, HataKodu>): KopruYanit | null => {
  if (sonuc.ok === true) {
    const sema: z.ZodType = AJANDA_ARACLARI[fiil].cikti;
    const cikti = sema.safeParse(sonuc.deger);
    if (!cikti.success) return null;
    return { v: PROTOKOL_SURUMU, type: "yanit", istek_id, ok: true, sonuc: cikti.data };
  }
  // Sözleşme: boru düzeyi ret yalnız `tur_gecersiz` ve `ic_hata`.
  if (sonuc.code !== "tur_gecersiz" && sonuc.code !== "ic_hata") return null;
  return hataYaniti(istek_id, sonuc.code);
};

export const ajandaKopruSunucuKur: AjandaKopruSunucuFabrikasi = ({
  boru,
  depo,
  rastgele,
  anahtar,
  zamanlayici,
  gunluk,
}) => {
  const baglantilar = new Set<Baglanti>();
  let sunucu: KapatilabilirSunucu | null = null;
  let acik = false;

  const temizle = (bag: Baglanti): void => {
    if (bag.kapali) return;
    bag.kapali = true;
    bag.sureIptal?.();
    baglantilar.delete(bag);
    for (const denetleyici of bag.suren.values()) {
      denetleyici.abort("baglanti_koptu" satisfies KopruIptalNedeni);
    }
    bag.suren.clear();
  };

  const baglantiKapat = (bag: Baglanti): void => {
    temizle(bag);
    bag.port.kapat();
  };

  const yaz = (bag: Baglanti, m: AjandaKopruAsagi): void => {
    if (bag.kapali) return;
    try {
      bag.port.satirYaz(JSON.stringify(m));
    } catch {
      gunluk.uyari(MODUL, "yazma_hatasi");
      baglantiKapat(bag);
    }
  };

  /** El sıkışmış, açık bir bağlantı bu kapsamı taşıyor mu (tek bağlantı kuralı). */
  const kapsamKullanimda = (kapsam: AjandaJetonKapsami): boolean => {
    for (const diger of baglantilar) {
      if (!diger.kapali && diger.baglam !== null && kapsamEsit(diger.baglam, kapsam)) return true;
    }
    return false;
  };

  const reddet = (bag: Baglanti, code: HataKodu, neden: string, ek: GunlukAlanlari = {}): void => {
    gunluk.uyari(MODUL, "el_sikisma_ret", { code, neden, ...ek });
    yaz(bag, { v: PROTOKOL_SURUMU, type: "kopru_ret", code });
    baglantiKapat(bag);
  };

  const helloIsle = (bag: Baglanti, satir: string): void => {
    const cozum = ajandaKopruYukariCoz(satir);
    if (!cozum.ok) {
      reddet(bag, cozum.kod === "protokol_uyumsuz" ? "protokol_uyumsuz" : "yetkisiz", "cerceve_gecersiz");
      return;
    }
    const m = cozum.mesaj;
    if (m.type !== "kopru_hello") {
      reddet(bag, "yetkisiz", "ilk_mesaj_hello_degil");
      return;
    }
    const ozet = jetonOzeti(m.jeton);
    const kayit = depo.ajandaJetonBul(ozet);
    if (kayit === null || !anahtar.sabitZamanEsit(kayit.ozet, ozet)) {
      reddet(bag, "jeton_gecersiz", "jeton_bilinmiyor");
      return;
    }
    if (kayit.kapsam.rol !== m.rol) {
      reddet(bag, "jeton_gecersiz", "rol_uyusmuyor");
      return;
    }
    // Tek bağlantı: aynı ana oturum kapsamı açıkken ikinci köprü reddedilir, açık olan sürer.
    if (kapsamKullanimda(kayit.kapsam)) {
      reddet(bag, "jeton_gecersiz", "jeton_kullanimda", { sohbet_id: kayit.kapsam.sohbet_id });
      return;
    }
    bag.sureIptal?.();
    bag.sureIptal = null;
    bag.baglam = Object.freeze({ ...kayit.kapsam });
    gunluk.bilgi(MODUL, "el_sikisma", { rol: bag.baglam.rol, sohbet_id: bag.baglam.sohbet_id });
    yaz(bag, { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: bag.baglam.rol });
  };

  /** Hiç reddetmez: atan ya da sözleşmeye uymayan işleyici `ic_hata`dır, `detail` taşımaz. */
  const yanitUret = async (
    istek: AjandaKopruIstek,
    baglam: AjandaKopruBaglami,
    isleyiciler: AjandaFiilIsleyiciler,
    sinyal: AbortSignal,
  ): Promise<KopruYanit> => {
    try {
      const isleyici = isleyiciler[istek.fiil] as unknown as GenelIsleyici;
      const sonuc = await isleyici(istek.girdi, baglam, sinyal);
      const yanit = sonucYaniti(istek.fiil, istek.istek_id, sonuc);
      if (yanit !== null) return yanit;
      gunluk.hata(MODUL, "sonuc_gecersiz", { fiil: istek.fiil });
    } catch {
      gunluk.hata(MODUL, "isleyici_atti", { fiil: istek.fiil });
    }
    return hataYaniti(istek.istek_id, "ic_hata");
  };

  const istekBaslat = (
    bag: Baglanti,
    baglam: AjandaKopruBaglami,
    isleyiciler: AjandaFiilIsleyiciler,
    istek: AjandaKopruIstek,
  ): void => {
    const { istek_id, fiil } = istek;
    if (!ajandaFiilRoldeIzinliMi(baglam.rol, fiil)) {
      gunluk.uyari(MODUL, "rol_fiil_izinsiz", { rol: baglam.rol, fiil });
      yaz(bag, hataYaniti(istek_id, "rol_fiil_izinsiz"));
      return;
    }
    if (bag.suren.has(istek_id)) {
      yaz(bag, hataYaniti(istek_id, "yinelenen_istek"));
      return;
    }
    const denetleyici = new AbortController();
    bag.suren.set(istek_id, denetleyici);
    void yanitUret(istek, baglam, isleyiciler, denetleyici.signal).then((yanit) => {
      bag.suren.delete(istek_id);
      yaz(bag, yanit);
    });
  };

  const yukariIsle = (
    bag: Baglanti,
    baglam: AjandaKopruBaglami,
    isleyiciler: AjandaFiilIsleyiciler,
    satir: string,
  ): void => {
    const cozum = ajandaKopruYukariCoz(satir);
    if (!cozum.ok) {
      // Zarfı geçerli, fiili bu rolün olmayan istek (ör. `eren` borusunun fiili): bağlantı kapanmaz.
      const zarf = cozum.kod === "gecersiz_mesaj" ? cozumle(IstekZarfi, satir, AJANDA_AZAMI_CERCEVE.BORU) : null;
      if (zarf?.ok === true && !ajandaFiilRoldeIzinliMi(baglam.rol, zarf.mesaj.fiil)) {
        gunluk.uyari(MODUL, "rol_fiil_izinsiz", { rol: baglam.rol });
        yaz(bag, hataYaniti(zarf.mesaj.istek_id, "rol_fiil_izinsiz"));
        return;
      }
      gunluk.uyari(MODUL, "gecersiz_cerceve", { neden: cozum.kod, yollar: cozum.yollar.join(",") });
      baglantiKapat(bag);
      return;
    }
    const m = cozum.mesaj;
    switch (m.type) {
      case "kopru_hello":
        // Bağlantının kimliği ilk jetonla sabitlenir, ikinci hello onu değiştiremez.
        gunluk.uyari(MODUL, "ikinci_hello", { rol: baglam.rol });
        baglantiKapat(bag);
        return;
      case "iptal":
        bag.suren.get(m.istek_id)?.abort("model_iptal" satisfies KopruIptalNedeni);
        return;
      case "istek":
        istekBaslat(bag, baglam, isleyiciler, m);
        return;
    }
  };

  const satirIsle = (bag: Baglanti, isleyiciler: AjandaFiilIsleyiciler, satir: string): void => {
    if (bag.kapali) return;
    try {
      if (bag.baglam === null) helloIsle(bag, satir);
      else yukariIsle(bag, bag.baglam, isleyiciler, satir);
    } catch {
      gunluk.hata(MODUL, "satir_isleme_hatasi");
      if (bag.baglam === null) reddet(bag, "ic_hata", "ic_hata");
      else baglantiKapat(bag);
    }
  };

  const baglantiKabul = (port: BoruBaglantisi, isleyiciler: AjandaFiilIsleyiciler): void => {
    if (!acik) {
      port.kapat();
      return;
    }
    const bag: Baglanti = { port, baglam: null, suren: new Map(), sureIptal: null, kapali: false };
    baglantilar.add(bag);
    port.kapanisDinle(() => temizle(bag));
    port.satirDinle((satir) => satirIsle(bag, isleyiciler, satir));
    bag.sureIptal = zamanlayici.sonra(HELLO_SURESI_MS, () => {
      if (bag.baglam === null && !bag.kapali) reddet(bag, "yetkisiz", "sure_doldu");
    });
  };

  return {
    jetonUret(kapsam) {
      const jeton = rastgele.jeton();
      depo.ajandaJetonEkle({ ozet: jetonOzeti(jeton), kapsam: { ...kapsam } });
      return jeton;
    },

    jetonlariIptalEt(kapsam) {
      depo.ajandaJetonlariSil(kapsam);
      for (const bag of [...baglantilar]) {
        if (bag.baglam !== null && kapsamEsit(bag.baglam, kapsam)) baglantiKapat(bag);
      }
    },

    jetonlariniSil() {
      // Önce depo: kapanan bağlantının yeniden denemesi silinmiş jetonu bulamasın.
      const silinen = depo.ajandaJetonlariniSil();
      let kapatilan = 0;
      for (const bag of [...baglantilar]) {
        baglantiKapat(bag);
        kapatilan++;
      }
      gunluk.bilgi(MODUL, "ajanda_jetonlari_silindi", { silinen, kapatilan });
      return silinen;
    },

    async baslat(isleyiciler) {
      if (acik) throw new Error("ajanda köprü sunucusu zaten açık");
      acik = true;
      try {
        sunucu = await boru.dinle({
          ad: AJANDA_BORU_ADI,
          azamiSatir: AJANDA_AZAMI_CERCEVE.BORU,
          baglanti: (port) => baglantiKabul(port, isleyiciler),
        });
      } catch (hata) {
        acik = false;
        throw hata;
      }
    },

    async kapat() {
      acik = false;
      const kapanis = sunucu?.kapat();
      sunucu = null;
      for (const bag of [...baglantilar]) baglantiKapat(bag);
      await kapanis;
    },
  };
};
