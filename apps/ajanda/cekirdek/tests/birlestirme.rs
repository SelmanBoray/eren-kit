//! D4 birleştirme önizlemesi uçtan uca (`motor/birlestirme.rs`): köprünün açık yüzeyi + sahte kabuklar + sahte
//! PC (`ortak`). Yerel kipten servise bağlanırken servisin tam kopyası gelince gidecek bir şey varsa dökme
//! kullanıcının onayını bekler; önizleme sayıları, olası çiftler, onay (D2 kurallarıyla aynı sonuç), vazgeç,
//! bekleme sırasında yazma, kopma ve yeniden açılış, sorusuz geçiş, farklı `depo_id`'li `welcome` ve bağlı
//! kipin olağan bağlantıları.

mod ortak;

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{
    BaglantiAsamasi, BirlestirmeOnizlemesi, CakisanKayit, CalismaKipi, EslesmeDurumu, GecisNedeni, OlasiCift,
};
use ajanda_cekirdek::model::{AjandaKaydi, AjandaZamani, GirdiYolu, KayitDurumu, KayitTuru, KuyrukRetNedeni};
use ortak::*;

fn depo(h: &Hat) -> Depo {
    Depo::ac(&h.yol).unwrap()
}

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

fn isaret(h: &Hat) -> Option<String> {
    depo(h).meta_oku("birlestirme_bekliyor").unwrap()
}

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

fn onizleme(h: &Hat) -> BirlestirmeOnizlemesi {
    h.c.birlestirme_onizlemesi().unwrap().expect("onay bekleyen birleştirme")
}

/// Telefonun bütün izlenebilir hali: görünen kopya, ret listesi (islem kimliği dışında), PC temeli, alarmlar.
type Hal = (Vec<AjandaKaydi>, Vec<(String, KuyrukRetNedeni)>, (Vec<AjandaKaydi>, Option<String>, i64), Vec<(String, i64)>);

fn hal(h: &Hat) -> Hal {
    let ret = h.c.ret_listesi().unwrap().into_iter().map(|r| (r.kayit_id, r.neden)).collect();
    (gorunenler(h), ret, temel(h), h.alarm.kurulular())
}

/// Bekleme durumu: kip yerel, bağlantı telafi aşamasında, kuyruk boş, PC'ye hiçbir işlem gitmedi.
fn bekliyor(h: &Hat) {
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.asama, d.kuyrukta), (BaglantiAsamasi::Telafi, 0));
    assert!(depo(h).kuyruk().unwrap().is_empty());
    assert!(h.pc.uygulanan.is_empty(), "onaydan önce PC'ye işlem gitmez");
    assert!(h.baglanti.is_some(), "bağlantı açık kalır");
}

/// Ortak senaryo. PC'de A, P, O, Q ("Dişçi" 27 Kasım 10:00); telefon eşleşip (sorusuz: telefonda kayıt yok)
/// koparır. Yerelde: A'nın ve P'nin başlığı, O'nun zamanı değişti; Q ile aynı anahtarlı yeni L; doğup silinen M.
/// PC'de bu arada: A'nın başlığı da değişti, P silindi; yeni Y (L'nin olası çifti), Z (saat farklı), W (tür
/// farklı), V (silinmiş). Sonra yeni QR ile eşleşir. Döner: (L, M).
fn senaryo(h: &mut Hat) -> (String, String) {
    for (id, baslik, saat) in [("k_a", "A", "15:00"), ("k_p", "P", "16:00"), ("k_o", "O", "17:00")] {
        h.pc.disaridan_ekle(id, &govde(baslik, Some(an("2026-11-26", saat))), false);
    }
    h.pc.disaridan_ekle("k_q", &govde("Dişçi", Some(an("2026-11-27", "10:00"))), false);
    let otomatik = h.otomatik_onay;
    h.otomatik_onay = false;
    h.eslestir();
    assert!(h.canli_mi() && h.c.kip().unwrap() == CalismaKipi::Bagli, "telefonda kayıt yokken sorusuz");
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    h.otomatik_onay = otomatik;

    h.c.duzenle("k_a".into(), None, govde("A (telefon)", Some(an("2026-11-26", "15:00")))).unwrap();
    h.c.duzenle("k_p".into(), None, govde("P (telefon)", Some(an("2026-11-26", "16:00")))).unwrap();
    h.c.duzenle("k_o".into(), None, govde("O", Some(an("2026-11-26", "18:00")))).unwrap();
    let l = h.c.ekle(govde("Dişçi", Some(an("2026-11-27", "10:00"))), GirdiYolu::Elle).unwrap();
    let m = h.c.ekle(govde("Geçici", None), GirdiYolu::Elle).unwrap();
    h.c.sil(m.clone()).unwrap();

    h.zaman.ilerlet(DK);
    h.pc.disaridan_degistir("k_a", |k| k.baslik = "A (PC)".into());
    h.pc.disaridan_degistir("k_p", |k| k.silindi = true);
    let disci = govde("Dişçi", Some(an("2026-11-27", "10:00")));
    h.pc.disaridan_ekle("k_y", &disci, false);
    h.pc.disaridan_ekle("k_z", &govde("Dişçi", Some(an("2026-11-27", "11:00"))), false);
    h.pc.disaridan_ekle("k_w", &disci, false);
    h.pc.disaridan_degistir("k_w", |k| k.tur = KayitTuru::Gorev);
    h.pc.disaridan_ekle("k_v", &disci, false);
    h.pc.disaridan_degistir("k_v", |k| k.silindi = true);
    h.eslestir();
    (l, m)
}

#[test]
fn onizleme_sayilari_olasi_ciftler_ve_onayla_dokme() {
    let mut h = Hat::yeni("birlestir-onizleme");
    h.otomatik_onay = false;
    let (l, _m) = senaryo(&mut h);
    bekliyor(&h);
    assert!(h.gozlemci.al().last().is_some_and(|d| d.baglanti && !d.tumu), "önizleme hazır: Degisim.baglanti");
    let p = onizleme(&h);
    assert_eq!((p.depo_id.as_str(), p.ayni_depo), ("d_pc1", true));
    assert_eq!((p.yeni, p.degisen, p.ayni, p.dusecek_mezar, p.servisten_gelecek, p.islem), (1, 2, 1, 1, 3, 4));
    assert_eq!(p.cakisanlar, vec![CakisanKayit { kayit_id: "k_a".into(), alanlar: vec!["baslik".into()] }]);
    assert_eq!(p.pc_silmisler, vec!["k_p".to_string()]);
    assert!(p.ret_listesine.is_empty());
    assert_eq!(p.olasi_ciftler, vec![OlasiCift { telefondaki: l.clone(), servisteki: "k_y".into() }], "Z, W, V ve telefondaki Q çift değil");
    assert_eq!(onizleme(&h), p, "önizleme kayıtlara dokunmaz, yinelenebilir");
    assert!(h.c.olasi_ciftler().unwrap().is_empty(), "onaydan önce işaret yok");

    let s = h.c.birlestirmeyi_onayla(Some(p.iz.clone())).unwrap();
    assert!(s.uygulandi);
    assert_eq!(s.plan.as_ref(), Some(&p));
    assert!(h.gozlemci.al().iter().any(|d| d.tumu && d.baglanti));
    h.pompala();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.birlestirme_onizlemesi().unwrap(), None);
    assert_eq!(isaret(&h), None);
    assert_eq!(h.pc.d.kayitlar["k_a"].baslik, "A (telefon)", "iki taraf da değiştirdi: telefon kazandı");
    assert_eq!(h.pc.d.kayitlar["k_o"].zaman, Some(an("2026-11-26", "18:00")));
    assert_eq!(h.pc.d.kayitlar[&l].baslik, "Dişçi");
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.iter().map(|r| (r.kayit_id.as_str(), r.neden)).collect::<Vec<_>>(), vec![("k_p", KuyrukRetNedeni::KayitSilinmis)]);
    // Olası çift: ikisi de tutuldu, işaretli; biri silinince işaret düşer.
    assert_eq!((kayit(&h, &l).baslik, kayit(&h, "k_y").baslik), ("Dişçi".to_string(), "Dişçi".to_string()));
    assert_eq!(h.c.olasi_ciftler().unwrap(), p.olasi_ciftler);
    assert_eq!(h.c.olasi_ciftleri("k_y".into()).unwrap(), vec![l.clone()]);
    assert_eq!(h.c.olasi_ciftleri(l.clone()).unwrap(), vec!["k_y".to_string()]);
    assert!(h.c.olasi_ciftleri("k_q".into()).unwrap().is_empty());
    h.c.sil("k_y".into()).unwrap();
    h.pompala();
    assert!(h.c.olasi_ciftler().unwrap().is_empty() && h.c.olasi_ciftleri(l).unwrap().is_empty());
}

/// Onayla dökmenin sonucu, bekleme olmadan (D2'nin kendiliğinden dökmesi) varılan sonuçla aynıdır: önizleme ve
/// bekleme hiçbir kuralı değiştirmez.
#[test]
fn onayli_dokme_d2_kurallariyla_ayni_sonucu_verir() {
    let mut elle = Hat::yeni("birlestir-elle");
    elle.otomatik_onay = false;
    senaryo(&mut elle);
    bekliyor(&elle);
    assert!(elle.c.birlestirmeyi_onayla(None).unwrap().uygulandi);
    elle.pompala();
    let mut kendi = Hat::yeni("birlestir-kendi");
    senaryo(&mut kendi);
    assert!(elle.canli_mi() && kendi.canli_mi());
    assert_eq!(hal(&elle), hal(&kendi));
    assert_eq!(elle.pc.d.kayitlar, kendi.pc.d.kayitlar);
}

#[test]
fn vazgecince_hicbir_kayit_degismez_baglanma_iptal_edilir() {
    let mut h = Hat::yeni("birlestir-vazgec");
    h.otomatik_onay = false;
    senaryo(&mut h);
    bekliyor(&h);
    let once = hal(&h);
    let gecis = h.c.son_gecis().unwrap();
    h.gozlemci.al();
    let s = h.c.birlestirmeden_vazgec().unwrap();
    assert_eq!((s.onceki_kip, s.baglanma_iptal, s.gonderilmeyen_islem), (CalismaKipi::Yerel, true, 0));
    h.pompala();
    assert!(h.baglanti.is_none(), "bağlantı kapandı");
    assert_eq!(hal(&h), once, "kayıt, ret listesi, PC temeli, alarm değişmedi");
    assert_eq!(h.c.son_gecis().unwrap(), gecis);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!((h.c.eslesme_durumu().unwrap(), h.c.baglanti_adresi().unwrap()), (EslesmeDurumu::Yok, None), "yeniden sorulmaz: QR gerekir");
    assert_eq!((telafi_sayisi(&h), isaret(&h)), (0, None));
    assert_eq!(h.c.birlestirme_onizlemesi().unwrap(), None);
    assert!(h.pc.uygulanan.is_empty());
    assert!(h.gozlemci.al().iter().any(|d| d.eslesme && d.baglanti && d.kayitlar.is_empty() && !d.tumu));
    // Yeni QR ile yeniden sorulur.
    h.eslestir();
    bekliyor(&h);

    // Bağlı kipte vazgeç koparma değildir.
    let mut b = Hat::yeni("birlestir-vazgec-bagli");
    b.eslestir();
    assert!(matches!(b.c.birlestirmeden_vazgec(), Err(CekirdekHatasi::GecersizDurum { .. })));
    assert!(b.canli_mi() && b.c.kip().unwrap() == CalismaKipi::Bagli);
}

/// Bekleme sırasında yerel yazma sürer; önizlemeden sonra telefon ya da servisin kopyası planı değiştirdiyse
/// eski izle onay hiçbir şey yazmaz, yeni plan döner (D3 kalıbı).
#[test]
fn bekleme_sirasinda_yazma_ve_canli_kayit_plani_yeniler() {
    let mut h = Hat::yeni("birlestir-bekleme");
    h.otomatik_onay = false;
    senaryo(&mut h);
    let p1 = onizleme(&h);
    let n = h.c.ekle(govde("Beklerken", None), GirdiYolu::Elle).unwrap();
    assert!(!h.c.kayit(n.clone()).unwrap().unwrap().bekleyen, "kip yerel: yazma kalıcı, kuyruksuz");
    let s = h.c.birlestirmeyi_onayla(Some(p1.iz.clone())).unwrap();
    assert!(!s.uygulandi);
    let p2 = s.plan.expect("yeni plan");
    assert_eq!((p2.yeni, p2.islem), (2, 5));
    assert_ne!(p2.iz, p1.iz);
    bekliyor(&h);

    // Servis canlı `kayit` yollar (telefonu canlı sayar): O'nun zamanını PC de değiştirdi, artık çakışma.
    h.zaman.ilerlet(DK);
    let k = h.pc.disaridan_degistir("k_o", |k| k.zaman = Some(an("2026-11-26", "19:00")));
    h.pc_degisti(k);
    let s = h.c.birlestirmeyi_onayla(Some(p2.iz.clone())).unwrap();
    assert!(!s.uygulandi);
    let p3 = s.plan.unwrap();
    assert!(p3.cakisanlar.contains(&CakisanKayit { kayit_id: "k_o".into(), alanlar: vec!["zaman".into()] }));
    bekliyor(&h);

    assert!(h.c.birlestirmeyi_onayla(Some(p3.iz)).unwrap().uygulandi);
    h.pompala();
    assert!(h.canli_mi());
    assert_eq!(h.pc.d.kayitlar[&n].baslik, "Beklerken");
    assert_eq!(h.pc.d.kayitlar["k_o"].zaman, Some(an("2026-11-26", "18:00")), "telefon kazandı");
    assert_eq!(kayit(&h, "k_o"), h.pc.d.kayitlar["k_o"]);
}

/// Onaydan önce bağlantı koparsa ya da süreç ölürse toplanan kopya atılır, hiçbir kayıt değişmez; sonraki
/// bağlantı servisin kopyasını yeniden alır ve yeniden sorar.
#[test]
fn onaydan_once_kopma_ve_yeniden_acilis_yeniden_sorar_kayip_yok() {
    let mut h = Hat::yeni("birlestir-kopma");
    h.otomatik_onay = false;
    senaryo(&mut h);
    let once = hal(&h);
    let p = onizleme(&h);
    assert_eq!(isaret(&h).as_deref(), Some("d_pc1"));

    h.kopar();
    assert_eq!(h.c.birlestirme_onizlemesi().unwrap(), None);
    let s = h.c.birlestirmeyi_onayla(Some(p.iz.clone())).unwrap();
    assert_eq!((s.uygulandi, s.plan), (false, None), "bekleyen yok: hiçbir şey yazılmaz");
    assert_eq!((telafi_sayisi(&h), isaret(&h)), (0, None));
    assert_eq!(hal(&h), once);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert!(matches!(h.c.eslesme_durumu().unwrap(), EslesmeDurumu::Eslesti { .. }), "eşleşme kalır");

    h.baglan();
    bekliyor(&h);
    assert_eq!(onizleme(&h), p, "yeniden soruldu, plan aynı");

    // Süreç onaydan önce öldü: açılış toplananı ve işareti atar.
    h.sureci_oldur_ve_ac();
    assert_eq!((telafi_sayisi(&h), isaret(&h)), (0, None));
    assert_eq!(h.c.birlestirme_onizlemesi().unwrap(), None);
    assert_eq!(hal(&h), once);
    h.baglan();
    bekliyor(&h);
    assert!(h.c.birlestirmeyi_onayla(Some(p.iz)).unwrap().uygulandi);
    h.pompala();
    assert!(h.canli_mi());
    for k in once.0.iter().filter(|k| !k.silindi) {
        let var = h.c.kayit(k.kayit_id.clone()).unwrap().is_some() || h.c.ret_listesi().unwrap().iter().any(|r| r.kayit_id == k.kayit_id);
        assert!(var, "{} kayboldu", k.kayit_id);
    }
    assert_eq!(h.pc.telafi_sayisi, 4, "her bağlantı servisin kopyasını yeniden aldı");
}

/// Gönderilecek bir şey yoksa sorulmaz: telefonda kayıt yok, ya da her kayıt servistekiyle aynı (yalnız servis
/// ilerlemiş olabilir).
#[test]
fn gonderilecek_yokken_sorusuz_gecer() {
    let mut h = Hat::yeni("birlestir-sorusuz");
    h.otomatik_onay = false;
    h.pc.disaridan_ekle("k_x", &govde("X", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_s", &govde("S", None), false);
    h.pc.disaridan_degistir("k_s", |k| k.silindi = true);
    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.birlestirme_onizlemesi().unwrap(), None);

    // Koparıp yeniden bağlanma: telefon hiçbir şeye dokunmadı, PC X'i ilerletti: yine sorusuz, PC'nin hali görünür.
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    h.zaman.ilerlet(DK);
    h.pc.disaridan_degistir("k_x", |k| k.baslik = "X (PC)".into());
    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(kayit(&h, "k_x").baslik, "X (PC)");
    assert_eq!(kayit(&h, "k_x"), h.pc.d.kayitlar["k_x"]);
    assert!(h.pc.uygulanan.is_empty());
}

/// Bağlı kipte farklı `depo_id`'li `welcome` (yeni servis): D2 kipi yerele çevirir, bağlanma aynı önizlemeden
/// geçer.
#[test]
fn bagli_kipte_farkli_depo_id_ayni_onizlemeden_gecer() {
    let mut h = Hat::yeni("birlestir-depo");
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.eslestir();
    let b = h.c.ekle(govde("B", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    h.kopar();
    h.c.duzenle("k_a".into(), None, govde("A (telefon)", Some(an("2026-11-26", "15:00")))).unwrap();
    let c = h.c.ekle(govde("C", None), GirdiYolu::SesliNot).unwrap();
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 2);
    let mut pc2 = SahtePc::yeni("d_pc2", h.zaman.clone());
    pc2.cihaz_public_key = h.pc.cihaz_public_key.clone();
    pc2.disaridan_ekle("k_z", &govde("Z", None), false);
    h.pc = pc2;
    h.otomatik_onay = false;

    h.baglan();
    bekliyor(&h);
    assert_eq!(h.c.son_gecis().unwrap().map(|g| g.neden), Some(GecisNedeni::DepoDegisti));
    let p = onizleme(&h);
    assert_eq!((p.depo_id.as_str(), p.ayni_depo), ("d_pc2", false));
    assert_eq!((p.yeni, p.degisen, p.servisten_gelecek, p.islem), (3, 0, 1, 3));
    assert!(p.olasi_ciftler.is_empty() && p.cakisanlar.is_empty());
    assert!(h.c.birlestirmeyi_onayla(Some(p.iz)).unwrap().uygulandi);
    h.pompala();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    for id in ["k_a", b.as_str(), c.as_str(), "k_z"] {
        assert_eq!(kayit(&h, id), h.pc.d.kayitlar[id], "{id}");
    }
    assert_eq!(h.pc.d.kayitlar["k_a"].baslik, "A (telefon)");
}

/// Bağlı kipin olağan bağlantıları değişmez: artımlı telafi ve aynı depoda tam telafi (servis yedekten döndü)
/// hiç sormadan canlıya geçer, kuyruk gider.
#[test]
fn bagli_kipte_olagan_baglantilar_sormaz() {
    let mut h = Hat::yeni("birlestir-bagli");
    h.otomatik_onay = false;
    h.pc.disaridan_ekle("k_a", &govde("A", None), false);
    h.eslestir();
    let x = h.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    let yedek = h.pc.d.clone();
    h.kopar();
    h.c.duzenle(x.clone(), None, govde("X (çevrimdışı)", None)).unwrap();
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(false));
    assert!(h.canli_mi());
    assert_eq!(h.c.birlestirme_onizlemesi().unwrap(), None);
    assert_eq!((h.c.baglanti_durumu().unwrap().kuyrukta, h.pc.d.kayitlar[&x].baslik.as_str()), (0, "X (çevrimdışı)"));

    // Servis yedekten döndü: aynı depo, tam telafi; bağlı kip D2 yolundan, sorusuz.
    h.kopar();
    h.pc.d = yedek;
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.birlestirme_onizlemesi().unwrap(), None);
    assert_eq!(h.pc.d.kayitlar[&x].baslik, "X (çevrimdışı)", "yitirilen değer yeniden gitti");
}

/// Olası çift kuralı: tekil anahtar (tür, başlık, zaman çekirdeği) aynı; biri telefonda doğmuş, öteki serviste
/// olup telefonda olmayan, ikisi de canlı. `ifade`, süre, durum anahtara girmez; başlık birebir.
#[test]
fn olasi_cift_kurali_yanlis_pozitif_vermez() {
    let mut h = Hat::yeni("birlestir-cift");
    h.otomatik_onay = false;
    let disci = || govde("Dişçi", Some(an("2026-11-27", "10:00")));
    h.pc.disaridan_ekle("k_7", &disci(), false);
    h.eslestir();
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();

    let ifadeli = AjandaZamani::An {
        tarih: "2026-11-27".into(),
        saat: "10:00".into(),
        sure_dk: Some(30),
        saat_dilimi: IST.into(),
        ifade: Some("yarın 10'da".into()),
    };
    let l1 = h.c.ekle(govde("Dişçi", Some(ifadeli)), GirdiYolu::Elle).unwrap();
    let l2 = h.c.ekle(govde("Fatura", None), GirdiYolu::Elle).unwrap();
    let l3 = h.c.ekle(disci(), GirdiYolu::Elle).unwrap();
    h.c.sil(l3).unwrap();

    h.pc.disaridan_ekle("k_1", &disci(), false);
    h.pc.disaridan_ekle("k_2", &disci(), false);
    h.pc.disaridan_degistir("k_2", |k| k.silindi = true);
    h.pc.disaridan_ekle("k_3", &govde("dişçi", Some(an("2026-11-27", "10:00"))), false);
    let gun = AjandaZamani::Gun { tarih: "2026-11-27".into(), gun_bolumu: None, saat_dilimi: IST.into(), ifade: None };
    h.pc.disaridan_ekle("k_4", &govde("Dişçi", Some(gun)), false);
    h.pc.disaridan_ekle("k_5", &govde("Dişçi", Some(an("2026-11-28", "10:00"))), false);
    h.pc.disaridan_ekle("k_6", &disci(), false);
    h.pc.disaridan_degistir("k_6", |k| k.tur = KayitTuru::Gorev);
    h.pc.disaridan_ekle("k_8", &govde("Fatura", None), false);
    h.pc.disaridan_degistir("k_8", |k| k.durum = KayitDurumu::Tamam);
    h.eslestir();
    bekliyor(&h);
    let p = onizleme(&h);
    let mut ciftler = p.olasi_ciftler.clone();
    ciftler.sort_by(|a, b| a.servisteki.cmp(&b.servisteki));
    assert_eq!(
        ciftler,
        vec![OlasiCift { telefondaki: l1.clone(), servisteki: "k_1".into() }, OlasiCift { telefondaki: l2.clone(), servisteki: "k_8".into() }],
        "silinmiş, başlığı, zaman kesinliği, günü, türü farklı ve telefonda zaten olan (k_7) çift değil; telefondaki mezar taşı da"
    );
    assert!(h.c.birlestirmeyi_onayla(Some(p.iz)).unwrap().uygulandi);
    h.pompala();
    let mut kalan = h.c.olasi_ciftler().unwrap();
    kalan.sort_by(|a, b| a.servisteki.cmp(&b.servisteki));
    assert_eq!(kalan, ciftler);
    assert!(h.c.olasi_ciftleri("k_7".into()).unwrap().is_empty());
}
