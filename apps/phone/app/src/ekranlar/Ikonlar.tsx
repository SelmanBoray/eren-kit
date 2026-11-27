import React from "react";
import { View } from "react-native";
import { renk } from "./tema";

/** Düz View çizimli simgeler (TASARIM.md bölüm 8). Kutu 24x24, çizgi 2 dp, ortalı. */
export type IkonProp = { boyut?: number; renk?: string };

const KUTU = 24;
const KALIN = 2;

function Kutu({ boyut, children }: { boyut: number | undefined; children: React.ReactNode }) {
  const olcek = (boyut ?? KUTU) / KUTU;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: boyut ?? KUTU,
        height: boyut ?? KUTU,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: KUTU,
          height: KUTU,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: olcek }],
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Cubuk({ en, renkDeger, aci }: { en: number; renkDeger: string; aci?: number }) {
  return (
    <View
      style={{
        position: "absolute",
        width: en,
        height: KALIN,
        borderRadius: KALIN / 2,
        backgroundColor: renkDeger,
        transform: aci ? [{ rotate: `${aci}deg` }] : undefined,
      }}
    />
  );
}

export function IkonMenu({ boyut, renk: r = renk.metin }: IkonProp) {
  return (
    <Kutu boyut={boyut}>
      <View style={{ gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: 18, height: KALIN, borderRadius: 1, backgroundColor: r }} />
        ))}
      </View>
    </Kutu>
  );
}

export function IkonArti({ boyut, renk: r = renk.metin }: IkonProp) {
  return (
    <Kutu boyut={boyut}>
      <Cubuk en={16} renkDeger={r} />
      <Cubuk en={16} renkDeger={r} aci={90} />
    </Kutu>
  );
}

function Ok({ boyut, renk: r, aci, kayma }: { boyut?: number; renk: string; aci: number; kayma: number }) {
  return (
    <Kutu boyut={boyut}>
      <View
        style={{
          width: 9,
          height: 9,
          borderRightWidth: KALIN,
          borderBottomWidth: KALIN,
          borderColor: r,
          transform: [{ translateY: kayma }, { rotate: `${aci}deg` }],
        }}
      />
    </Kutu>
  );
}

export function IkonAsagi({ boyut, renk: r = renk.metin }: IkonProp) {
  return <Ok boyut={boyut} renk={r} aci={45} kayma={-2} />;
}

export function IkonGeri({ boyut, renk: r = renk.metin }: IkonProp) {
  return <Ok boyut={boyut} renk={r} aci={135} kayma={0} />;
}

export function IkonNokta3({ boyut, renk: r = renk.metin }: IkonProp) {
  return (
    <Kutu boyut={boyut}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: r }} />
        ))}
      </View>
    </Kutu>
  );
}

export function IkonKapat({ boyut, renk: r = renk.metin }: IkonProp) {
  return (
    <Kutu boyut={boyut}>
      <Cubuk en={16} renkDeger={r} aci={45} />
      <Cubuk en={16} renkDeger={r} aci={-45} />
    </Kutu>
  );
}

/** Ataç (ek düğmesi): iç içe iki yuvarlak uçlu halka, 45° yatık. */
export function IkonAtac({ boyut, renk: r = renk.metin }: IkonProp) {
  return (
    <Kutu boyut={boyut}>
      <View style={{ transform: [{ rotate: "45deg" }], alignItems: "center", justifyContent: "flex-end" }}>
        <View style={{ width: 10, height: 20, borderRadius: 5, borderWidth: KALIN, borderColor: r }} />
        <View
          style={{
            position: "absolute",
            bottom: 4,
            width: 6,
            height: 12,
            borderRadius: 3,
            borderWidth: KALIN,
            borderColor: r,
            borderTopWidth: 0,
          }}
        />
      </View>
    </Kutu>
  );
}

/** Fotoğraf makinesi: gövde, üstte tümsek, ortada mercek. */
export function IkonKamera({ boyut, renk: r = renk.metin }: IkonProp) {
  return (
    <Kutu boyut={boyut}>
      <View style={{ alignItems: "center" }}>
        <View style={{ width: 8, height: 3, borderTopLeftRadius: 1, borderTopRightRadius: 1, backgroundColor: r }} />
        <View
          style={{
            width: 20,
            height: 14,
            borderRadius: 3,
            borderWidth: KALIN,
            borderColor: r,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 3.5, borderWidth: KALIN, borderColor: r }} />
        </View>
      </View>
    </Kutu>
  );
}

/** Video kamerası: gövde ve sağda açılan mercek üçgeni. */
export function IkonVideo({ boyut, renk: r = renk.metin }: IkonProp) {
  return (
    <Kutu boyut={boyut}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
        <View style={{ width: 14, height: 12, borderRadius: 2, borderWidth: KALIN, borderColor: r }} />
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: 5,
            borderBottomWidth: 5,
            borderRightWidth: 6,
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
            borderRightColor: r,
          }}
        />
      </View>
    </Kutu>
  );
}

/** Oynat: sağa bakan dolu üçgen (video yer tutucusu). */
export function IkonOynat({ boyut, renk: r = renk.metin }: IkonProp) {
  return (
    <Kutu boyut={boyut}>
      <View
        style={{
          width: 0,
          height: 0,
          marginLeft: 3,
          borderTopWidth: 8,
          borderBottomWidth: 8,
          borderLeftWidth: 13,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: r,
        }}
      />
    </Kutu>
  );
}

/** Durum noktası (düğme değil). Varsayılan 8 dp. */
export function IkonNokta({ boyut = 8, renk: r = renk.metin }: IkonProp) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: boyut, height: boyut, borderRadius: boyut / 2, backgroundColor: r }}
    />
  );
}

export type IkonAdi =
  | "menu"
  | "arti"
  | "asagi"
  | "geri"
  | "nokta3"
  | "kapat"
  | "nokta"
  | "atac"
  | "kamera"
  | "video"
  | "oynat";

/** Belgedeki `Simge` bileşeni: ada göre ilgili ikonu çizer. */
export function Simge({ ad, boyut, renk: r }: IkonProp & { ad: IkonAdi }) {
  switch (ad) {
    case "menu": return <IkonMenu boyut={boyut} renk={r} />;
    case "arti": return <IkonArti boyut={boyut} renk={r} />;
    case "asagi": return <IkonAsagi boyut={boyut} renk={r} />;
    case "geri": return <IkonGeri boyut={boyut} renk={r} />;
    case "nokta3": return <IkonNokta3 boyut={boyut} renk={r} />;
    case "kapat": return <IkonKapat boyut={boyut} renk={r} />;
    case "nokta": return <IkonNokta boyut={boyut} renk={r} />;
    case "atac": return <IkonAtac boyut={boyut} renk={r} />;
    case "kamera": return <IkonKamera boyut={boyut} renk={r} />;
    case "video": return <IkonVideo boyut={boyut} renk={r} />;
    case "oynat": return <IkonOynat boyut={boyut} renk={r} />;
  }
}
