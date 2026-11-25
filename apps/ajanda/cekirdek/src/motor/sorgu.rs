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

use super::{Etkiler, Motor, Ortam};
use crate::depo::{Depo, GorunenSuzgec};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{GecmisSayfasi, KayitGorunumu, ListeSorgusu, RetGirdisi, Sekme};
use crate::model::metin::opak_id_mi;
use crate::model::{AjandaYukari, IslemTuru, KayitGovdesi, KuyrukRetNedeni};

fn suzgec(sorgu: &ListeSorgusu) -> GorunenSuzgec {
    let k = sorgu.kapalilar_dahil;
    match sorgu.sekme {
        Sekme::Tarihli => GorunenSuzgec { tarihli: Some(true), kapalilar_dahil: k, ..Default::default() },
        Sekme::Tarihsiz => GorunenSuzgec { tarihli: Some(false), kapalilar_dahil: k, ..Default::default() },
        Sekme::Taslaklar => GorunenSuzgec { yalniz_taslak: true, kapalilar_dahil: k, ..Default::default() },
        Sekme::Silinenler => GorunenSuzgec { silinenler: true, kapalilar_dahil: true, ..Default::default() },
    }
}

pub(crate) fn liste(d: &Depo, sorgu: &ListeSorgusu) -> Result<Vec<KayitGorunumu>, CekirdekHatasi> {
    Ok(d.gorunen_liste(&suzgec(sorgu))?.into_iter().map(|g| KayitGorunumu { kayit: g.kayit, bekleyen: g.bekleyen }).collect())
}

pub(crate) fn kayit(d: &Depo, kayit_id: &str) -> Result<Option<KayitGorunumu>, CekirdekHatasi> {
    Ok(d.gorunen_kayit(kayit_id)?.map(|g| KayitGorunumu { kayit: g.kayit, bekleyen: g.bekleyen }))
}

/// Ret listesi, eskiden yeniye. Çözülemeyen satır da gösterilir (hiçbir işlem sessizce kaybolmaz):
/// türü okunamazsa `guncelle`, nedeni okunamazsa `gecersiz_islem` sayılır, gövdesi yoktur.
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
            RetGirdisi {
                islem_id: r.islem_id,
                kayit_id: r.kayit_id,
                islem,
                neden: KuyrukRetNedeni::coz(&r.neden).unwrap_or(KuyrukRetNedeni::GecersizIslem),
                govde,
                ts_ms: r.ts_ms,
            }
        })
        .collect())
}

impl Motor {
    /// Canlıysa `gecmis_iste` yollar (yoksa `GecersizDurum`); yanıt `gecmis` çerçevesiyle gelir,
    /// önbelleğe yazılır, gözlemciye `Degisim.gecmis` ile haber verilir. `once_rev` yoksa önbellekteki
    /// sayfalar atılır (baştan yükleme); varsa yanıt öncekilerin arkasına eklenir.
    pub(crate) fn gecmis_iste(&mut self, o: &Ortam, e: &mut Etkiler, kayit_id: &str, once_rev: Option<i64>) -> Result<(), CekirdekHatasi> {
        if !opak_id_mi(kayit_id) {
            return Err(CekirdekHatasi::GecersizGirdi { alan: "kayit_id".into(), neden: "geçersiz kimlik".into() });
        }
        if once_rev.is_some_and(|r| r < 1) {
            return Err(CekirdekHatasi::GecersizGirdi { alan: "once_rev".into(), neden: "revizyon 1'den küçük".into() });
        }
        if !self.canli_mi() {
            return Err(CekirdekHatasi::GecersizDurum { mesaj: "bağlantı canlı değil".into() });
        }
        let istek_id = Motor::yeni_kimlik(o, "g_")?;
        self.gecmis_istekleri.insert(istek_id.clone(), kayit_id.to_string());
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
        e.gonderilecek.push(AjandaYukari::GecmisIste { istek_id, kayit_id: kayit_id.to_string(), once_rev }.kodla());
        e.degisim.gecmis.push(kayit_id.to_string());
        Ok(())
    }

    /// Önbellekteki geçmiş (bellek içi; süreç ölünce gider).
    pub(crate) fn gecmis(&self, kayit_id: &str) -> Result<Option<GecmisSayfasi>, CekirdekHatasi> {
        Ok(self.gecmis.get(kayit_id).cloned())
    }
}
