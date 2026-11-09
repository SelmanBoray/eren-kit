import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { iyiBicimliMi, KanonikHata, kanonikJson, sha256Hex, utf8Bayt } from "../src/index.ts";

test("SHA-256 bilinen vektörleri verir", () => {
  assert.equal(
    sha256Hex(new Uint8Array()),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex(utf8Bayt("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("SHA-256 her dolgu sınırında node:crypto ile aynıdır", () => {
  for (let uzunluk = 0; uzunluk <= 300; uzunluk++) {
    const veri = new Uint8Array(uzunluk);
    for (let i = 0; i < uzunluk; i++) veri[i] = (i * 31 + uzunluk) & 0xff;
    assert.equal(sha256Hex(veri), createHash("sha256").update(veri).digest("hex"), `${uzunluk}`);
  }
});

test("SHA-256 uzun girdide node:crypto ile aynıdır", () => {
  const veri = new Uint8Array(1_000_003).fill(0x5a);
  assert.equal(sha256Hex(veri), createHash("sha256").update(veri).digest("hex"));
});

test("UTF-8 kodlaması Buffer ile aynıdır", () => {
  const ornekler = ["", "abc", "şçğüöıİ", "€", "\u{1F600} gülen", "é", "karışık ş € \u{10FFFF}"];
  for (const metin of ornekler) {
    assert.deepEqual(Buffer.from(utf8Bayt(metin)), Buffer.from(metin, "utf8"), metin);
  }
});

test("eşi olmayan vekil reddedilir", () => {
  const yuksek = String.fromCharCode(0xd83d);
  const dusuk = String.fromCharCode(0xde00);
  assert.equal(iyiBicimliMi(yuksek + dusuk), true);
  assert.equal(iyiBicimliMi(yuksek), false);
  assert.equal(iyiBicimliMi(dusuk), false);
  assert.equal(iyiBicimliMi("a" + yuksek + "b"), false);
  assert.throws(() => utf8Bayt(yuksek), KanonikHata);
  assert.throws(() => kanonikJson(yuksek), KanonikHata);
});

test("anahtarlar alan sırasından bağımsız, UTF-16 birimine göre sıralanır", () => {
  assert.equal(kanonikJson({ b: 1, a: 2 }), kanonikJson({ a: 2, b: 1 }));
  assert.equal(kanonikJson({ z: 1, a: { y: 1, b: 2 } }), '{"a":{"b":2,"y":1},"z":1}');
  // Yerel ayar kullanılsaydı "ş" "z"den önce gelirdi, "İ" "a"dan önce gelmezdi.
  assert.equal(kanonikJson({ "ş": 1, z: 2, "İ": 3, a: 4 }), '{"a":4,"z":2,"İ":3,"ş":1}');
});

test("kaçış kuralı en kısa biçimi kullanır", () => {
  assert.equal(kanonikJson('"\\'), '"\\"\\\\"');
  assert.equal(kanonikJson("\b\t\n\f\r"), '"\\b\\t\\n\\f\\r"');
  assert.equal(kanonikJson(String.fromCharCode(0x01, 0x1f)), '"\\u0001\\u001f"');
  assert.equal(kanonikJson("/"), '"/"');
  assert.equal(kanonikJson(String.fromCharCode(0x7f, 0x2028)), `"${String.fromCharCode(0x7f, 0x2028)}"`);
  assert.equal(kanonikJson("şç"), '"şç"');
});

test("kanonik metin JSON olarak geri okunur ve JSON.stringify ile aynıdır", () => {
  const deger = { a: ['x"y', "ş", 3, true, null], b: { c: "\n" } };
  assert.equal(kanonikJson(deger), JSON.stringify(deger));
  assert.deepEqual(JSON.parse(kanonikJson(deger)), deger);
});

test("undefined alan atlanır, dizide ve kökte reddedilir", () => {
  assert.equal(kanonikJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.throws(() => kanonikJson([undefined]), KanonikHata);
  assert.throws(() => kanonikJson(undefined), KanonikHata);
});

test("yalnız güvenli tam sayı kabul edilir", () => {
  assert.equal(kanonikJson(0), "0");
  assert.equal(kanonikJson(-0), "0");
  assert.equal(kanonikJson(-5), "-5");
  for (const kotu of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    assert.throws(() => kanonikJson(kotu), KanonikHata, String(kotu));
  }
});

test("düz olmayan nesne ve yasak anahtar reddedilir", () => {
  assert.throws(() => kanonikJson(new Date(0)), KanonikHata);
  assert.throws(() => kanonikJson(new Map()), KanonikHata);
  assert.throws(() => kanonikJson(() => 1), KanonikHata);
  assert.throws(() => kanonikJson(JSON.parse('{"__proto__":{"a":1}}')), KanonikHata);
});

test("çok derin yapı reddedilir", () => {
  let d: unknown = 1;
  for (let i = 0; i < 40; i++) d = [d];
  assert.throws(() => kanonikJson(d), KanonikHata);
});
