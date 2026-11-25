//! SAHİBİ: R4. Arayüzden gelen işlemler: iyimser uygula (görünen kopya), kalıcı kuyruğa koy, canlıysa
//! ve sırası geldiyse yolla. `docs/AJANDA.md` "Kanal akışı" 4-5. Metin: `kural::metin::govdeyi_hazirla`;
//! birleştirme: `kural::birlesim`; örnek: `kural::ornek` (`bugun` kaydın dilimindeki yerel gün,
//! `Ortam::cevirici().yerele_cevir`). Kimlikler `KimlikKabugu.rastgele` + `model::kanonik::base64url_yaz`.

use super::{Etkiler, Motor, Ortam};
use crate::hata::CekirdekHatasi;
use crate::model::{GirdiYolu, KayitDurumu, KayitGovdesi};

impl Motor {
    /// Yeni kayıt; döner: üretilen `kayit_id`.
    pub(crate) fn ekle(&mut self, o: &Ortam, e: &mut Etkiler, govde: KayitGovdesi, girdi_yolu: GirdiYolu) -> Result<String, CekirdekHatasi> {
        let _ = (o, e, govde, girdi_yolu);
        Err(CekirdekHatasi::yazilmadi("motor::islem::ekle (R4)"))
    }

    /// Formun tam gövdesi: görünen halle farkı `guncelle` işlemine çevrilir (fark yoksa hiçbir şey).
    pub(crate) fn duzenle(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str, govde: KayitGovdesi) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, kayit_id, govde);
        Err(CekirdekHatasi::yazilmadi("motor::islem::duzenle (R4)"))
    }

    pub(crate) fn durum_degistir(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        kayit_id: &str,
        durum: KayitDurumu,
        ornek_tarihi: Option<String>,
    ) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, kayit_id, durum, ornek_tarihi);
        Err(CekirdekHatasi::yazilmadi("motor::islem::durum_degistir (R4)"))
    }

    pub(crate) fn onayla(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, kayit_id);
        Err(CekirdekHatasi::yazilmadi("motor::islem::onayla (R4)"))
    }

    pub(crate) fn sil(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, kayit_id);
        Err(CekirdekHatasi::yazilmadi("motor::islem::sil (R4)"))
    }

    pub(crate) fn geri_yukle(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, kayit_id);
        Err(CekirdekHatasi::yazilmadi("motor::islem::geri_yukle (R4)"))
    }

    /// Ret listesinden atar (kullanıcı vazgeçti ya da düzeltip yeniden ekledi).
    pub(crate) fn ret_at(&mut self, o: &Ortam, e: &mut Etkiler, islem_id: &str) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, islem_id);
        Err(CekirdekHatasi::yazilmadi("motor::islem::ret_at (R4)"))
    }
}
