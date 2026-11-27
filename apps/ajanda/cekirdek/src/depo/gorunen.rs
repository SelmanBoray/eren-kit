//! SAHİBİ: R4. Görünen kopya (`gorunen` tablosu): sunucu kopyası + kuyruktaki işlemlerin iyimser
//! uygulaması. Arayüz sorguları ve alarm planı (R3) yalnız bunu okur; tam telafi sürerken değişmez.
//! Yerel kipte (göç 4, `depo/yerel.rs`) türetme değil doğruluk kaynağıdır: yerel yazar doğrudan yazar,
//! `bekleyen` hep yanlıştır.
//! Okuma imzaları (`gorunen_kayit`, `gorunen_liste`, `etkin_kayitlar`) R3 ve köprü için sabittir.
//!
//! Satırdaki kayıt şemadan geçmiş `AjandaKaydi`'dir. Henüz servise ulaşmamış `ekle`'nin iyimser hali de
//! geçerli bir kayıt olmalıdır (R4: revizyon 1, kaynak `{yol: girdi_yolu, tur_kokeni: insan,
//! device_id}`, zamanlar şimdi) ve `bekleyen` doğrudur.

use super::Depo;
use crate::model::{AjandaKaydi, AjandaZamani};
use rusqlite::{OptionalExtension, params};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GorunenKayit {
    pub kayit: AjandaKaydi,
    /// Kuyrukta bu kayda ait, sonucu gelmemiş işlem var (iyimser hal).
    pub bekleyen: bool,
}

/// Liste süzgeci. `tarihli`: `Some(true)` zamanı `an`/`gun`/`donem`, `Some(false)` zamansız ya da
/// `belirsiz`. `silinenler`: yalnız mezar taşları (yoksa mezar taşı hiç gelmez). `yalniz_taslak`.
/// `kapalilar_dahil`: `tamam`/`iptal` de gelsin.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GorunenSuzgec {
    pub tarihli: Option<bool>,
    pub silinenler: bool,
    pub yalniz_taslak: bool,
    pub kapalilar_dahil: bool,
}

/// Takvim adaylarının aralığı (`gorunen_takvim_adaylari`). Tarihler `YYYY-MM-DD` metnidir ve sıra
/// anahtarıyla (`tarih` + `T`/boşluk) metin olarak karşılaştırılır; yıl sınırı dışına taşabilir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TakvimAdayAraligi {
    /// İlk günü bundan önce olmayanlar (dahil).
    pub alt: String,
    /// İlk günü bundan önce olanlar (hariç).
    pub ust: String,
    /// `alt`'tan önce başlayan dönemler için en erken başlangıç (dahil).
    pub donem_alt: String,
    /// `alt`'tan önce başlayan dönemin bitişi bundan önce olmamalı (dahil).
    pub donem_bitis_alt: String,
    pub kapalilar_dahil: bool,
}

/// Tarihlilerin sırası: ilk gün, aynı günde gün boyu olan (`gun`, `donem`) önce, sonra saat.
fn sira_anahtari(zaman: Option<&AjandaZamani>) -> (bool, String) {
    match zaman {
        Some(AjandaZamani::An { tarih, saat, .. }) => (true, format!("{tarih}T{saat}")),
        Some(AjandaZamani::Gun { tarih, .. }) => (true, format!("{tarih} ")),
        Some(AjandaZamani::Donem { baslangic, .. }) => (true, format!("{baslangic} ")),
        Some(AjandaZamani::Belirsiz { .. }) | None => (false, String::new()),
    }
}

fn satir_oku(json: &str, bekleyen: bool) -> rusqlite::Result<GorunenKayit> {
    let deger: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
    let kayit = AjandaKaydi::oku(&deger, "").map_err(|h| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("görünen kayıt şemadan geçmedi: {} ({})", h.yol, h.neden).into(),
        )
    })?;
    Ok(GorunenKayit { kayit, bekleyen })
}

impl Depo {
    /// Kaydın görünen halini yazar (yoksa ekler).
    pub fn gorunen_yaz(&self, kayit: &AjandaKaydi, bekleyen: bool) -> rusqlite::Result<()> {
        let (tarihli, sira) = sira_anahtari(kayit.zaman.as_ref());
        self.baglanti.execute(
            "INSERT INTO gorunen (kayit_id, json, tarihli, sira_anahtari, taslak, silindi, acik, etkin, bekleyen, olusturma_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT (kayit_id) DO UPDATE SET json = excluded.json, tarihli = excluded.tarihli,
               sira_anahtari = excluded.sira_anahtari, taslak = excluded.taslak, silindi = excluded.silindi,
               acik = excluded.acik, etkin = excluded.etkin, bekleyen = excluded.bekleyen,
               olusturma_ms = excluded.olusturma_ms",
            params![
                kayit.kayit_id,
                kayit.json().to_string(),
                tarihli,
                sira,
                kayit.taslak,
                kayit.silindi,
                kayit.durum == crate::model::KayitDurumu::Acik,
                kayit.hatirlatma_etkin_mi(),
                bekleyen,
                kayit.olusturma_ms,
            ],
        )?;
        Ok(())
    }

    /// Kaydı görünen kopyadan tamamen çıkarır (tam telafide gelmeyen kayıt, geri alınan iyimser `ekle`).
    pub fn gorunen_sil(&self, kayit_id: &str) -> rusqlite::Result<()> {
        self.baglanti.execute("DELETE FROM gorunen WHERE kayit_id = ?1", [kayit_id])?;
        Ok(())
    }

    pub fn gorunen_kayit(&self, kayit_id: &str) -> rusqlite::Result<Option<GorunenKayit>> {
        let satir: Option<(String, bool)> = self
            .baglanti
            .query_row("SELECT json, bekleyen FROM gorunen WHERE kayit_id = ?1", [kayit_id], |s| {
                Ok((s.get(0)?, s.get(1)?))
            })
            .optional()?;
        satir.map(|(json, bekleyen)| satir_oku(&json, bekleyen)).transpose()
    }

    /// Satırın ham hali (kayıt JSON metni, bekleyen): değişiklik var mı karşılaştırması ayrıştırmadan yapılır.
    pub fn gorunen_ham(&self, kayit_id: &str) -> rusqlite::Result<Option<(String, bool)>> {
        self.baglanti
            .query_row("SELECT json, bekleyen FROM gorunen WHERE kayit_id = ?1", [kayit_id], |s| Ok((s.get(0)?, s.get(1)?)))
            .optional()
    }

    /// Süzgece uyan kayıtlar. Tarihliler `sira_anahtari` artan, eşitlikte oluşturma artan; ötekiler
    /// oluşturma azalan (en yeni üstte).
    pub fn gorunen_liste(&self, s: &GorunenSuzgec) -> rusqlite::Result<Vec<GorunenKayit>> {
        let mut kosullar = vec![if s.silinenler { "silindi = 1" } else { "silindi = 0" }];
        match s.tarihli {
            Some(true) => kosullar.push("tarihli = 1"),
            Some(false) => kosullar.push("tarihli = 0"),
            None => {}
        }
        if s.yalniz_taslak {
            kosullar.push("taslak = 1");
        }
        if !s.kapalilar_dahil {
            kosullar.push("acik = 1");
        }
        let sira = if s.tarihli == Some(true) { "sira_anahtari ASC, olusturma_ms ASC" } else { "olusturma_ms DESC" };
        let sql = format!("SELECT json, bekleyen FROM gorunen WHERE {} ORDER BY {sira}, kayit_id", kosullar.join(" AND "));
        let mut sorgu = self.baglanti.prepare(&sql)?;
        let satirlar = sorgu.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))?;
        satirlar.map(|s| s.and_then(|(json, bekleyen)| satir_oku(&json, bekleyen))).collect()
    }

    /// Takvim penceresinin adayları (yerleştirme ve son süzme `motor/takvim.rs`'te): silinmemiş tarihli
    /// kayıtlardan sıra anahtarı (ilk gün) `[alt, ust)` içinde olanlar, `donem_alt`'tan sonra başlayıp bitişi
    /// `donem_bitis_alt`'tan önce olmayan dönemler ve ilk günü `ust`'ten önce olan bütün tekrar edenler.
    /// `kapalilar_dahil` yanlışsa yalnız durumu `acik` olanlar. Sıra yoktur (çağıran sıralar). Göç
    /// gerektirmez (şema 3 kalır): `gorunen_liste` dizinindeki sıra anahtarı aralığı + `json_extract`. Bedeli
    /// `ust`'ten önceki her satırın okunmasıdır (20000 kayıtta ~20 ms, masaüstü); tekrar eden ve dönem satırları
    /// için kısmi dizin bunu pencere kadarına indirir ama yeni göç ister (MIMARI.md "Takvim sekmesi").
    pub fn gorunen_takvim_adaylari(&self, a: &TakvimAdayAraligi) -> rusqlite::Result<Vec<GorunenKayit>> {
        let acik = if a.kapalilar_dahil { "" } else { "AND acik = 1" };
        let sql = format!(
            "SELECT json, bekleyen FROM gorunen
             WHERE silindi = 0 AND tarihli = 1 {acik} AND sira_anahtari < ?1
               AND (sira_anahtari >= ?2
                    OR (sira_anahtari >= ?3 AND json_extract(json, '$.zaman.bitis') >= ?4)
                    OR json_extract(json, '$.tekrar') IS NOT NULL)"
        );
        let mut sorgu = self.baglanti.prepare_cached(&sql)?;
        let satirlar = sorgu.query_map(params![a.ust, a.alt, a.donem_alt, a.donem_bitis_alt], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?))
        })?;
        satirlar.map(|s| s.and_then(|(json, bekleyen)| satir_oku(&json, bekleyen))).collect()
    }

    /// Hatırlatması kurulabilecek kayıtlar (`hatirlatma_etkin_mi` doğru): alarm planı (R3) bunları okur.
    pub fn etkin_kayitlar(&self) -> rusqlite::Result<Vec<AjandaKaydi>> {
        let mut sorgu = self.baglanti.prepare("SELECT json, bekleyen FROM gorunen WHERE etkin = 1 ORDER BY kayit_id")?;
        let satirlar = sorgu.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))?;
        satirlar.map(|s| s.and_then(|(json, bekleyen)| satir_oku(&json, bekleyen).map(|g| g.kayit))).collect()
    }
}
