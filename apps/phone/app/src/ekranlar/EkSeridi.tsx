// Giriş çubuğunun üstündeki ek şeridi ve "Ek ekle" alt sayfası (app/TASARIM.md "Medya", U5b).
// Şerit: seçilmiş ama henüz gönderilmemiş `SeciliEk`'ler; küçük resim, videoda süre ve boyut, "x" ile çıkar.
import { memo, useState } from "react";
import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import type { MedyaKaynagi, SeciliEk } from "../cekirdek/index.ts";
import { AltSayfa } from "./AltSayfa.tsx";
import { Simge } from "./Ikonlar.tsx";
import type { IkonAdi } from "./Ikonlar.tsx";
import {
  EK_KALDIR_ETIKETI,
  EK_SECENEKLERI,
  EK_SECENEKLERI_BASLIGI,
  ekSeritiEtiketi,
  seritVideoMetni,
} from "./medyaMetni.ts";
import { bosluk, cizgi, olcu, renk, yaricap, yazi } from "./tema.ts";

const KARO = 64;
const KALDIR_DAIRE = 22;

const KAYNAK_SIMGESI: Record<MedyaKaynagi, IkonAdi> = {
  galeri: "atac",
  foto_cek: "kamera",
  video_cek: "video",
};

/** Şeritteki tek ek. Video karosunda küçük resim çizilemezse yer tutucu (oynat simgesi) görünür. */
const EkKarosu = memo(function EkKarosu(p: {
  ek: SeciliEk;
  sira: number;
  toplam: number;
  kapali: boolean;
  onKaldir: (uri: string) => void;
}): ReactNode {
  const { ek } = p;
  const video = ek.tur === "video";
  const [gorselYok, setGorselYok] = useState(false);
  const etiket = ekSeritiEtiketi(ek.tur, p.sira, p.toplam, ek.sure_ms);
  return (
    <View style={{ width: KARO, height: KARO }}>
      <View
        accessible
        accessibilityLabel={etiket}
        style={{
          width: KARO,
          height: KARO,
          borderRadius: yaricap.kucuk,
          overflow: "hidden",
          backgroundColor: renk.yuzeyUst,
          borderWidth: cizgi.ince,
          borderColor: renk.kenar,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {video && <Simge ad="oynat" boyut={20} renk={renk.metinIkincil} />}
        {!gorselYok && (
          <Image
            source={{ uri: ek.uri }}
            resizeMode="cover"
            onError={() => setGorselYok(true)}
            style={{ position: "absolute", top: 0, left: 0, width: KARO, height: KARO }}
          />
        )}
        {video && (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: bosluk[1],
              backgroundColor: renk.perde,
            }}
          >
            <Text numberOfLines={1} style={[yazi.mini, { color: renk.metin, textAlign: "center" }]}>
              {seritVideoMetni(ek.sure_ms, ek.boyut)}
            </Text>
          </View>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${EK_KALDIR_ETIKETI}: ${etiket}`}
        accessibilityState={{ disabled: p.kapali }}
        disabled={p.kapali}
        onPress={() => p.onKaldir(ek.uri)}
        hitSlop={13}
        style={({ pressed }) => ({
          position: "absolute",
          top: -6,
          right: -6,
          width: KALDIR_DAIRE,
          height: KALDIR_DAIRE,
          borderRadius: yaricap.tam,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? renk.basili : renk.yuzeyUst,
          borderWidth: cizgi.normal,
          borderColor: renk.kenarGuclu,
        })}
      >
        <Simge ad="kapat" boyut={12} renk={p.kapali ? renk.metinSonuk : renk.metin} />
      </Pressable>
    </View>
  );
});

/**
 * Seçili ekler; boşken hiçbir şey çizmez. `kapali`: gönderim sürüyor (hazırlama), ek kaldırılamaz.
 */
export function EkSeridi(p: { ekler: readonly SeciliEk[]; kapali: boolean; onKaldir: (uri: string) => void }): ReactNode {
  if (p.ekler.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        paddingHorizontal: bosluk[4],
        paddingTop: bosluk[3],
        paddingBottom: bosluk[2],
        gap: bosluk[3],
      }}
    >
      {p.ekler.map((e, i) => (
        <EkKarosu key={e.uri} ek={e} sira={i + 1} toplam={p.ekler.length} kapali={p.kapali} onKaldir={p.onKaldir} />
      ))}
    </ScrollView>
  );
}

/** "Ek ekle" alt sayfası: üç kaynak (`EK_SECENEKLERI`), her satırda simge. */
export function EkSecenekleri(p: { acik: boolean; onKapat: () => void; onSec: (k: MedyaKaynagi) => void }): ReactNode {
  return (
    <AltSayfa acik={p.acik} onKapat={p.onKapat} baslik={EK_SECENEKLERI_BASLIGI}>
      {EK_SECENEKLERI.map((s) => (
        <Pressable
          key={s.kaynak}
          accessibilityRole="button"
          onPress={() => p.onSec(s.kaynak)}
          style={({ pressed }) => ({
            minHeight: 52,
            paddingHorizontal: bosluk[4],
            paddingVertical: bosluk[2],
            flexDirection: "row",
            alignItems: "center",
            gap: bosluk[3],
            backgroundColor: pressed ? renk.basili : "transparent",
          })}
        >
          <Simge ad={KAYNAK_SIMGESI[s.kaynak]} boyut={24} renk={renk.metinIkincil} />
          <Text style={[yazi.govde, { color: renk.metin }]}>{s.metin}</Text>
        </Pressable>
      ))}
    </AltSayfa>
  );
}

/**
 * Giriş çubuğunun solundaki ek düğmesi (ataç). `kapali` iken de basılabilir: basınca çağıran nedeni
 * not satırında söyler; ekran okuyucu nedeni ipucu olarak duyar.
 */
export function EkDugmesi(p: { etiket: string; kapali: boolean; neden?: string; basinca: () => void }): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      // `accessibilityState.disabled` verilmez: TalkBack kapalı düğmeye dokundurmaz, neden duyulmazdı.
      accessibilityLabel={p.kapali ? `${p.etiket}, kapalı` : p.etiket}
      accessibilityHint={p.kapali ? p.neden : undefined}
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
      <Simge ad="atac" boyut={24} renk={p.kapali ? renk.metinSonuk : renk.metinIkincil} />
    </Pressable>
  );
}
