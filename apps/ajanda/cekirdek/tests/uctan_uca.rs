//! R4 uçtan uca senaryoları: köprünün açık yüzeyi (`Cekirdek`) + sahte kabuklar + sahte PC servisi
//! (`ortak`). Her test bir kullanıcı vaadini sabitler: çevrimdışı iş sessizce kaybolmaz, telefon ile PC
//! sessizce ayrışmaz, hatırlatma PC'den bağımsız doğru kurulur.

mod ortak;

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{BaglantiAsamasi, CalismaKipi, EslesmeDurumu, KayitGorunumu, ListeSorgusu, Sekme, YenidenKurmaNedeni};
use ajanda_cekirdek::model::{
    AjandaKanalHatasi, AjandaZamani, GirdiYolu, Hatirlatma, IslemTuru, KayitDurumu, KayitGovdesi, KuyrukRetNedeni,
};
use ortak::*;

fn liste(h: &Hat, sekme: Sekme, kapalilar_dahil: bool) -> Vec<KayitGorunumu> {
    h.c.liste(ListeSorgusu { sekme, kapalilar_dahil }).unwrap()
}

fn basliklar(l: &[KayitGorunumu]) -> Vec<String> {
    l.iter().map(|g| g.kayit.baslik.clone()).collect()
}

/// Eşleşmiş, ilk eşitlemesi bitmiş hat.
fn eslesmis(ad: &str) -> Hat {
    let mut h = Hat::yeni(ad);
    h.eslestir();
    assert!(h.canli_mi());
    h.gozlemci.al();
    h
}

#[test]
fn eslestirme_el_sikisma_ve_ilk_tam_esitleme() {
    let mut h = Hat::yeni("eslestirme");
    assert_eq!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Yok);
    assert_eq!(h.c.baglanti_adresi().unwrap(), None);
    // Eşleşme yokken bağlantı açılamaz (Kotlin soketi kapatır).
    let t = std::sync::Arc::new(SahteTasima::default());
    assert!(matches!(h.c.baglanti_acildi(t.clone()), Err(CekirdekHatasi::Eslesme { .. })));
    assert!(t.giden.lock().unwrap().is_empty());

    // PC'de önceden üç kayıt: biri silinmiş, biri taslak.
    h.pc.disaridan_ekle("k_dis", &govde("Dişçi", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_tas", &govde("Taslak toplantı", Some(an("2026-11-27", "10:00"))), true);
    let k = h.pc.disaridan_ekle("k_sil", &govde("Eski", None), false);
    h.pc.disaridan_degistir(&k.kayit_id, |k| k.silindi = true);

    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();
    assert_eq!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Bekliyor { host: "100.64.0.1".into(), port: 8787 });
    assert_eq!(h.c.baglanti_adresi().unwrap().as_deref(), Some("ws://100.64.0.1:8787/ajanda"));
    h.baglan();

    assert_eq!(
        h.c.eslesme_durumu().unwrap(),
        EslesmeDurumu::Eslesti { device_id: CIHAZ.into(), host: "100.64.0.1".into(), port: 8787 }
    );
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!(d.asama, BaglantiAsamasi::Canli);
    assert_eq!((d.kuyrukta, d.ret_listesinde, d.son_hata), (0, 0, None));
    assert_eq!(d.son_esitlenme_ms, Some(SIMDI));
    assert_eq!(h.pc.son_welcome_tam, Some(true), "depo kimliği yok: tam telafi");

    assert_eq!(basliklar(&liste(&h, Sekme::Tarihli, false)), vec!["Dişçi", "Taslak toplantı"]);
    assert_eq!(basliklar(&liste(&h, Sekme::Taslaklar, false)), vec!["Taslak toplantı"]);
    assert_eq!(basliklar(&liste(&h, Sekme::Silinenler, false)), vec!["Eski"]);
    assert!(liste(&h, Sekme::Tarihsiz, true).is_empty(), "mezar taşı Silinenler dışında gelmez");
    // Yalnız etkin kaydın hatırlatması kurulur (taslak kurulmaz): yarın 15:00'ten 1 saat önce.
    assert_eq!(h.alarm.kurulular(), vec![("k_dis".to_string(), bugun(14, 0) + GUN)]);
    let degisim = h.gozlemci.al();
    assert!(degisim.iter().any(|d| d.eslesme) && degisim.iter().any(|d| d.tumu));

    // Yeniden bağlanınca artımlı (iz tutuyor), hiçbir kayıt yeniden gelmez, gözlemci kayıt değişimi görmez.
    h.kopar();
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(false));
    assert!(h.gozlemci.al().iter().all(|d| d.kayitlar.is_empty() && !d.tumu));
}

#[test]
fn eslestirme_reddi_ve_pc_imzasi_gecersiz() {
    let mut h = Hat::yeni("ret");
    let mut qr = SahtePc::qr();
    qr.kod = "YANLIS1".into();
    h.c.eslestirme_baslat(qr).unwrap();
    h.baglan();
    assert_eq!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Reddedildi { kod: AjandaKanalHatasi::EslestirmeKoduGecersiz });
    assert_eq!(h.c.baglanti_adresi().unwrap(), None);
    assert!(h.baglanti.is_none());

    // Doğru kodla eşleşir; sonra PC'nin anahtarı QR'dakiyle tutmazsa (sahte imza ters değil) kapanır.
    h.eslestir();
    assert!(h.canli_mi());
    h.kopar();
    let t = std::sync::Arc::new(SahteTasima::default());
    let nesil = h.c.baglanti_acildi(t.clone()).unwrap();
    assert!(t.giden.lock().unwrap()[0].contains("\"hello\""));
    let sahte = ajanda_cekirdek::model::AjandaAsagi::AuthChallenge {
        server_nonce: ajanda_cekirdek::model::kanonik::base64_yaz(&[1; 32]),
        server_signature: ajanda_cekirdek::model::kanonik::base64_yaz(b"imza degil"),
    };
    h.c.cerceve_geldi(nesil, sahte.kodla()).unwrap();
    assert!(t.kapatildi.lock().unwrap().is_some());
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.asama, d.son_hata), (BaglantiAsamasi::Kopuk, Some(AjandaKanalHatasi::ImzaGecersiz)));
    // Kapanırken gelen başka çerçeve yok sayılır.
    h.c.cerceve_geldi(nesil, ajanda_cekirdek::model::AjandaAsagi::Esitlendi { rev: 1 }.kodla()).unwrap();
    h.c.baglanti_kapandi(nesil, None).unwrap();
    assert_eq!(h.c.baglanti_durumu().unwrap().asama, BaglantiAsamasi::Kopuk);
}

fn kurulu_alarm_satirlari(h: &Hat) -> Vec<(String, i64)> {
    let d = Depo::ac(&h.yol).unwrap();
    let mut l: Vec<(String, i64)> = d.tum_kurulu_alarmlar().unwrap().into_iter().map(|a| (a.kayit_id, a.tetik_ms)).collect();
    l.sort();
    l
}

fn yarin(saat: i64) -> i64 {
    bugun(saat, 0) + GUN
}

fn asagi(m: ajanda_cekirdek::model::AjandaAsagi) -> String {
    m.kodla()
}

#[test]
fn kismi_telafi_canli_kayit_ve_gozlemci_bir_kez() {
    let mut h = eslesmis("kismi");
    h.kopar();
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_b", &govde("B", None), false);
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(false), "aynı depo, iz tutuyor: artımlı");
    assert_eq!(basliklar(&liste(&h, Sekme::Tarihli, false)), vec!["A"]);
    assert_eq!(basliklar(&liste(&h, Sekme::Tarihsiz, false)), vec!["B"]);
    assert_eq!(h.alarm.kurulular(), vec![("k_a".to_string(), yarin(14))]);
    let d = h.gozlemci.al();
    let mut kayitlar: Vec<String> = d.iter().flat_map(|d| d.kayitlar.clone()).collect();
    kayitlar.sort();
    assert_eq!(kayitlar, vec!["k_a", "k_b"], "her kayıt bir kez");

    // Canlı değişiklik: tek gözlemci bildirimi, alarm yeni tetiğe taşınır.
    let k = h.pc.disaridan_degistir("k_a", |k| k.zaman = Some(an("2026-11-26", "17:00")));
    h.pc_degisti(k.clone());
    let d = h.gozlemci.al();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].kayitlar, vec!["k_a"]);
    assert_eq!(h.alarm.kurulular(), vec![("k_a".to_string(), yarin(16))]);
    assert_eq!(h.c.kayit("k_a".into()).unwrap().unwrap().kayit, k);
    // Aynı (ya da eski) revizyon yeniden gelirse hiçbir şey değişmez, bildirim yok.
    let nesil = h.baglanti.as_ref().unwrap().nesil;
    h.c.cerceve_geldi(nesil, asagi(ajanda_cekirdek::model::AjandaAsagi::Kayit { kayit: k })).unwrap();
    assert!(h.gozlemci.al().is_empty());
}

#[test]
fn cevrimdisi_islemler_baglaninca_sirayla_gider() {
    let mut h = eslesmis("cevrimdisi");
    h.kopar();
    h.gozlemci.al();
    let id = h.c.ekle(govde("Kuaför", Some(an("2026-11-26", "11:00"))), GirdiYolu::Elle).unwrap();
    let d = h.gozlemci.al();
    assert_eq!(d.len(), 1, "değişiklikte tek bildirim");
    assert_eq!(d[0].kayitlar, vec![id.clone()]);
    let g = h.c.kayit(id.clone()).unwrap().unwrap();
    assert!(g.bekleyen);
    assert_eq!((g.kayit.revizyon, g.kayit.kaynak.device_id.as_deref()), (1, Some(CIHAZ)));
    assert_eq!(h.alarm.kurulular(), vec![(id.clone(), yarin(10))], "PC'siz kurulur");

    h.c.duzenle(id.clone(), None, govde("Kuaför (saç)", Some(an("2026-11-26", "12:00")))).unwrap();
    assert_eq!(h.c.kayit(id.clone()).unwrap().unwrap().kayit.baslik, "Kuaför (saç)");
    assert_eq!(h.alarm.kurulular(), vec![(id.clone(), yarin(11))]);
    // Fark yoksa düzenleme kuyruğa girmez.
    h.c.duzenle(id.clone(), None, govde("Kuaför (saç)", Some(an("2026-11-26", "12:00")))).unwrap();

    h.c.durum_degistir(id.clone(), KayitDurumu::Tamam, None).unwrap();
    assert!(h.alarm.kurulular().is_empty(), "tamamlanınca iptal");
    assert!(liste(&h, Sekme::Tarihli, false).is_empty());
    assert_eq!(basliklar(&liste(&h, Sekme::Tarihli, true)), vec!["Kuaför (saç)"]);
    h.gozlemci.al();
    h.c.durum_degistir(id.clone(), KayitDurumu::Tamam, None).unwrap();
    assert!(h.gozlemci.al().is_empty(), "yan etkisiz işlem: bildirim yok");
    h.c.durum_degistir(id.clone(), KayitDurumu::Acik, None).unwrap();
    assert_eq!(h.alarm.kurulular(), vec![(id.clone(), yarin(11))], "geri alınınca yeniden kurulur");

    let id2 = h.c.ekle(govde("Silinecek", Some(an("2026-11-26", "18:00"))), GirdiYolu::SesliNot).unwrap();
    h.c.sil(id2.clone()).unwrap();
    assert_eq!(basliklar(&liste(&h, Sekme::Silinenler, false)), vec!["Silinecek"]);
    assert_eq!(h.alarm.kurulular(), vec![(id.clone(), yarin(11))]);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 6);
    // Mezar taşına geri yükleme dışında işlem yapılamaz.
    assert!(matches!(h.c.durum_degistir(id2.clone(), KayitDurumu::Tamam, None), Err(CekirdekHatasi::GecersizDurum { .. })));
    assert!(matches!(h.c.onayla("k_yok".into()), Err(CekirdekHatasi::KayitYok { .. })));

    h.baglan();
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.asama, d.kuyrukta, d.ret_listesinde), (BaglantiAsamasi::Canli, 0, 0));
    assert_eq!(h.pc.uygulanan.len(), 6, "her işlem bir kez, sırayla");
    for kid in [&id, &id2] {
        let g = h.c.kayit(kid.clone()).unwrap().unwrap();
        assert!(!g.bekleyen);
        assert_eq!(g.kayit, h.pc.d.kayitlar[kid], "telefon ile PC aynı");
    }
    assert_eq!(h.pc.d.kayitlar[&id].baslik, "Kuaför (saç)");
    assert_eq!(h.pc.d.kayitlar[&id].durum, KayitDurumu::Acik);
    assert!(h.pc.d.kayitlar[&id2].silindi);
    assert_eq!(h.alarm.kurulular(), vec![(id.clone(), yarin(11))]);
    assert_eq!(kurulu_alarm_satirlari(&h), vec![(id, yarin(11))]);
}

#[test]
fn sonuc_kayittan_once_gelirse_gorunen_kayit_kaybolmaz() {
    let mut h = eslesmis("sira");
    h.pc.sonuc_once = true;
    let id = h.c.ekle(govde("Sıra", None), GirdiYolu::Elle).unwrap();
    let b = h.baglanti.as_mut().unwrap();
    let giden: Vec<String> = std::mem::take(&mut *b.tasima.giden.lock().unwrap());
    assert_eq!(giden.len(), 1);
    let cikti = h.pc.isle(&mut b.pc, &giden[0]);
    assert_eq!(cikti.cerceveler.len(), 2);
    let nesil = b.nesil;
    h.c.cerceve_geldi(nesil, cikti.cerceveler[0].clone()).unwrap();
    let g = h.c.kayit(id.clone()).unwrap().expect("sonuç geldi, kayıt henüz gelmedi: iyimser hal durur");
    assert!(!g.bekleyen);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    h.c.cerceve_geldi(nesil, cikti.cerceveler[1].clone()).unwrap();
    assert_eq!(h.c.kayit(id.clone()).unwrap().unwrap().kayit, h.pc.d.kayitlar[&id]);
    assert!(Depo::ac(&h.yol).unwrap().kuyruk().unwrap().is_empty(), "onaylanmış satır kayıtla düştü");
}

#[test]
fn gecici_ret_yeniden_dener_sinirdan_sonra_ret_listesi_arkasi_gider() {
    let mut h = eslesmis("gecici");
    h.pc.ic_hata.insert("*".into(), 2);
    let id = h.c.ekle(govde("Bir", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert!(h.pc.d.kayitlar.contains_key(&id));

    let id2 = h.c.ekle(govde("Hep hata", Some(an("2026-11-26", "09:00"))), GirdiYolu::Elle).unwrap();
    h.pc.ic_hata.insert(id2.clone(), 100);
    let id3 = h.c.ekle(govde("Arkadaki", None), GirdiYolu::Elle).unwrap();
    assert_eq!(h.alarm.kurulular(), vec![(id2.clone(), yarin(8))]);
    h.gozlemci.al();
    h.pompala();
    assert!(!h.pc.d.kayitlar.contains_key(&id2));
    assert!(h.pc.d.kayitlar.contains_key(&id3), "tek işlem kuyruğu tıkayamaz");
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 1);
    assert_eq!((ret[0].kayit_id.as_str(), ret[0].islem, ret[0].neden), (id2.as_str(), IslemTuru::Ekle, KuyrukRetNedeni::IcHata));
    assert_eq!(ret[0].govde.as_ref().unwrap().baslik, "Hep hata", "düzeltme formu için içerik");
    assert_eq!(h.c.kayit(id2.clone()).unwrap(), None, "iyimser ekleme geri alındı");
    assert!(h.alarm.kurulular().is_empty(), "alarmı da");
    let d = h.gozlemci.al();
    assert!(d.iter().any(|d| d.ret_listesi));
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 1);

    h.c.ret_at(ret[0].islem_id.clone()).unwrap();
    assert!(h.c.ret_listesi().unwrap().is_empty());
    assert!(h.gozlemci.al().iter().any(|d| d.ret_listesi));
}

#[test]
fn kalici_ret_iyimser_degisikligi_geri_alir_kullaniciya_gorunur() {
    let mut h = eslesmis("kalici");
    let k = h.pc.disaridan_ekle("k_top", &govde("Toplantı", Some(an("2026-11-26", "15:00"))), false);
    h.pc_degisti(k);
    h.kopar();
    // PC'de silinirken telefon çevrimdışı düzenler.
    h.pc.disaridan_degistir("k_top", |k| k.silindi = true);
    h.c.duzenle("k_top".into(), None, govde("Toplantı (ertelendi)", Some(an("2026-11-27", "15:00")))).unwrap();
    assert_eq!(h.alarm.kurulular(), vec![("k_top".to_string(), yarin(14) + GUN)]);
    // Ayrıca reddedilecek bir ekleme.
    h.pc.ekle_reddi = Some(ajanda_cekirdek::model::AjandaRetNedeni::KayitSiniri);
    let id = h.c.ekle(govde("Sığmayan", None), GirdiYolu::Elle).unwrap();
    h.baglan();

    let k = h.c.kayit("k_top".into()).unwrap().unwrap();
    assert!(k.kayit.silindi && !k.bekleyen);
    assert_eq!(k.kayit, h.pc.d.kayitlar["k_top"]);
    assert!(h.alarm.kurulular().is_empty());
    assert_eq!(h.c.kayit(id.clone()).unwrap(), None);
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 2);
    assert_eq!((ret[0].islem, ret[0].neden), (IslemTuru::Guncelle, KuyrukRetNedeni::KayitSilinmis));
    assert_eq!(ret[0].govde.as_ref().unwrap().baslik, "Toplantı (ertelendi)", "istenen hal görünür");
    assert_eq!((ret[1].islem, ret[1].neden, ret[1].kayit_id.as_str()), (IslemTuru::Ekle, KuyrukRetNedeni::KayitSiniri, id.as_str()));
}

#[test]
fn kuyrugun_basindaki_bozuk_islem_arkasini_tikamaz() {
    let mut h = eslesmis("bozuk");
    h.kopar();
    let a = h.c.ekle(govde("Bozuk", None), GirdiYolu::Elle).unwrap();
    let b = h.c.ekle(govde("Sağlam", None), GirdiYolu::Elle).unwrap();
    h.pc.gecersiz.insert(a.clone());
    h.baglan();
    assert!(h.pc.d.kayitlar.contains_key(&b));
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.iter().map(|r| (r.kayit_id.clone(), r.neden)).collect::<Vec<_>>(), vec![(a.clone(), KuyrukRetNedeni::GecersizIslem)]);
    assert_eq!(h.c.kayit(a).unwrap(), None);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
}

#[test]
fn yaniti_gelmeden_kopan_islem_kaybolmaz_cift_uygulanmaz() {
    let mut h = eslesmis("kopma");
    h.pc.yanitsiz_kopar = 1;
    let id = h.c.ekle(govde("Yolda", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    assert!(h.baglanti.is_none(), "PC uyguladı, yanıt gelmeden koptu");
    let g = h.c.kayit(id.clone()).unwrap().unwrap();
    assert!(g.bekleyen, "iyimser hal durur");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 1);
    h.baglan();
    assert_eq!(h.pc.uygulanan.len(), 1, "aynı islem_id: servis ikinci kez uygulamaz");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert_eq!(h.c.kayit(id.clone()).unwrap().unwrap().kayit, h.pc.d.kayitlar[&id]);

    // Tam telafi de yolda kalan işlemi atmaz: yeniden gider.
    h.pc.yanitsiz_kopar = 1;
    h.c.duzenle(id.clone(), None, govde("Yolda (2)", None)).unwrap();
    h.pompala();
    assert!(h.baglanti.is_none());
    h.pc.d.depo_id = "d_pc_yeni".into();
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert_eq!(h.pc.uygulanan.len(), 2);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert_eq!(h.c.kayit(id.clone()).unwrap().unwrap().kayit.baslik, "Yolda (2)");
}

#[test]
fn hep_kopan_islem_sinirda_teslim_edilemedi() {
    let mut h = eslesmis("hepkopma");
    h.pc.islem_yut = 100;
    let id = h.c.ekle(govde("Ulaşmayan", None), GirdiYolu::Elle).unwrap();
    for _ in 0..5 {
        h.pompala();
        h.kopar();
        h.baglan();
    }
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 1);
    assert_eq!((ret[0].kayit_id.as_str(), ret[0].neden), (id.as_str(), KuyrukRetNedeni::TeslimEdilemedi));
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
}

#[test]
fn yarida_kesilen_tam_esitleme_gorunen_kopyayi_ve_alarmlari_goturmez() {
    let mut h = eslesmis("kesilen");
    let a = h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.pc_degisti(a);
    let b = h.pc.disaridan_ekle("k_b", &govde("B", Some(an("2026-11-26", "16:00"))), false);
    h.pc_degisti(b);
    h.kopar();
    let once_liste = liste(&h, Sekme::Tarihli, true);
    let once_alarm = h.alarm.kurulular();
    let once_hello = Depo::ac(&h.yol).unwrap().hello_alanlari().unwrap();
    assert_eq!(once_alarm.len(), 2);

    // PC başka bir depoya geçti (içe aktarma): A değişti, B yok, C yeni.
    let mut yeni = SahtePc::yeni("d_pc2", h.zaman.clone());
    yeni.cihaz_public_key = h.pc.cihaz_public_key.clone();
    yeni.disaridan_ekle("k_a", &govde("A'", Some(an("2026-11-26", "17:00"))), false);
    yeni.disaridan_ekle("k_c", &govde("C", Some(an("2026-11-27", "09:00"))), false);
    yeni.telafi_kes = Some(1);
    h.pc = yeni;
    let iptal_once = h.alarm.iptal_edilen.lock().unwrap().len();
    h.gozlemci.al();
    h.baglan();
    assert!(h.baglanti.is_none(), "tam telafi bir kayıttan sonra kesildi");
    assert_eq!(liste(&h, Sekme::Tarihli, true), once_liste, "görünen kopya değişmedi");
    assert_eq!(h.alarm.kurulular(), once_alarm);
    assert_eq!(h.alarm.iptal_edilen.lock().unwrap().len(), iptal_once, "hiçbir alarm iptal edilmedi");
    assert_eq!(Depo::ac(&h.yol).unwrap().hello_alanlari().unwrap(), once_hello, "PC temeli değişmedi");
    // D2: başka depo görünen kopyayı ezemez; `welcome`'da kip yerele döndü (kayıt değişmedi, yalnız `tumu`).
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert!(h.gozlemci.al().iter().all(|d| d.kayitlar.is_empty()));

    // Sonraki bağlantı yerel kipten bağlanmadır: B düşmez (yeni depoya `ekle` ile gider). Telefon `k_a`'ya
    // eski temelden beri dokunmadı: yeni deponun A' / 17:00'ı kalır, eski 15:00 onu ezmez (alarm 16:00).
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(basliklar(&liste(&h, Sekme::Tarihli, true)), vec!["B", "A'", "C"]);
    for id in ["k_a", "k_b", "k_c"] {
        assert_eq!(h.c.kayit(id.into()).unwrap().unwrap().kayit, h.pc.d.kayitlar[id], "{id}: telefon ile PC aynı");
    }
    assert_eq!(h.pc.d.kayitlar["k_a"].zaman, Some(an("2026-11-26", "17:00")));
    assert_eq!(
        h.alarm.kurulular(),
        vec![("k_a".to_string(), yarin(16)), ("k_b".to_string(), yarin(15)), ("k_c".to_string(), yarin(8) + GUN)]
    );
    assert_eq!(kurulu_alarm_satirlari(&h), h.alarm.kurulular());
    assert!(h.gozlemci.al().iter().any(|d| d.tumu));
}

#[test]
fn pc_yedekten_geri_yuklenince_tam_esitleme() {
    let mut h = eslesmis("yedek");
    let a = h.pc.disaridan_ekle("k_a", &govde("A", None), false);
    h.pc_degisti(a);
    let yedek = h.pc.d.clone();
    h.zaman.ilerlet(DK);
    let b = h.pc.disaridan_ekle("k_b", &govde("B", None), false);
    h.pc_degisti(b);
    h.kopar();
    h.pc.d = yedek;
    h.zaman.ilerlet(DK);
    // Aynı depo kimliği, aynı revizyon numarası başka kayda verildi.
    h.pc.disaridan_ekle("k_c", &govde("C", None), false);
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(true), "iz tutmuyor: tam");
    // Aynı depo, tam telafi: PC'nin yitirdiği onaylı hal (k_b) PC'ye geri gider; PC'nin yeni kaydı gelir.
    let mut l = basliklar(&liste(&h, Sekme::Tarihsiz, true));
    l.sort();
    assert_eq!(l, vec!["A", "B", "C"], "telefonun bildiği hal kaybolmadı");
    assert_eq!(h.pc.d.kayitlar["k_b"].baslik, "B", "PC'nin yitirdiği kayıt geri gitti");
    assert_eq!(h.c.kayit("k_b".into()).unwrap().unwrap().kayit, h.pc.d.kayitlar["k_b"]);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
}

#[test]
fn eski_baglanti_neslinin_gec_cercevesi_yok_sayilir() {
    let mut h = eslesmis("nesil");
    let eski = h.baglanti.as_ref().unwrap().nesil;
    // Kotlin eskinin kapanışını bildirmeden yeni soket açtı.
    h.baglanti = None;
    h.baglan();
    let yeni = h.baglanti.as_ref().unwrap().nesil;
    assert!(yeni > eski && h.canli_mi());
    let k = h.pc.disaridan_ekle("k_gec", &govde("Geç", None), false);
    h.c.cerceve_geldi(eski, asagi(ajanda_cekirdek::model::AjandaAsagi::Kayit { kayit: k })).unwrap();
    assert_eq!(h.c.kayit("k_gec".into()).unwrap(), None);
    h.c.baglanti_kapandi(eski, None).unwrap();
    assert!(h.canli_mi(), "eski neslin kapanışı yenisini düşürmez");
}

#[test]
fn surec_oldurulup_acilinca_kopya_kuyruk_ve_alarmlar_tutarli() {
    let mut h = eslesmis("surec");
    let a = h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.pc_degisti(a);
    h.kopar();
    let b = h.c.ekle(govde("B", Some(an("2026-11-26", "10:00"))), GirdiYolu::Elle).unwrap();
    h.c.durum_degistir("k_a".into(), KayitDurumu::Tamam, None).unwrap();
    // Bağlanır, ilk işlem yola çıkar, PC yanıtlamadan süreç ölür.
    h.pc.islem_yut = 1;
    h.baglan();
    let once = (liste(&h, Sekme::Tarihli, true), liste(&h, Sekme::Tarihsiz, true), h.c.baglanti_durumu().unwrap().kuyrukta);
    let once_satirlar = kurulu_alarm_satirlari(&h);
    let once_kurulu = h.alarm.kurulu_nolar();
    assert_eq!(once.2, 2);
    assert_eq!(once_satirlar, vec![(b.clone(), yarin(9))]);
    h.sureci_oldur_ve_ac();

    assert_eq!((liste(&h, Sekme::Tarihli, true), liste(&h, Sekme::Tarihsiz, true), h.c.baglanti_durumu().unwrap().kuyrukta), once);
    assert_eq!(kurulu_alarm_satirlari(&h), once_satirlar);
    h.c.alarmlari_yeniden_kur(YenidenKurmaNedeni::Acilis).unwrap();
    assert_eq!(h.alarm.kurulu_nolar(), once_kurulu, "aynı numaralarla yeniden kurulur, çift alarm yok");

    h.baglan();
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert_eq!(h.pc.uygulanan.len(), 2);
    assert_eq!(h.c.kayit(b.clone()).unwrap().unwrap().kayit, h.pc.d.kayitlar[&b]);
    assert_eq!(h.pc.d.kayitlar["k_a"].durum, KayitDurumu::Tamam);
    assert_eq!(h.alarm.kurulular(), vec![(b, yarin(9))]);
}

#[test]
fn kayit_degisiklikleri_alarm_planina_yansir() {
    let mut h = eslesmis("alarm");
    let t = h.pc.disaridan_ekle("k_t", &govde("Taslak", Some(an("2026-11-26", "15:00"))), true);
    h.pc_degisti(t);
    assert!(h.alarm.kurulular().is_empty(), "taslağın alarmı yok");
    h.c.onayla("k_t".into()).unwrap();
    assert_eq!(h.alarm.kurulular(), vec![("k_t".to_string(), yarin(14))], "onaylanınca iyimser kurulur");
    h.pompala();
    assert!(!h.pc.d.kayitlar["k_t"].taslak);
    assert_eq!(h.alarm.kurulular(), vec![("k_t".to_string(), yarin(14))]);
    // PC kaydı yeniden taslağa çevirirse (başka yol) alarm iptal.
    let k = h.pc.disaridan_degistir("k_t", |k| k.taslak = true);
    h.pc_degisti(k);
    assert!(h.alarm.kurulular().is_empty());
    let k = h.pc.disaridan_degistir("k_t", |k| k.taslak = false);
    h.pc_degisti(k);
    h.c.sil("k_t".into()).unwrap();
    assert!(h.alarm.kurulular().is_empty(), "silinince iptal");
    h.c.geri_yukle("k_t".into()).unwrap();
    assert_eq!(h.alarm.kurulular(), vec![("k_t".to_string(), yarin(14))], "geri yüklenince kurulur");
    h.pompala();
    assert_eq!(kurulu_alarm_satirlari(&h), h.alarm.kurulular());
}

#[test]
fn sekmeler_taslaklar_ve_siralama() {
    let mut h = eslesmis("sekme");
    h.kopar();
    let gun = |tarih: &str| AjandaZamani::Gun { tarih: tarih.into(), gun_bolumu: None, saat_dilimi: IST.into(), ifade: None };
    let donem = AjandaZamani::Donem { baslangic: "2026-11-25".into(), bitis: "2026-11-27".into(), saat_dilimi: IST.into(), ifade: None };
    let belirsiz = AjandaZamani::Belirsiz { ifade: "bir ara".into() };
    for (ad, z) in [
        ("C", Some(an("2026-11-27", "09:00"))),
        ("B gün", Some(gun("2026-11-26"))),
        ("A sabah", Some(an("2026-11-26", "08:00"))),
        ("D dönem", Some(donem)),
        ("X", None),
        ("Y belirsiz", Some(belirsiz)),
    ] {
        h.zaman.ilerlet(DK);
        let mut g = govde(ad, z);
        g.hatirlatmalar = vec![];
        h.c.ekle(g, GirdiYolu::Elle).unwrap();
    }
    // Çevrimdışı eklenenlerin oluşturma anı kuyruğa giriş anıdır: en yeni üstte. (Eşitlenince servisin
    // anı gelir; art arda uygulanan işlemlerde eşit olabilir, sıra o zaman kimliğe düşer.)
    assert_eq!(basliklar(&liste(&h, Sekme::Tarihsiz, false)), vec!["Y belirsiz", "X"], "en yeni üstte");
    h.pc.disaridan_ekle("k_taslak", &KayitGovdesi { hatirlatmalar: vec![Hatirlatma::Once { dk: 5 }], ..govde("Taslak", Some(an("2026-11-26", "09:00"))) }, true);
    h.baglan();
    assert_eq!(basliklar(&liste(&h, Sekme::Tarihli, false)), vec!["D dönem", "B gün", "A sabah", "Taslak", "C"]);
    assert_eq!(liste(&h, Sekme::Tarihsiz, false).len(), 2);
    let taslaklar = liste(&h, Sekme::Taslaklar, false);
    assert_eq!(basliklar(&taslaklar), vec!["Taslak"]);
    assert!(taslaklar[0].kayit.taslak);
    let c = liste(&h, Sekme::Tarihli, false).into_iter().find(|g| g.kayit.baslik == "C").unwrap();
    h.c.durum_degistir(c.kayit.kayit_id.clone(), KayitDurumu::Iptal, None).unwrap();
    assert_eq!(basliklar(&liste(&h, Sekme::Tarihli, false)), vec!["D dönem", "B gün", "A sabah", "Taslak"]);
    assert_eq!(liste(&h, Sekme::Tarihli, true).len(), 5);
    h.c.sil(c.kayit.kayit_id.clone()).unwrap();
    assert_eq!(liste(&h, Sekme::Tarihli, true).len(), 4);
    assert_eq!(basliklar(&liste(&h, Sekme::Silinenler, false)), vec!["C"], "kapalı ama silinmiş de geri yüklenebilir");
}

#[test]
fn kacirilan_ozeti_gosterilemezse_bilgi_kaybolmaz() {
    let mut h = eslesmis("kacirilan");
    let a = h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-25", "16:00"))), false);
    h.pc_degisti(a);
    assert_eq!(h.alarm.kurulular(), vec![("k_a".to_string(), bugun(15, 0))]);
    h.alarm.kacirilan_basarisiz.store(true, std::sync::atomic::Ordering::SeqCst);
    h.zaman.ayarla(bugun(15, 20));
    h.c.alarmlari_yeniden_kur(YenidenKurmaNedeni::Acilis).unwrap();
    assert!(h.alarm.kacirilan.lock().unwrap().is_empty());
    assert_eq!(kurulu_alarm_satirlari(&h), vec![("k_a".to_string(), bugun(15, 0))], "teslim edilmedi sayılır");
    h.alarm.kacirilan_basarisiz.store(false, std::sync::atomic::Ordering::SeqCst);
    h.c.alarmlari_yeniden_kur(YenidenKurmaNedeni::UygulamaAcildi).unwrap();
    let k = h.alarm.kacirilan.lock().unwrap().clone();
    assert_eq!(k.len(), 1);
    assert_eq!(k[0].satirlar[0].kayit_id, "k_a");
    h.c.alarmlari_yeniden_kur(YenidenKurmaNedeni::UygulamaAcildi).unwrap();
    assert_eq!(h.alarm.kacirilan.lock().unwrap().len(), 1, "bir kez");
}

/// D2: bağlı kipte eşleşmeyi kaldırmak koparmadır; kayıtlar, alarmlar ve eşitlenme anı kalır, kip yerel olur.
#[test]
fn eslesme_kaldirilinca_veri_kalir_kip_yerel_olur() {
    let mut h = eslesmis("kaldir");
    let a = h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.pc_degisti(a);
    h.kopar();
    h.c.ekle(govde("Bekleyen", None), GirdiYolu::Elle).unwrap();
    h.baglan();
    h.pc.islem_yut = 1;
    h.c.ekle(govde("Yolda", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    let once: Vec<Vec<String>> =
        [Sekme::Tarihli, Sekme::Tarihsiz, Sekme::Taslaklar, Sekme::Silinenler].map(|s| basliklar(&liste(&h, s, true))).to_vec();
    assert_eq!(once[1].len(), 2);
    let once_alarm = kurulu_alarm_satirlari(&h);
    assert_eq!(once_alarm.len(), 1);
    let son_esitlenme = h.c.baglanti_durumu().unwrap().son_esitlenme_ms;
    let tasima = h.baglanti.as_ref().unwrap().tasima.clone();
    h.c.eslesmeyi_kaldir().unwrap();
    assert!(tasima.kapatildi.lock().unwrap().is_some(), "açık bağlantı kapatılır");
    h.kopar();
    assert_eq!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Yok);
    assert_eq!(h.c.baglanti_adresi().unwrap(), None);
    let sonra: Vec<Vec<String>> =
        [Sekme::Tarihli, Sekme::Tarihsiz, Sekme::Taslaklar, Sekme::Silinenler].map(|s| basliklar(&liste(&h, s, true))).to_vec();
    assert_eq!(sonra, once, "hiçbir kayıt silinmez");
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde, d.son_esitlenme_ms), (0, 0, son_esitlenme));
    assert_eq!(kurulu_alarm_satirlari(&h), once_alarm);
    assert_eq!(h.kimlik.silinen_anahtar.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(h.gozlemci.al().iter().any(|d| d.tumu && d.eslesme));
}

#[test]
fn gecmis_istegi_ve_onbellek() {
    let mut h = eslesmis("gecmis");
    let a = h.pc.disaridan_ekle("k_a", &govde("A", None), false);
    h.pc_degisti(a);
    for i in 0..2 {
        let k = h.pc.disaridan_degistir("k_a", |k| k.baslik = format!("A{i}"));
        h.pc_degisti(k);
    }
    h.gozlemci.al();
    h.c.gecmis_iste("k_a".into(), None).unwrap();
    assert!(h.c.gecmis("k_a".into()).unwrap().unwrap().yukleniyor);
    h.pompala();
    let s = h.c.gecmis("k_a".into()).unwrap().unwrap();
    assert!(!s.yukleniyor && s.devami);
    assert_eq!(s.satirlar.iter().map(|s| s.rev).collect::<Vec<_>>(), vec![3, 2]);
    assert_eq!(s.satirlar[0].alanlar, vec!["baslik"]);
    assert!(h.gozlemci.al().iter().any(|d| d.gecmis == vec!["k_a".to_string()]));
    h.c.gecmis_iste("k_a".into(), Some(2)).unwrap();
    h.pompala();
    let s = h.c.gecmis("k_a".into()).unwrap().unwrap();
    assert_eq!(s.satirlar.iter().map(|s| s.rev).collect::<Vec<_>>(), vec![3, 2, 1]);
    assert!(!s.devami);
    h.kopar();
    assert!(matches!(h.c.gecmis_iste("k_a".into(), None), Err(CekirdekHatasi::GecersizDurum { .. })));
}

/// Motor kilidi uzun bir işte tutulurken (burada: kabuk geri çağrısı bekletiliyor) arayüz sorguları
/// beklemez: ayrı okuma bağlantısından son kalıcı hali okur.
#[test]
fn sorgular_motor_kilidini_beklemez() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex, mpsc};

    struct BekletenZaman {
        ic: SahteZaman,
        beklet: AtomicBool,
        girdi: Mutex<bool>,
        birak: (Mutex<bool>, Condvar),
    }
    impl ajanda_cekirdek::kopru::kabuklar::ZamanKabugu for BekletenZaman {
        fn simdi_ms(&self) -> i64 {
            self.ic.simdi_ms()
        }
        fn cihaz_dilimi(&self) -> String {
            if self.beklet.load(Ordering::SeqCst) {
                *self.girdi.lock().unwrap() = true;
                let (k, c) = &self.birak;
                let mut b = k.lock().unwrap();
                while !*b {
                    b = c.wait(b).unwrap();
                }
            }
            self.ic.cihaz_dilimi()
        }
        fn yerelden_ana(&self, t: String, s: String, d: String) -> Result<i64, ajanda_cekirdek::KabukHatasi> {
            self.ic.yerelden_ana(t, s, d)
        }
        fn andan_yerele(&self, a: i64, d: String) -> Result<ajanda_cekirdek::model::YerelAn, ajanda_cekirdek::KabukHatasi> {
            self.ic.andan_yerele(a, d)
        }
    }

    let yol = gecici_yol("kilit");
    let _dosya = GeciciDosya(yol.clone());
    let zaman = Arc::new(BekletenZaman {
        ic: SahteZaman::yeni(SIMDI),
        beklet: AtomicBool::new(false),
        girdi: Mutex::new(false),
        birak: (Mutex::new(false), Condvar::new()),
    });
    let c = ajanda_cekirdek::Cekirdek::ac(yol.clone(), Arc::new(SahteKimlik::default()), zaman.clone(), Arc::new(SahteAlarm::default())).unwrap();
    let ilk = c.ekle(govde("Önceki", None), GirdiYolu::Elle).unwrap();
    zaman.beklet.store(true, Ordering::SeqCst);
    let c2 = c.clone();
    let yazan = std::thread::spawn(move || c2.ekle(govde("Uzun süren", None), GirdiYolu::Elle).unwrap());
    while !*zaman.girdi.lock().unwrap() {
        std::thread::yield_now();
    }
    // Motor kilidi şimdi yazanın elinde.
    let (gonder, al) = mpsc::channel();
    let c3 = c.clone();
    std::thread::spawn(move || {
        let l = c3.liste(ListeSorgusu { sekme: Sekme::Tarihsiz, kapalilar_dahil: false }).unwrap();
        let _ = gonder.send(l.into_iter().map(|g| g.kayit.kayit_id).collect::<Vec<_>>());
    });
    let okunan = al.recv_timeout(std::time::Duration::from_secs(10)).expect("sorgu motor kilidini bekledi");
    assert_eq!(okunan, vec![ilk]);
    let (k, cv) = &zaman.birak;
    *k.lock().unwrap() = true;
    cv.notify_all();
    let ikinci = yazan.join().unwrap();
    assert_eq!(c.liste(ListeSorgusu { sekme: Sekme::Tarihsiz, kapalilar_dahil: false }).unwrap().len(), 2);
    assert!(c.kayit(ikinci).unwrap().is_some());
}

/// Çerçeve işlenirken kabuk ya da depo hatası (Keystore'un geçici imza hatası, rastgele üretilemedi):
/// işleyici aşamayı kapanıyora çevirmiş olsa da taşımaya kapat gider, aşama kopuk olur ve yeniden bağlanma
/// normal yoldan sürer (soket açık ama işlemez kalmaz; PC'de eklenen kayıt iner).
#[test]
fn cerceve_islenirken_hata_baglantiyi_kapattirir_yeniden_baglanilir() {
    use std::sync::atomic::Ordering;
    let mut h = eslesmis("cerceve-hatasi");
    h.kopar();
    h.pc.disaridan_ekle("k_pc", &govde("PC'den", None), false);

    // auth_challenge: imzala geçici hata.
    h.kimlik.imza_hatasi.store(1, Ordering::SeqCst);
    let t = std::sync::Arc::new(SahteTasima::default());
    let nesil = h.c.baglanti_acildi(t.clone()).unwrap();
    let mut pc = PcAsama::HelloBekliyor;
    let hello = std::mem::take(&mut *t.giden.lock().unwrap());
    let sinama = h.pc.isle(&mut pc, &hello[0]).cerceveler.remove(0);
    assert!(h.c.cerceve_geldi(nesil, sinama).is_err());
    assert!(t.kapatildi.lock().unwrap().is_some(), "taşıma kapattırıldı");
    assert!(t.giden.lock().unwrap().is_empty(), "yanıt yollanmadı");
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.asama, d.son_hata), (BaglantiAsamasi::Kopuk, Some(AjandaKanalHatasi::IcHata)));
    // Kapanırken gelen çerçeve yok sayılır; Kotlin kapanışı bildirir, yeniden bağlanılır.
    h.c.cerceve_geldi(nesil, asagi(ajanda_cekirdek::model::AjandaAsagi::Esitlendi { rev: 1 })).unwrap();
    h.c.baglanti_kapandi(nesil, None).unwrap();
    h.baglan();
    assert!(h.canli_mi());
    assert!(h.c.kayit("k_pc".into()).unwrap().is_some(), "PC'deki kayıt indi");
    assert_eq!(h.c.baglanti_durumu().unwrap().son_hata, None);

    // Eşleştirme sonucu: eşleşme yazıldı, ardından `hello` için rastgele üretilemedi.
    let mut h = Hat::yeni("eslestirme-hatasi");
    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();
    let t = std::sync::Arc::new(SahteTasima::default());
    let nesil = h.c.baglanti_acildi(t.clone()).unwrap();
    let mut pc = PcAsama::HelloBekliyor;
    let istek = std::mem::take(&mut *t.giden.lock().unwrap());
    let sonuc = h.pc.isle(&mut pc, &istek[0]).cerceveler.remove(0);
    h.kimlik.rastgele_hatasi.store(1, Ordering::SeqCst);
    assert!(h.c.cerceve_geldi(nesil, sonuc).is_err());
    assert!(t.kapatildi.lock().unwrap().is_some(), "taşıma kapattırıldı");
    assert_eq!(h.c.baglanti_durumu().unwrap().asama, BaglantiAsamasi::Kopuk);
    h.c.baglanti_kapandi(nesil, None).unwrap();
    assert!(matches!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Eslesti { .. }), "eşleşme kalıcı");
    h.baglan();
    assert!(h.canli_mi());
}

fn govdesi(k: &ajanda_cekirdek::model::AjandaKaydi) -> KayitGovdesi {
    KayitGovdesi {
        tur: k.tur,
        baslik: k.baslik.clone(),
        aciklama: k.aciklama.clone(),
        zaman: k.zaman.clone(),
        hatirlatmalar: k.hatirlatmalar.clone(),
        tekrar: k.tekrar.clone(),
    }
}

/// Düzenleme formu açıkken asistan PC'de saati 15:00'ten 16:00'ya aldı ve bu telefona indi; kullanıcı
/// yalnız açıklamayı değiştirip kaydetti. Giden işlem yalnız açıklamayı taşır: saat 16:00 kalır,
/// hatırlatma yeni saate göre kurulu kalır. Kullanıcının değiştirdiği alan PC'dekinin üstüne yazılır.
#[test]
fn duzenleme_yalniz_kullanicinin_degistirdigi_alanlari_gonderir() {
    use ajanda_cekirdek::kopru::tipler::DuzenlemeTemeli;
    use ajanda_cekirdek::model::{AjandaDegisiklik, AjandaIslem, AjandaYukari, Alan, ajanda_yukari_coz};
    let mut h = eslesmis("duzenleme-temel");
    let k = h.pc.disaridan_ekle("k_dis", &govde("Dişçi", Some(an("2026-11-26", "15:00"))), false);
    h.pc_degisti(k);
    // Form açıldı.
    let acilan = h.c.kayit("k_dis".into()).unwrap().unwrap().kayit;
    let temel = DuzenlemeTemeli { revizyon: acilan.revizyon, govde: govdesi(&acilan) };
    // Form açıkken PC saati değiştirdi, telefona indi.
    let k = h.pc.disaridan_degistir("k_dis", |k| k.zaman = Some(an("2026-11-26", "16:00")));
    h.pc_degisti(k);
    assert_eq!(h.alarm.kurulular(), vec![("k_dis".to_string(), yarin(15))]);

    // Dokunulmamış form: hiçbir şey gitmez (görünen hal PC'ninkiyle farklı olsa da).
    h.c.duzenle("k_dis".into(), Some(temel.clone()), temel.govde.clone()).unwrap();
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);

    // Kullanıcı yalnız açıklamayı değiştirdi; form hâlâ 15:00 gösteriyor.
    let mut yeni = temel.govde.clone();
    yeni.aciklama = Some("Dolgu".into());
    h.c.duzenle("k_dis".into(), Some(temel.clone()), yeni).unwrap();
    let giden = std::mem::take(&mut *h.baglanti.as_ref().unwrap().tasima.giden.lock().unwrap());
    assert_eq!(giden.len(), 1);
    let Ok(AjandaYukari::Islem { islem: AjandaIslem::Guncelle { degisiklik, temel_revizyon, .. }, .. }) = ajanda_yukari_coz(&giden[0]) else {
        panic!("guncelle bekleniyordu: {}", giden[0])
    };
    assert_eq!(degisiklik, AjandaDegisiklik { aciklama: Alan::Deger("Dolgu".into()), ..Default::default() });
    assert_eq!(temel_revizyon, acilan.revizyon, "formun açıldığı revizyon");
    // İyimser hal de PC'nin saatini korur.
    let gorunen = h.c.kayit("k_dis".into()).unwrap().unwrap().kayit;
    assert_eq!((gorunen.zaman.clone(), gorunen.aciklama.as_deref()), (Some(an("2026-11-26", "16:00")), Some("Dolgu")));
    h.baglanti.as_ref().unwrap().tasima.giden.lock().unwrap().extend(giden);
    h.pompala();
    let pc = &h.pc.d.kayitlar["k_dis"];
    assert_eq!((pc.zaman.clone(), pc.aciklama.as_deref()), (Some(an("2026-11-26", "16:00")), Some("Dolgu")));
    assert_eq!(h.c.kayit("k_dis".into()).unwrap().unwrap().kayit, *pc, "telefon ile PC aynı");
    assert_eq!(h.alarm.kurulular(), vec![("k_dis".to_string(), yarin(15))], "16:00'dan 1 saat önce");

    // Kullanıcı saati de değiştirdiyse (17:00) onunki gider; başlık PC'de değiştiyse korunur.
    let acilan = h.c.kayit("k_dis".into()).unwrap().unwrap().kayit;
    let temel = DuzenlemeTemeli { revizyon: acilan.revizyon, govde: govdesi(&acilan) };
    let k = h.pc.disaridan_degistir("k_dis", |k| k.baslik = "Dişçi (kontrol)".into());
    h.pc_degisti(k);
    let mut yeni = temel.govde.clone();
    yeni.zaman = Some(an("2026-11-26", "17:00"));
    h.c.duzenle("k_dis".into(), Some(temel), yeni).unwrap();
    h.pompala();
    let pc = &h.pc.d.kayitlar["k_dis"];
    assert_eq!((pc.baslik.as_str(), pc.zaman.clone()), ("Dişçi (kontrol)", Some(an("2026-11-26", "17:00"))));
    assert_eq!(h.alarm.kurulular(), vec![("k_dis".to_string(), yarin(16))]);
}