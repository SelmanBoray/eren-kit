//! Yalnız köprüde yaşayan tipler (Kotlin'de `data class` / `sealed class`). Kayıt, zaman, hatırlatma,
//! tekrar ve kapalı listeler `model`'den doğrudan geçer. Bu dosya ilk dalgada dondurulur.

use crate::model::{
    AjandaKanalHatasi, AjandaKaydi, AjandaRetNedeni, AjandaYazar, AjandaZamani, IslemTuru, KayitDurumu, KayitGovdesi,
    KayitTuru, KuyrukRetNedeni,
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
    /// Aynı değişikliklerin işlem sayısı (`BaglantiDurumu.kuyrukta`'nın koparma anındaki değeri).
    pub gonderilmeyen_islem: i32,
    /// `gonderilmeyen_islem`'in yollanmış ama yanıtı gelmemiş olanları: PC'ye ulaşmış olabilir.
    pub yanitsiz_islem: i32,
    /// Ret listesinde kalan işlem sayısı (koparma ret listesine dokunmaz).
    pub ret_listesinde: i32,
    /// Yerel kipte çağrıldıysa: bir eşleşme ya da bekleyen eşleştirme (süren bağlanma) iptal edildi mi.
    pub baglanma_iptal: bool,
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
    /// eşitlenecek"). Yerel kipte ve v3 serviste hep yanlış.
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
    /// alanı değiştiren) işlemler sayılmaz: bu serviste gitmezler (`BaglantiYetenekleri.ertelenen`).
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
    /// değişiklikler; servisle v3 konuşulan ilk bağlantıda kendiliğinden giderler ("servis güncellenince
    /// eşitlenecek"). Yerel kipte 0.
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
    /// Bu uygulamanın yazdığı (ve okuyabildiği en yeni) biçim sürümü.
    pub bicim_surumu: i64,
    /// Belgenin en çok bayt uzunluğu; daha büyüğü okunmadan reddedilmeli (çekirdek de reddeder).
    pub belge_azami_bayt: u64,
    /// Bir ek dosyasının en çok bayt uzunluğu.
    pub ek_azami_bayt: u64,
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
    /// Belgeye girmeyen ret listesi işlemleri (kayıt değil, servise bağlı istek; kullanıcı önce düzeltmeli).
    pub ret_listesinde: i32,
    /// Aktarmanın yapıldığı kip (bağlı kipte görünen kopya, gönderilmemiş değişiklikler dahil).
    pub kip: CalismaKipi,
    /// Kaba `yol`'larıyla konacak ek dosyaları (bugün hep boş).
    pub ekler: Vec<EkDosyasi>,
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
    /// gider (servis yazar; kaynak izi, taslak işareti, zamanlar servisin olur).
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
    /// Şemadan ya da kurallardan geçmeyen, dosyada yinelenen ya da dilimi bilinmeyen: uygulanmaz.
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
}

/// `Cekirdek::ice_aktar`'ın sonucu.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct IceAktarmaSonucu {
    /// Yanlışsa hiçbir şey yazılmadı: verilen iz şimdiki planınkiyle tutmadı (telefon önizlemeden sonra
    /// değişti). `plan` yeni önizlemedir; kullanıcıya yeniden gösterilip onayıyla yeni `iz`'le çağrılır.
    pub uygulandi: bool,
    /// Uygulanan (ya da `uygulandi` yanlışsa uygulanacak) planın sayıları.
    pub plan: IceAktarmaOnizlemesi,
}
