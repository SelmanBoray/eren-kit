import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BekleyenOge, GidenHatasi, GorunumOgesi } from "../../src/cekirdek/index.ts";
import {
  BASLATILIYOR_METNI,
  isDurumuBul,
  ONAY_BEKLENIYOR_METNI,
  planKartiDurumu,
  yoldakiKarar,
} from "../../src/ekranlar/planKartiDurumu.ts";
import type { PlanKartiDurumu } from "../../src/ekranlar/planKartiDurumu.ts";
import { HASH_A, v } from "../cekirdek/sahte.ts";

const karar = (plan_id: string, k: "onay" | "ret") =>
  ({ v, type: "plan_decision", client_msg_id: `c-${plan_id}`, plan_id, plan_hash: HASH_A, karar: k }) as const;

/** Onay dili yalnız gerçekten karar beklenirken. */
const onaySoylemi = (d: PlanKartiDurumu): boolean => /onay/i.test(d.metin);

describe("planKartiDurumu: onay dili yalnız gerçekten onay beklenirken", () => {
  it("onaysız başlayan iş (onaylandi) iş durumunu gösterir, onay demez", () => {
    const durumlar = [null, "suruyor", "tamam", "hata", "yarim", "limit_durdu", "iptal"] as const;
    const metinler = durumlar.map((i) => planKartiDurumu("onaylandi", i, null, false));
    assert.deepEqual(
      metinler.map((d) => d.metin),
      ["Başladı", "Çalışıyor", "Bitti", "Hatayla bitti", "Yarım kaldı", "Limitte durdu", "İptal edildi"],
    );
    for (const d of metinler) {
      assert.equal(d.onayBekleniyor, false);
      assert.equal(onaySoylemi(d), false);
    }
  });

  it("bekleyen kart: otomatik deneme ya da yoldaki onay 'Başlatılıyor'; ret yoldaysa 'Reddediliyor'", () => {
    assert.deepEqual(planKartiDurumu("bekliyor", null, null, true), {
      metin: BASLATILIYOR_METNI,
      renk: "bilgi",
      onayBekleniyor: false,
    });
    assert.equal(planKartiDurumu("bekliyor", null, "onay", false).metin, BASLATILIYOR_METNI);
    const ret = planKartiDurumu("bekliyor", null, "ret", false);
    assert.equal(ret.metin, "Reddediliyor");
    assert.equal(ret.onayBekleniyor, false);
  });

  it("karar yolda değil, deneme yok: onay bekleniyor (düğmeler ve vurgu)", () => {
    assert.deepEqual(planKartiDurumu("bekliyor", null, null, false), {
      metin: ONAY_BEKLENIYOR_METNI,
      renk: "vurgu",
      onayBekleniyor: true,
    });
  });

  it("reddedildi ve iptal onay beklemez", () => {
    assert.equal(planKartiDurumu("reddedildi", null, null, false).onayBekleniyor, false);
    assert.equal(planKartiDurumu("iptal", null, null, false).metin, "İptal edildi");
  });
});

describe("isDurumuBul ve yoldakiKarar", () => {
  it("is_id'nin iş kartı durumu; is_id yoksa ya da iş görünmüyorsa null", () => {
    const ogeler = [
      { tur: "is", seq: 2, ts_ms: 1, is_id: 7, plan_id: "p", plan_hash: HASH_A, baslik: "x", is_turu: "pc", durum: "tamam" },
    ] as GorunumOgesi[];
    assert.equal(isDurumuBul(ogeler, 7), "tamam");
    assert.equal(isDurumuBul(ogeler, 8), null);
    assert.equal(isDurumuBul(ogeler, null), null);
  });

  it("kuyruktaki karar ve izin_bekleniyor hatası sayılır; başka hata ve başka plan sayılmaz", () => {
    const bekleyen: BekleyenOge[] = [{ client_msg_id: "c-p1", mesaj: karar("p1", "onay"), durum: "kuyrukta" }];
    assert.equal(yoldakiKarar("p1", bekleyen, []), "onay");
    assert.equal(yoldakiKarar("p2", bekleyen, []), null);
    const izin: GidenHatasi[] = [{ client_msg_id: "c-p2", mesaj: karar("p2", "onay"), kod: "izin_bekleniyor" }];
    assert.equal(yoldakiKarar("p2", [], izin), "onay");
    const baska: GidenHatasi[] = [{ client_msg_id: "c-p3", mesaj: karar("p3", "ret"), kod: "limit_kilitli" }];
    assert.equal(yoldakiKarar("p3", [], baska), null);
  });
});
