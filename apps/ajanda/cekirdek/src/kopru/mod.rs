//! KÖPRÜ YÜZEYİ: Kotlin'in gördüğü her şey (`#[uniffi::export]`) yalnız `kopru/` altındadır ve ilk
//! dalgada dondurulur. Yöntemler ince kabuktur: kilidi alır, `Motor`'a devreder, etkileri kilit dışında
//! uygular. İş mantığı `motor/`, `kural/`, `model/`, `depo/`'dadır.
//!
//! İş parçacığı: her çağrı eşzamanlıdır (SQLite, Keystore) — Kotlin ana iş parçacığından çağırmaz.
//! Kilit sırası: motor -> taşıma (kısa) -> etki. Etkiler (çerçeve yollama, alarm, gözlemci) motor
//! kilidi bırakılınca, etki kilidi altında, üretildikleri sırayla uygulanır; bu yüzden iki çağrının
//! çerçeveleri sıra değiştiremez. Geri çağrılar Cekirdek'e eşzamanlı yeniden giremez (bkz. `kabuklar`).

pub mod kabuklar;
#[cfg(test)]
pub(crate) mod sahte;
pub mod tipler;

use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use crate::hata::CekirdekHatasi;
use crate::kural::Yazilmadi;
use crate::model::{AjandaEslestirmeQr, GirdiYolu, GunBolumu, Hatirlatma, KayitDurumu, KayitGovdesi};
use crate::motor::{Etkiler, Motor, Ortam};

use kabuklar::{AlarmKabugu, Gozlemci, KimlikKabugu, Tasima, ZamanKabugu};
use tipler::{
    AktarmaBicimi, BaglantiDurumu, CalismaKipi, DisaAktarma, DuzenlemeTemeli, EslesmeDurumu, GecisOzeti, GecmisSayfasi, HatirlatmaBildirimi,
    HatirlatmaOnizlemesi, IceAktarmaOnizlemesi, IceAktarmaSonucu, KayitGorunumu, KoparmaSonucu, ListeSorgusu, RetGirdisi, TakvimAyi, TakvimOgesi,
    YenidenKurmaNedeni,
};

fn kilitle<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // Zehirlenmiş kilit: önceki çağrı panikledi; SQLite işlemi geri alınmış olduğundan durum tutarlıdır.
    m.lock().unwrap_or_else(|z| z.into_inner())
}

/// Saf kural çağrısı: yazılmamış kuralın paniğini `CekirdekHatasi::Yazilmadi`'ya çevirir.
fn kural<T>(f: impl FnOnce() -> T) -> Result<T, CekirdekHatasi> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(t) => Ok(t),
        Err(yuk) => match yuk.downcast_ref::<Yazilmadi>() {
            Some(y) => Err(CekirdekHatasi::yazilmadi(y.0)),
            None => resume_unwind(yuk),
        },
    }
}

/// Çekirdek sürümü (köprünün yüklendiğini görmenin en kısa yolu).
#[uniffi::export]
pub fn cekirdek_surumu() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Gömülü SQLite sürümü (cihazınkinden bağımsız olduğunu göstermek için).
#[uniffi::export]
pub fn sqlite_surumu() -> String {
    rusqlite::version().to_string()
}

/// Elle ekleme ekranının açılış hatırlatmaları (`AJANDA_VARSAYILAN_HATIRLATMALAR`).
#[uniffi::export]
pub fn varsayilan_hatirlatmalar() -> Vec<Hatirlatma> {
    crate::model::varsayilan_hatirlatmalar()
}

/// Saatsiz gün kaydının gün hatırlatması saati (v2, `gunHatirlatmaSaati`): bölümün saati
/// (`GUN_HATIRLATMA_SAATLERI`), bölüm yoksa 09:00. Form bölüm seçeneklerinin yanında gösterir.
#[uniffi::export]
pub fn gun_hatirlatma_saati(gun_bolumu: Option<GunBolumu>) -> String {
    crate::model::gun_hatirlatma_saati(gun_bolumu).to_string()
}

/// QR'dan (ya da yapıştırılan metinden) okunan eşleştirme JSON'unu doğrular (`AjandaEslestirmeQr`:
/// `kanal:"ajanda"`, Tailscale adresi). Hata: `GecersizGirdi{alan, neden}`.
#[uniffi::export]
pub fn eslestirme_qr_coz(metin: String) -> Result<AjandaEslestirmeQr, CekirdekHatasi> {
    AjandaEslestirmeQr::coz(&metin)
        .map_err(|h| CekirdekHatasi::GecersizGirdi { alan: h.yol, neden: h.neden.to_string() })
}

/// Giriş temizliği (`ajandaMetniTemizle`): yazarken ya da yapıştırınca gizli karakterleri atar.
#[uniffi::export]
pub fn metni_temizle(metin: String) -> Result<String, CekirdekHatasi> {
    kural(|| crate::kural::metin::ajanda_metni_temizle(&metin))
}

/// Dışa aktarma kabının (zip) düzeni (D3): belge adı, ek dizini, biçim sürümü, boyut sınırları.
#[uniffi::export]
pub fn aktarma_bicimi() -> AktarmaBicimi {
    crate::motor::aktarma_bicimi()
}

/// Formu kabloya hazırlar ve doğrular (kaydetmeden önce alan hatasını göstermek için).
#[uniffi::export]
pub fn govdeyi_hazirla(govde: KayitGovdesi) -> Result<KayitGovdesi, CekirdekHatasi> {
    kural(|| crate::kural::metin::govdeyi_hazirla(govde))?.map_err(CekirdekHatasi::from)
}

/// Kabuğun başaramadığı etkiler: kurulamayan alarmlar (`alarm_no`, neden) ve gösterilemeyen kaçırılan özetinin
/// alarm numaraları.
#[derive(Default)]
struct BasarisizEtkiler {
    kurulamayan: Vec<(i64, String)>,
    gosterilemeyen: Vec<i64>,
}

/// Süreç başına bir tane açılır (Kotlin `CekirdekErisimi`). İş parçacığı güvenlidir.
#[derive(uniffi::Object)]
pub struct Cekirdek {
    motor: Mutex<Motor>,
    etki: Mutex<()>,
    kimlik: Arc<dyn KimlikKabugu>,
    zaman: Arc<dyn ZamanKabugu>,
    alarm: Arc<dyn AlarmKabugu>,
    /// Açık bağlantının nesli ve yazma ucu; motor kilidi altında değişir.
    tasima: Mutex<Option<(u64, Arc<dyn Tasima>)>>,
    nesil: AtomicU64,
    gozlemciler: Mutex<Vec<(u64, Arc<dyn Gozlemci>)>>,
    gozlemci_sayaci: AtomicU64,
    /// Arayüz sorgularının (`liste`, `kayit`, `ret_listesi`) ayrı okuma bağlantısı: motor kilidini almaz,
    /// uzun bir telafi yazması sürerken son kalıcı hali okur (WAL). Bellek içi veritabanında yok (motor okur).
    okuyucu: Option<Mutex<crate::depo::Depo>>,
}

impl Cekirdek {
    /// Motoru kilitler, `f`'i çalıştırır, etkileri kilit dışında sırayla uygular.
    fn calistir<T>(&self, f: impl FnOnce(&mut Motor, &Ortam, &mut Etkiler) -> Result<T, CekirdekHatasi>) -> Result<T, CekirdekHatasi> {
        let ortam = Ortam { kimlik: &*self.kimlik, zaman: &*self.zaman };
        let mut etkiler = Etkiler::default();
        let (sonuc, tasima, etki_kilidi) = {
            let mut motor = kilitle(&self.motor);
            let sonuc = catch_unwind(AssertUnwindSafe(|| f(&mut motor, &ortam, &mut etkiler)));
            let tasima = kilitle(&self.tasima).clone();
            (sonuc, tasima, kilitle(&self.etki))
        };
        let basarisiz = self.etkileri_uygula(etkiler, tasima.map(|(_, t)| t));
        drop(etki_kilidi);
        self.basarisizlari_bildir(basarisiz);
        match sonuc {
            Ok(s) => s,
            Err(yuk) => match yuk.downcast_ref::<Yazilmadi>() {
                Some(y) => Err(CekirdekHatasi::yazilmadi(y.0)),
                None => resume_unwind(yuk),
            },
        }
    }

    /// Kurulamayan alarmları ve gösterilemeyen kaçırılan özetini motora bildirir (genel olmayan işlev:
    /// `calistir`'in örneklenmesi sonlu kalsın). Bu çağrıların etkisi yoktur (yalnız satır düzeltir).
    fn basarisizlari_bildir(&self, b: BasarisizEtkiler) {
        for (alarm_no, neden) in b.kurulamayan {
            let _ = self.calistir(|m, _, _| m.alarm_kurulamadi(alarm_no, &neden));
        }
        if !b.gosterilemeyen.is_empty() {
            let _ = self.calistir(|m, _, _| m.kacirilan_gosterilemedi(&b.gosterilemeyen));
        }
    }

    /// Döner: kabuğun başaramadığı etkiler (motor kilidi yeniden alınarak bildirilir).
    fn etkileri_uygula(&self, e: Etkiler, tasima: Option<Arc<dyn Tasima>>) -> BasarisizEtkiler {
        if let Some(t) = &tasima {
            for metin in e.gonderilecek {
                if !t.gonder(metin) {
                    break;
                }
            }
            if let Some(neden) = e.kapat {
                t.kapat(neden);
            }
        }
        for no in e.alarm_iptal {
            let _ = self.alarm.iptal(no);
        }
        let mut kurulamayan = Vec::new();
        for a in e.alarm_kur {
            let no = a.alarm_no;
            if let Err(h) = self.alarm.kur(a) {
                kurulamayan.push((no, h.to_string()));
            }
        }
        let mut gosterilemeyen = Vec::new();
        if let Some(k) = e.kacirilan {
            let nolar: Vec<i64> = k.satirlar.iter().map(|s| s.alarm_no).collect();
            // Motor bu satırları teslim edildi işaretledi; gösterilemezse işaret kaldırılır (bilgi kaybolmasın).
            if self.alarm.kacirilanlari_goster(k).is_err() {
                gosterilemeyen = nolar;
            }
        }
        if !e.degisim.bos_mu() {
            let gozlemciler: Vec<_> = kilitle(&self.gozlemciler).iter().map(|(_, g)| g.clone()).collect();
            for g in gozlemciler {
                g.degisti(e.degisim.clone());
            }
        }
        BasarisizEtkiler { kurulamayan, gosterilemeyen }
    }

    fn guncel_nesil(&self) -> Option<u64> {
        kilitle(&self.tasima).as_ref().map(|(n, _)| *n)
    }

    /// Salt okuma sorgusu: okuma bağlantısında (yoksa motor kilidi altında). Etkisi yoktur.
    fn oku<T>(&self, f: impl FnOnce(&crate::depo::Depo) -> Result<T, CekirdekHatasi>) -> Result<T, CekirdekHatasi> {
        match &self.okuyucu {
            Some(o) => f(&kilitle(o)),
            None => f(&kilitle(&self.motor).depo),
        }
    }
}

#[uniffi::export]
impl Cekirdek {
    /// Veritabanını açar (yoksa oluşturur, göçleri uygular). Arayüz olmadan da (alıcı, iş) açılabilir.
    #[uniffi::constructor]
    pub fn ac(
        veritabani_yolu: String,
        kimlik: Arc<dyn KimlikKabugu>,
        zaman: Arc<dyn ZamanKabugu>,
        alarm: Arc<dyn AlarmKabugu>,
    ) -> Result<Arc<Self>, CekirdekHatasi> {
        let mut motor = Motor::ac(&veritabani_yolu)?;
        // Bağlı kip + eşleşme yok çıkışsızdır: veri kaybısız yerel kipe (`motor/yerel.rs`). Onarımın hatası
        // açılışı düşürmez: iz `meta.onarim_hatasi`'na yazılır, sonraki açılış yeniden dener.
        motor.acilis_onarimi(&Ortam { kimlik: &*kimlik, zaman: &*zaman });
        let okuyucu = crate::depo::Depo::okuyucu_ac(&veritabani_yolu)?.map(Mutex::new);
        Ok(Arc::new(Cekirdek {
            motor: Mutex::new(motor),
            okuyucu,
            etki: Mutex::new(()),
            kimlik,
            zaman,
            alarm,
            tasima: Mutex::new(None),
            nesil: AtomicU64::new(0),
            gozlemciler: Mutex::new(Vec::new()),
            gozlemci_sayaci: AtomicU64::new(0),
        }))
    }

    pub fn sema_surumu(&self) -> Result<i64, CekirdekHatasi> {
        kilitle(&self.motor).sema_surumu()
    }

    /// Çalışma kipi (D1): `Yerel` ya da `Bagli` (`CalismaKipi`). Kip değişince (yerelde bağlanma servisin
    /// tam kopyasıyla bitti ya da `baglantiyi_kopar`) gözlemciye `Degisim.tumu` ve `Degisim.baglanti` gider.
    pub fn kip(&self) -> Result<CalismaKipi, CekirdekHatasi> {
        self.calistir(|m, _, _| m.kip())
    }

    // Gözlemci (K4)

    /// Döner: `gozlemci_cikar` için numara.
    pub fn gozlemci_ekle(&self, gozlemci: Arc<dyn Gozlemci>) -> u64 {
        let no = self.gozlemci_sayaci.fetch_add(1, Ordering::Relaxed) + 1;
        kilitle(&self.gozlemciler).push((no, gozlemci));
        no
    }

    pub fn gozlemci_cikar(&self, no: u64) {
        kilitle(&self.gozlemciler).retain(|(n, _)| *n != no);
    }

    // Eşleşme (K1)

    pub fn eslestirme_baslat(&self, qr: AjandaEslestirmeQr) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.eslestirme_baslat(o, e, qr))
    }

    pub fn eslesme_durumu(&self) -> Result<EslesmeDurumu, CekirdekHatasi> {
        self.calistir(|m, _, _| m.eslesme_durumu())
    }

    /// Eşleşme bilgisini ve cihaz anahtarını siler, açık bağlantıyı kapatır. Kayıt silmez (D2): bağlı kipte
    /// `baglantiyi_kopar` ile aynıdır (kip `Yerel` olur; sayılar `son_gecis`'te, neden `EslesmeKaldirildi`),
    /// yerel kipte süren bağlanmayı ya da bekleyen eşleştirmeyi iptal eder.
    pub fn eslesmeyi_kaldir(&self) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.eslesmeyi_kaldir(o, e))
    }

    /// Bağlı kipten yerel kipe son geçişin özeti (D2; kalıcı, sonraki geçiş üstüne yazar); hiç olmadıysa
    /// `None`. Nedenler: `baglantiyi_kopar`, `eslesmeyi_kaldir`, bağlantıda servisin farklı `depo_id`
    /// getirmesi (`DepoDegisti`: gözlemciye `tumu` ve `baglanti` gider, kip `Yerel` olur ve bağlanma sürer;
    /// servisin tam kopyası gelince kip `Bagli` olur). Arayüz kullanıcıya ne olduğunu bununla söyler.
    pub fn son_gecis(&self) -> Result<Option<GecisOzeti>, CekirdekHatasi> {
        self.calistir(|m, _, _| m.son_gecis())
    }

    /// Koparma (D1): bağlı kipten yerel kipe, veri kaybı olmadan. Görünen kopya o anki haliyle (bekleyen
    /// işlemler dahil) telefonun gerçeği olur; kuyruk atılır, ret listesi, PC temeli ve alarmlar kalır;
    /// eşleşme bilgisi ve cihaz anahtarı silinir, açık bağlantı kapanır. Döner: kullanıcıya söylenecek
    /// sayılar (`KoparmaSonucu`). Yerel kipte süren bağlanmayı ya da bekleyen eşleştirmeyi iptal eder,
    /// kayıtlara dokunmaz; ikisi de yoksa etkisizdir. Gözlemciye: bağlı kipten `tumu`, `eslesme`, `baglanti`
    /// (ve açık geçmiş sayfaları `gecmis`: önbellek atıldı, yeniden istenmeli).
    pub fn baglantiyi_kopar(&self) -> Result<KoparmaSonucu, CekirdekHatasi> {
        self.calistir(|m, o, e| m.baglantiyi_kopar(o, e))
    }

    /// Açılacak WebSocket adresi; `None`: eşleşme yok, bağlanma.
    pub fn baglanti_adresi(&self) -> Result<Option<String>, CekirdekHatasi> {
        self.calistir(|m, _, _| m.baglanti_adresi())
    }

    // Kanal (K2)

    /// Soket açıldı. Döner: bu bağlantının nesli; `cerceve_geldi` ve `baglanti_kapandi` onu taşır,
    /// eski neslin geç gelen olayları yok sayılır. Önceki bağlantı açık sayılıyorsa önce kapanmış sayılır.
    pub fn baglanti_acildi(&self, tasima: Arc<dyn Tasima>) -> Result<u64, CekirdekHatasi> {
        let nesil = self.nesil.fetch_add(1, Ordering::Relaxed) + 1;
        if self.guncel_nesil().is_some() {
            self.calistir(|m, o, e| {
                *kilitle(&self.tasima) = None;
                m.baglanti_kapandi(o, e, None)
            })?;
        }
        let sonuc = self.calistir(|m, o, e| {
            *kilitle(&self.tasima) = Some((nesil, tasima));
            let sonuc = m.baglanti_acildi(o, e);
            if sonuc.is_err() {
                // Açılamadı: Kotlin nesli hiç almadı, soketi kapatır; taşıma kayıtlı kalmasın.
                *kilitle(&self.tasima) = None;
            }
            sonuc
        });
        sonuc.map(|()| nesil)
    }

    pub fn cerceve_geldi(&self, nesil: u64, metin: String) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| {
            if self.guncel_nesil() != Some(nesil) {
                return Ok(());
            }
            m.cerceve_geldi(o, e, &metin)
        })
    }

    /// Soket kapandı. `kapanis_kodu`: karşı tarafın kapanış çerçevesindeki kod (geldiyse; ağ hatasında`n    /// `None`). 1002 sürüm uyuşmazlığı sayılır (`BaglantiDurumu.surum_uyusmazligi`).
    pub fn baglanti_kapandi(&self, nesil: u64, kapanis_kodu: Option<i32>) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| {
            if self.guncel_nesil() != Some(nesil) {
                return Ok(());
            }
            *kilitle(&self.tasima) = None;
            m.baglanti_kapandi(o, e, kapanis_kodu)
        })
    }

    pub fn baglanti_durumu(&self) -> Result<BaglantiDurumu, CekirdekHatasi> {
        self.calistir(|m, _, _| m.baglanti_durumu())
    }

    /// Gövdenin hatırlatmaları şimdi kaydedilse ne zaman çalar (v2; form ve ayrıntı): saatsiz gün kaydında
    /// gün hatırlatmasının günü ve saati, geçtiyse `gecti`. Motor kilidini almaz; saati ve çeviriyi
    /// `ZamanKabugu`'ndan alır. Bilinmeyen dilim: `GecersizGirdi{alan:"zaman.saat_dilimi"}`.
    pub fn hatirlatma_onizlemesi(&self, govde: KayitGovdesi) -> Result<HatirlatmaOnizlemesi, CekirdekHatasi> {
        let cevirici = kabuklar::KabukCevirici(&*self.zaman);
        crate::motor::alarm::hatirlatma_onizlemesi(&govde, self.zaman.simdi_ms(), &cevirici)
            .map_err(|h| CekirdekHatasi::GecersizGirdi { alan: "zaman.saat_dilimi".into(), neden: h.mesaj })
    }

    // Sorgular (K4)

    pub fn liste(&self, sorgu: ListeSorgusu) -> Result<Vec<KayitGorunumu>, CekirdekHatasi> {
        self.oku(|d| crate::motor::sorgu::liste(d, &sorgu))
    }

    pub fn kayit(&self, kayit_id: String) -> Result<Option<KayitGorunumu>, CekirdekHatasi> {
        self.oku(|d| crate::motor::sorgu::kayit(d, &kayit_id))
    }

    pub fn ret_listesi(&self) -> Result<Vec<RetGirdisi>, CekirdekHatasi> {
        self.oku(crate::motor::sorgu::ret_listesi)
    }

    // Takvim sekmesi (K4; yerel salt okuma, kurallar `motor/takvim.rs` başında)

    /// Ay ızgarası: ayın her günü için özet (`TakvimGunOzeti`; boş günler dahil) ve ayla kesişen çok günlü
    /// öğeler (`TakvimSeridi`). Günler cihazın şimdiki dilimindedir (`ZamanKabugu.cihazDilimi`; saatli kayıt
    /// `yerelden_ana`/`andan_yerele` ile çevrilir). `kapalilar_dahil`: Tarihli sekmesindeki gibi `tamam`/`iptal`
    /// da gelsin. Motor kilidini almaz. Hata: `GecersizGirdi{alan:"yil"|"ay"}`.
    pub fn takvim_ayi(&self, yil: i32, ay: i32, kapalilar_dahil: bool) -> Result<TakvimAyi, CekirdekHatasi> {
        let cihaz = self.zaman.cihaz_dilimi();
        let cevirici = kabuklar::KabukCevirici(&*self.zaman);
        self.oku(|d| crate::motor::takvim::takvim_ayi(d, &cevirici, &cihaz, yil, ay, kapalilar_dahil))
    }

    /// Seçili günün (`YYYY-MM-DD`, cihaz günü) öğeleri, ürün sırasıyla: bölümsüz saatsizler, bölümlüler bölüm
    /// sırasıyla, saatliler saat sırasıyla. Çok günlü öğe kapsadığı her günde, tekrar eden kayıt örnek
    /// olarak (`ornek_tarihi`, örneğin `durum`'u) gelir. Hata: `GecersizGirdi{alan:"tarih"}`.
    pub fn takvim_gunu(&self, tarih: String, kapalilar_dahil: bool) -> Result<Vec<TakvimOgesi>, CekirdekHatasi> {
        let cihaz = self.zaman.cihaz_dilimi();
        let cevirici = kabuklar::KabukCevirici(&*self.zaman);
        self.oku(|d| crate::motor::takvim::takvim_gunu(d, &cevirici, &cihaz, &tarih, kapalilar_dahil))
    }

    /// Bağlı kipte canlı bağlantıda servise sorar (yanıt `Degisim.gecmis` ile); yerel kipte yerel geçmişten
    /// hemen yükler (bağlantı gerekmez). Sonuç `gecmis` ile okunur.
    pub fn gecmis_iste(&self, kayit_id: String, once_rev: Option<i64>) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.gecmis_iste(o, e, &kayit_id, once_rev))
    }

    pub fn gecmis(&self, kayit_id: String) -> Result<Option<GecmisSayfasi>, CekirdekHatasi> {
        self.calistir(|m, _, _| m.gecmis(&kayit_id))
    }

    // İşlemler (K4)

    /// Elle ya da sesli not ile yeni kayıt. Döner: `kayit_id`.
    pub fn ekle(&self, govde: KayitGovdesi, girdi_yolu: GirdiYolu) -> Result<String, CekirdekHatasi> {
        self.calistir(|m, o, e| m.ekle(o, e, govde, girdi_yolu))
    }

    /// Formun kaydı. `temel`: formun açıldığı hal; verilirse yalnız kullanıcının o halden değiştirdiği
    /// alanlar gider (PC'nin bu arada yaptığı değişiklik öteki alanlarda korunur). `None`: gövdenin tamamı
    /// istenen haldir (ret listesinden "düzelt"), görünen halle farkı gider.
    pub fn duzenle(&self, kayit_id: String, temel: Option<DuzenlemeTemeli>, govde: KayitGovdesi) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.duzenle(o, e, &kayit_id, temel, govde))
    }

    /// Tamamla / geri al / iptal; `ornek_tarihi` verilirse tekrarın yalnız o örneği.
    pub fn durum_degistir(&self, kayit_id: String, durum: KayitDurumu, ornek_tarihi: Option<String>) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.durum_degistir(o, e, &kayit_id, durum, ornek_tarihi))
    }

    pub fn onayla(&self, kayit_id: String) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.onayla(o, e, &kayit_id))
    }

    pub fn sil(&self, kayit_id: String) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.sil(o, e, &kayit_id))
    }

    pub fn geri_yukle(&self, kayit_id: String) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.geri_yukle(o, e, &kayit_id))
    }

    pub fn ret_at(&self, islem_id: String) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.ret_at(o, e, &islem_id))
    }

    // Dışa ve içe aktarma (D3; biçim ve kurallar `motor/aktarma.rs` başında, kap `aktarma_bicimi`)

    /// Bütün kayıtların (mezar taşları dahil) belgesi; iki kipte de çalışır (bağlı kipte görünen kopya,
    /// gönderilmemiş değişiklikler dahil). Kuyruk ve ret listesi girmez (`ret_listesinde` sayısı söylenir).
    /// Hiçbir şey yazmaz. Kotlin `belge`'yi zip'e `ajanda.json` olarak (UTF-8), `ekler`'i `yol`'larıyla koyar.
    pub fn disa_aktar(&self) -> Result<DisaAktarma, CekirdekHatasi> {
        self.calistir(|m, o, _| m.disa_aktar(o))
    }

    /// Belgenin içe aktarma planı (hiçbir şey yazmaz): kaç yeni, güncellenecek, aynı, atlanacak, geçersiz,
    /// sınırı aşan. Belge bütünüyle okunamazsa `GecersizGirdi{alan, neden}`: `alan` `belge` (JSON değil,
    /// nesne değil, çok büyük), `bicim` (ajanda yedeği değil), `bicim_surumu` / `sozlesme_surumu` (daha yeni:
    /// uygulama güncellenmeli) ya da üst düzey alanın yolu. Mesajlar içerik taşımaz.
    pub fn ice_aktarma_onizlemesi(&self, belge: String) -> Result<IceAktarmaOnizlemesi, CekirdekHatasi> {
        self.calistir(|m, o, _| m.ice_aktarma_onizlemesi(o, &belge))
    }

    /// İçe aktarma, tek işlemde (ya hepsi ya hiçbiri). `iz`: önizlemenin `iz`'i; verilirse ve telefon bu arada
    /// planı değiştirecek kadar değiştiyse hiçbir şey yazılmaz, `uygulandi` yanlış ve `plan` yeni önizlemedir.
    /// `None`: şimdiki plan uygulanır. Yerel kipte kayıtlar alanlarıyla yazılır (yerel geçmiş, alarm); bağlı
    /// kipte işlemler kuyruğa girer (servis yazar). Gözlemciye `kayitlar` (çoksa `tumu`), bağlı kipte `baglanti`.
    pub fn ice_aktar(&self, belge: String, iz: Option<String>) -> Result<IceAktarmaSonucu, CekirdekHatasi> {
        self.calistir(|m, o, e| m.ice_aktar(o, e, &belge, iz.as_deref()))
    }

    // Alarmlar (K3)

    pub fn alarmlari_yeniden_kur(&self, neden: YenidenKurmaNedeni) -> Result<(), CekirdekHatasi> {
        self.calistir(|m, o, e| m.alarm_isleminde(o, e, |m, o, e| m.alarmlari_yeniden_kur(o, e, neden)))
    }

    /// Alarm alıcısı çağırır. `None`: gösterme (kayıt değişti ya da silindi).
    pub fn alarm_caldi(&self, alarm_no: i64) -> Result<Option<HatirlatmaBildirimi>, CekirdekHatasi> {
        // Tek işlem: bütçede açılan yer ertelenen tetiklerle doldurulurken her kayıt ayrı fsync olmasın.
        self.calistir(|m, o, e| m.alarm_isleminde(o, e, |m, o, e| m.alarm_caldi(o, e, alarm_no)))
    }
}
