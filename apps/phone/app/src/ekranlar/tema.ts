// Görsel tasarım dilinin jetonları. Kaynak: docs/TASARIM.md (bölüm 2-7, 12.1).
// Bu dosya yalnız jeton taşır; bileşen içermez. Ekranlarda ham hex yazılmaz.
import { StyleSheet } from "react-native";
import type { TextStyle } from "react-native";

// ---------------------------------------------------------------- Renk (bölüm 2.2)

const yeniRenk = {
  zemin: "#101A1E",
  yuzey: "#1D2A2F",
  yuzeyUst: "#26353B",
  secili: "#283C43",
  basili: "#324349",
  kenar: "#35454B",
  kenarGuclu: "#687F87",
  metin: "#EFEAE1",
  metinIkincil: "#AFBEC0",
  metinSonuk: "#97A7AA",
  vurgu: "#EDE0A1",
  vurguBasili: "#D5C37B",
  vurguSecim: "rgba(237, 224, 161, 0.35)",
  dolguUstu: "#101A1E",
  kullaniciBalon: "#2B4455",
  asistanBalon: "#1D2A2F",
  basari: "#9ED1B1",
  basariZemin: "#1C3026",
  basariKenar: "#3C6752",
  uyari: "#F2AC7D",
  uyariZemin: "#332519",
  uyariKenar: "#6D4E36",
  hata: "#F4A4AA",
  hataZemin: "#321B1E",
  hataKenar: "#6A3940",
  hataBasili: "#DA8B90",
  bilgi: "#ACD0EC",
  bilgiZemin: "#192733",
  bilgiKenar: "#36536D",
  perde: "rgba(6, 12, 14, 0.72)",
} as const;

export const renk = yeniRenk;

export type RenkAdi = keyof typeof yeniRenk;
export type DurumRengi = "basari" | "uyari" | "hata" | "bilgi";

// ---------------------------------------------------------------- Yazı (bölüm 3)

export type YaziAdi =
  | "buyuk"
  | "baslik"
  | "govde"
  | "govdeKalin"
  | "kucuk"
  | "kucukKalin"
  | "mini"
  | "miniKalin"
  | "kod";

function yaziStili(fontSize: number, lineHeight: number, fontWeight: "400" | "600"): TextStyle {
  return { fontSize, lineHeight, fontWeight, includeFontPadding: false };
}

/** fontSize, lineHeight, fontWeight, includeFontPadding; `kod` ayrıca fontFamily. Renk yok. */
export const yazi: Readonly<Record<YaziAdi, TextStyle>> = {
  buyuk: yaziStili(22, 28, "600"),
  baslik: yaziStili(18, 24, "600"),
  govde: yaziStili(16, 24, "400"),
  govdeKalin: yaziStili(16, 24, "600"),
  kucuk: yaziStili(14, 20, "400"),
  kucukKalin: yaziStili(14, 20, "600"),
  mini: yaziStili(12, 16, "400"),
  miniKalin: yaziStili(12, 16, "600"),
  kod: { ...yaziStili(14, 20, "400"), fontFamily: "monospace" },
};

// ---------------------------------------------------------------- Boşluk, köşe, kenar (bölüm 4)

export const bosluk = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;
export const yaricap = { kucuk: 8, orta: 12, buyuk: 18, tam: 999 } as const;
export const cizgi = { ince: StyleSheet.hairlineWidth, normal: 1, kalin: 2 } as const;

// ---------------------------------------------------------------- Ölçüler, süreler, eşikler

export const olcu = {
  dokunma: 48,
  ustCubuk: 56,
  hat: 2,
  girdiEnAz: 48,
  girdiEnCok: 140,
  eylemYuvasi: 88,
  balonKullanici: "82%",
  balonAsistan: "88%",
  cekmeceOran: 0.85,
  cekmeceEnCok: 340,
  diyalogEnCok: 400,
  nokta: 8,
  rozet: 20,
  altaInDaire: 44,
  altaInHap: 40,
} as const;

/** Milisaniye (bölüm 7). */
export const sure = {
  hizli: 150,
  orta: 220,
  hat: 1400,
  nokta: 1200,
  tehlikeKilidi: 600,
  seritGecikme: 3000,
  yukleniyorGecikme: 300,
} as const;

export const esik = {
  altaInGoster: 240,
  altaInGizle: 80,
  zamanAyraciDk: 30,
  adUzunlugu: 60,
  otomatikAd: 40,
  okunmamisEnCok: 99,
} as const;

// ---------------------------------------------------------------- Ortak düzen

export const stil = StyleSheet.create({
  ekran: { flex: 1, backgroundColor: yeniRenk.zemin },
  satir: { flexDirection: "row", gap: bosluk[2], alignItems: "center" },
  ayrac: { height: cizgi.ince, backgroundColor: yeniRenk.kenar },

});
