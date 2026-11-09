import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { planHash } from "@eren/protocol";
import { ANA_SOHBET_ID, PlanOnerCikti, PlanTaslagi, SOHBET_SURUMU } from "@eren/protocol";
import type { SohbetId } from "@eren/protocol";
import type { IsProfili } from "@eren/protocol";
import type {
  IsBaslatmaIstegi,
  IsKaydi,
  IsNo,
  IzinKaydi,
  PlanDecisionMesaji,
  PlanlarBagimliliklari,
  ServisOlaylari,
  SohbetSecimi,
} from "../src/sozlesme.ts";
import { depoKur } from "../src/depo.ts";
import { planlarKur } from "../src/planlar.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteGunluk, sahteRastgele, sahteZaman } from "./sahte.ts";

const PC_CWD = "C:\\ornek\\proje";
const SAHTE_HASH = "a".repeat(64);
const ANA: SohbetSecimi = { sohbet_id: ANA_SOHBET_ID };
const A_ID: SohbetId = "sohbet-a";
const B_ID: SohbetId = "sohbet-b";
const A: SohbetSecimi = { sohbet_id: A_ID };
const B: SohbetSecimi = { sohbet_id: B_ID };

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

const pcTaslak = (ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  baslik: "Ornek is",
  tur: "pc",
  cwd: PC_CWD,
  gorev_metni: "Ornek gorev metni.",
  ...ek,
});

const telefonTaslak = (ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  baslik: "Telefon isi",
  tur: "telefon",
  cwd: "",
  gorev_metni: "Telefonda ornek gorev.",
  telefon_izin_istegi: { uygulamalar: ["com.ornek.uygulama"], mod: "oku" },
  ...ek,
});

const kur = (
  sec: {
    dizinler?: string[];
    nesil?: number;
    insanTuru?: (s: SohbetSecimi) => string | null;
    tamYetki?: () => boolean;
    /** Verilirse dosya veritabanı (ham SQL ile eski biçim yazmak için); yoksa bellek. */
    yol?: string;
  } = {},
) => {
  const zaman = sahteZaman();
  const gunluk = sahteGunluk();
  const rastgele = sahteRastgele();
  const veriyolu = veriyoluKur({ gunluk });
  const depo = depoKur({ yol: sec.yol ?? ":memory:", saat: zaman.saat, veriyolu, gunluk });
  for (const sohbet_id of [A_ID, B_ID]) {
    depo.sohbetEkle({ sohbet_id, ad: `Sohbet ${sohbet_id}`, olusturma_ms: zaman.simdi(), son_etkinlik_ms: zaman.simdi() });
  }
  const dizinler = new Set(sec.dizinler ?? [PC_CWD]);
  const durum = { nesil: sec.nesil ?? 1, serbest: true, baslatHata: false, sonIs: 100 };
  /** Sohbete özel etkin nesil; yoksa `durum.nesil`. */
  const nesiller = new Map<string, number>();
  const baslatmalar: IsBaslatmaIstegi[] = [];
  const izinler = new Map<string, IzinKaydi>();
  const geriCekmeler: Array<string | null> = [];
  const geriCekNedenleri: string[] = [];
  const olaylar: Array<{ ad: string; veri: unknown }> = [];
  for (const ad of ["plan_onerildi", "plan_sonuclandi"] as const) {
    veriyolu.dinle(ad, (v: ServisOlaylari[typeof ad]) => olaylar.push({ ad, veri: v }));
  }
  const b = {
    depo,
    isler: {
      baslat: async (istek: IsBaslatmaIstegi) => {
        baslatmalar.push(istek);
        if (durum.baslatHata) return { ok: false as const, code: "ic_hata" as const };
        return { ok: true as const, deger: ++durum.sonIs as IsNo };
      },
    },
    kilit: { baslatmaSerbestMi: () => durum.serbest },
    cihaz: {
      izinBul: (plan_id: string, plan_hash: string) => izinler.get(`${plan_id}|${plan_hash}`) ?? null,
      izinGeriCek: (grant_id: string | null, neden: string) => {
        geriCekmeler.push(grant_id);
        geriCekNedenleri.push(neden);
        return true;
      },
    },
    nesil: (sohbet: SohbetSecimi) => nesiller.get(sohbet.sohbet_id) ?? durum.nesil,
    ...(sec.insanTuru !== undefined ? { insanTuru: sec.insanTuru } : {}),
    tamYetki: sec.tamYetki ?? (() => false),
    dosya: { dizinVarMi: async (y: string) => dizinler.has(y) },
    rastgele,
    saat: zaman.saat,
    veriyolu,
    gunluk,
  } as unknown as PlanlarBagimliliklari;
  const planlar = planlarKur(b);

  const oner = async (taslak: Record<string, unknown>, profil: IsProfili = "tam", sohbet: SohbetSecimi = ANA) => {
    const s = await planlar.planOner(taslak as never, profil, sohbet);
    assert.equal(s.ok, true, "plan onerisi basarili olmali");
    if (!s.ok) throw new Error("olmaz");
    return s.deger;
  };
  const karar = (plan_id: string, plan_hash: string, k: "onay" | "ret" = "onay") =>
    planlar.karar({
      v: SOHBET_SURUMU,
      type: "plan_decision",
      client_msg_id: "c1",
      plan_id,
      plan_hash,
      karar: k,
    } as unknown as PlanDecisionMesaji);
  const izinVer = (plan_id: string, plan_hash: string, grant_id = "g1"): IzinKaydi => {
    const izin: IzinKaydi = { grant_id, plan_id, plan_hash, mod: "oku", uygulamalar: ["com.ornek.uygulama"] };
    izinler.set(`${plan_id}|${plan_hash}`, izin);
    return izin;
  };
  const kirliIs = (
    plan_id: string,
    kirli: boolean,
    ek: { pid?: number | null; bitis_ms?: number | null; olusturma_ms?: number | null; durum?: string; sohbet?: SohbetSecimi } = {},
  ): IsNo =>
    depo.isEkle({
      sohbet_id: (ek.sohbet ?? ANA).sohbet_id,
      plan_id,
      plan_hash: SAHTE_HASH,
      baslik: "x",
      tur: "pc",
      cwd: PC_CWD,
      durum: ek.durum ?? "tamamlandi",
      kirli,
      session_id: "s",
      pid: ek.pid ?? null,
      olusturma_ms: ek.olusturma_ms === undefined ? zaman.simdi() : ek.olusturma_ms,
      baslangic_ms: zaman.simdi(),
      bitis_ms: ek.bitis_ms ?? null,
      out_ofset: 0,
      rapor: null,
      rapor_kaynak: null,
      son_result: null,
      durdurma: null,
    } as unknown as Omit<IsKaydi, "is_id">);
  return {
    planlar, depo, veriyolu, zaman, gunluk, durum, nesiller, baslatmalar, izinler, geriCekmeler, geriCekNedenleri, olaylar,
    oner, karar, izinVer, kirliIs,
  };
};

describe("planlar: plan_oner", () => {
  it("kart doğurur, iş başlatmaz, plan_proposed yazar", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    assert.equal(PlanOnerCikti.safeParse(c).success, true);
    assert.deepEqual(
      { durum: c.durum, neden: c.neden, is_id: c.is_id },
      { durum: "onay_bekliyor", neden: "tam_yetki_kapali", is_id: undefined },
    );
    assert.equal(t.baslatmalar.length, 0);
    const kayit = t.depo.planGetir(c.plan_id);
    assert.equal(kayit?.durum, "bekliyor");
    assert.equal(kayit?.plan_hash, c.plan_hash);
    assert.equal(planHash(kayit!.plan), c.plan_hash);
    assert.equal(t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_proposed").length, 1);
    assert.equal(t.olaylar.filter((o) => o.ad === "plan_onerildi").length, 1);
  });

  it("telefon planı da iş başlatmaz; dönüş telefonda_baslatiliyor (tam yetki ve insan turu fark etmez)", async () => {
    for (const sec of [{}, { tamYetki: () => true, insanTuru: () => "tur-1" }]) {
      const t = kur(sec);
      const c = await t.oner(telefonTaslak());
      assert.equal(t.baslatmalar.length, 0);
      assert.equal(PlanOnerCikti.safeParse(c).success, true);
      assert.equal(c.durum, "telefonda_baslatiliyor");
      assert.equal(c.is_id, undefined);
      assert.equal(c.neden, undefined);
    }
  });

  it("plan_id servisindir ve her planda farklıdır", async () => {
    const t = kur();
    const a = await t.oner(pcTaslak());
    const b = await t.oner(pcTaslak());
    assert.notEqual(a.plan_id, b.plan_id);
  });

  it("ana oturum kirli_kaynak ya da plan_id veremez: şema reddeder", () => {
    assert.equal(PlanTaslagi.safeParse(pcTaslak({ kirli_kaynak: [1] })).success, false);
    assert.equal(PlanTaslagi.safeParse(pcTaslak({ plan_id: "plan-x" })).success, false);
  });

  it("pc planında cwd yoksa plan_gecersiz, kayıt yok", async () => {
    const t = kur({ dizinler: [] });
    const s = await t.planlar.planOner(pcTaslak() as never, "tam", ANA);
    assert.deepEqual(s.ok, false);
    if (!s.ok) assert.equal(s.code, "plan_gecersiz");
    assert.equal(t.depo.bekleyenPlanlar().length, 0);
    assert.equal(t.olaylar.length, 0);
  });

  it("şemaya uymayan taslak plan_gecersiz", async () => {
    const t = kur();
    for (const kotu of [
      pcTaslak({ cwd: "goreli\\yol" }),
      // 0.5.0: eski plan anahtarları katı şemada geçersiz.
      pcTaslak({ kesin_yapilacaklar: ["Birinci madde"] }),
      pcTaslak({ kesin_yapilmayacaklar: [] }),
      telefonTaslak({ kesin_yapilacaklar: ["Uygulamayi oku"], kesin_yapilmayacaklar: [] }),
      pcTaslak({ gorev_metni: "x".repeat(30_001) }),
      telefonTaslak({ telefon_izin_istegi: undefined }),
    ]) {
      const s = await t.planlar.planOner(kotu as never, "tam", ANA);
      assert.equal(s.ok, false);
      if (!s.ok) assert.equal(s.code, "plan_gecersiz");
    }
    assert.equal(t.depo.bekleyenPlanlar().length, 0);
  });
});

describe("planlar: kirli_kaynak", () => {
  it("temiz bağlamda alan hiç yazılmaz", async () => {
    const t = kur();
    const temiz = t.kirliIs("p-temiz", false);
    const c = await t.oner(pcTaslak({ dayandigi_isler: [temiz] }));
    const plan = t.depo.planGetir(c.plan_id)!.plan;
    assert.equal("kirli_kaynak" in plan, false);
    assert.equal("dayandigi_isler" in plan, false);
  });

  it("dayandığı kirli işler girer, temiz ve olmayan işler girmez", async () => {
    const t = kur();
    const kirli = t.kirliIs("p1", true);
    const temiz = t.kirliIs("p2", false);
    const c = await t.oner(pcTaslak({ dayandigi_isler: [kirli, temiz, 9999] }));
    assert.deepEqual(t.depo.planGetir(c.plan_id)!.plan.kirli_kaynak, [kirli]);
  });

  it("kirli_okundu sonraki nesilde de geçerli, sonrasında düşer", async () => {
    const t = kur({ nesil: 3 });
    // Önceki nesil sohbetin nesil kayıtlarından bulunur (v3): 3, 4 ve 5 ana'nın nesilleridir.
    for (const nesil of [3, 4, 5]) {
      t.depo.nesilEkle({
        nesil,
        sohbet_id: ANA_SOHBET_ID,
        session_id: `s${nesil}`,
        baslangic_ms: t.zaman.simdi(),
        bitis_ms: null,
        ozet_kabul: null,
        pid: null,
        olusturma_ms: null,
        son_dolu: null,
        pencere: null,
      } as never);
    }
    const is = t.kirliIs("p1", true);
    t.veriyolu.yayinla("kirli_okundu", { is_id: is, sohbet_id: ANA_SOHBET_ID });
    const ayniNesil = await t.oner(pcTaslak());
    assert.deepEqual(t.depo.planGetir(ayniNesil.plan_id)!.plan.kirli_kaynak, [is]);
    t.durum.nesil = 4;
    const sonraki = await t.oner(pcTaslak());
    assert.deepEqual(t.depo.planGetir(sonraki.plan_id)!.plan.kirli_kaynak, [is]);
    t.durum.nesil = 5;
    const eski = await t.oner(pcTaslak());
    assert.equal("kirli_kaynak" in t.depo.planGetir(eski.plan_id)!.plan, false);
  });

  it("birleşim yinelenmesiz ve yeniden eskiye sıralı", async () => {
    const t = kur({ nesil: 2 });
    const a = t.kirliIs("p1", true);
    const b = t.kirliIs("p2", true);
    const c = t.kirliIs("p3", true);
    t.veriyolu.yayinla("kirli_okundu", { is_id: a, sohbet_id: ANA_SOHBET_ID });
    t.zaman.ilerlet(1000);
    t.veriyolu.yayinla("kirli_okundu", { is_id: b, sohbet_id: ANA_SOHBET_ID });
    const o = await t.oner(pcTaslak({ dayandigi_isler: [a, c] }));
    const kk = t.depo.planGetir(o.plan_id)!.plan.kirli_kaynak!;
    assert.equal(new Set(kk).size, kk.length);
    assert.deepEqual([...kk].sort((x, y) => x - y), [a, b, c]);
    assert.deepEqual(kk, [...kk].sort((x, y) => y - x));
  });

  it("taşmada en çok 32 kalır, en yeniler tutulur ve günlüğe yazılır", async () => {
    const t = kur({ nesil: 2 });
    const idler: IsNo[] = [];
    for (let i = 0; i < 40; i++) idler.push(t.kirliIs(`p${i}`, true));
    for (const id of idler) {
      t.zaman.ilerlet(10);
      t.veriyolu.yayinla("kirli_okundu", { is_id: id, sohbet_id: ANA_SOHBET_ID });
    }
    const girdiOnce = t.gunluk.girdiler.length;
    const o = await t.oner(pcTaslak());
    const kk = t.depo.planGetir(o.plan_id)!.plan.kirli_kaynak!;
    assert.equal(kk.length, 32);
    assert.deepEqual(new Set(kk), new Set(idler.slice(8)));
    assert.ok(t.gunluk.girdiler.length > girdiOnce, "atılan kayıt günlüğe yazılmalı");
  });

  it("dayandigi_isler ile okumalar birlikte 32'yi aşarsa yine 32", async () => {
    const t = kur({ nesil: 2 });
    const dayanan: IsNo[] = [];
    for (let i = 0; i < 32; i++) dayanan.push(t.kirliIs(`d${i}`, true));
    const okunan = t.kirliIs("o", true);
    t.veriyolu.yayinla("kirli_okundu", { is_id: okunan, sohbet_id: ANA_SOHBET_ID });
    const o = await t.oner(pcTaslak({ dayandigi_isler: dayanan }));
    assert.equal(t.depo.planGetir(o.plan_id)!.plan.kirli_kaynak!.length, 32);
  });
});

describe("planlar: karar, hash doğrulaması", () => {
  it("bilinmeyen plan: plan_bulunamadi", async () => {
    const t = kur();
    const s = await t.karar("yok", SAHTE_HASH);
    assert.deepEqual(s, { ok: false, code: "plan_bulunamadi" });
    assert.equal(t.baslatmalar.length, 0);
  });

  it("hash farklıysa plan_hash_uyusmuyor, plan değişmez, başlamaz", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    const s = await t.karar(c.plan_id, SAHTE_HASH);
    assert.equal(s.ok, false);
    if (!s.ok) assert.equal(s.code, "plan_hash_uyusmuyor");
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
    assert.equal(t.baslatmalar.length, 0);
    // yanlış hash ile ret de işlemez
    const r = await t.karar(c.plan_id, SAHTE_HASH, "ret");
    assert.equal(r.ok === false && r.code, "plan_hash_uyusmuyor");
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
  });

  it("hash sorgusu sonuçlanmış plandan önce gelir", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    await t.karar(c.plan_id, c.plan_hash, "ret");
    const s = await t.karar(c.plan_id, SAHTE_HASH);
    assert.equal(s.ok === false && s.code, "plan_hash_uyusmuyor");
  });

  it("depodaki metin hash'ine uymuyorsa başlatmaz", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    const asil = t.depo.planGetir(c.plan_id)!;
    // Aynı plan_id altında, hash'i planla örtüşmeyen kayıt: depo metni değişmiş gibi.
    const t2 = kur();
    t2.depo.planEkle({ ...asil, plan_hash: SAHTE_HASH });
    const s = await t2.karar(asil.plan.plan_id, SAHTE_HASH);
    assert.equal(s.ok, false);
    if (!s.ok) assert.equal(s.code, "ic_hata");
    assert.equal(t2.baslatmalar.length, 0);
    assert.equal(t2.depo.planGetir(asil.plan.plan_id)!.durum, "bekliyor");
  });

  it("başlatılan istek depodaki planın kendisidir ve hash'i taşır", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok, true);
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.baslatmalar[0]!.plan_hash, c.plan_hash);
    assert.deepEqual(t.baslatmalar[0]!.plan, t.depo.planGetir(c.plan_id)!.plan);
  });
});

describe("planlar: pc kararı", () => {
  it("onay işi başlatır, plan onaylandi olur, plan_resolved is_id ile yazılır", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok, true);
    const kayit = t.depo.planGetir(c.plan_id)!;
    assert.equal(kayit.durum, "onaylandi");
    assert.equal(kayit.is_id, 101);
    const cozum = t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved");
    assert.equal(cozum.length, 1);
    assert.equal((cozum[0] as { sonuc: string }).sonuc, "onaylandi");
    assert.equal((cozum[0] as { is_id?: number }).is_id, 101);
    const sonuc = t.olaylar.find((o) => o.ad === "plan_sonuclandi")!.veri as { sonuc: string; is_id?: number };
    assert.equal(sonuc.sonuc, "onaylandi");
    assert.equal(sonuc.is_id, 101);
  });

  it("ret reddedildi yazar ve başlatmaz", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    const s = await t.karar(c.plan_id, c.plan_hash, "ret");
    assert.equal(s.ok, true);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "reddedildi");
    assert.equal(t.baslatmalar.length, 0);
    const cozum = t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved");
    assert.equal((cozum[0] as { sonuc: string }).sonuc, "reddedildi");
  });

  it("ikinci karar plan_zaten_sonuclandi, ikinci iş yok (onaylandi, reddedildi)", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    const ikinci = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(ikinci.ok === false && ikinci.code, "plan_zaten_sonuclandi");
    assert.equal(t.baslatmalar.length, 1);

    const d = await t.oner(pcTaslak());
    await t.karar(d.plan_id, d.plan_hash, "ret");
    for (const k of ["onay", "ret"] as const) {
      const s = await t.karar(d.plan_id, d.plan_hash, k);
      assert.equal(s.ok === false && s.code, "plan_zaten_sonuclandi");
    }
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved").length, 2);
  });

  it("iptal edilmiş plana karar plan_zaten_sonuclandi", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    t.depo.planGuncelle(c.plan_id, "iptal", null);
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "plan_zaten_sonuclandi");
    assert.equal(t.baslatmalar.length, 0);
  });

  it("eşzamanlı iki onay tek iş başlatır", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    const [a, b] = await Promise.all([t.karar(c.plan_id, c.plan_hash), t.karar(c.plan_id, c.plan_hash)]);
    assert.equal(t.baslatmalar.length, 1);
    assert.equal([a, b].filter((s) => s.ok).length, 1);
  });

  it("başlatma hatası ic_hata, plan bekliyor kalır, plan_resolved yok, yeniden denenebilir", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    t.durum.baslatHata = true;
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "ic_hata");
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
    assert.equal(t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved").length, 0);
    t.durum.baslatHata = false;
    const yeniden = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(yeniden.ok, true);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
  });
});

describe("planlar: kilitli dallar", () => {
  it("kilit aktifken onay limit_kilitli, plan bekler, başlatılmaz", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    t.durum.serbest = false;
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "limit_kilitli");
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
    assert.equal(t.baslatmalar.length, 0);
    t.durum.serbest = true;
    assert.equal((await t.karar(c.plan_id, c.plan_hash)).ok, true);
    assert.equal(t.baslatmalar.length, 1);
  });

  it("kilit aktifken ret yine de işler", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    t.durum.serbest = false;
    const s = await t.karar(c.plan_id, c.plan_hash, "ret");
    assert.equal(s.ok, true);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "reddedildi");
  });

  it("kilit aktifken telefon planı onayı izin olsa bile limit_kilitli", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    t.izinVer(c.plan_id, c.plan_hash);
    t.durum.serbest = false;
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "limit_kilitli");
    assert.equal(t.baslatmalar.length, 0);
  });

  it("kilit aktifken gelen izin_geldi başlatmaz", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "izin_bekleniyor");
    t.durum.serbest = false;
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 0);
    assert.notEqual(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
  });
});

describe("planlar: telefon planı ve iki izin sırası", () => {
  it("izin karardan önce gelmişse onay anında başlar", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    t.izinVer(c.plan_id, c.plan_hash);
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok, true);
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
  });

  it("izin yoksa izin_bekleniyor döner, durum izin_bekliyor, karar kayıtlıdır, başlamaz", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "izin_bekleniyor");
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "izin_bekliyor");
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved").length, 0);
  });

  it("izin sonradan gelince aynı plan_id ve plan_hash ile başlar", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.baslatmalar[0]!.plan_hash, c.plan_hash);
    assert.equal(t.baslatmalar[0]!.plan.plan_id, c.plan_id);
    const kayit = t.depo.planGetir(c.plan_id)!;
    assert.equal(kayit.durum, "onaylandi");
    assert.equal(kayit.is_id, 101);
    const cozum = t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved");
    assert.equal(cozum.length, 1);
    assert.equal((cozum[0] as { is_id?: number }).is_id, 101);
  });

  it("karar yokken gelen izin başlatmaz", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
  });

  it("farklı plan_hash'li ya da başka plan_id'li izin başlatmaz", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, SAHTE_HASH) });
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer("baska-plan", c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "izin_bekliyor");
  });

  it("izin_bekliyor iken izin_gitti planı bekliyor'a döndürür; sonra yeni karar çalışır", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    t.veriyolu.yayinla("izin_gitti", { grant_id: "g1", plan_id: c.plan_id, neden: "suresi_bitti" });
    await bosalt();
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
    assert.equal(t.baslatmalar.length, 0);
    // geri dönen plan yeniden onaylanabilir
    t.izinVer(c.plan_id, c.plan_hash);
    assert.equal((await t.karar(c.plan_id, c.plan_hash)).ok, true);
    assert.equal(t.baslatmalar.length, 1);
  });

  it("izin_gitti sonuçlanmış planı bozmaz", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    t.izinVer(c.plan_id, c.plan_hash);
    await t.karar(c.plan_id, c.plan_hash);
    t.veriyolu.yayinla("izin_gitti", { grant_id: "g1", plan_id: c.plan_id, neden: "is_bitti" });
    await bosalt();
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
  });

  it("izin_bekliyor durumundaki plana tekrar onay izin yoksa yine izin_bekleniyor, ret çalışır", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    const yine = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(yine.ok === false && yine.code, "izin_bekleniyor");
    assert.equal(t.baslatmalar.length, 0);
    const ret = await t.karar(c.plan_id, c.plan_hash, "ret");
    assert.equal(ret.ok, true);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "reddedildi");
  });

  it("izin_bekleniyor sonrası izin gelip başlayan planda ikinci karar plan_zaten_sonuclandi", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "plan_zaten_sonuclandi");
    assert.equal(t.baslatmalar.length, 1);
  });

  it("izin bekleyen planda izin gelirken başlatma hatası planı bekletir", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    t.durum.baslatHata = true;
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    const d = t.depo.planGetir(c.plan_id)!.durum;
    assert.ok(d === "bekliyor" || d === "izin_bekliyor", `beklenmeyen durum: ${d}`);
    assert.equal(t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved").length, 0);
  });
});

describe("planlar: kapat", () => {
  it("kapattıktan sonra olaylar işlenmez", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    t.planlar.kapat();
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 0);
  });
});

describe("planlar: işi olan plan (regresyon)", () => {
  const cozumSayisi = (t: ReturnType<typeof kur>): number =>
    t.depo.olaylariGetir(0, 100).filter((o) => o.type === "plan_resolved").length;

  it("işi varken onay ok:true, ret plan_zaten_sonuclandi; baslat yok, plan onaylandi, plan_resolved bir kez", async () => {
    for (const karar of ["onay", "ret"] as const) {
      const t = kur();
      const c = await t.oner(pcTaslak());
      t.kirliIs(c.plan_id, false, { pid: 4242 });
      const s = await t.karar(c.plan_id, c.plan_hash, karar);
      if (karar === "onay") assert.equal(s.ok, true);
      else assert.equal(s.ok === false && s.code, "plan_zaten_sonuclandi");
      assert.equal(t.baslatmalar.length, 0);
      assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
      assert.equal(cozumSayisi(t), 1);
      // tekrar karar yeni olay yazmaz
      await t.karar(c.plan_id, c.plan_hash, karar);
      assert.equal(cozumSayisi(t), 1);
    }
  });

  it("kilit aktifken de aynı", async () => {
    for (const karar of ["onay", "ret"] as const) {
      const t = kur();
      const c = await t.oner(pcTaslak());
      t.kirliIs(c.plan_id, false, { pid: 4242 });
      t.durum.serbest = false;
      const s = await t.karar(c.plan_id, c.plan_hash, karar);
      if (karar === "onay") assert.equal(s.ok, true);
      else assert.equal(s.ok === false && s.code, "plan_zaten_sonuclandi");
      assert.equal(t.baslatmalar.length, 0);
      assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
      assert.equal(cozumSayisi(t), 1);
    }
  });

  it("telefon planında izin yokken de aynı", async () => {
    for (const karar of ["onay", "ret"] as const) {
      const t = kur();
      const c = await t.oner(telefonTaslak());
      t.kirliIs(c.plan_id, true, { pid: 4242 });
      const s = await t.karar(c.plan_id, c.plan_hash, karar);
      if (karar === "onay") assert.equal(s.ok, true);
      else assert.equal(s.ok === false && s.code, "plan_zaten_sonuclandi");
      assert.equal(t.baslatmalar.length, 0);
      assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
      assert.equal(cozumSayisi(t), 1);
    }
  });

  it("tek işi pid:null ve bitmişse (süreç hiç açılmadı) yeniden onay iş başlatır", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    t.kirliIs(c.plan_id, false, { pid: null, olusturma_ms: null, bitis_ms: 1_700_000_000_500 });
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok, true);
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
    assert.equal(cozumSayisi(t), 1);
  });

  it("pid:null ama olusturma_ms dolu, bitmiş işte (durum tamam dahil) onay yeni iş açmaz, plan o işle sonuçlanır", async () => {
    for (const durum of ["tamam", "hata"]) {
      const t = kur();
      const c = await t.oner(pcTaslak());
      const is = t.kirliIs(c.plan_id, false, { pid: null, olusturma_ms: 1_700_000_000_100, bitis_ms: 1_700_000_000_500, durum });
      const s = await t.karar(c.plan_id, c.plan_hash);
      assert.equal(s.ok, true);
      assert.equal(t.baslatmalar.length, 0);
      const k = t.depo.planGetir(c.plan_id)!;
      assert.equal(k.durum, "onaylandi");
      assert.equal(k.is_id, is);
      assert.equal(cozumSayisi(t), 1);
    }
  });

  it("kesin açılmamış işten sonra yeniden onay iş açar; aynı karar tekrarı ikinci iş açmaz", async () => {
    const t = kur();
    const c = await t.oner(pcTaslak());
    t.kirliIs(c.plan_id, false, { pid: null, olusturma_ms: null, bitis_ms: 1_700_000_000_500 });
    assert.equal((await t.karar(c.plan_id, c.plan_hash)).ok, true);
    assert.equal(t.baslatmalar.length, 1);
    const tekrar = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(tekrar.ok === false && tekrar.code, "plan_zaten_sonuclandi");
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(cozumSayisi(t), 1);
  });

  it("isler_uzlastirildi işi olan bekleyen planı sonuçlandırır; ikinci olay yeni olay yazmaz", async () => {
    const t = kur();
    const isli = await t.oner(pcTaslak());
    const isiz = await t.oner(pcTaslak());
    const telefon = await t.oner(telefonTaslak());
    const is = t.kirliIs(isli.plan_id, false, { pid: 4242 });
    await t.karar(telefon.plan_id, telefon.plan_hash); // izin_bekliyor
    t.kirliIs(telefon.plan_id, true, { pid: 4243 });
    t.veriyolu.yayinla("isler_uzlastirildi", { sahiplenilen: 1, biten: 0, sohbetler: {} });
    const k = t.depo.planGetir(isli.plan_id)!;
    assert.equal(k.durum, "onaylandi");
    assert.equal(k.is_id, is);
    assert.equal(t.depo.planGetir(telefon.plan_id)!.durum, "onaylandi");
    assert.equal(t.depo.planGetir(isiz.plan_id)!.durum, "bekliyor");
    assert.equal(cozumSayisi(t), 2);
    t.veriyolu.yayinla("isler_uzlastirildi", { sahiplenilen: 0, biten: 0, sohbetler: {} });
    assert.equal(cozumSayisi(t), 2);
    assert.equal(t.baslatmalar.length, 0);
  });
});

describe("planlar: komut satırı sınırı (regresyon)", () => {
  it("tırnak ağırlıklı görev: ham uzunluk sığar, kaçış sonrası aşar; plan_gecersiz, detail gorev_metni", async () => {
    const t = kur();
    // Ham 20.000 birim (şema sınırı, geçerli); kaçış sonrası 30.002, bütçe ~27.000.
    const taslak = pcTaslak({ gorev_metni: 'a"'.repeat(10_000) });
    assert.equal(PlanTaslagi.safeParse(taslak).success, true, "şemaya uyar: ret komut satırı sınırından");
    const s = await t.planlar.planOner(taslak as never, "tam", ANA);
    assert.equal(s.ok, false);
    if (!s.ok) {
      assert.equal(s.code, "plan_gecersiz");
      assert.equal(s.detail, "gorev_metni");
    }
    assert.equal(t.depo.bekleyenPlanlar().length, 0);
  });

  it("normal boyutta plan kabul edilir", async () => {
    const t = kur();
    const s = await t.planlar.planOner(pcTaslak({ gorev_metni: 'ab "'.repeat(100) }) as never, "tam", ANA);
    assert.equal(s.ok, true);
  });

  it("şema sınırında tırnaklı görev (ham 20.000, kaçış sonrası 25.002) kabul edilir", async () => {
    const t = kur();
    const s = await t.planlar.planOner(pcTaslak({ gorev_metni: 'ab "'.repeat(5000) }) as never, "tam", ANA);
    assert.equal(s.ok, true);
  });
});

describe("planlar: insan turunda onaysız başlatma", () => {
  const resolvedlar = (t: ReturnType<typeof kur>) =>
    t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved");

  it("PC planı tek isler.baslat çağırır, olay sırası plan_proposed sonra plan_resolved, plan onaylandı", async () => {
    const t = kur({ insanTuru: () => "tur-1" });
    const c = await t.oner(pcTaslak());
    assert.equal(PlanOnerCikti.safeParse(c).success, true);
    assert.equal(c.durum, "basladi");
    assert.equal(c.neden, undefined);
    assert.equal(c.is_id, t.depo.planGetir(c.plan_id)?.is_id, "dönüşteki is_id başlayan iş");
    assert.equal(t.baslatmalar.length, 1);
    const tipler = t.depo.olaylariGetir(0, 50).map((o) => o.type).filter((x) => x.startsWith("plan_"));
    assert.deepEqual(tipler, ["plan_proposed", "plan_resolved"]);
    const coz = resolvedlar(t)[0] as unknown as { sonuc: string; is_id: number };
    assert.equal(coz.sonuc, "onaylandi");
    assert.equal(t.depo.planGetir(c.plan_id)?.durum, "onaylandi");
    assert.equal(t.depo.planGetir(c.plan_id)?.is_id, coz.is_id);
    const k = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(k.ok, false);
    if (!k.ok) assert.equal(k.code, "plan_zaten_sonuclandi");
    assert.equal(t.baslatmalar.length, 1);
  });

  it("telefon planı başlamaz", async () => {
    const t = kur({ insanTuru: () => "tur-1" });
    await t.oner(telefonTaslak());
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(resolvedlar(t).length, 0);
  });

  it("kilitliyken başlamaz, plan bekliyor kalır", async () => {
    const t = kur({ insanTuru: () => "tur-1" });
    t.durum.serbest = false;
    const c = await t.oner(pcTaslak());
    assert.equal(c.durum, "onay_bekliyor");
    assert.equal(c.neden, "limit_kilitli");
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(c.plan_id)?.durum, "bekliyor");
    assert.equal(resolvedlar(t).length, 0);
  });

  it("başlatma hatasında öneri başarılı, plan bekliyor, plan_resolved yok", async () => {
    const t = kur({ insanTuru: () => "tur-1" });
    t.durum.baslatHata = true;
    const c = await t.oner(pcTaslak());
    assert.equal(c.durum, "onay_bekliyor");
    assert.equal(c.neden, "baslatma_hatasi");
    assert.equal(t.depo.planGetir(c.plan_id)?.durum, "bekliyor");
    assert.equal(resolvedlar(t).length, 0);
  });

  for (const [ad, sonraki] of [["null", null], ["başka turn_id", "tur-2"]] as const) {
    it(`başlatmadan önce insanTuru ${ad} verirse başlamaz`, async () => {
      let n = 0;
      const t = kur({ insanTuru: () => (n++ === 0 ? "tur-1" : sonraki) });
      const c = await t.oner(pcTaslak());
      assert.equal(c.durum, "onay_bekliyor");
      assert.equal(c.neden, "tur_bitti");
      assert.equal(t.baslatmalar.length, 0);
      assert.equal(t.depo.planGetir(c.plan_id)?.durum, "bekliyor");
      assert.equal(resolvedlar(t).length, 0);
    });
  }

  it("insanTuru atarsa ya da verilmezse kart kalır", async () => {
    const atan = kur({
      insanTuru: () => {
        throw new Error("x");
      },
    });
    const c1 = await atan.oner(pcTaslak());
    assert.deepEqual([c1.durum, c1.neden], ["onay_bekliyor", "tam_yetki_kapali"]);
    assert.equal(atan.baslatmalar.length, 0);
    assert.equal(atan.depo.planGetir(c1.plan_id)?.durum, "bekliyor");
    const yok = kur();
    const c2 = await yok.oner(pcTaslak());
    assert.equal(yok.baslatmalar.length, 0);
    assert.equal(yok.depo.planGetir(c2.plan_id)?.durum, "bekliyor");
  });

  it("kirli_kaynak dolu plan insan turunda başlamaz", async () => {
    const t = kur({ insanTuru: () => "tur-1" });
    const kirli = t.kirliIs("p-kirli", true);
    const c = await t.oner(pcTaslak({ dayandigi_isler: [kirli] }));
    assert.deepEqual(t.depo.planGetir(c.plan_id)?.plan.kirli_kaynak, [kirli]);
    assert.deepEqual([c.durum, c.neden], ["onay_bekliyor", "kirli_kaynak"]);
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(c.plan_id)?.durum, "bekliyor");
    assert.equal(resolvedlar(t).length, 0);
  });
});

describe("planlar: tam yetki (Dilim 3b)", () => {
  const resolvedlar = (t: ReturnType<typeof kur>) =>
    t.depo.olaylariGetir(0, 50).filter((o) => o.type === "plan_resolved") as unknown as Array<{
      plan_id: string;
      sonuc: string;
      is_id?: number;
    }>;
  const sonuclandiYayinlari = (t: ReturnType<typeof kur>) => t.olaylar.filter((o) => o.ad === "plan_sonuclandi");

  for (const [ad, insanTuru] of [
    ["insanTuru null (sentetik tur)", () => null],
    ["insanTuru verilmemiş", undefined],
  ] as const) {
    it(`sentetik turdaki PC planı karar beklemeden başlar (${ad})`, async () => {
      const t = kur({ tamYetki: () => true, ...(insanTuru !== undefined ? { insanTuru } : {}) });
      const c = await t.oner(pcTaslak(), "hafif");
      assert.equal(c.durum, "basladi");
      assert.equal(c.is_id, t.depo.planGetir(c.plan_id)?.is_id);
      assert.ok(c.is_id !== undefined);
      assert.equal(t.baslatmalar.length, 1);
      assert.equal(t.baslatmalar[0]!.plan_hash, c.plan_hash);
      assert.equal(t.baslatmalar[0]!.profil, "hafif");
      const kayit = t.depo.planGetir(c.plan_id)!;
      assert.equal(kayit.durum, "onaylandi");
      const tipler = t.depo.olaylariGetir(0, 50).map((o) => o.type).filter((x) => x.startsWith("plan_"));
      assert.deepEqual(tipler, ["plan_proposed", "plan_resolved"]);
      const coz = resolvedlar(t);
      assert.equal(coz[0]!.sonuc, "onaylandi");
      assert.equal(coz[0]!.is_id, kayit.is_id);
      assert.equal(sonuclandiYayinlari(t).length, 1);
      // Sonraki karar yeni iş açmaz.
      const k = await t.karar(c.plan_id, c.plan_hash);
      assert.equal(k.ok === false && k.code, "plan_zaten_sonuclandi");
      assert.equal(t.baslatmalar.length, 1);
    });
  }

  it("başka sohbetin insan turu sürerken bu sohbetin PC planı da başlar", async () => {
    const t = kur({ tamYetki: () => true, insanTuru: (s) => (s.sohbet_id === A_ID ? "tur-A" : null) });
    const c = await t.oner(pcTaslak(), "tam", B);
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.baslatmalar[0]!.sohbet_id, B_ID);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
  });

  for (const [ad, insanTuru] of [
    ["sentetik turda", () => null],
    ["insan turunda", () => "tur-1"],
  ] as const) {
    it(`kirli kaynaklı PC planı ${ad} başlar; kirli_kaynak plana ve hash'e yazılır`, async () => {
      const t = kur({ tamYetki: () => true, insanTuru, nesil: 2 });
      const dayanilan = t.kirliIs("p-kirli", true);
      const okunan = t.kirliIs("p-okunan", true);
      t.veriyolu.yayinla("kirli_okundu", { is_id: okunan, sohbet_id: ANA_SOHBET_ID });
      const c = await t.oner(pcTaslak({ dayandigi_isler: [dayanilan] }));
      const kayit = t.depo.planGetir(c.plan_id)!;
      assert.deepEqual(kayit.plan.kirli_kaynak, [okunan, dayanilan]);
      assert.equal(planHash(kayit.plan), c.plan_hash);
      assert.equal(t.baslatmalar.length, 1);
      assert.deepEqual(t.baslatmalar[0]!.plan.kirli_kaynak, [okunan, dayanilan]);
      assert.equal(kayit.durum, "onaylandi");
      assert.equal(resolvedlar(t).length, 1);
      const iz = t.gunluk.bul("onaysiz_basladi", "bilgi");
      assert.equal(iz.length, 1);
      assert.equal(iz[0]!.alanlar?.["tam_yetki"], true);
      assert.equal(iz[0]!.alanlar?.["kirli"], true);
    });
  }

  for (const [ad, sonraki] of [["null (kesildi)", null], ["başka turn_id", "tur-2"]] as const) {
    it(`tam yetkide başlatmadan önce insan turu ${ad} ise plan başlamaz, kart kalır`, async () => {
      let n = 0;
      const t = kur({ tamYetki: () => true, insanTuru: () => (n++ === 0 ? "tur-1" : sonraki) });
      const c = await t.oner(pcTaslak());
      assert.equal(c.durum, "onay_bekliyor");
      assert.equal(c.neden, "tur_bitti");
      assert.equal(t.baslatmalar.length, 0);
      assert.equal(t.depo.planGetir(c.plan_id)?.durum, "bekliyor");
      assert.equal(resolvedlar(t).length, 0);
    });
  }

  it("telefon planı yine telefondan izin bekler", async () => {
    const t = kur({ tamYetki: () => true, insanTuru: () => "tur-1" });
    const c = await t.oner(telefonTaslak());
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
    assert.equal(resolvedlar(t).length, 0);
    // Karar yokken gelen izin başlatmaz; bugünkü gibi karar + izin gerekir.
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 0);
    t.izinler.clear();
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "izin_bekleniyor");
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "izin_bekliyor");
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "onaylandi");
  });

  it("kilitliyken başlamaz, plan bekliyor kalır; kilit açılınca karar başlatır", async () => {
    const t = kur({ tamYetki: () => true });
    t.durum.serbest = false;
    const kirli = t.kirliIs("p-kirli", true);
    const temiz = await t.oner(pcTaslak());
    const kirliPlan = await t.oner(pcTaslak({ dayandigi_isler: [kirli] }));
    assert.equal(t.baslatmalar.length, 0);
    for (const c of [temiz, kirliPlan]) assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
    assert.equal(resolvedlar(t).length, 0);
    assert.equal(sonuclandiYayinlari(t).length, 0);
    const uyari = t.gunluk.bul("onaysiz_baslatilamadi", "uyari");
    assert.equal(uyari.length, 2);
    assert.equal(uyari[0]!.alanlar?.["code"], "limit_kilitli");
    t.durum.serbest = true;
    assert.equal((await t.karar(temiz.plan_id, temiz.plan_hash)).ok, true);
    assert.equal(t.baslatmalar.length, 1);
  });

  it("başlatma hatasında öneri başarılı, kart kalır, plan_resolved yok", async () => {
    const t = kur({ tamYetki: () => true });
    t.durum.baslatHata = true;
    const c = await t.oner(pcTaslak());
    assert.equal(c.durum, "onay_bekliyor");
    assert.equal(c.neden, "baslatma_hatasi");
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "bekliyor");
    assert.equal(resolvedlar(t).length, 0);
  });

  it("anahtar her öneride okunur: çalışırken açılıp kapanabilir", async () => {
    let acik = false;
    let okuma = 0;
    const t = kur({
      tamYetki: () => {
        okuma++;
        return acik;
      },
    });
    const once = await t.oner(pcTaslak());
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(once.plan_id)!.durum, "bekliyor");
    acik = true;
    const sonra = await t.oner(pcTaslak());
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.depo.planGetir(sonra.plan_id)!.durum, "onaylandi");
    acik = false;
    const kapali = await t.oner(pcTaslak());
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.depo.planGetir(kapali.plan_id)!.durum, "bekliyor");
    assert.equal(okuma, 3);
  });

  it("anahtar atarsa ya da true dışında değer verirse kapalı sayılır", async () => {
    const atan = kur({
      tamYetki: () => {
        throw new Error("x");
      },
    });
    const c1 = await atan.oner(pcTaslak());
    assert.deepEqual([c1.durum, c1.neden], ["onay_bekliyor", "tam_yetki_kapali"]);
    assert.equal(atan.baslatmalar.length, 0);
    assert.equal(atan.depo.planGetir(c1.plan_id)!.durum, "bekliyor");
    assert.equal(atan.gunluk.bul("tam_yetki_okunamadi", "hata").length, 1);
    const tuhaf = kur({ tamYetki: (() => "evet") as unknown as () => boolean });
    const c2 = await tuhaf.oner(pcTaslak());
    assert.equal(tuhaf.baslatmalar.length, 0);
    assert.equal(tuhaf.depo.planGetir(c2.plan_id)!.durum, "bekliyor");
  });

  it("kapalıyken bugünkü davranış: sentetik ve kirli plan bekler, temiz insan turu planı başlar", async () => {
    const sentetik = kur({ tamYetki: () => false });
    const c1 = await sentetik.oner(pcTaslak());
    assert.equal(sentetik.baslatmalar.length, 0);
    assert.equal(sentetik.depo.planGetir(c1.plan_id)!.durum, "bekliyor");
    const insan = kur({ tamYetki: () => false, insanTuru: () => "tur-1" });
    const kirli = insan.kirliIs("p-kirli", true);
    const c2 = await insan.oner(pcTaslak({ dayandigi_isler: [kirli] }));
    assert.equal(insan.baslatmalar.length, 0);
    assert.equal(insan.depo.planGetir(c2.plan_id)!.durum, "bekliyor");
    const c3 = await insan.oner(pcTaslak());
    assert.equal(insan.baslatmalar.length, 1);
    assert.equal(insan.depo.planGetir(c3.plan_id)!.durum, "onaylandi");
    assert.equal(insan.gunluk.bul("onaysiz_basladi")[0]!.alanlar?.["tam_yetki"], undefined);
  });
});

describe("planlar: iş profili (Dilim 1, K5)", () => {
  it("pc planında verilen profil PlanKaydi'na yazılır, varsayılan tam", async () => {
    const t = kur();
    const h = await t.oner(pcTaslak(), "hafif");
    const v = await t.oner(pcTaslak());
    assert.equal(t.depo.planGetir(h.plan_id)!.profil, "hafif");
    assert.equal(t.depo.planGetir(v.plan_id)!.profil, "tam");
  });

  it("telefon planında profil hafif verilse de tam yazılır", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak(), "hafif");
    assert.equal(t.depo.planGetir(c.plan_id)!.profil, "tam");
  });

  it("profil plan_hash'e ve plan_proposed olayına girmez", async () => {
    const hafif = kur();
    const a = await hafif.oner(pcTaslak(), "hafif");
    const kayit = hafif.depo.planGetir(a.plan_id)!;
    assert.equal("profil" in kayit.plan, false);
    assert.equal(planHash(kayit.plan), a.plan_hash);
    // aynı plan farklı profille: plan_id dışında içerik özdeş, hash planın kendisinden gelir
    const tam = kur();
    const b = await tam.oner(pcTaslak(), "tam");
    const bPlan = tam.depo.planGetir(b.plan_id)!.plan;
    assert.equal(planHash({ ...kayit.plan, plan_id: bPlan.plan_id }), b.plan_hash);
    const ev = hafif.depo.olaylariGetir(0, 50).find((o) => o.type === "plan_proposed")!;
    assert.equal(JSON.stringify(ev).includes("profil"), false);
  });

  it("karar onayı depodaki profili isler.baslat'a geçirir", async () => {
    for (const profil of ["hafif", "tam"] as const) {
      const t = kur();
      const c = await t.oner(pcTaslak(), profil);
      assert.equal((await t.karar(c.plan_id, c.plan_hash)).ok, true);
      assert.equal(t.baslatmalar.length, 1);
      assert.equal(t.baslatmalar[0]!.profil, profil);
    }
  });

  it("telefon planı izin gelişiyle başlarken profil tam gider", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak(), "hafif");
    await t.karar(c.plan_id, c.plan_hash);
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.baslatmalar[0]!.profil, "tam");
  });

  it("insan turunda otomatik başlatma profili taşır", async () => {
    const t = kur({ insanTuru: () => "tur-1" });
    await t.oner(pcTaslak(), "hafif");
    assert.equal(t.baslatmalar.length, 1);
    assert.equal(t.baslatmalar[0]!.profil, "hafif");
  });
});

describe("planlar: bekleyenleriIptal (Dilim 1)", () => {
  const cozumler = (t: ReturnType<typeof kur>) =>
    t.depo.olaylariGetir(0, 100).filter((o) => o.type === "plan_resolved") as unknown as Array<{
      plan_id: string;
      sonuc: string;
    }>;

  it("bekleyen ve izin bekleyen planları iptal eder, izni geri çeker, sayıyı döner", async () => {
    const t = kur();
    const bekleyen = await t.oner(pcTaslak());
    const izinli = await t.oner(telefonTaslak());
    await t.karar(izinli.plan_id, izinli.plan_hash); // izin_bekliyor
    assert.equal(t.depo.planGetir(izinli.plan_id)!.durum, "izin_bekliyor");
    t.izinVer(izinli.plan_id, izinli.plan_hash, "g-iptal");
    const sonOnce = t.olaylar.filter((o) => o.ad === "plan_sonuclandi").length;

    assert.equal(t.planlar.bekleyenleriIptal(ANA), 2);

    assert.equal(t.depo.planGetir(bekleyen.plan_id)!.durum, "iptal");
    assert.equal(t.depo.planGetir(izinli.plan_id)!.durum, "iptal");
    const c = cozumler(t);
    assert.equal(c.length, 2);
    assert.ok(c.every((o) => o.sonuc === "iptal"));
    assert.deepEqual(new Set(c.map((o) => o.plan_id)), new Set([bekleyen.plan_id, izinli.plan_id]));
    assert.deepEqual(t.geriCekmeler, ["g-iptal"]);
    assert.deepEqual(t.geriCekNedenleri, ["is_iptal"]);
    assert.equal(t.olaylar.filter((o) => o.ad === "plan_sonuclandi").length, sonOnce);
    assert.equal(t.baslatmalar.length, 0);
  });

  it("sonuçlanmış planlara dokunmaz, 0 döner", async () => {
    const t = kur();
    const onay = await t.oner(pcTaslak());
    const ret = await t.oner(pcTaslak());
    await t.karar(onay.plan_id, onay.plan_hash);
    await t.karar(ret.plan_id, ret.plan_hash, "ret");
    const once = cozumler(t).length;
    assert.equal(t.planlar.bekleyenleriIptal(ANA), 0);
    assert.equal(t.depo.planGetir(onay.plan_id)!.durum, "onaylandi");
    assert.equal(t.depo.planGetir(ret.plan_id)!.durum, "reddedildi");
    assert.equal(cozumler(t).length, once);
    assert.equal(t.geriCekmeler.length, 0);
  });

  it("izni olmayan planda izinGeriCek çağrılmaz; ikinci çağrı 0 döner ve olay yazmaz", async () => {
    const t = kur();
    await t.oner(pcTaslak());
    assert.equal(t.planlar.bekleyenleriIptal(ANA), 1);
    assert.equal(t.geriCekmeler.length, 0);
    assert.equal(t.planlar.bekleyenleriIptal(ANA), 0);
    assert.equal(cozumler(t).length, 1);
  });

  it("iptalden sonra karar plan_zaten_sonuclandi, sonra gelen izin başlatmaz", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash);
    t.planlar.bekleyenleriIptal(ANA);
    const s = await t.karar(c.plan_id, c.plan_hash);
    assert.equal(s.ok === false && s.code, "plan_zaten_sonuclandi");
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
    await bosalt();
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "iptal");
  });
});

describe("planlar: mezar taşı ve kirli okuma (Dilim 1)", () => {
  const nesilEkle = (t: ReturnType<typeof kur>, nesil: number): void =>
    t.depo.nesilEkle({
      nesil,
      sohbet_id: ANA_SOHBET_ID,
      session_id: `s${nesil}`,
      baslangic_ms: t.zaman.simdi(),
      bitis_ms: null,
      ozet_kabul: null,
      pid: null,
      olusturma_ms: null,
      son_dolu: null,
      pencere: null,
    } as never);

  it("mezar taşından önceki neslin okuması, mezardan sonra başlayan ilk neslin planına taşınmaz", async () => {
    const t = kur({ nesil: 1 });
    nesilEkle(t, 1);
    const is = t.kirliIs("p1", true);
    t.veriyolu.yayinla("kirli_okundu", { is_id: is, sohbet_id: ANA_SOHBET_ID });
    t.zaman.ilerlet(1000);
    t.depo.gecmisiTemizle(ANA);
    t.zaman.ilerlet(1000);
    nesilEkle(t, 2);
    t.durum.nesil = 2;
    const o = await t.oner(pcTaslak());
    assert.equal("kirli_kaynak" in t.depo.planGetir(o.plan_id)!.plan, false);
  });

  it("mezar taşından sonra başlamış önceki neslin okuması sonraki nesil planına taşınır", async () => {
    const t = kur({ nesil: 1 });
    nesilEkle(t, 1);
    t.zaman.ilerlet(1000);
    t.depo.gecmisiTemizle(ANA);
    t.zaman.ilerlet(1000);
    nesilEkle(t, 2);
    t.durum.nesil = 2;
    const is = t.kirliIs("p1", true);
    t.veriyolu.yayinla("kirli_okundu", { is_id: is, sohbet_id: ANA_SOHBET_ID });
    t.zaman.ilerlet(1000);
    nesilEkle(t, 3);
    t.durum.nesil = 3;
    const o = await t.oner(pcTaslak());
    assert.deepEqual(t.depo.planGetir(o.plan_id)!.plan.kirli_kaynak, [is]);
  });
});

describe("planlar: sonuçlanmış plana gelen izin (Dilim 1)", () => {
  it("iptal edilmiş plana izin gelirse izinGeriCek çağrılır, iş başlamaz", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash); // izin_bekliyor
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "izin_bekliyor");
    assert.equal(t.planlar.bekleyenleriIptal(ANA), 1);
    assert.equal(t.geriCekmeler.length, 0); // iptal anında izin yoktu
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash, "g-gec") });
    await bosalt();
    assert.deepEqual(t.geriCekmeler, ["g-gec"]);
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "iptal");
  });

  it("reddedilmiş plana izin gelirse izinGeriCek çağrılır, iş başlamaz", async () => {
    const t = kur();
    const c = await t.oner(telefonTaslak());
    await t.karar(c.plan_id, c.plan_hash); // izin_bekliyor
    assert.equal((await t.karar(c.plan_id, c.plan_hash, "ret")).ok, true);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "reddedildi");
    t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash, "g-gec") });
    await bosalt();
    assert.deepEqual(t.geriCekmeler, ["g-gec"]);
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(c.plan_id)!.durum, "reddedildi");
  });
});

describe("planlar: çoklu sohbet (Dilim 2)", () => {
  type SohbetliOlay = { type: string; sohbet_id?: string; plan_id?: string; sonuc?: string };
  const planOlaylari = (t: ReturnType<typeof kur>, tur: string): SohbetliOlay[] =>
    (t.depo.olaylariGetir(0, 200) as unknown as SohbetliOlay[]).filter((o) => o.type === tur);
  const yayinSohbetleri = (t: ReturnType<typeof kur>, ad: string): string[] =>
    t.olaylar.filter((o) => o.ad === ad).map((o) => (o.veri as { sohbet_id: string }).sohbet_id);
  const nesilEkle = (t: ReturnType<typeof kur>, nesil: number, sohbet: SohbetSecimi): void => {
    t.depo.nesilEkle({
      nesil,
      sohbet_id: sohbet.sohbet_id,
      session_id: `s${nesil}`,
      baslangic_ms: t.zaman.simdi(),
      bitis_ms: null,
      ozet_kabul: null,
      pid: null,
      olusturma_ms: null,
      son_dolu: null,
      pencere: null,
    } as never);
    t.nesiller.set(sohbet.sohbet_id, nesil);
  };
  /** Yalnız A'nın insan turu sürüyor; sorgulanan sohbetleri kaydeder. */
  const yalnizAninTuru = () => {
    const sorgular: string[] = [];
    return {
      sorgular,
      insanTuru: (s: SohbetSecimi): string | null => {
        sorgular.push(s.sohbet_id);
        return s.sohbet_id === A_ID ? "tur-A" : null;
      },
    };
  };

  describe("sahiplik", () => {
    it("plan öneren sohbete aittir: kayıt, plan_proposed ve plan_onerildi sohbet_id taşır", async () => {
      const t = kur();
      const a = await t.oner(pcTaslak(), "tam", A);
      const b = await t.oner(pcTaslak(), "tam", B);
      const ana = await t.oner(pcTaslak());
      assert.equal(t.depo.planGetir(a.plan_id)!.sohbet_id, A_ID);
      assert.equal(t.depo.planGetir(b.plan_id)!.sohbet_id, B_ID);
      assert.equal(t.depo.planGetir(ana.plan_id)!.sohbet_id, ANA_SOHBET_ID);
      assert.deepEqual(planOlaylari(t, "plan_proposed").map((o) => o.sohbet_id), [A_ID, B_ID, ANA_SOHBET_ID]);
      assert.deepEqual(yayinSohbetleri(t, "plan_onerildi"), [A_ID, B_ID, ANA_SOHBET_ID]);
      assert.deepEqual(t.depo.bekleyenPlanlar(A).map((k) => k.plan.plan_id), [a.plan_id]);
      assert.deepEqual(t.depo.bekleyenPlanlar(B).map((k) => k.plan.plan_id), [b.plan_id]);
    });

    it("taslaktaki sohbet_id plana sızmaz: sahip yalnız parametredir", async () => {
      const t = kur();
      const s = await t.planlar.planOner(pcTaslak({ sohbet_id: B_ID }) as never, "tam", A);
      if (s.ok) assert.equal(t.depo.planGetir(s.deger.plan_id)!.sohbet_id, A_ID);
      else assert.equal(s.code, "plan_gecersiz");
      assert.equal(t.depo.bekleyenPlanlar(B).length, 0);
    });

    it("karar işi planın sohbetiyle başlatır (depodan), sonuç olayları aynı sohbetle", async () => {
      const t = kur();
      const a = await t.oner(pcTaslak(), "tam", A);
      const b = await t.oner(pcTaslak(), "hafif", B);
      assert.equal((await t.karar(b.plan_id, b.plan_hash)).ok, true);
      assert.equal((await t.karar(a.plan_id, a.plan_hash)).ok, true);
      assert.deepEqual(t.baslatmalar.map((i) => i.sohbet_id), [B_ID, A_ID]);
      assert.deepEqual(
        planOlaylari(t, "plan_resolved").map((o) => [o.plan_id, o.sohbet_id]),
        [[b.plan_id, B_ID], [a.plan_id, A_ID]],
      );
      assert.deepEqual(yayinSohbetleri(t, "plan_sonuclandi"), [B_ID, A_ID]);
    });

    it("ret ve izinle başlayan telefon planı da planın sohbetini taşır", async () => {
      const t = kur();
      const r = await t.oner(pcTaslak(), "tam", B);
      await t.karar(r.plan_id, r.plan_hash, "ret");
      assert.equal(planOlaylari(t, "plan_resolved")[0]!.sohbet_id, B_ID);
      assert.deepEqual(yayinSohbetleri(t, "plan_sonuclandi"), [B_ID]);

      const c = await t.oner(telefonTaslak(), "tam", A);
      await t.karar(c.plan_id, c.plan_hash);
      t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(c.plan_id, c.plan_hash) });
      await bosalt();
      assert.equal(t.baslatmalar.length, 1);
      assert.equal(t.baslatmalar[0]!.sohbet_id, A_ID);
    });

    it("olmayan ya da silinmiş sohbete öneri plan_gecersiz, kayıt ve olay yok", async () => {
      const t = kur();
      t.depo.sohbetiSil(B, t.zaman.simdi());
      const proposedOnce = planOlaylari(t, "plan_proposed").length;
      for (const sohbet of [{ sohbet_id: "yok-sohbet" }, B]) {
        const s = await t.planlar.planOner(pcTaslak() as never, "tam", sohbet);
        assert.equal(s.ok, false);
        if (!s.ok) assert.equal(s.code, "plan_gecersiz");
      }
      assert.equal(t.depo.bekleyenPlanlar().length, 0);
      assert.equal(planOlaylari(t, "plan_proposed").length, proposedOnce);
      assert.equal(t.olaylar.length, 0);
      assert.equal(t.baslatmalar.length, 0);
    });
  });

  describe("insan turu (güvenlik)", () => {
    it("A'nın insan turu sürerken B adına önerilen PC planı başlamaz, kart olur", async () => {
      const k = yalnizAninTuru();
      const t = kur({ insanTuru: k.insanTuru });
      const b = await t.oner(pcTaslak(), "tam", B);
      assert.deepEqual([b.durum, b.neden], ["onay_bekliyor", "tam_yetki_kapali"]);
      assert.equal(t.baslatmalar.length, 0, "B'nin önerisi A'nın insan turunda başlamamalı");
      assert.equal(t.depo.planGetir(b.plan_id)!.durum, "bekliyor");
      assert.equal(planOlaylari(t, "plan_resolved").length, 0);
      // Yalnız önerenin sohbeti sorulur, başka sohbetin turu hiç okunmaz.
      assert.ok(k.sorgular.length >= 1);
      assert.ok(k.sorgular.every((s) => s === B_ID), `sorgulanan sohbetler: ${k.sorgular.join(",")}`);
      // Kart kullanıcı onayıyla yine başlar.
      assert.equal((await t.karar(b.plan_id, b.plan_hash)).ok, true);
      assert.equal(t.baslatmalar.length, 1);
      assert.equal(t.baslatmalar[0]!.sohbet_id, B_ID);
    });

    it("A'nın turu sürerken ana adına önerilen plan da başlamaz", async () => {
      const k = yalnizAninTuru();
      const t = kur({ insanTuru: k.insanTuru });
      await t.oner(pcTaslak());
      assert.equal(t.baslatmalar.length, 0);
    });

    it("kendi sohbetinin insan turunda Dilim 1 davranışı: onaysız başlar, sıra plan_proposed sonra plan_resolved", async () => {
      const k = yalnizAninTuru();
      const t = kur({ insanTuru: k.insanTuru });
      const a = await t.oner(pcTaslak(), "hafif", A);
      assert.equal(a.durum, "basladi");
      assert.equal(a.is_id, t.depo.planGetir(a.plan_id)!.is_id);
      assert.equal(t.baslatmalar.length, 1);
      assert.equal(t.baslatmalar[0]!.sohbet_id, A_ID);
      assert.equal(t.baslatmalar[0]!.profil, "hafif");
      const tipler = t.depo.olaylariGetir(0, 50).map((o) => o.type).filter((x) => x.startsWith("plan_"));
      assert.deepEqual(tipler, ["plan_proposed", "plan_resolved"]);
      assert.equal(t.depo.planGetir(a.plan_id)!.durum, "onaylandi");
      const ikinci = await t.karar(a.plan_id, a.plan_hash);
      assert.equal(ikinci.ok === false && ikinci.code, "plan_zaten_sonuclandi");
      assert.equal(t.baslatmalar.length, 1);
    });

    it("iki sohbet de kendi insan turundaysa her biri kendi planını başlatır, çapraz başlatma yok", async () => {
      const turlar: Record<string, string> = { [A_ID]: "tur-A", [B_ID]: "tur-B" };
      const t = kur({ insanTuru: (s) => turlar[s.sohbet_id] ?? null });
      await t.oner(pcTaslak(), "tam", B);
      await t.oner(pcTaslak(), "tam", A);
      assert.deepEqual(t.baslatmalar.map((i) => i.sohbet_id), [B_ID, A_ID]);
      assert.equal(t.depo.bekleyenPlanlar().length, 0);
    });

    it("B'nin turu öneriyle başlatma arasında bitince başlamaz; A'nın turu B'yi kurtarmaz", async () => {
      let n = 0;
      const t = kur({
        insanTuru: (s) => (s.sohbet_id === B_ID ? (n++ === 0 ? "tur-B" : null) : "tur-A"),
      });
      const b = await t.oner(pcTaslak(), "tam", B);
      assert.deepEqual([b.durum, b.neden], ["onay_bekliyor", "tur_bitti"]);
      assert.equal(t.baslatmalar.length, 0);
      assert.equal(t.depo.planGetir(b.plan_id)!.durum, "bekliyor");
    });

    it("A'nın insan turunda B'nin telefon planı da başlamaz", async () => {
      const k = yalnizAninTuru();
      const t = kur({ insanTuru: k.insanTuru });
      await t.oner(telefonTaslak(), "tam", B);
      await t.oner(telefonTaslak(), "tam", A);
      assert.equal(t.baslatmalar.length, 0);
    });
  });

  describe("bekleyenleriIptal(sohbet)", () => {
    it("yalnız o sohbetin planlarını ve izinlerini iptal eder, plan_resolved sohbet_id taşır", async () => {
      const t = kur();
      const a1 = await t.oner(pcTaslak(), "tam", A);
      const aTel = await t.oner(telefonTaslak(), "tam", A);
      const b1 = await t.oner(pcTaslak(), "tam", B);
      const bTel = await t.oner(telefonTaslak(), "tam", B);
      const ana = await t.oner(pcTaslak());
      await t.karar(aTel.plan_id, aTel.plan_hash); // izin_bekliyor
      await t.karar(bTel.plan_id, bTel.plan_hash);
      t.izinVer(aTel.plan_id, aTel.plan_hash, "g-a");
      t.izinVer(bTel.plan_id, bTel.plan_hash, "g-b");
      const yayinOnce = t.olaylar.filter((o) => o.ad === "plan_sonuclandi").length;

      assert.equal(t.planlar.bekleyenleriIptal(A), 2);

      assert.equal(t.depo.planGetir(a1.plan_id)!.durum, "iptal");
      assert.equal(t.depo.planGetir(aTel.plan_id)!.durum, "iptal");
      assert.equal(t.depo.planGetir(b1.plan_id)!.durum, "bekliyor");
      assert.equal(t.depo.planGetir(bTel.plan_id)!.durum, "izin_bekliyor");
      assert.equal(t.depo.planGetir(ana.plan_id)!.durum, "bekliyor");
      assert.deepEqual(t.geriCekmeler, ["g-a"]);
      assert.deepEqual(t.geriCekNedenleri, ["is_iptal"]);
      const iptaller = planOlaylari(t, "plan_resolved").filter((o) => o.sonuc === "iptal");
      assert.deepEqual(new Set(iptaller.map((o) => o.plan_id)), new Set([a1.plan_id, aTel.plan_id]));
      assert.ok(iptaller.every((o) => o.sohbet_id === A_ID));
      assert.equal(t.olaylar.filter((o) => o.ad === "plan_sonuclandi").length, yayinOnce);

      // B ve ana kendi sayılarını iptal eder, birbirine dokunmaz.
      assert.equal(t.planlar.bekleyenleriIptal(B), 2);
      assert.deepEqual(t.geriCekmeler, ["g-a", "g-b"]);
      assert.equal(t.depo.planGetir(ana.plan_id)!.durum, "bekliyor");
      assert.equal(t.planlar.bekleyenleriIptal(ANA), 1);
    });

    it("planı olmayan sohbette 0 döner, hiçbir şeye dokunmaz", async () => {
      const t = kur();
      const b = await t.oner(pcTaslak(), "tam", B);
      assert.equal(t.planlar.bekleyenleriIptal(A), 0);
      assert.equal(t.depo.planGetir(b.plan_id)!.durum, "bekliyor");
      assert.equal(planOlaylari(t, "plan_resolved").length, 0);
    });

    it("iptal edilen A planına sonradan izin gelirse başlamaz, B'nin planı etkilenmez", async () => {
      const t = kur();
      const a = await t.oner(telefonTaslak(), "tam", A);
      const b = await t.oner(telefonTaslak(), "tam", B);
      await t.karar(a.plan_id, a.plan_hash);
      await t.karar(b.plan_id, b.plan_hash);
      t.planlar.bekleyenleriIptal(A);
      t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(a.plan_id, a.plan_hash, "g-a") });
      t.veriyolu.yayinla("izin_geldi", { izin: t.izinVer(b.plan_id, b.plan_hash, "g-b") });
      await bosalt();
      assert.deepEqual(t.geriCekmeler, ["g-a"]);
      assert.equal(t.baslatmalar.length, 1);
      assert.equal(t.baslatmalar[0]!.sohbet_id, B_ID);
    });
  });

  describe("kirli okuma zinciri", () => {
    it("kirli_okundu okuyanın sohbetinin planını kirletir, başka sohbetinkini kirletmez", async () => {
      const t = kur({ nesil: 3 });
      const is = t.kirliIs("p1", true, { sohbet: B });
      t.veriyolu.yayinla("kirli_okundu", { is_id: is, sohbet_id: B_ID });
      const a = await t.oner(pcTaslak(), "tam", A);
      const ana = await t.oner(pcTaslak());
      const b = await t.oner(pcTaslak(), "tam", B);
      assert.equal("kirli_kaynak" in t.depo.planGetir(a.plan_id)!.plan, false);
      assert.equal("kirli_kaynak" in t.depo.planGetir(ana.plan_id)!.plan, false);
      assert.deepEqual(t.depo.planGetir(b.plan_id)!.plan.kirli_kaynak, [is]);
    });

    it("okuma, okuyan sohbetin etkin nesliyle kaydedilir (sohbet başına nesil)", () => {
      const t = kur({ nesil: 1 });
      t.nesiller.set(B_ID, 9);
      const is = t.kirliIs("p1", true, { sohbet: B });
      t.veriyolu.yayinla("kirli_okundu", { is_id: is, sohbet_id: B_ID });
      assert.deepEqual(t.depo.kirliOkumalar(9, B), [is]);
      assert.deepEqual(t.depo.kirliOkumalar(1, B), [is]);
      assert.deepEqual(t.depo.kirliOkumalar(1, A), []);
      assert.deepEqual(t.depo.kirliOkumalar(10, B), []);
    });

    it("araya başka sohbetin nesli girse de önceki nesil doğru bulunur; mezar taşı sohbet başınadır", async () => {
      const t = kur();
      // A: 1 -> 3 -> 7; B: 2 -> 5 -> 6. Önceki nesil `nesil - 1` değildir.
      nesilEkle(t, 1, A);
      nesilEkle(t, 2, B);
      const is1 = t.kirliIs("p1", true, { sohbet: A });
      t.veriyolu.yayinla("kirli_okundu", { is_id: is1, sohbet_id: A_ID });

      t.zaman.ilerlet(1000);
      t.depo.gecmisiTemizle(B); // yalnız B'nin mezar taşı
      t.zaman.ilerlet(1000);
      nesilEkle(t, 5, B);
      const is2 = t.kirliIs("p2", true, { sohbet: B });
      t.veriyolu.yayinla("kirli_okundu", { is_id: is2, sohbet_id: B_ID });
      t.zaman.ilerlet(1000);
      nesilEkle(t, 3, A);
      nesilEkle(t, 6, B);

      // B'nin mezar taşı A'nın taşıdığı okumayı silmez: A'nın önceki nesli 1 (2 değil).
      const a = await t.oner(pcTaslak(), "tam", A);
      assert.deepEqual(t.depo.planGetir(a.plan_id)!.plan.kirli_kaynak, [is1]);
      // B'nin önceki nesli 5, mezardan sonra başladı: is2 taşınır, is1 (A'nın) karışmaz.
      const b = await t.oner(pcTaslak(), "tam", B);
      assert.deepEqual(t.depo.planGetir(b.plan_id)!.plan.kirli_kaynak, [is2]);

      t.zaman.ilerlet(1000);
      t.depo.gecmisiTemizle(A); // A'nın mezar taşı, B'nin nesil 5'inden sonra
      t.zaman.ilerlet(1000);
      nesilEkle(t, 7, A);
      const a2 = await t.oner(pcTaslak(), "tam", A);
      assert.equal("kirli_kaynak" in t.depo.planGetir(a2.plan_id)!.plan, false, "A'nın silinen geçmişinin okuması taşınmaz");
      const b2 = await t.oner(pcTaslak(), "tam", B);
      assert.deepEqual(t.depo.planGetir(b2.plan_id)!.plan.kirli_kaynak, [is2], "A'nın mezar taşı B'nin zincirini kesmez");
    });

    it("başka sohbetin kirli işine dayanan plan kirli sayılır ve insan turunda onaysız başlamaz", async () => {
      const t = kur({ insanTuru: (s) => (s.sohbet_id === A_ID ? "tur-A" : null) });
      const bIs = t.kirliIs("p-b", true, { sohbet: B });
      const temiz = t.kirliIs("p-t", false, { sohbet: B });
      const a = await t.oner(pcTaslak({ dayandigi_isler: [bIs, temiz] }), "tam", A);
      assert.deepEqual(t.depo.planGetir(a.plan_id)!.plan.kirli_kaynak, [bIs]);
      assert.equal(t.depo.planGetir(a.plan_id)!.sohbet_id, A_ID);
      assert.equal(t.baslatmalar.length, 0);
      assert.equal(t.depo.planGetir(a.plan_id)!.durum, "bekliyor");
    });
  });

  describe("isler_uzlastirildi", () => {
    it("her sohbetin işi olan bekleyen planı bir kez sonuçlanır, işsiz plan bekler, ikinci olay yeni olay yazmaz", async () => {
      const t = kur();
      const a = await t.oner(pcTaslak(), "tam", A);
      const b = await t.oner(pcTaslak(), "tam", B);
      const bosA = await t.oner(pcTaslak(), "tam", A);
      const isA = t.kirliIs(a.plan_id, false, { pid: 4242, sohbet: A });
      const isB = t.kirliIs(b.plan_id, false, { pid: 4243, sohbet: B });
      const ozet = {
        sahiplenilen: 2,
        biten: 0,
        sohbetler: { [A_ID]: { sahiplenilen: 1, biten: 0 }, [B_ID]: { sahiplenilen: 1, biten: 0 } },
      };
      t.veriyolu.yayinla("isler_uzlastirildi", ozet);
      assert.equal(t.depo.planGetir(a.plan_id)!.is_id, isA);
      assert.equal(t.depo.planGetir(b.plan_id)!.is_id, isB);
      assert.equal(t.depo.planGetir(a.plan_id)!.durum, "onaylandi");
      assert.equal(t.depo.planGetir(bosA.plan_id)!.durum, "bekliyor");
      assert.deepEqual(
        planOlaylari(t, "plan_resolved").map((o) => [o.plan_id, o.sohbet_id]).sort(),
        [[a.plan_id, A_ID], [b.plan_id, B_ID]].sort(),
      );
      t.veriyolu.yayinla("isler_uzlastirildi", ozet);
      assert.equal(planOlaylari(t, "plan_resolved").length, 2);
      assert.equal(t.baslatmalar.length, 0);
    });
  });
});

describe("planlar: 0.5.0 öncesi biçimde saklı plan", () => {
  const kok = mkdtempSync(join(tmpdir(), "eren-planlar-test-"));
  const acik: Array<{ kapat(): void }> = [];
  after(() => {
    for (const d of acik) d.kapat();
    rmSync(kok, { recursive: true, force: true });
  });
  let no = 0;

  /** Kartı yeni kodla önerir, sonra satırı ve olayı eski biçime (iki eski anahtar, eski hash) çevirir. */
  const eskiKart = async () => {
    const yol = join(kok, `vt-${++no}.db`);
    const t = kur({ yol });
    acik.push(t.depo);
    const c = await t.oner(pcTaslak());
    const plan = t.depo.planGetir(c.plan_id)!.plan;
    const eski = { ...plan, kesin_yapilacaklar: ["Birinci madde"], kesin_yapilmayacaklar: [] };
    const ESKI_HASH = "b".repeat(64);
    const ham = new DatabaseSync(yol);
    try {
      ham.prepare("UPDATE planlar SET plan = ?, plan_hash = ? WHERE plan_id = ?").run(JSON.stringify(eski), ESKI_HASH, c.plan_id);
      const r = ham.prepare("SELECT seq, veri FROM events WHERE type = 'plan_proposed'").get() as { seq: number; veri: string };
      const veri = { ...(JSON.parse(r.veri) as object), plan: eski, plan_hash: ESKI_HASH };
      ham.prepare("UPDATE events SET veri = ? WHERE seq = ?").run(JSON.stringify(veri), r.seq);
    } finally {
      ham.close();
    }
    return { t, plan, plan_id: c.plan_id, ESKI_HASH };
  };

  it("kart ve geçmiş okunur; onay iş başlatmaz (ic_hata), plan bekliyor kalır", async () => {
    const { t, plan, plan_id, ESKI_HASH } = await eskiKart();
    const k = t.depo.planGetir(plan_id)!;
    assert.deepEqual(k.plan, plan);
    assert.equal(k.plan_hash, ESKI_HASH);
    const kart = t.depo.olaylariGetir(0, 50).find((o) => o.type === "plan_proposed");
    assert.ok(kart?.type === "plan_proposed");
    assert.deepEqual(kart.plan, plan);
    assert.deepEqual(t.depo.bekleyenPlanlar().map((p) => p.plan.plan_id), [plan_id]);

    const s = await t.karar(plan_id, ESKI_HASH);
    assert.equal(s.ok === false && s.code, "ic_hata");
    assert.equal(t.baslatmalar.length, 0);
    assert.equal(t.depo.planGetir(plan_id)!.durum, "bekliyor");
    assert.ok(t.gunluk.girdiler.some((g) => JSON.stringify(g).includes("depo_plan_degismis")));
  });

  it("ret ve sohbet iptali eski kartı kapatır", async () => {
    const r = await eskiKart();
    const s = await r.t.karar(r.plan_id, r.ESKI_HASH, "ret");
    assert.equal(s.ok, true);
    assert.equal(r.t.depo.planGetir(r.plan_id)!.durum, "reddedildi");

    const i = await eskiKart();
    assert.equal(i.t.planlar.bekleyenleriIptal(ANA), 1);
    assert.equal(i.t.depo.planGetir(i.plan_id)!.durum, "iptal");
    assert.equal(i.t.baslatmalar.length, 0);
  });
});
