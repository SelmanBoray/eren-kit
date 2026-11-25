//! SAHİBİ: R3 (hatırlatma planı). `ajanda-kural.ts` `hatirlatmaHalleri`, `kurulacakHatirlatmalar`,
//! `kacirilanHatirlatmalar`, `hatirlatmaOzeti`. Saf kurallardır; Android'e alarm kurdurmak
//! `motor::alarm`'ın (aynı sahip) işidir. Vektör: `hatirlatma_plani.vakalar`, `hatirlatma_plani.kacirilan`.
//! Etkinlik: `AjandaKaydi::hatirlatma_etkin_mi` (modelde, `hatirlatma_etkin` vektörü geçer).
//!
//! Kayıt düzeyindeki işlevler TS ile birebirdir: bir hatırlatmanın çevirisi başarısızsa (bilinmeyen
//! dilim) bütün çağrı hata döner (TS atar). Motor tek bir hatırlatmanın hatasını yutup ötekileri
//! sürdürebilsin diye aynı kural hatırlatma başına da açıktır (`hatirlatma_hali`, `hatirlatma_kacirilanlari`);
//! kayıt düzeyindekiler bunların birleşimidir, iki yol ayrışamaz.

use std::collections::HashSet;

use super::{AnCevirici, ZamanHatasi};
use crate::model::sinirlar::ajanda::{KACIRILAN_PENCERE_DK, YIL_MIN};
use crate::model::takvim::{gun_no, gun_no_tarih};
use crate::model::{AjandaKaydi, AjandaZamani, Hatirlatma, tekrar_ornekleri};

const DAKIKA_MS: i64 = 60_000;
const GUN_MS: i64 = 86_400_000;

/// Kaçırılan penceresinin uzunluğu (ms): tetiği `(şimdi − pencere, şimdi]` içinde olan kurulu alarm gösterilir.
pub const KACIRILAN_PENCERE_MS: i64 = KACIRILAN_PENCERE_DK * DAKIKA_MS;

/// Bir hatırlatmanın şimdiye göre hali. `sira`: kaydın `hatirlatmalar` dizisindeki yeri.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HatirlatmaHali {
    /// Tetik şimdiden kesin sonra. Tekrarda `ornek_tarihi` örneğin günüdür.
    Kurulur { sira: usize, tetik_ms: i64, ornek_tarihi: Option<String> },
    /// `once`, zaman kesinliği `an` değil: bekler.
    Saatsiz { sira: usize },
    /// Tetik geçti (ya da tekrarda sonraki açık örnek yok): kurulmaz.
    Gecmis { sira: usize },
}

/// Kurulacak (ya da kaçırılan) bir tetik. Alarmın kimliği `(kayit_id, tetik_ms)`'dir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HatirlatmaTetigi {
    pub sira: usize,
    pub tetik_ms: i64,
    pub ornek_tarihi: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HatirlatmaOzeti {
    pub toplam: u32,
    pub kurulacak: u32,
    pub saatsiz: u32,
    pub gecmis: u32,
}

/// `an` kesinlikli zamanın parçaları (`once` yalnız bunlara göre hesaplanır).
fn an_parcalari(kayit: &AjandaKaydi) -> Option<(&str, &str, &str)> {
    match &kayit.zaman {
        Some(AjandaZamani::An { tarih, saat, saat_dilimi, .. }) => Some((tarih, saat, saat_dilimi)),
        _ => None,
    }
}

/// Tekrar taramasının alt günü (`gunAlti`): `YIL_MIN`'den önceyse sınırsız (çapadan).
fn gun_alti(gun: i64) -> Option<String> {
    if gun < gun_no(YIL_MIN, 1, 1) { None } else { Some(gun_no_tarih(gun)) }
}

/// Kapalı örneklerin günleri (`ornekler`'deki her satır kapalıdır).
fn kapali_gunler(kayit: &AjandaKaydi) -> HashSet<&str> {
    kayit.ornekler.iter().map(|o| o.tarih.as_str()).collect()
}

/// `seriSonrakiTetik`: kapalı olmayan, tetiği şimdiden sonraki ilk örnek.
fn seri_sonraki_tetik(
    kayit: &AjandaKaydi,
    dk: i64,
    simdi_ms: i64,
    an: &dyn AnCevirici,
) -> Result<Option<(i64, String)>, ZamanHatasi> {
    let (Some((tarih, saat, dilim)), Some(tekrar)) = (an_parcalari(kayit), &kayit.tekrar) else {
        return Ok(None);
    };
    // Tetiği şimdiden sonra olan örnek şimdinin UTC gününden en çok 1 gün önce başlar; 2 gün pay.
    let en_az = gun_alti(simdi_ms.div_euclid(GUN_MS) - 2);
    let kapali = kapali_gunler(kayit);
    for gun in tekrar_ornekleri(tarih, tekrar, en_az.as_deref()) {
        if kapali.contains(gun.as_str()) {
            continue;
        }
        let tetik = an.ana_cevir(&gun, saat, dilim)? - dk * DAKIKA_MS;
        if tetik > simdi_ms {
            return Ok(Some((tetik, gun)));
        }
    }
    Ok(None)
}

/// Tek bir hatırlatmanın hali (`hatirlatmaHalleri`'nin bir satırı). `sira` dizinin içinde olmalı.
pub fn hatirlatma_hali(kayit: &AjandaKaydi, sira: usize, simdi_ms: i64, an: &dyn AnCevirici) -> Result<HatirlatmaHali, ZamanHatasi> {
    let gelecekse = |tetik_ms: i64| {
        if tetik_ms > simdi_ms {
            HatirlatmaHali::Kurulur { sira, tetik_ms, ornek_tarihi: None }
        } else {
            HatirlatmaHali::Gecmis { sira }
        }
    };
    match &kayit.hatirlatmalar[sira] {
        Hatirlatma::Mutlak { tarih, saat, saat_dilimi } => Ok(gelecekse(an.ana_cevir(tarih, saat, saat_dilimi)?)),
        Hatirlatma::Once { dk } => {
            let Some((tarih, saat, dilim)) = an_parcalari(kayit) else {
                return Ok(HatirlatmaHali::Saatsiz { sira });
            };
            let dk = i64::from(*dk);
            if kayit.tekrar.is_some() {
                return Ok(match seri_sonraki_tetik(kayit, dk, simdi_ms, an)? {
                    Some((tetik_ms, gun)) => HatirlatmaHali::Kurulur { sira, tetik_ms, ornek_tarihi: Some(gun) },
                    None => HatirlatmaHali::Gecmis { sira },
                });
            }
            Ok(gelecekse(an.ana_cevir(tarih, saat, dilim)? - dk * DAKIKA_MS))
        }
    }
}

/// Her hatırlatmanın hali (etkinlikten bağımsız). Çeviri hatası (bilinmeyen dilim) çağırana döner.
pub fn hatirlatma_halleri(
    kayit: &AjandaKaydi,
    simdi_ms: i64,
    an: &dyn AnCevirici,
) -> Result<Vec<HatirlatmaHali>, ZamanHatasi> {
    (0..kayit.hatirlatmalar.len()).map(|sira| hatirlatma_hali(kayit, sira, simdi_ms, an)).collect()
}

/// `hatirlatma_etkin_mi` doğruysa `Kurulur` halindekiler, değilse hiçbiri.
pub fn kurulacak_hatirlatmalar(
    kayit: &AjandaKaydi,
    simdi_ms: i64,
    an: &dyn AnCevirici,
) -> Result<Vec<HatirlatmaTetigi>, ZamanHatasi> {
    if !kayit.hatirlatma_etkin_mi() {
        return Ok(Vec::new());
    }
    let mut sonuc = Vec::new();
    for hal in hatirlatma_halleri(kayit, simdi_ms, an)? {
        if let HatirlatmaHali::Kurulur { sira, tetik_ms, ornek_tarihi } = hal {
            sonuc.push(HatirlatmaTetigi { sira, tetik_ms, ornek_tarihi });
        }
    }
    Ok(sonuc)
}

/// Tek bir hatırlatmanın kaçırılan tetikleri (etkinliğe bakmaz; `kurulu` teslim edilmemiş kurulu tetiklerdir).
pub fn hatirlatma_kacirilanlari(
    kayit: &AjandaKaydi,
    sira: usize,
    simdi_ms: i64,
    an: &dyn AnCevirici,
    kurulu: &HashSet<i64>,
) -> Result<Vec<HatirlatmaTetigi>, ZamanHatasi> {
    let alt_ms = simdi_ms - KACIRILAN_PENCERE_MS;
    let mut sonuc = Vec::new();
    let mut dene = |tetik_ms: i64, ornek_tarihi: Option<String>| {
        if tetik_ms > alt_ms && tetik_ms <= simdi_ms && kurulu.contains(&tetik_ms) {
            sonuc.push(HatirlatmaTetigi { sira, tetik_ms, ornek_tarihi });
        }
    };
    match &kayit.hatirlatmalar[sira] {
        Hatirlatma::Mutlak { tarih, saat, saat_dilimi } => dene(an.ana_cevir(tarih, saat, saat_dilimi)?, None),
        Hatirlatma::Once { dk } => {
            let Some((tarih, saat, dilim)) = an_parcalari(kayit) else {
                return Ok(sonuc);
            };
            let dk = i64::from(*dk);
            match &kayit.tekrar {
                None => dene(an.ana_cevir(tarih, saat, dilim)? - dk * DAKIKA_MS, None),
                Some(tekrar) => {
                    let kapali = kapali_gunler(kayit);
                    let en_az = gun_alti((alt_ms + dk * DAKIKA_MS).div_euclid(GUN_MS) - 2);
                    for gun in tekrar_ornekleri(tarih, tekrar, en_az.as_deref()) {
                        let tetik = an.ana_cevir(&gun, saat, dilim)? - dk * DAKIKA_MS;
                        if tetik > simdi_ms {
                            break;
                        }
                        if !kapali.contains(gun.as_str()) {
                            dene(tetik, Some(gun));
                        }
                    }
                }
            }
        }
    }
    Ok(sonuc)
}

/// Tetiği `(şimdi − KACIRILAN_PENCERE_DK, şimdi]` içinde olan ve `kurulanlar`da (bu kayıt için kurulup
/// teslim edilmemiş tetikler) bulunan her tetik; etkin değilse hiçbiri. Tekrarda kapalı örnek atlanır.
pub fn kacirilan_hatirlatmalar(
    kayit: &AjandaKaydi,
    simdi_ms: i64,
    an: &dyn AnCevirici,
    kurulanlar: &[i64],
) -> Result<Vec<HatirlatmaTetigi>, ZamanHatasi> {
    if !kayit.hatirlatma_etkin_mi() || kurulanlar.is_empty() {
        return Ok(Vec::new());
    }
    let kurulu: HashSet<i64> = kurulanlar.iter().copied().collect();
    let mut sonuc = Vec::new();
    for sira in 0..kayit.hatirlatmalar.len() {
        sonuc.extend(hatirlatma_kacirilanlari(kayit, sira, simdi_ms, an, &kurulu)?);
    }
    Ok(sonuc)
}

/// `kurulacak` etkinlik dahil; öteki sayılar etkinlikten bağımsız.
pub fn hatirlatma_ozeti(kayit: &AjandaKaydi, simdi_ms: i64, an: &dyn AnCevirici) -> Result<HatirlatmaOzeti, ZamanHatasi> {
    let haller = hatirlatma_halleri(kayit, simdi_ms, an)?;
    let mut oz = HatirlatmaOzeti { toplam: haller.len() as u32, ..HatirlatmaOzeti::default() };
    for h in &haller {
        match h {
            HatirlatmaHali::Kurulur { .. } => oz.kurulacak += 1,
            HatirlatmaHali::Saatsiz { .. } => oz.saatsiz += 1,
            HatirlatmaHali::Gecmis { .. } => oz.gecmis += 1,
        }
    }
    if !kayit.hatirlatma_etkin_mi() {
        oz.kurulacak = 0;
    }
    Ok(oz)
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::kural::SabitOfsetCevirici;
    use serde_json::json;

    /// 2026-11-25 14:30 UTC+3 (vektörlerin şimdisi).
    const SIMDI: i64 = 1_795_606_200_000;
    const DK: i64 = 60_000;

    fn cevirici() -> SabitOfsetCevirici {
        SabitOfsetCevirici::yeni([("UTC", 0), ("Etc/GMT-3", 180)])
    }

    fn kayit(ek: serde_json::Value) -> AjandaKaydi {
        let mut v = json!({
            "kayit_id": "k_test1", "revizyon": 1, "tur": "randevu", "baslik": "Dişçi", "ornekler": [],
            "durum": "acik", "taslak": false, "silindi": false, "elle_alanlar": [],
            "kaynak": {"yol": "sohbet_araci", "tur_kokeni": "insan", "sohbet_id": "ana"},
            "olusturma_ms": 1_795_000_000_000i64, "guncelleme_ms": 1_795_000_000_000i64, "hatirlatmalar": []
        });
        for (k, d) in ek.as_object().unwrap() {
            v[k] = d.clone();
        }
        AjandaKaydi::oku(&v, "").unwrap()
    }

    #[test]
    fn bilinmeyen_dilim_kayit_duzeyinde_hata_hatirlatma_duzeyinde_yalniz_kendisi() {
        let k = kayit(json!({
            "zaman": {"kesinlik": "an", "tarih": "2026-11-25", "saat": "16:00", "saat_dilimi": "Etc/GMT-3"},
            "hatirlatmalar": [{"tur": "mutlak", "tarih": "2026-11-25", "saat": "18:00", "saat_dilimi": "Asia/Tokyo"},
                              {"tur": "once", "dk": 30}]
        }));
        let c = cevirici();
        assert!(hatirlatma_halleri(&k, SIMDI, &c).is_err());
        assert!(kurulacak_hatirlatmalar(&k, SIMDI, &c).is_err());
        assert!(hatirlatma_hali(&k, 0, SIMDI, &c).is_err());
        assert_eq!(
            hatirlatma_hali(&k, 1, SIMDI, &c).unwrap(),
            HatirlatmaHali::Kurulur { sira: 1, tetik_ms: SIMDI + 60 * DK, ornek_tarihi: None }
        );
    }

    #[test]
    fn tumu_kapali_seri_gecmis_ve_kacirilan_kapali_ornegi_atlar() {
        let k = kayit(json!({
            "zaman": {"kesinlik": "an", "tarih": "2026-11-24", "saat": "15:00", "saat_dilimi": "Etc/GMT-3"},
            "hatirlatmalar": [{"tur": "once", "dk": 60}],
            "tekrar": {"siklik": "gunluk", "aralik": 1, "adet": 3},
            "ornekler": [{"tarih": "2026-11-26", "durum": "tamam"}]
        }));
        let c = cevirici();
        // 24'ü ve 25'i geçti (25'in tetiği 14:00), 26 kapalı: sonraki yok.
        assert_eq!(hatirlatma_halleri(&k, SIMDI, &c).unwrap(), vec![HatirlatmaHali::Gecmis { sira: 0 }]);
        let bugun_14 = SIMDI - 30 * DK;
        let r = kacirilan_hatirlatmalar(&k, SIMDI, &c, &[bugun_14]).unwrap();
        assert_eq!(r, vec![HatirlatmaTetigi { sira: 0, tetik_ms: bugun_14, ornek_tarihi: Some("2026-11-25".into()) }]);
    }
}
