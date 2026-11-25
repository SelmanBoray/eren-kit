//! Zaman ve hatırlatma (`ajanda-zaman.ts` "Zaman", "Hatırlatma"): kablo kaydının zamanı
//! (`AjandaZamani`, dilim zorunlu), hatırlatma listesi, zaman-tekrar bağlantı kuralı ve tekilleştirme
//! anahtarının girdisi olan zaman çekirdeği.

use super::json::{Nesne, Sonuc, Yazici, dizi_oku, hata, metin, sabit_liste, tam_sayi};
use super::metin::satir_oku;
use super::sinirlar::ajanda::{DONEM_GUN, HATIRLATMA_ADET, HATIRLATMA_ONCE_DK, SURE_DK, ZAMAN_IFADESI};
use super::takvim::{gercek_tarih_mi, saat_dilimi_gecerli_mi, saat_gecerli_mi, tarih_gun_no};
use super::tekrar::Tekrar;
use serde_json::Value;

/// `Tarih`: `YYYY-MM-DD`, gerçek gün, yıl sınırı içinde.
pub fn tarih_oku(v: &Value, yol: &str) -> Sonuc<String> {
    let s = metin(v, yol)?;
    if gercek_tarih_mi(s) { Ok(s.to_string()) } else { hata(yol, "takvimde olmayan gün ya da yıl sınır dışı") }
}

/// `Saat`: `HH:MM`, 24 saat.
pub fn saat_oku(v: &Value, yol: &str) -> Sonuc<String> {
    let s = metin(v, yol)?;
    if saat_gecerli_mi(s) { Ok(s.to_string()) } else { hata(yol, "saat biçimi değil") }
}

/// `SaatDilimi`: yalnız biçim (varlığını servis denetler).
pub fn dilim_oku(v: &Value, yol: &str) -> Sonuc<String> {
    let s = metin(v, yol)?;
    if saat_dilimi_gecerli_mi(s) { Ok(s.to_string()) } else { hata(yol, "IANA dilim biçimi değil") }
}

fn ifade_oku(v: &Value, yol: &str) -> Sonuc<String> {
    satir_oku(v, yol, 1, ZAMAN_IFADESI)
}

sabit_liste! {
    ZamanKesinligi { An = "an", Gun = "gun", Donem = "donem", Belirsiz = "belirsiz" }
}

/// Kablo kaydının zamanı (`AjandaZamani`). Saat söylenmediyse `Gun`, gün aralığıysa `Donem`,
/// takvime oturmuyorsa `Belirsiz`: saat ya da gün uydurulmaz. `ifade` kullanıcının sözü, birebir.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum AjandaZamani {
    An { tarih: String, saat: String, sure_dk: Option<i32>, saat_dilimi: String, ifade: Option<String> },
    Gun { tarih: String, saat_dilimi: String, ifade: Option<String> },
    /// İki uç dahil; en çok `DONEM_GUN` gün.
    Donem { baslangic: String, bitis: String, saat_dilimi: String, ifade: Option<String> },
    Belirsiz { ifade: String },
}

impl AjandaZamani {
    pub fn kesinlik(&self) -> ZamanKesinligi {
        match self {
            AjandaZamani::An { .. } => ZamanKesinligi::An,
            AjandaZamani::Gun { .. } => ZamanKesinligi::Gun,
            AjandaZamani::Donem { .. } => ZamanKesinligi::Donem,
            AjandaZamani::Belirsiz { .. } => ZamanKesinligi::Belirsiz,
        }
    }

    /// `an` ve `gun`'ün günü (tekrarın çapası).
    pub fn tarih(&self) -> Option<&str> {
        match self {
            AjandaZamani::An { tarih, .. } | AjandaZamani::Gun { tarih, .. } => Some(tarih),
            _ => None,
        }
    }

    pub fn saat_dilimi(&self) -> Option<&str> {
        match self {
            AjandaZamani::An { saat_dilimi, .. }
            | AjandaZamani::Gun { saat_dilimi, .. }
            | AjandaZamani::Donem { saat_dilimi, .. } => Some(saat_dilimi),
            AjandaZamani::Belirsiz { .. } => None,
        }
    }

    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let kesinlik = n.zorunlu("kesinlik", ZamanKesinligi::oku)?;
        let z = match kesinlik {
            ZamanKesinligi::An => AjandaZamani::An {
                tarih: n.zorunlu("tarih", tarih_oku)?,
                saat: n.zorunlu("saat", saat_oku)?,
                sure_dk: n.istege_bagli("sure_dk", |v, y| tam_sayi(v, y, 1, SURE_DK))?.map(|s| s as i32),
                saat_dilimi: n.zorunlu("saat_dilimi", dilim_oku)?,
                ifade: n.istege_bagli("ifade", ifade_oku)?,
            },
            ZamanKesinligi::Gun => AjandaZamani::Gun {
                tarih: n.zorunlu("tarih", tarih_oku)?,
                saat_dilimi: n.zorunlu("saat_dilimi", dilim_oku)?,
                ifade: n.istege_bagli("ifade", ifade_oku)?,
            },
            ZamanKesinligi::Donem => {
                let baslangic = n.zorunlu("baslangic", tarih_oku)?;
                let bitis = n.zorunlu("bitis", tarih_oku)?;
                let yol_bitis = n.alan_yolu("bitis");
                let z = AjandaZamani::Donem {
                    baslangic,
                    bitis,
                    saat_dilimi: n.zorunlu("saat_dilimi", dilim_oku)?,
                    ifade: n.istege_bagli("ifade", ifade_oku)?,
                };
                if !donem_gecerli_mi(&z) {
                    return hata(&yol_bitis, "bitis baslangictan önce ya da dönem çok uzun");
                }
                z
            }
            ZamanKesinligi::Belirsiz => AjandaZamani::Belirsiz { ifade: n.zorunlu("ifade", ifade_oku)? },
        };
        n.bitir()?;
        Ok(z)
    }

    pub fn json(&self) -> Value {
        let y = Yazici::yeni().alan("kesinlik", self.kesinlik().json());
        match self {
            AjandaZamani::An { tarih, saat, sure_dk, saat_dilimi, ifade } => y
                .alan("tarih", tarih.as_str())
                .alan("saat", saat.as_str())
                .varsa("sure_dk", *sure_dk)
                .alan("saat_dilimi", saat_dilimi.as_str())
                .varsa("ifade", ifade.clone()),
            AjandaZamani::Gun { tarih, saat_dilimi, ifade } => {
                y.alan("tarih", tarih.as_str()).alan("saat_dilimi", saat_dilimi.as_str()).varsa("ifade", ifade.clone())
            }
            AjandaZamani::Donem { baslangic, bitis, saat_dilimi, ifade } => y
                .alan("baslangic", baslangic.as_str())
                .alan("bitis", bitis.as_str())
                .alan("saat_dilimi", saat_dilimi.as_str())
                .varsa("ifade", ifade.clone()),
            AjandaZamani::Belirsiz { ifade } => y.alan("ifade", ifade.as_str()),
        }
        .bitir()
    }

    /// `ajandaZamanOzeti`: `ifade` atılmış hal (araç çıktısı biçimi), JSON.
    pub fn ozet_json(&self) -> Value {
        let mut v = self.json();
        if let Value::Object(h) = &mut v {
            h.remove("ifade");
        }
        v
    }

    /// `zamanCekirdegi`: `ifade` ve `sure_dk` girmez; tekilleştirme anahtarının zamanı.
    pub fn cekirdek_json(&self) -> Value {
        let mut v = self.ozet_json();
        if let Value::Object(h) = &mut v {
            h.remove("sure_dk");
        }
        v
    }
}

fn donem_gecerli_mi(z: &AjandaZamani) -> bool {
    let AjandaZamani::Donem { baslangic, bitis, .. } = z else { return true };
    match (tarih_gun_no(baslangic), tarih_gun_no(bitis)) {
        (Some(b), Some(s)) => (0..DONEM_GUN).contains(&(s - b)),
        _ => true,
    }
}

/// Hatırlatma. `Once`: olayın anından `dk` önce (tekrarda her örnek için; zaman `an` değilken bekler).
/// `Mutlak`: belirli bir yerel an, bir kez.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Hatirlatma {
    Once { dk: i32 },
    Mutlak { tarih: String, saat: String, saat_dilimi: String },
}

impl Hatirlatma {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let tur = n.zorunlu("tur", metin)?;
        let h = match tur {
            "once" => Hatirlatma::Once { dk: n.zorunlu("dk", |v, y| tam_sayi(v, y, 0, HATIRLATMA_ONCE_DK))? as i32 },
            "mutlak" => Hatirlatma::Mutlak {
                tarih: n.zorunlu("tarih", tarih_oku)?,
                saat: n.zorunlu("saat", saat_oku)?,
                saat_dilimi: n.zorunlu("saat_dilimi", dilim_oku)?,
            },
            _ => return hata(&n.alan_yolu("tur"), "kapalı listede yok"),
        };
        n.bitir()?;
        Ok(h)
    }

    pub fn json(&self) -> Value {
        match self {
            Hatirlatma::Once { dk } => Yazici::yeni().alan("tur", "once").alan("dk", *dk).bitir(),
            Hatirlatma::Mutlak { tarih, saat, saat_dilimi } => Yazici::yeni()
                .alan("tur", "mutlak")
                .alan("tarih", tarih.as_str())
                .alan("saat", saat.as_str())
                .alan("saat_dilimi", saat_dilimi.as_str())
                .bitir(),
        }
    }
}

/// `Hatirlatmalar`: en çok `HATIRLATMA_ADET`, yinelenen yok.
pub fn hatirlatmalari_oku(v: &Value, yol: &str) -> Sonuc<Vec<Hatirlatma>> {
    let liste = dizi_oku(v, yol, HATIRLATMA_ADET, Hatirlatma::oku)?;
    for (i, h) in liste.iter().enumerate() {
        if liste[..i].contains(h) {
            return hata(yol, "yinelenen hatırlatma");
        }
    }
    Ok(liste)
}

pub fn hatirlatmalari_yaz(liste: &[Hatirlatma]) -> Value {
    Value::Array(liste.iter().map(Hatirlatma::json).collect())
}

/// `AJANDA_VARSAYILAN_HATIRLATMALAR`: girdide hatırlatma verilmeyen kayda (ve elle ekleme ekranına) 1 saat önce.
pub fn varsayilan_hatirlatmalar() -> Vec<Hatirlatma> {
    vec![Hatirlatma::Once { dk: 60 }]
}

/// `zamanKurallari`: tekrar `an` ya da `gun` ister ve bitişi çapadan önce olamaz.
/// Hata: (alan yolu soneki, neden).
pub fn zaman_kurallari(zaman: Option<&AjandaZamani>, tekrar: Option<&Tekrar>) -> Result<(), (&'static str, &'static str)> {
    let Some(t) = tekrar else { return Ok(()) };
    match zaman.and_then(AjandaZamani::tarih) {
        None => Err(("tekrar", "tekrar zaman kesinliği an ya da gun ister")),
        Some(capa) => match &t.bitis_tarihi {
            Some(b) if b.as_str() < capa => Err(("tekrar.bitis_tarihi", "tekrar bitişi çapadan önce")),
            _ => Ok(()),
        },
    }
}
