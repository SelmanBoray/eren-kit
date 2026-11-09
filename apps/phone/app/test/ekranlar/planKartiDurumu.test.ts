import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BekleyenOge, GidenHatasi, GorunumOgesi } from "../../src/cekirdek/index.ts";
import {
  BASLATILIYOR_METNI,
  IZIN_BEKLEME_SURESI_MS,
  isDurumuBul,
  izinBeklemesiKalanMs,
  izinGorulmeleriniKaydet,
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
    assert.equal(yoldakiKarar("p1", bekleyen, [], new Map(), T0), "onay");
    assert.equal(yoldakiKarar("p2", bekleyen, [], new Map(), T0), null);
    const izin: GidenHatasi[] = [{ client_msg_id: "c-p2", mesaj: karar("p2", "onay"), kod: "izin_bekleniyor" }];
    assert.equal(yoldakiKarar("p2", [], izin, new Map(), T0), "onay");
    const baska: GidenHatasi[] = [{ client_msg_id: "c-p3", mesaj: karar("p3", "ret"), kod: "limit_kilitli" }];
    assert.equal(yoldakiKarar("p3", [], baska, new Map(), T0), null);
  });
});

const T0 = 1_000_000;

describe("izin_bekleniyor kaydı süresiz 'yoldaki onay' sayılmaz", () => {
  const izin: GidenHatasi[] = [{ client_msg_id: "c-p", mesaj: karar("p", "onay"), kod: "izin_bekleniyor" }];

  it("süre içinde: Başlatılıyor, düğmesiz (çift karar koruması)", () => {
    const gorulme = new Map([["c-p", T0]]);
    const k = yoldakiKarar("p", [], izin, gorulme, T0 + IZIN_BEKLEME_SURESI_MS - 1);
    assert.equal(k, "onay");
    const d = planKartiDurumu("bekliyor", null, k, false);
    assert.equal(d.metin, BASLATILIYOR_METNI);
    assert.equal(d.onayBekleniyor, false);
  });

  it("izin gelmeden süre dolunca: kart yeniden 'Onayını bekliyor' ve düğmeler", () => {
    const gorulme = new Map([["c-p", T0]]);
    const k = yoldakiKarar("p", [], izin, gorulme, T0 + IZIN_BEKLEME_SURESI_MS);
    assert.equal(k, null);
    assert.deepEqual(planKartiDurumu("bekliyor", null, k, false), {
      metin: ONAY_BEKLENIYOR_METNI,
      renk: "vurgu",
      onayBekleniyor: true,
    });
  });

  it("saat geri giderse süre dolmuş sayılır (sınırsız bekleme yok)", () => {
    const gorulme = new Map([["c-p", T0]]);
    assert.equal(yoldakiKarar("p", [], izin, gorulme, T0 - 1), null);
  });

  it("süre dolduktan sonra verilen yeni karar kuyruktayken yine düğmeler gizli; o da izin beklerse kendi süresi işler", () => {
    const yeni = { ...karar("p", "onay"), client_msg_id: "c-p-2" };
    const kuyruk: BekleyenOge[] = [{ client_msg_id: "c-p-2", mesaj: yeni, durum: "kuyrukta" }];
    const gorulme = new Map([["c-p", T0]]);
    const sonra = T0 + IZIN_BEKLEME_SURESI_MS + 5;
    assert.equal(yoldakiKarar("p", kuyruk, izin, gorulme, sonra), "onay");
    const ikiIzin: GidenHatasi[] = [...izin, { client_msg_id: "c-p-2", mesaj: yeni, kod: "izin_bekleniyor" }];
    gorulme.set("c-p-2", sonra);
    assert.equal(yoldakiKarar("p", [], ikiIzin, gorulme, sonra + 1), "onay");
    assert.equal(yoldakiKarar("p", [], ikiIzin, gorulme, sonra + IZIN_BEKLEME_SURESI_MS), null);
  });

  it("ilk görülme zamanı kaydedilir, varolan değiştirilmez; kalan süre hesaplanır", () => {
    const gorulme = new Map<string, number>();
    izinGorulmeleriniKaydet("p", izin, gorulme, T0);
    izinGorulmeleriniKaydet("p", izin, gorulme, T0 + 500);
    assert.equal(gorulme.get("c-p"), T0);
    assert.equal(izinBeklemesiKalanMs("p", izin, gorulme, T0 + 500), IZIN_BEKLEME_SURESI_MS - 500);
    assert.equal(izinBeklemesiKalanMs("p", izin, gorulme, T0 + IZIN_BEKLEME_SURESI_MS), null);
    assert.equal(izinBeklemesiKalanMs("p", [], gorulme, T0), null);
  });
});
