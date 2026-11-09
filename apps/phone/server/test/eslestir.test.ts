import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EslestirmeQr, sha256Hex, SINIRLAR, utf8Bayt } from "@eren/protocol";
import { createHash, generateKeyPairSync } from "node:crypto";
import { depoKur } from "../src/depo.ts";
import { eslestirmeBaslat, parmakIzi } from "../src/eslestir.ts";
import type { Depo, EslestirmeBagimliliklari } from "../src/sozlesme.ts";
import { sahteAnahtar, sahteGunluk, sahteRastgele, sahteSistem, sahteZaman } from "./sahte.ts";

const BES_DK_MS = 5 * 60 * 1000;

function kur(sec: { tohum?: number; adres?: string | null; port?: number } = {}) {
  const zaman = sahteZaman();
  const rastgele = sahteRastgele(sec.tohum);
  const sistem = sahteSistem();
  if (sec.adres !== undefined) sistem.tailscale = sec.adres;
  const anahtar = sahteAnahtar();
  const depo: Depo = depoKur({ yol: ":memory:", saat: zaman.saat, gunluk: sahteGunluk() });
  const b: EslestirmeBagimliliklari = {
    depo,
    anahtar,
    sistem,
    rastgele,
    saat: zaman.saat,
    wsPort: sec.port ?? 7443,
  };
  return { zaman, rastgele, sistem, anahtar, depo, b };
}

describe("eslestir: kod", () => {
  it("8 karakter [A-Z0-9], protokol sınırları içinde", () => {
    for (let tohum = 1; tohum <= 40; tohum++) {
      const { b } = kur({ tohum });
      const s = eslestirmeBaslat(b);
      assert.equal(s.ok, true);
      if (!s.ok) return;
      assert.match(s.deger.kod, /^[A-Z0-9]{8}$/);
      assert.ok(s.deger.kod.length >= SINIRLAR.ESLESTIRME_KODU_MIN && s.deger.kod.length <= SINIRLAR.ESLESTIRME_KODU_MAX);
    }
  });

  it("QR içindeki kod elle girilen kodla aynı ve QR şemadan geçer", () => {
    const { b, anahtar } = kur({ port: 8123 });
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.deger.qr.kod, s.deger.kod);
    assert.equal(s.deger.qr.host, "100.64.0.10");
    assert.equal(s.deger.qr.port, 8123);
    assert.equal(s.deger.qr.server_public_key, anahtar.acikAnahtar());
    assert.equal(EslestirmeQr.safeParse(s.deger.qr).success, true);
  });

  it("farklı rastgelelikle farklı kod (sabit değil)", () => {
    const kodlar = new Set<string>();
    for (let tohum = 1; tohum <= 20; tohum++) {
      const s = eslestirmeBaslat(kur({ tohum }).b);
      if (s.ok) kodlar.add(s.deger.kod);
    }
    assert.ok(kodlar.size > 15);
  });

  it("aynı tohumla aynı kod (rastgele yalnız porttan gelir)", () => {
    const a = eslestirmeBaslat(kur({ tohum: 7 }).b);
    const c = eslestirmeBaslat(kur({ tohum: 7 }).b);
    assert.deepEqual(a, c);
  });
});

describe("eslestir: süre ve depo", () => {
  it("son_ms = şimdi + 5 dk, hem dönüşte hem depoda", () => {
    const { b, depo, zaman } = kur();
    zaman.ilerlet(12_345);
    const simdi = zaman.simdi();
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.deger.sonMs, simdi + BES_DK_MS);
    assert.equal(depo.eslestirmeOku()?.son_ms, simdi + BES_DK_MS);
  });

  it("depoya yalnız sha256Hex(utf8Bayt(kod)) yazılır; düz kod depoda yok", () => {
    const { b, depo } = kur({ tohum: 99 });
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    const kayit = depo.eslestirmeOku();
    assert.ok(kayit);
    assert.equal(kayit.kod_ozeti, sha256Hex(utf8Bayt(s.deger.kod)));
    assert.equal(kayit.yanlis_deneme, 0);
    assert.equal(JSON.stringify(kayit).includes(s.deger.kod), false);
  });

  it("yeni komut eskisini ezer: tek kayıt, eski kodun özeti gider, sayaç sıfırlanır", () => {
    const { b, depo, zaman } = kur({ tohum: 3 });
    const ilk = eslestirmeBaslat(b);
    assert.equal(ilk.ok, true);
    if (!ilk.ok) return;
    depo.eslestirmeYanlisSay();
    assert.equal(depo.eslestirmeOku()?.yanlis_deneme, 1);
    zaman.ilerlet(60_000);
    const ikinci = eslestirmeBaslat(b);
    assert.equal(ikinci.ok, true);
    if (!ikinci.ok) return;
    assert.notEqual(ikinci.deger.kod, ilk.deger.kod);
    const kayit = depo.eslestirmeOku();
    assert.equal(kayit?.kod_ozeti, sha256Hex(utf8Bayt(ikinci.deger.kod)));
    assert.notEqual(kayit?.kod_ozeti, sha256Hex(utf8Bayt(ilk.deger.kod)));
    assert.equal(kayit?.yanlis_deneme, 0);
    assert.equal(kayit?.son_ms, zaman.simdi() + BES_DK_MS);
  });
});

describe("eslestir: parmak izi", () => {
  it("P-256 SPKI DER için büyük harf, 4'lü gruplu SHA-256", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const der = publicKey.export({ type: "spki", format: "der" });
    const beklenen = createHash("sha256")
      .update(der)
      .digest("hex")
      .toUpperCase()
      .match(/.{4}/g)!
      .join(" ");
    const s = parmakIzi(der.toString("base64"));
    assert.equal(s, beklenen);
    assert.match(s, /^([0-9A-F]{4} ){15}[0-9A-F]{4}$/);
  });

  it("sabit bilinen bayt dizisi için sabit değer", () => {
    // "abc" baytlarının SHA-256'sı (FIPS 180-2 örneği)
    assert.equal(
      parmakIzi("YWJj"),
      "BA78 16BF 8F01 CFEA 4141 40DE 5DAE 2223 B003 61A3 9617 7A9C B410 FF61 F200 15AD",
    );
  });
});

describe("eslestir: adres reddi", () => {
  const kotuAdresler = ["192.168.1.5", "10.0.0.1", "100.63.255.255", "100.128.0.1", "127.0.0.1", "8.8.8.8", "100.64.0.1.5", ""];
  for (const adres of kotuAdresler) {
    it(`Tailscale dışı adres reddedilir: "${adres}"`, () => {
      const { b, depo } = kur({ adres });
      const s = eslestirmeBaslat(b);
      assert.equal(s.ok, false);
      if (s.ok) return;
      assert.equal(s.code, "ic_hata");
      assert.equal(depo.eslestirmeOku(), null);
    });
  }

  it("Tailscale adresi yoksa (null) hata, depoya yazılmaz", () => {
    const { b, depo } = kur({ adres: null });
    const s = eslestirmeBaslat(b);
    assert.equal(s.ok, false);
    if (s.ok) return;
    assert.equal(s.code, "ic_hata");
    assert.equal(depo.eslestirmeOku(), null);
  });

  it("aralık sınırları kabul edilir: 100.64.0.0 ve 100.127.255.255", () => {
    for (const adres of ["100.64.0.0", "100.127.255.255"]) {
      const { b } = kur({ adres });
      const s = eslestirmeBaslat(b);
      assert.equal(s.ok, true, adres);
      if (s.ok) assert.equal(s.deger.qr.host, adres);
    }
  });

  it("reddedilen çağrı önceki geçerli kaydı bozmaz", () => {
    const { b, depo, sistem } = kur({ tohum: 5 });
    const ilk = eslestirmeBaslat(b);
    assert.equal(ilk.ok, true);
    const onceki = depo.eslestirmeOku();
    sistem.tailscale = "192.168.0.2";
    assert.equal(eslestirmeBaslat(b).ok, false);
    assert.deepEqual(depo.eslestirmeOku(), onceki);
  });
});
