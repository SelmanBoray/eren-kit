//! SAHİBİ: R3. Kurulu alarmlar (`kurulu_alarmlar`): Android'e kurdurulan her tetik, teslim edilene
//! dek kalıcı (`kacirilanHatirlatmalar`'ın `kurulanlar`'ı buradan). `alarm_no` PendingIntent istek
//! kodudur (Kotlin `toInt()`).
//!
//! Satırın üç hali: teslim edilmemiş (`teslim_ms` boş: Android'de kurulu sayılır), teslim edilmiş
//! (çaldı ya da kaçırılan olarak gösterildi; pencere boyunca durur ki saat geri alınınca aynı tetik
//! yeniden kurulup ikinci kez çalmasın), silinmiş (artık planda yok, iptal edildi ya da kurulamadı).
//! Sözleşmenin "teslim edilene dek sakla"sı ilk haldir; ikinci hal yalnız çift teslimi önler.

use super::Depo;
use crate::hata::CekirdekHatasi;
use rusqlite::{OptionalExtension, Row, params};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KuruluAlarm {
    pub alarm_no: i64,
    pub kayit_id: String,
    pub tetik_ms: i64,
    pub ornek_tarihi: Option<String>,
    /// Teslim edildiyse (çaldı ya da kaçırılan olarak gösterildi) zamanı.
    pub teslim_ms: Option<i64>,
}

const SUTUNLAR: &str = "alarm_no, kayit_id, tetik_ms, ornek_tarihi, teslim_ms";

fn satir(r: &Row<'_>) -> rusqlite::Result<KuruluAlarm> {
    Ok(KuruluAlarm {
        alarm_no: r.get(0)?,
        kayit_id: r.get(1)?,
        tetik_ms: r.get(2)?,
        ornek_tarihi: r.get(3)?,
        teslim_ms: r.get(4)?,
    })
}

/// Açık savepoint; bırakılmadan düşerse (hata ya da panik) geri alınır.
struct Savepoint<'a> {
    depo: &'a Depo,
    bitti: bool,
}

impl Drop for Savepoint<'_> {
    fn drop(&mut self) {
        if !self.bitti {
            let _ = self.depo.baglanti.execute_batch("ROLLBACK TO r3_alarm; RELEASE r3_alarm;");
        }
    }
}

impl Depo {
    fn alarm_sorgusu(&self, kosul: &str, p: impl rusqlite::Params) -> Result<Vec<KuruluAlarm>, CekirdekHatasi> {
        let sql = format!("SELECT {SUTUNLAR} FROM kurulu_alarmlar WHERE {kosul} ORDER BY tetik_ms, alarm_no");
        let mut sorgu = self.baglanti.prepare(&sql)?;
        let satirlar = sorgu.query_map(p, satir)?;
        Ok(satirlar.collect::<rusqlite::Result<_>>()?)
    }

    /// Kaydın teslim edilmemiş kurulu alarmları.
    pub fn kurulu_alarmlar(&self, kayit_id: &str) -> Result<Vec<KuruluAlarm>, CekirdekHatasi> {
        self.alarm_sorgusu("kayit_id = ?1 AND teslim_ms IS NULL", [kayit_id])
    }

    /// Bütün teslim edilmemiş kurulu alarmlar (yeniden kurulum).
    pub fn tum_kurulu_alarmlar(&self) -> Result<Vec<KuruluAlarm>, CekirdekHatasi> {
        self.alarm_sorgusu("teslim_ms IS NULL", [])
    }

    /// Kaydın bütün alarm satırları, teslim edilmişler dahil (plan farkı bunlarla hesaplanır).
    pub fn kaydin_alarm_satirlari(&self, kayit_id: &str) -> Result<Vec<KuruluAlarm>, CekirdekHatasi> {
        self.alarm_sorgusu("kayit_id = ?1", [kayit_id])
    }

    /// Satırı olan kayıtların kimlikleri (görünen kopyadan düşmüş kayıtların alarmlarını bulmak için).
    pub fn alarmli_kayitlar(&self) -> Result<Vec<String>, CekirdekHatasi> {
        let mut sorgu = self.baglanti.prepare("SELECT DISTINCT kayit_id FROM kurulu_alarmlar ORDER BY kayit_id")?;
        let satirlar = sorgu.query_map([], |r| r.get(0))?;
        Ok(satirlar.collect::<rusqlite::Result<_>>()?)
    }

    /// `(kayit_id, tetik_ms)` için alarm satırı açar ya da var olanı (teslim edilmiş olsa da) döner.
    pub fn alarm_kaydet(&self, kayit_id: &str, tetik_ms: i64, ornek_tarihi: Option<&str>) -> Result<KuruluAlarm, CekirdekHatasi> {
        self.baglanti.execute(
            "INSERT INTO kurulu_alarmlar (kayit_id, tetik_ms, ornek_tarihi) VALUES (?1, ?2, ?3)
             ON CONFLICT (kayit_id, tetik_ms) DO NOTHING",
            params![kayit_id, tetik_ms, ornek_tarihi],
        )?;
        Ok(self.baglanti.query_row(
            &format!("SELECT {SUTUNLAR} FROM kurulu_alarmlar WHERE kayit_id = ?1 AND tetik_ms = ?2"),
            params![kayit_id, tetik_ms],
            satir,
        )?)
    }

    pub fn alarm_no_ile(&self, alarm_no: i64) -> Result<Option<KuruluAlarm>, CekirdekHatasi> {
        Ok(self
            .baglanti
            .query_row(&format!("SELECT {SUTUNLAR} FROM kurulu_alarmlar WHERE alarm_no = ?1"), [alarm_no], satir)
            .optional()?)
    }

    /// Teslim edildi işaretler; zaten teslim edilmişse ilk zaman kalır.
    pub fn alarm_teslim_edildi(&self, alarm_no: i64, ts_ms: i64) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute(
            "UPDATE kurulu_alarmlar SET teslim_ms = ?2 WHERE alarm_no = ?1 AND teslim_ms IS NULL",
            params![alarm_no, ts_ms],
        )?;
        Ok(())
    }

    /// Teslim işaretini kaldırır (R4: kaçırılan özeti Android'de gösterilemedi; satır yeniden "kurulu,
    /// teslim edilmemiş" olur, sonraki senkron ya da yeniden kurulum pencere içindeyse yeniden gösterir).
    pub fn alarm_teslimi_geri_al(&self, alarm_no: i64) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("UPDATE kurulu_alarmlar SET teslim_ms = NULL WHERE alarm_no = ?1", [alarm_no])?;
        Ok(())
    }

    pub fn alarm_sil(&self, alarm_no: i64) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("DELETE FROM kurulu_alarmlar WHERE alarm_no = ?1", [alarm_no])?;
        Ok(())
    }

    /// Tetiği `sinir_ms`'ten eski (ya da eşit) teslim edilmiş satırları siler: artık çift teslimi önlemezler.
    pub fn eski_teslimleri_sil(&self, sinir_ms: i64) -> Result<usize, CekirdekHatasi> {
        Ok(self
            .baglanti
            .execute("DELETE FROM kurulu_alarmlar WHERE teslim_ms IS NOT NULL AND tetik_ms <= ?1", [sinir_ms])?)
    }

    /// `f`'in alarm yazmalarını tek savepoint'te yapar: hata (ya da panik) olursa hiçbiri kalmaz.
    /// Savepoint iç içe geçebilir; çağıranın (R4) açık bir işlemi varsa onun parçası olur.
    pub fn alarm_islemi<T>(&self, f: impl FnOnce(&Depo) -> Result<T, CekirdekHatasi>) -> Result<T, CekirdekHatasi> {
        self.baglanti.execute_batch("SAVEPOINT r3_alarm")?;
        let mut sp = Savepoint { depo: self, bitti: false };
        let sonuc = f(self)?;
        self.baglanti.execute_batch("RELEASE r3_alarm")?;
        sp.bitti = true;
        Ok(sonuc)
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    fn depo() -> Depo {
        Depo::ac(":memory:").unwrap()
    }

    #[test]
    fn kaydet_ayni_kimlige_ayni_numarayi_doner() {
        let d = depo();
        let a = d.alarm_kaydet("k_a", 1_000, None).unwrap();
        let b = d.alarm_kaydet("k_a", 1_000, Some("2026-11-25")).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.ornek_tarihi, None);
        let c = d.alarm_kaydet("k_a", 2_000, Some("2026-11-26")).unwrap();
        assert_ne!(a.alarm_no, c.alarm_no);
        let e = d.alarm_kaydet("k_b", 1_000, None).unwrap();
        assert_ne!(a.alarm_no, e.alarm_no);
        assert_eq!(d.kurulu_alarmlar("k_a").unwrap(), vec![a.clone(), c.clone()]);
        assert_eq!(d.tum_kurulu_alarmlar().unwrap().len(), 3);
        assert_eq!(d.alarmli_kayitlar().unwrap(), vec!["k_a".to_string(), "k_b".to_string()]);
    }

    #[test]
    fn teslim_edilen_kurulu_sayilmaz_ama_satiri_kalir() {
        let d = depo();
        let a = d.alarm_kaydet("k_a", 1_000, None).unwrap();
        d.alarm_teslim_edildi(a.alarm_no, 1_500).unwrap();
        d.alarm_teslim_edildi(a.alarm_no, 9_999).unwrap();
        assert!(d.kurulu_alarmlar("k_a").unwrap().is_empty());
        assert!(d.tum_kurulu_alarmlar().unwrap().is_empty());
        let s = d.alarm_no_ile(a.alarm_no).unwrap().unwrap();
        assert_eq!(s.teslim_ms, Some(1_500));
        assert_eq!(d.kaydin_alarm_satirlari("k_a").unwrap(), vec![s.clone()]);
        // Aynı kimlik yeniden istenirse teslim edilmiş satır döner (yeniden kurulmaz).
        assert_eq!(d.alarm_kaydet("k_a", 1_000, None).unwrap(), s);
        assert_eq!(d.eski_teslimleri_sil(999).unwrap(), 0);
        assert_eq!(d.eski_teslimleri_sil(1_000).unwrap(), 1);
        assert_eq!(d.alarm_no_ile(a.alarm_no).unwrap(), None);
    }

    #[test]
    fn silinen_numara_yeniden_kullanilmaz() {
        let d = depo();
        let a = d.alarm_kaydet("k_a", 1_000, None).unwrap();
        d.alarm_sil(a.alarm_no).unwrap();
        assert_eq!(d.alarm_no_ile(a.alarm_no).unwrap(), None);
        let b = d.alarm_kaydet("k_a", 1_000, None).unwrap();
        assert!(b.alarm_no > a.alarm_no, "AUTOINCREMENT: geç gelen eski PendingIntent yeni satırı bulmasın");
    }

    #[test]
    fn alarm_islemi_hatada_ve_panikte_geri_alinir_ic_ice_calisir() {
        let mut d = depo();
        let r: Result<(), CekirdekHatasi> = d.alarm_islemi(|d| {
            d.alarm_kaydet("k_a", 1_000, None)?;
            Err(CekirdekHatasi::GecersizDurum { mesaj: "deneme".into() })
        });
        assert!(r.is_err());
        assert!(d.tum_kurulu_alarmlar().unwrap().is_empty());

        let p = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = d.alarm_islemi(|d| -> Result<(), CekirdekHatasi> {
                d.alarm_kaydet("k_a", 1_000, None)?;
                panic!("deneme");
            });
        }));
        assert!(p.is_err());
        assert!(d.tum_kurulu_alarmlar().unwrap().is_empty());

        d.alarm_islemi(|d| d.alarm_kaydet("k_a", 1_000, None).map(|_| ())).unwrap();
        assert_eq!(d.tum_kurulu_alarmlar().unwrap().len(), 1);

        // Çağıranın açık işleminin içinde (R4) savepoint iç içe geçer; dış işlem geri alınırsa o da gider.
        d.islemde(|tx| {
            tx.execute("INSERT INTO kurulu_alarmlar (kayit_id, tetik_ms) VALUES ('k_b', 5)", [])?;
            Ok(())
        })
        .unwrap();
        d.baglanti.execute_batch("BEGIN").unwrap();
        d.alarm_islemi(|d| d.alarm_kaydet("k_c", 7, None).map(|_| ())).unwrap();
        d.baglanti.execute_batch("ROLLBACK").unwrap();
        assert_eq!(d.alarmli_kayitlar().unwrap(), vec!["k_a".to_string(), "k_b".to_string()]);
    }
}
