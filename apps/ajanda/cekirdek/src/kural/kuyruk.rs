//! SAHİBİ: R2. Uygulamanın işlem kuyruğu kararı (`ajanda-kural.ts` `ajandaKuyrukKarari`).
//! Motor (`motor::kanal`) kuyruğun başındaki işlemle ne yapacağını buna sorar. Vektör: `kuyruk_karari`.

use super::yazilmadi;
use crate::model::{AjandaRetNedeni, KuyrukRetNedeni};

/// Kuyruğun başındaki işlemin başına gelen. `Kopma`: yollandı, sonucu gelmeden koptu (yollanmadan
/// kopmak olay değildir). `TamTelafi`: `welcome.tam` geldi.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KuyrukOlayi {
    SonucOk,
    SonucRet(AjandaRetNedeni),
    Kopma,
    TamTelafi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KuyrukKarari {
    /// Kuyruktan çıkar; iyimser değişiklik `kayit` gelince yerini gerçeğe bırakır.
    Cikar,
    /// Başta kalır, `deneme` kalıcı saklanır, aynı `islem_id` ile yeniden yollanır.
    Bekle { deneme: u32 },
    /// Kuyruktan çıkar, iyimser değişiklik geri alınır, kullanıcının ret listesine geçer.
    RetListesi { neden: KuyrukRetNedeni },
}

/// Başarı çıkarır; kalıcı ret ret listesine; geçici ret ve kopma denemeyi artırır, `ISLEM_DENEME`'de
/// ret listesi (`ic_hata` / `teslim_edilemedi`); tam telafi hiçbir şeyi değiştirmez.
pub fn ajanda_kuyruk_karari(olay: KuyrukOlayi, deneme: u32) -> KuyrukKarari {
    let _ = (olay, deneme);
    yazilmadi!("kural::kuyruk::ajanda_kuyruk_karari (R2)")
}
