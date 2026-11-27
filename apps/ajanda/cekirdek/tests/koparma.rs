//! D1 geçişleri uçtan uca (`YOL-HARITASI.md` 3.3 "Koparma", "Bağlanma"): köprünün açık yüzeyi + sahte
//! kabuklar + sahte PC (`ortak`).
//!
//! - Koparma (`baglantiyi_kopar`): bağlı kipten yerel kipe; görünen kopya o anki haliyle kalır, kuyruk atılır,
//!   ret listesi, PC temeli ve alarmlar kalır; eşleşme ve cihaz anahtarı gider; dönen sayılar doğrudur.
//! - Yerel kipten bağlanma: kip servisin tam kopyası gelene dek yerel kalır; `esitlendi`'de yerel kayıtlar
//!   fark olarak kuyruğa dökülür. Değişmez: her yerel kayıt ya görünen kopyada durur ya da ret listesine düşer.
//! - Canlı kurulum (eşleşmiş, bağlı kip) bu dilimden etkilenmez.

mod ortak;

use std::sync::Arc;

use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{BaglantiAsamasi, CalismaKipi, EslesmeDurumu, KoparmaSonucu};
use ajanda_cekirdek::model::kanonik::base64_yaz;
use ajanda_cekirdek::model::{AjandaAsagi, AjandaKaydi, AjandaRetNedeni, GirdiYolu, IslemTuru, KuyrukRetNedeni};
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

/// Değişmez: her canlı yerel kayıt ya görünen kopyada durur ya da ret listesindedir (PC'de hiç olmamış mezar
/// taşı gönderilmez; mezar taşları ayrıca denetlenir).
fn hicbiri_kaybolmadi(h: &Hat, yereller: &[AjandaKaydi]) {
    let ret = h.c.ret_listesi().unwrap();
    for k in yereller.iter().filter(|k| !k.silindi) {
        assert!(
            h.c.kayit(k.kayit_id.clone()).unwrap().is_some() || ret.iter().any(|r| r.kayit_id == k.kayit_id),
            "{} sessizce kayboldu",
            k.kayit_id
        );
    }
}

/// Bağlantıyı açar ve trafiği taşır, ama PC'nin `esitlendi`'sini telefona vermeden tutar (telafi sürüyor).
/// Döner: tutulan çerçeve.
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

#[test]
fn bagli_kipte_koparma_gorunen_kopyayi_yerel_gercek_yapar_sayilari_dondurur() {
    let mut h = Hat::yeni("kopar-bagli");
    h.pc.disaridan_ekle("k_pc", &govde("PC'den", Some(an("2026-11-26", "15:00"))), false);
    h.eslestir();
    assert!(h.canli_mi());
    // Ret listesinde bir işlem.
    h.pc.ekle_reddi = Some(AjandaRetNedeni::KayitSiniri);
    h.c.ekle(govde("Sığmayan", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    h.pc.ekle_reddi = None;
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 1);

    // Çevrimdışı: iki kayıtta üç işlem; bağlanınca ilki yollanır ama yanıtı gelmez (bağlantı açık).
    h.kopar();
    let a = h.c.ekle(govde("Kuaför", Some(an("2026-11-26", "11:00"))), GirdiYolu::Elle).unwrap();
    h.c.duzenle(a.clone(), None, govde("Kuaför (saç)", Some(an("2026-11-26", "12:00")))).unwrap();
    h.c.duzenle("k_pc".into(), None, govde("PC'den (telefonda)", Some(an("2026-11-26", "15:00")))).unwrap();
    h.pc.islem_yut = 1;
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 3);
    let once_gorunen = gorunenler(&h);
    assert!(h.c.kayit(a.clone()).unwrap().unwrap().bekleyen);
    let once_alarm = h.alarm.kurulular();
    assert_eq!(once_alarm, vec![(a.clone(), yarin(11)), ("k_pc".to_string(), yarin(14))]);
    let iptal_once = h.alarm.iptal_edilen.lock().unwrap().len();
    let once_temel = temel(&h);
    let once_ret = h.c.ret_listesi().unwrap();
    h.gozlemci.al();

    let s = h.c.baglantiyi_kopar().unwrap();
    assert_eq!(
        s,
        KoparmaSonucu {
            onceki_kip: CalismaKipi::Bagli,
            gonderilmeyen_kayit: 2,
            gonderilmeyen_islem: 3,
            yanitsiz_islem: 1,
            ret_listesinde: 1,
            baglanma_iptal: false,
        }
    );
    assert!(h.baglanti.as_ref().unwrap().tasima.kapatildi.lock().unwrap().is_some(), "açık bağlantı kapatıldı");
    h.pompala();
    assert!(h.baglanti.is_none());
    let d = h.gozlemci.al();
    assert!(d.iter().any(|d| d.tumu && d.eslesme && d.baglanti));

    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!((h.c.eslesme_durumu().unwrap(), h.c.baglanti_adresi().unwrap()), (EslesmeDurumu::Yok, None));
    assert_eq!(h.kimlik.silinen_anahtar.load(std::sync::atomic::Ordering::SeqCst), 1);
    let b = h.c.baglanti_durumu().unwrap();
    assert_eq!((b.asama, b.kuyrukta, b.ret_listesinde), (BaglantiAsamasi::Kopuk, 0, 1));
    assert!(depo(&h).kuyruk().unwrap().is_empty());
    // Görünen kopya aynen kaldı (bekleyen işlemler dahil), işaretler düştü; alarm planı, ret listesi, temel aynı.
    assert_eq!(gorunenler(&h), once_gorunen);
    assert!(once_gorunen.iter().all(|k| !h.c.kayit(k.kayit_id.clone()).unwrap().unwrap().bekleyen));
    assert_eq!(kayit(&h, "k_pc").baslik, "PC'den (telefonda)");
    assert_eq!(h.alarm.kurulular(), once_alarm);
    assert_eq!(h.alarm.iptal_edilen.lock().unwrap().len(), iptal_once);
    assert_eq!(h.c.ret_listesi().unwrap(), once_ret);
    assert_eq!(temel(&h), once_temel, "PC temeli kalır");

    // Artık yerel kip: yazma kuyruksuz ve kalıcı, revizyon PC'ninkilerin üstünden.
    h.c.duzenle(a.clone(), None, govde("Kuaför (sakal)", Some(an("2026-11-26", "12:00")))).unwrap();
    let g = h.c.kayit(a.clone()).unwrap().unwrap();
    assert!(!g.bekleyen && g.kayit.revizyon > once_temel.2);
    assert!(depo(&h).kuyruk().unwrap().is_empty());
    // Yinelenen çağrı etkisiz (yalnız anahtarı yeniden siler); süreç ölüp açılınca hal kalıcı.
    h.gozlemci.al();
    let s = h.c.baglantiyi_kopar().unwrap();
    assert_eq!((s.onceki_kip, s.gonderilmeyen_islem, s.ret_listesinde, s.baglanma_iptal), (CalismaKipi::Yerel, 0, 1, false));
    assert!(h.gozlemci.al().is_empty());
    let once = gorunenler(&h);
    h.sureci_oldur_ve_ac();
    assert_eq!((h.c.kip().unwrap(), gorunenler(&h)), (CalismaKipi::Yerel, once));
}

#[test]
fn koparip_baska_servise_baglanma_kayit_kaybettirmez() {
    let mut h = Hat::yeni("kopar-baska");
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.eslestir();
    let b = h.c.ekle(govde("B", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();

    // Yerelde: PC'den gelen kayıt düzenlendi, telefonda doğan silindi, yeni kayıt eklendi.
    h.c.duzenle("k_a".into(), None, govde("A (telefon)", Some(an("2026-11-26", "15:00")))).unwrap();
    h.c.sil(b.clone()).unwrap();
    let c = h.c.ekle(govde("C", None), GirdiYolu::SesliNot).unwrap();
    let yereller = gorunenler(&h);
    let once_temel = temel(&h);

    // Başka bir servis (başka `depo_id`): kendi kaydı ve aynı kimlikli bir `k_a` (başka halde) var.
    let mut pc2 = SahtePc::yeni("d_pc2", h.zaman.clone());
    pc2.disaridan_ekle("k_x", &govde("X", None), false);
    pc2.disaridan_ekle("k_a", &govde("A (PC2)", Some(an("2026-11-27", "10:00"))), false);
    h.pc = pc2;
    h.gozlemci.al();
    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();
    let tut = esitlendiye_dek_baglan(&mut h);
    // Tam kopya gelene dek kip yerel, görünen kopya ve temel aynı.
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!(h.c.baglanti_durumu().unwrap().asama, BaglantiAsamasi::Telafi);
    assert_eq!(gorunenler(&h), yereller);
    assert_eq!(temel(&h), once_temel);
    assert!(h.gozlemci.al().iter().all(|d| d.kayitlar.is_empty() && !d.tumu));
    tutulani_ver(&mut h, tut);

    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0), "hiçbir işlem reddedilmedi");
    hicbiri_kaybolmadi(&h, &yereller);
    for id in ["k_a", c.as_str(), "k_x"] {
        assert_eq!(&kayit(&h, id), &h.pc.d.kayitlar[id], "{id}: telefon ile PC2 aynı");
    }
    // Görünen kopya PC2'nin kopyasıyla değiştirilmedi: telefonun hali PC2'ye gitti.
    let ka = &h.pc.d.kayitlar["k_a"];
    assert_eq!((ka.baslik.as_str(), &ka.zaman), ("A (telefon)", &Some(an("2026-11-26", "15:00"))));
    // PC2'de hiç olmamış mezar taşı gönderilmez.
    assert!(!h.pc.d.kayitlar.contains_key(&b) && h.c.kayit(b.clone()).unwrap().is_none());
    assert_eq!(h.pc.d.kayitlar[&c].baslik, "C");
    assert_eq!(h.alarm.kurulular(), vec![("k_a".to_string(), yarin(14))]);
    assert_eq!(temel(&h).1.as_deref(), Some("d_pc2"));
}

#[test]
fn ayni_servise_yeniden_baglanma_uc_yollu_birlesir_silinmis_kayit_ret_listesine_duser() {
    let mut h = Hat::yeni("kopar-ayni");
    for (id, baslik) in [("k_a", "A"), ("k_p", "P"), ("k_o", "O")] {
        h.pc.disaridan_ekle(id, &govde(baslik, Some(an("2026-11-26", "15:00"))), false);
    }
    h.eslestir();

    // Servisin kabul ettiği ama `kayit`'i gelmemiş işlem (onaylanmış satır): koparmada PC temeline katılır.
    h.kopar();
    h.c.duzenle("k_o".into(), None, govde("O (telefon)", Some(an("2026-11-26", "15:00")))).unwrap();
    h.pc.islem_yut = 1;
    h.baglan();
    let yolda = depo(&h).kuyruk_yollananlar().unwrap().remove(0);
    let k = h.pc.disaridan_degistir("k_o", |k| k.baslik = "O (telefon)".into());
    let sonuc = AjandaAsagi::IslemSonucu {
        islem_id: yolda.islem_id,
        ok: true,
        kayit_id: Some("k_o".into()),
        rev: Some(k.revizyon),
        korunan_alanlar: None,
        code: None,
    };
    let nesil = h.baglanti.as_ref().unwrap().nesil;
    h.c.cerceve_geldi(nesil, sonuc.kodla()).unwrap();
    let s = h.c.baglantiyi_kopar().unwrap();
    assert_eq!((s.gonderilmeyen_kayit, s.gonderilmeyen_islem, s.yanitsiz_islem), (0, 0, 0), "onaylanan gönderilmiş sayılır");
    h.pompala();
    let ko = depo(&h).sunucu_kaydi("k_o").unwrap().unwrap();
    assert_eq!((ko.baslik.as_str(), ko.revizyon), ("O (telefon)", k.revizyon), "onaylanan temele katıldı");

    // Yerelde: A'nın başlığı, P'nin başlığı değişti; doğup silinen bir kayıt.
    h.c.duzenle("k_a".into(), None, govde("A (telefon)", Some(an("2026-11-26", "15:00")))).unwrap();
    h.c.duzenle("k_p".into(), None, govde("P (telefon)", Some(an("2026-11-26", "15:00")))).unwrap();
    let n = h.c.ekle(govde("Geçici", None), GirdiYolu::Elle).unwrap();
    h.c.sil(n.clone()).unwrap();
    let yereller = gorunenler(&h);

    // PC'de bu arada: A'nın zamanı değişti, P silindi, O'nun başlığı yeniden değişti, yeni kayıt Y.
    h.zaman.ilerlet(DK);
    h.pc.disaridan_degistir("k_a", |k| k.zaman = Some(an("2026-11-26", "17:00")));
    h.pc.disaridan_degistir("k_p", |k| k.silindi = true);
    h.pc.disaridan_degistir("k_o", |k| k.baslik = "O (PC son)".into());
    h.pc.disaridan_ekle("k_y", &govde("Y", None), false);

    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(true), "yerel kipte hello boş kopya gibi");
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    hicbiri_kaybolmadi(&h, &yereller);
    // Üç yollu: yalnız telefonda değişen alan gitti, PC'nin değiştirdiği zaman kaldı.
    let a = &h.pc.d.kayitlar["k_a"];
    assert_eq!((a.baslik.as_str(), &a.zaman), ("A (telefon)", &Some(an("2026-11-26", "17:00"))));
    // Onaylanmış değişiklik yeniden gitmedi: PC'nin sonraki başlığı ezilmedi.
    assert_eq!(h.pc.d.kayitlar["k_o"].baslik, "O (PC son)");
    // PC'de silinmiş kaydın düzenlemesi ret listesinde, düzeltme formuyla.
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 1);
    assert_eq!((ret[0].kayit_id.as_str(), ret[0].islem, ret[0].neden), ("k_p", IslemTuru::Guncelle, KuyrukRetNedeni::KayitSilinmis));
    assert_eq!(ret[0].govde.as_ref().unwrap().baslik, "P (telefon)");
    assert!(!h.pc.d.kayitlar.contains_key(&n) && h.c.kayit(n.clone()).unwrap().is_none(), "telefonda doğup silinen gönderilmedi");
    for id in ["k_a", "k_p", "k_o", "k_y"] {
        assert_eq!(&kayit(&h, id), &h.pc.d.kayitlar[id], "{id}: telefon ile PC aynı");
    }
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert_eq!(h.alarm.kurulular(), vec![("k_a".to_string(), yarin(16)), ("k_o".to_string(), yarin(14))]);
}

#[test]
fn baglanma_yarida_koparsa_hal_tutarli_sonraki_baglanti_bastan_dener_telafide_yazma_kaybolmaz() {
    let mut h = Hat::yeni("kopar-yarida");
    let l1 = h.c.ekle(govde("Yerel 1", Some(an("2026-11-26", "11:00"))), GirdiYolu::Elle).unwrap();
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.pc.disaridan_ekle("k_y", &govde("Y", Some(an("2026-11-27", "09:00"))), false);
    h.pc.telafi_kes = Some(1);
    let once_gorunen = gorunenler(&h);
    let once_alarm = h.alarm.kurulular();
    let once_temel = temel(&h);
    h.gozlemci.al();

    // Eşleşir, tam telafi bir kayıttan sonra kopar: kip yerel, hiçbir şey değişmedi, toplanan atıldı.
    h.eslestir();
    assert!(h.baglanti.is_none());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert!(matches!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Eslesti { .. }));
    assert_eq!((gorunenler(&h), h.alarm.kurulular(), temel(&h)), (once_gorunen.clone(), once_alarm.clone(), once_temel));
    assert!(h.alarm.iptal_edilen.lock().unwrap().is_empty());
    assert_eq!(telafi_sayisi(&h), 0);
    assert!(depo(&h).kuyruk().unwrap().is_empty());
    assert!(h.gozlemci.al().iter().all(|d| d.kayitlar.is_empty() && !d.tumu));

    // Kopukken yerel yazma kuyruksuz sürer.
    h.c.duzenle(l1.clone(), None, govde("Yerel 1 (düzeltildi)", Some(an("2026-11-26", "11:00")))).unwrap();
    assert!(!h.c.kayit(l1.clone()).unwrap().unwrap().bekleyen);
    assert!(depo(&h).kuyruk().unwrap().is_empty());

    // Sonraki bağlantı baştan (tam) dener; telafi sürerken yazılan yerel kayıt da gider.
    let tut = esitlendiye_dek_baglan(&mut h);
    assert_eq!(h.c.baglanti_durumu().unwrap().asama, BaglantiAsamasi::Telafi);
    let l2 = h.c.ekle(govde("Telafide yazıldı", None), GirdiYolu::Elle).unwrap();
    assert!(!h.c.kayit(l2.clone()).unwrap().unwrap().bekleyen, "kip hâlâ yerel");
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    let yereller = gorunenler(&h);
    tutulani_ver(&mut h, tut);
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.pc.telafi_sayisi, 2);
    hicbiri_kaybolmadi(&h, &yereller);
    for id in [l1.as_str(), l2.as_str(), "k_x", "k_y"] {
        assert_eq!(&kayit(&h, id), &h.pc.d.kayitlar[id], "{id}: telefon ile PC aynı");
    }
    assert_eq!(h.pc.d.kayitlar[&l1].baslik, "Yerel 1 (düzeltildi)");
    let mut beklenen = vec![("k_y".to_string(), yarin(8) + GUN), (l1, yarin(10))];
    beklenen.sort();
    assert_eq!(h.alarm.kurulular(), beklenen);
}

#[test]
fn yerel_kipte_koparma_suren_baglanmayi_iptal_eder_kayitlara_dokunmaz() {
    let mut h = Hat::yeni("kopar-yerel");
    h.c.ekle(govde("Yerel", Some(an("2026-11-26", "11:00"))), GirdiYolu::Elle).unwrap();
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    let once = (gorunenler(&h), h.alarm.kurulular(), temel(&h));

    // Bekleyen QR iptal edilir.
    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();
    let s = h.c.baglantiyi_kopar().unwrap();
    assert_eq!((s.onceki_kip, s.baglanma_iptal, s.gonderilmeyen_islem), (CalismaKipi::Yerel, true, 0));
    assert_eq!((h.c.eslesme_durumu().unwrap(), h.c.baglanti_adresi().unwrap()), (EslesmeDurumu::Yok, None));

    // Telafi sürerken: bağlantı kapanır, toplanan atılır, tutulan `esitlendi` artık yok sayılır.
    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();
    let tut = esitlendiye_dek_baglan(&mut h);
    let s = h.c.baglantiyi_kopar().unwrap();
    assert!(s.baglanma_iptal);
    assert!(h.baglanti.as_ref().unwrap().tasima.kapatildi.lock().unwrap().is_some());
    let nesil = h.baglanti.as_ref().unwrap().nesil;
    h.c.cerceve_geldi(nesil, tut).unwrap();
    h.pompala();
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!(telafi_sayisi(&h), 0);
    assert_eq!((gorunenler(&h), h.alarm.kurulular(), temel(&h)), once);
    assert_eq!((h.c.eslesme_durumu().unwrap(), h.c.baglanti_adresi().unwrap()), (EslesmeDurumu::Yok, None));
    assert!(depo(&h).kuyruk().unwrap().is_empty());
}

const V1_DEPO: &str = include_str!("veri/v1_depo.sql");

/// PC'yi fikstürün sunucu kopyasıyla aynı hale getirir (`yukseltme.rs`'teki gibi).
fn pc_fikstur_gibi(h: &mut Hat) {
    for k in depo(h).sunucu_kayitlari().unwrap() {
        h.pc.d.rev = h.pc.d.rev.max(k.revizyon);
        h.pc.d.gecmis_izi.insert(k.revizyon, (k.kayit_id.clone(), k.guncelleme_ms));
        h.pc.d.kayitlar.insert(k.kayit_id.clone(), k);
    }
    h.pc.cihaz_public_key = Some(base64_yaz(&[4; 65]));
}

/// Canlı kurulum: eşleşmiş telefon, bağlı kip (sürüm 1 fikstürü göç 4'ten geçer). Bağlanma artımlıdır
/// (`hello` sunucu kopyasının izini taşır), kip bağlı kalır, kuyruk bugünkü gibi gider, görünen kopya PC'yi
/// izler, yerel geçmiş yazılmaz. Koparma bu kurulumda da görünen kopyayı ve alarmları korur.
#[test]
fn canli_kurulum_bagli_kipte_aynen_calisir() {
    let mut h = Hat::sql_depoyla("kopar-canli", V1_DEPO);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    pc_fikstur_gibi(&mut h);
    let once_temel = temel(&h);
    assert!(once_temel.1.is_some() && once_temel.2 > 0);
    h.c.duzenle("k_disci".into(), None, govde("Dişçi (telefonda)", Some(an("2026-11-26", "15:00")))).unwrap();
    assert!(h.c.kayit("k_disci".into()).unwrap().unwrap().bekleyen);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 2);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.son_welcome_tam, Some(false), "bağlı kipte hello izi taşır: artımlı");
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert_eq!(h.pc.uygulanan.len(), 2);
    assert_eq!(kayit(&h, "k_disci"), h.pc.d.kayitlar["k_disci"]);
    assert_eq!(h.pc.d.kayitlar["k_disci"].baslik, "Dişçi (telefonda)");
    // Görünen kopya PC'yi izler (bağlı kipte türetmedir).
    let k = h.pc.disaridan_degistir("k_disci", |k| k.baslik = "Dişçi (PC)".into());
    h.pc_degisti(k);
    assert_eq!(kayit(&h, "k_disci").baslik, "Dişçi (PC)");
    assert_eq!(depo(&h).yerel_gecmis_sayisi("k_disci").unwrap(), 0);

    let once_gorunen = gorunenler(&h);
    let once_alarm = h.alarm.kurulular();
    let s = h.c.baglantiyi_kopar().unwrap();
    assert_eq!((s.onceki_kip, s.gonderilmeyen_islem), (CalismaKipi::Bagli, 0));
    h.pompala();
    assert_eq!((gorunenler(&h), h.alarm.kurulular()), (once_gorunen, once_alarm));
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
}
