import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Dimensions } from "react-native";
import { bosluk, renk, sure, yaricap, yazi } from "./tema";

export type AltSayfaProp = {
  acik: boolean;
  onKapat: () => void;
  baslik?: string;
  children?: React.ReactNode;
};

/** Gezinti çubuğu yüksekliği (bağımlılıksız kestirim): ekran ile pencere farkından durum çubuğu çıkarılır. */
function gezintiBoslugu(pencereYukseklik: number): number {
  const ekran = Dimensions.get("screen").height;
  const fark = ekran - pencereYukseklik - (StatusBar.currentHeight ?? 0);
  return fark > 0 ? Math.round(fark) : 0;
}

export function AltSayfa({ acik, onKapat, baslik, children }: AltSayfaProp) {
  const { height } = useWindowDimensions();
  const [azHareket, setAzHareket] = useState(false);
  // Kapanış animasyonu bitene kadar Modal görünür kalır.
  const [gorunur, setGorunur] = useState(acik);
  const [yukseklik, setYukseklik] = useState(height);
  const ilerleme = useRef(new Animated.Value(0)).current; // 0 kapalı, 1 açık

  useEffect(() => {
    let canli = true;
    AccessibilityInfo.isReduceMotionEnabled().then((d) => { if (canli) setAzHareket(d); }).catch(() => {});
    const abonelik = AccessibilityInfo.addEventListener("reduceMotionChanged", setAzHareket);
    return () => { canli = false; abonelik.remove(); };
  }, []);

  useEffect(() => {
    if (acik) {
      setGorunur(true);
      if (azHareket) { ilerleme.setValue(1); return; }
      const a = Animated.timing(ilerleme, {
        toValue: 1, duration: sure.orta, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      });
      a.start();
      return () => a.stop();
    }
    if (azHareket) { ilerleme.setValue(0); setGorunur(false); return; }
    const a = Animated.timing(ilerleme, {
      toValue: 0, duration: sure.hizli, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    });
    a.start(({ finished }) => { if (finished) setGorunur(false); });
    return () => a.stop();
  }, [acik, azHareket, ilerleme]);

  const kayma = ilerleme.interpolate({ inputRange: [0, 1], outputRange: [yukseklik, 0] });

  return (
    <Modal visible={gorunur} transparent animationType="none" statusBarTranslucent onRequestClose={onKapat}>
      <View style={s.kap}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: ilerleme }]}>
          <Pressable
            accessibilityLabel="Kapat"
            accessibilityRole="button"
            onPress={onKapat}
            style={[StyleSheet.absoluteFill, { backgroundColor: renk.perde }]}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          onLayout={(e) => setYukseklik(e.nativeEvent.layout.height)}
          style={[
            s.sayfa,
            { maxHeight: height * 0.85, paddingBottom: bosluk[2] + gezintiBoslugu(height), transform: [{ translateY: kayma }] },
          ]}
        >
          {baslik ? (
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[yazi.kucukKalin, s.baslik, { color: renk.metinIkincil }]}
            >
              {baslik}
            </Text>
          ) : null}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function AltSayfaSatiri(p: {
  yazi: string;
  aciklama?: string;
  tehlikeli?: boolean;
  kapali?: boolean;
  basinca: () => void;
}) {
  const { yazi: metin, aciklama, tehlikeli = false, kapali = false, basinca } = p;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: kapali }}
      disabled={kapali}
      onPress={basinca}
      style={({ pressed }) => [s.satir, { backgroundColor: pressed && !kapali ? renk.basili : "transparent" }]}
    >
      <Text
        style={[yazi.govde, { color: kapali ? renk.metinSonuk : tehlikeli ? renk.hata : renk.metin }]}
      >
        {metin}
      </Text>
      {aciklama ? (
        <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>{aciklama}</Text>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  kap: { flex: 1, justifyContent: "flex-end" },
  sayfa: {
    backgroundColor: renk.yuzeyUst,
    borderTopLeftRadius: yaricap.buyuk,
    borderTopRightRadius: yaricap.buyuk,
  },
  baslik: { paddingHorizontal: bosluk[4], paddingTop: bosluk[4], paddingBottom: bosluk[1] },
  satir: {
    minHeight: 52,
    paddingHorizontal: bosluk[4],
    paddingVertical: bosluk[2],
    justifyContent: "center",
  },
});
