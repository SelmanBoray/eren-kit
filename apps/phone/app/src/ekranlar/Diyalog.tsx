import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { bosluk, cizgi, olcu, renk, sure, yaricap, yazi } from "./tema";

export type DiyalogProp = {
  acik: boolean;
  baslik: string;
  govde?: string;
  /** Eylem düğmesinin yazısı (örn. "Geçmişi sil"). */
  onayMetni: string;
  /** Eylem tehlikeliyse hata renginde ve açılıştan sonra 600 ms kapalı. */
  tehlikeli?: boolean;
  /** İptal düğmesi yazısı. Varsayılan "Vazgeç". */
  iptalMetni?: string;
  /** Eylem düğmesini ayrıca kapatır (örn. boş ad). */
  onayKapali?: boolean;
  /** İşlem sürüyor: iki düğme de kapalı, onay yazısı yerine bu gösterilir (örn. "Siliniyor"). */
  mesgul?: string;
  /** Düğmelerin üstünde hata satırı. */
  hataMetni?: string;
  /** Düğmelerin üstünde uyarı satırı (koşullu ek bilgi). */
  uyariMetni?: string;
  /** Gövdenin altında ek içerik (örn. yeniden adlandırma girdisi). */
  children?: React.ReactNode;
  onOnay: () => void;
  onIptal: () => void;
};

type DugmeTuru = "ikincil" | "birincil" | "tehlikeli";

function Dugme(p: { metin: string; tur: DugmeTuru; kapali: boolean; basildi: () => void }) {
  const { metin, tur, kapali, basildi } = p;
  const zemin = (basili: boolean): string => {
    if (kapali) return tur === "ikincil" ? "transparent" : renk.yuzeyUst;
    if (tur === "birincil") return basili ? renk.vurguBasili : renk.vurgu;
    if (tur === "tehlikeli") return basili ? renk.hataBasili : renk.hata;
    return basili ? renk.basili : "transparent";
  };
  const yaziRengi = kapali ? renk.metinSonuk : tur === "ikincil" ? renk.metin : renk.dolguUstu;
  const kenar = tur !== "ikincil" ? undefined : kapali ? renk.kenar : renk.kenarGuclu;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: kapali }}
      disabled={kapali}
      onPress={basildi}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: olcu.dokunma,
        paddingHorizontal: bosluk[4],
        borderRadius: yaricap.orta,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: zemin(pressed),
        borderWidth: kenar ? cizgi.normal : 0,
        borderColor: kenar,
      })}
    >
      <Text
        maxFontSizeMultiplier={1.4}
        numberOfLines={1}
        style={[yazi.govdeKalin, { color: yaziRengi, textAlign: "center" }]}
      >
        {metin}
      </Text>
    </Pressable>
  );
}

export function Diyalog({
  acik, baslik, govde, onayMetni, tehlikeli = false, iptalMetni = "Vazgeç",
  onayKapali = false, mesgul, hataMetni, uyariMetni, children, onOnay, onIptal,
}: DiyalogProp) {
  const { width } = useWindowDimensions();
  const [azHareket, setAzHareket] = useState(false);
  const [kilit, setKilit] = useState(false);
  const opaklik = useRef(new Animated.Value(0)).current;
  const olcek = useRef(new Animated.Value(0.98)).current;

  useEffect(() => {
    let canli = true;
    AccessibilityInfo.isReduceMotionEnabled().then((d) => { if (canli) setAzHareket(d); }).catch(() => {});
    const abonelik = AccessibilityInfo.addEventListener("reduceMotionChanged", setAzHareket);
    return () => { canli = false; abonelik.remove(); };
  }, []);

  // Açılış animasyonu 150 ms; kapanış anında. Az harekette anında.
  useEffect(() => {
    if (!acik) { opaklik.setValue(0); olcek.setValue(0.98); return; }
    if (azHareket) { opaklik.setValue(1); olcek.setValue(1); return; }
    opaklik.setValue(0); olcek.setValue(0.98);
    const a = Animated.parallel([
      Animated.timing(opaklik, { toValue: 1, duration: sure.hizli, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(olcek, { toValue: 1, duration: sure.hizli, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    a.start();
    return () => a.stop();
  }, [acik, azHareket, opaklik, olcek]);

  // Tehlikeli düğme kilidi: her açılışta 600 ms.
  useEffect(() => {
    if (!acik || !tehlikeli) { setKilit(false); return; }
    setKilit(true);
    const z = setTimeout(() => setKilit(false), sure.tehlikeKilidi);
    return () => clearTimeout(z);
  }, [acik, tehlikeli]);

  const mesgulMu = mesgul !== undefined;
  const onayDugmeKapali = onayKapali || mesgulMu || (tehlikeli && kilit);

  return (
    <Modal visible={acik} transparent animationType="none" statusBarTranslucent onRequestClose={onIptal}>
      <View style={s.kap}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: opaklik }]}>
          <Pressable
            accessibilityLabel={iptalMetni}
            accessibilityRole="button"
            onPress={onIptal}
            style={[StyleSheet.absoluteFill, { backgroundColor: renk.perde }]}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            s.kutu,
            { width: Math.min(width - 48, olcu.diyalogEnCok), opacity: opaklik, transform: [{ scale: olcek }] },
          ]}
        >
          <Text accessibilityRole="header" style={[yazi.baslik, { color: renk.metin }]}>{baslik}</Text>
          {govde ? <Text selectable style={[yazi.govde, { color: renk.metinIkincil }]}>{govde}</Text> : null}
          {children}
          {uyariMetni ? <Text style={[yazi.kucuk, { color: renk.uyari }]}>{uyariMetni}</Text> : null}
          {hataMetni ? <Text style={[yazi.kucuk, { color: renk.hata }]}>{hataMetni}</Text> : null}
          <View style={s.dugmeler}>
            <Dugme metin={iptalMetni} tur="ikincil" kapali={mesgulMu} basildi={onIptal} />
            <Dugme
              metin={mesgulMu ? (mesgul as string) : onayMetni}
              tur={tehlikeli ? "tehlikeli" : "birincil"}
              kapali={onayDugmeKapali}
              basildi={onOnay}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  kap: { flex: 1, alignItems: "center", justifyContent: "center" },
  kutu: {
    backgroundColor: renk.yuzeyUst,
    borderRadius: yaricap.buyuk,
    padding: bosluk[6],
    gap: bosluk[3],
  },
  dugmeler: { flexDirection: "row", gap: bosluk[2] },
});
