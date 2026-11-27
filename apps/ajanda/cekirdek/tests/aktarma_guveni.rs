//! Başkasından gelen yedeğe güven (D3 bağımsız gözden geçirmesinin bulguları) ve yakın D1/D2/D4 kuralları,
//! uçtan uca: köprünün açık yüzeyi + sahte kabuklar ve sahte PC (`ortak`). Kişisel veri yoktur.
//!
//! - Bellek: belge sınırı modelden (kendi yedeği reddedilmez), `kayitlar` en çok 2 × `KAYIT_ADET` öğe (dev
//!   dizi ağaca çevrilmeden reddedilir),
//!   tek kayıt öğesi en çok 256 KiB, kayıtlar dışı sözcük ve ek sayısı sınırlı; sınırın hemen altı ve üstü.
//! - Gelecek tarihli `guncelleme_ms` (şimdi + 1 gün üstü) geçersizdir; güncellemenin içindeki silme ve geri
//!   yükleme ayrı sayılır.
//! - İz, etkilenecek kaydın içeriğini ve telefondaki satırını kapsar.
//! - Taslak servise onaylanmış gibi gitmez (D3 bağlı kip, D4 başka servise bağlanma, D2 PC'nin yitirdiği taslak).
//! - Okunamayan PC temeli sayılır ve geçişi düşürmez.
//! - Bağlı kipte dönmemiş servisle tam telafi sıfır işlem verir.

mod ortak;

use std::time::{Duration, Instant};

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::kopru::tipler::{CalismaKipi, IceAktarmaOnizlemesi};
use ajanda_cekirdek::model::sinirlar::AJANDA_SURUMU;
use ajanda_cekirdek::model::sinirlar::ajanda::KAYIT_ADET;
use ajanda_cekirdek::model::{AjandaKaydi, GirdiYolu, KuyrukRetNedeni};
use ortak::*;
use serde_json::{Value, json};

/// Eski belge sınırı (32 MiB): dev dizi bunun altında kalır; R2 sınırı modelden hesaplanır (~1,77 GiB).
const BELGE_AZAMI_ESKI: usize = 32 * 1024 * 1024;
const KAYIT_AZAMI: usize = 256 * 1024;
const DIZI_AZAMI: usize = 2 * KAYIT_ADET;

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

fn belge(h: &Hat) -> String {
    h.c.disa_aktar().unwrap().belge
}

fn json_belge(h: &Hat) -> Value {
    serde_json::from_str(&belge(h)).unwrap()
}

fn kaydi_bul<'a>(v: &'a mut Value, id: &str) -> &'a mut Value {
    v["kayitlar"].as_array_mut().unwrap().iter_mut().find(|k| k["kayit_id"] == id).unwrap()
}

/// Kayıt öğeleri metin olarak verilen belge (anahtarlar sıralı, sıkışık).
fn belge_metni(ogeler: &str) -> String {
    format!(
        r#"{{"bicim":"eren_ajanda_yedegi","bicim_surumu":1,"bolgeler":[],"ekler":[],"kayitlar":[{ogeler}],"kip":"yerel","olusturma_ms":{SIMDI},"sozlesme_surumu":{AJANDA_SURUMU},"uygulama_surumu":"0.1.0"}}"#
    )
}

/// Geçerli bir kaydın JSON metni (yeni bir telefonun dışa aktarmasından).
fn ornek_kayit() -> String {
    let a = Hat::yeni("guven-ornek");
    a.c.ekle(govde("Örnek", Some(an("2026-11-26", "10:00"))), GirdiYolu::Elle).unwrap();
    json_belge(&a)["kayitlar"][0].to_string()
}

fn red(h: &Hat, metin: &str) -> (String, String) {
    match h.c.ice_aktarma_onizlemesi(metin.to_string()) {
        Err(CekirdekHatasi::GecersizGirdi { alan, neden }) => {
            // `ice_aktar` de aynı hatayla reddeder, hiçbir şey yazmaz.
            match h.c.ice_aktar(metin.to_string(), None) {
                Err(CekirdekHatasi::GecersizGirdi { alan: a2, neden: n2 }) => assert_eq!((&a2, &n2), (&alan, &neden)),
                s => panic!("ice_aktar reddetmedi: {s:?}"),
            }
            (alan, neden)
        }
        s => panic!("reddedilmedi: {:?}", s.map(|p| (p.toplam, p.gecersiz))),
    }
}

fn onizle(h: &Hat, metin: &str) -> IceAktarmaOnizlemesi {
    h.c.ice_aktarma_onizlemesi(metin.to_string()).unwrap()
}

/// Dev kayıt dizisi (~250 KB'lık zip'te 250 MB'lık `[0,0,…]`'ın 30 MB'lık hali): belge sınırının içinde ama
/// öğe sınırını aşar; dizi ağaca çevrilmeden (sayım aşınca tarama durur) hızla reddedilir. Belge sınırı ve
/// öğe sınırı tam sınırda geçer, bir fazlası reddedilir.
#[test]
fn dev_kayit_dizisi_agac_kurulmadan_reddedilir() {
    let h = Hat::yeni("guven-dev");
    let dev = belge_metni(&vec!["0"; 15_000_000].join(","));
    assert!(dev.len() < BELGE_AZAMI_ESKI && dev.len() > 28 * 1024 * 1024);
    let t = Instant::now();
    let (alan, neden) = red(&h, &dev);
    let sure = t.elapsed();
    assert_eq!(alan, "kayitlar");
    assert!(neden.contains("çok fazla öğe") && neden.contains(&DIZI_AZAMI.to_string()), "{neden}");
    // Ağaç kurulsaydı (15 milyon `Value`, ~0,5 GB) hata ayıklama derlemesinde saniyeler sürerdi.
    assert!(sure < Duration::from_secs(5), "{sure:?}");

    // Öğe sınırı: tam sınırda okunur (her öğe ayrı geçersiz), bir fazlası reddedilir.
    let tam = belge_metni(&vec!["0"; DIZI_AZAMI].join(","));
    let p = onizle(&h, &tam);
    assert_eq!((p.toplam as usize, p.gecersiz as usize, p.gecersizler.len()), (DIZI_AZAMI, DIZI_AZAMI, 20));
    assert_eq!((p.gecersizler[0].alan.as_str(), p.gecersizler[0].neden.as_str()), ("kayitlar.0", "nesne değil"));
    let (alan, _) = red(&h, &belge_metni(&vec!["0"; DIZI_AZAMI + 1].join(",")));
    assert_eq!(alan, "kayitlar");

    // Kaçışlı anahtar da `kayitlar`'dır (serde_json onu öyle okur): sınır yine uygulanır.
    let kacisli_ad = ["\"kayit", "\\", "u006car\""].concat();
    assert_eq!(serde_json::from_str::<String>(&kacisli_ad).unwrap(), "kayitlar");
    let kacisli = belge_metni(&vec!["0"; DIZI_AZAMI + 1].join(",")).replace(r#""kayitlar""#, &kacisli_ad);
    assert!(kacisli.contains("u006c"));
    assert_eq!(red(&h, &kacisli).0, "kayitlar");
    // Yinelenen `kayitlar` (serde_json sonuncuyu alırdı) reddedilir.
    let iki = belge_metni("").replace(r#""kip""#, r#""kayitlar":[],"kip""#);
    assert_eq!(red(&h, &iki), ("kayitlar".into(), "yinelenen alan".into()));
    assert!(h.c.disa_aktar().unwrap().kayit == 0, "hiçbir şey yazılmadı");
}

/// Yerel kipte içe aktarılabilecek (dilimi bilinen) büyük bir kayıt: her serbest metin sınırında, birim
/// başına 3 bayt, 8 mutlak hatırlatma, günlük tekrarın 500 örneği.
fn buyuk_kayit(id: &str) -> Value {
    let mut v: Value = serde_json::from_str(&ornek_kayit()).unwrap();
    let uc = |n: usize| "€".repeat(n);
    let bas = ajanda_cekirdek::model::takvim::gun_no(2026, 1, 1);
    v["kayit_id"] = json!(id);
    v["baslik"] = json!(uc(200));
    v["aciklama"] = json!(uc(4000));
    v["zaman"] = json!({"kesinlik": "an", "tarih": "2026-01-01", "saat": "23:59", "sure_dk": 10_080, "saat_dilimi": IST, "ifade": uc(120)});
    v["hatirlatmalar"] =
        json!((0..8).map(|i| json!({"tur": "mutlak", "tarih": "2199-12-31", "saat": format!("23:5{i}"), "saat_dilimi": IST})).collect::<Vec<_>>());
    v["tekrar"] = json!({"siklik": "gunluk", "aralik": 1, "bitis_tarihi": "2199-12-31"});
    v["ornekler"] = json!(
        (0..500).map(|i| json!({"tarih": ajanda_cekirdek::model::takvim::gun_no_tarih(bas + i), "durum": "tamam"})).collect::<Vec<_>>()
    );
    v["durum"] = json!("tamam");
    v["kaynak"]["alinti"] = json!(uc(280));
    v
}

/// Belge sınırı modelden hesaplanır (R2): dışa aktarmanın yazdığı belge içe aktarmada boyutla reddedilmez.
/// Büyük kayıtlarla dolu telefonun dışa aktarması kayıt başına ölçülür; `KAYIT_ADET` tanesi köprünün verdiği
/// sınıra sığar (eski 32 MiB'a ~800 tanesi sığardı); belge başka telefonda bütünüyle okunur. Sınırın kendisi
/// (tam sınırda geçer, bir fazlası reddedilir) birim testinde küçük sınırla sınanır.
#[test]
fn kendi_yedegi_boyutla_reddedilmez() {
    let bicim = ajanda_cekirdek::kopru::aktarma_bicimi();
    assert!(bicim.belge_azami_bayt <= i32::MAX as u64 - 8, "Kotlin bayt dizisine sığar");
    let a = Hat::yeni("guven-belge-a");
    let adet = 40;
    let kayitlar: Vec<String> = (0..adet).map(|i| buyuk_kayit(&format!("k_buyuk_{i}")).to_string()).collect();
    let p = a.ice_aktar_onayla(&belge_metni(&kayitlar.join(",")));
    assert!(p.uygulandi);
    assert_eq!((p.plan.yeni, p.plan.gecersiz), (adet, 0));
    let d = a.c.disa_aktar().unwrap();
    assert_eq!(d.kayit, adet);
    let v: Value = serde_json::from_str(&d.belge).unwrap();
    let en_buyuk = v["kayitlar"].as_array().unwrap().iter().map(|k| k.to_string().len()).max().unwrap();
    assert!(en_buyuk > 30_000 && en_buyuk < KAYIT_AZAMI, "{en_buyuk}");
    assert!(BELGE_AZAMI_ESKI / (en_buyuk + 1) < 1000, "eski sınır dolu telefonu yedeksiz bırakıyordu");
    let ust = d.belge.len() - v["kayitlar"].as_array().unwrap().iter().map(|k| k.to_string().len() + 1).sum::<usize>();
    assert!((KAYIT_ADET * (en_buyuk + 1) + ust) as u64 <= bicim.belge_azami_bayt);
    // Belge sıkışık ve anahtarları sıralı (ağaçsız yazım `json!`'ınkiyle aynı).
    assert_eq!(v.to_string(), d.belge);
    let b = Hat::yeni("guven-belge-b");
    let on = onizle(&b, &d.belge);
    assert_eq!((on.toplam, on.yeni, on.gecersiz), (adet, adet, 0));
}

/// Tek kayıt öğesi en çok 256 KiB: tam sınırdaki geçerli kayıt eklenir, bir bayt fazlası (ya da içinde dev
/// dizi taşıyan kayıt) yalnız kendisi geçersiz sayılır, ağaca çevrilmez; öteki kayıtlar uygulanır.
#[test]
fn tek_kayit_siniri_yalniz_o_kaydi_dusurur() {
    let h = Hat::yeni("guven-kayit");
    let k = ornek_kayit();
    // Kimliği `id` olan kayıt, `{`'ın ardına boşlukla tam `n` bayta doldurulmuş.
    let dolgulu = |n: usize, id: &str| {
        let mut v: Value = serde_json::from_str(&k).unwrap();
        v["kayit_id"] = json!(id);
        let m = v.to_string();
        format!("{{{}{}", " ".repeat(n - m.len()), &m[1..])
    };
    let tam = dolgulu(KAYIT_AZAMI, "k_tam");
    let fazla = dolgulu(KAYIT_AZAMI + 1, "k_fazla");
    assert_eq!((tam.len(), fazla.len()), (KAYIT_AZAMI, KAYIT_AZAMI + 1));
    let mut ic_dev: Value = serde_json::from_str(&k).unwrap();
    ic_dev["kayit_id"] = json!("k_ic_dev");
    ic_dev["hatirlatmalar"] = json!(vec![0; 200_000]);
    let metin = belge_metni(&[tam, fazla, ic_dev.to_string()].join(","));
    let p = onizle(&h, &metin);
    assert_eq!((p.toplam, p.yeni, p.gecersiz), (3, 1, 2));
    let konumlar: Vec<(&str, &str)> = p.gecersizler.iter().map(|g| (g.alan.as_str(), g.neden.as_str())).collect();
    assert_eq!(konumlar, [("kayitlar.1", "kayıt çok büyük"), ("kayitlar.2", "kayıt çok büyük")]);
    assert!(h.c.ice_aktar(metin, Some(p.iz)).unwrap().uygulandi);
    assert!(h.c.kayit("k_tam".into()).unwrap().is_some());
    assert!(h.c.kayit("k_fazla".into()).unwrap().is_none());
}

/// Kayıtlar dışı: ek dizini en çok 10 000 öğe, kayıtlar dışındaki sözcükler en çok 100 000, iç içelik en
/// çok 127 (serde_json'unki). Hepsi ağaç kurulmadan ya da üst düzey okunurken açık hatayla reddedilir.
#[test]
fn kayitlar_disi_sinirlar() {
    let h = Hat::yeni("guven-dis");
    let ek = format!(r#"{{"bayt":1,"mime":"image/png","ozet":"{}"}}"#, "a".repeat(64));
    let ekler = belge_metni("").replace(r#""ekler":[]"#, &format!(r#""ekler":[{}]"#, vec![ek.as_str(); 10_001].join(",")));
    assert_eq!(red(&h, &ekler), ("ekler".into(), "çok fazla öğe (en çok 10000)".into()));
    let bolgeler = belge_metni("").replace(r#""bolgeler":[]"#, &format!(r#""bolgeler":[{}]"#, vec!["0"; 100_001].join(",")));
    assert_eq!(red(&h, &bolgeler).0, "belge");
    let derin = belge_metni(&format!("{}{}", "[".repeat(200), "]".repeat(200)));
    let (alan, neden) = red(&h, &derin);
    assert!(alan == "belge" && neden.contains("çok derin"), "{alan}: {neden}");
    // Sınırın altındaki iç içelik kaydı yalnız geçersiz kılar.
    let p = onizle(&h, &belge_metni(&format!("{}{}", "[".repeat(100), "]".repeat(100))));
    assert_eq!((p.toplam, p.gecersiz), (1, 1));
}

/// Sözdizimi hatası belgeyi bütünüyle reddeder; konum (satır, sütun) serde_json'un bütün belgeye verdiğiyle
/// aynıdır: kayıtlar dizisinden sonra, bir öğenin içinde ve dizinin ayraçlarında.
#[test]
fn sozdizimi_hatasi_konumuyla_reddedilir() {
    let h = Hat::yeni("guven-sozdizimi");
    let a = Hat::yeni("guven-sozdizimi-a");
    for b in ["A", "B", "C"] {
        a.c.ekle(govde(b, None), GirdiYolu::Elle).unwrap();
    }
    let guzel = serde_json::to_string_pretty(&json_belge(&a)).unwrap();
    let bozuklar = [
        guzel.replace(r#""kip": "yerel""#, r#""kip": yerel"#),
        guzel.replacen(r#""durum": "acik""#, r#""durum" "acik""#, 2).replacen(r#""durum" "acik""#, r#""durum": "acik""#, 1),
        guzel.replacen(r#""uygulama_surumu""#, r#""uygulama_surumu" 1, "x""#, 1),
    ];
    for metin in &bozuklar {
        let e = serde_json::from_str::<Value>(metin).unwrap_err();
        let (alan, neden) = red(&h, metin);
        assert_eq!((alan.as_str(), neden), ("belge", format!("JSON değil (satır {}, sütun {})", e.line(), e.column())));
    }
    for metin in [belge_metni("1,"), belge_metni(",1"), belge_metni("1,,2"), belge_metni("1 2"), belge_metni("[1}")] {
        let (alan, neden) = red(&h, &metin);
        assert!(alan == "belge" && neden.starts_with("JSON değil"), "{metin}: {neden}");
    }
    assert!(red(&h, &belge_metni(r#""kapanmamış"#)).1.starts_with("JSON değil"));
}

/// Gelecek tarihli an: şimdi + 1 günün ötesindeki `guncelleme_ms` (9e15'li mezar taşı) geçersizdir, telefonu
/// silmez; sınırda geçer. Ardından gerçek yedek yine uygulanır (an yapışmadı). İki kipte aynı.
#[test]
fn gelecek_tarihli_an_gecersiz_sayilir() {
    let a = Hat::yeni("guven-gelecek-a");
    let x = a.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let y = a.c.ekle(govde("Y", None), GirdiYolu::Elle).unwrap();
    let b = Hat::yeni("guven-gelecek-b");
    assert!(b.ice_aktar_onayla(&belge(&a)).uygulandi);
    let taban = json_belge(&a);
    let zehirli = |ms: i64| {
        let mut v = taban.clone();
        for id in [&x, &y] {
            let k = kaydi_bul(&mut v, id);
            k["silindi"] = json!(true);
            k["guncelleme_ms"] = json!(ms);
        }
        v.to_string()
    };
    let p = onizle(&b, &zehirli(9_000_000_000_000_000));
    assert_eq!((p.gecersiz, p.guncellenecek, p.silinecek), (2, 0, 0));
    assert_eq!((p.gecersizler[0].alan.as_str(), p.gecersizler[0].neden.as_str()), ("kayitlar.0.guncelleme_ms", "gelecekte (saat ileri ya da dosya bozuk)"));
    assert!(b.ice_aktar_onayla(&zehirli(9_000_000_000_000_000)).uygulandi);
    assert!(!kayit(&b, &x).silindi && !kayit(&b, &y).silindi, "telefon silinmedi");
    // Sınır: şimdi + 1 gün geçer, bir ms fazlası geçersiz.
    let p = onizle(&b, &zehirli(SIMDI + GUN));
    assert_eq!((p.gecersiz, p.guncellenecek, p.silinecek), (0, 2, 2));
    assert_eq!(onizle(&b, &zehirli(SIMDI + GUN + 1)).gecersiz, 2);
    // Oluşturma anı da gelecekte (model `olusturma_ms <= guncelleme_ms` ister): ikisi birden geçersiz.
    let mut v = taban.clone();
    kaydi_bul(&mut v, &x)["olusturma_ms"] = json!(SIMDI + 2 * GUN);
    kaydi_bul(&mut v, &x)["guncelleme_ms"] = json!(SIMDI + 2 * GUN);
    assert_eq!(onizle(&b, &v.to_string()).gecersiz, 1);
    // Gerçek yedek: A'da X düzenlendi; B'ye uygulanır (zehirli an yapışmadı).
    a.zaman.ilerlet(DK);
    a.c.duzenle(x.clone(), None, govde("X (A)", None)).unwrap();
    let p = onizle(&b, &belge(&a));
    assert_eq!((p.guncellenecek, p.atlanacak), (1, 0));
    assert!(b.c.ice_aktar(belge(&a), Some(p.iz)).unwrap().uygulandi);
    assert_eq!(kayit(&b, &x).baslik, "X (A)");

    // Bağlı kipte de geçersiz: hiçbir işlem kuyruğa girmez.
    let mut p_ = Hat::yeni("guven-gelecek-bagli");
    p_.eslestir();
    let pb = p_.c.ice_aktarma_onizlemesi(zehirli(9_000_000_000_000_000)).unwrap();
    assert_eq!((pb.kip, pb.gecersiz, pb.yeni, pb.kuyruga_girecek_islem), (CalismaKipi::Bagli, 2, 0, 0));
}

/// Güncellemenin içindeki silme (canlı kayıt yerine daha yeni mezar taşı) ve geri yükleme (mezar taşı yerine
/// daha yeni canlı hal) önizlemede ayrı sayılır ve uygulanır: yerel kipte doğrudan, bağlı kipte `sil` ve
/// `geri_yukle` işlemleriyle servise.
#[test]
fn guncellemenin_icindeki_silme_ve_geri_yukleme_sayilir() {
    // Yerel kip.
    let b = Hat::yeni("guven-silme-b");
    let x = b.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let y = b.c.ekle(govde("Y", None), GirdiYolu::Elle).unwrap();
    b.c.sil(y.clone()).unwrap();
    let mut v = json_belge(&b);
    for (id, silindi) in [(&x, true), (&y, false)] {
        let k = kaydi_bul(&mut v, id);
        k["silindi"] = json!(silindi);
        k["guncelleme_ms"] = json!(SIMDI + DK);
    }
    let p = onizle(&b, &v.to_string());
    assert_eq!((p.guncellenecek, p.silinecek, p.geri_yuklenecek), (2, 1, 1));
    assert!(b.c.ice_aktar(v.to_string(), Some(p.iz)).unwrap().uygulandi);
    assert!(kayit(&b, &x).silindi && !kayit(&b, &y).silindi);

    // Bağlı kip.
    let mut h = Hat::yeni("guven-silme-bagli");
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.pc.disaridan_ekle("k_y", &govde("Y", None), false);
    h.eslestir();
    h.c.sil("k_y".into()).unwrap();
    h.pompala();
    assert!(h.pc.d.kayitlar["k_y"].silindi);
    let mut v = json_belge(&h);
    for (id, silindi) in [("k_x", true), ("k_y", false)] {
        let k = kaydi_bul(&mut v, id);
        k["silindi"] = json!(silindi);
        k["guncelleme_ms"] = json!(SIMDI + DK);
    }
    let p = onizle(&h, &v.to_string());
    assert_eq!((p.guncellenecek, p.silinecek, p.geri_yuklenecek, p.kuyruga_girecek_islem), (2, 1, 1, 2));
    assert!(h.c.ice_aktar(v.to_string(), Some(p.iz)).unwrap().uygulandi);
    h.pompala();
    assert!(h.pc.d.kayitlar["k_x"].silindi && !h.pc.d.kayitlar["k_y"].silindi);
    assert!(h.c.ret_listesi().unwrap().is_empty());
}

/// İz etkilenecek kaydın içeriğini kapsar: önizlemeden sonra sınıfını değiştirmeyen telefon değişikliği
/// (saat geride, telefon yine eski sayılıyor) eski izle ezilmez; aynı sınıflı ama içeriği farklı başka dosya
/// başka iz verir.
#[test]
fn iz_icerigi_ve_telefondaki_satiri_kapsar() {
    let a = Hat::yeni("guven-iz-a");
    let x = a.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let b = Hat::yeni("guven-iz-b");
    assert!(b.ice_aktar_onayla(&belge(&a)).uygulandi);
    a.zaman.ilerlet(10 * DK);
    a.c.duzenle(x.clone(), None, govde("X (A)", None)).unwrap();
    let belge_a = belge(&a);
    let on = onizle(&b, &belge_a);
    assert_eq!(on.guncellenecek, 1);

    // Aynı sınıflı başka dosya: başka iz.
    let mut v: Value = serde_json::from_str(&belge_a).unwrap();
    kaydi_bul(&mut v, &x)["baslik"] = json!("X (A2)");
    let on2 = onizle(&b, &v.to_string());
    assert_eq!((on2.guncellenecek, on2.yeni), (1, 0));
    assert_ne!(on2.iz, on.iz);
    let s = b.c.ice_aktar(v.to_string(), Some(on.iz.clone())).unwrap();
    assert!(!s.uygulandi, "başka dosya eski izle uygulanmaz");

    // B'de X düzenlendi ama saati geride: sınıf yine `guncellenecek`; eski izle yazılmaz.
    b.zaman.ilerlet(DK);
    b.c.duzenle(x.clone(), None, govde("X (B)", None)).unwrap();
    let s = b.c.ice_aktar(belge_a.clone(), Some(on.iz.clone())).unwrap();
    assert!(!s.uygulandi);
    assert_eq!(s.plan.guncellenecek, 1, "sınıf değişmedi");
    assert_ne!(s.plan.iz, on.iz);
    assert_eq!(kayit(&b, &x).baslik, "X (B)", "telefonun yeni değişikliği ezilmedi");
    // Kullanıcı yeni planı onaylarsa uygulanır.
    assert!(b.c.ice_aktar(belge_a, Some(s.plan.iz)).unwrap().uygulandi);
    assert_eq!(kayit(&b, &x).baslik, "X (A)");
}

/// D4 ve D1: bağlı kipten kalan taslak başka servise bağlanırken `ekle` ile onaylanmış gitmez; önizlemede
/// `taslaklar`'dadır, onayda ret listesine düşer (düzeltme gövdesiyle), görünen kopyadan çıkar.
#[test]
fn yerel_taslak_baska_servise_onaylanmis_gitmez() {
    let mut h = Hat::yeni("guven-taslak-d4");
    h.pc.disaridan_ekle("k_t", &govde("Öneri", Some(an("2026-11-27", "10:00"))), true);
    h.pc.disaridan_ekle("k_a", &govde("A", None), false);
    h.eslestir();
    assert!(kayit(&h, "k_t").taslak);
    h.kopar();
    let mut pc2 = SahtePc::yeni("d_pc2", h.zaman.clone());
    pc2.cihaz_public_key = h.pc.cihaz_public_key.clone();
    h.pc = pc2;
    h.otomatik_onay = false;
    h.baglan();
    let p = h.c.birlestirme_onizlemesi().unwrap().expect("onay bekliyor");
    assert_eq!((p.yeni, p.taslaklar.clone(), p.islem), (1, vec!["k_t".to_string()], 1));
    assert!(h.c.birlestirmeyi_onayla(Some(p.iz)).unwrap().uygulandi);
    h.pompala();
    assert!(h.canli_mi());
    assert!(!h.pc.d.kayitlar.contains_key("k_t"), "taslak onaylanmış kayıt olarak gitmedi");
    assert!(h.pc.d.kayitlar.contains_key("k_a"));
    assert!(h.c.kayit("k_t".into()).unwrap().is_none(), "görünen kopyadan çıktı");
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 1);
    assert_eq!((ret[0].kayit_id.as_str(), ret[0].neden), ("k_t", KuyrukRetNedeni::TutarsizKayit));
    assert_eq!(ret[0].govde.as_ref().unwrap().baslik, "Öneri", "kaybolmadı: düzeltilip eklenebilir");
}

/// D2 bağlı kip: servis yedekten döndü ve telefonun bildiği bir taslağı yitirdi: `ekle` ile onaylanmış
/// gitmez, ret listesine düşer; yitirilen onaylı kayıt ise bugünkü gibi yeniden gider.
#[test]
fn pc_nin_yitirdigi_taslak_onaylanmis_gitmez() {
    let mut h = Hat::yeni("guven-taslak-d2");
    h.pc.disaridan_ekle("k_a", &govde("A", None), false);
    h.eslestir();
    let yedek = h.pc.d.clone();
    h.zaman.ilerlet(DK);
    let k = h.pc.disaridan_ekle("k_t", &govde("Öneri", None), true);
    h.pc_degisti(k);
    let k = h.pc.disaridan_ekle("k_n", &govde("N", None), false);
    h.pc_degisti(k);
    h.kopar();
    h.pc.d = yedek;
    h.zaman.ilerlet(DK);
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert!(h.canli_mi());
    assert!(!h.pc.d.kayitlar.contains_key("k_t"), "taslak onaylanmış gitmedi");
    assert_eq!(h.pc.d.kayitlar["k_n"].baslik, "N", "yitirilen onaylı kayıt geri gitti");
    let ret = h.c.ret_listesi().unwrap();
    assert_eq!(ret.iter().map(|r| r.kayit_id.as_str()).collect::<Vec<_>>(), ["k_t"]);
    assert!(h.c.kayit("k_t".into()).unwrap().is_none());
}

/// Satırın `kaynak`'ını silerek PC temelini okunamaz yapar.
fn temeli_boz(h: &Hat, id: &str) {
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    let json: String = db.query_row("SELECT json FROM sunucu_kayitlari WHERE kayit_id = ?1", [id], |s| s.get(0)).unwrap();
    let mut v: Value = serde_json::from_str(&json).unwrap();
    v.as_object_mut().unwrap().remove("kaynak");
    db.execute("UPDATE sunucu_kayitlari SET json = ?2 WHERE kayit_id = ?1", [id, &v.to_string()]).unwrap();
}

/// Okunamayan PC temeli: koparma düşmez (onaylanmış satırı olsa da), sayısı `KoparmaSonucu` ve `son_gecis`'te;
/// sonraki bağlanmanın önizlemesi de sayar (temel bilinmiyor: telefonun farkı gider).
#[test]
fn okunamayan_pc_temeli_sayilir_gecisi_dusurmez() {
    let mut h = Hat::yeni("guven-temel");
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.pc.disaridan_ekle("k_y", &govde("Y", None), false);
    h.eslestir();
    h.kopar();
    h.c.duzenle("k_x".into(), None, govde("X (telefon)", None)).unwrap();
    temeli_boz(&h, "k_x");
    rusqlite::Connection::open(&h.yol).unwrap().execute("UPDATE kuyruk SET bekledigi_rev = 9", []).unwrap();
    h.sureci_oldur_ve_ac();
    let s = h.c.baglantiyi_kopar().unwrap();
    assert_eq!((s.onceki_kip, s.okunamayan_pc_temeli), (CalismaKipi::Bagli, 1));
    assert_eq!(h.c.son_gecis().unwrap().unwrap().koparma.okunamayan_pc_temeli, 1);
    assert_eq!(kayit(&h, "k_x").baslik, "X (telefon)", "görünen kopya yerinde");
    h.c.duzenle("k_y".into(), None, govde("Y (telefon)", None)).unwrap();

    h.otomatik_onay = false;
    h.eslestir();
    let p = h.c.birlestirme_onizlemesi().unwrap().expect("onay bekliyor");
    assert_eq!((p.okunamayan_pc_temeli, p.degisen), (1, 2));
    assert!(h.c.birlestirmeyi_onayla(Some(p.iz)).unwrap().uygulandi);
    h.pompala();
    assert_eq!((h.pc.d.kayitlar["k_x"].baslik.as_str(), h.pc.d.kayitlar["k_y"].baslik.as_str()), ("X (telefon)", "Y (telefon)"));
}

/// Bağlı kipte servis yedekten döndü; telefonun bildiği bir yazımın PC temeli satırı okunamıyor: sessizce
/// atlanmaz, satırın metni ret listesine düşer (yitirilen hal kaybolmaz). PC o yazımı taşıyorsa ret yok.
#[test]
fn bagli_kipte_okunamayan_temel_yitirildiyse_ret_listesine() {
    for yitirdi in [true, false] {
        let mut h = Hat::yeni(&format!("guven-temel-bagli-{yitirdi}"));
        h.pc.disaridan_ekle("k_w", &govde("W", None), false);
        h.pc.disaridan_ekle("k_x", &govde("X", None), false);
        h.eslestir();
        let yedek = h.pc.d.clone();
        h.zaman.ilerlet(DK);
        let k = h.pc.disaridan_degistir("k_x", |k| k.baslik = "X (onaylı)".into());
        h.pc_degisti(k);
        if !yitirdi {
            let k = h.pc.disaridan_degistir("k_w", |k| k.baslik = "W (onaylı)".into());
            h.pc_degisti(k);
        }
        h.kopar();
        temeli_boz(&h, "k_x");
        if yitirdi {
            h.pc.d = yedek;
        } else {
            // Dönmemiş ama iz geçmişi yok (tam telafi): k_x'in yazımı PC'de aynen var.
            h.pc.d.gecmis_izi.clear();
        }
        h.zaman.ilerlet(DK);
        let once = h.pc.uygulanan.len();
        h.baglan();
        assert_eq!(h.pc.son_welcome_tam, Some(true));
        assert!(h.canli_mi());
        let ret = h.c.ret_listesi().unwrap();
        if yitirdi {
            assert_eq!(ret.len(), 1, "{ret:?}");
            assert_eq!((ret[0].kayit_id.as_str(), ret[0].neden), ("k_x", KuyrukRetNedeni::TutarsizKayit));
            assert_eq!(ret[0].govde.as_ref().unwrap().baslik, "X (onaylı)");
        } else {
            assert!(ret.is_empty(), "{ret:?}");
            assert_eq!(h.pc.uygulanan.len(), once);
        }
        assert_eq!(kayit(&h, "k_x"), h.pc.d.kayitlar["k_x"]);
    }
}

/// Bağlı kipte aynı servisle tam telafi, servis yedekten dönmemiş (iz geçmişi yok): telefon hiçbir kayda
/// dokunmadı; PC'de başka yazar bir kaydı iki kez ilerletti, birini sildi, yeni kayıt ekledi: sıfır işlem.
/// (Yerel kipten bağlanmadaki karşılığı `donus_denetimi.rs`'te.)
#[test]
fn bagli_kipte_donmemis_serviste_islem_gitmez() {
    let mut h = Hat::yeni("guven-donmemis-bagli");
    h.pc.disaridan_ekle("k_a", &govde("A", Some(an("2026-11-26", "15:00"))), false);
    h.pc.disaridan_ekle("k_b", &govde("B", None), false);
    h.pc.disaridan_ekle("k_c", &govde("C", None), false);
    h.eslestir();
    h.kopar();
    h.zaman.ilerlet(DK);
    h.pc.disaridan_degistir("k_a", |k| k.zaman = Some(an("2026-11-26", "17:00")));
    h.pc.disaridan_degistir("k_a", |k| k.baslik = "A (PC)".into());
    h.pc.disaridan_degistir("k_b", |k| k.silindi = true);
    h.pc.disaridan_ekle("k_d", &govde("D", None), false);
    h.pc.d.gecmis_izi.clear();
    let once = h.pc.uygulanan.len();
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(true), "iz geçmişi yok: tam telafi");
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.pc.uygulanan.len(), once, "hiçbir işlem gitmedi");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert!(h.c.ret_listesi().unwrap().is_empty());
    for id in ["k_a", "k_b", "k_c", "k_d"] {
        assert_eq!(kayit(&h, id), h.pc.d.kayitlar[id], "{id}");
    }
}

// ---------------------------------------------------------------------------------------------
// İkinci gözden geçirmenin bulguları (R1, R3, R4, R6, K2)
// ---------------------------------------------------------------------------------------------

/// R1: dizinin ayraç düzeyindeki fazladan iki nokta ve çok büyük (ağacı kurulmayan) öğenin içindeki sözdizimi
/// hatası bütün belgeyi reddeder; çok büyük ama sözdizimi doğru öğe yalnız kendisini geçersiz kılar.
#[test]
fn sozdizimi_hatasi_dizi_ayracinda_ve_buyuk_ogede_reddedilir() {
    let h = Hat::yeni("guven-r1");
    let k = ornek_kayit();
    for ogeler in [format!(":{k}"), format!("{k},:{k}"), ":".to_string()] {
        let m = belge_metni(&ogeler);
        assert!(serde_json::from_str::<Value>(&m).is_err());
        let (alan, neden) = red(&h, &m);
        assert!(alan == "belge" && neden.starts_with("JSON değil"), "{neden}");
    }
    let dolgu = "x".repeat(KAYIT_AZAMI);
    let buyuk_bozuk = format!(r#"{{"aciklama":"{dolgu}","a" 1}}"#);
    assert!(buyuk_bozuk.len() > KAYIT_AZAMI);
    let (alan, neden) = red(&h, &belge_metni(&format!("{k},{buyuk_bozuk}")));
    assert!(alan == "belge" && neden.starts_with("JSON değil"), "{neden}");
    let buyuk = format!(r#"{{"aciklama":"{dolgu}","a":[1,{{"b":null}}]}}"#);
    let p = onizle(&h, &belge_metni(&format!("{k},{buyuk}")));
    assert_eq!((p.toplam, p.yeni, p.gecersiz), (2, 1, 1));
    assert_eq!(p.gecersizler[0].neden, "kayıt çok büyük");
}

/// R3: iz zorunlu. İzsiz içe aktarma ve izsiz birleştirme onayı hiçbir şey yazmaz, şimdiki planı verir; onun
/// iziyle uygulanır.
#[test]
fn izsiz_onay_hicbir_sey_uygulamaz() {
    let a = Hat::yeni("guven-r3-a");
    a.c.ekle(govde("A", None), GirdiYolu::Elle).unwrap();
    let b = Hat::yeni("guven-r3-b");
    let s = b.c.ice_aktar(belge(&a), None).unwrap();
    assert!(!s.uygulandi);
    assert_eq!((s.plan.yeni, s.plan.iz.clone()), (1, onizle(&b, &belge(&a)).iz));
    assert_eq!(b.c.disa_aktar().unwrap().kayit, 0, "hiçbir şey yazılmadı");
    assert!(b.c.ice_aktar(belge(&a), Some(s.plan.iz)).unwrap().uygulandi);
    assert_eq!(b.c.disa_aktar().unwrap().kayit, 1);

    let (mut h, iz) = onay_bekleyen("guven-r3-birlestirme");
    let s = h.c.birlestirmeyi_onayla(None).unwrap();
    assert!(!s.uygulandi && !s.zaten_uygulandi);
    assert_eq!(s.plan.as_ref().map(|p| p.iz.as_str()), Some(iz.as_str()));
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel, "dökülmedi");
    assert!(h.c.birlestirmeyi_onayla(Some(iz)).unwrap().uygulandi);
    h.pompala();
    assert_eq!(h.pc.d.kayitlar["k_x"].baslik, "X (telefon)");
}

/// R4: telefondaki taslak, dosyadaki aynı kimlikli daha yeni onaylı halle onaylanır (karar: kullanıcı yedekteki
/// onaylı hali seçer; `motor/aktarma.rs` başı) ve önizlemede ayrı sayılır. Bağlı kipte `onayla` servise gider,
/// yerel kipte doğrudan yazılır. Dosyadaki hal telefondakinden eskiyse taslak kalır.
#[test]
fn taslak_ice_aktarmayla_onaylanir_ayri_sayilir() {
    let mut h = Hat::yeni("guven-r4-bagli");
    h.pc.disaridan_ekle("k_t", &govde("Öneri", Some(an("2026-11-27", "10:00"))), true);
    h.pc.disaridan_ekle("k_a", &govde("A", None), false);
    h.eslestir();
    assert!(kayit(&h, "k_t").taslak);
    let taban = json_belge(&h);
    let onayli = |ms: i64| {
        let mut v = taban.clone();
        let k = kaydi_bul(&mut v, "k_t");
        k["taslak"] = json!(false);
        k["guncelleme_ms"] = json!(ms);
        v.to_string()
    };
    let eski = onizle(&h, &onayli(kayit(&h, "k_t").guncelleme_ms));
    assert_eq!((eski.guncellenecek, eski.taslak_onaylanacak, eski.atlanacak), (0, 0, 1));
    let p = onizle(&h, &onayli(SIMDI + DK));
    assert_eq!((p.guncellenecek, p.taslak_onaylanacak, p.kuyruga_girecek_islem, p.ayni), (1, 1, 1, 1));
    assert!(h.c.ice_aktar(onayli(SIMDI + DK), Some(p.iz)).unwrap().uygulandi);
    h.pompala();
    assert!(!h.pc.d.kayitlar["k_t"].taslak, "servise onayla gitti");
    assert!(!kayit(&h, "k_t").taslak);

    let mut y = Hat::yeni("guven-r4-yerel");
    y.pc.disaridan_ekle("k_t", &govde("Öneri", Some(an("2026-11-27", "10:00"))), true);
    y.eslestir();
    y.kopar();
    y.c.baglantiyi_kopar().unwrap();
    assert_eq!(y.c.kip().unwrap(), CalismaKipi::Yerel);
    let mut v = json_belge(&y);
    let k = kaydi_bul(&mut v, "k_t");
    k["taslak"] = json!(false);
    k["guncelleme_ms"] = json!(SIMDI + DK);
    let p = onizle(&y, &v.to_string());
    assert_eq!((p.kip, p.guncellenecek, p.taslak_onaylanacak), (CalismaKipi::Yerel, 1, 1));
    assert!(y.c.ice_aktar(v.to_string(), Some(p.iz)).unwrap().uygulandi);
    assert!(!kayit(&y, "k_t").taslak);
}

/// Görünen satırın `kaynak`'ını silerek okunamaz yapar.
fn goruneni_boz(h: &Hat, id: &str) {
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    let json: String = db.query_row("SELECT json FROM gorunen WHERE kayit_id = ?1", [id], |s| s.get(0)).unwrap();
    let mut v: Value = serde_json::from_str(&json).unwrap();
    v.as_object_mut().unwrap().remove("kaynak");
    db.execute("UPDATE gorunen SET json = ?2 WHERE kayit_id = ?1", [id, &v.to_string()]).unwrap();
}

/// R6: yerel kipte okunamayan telefon satırı dosyadaki halle onarılır; eski metin kaybolmaz, ret listesine düşer
/// (`tutarsiz_kayit`, gövdesi düzeltme formunda) ve önizlemede sayılır. Dosyadaki mezar taşı canlı okunamayan
/// satırın yerine geçiyorsa `silinecek`'te de sayılır. Bağlı kipte okunamayan satır atlanır.
#[test]
fn okunamayan_telefon_satiri_ret_listesine_duser() {
    let mut b = Hat::yeni("guven-r6");
    let x = b.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let y = b.c.ekle(govde("Y", None), GirdiYolu::Elle).unwrap();
    let mut v = json_belge(&b);
    kaydi_bul(&mut v, &y)["silindi"] = json!(true);
    goruneni_boz(&b, &x);
    goruneni_boz(&b, &y);
    b.sureci_oldur_ve_ac();
    let p = onizle(&b, &v.to_string());
    assert_eq!((p.guncellenecek, p.okunamayan_ret_listesine, p.silinecek), (2, 2, 1));
    b.gozlemci.al();
    assert!(b.c.ice_aktar(v.to_string(), Some(p.iz)).unwrap().uygulandi);
    assert!(b.gozlemci.al().iter().any(|d| d.ret_listesi));
    assert_eq!(kayit(&b, &x).baslik, "X");
    assert!(kayit(&b, &y).silindi);
    let ret = b.c.ret_listesi().unwrap();
    assert_eq!(ret.len(), 2);
    assert!(ret.iter().all(|r| r.neden == KuyrukRetNedeni::TutarsizKayit));
    let mut basliklar: Vec<&str> = ret.iter().filter_map(|r| r.govde.as_ref().map(|g| g.baslik.as_str())).collect();
    basliklar.sort_unstable();
    assert_eq!(basliklar, ["X", "Y"], "eski metin kaybolmadı");

    let mut h = Hat::yeni("guven-r6-bagli");
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.eslestir();
    let mut v = json_belge(&h);
    kaydi_bul(&mut v, "k_x")["guncelleme_ms"] = json!(SIMDI + DK);
    kaydi_bul(&mut v, "k_x")["baslik"] = json!("X (dosya)");
    goruneni_boz(&h, "k_x");
    let p = onizle(&h, &v.to_string());
    assert_eq!((p.atlanacak, p.okunamayan_ret_listesine, p.kuyruga_girecek_islem), (1, 0, 0));
}

/// Kuyruğun yollanmasını (`yollandi` güncellemesi) düşüren tetik: kalıcı işlemden sonraki adımın hatası.
fn kuyrugu_boz(h: &Hat, acik: bool) {
    let db = rusqlite::Connection::open(&h.yol).unwrap();
    let sql = if acik {
        "CREATE TRIGGER kuyruk_bozuk BEFORE UPDATE OF yollandi ON kuyruk BEGIN SELECT RAISE(ABORT, 'test'); END;"
    } else {
        "DROP TRIGGER kuyruk_bozuk;"
    };
    db.execute_batch(sql).unwrap();
}

/// Bağlı kipten koparılmış, telefonda bir değişikliği olan ve yeniden eşleşip onay bekleyen hat (ve iz).
fn onay_bekleyen(ad: &str) -> (Hat, String) {
    let mut h = Hat::yeni(ad);
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.eslestir();
    h.kopar();
    h.c.baglantiyi_kopar().unwrap();
    h.c.duzenle("k_x".into(), None, govde("X (telefon)", None)).unwrap();
    h.otomatik_onay = false;
    h.eslestir();
    let iz = h.c.birlestirme_onizlemesi().unwrap().expect("onay bekliyor").iz;
    (h, iz)
}

/// K2: dökme kalıcı olduktan sonra kuyruğun yollanması hata verse de onay başarıdır; ikinci (gecikmiş) onay
/// `zaten_uygulandi` der, "bağlantı koptu" ile karışmaz; kuyruk sonraki bağlantıda gider. Başka izle ya da
/// izsiz gelen onay `zaten_uygulandi` değildir; süreç yeniden açılsa da iz bilinir.
#[test]
fn onaydan_sonraki_adimin_hatasi_onayi_bozmaz() {
    let (mut h, iz) = onay_bekleyen("guven-k2");
    kuyrugu_boz(&h, true);
    let s = h.c.birlestirmeyi_onayla(Some(iz.clone())).unwrap();
    assert!(s.uygulandi && !s.zaten_uygulandi);
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    let ikinci = h.c.birlestirmeyi_onayla(Some(iz.clone())).unwrap();
    assert!(!ikinci.uygulandi && ikinci.plan.is_none() && ikinci.zaten_uygulandi);
    let baska = h.c.birlestirmeyi_onayla(Some("0000000000000000".into())).unwrap();
    assert!(!baska.uygulandi && baska.plan.is_none() && !baska.zaten_uygulandi);
    assert!(!h.c.birlestirmeyi_onayla(None).unwrap().zaten_uygulandi);
    kuyrugu_boz(&h, false);
    h.kopar();
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.d.kayitlar["k_x"].baslik, "X (telefon)", "kuyruk sonraki bağlantıda gitti");
    h.sureci_oldur_ve_ac();
    assert!(h.c.birlestirmeyi_onayla(Some(iz)).unwrap().zaten_uygulandi);
}

/// Onay işleminin içinde hata (dökmenin işlem kimliği alınamadı): hiçbir şey yazılmaz, onay beklemeye devam
/// eder (kip yerel, aynı plan); aynı izle yeniden onay uygulanır.
#[test]
fn onay_isleminin_icindeki_hata_hicbir_sey_yazmaz() {
    let (mut h, iz) = onay_bekleyen("guven-k2-ic");
    h.kimlik.rastgele_hatasi.store(1, std::sync::atomic::Ordering::SeqCst);
    assert!(h.c.birlestirmeyi_onayla(Some(iz.clone())).is_err());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert_eq!(h.c.birlestirme_onizlemesi().unwrap().expect("hâlâ bekliyor").iz, iz);
    assert!(h.c.birlestirmeyi_onayla(Some(iz)).unwrap().uygulandi);
    h.pompala();
    assert_eq!(h.pc.d.kayitlar["k_x"].baslik, "X (telefon)");
}

/// K2 (`ice_aktar`): bağlı kipte kuyruğa yazıldıktan sonra yollama hata verse de içe aktarma başarıdır;
/// işlemler kuyrukta kalır, sonraki bağlantıda gider.
#[test]
fn ice_aktarmadan_sonraki_kuyruk_hatasi_uygulamayi_bozmaz() {
    let mut h = Hat::yeni("guven-k2-aktarma");
    h.pc.disaridan_ekle("k_x", &govde("X", None), false);
    h.eslestir();
    let mut v = json_belge(&h);
    kaydi_bul(&mut v, "k_x")["baslik"] = json!("X (dosya)");
    kaydi_bul(&mut v, "k_x")["guncelleme_ms"] = json!(SIMDI + DK);
    let p = onizle(&h, &v.to_string());
    kuyrugu_boz(&h, true);
    let s = h.c.ice_aktar(v.to_string(), Some(p.iz)).unwrap();
    assert!(s.uygulandi);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 1);
    kuyrugu_boz(&h, false);
    h.kopar();
    h.baglan();
    assert_eq!(h.pc.d.kayitlar["k_x"].baslik, "X (dosya)");
}

/// Köprünün bayt eşleri (`ice_aktarma_onizlemesi_bayt`, `ice_aktar_bayt`; Kotlin `ByteArray`): `String`
/// sürümleriyle aynı önizleme, aynı hata ve aynı iz (iki yol karışık kullanılabilir). UTF-8 olmayan bayt
/// yalnız konumla reddedilir, hiçbir şey yazılmaz.
#[test]
fn bayt_esleri_metin_surumleriyle_ayni() {
    let a = Hat::yeni("guven-bayt-a");
    let x = a.c.ekle(govde("Örnek ğüşiöç €", Some(an("2026-11-26", "10:00"))), GirdiYolu::Elle).unwrap();
    a.c.ekle(govde("İkinci", None), GirdiYolu::Elle).unwrap();
    a.c.sil(x).unwrap();
    let gecerli = belge(&a);
    let k = ornek_kayit();
    let belgeler = [
        gecerli.clone(),
        belge_metni(&format!("{k},0,{{}}")),
        belge_metni(&format!(":{k}")),
        belge_metni(&vec!["0"; DIZI_AZAMI + 1].join(",")),
        gecerli.replace("eren_ajanda_yedegi", "baska"),
        gecerli.replacen(&format!("\"sozlesme_surumu\":{AJANDA_SURUMU}"), "\"sozlesme_surumu\":999", 1),
        "{".to_string(),
        String::new(),
    ];
    let b = Hat::yeni("guven-bayt-b");
    for m in &belgeler {
        let metin = b.c.ice_aktarma_onizlemesi(m.clone());
        let bayt = b.c.ice_aktarma_onizlemesi_bayt(m.as_bytes().to_vec());
        assert_eq!(format!("{metin:?}"), format!("{bayt:?}"), "önizleme");
        let metin = b.c.ice_aktar(m.clone(), None);
        let bayt = b.c.ice_aktar_bayt(m.as_bytes().to_vec(), None);
        assert_eq!(format!("{metin:?}"), format!("{bayt:?}"), "izsiz uygulama");
    }
    assert_eq!(b.c.disa_aktar().unwrap().kayit, 0, "izsiz ve bozuk belge hiçbir şey yazmadı");

    // UTF-8 değil: geçerli belgenin içine yarım bir çok baytlı karakter; konum taşır, içerik taşımaz.
    let mut bozuk = gecerli.clone().into_bytes();
    let yer = gecerli.find("ğ").unwrap();
    bozuk.truncate(yer + 1);
    bozuk.extend_from_slice(&gecerli.as_bytes()[yer + 2..]);
    for s in [b.c.ice_aktarma_onizlemesi_bayt(bozuk.clone()).map(|_| ()), b.c.ice_aktar_bayt(bozuk.clone(), Some("0".repeat(16))).map(|_| ())] {
        match s {
            Err(CekirdekHatasi::GecersizGirdi { alan, neden }) => assert_eq!((alan, neden), ("belge".to_string(), format!("UTF-8 değil (bayt {yer})"))),
            s => panic!("reddedilmedi: {s:?}"),
        }
    }
    // Baştaki BOM ayıklanmaz (`String` yolundaki gibi): JSON değil.
    let bom = [b"\xef\xbb\xbf".as_slice(), gecerli.as_bytes()].concat();
    assert_eq!(
        format!("{:?}", b.c.ice_aktarma_onizlemesi_bayt(bom)),
        format!("{:?}", b.c.ice_aktarma_onizlemesi(format!("\u{feff}{gecerli}")))
    );

    // Karışık yol: metinle önizleme, baytla uygulama (ve tersi) aynı izle uygulanır.
    let on = b.c.ice_aktarma_onizlemesi(gecerli.clone()).unwrap();
    assert_eq!((on.yeni, on.silinmis), (2, 1));
    let s = b.c.ice_aktar_bayt(gecerli.clone().into_bytes(), Some(on.iz)).unwrap();
    assert!(s.uygulandi);
    assert_eq!(b.c.disa_aktar().unwrap().kayit, 2);
    let c = Hat::yeni("guven-bayt-c");
    let on = c.c.ice_aktarma_onizlemesi_bayt(gecerli.clone().into_bytes()).unwrap();
    assert!(c.c.ice_aktar(gecerli.clone(), Some(on.iz)).unwrap().uygulandi);
    assert_eq!(c.c.disa_aktar().unwrap().kayit, 2);
}
