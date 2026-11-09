import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Plan, planHash } from "@eren/protocol";
import { cekirdekKur, GECMIS_SIL_SURESI_MS } from "../../src/cekirdek/index.ts";
import type { CekirdekDurumu, SohbetDurumu, SohbetOzeti } from "../../src/cekirdek/index.ts";
import { OUTBOX_ANAHTARI } from "../../src/cekirdek/outbox.ts";
import { SECIM_ANAHTARI } from "../../src/cekirdek/secim.ts";
import { TELAFI_ANAHTARLARI } from "../../src/cekirdek/telafi.ts";
import {
  ack,
  adDegistiOlayi,
  asistanOlayi,
  bosalt,
  challenge,
  chatClear,
  mezarTasiOlayi,
  sunucuDurumu,
  delta,
  elSikis,
  HASH_A,
  olayCercevesi,
  ornekPlan,
  SahteDepo,
  SahteKimlik,
  SahteSaat,
  SahteWs,
  snapshot,
  sohbetAcildiOlayi,
  sohbetSilindiOlayi,
  v,
  welcome,
  yankiOlayi,
} from "./sahte.ts";

const kur = (depo = new SahteDepo(), saat = new SahteSaat()) => {
  const ws = new SahteWs();
  const kimlik = new SahteKimlik();
  const c = cekirdekKur({ ws, kimlik, depo, saat });
  // Dilim 1 iddiaları `ana` sohbetinin tutamacında.
  const s = c.sohbet("ana");
  return { ws, kimlik, depo, saat, c, s };
};

type Kurulum = ReturnType<typeof kur>;

const baslat = async (k: Kurulum, head = 0) => {
  await k.c.baslat();
  await bosalt();
  await elSikis(k.ws.son(), head);
};

type Giden = { giden(): Record<string, unknown>[] };

const kullaniciMetinleri = (c: Giden): string[] =>
  c
    .giden()
    .filter((m) => m["type"] === "user_message")
    .map((m) => String(m["text"]));

const turdekiler = (c: Giden, tur: string) => c.giden().filter((m) => m["type"] === tur);

/** Kimlik sonrası giden türler (`hello` ve `auth_response` atılır). */
const isTurleri = (c: Giden): string[] =>
  c
    .giden()
    .map((m) => String(m["type"]))
    .filter((t) => t !== "hello" && t !== "auth_response");

const ozet = (k: Kurulum, id: string): SohbetOzeti | undefined =>
  k.c.durum().sohbetler.find((x) => x.sohbet_id === id);

const kimlikler = (k: Kurulum): string[] => k.c.durum().sohbetler.map((x) => x.sohbet_id);

const secimKaydi = (k: Kurulum): { acik: string; taban_seq: number; okundu: Record<string, number> } =>
  JSON.parse(k.depo.kv.get(SECIM_ANAHTARI) ?? "null") as {
    acik: string;
    taban_seq: number;
    okundu: Record<string, number>;
  };

const secimYazimlari = (k: Kurulum): number =>
  k.depo.islemler.filter((i) => i.tur === "yaz" && i.anahtar === SECIM_ANAHTARI).length;

const isBasladiOlayi = (seq: number, is_id: number, sohbet_id?: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "job_started",
  ...(sohbet_id === undefined ? {} : { sohbet_id }),
  is_id,
  plan_id: `p${is_id}`,
  plan_hash: HASH_A,
  baslik: "İş",
  tur: "pc",
});

const sistemNotu = (seq: number, seviye: "bilgi" | "uyari", sohbet_id?: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "system_notice",
  ...(sohbet_id === undefined ? {} : { sohbet_id }),
  seviye,
  kod: "diger",
  metin: "not",
});

// =============================================================================================
// Dilim 1 iddiaları (ana sohbet üzerinden)
// =============================================================================================

describe("sohbet: olay akışı", () => {
  it("olaylar kalıcı olur, görünüme girer; yeniden başlatmada hello last_seq kayıtlı değerle gider", async () => {
    const k = kur();
    await baslat(k);
    k.ws.son().gel(olayCercevesi(yankiOlayi(1, "a")));
    k.ws.son().gel(olayCercevesi(asistanOlayi(2, "t1", "yanıt")));
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.seq), [1, 2]);
    assert.equal(k.depo.kv.get(TELAFI_ANAHTARLARI.sonSeq), "2");

    const yeni = kur(k.depo);
    await yeni.c.baslat();
    await bosalt();
    assert.deepEqual(yeni.s.durum().ogeler.map((g) => g.seq), [1, 2]);
    yeni.ws.son().acildi();
    await bosalt();
    assert.equal(yeni.ws.son().giden()[0]?.["last_seq"], 2);
  });

  it("seq <= last_seq olan ve yinelenen olay atılır", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    c.gel(olayCercevesi(yankiOlayi(1, "a")));
    c.gel(olayCercevesi(yankiOlayi(1, "a")));
    c.gel(olayCercevesi(yankiOlayi(2, "b")));
    c.gel(olayCercevesi(yankiOlayi(1, "c")));
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.seq), [1, 2]);
    assert.equal(k.depo.gunlukler.get(TELAFI_ANAHTARLARI.olaylar)?.length, 2);
  });

  it("olay önce depoya, sonra last_seq yazılır", async () => {
    const k = kur();
    await baslat(k);
    k.ws.son().gel(olayCercevesi(yankiOlayi(1, "a")));
    await bosalt();
    const sira = k.depo.islemler
      .filter((i) => i.anahtar === TELAFI_ANAHTARLARI.olaylar || i.anahtar === TELAFI_ANAHTARLARI.sonSeq)
      .map((i) => `${i.tur}:${i.anahtar}`);
    assert.deepEqual(sira, [`ekle:${TELAFI_ANAHTARLARI.olaylar}`, `yaz:${TELAFI_ANAHTARLARI.sonSeq}`]);
  });

  it("head_seq < last_seq: yerel günlük silinir ve last_seq:0 ile yeniden bağlanılır", async () => {
    const k = kur();
    await baslat(k);
    for (const s of [1, 2, 3]) k.ws.son().gel(olayCercevesi(yankiOlayi(s, `m${s}`)));
    await bosalt();
    assert.equal(k.s.durum().ogeler.length, 3);

    k.ws.son().kopsun();
    k.saat.ilerlet(1000);
    await bosalt();
    const ikinci = k.ws.son();
    ikinci.acildi();
    await bosalt();
    assert.equal(ikinci.giden()[0]?.["last_seq"], 3);
    ikinci.gel(challenge());
    await bosalt();
    ikinci.gel(welcome(1));
    await bosalt();

    assert.equal(ikinci.kapatildi, true);
    assert.equal(k.s.durum().ogeler.length, 0);
    assert.equal(k.depo.gunlukler.has(TELAFI_ANAHTARLARI.olaylar), false);
    assert.equal(k.depo.kv.has(TELAFI_ANAHTARLARI.sonSeq), false);

    const sayi = k.ws.baglantilar.length;
    k.saat.ilerlet(60_000);
    await bosalt();
    assert.equal(k.ws.baglantilar.length, sayi + 1);
    const ucuncu = k.ws.son();
    ucuncu.acildi();
    await bosalt();
    assert.equal(ucuncu.giden()[0]?.["last_seq"], 0);
    // Yeni geçmişin düşük seq'li olayları atılmaz.
    ucuncu.gel(challenge());
    await bosalt();
    ucuncu.gel(welcome(1));
    await bosalt();
    ucuncu.gel(olayCercevesi(yankiOlayi(1, "yeni")));
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.seq), [1]);
  });

  it("bozuk çerçeve bağlantıyı kapatır ve olay atlanmaz: yeniden bağlanınca last_seq atlanan olayı da ister", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    c.gel(olayCercevesi(yankiOlayi(1, "a")));
    c.gel(`{"v":${v},"type":"event","event":{"seq":2,"bozuk":true}}`);
    c.gel(olayCercevesi(yankiOlayi(3, "c")));
    await bosalt();
    assert.equal(c.kapatildi, true);
    assert.equal(k.s.durum().hata, "cozum_hatasi");
    assert.equal(k.c.durum().hata, "cozum_hatasi");
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.seq), [1]);
    assert.equal(k.s.durum().baglanti, "kapali");
    assert.equal(k.c.durum().baglanti, "kapali");

    // Süre: bağlıyken bozuk çerçeve en uzun beklemeyle yeniden dener.
    k.saat.ilerlet(30_000);
    await bosalt();
    const d = k.ws.son();
    assert.notEqual(d, c);
    d.acildi();
    await bosalt();
    assert.equal(d.giden()[0]?.["last_seq"], 1);
  });

  it("sıra dışı çerçeve (bağlıyken ikinci welcome) bağlantıyı kapatır, olay uygulanmaz", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    c.gel(welcome(0));
    c.gel(olayCercevesi(yankiOlayi(1, "a")));
    await bosalt();
    assert.equal(c.kapatildi, true);
    assert.equal(k.s.durum().hata, "sira_disi");
    assert.equal(k.s.durum().ogeler.length, 0);
  });
});

describe("sohbet: outbox", () => {
  it("uçak modunda yazılan mesaj yeniden bağlanınca bir kez gider, sıra korunur; ack ve echo ile temizlenir", async () => {
    const k = kur();
    await k.c.baslat();
    await bosalt();
    k.ws.son().kopsun();
    const a = await k.s.mesajYolla("bir", "yazi");
    const b = await k.s.mesajYolla("iki", "yazi");
    assert.ok(a.ok && b.ok);
    assert.deepEqual(k.s.durum().bekleyenler.map((x) => x.durum), ["kuyrukta", "kuyrukta"]);

    k.saat.ilerlet(1000);
    await bosalt();
    await elSikis(k.ws.son());
    assert.deepEqual(kullaniciMetinleri(k.ws.son()), ["bir", "iki"]);
    assert.deepEqual(k.s.durum().bekleyenler.map((x) => x.durum), ["yollandi", "yollandi"]);
    // v3: her kullanıcı mesajı sohbetini taşır.
    for (const m of turdekiler(k.ws.son(), "user_message")) {
      assert.equal(m["v"], v);
      assert.equal(m["sohbet_id"], "ana");
    }

    k.ws.son().gel(ack(a.client_msg_id, true, { seq: 1 }));
    k.ws.son().gel(ack(a.client_msg_id, true, { seq: 1 }));
    await bosalt();
    assert.deepEqual(
      k.s.durum().bekleyenler.map((x) => [x.client_msg_id, x.durum]),
      [
        [a.client_msg_id, "teslim_edildi"],
        [b.client_msg_id, "yollandi"],
      ],
    );
    assert.deepEqual(kullaniciMetinleri(k.ws.son()), ["bir", "iki"]);
    k.ws.son().gel(olayCercevesi(yankiOlayi(1, a.client_msg_id, "bir")));
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler.map((x) => x.client_msg_id), [b.client_msg_id]);
  });

  it("ok:false yeniden yollanmaz ve hatalar'a düşer; yeniden başlatmada kuyruk ve sayaç korunur", async () => {
    const k = kur();
    await baslat(k);
    const a = await k.s.mesajYolla("reddedilecek", "yazi");
    const b = await k.s.mesajYolla("kalacak", "yazi");
    assert.ok(a.ok && b.ok);
    k.ws.son().gel(ack(a.client_msg_id, false, { code: "limit_kilitli" }));
    await bosalt();
    assert.deepEqual(k.s.durum().hatalar.map((h) => [h.client_msg_id, h.kod]), [[a.client_msg_id, "limit_kilitli"]]);
    assert.deepEqual(k.s.durum().bekleyenler.map((x) => x.client_msg_id), [b.client_msg_id]);

    k.c.kapat();
    const yeni = kur(k.depo, new SahteSaat());
    await yeni.c.baslat();
    await bosalt();
    assert.deepEqual(yeni.s.durum().bekleyenler.map((x) => x.client_msg_id), [b.client_msg_id]);
    assert.deepEqual(yeni.s.durum().hatalar.map((h) => h.kod), ["limit_kilitli"]);
    const c = await yeni.s.mesajYolla("yeni", "yazi");
    assert.ok(c.ok);
    assert.ok(![a.client_msg_id, b.client_msg_id].includes(c.client_msg_id));
    await elSikis(yeni.ws.son());
    assert.deepEqual(kullaniciMetinleri(yeni.ws.son()), ["kalacak", "yeni"]);
  });

  it("depo silinse de client_msg_id tekrarlanmaz", async () => {
    const saat = new SahteSaat();
    const k = kur(new SahteDepo(), saat);
    await k.c.baslat();
    const a = await k.s.mesajYolla("x", "yazi");
    assert.ok(a.ok);
    k.c.kapat();
    k.depo.kv.delete(OUTBOX_ANAHTARI);
    saat.ilerlet(10_000);
    const yeni = kur(k.depo, saat);
    await yeni.c.baslat();
    const b = await yeni.s.mesajYolla("x", "yazi");
    assert.ok(b.ok);
    assert.notEqual(a.client_msg_id, b.client_msg_id);
  });

  it("başlamadan mesaj yollanamaz", async () => {
    const k = kur();
    assert.deepEqual(await k.s.mesajYolla("x", "yazi"), { ok: false, neden: "baslamadi" });
  });
});

describe("sohbet: akış", () => {
  it("snapshot + offset'li delta birleşir; kopukta atılır; assistant_message tam metni yazar", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    c.gel(snapshot("t1", "Merhaba"));
    c.gel(delta("t1", 7, " dünya"));
    assert.deepEqual(k.s.durum().akis, { turn_id: "t1", metin: "Merhaba dünya" });

    c.kopsun();
    assert.equal(k.s.durum().akis, null);
    // Kopmuş bağlantıdan geç gelen parça akışı diriltmez.
    c.gel(delta("t1", 13, "!"));
    assert.equal(k.s.durum().akis, null);

    k.saat.ilerlet(1000);
    await bosalt();
    await elSikis(k.ws.son());
    k.ws.son().gel(delta("t1", 13, "!"));
    assert.equal(k.s.durum().akis, null, "tabansız delta atılmalı");
    k.ws.son().gel(snapshot("t1", "Merhaba dünya"));
    k.ws.son().gel(delta("t1", 13, "!"));
    assert.equal(k.s.durum().akis?.metin, "Merhaba dünya!");

    k.ws.son().gel(olayCercevesi(asistanOlayi(1, "t1", "Merhaba dünya! Tam metin.")));
    await bosalt();
    assert.equal(k.s.durum().akis, null);
    const son = k.s.durum().ogeler[0];
    assert.ok(son !== undefined && son.tur === "asistan");
    assert.equal(son.metin, "Merhaba dünya! Tam metin.");
  });
});

describe("sohbet: plan kartı", () => {
  const planOlayi = (seq: number, plan_id: string, hash?: string, sohbet_id?: string) => {
    const plan = Plan.parse(ornekPlan(plan_id));
    return {
      seq,
      ts_ms: 1,
      type: "plan_proposed",
      ...(sohbet_id === undefined ? {} : { sohbet_id }),
      plan,
      plan_hash: hash ?? planHash(plan),
    };
  };

  it("planHash tutmazsa kart gizlenir ve karar verilemez", async () => {
    const k = kur();
    await baslat(k);
    k.ws.son().gel(olayCercevesi(planOlayi(1, "bozuk", HASH_A)));
    k.ws.son().gel(olayCercevesi(planOlayi(2, "iyi")));
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.tur), ["plan_gizlendi", "plan"]);
    assert.deepEqual(await k.s.planKarari("bozuk", HASH_A, "onay"), { ok: false, neden: "plan_yok" });
    const iyi = k.s.durum().ogeler[1];
    assert.ok(iyi !== undefined && iyi.tur === "plan");
    // Başka özetle karar verilemez, doğru özetle verilir.
    assert.deepEqual(await k.s.planKarari("iyi", HASH_A, "onay"), { ok: false, neden: "plan_yok" });
    const r = await k.s.planKarari("iyi", iyi.plan_hash, "onay");
    assert.ok(r.ok);
    const giden = k.ws.son().giden().find((m) => m["type"] === "plan_decision");
    assert.equal(giden?.["plan_hash"], iyi.plan_hash);
  });

  it("kart yalnız kendi sohbetinin tutamacında: başka sohbetten karar plan_yok; bekleyen kartın sohbetinde görünür", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1", "İkinci")));
    b.gel(olayCercevesi(planOlayi(2, "p2", undefined, "s-x-1")));
    await bosalt();
    const iki = k.c.sohbet("s-x-1");
    const kart = iki.durum().ogeler[0];
    assert.ok(kart !== undefined && kart.tur === "plan");
    assert.deepEqual(k.s.durum().ogeler, []);
    assert.deepEqual(await k.s.planKarari("p2", kart.plan_hash, "onay"), { ok: false, neden: "plan_yok" });
    const r = await iki.planKarari("p2", kart.plan_hash, "onay");
    assert.ok(r.ok);
    await bosalt();
    // `plan_decision` sohbet alanı taşımaz; bekleyen, kartın bulunduğu sohbette görünür.
    assert.deepEqual(iki.durum().bekleyenler.map((x) => x.mesaj.type), ["plan_decision"]);
    assert.deepEqual(k.s.durum().bekleyenler, []);
    assert.equal(turdekiler(b, "plan_decision")[0]?.["sohbet_id"], undefined);
  });
});

describe("sohbet: geçmişi sil", () => {
  const silmeler = (c: Giden) => turdekiler(c, "chat_clear");

  it("bağlı değilken bagli_degil döner ve hiçbir şey yollanmaz", async () => {
    const k = kur();
    await k.c.baslat();
    await bosalt();
    // Bağlantı açıldı ama el sıkışma bitmedi.
    assert.deepEqual(await k.s.gecmisiSil(), { ok: false, kod: "bagli_degil" });
    k.ws.son().kopsun();
    assert.deepEqual(await k.s.gecmisiSil(), { ok: false, kod: "bagli_degil" });
    for (const c of k.ws.baglantilar) assert.equal(silmeler(c).length, 0);
    assert.deepEqual(k.s.durum().bekleyenler, []);
  });

  it("bağlıyken tek chat_clear (v3, sohbet_id) gider; ikinci çağrı zaten_yollandi; ack ok ile {ok:true}", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    const p = k.s.gecmisiSil();
    await bosalt();
    const q = k.s.gecmisiSil();
    assert.deepEqual(await q, { ok: false, kod: "zaten_yollandi" });
    const gidenler = silmeler(c);
    assert.equal(gidenler.length, 1);
    const id = String(gidenler[0]?.["client_msg_id"]);
    assert.equal(gidenler[0]?.["v"], v);
    assert.equal(gidenler[0]?.["sohbet_id"], "ana");
    assert.ok(id.length > 0);
    c.gel(ack(id, true, { seq: 5 }));
    await bosalt();
    assert.deepEqual(await p, { ok: true });
    assert.equal(silmeler(c).length, 1);
  });

  it("ack sohbet_mesgul: {ok:false, kod:'sohbet_mesgul'}; sonra yeniden denenebilir", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    const p = k.s.gecmisiSil();
    await bosalt();
    const id = String(silmeler(c)[0]?.["client_msg_id"]);
    c.gel(ack(id, false, { code: "sohbet_mesgul" }));
    await bosalt();
    assert.deepEqual(await p, { ok: false, kod: "sohbet_mesgul" });
    assert.deepEqual(k.s.durum().hatalar, []);
    const p2 = k.s.gecmisiSil();
    await bosalt();
    assert.equal(silmeler(c).length, 2);
    c.gel(ack(String(silmeler(c)[1]?.["client_msg_id"]), true, { seq: 9 }));
    await bosalt();
    assert.deepEqual(await p2, { ok: true });
  });

  it("ack gelmeden bağlantı koparsa baglanti_koptu; yeniden bağlanınca yeniden yollanmaz", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    const p = k.s.gecmisiSil();
    await bosalt();
    assert.equal(silmeler(c).length, 1);
    c.kopsun();
    await bosalt();
    assert.deepEqual(await p, { ok: false, kod: "baglanti_koptu" });
    assert.deepEqual(k.s.durum().hatalar, []);

    k.saat.ilerlet(60_000);
    await bosalt();
    const d = k.ws.son();
    assert.notEqual(d, c);
    await elSikis(d, 0);
    assert.equal(silmeler(d).length, 0);
    assert.equal(silmeler(c).length, 1);
  });

  it("chat_clear bekleyenler ve hatalar içinde görünmez", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    const p = k.s.gecmisiSil();
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler, []);
    assert.deepEqual(k.s.durum().hatalar, []);
    const id = String(silmeler(c)[0]?.["client_msg_id"]);
    c.gel(ack(id, false, { code: "sohbet_mesgul" }));
    await bosalt();
    await p;
    assert.deepEqual(k.s.durum().bekleyenler, []);
    assert.deepEqual(k.s.durum().hatalar, []);
    // Sahte yardımcı v3 üretir.
    assert.equal(chatClear("x")["v"], v);
  });

  it("mezar taşı canlı gelince görünümde tek not ve sonraki olaylar kalır; teslimler boşalır", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    const a = await k.s.mesajYolla("bir", "yazi");
    assert.ok(a.ok);
    c.gel(olayCercevesi(yankiOlayi(1, "x1")));
    c.gel(olayCercevesi(asistanOlayi(2, "t1", "yanıt")));
    c.gel(ack(a.client_msg_id, true, { seq: 1 }));
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler.map((x) => x.durum), ["teslim_edildi"]);

    c.gel(olayCercevesi(mezarTasiOlayi(3, 2)));
    await bosalt();
    const notlar = k.s.durum().ogeler.filter((g) => g.tur === "gecmis_silindi");
    assert.equal(notlar.length, 1);
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.tur), ["gecmis_silindi"]);
    assert.deepEqual(k.s.durum().bekleyenler, []);

    c.gel(olayCercevesi(yankiOlayi(4, "y1", "yeni")));
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.seq), [3, 4]);
    assert.equal(k.s.durum().ogeler[0]?.tur, "gecmis_silindi");

    // İkinci mezar taşı eski notu da kaldırır: yine tek not.
    c.gel(olayCercevesi(mezarTasiOlayi(5, 4)));
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler.map((g) => [g.tur, g.seq]), [["gecmis_silindi", 5]]);
    assert.equal(k.depo.kv.get(TELAFI_ANAHTARLARI.sonSeq), "5");
  });

  it("server_status.servis durumda görünür", async () => {
    const k = kur();
    await baslat(k);
    k.ws.son().gel(sunucuDurumu({ servis: { surum: "abc1234", baslangic_ms: 500_000 } }));
    await bosalt();
    assert.deepEqual(k.s.durum().sunucu?.servis, { surum: "abc1234", baslangic_ms: 500_000 });
    assert.deepEqual(k.c.durum().sunucu?.servis, { surum: "abc1234", baslangic_ms: 500_000 });
    k.ws.son().gel(sunucuDurumu({ servis: { surum: null, baslangic_ms: 7 } }));
    await bosalt();
    assert.deepEqual(k.s.durum().sunucu?.servis, { surum: null, baslangic_ms: 7 });
    // Dilim 2: `eren` yok, `sohbetler` var.
    assert.equal(Object.hasOwn(k.c.durum().sunucu ?? {}, "eren"), false);
    assert.deepEqual(k.c.durum().sunucu?.sohbetler, [{ sohbet_id: "ana", eren: "hazir" }]);
  });

  it("(A) ok:false alan mesaj, mezar taşından sonra hatalar'da ve depodaki outbox'ta kalmaz", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    const a = await k.s.mesajYolla("gizli-metin-ABC", "yazi");
    assert.ok(a.ok);
    c.gel(ack(a.client_msg_id, false, { code: "limit_kilitli" }));
    await bosalt();
    assert.deepEqual(k.s.durum().hatalar.map((h) => h.client_msg_id), [a.client_msg_id]);

    c.gel(olayCercevesi(mezarTasiOlayi(1, 0)));
    await bosalt();
    assert.deepEqual(k.s.durum().hatalar, []);
    assert.equal((k.depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes("gizli-metin-ABC"), false);
  });

  it("(B) kopma sonrası yeniden yollanan X: mezar taşından sonra gelen eski ack teslim_edildi kaydı üretmez", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    const x = await k.s.mesajYolla("x-mesaji", "yazi");
    assert.ok(x.ok);
    const p = k.s.gecmisiSil();
    await bosalt();
    assert.equal(silmeler(c).length, 1);
    c.kopsun();
    await bosalt();
    assert.deepEqual(await p, { ok: false, kod: "baglanti_koptu" });

    k.saat.ilerlet(60_000);
    await bosalt();
    const d = k.ws.son();
    assert.notEqual(d, c);
    await elSikis(d, 0);
    assert.deepEqual(kullaniciMetinleri(d), ["x-mesaji"]);
    assert.equal(silmeler(d).length, 0);

    d.gel(olayCercevesi(mezarTasiOlayi(2, 1)));
    await bosalt();
    d.gel(ack(x.client_msg_id, true, { seq: 1 }));
    await bosalt();
    assert.equal(
      k.s.durum().bekleyenler.some((b) => b.client_msg_id === x.client_msg_id && b.durum === "teslim_edildi"),
      false,
    );
  });

  it("(C) ack hiç gelmezse 20 sn sonra zaman_asimi ve bağlantı yeniden kurulma yoluna girer", async () => {
    const k = kur();
    await baslat(k);
    const c = k.ws.son();
    const p = k.s.gecmisiSil();
    await bosalt();
    assert.equal(silmeler(c).length, 1);
    let cozuldu = false;
    void p.then(() => {
      cozuldu = true;
    });
    k.saat.ilerlet(19_000);
    await bosalt();
    assert.equal(cozuldu, false);
    k.saat.ilerlet(1_000);
    await bosalt();
    assert.deepEqual(await p, { ok: false, kod: "zaman_asimi" });
    assert.equal(c.kapatildi, true);

    k.saat.ilerlet(60_000);
    await bosalt();
    assert.notEqual(k.ws.son(), c);
  });
});

// =============================================================================================
// Dilim 2: çoklu sohbet (Cekirdek / Sohbet yüzeyi)
// =============================================================================================

describe("çekirdek: asistan adı", () => {
  it("asistanAdi seçeneği ana'nın yer tutucu adıdır; sunucunun chat_renamed'i önceliklidir", async () => {
    const ws = new SahteWs();
    const c = cekirdekKur(
      { ws, kimlik: new SahteKimlik(), depo: new SahteDepo(), saat: new SahteSaat() },
      { asistanAdi: "Örnek Asistan" },
    );
    assert.equal(c.durum().sohbetler[0]?.ad, "Örnek Asistan");
    await c.baslat();
    await bosalt();
    await elSikis(ws.son(), 0);
    assert.equal(c.durum().sohbetler.find((x) => x.sohbet_id === "ana")?.ad, "Örnek Asistan");
    ws.son().gel(olayCercevesi(adDegistiOlayi(1, "ana", "Sunucu adı")));
    await bosalt();
    assert.equal(c.durum().sohbetler.find((x) => x.sohbet_id === "ana")?.ad, "Sunucu adı");
    c.kapat();
  });

  it("asistanAdi verilmezse ana'nın adı ANA_SOHBET_ADI (Claude)", () => {
    assert.equal(kur().c.durum().sohbetler[0]?.ad, "Claude");
  });
});

describe("çekirdek: yüzey", () => {
  it("baslat öncesi: liste yalnız ana, calisanIsler boş, eylemler baslamadi", async () => {
    const k = kur();
    const d = k.c.durum();
    assert.equal(d.yuklendi, false);
    assert.deepEqual(d.sohbetler.map((x) => x.sohbet_id), ["ana"]);
    assert.equal(d.sohbetler[0]?.ad, "Claude");
    assert.equal(d.sohbetler[0]?.ana, true);
    assert.equal(d.secili, "ana");
    assert.deepEqual(d.calisanIsler, []);
    assert.deepEqual(await k.c.sohbetAc(), { ok: false, neden: "baslamadi" });
    assert.deepEqual(await k.s.gecmisiSil(), { ok: false, kod: "baslamadi" });
    assert.deepEqual(await k.s.adlandir("x"), { ok: false, neden: "baslamadi" });
    assert.deepEqual(await k.c.sohbet("s-x-1").sil(), { ok: false, kod: "baslamadi" });
    // Yüklemeden önce okundu no-op: seçim yazılmaz.
    k.s.okundu();
    await bosalt();
    assert.equal(secimYazimlari(k), 0);

    await k.c.baslat();
    assert.equal(k.c.durum().yuklendi, true);
  });

  it("sohbet(id) aynı kimliğe hep aynı tutamaç; listede olmayan kimlik ozet null, eylemler sohbet_bulunamadi", async () => {
    const k = kur();
    await baslat(k);
    assert.equal(k.c.sohbet("ana"), k.s);
    const yok = k.c.sohbet("s-yok-1");
    assert.equal(k.c.sohbet("s-yok-1"), yok);
    assert.equal(yok.sohbet_id, "s-yok-1");
    assert.equal(yok.durum().ozet, null);
    assert.deepEqual(yok.durum().ogeler, []);
    assert.deepEqual(await yok.mesajYolla("x", "yazi"), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await yok.kes(), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await yok.isIptal(1), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await yok.soruCevapla("q", "c"), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await yok.planKarari("p", HASH_A, "onay"), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await yok.gecmisiSil(), { ok: false, kod: "sohbet_bulunamadi" });
    assert.deepEqual(await yok.adlandir("Ad"), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await yok.sil(), { ok: false, kod: "sohbet_bulunamadi" });
    assert.equal(k.c.sec("s-yok-1"), false);
    assert.equal(k.c.durum().secili, "ana");
    // Hiçbir şey yollanmadı.
    assert.deepEqual(isTurleri(k.ws.son()), []);
  });

  it("abone hemen bir kez çağrılır; dinleyici hatası ötekileri durdurmaz; durum değişmedikçe aynı nesne", async () => {
    const k = kur();
    await k.c.baslat();
    await bosalt();
    const gorulen: CekirdekDurumu[] = [];
    const sGorulen: SohbetDurumu[] = [];
    const iptal1 = k.c.abone(() => {
      throw new Error("ekran hatası");
    });
    const iptal2 = k.c.abone((d) => gorulen.push(d));
    const iptal3 = k.s.abone((d) => sGorulen.push(d));
    assert.equal(gorulen.length, 1);
    assert.equal(sGorulen.length, 1);
    assert.equal(k.c.durum(), k.c.durum());
    assert.equal(k.s.durum(), k.s.durum());
    await elSikis(k.ws.son());
    assert.ok(gorulen.length > 1);
    assert.equal(gorulen[gorulen.length - 1]?.baglanti, "bagli");
    assert.equal(sGorulen[sGorulen.length - 1]?.baglanti, "bagli");
    iptal1();
    iptal2();
    iptal3();
    const n = gorulen.length;
    k.ws.son().gel(olayCercevesi(asistanOlayi(1, "t1", "x")));
    await bosalt();
    assert.equal(gorulen.length, n);
  });

  it("seçim kalıcı: sec yazılır, aynı seçim yazmaz; yeniden başlatmada geri gelir, listede yoksa ana", async () => {
    const k = kur();
    await baslat(k);
    k.ws.son().gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1", "İkinci")));
    await bosalt();
    assert.equal(k.c.sec("s-x-1"), true);
    await bosalt();
    assert.equal(k.c.durum().secili, "s-x-1");
    assert.equal(secimKaydi(k).acik, "s-x-1");
    const yazim = secimYazimlari(k);
    const once = k.c.durum();
    assert.equal(k.c.sec("s-x-1"), true);
    await bosalt();
    assert.equal(secimYazimlari(k), yazim);
    assert.equal(k.c.durum(), once);

    k.c.kapat();
    const yeni = kur(k.depo);
    await yeni.c.baslat();
    assert.equal(yeni.c.durum().secili, "s-x-1");
    yeni.c.kapat();

    // Kayıttaki açık sohbet listede yok: ana seçilir ve yazılır.
    const kayit = secimKaydi(k);
    k.depo.kv.set(SECIM_ANAHTARI, JSON.stringify({ ...kayit, acik: "s-hic-9" }));
    const ucuncu = kur(k.depo);
    await ucuncu.c.baslat();
    await bosalt();
    assert.equal(ucuncu.c.durum().secili, "ana");
    assert.equal(secimKaydi(ucuncu).acik, "ana");
  });
});

describe("çekirdek: yönlendirme", () => {
  it("iki sohbet: olay, delta ve snapshot kendi sohbetine; başka sohbetin akışı açık sohbetin durumunu yenilemez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1", "İkinci")));
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "selam", "s-x-1")));
    b.gel(olayCercevesi(asistanOlayi(3, "t2", "ana selam")));
    b.gel(olayCercevesi(yankiOlayi(4, "m4", "ikiye", "s-x-1")));
    await bosalt();
    const ana = k.s;
    const iki = k.c.sohbet("s-x-1");
    assert.deepEqual(ana.durum().ogeler.map((g) => g.seq), [3]);
    assert.deepEqual(iki.durum().ogeler.map((g) => g.seq), [2, 4]);
    assert.equal(iki.durum().ozet?.ad, "İkinci");
    assert.equal(iki.durum().ozet?.kurulum, "kuruldu");
    assert.equal(iki.durum().ozet?.ana, false);
    assert.deepEqual(iki.durum().ozet?.sonMesaj, { kim: "kullanici", metin: "ikiye" });

    const anaOnce = ana.durum();
    const anaOzetOnce = anaOnce.ozet;
    b.gel(snapshot("t9", "yazı", "s-x-1"));
    b.gel(delta("t9", 4, "yor", "s-x-1"));
    await bosalt();
    assert.deepEqual(iki.durum().akis, { turn_id: "t9", metin: "yazıyor" });
    assert.equal(ana.durum().akis, null);
    assert.equal(ana.durum(), anaOnce);
    assert.equal(ozet(k, "ana"), anaOzetOnce);
    assert.equal(ozet(k, "s-x-1")?.yaziyor, true);
    assert.equal(ozet(k, "ana")?.yaziyor, false);

    // Ana'nın delta'sı ikinci sohbetin akışını bozmaz.
    b.gel(snapshot("t8", "ana akış"));
    await bosalt();
    assert.equal(ana.durum().akis?.metin, "ana akış");
    assert.equal(iki.durum().akis?.metin, "yazıyor");

    // server_status: asistan durumu sohbet başına.
    b.gel(sunucuDurumu({ sohbetler: [{ sohbet_id: "ana", eren: "hazir" }, { sohbet_id: "s-x-1", eren: "tur_suruyor" }] }));
    await bosalt();
    assert.equal(iki.durum().ozet?.eren, "tur_suruyor");
    assert.equal(ana.durum().ozet?.eren, "hazir");

    // Kopma: bütün akışlar düşer, asistan durumları bilinmez olur.
    b.kopsun();
    await bosalt();
    assert.equal(ana.durum().akis, null);
    assert.equal(iki.durum().akis, null);
    assert.equal(iki.durum().ozet?.eren, null);
    assert.equal(iki.durum().ozet?.yaziyor, false);
  });

  it("calisanIsler: bütün sohbetlerin süren işleri seq sırasıyla, sohbetiyle", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1")));
    b.gel(olayCercevesi(isBasladiOlayi(2, 7, "s-x-1")));
    b.gel(olayCercevesi(isBasladiOlayi(3, 8)));
    await bosalt();
    assert.deepEqual(
      k.c.durum().calisanIsler.map((c) => [c.sohbet_id, c.is.is_id]),
      [
        ["s-x-1", 7],
        ["ana", 8],
      ],
    );
    assert.equal(ozet(k, "s-x-1")?.calisanIs, 1);
    assert.equal(ozet(k, "ana")?.calisanIs, 1);
    // İş kartı yalnız kendi sohbetinde iptal edilir.
    assert.deepEqual(await k.s.isIptal(7), { ok: false, neden: "is_yok" });
    assert.ok((await k.c.sohbet("s-x-1").isIptal(7)).ok);
  });

  it("mezar taşı yalnız kendi sohbetine; başka sohbetin öğeleri ve hataları kalır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1")));
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "iki", "s-x-1")));
    b.gel(olayCercevesi(asistanOlayi(3, "t2", "ana")));
    await bosalt();
    const iki = k.c.sohbet("s-x-1");
    const red = await k.s.mesajYolla("ana-red", "yazi");
    assert.ok(red.ok);
    b.gel(ack(red.client_msg_id, false, { code: "limit_kilitli" }));
    await bosalt();
    assert.equal(k.s.durum().hatalar.length, 1);

    // gecmisiSil sohbet başına: chat_clear o sohbetin kimliğiyle gider.
    const p = iki.gecmisiSil();
    await bosalt();
    const temizle = turdekiler(b, "chat_clear");
    assert.equal(temizle.length, 1);
    assert.equal(temizle[0]?.["sohbet_id"], "s-x-1");
    b.gel(ack(String(temizle[0]?.["client_msg_id"]), true, { seq: 4 }));
    b.gel(olayCercevesi(mezarTasiOlayi(4, 3, "s-x-1")));
    await bosalt();
    assert.deepEqual(await p, { ok: true });
    assert.deepEqual(iki.durum().ogeler.map((g) => g.tur), ["gecmis_silindi"]);
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.seq), [3]);
    assert.equal(k.s.durum().hatalar.length, 1, "ana'nın hatası başka sohbetin mezar taşıyla gitmez");
  });

  it("ilk Dilim 2 açılışında eski geçmiş okunmamış değil; yüklemede olaylar kendi sohbetlerine", async () => {
    const depo = new SahteDepo();
    depo.gunlukler.set(TELAFI_ANAHTARLARI.olaylar, [
      JSON.stringify(sohbetAcildiOlayi(1, "s-a-1", "B")),
      JSON.stringify(asistanOlayi(2, "t1", "eski", "s-a-1")),
      JSON.stringify(yankiOlayi(3, "m3", "ana mesajı")),
    ]);
    depo.kv.set(TELAFI_ANAHTARLARI.sonSeq, "3");
    const k = kur(depo);
    await k.c.baslat();
    await bosalt();
    assert.equal(ozet(k, "s-a-1")?.okunmamis, 0);
    assert.equal(ozet(k, "s-a-1")?.ad, "B");
    assert.equal(k.s.durum().ogeler.length, 1);
    assert.equal(k.c.sohbet("s-a-1").durum().ogeler.length, 1);
    // Kayıt yoktu: taban telafi.sonSeq() yazıldı.
    assert.equal(secimKaydi(k).taban_seq, 3);
    assert.equal(secimKaydi(k).acik, "ana");
  });
});

describe("çekirdek: sohbetAc", () => {
  it("çevrimdışı sohbetAc → bekliyor ve seçili; bağlanınca chat_create, user_message, otomatik chat_rename sırasıyla gider", async () => {
    const k = kur();
    await k.c.baslat();
    await bosalt();
    k.ws.son().kopsun();
    const r = await k.c.sohbetAc();
    assert.ok(r.ok);
    const id = r.sohbet_id;
    assert.match(id, /^s-[A-Za-z0-9_]+-\d+$/);
    assert.notEqual(id, "ana");
    assert.equal(k.c.durum().secili, id);
    // Defterde kaydı olmayan en başta.
    assert.equal(k.c.durum().sohbetler[0]?.sohbet_id, id);
    assert.equal(ozet(k, id)?.kurulum, "bekliyor");
    assert.equal(ozet(k, id)?.ad, "Yeni sohbet");
    assert.equal(ozet(k, id)?.sonEtkinlikMs, null);

    const s = k.c.sohbet(id);
    const m = await s.mesajYolla("Merhaba   dünya\nnasılsın", "yazi");
    assert.ok(m.ok);
    // Otomatik ad kuyrukta, hemen özette.
    assert.equal(ozet(k, id)?.ad, "Merhaba dünya nasılsın");
    // İkinci mesaj adı yeniden üretmez.
    const m2 = await s.mesajYolla("ikinci", "yazi");
    assert.ok(m2.ok);
    assert.deepEqual(s.durum().bekleyenler.map((x) => x.mesaj.type), ["user_message", "user_message"]);
    // Yönetim mesajları bekleyenlerde görünmez.
    assert.equal(s.durum().bekleyenler.some((x) => x.mesaj.type.startsWith("chat_")), false);

    k.saat.ilerlet(1000);
    await bosalt();
    const b = k.ws.son();
    await elSikis(b, 0);
    assert.deepEqual(isTurleri(b), ["chat_create", "user_message", "chat_rename", "user_message"]);
    const [cc, um, cr] = b.giden().slice(-4);
    assert.deepEqual(
      [cc?.["v"], cc?.["sohbet_id"], cc?.["ad"]],
      [v, id, "Yeni sohbet"],
    );
    assert.deepEqual([um?.["sohbet_id"], um?.["text"]], [id, "Merhaba   dünya\nnasılsın"]);
    assert.deepEqual([cr?.["sohbet_id"], cr?.["ad"]], [id, "Merhaba dünya nasılsın"]);
    assert.equal(ozet(k, id)?.kurulum, "bekliyor");
    await bosalt();
    assert.equal(secimKaydi(k).acik, id);
  });

  it("ack olaydan önce gelir: sohbet listeden düşmez, seçim kaymaz, ad geri dönmez; olaylar gelince defterden", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const r = await k.c.sohbetAc();
    assert.ok(r.ok);
    const id = r.sohbet_id;
    const s = k.c.sohbet(id);
    const m = await s.mesajYolla("Selam", "yazi");
    assert.ok(m.ok);
    await bosalt();
    assert.deepEqual(isTurleri(b), ["chat_create", "user_message", "chat_rename"]);
    const [cc, , cr] = b.giden().slice(-3);

    // Bundan sonraki her bildirimde sohbet listede, seçili ve adı "Selam".
    const gorulen: CekirdekDurumu[] = [];
    const iptal = k.c.abone((d) => gorulen.push(d));
    b.gel(ack(String(cc?.["client_msg_id"]), true, { seq: 1 }));
    b.gel(ack(m.client_msg_id, true, { seq: 2 }));
    b.gel(ack(String(cr?.["client_msg_id"]), true, { seq: 3 }));
    await bosalt();
    assert.equal(ozet(k, id)?.kurulum, "kuruldu");
    assert.equal(ozet(k, id)?.ad, "Selam");
    assert.deepEqual(s.durum().bekleyenler.map((x) => [x.mesaj.type, x.durum]), [["user_message", "teslim_edildi"]]);

    b.gel(olayCercevesi(sohbetAcildiOlayi(1, id)));
    await bosalt();
    // chat_created seq 1 < rename ack seq 3: teslim edilmiş ad kalır.
    assert.equal(ozet(k, id)?.ad, "Selam");
    b.gel(olayCercevesi(yankiOlayi(2, m.client_msg_id, "Selam", id)));
    b.gel(olayCercevesi(adDegistiOlayi(3, id, "Selam")));
    await bosalt();
    iptal();

    assert.ok(gorulen.length > 3);
    for (const d of gorulen) {
      const satir = d.sohbetler.find((x) => x.sohbet_id === id);
      assert.ok(satir !== undefined, "sohbet hiçbir bildirimde listeden düşmemeli");
      assert.equal(satir.kurulum === "kurulamadi", false);
      assert.equal(satir.ad, "Selam");
      assert.equal(d.secili, id, "seçim kaymamalı");
    }
    assert.equal(ozet(k, id)?.kurulum, "kuruldu");
    assert.deepEqual(s.durum().bekleyenler, []);
    assert.deepEqual(s.durum().ogeler.map((g) => g.seq), [2]);
    assert.notEqual(ozet(k, id)?.sonEtkinlikMs, null);
  });

  it("bilinçli sapma 1: defterde olmayan sohbetin seq'siz ack ok'u teslime girer, ilk yaşam döngüsü olayına dek kuruldu kalır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const r = await k.c.sohbetAc("Deneme");
    assert.ok(r.ok);
    const id = r.sohbet_id;
    await bosalt();
    const cc = turdekiler(b, "chat_create")[0];
    assert.equal(cc?.["ad"], "Deneme");
    const gorulen: CekirdekDurumu[] = [];
    const iptal = k.c.abone((d) => gorulen.push(d));
    b.gel(ack(String(cc?.["client_msg_id"]), true));
    await bosalt();
    assert.equal(ozet(k, id)?.kurulum, "kuruldu");
    assert.equal(ozet(k, id)?.ad, "Deneme");
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, id, "Deneme")));
    await bosalt();
    iptal();
    for (const d of gorulen) {
      assert.equal(d.sohbetler.some((x) => x.sohbet_id === id), true);
      assert.equal(d.secili, id);
    }
    assert.equal(ozet(k, id)?.kurulum, "kuruldu");
    assert.equal(ozet(k, id)?.sonEtkinlikMs, 1001);
  });

  it("ack'li ama olayı günlüğe yazılmamış sohbet yeniden başlatmada kalır: seçim, kuyruktaki mesajı ve sınır sayımı korunur; telafi gelince aynı sohbet seçili", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const r = await k.c.sohbetAc("Deneme");
    assert.ok(r.ok);
    const id = r.sohbet_id;
    const m = await k.c.sohbet(id).mesajYolla("bekleyen-metin", "yazi");
    assert.ok(m.ok);
    await bosalt();
    const cc = String(turdekiler(b, "chat_create")[0]?.["client_msg_id"]);
    // chat_create ack ok (seq 1) alır; chat_created (seq 1) telafi günlüğüne yazılmadan uygulama kapanır.
    b.gel(ack(cc, true, { seq: 1 }));
    await bosalt();
    assert.equal(ozet(k, id)?.kurulum, "kuruldu");
    assert.equal(secimKaydi(k).acik, id);
    k.c.kapat();
    await bosalt();
    // Aynı disk durumundan ikinci bir açılış (sınır sayımı için).
    const kopya = new SahteDepo();
    kopya.kv = new Map(k.depo.kv);
    kopya.gunlukler = new Map([...k.depo.gunlukler].map(([a, g]) => [a, [...g]]));

    const yeni = kur(k.depo);
    await yeni.c.baslat();
    await bosalt();
    assert.ok(kimlikler(yeni).includes(id), "sohbet listeden düşmemeli");
    assert.equal(ozet(yeni, id)?.ad, "Deneme");
    assert.equal(yeni.c.durum().secili, id, "seçim ana'ya kaymamalı");
    assert.equal(secimKaydi(yeni).acik, id);
    assert.deepEqual(
      yeni.c.sohbet(id).durum().bekleyenler.map((x) => x.client_msg_id),
      [m.client_msg_id],
    );

    // Yeniden bağlanınca chat_create aynı kimlikle önce gider; servis aynı ack'i döner, olay telafiyle gelir.
    const gorulen: CekirdekDurumu[] = [];
    const iptal = yeni.c.abone((d) => gorulen.push(d));
    const b2 = yeni.ws.son();
    await elSikis(b2, 2);
    assert.deepEqual(isTurleri(b2), ["chat_create", "user_message"]);
    assert.equal(turdekiler(b2, "chat_create")[0]?.["client_msg_id"], cc);
    b2.gel(ack(cc, true, { seq: 1 }));
    b2.gel(olayCercevesi(sohbetAcildiOlayi(1, id, "Deneme")));
    b2.gel(ack(m.client_msg_id, true, { seq: 2 }));
    b2.gel(olayCercevesi(yankiOlayi(2, m.client_msg_id, "bekleyen-metin", id)));
    await bosalt();
    iptal();
    for (const d of gorulen) {
      assert.equal(d.sohbetler.some((x) => x.sohbet_id === id), true, "hiçbir bildirimde listeden düşmemeli");
      assert.equal(d.secili, id, "seçim kaymamalı");
    }
    assert.equal(ozet(yeni, id)?.kurulum, "kuruldu");
    assert.notEqual(ozet(yeni, id)?.sonEtkinlikMs, null);
    assert.equal(yeni.c.durum().secili, id);
    assert.deepEqual(yeni.c.sohbet(id).durum().ogeler.map((g) => g.seq), [2]);
    await bosalt();
    assert.equal(secimKaydi(yeni).acik, id);
    // Olay günlükte: chat_create'in diskteki kopyası kalkar, bir sonraki açılışta yeniden yollanmaz.
    assert.equal((k.depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes("chat_create"), false);

    // Sınır: aynı disk durumundan açılışta ack'li sohbet de sayılır (ana + o + 6 = 8).
    const ucuncu = kur(kopya);
    await ucuncu.c.baslat();
    await bosalt();
    for (let i = 0; i < 6; i++) assert.ok((await ucuncu.c.sohbetAc()).ok, `sohbet ${i + 1}`);
    assert.deepEqual(await ucuncu.c.sohbetAc(), { ok: false, neden: "sohbet_siniri" });
  });

  it("olayı günlükte olan sohbetin diskte kalmış chat_create'i yüklemede atılır, yeniden yollanmaz", async () => {
    const k = kur();
    await baslat(k);
    k.ws.son().gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1", "X")));
    await k.s.mesajYolla("kalir", "yazi");
    await bosalt();
    k.c.kapat();
    await bosalt();
    // Bırakma yazımı diske ulaşmadan süreç ölmüş: chat_create kuyruğun başında kalmış.
    const kayit = JSON.parse(k.depo.kv.get(OUTBOX_ANAHTARI) ?? "{}") as { ogeler: unknown[] };
    kayit.ogeler.unshift({
      mesaj: { v, type: "chat_create", client_msg_id: "eski-1", sohbet_id: "s-x-1", ad: "X" },
      gecici: false,
    });
    k.depo.kv.set(OUTBOX_ANAHTARI, JSON.stringify(kayit));

    const yeni = kur(k.depo);
    await yeni.c.baslat();
    await bosalt();
    await elSikis(yeni.ws.son(), 1);
    assert.deepEqual(isTurleri(yeni.ws.son()), ["user_message"]);
    assert.equal((k.depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes("chat_create"), false);
  });

  it("yerel sıfırlamada ack'li sohbetin disk kopyası da gider: sonraki açılışta geri gelmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(yankiOlayi(1, "a")));
    const r = await k.c.sohbetAc("Deneme");
    assert.ok(r.ok);
    await bosalt();
    b.gel(ack(String(turdekiler(b, "chat_create")[0]?.["client_msg_id"]), true, { seq: 5 }));
    await bosalt();
    assert.equal(ozet(k, r.sohbet_id)?.kurulum, "kuruldu");
    // Bilgisayarın geçmişi geride: yerel sıfırlama.
    b.kopsun();
    k.saat.ilerlet(1000);
    await bosalt();
    await elSikis(k.ws.son(), 0);
    await bosalt();
    assert.equal(ozet(k, r.sohbet_id), undefined);
    assert.equal((k.depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes("chat_create"), false);
    k.c.kapat();
    const yeni = kur(k.depo);
    await yeni.c.baslat();
    await bosalt();
    assert.deepEqual(kimlikler(yeni), ["ana"]);
  });

  it("otomatik ad yalnız varsayılan adlı, ana olmayan sohbetin ilk mesajında", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    await k.s.mesajYolla("ana mesajı", "yazi");
    const adli = await k.c.sohbetAc("Elle ad");
    assert.ok(adli.ok);
    await k.c.sohbet(adli.sohbet_id).mesajYolla("ilk mesaj", "yazi");
    await bosalt();
    assert.equal(turdekiler(b, "chat_rename").length, 0);
    assert.equal(ozet(k, "ana")?.ad, "Claude");
    assert.equal(ozet(k, adli.sohbet_id)?.ad, "Elle ad");
    // Boş ad varsayılandır (gecersiz değil), baş/son boşluk kırpılır.
    const bos = await k.c.sohbetAc("   ");
    assert.ok(bos.ok);
    assert.equal(ozet(k, bos.sohbet_id)?.ad, "Yeni sohbet");
    const kirp = await k.c.sohbetAc("  Kırpık  ");
    assert.ok(kirp.ok);
    assert.equal(ozet(k, kirp.sohbet_id)?.ad, "Kırpık");
  });

  it("geçersiz ad gecersiz; 8 sohbet sınırı (ana dahil), sınırda hiçbir şey yazılmaz; kurulamamışlar sayılmaz", async () => {
    const k = kur();
    await k.c.baslat();
    await bosalt();
    k.ws.son().kopsun();
    assert.deepEqual(await k.c.sohbetAc("a\nb"), { ok: false, neden: "gecersiz" });
    assert.deepEqual(await k.c.sohbetAc("x".repeat(61)), { ok: false, neden: "gecersiz" });
    const idler: string[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await k.c.sohbetAc();
      assert.ok(r.ok);
      idler.push(r.sohbet_id);
    }
    assert.equal(new Set(idler).size, 7);
    assert.equal(k.c.durum().sohbetler.length, 8);
    const outboxYazimi = k.depo.islemler.length;
    assert.deepEqual(await k.c.sohbetAc(), { ok: false, neden: "sohbet_siniri" });
    assert.deepEqual(await k.c.sohbetAc(" \n "), { ok: false, neden: "sohbet_siniri" });
    // Ad denetimi sınırdan önce.
    assert.deepEqual(await k.c.sohbetAc("a\nb"), { ok: false, neden: "gecersiz" });
    await bosalt();
    assert.equal(k.depo.islemler.length, outboxYazimi);
    assert.equal(k.c.durum().sohbetler.length, 8);
    assert.equal(k.c.durum().secili, idler[6]);

    // Biri PC'de kurulamazsa yer açılır.
    k.saat.ilerlet(1000);
    await bosalt();
    const b = k.ws.son();
    await elSikis(b);
    const kurulumlar = turdekiler(b, "chat_create");
    assert.equal(kurulumlar.length, 7);
    b.gel(ack(String(kurulumlar[0]?.["client_msg_id"]), false, { code: "sohbet_siniri" }));
    await bosalt();
    assert.equal(ozet(k, String(idler[0]))?.kurulum, "kurulamadi");
    const yeni = await k.c.sohbetAc();
    assert.ok(yeni.ok);
    assert.deepEqual(await k.c.sohbetAc(), { ok: false, neden: "sohbet_siniri" });
  });
});

describe("çekirdek: okunmamış", () => {
  it("asistan kaynaklı öğeler sayılır, kullanıcı yankısı ve bilgi notu sayılmaz; okundu sıfırlar, değişmezse yazmaz", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1")));
    b.gel(olayCercevesi(yankiOlayi(2, "m2", "kullanıcı", "s-x-1")));
    b.gel(olayCercevesi(asistanOlayi(3, "t1", "yanıt", "s-x-1")));
    b.gel(olayCercevesi(sistemNotu(4, "bilgi", "s-x-1")));
    b.gel(olayCercevesi(sistemNotu(5, "uyari", "s-x-1")));
    b.gel(olayCercevesi(asistanOlayi(6, "t2", "ana yanıtı")));
    await bosalt();
    assert.equal(ozet(k, "s-x-1")?.okunmamis, 2);
    assert.equal(ozet(k, "ana")?.okunmamis, 1);

    const iki = k.c.sohbet("s-x-1");
    iki.okundu();
    await bosalt();
    assert.equal(ozet(k, "s-x-1")?.okunmamis, 0);
    assert.equal(ozet(k, "ana")?.okunmamis, 1, "okundu yalnız kendi sohbetine");
    assert.equal(secimKaydi(k).okundu["s-x-1"], 6);
    const yazim = secimYazimlari(k);
    iki.okundu();
    await bosalt();
    assert.equal(secimYazimlari(k), yazim, "değişmeyen okundu yazılmaz");

    b.gel(olayCercevesi(asistanOlayi(7, "t3", "yeni", "s-x-1")));
    await bosalt();
    assert.equal(ozet(k, "s-x-1")?.okunmamis, 1);

    // Kalıcı: yeniden başlatmada okunmuş sınırı korunur.
    k.c.kapat();
    const yeni = kur(k.depo);
    await yeni.c.baslat();
    await bosalt();
    assert.equal(ozet(yeni, "s-x-1")?.okunmamis, 1);
    assert.equal(ozet(yeni, "ana")?.okunmamis, 1);

    // Listede olmayan sohbette okundu no-op.
    const yaz2 = secimYazimlari(yeni);
    yeni.c.sohbet("s-yok-1").okundu();
    await bosalt();
    assert.equal(secimYazimlari(yeni), yaz2);
  });

  it("yerel sıfırlamadan sonra seçim ana olur, okundu boşalır, ilk welcome.head_seq taban olur", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-a-1")));
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "x", "s-a-1")));
    b.gel(olayCercevesi(asistanOlayi(3, "t2", "y")));
    await bosalt();
    assert.equal(k.c.sec("s-a-1"), true);
    k.c.sohbet("s-a-1").okundu();
    await bosalt();
    assert.deepEqual(secimKaydi(k).okundu, { "s-a-1": 3 });

    b.kopsun();
    k.saat.ilerlet(1000);
    await bosalt();
    const ikinci = k.ws.son();
    await elSikis(ikinci, 1);
    assert.equal(ikinci.kapatildi, true);
    assert.deepEqual(kimlikler(k), ["ana"]);
    assert.equal(k.c.durum().secili, "ana");
    await bosalt();
    assert.equal(secimKaydi(k).acik, "ana");
    assert.deepEqual(secimKaydi(k).okundu, {});

    k.saat.ilerlet(60_000);
    await bosalt();
    const ucuncu = k.ws.son();
    assert.notEqual(ucuncu, ikinci);
    await elSikis(ucuncu, 3);
    assert.equal(ucuncu.giden()[0]?.["last_seq"], 0);
    // Baştan çekilen eski geçmiş (seq <= 3) okunmamış değil.
    ucuncu.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-a-1")));
    ucuncu.gel(olayCercevesi(asistanOlayi(2, "t1", "x", "s-a-1")));
    ucuncu.gel(olayCercevesi(asistanOlayi(3, "t2", "y")));
    await bosalt();
    assert.equal(ozet(k, "s-a-1")?.okunmamis, 0);
    assert.equal(ozet(k, "ana")?.okunmamis, 0);
    assert.equal(secimKaydi(k).taban_seq, 3);
    assert.deepEqual(secimKaydi(k).okundu, {});
    ucuncu.gel(olayCercevesi(asistanOlayi(4, "t3", "yeni", "s-a-1")));
    await bosalt();
    assert.equal(ozet(k, "s-a-1")?.okunmamis, 1);
  });
});

describe("çekirdek: sil", () => {
  it("ana silinemez; chat_delete v3 gider, tek yuva bütün sohbetlerde ortak", async () => {
    const k = kur();
    await k.c.baslat();
    await bosalt();
    assert.deepEqual(await k.s.sil(), { ok: false, kod: "sohbet_silinemez" });
    await elSikis(k.ws.son());
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1")));
    b.gel(olayCercevesi(sohbetAcildiOlayi(2, "s-x-2")));
    await bosalt();
    assert.deepEqual(await k.s.sil(), { ok: false, kod: "sohbet_silinemez" });
    const iki = k.c.sohbet("s-x-1");
    const uc = k.c.sohbet("s-x-2");

    const p = iki.sil();
    await bosalt();
    assert.deepEqual(await iki.gecmisiSil(), { ok: false, kod: "zaten_yollandi" });
    assert.deepEqual(await uc.sil(), { ok: false, kod: "zaten_yollandi" });
    assert.deepEqual(await k.s.gecmisiSil(), { ok: false, kod: "zaten_yollandi" });
    const silmeler = turdekiler(b, "chat_delete");
    assert.equal(silmeler.length, 1);
    assert.equal(turdekiler(b, "chat_clear").length, 0);
    assert.deepEqual([silmeler[0]?.["v"], silmeler[0]?.["sohbet_id"]], [v, "s-x-1"]);
    // Geçici: bekleyenlerde ve hatalarda görünmez.
    assert.deepEqual(iki.durum().bekleyenler, []);
    assert.deepEqual(iki.durum().hatalar, []);

    b.gel(ack(String(silmeler[0]?.["client_msg_id"]), false, { code: "sohbet_mesgul" }));
    await bosalt();
    assert.deepEqual(await p, { ok: false, kod: "sohbet_mesgul" });
    assert.deepEqual(iki.durum().hatalar, []);
    assert.equal(ozet(k, "s-x-1")?.kurulum, "kuruldu");

    // Yuva boşaldı: yeniden denenebilir.
    const p2 = uc.sil();
    await bosalt();
    const ikinci = turdekiler(b, "chat_delete")[1];
    assert.equal(ikinci?.["sohbet_id"], "s-x-2");
    b.gel(ack(String(ikinci?.["client_msg_id"]), true, { seq: 3 }));
    await bosalt();
    assert.deepEqual(await p2, { ok: true });
    // Liste olaydan kurulur: ack'te sohbet henüz durur.
    assert.equal(ozet(k, "s-x-2")?.kurulum, "kuruldu");
    b.gel(olayCercevesi(sohbetSilindiOlayi(3, "s-x-2")));
    await bosalt();
    assert.equal(uc.durum().ozet, null);
    assert.deepEqual(kimlikler(k).sort(), ["ana", "s-x-1"]);
  });

  it("chat_delete: ack gelmeden kopma baglanti_koptu (yeniden yollanmaz); 20 sn'de zaman_asimi ve bağlantı yenilenir", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1")));
    await bosalt();
    const iki = k.c.sohbet("s-x-1");
    const p = iki.sil();
    await bosalt();
    assert.equal(turdekiler(b, "chat_delete").length, 1);
    b.kopsun();
    await bosalt();
    assert.deepEqual(await p, { ok: false, kod: "baglanti_koptu" });
    assert.deepEqual(iki.durum().hatalar, []);
    // Bağlı değilken kuyruğa girmez.
    assert.deepEqual(await iki.sil(), { ok: false, kod: "bagli_degil" });
    k.saat.ilerlet(60_000);
    await bosalt();
    const d = k.ws.son();
    assert.notEqual(d, b);
    await elSikis(d, 1);
    assert.equal(turdekiler(d, "chat_delete").length, 0);

    const q = iki.sil();
    await bosalt();
    assert.equal(turdekiler(d, "chat_delete").length, 1);
    let cozuldu = false;
    void q.then(() => {
      cozuldu = true;
    });
    k.saat.ilerlet(GECMIS_SIL_SURESI_MS - 1);
    await bosalt();
    assert.equal(cozuldu, false);
    k.saat.ilerlet(1);
    await bosalt();
    assert.deepEqual(await q, { ok: false, kod: "zaman_asimi" });
    assert.equal(d.kapatildi, true);
    assert.equal(GECMIS_SIL_SURESI_MS, 20_000);
  });

  it("seçili sohbet silinince listenin başı (en son etkin) seçilir; artıkları, okundu girdisi gider; sonraki olaylar yok sayılır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-a-1", "A")));
    b.gel(olayCercevesi(sohbetAcildiOlayi(2, "s-b-1", "B")));
    b.gel(olayCercevesi(asistanOlayi(3, "t1", "A'da", "s-a-1")));
    b.gel(olayCercevesi(asistanOlayi(4, "t2", "B'de", "s-b-1")));
    b.gel(olayCercevesi(asistanOlayi(5, "t3", "A son", "s-a-1")));
    await bosalt();
    // Sıra: en son etkin önce; ana (etkinlik 0) sonda.
    assert.deepEqual(kimlikler(k), ["s-a-1", "s-b-1", "ana"]);
    const B = k.c.sohbet("s-b-1");
    assert.equal(k.c.sec("s-b-1"), true);
    B.okundu();
    // Yollanmış ama ack almamış mesaj: silinince kuyruktan da kalkar.
    const m = await B.mesajYolla("B-artik-metni", "yazi");
    assert.ok(m.ok);
    await bosalt();
    assert.equal(secimKaydi(k).okundu["s-b-1"], 5);

    const p = B.sil();
    await bosalt();
    const sil = turdekiler(b, "chat_delete")[0];
    b.gel(ack(String(sil?.["client_msg_id"]), true, { seq: 6 }));
    b.gel(olayCercevesi(sohbetSilindiOlayi(6, "s-b-1")));
    await bosalt();
    assert.deepEqual(await p, { ok: true });
    assert.deepEqual(kimlikler(k), ["s-a-1", "ana"]);
    assert.equal(k.c.durum().secili, "s-a-1");
    assert.equal(B.durum().ozet, null);
    assert.deepEqual(B.durum().ogeler, []);
    assert.deepEqual(B.durum().bekleyenler, []);
    await bosalt();
    assert.equal(secimKaydi(k).acik, "s-a-1");
    assert.equal(secimKaydi(k).okundu["s-b-1"], undefined);
    assert.equal((k.depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes("B-artik-metni"), false);

    // Silinmiş sohbete geç gelenler yok sayılır; eylemler sohbet_bulunamadi.
    b.gel(delta("t9", 0, "hayalet", "s-b-1"));
    b.gel(olayCercevesi(asistanOlayi(7, "t9", "hayalet", "s-b-1")));
    await bosalt();
    assert.equal(B.durum().akis, null);
    assert.deepEqual(B.durum().ogeler, []);
    assert.deepEqual(kimlikler(k), ["s-a-1", "ana"]);
    assert.deepEqual(await B.mesajYolla("x", "yazi"), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await B.sil(), { ok: false, kod: "sohbet_bulunamadi" });
    assert.equal(k.c.sec("s-b-1"), false);

    // Yeniden başlatmada silinmiş sohbet geri gelmez.
    k.c.kapat();
    const yeni = kur(k.depo);
    await yeni.c.baslat();
    await bosalt();
    assert.deepEqual(kimlikler(yeni), ["s-a-1", "ana"]);
    assert.equal(yeni.c.durum().secili, "s-a-1");
  });

  it("seçili sohbet silinince en son etkin kayıtlı sohbet seçilir; başta duran kurulamamış ve bekleyen satırlar seçilmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-a-1", "A")));
    b.gel(olayCercevesi(sohbetAcildiOlayi(2, "s-b-1", "B")));
    b.gel(olayCercevesi(asistanOlayi(3, "t1", "A son", "s-a-1")));
    await bosalt();
    // Defterde kaydı olmayan iki satır listenin başına geçer: biri kurulamadı, öteki PC'ye ulaşmadı.
    const kurulamayan = await k.c.sohbetAc("Kurulamayan");
    assert.ok(kurulamayan.ok);
    await bosalt();
    const cc = turdekiler(b, "chat_create")[0];
    b.gel(ack(String(cc?.["client_msg_id"]), false, { code: "sohbet_siniri" }));
    const bekleyen = await k.c.sohbetAc("Bekleyen");
    assert.ok(bekleyen.ok);
    await bosalt();
    assert.equal(ozet(k, kurulamayan.sohbet_id)?.kurulum, "kurulamadi");
    assert.equal(ozet(k, bekleyen.sohbet_id)?.kurulum, "bekliyor");
    assert.deepEqual(kimlikler(k).slice(2), ["s-a-1", "s-b-1", "ana"]);
    assert.deepEqual(
      new Set(kimlikler(k).slice(0, 2)),
      new Set([kurulamayan.sohbet_id, bekleyen.sohbet_id]),
    );

    assert.equal(k.c.sec("s-b-1"), true);
    const p = k.c.sohbet("s-b-1").sil();
    await bosalt();
    const sil = turdekiler(b, "chat_delete")[0];
    b.gel(ack(String(sil?.["client_msg_id"]), true, { seq: 4 }));
    b.gel(olayCercevesi(sohbetSilindiOlayi(4, "s-b-1")));
    await bosalt();
    assert.deepEqual(await p, { ok: true });
    assert.equal(k.c.durum().secili, "s-a-1");
    await bosalt();
    assert.equal(secimKaydi(k).acik, "s-a-1");
  });

  it("kurulamadı: eylemler sohbet_bulunamadi; sil kablosuz yerel kaldırır, seçim liste başına geçer", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const r = await k.c.sohbetAc("Deneme");
    assert.ok(r.ok);
    const s = k.c.sohbet(r.sohbet_id);
    const m = await s.mesajYolla("kurulamayan-metin", "yazi");
    assert.ok(m.ok);
    await bosalt();
    const cc = turdekiler(b, "chat_create")[0];
    b.gel(ack(String(cc?.["client_msg_id"]), false, { code: "sohbet_siniri" }));
    await bosalt();
    assert.equal(s.durum().ozet?.kurulum, "kurulamadi");
    assert.deepEqual(s.durum().hatalar.map((h) => [h.mesaj.type, h.kod]), [["chat_create", "sohbet_siniri"]]);
    assert.equal(k.c.durum().secili, r.sohbet_id);
    assert.deepEqual(await s.mesajYolla("x", "yazi"), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await s.adlandir("Yeni ad"), { ok: false, neden: "sohbet_bulunamadi" });
    assert.deepEqual(await s.gecmisiSil(), { ok: false, kod: "sohbet_bulunamadi" });
    assert.deepEqual(await s.kes(), { ok: false, neden: "sohbet_bulunamadi" });

    const once = b.gidenler.length;
    assert.deepEqual(await s.sil(), { ok: true });
    await bosalt();
    assert.equal(b.gidenler.length, once, "kablo yok");
    assert.equal(s.durum().ozet, null);
    assert.deepEqual(s.durum().hatalar, []);
    assert.deepEqual(s.durum().bekleyenler, []);
    assert.deepEqual(kimlikler(k), ["ana"]);
    assert.equal(k.c.durum().secili, "ana");
    assert.equal((k.depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes("kurulamayan-metin"), false);
    assert.equal((k.depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes(r.sohbet_id), false);
  });

  it("kurulamamış sohbetin chat_create hatası hataKapat ile kapanınca sohbet de kalkar", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const r = await k.c.sohbetAc();
    assert.ok(r.ok);
    await bosalt();
    const s = k.c.sohbet(r.sohbet_id);
    const cc = turdekiler(b, "chat_create")[0];
    b.gel(ack(String(cc?.["client_msg_id"]), false, { code: "sohbet_bulunamadi" }));
    await bosalt();
    const h = s.durum().hatalar[0];
    assert.ok(h !== undefined);
    await s.hataKapat(h.client_msg_id);
    await bosalt();
    assert.equal(s.durum().ozet, null);
    assert.deepEqual(kimlikler(k), ["ana"]);
    assert.equal(k.c.durum().secili, "ana");
  });
});

describe("çekirdek: adlandir", () => {
  it("geçersiz ad gecersiz; aynı ad degisti:false ve kablo yok; yeni ad hemen özette, chat_rename gider; ana adlandırılabilir", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1", "B")));
    await bosalt();
    const s = k.c.sohbet("s-x-1");
    assert.deepEqual(await s.adlandir("  "), { ok: false, neden: "gecersiz" });
    assert.deepEqual(await s.adlandir("a\nb"), { ok: false, neden: "gecersiz" });
    assert.deepEqual(await s.adlandir("x".repeat(61)), { ok: false, neden: "gecersiz" });
    assert.deepEqual(await s.adlandir(" B "), { ok: true, degisti: false });
    await bosalt();
    assert.equal(turdekiler(b, "chat_rename").length, 0);

    assert.deepEqual(await s.adlandir("  Yeni ad "), { ok: true, degisti: true });
    assert.equal(s.durum().ozet?.ad, "Yeni ad");
    await bosalt();
    const ren = turdekiler(b, "chat_rename");
    assert.equal(ren.length, 1);
    assert.deepEqual([ren[0]?.["v"], ren[0]?.["sohbet_id"], ren[0]?.["ad"]], [v, "s-x-1", "Yeni ad"]);

    assert.deepEqual(await k.s.adlandir("Asıl"), { ok: true, degisti: true });
    assert.equal(ozet(k, "ana")?.ad, "Asıl");
  });

  it("chat_rename ok:false: ad geri döner, hata o sohbetin hatalar'ında; ack ok ise ad olaya dek kalır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1", "B")));
    await bosalt();
    const s = k.c.sohbet("s-x-1");
    assert.deepEqual(await s.adlandir("Red"), { ok: true, degisti: true });
    await bosalt();
    const r1 = turdekiler(b, "chat_rename")[0];
    b.gel(ack(String(r1?.["client_msg_id"]), false, { code: "gecersiz_mesaj" }));
    await bosalt();
    assert.equal(s.durum().ozet?.ad, "B");
    assert.deepEqual(s.durum().hatalar.map((h) => h.mesaj.type), ["chat_rename"]);
    assert.deepEqual(k.s.durum().hatalar, []);
    assert.deepEqual(s.durum().bekleyenler, []);

    assert.deepEqual(await s.adlandir("Kabul"), { ok: true, degisti: true });
    await bosalt();
    const r2 = turdekiler(b, "chat_rename")[1];
    b.gel(ack(String(r2?.["client_msg_id"]), true, { seq: 2 }));
    await bosalt();
    assert.equal(s.durum().ozet?.ad, "Kabul");
    b.gel(olayCercevesi(adDegistiOlayi(2, "s-x-1", "Kabul")));
    await bosalt();
    assert.equal(s.durum().ozet?.ad, "Kabul");
  });
});

// =============================================================================================
// Dilim 3: kısayol (`/sohbet` v4, `input: "kisayol"`, `baglam`)
// =============================================================================================

describe("çekirdek: kısayol mesajı (Dilim 3)", () => {
  const BAGLAM = { paket: "com.whatsapp", ad: "WhatsApp" } as const;

  it("mesajYolla(metin, 'kisayol', baglam): user_message baglam'la gider; bekleyende ve yankıdan sonra balonda baglam var", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const r = await k.s.mesajYolla("buna ne cevap vereyim", "kisayol", BAGLAM);
    assert.ok(r.ok);
    await bosalt();
    const [um] = turdekiler(b, "user_message");
    assert.deepEqual(um, {
      v,
      type: "user_message",
      client_msg_id: r.client_msg_id,
      sohbet_id: "ana",
      input: "kisayol",
      text: "buna ne cevap vereyim",
      baglam: BAGLAM,
    });
    assert.equal(v, 5);
    const bekleyen = k.s.durum().bekleyenler[0]?.mesaj;
    assert.ok(bekleyen?.type === "user_message");
    assert.deepEqual(bekleyen.baglam, BAGLAM);

    b.gel(ack(r.client_msg_id, true, { seq: 1 }));
    b.gel(
      olayCercevesi({
        ...yankiOlayi(1, r.client_msg_id, "buna ne cevap vereyim"),
        input: "kisayol",
        baglam: BAGLAM,
      }),
    );
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler, []);
    const balon = k.s.durum().ogeler[0];
    assert.ok(balon?.tur === "kullanici");
    assert.equal(balon.input, "kisayol");
    assert.deepEqual(balon.baglam, BAGLAM);
  });

  it("kısayolda baglam isteğe bağlı: yoksa giden mesajda alan yoktur", async () => {
    const k = kur();
    await baslat(k);
    const r = await k.s.mesajYolla("not al", "kisayol");
    assert.ok(r.ok);
    await bosalt();
    const [um] = turdekiler(k.ws.son(), "user_message");
    assert.equal(um?.["input"], "kisayol");
    assert.ok(um !== undefined && !("baglam" in um));
  });

  it("baglam yalnız 'kisayol' ile: yazi/dikte ile gecersiz, hiçbir şey kuyruğa ve diske girmez (başlamadan önce de)", async () => {
    const k = kur();
    assert.deepEqual(await k.s.mesajYolla("x", "yazi", BAGLAM), { ok: false, neden: "gecersiz" });
    await baslat(k);
    const yazimOnce = k.depo.islemler.filter((i) => i.tur === "yaz" && i.anahtar === OUTBOX_ANAHTARI).length;
    assert.deepEqual(await k.s.mesajYolla("x", "yazi", BAGLAM), { ok: false, neden: "gecersiz" });
    assert.deepEqual(await k.s.mesajYolla("x", "dikte", BAGLAM), { ok: false, neden: "gecersiz" });
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler, []);
    assert.deepEqual(turdekiler(k.ws.son(), "user_message"), []);
    assert.equal(
      k.depo.islemler.filter((i) => i.tur === "yaz" && i.anahtar === OUTBOX_ANAHTARI).length,
      yazimOnce,
    );
  });

  it("şemadan geçmeyen baglam (paket deseni, ad uzunluğu, kontrol karakteri) gecersiz; geçerli kimlik harcanmaz", async () => {
    const k = kur();
    await baslat(k);
    for (const kotu of [
      { paket: "tekparca", ad: "A" },
      { paket: "com.ornek", ad: "" },
      { paket: "com.ornek", ad: "x".repeat(81) },
      { paket: "com.ornek", ad: "a\u0007b" },
    ]) {
      assert.deepEqual(await k.s.mesajYolla("x", "kisayol", kotu), { ok: false, neden: "gecersiz" });
    }
    assert.deepEqual(k.s.durum().bekleyenler, []);
    const r = await k.s.mesajYolla("x", "kisayol", { paket: "com.ornek", ad: "x".repeat(80) });
    assert.ok(r.ok);
    assert.match(r.client_msg_id, /-1$/);
  });

  it("baglam nesnesindeki fazladan alanlar kabloya gitmez (yalnız paket ve ad)", async () => {
    const k = kur();
    await baslat(k);
    const fazla = { paket: "com.android.chrome", ad: "Chrome", id: "k-1", zaman_ms: 5 };
    const r = await k.s.mesajYolla("özetle", "kisayol", fazla);
    assert.ok(r.ok);
    await bosalt();
    const [um] = turdekiler(k.ws.son(), "user_message");
    assert.deepEqual(um?.["baglam"], { paket: "com.android.chrome", ad: "Chrome" });
  });

  it("yeni 'Telefon' sohbeti çevrimdışı bekliyorken kısayol mesajı o sohbete kuyruklanır; adı otomatik değişmez", async () => {
    const k = kur();
    await k.c.baslat();
    await bosalt();
    k.ws.son().kopsun();
    const ac = await k.c.sohbetAc("Telefon");
    assert.ok(ac.ok);
    const s = k.c.sohbet(ac.sohbet_id);
    const r = await s.mesajYolla("alarmı kur", "kisayol", BAGLAM);
    assert.ok(r.ok);
    assert.equal(ozet(k, ac.sohbet_id)?.ad, "Telefon");
    k.saat.ilerlet(1000);
    await bosalt();
    const b = k.ws.son();
    await elSikis(b, 0);
    assert.deepEqual(isTurleri(b), ["chat_create", "user_message"]);
    const um = turdekiler(b, "user_message")[0];
    assert.deepEqual([um?.["sohbet_id"], um?.["input"], um?.["baglam"]], [ac.sohbet_id, "kisayol", BAGLAM]);
  });

  it("diskte kalmış v3 kullanıcı mesajı yüklemede güncel sürüm olur ve aynı kimlikle gider", async () => {
    const depo = new SahteDepo();
    depo.kv.set(
      OUTBOX_ANAHTARI,
      JSON.stringify({
        donem: "abc",
        sayac: 3,
        ogeler: [
          {
            mesaj: { v: 3, type: "user_message", client_msg_id: "abc-3", sohbet_id: "ana", input: "dikte", text: "eski" },
            gecici: false,
          },
        ],
        hatalar: [],
      }),
    );
    const k = kur(depo);
    await baslat(k);
    assert.deepEqual(k.s.durum().bekleyenler.map((x) => x.client_msg_id), ["abc-3"]);
    const [um] = turdekiler(k.ws.son(), "user_message");
    assert.deepEqual([um?.["v"], um?.["client_msg_id"], um?.["input"], um?.["text"]], [v, "abc-3", "dikte", "eski"]);
  });
});
