//! Sürüm 2'ye yükseltme (sözleşme "Sürüm 2"): telefondaki sürüm 1 yerel veritabanı yeni koda açılınca
//! veri, kuyruk ve eşleşme korunur, alarmlar yeni kurala (saatsiz günün gün hatırlatması) göre yeniden
//! planlanır; eski ya da yeni servisle sürüm uyuşmazlığı temiz bir durumdur, hiçbir şeyi değiştirmez.
//!
//! Fikstür `tests/veri/v1_depo.sql`: sürüm 1 kodunun (AJANDA_SURUMU 1, şema 3) sahte PC ile ürettiği
//! veritabanının dökümü. Beş sunucu kaydı (iki saatli randevu, iki saatsiz gün, bir zamansız görev),
//! kuyrukta bir çevrimdışı saatsiz ekleme, iki kurulu alarm (telefondaki gerçek durumun biçimi). Kişisel
//! veri yoktur.
//!
//! Göç 4 (yerel kip, D1): eşleşmiş kurulum `bagli` sınıflanır ve hiçbir satırı değişmez; eşleşmesiz ve
//! kuyruklu kurulum (`tests/veri/v3_eslesmesiz_kuyruklu.sql`, şema 3 kodunun ürettiği) `yerel` olur, kuyruk
//! yerele toplanır. Zengin fikstür (`tests/veri/v3_eslesmis_zengin.sql`, şema 3 kodunun ürettiği; yalnız
//! `alarm_ufku` satırı el ile): ret satırı, mezar taşı, tekrar ve örnek durumu, onaylanmış, yollanmış ve
//! bekleyen kuyruk satırı, teslim edilmiş alarm. Eşleşmiş haliyle göç 4 yalnız `kip` satırını ekler;
//! `eslesme` satırı silinmiş haliyle hepsini yerele toplar.

mod ortak;

use ajanda_cekirdek::kopru::tipler::{
    BaglantiAsamasi, CalismaKipi, EslesmeDurumu, KurulacakAlarm, ListeSorgusu, Sekme, SurumUyusmazligi, YenidenKurmaNedeni,
};
use ajanda_cekirdek::model::kanonik::base64_yaz;
use ajanda_cekirdek::model::{AjandaKanalHatasi, AjandaKaydi, AjandaZamani};
use ortak::*;
use std::sync::Arc;

const V1_DEPO: &str = include_str!("veri/v1_depo.sql");
/// Fikstürdeki kuyruk satırı (çevrimdışı eklenen "Fatura öde", 27 Kasım saatsiz).
const KUYRUK_ISLEMI: &str = "i_AAECAwQFBgQICQoLDA0ODA";
const KUYRUK_KAYDI: &str = "k_AAECAwQFBgUICQoLDA0ODQ";

/// Telefondaki iki v1 alarmı: Dişçi (26 Kasım 15:00 → 14:00) ve Toplantı (27 Kasım 10:00 → 09:00).
fn v1_alarmlari(h: &Hat) {
    let mut k = h.alarm.kurulu.lock().unwrap();
    for (no, kayit_id, tetik) in [(1, "k_disci", bugun(14, 0) + GUN), (2, "k_toplanti", bugun(9, 0) + 2 * GUN)] {
        k.insert(no, KurulacakAlarm { alarm_no: no, kayit_id: kayit_id.into(), tetik_ms: tetik, ornek_tarihi: None, tur: ajanda_cekirdek::model::KayitTuru::Randevu });
    }
}

/// PC'yi fikstürün sunucu kopyasıyla aynı hale getirir (aynı `depo_id`, revizyonlar, geçmiş izi, cihaz).
fn pc_fikstur_gibi(h: &mut Hat) {
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    let mut s = db.prepare("SELECT json FROM sunucu_kayitlari ORDER BY revizyon").unwrap();
    let kayitlar: Vec<AjandaKaydi> = s
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|j| AjandaKaydi::oku(&serde_json::from_str(&j.unwrap()).unwrap(), "").unwrap())
        .collect();
    for k in kayitlar {
        h.pc.d.rev = h.pc.d.rev.max(k.revizyon);
        h.pc.d.gecmis_izi.insert(k.revizyon, (k.kayit_id.clone(), k.guncelleme_ms));
        h.pc.d.kayitlar.insert(k.kayit_id.clone(), k);
    }
    h.pc.cihaz_public_key = Some(base64_yaz(&[4; 65]));
}

#[test]
fn v1_yerel_veritabani_yeni_kodla_acilir_veri_kuyruk_eslesme_korunur_alarmlar_yeni_kurala_gore_kurulur() {
    let mut h = Hat::sql_depoyla("yukseltme", V1_DEPO);
    v1_alarmlari(&h);

    // Tek göç (4: yerel kip) eşleşmiş kurulumu bağlı bırakır: eşleşme aynı (yeniden eşleştirme gerekmez),
    // kayıtlar ve kuyruk aynı.
    assert_eq!(h.c.sema_surumu().unwrap(), 4);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(
        h.c.eslesme_durumu().unwrap(),
        EslesmeDurumu::Eslesti { device_id: CIHAZ.into(), host: "100.64.0.1".into(), port: 8787 }
    );
    assert!(h.c.baglanti_adresi().unwrap().is_some());
    let tarihli = h.c.liste(ListeSorgusu { sekme: Sekme::Tarihli, kapalilar_dahil: true }).unwrap();
    let tarihsiz = h.c.liste(ListeSorgusu { sekme: Sekme::Tarihsiz, kapalilar_dahil: true }).unwrap();
    assert_eq!(tarihli.len() + tarihsiz.len(), 6);
    let araba = h.c.kayit("k_araba".into()).unwrap().unwrap().kayit;
    assert_eq!(
        araba.zaman,
        Some(AjandaZamani::Gun { tarih: "2026-11-28".into(), gun_bolumu: None, saat_dilimi: IST.into(), ifade: Some("yarın akşama".into()) })
    );
    let fatura = h.c.kayit(KUYRUK_KAYDI.into()).unwrap().unwrap();
    assert!(fatura.bekleyen, "çevrimdışı ekleme hâlâ kuyrukta, iyimser görünür");
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (1, 0));

    // MY_PACKAGE_REPLACED: bütün alarmlar yeni kuralla yeniden kurulur. v1 alarmları aynı numarayla kalır,
    // saatsiz günler o günün 09:00'ını alır (bölüm yok, sözden çıkarılmaz); bugünün 09:00'ı geçti: çalmaz.
    h.c.alarmlari_yeniden_kur(YenidenKurmaNedeni::PaketGuncellendi).unwrap();
    assert_eq!(
        h.alarm.kurulular(),
        vec![
            (KUYRUK_KAYDI.to_string(), bugun(9, 0) + 2 * GUN),
            ("k_araba".to_string(), bugun(9, 0) + 3 * GUN),
            ("k_disci".to_string(), bugun(14, 0) + GUN),
            ("k_toplanti".to_string(), bugun(9, 0) + 2 * GUN),
        ]
    );
    let nolar = h.alarm.kurulu_nolar();
    assert!(nolar.contains(&1) && nolar.contains(&2), "v1 alarmları aynı istek koduyla: {nolar:?}");
    assert!(h.alarm.iptal_edilen.lock().unwrap().is_empty());
    assert!(h.alarm.kacirilan.lock().unwrap().is_empty(), "yükseltme bildirim yağmuru yaratmaz");

    // Aynı eşleşmeyle v3 servisine (küme [2, 3]) v3'te bağlanır, kuyruk aynı islem_id ile gider. Kopya v2
    // bağlantıyla dolmuştu: v3'teki ilk bağlantı bir kez tam telafi ister (v3 alanları değişmemiş kayıtlarda
    // da gelsin); sonraki bağlantı artımlıdır (aynı depo, aynı iz). v2 servisle artımlı:
    // `v2_serviste_v2ye_duser_v4_serviste_uygulama_eski`.
    pc_fikstur_gibi(&mut h);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true), "v2 döneminin kopyası: v3'te ilk bağlantı tam");
    h.kopar();
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(false), "son_rev ve iz korunduğu için tam telafi gerekmedi");
    assert_eq!(h.pc.uygulanan, vec![KUYRUK_ISLEMI.to_string()]);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde, d.son_hata, d.surum_uyusmazligi), (0, 0, None, None));
    // Alarmlar eşitlemeden sonra da aynı plan.
    assert_eq!(h.alarm.kurulular().len(), 4);

    // PC'de gün bölümü eklendi (akşam): gün hatırlatması 09:00'dan 19:00'a taşınır.
    let k = h.pc.disaridan_degistir("k_araba", |k| {
        if let Some(AjandaZamani::Gun { gun_bolumu, .. }) = &mut k.zaman {
            *gun_bolumu = Some(ajanda_cekirdek::model::GunBolumu::Aksam);
        }
    });
    h.pc_degisti(k);
    assert!(h.alarm.kurulular().contains(&("k_araba".to_string(), bugun(19, 0) + 3 * GUN)));
    assert!(!h.alarm.kurulular().contains(&("k_araba".to_string(), bugun(9, 0) + 3 * GUN)));
}

/// Elle bir bağlantı: telefonun açılış çerçevesi alınır, verilen çerçeve gelir (motor kapattırır), kabuk
/// kapanışı (koduyla) bildirir. Döner: açılış çerçevesinin `v`'si.
fn uyusmazlik_yasat(h: &mut Hat, cerceve: Option<&str>, kod: Option<i32>) -> i64 {
    let tasima = Arc::new(SahteTasima::default());
    let nesil = h.c.baglanti_acildi(tasima.clone()).unwrap();
    let hello = tasima.giden.lock().unwrap().pop().unwrap();
    let v: serde_json::Value = serde_json::from_str(&hello).unwrap();
    assert_eq!(v["type"], "hello", "{hello}");
    if let Some(c) = cerceve {
        h.c.cerceve_geldi(nesil, c.into()).unwrap();
        assert!(tasima.kapatildi.lock().unwrap().is_some(), "uyuşmazlıkta bağlantı kapatılır");
    }
    h.c.baglanti_kapandi(nesil, kod).unwrap();
    v["v"].as_i64().unwrap()
}

#[test]
fn surum_uyusmazligi_temiz_durumdur_yonu_bilinir_veri_dokunulmaz() {
    let mut h = Hat::sql_depoyla("uyusmazlik", V1_DEPO);
    h.c.alarmlari_yeniden_kur(YenidenKurmaNedeni::PaketGuncellendi).unwrap();
    let alarmlar = h.alarm.kurulular();

    // Eski (v1) servis: v1 error çerçevesi ve 1002. Uygulama v3 ile açar; ret sürümü kümenin altında.
    assert_eq!(uyusmazlik_yasat(&mut h, Some(r#"{"v":1,"type":"error","code":"protokol_uyumsuz"}"#), Some(1002)), 3);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!(d.asama, BaglantiAsamasi::Kopuk);
    assert_eq!((d.son_hata, d.surum_uyusmazligi), (Some(AjandaKanalHatasi::ProtokolUyumsuz), Some(SurumUyusmazligi::ServisEski)));
    assert_eq!((d.kuyrukta, d.ret_listesinde), (1, 0), "kuyruk durur, deneme sayılmaz");
    assert_eq!(h.alarm.kurulular(), alarmlar);
    assert!(h.c.kayit("k_araba".into()).unwrap().is_some());

    // Daha yeni (v4, v2 ve v3'ü bırakmış) servis: ret sürümü kümenin üstünde, uygulama eski. Ret olmayan v4
    // çerçevesi de aynı yönü verir.
    assert_eq!(uyusmazlik_yasat(&mut h, Some(r#"{"v":4,"type":"error","code":"protokol_uyumsuz"}"#), Some(1002)), 3);
    assert_eq!(h.c.baglanti_durumu().unwrap().surum_uyusmazligi, Some(SurumUyusmazligi::UygulamaEski));
    uyusmazlik_yasat(&mut h, Some(r#"{"v":4,"type":"esitlendi","rev":1}"#), None);
    assert_eq!(h.c.baglanti_durumu().unwrap().surum_uyusmazligi, Some(SurumUyusmazligi::UygulamaEski));

    // Yalnız kapanış 1002 (çerçevesiz): v3'te bir alt sürüme düşülür (durum yazılmaz, eski uyuşmazlık
    // kalkar: kabuk kısa beklemeyle yeniden bağlanır); v2'de de aynısı olursa yön bilinmez.
    assert_eq!(uyusmazlik_yasat(&mut h, None, Some(1002)), 3);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.son_hata, d.surum_uyusmazligi), (None, None), "geri düşüş uyuşmazlık değildir");
    assert_eq!(uyusmazlik_yasat(&mut h, None, Some(1002)), 2, "düşülen sürümle açılır");
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.son_hata, d.surum_uyusmazligi), (Some(AjandaKanalHatasi::ProtokolUyumsuz), Some(SurumUyusmazligi::Bilinmiyor)));

    // Sıradan kopma (kod yok, 1000) uyuşmazlık değildir ve öncekini silmez; başka kanal hatası siler.
    uyusmazlik_yasat(&mut h, None, Some(1000));
    assert_eq!(h.c.baglanti_durumu().unwrap().surum_uyusmazligi, Some(SurumUyusmazligi::Bilinmiyor));
    assert_eq!(uyusmazlik_yasat(&mut h, Some(r#"{"v":2,"type":"error","code":"cihaz_bilinmiyor"}"#), None), 2);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.son_hata, d.surum_uyusmazligi), (Some(AjandaKanalHatasi::CihazBilinmiyor), None));

    // v3 servis (küme [2, 3]): düşülen sürüm bir saat sonra unutulur, uygulama yeniden v3 ile açar ve v3'te
    // bağlanır; durum temizlenir, kuyruk gider.
    uyusmazlik_yasat(&mut h, Some(r#"{"v":1,"type":"error","code":"protokol_uyumsuz"}"#), Some(1002));
    h.zaman.ilerlet(SAAT + 1);
    pc_fikstur_gibi(&mut h);
    h.baglan();
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.asama, d.son_hata, d.surum_uyusmazligi, d.kuyrukta), (BaglantiAsamasi::Canli, None, None, 0));
    assert_eq!(h.pc.acilislar, vec![("hello", 3)]);
    assert_eq!(h.pc.uygulanan, vec![KUYRUK_ISLEMI.to_string()]);
}

/// Aynı fikstür, servis yalnız v2 (bugün canlıdaki servis) ya da yalnız v4: v2 servise ilk deneme kısa bir
/// retle biter, ikinci bağlantı v2'de eşitlenir; v4 serviste uygulama eski, hiçbir şey değişmez.
#[test]
fn v2_serviste_v2ye_duser_v4_serviste_uygulama_eski() {
    let mut h = Hat::sql_depoyla("uyusmazlik-v2-v4", V1_DEPO);
    pc_fikstur_gibi(&mut h);
    h.pc.surum_kumesi(&[2]);
    h.baglan();
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.asama, d.son_hata, d.surum_uyusmazligi, d.kuyrukta), (BaglantiAsamasi::Kopuk, None, None, 1));
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar, vec![("hello", 3), ("hello", 2)]);
    assert_eq!(h.pc.son_welcome_tam, Some(false), "v2 bağlantı bugünkü gibi artımlı");
    assert_eq!(h.pc.uygulanan, vec![KUYRUK_ISLEMI.to_string()]);

    let mut h = Hat::sql_depoyla("uyusmazlik-v4", V1_DEPO);
    pc_fikstur_gibi(&mut h);
    h.pc.surum_kumesi(&[4]);
    let alarmlar = h.alarm.kurulular();
    h.baglan();
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.asama, d.son_hata, d.surum_uyusmazligi), (BaglantiAsamasi::Kopuk, Some(AjandaKanalHatasi::ProtokolUyumsuz), Some(SurumUyusmazligi::UygulamaEski)));
    assert_eq!((d.kuyrukta, d.ret_listesinde), (1, 0));
    assert_eq!(h.alarm.kurulular(), alarmlar);
    assert_eq!(h.pc.acilislar, vec![("hello", 3)], "uygulama eskiyken alt sürüm denenmez");
}

const V3_ESLESMESIZ: &str = include_str!("veri/v3_eslesmesiz_kuyruklu.sql");
/// Fikstürdeki kayıtlar (`v3_eslesmesiz_kuyruklu.sql` başı).
const DISCI: &str = "k_AAECAwQFBgYICQoLDA0ODg";
const FATURA: &str = "k_AAECAwQFBgQICQoLDA0ODA";
const SILINECEK: &str = "k_AAECAwQFBgIICQoLDA0OCg";
const SPOR: &str = "k_AAECAwQFBgAICQoLDA0OCA";

/// Bir veritabanının bütün tabloları satır satır (her değer `quote()` ile), tablo adıyla.
fn tablolar(db: &rusqlite::Connection) -> std::collections::BTreeMap<String, Vec<String>> {
    let mut s = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").unwrap();
    let adlar: Vec<String> = s.query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect();
    let mut sonuc = std::collections::BTreeMap::new();
    for ad in adlar {
        let sutunlar: Vec<String> = db
            .prepare(&format!("SELECT name FROM pragma_table_info('{ad}')"))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|x| x.unwrap())
            .collect();
        let ifade = sutunlar.iter().map(|c| format!("quote(\"{c}\")")).collect::<Vec<_>>().join(" || ',' || ");
        let mut satirlar: Vec<String> = db
            .prepare(&format!("SELECT {ifade} FROM \"{ad}\""))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|x| x.unwrap())
            .collect();
        satirlar.sort();
        sonuc.insert(ad, satirlar);
    }
    sonuc
}

fn fikstur_tablolari(sql: &str) -> std::collections::BTreeMap<String, Vec<String>> {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    db.execute_batch(sql).unwrap();
    tablolar(&db)
}

#[test]
fn goc_4_eslesmis_kurulumda_hicbir_satiri_degistirmez_bagli_kip_aynen_calisir() {
    let once = fikstur_tablolari(V1_DEPO);
    let mut h = Hat::sql_depoyla("goc4-bagli", V1_DEPO);
    let mut sonra = tablolar(&rusqlite::Connection::open(&h.yol).unwrap());
    assert_eq!(sonra.remove("yerel_gecmis"), Some(vec![]), "yeni tablo boş");
    let meta = sonra.get_mut("meta").unwrap();
    let kip = meta.iter().position(|s| s.starts_with("'kip',")).expect("kip yazıldı");
    assert_eq!(meta.remove(kip), "'kip','bagli'");
    assert_eq!(once, sonra, "eşleşmiş kurulumda kip satırı dışında hiçbir satır değişmez");
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);

    // Bağlı kip bugünkü gibi: çevrimdışı işlem kuyruğa girer, bekleyen görünür, yerel geçmiş yazılmaz.
    let id = h.c.ekle(govde("Bağlıda", None), ajanda_cekirdek::model::GirdiYolu::Elle).unwrap();
    let g = h.c.kayit(id.clone()).unwrap().unwrap();
    assert!(g.bekleyen);
    assert_eq!(g.kayit.revizyon, 1, "iyimser ekle: revizyonu servis verir");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 2);
    assert_eq!(ajanda_cekirdek::depo::Depo::ac(&h.yol).unwrap().yerel_gecmis_sayisi(&id).unwrap(), 0);
    assert!(matches!(h.c.gecmis_iste(id.clone(), None), Err(ajanda_cekirdek::CekirdekHatasi::GecersizDurum { .. })));
    pc_fikstur_gibi(&mut h);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.uygulanan.len(), 2, "fikstürün kuyruğu ve yeni ekleme gider");
    assert_eq!(h.c.kayit(id.clone()).unwrap().unwrap().kayit, h.pc.d.kayitlar[&id]);
}

#[test]
fn goc_4_eslesmesiz_kuyruklu_kurulumu_yerele_toplar() {
    let once = fikstur_tablolari(V3_ESLESMESIZ);
    assert_eq!(once["kuyruk"].len(), 8);
    assert!(once["gorunen"].iter().all(|s| s.ends_with(&format!(",1,{}", s.rsplit(',').next().unwrap()))), "fikstürde hepsi bekleyen");
    let mut h = Hat::sql_depoyla("goc4-yerel", V3_ESLESMESIZ);
    assert_eq!(h.c.sema_surumu().unwrap(), 4);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    let sonra = tablolar(&rusqlite::Connection::open(&h.yol).unwrap());
    assert!(sonra["kuyruk"].is_empty(), "kuyruk atıldı");
    assert_eq!(sonra["meta"], vec!["'kip','yerel'".to_string()]);
    assert_eq!(sonra["kurulu_alarmlar"], once["kurulu_alarmlar"], "alarmlara dokunulmaz");
    assert_eq!(sonra["ret_listesi"], once["ret_listesi"]);
    // Görünen kayıtlar aynı (kayıt metni birebir), yalnız `bekleyen` düştü.
    let bekleyensiz: Vec<String> = once["gorunen"]
        .iter()
        .map(|s| {
            let (bas, olusturma) = s.rsplit_once(',').unwrap();
            let (bas, bekleyen) = bas.rsplit_once(',').unwrap();
            assert_eq!(bekleyen, "1");
            format!("{bas},0,{olusturma}")
        })
        .collect();
    assert_eq!(sonra["gorunen"], bekleyensiz);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0));
    for s in [Sekme::Tarihli, Sekme::Tarihsiz, Sekme::Silinenler] {
        assert!(h.c.liste(ListeSorgusu { sekme: s, kapalilar_dahil: true }).unwrap().iter().all(|g| !g.bekleyen));
    }
    let disci = h.c.kayit(DISCI.into()).unwrap().unwrap().kayit;
    assert_eq!((disci.baslik.as_str(), disci.revizyon), ("Dişçi (kontrol)", 1));
    assert_eq!(h.c.kayit(FATURA.into()).unwrap().unwrap().kayit.durum, ajanda_cekirdek::model::KayitDurumu::Tamam);
    assert!(h.c.kayit(SILINECEK.into()).unwrap().unwrap().kayit.silindi);
    assert_eq!(h.c.kayit(SPOR.into()).unwrap().unwrap().kayit.ornekler.len(), 1);

    // Alarm planı aynı: yeniden kurulunca fikstürün iki alarmı aynı istek koduyla kurulur.
    h.c.alarmlari_yeniden_kur(YenidenKurmaNedeni::PaketGuncellendi).unwrap();
    assert_eq!(h.alarm.kurulular(), vec![(SPOR.to_string(), 1_795_662_000_000), (DISCI.to_string(), 1_795_694_400_000)]);
    assert_eq!(h.alarm.kurulu_nolar(), vec![3, 4]);

    // Toplanan hal yerel gerçektir: üstüne yerel yazma kalıcıdır, revizyon var olanların üstünden başlar.
    h.c.duzenle(DISCI.into(), None, govde("Dişçi (dolgu)", Some(an("2026-11-26", "16:00")))).unwrap();
    let k = h.c.kayit(DISCI.into()).unwrap().unwrap();
    assert_eq!((k.kayit.baslik.as_str(), k.kayit.revizyon, k.bekleyen), ("Dişçi (dolgu)", 2, false));
    h.sureci_oldur_ve_ac();
    assert_eq!(h.c.kayit(DISCI.into()).unwrap().unwrap().kayit.baslik, "Dişçi (dolgu)");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert!(ajanda_cekirdek::depo::Depo::ac(&h.yol).unwrap().kuyruk().unwrap().is_empty());
}

/// Şema 3 kodunun ürettiği zengin eşleşmiş kurulum (`v3_eslesmis_zengin.sql` başı; `alarm_ufku` el ile).
const V3_ZENGIN: &str = include_str!("veri/v3_eslesmis_zengin.sql");
const ZENGIN_FATURA: &str = "k_AAECAwQFBg8ICQoLDA0OBw";

/// Fikstür gerçekten bu durumları taşıyor: ret satırı, mezar taşı, tekrar + örnek durumu, onaylanmış,
/// yollanmış ve bekleyen kuyruk satırı, teslim edilmiş alarm, alarm ufku.
fn zengin_fikstur_dogrula(t: &std::collections::BTreeMap<String, Vec<String>>) {
    assert_eq!(t["ret_listesi"].len(), 1);
    assert!(t["gorunen"].iter().any(|s| s.starts_with("'k_eski'") && s.contains(r#""silindi":true"#)));
    assert!(t["gorunen"].iter().any(|s| s.contains(r#""ornekler":[{"durum":"tamam","tarih":"2026-11-24"}]"#) && s.contains(r#""tekrar""#)));
    let kuyruk = &t["kuyruk"];
    assert_eq!(kuyruk.len(), 3);
    assert!(kuyruk.iter().any(|s| s.ends_with(",0,0,1795607460000,7")), "onaylanmış: {kuyruk:?}");
    assert!(kuyruk.iter().any(|s| s.ends_with(",0,1,1795607460000,NULL")), "yollanmış: {kuyruk:?}");
    assert!(kuyruk.iter().any(|s| s.contains("'k_AAECAwQFBg8ICQoLDA0OBw'") && s.ends_with(",0,0,1795607460000,NULL")));
    assert!(t["kurulu_alarmlar"].iter().any(|s| s.starts_with("2,'k_kargo'") && !s.ends_with("NULL")), "teslim edilmiş alarm");
    assert!(t["meta"].iter().any(|s| s.starts_with("'alarm_ufku',")));
}

/// PC'yi zengin fikstürün haline getirir: sunucu kopyası + onaylanmış satırın PC'de uygulanmış hali (rev 7).
fn pc_zengin_gibi(h: &mut Hat) {
    pc_fikstur_gibi(h);
    h.pc.disaridan_degistir("k_disci", |k| k.baslik = "Dişçi (kontrol)".into());
}

#[test]
fn goc_4_zengin_eslesmis_kurulumda_yalniz_kip_satiri_eklenir_baglanti_artimli() {
    let once = fikstur_tablolari(V3_ZENGIN);
    zengin_fikstur_dogrula(&once);
    let mut h = Hat::sql_depoyla("goc4-zengin-bagli", V3_ZENGIN);
    let mut sonra = tablolar(&rusqlite::Connection::open(&h.yol).unwrap());
    assert_eq!(sonra.remove("yerel_gecmis"), Some(vec![]));
    let meta = sonra.get_mut("meta").unwrap();
    let kip = meta.iter().position(|s| s.starts_with("'kip',")).expect("kip yazıldı");
    assert_eq!(meta.remove(kip), "'kip','bagli'");
    assert_eq!(once, sonra, "kip satırı dışında hiçbir satır değişmedi (açılış onarımı da dokunmadı)");
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.son_gecis().unwrap(), None);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (2, 1), "onaylanmış satır sayılmaz");
    assert_eq!(h.c.kayit("k_disci".into()).unwrap().unwrap().kayit.baslik, "Dişçi (kontrol)");

    // Aynı servis: v2 döneminin kopyası olduğundan v3'teki ilk bağlantı tam (sonraki artımlı); yollanmış
    // satır kopma sayılıp yeniden gider, onaylanmışın kaydı gelir.
    pc_zengin_gibi(&mut h);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((h.c.kip().unwrap(), d.kuyrukta, d.ret_listesinde), (CalismaKipi::Bagli, 0, 1));
    for id in ["k_disci", "k_spor", "k_eski", "k_kargo", ZENGIN_FATURA] {
        assert_eq!(h.c.kayit(id.into()).unwrap().unwrap().kayit, h.pc.d.kayitlar[id], "{id}");
    }
    assert_eq!(h.pc.d.kayitlar["k_spor"].baslik, "Spor (koşu)");
    assert!(ajanda_cekirdek::depo::Depo::ac(&h.yol).unwrap().kuyruk().unwrap().is_empty());
}

#[test]
fn goc_4_zengin_eslesmesiz_kurulumu_yerele_toplar() {
    let sql = format!("{V3_ZENGIN}\nDELETE FROM meta WHERE anahtar = 'eslesme';");
    let once = fikstur_tablolari(&sql);
    zengin_fikstur_dogrula(&once);
    let mut h = Hat::sql_depoyla("goc4-zengin-yerel", &sql);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    let mut sonra = tablolar(&rusqlite::Connection::open(&h.yol).unwrap());
    assert_eq!(sonra.remove("yerel_gecmis"), Some(vec![]));
    assert!(sonra["kuyruk"].is_empty(), "onaylanmış, yollanmış, bekleyen: hepsi yerele toplandı");
    let mut meta = once["meta"].clone();
    meta.push("'kip','yerel'".into());
    meta.sort();
    assert_eq!(sonra["meta"], meta, "alarm ufku, depo_id, son_rev kalır");
    for t in ["ret_listesi", "sunucu_kayitlari", "kurulu_alarmlar", "telafi_kayitlari"] {
        assert_eq!(sonra[t], once[t], "{t} aynı");
    }
    let bekleyensiz: Vec<String> = once["gorunen"]
        .iter()
        .map(|s| {
            let (bas, olusturma) = s.rsplit_once(',').unwrap();
            let (bas, _) = bas.rsplit_once(',').unwrap();
            format!("{bas},0,{olusturma}")
        })
        .collect();
    assert_eq!(sonra["gorunen"], bekleyensiz, "görünen kopya metni aynı, bekleyen düştü");
    assert_eq!(h.c.son_gecis().unwrap(), None);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 1));
    let k = |id: &str| h.c.kayit(id.into()).unwrap().unwrap();
    assert_eq!(k("k_disci").kayit.baslik, "Dişçi (kontrol)", "onaylanmış hal");
    assert_eq!((k("k_spor").kayit.baslik.as_str(), k("k_spor").kayit.ornekler.len()), ("Spor (koşu)", 1), "yollanmış hal");
    assert!(k("k_eski").kayit.silindi);
    assert!(!k(ZENGIN_FATURA).bekleyen);
    let silinenler = h.c.liste(ListeSorgusu { sekme: Sekme::Silinenler, kapalilar_dahil: true }).unwrap();
    assert_eq!(silinenler.iter().map(|g| g.kayit.kayit_id.as_str()).collect::<Vec<_>>(), vec!["k_eski"]);

    // Aynı servise eşleşince toplanan hal kaybolmadan gider (üç yollu; iki tarafta silinmiş mezar taşına işlem yok).
    pc_zengin_gibi(&mut h);
    h.eslestir();
    assert!(h.canli_mi());
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((h.c.kip().unwrap(), d.kuyrukta, d.ret_listesinde), (CalismaKipi::Bagli, 0, 1));
    for id in ["k_disci", "k_spor", "k_eski", "k_kargo", ZENGIN_FATURA] {
        assert_eq!(h.c.kayit(id.into()).unwrap().unwrap().kayit, h.pc.d.kayitlar[id], "{id}");
    }
    assert_eq!((h.pc.d.kayitlar["k_spor"].baslik.as_str(), h.pc.d.kayitlar[ZENGIN_FATURA].baslik.as_str()), ("Spor (koşu)", "Fatura öde"));
}
