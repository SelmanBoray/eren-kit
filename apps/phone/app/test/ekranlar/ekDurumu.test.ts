import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BekleyenOge, EkBilgisi, EkGorunumu, MedyaId } from "../../src/cekirdek/index.ts";
import {
  bekleyenEkleri,
  bekleyenKaldirilabilir,
  ekDugmesi,
  ekGorunumleriEsit,
  ekIlerlemeleri,
  gonderDolu,
  kalanEkHakki,
} from "../../src/ekranlar/ekDurumu.ts";
import type { EkDugmesiGirdisi } from "../../src/ekranlar/ekDurumu.ts";
import {
  EK_BAGLANTI_BEKLENIYOR_METNI,
  EK_DOLU_ETIKETI,
  EK_DUGME_ETIKETI,
  EK_KAPALI_METNI,
  ekRedMetni,
} from "../../src/ekranlar/medyaMetni.ts";
import { v } from "../cekirdek/sahte.ts";

const acikGirdi: EkDugmesiGirdisi = { medyaDestekli: true, bagli: true, yazilamaz: false, seciciVar: true, adet: 0 };

const ek = (medya_id: string, tur: "foto" | "video" = "foto"): EkBilgisi =>
  tur === "video"
    ? { medya_id, tur, mime: "video/mp4", boyut: 1000, sure_ms: 42_000 }
    : { medya_id, tur, mime: "image/jpeg", boyut: 1000 };

const bekleyen = (durum: BekleyenOge["durum"], ekler?: EkBilgisi[]): BekleyenOge => ({
  client_msg_id: "c-1",
  durum,
  mesaj: {
    v,
    type: "user_message",
    client_msg_id: "c-1",
    sohbet_id: "ana",
    text: "",
    input: "yazi",
    ...(ekler !== undefined ? { ekler } : {}),
  } as BekleyenOge["mesaj"],
});

describe("ekDugmesi", () => {
  it("destekli, bağlı, boş şerit: açık", () => {
    assert.deepEqual(ekDugmesi(acikGirdi), { durum: "acik", etiket: EK_DUGME_ETIKETI });
  });
  it("yazılamaz sohbet ya da seçici yok: gizli", () => {
    assert.deepEqual(ekDugmesi({ ...acikGirdi, yazilamaz: true }), { durum: "gizli" });
    assert.deepEqual(ekDugmesi({ ...acikGirdi, seciciVar: false }), { durum: "gizli" });
  });
  it("eski servise bağlı (medyaDestekli false ya da yok): kapalı, neden servis", () => {
    for (const m of [false, undefined]) {
      const d = ekDugmesi({ ...acikGirdi, medyaDestekli: m });
      assert.equal(d.durum, "kapali");
      assert.equal(d.durum === "kapali" && d.neden, EK_KAPALI_METNI);
    }
  });
  it("bağlı değil ve destek bilinmiyor: kapalı, neden bağlantı", () => {
    const d = ekDugmesi({ ...acikGirdi, medyaDestekli: false, bagli: false });
    assert.equal(d.durum === "kapali" && d.neden, EK_BAGLANTI_BEKLENIYOR_METNI);
  });
  it("kopuk ama son welcome destekliydi: açık (çevrimdışı ekli mesaj kuyruğa girebilir)", () => {
    assert.equal(ekDugmesi({ ...acikGirdi, bagli: false }).durum, "acik");
  });
  it("şerit dolu: kapalı, dolu etiketi ve adet nedeni", () => {
    assert.deepEqual(ekDugmesi({ ...acikGirdi, adet: 4 }), {
      durum: "kapali",
      etiket: EK_DOLU_ETIKETI,
      neden: ekRedMetni("adet_asildi"),
    });
    assert.equal(ekDugmesi({ ...acikGirdi, adet: 3 }).durum, "acik");
  });
  it("yalnız === true açar", () => {
    assert.equal(ekDugmesi({ ...acikGirdi, medyaDestekli: "true" as unknown as boolean }).durum, "kapali");
  });
});

describe("kalanEkHakki ve gonderDolu", () => {
  it("kalan hak 4'ten iner, eksiye düşmez", () => {
    assert.equal(kalanEkHakki(0), 4);
    assert.equal(kalanEkHakki(3), 1);
    assert.equal(kalanEkHakki(4), 0);
    assert.equal(kalanEkHakki(7), 0);
  });
  it("metin ya da ek varsa dolu; boşluk metin sayılmaz", () => {
    assert.equal(gonderDolu("", 0), false);
    assert.equal(gonderDolu("   ", 0), false);
    assert.equal(gonderDolu("", 1), true);
    assert.equal(gonderDolu(" a ", 0), true);
  });
});

describe("bekleyen kaldır", () => {
  it("yalnız kuyruktaki ekli user_message", () => {
    assert.equal(bekleyenKaldirilabilir(bekleyen("kuyrukta", [ek("m-1-1")])), true);
    assert.equal(bekleyenKaldirilabilir(bekleyen("yollandi", [ek("m-1-1")])), false);
    assert.equal(bekleyenKaldirilabilir(bekleyen("teslim_edildi", [ek("m-1-1")])), false);
    assert.equal(bekleyenKaldirilabilir(bekleyen("kuyrukta")), false);
  });
  it("user_message olmayan öğede ek yok", () => {
    const b: BekleyenOge = {
      client_msg_id: "c-2",
      durum: "kuyrukta",
      mesaj: { v, type: "interrupt", client_msg_id: "c-2", sohbet_id: "ana" } as BekleyenOge["mesaj"],
    };
    assert.deepEqual(bekleyenEkleri(b), []);
    assert.equal(bekleyenKaldirilabilir(b), false);
  });
});

describe("ekIlerlemeleri ve ekGorunumleriEsit", () => {
  const g1: EkGorunumu = { onizleme_uri: "file:///a.jpg", ilerleme: { durum: "yukleniyor", alinan: 1, boyut: 2 } };
  const g2: EkGorunumu = { onizleme_uri: null, ilerleme: null };
  const ekler = [ek("m-1-1"), ek("m-1-2", "video"), ek("m-1-3")];

  it("sırasıyla, görünümü olmayan null", () => {
    const m = new Map<MedyaId, EkGorunumu>([
      ["m-1-1", g1],
      ["m-1-2", g2],
    ]);
    assert.deepEqual(ekIlerlemeleri(ekler, m), [g1.ilerleme, null, null]);
  });
  it("aynı nesneler eşit, başka ekin değişmesi bu balonu etkilemez", () => {
    const a = new Map<MedyaId, EkGorunumu>([["m-1-1", g1]]);
    const b = new Map<MedyaId, EkGorunumu>([
      ["m-1-1", g1],
      ["m-9-9", g2],
    ]);
    assert.equal(ekGorunumleriEsit([ek("m-1-1")], a, b), true);
    assert.equal(ekGorunumleriEsit([ek("m-1-1")], a, new Map([["m-1-1", { ...g1 }]])), false);
    assert.equal(ekGorunumleriEsit([ek("m-1-1")], a, undefined), false);
  });
  it("eksiz öğe her zaman eşit", () => {
    assert.equal(ekGorunumleriEsit(undefined, new Map(), new Map([["m-1-1", g1]])), true);
    assert.equal(ekGorunumleriEsit([], undefined, new Map()), true);
  });
});
