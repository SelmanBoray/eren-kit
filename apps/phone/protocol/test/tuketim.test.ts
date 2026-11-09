import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SOHBET_SINIRLARI,
  SOHBET_SURUMU,
  sohbetAsagiCoz,
  sohbetYukariCoz,
} from "../src/index.ts";

// Sözleşme: sozlesme-tuketim.md (§3 tel yüzeyi, P2). Testler şemanın koduna değil sözleşmeye göredir.
const v = SOHBET_SURUMU;

const top = (o: object = {}) => ({ girdi: 10, cache_yazma: 2, cache_okuma: 3, cikti: 5, sonuc_adet: 1, ...o });
const ikili = () => ({ sohbet: top(), is: top({ maliyet_usd: 0.25 }) });
const rapor = (o: object = {}): Record<string, unknown> => ({
  v,
  type: "usage_report",
  istek_id: "r1",
  olcum_ms: 1700000000000,
  gun_baslangic_ms: 1699920000000,
  bugun: ikili(),
  son_7_gun: ikili(),
  sohbetler: [
    { sohbet_id: "ana", toplam: ikili() },
    { sohbet_id: "s-1", toplam: ikili() },
  ],
  silinmis_sohbetler: ikili(),
  isler: [
    { is_id: 9, toplam: top() },
    { is_id: 4, toplam: top({ maliyet_usd: 1.5 }) },
  ],
  ...o,
});
const istek = (o: object = {}): Record<string, unknown> => ({ v, type: "usage_request", istek_id: "r1", ...o });

const asagi = (o: unknown) => sohbetAsagiCoz(JSON.stringify(o));
const yukari = (o: unknown) => sohbetYukariCoz(JSON.stringify(o));
type Sonuc = { ok: true } | { ok: false; kod: string };
const kabul = (s: Sonuc) => assert.equal(s.ok, true, JSON.stringify(s));
const ret = (s: Sonuc, kod = "gecersiz_mesaj") => {
  assert.equal(s.ok, false);
  if (!s.ok) assert.equal(s.kod, kod);
};
const isler = (n: number) => Array.from({ length: n }, (_, i) => ({ is_id: n - i, toplam: top() }));
const sohbetler = (n: number) => Array.from({ length: n }, (_, i) => ({ sohbet_id: `s-${i + 1}`, toplam: ikili() }));

test("geçerli tam usage_report kabul edilir", () => {
  kabul(asagi(rapor()));
});

test("geçerli usage_request kabul edilir", () => {
  kabul(yukari(istek()));
});

test("usage_report: fazla alan her düzeyde reddedilir", () => {
  ret(asagi(rapor({ fazla: 1 })));
  ret(asagi(rapor({ bugun: { ...ikili(), fazla: 1 } })));
  ret(asagi(rapor({ bugun: { sohbet: top({ fazla: 1 }), is: top() } })));
  ret(asagi(rapor({ silinmis_sohbetler: { ...ikili(), fazla: 1 } })));
  ret(asagi(rapor({ sohbetler: [{ sohbet_id: "ana", toplam: ikili(), fazla: 1 }] })));
  ret(asagi(rapor({ sohbetler: [{ sohbet_id: "ana", toplam: { ...ikili(), fazla: 1 } }] })));
  ret(asagi(rapor({ isler: [{ is_id: 1, toplam: top(), fazla: 1 }] })));
  ret(asagi(rapor({ isler: [{ is_id: 1, toplam: top({ fazla: 1 }) }] })));
});

test("usage_request: fazla alan reddedilir", () => {
  ret(yukari(istek({ fazla: 1 })));
});

test("sayaç: negatif, ondalık ve güvenli aralık dışı reddedilir", () => {
  for (const alan of ["girdi", "cache_yazma", "cache_okuma", "cikti", "sonuc_adet"]) {
    ret(asagi(rapor({ bugun: { sohbet: top({ [alan]: -1 }), is: top() } })));
    ret(asagi(rapor({ bugun: { sohbet: top({ [alan]: 1.5 }), is: top() } })));
  }
  ret(asagi(rapor({ bugun: { sohbet: top({ girdi: Number.MAX_SAFE_INTEGER + 1 }), is: top() } })));
  kabul(asagi(rapor({ bugun: { sohbet: top({ girdi: 0 }), is: top({ girdi: Number.MAX_SAFE_INTEGER }) } })));
});

test("maliyet_usd isteğe bağlıdır; sınır dışı değer reddedilir", () => {
  kabul(asagi(rapor({ bugun: { sohbet: top(), is: top() } })));
  kabul(asagi(rapor({ bugun: { sohbet: top({ maliyet_usd: 0 }), is: top({ maliyet_usd: 1e7 }) } })));
  ret(asagi(rapor({ bugun: { sohbet: top({ maliyet_usd: -0.01 }), is: top() } })));
  ret(asagi(rapor({ bugun: { sohbet: top({ maliyet_usd: 1e7 + 1 }), is: top() } })));
  ret(asagi(rapor({ bugun: { sohbet: top({ maliyet_usd: "1" }), is: top() } })));
});

test("yinelenen sohbet_id reddedilir", () => {
  ret(
    asagi(
      rapor({
        sohbetler: [
          { sohbet_id: "ana", toplam: ikili() },
          { sohbet_id: "ana", toplam: ikili() },
        ],
      }),
    ),
  );
});

test("isler: yinelenen ya da azalan sırada olmayan is_id reddedilir", () => {
  ret(asagi(rapor({ isler: [{ is_id: 5, toplam: top() }, { is_id: 5, toplam: top() }] })));
  ret(asagi(rapor({ isler: [{ is_id: 4, toplam: top() }, { is_id: 9, toplam: top() }] })));
  ret(asagi(rapor({ isler: [{ is_id: 9, toplam: top() }, { is_id: 4, toplam: top() }, { is_id: 6, toplam: top() }] })));
  kabul(asagi(rapor({ isler: [] })));
  kabul(asagi(rapor({ isler: [{ is_id: 7, toplam: top() }] })));
});

test("isler: TUKETIM_IS_ADET adet kabul, bir fazlası ret", () => {
  const n = SOHBET_SINIRLARI.TUKETIM_IS_ADET;
  kabul(asagi(rapor({ isler: isler(n) })));
  ret(asagi(rapor({ isler: isler(n + 1) })));
});

test("sohbetler: SOHBET_ADET adet kabul, bir fazlası ret", () => {
  const n = SOHBET_SINIRLARI.SOHBET_ADET;
  kabul(asagi(rapor({ sohbetler: sohbetler(n) })));
  ret(asagi(rapor({ sohbetler: sohbetler(n + 1) })));
  kabul(asagi(rapor({ sohbetler: [] })));
});

test("silinmis_sohbetler yokken de geçerli", () => {
  const r = rapor();
  delete r.silinmis_sohbetler;
  kabul(asagi(r));
});

test("zorunlu alan eksikse reddedilir", () => {
  for (const alan of ["istek_id", "olcum_ms", "gun_baslangic_ms", "bugun", "son_7_gun", "sohbetler", "isler"]) {
    const r = rapor();
    delete r[alan];
    ret(asagi(r));
  }
  const q = istek();
  delete q.istek_id;
  ret(yukari(q));
});

test("sürüm uyuşmazlığı protokol_uyumsuz olarak reddedilir", () => {
  // Sürüm sabit yazılmaz: beklenen `SOHBET_SURUMU`'nun bir üstü ve altı.
  for (const kotu of [v + 1, v - 1]) {
    ret(asagi(rapor({ v: kotu })), "protokol_uyumsuz");
    ret(yukari(istek({ v: kotu })), "protokol_uyumsuz");
  }
});

test("usage_request'te client_msg_id yoktur; verilirse reddedilir", () => {
  kabul(yukari(istek()));
  ret(yukari(istek({ client_msg_id: "m1" })));
});

test("yön denetimi: usage_request yalnız yukarı, usage_report yalnız aşağı", () => {
  kabul(yukari(istek()));
  ret(asagi(istek()));
  kabul(asagi(rapor()));
  ret(yukari(rapor()));
});
