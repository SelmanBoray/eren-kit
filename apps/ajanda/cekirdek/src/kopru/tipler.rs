//! Yalnız köprüde yaşayan tipler (Kotlin'de `data class` / `sealed class`). Kayıt, zaman, hatırlatma,
//! tekrar ve kapalı listeler `model`'den doğrudan geçer. Bu dosya ilk dalgada dondurulur.

use crate::model::{
    AjandaKanalHatasi, AjandaKaydi, AjandaRetNedeni, AjandaYazar, AjandaZamani, IslemTuru, KayitDurumu, KayitGovdesi,
    KayitTuru, KuyrukRetNedeni,
};

/// Listede ve ayrıntıda gösterilen kayıt.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct KayitGorunumu {
    pub kayit: AjandaKaydi,
    /// Kuyrukta sonucu gelmemiş işlemi var (iyimser hal; arayüz "gönderiliyor" gösterebilir).
    pub bekleyen: bool,
}

/// Düzenleme formunun açıldığı hal (`duzenle`): yalnız bu halden farklı olan alanlar gönderilir; form
/// açıkken PC'den gelen değişiklik kullanıcının dokunmadığı alanlarda korunur.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DuzenlemeTemeli {
    /// Formun yüklendiği görünen kaydın revizyonu (işlemin `temel_revizyon`'u; bilgi içindir).
    pub revizyon: i64,
    /// Formun yüklendiği gövde (formun kendi `govde()`'si, kullanıcı dokunmadan).
    pub govde: KayitGovdesi,
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
    /// v2: `son_hata` `protokol_uyumsuz` iken (çerçeve, `error` ya da kapanış 1002) hangi tarafın eski
    /// olduğu. Doluyken kabuk yeniden bağlanmayı geri çeker ve "güncelle" durumunu gösterir; `CANLI`'da,
    /// başka bir kanal hatasında ve eşleşme değişiminde temizlenir. Bellek içidir (süreç ölünce yeniden denenir).
    pub surum_uyusmazligi: Option<SurumUyusmazligi>,
}

/// Sürüm uyuşmazlığının yönü (`AJANDA_SURUMU` karşılaştırması).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SurumUyusmazligi {
    /// Karşı taraf daha eski `v` konuşuyor: PC'deki servis güncellenmeli.
    ServisEski,
    /// Karşı taraf daha yeni `v` konuşuyor: uygulama güncellenmeli.
    UygulamaEski,
    /// Yön bilinmiyor (`error{protokol_uyumsuz}` ya da yalnız kapanış 1002): eski olan güncellenmeli.
    Bilinmiyor,
}

/// Saatsiz gün kaydının gün hatırlatması (v2): kaydın diliminde yerel gün ve saat; `gecti`: tetiği geçti,
/// bildirim gelmeyecek. Kaydın saati DEĞİLDİR (form ve ayrıntı "Cuma 19:00'da hatırlatılır" der).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GunHatirlatmasi {
    pub tarih: String,
    pub saat: String,
    pub gecti: bool,
}

/// Bir gövdenin hatırlatmalarının şimdiye göre özeti (`hatirlatmaOzeti` ve kurulacak ilk tetik): form ve
/// ayrıntı görünümü bununla "ne zaman hatırlatılır"ı söyler. Kural çekirdektedir (tek kaynak).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HatirlatmaOnizlemesi {
    /// Tetiği gelecekte olan hatırlatma sayısı (aynı tetikli olanlar ayrı sayılır).
    pub kurulacak: u32,
    /// Bekleyen `once` (dönem, belirsiz ya da zamansız kayıtta).
    pub saatsiz: u32,
    /// Tetiği geçmiş (hiç çalmayacak) hatırlatma sayısı.
    pub gecmis: u32,
    /// En yakın gelecek tetik (ms), varsa.
    pub ilk_tetik_ms: Option<i64>,
    /// Saatsiz gün kaydında: sıradaki gün hatırlatması, yoksa en son geçen.
    pub gun_hatirlatmasi: Option<GunHatirlatmasi>,
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

// -------------------------------------------------------------------------------------------------
// Takvim sekmesi (yerel, salt okuma; kurallar `motor/takvim.rs` başında)
// -------------------------------------------------------------------------------------------------

/// Takvim ayı (`takvim_ayi`): ızgaranın her günü için özet ve ayla kesişen çok günlü öğelerin şeritleri.
/// Günler cihazın şimdiki dilimindedir (Tarihli sekmesiyle aynı gün sınırı).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TakvimAyi {
    pub yil: i32,
    /// 1-12.
    pub ay: i32,
    /// Ayın bütün günleri sırayla (1'den ayın son gününe; boş günler dahil, sayaçları sıfır).
    pub gunler: Vec<TakvimGunOzeti>,
    /// Ayla kesişen, birden çok güne yayılan öğeler (dönem; süresi gece yarısını aşan saatli kayıt ya da
    /// örneği). İlk/son gün kırpılmamıştır (ay dışına taşabilir). Sıra: ilk gün artan, uzun olan önce.
    pub seritler: Vec<TakvimSeridi>,
}

/// Bir günün ızgara özeti. Sayılar `takvim_gunu(tarih)`'nin döndürdüğü öğelerindir (aynı süzgeç):
/// `toplam` onun uzunluğudur; çok günlü öğe kapsadığı her günde bir sayılır.
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct TakvimGunOzeti {
    /// `YYYY-MM-DD`.
    pub tarih: String,
    pub toplam: i32,
    /// Durumu `acik` olanlar (örnekte örneğin durumu).
    pub acik: i32,
    /// `tamam` ya da `iptal` olanlar (yalnız `kapalilar_dahil` iken sıfırdan büyük olabilir).
    pub kapali: i32,
    /// Taslaklar (onay bekleyen; `toplam`'ın içinde).
    pub taslak: i32,
    pub gorev: i32,
    pub randevu: i32,
    pub notlar: i32,
    /// Günü kaplayan çok günlü öğe sayısı (`seritler`'den; `toplam`'ın içinde).
    pub serit: i32,
}

/// Çok günlü öğe (ızgarada şerit). Tekrar eden kaydın örneğiyse `ornek_tarihi` doludur.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TakvimSeridi {
    pub kayit_id: String,
    pub ornek_tarihi: Option<String>,
    pub baslik: String,
    pub tur: KayitTuru,
    /// Öğenin durumu (`TakvimOgesi.durum` ile aynı kural).
    pub durum: KayitDurumu,
    pub taslak: bool,
    /// İlk ve son gün (`YYYY-MM-DD`, ikisi dahil, cihaz diliminde; kırpılmamış).
    pub ilk_gun: String,
    pub son_gun: String,
}

/// Seçili günün bir öğesi (`takvim_gunu`). Sıra çekirdektedir (ürün kuralı, `motor/takvim.rs`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TakvimOgesi {
    /// Kayıt olduğu gibi (tekrarlıda serinin kendisi: `zaman` çapanın günüdür, örneğin günü değil;
    /// gösterimde `ilk_gun`/`saat` kullanılır, düzenleme formu kaydın kendisiyle açılır).
    pub gorunum: KayitGorunumu,
    /// Tekrar eden kaydın örneği: örneğin kaydın kendi takvimindeki günü (`durum_degistir`'in
    /// `ornek_tarihi`'si). Dilim çevirisiyle cihazdaki günden farklı olabilir. Tekrarsızda yok.
    pub ornek_tarihi: Option<String>,
    /// Bu öğenin durumu: örnekte `ornekler` satırı, yoksa kaydın (serinin) durumu.
    pub durum: KayitDurumu,
    /// Öğenin ilk ve son günü (`YYYY-MM-DD`, ikisi dahil, cihaz diliminde). Tek günlükte ikisi aynı.
    pub ilk_gun: String,
    pub son_gun: String,
    /// Saatli (`an`) öğe: başlangıcın cihaz dilimindeki saati (`HH:MM`, `ilk_gun`'de). Saatsizde yok.
    pub saat: Option<String>,
    /// Saatli ve süreli öğe: bitişin cihaz dilimindeki saati (`son_gun`'de; tam gece yarısında biten
    /// öğede `00:00` ve `son_gun` önceki gündür).
    pub bitis_saati: Option<String>,
}
