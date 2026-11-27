//! Sürüm uyumu (`sinirlar.ts` `AJANDA_SURUMU`, `AJANDA_SURUMLERI`, `AJANDA_QR_SURUMU`; `ajanda.ts`
//! "Çerçeveler: sürüme göre kurulur" ve "Sürüm uyumu"; `docs/AJANDA.md` "Sürüm uyumu").
//!
//! Her sürüm o sürümün bütün çerçevelerinin kesin şeklidir ve kendi içinde katıdır: çözücüler ve
//! yazıcılar sürümü değişken olarak alır (`Surum`). Model en yeni sürümü tutar; eski sürüme yazarken o
//! sürümün bilmediği alanlar yazılmaz (`json_surum`), aşağı uyarlama ayrıca şemadan geçirir
//! (`cerceve::ajanda_asagi_surume`). Vektör: `ajanda-surum.json`.

use super::json::{Nesne, hata, metin, metin_sabiti, tam_sayi, GUVENLI_TAM_SAYI};
use super::kayit::AjandaAlani;
use super::sinirlar::AZAMI_CERCEVE_KANAL;
use super::metin::utf16_uzunluk;
use serde_json::Value;

/// `/ajanda` kanalının en yüksek sürümü (`AJANDA_SURUMU`). 1: ilk dilim. 2: saatsiz gün kaydında gün
/// hatırlatması, `gun_bolumu`, `gece_teyidi_gerekli`. 3: kayıtta `simge`, `bolge`, `bolge_konumu`,
/// `varis`, `baglantilar`, `ekler`; `hello`/`welcome` `yetenekler`; ek yedeği çerçeveleri (`ek_*`).
/// İmza öneki bundan türemez (`eslesme.rs`), QR'ın kendi sürümü var (`AJANDA_QR_SURUMU`).
pub const AJANDA_SURUMU: i64 = 3;

/// Bu tarafın aynı anda konuştuğu sürümler (`AJANDA_SURUMLERI`): artan, bitişik, en büyüğü `AJANDA_SURUMU`.
pub const AJANDA_SURUMLERI: [i64; 2] = [2, 3];

/// Ajanda eşleştirme QR'ının sürümü (`AJANDA_QR_SURUMU`): kanal sürümünden ayrı ve dondurulmuş.
pub const AJANDA_QR_SURUMU: i64 = 2;

/// Desteklenen bir sürüm (`AjandaSurumNo`). Sıra sürüm sırasıdır.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Surum {
    V2,
    V3,
}

/// Bugünkü kanalın bağlandığı sürüm. Geçiş sabitidir: kanal (`motor/kanal.rs`) geri düşüşü yazana dek
/// uygulama v2 ile bağlanır; çerçevelerin sürümsüz `json`/`kodla`/`ajanda_*_coz` sarmalayıcıları bunu
/// kullanır. Kanal aşamasında kalkar (bağlantı sürümü bağlantının durumuna geçer).
pub const KANAL_SURUMU: Surum = Surum::V2;

impl Surum {
    /// `AJANDA_SURUMLERI` sırasıyla.
    pub const HEPSI: [Surum; 2] = [Surum::V2, Surum::V3];
    /// `AJANDA_SURUMU`.
    pub const EN_YENI: Surum = Surum::V3;

    pub const fn no(self) -> i64 {
        match self {
            Surum::V2 => 2,
            Surum::V3 => 3,
        }
    }

    pub fn coz(no: i64) -> Option<Surum> {
        Surum::HEPSI.into_iter().find(|s| s.no() == no)
    }

    /// JSON sayısı bir sürüm mü (JS `===` anlamı: `2.0` 2'dir, `2.5` hiçbiri).
    pub fn sayidan(n: &serde_json::Number) -> Option<Surum> {
        let f = n.as_f64()?;
        Surum::HEPSI.into_iter().find(|s| f == s.no() as f64)
    }

    /// Sürüm 3 ya da sonrası: v3 alanları, yetenekler ve ek çerçeveleri var.
    pub fn v3_mu(self) -> bool {
        self >= Surum::V3
    }

    /// Sürümün alan kümesi (`AJANDA_SURUM_ALANLARI`): `AjandaAlani::HEPSI`'nin öneki.
    pub fn alanlar(self) -> &'static [AjandaAlani] {
        match self {
            Surum::V2 => &AjandaAlani::HEPSI[..AjandaAlani::V2_ADEDI],
            Surum::V3 => AjandaAlani::HEPSI,
        }
    }
}

// Dondurulmuş ret zarfı ve geri düşüş

/// Dondurulmuş `error` zarfı (`AjandaDonmusHata`): `code` herhangi bir metindir (başka sürümün kümesi).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DonmusHata {
    pub v: i64,
    pub code: String,
    pub detail: Option<String>,
}

/// `ajandaDonmusHataOku`: `{v, type:"error", code, detail?}` (fazla alan yok; `v` 1'den küçük olmayan
/// güvenli tam sayı; `code` ve `detail` metin) sürüm kümesinden bağımsız okunur; uymuyorsa (JSON değil,
/// çerçeve sınırını aşıyor, başka tür) `None`.
pub fn ajanda_donmus_hata_oku(ham: &str) -> Option<DonmusHata> {
    if ham.len() > AZAMI_CERCEVE_KANAL && utf16_uzunluk(ham) > AZAMI_CERCEVE_KANAL {
        return None;
    }
    let deger: Value = serde_json::from_str(ham).ok()?;
    let mut n = Nesne::ac(&deger, "").ok()?;
    let v = n.zorunlu("v", |v, y| tam_sayi(v, y, 1, GUVENLI_TAM_SAYI)).ok()?;
    n.zorunlu("type", |v, y| metin_sabiti(v, y, "error")).ok()?;
    let code = n.zorunlu("code", |v, y| metin(v, y).map(str::to_string)).ok()?;
    let detail = n.istege_bagli("detail", |v, y| metin(v, y).map(str::to_string)).ok()?;
    n.bitir().ok()?;
    Some(DonmusHata { v, code, detail })
}

/// `ajandaRetSurumuOku`: dondurulmuş zarf ve `code` `protokol_uyumsuz` ise `v` (servisin en yüksek sürümü).
pub fn ajanda_ret_surumu_oku(ham: &str) -> Option<i64> {
    ajanda_donmus_hata_oku(ham).filter(|h| h.code == "protokol_uyumsuz").map(|h| h.v)
}

/// `protokol_uyumsuz` sonrası istemcinin kararı (`AjandaGeriDususu`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeriDusus {
    YenidenDene { surum: i64 },
    UygulamaEski,
    ServisEski,
    Bilinmiyor,
}

/// `ajandaGeriDusus(denenen, ret, kume)`. `ret`: ret çerçevesinden okunan sürüm (`ajanda_ret_surumu_oku`);
/// çerçeve yoksa ya da okunamadıysa (yalnız kapanış 1002) `None`. `kume`: istemcinin sürümleri (artan).
/// - `ret` okunduysa: kümede ve denenenden küçükse onunla yeniden; kümenin en büyüğünden büyükse uygulama
///   eski; en küçüğünden küçükse servis eski; başka hal bilinmiyor.
/// - `None`: kümede denenenden küçük en büyük sürümle yeniden; yoksa bilinmiyor.
pub fn ajanda_geri_dusus(denenen: i64, ret: Option<i64>, kume: &[i64]) -> GeriDusus {
    let (Some(&en_kucuk), Some(&en_buyuk)) = (kume.iter().min(), kume.iter().max()) else { return GeriDusus::Bilinmiyor };
    let Some(ret) = ret else {
        return kume.iter().copied().filter(|&s| s < denenen).max().map_or(GeriDusus::Bilinmiyor, |surum| GeriDusus::YenidenDene { surum });
    };
    if ret < denenen && kume.contains(&ret) {
        GeriDusus::YenidenDene { surum: ret }
    } else if ret > en_buyuk {
        GeriDusus::UygulamaEski
    } else if ret < en_kucuk {
        GeriDusus::ServisEski
    } else {
        GeriDusus::Bilinmiyor
    }
}

/// Alan listesinin sürümde olmayan adını reddeder (`AlanListesi` sürüme göre kurulur).
pub(crate) fn surumun_alani(a: AjandaAlani, s: Surum, yol: &str) -> super::json::Sonuc<AjandaAlani> {
    if s.alanlar().contains(&a) { Ok(a) } else { hata(yol, "kapalı listede yok") }
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn surum_kumesi_sabitlerle_ayni() {
        assert_eq!(Surum::HEPSI.map(Surum::no), AJANDA_SURUMLERI);
        assert_eq!(Surum::EN_YENI.no(), AJANDA_SURUMU);
        assert_eq!(*AJANDA_SURUMLERI.last().unwrap(), AJANDA_SURUMU);
        assert!(AJANDA_SURUMLERI.windows(2).all(|w| w[1] == w[0] + 1), "bitişik");
        assert_eq!(KANAL_SURUMU, Surum::V2, "kanal aşamasına dek bugünkü bağlantı");
        assert_eq!(Surum::V2.alanlar().len(), 7);
        assert_eq!(Surum::V3.alanlar().len(), 13);
        assert_eq!(&Surum::V3.alanlar()[..7], Surum::V2.alanlar(), "eski küme yeninin öneki");
    }

    #[test]
    fn sayidan_js_esitligi() {
        let n = |s: &str| serde_json::from_str::<serde_json::Number>(s).unwrap();
        assert_eq!(Surum::sayidan(&n("2")), Some(Surum::V2));
        assert_eq!(Surum::sayidan(&n("3.0")), Some(Surum::V3));
        assert_eq!(Surum::sayidan(&n("2.5")), None);
        assert_eq!(Surum::sayidan(&n("1")), None);
        assert_eq!(Surum::sayidan(&n("4")), None);
    }

    #[test]
    fn bos_kume_bilinmiyor() {
        assert_eq!(ajanda_geri_dusus(3, Some(2), &[]), GeriDusus::Bilinmiyor);
        assert_eq!(ajanda_geri_dusus(3, None, &[]), GeriDusus::Bilinmiyor);
    }

    #[test]
    fn donmus_hata_sinir_ve_buyuk_v() {
        // `v` güvenli tam sayı sınırında kabul, üstünde değil; çerçeve sınırını aşan metin okunmaz.
        assert_eq!(ajanda_donmus_hata_oku(r#"{"v":9007199254740991,"type":"error","code":"x"}"#).map(|h| h.v), Some(GUVENLI_TAM_SAYI));
        assert_eq!(ajanda_donmus_hata_oku(r#"{"v":9007199254740992,"type":"error","code":"x"}"#), None);
        let buyuk = format!(r#"{{"v":3,"type":"error","code":"x","detail":"{}"}}"#, "a".repeat(AZAMI_CERCEVE_KANAL));
        assert_eq!(ajanda_donmus_hata_oku(&buyuk), None);
        assert_eq!(ajanda_ret_surumu_oku(r#"{"v":2.0,"type":"error","code":"protokol_uyumsuz"}"#), Some(2), "2.0 tam sayıdır");
    }
}
