//! Takvim sekmesi köprü yüzeyi (`takvim_ayi`, `takvim_gunu`) uçtan uca: sahte PC'den eşitlenen kopya,
//! dosya veritabanı (okuma bağlantısı), sahte `ZamanKabugu` (cihaz dilimi İstanbul). Örneğin durumunu
//! değiştirme akışı Kotlin ekranının izleyeceği yoldur: `takvim_gunu` -> `durum_degistir(kayit_id, durum,
//! ornek_tarihi)` -> gözlemci -> yeniden sorgu.

mod ortak;

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::kopru::tipler::TakvimOgesi;
use ajanda_cekirdek::model::{AjandaZamani, GirdiYolu, GunBolumu, KayitDurumu, KayitTuru, Tekrar, TekrarSikligi};
use ortak::*;

fn gun(tarih: &str, bolum: Option<GunBolumu>) -> AjandaZamani {
    AjandaZamani::Gun { tarih: tarih.into(), gun_bolumu: bolum, saat_dilimi: IST.into(), ifade: None }
}

fn basliklar(l: &[TakvimOgesi]) -> Vec<String> {
    l.iter().map(|o| o.gorunum.kayit.baslik.clone()).collect()
}

#[test]
fn takvim_esitlenen_kopyadan_okunur_ornek_durumu_degisir() {
    let mut h = Hat::yeni("takvim");
    let mut seri = govde("Yürüyüş", Some(gun("2026-12-01", None)));
    seri.tur = KayitTuru::Gorev;
    seri.tekrar = Some(Tekrar { siklik: TekrarSikligi::Gunluk, aralik: 1, gunler: None, bitis_tarihi: None, adet: None });
    h.pc.disaridan_ekle("k_seri", &seri, false);
    h.pc.disaridan_ekle("k_aksam", &govde("Araba yıkama", Some(gun("2026-12-03", Some(GunBolumu::Aksam)))), false);
    h.pc.disaridan_ekle("k_dis", &govde("Dişçi", Some(an("2026-12-03", "15:00"))), false);
    h.pc.disaridan_ekle(
        "k_tatil",
        &govde(
            "Tatil",
            Some(AjandaZamani::Donem { baslangic: "2026-11-29".into(), bitis: "2026-12-04".into(), saat_dilimi: IST.into(), ifade: None }),
        ),
        false,
    );
    h.pc.disaridan_ekle("k_taslak", &govde("Belki toplantı", Some(an("2026-12-03", "09:00"))), true);
    h.eslestir();
    assert!(h.canli_mi());

    let a = h.c.takvim_ayi(2026, 12, false).unwrap();
    assert_eq!(a.gunler.len(), 31);
    let g3 = &a.gunler[2];
    assert_eq!((g3.tarih.as_str(), g3.toplam, g3.taslak, g3.serit, g3.gorev), ("2026-12-03", 5, 1, 1, 1));
    assert_eq!(a.gunler[4].toplam, 1, "5 aralık: yalnız seri");
    assert_eq!(a.seritler.len(), 1);
    assert_eq!((a.seritler[0].ilk_gun.as_str(), a.seritler[0].son_gun.as_str()), ("2026-11-29", "2026-12-04"));

    let l = h.c.takvim_gunu("2026-12-03".into(), false).unwrap();
    assert_eq!(basliklar(&l), ["Tatil", "Yürüyüş", "Araba yıkama", "Belki toplantı", "Dişçi"]);
    let ornek = l.iter().find(|o| o.gorunum.kayit.kayit_id == "k_seri").unwrap();
    assert_eq!((ornek.ornek_tarihi.as_deref(), ornek.durum), (Some("2026-12-03"), KayitDurumu::Acik));

    // Örneği tamamla (iyimser, sonra PC onaylar): kapalılar hariç görünmez, dahilken `tamam`.
    h.c.durum_degistir("k_seri".into(), KayitDurumu::Tamam, ornek.ornek_tarihi.clone()).unwrap();
    assert!(h.gozlemci.al().iter().any(|d| d.kayitlar.contains(&"k_seri".to_string())));
    h.pompala();
    let l = h.c.takvim_gunu("2026-12-03".into(), false).unwrap();
    assert!(!basliklar(&l).contains(&"Yürüyüş".to_string()));
    let l = h.c.takvim_gunu("2026-12-03".into(), true).unwrap();
    let ornek = l.iter().find(|o| o.gorunum.kayit.kayit_id == "k_seri").unwrap();
    assert_eq!((ornek.durum, ornek.gorunum.kayit.durum), (KayitDurumu::Tamam, KayitDurumu::Acik));
    assert_eq!(h.c.takvim_ayi(2026, 12, true).unwrap().gunler[2].kapali, 1);
    assert_eq!(h.c.takvim_gunu("2026-12-04".into(), false).unwrap().len(), 2, "öteki örnekler açık");

    // Silinen hiçbir yerde görünmez; elle eklenen (iyimser, bekleyen) hemen görünür.
    h.c.sil("k_dis".into()).unwrap();
    let yeni = h.c.ekle(govde("Kuaför", Some(an("2026-12-03", "11:00"))), GirdiYolu::Elle).unwrap();
    let l = h.c.takvim_gunu("2026-12-03".into(), true).unwrap();
    assert!(!basliklar(&l).contains(&"Dişçi".to_string()));
    let o = l.iter().find(|o| o.gorunum.kayit.kayit_id == yeni).unwrap();
    assert_eq!(o.saat.as_deref(), Some("11:00"));
    h.pompala();
    assert!(!h.c.takvim_gunu("2026-12-03".into(), true).unwrap().iter().any(|o| o.gorunum.bekleyen));

    // Hatalı girdi.
    assert!(matches!(h.c.takvim_ayi(2026, 13, false), Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "ay"));
    assert!(matches!(h.c.takvim_gunu("2026-02-30".into(), false), Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "tarih"));
}
