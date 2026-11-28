/**
 * Telefonun dayandığı servis değişmezleri (`docs/AJANDA.md` "Telefonun dayandığı servis değişmezleri").
 * Uygulama bir yazımı revizyon ve `guncelleme_ms` ikilisiyle tanır; PC'nin yedekten dönüp dönmediğini
 * bu ikiliden çıkarır (`apps/ajanda/cekirdek/src/motor/yerel.rs` `DonusAnalizi`). Servis şu üçünü
 * bozarsa telefon uzun çevrimdışı dönüşü "yedekten dönüş" sayar ve PC'nin yeni değerlerini ezer:
 *
 *   1. Ajanda kayıt geçmişi hiç budanmaz: satır silinmez, değişmez; kayıt da silinmez (mezar taşı kalır).
 *   2. Kaydın `guncelleme_ms`'i güncel revizyonunun geçmiş satırının `ts_ms`'idir.
 *   3. `guncelleme_ms` kayıt başına geriye gitmez (`max(şimdi, önceki)`, saat geri alınsa da).
 *
 * Her yazım yolundan (uygulama işlemleri, telefon sohbeti ve PC oturumu araçları, saat geri alma, aynı
 * milisaniyede ard arda yazım, "geçmişi sil", "sohbeti sil", jeton temizliği, WAL daraltma, depoyu
 * kapatıp yeniden açma) sonra `Gozcu.denetle` üçünü de bütün depoda sınar. Gerçek depo, geçici
 * dizinde dosya veritabanı; elle denetlenen saat (geri alınabilir), sahte takvim.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import {
  AJANDA_ARACLARI,
  type AjandaFiili,
  type AjandaIslem,
  type AjandaKaydi,
  kanonikJson,
  PC_KANCA_ARACLARI,
} from "@eren/protocol";
import { ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import { temizlikKur } from "../src/temizlik.ts";
import type {
  AjandaFiilCiktisi,
  AjandaFiilGirdisi,
  AjandaKopruBaglami,
  AjandaTurBaglami,
  SaatPortu,
  ServisOlaylari,
  TemizlikSohbetleri,
  Veriyolu,
} from "../src/sozlesme.ts";
import { sahteGunluk, sahteRastgele, sahteTakvim, sahteTranskript } from "./sahte.ts";

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const DAKIKA = 60_000;
const SAAT = 60 * DAKIKA;
const CIHAZ = "cihaz_ajanda01";
const OTURUM = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const ISTEM = "istem-0001";
const SOHBET_A = "sohbet-a";
const MESAJ_ANI = { tarih: "2026-11-25", saat: "14:30", saat_dilimi: DILIM };
const DAYANAK = { tarih: "2026-11-25", saat: "14:30" };

const kok = mkdtempSync(join(tmpdir(), "eren-ajanda-degismez-"));
after(() => rmSync(kok, { recursive: true, force: true }));
const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) {
    try {
      d.kapat();
    } catch {
      // zaten kapalı
    }
  }
});

let dosyaNo = 0;
let aracNo = 0;

const insanTuru = (turn_id = "tur_insan"): AjandaTurBaglami => ({
  tur_kokeni: "insan",
  turn_id,
  mesaj_ani: MESAJ_ANI,
  insan_metni: "yarın 3'te dişçi",
  kaynak_msg_id: "m_0001",
});
const sentetikTur = (): AjandaTurBaglami => ({ tur_kokeni: "sentetik", turn_id: "tur_sentetik", mesaj_ani: MESAJ_ANI });

/** Geri alınabilen saat: gerçek PC saati gibi (NTP düzeltmesi, elle ayar). */
interface ElleSaat extends SaatPortu {
  an: number;
}

/**
 * Değişmezlerin gözcüsü: her `denetle` bütün depoyu okur, önceki görüntüyle karşılaştırır, sonra yeni
 * görüntüyü saklar. Yayınlanan (telefona giden) kayıtlar da aynı kuraldan geçer.
 */
class Gozcu {
  /** Görülen her geçmiş satırı: rev → kanonik satır. */
  private satirlar = new Map<number, string>();
  /** Görülen her kayıt: kayit_id → son (revizyon, guncelleme_ms). */
  private izler = new Map<string, { revizyon: number; guncelleme_ms: number }>();
  private basRev = 0;
  /** Sınanan yazım sayısı (yeni geçmiş satırı). */
  yazim = 0;

  private depo: () => CihazYonetimliDepo;

  constructor(depo: () => CihazYonetimliDepo) {
    this.depo = depo;
  }

  denetle(ne: string): void {
    const depo = this.depo();
    const kayitlar = depo.ajandaKayitlari({ silinmislerDahil: true });
    const kimlikler = new Set(kayitlar.map((k) => k.kayit_id));

    // 1. Kayıt silinmez; geçmiş satırı silinmez, değişmez; baş revizyon geri gitmez.
    for (const id of this.izler.keys()) assert.ok(kimlikler.has(id), `${ne}: kayıt kayboldu (${id})`);
    const yeniSatirlar = new Map<number, string>();
    let enBuyuk = 0;
    for (const k of kayitlar) {
      const g = depo.ajandaGecmisi({ kayit_id: k.kayit_id, adet: 1_000_000 });
      assert.ok(g.length > 0, `${ne}: geçmişsiz kayıt (${k.kayit_id})`);
      for (const s of g) {
        assert.ok(!yeniSatirlar.has(s.rev), `${ne}: aynı revizyon iki satırda (${s.rev})`);
        yeniSatirlar.set(s.rev, kanonikJson({ kayit_id: k.kayit_id, ...s }));
        enBuyuk = Math.max(enBuyuk, s.rev);
      }
      // 2. `guncelleme_ms` = güncel revizyonun satırının `ts_ms`'i; güncel revizyon kaydın en son satırı.
      const son = g[0]!;
      assert.equal(son.rev, k.revizyon, `${ne}: kaydın revizyonu son geçmiş satırı değil (${k.kayit_id})`);
      assert.equal(son.ts_ms, k.guncelleme_ms, `${ne}: guncelleme_ms ≠ satırın ts_ms'i (${k.kayit_id})`);
      assert.deepEqual(
        depo.ajandaGecmisSatiri(k.revizyon),
        { kayit_id: k.kayit_id, ts_ms: k.guncelleme_ms },
        `${ne}: izdeki satır kayda uymuyor (${k.kayit_id})`,
      );
      // 3. Kayıt başına geçmiş zamanı geri gitmez; doğuştan geri değil; önceki görüntüden geri değil.
      const artan = [...g].reverse();
      for (let i = 1; i < artan.length; i++) {
        assert.ok(artan[i]!.ts_ms >= artan[i - 1]!.ts_ms, `${ne}: geçmiş zamanı geriledi (${k.kayit_id} rev ${artan[i]!.rev})`);
      }
      assert.ok(k.guncelleme_ms >= k.olusturma_ms, `${ne}: guncelleme_ms < olusturma_ms (${k.kayit_id})`);
      const once = this.izler.get(k.kayit_id);
      if (once !== undefined) {
        assert.ok(k.revizyon >= once.revizyon, `${ne}: revizyon geriledi (${k.kayit_id})`);
        assert.ok(k.guncelleme_ms >= once.guncelleme_ms, `${ne}: guncelleme_ms geriledi (${k.kayit_id})`);
        if (k.revizyon === once.revizyon) assert.equal(k.guncelleme_ms, once.guncelleme_ms, `${ne}: aynı yazımın zamanı değişti`);
      }
    }
    for (const [rev, satir] of this.satirlar) {
      assert.equal(yeniSatirlar.get(rev), satir, `${ne}: geçmiş satırı silindi ya da değişti (rev ${rev})`);
    }
    const bas = depo.ajandaBasRev();
    assert.equal(bas, enBuyuk, `${ne}: baş revizyon en büyük satır değil`);
    assert.ok(bas >= this.basRev, `${ne}: baş revizyon geriledi`);

    this.yazim += yeniSatirlar.size - this.satirlar.size;
    this.satirlar = yeniSatirlar;
    this.basRev = bas;
    this.izler = new Map(kayitlar.map((k) => [k.kayit_id, { revizyon: k.revizyon, guncelleme_ms: k.guncelleme_ms }]));
  }

  /** Telefona yayınlanan kayıt, kendi yazımının satırıyla aynı ikiliyi taşır. */
  yayiniDenetle(k: AjandaKaydi): void {
    assert.deepEqual(this.depo().ajandaGecmisSatiri(k.revizyon), { kayit_id: k.kayit_id, ts_ms: k.guncelleme_ms }, "yayın");
  }

  satirSayisi(): number {
    return this.satirlar.size;
  }
}

const kur = (dosya = join(kok, `d${++dosyaNo}.db`)) => {
  const saat: ElleSaat = {
    an: T0,
    simdiMs() {
      return this.an;
    },
  };
  const gunluk = sahteGunluk();
  const yayinlar: AjandaKaydi[] = [];
  const veriyolu: Veriyolu = {
    yayinla: (ad, veri) => {
      if (ad === "ajanda_kayit_yazildi") yayinlar.push((veri as ServisOlaylari["ajanda_kayit_yazildi"]).kayit);
    },
    dinle: () => () => {},
  };
  const telefonTuru: { tur: AjandaTurBaglami | null } = { tur: insanTuru() };

  const ac = () => {
    const depo = depoAc({ yol: dosya, saat, veriyolu, gunluk });
    acik.push(depo);
    const ajanda = ajandaKur({
      depo,
      takvim: sahteTakvim(DILIM),
      saat,
      rastgele: sahteRastgele(),
      gunluk,
      turBaglami: () => telefonTuru.tur,
    });
    ajanda.baslat();
    return { depo, ajanda };
  };
  let o = ac();
  const gozcu = new Gozcu(() => o.depo);

  /** Denetim ve yayın denetimi: her adımdan sonra çağrılır. */
  const denetle = (ne: string): void => {
    gozcu.denetle(ne);
    for (const k of yayinlar.splice(0)) gozcu.yayiniDenetle(k);
  };

  let islemNo = 0;
  const islem = (i: AjandaIslem, islem_id = `i_${++islemNo}`) => {
    const s = o.ajanda.islemUygula(CIHAZ, islem_id, i);
    denetle(`işlem ${i.islem} (${islem_id})`);
    return s;
  };

  const cagir = async <F extends AjandaFiili>(fiil: F, girdi: AjandaFiilGirdisi<F>, baglam: AjandaKopruBaglami): Promise<AjandaFiilCiktisi<F>> => {
    const isleyici = o.ajanda.araclar[fiil] as (g: unknown, b: AjandaKopruBaglami, s: AbortSignal) => Promise<
      { ok: true; deger: AjandaFiilCiktisi<F> } | { ok: false; code: string }
    >;
    const s = await isleyici(girdi, baglam, new AbortController().signal);
    assert.ok(s.ok, `boru hatası: ${s.ok ? "" : s.code}`);
    AJANDA_ARACLARI[fiil].cikti.parse(s.deger);
    denetle(`araç ${fiil} (${baglam.rol})`);
    return s.deger;
  };
  const sohbet = (sohbet_id = "ana"): AjandaKopruBaglami => ({ rol: "ana_oturum", sohbet_id, nesil: 1 });

  /** PC oturumu: tasdikli (insan) ya da tasdiksiz (sentetik) çağrı bağlamı. */
  const pc = (tasdikli: boolean): AjandaKopruBaglami => {
    const baglam: AjandaKopruBaglami = { rol: "pc_oturumu", baglanti_id: "pcb_baglanti1" };
    if (!tasdikli) return baglam;
    const arac_cagri_id = `toolu_${++aracNo}`;
    const girdi = PC_KANCA_ARACLARI.pc_arac.girdi.parse({
      oturum_id: OTURUM,
      arac_cagri_id,
      alt_agent: false,
      etkilesimsiz: false,
      istem_id: ISTEM,
    });
    PC_KANCA_ARACLARI.pc_arac.cikti.parse(o.ajanda.pcKanca.pc_arac(girdi));
    return { ...baglam, arac_cagri_id };
  };

  const kayit = (id: string): AjandaKaydi => {
    const k = o.depo.ajandaKaydiGetir(id);
    assert.ok(k !== null, `kayıt yok: ${id}`);
    return k;
  };

  /** Depoyu kapatıp aynı dosyayı yeniden açar (servisin yeniden başlaması: göçler, açılış temizliği). */
  const yenidenAc = (): void => {
    o.depo.kapat();
    acik.splice(acik.indexOf(o.depo), 1);
    o = ac();
    denetle("yeniden açılış");
  };

  return {
    saat,
    gozcu,
    denetle,
    islem,
    cagir,
    sohbet,
    pc,
    kayit,
    yenidenAc,
    telefonTuru,
    get depo() {
      return o.depo;
    },
    get ajanda() {
      return o.ajanda;
    },
  };
};

type Ortam = ReturnType<typeof kur>;

const elleEkle = (kayit_id: string, ek: Partial<Extract<AjandaIslem, { islem: "ekle" }>> = {}): AjandaIslem => ({
  islem: "ekle",
  kayit_id,
  tur: "randevu",
  baslik: "Dişçi ☕️",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  girdi_yolu: "elle",
  ...ek,
});

const haftalik = (kayit_id: string): AjandaIslem => ({
  islem: "ekle",
  kayit_id,
  tur: "gorev",
  baslik: "Haftalık rapor",
  zaman: { kesinlik: "an", tarih: "2026-11-02", saat: "10:00", saat_dilimi: DILIM },
  hatirlatmalar: [],
  tekrar: { siklik: "haftalik", aralik: 1 },
  girdi_yolu: "elle",
});

const DISCI: AjandaFiilGirdisi<"ajanda_ekle"> = {
  tur: "randevu",
  baslik: "Dişçi",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00" },
  dayanak: DAYANAK,
};
/** Zamansız araç eklemesi: dayanak istemez (saat geri alınınca da geçer). */
const zamansiz = (baslik: string): AjandaFiilGirdisi<"ajanda_ekle"> => ({ tur: "gorev", baslik });

const kimlik = (c: AjandaFiilCiktisi<"ajanda_ekle">): string => {
  assert.notEqual(c.sonuc, "ret", JSON.stringify(c));
  return (c as Extract<AjandaFiilCiktisi<"ajanda_ekle">, { kayit: unknown }>).kayit.kayit_id;
};
const guncellendi = (c: AjandaFiilCiktisi<"ajanda_guncelle">): void => {
  assert.equal(c.sonuc, "guncellendi", JSON.stringify(c));
};

/** Bir kaydı bütün uygulama işlemlerinden geçirir; her biri yeni yazım olmalı. */
const uygulamaTuru = (o: Ortam, id: string, etiket: string): void => {
  const yazdi = (s: { ok: boolean; rev?: number }, ne: string) => assert.ok(s.ok && s.rev !== undefined, `${etiket}: ${ne} yazmadı`);
  const rev = () => o.kayit(id).revizyon;
  yazdi(o.islem({ islem: "guncelle", kayit_id: id, temel_revizyon: rev(), degisiklik: { baslik: `${etiket} başlık` } }), "guncelle");
  // Durum her seferinde değişir: önce kapanır (zaten tamamsa iptal), sonra yeniden açılır.
  yazdi(o.islem({ islem: "durum", kayit_id: id, durum: o.kayit(id).durum === "tamam" ? "iptal" : "tamam" }), "durum kapat");
  yazdi(o.islem({ islem: "durum", kayit_id: id, durum: "acik" }), "durum acik");
  yazdi(o.islem({ islem: "sil", kayit_id: id }), "sil");
  yazdi(o.islem({ islem: "geri_yukle", kayit_id: id }), "geri_yukle");
};

describe("ajanda değişmezleri: uygulama işlemleri", () => {
  it("ekle, guncelle, durum (kayıt ve örnek), onayla, sil, geri_yukle; yan etkisiz, reddedilen ve tekrarlanan işlem yazmaz", async () => {
    const o = kur();
    assert.equal(o.islem(elleEkle("k_elle"), "i_ekle").ok, true);
    uygulamaTuru(o, "k_elle", "elle");

    // Örnek durumu (tekrarlı kayıt) ve örnek budaması (tekrar kaldırılınca).
    o.islem(haftalik("k_hafta"));
    assert.equal(o.islem({ islem: "durum", kayit_id: "k_hafta", durum: "tamam", ornek_tarihi: "2026-11-09" }).ok, true);
    assert.equal(o.islem({ islem: "durum", kayit_id: "k_hafta", durum: "iptal", ornek_tarihi: "2026-11-16" }).ok, true);
    assert.equal(
      o.islem({ islem: "guncelle", kayit_id: "k_hafta", temel_revizyon: o.kayit("k_hafta").revizyon, degisiklik: { tekrar: null } }).ok,
      true,
    );

    // `onayla`: taslak yalnız otomasyondan doğar (sentetik tur), onay uygulamadan.
    o.telefonTuru.tur = sentetikTur();
    const taslak = kimlik(await o.cagir("ajanda_ekle", DISCI, o.sohbet()));
    assert.equal(o.kayit(taslak).taslak, true);
    assert.equal(o.islem({ islem: "onayla", kayit_id: taslak }).rev !== undefined, true);
    assert.equal(o.kayit(taslak).taslak, false);

    // Yazmayan yollar: yan etkisiz, ret, tekrar. Satır sayısı değişmez.
    const satir = o.gozcu.satirSayisi();
    o.islem({ islem: "onayla", kayit_id: "k_elle" });
    o.islem({ islem: "geri_yukle", kayit_id: "k_elle" });
    o.islem({ islem: "durum", kayit_id: "k_elle", durum: "acik" });
    o.islem({ islem: "sil", kayit_id: "k_elle" });
    o.islem({ islem: "sil", kayit_id: "k_elle" });
    o.islem({ islem: "guncelle", kayit_id: "k_elle", temel_revizyon: 1, degisiklik: { baslik: "X" } });
    o.islem({ islem: "guncelle", kayit_id: "k_yok", temel_revizyon: 1, degisiklik: { baslik: "X" } });
    o.islem(elleEkle("k_elle"), "i_ekle");
    o.islem(elleEkle("k_elle", { baslik: "Başka" }));
    o.ajanda.gecersizIslem(CIHAZ, "i_bozuk");
    o.denetle("geçersiz işlem");
    assert.equal(o.gozcu.satirSayisi(), satir + 1, "yalnız ilk sil yazmalı");
    // ekle + 5 işlem (6), haftalık ekle + 2 örnek + budama (4), taslak + onay (2), ilk sil (1).
    assert.equal(o.gozcu.yazim, 13);
  });
});

describe("ajanda değişmezleri: araç yolu", () => {
  it("telefon sohbeti: insan ekleme ve güncelleme, sentetik taslak ve düzenlemesi, insan onayı, eşe birleşme, başka sohbet", async () => {
    const o = kur();
    const k1 = kimlik(await o.cagir("ajanda_ekle", DISCI, o.sohbet()));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: k1, degisiklik: { baslik: "Dişçi (dolgu)" } }, o.sohbet()));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: k1, degisiklik: { durum: "tamam" } }, o.sohbet()));

    o.telefonTuru.tur = sentetikTur();
    const t = kimlik(await o.cagir("ajanda_ekle", zamansiz("Fatura öde"), o.sohbet()));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: t, degisiklik: { aciklama: "elektrik" } }, o.sohbet()));
    // Sentetik turun reddi ve "zaten_var" yazmaz.
    await o.cagir("ajanda_guncelle", { kayit_id: k1, degisiklik: { baslik: "X" } }, o.sohbet());
    await o.cagir("ajanda_ekle", zamansiz("Fatura öde"), o.sohbet());

    // İnsan aynı şeyi söyler: taslak eşe birleşip onaylanır (tek yazım).
    o.telefonTuru.tur = insanTuru("tur_insan_2");
    const c = await o.cagir("ajanda_ekle", { ...zamansiz("Fatura öde"), aciklama: "su" }, o.sohbet());
    assert.equal(kimlik(c), t);
    assert.equal(o.kayit(t).taslak, false);
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: t, degisiklik: { baslik: "Fatura öde (su)" } }, o.sohbet()));

    // Başka sohbetten ekleme ve güncelleme.
    const k2 = kimlik(await o.cagir("ajanda_ekle", zamansiz("Market"), o.sohbet(SOHBET_A)));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: k2, degisiklik: { durum: "iptal" } }, o.sohbet(SOHBET_A)));

    // Araçla yazılmış kayıt uygulamadan da değişir (iki yazar aynı kayıtta).
    uygulamaTuru(o, k1, "araç kaydı");
    assert.ok(o.gozcu.yazim >= 13);
  });

  it("PC oturumu: tasdikli (insan) ekleme ve güncelleme, tasdiksiz (sentetik) taslak, insan onayı", async () => {
    const o = kur();
    o.telefonTuru.tur = null;
    const k = kimlik(await o.cagir("ajanda_ekle", DISCI, o.pc(true)));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: k, degisiklik: { baslik: "Dişçi (PC)" } }, o.pc(true)));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: k, degisiklik: { durum: "tamam" } }, o.pc(true)));

    const t = kimlik(await o.cagir("ajanda_ekle", zamansiz("Yedek al"), o.pc(false)));
    assert.equal(o.kayit(t).taslak, true);
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: t, degisiklik: { aciklama: "harici disk" } }, o.pc(false)));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: t, degisiklik: { onayla: true } }, o.pc(true)));
    assert.equal(o.kayit(t).taslak, false);
    await o.cagir("ajanda_listele", {}, o.pc(true));

    uygulamaTuru(o, k, "PC kaydı");
    assert.ok(o.gozcu.yazim >= 10);
  });
});

describe("ajanda değişmezleri: saat geri alma", () => {
  it("her yolda guncelle_ms önceki yazımda kalır, satırın ts_ms'i de odur; saat geçince yeniden ilerler", async () => {
    const o = kur();
    o.islem(elleEkle("k_elle"));
    o.islem(haftalik("k_hafta"));
    const k = kimlik(await o.cagir("ajanda_ekle", zamansiz("Sohbet kaydı"), o.sohbet()));
    const p = kimlik(await o.cagir("ajanda_ekle", zamansiz("PC kaydı"), o.pc(true)));
    o.saat.an = T0 + 10 * DAKIKA;
    o.islem({ islem: "durum", kayit_id: "k_elle", durum: "tamam" });
    const ileri = o.kayit("k_elle").guncelleme_ms;
    assert.equal(ileri, T0 + 10 * DAKIKA);

    // Saat bir saat geri.
    o.saat.an = T0 - SAAT;
    uygulamaTuru(o, "k_elle", "geri saat");
    o.islem({ islem: "durum", kayit_id: "k_hafta", durum: "tamam", ornek_tarihi: "2026-11-09" });
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: k, degisiklik: { baslik: "Sohbet kaydı 2" } }, o.sohbet()));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: p, degisiklik: { baslik: "PC kaydı 2" } }, o.pc(true)));
    assert.equal(o.kayit("k_elle").guncelleme_ms, ileri, "geri saatte önceki an korunur");
    assert.equal(o.kayit("k_hafta").guncelleme_ms, T0);
    assert.equal(o.kayit(k).guncelleme_ms, T0);
    assert.equal(o.kayit(p).guncelleme_ms, T0);
    for (const s of o.depo.ajandaGecmisi({ kayit_id: "k_elle", adet: 100 }).slice(0, 5)) assert.equal(s.ts_ms, ileri);

    // Geri saatte doğan kayıt kendi anıyla doğar (kayıt başına kural; başka kaydın zamanı karışmaz).
    o.islem(elleEkle("k_geride"));
    assert.equal(o.kayit("k_geride").guncelleme_ms, T0 - SAAT);
    assert.equal(o.kayit("k_geride").olusturma_ms, T0 - SAAT);
    const g = kimlik(await o.cagir("ajanda_ekle", zamansiz("Geride PC"), o.pc(true)));
    assert.equal(o.kayit(g).guncelleme_ms, T0 - SAAT);

    // Saat ilerler ama hâlâ son yazımın gerisinde: değer yerinde kalır.
    o.saat.an = T0 + 5 * DAKIKA;
    o.islem({ islem: "durum", kayit_id: "k_elle", durum: "tamam" });
    assert.equal(o.kayit("k_elle").guncelleme_ms, ileri);
    // Saat son yazımı geçer: yeni değer.
    o.saat.an = T0 + 20 * DAKIKA;
    o.islem({ islem: "durum", kayit_id: "k_elle", durum: "acik" });
    assert.equal(o.kayit("k_elle").guncelleme_ms, T0 + 20 * DAKIKA);

    // Servis geri saatle yeniden başlar: değişmez sürer.
    o.saat.an = T0 - 2 * SAAT;
    o.yenidenAc();
    uygulamaTuru(o, "k_elle", "yeniden açılışta geri saat");
    assert.equal(o.kayit("k_elle").guncelleme_ms, T0 + 20 * DAKIKA);
  });
});

describe("ajanda değişmezleri: aynı milisaniye", () => {
  it("ard arda yazımlar aynı ms'yi paylaşır ama her biri yeni revizyon ve kendi satırıdır; (rev, ms) yazım başına tekildir", async () => {
    const o = kur();
    o.islem(elleEkle("k_elle"));
    const k = kimlik(await o.cagir("ajanda_ekle", zamansiz("Aynı an"), o.sohbet()));
    const ikililer: [number, number][] = [];
    const kaydet = (id: string) => {
      const x = o.kayit(id);
      ikililer.push([x.revizyon, x.guncelleme_ms]);
    };
    kaydet("k_elle");
    kaydet(k);
    for (let i = 0; i < 3; i++) {
      uygulamaTuru(o, "k_elle", `tur ${i}`);
      kaydet("k_elle");
      guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: k, degisiklik: { baslik: `Aynı an ${i}` } }, o.sohbet()));
      kaydet(k);
      uygulamaTuru(o, k, `araç kaydı ${i}`);
      kaydet(k);
      guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: "k_elle", degisiklik: { aciklama: `pc ${i}` } }, o.pc(true)));
      kaydet("k_elle");
    }
    for (const [, ms] of ikililer) assert.equal(ms, T0);
    const revler = ikililer.map(([r]) => r);
    assert.equal(new Set(revler).size, revler.length, "aynı ms'de revizyon tekrarlandı");
    for (let i = 1; i < revler.length; i++) assert.ok(revler[i]! > revler[i - 1]!);
    const g = o.depo.ajandaGecmisi({ kayit_id: "k_elle", adet: 1000 });
    assert.ok(g.length >= 19);
    for (const s of g) assert.equal(s.ts_ms, T0);
  });
});

describe("ajanda değişmezleri: geçmişe yakın yollar", () => {
  it("geçmişi sil (ana ve başka sohbet), sohbeti sil, jeton temizliği, WAL daraltma ve yeniden açılış ajanda geçmişine dokunmaz", async () => {
    const o = kur();
    o.depo.sohbetEkle({ sohbet_id: SOHBET_A, ad: "Sohbet A", olusturma_ms: T0, son_etkinlik_ms: T0 });
    // Her sohbetten ve her yoldan kayıtlar, birkaç yazımla.
    o.islem(elleEkle("k_elle"));
    uygulamaTuru(o, "k_elle", "hazırlık");
    const ka = kimlik(await o.cagir("ajanda_ekle", DISCI, o.sohbet()));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: ka, degisiklik: { durum: "tamam" } }, o.sohbet()));
    const kb = kimlik(await o.cagir("ajanda_ekle", zamansiz("A sohbetinden"), o.sohbet(SOHBET_A)));
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: kb, degisiklik: { baslik: "A sohbetinden 2" } }, o.sohbet(SOHBET_A)));
    o.islem({ islem: "sil", kayit_id: kb });
    const kp = kimlik(await o.cagir("ajanda_ekle", zamansiz("PC'den"), o.pc(true)));
    const satir = o.gozcu.satirSayisi();
    const depoId = o.depo.ajandaDepoKimligi(() => "d_yenikimlik");

    const sohbetler: TemizlikSohbetleri = {
      konusma: () => ({
        temizlenebilirMi: () => true,
        yeniSayfa: async () => ({ eski_oturumlar: [], eski_surec_cikti: true, yeni_nesil_acildi: true }),
      }),
      kaldir: () => ({ sonlandir: async () => ({ eski_oturumlar: [], eski_surec_cikti: true }) }),
    };
    const temizlik = temizlikKur({
      depo: o.depo,
      sohbetler,
      isler: { aktifSayisi: () => 0 },
      planlar: { bekleyenleriIptal: () => 0 },
      transkript: sahteTranskript(),
      saat: o.saat,
      gunluk: sahteGunluk(),
    });

    o.saat.an += DAKIKA;
    assert.equal(temizlik.gecmisiSil({ sohbet_id: "ana" }).ok, true);
    await temizlik.bekle();
    o.denetle("geçmişi sil (ana)");
    assert.equal(temizlik.gecmisiSil({ sohbet_id: SOHBET_A }).ok, true);
    await temizlik.bekle();
    o.denetle("geçmişi sil (A)");
    assert.equal(temizlik.sohbetiSil({ sohbet_id: SOHBET_A }).ok, true);
    await temizlik.bekle();
    o.denetle("sohbeti sil (A)");
    await temizlik.kapat();

    o.depo.ajandaJetonlariniSil();
    o.depo.erenJetonlariniSil();
    o.depo.walDaralt();
    o.denetle("jeton temizliği ve WAL daraltma");
    assert.equal(o.gozcu.satirSayisi(), satir, "temizlik ajanda geçmişine satır ekledi ya da sildi");
    // Silinen sohbetin kaydı da kalır (kaynağı o sohbet olsa da).
    assert.equal(o.kayit(kb).kaynak.sohbet_id, SOHBET_A);

    // Servis yeniden başlar: aynı depo kimliği, aynı geçmiş; yeni yazım bir öncekinin üstünden numara alır.
    const bas = o.depo.ajandaBasRev();
    o.yenidenAc();
    assert.equal(o.depo.ajandaDepoKimligi(() => "d_yenikimlik"), depoId);
    o.islem({ islem: "durum", kayit_id: "k_elle", durum: "tamam" });
    assert.equal(o.kayit("k_elle").revizyon, bas + 1);
    guncellendi(await o.cagir("ajanda_guncelle", { kayit_id: kp, degisiklik: { durum: "tamam" } }, o.pc(true)));
  });
});
