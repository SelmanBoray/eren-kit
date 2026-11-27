import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OUTBOX_ANAHTARI, outboxKur } from "../../src/cekirdek/outbox.ts";
import type { Outbox } from "../../src/cekirdek/outbox.ts";
import type { SohbetYukari } from "@eren/protocol";
import { SOHBET_SURUMU } from "@eren/protocol";
import type { EkleSonucu, GidenGovde, IsMesaji, MesajHazirligi } from "../../src/cekirdek/sozlesme.ts";
import { ack, bosalt, HASH_A, SahteDepo, SahteSaat } from "./sahte.ts";

const kur = (depo = new SahteDepo(), saat = new SahteSaat()) => {
  let degisti = 0;
  const o: Outbox = outboxKur({
    depo,
    saat,
    degisti: () => {
      degisti++;
    },
  });
  return { depo, saat, o, degistiSayisi: () => degisti };
};

const yazi = (text: string, sohbet_id = "ana") => ({ type: "user_message", sohbet_id, input: "yazi", text }) as const;

/** `gonder` portunu kaydeden sahte bağlantı. */
const kablo = () => {
  const yollanan: SohbetYukari[] = [];
  return {
    yollanan,
    gonder: (m: SohbetYukari): boolean => {
      yollanan.push(m);
      return true;
    },
    metinler: () => yollanan.map((m) => (m.type === "user_message" ? m.text : m.type)),
  };
};

const ackCerceve = (id: string, ok = true, extra: Record<string, unknown> = {}) => {
  const c = ack(id, ok, extra);
  return c as Parameters<Outbox["ack"]>[0];
};

describe("outbox", () => {
  it("uçak modunda yazılan mesajlar yeniden bağlanınca bir kez, sırayla gider", async () => {
    const { o } = kur();
    await o.yukle();
    const a = await o.ekle(yazi("bir"));
    const b = await o.ekle(yazi("iki"));
    const c = await o.ekle(yazi("uc"));
    assert.ok(a.ok && b.ok && c.ok);
    assert.deepEqual(o.ogeler().map((g) => g.yollandi), [false, false, false]);

    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(k.metinler(), ["bir", "iki", "uc"]);
    assert.deepEqual(o.ogeler().map((g) => g.yollandi), [true, true, true]);

    // Aynı bağlantıda yeni mesaj yalnız kendisi gider, öncekiler tekrarlanmaz.
    await o.ekle(yazi("dort"));
    assert.deepEqual(k.metinler(), ["bir", "iki", "uc", "dort"]);

    // ack gelenler bir sonraki bağlantıda yollanmaz.
    o.ack(ackCerceve((a as { client_msg_id: string }).client_msg_id, true, { seq: 1 }));
    o.koptu();
    const k2 = kablo();
    o.kimlikTamam(k2.gonder);
    assert.deepEqual(k2.metinler(), ["iki", "uc", "dort"]);
  });

  it("client_msg_id her mesajda farklıdır ve mesaj diske yazılmadan yollanmaz", async () => {
    const { o, depo } = kur();
    await o.yukle();
    const k = kablo();
    o.kimlikTamam(k.gonder);
    const diskteydi: boolean[] = [];
    const sarmal = (m: SohbetYukari): boolean => {
      diskteydi.push((depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes(JSON.stringify((m as { client_msg_id: string }).client_msg_id)));
      return k.gonder(m);
    };
    o.kimlikTamam(sarmal);
    const a = await o.ekle(yazi("x"));
    const b = await o.ekle(yazi("x"));
    assert.ok(a.ok && b.ok);
    assert.notEqual(a.client_msg_id, b.client_msg_id);
    assert.deepEqual(diskteydi, [true, true]);
  });

  it("aynı ack iki kez gelirse ikincisi zararsızdır", async () => {
    const { o } = kur();
    await o.yukle();
    const r = await o.ekle(yazi("x"));
    assert.ok(r.ok);
    const k = kablo();
    o.kimlikTamam(k.gonder);
    const birinci = o.ack(ackCerceve(r.client_msg_id, true, { seq: 4 }));
    assert.ok(birinci !== null && birinci.ok === true);
    assert.equal(birinci.seq, 4);
    assert.equal(o.ack(ackCerceve(r.client_msg_id, true, { seq: 4 })), null);
    assert.equal(o.ack(ackCerceve("bilinmeyen-1")), null);
    assert.equal(o.ogeler().length, 0);
    assert.equal(o.hatalar().length, 0);
    // Reddedilmiş mesajın ikinci ack'i de hata listesini çoğaltmaz.
    const r2 = await o.ekle(yazi("y"));
    assert.ok(r2.ok);
    o.ack(ackCerceve(r2.client_msg_id, false));
    assert.equal(o.ack(ackCerceve(r2.client_msg_id, false)), null);
    assert.equal(o.hatalar().length, 1);
  });

  it("ok:false yeniden yollanmaz ve hatalar'a düşer", async () => {
    const { o } = kur();
    await o.yukle();
    const r = await o.ekle(yazi("x"));
    assert.ok(r.ok);
    const k = kablo();
    o.kimlikTamam(k.gonder);
    const s = o.ack(ackCerceve(r.client_msg_id, false, { code: "limit_kilitli" }));
    assert.ok(s !== null && s.ok === false);
    assert.equal(s.kod, "limit_kilitli");
    assert.equal(o.ogeler().length, 0);
    assert.deepEqual(o.hatalar().map((h) => [h.client_msg_id, h.kod]), [[r.client_msg_id, "limit_kilitli"]]);
    o.koptu();
    const k2 = kablo();
    o.kimlikTamam(k2.gonder);
    assert.equal(k2.yollanan.length, 0);
    await o.hataKapat(r.client_msg_id);
    assert.equal(o.hatalar().length, 0);
  });

  it("yeniden başlatmada kuyruk, hatalar ve sayaç korunur", async () => {
    const depo = new SahteDepo();
    const bir = kur(depo);
    await bir.o.yukle();
    const a = await bir.o.ekle(yazi("kalir"));
    const b = await bir.o.ekle(yazi("hata olacak"));
    assert.ok(a.ok && b.ok);
    bir.o.kimlikTamam(kablo().gonder);
    bir.o.ack(ackCerceve(b.client_msg_id, false, { code: "eren_hazir_degil" }));
    await bir.o.bosalt();

    const iki = kur(depo, new SahteSaat());
    await iki.o.yukle();
    assert.deepEqual(iki.o.ogeler().map((g) => g.client_msg_id), [a.client_msg_id]);
    assert.deepEqual(iki.o.hatalar().map((h) => h.kod), ["eren_hazir_degil"]);
    // Yüklenen öğe yeni süreçte bu bağlantıda yollanmamış sayılır.
    assert.equal(iki.o.ogeler()[0]?.yollandi, false);
    const c = await iki.o.ekle(yazi("yeni"));
    assert.ok(c.ok);
    const kimlikler = new Set([a.client_msg_id, b.client_msg_id, c.client_msg_id]);
    assert.equal(kimlikler.size, 3);
    const k = kablo();
    iki.o.kimlikTamam(k.gonder);
    assert.deepEqual(k.metinler(), ["kalir", "yeni"]);
  });

  it("depo silinse de client_msg_id tekrarlanmaz", async () => {
    const saat = new SahteSaat();
    const depo = new SahteDepo();
    const bir = kur(depo, saat);
    await bir.o.yukle();
    const a = await bir.o.ekle(yazi("x"));
    assert.ok(a.ok);

    depo.kv.clear();
    saat.ilerlet(5_000);
    const iki = kur(depo, saat);
    await iki.o.yukle();
    const b = await iki.o.ekle(yazi("x"));
    assert.ok(b.ok);
    assert.notEqual(b.client_msg_id, a.client_msg_id);

    // Kayıt bozulursa da aynı.
    depo.kv.set(OUTBOX_ANAHTARI, "{bozuk");
    saat.ilerlet(5_000);
    const uc = kur(depo, saat);
    await uc.o.yukle();
    const c = await uc.o.ekle(yazi("x"));
    assert.ok(c.ok);
    assert.notEqual(c.client_msg_id, a.client_msg_id);
    assert.notEqual(c.client_msg_id, b.client_msg_id);
  });

  it("yazım başarısız olursa mesaj yollanmaz, kimlik yeniden kullanılmaz", async () => {
    const { o, depo } = kur();
    await o.yukle();
    const k = kablo();
    o.kimlikTamam(k.gonder);
    depo.hata.yaz = true;
    const bozuk = await o.ekle(yazi("kaybolmali"));
    assert.deepEqual(bozuk, { ok: false, neden: "depo_hatasi" });
    assert.equal(k.yollanan.length, 0);
    assert.equal(o.ogeler().length, 0);
    depo.hata.yaz = false;
    const iyi = await o.ekle(yazi("tamam"));
    assert.ok(iyi.ok);
    assert.equal(k.metinler().join(), "tamam");
    const gecen = k.yollanan[0] as { client_msg_id: string };
    assert.equal(gecen.client_msg_id, iyi.client_msg_id);
  });

  it("geçersiz gövde reddedilir ve hiçbir şey yazılmaz", async () => {
    const { o, depo } = kur();
    await o.yukle();
    const once = depo.islemler.length;
    assert.deepEqual(await o.ekle(yazi("")), { ok: false, neden: "gecersiz" });
    assert.equal(o.ogeler().length, 0);
    assert.equal(depo.islemler.length, once);
  });

  it("geçici (hedefsiz kesme) öğe kopunca yollanmaz, baglanti_koptu hatası olur", async () => {
    const { o } = kur();
    await o.yukle();
    const k = kablo();
    o.kimlikTamam(k.gonder);
    const r = await o.ekle({ type: "interrupt", sohbet_id: "ana" }, { gecici: true });
    assert.ok(r.ok);
    o.koptu();
    assert.equal(o.ogeler().length, 0);
    assert.deepEqual(o.hatalar().map((h) => h.kod), ["baglanti_koptu"]);
    const k2 = kablo();
    o.kimlikTamam(k2.gonder);
    assert.equal(k2.yollanan.length, 0);
  });

  it("gonder false dönerse kalan öğeler sırayı bozmadan bekler", async () => {
    const { o } = kur();
    await o.yukle();
    await o.ekle(yazi("a"));
    await o.ekle(yazi("b"));
    let acik = false;
    const yollanan: string[] = [];
    o.kimlikTamam((m) => {
      if (!acik) return false;
      yollanan.push(m.type === "user_message" ? m.text : m.type);
      return true;
    });
    // deepEqual bir assertion imzasıdır: `[]` ile daraltıp diziyi never[] yapar, o yüzden length.
    assert.equal(yollanan.length, 0);
    acik = true;
    o.kimlikTamam((m) => {
      yollanan.push(m.type === "user_message" ? m.text : m.type);
      return true;
    });
    assert.deepEqual(yollanan, ["a", "b"]);
  });

  it("plan_decision gibi diğer iş mesajları da kuyruğa girer, ack ile silinir", async () => {
    const { o } = kur();
    await o.yukle();
    const r = await o.ekle({ type: "plan_decision", plan_id: "p1", plan_hash: HASH_A, karar: "onay" });
    assert.ok(r.ok);
    assert.equal(o.ogeler()[0]?.mesaj.type, "plan_decision");
    await bosalt();
    o.ack(ackCerceve(r.client_msg_id));
    assert.equal(o.ogeler().length, 0);
  });
  it("ekle güncel sürüm üretir: kuyruktaki, yollanan ve diske yazılan mesajda v SOHBET_SURUMU", async () => {
    const { o, depo } = kur();
    await o.yukle();
    const k = kablo();
    o.kimlikTamam(k.gonder);
    const r = await o.ekle(yazi("selam"));
    assert.ok(r.ok);
    assert.equal(SOHBET_SURUMU, 5);
    assert.equal(o.ogeler()[0]?.mesaj.v, SOHBET_SURUMU);
    assert.equal(k.yollanan.length, 1);
    assert.equal(k.yollanan[0]?.v, SOHBET_SURUMU);
    const kayit = JSON.parse(depo.kv.get(OUTBOX_ANAHTARI) ?? "{}") as { ogeler: { mesaj: { v: number } }[] };
    assert.deepEqual(kayit.ogeler.map((g) => g.mesaj.v), [SOHBET_SURUMU]);
  });

  it("chat_clear geçici öğedir: güncel sürümle yollanır, ack sonrası kuyrukta ve hatalarda iz kalmaz, kopmada yeniden yollanmaz", async () => {
    // MODULLER.md: chat_clear `outbox.ekle` ile gecici öğe olarak girer ama `ogeler`'de görünmez;
    // burada yalnız gözlenebilir sözleşme sabitlenir: ok:true ack'te kuyruk boş, hata yok.
    const { o } = kur();
    await o.yukle();
    const k = kablo();
    o.kimlikTamam(k.gonder);
    const r = await o.ekle({ type: "chat_clear", sohbet_id: "ana" }, { gecici: true });
    assert.ok(r.ok);
    assert.equal(k.yollanan[0]?.type, "chat_clear");
    assert.equal(k.yollanan[0]?.v, SOHBET_SURUMU);
    o.ack(ackCerceve(r.client_msg_id, true, { seq: 9 }));
    assert.equal(o.ogeler().length, 0);
    assert.equal(o.hatalar().length, 0);
    // Kopmadan önce ack gelmeseydi geçici öğe yeniden yollanmaz.
    const r2 = await o.ekle({ type: "chat_clear", sohbet_id: "ana" }, { gecici: true });
    assert.ok(r2.ok);
    o.koptu();
    const k2 = kablo();
    o.kimlikTamam(k2.gonder);
    assert.equal(k2.yollanan.length, 0);
  });

  describe("v1/v2 kayıtların güncel sürüme (SOHBET_SURUMU) yükseltilmesi (K1)", () => {
    const v1 = (client_msg_id: string, text: string) => ({ v: 1, type: "user_message", client_msg_id, input: "yazi", text });
    const diskeKoy = (depo: SahteDepo, kayit: Record<string, unknown>) =>
      depo.kv.set(OUTBOX_ANAHTARI, JSON.stringify({ donem: "abc", sayac: 7, ogeler: [], hatalar: [], ...kayit }));

    it("kuyruktaki v1/v2 öğeler atılmaz, güncel sürüm olur, eksik sohbet_id 'ana' olur, kimlik ve sıra korunur", async () => {
      const depo = new SahteDepo();
      diskeKoy(depo, {
        ogeler: [
          { mesaj: v1("abc-3", "uc"), gecici: false },
          { mesaj: v1("abc-1", "bir"), gecici: false },
          { mesaj: { v: 1, type: "interrupt", client_msg_id: "abc-5" }, gecici: false },
        ],
      });
      const { o } = kur(depo);
      await o.yukle();
      assert.deepEqual(o.ogeler().map((g) => g.client_msg_id), ["abc-3", "abc-1", "abc-5"]);
      assert.ok(o.ogeler().every((g) => g.mesaj.v === SOHBET_SURUMU));
      const k = kablo();
      o.kimlikTamam(k.gonder);
      assert.deepEqual(k.yollanan.map((m) => [m.v, (m as { client_msg_id: string }).client_msg_id]), [
        [SOHBET_SURUMU, "abc-3"],
        [SOHBET_SURUMU, "abc-1"],
        [SOHBET_SURUMU, "abc-5"],
      ]);
      assert.equal(k.metinler().slice(0, 2).join(), "uc,bir");
    });

    it("hatalar listesindeki v1/v2 öğeler de yükseltilir", async () => {
      const depo = new SahteDepo();
      diskeKoy(depo, {
        hatalar: [{ client_msg_id: "abc-2", mesaj: v1("abc-2", "reddedildi"), kod: "limit_kilitli" }],
      });
      const { o } = kur(depo);
      await o.yukle();
      assert.deepEqual(o.hatalar().map((h) => [h.client_msg_id, h.kod, h.mesaj.v]), [["abc-2", "limit_kilitli", SOHBET_SURUMU]]);
    });

    it("yükseltilen kayıt bir sonraki yazımda güncel sürümle diske yazılır, sayaç sürer", async () => {
      const depo = new SahteDepo();
      diskeKoy(depo, { ogeler: [{ mesaj: v1("abc-7", "eski"), gecici: false }] });
      const { o } = kur(depo);
      await o.yukle();
      const r = await o.ekle(yazi("yeni"));
      assert.ok(r.ok);
      assert.equal(r.client_msg_id, "abc-8");
      await o.bosalt();
      const kayit = JSON.parse(depo.kv.get(OUTBOX_ANAHTARI) ?? "{}") as { ogeler: { mesaj: { v: number; client_msg_id: string } }[] };
      assert.deepEqual(kayit.ogeler.map((g) => [g.mesaj.client_msg_id, g.mesaj.v]), [["abc-7", SOHBET_SURUMU], ["abc-8", SOHBET_SURUMU]]);
    });

    it("yükseltilince de şemadan geçmeyen öğe atılır, geçerliler kalır", async () => {
      const depo = new SahteDepo();
      diskeKoy(depo, {
        ogeler: [
          { mesaj: v1("abc-1", ""), gecici: false }, // boş metin geçersiz
          { mesaj: { v: 1, type: "user_message", client_msg_id: "abc-2" }, gecici: false }, // alanlar eksik
          { mesaj: { ...v1("abc-3", "x"), type: "bilinmeyen_tur" }, gecici: false },
          { mesaj: v1("abc-4", "gecerli"), gecici: false },
        ],
        hatalar: [
          { client_msg_id: "abc-5", mesaj: v1("abc-5", ""), kod: "limit_kilitli" },
          { client_msg_id: "abc-6", mesaj: v1("abc-6", "x"), kod: "olmayan_kod" },
          { client_msg_id: "abc-8", mesaj: v1("abc-8", "iyi"), kod: "limit_kilitli" },
        ],
      });
      const { o } = kur(depo);
      await o.yukle();
      assert.deepEqual(o.ogeler().map((g) => g.client_msg_id), ["abc-4"]);
      assert.deepEqual(o.hatalar().map((h) => h.client_msg_id), ["abc-8"]);
    });
  });

  describe("Dilim 2: çoklu sohbet", () => {
    const diskeKoy = (depo: SahteDepo, kayit: Record<string, unknown>) =>
      depo.kv.set(OUTBOX_ANAHTARI, JSON.stringify({ donem: "abc", sayac: 9, ogeler: [], hatalar: [], ...kayit }));
    const sohbetIdsi = (m: unknown) => (m as { sohbet_id?: string }).sohbet_id;
    const diskKayit = (depo: SahteDepo) =>
      JSON.parse(depo.kv.get(OUTBOX_ANAHTARI) ?? "{}") as {
        sayac: number;
        ogeler: { mesaj: { v: number; type: string; client_msg_id: string } }[];
        hatalar: { mesaj: { v: number } }[];
      };
    const yazimSayisi = (depo: SahteDepo) => depo.islemler.filter((i) => i.tur === "yaz").length;

    describe("yükseltme", () => {
      it("v1/v2 user_message, interrupt: eksik sohbet_id 'ana' olur, varsa korunur; geçici chat_clear atılır", async () => {
        const depo = new SahteDepo();
        diskeKoy(depo, {
          ogeler: [
            { mesaj: { v: 2, type: "user_message", client_msg_id: "abc-1", input: "yazi", text: "a" }, gecici: false },
            { mesaj: { v: 1, type: "interrupt", client_msg_id: "abc-2" }, gecici: false },
            { mesaj: { v: 2, type: "user_message", client_msg_id: "abc-3", input: "yazi", text: "b", sohbet_id: "s-x" }, gecici: false },
            { mesaj: { v: 2, type: "chat_clear", client_msg_id: "abc-4" }, gecici: true },
          ],
        });
        const { o } = kur(depo);
        const oz = await o.yukle();
        assert.deepEqual(oz, { yukseltilen: 3, atilan: 1 });
        assert.deepEqual(
          o.ogeler().map((g) => [g.client_msg_id, sohbetIdsi(g.mesaj)]),
          [["abc-1", "ana"], ["abc-2", "ana"], ["abc-3", "s-x"]],
        );
        assert.ok(o.ogeler().every((g) => g.mesaj.v === SOHBET_SURUMU));
      });

      it("hatalar listesinde: v2 interrupt 'ana' ile yükselir, v2 chat_clear geçici tür olarak atılır", async () => {
        const depo = new SahteDepo();
        diskeKoy(depo, {
          hatalar: [
            { client_msg_id: "abc-1", mesaj: { v: 2, type: "chat_clear", client_msg_id: "abc-1" }, kod: "baglanti_koptu" },
            { client_msg_id: "abc-2", mesaj: { v: 2, type: "interrupt", client_msg_id: "abc-2", turn_id: "t" }, kod: "baglanti_koptu" },
          ],
        });
        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 1, atilan: 1 });
        assert.deepEqual(
          o.hatalar().map((h) => [h.client_msg_id, sohbetIdsi(h.mesaj), h.mesaj.v]),
          [["abc-2", "ana", SOHBET_SURUMU]],
        );
      });

      it("plan_decision/question_answer/job_cancel yalnız v değiştirir, sohbet_id eklenmez", async () => {
        const depo = new SahteDepo();
        diskeKoy(depo, {
          ogeler: [
            { mesaj: { v: 2, type: "plan_decision", client_msg_id: "abc-1", plan_id: "p", plan_hash: HASH_A, karar: "onay" }, gecici: false },
            { mesaj: { v: 1, type: "question_answer", client_msg_id: "abc-2", soru_id: "q", cevap: "evet" }, gecici: false },
            { mesaj: { v: 2, type: "job_cancel", client_msg_id: "abc-3", is_id: 5 }, gecici: false },
          ],
        });
        const { o } = kur(depo);
        const oz = await o.yukle();
        assert.deepEqual(oz, { yukseltilen: 3, atilan: 0 });
        assert.deepEqual(o.ogeler().map((g) => g.mesaj.type), ["plan_decision", "question_answer", "job_cancel"]);
        assert.ok(o.ogeler().every((g) => g.mesaj.v === SOHBET_SURUMU && !("sohbet_id" in g.mesaj)));
      });

      it("güncel sürüm kaydı olduğu gibi kalır ve yükseltilen sayılmaz; başka v atılır", async () => {
        const depo = new SahteDepo();
        diskeKoy(depo, {
          ogeler: [
            { mesaj: { v: SOHBET_SURUMU, type: "user_message", client_msg_id: "abc-1", sohbet_id: "s-abc-1", input: "yazi", text: "a" }, gecici: false },
            { mesaj: { v: SOHBET_SURUMU, type: "chat_create", client_msg_id: "abc-2", sohbet_id: "s-abc-1", ad: "X" }, gecici: false },
            { mesaj: { v: SOHBET_SURUMU + 1, type: "user_message", client_msg_id: "abc-3", sohbet_id: "ana", input: "yazi", text: "z" }, gecici: false },
            { mesaj: { v: 0, type: "user_message", client_msg_id: "abc-4", sohbet_id: "ana", input: "yazi", text: "z" }, gecici: false },
          ],
        });
        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 0, atilan: 2 });
        assert.deepEqual(o.ogeler().map((g) => g.client_msg_id), ["abc-1", "abc-2"]);
      });

      it("0.5.0: v4 kayıt (kısayol ve baglam dahil) kayıpsız güncel sürüme yükselir; yalnız v değişir", async () => {
        const depo = new SahteDepo();
        const baglam = { paket: "com.whatsapp", ad: "WhatsApp" };
        const v4Ogeler = [
          { v: 4, type: "user_message", client_msg_id: "abc-1", sohbet_id: "ana", input: "kisayol", text: "a", baglam },
          { v: 4, type: "plan_decision", client_msg_id: "abc-2", plan_id: "p", plan_hash: HASH_A, karar: "onay" },
        ];
        diskeKoy(depo, { ogeler: v4Ogeler.map((mesaj) => ({ mesaj, gecici: false })) });
        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 2, atilan: 0 });
        assert.deepEqual(
          o.ogeler().map((g) => g.mesaj),
          v4Ogeler.map((m) => ({ ...m, v: SOHBET_SURUMU })),
        );
      });

      it("Dilim 3: v3 kuyruk ve hata öğeleri kayıpsız güncel sürüm olur; alanlar, kimlik ve sıra aynı kalır", async () => {
        const depo = new SahteDepo();
        const v3Ogeler = [
          { v: 3, type: "chat_create", client_msg_id: "abc-1", sohbet_id: "s-abc-1", ad: "Alışveriş" },
          { v: 3, type: "user_message", client_msg_id: "abc-2", sohbet_id: "s-abc-1", input: "dikte", text: "süt al" },
          { v: 3, type: "chat_rename", client_msg_id: "abc-3", sohbet_id: "s-abc-1", ad: "Market" },
          { v: 3, type: "interrupt", client_msg_id: "abc-4", sohbet_id: "ana", turn_id: "t-1" },
          { v: 3, type: "plan_decision", client_msg_id: "abc-5", plan_id: "p", plan_hash: HASH_A, karar: "ret" },
          { v: 3, type: "question_answer", client_msg_id: "abc-6", soru_id: "q", cevap: "evet" },
          { v: 3, type: "job_cancel", client_msg_id: "abc-7", is_id: 2 },
        ];
        const v3Hata = { v: 3, type: "user_message", client_msg_id: "abc-8", sohbet_id: "ana", input: "yazi", text: "red" };
        diskeKoy(depo, {
          ogeler: v3Ogeler.map((mesaj) => ({ mesaj, gecici: false })),
          hatalar: [{ client_msg_id: "abc-8", mesaj: v3Hata, kod: "sohbet_bulunamadi" }],
        });
        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 8, atilan: 0 });
        assert.deepEqual(
          o.ogeler().map((g) => g.mesaj),
          v3Ogeler.map((m) => ({ ...m, v: SOHBET_SURUMU })),
        );
        assert.deepEqual(o.ogeler().map((g) => g.client_msg_id), v3Ogeler.map((m) => m.client_msg_id));
        assert.deepEqual(o.hatalar(), [{ client_msg_id: "abc-8", mesaj: { ...v3Hata, v: SOHBET_SURUMU }, kod: "sohbet_bulunamadi" }]);
        // Kablo da v4 görür, aynı sırayla.
        const k = kablo();
        o.kimlikTamam(k.gonder);
        assert.deepEqual(
          k.yollanan.map((m) => [m.v, (m as { client_msg_id: string }).client_msg_id]),
          v3Ogeler.map((m) => [SOHBET_SURUMU, m.client_msg_id]),
        );
      });

      it("Dilim 3: v3 kayıt sonraki yazımda güncel sürümle yazılır; v3'te sohbet_id'siz user_message 'ana'ya bağlanmaz, atılır", async () => {
        const depo = new SahteDepo();
        diskeKoy(depo, {
          ogeler: [
            { mesaj: { v: 3, type: "user_message", client_msg_id: "abc-1", sohbet_id: "s-abc-1", input: "yazi", text: "a" }, gecici: false },
            // v3'te sohbet_id zorunluydu: eksikse kayıt bozuktur.
            { mesaj: { v: 3, type: "user_message", client_msg_id: "abc-2", input: "yazi", text: "b" }, gecici: false },
          ],
        });
        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 1, atilan: 1 });
        await o.ekle(yazi("yeni", "s-abc-1"));
        await o.bosalt();
        const kayit = diskKayit(depo);
        assert.deepEqual(kayit.ogeler.map((g) => [g.mesaj.client_msg_id, g.mesaj.v]), [["abc-1", SOHBET_SURUMU], ["abc-10", SOHBET_SURUMU]]);
      });

      it("Dilim 3: eski sürümde olamayacak kısayol alanları taşıyan v1/v2/v3 kayıt atılır", async () => {
        const depo = new SahteDepo();
        const baglam = { paket: "com.whatsapp", ad: "WhatsApp" };
        diskeKoy(depo, {
          ogeler: [
            { mesaj: { v: 3, type: "user_message", client_msg_id: "abc-1", sohbet_id: "ana", input: "kisayol", text: "a" }, gecici: false },
            { mesaj: { v: 3, type: "user_message", client_msg_id: "abc-2", sohbet_id: "ana", input: "kisayol", text: "b", baglam }, gecici: false },
            { mesaj: { v: 2, type: "user_message", client_msg_id: "abc-3", input: "kisayol", text: "c" }, gecici: false },
            { mesaj: { v: 3, type: "user_message", client_msg_id: "abc-4", sohbet_id: "ana", input: "yazi", text: "d", baglam }, gecici: false },
            { mesaj: { v: 3, type: "user_message", client_msg_id: "abc-5", sohbet_id: "ana", input: "yazi", text: "kalir" }, gecici: false },
          ],
        });
        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 1, atilan: 4 });
        assert.deepEqual(o.ogeler().map((g) => g.client_msg_id), ["abc-5"]);
      });

      it("Dilim 3: kısayol mesajı baglam'ıyla diske yazılır ve yeniden yüklemede aynen döner", async () => {
        const depo = new SahteDepo();
        const a = kur(depo);
        await a.o.yukle();
        const govde = {
          type: "user_message",
          sohbet_id: "ana",
          input: "kisayol",
          text: "bunu özetle",
          baglam: { paket: "com.android.chrome", ad: "Chrome" },
        } as const;
        const r = await a.o.ekle(govde);
        assert.ok(r.ok);
        await a.o.bosalt();
        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 0, atilan: 0 });
        assert.deepEqual(o.ogeler().map((g) => g.mesaj), [{ ...govde, v: SOHBET_SURUMU, client_msg_id: r.client_msg_id }]);
      });

      it("Dilim 3: ekle kısayol dışı girdide baglam'ı ve geçersiz baglam'ı reddeder (gecersiz), sayaç ilerlemez", async () => {
        const { o } = kur();
        await o.yukle();
        const baglam = { paket: "com.whatsapp", ad: "WhatsApp" };
        assert.deepEqual(await o.ekle({ ...yazi("x"), baglam }), { ok: false, neden: "gecersiz" });
        assert.deepEqual(
          await o.ekle({ type: "user_message", sohbet_id: "ana", input: "kisayol", text: "x", baglam: { paket: "tek", ad: "A" } }),
          { ok: false, neden: "gecersiz" },
        );
        const r = await o.ekle({ type: "user_message", sohbet_id: "ana", input: "kisayol", text: "x" });
        assert.ok(r.ok);
        assert.match(r.client_msg_id, /-1$/);
        assert.equal(o.ogeler().length, 1);
        assert.equal("baglam" in o.ogeler()[0]!.mesaj, false);
      });

      it("karışık v2 kayıtla yüklemeden sonra diske yazılan her kayıt güncel sürümde, sayaç sürer", async () => {
        const depo = new SahteDepo();
        diskeKoy(depo, {
          sayac: 7,
          ogeler: [{ mesaj: { v: 2, type: "user_message", client_msg_id: "abc-7", input: "yazi", text: "eski" }, gecici: false }],
          hatalar: [{ client_msg_id: "abc-6", mesaj: { v: 1, type: "interrupt", client_msg_id: "abc-6" }, kod: "limit_kilitli" }],
        });
        const { o } = kur(depo);
        await o.yukle();
        const r = await o.ekle(yazi("yeni", "s-x"));
        assert.deepEqual(r, { ok: true, client_msg_id: "abc-8" });
        await o.bosalt();
        const kayit = diskKayit(depo);
        assert.equal(kayit.sayac, 8);
        assert.ok(kayit.ogeler.every((g) => g.mesaj.v === SOHBET_SURUMU));
        assert.ok(kayit.hatalar.every((h) => h.mesaj.v === SOHBET_SURUMU));
        assert.deepEqual(kayit.ogeler.map((g) => g.mesaj.client_msg_id), ["abc-7", "abc-8"]);
      });
    });

    describe("geçici türler", () => {
      it("chat_delete seçeneksiz de geçici: kopunca yeniden yollanmaz, baglanti_koptu hatası olur", async () => {
        const { o } = kur();
        await o.yukle();
        const k = kablo();
        o.kimlikTamam(k.gonder);
        const r = await o.ekle({ type: "chat_delete", sohbet_id: "s-q" });
        assert.ok(r.ok);
        assert.equal(k.yollanan.length, 1);
        assert.equal(k.yollanan[0]?.type, "chat_delete");
        o.koptu();
        assert.equal(o.ogeler().length, 0);
        assert.deepEqual(o.hatalar().map((h) => [h.mesaj.type, h.kod]), [["chat_delete", "baglanti_koptu"]]);
        const k2 = kablo();
        o.kimlikTamam(k2.gonder);
        assert.equal(k2.yollanan.length, 0);
      });

      it("chat_clear seçeneksiz de geçici", async () => {
        const { o } = kur();
        await o.yukle();
        const r = await o.ekle({ type: "chat_clear", sohbet_id: "s-q" });
        assert.ok(r.ok);
        o.koptu();
        assert.deepEqual(o.hatalar().map((h) => [h.mesaj.type, h.kod]), [["chat_clear", "baglanti_koptu"]]);
      });

      it("chat_create ve chat_rename geçici değil: çevrimdışı kuyrukta bekler, sırayla yollanır, kopmada kalır", async () => {
        const { o } = kur();
        await o.yukle();
        const id = o.sohbetIdUret();
        await o.ekle({ type: "chat_create", sohbet_id: id, ad: "Yeni" });
        await o.ekle(yazi("selam", id));
        await o.ekle({ type: "chat_rename", sohbet_id: id, ad: "Ad" });
        o.koptu();
        assert.equal(o.hatalar().length, 0);
        const k = kablo();
        o.kimlikTamam(k.gonder);
        assert.deepEqual(k.yollanan.map((m) => m.type), ["chat_create", "user_message", "chat_rename"]);
        o.koptu();
        assert.deepEqual(o.ogeler().map((g) => g.mesaj.type), ["chat_create", "user_message", "chat_rename"]);
        assert.equal(o.hatalar().length, 0);
      });

      it("yüklemede önceki süreçten kalan geçici türler kuyruktan ve hatalardan atılır (atilan)", async () => {
        const depo = new SahteDepo();
        const a = kur(depo);
        await a.o.yukle();
        await a.o.ekle(yazi("kalir"));
        await a.o.ekle({ type: "chat_delete", sohbet_id: "s-q" });
        await a.o.ekle({ type: "chat_clear", sohbet_id: "ana" });
        a.o.koptu(); // iki geçici hatalara düşer ve diske yazılır
        await a.o.ekle({ type: "chat_delete", sohbet_id: "s-w" }); // kuyrukta kalan geçici
        await a.o.bosalt();

        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 0, atilan: 3 });
        assert.deepEqual(o.ogeler().map((g) => g.mesaj.type), ["user_message"]);
        assert.equal(o.hatalar().length, 0);
      });

      it("yüklemede kalan hedefsiz interrupt (gecici bayraklı) baglanti_koptu olur, atılmaz", async () => {
        const depo = new SahteDepo();
        diskeKoy(depo, {
          ogeler: [{ mesaj: { v: SOHBET_SURUMU, type: "interrupt", client_msg_id: "abc-1", sohbet_id: "ana" }, gecici: true }],
        });
        const { o } = kur(depo);
        assert.deepEqual(await o.yukle(), { yukseltilen: 0, atilan: 0 });
        assert.equal(o.ogeler().length, 0);
        assert.deepEqual(o.hatalar().map((h) => h.kod), ["baglanti_koptu"]);
      });
    });

    describe("sohbetIdUret", () => {
      it("yukle öncesi Error atar", () => {
        const { o } = kur();
        assert.throws(() => o.sohbetIdUret(), Error);
      });

      it("s-<donem>-<sayac+1>; sayaç client_msg_id ile paylaşılır; diske yazmaz, degisti çağırmaz", async () => {
        const depo = new SahteDepo();
        diskeKoy(depo, {});
        const { o, degistiSayisi } = kur(depo);
        await o.yukle();
        const once = depo.islemler.length;
        const degisenOnce = degistiSayisi();
        assert.equal(o.sohbetIdUret(), "s-abc-10");
        assert.equal(depo.islemler.length, once);
        assert.equal(degistiSayisi(), degisenOnce);
        const r = await o.ekle(yazi("x"));
        assert.deepEqual(r, { ok: true, client_msg_id: "abc-11" });
        assert.equal(diskKayit(depo).sayac, 11);
      });

      it("art arda üretilen kimlikler farklıdır ve client_msg_id ile çakışmaz", async () => {
        const { o } = kur();
        await o.yukle();
        const a = o.sohbetIdUret();
        const b = o.sohbetIdUret();
        const m = await o.ekle(yazi("x"));
        assert.ok(m.ok);
        assert.notEqual(a, b);
        assert.ok(a.startsWith("s-") && b.startsWith("s-"));
        assert.notEqual(a.slice(2), m.client_msg_id);
        assert.notEqual(b.slice(2), m.client_msg_id);
      });

      it("kimlik chat_create ile yazıldıktan sonra yeniden başlatmada tekrarlanmaz", async () => {
        const depo = new SahteDepo();
        const bir = kur(depo);
        await bir.o.yukle();
        const id = bir.o.sohbetIdUret();
        await bir.o.ekle({ type: "chat_create", sohbet_id: id, ad: "Y" });
        await bir.o.bosalt();
        const iki = kur(depo);
        await iki.o.yukle();
        assert.notEqual(iki.o.sohbetIdUret(), id);
      });
    });

    describe("ack ok almış chat_create", () => {
      it("kuyruktan çıkar ama kaldir'a dek diskte kalır; yeniden yüklemede kuyruğun başında aynı kimlikle yollanır", async () => {
        const depo = new SahteDepo();
        const bir = kur(depo);
        await bir.o.yukle();
        const id = bir.o.sohbetIdUret();
        const a = await bir.o.ekle(yazi("once", "ana"));
        const c = await bir.o.ekle({ type: "chat_create", sohbet_id: id, ad: "Yeni" });
        const m = await bir.o.ekle(yazi("x", id));
        assert.ok(a.ok && c.ok && m.ok);
        bir.o.kimlikTamam(kablo().gonder);
        const s = bir.o.ack(ackCerceve(c.client_msg_id, true, { seq: 5 }));
        assert.ok(s !== null && s.ok === true);
        assert.equal(s.seq, 5);
        assert.equal(s.mesaj.type, "chat_create");
        assert.deepEqual(bir.o.ogeler().map((g) => g.client_msg_id), [a.client_msg_id, m.client_msg_id]);
        // İkinci ack zararsız.
        assert.equal(bir.o.ack(ackCerceve(c.client_msg_id, true, { seq: 5 })), null);
        // Kopup yeniden bağlanınca bu süreçte yeniden yollanmaz.
        bir.o.koptu();
        const k2 = kablo();
        bir.o.kimlikTamam(k2.gonder);
        assert.deepEqual(k2.yollanan.map((x) => (x as { client_msg_id: string }).client_msg_id), [a.client_msg_id, m.client_msg_id]);
        await bir.o.bosalt();
        assert.deepEqual(
          diskKayit(depo).ogeler.map((g) => g.mesaj.client_msg_id),
          [c.client_msg_id, a.client_msg_id, m.client_msg_id],
        );

        // Olayı yazılmadan süreç öldü: yeniden yüklemede chat_create kuyrukta, sohbetinin mesajından önce.
        const iki = kur(depo);
        await iki.o.yukle();
        assert.deepEqual(
          iki.o.ogeler().map((g) => g.client_msg_id),
          [c.client_msg_id, a.client_msg_id, m.client_msg_id],
        );
        const k3 = kablo();
        iki.o.kimlikTamam(k3.gonder);
        assert.equal(k3.yollanan[0]?.type, "chat_create");
        assert.equal((k3.yollanan[0] as { client_msg_id: string } | undefined)?.client_msg_id, c.client_msg_id);
      });

      it("kaldir diskteki kopyayı da kaldırır: görünür listeler değişmez, degisti çağrılmaz, tek yazım", async () => {
        const { o, depo, degistiSayisi } = kur();
        await o.yukle();
        const id = o.sohbetIdUret();
        const c = await o.ekle({ type: "chat_create", sohbet_id: id, ad: "Yeni" });
        const m = await o.ekle(yazi("x", id));
        assert.ok(c.ok && m.ok);
        o.kimlikTamam(kablo().gonder);
        o.ack(ackCerceve(c.client_msg_id, true, { seq: 5 }));
        await o.bosalt();
        const yazim = yazimSayisi(depo);
        const degisen = degistiSayisi();
        assert.equal(await o.kaldir((x) => x.client_msg_id === c.client_msg_id), 1);
        assert.equal(degistiSayisi(), degisen);
        assert.deepEqual(o.ogeler().map((g) => g.client_msg_id), [m.client_msg_id]);
        assert.equal(yazimSayisi(depo), yazim + 1);
        assert.deepEqual(diskKayit(depo).ogeler.map((g) => g.mesaj.client_msg_id), [m.client_msg_id]);
        // Yeniden yüklemede yok.
        const iki = kur(depo);
        await iki.o.yukle();
        assert.deepEqual(iki.o.ogeler().map((g) => g.client_msg_id), [m.client_msg_id]);
      });

      it("ok:false alan chat_create ve ack ok alan öteki türler diskte tutulmaz", async () => {
        const { o, depo } = kur();
        await o.yukle();
        const id = o.sohbetIdUret();
        const c = await o.ekle({ type: "chat_create", sohbet_id: id, ad: "Yeni" });
        const r = await o.ekle({ type: "chat_rename", sohbet_id: "ana", ad: "Ad" });
        const m = await o.ekle(yazi("x", "ana"));
        assert.ok(c.ok && r.ok && m.ok);
        o.kimlikTamam(kablo().gonder);
        o.ack(ackCerceve(c.client_msg_id, false, { code: "sohbet_siniri" }));
        o.ack(ackCerceve(r.client_msg_id, true, { seq: 6 }));
        o.ack(ackCerceve(m.client_msg_id, true, { seq: 7 }));
        await o.bosalt();
        assert.deepEqual(diskKayit(depo).ogeler, []);
        assert.deepEqual(o.hatalar().map((h) => h.client_msg_id), [c.client_msg_id]);
      });
    });

    describe("kaldir", () => {
      const yuklu = async () => {
        const k = kur();
        await k.o.yukle();
        return k;
      };

      it("koşula uyan kuyruk (yollanmış dahil) ve hata öğelerini kaldırır, sayı döner, tek yazım", async () => {
        const { o, depo, degistiSayisi } = await yuklu();
        const a = await o.ekle(yazi("a", "s-1"));
        const b = await o.ekle(yazi("b", "ana"));
        assert.ok(a.ok && b.ok);
        o.kimlikTamam(kablo().gonder); // ikisi de yollanmış
        const c = await o.ekle(yazi("c", "s-1"));
        assert.ok(c.ok);
        o.ack(ackCerceve(c.client_msg_id, false, { code: "limit_kilitli" })); // s-1 hatası
        const d = await o.ekle(yazi("d", "ana"));
        assert.ok(d.ok);
        o.ack(ackCerceve(d.client_msg_id, false, { code: "limit_kilitli" })); // ana hatası
        await o.bosalt();

        const yazimOnce = yazimSayisi(depo);
        const degisenOnce = degistiSayisi();
        const p = o.kaldir((m) => sohbetIdsi(m) === "s-1");
        // Bellekte hemen değişir (await'ten önce), degisti çağrılır.
        assert.deepEqual(o.ogeler().map((g) => g.client_msg_id), [b.client_msg_id]);
        assert.deepEqual(o.hatalar().map((h) => h.client_msg_id), [d.client_msg_id]);
        assert.ok(degistiSayisi() > degisenOnce);
        assert.equal(await p, 2);
        assert.equal(yazimSayisi(depo), yazimOnce + 1);
        assert.deepEqual(diskKayit(depo).ogeler.map((g) => g.mesaj.client_msg_id), [b.client_msg_id]);
      });

      it("kaldırılmış (yollanmış) öğenin geç gelen ack'i null döner", async () => {
        const { o } = await yuklu();
        const r = await o.ekle(yazi("a", "s-1"));
        assert.ok(r.ok);
        o.kimlikTamam(kablo().gonder);
        assert.equal(await o.kaldir(() => true), 1);
        assert.equal(o.ack(ackCerceve(r.client_msg_id, true, { seq: 3 })), null);
        assert.equal(o.hatalar().length, 0);
      });

      it("geçici türlere hiç dokunmaz (koşul her şeye uysa da)", async () => {
        const { o } = await yuklu();
        o.kimlikTamam(kablo().gonder);
        await o.ekle(yazi("a", "s-1"));
        await o.ekle({ type: "chat_delete", sohbet_id: "s-1" });
        await o.ekle({ type: "chat_clear", sohbet_id: "s-1" });
        assert.equal(await o.kaldir(() => true), 1);
        assert.deepEqual(o.ogeler().map((g) => g.mesaj.type), ["chat_delete", "chat_clear"]);
        o.koptu(); // geçiciler hatalara düşer
        assert.deepEqual(o.hatalar().map((h) => h.mesaj.type), ["chat_delete", "chat_clear"]);
        assert.equal(await o.kaldir(() => true), 0);
        assert.equal(o.hatalar().length, 2);
      });

      it("hiçbir şey kalkmazsa yazmadan 0 döner ve degisti çağrılmaz", async () => {
        const { o, depo, degistiSayisi } = await yuklu();
        await o.ekle(yazi("a"));
        await o.bosalt();
        const yazim = depo.islemler.length;
        const degisen = degistiSayisi();
        assert.equal(await o.kaldir(() => false), 0);
        assert.equal(depo.islemler.length, yazim);
        assert.equal(degistiSayisi(), degisen);
        assert.equal(o.ogeler().length, 1);
      });

      it("koşul çağrı anında değerlendirilir (sonradan eklenen etkilenmez)", async () => {
        const { o } = await yuklu();
        await o.ekle(yazi("a", "s-1"));
        const p = o.kaldir((m) => sohbetIdsi(m) === "s-1");
        const sonra = await o.ekle(yazi("b", "s-1"));
        assert.ok(sonra.ok);
        assert.equal(await p, 1);
        assert.deepEqual(o.ogeler().map((g) => g.client_msg_id), [sonra.client_msg_id]);
      });

      it("yazım başarısızsa bellekte kaldırılmış kalır ve söz reddedilir", async () => {
        const { o, depo } = await yuklu();
        const r = await o.ekle(yazi("a", "s-1"));
        assert.ok(r.ok);
        depo.hata.yaz = true;
        const p = o.kaldir(() => true);
        assert.equal(o.ogeler().length, 0);
        await assert.rejects(p);
        assert.equal(o.ogeler().length, 0);
      });

      it("koşul atarsa hiçbir şey değişmez, söz reddedilir ve yazım olmaz", async () => {
        const { o, depo, degistiSayisi } = await yuklu();
        await o.ekle(yazi("a"));
        await o.ekle(yazi("b"));
        const r = await o.ekle(yazi("c"));
        assert.ok(r.ok);
        o.ack(ackCerceve(r.client_msg_id, false)); // hata öğesi de var
        await o.bosalt();
        const yazim = depo.islemler.length;
        const degisen = degistiSayisi();
        let n = 0;
        await assert.rejects(
          o.kaldir(() => {
            if (++n === 2) throw new Error("kosul");
            return true;
          }),
          /kosul/,
        );
        assert.equal(o.ogeler().length, 2);
        assert.equal(o.hatalar().length, 1);
        assert.equal(depo.islemler.length, yazim);
        assert.equal(degistiSayisi(), degisen);
      });

      it("hata listesinde atan koşul da hiçbir şeyi değiştirmez", async () => {
        const { o } = await yuklu();
        await o.ekle(yazi("a"));
        const r = await o.ekle(yazi("b"));
        assert.ok(r.ok);
        o.ack(ackCerceve(r.client_msg_id, false));
        await assert.rejects(
          o.kaldir((m) => {
            if (m.type === "user_message" && m.text === "b") throw new Error("hata-kosul");
            return true;
          }),
        );
        assert.equal(o.ogeler().length, 1);
        assert.equal(o.hatalar().length, 1);
      });
    });
  });
});

// =============================================================================================
// Medya (U2): `hazirlik`, sohbet başına tıkanma, `medyaIdUret`, `hazirlikDegisti`, `bekleyeniKaldir`.
// =============================================================================================

/**
 * `hazirlik` sahtesi: ekli `user_message`'ın kararı ilk ekinin `medya_id`'sinden (kayıt yoksa `"bekliyor"`);
 * eksiz öğe `"hazir"`. `atsin` yalnız ekli mesajda atar.
 */
const medyaKur = (depo = new SahteDepo(), saat = new SahteSaat()) => {
  const durum = new Map<string, MesajHazirligi>();
  const sorulan: string[] = [];
  let atsin = false;
  const o = outboxKur({
    depo,
    saat,
    degisti: () => undefined,
    hazirlik: (m: IsMesaji): MesajHazirligi => {
      sorulan.push(m.client_msg_id);
      if (m.type !== "user_message" || m.ekler === undefined) return "hazir";
      if (atsin) throw new Error("hazirlik");
      return durum.get(m.ekler[0]!.medya_id) ?? "bekliyor";
    },
  });
  return {
    o,
    depo,
    saat,
    durum,
    sorulan,
    atsin: (a: boolean) => {
      atsin = a;
    },
  };
};

const ekli = (text: string, medya_id: string, sohbet_id = "ana"): GidenGovde => ({
  type: "user_message",
  sohbet_id,
  input: "yazi",
  text,
  ekler: [{ medya_id, tur: "foto", mime: "image/jpeg", boyut: 2048 }],
});

/** `kablo`'nun metinleri, öteki türler için `tür:sohbet`. */
const ozet = (yollanan: readonly SohbetYukari[]) =>
  yollanan.map((m) =>
    m.type === "user_message" ? m.text : "sohbet_id" in m ? `${m.type}:${String(m.sohbet_id)}` : m.type,
  );

const kimlik = (r: EkleSonucu): string => {
  assert.ok(r.ok);
  return r.client_msg_id;
};

describe("outbox medya (U2)", () => {
  it("eki hazır olmayan mesaj yalnız kendi sohbetinin sonraki mesajlarını bekletir", async () => {
    const { o, durum } = medyaKur();
    await o.yukle();
    const id1 = o.medyaIdUret();
    await o.ekle(ekli("A-ekli", id1, "s-a"));
    await o.ekle(yazi("A-sonra", "s-a"));
    await o.ekle(yazi("B", "s-b"));
    await o.ekle({ type: "plan_decision", plan_id: "p1", plan_hash: HASH_A, karar: "onay" });
    await o.ekle({ type: "question_answer", soru_id: "q", cevap: "evet" });
    await o.ekle({ type: "job_cancel", is_id: 5 });
    await o.ekle({ type: "interrupt", sohbet_id: "s-a" });
    await o.ekle({ type: "chat_rename", sohbet_id: "s-a", ad: "Yeni ad" });
    await o.ekle(yazi("ana", "ana"));

    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(ozet(k.yollanan), [
      "B",
      "plan_decision",
      "question_answer",
      "job_cancel",
      "interrupt:s-a",
      "chat_rename:s-a",
      "ana",
    ]);
    assert.deepEqual(
      o.ogeler().filter((g) => !g.yollandi).map((g) => (g.mesaj.type === "user_message" ? g.mesaj.text : "")),
      ["A-ekli", "A-sonra"],
    );
    assert.equal(o.sohbetTikaliMi("s-a"), true);
    assert.equal(o.sohbetTikaliMi("s-b"), false);

    durum.set(id1, "hazir");
    o.hazirlikDegisti();
    assert.deepEqual(ozet(k.yollanan).slice(-2), ["A-ekli", "A-sonra"]);
    assert.ok(o.ogeler().every((g) => g.yollandi));
    assert.equal(o.sohbetTikaliMi("s-a"), false);
  });

  it("tıkalı sohbetin sonraki mesajı hazirlik'e sorulmaz; önceki öğe hazırsa sırayla gider", async () => {
    const { o, durum, sorulan } = medyaKur();
    await o.yukle();
    const id1 = o.medyaIdUret();
    const id2 = o.medyaIdUret();
    durum.set(id2, "hazir");
    const a = kimlik(await o.ekle(ekli("bir", id1)));
    const b = kimlik(await o.ekle(ekli("iki", id2)));
    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(k.metinler(), []);
    assert.deepEqual(sorulan, [a]);
    assert.ok(!sorulan.includes(b));
    durum.set(id1, "hazir");
    o.hazirlikDegisti();
    assert.deepEqual(k.metinler(), ["bir", "iki"]);
  });

  it("chat_create → ekli user_message sırası korunur; sohbet kurulmadan mesaj gitmez", async () => {
    const { o, durum } = medyaKur();
    await o.yukle();
    const sohbet = o.sohbetIdUret();
    const id = o.medyaIdUret();
    await o.ekle({ type: "chat_create", sohbet_id: sohbet, ad: "Yeni" });
    await o.ekle(ekli("foto", id, sohbet));
    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(ozet(k.yollanan), [`chat_create:${sohbet}`]);
    durum.set(id, "hazir");
    o.hazirlikDegisti();
    assert.deepEqual(ozet(k.yollanan), [`chat_create:${sohbet}`, "foto"]);
  });

  it("{hata} öğesi hatalara ve diske taşınır, sohbeti tıkamaz, yeniden yüklemede tanınır", async () => {
    const { o, depo, durum } = medyaKur();
    await o.yukle();
    const id1 = o.medyaIdUret();
    durum.set(id1, { hata: "ek_bulunamadi" });
    const a = kimlik(await o.ekle(ekli("kayip", id1)));
    await o.ekle(yazi("sonra"));
    const id2 = o.medyaIdUret();
    durum.set(id2, { hata: "medya_reddedildi" });
    const c = kimlik(await o.ekle(ekli("red", id2, "s-b")));
    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(k.metinler(), ["sonra"]);
    assert.deepEqual(o.hatalar().map((h) => [h.client_msg_id, h.kod]), [
      [a, "ek_bulunamadi"],
      [c, "medya_reddedildi"],
    ]);
    assert.deepEqual(o.ogeler().map((g) => (g.mesaj.type === "user_message" ? g.mesaj.text : "")), ["sonra"]);
    await o.bosalt();

    // Hata yeniden yollanmaz; disk hatayı taşır, yeniden açılışta kod tanınır.
    o.koptu();
    const k2 = kablo();
    o.kimlikTamam(k2.gonder);
    assert.deepEqual(k2.metinler(), ["sonra"]);
    const yeni = medyaKur(depo);
    const ozetY = await yeni.o.yukle();
    assert.equal(ozetY.atilan, 0);
    assert.deepEqual(yeni.o.hatalar().map((h) => [h.client_msg_id, h.kod]), [
      [a, "ek_bulunamadi"],
      [c, "medya_reddedildi"],
    ]);
  });

  it("hazirlikDegisti bağlı değilken bir şey yollamaz, bağlıyken bekleyeni yollar, yollanmışı yinelemez", async () => {
    const { o, durum } = medyaKur();
    await o.yukle();
    const id = o.medyaIdUret();
    await o.ekle(yazi("once"));
    await o.ekle(ekli("ekli", id));
    durum.set(id, "hazir");
    o.hazirlikDegisti(); // hiç bağlanmadı
    assert.ok(o.ogeler().every((g) => !g.yollandi));

    durum.set(id, "bekliyor");
    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(k.metinler(), ["once"]);
    o.hazirlikDegisti(); // değişiklik yok
    assert.deepEqual(k.metinler(), ["once"]);
    durum.set(id, "hazir");
    o.hazirlikDegisti();
    o.hazirlikDegisti();
    assert.deepEqual(k.metinler(), ["once", "ekli"]);

    // Koptuktan sonra çağrı yine bir şey yollamaz.
    o.koptu();
    o.hazirlikDegisti();
    assert.deepEqual(k.metinler(), ["once", "ekli"]);
  });

  it("medyaIdUret client_msg_id ve sohbetIdUret ile aynı sayaçtan; yeniden açılışta yinelenmez", async () => {
    const { o, depo } = medyaKur();
    assert.throws(() => o.medyaIdUret());
    await o.yukle();
    const r1 = kimlik(await o.ekle(yazi("x")));
    const donem = r1.split("-")[0]!;
    const m = o.medyaIdUret();
    const s = o.sohbetIdUret();
    const m2 = o.medyaIdUret();
    const r2 = kimlik(await o.ekle(ekli("y", m)));
    assert.deepEqual([r1, m, s, m2, r2], [`${donem}-1`, `m-${donem}-2`, `s-${donem}-3`, `m-${donem}-4`, `${donem}-5`]);
    await o.bosalt();

    const yeni = medyaKur(depo);
    await yeni.o.yukle();
    assert.equal(yeni.o.medyaIdUret(), `m-${donem}-6`);
  });

  it("hazirlik verilmezse bugünkü davranış: ekli mesaj da hemen gider", async () => {
    const { o } = kur();
    await o.yukle();
    const mo = o as ReturnType<typeof outboxKur>;
    const id = mo.medyaIdUret();
    await o.ekle(ekli("ekli", id));
    await o.ekle(yazi("sonra"));
    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(k.metinler(), ["ekli", "sonra"]);
    assert.equal(mo.sohbetTikaliMi("ana"), false);
  });

  it("hazirlik atarsa öğe kaybolmaz, bekler ve sohbeti tıkar", async () => {
    const { o, atsin } = medyaKur();
    await o.yukle();
    const id = o.medyaIdUret();
    await o.ekle(ekli("ekli", id));
    await o.ekle(yazi("sonra"));
    await o.ekle(yazi("baska", "s-b"));
    atsin(true);
    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(k.metinler(), ["baska"]);
    assert.equal(o.ogeler().length, 3);
    assert.equal(o.hatalar().length, 0);
  });

  describe("tıkalı sohbette geçmiş silme (chat_clear)", () => {
    it("önceki ekli mesajı beklerken kuyrukta kalır, mesajdan sonra gider; başka sohbetinki hemen gider", async () => {
      const { o, durum } = medyaKur();
      await o.yukle();
      const id = o.medyaIdUret();
      await o.ekle(ekli("ekli", id));
      const k = kablo();
      o.kimlikTamam(k.gonder);
      await o.ekle({ type: "chat_clear", sohbet_id: "ana" }, { gecici: true });
      await o.ekle({ type: "chat_clear", sohbet_id: "s-b" }, { gecici: true });
      await o.ekle(yazi("silmeden-sonra"));
      assert.deepEqual(ozet(k.yollanan), ["chat_clear:s-b"]);

      durum.set(id, "hazir");
      o.hazirlikDegisti();
      assert.deepEqual(ozet(k.yollanan), ["chat_clear:s-b", "ekli", "chat_clear:ana", "silmeden-sonra"]);
    });

    it("bekleyen ekli mesaj reddedilirse aynı geçişte silme yürür", async () => {
      const { o, durum } = medyaKur();
      await o.yukle();
      const id = o.medyaIdUret();
      await o.ekle(ekli("ekli", id));
      const k = kablo();
      o.kimlikTamam(k.gonder);
      await o.ekle({ type: "chat_clear", sohbet_id: "ana" }, { gecici: true });
      assert.deepEqual(ozet(k.yollanan), []);
      durum.set(id, { hata: "medya_reddedildi" });
      o.hazirlikDegisti();
      assert.deepEqual(ozet(k.yollanan), ["chat_clear:ana"]);
      assert.deepEqual(o.hatalar().map((h) => h.kod), ["medya_reddedildi"]);
    });

    it("kopmada bekleyen silme her geçici gibi baglanti_koptu olur, ekli mesaj kuyrukta kalır", async () => {
      const { o } = medyaKur();
      await o.yukle();
      const id = o.medyaIdUret();
      await o.ekle(ekli("ekli", id));
      o.kimlikTamam(kablo().gonder);
      const sil = kimlik(await o.ekle({ type: "chat_clear", sohbet_id: "ana" }, { gecici: true }));
      o.koptu();
      assert.deepEqual(o.hatalar().map((h) => [h.client_msg_id, h.kod]), [[sil, "baglanti_koptu"]]);
      assert.deepEqual(o.ogeler().map((g) => g.mesaj.type), ["user_message"]);
    });

    it("tıkalı sohbette chat_delete beklemez", async () => {
      const { o } = medyaKur();
      await o.yukle();
      await o.ekle(ekli("ekli", o.medyaIdUret(), "s-a"));
      const k = kablo();
      o.kimlikTamam(k.gonder);
      await o.ekle({ type: "chat_delete", sohbet_id: "s-a" });
      assert.deepEqual(ozet(k.yollanan), ["chat_delete:s-a"]);
    });
  });

  describe("bekleyeniKaldir", () => {
    it("hiç yollanmamış ekli mesajı kaldırır, diske yazar; arkasındakiler yazımdan sonra yürür", async () => {
      const { o, depo } = medyaKur();
      await o.yukle();
      const a = kimlik(await o.ekle(ekli("ekli", o.medyaIdUret())));
      const k = kablo();
      o.kimlikTamam(k.gonder);
      await o.ekle(yazi("sonra"));
      await o.ekle({ type: "chat_clear", sohbet_id: "ana" }, { gecici: true });
      assert.deepEqual(k.metinler(), []);
      assert.equal(o.sohbetTikaliMi("ana"), true);

      const soz = o.bekleyeniKaldir(a);
      // Bellek hemen değişir; yollama yazımı bekler.
      assert.ok(!o.ogeler().some((g) => g.client_msg_id === a));
      assert.equal(k.yollanan.length, 0);
      const kaldirilan = await soz;
      assert.ok(kaldirilan !== null && kaldirilan.type === "user_message");
      assert.equal(kaldirilan.client_msg_id, a);
      assert.ok(!(depo.kv.get(OUTBOX_ANAHTARI) ?? "").includes(a));
      assert.deepEqual(k.metinler(), ["sonra", "chat_clear"]);
      assert.equal(o.hatalar().length, 0);
      assert.equal(o.sohbetTikaliMi("ana"), false);

      const yeni = medyaKur(depo);
      await yeni.o.yukle();
      assert.ok(!yeni.o.ogeler().some((g) => g.client_msg_id === a));
    });

    it("bağlı değilken de kaldırır", async () => {
      const { o } = medyaKur();
      await o.yukle();
      const a = kimlik(await o.ekle(ekli("ekli", o.medyaIdUret())));
      await o.ekle(yazi("sonra"));
      assert.notEqual(await o.bekleyeniKaldir(a), null);
      const k = kablo();
      o.kimlikTamam(k.gonder);
      assert.deepEqual(k.metinler(), ["sonra"]);
    });

    it("bilinmeyen, user_message olmayan ya da bu süreçte yollanmış öğe için null ve değişiklik yok", async () => {
      const { o } = medyaKur();
      await o.yukle();
      const plan = kimlik(await o.ekle({ type: "plan_decision", plan_id: "p1", plan_hash: HASH_A, karar: "onay" }));
      const yollanan = kimlik(await o.ekle(yazi("gitti")));
      const k = kablo();
      o.kimlikTamam(k.gonder);
      assert.equal(await o.bekleyeniKaldir("yok-1"), null);
      assert.equal(await o.bekleyeniKaldir(plan), null);
      assert.equal(await o.bekleyeniKaldir(yollanan), null);
      // Kopunca `yollandi` sıfırlanır ama servise ulaşmış olabilir: yine kaldırılmaz.
      o.koptu();
      assert.equal(o.ogeler().find((g) => g.client_msg_id === yollanan)?.yollandi, false);
      assert.equal(await o.bekleyeniKaldir(yollanan), null);
      assert.equal(o.ogeler().length, 2);
    });

    it("yazım başarısızsa bellekte kalkmıştır, söz reddedilir, arkasındakiler yine yürür", async () => {
      const { o, depo } = medyaKur();
      await o.yukle();
      const a = kimlik(await o.ekle(ekli("ekli", o.medyaIdUret())));
      await o.ekle(yazi("sonra"));
      const k = kablo();
      o.kimlikTamam(k.gonder);
      depo.hata.yaz = true;
      await assert.rejects(o.bekleyeniKaldir(a));
      assert.ok(!o.ogeler().some((g) => g.client_msg_id === a));
      assert.deepEqual(k.metinler(), ["sonra"]);
    });
  });
});

describe("outbox medya (U2): kaldir", () => {
  it("tıkayan ekli mesaj kaldir ile kalkınca aynı sohbetin arkasındakiler yazımdan sonra yürür", async () => {
    const { o } = medyaKur();
    await o.yukle();
    const a = kimlik(await o.ekle(ekli("ekli", o.medyaIdUret())));
    await o.ekle(yazi("sonra"));
    const k = kablo();
    o.kimlikTamam(k.gonder);
    assert.deepEqual(k.metinler(), []);
    assert.equal(await o.kaldir((m) => m.client_msg_id === a), 1);
    assert.deepEqual(k.metinler(), ["sonra"]);
  });
});
