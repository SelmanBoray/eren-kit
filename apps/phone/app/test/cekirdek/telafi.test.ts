import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Olay } from "@eren/protocol";
import { TELAFI_ANAHTARLARI, telafiKur } from "../../src/cekirdek/telafi.ts";
import type { KaliciOlay } from "../../src/cekirdek/sozlesme.ts";
import {
  adDegistiOlayi,
  asistanOlayi,
  bosalt,
  mezarTasiOlayi,
  SahteDepo,
  sohbetAcildiOlayi,
  sohbetSilindiOlayi,
  yankiOlayi,
} from "./sahte.ts";

const olay = (ham: Record<string, unknown>): KaliciOlay => Olay.parse(ham);

const kur = (depo = new SahteDepo()) => {
  const uygulanan: number[] = [];
  // Uygulandığı anda depoda ne vardı: "önce depo, sonra last_seq, sonra uygula".
  const depoDurumu: { gunluk: number; sonSeq: string | null }[] = [];
  let bosaldi = 0;
  let yazilamadi = 0;
  const t = telafiKur({
    depo,
    uygulandi: (o) => {
      uygulanan.push(o.seq);
      depoDurumu.push({
        gunluk: depo.gunlukler.get(TELAFI_ANAHTARLARI.olaylar)?.length ?? 0,
        sonSeq: depo.kv.get(TELAFI_ANAHTARLARI.sonSeq) ?? null,
      });
    },
    bosaldi: () => {
      bosaldi++;
    },
    yazilamadi: () => {
      yazilamadi++;
    },
  });
  return { depo, t, uygulanan, depoDurumu, sayac: () => ({ bosaldi, yazilamadi }) };
};

describe("telafi", () => {
  it("olay önce depoya, sonra last_seq, sonra uygulanır", async () => {
    const { depo, t, uygulanan, depoDurumu } = kur();
    t.olay(olay(yankiOlayi(1)));
    await t.bosalt();
    assert.deepEqual(
      depo.islemler.map((i) => `${i.tur}:${i.anahtar}`),
      [`ekle:${TELAFI_ANAHTARLARI.olaylar}`, `yaz:${TELAFI_ANAHTARLARI.sonSeq}`],
    );
    assert.equal(depo.islemler[1]?.deger, "1");
    assert.deepEqual(uygulanan, [1]);
    assert.deepEqual(depoDurumu, [{ gunluk: 1, sonSeq: "1" }]);
    assert.equal(t.sonSeq(), 1);
  });

  it("olay günlüğe yazılamazsa uygulanmaz, last_seq ilerlemez, yazilamadi bildirilir", async () => {
    const { depo, t, uygulanan, sayac } = kur();
    depo.hata.ekle = true;
    t.olay(olay(yankiOlayi(1)));
    await t.bosalt();
    assert.deepEqual(uygulanan, []);
    assert.equal(t.sonSeq(), 0);
    assert.equal(depo.kv.has(TELAFI_ANAHTARLARI.sonSeq), false);
    assert.equal(sayac().yazilamadi, 1);
  });

  it("seq <= last_seq ve yinelenen olay atılır, sıra korunur", async () => {
    const { t, uygulanan, depo } = kur();
    t.olay(olay(yankiOlayi(1)));
    t.olay(olay(yankiOlayi(2)));
    t.olay(olay(yankiOlayi(2)));
    t.olay(olay(yankiOlayi(1)));
    t.olay(olay(yankiOlayi(3)));
    await t.bosalt();
    assert.deepEqual(uygulanan, [1, 2, 3]);
    assert.equal(depo.gunlukler.get(TELAFI_ANAHTARLARI.olaylar)?.length, 3);
    assert.equal(t.sonSeq(), 3);
    // last_seq üstünden gelenler de atılır.
    t.olay(olay(yankiOlayi(2)));
    t.olay(olay(yankiOlayi(3)));
    t.olay(olay(yankiOlayi(4)));
    await t.bosalt();
    assert.deepEqual(uygulanan, [1, 2, 3, 4]);
  });

  it("yukle: günlükten tekrarsız, seq sırasıyla döner; bozuk satır atlanır; last_seq günlükle birleşir", async () => {
    const depo = new SahteDepo();
    const g = TELAFI_ANAHTARLARI.olaylar;
    depo.gunlukler.set(g, [
      JSON.stringify(yankiOlayi(3)),
      JSON.stringify(yankiOlayi(1)),
      "{bozuk",
      JSON.stringify(yankiOlayi(1)),
      JSON.stringify({ seq: 2, type: "bilinmeyen" }),
      JSON.stringify(asistanOlayi(2, "t1", "tam")),
    ]);
    depo.kv.set(TELAFI_ANAHTARLARI.sonSeq, "2");
    const { t } = kur(depo);
    const liste = await t.yukle();
    assert.deepEqual(liste.map((o) => o.seq), [1, 2, 3]);
    // last_seq 2 yazılmıştı ama günlükte 3 var: hello 3 ile gider, 3 yeniden gelmez.
    assert.equal(t.sonSeq(), 3);
  });

  it("yükleme sonrası last_seq geride kalmış olsa da, günlükteki olay yeniden uygulanmaz", async () => {
    const depo = new SahteDepo();
    depo.gunlukler.set(TELAFI_ANAHTARLARI.olaylar, [JSON.stringify(yankiOlayi(1))]);
    const { t, uygulanan } = kur(depo);
    await t.yukle();
    t.olay(olay(yankiOlayi(1)));
    await t.bosalt();
    assert.deepEqual(uygulanan, []);
  });

  it("head_seq < last_seq ise geride döner; sifirla günlüğü ve last_seq'i siler", async () => {
    const { t, depo } = kur();
    for (const s of [1, 2, 3]) t.olay(olay(yankiOlayi(s)));
    await t.bosalt();
    assert.equal(t.welcome(5), "tamam");
    assert.equal(t.welcome(3), "tamam");
    assert.equal(t.welcome(2), "geride");
    await t.sifirla();
    assert.equal(t.sonSeq(), 0);
    assert.equal(depo.gunlukler.has(TELAFI_ANAHTARLARI.olaylar), false);
    assert.equal(depo.kv.has(TELAFI_ANAHTARLARI.sonSeq), false);
    // Sıfırdan başlayan yeni geçmiş kabul edilir.
    t.olay(olay(yankiOlayi(1)));
    await t.bosalt();
    assert.equal(t.sonSeq(), 1);
  });

  it("sıraya alınmış ama yazılmamış olaylar da 'geride' hesabına girer", async () => {
    const { t } = kur();
    t.olay(olay(yankiOlayi(9)));
    assert.equal(t.welcome(4), "geride");
  });

  it("sifirla sırasında bekleyen eski olay yeni geçmişe karışmaz", async () => {
    const { t, uygulanan, depo } = kur();
    t.olay(olay(yankiOlayi(1)));
    t.olay(olay(yankiOlayi(2)));
    const s = t.sifirla();
    await s;
    await t.bosalt();
    assert.equal(t.sonSeq(), 0);
    assert.equal(depo.kv.has(TELAFI_ANAHTARLARI.sonSeq), false);
    assert.equal(depo.gunlukler.has(TELAFI_ANAHTARLARI.olaylar), false);
    assert.equal(uygulanan.includes(2), false);
  });

  it("esitleniyor: head_seq'e ulaşılana dek true; bosaldi toplu bitince çağrılır", async () => {
    const { t, sayac } = kur();
    t.welcome(2);
    assert.equal(t.esitleniyor(), true);
    t.olay(olay(yankiOlayi(1)));
    t.olay(olay(yankiOlayi(2)));
    await t.bosalt();
    assert.equal(t.esitleniyor(), false);
    assert.equal(sayac().bosaldi, 1);
  });

  describe("mezar taşı", () => {
    const G = TELAFI_ANAHTARLARI.olaylar;
    const seqler = (depo: SahteDepo): number[] =>
      (depo.gunlukler.get(G) ?? []).map((m) => (JSON.parse(m) as { seq: number }).seq);

    it("canlı mezar taşından sonra günlükte yalnız mezar taşı ve sonrası kalır, last_seq değişmez", async () => {
      const { t, depo, uygulanan } = kur();
      for (const s of [1, 2, 3]) t.olay(olay(yankiOlayi(s)));
      t.olay(olay(mezarTasiOlayi(4, 3)));
      await t.bosalt();
      assert.deepEqual(seqler(depo), [4]);
      assert.equal(t.sonSeq(), 4);
      assert.equal(depo.kv.get(TELAFI_ANAHTARLARI.sonSeq), "4");
      assert.deepEqual(uygulanan, [1, 2, 3, 4]);
      // Sonraki olaylar mezar taşının arkasına eklenir.
      t.olay(olay(yankiOlayi(5)));
      await t.bosalt();
      assert.deepEqual(seqler(depo), [4, 5]);
      assert.equal(t.sonSeq(), 5);
    });

    it("kırpma satirlariYaz ile yapılır; olay önce günlüğe eklenir", async () => {
      const { t, depo } = kur();
      for (const s of [1, 2]) t.olay(olay(yankiOlayi(s)));
      t.olay(olay(mezarTasiOlayi(3, 2)));
      await t.bosalt();
      const tur = depo.islemler.map((i) => i.tur);
      const ekle = tur.lastIndexOf("ekle");
      const yaz = tur.indexOf("satirlariYaz");
      assert.ok(yaz > ekle, "kırpma mezar taşı eklendikten sonra");
      assert.equal(depo.islemler[yaz]?.anahtar, G);
      assert.equal(depo.islemler[yaz]?.satirlar?.length, 1);
    });

    it("yüklemede günlükteki mezar taşına göre kırpma yapılır", async () => {
      const depo = new SahteDepo();
      depo.gunlukler.set(G, [
        JSON.stringify(yankiOlayi(1)),
        JSON.stringify(yankiOlayi(2)),
        JSON.stringify(yankiOlayi(3)),
        JSON.stringify(mezarTasiOlayi(4, 3)),
        JSON.stringify(yankiOlayi(5)),
      ]);
      depo.kv.set(TELAFI_ANAHTARLARI.sonSeq, "5");
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [4, 5]);
      assert.deepEqual(seqler(depo), [4, 5]);
      assert.equal(t.sonSeq(), 5);
      assert.equal(depo.kv.get(TELAFI_ANAHTARLARI.sonSeq), "5");
    });

    it("iki mezar taşı varsa yalnız en yenisinden sonrası kalır", async () => {
      const depo = new SahteDepo();
      depo.gunlukler.set(G, [
        JSON.stringify(yankiOlayi(1)),
        JSON.stringify(mezarTasiOlayi(2, 1)),
        JSON.stringify(yankiOlayi(3)),
        JSON.stringify(yankiOlayi(4)),
        JSON.stringify(yankiOlayi(5)),
        JSON.stringify(mezarTasiOlayi(6, 5)),
        JSON.stringify(yankiOlayi(7)),
      ]);
      depo.kv.set(TELAFI_ANAHTARLARI.sonSeq, "7");
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [6, 7]);
      assert.deepEqual(seqler(depo), [6, 7]);
      assert.equal(t.sonSeq(), 7);
    });

    it("canlı gelen ikinci mezar taşı da eskisini günlükten atar", async () => {
      const { t, depo } = kur();
      t.olay(olay(yankiOlayi(1)));
      t.olay(olay(mezarTasiOlayi(2, 1)));
      t.olay(olay(yankiOlayi(3)));
      t.olay(olay(mezarTasiOlayi(4, 3)));
      await t.bosalt();
      assert.deepEqual(seqler(depo), [4]);
      assert.equal(t.sonSeq(), 4);
    });

    it("satirlariYaz hata verirse olay yine uygulanır, sonraki yüklemede kırpma yinelenir", async () => {
      const { t, depo, uygulanan } = kur();
      for (const s of [1, 2, 3]) t.olay(olay(yankiOlayi(s)));
      await t.bosalt();
      depo.hata.satirlariYaz = true;
      t.olay(olay(mezarTasiOlayi(4, 3)));
      await t.bosalt();
      assert.deepEqual(uygulanan, [1, 2, 3, 4]);
      assert.equal(t.sonSeq(), 4);
      assert.equal(depo.kv.get(TELAFI_ANAHTARLARI.sonSeq), "4");
      // Atomik başarısızlık: günlük kırpılmamış kaldı.
      assert.deepEqual(seqler(depo), [1, 2, 3, 4]);

      depo.hata.satirlariYaz = false;
      const yeni = kur(depo);
      const liste = await yeni.t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [4]);
      assert.deepEqual(seqler(depo), [4]);
      assert.equal(yeni.t.sonSeq(), 4);
    });

    it("seq <= last_seq olan yinelenen mezar taşı atılır: yeniden uygulanmaz, günlük değişmez", async () => {
      const { t, depo, uygulanan } = kur();
      t.olay(olay(yankiOlayi(1)));
      t.olay(olay(mezarTasiOlayi(2, 1)));
      t.olay(olay(yankiOlayi(3)));
      await t.bosalt();
      const islemSayisi = depo.islemler.length;
      t.olay(olay(mezarTasiOlayi(2, 1)));
      t.olay(olay(mezarTasiOlayi(3, 2)));
      await t.bosalt();
      assert.deepEqual(uygulanan, [1, 2, 3]);
      assert.equal(depo.islemler.length, islemSayisi);
      assert.deepEqual(seqler(depo), [2, 3]);
      assert.equal(t.sonSeq(), 3);
    });
  });

  describe("Dilim 2: çoklu sohbet", () => {
    const G = TELAFI_ANAHTARLARI.olaylar;
    const j = (o: unknown): string => JSON.stringify(o);
    const seqler = (depo: SahteDepo): number[] =>
      (depo.gunlukler.get(G) ?? []).map((m) => (JSON.parse(m) as { seq: number }).seq);
    const kurGunluk = (satirlar: unknown[], sonSeq?: number) => {
      const depo = new SahteDepo();
      depo.gunlukler.set(G, satirlar.map(j));
      if (sonSeq !== undefined) depo.kv.set(TELAFI_ANAHTARLARI.sonSeq, String(sonSeq));
      return depo;
    };
    const yazildi = (depo: SahteDepo): boolean => depo.islemler.some((i) => i.tur === "satirlariYaz");

    it("ana'nın alansız mezar taşı alansız ve açık ana satırlarını kırpar; başka sohbet ve eski chat_renamed{ana} kalır", async () => {
      const depo = kurGunluk([
        adDegistiOlayi(1, "ana", "Ana 2"),
        yankiOlayi(2),
        yankiOlayi(3, "m3", "x", "ana"),
        yankiOlayi(4, "m4", "y", "s-1"),
        mezarTasiOlayi(5, 4),
        yankiOlayi(6),
      ]);
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [1, 4, 5, 6]);
      assert.deepEqual(seqler(depo), [1, 4, 5, 6]);
      assert.equal(t.sonSeq(), 6);
    });

    it("sohbet_id'li mezar taşı yalnız o sohbeti kırpar; ana'nın satırları kalır", async () => {
      const depo = kurGunluk([
        yankiOlayi(1),
        yankiOlayi(2, "m2", "a", "s-1"),
        yankiOlayi(3, "m3", "b", "s-2"),
        mezarTasiOlayi(4, 3, "s-1"),
      ]);
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [1, 3, 4]);
      assert.deepEqual(seqler(depo), [1, 3, 4]);
    });

    it("her sohbetin kendi en yeni mezar taşı vardır; sohbetler birbirini kırpmaz", async () => {
      const depo = kurGunluk([
        yankiOlayi(1, "m1", "a", "s-1"),
        yankiOlayi(2),
        mezarTasiOlayi(3, 2, "s-1"),
        yankiOlayi(4, "m4", "b", "s-1"),
        mezarTasiOlayi(5, 4),
        yankiOlayi(6),
      ]);
      const { t } = kur(depo);
      const liste = await t.yukle();
      // s-1: mezar 3 ve sonrası (3, 4); ana: mezar 5 ve sonrası (5, 6).
      assert.deepEqual(liste.map((o) => o.seq), [3, 4, 5, 6]);
    });

    it("canlı sohbet_id'li mezar taşı yalnız o sohbetin satırlarını günlükten atar", async () => {
      const { t, depo } = kur();
      t.olay(olay(yankiOlayi(1)));
      t.olay(olay(yankiOlayi(2, "m2", "a", "s-1")));
      t.olay(olay(mezarTasiOlayi(3, 2, "s-1")));
      await t.bosalt();
      assert.deepEqual(seqler(depo), [1, 3]);
      assert.equal(t.sonSeq(), 3);
    });

    it("regresyon: sinir_seq'ten eski chat_created ve chat_renamed yüklemede kırpılmaz", async () => {
      const depo = kurGunluk([
        sohbetAcildiOlayi(1, "s-1", "A"),
        adDegistiOlayi(2, "s-1", "B"),
        yankiOlayi(3, "m3", "x", "s-1"),
        mezarTasiOlayi(4, 3, "s-1"),
      ]);
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [1, 2, 4]);
      assert.deepEqual(seqler(depo), [1, 2, 4]);
    });

    it("regresyon: canlı mezar taşı da eski yaşam döngüsü olaylarını silmez", async () => {
      const { t, depo } = kur();
      t.olay(olay(sohbetAcildiOlayi(1, "s-1")));
      t.olay(olay(adDegistiOlayi(2, "s-1", "B")));
      t.olay(olay(yankiOlayi(3, "m3", "x", "s-1")));
      t.olay(olay(mezarTasiOlayi(4, 3, "s-1")));
      await t.bosalt();
      assert.deepEqual(seqler(depo), [1, 2, 4]);
    });

    it("canlı chat_deleted: günlükte o sohbetin yalnız yaşam döngüsü olayları kalır, last_seq aynı", async () => {
      const { t, depo, uygulanan, depoDurumu } = kur();
      t.olay(olay(sohbetAcildiOlayi(1, "s-1")));
      t.olay(olay(yankiOlayi(2, "m2", "a", "s-1")));
      t.olay(olay(yankiOlayi(3)));
      t.olay(olay(adDegistiOlayi(4, "s-1", "B")));
      t.olay(olay(mezarTasiOlayi(5, 4, "s-1")));
      t.olay(olay(yankiOlayi(6, "m6", "b", "s-1")));
      t.olay(olay(sohbetSilindiOlayi(7, "s-1")));
      await t.bosalt();
      assert.deepEqual(seqler(depo), [1, 3, 4, 7]);
      assert.equal(t.sonSeq(), 7);
      assert.equal(depo.kv.get(TELAFI_ANAHTARLARI.sonSeq), "7");
      assert.deepEqual(uygulanan, [1, 2, 3, 4, 5, 6, 7]);
      // uygulandi'da kırpma bitmiş, last_seq yazılmıştı.
      assert.equal(depoDurumu[6]?.sonSeq, "7");
      assert.equal(depoDurumu[6]?.gunluk, 4);
      // chat_deleted önce eklendi, kırpma sonra yazıldı.
      const tur = depo.islemler.map((i) => i.tur);
      assert.ok(tur.lastIndexOf("satirlariYaz") > tur.lastIndexOf("ekle"));
      // Yeniden yüklemede sonuç aynı.
      const yeni = kur(depo);
      const liste = await yeni.t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [1, 3, 4, 7]);
      assert.equal(yeni.t.sonSeq(), 7);
    });

    it("silinmiş sohbete sonradan gelen görünüm olayı yüklemede kırpılır, last_seq korunur", async () => {
      const { t, depo } = kur();
      t.olay(olay(sohbetSilindiOlayi(1, "s-1")));
      t.olay(olay(yankiOlayi(2, "m2", "a", "s-1")));
      await t.bosalt();
      assert.equal(t.sonSeq(), 2);
      const yeni = kur(depo);
      const liste = await yeni.t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [1]);
      assert.deepEqual(seqler(depo), [1]);
      assert.equal(yeni.t.sonSeq(), 2);
    });

    it("yukle: silinmiş sohbetin görünüm olayları (mezar taşı dahil) gider, yaşam döngüsü kalır, last_seq korunur", async () => {
      const depo = kurGunluk([
        sohbetAcildiOlayi(1, "s-1"),
        yankiOlayi(2, "m2", "a", "s-1"),
        yankiOlayi(3),
        mezarTasiOlayi(4, 2, "s-1"),
        asistanOlayi(5, "t1", "yanıt", "s-1"),
        adDegistiOlayi(6, "s-1", "B"),
        sohbetSilindiOlayi(7, "s-1"),
        yankiOlayi(8),
      ]);
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [1, 3, 6, 7, 8]);
      assert.deepEqual(seqler(depo), [1, 3, 6, 7, 8]);
      assert.equal(t.sonSeq(), 8);
    });

    it("yukle: silinmiş sohbetin chat_cleared'ı da gider, başka sohbetinki kalır", async () => {
      const depo = kurGunluk([
        mezarTasiOlayi(1, 0, "s-1"),
        mezarTasiOlayi(2, 0, "s-2"),
        sohbetSilindiOlayi(3, "s-1"),
      ]);
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [2, 3]);
    });

    it("chat_deleted{ana} hiçbir şey silmez (yükleme ve canlı)", async () => {
      const depo = kurGunluk([
        yankiOlayi(1),
        yankiOlayi(2, "m2", "a", "ana"),
        sohbetSilindiOlayi(3, "ana"),
        yankiOlayi(4),
      ]);
      const yukleme = kur(depo);
      const liste = await yukleme.t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [1, 2, 3, 4]);
      assert.equal(yazildi(depo), false);

      const canli = kur();
      canli.t.olay(olay(yankiOlayi(1)));
      canli.t.olay(olay(yankiOlayi(2, "m2", "a", "ana")));
      canli.t.olay(olay(sohbetSilindiOlayi(3, "ana")));
      await canli.t.bosalt();
      assert.deepEqual(seqler(canli.depo), [1, 2, 3]);
      assert.equal(yazildi(canli.depo), false);
      assert.equal(canli.t.sonSeq(), 3);
    });

    it("kırpılacak bir şey yoksa yukle günlüğü yazmaz", async () => {
      const depo = kurGunluk([sohbetAcildiOlayi(1, "s-1"), yankiOlayi(2), yankiOlayi(3, "m3", "a", "s-1")]);
      await kur(depo).t.yukle();
      assert.equal(yazildi(depo), false);
      // Mezar taşı olup satır sayısı değişmiyorsa da yazılmaz.
      const depo2 = kurGunluk([mezarTasiOlayi(1, 0), yankiOlayi(2)]);
      await kur(depo2).t.yukle();
      assert.equal(yazildi(depo2), false);
    });

    it("satirlariYaz hatasında chat_deleted yine uygulanır; sonraki yukle kırpılmış liste döner", async () => {
      const { t, depo, uygulanan } = kur();
      t.olay(olay(sohbetAcildiOlayi(1, "s-1")));
      t.olay(olay(yankiOlayi(2, "m2", "a", "s-1")));
      await t.bosalt();
      depo.hata.satirlariYaz = true;
      t.olay(olay(sohbetSilindiOlayi(3, "s-1")));
      await t.bosalt();
      assert.deepEqual(uygulanan, [1, 2, 3]);
      assert.equal(t.sonSeq(), 3);
      assert.equal(depo.kv.get(TELAFI_ANAHTARLARI.sonSeq), "3");
      assert.deepEqual(seqler(depo), [1, 2, 3]);

      depo.hata.satirlariYaz = false;
      const yeni = kur(depo);
      const liste = await yeni.t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [1, 3]);
      assert.deepEqual(seqler(depo), [1, 3]);
      assert.equal(yeni.t.sonSeq(), 3);
    });

    it("yukle'de satirlariYaz hatası: liste yine kırpılmış döner, günlük kırpılmamış kalır", async () => {
      const depo = kurGunluk([yankiOlayi(1, "m1", "a", "s-1"), sohbetSilindiOlayi(2, "s-1")]);
      depo.hata.satirlariYaz = true;
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [2]);
      assert.deepEqual(seqler(depo), [1, 2]);
      assert.equal(t.sonSeq(), 2);
    });

    it("bozuk satırlar ve seq'siz nesneler kırpmada düşer", async () => {
      const depo = new SahteDepo();
      depo.gunlukler.set(G, [
        "{bozuk",
        j({ type: "chat_created", sohbet_id: "s-1" }),
        j(sohbetAcildiOlayi(2, "s-1")),
        j(mezarTasiOlayi(3, 2)),
      ]);
      const { t } = kur(depo);
      const liste = await t.yukle();
      assert.deepEqual(liste.map((o) => o.seq), [2, 3]);
      assert.deepEqual(seqler(depo), [2, 3]);
    });
  });
});
