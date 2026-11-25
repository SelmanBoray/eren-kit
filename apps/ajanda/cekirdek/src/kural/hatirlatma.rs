//! SAHİBİ: R3 (hatırlatma planı). `ajanda-kural.ts` `hatirlatmaHalleri`, `kurulacakHatirlatmalar`,
//! `kacirilanHatirlatmalar`, `hatirlatmaOzeti`. Saf kurallardır; Android'e alarm kurdurmak
//! `motor::alarm`'ın (aynı sahip) işidir. Vektör: `hatirlatma_plani.vakalar`, `hatirlatma_plani.kacirilan`.
//! Etkinlik: `AjandaKaydi::hatirlatma_etkin_mi` (modelde, `hatirlatma_etkin` vektörü geçer).

use super::{AnCevirici, ZamanHatasi, yazilmadi};
use crate::model::AjandaKaydi;

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

/// Her hatırlatmanın hali (etkinlikten bağımsız). Çeviri hatası (bilinmeyen dilim) çağırana döner.
pub fn hatirlatma_halleri(
    kayit: &AjandaKaydi,
    simdi_ms: i64,
    an: &dyn AnCevirici,
) -> Result<Vec<HatirlatmaHali>, ZamanHatasi> {
    let _ = (kayit, simdi_ms, an);
    yazilmadi!("kural::hatirlatma::hatirlatma_halleri (R3)")
}

/// `hatirlatma_etkin_mi` doğruysa `Kurulur` halindekiler, değilse hiçbiri.
pub fn kurulacak_hatirlatmalar(
    kayit: &AjandaKaydi,
    simdi_ms: i64,
    an: &dyn AnCevirici,
) -> Result<Vec<HatirlatmaTetigi>, ZamanHatasi> {
    let _ = (kayit, simdi_ms, an);
    yazilmadi!("kural::hatirlatma::kurulacak_hatirlatmalar (R3)")
}

/// Tetiği `(şimdi − KACIRILAN_PENCERE_DK, şimdi]` içinde olan ve `kurulanlar`da (bu kayıt için kurulup
/// teslim edilmemiş tetikler) bulunan her tetik; etkin değilse hiçbiri. Tekrarda kapalı örnek atlanır.
pub fn kacirilan_hatirlatmalar(
    kayit: &AjandaKaydi,
    simdi_ms: i64,
    an: &dyn AnCevirici,
    kurulanlar: &[i64],
) -> Result<Vec<HatirlatmaTetigi>, ZamanHatasi> {
    let _ = (kayit, simdi_ms, an, kurulanlar);
    yazilmadi!("kural::hatirlatma::kacirilan_hatirlatmalar (R3)")
}

/// `kurulacak` etkinlik dahil; öteki sayılar etkinlikten bağımsız.
pub fn hatirlatma_ozeti(kayit: &AjandaKaydi, simdi_ms: i64, an: &dyn AnCevirici) -> Result<HatirlatmaOzeti, ZamanHatasi> {
    let _ = (kayit, simdi_ms, an);
    yazilmadi!("kural::hatirlatma::hatirlatma_ozeti (R3)")
}
