/**
 * `eren eslestir`: güncel sürümün `eslestir.ts`'ine seçenekleri olduğu gibi verir. Süreç başlatmaz,
 * veritabanına ve %LOCALAPPDATA%'ya dokunmaz: çalıştırma, yol yoklaması ve kalıcı ortam sahtedir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eslestirBetigi, eslestirKomutu } from "../eren.ts";
import type { EslestirBag } from "../eren.ts";
import type { KaliciOrtam, Ortam } from "../ortam.ts";

const ORTAM: Ortam = { LOCALAPPDATA: "C:\\ornek\\Yerel", EREN_KIT_DATA_DIR: "C:\\ornek\\Veri" };
const BETIK = "C:\\ornek\\Veri\\uygulama\\guncel\\server\\src\\eslestir.ts";

const sahte = (o: { var?: boolean; kod?: number; kalici?: KaliciOrtam } = {}) => {
  const cagrilar: Array<{ dosya: string; args: string[] }> = [];
  const yoklanan: string[] = [];
  const bag: EslestirBag = {
    varMi: (y) => {
      yoklanan.push(y);
      return o.var ?? true;
    },
    calistir: (dosya, args) => {
      cagrilar.push({ dosya, args: [...args] });
      return o.kod ?? 0;
    },
    kaliciOrtam: () => (o.kalici === undefined ? { EREN_KIT_DATA_DIR: "C:\\ornek\\Veri" } : o.kalici),
  };
  return { bag, cagrilar, yoklanan };
};

const sessiz = <T>(is: () => T): { sonuc: T; hata: string } => {
  const { log, error } = console;
  let hata = "";
  console.log = () => {};
  console.error = (...a: unknown[]) => {
    hata += `${a.join(" ")}\n`;
  };
  try {
    return { sonuc: is(), hata };
  } finally {
    console.log = log;
    console.error = error;
  }
};

test("eslestir: betik güncel sürümün server\\src\\eslestir.ts'i (veri kökünden)", () => {
  assert.equal(eslestirBetigi(ORTAM), BETIK);
});

test("eslestir: seçenekler olduğu gibi aynı Node ile güncel sürüme gider, çıkış kodu aynen döner", () => {
  for (const [args, kod] of [
    [[], 0],
    [["--ajanda"], 0],
    [["--ajanda", "--liste"], 0],
    [["--kaldir", "c_1"], 1],
    [["--bilinmeyen"], 2],
  ] as const) {
    const s = sahte({ kod });
    const { sonuc } = sessiz(() => eslestirKomutu(args, s.bag, ORTAM));
    assert.equal(sonuc, kod);
    assert.deepEqual(s.cagrilar, [{ dosya: process.execPath, args: ["--disable-warning=ExperimentalWarning", BETIK, ...args] }]);
  }
});

test("eslestir: kurulu sürüm yoksa çalıştırmaz, 1 ve kur.ts'i söyler", () => {
  const s = sahte({ var: false });
  const { sonuc, hata } = sessiz(() => eslestirKomutu(["--ajanda"], s.bag, ORTAM));
  assert.equal(sonuc, 1);
  assert.equal(s.cagrilar.length, 0);
  assert.deepEqual(s.yoklanan, [BETIK]);
  assert.match(hata, /kur\.ts/);
});

test("eslestir: kabuktaki veri kökü kalıcı ortamdakinden farklıysa hiçbir şeye dokunmaz", () => {
  const s = sahte({ kalici: { EREN_KIT_DATA_DIR: "C:\\ornek\\Baska" } });
  const { sonuc, hata } = sessiz(() => eslestirKomutu([], s.bag, ORTAM));
  assert.equal(sonuc, 1);
  assert.equal(s.cagrilar.length, 0);
  assert.equal(s.yoklanan.length, 0);
  assert.match(hata, /eren eslestir durdu/);
});

test("eslestir: kalıcı ortam okunamazsa uyarır ama sürer", () => {
  const s = sahte({ kalici: null });
  const { sonuc, hata } = sessiz(() => eslestirKomutu(["--liste"], s.bag, ORTAM));
  assert.equal(sonuc, 0);
  assert.equal(s.cagrilar.length, 1);
  assert.match(hata, /UYARI/);
});
