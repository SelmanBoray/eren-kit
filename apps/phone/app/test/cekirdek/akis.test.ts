import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Olay } from "@eren/protocol";
import { akisKur } from "../../src/cekirdek/akis.ts";
import type { AkisCercevesi } from "../../src/cekirdek/akis.ts";
import { asistanOlayi, delta, snapshot } from "./sahte.ts";

const c = (x: unknown): AkisCercevesi => x as AkisCercevesi;

describe("akis", () => {
  it("snapshot + offset'li delta doğru birleşir", () => {
    const a = akisKur();
    assert.equal(a.cerceve(c(snapshot("t1", "Merhaba"))), true);
    assert.deepEqual(a.durum(), { turn_id: "t1", metin: "Merhaba" });
    assert.equal(a.cerceve(c(delta("t1", 7, " dünya"))), true);
    assert.equal(a.cerceve(c(delta("t1", 13, "!"))), true);
    assert.deepEqual(a.durum(), { turn_id: "t1", metin: "Merhaba dünya!" });
  });

  it("yinelenen ve kapsanan delta metni değiştirmez; örtüşen parça yalnız yeni kısmı ekler", () => {
    const a = akisKur();
    a.cerceve(c(snapshot("t1", "abcdef")));
    assert.equal(a.cerceve(c(delta("t1", 0, "abc"))), false);
    assert.equal(a.cerceve(c(delta("t1", 3, "def"))), false);
    assert.equal(a.cerceve(c(delta("t1", 4, "efgh"))), true);
    assert.equal(a.durum()?.metin, "abcdefgh");
  });

  it("boşluklu delta (kayıp parça) atılır", () => {
    const a = akisKur();
    a.cerceve(c(snapshot("t1", "abc")));
    assert.equal(a.cerceve(c(delta("t1", 10, "zzz"))), false);
    assert.equal(a.durum()?.metin, "abc");
  });

  it("kopukta akış atılır; tabansız delta kabul edilmez, snapshot yeniden kurar", () => {
    const a = akisKur();
    a.cerceve(c(snapshot("t1", "abc")));
    assert.equal(a.koptu(), true);
    assert.equal(a.durum(), null);
    assert.equal(a.cerceve(c(delta("t1", 3, "def"))), false);
    assert.equal(a.durum(), null);
    a.cerceve(c(snapshot("t1", "abcdef")));
    a.cerceve(c(delta("t1", 6, "g")));
    assert.equal(a.durum()?.metin, "abcdefg");
    assert.equal(a.koptu(), true);
    assert.equal(a.koptu(), false);
  });

  it("assistant_message akışı kapatır; geç gelen parça turu diriltmez", () => {
    const a = akisKur();
    a.cerceve(c(snapshot("t1", "yarım")));
    const tam = Olay.parse(asistanOlayi(5, "t1", "yarım ve tam metin"));
    assert.equal(a.olay(tam), true);
    assert.equal(a.durum(), null);
    assert.equal(a.cerceve(c(delta("t1", 0, "yarım"))), false);
    assert.equal(a.cerceve(c(snapshot("t1", "yarım"))), false);
    assert.equal(a.durum(), null);
  });

  it("yeni turun delta'sı offset 0 ile başlar; ortadan gelen kabul edilmez", () => {
    const a = akisKur();
    assert.equal(a.cerceve(c(delta("t1", 4, "orta"))), false);
    assert.equal(a.durum(), null);
    assert.equal(a.cerceve(c(delta("t1", 0, "baş"))), true);
    assert.equal(a.durum()?.metin, "baş");
  });

  it("durum değişmedikçe aynı nesne döner", () => {
    const a = akisKur();
    a.cerceve(c(snapshot("t1", "x")));
    const d1 = a.durum();
    a.cerceve(c(delta("t1", 0, "x")));
    assert.equal(a.durum(), d1);
  });
});
