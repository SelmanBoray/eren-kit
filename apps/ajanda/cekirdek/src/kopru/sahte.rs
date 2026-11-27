//! Yalnız testler: geri çağrı arayüzlerinin Rust'taki sahteleri. R3 ve R4 birim testleri `Motor`'u ya da
//! bütün `Cekirdek`'i bunlarla sürer (Kotlin'siz). Dosya ilk dalgada dondurulur; eksik gelirse kendi
//! test modülünde ek sahte yaz.

#![allow(dead_code)]

use std::sync::Mutex;
use std::sync::atomic::{AtomicI64, Ordering};

use crate::hata::KabukHatasi;
use crate::kural::{AnCevirici, SabitOfsetCevirici};
use crate::model::YerelAn;

use super::kabuklar::{AlarmKabugu, Gozlemci, KimlikKabugu, Tasima, ZamanKabugu};
use super::tipler::{Degisim, KacirilanBildirimi, KurulacakAlarm};

/// İmza = verinin tersi; doğrulama = imza verinin tersi mi; rastgele = artan sayaç baytları.
#[derive(Default)]
pub struct SahteKimlik {
    sayac: Mutex<u8>,
}

impl KimlikKabugu for SahteKimlik {
    fn acik_anahtar(&self) -> Result<Vec<u8>, KabukHatasi> {
        Ok(vec![4; 65])
    }
    fn imzala(&self, mut veri: Vec<u8>) -> Result<Vec<u8>, KabukHatasi> {
        veri.reverse();
        Ok(veri)
    }
    fn dogrula(&self, _acik: Vec<u8>, mut veri: Vec<u8>, imza: Vec<u8>) -> Result<bool, KabukHatasi> {
        veri.reverse();
        Ok(veri == imza)
    }
    fn rastgele(&self, uzunluk: u32) -> Result<Vec<u8>, KabukHatasi> {
        let mut s = self.sayac.lock().unwrap();
        Ok((0..uzunluk)
            .map(|_| {
                *s = s.wrapping_add(1);
                *s
            })
            .collect())
    }
    fn anahtari_sil(&self) -> Result<(), KabukHatasi> {
        Ok(())
    }
}

/// Ayarlanabilir saat; dilimler sabit ofsetli: `UTC` 0, `Etc/GMT-3` ve `Europe/Istanbul` +180 dk.
pub struct SahteZaman {
    pub simdi: AtomicI64,
    cevirici: SabitOfsetCevirici,
}

impl SahteZaman {
    pub fn yeni(simdi_ms: i64) -> Self {
        SahteZaman {
            simdi: AtomicI64::new(simdi_ms),
            cevirici: SabitOfsetCevirici::yeni([("UTC", 0), ("Etc/GMT-3", 180), ("Europe/Istanbul", 180)]),
        }
    }
    pub fn ayarla(&self, simdi_ms: i64) {
        self.simdi.store(simdi_ms, Ordering::SeqCst);
    }
}

impl ZamanKabugu for SahteZaman {
    fn simdi_ms(&self) -> i64 {
        self.simdi.load(Ordering::SeqCst)
    }
    fn cihaz_dilimi(&self) -> String {
        "Europe/Istanbul".into()
    }
    fn yerelden_ana(&self, tarih: String, saat: String, saat_dilimi: String) -> Result<i64, KabukHatasi> {
        self.cevirici.ana_cevir(&tarih, &saat, &saat_dilimi).map_err(|e| KabukHatasi::Basarisiz { mesaj: e.mesaj })
    }
    fn andan_yerele(&self, an_ms: i64, saat_dilimi: String) -> Result<YerelAn, KabukHatasi> {
        self.cevirici.yerele_cevir(an_ms, &saat_dilimi).map_err(|e| KabukHatasi::Basarisiz { mesaj: e.mesaj })
    }
}

/// Kurulan, iptal edilen alarmları ve kaçırılan bildirimlerini kaydeder.
#[derive(Default)]
pub struct SahteAlarm {
    pub kurulan: Mutex<Vec<KurulacakAlarm>>,
    pub iptal: Mutex<Vec<i64>>,
    pub kacirilan: Mutex<Vec<KacirilanBildirimi>>,
}

impl AlarmKabugu for SahteAlarm {
    fn kur(&self, alarm: KurulacakAlarm) -> Result<(), KabukHatasi> {
        self.kurulan.lock().unwrap().push(alarm);
        Ok(())
    }
    fn iptal(&self, alarm_no: i64) -> Result<(), KabukHatasi> {
        self.iptal.lock().unwrap().push(alarm_no);
        Ok(())
    }
    fn kacirilanlari_goster(&self, bildirim: KacirilanBildirimi) -> Result<(), KabukHatasi> {
        self.kacirilan.lock().unwrap().push(bildirim);
        Ok(())
    }
}

/// Yollanan çerçeveleri ve kapatma nedenini kaydeder.
#[derive(Default)]
pub struct SahteTasima {
    pub giden: Mutex<Vec<String>>,
    pub kapatildi: Mutex<Option<String>>,
}

impl Tasima for SahteTasima {
    fn gonder(&self, metin: String) -> bool {
        self.giden.lock().unwrap().push(metin);
        true
    }
    fn kapat(&self, neden: String) {
        *self.kapatildi.lock().unwrap() = Some(neden);
    }
}

#[derive(Default)]
pub struct SahteGozlemci {
    pub gelen: Mutex<Vec<Degisim>>,
}

impl Gozlemci for SahteGozlemci {
    fn degisti(&self, degisim: Degisim) {
        self.gelen.lock().unwrap().push(degisim);
    }
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::kopru::Cekirdek;
    use std::sync::Arc;

    /// Köprü kabuğu Rust'tan da sürülebilir. Eşleşme yokken bağlantı açılamaz, hiçbir şey yollanmaz.
    #[test]
    fn cekirdek_sahtelerle_acilir() {
        let c = Cekirdek::ac(
            ":memory:".into(),
            Arc::new(SahteKimlik::default()),
            Arc::new(SahteZaman::yeni(1_795_606_200_000)),
            Arc::new(SahteAlarm::default()),
        )
        .unwrap();
        assert_eq!(c.sema_surumu().unwrap(), 4);
        assert_eq!(c.kip().unwrap(), crate::kopru::tipler::CalismaKipi::Yerel, "yeni kurulum yerel kipte açılır");
        let t = Arc::new(SahteTasima::default());
        assert!(matches!(c.baglanti_acildi(t.clone()), Err(crate::CekirdekHatasi::Eslesme { .. })));
        assert!(t.giden.lock().unwrap().is_empty());
        assert_eq!(crate::kopru::metni_temizle("a\u{200b}".into()).unwrap(), "a");
    }
}
