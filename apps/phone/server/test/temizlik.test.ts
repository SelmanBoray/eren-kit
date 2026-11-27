/**
 * temizlik testleri: MODULLER.md "temizlik" (K3; dilim 2 "temizlik") ve sozlesme.ts `Temizlik`
 * sözleşmesinden yazıldı. Üretim koduna bakılarak uydurulmadı. Bağımlılıkların çoğu küçük el yapımı
 * sahtelerdir; dosya sonundaki "gerçek depo" bölümü `depoKur(":memory:")` ile koşar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANA_SOHBET_ID, planHash } from "@eren/protocol";
import type { Plan, SohbetId } from "@eren/protocol";
import { depoKur } from "../src/depo.ts";
import { temizlikKur } from "../src/temizlik.ts";
import type {
  Depo,
  IsKaydi,
  NesilKaydi,
  OlayGirdisi,
  PlanKaydi,
  SohbetSecimi,
  SonlandirmaSonucu,
  TemizlikBagimliliklari,
  TemizlikMedyaYuzu,
  TemizlikSohbetleri,
  YeniSayfaSonucu,
} from "../src/sozlesme.ts";
import { CagriDefteri, sahteGunluk, sahteMedyaYoneticisi, sahteTranskript, sahteZaman } from "./sahte.ts";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const A_ID: SohbetId = "sohbet-a";
const B_ID: SohbetId = "sohbet-b";
const S: SohbetSecimi = { sohbet_id: A_ID };
const SB: SohbetSecimi = { sohbet_id: B_ID };
const ANA: SohbetSecimi = { sohbet_id: ANA_SOHBET_ID };

interface Ertel<T> {
  soz: Promise<T>;
  coz: (t: T) => void;
}
function ertel<T>(): Ertel<T> {
  let c!: (t: T) => void;
  let bitti = false;
  const soz = new Promise<T>((r) => (c = r));
  return {
    soz,
    coz: (t) => {
      if (bitti) return;
      bitti = true;
      c(t);
    },
  };
}

interface Ayar {
  temizlenebilir?: boolean;
  aktif?: number;
  sorular?: number;
  iptalSayisi?: number;
  sayfa?: Partial<YeniSayfaSonucu>;
  iptalHata?: Error;
  temizlemeHata?: Error;
  sohbetiSilHata?: Error;
  walHata?: Error;
  sayfaHata?: Error;
  /** Bu sohbetlerin örneği yok (`sohbetler.konusma` `null`). */
  yok?: readonly SohbetId[];
  /** Medya dalgası (S7): verilirse `TemizlikBagimliliklari.medya`. */
  medya?: TemizlikMedyaYuzu;
  /** Depo sonuçlarına `silinecek_medya` (S1) olarak konur. */
  silinecekMedya?: number;
  kaldirHata?: Error;
}

function kur(a: Ayar = {}) {
  const c = new CagriDefteri();
  const gunluk = sahteGunluk();
  const transkript = sahteTranskript();
  const ts = transkript.sil.bind(transkript);
  transkript.sil = async (o) => {
    c.ekle("transkript.sil", o);
    return ts(o);
  };
  let islemde = false;
  const sayfalar = new Map<string, Ertel<YeniSayfaSonucu>>();
  const sonlar = new Map<string, Ertel<SonlandirmaSonucu>>();
  const sayfaErtel = (id: string) => sayfalar.get(id) ?? sayfalar.set(id, ertel()).get(id)!;
  const sonErtel = (id: string) => sonlar.get(id) ?? sonlar.set(id, ertel()).get(id)!;
  const varsayilan = { eski_oturumlar: [U1, U2], eski_surec_cikti: true, yeni_nesil_acildi: true, ...a.sayfa };

  const sohbetler: TemizlikSohbetleri = {
    konusma: (s) => {
      c.ekle("sohbetler.konusma", s.sohbet_id);
      if (a.yok?.includes(s.sohbet_id)) return null;
      return {
        temizlenebilirMi: () => {
          c.ekle("temizlenebilirMi");
          return a.temizlenebilir ?? true;
        },
        yeniSayfa: () => {
          c.ekle("yeniSayfa", s.sohbet_id);
          if (a.sayfaHata) return Promise.reject(a.sayfaHata);
          return sayfaErtel(s.sohbet_id).soz.then((r) => {
            c.ekle("yeniSayfa.cikti", s.sohbet_id);
            return r;
          });
        },
      };
    },
    kaldir: (s) => {
      c.ekle("kaldir", islemde, s.sohbet_id);
      if (a.kaldirHata) throw a.kaldirHata;
      if (a.yok?.includes(s.sohbet_id)) return null;
      return {
        sonlandir: () => {
          c.ekle("sonlandir", s.sohbet_id);
          return sonErtel(s.sohbet_id).soz;
        },
      };
    },
  };

  const b: TemizlikBagimliliklari = {
    depo: {
      islem: <T>(f: () => T): T => {
        c.ekle("islem.basla");
        islemde = true;
        try {
          return f();
        } finally {
          islemde = false;
          c.ekle("islem.bitti");
        }
      },
      gecmisiTemizle: (s: SohbetSecimi) => {
        c.ekle("gecmisiTemizle", islemde, s.sohbet_id);
        if (a.temizlemeHata) throw a.temizlemeHata;
        return {
          mezar: { seq: 50, type: "chat_cleared", sinir_seq: 40 },
          silinen_olay: 7,
          bosaltilan_tur: 1,
          silinen_kuyruk: 2,
          ...(a.silinecekMedya === undefined ? {} : { silinecek_medya: a.silinecekMedya }),
        } as never;
      },
      sohbetiSil: (s: SohbetSecimi, ms: number) => {
        c.ekle("sohbetiSil", islemde, s.sohbet_id, ms);
        if (a.sohbetiSilHata) throw a.sohbetiSilHata;
        return {
          silindi: { seq: 60, type: "chat_deleted", sohbet_id: s.sohbet_id },
          silinen_olay: 5,
          bosaltilan_tur: 1,
          silinen_kuyruk: 0,
          ...(a.silinecekMedya === undefined ? {} : { silinecek_medya: a.silinecekMedya }),
        } as never;
      },
      walDaralt: () => {
        c.ekle("walDaralt", islemde);
        if (a.walHata) throw a.walHata;
      },
      bekleyenSorular: (suzgec?: unknown) => {
        c.ekle("bekleyenSorular", suzgec);
        return Array.from({ length: a.sorular ?? 0 }, () => ({}) as never);
      },
      oturumKayitlariniSil: (o: readonly string[]) => {
        c.ekle("oturumKayitlariniSil", o);
      },
    } as never,
    sohbetler,
    isler: {
      aktifSayisi: (s?: unknown) => {
        c.ekle("aktifSayisi", s);
        return a.aktif ?? 0;
      },
    },
    planlar: {
      bekleyenleriIptal: (s: SohbetSecimi) => {
        c.ekle("bekleyenleriIptal", islemde, s.sohbet_id);
        if (a.iptalHata) throw a.iptalHata;
        return a.iptalSayisi ?? 3;
      },
    },
    transkript,
    saat: { simdiMs: () => 1234 },
    gunluk,
    ...(a.medya === undefined ? {} : { medya: a.medya }),
  };
  const t = temizlikKur(b);
  return {
    t,
    c,
    gunluk,
    transkript,
    /** Sohbetin `yeniSayfa()` sözünü çözer (varsayılan A). */
    sayfaBitir: (s: Partial<YeniSayfaSonucu> = {}, id: SohbetId = A_ID) => {
      sayfaErtel(id).coz({ ...varsayilan, ...s });
    },
    /** Sohbetin `sonlandir()` sözünü çözer (varsayılan B). */
    sonlandirBitir: (s: Partial<SonlandirmaSonucu> = {}, id: SohbetId = B_ID) => {
      sonErtel(id).coz({ eski_oturumlar: varsayilan.eski_oturumlar, eski_surec_cikti: varsayilan.eski_surec_cikti, ...s });
    },
  };
}

const adlar = (c: CagriDefteri) => c.liste.map((x) => x.ad);


// ---- Ön koşullar ----

for (const [ad, ayar] of [
  ["tur sürüyor (temizlenebilirMi yanlış)", { temizlenebilir: false }],
  ["iş çalışıyor", { aktif: 1 }],
  ["soru bekliyor", { sorular: 2 }],
] as const) {
  test(`${ad}: sohbet_mesgul, hiçbir yan etki yok`, async () => {
    const k = kur(ayar);
    const s = k.t.gecmisiSil(S);
    assert.equal(s.ok, false);
    assert.equal(!s.ok && s.code, "sohbet_mesgul");
    for (const yasak of ["bekleyenleriIptal", "islem.basla", "gecmisiTemizle", "walDaralt", "yeniSayfa", "transkript.sil"]) {
      assert.equal(k.c.say(yasak), 0, yasak);
    }
    k.sayfaBitir();
    await k.t.bekle();
    assert.equal(k.c.say("transkript.sil"), 0);
  });
}

// ---- Başarı yolu ----

test("başarıda sıra: iptal -> gecmisiTemizle (aynı işlemde) -> walDaralt (işlem dışı) -> yeniSayfa -> transkript.sil", async () => {
  const k = kur();
  const s = k.t.gecmisiSil(S);
  assert.equal(s.ok, true);
  k.sayfaBitir();
  await k.t.bekle();
  const a = adlar(k.c);
  const sira = ["bekleyenleriIptal", "gecmisiTemizle", "walDaralt", "yeniSayfa", "transkript.sil"].map((x) => a.indexOf(x));
  assert.ok(
    sira.every((i) => i >= 0),
    JSON.stringify(a),
  );
  assert.deepEqual([...sira].sort((x, y) => x - y), sira, JSON.stringify(a));
  assert.equal(k.c.son("bekleyenleriIptal")!.args[0], true, "iptal depo.islem içinde");
  assert.equal(k.c.son("gecmisiTemizle")!.args[0], true, "temizlik depo.islem içinde");
  assert.equal(k.c.son("walDaralt")!.args[0], false, "walDaralt işlem dışında");
  assert.ok(a.indexOf("islem.bitti") < a.indexOf("walDaralt"));
  assert.equal(k.c.say("islem.basla"), 1, "iptal ve temizlik tek işlemde");
});

test("sonuç {mezar_seq, sinir_seq} döner ve dönüş anında yeniSayfa çözülmemiştir (ack beklemez)", async () => {
  const k = kur();
  const s = k.t.gecmisiSil(S);
  assert.deepEqual(s, { ok: true, deger: { mezar_seq: 50, sinir_seq: 40 } });
  assert.equal(k.c.say("yeniSayfa"), 1);
  assert.equal(k.c.say("yeniSayfa.cikti"), 0);
  assert.equal(k.c.say("transkript.sil"), 0);
  k.sayfaBitir();
  await k.t.bekle();
});

test("transkript silme yeniSayfa çıkışından SONRA çalışır ve tam eski_oturumlar ile", async () => {
  const k = kur();
  k.t.gecmisiSil(S);
  await Promise.resolve();
  assert.equal(k.c.say("transkript.sil"), 0, "yeniSayfa bitmeden silme yok");
  k.sayfaBitir();
  await k.t.bekle();
  const a = adlar(k.c);
  assert.ok(a.indexOf("yeniSayfa.cikti") < a.indexOf("transkript.sil"));
  assert.deepEqual(k.transkript.silinenIstekler, [[U1, U2]]);
});

test("eski_surec_cikti:false: transkript.sil çağrılmaz, günlükte transkript_atlandi", async () => {
  const k = kur({ sayfa: { eski_surec_cikti: false } });
  k.t.gecmisiSil(S);
  k.sayfaBitir();
  await k.t.bekle();
  assert.equal(k.c.say("transkript.sil"), 0);
  assert.equal(k.gunluk.bul("transkript_atlandi").length, 1);
});

test("arka iş sürerken ikinci çağrı sohbet_mesgul; bitince yeniden çalışır", async () => {
  const k = kur({ temizlenebilir: true });
  assert.equal(k.t.gecmisiSil(S).ok, true);
  const ikinci = k.t.gecmisiSil(S);
  assert.equal(!ikinci.ok && ikinci.code, "sohbet_mesgul");
  assert.equal(k.c.say("gecmisiTemizle"), 1);
  assert.equal(k.c.say("bekleyenleriIptal"), 1);
  k.sayfaBitir();
  await k.t.bekle();
  assert.equal(k.t.gecmisiSil(S).ok, true);
});

// ---- Hata yolları ----

test("bekleyenleriIptal atarsa ic_hata, geçmiş temizlenmez, servis çökmez", async () => {
  const k = kur({ iptalHata: new Error("x") });
  const s = k.t.gecmisiSil(S);
  assert.equal(!s.ok && s.code, "ic_hata");
  assert.equal(k.c.say("gecmisiTemizle"), 0);
  assert.equal(k.c.say("walDaralt"), 0);
  assert.equal(k.c.say("yeniSayfa"), 0);
  await k.t.bekle();
});

test("gecmisiTemizle atarsa ic_hata, walDaralt/yeniSayfa/transkript yok", async () => {
  const k = kur({ temizlemeHata: new Error("disk") });
  const s = k.t.gecmisiSil(S);
  assert.equal(!s.ok && s.code, "ic_hata");
  assert.equal(k.c.say("walDaralt"), 0);
  assert.equal(k.c.say("yeniSayfa"), 0);
  assert.equal(k.c.say("transkript.sil"), 0);
  await k.t.bekle();
});

test("ic_hata sonrası bayrak takılı kalmaz: ikinci çağrı sohbet_mesgul değil, yine kendi hatası", () => {
  const k = kur({ iptalHata: new Error("x") });
  assert.equal(k.t.gecmisiSil(S).ok, false);
  const ikinci = k.t.gecmisiSil(S);
  assert.equal(!ikinci.ok && ikinci.code, "ic_hata");
});

test("walDaralt atarsa sonuç yine başarı, günlüğe yazılır, arka iş sürer", async () => {
  const k = kur({ walHata: new Error("wal") });
  const s = k.t.gecmisiSil(S);
  assert.deepEqual(s, { ok: true, deger: { mezar_seq: 50, sinir_seq: 40 } });
  assert.ok(
    k.gunluk.girdiler.some((g) => g.seviye !== "bilgi"),
    "hata/uyarı yazılmalı",
  );
  k.sayfaBitir();
  await k.t.bekle();
  assert.equal(k.c.say("transkript.sil"), 1);
});

test("yeniSayfa reddederse bekle() atmaz, transkript silinmez, sonraki çağrı kabul edilir", async () => {
  const k = kur({ sayfaHata: new Error("sayfa") });
  assert.equal(k.t.gecmisiSil(S).ok, true);
  await assert.doesNotReject(k.t.bekle());
  assert.equal(k.c.say("transkript.sil"), 0);
  assert.equal(k.t.gecmisiSil(S).ok, true);
  await k.t.bekle();
});

test("transkript.sil atarsa bekle() atmaz", async () => {
  const k = kur();
  k.transkript.sonrakiHata(new Error("kilit"));
  assert.equal(k.t.gecmisiSil(S).ok, true);
  k.sayfaBitir();
  await assert.doesNotReject(k.t.bekle());
});

// ---- bekle / kapat ----

test("bekle(): arka iş yokken hemen çözülür; varken bitince çözülür", async () => {
  const k = kur();
  await k.t.bekle();
  k.t.gecmisiSil(S);
  let bitti = false;
  const p = k.t.bekle().then(() => (bitti = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(bitti, false);
  k.sayfaBitir();
  await p;
  assert.equal(bitti, true);
  assert.equal(k.c.say("transkript.sil"), 1);
});

test("kapat(): sonraki çağrı ic_hata; süren arka işi bekler", async () => {
  const k = kur();
  k.t.gecmisiSil(S);
  let kapandi = false;
  const p = k.t.kapat().then(() => (kapandi = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(kapandi, false);
  const s = k.t.gecmisiSil(S);
  assert.equal(!s.ok && s.code, "ic_hata");
  k.sayfaBitir();
  await p;
  assert.equal(kapandi, true);
  assert.equal(k.c.say("transkript.sil"), 1);
  assert.equal(k.c.say("gecmisiTemizle"), 1, "kapalıyken yeni silme yok");
});

test("kapat() arka iş yokken de çözülür", async () => {
  const k = kur();
  await k.t.kapat();
  const s = k.t.gecmisiSil(S);
  assert.equal(!s.ok && s.code, "ic_hata");
  assert.equal(k.c.say("gecmisiTemizle"), 0);
});

// ---- Günlük ----

test("günlüğe metin/kimlik yazılmaz, alan değerleri sayı ya da boolean", async () => {
  const k = kur();
  k.t.gecmisiSil(S);
  k.sayfaBitir();
  await k.t.bekle();
  assert.ok(k.gunluk.girdiler.length > 0);
  for (const g of k.gunluk.girdiler) {
    for (const [ad, v] of Object.entries(g.alanlar ?? {})) {
      assert.ok(
        typeof v === "number" || typeof v === "boolean" || v === null || ad === "sohbet_id",
        `${g.olay}.${ad} = ${String(v)}`,
      );
    }
  }
  const tum = JSON.stringify(k.gunluk.girdiler);
  assert.ok(!tum.includes(U1) && !tum.includes(U2), "oturum kimliği günlükte");
});

// ---- Oturum kayıtları (nesiller) ----

test("transkript silinemeyen=0 ve reddedilen=0: oturumKayitlariniSil(eski_oturumlar) transkript.sil'den sonra çağrılır", async () => {
  const k = kur();
  k.transkript.sonrakiSonuc({ silinen: 2, bulunamayan: 0, silinemeyen: 0, reddedilen: 0 });
  k.t.gecmisiSil(S);
  k.sayfaBitir();
  await k.t.bekle();
  assert.equal(k.c.say("oturumKayitlariniSil"), 1);
  assert.deepEqual(k.c.son("oturumKayitlariniSil")!.args[0], [U1, U2]);
  const a = adlar(k.c);
  assert.ok(a.indexOf("transkript.sil") < a.indexOf("oturumKayitlariniSil"));
});

for (const [ad, sonuc] of [
  ["silinemeyen > 0", { silinen: 1, bulunamayan: 0, silinemeyen: 1, reddedilen: 0 }],
  ["reddedilen > 0", { silinen: 1, bulunamayan: 0, silinemeyen: 0, reddedilen: 1 }],
] as const) {
  test(`${ad}: oturumKayitlariniSil çağrılmaz (kayıtlar sonraki silmede yeniden denenir)`, async () => {
    const k = kur();
    k.transkript.sonrakiSonuc({ ...sonuc });
    k.t.gecmisiSil(S);
    k.sayfaBitir();
    await k.t.bekle();
    assert.equal(k.c.say("transkript.sil"), 1);
    assert.equal(k.c.say("oturumKayitlariniSil"), 0);
  });
}

test("eski_surec_cikti:false: oturumKayitlariniSil de çağrılmaz", async () => {
  const k = kur({ sayfa: { eski_surec_cikti: false } });
  k.t.gecmisiSil(S);
  k.sayfaBitir();
  await k.t.bekle();
  assert.equal(k.c.say("oturumKayitlariniSil"), 0);
});

// ---- Dilim 2: gecmisiSil sohbet başına ----

test("gecmisiSil: örnek yoksa sohbet_bulunamadi, hiçbir yan etki yok", () => {
  const k = kur({ yok: [A_ID] });
  const s = k.t.gecmisiSil(S);
  assert.equal(!s.ok && s.code, "sohbet_bulunamadi");
  for (const yasak of ["bekleyenleriIptal", "islem.basla", "gecmisiTemizle", "walDaralt", "yeniSayfa", "transkript.sil"]) {
    assert.equal(k.c.say(yasak), 0, yasak);
  }
});

test("gecmisiSil: sohbet kimliği iptal, temizlik ve ön koşul okumalarına aynen gider", async () => {
  const k = kur();
  assert.equal(k.t.gecmisiSil(SB).ok, true);
  assert.equal(k.c.son("bekleyenleriIptal")!.args[1], B_ID);
  assert.equal(k.c.son("gecmisiTemizle")!.args[1], B_ID);
  assert.equal(k.c.son("yeniSayfa")!.args[0], B_ID);
  assert.deepEqual(k.c.son("aktifSayisi")!.args[0], SB);
  assert.deepEqual(k.c.son("bekleyenSorular")!.args[0], SB);
  k.sayfaBitir({}, B_ID);
  await k.t.bekle();
});

test("A'nın arka işi sürerken B temizlenebilir; aynı sohbete ikinci çağrı sohbet_mesgul", async () => {
  const k = kur();
  assert.equal(k.t.gecmisiSil(S).ok, true);
  const b = k.t.gecmisiSil(SB);
  assert.equal(b.ok, true, "başka sohbetin arka işi engel değil");
  const a2 = k.t.gecmisiSil(S);
  const b2 = k.t.gecmisiSil(SB);
  assert.equal(!a2.ok && a2.code, "sohbet_mesgul");
  assert.equal(!b2.ok && b2.code, "sohbet_mesgul");
  k.sayfaBitir({ eski_oturumlar: [U1] }, A_ID);
  await new Promise((r) => setImmediate(r));
  assert.equal(k.t.gecmisiSil(S).ok, true, "A bitti, yeniden alınır");
  k.sayfaBitir({ eski_oturumlar: [U2] }, B_ID);
  await k.t.bekle();
  assert.ok(k.transkript.silinenIstekler.some((x) => x.length === 1 && x[0] === U1));
  assert.ok(k.transkript.silinenIstekler.some((x) => x.length === 1 && x[0] === U2));
});

// ---- Dilim 2: sohbetiSil (sahte bağımlılıklarla) ----

const mesgulAyarlari = [
  ["tur/devir sürüyor (temizlenebilirMi yanlış)", { temizlenebilir: false }],
  ["iş çalışıyor", { aktif: 1 }],
  ["soru bekliyor", { sorular: 1 }],
] as const;

const YAN_ETKILER = [
  "bekleyenleriIptal",
  "islem.basla",
  "sohbetiSil",
  "gecmisiTemizle",
  "kaldir",
  "walDaralt",
  "sonlandir",
  "yeniSayfa",
  "transkript.sil",
  "oturumKayitlariniSil",
];
const yanEtkisiz = (k: ReturnType<typeof kur>) => {
  for (const y of YAN_ETKILER) assert.equal(k.c.say(y), 0, y);
};

test("sohbetiSil: ana sohbet_silinemez, hiçbir yan etki yok", async () => {
  const k = kur();
  const s = k.t.sohbetiSil(ANA);
  assert.equal(!s.ok && s.code, "sohbet_silinemez");
  yanEtkisiz(k);
  await k.t.bekle();
  yanEtkisiz(k);
});

test("sohbetiSil: örnek yok sohbet_bulunamadi, hiçbir yan etki yok", () => {
  const k = kur({ yok: [B_ID] });
  const s = k.t.sohbetiSil(SB);
  assert.equal(!s.ok && s.code, "sohbet_bulunamadi");
  yanEtkisiz(k);
});

for (const [ad, ayar] of mesgulAyarlari) {
  test(`sohbetiSil: ${ad}: sohbet_mesgul, kaldir dahil hiçbir yan etki yok`, async () => {
    const k = kur(ayar);
    const s = k.t.sohbetiSil(SB);
    assert.equal(!s.ok && s.code, "sohbet_mesgul");
    yanEtkisiz(k);
    await k.t.bekle();
    yanEtkisiz(k);
  });
}

test("sohbetiSil: sohbetin geçmiş silme arka işi sürerken sohbet_mesgul, silme yok", async () => {
  const k = kur();
  assert.equal(k.t.gecmisiSil(SB).ok, true);
  const s = k.t.sohbetiSil(SB);
  assert.equal(!s.ok && s.code, "sohbet_mesgul");
  assert.equal(k.c.say("sohbetiSil"), 0);
  assert.equal(k.c.say("kaldir"), 0);
  k.sayfaBitir({}, B_ID);
  await k.t.bekle();
});

test("sohbetiSil başarı: sıra iptal -> sohbetiSil (aynı işlemde) -> kaldir -> walDaralt -> dönüş; arkada sonlandir -> transkript.sil -> oturumKayitlariniSil", async () => {
  const k = kur();
  const s = k.t.sohbetiSil(SB);
  assert.deepEqual(s, { ok: true, deger: { seq: 60 } });
  const onceki = adlar(k.c);
  const sira = ["bekleyenleriIptal", "sohbetiSil", "kaldir", "walDaralt"].map((x) => onceki.indexOf(x));
  assert.ok(sira.every((i) => i >= 0), JSON.stringify(onceki));
  assert.deepEqual([...sira].sort((x, y) => x - y), sira, JSON.stringify(onceki));
  assert.equal(k.c.son("bekleyenleriIptal")!.args[0], true, "iptal depo.islem içinde");
  assert.equal(k.c.son("bekleyenleriIptal")!.args[1], B_ID);
  assert.equal(k.c.son("sohbetiSil")!.args[0], true, "sohbetiSil depo.islem içinde");
  assert.equal(k.c.son("sohbetiSil")!.args[1], B_ID);
  assert.equal(k.c.son("sohbetiSil")!.args[2], 1234, "silinme_ms saatten");
  assert.equal(k.c.son("kaldir")!.args[0], false, "kaldir işlem dışında");
  assert.equal(k.c.son("kaldir")!.args[1], B_ID);
  assert.equal(k.c.son("walDaralt")!.args[0], false, "walDaralt işlem dışında");
  assert.ok(onceki.indexOf("islem.bitti") < onceki.indexOf("kaldir"));
  assert.equal(k.c.say("islem.basla"), 1, "iptal ve silme tek işlemde");
  assert.equal(k.c.say("gecmisiTemizle"), 0, "ayrı geçmiş temizliği yok (chat_cleared yazılmaz)");
  assert.equal(k.c.say("yeniSayfa"), 0, "sohbet siliniyor, yeni sayfa açılmaz");
  assert.equal(k.c.say("transkript.sil"), 0, "sonlandir bitmeden transkript silinmez");
  k.sonlandirBitir();
  await k.t.bekle();
  const a = adlar(k.c);
  assert.equal(k.c.say("sonlandir"), 1);
  assert.equal(k.c.son("sonlandir")!.args[0], B_ID);
  assert.ok(a.indexOf("kaldir") < a.indexOf("sonlandir"), "sonlandir kaldir'dan sonra");
  assert.ok(a.indexOf("sonlandir") < a.indexOf("transkript.sil"), "sonlandir transkript.sil'den önce");
  assert.ok(a.indexOf("transkript.sil") < a.indexOf("oturumKayitlariniSil"));
  assert.deepEqual(k.transkript.silinenIstekler, [[U1, U2]]);
  assert.deepEqual(k.c.son("oturumKayitlariniSil")!.args[0], [U1, U2]);
});

test("sohbetiSil: dönüş anında sonlandir bitmemiştir (ack beklemez); bekle() onu bekler", async () => {
  const k = kur();
  const s = k.t.sohbetiSil(SB);
  assert.equal(s.ok, true);
  await Promise.resolve();
  assert.equal(k.c.say("transkript.sil"), 0);
  let bitti = false;
  const p = k.t.bekle().then(() => (bitti = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(bitti, false, "bekle() süren sonlandırmayı bekler");
  k.sonlandirBitir();
  await p;
  assert.equal(bitti, true);
});

test("sohbetiSil atarsa ic_hata; kaldir, walDaralt, sonlandir, transkript yok; bayrak takılmaz", async () => {
  const k = kur({ sohbetiSilHata: new Error("disk") });
  const s = k.t.sohbetiSil(SB);
  assert.equal(!s.ok && s.code, "ic_hata");
  assert.equal(k.c.say("kaldir"), 0);
  assert.equal(k.c.say("walDaralt"), 0);
  assert.equal(k.c.say("sonlandir"), 0);
  assert.equal(k.c.say("transkript.sil"), 0);
  const ikinci = k.t.sohbetiSil(SB);
  assert.equal(!ikinci.ok && ikinci.code, "ic_hata", "yine kendi hatası, sohbet_mesgul değil");
  await k.t.bekle();
});

test("sohbetiSil: bekleyenleriIptal atarsa ic_hata, depo silmesi ve kaldir çağrılmaz", async () => {
  const k = kur({ iptalHata: new Error("x") });
  const s = k.t.sohbetiSil(SB);
  assert.equal(!s.ok && s.code, "ic_hata");
  assert.equal(k.c.say("sohbetiSil"), 0);
  assert.equal(k.c.say("kaldir"), 0);
  await k.t.bekle();
});

test("sohbetiSil: eski_surec_cikti:false: transkript.sil ve oturumKayitlariniSil çağrılmaz", async () => {
  const k = kur();
  assert.equal(k.t.sohbetiSil(SB).ok, true);
  k.sonlandirBitir({ eski_surec_cikti: false });
  await k.t.bekle();
  assert.equal(k.c.say("transkript.sil"), 0);
  assert.equal(k.c.say("oturumKayitlariniSil"), 0);
  assert.equal(k.gunluk.bul("transkript_atlandi").length, 1);
});

test("sohbetiSil: silinemeyen > 0 ise oturumKayitlariniSil çağrılmaz", async () => {
  const k = kur();
  k.transkript.sonrakiSonuc({ silinen: 1, bulunamayan: 0, silinemeyen: 1, reddedilen: 0 });
  assert.equal(k.t.sohbetiSil(SB).ok, true);
  k.sonlandirBitir();
  await k.t.bekle();
  assert.equal(k.c.say("transkript.sil"), 1);
  assert.equal(k.c.say("oturumKayitlariniSil"), 0);
});

test("sohbetiSil: walDaralt atarsa sonuç yine başarı, arka iş sürer", async () => {
  const k = kur({ walHata: new Error("wal") });
  assert.deepEqual(k.t.sohbetiSil(SB), { ok: true, deger: { seq: 60 } });
  k.sonlandirBitir();
  await k.t.bekle();
  assert.equal(k.c.say("transkript.sil"), 1);
});

test("sohbetiSil: transkript.sil atarsa bekle() atmaz", async () => {
  const k = kur();
  k.transkript.sonrakiHata(new Error("kilit"));
  assert.equal(k.t.sohbetiSil(SB).ok, true);
  k.sonlandirBitir();
  await assert.doesNotReject(k.t.bekle());
  assert.equal(k.c.say("oturumKayitlariniSil"), 0);
});

test("sohbetiSil: kapat() sonrası ic_hata; süren arka işi bekler", async () => {
  const k = kur();
  assert.equal(k.t.sohbetiSil(SB).ok, true);
  let kapandi = false;
  const p = k.t.kapat().then(() => (kapandi = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(kapandi, false);
  const s = k.t.sohbetiSil(SB);
  assert.equal(!s.ok && s.code, "ic_hata");
  k.sonlandirBitir();
  await p;
  assert.equal(kapandi, true);
  assert.equal(k.c.say("sohbetiSil"), 1);
});

test("sohbetiSil günlüğü: metin/oturum kimliği yok, alan değerleri sayı/boolean (sohbet_id hariç)", async () => {
  const k = kur();
  k.t.sohbetiSil(SB);
  k.sonlandirBitir();
  await k.t.bekle();
  assert.ok(k.gunluk.girdiler.length > 0);
  for (const g of k.gunluk.girdiler) {
    for (const [ad, v] of Object.entries(g.alanlar ?? {})) {
      assert.ok(
        typeof v === "number" || typeof v === "boolean" || v === null || ad === "sohbet_id",
        `${g.olay}.${ad} = ${String(v)}`,
      );
    }
  }
  const tum = JSON.stringify(k.gunluk.girdiler);
  assert.ok(!tum.includes(U1) && !tum.includes(U2), "oturum kimliği günlükte");
});

// ---- Gerçek depo: sohbetiSil / gecmisiSil uçtan uca (fake: sohbetler, planlar, transkript) ----

const UB = "44444444-4444-4444-8444-444444444444"; // B'nin başarısız devir adayı (yalnız eren_oturumlari)
const UA = "55555555-5555-4555-8555-555555555555"; // A'nın başarısız devir adayı

const pcPlan = (plan_id: string): Plan => ({
  plan_id,
  baslik: "Örnek iş",
  tur: "pc",
  cwd: "C:\\ornek\\proje",
  gorev_metni: "görev",
  mcp_profili: "rea",
});

const planKaydi = (plan: Plan, sohbet_id: SohbetId, durum: PlanKaydi["durum"] = "bekliyor"): PlanKaydi => ({
  plan,
  plan_hash: planHash(plan),
  durum,
  is_id: null,
  olusturma_ms: 1000,
  profil: "tam",
  sohbet_id,
});

const isGirdisi = (plan_id: string, sohbet_id: SohbetId, durum: IsKaydi["durum"]): Omit<IsKaydi, "is_id"> => ({
  sohbet_id,
  plan_id,
  plan_hash: "a".repeat(64),
  baslik: "baslik",
  tur: "pc",
  cwd: "C:\\ornek\\proje",
  durum,
  kirli: false,
  session_id: "66666666-6666-4666-8666-666666666666",
  pid: null,
  olusturma_ms: null,
  baslangic_ms: 5000,
  bitis_ms: durum === "calisiyor" ? null : 6000,
  out_ofset: 0,
  rapor: null,
  rapor_kaynak: null,
  son_result: null,
  durdurma: null,
});

const nesilKaydi = (nesil: number, sohbet_id: SohbetId): NesilKaydi => ({
  nesil,
  sohbet_id,
  session_id: `33333333-3333-4333-8333-${String(nesil).padStart(12, "3")}`,
  baslangic_ms: nesil * 10,
  bitis_ms: null,
  ozet_kabul: null,
  pid: null,
  olusturma_ms: null,
  son_dolu: null,
  pencere: null,
});

const nesilSession = (nesil: number): string => nesilKaydi(nesil, A_ID).session_id;

/** İki sohbetli gerçek depo: A (nesil 1) ve B (nesiller 2, 3); her ikisinde olay, plan, iş, tur, kuyruk. */
function gercek(ayar: { turSuruyor?: SohbetId[] } = {}) {
  const zaman = sahteZaman();
  const gunluk = sahteGunluk();
  const depo: Depo = depoKur({ yol: ":memory:", saat: zaman.saat, gunluk });
  const c = new CagriDefteri();
  const transkript = sahteTranskript();

  for (const id of [A_ID, B_ID]) depo.sohbetEkle({ sohbet_id: id, ad: `Sohbet ${id}`, olusturma_ms: 10, son_etkinlik_ms: 10 });
  const nesiller: Record<string, number[]> = { [A_ID]: [1], [B_ID]: [2, 3] };
  for (const [id, liste] of Object.entries(nesiller)) for (const n of liste) depo.nesilEkle(nesilKaydi(n, id));
  depo.oturumKaydet(UA, 20, S);
  depo.oturumKaydet(UB, 20, SB);

  for (const id of [A_ID, B_ID]) {
    const girdiler: OlayGirdisi[] = [
      { type: "user_echo", sohbet_id: id, client_msg_id: `m-${id}`, input: "yazi", text: `merhaba ${id}` },
      { type: "assistant_message", sohbet_id: id, turn_id: `t-${id}`, text: `cevap ${id}` },
    ];
    for (const g of girdiler) depo.olayEkle(g);
    depo.turEkle({
      turn_id: `t-${id}`,
      sohbet_id: id,
      nesil: nesiller[id]![0]!,
      kaynak: "insan",
      gorunur: true,
      baslangic_ms: 100,
      bitis_ms: null,
      bitis: null,
      kismi_metin: "",
    });
    depo.turBitir(`t-${id}`, "tamam", "kısmi", 200);
    depo.kuyrugaEkle("insan", `bekleyen ${id}`, 300, { sohbet_id: id });
    // Bekleyen plan (iptal edilecek) ve biten iş (kalacak).
    const bekleyen = pcPlan(`bekleyen-${id}`);
    depo.planEkle(planKaydi(bekleyen, id));
    depo.olayEkle({ type: "plan_proposed", sohbet_id: id, plan: bekleyen, plan_hash: planHash(bekleyen) });
    const biten = pcPlan(`biten-${id}`);
    depo.planEkle(planKaydi(biten, id, "onaylandi"));
    depo.isEkle(isGirdisi(`biten-${id}`, id, "tamam"));
  }

  const mesgulTur = new Set<SohbetId>(ayar.turSuruyor ?? []);
  const kayitli = new Set<string>([A_ID, B_ID]);
  const oturumlar = (s: SohbetSecimi): string[] => [
    ...new Set([...depo.nesiller(s).map((n) => n.session_id), ...depo.kayitliOturumlar(s)]),
  ];
  const sohbetler: TemizlikSohbetleri = {
    konusma: (s) => {
      if (!kayitli.has(s.sohbet_id)) return null;
      return {
        temizlenebilirMi: () => !mesgulTur.has(s.sohbet_id),
        yeniSayfa: async () => {
          c.ekle("yeniSayfa", s.sohbet_id);
          return { eski_oturumlar: oturumlar(s), eski_surec_cikti: true, yeni_nesil_acildi: true };
        },
      };
    },
    kaldir: (s) => {
      c.ekle("kaldir", s.sohbet_id);
      if (!kayitli.delete(s.sohbet_id)) return null;
      return {
        sonlandir: async () => {
          c.ekle("sonlandir", s.sohbet_id);
          return { eski_oturumlar: oturumlar(s), eski_surec_cikti: true };
        },
      };
    },
  };
  const planlar = {
    bekleyenleriIptal: (s: SohbetSecimi): number => {
      let n = 0;
      for (const p of depo.bekleyenPlanlar(s)) {
        depo.planGuncelle(p.plan.plan_id, "iptal", null);
        depo.olayEkle({
          type: "plan_resolved",
          sohbet_id: s.sohbet_id,
          plan_id: p.plan.plan_id,
          plan_hash: p.plan_hash,
          sonuc: "iptal",
        });
        n++;
      }
      c.ekle("bekleyenleriIptal", s.sohbet_id, n);
      return n;
    },
  };
  const t = temizlikKur({
    depo,
    sohbetler,
    isler: { aktifSayisi: (s) => depo.isListele(true, 100, s).length },
    planlar,
    transkript,
    saat: { simdiMs: () => 9000 },
    gunluk,
  });
  const olaylar = (id: SohbetId) =>
    depo.olaylariGetir(0, 10_000).filter((o) => (o as { sohbet_id?: string }).sohbet_id === id);
  return { depo, t, c, transkript, gunluk, olaylar, mesgulTur, kayitli };
}

test("gerçek depo: sohbetiSil(B) başarı: planlar iptal, sonlandir, transkript, chat_deleted, kaldir, iş kayıtları ve A kalır", async () => {
  const k = gercek();
  const aOnce = k.olaylar(A_ID).length;
  const aKuyruk = k.depo.kuyrukBasi(S);
  assert.ok(aKuyruk);

  const s = k.t.sohbetiSil(SB);
  assert.ok(s.ok);
  await k.t.bekle();

  // chat_deleted yazıldı, seq = ack.seq; chat_cleared yok.
  const bOlaylar = k.olaylar(B_ID);
  const silindi = bOlaylar.filter((o) => o.type === "chat_deleted");
  assert.equal(silindi.length, 1);
  assert.equal(s.ok && s.deger.seq, silindi[0]!.seq);
  assert.equal(bOlaylar.filter((o) => o.type === "chat_cleared").length, 0, "ayrı chat_cleared yazılmaz");
  assert.deepEqual(
    bOlaylar.map((o) => o.type),
    ["chat_deleted"],
    "B'nin başka olayı kalmaz (plan_resolved{iptal} dahil silinir)",
  );

  // Sohbet satırı silinmiş; kaldir çağrıldı; sonlandir çağrıldı.
  assert.equal(k.depo.sohbetGetir(SB)!.silinme_ms, 9000);
  assert.equal(k.c.say("kaldir"), 1);
  assert.equal(k.c.son("kaldir")!.args[0], B_ID);
  assert.equal(k.c.say("sonlandir"), 1);
  assert.equal(k.c.son("sonlandir")!.args[0], B_ID);

  // Bekleyen planlar iptal (yalnız B'nin), A'nınki bekliyor.
  assert.equal(k.c.son("bekleyenleriIptal")!.args[1], 1);
  assert.equal(k.depo.planGetir(`bekleyen-${B_ID}`)!.durum, "iptal");
  assert.equal(k.depo.planGetir(`bekleyen-${A_ID}`)!.durum, "bekliyor");
  assert.deepEqual(k.depo.bekleyenPlanlar(S).map((p) => p.plan.plan_id), [`bekleyen-${A_ID}`]);
  assert.deepEqual(k.depo.bekleyenPlanlar(SB), []);

  // Transkript: yalnız B'nin oturumları (nesiller 2, 3 + kayıtlı UB), A'nınkiler değil.
  assert.equal(k.transkript.silinenIstekler.length, 1);
  assert.deepEqual([...k.transkript.silinenIstekler[0]!].sort(), [nesilSession(2), nesilSession(3), UB].sort());
  assert.deepEqual([...k.transkript.silinenOturumlar].sort(), [nesilSession(2), nesilSession(3), UB].sort());
  assert.ok(!k.transkript.silinenOturumlar.includes(nesilSession(1)));
  assert.ok(!k.transkript.silinenOturumlar.includes(UA));

  // Oturum kayıtları B için silindi; A'nınki kaldı.
  assert.deepEqual(k.depo.kayitliOturumlar(SB), []);
  assert.deepEqual([...k.depo.kayitliOturumlar(S)], [UA]);

  // İş kayıtları kalır (iş kaydı ilkesi).
  assert.equal(k.depo.isListele(false, 100, SB).length, 1);
  assert.equal(k.depo.isListele(false, 100, S).length, 1);

  // Başka sohbetin verisi kalır.
  assert.equal(k.olaylar(A_ID).length, aOnce);
  assert.equal(k.depo.sohbetGetir(S)!.silinme_ms, null);
  assert.equal(k.depo.sonKonusma(10, S).length, 2);
  assert.ok(k.depo.kuyrukBasi(S));
  assert.equal(k.depo.kuyrukBasi(SB), null, "B'nin kuyruğu silinir");
  assert.equal(k.depo.sonNesil(S)!.nesil, 1);
  assert.equal(k.depo.nesiller(SB).length, 2, "nesil kayıtları kalır");
});

test("gerçek depo: sohbetiSil sonrası aynı sohbete ikinci silme ve geçmiş silme sohbet_bulunamadi", async () => {
  const k = gercek();
  assert.ok(k.t.sohbetiSil(SB).ok);
  await k.t.bekle();
  const ikinci = k.t.sohbetiSil(SB);
  assert.equal(!ikinci.ok && ikinci.code, "sohbet_bulunamadi");
  const gecmis = k.t.gecmisiSil(SB);
  assert.equal(!gecmis.ok && gecmis.code, "sohbet_bulunamadi");
  assert.equal(k.olaylar(B_ID).filter((o) => o.type === "chat_deleted").length, 1);
});

test("gerçek depo: ana sohbet_silinemez, hiçbir şey silinmez", async () => {
  const k = gercek();
  const once = k.depo.olaylariGetir(0, 10_000).length;
  const s = k.t.sohbetiSil(ANA);
  assert.equal(!s.ok && s.code, "sohbet_silinemez");
  await k.t.bekle();
  assert.equal(k.depo.olaylariGetir(0, 10_000).length, once);
  assert.equal(k.transkript.silinenIstekler.length, 0);
  assert.equal(k.c.say("kaldir"), 0);
  assert.equal(k.depo.bekleyenPlanlar(S).length, 1);
});

/** Gerçek depoda her meşgul koşulu: hiçbir şey silinmez, plan iptal edilmez, kaldir çağrılmaz. */
const gercekMesgul: Array<[string, (k: ReturnType<typeof gercek>) => void]> = [
  [
    "tur sürüyor",
    (k) => {
      k.mesgulTur.add(B_ID);
    },
  ],
  [
    "devir sürüyor (temizlenebilirMi yanlış)",
    (k) => {
      k.mesgulTur.add(B_ID);
    },
  ],
  [
    "çalışan iş",
    (k) => {
      const plan = pcPlan("calisan-b");
      k.depo.planEkle(planKaydi(plan, B_ID, "onaylandi"));
      k.depo.isEkle(isGirdisi("calisan-b", B_ID, "calisiyor"));
    },
  ],
  [
    "bekleyen soru",
    (k) => {
      const is = k.depo.isListele(false, 100, SB)[0]!;
      k.depo.soruEkle({
        soru_id: "soru-b",
        is_id: is.is_id,
        soru: "hangisi?",
        secenekler: ["a", "b"],
        durum: "bekliyor",
        cevap: null,
        olusturma_ms: 150,
        son_ms: 150,
      });
    },
  ],
];

for (const [ad, hazirla] of gercekMesgul) {
  test(`gerçek depo: sohbetiSil: ${ad}: sohbet_mesgul, hiçbir şey silinmez`, async () => {
    const k = gercek();
    hazirla(k);
    const olayOnce = JSON.stringify(k.depo.olaylariGetir(0, 10_000));
    const s = k.t.sohbetiSil(SB);
    assert.equal(!s.ok && s.code, "sohbet_mesgul");
    await k.t.bekle();
    assert.equal(JSON.stringify(k.depo.olaylariGetir(0, 10_000)), olayOnce, "olay yazılmadı/silinmedi");
    assert.equal(k.depo.sohbetGetir(SB)!.silinme_ms, null);
    assert.equal(k.depo.planGetir(`bekleyen-${B_ID}`)!.durum, "bekliyor", "plan iptal edilmedi");
    assert.equal(k.c.say("bekleyenleriIptal"), 0);
    assert.equal(k.c.say("kaldir"), 0);
    assert.equal(k.c.say("sonlandir"), 0);
    assert.equal(k.transkript.silinenIstekler.length, 0);
    assert.deepEqual([...k.depo.kayitliOturumlar(SB)], [UB]);
    assert.ok(k.depo.kuyrukBasi(SB), "kuyruk durur");
  });
}

test("gerçek depo: gecmisiSil(B): yalnız B'nin geçmişi gider, sohbet silinmez, A'nın verisi kalır", async () => {
  const k = gercek();
  const aOnce = k.olaylar(A_ID).length;
  const s = k.t.gecmisiSil(SB);
  assert.ok(s.ok);
  await k.t.bekle();

  const bOlaylar = k.olaylar(B_ID);
  assert.deepEqual(
    bOlaylar.map((o) => o.type),
    ["chat_cleared"],
    "B'de yalnız mezar taşı kalır",
  );
  assert.equal(s.ok && s.deger.mezar_seq, bOlaylar[0]!.seq);
  assert.equal(k.olaylar(A_ID).filter((o) => o.type === "chat_cleared").length, 0);
  assert.equal(k.olaylar(A_ID).length, aOnce, "A'nın olayları kalır");
  assert.equal(k.depo.sohbetGetir(SB)!.silinme_ms, null, "sohbet silinmez");
  assert.equal(k.c.say("kaldir"), 0);
  assert.equal(k.c.say("sonlandir"), 0);
  assert.equal(k.depo.planGetir(`bekleyen-${B_ID}`)!.durum, "iptal");
  assert.equal(k.depo.planGetir(`bekleyen-${A_ID}`)!.durum, "bekliyor");
  assert.equal(k.depo.kuyrukBasi(SB), null);
  assert.ok(k.depo.kuyrukBasi(S));
  // Transkript yalnız B'nin eski oturumları için.
  assert.equal(k.c.say("yeniSayfa"), 1);
  assert.equal(k.c.son("yeniSayfa")!.args[0], B_ID);
  assert.deepEqual([...k.transkript.silinenOturumlar].sort(), [nesilSession(2), nesilSession(3), UB].sort());
});

test("gerçek depo: gecmisiSil(B) A'nın meşgul olmasından etkilenmez; A meşgulken A reddedilir", async () => {
  const k = gercek({ turSuruyor: [A_ID] });
  const a = k.t.gecmisiSil(S);
  assert.equal(!a.ok && a.code, "sohbet_mesgul");
  assert.equal(k.olaylar(A_ID).some((o) => o.type === "chat_cleared"), false);
  const b = k.t.gecmisiSil(SB);
  assert.ok(b.ok);
  await k.t.bekle();
  assert.equal(k.olaylar(B_ID).some((o) => o.type === "chat_cleared"), true);
});

// ---- Medya dalgası (S7): sohbet medyasının silinmesi ----
// MODULLER "Medya dalgası" > "Silme" ve "S7 temizlik"; sozlesme.ts `TemizlikBagimliliklari.medya`,
// `MedyaYoneticisi.sohbetMedyasiniSil`. Yeniden deneme ve kota tahliyesi yöneticinindir (S4): burada
// yalnız temizliğin çağrı kuralı sınanır.

/** Sahte yöneticiyi saran yüz: çağrıyı ortak deftere yazar; `ertele` ise söz testten çözülür. */
function medyaKur(ayar: { ertele?: boolean; red?: Error; at?: Error } = {}) {
  const y = sahteMedyaYoneticisi();
  const bekleyen: Ertel<void>[] = [];
  let defter: CagriDefteri | null = null;
  const yuz: TemizlikMedyaYuzu = {
    sohbetMedyasiniSil: (s) => {
      defter?.ekle("medya.sohbetMedyasiniSil", s.sohbet_id);
      if (ayar.at) throw ayar.at;
      const p = y.sohbetMedyasiniSil(s);
      const red = ayar.red;
      if (red) return p.then(() => Promise.reject(red));
      if (!ayar.ertele) return p;
      const e = ertel<void>();
      bekleyen.push(e);
      return p.then(() => e.soz);
    },
  };
  return {
    y,
    yuz,
    bekleyen,
    bagla: (c: CagriDefteri) => {
      defter = c;
    },
  };
}

function medyaliKur(a: Ayar = {}, m: Parameters<typeof medyaKur>[0] = {}) {
  const mk = medyaKur(m);
  const k = kur({ ...a, medya: mk.yuz });
  mk.bagla(k.c);
  return { ...k, m: mk };
}

test("medya: gecmisiSil başarısında sohbetMedyasiniSil(o sohbet) bir kez, depo işleminden sonra, dönüşten önce", async () => {
  const k = medyaliKur({ silinecekMedya: 3 });
  const s = k.t.gecmisiSil(S);
  assert.deepEqual(s, { ok: true, deger: { mezar_seq: 50, sinir_seq: 40 } });
  assert.deepEqual(k.m.y.silinenSohbetler, [A_ID], "çağrı dönüşten önce");
  const a = adlar(k.c);
  assert.ok(a.indexOf("islem.bitti") < a.indexOf("medya.sohbetMedyasiniSil"), JSON.stringify(a));
  k.sayfaBitir();
  await k.t.bekle();
  assert.equal(k.c.say("medya.sohbetMedyasiniSil"), 1);
  const g = k.gunluk.girdiler.find((x) => x.olay === "medya_silme");
  assert.deepEqual(g?.alanlar, { sohbet_id: A_ID, silinecek_medya: 3 });
});

test("medya: sohbetiSil başarısında sohbetMedyasiniSil(o sohbet) bir kez, işlem ve kaldir'dan sonra", async () => {
  const k = medyaliKur({ silinecekMedya: 0 });
  const s = k.t.sohbetiSil(SB);
  assert.deepEqual(s, { ok: true, deger: { seq: 60 } });
  const a = adlar(k.c);
  assert.ok(a.indexOf("islem.bitti") < a.indexOf("medya.sohbetMedyasiniSil"), JSON.stringify(a));
  assert.ok(a.indexOf("kaldir") < a.indexOf("medya.sohbetMedyasiniSil"), JSON.stringify(a));
  assert.deepEqual(k.m.y.silinenSohbetler, [B_ID], "silinecek_medya 0 iken de çağrılır (yeniden deneme)");
  k.sonlandirBitir();
  await k.t.bekle();
  assert.equal(k.c.say("medya.sohbetMedyasiniSil"), 1);
});

test("medya: ack beklemez; söz çözülmeden dönülür, bekle() ve kapat() onu beklemez", async () => {
  const k = medyaliKur({}, { ertele: true });
  assert.equal(k.t.gecmisiSil(S).ok, true);
  assert.equal(k.t.sohbetiSil(SB).ok, true);
  k.sayfaBitir();
  k.sonlandirBitir();
  await k.t.bekle();
  await new Promise((r) => setImmediate(r));
  // İki medya sözü de hâlâ çözülmedi; temizliğin bekle()'si ve kapat()'ı yine de döner.
  assert.equal(k.m.bekleyen.length, 2);
  await k.t.kapat();
  for (const e of k.m.bekleyen) e.coz();
});

for (const [ad, m] of [
  ["reddederse", { red: new TypeError("x") }],
  ["eşzamanlı atarsa", { at: new RangeError("y") }],
] as const) {
  test(`medya: sohbetMedyasiniSil ${ad} sonuç yine başarı, günlüğe hata türü, sonraki silme yine çağırır`, async () => {
    const k = medyaliKur({}, m);
    assert.equal(k.t.gecmisiSil(S).ok, true);
    k.sayfaBitir();
    await k.t.bekle();
    await new Promise((r) => setImmediate(r));
    const g = k.gunluk.girdiler.find((x) => x.olay === "medya_silme_hata");
    assert.ok(g, JSON.stringify(k.gunluk.girdiler));
    assert.equal(g.alanlar?.["sohbet_id"], A_ID);
    assert.equal(g.alanlar?.["hata_turu"], ("red" in m ? m.red : m.at).name);
    // Silinemeyenler sonraki silmede yeniden denenir: temizlik çağrıyı yine yapar.
    assert.equal(k.t.sohbetiSil(SB).ok, true);
    assert.equal(k.c.say("medya.sohbetMedyasiniSil"), 2);
    k.sonlandirBitir();
    await k.t.bekle();
    await new Promise((r) => setImmediate(r));
  });
}

for (const [ad, ayar, cagir] of [
  ["gecmisiSil ön koşul tutmaz", { aktif: 1 }, "gecmisiSil"],
  ["gecmisiSil örnek yok", { yok: [A_ID] }, "gecmisiSil"],
  ["gecmisiTemizle atar", { temizlemeHata: new Error("t") }, "gecmisiSil"],
  ["bekleyenleriIptal atar", { iptalHata: new Error("i") }, "gecmisiSil"],
  ["sohbetiSil ön koşul tutmaz", { sorular: 1 }, "sohbetiSil"],
  ["depo.sohbetiSil atar", { sohbetiSilHata: new Error("s") }, "sohbetiSil"],
] as const) {
  test(`medya: ${ad}: sohbetMedyasiniSil çağrılmaz`, async () => {
    const k = medyaliKur(ayar);
    const s = cagir === "gecmisiSil" ? k.t.gecmisiSil(S) : k.t.sohbetiSil(SB);
    assert.equal(s.ok, false);
    k.sayfaBitir();
    await k.t.bekle();
    assert.deepEqual(k.m.y.silinenSohbetler, []);
  });
}

test("medya: ana sohbet_silinemez iken çağrı yok; ana'nın geçmişi silinince çağrı var", async () => {
  const k = medyaliKur();
  assert.equal(k.t.sohbetiSil(ANA).ok, false);
  assert.deepEqual(k.m.y.silinenSohbetler, []);
  assert.equal(k.t.gecmisiSil(ANA).ok, true);
  assert.deepEqual(k.m.y.silinenSohbetler, [ANA_SOHBET_ID]);
  k.sayfaBitir({}, ANA_SOHBET_ID);
  await k.t.bekle();
});

test("medya: kaldir atsa da sohbet silinmiştir, medya yine silinir", async () => {
  const k = medyaliKur({ kaldirHata: new Error("k") });
  assert.equal(k.t.sohbetiSil(SB).ok, true);
  assert.deepEqual(k.m.y.silinenSohbetler, [B_ID]);
  await k.t.bekle();
});

test("medya: kapat() sonrası çağrı yok", async () => {
  const k = medyaliKur();
  await k.t.kapat();
  assert.equal(k.t.gecmisiSil(S).ok, false);
  assert.equal(k.t.sohbetiSil(SB).ok, false);
  assert.deepEqual(k.m.y.silinenSohbetler, []);
});

test("medya: yalnız silinen sohbetin medyası (sahte yönetici başka sohbetin ekine dokunmaz)", async () => {
  const k = medyaliKur();
  const ek = (id: string) => ({ medya_id: id, tur: "foto", mime: "image/jpeg", boyut: 10 }) as never;
  const ekA = k.m.y.ekKoy("cihaz", A_ID, ek("m-a"));
  const ekB = k.m.y.ekKoy("cihaz", B_ID, ek("m-b"));
  assert.equal(k.t.sohbetiSil(SB).ok, true);
  assert.equal(ekB.durum, "silinecek");
  assert.equal(ekA.durum, "kabul");
  k.sonlandirBitir();
  await k.t.bekle();
});

test("medya verilmezse: silinecek_medya dolu olsa da medya günlük satırı yok, akış bugünkü", async () => {
  const k = kur({ silinecekMedya: 2 });
  assert.equal(k.t.gecmisiSil(S).ok, true);
  assert.equal(k.t.sohbetiSil(SB).ok, true);
  k.sayfaBitir();
  k.sonlandirBitir();
  await k.t.bekle();
  assert.ok(!k.gunluk.girdiler.some((g) => g.olay.startsWith("medya_")), JSON.stringify(k.gunluk.girdiler));
});

test("medya: günlükte hata iletisi yok; yalnız sohbet_id, sayı ve hata türü", async () => {
  const k = medyaliKur({ silinecekMedya: 4 }, { red: new Error("gizli yol C:\\x") });
  k.t.gecmisiSil(S);
  k.sayfaBitir();
  await k.t.bekle();
  await new Promise((r) => setImmediate(r));
  const medyaGirdileri = k.gunluk.girdiler.filter((g) => g.olay.startsWith("medya_"));
  assert.equal(medyaGirdileri.length, 2);
  const tum = JSON.stringify(medyaGirdileri);
  assert.ok(!tum.includes("gizli") && !tum.includes("C:"), tum);
  for (const g of medyaGirdileri) {
    for (const [ad, v] of Object.entries(g.alanlar ?? {})) {
      assert.ok(typeof v === "number" || ad === "sohbet_id" || ad === "hata_turu", `${g.olay}.${ad}`);
    }
  }
});
