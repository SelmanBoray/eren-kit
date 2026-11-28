//! SAHİBİ: R4. Arayüzden gelen işlemler: iyimser uygula (görünen kopya), kalıcı kuyruğa koy, canlıysa
//! ve sırası geldiyse yolla. `docs/AJANDA.md` "Kanal akışı" 4-5. Metin: `kural::metin::govdeyi_hazirla`;
//! birleştirme: `kural::birlesim`; örnek: `kural::ornek` (`bugun` kaydın dilimindeki yerel gün,
//! `Ortam::cevirici().yerele_cevir`). Kimlikler `KimlikKabugu.rastgele` + `model::kanonik::base64url_yaz`.
//!
//! Kurallar:
//! - Kuyruğa giriş ve görünen kopyanın yeniden hesabı tek SQLite işlemidir; dönüşte işlem kalıcıdır.
//!   Sonrasındaki adımların (alarm senkronu, yollama) hatası çağrıyı başarısız yapmaz: arayüz yeniden
//!   denerse işlem çift olurdu.
//! - Görünen hali değiştirmeyecek işlem (zaten tamam olana `tamam`, silinmişe `sil`, taslak olmayana
//!   `onayla`) kuyruğa girmez: servis yan etkisiz bulurdu. `duzenle` farkı boşsa da girmez.
//! - Yerelde kesin geçersiz olan reddedilir, kuyruğa girmez: form sorunu (`GecersizGirdi`), olmayan kayıt
//!   (`KayitYok`), mezar taşına `geri_yukle` dışında işlem (`GecersizDurum`), serinin örneği olmayan tarih.
//! - Yerel kipte (`motor/yerel.rs`) işlem kuyruğa girmez: aynı denetimlerden sonra servis kurallarıyla
//!   doğrudan ve kalıcı uygulanır (yerel revizyon, yerel geçmiş); yukarıdaki kurallar aynen geçerlidir.

use super::iyimser::{gorunen_yenile, iyimser_uygula};
use super::{Etkiler, Motor, Ortam};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::DuzenlemeTemeli;
use crate::kural::metin::govdeyi_hazirla;
use crate::kural::ornek::{OrnekDurumuSonucu, ajanda_ornek_durumu_uygula};
use crate::model::{
    AjandaDegisiklik, AjandaIslem, AjandaKaydi, Alan, AjandaZamani, GirdiYolu, KayitDurumu, KayitGovdesi, V3Alanlari,
    V3Degisikligi, ajanda_bolge_yeri_degisir_mi,
};

/// İki seçenekli alanın farkı (`null` kaldırır).
fn uclu_fark<T: PartialEq + Clone>(eski: &Option<T>, yeni: &Option<T>) -> Alan<T> {
    match (eski, yeni) {
        (a, b) if a == b => Alan::Yok,
        (_, None) => Alan::Kaldir,
        (_, Some(d)) => Alan::Deger(d.clone()),
    }
}

fn kaydin_govdesi(k: &AjandaKaydi) -> KayitGovdesi {
    KayitGovdesi {
        tur: k.tur,
        baslik: k.baslik.clone(),
        aciklama: k.aciklama.clone(),
        zaman: k.zaman.clone(),
        hatirlatmalar: k.hatirlatmalar.clone(),
        tekrar: k.tekrar.clone(),
    }
}

/// İki gövdenin farkı (`eski` -> `yeni`).
pub(super) fn govde_farki(k: &KayitGovdesi, g: &KayitGovdesi) -> AjandaDegisiklik {
    AjandaDegisiklik {
        tur: (g.tur != k.tur).then_some(g.tur),
        baslik: (g.baslik != k.baslik).then(|| g.baslik.clone()),
        aciklama: uclu_fark(&k.aciklama, &g.aciklama),
        zaman: uclu_fark(&k.zaman, &g.zaman),
        hatirlatmalar: (g.hatirlatmalar != k.hatirlatmalar).then(|| g.hatirlatmalar.clone()),
        tekrar: uclu_fark(&k.tekrar, &g.tekrar),
        v3: Default::default(),
    }
}

/// Liste alanının farkı (boş liste alan yoktur: boşa inen liste `null` ile kaldırılır).
fn liste_farki<T: PartialEq + Clone>(eski: &[T], yeni: &[T]) -> Alan<Vec<T>> {
    match (eski, yeni) {
        (a, b) if a == b => Alan::Yok,
        (_, []) => Alan::Kaldir,
        (_, b) => Alan::Deger(b.to_vec()),
    }
}

/// İki halin v3 alanlarının farkı (`eski` -> `yeni`): yalnız `yeni`'de farklı olanlar; `eski`'de olup
/// `yeni`'de olmayan alan `null` ile kaldırılır (`eski` farkın uygulanacağı hal olmalıdır: yokluk ancak
/// orada vardıysa kaldırmadır, Kol C kuralı). Bölge başka bir yere değişirken konum değişmemişse de açıkça
/// gider: servis konumu verilmemiş yer değişikliğinde düşürür (`ajandaDegisikligiUygula`).
pub(super) fn v3_farki(eski: &V3Alanlari, yeni: &V3Alanlari) -> V3Degisikligi {
    let mut d = V3Degisikligi {
        simge: uclu_fark(&eski.simge, &yeni.simge),
        bolge: uclu_fark(&eski.bolge, &yeni.bolge),
        bolge_konumu: uclu_fark(&eski.bolge_konumu, &yeni.bolge_konumu),
        varis: uclu_fark(&eski.varis, &yeni.varis),
        baglantilar: liste_farki(&eski.baglantilar, &yeni.baglantilar),
        ekler: liste_farki(&eski.ekler, &yeni.ekler),
    };
    if let Some(konum) = &yeni.bolge_konumu
        && d.bolge_konumu.yok_mu()
        && ajanda_bolge_yeri_degisir_mi(eski.bolge.as_deref(), yeni.bolge.as_deref())
    {
        d.bolge_konumu = Alan::Deger(*konum);
    }
    d
}

/// İki kaydın gövde ve v3 alanlarının farkı (`eski` -> `yeni`; durum, örnekler, taslak, silindi ayrı
/// işlemlerdir). Arayüzün formu (`duzenle`) yalnız gövdeyi taşır, v3 farkı dökme yollarınındır
/// (`yerel::kuyruga_islemler`).
pub(super) fn kayit_farki(eski: &AjandaKaydi, yeni: &AjandaKaydi) -> AjandaDegisiklik {
    AjandaDegisiklik { v3: v3_farki(&eski.v3, &yeni.v3), ..govde_farki(&kaydin_govdesi(eski), &kaydin_govdesi(yeni)) }
}

/// `d`'nin yalnız `maske`'de de değişen alanları (ikisi de aynı hedef gövdeye doğru olduğundan değerler
/// aynıdır).
fn yalniz_degisenler(mut d: AjandaDegisiklik, maske: &AjandaDegisiklik) -> AjandaDegisiklik {
    if maske.tur.is_none() {
        d.tur = None;
    }
    if maske.baslik.is_none() {
        d.baslik = None;
    }
    if maske.aciklama.yok_mu() {
        d.aciklama = Alan::Yok;
    }
    if maske.zaman.yok_mu() {
        d.zaman = Alan::Yok;
    }
    if maske.hatirlatmalar.is_none() {
        d.hatirlatmalar = None;
    }
    if maske.tekrar.yok_mu() {
        d.tekrar = Alan::Yok;
    }
    d
}

impl Motor {
    /// Görünen kayıt; yoksa `KayitYok`, mezar taşıysa ve `silinmis_olabilir` değilse `GecersizDurum`.
    fn gorunen_ya_da_hata(&self, kayit_id: &str, silinmis_olabilir: bool) -> Result<AjandaKaydi, CekirdekHatasi> {
        let k = self
            .depo
            .gorunen_kayit(kayit_id)?
            .map(|g| g.kayit)
            .ok_or_else(|| CekirdekHatasi::KayitYok { kayit_id: kayit_id.to_string() })?;
        if k.silindi && !silinmis_olabilir {
            return Err(CekirdekHatasi::GecersizDurum { mesaj: "kayıt silinmiş; önce geri yükle".into() });
        }
        Ok(k)
    }

    /// İşlemi kuyruğa koyar ve iyimser uygular. `zorla` değilse görünen hali değiştirmeyecek işlem atlanır.
    /// Döner: kuyruğa girdi mi.
    fn kuyruga_koy(&mut self, o: &Ortam, e: &mut Etkiler, islem: AjandaIslem, zorla: bool) -> Result<bool, CekirdekHatasi> {
        if self.yerel_mi()? {
            return self.yerel_yaz(o, e, islem);
        }
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let kayit_id = islem.kayit_id().to_string();
        if !zorla {
            let mevcut = self.depo.gorunen_kayit(&kayit_id)?.map(|g| g.kayit);
            if iyimser_uygula(mevcut.as_ref(), &islem, b.simdi_ms, &b) == mevcut {
                return Ok(false);
            }
        }
        let islem_id = Motor::yeni_kimlik(o, "i_")?;
        let json = islem.json().to_string();
        let degisti = self.depo.yazma(|d| {
            d.kuyruga_ekle(&islem_id, &kayit_id, &json, b.simdi_ms)?;
            gorunen_yenile(d, &b, &kayit_id)
        })?;
        e.degisim.baglanti = true;
        if degisti {
            self.gorunenler_degisti(o, e, std::slice::from_ref(&kayit_id));
        }
        let _ = self.kuyruk_ilerlet(o, e);
        Ok(true)
    }

    /// Yeni kayıt; döner: üretilen `kayit_id`.
    pub(crate) fn ekle(&mut self, o: &Ortam, e: &mut Etkiler, govde: KayitGovdesi, girdi_yolu: GirdiYolu) -> Result<String, CekirdekHatasi> {
        let govde = govdeyi_hazirla(govde)?;
        // Güvenli rastgelede çakışma beklenmez; yine de var olan kimlik asla yeniden verilmez.
        let mut kayit_id = Motor::yeni_kimlik(o, "k_")?;
        while self.depo.gorunen_ham(&kayit_id)?.is_some()
            || self.depo.sunucu_revizyonu(&kayit_id)?.is_some()
            || !self.depo.kuyruk_kaydin(&kayit_id)?.is_empty()
        {
            kayit_id = Motor::yeni_kimlik(o, "k_")?;
        }
        self.kuyruga_koy(o, e, AjandaIslem::Ekle { kayit_id: kayit_id.clone(), govde, v3: Default::default(), girdi_yolu }, true)?;
        Ok(kayit_id)
    }

    /// Formun gövdesi `guncelle` işlemine çevrilir (fark yoksa hiçbir şey). `temel` verilirse yalnız
    /// kullanıcının formun açıldığı halden değiştirdiği alanlar ve onlardan da yalnız görünen halden farklı
    /// olanlar gider: form açıkken PC'den inen değişiklik, kullanıcının dokunmadığı alanda eski değere
    /// dönmez (sözleşmenin alan alan birleşmesi; son varan yalnız kendi alanlarında kazanır). `temel` yoksa
    /// gövdenin tamamı istenen haldir (ret listesinden düzeltme).
    pub(crate) fn duzenle(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        kayit_id: &str,
        temel: Option<DuzenlemeTemeli>,
        govde: KayitGovdesi,
    ) -> Result<(), CekirdekHatasi> {
        let govde = govdeyi_hazirla(govde)?;
        let k = self.gorunen_ya_da_hata(kayit_id, false)?;
        let gorunenden = govde_farki(&kaydin_govdesi(&k), &govde);
        let (degisiklik, temel_revizyon) = match temel {
            None => (gorunenden, k.revizyon),
            Some(t) => {
                // Temel kayıttan geldiği için hazırlıktan geçer; geçmezse (kural sonradan sıkılaştı) olduğu gibi.
                let temel_govde = govdeyi_hazirla(t.govde.clone()).unwrap_or(t.govde);
                (yalniz_degisenler(gorunenden, &govde_farki(&temel_govde, &govde)), t.revizyon)
            }
        };
        if degisiklik.bos_mu() {
            return Ok(());
        }
        let islem = AjandaIslem::Guncelle { kayit_id: kayit_id.to_string(), temel_revizyon, degisiklik };
        self.kuyruga_koy(o, e, islem, true)?;
        Ok(())
    }

    /// Tamamla / geri al / iptal; `ornek_tarihi` verilirse tekrarın yalnız o örneği.
    pub(crate) fn durum_degistir(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        kayit_id: &str,
        durum: KayitDurumu,
        ornek_tarihi: Option<String>,
    ) -> Result<(), CekirdekHatasi> {
        let k = self.gorunen_ya_da_hata(kayit_id, false)?;
        if let Some(tarih) = &ornek_tarihi {
            let dilim = match &k.zaman {
                Some(AjandaZamani::An { saat_dilimi, .. }) | Some(AjandaZamani::Gun { saat_dilimi, .. }) => saat_dilimi.clone(),
                _ => o.zaman.cihaz_dilimi(),
            };
            let bugun = o.zaman.andan_yerele(o.simdi_ms(), dilim)?.tarih;
            if ajanda_ornek_durumu_uygula(&k, tarih, durum, &bugun) == OrnekDurumuSonucu::Gecersiz {
                return Err(CekirdekHatasi::GecersizGirdi {
                    alan: "ornek_tarihi".into(),
                    neden: "tekrarın örneği değil ya da örnek sınırı dolu".into(),
                });
            }
        }
        let islem = AjandaIslem::Durum { kayit_id: kayit_id.to_string(), durum, ornek_tarihi };
        self.kuyruga_koy(o, e, islem, false)?;
        Ok(())
    }

    /// Taslağı kesinleştirir (taslak değilse hiçbir şey).
    pub(crate) fn onayla(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str) -> Result<(), CekirdekHatasi> {
        self.gorunen_ya_da_hata(kayit_id, false)?;
        self.kuyruga_koy(o, e, AjandaIslem::Onayla { kayit_id: kayit_id.to_string() }, false)?;
        Ok(())
    }

    /// Mezar taşı (zaten silinmişse hiçbir şey).
    pub(crate) fn sil(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str) -> Result<(), CekirdekHatasi> {
        self.gorunen_ya_da_hata(kayit_id, true)?;
        self.kuyruga_koy(o, e, AjandaIslem::Sil { kayit_id: kayit_id.to_string() }, false)?;
        Ok(())
    }

    /// Mezar taşını geri alır (silinmemişse hiçbir şey).
    pub(crate) fn geri_yukle(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str) -> Result<(), CekirdekHatasi> {
        self.gorunen_ya_da_hata(kayit_id, true)?;
        self.kuyruga_koy(o, e, AjandaIslem::GeriYukle { kayit_id: kayit_id.to_string() }, false)?;
        Ok(())
    }

    /// Ret listesinden atar (kullanıcı vazgeçti ya da düzeltip yeniden ekledi). Listede yoksa hiçbir şey.
    pub(crate) fn ret_at(&mut self, o: &Ortam, e: &mut Etkiler, islem_id: &str) -> Result<(), CekirdekHatasi> {
        let _ = o;
        if self.depo.ret_sil(islem_id)? {
            e.degisim.ret_listesi = true;
            e.degisim.baglanti = true;
        }
        Ok(())
    }
}
