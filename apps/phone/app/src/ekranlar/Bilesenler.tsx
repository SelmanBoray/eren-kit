import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { bosluk, cizgi, olcu, renk, yaricap, yazi } from "./tema.ts";
import type { DurumRengi, RenkAdi } from "./tema.ts";

export type DugmeTuru = "birincil" | "ikincil" | "metin" | "tehlikeli" | "tehlikeliMetin";

interface TurStili {
  zemin: string;
  basiliZemin: string;
  yazi: string;
  kenar?: string;
  kapaliZemin: string;
  kapaliYazi: string;
  kapaliKenar?: string;
  yatay: number;
}

const SAYDAM = "transparent";

// TASARIM.md 6.17 tablosu.
const turler: Record<DugmeTuru, TurStili> = {
  birincil: {
    zemin: renk.vurgu, basiliZemin: renk.vurguBasili, yazi: renk.dolguUstu,
    kapaliZemin: renk.yuzeyUst, kapaliYazi: renk.metinSonuk, yatay: bosluk[4],
  },
  ikincil: {
    zemin: SAYDAM, basiliZemin: renk.basili, yazi: renk.metin, kenar: renk.kenarGuclu,
    kapaliZemin: SAYDAM, kapaliYazi: renk.metinSonuk, kapaliKenar: renk.kenar, yatay: bosluk[4],
  },
  metin: {
    zemin: SAYDAM, basiliZemin: renk.basili, yazi: renk.vurgu,
    kapaliZemin: SAYDAM, kapaliYazi: renk.metinSonuk, yatay: bosluk[3],
  },
  tehlikeli: {
    zemin: renk.hata, basiliZemin: renk.hataBasili, yazi: renk.dolguUstu,
    kapaliZemin: renk.yuzeyUst, kapaliYazi: renk.metinSonuk, yatay: bosluk[4],
  },
  tehlikeliMetin: {
    zemin: SAYDAM, basiliZemin: renk.basili, yazi: renk.hata,
    kapaliZemin: SAYDAM, kapaliYazi: renk.metinSonuk, yatay: bosluk[3],
  },
};

export interface DugmeOzellikleri {
  yazi: string;
  basinca: () => void;
  /** Görsel tür. Verilmezse `ikincil` bayrağına göre birincil/ikincil. */
  tur?: DugmeTuru;
  /** Eski kısa yol: `tur="ikincil"` ile aynı. `tur` verilmişse yok sayılır. */
  ikincil?: boolean;
  kapali?: boolean;
  /** Satırda eşit genişlik (flex: 1). */
  esnek?: boolean;
  accessibilityLabel?: string;
}

export function Dugme(p: DugmeOzellikleri): ReactNode {
  const tur: DugmeTuru = p.tur ?? (p.ikincil ? "ikincil" : "birincil");
  const t = turler[tur];
  const kapali = p.kapali === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      accessibilityState={{ disabled: kapali }}
      disabled={kapali}
      onPress={p.basinca}
      style={({ pressed }): ViewStyle => ({
        minHeight: olcu.dokunma,
        paddingHorizontal: t.yatay,
        borderRadius: yaricap.orta,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: kapali ? t.kapaliZemin : pressed ? t.basiliZemin : t.zemin,
        borderWidth: t.kenar ? cizgi.normal : 0,
        borderColor: kapali ? t.kapaliKenar : t.kenar,
        ...(p.esnek ? { flex: 1 } : null),
      })}
    >
      <Text
        maxFontSizeMultiplier={1.4}
        style={[yazi.govdeKalin, { color: kapali ? t.kapaliYazi : t.yazi, textAlign: "center" }]}
      >
        {p.yazi}
      </Text>
    </Pressable>
  );
}

/** Güvenilmez metin: düz `Text`, bağlantı ya da markdown işlenmez. */
export function Duz(p: {
  metin: string;
  /** Yazı ölçeği jetonu; varsayılan `govde`. */
  boyut?: "govde" | "govdeKalin" | "kucuk" | "kucukKalin" | "mini" | "kod";
  /** Metin rengi jetonu; varsayılan `metin` (`kod` için `metinIkincil`). */
  renk?: RenkAdi;
}): ReactNode {
  const boyut = p.boyut ?? "govde";
  const r = p.renk ?? (boyut === "kod" ? "metinIkincil" : "metin");
  return (
    <Text style={[yazi[boyut], { color: renk[r] }]} selectable>
      {p.metin}
    </Text>
  );
}

const durumRenkleri: Record<DurumRengi, { yazi: string; zemin: string; kenar: string }> = {
  basari: { yazi: renk.basari, zemin: renk.basariZemin, kenar: renk.basariKenar },
  uyari: { yazi: renk.uyari, zemin: renk.uyariZemin, kenar: renk.uyariKenar },
  hata: { yazi: renk.hata, zemin: renk.hataZemin, kenar: renk.hataKenar },
  bilgi: { yazi: renk.bilgi, zemin: renk.bilgiZemin, kenar: renk.bilgiKenar },
};

/** Durum noktası + metin (6.7). `renkAdi` jeton adı; nokta ve metin aynı renkte. */
export function DurumEtiketi(p: { metin: string; renkAdi: RenkAdi }): ReactNode {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: bosluk[2] }}>
      <View
        style={{ width: olcu.nokta, height: olcu.nokta, borderRadius: yaricap.tam, backgroundColor: renk[p.renkAdi] }}
      />
      <Text style={[yazi.kucuk, { color: renk[p.renkAdi] }]}>{p.metin}</Text>
    </View>
  );
}

/** Satır içi şerit (6.6): uyarı, hata ya da bilgi kutusu. */
export function Serit(p: { tur: Exclude<DurumRengi, "basari"> | "basari"; metin: string }): ReactNode {
  const d = durumRenkleri[p.tur];
  const stil: ViewStyle = {
    backgroundColor: d.zemin,
    borderColor: d.kenar,
    borderWidth: cizgi.normal,
    borderRadius: yaricap.kucuk,
    padding: bosluk[3],
  };
  const metin: TextStyle = { ...yazi.kucuk, color: d.yazi };
  return (
    <View style={stil}>
      <Text style={metin} selectable>
        {p.metin}
      </Text>
    </View>
  );
}

/** Kart kabı (6.7). `bekliyor` true ise kenar `vurgu`: "senden bir şey bekleniyor". */
export function KartKabi(p: { bekliyor?: boolean; children?: ReactNode }): ReactNode {
  return (
    <View
      style={{
        backgroundColor: renk.yuzey,
        borderColor: p.bekliyor ? renk.vurgu : renk.kenar,
        borderWidth: cizgi.normal,
        borderRadius: yaricap.orta,
        padding: bosluk[4],
        gap: bosluk[2],
      }}
    >
      {p.children}
    </View>
  );
}

/** Kart içi bölüm adı: `kucukKalin`, `metinIkincil`, cümle düzeni. */
export function BolumAdi(p: { metin: string }): ReactNode {
  return <Text style={[yazi.kucukKalin, { color: renk.metinIkincil }]}>{p.metin}</Text>;
}
