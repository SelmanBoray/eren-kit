//! Eski (v2) servise bağlıyken v3 alanlı değişikliklerin ertelenmesi uçtan uca (`motor/kanal.rs`
//! "Erteleme"): köprünün açık yüzeyi + sahte kabuklar + sürüm kümeli sahte PC (`ortak`).
//!
//! - v2 bağlantıda v3 alanlı ekleme ve güncelleme: v2 kısmı yerinde gider, v3 kalanı kuyrukta ertelenir
//!   (ret listesine gitmez), kayıt v3 alanlarıyla görünür; servis v3'e geçince ertelenenler sırayla gider.
//! - Sıra ve çakışma: v2 kısmı sonra gelen işlemin ardına geçmez; aynı v3 alanına sonradan dokunan
//!   değişiklik kazanır; araya giren v2 işlemleri ertelenenleri bekletmez.
//! - Ertelenen satırın denemesi artmaz, kopmada sayılmaz; tam telafi onu atmaz.
//! - Kuyruk boşalması: `kuyrukta` bütünüyle ertelenmişleri saymaz (Kotlin beklemeleri biter).
//! - Koparma: ertelenen değerler yerel gerçekte kalır.
//! - Yerel kip: erteleme yok.
//! - Köprü: `baglanti_yetenekleri` ve kayıt başına `ertelenen`.

mod ortak;

use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kopru::tipler::{BaglantiKipi, BaglantiYetenekleri, CalismaKipi, KayitGorunumu, ListeSorgusu, Sekme};
use ajanda_cekirdek::model::{AjandaDegisiklik, AjandaIslem, AjandaKaydi, Alan, GirdiYolu, V3Alanlari, V3Degisikligi};
use ortak::*;

fn depo(h: &Hat) -> Depo {
    Depo::ac(&h.yol).unwrap()
}

fn gorunum(h: &Hat, id: &str) -> KayitGorunumu {
    h.c.kayit(id.into()).unwrap().expect("kayıt")
}

fn kayit(h: &Hat, id: &str) -> AjandaKaydi {
    gorunum(h, id).kayit
}

fn yetenek(h: &Hat) -> BaglantiYetenekleri {
    h.c.baglanti_yetenekleri().unwrap()
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

fn simge(s: &str) -> V3Degisikligi {
    V3Degisikligi { simge: Alan::Deger(s.into()), ..Default::default() }
}

fn yalniz_v3(kayit_id: &str, v3: V3Degisikligi) -> AjandaIslem {
    guncelle(kayit_id, AjandaDegisiklik { v3, ..Default::default() })
}

/// v3 serviste eşleşir, bir kayıt ekler, kopar; servis v2'ye geri alınır. Döner: kaydın kimliği.
fn v2ye_inen_kurulum(h: &mut Hat) -> String {
    h.eslestir();
    let a = h.c.ekle(govde("A", None), GirdiYolu::Elle).unwrap();
    h.pompala();
    assert!(h.pc.d.kayitlar.contains_key(&a));
    h.kopar();
    h.pc.surum_kumesi(&[2]);
    a
}

/// Süreç yeniden açılır (doğrudan yazılan satırlar okunsun) ve v2'ye düşülerek bağlanılır.
fn v2de_baglan(h: &mut Hat) {
    h.sureci_oldur_ve_ac();
    h.baglan();
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar.last(), Some(&("hello", 2)));
}

/// Servis güncellendi: bir saat sonra (ya da yeni süreçte) v3'te bağlanılır.
fn v3e_gec(h: &mut Hat) {
    h.kopar();
    h.pc.surum_kumesi(&[2, 3]);
    h.zaman.ilerlet(SAAT);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.acilislar.last(), Some(&("hello", 3)));
}

/// v2 serviste v3 alanlı güncelleme ve ekleme: v2 kısmı yerinde gider, v3 kalanı ertelenir (ret listesi
/// boş), kayıt v3 alanlarıyla görünür, kuyruk "boş" görünür (ertelenenler ayrı sayılır). Servis v3'e
/// geçince ertelenenler sırayla, bir kez gider; kayıt PC ile aynı olur.
#[test]
fn v2_serviste_v3_degisiklikleri_ertelenir_v3e_gecince_gider() {
    let mut h = Hat::yeni("erteleme-temel");
    let a = v2ye_inen_kurulum(&mut h);
    let bolge = V3Degisikligi { bolge: Alan::Deger("Ev".into()), ..Default::default() };
    kuyruga_yaz(&h, "i_karma", &guncelle(&a, AjandaDegisiklik { baslik: Some("A2".into()), v3: simge("ev"), ..Default::default() }));
    kuyruga_yaz(&h, "i_yalniz_v3", &yalniz_v3(&a, bolge));
    let ekle = AjandaIslem::Ekle {
        kayit_id: "k_yeni".into(),
        govde: govde("Yeni", Some(an("2026-11-25", "18:00"))),
        v3: V3Alanlari { simge: Some("is".into()), ..Default::default() },
        girdi_yolu: GirdiYolu::Elle,
    };
    kuyruga_yaz(&h, "i_ekle", &ekle);
    kuyruga_yaz(&h, "i_duz", &guncelle(&a, AjandaDegisiklik { aciklama: Alan::Deger("not".into()), ..Default::default() }));
    h.sureci_oldur_ve_ac();
    // Servis sürümü henüz v3 biliniyor: hiçbiri ertelenmiş değil.
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 4);
    assert_eq!(yetenek(&h).ertelenen, 0);

    v2de_baglan(&mut h);
    let uygulanan = h.pc.uygulanan.clone();
    assert_eq!(uygulanan[uygulanan.len() - 3..], ["i_karma", "i_ekle", "i_duz"], "v2 kısımları sırasıyla, aynı kimlikle");
    let pc_a = h.pc.d.kayitlar[&a].clone();
    assert_eq!((pc_a.baslik.as_str(), pc_a.aciklama.as_deref()), ("A2", Some("not")));
    assert!(pc_a.v3.bos_mu() && h.pc.d.kayitlar["k_yeni"].v3.bos_mu(), "v2 servise v3 alanı gitmedi");
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde, d.son_hata), (0, 0, None), "ret yok; kuyruk boşalmış görünür");
    assert_eq!(
        yetenek(&h),
        BaglantiYetenekleri { kip: BaglantiKipi::Bagli, surum: Some(2), v3_alanlari: false, yetenekler: vec![], ertelenen: 3 }
    );

    // Kayıt v3 alanlarıyla görünür (iyimser); işaret: ertelenen, gönderilmeyi beklemiyor.
    let g = gorunum(&h, &a);
    assert_eq!((g.kayit.baslik.as_str(), g.kayit.v3.simge.as_deref(), g.kayit.v3.bolge.as_deref()), ("A2", Some("ev"), Some("Ev")));
    assert_eq!((g.bekleyen, g.ertelenen), (false, true));
    let y = gorunum(&h, "k_yeni");
    assert_eq!((y.kayit.v3.simge.as_deref(), y.bekleyen, y.ertelenen), (Some("is"), false, true));
    let liste = h.c.liste(ListeSorgusu { sekme: Sekme::Tarihli, kapalilar_dahil: false }).unwrap();
    assert!(liste.iter().any(|g| g.kayit.kayit_id == "k_yeni" && g.ertelenen && !g.bekleyen), "liste de işaretli");
    let gun = h.c.takvim_gunu("2026-11-25".into(), false).unwrap();
    assert!(gun.iter().any(|o| o.gorunum.kayit.kayit_id == "k_yeni" && o.gorunum.ertelenen), "takvim de işaretli");

    // Ertelenenler kuyrukta, özgün sırayla; hiç yollanmadı, denemesiz.
    let kuyruk = depo(&h).kuyruk().unwrap();
    assert_eq!(kuyruk.len(), 3, "{kuyruk:?}");
    assert!(kuyruk.iter().all(|s| s.deneme == 0 && !s.yollandi && s.bekledigi_rev.is_none()));
    assert_eq!(kuyruk.iter().map(|s| s.kayit_id.as_str()).collect::<Vec<_>>(), [a.as_str(), a.as_str(), "k_yeni"]);
    assert!(kuyruk[0].islem_json.contains("\"simge\":\"ev\"") && kuyruk[1].islem_id == "i_yalniz_v3");

    // Kopmalar ve yeniden bağlanmalar v2'de: ertelenenler gitmez, denemeleri artmaz.
    for _ in 0..3 {
        h.kopar();
        h.baglan();
        assert!(h.canli_mi());
    }
    assert!(depo(&h).kuyruk().unwrap().iter().all(|s| s.deneme == 0));
    assert_eq!(h.pc.uygulanan.len(), uygulanan.len());
    // Bağlantı yokken bilinen servis sürümü v2: v3 alanları gitmez, sayı durur.
    h.kopar();
    let y = yetenek(&h);
    assert_eq!((y.kip, y.surum, y.v3_alanlari, y.ertelenen), (BaglantiKipi::BagliDegil, None, false, 3));

    // Servis güncellendi: ilk v3 bağlantısı tam telafidir; ertelenenler sırayla gider.
    h.gozlemci.al();
    let once = h.pc.uygulanan.len();
    h.pc.surum_kumesi(&[2, 3]);
    h.zaman.ilerlet(SAAT);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!((h.pc.acilislar.last(), h.pc.son_welcome_tam), (Some(&("hello", 3)), Some(true)));
    let giden: Vec<String> = h.pc.uygulanan[once..].to_vec();
    assert_eq!(giden, kuyruk.iter().map(|s| s.islem_id.clone()).collect::<Vec<_>>(), "sırayla, birer kez");
    let pc_a = &h.pc.d.kayitlar[&a];
    assert_eq!((pc_a.baslik.as_str(), pc_a.v3.simge.as_deref(), pc_a.v3.bolge.as_deref()), ("A2", Some("ev"), Some("Ev")));
    assert_eq!(h.pc.d.kayitlar["k_yeni"].v3.simge.as_deref(), Some("is"));
    assert_eq!(&kayit(&h, &a), pc_a);
    assert_eq!(&kayit(&h, "k_yeni"), &h.pc.d.kayitlar["k_yeni"]);
    let g = gorunum(&h, &a);
    assert_eq!((g.bekleyen, g.ertelenen), (false, false));
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0));
    assert_eq!(
        yetenek(&h),
        BaglantiYetenekleri { kip: BaglantiKipi::Bagli, surum: Some(3), v3_alanlari: true, yetenekler: vec![], ertelenen: 0 }
    );
    let degisimler = h.gozlemci.al();
    assert!(degisimler.iter().any(|d| d.baglanti), "yetenekler değişti: Degisim.baglanti");
    assert!(degisimler.iter().any(|d| d.tumu || d.kayitlar.contains(&a)), "kayıt işareti değişti");
}

/// Sıra ve çakışma: kuyruk [yalnız v3 simge=ev, karma başlık+simge=is, yalnız v3 simge=okul, v2 açıklama].
/// v2'de karmanın v2 kısmı açıklamadan önce gider (ardına geçmez); bağlıyken araya giren v2 düzenlemesi
/// ertelenenleri beklemeden gider. v3'te ertelenenler sırayla gider: sonuncu (okul) kazanır, öncekiler onun
/// üstüne yazmaz. Görünen kopya baştan beri aynı sonucu gösterir.
#[test]
fn ertelenen_sonraki_ayni_alan_degisikliginin_ustune_yazmaz_v2_kismi_yerinde_gider() {
    let mut h = Hat::yeni("erteleme-sira");
    let a = v2ye_inen_kurulum(&mut h);
    kuyruga_yaz(&h, "i_r1", &yalniz_v3(&a, simge("ev")));
    kuyruga_yaz(&h, "i_r2", &guncelle(&a, AjandaDegisiklik { baslik: Some("B".into()), v3: simge("is"), ..Default::default() }));
    kuyruga_yaz(&h, "i_r3", &yalniz_v3(&a, simge("okul")));
    kuyruga_yaz(&h, "i_r4", &guncelle(&a, AjandaDegisiklik { aciklama: Alan::Deger("x".into()), ..Default::default() }));
    v2de_baglan(&mut h);
    let uygulanan: Vec<&str> = h.pc.uygulanan.iter().map(String::as_str).collect();
    assert_eq!(uygulanan[uygulanan.len() - 2..], ["i_r2", "i_r4"], "v2 kısmı sonraki işlemin ardına geçmedi");
    assert_eq!(kayit(&h, &a).v3.simge.as_deref(), Some("okul"), "iyimser hal sıranın sonucu");
    assert_eq!(yetenek(&h).ertelenen, 3);

    // Bağlıyken yeni v2 düzenlemesi: ertelenenlerin arkasında ama hemen gider.
    h.c.duzenle(a.clone(), None, govde("C", None)).unwrap();
    h.pompala();
    assert_eq!(h.pc.d.kayitlar[&a].baslik, "C");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    // Form gövdesi açıklamasızdı (temelsiz düzenleme): açıklama kalktı; v3 alanına dokunmadı.
    let k = kayit(&h, &a);
    assert_eq!((k.baslik.as_str(), k.v3.simge.as_deref(), k.aciklama.as_deref()), ("C", Some("okul"), None));

    v3e_gec(&mut h);
    let son: Vec<&str> = h.pc.uygulanan.iter().rev().take(3).map(String::as_str).collect();
    assert!(son.contains(&"i_r1") && son.contains(&"i_r3"), "{son:?}");
    assert_eq!(h.pc.uygulanan.last().map(String::as_str), Some("i_r3"), "aynı alanın sonraki değişikliği en son gitti");
    let pc = &h.pc.d.kayitlar[&a];
    assert_eq!((pc.baslik.as_str(), pc.v3.simge.as_deref(), pc.aciklama.as_deref()), ("C", Some("okul"), None));
    assert_eq!(&kayit(&h, &a), pc);
    assert_eq!(h.c.baglanti_durumu().unwrap().ret_listesinde, 0);
}

/// v2'de aynı depoyla tam telafi (servis yedekten dönmüş gibi: iz tutmuyor): kuyruk taze kopya üstüne yeniden
/// uygulanır, ertelenen satır atılmaz, kayıt v3 alanlarıyla görünmeye devam eder; sonra v3'te gider. İz
/// yollanmışken tam telafi yedekten dönüş kanıtıdır (`yerel.rs` `DonusAnalizi`): telefonun bildiği ve PC'de
/// kanıtlanamayan yazım (başlık "A") yitirilmiş sayılır, ertelenenin önünde yeniden gider.
#[test]
fn v2_tam_telafisi_ertelenen_satiri_atmaz() {
    let mut h = Hat::yeni("erteleme-tam");
    let a = v2ye_inen_kurulum(&mut h);
    kuyruga_yaz(&h, "i_v3", &yalniz_v3(&a, simge("ev")));
    v2de_baglan(&mut h);
    assert_eq!(yetenek(&h).ertelenen, 1);
    // PC başka yoldan değişir, iz silinir: sonraki v2 bağlantısı tam telafidir.
    h.kopar();
    h.pc.disaridan_degistir(&a, |k| k.baslik = "PC'de".into());
    h.pc.d.gecmis_izi.clear();
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!((h.pc.acilislar.last(), h.pc.son_welcome_tam), (Some(&("hello", 2)), Some(true)));
    let k = kayit(&h, &a);
    assert_eq!((k.baslik.as_str(), k.v3.simge.as_deref()), ("A", Some("ev")));
    assert_eq!(h.pc.d.kayitlar[&a].baslik, "A", "yitirilen değer yeniden gitti");
    assert_eq!(depo(&h).kuyruk().unwrap().iter().map(|s| s.islem_id.as_str()).collect::<Vec<_>>(), ["i_v3"]);
    assert_eq!(yetenek(&h).ertelenen, 1);

    v3e_gec(&mut h);
    assert_eq!(h.pc.uygulanan.last().map(String::as_str), Some("i_v3"));
    assert_eq!(h.pc.d.kayitlar[&a].v3.simge.as_deref(), Some("ev"));
    assert_eq!(&kayit(&h, &a), &h.pc.d.kayitlar[&a]);
}

/// Koparma (D2): ertelenen satırlar öteki bekleyenler gibi kuyrukla atılır, değerleri görünen kopyada
/// (yerel gerçek) kalır; koparmanın sayıları onları gönderilmeyen sayar. Yerel kipte erteleme yoktur.
#[test]
fn koparmada_ertelenen_degerler_yerel_gercekte_kalir() {
    let mut h = Hat::yeni("erteleme-kopar");
    let a = v2ye_inen_kurulum(&mut h);
    // Karma satır: v2 kısmı gider, bölünürken görünen kopya yeniden hesaplanır (doğrudan yazılan satır).
    kuyruga_yaz(&h, "i_karma", &guncelle(&a, AjandaDegisiklik { baslik: Some("A2".into()), v3: simge("ev"), ..Default::default() }));
    v2de_baglan(&mut h);
    assert_eq!((h.pc.d.kayitlar[&a].baslik.as_str(), kayit(&h, &a).v3.simge.as_deref()), ("A2", Some("ev")));
    let s = h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    assert_eq!((s.onceki_kip, s.gonderilmeyen_islem, s.gonderilmeyen_kayit, s.yanitsiz_islem), (CalismaKipi::Bagli, 1, 1, 0));
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    let g = gorunum(&h, &a);
    assert_eq!((g.kayit.v3.simge.as_deref(), g.bekleyen, g.ertelenen), (Some("ev"), false, false));
    assert_eq!(
        yetenek(&h),
        BaglantiYetenekleri { kip: BaglantiKipi::Yerel, surum: None, v3_alanlari: true, yetenekler: vec![], ertelenen: 0 }
    );
    // Yerel düzenleme v3 alanını korur.
    h.c.duzenle(a.clone(), None, govde("Yerelde", None)).unwrap();
    let k = kayit(&h, &a);
    assert_eq!((k.baslik.as_str(), k.v3.simge.as_deref()), ("Yerelde", Some("ev")));
}

/// Koparmadan sonra v3 servisle yeniden bağlanma: yerel gerçekteki (ertelenmiş olan) v3 değeri PC'ye fark
/// olarak gitmeli.
#[test]
#[ignore = "Kol B: yereli_kuyruga_dok (motor/yerel.rs kuyruga_islemler/govde_farki) v3 alanlarını farka katmıyor; düzeltme Kol B'nin dalında"]
fn koparmadan_sonra_v3_baglanmada_ertelenen_deger_pcye_gider() {
    let mut h = Hat::yeni("erteleme-kopar-baglan");
    let a = v2ye_inen_kurulum(&mut h);
    kuyruga_yaz(&h, "i_karma", &guncelle(&a, AjandaDegisiklik { baslik: Some("A2".into()), v3: simge("ev"), ..Default::default() }));
    v2de_baglan(&mut h);
    h.c.baglantiyi_kopar().unwrap();
    h.pompala();
    h.pc.surum_kumesi(&[2, 3]);
    h.zaman.ilerlet(SAAT);
    h.eslestir();
    assert!(h.canli_mi());
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Bagli);
    assert_eq!(h.pc.d.kayitlar[&a].v3.simge.as_deref(), Some("ev"));
    assert_eq!(kayit(&h, &a).v3.simge.as_deref(), Some("ev"));
}

/// Yerel kip (servis yok): erteleme hiç devreye girmez; yetenekler yerel, kayıt işaretleri yanlış.
#[test]
fn yerel_kipte_erteleme_yok() {
    let h = Hat::yeni("erteleme-yerel");
    assert_eq!(h.c.kip().unwrap(), CalismaKipi::Yerel);
    assert_eq!(
        yetenek(&h),
        BaglantiYetenekleri { kip: BaglantiKipi::Yerel, surum: None, v3_alanlari: true, yetenekler: vec![], ertelenen: 0 }
    );
    let id = h.c.ekle(govde("Yerel", None), GirdiYolu::Elle).unwrap();
    let g = gorunum(&h, &id);
    assert_eq!((g.bekleyen, g.ertelenen), (false, false));
    let d = h.c.baglanti_durumu().unwrap();
    assert_eq!((d.kuyrukta, d.ret_listesinde), (0, 0));
}

/// Bugünkü canlı kurulum (v2 servis, v3 alanı olmayan kayıtlar): erteleme görünmez, kuyruk eskisi gibi
/// sayılır ve gider.
#[test]
fn v3_alani_olmayan_kuyruk_v2_serviste_eskisi_gibi() {
    let mut h = Hat::yeni("erteleme-yok");
    let a = v2ye_inen_kurulum(&mut h);
    v2de_baglan(&mut h);
    h.kopar();
    h.c.duzenle(a.clone(), None, govde("Çevrimdışı", None)).unwrap();
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 1);
    let g = gorunum(&h, &a);
    assert_eq!((g.bekleyen, g.ertelenen), (true, false));
    assert_eq!(yetenek(&h).ertelenen, 0);
    h.baglan();
    assert!(h.canli_mi());
    assert_eq!(h.pc.d.kayitlar[&a].baslik, "Çevrimdışı");
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
    assert!(!gorunum(&h, &a).bekleyen);
}

/// İlk v3 bağlantının bir kezlik tam telafisi (`kanal.rs` `hello_yolla` "kopya eski": `hello` izsiz gider)
/// yedekten dönüş sayılmaz (`yerel.rs` `geri_donenleri_kuyruga_koy` `iz_kaybi`): PC'nin kopukken meşru
/// ilerlemesi telefonun eski bildiği değerle ezilmez.
#[test]
fn ilk_v3_tam_telafisi_yedekten_donus_sayilmaz_pc_ilerlemesi_kalir() {
    let mut h = Hat::yeni("erteleme-ilk-v3");
    let a = v2ye_inen_kurulum(&mut h);
    v2de_baglan(&mut h);
    assert_eq!(h.pc.d.kayitlar[&a].baslik, "A");
    h.kopar();
    h.pc.disaridan_degistir(&a, |k| k.baslik = "PC'de".into());
    let uygulanan = h.pc.uygulanan.len();
    v3e_gec(&mut h);
    assert_eq!(h.pc.son_welcome_tam, Some(true), "kopya v2 ile doluydu: bir kez tam telafi");
    assert_eq!(h.pc.uygulanan.len(), uygulanan, "telefon hiçbir işlem yollamadı");
    assert_eq!(h.pc.d.kayitlar[&a].baslik, "PC'de");
    assert_eq!(&kayit(&h, &a), &h.pc.d.kayitlar[&a]);
    assert_eq!(h.c.baglanti_durumu().unwrap().kuyrukta, 0);
}
