/**
 * Ajanda sözleşmesi sürüm 3, servis yolu uçtan uca: gerçek depo (`:memory:`), gerçek ajanda modülü
 * (`ajandaKur`), gerçek gateway (`gatewayKur`) ve sahte WebSocket. `docs/AJANDA.md` "Sürüm uyumu" ve
 * "Sürüm 3". Gösterilenler:
 * - v2 ve v3 istemci aynı anda bağlı: v3'ün eklediği bölgeli, ekli, bağlantılı kayıt v2'ye v3 alanları
 *   çıkarılmış gider (v2 şemasıyla katı çözülür); v2'nin `guncelle`'si v3 alanlarını silmez; v2'nin
 *   geçmiş sayfasında v3 alanları yoktur; alan listeleri v2'ye süzülür.
 * - Bugünkü canlı kurulum (tek v2 telefon): v3 alanı olmayan kayıtta giden baytlar, depodaki kayıtla ve
 *   v2 şemasının ürettiğiyle birebir aynıdır.
 * - Koordinat gizliliği: `bolge_konumu` (işaret koordinatı) hiçbir günlük satırına girmez.
 * Kuralların kendisi protokoldedir (`ajandaDegisikligiUygula`, `ajandaAsagiSurume`); burada servisin
 * onları uçtan uca uyguladığı sınanır. Çekirdek kurallar (kaldırma, konum düşmesi) `ajanda.test.ts`'te.
 */
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign as imzaAt, timingSafeEqual, verify as imzaDogrula } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
  AJANDA_GOVDE_SEMALARI,
  AJANDA_SURUM_ALANLARI,
  AJANDA_SURUMU,
  AJANDA_V3_ALANLARI,
  type AjandaKaydi,
  ajandaAsagiCoz,
  ajandaKimlikImzaMetni,
  type ServisBilgisi,
} from "@eren/protocol";
import { AJANDA_SUNULAN_YETENEKLER, ajandaKur } from "../src/ajanda.ts";
import { depoAc } from "../src/depo.ts";
import { gatewayKur } from "../src/gateway.ts";
import type { AnahtarPortu, GatewayBagimliliklari } from "../src/sozlesme.ts";
import { veriyoluKur } from "../src/veriyolu.ts";
import { sahteGunluk, sahteRastgele, sahteTakvim, sahteWs, sahteZaman } from "./sahte.ts";
import type { SahteWsBaglantisi } from "./sahte.ts";

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 2026-11-25 14:30 Europe/Istanbul.
const T0 = 1_795_606_200_000;
const DILIM = "Europe/Istanbul";
const SUNUCU_IP = "100.64.0.10";
const IP_V2 = "100.64.0.20";
const IP_V3 = "100.64.0.21";
const NONCE = Buffer.alloc(32, 7).toString("base64");
const SERVIS: ServisBilgisi = { surum: "abc123def456", baslangic_ms: T0 - 5000 };

/** İşaret koordinatı: bu rakamlar hiçbir günlük satırında görünmemeli. */
const KONUM = { enlem_e6: 41_017_623, boylam_e6: 28_973_519, yaricap_m: 150 };
const KONUM_ISARETLERI = ["41017623", "28973519"];
const BOLGE = "Kadıköy Dişçi";
const URL = "https://ornek.example/randevu?no=7";
const EK = {
  ek_id: "ek_0001",
  mime: "image/jpeg",
  bayt: 12_345,
  genislik: 800,
  yukseklik: 600,
  ozet: "ab".repeat(32),
  kapak: true as const,
  olusturma_ms: T0 - 1000,
};

const bosalt = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

const imzala = (k: KeyObject, metin: string): string => imzaAt("sha256", Buffer.from(metin, "utf8"), k).toString("base64");

function anahtarUret(): { ozel: KeyObject; acik: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { ozel: privateKey, acik: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}

function gercekAnahtar(): AnahtarPortu {
  const a = anahtarUret();
  return {
    acikAnahtar: () => a.acik,
    imzala: (metin) => imzala(a.ozel, metin),
    dogrula: (acik, metin, imza) => {
      try {
        const k = createPublicKey({ key: Buffer.from(acik, "base64"), format: "der", type: "spki" });
        return imzaDogrula("sha256", Buffer.from(metin, "utf8"), k, Buffer.from(imza, "base64"));
      } catch {
        return false;
      }
    },
    sabitZamanEsit: (x, y) => {
      const a1 = Buffer.from(x, "utf8");
      const b1 = Buffer.from(y, "utf8");
      return a1.length === b1.length && timingSafeEqual(a1, b1);
    },
  };
}

const V2_ANAHTAR = anahtarUret();
const V3_ANAHTAR = anahtarUret();

/** Sürümlü istemci: giden her çerçeve YALNIZ bağlantının sürümünün şemasıyla (katı) çözülür. */
class Istemci {
  readonly c: SahteWsBaglantisi;
  readonly v: 2 | 3;
  constructor(c: SahteWsBaglantisi, v: 2 | 3) {
    this.c = c;
    this.v = v;
  }
  get kare(): Msg[] {
    return this.c.gonderilenler.map((m) => {
      const coz = ajandaAsagiCoz(m, this.v);
      assert.ok(coz.ok, `giden çerçeve v${this.v} şemasına uymuyor: ${m.slice(0, 300)}`);
      return coz.mesaj as Msg;
    });
  }
  tur(t: string): Msg[] {
    return this.kare.filter((k) => k.type === t);
  }
  /** Bu kaydın son gelen hali. */
  sonKayit(kayit_id: string): Msg {
    const k = this.tur("kayit").filter((m) => m.kayit.kayit_id === kayit_id).at(-1);
    assert.ok(k !== undefined, `kayıt gelmedi: ${kayit_id}`);
    return k.kayit as Msg;
  }
  async gonder(m: object): Promise<void> {
    this.c.mesajGonder(JSON.stringify(m));
    await bosalt();
  }
  async islem(islem_id: string, islem: object): Promise<Msg> {
    await this.gonder({ v: this.v, type: "islem", islem_id, islem });
    const s = this.tur("islem_sonucu").filter((m) => m.islem_id === islem_id).at(-1);
    assert.ok(s !== undefined, `islem_sonucu yok: ${islem_id}`);
    return s;
  }
  async gecmis(istek_id: string, kayit_id: string): Promise<Msg> {
    await this.gonder({ v: this.v, type: "gecmis_iste", istek_id, kayit_id });
    const g = this.tur("gecmis").filter((m) => m.istek_id === istek_id).at(-1);
    assert.ok(g !== undefined, `gecmis yok: ${istek_id}`);
    return g;
  }
}

const acilacaklar: Array<() => void> = [];
afterEach(() => {
  for (const f of acilacaklar.splice(0)) f();
});

async function kur() {
  const zaman = sahteZaman(T0);
  const gunluk = sahteGunluk();
  const veriyolu = veriyoluKur({ gunluk });
  const depo = depoAc({ yol: ":memory:", saat: zaman.saat, veriyolu, gunluk });
  acilacaklar.push(() => depo.kapat());
  const ajanda = ajandaKur({
    depo,
    takvim: sahteTakvim(DILIM),
    saat: zaman.saat,
    rastgele: sahteRastgele(),
    gunluk,
    turBaglami: () => null,
    yetenekler: AJANDA_SUNULAN_YETENEKLER,
  });
  ajanda.baslat();
  const ws = sahteWs();
  const b = {
    ayar: { wsPort: 47821, sureler: { komutPayiMs: 15000 }, servis: SERVIS },
    depo,
    sohbetler: {
      konusma: () => null,
      durumlar: () => [],
      aktifTurlar: () => [],
      olustur: () => ({ ok: true, deger: { seq: null } }),
      adlandir: () => ({ ok: true, deger: { seq: null } }),
    },
    planlar: { karar: async () => ({ ok: true, deger: undefined }) },
    isler: {
      soruCevapla: () => ({ ok: true, deger: undefined }),
      durdur: async () => ({ ok: true, deger: { is_id: 1, sonuc: "durduruldu" } }),
      aktifSayisi: () => 0,
      ram: () => ({ bosMb: 8000, toplamMb: 16000, dusuk: false }),
    },
    temizlik: { gecmisiSil: () => ({ ok: false, code: "ic_hata" }), sohbetiSil: () => ({ ok: false, code: "ic_hata" }) },
    ajanda,
    cihaz: { baglandi: () => {} },
    kilit: { durum: () => ({ tur: "serbest" }) },
    sistem: { tailscaleAdresi: () => SUNUCU_IP },
    ws,
    anahtar: gercekAnahtar(),
    rastgele: sahteRastgele(),
    saat: zaman.saat,
    zamanlayici: zaman.zamanlayici,
    veriyolu,
    gunluk,
  } as unknown as GatewayBagimliliklari;
  const gw = gatewayKur(b);
  acilacaklar.push(() => void gw.kapat());
  for (const [device_id, a, ip] of [
    ["aj-v2", V2_ANAHTAR, IP_V2],
    ["aj-v3", V3_ANAHTAR, IP_V3],
  ] as const) {
    depo.cihazEkle({ device_id, public_key: a.acik, tailscale_ip: ip, platform: "android", etiket: null, eslesme_ms: T0, kapsam: "ajanda" });
  }
  await gw.baslat();
  await bosalt();

  /** Kimlik + telafi; `esitlendi` gelmiş istemci. */
  const giris = async (v: 2 | 3, hello: object = {}): Promise<Istemci> => {
    const [device_id, a, ip] = v === 2 ? ["aj-v2", V2_ANAHTAR, IP_V2] : ["aj-v3", V3_ANAHTAR, IP_V3];
    const ist = new Istemci(ws.baglan("/ajanda", ip), v);
    await ist.gonder({ v, type: "hello", device_id, son_rev: 0, client_nonce: NONCE, ...hello });
    const ch = ist.tur("auth_challenge")[0];
    assert.ok(ch !== undefined, JSON.stringify(ist.c.gonderilenler));
    const metin = ajandaKimlikImzaMetni({ rol: "telefon", device_id, client_nonce: NONCE, server_nonce: ch.server_nonce });
    await ist.gonder({ v, type: "auth_response", signature: imzala(a.ozel, metin) });
    assert.equal(ist.tur("esitlendi").length, 1, JSON.stringify(ist.c.gonderilenler));
    return ist;
  };
  const kayit = (id: string): AjandaKaydi => {
    const k = depo.ajandaKaydiGetir(id);
    assert.ok(k !== null, `kayıt yok: ${id}`);
    return k;
  };
  return { zaman, gunluk, depo, ajanda, giris, kayit };
}

/** v3 istemcinin eklediği bölgeli, ekli, bağlantılı kayıt (bütün v3 alanları). */
const v3Ekle = (kayit_id: string) => ({
  islem: "ekle",
  kayit_id,
  tur: "randevu",
  baslik: "Dişçi",
  zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: DILIM },
  hatirlatmalar: [{ tur: "once", dk: 60 }],
  simge: "dis",
  bolge: BOLGE,
  bolge_konumu: KONUM,
  varis: { pencere: { bas: "08:00", bit: "18:00" } },
  baglantilar: [{ url: URL, baslik: "Randevu sayfası" }],
  ekler: [EK],
  girdi_yolu: "elle",
});

const V3_KUMESI: ReadonlySet<string> = new Set(AJANDA_V3_ALANLARI);
const v3AlanlariYok = (o: Msg, ne: string): void => {
  for (const a of AJANDA_V3_ALANLARI) assert.equal(a in o, false, `${ne}: v3 alanı ${a} v2'ye gitti`);
};

describe("ajanda v3: eski (v2) ve yeni (v3) istemci birlikte", () => {
  it("v3'ün eklediği bölgeli, ekli, bağlantılı kayıt v2'ye v3 alanları çıkarılmış gider; v3'e tam", async () => {
    const o = await kur();
    const v2 = await o.giris(2);
    const v3 = await o.giris(3);
    const s = await v3.islem("i-1", v3Ekle("k1"));
    assert.deepEqual(s, { v: 3, type: "islem_sonucu", islem_id: "i-1", ok: true, kayit_id: "k1", rev: 1 });
    const depodaki = o.kayit("k1");
    // Depo bütün v3 alanlarını saklar; elle eklemede verilen her alan kullanıcının emridir.
    assert.equal(depodaki.bolge, BOLGE);
    assert.deepEqual(depodaki.bolge_konumu, KONUM);
    assert.deepEqual(depodaki.ekler, [EK]);
    assert.deepEqual(depodaki.elle_alanlar, [
      "tur",
      "baslik",
      "zaman",
      "hatirlatmalar",
      "simge",
      "bolge",
      "bolge_konumu",
      "varis",
      "baglantilar",
      "ekler",
    ]);
    // v3 istemci kaydın kendisini görür.
    assert.deepEqual(v3.sonKayit("k1"), depodaki);
    // v2 istemci: v2 şemasıyla katı çözülür (`Istemci.kare`), v3 alanı yok, alan listesi v2 kümesinde.
    const v2deki = v2.sonKayit("k1");
    v3AlanlariYok(v2deki, "kayit");
    assert.deepEqual(v2deki.elle_alanlar, ["tur", "baslik", "zaman", "hatirlatmalar"]);
    const beklenen = Object.fromEntries(Object.entries(depodaki).filter(([a]) => !V3_KUMESI.has(a)));
    assert.deepEqual(v2deki, { ...beklenen, elle_alanlar: ["tur", "baslik", "zaman", "hatirlatmalar"] });
    // Yalnız bilinen alanlar eksilir; kalanların sırası v2 şemasınınkidir (baytlar öngörülebilir).
    const ham = v2.c.gonderilenler.find((m) => m.includes('"type":"kayit"'))!;
    assert.equal(ham, JSON.stringify({ v: 2, type: "kayit", kayit: AJANDA_GOVDE_SEMALARI[2].Kaydi.parse(v2deki) }));
    assert.ok(!ham.includes(BOLGE) && !ham.includes(URL) && !ham.includes(EK.ozet));
  });

  it("v2'nin aynı kayıtta guncelle'si (başlık, hatırlatma) ve durum, sil, geri_yukle v3 alanlarını silmez", async () => {
    const o = await kur();
    const v2 = await o.giris(2);
    const v3 = await o.giris(3);
    await v3.islem("i-1", v3Ekle("k1"));
    const once = o.kayit("k1");
    const s = await v2.islem("i-2", {
      islem: "guncelle",
      kayit_id: "k1",
      temel_revizyon: 1,
      degisiklik: { baslik: "Dişçi (kontrol)", hatirlatmalar: [{ tur: "once", dk: 30 }] },
    });
    assert.deepEqual(s, { v: 2, type: "islem_sonucu", islem_id: "i-2", ok: true, kayit_id: "k1", rev: 2 });
    for (const [i, islem] of [
      ["i-3", { islem: "durum", kayit_id: "k1", durum: "tamam" }],
      ["i-4", { islem: "durum", kayit_id: "k1", durum: "acik" }],
      ["i-5", { islem: "sil", kayit_id: "k1" }],
      ["i-6", { islem: "geri_yukle", kayit_id: "k1" }],
    ] as const) {
      assert.equal((await v2.islem(i, islem)).ok, true, i);
    }
    const sonra = o.kayit("k1");
    assert.equal(sonra.baslik, "Dişçi (kontrol)");
    assert.deepEqual(sonra.hatirlatmalar, [{ tur: "once", dk: 30 }]);
    for (const a of AJANDA_V3_ALANLARI) assert.deepEqual(sonra[a], once[a], `v2 işlemi ${a}'yı değiştirdi`);
    // `elle_alanlar`'daki v3 adları da kalır (v2'ye süzülmüş liste geri yazılmaz).
    assert.deepEqual(
      sonra.elle_alanlar.filter((a) => V3_KUMESI.has(a)),
      ["simge", "bolge", "bolge_konumu", "varis", "baglantilar", "ekler"],
    );
    // v3 istemci yeni başlığı v3 alanlarıyla birlikte görür; v2 kendi görünümünü.
    assert.deepEqual(v3.sonKayit("k1"), sonra);
    assert.equal(v2.sonKayit("k1").baslik, "Dişçi (kontrol)");
    v3AlanlariYok(v2.sonKayit("k1"), "kayit");
  });

  it("v2'nin geçmiş sayfasında v3 alanları görünmez; v3'ünkünde görünür (konum düşmesi dahil)", async () => {
    const o = await kur();
    const v2 = await o.giris(2);
    const v3 = await o.giris(3);
    await v3.islem("i-1", v3Ekle("k1"));
    // v3: bölge başka yere değişir, konum düşer (protokolün saf kuralı); yalnız v3 alanı değişen girdi.
    const s = await v3.islem("i-2", { islem: "guncelle", kayit_id: "k1", temel_revizyon: 1, degisiklik: { bolge: "Beşiktaş Dişçi" } });
    assert.equal(s.ok, true);
    assert.equal(o.kayit("k1").bolge_konumu, undefined);
    await v2.islem("i-3", { islem: "guncelle", kayit_id: "k1", temel_revizyon: 2, degisiklik: { baslik: "Dişçi 2" } });

    const g3 = await v3.gecmis("g-1", "k1");
    assert.deepEqual(g3.girdiler.map((g: Msg) => g.rev), [3, 2, 1]);
    assert.deepEqual(g3.girdiler[1].onceki, { bolge: BOLGE, bolge_konumu: KONUM });
    assert.deepEqual(g3.girdiler[1].sonraki, { bolge: "Beşiktaş Dişçi", bolge_konumu: null });
    assert.deepEqual(g3.girdiler[2].sonraki.ekler, [EK]);

    const g2 = await v2.gecmis("g-2", "k1");
    assert.deepEqual(g2.girdiler.map((g: Msg) => g.rev), [3, 2, 1]);
    for (const g of g2.girdiler as Msg[]) {
      v3AlanlariYok(g.onceki, `rev ${g.rev} onceki`);
      v3AlanlariYok(g.sonraki, `rev ${g.rev} sonraki`);
    }
    // Yalnız v3 alanı değişen girdi v2'de boş parça olarak durur (revizyon zinciri kopmaz).
    assert.deepEqual([g2.girdiler[1].onceki, g2.girdiler[1].sonraki], [{}, {}]);
    assert.equal(g2.girdiler[2].sonraki.baslik, "Dişçi");
    assert.deepEqual([g2.girdiler[0].onceki, g2.girdiler[0].sonraki], [{ baslik: "Dişçi" }, { baslik: "Dişçi 2" }]);
    const ham = v2.c.gonderilenler.filter((m) => m.includes('"type":"gecmis"')).join("");
    assert.ok(!ham.includes("Beşiktaş") && !ham.includes(BOLGE) && !KONUM_ISARETLERI.some((x) => ham.includes(x)));
  });

  it("bugünkü canlı kurulum (tek v2 telefon): v3 alanı olmayan kayıtta baytlar depodaki kayıt ve v2 şemasıyla aynı", async () => {
    const o = await kur();
    const v2 = await o.giris(2);
    const s = await v2.islem("i-1", {
      islem: "ekle",
      kayit_id: "k1",
      tur: "gorev",
      baslik: "Süt al",
      aciklama: "Yarım yağlı",
      zaman: { kesinlik: "gun", tarih: "2026-11-26", gun_bolumu: "aksam", saat_dilimi: DILIM },
      hatirlatmalar: [],
      girdi_yolu: "elle",
    });
    assert.equal(s.ok, true);
    await v2.islem("i-2", { islem: "guncelle", kayit_id: "k1", temel_revizyon: 1, degisiklik: { aciklama: null } });
    const depodaki = o.kayit("k1");
    const ham = v2.c.gonderilenler;
    // welcome: `yetenekler` yok; kayıt: depodaki kaydın JSON'u birebir (uyarlama hiçbir şey atmadı).
    assert.equal(ham[1], `{"v":2,"type":"welcome","depo_id":${JSON.stringify(o.depo.ajandaDepoKimligi(() => "x"))},"bas_rev":0,"tam":true,"server_time_ms":${T0}}`);
    const kayitlar = ham.filter((m) => m.includes('"type":"kayit"'));
    assert.equal(kayitlar.at(-1), `{"v":2,"type":"kayit","kayit":${JSON.stringify(depodaki)}}`);
    // Depodaki kayıt v2 şemasının ürettiğiyle aynı baytlar (alan sırası dahil): v3 şeması v2 kaydını değiştirmez.
    assert.equal(JSON.stringify(depodaki), JSON.stringify(AJANDA_GOVDE_SEMALARI[2].Kaydi.parse(depodaki)));
    assert.equal(ham.filter((m) => m.includes('"islem_id":"i-2"'))[0], '{"v":2,"type":"islem_sonucu","islem_id":"i-2","ok":true,"kayit_id":"k1","rev":2}');
    const g = await v2.gecmis("g-1", "k1");
    const gHam = ham.at(-1)!;
    assert.equal(gHam, JSON.stringify({ v: 2, type: "gecmis", istek_id: "g-1", kayit_id: "k1", girdiler: g.girdiler, devami: false }));
    assert.equal(gHam, JSON.stringify({ v: 2, type: "gecmis", istek_id: "g-1", kayit_id: "k1", girdiler: o.depo.ajandaGecmisi({ kayit_id: "k1", adet: 10 }), devami: false }));
  });

  it("v3 istemci: welcome.yetenekler servisin sunduğuyla kesişim (bugün boş); v2'de alan yok", async () => {
    const o = await kur();
    const v3 = await o.giris(3, { yetenekler: ["ek_yedegi", "ice_aktar"] });
    assert.deepEqual(v3.tur("welcome")[0]!.yetenekler, []);
    assert.deepEqual(o.ajanda.yetenekler, AJANDA_SUNULAN_YETENEKLER);
    const v2 = await o.giris(2);
    assert.equal("yetenekler" in v2.tur("welcome")[0]!, false);
    assert.equal(AJANDA_SURUMU, 3);
    assert.deepEqual(AJANDA_SURUM_ALANLARI[2], ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar", "tekrar", "durum"]);
  });
});

describe("ajanda v3: koordinat gizliliği", () => {
  it("bolge_konumu (işaret koordinatı) hiçbir günlük satırına girmez: ekleme, güncelleme, geçmiş, telafi, retler", async () => {
    const o = await kur();
    const v2 = await o.giris(2);
    const v3 = await o.giris(3);
    await v3.islem("i-1", v3Ekle("k1"));
    await v3.islem("i-2", { islem: "guncelle", kayit_id: "k1", temel_revizyon: 1, degisiklik: { bolge_konumu: { ...KONUM, yaricap_m: 300 } } });
    await v2.islem("i-3", { islem: "guncelle", kayit_id: "k1", temel_revizyon: 2, degisiklik: { baslik: "Dişçi 2" } });
    await v3.gecmis("g-1", "k1");
    await v2.gecmis("g-2", "k1");
    // Retler: bölgesiz konum (şema: gecersiz_islem), bölge kalkıp varış kalırsa tutarsiz_kayit.
    assert.equal((await v3.islem("i-4", { ...v3Ekle("k2"), bolge: undefined })).code, "gecersiz_islem");
    assert.equal(
      (await v3.islem("i-5", { islem: "guncelle", kayit_id: "k1", temel_revizyon: 3, degisiklik: { bolge: null } })).code,
      "tutarsiz_kayit",
    );
    // Yeniden bağlanınca tam telafi (kayıt yeniden gider).
    const yeni = await o.giris(3);
    assert.deepEqual(yeni.sonKayit("k1").bolge_konumu, { ...KONUM, yaricap_m: 300 });
    assert.ok(o.gunluk.girdiler.length > 10, "günlük boş: sınama anlamsız");
    const gunlukMetni = JSON.stringify(o.gunluk.girdiler);
    for (const x of KONUM_ISARETLERI) assert.ok(!gunlukMetni.includes(x), `koordinat günlüğe girdi: ${x}`);
    for (const x of [BOLGE, URL, EK.ozet]) assert.ok(!gunlukMetni.includes(x), `kayıt içeriği günlüğe girdi: ${x}`);
  });
});
