//! v3 alanlarının yerel yazarda ve D2 yollarında taşınması (R1) uçtan uca: köprünün açık yüzeyi + sahte
//! kabuklar + sürüm kümeli sahte PC (`ortak`).
//!
//! - Depo değişimi (yeni QR ya da sıfırdan kurulmuş servis): PC'den gelmiş v3 alanlı kayıt yeni servise
//!   `ekle` ile v3 alanlarıyla gider (bölge, konum, bağlantılar kalıcı olarak gitmez).
//! - Aynı depoda yedekten dönüş: PC'nin yitirdiği v3 alanlı kayıt ve onaylanmış v3 alanlı `ekle` v3
//!   alanlarıyla yeniden gider.
//! - v2 servise dökülen v3 alanlı kayıt: v2 kısmı gider, v3 kalanı ertelenir (ret listesine düşmez), servis
//!   v3'e geçince gider.

mod ortak;

use ajanda_cekirdek::kopru::tipler::CalismaKipi;
use ajanda_cekirdek::model::{AjandaBaglanti, AjandaBolgeKonumu, AjandaIslem, AjandaKaydi, GirdiYolu, V3Alanlari};
use ortak::*;

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

fn v3_alanlari() -> V3Alanlari {
    V3Alanlari {
        simge: Some("alisveris".into()),
        bolge: Some("Market".into()),
        bolge_konumu: Some(AjandaBolgeKonumu { enlem_e6: 41_008_240, boylam_e6: 28_978_359, yaricap_m: 150 }),
        baglantilar: vec![AjandaBaglanti { url: "https://ornek.com/liste".into(), baslik: Some("Liste".into()) }],
        ..Default::default()
    }
}

/// Başka bir servis (başka `depo_id`), bu cihazı tanıyan (aynı PC'de sıfırdan kurulmuş servis).
fn yeni_servis(h: &Hat, depo_id: &str) -> SahtePc {
    let mut pc = SahtePc::yeni(depo_id, h.zaman.clone());
    pc.cihaz_public_key = h.pc.cihaz_public_key.clone();
    pc
}

/// Bağlanır; yerel kipten bağlanma önizleme onayı bekliyorsa onaylar.
fn baglan_onayla(h: &mut Hat) {
    h.baglan();
    if h.c.kip().unwrap() == CalismaKipi::Yerel
        && let Some(p) = h.c.birlestirme_onizlemesi().unwrap()
    {
        assert!(h.c.birlestirmeyi_onayla(Some(p.iz)).unwrap().uygulandi);
        h.pompala();
    }
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
}

/// PC'de v3 alanlı kayıt varken eşleşmiş hat. Döner: kaydın kimliği.
fn v3_kayitli_kurulum(h: &mut Hat) -> String {
    h.pc.disaridan_v3_ekle("k_market01", &govde("Süt al", None), v3_alanlari());
    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(kayit(h, "k_market01").v3, v3_alanlari());
    "k_market01".into()
}

/// (b) Depo değişimi: telefon başka bir `depo_id`'ye bağlanır, kayıt yeni servise `ekle` ile gider; v3
/// alanları da gider (eskiden `ekle` v3'süzdü, sonra kopya PC'nin v3'süz haliyle yeniden yazılıyordu).
#[test]
fn depo_degisince_v3_alanli_kayit_yeni_servise_v3_ile_gider() {
    let mut h = Hat::yeni("v3-depo-degisti");
    let a = v3_kayitli_kurulum(&mut h);
    h.kopar();
    h.pc = yeni_servis(&h, "d_pc_yeni");
    baglan_onayla(&mut h);
    assert_eq!(h.pc.d.kayitlar[&a].v3, v3_alanlari(), "v3 alanları yeni servise gitti");
    assert_eq!(kayit(&h, &a).v3, v3_alanlari(), "telefon v3 alanlarını korudu");
    assert_eq!(&kayit(&h, &a), &h.pc.d.kayitlar[&a]);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ertelenen_islem, d.ret_listesinde), (0, 0, 0));
}

/// (b) Aynı depoda yedekten dönüş: PC v3 alanlı kaydı yitirdi; telefon onu v3 alanlarıyla yeniden gönderir.
#[test]
fn yedekten_donen_servis_yitirdigi_v3_alanli_kaydi_v3_ile_geri_alir() {
    let mut h = Hat::yeni("v3-yedekten-donus");
    h.pc.disaridan_ekle("k_w", &govde("W", None), false);
    h.eslestir();
    let yedek = h.pc.d.clone();
    h.zaman.ilerlet(DK);
    let k = h.pc.disaridan_v3_ekle("k_market01", &govde("Süt al", None), v3_alanlari());
    h.pc_degisti(k);
    assert_eq!(kayit(&h, "k_market01").v3, v3_alanlari());
    h.kopar();
    h.pc.d = yedek;
    h.zaman.ilerlet(DK);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert_eq!(h.pc.d.kayitlar["k_market01"].v3, v3_alanlari(), "yitirilen kayıt v3 alanlarıyla geri gitti");
    assert_eq!(&kayit(&h, "k_market01"), &h.pc.d.kayitlar["k_market01"]);
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
}

/// (c) Onaylanmış (servis kabul etti, `kayit`'i gelmedi) v3 alanlı `ekle`: iyimser hali v3 alanlarını taşır,
/// servis yedekten dönüp kaydı yitirince `ekle` v3 alanlarıyla yeniden gider.
#[test]
fn onaylanmis_v3_alanli_ekle_yedekten_donuste_v3_ile_yeniden_gider() {
    let mut h = Hat::yeni("v3-onayli-ekle");
    h.pc.disaridan_ekle("k_w", &govde("W", None), false);
    h.eslestir();
    let yedek = h.pc.d.clone();
    h.zaman.ilerlet(DK);
    let k = h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.pc_degisti(k);
    h.kopar();
    let ekle = AjandaIslem::Ekle {
        kayit_id: "k_market01".into(),
        govde: govde("Süt al", None),
        v3: v3_alanlari(),
        girdi_yolu: GirdiYolu::Elle,
    };
    rusqlite::Connection::open(&h.yol)
        .unwrap()
        .execute(
            "INSERT INTO kuyruk (islem_id, kayit_id, islem_json, olusturma_ms, yollandi, bekledigi_rev) VALUES (?1, ?2, ?3, ?4, 1, 3)",
            rusqlite::params!["i_onayli", "k_market01", ekle.json().to_string(), SIMDI],
        )
        .unwrap();
    h.sureci_oldur_ve_ac();
    h.pc.d = yedek;
    h.zaman.ilerlet(DK);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    let pc = &h.pc.d.kayitlar["k_market01"];
    assert_eq!((pc.baslik.as_str(), &pc.v3), ("Süt al", &v3_alanlari()), "onaylı ekle v3 alanlarıyla yeniden gitti");
    assert_eq!(&kayit(&h, "k_market01"), pc);
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
}

/// v2 servise dökülen v3 alanlı kayıt: `ekle`'nin v2 kısmı gider, v3 kalanı ertelenir (ret listesine
/// düşmez, telefon değerleri tutar); servis v3'e geçince gider.
#[test]
fn v2_servise_dokulen_v3_alanli_kayit_ertelenir_ret_listesine_dusmez() {
    let mut h = Hat::yeni("v3-dokum-v2");
    let a = v3_kayitli_kurulum(&mut h);
    h.kopar();
    h.pc = yeni_servis(&h, "d_pc_v2");
    h.pc.surum_kumesi(&[2]);
    h.baglan();
    baglan_onayla(&mut h);
    assert_eq!(h.pc.acilislar.last(), Some(&("hello", 2)));
    assert!(h.pc.d.kayitlar.contains_key(&a), "v2 kısmı gitti");
    assert!(h.pc.d.kayitlar[&a].v3.bos_mu(), "v2 servise v3 alanı gitmedi");
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ertelenen_islem, d.ret_listesinde), (0, 1, 0));
    assert_eq!(h.c.baglanti_yetenekleri().unwrap().ertelenen, 1);
    assert!(h.c.ret_listesi().unwrap().is_empty());
    let g = h.c.kayit(a.clone()).unwrap().unwrap();
    assert_eq!((&g.kayit.v3, g.ertelenen), (&v3_alanlari(), true));

    h.kopar();
    h.pc.surum_kumesi(&[2, 3]);
    h.zaman.ilerlet(SAAT);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar.last(), Some(&("hello", 3)));
    assert_eq!(h.pc.d.kayitlar[&a].v3, v3_alanlari());
    assert_eq!(&kayit(&h, &a), &h.pc.d.kayitlar[&a]);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ertelenen_islem, d.ret_listesinde), (0, 0, 0));
}
