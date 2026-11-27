//! Sürüm uyumu (D5) ve sürüm 3 modelinin kenar durumları (vektörlerin dışında kalanlar): her sürüm kendi
//! içinde katıdır, eski sürüme yazarken yeni alanlar düşer, bugünkü kanalın sarmalayıcıları v2'dedir,
//! v3 alan kuralları birleştirme sonucunda da (yerel yazar ve iyimser uygulama bunu kullanır) geçerlidir.

use ajanda_cekirdek::kural::birlesim::ajanda_degisikligi_uygula;
use ajanda_cekirdek::kural::tekil::ajanda_tekil_anahtari;
use ajanda_cekirdek::model::{
    self, AjandaAlani, AjandaAsagi, AjandaBolgeKonumu, AjandaDegisiklik, AjandaEslestirmeQr, AjandaGecmisGirdisi,
    AjandaIslem, AjandaKaydi, AjandaVaris, AjandaYukari, Alan, AlanDegisikligi, CozumKodu, GeriDusus, KayitTuru,
    KaynakYolu, Surum, TurKokeni, V3Alanlari, YazarKimligi,
};
use serde_json::{Value, json};

fn kayit_json(ek: Value) -> Value {
    let mut k = json!({
        "kayit_id": "k1", "revizyon": 1, "tur": "gorev", "baslik": "Süt al", "hatirlatmalar": [], "ornekler": [],
        "durum": "acik", "taslak": false, "silindi": false, "elle_alanlar": [],
        "kaynak": {"yol": "elle", "tur_kokeni": "insan", "device_id": "cihaz1"},
        "olusturma_ms": 1, "guncelleme_ms": 1
    });
    for (a, d) in ek.as_object().unwrap() {
        k[a] = d.clone();
    }
    k
}

const KONUM: AjandaBolgeKonumu = AjandaBolgeKonumu { enlem_e6: 41_008_240, boylam_e6: 28_978_359, yaricap_m: 150 };

fn konum_json() -> Value {
    json!({"enlem_e6": 41_008_240, "boylam_e6": 28_978_359, "yaricap_m": 150})
}

fn elle() -> YazarKimligi {
    YazarKimligi { yol: KaynakYolu::Elle, tur_kokeni: TurKokeni::Insan }
}

#[test]
fn kayit_her_surumde_kati_v2_yazimi_v3_alanlarini_duser() {
    let v = kayit_json(json!({"bolge": "Market", "bolge_konumu": konum_json(), "simge": "market", "elle_alanlar": ["baslik", "bolge"]}));
    // v2 okuyucu v3 alanını ve v3 alan adını reddeder; v3 ve sürümsüz (en yeni) okuyucu kabul eder.
    let h = AjandaKaydi::oku_surum(&v, "", Surum::V2).unwrap_err();
    assert_eq!(h.neden, "kapalı listede yok", "önce elle_alanlar'daki v3 adı: {h:?}");
    let yalniz_alan = kayit_json(json!({"bolge": "Market"}));
    assert_eq!(AjandaKaydi::oku_surum(&yalniz_alan, "", Surum::V2).unwrap_err().neden, "bilinmeyen alan");
    let k = AjandaKaydi::oku_surum(&v, "", Surum::V3).unwrap();
    assert_eq!(k, AjandaKaydi::oku(&v, "").unwrap());
    assert_eq!(k.v3.bolge.as_deref(), Some("Market"));
    assert_eq!(k.v3.bolge_konumu, Some(KONUM));
    assert_eq!(k.json_surum(Surum::V3), v, "v3 gidip gelir");
    // v2 yazımı: v3 alanları yok, elle_alanlar süzülür; sonuç v2 şemasından geçer.
    let v2 = k.json_surum(Surum::V2);
    for a in ["bolge", "bolge_konumu", "simge"] {
        assert!(v2.get(a).is_none(), "{a}");
    }
    assert_eq!(v2["elle_alanlar"], json!(["baslik"]));
    let geri = AjandaKaydi::oku_surum(&v2, "", Surum::V2).unwrap();
    assert!(geri.v3.bos_mu());
}

#[test]
fn bos_liste_ve_v3_kurali_kayitta() {
    // Modelde boş liste alan yokluğudur; kabloda boş dizi geçersizdir.
    assert!(AjandaKaydi::oku(&kayit_json(json!({"baglantilar": []})), "").is_err());
    assert!(AjandaKaydi::oku(&kayit_json(json!({"ekler": []})), "").is_err());
    let k = AjandaKaydi::oku(&kayit_json(json!({})), "").unwrap();
    assert!(k.json().get("baglantilar").is_none() && k.json().get("ekler").is_none());
    // Konum ve varış bölgesiz olamaz (`v3AlanKurallari`), bölgeyle olur.
    let h = AjandaKaydi::oku(&kayit_json(json!({"varis": {}})), "").unwrap_err();
    assert_eq!((h.yol.as_str(), h.neden), ("varis", "varis bolge ister"));
    assert!(AjandaKaydi::oku(&kayit_json(json!({"bolge": "Ev", "varis": {}, "bolge_konumu": konum_json()})), "").is_ok());
}

#[test]
fn ekle_ve_degisiklik_surume_gore() {
    let ekle = json!({"islem": "ekle", "kayit_id": "k2", "tur": "gorev", "baslik": "x", "hatirlatmalar": [], "girdi_yolu": "elle", "bolge": "Ev", "simge": "ev"});
    assert!(AjandaIslem::oku_surum(&ekle, "", Surum::V2).is_err(), "v2 ekle v3 alanı taşıyamaz");
    let AjandaIslem::Ekle { v3, .. } = AjandaIslem::oku_surum(&ekle, "", Surum::V3).unwrap() else { panic!("ekle") };
    assert_eq!((v3.bolge.as_deref(), v3.simge.as_deref()), (Some("Ev"), Some("ev")));
    let mut konumlu = ekle.clone();
    konumlu.as_object_mut().unwrap().remove("bolge");
    konumlu["bolge_konumu"] = konum_json();
    let h = AjandaIslem::oku_surum(&konumlu, "islem", Surum::V3).unwrap_err();
    assert_eq!((h.yol.as_str(), h.neden), ("islem.bolge_konumu", "bolge_konumu bolge ister"));
    // Yalnız v3 alanı taşıyan değişiklik: v2'de bilinmeyen alan, v3'te geçerli; v2 yazımı boş kalır.
    let d = json!({"bolge": null});
    assert!(AjandaDegisiklik::oku_surum(&d, "", Surum::V2).is_err());
    let d = AjandaDegisiklik::oku_surum(&d, "", Surum::V3).unwrap();
    assert_eq!(d.v3.bolge, Alan::Kaldir);
    assert!(!d.bos_mu());
    assert_eq!(d.json_surum(Surum::V2), json!({}));
    assert_eq!(d.json_surum(Surum::V3), json!({"bolge": null}));
}

#[test]
fn gecmis_parcasi_ve_korunan_alanlar_v2ye_suzulur() {
    let g = json!({
        "rev": 5, "ts_ms": 2, "islem": "guncelle", "yazar": {"yol": "sohbet_araci", "tur_kokeni": "sentetik", "sohbet_id": "ana"},
        "korunan_alanlar": ["baslik", "ekler"], "onceki": {"baslik": "A", "ekler": null}, "sonraki": {"baslik": "B", "simge": "ev"}
    });
    assert!(AjandaGecmisGirdisi::oku_surum(&g, "", Surum::V2).is_err());
    let girdi = AjandaGecmisGirdisi::oku_surum(&g, "", Surum::V3).unwrap();
    assert_eq!(girdi.json_surum(Surum::V3), g);
    let v2 = girdi.json_surum(Surum::V2);
    assert_eq!(v2["korunan_alanlar"], json!(["baslik"]));
    assert_eq!((v2["onceki"].clone(), v2["sonraki"].clone()), (json!({"baslik": "A"}), json!({"baslik": "B"})));
    assert!(AjandaGecmisGirdisi::oku_surum(&v2, "", Surum::V2).is_ok());
}

#[test]
fn bugunku_kanal_v2_qr_ayri_surumde() {
    // `sinirlar::AJANDA_SURUMU` geçiş sabitidir: kanalın sürüm yönü karşılaştırması bugünkü gibi 2'ye göre.
    assert_eq!(model::sinirlar::AJANDA_SURUMU, 2);
    assert_eq!(model::AJANDA_SURUMU, 3);
    assert_eq!(model::KANAL_SURUMU, Surum::V2);
    let w = AjandaAsagi::Welcome { depo_id: "d".into(), bas_rev: 0, tam: false, server_time_ms: 1, yetenekler: Some(vec!["ek_yedegi".into()]) };
    let ham = w.kodla();
    assert!(ham.contains("\"v\":2") && !ham.contains("yetenekler"), "{ham}");
    assert!(matches!(model::ajanda_asagi_coz(&ham), Ok(AjandaAsagi::Welcome { yetenekler: None, .. })));
    // QR'ın `v`'si kanal sürümünden bağımsız: 2.
    let qr = AjandaEslestirmeQr { host: "100.64.0.1".into(), port: 8443, kod: "ABC123".into(), server_public_key: "QUJD".into() };
    assert_eq!(qr.json()["v"], json!(model::AJANDA_QR_SURUMU));
    assert_eq!(AjandaEslestirmeQr::oku(&qr.json(), "").unwrap(), qr);
    // Uygulamanın yolladığı işlem v2'de v3 alanı taşımaz.
    let islem = AjandaIslem::Guncelle {
        kayit_id: "k1".into(),
        temel_revizyon: 1,
        degisiklik: AjandaDegisiklik { baslik: Some("y".into()), v3: model::V3Degisikligi { simge: Alan::Deger("ev".into()), ..Default::default() }, ..Default::default() },
    };
    let giden = AjandaYukari::Islem { islem_id: "i1".into(), islem }.kodla();
    assert!(!giden.contains("simge"), "{giden}");
    assert!(model::ajanda_yukari_coz(&giden).is_ok());
}

#[test]
fn geri_dusus_zinciri_kumeden_kisa_biter() {
    // Bugünkü küme [2, 3]: v3 ile açılır, v2 servis `{v:2, protokol_uyumsuz}` der, v2'ye düşülür; v2'de
    // aynı ret bilinmiyor (döngü yok).
    let kume = model::AJANDA_SURUMLERI;
    let ret = model::ajanda_ret_surumu_oku(r#"{"v":2,"type":"error","code":"protokol_uyumsuz"}"#);
    assert_eq!(model::ajanda_geri_dusus(model::AJANDA_SURUMU, ret, &kume), GeriDusus::YenidenDene { surum: 2 });
    assert_eq!(model::ajanda_geri_dusus(2, ret, &kume), GeriDusus::Bilinmiyor);
    // Başka koddaki ret geri düşüş değildir.
    assert_eq!(model::ajanda_ret_surumu_oku(r#"{"v":2,"type":"error","code":"zaman_asimi"}"#), None);
}

#[test]
fn birlesim_varis_bolgeyle_kalkmaz_sonuc_tutarsiz() {
    let k = AjandaKaydi::oku(&kayit_json(json!({"bolge": "Market", "varis": {}})), "").unwrap();
    let d = AlanDegisikligi { v3: model::V3Degisikligi { bolge: Alan::Kaldir, ..Default::default() }, ..Default::default() };
    let r = ajanda_degisikligi_uygula(&k, &d, elle());
    assert_eq!(r.uygulanan, vec![AjandaAlani::Bolge]);
    assert_eq!(r.kayit.v3.varis, Some(AjandaVaris::default()));
    assert!(r.kayit.gecerli_mi().is_err(), "bölgesiz varış tutarsiz_kayit'tır");
    // Aynı değişiklikte varış da kaldırılırsa geçerli.
    let d = AlanDegisikligi { v3: model::V3Degisikligi { bolge: Alan::Kaldir, varis: Alan::Kaldir, ..Default::default() }, ..Default::default() };
    let r = ajanda_degisikligi_uygula(&k, &d, elle());
    assert_eq!(r.uygulanan, vec![AjandaAlani::Bolge, AjandaAlani::Varis]);
    assert_eq!(r.kayit.elle_alanlar, vec![AjandaAlani::Bolge, AjandaAlani::Varis]);
    assert!(r.kayit.gecerli_mi().is_ok());
}

#[test]
fn birlesim_liste_alanlari_bos_liste_yokluktur() {
    let k = AjandaKaydi::oku(&kayit_json(json!({"baglantilar": [{"url": "https://a.example"}]})), "").unwrap();
    let d = AlanDegisikligi { v3: model::V3Degisikligi { baglantilar: Alan::Kaldir, ..Default::default() }, ..Default::default() };
    let r = ajanda_degisikligi_uygula(&k, &d, elle());
    assert_eq!(r.uygulanan, vec![AjandaAlani::Baglantilar]);
    assert!(r.kayit.v3.baglantilar.is_empty());
    assert!(r.kayit.json().get("baglantilar").is_none());
    // Olmayan listeyi kaldırmak aynı değerdir: atlanır.
    let r = ajanda_degisikligi_uygula(&r.kayit, &d, elle());
    assert!(r.uygulanan.is_empty());
}

#[test]
fn tekil_anahtar_bolgesiz_v2_baytlari() {
    let a = ajanda_tekil_anahtari("sohbet:ana", KayitTuru::Gorev, "Süt al", None, None);
    let b = ajanda_tekil_anahtari("sohbet:ana", KayitTuru::Gorev, "Süt al", None, Some("Market"));
    assert_ne!(a, b);
    assert_eq!(b, ajanda_tekil_anahtari("sohbet:ana", KayitTuru::Gorev, "Süt al", None, Some(" MARKET\t")));
}

#[test]
fn ek_parca_sinirlari() {
    use model::sinirlar::ajanda::{EK_BAYT, EK_PARCA};
    let tam = model::kanonik::base64_yaz(&vec![0u8; EK_PARCA as usize]);
    let parca = |ofset: i64, veri: &str| format!(r#"{{"v":3,"type":"ek_parca","ek_id":"e1","ofset":{ofset},"veri":"{veri}"}}"#);
    assert!(model::ajanda_asagi_coz_surum(&parca(0, &tam), Some(Surum::V3)).is_ok(), "tam EK_PARCA bayt");
    assert!(model::ajanda_asagi_coz_surum(&parca(EK_BAYT - EK_PARCA, &tam), Some(Surum::V3)).is_ok(), "ekin sonuna tam oturur");
    let h = model::ajanda_asagi_coz_surum(&parca(EK_BAYT - EK_PARCA + 1, &tam), Some(Surum::V3)).unwrap_err();
    assert_eq!((h.kod, h.yollar), (CozumKodu::GecersizMesaj, vec!["ofset".to_string()]));
    assert!(model::ajanda_yukari_coz_surum(&parca(0, "QQ=="), Some(Surum::V2)).is_err(), "v2'de ek çerçevesi yok");
}

#[test]
fn v3_alanlari_varsayilani_bos() {
    let v = V3Alanlari::default();
    assert!(v.bos_mu() && v.kurallar().is_ok());
}
