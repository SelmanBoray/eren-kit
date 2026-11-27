import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EkBilgisi, MEDYA_SINIRLARI, MediaState, type MedyaId, type SohbetId } from "@eren/protocol";
import { ekleriDenetle, ONIZLEME_ANAHTARI, YUKLEME_ANAHTARI, yukleyiciKur } from "../../src/cekirdek/medya.ts";
import type { MedyaYukari, SeciliEk, YeniYukleme } from "../../src/cekirdek/sozlesme.ts";
import {
  bosalt,
  ekBilgisi,
  hamFoto,
  hamVideo,
  icerik,
  mediaState,
  SahteDepo,
  SahteMedyaDosya,
  seciliFoto,
  seciliVideo,
  videoBilgisi,
} from "./sahte.ts";

const P = MEDYA_SINIRLARI.PARCA_BAYT;
const id = (s: string) => s as MedyaId;

// =============================================================================================
// ekleriDenetle
// =============================================================================================

describe("ekleriDenetle", () => {
  it("geçerli öğeleri sırayla ekler, mevcudu aynen korur, fotoğrafın sure_ms'ini null yapar", () => {
    const mevcut = [seciliFoto({ uri: "content://a" })];
    const sonuc = ekleriDenetle(mevcut, [
      hamFoto({ uri: "content://b", sure_ms: 1234 }),
      hamVideo({ uri: "content://c" }),
    ]);
    assert.deepEqual(sonuc.reddedilenler, []);
    assert.equal(sonuc.ekler.length, 3);
    assert.equal(sonuc.ekler[0], mevcut[0]);
    assert.deepEqual(sonuc.ekler[1], seciliFoto({ uri: "content://b" }));
    assert.deepEqual(sonuc.ekler[2], seciliVideo({ uri: "content://c" }));
    assert.equal(mevcut.length, 1, "girdi değişmez");
  });

  it("her ret nedeni", () => {
    const durumlar: [string, SeciliEk[], ReturnType<typeof hamFoto>, string][] = [
      ["tur yok", [], hamFoto({ tur: null }), "tur_desteklenmiyor"],
      ["mime yok", [], hamFoto({ mime: null }), "tur_desteklenmiyor"],
      ["mime başka türün", [], hamFoto({ mime: "video/mp4" }), "tur_desteklenmiyor"],
      ["bilinmeyen mime", [], hamVideo({ mime: "video/x-matroska" }), "tur_desteklenmiyor"],
      ["boyut yok", [], hamFoto({ boyut: null }), "okunamadi"],
      ["boyut 0", [], hamFoto({ boyut: 0 }), "okunamadi"],
      ["aynı uri", [seciliFoto()], hamFoto(), "zaten_ekli"],
      ["uzun video", [], hamVideo({ sure_ms: MEDYA_SINIRLARI.VIDEO_SURE_MS + 1 }), "video_uzun"],
      ["büyük video", [], hamVideo({ boyut: MEDYA_SINIRLARI.VIDEO_BAYT + 1 }), "cok_buyuk"],
      ["ikinci video", [seciliVideo({ uri: "content://v0" })], hamVideo(), "ikinci_video"],
      [
        "adet",
        [1, 2, 3, 4].map((i) => seciliFoto({ uri: `content://f${i}` })),
        hamFoto(),
        "adet_asildi",
      ],
    ];
    for (const [ad, mevcut, ham, neden] of durumlar) {
      const s = ekleriDenetle(mevcut, [ham]);
      assert.deepEqual(s.reddedilenler, [{ uri: ham.uri, neden }], ad);
      assert.deepEqual(s.ekler, mevcut, ad);
    }
  });

  it("sınır değerleri geçer: tam 5 dk, tam 250 MiB, süresi bilinmeyen video, büyük fotoğraf", () => {
    const s = ekleriDenetle(
      [],
      [
        hamVideo({ sure_ms: MEDYA_SINIRLARI.VIDEO_SURE_MS, boyut: MEDYA_SINIRLARI.VIDEO_BAYT }),
        hamFoto({ boyut: MEDYA_SINIRLARI.FOTO_BAYT * 3 }),
      ],
    );
    assert.deepEqual(s.reddedilenler, []);
    const s2 = ekleriDenetle([], [hamVideo({ sure_ms: null })]);
    assert.deepEqual(s2.reddedilenler, []);
    assert.equal(s2.ekler[0]?.sure_ms, null);
  });

  it("kural sırası: ilk tutmayan kural reddeder", () => {
    const tamSerit = [
      seciliVideo({ uri: "content://v0" }),
      ...[1, 2, 3].map((i) => seciliFoto({ uri: `content://f${i}` })),
    ];
    const ilk = (mevcut: SeciliEk[], ham: ReturnType<typeof hamFoto>) => ekleriDenetle(mevcut, [ham]).reddedilenler[0]?.neden;
    // tur > okunamadi
    assert.equal(ilk([], hamFoto({ mime: null, boyut: null })), "tur_desteklenmiyor");
    // okunamadi > zaten_ekli
    assert.equal(ilk([seciliFoto()], hamFoto({ boyut: 0 })), "okunamadi");
    // zaten_ekli > video_uzun
    assert.equal(ilk([seciliVideo()], hamVideo({ sure_ms: 999_999 })), "zaten_ekli");
    // video_uzun > cok_buyuk
    assert.equal(ilk([], hamVideo({ sure_ms: 999_999, boyut: MEDYA_SINIRLARI.VIDEO_BAYT + 1 })), "video_uzun");
    // cok_buyuk > ikinci_video
    assert.equal(ilk(tamSerit, hamVideo({ boyut: MEDYA_SINIRLARI.VIDEO_BAYT + 1 })), "cok_buyuk");
    // ikinci_video > adet_asildi
    assert.equal(ilk(tamSerit, hamVideo()), "ikinci_video");
  });

  it("kabul edilen öğe sonraki öğelerin denetimine girer", () => {
    const s = ekleriDenetle(
      [],
      [
        hamVideo({ uri: "content://v1" }),
        hamVideo({ uri: "content://v2" }),
        hamFoto({ uri: "content://f1" }),
        hamFoto({ uri: "content://f1" }),
        hamFoto({ uri: "content://f2" }),
        hamFoto({ uri: "content://f3" }),
        hamFoto({ uri: "content://f4" }),
      ],
    );
    assert.deepEqual(
      s.ekler.map((e) => e.uri),
      ["content://v1", "content://f1", "content://f2", "content://f3"],
    );
    assert.deepEqual(s.reddedilenler, [
      { uri: "content://v2", neden: "ikinci_video" },
      { uri: "content://f1", neden: "zaten_ekli" },
      { uri: "content://f4", neden: "adet_asildi" },
    ]);
  });

  it("reddedilen öğe sonrakini etkilemez", () => {
    const s = ekleriDenetle([], [hamVideo({ uri: "content://v1", boyut: 0 }), hamVideo({ uri: "content://v2" })]);
    assert.deepEqual(
      s.ekler.map((e) => e.uri),
      ["content://v2"],
    );
  });
});

// =============================================================================================
// Yükleyici
// =============================================================================================

type Giden = Record<string, unknown> & { type: string };

const kur = () => {
  const depo = new SahteDepo();
  const dosya = new SahteMedyaDosya();
  const t = {
    depo,
    dosya,
    degisim: 0,
    giden: [] as Giden[],
    /** `false` ise `gonder` yazamaz. */
    acik: true,
    gonderCagrisi: 0,
    y: null as unknown as ReturnType<typeof yukleyiciKur>,
    bagla() {
      t.y.baglandi((m: MedyaYukari) => {
        t.gonderCagrisi++;
        if (!t.acik) return false;
        t.giden.push(JSON.parse(JSON.stringify(m)) as Giden);
        return true;
      });
    },
    durum(medya_id: string, durum: "yukleniyor" | "kabul" | "reddedildi", extra: Record<string, unknown> = {}) {
      t.y.durum(MediaState.parse(mediaState(medya_id, durum, extra)));
    },
    tipler: () => t.giden.map((m) => m.type),
    parcalar: () => t.giden.filter((m) => m.type === "media_chunk") as (Giden & { medya_id: string; ofset: number; veri: string })[],
    temizle() {
      t.giden.length = 0;
    },
  };
  t.y = yukleyiciKur({ depo, dosya, degisti: () => t.degisim++ });
  return t;
};

/** Dosyayı sahteye koyar ve `YeniYukleme` kurar. */
const yeni = (
  t: ReturnType<typeof kur>,
  medya_id: string,
  o: { tur?: "foto" | "video"; boyut?: number; sohbet?: string; kapak?: boolean } = {},
): YeniYukleme => {
  const tur = o.tur ?? "foto";
  const boyut = o.boyut ?? 1000;
  const uri = `file:///eren-medya/${medya_id}.${tur === "foto" ? "jpg" : "mp4"}`;
  t.dosya.dosyalar.set(uri, icerik(boyut, boyut));
  let onizleme_uri: string | null = tur === "foto" ? uri : null;
  if (tur === "video" && o.kapak !== false) {
    onizleme_uri = `file:///eren-medya/${medya_id}.kapak.jpg`;
    t.dosya.dosyalar.set(onizleme_uri, icerik(16));
  }
  const ham = tur === "foto" ? ekBilgisi(medya_id, { boyut }) : videoBilgisi(medya_id, { boyut });
  return { sohbet_id: (o.sohbet ?? "ana") as SohbetId, bilgi: EkBilgisi.parse(ham), uri, onizleme_uri };
};

/**
 * Doğru servis: `media_chunk`'ları sırayla işler (yalnız `ofset == alinan` yazılır), her parçaya bir
 * `media_state` döner; `alinan == boyut` olunca `kabul`. Yazılan baytları biriktirir.
 */
const servis = (t: ReturnType<typeof kur>, boyutlar: Record<string, number>) => {
  const alinan: Record<string, number> = {};
  const yazilan: Record<string, Buffer[]> = {};
  let islenen = 0;
  return {
    alinan,
    yazilan: (m: string) => Buffer.concat(yazilan[m] ?? []),
    /** Bekleyen bütün giden çerçeveleri yanıtlar (`media_begin` dahil). */
    async yanitla(sinir = Infinity) {
      let n = 0;
      while (islenen < t.giden.length && n < sinir) {
        const m = t.giden[islenen++]!;
        n++;
        const mid = String(m["medya_id"]);
        const boyut = boyutlar[mid]!;
        if (m.type === "media_begin") {
          alinan[mid] ??= 0;
        } else if (m.type === "media_chunk") {
          const b = Buffer.from(String(m["veri"]), "base64");
          if (m["ofset"] === alinan[mid]) {
            (yazilan[mid] ??= []).push(b);
            alinan[mid] += b.length;
          }
        } else continue;
        if (alinan[mid] === boyut) t.durum(mid, "kabul");
        else t.durum(mid, "yukleniyor", { alinan: alinan[mid] });
        await bosalt();
      }
    },
  };
};

describe("yükleyici: gönderim", () => {
  it("baglandi çağrılmadıkça hiçbir şey yollanmaz", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 2 * P })]);
    await bosalt();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.equal(t.gonderCagrisi, 0);
    assert.deepEqual(t.y.hazirlik([id("m-1-1")]), "bekliyor");
  });

  it("baglandi: media_begin kayıt bilgisiyle; ekle sonrası bağlıysa hemen begin", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { tur: "video", boyut: 500 })]);
    t.bagla();
    assert.deepEqual(t.giden, [
      {
        v: 5,
        type: "media_begin",
        sohbet_id: "ana",
        medya_id: "m-1-1",
        tur: "video",
        mime: "video/mp4",
        boyut: 500,
        sure_ms: 20_000,
      },
    ]);
    await t.y.ekle([yeni(t, "m-1-2", { sohbet: "s-2" })]);
    assert.deepEqual(t.tipler(), ["media_begin", "media_begin"]);
    assert.equal(t.giden[1]!["sohbet_id"], "s-2");
  });

  it("pencere: iki yanıtsız parçadan sonra üçüncüsü yollanmaz; her yanıt bir parça açar", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 4 * P + 10 })]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => p.ofset),
      [0, P],
    );
    await bosalt();
    assert.equal(t.parcalar().length, 2, "yanıtsız üçüncü parça yok");
    t.durum("m-1-1", "yukleniyor", { alinan: P });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => p.ofset),
      [0, P, 2 * P],
    );
    assert.deepEqual(t.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "yukleniyor", alinan: P, boyut: 4 * P + 10 });
  });

  it("uçtan uca: parçalar dosyanın baytlarıdır, son parça kısa, kabul → hazir", async () => {
    const t = kur();
    const boyut = 3 * P + 1234;
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { tur: "video", boyut })]);
    t.bagla();
    const s = servis(t, { "m-1-1": boyut });
    for (let i = 0; i < 10; i++) await s.yanitla();
    assert.deepEqual(s.yazilan("m-1-1"), Buffer.from(icerik(boyut, boyut)));
    for (const p of t.parcalar()) assert.ok(Buffer.from(p.veri, "base64").length <= P);
    assert.deepEqual(
      t.parcalar().map((p) => p.ofset),
      [0, P, 2 * P, 3 * P],
    );
    assert.deepEqual(t.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "kabul", isleme: null });
    assert.equal(t.y.hazirlik([id("m-1-1")]), "hazir");
    // Okumalar parça sınırında.
    assert.deepEqual(
      t.dosya.okumalar.map((o) => [o.ofset, o.uzunluk]),
      [
        [0, P],
        [P, P],
        [2 * P, P],
        [3 * P, 1234],
      ],
    );
  });

  it("aynı anda tek ek, ekle sırasıyla", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 2 * P }), yeni(t, "m-1-2", { boyut: 100 })]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    t.durum("m-1-2", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => p.medya_id),
      ["m-1-1", "m-1-1"],
    );
    t.durum("m-1-1", "yukleniyor", { alinan: P });
    await bosalt();
    assert.equal(t.parcalar().length, 2, "ilk ek bitmeden ikincisine geçilmez");
    t.durum("m-1-1", "kabul");
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => [p.medya_id, p.ofset]),
      [
        ["m-1-1", 0],
        ["m-1-1", P],
        ["m-1-2", 0],
      ],
    );
    assert.equal(t.y.hazirlik([id("m-1-1"), id("m-1-2")]), "bekliyor");
    t.durum("m-1-2", "kabul", { isleme: "isleniyor" });
    assert.equal(t.y.hazirlik([id("m-1-1"), id("m-1-2")]), "hazir");
  });

  it("alinan beklenenden farklı: yanıtsız parçalar unutulur, alinan'dan sürülür, pencere aşılmaz", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 6 * P })]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 2 * P });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => p.ofset),
      [2 * P, 3 * P],
    );
    t.temizle();
    // Servis yarım dosyayı sildi: ilk parçaya `alinan: 0` döner.
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => p.ofset),
      [0],
      "eski 3P parçası hâlâ yanıtsız: yalnız bir yeni parça",
    );
    // Eski 3P parçasının yanıtı (servis yazmadı, alinan 0'da).
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => p.ofset),
      [0, P],
    );
    t.durum("m-1-1", "yukleniyor", { alinan: P });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => p.ofset),
      [0, P, 2 * P],
    );
  });

  it("servisle uyuşmazlıktan sonra uçtan uca doğru bayt dizisi", async () => {
    const t = kur();
    const boyut = 5 * P + 7;
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut })]);
    t.bagla();
    const s = servis(t, { "m-1-1": boyut });
    await s.yanitla(1); // begin → 0
    await s.yanitla(1); // parça 0 → P
    // Servis yeniden başladı ve yarım dosyayı sildi.
    s.alinan["m-1-1"] = 0;
    for (let i = 0; i < 20; i++) await s.yanitla();
    assert.deepEqual(t.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "kabul", isleme: null });
    assert.ok(t.parcalar().length > 6);
  });
});

describe("yükleyici: kopma ve yeniden bağlanma", () => {
  it("kopunca durur, yeniden bağlanınca begin ve servisin alinan'ından sürer", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 4 * P })]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    await bosalt();
    t.y.koptu();
    assert.deepEqual(t.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "bekliyor" });
    // Kopukken gelen geç yanıt ya da okuma bir şey yollamaz.
    const once = t.gonderCagrisi;
    await bosalt();
    assert.equal(t.gonderCagrisi, once);
    t.temizle();
    t.bagla();
    assert.deepEqual(t.tipler(), ["media_begin"]);
    t.durum("m-1-1", "yukleniyor", { alinan: P });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => p.ofset),
      [P, 2 * P],
    );
  });

  it("okuma sürerken kopma: okunan parça yollanmaz", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 2 * P })]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    t.y.koptu(); // `oku` sözü henüz çözülmedi
    await bosalt();
    assert.deepEqual(t.parcalar(), []);
  });

  it("servis sıfırlaması: kabul edilmiş kayıt yeniden sorulur, alinan 0 ise baştan yüklenir", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 100 })]);
    t.bagla();
    t.durum("m-1-1", "kabul");
    assert.equal(t.y.hazirlik([id("m-1-1")]), "hazir");
    t.y.koptu();
    assert.equal(t.y.hazirlik([id("m-1-1")]), "hazir", "kopukta kabul korunur");
    t.temizle();
    t.bagla();
    assert.deepEqual(t.tipler(), ["media_begin"], "kabul dahil bağlanmamış kayıt sorulur");
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    assert.equal(t.y.hazirlik([id("m-1-1")]), "bekliyor");
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => [p.ofset, Buffer.from(p.veri, "base64").length]),
      [[0, 100]],
    );
  });

  it("reddedildi ve yerel_yok kayıtları yeniden sorulmaz", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1"), yeni(t, "m-1-2"), yeni(t, "m-1-3")]);
    t.bagla();
    t.durum("m-1-1", "reddedildi", { code: "medya_siniri" });
    t.dosya.dosyalar.delete("file:///eren-medya/m-1-2.jpg");
    t.durum("m-1-2", "yukleniyor", { alinan: 0 });
    await bosalt();
    t.y.koptu();
    t.temizle();
    t.bagla();
    assert.deepEqual(
      t.giden.map((m) => [m.type, m["medya_id"]]),
      [["media_begin", "m-1-3"]],
    );
    assert.equal(t.y.bekleyenSayisi(), 1);
  });

  it("gonder false: yükleme durur, kopma ve yeniden bağlanma beklenir", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 3 * P })]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    t.acik = false;
    await bosalt();
    const cagri = t.gonderCagrisi;
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    await t.y.ekle([yeni(t, "m-1-2")]);
    await bosalt();
    assert.equal(t.gonderCagrisi, cagri, "durduktan sonra gonder çağrılmaz");
    t.y.koptu();
    t.acik = true;
    t.temizle();
    t.bagla();
    assert.deepEqual(
      t.giden.map((m) => [m.type, m["medya_id"]]),
      [
        ["media_begin", "m-1-1"],
        ["media_begin", "m-1-2"],
      ],
    );
  });
});

describe("yükleyici: hazırlık ve hata durumları", () => {
  it("reddedildi → {hata: kod}; kaydı olmayan kimlik hazır", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1"), yeni(t, "m-1-2")]);
    t.bagla();
    t.durum("m-1-2", "reddedildi", { code: "medya_reddedildi" });
    assert.deepEqual(t.y.hazirlik([id("m-1-1"), id("m-1-2")]), { hata: "medya_reddedildi" });
    assert.equal(t.y.hazirlik([id("m-9-9")]), "hazir");
    assert.equal(t.y.hazirlik([]), "hazir");
    assert.deepEqual(t.y.gorunum(id("m-1-2"))?.ilerleme, { durum: "reddedildi", kod: "medya_reddedildi" });
  });

  it("süren yüklemede reddedildi: sıradaki eke geçilir", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 3 * P }), yeni(t, "m-1-2", { boyut: 10 })]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    t.durum("m-1-2", "yukleniyor", { alinan: 0 });
    await bosalt();
    t.durum("m-1-1", "reddedildi", { code: "medya_reddedildi" });
    await bosalt();
    assert.deepEqual(
      t.parcalar().map((p) => [p.medya_id, p.ofset]),
      [
        ["m-1-1", 0],
        ["m-1-1", P],
        ["m-1-2", 0],
      ],
    );
  });

  it("yerel kopya okunamıyor → yerel_yok, ek_bulunamadi ve media_cancel", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { boyut: 2 * P }), yeni(t, "m-1-2", { boyut: 10 })]);
    t.dosya.dosyalar.delete("file:///eren-medya/m-1-1.jpg");
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    t.durum("m-1-2", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.deepEqual(t.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "yerel_yok" });
    assert.deepEqual(t.y.hazirlik([id("m-1-1")]), { hata: "ek_bulunamadi" });
    assert.deepEqual(
      t.giden.filter((m) => m.type === "media_cancel"),
      [{ v: 5, type: "media_cancel", medya_id: "m-1-1" }],
    );
    assert.deepEqual(
      t.parcalar().map((p) => p.medya_id),
      ["m-1-2"],
      "sıradaki eke geçildi",
    );
    // Geç gelen durum yerel_yok'u değiştirmez.
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    assert.deepEqual(t.y.hazirlik([id("m-1-1")]), { hata: "ek_bulunamadi" });
    assert.equal(t.y.bekleyenSayisi(), 1);
  });

  it("dosya beyan edilenden kısa → yerel_yok", async () => {
    const t = kur();
    await t.y.yukle();
    const y = yeni(t, "m-1-1", { boyut: 100 });
    t.dosya.dosyalar.set(y.uri, icerik(60));
    await t.y.ekle([y]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.deepEqual(t.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "yerel_yok" });
    assert.deepEqual(t.parcalar(), []);
  });

  it("reddedildi ile yerel_yok birlikte: reddedildi önce; biri bekliyorsa bekliyor", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1"), yeni(t, "m-1-2"), yeni(t, "m-1-3")]);
    t.dosya.dosyalar.delete("file:///eren-medya/m-1-1.jpg");
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    await bosalt();
    t.durum("m-1-2", "reddedildi", { code: "medya_siniri" });
    assert.deepEqual(t.y.hazirlik([id("m-1-1"), id("m-1-2")]), { hata: "medya_siniri" });
    assert.deepEqual(t.y.hazirlik([id("m-1-3"), id("m-1-1")]), { hata: "ek_bulunamadi" });
    assert.equal(t.y.hazirlik([id("m-1-3")]), "bekliyor");
  });

  it("degisti her durum değişikliğinde çağrılır", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1")]);
    const a = t.degisim;
    assert.ok(a >= 1, "ekle");
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    assert.ok(t.degisim > a);
    const b = t.degisim;
    t.durum("m-1-1", "kabul", { isleme: "isleniyor" });
    assert.ok(t.degisim > b);
  });
});

describe("yükleyici: kalıcılık", () => {
  it("ekle tek yazım; yeniden açılışta kayıt diskten, bekliyor'dan başlar", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { tur: "video" }), yeni(t, "m-1-2")]);
    assert.equal(t.depo.islemler.filter((i) => i.anahtar === YUKLEME_ANAHTARI).length, 1);
    t.bagla();
    t.durum("m-1-1", "kabul");
    const t2 = kur();
    t2.depo.kv = new Map(t.depo.kv);
    t2.dosya.dosyalar = new Map(t.dosya.dosyalar);
    await t2.y.yukle();
    assert.deepEqual(t2.y.gorunum(id("m-1-1")), {
      onizleme_uri: "file:///eren-medya/m-1-1.kapak.jpg",
      ilerleme: { durum: "bekliyor" },
    });
    assert.equal(t2.y.bekleyenSayisi(), 2);
    t2.bagla();
    assert.deepEqual(
      t2.giden.map((m) => m["medya_id"]),
      ["m-1-1", "m-1-2"],
    );
  });

  /** `t`'nin diskini ve dosyalarını taşıyan yeni yükleyici (yeniden açılış). */
  const yenidenAc = async (t: ReturnType<typeof kur>) => {
    await t.y.bosalt();
    const t2 = kur();
    t2.depo.kv = new Map(t.depo.kv);
    t2.dosya.dosyalar = new Map(t.dosya.dosyalar);
    await t2.y.yukle();
    await t2.y.bosalt();
    return t2;
  };

  it("reddedildi ve yerel_yok yeniden açılışta korunur: sorulmaz, yüklenmez, bekleyen sayılmaz", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1"), yeni(t, "m-1-2"), yeni(t, "m-1-3")]);
    t.bagla();
    t.durum("m-1-1", "reddedildi", { code: "medya_siniri" });
    t.dosya.dosyalar.delete("file:///eren-medya/m-1-2.jpg");
    t.durum("m-1-2", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.deepEqual(t.y.gorunum(id("m-1-2"))?.ilerleme, { durum: "yerel_yok" });
    // Dosya geri gelse bile yeniden açılışta yüklenmez.
    t.dosya.dosyalar.set("file:///eren-medya/m-1-2.jpg", icerik(1000, 1000));
    const t2 = await yenidenAc(t);
    assert.deepEqual(t2.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "reddedildi", kod: "medya_siniri" });
    assert.deepEqual(t2.y.gorunum(id("m-1-2"))?.ilerleme, { durum: "yerel_yok" });
    assert.deepEqual(t2.y.gorunum(id("m-1-3"))?.ilerleme, { durum: "bekliyor" });
    assert.equal(t2.y.bekleyenSayisi(), 1);
    assert.deepEqual(t2.y.hazirlik([id("m-1-1")]), { hata: "medya_siniri" });
    assert.deepEqual(t2.y.hazirlik([id("m-1-2")]), { hata: "ek_bulunamadi" });
    t2.bagla();
    assert.deepEqual(
      t2.giden.map((m) => [m.type, m["medya_id"]]),
      [["media_begin", "m-1-3"]],
    );
    // Sonlanmış kayda geç gelen durum yükleme başlatmaz.
    t2.durum("m-1-2", "yukleniyor", { alinan: 0 });
    await bosalt();
    assert.deepEqual(t2.parcalar(), []);
    // Süpürme kayıtlı dosyalara dokunmadı.
    assert.deepEqual(t2.dosya.silinenler, []);
    // İkinci açılış da aynı.
    const t3 = await yenidenAc(t2);
    assert.equal(t3.y.bekleyenSayisi(), 1);
    assert.deepEqual(t3.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "reddedildi", kod: "medya_siniri" });
  });

  it("sonlanmış kayıt iptal edilince diskten de kalkar", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1"), yeni(t, "m-1-2")]);
    t.bagla();
    t.durum("m-1-1", "reddedildi", { code: "medya_reddedildi" });
    await t.y.bosalt();
    const t2 = await yenidenAc(t);
    await t2.y.iptal([id("m-1-1")]);
    assert.equal(t2.y.gorunum(id("m-1-1")), null);
    assert.ok(t2.dosya.silinenler.includes("file:///eren-medya/m-1-1.jpg"));
    const t3 = await yenidenAc(t2);
    assert.equal(t3.y.gorunum(id("m-1-1")), null);
    assert.deepEqual(t3.y.gorunum(id("m-1-2"))?.ilerleme, { durum: "bekliyor" });
    const disk = JSON.parse(t3.depo.kv.get(YUKLEME_ANAHTARI)!) as { kayitlar: { bilgi: { medya_id: string } }[] };
    assert.deepEqual(
      disk.kayitlar.map((k) => k.bilgi.medya_id),
      ["m-1-2"],
    );
  });

  it("sonlanmış durum yazılamazsa bellek doğru kalır, sonraki yazım taşır", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1")]);
    t.bagla();
    t.depo.hata.yaz = true;
    t.durum("m-1-1", "reddedildi", { code: "medya_siniri" });
    await t.y.bosalt();
    assert.equal(t.y.bekleyenSayisi(), 0);
    t.depo.hata.yaz = false;
    await t.y.ekle([yeni(t, "m-1-2")]);
    const t2 = await yenidenAc(t);
    assert.deepEqual(t2.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "reddedildi", kod: "medya_siniri" });
    assert.equal(t2.y.bekleyenSayisi(), 1);
  });

  it("eski v1 kaydı (son alanı yok) okunur ve bekliyor'dan başlar; geçersiz son kaydı atar", async () => {
    const t = kur();
    const eski = (m: string) => ({
      sohbet_id: "ana",
      bilgi: ekBilgisi(m),
      uri: `file:///eren-medya/${m}.jpg`,
      onizleme_uri: `file:///eren-medya/${m}.jpg`,
    });
    t.depo.kv.set(
      YUKLEME_ANAHTARI,
      JSON.stringify({
        v: 1,
        kayitlar: [
          eski("m-1-1"),
          { ...eski("m-1-2"), son: { durum: "yerel_yok" } },
          { ...eski("m-1-3"), son: { durum: "reddedildi", kod: "medya_siniri" } },
          { ...eski("m-1-4"), son: { durum: "reddedildi" } },
          { ...eski("m-1-5"), son: { durum: "reddedildi", kod: "uydurma_kod" } },
          { ...eski("m-1-6"), son: { durum: "kabul" } },
          { ...eski("m-1-7"), son: null },
          { ...eski("m-1-8"), son: "yerel_yok" },
        ],
      }),
    );
    await t.y.yukle();
    assert.deepEqual(t.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "bekliyor" });
    assert.deepEqual(t.y.gorunum(id("m-1-2"))?.ilerleme, { durum: "yerel_yok" });
    assert.deepEqual(t.y.gorunum(id("m-1-3"))?.ilerleme, { durum: "reddedildi", kod: "medya_siniri" });
    for (const m of ["m-1-4", "m-1-5", "m-1-6", "m-1-7", "m-1-8"]) assert.equal(t.y.gorunum(id(m)), null, m);
    assert.equal(t.y.bekleyenSayisi(), 1);
    t.bagla();
    assert.deepEqual(
      t.giden.map((m) => [m.type, m["medya_id"]]),
      [["media_begin", "m-1-1"]],
    );
    // Yeniden yazımda biçim v1 kalır, son yalnız sonlanmışta.
    await t.y.iptal([id("m-1-3")]);
    const disk = JSON.parse(t.depo.kv.get(YUKLEME_ANAHTARI)!) as { v: number; kayitlar: Record<string, unknown>[] };
    assert.equal(disk.v, 1);
    assert.deepEqual(
      disk.kayitlar.map((k) => [(k["bilgi"] as { medya_id: string }).medya_id, k["son"]]),
      [
        ["m-1-1", undefined],
        ["m-1-2", { durum: "yerel_yok" }],
      ],
    );
  });

  it("aynı medya_id ikinci kez eklenmez", async () => {
    const t = kur();
    await t.y.yukle();
    const y = yeni(t, "m-1-1");
    await t.y.ekle([y, y]);
    await t.y.ekle([y]);
    assert.equal(t.y.bekleyenSayisi(), 1);
    const disk = JSON.parse(t.depo.kv.get(YUKLEME_ANAHTARI)!) as { kayitlar: unknown[] };
    assert.equal(disk.kayitlar.length, 1);
  });

  it("ekle yazılamazsa reddeder, bellek değişmez, hiçbir şey yollanmaz", async () => {
    const t = kur();
    await t.y.yukle();
    t.bagla();
    t.depo.hata.yaz = true;
    await assert.rejects(t.y.ekle([yeni(t, "m-1-1")]));
    assert.equal(t.y.bekleyenSayisi(), 0);
    assert.equal(t.y.gorunum(id("m-1-1")), null);
    assert.deepEqual(t.giden, []);
    t.depo.hata.yaz = false;
    await t.y.ekle([yeni(t, "m-1-2")]);
    assert.equal(t.y.bekleyenSayisi(), 1, "kuyruk bozulmadı");
  });

  it("bozuk kayıt atılır, sağlamı kalır; bozuk JSON ve bilinmeyen sürüm boş sayılır", async () => {
    const t = kur();
    const saglam = {
      sohbet_id: "ana",
      bilgi: ekBilgisi("m-1-1"),
      uri: "file:///eren-medya/m-1-1.jpg",
      onizleme_uri: "file:///eren-medya/m-1-1.jpg",
    };
    t.depo.kv.set(
      YUKLEME_ANAHTARI,
      JSON.stringify({
        v: 1,
        kayitlar: [
          saglam,
          { ...saglam, bilgi: ekBilgisi("m-1-2", { mime: "video/mp4" }) },
          { ...saglam, bilgi: ekBilgisi("m-1-3"), uri: "" },
          { ...saglam, bilgi: ekBilgisi("m-1-4"), sohbet_id: 5 },
          { ...saglam, bilgi: ekBilgisi("m-1-5"), onizleme_uri: 3 },
          null,
          "x",
        ],
      }),
    );
    t.depo.kv.set(
      ONIZLEME_ANAHTARI,
      JSON.stringify({
        v: 1,
        onizlemeler: [
          { medya_id: "m-0-1", sohbet_id: "ana", seq: 4, onizleme_uri: null },
          { medya_id: "m-0-2", sohbet_id: "ana", seq: -1, onizleme_uri: null },
          { medya_id: "m-0-3", sohbet_id: "ana", seq: 5 },
        ],
      }),
    );
    await t.y.yukle();
    assert.equal(t.y.bekleyenSayisi(), 1);
    assert.notEqual(t.y.gorunum(id("m-1-1")), null);
    assert.deepEqual(t.y.gorunum(id("m-0-1")), { onizleme_uri: null, ilerleme: null });
    assert.equal(t.y.gorunum(id("m-0-2")), null);
    assert.equal(t.y.gorunum(id("m-0-3")), null);

    for (const metin of ["{bozuk", JSON.stringify({ v: 2, kayitlar: [saglam] }), JSON.stringify([saglam])]) {
      const t2 = kur();
      t2.depo.kv.set(YUKLEME_ANAHTARI, metin);
      await t2.y.yukle();
      assert.equal(t2.y.bekleyenSayisi(), 0, metin);
    }
  });

  it("depo okunamazsa yukle reddeder", async () => {
    const t = kur();
    t.depo.oku = () => Promise.reject(new Error("oku"));
    await assert.rejects(t.y.yukle());
  });

  it("açılış süpürmesi: kaydı ya da önizlemesi olmayan dosyalar silinir", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { tur: "video" }), yeni(t, "m-1-2")]);
    t.bagla();
    t.durum("m-1-2", "kabul");
    await t.y.mesajaBaglandi(id("m-1-2"), 7);
    const t2 = kur();
    t2.depo.kv = new Map(t.depo.kv);
    t2.dosya.dosyalar = new Map(t.dosya.dosyalar);
    t2.dosya.dosyalar.set("file:///eren-medya/m-0-9.mp4", icerik(5));
    t2.dosya.dosyalar.set("file:///eren-medya/m-0-9.kapak.jpg", icerik(5));
    await t2.y.yukle();
    await t2.y.bosalt();
    assert.deepEqual(t2.dosya.silinenler.sort(), [
      "file:///eren-medya/m-0-9.kapak.jpg",
      "file:///eren-medya/m-0-9.mp4",
    ]);
    assert.deepEqual([...t2.dosya.dosyalar.keys()].sort(), [
      "file:///eren-medya/m-1-1.kapak.jpg",
      "file:///eren-medya/m-1-1.mp4",
      "file:///eren-medya/m-1-2.jpg",
    ]);
  });

  it("süpürme, ekle'si sürmekte olan dosyaya dokunmaz; listele düşerse sessiz", async () => {
    const t = kur();
    const y = yeni(t, "m-1-1");
    let listeVer: (l: readonly string[]) => void = () => {};
    t.dosya.listele = () => new Promise((r) => (listeVer = r));
    await t.y.yukle(); // süpürme listeyi bekliyor
    const ekleme = t.y.ekle([y]);
    listeVer([y.uri, y.onizleme_uri!]);
    await ekleme;
    await t.y.bosalt();
    assert.ok(t.dosya.dosyalar.has(y.uri));
    assert.deepEqual(t.dosya.silinenler, []);
    assert.equal(t.y.bekleyenSayisi(), 1);
    const t2 = kur();
    t2.dosya.hata.listele = true;
    await t2.y.yukle();
    await t2.y.bosalt();
  });
});

describe("yükleyici: bağlama, iptal ve silme", () => {
  it("mesajaBaglandi: video kopyası silinir, kapak önizleme olur; fotoğraf kopyası kalır", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { tur: "video" }), yeni(t, "m-1-2")]);
    t.bagla();
    t.durum("m-1-1", "kabul", { isleme: "isleniyor" });
    t.durum("m-1-2", "kabul");
    await t.y.mesajaBaglandi(id("m-1-1"), 10);
    await t.y.mesajaBaglandi(id("m-1-2"), 10);
    assert.deepEqual(t.dosya.silinenler, ["file:///eren-medya/m-1-1.mp4"]);
    assert.equal(t.y.bekleyenSayisi(), 0);
    assert.deepEqual(t.y.gorunum(id("m-1-1")), {
      onizleme_uri: "file:///eren-medya/m-1-1.kapak.jpg",
      ilerleme: { durum: "kabul", isleme: "isleniyor" },
    });
    assert.deepEqual(t.y.gorunum(id("m-1-2")), { onizleme_uri: "file:///eren-medya/m-1-2.jpg", ilerleme: null });
    // Bağlandıktan sonra gelen işleme bildirimi.
    t.durum("m-1-1", "kabul", { isleme: "hazir" });
    assert.deepEqual(t.y.gorunum(id("m-1-1"))?.ilerleme, { durum: "kabul", isleme: "hazir" });
    assert.equal(t.y.hazirlik([id("m-1-1")]), "hazir");
    // Kalıcı: kayıt diskte yok, önizleme var.
    const kayit = JSON.parse(t.depo.kv.get(YUKLEME_ANAHTARI)!) as { kayitlar: unknown[] };
    const oniz = JSON.parse(t.depo.kv.get(ONIZLEME_ANAHTARI)!) as { onizlemeler: { medya_id: string; seq: number }[] };
    assert.deepEqual(kayit.kayitlar, []);
    assert.deepEqual(
      oniz.onizlemeler.map((o) => [o.medya_id, o.seq]),
      [
        ["m-1-1", 10],
        ["m-1-2", 10],
      ],
    );
    // Telafiyle aynı yankı yeniden: zararsız.
    await t.y.mesajaBaglandi(id("m-1-1"), 10);
    await t.y.mesajaBaglandi(id("m-9-9"), 11);
    assert.equal(t.dosya.silinenler.length, 1);
  });

  it("kaydı olmayan kimliğin isleme'si en çok 64 tutulur", () => {
    const t = kur();
    for (let i = 0; i < 70; i++) t.durum(`m-0-${i}`, "kabul", { isleme: "isleniyor" });
    assert.equal(t.y.gorunum(id("m-0-0")), null, "en eskisi düştü");
    assert.equal(t.y.gorunum(id("m-0-5")), null);
    assert.deepEqual(t.y.gorunum(id("m-0-6")), { onizleme_uri: null, ilerleme: { durum: "kabul", isleme: "isleniyor" } });
    assert.notEqual(t.y.gorunum(id("m-0-69")), null);
    // isleme'siz kabul ya da yukleniyor bilinmeyen kimlik için bir şey tutmaz
    t.durum("m-0-99", "kabul");
    assert.equal(t.y.gorunum(id("m-0-99")), null);
  });

  it("iptal: kayıt ve dosyalar silinir, bağlıysa media_cancel; süren yükleme sıradakine geçer", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { tur: "video", boyut: 2 * P }), yeni(t, "m-1-2", { boyut: 10 })]);
    t.bagla();
    t.durum("m-1-1", "yukleniyor", { alinan: 0 });
    t.durum("m-1-2", "yukleniyor", { alinan: 0 });
    await bosalt();
    t.temizle();
    await t.y.iptal([id("m-1-1"), id("m-9-9")]);
    await bosalt();
    assert.deepEqual(
      t.giden.map((m) => [m.type, m["medya_id"]]),
      [
        ["media_cancel", "m-1-1"],
        ["media_chunk", "m-1-2"],
      ],
    );
    assert.deepEqual(t.dosya.silinenler.sort(), ["file:///eren-medya/m-1-1.kapak.jpg", "file:///eren-medya/m-1-1.mp4"]);
    assert.equal(t.y.gorunum(id("m-1-1")), null);
    assert.equal(t.y.hazirlik([id("m-1-1")]), "hazir", "kaydı yok: son söz servisin");
    // Eski parçanın geç yanıtı zararsız.
    t.durum("m-1-1", "yukleniyor", { alinan: P });
    assert.equal(t.y.gorunum(id("m-1-1")), null);
  });

  it("iptal bağlı değilken media_cancel yollamaz; dosya silinemezse yine çözülür", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1")]);
    t.dosya.hata.sil = true;
    await t.y.iptal([id("m-1-1")]);
    assert.equal(t.y.bekleyenSayisi(), 0);
    assert.equal(t.gonderCagrisi, 0);
  });

  it("sohbetiTemizle: yalnız o sohbetin seq <= sinir_seq önizlemeleri; bağlanmamış kayıtlar kalır", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([
      yeni(t, "m-1-1", { sohbet: "s-1" }),
      yeni(t, "m-1-2", { sohbet: "s-1" }),
      yeni(t, "m-1-3", { sohbet: "s-2" }),
      yeni(t, "m-1-4", { sohbet: "s-1" }),
    ]);
    t.bagla();
    for (const m of ["m-1-1", "m-1-2", "m-1-3"]) t.durum(m, "kabul");
    await t.y.mesajaBaglandi(id("m-1-1"), 5);
    await t.y.mesajaBaglandi(id("m-1-2"), 6);
    await t.y.mesajaBaglandi(id("m-1-3"), 5);
    await t.y.sohbetiTemizle("s-1" as SohbetId, 5);
    assert.equal(t.y.gorunum(id("m-1-1")), null);
    assert.notEqual(t.y.gorunum(id("m-1-2")), null, "seq 6 > sınır");
    assert.notEqual(t.y.gorunum(id("m-1-3")), null, "başka sohbet");
    assert.notEqual(t.y.gorunum(id("m-1-4")), null, "bağlanmamış kayıt kalır");
    assert.deepEqual(t.dosya.silinenler, ["file:///eren-medya/m-1-1.jpg"]);
    const oniz = JSON.parse(t.depo.kv.get(ONIZLEME_ANAHTARI)!) as { onizlemeler: { medya_id: string }[] };
    assert.deepEqual(
      oniz.onizlemeler.map((o) => o.medya_id),
      ["m-1-2", "m-1-3"],
    );
  });

  it("sohbetSilindi: o sohbetin önizlemeleri silinir, bağlanmamış kayıtları iptal edilir", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { sohbet: "s-1" }), yeni(t, "m-1-2", { sohbet: "s-1" }), yeni(t, "m-1-3", { sohbet: "s-2" })]);
    t.bagla();
    t.durum("m-1-1", "kabul");
    await t.y.mesajaBaglandi(id("m-1-1"), 3);
    t.temizle();
    await t.y.sohbetSilindi("s-1" as SohbetId);
    assert.equal(t.y.gorunum(id("m-1-1")), null);
    assert.equal(t.y.gorunum(id("m-1-2")), null);
    assert.notEqual(t.y.gorunum(id("m-1-3")), null);
    assert.deepEqual(
      t.giden.filter((m) => m.type === "media_cancel").map((m) => m["medya_id"]),
      ["m-1-2"],
    );
    assert.deepEqual(t.dosya.silinenler.sort(), ["file:///eren-medya/m-1-1.jpg", "file:///eren-medya/m-1-2.jpg"]);
  });

  it("sifirla: bütün önizlemeler silinir, kayıtlar kalır", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1", { tur: "video" }), yeni(t, "m-1-2", { sohbet: "s-2" })]);
    t.bagla();
    t.durum("m-1-1", "kabul");
    await t.y.mesajaBaglandi(id("m-1-1"), 3);
    await t.y.sifirla();
    assert.equal(t.y.gorunum(id("m-1-1")), null);
    assert.notEqual(t.y.gorunum(id("m-1-2")), null);
    assert.ok(t.dosya.silinenler.includes("file:///eren-medya/m-1-1.kapak.jpg"));
    assert.ok(!t.dosya.silinenler.includes("file:///eren-medya/m-1-2.jpg"));
  });

  it("bekleyenSayisi reddedildi ve yerel_yok'u saymaz, kabul'ü sayar", async () => {
    const t = kur();
    await t.y.yukle();
    await t.y.ekle([yeni(t, "m-1-1"), yeni(t, "m-1-2"), yeni(t, "m-1-3")]);
    t.bagla();
    t.durum("m-1-1", "kabul");
    t.durum("m-1-2", "reddedildi");
    assert.equal(t.y.bekleyenSayisi(), 2);
  });
});
