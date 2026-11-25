//! SAHİBİ: R4. Eşleşme bilgisinin saklanması (`meta`): QR, `device_id`, sunucu açık anahtarı.
//! QR'ın doğrulanması modeldedir (`AjandaEslestirmeQr`); imza ve anahtar `KimlikKabugu`'ndadır.

use super::{Etkiler, Motor, Ortam};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::EslesmeDurumu;
use crate::model::AjandaEslestirmeQr;

impl Motor {
    /// QR okundu: eşleştirme bekler (sonraki `baglanti_acildi` `pair_request` yollar). Var olan eşleşme
    /// ve sunucu kopyası değişmez; eşleştirme başarıyla bitince eski eşleşmenin yerine geçer.
    pub(crate) fn eslestirme_baslat(&mut self, o: &Ortam, e: &mut Etkiler, qr: AjandaEslestirmeQr) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, qr);
        Err(CekirdekHatasi::yazilmadi("motor::eslesme::eslestirme_baslat (R4)"))
    }

    pub(crate) fn eslesme_durumu(&self) -> Result<EslesmeDurumu, CekirdekHatasi> {
        Err(CekirdekHatasi::yazilmadi("motor::eslesme::eslesme_durumu (R4)"))
    }

    /// Eşleşmeyi, sunucu kopyasını, kuyruğu ve alarmları siler; cihaz anahtarını `anahtari_sil` ile siler.
    pub(crate) fn eslesmeyi_kaldir(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        let _ = (o, e);
        Err(CekirdekHatasi::yazilmadi("motor::eslesme::eslesmeyi_kaldir (R4)"))
    }

    /// Açılacak adres (`ws://<tailscale>:<port>/ajanda`); eşleşme ve bekleyen eşleştirme yoksa `None`.
    pub(crate) fn baglanti_adresi(&self) -> Result<Option<String>, CekirdekHatasi> {
        Err(CekirdekHatasi::yazilmadi("motor::eslesme::baglanti_adresi (R4)"))
    }
}
