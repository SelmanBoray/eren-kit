/**
 * `/ajanda` aşağı çerçevelerinin boyu, v3 alanlarıyla (`ajanda.test.ts` "en büyük kayıt, geçmiş sayfası
 * ..." testinin v3 hali). Sınır `AJANDA_AZAMI_CERCEVE.KANAL` UTF-16 birimiyle ölçülür (`jsonAc`:
 * `ham.length`; Rust ve Kotlin de UTF-16 sayar), bu yüzden en kötü metin JSON'da kaçışla iki birime çıkan
 * karakterdir (`"` ya da `\`; çok satırlı metinde `\n` de). Baytta en kötüsü üç baytlık BMP karakteridir;
 * o da aşağıda ayrıca ölçülür.
 *
 * Servisin geçmiş yazım yolları (`server/src/ajanda.ts`, `ajanda-araclar.ts`) ve birlikte yazdıkları:
 * - `ekle` (telefon, araç): `onceki` boş, `sonraki` doğum parçası (`dogumParcasi`): bütün alanlar, örneksiz.
 * - `guncelle` (telefon): `fark` ile iki yanda değişen her alan. Tekrar ya da zaman değişince örnekler
 *   budanır ve iki tam liste yazılır; budama yalnız siler, bu yüzden iki yanda örnek varsa sonraki en
 *   çok `ORNEK_ADET - 1`. Telefonun `guncelle`'si bütün v3 alanlarını (ekler ve bölge konumu dahil) taşır.
 * - `guncelle`/`onayla` (araç, eş birleşimi): aynı `fark`; ekleri ve bölge konumunu veremez (konum yalnız
 *   düşer), `korunan_alanlar` yalnız emir olmayan otomasyonda.
 * - `durum` örnekli: yalnız `ornek_durumu` ve (atma olduysa) iki tam örnek listesi; başka alan yok.
 * - `durum`, `onayla`, `sil`, `geri_yukle`: tek bayrak.
 * Gerçekte üretilebilen en büyük girdi bu yüzden telefonun her alanı birden değiştiren ve bir örnek
 * budayan `guncelle`'sidir; en büyük sayfa yirmi tanesi art arda (her biri `adet`'i bir azaltıp son örneği
 * budar, öteki alanlar iki uç hal arasında gidip gelir).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AJANDA_ALANLARI,
  AJANDA_AZAMI_CERCEVE,
  AJANDA_SINIRLARI as S,
  AJANDA_SURUMU,
  type AjandaAsagi,
  ajandaAsagiCoz,
  ajandaAsagiSurume,
  AjandaGecmisGirdisi,
  AjandaKaydi,
  type AjandaSurumNo,
  SINIRLAR,
} from "../src/index.ts";

const SINIR = AJANDA_AZAMI_CERCEVE.KANAL;
const ENB = Number.MAX_SAFE_INTEGER;
const ID = (c: string) => c.repeat(SINIRLAR.OPAK_ID);
const DILIM = "A".repeat(S.SAAT_DILIMI - 2) + "/B";
const gun = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const ornekler = (bas: number, adet: number) => Array.from({ length: adet }, (_, i) => ({ tarih: gun(bas + i), durum: "tamam" as const }));

/** İki uç hal (`yan` 0 ve 1): her alan sınırında ve iki halde farklı; metinler kaçışlı karakterle. */
function uctaGovde(yan: 0 | 1, adet: number, harf?: string) {
  const c = harf ?? (yan === 0 ? '"' : "\\");
  const host = (yan === 0 ? "a" : "b").repeat(63) + ".example";
  return {
    tur: yan === 0 ? ("randevu" as const) : ("gorev" as const),
    baslik: c.repeat(S.BASLIK),
    aciklama: c.repeat(S.ACIKLAMA),
    zaman: { kesinlik: "an" as const, tarih: gun(0), saat: yan === 0 ? "10:00" : "11:00", sure_dk: S.SURE_DK - yan, saat_dilimi: DILIM, ifade: c.repeat(S.ZAMAN_IFADESI) },
    hatirlatmalar: Array.from({ length: S.HATIRLATMA_ADET }, (_, i) => ({ tur: "mutlak" as const, tarih: gun(0), saat: `${yan}${i}:00`, saat_dilimi: DILIM })),
    tekrar: { siklik: "gunluk" as const, aralik: 1, adet },
    simge: (yan === 0 ? "a" : "b") + "0".repeat(S.SIMGE - 1),
    bolge: c.repeat(S.BOLGE),
    bolge_konumu: { enlem_e6: -90_000_000 + yan, boylam_e6: -180_000_000, yaricap_m: S.BOLGE_YARICAP_MAX },
    varis: { pencere: { bas: "00:00", bit: yan === 0 ? "23:59" : "23:58" }, cikista: true as const },
    baglantilar: Array.from({ length: S.KAYIT_BAGLANTI_ADET }, (_, i) => {
      const bas = `https://${host}/${i}/`;
      return { url: bas + "x".repeat(S.BAGLANTI_URL - bas.length), baslik: c.repeat(S.BAGLANTI_BASLIK) };
    }),
    ekler: Array.from({ length: S.EK_ADET }, (_, i) => ({
      ek_id: `e${yan}${i}`.padEnd(SINIRLAR.OPAK_ID, "e"),
      mime: "image/" + "x".repeat(S.EK_MIME - 6),
      bayt: S.EK_BAYT,
      genislik: S.EK_KENAR,
      yukseklik: S.EK_KENAR,
      ozet: String(yan).repeat(64),
      ...(i === 0 ? { kapak: true as const } : {}),
      olusturma_ms: ENB,
    })),
  };
}

/** En büyük v3 kayıt: her alan sınırında, `ORNEK_ADET` örnek, kaçışlı metinler. */
function enBuyukV3Kayit(harf?: string): AjandaKaydi {
  return AjandaKaydi.parse({
    kayit_id: ID("k"),
    revizyon: ENB,
    ...uctaGovde(0, S.TEKRAR_ADET, harf),
    ornekler: ornekler(0, S.ORNEK_ADET),
    durum: "acik",
    taslak: false,
    silindi: false,
    elle_alanlar: [...AJANDA_ALANLARI],
    kaynak: {
      yol: "sohbet_araci",
      tur_kokeni: "insan",
      sohbet_id: ID("s"),
      kaynak_msg_id: ID("m"),
      alinti: (harf ?? '"').repeat(S.ALINTI),
      tekil_anahtar: "t".repeat(S.TEKIL_ANAHTAR),
    },
    olusturma_ms: ENB,
    guncelleme_ms: ENB,
  });
}

/**
 * Gerçekte üretilebilen en büyük sayfa: yirmi telefon `guncelle`'si (en yeni başta). Başta `adet` 520,
 * örnekler 20..519. günler (500); k. adım `adet`'i 520-k yapıp son örneği budar ve öteki her alanı iki uç
 * hal arasında çevirir.
 */
function uretilebilirSayfa(harf?: string): AjandaGecmisGirdisi[] {
  const g: AjandaGecmisGirdisi[] = [];
  for (let k = S.GECMIS_SAYFA; k >= 1; k--) {
    const once = (k % 2) as 0 | 1;
    const sonra = ((k + 1) % 2) as 0 | 1;
    g.push(
      AjandaGecmisGirdisi.parse({
        rev: ENB - S.GECMIS_SAYFA + k,
        ts_ms: ENB,
        islem: "guncelle",
        yazar: { yol: "elle", tur_kokeni: "insan", device_id: ID("d") },
        temel_revizyon: ENB,
        onceki: { ...uctaGovde(once, 520 - k + 1, harf), ornekler: ornekler(20, S.ORNEK_ADET + 1 - k) },
        sonraki: { ...uctaGovde(sonra, 520 - k, harf), ornekler: ornekler(20, S.ORNEK_ADET - k) },
      }),
    );
  }
  return g;
}

/** Şemanın izin verdiği en büyük tek girdi (üretilemese de): her parça alanı iki yanda, tam örnek listeleri. */
function semaEnBuyukGirdi(): AjandaGecmisGirdisi {
  const parca = (yan: 0 | 1) => ({ ...uctaGovde(yan, S.TEKRAR_ADET), durum: yan === 0 ? "acik" : "tamam", taslak: yan === 0, silindi: yan === 1, ornek_durumu: yan === 0 ? null : "tamam", ornekler: ornekler(yan, S.ORNEK_ADET) });
  return AjandaGecmisGirdisi.parse({
    rev: ENB,
    ts_ms: ENB,
    islem: "guncelle",
    yazar: { yol: "pc_araci", tur_kokeni: "sentetik", device_id: ID("d"), sohbet_id: ID("s"), oturum_id: ID("o") },
    temel_revizyon: ENB,
    korunan_alanlar: [...AJANDA_ALANLARI],
    ornek_tarihi: gun(0),
    onceki: parca(0),
    sonraki: parca(1),
  });
}

/** Servisin yolladığı haliyle (`gateway-ajanda.ts` `cerceveYaz`): sürüme uyarla, `JSON.stringify`. */
function kablo(m: AjandaAsagi, v: AjandaSurumNo): string {
  const u = ajandaAsagiSurume(m, v);
  assert.ok(u.ok, `v${v} uyarlanamadı: ${u.ok ? "" : u.yollar.join(",")}`);
  return JSON.stringify(u.mesaj);
}

const gecmisCercevesi = (girdiler: AjandaGecmisGirdisi[]): AjandaAsagi =>
  ({ v: AJANDA_SURUMU, type: "gecmis", istek_id: ID("g"), kayit_id: ID("k"), girdiler, devami: true }) as AjandaAsagi;

test("en büyük v3 kaydı (telafi ve canlı `kayit`) v2 ve v3'te sınıra geniş payla sığar", () => {
  const kayit = enBuyukV3Kayit();
  const m = { v: AJANDA_SURUMU, type: "kayit", kayit } as AjandaAsagi;
  const v3 = kablo(m, 3);
  const v2 = kablo(m, 2);
  assert.ok(v2.length < v3.length);
  // Ölçüm (UTF-16 birimi): v3 56 780, v2 30 773; sınırın 1/16'sının altında.
  assert.ok(v3.length < SINIR / 16, String(v3.length));
  assert.equal(ajandaAsagiCoz(v3, 3).ok, true);
  assert.equal(ajandaAsagiCoz(v2, 2).ok, true);
  // Baytta en kötüsü (üç baytlık karakter) de sınırın altında: taşıma bayt sınırı (`maxPayload`) da tutar.
  const bayt = Buffer.byteLength(kablo({ v: AJANDA_SURUMU, type: "kayit", kayit: enBuyukV3Kayit("あ") } as AjandaAsagi, 3));
  assert.ok(bayt < SINIR / 8, String(bayt));
});

test("tek geçmiş girdisi, şemanın en büyüğü bile, sınıra geniş payla sığar", () => {
  const g = semaEnBuyukGirdi();
  const v3 = kablo(gecmisCercevesi([g]), 3);
  // Ölçüm: v3 111 832, v2 59 879 birim (üretilebilir en büyüğü 111 318). Bir sayfa her zaman en az
  // bir girdi taşıyabilir; v3 sınırları büyütülmez (`sinirlar.ts` "genişleme kuralı 5").
  assert.ok(v3.length < SINIR / 16, String(v3.length));
  assert.equal(ajandaAsagiCoz(v3, 3).ok, true);
  assert.equal(ajandaAsagiCoz(kablo(gecmisCercevesi([g]), 2), 2).ok, true);
});

test("üretilebilir en büyük geçmiş sayfası: v2'de sığar, v3'te GECMIS_SAYFA girdiyle sınırı aşar", () => {
  const girdiler = uretilebilirSayfa();
  assert.equal(girdiler.length, S.GECMIS_SAYFA);
  const m = gecmisCercevesi(girdiler);
  const v2 = kablo(m, 2);
  const v3 = kablo(m, 3);
  // v2: 1 169 786 birim, sığar.
  assert.ok(v2.length < SINIR, String(v2.length));
  assert.equal(ajandaAsagiCoz(v2, 2).ok, true);
  // v3: 2 207 626 birim (sınır 2 097 152); istemci `mesaj_cok_buyuk` der. Servis bu yüzden sayfayı
  // boyla da keser (`server/src/ajanda.ts` `gecmis`, sınaması `server/test/ajanda-gecmis-boyu.test.ts`).
  assert.ok(v3.length > SINIR, String(v3.length));
  const c = ajandaAsagiCoz(v3, 3);
  assert.equal(c.ok ? null : c.kod, "mesaj_cok_buyuk");
  // Eski testin `ş`'siyle (kaçışsız) 1 984 426 birim: birimde en kötüsü kaçışlı metindir.
  const s3 = kablo(gecmisCercevesi(uretilebilirSayfa("ş")), 3);
  assert.ok(s3.length < v3.length, String(s3.length));
});
