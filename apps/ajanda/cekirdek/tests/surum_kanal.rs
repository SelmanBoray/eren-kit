//! Kanalın sürüm uyumu (D5) uçtan uca: köprünün açık yüzeyi + sahte kabuklar + sürüm kümeli sahte PC
//! (`ortak`; `surumler: [2]` bugün canlıdaki v2 servisin davranışıdır: v3 `hello`'ya
//! `{v:2, type:"error", code:"protokol_uyumsuz"}` + 1002).
//!
//! - v3 servise v3 bağlantı: `pair_request` ve `hello` v3, `hello.yetenekler` (bugün boş), v3 alanları tam,
//!   artımlı ve canlı telafide gelir, kuyruğun v3 alanlı işlemi bütün gider.
//! - v2 servis: ilk denemede kısa bir ret (durum yazılmaz), v2'ye düşüp eşitlenme; düşülen sürüm bir saat
//!   (ya da süreç ölene dek) tutulur, sonra yeniden v3 denenir. Bugünkü canlı kurulum (eşleşmiş v1/v2
//!   fikstürü): veri, kuyruk ve alarmlar korunur.
//! - Çerçevesiz 1002: bir alt sürüme düşülür; en alttaysa yön bilinmez.
//! - Sürüm sabitlenmeden gelen başka sürümlü ret (`zaman_asimi`) kodun kendisidir, geri düşüş değil.
//! - v2 bağlantıda v3 alanlı kuyruk işlemi: v2 kısmı gider, v3 kalanı ret listesine (içeriğiyle) düşer,
//!   kuyruk tıkanmaz, sıra korunur.
//! - v2 döneminin kopyası (v3 alanları süzülmüş temel) aynı revizyonlu v3 alanlı PC kaydıyla karşılaşınca
//!   (v3'teki ilk bağlantının tam telafisi: yedekten dönme denetimi; yerel kipten bağlanma: fark hesabı)
//!   PC'deki v3 alanları silinmez. Birleştirme önizlemesi (D4) henüz yok: sınanacak yolu yoktur.

mod ortak;

use std::sync::Arc;

use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{BaglantiAsamasi, CalismaKipi, SurumUyusmazligi, YenidenKurmaNedeni};
use ajanda_cekirdek::model::{
    AjandaBolgeKonumu, AjandaDegisiklik, AjandaIslem, AjandaKanalHatasi, AjandaKaydi, AjandaVaris, Alan, GirdiYolu,
    IslemTuru, KuyrukRetNedeni, Surum, SurumBolumu, V3Alanlari, V3Degisikligi,
};
use ortak::*;

const V1_DEPO: &str = include_str!("veri/v1_depo.sql");
/// Fikstürdeki kuyruk satırı (`yukseltme.rs` ile aynı).
const KUYRUK_ISLEMI: &str = "i_AAECAwQFBgQICQoLDA0ODA";

const KONUM: AjandaBolgeKonumu = AjandaBolgeKonumu { enlem_e6: 41_008_240, boylam_e6: 28_978_359, yaricap_m: 150 };

fn market_v3() -> V3Alanlari {
    V3Alanlari { simge: Some("alisveris".into()), bolge: Some("Market".into()), bolge_konumu: Some(KONUM), ..Default::default() }
}

fn depo(h: &Hat) -> Depo {
    Depo::ac(&h.yol).unwrap()
}

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    h.c.kayit(id.into()).unwrap().expect("kayıt").kayit
}

fn durum(h: &Hat) -> (BaglantiAsamasi, Option<AjandaKanalHatasi>, Option<SurumUyusmazligi>) {
    let d = h.c.baglanti_durumu().unwrap();
    (d.asama, d.son_hata, d.surum_uyusmazligi)
}

/// Kuyruğa doğrudan satır (v3 alanlı işlemi bugün Kotlin formu üretemez; v3 arayüzü ya da eski kuyruk gibi).
fn kuyruga_yaz(h: &Hat, islem_id: &str, islem: &AjandaIslem) {
    rusqlite::Connection::open(&h.yol)
        .unwrap()
        .execute(
            "INSERT INTO kuyruk (islem_id, kayit_id, islem_json, olusturma_ms) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![islem_id, islem.kayit_id(), islem.json().to_string(), SIMDI],
        )
        .unwrap();
}

fn guncelle(kayit_id: &str, degisiklik: AjandaDegisiklik) -> AjandaIslem {
    AjandaIslem::Guncelle { kayit_id: kayit_id.into(), temel_revizyon: 1, degisiklik }
}

/// PC'yi fikstürün sunucu kopyasıyla aynı hale getirir (`yukseltme.rs`'teki gibi).
fn pc_fikstur_gibi(h: &mut Hat) {
    for k in depo(h).sunucu_kayitlari().unwrap() {
        h.pc.d.rev = h.pc.d.rev.max(k.revizyon);
        h.pc.d.gecmis_izi.insert(k.revizyon, (k.kayit_id.clone(), k.guncelleme_ms));
        h.pc.d.kayitlar.insert(k.kayit_id.clone(), k);
    }
    h.pc.cihaz_public_key = Some(ajanda_cekirdek::model::kanonik::base64_yaz(&[4; 65]));
}

#[test]
fn islem_surume_bolunur() {
    let ekle = AjandaIslem::Ekle { kayit_id: "k1".into(), govde: govde("A", None), v3: market_v3(), girdi_yolu: GirdiYolu::Elle };
    assert_eq!(ekle.surume_bol(Surum::V3), SurumBolumu { gidecek: Some(ekle.clone()), kalan: None });
    let b = ekle.surume_bol(Surum::V2);
    let AjandaIslem::Ekle { v3, .. } = b.gidecek.as_ref().unwrap() else { panic!("ekle") };
    assert!(v3.bos_mu());
    let beklenen = V3Degisikligi {
        simge: Alan::Deger("alisveris".into()),
        bolge: Alan::Deger("Market".into()),
        bolge_konumu: Alan::Deger(KONUM),
        ..Default::default()
    };
    assert_eq!(b.kalan, Some(guncelle("k1", AjandaDegisiklik { v3: beklenen, ..Default::default() })));
    // Karma değişiklik: v2 kısmı gider, v3 kalanı ayrı; yalnız v3: gidecek yok; v3'süz: olduğu gibi.
    let v3 = V3Degisikligi { simge: Alan::Kaldir, ..Default::default() };
    let karma = guncelle("k1", AjandaDegisiklik { baslik: Some("B".into()), v3: v3.clone(), ..Default::default() });
    let b = karma.surume_bol(Surum::V2);
    assert_eq!(b.gidecek, Some(guncelle("k1", AjandaDegisiklik { baslik: Some("B".into()), ..Default::default() })));
    assert_eq!(b.kalan, Some(guncelle("k1", AjandaDegisiklik { v3: v3.clone(), ..Default::default() })));
    let yalniz = guncelle("k1", AjandaDegisiklik { v3, ..Default::default() });
    assert_eq!(yalniz.surume_bol(Surum::V2).gidecek, None);
    let sil = AjandaIslem::Sil { kayit_id: "k1".into() };
    assert_eq!(sil.surume_bol(Surum::V2), SurumBolumu { gidecek: Some(sil.clone()), kalan: None });
    // Kalanlar kendi başına geçerli işlemdir (kuyruk JSON'u en yeni şemadan geçer).
    for k in [ekle.surume_bol(Surum::V2).kalan.unwrap(), karma.surume_bol(Surum::V2).kalan.unwrap()] {
        assert_eq!(AjandaIslem::oku(&k.json(), "").unwrap(), k);
    }
}

#[test]
fn v3_servise_v3_baglanir_v3_alanlari_iki_yonde_tasinir() {
    let mut h = Hat::yeni("surum-v3");
    h.pc.disaridan_v3_ekle("k_market", &govde("Süt al", None), market_v3());
    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar, vec![("pair_request", 3), ("hello", 3)], "pair_request ve hello aynı sürümde");
    assert_eq!(h.pc.hello_yetenekleri, vec![Some(vec![])], "v3 hello yetenek listesini yollar (bugün boş)");
    assert_eq!(h.pc.surum_retleri, 0);
    assert_eq!(h.pc.son_welcome_tam, Some(true));
    assert_eq!(kayit(&h, "k_market").v3, market_v3(), "tam telafi v3 alanlarını getirir");

    // Canlı kayıt v3 alanıyla gelir.
    let k = h.pc.disaridan_degistir("k_market", |k| k.v3.simge = Some("market".into()));
    h.pc_degisti(k);
    assert_eq!(kayit(&h, "k_market").v3.simge.as_deref(), Some("market"));

    // Artımlı telafi v3 alanını getirir.
    h.kopar();
    h.pc.disaridan_degistir("k_market", |k| k.v3.varis = Some(AjandaVaris { pencere: None, cikista: true }));
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(false));
    assert_eq!(kayit(&h, "k_market"), h.pc.d.kayitlar["k_market"]);

    // Kuyruğun v3 alanlı işlemi v3 bağlantıda bütün gider.
    h.kopar();
    let v3 = V3Degisikligi { simge: Alan::Deger("ev".into()), ..Default::default() };
    kuyruga_yaz(&h, "i_karma", &guncelle("k_market", AjandaDegisiklik { baslik: Some("Süt ve ekmek".into()), v3, ..Default::default() }));
    h.baglan();
    assert_eq!(h.pc.uygulanan, vec!["i_karma".to_string()]);
    let pc = &h.pc.d.kayitlar["k_market"];
    assert_eq!((pc.baslik.as_str(), pc.v3.simge.as_deref(), pc.v3.bolge.as_deref()), ("Süt ve ekmek", Some("ev"), Some("Market")));
    assert_eq!(&kayit(&h, "k_market"), pc);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0));
}

/// Bugünkü canlı kurulum: eşleşmiş telefon (v1 döneminin fikstürü, kuyrukta bir çevrimdışı ekleme, kurulu
/// alarmlar) ve yalnız v2 konuşan servis. İlk deneme kısa bir retle biter: hiçbir şey değişmez, durum
/// uyuşmazlık göstermez (kabuk sıradan kopma gibi kısa beklemeyle yeniden bağlanır). İkinci bağlantı v2'de
/// eskisi gibi eşitlenir: artımlı, kuyruk aynı `islem_id` ile gider.
#[test]
fn bugunku_canli_kurulum_v2_serviste_kisa_retten_sonra_v2de_esitlenir() {
    let mut h = Hat::sql_depoyla("surum-canli", V1_DEPO);
    h.c.alarmlari_yeniden_kur(YenidenKurmaNedeni::PaketGuncellendi).unwrap();
    pc_fikstur_gibi(&mut h);
    h.pc.surum_kumesi(&[2]);
    let alarmlar = h.alarm.kurulular();
    let gorunen = depo(&h).gorunen_hepsi().unwrap();

    h.baglan();
    assert_eq!(durum(&h), (BaglantiAsamasi::Kopuk, None, None), "kısa ret: uyuşmazlık değil");
    assert_eq!((h.pc.acilislar.clone(), h.pc.surum_retleri), (vec![("hello", 3)], 1));
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (1, 0), "kuyruk durur, deneme sayılmaz");
    assert_eq!((h.alarm.kurulular(), depo(&h).gorunen_hepsi().unwrap()), (alarmlar.clone(), gorunen));
    assert!(h.pc.uygulanan.is_empty());

    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar, vec![("hello", 3), ("hello", 2)]);
    assert_eq!(h.pc.son_welcome_tam, Some(false), "v2'de eskisi gibi artımlı");
    assert_eq!(h.pc.uygulanan, vec![KUYRUK_ISLEMI.to_string()]);
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde, d.son_hata, d.surum_uyusmazligi), (0, 0, None, None));
    assert_eq!(h.alarm.kurulular(), alarmlar, "alarm planı eşitlemeden sonra da aynı");

    // Düşülen sürüm tutulur: bir saat içindeki bağlantılar doğrudan v2 (ret yok).
    h.kopar();
    h.zaman.ilerlet(SAAT - 1);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!((h.pc.acilislar.last(), h.pc.surum_retleri), (Some(&("hello", 2)), 1));
    // Bir saat dolunca yeniden v3 denenir (servis güncellenmiş olabilir): bir ret, sonra yine v2.
    h.kopar();
    h.zaman.ilerlet(1);
    h.baglan();
    assert_eq!((h.pc.acilislar.last(), h.pc.surum_retleri), (Some(&("hello", 3)), 2));
    h.baglan();
    assert!(h.canli_mi());
    // Süreç yeniden başlayınca da yeniden v3 denenir.
    h.sureci_oldur_ve_ac();
    h.baglan();
    assert_eq!((h.pc.acilislar.last(), h.pc.surum_retleri), (Some(&("hello", 3)), 3));
    h.baglan();
    assert!(h.canli_mi());
    // Servis güncellendi: v3'te bağlanır; kopya v2 bağlantıyla dolduğundan ilk v3 bağlantısı tam telafidir.
    h.kopar();
    h.pc.surum_kumesi(&[2, 3]);
    h.zaman.ilerlet(SAAT);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!((h.pc.acilislar.last(), h.pc.son_welcome_tam), (Some(&("hello", 3)), Some(true)));
    assert_eq!(h.pc.uygulanan, vec![KUYRUK_ISLEMI.to_string()], "hiçbir işlem yinelenmedi");
}

/// Eşleştirme sırasında v2 servis: `pair_request` v3 reddedilir (kod tüketilmez), ikinci bağlantıda
/// `pair_request` ve `hello` v2'dir.
#[test]
fn eslestirmede_v2_servise_duser() {
    let mut h = Hat::yeni("surum-eslestirme");
    h.pc.surum_kumesi(&[2]);
    h.eslestir();
    assert_eq!(durum(&h), (BaglantiAsamasi::Kopuk, None, None));
    assert!(matches!(h.c.eslesme_durumu().unwrap(), ajanda_cekirdek::kopru::tipler::EslesmeDurumu::Bekliyor { .. }));
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar, vec![("pair_request", 3), ("pair_request", 2), ("hello", 2)]);
    assert_eq!(h.pc.hello_yetenekleri, vec![None], "v2 hello yetenek taşımaz");
}

/// Ret çerçevesi gelmeden yalnız kapanış 1002: kümede denenenden küçük en büyük sürüme düşülür; en alt
/// sürümde de olursa yön bilinmez (yeniden bağlanma geri çekilir).
#[test]
fn cercevesiz_1002_alt_surume_duser_en_altta_bilinmiyor() {
    let mut h = Hat::yeni("surum-1002");
    h.eslestir();
    h.kopar();
    h.pc.surum_kumesi(&[2]);
    h.pc.cercevesiz_ret = true;
    h.baglan();
    assert_eq!(durum(&h), (BaglantiAsamasi::Kopuk, None, None));
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(&h.pc.acilislar[2..], &[("hello", 3), ("hello", 2)]);
    // v2 bağlantı da çerçevesiz 1002 alırsa: alt sürüm yok.
    h.kopar();
    let t = Arc::new(SahteTasima::default());
    let nesil = h.c.baglanti_acildi(t.clone()).unwrap();
    assert!(t.giden.lock().unwrap()[0].contains(r#""v":2"#));
    h.c.baglanti_kapandi(nesil, Some(1002)).unwrap();
    assert_eq!(durum(&h), (BaglantiAsamasi::Kopuk, Some(AjandaKanalHatasi::ProtokolUyumsuz), Some(SurumUyusmazligi::Bilinmiyor)));
}

/// Bir bağlantı açar, verilen çerçeveyi verir, kapanışı bildirir. Döner: açılış çerçevesinin `v`'si.
fn tek_cerceve(h: &mut Hat, cerceve: &str, kod: Option<i32>) -> i64 {
    let t = Arc::new(SahteTasima::default());
    let nesil = h.c.baglanti_acildi(t.clone()).unwrap();
    let hello: serde_json::Value = serde_json::from_str(&t.giden.lock().unwrap()[0]).unwrap();
    h.c.cerceve_geldi(nesil, cerceve.into()).unwrap();
    assert!(t.kapatildi.lock().unwrap().is_some(), "ret bağlantıyı kapatır: {cerceve}");
    h.c.baglanti_kapandi(nesil, kod).unwrap();
    hello["v"].as_i64().unwrap()
}

/// Sürüm sabitlenmeden gelen, başka sürümlü öteki ret (servis `hello`'yu almadan süre doldu: ret kümenin
/// en küçük sürümüyle) kodun kendisidir, geri düşüş değildir. Bilinmeyen kod `gecersiz_mesaj`'dır; bağlantının
/// kendi sürümüyle gelen `protokol_uyumsuz` yön bilinmez.
#[test]
fn surum_sabitlenmeden_gelen_zaman_asimi_kodun_kendisidir() {
    let mut h = Hat::yeni("surum-zaman-asimi");
    h.eslestir();
    h.kopar();
    assert_eq!(tek_cerceve(&mut h, r#"{"v":2,"type":"error","code":"zaman_asimi"}"#, None), 3);
    assert_eq!(durum(&h), (BaglantiAsamasi::Kopuk, Some(AjandaKanalHatasi::ZamanAsimi), None));
    assert_eq!(tek_cerceve(&mut h, r#"{"v":2,"type":"error","code":"yeni_bir_kod","detail":"x"}"#, None), 3, "geri düşülmedi");
    assert_eq!(durum(&h), (BaglantiAsamasi::Kopuk, Some(AjandaKanalHatasi::GecersizMesaj), None));
    assert_eq!(tek_cerceve(&mut h, r#"{"v":3,"type":"error","code":"protokol_uyumsuz"}"#, Some(1002)), 3);
    assert_eq!(durum(&h), (BaglantiAsamasi::Kopuk, Some(AjandaKanalHatasi::ProtokolUyumsuz), Some(SurumUyusmazligi::Bilinmiyor)));
    // Dondurulmuş zarfın `detail`'i geri düşüşü bozmaz.
    assert_eq!(tek_cerceve(&mut h, r#"{"v":2,"type":"error","code":"protokol_uyumsuz","detail":"eski"}"#, Some(1002)), 3);
    assert_eq!(durum(&h), (BaglantiAsamasi::Kopuk, None, None));
    // Hepsinden sonra servis v3'tü: bir saat sonra v3'te bağlanılır.
    h.zaman.ilerlet(SAAT);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar.last(), Some(&("hello", 3)));
}

/// Servis v2'ye geri alındı (ya da güncellenmedi) ve kuyrukta v3 alanlı işlemler var: v2 kısmı gider (satır
/// aynı `islem_id` ve sırayla), v3 kalanı ret listesine içeriğiyle düşer, yalnız v3 alanı değiştiren işlem
/// bütünüyle ret listesine; arkasındakiler tıkanmaz.
#[test]
fn v2_baglantida_v3_alanli_kuyruk_islemi_bolunur_kalani_ret_listesine() {
    let mut h = Hat::yeni("surum-v2-kuyruk");
    h.eslestir();
    let a = h.c.ekle(govde("A", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    assert!(h.pc.d.kayitlar.contains_key(&a));
    h.kopar();
    let simge = V3Degisikligi { simge: Alan::Deger("ev".into()), ..Default::default() };
    let bolge = V3Degisikligi { bolge: Alan::Deger("Ev".into()), ..Default::default() };
    kuyruga_yaz(&h, "i_karma", &guncelle(&a, AjandaDegisiklik { baslik: Some("A2".into()), v3: simge, ..Default::default() }));
    kuyruga_yaz(&h, "i_yalniz_v3", &guncelle(&a, AjandaDegisiklik { v3: bolge, ..Default::default() }));
    let ekle = AjandaIslem::Ekle {
        kayit_id: "k_yeni".into(),
        govde: govde("Yeni", None),
        v3: V3Alanlari { simge: Some("is".into()), ..Default::default() },
        girdi_yolu: GirdiYolu::Elle,
    };
    kuyruga_yaz(&h, "i_ekle", &ekle);
    kuyruga_yaz(&h, "i_duz", &guncelle(&a, AjandaDegisiklik { aciklama: Alan::Deger("not".into()), ..Default::default() }));
    h.sureci_oldur_ve_ac();
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 4);

    h.pc.surum_kumesi(&[2]);
    h.baglan();
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar.last(), Some(&("hello", 2)));
    // Sırası ve kimliğiyle v2 kısımları gitti; yalnız v3 olan gitmedi.
    let uygulanan: Vec<&str> = h.pc.uygulanan.iter().map(String::as_str).collect();
    assert_eq!(uygulanan[uygulanan.len() - 3..], ["i_karma", "i_ekle", "i_duz"]);
    let pc_a = &h.pc.d.kayitlar[&a];
    assert_eq!((pc_a.baslik.as_str(), pc_a.aciklama.as_deref()), ("A2", Some("not")));
    assert!(pc_a.v3.bos_mu() && h.pc.d.kayitlar["k_yeni"].v3.bos_mu(), "v2 servise v3 alanı gitmedi");
    assert_eq!(h.pc.d.kayitlar["k_yeni"].baslik, "Yeni");
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde, d.son_hata), (0, 3, None), "kuyruk tıkanmadı, kullanıcıya üç ret görünür");

    // Ret listesi: hepsi `gecersiz_islem`, `guncelle`; v3 içerikleri satırların işleminde duruyor.
    let ret = h.c.ret_listesi().unwrap();
    assert!(ret.iter().all(|r| r.neden == KuyrukRetNedeni::GecersizIslem && r.islem == IslemTuru::Guncelle), "{ret:?}");
    let satirlar = depo(&h).ret_listesi().unwrap();
    let islem = |kayit_id: &str, alan: &str| -> AjandaIslem {
        let s = satirlar.iter().find(|s| s.kayit_id == kayit_id && s.islem_json.contains(alan)).unwrap_or_else(|| panic!("{alan}"));
        AjandaIslem::oku(&serde_json::from_str(&s.islem_json).unwrap(), "").unwrap()
    };
    let simge_kalan = islem(&a, "\"simge\"");
    assert_eq!(simge_kalan, guncelle(&a, AjandaDegisiklik { v3: V3Degisikligi { simge: Alan::Deger("ev".into()), ..Default::default() }, ..Default::default() }));
    assert!(satirlar.iter().any(|s| s.islem_id == "i_yalniz_v3" && s.islem_json.contains("\"bolge\":\"Ev\"")), "yalnız v3 olan bütünüyle");
    let ekle_kalan = islem("k_yeni", "\"simge\"");
    assert_eq!(ekle_kalan, guncelle("k_yeni", AjandaDegisiklik { v3: V3Degisikligi { simge: Alan::Deger("is".into()), ..Default::default() }, ..Default::default() }));
    // Düzeltme formu özgün işlemin istediği hal: başlık görünür.
    assert!(ret.iter().any(|r| r.kayit_id == "k_yeni" && r.govde.as_ref().is_some_and(|g| g.baslik == "Yeni")));
    // Görünen kopya PC ile aynı (v3 kalanları kuyrukta değil, ret listesinde).
    assert_eq!(&kayit(&h, &a), pc_a);
    assert_eq!(&kayit(&h, "k_yeni"), &h.pc.d.kayitlar["k_yeni"]);
}

/// v2 döneminin kopyası: servis v3 alanlı kaydı tutuyor ama telefon v2'de bağlı (v3 alanları süzülerek gelir;
/// eski uygulamanın durumu). Telefon bu dönemde kaydın v2 alanını değiştirir. Sonra v3'te bağlanınca:
/// kopya v2'yle dolduğu için tam telafi istenir (aynı depo: yedekten dönme denetimi çalışır), aynı revizyonlu
/// kayıt v2 temelinden farklı görünse de hiçbir işlem gitmez, PC'deki v3 alanları kalır ve telefona gelir.
#[test]
fn v2_donemi_temeli_ayni_revizyonlu_v3_kaydi_pcden_silmez_tam_telafide() {
    let mut h = Hat::yeni("surum-v2-temel");
    h.pc.disaridan_v3_ekle("k_market", &govde("Süt al", None), market_v3());
    h.pc.disaridan_v3_ekle("k_eczane", &govde("İlaç", None), V3Alanlari { simge: Some("ilac".into()), ..Default::default() });
    h.pc.surum_kumesi(&[2]);
    h.eslestir();
    h.baglan();
    assert!(h.canli_mi());
    assert!(kayit(&h, "k_market").v3.bos_mu(), "v2 bağlantıda v3 alanları süzülür");
    assert!(depo(&h).sunucu_kayitlari().unwrap().iter().all(|k| k.v3.bos_mu()), "PC temeli v2 dönemi");
    h.c.duzenle("k_market".into(), None, govde("Süt ve yumurta al", None)).unwrap();
    h.pompala();
    assert_eq!(h.pc.d.kayitlar["k_market"].v3, market_v3(), "v2 guncelle v3 alanlarına dokunmaz");
    let uygulanan = h.pc.uygulanan.len();

    h.kopar();
    h.pc.surum_kumesi(&[2, 3]);
    h.zaman.ilerlet(SAAT);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!((h.pc.acilislar.last(), h.pc.son_welcome_tam), (Some(&("hello", 3)), Some(true)));
    assert_eq!(h.pc.uygulanan.len(), uygulanan, "aynı revizyonlu kayda fark gitmedi");
    assert_eq!(h.pc.d.kayitlar["k_market"].v3, market_v3());
    assert_eq!(h.pc.d.kayitlar["k_eczane"].v3.simge.as_deref(), Some("ilac"));
    for id in ["k_market", "k_eczane"] {
        assert_eq!(&kayit(&h, id), &h.pc.d.kayitlar[id], "{id}: v3 alanları telefona geldi");
    }
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0));
    // Kopya artık v3'le dolu: sonraki bağlantı artımlı.
    h.kopar();
    h.baglan();
    assert_eq!(h.pc.son_welcome_tam, Some(false));
}

/// Aynı v2 dönemi temeli, bu kez koparma ve yerel kipten bağlanma (fark hesabı): yerel değişiklik temele göre
/// fark olarak gider; temelde olmayan v3 alanları fark sayılıp PC'den silinmez.
#[test]
fn v2_donemi_temeli_ayni_revizyonlu_v3_kaydi_pcden_silmez_yerelden_baglanmada() {
    let mut h = Hat::yeni("surum-v2-yerel");
    h.pc.disaridan_v3_ekle("k_market", &govde("Süt al", None), market_v3());
    h.pc.disaridan_v3_ekle("k_eczane", &govde("İlaç", None), V3Alanlari { simge: Some("ilac".into()), ..Default::default() });
    h.pc.surum_kumesi(&[2]);
    h.eslestir();
    h.baglan();
    assert!(h.canli_mi());
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    h.c.duzenle("k_market".into(), None, govde("Süt ve yumurta al", None)).unwrap();
    let uygulanan = h.pc.uygulanan.len();

    h.pc.surum_kumesi(&[2, 3]);
    h.zaman.ilerlet(SAAT);
    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.pc.acilislar.last(), Some(&("hello", 3)));
    assert_eq!(h.pc.uygulanan.len(), uygulanan + 1, "yalnız yerel başlık değişikliği gitti");
    let m = &h.pc.d.kayitlar["k_market"];
    assert_eq!((m.baslik.as_str(), &m.v3), ("Süt ve yumurta al", &market_v3()));
    assert_eq!(h.pc.d.kayitlar["k_eczane"].v3.simge.as_deref(), Some("ilac"));
    for id in ["k_market", "k_eczane"] {
        assert_eq!(&kayit(&h, id), &h.pc.d.kayitlar[id], "{id}");
    }
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
}
