//! SAHİBİ: R3 (hatırlatma planı). `ajanda-kural.ts` `hatirlatmaHalleri`, `kurulacakHatirlatmalar`,
//! `kacirilanHatirlatmalar`, `hatirlatmaOzeti`, `gunHatirlatmasiYereli` (v2). Saf kurallardır; Android'e
//! alarm kurdurmak `motor::alarm`'ın (aynı sahip) işidir. Vektör: `hatirlatma_plani.vakalar`,
//! `hatirlatma_plani.kacirilan`, `gun_hatirlatmasi`. Etkinlik: `AjandaKaydi::hatirlatma_etkin_mi`.
//!
//! v2: `once` saatli (`an`) kayıtta olayın anından `dk` önce; saatsiz gün (`gun`) kaydında gün
//! hatırlatmasıdır: `gun_hatirlatmasi_yereli(gün, dk, gun_bolumu)` yerel anında, kaydın diliminde (gün
//! `gün − ⌊dk/1440⌋`, saat bölümün saati ya da 09:00). Tetik her çağrıda kaydın o anki zamanından
//! hesaplanır: gün değişince yeni güne gider, saat gelince saatli kurala, saat kalkınca gün hatırlatmasına
//! döner. `donem`, `belirsiz` ve zamansız kayıtta bekler.
//!
//! Kayıt düzeyindeki işlevler TS ile birebirdir: bir hatırlatmanın çevirisi başarısızsa (bilinmeyen
//! dilim) bütün çağrı hata döner (TS atar). Motor tek bir hatırlatmanın hatasını yutup ötekileri
//! sürdürebilsin diye aynı kural hatırlatma başına da açıktır (`hatirlatma_hali`, `hatirlatma_kacirilanlari`);
//! kayıt düzeyindekiler bunların birleşimidir, iki yol ayrışamaz.

use std::collections::HashSet;

use super::{AnCevirici, ZamanHatasi};
use crate::model::sinirlar::ajanda::{KACIRILAN_PENCERE_DK, YIL_MIN};
use crate::model::takvim::{gun_no, gun_no_tarih, tarih_gun_no};
use crate::model::{AjandaKaydi, AjandaZamani, GunBolumu, Hatirlatma, Tekrar, gun_hatirlatma_saati, tekrar_ornekleri};

const DAKIKA_MS: i64 = 60_000;
const GUN_MS: i64 = 86_400_000;
const GUN_DK: i64 = 1_440;

/// Kaçırılan penceresinin uzunluğu (ms): tetiği `(şimdi − pencere, şimdi]` içinde olan kurulu alarm gösterilir.
pub const KACIRILAN_PENCERE_MS: i64 = KACIRILAN_PENCERE_DK * DAKIKA_MS;

/// Gün hatırlatmasının yerel tetik günü ve saati (kaydın diliminde; `GunHatirlatmasiYereli`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GunHatirlatmasiYereli {
    pub tarih: String,
    pub saat: String,
}

/// Bir hatırlatmanın şimdiye göre hali. `sira`: kaydın `hatirlatmalar` dizisindeki yeri.
/// `gun_hatirlatmasi` yalnız saatsiz gün kaydındaki `once`'ta vardır (tekrarın geçmiş halinde yoktur:
/// tek bir gün yoktur).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HatirlatmaHali {
    /// Tetik şimdiden kesin sonra. Tekrarda `ornek_tarihi` örneğin günüdür.
    Kurulur { sira: usize, tetik_ms: i64, ornek_tarihi: Option<String>, gun_hatirlatmasi: Option<GunHatirlatmasiYereli> },
    /// `once`, zaman `an` ya da `gun` değil (dönem, belirsiz, zamansız): bekler.
    Saatsiz { sira: usize },
    /// Tetik geçti (ya da tekrarda sonraki açık örnek yok): kurulmaz.
    Gecmis { sira: usize, gun_hatirlatmasi: Option<GunHatirlatmasiYereli> },
}

/// Kurulacak (ya da kaçırılan) bir tetik. Alarmın kimliği `(kayit_id, tetik_ms)`'dir.
/// `gun_hatirlatmasi` yalnız kurulacaklarda (gün hatırlatmasıysa); kaçırılanda yoktur (TS ile aynı).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HatirlatmaTetigi {
    pub sira: usize,
    pub tetik_ms: i64,
    pub ornek_tarihi: Option<String>,
    pub gun_hatirlatmasi: Option<GunHatirlatmasiYereli>,
}

/// Özetin gün hatırlatması: sıradaki (`gecti` yanlış) ya da hepsi geçtiyse en son geçen (`gecti` doğru).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GunHatirlatmasiOzeti {
    pub tarih: String,
    pub saat: String,
    pub gecti: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HatirlatmaOzeti {
    pub toplam: u32,
    pub kurulacak: u32,
    pub saatsiz: u32,
    pub gecmis: u32,
    /// v2: yalnız `hatirlatma_etkin_mi` iken ve gün hatırlatması olan bir hal varsa.
    pub gun_hatirlatmasi: Option<GunHatirlatmasiOzeti>,
}

/// `gunHatirlatmasiYereli` (v2): `gun`'den ⌊dk / 1440⌋ gün önce, gün bölümünün saatinde. Gün içi öne alış
/// (dk < 1440) saat olmadığı için aynı güne düşer; gün sayısı kadar öne alış ("bir gün önce") korunur.
/// `gun` geçerli bir tarih olmalı (kayıt şemasından geçmiş); değilse `None`.
pub fn gun_hatirlatmasi_yereli(gun: &str, dk: i64, gun_bolumu: Option<GunBolumu>) -> Option<GunHatirlatmasiYereli> {
    let no = tarih_gun_no(gun)?;
    Some(GunHatirlatmasiYereli { tarih: gun_no_tarih(no - dk.div_euclid(GUN_DK)), saat: gun_hatirlatma_saati(gun_bolumu).to_string() })
}

/// `once`'ın çalabildiği zaman (`an` ya da v2'de `gun`); ötekilerde `None` (bekler).
enum OnceZamani<'a> {
    An { tarih: &'a str, saat: &'a str, dilim: &'a str },
    Gun { tarih: &'a str, bolum: Option<GunBolumu>, dilim: &'a str },
}

impl OnceZamani<'_> {
    fn tarih(&self) -> &str {
        match self {
            OnceZamani::An { tarih, .. } | OnceZamani::Gun { tarih, .. } => tarih,
        }
    }

    /// `once{dk}`'nin `gun` günündeki örnek için tetiği; saatsiz gün kaydında yerel hali de.
    fn tetik(&self, gun: &str, dk: i64, an: &dyn AnCevirici) -> Result<(i64, Option<GunHatirlatmasiYereli>), ZamanHatasi> {
        match self {
            OnceZamani::An { saat, dilim, .. } => Ok((an.ana_cevir(gun, saat, dilim)? - dk * DAKIKA_MS, None)),
            OnceZamani::Gun { bolum, dilim, .. } => {
                let y = gun_hatirlatmasi_yereli(gun, dk, *bolum)
                    .ok_or_else(|| ZamanHatasi { mesaj: format!("geçersiz gün: {gun}") })?;
                Ok((an.ana_cevir(&y.tarih, &y.saat, dilim)?, Some(y)))
            }
        }
    }
}

fn once_zamani(kayit: &AjandaKaydi) -> Option<OnceZamani<'_>> {
    match &kayit.zaman {
        Some(AjandaZamani::An { tarih, saat, saat_dilimi, .. }) => Some(OnceZamani::An { tarih, saat, dilim: saat_dilimi }),
        Some(AjandaZamani::Gun { tarih, gun_bolumu, saat_dilimi, .. }) => {
            Some(OnceZamani::Gun { tarih, bolum: *gun_bolumu, dilim: saat_dilimi })
        }
        _ => None,
    }
}

/// Tekrar taramasının alt günü (`gunAlti`): `YIL_MIN`'den önceyse sınırsız (çapadan).
fn gun_alti(gun: i64) -> Option<String> {
    if gun < gun_no(YIL_MIN, 1, 1) { None } else { Some(gun_no_tarih(gun)) }
}

/// `taramaAlti`: tetiği `alt_ms`'den sonra olabilecek ilk örnek bundan önce olamaz (örnek günü tetiğin
/// gününden önce değildir; dilim ofseti ve gün saati için 3 gün pay). Pay sonucu değiştirmez.
fn tarama_alti(alt_ms: i64) -> Option<String> {
    gun_alti(alt_ms.div_euclid(GUN_MS) - 3)
}

/// Kapalı örneklerin günleri (`ornekler`'deki her satır kapalıdır).
fn kapali_gunler(kayit: &AjandaKaydi) -> HashSet<&str> {
    kayit.ornekler.iter().map(|o| o.tarih.as_str()).collect()
}

/// `seriSonrakiTetik`: kapalı olmayan, tetiği şimdiden sonraki ilk örnek.
fn seri_sonraki_tetik(
    kayit: &AjandaKaydi,
    z: &OnceZamani<'_>,
    tekrar: &Tekrar,
    dk: i64,
    simdi_ms: i64,
    an: &dyn AnCevirici,
) -> Result<Option<(i64, String, Option<GunHatirlatmasiYereli>)>, ZamanHatasi> {
    let kapali = kapali_gunler(kayit);
    for gun in tekrar_ornekleri(z.tarih(), tekrar, tarama_alti(simdi_ms).as_deref()) {
        if kapali.contains(gun.as_str()) {
            continue;
        }
        let (tetik, y) = z.tetik(&gun, dk, an)?;
        if tetik > simdi_ms {
            return Ok(Some((tetik, gun, y)));
        }
    }
    Ok(None)
}

/// Tek bir hatırlatmanın hali (`hatirlatmaHalleri`'nin bir satırı). `sira` dizinin içinde olmalı.
pub fn hatirlatma_hali(kayit: &AjandaKaydi, sira: usize, simdi_ms: i64, an: &dyn AnCevirici) -> Result<HatirlatmaHali, ZamanHatasi> {
    let gelecekse = |tetik_ms: i64, gun_hatirlatmasi: Option<GunHatirlatmasiYereli>| {
        if tetik_ms > simdi_ms {
            HatirlatmaHali::Kurulur { sira, tetik_ms, ornek_tarihi: None, gun_hatirlatmasi }
        } else {
            HatirlatmaHali::Gecmis { sira, gun_hatirlatmasi }
        }
    };
    match &kayit.hatirlatmalar[sira] {
        Hatirlatma::Mutlak { tarih, saat, saat_dilimi } => Ok(gelecekse(an.ana_cevir(tarih, saat, saat_dilimi)?, None)),
        Hatirlatma::Once { dk } => {
            let Some(z) = once_zamani(kayit) else {
                return Ok(HatirlatmaHali::Saatsiz { sira });
            };
            let dk = i64::from(*dk);
            if let Some(tekrar) = &kayit.tekrar {
                return Ok(match seri_sonraki_tetik(kayit, &z, tekrar, dk, simdi_ms, an)? {
                    Some((tetik_ms, gun, gun_hatirlatmasi)) => {
                        HatirlatmaHali::Kurulur { sira, tetik_ms, ornek_tarihi: Some(gun), gun_hatirlatmasi }
                    }
                    None => HatirlatmaHali::Gecmis { sira, gun_hatirlatmasi: None },
                });
            }
            let (tetik, y) = z.tetik(z.tarih(), dk, an)?;
            Ok(gelecekse(tetik, y))
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
        if let HatirlatmaHali::Kurulur { sira, tetik_ms, ornek_tarihi, gun_hatirlatmasi } = hal {
            sonuc.push(HatirlatmaTetigi { sira, tetik_ms, ornek_tarihi, gun_hatirlatmasi });
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
            sonuc.push(HatirlatmaTetigi { sira, tetik_ms, ornek_tarihi, gun_hatirlatmasi: None });
        }
    };
    match &kayit.hatirlatmalar[sira] {
        Hatirlatma::Mutlak { tarih, saat, saat_dilimi } => dene(an.ana_cevir(tarih, saat, saat_dilimi)?, None),
        Hatirlatma::Once { dk } => {
            let Some(z) = once_zamani(kayit) else {
                return Ok(sonuc);
            };
            let dk = i64::from(*dk);
            match &kayit.tekrar {
                None => dene(z.tetik(z.tarih(), dk, an)?.0, None),
                Some(tekrar) => {
                    let kapali = kapali_gunler(kayit);
                    for gun in tekrar_ornekleri(z.tarih(), tekrar, tarama_alti(alt_ms).as_deref()) {
                        let (tetik, _) = z.tetik(&gun, dk, an)?;
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

/// Yerel gün ve saatin sözlük sırası takvim sırasıdır (aynı dilim): `YYYY-MM-DDTHH:MM`.
fn yerel_sirasi(y: &GunHatirlatmasiYereli) -> (i64, &str) {
    (tarih_gun_no(&y.tarih).unwrap_or(i64::MIN), y.saat.as_str())
}

/// `hatirlatmaOzeti`: `kurulacak` etkinlik dahil; öteki sayılar etkinlikten bağımsız. `gun_hatirlatmasi`
/// (v2) yalnız etkin kayıtta: tetiği en erken kurulacak gün hatırlatması (`gecti:false`), kurulacak yoksa
/// en geç geçmiş olanı (`gecti:true`).
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
        return Ok(oz);
    }
    let mut sonraki: Option<(i64, &GunHatirlatmasiYereli)> = None;
    let mut gecen: Option<&GunHatirlatmasiYereli> = None;
    for h in &haller {
        match h {
            HatirlatmaHali::Kurulur { tetik_ms, gun_hatirlatmasi: Some(y), .. } if sonraki.is_none_or(|(t, _)| *tetik_ms < t) => {
                sonraki = Some((*tetik_ms, y));
            }
            HatirlatmaHali::Gecmis { gun_hatirlatmasi: Some(y), .. } if gecen.is_none_or(|g| yerel_sirasi(y) > yerel_sirasi(g)) => {
                gecen = Some(y);
            }
            _ => {}
        }
    }
    oz.gun_hatirlatmasi = match (sonraki, gecen) {
        (Some((_, y)), _) => Some(GunHatirlatmasiOzeti { tarih: y.tarih.clone(), saat: y.saat.clone(), gecti: false }),
        (None, Some(y)) => Some(GunHatirlatmasiOzeti { tarih: y.tarih.clone(), saat: y.saat.clone(), gecti: true }),
        (None, None) => None,
    };
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
            HatirlatmaHali::Kurulur { sira: 1, tetik_ms: SIMDI + 60 * DK, ornek_tarihi: None, gun_hatirlatmasi: None }
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
        assert_eq!(hatirlatma_halleri(&k, SIMDI, &c).unwrap(), vec![HatirlatmaHali::Gecmis { sira: 0, gun_hatirlatmasi: None }]);
        let bugun_14 = SIMDI - 30 * DK;
        let r = kacirilan_hatirlatmalar(&k, SIMDI, &c, &[bugun_14]).unwrap();
        assert_eq!(r, vec![HatirlatmaTetigi { sira: 0, tetik_ms: bugun_14, ornek_tarihi: Some("2026-11-25".into()), gun_hatirlatmasi: None }]);
    }
}
