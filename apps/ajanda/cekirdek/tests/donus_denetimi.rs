//! D2 bağımsız gözden geçirmesinin ikinci tur bulguları uçtan uca: köprünün açık yüzeyi + sahte kabuklar +
//! sahte PC (`ortak`).
//!
//! - Yedekten dönme yazım kimliğiyle (revizyon + PC saatiyle `guncelleme_ms`) ve depo düzeyindeki kanıtla
//!   bulunur, revizyonun büyüklüğüyle değil: dönüşten sonra yeniden verilen küçük, aynı ya da büyük numara
//!   telefonun bildiği onaylı değişikliği yitirmez; PC'nin dönüşten sonraki silmesi ve eklediği alan kalır.
//! - Bağlı kipte servisin iz kararı (telefonun `son_rev` yazımı PC'de yok) da kanıttır.
//! - Dönmemiş servisle tam telafi (yerel kipten bağlanma): başka yazarın ilerlettiği ya da sildiği,
//!   telefonun dokunmadığı kayıt için hiçbir işlem gitmez.
//! - Şema genişlemesi: temelin bilmediği alan (aynı revizyonda PC'de beliren) karşılaştırmaya girmez, PC'den
//!   silinmez.
//! - Açılış onarımının hatası çekirdeği açılmaz kılmaz; iz `meta.onarim_hatasi`'nda.
//! - Okunamayan yerel kayıt PC'de de varsa tek sonuç: görünen kopyada PC'nin hali, ret listesinde o kaydın
//!   düzeltmesi (düzeltme ikinci kayıt doğurmaz); içerik aynıysa ret girdisi yok.

mod ortak;

use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::CalismaKipi;
use ajanda_cekirdek::model::{AjandaKaydi, AjandaZamani, GirdiYolu, IslemTuru, KuyrukRetNedeni, Tekrar, TekrarSikligi};
use ortak::*;

fn depo(h: &Hat) -> Depo {
    Depo::ac(&h.yol).unwrap()
}

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

fn pc_ile_ayni(h: &Hat, idler: &[&str]) {
    for id in idler {
        assert_eq!(&kayit(h, id), &h.pc.d.kayitlar[*id], "{id}: telefon ile PC aynı");
    }
}

fn bitti(h: &Hat) {
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
}

/// Eşleşmiş hat: `k_w` (09:00, rev 1), `k_x` (15:00, rev 2), `k_v` (rev 3); yedek bu anda alınır. Sonra PC'de
/// iki onaylı değişiklik telefona iner: yeni `k_n` (rev 4), `k_x`'in başlığı (rev 5). Döner: yedek.
fn yedekten_sonra_iki_degisiklik(h: &mut Hat) -> PcDurumu {
    h.pc.disaridan_ekle("k_w", &govde("W", Some(an("2026-11-26", "09:00"))), false);
    h.pc.disaridan_ekle("k_x", &govde("X", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_v", &govde("V", None), false);
    h.eslestir();
    let yedek = h.pc.d.clone();
    h.zaman.ilerlet(DK);
    let k = h.pc.disaridan_ekle("k_n", &govde("N", None), false);
    h.pc_degisti(k);
    let k = h.pc.disaridan_degistir("k_x", |k| k.baslik = "X (onaylı)".into());
    h.pc_degisti(k);
    assert_eq!((h.pc.d.rev, kayit(h, "k_x").revizyon), (5, 5));
    yedek
}

fn yedege_don(h: &mut Hat, yedek: PcDurumu) {
    h.pc.d = yedek;
    h.zaman.ilerlet(DK);
}

fn w_ilerler(h: &mut Hat) -> i64 {
    h.pc.disaridan_degistir("k_w", |k| k.zaman = Some(an("2026-11-26", "10:00"))).revizyon
}

fn x_aciklama(h: &mut Hat, metin: &str) -> i64 {
    h.zaman.ilerlet(1);
    h.pc.disaridan_degistir("k_x", |k| k.aciklama = Some(metin.into())).revizyon
}

/// Bulgu 1 (a), (b) ve çakışan numara, yerel kipten bağlanırken. Telefon `k_x`'i rev 5'te biliyor; servis rev
/// 3'e döndü. Dönüşten sonra `k_x` 4 (küçük), 5 (aynı numara, başka zaman) ya da 6 (büyük) aldı ve her
/// seferinde PC ona açıklama ekledi; `k_w` (yedekte kalmış) dönüşten sonra ilerledi. Sonuç alan alan: yitirilen
/// onaylı başlık geri gider, PC'nin eklediği açıklama kalır, `k_w`'nin yeni saati kalır, yitirilen `k_n`
/// geri gider. İki yönde de sessiz kayıp yok.
#[test]
fn yedekten_donen_serviste_numara_ne_olursa_olsun_alan_alan_birlesir() {
    for (ad, beklenen_x_rev) in [("kucuk", 4), ("ayni", 5), ("buyuk", 6)] {
        let mut h = Hat::yeni(&format!("donus-{ad}"));
        let yedek = yedekten_sonra_iki_degisiklik(&mut h);
        h.c.baglantiyi_kopar().unwrap();
        h.pompala();
        // Telefonda yerel bir değişiklik de var.
        h.c.duzenle("k_v".into(), None, govde("V (telefon)", None)).unwrap();
        yedege_don(&mut h, yedek);
        let x_rev = match ad {
            "kucuk" => {
                let x = x_aciklama(&mut h, "PC'nin notu");
                w_ilerler(&mut h);
                x
            }
            "ayni" => {
                w_ilerler(&mut h);
                x_aciklama(&mut h, "PC'nin notu")
            }
            _ => {
                w_ilerler(&mut h);
                x_aciklama(&mut h, "ilk not");
                x_aciklama(&mut h, "PC'nin notu")
            }
        };
        assert_eq!(x_rev, beklenen_x_rev, "{ad}");
        h.eslestir();
        bitti(&h);
        assert_eq!(h.pc.son_welcome_tam, Some(true));
        assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0, "{ad}");
        let x = &h.pc.d.kayitlar["k_x"];
        assert_eq!(
            (x.baslik.as_str(), x.aciklama.as_deref(), &x.zaman),
            ("X (onaylı)", Some("PC'nin notu"), &Some(an("2026-11-26", "15:00"))),
            "{ad}: yitirilen başlık geri gitti, PC'nin açıklaması kaldı"
        );
        assert_eq!(h.pc.d.kayitlar["k_w"].zaman, Some(an("2026-11-26", "10:00")), "{ad}: yedekte kalmış, sonra ilerlemiş kayıt ezilmedi");
        assert_eq!(h.pc.d.kayitlar["k_n"].baslik, "N", "{ad}: yitirilen kayıt geri gitti");
        assert_eq!(h.pc.d.kayitlar["k_v"].baslik, "V (telefon)");
        pc_ile_ayni(&h, &["k_w", "k_x", "k_v", "k_n"]);
    }
}

/// Bulgu 1 (a), silme: dönüşten sonra asistan `k_x`'i sildi (rev 4). Mezar taşı diriltilmez; telefonun
/// yitirilen onaylı hali düzeltme gövdesiyle ret listesine düşer.
#[test]
fn donusten_sonra_silinen_kayit_diriltilmez_onayli_hal_ret_listesinde() {
    let mut h = Hat::yeni("donus-sil");
    let yedek = yedekten_sonra_iki_degisiklik(&mut h);
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    yedege_don(&mut h, yedek);
    assert_eq!(h.pc.disaridan_degistir("k_x", |k| k.silindi = true).revizyon, 4);
    h.eslestir();
    bitti(&h);
    assert!(h.pc.d.kayitlar["k_x"].silindi, "diriltilmedi");
    pc_ile_ayni(&h, &["k_w", "k_x", "k_v", "k_n"]);
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 1, "{ret:?}");
    assert_eq!((ret[0].kayit_id.as_str(), ret[0].islem, ret[0].neden), ("k_x", IslemTuru::Guncelle, KuyrukRetNedeni::KayitSilinmis));
    assert_eq!(ret[0].govde.as_ref().unwrap().baslik, "X (onaylı)");
}

/// Bulgu 1, bağlı kip: dönüşten sonra yalnız `k_x` yazıldı ve iki kez (4 yeniden verildi ve geçildi, kayıt
/// 5'te). Kopyalarda kayıp kanıtı yoktur; servisin iz kararı (telefonun rev 4 yazımı PC'de yok) kanıttır.
#[test]
fn bagli_kipte_servisin_iz_karari_yitirilen_yazimi_gosterir() {
    let mut h = Hat::yeni("donus-bagli");
    h.pc.disaridan_ekle("k_w", &govde("W", None), false);
    h.pc.disaridan_ekle("k_x", &govde("X", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_v", &govde("V", None), false);
    h.eslestir();
    let yedek = h.pc.d.clone();
    h.zaman.ilerlet(DK);
    let k = h.pc.disaridan_degistir("k_x", |k| k.baslik = "X (onaylı)".into());
    h.pc_degisti(k);
    h.kopar();
    yedege_don(&mut h, yedek);
    x_aciklama(&mut h, "ilk not");
    assert_eq!(x_aciklama(&mut h, "PC'nin notu"), 5);
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(true), "iz tutmuyor");
    bitti(&h);
    let x = &h.pc.d.kayitlar["k_x"];
    assert_eq!((x.baslik.as_str(), x.aciklama.as_deref()), ("X (onaylı)", Some("PC'nin notu")));
    pc_ile_ayni(&h, &["k_w", "k_x", "k_v"]);
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
}

/// PC yitirmiş ama alan alan birleşen hal geçerli bir kayıt değil: telefonun bildiği onaylı belirsiz zaman,
/// PC'nin dönüşten sonra eklediği günlük tekrarla birleşemez (tekrar `an`/`gun` ister). Hiçbir işlem gitmez
/// (PC'nin tekrarı kaldırılmaz), görünen kopyada PC'nin hali, telefonun onaylı hali düzeltme gövdesiyle ret
/// listesinde; yerel kipten bağlanmada ve bağlı kipte.
#[test]
fn donmus_pc_ile_birlesemeyen_kayit_ret_listesine_duser() {
    for yerel in [true, false] {
        let mut h = Hat::yeni(&format!("donus-birlesemez-{yerel}"));
        h.pc.disaridan_ekle("k_w", &govde("W", None), false);
        h.pc.disaridan_ekle("k_x", &govde("X", Some(an("2026-11-26", "15:00"))), false);
        h.eslestir();
        let yedek = h.pc.d.clone();
        h.zaman.ilerlet(DK);
        let k = h.pc.disaridan_degistir("k_x", |k| k.zaman = Some(AjandaZamani::Belirsiz { ifade: "bir ara".into() }));
        h.pc_degisti(k);
        if yerel {
            h.c.baglantiyi_kopar().unwrap();
            h.pompala();
        } else {
            h.kopar();
        }
        yedege_don(&mut h, yedek);
        let gunluk = Tekrar { siklik: TekrarSikligi::Gunluk, aralik: 1, gunler: None, bitis_tarihi: None, adet: None };
        assert_eq!(h.pc.disaridan_degistir("k_x", |k| k.tekrar = Some(gunluk)).revizyon, 3, "numara yeniden verildi");
        let once = h.pc.uygulanan.len();
        if yerel {
            h.eslestir();
        } else {
            h.baglan();
        }
        bitti(&h);
        assert_eq!(h.pc.son_welcome_tam, Some(true));
        assert_eq!(h.pc.uygulanan.len(), once, "yerel={yerel}: işlem gitmedi");
        let x = &h.pc.d.kayitlar["k_x"];
        assert!(x.tekrar.is_some() && x.zaman == Some(an("2026-11-26", "15:00")), "yerel={yerel}: PC'nin hali");
        pc_ile_ayni(&h, &["k_w", "k_x"]);
        let ret = h.c.ret_listesi().unwrap();
        assert_eq!(ret.len(), 1, "yerel={yerel}: {ret:?}");
        assert_eq!((ret[0].kayit_id.as_str(), ret[0].islem, ret[0].neden), ("k_x", IslemTuru::Guncelle, KuyrukRetNedeni::TutarsizKayit));
        let g = ret[0].govde.as_ref().unwrap();
        assert_eq!((g.zaman.clone(), g.tekrar.clone()), (Some(AjandaZamani::Belirsiz { ifade: "bir ara".into() }), None), "yerel={yerel}");
    }
}

/// Bulgu 6: aynı servis, tam telafi (yerel kipten bağlanma), servis yedekten dönmemiş. Telefon hiçbir kayda
/// dokunmadı; PC'de başka yazar bir kaydı iki kez ilerletti, birini sildi, yeni kayıt ekledi: sıfır işlem.
#[test]
fn donmemis_serviste_dokunulmamis_kayit_icin_islem_gitmez() {
    let mut h = Hat::yeni("donmemis");
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_b", &govde("B", None), false);
    h.pc.disaridan_ekle("k_c", &govde("C", None), false);
    h.eslestir();
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    h.zaman.ilerlet(DK);
    h.pc.disaridan_degistir("k_a", |k| k.zaman = Some(an("2026-11-26", "17:00")));
    h.pc.disaridan_degistir("k_a", |k| k.baslik = "A (PC)".into());
    h.pc.disaridan_degistir("k_b", |k| k.silindi = true);
    h.pc.disaridan_ekle("k_d", &govde("D", None), false);
    let once = h.pc.uygulanan.len();
    h.eslestir();
    bitti(&h);
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert_eq!(h.pc.uygulanan.len(), once, "hiçbir işlem gitmedi");
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
    pc_ile_ayni(&h, &["k_a", "k_b", "k_c", "k_d"]);
    assert_eq!(h.pc.d.kayitlar["k_a"].zaman, Some(an("2026-11-26", "17:00")));
}

/// Bulgu 3: eski sürümün sakladığı temel bir alanı bilmiyor; PC aynı revizyonda (göç gibi, revizyon ve zaman
/// değişmeden) o alanı taşıyor. Yerel kipten bağlanmada (dönüş yokken ve başka kayıtta dönüş varken) ve
/// bağlı kipte (dönüş varken) PC'nin alanı silinmez, o kayıt için işlem gitmez.
#[test]
fn temelin_bilmedigi_alan_pc_den_silinmez() {
    for (ad, yerel, donus) in [("yerel", true, false), ("yerel-donus", true, true), ("bagli-donus", false, true)] {
        let mut h = Hat::yeni(&format!("genisleme-{ad}"));
        h.pc.disaridan_ekle("k_a", &govde("A", None), false);
        h.pc.disaridan_ekle("k_b", &govde("B", None), false);
        h.eslestir();
        let yedek = h.pc.d.clone();
        if donus {
            h.zaman.ilerlet(DK);
            let k = h.pc.disaridan_degistir("k_b", |k| k.baslik = "B (onaylı)".into());
            h.pc_degisti(k);
        }
        if yerel {
            h.c.baglantiyi_kopar().unwrap();
            h.pompala();
        } else {
            h.kopar();
        }
        if donus {
            yedege_don(&mut h, yedek);
        }
        let a = h.pc.d.kayitlar.get_mut("k_a").unwrap();
        a.aciklama = Some("yeni şemanın alanı".into());
        let (rev, ms) = (a.revizyon, a.guncelleme_ms);
        let once = h.pc.uygulanan.len();
        if yerel {
            h.eslestir();
        } else {
            h.baglan();
        }
        bitti(&h);
        let a = &h.pc.d.kayitlar["k_a"];
        assert_eq!((a.aciklama.as_deref(), a.revizyon, a.guncelleme_ms), (Some("yeni şemanın alanı"), rev, ms), "{ad}: alan kaldı, işlem yok");
        assert_eq!(h.pc.d.kayitlar["k_b"].baslik, if donus { "B (onaylı)" } else { "B" }, "{ad}");
        assert_eq!(h.pc.uygulanan.len(), once + usize::from(donus), "{ad}");
        pc_ile_ayni(&h, &["k_a", "k_b"]);
    }
}

/// Bulgu 4: açılış onarımı (bağlı kip + eşleşme yok) hata verirse çekirdek yine açılır, veri yerinde kalır,
/// iz `meta.onarim_hatasi`'na yazılır; sorun giderilince sonraki açılış onarır ve izi siler.
#[test]
fn acilis_onariminin_hatasi_cekirdegi_dusurmez() {
    let mut h = Hat::yeni("onarim-hatasi");
    h.pc.disaridan_ekle("k_a", &govde("A", None), false);
    h.eslestir();
    h.kopar();
    h.c.duzenle("k_a".into(), None, govde("A (telefon)", None)).unwrap();
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    let saglam: String = db.query_row("SELECT json FROM sunucu_kayitlari WHERE kayit_id = 'k_a'", [], |s| s.get(0)).unwrap();
    // Onaylanmış satır ve okunamayan PC temeli: onarım (onaylananları temele katma) hata verir.
    db.execute_batch(
        "UPDATE kuyruk SET bekledigi_rev = 9;
         UPDATE sunucu_kayitlari SET json = '{bozuk' WHERE kayit_id = 'k_a';
         DELETE FROM meta WHERE anahtar = 'eslesme';",
    )
    .unwrap();
    drop(db);
    h.sureci_oldur_ve_ac();
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli, "onarım yarım kalmadı");
    assert_eq!(kayit(&h, "k_a").baslik, "A (telefon)", "veri yerinde");
    let iz = depo(&h).meta_oku("onarim_hatasi").unwrap().expect("iz");
    let iz: serde_json::Value = serde_json::from_str(&iz).unwrap();
    assert!(iz["mesaj"].as_str().unwrap().contains("şemadan geçmedi") || iz["mesaj"].as_str().unwrap().contains("bozuk"), "{iz}");
    assert_eq!(iz["ts_ms"].as_i64(), Some(h.zaman.simdi.load(std::sync::atomic::Ordering::SeqCst)));

    rusqlite::Connection::open(&h.yol).unwrap().execute("UPDATE sunucu_kayitlari SET json = ?1 WHERE kayit_id = 'k_a'", [&saglam]).unwrap();
    h.sureci_oldur_ve_ac();
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!(kayit(&h, "k_a").baslik, "A (telefon)");
    assert_eq!(depo(&h).meta_oku("onarim_hatasi").unwrap(), None, "iz silindi");
}

/// Bulgu 5: okunamayan görünen kayıt PC'de de var. Tek sonuç: görünen kopyada PC'nin hali, ret listesinde o
/// kaydın düzeltmesi; Kotlin'in "düzelt"i (`RetListesi.hedef`: `guncelle` + duran kayıt = aynı kayıt) aynı
/// kaydı düzeltir, ikinci kayıt doğmaz. Bozukluğu içerik dışında olan (içerik PC'ninkiyle aynı) satır için
/// ret girdisi yoktur.
#[test]
fn pc_de_de_olan_bozuk_kayit_tek_sonuc_verir() {
    let mut h = Hat::yeni("bozuk-pcde");
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.pc.disaridan_ekle("k_y", &govde("Y", None), false);
    h.eslestir();
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    h.c.duzenle("k_x".into(), None, govde("X (telefon)", None)).unwrap();
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    for id in ["k_x", "k_y"] {
        let json: String = db.query_row("SELECT json FROM gorunen WHERE kayit_id = ?1", [id], |s| s.get(0)).unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&json).unwrap();
        v.as_object_mut().unwrap().remove("kaynak");
        db.execute("UPDATE gorunen SET json = ?2 WHERE kayit_id = ?1", [id, &v.to_string()]).unwrap();
    }
    drop(db);
    h.eslestir();
    bitti(&h);
    pc_ile_ayni(&h, &["k_x", "k_y"]);
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 1, "{ret:?}");
    let r = &ret[0];
    assert_eq!((r.kayit_id.as_str(), r.islem, r.neden), ("k_x", IslemTuru::Guncelle, KuyrukRetNedeni::TutarsizKayit));
    // Kotlin'in düzeltmesi: girdi `guncelle`, kayıt duruyor ve silinmemiş: aynı kayda.
    assert!(!kayit(&h, "k_x").silindi);
    let kayit_sayisi = depo(&h).gorunen_sayisi().unwrap();
    h.c.duzenle(r.kayit_id.clone(), None, r.govde.clone().unwrap()).unwrap();
    h.c.ret_at(r.islem_id.clone()).unwrap();
    h.pompala();
    assert_eq!(depo(&h).gorunen_sayisi().unwrap(), kayit_sayisi, "ikinci kayıt doğmadı");
    assert_eq!(h.pc.d.kayitlar.len(), 2);
    assert_eq!(h.pc.d.kayitlar["k_x"].baslik, "X (telefon)");
    pc_ile_ayni(&h, &["k_x", "k_y"]);
    assert!(h.c.ret_listesi().unwrap().is_empty());
    // Yerel kip sonrası olağan: yeni kayıt eklenebilir.
    h.c.ekle(govde("Z", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    assert_eq!(h.pc.d.kayitlar.len(), 3);
}
