//! SAHİBİ: R4. İyimser uygulama ve görünen kopyanın hesabı.
//!
//! Görünen kopya bir türetmedir: kaydın görünen hali = sunucu kopyasındaki hali + kuyruktaki işlemlerinin
//! (onaylanmışlar dahil) sırayla iyimser uygulanması. Bu yüzden ret, kopma, tam telafi ya da yeni `kayit`
//! sonrası doğru hal tek yoldan bulunur: kaydı yeniden hesapla (`gorunen_yenile`). "Geri alma" ayrı bir
//! kod yolu değildir; reddedilen işlem kuyruktan çıkınca hesap onu artık içermez.
//!
//! İyimser uygulama servisin `islemCalistir`'inin tahminidir (aynı kurallar: `ajandaDegisikligiUygula`,
//! `ajandaOrnekDurumuUygula`; yazar `{yol: elle | girdi_yolu, tur_kokeni: insan}`). Servisin reddedeceği
//! işlem (silinmiş kayda değişiklik, olmayan kayıt, geçersiz sonuç) görünen hali değiştirmez; gerçek karar
//! servisindir ve `islem_sonucu` ile gelir. Revizyon değişmez (gerçeği `kayit` getirir); `guncelleme_ms`
//! servisin `degisiklikAni` kuralıyla ilerler.

use crate::depo::Depo;
use crate::hata::CekirdekHatasi;
use crate::kural::AnCevirici;
use crate::kural::birlesim::ajanda_degisikligi_uygula;
use crate::kural::ornek::{OrnekDurumuSonucu, ajanda_ornek_durumu_uygula};
use crate::model::{
    AjandaAlani, AjandaIslem, AjandaRetNedeni, AjandaKaydi, AjandaKaynagi, AjandaZamani, AlanDegisikligi, KayitDurumu, KayitGovdesi,
    KaynakYolu, TurKokeni, YazarKimligi,
};

/// İyimser uygulamanın dış bilgisi.
pub(crate) struct IyimserBaglam<'a> {
    /// İnsan yolunun `kaynak.device_id`'si (eşleşme yoksa yer tutucu: gerçeğini servis yazar).
    pub device_id: String,
    pub simdi_ms: i64,
    /// Zamansız kaydın günü için (servis: kullanıcının dilimi).
    pub cihaz_dilimi: String,
    pub cevirici: &'a dyn AnCevirici,
}

impl IyimserBaglam<'_> {
    /// `bugun`: kaydın dilimindeki yerel gün (`ajandaOrnekDurumuUygula`).
    fn bugun(&self, k: &AjandaKaydi) -> Option<String> {
        let dilim = match &k.zaman {
            Some(AjandaZamani::An { saat_dilimi, .. })
            | Some(AjandaZamani::Gun { saat_dilimi, .. })
            | Some(AjandaZamani::Donem { saat_dilimi, .. }) => saat_dilimi.as_str(),
            _ => self.cihaz_dilimi.as_str(),
        };
        self.cevirici.yerele_cevir(self.simdi_ms, dilim).ok().map(|y| y.tarih)
    }
}

/// Eşleşme yokken iyimser `ekle`'nin `device_id` yer tutucusu (geçerli opak kimlik).
pub(crate) const YER_TUTUCU_CIHAZ: &str = "yerel";

pub(crate) fn islem_coz(json: &str) -> Option<AjandaIslem> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    AjandaIslem::oku(&v, "").ok()
}

/// Kaydın gövde alanları (düzeltme formu, fark).
pub(crate) fn kayittan_govde(k: &AjandaKaydi) -> KayitGovdesi {
    KayitGovdesi {
        tur: k.tur,
        baslik: k.baslik.clone(),
        aciklama: k.aciklama.clone(),
        zaman: k.zaman.clone(),
        hatirlatmalar: k.hatirlatmalar.clone(),
        tekrar: k.tekrar.clone(),
    }
}

/// Uygulamadan gelen değişikliğin yazarı (servis: `ekle`'de `girdi_yolu`, ötekilerde `elle`).
pub(crate) fn yazar(islem: &AjandaIslem) -> YazarKimligi {
    let yol = match islem {
        AjandaIslem::Ekle { girdi_yolu, .. } => girdi_yolu.yol(),
        _ => KaynakYolu::Elle,
    };
    YazarKimligi { yol, tur_kokeni: TurKokeni::Insan }
}

/// Servisin elle eklemede kurduğu kayıt (revizyon 1; `elle_alanlar` verilen alanlar, `durum` hariç).
fn eklenen_kayit(kayit_id: &str, govde: &KayitGovdesi, yol: KaynakYolu, ts: i64, b: &IyimserBaglam) -> AjandaKaydi {
    let mut elle_alanlar = vec![AjandaAlani::Tur, AjandaAlani::Baslik];
    if govde.aciklama.is_some() {
        elle_alanlar.push(AjandaAlani::Aciklama);
    }
    if govde.zaman.is_some() {
        elle_alanlar.push(AjandaAlani::Zaman);
    }
    elle_alanlar.push(AjandaAlani::Hatirlatmalar);
    if govde.tekrar.is_some() {
        elle_alanlar.push(AjandaAlani::Tekrar);
    }
    AjandaKaydi {
        kayit_id: kayit_id.to_string(),
        revizyon: 1,
        tur: govde.tur,
        baslik: govde.baslik.clone(),
        aciklama: govde.aciklama.clone(),
        zaman: govde.zaman.clone(),
        hatirlatmalar: govde.hatirlatmalar.clone(),
        tekrar: govde.tekrar.clone(),
        ornekler: vec![],
        durum: KayitDurumu::Acik,
        taslak: false,
        silindi: false,
        elle_alanlar,
        kaynak: AjandaKaynagi {
            yol,
            tur_kokeni: TurKokeni::Insan,
            sohbet_id: None,
            oturum_id: None,
            kaynak_msg_id: None,
            device_id: Some(b.device_id.clone()),
            alinti: None,
            tekil_anahtar: None,
        },
        olusturma_ms: ts,
        guncelleme_ms: ts,
        v3: Default::default(),
    }
}

/// Bir işlemin servis kurallarıyla (`islemCalistir`) sonucu: yeni hal, yan etkisiz (servis `ok`, revizyon
/// vermez) ya da ret (servisin nedeni). İyimser uygulama (`iyimser_uygula`) ve yerel kipin yazarı
/// (`motor/yerel.rs`) bunu paylaşır. Dilim ve kayıt adedi denetimi burada değildir (yerel yazar yapar).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Uygulama {
    /// Kutulu: kayıt büyük, öteki değişkenler küçük.
    Yeni(Box<AjandaKaydi>),
    Etkisiz,
    Ret(AjandaRetNedeni),
}

/// İşlemi `onceki` hale servis kurallarıyla uygular (`ts`: işlemin anı). Yeni halin revizyonu değişmez
/// (servis ya da yerel yazar verir); `guncelleme_ms` `degisiklikAni` kuralıyla ilerler.
pub(crate) fn islem_uygula(onceki: Option<&AjandaKaydi>, islem: &AjandaIslem, ts: i64, b: &IyimserBaglam) -> Uygulama {
    if let AjandaIslem::Ekle { kayit_id, govde, girdi_yolu, .. } = islem {
        return match onceki {
            // Servis zaten uyguladı (kayıt sonuçtan önce geldi) ya da kimlik çakışıyor: gerçek olan kalır.
            Some(_) => Uygulama::Ret(AjandaRetNedeni::KimlikCakisiyor),
            None => {
                let k = eklenen_kayit(kayit_id, govde, girdi_yolu.yol(), ts, b);
                if k.gecerli_mi().is_ok() { Uygulama::Yeni(Box::new(k)) } else { Uygulama::Ret(AjandaRetNedeni::TutarsizKayit) }
            }
        };
    }
    let Some(k) = onceki else { return Uygulama::Ret(AjandaRetNedeni::KayitBulunamadi) };
    let yeni: Option<AjandaKaydi> = match islem {
        AjandaIslem::Ekle { .. } => unreachable!(),
        AjandaIslem::Sil { .. } => (!k.silindi).then(|| AjandaKaydi { silindi: true, ..k.clone() }),
        AjandaIslem::GeriYukle { .. } => k.silindi.then(|| AjandaKaydi { silindi: false, ..k.clone() }),
        // Mezar taşına `geri_yukle` dışında her işlem `kayit_silinmis`.
        _ if k.silindi => return Uygulama::Ret(AjandaRetNedeni::KayitSilinmis),
        AjandaIslem::Onayla { .. } => k.taslak.then(|| AjandaKaydi { taslak: false, ..k.clone() }),
        AjandaIslem::Guncelle { degisiklik, .. } => {
            let bir = ajanda_degisikligi_uygula(k, &AlanDegisikligi::from(degisiklik.clone()), yazar(islem));
            (!bir.uygulanan.is_empty()).then_some(bir.kayit)
        }
        AjandaIslem::Durum { durum, ornek_tarihi: None, .. } => {
            let d = AlanDegisikligi { durum: Some(*durum), ..Default::default() };
            let bir = ajanda_degisikligi_uygula(k, &d, yazar(islem));
            (!bir.uygulanan.is_empty()).then_some(bir.kayit)
        }
        AjandaIslem::Durum { durum, ornek_tarihi: Some(tarih), .. } => {
            let Some(bugun) = b.bugun(k) else { return Uygulama::Ret(AjandaRetNedeni::SaatDilimiBilinmiyor) };
            match ajanda_ornek_durumu_uygula(k, tarih, *durum, &bugun) {
                OrnekDurumuSonucu::Tamam { ornekler, degisti: true, .. } => Some(AjandaKaydi { ornekler, ..k.clone() }),
                OrnekDurumuSonucu::Tamam { degisti: false, .. } => None,
                OrnekDurumuSonucu::Gecersiz => return Uygulama::Ret(AjandaRetNedeni::OrnekGecersiz),
            }
        }
    };
    match yeni {
        Some(mut y) => {
            y.guncelleme_ms = k.guncelleme_ms.max(ts);
            // Servis bozuk sonucu `tutarsiz_kayit` ile reddeder.
            if y.gecerli_mi().is_ok() { Uygulama::Yeni(Box::new(y)) } else { Uygulama::Ret(AjandaRetNedeni::TutarsizKayit) }
        }
        None => Uygulama::Etkisiz,
    }
}

/// Bir işlemin `onceki` hale iyimser uygulanması (`ts`: işlemin kuyruğa giriş anı). Döner: yeni hal
/// (`None`: kayıt yok). Servisin reddedeceği ya da yan etkisiz bulacağı işlemde `onceki` aynen döner.
pub(crate) fn iyimser_uygula(onceki: Option<&AjandaKaydi>, islem: &AjandaIslem, ts: i64, b: &IyimserBaglam) -> Option<AjandaKaydi> {
    match islem_uygula(onceki, islem, ts, b) {
        Uygulama::Yeni(k) => Some(*k),
        // Örneğin yerel günü bulunamadı (dilim çevrilemedi): önceki sürümdeki gibi iyimser hal yoktur.
        Uygulama::Ret(AjandaRetNedeni::SaatDilimiBilinmiyor) => None,
        Uygulama::Etkisiz | Uygulama::Ret(_) => onceki.cloned(),
    }
}

/// Kaydın iyimser hali: sunucu hali + kuyruk satırları sırayla (`sira_ust` verilirse ona kadar, dahil).
/// İkinci değer: sonucu gelmemiş satırı var mı (`bekleyen`).
pub(crate) fn iyimser_hal(
    d: &Depo,
    b: &IyimserBaglam,
    kayit_id: &str,
    sira_ust: Option<i64>,
) -> Result<(Option<AjandaKaydi>, bool), CekirdekHatasi> {
    let mut hal = d.sunucu_kaydi(kayit_id)?;
    let satirlar = d.kuyruk_kaydin(kayit_id)?;
    let bekleyen = satirlar.iter().any(|s| s.bekledigi_rev.is_none());
    for s in satirlar.iter().filter(|s| sira_ust.is_none_or(|u| s.sira <= u)) {
        // Bozuk satır görünen hali değiştirmez (kuyruk başına gelince ret listesine geçer).
        if let Some(islem) = islem_coz(&s.islem_json) {
            hal = iyimser_uygula(hal.as_ref(), &islem, s.olusturma_ms, b);
        }
    }
    Ok((hal, bekleyen))
}

/// Ret listesinin düzeltme formu: `ekle`'de gönderilen gövde, `guncelle`'de değişikliğin kendinden önceki
/// hale (servis reddetmiş olsa da, örneğin kayıt PC'de silinmişken) uygulanmış hali. Ötekilerde yok.
pub(crate) fn istenen_govde(
    d: &Depo,
    b: &IyimserBaglam,
    kayit_id: &str,
    sira: i64,
    islem: Option<&AjandaIslem>,
) -> Result<Option<KayitGovdesi>, CekirdekHatasi> {
    Ok(match islem {
        Some(AjandaIslem::Ekle { govde, .. }) => Some(govde.clone()),
        Some(i @ AjandaIslem::Guncelle { degisiklik, .. }) => iyimser_hal(d, b, kayit_id, Some(sira - 1))?.0.map(|onceki| {
            let bir = ajanda_degisikligi_uygula(&onceki, &AlanDegisikligi::from(degisiklik.clone()), yazar(i));
            kayittan_govde(&bir.kayit)
        }),
        _ => None,
    })
}

/// Kaydın görünen satırını yeniden hesaplar ve gerekirse yazar/siler. Döner: görünen hal değişti mi
/// (kayıt metni ya da `bekleyen`). Açık bir `Depo::yazma` içinde çağrılır. Yerel kipte hiçbir şey yapmaz.
pub(crate) fn gorunen_yenile(d: &Depo, b: &IyimserBaglam, kayit_id: &str) -> Result<bool, CekirdekHatasi> {
    // Yerel kipte görünen kopya türetme değil, doğruluk kaynağıdır: sunucu + kuyruktan yeniden hesap onu ezmez.
    if d.yerel_kip_mi()? {
        return Ok(false);
    }
    let (hal, bekleyen) = iyimser_hal(d, b, kayit_id, None)?;
    let eski = d.gorunen_ham(kayit_id)?;
    match (hal, eski) {
        (None, None) => Ok(false),
        (None, Some(_)) => {
            d.gorunen_sil(kayit_id)?;
            Ok(true)
        }
        (Some(k), eski) => {
            let yeni_json = k.json().to_string();
            if eski.is_some_and(|(json, b)| b == bekleyen && json == yeni_json) {
                return Ok(false);
            }
            d.gorunen_yaz(&k, bekleyen)?;
            Ok(true)
        }
    }
}
