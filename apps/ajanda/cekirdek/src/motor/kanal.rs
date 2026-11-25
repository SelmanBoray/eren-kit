//! SAHİBİ: R4. `/ajanda` kanal durum makinesi (sans-IO). Akış `docs/AJANDA.md` "Kanal akışı":
//! eşleşme yoksa `pair_request`; varsa `hello` -> `auth_challenge` (PC imzasını `KimlikKabugu.dogrula`)
//! -> `auth_response` (`KimlikKabugu.imzala`) -> `welcome` -> telafi (`kayit`...`esitlendi`) -> canlı;
//! `esitlendi`'den sonra kuyruk birer birer. Kurallar: `kural::{esitleme, kuyruk, birlesim, ornek}`.
//! Her görünen kopya değişikliğinden sonra `self.alarm_senkronu(...)` (R3) çağrılır.

use super::{Etkiler, Motor, Ortam};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::BaglantiDurumu;

impl Motor {
    /// Soket açıldı (köprü taşımayı kaydetti). Eşleştirme bekliyorsa `pair_request`, eşleşmişse `hello`.
    pub(crate) fn baglanti_acildi(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        let _ = (o, e);
        Err(CekirdekHatasi::yazilmadi("motor::kanal::baglanti_acildi (R4)"))
    }

    /// Gelen metin çerçevesi (`ajanda_asagi_coz`'dan geçirilir; geçersizse kapat).
    pub(crate) fn cerceve_geldi(&mut self, o: &Ortam, e: &mut Etkiler, metin: &str) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, metin);
        Err(CekirdekHatasi::yazilmadi("motor::kanal::cerceve_geldi (R4)"))
    }

    /// Soket kapandı: süren tam telafi atılır, yollanmış işlem `Kopma` sayılır (`kural::kuyruk`).
    pub(crate) fn baglanti_kapandi(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        let _ = (o, e);
        Err(CekirdekHatasi::yazilmadi("motor::kanal::baglanti_kapandi (R4)"))
    }

    pub(crate) fn baglanti_durumu(&self) -> Result<BaglantiDurumu, CekirdekHatasi> {
        Err(CekirdekHatasi::yazilmadi("motor::kanal::baglanti_durumu (R4)"))
    }
}
