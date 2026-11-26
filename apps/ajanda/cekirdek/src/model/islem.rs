//! İşlemler, değişiklik ve geçmiş (`ajanda.ts` "İşlemler", "Geçmiş", "Hata ve ret").

use super::json::{Alan, Nesne, Sonuc, Yazici, hata, mantik, sabit_liste};
use super::kayit::{
    AjandaAlani, AjandaOrnegi, AjandaYazar, GirdiYolu, KayitDurumu, KayitTuru, OrnekDurumu, aciklama_oku,
    alan_listesi_oku, alan_listesi_yaz, baslik_oku, ornekleri_oku, ornekleri_yaz, revizyon_oku, zaman_ms_oku,
};
use super::metin::opak_id_oku;
use super::tekrar::Tekrar;
use super::zaman::{AjandaZamani, Hatirlatma, hatirlatmalari_oku, hatirlatmalari_yaz, tarih_oku, zaman_kurallari};
use serde_json::Value;

sabit_liste! {
    /// `AJANDA_KANAL_HATALARI`: `/ajanda` `error` ve `pair_result.code` kümesi.
    AjandaKanalHatasi {
        ProtokolUyumsuz = "protokol_uyumsuz",
        GecersizMesaj = "gecersiz_mesaj",
        MesajCokBuyuk = "mesaj_cok_buyuk",
        ZamanAsimi = "zaman_asimi",
        IcHata = "ic_hata",
        Yetkisiz = "yetkisiz",
        ImzaGecersiz = "imza_gecersiz",
        IpUyusmuyor = "ip_uyusmuyor",
        CihazBilinmiyor = "cihaz_bilinmiyor",
        KanalDesteklenmiyor = "kanal_desteklenmiyor",
        EslestirmeKapali = "eslestirme_kapali",
        EslestirmeKoduGecersiz = "eslestirme_kodu_gecersiz",
    }
}

sabit_liste! {
    /// `AJANDA_RET_NEDENLERI`: bir işlemin kapalı ret listesi. Yalnız `IcHata` geçicidir.
    AjandaRetNedeni {
        KayitBulunamadi = "kayit_bulunamadi",
        KayitSilinmis = "kayit_silinmis",
        KimlikCakisiyor = "kimlik_cakisiyor",
        TutarsizKayit = "tutarsiz_kayit",
        SaatDilimiBilinmiyor = "saat_dilimi_bilinmiyor",
        OrnekGecersiz = "ornek_gecersiz",
        KayitSiniri = "kayit_siniri",
        SentetikTurdaIzinsiz = "sentetik_turda_izinsiz",
        DayanakUyusmuyor = "dayanak_uyusmuyor",
        /// v2: yalnız araç yolunda (gece aralığında teyitsiz takvime bağlı çağrı); kabloda gelmez ama çözülür.
        GeceTeyidiGerekli = "gece_teyidi_gerekli",
        GecersizIslem = "gecersiz_islem",
        IcHata = "ic_hata",
    }
}

sabit_liste! {
    /// `AJANDA_KUYRUK_RET_NEDENLERI`: uygulamanın ret listesindeki nedenler (servis retleri ve
    /// deneme sınırında `teslim_edilemedi`). Yerel addır, kabloda yoktur.
    KuyrukRetNedeni {
        KayitBulunamadi = "kayit_bulunamadi",
        KayitSilinmis = "kayit_silinmis",
        KimlikCakisiyor = "kimlik_cakisiyor",
        TutarsizKayit = "tutarsiz_kayit",
        SaatDilimiBilinmiyor = "saat_dilimi_bilinmiyor",
        OrnekGecersiz = "ornek_gecersiz",
        KayitSiniri = "kayit_siniri",
        SentetikTurdaIzinsiz = "sentetik_turda_izinsiz",
        DayanakUyusmuyor = "dayanak_uyusmuyor",
        /// v2: yalnız araç yolunda (gece aralığında teyitsiz takvime bağlı çağrı); kabloda gelmez ama çözülür.
        GeceTeyidiGerekli = "gece_teyidi_gerekli",
        GecersizIslem = "gecersiz_islem",
        IcHata = "ic_hata",
        TeslimEdilemedi = "teslim_edilemedi",
    }
}

impl AjandaRetNedeni {
    /// `ajandaRetGeciciMi`.
    pub fn gecici_mi(self) -> bool {
        self == AjandaRetNedeni::IcHata
    }
}

impl From<AjandaRetNedeni> for KuyrukRetNedeni {
    fn from(n: AjandaRetNedeni) -> Self {
        KuyrukRetNedeni::coz(n.ad()).expect("kuyruk ret listesi servis retlerinin üst kümesi")
    }
}

sabit_liste! {
    /// `AJANDA_ISLEMLERI`.
    IslemTuru { Ekle = "ekle", Guncelle = "guncelle", Durum = "durum", Onayla = "onayla", Sil = "sil", GeriYukle = "geri_yukle" }
}

/// Kaydın içerik alanları (`GOVDE_ALANLARI`): `ekle` işleminin gövdesi, elle ekleme/düzenleme formu.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct KayitGovdesi {
    pub tur: KayitTuru,
    pub baslik: String,
    pub aciklama: Option<String>,
    pub zaman: Option<AjandaZamani>,
    pub hatirlatmalar: Vec<Hatirlatma>,
    pub tekrar: Option<Tekrar>,
}

impl KayitGovdesi {
    /// Gövde alanlarını açık bir nesneden okur (`bitir` çağıranındır).
    pub fn alanlari_oku(n: &mut Nesne<'_>) -> Sonuc<Self> {
        Ok(KayitGovdesi {
            tur: n.zorunlu("tur", KayitTuru::oku)?,
            baslik: n.zorunlu("baslik", baslik_oku)?,
            aciklama: n.istege_bagli("aciklama", aciklama_oku)?,
            zaman: n.istege_bagli("zaman", AjandaZamani::oku)?,
            hatirlatmalar: n.zorunlu("hatirlatmalar", hatirlatmalari_oku)?,
            tekrar: n.istege_bagli("tekrar", Tekrar::oku)?,
        })
    }

    pub fn alanlari_yaz(&self, y: Yazici) -> Yazici {
        y.alan("tur", self.tur.json())
            .alan("baslik", self.baslik.as_str())
            .varsa("aciklama", self.aciklama.clone())
            .varsa("zaman", self.zaman.as_ref().map(AjandaZamani::json))
            .alan("hatirlatmalar", hatirlatmalari_yaz(&self.hatirlatmalar))
            .varsa("tekrar", self.tekrar.as_ref().map(Tekrar::json))
    }

    /// Gövdenin kablo şemasından geçip geçmediği (alanlar ve `zamanKurallari`). Hata: alan yolu, neden.
    pub fn dogrula(&self) -> Result<(), super::json::SemaHatasi> {
        let v = self.alanlari_yaz(Yazici::yeni()).bitir();
        let mut n = Nesne::ac(&v, "")?;
        let g = KayitGovdesi::alanlari_oku(&mut n)?;
        n.bitir()?;
        zaman_kurallari(g.zaman.as_ref(), g.tekrar.as_ref()).or_else(|(alan, neden)| hata(alan, neden))
    }
}

/// Kısmi değişiklik (`AjandaDegisiklik`): verilmeyen alan değişmez, `Alan::Kaldir` alanı kaldırır.
/// Durum ayrı işlemdir. Boş olamaz.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AjandaDegisiklik {
    pub tur: Option<KayitTuru>,
    pub baslik: Option<String>,
    pub aciklama: Alan<String>,
    pub zaman: Alan<AjandaZamani>,
    pub hatirlatmalar: Option<Vec<Hatirlatma>>,
    pub tekrar: Alan<Tekrar>,
}

impl AjandaDegisiklik {
    pub fn bos_mu(&self) -> bool {
        self.tur.is_none()
            && self.baslik.is_none()
            && self.aciklama.yok_mu()
            && self.zaman.yok_mu()
            && self.hatirlatmalar.is_none()
            && self.tekrar.yok_mu()
    }

    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let d = AjandaDegisiklik {
            tur: n.istege_bagli("tur", KayitTuru::oku)?,
            baslik: n.istege_bagli("baslik", baslik_oku)?,
            aciklama: n.null_olabilir("aciklama", aciklama_oku)?,
            zaman: n.null_olabilir("zaman", AjandaZamani::oku)?,
            hatirlatmalar: n.istege_bagli("hatirlatmalar", hatirlatmalari_oku)?,
            tekrar: n.null_olabilir("tekrar", Tekrar::oku)?,
        };
        n.bitir()?;
        if d.bos_mu() {
            return hata(yol, "boş değişiklik");
        }
        Ok(d)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .varsa("tur", self.tur.map(KayitTuru::json))
            .varsa("baslik", self.baslik.clone())
            .uclu("aciklama", &self.aciklama, |a| Value::String(a.clone()))
            .uclu("zaman", &self.zaman, AjandaZamani::json)
            .varsa("hatirlatmalar", self.hatirlatmalar.as_deref().map(hatirlatmalari_yaz))
            .uclu("tekrar", &self.tekrar, Tekrar::json)
            .bitir()
    }
}

/// `AjandaAlanDegisikligi`: birleştirme girdisi (kablo değişikliği ve araç değişikliğinin üst kümesi:
/// `durum` da taşır). `ajandaDegisikligiUygula` bunu alır.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AlanDegisikligi {
    pub tur: Option<KayitTuru>,
    pub baslik: Option<String>,
    pub aciklama: Alan<String>,
    pub zaman: Alan<AjandaZamani>,
    pub hatirlatmalar: Option<Vec<Hatirlatma>>,
    pub tekrar: Alan<Tekrar>,
    pub durum: Option<KayitDurumu>,
}

impl From<AjandaDegisiklik> for AlanDegisikligi {
    fn from(d: AjandaDegisiklik) -> Self {
        AlanDegisikligi {
            tur: d.tur,
            baslik: d.baslik,
            aciklama: d.aciklama,
            zaman: d.zaman,
            hatirlatmalar: d.hatirlatmalar,
            tekrar: d.tekrar,
            durum: None,
        }
    }
}

impl AlanDegisikligi {
    pub fn bos_mu(&self) -> bool {
        self.tur.is_none()
            && self.baslik.is_none()
            && self.aciklama.yok_mu()
            && self.zaman.yok_mu()
            && self.hatirlatmalar.is_none()
            && self.tekrar.yok_mu()
            && self.durum.is_none()
    }

    /// Vektörlerdeki biçim (araç değişikliği gibi; `null` kaldırır). Kablo şemasından gevşektir:
    /// metin kuralları değil yalnız tipler denetlenir, çünkü vektör girdisi kuralı sınar.
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let d = AlanDegisikligi {
            tur: n.istege_bagli("tur", KayitTuru::oku)?,
            baslik: n.istege_bagli("baslik", |v, y| super::json::metin(v, y).map(str::to_string))?,
            aciklama: n.null_olabilir("aciklama", |v, y| super::json::metin(v, y).map(str::to_string))?,
            zaman: n.null_olabilir("zaman", AjandaZamani::oku)?,
            hatirlatmalar: n.istege_bagli("hatirlatmalar", hatirlatmalari_oku)?,
            tekrar: n.null_olabilir("tekrar", Tekrar::oku)?,
            durum: n.istege_bagli("durum", KayitDurumu::oku)?,
        };
        n.bitir()?;
        Ok(d)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .varsa("tur", self.tur.map(KayitTuru::json))
            .varsa("baslik", self.baslik.clone())
            .uclu("aciklama", &self.aciklama, |a| Value::String(a.clone()))
            .uclu("zaman", &self.zaman, AjandaZamani::json)
            .varsa("hatirlatmalar", self.hatirlatmalar.as_deref().map(hatirlatmalari_yaz))
            .uclu("tekrar", &self.tekrar, Tekrar::json)
            .varsa("durum", self.durum.map(KayitDurumu::json))
            .bitir()
    }
}

/// Uygulamanın yolladığı işlem (`AjandaIslem`). Hepsi `islem_id` ile idempotenttir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AjandaIslem {
    /// Kimliği uygulama üretir (çevrimdışı kuyrukta bekleyebilsin).
    Ekle { kayit_id: String, govde: KayitGovdesi, girdi_yolu: GirdiYolu },
    /// `temel_revizyon`: kullanıcının düzenlediği hal (bilgi içindir, reddetmez).
    Guncelle { kayit_id: String, temel_revizyon: i64, degisiklik: AjandaDegisiklik },
    /// `ornek_tarihi` verilirse yalnız o örnek; yoksa kaydın kendisi.
    Durum { kayit_id: String, durum: KayitDurumu, ornek_tarihi: Option<String> },
    Onayla { kayit_id: String },
    Sil { kayit_id: String },
    GeriYukle { kayit_id: String },
}

impl AjandaIslem {
    pub fn tur(&self) -> IslemTuru {
        match self {
            AjandaIslem::Ekle { .. } => IslemTuru::Ekle,
            AjandaIslem::Guncelle { .. } => IslemTuru::Guncelle,
            AjandaIslem::Durum { .. } => IslemTuru::Durum,
            AjandaIslem::Onayla { .. } => IslemTuru::Onayla,
            AjandaIslem::Sil { .. } => IslemTuru::Sil,
            AjandaIslem::GeriYukle { .. } => IslemTuru::GeriYukle,
        }
    }

    pub fn kayit_id(&self) -> &str {
        match self {
            AjandaIslem::Ekle { kayit_id, .. }
            | AjandaIslem::Guncelle { kayit_id, .. }
            | AjandaIslem::Durum { kayit_id, .. }
            | AjandaIslem::Onayla { kayit_id }
            | AjandaIslem::Sil { kayit_id }
            | AjandaIslem::GeriYukle { kayit_id } => kayit_id,
        }
    }

    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let tur = n.zorunlu("islem", IslemTuru::oku)?;
        let kayit_id = n.zorunlu("kayit_id", opak_id_oku)?;
        let islem = match tur {
            IslemTuru::Ekle => {
                let govde = KayitGovdesi::alanlari_oku(&mut n)?;
                let girdi_yolu = n.zorunlu("girdi_yolu", GirdiYolu::oku)?;
                if let Err((alan, neden)) = zaman_kurallari(govde.zaman.as_ref(), govde.tekrar.as_ref()) {
                    return hata(&n.alan_yolu(alan), neden);
                }
                AjandaIslem::Ekle { kayit_id, govde, girdi_yolu }
            }
            IslemTuru::Guncelle => AjandaIslem::Guncelle {
                kayit_id,
                temel_revizyon: n.zorunlu("temel_revizyon", revizyon_oku)?,
                degisiklik: n.zorunlu("degisiklik", AjandaDegisiklik::oku)?,
            },
            IslemTuru::Durum => AjandaIslem::Durum {
                kayit_id,
                durum: n.zorunlu("durum", KayitDurumu::oku)?,
                ornek_tarihi: n.istege_bagli("ornek_tarihi", tarih_oku)?,
            },
            IslemTuru::Onayla => AjandaIslem::Onayla { kayit_id },
            IslemTuru::Sil => AjandaIslem::Sil { kayit_id },
            IslemTuru::GeriYukle => AjandaIslem::GeriYukle { kayit_id },
        };
        n.bitir()?;
        Ok(islem)
    }

    pub fn json(&self) -> Value {
        let y = Yazici::yeni().alan("islem", self.tur().json()).alan("kayit_id", self.kayit_id());
        match self {
            AjandaIslem::Ekle { govde, girdi_yolu, .. } => govde.alanlari_yaz(y).alan("girdi_yolu", girdi_yolu.json()),
            AjandaIslem::Guncelle { temel_revizyon, degisiklik, .. } => {
                y.alan("temel_revizyon", *temel_revizyon).alan("degisiklik", degisiklik.json())
            }
            AjandaIslem::Durum { durum, ornek_tarihi, .. } => {
                y.alan("durum", durum.json()).varsa("ornek_tarihi", ornek_tarihi.clone())
            }
            AjandaIslem::Onayla { .. } | AjandaIslem::Sil { .. } | AjandaIslem::GeriYukle { .. } => y,
        }
        .bitir()
    }
}

/// Değişikliğin öncesi ya da sonrası (`AjandaParca`): yalnız değişen alanlar.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AjandaParca {
    pub tur: Option<KayitTuru>,
    pub baslik: Option<String>,
    pub aciklama: Alan<String>,
    pub zaman: Alan<AjandaZamani>,
    pub hatirlatmalar: Option<Vec<Hatirlatma>>,
    pub tekrar: Alan<Tekrar>,
    pub durum: Option<KayitDurumu>,
    pub taslak: Option<bool>,
    pub silindi: Option<bool>,
    /// Yalnız `ornek_tarihi`'li girdide: o örneğin durumu, `Kaldir` açık.
    pub ornek_durumu: Alan<OrnekDurumu>,
    /// Budanan ya da atılan örnek satırları: tam liste.
    pub ornekler: Option<Vec<AjandaOrnegi>>,
}

impl AjandaParca {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let p = AjandaParca {
            tur: n.istege_bagli("tur", KayitTuru::oku)?,
            baslik: n.istege_bagli("baslik", baslik_oku)?,
            aciklama: n.null_olabilir("aciklama", aciklama_oku)?,
            zaman: n.null_olabilir("zaman", AjandaZamani::oku)?,
            hatirlatmalar: n.istege_bagli("hatirlatmalar", hatirlatmalari_oku)?,
            tekrar: n.null_olabilir("tekrar", Tekrar::oku)?,
            durum: n.istege_bagli("durum", KayitDurumu::oku)?,
            taslak: n.istege_bagli("taslak", mantik)?,
            silindi: n.istege_bagli("silindi", mantik)?,
            ornek_durumu: n.null_olabilir("ornek_durumu", OrnekDurumu::oku)?,
            ornekler: n.istege_bagli("ornekler", ornekleri_oku)?,
        };
        n.bitir()?;
        Ok(p)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .varsa("tur", self.tur.map(KayitTuru::json))
            .varsa("baslik", self.baslik.clone())
            .uclu("aciklama", &self.aciklama, |a| Value::String(a.clone()))
            .uclu("zaman", &self.zaman, AjandaZamani::json)
            .varsa("hatirlatmalar", self.hatirlatmalar.as_deref().map(hatirlatmalari_yaz))
            .uclu("tekrar", &self.tekrar, Tekrar::json)
            .varsa("durum", self.durum.map(KayitDurumu::json))
            .varsa("taslak", self.taslak)
            .varsa("silindi", self.silindi)
            .uclu("ornek_durumu", &self.ornek_durumu, |d| d.json())
            .varsa("ornekler", self.ornekler.as_deref().map(ornekleri_yaz))
            .bitir()
    }
}

/// Bir kaydın geçmiş satırı.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AjandaGecmisGirdisi {
    pub rev: i64,
    pub ts_ms: i64,
    pub islem: IslemTuru,
    pub yazar: AjandaYazar,
    pub temel_revizyon: Option<i64>,
    pub korunan_alanlar: Option<Vec<AjandaAlani>>,
    pub ornek_tarihi: Option<String>,
    pub onceki: AjandaParca,
    pub sonraki: AjandaParca,
}

impl AjandaGecmisGirdisi {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let g = AjandaGecmisGirdisi {
            rev: n.zorunlu("rev", revizyon_oku)?,
            ts_ms: n.zorunlu("ts_ms", zaman_ms_oku)?,
            islem: n.zorunlu("islem", IslemTuru::oku)?,
            yazar: n.zorunlu("yazar", AjandaYazar::oku)?,
            temel_revizyon: n.istege_bagli("temel_revizyon", revizyon_oku)?,
            korunan_alanlar: n.istege_bagli("korunan_alanlar", alan_listesi_oku)?,
            ornek_tarihi: n.istege_bagli("ornek_tarihi", tarih_oku)?,
            onceki: n.zorunlu("onceki", AjandaParca::oku)?,
            sonraki: n.zorunlu("sonraki", AjandaParca::oku)?,
        };
        n.bitir()?;
        Ok(g)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .alan("rev", self.rev)
            .alan("ts_ms", self.ts_ms)
            .alan("islem", self.islem.json())
            .alan("yazar", self.yazar.json())
            .varsa("temel_revizyon", self.temel_revizyon)
            .varsa("korunan_alanlar", self.korunan_alanlar.as_deref().map(alan_listesi_yaz))
            .varsa("ornek_tarihi", self.ornek_tarihi.clone())
            .alan("onceki", self.onceki.json())
            .alan("sonraki", self.sonraki.json())
            .bitir()
    }
}
