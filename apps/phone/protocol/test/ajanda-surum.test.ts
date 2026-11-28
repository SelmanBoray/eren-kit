import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import {
  AJANDA_AZAMI_CERCEVE,
  AJANDA_CERCEVE_SEMALARI,
  AJANDA_QR_SURUMU,
  AJANDA_SURUMLERI,
  AJANDA_SURUMU,
  type AjandaAsagi,
  ajandaAsagiCoz,
  ajandaAsagiSurume,
  AjandaEslestirmeQr,
  ajandaGeriDusus,
  type AjandaGeriDususu,
  ajandaDonmusHataOku,
  ajandaRetSurumuOku,
  AJANDA_KANAL_HATALARI,
  AJANDA_RET_NEDENLERI,
  type AjandaSurumNo,
  ajandaSurumuMu,
  ajandaYukariCoz,
  surumluCozumle,
} from "../src/index.ts";

/** D5 sürüm uyumu: çok sürümlü çözücü, aşağı uyarlama, ret sürümü, geri düşüş, QR sürümü. */

const oku = (ad: string) => JSON.parse(readFileSync(new URL(`../vektorler/${ad}`, import.meta.url), "utf8"));
const surum = oku("ajanda-surum.json") as {
  surumler: number[];
  qr_surumu: number;
  cozum: { ad: string; yon: "yukari" | "asagi"; baglanti: number | null; ham: string; gecerli: boolean; tur?: string; kod?: string }[];
  ret_surumu: { ad: string; ham: string; surum: number | null }[];
  geri_dusus: { ad: string; denenen: number; ret: number | null; kume: number[]; karar: AjandaGeriDususu }[];
  donmus_hata: { ad: string; ham: string; hata: { v: number; code: string; detail?: string } | null }[];
};
const mesajlar = oku("ajanda-mesaj.json") as { asagi: { ad: string; ham: string; gecerli: boolean }[] };
const kurallar = oku("ajanda-kurallar.json") as { qr: { gecerli: { v: number }[] } };

const NONCE = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNA==";
const hello = (v: unknown) => JSON.stringify({ v, type: "hello", device_id: "d1", son_rev: 0, client_nonce: NONCE });

test("sürüm kümesi: artan, bitişik, en büyüğü AJANDA_SURUMU; tablo kümeyle birebir", () => {
  assert.deepEqual([...AJANDA_SURUMLERI], [2, 3]);
  assert.equal(AJANDA_SURUMLERI.at(-1), AJANDA_SURUMU);
  for (let i = 1; i < AJANDA_SURUMLERI.length; i++) assert.equal(AJANDA_SURUMLERI[i], AJANDA_SURUMLERI[i - 1]! + 1);
  assert.deepEqual(Object.keys(AJANDA_CERCEVE_SEMALARI).map(Number), [...AJANDA_SURUMLERI]);
  // Her sürümün şeması yalnız kendi `v`'sini kabul eder.
  for (const v of AJANDA_SURUMLERI) {
    const s = AJANDA_CERCEVE_SEMALARI[v];
    assert.equal(s.Yukari.safeParse(JSON.parse(hello(v))).success, true, `v${v}`);
    assert.equal(s.Yukari.safeParse(JSON.parse(hello(v + 1))).success, false, `v${v} şeması v${v + 1}'i almaz`);
  }
});

test("ajandaSurumuMu yalnız kümedeki sayıyı tanır (tablo güvenilmez anahtarla indekslenmez)", () => {
  assert.equal(ajandaSurumuMu(2), true);
  assert.equal(ajandaSurumuMu(3), true);
  for (const v of [1, 4, 2.5, "2", "3", "__proto__", "toString", null, undefined, {}]) assert.equal(ajandaSurumuMu(v), false, String(v));
});

test("sürüm vektörü: küme ve QR sürümü sabitlerle aynı, adlar tekil", () => {
  assert.deepEqual(surum.surumler, [...AJANDA_SURUMLERI]);
  assert.equal(surum.qr_surumu, AJANDA_QR_SURUMU);
  for (const q of kurallar.qr.gecerli) assert.equal(q.v, surum.qr_surumu);
  for (const bolum of [surum.cozum, surum.ret_surumu, surum.geri_dusus, surum.donmus_hata]) {
    assert.equal(new Set(bolum.map((o) => o.ad)).size, bolum.length);
  }
});

test("çözüm vektörü: bağlantı sürümüyle ve sürüm sabitlenmeden", () => {
  assert.ok(surum.cozum.length >= 8);
  for (const o of surum.cozum) {
    const baglanti = o.baglanti === null ? undefined : (o.baglanti as AjandaSurumNo);
    const s = o.yon === "yukari" ? ajandaYukariCoz(o.ham, baglanti) : ajandaAsagiCoz(o.ham, baglanti);
    if (o.gecerli) {
      assert.equal(s.ok, true, o.ad);
      assert.equal(s.ok && s.mesaj.type, o.tur, o.ad);
    } else {
      assert.equal(s.ok, false, o.ad);
      assert.equal(!s.ok && s.kod, o.kod, o.ad);
    }
  }
});

test("çözücü: kümedeki sürüm kabul edilir, sabitlenecek sürüm mesaj.v; kümede olmayan sürüm protokol_uyumsuz", () => {
  for (const v of AJANDA_SURUMLERI) {
    for (const baglanti of [undefined, v]) {
      const s = ajandaYukariCoz(hello(v), baglanti);
      assert.equal(s.ok && s.mesaj.v, v);
    }
  }
  for (const v of [0, 1, 4, 2.5, -2]) {
    assert.deepEqual(ajandaYukariCoz(hello(v)), { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] }, String(v));
    for (const b of AJANDA_SURUMLERI) {
      assert.deepEqual(ajandaYukariCoz(hello(v), b), { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] }, `${v} @${b}`);
    }
  }
  for (const v of ["2", null, true]) {
    const s = ajandaYukariCoz(hello(v));
    assert.equal(!s.ok && s.kod, "gecersiz_mesaj", String(v));
  }
  const { v: _v, ...vsiz } = JSON.parse(hello(2)) as Record<string, unknown>;
  const s = ajandaYukariCoz(JSON.stringify(vsiz));
  assert.equal(!s.ok && s.kod, "gecersiz_mesaj");
  assert.equal(!ajandaAsagiCoz(" ".repeat(AJANDA_AZAMI_CERCEVE.KANAL + 1), 2).ok, true);
});

test("çözücü: bağlantı sürümünde gövdesi geçersiz islem islem_id'yi verir; başka sürümde vermez", () => {
  const govdesiz = (v: number) => JSON.stringify({ v, type: "islem", islem_id: "i1", islem: { islem: "uç" } });
  const s = ajandaYukariCoz(govdesiz(2), 2);
  assert.equal(!s.ok && s.kod, "gecersiz_mesaj");
  assert.equal(s.islem_id, "i1");
  assert.equal(ajandaYukariCoz(govdesiz(2)).islem_id, "i1");
  const baska = ajandaYukariCoz(govdesiz(3), 2);
  assert.equal(!baska.ok && baska.kod, "protokol_uyumsuz");
  assert.equal(baska.islem_id, undefined);
});

test("sürüm kendi içinde katı: fazla alan reddi korunur", () => {
  const fazla = JSON.stringify({ ...JSON.parse(hello(2)), bolge: { ad: "ev" } });
  for (const baglanti of [undefined, 2 as const]) {
    const s = ajandaYukariCoz(fazla, baglanti);
    assert.equal(!s.ok && s.kod, "gecersiz_mesaj");
  }
  const welcome = { v: 2, type: "welcome", depo_id: "depo1", bas_rev: 0, tam: false, server_time_ms: 1 };
  assert.equal(ajandaAsagiCoz(JSON.stringify(welcome), 2).ok, true);
  assert.equal(ajandaAsagiCoz(JSON.stringify({ ...welcome, yetenekler: [] }), 2).ok, false);
});

test("surumluCozumle düzeneği: iki sürümlü tabloda her sürüm kendi şemasıyla, sabitlenince yalnız o", () => {
  // v3 yalnız örnektir: sürüme bağlı alan (`bolge`) yalnız v3 şemasında.
  const semalar = {
    2: z.strictObject({ v: z.literal(2), type: z.literal("x") }),
    3: z.strictObject({ v: z.literal(3), type: z.literal("x"), bolge: z.string() }),
  };
  type X = z.infer<(typeof semalar)[2 | 3]>;
  const coz = (ham: unknown, kabul: number[]) =>
    surumluCozumle<X>(JSON.stringify(ham), 1000, kabul, (v) => semalar[v as 2 | 3]);
  const kod = (s: ReturnType<typeof coz>) => (s.ok ? "ok" : s.kod);
  assert.equal(kod(coz({ v: 2, type: "x" }, [2, 3])), "ok");
  assert.equal(kod(coz({ v: 3, type: "x", bolge: "ev" }, [2, 3])), "ok");
  assert.equal(kod(coz({ v: 2, type: "x", bolge: "ev" }, [2, 3])), "gecersiz_mesaj", "v2 bölge bilmez");
  assert.equal(kod(coz({ v: 3, type: "x" }, [2, 3])), "gecersiz_mesaj", "v3 bölge ister");
  assert.equal(kod(coz({ v: 3, type: "x", bolge: "ev" }, [2])), "protokol_uyumsuz", "bağlantı v2'de sabit");
  assert.equal(kod(coz({ v: 2, type: "x" }, [3])), "protokol_uyumsuz", "bağlantı v3'te sabit");
  assert.equal(kod(coz({ v: 4, type: "x" }, [2, 3])), "protokol_uyumsuz");
  // `v` sayı değilse kümenin en büyüğünün şemasında reddedilir (yollar belirli).
  assert.deepEqual(coz({ type: "x", bolge: "ev" }, [2, 3]), { ok: false, kod: "gecersiz_mesaj", yollar: ["v"] });
  assert.equal(kod(surumluCozumle("{", 1000, [2], (v) => semalar[v as 2])), "gecersiz_mesaj");
  assert.equal(kod(surumluCozumle(" ".repeat(1001), 1000, [2], (v) => semalar[v as 2])), "mesaj_cok_buyuk");
});

test("ajandaAsagiSurume: v2 biçimli çerçevenin v2 baytları değişmez, sonuç v2 şemasından geçer", () => {
  const gecerli = mesajlar.asagi.filter((o) => o.gecerli);
  assert.equal(new Set(gecerli.map((o) => (JSON.parse(o.ham) as { type: string }).type)).size, 8, "her aşağı tür");
  for (const o of gecerli) {
    const m = JSON.parse(o.ham) as AjandaAsagi;
    const once = JSON.stringify(m);
    const s = ajandaAsagiSurume(m, 2);
    assert.equal(s.ok, true, o.ad);
    assert.equal(s.ok && JSON.stringify(s.mesaj), once, `${o.ad}: baytlar`);
    assert.equal(JSON.stringify(m), once, `${o.ad}: girdi değişmemeli`);
    assert.equal(ajandaAsagiCoz(JSON.stringify(s.ok && s.mesaj), 2).ok, true, o.ad);
  }
});

test("ajandaAsagiSurume: şemaya uymayan çerçeve yollanmaz, değer yankılanmaz; küme dışı sürüm", () => {
  const gizli = "gizli-baslik-12345";
  const bozuk = { v: 2, type: "error", code: gizli } as unknown as AjandaAsagi;
  const s = ajandaAsagiSurume(bozuk, 2);
  assert.equal(!s.ok && s.kod, "gecersiz_mesaj");
  assert.equal(JSON.stringify(s).includes(gizli), false);
  const fazla = { v: 2, type: "esitlendi", rev: 1, bolge: {} } as unknown as AjandaAsagi;
  assert.equal(ajandaAsagiSurume(fazla, 2).ok, false, "fazla alan");
  const dogru: AjandaAsagi = { v: AJANDA_SURUMU, type: "esitlendi", rev: 1 };
  assert.deepEqual(ajandaAsagiSurume(dogru, 4 as AjandaSurumNo), { ok: false, kod: "protokol_uyumsuz", yollar: ["v"] });
});

test("ret sürümü vektörü: dondurulmuş error zarfı", () => {
  assert.ok(surum.ret_surumu.length >= 12);
  for (const o of surum.ret_surumu) assert.equal(ajandaRetSurumuOku(o.ham), o.surum, o.ad);
  assert.equal(ajandaRetSurumuOku(" ".repeat(AJANDA_AZAMI_CERCEVE.KANAL + 1)), null);
});

test("ret sürümü: servisin bugünkü ret çerçevesi okunur ve v2 çözücüsünden de geçer", () => {
  const ret = JSON.stringify({ v: AJANDA_SURUMU, type: "error", code: "protokol_uyumsuz" });
  assert.equal(ajandaRetSurumuOku(ret), AJANDA_SURUMU);
  assert.equal(ajandaAsagiCoz(ret, AJANDA_SURUMU).ok, true);
  // Kümede olmayan sürümün reddi çözücüde protokol_uyumsuz, ama sürümü okunur.
  const yeni = JSON.stringify({ v: 9, type: "error", code: "protokol_uyumsuz", detail: "x" });
  assert.equal(!ajandaAsagiCoz(yeni).ok, true);
  assert.equal(ajandaRetSurumuOku(yeni), 9);
});

test("geri düşüş vektörü", () => {
  assert.ok(surum.geri_dusus.length >= 12);
  const dallar = new Set<string>();
  for (const o of surum.geri_dusus) {
    const k = ajandaGeriDusus(o.denenen, o.ret, o.kume);
    assert.deepEqual(k, o.karar, o.ad);
    dallar.add(`${o.ret === null ? "1002" : "ret"}:${k.karar}`);
  }
  for (const d of ["ret:yeniden_dene", "ret:uygulama_eski", "ret:servis_eski", "ret:bilinmiyor", "1002:yeniden_dene", "1002:bilinmiyor"]) {
    assert.ok(dallar.has(d), d);
  }
});

test("geri düşüş: varsayılan küme bugünkü küme, boş küme bilinmiyor", () => {
  // v3 uygulama v2 servise: ret v2 (ya da yalnız 1002) -> v2 ile yeniden.
  assert.deepEqual(ajandaGeriDusus(3, 2), { karar: "yeniden_dene", surum: 2 });
  assert.deepEqual(ajandaGeriDusus(3, null), { karar: "yeniden_dene", surum: 2 });
  assert.deepEqual(ajandaGeriDusus(2, null), { karar: "bilinmiyor" });
  assert.deepEqual(ajandaGeriDusus(3, 4), { karar: "uygulama_eski" });
  assert.deepEqual(ajandaGeriDusus(3, 1), { karar: "servis_eski" });
  assert.deepEqual(ajandaGeriDusus(2, 2), { karar: "bilinmiyor" });
  assert.deepEqual(ajandaGeriDusus(2, 3), { karar: "bilinmiyor" });
  assert.deepEqual(ajandaGeriDusus(3, 2, []), { karar: "bilinmiyor" });
});

test("geri düşüş: her yeniden deneme kümede ve kesin küçük; zincir kümenin boyundan kısa", () => {
  const kumeler = [[2], [2, 3], [2, 3, 4], [1, 2, 3, 4, 5]];
  for (const kume of kumeler) {
    for (const ret of [null, 0, 1, 2, 3, 4, 5, 6, 7]) {
      let denenen = Math.max(...kume);
      let adim = 0;
      for (;;) {
        const k = ajandaGeriDusus(denenen, ret, kume);
        if (k.karar !== "yeniden_dene") break;
        assert.ok(k.surum < denenen && kume.includes(k.surum), `${kume} ${ret}`);
        denenen = k.surum;
        adim++;
        // Servis aynı reddi yinelese de zincir biter.
        assert.ok(adim < kume.length, `${kume} ${ret}: zincir bitmeli`);
      }
    }
  }
});

test("QR sürümü kanal sürümünden bağımsız ve dondurulmuş", () => {
  assert.equal(AJANDA_QR_SURUMU, 2);
  assert.equal(AjandaEslestirmeQr.shape.v.value, AJANDA_QR_SURUMU);
  const qr = { v: AJANDA_QR_SURUMU, ...kurallarQrGovdesi() };
  assert.equal(AjandaEslestirmeQr.safeParse(qr).success, true);
  // Kanal sürümü ne olursa olsun QR yalnız kendi sürümünü taşır.
  for (const v of [...AJANDA_SURUMLERI.map((s) => s + 1), AJANDA_QR_SURUMU - 1]) {
    assert.equal(AjandaEslestirmeQr.safeParse({ ...qr, v }).success, false, String(v));
  }
});

function kurallarQrGovdesi(): Record<string, unknown> {
  const { v: _v, ...govde } = kurallar.qr.gecerli[0] as Record<string, unknown>;
  return govde;
}

test("dondurulmuş hata vektörü: ajandaDonmusHataOku; ret sürümü onun üstüne kuruludur", () => {
  assert.ok(surum.donmus_hata.length >= 12);
  for (const o of surum.donmus_hata) {
    assert.deepEqual(ajandaDonmusHataOku(o.ham), o.hata, o.ad);
    const beklenen = o.hata !== null && o.hata.code === "protokol_uyumsuz" ? o.hata.v : null;
    assert.equal(ajandaRetSurumuOku(o.ham), beklenen, `${o.ad}: ret sürümü`);
  }
  for (const o of surum.ret_surumu) {
    const h = ajandaDonmusHataOku(o.ham);
    assert.equal(h !== null && h.code === "protokol_uyumsuz" ? h.v : null, o.surum, o.ad);
  }
  assert.equal(ajandaDonmusHataOku(" ".repeat(AJANDA_AZAMI_CERCEVE.KANAL + 1)), null);
  // Sürümü sabitlenmemiş istemci: başka sürümden zaman_asimi geri düşüş değildir.
  const zaman = JSON.stringify({ v: 4, type: "error", code: "zaman_asimi" });
  assert.equal(ajandaRetSurumuOku(zaman), null);
  assert.deepEqual(ajandaDonmusHataOku(zaman), { v: 4, code: "zaman_asimi" });
});

test("iki sürüm: bağlantı sabitse öteki sürüm küme içinde olsa da protokol_uyumsuz; küme dışı her halde", () => {
  const kod = (s: { ok: boolean; kod?: string }) => (s.ok ? "ok" : s.kod);
  assert.equal(kod(ajandaYukariCoz(hello(3), 2)), "protokol_uyumsuz");
  assert.equal(kod(ajandaYukariCoz(hello(2), 3)), "protokol_uyumsuz");
  assert.equal(kod(ajandaYukariCoz(hello(3))), "ok");
  assert.equal(kod(ajandaYukariCoz(hello(4))), "protokol_uyumsuz");
  const esitlendi = (v: number) => JSON.stringify({ v, type: "esitlendi", rev: 1 });
  assert.equal(kod(ajandaAsagiCoz(esitlendi(3), 2)), "protokol_uyumsuz");
  assert.equal(kod(ajandaAsagiCoz(esitlendi(2), 3)), "protokol_uyumsuz");
  assert.equal(kod(ajandaAsagiCoz(esitlendi(2))), "ok");
});

test("v2 bağlantıda v3 alanlı çerçeve reddedilir; işlem gövdesi reddinde islem_id döner", () => {
  const yetenekli = JSON.stringify({ ...JSON.parse(hello(2)), yetenekler: [] });
  for (const b of [undefined, 2 as const]) assert.equal(!ajandaYukariCoz(yetenekli, b).ok, true);
  const guncelle = (v: number) =>
    JSON.stringify({ v, type: "islem", islem_id: "i_b", islem: { islem: "guncelle", kayit_id: "k1", temel_revizyon: 1, degisiklik: { bolge: "Market" } } });
  const s2 = ajandaYukariCoz(guncelle(2), 2);
  assert.equal(!s2.ok && s2.kod, "gecersiz_mesaj");
  assert.equal(s2.islem_id, "i_b", "gövde reddi: kuyruk tıkanmaz");
  assert.equal(ajandaYukariCoz(guncelle(3), 3).ok, true);
  const ekIste = (v: number) => JSON.stringify({ v, type: "ek_iste", istek_id: "y", ek_id: "e", ozet: "0".repeat(64), ofset: 0 });
  assert.equal(!ajandaYukariCoz(ekIste(2), 2).ok, true, "v2'de ek çerçevesi yok");
  assert.equal(ajandaYukariCoz(ekIste(3), 3).ok, true);
});

test("en yeni sürümün her ret nedeni ve kanal hata kodu eski her sürüme uyarlanır ve o sürümün şemasından geçer", () => {
  const eskiler = AJANDA_SURUMLERI.filter((s) => s < AJANDA_SURUMU);
  assert.ok(eskiler.length > 0);
  const cerceveler: AjandaAsagi[] = [];
  for (const code of AJANDA_RET_NEDENLERI) {
    cerceveler.push({ v: AJANDA_SURUMU, type: "islem_sonucu", islem_id: "i1", ok: false, kayit_id: "k1", code });
    cerceveler.push({ v: AJANDA_SURUMU, type: "gecmis", istek_id: "g1", kayit_id: "k1", girdiler: [], devami: false, code });
  }
  for (const code of AJANDA_KANAL_HATALARI) {
    cerceveler.push({ v: AJANDA_SURUMU, type: "error", code });
    cerceveler.push({ v: AJANDA_SURUMU, type: "pair_result", ok: false, code });
  }
  for (const v of eskiler) {
    for (const m of cerceveler) {
      const s = ajandaAsagiSurume(m, v);
      assert.equal(s.ok, true, `${m.type} ${"code" in m ? m.code : ""} -> v${v}`);
      assert.equal(ajandaAsagiCoz(JSON.stringify(s.ok && s.mesaj), v).ok, true);
    }
  }
});

test("uyarlama: v3 modeli v2'ye süzülür ve v2 şemasından geçer; ek çerçevesi uyarlanamaz; v3'te kimlik", () => {
  const v3 = oku("ajanda-mesaj-v3.json") as { asagi: { ad: string; ham: string; gecerli: boolean }[] };
  let uyarlanan = 0;
  for (const o of v3.asagi.filter((x) => x.gecerli)) {
    const m = JSON.parse(o.ham) as AjandaAsagi;
    const once = JSON.stringify(m);
    const kimlik = ajandaAsagiSurume(m, 3);
    assert.equal(kimlik.ok && JSON.stringify(kimlik.mesaj), once, `${o.ad}: v3 kimlik`);
    const s = ajandaAsagiSurume(m, 2);
    assert.equal(JSON.stringify(m), once, `${o.ad}: girdi değişmemeli`);
    if (m.type === "ek_durum" || m.type === "ek_parca" || m.type === "ek_ret") {
      assert.deepEqual(s, { ok: false, kod: "protokol_uyumsuz", yollar: ["type"] }, o.ad);
      continue;
    }
    assert.equal(s.ok, true, o.ad);
    const ham = JSON.stringify(s.ok && s.mesaj);
    assert.equal(ajandaAsagiCoz(ham, 2).ok, true, `${o.ad}: v2 şeması`);
    for (const alan of ["yetenekler", "simge", "bolge", "bolge_konumu", "varis", "baglantilar", "ekler"]) {
      assert.equal(ham.includes(`"${alan}"`), false, `${o.ad}: ${alan}`);
    }
    uyarlanan++;
  }
  assert.ok(uyarlanan >= 10);
});