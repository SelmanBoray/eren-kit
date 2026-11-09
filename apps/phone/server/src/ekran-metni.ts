import { cmdSonucuMetni, gorunmezBirimMi } from "@eren/protocol";
import type { EkranMetniKurucu } from "./sozlesme.ts";

const EN_COK_DENEME = 16;

// Kaçışlı çıktıda kalmış görünmez birimi (U+061C dahil, P2) son geçişte \uXXXX yapar; satır sonuna dokunmaz.
function sonGecis(metin: string): string {
  let cikti = "";
  for (let i = 0; i < metin.length; i++) {
    const birim = metin.charCodeAt(i);
    cikti += gorunmezBirimMi(birim) ? "\\u" + birim.toString(16).padStart(4, "0") : metin.charAt(i);
  }
  return cikti;
}

/**
 * Kırpma ve kaçış `cmdSonucuMetni`de yapılır (P3, P5). Yalnız `elements` çıktısı `<<<EKRAN` çitine
 * girer; başlık satırları çitsizdir. Resim metne girmez, ayrı içerik olarak köprüde eklenir.
 */
export const ekranMetniKur: EkranMetniKurucu = (sonuc, rastgele) => {
  const metin = sonGecis(cmdSonucuMetni(sonuc));
  if (sonuc.payload?.kind !== "elements") return metin;
  for (let deneme = 0; deneme < EN_COK_DENEME; deneme++) {
    const kimlik = rastgele.hex64();
    if (!metin.includes(kimlik)) {
      return `<<<EKRAN ${kimlik}\n${metin}\n>>>EKRAN ${kimlik}`;
    }
  }
  throw new Error("cit_kimligi_uretilemedi");
};
