// Çekmece: sohbet listesi (docs/TASARIM.md 6.12, app/TASARIM.md "Dilim 2 / Ekran akışları / Çekmece").
// Soldan kayar; perde, geri tuşu ve satır seçme kapatır. Satırın `nokta3`'ü ve uzun basma eylem menüsünü
// (App'teki `SohbetYonetimi`) açar; çekmece o sırada açık kalır, menü ve diyaloglar kendi `Modal`'larıyla
// üstte açılıp kapanır (geri tuşu önce onları kapatır).
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { CekirdekDurumu, SohbetOzeti } from "../cekirdek/index.ts";
import { ASISTAN_ADI } from "../platform/asistanAdi.ts";
import { Simge } from "./Ikonlar";
import { bosluk, cizgi, esik, olcu, renk, sure, yaricap, yazi } from "./tema";
import type { RenkAdi } from "./tema";

export type CekmeceSohbet = {
  id: string;
  ad: string;
  onizleme?: string | null;
  /** Önizleme rengi; yoksa `metinSonuk`. */
  onizlemeRenk?: RenkAdi;
  zaman_ms?: number | null;
  okunmamis?: number;
  secili: boolean;
};

export type CekmeceProps = {
  acik: boolean;
  onKapat: () => void;
  sohbetler: readonly CekmeceSohbet[];
  /** Satıra dokunuş. Çekmece önce kendini kapatır (`onKapat`), sonra bunu çağırır. */
  onSohbetSec: (id: string) => void;
  /** Satırın `nokta3`'ü ya da uzun basma: eylem menüsü. Çekmece kapanmaz; menü üstte açılır. */
  onSecenekler: (id: string) => void;
  /**
   * "Yeni sohbet". Çekmece kendini kapatmaz: çağıran `sohbetAc()` başarılıysa kapatır, `sohbet_siniri`nde
   * `yeniSohbetNotu` verir. Söz dönerse çözülene kadar düğme kapalıdır (çift dokunuş iki sohbet açmasın).
   */
  onYeniSohbet?: (() => void | Promise<unknown>) | null;
  /** "Yeni sohbet" düğmesinin altında `kucuk` `uyari` satır (ör. "En çok 8 sohbet açılabilir. Birini sil."). */
  yeniSohbetNotu?: string | null;
  onDurum: () => void;
  onKurulum: () => void;
  altBilgi?: { metin: string; renk?: RenkAdi } | null;
};

/** Son mesaj önizlemesinin en çok uzunluğu (UTF-16 birimi). */
const ONIZLEME_UZUNLUGU = 120;

function onizlemeKirp(metin: string): string {
  const tek = metin.replace(/\s+/g, " ").trim();
  if (tek.length <= ONIZLEME_UZUNLUGU) return tek;
  let k = tek.slice(0, ONIZLEME_UZUNLUGU);
  const son = k.charCodeAt(k.length - 1);
  if (son >= 0xd800 && son <= 0xdbff) k = k.slice(0, -1); // yarım vekil çift kalmasın
  return k;
}

/** app/TASARIM.md "Ekran akışları / Çekmece" önizleme önceliği. */
function onizlemeKur(o: SohbetOzeti): { onizleme: string | null; onizlemeRenk?: RenkAdi } {
  if (o.kurulum === "kurulamadi") return { onizleme: "Oluşturulamadı", onizlemeRenk: "hata" };
  if (o.yaziyor) return { onizleme: `${ASISTAN_ADI} yazıyor`, onizlemeRenk: "bilgi" };
  if (o.calisanIs > 0) return { onizleme: `${o.calisanIs} iş sürüyor`, onizlemeRenk: "bilgi" };
  if (o.kurulum === "bekliyor") return { onizleme: "Bağlanınca oluşturulacak" };
  if (o.sonMesaj !== null) {
    const m = onizlemeKirp(o.sonMesaj.metin);
    if (m !== "") return { onizleme: o.sonMesaj.kim === "kullanici" ? `Sen: ${m}` : m };
  }
  return { onizleme: null };
}

// Özet nesnesi değişmedikçe aynı satır nesnesi (index özetin kimliğini korur); satırlar yeniden çizilmesin.
const satirOnbellegi = new WeakMap<SohbetOzeti, { secili: boolean; satir: CekmeceSohbet }>();

/** Çekirdek durumundan çekmece satırları: sıra `d.sohbetler`'inki, `secili` `d.secili`'den. */
export function cekmeceSohbetleri(d: CekirdekDurumu): readonly CekmeceSohbet[] {
  return d.sohbetler.map((o) => {
    const secili = o.sohbet_id === d.secili;
    const eski = satirOnbellegi.get(o);
    if (eski !== undefined && eski.secili === secili) return eski.satir;
    const satir: CekmeceSohbet = {
      id: o.sohbet_id,
      ad: o.ad,
      ...onizlemeKur(o),
      zaman_ms: o.sonEtkinlikMs,
      okunmamis: o.okunmamis,
      secili,
    };
    satirOnbellegi.set(o, { secili, satir });
    return satir;
  });
}

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

function gunBasi(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Bugün "14:32", dün "Dün", son 7 gün gün adı, daha eskisi "3 Kas". Zaman yoksa (0/geçersiz) "". */
export function zamanMetni(ms: number, simdi: number = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const fark = Math.round((gunBasi(new Date(simdi)) - gunBasi(d)) / 86400000);
  if (fark <= 0) {
    const s = String(d.getHours()).padStart(2, "0");
    const dk = String(d.getMinutes()).padStart(2, "0");
    return `${s}:${dk}`;
  }
  if (fark === 1) return "Dün";
  if (fark < 7) return GUNLER[d.getDay()];
  return `${d.getDate()} ${AYLAR[d.getMonth()]}`;
}

function Rozet({ sayi }: { sayi: number }) {
  const metin = sayi > esik.okunmamisEnCok ? `${esik.okunmamisEnCok}+` : String(sayi);
  return (
    <View
      style={{
        minWidth: olcu.rozet,
        height: olcu.rozet,
        paddingHorizontal: bosluk[1],
        borderRadius: yaricap.tam,
        backgroundColor: renk.vurgu,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text maxFontSizeMultiplier={1.2} style={[yazi.miniKalin, { color: renk.dolguUstu }]}>
        {metin}
      </Text>
    </View>
  );
}


/** Tek sohbet satırı: solda dokunulan alan (ad, önizleme, zaman, rozet), sağda `nokta3` düğmesi. */
const SohbetSatiri = memo(function SohbetSatiri({
  s,
  onSec,
  onSecenekler,
}: {
  s: CekmeceSohbet;
  onSec: (id: string) => void;
  onSecenekler: (id: string) => void;
}) {
  const okunmamis = !s.secili && s.okunmamis && s.okunmamis > 0 ? s.okunmamis : 0;
  const zaman = typeof s.zaman_ms === "number" && zamanMetni(s.zaman_ms) !== "" ? zamanMetni(s.zaman_ms) : null;
  const sag = zaman !== null || okunmamis > 0;
  const etiket = [s.ad, s.onizleme ?? null, okunmamis > 0 ? `${okunmamis} okunmamış` : null]
    .filter((x): x is string => x !== null && x !== "")
    .join(", ");
  return (
    <View
      style={{
        minHeight: 64,
        flexDirection: "row",
        alignItems: "stretch",
        backgroundColor: s.secili ? renk.secili : "transparent",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={etiket}
        accessibilityHint="Uzun basınca seçenekler açılır"
        accessibilityState={{ selected: s.secili }}
        onPress={() => onSec(s.id)}
        onLongPress={() => onSecenekler(s.id)}
        style={({ pressed }) => ({
          flex: 1,
          paddingLeft: bosluk[4],
          paddingRight: bosluk[1],
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: bosluk[3],
          backgroundColor: pressed && !s.secili ? renk.basili : "transparent",
        })}
      >
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.4}
            style={[s.secili ? yazi.govdeKalin : yazi.govde, { color: renk.metin }]}
          >
            {s.ad}
          </Text>
          {s.onizleme ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              style={[yazi.kucuk, { color: renk[s.onizlemeRenk ?? "metinSonuk"] }]}
            >
              {s.onizleme}
            </Text>
          ) : null}
        </View>
        {sag ? (
          <View style={{ alignItems: "flex-end", gap: bosluk[1] }}>
            {zaman !== null ? (
              <Text maxFontSizeMultiplier={1.2} style={[yazi.mini, { color: renk.metinSonuk }]}>
                {zaman}
              </Text>
            ) : null}
            {okunmamis > 0 ? <Rozet sayi={okunmamis} /> : null}
          </View>
        ) : null}
      </Pressable>
      <View style={{ justifyContent: "center", paddingRight: bosluk[1] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${s.ad} seçenekleri`}
          onPress={() => onSecenekler(s.id)}
          style={({ pressed }) => ({
            width: olcu.dokunma,
            height: olcu.dokunma,
            borderRadius: yaricap.tam,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? renk.basili : "transparent",
          })}
        >
          <Simge ad="nokta3" boyut={24} renk={renk.metinIkincil} />
        </Pressable>
      </View>
    </View>
  );
});

function AltSatir({ yaziMetni, basinca }: { yaziMetni: string; basinca: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={basinca}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: bosluk[4],
        justifyContent: "center",
        backgroundColor: pressed ? renk.basili : "transparent",
      })}
    >
      <Text maxFontSizeMultiplier={1.4} style={[yazi.govde, { color: renk.metin }]}>
        {yaziMetni}
      </Text>
    </Pressable>
  );
}

function sozMu(x: unknown): x is PromiseLike<unknown> {
  return typeof x === "object" && x !== null && typeof (x as { then?: unknown }).then === "function";
}

export function Cekmece(p: CekmeceProps): React.ReactElement {
  const { width } = useWindowDimensions();
  const panelGenislik = Math.min(width * olcu.cekmeceOran, olcu.cekmeceEnCok);
  const [gorunur, setGorunur] = useState(p.acik);
  const ilerleme = useRef(new Animated.Value(p.acik ? 1 : 0)).current;
  const azHareket = useRef(false);

  useEffect(() => {
    let canli = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (canli) azHareket.current = v;
    });
    const abone = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
      azHareket.current = v;
    });
    return () => {
      canli = false;
      abone.remove();
    };
  }, []);

  useEffect(() => {
    ilerleme.stopAnimation();
    if (p.acik) {
      setGorunur(true);
      Animated.timing(ilerleme, {
        toValue: 1,
        duration: azHareket.current ? 0 : sure.orta,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(ilerleme, {
        toValue: 0,
        duration: azHareket.current ? 0 : sure.hizli,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setGorunur(false);
      });
    }
  }, [p.acik, ilerleme]);

  const { onKapat, onSohbetSec, onSecenekler, onDurum, onKurulum, onYeniSohbet: yeni } = p;
  const sec = useCallback(
    (id: string) => {
      onKapat();
      onSohbetSec(id);
    },
    [onKapat, onSohbetSec],
  );
  const durumaGit = useCallback(() => {
    onKapat();
    onDurum();
  }, [onKapat, onDurum]);
  const kurulumaGit = useCallback(() => {
    onKapat();
    onKurulum();
  }, [onKapat, onKurulum]);

  // Çekmeceyi kapatmak çağıranın işi (başarıda); sınır notu düğmenin altında görünebilsin.
  const [yeniBekliyor, setYeniBekliyor] = useState(false);
  const yeniYolda = useRef(false);
  const takili = useRef(true);
  useEffect(() => {
    takili.current = true;
    return () => {
      takili.current = false;
    };
  }, []);
  const yeniyeGit = useCallback(() => {
    if (!yeni || yeniYolda.current) return;
    const sonuc = yeni();
    if (!sozMu(sonuc)) return;
    yeniYolda.current = true;
    setYeniBekliyor(true);
    const bitti = () => {
      yeniYolda.current = false;
      if (takili.current) setYeniBekliyor(false);
    };
    sonuc.then(bitti, bitti);
  }, [yeni]);

  const ustBosluk = StatusBar.currentHeight ?? 0;
  const translateX = useMemo(
    () => ilerleme.interpolate({ inputRange: [0, 1], outputRange: [-panelGenislik, 0] }),
    [ilerleme, panelGenislik],
  );

  return (
    <Modal visible={gorunur} transparent animationType="none" statusBarTranslucent onRequestClose={onKapat}>
      <View style={{ flex: 1 }}>
        <Animated.View
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, opacity: ilerleme, backgroundColor: renk.perde }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Çekmeceyi kapat"
            onPress={onKapat}
            style={{ flex: 1 }}
          />
        </Animated.View>
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: panelGenislik,
            backgroundColor: renk.yuzey,
            paddingTop: ustBosluk,
            transform: [{ translateX }],
          }}
        >
          <View style={{ paddingHorizontal: bosluk[4], paddingTop: bosluk[4], paddingBottom: bosluk[3], gap: bosluk[3] }}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={[yazi.baslik, { color: renk.metin }]}>
              Sohbetler
            </Text>
            {yeni ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: yeniBekliyor }}
                disabled={yeniBekliyor}
                onPress={yeniyeGit}
                style={({ pressed }) => ({
                  minHeight: olcu.dokunma,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: bosluk[2],
                  borderRadius: yaricap.orta,
                  borderWidth: cizgi.normal,
                  borderColor: renk.kenarGuclu,
                  backgroundColor: pressed ? renk.basili : "transparent",
                })}
              >
                <Simge ad="arti" boyut={20} renk={yeniBekliyor ? renk.metinSonuk : renk.metin} />
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={[yazi.govdeKalin, { color: yeniBekliyor ? renk.metinSonuk : renk.metin }]}
                >
                  Yeni sohbet
                </Text>
              </Pressable>
            ) : null}
            {yeni && p.yeniSohbetNotu ? (
              <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.4} style={[yazi.kucuk, { color: renk.uyari }]}>
                {p.yeniSohbetNotu}
              </Text>
            ) : null}
          </View>

          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {p.sohbetler.length === 0 ? (
              <Text
                maxFontSizeMultiplier={1.4}
                style={[yazi.kucuk, { color: renk.metinSonuk, paddingHorizontal: bosluk[4], paddingVertical: bosluk[3] }]}
              >
                Henüz sohbet yok.
              </Text>
            ) : (
              p.sohbetler.map((s) => <SohbetSatiri key={s.id} s={s} onSec={sec} onSecenekler={onSecenekler} />)
            )}
          </ScrollView>

          <View style={{ height: cizgi.ince, backgroundColor: renk.kenar }} />
          <AltSatir yaziMetni="Durum" basinca={durumaGit} />
          <AltSatir yaziMetni="Kurulum" basinca={kurulumaGit} />
          {p.altBilgi ? (
            <Text
              numberOfLines={2}
              maxFontSizeMultiplier={1.4}
              style={[
                yazi.mini,
                {
                  color: renk[p.altBilgi.renk ?? "metinSonuk"],
                  paddingHorizontal: bosluk[4],
                  paddingTop: bosluk[1],
                  paddingBottom: bosluk[3],
                },
              ]}
            >
              {p.altBilgi.metin}
            </Text>
          ) : (
            <View style={{ height: bosluk[3] }} />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
