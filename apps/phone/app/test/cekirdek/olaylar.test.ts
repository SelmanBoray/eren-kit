import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Olay, Plan, planHash } from "@eren/protocol";
import { olaylarKur } from "../../src/cekirdek/olaylar.ts";
import type { KaliciOlay } from "../../src/cekirdek/sozlesme.ts";
import { asistanOlayi, HASH_A, mezarTasiOlayi, ornekPlan, yankiOlayi } from "./sahte.ts";

const olay = (ham: Record<string, unknown>): KaliciOlay => Olay.parse(ham);

const planOlayi = (seq: number, plan_id: string, hash?: string) => {
  const plan = Plan.parse(ornekPlan(plan_id));
  return { seq, ts_ms: 1, type: "plan_proposed", plan, plan_hash: hash ?? planHash(plan) };
};

describe("olaylar", () => {
  it("özeti tutan plan kart olur; plan_json ve hash doğrulanmıştır", () => {
    const o = olaylarKur();
    const ham = planOlayi(1, "p1");
    o.ekle(olay(ham));
    const kart = o.plan("p1");
    assert.ok(kart !== null);
    assert.equal(kart.durum, "bekliyor");
    assert.equal(kart.plan_hash, ham.plan_hash);
    assert.equal(planHash(JSON.parse(kart.plan_json)), ham.plan_hash);
    assert.deepEqual(o.ogeler().map((g) => g.tur), ["plan"]);
  });

  it("planHash tutmazsa kart gizlenir: içerik görünüm modeline girmez, karar için kart bulunmaz", () => {
    const o = olaylarKur();
    o.ekle(olay(planOlayi(1, "p1", HASH_A)));
    assert.equal(o.plan("p1"), null);
    assert.deepEqual(o.ogeler().map((g) => g.tur), ["plan_gizlendi"]);
    const json = JSON.stringify(o.ogeler());
    assert.ok(!json.includes("Ornek is"));
    assert.ok(!json.includes("kesin_yapilacaklar"));
  });

  it("gizlenen plana ait plan_resolved kimseyi etkilemez; başka özetin sonucu kartı kapatamaz", () => {
    const o = olaylarKur();
    o.ekle(olay(planOlayi(1, "p1")));
    const dogru = o.plan("p1")!.plan_hash;
    o.ekle(olay({ seq: 2, ts_ms: 1, type: "plan_resolved", plan_id: "p1", plan_hash: HASH_A, sonuc: "reddedildi" }));
    assert.equal(o.plan("p1")!.durum, "bekliyor");
    o.ekle(olay({ seq: 3, ts_ms: 1, type: "plan_resolved", plan_id: "p1", plan_hash: dogru, sonuc: "onaylandi", is_id: 7 }));
    assert.equal(o.plan("p1")!.durum, "onaylandi");
    assert.equal(o.plan("p1")!.is_id, 7);
  });

  it("seq <= son seq olan ve yinelenen olay yok sayılır", () => {
    const o = olaylarKur();
    o.ekle(olay(yankiOlayi(1)));
    o.ekle(olay(yankiOlayi(2)));
    o.ekle(olay(yankiOlayi(2, "baska")));
    o.ekle(olay(yankiOlayi(1, "eski")));
    assert.deepEqual(o.ogeler().map((g) => g.seq), [1, 2]);
    assert.equal(o.yankiVar("baska"), false);
    assert.equal(o.yankiVar("m1"), true);
  });

  it("assistant_message tam metni balon olarak yazar", () => {
    const o = olaylarKur();
    o.ekle(olay(asistanOlayi(1, "t1", "tam metin")));
    const g = o.ogeler()[0];
    assert.ok(g !== undefined && g.tur === "asistan");
    assert.equal(g.metin, "tam metin");
  });

  it("sifirla her şeyi temizler ve düşük seq'li olay yeniden kabul edilir", () => {
    const o = olaylarKur();
    o.ekle(olay(yankiOlayi(5)));
    o.sifirla();
    assert.equal(o.ogeler().length, 0);
    o.ekle(olay(yankiOlayi(1)));
    assert.equal(o.ogeler().length, 1);
  });

  it("ogeler değişmedikçe aynı dizi döner", () => {
    const o = olaylarKur();
    o.ekle(olay(yankiOlayi(1)));
    const a = o.ogeler();
    assert.equal(o.ogeler(), a);
    o.ekle(olay(yankiOlayi(1)));
    assert.equal(o.ogeler(), a);
  });
  it("mezar taşı: seq <= sinir_seq öğeleri ve kart konumları kalkar", () => {
    const o = olaylarKur();
    o.ekle(olay(yankiOlayi(1)));
    o.ekle(olay(planOlayi(2, "p1")));
    o.ekle(olay({ seq: 3, ts_ms: 1, type: "job_started", is_id: 7, plan_id: "p1", plan_hash: HASH_A, baslik: "b", tur: "pc" }));
    o.ekle(olay(asistanOlayi(4, "t1", "sonra")));
    assert.ok(o.plan("p1") !== null);
    assert.ok(o.is(7) !== null);
    o.ekle(olay(mezarTasiOlayi(5, 3)));
    assert.equal(o.plan("p1"), null);
    assert.equal(o.is(7), null);
    assert.equal(o.yankiVar("m1"), false);
    const g = o.ogeler();
    assert.ok(!g.some((x) => x.seq <= 3));
    assert.ok(g.some((x) => x.tur === "asistan" && x.seq === 4));
  });

  it("mezar taşı: görünümde tek GecmisSilindiNotu ve ondan sonraki olaylar kalır", () => {
    const o = olaylarKur();
    o.ekle(olay(yankiOlayi(1)));
    o.ekle(olay(yankiOlayi(2)));
    o.ekle(olay(mezarTasiOlayi(3, 2)));
    o.ekle(olay(asistanOlayi(4, "t1", "yeni")));
    const g = o.ogeler();
    assert.deepEqual(g.map((x) => x.tur), ["gecmis_silindi", "asistan"]);
    const not = g[0];
    assert.ok(not !== undefined && not.tur === "gecmis_silindi");
    assert.equal(not.seq, 3);
    assert.equal(not.ts_ms, 1003);
    assert.equal(not.sinir_seq, 2);
    assert.equal(g.filter((x) => x.tur === "gecmis_silindi").length, 1);
  });

  it("ikinci mezar taşı ilk notu kaldırır", () => {
    const o = olaylarKur();
    o.ekle(olay(yankiOlayi(1)));
    o.ekle(olay(mezarTasiOlayi(2, 1)));
    o.ekle(olay(yankiOlayi(3)));
    o.ekle(olay(mezarTasiOlayi(4, 3)));
    const g = o.ogeler();
    assert.equal(g.length, 1);
    const not = g[0];
    assert.ok(not !== undefined && not.tur === "gecmis_silindi");
    assert.equal(not.seq, 4);
    assert.equal(not.sinir_seq, 3);
  });

  it("job_started.profil varsa IsKarti.profil'e yazılır, yoksa alan yoktur", () => {
    const o = olaylarKur();
    const temel = { ts_ms: 1, type: "job_started", plan_id: "p1", plan_hash: HASH_A, baslik: "b", tur: "pc" };
    o.ekle(olay({ ...temel, seq: 1, is_id: 1, profil: "hafif" }));
    o.ekle(olay({ ...temel, seq: 2, is_id: 2 }));
    assert.equal(o.is(1)!.profil, "hafif");
    assert.ok(!("profil" in o.is(2)!));
  });

  it("Dilim 3: user_echo.baglam KullaniciBalonu.baglam'a yazılır; yoksa alan yoktur", () => {
    const o = olaylarKur();
    const baglam = { paket: "com.whatsapp", ad: "WhatsApp" };
    o.ekle(olay({ ...yankiOlayi(1, "k1", "bunu yanıtla"), input: "kisayol", baglam }));
    o.ekle(olay({ ...yankiOlayi(2, "k2", "bağlamsız"), input: "kisayol" }));
    o.ekle(olay(yankiOlayi(3, "y3", "yazı")));
    const g = o.ogeler();
    assert.equal(g.length, 3);
    const [a, b, c] = g;
    assert.ok(a?.tur === "kullanici" && b?.tur === "kullanici" && c?.tur === "kullanici");
    assert.deepEqual(a, {
      seq: 1,
      ts_ms: 1001,
      tur: "kullanici",
      client_msg_id: "k1",
      input: "kisayol",
      metin: "bunu yanıtla",
      baglam,
    });
    assert.equal(b.input, "kisayol");
    assert.ok(!("baglam" in b));
    assert.equal(c.input, "yazi");
    assert.ok(!("baglam" in c));
    assert.equal(o.yankiVar("k1"), true);
  });

  it("Dilim 3: mezar taşından sonra kalan kısayol balonu baglam'ını korur", () => {
    const o = olaylarKur();
    const baglam = { paket: "com.android.chrome", ad: "Chrome" };
    o.ekle(olay(yankiOlayi(1)));
    o.ekle(olay({ ...yankiOlayi(2, "k2", "özetle"), input: "kisayol", baglam }));
    o.ekle(olay(mezarTasiOlayi(3, 1)));
    const balon = o.ogeler().find((x) => x.tur === "kullanici");
    assert.ok(balon !== undefined && balon.tur === "kullanici");
    assert.deepEqual(balon.baglam, baglam);
  });
});
