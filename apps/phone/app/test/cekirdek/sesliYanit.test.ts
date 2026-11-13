import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Olay } from "@eren/protocol";
import { SESLI_YANIT_SINIRLARI, sesliYanitKur } from "../../src/cekirdek/sesliYanit.ts";
import type { SesliYanit } from "../../src/cekirdek/sesliYanit.ts";
import type { KaliciOlay } from "../../src/cekirdek/sozlesme.ts";

const kur = (ham: Record<string, unknown>): KaliciOlay => Olay.parse(ham);

const yanki = (seq: number, client_msg_id: string, input = "yazi"): KaliciOlay =>
  kur({ seq, ts_ms: 1000 + seq, type: "user_echo", sohbet_id: "ana", client_msg_id, input, text: "soru" });
const cevap = (seq: number, turn_id: string, text: string): KaliciOlay =>
  kur({ seq, ts_ms: 1000 + seq, type: "assistant_message", sohbet_id: "ana", turn_id, text });
const kesildi = (seq: number, turn_id: string): KaliciOlay =>
  kur({ seq, ts_ms: 1000 + seq, type: "turn_aborted", sohbet_id: "ana", turn_id, neden: "kullanici_kesti" });
const not = (seq: number): KaliciOlay =>
  kur({ seq, ts_ms: 1000 + seq, type: "system_notice", seviye: "bilgi", kod: "diger", metin: "ilgisiz" });

/** Bir dizinin bütün sıralamaları. */
const siralamalar = <T>(l: readonly T[]): T[][] =>
  l.length <= 1 ? [l.slice()] : l.flatMap((x, i) => siralamalar([...l.slice(0, i), ...l.slice(i + 1)]).map((r) => [x, ...r]));

describe("sesliYanit", () => {
  it("sesli kaydedilmiş, kaynağı bildirilmiş turun cevabı döner", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.turKaynagi("T1", "m1");
    assert.equal(y.olay(cevap(1, "T1", "**merhaba**")), "**merhaba**");
  });

  it("sıra bağımsız: önce kaynak sonra sesli kayıt da metni döndürür", () => {
    const y = sesliYanitKur();
    y.turKaynagi("T1", "m1");
    y.sesliGonderildi("m1");
    assert.equal(y.olay(cevap(1, "T1", "cevap")), "cevap");
  });

  it("araya user_echo ve ilgisiz olaylar girse de sonuç değişmez", () => {
    const y = sesliYanitKur();
    assert.equal(y.olay(not(1)), null);
    y.sesliGonderildi("m1");
    assert.equal(y.olay(yanki(2, "m1", "dikte")), null);
    assert.equal(y.olay(yanki(3, "m2", "yazi")), null);
    y.turKaynagi("T1", "m1");
    assert.equal(y.olay(not(4)), null);
    assert.equal(y.olay(cevap(5, "T1", "cevap")), "cevap");
  });

  it("kaynağı bildirilmemiş turun cevabı okunmaz (sentetik tur, eski servis)", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.olay(yanki(1, "m1", "dikte"));
    assert.equal(y.olay(cevap(2, "T-sentetik", "sentetik")), null);
    // Sesli mesajın kendi turu bundan etkilenmez.
    y.turKaynagi("T1", "m1");
    assert.equal(y.olay(cevap(3, "T1", "sesliye")), "sesliye");
  });

  it("kaynağı sesli kaydedilmemiş mesaj olan turun cevabı okunmaz (yazılı, başka cihaz)", () => {
    const y = sesliYanitKur();
    y.turKaynagi("T1", "yazili");
    assert.equal(y.olay(cevap(1, "T1", "yazılıya")), null);
    y.olay(yanki(2, "baska-cihaz", "dikte"));
    y.turKaynagi("T2", "baska-cihaz");
    assert.equal(y.olay(cevap(3, "T2", "başka cihaza")), null);
  });

  it("gözden geçirme senaryosu: sesli cevap okunur, ardından gelen yazılı mesajın cevabı okunmaz", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.turKaynagi("T1", "m1");
    assert.equal(y.olay(cevap(1, "T1", "sesliye")), "sesliye");
    y.turKaynagi("T2", "m2");
    assert.equal(y.olay(cevap(2, "T2", "yazılıya")), null);
  });

  it("karıştırılmış her sırada yazılı mesajın cevabı okunmaz, seslininki bir kez okunur", () => {
    type Adim = "sesli" | "kaynak1" | "yanki1" | "kaynak2" | "yanki2" | "bitis2";
    const adimlar: Adim[] = ["sesli", "kaynak1", "yanki1", "kaynak2", "yanki2", "bitis2"];
    let denenen = 0;
    for (const sira of siralamalar(adimlar)) {
      const y = sesliYanitKur();
      let seq = 0;
      for (const a of sira) {
        switch (a) {
          case "sesli":
            y.sesliGonderildi("m1");
            break;
          case "kaynak1":
            y.turKaynagi("T1", "m1");
            break;
          case "yanki1":
            assert.equal(y.olay(yanki(++seq, "m1", "dikte")), null, sira.join(","));
            break;
          case "kaynak2":
            y.turKaynagi("T2", "m2");
            break;
          case "yanki2":
            assert.equal(y.olay(yanki(++seq, "m2", "yazi")), null, sira.join(","));
            break;
          case "bitis2":
            assert.equal(y.olay(cevap(++seq, "T2", "yazılıya")), null, sira.join(","));
            break;
        }
      }
      assert.equal(y.olay(cevap(++seq, "T1", "sesliye")), "sesliye", sira.join(","));
      // Yazılının turu en sonda yeniden gelse de okunmaz.
      assert.equal(y.olay(cevap(++seq, "T2", "yazılıya")), null, sira.join(","));
      denenen++;
    }
    assert.equal(denenen, 720);
  });

  it("aynı olay yinelenirse cevap ikinci kez dönmez", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.turKaynagi("T1", "m1");
    const o = cevap(1, "T1", "bir kez");
    assert.equal(y.olay(o), "bir kez");
    assert.equal(y.olay(o), null);
  });

  it("aynı tur yeni seq ile yeniden gelirse cevap ikinci kez dönmez", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.turKaynagi("T1", "m1");
    assert.equal(y.olay(cevap(1, "T1", "bir kez")), "bir kez");
    assert.equal(y.olay(cevap(2, "T1", "bir kez")), null);
  });

  it("turn_aborted okutmaz; aynı tur için sonradan gelen assistant_message de okunmaz", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.turKaynagi("T1", "m1");
    assert.equal(y.olay(kesildi(1, "T1")), null);
    assert.equal(y.olay(cevap(2, "T1", "geç")), null);
  });

  it("turn_aborted yalnız kendi turunu temizler", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.sesliGonderildi("m2");
    y.turKaynagi("T1", "m1");
    y.turKaynagi("T2", "m2");
    assert.equal(y.olay(kesildi(1, "T1")), null);
    assert.equal(y.olay(cevap(2, "T2", "ikiye")), "ikiye");
  });

  it("unut: turu kaynak bildiriminden önce ya da sonra unutulan mesajın cevabı okunmaz, diğerleri etkilenmez", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.sesliGonderildi("m2");
    y.sesliGonderildi("m3");
    y.unut("m1");
    y.turKaynagi("T1", "m1");
    y.turKaynagi("T2", "m2");
    y.turKaynagi("T3", "m3");
    y.unut("m3");
    assert.equal(y.olay(cevap(1, "T1", "bire")), null);
    assert.equal(y.olay(cevap(2, "T3", "üçe")), null);
    assert.equal(y.olay(cevap(3, "T2", "ikiye")), "ikiye");
  });

  it("sifirla: sesli kayıtlar ve kaynak bildirimleri unutulur", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.turKaynagi("T1", "m1");
    y.sesliGonderildi("m2");
    y.turKaynagi("T3", "m3");
    y.sifirla();
    assert.equal(y.olay(cevap(1, "T1", "bire")), null);
    // m2'nin sesli kaydı da gitti.
    y.turKaynagi("T2", "m2");
    assert.equal(y.olay(cevap(2, "T2", "ikiye")), null);
    // T3'ün kaynağı da gitti: m3 sonradan sesli kaydedilse bile T3 kaynaksızdır.
    y.sesliGonderildi("m3");
    assert.equal(y.olay(cevap(3, "T3", "üçe")), null);
    // Sıfırlamadan sonra yeni kayıt normal çalışır.
    y.sesliGonderildi("m4");
    y.turKaynagi("T4", "m4");
    assert.equal(y.olay(cevap(4, "T4", "dörde")), "dörde");
  });

  it("SESLI_YANIT_SINIRLARI dışa açık bir nesnedir, değerleri pozitif tamsayıdır", () => {
    assert.equal(typeof SESLI_YANIT_SINIRLARI, "object");
    const degerler = Object.values(SESLI_YANIT_SINIRLARI as Record<string, unknown>);
    assert.ok(degerler.length > 0);
    for (const d of degerler) assert.ok(Number.isInteger(d) && (d as number) > 0, String(d));
  });

  it("sınır: 500 cevapsız sesli mesaj ve bitmeyen tur sonrası en yeni kayıt çalışır", () => {
    const y = sesliYanitKur();
    const N = 500;
    for (let i = 0; i < N; i++) {
      y.sesliGonderildi(`s${i}`);
      y.turKaynagi(`T${i}`, `s${i}`);
    }
    assert.equal(y.olay(cevap(1, `T${N - 1}`, "en yeniye")), "en yeniye");
    y.sesliGonderildi("yeni");
    y.turKaynagi("T-yeni", "yeni");
    assert.equal(y.olay(cevap(2, "T-yeni", "yeniye")), "yeniye");
  });

  it("sınır: 500 yalnız sesli kayıt ve 500 yalnız kaynak bildirimi ayrı ayrı birikince en yeni kayıt çalışır", () => {
    const y = sesliYanitKur();
    const N = 500;
    for (let i = 0; i < N; i++) y.sesliGonderildi(`s${i}`);
    for (let i = 0; i < N; i++) y.turKaynagi(`K${i}`, `yazili${i}`);
    y.turKaynagi("T-son", `s${N - 1}`);
    assert.equal(y.olay(cevap(1, "T-son", "sona")), "sona");
    y.turKaynagi(`K${N}`, "yeni");
    y.sesliGonderildi("yeni");
    assert.equal(y.olay(cevap(2, `K${N}`, "yeniye")), "yeniye");
  });

  it("turKaynagi aynı değerle yinelenirse davranış değişmez", () => {
    const y = sesliYanitKur();
    y.sesliGonderildi("m1");
    y.turKaynagi("T1", "m1");
    y.turKaynagi("T1", "m1");
    y.olay(yanki(1, "m1", "dikte"));
    y.turKaynagi("T1", "m1");
    assert.equal(y.olay(cevap(2, "T1", "bir kez")), "bir kez");
    // Cevaptan sonra yinelenen bildirim turu yeniden okunur hale getirmez.
    y.turKaynagi("T1", "m1");
    assert.equal(y.olay(cevap(3, "T1", "bir kez")), null);
    // Yazılı mesajın turu için yinelenen bildirim onu sesli yapmaz.
    y.turKaynagi("T2", "m2");
    y.turKaynagi("T2", "m2");
    assert.equal(y.olay(cevap(4, "T2", "yazılıya")), null);
  });
});
