import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AZAMI_CERCEVE,
  cihazAsagiCoz,
  cihazYukariCoz,
  cozumle,
  kopruAsagiCoz,
  kopruYukariCoz,
  planHash,
  PROTOKOL_SURUMU,
  SINIRLAR,
  SOHBET_SURUMU,
  SohbetAsagi,
  sohbetAsagiCoz,
  sohbetYukariCoz,
} from "../src/index.ts";
import { PLAN_PC } from "./ornekler.ts";

// `/sohbet` çerçeveleri `SOHBET_SURUMU`, `/cihaz` ve boru çerçeveleri v1.
const v = SOHBET_SURUMU;
const v1 = PROTOKOL_SURUMU;

test("geçerli çerçeve mesajı döndürür", () => {
  const sonuc = sohbetYukariCoz(JSON.stringify({ v, type: "interrupt", client_msg_id: "m", sohbet_id: "ana" }));
  assert.equal(sonuc.ok, true);
  if (sonuc.ok) assert.equal(sonuc.mesaj.type, "interrupt");
});

test("boyut sınırı ayrıştırmadan önce uygulanır", () => {
  const sonuc = sohbetYukariCoz("x".repeat(AZAMI_CERCEVE.SOHBET + 1));
  assert.deepEqual(sonuc, { ok: false, kod: "mesaj_cok_buyuk", yollar: [] });
  assert.equal(cihazYukariCoz(" ".repeat(AZAMI_CERCEVE.CIHAZ + 1)).ok, false);
  assert.deepEqual(
    kopruYukariCoz(" ".repeat(AZAMI_CERCEVE.KOPRU + 1)),
    { ok: false, kod: "mesaj_cok_buyuk", yollar: [] },
  );
});

test("bozuk JSON atmaz, gecersiz_mesaj döner", () => {
  for (const ham of ["", "{", "null", "[]", "42", '"x"', `{"v":${v}}`, "{}"]) {
    const sonuc = sohbetYukariCoz(ham);
    assert.equal(sonuc.ok, false, ham);
    if (!sonuc.ok) assert.equal(sonuc.kod, "gecersiz_mesaj", ham);
  }
});

test("derin iç içe JSON atmaz", () => {
  const ham = "[".repeat(100_000) + "]".repeat(100_000);
  assert.equal(sohbetYukariCoz(ham).ok, false);
});

test("farklı sürüm protokol_uyumsuz döner", () => {
  const sonuc = sohbetYukariCoz(JSON.stringify({ v: v + 1, type: "interrupt", client_msg_id: "m", sohbet_id: "ana" }));
  assert.deepEqual(sonuc, { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] });
  const metinSurum = sohbetYukariCoz(JSON.stringify({ v: String(v), type: "interrupt", client_msg_id: "m", sohbet_id: "ana" }));
  assert.equal(metinSurum.ok, false);
  if (!metinSurum.ok) assert.equal(metinSurum.kod, "gecersiz_mesaj");
});

test("hata çıktısı gelen değeri içermez", () => {
  const gizli = "GIZLI-DEGER-12345";
  const sonuc = sohbetYukariCoz(JSON.stringify({ v, type: "user_message", client_msg_id: gizli + "!", input: "yazi", text: gizli }));
  assert.equal(sonuc.ok, false);
  assert.equal(JSON.stringify(sonuc).includes(gizli), false);
});

test("__proto__ alanı bilinmeyen alan sayılır ve sonuca geçmez", () => {
  const ham = `{"v":${v},"type":"interrupt","client_msg_id":"m","sohbet_id":"ana","__proto__":{"yetki":true}}`;
  assert.equal(sohbetYukariCoz(ham).ok, false);
  const icerde = `{"v":${v},"type":"plan_decision","client_msg_id":"m","plan_id":"p","plan_hash":"${"a".repeat(64)}","karar":"onay","constructor":{"x":1}}`;
  assert.equal(sohbetYukariCoz(icerde).ok, false);
  assert.equal(({} as { yetki?: boolean }).yetki, undefined);
});

test("yinelenen anahtarda son değer geçerlidir ve şemadan geçer", () => {
  const ham = `{"v":${v},"type":"welcome","type":"interrupt","client_msg_id":"m","sohbet_id":"ana"}`;
  assert.equal(sohbetYukariCoz(ham).ok, true);
});

test("her kanalın çözücüsü yalnız kendi yönünü kabul eder", () => {
  const yukari = JSON.stringify({ v: v1, type: "notify_ack", notify_id: "n" });
  assert.equal(cihazYukariCoz(yukari).ok, true);
  assert.equal(cihazAsagiCoz(yukari).ok, false);
  const asagi = JSON.stringify({ v: v1, type: "kopru_welcome", rol: "eren" });
  assert.equal(kopruAsagiCoz(asagi).ok, true);
  assert.equal(kopruYukariCoz(asagi).ok, false);
  const sohbet = JSON.stringify({ v, type: "welcome", head_seq: 0, server_time_ms: 0 });
  assert.equal(sohbetAsagiCoz(sohbet).ok, true);
  assert.equal(sohbetYukariCoz(sohbet).ok, false);
});

test("en büyük rapor ve plan olayı çerçeve sınırına sığar", () => {
  const madde = "ş".repeat(SINIRLAR.RAPOR_MADDE);
  const yol = "ş".repeat(SINIRLAR.RAPOR_DOSYA_YOLU);
  const maddeler = Array<string>(SINIRLAR.RAPOR_MADDE_ADET).fill(madde);
  const rapor = {
    yapildi: maddeler,
    yapilmadi: maddeler,
    dosyalar: Array<string>(SINIRLAR.RAPOR_DOSYA_ADET).fill(yol),
    acik_noktalar: maddeler,
  };
  const raporMesaji = {
    v,
    type: "event",
    event: { seq: 1, ts_ms: 1, type: "job_finished", is_id: 1, durum: "tamam", kirli: false, rapor },
  };
  const metin = JSON.stringify(raporMesaji);
  assert.ok(Buffer.byteLength(metin) < AZAMI_CERCEVE.SOHBET, String(Buffer.byteLength(metin)));
  assert.equal(SohbetAsagi.safeParse(raporMesaji).success, true);

  const plan = {
    ...PLAN_PC,
    baslik: "ş".repeat(SINIRLAR.PLAN_BASLIK),
    gorev_metni: "ş".repeat(SINIRLAR.GOREV_METNI),
    kesin_yapilacaklar: Array<string>(SINIRLAR.PLAN_MADDE_ADET).fill("ş".repeat(SINIRLAR.PLAN_MADDE)),
    kesin_yapilmayacaklar: Array<string>(SINIRLAR.PLAN_MADDE_ADET).fill("ş".repeat(SINIRLAR.PLAN_MADDE)),
  };
  const planMesaji = {
    v,
    type: "event",
    event: { seq: 1, ts_ms: 1, type: "plan_proposed", plan, plan_hash: planHash(plan) },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(planMesaji)) < AZAMI_CERCEVE.SOHBET);
  assert.equal(SohbetAsagi.safeParse(planMesaji).success, true);
});

test("en büyük eleman listesi ve ekran görüntüsü çerçeve sınırına sığar", () => {
  const eleman = {
    id: 1,
    rol: "x".repeat(SINIRLAR.ELEMENT_ROL),
    ad: "ş".repeat(SINIRLAR.ELEMENT_METIN),
    deger: "ş".repeat(SINIRLAR.ELEMENT_METIN),
    x: 1,
    y: 1,
  };
  const zarf = { v: v1, type: "cmd_result", cmd_id: "c", ok: true, foreground: null };
  const liste = JSON.stringify({
    ...zarf,
    payload: { kind: "elements", truncated: true, elements: Array(SINIRLAR.ELEMENT_ADET).fill(eleman) },
  });
  assert.ok(Buffer.byteLength(liste) < AZAMI_CERCEVE.CIHAZ);
  assert.equal(cihazYukariCoz(liste).ok, true);

  const resim = JSON.stringify({
    ...zarf,
    payload: { kind: "image", mime: "image/jpeg", image_base64: "A".repeat(SINIRLAR.EKRAN_BASE64), width: 1, height: 1, scale: 1 },
  });
  assert.ok(Buffer.byteLength(resim) < AZAMI_CERCEVE.CIHAZ);
  assert.equal(cihazYukariCoz(resim).ok, true);
  // Bu sonuç boruda bir zarf daha giyer.
  assert.ok(Buffer.byteLength(resim) + 256 < AZAMI_CERCEVE.KOPRU);
});

test("cozumle verilen sınırı kullanır", () => {
  const ham = JSON.stringify({ v, type: "interrupt", client_msg_id: "m", sohbet_id: "ana" });
  assert.equal(cozumle(SohbetAsagi, ham, 5).ok, false);
});
