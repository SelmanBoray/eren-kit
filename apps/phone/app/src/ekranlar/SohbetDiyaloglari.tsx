// Sohbet katmanları: eylem menüsü (6.13), ad diyaloğu, "Geçmişi sil" ve "Sohbeti sil" onayları (6.14),
// bunları birleştiren SohbetYonetimi, çalışan işler alt sayfası (6.15) ve iş iptal onayı (6.14).
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SOHBET_SINIRLARI } from "@eren/protocol";
import { adHazirla } from "../cekirdek/index.ts";
import type {
  AdlandirSonucu,
  CalisanIs,
  Cekirdek,
  GecmisSilSonucu,
  GonderRedNedeni,
  IsKarti,
  Sohbet,
  SohbetId,
  SohbetSilSonucu,
} from "../cekirdek/index.ts";
import { ASISTAN_ADI } from "../platform/asistanAdi.ts";
import { AltSayfa, AltSayfaSatiri } from "./AltSayfa.tsx";
import { isTuruMetni, profilMetni } from "./Balonlar.tsx";
import { Dugme } from "./Bilesenler.tsx";
import { Diyalog } from "./Diyalog.tsx";
import { useSohbetDurumu } from "./baglam.ts";
import { EK_BEKLIYOR_METNI } from "./medyaMetni.ts";
import { bosluk, cizgi, olcu, renk, yaricap, yazi } from "./tema.ts";

/** Bileşen söküldükten sonra gelen sözün sonucu durum yazmasın. */
function useCanli(): { readonly current: boolean } {
  const canli = useRef(true);
  useEffect(() => {
    canli.current = true;
    return () => {
      canli.current = false;
    };
  }, []);
  return canli;
}

// ---------------------------------------------------------------- Eylem menüsü (6.13)

/**
 * Sohbetin eylem menüsü (adım 1). Her `...Engeli` doluysa satır kapalıdır ve neden açıklamada yazar.
 * `kurulamadi`: "Sohbeti sil" yerine "Sohbeti kaldır" (yalnız telefondan kalkar).
 */
export function EylemMenusu(p: {
  acik: boolean;
  onKapat: () => void;
  baslik: string;
  adlandirEngeli: string | null;
  gecmisSilEngeli: string | null;
  sohbetSilEngeli: string | null;
  kurulamadi: boolean;
  onAdlandir: () => void;
  onGecmisiSil: () => void;
  onSohbetiSil: () => void;
}): ReactNode {
  return (
    <AltSayfa acik={p.acik} onKapat={p.onKapat} baslik={p.baslik}>
      <AltSayfaSatiri
        yazi="Yeniden adlandır"
        kapali={p.adlandirEngeli !== null}
        aciklama={p.adlandirEngeli ?? undefined}
        basinca={p.onAdlandir}
      />
      <AltSayfaSatiri
        yazi="Geçmişi sil"
        tehlikeli
        kapali={p.gecmisSilEngeli !== null}
        aciklama={p.gecmisSilEngeli ?? "Telefondan ve bilgisayardan silinir."}
        basinca={p.onGecmisiSil}
      />
      <AltSayfaSatiri
        yazi={p.kurulamadi ? "Sohbeti kaldır" : "Sohbeti sil"}
        tehlikeli
        kapali={p.sohbetSilEngeli !== null}
        aciklama={
          p.sohbetSilEngeli ??
          (p.kurulamadi
            ? "PC'de oluşturulamadı, yalnız bu telefondan kalkar."
            : "Sohbet ve bütün mesajları silinir.")
        }
        basinca={p.onSohbetiSil}
      />
    </AltSayfa>
  );
}

// ---------------------------------------------------------------- Ad diyaloğu (6.14)

const AD_RED: Record<Extract<AdlandirSonucu, { ok: false }>["neden"], string> = {
  baslamadi: "Uygulama henüz hazır değil, biraz sonra yeniden dene.",
  gecersiz: "Bu ad kullanılamaz: satır sonu ya da görünmez karakter içermemeli.",
  depo_hatasi: "Kaydedilemedi: telefonda kayıt hatası.",
  sohbet_bulunamadi: "Bu sohbet artık yok.",
};

/**
 * "Sohbeti yeniden adlandır". Girdi tek satır, en çok `SOHBET_ADI` birim; "Kaydet" `adHazirla(metin)`
 * `null` ya da geçerli adla aynıysa kapalı. `ok` gelince kapanır; ret diyalogda hata satırı olur.
 */
export function AdDiyalogu(p: {
  acik: boolean;
  onKapat: () => void;
  sohbet: Sohbet;
  mevcutAd: string;
}): ReactNode {
  const { acik, onKapat, sohbet, mevcutAd } = p;
  const canli = useCanli();
  const [metin, setMetin] = useState(mevcutAd);
  const [odak, setOdak] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  // Her açılış mevcut adla ve temiz başlar.
  useEffect(() => {
    if (acik) {
      setMetin(mevcutAd);
      setHata(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);

  const hazir = adHazirla(metin);
  const doluAmaGecersiz = hazir === null && metin.trim() !== "";
  const kapali = hazir === null || hazir === mevcutAd;

  const kaydet = async (): Promise<void> => {
    if (mesgul || hazir === null || hazir === mevcutAd) return;
    setMesgul(true);
    setHata(null);
    let s: AdlandirSonucu | null;
    try {
      s = await sohbet.adlandir(metin);
    } catch {
      s = null;
    }
    if (!canli.current) return;
    setMesgul(false);
    if (s !== null && s.ok) {
      onKapat();
      return;
    }
    setHata(s === null ? "Kaydedilemedi: beklenmeyen bir hata oluştu." : AD_RED[s.neden]);
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Sohbeti yeniden adlandır"
      onayMetni="Kaydet"
      onayKapali={kapali}
      mesgul={mesgul ? "Kaydediliyor" : undefined}
      hataMetni={
        hata ??
        (doluAmaGecersiz ? "Bu ad kullanılamaz: satır sonu ya da görünmez karakter içermemeli." : undefined)
      }
      onOnay={() => void kaydet()}
      onIptal={() => {
        if (!mesgul) onKapat();
      }}
    >
      <TextInput
        accessibilityLabel="Sohbet adı"
        autoFocus
        selectTextOnFocus
        maxLength={SOHBET_SINIRLARI.SOHBET_ADI}
        multiline={false}
        returnKeyType="done"
        value={metin}
        editable={!mesgul}
        onChangeText={(t) => {
          setMetin(t);
          setHata(null);
        }}
        onSubmitEditing={() => void kaydet()}
        onFocus={() => setOdak(true)}
        onBlur={() => setOdak(false)}
        placeholder="Yeni sohbet"
        placeholderTextColor={renk.metinSonuk}
        cursorColor={renk.vurgu}
        selectionColor={renk.vurgu}
        style={[
          yazi.govde,
          {
            minHeight: olcu.girdiEnAz,
            backgroundColor: renk.yuzey,
            borderWidth: cizgi.normal,
            borderColor: odak ? renk.vurgu : renk.kenarGuclu,
            borderRadius: yaricap.orta,
            paddingHorizontal: 14,
            paddingVertical: bosluk[3],
            color: renk.metin,
          },
        ]}
      />
    </Diyalog>
  );
}

// ---------------------------------------------------------------- Silme hata metinleri

type SilKapsami = "Geçmiş" | "Sohbet";

function silHataGovdesi(s: GecmisSilSonucu | null, kapsam: SilKapsami): string {
  const fiil = kapsam === "Geçmiş" ? "Geçmiş silme" : "Sohbet silme";
  const ad = kapsam === "Geçmiş" ? "Geçmiş" : "Sohbet";
  if (s === null) return "Silinemedi: beklenmeyen bir hata oluştu.";
  if (s.ok) return "";
  switch (s.kod) {
    case "sohbet_mesgul":
      return `Önce bu sohbette çalışan işin bitmesini, bekleyen sorunun cevaplanmasını ya da ${ASISTAN_ADI} yanıtının bitmesini bekle.`;
    case "sohbet_silinemez":
      return "Ana sohbet silinemez, yalnız geçmişi silinebilir.";
    case "sohbet_bulunamadi":
      return "Bu sohbet zaten yok.";
    case "bagli_degil":
      return `Bağlantı yok. ${ad} yalnız bağlıyken silinir; bağlanınca yeniden dene.`;
    case "baglanti_koptu":
      return `Bağlantı koptu, silinip silinmediği bilinmiyor. Silindiyse bağlanınca burada görünür; görünmezse yeniden dene.`;
    case "zaman_asimi":
      return `Cevap gelmedi, bağlantı yenileniyor. ${fiil} yapıldıysa ekran birazdan güncellenir.`;
    case "zaten_yollandi":
      return "Bir silme isteği zaten gönderildi, cevabı bekleniyor.";
    case "depo_hatasi":
      return "Silinemedi: telefonda kayıt hatası.";
    case "baslamadi":
      return "Uygulama henüz hazır değil, biraz sonra yeniden dene.";
    case "ek_bekliyor":
      return EK_BEKLIYOR_METNI;
    default:
      return `Silinemedi (${s.kod}).`;
  }
}

/** `null`: söz attı (çekirdek uygulanmamış ya da beklenmeyen hata). */
export function gecmisSilHataMetni(s: GecmisSilSonucu | null): string {
  return silHataGovdesi(s, "Geçmiş");
}

/** `gecmisSilHataMetni` ile aynı anlam, "silme" yerine "sohbet silme". */
export function sohbetSilHataMetni(s: SohbetSilSonucu | null): string {
  return silHataGovdesi(s, "Sohbet");
}

// ---------------------------------------------------------------- Geçmişi sil onayı (6.14, K3)

const SILINMEYENLER =
  `Silinmeyenler: iş kayıtları ve klasörleri, iş oturumlarının dökümleri, ${ASISTAN_ADI} oturumunun yazdığı dosyalar, ` +
  "Telegram notları ve telefondaki denetim günlüğü. Geri alınamaz.";

/** K3: silmenin gerçekte neyi sildiğini ve neyin kaldığını söyler; başta sohbet adı. */
export function gecmisiSilGovde(ad: string): string {
  return `"${ad}" sohbetinin geçmişi telefondan ve bilgisayardan silinir, ${ASISTAN_ADI} konuşmayı unutur. ${SILINMEYENLER}`;
}

/** İki adımlı silmenin ikinci adımı gövdesi (sohbetin kendisi silinir). */
export function sohbetiSilGovde(ad: string): string {
  return (
    `"${ad}" sohbeti ve içindeki bütün mesajlar telefondan ve bilgisayardan silinir; bu sohbetteki ${ASISTAN_ADI} ` +
    `oturumu kapanır ve konuşmayı unutur. ${SILINMEYENLER}`
  );
}

function kaldirGovde(ad: string): string {
  return `"${ad}" PC'de oluşturulamadı; yalnız bu telefondan kalkar, gönderilmeyi bekleyen mesajları da silinir.`;
}

type SilOnayiOrtak = {
  acik: boolean;
  onKapat: () => void;
  sohbet: Sohbet;
  ad: string;
  /** Onay bekleyen plan sayısı: servis bunları kendiliğinden iptal eder. */
  bekleyenPlan: number;
};

type OnayKurgusu = {
  baslik: string;
  govde: string;
  onayMetni: string;
  uyari: boolean;
  eylem: () => Promise<GecmisSilSonucu>;
  hataMetni: (s: GecmisSilSonucu | null) => string;
};

/**
 * Ortak onay diyaloğu: beklerken kapanmaz (sonucu burada görünmeli), `ok` gelince kapanır, hata
 * (`sohbet_mesgul` dahil) diyalogda kalır.
 */
function SilOnayi(p: { acik: boolean; onKapat: () => void; bekleyenPlan: number; kurgu: OnayKurgusu }): ReactNode {
  const { acik, onKapat, bekleyenPlan, kurgu } = p;
  const canli = useCanli();
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  // Her açılış temiz başlar.
  useEffect(() => {
    if (acik) setHata(null);
  }, [acik]);

  const sil = async (): Promise<void> => {
    if (mesgul) return;
    setMesgul(true);
    setHata(null);
    let s: GecmisSilSonucu | null;
    try {
      s = await kurgu.eylem();
    } catch {
      s = null;
    }
    if (!canli.current) return;
    setMesgul(false);
    if (s !== null && s.ok) {
      onKapat();
      return;
    }
    setHata(kurgu.hataMetni(s));
  };

  return (
    <Diyalog
      acik={acik}
      baslik={kurgu.baslik}
      govde={kurgu.govde}
      onayMetni={kurgu.onayMetni}
      tehlikeli
      mesgul={mesgul ? "Siliniyor" : undefined}
      uyariMetni={kurgu.uyari && bekleyenPlan > 0 ? `Onay bekleyen ${bekleyenPlan} iş iptal edilir.` : undefined}
      hataMetni={hata ?? undefined}
      onOnay={() => void sil()}
      onIptal={() => {
        if (!mesgul) onKapat();
      }}
    />
  );
}

/** Onaylanınca `sohbet.gecmisiSil()`; görünüm `chat_cleared` olayıyla kendiliğinden değişir. */
export function GecmisiSilOnayi(p: SilOnayiOrtak): ReactNode {
  const { sohbet, ad } = p;
  return (
    <SilOnayi
      acik={p.acik}
      onKapat={p.onKapat}
      bekleyenPlan={p.bekleyenPlan}
      kurgu={{
        baslik: "Geçmiş silinsin mi?",
        govde: gecmisiSilGovde(ad),
        onayMetni: "Geçmişi sil",
        uyari: true,
        eylem: () => sohbet.gecmisiSil(),
        hataMetni: gecmisSilHataMetni,
      }}
    />
  );
}

/**
 * İki adımlı silmenin ikinci adımı. `kurulamadi`: "Sohbet kaldırılsın mı?" (yalnız yerel). Başarıda
 * toast yok: sohbet listeden kalkar, seçiliyse çekirdek başka sohbete geçer.
 */
export function SohbetiSilOnayi(p: SilOnayiOrtak & { kurulamadi: boolean }): ReactNode {
  const { sohbet, ad, kurulamadi } = p;
  return (
    <SilOnayi
      acik={p.acik}
      onKapat={p.onKapat}
      bekleyenPlan={p.bekleyenPlan}
      kurgu={{
        baslik: kurulamadi ? "Sohbet kaldırılsın mı?" : "Sohbet silinsin mi?",
        govde: kurulamadi ? kaldirGovde(ad) : sohbetiSilGovde(ad),
        onayMetni: kurulamadi ? "Kaldır" : "Sohbeti sil",
        uyari: !kurulamadi,
        eylem: () => sohbet.sil(),
        hataMetni: sohbetSilHataMetni,
      }}
    />
  );
}

// ---------------------------------------------------------------- Sohbet yönetimi (menü + diyaloglar)

type Asama = "menu" | "ad" | "gecmis" | "sil";

function YonetimIci(p: { cekirdek: Cekirdek; id: SohbetId; acik: boolean; onKapat: () => void }): ReactNode {
  const { cekirdek, id, acik, onKapat } = p;
  const sohbet = cekirdek.sohbet(id);
  const d = useSohbetDurumu(sohbet);
  const ozet = d.ozet;
  const [asama, setAsama] = useState<Asama | null>(null);
  const asamaRef = useRef<Asama | null>(null);
  const goruldu = useRef(false);
  const sonAd = useRef("");
  if (ozet !== null) {
    goruldu.current = true;
    sonAd.current = ozet.ad;
  }

  const asamaYaz = (a: Asama | null): void => {
    asamaRef.current = a;
    setAsama(a);
  };

  // Açılınca menü; kapanınca her şey kapalı.
  useEffect(() => {
    asamaYaz(acik ? "menu" : null);
  }, [acik]);

  // Özet listeden kalktıysa (silindi) her şey kapanır.
  useEffect(() => {
    if (acik && ozet === null && goruldu.current) {
      asamaYaz(null);
      onKapat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik, ozet]);

  // Çifte kapanışa karşı: yalnız açık bir aşama varken ilet.
  const kapat = (): void => {
    if (asamaRef.current === null) return;
    asamaYaz(null);
    onKapat();
  };

  const ad = ozet?.ad ?? sonAd.current;
  const kurulamadi = ozet?.kurulum === "kurulamadi";
  const bekliyor = ozet?.kurulum === "bekliyor";
  const bagli = d.baglanti === "bagli";
  const ana = ozet?.ana === true;

  let adlandirEngeli: string | null = null;
  let gecmisSilEngeli: string | null = null;
  let sohbetSilEngeli: string | null = null;
  if (kurulamadi) {
    adlandirEngeli = "PC'de oluşturulamadı, yalnız bu telefondan kalkar.";
    gecmisSilEngeli = "PC'de oluşturulamadı, yalnız bu telefondan kalkar.";
  } else if (bekliyor) {
    gecmisSilEngeli = "Sohbet henüz PC'ye ulaşmadı.";
    sohbetSilEngeli = "Sohbet henüz PC'ye ulaşmadı.";
  } else if (!bagli) {
    gecmisSilEngeli = "Bağlantı yok. Yalnız bağlıyken silinir.";
    sohbetSilEngeli = "Bağlantı yok. Yalnız bağlıyken silinir.";
  }
  if (ana) sohbetSilEngeli = "Ana sohbet silinemez, yalnız geçmişi silinebilir.";

  const bekleyenPlan = d.ogeler.reduce((n, o) => (o.tur === "plan" && o.durum === "bekliyor" ? n + 1 : n), 0);

  return (
    <>
      <EylemMenusu
        acik={acik && asama === "menu"}
        onKapat={kapat}
        baslik={ad}
        adlandirEngeli={adlandirEngeli}
        gecmisSilEngeli={gecmisSilEngeli}
        sohbetSilEngeli={sohbetSilEngeli}
        kurulamadi={kurulamadi}
        onAdlandir={() => asamaYaz("ad")}
        onGecmisiSil={() => asamaYaz("gecmis")}
        onSohbetiSil={() => asamaYaz("sil")}
      />
      <AdDiyalogu acik={acik && asama === "ad"} onKapat={kapat} sohbet={sohbet} mevcutAd={ad} />
      <GecmisiSilOnayi
        acik={acik && asama === "gecmis"}
        onKapat={kapat}
        sohbet={sohbet}
        ad={ad}
        bekleyenPlan={bekleyenPlan}
      />
      <SohbetiSilOnayi
        acik={acik && asama === "sil"}
        onKapat={kapat}
        sohbet={sohbet}
        ad={ad}
        kurulamadi={kurulamadi}
        bekleyenPlan={bekleyenPlan}
      />
    </>
  );
}

/**
 * `hedef` dolunca eylem menüsü açılır; satır seçilince menü kapanır, ilgili diyalog açılır; her şey
 * kapanınca `onKapat` (çağıran `hedef`'i boşaltır). `hedef`'in özeti listeden kalkarsa kapanır.
 */
export function SohbetYonetimi(p: { cekirdek: Cekirdek; hedef: SohbetId | null; onKapat: () => void }): ReactNode {
  const son = useRef<SohbetId | null>(null);
  if (p.hedef !== null) son.current = p.hedef;
  const id = p.hedef ?? son.current;
  if (id === null) return null;
  return <YonetimIci key={id} cekirdek={p.cekirdek} id={id} acik={p.hedef !== null} onKapat={p.onKapat} />;
}

// ---------------------------------------------------------------- Çalışan işler (6.15)

/** 1 dakikadan azsa "az önce", sonra "8 dk", 60 dk'dan sonra "1 sa 12 dk". */
export function gecenSureMetni(baslangicMs: number, simdiMs: number): string {
  const dk = Math.floor(Math.max(0, simdiMs - baslangicMs) / 60_000);
  if (dk < 1) return "az önce";
  if (dk < 60) return `${dk} dk`;
  const sa = Math.floor(dk / 60);
  const kalan = dk % 60;
  return kalan === 0 ? `${sa} sa` : `${sa} sa ${kalan} dk`;
}

function IsSatirSayfada(p: {
  is: IsKarti;
  simdi: number;
  /** Başka sohbetin işinde sohbet adı; kendi sohbetinde `null`. */
  sohbetAdi: string | null;
  onSec: () => void;
  onIptal: () => void;
}): ReactNode {
  const { is } = p;
  const profil = profilMetni(is);
  const alt = [
    `İş ${is.is_id}`,
    isTuruMetni(is),
    gecenSureMetni(is.ts_ms, p.simdi),
    ...(profil !== null ? [profil] : []),
    ...(p.sohbetAdi !== null ? [p.sohbetAdi] : []),
  ];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Sohbette bu işin satırına gider"
      onPress={p.onSec}
      style={({ pressed }) => ({
        minHeight: 64,
        paddingLeft: bosluk[4],
        paddingRight: bosluk[1],
        paddingVertical: bosluk[2],
        flexDirection: "row",
        alignItems: "center",
        gap: bosluk[2],
        backgroundColor: pressed ? renk.basili : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={[yazi.govde, { color: renk.metin }]}>
          {is.baslik}
        </Text>
        <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>{alt.join(", ")}</Text>
      </View>
      <Dugme tur="tehlikeliMetin" yazi="İptal et" accessibilityLabel={`İş ${is.is_id} iptal et`} basinca={p.onIptal} />
    </Pressable>
  );
}

/**
 * Süren işler (`IsKarti`, `durum === "suruyor"`). `toplam` servisin `aktif_is` sayısıdır; listede
 * görünenden fazlaysa fark ayrıca yazılır (TASARIM.md 13: hap sayısı ile liste uyuşmayabilir).
 */
export function CalisanIslerSayfasi(p: {
  acik: boolean;
  onKapat: () => void;
  isler: readonly CalisanIs[];
  toplam: number | null;
  acikSohbet: SohbetId;
  sohbetAdi: (id: SohbetId) => string;
  onIsSec: (c: CalisanIs) => void;
  onIptal: (c: CalisanIs) => void;
}): ReactNode {
  const { acik, isler } = p;
  const [simdi, setSimdi] = useState(() => Date.now());

  // Açıkken süreler yarım dakikada bir tazelenir.
  useEffect(() => {
    if (!acik) return;
    setSimdi(Date.now());
    const t = setInterval(() => setSimdi(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [acik]);

  const fark = p.toplam !== null ? p.toplam - isler.length : 0;

  return (
    <AltSayfa acik={acik} onKapat={p.onKapat}>
      <Text
        accessibilityRole="header"
        style={[yazi.baslik, { color: renk.metin, paddingHorizontal: bosluk[4], paddingTop: bosluk[4], paddingBottom: bosluk[2] }]}
      >
        Çalışan işler
      </Text>
      {isler.length === 0 && fark <= 0 && (
        <Text style={[yazi.kucuk, { color: renk.metinSonuk, paddingHorizontal: bosluk[4], paddingVertical: bosluk[3] }]}>
          Çalışan iş yok.
        </Text>
      )}
      {isler.map((c) => (
        <IsSatirSayfada
          key={`${c.sohbet_id}:${c.is.is_id}`}
          is={c.is}
          simdi={simdi}
          sohbetAdi={c.sohbet_id !== p.acikSohbet ? p.sohbetAdi(c.sohbet_id) : null}
          onSec={() => p.onIsSec(c)}
          onIptal={() => p.onIptal(c)}
        />
      ))}
      {fark > 0 && (
        <Text style={[yazi.kucuk, { color: renk.metinSonuk, paddingHorizontal: bosluk[4], paddingVertical: bosluk[3] }]}>
          {`Bilgisayarda ${fark} iş daha çalışıyor; bu telefonda kaydı yok.`}
        </Text>
      )}
    </AltSayfa>
  );
}

// ---------------------------------------------------------------- İş iptal onayı (6.14)

const IPTAL_RED: Partial<Record<GonderRedNedeni, string>> = {
  is_bitti: "İş zaten bitmiş.",
  is_yok: "İş bulunamadı.",
  zaten_yollandi: "İptal isteği zaten gönderildi.",
  depo_hatasi: "İptal edilemedi: telefonda kayıt hatası.",
  baslamadi: "Uygulama henüz hazır değil, biraz sonra yeniden dene.",
};

/** `is` doluyken açık. İstek kuyruğa girer: bağlantı yoksa bağlanınca gider. */
export function IsIptalOnayi(p: { is: IsKarti | null; onKapat: () => void; sohbet: Sohbet }): ReactNode {
  const { is, onKapat, sohbet } = p;
  const canli = useCanli();
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  // Kapanırken başlık "İş undefined" olmasın diye son iş tutulur.
  const son = useRef<IsKarti | null>(is);
  if (is !== null) son.current = is;
  const gosterilen = son.current;

  useEffect(() => {
    if (is !== null) setHata(null);
  }, [is]);

  const iptal = async (): Promise<void> => {
    if (is === null || mesgul) return;
    setMesgul(true);
    setHata(null);
    try {
      const s = await sohbet.isIptal(is.is_id);
      if (!canli.current) return;
      if (s.ok) {
        onKapat();
        return;
      }
      setHata(IPTAL_RED[s.neden] ?? `İptal edilemedi (${s.neden}).`);
    } catch {
      if (canli.current) setHata("İptal edilemedi: beklenmeyen bir hata oluştu.");
    } finally {
      if (canli.current) setMesgul(false);
    }
  };

  return (
    <Diyalog
      acik={is !== null}
      baslik={gosterilen !== null ? `İş ${gosterilen.is_id} iptal edilsin mi?` : "İş iptal edilsin mi?"}
      govde={`${ASISTAN_ADI} işi durdurur. O ana kadar yapılanlar geri alınmaz.`}
      onayMetni="İşi iptal et"
      tehlikeli
      mesgul={mesgul ? "Gönderiliyor" : undefined}
      hataMetni={hata ?? undefined}
      onOnay={() => void iptal()}
      onIptal={() => {
        if (!mesgul) onKapat();
      }}
    />
  );
}
