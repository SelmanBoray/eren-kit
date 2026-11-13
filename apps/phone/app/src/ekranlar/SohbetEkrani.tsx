// Sohbet ekranı (TASARIM.md 5, 6.1-6.4, 6.9-6.12, 6.15-6.16; app/TASARIM.md Dilim 2 E6): seçili
// sohbetin üst çubuğu, zaman çizelgesi, "en alta in", giriş çubuğu ve çalışan işler katmanları.
// Sohbet menüsü ve ad/geçmiş/silme diyalogları App'teki `SohbetYonetimi`'nde (`onSecenekler`).
// Balonlar `Balonlar.tsx`'te, katmanlar `SohbetDiyaloglari.tsx`'te.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AppState, FlatList, Keyboard, Text, TextInput, View } from "react-native";
import type {
  LayoutChangeEvent,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ViewStyle,
} from "react-native";
import type { GirdiYolu } from "@eren/protocol";
import type {
  CalisanIs,
  Cekirdek,
  GonderRedNedeni,
  GorunumOgesi,
  Sohbet,
  SohbetAcSonucu,
  SohbetDurumu,
  SohbetHatasi,
  SohbetId,
  TuketimRaporu,
} from "../cekirdek/index.ts";
import type { ErenCihaz } from "../cihaz/erenDevice.ts";
import { AltaInDugmesi, useAltaIn } from "./AltaIn.tsx";
import {
  AkisBalonu,
  BekleyenIstekNotu,
  BosDurum,
  GonderilemediSeridi,
  KullaniciBalonu,
  Yukleniyor,
  ZamanAyraci,
  ZamanCizelgesiOgesi,
  ogePropEsit,
  useAzHareket,
} from "./Balonlar.tsx";
import { Dugme } from "./Bilesenler.tsx";
import { CalisanIslerSayfasi, IsIptalOnayi, SohbetiSilOnayi } from "./SohbetDiyaloglari.tsx";
import { UstCubuk } from "./UstCubuk.tsx";
import type { UstCubukProps } from "./UstCubuk.tsx";
import { ASISTAN_ADI } from "../platform/asistanAdi.ts";
import { useCekirdekDurumu, useSohbetDurumu } from "./baglam.ts";
import {
  altBaslikHesapla,
  etkinlikEtiketiHesapla,
  etkinlikSayaciGerekli,
  gorunenEtkinlik,
  hatHesapla,
  kaliciHataVar,
} from "./baglantiDurumu.ts";
import type { SohbetAltBaslikGirdisi } from "./baglantiDurumu.ts";
import { bosluk, cizgi, esik, olcu, renk, stil, sure, yaricap, yazi } from "./tema.ts";

// ---------------------------------------------------------------- Üst çubuk durumu (6.1-6.3)

type SeritBilgisi = NonNullable<UstCubukProps["serit"]>;

// Alt başlık, hat ve kalıcı/geçici hata kararı `baglantiDurumu.ts`'te: App'teki üst çubuklar ve
// çekmece de aynı kararı kullanır.

const BAGLANTI_HATASI: Partial<Record<SohbetHatasi, string>> = {
  eslesme_yok: "PC ile eşleşme yok, Kurulum ekranından eşleştir",
  eslesme_gecersiz: "Eşleşmedeki PC adresi geçersiz, Kurulum ekranından yeniden eşleştir",
  kimlik_portu: "Telefondaki kimlik modülü yanıt vermedi",
  pc_imzasi_gecersiz: "PC'nin kimliği doğrulanamadı, yeniden eşleştirmen gerekebilir",
  sira_disi: "PC'den beklenmeyen bir yanıt geldi",
  cozum_hatasi: "PC'den çözülemeyen bir yanıt geldi",
  yetkisiz: "PC bu telefonu tanımıyor, Kurulum ekranından yeniden eşleştir",
  cihaz_bilinmiyor: "PC bu telefonu tanımıyor, Kurulum ekranından yeniden eşleştir",
  imza_gecersiz: "Kimlik doğrulanamadı, Kurulum ekranından yeniden eşleştir",
  ip_uyusmuyor: "Bağlantı beklenmeyen bir adresten geldi, Tailscale'e bak",
  protokol_uyumsuz: "Uygulama ile servisin sürümü uyuşmuyor, ikisini birlikte güncelle",
};

/** Hata şeridi cümlesi; eşlemesiz kodda 6.3'teki genel cümle. Kod parantez içinde, sonda. */
export function hataSeridiMetni(h: SohbetHatasi): string {
  const c = BAGLANTI_HATASI[h];
  return c !== undefined ? `${c} (${h}).` : `Bağlanılamadı (${h}). Kurulum ekranına bak.`;
}

/**
 * 6.3: depo hatası hemen; kurulamamış sohbet hemen (hata şeridi + "Seçenekler"); bağlantı sorunu
 * `sorunUzun` (3 sn'yi aştı) olunca. Kalıcı hata (eşleşme, kimlik, sürüm) hata şeridi + "Kurulum";
 * geçici kopma uyarı şeridi + "Şimdi bağlan".
 */
function seritHesapla(
  d: SohbetDurumu,
  sorunUzun: boolean,
  simdiBaglan: () => void,
  onKurulum: (() => void) | undefined,
  onSecenekler: () => void,
): SeritBilgisi | null {
  if (d.hata === "depo_hatasi") {
    return { tur: "hata", metin: "Telefondaki kayıt okunamadı. Uygulamayı kapatıp yeniden aç." };
  }
  if (d.ozet?.kurulum === "kurulamadi") {
    return { tur: "hata", metin: "Sohbet PC'de oluşturulamadı.", eylem: { yazi: "Seçenekler", basinca: onSecenekler } };
  }
  if (!sorunUzun || d.baglanti === "bagli") return null;
  if (kaliciHataVar(d) && d.hata !== null) {
    return {
      tur: "hata",
      metin: hataSeridiMetni(d.hata),
      ...(onKurulum !== undefined ? { eylem: { yazi: "Kurulum", basinca: onKurulum } } : {}),
    };
  }
  if (d.baglanti === "kapali" || d.hata !== null) {
    return {
      tur: "uyari",
      metin: "Bağlantı yok. Mesajların telefonda bekliyor, bağlanınca gider.",
      eylem: { yazi: "Şimdi bağlan", basinca: simdiBaglan },
    };
  }
  return null;
}

/** `kosul` en az `ms` boyunca kesintisiz doğruysa `true`; yanlış olunca hemen `false`. */
function useGecikmeli(kosul: boolean, ms: number): boolean {
  const [gecti, setGecti] = useState(false);
  useEffect(() => {
    if (!kosul) {
      setGecti(false);
      return;
    }
    const t = setTimeout(() => setGecti(true), ms);
    return () => clearTimeout(t);
  }, [kosul, ms]);
  return kosul && gecti;
}

/**
 * Etkinlik süresi için saniyelik saat. `anahtar` `null` iken zamanlayıcı yoktur (dönen değer
 * kullanılmamalı); değişince saat hemen tazelenir ve sayaç yeniden kurulur. Ekran kapanınca
 * (bileşen sökülünce) durur. Kaynak `Date.now()`: çekirdeğin saat portu (`platform/saat.ts`
 * `saatKur().simdiMs`) da budur, `baslangic_ms` bu saatle yazılır.
 */
function useSaniyeSaati(anahtar: string | null): number {
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    if (anahtar === null) return;
    setSimdi(Date.now());
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anahtar]);
  return simdi;
}

// ---------------------------------------------------------------- Zaman çizelgesi düzeni (6.4, 6.10)

type Taraf = "kullanici" | "asistan" | "diger";

function tarafi(o: GorunumOgesi): Taraf {
  if (o.tur === "kullanici") return "kullanici";
  if (o.tur === "asistan") return "asistan";
  if (o.tur === "tur_kesildi" && o.kismi_metin !== null && o.kismi_metin.trim() !== "") return "asistan";
  return "diger";
}

/** Aynı göndericinin ardışık balonları arası 4, gönderici değişince (ve kart, not) 12. */
function araBosluk(onceki: Taraf | null, simdiki: Taraf): number {
  if (onceki === null) return 0;
  return onceki === simdiki && simdiki !== "diger" ? bosluk[1] : bosluk[3];
}

/** 6.10: okunmamış sayısına giren, asistan kaynaklı öğeler. */
function erenKaynakli(o: GorunumOgesi): boolean {
  switch (o.tur) {
    case "asistan":
    case "plan":
    case "plan_gizlendi":
    case "soru":
    case "rapor":
    case "tur_kesildi":
    case "devir":
      return true;
    case "sistem":
      return o.seviye !== "bilgi";
    default:
      return false;
  }
}

const anahtar = (o: GorunumOgesi): string => String(o.seq);

type OgeSatiriProps = {
  oge: GorunumOgesi;
  ust: number;
  ayrac: number | null;
  sohbet: Sohbet;
  cihaz: ErenCihaz;
  onIsler: () => void;
  /** Yalnız rapor kartı öğelerine verilir (diğerlerine `null`); değişimi `ogePropEsit` değerce karşılaştırır. */
  tuketimRaporu: TuketimRaporu | null;
};

const OgeSatiri = memo(function OgeSatiri(p: OgeSatiriProps): ReactNode {
  return (
    <View style={{ paddingTop: p.ust }}>
      {p.ayrac !== null && (
        <View style={{ paddingBottom: bosluk[3] }}>
          <ZamanAyraci ms={p.ayrac} />
        </View>
      )}
      <ZamanCizelgesiOgesi oge={p.oge} sohbet={p.sohbet} cihaz={p.cihaz} onIsler={p.onIsler} tuketimRaporu={p.tuketimRaporu} />
    </View>
  );
}, (a, b) => a.ust === b.ust && a.ayrac === b.ayrac && ogePropEsit(a, b));

// ---------------------------------------------------------------- Metinler

const GONDER_RED: Partial<Record<GonderRedNedeni, string>> = {
  gecersiz: "Mesaj çok uzun ya da geçersiz.",
  baslamadi: "Uygulama henüz hazır değil, biraz sonra yeniden dene.",
  sohbet_bulunamadi: "Bu sohbet artık yok.",
};

const KES_RED: Partial<Record<GonderRedNedeni, string>> = {
  bagli_degil: "Bağlantı yok, tur kesilemedi.",
  depo_hatasi: "Tur kesilemedi: telefonda kayıt hatası.",
  sohbet_bulunamadi: "Bu sohbet artık yok.",
};

const SOHBET_AC_RED: Record<Extract<SohbetAcSonucu, { ok: false }>["neden"], string> = {
  sohbet_siniri: "En çok 8 sohbet açılabilir. Birini sil.",
  baslamadi: "Uygulama henüz hazır değil, biraz sonra yeniden dene.",
  gecersiz: "Yeni sohbet açılamadı.",
  depo_hatasi: "Yeni sohbet açılamadı: telefonda kayıt hatası.",
};

/** Giriş çubuğunun üstündeki tek satırlık not: ret/hata `hata`, "Yeni sohbet" sınırı `uyari` (6.12). */
type Not = { metin: string; tur: "hata" | "uyari" };
const hataNotu = (metin: string): Not => ({ metin, tur: "hata" });

/** Yeni açılmış, henüz boş bir sohbet mi (6.12: boş durumla açılır, girdi odak alır). */
function bosYeniSohbet(d: SohbetDurumu): boolean {
  return (
    d.ozet !== null &&
    !d.ozet.ana &&
    d.ozet.kurulum !== "kurulamadi" &&
    d.ogeler.length === 0 &&
    d.bekleyenler.length === 0 &&
    d.akis === null
  );
}

const icerikStili: ViewStyle = {
  flexGrow: 1,
  paddingHorizontal: bosluk[4],
  paddingTop: bosluk[3],
  paddingBottom: bosluk[3],
};
const bosAltStili: ViewStyle = { flexGrow: 1 };

// ---------------------------------------------------------------- Ekran

export type SohbetEkraniProps = {
  cekirdek: Cekirdek;
  /** Seçili sohbetin tutamacı (`cekirdek.sohbet(cd.secili)`). */
  sohbet: Sohbet;
  cihaz: ErenCihaz;
  /** Üst çubuktaki menü düğmesi: çekmeceyi açar. */
  onCekmece: () => void;
  /** Üst çubuktaki "{ad} seçenekleri" ve kurulamamış sohbet şeridi: App'teki `SohbetYonetimi`'ni açar. */
  onSecenekler: (id: SohbetId) => void;
  /** İsteğe bağlı: hata şeridindeki ve eşleşme yok durumundaki "Kurulum" düğmesi. Yoksa düğme gizli. */
  onKurulum?: () => void;
};

/**
 * Sohbet değişince ekranın bütün yerel durumu (kaydırma, girdi taslağı, kesme, sayaçlar, açık
 * katmanlar) sıfırlanır: App `key={cd.secili}` verse de vermese de iç bileşen sohbet kimliğiyle
 * yeniden kurulur, eski sohbetin durumu yenisine taşınmaz.
 */
export function SohbetEkrani(p: SohbetEkraniProps): ReactNode {
  return <SohbetEkraniIc key={p.sohbet.sohbet_id} {...p} />;
}

function SohbetEkraniIc(p: SohbetEkraniProps): ReactNode {
  const { cekirdek, sohbet, cihaz, onCekmece, onSecenekler, onKurulum } = p;
  const cd = useCekirdekDurumu(cekirdek);
  // Rapor kartlarındaki "Tüketim" satırı için eldeki rapor; kartlar çekirdeğe kendileri abone olmaz.
  const tuketimRaporu: TuketimRaporu | null = cd.tuketim.durum === "yok" ? null : cd.tuketim.rapor;
  const d = useSohbetDurumu(sohbet);
  const ozet = d.ozet;
  const ogeler = d.ogeler;
  const azHareket = useAzHareket();

  const [metin, setMetin] = useState("");
  const [yol, setYol] = useState<GirdiYolu>("yazi");
  const [not, setNot] = useState<Not | null>(null);
  const [odak, setOdak] = useState(false);
  const [ilkOdak] = useState(() => bosYeniSohbet(d));
  // Basılan "Turu kes": hangi tur ve (kuyruğa yazılınca) isteğin kimliği.
  const [kesme, setKesme] = useState<{ tur: string; id: string | null } | null>(null);
  const [islerAcik, setIslerAcik] = useState(false);
  const [iptalIs, setIptalIs] = useState<CalisanIs | null>(null);
  const [kaldirAcik, setKaldirAcik] = useState(false);
  const gonderiliyor = useRef(false);
  const dikteSuruyor = useRef(false);
  const yeniAciliyor = useRef(false);

  // ------------------------------------------------ Kaydırma ve "en alta in" (6.10)

  const liste = useRef<FlatList<GorunumOgesi>>(null);
  const {
    durum: altaInDurumu,
    onScroll: altaInScroll,
    onContentSizeChange: altaInIcerik,
    alttaMi,
    yeniOgeler,
    indi,
  } = useAltaIn();
  const suruklemede = useRef(false);
  // Altta sabit: açılışta ve her programlı inişten (düğme, gönderme, silme) sonra, kullanıcı listeye
  // dokunana dek. Bu sürede "uzakta" diyen kaydırma olayları (animasyonun ara konumları, ölçülmemiş
  // satırların kestirimiyle yapılan atlama) sayaca ve düğmeye geçmez; liste altta tutulur.
  const sabit = useRef(true);
  const kaydirmaDenemesi = useRef(0);
  // "Okundu" kararı için: kancanın alt ref'inin render'a yansıyan kopyası (yalnız geçişte değişir).
  const [altta, setAltta] = useState(true);

  const sonaIn = useCallback(
    (animasyonlu: boolean) => {
      indi();
      setAltta(true);
      sabit.current = true;
      liste.current?.scrollToEnd({ animated: animasyonlu });
    },
    [indi],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (sabit.current) {
        const n = e.nativeEvent;
        const uzaklik = n.contentSize.height - n.contentOffset.y - n.layoutMeasurement.height;
        if (uzaklik >= esik.altaInGizle) return;
      }
      altaInScroll(e);
      const a = alttaMi();
      setAltta((o) => (o === a ? o : a));
    },
    [altaInScroll, alttaMi],
  );

  // Alttayken büyüyen içerik (yeni öğe, akan metin, açılan kart) listeyi altta tutar; yukarıdayken
  // liste yerinde kalır. Parmak listedeyken kendiliğinden kaydırma yapılmaz. Kanca da bilgilendirilir:
  // yukarıdayken kaydırmasız büyüyen içerik "en alta in" düğmesini gösterebilsin (kanca alttaki
  // kullanıcının durumuna dokunmaz, bu yüzden sıra önemsiz).
  const onContentSizeChange = useCallback(
    (genislik: number, yukseklik: number) => {
      altaInIcerik(genislik, yukseklik);
      if (!suruklemede.current && alttaMi()) liste.current?.scrollToEnd({ animated: false });
    },
    [altaInIcerik, alttaMi],
  );

  // Klavye ya da şerit listeyi kısaltınca alttaysa altta kalır.
  const listeYuksekligi = useRef(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      const kisaldi = h < listeYuksekligi.current;
      listeYuksekligi.current = h;
      if (kisaldi && alttaMi()) liste.current?.scrollToEnd({ animated: false });
    },
    [alttaMi],
  );

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const k = Keyboard.addListener("keyboardDidShow", () => {
      if (!alttaMi()) return;
      if (t !== null) clearTimeout(t);
      t = setTimeout(() => liste.current?.scrollToEnd({ animated: false }), 120);
    });
    return () => {
      k.remove();
      if (t !== null) clearTimeout(t);
    };
  }, [alttaMi]);

  // Yeni öğeler: yukarıdayken okunmamış sayacı artar (başlayan akış 1 sayılır, onun kalıcı yanıtı
  // ayrıca sayılmaz). Mezar taşı ya da yerel sıfırlama listeyi kısaltınca en alta inilir.
  const akanTur = d.akis?.turn_id ?? null;
  const onceki = useRef<{ ogeler: readonly GorunumOgesi[]; tur: string | null }>({ ogeler, tur: akanTur });
  const akanTurlar = useRef(new Set<string>());
  useEffect(() => {
    const o = onceki.current;
    onceki.current = { ogeler, tur: akanTur };
    let adet = 0;
    if (akanTur !== null && akanTur !== o.tur && !akanTurlar.current.has(akanTur)) {
      akanTurlar.current.add(akanTur);
      adet++;
    }
    if (ogeler !== o.ogeler) {
      const sonSeq = o.ogeler[o.ogeler.length - 1]?.seq ?? 0;
      let sifirlandi = ogeler.length < o.ogeler.length;
      for (let i = ogeler.length - 1; i >= 0; i--) {
        const x = ogeler[i];
        if (x === undefined || x.seq <= sonSeq) break;
        if (x.tur === "gecmis_silindi") sifirlandi = true;
        if ((x.tur === "asistan" || x.tur === "tur_kesildi") && akanTurlar.current.delete(x.turn_id)) continue;
        if (erenKaynakli(x)) adet++;
      }
      if (sifirlandi) {
        akanTurlar.current.clear();
        sonaIn(false);
        return;
      }
    }
    if (adet > 0) yeniOgeler(adet);
  }, [ogeler, akanTur, yeniOgeler, sonaIn]);

  // ------------------------------------------------ Okundu (app/TASARIM.md "Okunmamış / Okundu")

  // Bu bileşen yalnız sohbet ekranı açıkken kuruludur. Uygulama ön planda (`AppState` `active`) ve
  // liste altta iken bu sohbetin okunmamışı varsa okundu sayılır: açılışta ilk inişten sonra, altta
  // iken öğe gelince, kullanıcı alta inince, uygulama ön plana dönünce. `okundu()` değişmediyse yazmaz.
  const [onPlanda, setOnPlanda] = useState(() => AppState.currentState === "active");
  useEffect(() => {
    const a = AppState.addEventListener("change", (s) => setOnPlanda(s === "active"));
    return () => a.remove();
  }, []);
  const okunmamis = ozet?.okunmamis ?? 0;
  useEffect(() => {
    if (onPlanda && altta && okunmamis > 0) sohbet.okundu();
  }, [onPlanda, altta, okunmamis, sohbet]);

  // ------------------------------------------------ Etkinlik (tur sürerken asistan ne yapıyor)

  // Karar `baglantiDurumu.ts`'te. Sayaç yalnız süreli bir etkinlik gösterilirken ve uygulama ön
  // plandayken çalışır; tur bitince (etkinlik `null`) ya da ekran kapanınca durur.
  const etkinlikGirdisi: SohbetAltBaslikGirdisi = { akis: d.akis, eren: ozet?.eren ?? null, etkinlik: d.etkinlik };
  const gorunen = gorunenEtkinlik(etkinlikGirdisi);
  const sayacAnahtari =
    onPlanda && gorunen !== null && etkinlikSayaciGerekli(etkinlikGirdisi)
      ? `${gorunen.turn_id}|${gorunen.etkinlik}|${gorunen.baslangic_ms}`
      : null;
  const simdi = useSaniyeSaati(sayacAnahtari);
  const sohbetGirdisi: SohbetAltBaslikGirdisi = { ...etkinlikGirdisi, simdiMs: simdi };
  const etkinlikEtiketi = etkinlikEtiketiHesapla(sohbetGirdisi, ASISTAN_ADI);
  // Süren tur: akışınki; akış yokken (henüz metin gelmedi) gösterilen etkinliğinki.
  const surenTur = d.akis?.turn_id ?? gorunen?.turn_id ?? null;

  // ------------------------------------------------ İşler (6.15; bütün sohbetlerin işleri)

  const calisanIsler = cd.calisanIsler;
  const bagli = d.baglanti === "bagli";
  // Bağlıyken servisin sayısı esastır; değilken telefondaki kartlar.
  const aktifIs = bagli && cd.sunucu !== null ? cd.sunucu.aktif_is : null;
  const isSayisi = aktifIs ?? calisanIsler.length;

  const isleriAc = useCallback(() => setIslerAcik(true), []);

  const sohbetAdi = useCallback(
    (id: SohbetId): string => cd.sohbetler.find((s) => s.sohbet_id === id)?.ad ?? "Sohbet",
    [cd.sohbetler],
  );

  // Başka sohbetin işi: o sohbet seçilir (App ekranı o sohbetle yeniden kurar). Kendi işi: liste kayar.
  const iseGit = useCallback(
    (c: CalisanIs) => {
      setIslerAcik(false);
      if (c.sohbet_id !== sohbet.sohbet_id) {
        cekirdek.sec(c.sohbet_id);
        return;
      }
      const i = ogeler.findIndex((o) => o.tur === "is" && o.is_id === c.is.is_id);
      if (i < 0) return;
      sabit.current = false;
      kaydirmaDenemesi.current = 0;
      liste.current?.scrollToIndex({ index: i, viewPosition: 0.5, animated: !azHareket });
    },
    [cekirdek, sohbet, ogeler, azHareket],
  );

  // Ölçülmemiş satıra kaydırma: önce kestirilen konuma atla, sonra yeniden dene (en çok 3 kez).
  const onScrollToIndexFailed = useCallback((b: { index: number; averageItemLength: number }) => {
    if (kaydirmaDenemesi.current++ >= 3) return;
    liste.current?.scrollToOffset({ offset: b.index * b.averageItemLength, animated: false });
    setTimeout(() => liste.current?.scrollToIndex({ index: b.index, viewPosition: 0.5, animated: false }), 80);
  }, []);

  // ------------------------------------------------ Girdi (6.9)

  const yolla = async (): Promise<void> => {
    const t = metin.trim();
    if (t === "" || gonderiliyor.current) return;
    gonderiliyor.current = true;
    try {
      const s = await sohbet.mesajYolla(t, yol);
      if (s.ok) {
        setMetin("");
        setYol("yazi");
        setNot(null);
        sonaIn(!azHareket);
      } else {
        setNot(hataNotu(GONDER_RED[s.neden] ?? "Mesaj kaydedilemedi."));
      }
    } catch {
      setNot(hataNotu("Mesaj kaydedilemedi."));
    } finally {
      gonderiliyor.current = false;
    }
  };

  const dikte = async (): Promise<void> => {
    if (dikteSuruyor.current) return;
    dikteSuruyor.current = true;
    try {
      // Sürüyorsa sesli okuma, tanıyıcı açılmadan kesilir (yerel tarafın kesmesine ek güvence).
      cekirdek.sustur();
      const r = await cihaz.dikte();
      if (!r.ok) {
        setNot(hataNotu(r.neden === "desteklenmiyor" ? "Bu cihazda dikte yok." : "Dikte açılamadı."));
        return;
      }
      const alinan = "metin" in r.deger ? r.deger.metin : "";
      if (alinan !== "") {
        setMetin((onceki) => (onceki === "" ? alinan : `${onceki} ${alinan}`));
        setYol("dikte");
      }
    } catch {
      setNot(hataNotu("Dikte açılamadı."));
    } finally {
      dikteSuruyor.current = false;
    }
  };

  // "Kesiliyor" basılan tur bitene (akış biter ya da `turn_id` değişir) kadar kalır: servis kabul
  // etse de asistan durana kadar metin akmayı sürdürür. Yeniden basılabilirlik yalnız iki durumda açılır:
  // servis reddetti (istek `hatalar`'a geçti) ya da bağlantı koptu (aşağıdaki etki kaydı siler).
  // `kes()` yalnız kuyruğa yazımı bildirir, `ack`'i beklemez.
  const kesiliyor =
    kesme !== null &&
    surenTur !== null &&
    kesme.tur === surenTur &&
    d.baglanti === "bagli" &&
    !(kesme.id !== null && d.hatalar.some((h) => h.client_msg_id === kesme.id));

  useEffect(() => {
    if (d.baglanti !== "bagli") setKesme(null);
  }, [d.baglanti]);

  const turuKes = (): void => {
    const tur = surenTur;
    if (tur === null || kesiliyor) return;
    setKesme({ tur, id: null });
    // Akış varken çekirdek turu akıştan alır; yokken (yalnız etkinlik) tur açıkça verilir.
    sohbet.kes(d.akis === null ? tur : undefined).then(
      (s) => {
        if (s.ok) {
          setKesme((k) => (k !== null && k.tur === tur ? { tur, id: s.client_msg_id } : k));
          return;
        }
        setKesme(null);
        setNot(hataNotu(KES_RED[s.neden] ?? `Tur kesilemedi (${s.neden}).`));
      },
      () => {
        setKesme(null);
        setNot(hataNotu("Tur kesilemedi."));
      },
    );
  };

  // ------------------------------------------------ Yeni sohbet (6.12)

  // Başarıda çekirdek yeni sohbeti seçer; App ekranı onunla yeniden kurar (boş durum, girdi odakta).
  const yeniSohbet = useCallback((): void => {
    if (yeniAciliyor.current) return;
    yeniAciliyor.current = true;
    cekirdek.sohbetAc().then(
      (s) => {
        yeniAciliyor.current = false;
        if (s.ok) return;
        setNot(
          s.neden === "sohbet_siniri"
            ? { metin: SOHBET_AC_RED.sohbet_siniri, tur: "uyari" }
            : hataNotu(SOHBET_AC_RED[s.neden]),
        );
      },
      () => {
        yeniAciliyor.current = false;
        setNot(hataNotu("Yeni sohbet açılamadı."));
      },
    );
  }, [cekirdek]);

  // ------------------------------------------------ Üst çubuk

  const secenekler = useCallback(() => onSecenekler(sohbet.sohbet_id), [onSecenekler, sohbet]);
  const sorunUzun = useGecikmeli(d.baglanti !== "bagli", sure.seritGecikme);
  const simdiBaglan = useCallback(() => cekirdek.simdiBaglan(), [cekirdek]);
  const serit = seritHesapla(d, sorunUzun, simdiBaglan, onKurulum, secenekler);
  const baslik = ozet?.ad ?? "Sohbet";
  // 6.1, 6.12: başka bir sohbette okunmamış varsa menü simgesinde nokta (açık sohbetinki sayılmaz).
  const baskaOkunmamis = cd.sohbetler.some((s) => s.sohbet_id !== sohbet.sohbet_id && s.okunmamis > 0);
  const sag = useMemo(
    () => [
      { simge: "arti" as const, etiket: "Yeni sohbet", basinca: yeniSohbet },
      ...(ozet !== null ? [{ simge: "nokta3" as const, etiket: `${baslik} seçenekleri`, basinca: secenekler }] : []),
    ],
    [yeniSohbet, ozet, baslik, secenekler],
  );

  // ------------------------------------------------ Liste

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<GorunumOgesi>) => {
      const o = index > 0 ? ogeler[index - 1] : undefined;
      const ayrac = o !== undefined && item.ts_ms - o.ts_ms > esik.zamanAyraciDk * 60_000 ? item.ts_ms : null;
      const ust = o === undefined ? 0 : ayrac !== null ? bosluk[3] : araBosluk(tarafi(o), tarafi(item));
      return (
        <OgeSatiri
          oge={item}
          ust={ust}
          ayrac={ayrac}
          sohbet={sohbet}
          cihaz={cihaz}
          onIsler={isleriAc}
          tuketimRaporu={item.tur === "rapor" ? tuketimRaporu : null}
        />
      );
    },
    [ogeler, sohbet, cihaz, isleriAc, tuketimRaporu],
  );

  // Liste sonu: süren tur, henüz olayı gelmemiş yukarı mesajlar, gönderilemeyenler.
  const altParcalar: ReactNode[] = [];
  let sonTaraf: Taraf | null = ogeler.length > 0 ? tarafi(ogeler[ogeler.length - 1] as GorunumOgesi) : null;
  const ekle = (k: string, taraf: Taraf, dugum: ReactNode): void => {
    altParcalar.push(
      <View key={k} style={{ paddingTop: araBosluk(sonTaraf, taraf) }}>
        {dugum}
      </View>,
    );
    sonTaraf = taraf;
  };
  // Akış yokken de (tur başladı, henüz metin gelmedi) gösterilecek bir etkinlik varsa metinsiz akış
  // balonu çizilir: noktalar + "Düşünüyor" / "Komut çalıştırıyor · 8 sn" + "Turu kes".
  if (d.akis !== null || gorunen !== null) {
    ekle("akis", "asistan", (
      <AkisBalonu metin={d.akis?.metin ?? ""} kesiliyor={kesiliyor} onKes={turuKes} etkinlik={etkinlikEtiketi} />
    ));
  }
  for (const b of d.bekleyenler) {
    if (b.mesaj.type === "user_message") {
      ekle(b.client_msg_id, "kullanici", (
      <KullaniciBalonu
        metin={b.mesaj.text}
        durum={b.durum}
        kisayol={b.mesaj.input === "kisayol"}
        baglam={b.mesaj.baglam}
      />
    ));
    } else {
      ekle(b.client_msg_id, "diger", <BekleyenIstekNotu mesaj={b.mesaj} durum={b.durum} />);
    }
  }
  for (const h of d.hatalar) {
    ekle(`hata:${h.client_msg_id}`, "diger", (
      h.mesaj.type === "chat_create" ? (
        // Kurulamayan sohbetin hatası kapanınca sohbet de silinir: menü yolundaki iki adımlı onay.
        <GonderilemediSeridi hata={h} kapatYazi="Kaldır" onKapat={() => setKaldirAcik(true)} />
      ) : (
        <GonderilemediSeridi hata={h} onKapat={() => void sohbet.hataKapat(h.client_msg_id)} />
      )
    ));
  }

  // Boş durum (6.16) ve açılış (6.11). Açılış: `baslat` henüz bağlanmaya başlamadı. Sohbet listede
  // yoksa (silindi; çekirdek az sonra başka sohbete geçer) yalnız "Bu sohbet artık yok."
  const icerikYok =
    ogeler.every((o) => o.tur === "gecmis_silindi") &&
    d.akis === null &&
    gorunen === null &&
    d.bekleyenler.length === 0 &&
    d.hatalar.length === 0;
  const aciliyor = ogeler.length === 0 && d.baglanti === "kapali" && d.sonrakiDenemeMs === null && d.hata === null;
  const yukleniyorGoster = useGecikmeli(aciliyor, sure.yukleniyorGecikme);
  const alt =
    ozet === null ? (
      <SohbetYok />
    ) : icerikYok ? (
      aciliyor ? (
        yukleniyorGoster ? <Yukleniyor /> : undefined
      ) : (
        <BosDurum eslesmeYok={d.hata === "eslesme_yok"} onKurulum={onKurulum} />
      )
    ) : (
      <View>{altParcalar}</View>
    );

  // ------------------------------------------------ Çizim

  // Listede olmayan ya da PC'de kurulamamış sohbete yazılamaz (çekirdek `sohbet_bulunamadi` der).
  const yazilamaz = ozet === null || ozet.kurulum === "kurulamadi";
  const dolu = metin.trim() !== "";
  const yerTutucu =
    ozet === null
      ? "Bu sohbet artık yok"
      : ozet.kurulum === "kurulamadi"
        ? "Sohbet oluşturulamadı, yazılamaz"
        : bagli
          ? `${ASISTAN_ADI} ile konuş`
          : `${ASISTAN_ADI} ile konuş, bağlanınca gider`;

  return (
    <View style={stil.ekran}>
      <UstCubuk
        baslik={baslik}
        altBaslik={altBaslikHesapla(d, sohbetGirdisi, ASISTAN_ADI)}
        sol={{ simge: "menu", etiket: "Sohbetler", basinca: onCekmece, nokta: baskaOkunmamis }}
        isSayisi={isSayisi}
        onIsler={isleriAc}
        sag={sag}
        hat={hatHesapla(d)}
        serit={serit}
      />

      <View style={{ flex: 1 }}>
        <FlatList
          ref={liste}
          data={ozet === null ? BOS_LISTE : ogeler}
          keyExtractor={anahtar}
          renderItem={renderItem}
          ListFooterComponent={alt}
          ListFooterComponentStyle={icerikYok || ozet === null ? bosAltStili : undefined}
          contentContainerStyle={icerikStili}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={32}
          onScrollBeginDrag={() => {
            suruklemede.current = true;
            sabit.current = false;
          }}
          onScrollEndDrag={() => {
            suruklemede.current = false;
          }}
          onMomentumScrollEnd={() => {
            suruklemede.current = false;
          }}
          onContentSizeChange={onContentSizeChange}
          onLayout={onLayout}
          onScrollToIndexFailed={onScrollToIndexFailed}
          initialNumToRender={20}
          maxToRenderPerBatch={10}
          windowSize={11}
        />
        <AltaInDugmesi durum={altaInDurumu} basinca={() => sonaIn(!azHareket)} />
      </View>

      {not !== null && (
        <Text
          numberOfLines={2}
          style={[
            yazi.kucuk,
            {
              color: not.tur === "uyari" ? renk.uyari : renk.hata,
              paddingHorizontal: bosluk[4],
              paddingBottom: bosluk[1],
            },
          ]}
        >
          {not.metin}
        </Text>
      )}

      {/* Sesli okuma sürerken giriş çubuğunun üstünde tek satır; okuma çekirdek geneli, sohbete bağlı değil. */}
      {cd.seslendiriyor === true && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: bosluk[4],
            paddingRight: bosluk[2],
            gap: bosluk[2],
          }}
        >
          <Text numberOfLines={1} style={[yazi.kucuk, { flex: 1, color: renk.metinIkincil }]}>
            Sesli okunuyor
          </Text>
          <Dugme
            tur="metin"
            yazi="Sustur"
            accessibilityLabel="Sesli okumayı sustur"
            basinca={() => cekirdek.sustur()}
          />
        </View>
      )}

      <View
        style={{
          backgroundColor: renk.zemin,
          borderTopWidth: cizgi.ince,
          borderTopColor: renk.kenar,
          paddingHorizontal: bosluk[3],
          paddingVertical: bosluk[2],
          flexDirection: "row",
          alignItems: "flex-end",
          gap: bosluk[2],
        }}
      >
        <TextInput
          style={[
            yazi.govde,
            {
              flex: 1,
              minHeight: olcu.girdiEnAz,
              maxHeight: olcu.girdiEnCok,
              backgroundColor: renk.yuzey,
              borderWidth: cizgi.normal,
              borderColor: odak ? renk.vurgu : renk.kenarGuclu,
              borderRadius: yaricap.orta,
              paddingHorizontal: 14,
              paddingVertical: bosluk[3],
              color: renk.metin,
            },
          ]}
          value={metin}
          onChangeText={(t) => {
            setMetin(t);
            if (yol === "dikte") setYol("yazi");
          }}
          onFocus={() => setOdak(true)}
          onBlur={() => setOdak(false)}
          autoFocus={ilkOdak}
          editable={!yazilamaz}
          placeholder={yerTutucu}
          placeholderTextColor={renk.metinSonuk}
          cursorColor={renk.vurgu}
          selectionColor={renk.vurguSecim}
          selectionHandleColor={renk.vurgu}
          accessibilityLabel="Mesaj"
          multiline
        />
        {yazilamaz ? null : dolu ? (
          <View style={{ minWidth: olcu.eylemYuvasi }}>
            <Dugme yazi="Gönder" basinca={() => void yolla()} />
          </View>
        ) : cihaz.desteklenir ? (
          <View style={{ minWidth: olcu.eylemYuvasi }}>
            <Dugme yazi="Dikte" tur="ikincil" basinca={() => void dikte()} />
          </View>
        ) : null}
      </View>

      <CalisanIslerSayfasi
        acik={islerAcik}
        onKapat={() => setIslerAcik(false)}
        isler={calisanIsler}
        toplam={aktifIs}
        acikSohbet={sohbet.sohbet_id}
        sohbetAdi={sohbetAdi}
        onIsSec={iseGit}
        onIptal={(c) => {
          setIslerAcik(false);
          setIptalIs(c);
        }}
      />
      <SohbetiSilOnayi
        acik={kaldirAcik}
        onKapat={() => setKaldirAcik(false)}
        sohbet={sohbet}
        ad={ozet?.ad ?? ""}
        kurulamadi
        bekleyenPlan={0}
      />
      <IsIptalOnayi
        is={iptalIs?.is ?? null}
        onKapat={() => setIptalIs(null)}
        sohbet={iptalIs !== null ? cekirdek.sohbet(iptalIs.sohbet_id) : sohbet}
      />
    </View>
  );
}

const BOS_LISTE: readonly GorunumOgesi[] = [];

/** Seçili sohbet listede yok (silindi ya da yerel kaldırıldı): 6.16 boş durum düzeninde tek satır. */
function SohbetYok(): ReactNode {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: bosluk[8] - bosluk[4],
        paddingBottom: bosluk[8] * 2,
      }}
    >
      <Text style={[yazi.govde, { color: renk.metinIkincil, textAlign: "center" }]}>Bu sohbet artık yok.</Text>
    </View>
  );
}
