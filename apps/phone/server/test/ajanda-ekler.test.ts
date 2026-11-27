/**
 * Ek yedeği çekirdeği (`src/ajanda-ekler.ts`; AJANDA.md "Sürüm 3" > "Ek yedeği"). Disk bellekte sahtedir
 * (`sahte-ek-diski.ts`), kayıtlar bellekte sahte depodan, saat sahtedir. Giden her çerçeve kablo
 * şemasından (`ajandaAsagiCoz`) geçer. Gerçek dosya portu `ajanda-ek-diski.test.ts`'te, gateway yolu
 * `gateway-ajanda.test.ts` "ek yedeği"nde.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AJANDA_SINIRLARI, AJANDA_SURUMU, ajandaAsagiCoz, sha256Hex } from "@eren/protocol";
import type { AjandaKaydi } from "@eren/protocol";
import { AJANDA_EK_SINIRLARI, ajandaEkleriKur } from "../src/ajanda-ekler.ts";
import type { AjandaEkCercevesi, AjandaEkleriBagimliliklari, AjandaEkYaniti } from "../src/ajanda-ekler.ts";
import { sahteEkDiski } from "./sahte-ek-diski.ts";
import { sahteGunluk, sahteZaman } from "./sahte.ts";

const BASLANGIC = 1_700_000_000_000;
const GUN = 24 * 60 * 60 * 1000;
const PARCA = AJANDA_SINIRLARI.EK_PARCA;
const BLOK = AJANDA_EK_SINIRLARI.BLOK_BAYT;

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Tohumlu, tekrarlanabilir bayt dizisi. */
const baytlar = (n: number, tohum = 1): Uint8Array => {
  const v = new Uint8Array(n);
  let x = tohum * 2654435761;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    v[i] = x >>> 24;
  }
  return v;
};

const b64 = (v: Uint8Array): string => Buffer.from(v).toString("base64");

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

function kur(sec: { kotaBayt?: number } = {}) {
  const zaman = sahteZaman(BASLANGIC);
  const gunluk = sahteGunluk();
  const sd = sahteEkDiski(() => zaman.saat.simdiMs());
  const kayitlar = new Map<string, AjandaKaydi>();
  /** Kayıt okumaları (`ajandaKayitlari`) ve baş revizyon (her `kayitKoy` artırır). */
  const sayac = { okuma: 0, rev: 0 };
  const depo = {
    ajandaKaydiGetir: (id: string) => kayitlar.get(id) ?? null,
    ajandaKayitlari: (s: { silinmislerDahil?: boolean } = {}) => {
      sayac.okuma += 1;
      return [...kayitlar.values()].filter((k) => s.silinmislerDahil === true || !k.silindi);
    },
    ajandaBasRev: () => sayac.rev,
  } as unknown as AjandaEkleriBagimliliklari["depo"];
  const ekler = ajandaEkleriKur({
    disk: sd.disk,
    depo,
    saat: zaman.saat,
    zamanlayici: zaman.zamanlayici,
    gunluk,
    ...(sec.kotaBayt !== undefined && { kotaBayt: sec.kotaBayt }),
  });
  const kayitKoy = (k: AjandaKaydi): void => {
    kayitlar.set(k.kayit_id, k);
    sayac.rev += 1;
  };
  /**
   * Bir bağlantı: giden her çerçeve şemadan geçer. `tampon` verilirse bağlantı gönderim tamponunu bildirir:
   * her giden çerçevenin metin boyu eklenir (okumayan istemci), test `tampon.bayt`'ı sıfırlayarak boşaltır.
   */
  const oturum = (sec: { tampon?: { bayt: number } } = {}) => {
    const gelen: Msg[] = [];
    const tampon = sec.tampon;
    const o = ekler.oturumAc({
      gonder: (m: AjandaEkYaniti) => {
        const metin = JSON.stringify(m);
        const coz = ajandaAsagiCoz(metin);
        assert.ok(coz.ok, `giden çerçeve şemaya uymuyor: ${metin.slice(0, 200)}`);
        gelen.push(coz.mesaj as Msg);
        if (tampon !== undefined) tampon.bayt += metin.length;
      },
      ...(tampon !== undefined && { bekleyenBayt: () => tampon.bayt }),
    });
    const gonder = async (m: Msg): Promise<Msg[]> => {
      const once = gelen.length;
      o.cerceve({ v: AJANDA_SURUMU, ...m } as AjandaEkCercevesi);
      await ekler.bekle();
      return gelen.slice(once);
    };
    return {
      o,
      gelen,
      gonder,
      yukle: (k: string, e: Ek) => gonder({ type: "ek_yukle", istek_id: "i1", kayit_id: k, ek_id: e.ek_id, ozet: e.ozet, bayt: e.bayt }),
      parca: (e: Ek, ofset: number, n = PARCA) => gonder({ type: "ek_parca", ek_id: e.ek_id, ofset, veri: b64(e.veri.slice(ofset, ofset + n)) }),
      iste: (e: Ek, ofset: number, ozet = e.ozet) => gonder({ type: "ek_iste", istek_id: "i2", ek_id: e.ek_id, ozet, ofset }),
      /** Bütün eki dur-bekle yükler; son yanıtı döner. */
      async hepsi(k: string, e: Ek): Promise<Msg> {
        let y = (await this.yukle(k, e))[0]!;
        while (y.type === "ek_durum" && !y.tamam) y = (await this.parca(e, y.alinan))[0]!;
        return y;
      },
    };
  };
  return { zaman, gunluk, sd, kayitlar, kayitKoy, sayac, ekler, oturum };
}

const durum = (ek_id: string, alinan: number, tamam: boolean) => ({ v: AJANDA_SURUMU, type: "ek_durum", ek_id, alinan, tamam });
const ret = (ek_id: string, code: string) => ({ v: AJANDA_SURUMU, type: "ek_ret", ek_id, code });

describe("ek yedeği: yükleme", () => {
  it("tam yükleme: dur-bekle parçalar, son parçada sha256 doğrulanır, dosya içerik adresli saklanır", async () => {
    const t = kur();
    const e = ekUret("ek_1", 2 * PARCA + 1000);
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    assert.deepEqual(await b.yukle("k1", e), [durum("ek_1", 0, false)]);
    assert.deepEqual(await b.parca(e, 0), [durum("ek_1", PARCA, false)]);
    assert.deepEqual(await b.parca(e, PARCA), [durum("ek_1", 2 * PARCA, false)]);
    assert.deepEqual(await b.parca(e, 2 * PARCA), [durum("ek_1", e.bayt, true)]);
    assert.deepEqual(t.sd.tamlar.get(e.ozet), e.veri);
    assert.equal(t.sd.yarimlar.size, 0);
    assert.deepEqual(t.gunluk.bul("ek_saklandi")[0]!.alanlar, { ek_id: "ek_1", bayt: e.bayt });
  });

  it("içerik adresli: aynı görsel başka kayıtta da geçiyorsa yükleme yapılmaz (tamam:true)", async () => {
    const t = kur();
    const e = ekUret("ek_1", 5000);
    const ayni = { ...e, ek_id: "ek_2" };
    t.kayitKoy(kayit("k1", [e]));
    t.kayitKoy(kayit("k2", [ayni]));
    const b = t.oturum();
    assert.equal((await b.hepsi("k1", e)).tamam, true);
    const once = t.sd.cagrilar.filter((c) => c.startsWith("yarimaEkle")).length;
    assert.deepEqual(await b.yukle("k2", ayni), [durum("ek_2", e.bayt, true)]);
    assert.equal(t.sd.cagrilar.filter((c) => c.startsWith("yarimaEkle")).length, once);
    assert.equal(t.sd.tamlar.size, 1);
  });

  it("kopup sürdürme: yeni bağlantıda ek_yukle kalıcı alinan'ı verir, kaldığı yerden tamamlanır", async () => {
    const t = kur();
    const e = ekUret("ek_1", 3 * PARCA);
    t.kayitKoy(kayit("k1", [e]));
    const b1 = t.oturum();
    await b1.yukle("k1", e);
    await b1.parca(e, 0);
    b1.o.kapat();
    // Kapanmış bağlantıya yanıt gitmez, çerçeve işlenmez.
    assert.deepEqual(await b1.parca(e, PARCA), []);
    const b2 = t.oturum();
    assert.deepEqual(await b2.yukle("k1", e), [durum("ek_1", PARCA, false)]);
    assert.equal((await b2.hepsi("k1", e)).tamam, true);
    assert.deepEqual(t.sd.tamlar.get(e.ozet), e.veri);
  });

  it("çökme taklidi: onaylanmamış kuyruk alinan'a girmez, yazım onaylı uzunluktan sürer", async () => {
    const t = kur();
    const e = ekUret("ek_1", 2 * PARCA);
    t.kayitKoy(kayit("k1", [e]));
    const b1 = t.oturum();
    await b1.yukle("k1", e);
    await b1.parca(e, 0);
    // Onaysız 1000 bayt çöp: diskte var, onayda yok.
    const y = t.sd.yarimlar.get(e.ozet)!;
    const cop = new Uint8Array(y.veri.length + 1000);
    cop.set(y.veri);
    y.veri = cop;
    const b2 = t.oturum();
    assert.deepEqual(await b2.yukle("k1", e), [durum("ek_1", PARCA, false)]);
    assert.deepEqual(await b2.parca(e, PARCA), [durum("ek_1", e.bayt, true)]);
    assert.deepEqual(t.sd.tamlar.get(e.ozet), e.veri);
  });

  it("çökme taklidi: son parçası onaylı ama doğrulanmamış yarım ek_yukle'de tamamlanır", async () => {
    const t = kur();
    const e = ekUret("ek_1", 1000);
    t.kayitKoy(kayit("k1", [e]));
    t.sd.yarimlar.set(e.ozet, { veri: e.veri.slice(), onay: e.bayt, degisme_ms: BASLANGIC });
    assert.deepEqual(await t.oturum().yukle("k1", e), [durum("ek_1", e.bayt, true)]);
    assert.ok(t.sd.tamlar.has(e.ozet));
  });

  it("yanlış ofset: yazılmaz, ek_durum doğru alinan'ı söyler; yinelenen parça iki kez yazılmaz", async () => {
    const t = kur();
    const e = ekUret("ek_1", 2 * PARCA);
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    await b.yukle("k1", e);
    assert.deepEqual(await b.parca(e, PARCA), [durum("ek_1", 0, false)]);
    assert.equal(t.sd.yarimlar.size, 0);
    assert.deepEqual(await b.parca(e, 0), [durum("ek_1", PARCA, false)]);
    assert.deepEqual(await b.parca(e, 0), [durum("ek_1", PARCA, false)]);
    assert.equal(t.sd.yarimlar.get(e.ozet)!.veri.length, PARCA);
    assert.equal((await b.hepsi("k1", e)).tamam, true);
    assert.deepEqual(t.sd.tamlar.get(e.ozet), e.veri);
  });

  it("özet uyuşmazlığı: aynı boyda başka bayt → ozet_uyusmuyor, yarım silinir, dosya oluşmaz; bağlantı sürer", async () => {
    const t = kur();
    const e = ekUret("ek_1", PARCA + 10);
    const sahte = { ...e, veri: baytlar(e.bayt, 99) };
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    await b.yukle("k1", sahte);
    await b.parca(sahte, 0);
    assert.deepEqual(await b.parca(sahte, PARCA), [ret("ek_1", "ozet_uyusmuyor")]);
    assert.equal(t.sd.tamlar.size, 0);
    assert.equal(t.sd.yarimlar.size, 0);
    // Aynı bağlantıda doğru baytlarla baştan.
    assert.equal((await b.hepsi("k1", e)).tamam, true);
  });

  it("bildirilen boyu aşan parça: ozet_uyusmuyor, yarım silinir", async () => {
    const t = kur();
    const e = ekUret("ek_1", 100);
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    await b.yukle("k1", e);
    assert.deepEqual(await b.gonder({ type: "ek_parca", ek_id: "ek_1", ofset: 0, veri: b64(baytlar(200)) }), [ret("ek_1", "ozet_uyusmuyor")]);
    assert.equal(t.sd.yarimlar.size, 0);
  });

  it("üstverisi olmayan ek: kayıt yok, silinmiş, ek_id/ozet/bayt tutmuyor → ek_bilinmiyor; diske hiç dokunulmaz", async () => {
    const t = kur();
    const e = ekUret("ek_1", 1000);
    t.kayitKoy(kayit("k1", [e]));
    t.kayitKoy(kayit("k_sil", [e], { silindi: true }));
    t.kayitKoy(kayit("k_bos", []));
    const b = t.oturum();
    const denemeler: Msg[] = [
      { kayit_id: "yok", ek_id: "ek_1", ozet: e.ozet, bayt: e.bayt },
      { kayit_id: "k_sil", ek_id: "ek_1", ozet: e.ozet, bayt: e.bayt },
      { kayit_id: "k_bos", ek_id: "ek_1", ozet: e.ozet, bayt: e.bayt },
      { kayit_id: "k1", ek_id: "ek_2", ozet: e.ozet, bayt: e.bayt },
      { kayit_id: "k1", ek_id: "ek_1", ozet: "0".repeat(64), bayt: e.bayt },
      { kayit_id: "k1", ek_id: "ek_1", ozet: e.ozet, bayt: e.bayt + 1 },
    ];
    for (const d of denemeler) {
      assert.deepEqual(await b.gonder({ type: "ek_yukle", istek_id: "i", ...d }), [ret(d.ek_id, "ek_bilinmiyor")], JSON.stringify(d));
    }
    assert.deepEqual(t.sd.cagrilar, []);
    // `ek_yukle`'siz parça: yazılmaz, geçici ret (istemci ek_yukle ile başlar).
    assert.deepEqual(await b.parca(e, 0), [ret("ek_1", "ic_hata")]);
    assert.deepEqual(t.sd.cagrilar, []);
  });

  it("yükleme sürerken ek kayıttan çıkarıldı: tamamlanırken ek_bilinmiyor, yarım silinir", async () => {
    const t = kur();
    const e = ekUret("ek_1", PARCA + 5);
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    await b.yukle("k1", e);
    await b.parca(e, 0);
    t.kayitKoy(kayit("k1", []));
    assert.deepEqual(await b.parca(e, PARCA), [ret("ek_1", "ek_bilinmiyor")]);
    assert.equal(t.sd.tamlar.size, 0);
    assert.equal(t.sd.yarimlar.size, 0);
  });

  it("kota: tam + yarım (bildirilen boyu ayrılmış) + yeni ekin boyu kotayı aşarsa kota_asildi; yer açılınca kabul", async () => {
    const t = kur({ kotaBayt: 10 * BLOK });
    const a = ekUret("ek_a", 6 * BLOK, 1);
    const b_ = ekUret("ek_b", 3 * BLOK, 2);
    const c = ekUret("ek_c", 5 * BLOK, 3);
    t.kayitKoy(kayit("k1", [a, b_, c]));
    const b = t.oturum();
    assert.equal((await b.hepsi("k1", a)).tamam, true);
    // b'nin yalnız 1000 baytı yazılı ama 3 bloğu ayrılmış; c'ye 6 + 3 + 5 > 10 blok.
    await b.yukle("k1", b_);
    await b.parca(b_, 0, 1000);
    assert.deepEqual(await b.yukle("k1", c), [ret("ek_c", "kota_asildi")]);
    assert.equal(t.sd.yarimlar.has(c.ozet), false);
    assert.deepEqual(t.gunluk.bul("ek_ret").at(-1)!.alanlar, { ek_id: "ek_c", code: "kota_asildi" });
    // Kota diski taramaz: dışarıdan silinen dosya bir sonraki taramada (temizlik turu) düşer.
    t.sd.tamlar.delete(a.ozet);
    assert.deepEqual(await b.yukle("k1", c), [ret("ek_c", "kota_asildi")]);
    await t.ekler.temizle();
    assert.deepEqual(await b.yukle("k1", c), [durum("ek_c", 0, false)]);
  });

  it("kayıt başına sınır: üstverinin bayt toplamı KAYIT_BAYT'ı aşarsa ek_cok_buyuk", async () => {
    const t = kur();
    const e = ekUret("ek_1", 1000);
    const k = kayit("k1", [e]);
    // Şemanın tavanını aşan üstveri (yalnız şema genişlerse olur): açık denetim yine keser.
    const fazla = Array.from({ length: AJANDA_SINIRLARI.EK_ADET + 1 }, (_, i) => ({
      ek_id: `x${i}`,
      mime: "image/jpeg",
      bayt: AJANDA_SINIRLARI.EK_BAYT,
      ozet: "a".repeat(64),
      olusturma_ms: BASLANGIC,
    }));
    t.kayitKoy({ ...k, ekler: [...k.ekler!, ...fazla] } as AjandaKaydi);
    assert.ok(AJANDA_EK_SINIRLARI.KAYIT_BAYT === AJANDA_SINIRLARI.EK_ADET * AJANDA_SINIRLARI.EK_BAYT);
    assert.deepEqual(await t.oturum().yukle("k1", e), [ret("ek_1", "ek_cok_buyuk")]);
  });

  it("yarım sınırı: YARIM_ADET yarım varken yeni yükleme ic_hata; var olan yarım sürer", async () => {
    const t = kur();
    for (let i = 0; i < AJANDA_EK_SINIRLARI.YARIM_ADET; i++) {
      t.sd.yarimlar.set(sha256Hex(baytlar(8, 1000 + i)), { veri: new Uint8Array(8), onay: 8, degisme_ms: BASLANGIC });
    }
    const e = ekUret("ek_1", 1000);
    const eski = [...t.sd.yarimlar.keys()][0]!;
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    assert.deepEqual(await b.yukle("k1", e), [ret("ek_1", "ic_hata")]);
    assert.deepEqual(t.gunluk.bul("ek_yarim_siniri")[0]!.alanlar, { ek_id: "ek_1", adet: AJANDA_EK_SINIRLARI.YARIM_ADET });
    // Var olan bir yarımın sahibi sürdürebilir.
    t.kayitKoy(kayit("k2", [{ ek_id: "ek_eski", veri: new Uint8Array(0), ozet: eski, bayt: 100 }]));
    assert.deepEqual(await b.gonder({ type: "ek_yukle", istek_id: "i", kayit_id: "k2", ek_id: "ek_eski", ozet: eski, bayt: 100 }), [
      durum("ek_eski", 8, false),
    ]);
  });

  it("bağlantı başına açık yükleme sınırı: en eskisi unutulur (parçası ic_hata), yarımı diskte kalır", async () => {
    const t = kur();
    const ekler = [ekUret("ek_1", 2000, 1), ekUret("ek_2", 2000, 2), ekUret("ek_3", 2000, 3)];
    t.kayitKoy(kayit("k1", ekler));
    const b = t.oturum();
    for (const e of ekler) {
      await b.yukle("k1", e);
      await b.parca(e, 0, 500);
    }
    assert.equal(AJANDA_EK_SINIRLARI.BAGLANTI_YUKLEME, 2);
    assert.deepEqual(await b.parca(ekler[0]!, 500, 500), [ret("ek_1", "ic_hata")]);
    assert.deepEqual(await b.parca(ekler[2]!, 500, 500), [durum("ek_3", 1000, false)]);
    assert.equal(t.sd.yarimlar.get(ekler[0]!.ozet)!.onay, 500);
    // `ek_yukle` ile yeniden açılır, kaldığı yerden.
    assert.deepEqual(await b.yukle("k1", ekler[0]!), [durum("ek_1", 500, false)]);
  });

  it("bağlantı başına bekleyen çerçeve sınırı: aşan çerçeve işlenmeden ic_hata", async () => {
    const t = kur();
    const e = ekUret("ek_1", 100);
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    const n = AJANDA_EK_SINIRLARI.BAGLANTI_BEKLEYEN + 2;
    for (let i = 0; i < n; i++) {
      b.o.cerceve({ v: AJANDA_SURUMU, type: "ek_iste", istek_id: "i", ek_id: `ek_${i}`, ozet: e.ozet, ofset: 0 } as AjandaEkCercevesi);
    }
    await t.ekler.bekle();
    const retler = b.gelen.filter((m) => m.type === "ek_ret");
    assert.equal(retler.filter((m) => m.code === "ic_hata").length, 2);
    assert.equal(retler.filter((m) => m.code === "ek_yok").length, AJANDA_EK_SINIRLARI.BAGLANTI_BEKLEYEN);
    assert.equal(t.gunluk.bul("ek_bekleyen_siniri").length, 2);
  });

  it("disk hatası: ic_hata (geçici), hata yalnız türüyle günlüğe; sonraki deneme başarılı", async () => {
    const t = kur();
    const e = ekUret("ek_1", 100);
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    await b.yukle("k1", e);
    t.sd.atsin.add("yarimaEkle");
    assert.deepEqual(await b.parca(e, 0), [ret("ek_1", "ic_hata")]);
    assert.deepEqual(t.gunluk.bul("ek_hatasi")[0]!.alanlar, { ek_id: "ek_1", hata_turu: "Error" });
    assert.deepEqual(await b.parca(e, 0), [durum("ek_1", 100, true)]);
  });

  it("yol enjeksiyonu: özet olmayan değer (şemayı atlayarak) hiçbir porta ulaşmaz", async () => {
    const t = kur();
    const kotu = ["..\\..\\Windows\\win.ini", "../../etc/passwd", "AB".repeat(32), "a".repeat(63), `${"a".repeat(62)}\\x`, "C:\\x"];
    t.kayitKoy(
      kayit(
        "k1",
        kotu.map((ozet, i) => ({ ek_id: `ek_${i}`, veri: new Uint8Array(0), ozet, bayt: 10 })),
      ),
    );
    const b = t.oturum();
    for (const [i, ozet] of kotu.entries()) {
      assert.deepEqual(await b.gonder({ type: "ek_yukle", istek_id: "i", kayit_id: "k1", ek_id: `ek_${i}`, ozet, bayt: 10 }), [
        ret(`ek_${i}`, "ek_bilinmiyor"),
      ]);
      assert.deepEqual(await b.gonder({ type: "ek_iste", istek_id: "i", ek_id: `ek_${i}`, ozet, ofset: 0 }), [ret(`ek_${i}`, "ek_yok")]);
    }
    assert.deepEqual(t.sd.cagrilar, []);
  });
});

describe("ek yedeği: indirme", () => {
  it("pencere: en çok EK_PENCERE parça, sonra ek_durum{gonderilen}; istemci sürer, baytlar ve sha256 tutar", async () => {
    const t = kur();
    const e = ekUret("ek_1", 5 * PARCA + 77);
    t.sd.tamlar.set(e.ozet, e.veri);
    const b = t.oturum();
    const p1 = await b.iste(e, 0);
    assert.equal(p1.length, AJANDA_SINIRLARI.EK_PENCERE + 1);
    assert.deepEqual(p1.slice(0, -1).map((m) => [m.type, m.ofset]), [0, 1, 2, 3].map((i) => ["ek_parca", i * PARCA]));
    assert.deepEqual(p1.at(-1), { v: AJANDA_SURUMU, type: "ek_durum", ek_id: "ek_1", gonderilen: 4 * PARCA, tamam: false });
    const p2 = await b.iste(e, 4 * PARCA);
    assert.deepEqual(p2.map((m) => m.type), ["ek_parca", "ek_parca", "ek_durum"]);
    assert.deepEqual(p2.at(-1), { v: AJANDA_SURUMU, type: "ek_durum", ek_id: "ek_1", gonderilen: e.bayt, tamam: true });
    const birlesik = Buffer.concat([...p1, ...p2].filter((m) => m.type === "ek_parca").map((m) => Buffer.from(m.veri, "base64")));
    assert.equal(sha256Hex(new Uint8Array(birlesik)), e.ozet);
  });

  it("yoksa ek_yok; ofset sonun ötesindeyse ozet_uyusmuyor; sonundaysa parçasız tamam", async () => {
    const t = kur();
    const e = ekUret("ek_1", 100);
    const b = t.oturum();
    assert.deepEqual(await b.iste(e, 0), [ret("ek_1", "ek_yok")]);
    t.sd.tamlar.set(e.ozet, e.veri);
    assert.deepEqual(await b.iste(e, 101), [ret("ek_1", "ozet_uyusmuyor")]);
    assert.deepEqual(await b.iste(e, 100), [{ v: AJANDA_SURUMU, type: "ek_durum", ek_id: "ek_1", gonderilen: 100, tamam: true }]);
  });

  it("yüklenen dosya geri indirilir (telefon sıfırlandı)", async () => {
    const t = kur();
    const e = ekUret("ek_1", PARCA + 3);
    t.kayitKoy(kayit("k1", [e]));
    await t.oturum().hepsi("k1", e);
    const yeni = t.oturum();
    const p = await yeni.iste(e, 0);
    const veri = Buffer.concat(p.filter((m) => m.type === "ek_parca").map((m) => Buffer.from(m.veri, "base64")));
    assert.deepEqual(new Uint8Array(veri), e.veri);
    assert.equal(p.at(-1)!.tamam, true);
  });
});

describe("ek yedeği: temizlik ve saklama", () => {
  it("başvurulan tutulur; başvurusuz işaretlenir ve EK_SAKLAMA_GUN sonra silinir; silinmiş kayıt başvuru sayılmaz", async () => {
    const t = kur();
    const a = ekUret("ek_a", 100, 1);
    const b = ekUret("ek_b", 200, 2);
    const c = ekUret("ek_c", 300, 3);
    t.kayitKoy(kayit("k1", [a]));
    t.kayitKoy(kayit("k2", [b], { silindi: true }));
    for (const e of [a, b, c]) t.sd.tamlar.set(e.ozet, e.veri);

    const s1 = await t.ekler.temizle();
    assert.deepEqual(s1, { silinen: 0, silinen_bayt: 0, yarim_silinen: 0, isaretlenen: 2, tutulan: 1 });
    assert.deepEqual([...t.sd.isaretler.keys()].sort(), [b.ozet, c.ozet].sort());
    assert.equal(t.sd.isaretler.get(b.ozet), BASLANGIC);

    t.zaman.ilerlet(AJANDA_SINIRLARI.EK_SAKLAMA_GUN * GUN - 1);
    assert.equal((await t.ekler.temizle()).silinen, 0);
    assert.equal(t.sd.tamlar.size, 3);

    t.zaman.ilerlet(1);
    const s3 = await t.ekler.temizle();
    assert.deepEqual(s3, { silinen: 2, silinen_bayt: 500, yarim_silinen: 0, isaretlenen: 0, tutulan: 1 });
    assert.deepEqual([...t.sd.tamlar.keys()], [a.ozet]);
    assert.equal(t.sd.isaretler.size, 0);
    assert.deepEqual(t.gunluk.bul("ek_temizlik").at(-1)!.alanlar, s3);
  });

  it("yeniden başvurulan (geri yükleme, ek yeniden eklendi) dosyanın işareti kalkar, süre baştan", async () => {
    const t = kur();
    const a = ekUret("ek_a", 100);
    t.sd.tamlar.set(a.ozet, a.veri);
    t.kayitKoy(kayit("k1", [a], { silindi: true }));
    await t.ekler.temizle();
    assert.equal(t.sd.isaretler.size, 1);
    t.zaman.ilerlet(20 * GUN);
    t.kayitKoy(kayit("k1", [a]));
    await t.ekler.temizle();
    assert.equal(t.sd.isaretler.size, 0);
    t.kayitKoy(kayit("k1", []));
    t.zaman.ilerlet(20 * GUN);
    await t.ekler.temizle();
    t.zaman.ilerlet(20 * GUN);
    assert.equal((await t.ekler.temizle()).silinen, 0, "işaret 20 gün önce: henüz silinmez");
    t.zaman.ilerlet(10 * GUN);
    assert.equal((await t.ekler.temizle()).silinen, 1);
  });

  it("dosyası olmayan işaret düşer; tarama okunamazsa hiçbir şey silinmez", async () => {
    const t = kur();
    const a = ekUret("ek_a", 100);
    t.sd.isaretler.set("f".repeat(64), BASLANGIC - 100 * GUN);
    t.sd.isaretler.set(a.ozet, BASLANGIC - 100 * GUN);
    t.sd.tamlar.set(a.ozet, a.veri);
    // Kayıt taraması atar: süresi çoktan geçmiş dosya bile silinmez.
    t.kayitlar.set("bozuk", null as unknown as AjandaKaydi);
    await assert.rejects(t.ekler.temizle());
    assert.ok(t.sd.tamlar.has(a.ozet));
    t.kayitlar.delete("bozuk");
    const s = await t.ekler.temizle();
    assert.equal(s.silinen, 1);
    assert.equal(t.sd.isaretler.size, 0);
  });

  it("dokunulmayan yarım 24 saatte silinir; yükleme sürerken dokunulan kalır", async () => {
    const t = kur();
    const e = ekUret("ek_1", 2 * PARCA);
    const f = ekUret("ek_2", 2 * PARCA, 7);
    t.kayitKoy(kayit("k1", [e, f]));
    const b = t.oturum();
    await b.yukle("k1", e);
    await b.parca(e, 0);
    await b.yukle("k1", f);
    await b.parca(f, 0);
    t.zaman.ilerlet(AJANDA_EK_SINIRLARI.YARIM_SURE_MS - 1000);
    await b.parca(f, PARCA, 10);
    t.zaman.ilerlet(1000);
    const s = await t.ekler.temizle();
    assert.equal(s.yarim_silinen, 1);
    assert.equal(t.sd.yarimlar.has(e.ozet), false);
    assert.equal(t.sd.yarimlar.has(f.ozet), true);
    // Silinen yarımın sahibi ek_yukle ile baştan başlar.
    assert.deepEqual(await b.yukle("k1", e), [durum("ek_1", 0, false)]);
  });

  it("periyodik: baslat ilk turu arkada yapar, TEMIZLIK_ARALIGI_MS'de yineler; kapat periyodu keser", async () => {
    const t = kur();
    t.ekler.baslat();
    await t.ekler.bekle();
    assert.equal(t.gunluk.bul("ek_temizlik").length, 1);
    t.zaman.ilerlet(AJANDA_EK_SINIRLARI.TEMIZLIK_ARALIGI_MS);
    await t.ekler.bekle();
    assert.equal(t.gunluk.bul("ek_temizlik").length, 2);
    await t.ekler.kapat();
    t.zaman.ilerlet(AJANDA_EK_SINIRLARI.TEMIZLIK_ARALIGI_MS);
    await t.ekler.bekle();
    assert.equal(t.gunluk.bul("ek_temizlik").length, 2);
    // Kapalı modül yeni çerçeveyi ic_hata ile reddeder.
    const b = t.oturum();
    assert.deepEqual(await b.iste(ekUret("ek_1", 1), 0), [ret("ek_1", "ic_hata")]);
  });
});

describe("ek yedeği: günlük", () => {
  it("günlükte içerik, özet ve yol yok: yalnız ek_id, bayt, sayı ve kod", async () => {
    const t = kur({ kotaBayt: 3 * PARCA });
    const e = ekUret("ek_1", PARCA + 9);
    const kotu = { ...e, veri: baytlar(e.bayt, 5) };
    const buyuk = ekUret("ek_2", 3 * PARCA);
    t.kayitKoy(kayit("k1", [e, buyuk]));
    const b = t.oturum();
    await b.hepsi("k1", kotu);
    await b.hepsi("k1", e);
    await b.yukle("k1", buyuk);
    await b.iste(e, 0);
    await b.iste({ ...e, ozet: "9".repeat(64) }, 0);
    t.sd.atsin.add("tamOku");
    await b.iste(e, 0);
    t.kayitKoy(kayit("k1", []));
    await t.ekler.temizle();
    t.zaman.ilerlet(31 * GUN);
    await t.ekler.temizle();

    const metin = JSON.stringify(t.gunluk.girdiler);
    assert.ok(t.gunluk.girdiler.length > 5);
    for (const yasak of [e.ozet, buyuk.ozet, "9".repeat(64), b64(e.veri.slice(0, 30)), b64(kotu.veri.slice(0, 30)), "ajanda-ekler", "yarim\\\\", "yarim/", "\\\\"]) {
      assert.equal(metin.includes(yasak), false, `günlükte "${yasak.slice(0, 20)}" var`);
    }
    assert.equal(/[0-9a-f]{64}/.test(metin), false);
    const izinli = new Set(["ek_id", "bayt", "code", "adet", "hata_turu", "silinen", "silinen_bayt", "yarim_silinen", "isaretlenen", "tutulan"]);
    for (const g of t.gunluk.girdiler) {
      assert.equal(g.modul, "ajanda_ekler");
      for (const anahtar of Object.keys(g.alanlar ?? {})) assert.ok(izinli.has(anahtar), `izinsiz alan ${g.olay}.${anahtar}`);
    }
  });
});

describe("ek yedeği: kaynak sınırları (inceleme bulguları)", () => {
  /** Bir `ek_parca` çerçevesinin kablodaki boyu (base64 + zarf), üst kestirim. */
  const PARCA_METNI = Math.ceil(PARCA / 3) * 4 + 200;

  it("indirme seli: okumayan istemcinin tamponu INDIRME_TAMPONU + bir parçayı aşmaz; aşınca ek_ret{ic_hata}, boşalınca sürer", async () => {
    const t = kur();
    const e = ekUret("ek_1", AJANDA_SINIRLARI.EK_BAYT);
    t.sd.tamlar.set(e.ozet, e.veri);
    const tampon = { bayt: 0 };
    const b = t.oturum({ tampon });
    // Boş tamponda tam pencere (~1,4 MB < 2 MiB).
    const p1 = await b.iste(e, 0);
    assert.equal(p1.filter((m) => m.type === "ek_parca").length, AJANDA_SINIRLARI.EK_PENCERE);
    // Okunmadan ikinci istek: pencere tampon dolunca kısa kapanır, gonderilen gidene kadarını söyler.
    const p2 = await b.iste(e, 4 * PARCA);
    const son = p2.at(-1)!;
    assert.equal(son.type, "ek_durum");
    assert.equal(son.tamam, false);
    assert.ok(son.gonderilen > 4 * PARCA && son.gonderilen < 8 * PARCA, String(son.gonderilen));
    assert.equal(p2.filter((m) => m.type === "ek_parca").length, (son.gonderilen - 4 * PARCA) / PARCA);
    // Sel: her istek yalnız küçük bir ret alır, tampon büyümez; günlüğe tek uyarı.
    const sel: Msg[] = [];
    for (let i = 0; i < 50; i++) sel.push(...(await b.iste(e, son.gonderilen)));
    assert.deepEqual(new Set(sel.map((m) => `${m.type}:${m.code}`)), new Set(["ek_ret:ic_hata"]));
    assert.equal(sel.length, 50);
    assert.ok(tampon.bayt <= AJANDA_EK_SINIRLARI.INDIRME_TAMPONU + PARCA_METNI + 50 * 100, String(tampon.bayt));
    assert.equal(t.gunluk.bul("ek_tampon_siniri").length, 1);
    assert.equal(t.gunluk.bul("ek_ret").length, 0);
    // İstemci okudu (tampon boşaldı): kaldığı yerden tam pencere.
    tampon.bayt = 0;
    const p3 = await b.iste(e, son.gonderilen);
    assert.equal(p3.filter((m) => m.type === "ek_parca").length, AJANDA_SINIRLARI.EK_PENCERE);
    assert.equal(p3.at(-1)!.gonderilen, son.gonderilen + 4 * PARCA);
  });

  it("bekleyenBayt atarsa 0 sayılır: indirme sürer, işleyici düşmez", async () => {
    const t = kur();
    const e = ekUret("ek_1", 100);
    t.sd.tamlar.set(e.ozet, e.veri);
    const gelen: Msg[] = [];
    const o = t.ekler.oturumAc({
      gonder: (m) => gelen.push(m as Msg),
      bekleyenBayt: () => {
        throw new Error("kapali");
      },
    });
    o.cerceve({ v: AJANDA_SURUMU, type: "ek_iste", istek_id: "i", ek_id: "ek_1", ozet: e.ozet, ofset: 0 } as AjandaEkCercevesi);
    await t.ekler.bekle();
    assert.deepEqual(gelen.map((m) => m.type), ["ek_parca", "ek_durum"]);
  });

  it("çok sayıda küçük dosya: her biri en az BLOK_BAYT sayılır; dosya sayısı DOSYA_ADET'i aşamaz; ek_yukle diski taramaz", async () => {
    const t = kur({ kotaBayt: 8 * BLOK });
    for (let i = 0; i < 8; i++) {
      const v = baytlar(16, 100 + i);
      t.sd.tamlar.set(sha256Hex(v), v);
    }
    const e = ekUret("ek_1", 16, 7);
    t.kayitKoy(kayit("k1", [e]));
    const b = t.oturum();
    // 8 × 16 bayt = 128 bayt, ama 8 blok: kota dolu.
    assert.deepEqual(await b.yukle("k1", e), [ret("ek_1", "kota_asildi")]);
    assert.deepEqual(t.ekler.olcum(), {
      hazir: true,
      kullanilan_bayt: 8 * BLOK,
      dosya_adet: 8,
      ayrilan_adet: 0,
      dokunulan_adet: 0,
      kota_bayt: 8 * BLOK,
    });

    const t2 = kur();
    for (let i = 0; i < AJANDA_EK_SINIRLARI.DOSYA_ADET; i++) t2.sd.tamlar.set(i.toString(16).padStart(64, "0"), new Uint8Array(1));
    const e2 = ekUret("ek_2", 16, 9);
    t2.kayitKoy(kayit("k1", [e2]));
    const b2 = t2.oturum();
    assert.deepEqual(await b2.yukle("k1", e2), [ret("ek_2", "kota_asildi")]);
    const olcum = t2.ekler.olcum();
    assert.equal(olcum.dosya_adet, AJANDA_EK_SINIRLARI.DOSYA_ADET);
    assert.ok(olcum.kullanilan_bayt < olcum.kota_bayt, "bayt kotası değil, sayı tavanı");
    // Diski yalnız ilk yükleme bir kez taradı; sonrakiler bellekten.
    const tarama = (): number => t2.sd.cagrilar.filter((c) => c === "tamListesi" || c === "yarimListesi").length;
    assert.equal(tarama(), 2);
    for (let i = 0; i < 5; i++) await b2.yukle("k1", e2);
    assert.equal(tarama(), 2);
    // Bir dosya dışarıdan gitti: temizlik turunun taramasından sonra yer var.
    t2.sd.tamlar.delete((0).toString(16).padStart(64, "0"));
    await t2.ekler.temizle();
    assert.deepEqual(await b2.yukle("k1", e2), [durum("ek_2", 0, false)]);
  });

  it("kota dolunca en eski başvurusuz işaretli dosya saklama süresi beklenmeden silinir; başvurulan ve yeniden başvurulan kalır", async () => {
    const t = kur({ kotaBayt: 10 * BLOK });
    const geri = ekUret("ek_g", BLOK, 4);
    const eski = ekUret("ek_e", 3 * BLOK, 1);
    const yeni = ekUret("ek_y", 3 * BLOK, 2);
    const tutulan = ekUret("ek_t", 3 * BLOK, 3);
    for (const e of [geri, eski, yeni, tutulan]) t.sd.tamlar.set(e.ozet, e.veri);
    t.kayitKoy(kayit("k_t", [tutulan]));
    t.kayitKoy(kayit("k_sil", [geri, eski, yeni], { silindi: true }));
    t.sd.isaretler.set(geri.ozet, BASLANGIC - 5 * GUN);
    t.sd.isaretler.set(eski.ozet, BASLANGIC - 3 * GUN);
    t.sd.isaretler.set(yeni.ozet, BASLANGIC - 2 * GUN);
    await t.ekler.temizle();
    assert.equal(t.sd.tamlar.size, 4, "30 gün dolmadı: tur silmez");
    // En eski işaretli dosya az önce yeniden başvuruldu (geri yükleme): silinmez, işareti kalkar.
    t.kayitKoy(kayit("k_g", [geri]));
    const n = ekUret("ek_n", 2 * BLOK, 5);
    t.kayitKoy(kayit("k_n", [n]));
    const b = t.oturum();
    assert.deepEqual(await b.yukle("k_n", n), [durum("ek_n", 0, false)]);
    assert.deepEqual(new Set(t.sd.tamlar.keys()), new Set([geri.ozet, yeni.ozet, tutulan.ozet]));
    assert.deepEqual([...t.sd.isaretler.keys()], [yeni.ozet]);
    assert.deepEqual(t.gunluk.bul("ek_kota_temizligi")[0]!.alanlar, { silinen: 1, silinen_bayt: 3 * BLOK });
    // Hepsi silinse de yetmeyecek yükleme: hiçbir dosya silinmez, kota_asildi.
    const dev = ekUret("ek_d", 9 * BLOK, 6);
    t.kayitKoy(kayit("k_d", [dev]));
    assert.deepEqual(await b.yukle("k_d", dev), [ret("ek_d", "kota_asildi")]);
    assert.equal(t.sd.tamlar.has(yeni.ozet), true);
  });

  it("eşzamanlı yüklemeler: kabul edilenin boyu ayrılır, ikinci bağlantı kotayı aşamaz; yükleme unutulunca ya da bitince bırakılır", async () => {
    const t = kur({ kotaBayt: 6 * BLOK });
    const a = ekUret("ek_a", 4 * BLOK, 1);
    const c = ekUret("ek_c", 4 * BLOK, 2);
    t.kayitKoy(kayit("k1", [a, c]));
    const b1 = t.oturum();
    const b2 = t.oturum();
    const yukle = (e: Ek) =>
      ({ v: AJANDA_SURUMU, type: "ek_yukle", istek_id: "i", kayit_id: "k1", ek_id: e.ek_id, ozet: e.ozet, bayt: e.bayt }) as AjandaEkCercevesi;
    const olc = (x: ReturnType<typeof kur>) => ({ bayt: x.ekler.olcum().kullanilan_bayt, ayrilan: x.ekler.olcum().ayrilan_adet });
    // İkisi de hiç bayt yazılmadan aynı anda gelir.
    b1.o.cerceve(yukle(a));
    b2.o.cerceve(yukle(c));
    await t.ekler.bekle();
    assert.deepEqual(b1.gelen, [durum("ek_a", 0, false)]);
    assert.deepEqual(b2.gelen, [ret("ek_c", "kota_asildi")]);
    assert.deepEqual(olc(t), { bayt: 4 * BLOK, ayrilan: 1 });
    // Bağlantı koptu: ayrım bırakılır (yarım yok, kullanım sıfır).
    b1.o.kapat();
    assert.deepEqual(olc(t), { bayt: 0, ayrilan: 0 });
    assert.equal((await b2.hepsi("k1", c)).tamam, true);
    assert.deepEqual(olc(t), { bayt: 4 * BLOK, ayrilan: 0 });
    // Sınırda unutulan yükleme de bırakır: BAGLANTI_YUKLEME + 1 yükleme, en eskinin ayrımı düşer.
    const t2 = kur({ kotaBayt: 100 * BLOK });
    const ucu = [ekUret("ek_1", 10 * BLOK, 11), ekUret("ek_2", 10 * BLOK, 12), ekUret("ek_3", 10 * BLOK, 13)];
    t2.kayitKoy(kayit("k1", ucu));
    const b3 = t2.oturum();
    for (const e of ucu) await b3.yukle("k1", e);
    assert.deepEqual(olc(t2), { bayt: 20 * BLOK, ayrilan: 2 });
  });

  it("bağlantı ek_yukle diskte beklerken kapanırsa ayrım sızmaz", async () => {
    const t = kur({ kotaBayt: 100 * BLOK });
    const a = ekUret("ek_a", 4 * BLOK, 1);
    t.kayitKoy(kayit("k1", [a]));
    const b = t.oturum();
    const asil = t.sd.disk.tamBoyutu;
    let birKez = true;
    t.sd.disk.tamBoyutu = async (ozet) => {
      if (birKez) {
        birKez = false;
        b.o.kapat();
      }
      return asil(ozet);
    };
    b.o.cerceve({ v: AJANDA_SURUMU, type: "ek_yukle", istek_id: "i", kayit_id: "k1", ek_id: a.ek_id, ozet: a.ozet, bayt: a.bayt } as AjandaEkCercevesi);
    await t.ekler.bekle();
    assert.deepEqual(b.gelen, []);
    assert.equal(t.ekler.olcum().ayrilan_adet, 0);
    assert.equal(t.ekler.olcum().kullanilan_bayt, 0);
  });

  it("yarım sınırı ayrımı da sayar: aynı anda YARIM_ADET'ten fazla yeni yükleme açılamaz", async () => {
    const t = kur();
    const n = AJANDA_EK_SINIRLARI.YARIM_ADET + 1;
    const A = AJANDA_SINIRLARI.EK_ADET;
    const ekler = Array.from({ length: n }, (_, i) => ekUret(`ek_${i}`, 100, 200 + i));
    for (let i = 0; i < n; i += A) t.kayitKoy(kayit(`k${i}`, ekler.slice(i, i + A)));
    const oturumlar = ekler.map(() => t.oturum());
    ekler.forEach((e, i) => {
      const kayit_id = `k${i - (i % A)}`;
      oturumlar[i]!.o.cerceve({ v: AJANDA_SURUMU, type: "ek_yukle", istek_id: "i", kayit_id, ek_id: e.ek_id, ozet: e.ozet, bayt: e.bayt } as AjandaEkCercevesi);
    });
    await t.ekler.bekle();
    const yanitlar = oturumlar.map((b) => b.gelen[0]!);
    assert.equal(yanitlar.filter((m) => m.type === "ek_durum").length, AJANDA_EK_SINIRLARI.YARIM_ADET);
    assert.deepEqual(yanitlar.at(-1), ret(`ek_${n - 1}`, "ic_hata"));
    assert.equal(t.sd.yarimlar.size, 0, "henüz hiçbir yarım diskte değil");
  });

  it("dokunulan: var olmayan özetle ek_iste haritayı büyütmez; harita her turda, tur atsa da temizlenir", async () => {
    const t = kur();
    const b = t.oturum();
    for (let i = 0; i < 300; i++) {
      const ozet = sha256Hex(baytlar(8, 5000 + i));
      assert.deepEqual(await b.gonder({ type: "ek_iste", istek_id: "i", ek_id: "ek_x", ozet, ofset: 0 }), [ret("ek_x", "ek_yok")]);
    }
    assert.equal(t.ekler.olcum().dokunulan_adet, 0);
    const e = ekUret("ek_1", 100);
    t.sd.tamlar.set(e.ozet, e.veri);
    await b.iste(e, 0);
    assert.equal(t.ekler.olcum().dokunulan_adet, 1);
    t.zaman.ilerlet(1);
    t.sd.atsin.add("isaretleriOku");
    await assert.rejects(t.ekler.temizle());
    assert.equal(t.ekler.olcum().dokunulan_adet, 0);
  });

  it("temizlik: anlık görüntüden sonra yeniden başvurulan dosya silinmez (silmeden hemen önce yeniden denetim)", async () => {
    const t = kur();
    const a = ekUret("ek_a", 100, 1);
    const c = ekUret("ek_c", 100, 2);
    t.sd.tamlar.set(a.ozet, a.veri);
    t.sd.isaretler.set(a.ozet, BASLANGIC - 31 * GUN);
    t.kayitKoy(kayit("k_sil", [a], { silindi: true }));
    // Yeni başvurusuz c işaretlenir: işaretler silmeden önce yazılır; o anda a yeniden başvurulur.
    t.sd.tamlar.set(c.ozet, c.veri);
    const asil = t.sd.disk.isaretleriYaz;
    let birKez = true;
    t.sd.disk.isaretleriYaz = async (m) => {
      if (birKez) {
        birKez = false;
        t.kayitKoy(kayit("k_sil", [a]));
      }
      return asil(m);
    };
    const s = await t.ekler.temizle();
    assert.equal(s.silinen, 0);
    assert.ok(t.sd.tamlar.has(a.ozet));
    assert.equal(t.sd.isaretler.has(a.ozet), false, "yeniden başvurulanın işareti kalkar");
    assert.ok(t.sd.isaretler.has(c.ozet));
  });

  it("silmeler arasında kayıtlar değişmediyse yeniden okunmaz (revizyon aynı)", async () => {
    const t = kur();
    const dosyalar = Array.from({ length: 20 }, (_, i) => ekUret(`ek_${i}`, 10, 300 + i));
    for (const e of dosyalar) {
      t.sd.tamlar.set(e.ozet, e.veri);
      t.sd.isaretler.set(e.ozet, BASLANGIC - 31 * GUN);
    }
    t.kayitKoy(kayit("k1", []));
    const once = t.sayac.okuma;
    assert.equal((await t.ekler.temizle()).silinen, 20);
    assert.equal(t.sayac.okuma - once, 1);
  });
});
