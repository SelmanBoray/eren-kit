// Markdown biçimli asistan cevabını sesli okunacak düz metne çevirir.
// Saf fonksiyon: yan etki yok, içe aktarma yok.

const HARF = String.raw`[\p{L}\p{N}]`;
const CIT = /^\s*(```|~~~)/;
const YATAY_CIZGI = /^([-*_])(\s*\1){2,}$/;
const TABLO_AYIRICI = /^[\s|:-]*-[\s|:-]*$/;

function satirIci(satir: string): string {
  // Satır içi kod önce korunur; içerik başka kurallardan etkilenmesin.
  const kodlar: string[] = [];
  let s = satir.replace(/`+([^`]*?)`+/g, (_t, icerik: string) => {
    kodlar.push(/^https?:\/\/\S+$/.test(icerik.trim()) ? "bağlantı" : icerik);
    return `\uE000${kodlar.length - 1}\uE001`;
  });
  s = s.replace(/<https?:\/\/[^\s<>]+>/g, "bağlantı");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]]/g, "bağlantı");
  s = s.replace(/~~(?=\S)([^~]+?)~~/g, "$1");
  s = s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1");
  s = s.replace(new RegExp(String.raw`(?<!${HARF})__(?=\S)(.+?)(?<=\S)__(?!${HARF})`, "gu"), "$1");
  s = s.replace(new RegExp(String.raw`(?<!${HARF}|\*)\*(?=\S)([^*]+?)(?<=\S)\*(?!${HARF}|\*)`, "gu"), "$1");
  s = s.replace(new RegExp(String.raw`(?<!${HARF})_(?=\S)([^_]+?)(?<=\S)_(?!${HARF})`, "gu"), "$1");
  return s.replace(/\uE000(\d+)\uE001/g, (_t, i: string) => kodlar[Number(i)] ?? "");
}

export function konusmaMetni(markdown: string): string {
  const satirlar = markdown.replace(/\r\n?/g, "\n").split("\n");
  const cikti: string[] = [];
  let cit: string | null = null;

  for (const ham of satirlar) {
    if (cit !== null) {
      // Kapanış çiti: aynı işaretle başlayan satır.
      if (ham.trim().startsWith(cit)) cit = null;
      continue;
    }
    const acilis = CIT.exec(ham);
    if (acilis) {
      cit = acilis[1] as string;
      cikti.push("kod bloğu");
      continue;
    }

    let s = ham.trim();
    if (s === "" || YATAY_CIZGI.test(s)) continue;

    if (s.includes("|") && (s.startsWith("|") || TABLO_AYIRICI.test(s))) {
      if (TABLO_AYIRICI.test(s)) continue;
      s = s.replace(/^\|/, "").replace(/\|$/, "");
      s = s.split("|").map((h) => h.trim()).join(", ");
    } else {
      s = s.replace(/^(>\s*)+/, "");
      s = s.replace(/^#{1,6}\s+/, "");
      s = s.replace(/^[-*+]\s+/, "");
    }

    s = satirIci(s).replace(/\s+/g, " ").trim();
    if (s !== "") cikti.push(s);
  }

  const sonuc = cikti.map((s, i) =>
    i < cikti.length - 1 && !/[.!?:;,…]$/.test(s) ? `${s}.` : s,
  );
  return sonuc.join(" ").replace(/\s+/g, " ").trim();
}
