import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SOHBET_SURUMU, UsageRequest } from "@eren/protocol";
import type { UsageReport } from "@eren/protocol";
import { tuketimKur } from "../../src/cekirdek/tuketim.ts";
import type { TuketimDurumu, TuketimRaporu } from "../../src/cekirdek/sozlesme.ts";
import { SahteSaat } from "./sahte.ts";

type Yukari = Parameters<Parameters<typeof tuketimKur>[0]["gonder"]>[0];

const sifir = { girdi: 0, cache_yazma: 0, cache_okuma: 0, cikti: 0, sonuc_adet: 0 };
const ikili = (girdi: number) => ({ sohbet: { ...sifir, girdi }, is: { ...sifir } });

const rapor = (istek_id: string, girdi = 1): UsageReport => ({
  v: SOHBET_SURUMU,
  type: "usage_report",
  istek_id,
  olcum_ms: 5,
  gun_baslangic_ms: 0,
  bugun: ikili(girdi),
  son_7_gun: ikili(girdi),
  sohbetler: [],
  isler: [],
});

/** Raporun ekran durumundaki hali: `v`, `type`, `istek_id` olmadan. */
const govde = (c: UsageReport): TuketimRaporu => {
  const { v: _v, type: _t, istek_id: _i, ...geri } = c;
  return geri;
};

const kur = (kabul = true) => {
  const saat = new SahteSaat();
  const yollanan: Yukari[] = [];
  let bildirim = 0;
  let kabulEt = kabul;
  const t = tuketimKur({
    saat,
    gonder: (m) => {
      if (!kabulEt) return false;
      yollanan.push(m);
      return true;
    },
    bildir: () => {
      bildirim++;
    },
  });
  return {
    saat,
    t,
    yollanan,
    bildirimler: () => bildirim,
    kabulAyarla: (k: boolean) => {
      kabulEt = k;
    },
    sonId: () => (yollanan[yollanan.length - 1] as { istek_id: string }).istek_id,
  };
};

describe("tuketim", () => {
  it("baslangic durumu yok, bildirim yok", () => {
    const { t, bildirimler } = kur();
    assert.deepEqual(t.durum(), { durum: "yok" });
    assert.equal(bildirimler(), 0);
  });

  it("iste: istek yollar, bekleniyor olur, bir kez bildirir; cerceve semadan gecer", () => {
    const { t, yollanan, bildirimler, saat } = kur();
    assert.equal(t.iste(), true);
    assert.equal(yollanan.length, 1);
    assert.deepEqual(t.durum(), { durum: "bekleniyor", rapor: null });
    assert.equal(bildirimler(), 1);
    assert.equal(UsageRequest.safeParse(yollanan[0]).success, true);
    assert.equal((yollanan[0] as { type: string }).type, "usage_request");
    assert.deepEqual(saat.bekleyenler(), [15_000]);
  });

  it("bekleyen istek varken iste yollamaz, false, bildirim yok", () => {
    const { t, yollanan, bildirimler } = kur();
    t.iste();
    assert.equal(t.iste(), false);
    assert.equal(yollanan.length, 1);
    assert.equal(bildirimler(), 1);
    assert.deepEqual(t.durum(), { durum: "bekleniyor", rapor: null });
  });

  it("gonder false donerse durum degismez, false, bildirim yok, zamanlayici yok", () => {
    const { t, bildirimler, saat } = kur(false);
    assert.equal(t.iste(), false);
    assert.deepEqual(t.durum(), { durum: "yok" });
    assert.equal(bildirimler(), 0);
    assert.deepEqual(saat.bekleyenler(), []);
  });

  it("gonder once reddedip sonra kabul ederse iste calisir", () => {
    const k = kur(false);
    assert.equal(k.t.iste(), false);
    k.kabulAyarla(true);
    assert.equal(k.t.iste(), true);
    assert.deepEqual(k.t.durum(), { durum: "bekleniyor", rapor: null });
  });

  it("eslesen rapor hazir yapar; alindiMs saat, bir kez bildirir, zamanlayici iptal olur", () => {
    const { t, saat, sonId, bildirimler } = kur();
    t.iste();
    saat.ilerlet(3_000);
    const c = rapor(sonId());
    t.rapor(c);
    assert.deepEqual(t.durum(), { durum: "hazir", rapor: govde(c), alindiMs: saat.simdiMs() });
    assert.equal(bildirimler(), 2);
    assert.deepEqual(saat.bekleyenler(), []);
    saat.ilerlet(60_000);
    assert.equal(t.durum().durum, "hazir");
    assert.equal(bildirimler(), 2);
  });

  it("eslesmeyen ya da beklenmeyen rapor yok sayilir", () => {
    const { t, sonId, bildirimler } = kur();
    t.rapor(rapor("hic-istenmedi"));
    assert.deepEqual(t.durum(), { durum: "yok" });
    assert.equal(bildirimler(), 0);

    t.iste();
    t.rapor(rapor("baska-id"));
    assert.deepEqual(t.durum(), { durum: "bekleniyor", rapor: null });
    assert.equal(bildirimler(), 1);

    const c = rapor(sonId());
    t.rapor(c);
    assert.equal(t.durum().durum, "hazir");
    assert.equal(bildirimler(), 2);
    // Ayni rapor ikinci kez gelirse bekleyen yok: yok sayilir.
    t.rapor(c);
    assert.equal(bildirimler(), 2);
  });

  it("10 sn den yeni raporla iste yollamaz; 10 sn sonra yollar ve eski rapor korunur", () => {
    const { t, saat, sonId, yollanan, bildirimler } = kur();
    t.iste();
    const c1 = rapor(sonId(), 7);
    t.rapor(c1);
    const alindi = saat.simdiMs();
    assert.equal(bildirimler(), 2);

    saat.ilerlet(9_999);
    assert.equal(t.iste(), false);
    assert.equal(yollanan.length, 1);
    assert.equal(bildirimler(), 2);

    saat.ilerlet(1);
    assert.equal(t.iste(), true);
    assert.equal(yollanan.length, 2);
    assert.deepEqual(t.durum(), { durum: "bekleniyor", rapor: govde(c1) });
    assert.equal(bildirimler(), 3);

    const c2 = rapor(sonId(), 9);
    t.rapor(c2);
    const d = t.durum();
    assert.ok(d.durum === "hazir" && d.alindiMs > alindi);
    assert.deepEqual(d.durum === "hazir" ? d.rapor : null, govde(c2));
  });

  it("art arda isteklerin istek_id leri farklidir ve semadan gecer", () => {
    const { t, saat, sonId, yollanan } = kur();
    const idler: string[] = [];
    for (let i = 0; i < 3; i++) {
      assert.equal(t.iste(), true);
      idler.push(sonId());
      t.rapor(rapor(sonId()));
      saat.ilerlet(10_000);
    }
    assert.equal(new Set(idler).size, 3);
    for (const m of yollanan) assert.equal(UsageRequest.safeParse(m).success, true);
  });

  it("15 sn zaman asimi hata yapar, bir kez bildirir; sonra iste yeniden yollar", () => {
    const { t, saat, bildirimler, yollanan } = kur();
    t.iste();
    saat.ilerlet(14_999);
    assert.equal(t.durum().durum, "bekleniyor");
    assert.equal(bildirimler(), 1);
    saat.ilerlet(1);
    assert.deepEqual(t.durum(), { durum: "hata", rapor: null });
    assert.equal(bildirimler(), 2);

    assert.equal(t.iste(), true);
    assert.equal(yollanan.length, 2);
    assert.deepEqual(t.durum(), { durum: "bekleniyor", rapor: null });
    assert.equal(bildirimler(), 3);
  });

  it("zaman asiminda eldeki son rapor korunur", () => {
    const { t, saat, sonId } = kur();
    t.iste();
    const c = rapor(sonId(), 4);
    t.rapor(c);
    saat.ilerlet(10_000);
    t.iste();
    saat.ilerlet(15_000);
    assert.deepEqual(t.durum(), { durum: "hata", rapor: govde(c) });
  });

  it("zaman asimindan sonra gelen eski istek_id li rapor yok sayilir", () => {
    const { t, saat, sonId, bildirimler } = kur();
    t.iste();
    const eski = sonId();
    saat.ilerlet(15_000);
    const once = bildirimler();
    t.rapor(rapor(eski));
    assert.deepEqual(t.durum(), { durum: "hata", rapor: null });
    assert.equal(bildirimler(), once);
  });

  it("hatadan sonra yeni istekle gelen eski istek_id yok sayilir, yenisi kabul edilir", () => {
    const { t, saat, sonId } = kur();
    t.iste();
    const eski = sonId();
    saat.ilerlet(15_000);
    t.iste();
    t.rapor(rapor(eski));
    assert.deepEqual(t.durum(), { durum: "bekleniyor", rapor: null });
    t.rapor(rapor(sonId()));
    assert.equal(t.durum().durum, "hazir");
  });

  it("koptu: bekleyen duser, zamanlayici iptal olur, rapor yoksa yok", () => {
    const { t, saat, sonId, bildirimler } = kur();
    t.iste();
    const id = sonId();
    t.koptu();
    assert.deepEqual(t.durum(), { durum: "yok" });
    assert.equal(bildirimler(), 2);
    assert.deepEqual(saat.bekleyenler(), []);
    saat.ilerlet(30_000);
    assert.deepEqual(t.durum(), { durum: "yok" });
    assert.equal(bildirimler(), 2);
    // Dusen istegin gec gelen raporu yok sayilir.
    t.rapor(rapor(id));
    assert.deepEqual(t.durum(), { durum: "yok" });
    assert.equal(bildirimler(), 2);
  });

  it("koptu: eldeki rapor varsa hazir, eski alindiMs ile", () => {
    const { t, saat, sonId, bildirimler } = kur();
    t.iste();
    const c1 = rapor(sonId());
    t.rapor(c1);
    const alindi = saat.simdiMs();
    saat.ilerlet(12_000);
    t.iste();
    saat.ilerlet(2_000);
    const once = bildirimler();
    t.koptu();
    assert.deepEqual(t.durum(), { durum: "hazir", rapor: govde(c1), alindiMs: alindi });
    assert.equal(bildirimler(), once + 1);
    assert.deepEqual(saat.bekleyenler(), []);
    saat.ilerlet(60_000);
    assert.equal(t.durum().durum, "hazir");
  });

  it("koptu: durum zaten aynIysa bildirim yok (yok ve hazir)", () => {
    const { t, bildirimler, sonId } = kur();
    t.koptu();
    assert.equal(bildirimler(), 0);
    t.iste();
    t.rapor(rapor(sonId()));
    const once = bildirimler();
    t.koptu();
    assert.equal(bildirimler(), once);
    assert.equal(t.durum().durum, "hazir");
  });

  it("hata durumunda koptu: rapor yoksa yok, varsa hazir", () => {
    const a = kur();
    a.t.iste();
    a.saat.ilerlet(15_000);
    a.t.koptu();
    assert.deepEqual(a.t.durum(), { durum: "yok" });

    const b = kur();
    b.t.iste();
    const c = rapor(b.sonId());
    b.t.rapor(c);
    const alindi = b.saat.simdiMs();
    b.saat.ilerlet(10_000);
    b.t.iste();
    b.saat.ilerlet(15_000);
    assert.equal(b.t.durum().durum, "hata");
    b.t.koptu();
    const d: TuketimDurumu = b.t.durum();
    assert.deepEqual(d, { durum: "hazir", rapor: govde(c), alindiMs: alindi });
  });

  it("iste(true): taze rapor kuralini atlar, yollar, eldeki raporu korur", () => {
    const { t, saat, sonId, yollanan, bildirimler } = kur();
    t.iste();
    const c1 = rapor(sonId(), 3);
    t.rapor(c1);
    saat.ilerlet(1_000);
    assert.equal(t.iste(), false);
    assert.equal(yollanan.length, 1);
    const once = bildirimler();
    assert.equal(t.iste(true), true);
    assert.equal(yollanan.length, 2);
    assert.equal(UsageRequest.safeParse(yollanan[1]).success, true);
    assert.notEqual(
      (yollanan[0] as { istek_id: string }).istek_id,
      (yollanan[1] as { istek_id: string }).istek_id,
    );
    assert.deepEqual(t.durum(), { durum: "bekleniyor", rapor: govde(c1) });
    assert.equal(bildirimler(), once + 1);
  });

  it("iste(true): bekleyen istek varken false doner, cerceve yollamaz", () => {
    const { t, yollanan, bildirimler } = kur();
    t.iste();
    assert.equal(t.iste(true), false);
    assert.equal(yollanan.length, 1);
    assert.equal(bildirimler(), 1);
    assert.deepEqual(t.durum(), { durum: "bekleniyor", rapor: null });
  });

  it("iste(false) ve iste(): taze raporda yollamaz, eski davranis", () => {
    const { t, saat, sonId, yollanan, bildirimler } = kur();
    t.iste();
    t.rapor(rapor(sonId()));
    saat.ilerlet(1_000);
    const once = bildirimler();
    assert.equal(t.iste(false), false);
    assert.equal(t.iste(undefined), false);
    assert.equal(yollanan.length, 1);
    assert.equal(bildirimler(), once);
    assert.equal(t.durum().durum, "hazir");
    saat.ilerlet(10_000);
    assert.equal(t.iste(false), true);
    assert.equal(yollanan.length, 2);
  });

  it("koptu sonrasi iste yeniden yollar", () => {
    const { t, yollanan } = kur();
    t.iste();
    t.koptu();
    assert.equal(t.iste(), true);
    assert.equal(yollanan.length, 2);
    assert.notEqual(
      (yollanan[0] as { istek_id: string }).istek_id,
      (yollanan[1] as { istek_id: string }).istek_id,
    );
    assert.equal(t.durum().durum, "bekleniyor");
  });
});
