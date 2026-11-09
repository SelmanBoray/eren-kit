/** Çekirdek ile token tüketim isteğinin (`usage_request` / `usage_report`) bağlantısı. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SOHBET_SURUMU, UsageRequest } from "@eren/protocol";
import type { UsageReport } from "@eren/protocol";
import { cekirdekKur } from "../../src/cekirdek/index.ts";
import type { CekirdekDurumu, TuketimRaporu } from "../../src/cekirdek/sozlesme.ts";
import {
  ack,
  bosalt,
  challenge,
  elSikis,
  olayCercevesi,
  SahteBaglanti,
  SahteDepo,
  SahteKimlik,
  SahteSaat,
  SahteWs,
  welcome,
  yankiOlayi,
} from "./sahte.ts";

const kur = (depo = new SahteDepo(), saat = new SahteSaat()) => {
  const ws = new SahteWs();
  const kimlik = new SahteKimlik();
  const c = cekirdekKur({ ws, kimlik, depo, saat });
  const s = c.sohbet("ana");
  return { ws, kimlik, depo, saat, c, s };
};

type Kurulum = ReturnType<typeof kur>;

const baslat = async (k: Kurulum, head = 0) => {
  await k.c.baslat();
  await bosalt();
  await elSikis(k.ws.son(), head);
};

const istekler = (b: SahteBaglanti) => b.giden().filter((m) => m["type"] === "usage_request");
const tumIstekler = (k: Kurulum) => k.ws.baglantilar.flatMap(istekler);
const sonIstekId = (b: SahteBaglanti): string => {
  const l = istekler(b);
  const son = l[l.length - 1];
  assert.ok(son !== undefined, "usage_request yok");
  return String(son["istek_id"]);
};

const sifir = { girdi: 0, cache_yazma: 0, cache_okuma: 0, cikti: 0, sonuc_adet: 0 };
const ikili = (girdi: number) => ({ sohbet: { ...sifir, girdi }, is: { ...sifir } });

const rapor = (istek_id: string, girdi = 7): UsageReport => ({
  v: SOHBET_SURUMU,
  type: "usage_report",
  istek_id,
  olcum_ms: 5,
  gun_baslangic_ms: 0,
  bugun: ikili(girdi),
  son_7_gun: ikili(girdi),
  sohbetler: [],
  isler: [],
});

const govde = (c: UsageReport): TuketimRaporu => {
  const { v: _v, type: _t, istek_id: _i, ...geri } = c;
  return geri;
};

let isSeq = 100;
const isBittiOlayi = (seq: number, is_id: number) => ({
  seq,
  ts_ms: 1000 + seq,
  type: "job_finished",
  is_id,
  durum: "tamam",
  kirli: false,
});

/** Bağlıyken ilk isteği raporla yanıtlar; rapor alındıktan sonra tazelik penceresini geçirir. */
const ilkiniYanitlaVeBayatlat = async (k: Kurulum) => {
  const b = k.ws.son();
  b.gel(rapor(sonIstekId(b)));
  await bosalt();
  assert.equal(k.c.durum().tuketim.durum, "hazir");
  k.saat.ilerlet(10_001);
  await bosalt();
};

describe("çekirdek: tüketim isteği", () => {
  it("başlangıçta durum yok", async () => {
    const k = kur();
    assert.deepEqual(k.c.durum().tuketim, { durum: "yok" });
    await k.c.baslat();
    await bosalt();
    assert.deepEqual(k.c.durum().tuketim, { durum: "yok" });
  });

  it("kimlik tamamlanınca kendiliğinden tam bir usage_request gider, durum bekleniyor", async () => {
    const k = kur();
    await k.c.baslat();
    await bosalt();
    const b = k.ws.son();
    b.acildi();
    await bosalt();
    b.gel(challenge());
    await bosalt();
    assert.equal(istekler(b).length, 0, "kimlikten önce istek gitmemeli");
    assert.equal(k.c.durum().tuketim.durum, "yok");
    b.gel(welcome(0));
    await bosalt();

    const l = istekler(b);
    assert.equal(l.length, 1);
    const m = l[0]!;
    assert.deepEqual(Object.keys(m).sort(), ["istek_id", "type", "v"]);
    assert.equal(m["v"], SOHBET_SURUMU);
    assert.equal(m["type"], "usage_request");
    assert.equal(typeof m["istek_id"], "string");
    assert.equal("client_msg_id" in m, false);
    assert.equal(UsageRequest.safeParse(m).success, true);
    // Kimlik çerçevelerinden sonra gider.
    const tipler = b.tipler();
    assert.ok(tipler.indexOf("usage_request") > tipler.indexOf("auth_response"));
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
  });

  it("aynı istek_id'li usage_report durumu hazir yapar, gövde eşleşir, dinleyiciye bildirir", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const id = sonIstekId(b);
    const gorulen: CekirdekDurumu[] = [];
    const iptal = k.c.abone((d) => gorulen.push(d));
    const once = gorulen.length;

    const r = rapor(id, 42);
    b.gel(r);
    await bosalt();
    const t = k.c.durum().tuketim;
    assert.equal(t.durum, "hazir");
    assert.ok(t.durum === "hazir");
    assert.deepEqual(t.rapor, govde(r));
    assert.equal("istek_id" in t.rapor, false);
    assert.equal("type" in t.rapor, false);
    assert.equal("v" in t.rapor, false);
    assert.ok(gorulen.length > once, "dinleyiciye bildirim gitmeli");
    assert.equal(gorulen[gorulen.length - 1]?.tuketim.durum, "hazir");
    iptal();
  });

  it("farklı istek_id'li rapor yok sayılır", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const id = sonIstekId(b);
    b.gel(rapor(`${id}-baska`));
    await bosalt();
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
    assert.equal(b.kapatildi, false);
    b.gel(rapor(id));
    await bosalt();
    assert.equal(k.c.durum().tuketim.durum, "hazir");
  });

  it("tuketimIste: bağlı değilken false ve çerçeve yok", async () => {
    const k = kur();
    assert.equal(k.c.tuketimIste(), false);
    await k.c.baslat();
    await bosalt();
    assert.equal(k.c.tuketimIste(), false);
    const b = k.ws.son();
    b.acildi();
    await bosalt();
    b.gel(challenge());
    await bosalt();
    // Kimlik henüz bitmedi: sohbet aşamasında değil.
    assert.equal(k.c.tuketimIste(), false);
    assert.equal(tumIstekler(k).length, 0);
    assert.equal(k.c.durum().tuketim.durum, "yok");
  });

  it("tuketimIste: bekleyen varken false", async () => {
    const k = kur();
    await baslat(k);
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
    assert.equal(k.c.tuketimIste(), false);
    assert.equal(istekler(k.ws.son()).length, 1);
  });

  it("tuketimIste: son rapor 10 sn'den yeniyken false; 10 sn geçince true ve yeni çerçeve", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const ilk = sonIstekId(b);
    b.gel(rapor(ilk));
    await bosalt();
    assert.equal(k.c.tuketimIste(), false);
    k.saat.ilerlet(9_999);
    await bosalt();
    assert.equal(k.c.tuketimIste(), false);
    assert.equal(istekler(b).length, 1);
    k.saat.ilerlet(1);
    await bosalt();
    assert.equal(k.c.tuketimIste(), true);
    assert.equal(istekler(b).length, 2);
    const ikinci = istekler(b)[1]!;
    assert.deepEqual(Object.keys(ikinci).sort(), ["istek_id", "type", "v"]);
    assert.equal(ikinci["v"], SOHBET_SURUMU);
    assert.notEqual(ikinci["istek_id"], ilk);
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
  });

  it("yanıt 15 sn gelmezse durum hata", async () => {
    const k = kur();
    await baslat(k);
    k.saat.ilerlet(14_999);
    await bosalt();
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
    k.saat.ilerlet(1);
    await bosalt();
    assert.equal(k.c.durum().tuketim.durum, "hata");
  });

  it("canlı job_finished'tan 3 sn sonra bir istek gider", async () => {
    const k = kur();
    await baslat(k);
    await ilkiniYanitlaVeBayatlat(k);
    const b = k.ws.son();
    assert.equal(istekler(b).length, 1);

    b.gel(olayCercevesi(isBittiOlayi(1, isSeq++)));
    await bosalt();
    k.saat.ilerlet(2_999);
    await bosalt();
    assert.equal(istekler(b).length, 1, "3 sn dolmadan istek gitmemeli");
    k.saat.ilerlet(1);
    await bosalt();
    assert.equal(istekler(b).length, 2);
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
  });

  it("3 sn içinde gelen birden çok job_finished tek isteğe birleşir", async () => {
    const k = kur();
    await baslat(k);
    await ilkiniYanitlaVeBayatlat(k);
    const b = k.ws.son();

    b.gel(olayCercevesi(isBittiOlayi(1, isSeq++)));
    await bosalt();
    k.saat.ilerlet(1_000);
    await bosalt();
    b.gel(olayCercevesi(isBittiOlayi(2, isSeq++)));
    await bosalt();
    k.saat.ilerlet(1_000);
    await bosalt();
    b.gel(olayCercevesi(isBittiOlayi(3, isSeq++)));
    await bosalt();
    k.saat.ilerlet(5_000);
    await bosalt();
    assert.equal(istekler(b).length, 2, "tam olarak bir ek istek");
    // İstek yanıtlanıp tazelik geçse de birikmiş ikinci bir istek çıkmaz.
    b.gel(rapor(sonIstekId(b)));
    await bosalt();
    k.saat.ilerlet(11_000);
    await bosalt();
    assert.equal(istekler(b).length, 2);
  });

  it("taze rapor varken canlı job_finished'tan 3 sn sonra istek yine gider; tuketimIste ise false döner", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    b.gel(rapor(sonIstekId(b)));
    await bosalt();
    assert.equal(k.c.durum().tuketim.durum, "hazir");
    k.saat.ilerlet(1_000);
    await bosalt();

    b.gel(olayCercevesi(isBittiOlayi(1, isSeq++)));
    await bosalt();
    assert.equal(k.c.tuketimIste(), false, "rapor taze: dışa açık istek reddedilmeli");
    assert.equal(istekler(b).length, 1);
    k.saat.ilerlet(2_999);
    await bosalt();
    assert.equal(istekler(b).length, 1, "3 sn dolmadan istek gitmemeli");
    k.saat.ilerlet(1);
    await bosalt();
    const l = istekler(b);
    assert.equal(l.length, 2, "job_finished isteği tazelik kuralını atlamalı");
    assert.deepEqual(Object.keys(l[1]!).sort(), ["istek_id", "type", "v"]);
    assert.equal(l[1]?.["v"], SOHBET_SURUMU);
    assert.notEqual(l[1]?.["istek_id"], l[0]?.["istek_id"]);
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
  });

  it("job_finished zamanlayıcısı dolduğunda bekleyen istek varsa yeni istek gitmez", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
    b.gel(olayCercevesi(isBittiOlayi(1, isSeq++)));
    await bosalt();
    k.saat.ilerlet(3_000);
    await bosalt();
    assert.equal(istekler(b).length, 1);
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
  });

  it("diskten yeniden kurulan (canlı olmayan) job_finished istek tetiklemez", async () => {
    const depo = new SahteDepo();
    const ilk = kur(depo);
    await baslat(ilk);
    ilk.ws.son().gel(olayCercevesi(isBittiOlayi(1, isSeq++)));
    await bosalt();
    ilk.c.kapat();

    const k = kur(depo);
    await baslat(k, 1);
    const b = k.ws.son();
    assert.equal(istekler(b).length, 1, "yalnız kimlik sonrası istek");
    b.gel(rapor(sonIstekId(b)));
    await bosalt();
    k.saat.ilerlet(11_000);
    await bosalt();
    assert.equal(istekler(b).length, 1);
  });

  it("kopunca bekleyen istek düşer; yeniden bağlanınca kimlik sonrası yeni istek gider, eskisi tekrar gönderilmez", async () => {
    const k = kur();
    await baslat(k);
    const b1 = k.ws.son();
    const eskiId = sonIstekId(b1);
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");

    b1.kopsun();
    await bosalt();
    assert.notEqual(k.c.durum().tuketim.durum, "bekleniyor");
    // Geç gelen eski yanıt hiçbir şeyi değiştirmez.
    b1.gel(rapor(eskiId));
    await bosalt();
    assert.notEqual(k.c.durum().tuketim.durum, "hazir");

    k.saat.ilerlet(1_000);
    await bosalt();
    const b2 = k.ws.son();
    assert.notEqual(b2, b1);
    b2.acildi();
    await bosalt();
    assert.equal(istekler(b2).length, 0, "hello aşamasında istek yok");
    b2.gel(challenge());
    await bosalt();
    assert.equal(istekler(b2).length, 0);
    b2.gel(welcome(0));
    await bosalt();

    const l = istekler(b2);
    assert.equal(l.length, 1);
    assert.notEqual(l[0]?.["istek_id"], eskiId);
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
    b2.gel(rapor(String(l[0]?.["istek_id"])));
    await bosalt();
    assert.equal(k.c.durum().tuketim.durum, "hazir");
  });

  it("kopunca bekleyen 3 sn'lik job_finished zamanlayıcısı ateşlenmez", async () => {
    const k = kur();
    await baslat(k);
    await ilkiniYanitlaVeBayatlat(k);
    const b1 = k.ws.son();
    b1.gel(olayCercevesi(isBittiOlayi(1, isSeq++)));
    await bosalt();
    k.saat.ilerlet(500);
    await bosalt();
    b1.kopsun();
    await bosalt();
    const once = tumIstekler(k).length;
    k.saat.ilerlet(5_000);
    await bosalt();
    assert.equal(tumIstekler(k).length, once, "kopukken istek çıkmamalı");
    assert.equal(k.c.durum().tuketim.durum, "hazir");

    // Yeniden bağlanınca yalnız kimlik sonrası tek istek.
    await elSikis(k.ws.son(), 1);
    assert.equal(istekler(k.ws.son()).length, 1);
    k.ws.son().gel(rapor(sonIstekId(k.ws.son())));
    await bosalt();
    k.saat.ilerlet(11_000);
    await bosalt();
    assert.equal(istekler(k.ws.son()).length, 1);
  });

  it("usage_request kalıcı kuyruğa girmez, depoda izi yoktur", async () => {
    const k = kur();
    await baslat(k);
    assert.equal(istekler(k.ws.son()).length, 1);
    k.c.tuketimIste();
    const izVar = (): boolean => {
      for (const x of k.depo.kv.values()) if (x.includes("usage_request") || x.includes("istek_id")) return true;
      for (const g of k.depo.gunlukler.values()) {
        for (const x of g) if (x.includes("usage_request") || x.includes("istek_id")) return true;
      }
      return k.depo.islemler.some(
        (i) => (i.deger ?? "").includes("usage_request") || (i.satirlar ?? []).some((x) => x.includes("usage_request")),
      );
    };
    assert.equal(izVar(), false);
    k.ws.son().kopsun();
    await bosalt();
    assert.equal(izVar(), false);
    // Aynı depoyla yeni çekirdek: eski istek kuyruktan yeniden yollanmaz.
    k.c.kapat();
    const yeni = kur(k.depo);
    await yeni.c.baslat();
    await bosalt();
    const b = yeni.ws.son();
    b.acildi();
    await bosalt();
    b.gel(challenge());
    await bosalt();
    assert.equal(istekler(b).length, 0);
    b.gel(welcome(0));
    await bosalt();
    assert.equal(istekler(b).length, 1);
    assert.equal(izVar(), false);
  });

  it("olağan akış etkilenmez: kullanıcı mesajı gider ve ack ile teslim edilir", async () => {
    const k = kur();
    await baslat(k);
    const b = k.ws.son();
    const a = await k.s.mesajYolla("merhaba", "yazi");
    assert.ok(a.ok);
    await bosalt();
    const um = b.giden().filter((m) => m["type"] === "user_message");
    assert.deepEqual(
      um.map((m) => m["text"]),
      ["merhaba"],
    );
    assert.equal(um[0]?.["client_msg_id"], a.client_msg_id);
    assert.deepEqual(k.s.durum().bekleyenler.map((x) => x.durum), ["yollandi"]);
    b.gel(ack(a.client_msg_id, true, { seq: 1 }));
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler.map((x) => x.durum), ["teslim_edildi"]);
    b.gel(olayCercevesi(yankiOlayi(1, a.client_msg_id, "merhaba")));
    await bosalt();
    assert.deepEqual(k.s.durum().bekleyenler, []);
    // Tüketim isteği kullanıcı mesajlarının arasına karışmaz, akış bozulmaz.
    assert.equal(k.c.durum().tuketim.durum, "bekleniyor");
    assert.equal(b.kapatildi, false);
  });
});
