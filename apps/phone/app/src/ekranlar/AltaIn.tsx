// En alta in düğmesi ve kancası (TASARIM.md 6.10).
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,

  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Simge } from "./Ikonlar";
import { bosluk, cizgi, esik, olcu, renk, sure, yaricap, yazi } from "./tema";

export type AltaInDurumu = { gorunur: boolean; okunmamis: number };

// ---------------------------------------------------------------- Saf mantık (RN'siz)

export type KaydirmaOlcusu = {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
};

/** Listenin alt ucuna uzaklık (dp). Aşırı kaydırma (bounce) negatif çıkmasın diye 0'a kırpılır. */
export function altaUzaklik(o: KaydirmaOlcusu): number {
  const u = o.contentSize.height - (o.contentOffset.y + o.layoutMeasurement.height);
  return u > 0 ? u : 0;
}

/**
 * Gecikmeli (histerezisli) görünürlük: `goster`'i aşınca görünür, `gizle`'nin altına inince gizlenir,
 * ikisinin arasında önceki hâli korur.
 */
export function gorunurlukHesapla(
  uzaklik: number,
  onceki: boolean,
  goster: number = esik.altaInGoster,
  gizle: number = esik.altaInGizle,
): boolean {
  if (uzaklik > goster) return true;
  if (uzaklik < gizle) return false;
  return onceki;
}

/** Alt eşik içinde mi (kendiliğinden kaydırma kararı). */
export function altaYakinMi(uzaklik: number, gizle: number = esik.altaInGizle): boolean {
  return uzaklik < gizle;
}

/** Düğmedeki sayı metni: 99'dan sonra "99+". */
export function sayiMetni(n: number): string {
  return n > esik.okunmamisEnCok ? `${esik.okunmamisEnCok}+` : String(n);
}

// ---------------------------------------------------------------- Kanca

export function useAltaIn(): {
  durum: AltaInDurumu;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** FlatList `onContentSizeChange`'e verilir: içerik boyu değişince görünürlük yeniden hesaplanır. */
  onContentSizeChange: (genislik: number, yukseklik: number) => void;
  alttaMi: () => boolean;
  yeniOgeler: (adet: number) => void;
  indi: () => void;
} {
  const [durum, setDurum] = useState<AltaInDurumu>({ gorunur: false, okunmamis: 0 });
  // Ref'ler her kaydırma olayında render'ı tetiklemesin diye ayrı tutulur.
  const alttaRef = useRef(true);
  const gorunurRef = useRef(false);
  // Son bilinen ölçüler (içerik boyu değişince yeniden hesap için).
  const olcuRef = useRef<KaydirmaOlcusu | null>(null);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    olcuRef.current = { contentOffset: { y: contentOffset.y }, contentSize: { height: contentSize.height }, layoutMeasurement: { height: layoutMeasurement.height } };
    const uzaklik = altaUzaklik(e.nativeEvent);
    alttaRef.current = altaYakinMi(uzaklik);
    const g = gorunurlukHesapla(uzaklik, gorunurRef.current);
    gorunurRef.current = g;
    setDurum((d) => {
      const okunmamis = alttaRef.current ? 0 : d.okunmamis;
      return d.gorunur === g && d.okunmamis === okunmamis ? d : { gorunur: g, okunmamis };
    });
  }, []);

  const onContentSizeChange = useCallback((_genislik: number, yukseklik: number) => {
    const son = olcuRef.current;
    if (!son) return;
    olcuRef.current = { ...son, contentSize: { height: yukseklik } };
    if (alttaRef.current) return; // alttaki kullanıcı için durum değişmez
    const g = gorunurlukHesapla(altaUzaklik(olcuRef.current), gorunurRef.current);
    gorunurRef.current = g;
    setDurum((d) => (d.gorunur === g ? d : { ...d, gorunur: g }));
  }, []);

  const alttaMi = useCallback(() => alttaRef.current, []);

  const yeniOgeler = useCallback((adet: number) => {
    if (alttaRef.current || !(adet > 0)) return;
    setDurum((d) => ({ ...d, okunmamis: d.okunmamis + Math.floor(adet) }));
  }, []);

  const indi = useCallback(() => {
    alttaRef.current = true;
    gorunurRef.current = false;
    setDurum((d) => (!d.gorunur && d.okunmamis === 0 ? d : { gorunur: false, okunmamis: 0 }));
  }, []);

  return { durum, onScroll, onContentSizeChange, alttaMi, yeniOgeler, indi };
}

// ---------------------------------------------------------------- Düğme

export function AltaInDugmesi(p: { durum: AltaInDurumu; basinca: () => void }): React.ReactElement | null {
  const { durum, basinca } = p;
  const [takili, setTakili] = useState(durum.gorunur);
  const [azHareket, setAzHareket] = useState(false);
  const anim = useRef(new Animated.Value(durum.gorunur ? 1 : 0)).current;

  useEffect(() => {
    let canli = true;
    AccessibilityInfo.isReduceMotionEnabled().then((d) => { if (canli) setAzHareket(d); }).catch(() => {});
    const abonelik = AccessibilityInfo.addEventListener("reduceMotionChanged", setAzHareket);
    return () => { canli = false; abonelik.remove(); };
  }, []);

  useEffect(() => {
    if (durum.gorunur) setTakili(true);
    const a = Animated.timing(anim, {
      toValue: durum.gorunur ? 1 : 0,
      duration: azHareket ? 0 : sure.hizli,
      useNativeDriver: true,
    });
    a.start(({ finished }) => { if (finished && !durum.gorunur) setTakili(false); });
    return () => a.stop();
  }, [durum.gorunur, azHareket, anim]);

  if (!takili) return null;

  const sayili = durum.okunmamis > 0;
  const etiket = sayili ? `En alta in, ${durum.okunmamis} yeni mesaj` : "En alta in";
  const kayma = anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <Animated.View
      pointerEvents={durum.gorunur ? "box-none" : "none"}
      style={[s.kap, { opacity: anim, transform: [{ translateY: kayma }] }]}
    >
      <Pressable
        onPress={basinca}
        accessibilityRole="button"
        accessibilityLabel={etiket}
        hitSlop={sayili ? 4 : (olcu.dokunma - olcu.altaInDaire) / 2}
        style={({ pressed }) =>
          sayili
            ? [s.hap, { backgroundColor: pressed ? renk.vurguBasili : renk.vurgu }]
            : [s.daire, { backgroundColor: pressed ? renk.basili : renk.yuzeyUst }]
        }
      >
        <Simge ad="asagi" renk={sayili ? renk.dolguUstu : renk.metin} />
        {sayili ? <Text style={s.sayi}>{sayiMetni(durum.okunmamis)}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // Üst kap, giriş çubuğunun üstündeki satıra konur: sağdan 16, alttan 12 dp.
  kap: { position: "absolute", right: bosluk[4], bottom: bosluk[3], alignItems: "flex-end" } as const,
  daire: {
    width: olcu.altaInDaire,
    height: olcu.altaInDaire,
    borderRadius: yaricap.tam,
    borderWidth: cizgi.normal,
    borderColor: renk.kenar,
    alignItems: "center",
    justifyContent: "center",
  },
  hap: {
    height: olcu.altaInHap,
    paddingHorizontal: 14,
    borderRadius: yaricap.tam,
    flexDirection: "row",
    alignItems: "center",
    gap: bosluk[1],
  },
  sayi: { ...yazi.miniKalin, color: renk.dolguUstu },
});

