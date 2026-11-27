//! Geçişlerin gözden geçirme bulguları uçtan uca (D1/D2 sonrası): köprünün açık yüzeyi + sahte kabuklar +
//! sahte PC (`ortak`).
//!
//! - Fark temeli servisin kopyasıyken (başka depo ya da temel kaydı bilmiyor) PC'de silinmiş kayıt
//!   diriltilmez; telefondaki farklı hali ret listesinde düzeltme gövdesiyle kalır (A → B → A).
//! - Aynı `depo_id`'li servis yedekten dönünce telefonun bildiği son onaylı hal PC'ye geri gider; PC'de meşru
//!   olarak ilerlemiş kayıt ezilmez (yerel kipten bağlanmada ve bağlı kipte).
//! - Temelsiz mezar taşı ve iki tarafta da silinmiş kayıt için hiçbir işlem gönderilmez.
//! - Yerelden bağlıya geçişte geçmiş önbelleği atılır.
//! - Okunamayan yerel kayıt geçişi kilitlemez, ret listesine düşer.
//! - Bağlı kip + eşleşme yok açılışta yerel kipe çevrilir.

mod ortak;

use std::sync::atomic::Ordering;

use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{CalismaKipi, EslesmeDurumu, GecisNedeni};
use ajanda_cekirdek::model::{AjandaAsagi, AjandaKaydi, GirdiYolu, IslemTuru, KuyrukRetNedeni};
use ortak::*;

fn depo(h: &Hat) -> Depo {
    Depo::ac(&h.yol).unwrap()
}

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

/// Telefon ile PC bu kayıtlarda aynı.
fn pc_ile_ayni(h: &Hat, idler: &[&str]) {
    for id in idler {
        assert_eq!(&kayit(h, id), &h.pc.d.kayitlar[*id], "{id}: telefon ile PC aynı");
    }
}

/// Değişmez: her canlı yerel kayıt ya görünen kopyada durur ya da ret listesindedir.
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

fn bitti(h: &Hat) {
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
}

/// Bulgu 1: A'ya bağlı → kopar → B'ye bağlan → kopar → yeniden A. Saklı temel B'nindir: A'nın kopyası fark
/// temelidir (iki yollu). A'da silinmiş kayıt diriltilmez: telefonda farklıysa hali ret listesinde düzeltme
/// gövdesiyle, aynıysa yalnız mezar taşı kalır.
#[test]
fn a_b_a_pc_de_silineni_diriltmez_telefondaki_farkli_hal_ret_listesinde() {
    let mut h = Hat::yeni("gecis-aba");
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_s", &govde("S", None), false);
    h.pc.disaridan_ekle("k_z", &govde("Z", None), false);
    h.pc.disaridan_ekle("k_d", &govde("D", None), false);
    h.eslestir();
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    h.c.duzenle("k_s".into(), None, govde("S (telefon)", None)).unwrap();

    // B'ye bağlan: B kayıtları bilmez, hepsi `ekle` ile gider. Sonra B'den de kopar.
    let mut pc_a = std::mem::replace(&mut h.pc, SahtePc::yeni("d_pc2", h.zaman.clone()));
    h.eslestir();
    bitti(&h);
    assert_eq!(h.pc.d.kayitlar["k_s"].baslik, "S (telefon)");
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    let yereller = depo(&h).gorunen_hepsi().unwrap();

    // Bu arada A'da: S (telefonda değişen) ve Z (telefonda aynı) silindi, A'nın zamanı değişti.
    h.zaman.ilerlet(DK);
    pc_a.disaridan_degistir("k_s", |k| k.silindi = true);
    pc_a.disaridan_degistir("k_z", |k| k.silindi = true);
    pc_a.disaridan_degistir("k_a", |k| k.zaman = Some(an("2026-11-26", "17:00")));
    h.pc = pc_a;
    h.eslestir();
    bitti(&h);
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    hicbiri_kaybolmadi(&h, &yereller);

    // Diriltilmedi: A'da ve telefonda mezar taşı.
    assert!(h.pc.d.kayitlar["k_s"].silindi && h.pc.d.kayitlar["k_z"].silindi);
    pc_ile_ayni(&h, &["k_a", "k_s", "k_z", "k_d"]);
    // Telefonun farklı hali kaybolmadı: düzeltme gövdesiyle ret listesinde (düzeltme yeni kayıt ekler).
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 1, "{ret:?}");
    assert_eq!((ret[0].kayit_id.as_str(), ret[0].islem, ret[0].neden), ("k_s", IslemTuru::Guncelle, KuyrukRetNedeni::KayitSilinmis));
    assert_eq!(ret[0].govde.as_ref().unwrap().baslik, "S (telefon)");
    // Bilinen sınır (D4, önizleme): temel servisin kopyasıyken hangi tarafın değiştirdiği bilinmez; telefonun
    // farklı alanı gider. A'nın önceki değeri A'nın geçmişindedir.
    assert_eq!(h.pc.d.kayitlar["k_a"].zaman, Some(an("2026-11-26", "15:00")));
}

/// Bulgu 2, yerel kipten bağlanma: aynı servis yedekten döndü. PC'nin yitirdiği onaylı haller (başlık
/// değişikliği, yeni kayıt) geri gider; telefonun yerel değişikliği gider; PC'de yedekten sonra meşru
/// olarak ilerlemiş kayıt (revizyon büyük) üç yolludur: telefonun dokunmadığı alan ezilmez.
#[test]
fn yerelden_baglanirken_yedekten_donen_pc_ye_son_onayli_hal_geri_gider() {
    let mut h = Hat::yeni("gecis-yedek-yerel");
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_b", &govde("B", None), false);
    h.pc.disaridan_ekle("k_c", &govde("C", None), false);
    h.eslestir();
    let yedek = h.pc.d.clone();
    h.zaman.ilerlet(DK);
    let k = h.pc.disaridan_degistir("k_b", |k| k.baslik = "B (PC son)".into());
    h.pc_degisti(k);
    let k = h.pc.disaridan_ekle("k_n", &govde("N", None), false);
    h.pc_degisti(k);
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    h.c.duzenle("k_c".into(), None, govde("C (telefon)", None)).unwrap();
    let yereller = depo(&h).gorunen_hepsi().unwrap();

    h.pc.d = yedek;
    h.zaman.ilerlet(DK);
    h.pc.disaridan_degistir("k_a", |k| k.zaman = Some(an("2026-11-26", "17:00")));
    h.eslestir();
    bitti(&h);
    hicbiri_kaybolmadi(&h, &yereller);
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
    assert_eq!(h.pc.d.kayitlar["k_b"].baslik, "B (PC son)", "yitirilen onaylı hal geri gitti");
    assert_eq!(h.pc.d.kayitlar["k_n"].baslik, "N", "yitirilen kayıt geri gitti");
    assert_eq!(h.pc.d.kayitlar["k_c"].baslik, "C (telefon)");
    let a = &h.pc.d.kayitlar["k_a"];
    assert_eq!((a.baslik.as_str(), &a.zaman), ("A", &Some(an("2026-11-26", "17:00"))), "PC'de ilerlemiş alan ezilmedi");
    pc_ile_ayni(&h, &["k_a", "k_b", "k_c", "k_n"]);
}

/// Bulgu 2, bağlı kip: aynı `depo_id`'nin tam telafisinde PC'nin yitirdiği haller (canlı gelmiş başlık,
/// onaylanmış ama `kayit`'i gelmemiş işlem) bekleyen işlemin önüne fark olarak girer; PC'de meşru olarak
/// ilerlemiş kayıt taze kopyadan gelir.
#[test]
fn bagli_kipte_ayni_depo_tam_telafisinde_onayli_hal_geri_gider() {
    let mut h = Hat::yeni("gecis-yedek-bagli");
    h.pc.disaridan_ekle("k_a", &govde("A", None), false);
    h.pc.disaridan_ekle("k_b", &govde("B", None), false);
    h.pc.disaridan_ekle("k_c", &govde("C", None), false);
    h.eslestir();
    let yedek = h.pc.d.clone();
    h.zaman.ilerlet(DK);
    let k = h.pc.disaridan_degistir("k_b", |k| k.baslik = "B2".into());
    h.pc_degisti(k);
    // Onaylanmış satır: PC uyguladı, sonucu geldi, `kayit`'i gelmeden bağlantı koptu.
    h.pc.islem_yut = 1;
    h.c.duzenle("k_c".into(), None, govde("C (telefon)", None)).unwrap();
    h.pompala();
    let yolda = depo(&h).kuyruk_yollananlar().unwrap().remove(0);
    let k = h.pc.disaridan_degistir("k_c", |k| k.baslik = "C (telefon)".into());
    let sonuc = AjandaAsagi::IslemSonucu { islem_id: yolda.islem_id, ok: true, kayit_id: Some("k_c".into()), rev: Some(k.revizyon), korunan_alanlar: None, code: None };
    let nesil = h.baglanti.as_ref().unwrap().nesil;
    h.c.cerceve_geldi(nesil, sonuc.kodla()).unwrap();
    assert!(depo(&h).kuyruk().unwrap()[0].bekledigi_rev.is_some());
    h.kopar();
    // Çevrimdışı: B2 üstüne zaman (bekleyen).
    h.c.duzenle("k_b".into(), None, govde("B2", Some(an("2026-11-27", "10:00")))).unwrap();
    let yereller = depo(&h).gorunen_hepsi().unwrap();

    h.pc.d = yedek;
    h.zaman.ilerlet(DK);
    h.pc.disaridan_degistir("k_a", |k| k.baslik = "A (PC)".into());
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    bitti(&h);
    hicbiri_kaybolmadi(&h, &yereller);
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
    let b = &h.pc.d.kayitlar["k_b"];
    assert_eq!((b.baslik.as_str(), &b.zaman), ("B2", &Some(an("2026-11-27", "10:00"))), "yitirilen başlık + bekleyen zaman");
    assert_eq!(h.pc.d.kayitlar["k_c"].baslik, "C (telefon)", "onaylanmış ama yitirilen işlem geri gitti");
    assert_eq!(h.pc.d.kayitlar["k_a"].baslik, "A (PC)", "PC'de meşru ilerleyen kayıt ezilmedi");
    pc_ile_ayni(&h, &["k_a", "k_b", "k_c"]);
    // Sonraki bağlantı artımlı.
    h.kopar();
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(false));
}

/// Bulgu 3: iki tarafta da silinmiş kayıt (alanları farklı) ve telefonda doğup silinmiş kayıt için PC'ye
/// hiçbir işlem gitmez; anlamsız `kayit_silinmis` reddi olmaz.
#[test]
fn iki_tarafta_silinmis_ve_temelsiz_mezar_tasi_gonderilmez() {
    let mut h = Hat::yeni("gecis-mezar");
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.pc.disaridan_ekle("k_y", &govde("Y", None), false);
    h.eslestir();
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    h.c.duzenle("k_x".into(), None, govde("X (telefon)", None)).unwrap();
    h.c.sil("k_x".into()).unwrap();
    let n = h.c.ekle(govde("Geçici", None), GirdiYolu::Elle).unwrap();
    h.c.sil(n.clone()).unwrap();
    h.pc.disaridan_degistir("k_x", |k| {
        k.baslik = "X (PC)".into();
        k.silindi = true;
    });
    let once = h.pc.uygulanan.len();
    h.eslestir();
    bitti(&h);
    assert_eq!(h.pc.uygulanan.len(), once, "hiçbir işlem gitmedi");
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
    pc_ile_ayni(&h, &["k_x", "k_y"]);
    assert_eq!(kayit(&h, "k_x").baslik, "X (PC)");
    assert!(!h.pc.d.kayitlar.contains_key(&n) && h.c.kayit(n).unwrap().is_none());
}

/// Bulgu 4: yerel kipte açılmış geçmiş sayfası bağlanınca atılır (gözlemciye `gecmis`); sonraki istek PC'nin
/// geçmişini getirir, iki kaynağın satırları karışmaz.
#[test]
fn yerelden_bagliya_geciste_gecmis_onbellegi_atilir() {
    let mut h = Hat::yeni("gecis-gecmis");
    let a = h.c.ekle(govde("Dişçi", None), GirdiYolu::Elle).unwrap();
    h.c.duzenle(a.clone(), None, govde("Dişçi (kontrol)", None)).unwrap();
    h.c.gecmis_iste(a.clone(), None).unwrap();
    assert_eq!(h.c.gecmis(a.clone()).unwrap().unwrap().satirlar.len(), 2, "yerel geçmiş");
    h.gozlemci.al();
    h.eslestir();
    bitti(&h);
    assert!(h.gozlemci.al().iter().any(|d| d.gecmis.contains(&a)), "açık sayfa için gecmis bildirildi");
    assert_eq!(h.c.gecmis(a.clone()).unwrap(), None, "yerel önbellek atıldı");
    h.c.gecmis_iste(a.clone(), None).unwrap();
    h.pompala();
    let s = h.c.gecmis(a.clone()).unwrap().unwrap();
    let pc: Vec<i64> = h.pc.d.gecmis[&a].iter().map(|g| g.rev).collect();
    assert_eq!(s.satirlar.iter().map(|r| r.rev).collect::<Vec<_>>(), pc, "yalnız PC'nin satırları");
}

/// Bulgu 5: okunamayan yerel kayıt geçişi kilitlemez: bağlantı canlı olur, öteki kayıtlar gider, bozuk kayıt
/// kaybolmadan (satır metni ve gövdesiyle) ret listesine düşer.
#[test]
fn bozuk_yerel_kayit_gecisi_kilitlemez_ret_listesine_duser() {
    let mut h = Hat::yeni("gecis-bozuk");
    let a = h.c.ekle(govde("Sağlam", None), GirdiYolu::Elle).unwrap();
    let x = h.c.ekle(govde("Bozuk", Some(an("2026-11-26", "11:00"))), GirdiYolu::Elle).unwrap();
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    let json: String = db.query_row("SELECT json FROM gorunen WHERE kayit_id = ?1", [&x], |s| s.get(0)).unwrap();
    let mut v: serde_json::Value = serde_json::from_str(&json).unwrap();
    v.as_object_mut().unwrap().remove("kaynak");
    let bozuk = v.to_string();
    db.execute("UPDATE gorunen SET json = ?2 WHERE kayit_id = ?1", [&x, &bozuk]).unwrap();
    drop(db);
    h.gozlemci.al();

    h.eslestir();
    bitti(&h);
    assert!(h.gozlemci.al().iter().any(|d| d.ret_listesi));
    pc_ile_ayni(&h, &[a.as_str()]);
    assert!(!h.pc.d.kayitlar.contains_key(&x));
    assert_eq!(h.c.kayit(x.clone()).unwrap(), None);
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 1);
    assert_eq!((ret[0].kayit_id.as_str(), ret[0].neden), (x.as_str(), KuyrukRetNedeni::TutarsizKayit));
    let g = ret[0].govde.as_ref().expect("düzeltme gövdesi");
    assert_eq!((g.baslik.as_str(), &g.zaman), ("Bozuk", &Some(an("2026-11-26", "11:00"))));
    assert_eq!(depo(&h).ret_listesi().unwrap()[0].islem_json, bozuk, "satır metni olduğu gibi saklı");
    // Sonraki bağlantılar olağan.
    h.kopar();
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 1);
}

/// Bulgu 7: bağlı kip + eşleşme yok (eski sürümün eşleşme kaldırması) çıkışsızdı. Açılışta yerel kipe veri
/// kaybısız geçilir: görünen kopya (bekleyen işlem dahil) yerel gerçek olur, özet `EslesmeKaldirildi`.
/// Bekleyen QR kalır; eşleşince yerel kipten bağlanma olarak sürer.
#[test]
fn bagli_kip_eslesmesiz_acilista_yerel_kipe_doner() {
    let mut h = Hat::yeni("gecis-cikissiz");
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.eslestir();
    h.kopar();
    h.c.duzenle("k_a".into(), None, govde("A (telefon)", Some(an("2026-11-26", "15:00")))).unwrap();
    let gorunen = depo(&h).gorunen_hepsi().unwrap();
    let alarmlar = h.alarm.kurulular();
    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();
    rusqlite::Connection::open(&h.yol).unwrap().execute("DELETE FROM meta WHERE anahtar = 'eslesme'", []).unwrap();
    h.sureci_oldur_ve_ac();

    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert!(depo(&h).kuyruk().unwrap().is_empty());
    assert_eq!(depo(&h).gorunen_hepsi().unwrap(), gorunen);
    assert!(!h.c.kayit("k_a".into()).unwrap().unwrap().bekleyen);
    assert_eq!(h.alarm.kurulular(), alarmlar);
    let g = h.c.son_gecis().unwrap().unwrap();
    assert_eq!((g.neden, g.koparma.gonderilmeyen_islem), (GecisNedeni::EslesmeKaldirildi, 1));
    assert!(matches!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Bekliyor { .. }), "bekleyen QR kaldı");
    // Yeniden açılış bir şey değiştirmez.
    h.sureci_oldur_ve_ac();
    assert_eq!(h.c.son_gecis().unwrap().unwrap(), g);

    h.baglan();
    bitti(&h);
    assert_eq!(h.pc.d.kayitlar["k_a"].baslik, "A (telefon)");
    pc_ile_ayni(&h, &["k_a"]);
    assert_eq!(h.kimlik.silinen_anahtar.load(Ordering::SeqCst), 0);
}
