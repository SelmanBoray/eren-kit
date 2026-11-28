//! SAHİBİ: R4. `/ajanda` kanal durum makinesi (sans-IO). Akış `docs/AJANDA.md` "Kanal akışı":
//! eşleştirme bekliyorsa `pair_request` -> `pair_result` (aynı bağlantıda sürer); eşleşmişse `hello` ->
//! `auth_challenge` (PC imzasını `KimlikKabugu.dogrula`) -> `auth_response` (`KimlikKabugu.imzala`) ->
//! `welcome` -> telafi (`kayit`...`esitlendi`) -> canlı; `esitlendi`'den sonra kuyruk birer birer.
//! Kurallar: `kural::{esitleme, kuyruk, birlesim, ornek}`.
//!
//! Çerçeve kuralı: her gelen çerçeve bağlantının sürümüyle `ajanda_asagi_coz_surum`'dan geçer, her giden
//! çerçeve onunla yazılır (`kodla_surum`); geçersiz ya da aşamaya uymayan çerçeve
//! (`welcome`'dan önce `kayit` gibi) bağlantıyı kapatır (`Etkiler.kapat`, aşama `Kapaniyor`: Kotlin
//! `baglanti_kapandi` diyene dek gelenler yok sayılır). `error` çerçevesi `son_hata`'ya yazılır, bağlantı
//! kapatılır. Çerçeve işlenirken depo hatası olursa da kapatılır: yarım telafi bir sonraki bağlantıda
//! baştan yapılır.
//!
//! Sürüm uyumu (D5, `docs/AJANDA.md` "Sürüm uyumu"; durum `KanalSurumu`):
//! - Bağlantı kümenin en büyüğüyle (`Surum::EN_YENI`) açılır; `pair_request` ve `hello` aynı sürümdedir.
//!   Bağlantının sürümü durumda tutulur, bütün çerçeveler onunla çözülür ve yazılır.
//! - `protokol_uyumsuz` (bağlantının sürümüyle ya da dondurulmuş zarfla başka sürümden okunan ret çerçevesi;
//!   ya da `auth_challenge`'dan önce çerçevesiz kapanış 1002: sonrasında servis sürümü kabul etmiştir, 1002
//!   sıradan kopmadır) kararı `ajanda_geri_dusus`'tür. `YenidenDene`:
//!   düşülen sürüm saklanır, bağlantı kapanır, `surum_uyusmazligi` yazılmaz, önceki `protokol_uyumsuz` kalkar (kabuk sıradan kopma
//!   gibi kısa beklemeyle yeniden bağlanır; yeni bağlantı düşülen sürümle açılır). `UygulamaEski`/`ServisEski`/`Bilinmiyor`:
//!   `son_hata = protokol_uyumsuz` ve `surum_uyusmazligi` (yeniden bağlanmayı geri çekmek kabuğun işidir).
//!   Hiçbir kayıt, kuyruk ya da alarm değişmez.
//! - Düşülen sürüm süreç boyunca tutulur; `YUKARI_DENEME_MS` dolunca bir sonraki bağlantı yeniden en
//!   büyükle açılır (servis bu arada güncellenmiş olabilir; eski serviste bedeli bir ret ve bir yeniden
//!   bağlanmadır). Düşülen sürümle açık kalan bağlantı o süre dolunca kasıtlı kapatılır (`yukari_denemesi`):
//!   servis bağlantı açıkken (ya da düşüşten kısa süre sonra yeniden başlayıp) güncellendiyse telefon alt
//!   sürümde kalmaz.
//! - Bağlantının sürümünden başka sürümlü öteki ret çerçeveleri (ör. sürüm sabitlenmeden önce gelen
//!   `zaman_asimi`) dondurulmuş zarfla (`ajanda_donmus_hata_oku`) okunur ve kodun kendisi olarak işlenir;
//!   geri düşüşe yol açmaz. Ret olmayan başka sürümlü çerçeve sözleşme dışıdır: `protokol_uyumsuz`, yönü
//!   çerçevenin `v`'sinin kümeye göre yeri (`kume_yonu`).
//! - v3 `hello` istemcinin yeteneklerini (`ISTEMCI_YETENEKLERI`) yollar; `welcome.yetenekler` bağlantının
//!   durumunda saklanır.
//! - Sunucu kopyası alt sürümlü bir bağlantıyla dolduysa (`KOPYA_SURUMU`; v3 öncesi kurulumda yok, 2
//!   sayılır) üst sürümlü ilk bağlantı tam telafi ister (`hello` boş kopya gibi): v2 bağlantıda gelmeyen
//!   v3 alanları değişmemiş kayıtlarda da gelir.
//! - v2 bağlantıda kuyruğun v3 alanı taşıyan işlemi ertelenir ("Erteleme" aşağıda): v2'de gidebilen kısım
//!   yerinde gider, v3 kalanı kuyrukta kalır ve servisle v3 konuşulan ilk bağlantıda kendiliğinden gider.
//!   Hiçbiri kuyruğu tıkamaz, hiçbir alan sessizce düşmez, kullanıcı atmadıkça hiçbiri ret listesine gitmez
//!   (aynı kaydın arkasındaki `sil` öne geçmez: "Sıra"; atma: "Serbest bırakma").
//!
//! Erteleme (v2 servis, v3 alanı). Bilinen servis sürümü `meta.servis_surumu`'dur (`SERVIS_SURUMU`: her
//! `welcome`'da o bağlantının sürümü yazılır; göç gerekmez, yoksa bilinmiyor sayılır). Erteleme yalnız bağlı
//! kipte ve bilinen servis sürümü v3'ten küçükken vardır (`erteleme_surumu`); yerel kipte hiç yoktur (servis
//! yok, v3 alanları kısıtsız: yerel yazar doğrudan uygular).
//! - Satırın hali (`kuyruk_ertelemeleri`): bekleyen satırın işlemi o sürümde gidemeyen alan taşıyorsa
//!   ertelenen değişikliği vardır; hiç gidecek kısmı yoksa (yalnız v3 alanı değiştiren `guncelle`) satır
//!   bütünüyle ertelenmiştir. Ayrı bir sütun yoktur: hal işlemden, bilinen sürümden ve kaydın önceki
//!   satırlarından hesaplanır.
//! - Sıra: kuyruk yine sırayla, birer birer gider; bütünüyle ertelenmiş satır yerinde kalır ve atlanır
//!   (arkasındaki alan işlemleri gider). Karma satır kuyruğun başına gelince bölünür (`v3_kalanini_ertele`,
//!   tek işlem): satır yerinde v2 kısmına döner (aynı `islem_id`, deneme, an) ve hemen yollanır; v3 kalanı
//!   yeni bir `islem_id`'yle hemen arkasına girer. v2 kısmı sonra gelen bir işlemin ardına geçmez. Kaydın
//!   sırası şu hallerde tutulur (satırla birlikte kaydın arkasındaki bütün satırları da bütünüyle ertelenmiş
//!   sayılır, v3'te sırayla gider): ertelenmiş satırın arkasındaki `sil`/`geri_yukle`/`ekle` (ertelenen
//!   değişiklik silinmiş kayda gidip ret listesine düşmesin) ve daha önce v3'te bütün olarak yollanmış
//!   (`deneme > 0`) karma satır (bölünmez: servis onu uygulamış olabilir; v3 kalanı yeni kimlikle ikinci kez
//!   uygulanıp PC'de arada değişen alanı ezmesin, bütün satır aynı `islem_id`'yle gider).
//! - Çakışma: ertelenen satırlar yalnız v3 alanlarına dokunur, onları atlayan v2 satırları yalnız v2
//!   alanlarına; aynı v3 alanına sonradan dokunan değişiklik de ertelenir ve sırada arkadadır: v3'te sırayla
//!   gidince sonraki kazanır, ertelenen onun üstüne yazmaz. İyimser hal (görünen kopya) kuyruğun sırasıyla
//!   hesaplanır; kayıt v3 alanlarıyla görünmeye devam eder.
//! - Ertelenen satır yollanmaz: denemesi artmaz, `Kopma` sayılmaz, kendiliğinden hiç atılmaz. Telafiler (tam
//!   ya da artımlı) onu taze kopya üstüne yeniden uygular. v3 bağlantının `welcome`'u bilinen sürümü 3 yapar;
//!   `esitlendi`'den sonra ertelenenler sıradaki yerlerinden gider.
//! - Kuyruk boşalması: `BaglantiDurumu.kuyrukta` bütünüyle ertelenmiş satırları saymaz (Kotlin'in "kuyruk
//!   boşalana dek" beklemeleri v2 serviste sonsuza dek beklemesin); onlar `BaglantiDurumu.ertelenen_islem`'dir
//!   (gönderilmemiş değişikliklerin toplamı `kuyrukta + ertelenen_islem`: kabuk "gönderilmemiş değişiklik
//!   yok" demeden ikisine de bakar). Ertelenen v3 değişikliği taşıyanların (karma dahil; sırası tutulan v2
//!   satırları, ör. bekleyen `sil`, sayılmaz) sayısı `baglanti_yetenekleri().ertelenen` (`ertelenenleri_at`'ın
//!   ret listesine koyacağı sayı), kayıt başına `KayitGorunumu.ertelenen` (yalnız ertelenmiş satırı olan
//!   kaydın `bekleyen`'i yanlıştır).
//! - Süresiz bekleme ve serbest bırakma: servis hiç güncellenmezse ertelenenler ve kaydın arkasında sırası
//!   tutulan satırlar (silme dahil) süresiz bekler. Kullanıcı `ertelenenleri_at` (kayıt ya da hepsi) ile
//!   ertelenen v3 değişikliklerini atıp kaydı serbest bırakır: her v3 değişikliği
//!   (yalnız v3 satırı bütünüyle, karma satırın v3 kalanı ayrı bir girdiyle) ret listesine `ertelenen_atildi`
//!   işaretiyle geçer (sessizce kaybolmaz; neden `teslim_edilemedi`), v2 kısımları yerinde kalır ve sırası
//!   tutulan satırlar bu serviste hemen gider; görünen kopya v3 değerini bırakır.
//! - Koparma ve depo değişimi (`yerel.rs` `bagli_kipten_cik`): ertelenenler öteki bekleyen satırlar gibi
//!   kuyrukla atılır; değerleri görünen kopyada (artık yerel gerçek) kalır, `KoparmaSonucu.gonderilmeyen_*`
//!   onları sayar (`gonderilmeyen_islem` = koparma anındaki `kuyrukta + ertelenen_islem`).
//!
//! Telafi (`kural::esitleme` ile aynı anlam, SQLite'ta: `depo/kopya.rs`):
//! - `welcome{tam:false}`: `depo_id` yazılır; gelen `kayit`'ler sunucu kopyasına (yalnız büyük revizyon)
//!   ve görünen kopyaya `TELAFI_TAMPONU`'luk işlemlerle yazılır, `son_rev` her işlemde ilerler (kesilen
//!   artımlı telafi kaldığı yerden sürer; tampondaki yazılmamışlar `son_rev`'i de ilerletmemiştir).
//! - `welcome{tam:true}`: gelenler `telafi_kayitlari`'na toplanır; görünen kopya, alarmlar, `son_rev`,
//!   `depo_id` değişmez. `esitlendi`'de tek işlemde toplanan kopya sunucu kopyasının yerine geçer, görünen
//!   kopya yeniden hesaplanır (kuyruk taze kopya üstüne yeniden uygulanır), sonra bütün alarmlar
//!   (`alarm_senkronu(&[])`) ve `Degisim.tumu`. Kopmada toplanan atılır.
//! - Canlı `kayit` hemen (tek işlem) uygulanır.
//! - Yerel kipte (bağlanma sürüyor, `yerel.rs` "Geçişler"): `hello` boş kopya gibi gider, telafi hep tam
//!   sayılıp toplanır; `esitlendi`'de `yereli_kuyruga_dok` yerel kayıtları kuyruğa döker ve kip `bagli` olur.
//! - Bağlı kipte `welcome` saklı `depo_id`'den farklı `depo_id` getirirse (D2) önce `depo_degisti` kipi
//!   yerele çevirir (veri kalır, eşleşme kalır); bağlantı yukarıdaki yerel kip yolundan sürer.
//!
//! Kuyruk (`kural::kuyruk::ajanda_kuyruk_karari`): yalnız `Canli`'da, en çok bir işlem yolda. Yollanan satır
//! kalıcı olarak `yollandi` işaretlenir; sonucu gelmeden bağlantı biterse (ya da süreç ölürse: sonraki
//! açılışta) `Kopma` sayılır. Yollanmadan kopmak olay değildir. Geçici ret (`ic_hata`) aynı `islem_id` ile
//! hemen yeniden yollanır (sınır `ISLEM_DENEME`). Başarıda servis bir revizyon verdiyse ve o `kayit` henüz
//! gelmediyse satır "onaylandı" olur (iyimser hal görünmeye devam eder; sıra garanti değil). Bozuk satır
//! (JSON çözülmüyor) yollanmadan `gecersiz_islem` ile ret listesine geçer: arkasındakileri tıkamaz.

use std::collections::{BTreeMap, BTreeSet};

use super::eslesme::Eslesme;
use super::iyimser::{gorunen_yenile, islem_coz, istenen_govde};
use super::{Etkiler, Motor, Ortam, TELAFI_TAMPONU};
use crate::depo::{KopyaTablosu, KuyrukSatiri, RetSatiri, anahtar};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{
    BaglantiAsamasi, BaglantiDurumu, BaglantiKipi, BaglantiYetenekleri, GecmisSatiri, GecmisSayfasi, SurumUyusmazligi,
};
use crate::kural::esitleme::HelloAlanlari;
use crate::kural::kuyruk::{KuyrukKarari, KuyrukOlayi, ajanda_kuyruk_karari};
use crate::model::json::Yazici;
use crate::model::metin::opak_id_mi;
use crate::model::kanonik::{base64_coz, base64_yaz};
use crate::model::{
    AJANDA_SURUMLERI, AjandaAsagi, AjandaEslestirmeQr, AjandaGecmisGirdisi, AjandaIslem, AjandaKanalHatasi, AjandaKaydi,
    AjandaRetNedeni, AjandaYukari, CozumKodu, GeriDusus, ImzaRolu, KuyrukRetNedeni, Surum, SurumBolumu,
    ajanda_asagi_coz_surum, ajanda_donmus_hata_oku, ajanda_geri_dusus, ajanda_kimlik_imza_metni,
};

/// WebSocket kapanış kodu 1002 (protokol hatası): servis bunu yalnız `protokol_uyumsuz` ile kullanır.
const KAPANIS_PROTOKOL_HATASI: i32 = 1002;

/// Düşülen sürümden yukarı yeniden deneme aralığı: bundan eski bir geri düşüşten sonraki ilk bağlantı yeniden
/// kümenin en büyüğüyle açılır; düşülen sürümle açık kalan bağlantı da bu süre dolunca, sonraki ilk köprü
/// çağrısında (gelen çerçeve, yazma, durum okuma; kabuk boştaki bağlantı için `BaglantiDurumu.yukari_deneme_ms`
/// anına yoklama kurar) yolda işlem yokken kasıtlı kapatılır (`yukari_denemesi`). Böylece servis güncellenince
/// uygulama düşüşten bir saat sonra (bağlantı açık olsa da) üst sürüme geçer: alt sürümde kalmak pahalıdır (v2
/// bağlantıda v3 alanlı işlemler ertelenir, PC'nin v3 alanları gelmez). Eski serviste bedeli saatte en çok bir
/// kısa ret ve bir yeniden bağlanmadır. Yolda işlem varken beklenir (sonucu gelmeden kapatmak `Kopma` sayılırdı).
pub(crate) const YUKARI_DENEME_MS: i64 = 60 * 60 * 1000;

/// v3 `hello`'nun istediği yetenekler (`AjandaYetenekler`: ASCII artan, tekil). Bugün boş: istemci hiçbir
/// yeteneğin davranışını uygulamıyor. `ek_yedegi` ek yükleme ve indirme (`ek_*` çerçeveleri) yazılınca
/// eklenir, öncesinde değil (servis yeteneği yalnız istenince kesişime koyar). Test sabitler.
pub(crate) const ISTEMCI_YETENEKLERI: [&str; 0] = [];

/// `meta` anahtarı: sunucu kopyasının dolduğu en düşük bağlantı sürümü (tam telafinin sonunda o bağlantının
/// sürümü; alt sürümlü bağlantının `welcome`'unda o sürüm). Yoksa 2 sayılır: v3 öncesi kurulumun kopyası v2
/// bağlantıyla doldu. Kopyadan büyük sürümlü bağlantı tam telafi ister (`hello_yolla`).
pub(super) const KOPYA_SURUMU: &str = "kopya_surumu";

/// `meta` anahtarı: bilinen servis sürümü, son `welcome`'un bağlantı sürümü ("Erteleme"). Yoksa bilinmiyor:
/// erteleme yok (bu sürümden önceki kurulum ilk `welcome`'a dek eskisi gibi sayar).
const SERVIS_SURUMU: &str = "servis_surumu";

/// Bir kuyruk satırının ertelemedeki hali (`satir_ertelemesi`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SatirErtelemesi {
    /// Ertelenen değişikliği yok (ya da erteleme yok).
    Yok,
    /// Bilinen sürümde gidecek kısmı var, v3 kalanı ertelenecek (karma satır, henüz bölünmedi).
    Kismen,
    /// Bilinen sürümde gidecek kısmı yok: satır bütünüyle ertelenmiş, yollanmaz.
    Tam,
}

/// Ertelemenin sürümü: bağlı kipte bilinen servis sürümü v3'ten küçükse o, değilse (yerel kip, v3 servis,
/// bilinmeyen sürüm) `None`. Yalnız `Depo` okur (sorgular okuma bağlantısında da çağırır).
pub(super) fn erteleme_surumu(d: &crate::depo::Depo) -> Result<Option<Surum>, CekirdekHatasi> {
    if d.yerel_kip_mi()? {
        return Ok(None);
    }
    let s = d.meta_oku(SERVIS_SURUMU)?.and_then(|m| m.parse::<i64>().ok()).and_then(Surum::coz);
    Ok(s.filter(|s| !s.v3_mu()))
}

/// Satırların ertelemedeki halleri, kuyruk sırasıyla ("Erteleme" "Sıra"). `satirlar` kuyruğun (ya da bir
/// kaydın) satırlarıdır, sırayla; hal kaydın kendi önceki satırlarına bağlıdır, öteki kayıtlara bağlı değildir
/// (bir kaydın satırlarıyla hesaplanan hal bütün kuyrukla hesaplananla aynıdır). Onaylanmış, yollanmış ya da
/// çözülemeyen satır ertelenmiş sayılmaz. `Tam` olanlar:
/// - yalnız v3 alanı değiştiren `guncelle` (bu sürümde gidecek kısmı yok);
/// - daha önce yollanmış (`deneme > 0`) karma satır: bölünmez, bütünüyle bekler. Karma satır alt sürümde
///   bölünmeden yollanmaz, yani bir v3 bağlantıda bütün olarak gitmiştir ve servis onu uygulamış olabilir;
///   bölünse v3 kalanı yeni kimlikle ikinci kez uygulanır, arada PC'de değişen alanı eski değerle ezerdi.
///   Bütün satır v3'te aynı `islem_id`'yle gider (servis uyguladıysa önbelleğinden döner);
/// - kaydın bütünüyle ertelenmiş bir satırının arkasındaki `sil`, `geri_yukle`, `ekle` (öne geçseydi
///   ertelenen değişiklik silinmiş kayda gider, `kayit_silinmis` ile ret listesine düşerdi) ve kaydın bu
///   satırlarından ya da yukarıdaki karma satırdan sonraki bütün satırları (kaydın sırası tutulur).
///
/// Ertelenmiş satırın arkasındaki öteki alan işlemleri (`guncelle`, `durum`, `onayla`) öne geçer: ertelenen
/// yalnız v3 alanlarına dokunur, onlar yalnız v2 alanlarına (karma olan bölünür).
pub(super) fn kuyruk_ertelemeleri(satirlar: &[KuyrukSatiri], surum: Option<Surum>) -> Vec<SatirErtelemesi> {
    let Some(surum) = surum else { return vec![SatirErtelemesi::Yok; satirlar.len()] };
    // Bütünüyle ertelenmiş (yalnız v3) satırı olan kayıtlar ve sırası tutulan (bütün satırları bekleyen) kayıtlar.
    let mut ertelenmis: BTreeSet<&str> = BTreeSet::new();
    let mut tutulan: BTreeSet<&str> = BTreeSet::new();
    satirlar
        .iter()
        .map(|s| {
            if s.bekledigi_rev.is_some() || s.yollandi {
                return SatirErtelemesi::Yok;
            }
            let k = s.kayit_id.as_str();
            // Ucuz ön süzgeç: v3 alan adı geçmeyen ve kaydı ertelemede olmayan satır çözülmeden `Yok`'tur
            // (her durum okumasında bütün kuyruk çözülmesin; R6 ölçümü: 5 000 satırda çözmek ~0,4 s).
            if !ertelenmis.contains(k) && !tutulan.contains(k) && !v3_alani_gecebilir(&s.islem_json) {
                return SatirErtelemesi::Yok;
            }
            let Some(islem) = islem_coz(&s.islem_json) else { return SatirErtelemesi::Yok };
            if tutulan.contains(k) {
                return SatirErtelemesi::Tam;
            }
            match islem.surume_bol(surum) {
                SurumBolumu { gidecek: None, .. } => {
                    ertelenmis.insert(k);
                    SatirErtelemesi::Tam
                }
                SurumBolumu { kalan: Some(_), .. } if s.deneme > 0 => {
                    tutulan.insert(k);
                    SatirErtelemesi::Tam
                }
                _ if ertelenmis.contains(k)
                    && matches!(islem, AjandaIslem::Sil { .. } | AjandaIslem::GeriYukle { .. } | AjandaIslem::Ekle { .. }) =>
                {
                    tutulan.insert(k);
                    SatirErtelemesi::Tam
                }
                SurumBolumu { kalan: None, .. } => SatirErtelemesi::Yok,
                SurumBolumu { .. } => SatirErtelemesi::Kismen,
            }
        })
        .collect()
}

/// v3 alanlarının (`AjandaAlani::HEPSI[V2_ADEDI..]`) JSON anahtarı olarak yazımı.
const V3_ANAHTARLARI: [&str; 6] = ["\"simge\"", "\"bolge\"", "\"bolge_konumu\"", "\"varis\"", "\"baglantilar\"", "\"ekler\""];

/// İşlem metninde bir v3 alanı geçebilir mi (`kuyruk_ertelemeleri`'nin ön süzgeci). Yanlış olumlu (ör. başlıkta
/// geçen ad) yalnız çözmeye yol açar; v3 alanı taşıyan işlemin metninde anahtar hep vardır.
fn v3_alani_gecebilir(json: &str) -> bool {
    V3_ANAHTARLARI.iter().any(|a| json.contains(a))
}

/// Bölümün ertelenecek bir v3 değişikliği var mı: alt sürümde gidecek kısmı yok (yalnız v3 `guncelle`) ya da
/// v3 kalanı var (karma). Sırası tutulan v2 satırında (ör. `sil`) yoktur.
fn v3_degisikligi_var(b: &SurumBolumu) -> bool {
    b.gidecek.is_none() || b.kalan.is_some()
}

/// Ret listesinde (`ret_listesi.neden`, yerel ad) kullanıcının attığı ertelenen v3 değişikliği
/// (`Motor::ertelenenleri_at`). Köprüde `KuyrukRetNedeni::TeslimEdilemedi` ve `RetGirdisi.ertelenen_atildi`
/// olarak görünür (`sorgu.rs`): kapalı neden listesi (TS `AJANDA_KUYRUK_RET_NEDENLERI` ile ortak) değişmez.
pub(super) const ERTELENEN_ATILDI: &str = "ertelenen_atildi";

/// Ertelemesi olabilecek satırlar: onaylanmamış bir satırının metninde v3 alan adı geçen kayıtların bütün
/// satırları, sırayla (SQL'de süzülür). Öteki kayıtların her satırı `Yok`'tur (hal kayıt başınadır, v3 alanı
/// taşımayan kayıtta bütünüyle ertelenmiş satır olmaz): sayım ve atlama bütün kuyruğu okumaz.
fn erteleme_adaylari(d: &crate::depo::Depo) -> Result<Vec<KuyrukSatiri>, CekirdekHatasi> {
    d.kuyruk_parcali_kayitlar(&V3_ANAHTARLARI)
}

/// Ret olmayan, bağlantıdan başka sürümlü çerçevenin yönü: `v`'si kümenin en büyüğünden büyükse uygulama
/// eski, en küçüğünden küçükse servis eski; öteki hal (kümede ama bağlantının değil, okunamıyor) bilinmez.
fn kume_yonu(metin: &str) -> SurumUyusmazligi {
    let v = serde_json::from_str::<serde_json::Value>(metin).ok().and_then(|d| d.get("v")?.as_f64());
    let (en_kucuk, en_buyuk) = (Surum::HEPSI[0].no() as f64, Surum::EN_YENI.no() as f64);
    match v {
        Some(v) if v > en_buyuk => SurumUyusmazligi::UygulamaEski,
        Some(v) if v < en_kucuk => SurumUyusmazligi::ServisEski,
        _ => SurumUyusmazligi::Bilinmiyor,
    }
}

/// Kanalın sürüm durumu (bellek içi, `Motor.surum`). Süreç ölünce düşülen sürüm de unutulur: yeni süreç
/// en büyükle açar.
pub(crate) struct KanalSurumu {
    /// Açık (ya da son açılan) bağlantının sürümü: `pair_request`/`hello` bununla gitti, bütün çerçeveler
    /// bununla çözülür ve yazılır.
    baglanti: Surum,
    /// `protokol_uyumsuz` sonrası düşülen sürüm ve düşüş anı (`YenidenDene`).
    dusulen: Option<(Surum, i64)>,
    /// Bu bağlantının `welcome.yetenekler`'i (v3; istenenlerle sunulanların kesişimi). Bağlantı açılınca ve
    /// kapanınca boşalır.
    yetenekler: Vec<String>,
    /// Alt sürümlü bağlantıda `kuyruk_ilerlet`'in atlama önbelleği (`Atlama`). Bağlantı açılınca ve kapanınca,
    /// kuyruğun önekini değiştiren her yazımda (ertelenenleri atma) boşalır; izi tutmazsa kendiliğinden atılır.
    atlama: Option<Atlama>,
}

impl KanalSurumu {
    pub(crate) fn yeni() -> Self {
        KanalSurumu { baglanti: Surum::EN_YENI, dusulen: None, yetenekler: Vec::new(), atlama: None }
    }
}

/// Kuyruğun başından `son`'a dek (dahil) onaylanmamış bütün satırların bütünüyle ertelenmiş (`Tam`) bulunduğu
/// önek: alt sürümlü bağlantıda her gönderim baştaki ertelenmiş satırları yeniden yürüyüp çözmesin (bulgu 3:
/// k ertelenmiş satırın arkasındaki N işlemin boşalması O(N·k) okuma ve çözme idi). Önekteki bir satırın hali
/// yalnız kendi kaydının önceki satırlarına bağlıdır; onlar da önektedir (ya da onaylanmıştır: onaylanmış satır
/// hali etkilemez). Yeni satır hep arkaya girer (`AUTOINCREMENT`), gönderim önekin arkasındaki satıra dokunur.
/// Öneki değiştirebilecek tek yol satır silmek ya da yerinde yazmaktır: `iz` (`Depo::kuyruk_onek_izi`: adet,
/// deneme ve bayt toplamı) her kullanımda denetlenir, tutmazsa önbellek atılıp baştan yürünür.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Atlama {
    son: i64,
    iz: (i64, i64, i64),
}

/// Bağlantının bellek içi aşaması.
pub(crate) enum Asama {
    Kopuk,
    /// Motor kapattı (`Etkiler.kapat`); Kotlin `baglanti_kapandi` diyene dek gelen çerçeveler yok sayılır.
    Kapaniyor,
    /// `pair_request` yollandı.
    Eslestirme { qr: AjandaEslestirmeQr },
    /// `hello` yollandı, `auth_challenge` bekleniyor.
    Hello { eslesme: Eslesme, client_nonce: String },
    /// `auth_response` yollandı, `welcome` bekleniyor.
    Yanit,
    Telafi(Telafi),
    Canli,
}

pub(crate) struct Telafi {
    /// `Some((depo_id, son_rev))`: tam telafi sürüyor; toplanan kopyanın kimliği ve ulaştığı revizyon.
    tam: Option<(String, i64)>,
    /// Henüz yazılmamış `kayit` çerçeveleri (en çok `TELAFI_TAMPONU`).
    tampon: Vec<AjandaKaydi>,
}

impl Asama {
    fn disari(&self) -> BaglantiAsamasi {
        match self {
            Asama::Kopuk | Asama::Kapaniyor => BaglantiAsamasi::Kopuk,
            Asama::Eslestirme { .. } => BaglantiAsamasi::Eslestirme,
            Asama::Hello { .. } | Asama::Yanit => BaglantiAsamasi::ElSikisma,
            Asama::Telafi(_) => BaglantiAsamasi::Telafi,
            Asama::Canli => BaglantiAsamasi::Canli,
        }
    }
}

/// Aşamanın kısa adı (çerçeve eşleştirmesi; `Asama`'yı ödünç almadan).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Tur {
    Kopuk,
    Eslestirme,
    Hello,
    Yanit,
    Telafi,
    Canli,
}

pub(super) fn gecmis_satiri(g: AjandaGecmisGirdisi) -> GecmisSatiri {
    let onceki = g.onceki.json();
    let sonraki = g.sonraki.json();
    let mut alanlar: BTreeSet<String> = BTreeSet::new();
    for v in [&onceki, &sonraki] {
        if let Some(n) = v.as_object() {
            alanlar.extend(n.keys().cloned());
        }
    }
    GecmisSatiri {
        rev: g.rev,
        ts_ms: g.ts_ms,
        islem: g.islem,
        yazar: g.yazar,
        ornek_tarihi: g.ornek_tarihi,
        alanlar: alanlar.into_iter().collect(),
        onceki_json: onceki.to_string(),
        sonraki_json: sonraki.to_string(),
    }
}

impl Motor {
    fn tur(&self) -> Tur {
        match self.asama {
            Asama::Kopuk | Asama::Kapaniyor => Tur::Kopuk,
            Asama::Eslestirme { .. } => Tur::Eslestirme,
            Asama::Hello { .. } => Tur::Hello,
            Asama::Yanit => Tur::Yanit,
            Asama::Telafi(_) => Tur::Telafi,
            Asama::Canli => Tur::Canli,
        }
    }

    /// Aşamayı değiştirir; dışarıdan görünen aşama değiştiyse `Degisim.baglanti`.
    fn asama_yaz(&mut self, e: &mut Etkiler, yeni: Asama) {
        if self.asama.disari() != yeni.disari() {
            e.degisim.baglanti = true;
        }
        self.asama = yeni;
    }

    /// Bağlantıyı kapatır: Kotlin soketi kapatıp `baglanti_kapandi`'yı çağırır.
    pub(crate) fn kapat(&mut self, e: &mut Etkiler, neden: &str) {
        e.kapat = Some(neden.to_string());
        self.asama_yaz(e, Asama::Kapaniyor);
    }

    fn kanal_hatasi(&mut self, e: &mut Etkiler, kod: AjandaKanalHatasi, neden: &str) {
        self.son_hata = Some(kod);
        if kod != AjandaKanalHatasi::ProtokolUyumsuz {
            self.surum_uyusmazligi = None;
        } else if self.surum_uyusmazligi.is_none() {
            self.surum_uyusmazligi = Some(SurumUyusmazligi::Bilinmiyor);
        }
        e.degisim.baglanti = true;
        self.kapat(e, neden);
    }

    /// Açık (ya da son açılan) bağlantının sürümü.
    pub(crate) fn baglanti_surumu(&self) -> Surum {
        self.surum.baglanti
    }

    /// Bu bağlantının `welcome.yetenekler`'inde `ad` var mı (ek yedeği yazılınca yüklemeyi bu açar).
    #[cfg_attr(not(test), allow(dead_code, reason = "ek yedeği (ek_yedegi) yazılınca kanal kullanacak; bugün testler okur"))]
    pub(crate) fn kanal_yetenegi(&self, ad: &str) -> bool {
        self.surum.yetenekler.iter().any(|y| y == ad)
    }

    /// Yeni bağlantının sürümü: düşülen sürüm `YUKARI_DENEME_MS`'ten tazeyse o, değilse (ya da saat geri
    /// gittiyse) en büyük; eskimiş düşüş unutulur.
    fn acilis_surumu(&mut self, simdi_ms: i64) -> Surum {
        match self.surum.dusulen {
            Some((s, an)) if (0..YUKARI_DENEME_MS).contains(&simdi_ms.saturating_sub(an)) => s,
            _ => {
                self.surum.dusulen = None;
                Surum::EN_YENI
            }
        }
    }

    /// Sunucu kopyasının dolduğu en düşük bağlantı sürümü (`KOPYA_SURUMU`; yoksa ya da okunamazsa v2).
    fn kopya_surumu(&self) -> Result<Surum, CekirdekHatasi> {
        let s = self.depo.meta_oku(KOPYA_SURUMU)?.and_then(|m| m.parse::<i64>().ok()).and_then(Surum::coz);
        Ok(s.unwrap_or(Surum::V2))
    }

    /// Bağlı kipte kopya bu bağlantıdan alt bir sürümle doldu (`hello_yolla`): `hello` boş kopya gibi, izsiz
    /// gider; servisin tam telafisi yedekten dönüş kanıtı değildir (`esitlendi`).
    fn kopya_eski(&self) -> Result<bool, CekirdekHatasi> {
        Ok(!self.yerel_mi()? && self.depo.depo_id()?.is_some() && self.kopya_surumu()? < self.surum.baglanti)
    }

    /// `protokol_uyumsuz`'un kararı (`ajanda_geri_dusus`; `ret`: ret çerçevesinden okunan sürüm, çerçevesiz
    /// 1002'de `None`). Bağlantıyı kapatmak çağıranın işidir. `YenidenDene`'de uyuşmazlık yazılmaz (öncekinin
    /// `protokol_uyumsuz`'u kalkar): kabuk sıradan kopma gibi yeniden bağlanır, yeni bağlantı düşülen sürümle
    /// açılır.
    fn geri_dus(&mut self, o: &Ortam, e: &mut Etkiler, ret: Option<i64>) {
        e.degisim.baglanti = true;
        let yon = match ajanda_geri_dusus(self.surum.baglanti.no(), ret, &AJANDA_SURUMLERI) {
            // `ajanda_geri_dusus` yalnız kümedeki sürümü önerir.
            GeriDusus::YenidenDene { surum } => match Surum::coz(surum) {
                Some(s) => {
                    // Önceki denemenin uyuşmazlığı da kalkar: alt sürüm denenecek, kullanıcıya gösterilecek
                    // bir ret yok (öteki kanal hataları olduğu gibi kalır).
                    self.surum.dusulen = Some((s, o.simdi_ms()));
                    self.surum_uyusmazligi = None;
                    if self.son_hata == Some(AjandaKanalHatasi::ProtokolUyumsuz) {
                        self.son_hata = None;
                    }
                    return;
                }
                None => SurumUyusmazligi::Bilinmiyor,
            },
            GeriDusus::UygulamaEski => SurumUyusmazligi::UygulamaEski,
            GeriDusus::ServisEski => SurumUyusmazligi::ServisEski,
            GeriDusus::Bilinmiyor => SurumUyusmazligi::Bilinmiyor,
        };
        self.son_hata = Some(AjandaKanalHatasi::ProtokolUyumsuz);
        self.surum_uyusmazligi = Some(yon);
    }

    /// Soket açıldı (köprü taşımayı kaydetti). Bağlantının sürümü seçilir (`acilis_surumu`). Eşleştirme
    /// bekliyorsa `pair_request`, eşleşmişse `hello`, ikisi de o sürümle. Önceki süreçten sonucu gelmeden
    /// kalmış işlem burada `Kopma` sayılır.
    pub(crate) fn baglanti_acildi(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        if !matches!(self.asama, Asama::Kopuk) {
            self.baglanti_kapandi(o, e, None)?;
        }
        self.kopmalari_isle(o, e)?;
        self.surum.baglanti = self.acilis_surumu(o.simdi_ms());
        self.surum.yetenekler.clear();
        self.surum.atlama = None;
        if let Some(qr) = self.bekleyen_qr()? {
            let public_key = base64_yaz(&o.kimlik.acik_anahtar()?);
            let m = AjandaYukari::PairRequest { kod: qr.kod.clone(), public_key, etiket: None };
            e.gonderilecek.push(m.kodla_surum(self.surum.baglanti));
            self.asama_yaz(e, Asama::Eslestirme { qr });
            return Ok(());
        }
        match self.eslesme_oku()? {
            Some(eslesme) => self.hello_yolla(o, e, eslesme),
            None => Err(CekirdekHatasi::Eslesme { mesaj: "eşleşme yok; önce eslestirme_baslat".into() }),
        }
    }

    fn hello_yolla(&mut self, o: &Ortam, e: &mut Etkiler, eslesme: Eslesme) -> Result<(), CekirdekHatasi> {
        let client_nonce = base64_yaz(&o.kimlik.rastgele(32)?);
        let s = self.surum.baglanti;
        // Yerel kipte boş kopya gibi (`son_rev` 0, `depo_id` yok): servis hep tam telafi yapar, koparma
        // anındaki PC temeli artımlı telafiyle ezilmez (`yerel.rs` "Geçişler"). Bağlı kipte kopya bu
        // bağlantıdan alt bir sürümle dolduysa da boş kopya gibi: tam telafi, alt sürümün taşımadığı alanlar
        // (v2 bağlantıda v3 alanları) değişmemiş kayıtlarda da gelir. Kopya hiç yoksa (`depo_id` yok) servis
        // zaten tam der.
        let yerel = self.yerel_mi()?;
        let kopya_eski = self.kopya_eski()?;
        let h = if yerel || kopya_eski {
            HelloAlanlari { son_rev: 0, depo_id: None, son_rev_izi: None }
        } else {
            self.depo.hello_alanlari()?
        };
        let m = AjandaYukari::Hello {
            device_id: eslesme.device_id.clone(),
            son_rev: h.son_rev,
            depo_id: h.depo_id,
            son_rev_izi: h.son_rev_izi,
            client_nonce: client_nonce.clone(),
            yetenekler: s.v3_mu().then(|| ISTEMCI_YETENEKLERI.iter().map(|y| y.to_string()).collect()),
        };
        e.gonderilecek.push(m.kodla_surum(s));
        self.asama_yaz(e, Asama::Hello { eslesme, client_nonce });
        Ok(())
    }

    /// Bağlantının sürümüyle çözülemeyen (`protokol_uyumsuz`: başka `v`) çerçeve. Dondurulmuş `error`
    /// zarfına uyuyorsa: `protokol_uyumsuz` geri düşüştür (`v`'si servisin en yüksek sürümü), öteki kod
    /// kodun kendisidir (bu tarafın kümesinde yoksa `gecersiz_mesaj`). Uymuyorsa sözleşme dışı bir çerçevedir:
    /// `protokol_uyumsuz`, yönü `kume_yonu`. Her durumda bağlantı kapanır.
    fn surum_disi_cerceve(&mut self, o: &Ortam, e: &mut Etkiler, metin: &str) {
        match ajanda_donmus_hata_oku(metin) {
            Some(h) if h.code == AjandaKanalHatasi::ProtokolUyumsuz.ad() => {
                self.geri_dus(o, e, Some(h.v));
                self.kapat(e, AjandaKanalHatasi::ProtokolUyumsuz.ad());
            }
            Some(h) => {
                let kod = AjandaKanalHatasi::coz(&h.code).unwrap_or(AjandaKanalHatasi::GecersizMesaj);
                self.kanal_hatasi(e, kod, kod.ad());
            }
            None => {
                self.surum_uyusmazligi = Some(kume_yonu(metin));
                self.kanal_hatasi(e, AjandaKanalHatasi::ProtokolUyumsuz, CozumKodu::ProtokolUyumsuz.ad());
            }
        }
    }

    /// Gelen metin çerçevesi (bağlantının sürümüyle `ajanda_asagi_coz_surum`'dan geçirilir; geçersizse kapat).
    pub(crate) fn cerceve_geldi(&mut self, o: &Ortam, e: &mut Etkiler, metin: &str) -> Result<(), CekirdekHatasi> {
        if self.tur() == Tur::Kopuk {
            return Ok(());
        }
        let m = match ajanda_asagi_coz_surum(metin, Some(self.surum.baglanti)) {
            Ok((_, m)) => m,
            Err(h) if h.kod == CozumKodu::ProtokolUyumsuz => {
                self.surum_disi_cerceve(o, e, metin);
                return Ok(());
            }
            Err(h) => {
                self.kanal_hatasi(e, h.kod.kanal_hatasi(), h.kod.ad());
                return Ok(());
            }
        };
        let sonuc = self.cerceveyi_isle(o, e, m);
        if sonuc.is_err() {
            // Depo ya da kabuk hatası: yarım kalan telafi/işlem sonraki bağlantıda baştan yapılır. Aşama
            // hangisi olursa olsun (işleyici hatadan önce `Kapaniyor`'a geçirmiş olabilir: o zaman taşımaya
            // henüz kapat gitmemiştir) taşıma kapattırılır; yoksa soket açık ama işlemez kalır. Buraya
            // girerken aşama `Kopuk`/`Kapaniyor` değildi (yukarıda dönülür), yani kapat bu çerçeveye aittir.
            self.kanal_hatasi(e, AjandaKanalHatasi::IcHata, "iç hata");
        }
        sonuc
    }

    fn cerceveyi_isle(&mut self, o: &Ortam, e: &mut Etkiler, m: AjandaAsagi) -> Result<(), CekirdekHatasi> {
        match (self.tur(), m) {
            (_, AjandaAsagi::Error { code: AjandaKanalHatasi::ProtokolUyumsuz, .. }) => {
                // Bağlantının sürümüyle gelen ret: ret sürümü denenenin kendisidir (`bilinmiyor`).
                self.geri_dus(o, e, Some(self.surum.baglanti.no()));
                self.kapat(e, AjandaKanalHatasi::ProtokolUyumsuz.ad());
                Ok(())
            }
            (_, AjandaAsagi::Error { code, .. }) => {
                self.kanal_hatasi(e, code, code.ad());
                Ok(())
            }
            (Tur::Eslestirme, AjandaAsagi::PairResult { ok, device_id, code, .. }) => {
                let Asama::Eslestirme { qr } = std::mem::replace(&mut self.asama, Asama::Kapaniyor) else { unreachable!() };
                e.degisim.eslesme = true;
                match (ok, device_id) {
                    (true, Some(device_id)) => {
                        let eslesme = self.eslesme_kaydet(&qr, &device_id)?;
                        // Bağlantı açık kalır: aynı bağlantıda kimlik doğrulamasıyla sürer.
                        self.hello_yolla(o, e, eslesme)
                    }
                    _ => {
                        let kod = code.unwrap_or(AjandaKanalHatasi::IcHata);
                        self.eslesme_reddedildi(kod)?;
                        self.kanal_hatasi(e, kod, "eşleştirme reddedildi");
                        Ok(())
                    }
                }
            }
            (Tur::Hello, AjandaAsagi::AuthChallenge { server_nonce, server_signature }) => {
                let Asama::Hello { eslesme, client_nonce } = std::mem::replace(&mut self.asama, Asama::Kapaniyor) else {
                    unreachable!()
                };
                self.sinamayi_yanitla(o, e, &eslesme, &client_nonce, &server_nonce, &server_signature)
            }
            (Tur::Yanit, AjandaAsagi::Welcome { depo_id, tam, yetenekler, .. }) => {
                self.surum.yetenekler = yetenekler.unwrap_or_default();
                // Alt sürümlü bağlantı kopyaya o sürümün taşıdığı kadarını yazar: üst sürümün ilk bağlantısı
                // tam telafi istesin (`hello_yolla`).
                let s = self.surum.baglanti;
                if s < Surum::EN_YENI {
                    self.depo.meta_yaz(KOPYA_SURUMU, Some(&s.no().to_string()))?;
                }
                self.servis_surumunu_yaz(e, s)?;
                // D2, kesin kural: bağlı kipte saklı `depo_id`'den farklı depo (başka servisle yeni eşleşme ya
                // da sıfırdan kurulmuş servis) görünen kopyayı tam telafisiyle ezemez. Önce koparmanın veri
                // kısmı (`depo_degisti`, eşleşme kalır), sonra bu bağlantı aşağıda yerel kipten bağlanma
                // olarak sürer. Saklı `depo_id` yoksa (ilk `welcome`) bugünkü gibi.
                if !self.yerel_mi()?
                    && let Some(eski) = self.depo.depo_id()?
                    && eski != depo_id
                {
                    self.depo_degisti(o, e, &depo_id)?;
                }
                // Tam telafi kuyruğa dokunmaz (`ajanda_kuyruk_karari(TamTelafi)` = `Bekle`, deneme aynı):
                // işlemler `esitlendi`'de taze kopya üstüne yeniden uygulanır ve sırayla yeniden gider.
                // Yerel kipte telafi hep toplanır (servis boş `hello`'ya zaten tam der): PC temeli bağlanma
                // bitene dek koparma anındaki haliyle kalmalı.
                let tam = if tam || self.yerel_mi()? {
                    self.depo.telafiyi_sil()?;
                    Some((depo_id, 0))
                } else {
                    self.depo.depo_id_yaz(&depo_id)?;
                    None
                };
                self.asama_yaz(e, Asama::Telafi(Telafi { tam, tampon: Vec::new() }));
                Ok(())
            }
            (Tur::Telafi, AjandaAsagi::Kayit { kayit }) => {
                let Asama::Telafi(t) = &mut self.asama else { unreachable!() };
                t.tampon.push(kayit);
                if t.tampon.len() >= TELAFI_TAMPONU {
                    self.telafi_tamponunu_yaz(o, e)?;
                }
                Ok(())
            }
            (Tur::Telafi, AjandaAsagi::Esitlendi { .. }) => self.esitlendi(o, e),
            (Tur::Canli, AjandaAsagi::Kayit { kayit }) => self.sunucu_kayitlarini_uygula(o, e, vec![kayit]),
            (Tur::Canli, AjandaAsagi::IslemSonucu { islem_id, ok, rev, code, .. }) => self.islem_sonucu(o, e, &islem_id, ok, rev, code),
            (Tur::Canli, AjandaAsagi::Gecmis { istek_id, kayit_id, girdiler, devami, code }) => {
                self.gecmis_geldi(e, &istek_id, &kayit_id, girdiler, devami, code);
                Ok(())
            }
            (_, m) => {
                self.kanal_hatasi(e, AjandaKanalHatasi::GecersizMesaj, &format!("beklenmeyen çerçeve: {}", m.tur()));
                Ok(())
            }
        }
    }

    /// `auth_challenge`: PC imzasını QR'daki anahtarla doğrula, telefonun imzasını yolla.
    fn sinamayi_yanitla(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        eslesme: &Eslesme,
        client_nonce: &str,
        server_nonce: &str,
        server_signature: &str,
    ) -> Result<(), CekirdekHatasi> {
        let pc_metni = ajanda_kimlik_imza_metni(ImzaRolu::Pc, &eslesme.device_id, client_nonce, server_nonce);
        let gecerli = match (base64_coz(&eslesme.server_public_key), base64_coz(server_signature)) {
            (Some(anahtar), Some(imza)) => o.kimlik.dogrula(anahtar, pc_metni.into_bytes(), imza)?,
            _ => false,
        };
        if !gecerli {
            self.kanal_hatasi(e, AjandaKanalHatasi::ImzaGecersiz, "PC imzası geçersiz");
            return Ok(());
        }
        let metin = ajanda_kimlik_imza_metni(ImzaRolu::Telefon, &eslesme.device_id, client_nonce, server_nonce);
        let imza = o.kimlik.imzala(metin.into_bytes())?;
        e.gonderilecek.push(AjandaYukari::AuthResponse { signature: base64_yaz(&imza) }.kodla_surum(self.surum.baglanti));
        self.asama_yaz(e, Asama::Yanit);
        Ok(())
    }

    /// Tam telafi sürüyor mu (testler).
    #[cfg(test)]
    pub(super) fn tam_telafi_suruyor(&self) -> bool {
        matches!(&self.asama, Asama::Telafi(Telafi { tam: Some(_), .. }))
    }

    /// Telafi tamponunu yazar: tam telafide toplanan kopyaya, artımlıda sunucu ve görünen kopyaya.
    pub(super) fn telafi_tamponunu_yaz(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        let Asama::Telafi(t) = &mut self.asama else { return Ok(()) };
        let tampon = std::mem::take(&mut t.tampon);
        if t.tam.is_none() {
            return self.sunucu_kayitlarini_uygula(o, e, tampon);
        }
        self.depo.yazma(|d| {
            for k in &tampon {
                d.kopya_kaydi_uygula(KopyaTablosu::Telafi, k)?;
            }
            Ok(())
        })?;
        if let Asama::Telafi(Telafi { tam: Some((_, son_rev)), .. }) = &mut self.asama {
            *son_rev = tampon.iter().map(|k| k.revizyon).fold(*son_rev, i64::max);
        }
        Ok(())
    }

    /// Artımlı telafi ya da canlı `kayit`'ler: sunucu kopyasına (yalnız büyük revizyon), `son_rev`, görünen
    /// kopya; tek işlem. Kayıt geldiyse onun revizyonuna kadar onaylanmış kuyruk satırları gereksizdir.
    fn sunucu_kayitlarini_uygula(&mut self, o: &Ortam, e: &mut Etkiler, kayitlar: Vec<AjandaKaydi>) -> Result<(), CekirdekHatasi> {
        if kayitlar.is_empty() {
            return Ok(());
        }
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let degisen = self.depo.yazma(|d| {
            let onceki_rev = d.son_rev()?;
            let mut son_rev = onceki_rev;
            let mut dokunulan: BTreeSet<&str> = BTreeSet::new();
            for k in &kayitlar {
                son_rev = son_rev.max(k.revizyon);
                let yazildi = d.kopya_kaydi_uygula(KopyaTablosu::Sunucu, k)?;
                let rev = d.sunucu_revizyonu(&k.kayit_id)?.unwrap_or(k.revizyon);
                let onay_bitti = d.kaydin_onaylananlarini_sil(&k.kayit_id, rev)?;
                if yazildi || onay_bitti {
                    dokunulan.insert(&k.kayit_id);
                }
            }
            if son_rev != onceki_rev {
                d.son_rev_yaz(son_rev)?;
            }
            let mut degisen = Vec::new();
            for kayit_id in dokunulan {
                if gorunen_yenile(d, &b, kayit_id)? {
                    degisen.push(kayit_id.to_string());
                }
            }
            Ok(degisen)
        })?;
        self.gorunenler_degisti(o, e, &degisen);
        Ok(())
    }

    /// `esitlendi`: telafi biter, bağlantı canlı olur, kuyruk yollanmaya başlar.
    fn esitlendi(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        self.telafi_tamponunu_yaz(o, e)?;
        let Asama::Telafi(t) = std::mem::replace(&mut self.asama, Asama::Kapaniyor) else { unreachable!() };
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let simdi = o.simdi_ms().to_string();
        // Yerel kipte bağlanma burada biter: servisin tam kopyası elde edildi; tek işlemde yerel kayıtlar
        // kuyruğa dökülür ve kip `bagli` olur (`yerel.rs` `yereli_kuyruga_dok`). Yerel kipte telafi hep tamdır.
        // D4: gidecek bir şey varsa önce kullanıcının onayı (`birlestirme.rs`); beklerken telafi aşamasında
        // kalınır (canlı `kayit`'ler toplanan kopyaya), onay bağlantıyı canlıya geçirir.
        let yerel = self.yerel_mi()?;
        // Tam telafi kopyanın yerine geçer: kopya artık bu bağlantının sürümüyle dolu (`KOPYA_SURUMU`).
        let kopya_surumu = self.surum.baglanti.no().to_string();
        // `hello` izsiz gittiyse (kopya eski) servisin tam demesi iz kaybı değildir.
        let iz_yollandi = !self.kopya_eski()?;
        match t.tam {
            Some((depo_id, son_rev)) if yerel => {
                if !self.yerelden_baglan(o, e, &b, &depo_id, son_rev)? {
                    self.asama = Asama::Telafi(Telafi { tam: Some((depo_id, son_rev)), tampon: Vec::new() });
                    return Ok(());
                }
            }
            Some((depo_id, son_rev)) => {
                self.depo.yazma(|d| {
                    // Aynı depo (servis yedekten dönmüş): PC'nin yitirdiği onaylı haller kuyruğa (`yerel.rs`).
                    super::yerel::geri_donenleri_kuyruga_koy(d, o, &b, &depo_id, iz_yollandi)?;
                    d.telafiyi_sunucuya_gecir()?;
                    d.depo_id_yaz(&depo_id)?;
                    d.son_rev_yaz(son_rev)?;
                    // Telafi her onaylanmış işlemin sonucunu kapsar (`bas_rev` sonuçlardan sonra).
                    d.butun_onaylananlari_sil()?;
                    d.sahipsiz_gorunenleri_sil()?;
                    for k in d.gorunenden_farkli_sunucu_kayitlari()? {
                        d.gorunen_yaz(&k, false)?;
                    }
                    for kayit_id in d.kuyruktaki_kayitlar()? {
                        gorunen_yenile(d, &b, &kayit_id)?;
                    }
                    d.meta_yaz(anahtar::SON_ESITLENME_MS, Some(&simdi))?;
                    d.meta_yaz(KOPYA_SURUMU, Some(&kopya_surumu))?;
                    Ok(())
                })?;
                self.hepsi_degisti(o, e);
            }
            None => {
                let degisen = self.depo.yazma(|d| {
                    let mut degisen = Vec::new();
                    for kayit_id in d.butun_onaylananlari_sil()? {
                        if gorunen_yenile(d, &b, &kayit_id)? {
                            degisen.push(kayit_id);
                        }
                    }
                    d.meta_yaz(anahtar::SON_ESITLENME_MS, Some(&simdi))?;
                    Ok(degisen)
                })?;
                self.gorunenler_degisti(o, e, &degisen);
            }
        }
        self.son_hata = None;
        self.surum_uyusmazligi = None;
        e.degisim.baglanti = true;
        self.asama = Asama::Canli;
        self.kuyruk_ilerlet(o, e)
    }

    /// Bilinen servis sürümünü yazar (`welcome`, `SERVIS_SURUMU`). Erteleme hali değiştiyse (v2 servis
    /// güncellendi ya da geri alındı): `Degisim.baglanti` (sayılar) ve v3 değişikliği taşıyan bekleyen
    /// satırların kayıtları `Degisim.kayitlar`'a (kayıt işareti).
    fn servis_surumunu_yaz(&mut self, e: &mut Etkiler, s: Surum) -> Result<(), CekirdekHatasi> {
        let yeni = s.no().to_string();
        if self.depo.meta_oku(SERVIS_SURUMU)?.as_deref() == Some(yeni.as_str()) {
            return Ok(());
        }
        let once = erteleme_surumu(&self.depo)?;
        self.depo.meta_yaz(SERVIS_SURUMU, Some(&yeni))?;
        let sonra = erteleme_surumu(&self.depo)?;
        if once == sonra {
            return Ok(());
        }
        e.degisim.baglanti = true;
        let olcu = once.or(sonra);
        let kuyruk = erteleme_adaylari(&self.depo)?;
        for (satir, hal) in kuyruk.iter().zip(kuyruk_ertelemeleri(&kuyruk, olcu)) {
            if hal != SatirErtelemesi::Yok {
                e.kayit_degisti(&satir.kayit_id);
            }
        }
        Ok(())
    }

    /// Canlıysa ve yolda işlem yoksa kuyruğun sıradaki satırını bağlantının sürümüyle yollar. Çözülemeyen
    /// satır ret listesine geçer. Bağlantının taşıyamadığı alanları olan işlem ertelenir ("Erteleme"):
    /// gidecek kısmı yoksa yerinde kalır ve atlanır; varsa bölünür (`v3_kalanini_ertele`) ve gidecek kısmı
    /// yollanır.
    pub(crate) fn kuyruk_ilerlet(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        if self.tur() != Tur::Canli || !self.depo.kuyruk_yollananlar()?.is_empty() {
            return Ok(());
        }
        let surum = self.surum.baglanti;
        'bastan: loop {
            // v3'te her satır olduğu gibi gider: yalnız baş okunur. Alt sürümde kuyruk baştan birer satır, ilk
            // ertelenmemiş satıra dek yürünür; her satırın hali kendi kaydının satırlarıyla hesaplanır (hal kayıt
            // başınadır; kayıt dizinle okunur). Uzun kuyruğun boşalması her gönderimde bütün kuyruğu okumaz (R6);
            // baştaki ertelenmiş önek de her gönderimde yeniden yürünüp çözülmez (`Atlama`, bulgu 3).
            let mut kayit_halleri: BTreeMap<String, BTreeMap<i64, SatirErtelemesi>> = BTreeMap::new();
            let mut atlama = if surum.v3_mu() { None } else { self.gecerli_atlama()? };
            let mut siradaki = match atlama {
                Some(a) => self.depo.kuyruk_sonraki(a.son)?,
                None => self.depo.kuyruk_basi()?,
            };
            let mut bas = None;
            while let Some(s) = siradaki {
                let hal = if surum.v3_mu() {
                    SatirErtelemesi::Yok
                } else {
                    if !kayit_halleri.contains_key(&s.kayit_id) {
                        let kaydin = self.depo.kuyruk_kaydin(&s.kayit_id)?;
                        let haller = kuyruk_ertelemeleri(&kaydin, Some(surum));
                        kayit_halleri.insert(s.kayit_id.clone(), kaydin.iter().map(|k| k.sira).zip(haller).collect());
                    }
                    kayit_halleri[&s.kayit_id].get(&s.sira).copied().unwrap_or(SatirErtelemesi::Yok)
                };
                if hal != SatirErtelemesi::Tam {
                    bas = Some(s);
                    break;
                }
                // Bütünüyle ertelenmiş ya da sırası tutulan: yerinde kalır, önek uzar, arkasındaki satıra geçilir.
                let (adet, deneme, bayt) = atlama.map_or((0, 0, 0), |a| a.iz);
                let iz = (adet + 1, deneme + i64::from(s.deneme), bayt + s.islem_json.len() as i64);
                atlama = Some(Atlama { son: s.sira, iz });
                siradaki = self.depo.kuyruk_sonraki(s.sira)?;
            }
            if !surum.v3_mu() {
                self.surum.atlama = atlama;
            }
            let Some(bas) = bas else { return Ok(()) };
            let Some(islem) = islem_coz(&bas.islem_json) else {
                self.ret_listesine_tasi(o, e, &bas, KuyrukRetNedeni::GecersizIslem)?;
                continue 'bastan;
            };
            match islem.surume_bol(surum) {
                SurumBolumu { gidecek: Some(gidecek), kalan: None } => {
                    self.depo.kuyruk_yollandi_yaz(bas.sira, true)?;
                    e.gonderilecek.push(AjandaYukari::Islem { islem_id: bas.islem_id, islem: gidecek }.kodla_surum(surum));
                }
                // Satır gidecek kısmına döner, kalanı arkasına girer; döngü yeniden okur ve onu yollar.
                SurumBolumu { gidecek: Some(gidecek), kalan: Some(kalan) } => {
                    self.v3_kalanini_ertele(o, e, &bas, &gidecek, &kalan)?;
                    continue 'bastan;
                }
                // `kuyruk_ertelemeleri` gidecek kısmı olmayanı `Tam` sayar: buraya gelmez.
                SurumBolumu { gidecek: None, .. } => {}
            }
            return Ok(());
        }
    }

    /// Atlama önbelleği hâlâ geçerliyse o (`Atlama`): önekin izi depodakiyle aynı. Değilse atılır.
    fn gecerli_atlama(&mut self) -> Result<Option<Atlama>, CekirdekHatasi> {
        let Some(a) = self.surum.atlama else { return Ok(None) };
        if self.depo.kuyruk_onek_izi(a.son)? == a.iz {
            return Ok(Some(a));
        }
        self.surum.atlama = None;
        Ok(None)
    }

    /// Alt sürümlü bağlantıda karma kuyruk satırını böler, tek işlemde: satır yerinde gidecek kısmına döner
    /// (`islem_id`, deneme, an aynı), kalan (`kalan`, v3 alanlarının `guncelle`'si) yeni bir `islem_id`'yle,
    /// denemesiz ve aynı anla hemen arkasına girer; arkasındakiler aynı sırayla yeniden dizilir (kuyrukta
    /// satır işlemini değiştiren bir depo yöntemi yok; yolda satır yokken çağrılır, onaylanmışların
    /// `bekledigi_rev`'i geri yazılır). İki satırın etkisi özgün satırınkiyle aynıdır: görünen kopya yine de
    /// yeniden hesaplanır.
    fn v3_kalanini_ertele(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        bas: &KuyrukSatiri,
        gidecek: &AjandaIslem,
        kalan: &AjandaIslem,
    ) -> Result<(), CekirdekHatasi> {
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let kalan_satiri = KuyrukSatiri {
            islem_id: Motor::yeni_kimlik(o, "i_")?,
            islem_json: kalan.json().to_string(),
            deneme: 0,
            yollandi: false,
            bekledigi_rev: None,
            ..bas.clone()
        };
        let degisti = self.depo.yazma(|d| {
            let arkasi: Vec<KuyrukSatiri> = d.kuyruk()?.into_iter().filter(|s| s.sira >= bas.sira).collect();
            for s in &arkasi {
                d.kuyruk_sil(s.sira)?;
            }
            for s in &arkasi {
                if s.sira == bas.sira {
                    d.kuyruga_yeniden_ekle(&KuyrukSatiri { islem_json: gidecek.json().to_string(), ..s.clone() })?;
                    d.kuyruga_yeniden_ekle(&kalan_satiri)?;
                } else {
                    d.kuyruga_yeniden_ekle(s)?;
                }
            }
            if arkasi.iter().any(|s| s.bekledigi_rev.is_some()) {
                for yeni in d.kuyruk()? {
                    if let Some(rev) = arkasi.iter().find(|s| s.islem_id == yeni.islem_id).and_then(|s| s.bekledigi_rev) {
                        d.kuyruk_onaylandi_yaz(yeni.sira, rev)?;
                    }
                }
            }
            gorunen_yenile(d, &b, &bas.kayit_id)
        })?;
        e.degisim.baglanti = true;
        if degisti {
            self.gorunenler_degisti(o, e, std::slice::from_ref(&bas.kayit_id));
        }
        Ok(())
    }

    fn islem_sonucu(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        islem_id: &str,
        ok: bool,
        rev: Option<i64>,
        code: Option<AjandaRetNedeni>,
    ) -> Result<(), CekirdekHatasi> {
        // Yolda olmayan işlemin sonucu (eski ya da yinelenen): yok sayılır.
        let Some(s) = self.depo.kuyruk_yollananlar()?.into_iter().find(|s| s.islem_id == islem_id) else {
            return Ok(());
        };
        let olay = if ok { KuyrukOlayi::SonucOk } else { KuyrukOlayi::SonucRet(code.unwrap_or(AjandaRetNedeni::IcHata)) };
        match ajanda_kuyruk_karari(olay, s.deneme) {
            KuyrukKarari::Cikar => {
                let cevirici = o.cevirici();
                let b = self.iyimser_baglam(o, &cevirici)?;
                let degisti = self.depo.yazma(|d| {
                    let sunucu_rev = d.sunucu_revizyonu(&s.kayit_id)?;
                    match rev {
                        Some(r) if sunucu_rev.is_none_or(|sr| sr < r) => d.kuyruk_onaylandi_yaz(s.sira, r)?,
                        _ => d.kuyruk_sil(s.sira)?,
                    }
                    gorunen_yenile(d, &b, &s.kayit_id)
                })?;
                e.degisim.baglanti = true;
                if degisti {
                    self.gorunenler_degisti(o, e, std::slice::from_ref(&s.kayit_id));
                }
            }
            KuyrukKarari::Bekle { deneme } => {
                self.depo.kuyruk_deneme_yaz(s.sira, deneme)?;
            }
            KuyrukKarari::RetListesi { neden } => self.ret_listesine_tasi(o, e, &s, neden)?,
        }
        self.kuyruk_ilerlet(o, e)
    }

    /// İşlemi ret listesine taşır: kuyruktan çıkar, iyimser hali geri alınır (görünen kopya yeniden
    /// hesaplanır), içeriği ve nedeniyle kullanıcıya görünür.
    pub(crate) fn ret_listesine_tasi(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        s: &KuyrukSatiri,
        neden: KuyrukRetNedeni,
    ) -> Result<(), CekirdekHatasi> {
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let ts_ms = o.simdi_ms();
        let degisti = self.depo.yazma(|d| {
            let islem = islem_coz(&s.islem_json);
            let govde_json = istenen_govde(d, &b, &s.kayit_id, s.sira, islem.as_ref())?
                .map(|g| g.alanlari_yaz(Yazici::yeni()).bitir().to_string());
            d.ret_ekle(&RetSatiri {
                islem_id: s.islem_id.clone(),
                kayit_id: s.kayit_id.clone(),
                islem_json: s.islem_json.clone(),
                neden: neden.ad().to_string(),
                ts_ms,
                govde_json,
                sira: s.sira,
            })?;
            d.kuyruk_sil(s.sira)?;
            gorunen_yenile(d, &b, &s.kayit_id)
        })?;
        e.degisim.ret_listesi = true;
        e.degisim.baglanti = true;
        if degisti {
            self.gorunenler_degisti(o, e, std::slice::from_ref(&s.kayit_id));
        }
        Ok(())
    }

    /// Yollanmış ama sonucu gelmemiş satırlar: `Kopma` (bu bağlantı ya da ölen süreçten kalan).
    fn kopmalari_isle(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        for s in self.depo.kuyruk_yollananlar()? {
            e.degisim.baglanti = true;
            match ajanda_kuyruk_karari(KuyrukOlayi::Kopma, s.deneme) {
                KuyrukKarari::Bekle { deneme } => self.depo.kuyruk_deneme_yaz(s.sira, deneme)?,
                KuyrukKarari::RetListesi { neden } => self.ret_listesine_tasi(o, e, &s, neden)?,
                // Kopma hiçbir zaman çıkarmaz; yine de satır yollanmamış sayılsın.
                KuyrukKarari::Cikar => self.depo.kuyruk_yollandi_yaz(s.sira, false)?,
            }
        }
        Ok(())
    }

    /// Soket kapandı: süren tam telafi atılır, artımlı tampon yazılır (gelenler geçerli), yollanmış işlem
    /// `Kopma` sayılır (`kural::kuyruk`), bekleyen geçmiş istekleri düşer. `kapanis_kodu`: karşı tarafın
    /// kapanış çerçevesinin kodu (biliniyorsa). Servis 1002'yi yalnız `protokol_uyumsuz` ile kullanır; ret
    /// çerçevesi gelmemişse karar çerçevesiz geri düşüştür (`geri_dus(None)`), ama yalnız servis bağlantının
    /// sürümünü henüz kabul etmemişken: `pair_request` ya da `hello` yanıtsızken (`Eslestirme`, `Hello`).
    /// `auth_challenge` geldikten sonra (`Yanit`, telafi, canlı) servis sürümü sabitlemiş ve o sürümle yazmıştır
    /// (sürümü bağlantının ilk `hello`/`pair_request`'inden sabitler, uymayanı `auth_challenge`'dan önce reddeder);
    /// telefon da her çerçeveyi o sürümle yazar: 1002 sürüm uyuşmazlığı olamaz, başka bir nedendir ve sıradan
    /// kopma sayılır (R7; yoksa telefon v3 serviste boşuna bir saat v2'de kalırdı).
    pub(crate) fn baglanti_kapandi(&mut self, o: &Ortam, e: &mut Etkiler, kapanis_kodu: Option<i32>) -> Result<(), CekirdekHatasi> {
        // Motor bu bağlantıyı kendisi kapattıysa (`Kapaniyor`: çözülen ret çerçevesi kararı zaten verdi)
        // kapanış kodu yeni bilgi değildir; değilse bu bağlantının uyuşmazlığı yalnız koddan bilinir.
        if kapanis_kodu == Some(KAPANIS_PROTOKOL_HATASI) && matches!(self.asama, Asama::Eslestirme { .. } | Asama::Hello { .. }) {
            self.geri_dus(o, e, None);
        }
        self.surum.yetenekler.clear();
        self.surum.atlama = None;
        let eski = std::mem::replace(&mut self.asama, Asama::Kopuk);
        if eski.disari() != BaglantiAsamasi::Kopuk {
            e.degisim.baglanti = true;
        }
        let mut sonuc = Ok(());
        if let Asama::Telafi(t) = eski {
            sonuc = match t.tam {
                Some(_) => self.depo.telafiyi_sil(),
                None => self.sunucu_kayitlarini_uygula(o, e, t.tampon),
            };
        }
        let kopma = self.kopmalari_isle(o, e);
        for (kayit_id, sayfa) in self.gecmis.iter_mut() {
            if sayfa.yukleniyor {
                sayfa.yukleniyor = false;
                e.degisim.gecmis.push(kayit_id.clone());
            }
        }
        self.gecmis_istekleri.clear();
        sonuc.and(kopma)
    }

    pub(crate) fn baglanti_durumu(&self) -> Result<BaglantiDurumu, CekirdekHatasi> {
        // Yerel kipte kuyruk yoktur (göç 4 toplar, yerel yazar kullanmaz): gönderilecek iş sıfırdır. Bütünüyle
        // ertelenmiş satır bu serviste gönderilecek iş değildir ama gönderilmemiştir ("Erteleme"): ayrı sayılır.
        let (kuyrukta, ertelenen) = if self.yerel_mi()? {
            (0, 0)
        } else {
            let tam = self.ertelenenler()?.1;
            (self.depo.kuyruk_sayisi()? - tam, tam)
        };
        Ok(BaglantiDurumu {
            asama: self.asama.disari(),
            kuyrukta: i32::try_from(kuyrukta).unwrap_or(i32::MAX),
            ret_listesinde: i32::try_from(self.depo.ret_sayisi()?).unwrap_or(i32::MAX),
            son_esitlenme_ms: self.depo.meta_oku(anahtar::SON_ESITLENME_MS)?.and_then(|s| s.parse().ok()),
            son_hata: self.son_hata,
            surum_uyusmazligi: self.surum_uyusmazligi,
            ertelenen_islem: i32::try_from(ertelenen).unwrap_or(i32::MAX),
            yukari_deneme_ms: self.yukari_deneme_ani(),
        })
    }

    /// Açık bağlantı alt sürümde canlı mı (yukarı denemenin konusu).
    fn alt_surumde_canli(&self) -> bool {
        self.tur() == Tur::Canli && self.surum.baglanti < Surum::EN_YENI
    }

    /// Açık bağlantı düşülen alt sürümde canlıysa yukarı deneme anı: düşüş anı + `YUKARI_DENEME_MS`
    /// (`BaglantiDurumu.yukari_deneme_ms`).
    fn yukari_deneme_ani(&self) -> Option<i64> {
        let (_, an) = self.surum.dusulen.filter(|_| self.alt_surumde_canli())?;
        Some(an.saturating_add(YUKARI_DENEME_MS))
    }

    /// Alt sürümlü açık bağlantıdan yukarı deneme (`YUKARI_DENEME_MS`): düşüş eskidiyse (ya da saat geri
    /// gittiyse: `acilis_surumu` gibi), bağlantı canlıysa ve yolda işlem yoksa bağlantı kapatılır; kabuk sıradan
    /// kopma gibi yeniden bağlanır, yeni bağlantı en büyükle açılır (eski serviste bedeli bir ret ve bir yeniden
    /// bağlanmadır, sonra yine düşülür). Hata ya da uyuşmazlık yazılmaz. Köprü her çağrının sonunda çağırır
    /// (`kopru::Cekirdek::calistir`): gelen çerçeve, yazma, durum okuma.
    pub(crate) fn yukari_denemesi(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        if !self.alt_surumde_canli() {
            return Ok(());
        }
        let simdi = o.simdi_ms();
        if self.surum.dusulen.is_some_and(|(_, an)| (0..YUKARI_DENEME_MS).contains(&simdi.saturating_sub(an))) {
            return Ok(());
        }
        if !self.depo.kuyruk_yollananlar()?.is_empty() {
            return Ok(());
        }
        // Yanıtı beklenen geçmiş isteği varken de beklenir: kapatmak onu düşürür, kullanıcı hatasız boş geçmiş
        // görürdü (bulgu 1). Yanıt gelince ya da bağlantı başka nedenle kapanınca istek listeden çıkar.
        if !self.gecmis_istekleri.is_empty() {
            return Ok(());
        }
        self.kapat(e, "yukarı sürüm denemesi");
        Ok(())
    }

    /// Ertelenen v3 değişikliği taşıyan satır sayısı ve bütünüyle ertelenmiş (yollanmayan) satır sayısı. İkincisi
    /// sırası tutulan v2 satırlarını (ör. bekleyen `sil`) da sayar (gönderilmemiş iş), birincisi saymaz (bulgu 4:
    /// `BaglantiYetenekleri.ertelenen` "v3 değişikliği taşıyan işlem sayısı"dır, `ertelenenleri_at`'ın sayısı).
    fn ertelenenler(&self) -> Result<(i64, i64), CekirdekHatasi> {
        let Some(surum) = erteleme_surumu(&self.depo)? else { return Ok((0, 0)) };
        let (mut ertelenen, mut tam) = (0, 0);
        let adaylar = erteleme_adaylari(&self.depo)?;
        for (s, hal) in adaylar.iter().zip(kuyruk_ertelemeleri(&adaylar, Some(surum))) {
            if hal == SatirErtelemesi::Yok {
                continue;
            }
            if hal == SatirErtelemesi::Tam {
                tam += 1;
            }
            if islem_coz(&s.islem_json).is_some_and(|i| v3_degisikligi_var(&i.surume_bol(surum))) {
                ertelenen += 1;
            }
        }
        Ok((ertelenen, tam))
    }

    /// Ertelenen v3 değişikliklerini atar, kayıtları serbest bırakır ("Serbest bırakma"; köprü
    /// `ertelenenleri_at`). `kayit_id`: yalnız o kayıt; `None`: bütün kayıtlar. Erteleme yokken (v3 ya da
    /// bilinmeyen servis, yerel kip) hiçbir şey yapmaz. Tek işlemde, kaydın her ertelenmiş satırı için
    /// (`kuyruk_ertelemeleri` `Tam`/`Kismen`):
    /// - yalnız v3 alanı değiştiren satır bütünüyle ret listesine geçer (aynı `islem_id`);
    /// - karma satır (`ekle` ya da `guncelle`) yerinde v2 kısmına döner (aynı `islem_id`, sıra, deneme, an), v3
    ///   kalanı yeni bir `islem_id`'yle ret listesine geçer;
    /// - v3 alanı taşımayan, yalnız sırası tutulan satır (ör. `sil`) yerinde kalır: artık bekletilmez, bu
    ///   serviste gider.
    ///
    /// Ret girdisi `ERTELENEN_ATILDI` nedeniyle yazılır (köprüde `neden` `teslim_edilemedi`,
    /// `RetGirdisi.ertelenen_atildi`); gövdesi öteki retlerdeki gibi düzeltme formunun halidir (`istenen_govde`;
    /// form v3 alanı taşımaz). Yollanmış ve onaylanmış satırlara dokunulmaz. Görünen kopya yeniden hesaplanır:
    /// atılan v3 değeri gider, kayıt PC'deki (ya da kuyruğun önceki) haliyle görünür. Döner: ret listesine geçen
    /// v3 değişikliği sayısı (önceki `BaglantiYetenekleri.ertelenen`'in atılan kısmı). Canlıysa kuyruk hemen ilerler.
    pub(crate) fn ertelenenleri_at(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: Option<&str>) -> Result<i32, CekirdekHatasi> {
        if kayit_id.is_some_and(|k| !opak_id_mi(k)) {
            return Err(CekirdekHatasi::GecersizGirdi { alan: "kayit_id".into(), neden: "geçersiz kimlik".into() });
        }
        let Some(surum) = erteleme_surumu(&self.depo)? else { return Ok(0) };
        let adaylar = match kayit_id {
            Some(k) => self.depo.kuyruk_kaydin(k)?,
            None => erteleme_adaylari(&self.depo)?,
        };
        let haller = kuyruk_ertelemeleri(&adaylar, Some(surum));
        // (satır, işlemi, bölümü, v3 kalanının ret kimliği). Yalnız v3 değişikliği olanlar: sırası tutulan v2
        // satırı yerinde kalır (önündeki v3 değişikliği gidince hali kendiliğinden `Yok` olur).
        let mut atilacak = Vec::new();
        for (s, hal) in adaylar.into_iter().zip(haller) {
            if hal == SatirErtelemesi::Yok {
                continue;
            }
            let Some(islem) = islem_coz(&s.islem_json) else { continue };
            let bolum = islem.surume_bol(surum);
            if !v3_degisikligi_var(&bolum) {
                continue;
            }
            let kalan_id = match bolum.gidecek {
                Some(_) => Some(Motor::yeni_kimlik(o, "i_")?),
                None => None,
            };
            atilacak.push((s, islem, bolum, kalan_id));
        }
        if atilacak.is_empty() {
            return Ok(0);
        }
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let ts_ms = o.simdi_ms();
        let kayitlar: BTreeSet<String> = atilacak.iter().map(|(s, ..)| s.kayit_id.clone()).collect();
        let degisen = self.depo.yazma(|d| {
            // Gövdeler kuyruk değişmeden hesaplanır: her biri satırın önceki haline göre.
            let mut retler = Vec::new();
            for (s, islem, bolum, kalan_id) in &atilacak {
                let (islem_id, ret_islemi) = match (&bolum.kalan, kalan_id) {
                    (Some(kalan), Some(id)) => (id.clone(), kalan),
                    _ => (s.islem_id.clone(), islem),
                };
                let govde_json = istenen_govde(d, &b, &s.kayit_id, s.sira, Some(ret_islemi))?
                    .map(|g| g.alanlari_yaz(Yazici::yeni()).bitir().to_string());
                retler.push(RetSatiri {
                    islem_id,
                    kayit_id: s.kayit_id.clone(),
                    islem_json: ret_islemi.json().to_string(),
                    neden: ERTELENEN_ATILDI.to_string(),
                    ts_ms,
                    govde_json,
                    sira: s.sira,
                });
            }
            for ((s, _, bolum, _), r) in atilacak.iter().zip(&retler) {
                d.ret_ekle(r)?;
                match &bolum.gidecek {
                    Some(gidecek) => d.kuyruk_islemini_yaz(s.sira, &gidecek.json().to_string())?,
                    None => d.kuyruk_sil(s.sira)?,
                }
            }
            let mut degisen = Vec::new();
            for kayit_id in &kayitlar {
                if gorunen_yenile(d, &b, kayit_id)? {
                    degisen.push(kayit_id.clone());
                }
            }
            Ok(degisen)
        })?;
        self.surum.atlama = None;
        e.degisim.ret_listesi = true;
        e.degisim.baglanti = true;
        self.gorunenler_degisti(o, e, &degisen);
        // Kayıt işareti (`KayitGorunumu.ertelenen`, `bekleyen`) görünen satır değişmese de değişti.
        for kayit_id in &kayitlar {
            e.kayit_degisti(kayit_id);
        }
        self.kuyruk_ilerlet(o, e)?;
        Ok(i32::try_from(atilacak.len()).unwrap_or(i32::MAX))
    }

    /// Arayüzün bağlantıya göre neyi açacağı (`kopru::tipler::BaglantiYetenekleri`). `Bagli`: bağlı kipte
    /// `welcome` geldi (telafi ya da canlı; sürüm ve yetenekler bu bağlantınındır). `BagliDegil`'de v3
    /// alanlarının gidip gitmeyeceği bilinen servis sürümündendir (bilinmiyorsa gider sayılır).
    pub(crate) fn baglanti_yetenekleri(&self) -> Result<BaglantiYetenekleri, CekirdekHatasi> {
        let ertelenen = i32::try_from(self.ertelenenler()?.0).unwrap_or(i32::MAX);
        if self.yerel_mi()? {
            return Ok(BaglantiYetenekleri {
                kip: BaglantiKipi::Yerel,
                surum: None,
                v3_alanlari: true,
                yetenekler: Vec::new(),
                ertelenen,
            });
        }
        if matches!(self.tur(), Tur::Telafi | Tur::Canli) {
            let s = self.surum.baglanti;
            return Ok(BaglantiYetenekleri {
                kip: BaglantiKipi::Bagli,
                surum: Some(i32::try_from(s.no()).unwrap_or(i32::MAX)),
                v3_alanlari: s.v3_mu(),
                yetenekler: self.surum.yetenekler.clone(),
                ertelenen,
            });
        }
        Ok(BaglantiYetenekleri {
            kip: BaglantiKipi::BagliDegil,
            surum: None,
            v3_alanlari: erteleme_surumu(&self.depo)?.is_none(),
            yetenekler: Vec::new(),
            ertelenen,
        })
    }

    pub(crate) fn canli_mi(&self) -> bool {
        self.tur() == Tur::Canli
    }

    fn gecmis_geldi(
        &mut self,
        e: &mut Etkiler,
        istek_id: &str,
        kayit_id: &str,
        girdiler: Vec<AjandaGecmisGirdisi>,
        devami: bool,
        code: Option<AjandaRetNedeni>,
    ) {
        // Bilinmeyen ya da başka kayda ait yanıt yok sayılır.
        if self.gecmis_istekleri.get(istek_id).is_none_or(|k| k != kayit_id) {
            return;
        }
        self.gecmis_istekleri.remove(istek_id);
        let sayfa = self.gecmis.entry(kayit_id.to_string()).or_insert_with(|| GecmisSayfasi {
            kayit_id: kayit_id.to_string(),
            satirlar: Vec::new(),
            devami: false,
            yukleniyor: false,
            hata: None,
        });
        sayfa.satirlar.extend(girdiler.into_iter().map(gecmis_satiri));
        sayfa.satirlar.sort_by_key(|s| std::cmp::Reverse(s.rev));
        sayfa.satirlar.dedup_by_key(|s| s.rev);
        sayfa.devami = devami && code.is_none();
        sayfa.yukleniyor = false;
        sayfa.hata = code;
        e.degisim.gecmis.push(kayit_id.to_string());
    }
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::model::alan::{AJANDA_YETENEKLERI, yetenekler_oku};

    #[test]
    fn istemci_yetenekleri_bugun_bos_ek_yedegi_ek_yuklemeyle_gelir() {
        // Ek yükleme/indirme (`ek_*`) yazılmadan `ek_yedegi` istenmez; eklenince bu test güncellenir.
        assert!(ISTEMCI_YETENEKLERI.is_empty(), "{ISTEMCI_YETENEKLERI:?}");
        assert!(!ISTEMCI_YETENEKLERI.contains(&"ek_yedegi"));
        assert!(AJANDA_YETENEKLERI.contains(&"ek_yedegi"), "ad sözleşmede");
        let l = serde_json::json!(ISTEMCI_YETENEKLERI);
        assert!(yetenekler_oku(&l, "").is_ok(), "liste kablo biçiminde");
    }

    /// `kuyruk_ertelemeleri`: v2'de yalnız v3 `guncelle` bütünüyle ertelenir; arkasındaki alan işlemi gider,
    /// `sil` ve ardındakiler tutulur; yollanmış karma satır bölünmez ve kaydı tutar; başka kayıt etkilenmez.
    /// Bir kaydın satırlarıyla hesaplanan hal bütün kuyrukla hesaplananla aynıdır (`sorgu.rs` buna dayanır).
    #[test]
    fn kuyruk_ertelemeleri_kayit_basina_sirayla() {
        use crate::model::{AjandaDegisiklik, Alan, V3Degisikligi};
        use SatirErtelemesi::{Kismen, Tam, Yok};
        let v3 = || V3Degisikligi { simge: Alan::Deger("ev".into()), ..Default::default() };
        let gun = |k: &str, baslik: Option<&str>, v3: V3Degisikligi| AjandaIslem::Guncelle {
            kayit_id: k.into(),
            temel_revizyon: 1,
            degisiklik: AjandaDegisiklik { baslik: baslik.map(Into::into), v3, ..Default::default() },
        };
        let satir = |sira: i64, islem: AjandaIslem, deneme: u32| KuyrukSatiri {
            sira,
            islem_id: format!("i_{sira}"),
            kayit_id: islem.kayit_id().to_string(),
            islem_json: islem.json().to_string(),
            deneme,
            yollandi: false,
            olusturma_ms: 0,
            bekledigi_rev: None,
        };
        let kuyruk = vec![
            satir(1, gun("a", None, v3()), 0),
            satir(2, gun("a", Some("A2"), V3Degisikligi::default()), 0),
            satir(3, gun("b", Some("B2"), v3()), 0),
            satir(4, AjandaIslem::Sil { kayit_id: "a".into() }, 0),
            satir(5, gun("a", Some("A3"), V3Degisikligi::default()), 0),
            satir(6, gun("c", Some("C2"), v3()), 1),
            satir(7, gun("c", Some("C3"), V3Degisikligi::default()), 0),
            satir(8, AjandaIslem::Sil { kayit_id: "b".into() }, 0),
        ];
        let haller = kuyruk_ertelemeleri(&kuyruk, Some(Surum::V2));
        assert_eq!(haller, [Tam, Yok, Kismen, Tam, Tam, Tam, Tam, Yok]);
        assert_eq!(kuyruk_ertelemeleri(&kuyruk, Some(Surum::V3)), [Yok; 8]);
        assert_eq!(kuyruk_ertelemeleri(&kuyruk, None), [Yok; 8]);
        for k in ["a", "b", "c"] {
            let (satirlar, beklenen): (Vec<KuyrukSatiri>, Vec<SatirErtelemesi>) =
                kuyruk.iter().cloned().zip(haller.iter().copied()).filter(|(s, _)| s.kayit_id == k).unzip();
            assert_eq!(kuyruk_ertelemeleri(&satirlar, Some(Surum::V2)), beklenen, "{k}");
        }
    }

    /// Atlama önbelleği (bulgu 3) önekin izi değişince atılır: önekte satır silinmesi ya da yerinde yazım; önekin
    /// arkasına eklenen satır izi değiştirmez.
    #[test]
    fn atlama_onbellegi_onek_degisince_atilir() {
        let mut m = Motor::ac(":memory:").unwrap();
        for i in 1..=3 {
            m.depo.kuyruga_ekle(&format!("i_{i}"), "k_a", &format!("islem-{i}"), 0).unwrap();
        }
        let kur = |m: &mut Motor| {
            let a = Atlama { son: 2, iz: m.depo.kuyruk_onek_izi(2).unwrap() };
            m.surum.atlama = Some(a);
            a
        };
        let a = kur(&mut m);
        assert_eq!(a.iz, (2, 0, 14));
        m.depo.kuyruga_ekle("i_4", "k_a", "islem-4", 0).unwrap();
        m.depo.kuyruk_deneme_yaz(3, 2).unwrap();
        assert_eq!(m.gecerli_atlama().unwrap(), Some(a), "önekin arkası izi değiştirmez");
        m.depo.kuyruk_islemini_yaz(1, "islem-1-uzun").unwrap();
        assert_eq!(m.gecerli_atlama().unwrap(), None, "yerinde yazım");
        assert!(m.surum.atlama.is_none());
        kur(&mut m);
        m.depo.kuyruk_sil(2).unwrap();
        assert_eq!(m.gecerli_atlama().unwrap(), None, "silme");
        kur(&mut m);
        m.depo.kuyruk_deneme_yaz(1, 1).unwrap();
        assert_eq!(m.gecerli_atlama().unwrap(), None, "deneme");
    }

    #[test]
    fn v3_anahtarlari_alan_kumesiyle_ayni() {
        use crate::model::AjandaAlani;
        let adlar: Vec<String> = AjandaAlani::HEPSI[AjandaAlani::V2_ADEDI..].iter().map(|a| format!("\"{}\"", a.ad())).collect();
        assert_eq!(adlar, V3_ANAHTARLARI);
    }

    #[test]
    fn kume_yonu_cercevenin_v_si() {
        assert_eq!(kume_yonu(r#"{"v":4,"type":"esitlendi","rev":1}"#), SurumUyusmazligi::UygulamaEski);
        assert_eq!(kume_yonu(r#"{"v":1,"type":"esitlendi","rev":1}"#), SurumUyusmazligi::ServisEski);
        assert_eq!(kume_yonu(r#"{"v":2,"type":"esitlendi","rev":1}"#), SurumUyusmazligi::Bilinmiyor);
        assert_eq!(kume_yonu("{bozuk"), SurumUyusmazligi::Bilinmiyor);
    }
}
