import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  AZAMI_CERCEVE,
  base64BaytUzunlugu,
  EkBilgisi,
  EkListesi,
  ekOneki,
  GirdiYolu,
  HATA_KODLARI,
  KisayolBaglami,
  MEDYA_ASAGI_TURLERI,
  MEDYA_DURUMLARI,
  MEDYA_HATA_KODLARI,
  MEDYA_ISLEME_DURUMLARI,
  MEDYA_MIME,
  MEDYA_MIMELERI,
  MEDYA_SINIRLARI,
  MEDYA_TURLERI,
  MEDYA_YUKARI_TURLERI,
  MediaBegin,
  MediaState,
  mimeTuru,
  Olay,
  olayiYetenegeGoreYansit,
  OpakId,
  PARCA_BASE64_AZAMI,
  parcaVerisiGecerliMi,
  SINIRLAR,
  SOHBET_SURUMU,
  SOHBET_YETENEKLERI,
  sohbetAsagiCoz,
  SohbetAsagi,
  sohbetYukariCoz,
  SohbetYukari,
  turBaytSiniri,
  type EkBilgisi as EkBilgisiTipi,
} from "../src/index.ts";

// Sözleşme: medya tasarımı §2.3, §2.5, §3 (yetenek `medya1`, sürüm artmaz). Testler şemanın koduna
// değil sözleşmeye göredir.
const v = SOHBET_SURUMU;
const s = "ana";
const MiB = 1024 * 1024;

const foto = (o: object = {}) => ({ medya_id: "m-1-1", tur: "foto", mime: "image/jpeg", boyut: 1000, genislik: 1568, yukseklik: 1176, ...o });
const video = (o: object = {}) => ({ medya_id: "m-1-2", tur: "video", mime: "video/mp4", boyut: 20 * MiB, sure_ms: 20_000, ...o });
const mesaj = (o: object = {}) => ({ v, type: "user_message", client_msg_id: "c1", sohbet_id: s, input: "yazi", text: "Bak", ...o });
const ev = { seq: 5, ts_ms: 1000 };
const yanki = (o: object = {}) => ({ ...ev, type: "user_echo", client_msg_id: "c1", input: "yazi", text: "Bak", ...o });
const baslat = (o: object = {}) => ({ v, type: "media_begin", sohbet_id: s, ...foto(), ...o });
const parca = (o: object = {}) => ({ v, type: "media_chunk", medya_id: "m-1-1", ofset: 0, veri: "QUJD", ...o });
const durum = (o: object = {}) => ({ v, type: "media_state", medya_id: "m-1-1", ...o });

const gecer = (sema: { safeParse(d: unknown): { success: boolean } }, d: unknown) => sema.safeParse(d).success;
const b64 = (n: number) => Buffer.alloc(n, 0xab).toString("base64");

test("sınırlar: tasarım ve Selman kararları", () => {
  assert.deepEqual(MEDYA_SINIRLARI, {
    EK_ADET: 4,
    FOTO_BAYT: 15 * MiB,
    VIDEO_BAYT: 250 * MiB,
    VIDEO_SURE_MS: 300_000,
    PARCA_BAYT: 524_288,
    BEKLEYEN_YUKLEME: 8,
    FOTO_UZUN_KENAR: 1568,
    BOYUT_KENAR: 20_000,
  });
  assert.equal(PARCA_BASE64_AZAMI, 4 * Math.ceil(524_288 / 3));
  // En büyük parça çerçevesi 2 MiB `/sohbet` çerçevesine rahatça sığar.
  const ham = JSON.stringify(parca({ medya_id: "x".repeat(SINIRLAR.OPAK_ID), ofset: MEDYA_SINIRLARI.VIDEO_BAYT - 1, veri: b64(MEDYA_SINIRLARI.PARCA_BAYT) }));
  assert.ok(ham.length < AZAMI_CERCEVE.SOHBET);
  const sonuc = sohbetYukariCoz(ham);
  assert.equal(sonuc.ok, true, JSON.stringify(sonuc));
});

test("yetenek jetonu ve tür listeleri", () => {
  assert.equal(SOHBET_YETENEKLERI.MEDYA, "medya1");
  assert.deepEqual([...MEDYA_TURLERI], ["foto", "video"]);
  assert.deepEqual([...MEDYA_YUKARI_TURLERI], ["media_begin", "media_chunk", "media_cancel"]);
  assert.deepEqual([...MEDYA_ASAGI_TURLERI], ["media_state"]);
  assert.deepEqual([...MEDYA_DURUMLARI], ["yukleniyor", "kabul", "reddedildi"]);
  assert.deepEqual([...MEDYA_ISLEME_DURUMLARI], ["isleniyor", "hazir", "kismi", "hata"]);
  assert.deepEqual([...MEDYA_MIME.foto], ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
  assert.deepEqual([...MEDYA_MIME.video], ["video/mp4", "video/quicktime", "video/3gpp", "video/webm"]);
  assert.equal(new Set(MEDYA_MIMELERI).size, MEDYA_MIMELERI.length);
  for (const m of MEDYA_MIME.foto) assert.equal(mimeTuru(m), "foto");
  for (const m of MEDYA_MIME.video) assert.equal(mimeTuru(m), "video");
  for (const m of ["image/gif", "IMAGE/JPEG", "video/x-msvideo", "application/x-mpegurl", "", 1, null, undefined]) {
    assert.equal(mimeTuru(m), undefined, String(m));
  }
  assert.equal(turBaytSiniri("foto"), 15 * MiB);
  assert.equal(turBaytSiniri("video"), 250 * MiB);
});

test("medya türleri yalnız doğru yönde ve sürüm 5'te", () => {
  for (const t of MEDYA_YUKARI_TURLERI) assert.equal(SohbetYukari.options.some((o) => o.shape.type.value === t), true, t);
  for (const t of MEDYA_ASAGI_TURLERI) assert.equal(SohbetAsagi.options.some((o) => o.shape.type.value === t), true, t);
  assert.equal(gecer(SohbetAsagi, baslat()), false);
  assert.equal(gecer(SohbetAsagi, parca()), false);
  assert.equal(gecer(SohbetAsagi, { v, type: "media_cancel", medya_id: "m" }), false);
  assert.equal(gecer(SohbetYukari, durum({ durum: "kabul" })), false);
  for (const d of [baslat(), parca(), { v, type: "media_cancel", medya_id: "m" }]) {
    assert.equal(gecer(SohbetYukari, { ...d, v: 4 }), false);
    assert.equal(sohbetYukariCoz(JSON.stringify({ ...d, v: 4 })).ok, false);
  }
  assert.equal(sohbetAsagiCoz(JSON.stringify(durum({ durum: "kabul", v: 1 }))).ok, false);
});

test("EkBilgisi: alanlar, sınırlar, tür-mime uyumu", () => {
  const gecerli = [
    foto(),
    foto({ genislik: undefined, yukseklik: undefined }),
    foto({ boyut: 1 }),
    foto({ boyut: 15 * MiB }),
    foto({ mime: "image/heic", genislik: 20_000, yukseklik: 1 }),
    ...MEDYA_MIME.foto.map((mime) => foto({ mime })),
    ...MEDYA_MIME.video.map((mime) => video({ mime })),
    video({ boyut: 250 * MiB, sure_ms: 300_000 }),
    video({ sure_ms: 1 }),
    video({ sure_ms: undefined }),
    { medya_id: "m", tur: "foto", mime: "image/png", boyut: 5 },
  ];
  for (const e of gecerli) assert.equal(gecer(EkBilgisi, e), true, JSON.stringify(e));
  const gecersiz: [string, object][] = [
    ["foto bayt sınırı", foto({ boyut: 15 * MiB + 1 })],
    ["video bayt sınırı", video({ boyut: 250 * MiB + 1 })],
    ["sıfır boyut", foto({ boyut: 0 })],
    ["kesirli boyut", foto({ boyut: 1.5 })],
    ["metin boyut", foto({ boyut: "10" })],
    ["video süresi sınırı", video({ sure_ms: 300_001 })],
    ["sıfır süre", video({ sure_ms: 0 })],
    ["fotoğrafta süre", foto({ sure_ms: 1000 })],
    ["foto türü, video mime", foto({ mime: "video/mp4" })],
    ["video türü, foto mime", video({ mime: "image/jpeg" })],
    ["listede olmayan mime", foto({ mime: "image/gif" })],
    ["HLS mime", video({ mime: "application/vnd.apple.mpegurl" })],
    ["bilinmeyen tür", foto({ tur: "ses" })],
    ["genişlik sınırı", foto({ genislik: 20_001 })],
    ["sıfır yükseklik", foto({ yukseklik: 0 })],
    ["opak olmayan kimlik", foto({ medya_id: "../x" })],
    ["uzun kimlik", foto({ medya_id: "x".repeat(SINIRLAR.OPAK_ID + 1) })],
    ["yol taşıyamaz", foto({ yol: "C:\\x.jpg" })],
    ["ad taşıyamaz", foto({ ad: "x.jpg" })],
    ["içerik taşıyamaz", foto({ veri: "QUJD" })],
    ["sohbet_id taşımaz", foto({ sohbet_id: s })],
    ["kimlik yok", { tur: "foto", mime: "image/jpeg", boyut: 1 }],
  ];
  for (const [neden, e] of gecersiz) assert.equal(gecer(EkBilgisi, e), false, neden);
});

test("EkListesi: 1..EK_ADET, tekil kimlik, en çok bir video", () => {
  const fotolar = (n: number) => Array.from({ length: n }, (_, i) => foto({ medya_id: `f${i}` }));
  assert.equal(gecer(EkListesi, fotolar(1)), true);
  assert.equal(gecer(EkListesi, fotolar(4)), true);
  assert.equal(gecer(EkListesi, [...fotolar(3), video()]), true);
  assert.equal(gecer(EkListesi, [video()]), true);
  assert.equal(gecer(EkListesi, []), false);
  assert.equal(gecer(EkListesi, fotolar(5)), false);
  assert.equal(gecer(EkListesi, [video({ medya_id: "v1" }), video({ medya_id: "v2" })]), false);
  assert.equal(gecer(EkListesi, [foto({ medya_id: "a" }), foto({ medya_id: "a" })]), false);
  assert.equal(gecer(EkListesi, [foto({ medya_id: "a" }), video({ medya_id: "a" })]), false);
  assert.equal(gecer(EkListesi, [foto(), { bozuk: 1 }]), false);
});

test("user_message.ekler: metin boş olabilir yalnız ek varsa; yalnız yazi ile", () => {
  const gecerli = [
    mesaj(),
    mesaj({ ekler: [foto()] }),
    mesaj({ text: "", ekler: [foto()] }),
    mesaj({ text: "", ekler: [video()] }),
    mesaj({ text: "x".repeat(SINIRLAR.KULLANICI_METNI), ekler: [foto({ medya_id: "a" }), foto({ medya_id: "b" }), foto({ medya_id: "c" }), video()] }),
    mesaj({ input: "dikte", text: "x" }),
    mesaj({ input: "kisayol", text: "x", baglam: { paket: "com.a.b", ad: "A" } }),
  ];
  for (const m of gecerli) assert.equal(gecer(SohbetYukari, m), true, JSON.stringify(m).slice(0, 200));
  const gecersiz: [string, object][] = [
    ["boş metin, ek yok", mesaj({ text: "" })],
    ["boş metin, boş ek", mesaj({ text: "", ekler: [] })],
    ["dikte ile ek", mesaj({ input: "dikte", ekler: [foto()] })],
    ["kısayol ile ek", mesaj({ input: "kisayol", ekler: [foto()] })],
    ["kısayol, bağlam ve ek", mesaj({ input: "kisayol", baglam: { paket: "com.a.b", ad: "A" }, ekler: [foto()] })],
    ["yazi ile bağlam (eski kural)", mesaj({ baglam: { paket: "com.a.b", ad: "A" }, ekler: [foto()] })],
    ["beş ek", mesaj({ ekler: Array.from({ length: 5 }, (_, i) => foto({ medya_id: `f${i}` })) })],
    ["iki video", mesaj({ ekler: [video({ medya_id: "a" }), video({ medya_id: "b" })] })],
    ["yinelenen kimlik", mesaj({ ekler: [foto(), foto()] })],
    ["bozuk ek", mesaj({ ekler: [foto({ mime: "video/mp4" })] })],
    ["ek nesne değil", mesaj({ ekler: foto() })],
    ["metin sınırı", mesaj({ text: "x".repeat(SINIRLAR.KULLANICI_METNI + 1), ekler: [foto()] })],
    ["null ekler", mesaj({ ekler: null })],
  ];
  for (const [neden, m] of gecersiz) assert.equal(gecer(SohbetYukari, m), false, neden);
  // Ack kodları medya kodlarını taşıyabilir.
  for (const code of MEDYA_HATA_KODLARI) {
    assert.equal(gecer(SohbetAsagi, { v, type: "ack", client_msg_id: "c1", ok: false, code }), true, code);
  }
});

test("user_echo.ekler: aynı kurallar; eksiz boş metin eskisi gibi geçerli", () => {
  const olayMesaji = (o: object) => SohbetAsagi.safeParse({ v, type: "event", event: o }).success;
  assert.equal(olayMesaji(yanki({ ekler: [foto(), video()] })), true);
  assert.equal(olayMesaji(yanki({ text: "", ekler: [foto()] })), true);
  assert.equal(olayMesaji(yanki({ sohbet_id: "s2", ekler: [video()] })), true);
  assert.equal(olayMesaji(yanki({ text: "" })), true);
  assert.equal(olayMesaji(yanki({ input: "dikte", ekler: [foto()] })), false);
  assert.equal(olayMesaji(yanki({ input: "kisayol", ekler: [foto()] })), false);
  assert.equal(olayMesaji(yanki({ ekler: [] })), false);
  assert.equal(olayMesaji(yanki({ ekler: [video({ medya_id: "a" }), video({ medya_id: "b" })] })), false);
  assert.equal(olayMesaji(yanki({ ekler: [foto(), foto()] })), false);
});

test("media_begin: ek alanları + sohbet_id; client_msg_id taşımaz", () => {
  for (const d of [baslat(), baslat(video()), baslat({ sohbet_id: "s-7f3a", genislik: undefined, yukseklik: undefined })]) {
    assert.equal(gecer(SohbetYukari, d), true, JSON.stringify(d));
  }
  const gecersiz: [string, object][] = [
    ["sohbet_id yok", { ...baslat(), sohbet_id: undefined }],
    ["opak olmayan sohbet_id", baslat({ sohbet_id: "a/b" })],
    ["client_msg_id taşımaz", baslat({ client_msg_id: "c1" })],
    ["foto bayt sınırı", baslat({ boyut: 15 * MiB + 1 })],
    ["video bayt sınırı", baslat(video({ boyut: 250 * MiB + 1 }))],
    ["video süre sınırı", baslat(video({ sure_ms: 300_001 }))],
    ["fotoğrafta süre", baslat({ sure_ms: 5 })],
    ["tür-mime uyuşmazlığı", baslat({ mime: "video/webm" })],
    ["bilinmeyen mime", baslat({ mime: "text/plain" })],
    ["yol taşıyamaz", baslat({ yol: "x" })],
    ["bilinmeyen alan", baslat({ bilinmeyen: 1 })],
  ];
  for (const [neden, d] of gecersiz) assert.equal(gecer(SohbetYukari, d), false, neden);
  // Tip: `sohbet_id` zorunlu string.
  const b = MediaBegin.parse(baslat());
  const id: string = b.sohbet_id;
  assert.equal(id, s);
});

test("media_chunk: ofset sınırları ve veri uzunluğu, alfabesi, dolgusu", () => {
  assert.equal(gecer(SohbetYukari, parca()), true);
  assert.equal(gecer(SohbetYukari, parca({ ofset: MEDYA_SINIRLARI.VIDEO_BAYT - 1 })), true);
  assert.equal(gecer(SohbetYukari, parca({ veri: b64(MEDYA_SINIRLARI.PARCA_BAYT) })), true);
  for (const n of [1, 2, 3, 4, 5, 6, 100, 1023, MEDYA_SINIRLARI.PARCA_BAYT - 1]) {
    assert.equal(gecer(SohbetYukari, parca({ veri: b64(n) })), true, String(n));
  }
  const gecersiz: [string, object][] = [
    ["negatif ofset", parca({ ofset: -1 })],
    ["kesirli ofset", parca({ ofset: 0.5 })],
    ["ofset video sınırında", parca({ ofset: MEDYA_SINIRLARI.VIDEO_BAYT })],
    ["boş veri", parca({ veri: "" })],
    ["PARCA_BAYT + 1", parca({ veri: b64(MEDYA_SINIRLARI.PARCA_BAYT + 1) })],
    ["dolgusuz azami uzunluk (524289 bayt)", parca({ veri: "A".repeat(PARCA_BASE64_AZAMI) })],
    ["azami uzunluğu aşan", parca({ veri: "A".repeat(PARCA_BASE64_AZAMI + 4) })],
    ["4'ün katı değil", parca({ veri: "QUJ" })],
    ["dolgusuz kısa", parca({ veri: "QQ" })],
    ["url güvenli alfabe -", parca({ veri: "ab-d" })],
    ["url güvenli alfabe _", parca({ veri: "ab_d" })],
    ["boşluk", parca({ veri: "QU D" })],
    ["satır sonu", parca({ veri: "QUJD\nQUJD" })],
    ["ortada dolgu", parca({ veri: "QQ==QUJD" })],
    ["üç dolgu", parca({ veri: "Q===" })],
    ["tek dolgu sondan ikincide", parca({ veri: "QU=D" })],
    ["yalnız dolgu", parca({ veri: "====" })],
    ["Türkçe harf", parca({ veri: "QUJş" })],
    ["metin değil", parca({ veri: 1234 })],
    ["boyut taşımaz", parca({ boyut: 3 })],
    ["client_msg_id taşımaz", parca({ client_msg_id: "c1" })],
  ];
  for (const [neden, d] of gecersiz) assert.equal(gecer(SohbetYukari, d), false, neden);
});

test("parcaVerisiGecerliMi ve base64BaytUzunlugu Buffer ile aynıdır", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 511, 512, 513, 65_536, MEDYA_SINIRLARI.PARCA_BAYT]) {
    const bayt = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff));
    const veri = bayt.toString("base64");
    assert.equal(parcaVerisiGecerliMi(veri), true, String(n));
    assert.equal(base64BaytUzunlugu(veri), n, String(n));
    assert.equal(base64BaytUzunlugu(veri), Buffer.from(veri, "base64").length, String(n));
  }
  // Bütün 256 bayt değeri: alfabenin her harfi.
  const hepsi = Buffer.from(Array.from({ length: 256 * 3 }, (_, i) => i & 0xff)).toString("base64");
  assert.equal(parcaVerisiGecerliMi(hepsi), true);
  assert.equal(parcaVerisiGecerliMi(Buffer.alloc(1).toString("base64url")), false);
  for (const d of [undefined, null, 5, {}, []]) assert.equal(parcaVerisiGecerliMi(d), false);
});

test("media_cancel", () => {
  assert.equal(gecer(SohbetYukari, { v, type: "media_cancel", medya_id: "m-1-1" }), true);
  assert.equal(gecer(SohbetYukari, { v, type: "media_cancel" }), false);
  assert.equal(gecer(SohbetYukari, { v, type: "media_cancel", medya_id: "a b" }), false);
  assert.equal(gecer(SohbetYukari, { v, type: "media_cancel", medya_id: "m", client_msg_id: "c" }), false);
  assert.equal(gecer(SohbetYukari, { v, type: "media_cancel", medya_id: "m", sohbet_id: s }), false);
});

test("media_state: alinan yalnız yukleniyor, code yalnız reddedildi, isleme yalnız kabul", () => {
  const gecerli = [
    durum({ durum: "yukleniyor", alinan: 0 }),
    durum({ durum: "yukleniyor", alinan: MEDYA_SINIRLARI.VIDEO_BAYT }),
    durum({ durum: "kabul" }),
    ...MEDYA_ISLEME_DURUMLARI.map((isleme) => durum({ durum: "kabul", isleme })),
    ...MEDYA_HATA_KODLARI.map((code) => durum({ durum: "reddedildi", code })),
    durum({ durum: "reddedildi", code: "ic_hata" }),
  ];
  for (const d of gecerli) {
    assert.equal(gecer(SohbetAsagi, d), true, JSON.stringify(d));
    assert.equal(sohbetAsagiCoz(JSON.stringify(d)).ok, true, JSON.stringify(d));
  }
  const gecersiz: [string, object][] = [
    ["yukleniyor, alinan yok", durum({ durum: "yukleniyor" })],
    ["kabul ile alinan", durum({ durum: "kabul", alinan: 5 })],
    ["reddedildi ile alinan", durum({ durum: "reddedildi", alinan: 5, code: "medya_yok" })],
    ["reddedildi, code yok", durum({ durum: "reddedildi" })],
    ["kabul ile code", durum({ durum: "kabul", code: "medya_yok" })],
    ["yukleniyor ile code", durum({ durum: "yukleniyor", alinan: 0, code: "medya_yok" })],
    ["yukleniyor ile isleme", durum({ durum: "yukleniyor", alinan: 0, isleme: "isleniyor" })],
    ["reddedildi ile isleme", durum({ durum: "reddedildi", code: "medya_reddedildi", isleme: "hata" })],
    ["bilinmeyen durum", durum({ durum: "bitti" })],
    ["bilinmeyen isleme", durum({ durum: "kabul", isleme: "bekliyor" })],
    ["bilinmeyen code", durum({ durum: "reddedildi", code: "uyduruk" })],
    ["negatif alinan", durum({ durum: "yukleniyor", alinan: -1 })],
    ["alinan video sınırını aşar", durum({ durum: "yukleniyor", alinan: MEDYA_SINIRLARI.VIDEO_BAYT + 1 })],
    ["kesirli alinan", durum({ durum: "yukleniyor", alinan: 1.5 })],
    ["kimlik yok", { v, type: "media_state", durum: "kabul" }],
    ["sohbet_id taşımaz", durum({ durum: "kabul", sohbet_id: s })],
    ["bilinmeyen alan", durum({ durum: "kabul", bilinmeyen: 1 })],
  ];
  for (const [neden, d] of gecersiz) assert.equal(gecer(SohbetAsagi, d), false, neden);
  assert.equal(gecer(MediaState, durum({ durum: "kabul", isleme: "hazir" })), true);
  for (const kod of MEDYA_HATA_KODLARI) assert.ok((HATA_KODLARI as readonly string[]).includes(kod), kod);
});

test("ekOneki", () => {
  const f = { tur: "foto" } as const;
  const vi = { tur: "video" } as const;
  assert.equal(ekOneki([]), "");
  assert.equal(ekOneki([f]), "[1 fotoğraf]");
  assert.equal(ekOneki([f, f]), "[2 fotoğraf]");
  assert.equal(ekOneki([vi]), "[video]");
  assert.equal(ekOneki([f, vi]), "[1 fotoğraf, 1 video]");
  assert.equal(ekOneki([vi, f, f, f]), "[3 fotoğraf, 1 video]");
});

// Eski APK'nın `user_echo` şeması (medya öncesi): `ekler` yok, katı nesne.
const ESKI_USER_ECHO = z.strictObject({
  seq: z.number().int().min(1),
  ts_ms: z.number().int().min(0),
  type: z.literal("user_echo"),
  sohbet_id: OpakId.optional(),
  client_msg_id: OpakId,
  input: GirdiYolu,
  text: z.string().max(SINIRLAR.KULLANICI_METNI),
  baglam: KisayolBaglami.optional(),
});

test("olayiYetenegeGoreYansit: medya1 yoksa ekler atılır, metne önek konur", () => {
  const ekli = Olay.parse(yanki({ sohbet_id: "s2", ekler: [foto({ medya_id: "a" }), foto({ medya_id: "b" })] }));
  // medya1 bağlantısı: aynı nesne.
  assert.equal(olayiYetenegeGoreYansit(ekli, true), ekli);

  const eski = olayiYetenegeGoreYansit(ekli, false);
  assert.notEqual(eski, ekli);
  assert.equal("ekler" in eski, false);
  assert.deepEqual(eski, { ...ev, type: "user_echo", sohbet_id: "s2", client_msg_id: "c1", input: "yazi", text: "[2 fotoğraf] Bak" });
  assert.equal(ESKI_USER_ECHO.safeParse(eski).success, true);
  assert.equal(Olay.safeParse(eski).success, true);
  // Girdi değişmez.
  assert.equal((ekli as { ekler?: unknown[] }).ekler?.length, 2);

  const tekVideo = olayiYetenegeGoreYansit(Olay.parse(yanki({ ekler: [video()] })), false);
  assert.equal((tekVideo as { text: string }).text, "[video] Bak");
  const karisik = olayiYetenegeGoreYansit(Olay.parse(yanki({ ekler: [foto(), video()] })), false);
  assert.equal((karisik as { text: string }).text, "[1 fotoğraf, 1 video] Bak");
  const metinsiz = olayiYetenegeGoreYansit(Olay.parse(yanki({ text: "", ekler: [video()] })), false);
  assert.equal((metinsiz as { text: string }).text, "[video]");
  assert.equal(ESKI_USER_ECHO.safeParse(metinsiz).success, true);
});

test("olayiYetenegeGoreYansit: KULLANICI_METNI'ne kırpar, vekil çiftini bölmez", () => {
  const sinir = SINIRLAR.KULLANICI_METNI;
  const uzun = olayiYetenegeGoreYansit(Olay.parse(yanki({ text: "x".repeat(sinir), ekler: [foto()] })), false) as { text: string };
  assert.equal(uzun.text.length, sinir);
  assert.ok(uzun.text.startsWith("[1 fotoğraf] x"));
  assert.equal(ESKI_USER_ECHO.safeParse(uzun).success, true);

  // "[1 fotoğraf] " 13 birim; kesim noktası bir emojinin ortasına düşsün.
  const onek = "[1 fotoğraf] ";
  const dolgu = "x".repeat(sinir - onek.length - 1);
  const emojili = olayiYetenegeGoreYansit(Olay.parse(yanki({ text: `${dolgu}🎓🎓`, ekler: [foto()] })), false) as { text: string };
  assert.equal(emojili.text.length, sinir - 1);
  assert.equal(emojili.text, onek + dolgu);
  const son = emojili.text.charCodeAt(emojili.text.length - 1);
  assert.equal(son >= 0xd800 && son <= 0xdbff, false);
});

test("olayiYetenegeGoreYansit: eksiz yankıya ve başka olaylara dokunmaz", () => {
  const olaylar = [
    Olay.parse(yanki()),
    Olay.parse(yanki({ text: "" })),
    Olay.parse({ ...ev, type: "assistant_message", turn_id: "t1", text: "[2 fotoğraf]" }),
    Olay.parse({ ...ev, type: "chat_deleted", sohbet_id: "s2" }),
    Olay.parse({ ...ev, type: "system_notice", seviye: "bilgi", kod: "diger", metin: "x" }),
  ];
  for (const o of olaylar) {
    assert.equal(olayiYetenegeGoreYansit(o, false), o, o.type);
    assert.equal(olayiYetenegeGoreYansit(o, true), o, o.type);
  }
});

// Tip düzeyi: `ekler` isteğe bağlı ve `EkBilgisi[]`.
type UserEchoTipi = Extract<Olay, { type: "user_echo" }>;
const tipSinamasi: UserEchoTipi["ekler"] extends EkBilgisiTipi[] | undefined ? true : false = true;
test("ekler tipi EkBilgisi dizisidir", () => {
  assert.equal(tipSinamasi, true);
});
