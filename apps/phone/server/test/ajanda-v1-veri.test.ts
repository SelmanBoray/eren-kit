/**
 * Sürüm 1 ile yazılmış ajanda verisi sürüm 2 kodunda göçsüz geçerlidir (`docs/AJANDA.md` "Sürüm 2" >
 * "Var olan veri", "Servis: ajanda modülü" v2 (5)). Düzenek: gerçek dosya veritabanı; satırlar v1
 * servisinin yazdığı biçimde (kayıt JSON'u, geçmiş satırı, tekrarsızlık sonucu, depo kimliği) ham SQL ile
 * konur, sonra v2 depo ve ajanda modülü aynı dosyayı açar. Sınananlar: kayıt v2 şemasından geçer ve
 * `/ajanda` v2 `kayit`/`gecmis` çerçevesi olarak yayınlanır; v1 uygulamasının izi artımlı telafiyi
 * sürdürür; tekrarsızlık kaydı aynı sonucu verir; saatsiz gün kaydının `once`'ı artık 09:00'da çalar;
 * kayıt araçla güncellenir (gün bölümü eklenir), saklı tekil anahtar yeniden hesaplanmaz.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, afterEach, describe, it } from "node:test";
import {
  AJANDA_ARACLARI,
  AJANDA_SURUMU,
  AjandaKaydi,
  ajandaAsagiCoz,
  kurulacakHatirlatmalar,
} from "@eren/protocol";
import { ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import type { CihazYonetimliDepo } from "../src/depo.ts";
import type { AjandaIslem } from "@eren/protocol";
import type { AjandaKopruBaglami, AjandaTurBaglami, Veriyolu } from "../src/sozlesme.ts";
import { sahteGunluk, sahteRastgele, sahteTakvim, sahteZaman } from "./sahte.ts";

const kok = mkdtempSync(join(tmpdir(), "eren-ajanda-v1-veri-"));
after(() => rmSync(kok, { recursive: true, force: true }));
const acik: CihazYonetimliDepo[] = [];
afterEach(() => {
  for (const d of acik.splice(0)) d.kapat();
});

const DILIM = "Europe/Istanbul";
const CIHAZ = "cihaz_ajanda01";
// v1 servisinin kaydı yazdığı an: 2026-11-27 Cuma 01:45 Europe/Istanbul.
const T_V1 = Date.UTC(2026, 10, 26, 22, 45);
// v2 kodunun açıldığı an: aynı gün 10:00.
const T_V2 = Date.UTC(2026, 10, 27, 7, 0);
const V1_ANAHTAR = "t1:6ee5e7468cc91be723103eddd69a6ef8022b71d7c5278f956fd8ced4f6372eb4";
const DEPO_ID = "depo_v1sabit01";

// v1'in ham satırları (biçim v1 servisinin `JSON.stringify` ettiği gibi; `gun_bolumu` yok).
const ARAC_KAYDI = {
  kayit_id: "k_v1yikama",
  revizyon: 1,
  tur: "gorev",
  baslik: "Araba yıkama",
  zaman: { kesinlik: "gun", tarih: "2026-11-28", saat_dilimi: DILIM, ifade: "yarın akşama" },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  ornekler: [],
  durum: "acik",
  taslak: false,
  silindi: false,
  elle_alanlar: ["tur", "baslik", "zaman"],
  kaynak: { yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: "ana", kaynak_msg_id: "m_v10001", tekil_anahtar: V1_ANAHTAR },
  olusturma_ms: T_V1,
  guncelleme_ms: T_V1,
};
const ARAC_GECMISI = {
  islem: "ekle",
  yazar: { yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: "ana" },
  onceki: {},
  sonraki: {
    tur: "gorev",
    baslik: "Araba yıkama",
    zaman: ARAC_KAYDI.zaman,
    hatirlatmalar: [{ tur: "once", dk: 60 }],
    durum: "acik",
    taslak: false,
  },
};
const ELLE_ZAMAN = { kesinlik: "an" as const, tarih: "2026-11-29", saat: "11:00", saat_dilimi: DILIM };
const ELLE_KAYDI = {
  kayit_id: "k_v1elle",
  revizyon: 3,
  tur: "randevu",
  baslik: "Berber",
  zaman: ELLE_ZAMAN,
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  ornekler: [],
  durum: "tamam",
  taslak: false,
  silindi: false,
  elle_alanlar: ["tur", "baslik", "zaman", "hatirlatmalar", "durum"],
  kaynak: { yol: "elle", tur_kokeni: "insan", device_id: CIHAZ },
  olusturma_ms: T_V1 + 60_000,
  guncelleme_ms: T_V1 + 120_000,
};
const ELLE_YAZAR = { yol: "elle", tur_kokeni: "insan", device_id: CIHAZ };
const ELLE_GECMISI = [
  {
    islem: "ekle",
    yazar: ELLE_YAZAR,
    onceki: {},
    sonraki: { tur: "randevu", baslik: "Berber", zaman: ELLE_ZAMAN, hatirlatmalar: [{ tur: "once", dk: 60 }], durum: "acik", taslak: false },
  },
  { islem: "durum", yazar: ELLE_YAZAR, onceki: { durum: "acik" }, sonraki: { durum: "tamam" } },
];
const ELLE_EKLE_ISLEMI = {
  islem: "ekle",
  kayit_id: "k_v1elle",
  tur: "randevu",
  baslik: "Berber",
  zaman: ELLE_ZAMAN,
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  girdi_yolu: "elle",
} as const satisfies AjandaIslem;

/** Şemayı v2 deposu kurar (ek göçler yalnız tablo ekler); satırları v1'in yazdığı gibi ham SQL koyar. */
function v1Veritabani(): string {
  const yol = join(kok, `v1-${Math.random().toString(36).slice(2)}.db`);
  const z = sahteZaman(T_V1);
  const gunluk = sahteGunluk();
  const veriyolu: Veriyolu = { yayinla: () => {}, dinle: () => () => {} };
  depoAc({ yol, saat: z.saat, veriyolu, gunluk }).kapat();
  const h = new DatabaseSync(yol);
  try {
    h.prepare("INSERT INTO ajanda_meta (anahtar, deger) VALUES ('depo_id', ?)").run(DEPO_ID);
    const gecmis = h.prepare("INSERT INTO ajanda_gecmisi (rev, kayit_id, ts_ms, veri) VALUES (?, ?, ?, ?)");
    gecmis.run(1, ARAC_KAYDI.kayit_id, T_V1, JSON.stringify(ARAC_GECMISI));
    gecmis.run(2, ELLE_KAYDI.kayit_id, T_V1 + 60_000, JSON.stringify(ELLE_GECMISI[0]));
    gecmis.run(3, ELLE_KAYDI.kayit_id, T_V1 + 120_000, JSON.stringify(ELLE_GECMISI[1]));
    const kayit = h.prepare(
      "INSERT INTO ajanda_kayitlari (kayit_id, revizyon, olusturma_rev, tekil_anahtar, tur, durum, silindi, veri) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    kayit.run(ARAC_KAYDI.kayit_id, 1, 1, V1_ANAHTAR, "gorev", "acik", 0, JSON.stringify(ARAC_KAYDI));
    kayit.run(ELLE_KAYDI.kayit_id, 3, 2, null, "randevu", "tamam", 0, JSON.stringify(ELLE_KAYDI));
    const islem = h.prepare("INSERT INTO ajanda_islemleri (device_id, islem_id, sonuc, ts_ms) VALUES (?, ?, ?, ?)");
    islem.run(CIHAZ, "i_v1_1", JSON.stringify({ ok: true, kayit_id: "k_v1elle", rev: 2 }), T_V1 + 60_000);
    islem.run(CIHAZ, "i_v1_2", JSON.stringify({ ok: true, kayit_id: "k_v1elle", rev: 3 }), T_V1 + 120_000);
  } finally {
    h.close();
  }
  return yol;
}

function v2Ac(yol: string) {
  const zaman = sahteZaman(T_V2);
  const gunluk = sahteGunluk();
  const yayinlar: unknown[] = [];
  const veriyolu: Veriyolu = { yayinla: (ad, veri) => void (ad === "ajanda_kayit_yazildi" && yayinlar.push(veri)), dinle: () => () => {} };
  const depo = depoAc({ yol, saat: zaman.saat, veriyolu, gunluk });
  acik.push(depo);
  const takvim = sahteTakvim(DILIM);
  const tur: AjandaTurBaglami = {
    tur_kokeni: "insan",
    turn_id: "tur_v2",
    mesaj_ani: { tarih: "2026-11-27", saat: "10:00", saat_dilimi: DILIM },
    insan_metni: "araba yıkamayı cuma akşamına al",
    kaynak_msg_id: "m_v20001",
  };
  const ajanda = ajandaKur({ depo, takvim, saat: zaman.saat, rastgele: sahteRastgele(), gunluk, turBaglami: () => tur });
  ajanda.baslat();
  return { depo, takvim, ajanda, yayinlar, gunluk };
}

const kayitCercevesi = (kayit: unknown) => ajandaAsagiCoz(JSON.stringify({ v: AJANDA_SURUMU, type: "kayit", kayit }));

describe("ajanda: sürüm 1 verisi sürüm 2 kodunda (göç yok)", () => {
  it("kayıtlar v2 şemasından geçer, telafide v2 kayit çerçevesi olur; geçmiş v2 gecmis çerçevesi olur", () => {
    const o = v2Ac(v1Veritabani());
    assert.equal(o.depo.ajandaDepoKimligi(() => "depo_yeni00001"), DEPO_ID, "depo kimliği korunur (yenisi üretilmez)");
    assert.equal(o.depo.ajandaBasRev(), 3);
    for (const id of [ARAC_KAYDI.kayit_id, ELLE_KAYDI.kayit_id]) {
      const k = o.depo.ajandaKaydiGetir(id);
      assert.ok(k !== null);
      assert.ok(AjandaKaydi.safeParse(k).success, id);
    }
    const sayfa = o.ajanda.telafiSayfasi({ sonRev: 0, ustRev: 3, adet: 10 });
    assert.deepEqual(sayfa.map((k) => k.revizyon), [1, 3]);
    for (const k of sayfa) assert.ok(kayitCercevesi(k).ok, k.kayit_id);
    assert.deepEqual(sayfa[0], ARAC_KAYDI, "v1 kaydı bayt bayt aynı yayınlanır");
    const g = o.ajanda.gecmis(ELLE_KAYDI.kayit_id);
    assert.deepEqual(g.girdiler.map((x) => x.rev), [3, 2]);
    const cerceve = { v: AJANDA_SURUMU, type: "gecmis", istek_id: "g1", kayit_id: g.kayit_id, girdiler: g.girdiler, devami: g.devami };
    assert.ok(ajandaAsagiCoz(JSON.stringify(cerceve)).ok);
  });

  it("v1 uygulamasının görünen kopyasının izi tutar: artımlı telafi (tam değil); depo kimliği farklıysa tam", () => {
    const o = v2Ac(v1Veritabani());
    const iz = { kayit_id: ELLE_KAYDI.kayit_id, guncelleme_ms: ELLE_KAYDI.guncelleme_ms };
    assert.deepEqual(o.ajanda.karsila({ son_rev: 3, depo_id: DEPO_ID, son_rev_izi: iz }), { depo_id: DEPO_ID, bas_rev: 3, tam: false });
    assert.equal(o.ajanda.karsila({ son_rev: 3, depo_id: "depo_baska01", son_rev_izi: iz }).tam, true);
  });

  it("v1 tekrarsızlık kaydı aynı sonucu verir: aynı islem_id yeniden uygulanmaz", () => {
    const o = v2Ac(v1Veritabani());
    assert.deepEqual(o.ajanda.islemUygula(CIHAZ, "i_v1_1", ELLE_EKLE_ISLEMI), { ok: true, kayit_id: "k_v1elle", rev: 2 });
    assert.equal(o.depo.ajandaBasRev(), 3);
    assert.equal(o.yayinlar.length, 0);
  });

  it("v1 saatsiz gün kaydının once'ı artık o günün 09:00'ında çalar (gun_bolumu sözden çıkarılmaz)", () => {
    const o = v2Ac(v1Veritabani());
    const k = o.depo.ajandaKaydiGetir(ARAC_KAYDI.kayit_id)!;
    assert.deepEqual(kurulacakHatirlatmalar(k, T_V2, o.takvim.anCevir).map((h) => h.tetik_ms), [o.takvim.anCevir("2026-11-28", "09:00", DILIM)]);
  });

  it("v1 kaydı araçla güncellenir: gün 28 → 27 ve gün bölümü; tekil anahtar yeniden hesaplanmaz; v1 geçmişi korunur", async () => {
    const o = v2Ac(v1Veritabani());
    const baglam: AjandaKopruBaglami = { rol: "ana_oturum", sohbet_id: "ana", nesil: 1 };
    const s = await o.ajanda.araclar.ajanda_guncelle(
      {
        kayit_id: ARAC_KAYDI.kayit_id,
        degisiklik: { zaman: { kesinlik: "gun", tarih: "2026-11-27", gun_bolumu: "aksam", ifade: "cuma akşamı" } },
        dayanak: { tarih: "2026-11-27", saat: "10:00" },
      },
      baglam,
      new AbortController().signal,
    );
    assert.ok(s.ok);
    const c = AJANDA_ARACLARI.ajanda_guncelle.cikti.parse(s.deger);
    assert.ok(c.sonuc === "guncellendi", JSON.stringify(c));
    assert.deepEqual(c.kayit.hatirlatma.gun_hatirlatmasi, { tarih: "2026-11-27", saat: "17:00", gecti: false });
    const k = o.depo.ajandaKaydiGetir(ARAC_KAYDI.kayit_id)!;
    assert.equal(k.kaynak.tekil_anahtar, V1_ANAHTAR);
    assert.equal(k.revizyon, 4);
    assert.deepEqual(k.hatirlatmalar, [{ tur: "once", dk: 60 }]);
    assert.ok(kayitCercevesi(k).ok);
    const g = o.ajanda.gecmis(ARAC_KAYDI.kayit_id);
    assert.deepEqual(g.girdiler.map((x) => x.rev), [4, 1]);
    assert.deepEqual(g.girdiler[0]!.onceki, { zaman: ARAC_KAYDI.zaman });
    assert.equal((g.girdiler[0]!.sonraki as { zaman: { gun_bolumu?: string } }).zaman.gun_bolumu, "aksam");
    // Uygulamadan da (v2 işlemiyle) güncellenir.
    const r = o.ajanda.islemUygula(CIHAZ, "i_v2_1", { islem: "durum", kayit_id: ELLE_KAYDI.kayit_id, durum: "acik" });
    assert.deepEqual(r, { ok: true, kayit_id: ELLE_KAYDI.kayit_id, rev: 5 });
  });
});
