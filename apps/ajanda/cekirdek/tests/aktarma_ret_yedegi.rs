//! D3 gözden geçirmesi Y4 ve V1: ret listesi yedeğe girer (biçim 2/3 `retler`) ve içe aktarmada ret listesine
//! geri yazılır; hiçbir veri yalnız telefonda kalmaz. Biçim 3 satırı bütünüyle taşır (`islem_json` ve yerel
//! neden bayt bayt; gövdesiz girdi de). Biçim sürümü kuralı: ret girdisi yoksa 1, yalnız biçim 2'nin
//! taşıyabildiği girdiler varsa 2, yoksa 3; daha yenisi açık hatayla reddedilir. Aynı `islem_id` yinelenmez.
//! Kaydı yedekten sonra değişen girdi alınır ve işaretlenir (V2), düzeltmesi var olan kaydı ezmez
//! (`ret_duzelt`). Düzeltme reddedilen işlemin v3 kısmını korur. Ret listesinin sınırı (r2), okunamayan satırın
//! olduğu gibi yazımı (r6). Kişisel veri yoktur.

mod ortak;

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{CalismaKipi, V3DegisiklikOzeti};
use ajanda_cekirdek::model::json::Yazici;
use ajanda_cekirdek::model::surum::AJANDA_SURUMU;
use ajanda_cekirdek::model::sinirlar::ajanda::KAYIT_ADET;
use ajanda_cekirdek::model::{
    AjandaDegisiklik, AjandaIslem, Alan, GirdiYolu, IslemTuru, KuyrukRetNedeni, V3Alanlari, V3Degisikligi,
};
use ortak::*;
use serde_json::{Value, json};

fn json_belge(h: &Hat) -> Value {
    serde_json::from_str(&h.c.disa_aktar().unwrap().belge).unwrap()
}

/// Görünen satırın `kaynak`'ını silerek okunamaz yapar.
fn goruneni_boz(h: &Hat, id: &str) {
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    let json: String = db.query_row("SELECT json FROM gorunen WHERE kayit_id = ?1", [id], |s| s.get(0)).unwrap();
    let mut v: Value = serde_json::from_str(&json).unwrap();
    v.as_object_mut().unwrap().remove("kaynak");
    db.execute("UPDATE gorunen SET json = ?2 WHERE kayit_id = ?1", [id, &v.to_string()]).unwrap();
}

/// Ret listesine doğrudan satır (servisin reddi, D4, Kol C'nin attığı değişiklik gibi; süreç sonra açılmalı ya
/// da okuma bağlantısı yeniden okur).
fn ret_satiri_ekle(h: &Hat, islem_id: &str, kayit_id: &str, islem_json: &str, neden: &str, govde_json: Option<&str>) {
    rusqlite::Connection::open(&h.yol)
        .unwrap()
        .execute(
            "INSERT INTO ret_listesi (islem_id, kayit_id, islem_json, neden, ts_ms, govde_json, sira) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![islem_id, kayit_id, islem_json, neden, SIMDI, govde_json],
        )
        .unwrap();
}

/// Ret listesine gövdesiz bir girdi (servisin reddettiği `sil`): düzeltilemez, yalnız atılabilir.
fn govdesiz_ret_ekle(h: &Hat, islem_id: &str, kayit_id: &str) {
    let islem = AjandaIslem::Sil { kayit_id: kayit_id.into() }.json().to_string();
    ret_satiri_ekle(h, islem_id, kayit_id, &islem, "kayit_silinmis", None);
}

/// Düzeltme gövdesinin metni (modelin yazımıyla).
fn govde_json(baslik: &str) -> String {
    govde(baslik, None).alanlari_yaz(Yazici::yeni()).bitir().to_string()
}

/// Ret listesinin satırları, sırası dışında (içe aktarma `sira`'yı 0 yazar).
type Satir = (String, String, String, String, i64, Option<String>);
fn satirlar(h: &Hat) -> Vec<Satir> {
    let mut l: Vec<Satir> = Depo::ac(&h.yol)
        .unwrap()
        .ret_listesi()
        .unwrap()
        .into_iter()
        .map(|r| (r.islem_id, r.kayit_id, r.islem_json, r.neden, r.ts_ms, r.govde_json))
        .collect();
    l.sort();
    l
}

/// Yerel kipte iki kayıt; biri okunamaz olup dosyadaki halle onarılmış (eski metni gövdesiyle ret listesinde,
/// `tutarsiz_kayit`), bir de gövdesiz ret girdisi.
fn retli_telefon(ad: &str) -> Hat {
    let mut a = Hat::yeni(ad);
    let x = a.c.ekle(govde("X (telefondaki)", None), GirdiYolu::Elle).unwrap();
    a.c.ekle(govde("Y", None), GirdiYolu::Elle).unwrap();
    let mut v = json_belge(&a);
    v["kayitlar"].as_array_mut().unwrap().iter_mut().find(|k| k["kayit_id"] == x.as_str()).unwrap()["baslik"] = json!("X (dosyadaki)");
    goruneni_boz(&a, &x);
    a.sureci_oldur_ve_ac();
    assert!(a.ice_aktar_onayla(&v.to_string()).uygulandi);
    govdesiz_ret_ekle(&a, "i_sil_1", &x);
    assert_eq!(a.c.ret_listesi().unwrap().len(), 2);
    a
}

/// Belge: kayıtları ve ret öğeleri metin olarak (anahtarlar sıralı, sıkışık).
fn belge_metni(bicim: i64, kayitlar: &str, retler: &str) -> String {
    format!(
        r#"{{"bicim":"eren_ajanda_yedegi","bicim_surumu":{bicim},"bolgeler":[],"ekler":[],"kayitlar":[{kayitlar}],"kip":"yerel","olusturma_ms":{SIMDI},"retler":[{retler}],"sozlesme_surumu":{AJANDA_SURUMU},"uygulama_surumu":"0.1.0"}}"#
    )
}

fn red(h: &Hat, metin: &str) -> (String, String) {
    match h.c.ice_aktarma_onizlemesi(metin.to_string()) {
        Err(CekirdekHatasi::GecersizGirdi { alan, neden }) => (alan, neden),
        s => panic!("reddedilmedi: {s:?}"),
    }
}

fn tutarsiz_oge(v: &Value) -> Value {
    v["retler"].as_array().unwrap().iter().find(|o| o["neden"] == "tutarsiz_kayit").unwrap().clone()
}

/// Gidiş dönüş: ret listesinin her satırı (gövdesizi de) belgeye girer, satır bayt bayt geri gelir: okunamayan
/// kaydın metni (`islem_json`: durumu, örnekleri, ileri sürüm alanları onunla) ve gövdesiz `sil` reddi dahil.
/// İkinci içe aktarmada yinelenmez; yeni telefonun yedeği aynı öğeleri yazar. Yalnız türü taşıyan girdiler
/// biçim 2 yazar, ret girdisi olmayan telefon biçim 1.
#[test]
fn ret_girdisi_yedege_girer_ve_geri_yazilir() {
    let a = retli_telefon("ret-a");
    let d = a.c.disa_aktar().unwrap();
    assert_eq!((d.ret_yedekte, d.ret_listesinde, d.ice_aktarma_sinirini_asiyor, d.bicim_surumu), (2, 0, false, 3));
    let v: Value = serde_json::from_str(&d.belge).unwrap();
    assert_eq!(v["bicim_surumu"], json!(3));
    assert_eq!(v.to_string(), d.belge, "sıkışık, anahtarlar sıralı");
    let oge = tutarsiz_oge(&v);
    let kaynak = a.c.ret_listesi().unwrap().into_iter().find(|r| r.govde.is_some()).unwrap();
    assert_eq!((oge["islem_id"].as_str(), oge["islem"].as_str()), (Some(kaynak.islem_id.as_str()), Some("guncelle")));
    assert_eq!(oge["govde"]["baslik"], json!("X (telefondaki)"));
    assert!(oge["islem_json"].as_str().unwrap().contains("X (telefondaki)"), "kaydın hali olduğu gibi");

    let mut b = Hat::yeni("ret-b");
    b.gozlemci.al();
    let p = b.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    assert_eq!((p.toplam, p.yeni, p.ret_listesine_gelecek, p.ret_gecersiz, p.ret_sonra_degisen), (2, 2, 2, 0, 0));
    assert!(b.c.ice_aktar(d.belge.clone(), Some(p.iz)).unwrap().uygulandi);
    assert!(b.gozlemci.al().iter().any(|g| g.ret_listesi));
    assert_eq!(satirlar(&b), satirlar(&a), "satırlar bayt bayt");
    let gelen = b.c.ret_listesi().unwrap();
    let r = gelen.iter().find(|r| r.islem_id == kaynak.islem_id).unwrap();
    assert_eq!((r.islem, r.neden, r.ts_ms, r.kayit_sonra_degisti), (IslemTuru::Guncelle, KuyrukRetNedeni::TutarsizKayit, kaynak.ts_ms, false));
    assert_eq!(r.govde, kaynak.govde, "gövde kaybolmadı");
    // İkinci içe aktarma: aynı `islem_id` yinelenmez.
    let p = b.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    assert_eq!((p.ayni, p.ret_listesine_gelecek, p.ret_gecersiz), (2, 0, 0));
    assert!(b.c.ice_aktar(d.belge.clone(), Some(p.iz)).unwrap().uygulandi);
    assert_eq!(b.c.ret_listesi().unwrap().len(), 2);
    // Yeni telefonun yedeği aynı öğeleri yazar (veri bir telefondan ötekine kaybolmadan geçer).
    assert_eq!(json_belge(&b)["retler"], v["retler"]);
    // Ret girdileri atılınca biçim 1'e döner (eski uygulama da okur).
    for r in b.c.ret_listesi().unwrap() {
        b.c.ret_at(r.islem_id).unwrap();
    }
    let d1 = b.c.disa_aktar().unwrap();
    let v1: Value = serde_json::from_str(&d1.belge).unwrap();
    assert_eq!((v1["bicim_surumu"].clone(), v1.get("retler").is_none(), d1.ret_yedekte, d1.bicim_surumu), (json!(1), true, 0, 1));
    b.sureci_oldur_ve_ac();

    // Biçim 2 belgesinden gelen (yalnız türü taşıyan) girdi yine biçim 2 yazılır.
    let mut iki = oge.clone();
    iki.as_object_mut().unwrap().remove("islem_json");
    let c = Hat::yeni("ret-iki");
    assert!(c.ice_aktar_onayla(&belge_metni(2, "", &iki.to_string())).uygulandi);
    let d2 = c.c.disa_aktar().unwrap();
    assert_eq!((d2.bicim_surumu, d2.ret_yedekte), (2, 1));
    assert_eq!(serde_json::from_str::<Value>(&d2.belge).unwrap()["retler"][0], iki);

    // Bağlı kipte de ret listesine yazılır.
    let mut e = Hat::yeni("ret-bagli");
    e.eslestir();
    let p = e.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    assert_eq!((p.kip, p.ret_listesine_gelecek), (CalismaKipi::Bagli, 2));
    assert!(e.c.ice_aktar(d.belge, Some(p.iz)).unwrap().uygulandi);
    assert_eq!(satirlar(&e), satirlar(&a));
}

/// r1: gövdesi çözülemeyen ham metin (okunamayan kuyruk satırı ya da kaydın JSON olmayan metni) de bayt bayt
/// taşınır; Kol C'nin attığı ertelenen değişiklik (`islem_json` sözleşme JSON'u + üst düzeyde taban bilgisi,
/// neden yerel ad) olduğu gibi gider; kapalı listede olmayan yerel neden de korunur.
#[test]
fn ham_metin_ve_yerel_neden_olduguyla_tasinir() {
    let mut a = Hat::yeni("ret-ham-a");
    let x = a.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    ret_satiri_ekle(&a, "i_ham", &x, "bozuk { metin \u{1F600}", "tutarsiz_kayit", None);
    let mut atilan: Value = AjandaIslem::Guncelle {
        kayit_id: x.clone(),
        temel_revizyon: 1,
        degisiklik: AjandaDegisiklik { v3: V3Degisikligi { simge: Alan::Deger("ev".into()), ..Default::default() }, ..Default::default() },
    }
    .json();
    atilan["atma_tabani"] = json!({"simge": null});
    let atilan = format!("{atilan} ");
    ret_satiri_ekle(&a, "i_atilan", &x, &atilan, "ertelenen_atildi_yollanmis", Some(&govde_json("X")));
    ret_satiri_ekle(&a, "i_yeni_ad", &x, &AjandaIslem::Sil { kayit_id: x.clone() }.json().to_string(), "gelecekteki_bir_neden", None);
    a.sureci_oldur_ve_ac();
    let d = a.c.disa_aktar().unwrap();
    assert_eq!((d.ret_yedekte, d.ret_listesinde, d.bicim_surumu), (3, 0, 3));
    let b = Hat::yeni("ret-ham-b");
    assert!(b.ice_aktar_onayla(&d.belge).uygulandi);
    assert_eq!(satirlar(&b), satirlar(&a), "satırlar bayt bayt");
    let atilan_g = b.c.ret_listesi().unwrap().into_iter().find(|r| r.islem_id == "i_atilan").unwrap();
    assert!(atilan_g.ertelenen_atildi && atilan_g.ulasmis_olabilir, "{atilan_g:?}");
}

/// Her ret öğesi ayrı okunur: şemadan geçmeyen ve dosyada `islem_id`'si yinelenen geçersizdir, ötekiler
/// uygulanır. 256 KiB üstü öğe ağaca çevrilmeden geçersiz sayılır, içindeki sözdizimi hatası bütün belgeyi
/// reddeder. İz ret öğelerini kapsar: önizlemeden sonra aynı `islem_id` telefona düşerse eski izle uygulanmaz.
#[test]
fn ret_ogeleri_tek_tek_okunur() {
    let a = retli_telefon("ret-oge-a");
    let v = json_belge(&a);
    let gecerli = tutarsiz_oge(&v);
    let mut baska = gecerli.clone();
    baska["islem_id"] = json!("i_baska");
    let mut bicimsiz_neden = gecerli.clone();
    bicimsiz_neden["islem_id"] = json!("i_neden");
    bicimsiz_neden["neden"] = json!("Gizli Başlık");
    let mut fazla_alan = gecerli.clone();
    fazla_alan["islem_id"] = json!("i_fazla");
    fazla_alan["sira"] = json!(1);
    let mut yanlis_isaret = gecerli.clone();
    yanlis_isaret["islem_id"] = json!("i_isaret");
    yanlis_isaret["kayit_sonra_degisti"] = json!(false);
    let buyuk = format!(r#"{{"islem_id":"i_buyuk","dolgu":"{}"}}"#, "x".repeat(256 * 1024));
    let ogeler = [
        gecerli.to_string(),
        baska.to_string(),
        bicimsiz_neden.to_string(),
        fazla_alan.to_string(),
        yanlis_isaret.to_string(),
        gecerli.to_string(),
        buyuk.clone(),
        "0".into(),
    ];
    let metin = belge_metni(3, "", &ogeler.join(","));
    let b = Hat::yeni("ret-oge-b");
    let p = b.c.ice_aktarma_onizlemesi(metin.clone()).unwrap();
    assert_eq!((p.toplam, p.ret_listesine_gelecek, p.ret_gecersiz), (0, 2, 6));
    // İz ret öğesini kapsar: başka içerikli öğe başka iz.
    let mut degisik = baska.clone();
    degisik["ts_ms"] = json!(SIMDI - 1);
    let p_degisik = b.c.ice_aktarma_onizlemesi(metin.replace(&baska.to_string(), &degisik.to_string())).unwrap();
    assert_ne!(p_degisik.iz, p.iz);
    assert!(b.c.ice_aktar(metin.clone(), Some(p.iz.clone())).unwrap().uygulandi);
    let mut idler: Vec<String> = b.c.ret_listesi().unwrap().into_iter().map(|r| r.islem_id).collect();
    idler.sort();
    assert_eq!(idler, [gecerli["islem_id"].as_str().unwrap().to_string(), "i_baska".to_string()]);
    // Önizlemeden sonra telefonda aynı `islem_id` belirdi: sınıf değişti, eski iz uygulanmaz.
    let c = Hat::yeni("ret-oge-c");
    let p = c.c.ice_aktarma_onizlemesi(metin.clone()).unwrap();
    govdesiz_ret_ekle(&c, "i_baska", "k_x");
    let s = c.c.ice_aktar(metin.clone(), Some(p.iz.clone())).unwrap();
    assert!(!s.uygulandi);
    assert_eq!(s.plan.ret_listesine_gelecek, 1);
    assert_eq!(c.c.ret_listesi().unwrap().len(), 1, "hiçbir şey yazılmadı");
    // Büyük öğenin içindeki sözdizimi hatası bütün belgeyi reddeder.
    let bozuk = belge_metni(3, "", &buyuk.replace(r#""dolgu":"#, r#""dolgu" "#));
    assert!(red(&b, &bozuk).1.starts_with("JSON değil"));
}

/// Biçim sürümü kuralı: biçim 1'de `retler` bilinmeyen alandır, 2 ve 3'te zorunlu ve dizidir; biçim 2'nin
/// öğesi satırın metnini ve yerel nedeni taşımaz (öğe geçersiz); biçim 4 daha yenidir (daha düşük biçim okuyan
/// eski uygulama da yenisini böyle reddeder). Öğe sınırı (`KAYIT_ADET`) tam sınırda geçer, bir fazlası ağaca
/// çevrilmeden reddedilir.
#[test]
fn ret_bicim_surumu_kurali() {
    let h = Hat::yeni("ret-surum");
    for bicim in [2, 3] {
        let bos = belge_metni(bicim, "", "");
        assert!(h.c.ice_aktarma_onizlemesi(bos.clone()).is_ok());
        assert_eq!(red(&h, &bos.replace(r#""retler":[],"#, "")), ("retler".into(), "zorunlu alan yok".into()));
        assert_eq!(red(&h, &bos.replace(r#""retler":[]"#, r#""retler":{}"#)), ("retler".into(), "dizi değil".into()));
    }
    assert_eq!(red(&h, &belge_metni(1, "", "")), ("retler".into(), "bilinmeyen alan".into()));
    let (alan, neden) = red(&h, &belge_metni(4, "", ""));
    assert!(alan == "bicim_surumu" && neden.starts_with("daha yeni"), "{alan}: {neden}");
    // Biçim 3 öğesi biçim 2 belgesinde geçersizdir.
    let a = retli_telefon("ret-surum-a");
    let oge = tutarsiz_oge(&json_belge(&a)).to_string();
    let p2 = h.c.ice_aktarma_onizlemesi(belge_metni(2, "", &oge)).unwrap();
    let p3 = h.c.ice_aktarma_onizlemesi(belge_metni(3, "", &oge)).unwrap();
    assert_eq!((p2.ret_gecersiz, p2.ret_listesine_gelecek, p3.ret_gecersiz, p3.ret_listesine_gelecek), (1, 0, 0, 1));
    let tam = belge_metni(3, "", &vec!["0"; KAYIT_ADET].join(","));
    let p = h.c.ice_aktarma_onizlemesi(tam).unwrap();
    assert_eq!((p.ret_gecersiz as usize, p.ret_listesine_gelecek), (KAYIT_ADET, 0));
    let fazla = belge_metni(3, "", &vec!["0"; KAYIT_ADET + 1].join(","));
    assert_eq!(red(&h, &fazla), ("retler".into(), format!("çok fazla öğe (en çok {KAYIT_ADET})")));
    // Biçim 1'deki dev `retler` de sayılır (tarama durur), ağaca çevrilmez.
    let bir = fazla.replace(r#""bicim_surumu":3"#, r#""bicim_surumu":1"#);
    assert_eq!(red(&h, &bir).0, "retler");
}

/// V2 (yerel kip, eski T1): kaydı yedekten sonra değişen girdi alınır ama işaretlenir; düzeltmesi var olan
/// kaydı ezmez, yeni kayıt ekler. Kullanıcı girdiyi düzeltip attı, kayıt sonra yine değişti; eski yedek
/// içe aktarılınca kayıt "daha yeni kazanır"la atlanır, girdi `kayit_sonra_degisti` ile gelir (`ret_bayat` 0).
/// Kayıt değişmediyse (girdi yalnız atıldı) girdi işaretsiz gelir. Dosyada kaydın geçerli hali yoksa ama kayıt
/// telefondaysa saat kaymasına bakılmaz: girdinin anı ileri de geri de olsa işaretlenir.
#[test]
fn sonra_degisen_kaydin_girdisi_isaretle_gelir() {
    let a = retli_telefon("ret-bayat");
    let eski = a.c.disa_aktar().unwrap().belge;
    let r = a.c.ret_listesi().unwrap().into_iter().find(|r| r.govde.is_some()).unwrap();
    let x = r.kayit_id.clone();

    // Girdi yalnız atıldı (kayıt değişmedi): eski yedek onu işaretsiz geri getirir.
    a.c.ret_at(r.islem_id.clone()).unwrap();
    let p = a.c.ice_aktarma_onizlemesi(eski.clone()).unwrap();
    assert_eq!((p.ayni, p.ret_listesine_gelecek, p.ret_sonra_degisen, p.ret_bayat), (2, 1, 0, 0));

    // Kullanıcı düzeltti (kayda uygulandı), kayıt sonra yine düzenlendi.
    a.zaman.ilerlet(DK);
    a.c.duzenle(x.clone(), None, r.govde.clone().unwrap()).unwrap();
    a.zaman.ilerlet(DK);
    a.c.duzenle(x.clone(), None, govde("X (en yeni)", None)).unwrap();

    let p = a.c.ice_aktarma_onizlemesi(eski.clone()).unwrap();
    assert_eq!((p.atlanacak, p.ayni, p.ret_listesine_gelecek, p.ret_sonra_degisen, p.ret_bayat, p.ret_gecersiz), (1, 1, 1, 1, 0, 0));
    assert!(a.c.ice_aktar(eski.clone(), Some(p.iz)).unwrap().uygulandi);
    let g = a.c.ret_listesi().unwrap().into_iter().find(|g| g.islem_id == r.islem_id).expect("girdi geldi");
    assert!(g.kayit_sonra_degisti);
    assert_eq!(a.c.kayit(x.clone()).unwrap().unwrap().kayit.baslik, "X (en yeni)");
    // İşaret yedekle taşınır (biçim 3).
    let d = a.c.disa_aktar().unwrap();
    assert_eq!(tutarsiz_oge(&serde_json::from_str(&d.belge).unwrap())["kayit_sonra_degisti"], json!(true));
    // Düzeltme var olan kaydı ezmez: yeni kayıt doğar, girdi çıkar, işareti de.
    let yeni = a.c.ret_duzelt(g.islem_id.clone(), g.govde.clone().unwrap()).unwrap();
    assert_ne!(yeni, x);
    assert_eq!(a.c.kayit(x.clone()).unwrap().unwrap().kayit.baslik, "X (en yeni)");
    assert_eq!(a.c.kayit(yeni).unwrap().unwrap().kayit.baslik, "X (telefondaki)");
    assert!(a.c.ret_listesi().unwrap().iter().all(|g| g.islem_id != r.islem_id));
    assert!(Depo::ac(&a.yol).unwrap().ret_sonra_degisenler().unwrap().is_empty());

    // Dosyada kaydın geçerli hali yok: telefonda varsa girdinin anı ne olursa olsun işaretli (saat kayması).
    let mut v: Value = serde_json::from_str(&eski).unwrap();
    v["kayitlar"].as_array_mut().unwrap().retain(|k| k["kayit_id"] != x.as_str());
    for ts in [SIMDI - 30 * 24 * SAAT, SIMDI + 3 * DK, SIMDI + 30 * 24 * SAAT] {
        for o in v["retler"].as_array_mut().unwrap() {
            o["ts_ms"] = json!(ts);
        }
        let p = a.c.ice_aktarma_onizlemesi(v.to_string()).unwrap();
        assert_eq!((p.ret_listesine_gelecek, p.ret_sonra_degisen), (1, 1), "ts {ts}");
    }
    // Kayıt telefonda da yoksa taze.
    let c = Hat::yeni("ret-bayat-c");
    let p = c.c.ice_aktarma_onizlemesi(v.to_string()).unwrap();
    assert_eq!((p.ret_listesine_gelecek, p.ret_sonra_degisen), (2, 0));
}

/// V2 (bağlı kip): yerel kipteki telefonun yedeğinde bir kaydın tek kopyası ret girdisinde; yeni telefon
/// servise eşleşir, servis kaydı yedekten sonra düzenlemiş. Girdi alınır (eskiden bayat sayılıp atılırdı,
/// içeriğe ulaşmanın yolu kalmazdı), işaretlenir; düzeltmesi servisteki kaydı ezmez, yeni kayıt olarak gider.
#[test]
fn bagli_kipte_servisin_sonra_degistirdigi_kaydin_girdisi_alinir() {
    let a = retli_telefon("ret-bagli-a");
    let belge = a.c.disa_aktar().unwrap().belge;
    let r = a.c.ret_listesi().unwrap().into_iter().find(|r| r.govde.is_some()).unwrap();
    let x = r.kayit_id.clone();

    let mut b = Hat::yeni("ret-bagli-b");
    b.zaman.ilerlet(DK);
    b.pc.disaridan_ekle(&x, &govde("X (PC sonra)", None), false);
    b.eslestir();
    assert_eq!(b.c.kip().unwrap(), CalismaKipi::Bagli);
    let p = b.c.ice_aktarma_onizlemesi(belge.clone()).unwrap();
    assert_eq!((p.atlanacak, p.yeni, p.ret_listesine_gelecek, p.ret_sonra_degisen, p.ret_bayat), (1, 1, 2, 2, 0));
    assert!(b.c.ice_aktar(belge, Some(p.iz)).unwrap().uygulandi);
    b.pompala();
    let g = b.c.ret_listesi().unwrap().into_iter().find(|g| g.islem_id == r.islem_id).unwrap();
    assert!(g.kayit_sonra_degisti);
    assert_eq!(g.govde, r.govde, "içerik ulaşılabilir");
    let yeni = b.c.ret_duzelt(g.islem_id, g.govde.unwrap()).unwrap();
    b.pompala();
    assert_ne!(yeni, x);
    assert_eq!(b.pc.d.kayitlar[&x].baslik, "X (PC sonra)", "servisteki kayıt ezilmedi");
    assert_eq!(b.pc.d.kayitlar[&yeni].baslik, "X (telefondaki)");
}

/// Düzeltme formu v3'ü korur (`ret_duzelt`): servisin reddettiği v3'lü `guncelle` var olan kayda başlığıyla ve
/// simgesiyle, v3'lü `ekle` reddi yeni kayda v3 alanlarıyla, kaydın hali (`tutarsiz_kayit`) var olan kayda o
/// halin v3 alanlarıyla uygulanır; atılmış ertelenen değişiklik bu yoldan düzeltilmez, listede olmayan girdi
/// hata verir. v3 değişikliği yedekten geçince de görünür.
#[test]
fn ret_duzeltme_v3_alanlarini_korur() {
    let mut a = Hat::yeni("ret-duzelt");
    let x = a.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let y = a.c.ekle(govde("Y", None), GirdiYolu::Elle).unwrap();
    let guncelle = AjandaIslem::Guncelle {
        kayit_id: x.clone(),
        temel_revizyon: 1,
        degisiklik: AjandaDegisiklik {
            baslik: Some("X2".into()),
            v3: V3Degisikligi { simge: Alan::Deger("ev".into()), ..Default::default() },
            ..Default::default()
        },
    };
    let x2 = govde_json("X2");
    ret_satiri_ekle(&a, "i_guncelle", &x, &guncelle.json().to_string(), "gecersiz_islem", Some(&x2));
    let ekle = AjandaIslem::Ekle {
        kayit_id: "k_reddedilen".into(),
        govde: govde("E", None),
        v3: V3Alanlari { simge: Some("is".into()), bolge: Some("Ofis".into()), ..Default::default() },
        girdi_yolu: GirdiYolu::SesliNot,
    };
    let e = govde_json("E");
    ret_satiri_ekle(&a, "i_ekle", "k_reddedilen", &ekle.json().to_string(), "gecersiz_islem", Some(&e));
    let mut hal = a.c.kayit(y.clone()).unwrap().unwrap().kayit.json();
    hal["simge"] = json!("market");
    let y2 = govde_json("Y (telefon)");
    ret_satiri_ekle(&a, "i_hal", &y, &hal.to_string(), "tutarsiz_kayit", Some(&y2));
    ret_satiri_ekle(&a, "i_atilan", &x, &guncelle.json().to_string(), "ertelenen_atildi", Some(&x2));
    a.sureci_oldur_ve_ac();

    // Yedekten geçince de v3 değişikliği görünür.
    let b = Hat::yeni("ret-duzelt-b");
    assert!(b.ice_aktar_onayla(&a.c.disa_aktar().unwrap().belge).uygulandi);
    let ozet = |h: &Hat, id: &str| h.c.ret_listesi().unwrap().into_iter().find(|r| r.islem_id == id).unwrap().v3_degisikligi;
    let simge = V3DegisiklikOzeti { konan: V3Alanlari { simge: Some("ev".into()), ..Default::default() }, kaldirilan: vec![] };
    assert_eq!((ozet(&a, "i_guncelle"), ozet(&b, "i_guncelle")), (Some(simge.clone()), Some(simge)));

    let govde_ = |id: &str| a.c.ret_listesi().unwrap().into_iter().find(|r| r.islem_id == id).unwrap().govde.unwrap();
    assert_eq!(a.c.ret_duzelt("i_guncelle".into(), govde_("i_guncelle")).unwrap(), x);
    let k = a.c.kayit(x.clone()).unwrap().unwrap().kayit;
    assert_eq!((k.baslik.as_str(), k.v3.simge.as_deref()), ("X2", Some("ev")));

    let yeni = a.c.ret_duzelt("i_ekle".into(), govde_("i_ekle")).unwrap();
    assert_ne!(yeni, "k_reddedilen");
    let k = a.c.kayit(yeni).unwrap().unwrap().kayit;
    assert_eq!((k.baslik.as_str(), k.v3.simge.as_deref(), k.v3.bolge.as_deref()), ("E", Some("is"), Some("Ofis")));

    assert_eq!(a.c.ret_duzelt("i_hal".into(), govde_("i_hal")).unwrap(), y);
    let k = a.c.kayit(y).unwrap().unwrap().kayit;
    assert_eq!((k.baslik.as_str(), k.v3.simge.as_deref()), ("Y (telefon)", Some("market")));

    for (id, alan) in [("i_atilan", "islem_id"), ("i_yok", "islem_id"), ("geçersiz kimlik", "islem_id")] {
        match a.c.ret_duzelt(id.into(), govde("Z", None)) {
            Err(CekirdekHatasi::GecersizGirdi { alan: a_, .. }) => assert_eq!(a_, alan),
            s => panic!("{id}: {s:?}"),
        }
    }
    let kalan: Vec<String> = a.c.ret_listesi().unwrap().into_iter().map(|r| r.islem_id).collect();
    assert_eq!(kalan, ["i_atilan"]);
}

/// r2: ret listesi içe aktarmalarla sınırsız büyümez: `KAYIT_ADET`'e ulaşınca kalan girdiler alınmaz
/// (`ret_sinir_asan`), telefonda zaten olanlar yer tutmaz.
#[test]
fn ret_listesi_siniri_ice_aktarmada_asilmaz() {
    let a = retli_telefon("ret-sinir-a");
    let oge = tutarsiz_oge(&json_belge(&a));
    let ogeler: Vec<String> = (0..3)
        .map(|i| {
            let mut o = oge.clone();
            o["islem_id"] = json!(format!("i_sinir_{i}"));
            o.to_string()
        })
        .collect();
    let metin = belge_metni(3, "", &ogeler.join(","));
    let b = Hat::yeni("ret-sinir-b");
    {
        let mut db = rusqlite::Connection::open(&b.yol).unwrap();
        let t = db.transaction().unwrap();
        for i in 0..KAYIT_ADET - 2 {
            t.execute(
                "INSERT INTO ret_listesi (islem_id, kayit_id, islem_json, neden, ts_ms, govde_json, sira) VALUES (?1, 'k_x', '{\"islem\":\"sil\"}', 'kayit_silinmis', 1, NULL, 0)",
                [format!("i_dolu_{i}")],
            )
            .unwrap();
        }
        t.commit().unwrap();
    }
    let p = b.c.ice_aktarma_onizlemesi(metin.clone()).unwrap();
    assert_eq!((p.ret_listesine_gelecek, p.ret_sinir_asan), (2, 1));
    assert!(b.c.ice_aktar(metin.clone(), Some(p.iz)).unwrap().uygulandi);
    assert_eq!(b.c.baglanti_durumu().unwrap().ret_listesinde as usize, KAYIT_ADET);
    let p = b.c.ice_aktarma_onizlemesi(metin).unwrap();
    assert_eq!((p.ret_listesine_gelecek, p.ret_sinir_asan), (0, 1), "olanlar yer tutmaz, yinelenmez");
}

/// r6: okunamayan JSON satırı dışa aktarmada bayt bayt olduğu gibi yazılır (yinelenen anahtar, 2^64 üstü tam
/// sayı ve boşluk korunur); belge yine geçerli JSON'dur, satır içe aktarmada yalnız kendisi geçersizdir.
#[test]
fn okunamayan_json_satiri_olduguyla_yazilir() {
    let mut a = Hat::yeni("ret-ham-satir");
    let x = a.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let ham = r#"{"a": 1, "a": 2, "n": 123456789012345678901234567890}"#;
    rusqlite::Connection::open(&a.yol).unwrap().execute("UPDATE gorunen SET json = ?2 WHERE kayit_id = ?1", [x.as_str(), ham]).unwrap();
    a.sureci_oldur_ve_ac();
    let d = a.c.disa_aktar().unwrap();
    assert_eq!(d.okunamayan, 1);
    assert!(d.belge.contains(ham), "olduğu gibi");
    assert!(serde_json::from_str::<Value>(&d.belge).is_ok());
    let b = Hat::yeni("ret-ham-satir-b");
    let p = b.c.ice_aktarma_onizlemesi(d.belge).unwrap();
    assert_eq!((p.toplam, p.gecersiz), (1, 1));
}
