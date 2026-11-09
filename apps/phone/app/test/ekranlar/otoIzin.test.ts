import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SOHBET_SURUMU } from "@eren/protocol";
import type { Plan } from "@eren/protocol";
import {
  kartAnahtari,
  OTO_IZIN_AZAMI_YAS_MS,
  OTO_IZIN_DENENIYOR_METNI,
  OTO_IZIN_NOT_METNI,
  OTO_IZIN_SAAT_PAYI_MS,
  oneriYeniMi,
  otoIzinAdaylari,
  otoIzinKartGorunumu,
  otoIzinKur,
  otoIzinZamaniMi,
} from "../../src/ekranlar/otoIzin.ts";
import type { OtoIzinSohbetGirdisi, OtoIzinYurutucusu } from "../../src/ekranlar/otoIzin.ts";
import type {
  BekleyenOge,
  Cekirdek,
  CekirdekDurumu,
  GidenHatasi,
  GonderSonucu,
  GorunumOgesi,
  PlanKarti,
  SohbetId,
  SohbetOzeti,
} from "../../src/cekirdek/index.ts";
import type { ErenCihaz, Sonuc } from "../../src/cihaz/erenDevice.ts";
import type { CihazDurumu, OtoIzinSonucu } from "../../modules/eren-device/src/ErenDevice.types.ts";
import { bosalt } from "../cekirdek/sahte.ts";

const telefonPlani = (plan_id: string): Plan =>
  ({
    plan_id,
    baslik: "Mesajları oku",
    tur: "telefon",
    cwd: "",
    gorev_metni: "Son mesajları oku",
    telefon_izin_istegi: { uygulamalar: ["com.whatsapp"], mod: "oku" },
  }) as Plan;

const pcPlani = (plan_id: string): Plan =>
  ({
    plan_id,
    baslik: "Derle",
    tur: "pc",
    cwd: "C:\\proje",
    gorev_metni: "Derle",
  }) as Plan;

/** Testlerin "şimdi"si; kartlar varsayılan olarak bundan 1 sn önce önerilmiş. */
const SIMDI = 1_800_000_000_000;
const saat = (): number => SIMDI;

const kart = (
  plan_id: string,
  o: Partial<Pick<PlanKarti, "durum" | "plan_hash" | "plan" | "ts_ms">> = {},
): PlanKarti => ({
  tur: "plan",
  seq: 1,
  ts_ms: o.ts_ms ?? SIMDI - 1_000,
  plan_id,
  plan_hash: o.plan_hash ?? `h-${plan_id}`,
  plan: o.plan ?? telefonPlani(plan_id),
  plan_json: `{"plan_id":"${plan_id}"}`,
  durum: o.durum ?? "bekliyor",
  is_id: null,
});

const karar = (plan_id: string): BekleyenOge => ({
  client_msg_id: `k-${plan_id}`,
  mesaj: { v: SOHBET_SURUMU, type: "plan_decision", client_msg_id: `k-${plan_id}`, plan_id, plan_hash: `h-${plan_id}`, karar: "onay" },
  durum: "yollandi",
} as unknown as BekleyenOge);

const girdi = (
  sohbet_id: string,
  ogeler: readonly GorunumOgesi[],
  o: { bekleyenler?: readonly BekleyenOge[]; hatalar?: readonly GidenHatasi[] } = {},
): OtoIzinSohbetGirdisi => ({
  sohbet_id: sohbet_id as SohbetId,
  ogeler,
  bekleyenler: o.bekleyenler ?? [],
  hatalar: o.hatalar ?? [],
});

describe("otoIzinAdaylari", () => {
  it("yalnız bekleyen telefon planı kartları, sohbet ve görünüm sırasıyla", () => {
    const a = otoIzinAdaylari(
      [
        girdi("ana", [
          kart("p1"),
          kart("p2", { plan: pcPlani("p2") }),
          kart("p3", { durum: "onaylandi" }),
          { tur: "plan_gizlendi", seq: 4, ts_ms: 4 },
        ]),
        girdi("s-1-1", [kart("p4"), kart("p5", { durum: "iptal" })]),
      ],
      new Set(),
      SIMDI,
    );
    assert.deepEqual(
      a.map((x) => [x.sohbet_id, x.plan_id, x.plan_hash, x.plan_json]),
      [
        ["ana", "p1", "h-p1", '{"plan_id":"p1"}'],
        ["s-1-1", "p4", "h-p4", '{"plan_id":"p4"}'],
      ],
    );
  });

  it("değerlendirilmiş kart (aynı plan_id + plan_hash) atlanır; başka özet yeni karttır", () => {
    const s = [girdi("ana", [kart("p1"), kart("p2")])];
    const d = new Set([kartAnahtari({ plan_id: "p1", plan_hash: "h-p1" }), kartAnahtari({ plan_id: "p2", plan_hash: "baska" })]);
    assert.deepEqual(otoIzinAdaylari(s, d, SIMDI).map((x) => x.plan_id), ["p2"]);
  });

  it("kararı kuyrukta ya da hatalarda olan kart atlanır (hangi sohbette olursa olsun)", () => {
    const hata = { client_msg_id: "k-p2", mesaj: karar("p2").mesaj, kod: "izin_bekleniyor" } as GidenHatasi;
    const a = otoIzinAdaylari(
      [girdi("ana", [kart("p1"), kart("p2"), kart("p3")], { bekleyenler: [karar("p1")] }), girdi("s-1-1", [], { hatalar: [hata] })],
      new Set(),
      SIMDI,
    );
    assert.deepEqual(a.map((x) => x.plan_id), ["p3"]);
  });

  it("yalnız yeni önerilmiş kart aday: eski, zamanı bilinmeyen ve fazla ileri tarihli kart atlanır", () => {
    const a = otoIzinAdaylari(
      [
        girdi("ana", [
          kart("yeni", { ts_ms: SIMDI - 1_000 }),
          kart("sinirda", { ts_ms: SIMDI - OTO_IZIN_AZAMI_YAS_MS }),
          kart("eski", { ts_ms: SIMDI - OTO_IZIN_AZAMI_YAS_MS - 1 }),
          kart("gunler_once", { ts_ms: SIMDI - 3 * 24 * 3_600_000 }),
          kart("sifir", { ts_ms: 0 }),
          kart("nan", { ts_ms: Number.NaN }),
          kart("ileri_payda", { ts_ms: SIMDI + OTO_IZIN_SAAT_PAYI_MS }),
          kart("ileri_fazla", { ts_ms: SIMDI + OTO_IZIN_SAAT_PAYI_MS + 1 }),
        ]),
      ],
      new Set(),
      SIMDI,
    );
    assert.deepEqual(a.map((x) => x.plan_id), ["yeni", "sinirda", "ileri_payda"]);
  });
});

describe("oneriYeniMi", () => {
  it("eşik içi yeni; eski, bilinmeyen (0, NaN, sonsuz, eksik) ve saat payını aşan ileri tarih değil", () => {
    assert.equal(oneriYeniMi(SIMDI, SIMDI), true);
    assert.equal(oneriYeniMi(SIMDI - OTO_IZIN_AZAMI_YAS_MS, SIMDI), true);
    assert.equal(oneriYeniMi(SIMDI - OTO_IZIN_AZAMI_YAS_MS - 1, SIMDI), false);
    assert.equal(oneriYeniMi(SIMDI + OTO_IZIN_SAAT_PAYI_MS, SIMDI), true);
    assert.equal(oneriYeniMi(SIMDI + OTO_IZIN_SAAT_PAYI_MS + 1, SIMDI), false);
    assert.equal(oneriYeniMi(0, SIMDI), false);
    assert.equal(oneriYeniMi(-5, SIMDI), false);
    assert.equal(oneriYeniMi(Number.NaN, SIMDI), false);
    assert.equal(oneriYeniMi(Number.POSITIVE_INFINITY, SIMDI), false);
    assert.equal(oneriYeniMi(undefined as unknown as number, SIMDI), false);
    // Telefon saati bozuksa (okunamadı) hiçbir kart yeni sayılmaz.
    assert.equal(oneriYeniMi(SIMDI, Number.NaN), false);
  });
});

describe("otoIzinKartGorunumu", () => {
  it("sonuçlanmış kartta not ve kilit yok", () => {
    for (const durum of ["onaylandi", "reddedildi", "iptal"] as const) {
      assert.deepEqual(otoIzinKartGorunumu(durum, "karar_gonderilemedi", false), { satir: null, kilitli: false });
      assert.deepEqual(otoIzinKartGorunumu(durum, null, true), { satir: null, kilitli: false });
    }
  });

  it("bekleyen kartta deneme sürerken 'deneniyor' ve düğmeler kilitli; yoksa varsa not", () => {
    assert.deepEqual(otoIzinKartGorunumu("bekliyor", null, true), { satir: OTO_IZIN_DENENIYOR_METNI, kilitli: true });
    assert.deepEqual(otoIzinKartGorunumu("bekliyor", "hassas", true), { satir: OTO_IZIN_DENENIYOR_METNI, kilitli: true });
    assert.deepEqual(otoIzinKartGorunumu("bekliyor", "hassas", false), { satir: OTO_IZIN_NOT_METNI.hassas, kilitli: false });
    assert.deepEqual(otoIzinKartGorunumu("bekliyor", null, false), { satir: null, kilitli: false });
  });
});

describe("otoIzinZamaniMi", () => {
  it("yalnız yüklenmiş, bağlı ve eşitlenmiş", () => {
    assert.equal(otoIzinZamaniMi({ yuklendi: true, baglanti: "bagli", esitleniyor: false }), true);
    assert.equal(otoIzinZamaniMi({ yuklendi: false, baglanti: "bagli", esitleniyor: false }), false);
    assert.equal(otoIzinZamaniMi({ yuklendi: true, baglanti: "el_sikisma", esitleniyor: false }), false);
    assert.equal(otoIzinZamaniMi({ yuklendi: true, baglanti: "kapali", esitleniyor: false }), false);
    assert.equal(otoIzinZamaniMi({ yuklendi: true, baglanti: "bagli", esitleniyor: true }), false);
  });
});

// ---------------------------------------------------------------------------------------------
// Yürütücü: sahte çekirdek ve cihaz

const ozet = (sohbet_id: string): SohbetOzeti => ({
  sohbet_id: sohbet_id as SohbetId,
  ad: sohbet_id as SohbetOzeti["ad"],
  ana: sohbet_id === "ana",
  kurulum: "kuruldu",
  eren: null,
  yaziyor: false,
  okunmamis: 0,
  calisanIs: 0,
  sonMesaj: null,
  sonEtkinlikMs: 1,
});

interface Kararlar {
  sohbet_id: string;
  plan_id: string;
  plan_hash: string;
  karar: string;
}

class SahteCekirdek {
  d: CekirdekDurumu;
  ogeler = new Map<string, readonly GorunumOgesi[]>();
  bekleyenler = new Map<string, readonly BekleyenOge[]>();
  kararlar: Kararlar[] = [];
  kararSonucu: GonderSonucu = { ok: true, client_msg_id: "c1" };
  dinleyiciler = new Set<(d: CekirdekDurumu) => void>();

  constructor(sohbetler: string[]) {
    this.d = {
      baglanti: "bagli",
      sonrakiDenemeMs: null,
      hata: null,
      esitleniyor: false,
      sunucu: null,
      yuklendi: true,
      sohbetler: sohbetler.map(ozet),
      secili: "ana" as SohbetId,
      calisanIsler: [],
      tuketim: { durum: "yok" },
    };
  }

  degistir(p: Partial<CekirdekDurumu> = {}): void {
    this.d = { ...this.d, ...p };
    for (const f of [...this.dinleyiciler]) f(this.d);
  }

  cekirdek(): Cekirdek {
    return {
      durum: () => this.d,
      abone: (f: (d: CekirdekDurumu) => void) => {
        this.dinleyiciler.add(f);
        f(this.d);
        return () => {
          this.dinleyiciler.delete(f);
        };
      },
      sohbet: (id: string) => ({
        sohbet_id: id,
        durum: () => ({ ogeler: this.ogeler.get(id) ?? [], bekleyenler: this.bekleyenler.get(id) ?? [], hatalar: [] }),
        planKarari: async (plan_id: string, plan_hash: string, karar: string) => {
          this.kararlar.push({ sohbet_id: id, plan_id, plan_hash, karar });
          return this.kararSonucu;
        },
      }),
    } as unknown as Cekirdek;
  }
}

class SahteCihaz {
  desteklenir = true;
  tamYetki = true;
  /** `true`: `durum()` köprüden okunamaz (`{ ok: false }`). */
  durumHata = false;
  durumSayisi = 0;
  istekler: { plan_json: string; plan_hash: string }[] = [];
  sonuc: Sonuc<OtoIzinSonucu> = { ok: true, deger: { sonuc: "verildi", grant_id: "g1" } };
  /** Doluysa `otoIzin` bu sözü bekler (erişilebilirlik açılışı sürüyor). */
  askida: Promise<void> | null = null;

  cihaz(): ErenCihaz {
    return {
      desteklenir: this.desteklenir,
      durum: async (): Promise<Sonuc<CihazDurumu>> => {
        this.durumSayisi++;
        if (this.durumHata) return { ok: false, neden: "hata" };
        return { ok: true, deger: { tam_yetki: this.tamYetki } as CihazDurumu };
      },
      otoIzin: async (plan_json: string, plan_hash: string) => {
        this.istekler.push({ plan_json, plan_hash });
        if (this.askida !== null) await this.askida;
        return this.sonuc;
      },
    } as unknown as ErenCihaz;
  }
}

const p1 = { plan_id: "p1", plan_hash: "h-p1" };

describe("otoIzinKur", () => {
  it("tam yetkide verildi: o sohbetin planKarari(onay); kart bir kez denenir", async () => {
    const c = new SahteCekirdek(["ana", "s-1-1"]);
    c.ogeler.set("s-1-1", [kart("p1"), kart("p2", { plan: pcPlani("p2") })]);
    const h = new SahteCihaz();
    const y = otoIzinKur(c.cekirdek(), h.cihaz(), saat);
    const kapat = y.baslat();
    await bosalt();
    assert.deepEqual(h.istekler, [{ plan_json: '{"plan_id":"p1"}', plan_hash: "h-p1" }]);
    assert.deepEqual(c.kararlar, [{ sohbet_id: "s-1-1", plan_id: "p1", plan_hash: "h-p1", karar: "onay" }]);
    assert.equal(y.notu({ plan_id: "p1", plan_hash: "h-p1" }), null);
    c.degistir();
    await bosalt();
    assert.equal(h.istekler.length, 1);
    assert.equal(c.kararlar.length, 1);
    kapat();
  });

  it("tam yetki kapalı: hiç denenmez, kart sonradan da yeniden değerlendirilmez", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1")]);
    const h = new SahteCihaz();
    h.tamYetki = false;
    const y = otoIzinKur(c.cekirdek(), h.cihaz(), saat);
    const kapat = y.baslat();
    await bosalt();
    assert.equal(h.istekler.length, 0);
    assert.equal(c.kararlar.length, 0);
    assert.equal(y.notu({ plan_id: "p1", plan_hash: "h-p1" }), null);
    h.tamYetki = true;
    c.degistir();
    await bosalt();
    assert.equal(h.istekler.length, 0);
    // Yeni kart tam yetki açıkken gelince denenir.
    c.ogeler.set("ana", [kart("p1"), kart("p2")]);
    c.degistir();
    await bosalt();
    assert.deepEqual(h.istekler.map((x) => x.plan_hash), ["h-p2"]);
    kapat();
  });

  it("onay_gerekli: karar yollanmaz, neden kartın notu olur ve aboneler uyarılır", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1")]);
    const h = new SahteCihaz();
    h.sonuc = { ok: true, deger: { sonuc: "onay_gerekli", neden: "hassas" } };
    const y = otoIzinKur(c.cekirdek(), h.cihaz(), saat);
    let uyari = 0;
    y.abone(() => uyari++);
    const kapat = y.baslat();
    await bosalt();
    assert.equal(c.kararlar.length, 0);
    assert.equal(y.notu({ plan_id: "p1", plan_hash: "h-p1" }), "hassas");
    assert.equal(y.notu({ plan_id: "p1", plan_hash: "baska" }), null);
    // Deneme başı, not ve deneme sonu.
    assert.equal(uyari, 3);
    kapat();
  });

  it("köprü hatası ve gönderilemeyen karar notlanır; zaten yollanmış karar notlanmaz", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1")]);
    const h = new SahteCihaz();
    h.sonuc = { ok: false, neden: "hata" };
    const y = otoIzinKur(c.cekirdek(), h.cihaz(), saat);
    const kapat = y.baslat();
    await bosalt();
    assert.equal(y.notu({ plan_id: "p1", plan_hash: "h-p1" }), "kopru_hatasi");

    h.sonuc = { ok: true, deger: { sonuc: "verildi", grant_id: "g" } };
    c.kararSonucu = { ok: false, neden: "depo_hatasi" };
    c.ogeler.set("ana", [kart("p1"), kart("p2")]);
    c.degistir();
    await bosalt();
    assert.equal(y.notu({ plan_id: "p2", plan_hash: "h-p2" }), "karar_gonderilemedi");

    c.kararSonucu = { ok: false, neden: "zaten_yollandi" };
    c.ogeler.set("ana", [kart("p1"), kart("p2"), kart("p3")]);
    c.degistir();
    await bosalt();
    assert.equal(y.notu({ plan_id: "p3", plan_hash: "h-p3" }), null);
    kapat();
  });

  it("çekirdek hazır değilken (bağlı değil, eşitleniyor) köprüye hiç gidilmez", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1")]);
    c.d = { ...c.d, baglanti: "kapali" };
    const h = new SahteCihaz();
    const kapat = otoIzinKur(c.cekirdek(), h.cihaz(), saat).baslat();
    await bosalt();
    c.degistir({ baglanti: "bagli", esitleniyor: true });
    await bosalt();
    assert.equal(h.durumSayisi, 0);
    assert.equal(h.istekler.length, 0);
    c.degistir({ esitleniyor: false });
    await bosalt();
    assert.equal(h.istekler.length, 1);
    kapat();
  });

  it("köprü beklenirken kararı kuyruğa giren kart denenmez", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1")]);
    const h = new SahteCihaz();
    const cihaz = h.cihaz();
    const asil = cihaz.durum;
    cihaz.durum = async () => {
      // Kullanıcı tam bu arada "Telefonda izin iste" ile karar verdi.
      c.bekleyenler.set("ana", [karar("p1")]);
      return asil();
    };
    const kapat = otoIzinKur(c.cekirdek(), cihaz, saat).baslat();
    await bosalt();
    assert.equal(h.istekler.length, 0);
    kapat();
  });

  it("kapatılınca yeni kartlar denenmez; modül yoksa hiçbir şey çağrılmaz", async () => {
    const c = new SahteCekirdek(["ana"]);
    const h = new SahteCihaz();
    const kapat = otoIzinKur(c.cekirdek(), h.cihaz(), saat).baslat();
    await bosalt();
    kapat();
    c.ogeler.set("ana", [kart("p1")]);
    c.degistir();
    await bosalt();
    assert.equal(h.istekler.length, 0);

    const h2 = new SahteCihaz();
    h2.desteklenir = false;
    const kapat2 = otoIzinKur(c.cekirdek(), h2.cihaz(), saat).baslat();
    await bosalt();
    assert.equal(h2.durumSayisi, 0);
    assert.equal(h2.istekler.length, 0);
    kapat2();
  });

  it("yeniden başlatma: bekletilmiş eski kart, tam yetki açık olsa da kendiliğinden onaylanmaz", async () => {
    // Önceki süreç: kart geldiğinde tam yetki kapalıydı, kullanıcı kartı bilerek bekletti.
    const c = new SahteCekirdek(["ana", "s-1-1"]);
    c.ogeler.set("ana", [kart("p1", { ts_ms: SIMDI - 1_000 })]);
    const h = new SahteCihaz();
    h.tamYetki = false;
    const kapat = otoIzinKur(c.cekirdek(), h.cihaz(), saat).baslat();
    await bosalt();
    kapat();
    assert.equal(h.istekler.length, 0);

    // Günler sonra tam yetki açık, süreç yeniden başladı (bellekteki iz yok): eski kart ve zamanı
    // bilinmeyen kart denenmez; yalnız yeni önerilmiş kart denenir.
    const sonra = SIMDI + 3 * 24 * 3_600_000;
    c.ogeler.set("s-1-1", [kart("p2", { ts_ms: 0 }), kart("p3", { ts_ms: sonra - 2_000 })]);
    h.tamYetki = true;
    const kapat2 = otoIzinKur(c.cekirdek(), h.cihaz(), () => sonra).baslat();
    await bosalt();
    assert.deepEqual(h.istekler.map((x) => x.plan_hash), ["h-p3"]);
    assert.deepEqual(c.kararlar.map((x) => x.plan_id), ["p3"]);
    kapat2();
  });

  it("kart eşik geçtikten sonra (deneme sırası gelene kadar eskidiyse) denenmez", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1", { ts_ms: SIMDI - 1_000 })]);
    const h = new SahteCihaz();
    let simdi = SIMDI;
    const cihaz = h.cihaz();
    const asil = cihaz.durum;
    cihaz.durum = async () => {
      // Köprü yavaş: durum gelene kadar kart eşiği aştı.
      simdi = SIMDI + OTO_IZIN_AZAMI_YAS_MS;
      return asil();
    };
    const kapat = otoIzinKur(c.cekirdek(), cihaz, () => simdi).baslat();
    await bosalt();
    assert.equal(h.istekler.length, 0);
    kapat();
  });

  it("elle başlatılan kart otomatik denenmez (eşitleme sürerken ya da durum beklenirken)", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1"), kart("p2")]);
    c.d = { ...c.d, esitleniyor: true };
    const h = new SahteCihaz();
    const cihaz = h.cihaz();
    const asil = cihaz.durum;
    const y = otoIzinKur(c.cekirdek(), cihaz, saat);
    cihaz.durum = async () => {
      // Kullanıcı tam bu arada p2'de "Telefonda izin iste"ye bastı (onay ekranı açık, karar yok).
      assert.equal(y.elleBasla({ plan_id: "p2", plan_hash: "h-p2" }), true);
      return asil();
    };
    const kapat = y.baslat();
    await bosalt();
    // Eşitleme sürerken p1 elle başlatıldı.
    assert.equal(y.elleBasla(p1), true);
    c.degistir({ esitleniyor: false });
    await bosalt();
    assert.equal(h.istekler.length, 0);
    assert.equal(c.kararlar.length, 0);
    assert.equal(y.deneniyor(p1), false);
    kapat();
  });

  it("otomatik deneme sürerken kart 'deneniyor', elle başlatılamaz; bitince serbest", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1")]);
    const h = new SahteCihaz();
    let birak = (): void => {};
    h.askida = new Promise<void>((r) => {
      birak = r;
    });
    h.sonuc = { ok: true, deger: { sonuc: "onay_gerekli", neden: "erisim_acilamadi" } };
    const y = otoIzinKur(c.cekirdek(), h.cihaz(), saat);
    const gorulen: boolean[] = [];
    y.abone(() => gorulen.push(y.deneniyor(p1)));
    const kapat = y.baslat();
    await bosalt();
    assert.equal(h.istekler.length, 1);
    assert.equal(y.deneniyor(p1), true);
    assert.equal(y.deneniyor({ plan_id: "p1", plan_hash: "baska" }), false);
    assert.equal(y.elleBasla(p1), false);
    birak();
    await bosalt();
    assert.equal(y.deneniyor(p1), false);
    assert.equal(y.notu(p1), "erisim_acilamadi");
    // Aboneler hem başlangıçta hem bitişte uyarıldı.
    assert.equal(gorulen[0], true);
    assert.equal(gorulen.at(-1), false);
    // Kart kullanıcıya kaldı: artık elle başlatılabilir.
    assert.equal(y.elleBasla(p1), true);
    kapat();
  });

  it("verildi yolunda da deneme karar kuyruğa girene kadar sürer", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1")]);
    const h = new SahteCihaz();
    const temel = c.cekirdek();
    let y: OtoIzinYurutucusu | null = null;
    let kararAninda: boolean | null = null;
    const cekirdek = {
      ...temel,
      sohbet: (id: SohbetId) => {
        const s = temel.sohbet(id);
        return {
          ...s,
          planKarari: async (...a: Parameters<typeof s.planKarari>) => {
            kararAninda = y?.deneniyor(p1) ?? null;
            return s.planKarari(...a);
          },
        };
      },
    } as unknown as Cekirdek;
    y = otoIzinKur(cekirdek, h.cihaz(), saat);
    const kapat = y.baslat();
    await bosalt();
    assert.equal(kararAninda, true);
    assert.equal(y.deneniyor(p1), false);
    assert.equal(c.kararlar.length, 1);
    kapat();
  });

  it("tam yetki okunamadıysa kart işaretlenmez; sonraki fırsatta (eşik içindeyse) denenir", async () => {
    const c = new SahteCekirdek(["ana"]);
    c.ogeler.set("ana", [kart("p1")]);
    const h = new SahteCihaz();
    h.durumHata = true;
    let simdi = SIMDI;
    const y = otoIzinKur(c.cekirdek(), h.cihaz(), () => simdi);
    const kapat = y.baslat();
    await bosalt();
    assert.equal(h.istekler.length, 0);
    assert.equal(y.notu(p1), null);

    h.durumHata = false;
    c.degistir();
    await bosalt();
    assert.deepEqual(h.istekler.map((x) => x.plan_hash), ["h-p1"]);

    // Eşik geçtiyse okuma düzelse de eski kart denenmez.
    h.durumHata = true;
    c.ogeler.set("ana", [kart("p1"), kart("p2")]);
    c.degistir();
    await bosalt();
    simdi = SIMDI + OTO_IZIN_AZAMI_YAS_MS;
    h.durumHata = false;
    c.degistir();
    await bosalt();
    assert.deepEqual(h.istekler.map((x) => x.plan_hash), ["h-p1"]);
    kapat();
  });
});
