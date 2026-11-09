/**
 * Köprü borusunun sunucu ucu: el sıkışma, yetki, fiili işleyiciye iletme, yanıt doğrulama.
 * Rol ve iş yalnız jetondan türer; `FiilIsleyiciler` dışında kimse çağrılmaz. MODULLER.md, "kopru-sunucu".
 */
import {
  AZAMI_CERCEVE,
  KOPRU_BORU_ADI,
  KOPRU_FIIL_SEMALARI,
  KopruYanit,
  PROTOKOL_SURUMU,
  fiilRoldeIzinliMi,
  kopruYukariCoz,
  sha256Hex,
  utf8Bayt,
} from "@eren/protocol";
import type { HataKodu, KopruAsagi, KopruFiili, KopruIstek } from "@eren/protocol";
import type {
  BoruBaglantisi,
  FiilIsleyiciler,
  GunlukAlanlari,
  IptalEt,
  JetonKapsami,
  KapatilabilirSunucu,
  KopruBaglami,
  KopruIptalNedeni,
  KopruSunucuBagimliliklari,
  KopruSunucuFabrikasi,
  Sonuc,
} from "./sozlesme.ts";

const MODUL = "kopru-sunucu";
const HELLO_SURESI_MS = 10_000;

type GenelIsleyici = (girdi: unknown, baglam: KopruBaglami, sinyal: AbortSignal) => Promise<Sonuc<unknown>>;

interface Baglanti {
  readonly port: BoruBaglantisi;
  /**
   * Yalnız depodaki jeton kaydından dolar. `null` iken `kopru_hello` bekleniyor. `eren`'de
   * `sohbet_id` + `nesil` taşır (`ErenKopruBaglami`): plan ve iş aitliği buradan, fiil girdisinden değil.
   */
  baglam: KopruBaglami | null;
  readonly suren: Map<string, AbortController>;
  sureIptal: IptalEt | null;
  kapali: boolean;
}

/** `depo.jetonlariSil` ile aynı eşitlik: rol ve kapsamın bütün alanları (iptal ve tek bağlantı kuralı). */
const kapsamEsit = (a: JetonKapsami, b: JetonKapsami): boolean => {
  switch (a.rol) {
    case "eren":
      return b.rol === "eren" && a.sohbet_id === b.sohbet_id && a.nesil === b.nesil;
    case "soru":
      return b.rol === "soru" && a.is_id === b.is_id;
    case "telefon":
      return b.rol === "telefon" && a.is_id === b.is_id && a.plan_id === b.plan_id && a.plan_hash === b.plan_hash;
  }
};

const jetonOzeti = (jeton: string): string => sha256Hex(utf8Bayt(jeton));

const hataYaniti = (istek_id: string, code: HataKodu): KopruYanit => ({
  v: PROTOKOL_SURUMU,
  type: "yanit",
  istek_id,
  ok: false,
  code,
});

/** `null`: işleyici sözleşmeye uymadı, çağıran `ic_hata` yollar. */
const sonucYaniti = (fiil: KopruFiili, istek_id: string, sonuc: Sonuc<unknown>): KopruYanit | null => {
  if (sonuc.ok === true) {
    const cikti = KOPRU_FIIL_SEMALARI[fiil].cikti.safeParse(sonuc.deger);
    if (!cikti.success) return null;
    return { v: PROTOKOL_SURUMU, type: "yanit", istek_id, ok: true, sonuc: cikti.data };
  }
  const yanit = KopruYanit.safeParse({
    v: PROTOKOL_SURUMU,
    type: "yanit",
    istek_id,
    ok: false,
    code: sonuc.code,
    detail: sonuc.detail,
  });
  return yanit.success ? yanit.data : null;
};

export const kopruSunucuKur: KopruSunucuFabrikasi = ({
  boru,
  depo,
  rastgele,
  anahtar,
  gunluk,
  zamanlayici,
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

  const yaz = (bag: Baglanti, mesaj: KopruAsagi): void => {
    if (bag.kapali) return;
    try {
      bag.port.satirYaz(JSON.stringify(mesaj));
    } catch {
      gunluk.uyari(MODUL, "yazma_hatasi");
      baglantiKapat(bag);
    }
  };

  /** El sıkışmış, açık bir bağlantı bu kapsamı taşıyor mu (tek bağlantı kuralı). */
  const kapsamKullanimda = (kapsam: JetonKapsami): boolean => {
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
    const cozum = kopruYukariCoz(satir);
    if (!cozum.ok) {
      // Sürüm farkı kablo kuralıdır (README, "Sürümleme"); gerisi "ilk mesaj kopru_hello değil".
      reddet(bag, cozum.kod === "protokol_uyumsuz" ? "protokol_uyumsuz" : "yetkisiz", "cerceve_gecersiz");
      return;
    }
    const mesaj = cozum.mesaj;
    if (mesaj.type !== "kopru_hello") {
      reddet(bag, "yetkisiz", "ilk_mesaj_hello_degil");
      return;
    }
    const ozet = jetonOzeti(mesaj.jeton);
    const kayit = depo.jetonBul(ozet);
    if (kayit === null || !anahtar.sabitZamanEsit(kayit.ozet, ozet)) {
      reddet(bag, "jeton_gecersiz", "jeton_bilinmiyor");
      return;
    }
    if (kayit.kapsam.rol !== mesaj.rol) {
      reddet(bag, "jeton_gecersiz", "rol_uyusmuyor");
      return;
    }
    // Tek bağlantı (M1, GUVENLIK 21): aynı ana oturum kapsamı açıkken ikinci köprü reddedilir, açık olan
    // sürer. Açık olan kopunca aynı jetonla yeniden bağlanılabilir. `soru`/`telefon`'da kural yok.
    if (kayit.kapsam.rol === "eren" && kapsamKullanimda(kayit.kapsam)) {
      reddet(bag, "jeton_gecersiz", "jeton_kullanimda", { sohbet_id: kayit.kapsam.sohbet_id });
      return;
    }
    bag.sureIptal?.();
    bag.sureIptal = null;
    bag.baglam = Object.freeze({ ...kayit.kapsam });
    gunluk.bilgi(
      MODUL,
      "el_sikisma",
      bag.baglam.rol === "eren" ? { rol: bag.baglam.rol, sohbet_id: bag.baglam.sohbet_id } : { rol: bag.baglam.rol },
    );
    yaz(bag, { v: PROTOKOL_SURUMU, type: "kopru_welcome", rol: bag.baglam.rol });
  };

  /** Hiç reddetmez: atan ya da sözleşmeye uymayan işleyici `ic_hata`dır, `detail` taşımaz. */
  const yanitUret = async (
    istek: KopruIstek,
    baglam: KopruBaglami,
    isleyiciler: FiilIsleyiciler,
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
    baglam: KopruBaglami,
    isleyiciler: FiilIsleyiciler,
    istek: KopruIstek,
  ): void => {
    const { istek_id, fiil } = istek;
    if (!fiilRoldeIzinliMi(baglam.rol, fiil)) {
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
    baglam: KopruBaglami,
    isleyiciler: FiilIsleyiciler,
    satir: string,
  ): void => {
    const cozum = kopruYukariCoz(satir);
    if (!cozum.ok) {
      gunluk.uyari(MODUL, "gecersiz_cerceve", { neden: cozum.kod, yollar: cozum.yollar.join(",") });
      baglantiKapat(bag);
      return;
    }
    const mesaj = cozum.mesaj;
    switch (mesaj.type) {
      case "kopru_hello":
        // Bağlantının kimliği ilk jetonla sabitlenir, ikinci hello onu değiştiremez.
        gunluk.uyari(MODUL, "ikinci_hello", { rol: baglam.rol });
        baglantiKapat(bag);
        return;
      case "iptal":
        bag.suren.get(mesaj.istek_id)?.abort("model_iptal" satisfies KopruIptalNedeni);
        return;
      case "istek":
        istekBaslat(bag, baglam, isleyiciler, mesaj);
        return;
    }
  };

  const satirIsle = (bag: Baglanti, isleyiciler: FiilIsleyiciler, satir: string): void => {
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

  const baglantiKabul = (port: BoruBaglantisi, isleyiciler: FiilIsleyiciler): void => {
    if (!acik) {
      port.kapat();
      return;
    }
    const bag: Baglanti = { port, baglam: null, suren: new Map(), sureIptal: null, kapali: false };
    baglantilar.add(bag);
    port.kapanisDinle(() => temizle(bag));
    port.satirDinle((satir) => satirIsle(bag, isleyiciler, satir));
    bag.sureIptal =
      zamanlayici.sonra(HELLO_SURESI_MS, () => {
        if (bag.baglam === null && !bag.kapali) reddet(bag, "yetkisiz", "sure_doldu");
      });
  };

  return {
    jetonUret(kapsam) {
      const jeton = rastgele.jeton();
      depo.jetonEkle({ ozet: jetonOzeti(jeton), kapsam });
      return jeton;
    },

    jetonlariIptalEt(kapsam) {
      depo.jetonlariSil(kapsam);
      for (const bag of [...baglantilar]) {
        if (bag.baglam !== null && kapsamEsit(bag.baglam, kapsam)) baglantiKapat(bag);
      }
    },

    erenJetonlariniSil() {
      // Önce depo: kapanan bağlantının yeniden denemesi silinmiş jetonu bulamasın.
      const silinen = depo.erenJetonlariniSil();
      let kapatilan = 0;
      for (const bag of [...baglantilar]) {
        if (bag.baglam?.rol === "eren") {
          baglantiKapat(bag);
          kapatilan++;
        }
      }
      gunluk.bilgi(MODUL, "eren_jetonlari_silindi", { silinen, kapatilan });
      return silinen;
    },

    async baslat(isleyiciler) {
      if (acik) throw new Error("köprü sunucusu zaten açık");
      acik = true;
      try {
        sunucu = await boru.dinle({
          ad: KOPRU_BORU_ADI,
          azamiSatir: AZAMI_CERCEVE.KOPRU,
          baglanti: (port) => baglantiKabul(port, isleyiciler),
        });
      } catch (hata) {
        acik = false;
        throw hata;
      }
    },

    async kapat() {
      acik = false;
      // Önce dinlemeyi bırak: gerçek sunucunun kapanışı açık bağlantıların bitmesini bekleyebilir.
      const kapanis = sunucu?.kapat();
      sunucu = null;
      for (const bag of [...baglantilar]) baglantiKapat(bag);
      await kapanis;
    },
  };
};
