//! SAHİBİ: D3 (dışa ve içe aktarma, `YOL-HARITASI.md` 3.3 "Servis olmadan deneyim"). Bağımsız kipte telefonun
//! tek yedeği: bütün kayıtlar (mezar taşları dahil) sürümlü bir JSON belgeye yazılır; Kotlin onu bir zip'e
//! koyar (`AktarmaBicimi`: kökte `ajanda.json`, ekler `ekler/<ozet>`). Çekirdek dosya sistemine dokunmaz:
//! belge metni girer ve çıkar.
//!
//! Belge (biçim sürümü 1), anahtarlar sıralı, UTF-8:
//! - `bicim`: `"eren_ajanda_yedegi"` (başka bir JSON'u ajanda yedeği sanmamak için);
//! - `bicim_surumu`: kabın ve üst düzey alanların sürümü (bugün 1);
//! - `sozlesme_surumu`: kayıtların sözleşme sürümü (`AJANDA_SURUMU`);
//! - `uygulama_surumu`: yazan çekirdeğin sürümü (yalnız tanı);
//! - `olusturma_ms`: dışa aktarma anı; `kip`: `yerel` ya da `bagli`;
//! - `kayitlar`: modelin kendi kayıt JSON'u (`AjandaKaydi::json`), mezar taşları dahil; sözleşmenin yeni
//!   kayıt alanları (v3 ekler) okuyucu/yazıcıyla kendiliğinden geçer;
//! - `ekler`: kaptaki ek dosyalarının dizini (`{ozet, bayt, mime}`; `ozet` sha256, küçük harf hex, dosya
//!   `ekler/<ozet>`). Ek üstverisi kaydın içindedir (v3 `ekler` alanı); bu dizi kaydın başvurduğu dosyaların
//!   tekil listesidir. Bugün hep boştur (`kayit_ekleri`: v3 alanları gelince doldurulacak bağlantı noktası);
//! - `bolgeler`: bölge tanımlarının yeri; biçim 1'de hep boştur (öğesi tanımsız: dolu dizi reddedilir).
//!   Bölgeler gelince öğe şeması tanımlanır ve `bicim_surumu` 2 olur.
//!
//! Sürüm kuralı: `bicim` ve iki sürüm alanı katı okumadan önce bakılır. `bicim_surumu > BICIM_SURUMU` ya da
//! `sozlesme_surumu > AJANDA_SURUMU` ise belge bütünüyle reddedilir (`GecersizGirdi{alan:"bicim_surumu" |
//! "sozlesme_surumu", neden:"daha yeni..."}`): okuyamayacağı alanları sessizce atmasın. Daha eski sözleşme
//! sürümleri okunur (yeni alanlar isteğe bağlıdır). Kendi sürümünde şema katıdır (bilinmeyen alan reddedilir).
//!
//! Bellek (başkasından gelen dosya): belge bütünüyle bir JSON ağacına çevrilmez. Önce `yapi_tara` metni
//! ağaç kurmadan bir kez geçer (parantez dengesi, dizgiler, kökteki `kayitlar` dizisinin öğe aralıkları) ve
//! sınırları uygular: belge `BELGE_AZAMI_BAYT`, `kayitlar` en çok `KAYIT_DIZISI_AZAMI` öğe (sayım aşınca
//! tarama durur), kayıtlar dışındaki sözcükler (anahtar ya da değer) `DIS_SOZCUK_AZAMI`, iç içelik
//! `DERINLIK_AZAMI`. Üst düzey `kayitlar` boşaltılmış metinden okunur; kayıtlar `plan_kur`'da tek tek
//! çözülür (bir öğe en çok `KAYIT_AZAMI_BAYT`; büyüğü yalnız o kaydı geçersiz kılar). Bellek: belge metni +
//! öğe aralıkları + o anki tek kaydın ağacı (+ yazılacak kayıtlar). Öğenin içindeki sözdizimi hatası da
//! bütün belgeyi reddeder (eski davranış: dosya bozuk).
//!
//! İçe aktarma (`plan_kur`): her kayıt ayrı sınıflanır; tek bozuk kayıt bütün aktarmayı düşürmez.
//! - geçersiz: modelin okuyucusundan ya da kurallarından geçmeyen, dosyada yinelenen `kayit_id`, dilimi
//!   bilinmeyen (`ZamanKabugu.andan_yerele`; yerel yazarın `ekle` denetimi), çok büyük öğe ve gelecek
//!   tarihli: `guncelleme_ms` şimdi + `GELECEK_TOLERANSI_MS`'ten büyük (model `olusturma_ms <=
//!   guncelleme_ms` ister, o da sınırlanmış olur). Gelecekteki an kırpılmaz, reddedilir: "daha yeni kazanır"
//!   kuralı bu anı her yerel kayda üstün sayar (9e15'li mezar taşı telefonu siler) ve servisin
//!   `max(önceki, şimdi)` kuralı onu yapışkan kılar; kırpılmış an da (şimdi) o anki her kaydı yenerdi ve
//!   dosyanın gerçek sırası zaten bilinemez;
//! - yeni: telefonda yok. Kayıt sınırı (`KAYIT_ADET`, mezar taşları dahil) dolunca `sinir_asan`;
//! - aynı: yerelde revizyon ve güncelleme anı dışında her alan eşit; bağlı kipte servise gidecek alanlar
//!   eşit (`icerik_ayni`) ya da gidecek işlem yok;
//! - güncellenecek: dosyadaki `guncelleme_ms` büyük; atlanacak: telefondaki büyük ya da eşit (telefon kalır).
//!   Telefondaki satır okunamıyorsa yerelde dosyadaki yazılır (onarır), bağlı kipte atlanır. Güncellemenin
//!   içindeki silme (`silinecek`: canlı kayıt yerine daha yeni mezar taşı) ve geri yükleme
//!   (`geri_yuklenecek`) ayrıca sayılır.
//!
//! Uygulama (`ice_aktar`) tek SQLite işlemidir: plan işlemin içinde yeniden kurulur, `iz` verildiyse ve
//! şimdiki planınkiyle tutmazsa hiçbir şey yazılmaz (`uygulandi` yanlış, yeni plan döner). İz: kip, ek
//! dizini, her öğenin metni ve sınıfı, güncellenecek kaydın telefondaki satırı (içerik ve yazım kimliği):
//! başka bir dosya ya da önizlemeden sonra değişen telefon kaydı eski izle uygulanmaz.
//! - Yerel kip: kayıt alanları korunur (oluşturma ve güncelleme anı, kaynak izi, elle alanlar, örnekler,
//!   durum, taslak, silindi), revizyon yerel sayaçtan, yerel geçmişe bir satır (yeni: doğum parçası,
//!   güncelleme: fark; yazar insan elle, an içe aktarma anı); kalıcı olunca alarm senkronu.
//! - Bağlı kip: servis yazardır; D1'in dökme kuralıyla (`kuyruga_islemler`) görünen hal ile dosyadaki hal
//!   arasındaki işlemler kuyruğa girer (yeni: aynı kimlikle `ekle`, sonra durum, örnekler, `sil`; güncelleme:
//!   `geri_yukle`, `guncelle`, `durum`, örnekler, `onayla`, `sil`). Kaybolanlar: kaynak izi (servis
//!   `ekle`'yi bu telefonun elle/sesli not yazması sayar), oluşturma ve güncelleme anı (servisin), `elle_alanlar`
//!   (servis hesaplar), taslak olmayan kaydı taslağa döndürme, telefonda olmayan mezar taşları
//!   (`gonderilmeyecek`). Telefonda olmayan taslak gönderilmez (`taslak_gonderilmeyecek`): servis `ekle`'si
//!   onaylanmış kayıt doğurur, kullanıcının onaylamadığı öneri onaylanmış gibi gitmesin (dosyada kalır,
//!   yerel kipte taslak olarak alınabilir). Servisin reddettiği işlem bugünkü gibi ret listesine düşer.
//!
//! Kuyruk ve ret listesi belgeye girmez: kuyruğun etkisi görünen kopyadadır (bağlı kipte iyimser hal
//! aktarılır); ret girdisi kayıt değil, belli bir servise ve revizyona bağlı reddedilmiş istektir, başka
//! telefonda anlamı yoktur. Sayısı `DisaAktarma.ret_listesinde` ile söylenir (önce düzeltilsin). Yerel
//! geçmiş de girmez (yeni telefonda içe aktarma satırıyla başlar).
//!
//! Mahremiyet: belge içeriği (başlık, açıklama, ileride bölge) hata mesajına, `GecersizKayit`'e ya da
//! günlüğe girmez. Hatalar yalnız konum (şemanın alan adları ve sıra numaraları: `guvenli_yol`) ve sabit
//! neden taşır; JSON sözdizimi hatası yalnız satır ve sütun.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{Map, Value};

use super::iyimser::gorunen_yenile;
use super::kanal::gecmis_satiri;
use super::yerel::{dogum_parcasi, fark, icerik_ayni, kayit_coz, kuyruga_islemler};
use super::{Etkiler, Motor, Ortam, TELAFI_TAMPONU};
use crate::depo::Depo;
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{
    AktarmaBicimi, CalismaKipi, DisaAktarma, EkDosyasi, GecersizKayit, IceAktarmaOnizlemesi, IceAktarmaSonucu,
};
use crate::model::json::{GUVENLI_TAM_SAYI, Nesne, SemaHatasi, Sonuc, hata, metin, tam_sayi};
use crate::model::kayit::zaman_ms_oku;
use crate::model::sinirlar::AJANDA_SURUMU;
use crate::model::sinirlar::ajanda::KAYIT_ADET;
use crate::model::{AjandaGecmisGirdisi, AjandaIslem, AjandaKaydi, AjandaParca, AjandaYazar, Hatirlatma, IslemTuru, KaynakYolu, TurKokeni};

pub(crate) const BELGE_ADI: &str = "ajanda.json";
pub(crate) const EKLER_DIZINI: &str = "ekler/";
pub(crate) const BICIM: &str = "eren_ajanda_yedegi";
pub(crate) const BICIM_SURUMU: i64 = 1;
/// Belgenin üst sınırı (UTF-8 bayt): 32 MiB. Ölçü: olağan kayıt ~500 bayt (5000 kayıt ~2,5 MB), dolu
/// telefon (`KAYIT_ADET` = 50 000, mezar taşları dahil) ~25 MB; sınır onu taşır. Çekirdek bu metni bir kez
/// tutar, ağacı tek kayıt için kurar (`yapi_tara`); Kotlin kabı açarken de bu sınırla sayar. Daha büyük
/// belge açık hatayla reddedilir (ürün sınırıdır: dolu bir telefonun yedeği sığar).
pub(crate) const BELGE_AZAMI_BAYT: usize = 32 * 1024 * 1024;
/// `kayitlar` dizisinin öğe sınırı: `KAYIT_ADET`'in iki katı (telefon en çok `KAYIT_ADET` satır yazar;
/// yinelenen ya da bozuk öğelere pay). Aşan belge, dizi ağaca çevrilmeden reddedilir.
pub(crate) const KAYIT_DIZISI_AZAMI: usize = 2 * KAYIT_ADET;
/// Tek kayıt öğesinin metin sınırı: 256 KiB. Sözleşme sınırlarıyla en büyük kayıt ~50 KB (açıklama 4000
/// birim, en kötü kaçışla 24 KB; 500 örnek ~20 KB); girintili yazıma pay. Aşan öğe geçersiz sayılır.
pub(crate) const KAYIT_AZAMI_BAYT: usize = 256 * 1024;
/// `kayitlar` dışındaki sözcüklerin (anahtar ya da değer) sınırı: `EK_AZAMI_ADET` ek × 7 sözcük + pay.
const DIS_SOZCUK_AZAMI: usize = 100_000;
/// Ek dizininin öğe sınırı (Kotlin `YedekKabi.AZAMI_EK_SAYISI`).
const EK_AZAMI_ADET: usize = 10_000;
/// İç içeliğin sınırı (serde_json'un da sınırı 128'dir).
const DERINLIK_AZAMI: usize = 128;
/// Kaydın `guncelleme_ms`'inin şimdinin ötesinde kabul edilen payı: 1 gün. Cihaz saatleri arasındaki olağan
/// kayma ve yanlış dilimle elle kurulmuş saat (en çok ~14 saat) geçer; daha ilerisi bozuk saat ya da
/// düzenlenmiş dosyadır.
pub(crate) const GELECEK_TOLERANSI_MS: i64 = 24 * 60 * 60 * 1000;
/// Bir ekin tam boyunun üst sınırı (v3 taslağı: 4 MiB).
pub(crate) const EK_AZAMI_BAYT: i64 = 4 * 1024 * 1024;
/// Önizlemede konumu verilen geçersiz kayıt sayısı.
const GECERSIZ_ORNEK: usize = 20;

pub(crate) fn aktarma_bicimi() -> AktarmaBicimi {
    AktarmaBicimi {
        belge_adi: BELGE_ADI.into(),
        ekler_dizini: EKLER_DIZINI.into(),
        bicim_surumu: BICIM_SURUMU,
        belge_azami_bayt: BELGE_AZAMI_BAYT as u64,
        ek_azami_bayt: EK_AZAMI_BAYT as u64,
    }
}

/// Hata yollarında görünebilecek adlar: belgenin, kaydın ve parçalarının şema alanları (ve v3 ek alanları).
/// Bilinmeyen alan hatası alanın adını yolun sonuna koyar; ad dosyanın içeriğidir, mesaja girmez.
const SEMA_ADLARI: &[&str] = &[
    "bicim", "bicim_surumu", "sozlesme_surumu", "uygulama_surumu", "olusturma_ms", "kip", "kayitlar", "ekler", "bolgeler",
    "ozet", "bayt", "mime", "ek_id", "genislik", "yukseklik", "kapak", "aciklama", "adet", "alinti", "aralik", "baslangic",
    "baslik", "bitis", "bitis_tarihi", "device_id", "dk", "durum", "elle_alanlar", "gun_bolumu", "guncelleme_ms", "gunler",
    "hatirlatmalar", "ifade", "kayit_id", "kaynak", "kaynak_msg_id", "kesinlik", "ornekler", "oturum_id", "revizyon", "saat",
    "saat_dilimi", "siklik", "silindi", "sohbet_id", "sure_dk", "tarih", "taslak", "tekil_anahtar", "tekrar", "tur", "tur_kokeni",
    "yol", "zaman",
];

/// Yolun yalnız şema adlarından ve sıra numaralarından oluşan başı (ilk yabancı parçada kesilir); boşsa
/// `belge`.
fn guvenli_yol(yol: &str) -> String {
    let parcalar: Vec<&str> = yol
        .split('.')
        .take_while(|p| !p.is_empty() && (p.bytes().all(|b| b.is_ascii_digit()) || SEMA_ADLARI.contains(p)))
        .collect();
    if parcalar.is_empty() { "belge".to_string() } else { parcalar.join(".") }
}

fn belge_hatasi(alan: &str, neden: &str) -> CekirdekHatasi {
    CekirdekHatasi::GecersizGirdi { alan: alan.to_string(), neden: neden.to_string() }
}

fn sema_hatasi(h: SemaHatasi) -> CekirdekHatasi {
    belge_hatasi(&guvenli_yol(&h.yol), h.neden)
}

/// Kaydın başvurduğu ek dosyaları. Bağlantı noktası: sözleşme v3'te kaydın `ekler` listesinden (`ozet`, `bayt`,
/// `mime`) doldurulur; bugün kayıtta ek alanı yoktur.
fn kayit_ekleri(_k: &AjandaKaydi) -> Vec<EkDosyasi> {
    Vec::new()
}

fn ek_dosyasi(ozet: String, bayt: i64, mime: String) -> EkDosyasi {
    EkDosyasi { yol: format!("{EKLER_DIZINI}{ozet}"), ozet, bayt, mime }
}

fn ek_json(e: &EkDosyasi) -> Value {
    serde_json::json!({ "ozet": e.ozet, "bayt": e.bayt, "mime": e.mime })
}

/// `type/subtype`, küçük harf ASCII, en çok 127 karakter.
fn mime_gecerli(s: &str) -> bool {
    let parca = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"+-.".contains(&b));
    s.len() <= 127 && s.split_once('/').is_some_and(|(a, b)| parca(a) && parca(b))
}

fn ek_oku(v: &Value, yol: &str) -> Sonuc<EkDosyasi> {
    let mut n = Nesne::ac(v, yol)?;
    let ozet = n.zorunlu("ozet", |v, y| {
        let s = metin(v, y)?;
        if s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            Ok(s.to_string())
        } else {
            hata(y, "sha256 küçük harf hex değil")
        }
    })?;
    let bayt = n.zorunlu("bayt", |v, y| tam_sayi(v, y, 1, EK_AZAMI_BAYT))?;
    let mime = n.zorunlu("mime", |v, y| {
        let s = metin(v, y)?;
        if mime_gecerli(s) { Ok(s.to_string()) } else { hata(y, "mime türü değil") }
    })?;
    n.bitir()?;
    Ok(ek_dosyasi(ozet, bayt, mime))
}

fn kip_adi(yerel: bool) -> &'static str {
    if yerel { "yerel" } else { "bagli" }
}

/// Çözülmüş belge: kayıt öğeleri henüz okunmamıştır (her biri `plan_kur`'da ayrı ayrı, metin aralığından).
struct Belge<'a> {
    metin: &'a str,
    olusturma_ms: i64,
    /// `kayitlar` öğelerinin `metin`'deki (baş, son) aralıkları.
    kayitlar: Vec<(usize, usize)>,
    ekler: Vec<EkDosyasi>,
}

/// `ofset`'teki konum, serde_json'un sayışıyla (satır 1'den, sütun satırdaki bayt sayısı).
fn konum(metin_: &str, ofset: usize) -> (usize, usize) {
    let on = &metin_.as_bytes()[..ofset.min(metin_.len())];
    (1 + on.iter().filter(|&&b| b == b'\n').count(), on.iter().rev().take_while(|&&b| b != b'\n').count())
}

/// serde_json konumunun (satır, sütun) `metin`'deki ofseti (`konum`'un tersi).
fn ofset(metin_: &str, satir: usize, sutun: usize) -> usize {
    let bas = if satir <= 1 {
        0
    } else {
        metin_.bytes().enumerate().filter(|(_, b)| *b == b'\n').nth(satir - 2).map_or(metin_.len(), |(i, _)| i + 1)
    };
    (bas + sutun).min(metin_.len())
}

/// Sözdizimi hatası: yalnız satır ve sütun (içerik yok).
fn json_degil(metin_: &str, ofset_: usize) -> CekirdekHatasi {
    let (satir, sutun) = konum(metin_, ofset_);
    belge_hatasi("belge", &format!("JSON değil (satır {satir}, sütun {sutun})"))
}

fn cok_fazla(alan: &str, azami: usize) -> CekirdekHatasi {
    belge_hatasi(alan, &format!("çok fazla öğe (en çok {azami})"))
}

/// `yapi_tara`'nın sonucu.
#[derive(Debug, Default, PartialEq)]
struct Tarama {
    /// Kökteki `kayitlar` dizisinin `[`'ından `]`'ının ardına (`kayitlar` dizi değilse ya da yoksa `None`).
    dizi: Option<(usize, usize)>,
    /// Öğelerin (baş, son) aralıkları; baştaki ve sondaki boşluk dışarıda.
    ogeler: Vec<(usize, usize)>,
}

fn bosluk(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

/// Metni ağaç kurmadan bir kez geçer: parantez dengesi, dizgilerin sonu, kökteki `kayitlar` dizisinin öğe
/// aralıkları ve sınırlar (`KAYIT_DIZISI_AZAMI`: sayım aşınca hemen durur; `DIS_SOZCUK_AZAMI`,
/// `DERINLIK_AZAMI`). Sayılar, sabitler ve nesnelerin iç dizilişi burada denetlenmez: kayıtlar dışını ve her
/// öğeyi serde_json okur. Bellek: parantez yığını (en çok `DERINLIK_AZAMI`) ve öğe aralıkları.
fn yapi_tara(metin_: &str) -> Result<Tarama, CekirdekHatasi> {
    let b = metin_.as_bytes();
    let mut t = Tarama::default();
    let mut yigin: Vec<u8> = Vec::new();
    let mut dis_sozcuk = 0usize;
    // Kök nesnede: sıradaki dizgi anahtar mı; son anahtar `kayitlar` mıydı; o anahtar görüldü mü.
    let (mut anahtar_bekleniyor, mut kayitlar_anahtari, mut kayitlar_goruldu) = (false, false, false);
    // `kayitlar` dizisinin içinde mi; dizinin başı; süren öğenin başı; son ayraç virgül müydü.
    let (mut dizide, mut dizi_basi, mut oge_basi, mut virgulden_sonra) = (false, 0usize, None::<usize>, false);
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if bosluk(c) {
            i += 1;
            continue;
        }
        // Bir değer (ya da kök dışında anahtar) başlıyor mu: kapanış ve ayraçlar dışında her sözcük.
        let anahtar = c == b'"' && anahtar_bekleniyor && yigin.len() == 1;
        if !matches!(c, b'}' | b']' | b',' | b':') && !anahtar {
            if dizide && yigin.len() == 2 {
                if oge_basi.is_some() {
                    return Err(json_degil(metin_, i + 1));
                }
                if t.ogeler.len() >= KAYIT_DIZISI_AZAMI {
                    return Err(cok_fazla("kayitlar", KAYIT_DIZISI_AZAMI));
                }
                oge_basi = Some(i);
                virgulden_sonra = false;
            } else if !dizide {
                dis_sozcuk += 1;
            }
        }
        if anahtar {
            dis_sozcuk += 1;
        }
        if dis_sozcuk > DIS_SOZCUK_AZAMI {
            return Err(cok_fazla("belge", DIS_SOZCUK_AZAMI));
        }
        match c {
            b'{' | b'[' => {
                if c == b'[' && kayitlar_anahtari && yigin.len() == 1 {
                    dizide = true;
                    dizi_basi = i;
                }
                kayitlar_anahtari = false;
                yigin.push(c);
                if yigin.len() > DERINLIK_AZAMI {
                    return Err(belge_hatasi("belge", &format!("çok derin (en çok {DERINLIK_AZAMI})")));
                }
                anahtar_bekleniyor = yigin.len() == 1 && c == b'{';
                i += 1;
            }
            b'}' | b']' => {
                let ac = if c == b'}' { b'{' } else { b'[' };
                if yigin.pop() != Some(ac) {
                    return Err(json_degil(metin_, i + 1));
                }
                if dizide && yigin.len() == 1 {
                    // `kayitlar`'ın kapanışı: süren öğe biter; boş öğe (`[1,]`) sözdizimi hatası.
                    match oge_basi.take() {
                        Some(bas) => t.ogeler.push((bas, oge_sonu(b, bas, i))),
                        None if virgulden_sonra => return Err(json_degil(metin_, i + 1)),
                        None => {}
                    }
                    dizide = false;
                    t.dizi = Some((dizi_basi, i + 1));
                }
                i += 1;
            }
            b',' => {
                if dizide && yigin.len() == 2 {
                    let Some(bas) = oge_basi.take() else { return Err(json_degil(metin_, i + 1)) };
                    t.ogeler.push((bas, oge_sonu(b, bas, i)));
                    virgulden_sonra = true;
                }
                if yigin.len() == 1 && yigin[0] == b'{' {
                    anahtar_bekleniyor = true;
                }
                kayitlar_anahtari = false;
                i += 1;
            }
            b':' => i += 1,
            b'"' => {
                let bas = i;
                i = dizgi_sonu(b, i).ok_or_else(|| json_degil(metin_, b.len()))?;
                kayitlar_anahtari = false;
                if anahtar {
                    anahtar_bekleniyor = false;
                    let ham = &metin_[bas..i];
                    // Kaçışlı anahtar (bir harfi `\u` kaçışıyla yazılmış) çözülür: serde_json onu da `kayitlar` okur.
                    let ad = if ham.contains('\\') { serde_json::from_str::<String>(ham).ok() } else { Some(ham[1..ham.len() - 1].to_string()) };
                    if ad.as_deref() == Some("kayitlar") {
                        if kayitlar_goruldu {
                            return Err(belge_hatasi("kayitlar", "yinelenen alan"));
                        }
                        kayitlar_goruldu = true;
                        kayitlar_anahtari = true;
                    }
                }
            }
            _ => {
                kayitlar_anahtari = false;
                while i < b.len() && !bosluk(b[i]) && !matches!(b[i], b',' | b':' | b'{' | b'[' | b'}' | b']' | b'"') {
                    i += 1;
                }
            }
        }
    }
    if !yigin.is_empty() {
        return Err(json_degil(metin_, b.len()));
    }
    Ok(t)
}

/// Dizginin kapanış tırnağının ardı (`i` açılış tırnağı); kapanmamışsa `None`.
fn dizgi_sonu(b: &[u8], mut i: usize) -> Option<usize> {
    i += 1;
    while i < b.len() {
        match b[i] {
            b'"' => return Some(i + 1),
            b'\\' => i += 2,
            _ => i += 1,
        }
    }
    None
}

/// `bas`'ta başlayıp `ayrac`'ta biten öğenin sonu (sondaki boşluk dışarıda).
fn oge_sonu(b: &[u8], bas: usize, ayrac: usize) -> usize {
    let mut son = ayrac;
    while son > bas && bosluk(b[son - 1]) {
        son -= 1;
    }
    son
}

/// Belgenin üst düzeyini okur (kayıtlar ayrı ayrı `plan_kur`'da). Hata: `GecersizGirdi{alan, neden}`.
fn belge_coz(metin_: &str) -> Result<Belge<'_>, CekirdekHatasi> {
    if metin_.len() > BELGE_AZAMI_BAYT {
        return Err(belge_hatasi("belge", &format!("çok büyük (en çok {} MiB)", BELGE_AZAMI_BAYT / (1024 * 1024))));
    }
    let tarama = yapi_tara(metin_)?;
    // `kayitlar` dizisi boşaltılmış metin (ağaç yalnız üst düzey için kurulur); hata konumu asıl metne çevrilir.
    let mut v: Value = match tarama.dizi {
        None => serde_json::from_str(metin_).map_err(|e| json_degil(metin_, ofset(metin_, e.line(), e.column()))),
        Some((bas, son)) => {
            let kirpik = format!("{}[]{}", &metin_[..bas], &metin_[son..]);
            serde_json::from_str(&kirpik).map_err(|e| {
                let o = ofset(&kirpik, e.line(), e.column());
                json_degil(metin_, if o > bas + 1 { o + (son - bas - 2) } else { o })
            })
        }
    }?;
    let Value::Object(harita) = &mut v else { return Err(belge_hatasi("belge", "nesne değil")) };
    if harita.get("bicim").and_then(Value::as_str) != Some(BICIM) {
        return Err(belge_hatasi("bicim", "ajanda yedeği değil"));
    }
    let surum = |h: &Map<String, Value>, ad: &'static str| -> Result<i64, CekirdekHatasi> {
        match h.get(ad) {
            Some(s) => tam_sayi(s, ad, 1, GUVENLI_TAM_SAYI).map_err(sema_hatasi),
            None => Err(belge_hatasi(ad, "zorunlu alan yok")),
        }
    };
    if surum(harita, "bicim_surumu")? > BICIM_SURUMU {
        return Err(belge_hatasi("bicim_surumu", "daha yeni bir biçim: uygulamayı güncelleyin"));
    }
    if surum(harita, "sozlesme_surumu")? > AJANDA_SURUMU {
        return Err(belge_hatasi("sozlesme_surumu", "daha yeni bir sözleşme: uygulamayı güncelleyin"));
    }
    // Büyük diziler kopyalanmadan alınır; kalan üst düzey katı okunur.
    let mut dizi = |ad: &'static str| match harita.remove(ad) {
        Some(Value::Array(a)) => Ok(a),
        Some(_) => Err(belge_hatasi(ad, "dizi değil")),
        None => Err(belge_hatasi(ad, "zorunlu alan yok")),
    };
    // `kayitlar` dizi ise tarama boşaltmıştır; öğeleri taramanın aralıklarıdır.
    dizi("kayitlar")?;
    let ek_ogeleri = dizi("ekler")?;
    if !dizi("bolgeler")?.is_empty() {
        return Err(belge_hatasi("bolgeler", "bu biçim sürümünde bölge öğesi tanımsız"));
    }
    if ek_ogeleri.len() > EK_AZAMI_ADET {
        return Err(cok_fazla("ekler", EK_AZAMI_ADET));
    }
    let mut ekler = Vec::with_capacity(ek_ogeleri.len());
    let mut ozetler = HashSet::new();
    for (i, e) in ek_ogeleri.iter().enumerate() {
        let yol = format!("ekler.{i}");
        let ek = ek_oku(e, &yol).map_err(sema_hatasi)?;
        if !ozetler.insert(ek.ozet.clone()) {
            return Err(belge_hatasi(&format!("{yol}.ozet"), "yinelenen ozet"));
        }
        ekler.push(ek);
    }
    let mut n = Nesne::ac(&v, "").map_err(sema_hatasi)?;
    n.ham("bicim");
    n.ham("bicim_surumu");
    n.ham("sozlesme_surumu");
    let olusturma_ms = n.zorunlu("olusturma_ms", zaman_ms_oku).map_err(sema_hatasi)?;
    n.zorunlu("kip", |v, y| match metin(v, y)? {
        "yerel" | "bagli" => Ok(()),
        _ => hata(y, "kapalı listede yok"),
    })
    .map_err(sema_hatasi)?;
    n.zorunlu("uygulama_surumu", |v, y| {
        let s = metin(v, y)?;
        if (1..=64).contains(&s.len()) { Ok(()) } else { hata(y, "1-64 karakter") }
    })
    .map_err(sema_hatasi)?;
    n.bitir().map_err(sema_hatasi)?;
    Ok(Belge { metin: metin_, olusturma_ms, kayitlar: tarama.ogeler, ekler })
}

/// Bir kaydın sınıfı (`plan_kur`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sinif {
    Yeni,
    Guncellenecek,
    Ayni,
    Atlanacak,
    Gecersiz,
    SinirAsan,
    Gonderilmeyecek,
    /// Bağlı kipte telefonda olmayan taslak: servis taslak olarak alamaz, gönderilmez.
    Taslak,
}

/// Yazılacak kayıt: dosyadaki hal, telefondaki önceki hal (okunabildiyse) ve bağlı kipte kuyruğa girecek
/// işlemler.
struct Yazilacak {
    kayit: AjandaKaydi,
    onceki: Option<AjandaKaydi>,
    islemler: Vec<(AjandaIslem, i64)>,
}

struct Plan {
    onizleme: IceAktarmaOnizlemesi,
    yazilacaklar: Vec<Yazilacak>,
}

/// FNV-1a 64: planın izi (aynı süreçte ve sürümde karşılaştırılır; güvenlik değil, tutarlılık içindir).
struct Iz(u64);

impl Iz {
    fn yeni() -> Iz {
        Iz(0xcbf2_9ce4_8422_2325)
    }
    fn kat(&mut self, baytlar: &[u8]) {
        for b in baytlar {
            self.0 ^= u64::from(*b);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
        self.0 ^= 0xff;
        self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
    }
}

/// Revizyon ve güncelleme anı dışında eşit mi (yerel kipte "aynı").
fn yerelde_ayni(a: &AjandaKaydi, b: &AjandaKaydi) -> bool {
    let n = |k: &AjandaKaydi| AjandaKaydi { revizyon: 1, guncelleme_ms: 0, ..k.clone() };
    n(a) == n(b)
}

/// Dilimi bilinmeyen alanın yolu (zamanın ya da `mutlak` hatırlatmanın dilimi), yoksa `None`.
fn dilim_sorunu(k: &AjandaKaydi, bilinir: &mut impl FnMut(&str) -> bool) -> Option<&'static str> {
    if let Some(d) = k.zaman.as_ref().and_then(|z| z.saat_dilimi())
        && !bilinir(d)
    {
        return Some("zaman.saat_dilimi");
    }
    for h in &k.hatirlatmalar {
        if let Hatirlatma::Mutlak { saat_dilimi, .. } = h
            && !bilinir(saat_dilimi)
        {
            return Some("hatirlatmalar");
        }
    }
    None
}

/// Telefonun şimdiki haline göre planı kurar (salt okur). `yerel`: çalışma kipi.
fn plan_kur(d: &Depo, o: &Ortam, belge: Belge, yerel: bool) -> Result<Plan, CekirdekHatasi> {
    let telefondaki: HashMap<String, String> = d.gorunen_ham_hepsi()?.into_iter().collect();
    let mut kalan_yer = (KAYIT_ADET as i64 - telefondaki.len() as i64).max(0);
    let mut dilimler: HashMap<String, bool> = HashMap::new();
    let simdi = o.simdi_ms();
    let mut bilinir = |dilim: &str| {
        *dilimler.entry(dilim.to_string()).or_insert_with(|| o.zaman.andan_yerele(simdi, dilim.to_string()).is_ok())
    };
    let gelecek_siniri = simdi.saturating_add(GELECEK_TOLERANSI_MS);
    let mut gorulen: HashSet<String> = HashSet::new();
    let mut iz = Iz::yeni();
    iz.kat(kip_adi(yerel).as_bytes());
    for e in &belge.ekler {
        iz.kat(ek_json(e).to_string().as_bytes());
    }
    let mut p = IceAktarmaOnizlemesi {
        kip: if yerel { CalismaKipi::Yerel } else { CalismaKipi::Bagli },
        disa_aktarma_ms: belge.olusturma_ms,
        toplam: sayi(belge.kayitlar.len()),
        silinmis: 0,
        yeni: 0,
        guncellenecek: 0,
        ayni: 0,
        atlanacak: 0,
        gecersiz: 0,
        sinir_asan: 0,
        gonderilmeyecek: 0,
        kuyruga_girecek_islem: 0,
        gecersizler: Vec::new(),
        ekler: belge.ekler,
        iz: String::new(),
        silinecek: 0,
        geri_yuklenecek: 0,
        taslak_gonderilmeyecek: 0,
    };
    let mut yazilacaklar = Vec::new();
    for (i, &(bas, son)) in belge.kayitlar.iter().enumerate() {
        let ham = &belge.metin[bas..son];
        // Dosyadaki içerik ize girer: aynı sınıflı başka bir dosya eski izle uygulanmaz.
        iz.kat(ham.as_bytes());
        let kok = format!("kayitlar.{i}");
        let gecersiz = |alan: String, neden: &str| GecersizKayit { sira: sayi(i), alan, neden: neden.to_string() };
        let sonuc: Result<AjandaKaydi, GecersizKayit> = if ham.len() > KAYIT_AZAMI_BAYT {
            Err(gecersiz(kok.clone(), "kayıt çok büyük"))
        } else {
            // Öğenin içindeki sözdizimi hatası bütün belgeyi reddeder (dosya bozuk); konum asıl metinde.
            let v: Value = serde_json::from_str(ham).map_err(|e| json_degil(belge.metin, bas + ofset(ham, e.line(), e.column())))?;
            AjandaKaydi::oku(&v, &kok).map_err(|h| gecersiz(guvenli_yol(&h.yol), h.neden)).and_then(|k| {
                if gorulen.contains(&k.kayit_id) {
                    return Err(gecersiz(format!("{kok}.kayit_id"), "dosyada yinelenen kayit_id"));
                }
                // `olusturma_ms <= guncelleme_ms` modelce zorunlu: ikisi de sınırlanır.
                if k.guncelleme_ms > gelecek_siniri {
                    return Err(gecersiz(format!("{kok}.guncelleme_ms"), "gelecekte (saat ileri ya da dosya bozuk)"));
                }
                match dilim_sorunu(&k, &mut bilinir) {
                    Some(alan) => Err(gecersiz(format!("{kok}.{alan}"), "saat dilimi bilinmiyor")),
                    None => Ok(k),
                }
            })
        };
        let k = match sonuc {
            Ok(k) => k,
            Err(g) => {
                p.gecersiz += 1;
                if p.gecersizler.len() < GECERSIZ_ORNEK {
                    p.gecersizler.push(g);
                }
                iz.kat(&[Sinif::Gecersiz as u8]);
                continue;
            }
        };
        gorulen.insert(k.kayit_id.clone());
        if k.silindi {
            p.silinmis += 1;
        }
        let ayni = |t: &AjandaKaydi| if yerel { yerelde_ayni(t, &k) } else { icerik_ayni(t, &k) };
        let (sinif, yazilacak) = match telefondaki.get(&k.kayit_id) {
            None if !yerel && k.silindi => (Sinif::Gonderilmeyecek, None),
            // Servis `ekle`'si onaylanmış kayıt doğurur: onaylanmamış öneri onaylanmış gibi gitmez.
            None if !yerel && k.taslak => (Sinif::Taslak, None),
            None if kalan_yer <= 0 => (Sinif::SinirAsan, None),
            None => {
                kalan_yer -= 1;
                let islemler = if yerel { Vec::new() } else { kuyruga_islemler(None, &k, false) };
                (Sinif::Yeni, Some(Yazilacak { kayit: k.clone(), onceki: None, islemler }))
            }
            Some(json) => match kayit_coz(json) {
                // Okunamayan telefon satırı: yerelde dosyadaki onu onarır; bağlı kipte servise ne gideceği
                // bilinemez, dokunulmaz.
                None if yerel => (Sinif::Guncellenecek, Some(Yazilacak { kayit: k.clone(), onceki: None, islemler: Vec::new() })),
                None => (Sinif::Atlanacak, None),
                Some(t) if ayni(&t) => (Sinif::Ayni, None),
                Some(t) if k.guncelleme_ms <= t.guncelleme_ms => (Sinif::Atlanacak, None),
                Some(t) if yerel => (Sinif::Guncellenecek, Some(Yazilacak { kayit: k.clone(), onceki: Some(t), islemler: Vec::new() })),
                Some(t) => {
                    let islemler = kuyruga_islemler(Some(&t), &k, true);
                    if islemler.is_empty() {
                        (Sinif::Ayni, None)
                    } else {
                        (Sinif::Guncellenecek, Some(Yazilacak { kayit: k.clone(), onceki: Some(t), islemler }))
                    }
                }
            },
        };
        match sinif {
            Sinif::Yeni => p.yeni += 1,
            Sinif::Guncellenecek => p.guncellenecek += 1,
            Sinif::Ayni => p.ayni += 1,
            Sinif::Atlanacak => p.atlanacak += 1,
            Sinif::SinirAsan => p.sinir_asan += 1,
            Sinif::Gonderilmeyecek => p.gonderilmeyecek += 1,
            Sinif::Taslak => p.taslak_gonderilmeyecek += 1,
            Sinif::Gecersiz => unreachable!(),
        }
        iz.kat(&[sinif as u8]);
        iz.kat(k.kayit_id.as_bytes());
        if let Some(y) = yazilacak {
            // Etkilenecek kaydın telefondaki satırı (içerik ve yazım kimliği) ize girer: önizlemeden sonra
            // sınıfı değiştirmeden değişen telefon kaydı eski izle ezilmez.
            if let Some(json) = telefondaki.get(&k.kayit_id) {
                iz.kat(json.as_bytes());
            }
            match &y.onceki {
                Some(t) if !t.silindi && k.silindi => p.silinecek += 1,
                Some(t) if t.silindi && !k.silindi => p.geri_yuklenecek += 1,
                _ => {}
            }
            p.kuyruga_girecek_islem += sayi(y.islemler.len());
            yazilacaklar.push(y);
        }
    }
    p.iz = format!("{:016x}", iz.0);
    Ok(Plan { onizleme: p, yazilacaklar })
}

/// İçe aktarmanın yerel geçmiş satırı: yeni kayıtta doğum parçası (mezar taşı ve örnekler dahil), var olanda
/// servisin `fark`'ı. An içe aktarmanın anıdır (kaydın `guncelleme_ms`'i dosyadaki gibi kalır).
fn ice_aktarma_girdisi(onceki: Option<&AjandaKaydi>, yeni: &AjandaKaydi, yazar: AjandaYazar, ts_ms: i64) -> AjandaGecmisGirdisi {
    let (islem, temel_revizyon, onceki_p, sonraki_p) = match onceki {
        Some(o) => {
            let (a, b) = fark(o, yeni);
            (IslemTuru::Guncelle, Some(o.revizyon), a, b)
        }
        None => {
            let mut s = dogum_parcasi(yeni);
            if yeni.silindi {
                s.silindi = Some(true);
            }
            if !yeni.ornekler.is_empty() {
                s.ornekler = Some(yeni.ornekler.clone());
            }
            (IslemTuru::Ekle, None, AjandaParca::default(), s)
        }
    };
    AjandaGecmisGirdisi {
        rev: yeni.revizyon,
        ts_ms,
        islem,
        yazar,
        temel_revizyon,
        korunan_alanlar: None,
        ornek_tarihi: None,
        onceki: onceki_p,
        sonraki: sonraki_p,
    }
}

fn sayi(n: usize) -> i32 {
    i32::try_from(n).unwrap_or(i32::MAX)
}

impl Motor {
    /// Dışa aktarma: görünen kopyanın bütün satırları (mezar taşları dahil; bağlı kipte gönderilmemiş
    /// değişiklikler dahil). Okunamayan satır kaybolmaz: JSON'u olduğu gibi (o da değilse metni) belgeye
    /// girer ve sayılır. Hiçbir şey yazmaz.
    pub(crate) fn disa_aktar(&self, o: &Ortam) -> Result<DisaAktarma, CekirdekHatasi> {
        let yerel = self.yerel_mi()?;
        let satirlar = self.depo.gorunen_ham_hepsi()?;
        let mut kayitlar = Vec::with_capacity(satirlar.len());
        let mut ekler: BTreeMap<String, EkDosyasi> = BTreeMap::new();
        let (mut silinmis, mut okunamayan) = (0, 0);
        for (_, json) in satirlar {
            match kayit_coz(&json) {
                Some(k) => {
                    silinmis += usize::from(k.silindi);
                    for e in kayit_ekleri(&k) {
                        ekler.entry(e.ozet.clone()).or_insert(e);
                    }
                    kayitlar.push(k.json());
                }
                None => {
                    okunamayan += 1;
                    kayitlar.push(serde_json::from_str(&json).unwrap_or(Value::String(json)));
                }
            }
        }
        let ekler: Vec<EkDosyasi> = ekler.into_values().collect();
        let kayit = sayi(kayitlar.len());
        let belge = serde_json::json!({
            "bicim": BICIM,
            "bicim_surumu": BICIM_SURUMU,
            "sozlesme_surumu": AJANDA_SURUMU,
            "uygulama_surumu": env!("CARGO_PKG_VERSION"),
            "olusturma_ms": o.simdi_ms(),
            "kip": kip_adi(yerel),
            "kayitlar": Value::Array(kayitlar),
            "ekler": ekler.iter().map(ek_json).collect::<Vec<_>>(),
            "bolgeler": [],
        })
        .to_string();
        Ok(DisaAktarma {
            belge,
            kayit,
            silinmis: sayi(silinmis),
            okunamayan: sayi(okunamayan),
            ret_listesinde: i32::try_from(self.depo.ret_sayisi()?).unwrap_or(i32::MAX),
            kip: if yerel { CalismaKipi::Yerel } else { CalismaKipi::Bagli },
            ekler,
        })
    }

    /// İçe aktarmanın önizlemesi (hiçbir şey yazmaz). Belge bütünüyle okunamazsa `GecersizGirdi`.
    pub(crate) fn ice_aktarma_onizlemesi(&self, o: &Ortam, belge: &str) -> Result<IceAktarmaOnizlemesi, CekirdekHatasi> {
        let belge = belge_coz(belge)?;
        Ok(plan_kur(&self.depo, o, belge, self.yerel_mi()?)?.onizleme)
    }

    /// İçe aktarma, tek SQLite işleminde (ya hepsi ya hiçbiri). Plan işlemin içinde yeniden kurulur; `iz`
    /// verildiyse ve tutmazsa hiçbir şey yazılmaz. Kalıcı olunca: alarm senkronu ve `Degisim` (çoksa `tumu`),
    /// bağlı kipte kuyruk ilerler (`Degisim.baglanti`).
    pub(crate) fn ice_aktar(&mut self, o: &Ortam, e: &mut Etkiler, belge: &str, iz: Option<&str>) -> Result<IceAktarmaSonucu, CekirdekHatasi> {
        let belge = belge_coz(belge)?;
        let yerel = self.yerel_mi()?;
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let yazar = AjandaYazar {
            yol: KaynakYolu::Elle,
            tur_kokeni: TurKokeni::Insan,
            device_id: Some(b.device_id.clone()),
            sohbet_id: None,
            oturum_id: None,
        };
        let ts_ms = o.simdi_ms();
        let (plan, degisenler, girdiler) = self.depo.yazma(|d| {
            let Plan { onizleme, yazilacaklar } = plan_kur(d, o, belge, yerel)?;
            if iz.is_some_and(|i| i != onizleme.iz) {
                return Ok((IceAktarmaSonucu { uygulandi: false, plan: onizleme }, Vec::new(), Vec::new()));
            }
            let mut degisenler = Vec::with_capacity(yazilacaklar.len());
            let mut girdiler = Vec::new();
            for y in yazilacaklar {
                let kayit_id = y.kayit.kayit_id.clone();
                if yerel {
                    let mut k = y.kayit;
                    k.revizyon = d.yerel_rev_sonraki(y.onceki.as_ref().map_or(0, |t| t.revizyon))?;
                    let girdi = ice_aktarma_girdisi(y.onceki.as_ref(), &k, yazar.clone(), ts_ms);
                    d.gorunen_yaz(&k, false)?;
                    d.yerel_rev_yaz(k.revizyon)?;
                    d.yerel_gecmis_ekle(&kayit_id, &girdi)?;
                    girdiler.push((kayit_id.clone(), girdi));
                    degisenler.push(kayit_id);
                } else {
                    for (islem, ts) in &y.islemler {
                        d.kuyruga_ekle(&Motor::yeni_kimlik(o, "i_")?, &kayit_id, &islem.json().to_string(), *ts)?;
                    }
                    if gorunen_yenile(d, &b, &kayit_id)? {
                        degisenler.push(kayit_id);
                    }
                }
            }
            Ok((IceAktarmaSonucu { uygulandi: true, plan: onizleme }, degisenler, girdiler))
        })?;
        if !plan.uygulandi {
            return Ok(plan);
        }
        if degisenler.len() > TELAFI_TAMPONU {
            self.hepsi_degisti(o, e);
        } else {
            self.gorunenler_degisti(o, e, &degisenler);
        }
        // Açık geçmiş sayfası (yerel tablodan) yeni satırı başta görsün.
        for (kayit_id, girdi) in girdiler {
            if let Some(sayfa) = self.gecmis.get_mut(&kayit_id) {
                sayfa.satirlar.insert(0, gecmis_satiri(girdi));
                e.degisim.gecmis.push(kayit_id);
            }
        }
        if !yerel && plan.plan.kuyruga_girecek_islem > 0 {
            e.degisim.baglanti = true;
            let _ = self.kuyruk_ilerlet(o, e);
        }
        Ok(plan)
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn guvenli_yol_yalniz_sema_adlarini_ve_sirayi_tasir() {
        assert_eq!(guvenli_yol("kayitlar.3.zaman.saat_dilimi"), "kayitlar.3.zaman.saat_dilimi");
        assert_eq!(guvenli_yol("kayitlar.3.Gizli başlık"), "kayitlar.3");
        assert_eq!(guvenli_yol("kayitlar.3.zaman.gizli.baslik"), "kayitlar.3.zaman");
        assert_eq!(guvenli_yol("gizli"), "belge");
        assert_eq!(guvenli_yol(""), "belge");
    }

    /// Tarama kökteki `kayitlar`'ın öğe aralıklarını verir: dizgideki ayraç ve parantez, kaçış, iç içe dizi
    /// ve başka anahtardaki `kayitlar` dizgisi yanıltmaz.
    #[test]
    fn tarama_kayit_ogelerini_ayirir() {
        let m = r#"{"a":"kayitlar","b":{"kayitlar":[9]}, "kayitlar" : [ {"x":"],\"["} , [1,[2]] ,3 ],"c":[]}"#;
        let t = yapi_tara(m).unwrap();
        let ogeler: Vec<&str> = t.ogeler.iter().map(|&(b, s)| &m[b..s]).collect();
        assert_eq!(ogeler, [r#"{"x":"],\"["}"#, "[1,[2]]", "3"]);
        let (b, s) = t.dizi.unwrap();
        assert_eq!(&m[b..s], r#"[ {"x":"],\"["} , [1,[2]] ,3 ]"#);
        assert_eq!(yapi_tara(r#"{"kayitlar":[]}"#).unwrap().ogeler, []);
        assert_eq!(yapi_tara(r#"{"kayitlar":{"a":[1]}}"#).unwrap(), Tarama::default());
        for bozuk in [r#"{"kayitlar":[1,]}"#, r#"{"kayitlar":[,1]}"#, r#"{"kayitlar":[1 2]}"#, r#"{"a":[}"#, r#"{"a":"#, r#"{"a":"x"#] {
            assert!(yapi_tara(bozuk).is_err(), "{bozuk}");
        }
    }

    #[test]
    fn konum_ve_ofset_birbirinin_tersi() {
        let m = "ab\ncde\n\nf";
        for o in 0..=m.len() {
            let (satir, sutun) = konum(m, o);
            assert_eq!(ofset(m, satir, sutun), o, "{o}");
        }
    }

    #[test]
    fn mime_ve_ek_ogesi_denetlenir() {
        assert!(mime_gecerli("image/jpeg") && mime_gecerli("image/svg+xml"));
        assert!(!mime_gecerli("image") && !mime_gecerli("Image/JPEG") && !mime_gecerli("/x"));
        let ozet = "a".repeat(64);
        let ek = ek_oku(&serde_json::json!({"ozet": ozet, "bayt": 10, "mime": "image/jpeg"}), "ekler.0").unwrap();
        assert_eq!(ek.yol, format!("ekler/{ozet}"));
        let buyuk = serde_json::json!({"ozet": ozet, "bayt": EK_AZAMI_BAYT + 1, "mime": "image/jpeg"});
        assert_eq!(ek_oku(&buyuk, "ekler.0").unwrap_err().yol, "ekler.0.bayt");
        let buyuk_harf = serde_json::json!({"ozet": "A".repeat(64), "bayt": 1, "mime": "image/jpeg"});
        assert!(ek_oku(&buyuk_harf, "ekler.0").is_err());
    }
}
