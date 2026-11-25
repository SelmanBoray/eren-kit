//! SAHİBİ: R4. Arayüz sorguları (görünen kopyadan: `depo::gorunen`) ve geçmiş isteği.

use super::{Etkiler, Motor, Ortam};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{GecmisSayfasi, KayitGorunumu, ListeSorgusu, RetGirdisi};

impl Motor {
    pub(crate) fn liste(&self, sorgu: &ListeSorgusu) -> Result<Vec<KayitGorunumu>, CekirdekHatasi> {
        let _ = sorgu;
        Err(CekirdekHatasi::yazilmadi("motor::sorgu::liste (R4)"))
    }

    pub(crate) fn kayit(&self, kayit_id: &str) -> Result<Option<KayitGorunumu>, CekirdekHatasi> {
        let _ = kayit_id;
        Err(CekirdekHatasi::yazilmadi("motor::sorgu::kayit (R4)"))
    }

    pub(crate) fn ret_listesi(&self) -> Result<Vec<RetGirdisi>, CekirdekHatasi> {
        Err(CekirdekHatasi::yazilmadi("motor::sorgu::ret_listesi (R4)"))
    }

    /// Canlıysa `gecmis_iste` yollar (yoksa `GecersizDurum`); yanıt `gecmis` çerçevesiyle gelir,
    /// önbelleğe yazılır, gözlemciye `Degisim.gecmis` ile haber verilir.
    pub(crate) fn gecmis_iste(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str, once_rev: Option<i64>) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, kayit_id, once_rev);
        Err(CekirdekHatasi::yazilmadi("motor::sorgu::gecmis_iste (R4)"))
    }

    /// Önbellekteki geçmiş (bellek içi; süreç ölünce gider).
    pub(crate) fn gecmis(&self, kayit_id: &str) -> Result<Option<GecmisSayfasi>, CekirdekHatasi> {
        let _ = kayit_id;
        Err(CekirdekHatasi::yazilmadi("motor::sorgu::gecmis (R4)"))
    }
}
