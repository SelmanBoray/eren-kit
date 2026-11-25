//! SAHİBİ: R3 (hatırlatma planı). Alarm planını Android'e uygular: görünen kopyadaki kayıtlar
//! (`Depo::gorunen_kayit`, `Depo::etkin_kayitlar`) + `kural::hatirlatma` + kurulu alarmlar
//! (`depo/alarmlar.rs`) -> `Etkiler.alarm_kur` / `alarm_iptal` / `kacirilan`.
//! Kurulum stratejisi (hangi AlarmManager çağrısı) burada değil Kotlin `AlarmKabugu`'ndadır.

use super::{Etkiler, Motor, Ortam};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{HatirlatmaBildirimi, YenidenKurmaNedeni};

impl Motor {
    /// R4'ün her görünen kopya değişikliğinden sonra çağırdığı giriş: yalnız bu kayıtların alarmlarını
    /// plana göre düzeltir (yeni tetik kur, artık olmayanı iptal et ve sil, kaçırılanı göster).
    /// `kayitlar` boşsa bütün kopya (tam telafinin sonu). Kilit altında, etkileri `e`'ye yazar.
    pub(crate) fn alarm_senkronu(&mut self, o: &Ortam, e: &mut Etkiler, kayitlar: &[String]) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, kayitlar);
        Err(CekirdekHatasi::yazilmadi("motor::alarm::alarm_senkronu (R3)"))
    }

    /// Açılış, saat/dilim değişimi, paket güncellemesi, uygulama açılışı: bütün alarmları yeniden kur.
    pub(crate) fn alarmlari_yeniden_kur(&mut self, o: &Ortam, e: &mut Etkiler, neden: YenidenKurmaNedeni) -> Result<(), CekirdekHatasi> {
        let _ = (o, e, neden);
        Err(CekirdekHatasi::yazilmadi("motor::alarm::alarmlari_yeniden_kur (R3)"))
    }

    /// Alarm çaldı: hâlâ geçerliyse bildirim içeriği (teslim edildi işaretlenir; tekrarda sıradaki kurulur),
    /// değilse `None` (kayıt arada değişti ya da silindi: susar).
    pub(crate) fn alarm_caldi(&mut self, o: &Ortam, e: &mut Etkiler, alarm_no: i64) -> Result<Option<HatirlatmaBildirimi>, CekirdekHatasi> {
        let _ = (o, e, alarm_no);
        Err(CekirdekHatasi::yazilmadi("motor::alarm::alarm_caldi (R3)"))
    }

    /// Köprü `AlarmKabugu.kur` başarısız olunca çağırır: kurulu sayılmasın.
    pub(crate) fn alarm_kurulamadi(&mut self, alarm_no: i64, neden: &str) -> Result<(), CekirdekHatasi> {
        let _ = (alarm_no, neden);
        Err(CekirdekHatasi::yazilmadi("motor::alarm::alarm_kurulamadi (R3)"))
    }
}
