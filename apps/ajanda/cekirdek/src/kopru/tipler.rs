//! Yalnız köprüde yaşayan tipler (Kotlin'de `data class` / `sealed class`). Kayıt, zaman, hatırlatma,
//! tekrar ve kapalı listeler `model`'den doğrudan geçer. Bu dosya ilk dalgada dondurulur.

use crate::model::{
    AjandaKanalHatasi, AjandaKaydi, AjandaRetNedeni, AjandaYazar, AjandaZamani, IslemTuru, KayitDurumu, KayitGovdesi,
    KayitTuru, KuyrukRetNedeni, V3Alanlari,
};

/// Çalışma kipi (D1, göç 4). `Yerel`: doğruluk kaynağı telefondur, işlemler kuyruğa girmeden kalıcı
/// uygulanır (`KayitGorunumu.bekleyen` hep yanlış, `BaglantiDurumu.kuyrukta` 0, geçmiş yerel tablodan).
/// `Bagli`: servis yazar (eşleşmiş kurulum). Yerel kipte QR ile eşleşince kip, servisin tam kopyası gelene
/// (ilk `esitlendi`) dek `Yerel` kalır; o anda yerel kayıtlar kuyruğa dökülür, kip `Bagli` olur ve kayıtlar
/// kuyrukla PC'ye gider. Bağlı kipten `Yerel`'e dönüşler (D2; son geçiş `Cekirdek::son_gecis`):
/// `baglantiyi_kopar`, `eslesmeyi_kaldir` ve servisin saklı olandan farklı `depo_id` getirmesi (`GecisNedeni`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum CalismaKipi {
    Yerel,
    Bagli,
}

/// `Cekirdek::baglantiyi_kopar`'ın sonucu: arayüzün kullanıcıya söyleyeceği sayılar. Koparmada hiçbir kayıt
/// telefondan gitmez; buradaki sayılar PC'ye ulaşmamış (ya da ulaştığı bilinmeyen) değişikliklerdir.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct KoparmaSonucu {
    /// Çağrıdan önceki kip. `Yerel` ise kayıtlara dokunulmadı; yalnız süren bağlanma ya da bekleyen
    /// eşleştirme iptal edildi (`baglanma_iptal`).
    pub onceki_kip: CalismaKipi,
    /// PC'ye gönderilmeden ayrılan değişikliklerin dokunduğu kayıt sayısı (kuyrukta sonucu gelmemiş işlemi
    /// olan kayıtlar). Telefonda o haliyle duruyorlar; PC'de yoklar ya da eski halleriyle duruyorlar.
    pub gonderilmeyen_kayit: i32,
    /// Aynı değişikliklerin işlem sayısı (koparma anındaki `BaglantiDurumu.kuyrukta + ertelenen_islem`:
    /// eski serviste ertelenmiş işlemler de sayılır).
    pub gonderilmeyen_islem: i32,
    /// `gonderilmeyen_islem`'in yollanmış ama yanıtı gelmemiş olanları: PC'ye ulaşmış olabilir.
    pub yanitsiz_islem: i32,
    /// Ret listesinde kalan işlem sayısı (koparma ret listesine dokunmaz).
    pub ret_listesinde: i32,
    /// Yerel kipte çağrıldıysa: bir eşleşme ya da bekleyen eşleştirme (süren bağlanma) iptal edildi mi.
    pub baglanma_iptal: bool,
    /// Geçişte PC temelinin (koparma anındaki PC kopyası) okunamayan satırları. Bu kayıtların PC'deki son
    /// hali bilinmez: sonraki bağlanmada telefonun PC'den farklı her alanı gider (PC'nin değeri PC
    /// geçmişinde kalır). Yerel kipte hep 0.
    #[uniffi(default = 0)]
    pub okunamayan_pc_temeli: i32,
}

/// Bağlı kipten yerel kipe son geçişin nedeni (D2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum GecisNedeni {
    /// `Cekirdek::baglantiyi_kopar` bağlı kipte çağrıldı.
    Koparma,
    /// `Cekirdek::eslesmeyi_kaldir` bağlı kipte çağrıldı: artık koparmadır (veri kalır, eşleşme ve cihaz
    /// anahtarı silinir).
    EslesmeKaldirildi,
    /// Bağlı kipte servis saklı `depo_id`'den farklı bir `depo_id` getirdi: telefon başka bir servisle
    /// eşleşti (yeni QR) ya da servis sıfırdan kuruldu. Görünen kopya ezilmedi; eşleşme kalır, bağlantı
    /// yerel kipten bağlanma gibi sürer (servisin tam kopyası gelince yerel kayıtlar ona gider, kip `Bagli`).
    DepoDegisti,
}

/// `Cekirdek::son_gecis`: bağlı kipten yerel kipe son geçişin özeti (kalıcı; bir sonraki geçiş üstüne yazar).
/// Arayüz ne olduğunu kullanıcıya bununla söyler.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GecisOzeti {
    pub neden: GecisNedeni,
    /// Geçişin anı (ms, `ZamanKabugu`).
    pub ts_ms: i64,
    /// Koparmanın sayıları (`onceki_kip` hep `Bagli`, `baglanma_iptal` yanlış). `DepoDegisti`'de
    /// `gonderilmeyen_*` eski servise ulaşmamış değişikliklerdir; telefonda durur ve yeni servise farkla gider.
    pub koparma: KoparmaSonucu,
    /// Geçişten önce saklı `depo_id` (PC temelinin deposu; yoksa `None`).
    pub eski_depo_id: Option<String>,
    /// `DepoDegisti`'de servisin getirdiği `depo_id`; öteki nedenlerde `None`.
    pub yeni_depo_id: Option<String>,
}

/// Listede ve ayrıntıda gösterilen kayıt.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct KayitGorunumu {
    pub kayit: AjandaKaydi,
    /// Kuyrukta sonucu gelmemiş işlemi var (iyimser hal; arayüz "gönderiliyor" gösterebilir). Yalnız
    /// ertelenmiş işlemi olan kayıtta yanlıştır (o işlem bu serviste gitmez; `ertelenen`).
    pub bekleyen: bool,
    /// Ertelenen v3 değişikliği var: eski (v2) servise bağlıyken v3 alanlarına yapılan değişiklik telefonda
    /// bekliyor, kayıt onunla görünüyor; servis güncellenince kendiliğinden eşitlenir ("servis güncellenince
    /// eşitlenecek"; servis hiç güncellenmezse süresiz bekler, kullanıcı `Cekirdek::ertelenenleri_at` ile atabilir).
    /// Yerel kipte ve v3 serviste hep yanlış.
    #[uniffi(default)]
    pub ertelenen: bool,
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
    /// Kullanıcının `Cekirdek::ertelenenleri_at` ile attığı ertelenen v3 değişikliği (eski servis hiç
    /// güncellenmediği için gönderilemedi; `neden` `TeslimEdilemedi`). Arayüz "PC'deki servis eski olduğu için
    /// atıldı" gibi kendi metnini gösterir; düzeltme formu sunmaz (form v3 alanı taşımaz, `govde` yalnız başlık
    /// içindir). Atılan değişikliğin kendisi `v3_degisikligi`'ndedir; `Cekirdek::ertelenen_geri_al` onu yeniden
    /// uygular. Atmak (`ret_at`) girdiyi siler. Öteki retlerde yanlış.
    #[uniffi(default)]
    pub ertelenen_atildi: bool,
    /// İşlemin v3 alanlarındaki değişikliği (`guncelle`'de değişiklik, `ekle`'de konan v3 alanları): arayüz neyin
    /// atıldığını (ya da reddedildiğini) bununla gösterir. İşlem v3 alanına dokunmuyorsa ya da okunamıyorsa yok.
    #[uniffi(default)]
    pub v3_degisikligi: Option<V3DegisiklikOzeti>,
    /// Yalnız `ertelenen_atildi` girdisinde: atılan işlem daha önce (v3 bağlantıda, servis sonra v2'ye inmeden
    /// önce) yollanmış ve sonucu gelmemişti. Servis onu uygulamış olabilir: değişiklik PC'de duruyor olabilir.
    /// Arayüz "gönderilmeden atıldı" demez ("PC'ye ulaşmış olabilir"). Öteki girdilerde yanlış.
    #[uniffi(default)]
    pub ulasmis_olabilir: bool,
    /// Girdi bir yedekten içe aktarıldı ve kaydı telefonda yedekten sonra değişmiş (ya da bu bilinemedi): girdi
    /// kaydın eski bir hali için yazılmıştı (çoğunlukla kullanıcının başka yerde çözdüğü ya da PC'nin sonra
    /// düzenlediği kayıt). Arayüz "Kayıt bu yedekten sonra değişti" uyarısını gösterir; `Cekirdek::ret_duzelt`
    /// düzeltmeyi var olan kayda uygulamaz, yeni kayıt olarak ekler (kaydın şimdiki hali ezilmez, girdinin
    /// içeriği de kaybolmaz). `ertelenen_atildi` girdisinde `ertelenen_geri_al` yine uygulanabilir ama atılan
    /// v3 değişikliği kaydın sonraki halinin üstüne gelir. Yedekle başka telefonlara da taşınır.
    #[uniffi(default)]
    pub kayit_sonra_degisti: bool,
}

/// Bir işlemin v3 alanlarındaki değişikliği, okunur hali (`RetGirdisi.v3_degisikligi`). Alan adları kablodaki
/// adlardır (`simge`, `bolge`, `bolge_konumu`, `varis`, `baglantilar`, `ekler`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct V3DegisiklikOzeti {
    /// Değer konan alanlar ve değerleri; değişiklikte yer almayan (ya da kaldırılan) alan boştur (`None`, boş
    /// liste). `baglantilar` ve `ekler` konan listenin tamamıdır (değişiklik listeyi bütünüyle değiştirir).
    pub konan: V3Alanlari,
    /// Kaldırılan alanların adları, yukarıdaki sırayla.
    pub kaldirilan: Vec<String>,
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
    /// Kuyrukta sonucu gelmemiş işlem sayısı. Eski (v2) servise bağlıyken bütünüyle ertelenmiş (yalnız v3
    /// alanı değiştiren) işlemler sayılmaz: bu serviste gitmezler (`ertelenen_islem`).
    pub kuyrukta: i32,
    pub ret_listesinde: i32,
    pub son_esitlenme_ms: Option<i64>,
    /// Son kanal hatası (`error` çerçevesi, imza reddi); kullanıcıya gösterilebilir.
    pub son_hata: Option<AjandaKanalHatasi>,
    /// v2: `son_hata` `protokol_uyumsuz` iken (çerçeve, `error` ya da kapanış 1002) hangi tarafın eski
    /// olduğu. Doluyken kabuk yeniden bağlanmayı geri çeker ve "güncelle" durumunu gösterir; `CANLI`'da,
    /// başka bir kanal hatasında ve eşleşme değişiminde temizlenir. Bellek içidir (süreç ölünce yeniden denenir).
    pub surum_uyusmazligi: Option<SurumUyusmazligi>,
    /// Kuyrukta bu serviste gitmeyen gönderilmemiş işlem sayısı: eski (v2) servise bağlıyken bütünüyle
    /// ertelenmiş işlemler (yalnız v3 alanı değiştiren ya da aynı kaydın ertelenmiş işleminin arkasında sırası
    /// tutulan). `kuyrukta`'ya girmez (kabuğun "kuyruk boşalana dek" beklemeleri eski serviste bitsin) ama
    /// gönderilmemiş değişikliktir: gönderilmemişlerin toplamı `kuyrukta + ertelenen_islem`'dir
    /// (`KoparmaSonucu.gonderilmeyen_islem` koparma anında budur). "Gönderilmemiş değişiklik yok" ancak ikisi
    /// de sıfırken söylenir. Yerel kipte ve erteleme yokken 0.
    #[uniffi(default)]
    pub ertelenen_islem: i32,
    /// Açık bağlantı düşülen alt sürümdeyken (`protokol_uyumsuz` sonrası) yukarı deneme anı (ms, kabuğun
    /// saati): bu andan sonraki ilk köprü çağrısında, yolda işlem yokken çekirdek bağlantıyı kendisi kapatır
    /// (`kapat`; hata yazılmaz), sonraki bağlantı en yeni sürümle açılır. Bağlantı boşta açık kalıyorsa kabuk bu
    /// ana bir `baglanti_durumu` yoklaması kurmalı (yoksa deneme ilk olaya kalır). Öteki hallerde yok.
    #[uniffi(default)]
    pub yukari_deneme_ms: Option<i64>,
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

/// `BaglantiYetenekleri.kip`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum BaglantiKipi {
    /// Yerel kip (`CalismaKipi::Yerel`; süren bağlanma dahil): servis yok, v3 alanları kısıtsız.
    Yerel,
    /// Bağlı kip, açık bir bağlantının `welcome`'u yok (kopuk ya da el sıkışma sürüyor).
    BagliDegil,
    /// Bağlı kip, bağlantının `welcome`'u geldi (telafi ya da canlı): sürüm ve yetenekler bu bağlantınındır.
    Bagli,
}

/// `Cekirdek::baglanti_yetenekleri`: arayüzün bağlantıya göre açacakları. Değişince gözlemciye
/// `Degisim.baglanti` gider.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct BaglantiYetenekleri {
    pub kip: BaglantiKipi,
    /// `Bagli`'da bağlantının sürümü (2 ya da 3); öteki kiplerde yok.
    pub surum: Option<i32>,
    /// v3 alanlarındaki değişiklik servise hemen gider mi: yerel kipte ve v3 bağlantıda doğru, v2 bağlantıda
    /// yanlış (yine düzenlenebilir: değişiklik ertelenir, `ertelenen`). `BagliDegil`'de bilinen son servis
    /// sürümüne göre (bilinmiyorsa doğru).
    pub v3_alanlari: bool,
    /// Bağlantının `welcome.yetenekler`'i (istenenlerle sunulanların kesişimi); `Bagli` dışında boş.
    pub yetenekler: Vec<String>,
    /// Ertelenen v3 değişikliği taşıyan kuyruk işlemi sayısı: eski servise bağlıyken v3 alanlarına yapılan
    /// değişiklikler (karma işlemin v3 kalanı dahil; arkalarında sırası tutulan v2 işlemleri, ör. bekleyen
    /// silme, sayılmaz: onlar `BaglantiDurumu.ertelenen_islem`'de); servisle v3 konuşulan ilk bağlantıda
    /// kendiliğinden giderler ("servis güncellenince eşitlenecek"). Servis hiç güncellenmezse süresiz beklerler;
    /// `Cekirdek::ertelenenleri_at` onları ret listesine atar (bu sayı kadar girdi). Yerel kipte 0.
    pub ertelenen: i32,
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

// -------------------------------------------------------------------------------------------------
// Dışa ve içe aktarma (D3; biçim ve kurallar `motor/aktarma.rs` başında)
// -------------------------------------------------------------------------------------------------

/// Kabın (zip) düzeni: Kotlin dosyayı bunlarla yazar ve okur (`aktarma_bicimi`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AktarmaBicimi {
    /// Zip'in kökündeki belge (`ajanda.json`): `DisaAktarma.belge`'nin UTF-8 metni.
    pub belge_adi: String,
    /// Ek dosyalarının dizini (`ekler/`): her ek `ekler/<ozet>` yolunda, içerik adresli.
    pub ekler_dizini: String,
    /// Bu uygulamanın okuyabildiği en yeni biçim sürümü (yazdığı, içeriğin gerektirdiği en düşüğüdür: ret
    /// girdisi yoksa 1, varsa 2).
    pub bicim_surumu: i64,
    /// İçe aktarmada belgenin en çok bayt uzunluğu (64 MiB; `motor/aktarma.rs` `BELGE_AZAMI_BAYT`): bellek
    /// koruması. Kap okunurken belge bu sınırla sayılır, daha büyüğü belleğe alınmadan reddedilmeli (çekirdek
    /// de reddeder). Dışa aktarma bunu aşan belgeyi de yazar (`DisaAktarma.ice_aktarma_sinirini_asiyor`):
    /// yazarken sınır olarak kullanılmamalı.
    pub belge_azami_bayt: u64,
    /// Bir ek dosyasının en çok bayt uzunluğu.
    pub ek_azami_bayt: u64,
    /// Kap okunurken belleğe alınan bütün ek dosyalarının toplam sınırı (16 MiB; bugün hiçbir sürüm ek yazmaz).
    #[uniffi(default = 0)]
    pub ekler_toplam_azami_bayt: u64,
    /// Kap okunurken açılmış bütün girdilerin (belge + ekler + saklanmayanlar) toplam sınırı:
    /// `belge_azami_bayt` + `ekler_toplam_azami_bayt` (80 MiB). Şişirme saldırısı bu sınırda kesilir.
    #[uniffi(default = 0)]
    pub acilmis_toplam_azami_bayt: u64,
    /// Kaptaki ek dosyası sayısının sınırı (10 000; belgenin `ekler` dizisininkiyle aynı).
    #[uniffi(default = 0)]
    pub ek_azami_adet: u32,
}

/// Kaba girecek (ya da kaptan okunacak) bir ek dosyası. Bugün hiç yoktur (ek alanları sözleşme v3'le gelir).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct EkDosyasi {
    /// İçeriğin sha256'sı (64 küçük harf hex); dosyanın adı da budur.
    pub ozet: String,
    /// Tam boy (bayt); içe aktarmada dosyanın gerçek boyuyla karşılaştırılmalı.
    pub bayt: i64,
    pub mime: String,
    /// Zip içindeki yol (`ekler/<ozet>`).
    pub yol: String,
}

/// `Cekirdek::disa_aktar`'ın sonucu.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DisaAktarma {
    /// Belgenin metni (JSON); zip'e `AktarmaBicimi.belge_adi` adıyla UTF-8 olarak yazılır.
    pub belge: String,
    /// Belgedeki kayıt sayısı (mezar taşları dahil).
    pub kayit: i32,
    /// Bunlardan mezar taşı (silinenler sekmesindekiler) olanlar.
    pub silinmis: i32,
    /// Telefonda okunamayan satırlar: belgeye olduğu gibi kondu, içe aktarmada geçersiz sayılırlar.
    pub okunamayan: i32,
    /// Belgeye girmeyen, yalnız telefonun ret listesinde kalan girdiler: kimliği ya da anı okunamayanlar ve öğe
    /// sınırını (50 000 girdi, `KAYIT_ADET`; bir girdi 256 KiB) aşanlar. Biçim 3'ten beri gövdesiz girdi
    /// (`sil`, `durum` reddi, okunamayan metin) de satırıyla birlikte girer. Kullanıcı önce düzeltmeli ya da atmalı.
    pub ret_listesinde: i32,
    /// Aktarmanın yapıldığı kip (bağlı kipte görünen kopya, gönderilmemiş değişiklikler dahil).
    pub kip: CalismaKipi,
    /// Kaba `yol`'larıyla konacak ek dosyaları (bugün hep boş).
    pub ekler: Vec<EkDosyasi>,
    /// Belgeye giren ret listesi girdileri (satırlarıyla; içe aktarmada ret listesine geri yazılır).
    #[uniffi(default = 0)]
    pub ret_yedekte: i32,
    /// Belge bu sürümün içe aktarma sınırlarını aşıyor (`AktarmaBicimi.belge_azami_bayt` ya da kayıt öğesi
    /// sınırı): yazılmalı (veri yalnız telefonda kalmasın) ama bu sürümde geri yüklenemez; kullanıcıya
    /// söylenmeli.
    #[uniffi(default = false)]
    pub ice_aktarma_sinirini_asiyor: bool,
    /// Belgenin biçim sürümü (`bicim_surumu`): 1, 2 ya da 3. 2 yalnız ret girdisi yedeğe girdiyse (`ret_yedekte`
    /// sıfırdan büyük), 3 ret girdilerinden biri biçim 2'nin taşıyamadığını taşıyorsa (işlemin kendisi: v3
    /// değişikliği, atılmış ertelenen değişiklik; okunamayan metin; yerel neden; gövdesiz girdi; "kayıt sonra
    /// değişti" işareti; pratikte servisin reddettiği her işlem): daha düşük biçim okuyan
    /// eski uygulama bu dosyayı bütünüyle reddeder ("daha yeni bir biçim"), kayıtlarını da alamaz. 2 ve üstünde
    /// kullanıcıya söylenmeli (yedek yalnız bu sürüm ve sonrasıyla geri yüklenir; ret girdileri düzeltilir ya da
    /// atılırsa biçim 1 yazılır).
    #[uniffi(default = 0)]
    pub bicim_surumu: i64,
}

/// Önizlemede geçersiz sayılan bir kayıt: yalnız konum ve neden (içerik yoktur).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GecersizKayit {
    /// Belgenin `kayitlar` dizisindeki sırası (0'dan).
    pub sira: i32,
    /// Alan yolu (`kayitlar.3.zaman.saat_dilimi` gibi; yalnız şemanın alan adları ve sıra numaraları).
    pub alan: String,
    pub neden: String,
}

/// İçe aktarmanın planı (`ice_aktarma_onizlemesi`) ya da uygulanan planı (`IceAktarmaSonucu.plan`).
/// Kural: aynı `kayit_id` telefonda da varsa `guncelleme_ms`'i büyük olan kalır (mezar taşları dahil);
/// eşitlikte telefondaki kalır. Sayıların toplamı `toplam`'dır.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct IceAktarmaOnizlemesi {
    /// Uygulanacağı kip. `Yerel`: kayıtlar alanlarıyla doğrudan yazılır. `Bagli`: servise kuyrukla
    /// gider (servis yazar; kaynak izi ve zamanlar servisin olur; telefonda olmayan taslak gitmez:
    /// `taslak_gonderilmeyecek`).
    pub kip: CalismaKipi,
    /// Dosyanın dışa aktarıldığı an (ms).
    pub disa_aktarma_ms: i64,
    /// Dosyadaki kayıt öğesi sayısı.
    pub toplam: i32,
    /// Bunlardan geçerli mezar taşı olanlar (bilgi).
    pub silinmis: i32,
    /// Telefonda yok, eklenecek.
    pub yeni: i32,
    /// Telefonda var, dosyadaki daha yeni: dosyadaki hal yazılacak.
    pub guncellenecek: i32,
    /// Telefondakiyle aynı (revizyon ve güncelleme anı dışında; bağlı kipte servise gidecek alanlarda).
    pub ayni: i32,
    /// Telefondaki daha yeni (ya da aynı anlı): telefondaki kalır.
    pub atlanacak: i32,
    /// Şemadan ya da kurallardan geçmeyen, dosyada yinelenen, dilimi bilinmeyen, çok büyük (256 KiB üstü) ya
    /// da gelecek tarihli (`guncelleme_ms` şimdi + 1 günden büyük): uygulanmaz.
    pub gecersiz: i32,
    /// Kayıt sınırı (`KAYIT_ADET`, mezar taşları dahil) dolduğu için eklenemeyecek yeniler.
    pub sinir_asan: i32,
    /// Bağlı kipte: telefonda olmayan mezar taşları (PC'ye gönderilmez; PC'nin sınırını ölü kayıtla
    /// doldurmasın). Yerel kipte hep 0.
    pub gonderilmeyecek: i32,
    /// Bağlı kipte kuyruğa girecek işlem sayısı. Yerel kipte hep 0.
    pub kuyruga_girecek_islem: i32,
    /// Geçersizlerin ilk 20'si (konum ve neden).
    pub gecersizler: Vec<GecersizKayit>,
    /// Dosyanın taşıdığı ek dosyaları (bugün hep boş). Kotlin uygulamadan önce her birini kaptan okur,
    /// sha256 ve boyutunu denetler; aynı `ozet`'li dosya telefonda varsa yeniden yazmaz.
    pub ekler: Vec<EkDosyasi>,
    /// Planın izi: `ice_aktar`'a verilirse telefon bu arada plan değişecek kadar değiştiyse uygulanmaz.
    pub iz: String,
    /// `guncellenecek`'lerden telefonda canlı olup dosyadaki daha yeni mezar taşıyla silinecekler.
    #[uniffi(default = 0)]
    pub silinecek: i32,
    /// `guncellenecek`'lerden telefonda silinmiş olup dosyadaki daha yeni canlı halle geri yüklenecekler.
    #[uniffi(default = 0)]
    pub geri_yuklenecek: i32,
    /// Bağlı kipte: telefonda olmayan taslaklar. Servis kaydı taslak olarak alamaz (`ekle` onaylanmış kayıt
    /// doğurur): gönderilmez. Yerel kipte hep 0 (taslak taslak olarak yazılır).
    #[uniffi(default = 0)]
    pub taslak_gonderilmeyecek: i32,
    /// `guncellenecek`'lerden telefonda taslak (onaylanmamış öneri) olup dosyadaki daha yeni onaylı halle
    /// onaylanacaklar: bağlı kipte `onayla` işlemi servise gider (hatırlatma kurulur), yerel kipte doğrudan.
    /// Kullanıcıya ayrıca söylenmeli (onaylamak, yedekteki onaylı hali seçmektir). Dosyadaki hal onaylı bir
    /// mezar taşıysa sayılmaz: kayıt yalnız `silinecek`'tir ve taslak kalır (`onayla` gönderilmez).
    #[uniffi(default = 0)]
    pub taslak_onaylanacak: i32,
    /// Yerel kipte: `guncellenecek`'lerden telefondaki satırı okunamayanlar. Dosyadaki hal yazılır, telefondaki
    /// eski metin kaybolmasın diye ret listesine düşer (`tutarsiz_kayit`; oradan düzeltilebilir ya da
    /// atılabilir). Bağlı kipte hep 0 (okunamayan satır atlanır: `atlanacak`).
    #[uniffi(default = 0)]
    pub okunamayan_ret_listesine: i32,
    /// Yerel kipte: `guncellenecek`'lerden telefonda onaylı olup dosyadaki daha yeni `taslak: true` halle
    /// taslağa dönecekler (onaylanmamış öneri olur; hatırlatması kurulmaz). Telefondaki satır okunamıyorsa
    /// metnin `taslak`'ı doğru değilse onaylı sayılır. Kullanıcıya ayrıca söylenmeli. Bağlı kipte hep 0
    /// (servis kaydı taslağa döndürmez; dökme kuralı bu farkı göndermez).
    #[uniffi(default = 0)]
    pub taslaga_donecek: i32,
    /// Biçim 2: dosyadan ret listesine eklenecek girdiler (iki kipte de; telefonun ret listesinde aynı
    /// `islem_id`'li olanlar sayılmaz, yinelenmez; kaydı sonra değişenler dahildir, ayrıca `ret_sonra_degisen`'de
    /// sayılır; sınırı aşanlar `ret_sinir_asan`'dadır). Kayıt sayılarının (`toplam`) dışındadır.
    #[uniffi(default = 0)]
    pub ret_listesine_gelecek: i32,
    /// Biçim 2: okunamayan ya da dosyada `islem_id`'si yinelenen ret girdileri (uygulanmaz).
    #[uniffi(default = 0)]
    pub ret_gecersiz: i32,
    /// Eski köprü uyumu için duruyor, hep 0. Eskiden kaydı yedekten sonra değişmiş ret girdisi alınmazdı;
    /// artık alınır ve işaretlenir (`ret_sonra_degisen`): girdinin içeriği (D4'ün telefon hali gibi) yalnız
    /// yedekte olabilir, alınmasaydı ona ulaşmanın yolu kalmazdı.
    #[uniffi(default = 0)]
    pub ret_bayat: i32,
    /// `ret_listesine_gelecek`'lerden kaydı telefonda yedekten sonra değişmiş olanlar (ya da bu bilinemeyenler:
    /// kayıt dosyada geçerli değil ama telefonda var): `RetGirdisi.kayit_sonra_degisti` işaretiyle yazılır,
    /// düzeltmesi var olan kaydı ezmez (`Cekirdek::ret_duzelt` yeni kayıt ekler). Kullanıcıya söylenmeli.
    #[uniffi(default = 0)]
    pub ret_sonra_degisen: i32,
    /// Ret listesinin sınırı (`AktarmaBicimi`'nin yedeğe aldığı en çok girdi, 50 000) dolduğu için alınmayacak
    /// ret girdileri (`ret_listesine_gelecek`'in dışında). Kullanıcı önce listedekileri düzeltmeli ya da atmalı.
    #[uniffi(default = 0)]
    pub ret_sinir_asan: i32,
}

/// `Cekirdek::ice_aktar`'ın sonucu.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct IceAktarmaSonucu {
    /// Yanlışsa hiçbir şey yazılmadı: iz verilmedi ya da şimdiki planınkiyle tutmadı (telefon önizlemeden
    /// sonra değişti; aynı belgenin ikinci uygulamasında da: plan artık "aynı"lardır). `plan` şimdiki
    /// önizlemedir; kullanıcıya yeniden gösterilip onayıyla yeni `iz`'le çağrılır.
    pub uygulandi: bool,
    /// Uygulanan (ya da `uygulandi` yanlışsa uygulanacak) planın sayıları.
    pub plan: IceAktarmaOnizlemesi,
}

// -------------------------------------------------------------------------------------------------
// Birleştirme önizlemesi (D4; kurallar `motor/birlestirme.rs` başında)
// -------------------------------------------------------------------------------------------------

/// Yerel kipten servise bağlanmanın önizlemesi (`birlestirme_onizlemesi`; onay `birlestirmeyi_onayla`).
/// Servisin tam kopyası elde edildi; telefonun kayıtları henüz hiçbir yere gitmedi. Sayılar telefonun görünen
/// kopyasının (mezar taşları dahil) sınıflarıdır; toplamları telefondaki satır sayısıdır.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct BirlestirmeOnizlemesi {
    /// Servisin `depo_id`'si.
    pub depo_id: String,
    /// Telefonun PC temeli bu servisten (aynı servise dönüş; `false`: yeni servis ya da sıfırdan kurulmuş).
    pub ayni_depo: bool,
    /// Serviste yok, Eren servisine yeni kayıt olarak gidecek.
    pub yeni: i32,
    /// Serviste var, telefonun değişikliği gidecek (`cakisanlar` bunların içindedir).
    pub degisen: i32,
    /// `degisen`'lerden iki tarafın da aynı alanı değiştirdiği kayıtlar: telefonun değeri kazanacak (PC'nin
    /// değeri PC geçmişinde kalır).
    pub cakisanlar: Vec<CakisanKayit>,
    /// Serviste silinmiş ama telefonda değişmiş kayıtlar (`kayit_id`): değişiklikleri gider, servis reddeder,
    /// ret listesine düşer (düzeltip yeni kayıt olarak eklenebilir).
    pub pc_silmisler: Vec<String>,
    /// Dökmede hemen ret listesine düşecek kayıtlar (`kayit_id`; okunamayan satır ya da birleşemeyen hal).
    pub ret_listesine: Vec<String>,
    /// Telefonda silinmiş, serviste hiç olmamış: gönderilmez, Silinenler'den düşer.
    pub dusecek_mezar: i32,
    /// Gidecek bir şey yok (serviste aynı ya da yalnız servis ilerlemiş: servisin hali görünür).
    pub ayni: i32,
    /// Yalnız serviste olan canlı kayıtlar: telefona gelecek.
    pub servisten_gelecek: i32,
    /// Kuyruğa girecek işlem sayısı.
    pub islem: i32,
    /// Olası çiftler (ikisi de tutulur, otomatik birleştirme yok). Onaydan sonra `olasi_ciftler` ile okunur.
    pub olasi_ciftler: Vec<OlasiCift>,
    /// Planın izi: `birlestirmeyi_onayla`'ya verilir; plan bu arada değiştiyse uygulanmaz.
    pub iz: String,
    /// Serviste olmayan taslaklar (`kayit_id`): servis kaydı taslak olarak alamaz (`ekle` onaylanmış kayıt
    /// doğurur). Gönderilmez; ret listesine düşer, görünen kopyadan çıkar (düzeltilirse yeni, onaylı kayıt
    /// olarak eklenir; atılırsa gider).
    #[uniffi(default)]
    pub taslaklar: Vec<String>,
    /// Telefon kayıtlarından PC temeli satırı okunamayanlar: temel bilinmiyor sayılır, telefonun servistekinden
    /// farklı her alanı gider (`degisen` ya da `pc_silmisler` içindedir).
    #[uniffi(default = 0)]
    pub okunamayan_pc_temeli: i32,
}

/// İki tarafın da değiştirdiği alanları olan kayıt.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CakisanKayit {
    pub kayit_id: String,
    /// Kayıt JSON'unun alan adları (`baslik`, `zaman`, `ornekler`...).
    pub alanlar: Vec<String>,
}

/// Olası çift: tekil anahtarı (tür, başlık, zaman çekirdeği) aynı, kimlikleri farklı iki kayıt; biri
/// telefonda doğmuş (servise yeni gidecek), öteki serviste olup telefonda olmayan. İkisi de tutulur.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct OlasiCift {
    /// Telefondan gelen kayıt.
    pub telefondaki: String,
    /// Servisten gelen kayıt (önizlemede henüz telefonda yok: `kayit` ile okunamaz).
    pub servisteki: String,
}

/// `Cekirdek::birlestirmeyi_onayla`'nın sonucu.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct BirlestirmeSonucu {
    /// Yanlışsa bu çağrı hiçbir şey yazmadı. Doğruysa birleştirme kalıcıdır (sonraki adımın, kuyruğun
    /// yollanmasının hatası bunu değiştirmez).
    pub uygulandi: bool,
    /// Uygulanan plan; `uygulandi` yanlışsa: `Some` iz verilmedi ya da plan önizlemeden sonra değişti (şimdiki
    /// plan, onun `iz`'iyle yeniden onaylanır), `None` onay bekleyen birleştirme yok: `zaten_uygulandi`
    /// doğruysa bu iz daha önce uygulandı, değilse bağlantı koptu (sonraki bağlantıda yeniden sorulur).
    pub plan: Option<BirlestirmeOnizlemesi>,
    /// Bekleyen birleştirme yok ve verilen `iz` en son uygulanan birleştirmeninki: ikinci (ya da gecikmiş)
    /// onay çağrısı. "Bağlantı koptu" değildir; birleştirme yapılmıştır.
    #[uniffi(default = false)]
    pub zaten_uygulandi: bool,
}
