import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AJANDA_ARACLARI,
  AJANDA_SINIRLARI,
  ajandaDegisikligiUygula,
  ajandaEkleMetni,
  ajandaEsDegisikligi,
  ajandaEsitlemeAdimi,
  ajandaHelloAlanlari,
  ajandaKacir,
  AjandaKaydi,
  type AjandaKopya,
  type AjandaKuyrukKarari,
  type AjandaKuyrukOlayi,
  ajandaKuyrukKarari,
  type AjandaRetNedeni,
  ajandaTekilAnahtari,
  ajandaTekilKarari,
  ajandaYukariCoz,
  AJANDA_SURUMU,
  type AnCevirici,
  dayanakGecerliMi,
  kacirilanHatirlatmalar,
  kurulacakHatirlatmalar,
  mesajAniDamgasi,
} from "../src/index.ts";

/**
 * Gözden geçirmenin sekiz bulgusunun uçtan uca senaryoları: sözleşmenin saf parçaları servis,
 * konuşma modülü ve uygulamanın yapacağı sırayla çağrılır. Dil bağımsız kurallar ayrıca vektörde.
 */

const IST = "Europe/Istanbul";
/** Testte Europe/Istanbul sabit UTC+3. */
const anCevir: AnCevirici = (tarih, saat) => Date.parse(`${tarih}T${saat}:00Z`) - 180 * 60_000;
const yerel = (tarih: string, saat: string) => anCevir(tarih, saat, IST);

function kayit(yama: Record<string, unknown> = {}): AjandaKaydi {
  return AjandaKaydi.parse({
    kayit_id: "k_dis01",
    revizyon: 3,
    tur: "randevu",
    baslik: "Dişçi",
    zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: IST, ifade: "yarın 3'te" },
    hatirlatmalar: [{ tur: "once", dk: 60 }],
    ornekler: [],
    durum: "acik",
    taslak: false,
    silindi: false,
    elle_alanlar: [],
    kaynak: { yol: "sohbet_araci", tur_kokeni: "insan", sohbet_id: "ana" },
    olusturma_ms: 1,
    guncelleme_ms: 1,
    ...yama,
  });
}

test("bulgu 1: 23:58'de yazılıp 00:01'de iletilen 'yarın 3'te' mesajın ertesi gününe düşer", () => {
  // Konuşma modülü mesaj anını varışta saklar ve damgayı ondan yazar; iletim anı damgaya girmez.
  const mesajAni = { tarih: "2026-11-25", saat: "23:58", saat_dilimi: IST };
  assert.equal(mesajAniDamgasi(mesajAni), "[mesaj_ani: 2026-11-25 Çarşamba 23:58 Europe/Istanbul]");
  // Model damgaya dayanır: yarın = 26'sı. Servis kabul eder.
  const girdi = {
    tur: "randevu",
    baslik: "Dişçi",
    zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", ifade: "yarın 3'te" },
    dayanak: { tarih: "2026-11-25", saat: "23:58" },
  };
  assert.equal(AJANDA_ARACLARI.ajanda_ekle.girdi.safeParse(girdi).success, true);
  assert.equal(dayanakGecerliMi(girdi.dayanak, mesajAni), true);
  // İletim ya da çağrı anına (00:01, ertesi gün) dayanan model "yarın"ı 27'si çözerdi: reddedilir,
  // ret metni mesaj anını verir ve şimdiye değil ona yönlendirir.
  assert.equal(dayanakGecerliMi({ tarih: "2026-11-26", saat: "00:01" }, mesajAni), false);
  const ret = ajandaEkleMetni({ sonuc: "ret", mesaj_ani: mesajAni, neden: "dayanak_uyusmuyor" });
  assert.match(ret, /mesaj_ani=2026-11-25 Çarşamba 23:58 Europe\/Istanbul$/);
  assert.match(ret, /şimdiki saat değil/);
});

test("bulgu 2: silinen taslak ertesi gün başka sözle (bugün 3'te) otomasyonla geri doğmaz", () => {
  const zaman = (ifade: string) => ({ kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: IST, ifade }) as const;
  const anahtar = ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi", zaman: zaman("yarın 3'te") });
  const taslak = kayit({ taslak: true, silindi: true, kaynak: { yol: "sohbet_araci", tur_kokeni: "sentetik", sohbet_id: "ana", tekil_anahtar: anahtar } });
  const ertesiGun = ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi", zaman: zaman("bugün 3'te") });
  assert.equal(ertesiGun, anahtar);
  const esler = [taslak].filter((k) => k.kaynak.tekil_anahtar === ertesiGun);
  assert.deepEqual(ajandaTekilKarari(esler, { yol: "sohbet_araci", tur_kokeni: "sentetik" }), { karar: "zaten_var", sira: 0 });
  // Süre eklenmesi de aynı kayıttır; saat farklıysa başka kayıttır.
  assert.equal(ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi", zaman: { ...zaman("x"), sure_dk: 30 } }), anahtar);
  assert.notEqual(ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi", zaman: { ...zaman("x"), saat: "16:00" } }), anahtar);
});

test("bulgu 2 ve 8b: taslağı başka sözle yeniden istemek onaylar ve bu turda söyleneni (yarım saat önce, açıklama) işler", () => {
  const anahtar = ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi", zaman: kayit().zaman });
  const taslak = kayit({ taslak: true, kaynak: { yol: "sohbet_araci", tur_kokeni: "sentetik", sohbet_id: "ana", tekil_anahtar: anahtar } });
  // Kullanıcı: "26'sında saat 15'te dişçi, yarım saat önce hatırlat; dolgu kontrolü".
  const girdi = {
    aciklama: "Dolgu kontrolü",
    zaman: { kesinlik: "an", tarih: "2026-11-26", saat: "15:00", saat_dilimi: IST, ifade: "26'sında saat 15'te" },
    hatirlatmalar: [{ tur: "once", dk: 30 }],
  } as const;
  const yeniAnahtar = ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "randevu", baslik: "Dişçi", zaman: girdi.zaman });
  assert.equal(yeniAnahtar, anahtar, "başka söz, aynı çözülmüş zaman: aynı kayıt");
  const insan = { yol: "sohbet_araci", tur_kokeni: "insan" } as const;
  assert.deepEqual(ajandaTekilKarari([taslak], insan), { karar: "onayla", sira: 0 });
  const degisiklik = ajandaEsDegisikligi(taslak, { ...girdi, hatirlatmalar: [...girdi.hatirlatmalar] });
  const s = ajandaDegisikligiUygula(taslak, degisiklik, insan);
  const onaylanan = { ...s.kayit, taslak: false };
  assert.equal(AjandaKaydi.safeParse(onaylanan).success, true);
  assert.deepEqual(onaylanan.hatirlatmalar, [{ tur: "once", dk: 30 }]);
  assert.equal(onaylanan.aciklama, "Dolgu kontrolü");
  assert.equal(onaylanan.zaman?.kesinlik === "an" && onaylanan.zaman.ifade, "yarın 3'te", "kaydı doğuran söz korunur");
  assert.deepEqual(s.uygulanan, ["aciklama", "hatirlatmalar"]);
  assert.deepEqual(onaylanan.elle_alanlar, ["aciklama", "hatirlatmalar"]);
  // Yarım saat önceki hatırlatma kurulur (14:30).
  const kurulan = kurulacakHatirlatmalar(onaylanan, yerel("2026-11-25", "20:00"), anCevir);
  assert.deepEqual(kurulan.map((h) => h.tetik_ms), [yerel("2026-11-26", "14:30")]);
});

/** Uygulamanın kuyruğunu ve servisi taklit eder; her işlem bir sonuca ulaşana dek döner. */
function kuyruguIslet(
  islemler: string[],
  sunucu: (islem: string, deneme: number) => AjandaKuyrukOlayi,
): { gidenler: string[]; ret: { islem: string; neden: string }[]; adim: number } {
  const kuyruk = islemler.map((islem) => ({ islem, deneme: 0 }));
  const gidenler: string[] = [];
  const ret: { islem: string; neden: string }[] = [];
  let adim = 0;
  while (kuyruk.length > 0) {
    assert.ok(++adim < 100, "kuyruk ilerlemeli");
    const bas = kuyruk[0]!;
    const k: AjandaKuyrukKarari = ajandaKuyrukKarari(sunucu(bas.islem, bas.deneme), bas.deneme);
    if (k.karar === "bekle") bas.deneme = k.deneme;
    else {
      kuyruk.shift();
      if (k.karar === "cikar") gidenler.push(bas.islem);
      else ret.push({ islem: bas.islem, neden: k.neden });
    }
  }
  return { gidenler, ret, adim };
}

test("bulgu 3: gövdesi servisin şemasından geçmeyen işlem islem_id'li retle ret listesine düşer, arkası gider", () => {
  const v = AJANDA_SURUMU;
  // Uygulamanın gelecekteki bir sürümü servisin bilmediği bir alan yollasın (iki doğrulama ayrıştı).
  const bozuk = JSON.stringify({ v, type: "islem", islem_id: "i_bozuk", islem: { islem: "ekle", kayit_id: "k9", tur: "not", baslik: "x", hatirlatmalar: [], girdi_yolu: "elle", renk: "mavi" } });
  const s = ajandaYukariCoz(bozuk);
  assert.equal(s.ok, false);
  assert.equal(s.islem_id, "i_bozuk", "servis bağlantıyı kapatmadan islem_sonucu{code:gecersiz_islem} döner");
  const sunucu = (islem: string): AjandaKuyrukOlayi =>
    islem === "i_bozuk" ? { olay: "sonuc", ok: false, code: "gecersiz_islem" } : { olay: "sonuc", ok: true };
  const r = kuyruguIslet(["i_bozuk", "i_1", "i_2"], sunucu);
  assert.deepEqual(r.gidenler, ["i_1", "i_2"]);
  assert.deepEqual(r.ret, [{ islem: "i_bozuk", neden: "gecersiz_islem" }]);
});

test("bulgu 3: hep ic_hata alan ya da her yollanışta bağlantıyı düşüren işlem sınırda ret listesine geçer", () => {
  for (const [olay, neden] of [
    [{ olay: "sonuc", ok: false, code: "ic_hata" as AjandaRetNedeni }, "ic_hata"],
    [{ olay: "kopma" }, "teslim_edilemedi"],
  ] as const) {
    const r = kuyruguIslet(["i_kotu", "i_1"], (islem) => (islem === "i_kotu" ? olay : { olay: "sonuc", ok: true }));
    assert.deepEqual(r.gidenler, ["i_1"]);
    assert.deepEqual(r.ret, [{ islem: "i_kotu", neden }]);
    assert.equal(r.adim, AJANDA_SINIRLARI.ISLEM_DENEME + 1);
  }
  // Ara sıra geçici hata: sınırdan önce başarı gelirse işlem gider.
  const r = kuyruguIslet(["i_1"], (_, deneme) => (deneme < 2 ? { olay: "sonuc", ok: false, code: "ic_hata" } : { olay: "sonuc", ok: true }));
  assert.deepEqual(r.gidenler, ["i_1"]);
});

test("bulgu 4: yanıtı gelmeden kopan işlem tam eşitlemede kuyrukta kalır ve aynı kimlikle yeniden gider", () => {
  let deneme = 0;
  let k = ajandaKuyrukKarari({ olay: "kopma" }, deneme);
  assert.deepEqual(k, { karar: "bekle", deneme: 1 });
  deneme = 1;
  k = ajandaKuyrukKarari({ olay: "tam_telafi" }, deneme);
  assert.deepEqual(k, { karar: "bekle", deneme: 1 }, "tam telafi yollanmış işlemi de atmaz");
  assert.deepEqual(ajandaKuyrukKarari({ olay: "sonuc", ok: true }, 1), { karar: "cikar" });
});

test("bulgu 5: yarıda kesilen tam eşitleme görünen kayıtları ve kurulu hatırlatmaları götürmez", () => {
  const dis = kayit({ revizyon: 7, guncelleme_ms: 2000 });
  let d: AjandaKopya = { depo_id: "d_a", son_rev: 7, kayitlar: new Map([[dis.kayit_id, dis]]) };
  const simdi = yerel("2026-11-25", "20:00");
  const alarmlar = (x: AjandaKopya) => [...x.kayitlar.values()].flatMap((r) => kurulacakHatirlatmalar(r, simdi, anCevir));
  const once = alarmlar(d);
  assert.equal(once.length, 1);
  d = ajandaEsitlemeAdimi(d, { olay: "welcome", depo_id: "d_b", tam: true });
  d = ajandaEsitlemeAdimi(d, { olay: "kayit", kayit: kayit({ kayit_id: "k_baska", revizyon: 1 }) });
  assert.deepEqual(alarmlar(d), once, "telafi sürerken");
  d = ajandaEsitlemeAdimi(d, { olay: "kopma" });
  assert.deepEqual(alarmlar(d), once, "kopmadan sonra");
  assert.deepEqual(ajandaHelloAlanlari(d), { son_rev: 7, depo_id: "d_a", son_rev_izi: { kayit_id: "k_dis01", guncelleme_ms: 2000 } });
});

test("bulgu 6: kurulmuş ama telefon kapalıyken kaçan hatırlatma açılışta bir kez gösterilir; yağmur yok", () => {
  const dis = kayit({ zaman: { kesinlik: "an", tarih: "2026-11-25", saat: "15:00", saat_dilimi: IST } });
  // 10:00'da kuruldu: tetik 14:00.
  const kurulan = kurulacakHatirlatmalar(dis, yerel("2026-11-25", "10:00"), anCevir).map((h) => h.tetik_ms);
  assert.deepEqual(kurulan, [yerel("2026-11-25", "14:00")]);
  // Telefon 13:50-14:20 kapalı; 14:20'de açılış kurulumu: kurulacak yok, kaçırılan var.
  const acilis = yerel("2026-11-25", "14:20");
  assert.deepEqual(kurulacakHatirlatmalar(dis, acilis, anCevir), []);
  assert.deepEqual(kacirilanHatirlatmalar(dis, acilis, anCevir, kurulan), [{ sira: 0, tetik_ms: kurulan[0]! }]);
  // Teslim edildi işaretlenince kurulanlardan çıkar: ikinci yeniden kurulumda yine gösterilmez.
  assert.deepEqual(kacirilanHatirlatmalar(dis, acilis + 60_000, anCevir, []), []);
  // Teslimden hemen önce gelen kayit çerçevesi yeniden kurulumu tetikler: tetik geçmiş ama kurulu.
  assert.deepEqual(kacirilanHatirlatmalar(dis, kurulan[0]! + 100, anCevir, kurulan).length, 1);
  // 14:30'da "bugün 3'te" eklenen kayıt: 14:00 hiç kurulmadı, çalmaz.
  assert.deepEqual(kacirilanHatirlatmalar(dis, yerel("2026-11-25", "14:30"), anCevir, []), []);
  // Telefon günlerce kapalı kaldı: pencereden eski kurulu alarmlar sessizce düşer.
  assert.deepEqual(kacirilanHatirlatmalar(dis, yerel("2026-11-27", "09:00"), anCevir, kurulan), []);
  assert.equal(AJANDA_SINIRLARI.KACIRILAN_PENCERE_DK, 360);
});

test("bulgu 7: emojili başlık, ifade ve alıntı araçtan kabul edilir; modele görünür kaçışla gider", () => {
  const kahve = "Kahve ☕️";
  const gunes = "yarın ☀️";
  const girdi = {
    tur: "gorev",
    baslik: kahve,
    aciklama: "Aile \u{1F468}‍\u{1F469}‍\u{1F467} için",
    zaman: { kesinlik: "gun", tarih: "2026-11-26", ifade: gunes },
    alinti: `${gunes} kahve ☕️ al`,
    dayanak: { tarih: "2026-11-25", saat: "14:30" },
  };
  assert.equal(AJANDA_ARACLARI.ajanda_ekle.girdi.safeParse(girdi).success, true);
  assert.equal(ajandaKacir(girdi.baslik, 200), "Kahve ☕\\ufe0f");
  // Görünmez metin kaçırma yolu açık değil: seçici zinciri, VS1-VS256 ve etiketler yine reddedilir.
  assert.equal(AJANDA_ARACLARI.ajanda_ekle.girdi.safeParse({ ...girdi, baslik: kahve + "️️" }).success, false);
  assert.equal(AJANDA_ARACLARI.ajanda_ekle.girdi.safeParse({ ...girdi, baslik: "Kahve ☕︀" }).success, false);
  assert.equal(AJANDA_ARACLARI.ajanda_ekle.girdi.safeParse({ ...girdi, baslik: "Kahve ☕\u{E0049}" }).success, false);
});
