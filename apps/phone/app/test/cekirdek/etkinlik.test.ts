import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AkisEtkinligi, AssistantActivity } from "@eren/protocol";
import { etkinlikKur } from "../../src/cekirdek/etkinlik.ts";
import type { KaliciOlay } from "../../src/cekirdek/sozlesme.ts";

const cer = (turn_id: string, etkinlik: AkisEtkinligi, gecen_ms: number): AssistantActivity =>
  ({ v: 5, type: "assistant_activity", sohbet_id: "s1", turn_id, etkinlik, gecen_ms }) as AssistantActivity;

const olay = (x: unknown): KaliciOlay => x as KaliciOlay;
const bitis = (turn_id: string): KaliciOlay => olay({ type: "assistant_message", turn_id });
const iptal = (turn_id: string): KaliciOlay => olay({ type: "turn_aborted", turn_id });

describe("etkinlik", () => {
  it("başlangıç telefonun saatinden hesaplanır", () => {
    const e = etkinlikKur();
    assert.equal(e.durum(), null);
    e.cerceve(cer("t1", "komut", 300), 10_000);
    assert.deepEqual(e.durum(), { turn_id: "t1", etkinlik: "komut", baslangic_ms: 9_700 });
  });

  it("aynı turda yeni etkinlik durumu değiştirir", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t1", "dusunuyor", 0), 1_000);
    e.cerceve(cer("t1", "yaziyor", 50), 5_000);
    assert.deepEqual(e.durum(), { turn_id: "t1", etkinlik: "yaziyor", baslangic_ms: 4_950 });
  });

  it("yeni turun çerçevesi öncekinin yerine geçer", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t1", "web", 0), 1_000);
    e.cerceve(cer("t2", "plan", 100), 2_000);
    assert.deepEqual(e.durum(), { turn_id: "t2", etkinlik: "plan", baslangic_ms: 1_900 });
  });

  it("assistant_message durumu siler; geç gelen çerçeve yok sayılır", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t1", "yaziyor", 0), 1_000);
    e.olay(bitis("t1"));
    assert.equal(e.durum(), null);
    e.cerceve(cer("t1", "yaziyor", 10), 2_000);
    assert.equal(e.durum(), null);
  });

  it("turn_aborted durumu siler; geç gelen çerçeve yok sayılır", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t1", "arac", 0), 1_000);
    e.olay(iptal("t1"));
    assert.equal(e.durum(), null);
    e.cerceve(cer("t1", "arac", 10), 2_000);
    assert.equal(e.durum(), null);
  });

  it("çerçeveden önce gelen bitiş olayı da turu kapatır", () => {
    const e = etkinlikKur();
    e.olay(bitis("t1"));
    e.cerceve(cer("t1", "ekran", 0), 1_000);
    assert.equal(e.durum(), null);
  });

  it("başka turun bitiş olayı mevcut durumu silmez", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t2", "dosya_okuma", 0), 1_000);
    e.olay(bitis("t1"));
    assert.equal(e.durum()?.turn_id, "t2");
  });

  it("bitti mevcut turun durumunu siler; geç gelen çerçeve yok sayılır", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t1", "komut", 0), 1_000);
    e.bitti("t1");
    assert.equal(e.durum(), null);
    e.cerceve(cer("t1", "komut", 10), 2_000);
    assert.equal(e.durum(), null);
  });

  it("bitti başka turun durumunu silmez ama o turu kapatır", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t2", "plan", 0), 1_000);
    e.bitti("t1");
    assert.equal(e.durum()?.turn_id, "t2");
    e.cerceve(cer("t1", "plan", 0), 2_000);
    assert.equal(e.durum()?.turn_id, "t2");
  });

  it("durum yokken bitti hata vermez; bitti ve kalıcı bitiş her sırada sorun çıkarmaz", () => {
    const e = etkinlikKur();
    e.bitti("t1");
    assert.equal(e.durum(), null);
    e.cerceve(cer("t2", "web", 0), 1_000);
    e.bitti("t2");
    e.olay(bitis("t2"));
    assert.equal(e.durum(), null);
    e.cerceve(cer("t3", "web", 0), 1_000);
    e.olay(iptal("t3"));
    e.bitti("t3");
    assert.equal(e.durum(), null);
    e.cerceve(cer("t3", "web", 0), 2_000);
    assert.equal(e.durum(), null);
  });

  it("bitti kaydı da 64 ile sınırlı", () => {
    const e = etkinlikKur();
    e.bitti("eski");
    for (let i = 0; i < 100; i++) e.bitti(`x${i}`);
    e.cerceve(cer("eski", "web", 0), 1_000);
    assert.equal(e.durum()?.turn_id, "eski");
  });

  it("koptu durumu siler, sonraki çerçeve yeniden kurar", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t1", "komut", 0), 1_000);
    e.koptu();
    assert.equal(e.durum(), null);
    e.cerceve(cer("t1", "komut", 0), 2_000);
    assert.equal(e.durum()?.baslangic_ms, 2_000);
  });

  it("sifirla durumu ve biten tur kaydını temizler", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t1", "komut", 0), 1_000);
    e.olay(bitis("t1"));
    e.sifirla();
    assert.equal(e.durum(), null);
    e.cerceve(cer("t1", "dosya_yazma", 0), 3_000);
    assert.equal(e.durum()?.etkinlik, "dosya_yazma");
    e.sifirla();
    assert.equal(e.durum(), null);
  });

  it("ilgisiz olay türleri durumu değiştirmez", () => {
    const e = etkinlikKur();
    e.cerceve(cer("t1", "is_bilgisi", 0), 1_000);
    const once = e.durum();
    e.olay(olay({ type: "user_echo", turn_id: "t1" }));
    assert.equal(e.durum(), once);
  });

  it("biten tur kaydı sınırsız büyümez: çok eski bitiş unutulur", () => {
    const e = etkinlikKur();
    e.olay(bitis("eski"));
    for (let i = 0; i < 100; i++) e.olay(bitis(`x${i}`));
    e.cerceve(cer("eski", "web", 0), 1_000);
    assert.equal(e.durum()?.turn_id, "eski");
    e.cerceve(cer("x99", "web", 0), 2_000);
    assert.equal(e.durum()?.turn_id, "eski");
  });
});
