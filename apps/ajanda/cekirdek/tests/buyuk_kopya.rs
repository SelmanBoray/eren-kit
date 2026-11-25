//! R4 ölçümü: büyük kopyada (`AJANDA_OLCUM_ADET`, varsayılan 5000 kayıt) eşitleme ve sorgu süreleri.
//! Doğruluğu da sınar (her şey geldi, alarmlar kuruldu); süreleri `--nocapture` ile basar. Süre sınırı
//! yalnız kaba bir regresyon bekçisidir (hata ayıklama derlemesinde, yavaş makinede de geçmeli).

mod ortak;

use std::time::Instant;

use ajanda_cekirdek::kopru::tipler::{ListeSorgusu, Sekme};
use ajanda_cekirdek::model::GirdiYolu;
use ortak::*;

#[test]
fn buyuk_kopyada_esitleme_ve_sorgu_sureleri() {
    let adet: usize = std::env::var("AJANDA_OLCUM_ADET").ok().and_then(|s| s.parse().ok()).unwrap_or(5_000);
    let mut h = Hat::yeni("buyuk");
    for i in 0..adet {
        // Yarısı tarihli (gelecek günlere yayılmış, birer hatırlatmalı), yarısı tarihsiz.
        let zaman = (i % 2 == 0).then(|| an(&format!("2026-12-{:02}", 1 + (i / 2) % 28), &format!("{:02}:{:02}", 8 + i % 10, i % 60)));
        h.pc.disaridan_ekle(&format!("k_{i:06}"), &govde(&format!("Kayıt {i}"), zaman), false);
    }

    let t = Instant::now();
    h.eslestir();
    let ilk = t.elapsed();
    assert!(h.canli_mi());
    let tarihli = ListeSorgusu { sekme: Sekme::Tarihli, kapalilar_dahil: false };
    let tarihsiz = ListeSorgusu { sekme: Sekme::Tarihsiz, kapalilar_dahil: false };

    let t = Instant::now();
    let l = h.c.liste(tarihli.clone()).unwrap();
    let liste_suresi = t.elapsed();
    assert_eq!(l.len(), adet.div_ceil(2));
    assert_eq!(h.c.liste(tarihsiz).unwrap().len(), adet / 2);
    assert_eq!(h.alarm.kurulular().len(), adet.div_ceil(2), "her tarihli kaydın alarmı");

    let t = Instant::now();
    let k = h.c.kayit("k_000123".into()).unwrap();
    let kayit_suresi = t.elapsed();
    assert!(k.is_some());

    let t = Instant::now();
    let k = h.pc.disaridan_degistir("k_000010", |k| k.baslik = "Değişti".into());
    h.pc_degisti(k);
    let canli = t.elapsed();

    let t = Instant::now();
    h.c.ekle(govde("Yeni", Some(an("2026-12-01", "09:00"))), GirdiYolu::Elle).unwrap();
    h.pompala();
    let ekle = t.elapsed();

    // Aynı içerikle yeniden tam eşitleme (ör. PC yeni depo kimliği verdi): satırlar aynıysa yeniden yazılmaz.
    h.kopar();
    h.pc.d.depo_id = "d_yeniden".into();
    let t = Instant::now();
    h.baglan();
    let yeniden_tam = t.elapsed();
    assert_eq!(h.pc.son_welcome_tam, Some(true));

    // Artımlı: bağlantı yenilenir, değişen yok.
    h.kopar();
    let t = Instant::now();
    h.baglan();
    let artimli = t.elapsed();

    // Alarm planının tamamı (R3; tam eşitlemenin sonunda da çalışır): açılıştaki yeniden kurulum.
    let t = Instant::now();
    h.c.alarmlari_yeniden_kur(ajanda_cekirdek::kopru::tipler::YenidenKurmaNedeni::UygulamaAcildi).unwrap();
    let yeniden_kur = t.elapsed();

    eprintln!(
        "büyük kopya ({adet} kayıt): ilk tam eşitleme {ilk:?}, yeniden tam {yeniden_tam:?}, artımlı (boş) {artimli:?}, \
         tarihli liste ({} satır) {liste_suresi:?}, tek kayıt {kayit_suresi:?}, canlı kayıt {canli:?}, ekle+sonuç {ekle:?}, \
         alarmları yeniden kur {yeniden_kur:?}",
        l.len()
    );
    assert!(ilk.as_secs() < 120, "ilk eşitleme çok yavaş: {ilk:?}");
}
