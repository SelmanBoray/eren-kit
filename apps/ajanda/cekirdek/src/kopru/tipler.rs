//! Yalnız köprüde yaşayan tipler (Kotlin'de `data class` / `sealed class`). Kayıt, zaman, hatırlatma,
//! tekrar ve kapalı listeler `model`'den doğrudan geçer. Bu dosya ilk dalgada dondurulur.

use crate::model::{
    AjandaKanalHatasi, AjandaKaydi, AjandaRetNedeni, AjandaYazar, AjandaZamani, IslemTuru, KayitGovdesi, KayitTuru,
    KuyrukRetNedeni,
};

/// Listede ve ayrıntıda gösterilen kayıt.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct KayitGorunumu {
    pub kayit: AjandaKaydi,
    /// Kuyrukta sonucu gelmemiş işlemi var (iyimser hal; arayüz "gönderiliyor" gösterebilir).
    pub bekleyen: bool,
}

/// Ana sekmeler ve yardımcı görünümler. Taslaklar tarihli/tarihsiz listelerde de (işaretli) görünür.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum Sekme {
    /// Zamanı `an`, `gun` ya da `donem` olanlar; ilk güne göre artan.
    Tarihli,
    /// Zamanı olmayan ya da `belirsiz` olanlar; en yeni üstte.
    Tarihsiz,
    Taslaklar,
    /// Mezar taşları (`geri_yukle` için).
    Silinenler,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ListeSorgusu {
    pub sekme: Sekme,
    /// `tamam` ve `iptal` olanlar da gelsin.
    pub kapalilar_dahil: bool,
}

/// Kullanıcının ret listesindeki işlem: düzeltip yeniden ekler ya da atar (`ret_at`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RetGirdisi {
    pub islem_id: String,
    pub kayit_id: String,
    pub islem: IslemTuru,
    pub neden: KuyrukRetNedeni,
    /// Düzeltme formu için: `ekle`'de gönderilen gövde, `guncelle`'de değişikliğin uygulanmak istendiği
    /// hal (biliniyorsa); öteki işlemlerde yok.
    pub govde: Option<KayitGovdesi>,
    pub ts_ms: i64,
}

/// Geçmişin bir satırı (servisin `gecmis` çerçevesinden).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GecmisSatiri {
    pub rev: i64,
    pub ts_ms: i64,
    pub islem: IslemTuru,
    pub yazar: AjandaYazar,
    pub ornek_tarihi: Option<String>,
    /// Değişen alanların adları (`onceki`/`sonraki` anahtarları).
    pub alanlar: Vec<String>,
    /// `AjandaParca` JSON'u (ayrıntı ekranı alan alan gösterir).
    pub onceki_json: String,
    pub sonraki_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GecmisSayfasi {
    pub kayit_id: String,
    /// Şimdiye dek gelen sayfalar, rev azalan.
    pub satirlar: Vec<GecmisSatiri>,
    pub devami: bool,
    /// İstek yollandı, yanıt bekleniyor.
    pub yukleniyor: bool,
    pub hata: Option<AjandaRetNedeni>,
}

/// Gözlemciye giden değişiklik özeti. Arayüz ilgili sorguyu yeniden yapar.
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct Degisim {
    /// Görünen hali değişen kayıtlar.
    pub kayitlar: Vec<String>,
    /// Bütün listeler yeniden okunmalı (tam telafinin sonu, eşleşme değişimi).
    pub tumu: bool,
    pub ret_listesi: bool,
    pub baglanti: bool,
    pub eslesme: bool,
    /// Geçmiş sayfası gelen kayıtlar.
    pub gecmis: Vec<String>,
}

impl Degisim {
    pub fn bos_mu(&self) -> bool {
        self == &Degisim::default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum BaglantiAsamasi {
    Kopuk,
    /// `pair_request` yollandı, `pair_result` bekleniyor.
    Eslestirme,
    /// `hello` .. `welcome`.
    ElSikisma,
    /// `welcome` .. `esitlendi`.
    Telafi,
    Canli,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct BaglantiDurumu {
    pub asama: BaglantiAsamasi,
    /// Kuyrukta sonucu gelmemiş işlem sayısı.
    pub kuyrukta: i32,
    pub ret_listesinde: i32,
    pub son_esitlenme_ms: Option<i64>,
    /// Son kanal hatası (`error` çerçevesi, imza reddi); kullanıcıya gösterilebilir.
    pub son_hata: Option<AjandaKanalHatasi>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum EslesmeDurumu {
    Yok,
    /// QR okundu; sonraki bağlantı `pair_request` yollar.
    Bekliyor { host: String, port: i32 },
    Eslesti { device_id: String, host: String, port: i32 },
    /// PC reddetti (`pair_result.code`); kullanıcı yeni QR okutmalı.
    Reddedildi { kod: AjandaKanalHatasi },
}

/// Android'e kurdurulacak alarm. Kotlin yalnız `alarm_no` ve `tetik_ms` ile kurar; çaldığında içeriği
/// `alarm_caldi(alarm_no)` ile çekirdekten alır (kayıt arada değiştiyse çekirdek susturur).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct KurulacakAlarm {
    pub alarm_no: i64,
    pub kayit_id: String,
    pub tetik_ms: i64,
    pub ornek_tarihi: Option<String>,
    /// Strateji seçimi için (ör. randevuya çalar saat alarmı).
    pub tur: KayitTuru,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HatirlatmaBildirimi {
    pub alarm_no: i64,
    pub kayit_id: String,
    pub baslik: String,
    pub tur: KayitTuru,
    pub zaman: Option<AjandaZamani>,
    pub ornek_tarihi: Option<String>,
    pub tetik_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct KacirilanBildirimi {
    pub satirlar: Vec<HatirlatmaBildirimi>,
}

/// Alarmların yeniden kurulma nedeni (Kotlin alıcısı hangi olayla çağırdı).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum YenidenKurmaNedeni {
    /// `BOOT_COMPLETED` (ve hızlı açılış eşleri).
    Acilis,
    UygulamaAcildi,
    /// `TIME_SET`.
    SaatDegisti,
    /// `TIMEZONE_CHANGED`.
    DilimDegisti,
    /// `MY_PACKAGE_REPLACED`.
    PaketGuncellendi,
    /// Arka plan işi.
    Periyodik,
}
