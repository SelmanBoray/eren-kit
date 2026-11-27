//! D1 yerel kip uçtan uca: köprünün açık yüzeyi + sahte kabuklar (`ortak`). Yeni kurulum yerel kipte açılır;
//! işlemler kuyruğa girmeden kalıcı uygulanır, revizyon artar, geçmiş yerel tablodan gelir, servisin
//! sınırları yerelde de geçerlidir. Eşleşme tamamlanınca bugünkü gibi kayıtlar PC'ye gider ve kip bağlı olur.

mod ortak;

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{CalismaKipi, EslesmeDurumu, ListeSorgusu, Sekme};
use ajanda_cekirdek::model::sinirlar::ajanda::KAYIT_ADET;
use ajanda_cekirdek::model::{
    AjandaKaydi, AjandaRetNedeni, AjandaZamani, GirdiYolu, Hatirlatma, IslemTuru, KayitDurumu, KaynakYolu, OrnekDurumu, Tekrar,
    TekrarSikligi, TurKokeni,
};
use ortak::*;

fn yarin(saat: i64) -> i64 {
    bugun(saat, 0) + GUN
}

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

fn gecmis_sayisi(h: &Hat, id: &str) -> i64 {
    Depo::ac(&h.yol).unwrap().yerel_gecmis_sayisi(id).unwrap()
}

fn kuyruk_bos(h: &Hat) -> bool {
    Depo::ac(&h.yol).unwrap().kuyruk().unwrap().is_empty()
}

fn spor_govdesi() -> ajanda_cekirdek::model::KayitGovdesi {
    let mut g = govde("Spor", Some(an("2026-11-23", "07:00")));
    g.tekrar = Some(Tekrar { siklik: TekrarSikligi::Gunluk, aralik: 1, gunler: None, bitis_tarihi: None, adet: None });
    g
}

#[test]
fn yeni_kurulum_yerel_kipte_acilir_baglanti_yok() {
    let h = Hat::yeni("yerel-acilis");
    assert_eq!(h.c.sema_surumu().unwrap(), 4);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!(h.c.baglanti_adresi().unwrap(), None);
    let t = std::sync::Arc::new(SahteTasima::default());
    assert!(matches!(h.c.baglanti_acildi(t.clone()), Err(CekirdekHatasi::Eslesme { .. })));
    assert!(t.giden.lock().unwrap().is_empty());
}

#[test]
fn yerel_kipte_islemler_kuyruksuz_kalici_revizyon_artar_alarm_ve_degisim_yayilir() {
    let mut h = Hat::yeni("yerel-islemler");
    h.gozlemci.al();

    // Ekle: kalıcı, bekleyen değil, revizyon 1 (önceki yok), kaynak insan yolu, kuyruk boş, alarm kurulu.
    let id = h.c.ekle(govde("Kuaför", Some(an("2026-11-26", "11:00"))), GirdiYolu::SesliNot).unwrap();
    let d = h.gozlemci.al();
    assert_eq!(d.len(), 1, "değişiklikte tek bildirim");
    assert_eq!(d[0].kayitlar, vec![id.clone()]);
    assert!(!d[0].baglanti, "kuyruk değişmedi");
    let g = h.c.kayit(id.clone()).unwrap().unwrap();
    assert!(!g.bekleyen);
    assert_eq!((g.kayit.revizyon, g.kayit.kaynak.yol, g.kayit.kaynak.tur_kokeni), (1, KaynakYolu::SesliNot, TurKokeni::Insan));
    assert_eq!((g.kayit.olusturma_ms, g.kayit.guncelleme_ms), (SIMDI, SIMDI));
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert!(kuyruk_bos(&h));
    assert_eq!(h.alarm.kurulular(), vec![(id.clone(), yarin(10))]);

    // Düzenle: yeni revizyon, alarm taşınır, `guncelleme_ms` ilerler.
    h.zaman.ilerlet(DK);
    h.c.duzenle(id.clone(), None, govde("Kuaför (saç)", Some(an("2026-11-26", "12:00")))).unwrap();
    let k = kayit(&h, &id);
    assert_eq!((k.baslik.as_str(), k.revizyon, k.guncelleme_ms), ("Kuaför (saç)", 2, SIMDI + DK));
    assert_eq!(h.alarm.kurulular(), vec![(id.clone(), yarin(11))]);
    assert_eq!(h.gozlemci.al().iter().map(|d| d.kayitlar.clone()).collect::<Vec<_>>(), vec![vec![id.clone()]]);
    // Fark yoksa hiçbir şey yazılmaz.
    h.c.duzenle(id.clone(), None, govde("Kuaför (saç)", Some(an("2026-11-26", "12:00")))).unwrap();
    assert_eq!(kayit(&h, &id).revizyon, 2);
    assert!(h.gozlemci.al().is_empty());

    // Durum: tamam -> alarm iptal; yan etkisiz tekrar bildirim ve revizyon üretmez; geri alınca yeniden kurulur.
    h.c.durum_degistir(id.clone(), KayitDurumu::Tamam, None).unwrap();
    assert_eq!((kayit(&h, &id).durum, kayit(&h, &id).revizyon), (KayitDurumu::Tamam, 3));
    assert!(h.alarm.kurulular().is_empty(), "tamamlanınca iptal");
    h.gozlemci.al();
    h.c.durum_degistir(id.clone(), KayitDurumu::Tamam, None).unwrap();
    assert!(h.gozlemci.al().is_empty(), "yan etkisiz işlem: bildirim yok");
    assert_eq!(kayit(&h, &id).revizyon, 3);
    h.c.durum_degistir(id.clone(), KayitDurumu::Acik, None).unwrap();
    assert_eq!(kayit(&h, &id).revizyon, 4);
    assert_eq!(h.alarm.kurulular(), vec![(id.clone(), yarin(11))]);

    // Örnek durumu: tekrarın yalnız o örneği; serinin günü olmayan tarih reddedilir, hiçbir şey yazılmaz.
    let spor = h.c.ekle(spor_govdesi(), GirdiYolu::Elle).unwrap();
    assert_eq!(kayit(&h, &spor).revizyon, 5);
    h.c.durum_degistir(spor.clone(), KayitDurumu::Tamam, Some("2026-11-24".into())).unwrap();
    let s = kayit(&h, &spor);
    assert_eq!((s.ornekler.len(), s.ornekler[0].durum, s.revizyon), (1, OrnekDurumu::Tamam, 6));
    assert!(matches!(
        h.c.durum_degistir(spor.clone(), KayitDurumu::Tamam, Some("2026-11-22".into())),
        Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "ornek_tarihi"
    ));
    assert_eq!(kayit(&h, &spor).revizyon, 6);

    // Onayla taslak olmayana yan etkisiz.
    h.c.onayla(id.clone()).unwrap();
    assert_eq!(kayit(&h, &id).revizyon, 4);

    // Sil ve geri yükle; mezar taşına başka işlem yapılamaz; olmayan kayıt `KayitYok`.
    h.c.sil(id.clone()).unwrap();
    assert!(kayit(&h, &id).silindi);
    assert_eq!(kayit(&h, &id).revizyon, 7);
    assert!(h.alarm.kurulular().iter().all(|(k, _)| k != &id));
    assert_eq!(h.c.liste(ListeSorgusu { sekme: Sekme::Silinenler, kapalilar_dahil: false }).unwrap().len(), 1);
    assert!(matches!(h.c.durum_degistir(id.clone(), KayitDurumu::Tamam, None), Err(CekirdekHatasi::GecersizDurum { .. })));
    h.c.sil(id.clone()).unwrap();
    assert_eq!(kayit(&h, &id).revizyon, 7, "zaten silinmişe sil yan etkisiz");
    h.c.geri_yukle(id.clone()).unwrap();
    assert_eq!((kayit(&h, &id).silindi, kayit(&h, &id).revizyon), (false, 8));
    assert_eq!(h.alarm.kurulular().iter().filter(|(k, _)| k == &id).count(), 1, "geri yüklenince alarm döner");
    assert!(matches!(h.c.onayla("k_yok".into()), Err(CekirdekHatasi::KayitYok { .. })));

    // Hiçbiri kuyruğa girmedi; süreç ölüp açılınca hepsi kalıcı.
    assert!(kuyruk_bos(&h));
    assert_eq!(gecmis_sayisi(&h, &id), 6, "ekle, düzenle, tamam, açık, sil, geri yükle");
    assert_eq!(gecmis_sayisi(&h, &spor), 2);
    let once = (kayit(&h, &id), kayit(&h, &spor));
    h.sureci_oldur_ve_ac();
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!((kayit(&h, &id), kayit(&h, &spor)), once);
    assert!(h.c.liste(ListeSorgusu { sekme: Sekme::Tarihli, kapalilar_dahil: true }).unwrap().iter().all(|g| !g.bekleyen));
    // Revizyon süreçler arasında da artar (sayaç kalıcı).
    h.c.duzenle(spor.clone(), None, { let mut g = spor_govdesi(); g.baslik = "Koşu".into(); g }).unwrap();
    assert_eq!(kayit(&h, &spor).revizyon, 9);
}

#[test]
fn yerel_revizyon_pc_revizyonlarinin_altina_inmez() {
    let h = Hat::yeni("yerel-rev");
    // Bağlantıdan miras kalmış PC temeli ve görünen kayıt (koparma sonraki dilimde; burada elle kurulur).
    let mut pc = SahtePc::yeni("d_pc1", h.zaman.clone());
    for i in 0..40 {
        pc.disaridan_ekle(&format!("k_pc{i:02}"), &govde("PC", None), false);
    }
    let k = pc.d.kayitlar["k_pc05"].clone();
    {
        let d = Depo::ac(&h.yol).unwrap();
        d.yazma(|d| {
            d.kopya_kaydi_uygula(ajanda_cekirdek::depo::KopyaTablosu::Sunucu, &k)?;
            d.gorunen_yaz(&k, false)?;
            d.son_rev_yaz(40)?;
            Ok(())
        })
        .unwrap();
    }
    h.c.duzenle("k_pc05".into(), None, govde("PC (telefonda)", None)).unwrap();
    assert_eq!(kayit(&h, "k_pc05").revizyon, 41, "son_rev'in üstünden");
    let id = h.c.ekle(govde("Yeni", None), GirdiYolu::Elle).unwrap();
    assert_eq!(kayit(&h, &id).revizyon, 42);
    // PC temeli yerel yazmalarla değişmez.
    let d = Depo::ac(&h.yol).unwrap();
    assert_eq!(d.sunucu_kaydi("k_pc05").unwrap(), Some(k));
    assert_eq!((d.son_rev().unwrap(), d.depo_id().unwrap()), (40, None));
}

#[test]
fn yerelde_bagliliktan_kalan_taslak_onaylanir() {
    let h = Hat::yeni("yerel-taslak");
    let mut pc = SahtePc::yeni("d_pc1", h.zaman.clone());
    let t = pc.disaridan_ekle("k_tas", &govde("Taslak", Some(an("2026-11-27", "10:00"))), true);
    Depo::ac(&h.yol).unwrap().gorunen_yaz(&t, false).unwrap();
    h.c.alarmlari_yeniden_kur(ajanda_cekirdek::kopru::tipler::YenidenKurmaNedeni::Acilis).unwrap();
    assert!(h.alarm.kurulular().is_empty(), "taslağın alarmı yok");
    h.gozlemci.al();
    h.c.onayla("k_tas".into()).unwrap();
    let k = kayit(&h, "k_tas");
    assert!(!k.taslak);
    assert_eq!((k.revizyon, k.kaynak.tur_kokeni), (2, TurKokeni::Sentetik), "kaynak izi korunur");
    assert_eq!(h.alarm.kurulular(), vec![("k_tas".to_string(), bugun(9, 0) + 2 * GUN)]);
    assert_eq!(h.gozlemci.al()[0].kayitlar, vec!["k_tas".to_string()]);
    let s = h.c.gecmis_iste("k_tas".into(), None).and_then(|()| h.c.gecmis("k_tas".into())).unwrap().unwrap();
    assert_eq!(s.satirlar.len(), 1);
    assert_eq!((s.satirlar[0].islem, s.satirlar[0].alanlar.clone()), (IslemTuru::Onayla, vec!["taslak".to_string()]));
    assert_eq!(s.satirlar[0].onceki_json, r#"{"taslak":true}"#);
}

#[test]
fn yerel_gecmis_satirlari_ve_sayfalar_baglantisiz() {
    let mut h = Hat::yeni("yerel-gecmis");
    let id = h.c.ekle(govde("A", None), GirdiYolu::Elle).unwrap();
    for i in 0..21 {
        h.zaman.ilerlet(DK);
        h.c.duzenle(id.clone(), None, govde(&format!("A{i}"), None)).unwrap();
    }
    h.gozlemci.al();
    h.c.gecmis_iste(id.clone(), None).unwrap();
    assert!(h.gozlemci.al().iter().any(|d| d.gecmis == vec![id.clone()]));
    let s = h.c.gecmis(id.clone()).unwrap().unwrap();
    assert!(!s.yukleniyor && s.devami && s.hata.is_none());
    assert_eq!(s.satirlar.iter().map(|s| s.rev).collect::<Vec<_>>(), (3..=22).rev().collect::<Vec<_>>());
    let ust = &s.satirlar[0];
    assert_eq!((ust.islem, ust.alanlar.clone(), ust.ts_ms), (IslemTuru::Guncelle, vec!["baslik".to_string()], SIMDI + 21 * DK));
    assert_eq!((ust.onceki_json.as_str(), ust.sonraki_json.as_str()), (r#"{"baslik":"A19"}"#, r#"{"baslik":"A20"}"#));
    assert_eq!((ust.yazar.yol, ust.yazar.tur_kokeni), (KaynakYolu::Elle, TurKokeni::Insan));

    h.c.gecmis_iste(id.clone(), Some(3)).unwrap();
    let s = h.c.gecmis(id.clone()).unwrap().unwrap();
    assert_eq!(s.satirlar.iter().map(|s| s.rev).collect::<Vec<_>>(), (1..=22).rev().collect::<Vec<_>>());
    assert!(!s.devami);
    let dogum = s.satirlar.last().unwrap();
    assert_eq!((dogum.islem, dogum.onceki_json.as_str(), dogum.ts_ms), (IslemTuru::Ekle, "{}", SIMDI));
    assert_eq!(dogum.alanlar, vec!["baslik", "durum", "hatirlatmalar", "taslak", "tur"]);

    // Açık sayfa yeni yazmayı başta görür; örnek durumunun satırı yalnız o örneği taşır.
    let spor = h.c.ekle(spor_govdesi(), GirdiYolu::Elle).unwrap();
    h.c.gecmis_iste(spor.clone(), None).unwrap();
    h.gozlemci.al();
    h.c.durum_degistir(spor.clone(), KayitDurumu::Iptal, Some("2026-11-24".into())).unwrap();
    let d = h.gozlemci.al();
    assert_eq!(d.len(), 1);
    assert_eq!((d[0].kayitlar.clone(), d[0].gecmis.clone()), (vec![spor.clone()], vec![spor.clone()]));
    let s = h.c.gecmis(spor.clone()).unwrap().unwrap();
    assert_eq!(s.satirlar.iter().map(|s| s.islem).collect::<Vec<_>>(), vec![IslemTuru::Durum, IslemTuru::Ekle]);
    let o = &s.satirlar[0];
    assert_eq!((o.ornek_tarihi.as_deref(), o.alanlar.clone()), (Some("2026-11-24"), vec!["ornek_durumu".to_string()]));
    assert_eq!((o.onceki_json.as_str(), o.sonraki_json.as_str()), (r#"{"ornek_durumu":null}"#, r#"{"ornek_durumu":"iptal"}"#));

    // Olmayan kayıt: servis gibi `kayit_bulunamadi`; geçersiz girdi bağlı kiptekiyle aynı.
    h.c.gecmis_iste("k_yok".into(), None).unwrap();
    assert_eq!(h.c.gecmis("k_yok".into()).unwrap().unwrap().hata, Some(AjandaRetNedeni::KayitBulunamadi));
    assert!(matches!(h.c.gecmis_iste(id.clone(), Some(0)), Err(CekirdekHatasi::GecersizGirdi { .. })));
    // Süreç ölünce önbellek gider, tablo kalır.
    h.sureci_oldur_ve_ac();
    assert_eq!(h.c.gecmis(id.clone()).unwrap(), None);
    h.c.gecmis_iste(id.clone(), None).unwrap();
    assert_eq!(h.c.gecmis(id).unwrap().unwrap().satirlar.len(), 20);
}

#[test]
fn yerel_kipte_servis_sinirlari_uygulanir() {
    let h = Hat::yeni("yerel-sinir");
    // Bilinmeyen dilim (`saat_dilimi_bilinmiyor`): zaman ve mutlak hatırlatma; hiçbir şey yazılmaz.
    let mut g = govde("Mars", Some(AjandaZamani::An {
        tarih: "2026-11-26".into(),
        saat: "10:00".into(),
        sure_dk: None,
        saat_dilimi: "Mars/Olympus".into(),
        ifade: None,
    }));
    assert!(matches!(h.c.ekle(g.clone(), GirdiYolu::Elle), Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "zaman.saat_dilimi"));
    g.zaman = Some(an("2026-11-26", "10:00"));
    g.hatirlatmalar = vec![Hatirlatma::Mutlak { tarih: "2026-11-26".into(), saat: "09:00".into(), saat_dilimi: "Mars/Olympus".into() }];
    assert!(matches!(h.c.ekle(g.clone(), GirdiYolu::Elle), Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "hatirlatmalar"));
    assert!(h.c.liste(ListeSorgusu { sekme: Sekme::Tarihli, kapalilar_dahil: true }).unwrap().is_empty());
    let id = h.c.ekle(govde("Dünya", Some(an("2026-11-26", "10:00"))), GirdiYolu::Elle).unwrap();
    let mut d = govde("Dünya", Some(an("2026-11-26", "10:00")));
    d.zaman = Some(AjandaZamani::Gun { tarih: "2026-11-26".into(), gun_bolumu: None, saat_dilimi: "Mars/Olympus".into(), ifade: None });
    assert!(matches!(h.c.duzenle(id.clone(), None, d), Err(CekirdekHatasi::GecersizGirdi { .. })));
    assert_eq!((kayit(&h, &id).revizyon, gecmis_sayisi(&h, &id)), (1, 1));

    // `KAYIT_ADET` (mezar taşları dahil, `kayit_siniri`): doluyken ekleme reddedilir, yer açılınca kabul.
    {
        let db = rusqlite::Connection::open(&h.yol).unwrap();
        db.execute(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
             INSERT INTO gorunen (kayit_id, json, tarihli, sira_anahtari, taslak, silindi, acik, etkin, bekleyen, olusturma_ms)
             SELECT 'k_dolgu' || i, '{}', 0, '', 0, 1, 0, 0, 0, 0 FROM n",
            [KAYIT_ADET as i64 - 1],
        )
        .unwrap();
    }
    assert!(matches!(h.c.ekle(govde("Fazla", None), GirdiYolu::Elle), Err(CekirdekHatasi::GecersizDurum { mesaj }) if mesaj.contains("kayit_siniri")));
    // Var olan kayda işlem sınırdan etkilenmez.
    h.c.durum_degistir(id.clone(), KayitDurumu::Tamam, None).unwrap();
    rusqlite::Connection::open(&h.yol).unwrap().execute("DELETE FROM gorunen WHERE kayit_id = 'k_dolgu1'", []).unwrap();
    assert!(h.c.ekle(govde("Sığdı", None), GirdiYolu::Elle).is_ok());
}

#[test]
fn yerel_kipte_eslesince_kayitlar_pc_ye_gider_kip_bagli_olur() {
    let mut h = Hat::yeni("yerel-eslesme");
    let a = h.c.ekle(govde("Dişçi", Some(an("2026-11-26", "15:00"))), GirdiYolu::Elle).unwrap();
    h.c.duzenle(a.clone(), None, govde("Dişçi (kontrol)", Some(an("2026-11-26", "16:00")))).unwrap();
    let b = h.c.ekle(govde("Fatura", None), GirdiYolu::SesliNot).unwrap();
    h.c.durum_degistir(b.clone(), KayitDurumu::Tamam, None).unwrap();
    let c = h.c.ekle(govde("Eski", None), GirdiYolu::Elle).unwrap();
    h.c.sil(c.clone()).unwrap();
    let s = h.c.ekle(spor_govdesi(), GirdiYolu::Elle).unwrap();
    h.c.durum_degistir(s.clone(), KayitDurumu::Iptal, Some("2026-11-24".into())).unwrap();
    let once: Vec<AjandaKaydi> = [&a, &b, &c, &s].iter().map(|id| kayit(&h, id)).collect();
    h.gozlemci.al();

    // Bekleyen QR yerel kipte bağlantı adresi verir; eşleşmeden önce bekleyen QR kaldırılırsa veri kalır.
    h.c.eslestirme_baslat(SahtePc::qr()).unwrap();
    assert!(h.c.baglanti_adresi().unwrap().is_some());
    h.c.eslesmeyi_kaldir().unwrap();
    assert_eq!((h.c.eslesme_durumu().unwrap(), h.c.baglanti_adresi().unwrap()), (EslesmeDurumu::Yok, None));
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!([&a, &b, &c, &s].iter().map(|id| kayit(&h, id)).collect::<Vec<_>>(), once, "yerel kipte kayıtlar silinmez");

    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert!(h.gozlemci.al().iter().any(|d| d.tumu && d.baglanti));
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0));
    // PC'de hiç olmamış mezar taşı gönderilmez (ölü kayıt PC'nin kayıt sınırını yemesin), görünen kopyadan çıkar.
    assert!(!h.pc.d.kayitlar.contains_key(&c) && h.c.kayit(c.clone()).unwrap().is_none());
    for (id, yerel) in [&a, &b, &s].iter().zip([&once[0], &once[1], &once[3]]) {
        let g = h.c.kayit((*id).clone()).unwrap().unwrap();
        assert!(!g.bekleyen);
        let pc = &h.pc.d.kayitlar[*id];
        assert_eq!(&g.kayit, pc, "telefon ile PC aynı");
        assert_eq!(
            (&pc.baslik, &pc.zaman, pc.durum, pc.silindi, &pc.ornekler, pc.kaynak.yol),
            (&yerel.baslik, &yerel.zaman, yerel.durum, yerel.silindi, &yerel.ornekler, yerel.kaynak.yol),
            "yerel hal PC'ye aynen gitti"
        );
    }
    // Bundan sonrası bağlı kip: işlem kuyrukla gider.
    h.kopar();
    let yeni = h.c.ekle(govde("Bağlı", None), GirdiYolu::Elle).unwrap();
    assert!(h.c.kayit(yeni).unwrap().unwrap().bekleyen);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 1);
}

#[test]
fn bagli_kip_degismez_kuyruk_bekleyen_ve_canli_gecmis() {
    let mut h = Hat::yeni("bagli-ayni");
    h.eslestir();
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    h.kopar();
    let id = h.c.ekle(govde("Çevrimdışı", None), GirdiYolu::Elle).unwrap();
    let g = h.c.kayit(id.clone()).unwrap().unwrap();
    assert!(g.bekleyen);
    assert_eq!(g.kayit.revizyon, 1);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 1);
    assert_eq!(gecmis_sayisi(&h, &id), 0, "bağlı kipte yerel geçmiş yazılmaz");
    assert!(matches!(h.c.gecmis_iste(id.clone(), None), Err(CekirdekHatasi::GecersizDurum { .. })));
    h.baglan();
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert_eq!(h.c.kayit(id.clone()).unwrap().unwrap().kayit, h.pc.d.kayitlar[&id]);
    // Eşleşme kaldırılınca (D2) bağlı kip koparılır: kayıt kalır, kip yerel olur, yazma kuyruksuz sürer.
    h.c.eslesmeyi_kaldir().unwrap();
    h.kopar();
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!(h.c.kayit(id.clone()).unwrap().unwrap().kayit, h.pc.d.kayitlar[&id]);
    let sonra = h.c.ekle(govde("Eşleşmesiz", None), GirdiYolu::Elle).unwrap();
    assert!(!h.c.kayit(sonra).unwrap().unwrap().bekleyen, "yerel kip kuyruksuz yazar");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
}
