//! D2 veri koruması uçtan uca (`YOL-HARITASI.md` 3.2 "Veri kaybı 1/2", 3.3 "Servis değiştirme"): köprünün
//! açık yüzeyi + sahte kabuklar + sahte PC (`ortak`).
//!
//! - Bağlı kipte `eslesmeyi_kaldir` koparmadır: görünen kopya, ret listesi, alarmlar ve PC temeli kalır,
//!   kip yerel olur; eşleşme ve cihaz anahtarı gider (veri kaybı 1).
//! - Kesin kural: görünen kopya hiçbir zaman başka bir `depo_id`'nin tam telafisiyle değiştirilmez. Bağlı
//!   kipte servis saklı olandan farklı `depo_id` getirirse (yeni QR ile başka servis ya da sıfırdan kurulmuş
//!   servis) bağlantı yerel kipten bağlanma olarak sürer (veri kaybı 2).
//! - Yeni QR reddi eski eşleşmeyi ve bağlı kipi korur; geçiş sırasında kopma hali tutarlı bırakır.
//! - Aynı servisle olağan bağlantılar (artımlı, ilk tam telafi, aynı servisle yeniden eşleşme) değişmez.

mod ortak;

use std::sync::Arc;
use std::sync::atomic::Ordering;

use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{BaglantiAsamasi, CalismaKipi, EslesmeDurumu, GecisNedeni, GecisOzeti, KoparmaSonucu};
use ajanda_cekirdek::model::kanonik::base64_yaz;
use ajanda_cekirdek::model::{AjandaEslestirmeQr, AjandaKanalHatasi, AjandaKaydi, AjandaRetNedeni, GirdiYolu};
use ortak::*;

fn yarin(saat: i64) -> i64 {
    bugun(saat, 0) + GUN
}

fn depo(h: &Hat) -> Depo {
    Depo::ac(&h.yol).unwrap()
}

/// Görünen kopyanın bütün kayıtları (mezar taşları dahil).
fn gorunenler(h: &Hat) -> Vec<AjandaKaydi> {
    depo(h).gorunen_hepsi().unwrap()
}

/// PC temeli: sunucu kopyası, `depo_id`, `son_rev`.
fn temel(h: &Hat) -> (Vec<AjandaKaydi>, Option<String>, i64) {
    let d = depo(h);
    (d.sunucu_kayitlari().unwrap(), d.depo_id().unwrap(), d.son_rev().unwrap())
}

fn telafi_sayisi(h: &Hat) -> i64 {
    rusqlite::Connection::open(&h.yol).unwrap().query_row("SELECT COUNT(*) FROM telafi_kayitlari", [], |s| s.get(0)).unwrap()
}

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

fn simdi(h: &Hat) -> i64 {
    h.zaman.simdi.load(Ordering::SeqCst)
}

/// Değişmez: her yerel kayıt ya görünen kopyada durur ya da ret listesindedir.
fn hicbiri_kaybolmadi(h: &Hat, yereller: &[AjandaKaydi]) {
    let ret = h.c.ret_listesi().unwrap();
    for k in yereller {
        assert!(
            h.c.kayit(k.kayit_id.clone()).unwrap().is_some() || ret.iter().any(|r| r.kayit_id == k.kayit_id),
            "{} sessizce kayboldu",
            k.kayit_id
        );
    }
}

/// Telefon ile PC bu kayıtlarda aynı.
fn pc_ile_ayni(h: &Hat, idler: &[&str]) {
    for id in idler {
        assert_eq!(&kayit(h, id), &h.pc.d.kayitlar[*id], "{id}: telefon ile PC aynı");
    }
}

/// Bağlantıyı açar ve trafiği taşır, ama PC'nin `esitlendi`'sini telefona vermeden tutar (telafi sürüyor).
fn esitlendiye_dek_baglan(h: &mut Hat) -> String {
    let tasima = Arc::new(SahteTasima::default());
    let nesil = h.c.baglanti_acildi(tasima.clone()).unwrap();
    h.baglanti = Some(Baglanti { nesil, tasima, pc: PcAsama::HelloBekliyor });
    let mut tutulan = None;
    loop {
        let b = h.baglanti.as_mut().unwrap();
        let giden: Vec<String> = std::mem::take(&mut *b.tasima.giden.lock().unwrap());
        if giden.is_empty() {
            break;
        }
        for f in giden {
            let cikti = h.pc.isle(&mut b.pc, &f);
            assert!(!cikti.kapat);
            for g in cikti.cerceveler {
                if g.contains(r#""esitlendi""#) {
                    tutulan = Some(g);
                } else {
                    h.c.cerceve_geldi(nesil, g).unwrap();
                }
            }
        }
    }
    tutulan.expect("esitlendi gelmedi")
}

fn tutulani_ver(h: &mut Hat, cerceve: String) {
    let nesil = h.baglanti.as_ref().unwrap().nesil;
    h.c.cerceve_geldi(nesil, cerceve).unwrap();
    h.pompala();
}

/// Başka bir servis (başka `depo_id`); `onceki`'nin tanıdığı cihaz anahtarını taşırsa aynı eşleşmeyle
/// bağlanılabilir (aynı PC'de sıfırdan kurulmuş servis).
fn yeni_servis(h: &Hat, depo_id: &str, cihazi_tani: bool) -> SahtePc {
    let mut pc = SahtePc::yeni(depo_id, h.zaman.clone());
    if cihazi_tani {
        pc.cihaz_public_key = h.pc.cihaz_public_key.clone();
    }
    pc
}

/// Eşleşmiş ve canlı hat: PC'de zamanlı `k_a`, telefonda doğmuş `B`; sonra çevrimdışı iki kayıtta iki
/// işlem (`k_a` düzenlendi, `C` eklendi), kuyrukta. Döner: (`B`, `C`).
fn bagli_kuyruklu(h: &mut Hat) -> (String, String) {
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.eslestir();
    assert!(h.canli_mi());
    let b = h.c.ekle(govde("B", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    h.kopar();
    h.c.duzenle("k_a".into(), None, govde("A (telefon)", Some(an("2026-11-26", "15:00")))).unwrap();
    let c = h.c.ekle(govde("C", None), GirdiYolu::SesliNot).unwrap();
    assert_eq!((h.c.kip().unwrap(), h.c.baglanti_durumu().unwrap().kuyrukta), (CalismaKipi::Bagli, 2));
    (b, c)
}

fn depo_degisti(h: &Hat, eski: &str, yeni: &str, islem: i32, kayit: i32) -> GecisOzeti {
    GecisOzeti {
        neden: GecisNedeni::DepoDegisti,
        ts_ms: simdi(h),
        koparma: KoparmaSonucu {
            onceki_kip: CalismaKipi::Bagli,
            gonderilmeyen_kayit: kayit,
            gonderilmeyen_islem: islem,
            yanitsiz_islem: 0,
            ret_listesinde: 0,
            baglanma_iptal: false,
            okunamayan_pc_temeli: 0,
        },
        eski_depo_id: Some(eski.into()),
        yeni_depo_id: Some(yeni.into()),
    }
}

/// Veri kaybı 1: bağlı kipte eşleşmeyi kaldırmak artık koparmadır.
#[test]
fn bagli_kipte_eslesmeyi_kaldirmak_veriyi_korur_kip_yerel_olur() {
    let mut h = Hat::yeni("koruma-kaldir");
    h.pc.disaridan_ekle("k_pc", &govde("PC'den", Some(an("2026-11-26", "15:00"))), false);
    h.eslestir();
    h.pc.ekle_reddi = Some(AjandaRetNedeni::KayitSiniri);
    h.c.ekle(govde("Sığmayan", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    h.pc.ekle_reddi = None;
    h.kopar();
    let a = h.c.ekle(govde("Kuaför", Some(an("2026-11-26", "11:00"))), GirdiYolu::Elle).unwrap();
    h.c.duzenle("k_pc".into(), None, govde("PC'den (telefonda)", Some(an("2026-11-26", "15:00")))).unwrap();
    h.pc.islem_yut = 1;
    h.baglan();
    assert!(h.canli_mi());
    let once_gorunen = gorunenler(&h);
    let once_alarm = h.alarm.kurulular();
    assert_eq!(once_alarm, vec![(a.clone(), yarin(10)), ("k_pc".to_string(), yarin(14))]);
    let iptal_once = h.alarm.iptal_edilen.lock().unwrap().len();
    let once_temel = temel(&h);
    let once_ret = h.c.ret_listesi().unwrap();
    assert_eq!(once_ret.len(), 1);
    assert_eq!(h.c.son_gecis().unwrap(), None);
    h.gozlemci.al();

    h.c.eslesmeyi_kaldir().unwrap();
    assert!(h.baglanti.as_ref().unwrap().tasima.kapatildi.lock().unwrap().is_some(), "açık bağlantı kapatıldı");
    h.pompala();
    assert!(h.gozlemci.al().iter().any(|d| d.tumu && d.eslesme && d.baglanti));

    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!((h.c.eslesme_durumu().unwrap(), h.c.baglanti_adresi().unwrap()), (EslesmeDurumu::Yok, None));
    assert_eq!(h.kimlik.silinen_anahtar.load(Ordering::SeqCst), 1);
    assert!(depo(&h).kuyruk().unwrap().is_empty());
    assert_eq!(gorunenler(&h), once_gorunen, "görünen kopya aynen kaldı (gönderilmemişler dahil)");
    assert_eq!(kayit(&h, "k_pc").baslik, "PC'den (telefonda)");
    assert_eq!(h.alarm.kurulular(), once_alarm);
    assert_eq!(h.alarm.iptal_edilen.lock().unwrap().len(), iptal_once, "hiçbir alarm iptal edilmedi");
    assert_eq!(h.c.ret_listesi().unwrap(), once_ret);
    assert_eq!(temel(&h), once_temel, "PC temeli kalır");
    let beklenen = GecisOzeti {
        neden: GecisNedeni::EslesmeKaldirildi,
        ts_ms: simdi(&h),
        koparma: KoparmaSonucu {
            onceki_kip: CalismaKipi::Bagli,
            gonderilmeyen_kayit: 2,
            gonderilmeyen_islem: 2,
            yanitsiz_islem: 1,
            ret_listesinde: 1,
            baglanma_iptal: false,
            okunamayan_pc_temeli: 0,
        },
        eski_depo_id: Some("d_pc1".into()),
        yeni_depo_id: None,
    };
    assert_eq!(h.c.son_gecis().unwrap(), Some(beklenen.clone()));

    // Yerel kip: yazma kuyruksuz; özet ve hal süreç ölümünden sonra da durur.
    h.c.duzenle(a.clone(), None, govde("Kuaför (sakal)", Some(an("2026-11-26", "11:00")))).unwrap();
    assert!(!h.c.kayit(a.clone()).unwrap().unwrap().bekleyen);
    let yereller = gorunenler(&h);
    h.sureci_oldur_ve_ac();
    assert_eq!((h.c.kip().unwrap(), gorunenler(&h)), (CalismaKipi::Yerel, yereller.clone()));
    assert_eq!(h.c.son_gecis().unwrap(), Some(beklenen));

    // Aynı servise yeniden eşleşince telefonda kalanlar PC'ye gider.
    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    hicbiri_kaybolmadi(&h, &yereller);
    pc_ile_ayni(&h, &[a.as_str(), "k_pc"]);
    assert_eq!(h.pc.d.kayitlar[&a].baslik, "Kuaför (sakal)");
}

/// Veri kaybı 2: bağlı kipte başka bir servisle yeni QR. Hiçbir kayıt kaybolmaz; telefondakiler yeni servise
/// gider; görünen kopya yeni servisin tam telafisiyle ezilmez.
#[test]
fn bagli_kipte_baska_servise_yeni_qr_kayit_kaybettirmez() {
    let mut h = Hat::yeni("koruma-yeni-qr");
    let (b, c) = bagli_kuyruklu(&mut h);
    let yereller = gorunenler(&h);
    let once_temel = temel(&h);
    let once_alarm = h.alarm.kurulular();
    assert_eq!(once_alarm, vec![("k_a".to_string(), yarin(14))]);

    let mut pc2 = yeni_servis(&h, "d_pc2", false);
    pc2.disaridan_ekle("k_x", &govde("X", Some(an("2026-11-27", "10:00"))), false);
    pc2.disaridan_ekle("k_a", &govde("A (PC2)", Some(an("2026-11-27", "12:00"))), false);
    h.pc = pc2;
    h.gozlemci.al();
    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();
    let tut = esitlendiye_dek_baglan(&mut h);

    // Servisin tam kopyası gelene dek: kip yerel, görünen kopya, alarmlar ve eski PC temeli aynı.
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!(h.c.baglanti_durumu().unwrap().asama, BaglantiAsamasi::Telafi);
    assert!(matches!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Eslesti { .. }));
    assert_eq!(gorunenler(&h), yereller);
    assert_eq!(h.alarm.kurulular(), once_alarm);
    assert_eq!(temel(&h), once_temel);
    assert!(depo(&h).kuyruk().unwrap().is_empty());
    assert_eq!(h.c.son_gecis().unwrap(), Some(depo_degisti(&h, "d_pc1", "d_pc2", 2, 2)));
    let d = h.gozlemci.al();
    assert!(d.iter().any(|d| d.tumu && d.baglanti), "kip değişti");
    assert!(d.iter().all(|d| d.kayitlar.is_empty()));
    tutulani_ver(&mut h, tut);

    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0));
    hicbiri_kaybolmadi(&h, &yereller);
    pc_ile_ayni(&h, &["k_a", b.as_str(), c.as_str(), "k_x"]);
    // Telefonun eski temelden değiştirdiği (başlık) yeni servise gitti; dokunmadığı zamanda PC2 kazandı (eski
    // 15:00 PC2'nin 27 Kasım 12:00'ını ezmedi).
    let ka = &h.pc.d.kayitlar["k_a"];
    assert_eq!((ka.baslik.as_str(), &ka.zaman), ("A (telefon)", &Some(an("2026-11-27", "12:00"))));
    assert_eq!((h.pc.d.kayitlar[&b].baslik.as_str(), h.pc.d.kayitlar[&c].baslik.as_str()), ("B", "C"));
    assert_eq!(temel(&h).1.as_deref(), Some("d_pc2"));
    let mut beklenen = vec![("k_a".to_string(), yarin(11) + GUN), ("k_x".to_string(), yarin(9) + GUN)];
    beklenen.sort();
    assert_eq!(h.alarm.kurulular(), beklenen);
    // Bundan sonrası yeni servisle olağan bağlı kip: artımlı.
    h.kopar();
    h.baglan();
    assert_eq!((h.pc.son_welcome_tam, h.c.kip().unwrap()), (Some(false), CalismaKipi::Bagli));
}

/// Yeni QR reddedilirse eski eşleşme ve bağlı kip aynen sürer; sonraki bağlantı eski servisle artımlıdır.
#[test]
fn yeni_qr_reddi_eski_eslesmeyi_ve_bagli_kipi_korur() {
    let mut h = Hat::yeni("koruma-ret");
    bagli_kuyruklu(&mut h);
    let once_eslesme = h.c.eslesme_durumu().unwrap();
    let once_adres = h.c.baglanti_adresi().unwrap();
    let once = (gorunenler(&h), temel(&h), h.alarm.kurulular());

    h.c.eslestirme_baslat(AjandaEslestirmeQr { kod: "YANLIS".into(), ..SahtePc::qr() }).unwrap();
    h.baglan();
    assert!(h.baglanti.is_none(), "ret bağlantıyı kapatır");
    assert_eq!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Reddedildi { kod: AjandaKanalHatasi::EslestirmeKoduGecersiz });
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.baglanti_adresi().unwrap(), once_adres, "eski eşleşmeyle bağlanılır");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 2);
    assert_eq!((gorunenler(&h), temel(&h), h.alarm.kurulular()), once);
    assert_eq!(h.c.son_gecis().unwrap(), None);
    assert!(matches!(once_eslesme, EslesmeDurumu::Eslesti { .. }));

    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(false), "eski servisle artımlı");
    assert_eq!((h.c.kip().unwrap(), h.c.baglanti_durumu().unwrap().kuyrukta), (CalismaKipi::Bagli, 0));
    assert_eq!(h.pc.d.kayitlar["k_a"].baslik, "A (telefon)");
    assert_eq!(h.c.son_gecis().unwrap(), None);
}

/// Aynı eşleşme, ama servis sıfırdan kurulmuş (farklı `depo_id`): görünen kopya ezilmez, kayıtlar yeni depoya
/// gider; eşleşme ve cihaz anahtarı kalır.
#[test]
fn ayni_eslesmede_farkli_depo_id_kayip_yok() {
    let mut h = Hat::yeni("koruma-depo");
    let (b, c) = bagli_kuyruklu(&mut h);
    let once_eslesme = h.c.eslesme_durumu().unwrap();
    let yereller = gorunenler(&h);
    let mut pc2 = yeni_servis(&h, "d_pc1_yeni", true);
    pc2.disaridan_ekle("k_z", &govde("Z", None), false);
    h.pc = pc2;

    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.eslesme_durumu().unwrap(), once_eslesme);
    assert_eq!(h.kimlik.silinen_anahtar.load(Ordering::SeqCst), 0);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0));
    hicbiri_kaybolmadi(&h, &yereller);
    pc_ile_ayni(&h, &["k_a", b.as_str(), c.as_str(), "k_z"]);
    assert_eq!(h.pc.d.kayitlar["k_a"].baslik, "A (telefon)");
    assert_eq!(temel(&h).1.as_deref(), Some("d_pc1_yeni"));
    assert_eq!(h.c.son_gecis().unwrap(), Some(depo_degisti(&h, "d_pc1", "d_pc1_yeni", 2, 2)));
}

/// Geçiş sırasında kopma: `welcome`'dan sonra (geçiş yapıldı, tam kopya gelmedi) ve süreç ölümü. Kip yerel,
/// görünen kopya, alarmlar ve eski temel aynı, eşleşme kalır; sonraki bağlantı baştan dener ve tamamlar.
#[test]
fn depo_degisiminde_telafi_yarida_koparsa_hal_tutarli() {
    let mut h = Hat::yeni("koruma-yarida");
    let (b, c) = bagli_kuyruklu(&mut h);
    let yereller = gorunenler(&h);
    let once = (gorunenler(&h), h.alarm.kurulular(), temel(&h));
    let mut pc2 = yeni_servis(&h, "d_pc2", true);
    pc2.disaridan_ekle("k_x", &govde("X", None), false);
    pc2.disaridan_ekle("k_y", &govde("Y", None), false);
    pc2.telafi_kes = Some(1);
    h.pc = pc2;

    h.baglan();
    assert!(h.baglanti.is_none(), "telafi yarıda koptu");
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert!(matches!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Eslesti { .. }));
    assert_eq!((gorunenler(&h), h.alarm.kurulular(), temel(&h)), once);
    assert!(h.alarm.iptal_edilen.lock().unwrap().is_empty());
    assert_eq!(telafi_sayisi(&h), 0);
    assert!(depo(&h).kuyruk().unwrap().is_empty());
    assert_eq!(h.c.son_gecis().unwrap().map(|g| g.neden), Some(GecisNedeni::DepoDegisti));

    // Kopukken yerel yazma; süreç ölüp açılınca hal aynı.
    h.c.duzenle(b.clone(), None, govde("B (yerelde)", None)).unwrap();
    let yereller2 = gorunenler(&h);
    h.sureci_oldur_ve_ac();
    assert_eq!((h.c.kip().unwrap(), gorunenler(&h)), (CalismaKipi::Yerel, yereller2));

    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    hicbiri_kaybolmadi(&h, &yereller);
    pc_ile_ayni(&h, &["k_a", b.as_str(), c.as_str(), "k_x", "k_y"]);
    assert_eq!(h.pc.d.kayitlar[&b].baslik, "B (yerelde)");
}

/// Yeni QR kabul edildi ama bağlantı `welcome`'dan önce koptu: kip bağlı, yeni eşleşme kayıtlı, kuyruk ve
/// görünen kopya aynı. Sonraki bağlantının `welcome`'ı geçişi yapar; hiçbir kayıt kaybolmaz.
#[test]
fn yeni_qr_kabulunden_sonra_welcomedan_once_kopma_tutarli() {
    let mut h = Hat::yeni("koruma-qr-kopma");
    let (b, c) = bagli_kuyruklu(&mut h);
    let yereller = gorunenler(&h);
    let once = (gorunenler(&h), temel(&h));
    let mut pc2 = yeni_servis(&h, "d_pc2", false);
    pc2.disaridan_ekle("k_x", &govde("X", None), false);
    h.pc = pc2;
    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();

    // pair_request -> pair_result{ok}; telefonun hello'su PC'ye ulaşmadan bağlantı kopar.
    let tasima = Arc::new(SahteTasima::default());
    let nesil = h.c.baglanti_acildi(tasima.clone()).unwrap();
    let mut pc_asama = PcAsama::HelloBekliyor;
    let istek = std::mem::take(&mut *tasima.giden.lock().unwrap());
    assert_eq!(istek.len(), 1);
    for g in h.pc.isle(&mut pc_asama, &istek[0]).cerceveler {
        h.c.cerceve_geldi(nesil, g).unwrap();
    }
    assert!(tasima.giden.lock().unwrap()[0].contains(r#""hello""#));
    h.c.baglanti_kapandi(nesil, None).unwrap();

    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert!(matches!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Eslesti { .. }));
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 2);
    assert_eq!((gorunenler(&h), temel(&h)), once);
    assert_eq!(h.c.son_gecis().unwrap(), None);

    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    hicbiri_kaybolmadi(&h, &yereller);
    pc_ile_ayni(&h, &["k_a", b.as_str(), c.as_str(), "k_x"]);
    assert_eq!(h.c.son_gecis().unwrap(), Some(depo_degisti(&h, "d_pc1", "d_pc2", 2, 2)));
}

/// Aynı servisle olağan bağlantılar değişmez: artımlı yeniden bağlanma, aynı servise yeni QR (aynı depo:
/// artımlı) ve canlı yayın; hiçbir geçiş olmaz, yerel geçmiş yazılmaz.
#[test]
fn ayni_servisle_olagan_baglantilar_degismez() {
    let mut h = Hat::yeni("koruma-olagan");
    bagli_kuyruklu(&mut h);
    for i in 0..3 {
        h.baglan();
        assert!(h.canli_mi());
        assert_eq!(h.pc.son_welcome_tam, Some(false), "tur {i}: artımlı");
        assert_eq!((h.c.kip().unwrap(), h.c.baglanti_durumu().unwrap().kuyrukta), (CalismaKipi::Bagli, 0));
        h.kopar();
        let baslik = format!("A{i}");
        h.c.duzenle("k_a".into(), None, govde(&baslik, Some(an("2026-11-26", "15:00")))).unwrap();
        assert!(h.c.kayit("k_a".into()).unwrap().unwrap().bekleyen);
    }
    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(false), "aynı servise yeni QR: aynı depo, artımlı");
    assert_eq!((h.c.kip().unwrap(), h.c.baglanti_durumu().unwrap().kuyrukta), (CalismaKipi::Bagli, 0));
    assert_eq!(h.pc.d.kayitlar["k_a"].baslik, "A2");
    let k = h.pc.disaridan_degistir("k_a", |k| k.baslik = "A (PC)".into());
    h.pc_degisti(k);
    assert_eq!(kayit(&h, "k_a").baslik, "A (PC)");
    assert_eq!(depo(&h).yerel_gecmis_sayisi("k_a").unwrap(), 0);
    assert_eq!(h.c.son_gecis().unwrap(), None);
}

const V1_DEPO: &str = include_str!("veri/v1_depo.sql");

/// Canlı kurulum, saklı `depo_id` yokken (ilk `welcome`): bugünkü gibi tam telafi, kip bağlı kalır, kuyruk
/// gider, geçiş olmaz.
#[test]
fn canli_kurulumda_depo_idsiz_ilk_welcome_bugunku_gibi() {
    let sql = format!("{V1_DEPO}\nDELETE FROM meta WHERE anahtar = 'depo_id';");
    let mut h = Hat::sql_depoyla("koruma-ilk", &sql);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    for k in depo(&h).sunucu_kayitlari().unwrap() {
        h.pc.d.rev = h.pc.d.rev.max(k.revizyon);
        h.pc.d.gecmis_izi.insert(k.revizyon, (k.kayit_id.clone(), k.guncelleme_ms));
        h.pc.d.kayitlar.insert(k.kayit_id.clone(), k);
    }
    h.pc.cihaz_public_key = Some(base64_yaz(&[4; 65]));
    assert_eq!(temel(&h).1, None);
    h.c.duzenle("k_disci".into(), None, govde("Dişçi (telefonda)", Some(an("2026-11-26", "15:00")))).unwrap();
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert_eq!((h.c.kip().unwrap(), h.c.baglanti_durumu().unwrap().kuyrukta), (CalismaKipi::Bagli, 0));
    assert_eq!(h.pc.d.kayitlar["k_disci"].baslik, "Dişçi (telefonda)");
    pc_ile_ayni(&h, &["k_disci"]);
    assert_eq!(temel(&h).1.as_deref(), Some("d_pc1"));
    assert_eq!(h.c.son_gecis().unwrap(), None);
    // Sonraki bağlantı artımlı.
    h.kopar();
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(false));
}
