//! R4 ölçümü: büyük kopyada (`AJANDA_OLCUM_ADET`, varsayılan 5000 kayıt) eşitleme ve sorgu süreleri.
//! Doğruluğu da sınar (her şey geldi, alarmlar kuruldu); süreleri `--nocapture` ile basar. Süre sınırı
//! yalnız kaba bir regresyon bekçisidir (hata ayıklama derlemesinde, yavaş makinede de geçmeli).

mod ortak;

use std::time::Instant;

use ajanda_cekirdek::kopru::tipler::{ListeSorgusu, Sekme};
use ajanda_cekirdek::kural::AnCevirici;
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
    // Her tarihli kaydın alarmı; Android'in uygulama başına sınırı yüzünden en çok bütçe kadarı (en yakınlar).
    let kurulu = h.alarm.kurulular();
    assert_eq!(kurulu.len(), adet.div_ceil(2).min(ajanda_cekirdek::ALARM_BUTCESI), "bütçe kadar alarm");
    let en_uzak_kurulu = kurulu.iter().map(|(_, t)| *t).max().unwrap_or(0);
    let kurulu_kayitlar: std::collections::HashSet<&str> = kurulu.iter().map(|(k, _)| k.as_str()).collect();
    for g in &l {
        let Some(ajanda_cekirdek::model::AjandaZamani::An { tarih, saat, saat_dilimi, .. }) = &g.kayit.zaman else { continue };
        let tetik = cevirici().ana_cevir(tarih, saat, saat_dilimi).unwrap() - SAAT;
        if tetik < en_uzak_kurulu {
            assert!(kurulu_kayitlar.contains(g.kayit.kayit_id.as_str()), "daha yakın tetik kurulmadı: {}", g.kayit.kayit_id);
        }
    }

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

/// Takvim sekmesi büyük kopyada (`AJANDA_OLCUM_ADET`, varsayılan 5000): iki yıla yayılmış karışık kopya
/// (saatli, süreli, saatsiz/bölümlü, dönem, %1 tekrar eden, %10 kapalı, %20 tarihsiz). Dolu ay, seçili gün
/// ve adayların en kötü hali (verinin sonrasındaki boş ay: pencere öncesindeki her satır süzülür).
#[test]
fn buyuk_kopyada_takvim_sorgu_sureleri() {
    use ajanda_cekirdek::model::{AjandaZamani, GunBolumu, KayitDurumu, Tekrar, TekrarSikligi};
    let adet: usize = std::env::var("AJANDA_OLCUM_ADET").ok().and_then(|s| s.parse().ok()).unwrap_or(5_000);
    let mut h = Hat::yeni("buyuk-takvim");
    let bas = ajanda_cekirdek::model::takvim::tarih_gun_no("2025-12-01").unwrap();
    for i in 0..adet {
        let tarih = ajanda_cekirdek::model::takvim::gun_no_tarih(bas + (i as i64 * 7) % 730);
        let saat = format!("{:02}:{:02}", 7 + i % 15, (i * 7) % 60);
        let gun = |b| AjandaZamani::Gun { tarih: tarih.clone(), gun_bolumu: b, saat_dilimi: IST.into(), ifade: None };
        let mut g = govde(&format!("Kayıt {i}"), None);
        g.zaman = match i % 20 {
            0..=9 => Some(an(&tarih, &saat)),
            10 | 11 => Some(AjandaZamani::An { tarih: tarih.clone(), saat: "22:30".into(), sure_dk: Some(150), saat_dilimi: IST.into(), ifade: None }),
            12 | 13 => Some(gun(None)),
            14 => Some(gun(Some(GunBolumu::Aksam))),
            15 => {
                let son = ajanda_cekirdek::model::takvim::gun_no_tarih(bas + (i as i64 * 7) % 730 + 4);
                Some(AjandaZamani::Donem { baslangic: tarih.clone(), bitis: son, saat_dilimi: IST.into(), ifade: None })
            }
            _ => None,
        };
        if i % 100 == 1 {
            g.tekrar = Some(Tekrar { siklik: TekrarSikligi::Gunluk, aralik: 1 + (i % 3) as i32, gunler: None, bitis_tarihi: None, adet: None });
        }
        let id = format!("k_{i:06}");
        h.pc.disaridan_ekle(&id, &g, false);
        if i % 10 == 3 {
            h.pc.disaridan_degistir(&id, |k| k.durum = KayitDurumu::Tamam);
        }
    }
    h.eslestir();
    assert!(h.canli_mi());

    let olc = |f: &dyn Fn() -> usize| {
        let _ = f(); // ısınma (deyim önbelleği, sayfa önbelleği)
        let t = Instant::now();
        let n = f();
        (t.elapsed(), n)
    };
    let (dolu_ay, dolu_n) = olc(&|| h.c.takvim_ayi(2026, 12, false).unwrap().gunler.iter().map(|g| g.toplam as usize).sum());
    let (dolu_ay_k, _) = olc(&|| h.c.takvim_ayi(2026, 12, true).unwrap().gunler.iter().map(|g| g.toplam as usize).sum());
    let (gun, gun_n) = olc(&|| h.c.takvim_gunu("2026-12-15".into(), true).unwrap().len());
    let (bos_ay, bos_n) = olc(&|| h.c.takvim_ayi(2031, 6, false).unwrap().gunler.iter().map(|g| g.toplam as usize).sum());
    let (liste, liste_n) = olc(&|| h.c.liste(ListeSorgusu { sekme: Sekme::Tarihli, kapalilar_dahil: false }).unwrap().len());
    assert!(dolu_n > 0 && gun_n > 0);
    // Uzak ayda yalnız tekrar edenler görünür.
    assert!(bos_n > 0);
    // Özet gün listesiyle tutarlı.
    let a = h.c.takvim_ayi(2026, 12, true).unwrap();
    assert_eq!(a.gunler[14].toplam as usize, gun_n);
    eprintln!(
        "takvim ({adet} kayıt): ay (açıklar, {dolu_n} öğe-gün) {dolu_ay:?}, ay (kapalılar dahil) {dolu_ay_k:?}, \
         gün ({gun_n} öğe) {gun:?}, boş uzak ay ({bos_n} öğe-gün, en kötü aday taraması) {bos_ay:?}; \
         karşılaştırma: tarihli liste ({liste_n} satır) {liste:?}"
    );
}
