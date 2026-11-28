/**
 * Ek yedeği çekirdeği (`ajanda-ekler.ts`) ile gerçek dosya portu (`dis-dunya.ts` `ajandaEkDiskiKur`) birlikte,
 * geçici dizinde. Kayıtlar sahte depodadır (her yazım revizyonu tek sayaçtan artırır), saat sahtedir.
 * Yükleme ve indirme uçtan uca, işaret dosyasının kalıcılığı ve yeniden açılışta gözlenen sürenin
 * korunması, bozuk dosyanın onarımı, kota baskısında saklama penceresi, sahipsiz onay dosyası.
 */
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { AJANDA_SINIRLARI, AJANDA_SURUMU, sha256Hex } from "@eren/protocol";
import type { AjandaKaydi } from "@eren/protocol";
import { AJANDA_EK_SINIRLARI, ajandaEkleriKur } from "../src/ajanda-ekler.ts";
import type { AjandaEkCercevesi, AjandaEkleri, AjandaEkleriBagimliliklari } from "../src/ajanda-ekler.ts";
import { ajandaEkDiskiKur } from "../src/dis-dunya.ts";
import { sahteGunluk, sahteZaman } from "./sahte.ts";

const BASLANGIC = 1_700_000_000_000;
const SAAT = 60 * 60 * 1000;
const GUN = 24 * SAAT;
const PARCA = AJANDA_SINIRLARI.EK_PARCA;
const BLOK = AJANDA_EK_SINIRLARI.BLOK_BAYT;

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const temizlenecek: string[] = [];
afterEach(() => {
  for (const d of temizlenecek.splice(0)) rmSync(d, { recursive: true, force: true });
});

const baytlar = (n: number, tohum = 1): Uint8Array => {
  const v = new Uint8Array(n);
  let x = tohum * 2654435761;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    v[i] = x >>> 24;
  }
  return v;
};

interface Ek {
  ek_id: string;
  veri: Uint8Array;
  ozet: string;
  bayt: number;
}

const ekUret = (ek_id: string, n: number, tohum = 1): Ek => {
  const veri = baytlar(n, tohum);
  return { ek_id, veri, ozet: sha256Hex(veri), bayt: n };
};

const kayit = (kayit_id: string, ekler: Ek[], ek: Partial<AjandaKaydi> = {}): AjandaKaydi =>
  ({
    kayit_id,
    revizyon: 1,
    tur: "gorev",
    baslik: "Fotoğraflı kayıt",
    hatirlatmalar: [],
    ornekler: [],
    durum: "acik",
    taslak: false,
    silindi: false,
    elle_alanlar: [],
    kaynak: { yol: "elle", tur_kokeni: "insan", device_id: "aj-1" },
    olusturma_ms: BASLANGIC,
    guncelleme_ms: BASLANGIC,
    ...(ekler.length > 0 && {
      ekler: ekler.map((e) => ({ ek_id: e.ek_id, mime: "image/jpeg", bayt: e.bayt, ozet: e.ozet, olusturma_ms: BASLANGIC })),
    }),
    ...ek,
  }) as AjandaKaydi;

function ortam(sec: { kotaBayt?: number } = {}) {
  const ust = mkdtempSync(join(tmpdir(), "eren-ek-birlesik-"));
  temizlenecek.push(ust);
  const kok = join(ust, "ajanda-ekler");
  const zaman = sahteZaman(BASLANGIC);
  const gunluk = sahteGunluk();
  const kayitlar = new Map<string, AjandaKaydi>();
  const sayac = { rev: 0 };
  const depo = {
    ajandaKaydiGetir: (id: string) => kayitlar.get(id) ?? null,
    ajandaKayitlari: (s: { silinmislerDahil?: boolean } = {}) =>
      [...kayitlar.values()].filter((k) => s.silinmislerDahil === true || !k.silindi),
    ajandaBasRev: () => sayac.rev,
    ajandaRevAraligi: (g: { sonRev: number; ustRev: number; adet: number }) =>
      [...kayitlar.values()]
        .filter((k) => k.revizyon > g.sonRev && k.revizyon <= g.ustRev)
        .sort((a, b) => a.revizyon - b.revizyon)
        .slice(0, g.adet),
  } as unknown as AjandaEkleriBagimliliklari["depo"];
  // Her açılış yeni port: süreç yeniden başlamış gibi (bellek yok, yalnız disk).
  const modul = (): AjandaEkleri =>
    ajandaEkleriKur({
      disk: ajandaEkDiskiKur(kok),
      depo,
      saat: zaman.saat,
      zamanlayici: zaman.zamanlayici,
      gunluk,
      ...(sec.kotaBayt !== undefined && { kotaBayt: sec.kotaBayt }),
    });
  const t = {
    kok,
    zaman,
    gunluk,
    ekler: modul(),
    kayitKoy: (k: AjandaKaydi): void => {
      sayac.rev += 1;
      kayitlar.set(k.kayit_id, { ...k, revizyon: sayac.rev });
    },
    yenidenAc: async (): Promise<void> => {
      await t.ekler.kapat();
      t.ekler = modul();
    },
    tamYolu: (e: Ek): string => join(kok, e.ozet.slice(0, 2), e.ozet),
    /** Servis çalışırken `ms` geçer: `GOZLEM_ADIMI_MS` adımlarla turlar (her adım tam sayılır). */
    calis: async (ms: number) => {
      let son = null;
      for (let kalan = ms; kalan > 0; ) {
        const adim = Math.min(kalan, AJANDA_EK_SINIRLARI.GOZLEM_ADIMI_MS);
        zaman.ilerlet(adim);
        kalan -= adim;
        son = await t.ekler.temizle();
      }
      return son!;
    },
    oturum: () => {
      const gelen: Msg[] = [];
      const o = t.ekler.oturumAc({ gonder: (m) => gelen.push(m as Msg) });
      const gonder = async (m: Msg): Promise<Msg[]> => {
        const once = gelen.length;
        o.cerceve({ v: AJANDA_SURUMU, ...m } as AjandaEkCercevesi);
        await t.ekler.bekle();
        return gelen.slice(once);
      };
      return {
        o,
        yukle: (k: string, e: Ek) => gonder({ type: "ek_yukle", istek_id: "i", kayit_id: k, ek_id: e.ek_id, ozet: e.ozet, bayt: e.bayt }),
        async hepsi(k: string, e: Ek): Promise<Msg> {
          let y = (await this.yukle(k, e))[0]!;
          while (y.type === "ek_durum" && !y.tamam) {
            const veri = Buffer.from(e.veri.slice(y.alinan, y.alinan + PARCA)).toString("base64");
            y = (await gonder({ type: "ek_parca", ek_id: e.ek_id, ofset: y.alinan, veri }))[0]!;
          }
          return y;
        },
        /** Bütün dosyayı pencere pencere indirir; son yanıtı ve baytları döner. */
        async indir(e: Ek): Promise<{ son: Msg; veri: Uint8Array }> {
          const parcalar: Buffer[] = [];
          let ofset = 0;
          for (;;) {
            const p = await gonder({ type: "ek_iste", istek_id: "i", ek_id: e.ek_id, ozet: e.ozet, ofset });
            for (const m of p) if (m.type === "ek_parca") parcalar.push(Buffer.from(m.veri, "base64"));
            const son = p.at(-1)!;
            if (son.type !== "ek_durum" || son.tamam) return { son, veri: new Uint8Array(Buffer.concat(parcalar)) };
            ofset = son.gonderilen;
          }
        },
      };
    },
  };
  return t;
}

describe("ek yedeği: çekirdek + gerçek disk (geçici dizin)", () => {
  it("yükle, içerik adresli dosya diskte, indir: baytlar ve sha256 aynı", async () => {
    const t = ortam();
    const e = ekUret("ek_1", 6 * PARCA + 123);
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    assert.equal((await b.hepsi("k1", e)).tamam, true);
    assert.deepEqual(new Uint8Array(readFileSync(t.tamYolu(e))), e.veri);
    assert.deepEqual(readdirSync(join(t.kok, "yarim")), []);
    const { son, veri } = await t.oturum().indir(e);
    assert.equal(son.tamam, true);
    assert.equal(sha256Hex(veri), e.ozet);
    await t.ekler.kapat();
  });

  it("saklama: işaret dosyası kalıcı; 40 gün kapalı PC açılışta silmez; gözlenen süre yeniden açılışlar arasında birikir, 30 günde dosya diskten gider", async () => {
    const t = ortam();
    const e = ekUret("ek_1", 5000);
    t.kayitKoy(kayit("k1", [e]));
    await t.oturum().hepsi("k1", e);
    t.kayitKoy(kayit("k1", [e], { silindi: true }));
    assert.equal((await t.ekler.temizle()).isaretlenen, 1);
    const isaretDosyasi = (): Record<string, any> => JSON.parse(readFileSync(join(t.kok, "basvurusuz.json"), "utf8")); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(isaretDosyasi()[e.ozet], BASLANGIC);
    // Gözlenen süre yeni bir porttan (süreç yeniden başlamış gibi) okunur: büyük dosya ile küçük sayaç birlikte.
    const gozlenen = async (): Promise<number | undefined> =>
      (await ajandaEkDiskiKur(t.kok).isaretleriOku()).get(e.ozet)?.gozlenen_ms;
    const ilkMetin = readFileSync(join(t.kok, "basvurusuz.json"), "utf8");
    await t.calis(10 * GUN);
    assert.equal(await gozlenen(), 10 * GUN);
    assert.equal(readFileSync(join(t.kok, "basvurusuz.json"), "utf8"), ilkMetin, "yalnız gözlem ilerledi: büyük dosya yeniden yazılmadı");
    // PC 40 gün kapalı; açılışta (telefon henüz bağlanmadan) birkaç tur: silinmez.
    await t.yenidenAc();
    t.zaman.ilerlet(40 * GUN);
    await t.yenidenAc();
    assert.equal((await t.ekler.temizle()).silinen, 0);
    assert.equal((await t.calis(19 * GUN)).silinen, 0);
    assert.ok(existsSync(t.tamYolu(e)));
    assert.equal(await gozlenen(), 29 * GUN);
    // Bir yeniden açılış daha; kalan gün gözlenince silinir.
    await t.yenidenAc();
    await t.ekler.temizle();
    const s = await t.calis(GUN);
    assert.equal(s.silinen, 1);
    assert.equal(existsSync(t.tamYolu(e)), false);
    assert.equal(isaretDosyasi()[e.ozet], undefined);
    await t.ekler.kapat();
  });

  it("kısa ömürlü süreç: kapanış son turdan beri gözleneni diske yazar, sonraki süreç kaldığı yerden sürer", async () => {
    const t = ortam();
    const e = ekUret("ek_1", 2000);
    t.kayitKoy(kayit("k1", [e]));
    await t.oturum().hepsi("k1", e);
    t.kayitKoy(kayit("k1", [e], { silindi: true }));
    await t.ekler.temizle();
    for (let i = 0; i < 3; i++) {
      t.zaman.ilerlet(40 * 60 * 1000);
      await t.yenidenAc();
      t.zaman.ilerlet(GUN); // PC kapalı: sayılmaz
      await t.ekler.temizle();
    }
    assert.equal((await ajandaEkDiskiKur(t.kok).isaretleriOku()).get(e.ozet)?.gozlenen_ms, 3 * 40 * 60 * 1000);
    await t.ekler.kapat();
  });

  it("geri yükleme: telefonun geri_yukle'si açılıştan sonra gelir, işaret kalkar ve dosya yeniden indirilir", async () => {
    const t = ortam();
    const e = ekUret("ek_1", 3000);
    t.kayitKoy(kayit("k1", [e]));
    await t.oturum().hepsi("k1", e);
    t.kayitKoy(kayit("k1", [e], { silindi: true }));
    await t.ekler.temizle();
    await t.yenidenAc();
    t.zaman.ilerlet(45 * GUN);
    await t.yenidenAc();
    await t.ekler.temizle();
    t.kayitKoy(kayit("k1", [e]));
    await t.ekler.temizle();
    assert.equal(JSON.parse(readFileSync(join(t.kok, "basvurusuz.json"), "utf8"))[e.ozet], undefined);
    const { son, veri } = await t.oturum().indir(e);
    assert.equal(son.tamam, true);
    assert.deepEqual(veri, e.veri);
    await t.ekler.kapat();
  });

  it("bozuk dosya diskte: indirme ek_yok alır, dosya silinir; yeniden yükleme yerine koyar", async () => {
    const t = ortam();
    const e = ekUret("ek_1", 2 * PARCA);
    t.kayitKoy(kayit("k1", [e]));
    await t.oturum().hepsi("k1", e);
    // Yeni süreç (doğrulama önbelleği yok), dosya diskte bozuldu (boy aynı).
    await t.yenidenAc();
    const bozuk = Buffer.from(e.veri);
    bozuk[5] = (bozuk[5]! + 1) & 0xff;
    writeFileSync(t.tamYolu(e), bozuk);
    const b = t.oturum();
    assert.deepEqual((await b.indir(e)).son, { v: AJANDA_SURUMU, type: "ek_ret", ek_id: "ek_1", code: "ek_yok" });
    assert.equal(existsSync(t.tamYolu(e)), false);
    assert.equal((await b.hepsi("k1", e)).tamam, true);
    assert.deepEqual(new Uint8Array(readFileSync(t.tamYolu(e))), e.veri);
    // Boyu yanlış (uzamış) dosya: yükleme onu silip baştan alır.
    await t.yenidenAc();
    appendFileSync(t.tamYolu(e), "x");
    assert.equal((await t.oturum().hepsi("k1", e)).tamam, true);
    assert.deepEqual(new Uint8Array(readFileSync(t.tamYolu(e))), e.veri);
    await t.ekler.kapat();
  });

  it("kota baskısı: saklama penceresindeki dosya diskten silinmez, yükleme kota_asildi alır", async () => {
    const t = ortam({ kotaBayt: 10 * BLOK });
    const g = ekUret("ek_g", 6 * BLOK, 1);
    t.kayitKoy(kayit("k_g", [g]));
    await t.oturum().hepsi("k_g", g);
    t.kayitKoy(kayit("k_g", [g], { silindi: true }));
    await t.ekler.temizle();
    await t.calis(5 * GUN);
    const n = ekUret("ek_n", 6 * BLOK, 2);
    t.kayitKoy(kayit("k_n", [n]));
    assert.deepEqual(await t.oturum().yukle("k_n", n), [{ v: AJANDA_SURUMU, type: "ek_ret", ek_id: "ek_n", code: "kota_asildi" }]);
    assert.ok(existsSync(t.tamYolu(g)));
    await t.ekler.kapat();
  });

  it("sahipsiz onay dosyası (çökmeden kalan) turda hemen silinir; kendi yükleme yolu bozulmaz", async () => {
    const t = ortam();
    const e = ekUret("ek_1", 1000);
    t.kayitKoy(kayit("k1", [e]));
    mkdirSync(join(t.kok, "yarim"), { recursive: true });
    const sahipsiz = "c".repeat(64);
    writeFileSync(join(t.kok, "yarim", `${sahipsiz}.onay`), "0");
    const s = await t.ekler.temizle();
    assert.equal(s.yarim_silinen, 1);
    assert.deepEqual(readdirSync(join(t.kok, "yarim")), []);
    assert.equal((await t.oturum().hepsi("k1", e)).tamam, true);
    await t.ekler.kapat();
  });
});
