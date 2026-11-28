//! SAHİBİ: R4. Arayüz sorguları (görünen kopyadan: `depo::gorunen`) ve geçmiş isteği.
//!
//! Sekmeler (`Sekme`):
//! - `Tarihli`: zamanı `an`/`gun`/`donem`; ilk güne göre artan, aynı günde gün boyu olan önce, sonra saat.
//! - `Tarihsiz`: zamansız ya da `belirsiz`; en yeni üstte.
//! - `Taslaklar`: taslaklar (tarihli/tarihsiz listelerde de işaretli görünürler); en yeni üstte.
//! - `Silinenler`: mezar taşları, durumları ne olursa olsun (`kapalilar_dahil` yok sayılır: bitmiş ama
//!   silinmiş kayıt da geri yüklenebilsin); en yeni üstte.
//!
//! Mezar taşı `Silinenler` dışında hiç gelmez; `kapalilar_dahil` yanlışsa `tamam`/`iptal` gelmez.
//!
//! Bu sorgular yalnız `Depo` okur: köprü onları motor kilidini almadan ayrı bir okuma bağlantısında da
//! çalıştırabilir (`kopru::Cekirdek`), böylece uzun bir telafi yazması arayüzü bekletmez.

use super::kanal::{ERTELENEN_ATILDI_YOLLANMIS, SatirErtelemesi, atilan_coz, ertelenen_atildi_mi, erteleme_surumu, kuyruk_ertelemeleri};
use super::{Etkiler, Motor, Ortam};
use crate::depo::{Depo, GorunenSuzgec};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{GecmisSayfasi, KayitGorunumu, ListeSorgusu, RetGirdisi, Sekme, V3DegisiklikOzeti};
use crate::model::metin::opak_id_mi;
use crate::model::{AjandaIslem, AjandaKaydi, AjandaYukari, Alan, IslemTuru, KayitGovdesi, KuyrukRetNedeni, Surum, V3Alanlari};

fn suzgec(sorgu: &ListeSorgusu) -> GorunenSuzgec {
    let k = sorgu.kapalilar_dahil;
    match sorgu.sekme {
        Sekme::Tarihli => GorunenSuzgec { tarihli: Some(true), kapalilar_dahil: k, ..Default::default() },
        Sekme::Tarihsiz => GorunenSuzgec { tarihli: Some(false), kapalilar_dahil: k, ..Default::default() },
        Sekme::Taslaklar => GorunenSuzgec { yalniz_taslak: true, kapalilar_dahil: k, ..Default::default() },
        Sekme::Silinenler => GorunenSuzgec { silinenler: true, kapalilar_dahil: true, ..Default::default() },
    }
}

/// Görünen satırları köprünün kayıt görünümüne çevirir (liste, kayıt, takvim günü): ertelemede ("Erteleme",
/// `kanal.rs`) kayıt başına `ertelenen` (bu serviste gitmeyen bekleyen satırı var: v3 değişikliği ya da
/// arkasında sırası tutulan, `kuyruk_ertelemeleri`) ve `bekleyen` (bu serviste gidecek bekleyen satırı var).
/// Erteleme yokken ya da kaydın bekleyen satırı yokken saklı `bekleyen` olduğu gibidir; kuyruk yalnız bekleyen
/// kayıtlar için okunur.
pub(crate) struct Gorunumcu(Option<Surum>);

impl Gorunumcu {
    pub(crate) fn ac(d: &Depo) -> Result<Self, CekirdekHatasi> {
        Ok(Gorunumcu(erteleme_surumu(d)?))
    }

    pub(crate) fn gorunum(&self, d: &Depo, kayit: AjandaKaydi, bekleyen: bool) -> Result<KayitGorunumu, CekirdekHatasi> {
        if self.0.is_none() || !bekleyen {
            return Ok(KayitGorunumu { kayit, bekleyen, ertelenen: false });
        }
        let (mut gidecek, mut ertelenen) = (false, false);
        let satirlar = d.kuyruk_kaydin(&kayit.kayit_id)?;
        for (s, hal) in satirlar.iter().zip(kuyruk_ertelemeleri(&satirlar, self.0)) {
            match hal {
                SatirErtelemesi::Tam => ertelenen = true,
                SatirErtelemesi::Kismen => (gidecek, ertelenen) = (true, true),
                SatirErtelemesi::Yok => gidecek |= s.bekledigi_rev.is_none(),
            }
        }
        Ok(KayitGorunumu { kayit, bekleyen: gidecek, ertelenen })
    }
}

pub(crate) fn liste(d: &Depo, sorgu: &ListeSorgusu) -> Result<Vec<KayitGorunumu>, CekirdekHatasi> {
    let c = Gorunumcu::ac(d)?;
    d.gorunen_liste(&suzgec(sorgu))?.into_iter().map(|g| c.gorunum(d, g.kayit, g.bekleyen)).collect()
}

pub(crate) fn kayit(d: &Depo, kayit_id: &str) -> Result<Option<KayitGorunumu>, CekirdekHatasi> {
    let c = Gorunumcu::ac(d)?;
    d.gorunen_kayit(kayit_id)?.map(|g| c.gorunum(d, g.kayit, g.bekleyen)).transpose()
}

/// İşlemin v3 alanlarındaki değişikliğinin okunur hali (`RetGirdisi.v3_degisikligi`): `guncelle`'de
/// değişiklik, `ekle`'de konan v3 alanları. v3 alanına dokunmayan işlemde yok.
pub(crate) fn v3_ozeti(islem: &AjandaIslem) -> Option<V3DegisiklikOzeti> {
    let d = match islem {
        AjandaIslem::Guncelle { degisiklik, .. } => degisiklik.v3.clone(),
        AjandaIslem::Ekle { v3, .. } => v3.degisiklik(),
        _ => return None,
    };
    if d.bos_mu() {
        return None;
    }
    fn al<T>(a: Alan<T>, ad: &str, kaldirilan: &mut Vec<String>) -> Option<T> {
        match a {
            Alan::Deger(v) => Some(v),
            Alan::Kaldir => {
                kaldirilan.push(ad.to_string());
                None
            }
            Alan::Yok => None,
        }
    }
    let mut k = Vec::new();
    let konan = V3Alanlari {
        simge: al(d.simge, "simge", &mut k),
        bolge: al(d.bolge, "bolge", &mut k),
        bolge_konumu: al(d.bolge_konumu, "bolge_konumu", &mut k),
        varis: al(d.varis, "varis", &mut k),
        baglantilar: al(d.baglantilar, "baglantilar", &mut k).unwrap_or_default(),
        ekler: al(d.ekler, "ekler", &mut k).unwrap_or_default(),
    };
    Some(V3DegisiklikOzeti { konan, kaldirilan: k })
}

/// Ret listesi, eskiden yeniye. Çözülemeyen satır da gösterilir (hiçbir işlem sessizce kaybolmaz):
/// türü okunamazsa `guncelle`, nedeni okunamazsa `gecersiz_islem` sayılır, gövdesi ve v3 özeti yoktur. Kullanıcının
/// attığı ertelenen v3 değişikliği (`ERTELENEN_ATILDI`, daha önce yollanmışsa `ERTELENEN_ATILDI_YOLLANMIS`)
/// `teslim_edilemedi` ve `ertelenen_atildi` ile (ikincisi `ulasmis_olabilir` ile de) gelir. Her girdinin v3
/// değişikliği `v3_degisikligi`'ndedir (`v3_ozeti`).
pub(crate) fn ret_listesi(d: &Depo) -> Result<Vec<RetGirdisi>, CekirdekHatasi> {
    Ok(d.ret_listesi()?
        .into_iter()
        .map(|r| {
            let islem_degeri: Option<serde_json::Value> = serde_json::from_str(&r.islem_json).ok();
            let islem = islem_degeri
                .as_ref()
                .and_then(|v| v.get("islem"))
                .and_then(|v| v.as_str())
                .and_then(IslemTuru::coz)
                .unwrap_or(IslemTuru::Guncelle);
            let govde = r.govde_json.as_deref().and_then(|j| {
                let v: serde_json::Value = serde_json::from_str(j).ok()?;
                let mut n = crate::model::json::Nesne::ac(&v, "").ok()?;
                let g = KayitGovdesi::alanlari_oku(&mut n).ok()?;
                n.bitir().ok()?;
                Some(g)
            });
            let ertelenen_atildi = ertelenen_atildi_mi(&r.neden);
            let v3_degisikligi = atilan_coz(&r.islem_json).and_then(|(i, _)| v3_ozeti(&i));
            let neden = if ertelenen_atildi {
                KuyrukRetNedeni::TeslimEdilemedi
            } else {
                KuyrukRetNedeni::coz(&r.neden).unwrap_or(KuyrukRetNedeni::GecersizIslem)
            };
            RetGirdisi {
                islem_id: r.islem_id,
                kayit_id: r.kayit_id,
                islem,
                neden,
                govde,
                ts_ms: r.ts_ms,
                ertelenen_atildi,
                v3_degisikligi,
                ulasmis_olabilir: r.neden == ERTELENEN_ATILDI_YOLLANMIS,
            }
        })
        .collect())
}

impl Motor {
    /// Yerel kipte geçmiş yerel tablodan hemen yüklenir (bağlantı gerekmez; `motor/yerel.rs`).
    /// Bağlı kipte canlıysa `gecmis_iste` yollar (yoksa `GecersizDurum`); yanıt `gecmis` çerçevesiyle gelir,
    /// önbelleğe yazılır, gözlemciye `Degisim.gecmis` ile haber verilir. `once_rev` yoksa önbellekteki
    /// sayfalar atılır (baştan yükleme); varsa yanıt öncekilerin arkasına eklenir.
    pub(crate) fn gecmis_iste(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str, once_rev: Option<i64>) -> Result<(), CekirdekHatasi> {
        if !opak_id_mi(kayit_id) {
            return Err(CekirdekHatasi::GecersizGirdi { alan: "kayit_id".into(), neden: "geçersiz kimlik".into() });
        }
        if once_rev.is_some_and(|r| r < 1) {
            return Err(CekirdekHatasi::GecersizGirdi { alan: "once_rev".into(), neden: "revizyon 1'den küçük".into() });
        }
        if self.yerel_mi()? {
            return self.yerel_gecmis_iste(e, kayit_id, once_rev);
        }
        if !self.canli_mi() {
            return Err(CekirdekHatasi::GecersizDurum { mesaj: "bağlantı canlı değil".into() });
        }
        let istek_id = Motor::yeni_kimlik(o, "g_")?;
        self.gecmis_istekleri.insert(istek_id.clone(), (kayit_id.to_string(), o.simdi_ms(), std::time::Instant::now()));
        let sayfa = self.gecmis.entry(kayit_id.to_string()).or_insert_with(|| GecmisSayfasi {
            kayit_id: kayit_id.to_string(),
            satirlar: Vec::new(),
            devami: false,
            yukleniyor: false,
            hata: None,
        });
        if once_rev.is_none() {
            sayfa.satirlar.clear();
            sayfa.devami = false;
        }
        sayfa.yukleniyor = true;
        sayfa.hata = None;
        e.gonderilecek.push(AjandaYukari::GecmisIste { istek_id, kayit_id: kayit_id.to_string(), once_rev }.kodla_surum(self.baglanti_surumu()));
        e.degisim.gecmis.push(kayit_id.to_string());
        Ok(())
    }

    /// Önbellekteki geçmiş (bellek içi; süreç ölünce gider).
    pub(crate) fn gecmis(&self, kayit_id: &str) -> Result<Option<GecmisSayfasi>, CekirdekHatasi> {
        Ok(self.gecmis.get(kayit_id).cloned())
    }
}
