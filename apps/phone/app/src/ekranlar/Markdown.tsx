// Asistan cevaplarındaki markdown'ı RN bileşenlerine çeviren görünüm.
// Ayrıştırma markdown.ts'te yapılır; burada yalnız çizim var. Renkler tema.ts jetonlarından.
import React, { memo, useMemo } from "react";
import type { ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TextStyle } from "react-native";
import { markdownAyristir } from "./markdown";
import type { Blok, SatirIci } from "./markdown";
import { bosluk, cizgi, renk, yaricap, yazi } from "./tema";

const GUVENLI_SEMA = /^https?:\/\/\S/i;
const TABLO_SUTUN_GENISLIGI = 140;

function baglantiAc(adres: string): void {
  if (!GUVENLI_SEMA.test(adres)) return;
  try {
    Linking.openURL(adres).catch(() => undefined);
  } catch {
    // açılamayan adres sessizce yok sayılır
  }
}

function adresHost(adres: string): string {
  const m = /^[a-z]+:\/\/([^/?#]*)/i.exec(adres.trim());
  const h = m === null ? "" : m[1];
  if (h.includes("@") || h.includes("\\")) return "";
  return h.replace(/:\d*$/, "").toLowerCase();
}

// markdown.ts ile aynı kural: boş, \ ya da @ içeren, ASCII dışı host bağlantı sayılmaz.
function hostGecerli(host: string): boolean {
  return /^[a-z0-9.\-[\]:]+$/.test(host) && /[a-z0-9]/.test(host);
}

function hostKarsilastir(h: string): string {
  return h.replace(/:\d*$/, "").replace(/^www\./, "");
}

// Bağlantı yazısı hedefin kendisini gösteriyorsa true (parantez gerekmez).
function yaziHedefMi(yazi: string, hedefHost: string): boolean {
  const t = yazi.trim();
  const etiketHost = /^[a-z]+:\/\//i.test(t) ? adresHost(t) : t.split(/[/?#]/)[0].toLowerCase();
  return hostKarsilastir(etiketHost) === hostKarsilastir(hedefHost);
}

function satirIciCiz(parcalar: readonly SatirIci[], anahtar: string): ReactNode[] {
  return parcalar.map((p, i) => {
    const k = `${anahtar}.${i}`;
    switch (p.tur) {
      case "metin":
        return p.metin;
      case "kalin":
        return (
          <Text key={k} style={stil.kalin}>
            {satirIciCiz(p.parcalar, k)}
          </Text>
        );
      case "italik":
        return (
          <Text key={k} style={stil.italik}>
            {satirIciCiz(p.parcalar, k)}
          </Text>
        );
      case "kod":
        return (
          <Text key={k} style={stil.satirKod}>
            {p.metin}
          </Text>
        );
      case "baglanti": {
        const host = adresHost(p.adres);
        if (!hostGecerli(host)) return p.metin;
        const goster = host !== "" && !yaziHedefMi(p.metin, host);
        return (
          <Text key={k}>
            <Text
              style={stil.baglanti}
              onPress={() => baglantiAc(p.adres)}
              accessibilityRole="link"
            >
              {p.metin}
            </Text>
            {goster ? <Text style={stil.baglantiHost}>{` (${host})`}</Text> : null}
          </Text>
        );
      }
    }
  });
}

function blokCiz(blok: Blok, i: number): ReactNode {
  const k = `b${i}`;
  switch (blok.tur) {
    case "paragraf":
      return (
        <Text key={k} selectable style={stil.paragraf}>
          {satirIciCiz(blok.parcalar, k)}
        </Text>
      );
    case "baslik": {
      const s: TextStyle =
        blok.duzey === 1 ? stil.baslik1 : blok.duzey === 2 ? stil.baslik2 : stil.baslik3;
      return (
        <Text key={k} selectable accessibilityRole="header" style={s}>
          {satirIciCiz(blok.parcalar, k)}
        </Text>
      );
    }
    case "liste":
      return (
        <View key={k} style={stil.liste}>
          {blok.ogeler.map((oge, j) => (
            <View key={`${k}.${j}`} style={stil.madde}>
              <Text style={stil.isaret}>
                {blok.sirali ? `${blok.baslangic + j}.` : "•"}
              </Text>
              <Text selectable style={stil.maddeMetni}>
                {satirIciCiz(oge, `${k}.${j}`)}
              </Text>
            </View>
          ))}
        </View>
      );
    case "kodBlogu":
      return (
        <ScrollView
          key={k}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={stil.kodKap}
          contentContainerStyle={stil.kodIc}
        >
          <Text selectable style={stil.kodMetni}>
            {blok.metin}
          </Text>
        </ScrollView>
      );
    case "alinti":
      return (
        <View key={k} style={stil.alinti}>
          <Text selectable style={stil.alintiMetni}>
            {satirIciCiz(blok.parcalar, k)}
          </Text>
        </View>
      );
    case "ayrac":
      return <View key={k} style={stil.ayrac} />;
    case "tablo":
      return (
        <ScrollView
          key={k}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={stil.tabloKap}
        >
          <View style={stil.tablo}>
            <View style={[stil.tabloSatir, stil.tabloBaslikSatiri]}>
              {blok.basliklar.map((h, c) => (
                <View key={`${k}.h${c}`} style={stil.hucre}>
                  <Text selectable style={stil.hucreBaslik}>
                    {satirIciCiz(h, `${k}.h${c}`)}
                  </Text>
                </View>
              ))}
            </View>
            {blok.satirlar.map((satir, r) => (
              <View
                key={`${k}.r${r}`}
                style={[stil.tabloSatir, r === blok.satirlar.length - 1 && stil.sonSatir]}
              >
                {satir.map((h, c) => (
                  <View key={`${k}.r${r}.${c}`} style={stil.hucre}>
                    <Text selectable style={stil.hucreMetin}>
                      {satirIciCiz(h, `${k}.r${r}.${c}`)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
  }
}

type Ozellikler = { metin: string };

function MarkdownGovde({ metin }: Ozellikler): React.JSX.Element {
  const bloklar = useMemo(() => markdownAyristir(metin), [metin]);
  return <View style={stil.kap}>{bloklar.map(blokCiz)}</View>;
}

export const Markdown = memo(MarkdownGovde);
export default Markdown;

const stil = StyleSheet.create({
  kap: { gap: bosluk[3], alignSelf: "stretch" },
  paragraf: { ...yazi.govde, color: renk.metin },
  baslik1: { ...yazi.baslik, color: renk.metin },
  baslik2: { ...yazi.govdeKalin, color: renk.metin },
  baslik3: { ...yazi.kucukKalin, color: renk.metinIkincil },
  kalin: { fontWeight: "600" },
  italik: { fontStyle: "italic" },
  satirKod: {
    fontFamily: "monospace",
    fontSize: 14,
    backgroundColor: renk.yuzeyUst,
    color: renk.metin,
  },
  baglanti: { color: renk.vurgu, textDecorationLine: "underline" },
  baglantiHost: { color: renk.metinSonuk },
  liste: { gap: bosluk[1] },
  madde: { flexDirection: "row", alignItems: "flex-start" },
  isaret: { ...yazi.govde, color: renk.metinIkincil, width: 24 },
  maddeMetni: { ...yazi.govde, color: renk.metin, flex: 1 },
  kodKap: {
    backgroundColor: renk.yuzeyUst,
    borderRadius: yaricap.kucuk,
    flexGrow: 0,
  },
  kodIc: { padding: bosluk[3] },
  kodMetni: { ...yazi.kod, color: renk.metin },
  alinti: {
    borderLeftWidth: cizgi.kalin,
    borderLeftColor: renk.kenarGuclu,
    paddingLeft: bosluk[3],
  },
  alintiMetni: { ...yazi.govde, color: renk.metinIkincil },
  ayrac: { height: cizgi.ince, backgroundColor: renk.kenar },
  tabloKap: { flexGrow: 0 },
  tablo: {
    borderWidth: cizgi.normal,
    borderColor: renk.kenar,
    borderRadius: yaricap.kucuk,
    overflow: "hidden",
  },
  tabloSatir: {
    flexDirection: "row",
    borderBottomWidth: cizgi.normal,
    borderBottomColor: renk.kenar,
  },
  tabloBaslikSatiri: { backgroundColor: renk.yuzeyUst },
  sonSatir: { borderBottomWidth: 0 },
  hucre: {
    width: TABLO_SUTUN_GENISLIGI,
    paddingHorizontal: bosluk[2],
    paddingVertical: bosluk[2],
    borderRightWidth: cizgi.normal,
    borderRightColor: renk.kenar,
  },
  hucreBaslik: { ...yazi.kucukKalin, color: renk.metin },
  hucreMetin: { ...yazi.kucuk, color: renk.metin },
});
