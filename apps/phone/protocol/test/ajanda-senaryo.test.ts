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
  AJANDA_VARSAYILAN_HATIRLATMALAR,
  ajandaGuncelleMetni,
  ajandaZamanOzeti,
  type AnCevirici,
  dayanakGecerliMi,
  geceTeyidiEksikMi,
  hatirlatmaOzeti,
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

/**
 * İlk gerçek kullanım (v2'nin iki pürüzü). Perşembeyi cumaya bağlayan gece 01:45'te (27 Kasım Cuma)
 * kullanıcı "Yarın akşama araba yıkama oluştur ajandada" yazdı; uyanınca başlayacak günü (cuma)
 * kastediyordu. v1'de asistan cumartesiye (28) saatsiz yazdı, "1 saat önce" hiç çalmayacaktı; kullanıcı
 * üç dakika sonra "cuma akşamı" diye düzeltti. Servis, konuşma modülü ve uygulamanın yapacağı sırayla.
 */
test("gerçek kullanım: 01:45 'yarın akşama' → gece sorusu → 'cuma akşamı' → kayıt saatsiz, Cuma 17:00'de hatırlatılır", () => {
  const an0145 = { tarih: "2026-11-27", saat: "01:45", saat_dilimi: IST };
  assert.equal(mesajAniDamgasi(an0145), "[mesaj_ani: 2026-11-27 Cuma 01:45 Europe/Istanbul]");

  // 1. Model takvimdeki "yarın"ı (28) çözer ve gün bölümünü yapıya koyar; saat uydurmaz.
  const ilk = AJANDA_ARACLARI.ajanda_ekle.girdi.parse({
    tur: "gorev",
    baslik: "Araba yıkama",
    zaman: { kesinlik: "gun", tarih: "2026-11-28", gun_bolumu: "aksam", ifade: "yarın akşama" },
    alinti: "Yarın akşama araba yıkama",
    dayanak: { tarih: "2026-11-27", saat: "01:45" },
  });
  assert.equal(dayanakGecerliMi(ilk.dayanak!, an0145), true, "dayanak doğru: sorun gece belirsizliği");
  // 2. Servis gece aralığını tanır, kayıt yazmaz; ret metni iki günü adıyla verip kısa soruya yönlendirir.
  assert.equal(geceTeyidiEksikMi(ilk, an0145, "insan"), true);
  const ret = ajandaEkleMetni({ sonuc: "ret", mesaj_ani: an0145, neden: "gece_teyidi_gerekli" });
  assert.match(ret, /"27 Kasım Cuma mı, 28 Kasım Cumartesi mi\?"/);

  // 3. Kullanıcı 01:47'de "cuma akşamı" der: yeni turun mesaj anı, teyit "soruldu".
  const an0147 = { ...an0145, saat: "01:47" };
  const ikinci = AJANDA_ARACLARI.ajanda_ekle.girdi.parse({
    tur: "gorev",
    baslik: "Araba yıkama",
    zaman: { kesinlik: "gun", tarih: "2026-11-27", gun_bolumu: "aksam", ifade: "cuma akşamı" },
    dayanak: { tarih: "2026-11-27", saat: "01:47", gece_teyidi: "soruldu" },
  });
  assert.equal(dayanakGecerliMi(ikinci.dayanak!, an0147), true);
  assert.equal(geceTeyidiEksikMi(ikinci, an0147, "insan"), false);
  // Servis kaydı kurar: dilim mesaj anından, hatırlatma verilmediği için varsayılan.
  const zaman = { ...ikinci.zaman!, saat_dilimi: IST } as AjandaKaydi["zaman"];
  const yeni = kayit({ kayit_id: "k_araba", tur: "gorev", baslik: "Araba yıkama", zaman, hatirlatmalar: AJANDA_VARSAYILAN_HATIRLATMALAR.map((h) => ({ ...h })), revizyon: 1 });
  assert.equal(yeni.zaman?.kesinlik, "gun");
  assert.equal("saat" in yeni.zaman!, false, "kayıt saatsiz kalır: saat uydurulmaz");
  const simdi = yerel("2026-11-27", "01:47");
  // Uygulama: tek alarm, Cuma 17:00 (akşam bölümünün gün hatırlatması).
  assert.deepEqual(kurulacakHatirlatmalar(yeni, simdi, anCevir), [
    { sira: 0, hal: "kurulur", tetik_ms: yerel("2026-11-27", "17:00"), gun_hatirlatmasi: { tarih: "2026-11-27", saat: "17:00" } },
  ]);
  // Model: günü adıyla söyler, hatırlatmanın ne zaman geleceğini bilir.
  const ozet = { kayit_id: yeni.kayit_id, revizyon: 1, durum: yeni.durum, taslak: false, silindi: false, zaman: ajandaZamanOzeti(yeni.zaman!), hatirlatma: hatirlatmaOzeti(yeni, simdi, anCevir) };
  const cikti = AJANDA_ARACLARI.ajanda_ekle.cikti.parse({ sonuc: "eklendi", mesaj_ani: an0147, kayit: ozet });
  const metin = ajandaEkleMetni(cikti);
  assert.match(metin, /zaman=2026-11-27 Cuma saatsiz aksam Europe\/Istanbul \(mesaj anına göre bugün\)/);
  assert.match(metin, /gun_hatirlatmasi=2026-11-27 Cuma 17:00/);
  assert.match(metin, /Yanıtında kaydın gününü adıyla ve tarihiyle söyle \(27 Kasım Cuma\)/);
  assert.equal(metin.includes("cuma akşamı"), false, "kullanıcının sözü özete girmez");
});

test("gerçek kullanım, v1 yolu: cumartesiye yazılmış kayıt 'cuma akşamı' ile düzeltilince hatırlatma kendiliğinden cumaya taşınır", () => {
  const insan = { yol: "sohbet_araci", tur_kokeni: "insan" } as const;
  // v1'de yazılmış kayıt (gun_bolumu yok): v2 şemasında geçerli, göç gerekmez.
  const v1 = kayit({
    kayit_id: "k_araba",
    tur: "gorev",
    baslik: "Araba yıkama",
    zaman: { kesinlik: "gun", tarih: "2026-11-28", saat_dilimi: IST, ifade: "yarın akşama" },
    hatirlatmalar: [{ tur: "once", dk: 60 }],
    revizyon: 1,
  });
  const simdi0148 = yerel("2026-11-27", "01:48");
  // v2 uygulaması: bölümsüz gün → o günün 09:00'ı (v1'de hiç çalmıyordu).
  const eski = kurulacakHatirlatmalar(v1, simdi0148, anCevir).map((h) => h.tetik_ms);
  assert.deepEqual(eski, [yerel("2026-11-28", "09:00")]);
  // Düzeltme 01:48: gün adıyla söylendi, teyit gun_acik; teyitsiz gelse servis reddederdi.
  const an0148 = { tarih: "2026-11-27", saat: "01:48", saat_dilimi: IST };
  const duzeltme = {
    kayit_id: "k_araba",
    dayanak: { tarih: "2026-11-27", saat: "01:48", gece_teyidi: "gun_acik" as const },
    degisiklik: { zaman: { kesinlik: "gun" as const, tarih: "2026-11-27", gun_bolumu: "aksam" as const, ifade: "cuma akşamı" } },
  };
  assert.equal(AJANDA_ARACLARI.ajanda_guncelle.girdi.safeParse(duzeltme).success, true);
  assert.equal(geceTeyidiEksikMi(duzeltme, an0148, "insan"), false);
  const { gece_teyidi: _t, ...teyitsiz } = duzeltme.dayanak;
  assert.equal(geceTeyidiEksikMi({ ...duzeltme, dayanak: teyitsiz }, an0148, "insan"), true);
  // Servis birleştirir: hatırlatma listesine dokunulmaz, liste mutlak bir ana bağlı değildir.
  const s = ajandaDegisikligiUygula(v1, { zaman: { ...duzeltme.degisiklik.zaman, saat_dilimi: IST } }, insan);
  assert.deepEqual(s.uygulanan, ["zaman"]);
  const yeni = AjandaKaydi.parse({ ...s.kayit, revizyon: 2 });
  assert.deepEqual(yeni.hatirlatmalar, [{ tur: "once", dk: 60 }]);
  // Uygulama yeniden kurar: tek alarm Cuma 17:00; eski kimlik (28 09:00) yeni kümede yok, iptal edilir,
  // tetiği gelmediği için kaçırılan da sayılmaz.
  const kurulan = kurulacakHatirlatmalar(yeni, simdi0148, anCevir).map((h) => h.tetik_ms);
  assert.deepEqual(kurulan, [yerel("2026-11-27", "17:00")]);
  assert.equal(kurulan.includes(eski[0]!), false);
  assert.deepEqual(kacirilanHatirlatmalar(yeni, simdi0148, anCevir, eski), []);
  // Model yeni günü adıyla söyler.
  const ozet = { kayit_id: "k_araba", revizyon: 2, durum: "acik" as const, taslak: false, silindi: false, zaman: ajandaZamanOzeti(yeni.zaman!), hatirlatma: hatirlatmaOzeti(yeni, simdi0148, anCevir) };
  const metin = ajandaGuncelleMetni(AJANDA_ARACLARI.ajanda_guncelle.cikti.parse({ sonuc: "guncellendi", mesaj_ani: an0148, kayit: ozet, korunan_alanlar: [] }));
  assert.match(metin, /^ajanda_guncelle: güncellendi .*zaman=2026-11-27 Cuma saatsiz aksam .*\(27 Kasım Cuma\)/);
  // Tekilleştirme: cuma akşamı ile cumartesi akşamı ayrı kayıttır; anahtar hatırlatmadan etkilenmez.
  const anahtar = (z: AjandaKaydi["zaman"]) => ajandaTekilAnahtari({ kapsam: "sohbet:ana", tur: "gorev", baslik: "Araba yıkama", zaman: z });
  assert.notEqual(anahtar(yeni.zaman), anahtar({ ...(yeni.zaman as object), tarih: "2026-11-28" } as AjandaKaydi["zaman"]));
  assert.equal(anahtar(yeni.zaman), anahtar({ ...(yeni.zaman as object), ifade: "başka söz" } as AjandaKaydi["zaman"]));
});

test("v2 hatırlatma yaşam döngüsü: gün değişir, saat gelir ve kalkar, kullanıcı kapatır, geçmişte kalır", () => {
  const insan = { yol: "elle", tur_kokeni: "insan" } as const;
  // Uygulamadan elle, saatsiz ve bölümsüz: form varsayılanla açılır → o günün 09:00'ı.
  let k = kayit({
    kayit_id: "k_fatura",
    tur: "gorev",
    baslik: "Fatura öde",
    zaman: { kesinlik: "gun", tarih: "2026-11-30", saat_dilimi: IST },
    hatirlatmalar: AJANDA_VARSAYILAN_HATIRLATMALAR.map((h) => ({ ...h })),
    kaynak: { yol: "elle", tur_kokeni: "insan", device_id: "cihaz_ornek" },
  });
  const simdi = yerel("2026-11-27", "12:00");
  const tetikler = () => kurulacakHatirlatmalar(k, simdi, anCevir).map((h) => h.tetik_ms);
  const uygula = (d: Parameters<typeof ajandaDegisikligiUygula>[1]) => {
    k = AjandaKaydi.parse(ajandaDegisikligiUygula(k, d, insan).kayit);
  };
  assert.deepEqual(tetikler(), [yerel("2026-11-30", "09:00")]);
  uygula({ zaman: { kesinlik: "gun", tarih: "2026-12-01", saat_dilimi: IST } });
  assert.deepEqual(tetikler(), [yerel("2026-12-01", "09:00")], "gün değişince yeni güne gider");
  uygula({ zaman: { kesinlik: "gun", tarih: "2026-12-01", gun_bolumu: "ogleden_sonra", saat_dilimi: IST } });
  assert.deepEqual(tetikler(), [yerel("2026-12-01", "13:00")], "gün bölümü verilince onun saatine");
  uygula({ zaman: { kesinlik: "an", tarih: "2026-12-01", saat: "15:30", saat_dilimi: IST } });
  assert.deepEqual(tetikler(), [yerel("2026-12-01", "14:30")], "saat gelince saatli kural; gün hatırlatması kalkar");
  assert.equal(kurulacakHatirlatmalar(k, simdi, anCevir)[0]!.gun_hatirlatmasi, undefined);
  uygula({ zaman: { kesinlik: "gun", tarih: "2026-12-01", saat_dilimi: IST } });
  assert.deepEqual(tetikler(), [yerel("2026-12-01", "09:00")], "saat kalkınca gün hatırlatmasına döner");
  uygula({ zaman: { kesinlik: "donem", baslangic: "2026-12-01", bitis: "2026-12-05", saat_dilimi: IST } });
  assert.deepEqual(tetikler(), [], "dönemde bekler");
  uygula({ zaman: { kesinlik: "gun", tarih: "2026-11-27", saat_dilimi: IST } });
  assert.deepEqual(tetikler(), [], "öğlen 'bugün'e alınan kaydın 09:00'ı geçti: hiç çalmaz");
  assert.deepEqual(hatirlatmaOzeti(k, simdi, anCevir), { toplam: 1, kurulacak: 0, saatsiz: 0, gecmis: 1, gun_hatirlatmasi: { tarih: "2026-11-27", saat: "09:00", gecti: true } });
  uygula({ zaman: { kesinlik: "gun", tarih: "2026-11-30", saat_dilimi: IST }, hatirlatmalar: [] });
  assert.deepEqual(tetikler(), [], "kullanıcı kapattı");
  uygula({ zaman: { kesinlik: "gun", tarih: "2026-12-02", saat_dilimi: IST } });
  assert.deepEqual(k.hatirlatmalar, [], "kapalı kalır: birleştirme varsayılanı geri koymaz");
  assert.deepEqual(tetikler(), []);
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
