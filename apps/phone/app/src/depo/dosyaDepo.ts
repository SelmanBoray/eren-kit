import { Directory, File, Paths } from "expo-file-system";
import type { DepoPortu } from "../cekirdek/sozlesme.ts";

// Anahtar dosya adına güvenli çevrilir (yol ayracı, nokta, büyük/küçük harf duyarsızlığı yok).
const dosyaAdi = (anahtar: string): string =>
  anahtar.replace(/[^a-z0-9_-]/g, (c) => `~${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

// Kurtarma kararı (saf): move({overwrite}) hedefi silip sonra yeniden adlandırır; araya ölüm girerse
// ana dosya yoktur. Tam yazılmış geçici dosya ancak "tamam" işareti de varsa ana dosya yapılır;
// işaretsiz geçici dosya yarım yazım olabilir, yok sayılır.
export const kurtarmaKarari = (anaVar: boolean, tmpVar: boolean, isaretVar: boolean): "ana" | "kurtar" | "yok" =>
  anaVar ? "ana" : tmpVar && isaretVar ? "kurtar" : "yok";

export const dosyaDepoKur = (klasorAdi = "eren-depo"): DepoPortu => {
  const klasor = new Directory(Paths.document, klasorAdi);
  // Aynı anahtara yazımlar sırayla yürür; biri bozulursa ötekini bozmaz.
  const sira = new Map<string, Promise<unknown>>();

  const hazirla = (): void => {
    if (!klasor.exists) klasor.create({ intermediates: true });
  };
  const dosya = (anahtar: string, ek = ""): File => new File(klasor, dosyaAdi(anahtar) + ek);

  const sirala = <T>(anahtar: string, is: () => Promise<T>): Promise<T> => {
    const onceki = sira.get(anahtar) ?? Promise.resolve();
    const p = onceki.then(is, is);
    const son = p.catch(() => undefined);
    sira.set(anahtar, son);
    void son.then(() => {
      if (sira.get(anahtar) === son) sira.delete(anahtar);
    });
    return p;
  };

  // Geçici dosyayı tam yaz, işaret koy, taşı, işareti sil. Ölüm hangi adımda olursa olsun veri kurtarılır.
  const atomikYaz = async (anahtar: string, icerik: string): Promise<void> => {
    hazirla();
    const isaret = dosya(anahtar, ".tamam");
    const gecici = dosya(anahtar, ".tmp");
    if (isaret.exists) isaret.delete();
    gecici.create({ overwrite: true });
    await gecici.write(icerik);
    isaret.create({ overwrite: true });
    await gecici.move(dosya(anahtar), { overwrite: true });
    if (isaret.exists) isaret.delete();
  };

  const kurtar = async (anahtar: string): Promise<void> => {
    const ana = dosya(anahtar);
    const gecici = dosya(anahtar, ".tmp");
    const isaret = dosya(anahtar, ".tamam");
    const karar = kurtarmaKarari(ana.exists, gecici.exists, isaret.exists);
    if (karar === "kurtar") await gecici.move(ana, { overwrite: true });
    if (karar !== "yok" && isaret.exists) isaret.delete();
  };

  const metinOku = async (anahtar: string): Promise<string | null> => {
    await kurtar(anahtar);
    const f = dosya(anahtar);
    if (!f.exists) return null;
    return f.text();
  };

  return {
    oku: (anahtar) => sirala(anahtar, async () => metinOku(anahtar)),

    yaz: (anahtar, deger) =>
      sirala(anahtar, async () => {
        await atomikYaz(anahtar, deger);
      }),

    ekle: (anahtar, satir) =>
      sirala(anahtar, async () => {
        hazirla();
        await kurtar(anahtar);
        const f = dosya(anahtar);
        if (!f.exists) f.create();
        await f.write(`${satir}\n`, { append: true });
      }),

    // Günlüğü verilen satırlarla atomik değiştirir (atomikYaz: tmp + tamam işareti + move + okumada kurtarma).
    satirlariYaz: (anahtar, satirlar) =>
      sirala(anahtar, async () => {
        await atomikYaz(anahtar, satirlar.map((s) => `${s}\n`).join(""));
      }),

    satirlar: (anahtar) =>
      sirala(anahtar, async () => {
        const m = await metinOku(anahtar);
        return m === null ? [] : m.split("\n").filter((s) => s !== "");
      }),

    sil: (anahtar) =>
      sirala(anahtar, async () => {
        const f = dosya(anahtar);
        if (f.exists) f.delete();
        for (const ek of [".tmp", ".tamam"]) {
          const y = dosya(anahtar, ek);
          if (y.exists) y.delete();
        }
      }),
  };
};
