//! SAHİBİ: R4 (yerel depo ve eşitleme motoru); `alarm.rs` R3'ündür.
//!
//! Motor, köprünün (`kopru`) çağırdığı iş mantığıdır: kanal durum makinesi (sans-IO: çerçeve girer,
//! `Etkiler.gonderilecek` çıkar; soket Kotlin'dedir), iyimser işlem ve kuyruk, görünen kopya, sorgular,
//! alarm planının uygulanması. Tek `Mutex<Motor>` altında, eşzamanlı çalışır.
//!
//! Etki kuralı: motor yan etkiyi (çerçeve yollama, alarm kurma, gözlemci) kendisi yapmaz; `Etkiler`'e
//! yazar. Köprü kilit bırakıldıktan sonra sırasıyla uygular (bkz. `kopru::Cekirdek::calistir`). Motor
//! yalnız kalıcı hale (SQLite işlemi tamamlanmış) karşılık gelen etkiyi yazar; `Err` dönen çağrının
//! etkileri yine uygulanır, o yüzden hatadan önce yazılmış etki gerçek olmalıdır.
//!
//! Dosyalar: `kanal.rs` (bağlantı, telafi, kuyruğun yollanması ve sonuçları), `islem.rs` (kullanıcı
//! işlemleri), `iyimser.rs` (görünen kopyanın hesabı), `yerel.rs` (yerel kipin yazarı ve geçmişi), `aktarma.rs`
//! (D3 dışa ve içe aktarma), `eslesme.rs`, `sorgu.rs`, `alarm.rs` (R3).
//!
//! Değişiklik yayma kuralı (`gorunenler_degisti`): görünen kopyası değişen kayıtlar, yazan SQLite işlemi
//! kalıcı olduktan SONRA R3'ün `alarm_senkronu`'na verilir ve `Degisim.kayitlar`'a bir kez girer. Tam
//! telafinin sonunda bütün kopya için `alarm_senkronu(&[])` ve `Degisim.tumu`.

pub(crate) mod alarm;
mod aktarma;
mod eslesme;
mod islem;
mod iyimser;
mod kanal;
mod yerel;
pub(crate) mod sorgu;
pub(crate) mod takvim;

use std::collections::BTreeMap;

use crate::depo::Depo;
use crate::hata::CekirdekHatasi;
use crate::kopru::kabuklar::{KabukCevirici, KimlikKabugu, ZamanKabugu};
use crate::kopru::tipler::{Degisim, GecmisSayfasi, KacirilanBildirimi, KurulacakAlarm};
use crate::model::AjandaKanalHatasi;
use crate::model::kanonik::base64url_yaz;

pub use alarm::ALARM_BUTCESI;
pub(crate) use aktarma::aktarma_bicimi;
pub(crate) use kanal::Asama;

/// Kotlin'in eşzamanlı sağladığı platform hizmetleri (motor kilidi altında çağrılabilir).
pub(crate) struct Ortam<'a> {
    pub kimlik: &'a dyn KimlikKabugu,
    pub zaman: &'a dyn ZamanKabugu,
}

impl<'a> Ortam<'a> {
    pub fn simdi_ms(&self) -> i64 {
        self.zaman.simdi_ms()
    }

    /// Kuralların `AnCevirici`'si (java.time).
    pub fn cevirici(&self) -> KabukCevirici<'a> {
        KabukCevirici(self.zaman)
    }
}

/// Bir çağrının dış dünyaya etkileri; köprü kilit dışında, bu sırayla uygular:
/// `gonderilecek` (açık taşımaya, aynı bağlantı neslindeyse), `kapat`, `alarm_iptal`, `alarm_kur`,
/// `kacirilan`, `degisim` (gözlemcilere, boş değilse).
#[derive(Debug, Default)]
pub(crate) struct Etkiler {
    pub gonderilecek: Vec<String>,
    pub kapat: Option<String>,
    pub alarm_iptal: Vec<i64>,
    pub alarm_kur: Vec<KurulacakAlarm>,
    pub kacirilan: Option<KacirilanBildirimi>,
    pub degisim: Degisim,
}

impl Etkiler {
    /// `Degisim.kayitlar`'a tekrarsız ekler.
    pub(crate) fn kayit_degisti(&mut self, kayit_id: &str) {
        if !self.degisim.kayitlar.iter().any(|k| k == kayit_id) {
            self.degisim.kayitlar.push(kayit_id.to_string());
        }
    }
}

/// Telafide `kayit` çerçeveleri bu sayıda birikince tek SQLite işlemiyle yazılır (servis sayfası 200).
/// Her çerçeveyi ayrı işlemde yazmak her biri için bir fsync demektir; telafi binlerce kayıt taşıyabilir.
pub(crate) const TELAFI_TAMPONU: usize = 200;

pub(crate) struct Motor {
    pub(crate) depo: Depo,
    /// Bağlantının aşaması (bellek içi: süreç ölünce bağlantı da yoktur).
    asama: Asama,
    /// Son kanal hatası (`error` çerçevesi, imza reddi, protokol hatası); `esitlendi`'de temizlenir.
    son_hata: Option<AjandaKanalHatasi>,
    /// `son_hata` `protokol_uyumsuz` iken karşı tarafın hangi yönde farklı olduğu (v2); onunla temizlenir.
    surum_uyusmazligi: Option<crate::kopru::tipler::SurumUyusmazligi>,
    /// Bağlantının sürümü, düşülen sürüm, `welcome.yetenekler` (`kanal.rs` "Sürüm uyumu").
    surum: kanal::KanalSurumu,
    /// Geçmiş önbelleği (`kayit_id` -> sayfa) ve yanıt bekleyen istekler (`istek_id` -> (`kayit_id`, yollandığı
    /// an ms); an yukarı denemenin bekleme süresi içindir: `kanal.rs` `GECMIS_BEKLEME_MS`).
    gecmis: BTreeMap<String, GecmisSayfasi>,
    gecmis_istekleri: BTreeMap<String, (String, i64)>,
}

impl Motor {
    pub(crate) fn ac(veritabani_yolu: &str) -> Result<Motor, CekirdekHatasi> {
        let depo = Depo::ac(veritabani_yolu)?;
        // Önceki süreçte yarıda kalmış tam telafinin toplananları geçersizdir (bağlantı yok artık).
        depo.telafiyi_sil()?;
        Ok(Motor {
            depo,
            asama: Asama::Kopuk,
            son_hata: None,
            surum_uyusmazligi: None,
            surum: kanal::KanalSurumu::yeni(),
            gecmis: BTreeMap::new(),
            gecmis_istekleri: BTreeMap::new(),
        })
    }

    pub(crate) fn sema_surumu(&self) -> Result<i64, CekirdekHatasi> {
        Ok(self.depo.sema_surumu()?)
    }

    /// `onek` + 16 güvenli rastgele baytın base64url'i (`k_`, `i_`, `g_` önekli `OpakId`, 24 karakter).
    pub(crate) fn yeni_kimlik(o: &Ortam, onek: &str) -> Result<String, CekirdekHatasi> {
        let baytlar = o.kimlik.rastgele(16)?;
        if baytlar.len() != 16 {
            return Err(CekirdekHatasi::KabukCagrisi { mesaj: "rastgele: beklenen uzunlukta değil".into() });
        }
        Ok(format!("{onek}{}", base64url_yaz(&baytlar)))
    }

    /// İyimser uygulamanın bağlamı (eşleşmenin `device_id`'si, şimdi, çevirici).
    pub(crate) fn iyimser_baglam<'a>(
        &self,
        o: &Ortam,
        cevirici: &'a dyn crate::kural::AnCevirici,
    ) -> Result<iyimser::IyimserBaglam<'a>, CekirdekHatasi> {
        let device_id = self.eslesme_oku()?.map(|e| e.device_id).unwrap_or_else(|| iyimser::YER_TUTUCU_CIHAZ.to_string());
        Ok(iyimser::IyimserBaglam {
            device_id,
            simdi_ms: o.simdi_ms(),
            cihaz_dilimi: o.zaman.cihaz_dilimi(),
            cevirici,
        })
    }

    /// Görünen kopyası değişen kayıtları yayar (SQLite işlemi kalıcı olduktan sonra çağrılır): alarm
    /// planı (R3) ve gözlemci. Alarm senkronunun hatası yutulur: kayıt değişikliği zaten kalıcıdır ve
    /// çağıran işlem başarılı dönmelidir (yoksa arayüz yeniden dener, işlem çift olur); plan sonraki
    /// senkronda ya da yeniden kurulumda düzelir.
    pub(crate) fn gorunenler_degisti(&mut self, o: &Ortam, e: &mut Etkiler, kayitlar: &[String]) {
        if kayitlar.is_empty() {
            return;
        }
        for k in kayitlar {
            e.kayit_degisti(k);
        }
        let _ = self.alarm_isleminde(o, e, |m, o, e| m.alarm_senkronu(o, e, kayitlar));
    }

    /// Bütün görünen kopya değişti (tam telafinin sonu).
    pub(crate) fn hepsi_degisti(&mut self, o: &Ortam, e: &mut Etkiler) {
        e.degisim.tumu = true;
        let _ = self.alarm_isleminde(o, e, |m, o, e| m.alarm_senkronu(o, e, &[]));
    }

    /// R3'ün alarm işini (kayıt başına savepoint) TEK SQLite işleminde çalıştırır ve etkilerini ancak işlem
    /// kalıcı olunca `e`'ye katar. Dış işlem olmadan her savepoint ayrı, kalıcı (fsync'li) bir işlemdir:
    /// binlerce kayıtlık tam eşitlemenin sonunda bu, saniyeler demekti (ölçüm: `tests/buyuk_kopya.rs`).
    /// Hata ya da panikte hepsi geri alınır ve hiçbir alarm etkisi yazılmaz (kur/iptal gerçek hale uyar).
    pub(crate) fn alarm_isleminde<T>(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        f: impl FnOnce(&mut Motor, &Ortam, &mut Etkiler) -> Result<T, CekirdekHatasi>,
    ) -> Result<T, CekirdekHatasi> {
        let mut ayri = Etkiler::default();
        self.depo.islem_baslat()?;
        let sonuc = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(self, o, &mut ayri)));
        match sonuc {
            Ok(Ok(t)) => match self.depo.islem_bitir() {
                Ok(()) => {
                    alarm::alarm_etkilerini_kat(e, ayri);
                    Ok(t)
                }
                Err(h) => {
                    self.depo.islem_geri_al();
                    Err(h)
                }
            },
            Ok(Err(h)) => {
                self.depo.islem_geri_al();
                Err(h)
            }
            Err(yuk) => {
                self.depo.islem_geri_al();
                std::panic::resume_unwind(yuk)
            }
        }
    }
}

#[cfg(test)]
mod testler;
#[cfg(test)]
mod v3_testleri;
#[cfg(test)]
mod erteleme_testleri;
