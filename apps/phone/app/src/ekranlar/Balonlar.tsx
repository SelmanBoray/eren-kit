// Sohbet zaman çizelgesinin parçaları: balonlar, yazıyor göstergesi, notlar, şeritler, iş satırı,
// zaman ayracı ve boş durum (TASARIM.md 6.4, 6.5, 6.6, 6.11, 6.16). Plan, rapor ve soru kartları
// kendi dosyalarındadır; burada yalnız yerleştirilir.
import { memo, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import type {
  BekleyenDurumu,
  DevirNotu,
  GidenHatasi,
  GorunumOgesi,
  IsKarti,
  IsMesaji,
  KesilenTur,
  Sohbet,
  SistemNotu as SistemOgesi,
  TuketimRaporu,
} from "../cekirdek/index.ts";
import type { ErenCihaz } from "../cihaz/erenDevice.ts";
import { ASISTAN_ADI } from "../platform/asistanAdi.ts";
import { Dugme, Duz, Serit } from "./Bilesenler.tsx";
import { Markdown } from "./Markdown.tsx";
import { PlanKartiEkrani } from "./PlanKartiEkrani.tsx";
import { RaporKartiEkrani } from "./RaporKartiEkrani.tsx";
import { SoruKartiEkrani } from "./SoruKartiEkrani.tsx";
import { bosluk, cizgi, olcu, renk, sure, yaricap, yazi } from "./tema.ts";
import { isTuketimi } from "./tuketimMetni.ts";
import type { RenkAdi } from "./tema.ts";

// ---------------------------------------------------------------- Ortak

/** `AccessibilityInfo.isReduceMotionEnabled` + `reduceMotionChanged` (TASARIM.md 7). */
export function useAzHareket(): boolean {
  const [az, setAz] = useState(false);
  useEffect(() => {
    let canli = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((d) => {
        if (canli) setAz(d);
      })
      .catch(() => {});
    const abonelik = AccessibilityInfo.addEventListener("reduceMotionChanged", setAz);
    return () => {
      canli = false;
      abonelik.remove();
    };
  }, []);
  return az;
}

// 6.4: iç boşluk dikey 10, yatay 14; gönderici tarafındaki alt köşe `yaricap.kucuk`.
const balonTemel: ViewStyle = { paddingVertical: 10, paddingHorizontal: 14, borderRadius: yaricap.buyuk };
const asistanBalonStili: ViewStyle = { ...balonTemel, backgroundColor: renk.asistanBalon, borderBottomLeftRadius: yaricap.kucuk };
const kullaniciBalonStili: ViewStyle = {
  ...balonTemel,
  backgroundColor: renk.kullaniciBalon,
  borderBottomRightRadius: yaricap.kucuk,
};
const asistanSutun: ViewStyle = { alignSelf: "flex-start", maxWidth: olcu.balonAsistan, gap: bosluk[1] };
const kullaniciSutun: ViewStyle = { alignSelf: "flex-end", maxWidth: olcu.balonKullanici, alignItems: "flex-end", gap: bosluk[1] };

/** Metni kod noktası sınırında keser (vekil çifti bölünmez); kesildiyse sonuna "…". */
export function kisalt(metin: string, enCok: number): string {
  const harfler = Array.from(metin.replace(/\s+/g, " ").trim());
  return harfler.length <= enCok ? harfler.join("") : `${harfler.slice(0, enCok).join("")}…`;
}

// ---------------------------------------------------------------- Balonlar (6.4)

const BEKLEYEN_DURUMU: Record<BekleyenDurumu, { metin: string; renk: RenkAdi }> = {
  kuyrukta: { metin: "Bağlantı bekliyor", renk: "uyari" },
  yollandi: { metin: "Gönderiliyor", renk: "metinSonuk" },
  teslim_edildi: { metin: "Teslim edildi", renk: "metinSonuk" },
};

/** Kullanıcının balonu. `durum` yalnız olayı henüz gelmemiş mesajda verilir. */
export const KullaniciBalonu = memo(function KullaniciBalonu(p: {
  metin: string;
  durum?: BekleyenDurumu;
  /** Girdi yolu kısayol mu (`input === "kisayol"`). Çip bağlam olmadan da çizilir. */
  kisayol?: boolean;
  baglam?: { paket: string; ad: string };
}): ReactNode {
  const d = p.durum !== undefined ? BEKLEYEN_DURUMU[p.durum] : null;
  return (
    <View style={kullaniciSutun}>
      {p.kisayol === true && <KisayolCipi ad={p.baglam?.ad} />}
      <View style={kullaniciBalonStili}>
        <Duz metin={p.metin} />
      </View>
      {d !== null && <Text style={[yazi.mini, { color: renk[d.renk] }]}>{d.metin}</Text>}
    </View>
  );
});

/** Kısayoldan gelen mesajın üstündeki çip. `ad` güvenilmez: tek satır, kırpılmış, düz metin (link değil). */
export function KisayolCipi(p: { ad?: string }): ReactNode {
  const ad = p.ad !== undefined ? kisalt(p.ad.replace(/[\u0000-\u001f\u007f-\u009f]/g, " "), 40) : "";
  return (
    <View
      accessible
      accessibilityLabel={ad === "" ? "Kısayoldan" : `Kısayoldan, ${ad} açıkken`}
      style={{
        alignSelf: "flex-end",
        maxWidth: "100%",
        borderRadius: yaricap.tam,
        borderWidth: cizgi.normal,
        borderColor: renk.kenar,
        paddingHorizontal: bosluk[2],
        paddingVertical: 2,
      }}
    >
      <Text numberOfLines={1} ellipsizeMode="tail" style={[yazi.mini, { color: renk.metinSonuk }]}>
        {ad === "" ? "Kısayol" : `Kısayol · ${ad}`}
      </Text>
    </View>
  );
}

/** Asistanın kalıcı yanıtı; metin markdown olarak çizilir. */
export const AsistanBalonu = memo(function AsistanBalonu(p: { metin: string }): ReactNode {
  return (
    <View style={asistanSutun}>
      <View style={asistanBalonStili}>
        <Markdown metin={p.metin} />
      </View>
    </View>
  );
});

/**
 * Süren tur. Metin yoksa balonun içinde yazıyor göstergesi; varsa balon büyür. Altında "Turu kes"
 * metin düğmesi: düğme durdurduğu şeyin yanında durur (6.4).
 */
export function AkisBalonu(p: { metin: string; kesiliyor: boolean; onKes: () => void }): ReactNode {
  const bos = p.metin === "";
  return (
    <View style={asistanSutun}>
      {bos ? (
        <YaziyorGostergesi />
      ) : (
        <View style={asistanBalonStili}>
          <Markdown metin={p.metin} />
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {!bos && <Text style={[yazi.mini, { color: renk.metinSonuk }]}>Yazıyor</Text>}
        <Dugme
          tur="metin"
          yazi={p.kesiliyor ? "Kesiliyor" : "Turu kes"}
          kapali={p.kesiliyor}
          basinca={p.onKes}
        />
      </View>
    </View>
  );
}

const NOKTA = 6;
const NOKTA_ARASI_MS = 160;

/** Döngü içinde `faz`'dan başlayan üçgen dalga: en düşük 0,3, yarım turda 1 (6.11). */
function noktaOpakligi(v: Animated.Value, faz: number): Animated.AnimatedInterpolation<number> {
  if (faz <= 0) return v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1, 0.3] });
  const bas = 0.3 + 1.4 * faz; // faz kadar geriden gelen dalganın t=0'daki değeri
  return v.interpolate({ inputRange: [0, faz, faz + 0.5, 1], outputRange: [bas, 0.3, 1, bas] });
}

/** Asistan balonu (64×38) içinde üç nokta. Az harekette duran noktalar. */
export function YaziyorGostergesi(): ReactNode {
  const az = useAzHareket();
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (az) return;
    v.setValue(0);
    const d = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: sure.nokta, easing: Easing.linear, useNativeDriver: true }),
    );
    d.start();
    return () => d.stop();
  }, [az, v]);

  return (
    <View
      accessible
      accessibilityLabel={`${ASISTAN_ADI} yazıyor`}
      accessibilityLiveRegion="polite"
      style={[
        asistanBalonStili,
        {
          width: 64,
          height: 38,
          paddingVertical: 0,
          paddingHorizontal: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: bosluk[1],
        },
      ]}
    >
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: NOKTA,
            height: NOKTA,
            borderRadius: yaricap.tam,
            backgroundColor: renk.metinIkincil,
            opacity: az ? 1 : noktaOpakligi(v, (i * NOKTA_ARASI_MS) / sure.nokta),
          }}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- Notlar (6.5)

/** Bilgi notu: ortalanmış, en çok %85, `kucuk` `metinSonuk`, zeminsiz. */
export function SistemNotu(p: { metin: string }): ReactNode {
  return (
    <Text
      selectable
      style={[yazi.kucuk, { color: renk.metinSonuk, textAlign: "center", alignSelf: "center", maxWidth: "85%" }]}
    >
      {p.metin}
    </Text>
  );
}

/** Servisin sistem notu: bilgi düz not, uyarı ve kritik satır içi şerit (6.5, 6.6). */
export function SistemNotuOgesi(p: { oge: SistemOgesi }): ReactNode {
  const o = p.oge;
  if (o.seviye === "bilgi") return <SistemNotu metin={o.metin} />;
  return <Serit tur={o.seviye === "kritik" ? "hata" : "uyari"} metin={o.metin} />;
}

export function DevirNotuOgesi(p: { oge: DevirNotu }): ReactNode {
  const { nesil, ozet_kabul } = p.oge;
  return (
    <SistemNotu
      metin={
        ozet_kabul
          ? `${ASISTAN_ADI} yeni bir oturuma geçti (nesil ${nesil}).`
          : `${ASISTAN_ADI} yeni bir oturuma özetsiz geçti (nesil ${nesil}).`
      }
    />
  );
}

/** Mezar taşı uygulanınca kalan tek satır (dilim 1, K3). */
export function GecmisSilindiNotu(): ReactNode {
  return <SistemNotu metin="Geçmiş silindi." />;
}

const KESILME: Record<KesilenTur["neden"], { bos: string; yarim: string }> = {
  kullanici_kesti: { bos: "Tur kesildi.", yarim: "Tur kesildi, yanıt yarım kaldı." },
  surec_oldu: { bos: `Tur yarım kaldı, ${ASISTAN_ADI} süreci kapandı.`, yarim: `Tur yarım kaldı, ${ASISTAN_ADI} süreci kapandı.` },
  limit_kilit: { bos: "Tur yarım kaldı, kullanım limiti doldu.", yarim: "Tur yarım kaldı, kullanım limiti doldu." },
  hata: { bos: "Tur yarım kaldı, bir hata oluştu.", yarim: "Tur yarım kaldı, bir hata oluştu." },
};

/** Kesilen tur: yarım metin varsa sönük balon + not, yoksa ortalanmış not (6.4). */
export function KesilenTurOgesi(p: { oge: KesilenTur }): ReactNode {
  const k = KESILME[p.oge.neden];
  const kismi = p.oge.kismi_metin;
  if (kismi === null || kismi.trim() === "") return <SistemNotu metin={k.bos} />;
  return (
    <View style={asistanSutun}>
      <View style={asistanBalonStili}>
        <Duz metin={kismi} renk="metinIkincil" />
      </View>
      <Text style={[yazi.mini, { color: renk.metinSonuk }]}>{k.yarim}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- Zaman ayracı (6.4)

const AY_ADLARI = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
] as const;

const ikiHane = (n: number): string => String(n).padStart(2, "0");
const gunBasi = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Bugünse "14:32", dünse "Dün 22:10", daha eskiyse "3 Kasım 09:05" (başka yıldaysa yıl eklenir). */
export function zamanAyraciMetni(ms: number, simdi: number = Date.now()): string {
  const d = new Date(ms);
  const s = new Date(simdi);
  const saat = `${ikiHane(d.getHours())}:${ikiHane(d.getMinutes())}`;
  const fark = Math.round((gunBasi(s) - gunBasi(d)) / 86_400_000);
  if (fark <= 0) return saat;
  if (fark === 1) return `Dün ${saat}`;
  const yil = d.getFullYear() !== s.getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${AY_ADLARI[d.getMonth()]}${yil} ${saat}`;
}

export function ZamanAyraci(p: { ms: number }): ReactNode {
  return (
    <Text style={[yazi.mini, { color: renk.metinSonuk, textAlign: "center", alignSelf: "center" }]}>
      {zamanAyraciMetni(p.ms)}
    </Text>
  );
}

// ---------------------------------------------------------------- İş satırı (6.5)

const IS_DURUMU: Record<IsKarti["durum"], { renk: RenkAdi; metin: (n: number) => string }> = {
  suruyor: { renk: "bilgi", metin: (n) => `İş ${n} sürüyor` },
  tamam: { renk: "basari", metin: (n) => `İş ${n} bitti` },
  hata: { renk: "hata", metin: (n) => `İş ${n} hatayla bitti` },
  yarim: { renk: "uyari", metin: (n) => `İş ${n} yarım kaldı` },
  limit_durdu: { renk: "uyari", metin: (n) => `İş ${n} limitte durdu` },
  iptal: { renk: "metinSonuk", metin: (n) => `İş ${n} iptal edildi` },
};

const PROFIL_METNI = { hafif: "hafif profil", tam: "tam profil" } as const;

/** "İş 12, PC işi" gibi; profil varsa sonuna eklenir. */
export function isTuruMetni(is: IsKarti): string {
  return is.is_turu === "pc" ? "PC işi" : "Telefon işi";
}

export function profilMetni(is: IsKarti): string | null {
  return is.profil !== undefined ? PROFIL_METNI[is.profil] : null;
}

/**
 * Sola yaslı tek satır: 8 dp nokta + `kucuk` `metinIkincil`. Süren iş dokunulabilir (Çalışan işler
 * alt sayfası); profil (`hafif`/`tam`) varsa satırın sonunda sönük etiket.
 */
export const IsSatiri = memo(function IsSatiri(p: { oge: IsKarti; basinca?: () => void }): ReactNode {
  const o = p.oge;
  const d = IS_DURUMU[o.durum];
  const profil = profilMetni(o);
  const icerik = (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: olcu.nokta,
          height: olcu.nokta,
          borderRadius: yaricap.tam,
          backgroundColor: renk[d.renk],
          marginTop: (20 - olcu.nokta) / 2,
        }}
      />
      <Text style={[yazi.kucuk, { color: renk.metinIkincil, flexShrink: 1 }]}>
        {`${d.metin(o.is_id)}: ${o.baslik}`}
        {profil !== null && <Text style={[yazi.mini, { color: renk.metinSonuk }]}>{`  ${profil}`}</Text>}
      </Text>
    </>
  );
  const satir: ViewStyle = { flexDirection: "row", alignItems: "flex-start", gap: bosluk[2], alignSelf: "flex-start" };
  if (p.basinca === undefined) return <View style={satir}>{icerik}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Çalışan işleri açar"
      onPress={p.basinca}
      hitSlop={{ top: 14, bottom: 14, left: 0, right: 0 }}
      style={({ pressed }) => [
        satir,
        { borderRadius: yaricap.kucuk, backgroundColor: pressed ? renk.basili : "transparent" },
      ]}
    >
      {icerik}
    </Pressable>
  );
});

// ---------------------------------------------------------------- Bekleyen ve gönderilemeyen (6.4, 6.6)

const MESAJ_ADI: Record<IsMesaji["type"], string> = {
  user_message: "Mesaj",
  interrupt: "Turu kesme isteği",
  plan_decision: "Plan kararı",
  question_answer: "Soru cevabı",
  job_cancel: "İş iptali",
  // Çekirdek bunu `bekleyenler`/`hatalar`'a koymaz; tip bütünlüğü için.
  chat_clear: "Geçmişi silme isteği",
  chat_create: "Sohbet oluşturma",
  chat_rename: "Yeniden adlandırma",
  // `hatalar`'da görünmez; tip bütünlüğü için.
  chat_delete: "Sohbet silme isteği",
};

/** Mesaj dışındaki bekleyen yukarı istekler için kısa not. */
export function BekleyenIstekNotu(p: { mesaj: IsMesaji; durum: BekleyenDurumu }): ReactNode {
  const ad = MESAJ_ADI[p.mesaj.type];
  const hal = p.durum === "kuyrukta" ? "bağlantı bekliyor" : p.durum === "yollandi" ? "gönderiliyor" : "teslim edildi";
  return <SistemNotu metin={`${ad} ${hal}.`} />;
}

/**
 * Gönderilemeyen yukarı mesaj: hata şeridi + "Kapat" (6.4, 6.6). Mesaj metni 80 karakterde kesilir;
 * kesildiyse metne dokununca tamamı açılır ve seçilebilir (yeniden göndermek için kopyalanır).
 */
export function GonderilemediSeridi(p: { hata: GidenHatasi; onKapat: () => void; kapatYazi?: string }): ReactNode {
  const { mesaj, kod } = p.hata;
  const [acik, setAcik] = useState(false);
  const kisa = mesaj.type === "user_message" ? kisalt(mesaj.text, 80) : null;
  const kesik = mesaj.type === "user_message" && kisa !== null && kisa !== mesaj.text.replace(/\s+/g, " ").trim();
  const yaziStili = [yazi.kucuk, { color: renk.hata, paddingVertical: bosluk[3] }];
  let govde: ReactNode;
  if (mesaj.type !== "user_message") {
    govde = (
      <Text selectable style={yaziStili}>
        {`${MESAJ_ADI[mesaj.type]} gönderilemedi (${kod}).`}
      </Text>
    );
  } else if (!kesik || acik) {
    govde = (
      <Text selectable style={yaziStili}>
        {`Gönderilemedi (${kod}): ${acik ? mesaj.text : kisa}`}
      </Text>
    );
  } else {
    govde = (
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Mesajın tamamını gösterir"
        onPress={() => setAcik(true)}
        style={({ pressed }) => ({ borderRadius: yaricap.kucuk, backgroundColor: pressed ? renk.basili : "transparent" })}
      >
        <Text style={yaziStili}>{`Gönderilemedi (${kod}): ${kisa}`}</Text>
      </Pressable>
    );
  }
  return (
    <View
      style={{
        backgroundColor: renk.hataZemin,
        borderColor: renk.hataKenar,
        borderWidth: cizgi.normal,
        borderRadius: yaricap.kucuk,
        paddingLeft: bosluk[3],
        flexDirection: "row",
        alignItems: "center",
        gap: bosluk[2],
      }}
    >
      <View style={{ flex: 1 }}>{govde}</View>
      <Dugme tur="metin" yazi={p.kapatYazi ?? "Kapat"} basinca={p.onKapat} />
    </View>
  );
}

// ---------------------------------------------------------------- Boş durum ve yükleniyor (6.11, 6.16)

/** Yeni ya da geçmişi silinmiş sohbet; eşleşme yoksa kuruluma yönlendirir. */
export function BosDurum(p: { eslesmeYok: boolean; onKurulum?: () => void }): ReactNode {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: bosluk[8] - bosluk[4], // liste zaten 16 içeride; toplam 32
        paddingBottom: bosluk[8] * 2, // dikey ortanın biraz üstü
        gap: bosluk[2],
      }}
    >
      {p.eslesmeYok ? (
        <>
          <Text style={[yazi.govde, { color: renk.metinIkincil, textAlign: "center" }]}>PC ile eşleşme yok.</Text>
          {p.onKurulum !== undefined && <Dugme yazi="Kuruluma git" basinca={p.onKurulum} />}
        </>
      ) : (
        <>
          <Text style={[yazi.govde, { color: renk.metinIkincil, textAlign: "center" }]}>{`${ASISTAN_ADI} ile konuş.`}</Text>
          <Text style={[yazi.kucuk, { color: renk.metinSonuk, textAlign: "center" }]}>
            {`Mesajın PC'deki ${ASISTAN_ADI} oturumuna gider. Bağlantı yoksa telefonda bekler, bağlanınca gönderilir.`}
          </Text>
        </>
      )}
    </View>
  );
}

export function Yukleniyor(): ReactNode {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: bosluk[2] }}>
      <ActivityIndicator color={renk.metinSonuk} />
      <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>Yükleniyor</Text>
    </View>
  );
}

// ---------------------------------------------------------------- Zaman çizelgesi öğesi

export type ZamanCizelgesiOgesiProps = {
  oge: GorunumOgesi;
  sohbet: Sohbet;
  cihaz: ErenCihaz;
  onIsler: () => void;
  /** İsteğe bağlı: eldeki tüketim raporu; rapor kartı kendi işinin satırını buradan alır. */
  tuketimRaporu?: TuketimRaporu | null;
};

/**
 * `memo` karşılaştırması için: rapor nesnesi her güncellemede yeni kurulur, bu yüzden yalnız rapor
 * kartı öğesinde ve yalnız o işin tüketim DEĞERLERİNE bakılır; başka öğelerde rapor yok sayılır.
 */
export function tuketimPropEsit(
  a: { oge: GorunumOgesi; tuketimRaporu?: TuketimRaporu | null },
  b: { oge: GorunumOgesi; tuketimRaporu?: TuketimRaporu | null },
): boolean {
  if (a.oge.tur !== "rapor") return true;
  if (a.tuketimRaporu === b.tuketimRaporu) return true;
  const x = isTuketimi(a.tuketimRaporu ?? null, a.oge.is_id);
  const y = isTuketimi(b.tuketimRaporu ?? null, a.oge.is_id);
  if (x === y) return true;
  if (x === null || y === null) return false;
  return (
    x.girdi === y.girdi &&
    x.cache_yazma === y.cache_yazma &&
    x.cache_okuma === y.cache_okuma &&
    x.cikti === y.cikti &&
    x.sonuc_adet === y.sonuc_adet &&
    x.maliyet_usd === y.maliyet_usd
  );
}

/** Bir `GorunumOgesi`'ni türüne göre çizer. `onIsler`: süren iş satırına dokununca. */
export const ZamanCizelgesiOgesi = memo(function ZamanCizelgesiOgesi(p: ZamanCizelgesiOgesiProps): ReactNode {
  const o = p.oge;
  switch (o.tur) {
    case "kullanici":
      return <KullaniciBalonu metin={o.metin} kisayol={o.input === "kisayol"} baglam={o.baglam} />;
    case "asistan":
      return <AsistanBalonu metin={o.metin} />;
    case "tur_kesildi":
      return <KesilenTurOgesi oge={o} />;
    case "plan":
      return <PlanKartiEkrani kart={o} sohbet={p.sohbet} cihaz={p.cihaz} />;
    case "plan_gizlendi":
      return <Serit tur="hata" metin="Bir plan doğrulanamadığı için gizlendi. Karar verilemez." />;
    case "is":
      return <IsSatiri oge={o} basinca={o.durum === "suruyor" ? p.onIsler : undefined} />;
    case "rapor":
      return <RaporKartiEkrani kart={o} tuketim={isTuketimi(p.tuketimRaporu ?? null, o.is_id)} />;
    case "soru":
      return <SoruKartiEkrani kart={o} sohbet={p.sohbet} />;
    case "devir":
      return <DevirNotuOgesi oge={o} />;
    case "sistem":
      return <SistemNotuOgesi oge={o} />;
    case "gecmis_silindi":
      return <GecmisSilindiNotu />;
  }
}, ogePropEsit);

/** `ZamanCizelgesiOgesi`/`OgeSatiri` için ortak `memo` karşılaştırması (rapor yalnız değerce, yalnız rapor kartında). */
export function ogePropEsit(a: ZamanCizelgesiOgesiProps, b: ZamanCizelgesiOgesiProps): boolean {
  return (
    a.oge === b.oge &&
    a.sohbet === b.sohbet &&
    a.cihaz === b.cihaz &&
    a.onIsler === b.onIsler &&
    tuketimPropEsit(a, b)
  );
}
