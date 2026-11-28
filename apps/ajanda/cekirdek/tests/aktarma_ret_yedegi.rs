//! D3 gözden geçirmesi Y4: ret listesinin düzeltme gövdesi olan girdileri yedeğe girer (biçim 2 `retler`) ve
//! içe aktarmada ret listesine geri yazılır; hiçbir veri yalnız telefonda kalmaz. Gövdesi olmayan girdi
//! girmez (sayılır). Biçim sürümü kuralı: ret girdisi yoksa biçim 1 yazılır (eski uygulama da okur), varsa 2;
//! biçim 1'de `retler` bilinmeyen alan, biçim 2'de zorunludur. Aynı `islem_id` yinelenmez. Kişisel veri yoktur.

mod ortak;

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::kopru::tipler::CalismaKipi;
use ajanda_cekirdek::model::surum::AJANDA_SURUMU;
use ajanda_cekirdek::model::sinirlar::ajanda::KAYIT_ADET;
use ajanda_cekirdek::model::{GirdiYolu, IslemTuru, KuyrukRetNedeni};
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

/// Ret listesine gövdesiz bir girdi (servisin reddettiği `sil`): düzeltilemez, yalnız atılabilir.
fn govdesiz_ret_ekle(h: &Hat, islem_id: &str, kayit_id: &str) {
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    let islem = json!({"islem": "sil", "islem_id": islem_id, "kayit_id": kayit_id}).to_string();
    db.execute(
        "INSERT INTO ret_listesi (islem_id, kayit_id, islem_json, neden, ts_ms, govde_json, sira) VALUES (?1, ?2, ?3, 'kayit_silinmis', ?4, NULL, 0)",
        rusqlite::params![islem_id, kayit_id, islem, SIMDI],
    )
    .unwrap();
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

/// Biçim 2 belgesi: kayıtları ve ret öğeleri metin olarak (anahtarlar sıralı, sıkışık).
fn belge_metni(kayitlar: &str, retler: &str) -> String {
    format!(
        r#"{{"bicim":"eren_ajanda_yedegi","bicim_surumu":2,"bolgeler":[],"ekler":[],"kayitlar":[{kayitlar}],"kip":"yerel","olusturma_ms":{SIMDI},"retler":[{retler}],"sozlesme_surumu":{AJANDA_SURUMU},"uygulama_surumu":"0.1.0"}}"#
    )
}

fn red(h: &Hat, metin: &str) -> (String, String) {
    match h.c.ice_aktarma_onizlemesi(metin.to_string()) {
        Err(CekirdekHatasi::GecersizGirdi { alan, neden }) => (alan, neden),
        s => panic!("reddedilmedi: {s:?}"),
    }
}

/// Gidiş dönüş: gövdesi olan ret girdisi belgeye girer (biçim 2), gövdesizi girmez ve sayılır; boş telefona
/// içe aktarmada önizlemede sayılır ve ret listesine aynı kimlik, tür, neden, an ve gövdeyle yazılır; ikinci
/// içe aktarmada yinelenmez; yeni telefonun yedeği aynı öğeyi yazar. Ret girdisi olmayan telefon biçim 1 yazar.
#[test]
fn ret_girdisi_yedege_girer_ve_geri_yazilir() {
    let a = retli_telefon("ret-a");
    let d = a.c.disa_aktar().unwrap();
    assert_eq!((d.ret_yedekte, d.ret_listesinde, d.ice_aktarma_sinirini_asiyor, d.bicim_surumu), (1, 1, false, 2));
    let v: Value = serde_json::from_str(&d.belge).unwrap();
    assert_eq!(v["bicim_surumu"], json!(2));
    assert_eq!(v.to_string(), d.belge, "sıkışık, anahtarlar sıralı");
    let oge = &v["retler"][0];
    let kaynak = a.c.ret_listesi().unwrap().into_iter().find(|r| r.govde.is_some()).unwrap();
    assert_eq!((oge["islem_id"].as_str(), oge["neden"].as_str(), oge["islem"].as_str()), (Some(kaynak.islem_id.as_str()), Some("tutarsiz_kayit"), Some("guncelle")));
    assert_eq!(oge["govde"]["baslik"], json!("X (telefondaki)"));

    let mut b = Hat::yeni("ret-b");
    b.gozlemci.al();
    let p = b.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    assert_eq!((p.toplam, p.yeni, p.ret_listesine_gelecek, p.ret_gecersiz), (2, 2, 1, 0));
    assert!(b.c.ice_aktar(d.belge.clone(), Some(p.iz)).unwrap().uygulandi);
    assert!(b.gozlemci.al().iter().any(|g| g.ret_listesi));
    let gelen = b.c.ret_listesi().unwrap();
    assert_eq!(gelen.len(), 1);
    let r = &gelen[0];
    assert_eq!((&r.islem_id, &r.kayit_id, r.islem, r.neden, r.ts_ms), (&kaynak.islem_id, &kaynak.kayit_id, IslemTuru::Guncelle, KuyrukRetNedeni::TutarsizKayit, kaynak.ts_ms));
    assert_eq!(r.govde, kaynak.govde, "gövde kaybolmadı");
    // İkinci içe aktarma: aynı `islem_id` yinelenmez.
    let p = b.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    assert_eq!((p.ayni, p.ret_listesine_gelecek, p.ret_gecersiz), (2, 0, 0));
    assert!(b.c.ice_aktar(d.belge.clone(), Some(p.iz)).unwrap().uygulandi);
    assert_eq!(b.c.ret_listesi().unwrap().len(), 1);
    // Yeni telefonun yedeği aynı öğeyi yazar (veri bir telefondan ötekine kaybolmadan geçer).
    assert_eq!(json_belge(&b)["retler"], v["retler"]);
    // Ret girdisi atılınca biçim 1'e döner (eski uygulama da okur).
    b.c.ret_at(r.islem_id.clone()).unwrap();
    let d = b.c.disa_aktar().unwrap();
    let v: Value = serde_json::from_str(&d.belge).unwrap();
    assert_eq!((v["bicim_surumu"].clone(), v.get("retler").is_none(), d.ret_yedekte, d.bicim_surumu), (json!(1), true, 0, 1));
    b.sureci_oldur_ve_ac();

    // Bağlı kipte de ret listesine yazılır.
    let mut c = Hat::yeni("ret-bagli");
    c.eslestir();
    let belge = a.c.disa_aktar().unwrap().belge;
    let p = c.c.ice_aktarma_onizlemesi(belge.clone()).unwrap();
    assert_eq!((p.kip, p.ret_listesine_gelecek), (CalismaKipi::Bagli, 1));
    assert!(c.c.ice_aktar(belge, Some(p.iz)).unwrap().uygulandi);
    assert_eq!(c.c.ret_listesi().unwrap()[0].islem_id, kaynak.islem_id);
}

/// Her ret öğesi ayrı okunur: şemadan geçmeyen ve dosyada `islem_id`'si yinelenen geçersizdir, ötekiler
/// uygulanır. 256 KiB üstü öğe ağaca çevrilmeden geçersiz sayılır, içindeki sözdizimi hatası bütün belgeyi
/// reddeder. İz ret öğelerini kapsar: önizlemeden sonra aynı `islem_id` telefona düşerse eski izle uygulanmaz.
#[test]
fn ret_ogeleri_tek_tek_okunur() {
    let a = retli_telefon("ret-oge-a");
    let v = json_belge(&a);
    let gecerli = v["retler"][0].clone();
    let mut baska = gecerli.clone();
    baska["islem_id"] = json!("i_baska");
    let mut bilinmez_neden = gecerli.clone();
    bilinmez_neden["islem_id"] = json!("i_neden");
    bilinmez_neden["neden"] = json!("yeni_bir_neden");
    let mut fazla_alan = gecerli.clone();
    fazla_alan["islem_id"] = json!("i_fazla");
    fazla_alan["sira"] = json!(1);
    let buyuk = format!(r#"{{"islem_id":"i_buyuk","dolgu":"{}"}}"#, "x".repeat(256 * 1024));
    let ogeler = [gecerli.to_string(), baska.to_string(), bilinmez_neden.to_string(), fazla_alan.to_string(), gecerli.to_string(), buyuk.clone(), "0".into()];
    let metin = belge_metni("", &ogeler.join(","));
    let b = Hat::yeni("ret-oge-b");
    let p = b.c.ice_aktarma_onizlemesi(metin.clone()).unwrap();
    assert_eq!((p.toplam, p.ret_listesine_gelecek, p.ret_gecersiz), (0, 2, 5));
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
    let bozuk = belge_metni("", &buyuk.replace(r#""dolgu":"#, r#""dolgu" "#));
    assert!(red(&b, &bozuk).1.starts_with("JSON değil"));
}

/// Biçim sürümü kuralı: biçim 1'de `retler` bilinmeyen alandır, biçim 2'de zorunlu ve dizidir; biçim 3 daha
/// yenidir (biçim 1 okuyan eski uygulama da biçim 2'yi böyle reddeder). Öğe sınırı (`KAYIT_ADET`) tam sınırda
/// geçer, bir fazlası ağaca çevrilmeden reddedilir.
#[test]
fn ret_bicim_surumu_kurali() {
    let h = Hat::yeni("ret-surum");
    let iki = belge_metni("", "");
    assert!(h.c.ice_aktarma_onizlemesi(iki.clone()).is_ok());
    assert_eq!(red(&h, &iki.replace(r#""bicim_surumu":2"#, r#""bicim_surumu":1"#)), ("retler".into(), "bilinmeyen alan".into()));
    assert_eq!(red(&h, &iki.replace(r#""retler":[],"#, "")), ("retler".into(), "zorunlu alan yok".into()));
    assert_eq!(red(&h, &iki.replace(r#""retler":[]"#, r#""retler":{}"#)), ("retler".into(), "dizi değil".into()));
    let (alan, neden) = red(&h, &iki.replace(r#""bicim_surumu":2"#, r#""bicim_surumu":3"#));
    assert!(alan == "bicim_surumu" && neden.starts_with("daha yeni"), "{alan}: {neden}");
    let tam = belge_metni("", &vec!["0"; KAYIT_ADET].join(","));
    let p = h.c.ice_aktarma_onizlemesi(tam).unwrap();
    assert_eq!((p.ret_gecersiz as usize, p.ret_listesine_gelecek), (KAYIT_ADET, 0));
    let fazla = belge_metni("", &vec!["0"; KAYIT_ADET + 1].join(","));
    assert_eq!(red(&h, &fazla), ("retler".into(), format!("çok fazla öğe (en çok {KAYIT_ADET})")));
    // Biçim 1'deki dev `retler` de sayılır (tarama durur), ağaca çevrilmez.
    let bir = fazla.replace(r#""bicim_surumu":2"#, r#""bicim_surumu":1"#);
    assert_eq!(red(&h, &bir).0, "retler");
}

/// Çözülmüş ret girdisi eski yedekle geri gelmez (T1). Kullanıcı girdiyi düzeltip attı, kayıt sonra yine
/// değişti; aynı telefona eski yedek içe aktarılınca kayıt "daha yeni kazanır"la atlanır, girdi de bayat
/// sayılır (yedekten sonra değişen kayda ait: düzeltilirse kaydın yeni hali eskisiyle ezilirdi) ve ret
/// listesine yazılmaz. Kayıt değişmediyse (girdi yalnız atıldı) girdi geri gelir. Dosyada kaydın geçerli hali
/// yoksa telefondaki kaydın güncelleme anı girdinin anıyla karşılaştırılır.
#[test]
fn bayat_ret_girdisi_geri_gelmez() {
    let a = retli_telefon("ret-bayat");
    let eski = a.c.disa_aktar().unwrap().belge;
    let r = a.c.ret_listesi().unwrap().into_iter().find(|r| r.govde.is_some()).unwrap();
    let x = r.kayit_id.clone();

    // Girdi yalnız atıldı (kayıt değişmedi): eski yedek onu geri getirir, düzeltmesi kaydın yedekteki halinin
    // üstüne gelir (bir şey ezilmez).
    a.c.ret_at(r.islem_id.clone()).unwrap();
    let p = a.c.ice_aktarma_onizlemesi(eski.clone()).unwrap();
    assert_eq!((p.ayni, p.ret_listesine_gelecek, p.ret_bayat), (2, 1, 0));

    // Kullanıcı düzeltti (kayda uygulandı, girdi atıldı), kayıt sonra yine düzenlendi.
    a.zaman.ilerlet(DK);
    a.c.duzenle(x.clone(), None, r.govde.clone().unwrap()).unwrap();
    a.zaman.ilerlet(DK);
    a.c.duzenle(x.clone(), None, govde("X (en yeni)", None)).unwrap();
    assert!(a.c.ret_listesi().unwrap().iter().all(|g| g.islem_id != r.islem_id));

    let p = a.c.ice_aktarma_onizlemesi(eski.clone()).unwrap();
    assert_eq!((p.atlanacak, p.ayni, p.ret_listesine_gelecek, p.ret_bayat, p.ret_gecersiz), (1, 1, 0, 1, 0));
    let s = a.c.ice_aktar(eski.clone(), Some(p.iz)).unwrap();
    assert!(s.uygulandi);
    assert!(a.c.ret_listesi().unwrap().iter().all(|g| g.islem_id != r.islem_id), "bayat girdi geri gelmedi");
    assert_eq!(a.c.kayit(x.clone()).unwrap().unwrap().kayit.baslik, "X (en yeni)");

    // Dosyada kaydın geçerli hali yok: telefondaki kayıt girdiden sonra değişti, girdi bayat; kayıt girdiden
    // önceyse (girdinin anı ileride) girdi gelir.
    let mut v: Value = serde_json::from_str(&eski).unwrap();
    v["kayitlar"].as_array_mut().unwrap().retain(|k| k["kayit_id"] != x.as_str());
    let p = a.c.ice_aktarma_onizlemesi(v.to_string()).unwrap();
    assert_eq!((p.ret_listesine_gelecek, p.ret_bayat), (0, 1));
    v["retler"][0]["ts_ms"] = json!(SIMDI + 3 * DK);
    let p = a.c.ice_aktarma_onizlemesi(v.to_string()).unwrap();
    assert_eq!((p.ret_listesine_gelecek, p.ret_bayat), (1, 0));
}
