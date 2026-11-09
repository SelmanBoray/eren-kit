import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StatusBar, Text, View } from "react-native";
import { Simge } from "./Ikonlar";
import { bosluk, cizgi, olcu, renk, sure, yaricap, yazi } from "./tema.ts";
import type { RenkAdi } from "./tema.ts";

export type HatDurumu = "bagli" | "baglaniyor" | "kopuk" | "hata";
export type SagDugme = { simge: "nokta3" | "arti"; etiket: string; basinca: () => void };
export type UstCubukProps = {
  baslik: string;
  altBaslik?: { metin: string; renk?: RenkAdi; nokta?: boolean; metinRenk?: RenkAdi } | null;
  sol: { simge: "menu" | "geri"; etiket: string; basinca: () => void; nokta?: boolean };
  isSayisi?: number;
  onIsler?: () => void;
  sag?: SagDugme | readonly SagDugme[] | null;
  hat: HatDurumu;
  serit?: {
    metin: string;
    tur: "uyari" | "hata" | "bilgi";
    eylem?: { yazi: string; basinca: () => void };
  } | null;
};

function useAzHareket(): boolean {
  const [az, setAz] = useState(false);
  useEffect(() => {
    let canli = true;
    AccessibilityInfo.isReduceMotionEnabled().then((d) => { if (canli) setAz(d); }).catch(() => {});
    const abonelik = AccessibilityInfo.addEventListener("reduceMotionChanged", setAz);
    return () => { canli = false; abonelik.remove(); };
  }, []);
  return az;
}

/** Hat (6.2): her durumda 2 dp yükseklik; erişilebilirlik ağacına girmez. */
function Hat({ durum }: { durum: HatDurumu }) {
  const azHareket = useAzHareket();
  const [genislik, setGenislik] = useState(0);
  const ilerleme = useRef(new Animated.Value(0)).current;
  const akis = durum === "baglaniyor" && !azHareket && genislik > 0;

  useEffect(() => {
    if (!akis) return;
    ilerleme.setValue(0);
    const d = Animated.loop(
      Animated.timing(ilerleme, {
        toValue: 1,
        duration: sure.hat,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    d.start();
    return () => d.stop();
  }, [akis, ilerleme]);

  const parca = genislik * 0.3;
  let ic: React.ReactNode = null;
  if (durum === "bagli") {
    ic = (
      <View
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: cizgi.ince, backgroundColor: renk.kenar }}
      />
    );
  } else if (durum === "kopuk") {
    ic = <View style={{ flex: 1, backgroundColor: renk.uyari }} />;
  } else if (durum === "hata") {
    ic = <View style={{ flex: 1, backgroundColor: renk.hata }} />;
  } else if (azHareket) {
    ic = <View style={{ flex: 1, backgroundColor: renk.bilgi }} />;
  } else {
    ic = (
      <>
        <View style={{ flex: 1, backgroundColor: renk.kenar }} />
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: parca,
            backgroundColor: renk.bilgi,
            transform: [
              {
                translateX: ilerleme.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-parca, genislik],
                }),
              },
            ],
          }}
        />
      </>
    );
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setGenislik(e.nativeEvent.layout.width)}
      style={{ height: olcu.hat, overflow: "hidden", backgroundColor: renk.zemin }}
    >
      {ic}
    </View>
  );
}

function SimgeDugmesi(p: {
  simge: "menu" | "geri" | "nokta3" | "arti";
  etiket: string;
  basinca: () => void;
  nokta?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.nokta ? `${p.etiket}, başka sohbette okunmamış var` : p.etiket}
      onPress={p.basinca}
      style={({ pressed }) => ({
        width: olcu.dokunma,
        height: olcu.dokunma,
        borderRadius: yaricap.tam,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? renk.basili : "transparent",
      })}
    >
      <Simge ad={p.simge} boyut={24} />
      {p.nokta ? (
        <View
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 8,
            height: 8,
            borderRadius: yaricap.tam,
            backgroundColor: renk.vurgu,
          }}
        />
      ) : null}
    </Pressable>
  );
}

function IsHapi({ adet, basinca }: { adet: number; basinca?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${adet} iş çalışıyor, listeyi aç`}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      onPress={basinca}
      style={({ pressed }) => ({
        height: 32,
        paddingHorizontal: bosluk[3],
        borderRadius: yaricap.tam,
        borderWidth: cizgi.normal,
        borderColor: renk.kenar,
        backgroundColor: pressed ? renk.basili : renk.zemin,
        flexDirection: "row",
        alignItems: "center",
        gap: bosluk[2],
      })}
    >
      <View style={{ width: olcu.nokta, height: olcu.nokta, borderRadius: yaricap.tam, backgroundColor: renk.bilgi }} />
      <Text maxFontSizeMultiplier={1.3} style={[yazi.kucuk, { color: renk.metin }]}>{`${adet} iş`}</Text>
    </Pressable>
  );
}

const seritRenkleri = {
  uyari: { zemin: renk.uyariZemin, kenar: renk.uyariKenar },
  hata: { zemin: renk.hataZemin, kenar: renk.hataKenar },
  bilgi: { zemin: renk.bilgiZemin, kenar: renk.bilgiKenar },
} as const;

function DurumSeridi({ serit }: { serit: NonNullable<UstCubukProps["serit"]> }) {
  const r = seritRenkleri[serit.tur];
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: r.zemin,
        borderBottomWidth: cizgi.normal,
        borderBottomColor: r.kenar,
        paddingHorizontal: bosluk[4],
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: bosluk[3],
      }}
    >
      <Text style={[yazi.kucuk, { color: renk.metin, flex: 1 }]}>{serit.metin}</Text>
      {serit.eylem ? (
        <Pressable
          accessibilityRole="button"
          onPress={serit.eylem.basinca}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={({ pressed }) => ({
            minHeight: 40,
            paddingHorizontal: bosluk[3],
            borderRadius: yaricap.kucuk,
            justifyContent: "center",
            backgroundColor: pressed ? renk.basili : "transparent",
          })}
        >
          <Text style={[yazi.kucukKalin, { color: renk.vurgu }]}>{serit.eylem.yazi}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function UstCubuk(p: UstCubukProps): React.ReactElement {
  const ustBosluk = StatusBar.currentHeight ?? 0;
  const alt = p.altBaslik;
  const sagDugmeler: readonly SagDugme[] = p.sag ? (Array.isArray(p.sag) ? p.sag : [p.sag as SagDugme]).slice(0, 2) : [];
  return (
    <View style={{ backgroundColor: renk.zemin }}>
      <View style={{ paddingTop: ustBosluk }}>
        <View
          style={{
            height: olcu.ustCubuk,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: bosluk[1],
            gap: bosluk[1],
          }}
        >
          <SimgeDugmesi simge={p.sol.simge} etiket={p.sol.etiket} basinca={p.sol.basinca} nokta={p.sol.nokta} />
          <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={1.3}
              style={[yazi.baslik, { color: renk.metin }]}
            >
              {p.baslik}
            </Text>
            {alt ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: bosluk[2] }}>
                {alt.nokta !== false ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      width: olcu.nokta,
                      height: olcu.nokta,
                      borderRadius: yaricap.tam,
                      backgroundColor: renk[alt.renk ?? "metinIkincil"],
                    }}
                  />
                ) : null}
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  maxFontSizeMultiplier={1.3}
                  style={[yazi.kucuk, { color: renk[alt.metinRenk ?? "metinIkincil"], flexShrink: 1 }]}
                >
                  {alt.metin}
                </Text>
              </View>
            ) : null}
          </View>
          {p.isSayisi !== undefined && p.isSayisi > 0 ? <IsHapi adet={p.isSayisi} basinca={p.onIsler} /> : null}
          {sagDugmeler.map((d) => (
            <SimgeDugmesi key={d.simge} simge={d.simge} etiket={d.etiket} basinca={d.basinca} />
          ))}
        </View>
      </View>
      <Hat durum={p.hat} />
      {p.serit ? <DurumSeridi serit={p.serit} /> : null}
    </View>
  );
}
