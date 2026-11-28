//! D3 dışa ve içe aktarma uçtan uca: köprünün açık yüzeyi + sahte kabuklar ve sahte PC (`ortak`). Belge
//! biçimi ve kurallar `src/motor/aktarma.rs` başında. Kişisel veri yoktur.

mod ortak;

use std::collections::BTreeMap;
use std::time::Instant;

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::aktarma_bicimi;
use ajanda_cekirdek::kopru::kabuklar::ZamanKabugu;
use ajanda_cekirdek::kopru::tipler::{CalismaKipi, IceAktarmaOnizlemesi};
use ajanda_cekirdek::model::surum::AJANDA_SURUMU;
use ajanda_cekirdek::model::sinirlar::ajanda::KAYIT_ADET;
use ajanda_cekirdek::model::{
    AjandaKaydi, GirdiYolu, IslemTuru, KayitDurumu, KaynakYolu, OrnekDurumu, Tekrar, TekrarSikligi, TurKokeni,
};
use ortak::*;
use serde_json::{Value, json};

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

/// Bütün görünen kayıtlar, revizyonsuz (revizyon telefonun kendi numarasıdır).
fn normal(h: &Hat) -> BTreeMap<String, AjandaKaydi> {
    Depo::ac(&h.yol)
        .unwrap()
        .gorunen_hepsi()
        .unwrap()
        .into_iter()
        .map(|k| (k.kayit_id.clone(), AjandaKaydi { revizyon: 0, ..k }))
        .collect()
}

fn gecmis_sayisi(h: &Hat, id: &str) -> i64 {
    Depo::ac(&h.yol).unwrap().yerel_gecmis_sayisi(id).unwrap()
}

fn kuyruk_uzunlugu(h: &Hat) -> usize {
    Depo::ac(&h.yol).unwrap().kuyruk().unwrap().len()
}

fn spor_govdesi() -> ajanda_cekirdek::model::KayitGovdesi {
    let mut g = govde("Spor", Some(an("2026-11-23", "07:00")));
    g.tekrar = Some(Tekrar { siklik: TekrarSikligi::Gunluk, aralik: 1, gunler: None, bitis_tarihi: None, adet: None });
    g
}

/// (yeni, güncellenecek, aynı, atlanacak, geçersiz, sınırı aşan)
fn sayilar(p: &IceAktarmaOnizlemesi) -> (i32, i32, i32, i32, i32, i32) {
    (p.yeni, p.guncellenecek, p.ayni, p.atlanacak, p.gecersiz, p.sinir_asan)
}

fn belge(h: &Hat) -> String {
    h.c.disa_aktar().unwrap().belge
}

fn json_belge(h: &Hat) -> Value {
    serde_json::from_str(&belge(h)).unwrap()
}

fn kayitlar_mut(v: &mut Value) -> &mut Vec<Value> {
    v["kayitlar"].as_array_mut().unwrap()
}

fn kaydi_bul<'a>(v: &'a mut Value, id: &str) -> &'a mut Value {
    kayitlar_mut(v).iter_mut().find(|k| k["kayit_id"] == id).unwrap()
}

/// `taban`'ın kopyasını `f` ile değiştirip metne çevirir.
fn degistir(taban: &Value, f: impl FnOnce(&mut Value)) -> String {
    let mut v = taban.clone();
    f(&mut v);
    v.to_string()
}

fn uygula(h: &Hat, b: &str) -> IceAktarmaOnizlemesi {
    let s = h.ice_aktar_onayla(b);
    assert!(s.uygulandi);
    s.plan
}

/// Yerel kipte çeşitli kayıtlar: PC'den gelmiş (sohbet aracı, biri taslak), sesli not, örnek durumlu tekrar,
/// mezar taşı, tamamlanmış.
fn zengin_telefon(ad: &str) -> (Hat, Vec<String>) {
    let mut h = Hat::yeni(ad);
    h.pc.disaridan_ekle("k_pc_taslak", &govde("Taslak", Some(an("2026-11-27", "10:00"))), true);
    h.pc.disaridan_ekle("k_pc_arac", &govde("Araç", None), false);
    h.eslestir();
    h.c.baglantiyi_kopar().unwrap();
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    h.zaman.ilerlet(DK);
    let disci = h.c.ekle(govde("Dişçi", Some(an("2026-11-26", "15:00"))), GirdiYolu::SesliNot).unwrap();
    let spor = h.c.ekle(spor_govdesi(), GirdiYolu::Elle).unwrap();
    h.c.durum_degistir(spor.clone(), KayitDurumu::Tamam, Some("2026-11-24".into())).unwrap();
    h.c.durum_degistir(spor.clone(), KayitDurumu::Iptal, Some("2026-11-25".into())).unwrap();
    let silinen = h.c.ekle(govde("Eski", None), GirdiYolu::Elle).unwrap();
    h.c.sil(silinen.clone()).unwrap();
    let biten = h.c.ekle(govde("Biten", Some(an("2026-11-28", "09:00"))), GirdiYolu::Elle).unwrap();
    h.c.durum_degistir(biten.clone(), KayitDurumu::Tamam, None).unwrap();
    (h, vec!["k_pc_taslak".into(), "k_pc_arac".into(), disci, spor, silinen, biten])
}

#[test]
fn bicim_sabitleri_koprude() {
    let b = aktarma_bicimi();
    // Okunabilen en yeni biçim 3 (genişlemiş `retler`); yazılan, içeriğin gerektirdiği en düşüğü.
    assert_eq!((b.belge_adi.as_str(), b.ekler_dizini.as_str(), b.bicim_surumu), ("ajanda.json", "ekler/", 3));
    assert_eq!((b.ek_azami_bayt, b.ek_azami_adet), (4 * 1024 * 1024, 10_000));
    // Bellek koruması (gerçekçi en büyük yedek): belge 64 MiB, kaptaki ekler toplamı 16 MiB, açılmış toplam ikisi.
    assert_eq!((b.belge_azami_bayt, b.ekler_toplam_azami_bayt), (64 << 20, 16 << 20));
    assert_eq!(b.acilmis_toplam_azami_bayt, b.belge_azami_bayt + b.ekler_toplam_azami_bayt);
}

/// Dışa aktar -> boş telefona içe aktar: kayıtlar alan alan aynı (revizyon dışında), mezar taşı, örnek
/// durumları, kaynak izi ve taslak dahil; alarmlar aynı, her kayda bir yerel geçmiş satırı; yinelenen içe
/// aktarma hiçbir şey yazmaz.
#[test]
fn gidis_donus_bos_telefona_alan_alan_ayni() {
    let (a, idler) = zengin_telefon("gidis-a");
    let d = a.c.disa_aktar().unwrap();
    assert_eq!((d.kayit, d.silinmis, d.okunamayan, d.ret_listesinde, d.kip), (6, 1, 0, 0, CalismaKipi::Yerel));
    assert!(d.ekler.is_empty());
    let v: Value = serde_json::from_str(&d.belge).unwrap();
    assert_eq!((v["bicim"].as_str(), v["bicim_surumu"].as_i64(), v["sozlesme_surumu"].as_i64()), (Some("eren_ajanda_yedegi"), Some(1), Some(AJANDA_SURUMU)));
    assert_eq!((v["ekler"].clone(), v["bolgeler"].clone(), v["kip"].clone()), (json!([]), json!([]), json!("yerel")));
    assert_eq!(v["olusturma_ms"].as_i64(), Some(a.zaman.simdi_ms()));

    let b = Hat::yeni("gidis-b");
    b.gozlemci.al();
    let on = b.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    assert_eq!(sayilar(&on), (6, 0, 0, 0, 0, 0));
    assert_eq!((on.toplam, on.silinmis, on.kip, on.disa_aktarma_ms), (6, 1, CalismaKipi::Yerel, a.zaman.simdi_ms()));
    assert!(b.gozlemci.al().is_empty(), "önizleme hiçbir şey yazmaz");
    assert!(normal(&b).is_empty());
    let s = b.c.ice_aktar(d.belge.clone(), Some(on.iz.clone())).unwrap();
    assert!(s.uygulandi);
    assert_eq!(s.plan, on);

    assert_eq!(normal(&a), normal(&b));
    let spor = kayit(&b, &idler[3]);
    assert_eq!(spor.ornekler.iter().map(|o| (o.tarih.as_str(), o.durum)).collect::<Vec<_>>(), [("2026-11-24", OrnekDurumu::Tamam), ("2026-11-25", OrnekDurumu::Iptal)]);
    assert!(kayit(&b, &idler[4]).silindi);
    let taslak = kayit(&b, "k_pc_taslak");
    assert!(taslak.taslak);
    assert_eq!((taslak.kaynak.yol, taslak.kaynak.tur_kokeni), (KaynakYolu::SohbetAraci, TurKokeni::Sentetik));
    assert_eq!(kayit(&b, &idler[2]).kaynak.yol, KaynakYolu::SesliNot);
    // Revizyonlar telefonun yerel sayacından: tekil ve artan.
    let mut revler: Vec<i64> = idler.iter().map(|id| kayit(&b, id).revizyon).collect();
    revler.sort_unstable();
    revler.dedup();
    assert_eq!(revler.len(), 6);
    // Alarm planı aynı; kuyruk boş, kip yerel, her kayda bir geçmiş satırı.
    assert_eq!(a.alarm.kurulular(), b.alarm.kurulular());
    assert!(!b.alarm.kurulular().is_empty());
    assert_eq!((b.c.kip().unwrap(), kuyruk_uzunlugu(&b)), (CalismaKipi::Yerel, 0));
    for id in &idler {
        assert_eq!(gecmis_sayisi(&b, id), 1, "{id}");
    }
    let mut degisen: Vec<String> = b.gozlemci.al().into_iter().flat_map(|d| d.kayitlar).collect();
    degisen.sort();
    let mut beklenen = idler.clone();
    beklenen.sort();
    assert_eq!(degisen, beklenen);

    // Aynı belge yeniden: hepsi aynı, hiçbir şey yazılmaz.
    let on2 = b.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    assert_eq!(sayilar(&on2), (0, 0, 6, 0, 0, 0));
    uygula(&b, &d.belge);
    assert!(b.gozlemci.al().is_empty());
    assert!(idler.iter().all(|id| gecmis_sayisi(&b, id) == 1));
    // B'nin belgesindeki kayıtlar A'nınkiyle revizyon dışında aynı.
    let kayitlari = |v: Value| -> Vec<Value> {
        let mut l: Vec<Value> = v["kayitlar"].as_array().unwrap().iter().cloned().map(|mut k| {
            k["revizyon"] = json!(0);
            k
        }).collect();
        l.sort_by_key(|k| k["kayit_id"].as_str().unwrap().to_string());
        l
    };
    assert_eq!(kayitlari(json_belge(&a)), kayitlari(json_belge(&b)));
}

/// Aynı kimlikli kayıtta `guncelleme_ms`'i büyük olan kalır, iki yönde; mezar taşı da (silme ve geri yükleme);
/// eşit anda telefondaki kalır.
#[test]
fn cakismada_daha_yeni_kazanir_iki_yonde() {
    let a = Hat::yeni("cakisma-a");
    let x = a.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let y = a.c.ekle(govde("Y", None), GirdiYolu::Elle).unwrap();
    let b = Hat::yeni("cakisma-b");
    uygula(&b, &belge(&a));
    a.zaman.ilerlet(DK);
    a.c.duzenle(x.clone(), None, govde("X (A)", None)).unwrap();
    b.zaman.ilerlet(2 * DK);
    b.c.duzenle(y.clone(), None, govde("Y (B)", None)).unwrap();

    // A -> B: X dosyada yeni, Y telefonda yeni.
    let on = b.c.ice_aktarma_onizlemesi(belge(&a)).unwrap();
    assert_eq!(sayilar(&on), (0, 1, 0, 1, 0, 0));
    uygula(&b, &belge(&a));
    assert_eq!((kayit(&b, &x).baslik.as_str(), kayit(&b, &y).baslik.as_str()), ("X (A)", "Y (B)"));
    assert_eq!(kayit(&b, &x).guncelleme_ms, kayit(&a, &x).guncelleme_ms, "güncelleme anı dosyadaki gibi kalır");
    // B -> A: X aynı, Y güncellenir; iki telefon eşit.
    let on = a.c.ice_aktarma_onizlemesi(belge(&b)).unwrap();
    assert_eq!(sayilar(&on), (0, 1, 1, 0, 0, 0));
    uygula(&a, &belge(&b));
    assert_eq!(normal(&a), normal(&b));

    // Mezar taşı: A'da daha yeni silme B'de de siler; B'de daha yeni geri yükleme A'ya döner.
    a.zaman.ilerlet(10 * DK);
    a.c.sil(x.clone()).unwrap();
    assert_eq!(sayilar(&uygula(&b, &belge(&a))), (0, 1, 1, 0, 0, 0));
    assert!(kayit(&b, &x).silindi);
    b.zaman.ilerlet(20 * DK);
    b.c.geri_yukle(x.clone()).unwrap();
    assert_eq!(sayilar(&uygula(&a, &belge(&b))), (0, 1, 1, 0, 0, 0));
    assert!(!kayit(&a, &x).silindi);
    // Eski bir belge (silinmiş hal) artık atlanır.
    let mut eski = json_belge(&b);
    kaydi_bul(&mut eski, &x)["silindi"] = json!(true);
    kaydi_bul(&mut eski, &x)["guncelleme_ms"] = json!(SIMDI);
    assert_eq!(sayilar(&a.c.ice_aktarma_onizlemesi(eski.to_string()).unwrap()), (0, 0, 1, 1, 0, 0));

    // Eşit anda farklı içerik: telefondaki kalır.
    let mut esit = json_belge(&a);
    kaydi_bul(&mut esit, &y)["baslik"] = json!("Y (eşit an)");
    let on = b.c.ice_aktarma_onizlemesi(esit.to_string()).unwrap();
    assert_eq!(sayilar(&on), (0, 0, 1, 1, 0, 0));
    uygula(&b, &esit.to_string());
    assert_eq!(kayit(&b, &y).baslik, "Y (B)");
}

/// Önizleme sayıları; tek bozuk kayıt aktarmayı düşürmez: geçersizler konumla sayılır, uygulanmaz.
#[test]
fn bozuk_kayitlar_gecersiz_sayilir_digerleri_uygulanir() {
    let a = Hat::yeni("bozuk-a");
    let x = a.c.ekle(govde("X", Some(an("2026-11-26", "10:00"))), GirdiYolu::Elle).unwrap();
    a.c.ekle(govde("Y", None), GirdiYolu::Elle).unwrap();
    let mut v = json_belge(&a);
    let ornek = kaydi_bul(&mut v, &x).clone();
    let mut basliksiz = ornek.clone();
    basliksiz.as_object_mut().unwrap().remove("baslik");
    basliksiz["kayit_id"] = json!("k_basliksiz");
    let mut dilimsiz = ornek.clone();
    dilimsiz["kayit_id"] = json!("k_dilimsiz");
    dilimsiz["zaman"]["saat_dilimi"] = json!("Mars/Olympus");
    let mut fazla = ornek.clone();
    fazla["kayit_id"] = json!("k_fazla");
    fazla["bilinmeyen anahtar"] = json!(1);
    let mut kurali_bozan = ornek.clone();
    kurali_bozan["kayit_id"] = json!("k_kural");
    kurali_bozan["guncelleme_ms"] = json!(1);
    let l = kayitlar_mut(&mut v);
    l.push(basliksiz);
    l.push(ornek.clone()); // yinelenen
    l.push(dilimsiz);
    l.push(fazla);
    l.push(json!("kayıt değil"));
    l.push(kurali_bozan);
    let b = Hat::yeni("bozuk-b");
    let on = b.c.ice_aktarma_onizlemesi(v.to_string()).unwrap();
    assert_eq!(sayilar(&on), (2, 0, 0, 0, 6, 0));
    assert_eq!(on.toplam, 8);
    let konumlar: Vec<(i32, &str, &str)> = on.gecersizler.iter().map(|g| (g.sira, g.alan.as_str(), g.neden.as_str())).collect();
    assert_eq!(konumlar, [
        (2, "kayitlar.2.baslik", "zorunlu alan yok"),
        (3, "kayitlar.3.kayit_id", "dosyada yinelenen kayit_id"),
        (4, "kayitlar.4.zaman.saat_dilimi", "saat dilimi bilinmiyor"),
        (5, "kayitlar.5", "bilinmeyen alan"),
        (6, "kayitlar.6", "nesne değil"),
        (7, "kayitlar.7.guncelleme_ms", "güncelleme oluşturmadan önce"),
    ]);
    let s = b.c.ice_aktar(v.to_string(), Some(on.iz.clone())).unwrap();
    assert!(s.uygulandi);
    assert_eq!(normal(&a), normal(&b));
    assert_eq!(kayit(&b, &x).baslik, "X");
}

/// Belge bütünüyle okunamıyorsa (ya da daha yeni bir sürümse) açık hatayla reddedilir, hiçbir şey yazılmaz.
#[test]
fn gecersiz_belge_ve_daha_yeni_surum_reddedilir() {
    let a = Hat::yeni("red-a");
    a.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let taban = json_belge(&a);
    let degistir = |f: fn(&mut Value)| degistir(&taban, f);
    let durumlar: Vec<(String, &str, &str)> = vec![
        ("değil {".into(), "belge", "JSON değil"),
        ("[]".into(), "belge", "nesne değil"),
        (degistir(|v| v["bicim"] = json!("baska")), "bicim", "ajanda yedeği değil"),
        (
            degistir(|v| {
                v["bicim_surumu"] = json!(4);
                v["yeni_alan"] = json!({"x": 1});
                v["kayitlar"] = json!("başka biçim");
            }),
            "bicim_surumu",
            "daha yeni",
        ),
        (degistir(|v| v["sozlesme_surumu"] = json!(AJANDA_SURUMU + 1)), "sozlesme_surumu", "daha yeni"),
        (degistir(|v| v["bicim_surumu"] = json!(0)), "bicim_surumu", ""),
        (degistir(|v| v["sozlesme_surumu"] = json!("2")), "sozlesme_surumu", ""),
        (
            degistir(|v| {
                v.as_object_mut().unwrap().remove("kayitlar");
            }),
            "kayitlar",
            "zorunlu alan yok",
        ),
        (degistir(|v| v["kayitlar"] = json!({})), "kayitlar", "dizi değil"),
        (degistir(|v| v["bolgeler"] = json!([{}])), "bolgeler", "tanımsız"),
        (degistir(|v| v["ekler"] = json!([{"ozet": "xyz", "bayt": 1, "mime": "image/jpeg"}])), "ekler.0.ozet", ""),
        (degistir(|v| v["olusturma_ms"] = json!(-1)), "olusturma_ms", ""),
        (degistir(|v| v["kip"] = json!("x")), "kip", "kapalı listede yok"),
        (degistir(|v| v["fazladan"] = json!(1)), "belge", "bilinmeyen alan"),
    ];
    let b = Hat::yeni("red-b");
    for (metin, alan_, neden_) in &durumlar {
        for sonuc in [b.c.ice_aktarma_onizlemesi(metin.clone()).map(|_| ()), b.c.ice_aktar(metin.clone(), None).map(|_| ())] {
            match sonuc {
                Err(CekirdekHatasi::GecersizGirdi { alan, neden }) => {
                    assert_eq!(&alan, alan_, "{neden}");
                    assert!(neden.contains(neden_), "{alan}: {neden}");
                }
                s => panic!("{alan_}: reddedilmedi: {s:?}"),
            }
        }
    }
    assert!(normal(&b).is_empty());
    assert!(b.gozlemci.al().is_empty());

    // Daha eski sözleşme sürümü okunur; geçerli ek dizini önizlemeye gelir.
    let ozet = "0123456789abcdef".repeat(4);
    let eski = self::degistir(&taban, |v| {
        v["sozlesme_surumu"] = json!(1);
        v["ekler"] = json!([{"ozet": ozet, "bayt": 2048, "mime": "image/jpeg"}]);
    });
    let on = b.c.ice_aktarma_onizlemesi(eski).unwrap();
    assert_eq!(on.yeni, 1);
    assert_eq!(on.ekler.len(), 1);
    assert_eq!((on.ekler[0].yol.clone(), on.ekler[0].bayt), (format!("ekler/{ozet}"), 2048));
    let yinelenen = self::degistir(&taban, |v| v["ekler"] = json!([{"ozet": ozet, "bayt": 1, "mime": "image/png"}, {"ozet": ozet, "bayt": 1, "mime": "image/png"}]));
    assert!(matches!(b.c.ice_aktarma_onizlemesi(yinelenen), Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "ekler.1.ozet"));
}

/// Kayıt sınırı (mezar taşları dahil) içe aktarmada da geçerli: yer kalmayınca yeniler `sinir_asan`.
#[test]
fn kayit_siniri_ice_aktarmada_gecerli() {
    let a = Hat::yeni("sinir-a");
    for b in ["A", "B", "C"] {
        a.c.ekle(govde(b, None), GirdiYolu::Elle).unwrap();
    }
    let ilk = a.c.ekle(govde("Var olan", None), GirdiYolu::Elle).unwrap();
    let b = Hat::yeni("sinir-b");
    let mut v = json_belge(&a);
    kayitlar_mut(&mut v).retain(|k| k["kayit_id"] == ilk.as_str());
    uygula(&b, &v.to_string());
    {
        let db = rusqlite::Connection::open(&b.yol).unwrap();
        db.execute(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
             INSERT INTO gorunen (kayit_id, json, tarihli, sira_anahtari, taslak, silindi, acik, etkin, bekleyen, olusturma_ms)
             SELECT 'k_dolgu' || i, '{}', 0, '', 0, 1, 0, 0, 0, 0 FROM n",
            [KAYIT_ADET as i64 - 3],
        )
        .unwrap();
    }
    // Telefonda KAYIT_ADET - 2 satır: iki yeni sığar, üçüncüsü aşar; var olan kaydın güncellenmesi sınırdan
    // etkilenmez.
    a.zaman.ilerlet(DK);
    a.c.duzenle(ilk.clone(), None, govde("Var olan (yeni)", None)).unwrap();
    let on = b.c.ice_aktarma_onizlemesi(belge(&a)).unwrap();
    assert_eq!(sayilar(&on), (2, 1, 0, 0, 0, 1));
    uygula(&b, &belge(&a));
    assert_eq!(Depo::ac(&b.yol).unwrap().gorunen_sayisi().unwrap(), KAYIT_ADET as i64);
    assert_eq!(kayit(&b, &ilk).baslik, "Var olan (yeni)");
}

/// Yerel kipte içe aktarma doğrudan yazar: yerel geçmişe satır (yeni: `ekle`, güncelleme: fark), alarm planı
/// güncellenir, açık geçmiş sayfası yeni satırı görür.
#[test]
fn yerel_kipte_gecmis_ve_alarm() {
    let a = Hat::yeni("gecmis-a");
    let id = a.c.ekle(govde("Kuaför", Some(an("2026-11-26", "11:00"))), GirdiYolu::Elle).unwrap();
    let b = Hat::yeni("gecmis-b");
    b.zaman.ilerlet(5 * DK);
    uygula(&b, &belge(&a));
    let yarin = |saat: i64| bugun(saat, 0) + GUN;
    assert_eq!(b.alarm.kurulular(), vec![(id.clone(), yarin(10))]);
    b.c.gecmis_iste(id.clone(), None).unwrap();
    let s = b.c.gecmis(id.clone()).unwrap().unwrap();
    assert_eq!(s.satirlar.len(), 1);
    let r = &s.satirlar[0];
    assert_eq!((r.islem, r.yazar.yol, r.yazar.tur_kokeni, r.ts_ms), (IslemTuru::Ekle, KaynakYolu::Elle, TurKokeni::Insan, SIMDI + 5 * DK));
    assert!(r.alanlar.contains(&"baslik".to_string()));
    b.gozlemci.al();

    // A'da saat değişti: B'de güncellenir, alarm taşınır, açık sayfa yeni satırı başta görür.
    a.zaman.ilerlet(DK);
    a.c.duzenle(id.clone(), None, govde("Kuaför", Some(an("2026-11-26", "12:00")))).unwrap();
    uygula(&b, &belge(&a));
    assert_eq!(b.alarm.kurulular(), vec![(id.clone(), yarin(11))]);
    let d = b.gozlemci.al();
    assert_eq!(d.len(), 1);
    assert_eq!((d[0].kayitlar.clone(), d[0].gecmis.clone(), d[0].tumu), (vec![id.clone()], vec![id.clone()], false));
    let s = b.c.gecmis(id.clone()).unwrap().unwrap();
    assert_eq!(s.satirlar.len(), 2);
    assert_eq!((s.satirlar[0].islem, s.satirlar[0].alanlar.clone()), (IslemTuru::Guncelle, vec!["zaman".to_string()]));
    assert!(s.satirlar[0].rev > s.satirlar[1].rev);
    assert_eq!(gecmis_sayisi(&b, &id), 2);
    // İçe aktarılan tamamlanmış kayıt alarmı kaldırır.
    a.zaman.ilerlet(DK);
    a.c.durum_degistir(id.clone(), KayitDurumu::Tamam, None).unwrap();
    uygula(&b, &belge(&a));
    assert!(b.alarm.kurulular().is_empty());
}

/// Bağlı kipte içe aktarma kuyruktan gider (servis yazar): yeni kayıt aynı kimlikle `ekle` + durumlar, daha
/// yeni kayıt fark; eski kayıt, telefonda olmayan mezar taşı ve telefonda olmayan taslak gitmez (servis
/// taslağı onaylanmış kayıt yapardı). Kaybolanlar: kaynak izi, zamanlar.
#[test]
fn bagli_kipte_kuyruga_dokulur_sahte_pc_ile() {
    let mut p = Hat::yeni("bagli-p");
    p.pc.disaridan_ekle("k_pc1", &govde("PC1", Some(an("2026-11-27", "10:00"))), true);
    p.pc.disaridan_ekle("k_pc2", &govde("PC2", None), false);
    p.eslestir();
    assert_eq!(p.c.kip().unwrap(), CalismaKipi::Bagli);
    let d0 = p.c.disa_aktar().unwrap();
    assert_eq!((d0.kayit, d0.kip), (2, CalismaKipi::Bagli));

    // Kaynak telefon (yerel): PC1 düzenlendi, onaylandı, tamamlandı; yeni tekrar (örnek durumlu, sesli not) ve
    // yeni mezar taşı.
    let a = Hat::yeni("bagli-a");
    uygula(&a, &d0.belge);
    a.zaman.ilerlet(DK);
    a.c.duzenle("k_pc1".into(), None, govde("PC1 (A)", Some(an("2026-11-27", "10:00")))).unwrap();
    a.c.onayla("k_pc1".into()).unwrap();
    a.c.durum_degistir("k_pc1".into(), KayitDurumu::Tamam, None).unwrap();
    let spor = a.c.ekle(spor_govdesi(), GirdiYolu::SesliNot).unwrap();
    a.c.durum_degistir(spor.clone(), KayitDurumu::Tamam, Some("2026-11-24".into())).unwrap();
    let olu = a.c.ekle(govde("Ölü", None), GirdiYolu::Elle).unwrap();
    a.c.sil(olu.clone()).unwrap();
    // PC'de PC2 sonradan değişti (telefondaki daha yeni).
    p.zaman.ilerlet(5 * DK);
    let k = p.pc.disaridan_degistir("k_pc2", |k| k.baslik = "PC2 (PC)".into());
    p.pc_degisti(k);
    // Dosyada telefonda olmayan bir taslak da var (başka bir telefondan).
    let mut v = json_belge(&a);
    let mut taslak = kaydi_bul(&mut v, "k_pc1").clone();
    taslak["kayit_id"] = json!("k_baska_taslak");
    taslak["taslak"] = json!(true);
    taslak["durum"] = json!("acik");
    kayitlar_mut(&mut v).push(taslak);
    let belge_a = v.to_string();

    let on = p.c.ice_aktarma_onizlemesi(belge_a.clone()).unwrap();
    assert_eq!(on.kip, CalismaKipi::Bagli);
    assert_eq!(sayilar(&on), (1, 1, 0, 1, 0, 0));
    assert_eq!((on.gonderilmeyecek, on.taslak_gonderilmeyecek), (1, 1));
    assert_eq!(on.toplam, 5);
    // PC1: guncelle + durum + onayla; tekrar: ekle + örnek durumu; taslak gitmez.
    assert_eq!(on.kuyruga_girecek_islem, 5);

    // Bağlantı kopukken uygulanır: işlemler kuyrukta bekler, görünen kopya iyimser.
    p.kopar();
    p.gozlemci.al();
    let s = p.c.ice_aktar(belge_a.clone(), Some(on.iz.clone())).unwrap();
    assert!(s.uygulandi);
    assert_eq!(kuyruk_uzunlugu(&p), 5);
    assert_eq!(p.c.baglanti_durumu().unwrap().kuyrukta, 5);
    assert!(p.c.kayit("k_baska_taslak".into()).unwrap().is_none(), "taslak gönderilmez, telefona da yazılmaz");
    let g = p.c.kayit(spor.clone()).unwrap().unwrap();
    assert!(g.bekleyen);
    assert_eq!(g.kayit.ornekler.len(), 1);
    assert!(p.c.kayit(olu.clone()).unwrap().is_none(), "telefonda olmayan mezar taşı gönderilmez");
    let d = p.gozlemci.al();
    assert!(d.iter().any(|d| d.baglanti) && d.iter().any(|d| d.kayitlar.contains(&spor)));

    p.baglan();
    assert!(p.canli_mi());
    assert_eq!(kuyruk_uzunlugu(&p), 0);
    assert!(p.c.ret_listesi().unwrap().is_empty());
    let pc = |id: &str| p.pc.d.kayitlar[id].clone();
    let pc1 = pc("k_pc1");
    assert_eq!((pc1.baslik.as_str(), pc1.durum, pc1.taslak), ("PC1 (A)", KayitDurumu::Tamam, false));
    assert_eq!(pc("k_pc2").baslik, "PC2 (PC)", "telefondaki (PC'deki) daha yeni hal kalır");
    let pc_spor = pc(&spor);
    let a_spor = kayit(&a, &spor);
    assert_eq!((pc_spor.tekrar.clone(), pc_spor.ornekler.clone(), pc_spor.zaman.clone()), (a_spor.tekrar.clone(), a_spor.ornekler.clone(), a_spor.zaman.clone()));
    // Kaybolanlar: kaynak izi bu telefonun yazması olur (yol korunur: sesli not), zamanlar servisin.
    assert_eq!((pc_spor.kaynak.yol, pc_spor.kaynak.device_id.as_deref()), (KaynakYolu::SesliNot, Some(CIHAZ)));
    assert_ne!(pc_spor.olusturma_ms, a_spor.olusturma_ms);
    assert!(!p.pc.d.kayitlar.contains_key("k_baska_taslak"), "taslak onaylanmış kayıt olarak gitmedi");
    assert!(!p.pc.d.kayitlar.contains_key(&olu));
    // Telefonun görünen kopyası servisinkine yakınsadı; yeniden önizleme: hepsi aynı ya da atlanır.
    assert_eq!(kayit(&p, &spor), pc(&spor));
    let on = p.c.ice_aktarma_onizlemesi(belge_a).unwrap();
    assert_eq!((on.yeni, on.guncellenecek, on.kuyruga_girecek_islem, on.taslak_gonderilmeyecek), (0, 0, 0, 1));
}

/// Önizlemeden sonra telefon planı değiştirecek kadar değiştiyse eski izle hiçbir şey yazılmaz; plana
/// dokunmayan değişiklik uygulamayı engellemez.
#[test]
fn onizlemeden_sonra_degisen_telefonda_uygulanmaz() {
    let a = Hat::yeni("iz-a");
    let x = a.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    let b = Hat::yeni("iz-b");
    uygula(&b, &belge(&a));
    let z = b.c.ekle(govde("Yalnız B", None), GirdiYolu::Elle).unwrap();
    a.zaman.ilerlet(DK);
    a.c.duzenle(x.clone(), None, govde("X (A)", None)).unwrap();
    let belge_a = belge(&a);
    let on = b.c.ice_aktarma_onizlemesi(belge_a.clone()).unwrap();
    assert_eq!(sayilar(&on), (0, 1, 0, 0, 0, 0));

    // Plana dokunmayan değişiklik: iz aynı kalır.
    b.zaman.ilerlet(2 * DK);
    b.c.duzenle(z.clone(), None, govde("Yalnız B (2)", None)).unwrap();
    assert_eq!(b.c.ice_aktarma_onizlemesi(belge_a.clone()).unwrap().iz, on.iz);

    // B'de X daha yeni düzenlendi: eski izle yazılmaz, yeni plan döner.
    b.c.duzenle(x.clone(), None, govde("X (B)", None)).unwrap();
    let gecmis_once = gecmis_sayisi(&b, &x);
    b.gozlemci.al();
    let s = b.c.ice_aktar(belge_a.clone(), Some(on.iz.clone())).unwrap();
    assert!(!s.uygulandi);
    assert_eq!(sayilar(&s.plan), (0, 0, 0, 1, 0, 0));
    assert_ne!(s.plan.iz, on.iz);
    assert_eq!(kayit(&b, &x).baslik, "X (B)");
    assert_eq!(gecmis_sayisi(&b, &x), gecmis_once);
    assert!(b.gozlemci.al().is_empty());
    // Yeni izle uygulanır (telefondaki kalır).
    let s = b.c.ice_aktar(belge_a, Some(s.plan.iz)).unwrap();
    assert!(s.uygulandi);
    assert_eq!(kayit(&b, &x).baslik, "X (B)");
}

/// Hata mesajları, geçersiz kayıt konumları ve önizleme dosyanın içeriğini taşımaz.
#[test]
fn hata_mesajlarinda_icerik_sizmaz() {
    const GIZLI: &str = "Gizli Toplantı Ayşe";
    let a = Hat::yeni("mahremiyet-a");
    a.c.ekle(govde("X", Some(an("2026-11-26", "10:00"))), GirdiYolu::Elle).unwrap();
    let taban = json_belge(&a);
    let ornek = taban["kayitlar"][0].clone();
    let mut v = taban.clone();
    let mut eklenecek = Vec::new();
    for (i, f) in [
        &(|k: &mut Value| k["baslik"] = json!(GIZLI.repeat(20))) as &dyn Fn(&mut Value),
        &|k| k[GIZLI] = json!(GIZLI),
        &|k| k["kaynak"][GIZLI] = json!(1),
        &|k| k["zaman"]["tarih.gizli"] = json!(1),
        &|k| k["tur"] = json!(GIZLI),
        &|k| k["zaman"]["saat_dilimi"] = json!(format!("{}/x", GIZLI.replace(' ', "_"))),
        &|k| k["hatirlatmalar"] = json!([{"tur": GIZLI}]),
        &|k| k["revizyon"] = json!(GIZLI),
    ]
    .into_iter()
    .enumerate()
    {
        let mut k = ornek.clone();
        k["kayit_id"] = json!(format!("k_m{i}"));
        f(&mut k);
        eklenecek.push(k);
    }
    kayitlar_mut(&mut v).extend(eklenecek);
    let b = Hat::yeni("mahremiyet-b");
    let on = b.c.ice_aktarma_onizlemesi(v.to_string()).unwrap();
    assert_eq!(on.gecersiz, 8);
    let mut metinler = vec![format!("{on:?}")];
    metinler.push(format!("{:?}", b.c.ice_aktar(v.to_string(), None).unwrap()));
    metinler.push(format!("{:?}", b.ice_aktar_onayla(&v.to_string())));
    let ust = |f: fn(&mut Value)| degistir(&taban, f);
    let belgeler = vec![
        format!("{{\"bicim\": \"{GIZLI}"),
        format!("{{\"bicim\": \"eren_ajanda_yedegi\", {GIZLI}"),
        ust(|v| v["bicim"] = json!(GIZLI)),
        ust(|v| v[GIZLI] = json!(GIZLI)),
        ust(|v| v["kip"] = json!(GIZLI)),
        ust(|v| v["uygulama_surumu"] = json!(GIZLI.repeat(10))),
        ust(|v| v["bicim_surumu"] = json!(GIZLI)),
        ust(|v| v["ekler"] = json!([{"ozet": GIZLI, "bayt": 1, "mime": "image/png"}])),
        degistir(&taban, |v| v["ekler"] = json!([{"ozet": "a".repeat(64), "bayt": 1, "mime": GIZLI}])),
        degistir(&taban, |v| v["ekler"] = json!([{"ozet": "a".repeat(64), "bayt": 1, "mime": "image/png", GIZLI: 1}])),
        ust(|v| v["bolgeler"] = json!([GIZLI])),
    ];
    for metin in belgeler {
        for e in [b.c.ice_aktarma_onizlemesi(metin.clone()).unwrap_err(), b.c.ice_aktar(metin.clone(), None).unwrap_err()] {
            metinler.push(format!("{e} {e:?}"));
        }
    }
    for m in &metinler {
        for parca in ["Gizli", "Toplant", "Ayşe", "gizli"] {
            assert!(!m.contains(parca), "içerik sızdı: {m}");
        }
    }
}

/// Büyük kopya (`AJANDA_OLCUM_ADET`, varsayılan 5000): önizleme, yerel uygulama, dışa aktarma, yeniden
/// önizleme ve bağlı kipte kuyruğa dökülüş süreleri (`--nocapture` ile basılır). Süre sınırı kaba bir
/// regresyon bekçisidir (hata ayıklama derlemesinde de geçmeli).
#[test]
fn buyuk_kopyada_aktarma_sureleri() {
    let adet: usize = std::env::var("AJANDA_OLCUM_ADET").ok().and_then(|s| s.parse().ok()).unwrap_or(5_000);
    let kayitlar: Vec<Value> = (0..adet)
        .map(|i| {
            let mut k = json!({
                "kayit_id": format!("k_{i:06}"), "revizyon": 1 + i, "tur": "randevu", "baslik": format!("Kayıt {i}"),
                "hatirlatmalar": [], "ornekler": [], "durum": "acik", "taslak": false, "silindi": i % 50 == 0,
                "elle_alanlar": ["tur", "baslik", "hatirlatmalar"],
                "kaynak": {"yol": "elle", "tur_kokeni": "insan", "device_id": "c_eski"},
                "olusturma_ms": SIMDI - GUN, "guncelleme_ms": SIMDI - GUN + i as i64,
            });
            if i % 2 == 0 {
                k["zaman"] = json!({"kesinlik": "an", "tarih": format!("2026-12-{:02}", 1 + (i / 2) % 28), "saat": format!("{:02}:{:02}", 8 + i % 10, i % 60), "saat_dilimi": IST});
                k["hatirlatmalar"] = json!([{"tur": "once", "dk": 60}]);
            }
            k
        })
        .collect();
    let belge_metni = json!({
        "bicim": "eren_ajanda_yedegi", "bicim_surumu": 1, "sozlesme_surumu": AJANDA_SURUMU, "uygulama_surumu": "0.1.0",
        "olusturma_ms": SIMDI, "kip": "yerel", "kayitlar": kayitlar, "ekler": [], "bolgeler": [],
    })
    .to_string();

    let h = Hat::yeni("buyuk-aktarma");
    let t = Instant::now();
    let on = h.c.ice_aktarma_onizlemesi(belge_metni.clone()).unwrap();
    let onizleme = t.elapsed();
    assert_eq!(sayilar(&on), (adet as i32, 0, 0, 0, 0, 0));
    h.gozlemci.al();
    let t = Instant::now();
    let s = h.c.ice_aktar(belge_metni.clone(), Some(on.iz)).unwrap();
    let yerel = t.elapsed();
    assert!(s.uygulandi);
    assert!(h.gozlemci.al().iter().any(|d| d.tumu), "çok kayıtta bütün liste yenilenir");
    let tarihli_canli = (0..adet).filter(|i| i % 2 == 0 && i % 50 != 0).count();
    assert_eq!(h.alarm.kurulular().len(), tarihli_canli.min(ajanda_cekirdek::ALARM_BUTCESI));

    let t = Instant::now();
    let d = h.c.disa_aktar().unwrap();
    let disa = t.elapsed();
    assert_eq!((d.kayit as usize, d.silinmis as usize), (adet, adet.div_ceil(50)));
    let t = Instant::now();
    let on2 = h.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    let yeniden = t.elapsed();
    assert_eq!(on2.ayni as usize, adet);

    let mut p = Hat::yeni("buyuk-aktarma-bagli");
    p.eslestir();
    p.kopar();
    let on3 = p.c.ice_aktarma_onizlemesi(d.belge.clone()).unwrap();
    let t = Instant::now();
    let s = p.c.ice_aktar(d.belge.clone(), Some(on3.iz)).unwrap();
    assert!(s.uygulandi);
    let bagli = t.elapsed();
    let canli = adet - adet.div_ceil(50);
    assert_eq!((s.plan.yeni as usize, s.plan.gonderilmeyecek as usize), (canli, adet.div_ceil(50)));
    assert_eq!(kuyruk_uzunlugu(&p), canli);
    let t = Instant::now();
    p.baglan();
    let gonderim = t.elapsed();
    assert_eq!(p.pc.d.kayitlar.len(), canli);
    assert_eq!(kuyruk_uzunlugu(&p), 0);

    eprintln!(
        "aktarma ({adet} kayıt, belge {} KB): önizleme {onizleme:?}, yerel uygulama {yerel:?}, dışa aktarma {disa:?}, yeniden önizleme {yeniden:?}, bağlı kipte kuyruğa {bagli:?}, kuyruğun gönderimi {gonderim:?}",
        d.belge.len() / 1024
    );
    let sinir = std::time::Duration::from_secs(30);
    for (ad, sure) in [("önizleme", onizleme), ("yerel", yerel), ("dışa", disa), ("yeniden", yeniden), ("bağlı", bagli)] {
        assert!(sure < sinir, "{ad}: {sure:?}");
    }
}

/// Sözleşme 3: v3 alanlı kayıt (simge, bölge, konum, varış, bağlantılar, ekler; kayıt `ajanda-v3.json`
/// `asagi_uyarlama`'dan) yerel kipte içe alınır, dışa aktarılır ve boş telefona içe alınınca alan alan aynı
/// kalır (belge en yeni sürümle yazılır ve okunur; v3 alanları düşmez).
#[test]
fn v3_alanli_kayit_gidis_donuste_korunur() {
    let kayit_json = json!({
        "kayit_id": "k_market01", "revizyon": 20, "tur": "gorev", "baslik": "Süt al", "hatirlatmalar": [],
        "ornekler": [], "durum": "acik", "taslak": false, "silindi": false,
        "elle_alanlar": ["tur", "baslik", "durum", "simge", "bolge", "bolge_konumu", "varis", "baglantilar", "ekler"],
        "kaynak": {"yol": "elle", "tur_kokeni": "insan", "device_id": "cihaz_AjandaOrnek01"},
        "olusturma_ms": 1_795_000_000_000_i64, "guncelleme_ms": 1_795_000_000_000_i64,
        "simge": "market", "bolge": "Market",
        "bolge_konumu": {"enlem_e6": 41_008_240, "boylam_e6": 28_978_359, "yaricap_m": 150},
        "varis": {},
        "baglantilar": [{"url": "https://ornek.com.tr/kampanya?id=42#ust", "baslik": "Kampanya"}, {"url": "http://ornek.org"}],
        "ekler": [
            {"ek_id": "ek_01", "mime": "image/jpeg", "bayt": 182_044, "genislik": 1600, "yukseklik": 1200,
             "ozet": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "kapak": true,
             "olusturma_ms": 1_795_000_000_000_i64},
            {"ek_id": "ek_02", "mime": "image/jpeg", "bayt": 4_194_304,
             "ozet": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752", "olusturma_ms": 1_795_000_000_000_i64}
        ]
    });
    let beklenen = AjandaKaydi::oku(&kayit_json, "").unwrap();
    assert!(!beklenen.v3.bos_mu());

    let a = Hat::yeni("v3-gidis-a");
    assert_eq!(a.c.kip().unwrap(), CalismaKipi::Yerel);
    let girdi = degistir(&json_belge(&a), |v| kayitlar_mut(v).push(kayit_json.clone()));
    assert_eq!(sayilar(&uygula(&a, &girdi)), (1, 0, 0, 0, 0, 0));
    assert_eq!(kayit(&a, "k_market01").v3, beklenen.v3);

    let v = json_belge(&a);
    assert_eq!(v["sozlesme_surumu"].as_i64(), Some(AJANDA_SURUMU));
    let disa = &v["kayitlar"][0];
    for ad in ["simge", "bolge", "bolge_konumu", "varis", "baglantilar", "ekler"] {
        assert_eq!(disa[ad], kayit_json[ad], "{ad} dışa aktarmada korunur");
    }
    assert_eq!(disa["elle_alanlar"], kayit_json["elle_alanlar"]);

    let b = Hat::yeni("v3-gidis-b");
    assert_eq!(sayilar(&uygula(&b, &belge(&a))), (1, 0, 0, 0, 0, 0));
    assert_eq!(normal(&a), normal(&b));
    assert_eq!(kayit(&b, "k_market01").v3, beklenen.v3);
    assert_eq!(AjandaKaydi { revizyon: 0, ..kayit(&b, "k_market01") }, AjandaKaydi { revizyon: 0, ..beklenen });
    // Aynı belge yeniden: hiçbir şey yazılmaz.
    assert_eq!(sayilar(&b.c.ice_aktarma_onizlemesi(belge(&a)).unwrap()), (0, 0, 1, 0, 0, 0));
}

/// R6: v3 öncesi sözleşmenin (`sozlesme_surumu` 2) yedeğinde v3 alanının yokluğu "kaldırıldı" değil
/// "bilinmiyor"dur: dosyadaki daha yeni hal uygulanır ama telefondaki v3 değeri (simge) kalır. Aynı belge v3
/// sözleşmesiyle gelirse yokluk kaldırmadır.
#[test]
fn eski_sozlesme_yedeginde_v3_yoklugu_telefondaki_degeri_korur() {
    let h = Hat::yeni("aktarma-eski-sozlesme-v3");
    let x = h.c.ekle(govde("X", None), GirdiYolu::Elle).unwrap();
    h.zaman.ilerlet(10 * DK);
    let mut v = json_belge(&h);
    kaydi_bul(&mut v, &x)["simge"] = json!("is");
    kaydi_bul(&mut v, &x)["guncelleme_ms"] = json!(SIMDI + DK);
    uygula(&h, &v.to_string());
    assert_eq!(kayit(&h, &x).v3.simge.as_deref(), Some("is"));

    let mut eski = json_belge(&h);
    eski["sozlesme_surumu"] = json!(2);
    {
        let k = kaydi_bul(&mut eski, &x);
        assert!(k.as_object_mut().unwrap().remove("simge").is_some());
        k["baslik"] = json!("X (eski uygulama)");
        k["guncelleme_ms"] = json!(SIMDI + 2 * DK);
    }
    assert_eq!(sayilar(&uygula(&h, &eski.to_string())), (0, 1, 0, 0, 0, 0));
    let k = kayit(&h, &x);
    assert_eq!((k.baslik.as_str(), k.v3.simge.as_deref()), ("X (eski uygulama)", Some("is")), "telefondaki simge kaldı");

    let mut yeni = eski.clone();
    yeni["sozlesme_surumu"] = json!(AJANDA_SURUMU);
    kaydi_bul(&mut yeni, &x)["guncelleme_ms"] = json!(SIMDI + 3 * DK);
    uygula(&h, &yeni.to_string());
    assert_eq!(kayit(&h, &x).v3.simge, None, "v3 sözleşmesinde yokluk kaldırmadır");
}
