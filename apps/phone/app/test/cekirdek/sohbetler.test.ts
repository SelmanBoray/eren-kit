import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Olay } from "@eren/protocol";
import type { GorunumOgesi } from "../../src/cekirdek/olaylar.ts";
import {
  adHazirla,
  erenKaynakli,
  otomatikAd,
  ozetleriKur,
  sohbetDefteriKur,
} from "../../src/cekirdek/sohbetler.ts";
import type {
  AkisDurumu,
  GidenHatasi,
  IsMesaji,
  OutboxOgesi,
  OzetGirdisi,
  SohbetGorunumu,
  SohbetKaydi,
  SohbetYasamOlayi,
  SohbetYonetimMesaji,
} from "../../src/cekirdek/sozlesme.ts";
import {
  adDegistiOlayi,
  chatCreate,
  chatRename,
  sohbetAcildiOlayi,
  sohbetSilindiOlayi,
} from "./sahte.ts";

const yasam = (ham: Record<string, unknown>): SohbetYasamOlayi => Olay.parse(ham) as SohbetYasamOlayi;
const acildi = (seq: number, id: string, ad?: string) => yasam(sohbetAcildiOlayi(seq, id, ad));
const adDegisti = (seq: number, id: string, ad: string) => yasam(adDegistiOlayi(seq, id, ad));
const silindi = (seq: number, id: string) => yasam(sohbetSilindiOlayi(seq, id));

// ---------------------------------------------------------------------------------------------
describe("sohbetler: defter", () => {
  it("başta yalnız ana vardır: adı ANA_SOHBET_ADI (Claude), olusturma_seq ve olusturma_ms 0", () => {
    const d = sohbetDefteriKur();
    assert.deepEqual([...d.kayitlar().values()], [
      { sohbet_id: "ana", ad: "Claude", olusturma_seq: 0, olusturma_ms: 0 },
    ]);
    assert.equal(d.silindiMi("ana"), false);
  });

  it("anaAdi verilirse ana'nın yer tutucu adı odur; sifirla da onu korur; chat_renamed ezer", () => {
    const d = sohbetDefteriKur("Örnek Asistan");
    assert.equal(d.kayitlar().get("ana")!.ad, "Örnek Asistan");
    d.olay(adDegisti(1, "ana", "Sunucu adı"));
    assert.equal(d.kayitlar().get("ana")!.ad, "Sunucu adı");
    d.sifirla();
    assert.equal(d.kayitlar().get("ana")!.ad, "Örnek Asistan");
  });

  it("anaAdi SohbetAdi'ndan geçmezse (boş, satır sonu) ANA_SOHBET_ADI kullanılır", () => {
    assert.equal(sohbetDefteriKur("").kayitlar().get("ana")!.ad, "Claude");
    assert.equal(sohbetDefteriKur("a\nb").kayitlar().get("ana")!.ad, "Claude");
  });

  it("chat_created kayıt ekler (seq ve ts_ms kayda geçer), true döner", () => {
    const d = sohbetDefteriKur();
    assert.equal(d.olay(acildi(3, "s-1", "Proje")), true);
    assert.deepEqual(d.kayitlar().get("s-1"), {
      sohbet_id: "s-1",
      ad: "Proje",
      olusturma_seq: 3,
      olusturma_ms: 1003,
    });
  });

  it("var olan kimliğe (ana dahil) ikinci chat_created yok sayılır", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1", "Bir"));
    assert.equal(d.olay(acildi(2, "s-1", "Iki")), false);
    assert.equal(d.kayitlar().get("s-1")!.ad, "Bir");
    assert.equal(d.olay(acildi(3, "ana", "Baska")), false);
    assert.equal(d.kayitlar().get("ana")!.ad, "Claude");
  });

  it("silinmiş kimliğe sonraki chat_created yok sayılır", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1"));
    d.olay(silindi(2, "s-1"));
    assert.equal(d.olay(acildi(3, "s-1")), false);
    assert.equal(d.kayitlar().has("s-1"), false);
  });

  it("chat_renamed bilinen kaydın adını değiştirir; ana da adlandırılabilir", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1"));
    assert.equal(d.olay(adDegisti(2, "s-1", "Yeni ad")), true);
    assert.equal(d.kayitlar().get("s-1")!.ad, "Yeni ad");
    assert.equal(d.olay(adDegisti(3, "ana", "Ana ad")), true);
    assert.equal(d.kayitlar().get("ana")!.ad, "Ana ad");
  });

  it("chat_renamed: aynı ad false; bilinmeyen ve silinmiş kimlik false", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1", "Ad"));
    assert.equal(d.olay(adDegisti(2, "s-1", "Ad")), false);
    assert.equal(d.olay(adDegisti(3, "s-9", "X")), false);
    assert.equal(d.kayitlar().has("s-9"), false);
    d.olay(silindi(4, "s-1"));
    assert.equal(d.olay(adDegisti(5, "s-1", "Geri")), false);
    assert.equal(d.kayitlar().has("s-1"), false);
  });

  it("chat_renamed: en yenisi geçerli", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1"));
    d.olay(adDegisti(2, "s-1", "A"));
    d.olay(adDegisti(3, "s-1", "B"));
    assert.equal(d.kayitlar().get("s-1")!.ad, "B");
    assert.equal(d.kayitlar().get("s-1")!.olusturma_seq, 1);
  });

  it("chat_deleted kaydı kaldırır, silindiMi true olur, true döner", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1"));
    assert.equal(d.silindiMi("s-1"), false);
    assert.equal(d.olay(silindi(2, "s-1")), true);
    assert.equal(d.kayitlar().has("s-1"), false);
    assert.equal(d.silindiMi("s-1"), true);
  });

  it("ana silinemez: chat_deleted false, kayıt kalır, silindiMi false, sonraki olaylar çalışır", () => {
    const d = sohbetDefteriKur();
    assert.equal(d.olay(silindi(1, "ana")), false);
    assert.equal(d.kayitlar().has("ana"), true);
    assert.equal(d.silindiMi("ana"), false);
    assert.equal(d.olay(adDegisti(2, "ana", "Yeni")), true);
  });

  it("kaydı bilinmeyen kimliğin chat_deleted'ı false ama silindiMi true; sonra chat_created yok sayılır", () => {
    const d = sohbetDefteriKur();
    assert.equal(d.olay(silindi(1, "s-7")), false);
    assert.equal(d.silindiMi("s-7"), true);
    assert.equal(d.olay(acildi(2, "s-7")), false);
    assert.equal(d.kayitlar().has("s-7"), false);
  });

  it("zaten silinmiş kimliğe ikinci chat_deleted false, silindiMi true kalır", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1"));
    d.olay(silindi(2, "s-1"));
    assert.equal(d.olay(silindi(3, "s-1")), false);
    assert.equal(d.silindiMi("s-1"), true);
  });

  it("seq sınırı: seq son uygulanandan büyük değilse bakılmaz (eşit ve küçük)", () => {
    const d = sohbetDefteriKur();
    assert.equal(d.olay(acildi(5, "s-1", "Bes")), true);
    assert.equal(d.olay(acildi(5, "s-2")), false);
    assert.equal(d.olay(acildi(4, "s-3")), false);
    assert.equal(d.olay(adDegisti(5, "s-1", "X")), false);
    assert.equal(d.olay(silindi(3, "s-1")), false);
    assert.deepEqual([...d.kayitlar().keys()], ["ana", "s-1"]);
    assert.equal(d.kayitlar().get("s-1")!.ad, "Bes");
    assert.equal(d.silindiMi("s-1"), false);
    assert.equal(d.olay(acildi(6, "s-2")), true);
  });

  it("etkisiz olay da seq sınırını ilerletir", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1", "Ad"));
    assert.equal(d.olay(adDegisti(5, "s-1", "Ad")), false); // etkisiz, ama sınır 5
    assert.equal(d.olay(acildi(4, "s-2")), false);
    assert.equal(d.olay(acildi(6, "s-2")), true);
    // ana silme denemesi de ilerletir
    assert.equal(d.olay(silindi(10, "ana")), false);
    assert.equal(d.olay(acildi(9, "s-3")), false);
  });

  it("kayitlar() değişmedikçe aynı Map nesnesi, değişince yeni Map; eskisi bozulmaz", () => {
    const d = sohbetDefteriKur();
    const ilk = d.kayitlar();
    assert.equal(d.kayitlar(), ilk);
    assert.equal(d.olay(adDegisti(1, "s-9", "X")), false);
    assert.equal(d.kayitlar(), ilk);
    d.olay(acildi(2, "s-1"));
    const ikinci = d.kayitlar();
    assert.notEqual(ikinci, ilk);
    assert.equal(ilk.has("s-1"), false);
    assert.equal(d.olay(acildi(3, "s-1")), false);
    assert.equal(d.kayitlar(), ikinci);
    d.olay(adDegisti(4, "s-1", "Y"));
    const ucuncu = d.kayitlar();
    assert.notEqual(ucuncu, ikinci);
    assert.equal(ikinci.get("s-1")!.ad, "Yeni sohbet");
    d.olay(silindi(5, "s-1"));
    assert.notEqual(d.kayitlar(), ucuncu);
    assert.equal(ucuncu.has("s-1"), true);
  });

  it("ekleme sırası korunur, ana ilktir", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-b"));
    d.olay(acildi(2, "s-a"));
    d.olay(acildi(3, "s-c"));
    assert.deepEqual([...d.kayitlar().keys()], ["ana", "s-b", "s-a", "s-c"]);
    d.olay(silindi(4, "s-a"));
    assert.deepEqual([...d.kayitlar().keys()], ["ana", "s-b", "s-c"]);
  });

  it("sifirla: yalnız ana (Claude), silinmişler boş, seq sınırı 0, yeni Map", () => {
    const d = sohbetDefteriKur();
    d.olay(acildi(1, "s-1"));
    d.olay(adDegisti(2, "ana", "Baska"));
    d.olay(silindi(3, "s-2"));
    const onceki = d.kayitlar();
    d.sifirla();
    assert.notEqual(d.kayitlar(), onceki);
    assert.deepEqual([...d.kayitlar().values()], [
      { sohbet_id: "ana", ad: "Claude", olusturma_seq: 0, olusturma_ms: 0 },
    ]);
    assert.equal(d.silindiMi("s-2"), false);
    assert.equal(d.olay(acildi(1, "s-2")), true);
    assert.equal(d.kayitlar().has("s-2"), true);
  });
});

// ---------------------------------------------------------------------------------------------
// Görünüm öğesi kurucuları (yalnız bu testin okuduğu alanlar anlamlıdır)
const oge = (ham: Record<string, unknown>): GorunumOgesi => ham as unknown as GorunumOgesi;
const kullaniciOgesi = (seq: number, metin = "ben", ts_ms = 1000 + seq) =>
  oge({ tur: "kullanici", seq, ts_ms, client_msg_id: `m${seq}`, input: "yazi", metin });
const asistanOgesi = (seq: number, metin = "yanıt", ts_ms = 1000 + seq) =>
  oge({ tur: "asistan", seq, ts_ms, turn_id: `t${seq}`, metin });
const isOgesi = (seq: number, durum: string, ts_ms = 1000 + seq) =>
  oge({ tur: "is", seq, ts_ms, is_id: seq, plan_id: "p", plan_hash: "h", baslik: "b", is_turu: "pc", durum });
const sistemOgesi = (seq: number, seviye: string) =>
  oge({ tur: "sistem", seq, ts_ms: 1000 + seq, seviye, kod: "x", metin: "m" });
const digerOge = (tur: string, seq: number) => oge({ tur, seq, ts_ms: 1000 + seq });

describe("sohbetler: erenKaynakli", () => {
  it("asistan, plan, plan_gizlendi, soru, rapor, tur_kesildi, devir asistan kaynaklıdır", () => {
    for (const tur of ["asistan", "plan", "plan_gizlendi", "soru", "rapor", "tur_kesildi", "devir"]) {
      assert.equal(erenKaynakli(digerOge(tur, 1)), true, tur);
    }
  });

  it("sistem: bilgi değilse true, bilgi ise false", () => {
    assert.equal(erenKaynakli(sistemOgesi(1, "uyari")), true);
    assert.equal(erenKaynakli(sistemOgesi(1, "hata")), true);
    assert.equal(erenKaynakli(sistemOgesi(1, "bilgi")), false);
  });

  it("kullanici, is, gecmis_silindi asistan kaynaklı değildir", () => {
    assert.equal(erenKaynakli(kullaniciOgesi(1)), false);
    assert.equal(erenKaynakli(isOgesi(1, "suruyor")), false);
    assert.equal(erenKaynakli(digerOge("gecmis_silindi", 1)), false);
  });
});

// ---------------------------------------------------------------------------------------------
const kayitlarDefterden = (...olaylar: SohbetYasamOlayi[]): ReadonlyMap<string, SohbetKaydi> => {
  const d = sohbetDefteriKur();
  for (const o of olaylar) d.olay(o);
  return d.kayitlar();
};
const anaKaydi = (): SohbetKaydi => ({ sohbet_id: "ana", ad: "Claude", olusturma_seq: 0, olusturma_ms: 0 });

const kuyrukOgesi = (govde: Record<string, unknown>, yollandi = false): OutboxOgesi => ({
  client_msg_id: String(govde["client_msg_id"]),
  mesaj: govde as unknown as IsMesaji,
  yollandi,
});
const hataOgesi = (govde: Record<string, unknown>): GidenHatasi => ({
  client_msg_id: String(govde["client_msg_id"]),
  mesaj: govde as unknown as IsMesaji,
  kod: "sohbet_siniri",
});
const teslim = (govde: Record<string, unknown>): SohbetYonetimMesaji => govde as unknown as SohbetYonetimMesaji;

interface GirdiSecenek {
  kayitlar?: ReadonlyMap<string, SohbetKaydi>;
  kuyruk?: OutboxOgesi[];
  hatalar?: GidenHatasi[];
  teslimler?: SohbetYonetimMesaji[];
  sunucu?: OzetGirdisi["sunucu"];
  gorunumler?: Record<string, SohbetGorunumu>;
  okundu?: Record<string, number>;
}
const girdi = (s: GirdiSecenek = {}): OzetGirdisi => ({
  kayitlar: s.kayitlar ?? kayitlarDefterden(),
  kuyruk: s.kuyruk ?? [],
  hatalar: s.hatalar ?? [],
  teslimler: s.teslimler ?? [],
  sunucu: s.sunucu ?? null,
  gorunum: (id) => s.gorunumler?.[id] ?? null,
  okunduSeq: (id) => s.okundu?.[id] ?? 0,
});
const gv = (ogeler: GorunumOgesi[], akis: AkisDurumu | null = null): SohbetGorunumu => ({ ogeler, akis });
const bul = (g: OzetGirdisi, id: string) => {
  const o = ozetleriKur(g).find((x) => x.sohbet_id === id);
  assert.ok(o !== undefined, `${id} listede yok`);
  return o;
};
const idler = (g: OzetGirdisi) => ozetleriKur(g).map((o) => o.sohbet_id);

describe("sohbetler: ozetleriKur kurulum ve kimlik kümesi", () => {
  it("defterde kaydı olan kuruldu; yalnız ana varsa tek satır", () => {
    const l = ozetleriKur(girdi());
    assert.equal(l.length, 1);
    assert.equal(l[0]!.sohbet_id, "ana");
    assert.equal(l[0]!.kurulum, "kuruldu");
    assert.equal(l[0]!.ana, true);
    assert.equal(l[0]!.ad, "Claude");
  });

  it("kaydı olmayan: teslimler kuruldu, kuyruk bekliyor, hatalar kurulamadi", () => {
    const g = girdi({
      teslimler: [teslim(chatCreate("c1", "s-t"))],
      kuyruk: [kuyrukOgesi(chatCreate("c2", "s-k"))],
      hatalar: [hataOgesi(chatCreate("c3", "s-h"))],
    });
    assert.equal(bul(g, "s-t").kurulum, "kuruldu");
    assert.equal(bul(g, "s-k").kurulum, "bekliyor");
    assert.equal(bul(g, "s-h").kurulum, "kurulamadi");
  });

  it("ilk tutan kazanır: teslim > kuyruk > hata; defter hepsinden önce", () => {
    const g = girdi({
      teslimler: [teslim(chatCreate("c1", "s-1"))],
      kuyruk: [kuyrukOgesi(chatCreate("c2", "s-1")), kuyrukOgesi(chatCreate("c3", "s-2"))],
      hatalar: [hataOgesi(chatCreate("c4", "s-2")), hataOgesi(chatCreate("c5", "s-3", "Hata ad"))],
      kayitlar: kayitlarDefterden(acildi(1, "s-4", "Defter")),
    });
    // s-4: kuyrukta da, hatada da olsun; defter kazanır
    const g2 = girdi({
      ...{},
      kayitlar: kayitlarDefterden(acildi(1, "s-4", "Defter")),
      kuyruk: [kuyrukOgesi(chatCreate("c6", "s-4", "Kuyruk"))],
      hatalar: [hataOgesi(chatCreate("c7", "s-4", "Hata"))],
    });
    assert.equal(bul(g, "s-1").kurulum, "kuruldu");
    assert.equal(bul(g, "s-2").kurulum, "bekliyor");
    assert.equal(bul(g, "s-3").kurulum, "kurulamadi");
    const s4 = bul(g2, "s-4");
    assert.equal(s4.kurulum, "kuruldu");
    assert.equal(s4.ad, "Defter");
    assert.equal(ozetleriKur(g2).filter((o) => o.sohbet_id === "s-4").length, 1);
  });

  it("yalnız sunucu'da olan kimlik listeye girmez", () => {
    const g = girdi({ sunucu: [{ sohbet_id: "ana", eren: "hazir" }, { sohbet_id: "s-x", eren: "hazir" }] });
    assert.deepEqual(idler(g), ["ana"]);
  });

  it("kayıtlarda ana yoksa varsayılan ana kaydıyla (Claude) eklenir", () => {
    const g = girdi({ kayitlar: new Map() });
    const l = ozetleriKur(g);
    assert.deepEqual(l.map((o) => o.sohbet_id), ["ana"]);
    assert.equal(l[0]!.ad, "Claude");
    assert.equal(l[0]!.kurulum, "kuruldu");
    assert.equal(l[0]!.sonEtkinlikMs, 0);
  });

  it("ana alanı yalnız ana için true", () => {
    const g = girdi({ kayitlar: kayitlarDefterden(acildi(1, "s-1")) });
    assert.equal(bul(g, "ana").ana, true);
    assert.equal(bul(g, "s-1").ana, false);
  });
});

describe("sohbetler: ozetleriKur geçerli ad", () => {
  it("kayıt yoksa ad kurulumu belirleyen chat_create'ten gelir", () => {
    const g = girdi({
      teslimler: [teslim(chatCreate("c1", "s-t", "Teslim ad"))],
      kuyruk: [kuyrukOgesi(chatCreate("c2", "s-k", "Kuyruk ad"))],
      hatalar: [hataOgesi(chatCreate("c3", "s-h", "Hata ad"))],
    });
    assert.equal(bul(g, "s-t").ad, "Teslim ad");
    assert.equal(bul(g, "s-k").ad, "Kuyruk ad");
    assert.equal(bul(g, "s-h").ad, "Hata ad");
  });

  it("kayıt varsa taban defter adıdır (chat_create kuyruktaysa bile)", () => {
    const g = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1", "Defter"), adDegisti(2, "s-1", "Defter 2")),
      kuyruk: [kuyrukOgesi(chatCreate("c1", "s-1", "Kuyruk"))],
    });
    assert.equal(bul(g, "s-1").ad, "Defter 2");
  });

  it("üstüne önce teslimler sonra kuyruk chat_rename'leri uygulanır; son gelen kazanır", () => {
    const g = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1", "Defter")),
      teslimler: [teslim(chatRename("r1", "s-1", "T1")), teslim(chatRename("r2", "s-1", "T2"))],
      kuyruk: [kuyrukOgesi(chatRename("r3", "s-1", "K1"))],
    });
    assert.equal(bul(g, "s-1").ad, "K1");
    const g2 = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1", "Defter")),
      teslimler: [teslim(chatRename("r1", "s-1", "T1")), teslim(chatRename("r2", "s-1", "T2"))],
    });
    assert.equal(bul(g2, "s-1").ad, "T2");
    const g3 = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1", "Defter")),
      kuyruk: [kuyrukOgesi(chatRename("r1", "s-1", "K1")), kuyrukOgesi(chatRename("r2", "s-1", "K2"))],
    });
    assert.equal(bul(g3, "s-1").ad, "K2");
  });

  it("kayıtsız (bekliyor) sohbetin kuyruktaki chat_rename'i chat_create adını ezer", () => {
    const g = girdi({
      kuyruk: [kuyrukOgesi(chatCreate("c1", "s-k")), kuyrukOgesi(chatRename("r1", "s-k", "Sonra"))],
    });
    assert.equal(bul(g, "s-k").ad, "Sonra");
  });

  it("hatalar'daki chat_rename yok sayılır", () => {
    const g = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1", "Defter")),
      hatalar: [hataOgesi(chatRename("r1", "s-1", "Hatali"))],
    });
    assert.equal(bul(g, "s-1").ad, "Defter");
  });

  it("listede olmayan kimliğin chat_rename'i satır açmaz", () => {
    const g = girdi({
      teslimler: [teslim(chatRename("r1", "s-yok", "X"))],
      kuyruk: [kuyrukOgesi(chatRename("r2", "s-yok2", "Y"))],
      hatalar: [hataOgesi(chatRename("r3", "s-yok3", "Z"))],
    });
    assert.deepEqual(idler(g), ["ana"]);
  });

  it("ana'nın kuyruktaki chat_rename'i adını değiştirir", () => {
    const g = girdi({ kuyruk: [kuyrukOgesi(chatRename("r1", "ana", "Yeni ad"))] });
    assert.equal(bul(g, "ana").ad, "Yeni ad");
  });
});

describe("sohbetler: ozetleriKur türetilen alanlar", () => {
  it("eren: sunucu durumu; sunucu null ya da kimlik yoksa null", () => {
    const k = kayitlarDefterden(acildi(1, "s-1"), acildi(2, "s-2"));
    const g = girdi({ kayitlar: k, sunucu: [{ sohbet_id: "s-1", eren: "tur_suruyor" }, { sohbet_id: "ana", eren: "hazir" }] });
    assert.equal(bul(g, "s-1").eren, "tur_suruyor");
    assert.equal(bul(g, "ana").eren, "hazir");
    assert.equal(bul(g, "s-2").eren, null);
    assert.equal(bul(girdi({ kayitlar: k, sunucu: null }), "s-1").eren, null);
  });

  it("yaziyor: akış varsa ya da eren tur_suruyor ise; değilse false", () => {
    const k = kayitlarDefterden(acildi(1, "s-1"), acildi(2, "s-2"), acildi(3, "s-3"));
    const g = girdi({
      kayitlar: k,
      sunucu: [
        { sohbet_id: "s-1", eren: "hazir" },
        { sohbet_id: "s-2", eren: "tur_suruyor" },
        { sohbet_id: "s-3", eren: "kapali" },
      ],
      gorunumler: { "s-1": gv([], { turn_id: "t", metin: "x" }) },
    });
    assert.equal(bul(g, "s-1").yaziyor, true);
    assert.equal(bul(g, "s-2").yaziyor, true);
    assert.equal(bul(g, "s-3").yaziyor, false);
    assert.equal(bul(g, "ana").yaziyor, false);
  });

  it("okunmamis: seq > okunduSeq olan asistan kaynaklı öğe sayısı", () => {
    const g = girdi({
      gorunumler: {
        ana: gv([
          asistanOgesi(1),
          asistanOgesi(2),
          kullaniciOgesi(3),
          sistemOgesi(4, "bilgi"),
          sistemOgesi(5, "uyari"),
          isOgesi(6, "suruyor"),
          digerOge("plan", 7),
        ]),
      },
      okundu: { ana: 2 },
    });
    // seq 3..7 içinde: kullanici(hayır) sistem bilgi(hayır) sistem uyari(evet) is(hayır) plan(evet) = 2
    assert.equal(bul(g, "ana").okunmamis, 2);
  });

  it("okunmamis: sınırda eşit seq okunmuş sayılır; sınır sohbet başınadır", () => {
    const k = kayitlarDefterden(acildi(1, "s-1"));
    const g = girdi({
      kayitlar: k,
      gorunumler: { ana: gv([asistanOgesi(5)]), "s-1": gv([asistanOgesi(5)]) },
      okundu: { ana: 5, "s-1": 4 },
    });
    assert.equal(bul(g, "ana").okunmamis, 0);
    assert.equal(bul(g, "s-1").okunmamis, 1);
  });

  it("gorunum null → boş: okunmamis 0, calisanIs 0, sonMesaj null, yaziyor false", () => {
    const o = bul(girdi(), "ana");
    assert.equal(o.okunmamis, 0);
    assert.equal(o.calisanIs, 0);
    assert.equal(o.sonMesaj, null);
    assert.equal(o.yaziyor, false);
  });

  it("calisanIs: yalnız tur is ve durum suruyor sayılır", () => {
    const g = girdi({
      gorunumler: {
        ana: gv([isOgesi(1, "suruyor"), isOgesi(2, "suruyor"), isOgesi(3, "tamam"), asistanOgesi(4)]),
      },
    });
    assert.equal(bul(g, "ana").calisanIs, 2);
  });

  it("sonMesaj: sondan geriye ilk kullanici ya da asistan öğesi {kim, metin}", () => {
    const g = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1"), acildi(2, "s-2"), acildi(3, "s-3")),
      gorunumler: {
        ana: gv([kullaniciOgesi(1, "a"), asistanOgesi(2, "b"), isOgesi(3, "suruyor"), sistemOgesi(4, "bilgi")]),
        "s-1": gv([asistanOgesi(1, "x"), kullaniciOgesi(2, "y"), digerOge("plan", 3)]),
        "s-2": gv([digerOge("plan", 1), isOgesi(2, "suruyor")]),
      },
    });
    assert.deepEqual(bul(g, "ana").sonMesaj, { kim: "asistan", metin: "b" });
    assert.deepEqual(bul(g, "s-1").sonMesaj, { kim: "kullanici", metin: "y" });
    assert.equal(bul(g, "s-2").sonMesaj, null);
    assert.equal(bul(g, "s-3").sonMesaj, null);
  });

  it("sonEtkinlikMs: max(olusturma_ms, son öğe ts_ms); öğe yoksa olusturma_ms; ana 0", () => {
    const g = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1"), acildi(2, "s-2"), acildi(3, "s-3")),
      gorunumler: {
        "s-1": gv([asistanOgesi(9, "x", 9000)]), // 9000 > 1001
        "s-2": gv([asistanOgesi(9, "x", 500)]), // 500 < 1002
      },
    });
    assert.equal(bul(g, "s-1").sonEtkinlikMs, 9000);
    assert.equal(bul(g, "s-2").sonEtkinlikMs, 1002);
    assert.equal(bul(g, "s-3").sonEtkinlikMs, 1003);
    assert.equal(bul(g, "ana").sonEtkinlikMs, 0);
  });

  it("sonEtkinlikMs: son öğenin ts_ms'i kullanılır (en büyük değil)", () => {
    const g = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1")),
      gorunumler: { "s-1": gv([asistanOgesi(2, "x", 9000), asistanOgesi(3, "y", 3000)]) },
    });
    assert.equal(bul(g, "s-1").sonEtkinlikMs, 3000);
  });

  it("sonEtkinlikMs: kaydı olmayan (teslim, bekliyor, kurulamadi) için null", () => {
    const g = girdi({
      teslimler: [teslim(chatCreate("c1", "s-t"))],
      kuyruk: [kuyrukOgesi(chatCreate("c2", "s-k"))],
      hatalar: [hataOgesi(chatCreate("c3", "s-h"))],
    });
    assert.equal(bul(g, "s-t").sonEtkinlikMs, null);
    assert.equal(bul(g, "s-k").sonEtkinlikMs, null);
    assert.equal(bul(g, "s-h").sonEtkinlikMs, null);
  });
});

describe("sohbetler: ozetleriKur sıralama", () => {
  it("kayıtsızlar başta, en yeni önce (teslim, kuyruk, hata sırasının tersi); sonra kayıtlılar", () => {
    const g = girdi({
      teslimler: [teslim(chatCreate("c1", "s-t1")), teslim(chatCreate("c2", "s-t2"))],
      kuyruk: [kuyrukOgesi(chatCreate("c3", "s-k1")), kuyrukOgesi(chatCreate("c4", "s-k2"))],
      hatalar: [hataOgesi(chatCreate("c5", "s-h1")), hataOgesi(chatCreate("c6", "s-h2"))],
      kayitlar: kayitlarDefterden(acildi(1, "s-d")),
    });
    assert.deepEqual(idler(g), ["s-h2", "s-h1", "s-k2", "s-k1", "s-t2", "s-t1", "s-d", "ana"]);
  });

  it("kayıtlılar sonEtkinlikMs azalan", () => {
    const g = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1"), acildi(2, "s-2"), acildi(3, "s-3")),
    });
    assert.deepEqual(idler(g), ["s-3", "s-2", "s-1", "ana"]);
    const g2 = girdi({
      kayitlar: kayitlarDefterden(acildi(1, "s-1"), acildi(2, "s-2")),
      gorunumler: { ana: gv([asistanOgesi(5, "x", 50_000)]), "s-1": gv([asistanOgesi(6, "y", 40_000)]) },
    });
    assert.deepEqual(idler(g2), ["ana", "s-1", "s-2"]);
  });

  it("eşit sonEtkinlikMs'te olusturma_seq azalan", () => {
    const k = new Map<string, SohbetKaydi>([
      ["ana", anaKaydi()],
      ["s-a", { sohbet_id: "s-a", ad: "A", olusturma_seq: 2, olusturma_ms: 7000 }],
      ["s-b", { sohbet_id: "s-b", ad: "B", olusturma_seq: 9, olusturma_ms: 7000 }],
      ["s-c", { sohbet_id: "s-c", ad: "C", olusturma_seq: 5, olusturma_ms: 7000 }],
    ]);
    assert.deepEqual(idler(girdi({ kayitlar: k })), ["s-b", "s-c", "s-a", "ana"]);
  });
});

describe("sohbetler: adHazirla", () => {
  it("baş ve son boşluk kırpılır", () => {
    assert.equal(adHazirla("  Proje  "), "Proje");
  });

  it("boş ya da yalnız boşluk null", () => {
    assert.equal(adHazirla(""), null);
    assert.equal(adHazirla("   "), null);
    assert.equal(adHazirla(" \t "), null);
  });

  it("satır sonu, sekme, görünmez birim ve eşsiz vekil içeren null", () => {
    assert.equal(adHazirla("a\nb"), null);
    assert.equal(adHazirla("a\tb"), null);
    assert.equal(adHazirla("a​b"), null);
    assert.equal(adHazirla("a‮b"), null);
    assert.equal(adHazirla("a\ud800b"), null);
    assert.equal(adHazirla("a\udc00"), null);
  });

  it("60 UTF-16 birimi geçer, 61 null", () => {
    assert.equal(adHazirla("a".repeat(60)), "a".repeat(60));
    assert.equal(adHazirla("a".repeat(61)), null);
  });

  it("60 birim emoji ile de geçer (30 emoji), 62 birim null; kırpma sonrası uzunluk sayılır", () => {
    assert.equal(adHazirla("😀".repeat(30)), "😀".repeat(30));
    assert.equal(adHazirla("😀".repeat(31)), null);
    assert.equal(adHazirla(` ${"a".repeat(60)} `), "a".repeat(60));
  });

  it("geçerli ad kırpılmış olarak döner; iç boşluk korunur", () => {
    assert.equal(adHazirla(" Türkçe ad ğüşiöç "), "Türkçe ad ğüşiöç");
  });
});

describe("sohbetler: otomatikAd", () => {
  it("kısa metin olduğu gibi (40 birim dahil)", () => {
    assert.equal(otomatikAd("Merhaba dünya"), "Merhaba dünya");
    assert.equal(otomatikAd("a".repeat(40)), "a".repeat(40));
  });

  it("boş, yalnız boşluk ve yalnız görünmez karakter null", () => {
    assert.equal(otomatikAd(""), null);
    assert.equal(otomatikAd("  \n\t "), null);
    assert.equal(otomatikAd("​‮﻿"), null);
  });

  it("boşluk dizileri (satır sonu, sekme, NBSP) tek boşluk olur", () => {
    assert.equal(otomatikAd("a\n\tb"), "a b");
    assert.equal(otomatikAd("a b"), "a b");
    assert.equal(otomatikAd("a   b\r\nc"), "a b c");
    assert.equal(otomatikAd("  baş ve son  "), "baş ve son");
  });

  it("görünmez birimler atılır; aralarındaki çift boşluk tek olur", () => {
    assert.equal(otomatikAd("a ​ b"), "a b");
    assert.equal(otomatikAd("a\u0000b"), "ab");
    assert.equal(otomatikAd("​merhaba﻿"), "merhaba");
  });

  it("uzun metin son boşluktan kesilir, sonuna … eklenir (TASARIM örneği)", () => {
    const s = otomatikAd("Bugün hava çok güzel ve ben dışarı çıkıp yürüyüş yapmak istiyorum");
    assert.equal(s, "Bugün hava çok güzel ve ben dışarı çıkıp…");
  });

  it("kesim: ilk 40 birimin son boşluğundan; sözcük ortasında kesilmez", () => {
    // 'x' * 35 + " " + 'y' * 10 : boşluk 35. konumda
    const s = otomatikAd(`${"x".repeat(35)} ${"y".repeat(10)}`);
    assert.equal(s, `${"x".repeat(35)}…`);
  });

  it("41. birim boşluksa (index 40) son sözcük korunur: bilinçli", () => {
    const s = otomatikAd(`${"x".repeat(40)} y`);
    assert.equal(s, `${"x".repeat(40)}…`);
    assert.equal(s!.length, 41);
  });

  it("42. birim boşluksa ilk 40 içinde boşluk yok: 40'tan kesilir", () => {
    const s = otomatikAd(`${"x".repeat(41)} y`);
    assert.equal(s, `${"x".repeat(40)}…`);
  });

  it("boşluksuz uzun sözcük 40'ta kesilir; sonuç en çok 41 birim", () => {
    const s = otomatikAd("a".repeat(100));
    assert.equal(s, `${"a".repeat(40)}…`);
    assert.equal(s!.length, 41);
    assert.equal(otomatikAd("a".repeat(41)), `${"a".repeat(40)}…`);
  });

  it("40. birim yüksek vekilse (yarım çift) o da atılır: 39 + …", () => {
    const s = otomatikAd(`${"a".repeat(39)}😀b`);
    assert.equal(s, `${"a".repeat(39)}…`);
    assert.equal(s!.length, 40);
  });

  it("emoji 40. birimde tam bitiyorsa korunur", () => {
    const s = otomatikAd(`${"a".repeat(38)}😀bcd`);
    assert.equal(s, `${"a".repeat(38)}😀…`);
  });

  it("sonuç Yeni sohbet'e eşitse null (boşluklar tek olduktan sonra)", () => {
    assert.equal(otomatikAd("Yeni sohbet"), null);
    assert.equal(otomatikAd("Yeni  sohbet"), null);
    assert.equal(otomatikAd("  Yeni\nsohbet "), null);
  });

  it("Yeni sohbet ile başlayan başka metin null değildir", () => {
    assert.equal(otomatikAd("Yeni sohbet açalım"), "Yeni sohbet açalım");
  });
});
