// Asistan cevaplarındaki hafif markdown'ı bloklara ayıran saf ayrıştırıcı.
// Bağımlılık yok, atmaz, çıktı yalnız düz nesnelerdir.

export type SatirIci =
  | { tur: "metin"; metin: string }
  | { tur: "kalin"; parcalar: readonly SatirIci[] }
  | { tur: "italik"; parcalar: readonly SatirIci[] }
  | { tur: "kod"; metin: string }
  | { tur: "baglanti"; metin: string; adres: string };

export type Blok =
  | { tur: "paragraf"; parcalar: readonly SatirIci[] }
  | { tur: "baslik"; duzey: 1 | 2 | 3; parcalar: readonly SatirIci[] }
  | { tur: "liste"; sirali: boolean; baslangic: number; ogeler: readonly (readonly SatirIci[])[] }
  | { tur: "kodBlogu"; dil: string | null; metin: string }
  | { tur: "alinti"; parcalar: readonly SatirIci[] }
  | { tur: "ayrac" }
  | {
      tur: "tablo";
      basliklar: readonly (readonly SatirIci[])[];
      satirlar: readonly (readonly (readonly SatirIci[])[])[];
    };

// ---------------------------------------------------------------------------
// Satır içi
// ---------------------------------------------------------------------------

const KACIS_KARAKTERLERI = "`*_{}[]()#+-.!|>~";
const HARF_RAKAM = /[\p{L}\p{N}]/u;
const EN_DERIN = 6;
const ETIKET_SINIRI = 500;
const ADRES_SINIRI = 1000;

const bosluk = (c: string | undefined): boolean =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\u00a0";

const harfRakam = (c: string | undefined): boolean => c !== undefined && HARF_RAKAM.test(c);

type Durum = {
  // n uzunluklu ters tırnak kapanışı bu konumdan sonra yok
  bt: Record<number, number>;
  // "ch+k" vurgu kapanışı bu konumdan sonra yok
  em: Record<string, number>;
  // bu konumdan sonra ']' yok
  kose: number;
};

const YOL_BASI = /^(?:[A-Za-z]:\\|\\\\\S)/;

const kacisVar = (s: string, i: number): boolean => {
  if (i + 1 >= s.length) return false;
  if (KACIS_KARAKTERLERI.indexOf(s[i + 1]) < 0) return false;
  // Windows yolları (C:\dizin\_x, \sunucu\paylaşım) bozulmasın: yol içindeki ters bölü kaçış değildir.
  let b = i;
  const alt = Math.max(0, i - 260);
  while (b > alt && !bosluk(s[b - 1])) b--;
  if (b < i && YOL_BASI.test(s.slice(b, i + 2))) return false;
  return true;
};

const metinEkle = (out: SatirIci[], metin: string): void => {
  if (metin === "") return;
  const son = out[out.length - 1];
  if (son !== undefined && son.tur === "metin") {
    out[out.length - 1] = { tur: "metin", metin: son.metin + metin };
  } else {
    out.push({ tur: "metin", metin });
  }
};

const duzMetin = (parcalar: readonly SatirIci[]): string => {
  let r = "";
  for (const p of parcalar) {
    if (p.tur === "metin" || p.tur === "kod" || p.tur === "baglanti") r += p.metin;
    else r += duzMetin(p.parcalar);
  }
  return r;
};

const kodKapanis = (s: string, from: number, n: number, durum: Durum): number => {
  const hata = durum.bt[n];
  if (hata !== undefined && from >= hata) return -1;
  let j = from;
  for (;;) {
    j = s.indexOf("`", j);
    if (j < 0) break;
    let m = 1;
    while (s.charCodeAt(j + m) === 96) m++;
    if (m === n) return j;
    j += m;
  }
  durum.bt[n] = from;
  return -1;
};

const vurguKapanis = (s: string, from: number, ch: string, k: number, durum: Durum): number => {
  const anahtar = ch + k;
  const hata = durum.em[anahtar];
  if (hata !== undefined && from >= hata) return -1;
  const len = s.length;
  const kod = ch.charCodeAt(0);
  let i = from;
  while (i < len) {
    const c = s.charCodeAt(i);
    if (c === 92 && kacisVar(s, i)) {
      i += 2;
      continue;
    }
    if (c === 96) {
      let n = 1;
      while (s.charCodeAt(i + n) === 96) n++;
      const j = kodKapanis(s, i + n, n, durum);
      i = j >= 0 ? j + n : i + n;
      continue;
    }
    if (c === kod) {
      let l = 1;
      while (s.charCodeAt(i + l) === kod) l++;
      const onceki = s[i - 1];
      const sonraki = s[i + l];
      const tamam =
        onceki !== undefined && !bosluk(onceki) && (ch !== "_" || !harfRakam(sonraki));
      if (tamam && l === k) return i;
      i += l;
      continue;
    }
    i++;
  }
  durum.em[anahtar] = from;
  return -1;
};

// Katı biçim: http(s):// + ASCII alan adı (@, \, boşluk yok) + isteğe bağlı :port + / ? # ya da son.
// Adresin hiçbir yerinde ters bölü ya da denetim karakteri olamaz.
const ADRES_BICIMI = /^https?:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*)(?::[0-9]{1,5})?(?:[/?#]|$)/i;
const guvenliAdres = (adres: string): boolean =>
  adres.indexOf("\\") < 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(adres) && ADRES_BICIMI.test(adres);

const baglantiDene = (
  s: string,
  i: number,
  durum: Durum,
  derinlik: number,
): { dugum: SatirIci; son: number } | null => {
  if (i >= durum.kose) return null;
  const len = s.length;
  // eşleşen ']' bul
  let derin = 1;
  let j = i + 1;
  const ust = Math.min(len, i + 1 + ETIKET_SINIRI);
  let kapanis = -1;
  while (j < ust) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < len) {
      j += 2;
      continue;
    }
    if (c === 91) derin++;
    else if (c === 93) {
      derin--;
      if (derin === 0) {
        kapanis = j;
        break;
      }
    }
    j++;
  }
  if (kapanis < 0) {
    if (ust >= len) durum.kose = i;
    return null;
  }
  if (s.charCodeAt(kapanis + 1) !== 40) return null;
  // adres: boşluksuz, dengeli parantez
  let d = 1;
  let k = kapanis + 2;
  const adresUst = Math.min(len, k + ADRES_SINIRI);
  let adresSon = -1;
  while (k < adresUst) {
    const c = s.charCodeAt(k);
    if (c <= 32) return null;
    if (c === 40) d++;
    else if (c === 41) {
      d--;
      if (d === 0) {
        adresSon = k;
        break;
      }
    }
    k++;
  }
  if (adresSon < 0) return null;
  const adres = s.slice(kapanis + 2, adresSon);
  if (!guvenliAdres(adres)) return null;
  const etiket = duzMetin(satirIci(s.slice(i + 1, kapanis), derinlik + 1));
  return {
    dugum: { tur: "baglanti", metin: etiket === "" ? adres : etiket, adres },
    son: adresSon + 1,
  };
};

const satirIci = (s: string, derinlik: number): SatirIci[] => {
  const out: SatirIci[] = [];
  if (s === "") return out;
  if (derinlik > EN_DERIN) {
    out.push({ tur: "metin", metin: s });
    return out;
  }
  const durum: Durum = { bt: {}, em: {}, kose: Infinity };
  const len = s.length;
  let tb = "";
  let ts = 0;
  let i = 0;
  const bosalt = (): void => {
    metinEkle(out, tb);
    tb = "";
  };

  while (i < len) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (kacisVar(s, i)) {
        tb += s.slice(ts, i) + s[i + 1];
        i += 2;
        ts = i;
      } else {
        i++;
      }
    } else if (c === 96) {
      let n = 1;
      while (s.charCodeAt(i + n) === 96) n++;
      const j = kodKapanis(s, i + n, n, durum);
      if (j < 0) {
        i += n;
      } else {
        tb += s.slice(ts, i);
        bosalt();
        let icerik = s.slice(i + n, j);
        if (
          icerik.length > 2 &&
          icerik[0] === " " &&
          icerik[icerik.length - 1] === " " &&
          icerik.trim() !== ""
        ) {
          icerik = icerik.slice(1, -1);
        }
        out.push({ tur: "kod", metin: icerik });
        i = j + n;
        ts = i;
      }
    } else if (c === 42 || c === 95) {
      let n = 1;
      while (s.charCodeAt(i + n) === c) n++;
      const ch = c === 42 ? "*" : "_";
      const onceki = i > 0 ? s[i - 1] : undefined;
      const sonraki = s[i + n];
      const acilis =
        n <= 3 &&
        sonraki !== undefined &&
        !bosluk(sonraki) &&
        !harfRakam(onceki);
      if (acilis) {
        const kapanis = vurguKapanis(s, i + n, ch, n, durum);
        if (kapanis > i + n) {
          tb += s.slice(ts, i);
          bosalt();
          const ic = satirIci(s.slice(i + n, kapanis), derinlik + 1);
          if (n === 1) out.push({ tur: "italik", parcalar: ic });
          else if (n === 2) out.push({ tur: "kalin", parcalar: ic });
          else out.push({ tur: "kalin", parcalar: [{ tur: "italik", parcalar: ic }] });
          i = kapanis + n;
          ts = i;
          continue;
        }
      }
      i += n;
    } else if (c === 91) {
      const l = baglantiDene(s, i, durum, derinlik);
      if (l !== null) {
        tb += s.slice(ts, i);
        bosalt();
        out.push(l.dugum);
        i = l.son;
        ts = i;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  tb += s.slice(ts);
  bosalt();
  return out;
};

// ---------------------------------------------------------------------------
// Bloklar
// ---------------------------------------------------------------------------

const RE_BOS = /^\s*$/;
const RE_CIT_AC = /^(\s*)(`{3,})([^`]*)$/;
const RE_CIT_KAPAT = /^\s*(`{3,})\s*$/;
const RE_BASLIK = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const RE_AYRAC = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
const RE_MADDE = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const RE_SIRALI = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;
const RE_ALINTI = /^ {0,3}> ?/;
const RE_AYIRICI = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const girinti = (s: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === " ") n++;
    else if (c === "\t") n += 4;
    else break;
  }
  return n;
};

type Madde = { girinti: number; sirali: boolean; sayi: number; metin: string };

const maddeMi = (satir: string): Madde | null => {
  let m = RE_MADDE.exec(satir);
  if (m !== null) return { girinti: girinti(m[1]), sirali: false, sayi: 1, metin: m[3] };
  m = RE_SIRALI.exec(satir);
  if (m !== null) return { girinti: girinti(m[1]), sirali: true, sayi: parseInt(m[2], 10), metin: m[3] };
  return null;
};

const hucreler = (satir: string): string[] => {
  let s = satir.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const r: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      r.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  r.push(cur.trim());
  return r;
};

const tabloBasliMi = (satir: string, sonraki: string | undefined): boolean => {
  if (sonraki === undefined) return false;
  if (satir.indexOf("|") < 0 || sonraki.indexOf("|") < 0) return false;
  if (!RE_AYIRICI.test(sonraki)) return false;
  return hucreler(satir).length === hucreler(sonraki).length;
};

// Paragrafı kesen bir blok başlıyor mu
const paragrafiKeser = (satir: string, sonraki: string | undefined): boolean => {
  if (RE_BOS.test(satir)) return true;
  if (RE_CIT_AC.test(satir)) return true;
  if (RE_BASLIK.test(satir)) return true;
  if (RE_AYRAC.test(satir)) return true;
  if (RE_ALINTI.test(satir)) return true;
  const m = maddeMi(satir);
  if (m !== null && (!m.sirali || m.sayi === 1)) return true;
  if (tabloBasliMi(satir, sonraki)) return true;
  return false;
};

const ayristir = (metin: string): Blok[] => {
  const lines = metin.replace(/\r\n?/g, "\n").split("\n");
  const n = lines.length;
  const bloklar: Blok[] = [];
  let i = 0;

  while (i < n) {
    const satir = lines[i];
    if (RE_BOS.test(satir)) {
      i++;
      continue;
    }

    // kod bloğu
    const cit = RE_CIT_AC.exec(satir);
    if (cit !== null) {
      const uzunluk = cit[2].length;
      const ic = cit[1].length;
      const dil = cit[3].trim().split(/\s+/)[0] || null;
      const govde: string[] = [];
      i++;
      while (i < n) {
        const k = RE_CIT_KAPAT.exec(lines[i]);
        if (k !== null && k[1].length >= uzunluk) {
          i++;
          break;
        }
        let l = lines[i];
        let kes = 0;
        while (kes < ic && kes < l.length && (l[kes] === " " || l[kes] === "\t")) kes++;
        l = l.slice(kes);
        govde.push(l);
        i++;
      }
      bloklar.push({ tur: "kodBlogu", dil, metin: govde.join("\n") });
      continue;
    }

    // başlık
    const b = RE_BASLIK.exec(satir);
    if (b !== null) {
      const duzey = Math.min(b[1].length, 3) as 1 | 2 | 3;
      const icerik = b[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
      bloklar.push({ tur: "baslik", duzey, parcalar: satirIci(icerik, 0) });
      i++;
      continue;
    }

    // ayraç
    if (RE_AYRAC.test(satir)) {
      bloklar.push({ tur: "ayrac" });
      i++;
      continue;
    }

    // tablo
    if (tabloBasliMi(satir, lines[i + 1])) {
      const basliklar = hucreler(satir);
      const sut = basliklar.length;
      i += 2;
      const satirlar: (readonly SatirIci[])[][] = [];
      while (i < n) {
        const l = lines[i];
        if (RE_BOS.test(l) || l.indexOf("|") < 0 || RE_CIT_AC.test(l)) break;
        const h = hucreler(l);
        while (h.length < sut) h.push("");
        if (h.length > sut) h.length = sut;
        satirlar.push(h.map((x) => satirIci(x, 0)));
        i++;
      }
      bloklar.push({
        tur: "tablo",
        basliklar: basliklar.map((x) => satirIci(x, 0)),
        satirlar,
      });
      continue;
    }

    // alıntı
    if (RE_ALINTI.test(satir)) {
      const parca: string[] = [];
      while (i < n && RE_ALINTI.test(lines[i])) {
        parca.push(lines[i].replace(RE_ALINTI, "").trimEnd());
        i++;
      }
      bloklar.push({
        tur: "alinti",
        parcalar: satirIci(parca.join("\n").replace(/^\n+|\n+$/g, "").trimStart(), 0),
      });
      continue;
    }

    // liste
    const ilk = maddeMi(satir);
    if (ilk !== null) {
      const sirali = ilk.sirali;
      const temel = ilk.girinti;
      const ham: string[] = [ilk.metin];
      i++;
      while (i < n) {
        const l = lines[i];
        if (RE_BOS.test(l)) {
          let j = i + 1;
          while (j < n && RE_BOS.test(lines[j])) j++;
          if (j >= n) break;
          const sonraki = lines[j];
          const m = RE_AYRAC.test(sonraki) ? null : maddeMi(sonraki);
          if (m !== null && (m.sirali === sirali || m.girinti > temel)) {
            i = j;
            continue;
          }
          break;
        }
        if (RE_AYRAC.test(l)) break;
        const m = maddeMi(l);
        if (m !== null) {
          if (m.sirali !== sirali && m.girinti <= temel) break;
          ham.push(m.metin);
          i++;
          continue;
        }
        if (
          girinti(l) >= 2 &&
          !RE_CIT_AC.test(l) &&
          !RE_BASLIK.test(l) &&
          !RE_ALINTI.test(l)
        ) {
          ham[ham.length - 1] += "\n" + l.trim();
          i++;
          continue;
        }
        break;
      }
      bloklar.push({
        tur: "liste",
        sirali,
        baslangic: sirali ? ilk.sayi : 1,
        ogeler: ham.map((x) => satirIci(x.trim(), 0)),
      });
      continue;
    }

    // paragraf
    const parca: string[] = [satir.trim()];
    i++;
    while (i < n && !paragrafiKeser(lines[i], lines[i + 1])) {
      parca.push(lines[i].trim());
      i++;
    }
    bloklar.push({ tur: "paragraf", parcalar: satirIci(parca.join("\n"), 0) });
  }

  return bloklar;
};

export const markdownAyristir = (metin: string): readonly Blok[] => {
  if (typeof metin !== "string" || metin === "") return [];
  try {
    return ayristir(metin);
  } catch {
    return [{ tur: "paragraf", parcalar: [{ tur: "metin", metin }] }];
  }
};
