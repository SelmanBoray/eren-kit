import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEDYA_SINIRLARI } from "@eren/protocol";
import type { EkRedNedeni, GonderRedNedeni } from "../../src/cekirdek/sozlesme.ts";
import {
  EK_KAPALI_METNI,
  EK_SECENEKLERI,
  baytMetni,
  ekIlerlemeMetni,
  ekRedMetni,
  ekSeritiEtiketi,
  medyaGonderRedMetni,
  medyaHataMetni,
  mesajIlerlemeMetni,
  secimHataMetni,
  sureMetni,
} from "../../src/ekranlar/medyaMetni.ts";

const RED: EkRedNedeni[] = [
  "tur_desteklenmiyor",
  "okunamadi",
  "zaten_ekli",
  "video_uzun",
  "cok_buyuk",
  "ikinci_video",
  "adet_asildi",
];

describe("sınırlar", () => {
  it("metindeki sayılar protokol sınırlarıyla uyumlu", () => {
    assert.equal(MEDYA_SINIRLARI.VIDEO_SURE_MS, 5 * 60_000);
    assert.equal(MEDYA_SINIRLARI.VIDEO_BAYT, 250 * 1024 * 1024);
  });
});

describe("baytMetni", () => {
  it("B, KB, MB", () => {
    assert.equal(baytMetni(0), "0 B");
    assert.equal(baytMetni(1023), "1023 B");
    assert.equal(baytMetni(850 * 1024), "850 KB");
    assert.equal(baytMetni(Math.round(3.4 * 1024 * 1024)), "3,4 MB");
    assert.equal(baytMetni(250 * 1024 * 1024), "250 MB");
    assert.equal(baytMetni(1024 * 1024), "1 MB");
  });
  it("KB yuvarlaması MB sınırını taşırsa MB", () => {
    assert.equal(baytMetni(1024 * 1024 - 1), "1 MB");
  });
  it("geçersiz değer 0 B", () => {
    assert.equal(baytMetni(Number.NaN), "0 B");
    assert.equal(baytMetni(-5), "0 B");
  });
});

describe("sureMetni", () => {
  it("m:ss", () => {
    assert.equal(sureMetni(0), "0:00");
    assert.equal(sureMetni(42_000), "0:42");
    assert.equal(sureMetni(245_000), "4:05");
    assert.equal(sureMetni(300_000), "5:00");
    assert.equal(sureMetni(59_999), "0:59");
    assert.equal(sureMetni(Number.NaN), "0:00");
  });
});

describe("ekRedMetni", () => {
  it("her neden için dolu tek cümle", () => {
    for (const n of RED) assert.ok(ekRedMetni(n).length > 5, n);
  });
  it("video sınırları açıkça söylenir", () => {
    assert.equal(ekRedMetni("video_uzun"), "Video 5 dakikadan uzun; en çok 5 dakikalık video eklenebilir.");
    assert.equal(ekRedMetni("cok_buyuk"), "Video 250 MB'tan büyük; eklenemez.");
  });
});

describe("secimHataMetni", () => {
  it("izin ve hata", () => {
    assert.equal(secimHataMetni("izin_yok"), "Kamera izni verilmedi. Galeriden seçebilirsin.");
    assert.ok(secimHataMetni("hata").length > 0);
  });
});

describe("ekIlerlemeMetni", () => {
  it("durumlar", () => {
    assert.equal(ekIlerlemeMetni(null), null);
    assert.equal(ekIlerlemeMetni({ durum: "bekliyor" }), "Sırada");
    assert.equal(ekIlerlemeMetni({ durum: "yukleniyor", alinan: 42, boyut: 100 }), "Yükleniyor %42");
    assert.equal(ekIlerlemeMetni({ durum: "kabul", isleme: "isleniyor" }), "PC'de işleniyor");
    assert.equal(ekIlerlemeMetni({ durum: "kabul", isleme: "hazir" }), null);
    assert.equal(ekIlerlemeMetni({ durum: "kabul", isleme: "kismi" }), null);
    assert.ok(ekIlerlemeMetni({ durum: "kabul", isleme: "hata" }));
    assert.ok(ekIlerlemeMetni({ durum: "kabul", isleme: null }));
    assert.equal(ekIlerlemeMetni({ durum: "yerel_yok" }), "Ek telefonda bulunamadı");
    assert.equal(ekIlerlemeMetni({ durum: "reddedildi", kod: "medya_siniri" }), "PC'de ek sınırı doldu");
  });
  it("yüzde sınırları: aşağı yuvarlanır, 0 ve 100 arası", () => {
    assert.equal(ekIlerlemeMetni({ durum: "yukleniyor", alinan: 0, boyut: 0 }), "Yükleniyor %0");
    assert.equal(ekIlerlemeMetni({ durum: "yukleniyor", alinan: 999, boyut: 1000 }), "Yükleniyor %99");
    assert.equal(ekIlerlemeMetni({ durum: "yukleniyor", alinan: 2000, boyut: 1000 }), "Yükleniyor %100");
  });
  it("ek ile ilgisiz ret kodu genel metin", () => {
    assert.equal(ekIlerlemeMetni({ durum: "reddedildi", kod: "gecersiz" as never }), "PC eki kabul etmedi");
  });
});

describe("mesajIlerlemeMetni", () => {
  it("boş ve hepsi null", () => {
    assert.equal(mesajIlerlemeMetni([]), null);
    assert.equal(mesajIlerlemeMetni([null, null]), null);
  });
  it("bayt ağırlıklı yüzde", () => {
    const r = mesajIlerlemeMetni([
      { durum: "yukleniyor", alinan: 100, boyut: 100 },
      { durum: "yukleniyor", alinan: 0, boyut: 900 },
    ]);
    assert.equal(r, "%10 yüklendi");
  });
  it("ilk hata öncelikli", () => {
    const r = mesajIlerlemeMetni([
      { durum: "yukleniyor", alinan: 1, boyut: 2 },
      { durum: "reddedildi", kod: "medya_reddedildi" },
      { durum: "yerel_yok" },
    ]);
    assert.equal(r, "PC eki kabul etmedi");
  });
  it("sırada ve işleniyor", () => {
    assert.equal(mesajIlerlemeMetni([{ durum: "bekliyor" }, null]), "Sırada");
    assert.equal(mesajIlerlemeMetni([{ durum: "kabul", isleme: "isleniyor" }]), "PC'de işleniyor");
    assert.equal(mesajIlerlemeMetni([{ durum: "kabul", isleme: "hazir" }, null]), null);
  });
});

describe("medyaHataMetni", () => {
  it("medya kodları", () => {
    assert.equal(medyaHataMetni("medya_yok"), "Ek PC'de bulunamadı");
    assert.equal(medyaHataMetni("medya_reddedildi"), "PC eki kabul etmedi");
    assert.equal(medyaHataMetni("medya_siniri"), "PC'de ek sınırı doldu");
    assert.equal(medyaHataMetni("ek_bulunamadi"), "Ek telefonda bulunamadı");
  });
  it("başka kod null", () => {
    assert.equal(medyaHataMetni("baglanti_koptu"), null);
  });
});

describe("medyaGonderRedMetni", () => {
  it("üç yeni neden metinli, eskiler null", () => {
    for (const n of ["medya_desteklenmiyor", "ek_hazirlanamadi", "ek_siniri"] as GonderRedNedeni[]) {
      assert.ok(medyaGonderRedMetni(n), n);
    }
    assert.equal(medyaGonderRedMetni("baslamadi"), null);
    assert.equal(medyaGonderRedMetni("medya_desteklenmiyor"), EK_KAPALI_METNI);
    assert.equal(EK_KAPALI_METNI, "Bu PC servisi ek desteklemiyor; servisi güncelle.");
  });
});

describe("seçenekler ve etiketler", () => {
  it("üç kaynak sırayla", () => {
    assert.deepEqual(
      EK_SECENEKLERI.map((s) => [s.kaynak, s.metin]),
      [
        ["galeri", "Galeriden seç"],
        ["foto_cek", "Fotoğraf çek"],
        ["video_cek", "Video çek"],
      ],
    );
  });
  it("şerit etiketi", () => {
    assert.equal(ekSeritiEtiketi("foto", 1, 2, null), "Fotoğraf 1 / 2");
    assert.equal(ekSeritiEtiketi("video", 2, 2, 42_000), "Video 2 / 2, 0:42");
  });
});
