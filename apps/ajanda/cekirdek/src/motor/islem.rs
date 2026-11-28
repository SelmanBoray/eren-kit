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

use super::iyimser::{Uygulama, gorunen_yenile, islem_coz, islem_uygula, iyimser_uygula};
use super::kanal::ertelenen_atildi_mi;
use super::yerel::kayit_coz;
use super::{Etkiler, Motor, Ortam};
use crate::depo::{Depo, KuyrukSatiri};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::DuzenlemeTemeli;
use crate::kural::metin::govdeyi_hazirla;
use crate::kural::ornek::{OrnekDurumuSonucu, ajanda_ornek_durumu_uygula};
use crate::model::metin::opak_id_mi;
use crate::model::{
    AjandaDegisiklik, AjandaIslem, AjandaKaydi, Alan, AjandaZamani, GirdiYolu, IslemTuru, KayitDurumu, KayitGovdesi,
    V3Alanlari, V3Degisikligi, ajanda_bolge_yeri_degisir_mi,
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

/// Değişikliği v3 alanlarına uygular (`Kaldir` kaldırır, `Yok` dokunmaz; servisin kuralıyla: bölge başka bir
/// yere değişip konum verilmemişse konum düşer, bölgesiz kalan konum ve varış düşer). `ret_duzelt`.
fn v3_uygula(a: &V3Alanlari, d: &V3Degisikligi) -> V3Alanlari {
    fn tek<T: Clone>(h: &mut Option<T>, d: &Alan<T>) {
        match d {
            Alan::Deger(v) => *h = Some(v.clone()),
            Alan::Kaldir => *h = None,
            Alan::Yok => {}
        }
    }
    fn liste<T: Clone>(h: &mut Vec<T>, d: &Alan<Vec<T>>) {
        match d {
            Alan::Deger(v) => h.clone_from(v),
            Alan::Kaldir => h.clear(),
            Alan::Yok => {}
        }
    }
    let mut v = a.clone();
    if let Alan::Deger(yeni) = &d.bolge
        && d.bolge_konumu.yok_mu()
        && ajanda_bolge_yeri_degisir_mi(a.bolge.as_deref(), Some(yeni.as_str()))
    {
        v.bolge_konumu = None;
    }
    tek(&mut v.simge, &d.simge);
    tek(&mut v.bolge, &d.bolge);
    tek(&mut v.bolge_konumu, &d.bolge_konumu);
    tek(&mut v.varis, &d.varis);
    liste(&mut v.baglantilar, &d.baglantilar);
    liste(&mut v.ekler, &d.ekler);
    if v.bolge.is_none() {
        v.bolge_konumu = None;
        v.varis = None;
    }
    v
}

/// İki kaydın gövde ve v3 alanlarının farkı (`eski` -> `yeni`; durum, örnekler, taslak, silindi ayrı
/// işlemlerdir). Arayüzün formu (`duzenle`) yalnız gövdeyi taşır, v3 farkı dökme yollarınındır
/// (`yerel::kuyruga_islemler`).
pub(super) fn kayit_farki(eski: &AjandaKaydi, yeni: &AjandaKaydi) -> AjandaDegisiklik {
    AjandaDegisiklik { v3: v3_farki(&eski.v3, &yeni.v3), ..govde_farki(&kaydin_govdesi(eski), &kaydin_govdesi(yeni)) }
}

/// Alt sürümlü bağlantıda bölünmüş (`kanal.rs` `v3_kalanini_ertele`) bir `ekle`'nin v2 kısmı ret listesine
/// geçerken v3 kalanı (R3): kaydın satırlarında hemen arkasındaki, bölünmenin bıraktığı yalnız v3 `guncelle`
/// (aynı an, `temel_revizyon` 1, denemesiz, yollanmamış, onaylanmamış). Kalan kuyrukta kalsaydı servisin
/// hiç doğurmadığı kayda bağlı beklerdi: v3'te `kayit_bulunamadi` alır (kimlik çakışmasında başka bir kaydın v3
/// alanlarını değiştirirdi), `ekle`'nin düzeltmesi yeni kimlikle v3'süz kayıt doğurur, kalanın düzeltmesi ikinci
/// bir kopya. Bunun yerine ret girdisi özgün `ekle`'nin tamamıdır (v3 alanları kalanınkiler): kullanıcının v3
/// değişikliği ret listesinde görünür (`RetGirdisi.v3_degisikligi`), `ret_duzelt` onu yeni kayda taşır; kalan
/// kuyruktan çıkar. Döner: girdinin işlem metni ve silinecek kalanın sırası; işlem bölünmüş bir `ekle` değilse
/// ya da kalan yoksa (ör. kullanıcı onu `ertelenenleri_at` ile zaten attı) `None`.
pub(super) fn reddedilen_eklenin_kalani(
    d: &Depo,
    s: &KuyrukSatiri,
    islem: Option<&AjandaIslem>,
) -> Result<Option<(String, i64)>, CekirdekHatasi> {
    // Bölünmüş `ekle`'nin v3'ü boştur (v3 alanları kalandadır).
    let Some(AjandaIslem::Ekle { kayit_id, govde, v3, girdi_yolu }) = islem else { return Ok(None) };
    if !v3.bos_mu() {
        return Ok(None);
    }
    let Some(k) = d.kuyruk_kaydin(&s.kayit_id)?.into_iter().find(|k| k.sira > s.sira) else { return Ok(None) };
    if k.yollandi || k.bekledigi_rev.is_some() || k.deneme != 0 || k.olusturma_ms != s.olusturma_ms {
        return Ok(None);
    }
    let Some(AjandaIslem::Guncelle { temel_revizyon: 1, degisiklik, .. }) = islem_coz(&k.islem_json) else { return Ok(None) };
    let v2_kismi = AjandaDegisiklik { v3: V3Degisikligi::default(), ..degisiklik.clone() };
    if !v2_kismi.bos_mu() || degisiklik.v3.bos_mu() {
        return Ok(None);
    }
    let butun = AjandaIslem::Ekle {
        kayit_id: kayit_id.clone(),
        govde: govde.clone(),
        v3: v3_uygula(v3, &degisiklik.v3),
        girdi_yolu: *girdi_yolu,
    };
    Ok(Some((butun.json().to_string(), k.sira)))
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
        self.ekle_v3(o, e, govde, V3Alanlari::default(), girdi_yolu)
    }

    /// `ekle`, v3 alanlarıyla (`ret_duzelt`; `v3` kurallardan geçmiş olmalı).
    fn ekle_v3(&mut self, o: &Ortam, e: &mut Etkiler, govde: KayitGovdesi, v3: V3Alanlari, girdi_yolu: GirdiYolu) -> Result<String, CekirdekHatasi> {
        let govde = govdeyi_hazirla(govde)?;
        // Güvenli rastgelede çakışma beklenmez; yine de var olan kimlik asla yeniden verilmez.
        let mut kayit_id = Motor::yeni_kimlik(o, "k_")?;
        while self.depo.gorunen_ham(&kayit_id)?.is_some()
            || self.depo.sunucu_revizyonu(&kayit_id)?.is_some()
            || !self.depo.kuyruk_kaydin(&kayit_id)?.is_empty()
        {
            kayit_id = Motor::yeni_kimlik(o, "k_")?;
        }
        self.kuyruga_koy(o, e, AjandaIslem::Ekle { kayit_id: kayit_id.clone(), govde, v3, girdi_yolu }, true)?;
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
        self.duzenle_v3(o, e, kayit_id, temel, govde, V3Degisikligi::default())
    }

    /// `duzenle`, ayrıca bir v3 değişikliğiyle (`ret_duzelt`: reddedilen işlemin v3 kısmı kaybolmasın).
    fn duzenle_v3(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        kayit_id: &str,
        temel: Option<DuzenlemeTemeli>,
        govde: KayitGovdesi,
        v3: V3Degisikligi,
    ) -> Result<(), CekirdekHatasi> {
        let govde = govdeyi_hazirla(govde)?;
        let k = self.gorunen_ya_da_hata(kayit_id, false)?;
        let gorunenden = govde_farki(&kaydin_govdesi(&k), &govde);
        let (mut degisiklik, temel_revizyon) = match temel {
            None => (gorunenden, k.revizyon),
            Some(t) => {
                // Temel kayıttan geldiği için hazırlıktan geçer; geçmezse (kural sonradan sıkılaştı) olduğu gibi.
                let temel_govde = govdeyi_hazirla(t.govde.clone()).unwrap_or(t.govde);
                (yalniz_degisenler(gorunenden, &govde_farki(&temel_govde, &govde)), t.revizyon)
            }
        };
        degisiklik.v3 = v3;
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

    /// Ret listesindeki girdinin düzeltmesi (köprü `ret_duzelt`): formun gövdesi yazılır, reddedilen işlemin v3
    /// kısmı korunur, yazım başarılıysa girdi listeden çıkar (yazım hata verirse girdi kalır). Döner: yazılan
    /// kaydın kimliği. Hedef (Kotlin'in eski `RetListesi.hedef` kuralı, artı işaret):
    /// - girdi bir `guncelle` ise, kaydı telefonda canlıysa ve girdi "kayıt sonra değişti" işaretli değilse
    ///   (`RetGirdisi.kayit_sonra_degisti`) var olan kayda: gövdenin tamamı istenen haldir (`duzenle(None)`),
    ///   ayrıca işlemin v3 değişikliği; girdi kaydın bir hali ise (`tutarsiz_kayit`: okunamayan satır, D4'ün
    ///   telefon hali) o halin v3 alanları (yokluk kaldırma sayılmaz);
    /// - yoksa yeni kayıt olarak (yeni kimlik; aynı kaydın kopyası doğmasın diye yalnız yukarıdaki durumda
    ///   var olan kayda yazılır): `ekle`'nin v3 alanları ve girdi yolu, `guncelle`'nin v3 değişikliği kaydın
    ///   (varsa) şimdiki v3 alanlarına uygulanmış hali, kayıt halinin v3 alanları. İşaretli girdide kaydın
    ///   şimdiki hali ezilmez, girdinin içeriği de kaybolmaz.
    ///
    /// Var olan kayda giden v3 değişikliği kaydın şimdiki haline uygulanamıyorsa (ret v3 yüzünden) gitmez, gövde
    /// yine gider (`dongusuz_v3`): aynı v3 girdiyi yeniden ret listesine düşürürdü. Listeler (`baglantilar`,
    /// `ekler`) bugün bütünüyle gider (L1 bekliyor: öğe öğe birleşim).
    ///
    /// Hata (girdi kalır): `GecersizGirdi{alan:"islem_id"}` (geçersiz kimlik, listede yok, atılmış ertelenen
    /// değişiklik: onun yolu `ertelenen_geri_al`; gövdesiz girdi: `sil`, `durum`, `onayla`, `geri_yukle`, yolu
    /// `ret_at`), form hataları (`GecersizGirdi`). Gözlemciye kaydın değişimi ve `ret_listesi`.
    pub(crate) fn ret_duzelt(&mut self, o: &Ortam, e: &mut Etkiler, islem_id: &str, govde: KayitGovdesi) -> Result<String, CekirdekHatasi> {
        let gecersiz = |neden: &str| CekirdekHatasi::GecersizGirdi { alan: "islem_id".into(), neden: neden.into() };
        if !opak_id_mi(islem_id) {
            return Err(gecersiz("geçersiz kimlik"));
        }
        let r = self.depo.ret_girdisi(islem_id)?.ok_or_else(|| gecersiz("ret listesinde yok"))?;
        if ertelenen_atildi_mi(&r.neden) {
            return Err(gecersiz("atılmış ertelenen değişiklik: ertelenen_geri_al ile uygulanır"));
        }
        let islem = islem_coz(&r.islem_json);
        let kayit_hali = if islem.is_none() { kayit_coz(&r.islem_json) } else { None };
        let tur = islem.as_ref().map(AjandaIslem::tur).or_else(|| {
            serde_json::from_str::<serde_json::Value>(&r.islem_json).ok()?.get("islem")?.as_str().and_then(IslemTuru::coz)
        });
        let tur = tur.unwrap_or(IslemTuru::Guncelle);
        // Gövdesiz girdi (R8): `sil`, `durum`, `onayla`, `geri_yukle` formla düzeltilemez (form bir gövde yazar;
        // eskiden yeni kayıt olarak eklenirdi). Yolu `ret_at` ya da işlemin kendisini yeniden yapmaktır.
        if !matches!(tur, IslemTuru::Ekle | IslemTuru::Guncelle) {
            return Err(gecersiz("gövdesiz işlem (sil, durum, onayla, geri_yukle) formla düzeltilmez: ret_at ile atılır"));
        }
        let sonra_degisti = self.depo.ret_sonra_degisenler()?.contains(islem_id);
        let mevcut = self.depo.gorunen_kayit(&r.kayit_id)?.map(|g| g.kayit);
        let kayit_id = match mevcut.as_ref().filter(|k| tur == IslemTuru::Guncelle && !k.silindi && !sonra_degisti) {
            Some(k) => {
                // L1 bekliyor: `baglantilar` ve `ekler` değişikliğin listesiyle bütünüyle yeniden gider; ret ile
                // düzeltme arasında PC'de eklenen bağlantı ya da ek ezilir. Öğe öğe birleşim (Kol C L1) gelince
                // listeler kaydın şimdiki listesiyle birleşmeli (`ertelenen_geri_al`'ın `geri_alma_plani` gibi).
                let v3 = match (&islem, &kayit_hali) {
                    (Some(AjandaIslem::Guncelle { degisiklik, .. }), _) => degisiklik.v3.clone(),
                    (_, Some(h)) => v3_farki(&k.v3, &v3_uygula(&k.v3, &h.v3.degisiklik())),
                    _ => V3Degisikligi::default(),
                };
                let v3 = self.dongusuz_v3(o, k, &govde, v3)?;
                self.duzenle_v3(o, e, &r.kayit_id, None, govde, v3)?;
                r.kayit_id.clone()
            }
            None => {
                let taban = mevcut.map(|k| k.v3).unwrap_or_default();
                let (v3, girdi_yolu) = match (islem, kayit_hali) {
                    (Some(AjandaIslem::Ekle { v3, girdi_yolu, .. }), _) => (v3, girdi_yolu),
                    (Some(AjandaIslem::Guncelle { degisiklik, .. }), _) => (v3_uygula(&taban, &degisiklik.v3), GirdiYolu::Elle),
                    (_, Some(h)) => (h.v3, GirdiYolu::Elle),
                    _ => (V3Alanlari::default(), GirdiYolu::Elle),
                };
                self.ekle_v3(o, e, govde, v3, girdi_yolu)?
            }
        };
        if self.depo.ret_sil(islem_id)? {
            e.degisim.ret_listesi = true;
            e.degisim.baglanti = true;
        }
        Ok(kayit_id)
    }

    /// Düzeltmenin v3 kısmı (`ret_duzelt`, var olan kayda): formun gövde farkıyla birlikte kaydın şimdiki haline
    /// servis kurallarıyla (`islem_uygula`) uygulanınca reddediliyorsa ve gövde farkı tek başına reddedilmiyorsa
    /// gitmez (R4): ret v3 yüzündendir (ör. bölgesi kalkan kayıtta varış, `tutarsiz_kayit`), form v3 alanı
    /// taşımadığından kullanıcı onu düzeltemez; aynı v3'ü yeniden yollamak girdiyi yeniden ret listesine
    /// düşürürdü (yerel kipte de her düzeltme hata verirdi). Gövde farkı yine gider. Değişiklik o hale
    /// uygulanabiliyorsa (PC arada bölge eklemiş olabilir) olduğu gibi döner. Formun hatasını `duzenle_v3` söyler.
    fn dongusuz_v3(&self, o: &Ortam, k: &AjandaKaydi, govde: &KayitGovdesi, v3: V3Degisikligi) -> Result<V3Degisikligi, CekirdekHatasi> {
        if v3.bos_mu() {
            return Ok(v3);
        }
        let Ok(hazir) = govdeyi_hazirla(govde.clone()) else { return Ok(v3) };
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let gorunenden = govde_farki(&kaydin_govdesi(k), &hazir);
        let reddedilir = |degisiklik: AjandaDegisiklik| {
            let islem = AjandaIslem::Guncelle { kayit_id: k.kayit_id.clone(), temel_revizyon: k.revizyon, degisiklik };
            matches!(islem_uygula(Some(k), &islem, b.simdi_ms, &b), Uygulama::Ret(_))
        };
        if reddedilir(AjandaDegisiklik { v3: v3.clone(), ..gorunenden.clone() }) && !reddedilir(gorunenden) {
            return Ok(V3Degisikligi::default());
        }
        Ok(v3)
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
