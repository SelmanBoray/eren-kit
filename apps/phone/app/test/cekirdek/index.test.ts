import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Plan, planHash } from "@eren/protocol";
import { BEKCI_SURELERI, cekirdekKur, GECMIS_SIL_SURESI_MS } from "../../src/cekirdek/index.ts";
import type { CekirdekDurumu, SesPortu, SohbetDurumu, SohbetOzeti } from "../../src/cekirdek/index.ts";
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
    // Kasıtlı tüketim isteği dışında hiçbir şey yollanmadı (bağlanınca tam bir kez, client_msg_id'siz).
    assert.deepEqual(isTurleri(k.ws.son()), ["usage_request"]);
    const [ur] = turdekiler(k.ws.son(), "usage_request");
    assert.equal(ur?.["v"], v);
    assert.equal(typeof ur?.["istek_id"], "string");
    assert.equal("client_msg_id" in (ur ?? {}), false);
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
    assert.deepEqual(isTurleri(b), ["chat_create", "user_message", "chat_rename", "user_message", "usage_request"]);
    const [cc, um, cr] = b.giden().slice(-5, -1);
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
    assert.deepEqual(isTurleri(b), ["usage_request", "chat_create", "user_message", "chat_rename"]);
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
    assert.deepEqual(isTurleri(b2), ["chat_create", "user_message", "usage_request"]);
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
    assert.deepEqual(isTurleri(yeni.ws.son()), ["user_message", "usage_request"]);
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
    assert.deepEqual(isTurleri(b), ["chat_create", "user_message", "usage_request"]);
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

// =============================================================================================
// Bağlantı bekçisi (sessiz kopuş) ve karar teslimi
// =============================================================================================

const { YANIT_MS, YOKLAMA_MS } = BEKCI_SURELERI;

/** Telafi günlüğüne olay ekleme kapı açılana dek bekler: `ack` ile olayın uygulanması arası pencere. */
class KapiliDepo extends SahteDepo {
  kapi: { bekle: Promise<void>; ac: () => void } | null = null;
  kapiKapat(): void {
    let ac: () => void = () => undefined;
    const bekle = new Promise<void>((r) => {
      ac = r;
    });
    this.kapi = { bekle, ac };
  }
  kapiAc(): void {
    const k = this.kapi;
    this.kapi = null;
    k?.ac();
  }
  override ekle(anahtar: string, satir: string): Promise<void> {
    const k = this.kapi;
    if (k === null || anahtar !== TELAFI_ANAHTARLARI.olaylar) return super.ekle(anahtar, satir);
    return k.bekle.then(() => super.ekle(anahtar, satir));
  }
}

const planOnerisi = (seq: number, plan_id: string) => {
  const plan = Plan.parse(ornekPlan(plan_id));
  return { seq, ts_ms: 1000 + seq, type: "plan_proposed", plan, plan_hash: planHash(plan) };
};
const planSonuclandi = (seq: number, plan_id: string, plan_hash: string) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "plan_resolved",
  plan_id,
  plan_hash,
  sonuc: "onaylandi",
});
const soruSoruldu = (seq: number, soru_id: string, is_id: number) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "question_asked",
  soru_id,
  is_id,
  soru: "Hangisi?",
});
const soruSonuclandi = (seq: number, soru_id: string, is_id: number) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "question_resolved",
  soru_id,
  is_id,
  sonuc: "cevaplandi",
});
const isBitti = (seq: number, is_id: number) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "job_finished",
  is_id,
  durum: "iptal",
  kirli: false,
});

const sifirTuketim = { girdi: 0, cache_yazma: 0, cache_okuma: 0, cikti: 0, sonuc_adet: 0 };
const tuketimRaporu = (istek_id: string) => ({
  v,
  type: "usage_report",
  istek_id,
  olcum_ms: 5,
  gun_baslangic_ms: 0,
  bugun: { sohbet: sifirTuketim, is: sifirTuketim },
  son_7_gun: { sohbet: sifirTuketim, is: sifirTuketim },
  sohbetler: [],
  isler: [],
});

const yoklamalar = (c: Giden): string[] =>
  turdekiler(c, "usage_request")
    .map((m) => String(m["istek_id"]))
    .filter((id) => id.startsWith("yoklama-"));

const bekleyenOzeti = (d: SohbetDurumu): [string, string][] => d.bekleyenler.map((x) => [x.mesaj.type, x.durum]);

/** Plan kartını `ana`'da kurar; kartın özeti döner. */
const planKartiKur = async (k: Kurulum, seq: number, plan_id: string): Promise<string> => {
  k.ws.son().gel(olayCercevesi(planOnerisi(seq, plan_id)));
  await bosalt();
  const kart = k.s.durum().ogeler.find((o) => o.tur === "plan" && o.plan_id === plan_id);
  assert.ok(kart !== undefined && kart.tur === "plan");
  return kart.plan_hash;
};

const planDurumu = (k: Kurulum, plan_id: string): string | undefined => {
  const kart = k.s.durum().ogeler.find((o) => o.tur === "plan" && o.plan_id === plan_id);
  return kart?.tur === "plan" ? kart.durum : undefined;
};

describe("çekirdek: bağlantı bekçisi (sessiz kopuş)", () => {
  it("(a) ack'i gelmeyen kısa mesaj: 20 sn sessizlikte bağlantı kapanır, yeniden bağlanınca aynı kimlikle bir kez gider", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const a = await k.s.mesajYolla("merhaba", "yazi");
    assert.ok(a.ok);
    await bosalt();
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [["user_message", "yollandi"]]);

    k.saat.ilerlet(YANIT_MS - 1);
    await bosalt();
    assert.equal(b.kapatildi, false);
    assert.equal(k.c.durum().baglanti, "bagli");

    k.saat.ilerlet(1);
    await bosalt();
    assert.equal(b.kapatildi, true);
    assert.equal(k.c.durum().baglanti, "kapali");
    assert.notEqual(k.c.durum().sonrakiDenemeMs, null);
    // Mesaj kaybolmaz: kuyrukta bağlantıyı bekler.
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [["user_message", "kuyrukta"]]);

    k.saat.ilerlet(1_000);
    await bosalt();
    const d = k.ws.son();
    assert.notEqual(d, b);
    await elSikis(d, 0);
    // Aynı `client_msg_id`: servis kayıtlı `ack`'i döner, iş ikinci kez yapılmaz.
    assert.deepEqual(
      turdekiler(d, "user_message").map((m) => m["client_msg_id"]),
      [a.client_msg_id],
    );
    assert.equal(turdekiler(b, "user_message").length, 1);
    d.gel(ack(a.client_msg_id, true, { seq: 1 }));
    await bosalt();
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [["user_message", "teslim_edildi"]]);
    d.gel(olayCercevesi(yankiOlayi(1, a.client_msg_id, "merhaba")));
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler, []);
    // Yanıtlanan mesajdan sonra bekçi yok: zaman geçse de bağlantı kalır.
    k.saat.ilerlet(10 * YANIT_MS);
    await bosalt();
    assert.equal(d.kapatildi, false);
  });

  it("araya gelen her çerçeve canlılık kanıtıdır: süre son çerçeveden sayılır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const a = await k.s.mesajYolla("merhaba", "yazi");
    assert.ok(a.ok);
    await bosalt();
    k.saat.ilerlet(15_000);
    b.gel(sunucuDurumu());
    await bosalt();
    k.saat.ilerlet(YANIT_MS - 1);
    await bosalt();
    assert.equal(b.kapatildi, false);
    k.saat.ilerlet(1);
    await bosalt();
    assert.equal(b.kapatildi, true);
  });

  it("(b) plan_decision ve job_cancel'ın geç ack'i kopuş sayılmaz: sessizlikte yoklama yollanır, yanıtı gelince bağlantı kalır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const hash = await planKartiKur(k, 1, "p1");
    b.gel(olayCercevesi(isBasladiOlayi(2, 7)));
    await bosalt();
    const karar = await k.s.planKarari("p1", hash, "onay");
    const iptal = await k.s.isIptal(7);
    assert.ok(karar.ok && iptal.ok);
    await bosalt();
    assert.deepEqual(isTurleri(b).filter((t) => t === "plan_decision" || t === "job_cancel"), ["plan_decision", "job_cancel"]);

    // Bir dakika boyunca iş başlamadı/durmadı: her sessiz `YOKLAMA_MS`'te bir yoklama, yanıtı gelir.
    for (let i = 1; i <= 6; i++) {
      k.saat.ilerlet(YOKLAMA_MS - 1);
      await bosalt();
      assert.equal(yoklamalar(b).length, i - 1);
      k.saat.ilerlet(1);
      await bosalt();
      assert.equal(b.kapatildi, false);
      assert.deepEqual(yoklamalar(b), Array.from({ length: i }, (_, j) => `yoklama-${j + 1}`));
      b.gel(tuketimRaporu(`yoklama-${i}`));
      await bosalt();
    }
    assert.equal(k.c.durum().baglanti, "bagli");
    // Yoklama yanıtı tüketim isteğinin yanıtı sayılmaz.
    assert.notEqual(k.c.durum().tuketim.durum, "hazir");
    // Kararlar yeniden yollanmadı.
    assert.equal(turdekiler(b, "plan_decision").length, 1);
    assert.equal(turdekiler(b, "job_cancel").length, 1);

    b.gel(olayCercevesi(planSonuclandi(3, "p1", hash)));
    b.gel(ack(karar.client_msg_id));
    b.gel(olayCercevesi(isBitti(4, 7)));
    b.gel(ack(iptal.client_msg_id));
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler, []);
    // Yanıt beklenmiyor: yoklama da bekçi de yok.
    const sayi = yoklamalar(b).length;
    k.saat.ilerlet(10 * YANIT_MS);
    await bosalt();
    assert.equal(yoklamalar(b).length, sayi);
    assert.equal(b.kapatildi, false);
  });

  it("geç yanıtlı karar beklenirken yoklama da yanıtsız kalırsa bağlantı kapanır (toplam 20 sn); karar yeniden aynı kimlikle gider", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const hash = await planKartiKur(k, 1, "p1");
    const karar = await k.s.planKarari("p1", hash, "onay");
    assert.ok(karar.ok);
    await bosalt();
    k.saat.ilerlet(YOKLAMA_MS);
    await bosalt();
    assert.deepEqual(yoklamalar(b), ["yoklama-1"]);
    k.saat.ilerlet(YOKLAMA_MS - 1);
    await bosalt();
    assert.equal(b.kapatildi, false);
    k.saat.ilerlet(1);
    await bosalt();
    assert.equal(b.kapatildi, true);
    assert.equal(k.c.durum().baglanti, "kapali");
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [["plan_decision", "kuyrukta"]]);

    k.saat.ilerlet(1_000);
    await bosalt();
    const d = k.ws.son();
    await elSikis(d, 1);
    assert.deepEqual(
      turdekiler(d, "plan_decision").map((m) => m["client_msg_id"]),
      [karar.client_msg_id],
    );
  });

  it("(c) bekçi boşta zamanlayıcı bırakmaz; ack, kopma, yeniden bağlanma ve kapat onu temizler", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    // Boşta: yalnız tüketim isteğinin süresi.
    const bosta = k.saat.bekleyenler();
    assert.equal(bosta.includes(YANIT_MS), false);

    const a = await k.s.mesajYolla("bir", "yazi");
    assert.ok(a.ok);
    await bosalt();
    assert.deepEqual(k.saat.bekleyenler().filter((x) => x === YANIT_MS).length, 1);
    // İkinci mesaj ikinci zamanlayıcı kurmaz.
    const a2 = await k.s.mesajYolla("iki", "yazi");
    assert.ok(a2.ok);
    await bosalt();
    assert.equal(k.saat.bekleyenler().length, bosta.length + 1);
    b.gel(ack(a.client_msg_id, true, { seq: 1 }));
    b.gel(ack(a2.client_msg_id, true, { seq: 2 }));
    await bosalt();
    assert.deepEqual(k.saat.bekleyenler(), bosta);

    // Kopma: yalnız yeniden bağlanma beklemesi kalır (tüketim süresi de iptal).
    const a3 = await k.s.mesajYolla("üç", "yazi");
    assert.ok(a3.ok);
    await bosalt();
    assert.equal(k.saat.bekleyenler().length, bosta.length + 1);
    b.kopsun();
    await bosalt();
    assert.deepEqual(k.saat.bekleyenler(), [1_000]);

    // Yeniden bağlanınca yeniden yollanan mesaj için tek bekçi.
    k.saat.ilerlet(1_000);
    await bosalt();
    await elSikis(k.ws.son(), 2);
    assert.equal(turdekiler(k.ws.son(), "user_message").length, 1);
    assert.equal(k.saat.bekleyenler().filter((x) => x === YANIT_MS).length, 1);

    // Durdurma: hiçbir zamanlayıcı kalmaz.
    k.c.kapat();
    await bosalt();
    assert.deepEqual(k.saat.bekleyenler(), []);
  });
});

describe("çekirdek: karar teslimi (ack ile olay arası)", () => {
  it("(d) karar ack'i ile olayın uygulanması arasında kart 'bekliyor'a dönmez, ikinci karar zaten_yollandi", async () => {
    const depo = new KapiliDepo();
    const k = kur(depo);
    await baslat(k);
    const b = k.ws.son();
    const hash = await planKartiKur(k, 1, "p1");
    b.gel(olayCercevesi(isBasladiOlayi(2, 7)));
    b.gel(olayCercevesi(soruSoruldu(3, "q1", 7)));
    await bosalt();
    const r1 = await k.s.planKarari("p1", hash, "onay");
    const r2 = await k.s.soruCevapla("q1", "evet");
    const r3 = await k.s.isIptal(7);
    assert.ok(r1.ok && r2.ok && r3.ok);
    await bosalt();
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [
      ["plan_decision", "yollandi"],
      ["question_answer", "yollandi"],
      ["job_cancel", "yollandi"],
    ]);

    // Servis olayı `ack`'ten önce yollar; telefon olayı önce diske yazar (burada yazım bekletiliyor).
    depo.kapiKapat();
    b.gel(olayCercevesi(planSonuclandi(4, "p1", hash)));
    b.gel(ack(r1.client_msg_id));
    b.gel(olayCercevesi(soruSonuclandi(5, "q1", 7)));
    b.gel(ack(r2.client_msg_id));
    b.gel(olayCercevesi(isBitti(6, 7)));
    b.gel(ack(r3.client_msg_id));
    await bosalt();

    // Pencere: kartlar henüz sonuçlanmadı, kararlar teslimde görünür (ekran "Başlatılıyor" der).
    assert.equal(planDurumu(k, "p1"), "bekliyor");
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [
      ["plan_decision", "teslim_edildi"],
      ["question_answer", "teslim_edildi"],
      ["job_cancel", "teslim_edildi"],
    ]);
    const plan = k.s.durum().bekleyenler[0]?.mesaj;
    assert.ok(plan !== undefined && plan.type === "plan_decision" && plan.karar === "onay");
    // İkinci dokunuş kabloya çıkmaz.
    assert.deepEqual(await k.s.planKarari("p1", hash, "onay"), { ok: false, neden: "zaten_yollandi" });
    assert.deepEqual(await k.s.planKarari("p1", hash, "ret"), { ok: false, neden: "zaten_yollandi" });
    assert.deepEqual(await k.s.soruCevapla("q1", "hayır"), { ok: false, neden: "zaten_yollandi" });
    assert.deepEqual(await k.s.isIptal(7), { ok: false, neden: "zaten_yollandi" });
    await bosalt();
    assert.equal(turdekiler(b, "plan_decision").length, 1);
    assert.equal(turdekiler(b, "question_answer").length, 1);
    assert.equal(turdekiler(b, "job_cancel").length, 1);
    assert.deepEqual(k.s.durum().hatalar, []);

    depo.kapiAc();
    await bosalt();
    assert.equal(planDurumu(k, "p1"), "onaylandi");
    assert.deepEqual(k.s.durum().bekleyenler, []);
    assert.deepEqual(await k.s.planKarari("p1", hash, "onay"), { ok: false, neden: "plan_sonuclandi" });
    assert.deepEqual(await k.s.soruCevapla("q1", "evet"), { ok: false, neden: "soru_sonuclandi" });
    assert.deepEqual(await k.s.isIptal(7), { ok: false, neden: "is_bitti" });
  });

  it("olayı ack'ten önce uygulanmış karar teslime girmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const hash = await planKartiKur(k, 1, "p1");
    const r = await k.s.planKarari("p1", hash, "onay");
    assert.ok(r.ok);
    await bosalt();
    b.gel(olayCercevesi(planSonuclandi(2, "p1", hash)));
    await bosalt();
    b.gel(ack(r.client_msg_id));
    await bosalt();
    assert.equal(planDurumu(k, "p1"), "onaylandi");
    assert.deepEqual(k.s.durum().bekleyenler, []);
  });

  it("(e) olay uygulanamadan bağlantı koparsa teslim sürer; yeniden bağlanınca telafiyle gelen olayla gerçek duruma oturur", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const hash = await planKartiKur(k, 1, "p1");
    const r = await k.s.planKarari("p1", hash, "onay");
    assert.ok(r.ok);
    await bosalt();

    k.depo.hata.ekle = true;
    b.gel(olayCercevesi(planSonuclandi(2, "p1", hash)));
    b.gel(ack(r.client_msg_id));
    await bosalt();
    // Olay günlüğe yazılamadı: bağlantı kapandı, kart sonuçlanmadı ama karar teslimde kalır.
    assert.equal(b.kapatildi, true);
    assert.equal(planDurumu(k, "p1"), "bekliyor");
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [["plan_decision", "teslim_edildi"]]);
    assert.deepEqual(await k.s.planKarari("p1", hash, "onay"), { ok: false, neden: "zaten_yollandi" });

    k.depo.hata.ekle = false;
    k.saat.ilerlet(30_000);
    await bosalt();
    const d = k.ws.son();
    assert.notEqual(d, b);
    await elSikis(d, 2);
    d.gel(olayCercevesi(planSonuclandi(2, "p1", hash)));
    await bosalt();
    assert.equal(planDurumu(k, "p1"), "onaylandi");
    assert.deepEqual(k.s.durum().bekleyenler, []);
    assert.equal(turdekiler(d, "plan_decision").length, 0);
  });

  it("(e) olayı hiç gelmeyen karar takılı kalmaz: telafi ack anındaki olaylara ulaşınca kart yeniden karar ister", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const hash = await planKartiKur(k, 1, "p1");
    const r = await k.s.planKarari("p1", hash, "onay");
    assert.ok(r.ok);
    await bosalt();

    // `ack`'ten önce alınan olay kartın sonucu değil; yazılamadan bağlantı kopar.
    k.depo.hata.ekle = true;
    b.gel(olayCercevesi(sistemNotu(2, "uyari")));
    b.gel(ack(r.client_msg_id));
    await bosalt();
    assert.equal(b.kapatildi, true);
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [["plan_decision", "teslim_edildi"]]);

    k.depo.hata.ekle = false;
    k.saat.ilerlet(30_000);
    await bosalt();
    const d = k.ws.son();
    await elSikis(d, 2);
    d.gel(olayCercevesi(sistemNotu(2, "uyari")));
    await bosalt();
    assert.equal(planDurumu(k, "p1"), "bekliyor");
    assert.deepEqual(k.s.durum().bekleyenler, []);
    // Kart gerçek durumunda: karar yeniden verilebilir.
    const yeni = await k.s.planKarari("p1", hash, "onay");
    assert.ok(yeni.ok);
  });

  it("yerel sıfırlama karar teslimlerini boşaltır", async () => {
    const depo = new KapiliDepo();
    const k = kur(depo);
    await baslat(k);
    const b = k.ws.son();
    const hash = await planKartiKur(k, 1, "p1");
    const r = await k.s.planKarari("p1", hash, "onay");
    assert.ok(r.ok);
    await bosalt();
    depo.kapiKapat();
    b.gel(olayCercevesi(planSonuclandi(2, "p1", hash)));
    b.gel(ack(r.client_msg_id));
    await bosalt();
    assert.deepEqual(bekleyenOzeti(k.s.durum()), [["plan_decision", "teslim_edildi"]]);
    // Olay hâlâ yazılmayı beklerken bağlantı kopar; bilgisayarın geçmişi geride: yerel geçmiş silinir.
    b.kopsun();
    await bosalt();
    k.saat.ilerlet(1_000);
    await bosalt();
    const d = k.ws.son();
    d.acildi();
    await bosalt();
    d.gel(challenge());
    await bosalt();
    d.gel(welcome(0));
    assert.deepEqual(k.s.durum().ogeler, []);
    assert.deepEqual(k.s.durum().bekleyenler, []);
    depo.kapiAc();
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler, []);
  });
});

// =============================================================================================
// Asistanın etkinliği (`assistant_activity`)
// =============================================================================================

describe("çekirdek: asistan etkinliği", () => {
  const etkinlikCercevesi = (
    turn_id: string,
    etkinlik: string,
    gecen_ms: number,
    sohbet_id = "ana",
    kaynak_msg_id?: string,
  ) => ({
    v,
    type: "assistant_activity",
    sohbet_id,
    turn_id,
    etkinlik,
    gecen_ms,
    ...(kaynak_msg_id === undefined ? {} : { kaynak_msg_id }),
  });

  /** Görünür tur kapandı (`assistant_activity_end`); kalıcı değil, telafide oynatılmaz. */
  const bitisCercevesi = (turn_id: string, sohbet_id = "ana") => ({
    v,
    type: "assistant_activity_end",
    sohbet_id,
    turn_id,
  });

  const iptalOlayi = (seq: number, turn_id: string, sohbet_id?: string) => ({
    seq,
    ts_ms: 1000 + seq,
    type: "turn_aborted",
    ...(sohbet_id === undefined ? {} : { sohbet_id }),
    turn_id,
    neden: "kullanici_kesti",
  });

  it("servis yollamazsa etkinlik hep null", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    assert.equal(k.s.durum().etkinlik, null);
    b.gel(snapshot("t1", "Merhaba"));
    b.gel(olayCercevesi(asistanOlayi(1, "t1", "Merhaba")));
    await bosalt();
    assert.equal(k.s.durum().etkinlik, null);
  });

  it("bilinen sohbete gelen çerçeve etkinliği doldurur, aboneyi haberdar eder; baslangic_ms telefonun saatiyle", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const gorulen: SohbetDurumu[] = [];
    const birak = k.s.abone((d) => gorulen.push(d));
    const once = gorulen.length;
    b.gel(etkinlikCercevesi("t1", "dusunuyor", 0));
    assert.deepEqual(k.s.durum().etkinlik, { turn_id: "t1", etkinlik: "dusunuyor", baslangic_ms: k.saat.simdi });
    assert.ok(gorulen.length > once, "abone haberdar edilmeli");
    assert.deepEqual(gorulen.at(-1)?.etkinlik, k.s.durum().etkinlik);

    k.saat.ilerlet(5_000);
    b.gel(etkinlikCercevesi("t1", "komut", 1_500));
    assert.deepEqual(k.s.durum().etkinlik, {
      turn_id: "t1",
      etkinlik: "komut",
      baslangic_ms: k.saat.simdi - 1_500,
    });
    // Akış durumu etkinlikten bağımsızdır.
    assert.equal(k.s.durum().akis, null);
    birak();
  });

  it("etkinlik yalnız kendi sohbetinde görünür", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-x-1", "İkinci")));
    await bosalt();
    const iki = k.c.sohbet("s-x-1");
    b.gel(etkinlikCercevesi("t9", "web", 0, "s-x-1"));
    assert.equal(iki.durum().etkinlik?.etkinlik, "web");
    assert.equal(k.s.durum().etkinlik, null);
  });

  it("aynı turun assistant_message'ı etkinliği siler; bitmiş turun gecikmiş çerçevesi geri getirmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(etkinlikCercevesi("t1", "yaziyor", 0));
    b.gel(olayCercevesi(asistanOlayi(1, "t1", "Bitti.")));
    await bosalt();
    assert.equal(k.s.durum().etkinlik, null);
    b.gel(etkinlikCercevesi("t1", "komut", 0));
    assert.equal(k.s.durum().etkinlik, null);
    // Yeni tur yeniden doldurur.
    b.gel(etkinlikCercevesi("t2", "dosya_okuma", 0));
    assert.equal(k.s.durum().etkinlik?.turn_id, "t2");
  });

  it("aynı turun turn_aborted'ı etkinliği siler; başka turun bitişi silmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(etkinlikCercevesi("t2", "arac", 0));
    b.gel(olayCercevesi(iptalOlayi(1, "t1")));
    await bosalt();
    assert.equal(k.s.durum().etkinlik?.turn_id, "t2");
    b.gel(olayCercevesi(iptalOlayi(2, "t2")));
    await bosalt();
    assert.equal(k.s.durum().etkinlik, null);
    b.gel(etkinlikCercevesi("t2", "arac", 0));
    assert.equal(k.s.durum().etkinlik, null);
  });

  it("bağlantı kopunca etkinlik null olur", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(etkinlikCercevesi("t1", "dusunuyor", 0));
    assert.notEqual(k.s.durum().etkinlik, null);
    b.kopsun();
    assert.equal(k.s.durum().etkinlik, null);
  });

  it("yerel sıfırlamada etkinlik null olur; yeni geçmişte yeniden dolar", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(yankiOlayi(1, "a")));
    await bosalt();
    b.gel(etkinlikCercevesi("t1", "dusunuyor", 0));
    assert.notEqual(k.s.durum().etkinlik, null);
    // Bilgisayarın geçmişi geride: yerel sıfırlama.
    b.kopsun();
    k.saat.ilerlet(1000);
    await bosalt();
    await elSikis(k.ws.son(), 0);
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler, []);
    assert.equal(k.s.durum().etkinlik, null);
    // Sıfırlama bağlantıyı yeniler; yeni geçmişte etkinlik yeniden dolar.
    k.saat.ilerlet(60_000);
    await bosalt();
    const yeni = k.ws.son();
    assert.notEqual(yeni, b);
    await elSikis(yeni, 0);
    yeni.gel(etkinlikCercevesi("t5", "plan", 0));
    assert.equal(k.s.durum().etkinlik?.turn_id, "t5");
  });

  it("silinmiş sohbete gelen çerçeve yok sayılır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-b-1", "B")));
    b.gel(olayCercevesi(sohbetSilindiOlayi(2, "s-b-1")));
    await bosalt();
    const B = k.c.sohbet("s-b-1");
    assert.doesNotThrow(() => b.gel(etkinlikCercevesi("t9", "komut", 0, "s-b-1")));
    await bosalt();
    assert.equal(B.durum().etkinlik, null);
    assert.deepEqual(kimlikler(k), ["ana"]);
    assert.equal(k.c.durum().hata, null);
  });

  it("bilinmeyen sohbete gelen çerçeve hata üretmez, listeyi değiştirmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const listeOnce = kimlikler(k);
    assert.doesNotThrow(() => b.gel(etkinlikCercevesi("t9", "komut", 0, "s-yok-1")));
    await bosalt();
    assert.deepEqual(kimlikler(k), listeOnce);
    assert.equal(k.s.durum().etkinlik, null);
    assert.equal(k.c.durum().hata, null);
  });

  it("diske yazılmaz, telafi sayacını etkilemez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(yankiOlayi(1, "a")));
    await bosalt();
    const islemOnce = k.depo.islemler.length;
    const kvOnce = JSON.stringify([...k.depo.kv]);
    const gunlukOnce = JSON.stringify([...k.depo.gunlukler]);
    b.gel(etkinlikCercevesi("t1", "dusunuyor", 0));
    b.gel(etkinlikCercevesi("t1", "komut", 10));
    await bosalt();
    assert.equal(k.depo.islemler.length, islemOnce);
    assert.equal(JSON.stringify([...k.depo.kv]), kvOnce);
    assert.equal(JSON.stringify([...k.depo.gunlukler]), gunlukOnce);
    // Sonraki olay `seq` 2 ile sorunsuz uygulanır (sayaç kaymadı).
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Cevap")));
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.seq), [1, 2]);
  });

  it("assistant_activity_end etkinliği null yapar ve aboneyi haberdar eder", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(etkinlikCercevesi("t1", "dusunuyor", 0));
    assert.notEqual(k.s.durum().etkinlik, null);
    const gorulen: SohbetDurumu[] = [];
    const birak = k.s.abone((d) => gorulen.push(d));
    const once = gorulen.length;
    b.gel(bitisCercevesi("t1"));
    await bosalt();
    assert.equal(k.s.durum().etkinlik, null);
    assert.ok(gorulen.length > once, "abone haberdar edilmeli");
    assert.equal(gorulen.at(-1)?.etkinlik, null);
    birak();
  });

  it("başka turun bitiş çerçevesi mevcut etkinliği silmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(etkinlikCercevesi("t2", "komut", 0));
    b.gel(bitisCercevesi("t1"));
    await bosalt();
    assert.equal(k.s.durum().etkinlik?.turn_id, "t2");
    assert.equal(k.s.durum().etkinlik?.etkinlik, "komut");
  });

  it("bitiş çerçevesinden sonra aynı turun gecikmiş etkinlik çerçevesi durumu geri getirmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(etkinlikCercevesi("t1", "yaziyor", 0));
    b.gel(bitisCercevesi("t1"));
    b.gel(etkinlikCercevesi("t1", "komut", 50));
    await bosalt();
    assert.equal(k.s.durum().etkinlik, null);
    // Yeni tur yeniden doldurur.
    b.gel(etkinlikCercevesi("t2", "dusunuyor", 0));
    assert.equal(k.s.durum().etkinlik?.turn_id, "t2");
  });

  it("bitiş olayı yazılmadan kapanan tur: bitiş çerçevesi gelince, server_status hâlâ tur_suruyor olsa da etkinlik null", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(sunucuDurumu({ sohbetler: [{ sohbet_id: "ana", eren: "tur_suruyor" }] }));
    b.gel(etkinlikCercevesi("t1", "dusunuyor", 0));
    b.gel(bitisCercevesi("t1"));
    b.gel(sunucuDurumu({ sohbetler: [{ sohbet_id: "ana", eren: "tur_suruyor" }] }));
    await bosalt();
    assert.equal(k.s.durum().etkinlik, null);
    assert.deepEqual(k.s.durum().ogeler, [], "kalıcı olay yok");
  });

  it("silinmiş sohbete gelen bitiş çerçevesi yok sayılır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(sohbetAcildiOlayi(1, "s-b-1", "B")));
    b.gel(olayCercevesi(sohbetSilindiOlayi(2, "s-b-1")));
    await bosalt();
    const listeOnce = kimlikler(k);
    assert.doesNotThrow(() => b.gel(bitisCercevesi("t9", "s-b-1")));
    await bosalt();
    assert.equal(k.c.sohbet("s-b-1").durum().etkinlik, null);
    assert.deepEqual(kimlikler(k), listeOnce);
    assert.equal(k.c.durum().hata, null);
    assert.equal(b.kapatildi, false, "bağlantı kapanmamalı");
  });

  it("bitiş çerçevesi diske yazılmaz, telafi sayacını etkilemez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(olayCercevesi(yankiOlayi(1, "a")));
    await bosalt();
    b.gel(etkinlikCercevesi("t1", "dusunuyor", 0));
    await bosalt();
    const islemOnce = k.depo.islemler.length;
    const kvOnce = JSON.stringify([...k.depo.kv]);
    const gunlukOnce = JSON.stringify([...k.depo.gunlukler]);
    b.gel(bitisCercevesi("t1"));
    await bosalt();
    assert.equal(k.depo.islemler.length, islemOnce);
    assert.equal(JSON.stringify([...k.depo.kv]), kvOnce);
    assert.equal(JSON.stringify([...k.depo.gunlukler]), gunlukOnce);
    assert.equal(k.depo.kv.get(TELAFI_ANAHTARLARI.sonSeq), "1");
    // Sonraki olay `seq` 2 ile sorunsuz uygulanır (sayaç kaymadı).
    b.gel(olayCercevesi(asistanOlayi(2, "t1", "Cevap")));
    await bosalt();
    assert.deepEqual(k.s.durum().ogeler.map((g) => g.seq), [1, 2]);
  });

  it("sesli cevap mantığını etkilemez: dikte cevabı arada etkinlik gelse de bir kez okunur", async () => {
    const seslendirilenler: string[] = [];
    const ses: SesPortu = {
      seslendir: (metin) => {
        seslendirilenler.push(metin);
        return Promise.resolve(true);
      },
      durdur: () => Promise.resolve(),
      durumDinle: () => () => undefined,
    };
    const ws = new SahteWs();
    const saat = new SahteSaat();
    const c = cekirdekKur({ ws, kimlik: new SahteKimlik(), depo: new SahteDepo(), saat, ses });
    await c.baslat();
    await bosalt();
    await elSikis(ws.son(), 0);
    const s = c.sohbet("ana");
    const g = await s.mesajYolla("nasıl gitti", "dikte");
    assert.ok(g.ok);
    await bosalt();
    const b = ws.son();
    b.gel(ack(g.client_msg_id, true, { seq: 1 }));
    b.gel(olayCercevesi({ ...yankiOlayi(1, g.client_msg_id, "nasıl gitti"), input: "dikte" }));
    // Sözleşme: tur insan mesajıyla başladıysa etkinlik çerçeveleri `kaynak_msg_id` taşır.
    b.gel(etkinlikCercevesi("t2", "dusunuyor", 0, "ana", g.client_msg_id));
    b.gel(etkinlikCercevesi("t2", "komut", 100, "ana", g.client_msg_id));
    b.gel(olayCercevesi(asistanOlayi(2, "t2", "Tamam.")));
    b.gel(bitisCercevesi("t2"));
    await bosalt();
    assert.deepEqual(seslendirilenler, ["Tamam."]);
    assert.equal(s.durum().etkinlik, null);
    c.kapat();
  });
});
