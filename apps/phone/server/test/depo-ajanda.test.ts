/**
 * Depo, ajanda dalgası (ek göç 6): ajanda kayıtları, tek revizyon sayacı, geçmiş, işlem tekrarsızlığı,
 * depo kimliği, cihaz ve eşleştirme penceresi kapsamı, kuyruk ekleri, ajanda jetonları; göç ve geri
 * alma; "geçmişi sil" ile "sohbeti sil"in ajanda verisine dokunmadığı. MODULLER.md "Ajanda dalgası" > "depo".
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, afterEach, describe, it } from "node:test";
import { ANA_SOHBET_ID, AjandaGecmisGirdisi, AjandaKaydi } from "@eren/protocol";
import type { SohbetId } from "@eren/protocol";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type {
  AjandaDegisiklikYazimi,
  AjandaJetonKapsami,
  CihazKaydi,
  ServisOlaylari,
  SohbetSecimi,
  Veriyolu,
} from "../src/sozlesme.ts";
import { sahteGunluk, sahteZaman } from "./sahte.ts";

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------

const kok = mkdtempSync(join(tmpdir(), "eren-depo-ajanda-test-"));
after(() => rmSync(kok, { recursive: true, force: true }));
let sayac = 0;
const yeniYol = (): string => join(kok, `vt-${++sayac}.db`);

const ANA: SohbetSecimi = { sohbet_id: ANA_SOHBET_ID };
const A_ID: SohbetId = "sohbet-a";
const A: SohbetSecimi = { sohbet_id: A_ID };
const DILIM = "Europe/Istanbul";
const ACIK = Buffer.from("ajanda-acik-anahtar").toString("base64");
const IP = "100.64.0.9";

interface Yayin {
  ad: string;
  veri: unknown;
}

const yakalayici = (): Veriyolu & { yayinlar: Yayin[]; ajanda(): number[] } => {
  const yayinlar: Yayin[] = [];
  return {
    yayinlar,
    yayinla: (ad, veri) => void yayinlar.push({ ad, veri }),
    dinle: () => () => {},
    ajanda: () =>
      yayinlar
        .filter((y) => y.ad === "ajanda_kayit_yazildi")
        .map((y) => (y.veri as ServisOlaylari["ajanda_kayit_yazildi"]).kayit.revizyon),
  };
};

const acilanlar: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acilanlar.splice(0)) {
    try {
      d.kapat();
    } catch {
      // zaten kapalı
    }
  }
});

const kur = (yol = ":memory:") => {
  const zaman = sahteZaman();
  const gunluk = sahteGunluk();
  const veriyolu = yakalayici();
  const depo = depoAc({ yol, saat: zaman.saat, veriyolu, gunluk });
  acilanlar.push(depo);
  return { depo, zaman, gunluk, veriyolu };
};

const hamAc = <T>(yol: string, f: (h: DatabaseSync) => T): T => {
  const h = new DatabaseSync(yol);
  try {
    return f(h);
  } finally {
    h.close();
  }
};
const say = (h: DatabaseSync, tablo: string): number => (h.prepare(`SELECT COUNT(*) AS n FROM ${tablo}`).get() as { n: number }).n;

const AJANDA_TABLOLARI = [
  "ajanda_kayitlari",
  "ajanda_gecmisi",
  "ajanda_islemleri",
  "ajanda_meta",
  "ajanda_jetonlari",
  "ajanda_cihazlari",
  "ajanda_cihaz_iptalleri",
  "ajanda_eslestirme",
  "kuyruk_ekleri",
] as const;

/** Her ajanda tablosunun satır sayısı ve içeriği (karşılaştırma için). */
const ajandaDokumu = (yol: string): Record<string, unknown[]> =>
  hamAc(yol, (h) =>
    Object.fromEntries(
      AJANDA_TABLOLARI.filter((t) => t !== "kuyruk_ekleri").map((t) => [t, h.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]),
    ),
  );

const ELLE = { yol: "elle", tur_kokeni: "insan", device_id: "cihaz-tel" } as const;

type Govde = Omit<AjandaKaydi, "revizyon" | "guncelleme_ms">;

const kayitGovdesi = (kayit_id: string, ek: Partial<Govde> = {}): Govde => ({
  kayit_id,
  tur: "randevu",
  baslik: "Dişçi ☕️",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM, ifade: "yarın 3'te" },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  ornekler: [],
  durum: "acik",
  taslak: false,
  silindi: false,
  elle_alanlar: [],
  kaynak: { ...ELLE },
  olusturma_ms: 1000,
  ...ek,
});

const ekle = (kayit_id: string, ts_ms = 1000, ek: Partial<Govde> = {}): AjandaDegisiklikYazimi => {
  const kayit = kayitGovdesi(kayit_id, { olusturma_ms: ts_ms, ...ek });
  return {
    kayit,
    girdi: { islem: "ekle", yazar: { ...ELLE }, onceki: {}, sonraki: { tur: kayit.tur, baslik: kayit.baslik } },
    ts_ms,
  };
};

const guncelle = (onceki: AjandaKaydi, ek: Partial<Govde>, ts_ms: number): AjandaDegisiklikYazimi => {
  const { revizyon: _r, guncelleme_ms: _g, ...govde } = onceki;
  return {
    kayit: { ...govde, ...ek },
    girdi: {
      islem: "guncelle",
      yazar: { ...ELLE },
      temel_revizyon: onceki.revizyon,
      onceki: { baslik: onceki.baslik },
      sonraki: { baslik: ek.baslik ?? onceki.baslik },
    },
    ts_ms,
  };
};

const cihaz = (device_id: string, kapsam?: CihazKaydi["kapsam"]): CihazKaydi => ({
  device_id,
  public_key: ACIK,
  tailscale_ip: IP,
  platform: "android",
  etiket: null,
  eslesme_ms: 10,
  ...(kapsam === undefined ? {} : { kapsam }),
});

const AN = { tarih: "2026-11-25", saat: "23:58", saat_dilimi: DILIM };
const JETON: AjandaJetonKapsami = { rol: "ana_oturum", sohbet_id: ANA_SOHBET_ID, nesil: 3 };

/** Ek göç 6'yı geri sarar: göçten önceki (ek sürüm 5) dosyanın aynısı. */
const ekSurum5eIndir = (yol: string): void =>
  hamAc(yol, (h) => {
    for (const t of AJANDA_TABLOLARI) h.exec(`DROP TABLE IF EXISTS ${t}`);
    h.exec("UPDATE sema_ek SET deger = 5 WHERE anahtar = 'ek_surum'");
  });

// ---------------------------------------------------------------------------------------------
// Ek sürüm 5 kodunun (bu dalgadan önceki `depo.ts`) metinleri, aynen: geri alma sınaması
// ---------------------------------------------------------------------------------------------

const ESKI = {
  cihazGetir:
    "SELECT * FROM cihazlar WHERE device_id = ? AND NOT EXISTS (SELECT 1 FROM cihaz_iptalleri i WHERE i.device_id = cihazlar.device_id)",
  cihazEkle: `INSERT INTO cihazlar (device_id, public_key, tailscale_ip, platform, etiket, eslesme_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (device_id) DO UPDATE SET public_key = excluded.public_key,
           tailscale_ip = excluded.tailscale_ip, platform = excluded.platform,
           etiket = excluded.etiket, eslesme_ms = excluded.eslesme_ms`,
  eslestirmeOku: "SELECT kod_ozeti, son_ms, yanlis_deneme FROM eslestirme WHERE id = 1",
  eslestirmeYaz: "INSERT OR REPLACE INTO eslestirme (id, kod_ozeti, son_ms, yanlis_deneme) VALUES (1, ?, ?, ?)",
  jetonBul: "SELECT * FROM kopru_jetonlari WHERE ozet = ?",
  kuyrugaEkle: "INSERT INTO eren_kuyrugu (sohbet_id, kaynak, metin, olusturma_ms) VALUES (?, ?, ?, ?)",
  kuyrukBasi: "SELECT * FROM eren_kuyrugu WHERE sohbet_id = ? ORDER BY id LIMIT 1",
  kuyruktanSil: "DELETE FROM eren_kuyrugu WHERE id = ?",
  /** Eski açılış: yalnız `user_version` denetlenir; `ek_surum` eski kodun 5'inden büyükse açılış sürer. */
  userVersion: "PRAGMA user_version",
} as const;

// ---------------------------------------------------------------------------------------------
// Göç
// ---------------------------------------------------------------------------------------------

describe("depo ajanda: göç (ek göç 6)", () => {
  it("boş dosya: ek_surum 6, bütün ajanda tabloları STRICT, ikinci açılış yinelemez", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    assert.deepEqual(a.semaBilgisi(), { user_version: 1, ek_surum: 6 });
    a.kapat();
    hamAc(yol, (h) => {
      const tablolar = h.prepare("PRAGMA table_list").all() as Array<{ name: string; strict: number }>;
      for (const t of AJANDA_TABLOLARI) assert.equal(tablolar.find((x) => x.name === t)?.strict, 1, t);
    });
    const b = kur(yol).depo;
    assert.deepEqual(b.semaBilgisi(), { user_version: 1, ek_surum: 6 });
  });

  it("ek sürüm 5 dosyası: göç bir kez uygulanır, eski veri durur, ajanda yazılabilir", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    a.cihazEkle(cihaz("tel-eski"));
    a.kuyrugaEkle("insan", "merhaba", 5, ANA);
    a.eslestirmeYaz({ kod_ozeti: "oz", son_ms: 9000, yanlis_deneme: 1 });
    a.kapat();
    ekSurum5eIndir(yol);
    hamAc(yol, (h) => assert.equal(h.prepare("SELECT name FROM sqlite_master WHERE name = 'ajanda_kayitlari'").get(), undefined));

    const b = kur(yol).depo;
    assert.deepEqual(b.semaBilgisi(), { user_version: 1, ek_surum: 6 });
    assert.equal(b.cihazGetir("tel-eski")?.device_id, "tel-eski");
    assert.equal(b.kapsamliCihazGetir("tel-eski")?.kapsam, undefined, "eski cihaz sohbet kapsamında");
    assert.deepEqual(b.eslestirmeOku(), { kod_ozeti: "oz", son_ms: 9000, yanlis_deneme: 1 }, "eski pencere sohbet");
    const bas = b.kuyrukBasi(ANA);
    assert.equal(bas?.metin, "merhaba");
    assert.equal(bas?.mesaj_ani, undefined, "eski satırın eki yok");
    assert.equal(b.ajandaDegisiklikYaz(ekle("k1")).revizyon, 1);
    b.kapat();
    const c = kur(yol).depo;
    assert.equal(c.ajandaKaydiGetir("k1")?.revizyon, 1, "ikinci açılış veriyi silmez");
  });

  it("sayacı geri kalmış dosyada göç 6 yeniden uygulanabilir (yalnız IF NOT EXISTS), veri durur", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    a.ajandaDegisiklikYaz(ekle("k1"));
    a.ajandaIslemSonucuYaz("cihaz-tel", "is-1", { ok: true, kayit_id: "k1", rev: 1 }, 1000);
    a.kapat();
    const once = ajandaDokumu(yol);
    hamAc(yol, (h) => h.exec("UPDATE sema_ek SET deger = 4 WHERE anahtar = 'ek_surum'"));
    const b = kur(yol).depo;
    assert.deepEqual(b.semaBilgisi(), { user_version: 1, ek_surum: 6 });
    b.kapat();
    assert.deepEqual(ajandaDokumu(yol), once);
  });

  it("geri alma: eski kod yeni şemayı açar ve ajanda cihazını, penceresini, jetonunu görmez; eski yazımlar geçer", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    a.cihazEkle(cihaz("tel-sohbet"));
    a.cihazEkle(cihaz("tel-ajanda", "ajanda"));
    a.eslestirmeYaz({ kod_ozeti: "oz-ajanda", son_ms: 5000, yanlis_deneme: 0, kapsam: "ajanda" });
    a.ajandaJetonEkle({ ozet: "oz-jeton", kapsam: JETON });
    a.ajandaDegisiklikYaz(ekle("k1"));
    const kuyrukId = a.islem(() => {
      const id = a.kuyrugaEkle("insan", "yarın 3'te dişçi", 7, ANA);
      a.kuyrukEkiYaz(id, { mesaj_ani: AN, kaynak_msg_id: "msg-1" });
      return id;
    });
    a.kapat();
    const ajandaOnce = ajandaDokumu(yol);

    hamAc(yol, (h) => {
      // Eski açılış: `user_version` 1, `ek_surum` eski kodun bildiğinden büyük: açılış sürer.
      assert.equal((h.prepare(ESKI.userVersion).get() as { user_version: number }).user_version, 1);
      // Kapsamı bilmeyen kod ajanda cihazını tanımaz: `/sohbet`'e anahtarıyla giremez.
      assert.equal(h.prepare(ESKI.cihazGetir).get("tel-ajanda"), undefined);
      assert.equal((h.prepare(ESKI.cihazGetir).get("tel-sohbet") as { device_id: string }).device_id, "tel-sohbet");
      // Ajanda penceresi eski kodun `/sohbet` eşleştirmesine açık değil.
      assert.equal(h.prepare(ESKI.eslestirmeOku).get(), undefined);
      // Ajanda jetonu `eren` borusunda başka rol diye okunamaz.
      assert.equal(h.prepare(ESKI.jetonBul).get("oz-jeton"), undefined);
      // Eski kuyruk okuması satırı okur (ek ayrı tabloda), eski silme yetim ek bırakır.
      assert.equal((h.prepare(ESKI.kuyrukBasi).get(ANA_SOHBET_ID) as { id: number }).id, kuyrukId);
      h.prepare(ESKI.kuyruktanSil).run(kuyrukId);
      h.prepare(ESKI.kuyrugaEkle).run(ANA_SOHBET_ID, "insan", "eski kod", 8);
      h.prepare(ESKI.cihazEkle).run("tel-eski-yeni", ACIK, IP, "android", null, 11);
      h.prepare(ESKI.eslestirmeYaz).run("oz-eski", 6000, 0);
      assert.equal(say(h, "kuyruk_ekleri"), 1, "eski kodun bıraktığı yetim ek");
    });

    const { depo: b, gunluk } = kur(yol);
    hamAc(yol, (h) => assert.equal(say(h, "kuyruk_ekleri"), 0, "yetim ek açılışta silinir"));
    assert.equal(gunluk.bul("yetim_kuyruk_eki_silindi", "uyari")[0]?.alanlar?.adet, 1);
    assert.equal(b.kuyrukBasi(ANA)?.metin, "eski kod");
    assert.equal(b.kuyrukBasi(ANA)?.mesaj_ani, undefined);
    assert.equal(b.cihazGetir("tel-eski-yeni")?.device_id, "tel-eski-yeni");
    assert.equal(b.kapsamliCihazGetir("tel-ajanda")?.kapsam, "ajanda");
    // İki pencere (karışık sürüm): sonra açılan (son süresi geç) kazanır.
    assert.deepEqual(b.eslestirmeOku(), { kod_ozeti: "oz-eski", son_ms: 6000, yanlis_deneme: 0 });
    b.kapat();
    const sonra = ajandaDokumu(yol);
    assert.deepEqual(sonra.ajanda_kayitlari, ajandaOnce.ajanda_kayitlari);
    assert.deepEqual(sonra.ajanda_gecmisi, ajandaOnce.ajanda_gecmisi);
    assert.deepEqual(sonra.ajanda_jetonlari, ajandaOnce.ajanda_jetonlari);
  });
});

// ---------------------------------------------------------------------------------------------
// Kayıt, revizyon, geçmiş
// ---------------------------------------------------------------------------------------------

describe("depo ajanda: kayıt, tek revizyon sayacı, geçmiş", () => {
  it("depo kimliği bir kez üretilir, kalıcıdır; yenilenebilir; geçersiz kimlik atar", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    let cagri = 0;
    const uret = () => `depo-${++cagri}`;
    assert.equal(a.ajandaDepoKimligi(uret), "depo-1");
    assert.equal(a.ajandaDepoKimligi(uret), "depo-1");
    assert.equal(cagri, 1);
    a.kapat();
    const b = kur(yol).depo;
    assert.equal(b.ajandaDepoKimligi(uret), "depo-1");
    b.ajandaDepoKimligiYenile("depo-geri");
    assert.equal(b.ajandaDepoKimligi(uret), "depo-geri");
    assert.throws(() => b.ajandaDepoKimligiYenile("boşluklu kimlik"));
    const c = kur().depo;
    assert.throws(() => c.ajandaDepoKimligi(() => "geçersiz kimlik!"));
    assert.equal(c.ajandaDepoKimligi(() => "depo-x"), "depo-x", "atan üretim yazılmadı");
  });

  it("ekle: revizyon tek sayaçtan, guncelleme_ms = geçmiş ts_ms; kayıtlar arası sayaç ortak ve kesin artan", () => {
    const { depo } = kur();
    assert.equal(depo.ajandaBasRev(), 0);
    const k1 = depo.ajandaDegisiklikYaz(ekle("k1", 1000));
    const k2 = depo.ajandaDegisiklikYaz(ekle("k2", 2000));
    const k1b = depo.ajandaDegisiklikYaz(guncelle(k1, { baslik: "Dişçi (ertelendi)" }, 3000));
    assert.deepEqual([k1.revizyon, k2.revizyon, k1b.revizyon], [1, 2, 3]);
    assert.equal(k1b.guncelleme_ms, 3000);
    assert.equal(k1b.olusturma_ms, 1000);
    assert.equal(depo.ajandaBasRev(), 3);
    assert.deepEqual(depo.ajandaKaydiGetir("k1"), k1b);
    assert.equal(AjandaKaydi.safeParse(k1b).success, true);
    assert.deepEqual(depo.ajandaGecmisSatiri(3), { kayit_id: "k1", ts_ms: 3000 });
    assert.equal(depo.ajandaGecmisSatiri(99), null);
    assert.equal(depo.ajandaKaydiGetir("yok"), null);
  });

  it("yayın: işlem bitince, revizyon sırasıyla; geri alınan işlemde hiç; iç işlem dıştakini bekler", () => {
    const { depo, veriyolu } = kur();
    depo.islem(() => {
      depo.ajandaDegisiklikYaz(ekle("k1"));
      depo.ajandaDegisiklikYaz(ekle("k2"));
      assert.deepEqual(veriyolu.ajanda(), [], "işlem sürerken yayın yok");
    });
    assert.deepEqual(veriyolu.ajanda(), [1, 2]);
    assert.throws(() =>
      depo.islem(() => {
        depo.ajandaDegisiklikYaz(ekle("k3"));
        throw new Error("geri al");
      }),
    );
    assert.deepEqual(veriyolu.ajanda(), [1, 2]);
    assert.equal(depo.ajandaKaydiGetir("k3"), null);
    // Dıştaki işlem iç hatayı yakalayıp sürerse yalnız başarılı değişiklik yayınlanır.
    depo.islem(() => {
      assert.throws(() => depo.ajandaDegisiklikYaz(ekle("k1")), /zaten var/);
      depo.ajandaDegisiklikYaz(ekle("k4"));
    });
    assert.equal(veriyolu.ajanda().length, 3);
    const son = veriyolu.yayinlar.at(-1)?.veri as ServisOlaylari["ajanda_kayit_yazildi"];
    assert.equal(son.kayit.kayit_id, "k4");
  });

  it("denetim: şemadan geçmeyen kayıt ya da girdi, yinelenen ekle, olmayan kayda güncelleme, kaynak ya da doğuş değişikliği atar ve hiçbir şey yazmaz", () => {
    const { depo, veriyolu } = kur();
    const k1 = depo.ajandaDegisiklikYaz(ekle("k1"));
    const durum = () => ({ rev: depo.ajandaBasRev(), adet: depo.ajandaKayitSayisi(), yayin: veriyolu.ajanda().length });
    const once = durum();
    const bozuk: AjandaDegisiklikYazimi = ekle("k2", 1000, { baslik: "satır\nsonu" });
    assert.throws(() => depo.ajandaDegisiklikYaz(bozuk));
    assert.throws(() => depo.ajandaDegisiklikYaz({ ...ekle("k2"), girdi: { ...ekle("k2").girdi, islem: "uydurma" as "ekle" } }));
    assert.throws(() => depo.ajandaDegisiklikYaz(ekle("k1")), /zaten var/);
    assert.throws(() => depo.ajandaDegisiklikYaz(guncelle({ ...k1, kayit_id: "yok" }, {}, 2000)), /yok/);
    assert.throws(
      () => depo.ajandaDegisiklikYaz(guncelle(k1, { kaynak: { yol: "elle", tur_kokeni: "insan", device_id: "baska" } }, 2000)),
      /kaynağı/,
    );
    assert.throws(() => depo.ajandaDegisiklikYaz(guncelle(k1, { olusturma_ms: 5 }, 2000)), /oluşturma/);
    // `guncelleme_ms` < `olusturma_ms` (saat geri gitti): şema reddeder.
    assert.throws(() => depo.ajandaDegisiklikYaz(guncelle(k1, {}, 999)));
    assert.deepEqual(durum(), once);
    assert.deepEqual(depo.ajandaKaydiGetir("k1"), k1);
  });

  it("revizyon kapat-aç ve walDaralt (VACUUM) sonrası da geri gitmez", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    a.ajandaDegisiklikYaz(ekle("k1"));
    a.ajandaDegisiklikYaz(ekle("k2"));
    a.kapat();
    const b = kur(yol).depo;
    b.walDaralt();
    assert.equal(b.ajandaDegisiklikYaz(ekle("k3")).revizyon, 3);
    assert.equal(b.ajandaBasRev(), 3);
  });

  it("ajandaRevAraligi: (sonRev, ustRev] aralığı, revizyon artan, mezar taşı dahil, adet sınırı", () => {
    const { depo } = kur();
    const k1 = depo.ajandaDegisiklikYaz(ekle("k1"));
    depo.ajandaDegisiklikYaz(ekle("k2"));
    depo.ajandaDegisiklikYaz(ekle("k3"));
    depo.ajandaDegisiklikYaz(guncelle(k1, { silindi: true }, 2000)); // k1 rev 4, mezar taşı
    const revler = (l: AjandaKaydi[]) => l.map((k) => `${k.kayit_id}@${k.revizyon}`);
    assert.deepEqual(revler(depo.ajandaRevAraligi({ sonRev: 0, ustRev: 4, adet: 100 })), ["k2@2", "k3@3", "k1@4"]);
    assert.deepEqual(revler(depo.ajandaRevAraligi({ sonRev: 2, ustRev: 3, adet: 100 })), ["k3@3"]);
    assert.deepEqual(revler(depo.ajandaRevAraligi({ sonRev: 0, ustRev: 4, adet: 2 })), ["k2@2", "k3@3"]);
    assert.deepEqual(depo.ajandaRevAraligi({ sonRev: 4, ustRev: 4, adet: 10 }), []);
    assert.equal(depo.ajandaRevAraligi({ sonRev: 0, ustRev: 4, adet: 10 }).at(-1)?.silindi, true);
  });

  it("ajandaKayitlari: silinmiş varsayılan dışta, durum ve tür süzgeci, oluşturma sırası güncellemeyle değişmez", () => {
    const { depo } = kur();
    const k1 = depo.ajandaDegisiklikYaz(ekle("k1", 1000, { tur: "gorev", zaman: undefined }));
    depo.ajandaDegisiklikYaz(ekle("k2", 1000, { tur: "not", zaman: undefined }));
    const k3 = depo.ajandaDegisiklikYaz(ekle("k3", 1000));
    depo.ajandaDegisiklikYaz(guncelle(k1, { durum: "tamam" }, 2000));
    depo.ajandaDegisiklikYaz(guncelle(k3, { silindi: true }, 2000));
    const idler = (l: AjandaKaydi[]) => l.map((k) => k.kayit_id);
    assert.deepEqual(idler(depo.ajandaKayitlari()), ["k1", "k2"]);
    assert.deepEqual(idler(depo.ajandaKayitlari({ silinmislerDahil: true })), ["k1", "k2", "k3"]);
    assert.deepEqual(idler(depo.ajandaKayitlari({ durumlar: ["acik"] })), ["k2"]);
    assert.deepEqual(idler(depo.ajandaKayitlari({ durumlar: ["acik", "tamam"], turler: ["gorev"] })), ["k1"]);
    assert.deepEqual(idler(depo.ajandaKayitlari({ turler: [] })), []);
    assert.equal(depo.ajandaKayitSayisi(), 3, "silinmiş dahil");
  });

  it("ajandaTekilEsler: aynı anahtarı saklayanlar, silinmiş dahil, oluşturma sırasıyla", () => {
    const { depo } = kur();
    const arac = (tekil_anahtar: string) =>
      ({ yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: A_ID, tekil_anahtar }) as const;
    const t1 = depo.ajandaDegisiklikYaz(ekle("t1", 1000, { kaynak: arac("t1:aa") }));
    depo.ajandaDegisiklikYaz(ekle("t2", 1000, { kaynak: arac("t1:bb") }));
    depo.ajandaDegisiklikYaz(ekle("t3", 1000, { kaynak: arac("t1:aa") }));
    depo.ajandaDegisiklikYaz(guncelle(t1, { silindi: true }, 2000));
    assert.deepEqual(
      depo.ajandaTekilEsler("t1:aa").map((k) => [k.kayit_id, k.silindi]),
      [
        ["t1", true],
        ["t3", false],
      ],
    );
    assert.deepEqual(depo.ajandaTekilEsler("t1:yok"), []);
  });

  it("ajandaGecmisi: rev azalan, once_rev ile sayfa, adet; girdi gidiş dönüşü şemadan geçer, geçmiş budanmaz", () => {
    const { depo } = kur();
    let k = depo.ajandaDegisiklikYaz(ekle("k1", 1000));
    depo.ajandaDegisiklikYaz(ekle("k2", 1000));
    for (let i = 0; i < 4; i++) k = depo.ajandaDegisiklikYaz(guncelle(k, { baslik: `Başlık ${i}` }, 2000 + i));
    const hepsi = depo.ajandaGecmisi({ kayit_id: "k1", adet: 100 });
    assert.deepEqual(
      hepsi.map((g) => g.rev),
      [6, 5, 4, 3, 1],
    );
    for (const g of hepsi) assert.equal(AjandaGecmisGirdisi.safeParse(g).success, true);
    assert.deepEqual(hepsi[0], {
      rev: 6,
      ts_ms: 2003,
      islem: "guncelle",
      yazar: { ...ELLE },
      temel_revizyon: 5,
      onceki: { baslik: "Başlık 2" },
      sonraki: { baslik: "Başlık 3" },
    });
    assert.deepEqual(
      depo.ajandaGecmisi({ kayit_id: "k1", once_rev: 4, adet: 1 }).map((g) => g.rev),
      [3],
    );
    assert.deepEqual(depo.ajandaGecmisi({ kayit_id: "yok", adet: 5 }), []);
  });
});

// ---------------------------------------------------------------------------------------------
// İşlem tekrarsızlığı
// ---------------------------------------------------------------------------------------------

describe("depo ajanda: işlem tekrarsızlığı", () => {
  it("ilk yazılan kazanır; cihaz başına ayrı; kalıcı retler (gecersiz_islem dahil) yazılır", () => {
    const { depo } = kur();
    assert.equal(depo.ajandaIslemSonucuBul("cihaz-tel", "is-1"), null);
    depo.ajandaIslemSonucuYaz("cihaz-tel", "is-1", { ok: true, kayit_id: "k1", rev: 4 }, 100);
    depo.ajandaIslemSonucuYaz("cihaz-tel", "is-1", { ok: false, code: "kayit_silinmis" }, 200);
    assert.deepEqual(depo.ajandaIslemSonucuBul("cihaz-tel", "is-1"), { ok: true, kayit_id: "k1", rev: 4 });
    assert.equal(depo.ajandaIslemSonucuBul("cihaz-baska", "is-1"), null);
    depo.ajandaIslemSonucuYaz("cihaz-tel", "is-2", { ok: false, code: "gecersiz_islem" }, 300);
    assert.deepEqual(depo.ajandaIslemSonucuBul("cihaz-tel", "is-2"), { ok: false, code: "gecersiz_islem" });
    depo.ajandaIslemSonucuYaz("cihaz-tel", "is-3", { ok: true }, 300);
    assert.deepEqual(depo.ajandaIslemSonucuBul("cihaz-tel", "is-3"), { ok: true }, "yan etkisiz ok: rev yok");
  });

  it("geçici ret (ic_hata) ve şemaya uymayan sonuç yazılmaz, atar", () => {
    const { depo } = kur();
    assert.throws(() => depo.ajandaIslemSonucuYaz("cihaz-tel", "is-1", { ok: false, code: "ic_hata" }, 1), /geçici/);
    assert.throws(() => depo.ajandaIslemSonucuYaz("cihaz-tel", "is-1", { ok: true, code: "kayit_bulunamadi" }, 1));
    assert.throws(() => depo.ajandaIslemSonucuYaz("cihaz-tel", "is-1", { ok: false }, 1));
    assert.throws(() => depo.ajandaIslemSonucuYaz("cihaz-tel", "is 1", { ok: true }, 1));
    assert.equal(depo.ajandaIslemSonucuBul("cihaz-tel", "is-1"), null);
  });

  it("değişiklikle aynı işlemde: işlem geri alınırsa tekrarsızlık kaydı da yok", () => {
    const { depo } = kur();
    assert.throws(() =>
      depo.islem(() => {
        const k = depo.ajandaDegisiklikYaz(ekle("k1"));
        depo.ajandaIslemSonucuYaz("cihaz-tel", "is-1", { ok: true, kayit_id: "k1", rev: k.revizyon }, 1000);
        throw new Error("geri al");
      }),
    );
    assert.equal(depo.ajandaIslemSonucuBul("cihaz-tel", "is-1"), null);
    assert.equal(depo.ajandaKaydiGetir("k1"), null);
  });
});

// ---------------------------------------------------------------------------------------------
// Kapsam: cihaz ve eşleştirme penceresi
// ---------------------------------------------------------------------------------------------

describe("depo ajanda: cihaz ve eşleştirme penceresi kapsamı", () => {
  it("ajanda cihazı cihazGetir/cihazlar'da yok, kapsamliCihazGetir'de kapsam:ajanda; sohbet cihazı alansız", () => {
    const { depo } = kur();
    depo.cihazEkle(cihaz("tel-s"));
    depo.cihazEkle(cihaz("tel-a", "ajanda"));
    assert.equal(depo.cihazGetir("tel-a"), null);
    assert.deepEqual(
      depo.cihazlar().map((c) => c.device_id),
      ["tel-s"],
    );
    assert.deepEqual(depo.kapsamliCihazGetir("tel-a"), cihaz("tel-a", "ajanda"));
    assert.deepEqual(depo.kapsamliCihazGetir("tel-s"), cihaz("tel-s"));
    assert.deepEqual(depo.kapsamliCihazGetir("tel-s"), depo.cihazGetir("tel-s"));
    assert.equal(depo.kapsamliCihazGetir("yok"), null);
    // Aynı kapsamda yeniden eşleşme güncellenir.
    depo.cihazEkle({ ...cihaz("tel-a", "ajanda"), etiket: "yeni" });
    assert.equal(depo.kapsamliCihazGetir("tel-a")?.etiket, "yeni");
  });

  it("bir kimlik tek kapsamdadır: öteki kapsamda varsa ya da kaldırılmışsa cihazEkle atar", () => {
    const { depo } = kur();
    depo.cihazEkle(cihaz("tel-s"));
    depo.cihazEkle(cihaz("tel-a", "ajanda"));
    assert.throws(() => depo.cihazEkle(cihaz("tel-s", "ajanda")), /öteki kapsamda/);
    assert.throws(() => depo.cihazEkle(cihaz("tel-a")), /öteki kapsamda/);
    assert.equal(depo.cihazKaldir("tel-a").sonuc, "kaldirildi");
    assert.throws(() => depo.cihazEkle(cihaz("tel-a", "ajanda")), /kaldırılmış/);
    assert.throws(() => depo.cihazEkle(cihaz("tel-a")), /kaldırılmış/);
  });

  it("ajanda cihazı kaldırılır: anahtarı silinir, kapsamliCihazGetir null, listede kapsamıyla; idempotent", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    depo.cihazEkle(cihaz("tel-s"));
    depo.cihazEkle(cihaz("tel-a", "ajanda"));
    assert.deepEqual(
      depo.eslesmeler().map((e) => [e.device_id, e.kapsam ?? "sohbet", e.iptal_ms]),
      [
        ["tel-a", "ajanda", null],
        ["tel-s", "sohbet", null],
      ],
    );
    const s = depo.cihazKaldir("tel-a");
    assert.equal(s.sonuc, "kaldirildi");
    assert.equal(depo.kapsamliCihazGetir("tel-a"), null);
    assert.equal(depo.cihazKaldir("tel-a").sonuc, "zaten_kaldirilmis");
    assert.equal(depo.cihazKaldir("hic-yok").sonuc, "bulunamadi");
    const liste = depo.eslesmeler();
    assert.deepEqual(liste.at(-1), {
      device_id: "tel-a",
      platform: "android",
      etiket: null,
      eslesme_ms: 10,
      iptal_ms: s.sonuc === "kaldirildi" ? s.iptal_ms : -1,
      kapsam: "ajanda",
    });
    assert.equal(liste[0]?.kapsam, undefined, "etkin sohbet cihazı alansız");
    depo.kapat();
    hamAc(yol, (h) => assert.equal(say(h, "ajanda_cihazlari"), 0));
  });

  it("tek pencere: ajanda penceresi sohbetinkinin yerine geçer ve tersi; yanlış sayacı ve silme kapsamdan bağımsız", () => {
    const { depo } = kur();
    depo.eslestirmeYaz({ kod_ozeti: "oz-s", son_ms: 1000, yanlis_deneme: 0 });
    assert.deepEqual(depo.eslestirmeOku(), { kod_ozeti: "oz-s", son_ms: 1000, yanlis_deneme: 0 });
    depo.eslestirmeYaz({ kod_ozeti: "oz-a", son_ms: 2000, yanlis_deneme: 0, kapsam: "ajanda" });
    assert.deepEqual(depo.eslestirmeOku(), { kod_ozeti: "oz-a", son_ms: 2000, yanlis_deneme: 0, kapsam: "ajanda" });
    depo.eslestirmeYanlisSay();
    assert.equal(depo.eslestirmeOku()?.yanlis_deneme, 1);
    depo.eslestirmeSil();
    assert.equal(depo.eslestirmeOku(), null);
    depo.eslestirmeYaz({ kod_ozeti: "oz-a2", son_ms: 3000, yanlis_deneme: 0, kapsam: "ajanda" });
    depo.eslestirmeYaz({ kod_ozeti: "oz-s2", son_ms: 500, yanlis_deneme: 0, kapsam: "sohbet" });
    assert.deepEqual(depo.eslestirmeOku(), { kod_ozeti: "oz-s2", son_ms: 500, yanlis_deneme: 0 }, "yeni yazılan kazanır");
  });
});

// ---------------------------------------------------------------------------------------------
// Kuyruk ekleri
// ---------------------------------------------------------------------------------------------

describe("depo ajanda: kuyruk satırı eki (varış anı)", () => {
  it("ek satırla okunur (insan ve sentetik); eksiz satır alansız; ikinci yazım öncekinin yerine geçer", () => {
    const { depo } = kur();
    const id1 = depo.islem(() => {
      const id = depo.kuyrugaEkle("sentetik", "iş bitti", 5, A);
      depo.kuyrukEkiYaz(id, { mesaj_ani: AN });
      return id;
    });
    const id2 = depo.kuyrugaEkle("sentetik", "eksiz", 6, A);
    assert.deepEqual(depo.kuyrukSentetikBasi(10, A), [
      { id: id1, sohbet_id: A_ID, kaynak: "sentetik", metin: "iş bitti", olusturma_ms: 5, mesaj_ani: AN },
      { id: id2, sohbet_id: A_ID, kaynak: "sentetik", metin: "eksiz", olusturma_ms: 6 },
    ]);
    const id3 = depo.kuyrugaEkle("insan", "selam", 7, ANA);
    depo.kuyrukEkiYaz(id3, { mesaj_ani: AN, kaynak_msg_id: "msg-1" });
    const yeni = { ...AN, saat: "23:59" };
    depo.kuyrukEkiYaz(id3, { mesaj_ani: yeni });
    assert.deepEqual(depo.kuyrukBasi(ANA), {
      id: id3,
      sohbet_id: ANA_SOHBET_ID,
      kaynak: "insan",
      metin: "selam",
      olusturma_ms: 7,
      mesaj_ani: yeni,
    });
  });

  it("geçersiz an ya da kimlik ve olmayan satır atar; dıştaki işlem geri alınır", () => {
    const { depo } = kur();
    const id = depo.kuyrugaEkle("insan", "selam", 7, ANA);
    assert.throws(() => depo.kuyrukEkiYaz(id, { mesaj_ani: { ...AN, saat: "25:00" } }));
    assert.throws(() => depo.kuyrukEkiYaz(id, { mesaj_ani: AN, kaynak_msg_id: "boşluk var" }));
    assert.throws(() => depo.kuyrukEkiYaz(9999, { mesaj_ani: AN }), /satırı yok/);
    assert.throws(() =>
      depo.islem(() => {
        depo.kuyrugaEkle("insan", "yarım", 8, ANA);
        depo.kuyrukEkiYaz(9999, { mesaj_ani: AN });
      }),
    );
    const bas = depo.kuyrukBasi(ANA);
    assert.equal(bas?.metin, "selam");
    assert.equal(bas?.mesaj_ani, undefined, "atan ek yazılmadı");
    depo.kuyruktanSil([id]);
    assert.equal(depo.kuyrukBasi(ANA), null, "geri alınan işlemin satırı yok");
  });

  it("kuyruktanSil, gecmisiTemizle ve sohbetiSil eki satırla birlikte siler", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    depo.sohbetEkle({ sohbet_id: A_ID, ad: "A", olusturma_ms: 1, son_etkinlik_ms: 1 });
    const ekli = (s: SohbetSecimi) =>
      depo.islem(() => {
        const id = depo.kuyrugaEkle("insan", "x", 5, s);
        depo.kuyrukEkiYaz(id, { mesaj_ani: AN });
        return id;
      });
    const id1 = ekli(ANA);
    ekli(ANA);
    ekli(A);
    const ekSayisi = () => hamAc(yol, (h) => say(h, "kuyruk_ekleri"));
    assert.equal(ekSayisi(), 3);
    depo.kuyruktanSil([id1]);
    assert.equal(ekSayisi(), 2);
    depo.gecmisiTemizle(ANA);
    assert.equal(ekSayisi(), 1);
    depo.sohbetiSil(A, 50);
    assert.equal(ekSayisi(), 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Ajanda jetonları
// ---------------------------------------------------------------------------------------------

describe("depo ajanda: ajanda borusu jetonları", () => {
  it("gidiş dönüş, kapsamla silme (bütün alanlar), hepsini silme; eren jetonlarıyla karışmaz", () => {
    const { depo } = kur();
    const baska: AjandaJetonKapsami = { ...JETON, nesil: 4 };
    depo.ajandaJetonEkle({ ozet: "oz-1", kapsam: JETON });
    depo.ajandaJetonEkle({ ozet: "oz-2", kapsam: baska });
    depo.ajandaJetonEkle({ ozet: "oz-3", kapsam: { ...JETON, sohbet_id: A_ID } });
    depo.jetonEkle({ ozet: "oz-eren", kapsam: { rol: "eren", sohbet_id: ANA_SOHBET_ID, nesil: 3 } });
    assert.deepEqual(depo.ajandaJetonBul("oz-1"), { ozet: "oz-1", kapsam: JETON });
    assert.equal(depo.ajandaJetonBul("oz-eren"), null, "eren jetonu ajanda borusunda yok");
    assert.equal(depo.jetonBul("oz-1"), null, "ajanda jetonu eren borusunda yok");
    depo.ajandaJetonlariSil(JETON);
    assert.equal(depo.ajandaJetonBul("oz-1"), null);
    assert.ok(depo.ajandaJetonBul("oz-2"));
    assert.ok(depo.ajandaJetonBul("oz-3"));
    assert.equal(depo.ajandaJetonlariniSil(), 2);
    assert.equal(depo.ajandaJetonBul("oz-2"), null);
    assert.ok(depo.jetonBul("oz-eren"), "eren jetonu dokunulmadı");
    assert.equal(depo.erenJetonlariniSil(), 1);
  });

  it("tanınmayan roldeki satır (sonraki dilim) null okunur", () => {
    const yol = yeniYol();
    const a = kur(yol).depo;
    a.kapat();
    hamAc(yol, (h) =>
      h.prepare("INSERT INTO ajanda_jetonlari (ozet, rol, sohbet_id, nesil) VALUES (?, ?, ?, ?)").run("oz-pc", "pc_araci", "x", 1),
    );
    assert.equal(kur(yol).depo.ajandaJetonBul("oz-pc"), null);
  });
});

// ---------------------------------------------------------------------------------------------
// "Geçmişi sil" ve "sohbeti sil" ajanda verisine dokunmaz
// ---------------------------------------------------------------------------------------------

describe("depo ajanda: sohbet geçmişini silmek ajandaya dokunmaz", () => {
  it("gecmisiTemizle, sohbetiSil ve walDaralt'tan sonra bütün ajanda tabloları aynı", () => {
    const yol = yeniYol();
    const { depo } = kur(yol);
    depo.sohbetEkle({ sohbet_id: A_ID, ad: "A", olusturma_ms: 1, son_etkinlik_ms: 1 });
    // Sohbetten doğan kayıtlar: kaynakları silinecek sohbetlere bağlı.
    const kaynak = (sohbet_id: SohbetId) =>
      ({ yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id, kaynak_msg_id: "msg-1", alinti: "yarın 3'te dişçi" }) as const;
    const k1 = depo.ajandaDegisiklikYaz(ekle("k-ana", 1000, { kaynak: kaynak(ANA_SOHBET_ID) }));
    depo.ajandaDegisiklikYaz(ekle("k-a", 1000, { kaynak: kaynak(A_ID) }));
    depo.ajandaDegisiklikYaz(guncelle(k1, { baslik: "Dişçi 2" }, 2000));
    depo.ajandaIslemSonucuYaz("cihaz-tel", "is-1", { ok: true, kayit_id: "k-ana", rev: 3 }, 2000);
    depo.ajandaDepoKimligi(() => "depo-1");
    depo.ajandaJetonEkle({ ozet: "oz-1", kapsam: JETON });
    depo.cihazEkle(cihaz("tel-a", "ajanda"));
    depo.eslestirmeYaz({ kod_ozeti: "oz-a", son_ms: 9000, yanlis_deneme: 0, kapsam: "ajanda" });
    depo.olayEkle({ type: "user_echo", sohbet_id: A_ID, client_msg_id: "msg-1", input: "yazi", text: "yarın 3'te dişçi" });
    const once = ajandaDokumu(yol);
    const kayitlarOnce = depo.ajandaRevAraligi({ sonRev: 0, ustRev: 99, adet: 99 });

    depo.gecmisiTemizle(ANA);
    depo.gecmisiTemizle(A);
    depo.sohbetiSil(A, 60);
    depo.walDaralt();

    assert.deepEqual(ajandaDokumu(yol), once);
    assert.deepEqual(depo.ajandaRevAraligi({ sonRev: 0, ustRev: 99, adet: 99 }), kayitlarOnce);
    assert.equal(depo.ajandaBasRev(), 3);
    assert.equal(depo.kapsamliCihazGetir("tel-a")?.kapsam, "ajanda");
  });
});
