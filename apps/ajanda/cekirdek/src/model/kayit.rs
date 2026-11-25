//! Kayıt (`ajanda.ts` "Kayıt"): `AjandaKaydi` ve parçaları, kapalı listeler, kaynak izi kuralları.
//! Kayıt eylemsiz veridir: URL, intent, komut alanı yoktur (katı şema fazla alanı reddeder).

use super::json::{Nesne, Sonuc, Yazici, dizi_oku, dizi_yaz, hata, mantik, sabit_liste, tam_sayi};
use super::metin::{cok_satir_oku, desenli_oku, opak_id_oku, satir_oku};
use super::sinirlar::ajanda::{ACIKLAMA, ALINTI, BASLIK, ORNEK_ADET, TEKIL_ANAHTAR};
use super::takvim::gercek_tarih_mi;
use super::tekrar::{Tekrar, ornek_gunleri_mi};
use super::zaman::{AjandaZamani, Hatirlatma, hatirlatmalari_oku, hatirlatmalari_yaz, tarih_oku, zaman_kurallari};
use super::json::GUVENLI_TAM_SAYI;
use serde_json::Value;

sabit_liste! { KayitTuru { Gorev = "gorev", Randevu = "randevu", Not = "not" } }

sabit_liste! {
    /// Kaydın (tekrar ediyorsa serinin) durumu. Hatırlatma yalnız `Acik`'ta kurulur.
    KayitDurumu { Acik = "acik", Tamam = "tamam", Iptal = "iptal" }
}

sabit_liste! {
    /// Tekrar eden kaydın bir örneğinin `acik` dışındaki durumu (açık örnek satır taşımaz).
    OrnekDurumu { Tamam = "tamam", Iptal = "iptal" }
}

sabit_liste! {
    /// Kaydın doğduğu ya da değişikliğin geldiği yol.
    KaynakYolu { SohbetAraci = "sohbet_araci", PcAraci = "pc_araci", ArkaPlan = "arka_plan", SesliNot = "sesli_not", Elle = "elle" }
}

sabit_liste! {
    /// `INSAN_YOLLARI`: uygulamanın `ekle` işleminin `girdi_yolu`.
    GirdiYolu { Elle = "elle", SesliNot = "sesli_not" }
}

sabit_liste! { TurKokeni { Insan = "insan", Sentetik = "sentetik" } }

sabit_liste! {
    /// `AJANDA_ALANLARI`: alan izinin ve değişikliklerin alan kümesi; bildirim sırası kanoniktir.
    AjandaAlani { Tur = "tur", Baslik = "baslik", Aciklama = "aciklama", Zaman = "zaman", Hatirlatmalar = "hatirlatmalar", Tekrar = "tekrar", Durum = "durum" }
}

impl GirdiYolu {
    pub fn yol(self) -> KaynakYolu {
        match self {
            GirdiYolu::Elle => KaynakYolu::Elle,
            GirdiYolu::SesliNot => KaynakYolu::SesliNot,
        }
    }
}

/// `otomasyonMu`: insan yolu (`elle`, `sesli_not`) dışındaki her yol.
pub fn otomasyon_mu(yol: KaynakYolu) -> bool {
    !matches!(yol, KaynakYolu::Elle | KaynakYolu::SesliNot)
}

/// `kullaniciEmriMi`: insan yolu ya da insan turundaki asistan aracı (`ARAC_YOLLARI`).
pub fn kullanici_emri_mi(yol: KaynakYolu, tur_kokeni: TurKokeni) -> bool {
    !otomasyon_mu(yol) || (matches!(yol, KaynakYolu::SohbetAraci | KaynakYolu::PcAraci) && tur_kokeni == TurKokeni::Insan)
}

/// Değişikliği yapanın kural için gereken iki alanı.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct YazarKimligi {
    pub yol: KaynakYolu,
    pub tur_kokeni: TurKokeni,
}

/// `AlanListesi`: kanonik sırada ve tekil.
pub fn alan_listesi_oku(v: &Value, yol: &str) -> Sonuc<Vec<AjandaAlani>> {
    let l = dizi_oku(v, yol, AjandaAlani::HEPSI.len(), AjandaAlani::oku)?;
    if l.windows(2).all(|w| w[0] < w[1]) { Ok(l) } else { hata(yol, "alanlar kanonik sırada ve tekil") }
}

pub fn alan_listesi_yaz(l: &[AjandaAlani]) -> Value {
    dizi_yaz(l, |a| a.json())
}

/// `TekilAnahtar`: 1-128, `^[A-Za-z0-9:._-]+$`.
fn tekil_anahtar_oku(v: &Value, yol: &str) -> Sonuc<String> {
    desenli_oku(v, yol, 1, TEKIL_ANAHTAR, |c| c.is_ascii_alphanumeric() || matches!(c, ':' | '.' | '_' | '-'))
}

/// `ZamanMs`: güvenli tam sayı, >= 0.
pub fn zaman_ms_oku(v: &Value, yol: &str) -> Sonuc<i64> {
    tam_sayi(v, yol, 0, GUVENLI_TAM_SAYI)
}

/// `Revizyon`: >= 1.
pub fn revizyon_oku(v: &Value, yol: &str) -> Sonuc<i64> {
    tam_sayi(v, yol, 1, GUVENLI_TAM_SAYI)
}

/// `SonRevizyon`: >= 0.
pub fn son_revizyon_oku(v: &Value, yol: &str) -> Sonuc<i64> {
    tam_sayi(v, yol, 0, GUVENLI_TAM_SAYI)
}

pub fn baslik_oku(v: &Value, yol: &str) -> Sonuc<String> {
    satir_oku(v, yol, 1, BASLIK)
}

pub fn aciklama_oku(v: &Value, yol: &str) -> Sonuc<String> {
    cok_satir_oku(v, yol, ACIKLAMA)
}

/// Kaydın kaynak izi. Kayıt doğarken servis yazar, sonra değişmez. Hiçbir alanı eylem değildir.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaKaynagi {
    pub yol: KaynakYolu,
    pub tur_kokeni: TurKokeni,
    pub sohbet_id: Option<String>,
    pub oturum_id: Option<String>,
    pub kaynak_msg_id: Option<String>,
    pub device_id: Option<String>,
    pub alinti: Option<String>,
    pub tekil_anahtar: Option<String>,
}

impl AjandaKaynagi {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let k = AjandaKaynagi {
            yol: n.zorunlu("yol", KaynakYolu::oku)?,
            tur_kokeni: n.zorunlu("tur_kokeni", TurKokeni::oku)?,
            sohbet_id: n.istege_bagli("sohbet_id", opak_id_oku)?,
            oturum_id: n.istege_bagli("oturum_id", opak_id_oku)?,
            kaynak_msg_id: n.istege_bagli("kaynak_msg_id", opak_id_oku)?,
            device_id: n.istege_bagli("device_id", opak_id_oku)?,
            alinti: n.istege_bagli("alinti", |v, y| satir_oku(v, y, 1, ALINTI))?,
            tekil_anahtar: n.istege_bagli("tekil_anahtar", tekil_anahtar_oku)?,
        };
        n.bitir()?;
        if let Err((alan, neden)) = k.kurallar() {
            return hata(&super::json::alt_yol(yol, alan), neden);
        }
        Ok(k)
    }

    /// `AjandaKaynagi.superRefine`.
    pub fn kurallar(&self) -> Result<(), (&'static str, &'static str)> {
        if !otomasyon_mu(self.yol) {
            if self.device_id.is_none() {
                return Err(("device_id", "insan yolunda device_id zorunlu"));
            }
            if self.tur_kokeni != TurKokeni::Insan {
                return Err(("tur_kokeni", "insan yolu insan kökenlidir"));
            }
            if self.sohbet_id.is_some() || self.oturum_id.is_some() || self.kaynak_msg_id.is_some() {
                return Err(("yol", "insan yolunda sohbet ve oturum alanı yok"));
            }
        } else if self.device_id.is_some() {
            return Err(("device_id", "device_id yalnız insan yolunda"));
        }
        match self.yol {
            KaynakYolu::SohbetAraci if self.sohbet_id.is_none() => return Err(("sohbet_id", "sohbet_araci sohbet_id ister")),
            KaynakYolu::PcAraci if self.oturum_id.is_none() => return Err(("oturum_id", "pc_araci oturum_id ister")),
            KaynakYolu::ArkaPlan if self.sohbet_id.is_none() && self.oturum_id.is_none() => {
                return Err(("yol", "arka_plan sohbet_id ya da oturum_id ister"));
            }
            _ => {}
        }
        if self.kaynak_msg_id.is_some() && self.tur_kokeni != TurKokeni::Insan {
            return Err(("kaynak_msg_id", "kaynak_msg_id yalnız insan turunda"));
        }
        Ok(())
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .alan("yol", self.yol.json())
            .alan("tur_kokeni", self.tur_kokeni.json())
            .varsa("sohbet_id", self.sohbet_id.clone())
            .varsa("oturum_id", self.oturum_id.clone())
            .varsa("kaynak_msg_id", self.kaynak_msg_id.clone())
            .varsa("device_id", self.device_id.clone())
            .varsa("alinti", self.alinti.clone())
            .varsa("tekil_anahtar", self.tekil_anahtar.clone())
            .bitir()
    }
}

/// Bir değişikliği yapan (geçmişte): kaynak izinin değişiklik başına hali. Ek kural yoktur.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaYazar {
    pub yol: KaynakYolu,
    pub tur_kokeni: TurKokeni,
    pub device_id: Option<String>,
    pub sohbet_id: Option<String>,
    pub oturum_id: Option<String>,
}

impl AjandaYazar {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let y = AjandaYazar {
            yol: n.zorunlu("yol", KaynakYolu::oku)?,
            tur_kokeni: n.zorunlu("tur_kokeni", TurKokeni::oku)?,
            device_id: n.istege_bagli("device_id", opak_id_oku)?,
            sohbet_id: n.istege_bagli("sohbet_id", opak_id_oku)?,
            oturum_id: n.istege_bagli("oturum_id", opak_id_oku)?,
        };
        n.bitir()?;
        Ok(y)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .alan("yol", self.yol.json())
            .alan("tur_kokeni", self.tur_kokeni.json())
            .varsa("device_id", self.device_id.clone())
            .varsa("sohbet_id", self.sohbet_id.clone())
            .varsa("oturum_id", self.oturum_id.clone())
            .bitir()
    }

    pub fn kimlik(&self) -> YazarKimligi {
        YazarKimligi { yol: self.yol, tur_kokeni: self.tur_kokeni }
    }
}

/// Tekrar eden kaydın bir örneğinin kapalı durumu.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaOrnegi {
    pub tarih: String,
    pub durum: OrnekDurumu,
}

impl AjandaOrnegi {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let o = AjandaOrnegi { tarih: n.zorunlu("tarih", tarih_oku)?, durum: n.zorunlu("durum", OrnekDurumu::oku)? };
        n.bitir()?;
        Ok(o)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni().alan("tarih", self.tarih.as_str()).alan("durum", self.durum.json()).bitir()
    }
}

pub fn ornekleri_oku(v: &Value, yol: &str) -> Sonuc<Vec<AjandaOrnegi>> {
    dizi_oku(v, yol, ORNEK_ADET, AjandaOrnegi::oku)
}

pub fn ornekleri_yaz(l: &[AjandaOrnegi]) -> Value {
    dizi_yaz(l, AjandaOrnegi::json)
}

/// Kaydın PC'deki güncel hali; `kayit` çerçevesi bunu taşır.
/// - `taslak`: insan kökenli olmayan turda doğdu; `onayla`nana kadar hatırlatma kurulmaz.
/// - `silindi`: mezar taşı; içerik `geri_yukle` için durur.
/// - `elle_alanlar`: kullanıcının emriyle değişen alanlar (kanonik sırada).
/// - `guncelleme_ms`: güncel revizyonu yazan geçmiş satırının zamanı (telafi izi buna dayanır).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaKaydi {
    pub kayit_id: String,
    pub revizyon: i64,
    pub tur: KayitTuru,
    pub baslik: String,
    pub aciklama: Option<String>,
    pub zaman: Option<AjandaZamani>,
    pub hatirlatmalar: Vec<Hatirlatma>,
    pub tekrar: Option<Tekrar>,
    pub ornekler: Vec<AjandaOrnegi>,
    pub durum: KayitDurumu,
    pub taslak: bool,
    pub silindi: bool,
    pub elle_alanlar: Vec<AjandaAlani>,
    pub kaynak: AjandaKaynagi,
    pub olusturma_ms: i64,
    pub guncelleme_ms: i64,
}

impl AjandaKaydi {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let k = AjandaKaydi {
            kayit_id: n.zorunlu("kayit_id", opak_id_oku)?,
            revizyon: n.zorunlu("revizyon", revizyon_oku)?,
            tur: n.zorunlu("tur", KayitTuru::oku)?,
            baslik: n.zorunlu("baslik", baslik_oku)?,
            aciklama: n.istege_bagli("aciklama", aciklama_oku)?,
            zaman: n.istege_bagli("zaman", AjandaZamani::oku)?,
            hatirlatmalar: n.zorunlu("hatirlatmalar", hatirlatmalari_oku)?,
            tekrar: n.istege_bagli("tekrar", Tekrar::oku)?,
            ornekler: n.zorunlu("ornekler", ornekleri_oku)?,
            durum: n.zorunlu("durum", KayitDurumu::oku)?,
            taslak: n.zorunlu("taslak", mantik)?,
            silindi: n.zorunlu("silindi", mantik)?,
            elle_alanlar: n.zorunlu("elle_alanlar", alan_listesi_oku)?,
            kaynak: n.zorunlu("kaynak", AjandaKaynagi::oku)?,
            olusturma_ms: n.zorunlu("olusturma_ms", zaman_ms_oku)?,
            guncelleme_ms: n.zorunlu("guncelleme_ms", zaman_ms_oku)?,
        };
        n.bitir()?;
        if let Err((alan, neden)) = k.kurallar() {
            return hata(&super::json::alt_yol(yol, alan), neden);
        }
        Ok(k)
    }

    /// `AjandaKaydi.superRefine` (alan şemaları geçtikten sonra). Birleştirme sonucu da bununla
    /// doğrulanır (`tutarsiz_kayit`), ama alan şemaları da gerekiyorsa `gecerli_mi` kullan.
    pub fn kurallar(&self) -> Result<(), (&'static str, &'static str)> {
        zaman_kurallari(self.zaman.as_ref(), self.tekrar.as_ref())?;
        if !self.ornekler.is_empty() {
            let Some(t) = &self.tekrar else { return Err(("ornekler", "ornekler yalnız tekrar eden kayıtta")) };
            if !self.ornekler.windows(2).all(|w| w[0].tarih < w[1].tarih) {
                return Err(("ornekler", "ornekler tarih sırasıyla ve tekil"));
            }
            if let Some(capa) = self.zaman.as_ref().and_then(AjandaZamani::tarih) {
                if self.ornekler[0].tarih.as_str() < capa {
                    return Err(("ornekler", "örnek çapadan önce"));
                }
                let tarihler: Vec<&str> = self.ornekler.iter().map(|o| o.tarih.as_str()).collect();
                if gercek_tarih_mi(capa) && tarihler.iter().all(|t| gercek_tarih_mi(t)) && !ornek_gunleri_mi(capa, t, &tarihler)
                {
                    return Err(("ornekler", "örnek serinin günü değil"));
                }
            }
        }
        if self.guncelleme_ms < self.olusturma_ms {
            return Err(("guncelleme_ms", "güncelleme oluşturmadan önce"));
        }
        Ok(())
    }

    /// Tam şema denetimi (alanlar + kurallar): JSON'a yazıp yeniden okur. Birleştirme ve iyimser
    /// uygulama sonucunu doğrulamak için (`tutarsiz_kayit`).
    pub fn gecerli_mi(&self) -> Result<(), super::json::SemaHatasi> {
        AjandaKaydi::oku(&self.json(), "").map(|_| ())
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .alan("kayit_id", self.kayit_id.as_str())
            .alan("revizyon", self.revizyon)
            .alan("tur", self.tur.json())
            .alan("baslik", self.baslik.as_str())
            .varsa("aciklama", self.aciklama.clone())
            .varsa("zaman", self.zaman.as_ref().map(AjandaZamani::json))
            .alan("hatirlatmalar", hatirlatmalari_yaz(&self.hatirlatmalar))
            .varsa("tekrar", self.tekrar.as_ref().map(Tekrar::json))
            .alan("ornekler", ornekleri_yaz(&self.ornekler))
            .alan("durum", self.durum.json())
            .alan("taslak", self.taslak)
            .alan("silindi", self.silindi)
            .alan("elle_alanlar", alan_listesi_yaz(&self.elle_alanlar))
            .alan("kaynak", self.kaynak.json())
            .alan("olusturma_ms", self.olusturma_ms)
            .alan("guncelleme_ms", self.guncelleme_ms)
            .bitir()
    }
}

/// `hatirlatmaEtkinMi`: telefon hatırlatmayı yalnız buna göre kurar.
pub fn hatirlatma_etkin_mi(taslak: bool, silindi: bool, durum: KayitDurumu) -> bool {
    !taslak && !silindi && durum == KayitDurumu::Acik
}

impl AjandaKaydi {
    pub fn hatirlatma_etkin_mi(&self) -> bool {
        hatirlatma_etkin_mi(self.taslak, self.silindi, self.durum)
    }
}
