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
//! İçe aktarma (`plan_kur`): her kayıt ayrı sınıflanır; tek bozuk kayıt bütün aktarmayı düşürmez.
//! - geçersiz: modelin okuyucusundan ya da kurallarından geçmeyen, dosyada yinelenen `kayit_id`, dilimi
//!   bilinmeyen (`ZamanKabugu.andan_yerele`; yerel yazarın `ekle` denetimi);
//! - yeni: telefonda yok. Kayıt sınırı (`KAYIT_ADET`, mezar taşları dahil) dolunca `sinir_asan`;
//! - aynı: yerelde revizyon ve güncelleme anı dışında her alan eşit; bağlı kipte servise gidecek alanlar
//!   eşit (`icerik_ayni`) ya da gidecek işlem yok;
//! - güncellenecek: dosyadaki `guncelleme_ms` büyük; atlanacak: telefondaki büyük ya da eşit (telefon kalır).
//!   Telefondaki satır okunamıyorsa yerelde dosyadaki yazılır (onarır), bağlı kipte atlanır.
//!
//! Uygulama (`ice_aktar`) tek SQLite işlemidir: plan işlemin içinde yeniden kurulur, `iz` verildiyse ve
//! şimdiki planınkiyle tutmazsa hiçbir şey yazılmaz (`uygulandi` yanlış, yeni plan döner).
//! - Yerel kip: kayıt alanları korunur (oluşturma ve güncelleme anı, kaynak izi, elle alanlar, örnekler,
//!   durum, taslak, silindi), revizyon yerel sayaçtan, yerel geçmişe bir satır (yeni: doğum parçası,
//!   güncelleme: fark; yazar insan elle, an içe aktarma anı); kalıcı olunca alarm senkronu.
//! - Bağlı kip: servis yazardır; D1'in dökme kuralıyla (`kuyruga_islemler`) görünen hal ile dosyadaki hal
//!   arasındaki işlemler kuyruğa girer (yeni: aynı kimlikle `ekle`, sonra durum, örnekler, `sil`; güncelleme:
//!   `geri_yukle`, `guncelle`, `durum`, örnekler, `onayla`, `sil`). Kaybolanlar: kaynak izi (servis
//!   `ekle`'yi bu telefonun elle/sesli not yazması sayar), oluşturma ve güncelleme anı (servisin), `elle_alanlar`
//!   (servis hesaplar), yeni kaydın taslak işareti ve taslak olmayan kaydı taslağa döndürme, telefonda olmayan
//!   mezar taşları (`gonderilmeyecek`). Servisin reddettiği işlem bugünkü gibi ret listesine düşer.
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
/// Belgenin üst sınırı (UTF-8 bayt). 5000 kayıt ~2,5 MB; sınır yalnız kötü dosyaya karşı bekçidir.
pub(crate) const BELGE_AZAMI_BAYT: usize = 256 * 1024 * 1024;
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

/// Çözülmüş belge: kayıt öğeleri henüz okunmamıştır (her biri `plan_kur`'da ayrı ayrı).
struct Belge {
    olusturma_ms: i64,
    kayitlar: Vec<Value>,
    ekler: Vec<EkDosyasi>,
}

/// Belgenin üst düzeyini okur (kayıtlar ayrı ayrı `plan_kur`'da). Hata: `GecersizGirdi{alan, neden}`.
fn belge_coz(metin_: &str) -> Result<Belge, CekirdekHatasi> {
    if metin_.len() > BELGE_AZAMI_BAYT {
        return Err(belge_hatasi("belge", "çok büyük"));
    }
    let mut v: Value = serde_json::from_str(metin_)
        .map_err(|e| belge_hatasi("belge", &format!("JSON değil (satır {}, sütun {})", e.line(), e.column())))?;
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
    let kayitlar = dizi("kayitlar")?;
    let ek_ogeleri = dizi("ekler")?;
    if !dizi("bolgeler")?.is_empty() {
        return Err(belge_hatasi("bolgeler", "bu biçim sürümünde bölge öğesi tanımsız"));
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
    Ok(Belge { olusturma_ms, kayitlar, ekler })
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
    let mut gorulen: HashSet<String> = HashSet::new();
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
    };
    let mut iz = Iz::yeni();
    iz.kat(kip_adi(yerel).as_bytes());
    let mut yazilacaklar = Vec::new();
    for (i, v) in belge.kayitlar.iter().enumerate() {
        let kok = format!("kayitlar.{i}");
        let gecersiz = |alan: String, neden: &str| GecersizKayit { sira: sayi(i), alan, neden: neden.to_string() };
        let sonuc: Result<AjandaKaydi, GecersizKayit> = AjandaKaydi::oku(v, &kok)
            .map_err(|h| gecersiz(guvenli_yol(&h.yol), h.neden))
            .and_then(|k| {
                if gorulen.contains(&k.kayit_id) {
                    return Err(gecersiz(format!("{kok}.kayit_id"), "dosyada yinelenen kayit_id"));
                }
                match dilim_sorunu(&k, &mut bilinir) {
                    Some(alan) => Err(gecersiz(format!("{kok}.{alan}"), "saat dilimi bilinmiyor")),
                    None => Ok(k),
                }
            });
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
            Sinif::Gecersiz => unreachable!(),
        }
        iz.kat(&[sinif as u8]);
        iz.kat(k.kayit_id.as_bytes());
        if let Some(y) = yazilacak {
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
