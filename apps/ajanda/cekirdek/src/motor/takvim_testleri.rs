//! Takvim sorgularının testleri (`motor/takvim.rs`): görünen kopyaya doğrudan yazılan kayıtlarla, sabit ofsetli
//! ve yaz saatli sahte çeviricilerle. Kenar durumları: ay ve yıl sınırları, artık yıl, yaz saati geçişi,
//! gece yarısını aşan kayıt, dilim çevirisi, tekrar ve örnek durumları, görünürlük, çok kayıtlı gün, boş ay.

use super::*;
use crate::kural::{SabitOfsetCevirici, ZamanHatasi};
use crate::model::YerelAn;
use serde_json::{Value, json};

const IST: &str = "Europe/Istanbul";
const YAZ: &str = "Test/Yaz";
const DK_MS: i64 = 60_000;

fn depo() -> Depo {
    Depo::ac(":memory:").unwrap()
}

fn kayit(id: &str, zaman: Option<Value>, ek: Value) -> AjandaKaydi {
    let mut v = json!({
        "kayit_id": id, "revizyon": 1, "tur": "randevu", "baslik": format!("Kayıt {id}"), "ornekler": [],
        "durum": "acik", "taslak": false, "silindi": false, "elle_alanlar": [],
        "kaynak": {"yol": "sohbet_araci", "tur_kokeni": "insan", "sohbet_id": "ana"},
        "olusturma_ms": 1_795_000_000_000i64, "guncelleme_ms": 1_795_000_000_000i64,
        "hatirlatmalar": []
    });
    if let Some(z) = zaman {
        v["zaman"] = z;
    }
    for (k, d) in ek.as_object().unwrap() {
        v[k] = d.clone();
    }
    AjandaKaydi::oku(&v, "").unwrap_or_else(|h| panic!("{} {}", h.yol, h.neden))
}

fn an(tarih: &str, saat: &str) -> Value {
    json!({"kesinlik": "an", "tarih": tarih, "saat": saat, "saat_dilimi": IST})
}
fn an_dilimli(tarih: &str, saat: &str, dilim: &str) -> Value {
    json!({"kesinlik": "an", "tarih": tarih, "saat": saat, "saat_dilimi": dilim})
}
fn sureli(tarih: &str, saat: &str, dk: i32, dilim: &str) -> Value {
    json!({"kesinlik": "an", "tarih": tarih, "saat": saat, "sure_dk": dk, "saat_dilimi": dilim})
}
fn gunluk(tarih: &str) -> Value {
    json!({"kesinlik": "gun", "tarih": tarih, "saat_dilimi": IST})
}
fn bolumlu(tarih: &str, bolum: &str) -> Value {
    json!({"kesinlik": "gun", "tarih": tarih, "gun_bolumu": bolum, "saat_dilimi": IST})
}
fn donem(a: &str, b: &str) -> Value {
    json!({"kesinlik": "donem", "baslangic": a, "bitis": b, "saat_dilimi": IST})
}

fn yaz(d: &Depo, k: &AjandaKaydi) {
    d.gorunen_yaz(k, false).unwrap();
}

/// Sabit ofsetliler + `Test/Yaz`: +60; 2027-03-28 01:00Z'de +120 (yerel 02:00 -> 03:00, boşluk),
/// 2027-10-31 01:00Z'de +60 (yerel 03:00 -> 02:00, çakışma). java.time `ZonedDateTime.of` kuralı:
/// boşlukta boşluk kadar ileri (önceki ofsetle), çakışmada önceki (yaz) ofset.
struct Cevirici(SabitOfsetCevirici);

fn cevirici() -> Cevirici {
    Cevirici(SabitOfsetCevirici::yeni([("UTC", 0), (IST, 180), ("America/New_York", -300)]))
}

fn yaz_ofseti(ms: i64) -> i64 {
    let ilkbahar = (gun_no(2027, 3, 28) * 1440 + 60) * DK_MS;
    let sonbahar = (gun_no(2027, 10, 31) * 1440 + 60) * DK_MS;
    if (ilkbahar..sonbahar).contains(&ms) { 120 } else { 60 }
}

impl AnCevirici for Cevirici {
    fn ana_cevir(&self, tarih: &str, saat: &str, dilim: &str) -> Result<i64, ZamanHatasi> {
        if dilim != YAZ {
            return self.0.ana_cevir(tarih, saat, dilim);
        }
        let yerel = (tarih_gun_no(tarih).unwrap() * 1440 + dakika_no(saat)) * DK_MS;
        let gecerli = [120, 60].into_iter().map(|o| (o, yerel - o * DK_MS)).find(|(o, ms)| yaz_ofseti(*ms) == *o);
        Ok(gecerli.map_or(yerel - 60 * DK_MS, |(_, ms)| ms))
    }
    fn yerele_cevir(&self, an_ms: i64, dilim: &str) -> Result<YerelAn, ZamanHatasi> {
        if dilim != YAZ {
            return self.0.yerele_cevir(an_ms, dilim);
        }
        let dk = an_ms.div_euclid(DK_MS) + yaz_ofseti(an_ms);
        Ok(YerelAn {
            tarih: gun_no_tarih(dk.div_euclid(1440)),
            saat: saat_metni(dk.rem_euclid(1440)),
            saat_dilimi: dilim.into(),
        })
    }
}

fn ayi(d: &Depo, cihaz: &str, yil: i32, ay: i32, kapalilar: bool) -> TakvimAyi {
    takvim_ayi(d, &cevirici(), cihaz, yil, ay, kapalilar).unwrap()
}
fn gunu(d: &Depo, cihaz: &str, tarih: &str, kapalilar: bool) -> Vec<TakvimOgesi> {
    takvim_gunu(d, &cevirici(), cihaz, tarih, kapalilar).unwrap()
}
fn kimlikler(l: &[TakvimOgesi]) -> Vec<String> {
    l.iter()
        .map(|o| match &o.ornek_tarihi {
            Some(t) => format!("{}@{t}", o.gorunum.kayit.kayit_id),
            None => o.gorunum.kayit.kayit_id.clone(),
        })
        .collect()
}
/// Ayın günlerinin `toplam`'ı (1. gün başta).
fn toplamlar(a: &TakvimAyi) -> Vec<i32> {
    a.gunler.iter().map(|g| g.toplam).collect()
}
fn ozet<'a>(a: &'a TakvimAyi, tarih: &str) -> &'a TakvimGunOzeti {
    a.gunler.iter().find(|g| g.tarih == tarih).unwrap()
}
/// Özet ile gün listesi aynı süzgeçtir: her günün `toplam`'ı `takvim_gunu`'nun uzunluğu.
fn tutarli(d: &Depo, cihaz: &str, a: &TakvimAyi, kapalilar: bool) {
    for g in &a.gunler {
        assert_eq!(g.toplam as usize, gunu(d, cihaz, &g.tarih, kapalilar).len(), "{}", g.tarih);
        assert_eq!(g.toplam, g.acik + g.kapali);
        assert_eq!(g.toplam, g.gorev + g.randevu + g.notlar);
    }
}

#[test]
fn bos_ay_butun_gunleri_sifirla_doner_ay_uzunluklari_dogru() {
    let d = depo();
    for (yil, ay, gun_sayisi) in [(2026, 12, 31), (2027, 2, 28), (2028, 2, 29), (2100, 2, 28), (2000, 2, 29), (2027, 4, 30)] {
        let a = ayi(&d, IST, yil, ay, true);
        assert_eq!((a.yil, a.ay), (yil, ay));
        assert_eq!(a.gunler.len(), gun_sayisi, "{yil}-{ay}");
        assert_eq!(a.gunler[0].tarih, format!("{yil:04}-{ay:02}-01"));
        assert_eq!(a.gunler.last().unwrap().tarih, format!("{yil:04}-{ay:02}-{gun_sayisi:02}"));
        assert!(a.gunler.iter().all(|g| *g == TakvimGunOzeti { tarih: g.tarih.clone(), ..Default::default() }));
        assert!(a.seritler.is_empty());
    }
    assert!(gunu(&d, IST, "2028-02-29", true).is_empty());
}

#[test]
fn gecersiz_girdi_alanini_soyler() {
    let d = depo();
    let c = cevirici();
    let alan = |r: Result<TakvimAyi, CekirdekHatasi>| match r {
        Err(CekirdekHatasi::GecersizGirdi { alan, .. }) => alan,
        s => panic!("{s:?}"),
    };
    assert_eq!(alan(takvim_ayi(&d, &c, IST, 2026, 0, false)), "ay");
    assert_eq!(alan(takvim_ayi(&d, &c, IST, 2026, 13, false)), "ay");
    assert_eq!(alan(takvim_ayi(&d, &c, IST, 1899, 12, false)), "yil");
    assert_eq!(alan(takvim_ayi(&d, &c, IST, 2200, 1, false)), "yil");
    for t in ["2027-02-29", "2026-13-01", "26-12-01", ""] {
        assert!(matches!(takvim_gunu(&d, &c, IST, t, false), Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "tarih"));
    }
    // Sınırdaki aylar çalışır.
    assert_eq!(ayi(&d, IST, 1900, 1, false).gunler.len(), 31);
    assert_eq!(ayi(&d, IST, 2199, 12, false).gunler.len(), 31);
}

#[test]
fn gun_ici_sira_bolumsuz_saatsiz_sonra_bolum_sirasi_sonra_saat() {
    let d = depo();
    let t = "2026-12-10";
    // Oluşturma sırası sıranın ters yönünde: sonuç ondan değil kuraldan gelir.
    let kayitlar = [
        ("k_saat1830", an(t, "18:30")),
        ("k_saat0730", an(t, "07:30")),
        ("k_gece", bolumlu(t, "gece")),
        ("k_aksam", bolumlu(t, "aksam")),
        ("k_sabah", bolumlu(t, "sabah")),
        ("k_ogleden", bolumlu(t, "ogleden_sonra")),
        ("k_bolumsuz", gunluk(t)),
        ("k_donem", donem("2026-12-08", "2026-12-12")),
        ("k_saat1930", an(t, "19:30")),
        ("k_saat0900", an(t, "09:00")),
    ];
    for (i, (id, z)) in kayitlar.iter().enumerate() {
        yaz(&d, &kayit(id, Some(z.clone()), json!({"olusturma_ms": 1_795_000_000_000i64 - i as i64})));
    }
    // Aynı saatte iki kayıt: oluşturma, sonra kimlik.
    yaz(&d, &kayit("k_saat0900b", Some(an(t, "09:00")), json!({"olusturma_ms": 1_700_000_000_000i64})));
    let l = gunu(&d, IST, t, false);
    assert_eq!(
        kimlikler(&l),
        [
            "k_donem", "k_bolumsuz", "k_sabah", "k_ogleden", "k_aksam", "k_gece", "k_saat0730", "k_saat0900b", "k_saat0900",
            "k_saat1830", "k_saat1930",
        ]
    );
    // Saatten bölüm türetilmez: 19:30 saatlidir, akşam bölümünde değil.
    let o = l.iter().find(|o| o.gorunum.kayit.kayit_id == "k_saat1930").unwrap();
    assert_eq!((o.saat.as_deref(), o.bitis_saati.as_deref()), (Some("19:30"), None));
    assert!(l.iter().filter(|o| o.saat.is_none()).all(|o| o.gorunum.kayit.zaman.as_ref().unwrap().kesinlik() != crate::model::ZamanKesinligi::An));
    let k = l.iter().find(|o| o.gorunum.kayit.kayit_id == "k_donem").unwrap();
    assert_eq!((k.ilk_gun.as_str(), k.son_gun.as_str()), ("2026-12-08", "2026-12-12"));
}

#[test]
fn gece_yarisini_asan_kayit_iki_gunde_ve_ay_yil_sinirinda() {
    let d = depo();
    yaz(&d, &kayit("k_gece", Some(sureli("2026-11-30", "23:00", 120, IST)), json!({})));
    yaz(&d, &kayit("k_yilbasi", Some(sureli("2026-12-31", "23:30", 60, IST)), json!({})));
    yaz(&d, &kayit("k_tam", Some(sureli("2026-12-15", "23:00", 60, IST)), json!({})));
    yaz(&d, &kayit("k_erken", Some(an("2026-12-01", "00:30")), json!({})));
    yaz(&d, &kayit("k_hafta", Some(sureli("2026-12-20", "10:00", 10_080, IST)), json!({})));

    let kasim = ayi(&d, IST, 2026, 11, false);
    assert_eq!(ozet(&kasim, "2026-11-30").toplam, 1);
    assert_eq!(ozet(&kasim, "2026-11-30").serit, 1);
    assert_eq!(kasim.seritler.len(), 1);
    assert_eq!((kasim.seritler[0].ilk_gun.as_str(), kasim.seritler[0].son_gun.as_str()), ("2026-11-30", "2026-12-01"));

    let aralik = ayi(&d, IST, 2026, 12, false);
    tutarli(&d, IST, &aralik, false);
    assert_eq!(ozet(&aralik, "2026-12-01").toplam, 2);
    // Tam gece yarısında biten ertesi günü kaplamaz.
    assert_eq!((ozet(&aralik, "2026-12-15").toplam, ozet(&aralik, "2026-12-16").toplam), (1, 0));
    // Bir hafta süren: 20'den 27'sine (27 10:00'da biter).
    assert!((20..=27).all(|g| ozet(&aralik, &format!("2026-12-{g:02}")).serit == 1));
    assert_eq!(ozet(&aralik, "2026-12-28").toplam, 0);
    let seritler: Vec<(&str, &str, &str)> =
        aralik.seritler.iter().map(|s| (s.kayit_id.as_str(), s.ilk_gun.as_str(), s.son_gun.as_str())).collect();
    assert_eq!(
        seritler,
        [("k_gece", "2026-11-30", "2026-12-01"), ("k_hafta", "2026-12-20", "2026-12-27"), ("k_yilbasi", "2026-12-31", "2027-01-01")]
    );

    // Süren öğe saatlilerin başında; ilk gün ve saatler taşınır.
    let l = gunu(&d, IST, "2026-12-01", false);
    assert_eq!(kimlikler(&l), ["k_gece", "k_erken"]);
    assert_eq!((l[0].ilk_gun.as_str(), l[0].son_gun.as_str()), ("2026-11-30", "2026-12-01"));
    assert_eq!((l[0].saat.as_deref(), l[0].bitis_saati.as_deref()), (Some("23:00"), Some("01:00")));
    let tam = &gunu(&d, IST, "2026-12-15", false)[0];
    assert_eq!((tam.son_gun.as_str(), tam.bitis_saati.as_deref()), ("2026-12-15", Some("00:00")));

    // Yıl sınırı: ocakta görünür.
    let ocak = ayi(&d, IST, 2027, 1, false);
    assert_eq!(ozet(&ocak, "2027-01-01").toplam, 1);
    assert_eq!(ocak.seritler.len(), 1);
    assert_eq!(gunu(&d, IST, "2027-01-01", false)[0].bitis_saati.as_deref(), Some("00:30"));
}

#[test]
fn saatli_kayit_cihaz_dilimine_cevrilir_saatsiz_cevrilmez() {
    let d = depo();
    // İstanbul 01:30 = UTC önceki gün 22:30.
    yaz(&d, &kayit("k_ist", Some(an("2026-12-01", "01:30")), json!({})));
    yaz(&d, &kayit("k_gun", Some(gunluk("2026-12-01")), json!({})));
    // Bilinmeyen dilim: duvar saati cihazın saati (Kotlin `dilimVeya`).
    yaz(&d, &kayit("k_bilinmez", Some(an_dilimli("2026-12-01", "08:00", "Asia/Bilinmez")), json!({})));

    let utc = gunu(&d, "UTC", "2026-11-30", false);
    assert_eq!(kimlikler(&utc), ["k_ist"]);
    assert_eq!((utc[0].saat.as_deref(), utc[0].ilk_gun.as_str()), (Some("22:30"), "2026-11-30"));
    assert_eq!(kimlikler(&gunu(&d, "UTC", "2026-12-01", false)), ["k_gun", "k_bilinmez"]);
    assert_eq!(gunu(&d, "UTC", "2026-12-01", false)[1].saat.as_deref(), Some("08:00"));
    let kasim = ayi(&d, "UTC", 2026, 11, false);
    assert_eq!(ozet(&kasim, "2026-11-30").toplam, 1);

    let ist = gunu(&d, IST, "2026-12-01", false);
    assert_eq!(kimlikler(&ist), ["k_gun", "k_ist", "k_bilinmez"]);
    assert!(gunu(&d, IST, "2026-11-30", false).is_empty());
    // New York'ta (−5) bir gün geri, aynı ayda.
    assert_eq!(gunu(&d, "America/New_York", "2026-11-30", false)[0].saat.as_deref(), Some("17:30"));
}

#[test]
fn yaz_saati_gecisi_olan_gunler() {
    let d = depo();
    let t = "2027-03-28";
    yaz(&d, &kayit("k_0130", Some(an_dilimli(t, "01:30", YAZ)), json!({})));
    // Boşlukta: 02:30 yok, java.time 03:30'a iter.
    yaz(&d, &kayit("k_0230", Some(an_dilimli(t, "02:30", YAZ)), json!({})));
    yaz(&d, &kayit("k_0300", Some(an_dilimli(t, "03:00", YAZ)), json!({})));
    yaz(&d, &kayit("k_2330", Some(an_dilimli(t, "23:30", YAZ)), json!({})));
    // Geçiş gecesini aşan: 27 23:00 + 3 saat (gerçek süre) = 28 03:00 (yaz saati).
    yaz(&d, &kayit("k_gecis", Some(sureli("2027-03-27", "23:00", 180, YAZ)), json!({})));
    // Her gün 02:30 (saatli seri): 28'inde 03:30.
    yaz(&d, &kayit("k_seri", Some(an_dilimli("2027-03-01", "02:30", YAZ)), json!({"tekrar": {"siklik": "gunluk", "aralik": 1}})));

    let l = gunu(&d, YAZ, t, false);
    assert_eq!(kimlikler(&l), ["k_gecis", "k_0130", "k_0300", "k_0230", "k_seri@2027-03-28", "k_2330"]);
    let saatler: Vec<Option<&str>> = l.iter().map(|o| o.saat.as_deref()).collect();
    assert_eq!(saatler, [Some("23:00"), Some("01:30"), Some("03:00"), Some("03:30"), Some("03:30"), Some("23:30")]);
    assert_eq!((l[0].ilk_gun.as_str(), l[0].bitis_saati.as_deref()), ("2027-03-27", Some("03:00")));

    let mart = ayi(&d, YAZ, 2027, 3, false);
    tutarli(&d, YAZ, &mart, false);
    assert_eq!(ozet(&mart, t).toplam, 6);
    assert_eq!(ozet(&mart, "2027-03-27").toplam, 2, "seri + gecis");
    assert!(mart.gunler.iter().all(|g| g.toplam >= 1), "seri her gün bir kez");
    assert_eq!(ozet(&mart, "2027-03-29").toplam, 1);

    // Sonbahar çakışması: 02:30 iki kez var, önceki (yaz) ofseti; 30 23:00 + 4 saat = 31 02:00 (kış).
    yaz(&d, &kayit("k_cakisma", Some(an_dilimli("2027-10-31", "02:30", YAZ)), json!({})));
    yaz(&d, &kayit("k_uzun", Some(sureli("2027-10-30", "23:00", 240, YAZ)), json!({})));
    let ekim = gunu(&d, YAZ, "2027-10-31", false);
    let ekim: Vec<(String, Option<&str>, Option<&str>)> =
        ekim.iter().map(|o| (o.gorunum.kayit.kayit_id.clone(), o.saat.as_deref(), o.bitis_saati.as_deref())).collect();
    assert_eq!(
        ekim,
        [
            ("k_uzun".to_string(), Some("23:00"), Some("02:00")),
            ("k_cakisma".to_string(), Some("02:30"), None),
            ("k_seri".to_string(), Some("02:30"), None),
        ]
    );
}

#[test]
fn artik_yil_ve_ayda_olmayan_gun() {
    let d = depo();
    yaz(&d, &kayit("k_29", Some(gunluk("2024-02-29")), json!({"tekrar": {"siklik": "yillik", "aralik": 1}})));
    yaz(&d, &kayit("k_31", Some(gunluk("2027-01-31")), json!({"tekrar": {"siklik": "aylik", "aralik": 1}})));
    assert_eq!(ozet(&ayi(&d, IST, 2028, 2, false), "2028-02-29").toplam, 1);
    let subat27 = ayi(&d, IST, 2027, 2, false);
    assert!(toplamlar(&subat27).iter().all(|t| *t == 0), "ne 29 şubat ne 31: {:?}", toplamlar(&subat27));
    assert!(gunu(&d, IST, "2027-03-01", false).is_empty());
    let mart = ayi(&d, IST, 2027, 3, false);
    assert_eq!(toplamlar(&mart).iter().sum::<i32>(), 1);
    assert_eq!(ozet(&mart, "2027-03-31").toplam, 1);
    assert!(toplamlar(&ayi(&d, IST, 2027, 4, false)).iter().all(|t| *t == 0));
    let l = gunu(&d, IST, "2028-02-29", false);
    assert_eq!(l[0].ornek_tarihi.as_deref(), Some("2028-02-29"));
}

#[test]
fn tekrar_ornekleri_ve_ornek_durumlari() {
    let d = depo();
    yaz(
        &d,
        &kayit(
            "k_her_gun",
            Some(gunluk("2026-12-01")),
            json!({"tur": "gorev", "tekrar": {"siklik": "gunluk", "aralik": 1},
                   "ornekler": [{"tarih": "2026-12-03", "durum": "tamam"}, {"tarih": "2026-12-05", "durum": "iptal"}]}),
        ),
    );
    yaz(&d, &kayit("k_uc_kez", Some(an("2026-12-10", "10:00")), json!({"tekrar": {"siklik": "gunluk", "aralik": 2, "adet": 3}})));
    yaz(&d, &kayit("k_pzt_cum", Some(an("2026-11-02", "09:00")), json!({"tekrar": {"siklik": "haftalik", "aralik": 1, "gunler": ["pzt", "cum"]}})));
    // Çapası çok eskide, sonsuz; bitişli seri pencereden önce biter.
    yaz(&d, &kayit("k_eski", Some(gunluk("2019-12-25")), json!({"tekrar": {"siklik": "yillik", "aralik": 1}})));
    yaz(&d, &kayit("k_bitti", Some(gunluk("2026-11-01")), json!({"tekrar": {"siklik": "gunluk", "aralik": 1, "bitis_tarihi": "2026-11-30"}})));

    let a = ayi(&d, IST, 2026, 12, false);
    tutarli(&d, IST, &a, false);
    let her_gun = |g: u32| if g == 3 || g == 5 { 0 } else { 1 };
    let uc_kez = |g: u32| u32::from(matches!(g, 10 | 12 | 14));
    // 2026-12: pazartesiler 7, 14, 21, 28; cumalar 4, 11, 18, 25.
    let pzt_cum = |g: u32| u32::from(matches!(g, 4 | 7 | 11 | 14 | 18 | 21 | 25 | 28));
    let eski = |g: u32| u32::from(g == 25);
    let beklenen: Vec<i32> = (1..=31).map(|g| (her_gun(g) + uc_kez(g) + pzt_cum(g) + eski(g)) as i32).collect();
    assert_eq!(toplamlar(&a), beklenen);

    // Kapalılar dahil: örneklerin kendi durumu.
    let a = ayi(&d, IST, 2026, 12, true);
    tutarli(&d, IST, &a, true);
    assert_eq!((ozet(&a, "2026-12-03").kapali, ozet(&a, "2026-12-05").kapali, ozet(&a, "2026-12-04").kapali), (1, 1, 0));
    let l = gunu(&d, IST, "2026-12-03", true);
    let o = l.iter().find(|o| o.gorunum.kayit.kayit_id == "k_her_gun").unwrap();
    assert_eq!((o.ornek_tarihi.as_deref(), o.durum), (Some("2026-12-03"), KayitDurumu::Tamam));
    assert_eq!(o.gorunum.kayit.durum, KayitDurumu::Acik, "seri açık");
    let o = &gunu(&d, IST, "2026-12-05", true).into_iter().find(|o| o.gorunum.kayit.kayit_id == "k_her_gun").unwrap();
    assert_eq!(o.durum, KayitDurumu::Iptal);
    assert!(gunu(&d, IST, "2026-11-30", false).iter().any(|o| o.ornek_tarihi.as_deref() == Some("2026-11-30")), "bitişli seri son günü");

    // Seri kapalıysa (`tamam`) bütün örnekleri kapalıdır.
    yaz(&d, &kayit("k_kapali_seri", Some(gunluk("2026-12-01")), json!({"durum": "tamam", "tekrar": {"siklik": "gunluk", "aralik": 1}})));
    assert_eq!(toplamlar(&ayi(&d, IST, 2026, 12, false)), beklenen);
    let a = ayi(&d, IST, 2026, 12, true);
    assert!(a.gunler.iter().all(|g| g.kapali >= 1));
}

#[test]
fn saatli_seri_ornegi_dilimle_onceki_gune_kayar() {
    let d = depo();
    // İstanbul her gün 01:00 = UTC önceki gün 22:00. Örneğin günü (ornek_tarihi) kaydın takvimindedir.
    yaz(&d, &kayit("k_seri", Some(an("2026-12-01", "01:00")), json!({"tekrar": {"siklik": "gunluk", "aralik": 1}})));
    let l = gunu(&d, "UTC", "2026-12-01", false);
    assert_eq!(kimlikler(&l), ["k_seri@2026-12-02"]);
    assert_eq!((l[0].saat.as_deref(), l[0].ilk_gun.as_str()), (Some("22:00"), "2026-12-01"));
    let kasim = ayi(&d, "UTC", 2026, 11, false);
    assert_eq!(ozet(&kasim, "2026-11-30").toplam, 1, "çapa günü (12-01 İstanbul) UTC'de 30 kasım");
    assert_eq!(toplamlar(&kasim).iter().sum::<i32>(), 1);
    let aralik = ayi(&d, "UTC", 2026, 12, false);
    assert!(toplamlar(&aralik).iter().all(|t| *t == 1));
    tutarli(&d, "UTC", &aralik, false);
}

#[test]
fn gorunurluk_tamam_iptal_taslak_silinmis() {
    let d = depo();
    let t = "2026-12-10";
    yaz(&d, &kayit("k_acik", Some(an(t, "10:00")), json!({})));
    yaz(&d, &kayit("k_tamam", Some(an(t, "11:00")), json!({"durum": "tamam", "tur": "gorev"})));
    yaz(&d, &kayit("k_iptal", Some(gunluk(t)), json!({"durum": "iptal"})));
    yaz(&d, &kayit("k_taslak", Some(an(t, "12:00")), json!({"taslak": true, "tur": "not",
        "kaynak": {"yol": "sohbet_araci", "tur_kokeni": "sentetik", "sohbet_id": "ana"}})));
    yaz(&d, &kayit("k_silindi", Some(an(t, "13:00")), json!({"silindi": true})));
    yaz(&d, &kayit("k_silindi_tamam", Some(an(t, "14:00")), json!({"silindi": true, "durum": "tamam"})));
    yaz(&d, &kayit("k_belirsiz", Some(json!({"kesinlik": "belirsiz", "ifade": "bir ara"})), json!({})));
    yaz(&d, &kayit("k_zamansiz", None, json!({})));

    assert_eq!(kimlikler(&gunu(&d, IST, t, false)), ["k_acik", "k_taslak"]);
    let l = gunu(&d, IST, t, true);
    assert_eq!(kimlikler(&l), ["k_iptal", "k_acik", "k_tamam", "k_taslak"]);
    assert!(l[3].gorunum.kayit.taslak);
    let durumlar: Vec<KayitDurumu> = l.iter().map(|o| o.durum).collect();
    assert_eq!(durumlar, [KayitDurumu::Iptal, KayitDurumu::Acik, KayitDurumu::Tamam, KayitDurumu::Acik]);

    let a = ayi(&d, IST, 2026, 12, false);
    assert_eq!(
        *ozet(&a, t),
        TakvimGunOzeti { tarih: t.into(), toplam: 2, acik: 2, taslak: 1, randevu: 1, notlar: 1, ..Default::default() }
    );
    let a = ayi(&d, IST, 2026, 12, true);
    assert_eq!(
        *ozet(&a, t),
        TakvimGunOzeti { tarih: t.into(), toplam: 4, acik: 2, kapali: 2, taslak: 1, gorev: 1, randevu: 2, notlar: 1, serit: 0 }
    );
    assert_eq!(toplamlar(&a).iter().sum::<i32>(), 4, "belirsiz, zamansız ve silinmiş hiçbir günde yok");
    tutarli(&d, IST, &a, true);
}

#[test]
fn donem_ay_sinirini_asar_ve_uzun_donem_pencereye_onceden_girer() {
    let d = depo();
    yaz(&d, &kayit("k_tatil", Some(donem("2026-11-25", "2026-12-05")), json!({})));
    yaz(&d, &kayit("k_uzun", Some(donem("2025-12-10", "2026-12-03")), json!({})));
    yaz(&d, &kayit("k_gecmis", Some(donem("2026-11-01", "2026-11-20")), json!({})));
    yaz(&d, &kayit("k_tek_gun", Some(donem("2026-12-09", "2026-12-09")), json!({})));

    let a = ayi(&d, IST, 2026, 12, false);
    tutarli(&d, IST, &a, false);
    let beklenen: Vec<i32> = (1..=31).map(|g| i32::from(g <= 5) + i32::from(g <= 3) + i32::from(g == 9)).collect();
    assert_eq!(toplamlar(&a), beklenen);
    let seritler: Vec<(&str, &str, &str)> =
        a.seritler.iter().map(|s| (s.kayit_id.as_str(), s.ilk_gun.as_str(), s.son_gun.as_str())).collect();
    // Tek günlük dönem şerit değildir; ilk gün artan.
    assert_eq!(seritler, [("k_uzun", "2025-12-10", "2026-12-03"), ("k_tatil", "2026-11-25", "2026-12-05")]);
    assert_eq!(ozet(&a, "2026-12-09").serit, 0);

    let k = ayi(&d, IST, 2026, 11, false);
    assert_eq!(ozet(&k, "2026-11-25").toplam, 2, "tatil + uzun; geçmiş dönem 20'sinde bitti");
    assert_eq!(ozet(&k, "2026-11-21").toplam, 1);
    assert_eq!(ayi(&d, IST, 2025, 12, false).gunler[9].toplam, 1, "uzun dönemin ilk ayı");
}

#[test]
fn cok_kayitli_gun_saat_sirasiyla() {
    let d = depo();
    let t = "2026-12-10";
    for i in 0..600i64 {
        let saat = format!("{:02}:{:02}", (i * 7) % 24, (i * 13) % 60);
        let tur = ["gorev", "randevu", "not"][(i % 3) as usize];
        yaz(&d, &kayit(&format!("k_{i:04}"), Some(an(t, &saat)), json!({"tur": tur})));
    }
    let l = gunu(&d, IST, t, false);
    assert_eq!(l.len(), 600);
    assert!(l.windows(2).all(|w| w[0].saat <= w[1].saat), "saat sırası");
    let o = ozet(&ayi(&d, IST, 2026, 12, false), t).clone();
    assert_eq!((o.toplam, o.gorev, o.randevu, o.notlar), (600, 200, 200, 200));
    assert_eq!(ozet(&ayi(&d, IST, 2026, 12, false), "2026-12-11").toplam, 0);
}
