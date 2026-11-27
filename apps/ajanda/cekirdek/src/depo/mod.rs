//! SAHİBİ: R4. Yerel SQLite deposu (tek yazar bağlantı, WAL). Köprüden habersizdir; model tipleri konuşur.
//! Alt dosyalar `impl Depo` bloklarıdır, her biri bir tabloya bakar:
//! - `gorunen.rs` (R4): görünen kopya (arayüz ve alarmlar yalnız bunu okur). Okuma imzaları sabittir.
//! - `kopya.rs` (R4): sunucu kopyası, süren tam telafinin toplananları, `depo_id`/`son_rev`, `hello` alanları.
//! - `kuyruk.rs` (R4): kalıcı işlem kuyruğu ve kullanıcının ret listesi.
//! - `alarmlar.rs` (R3): kurulu alarmlar.
//! - `yerel.rs` (D1): kip durumu, yerel revizyon sayacı, yerel geçmiş.
//!
//! Yazma kuralı: motor birden çok tabloya dokunan her değişikliği `yazma` ile tek SQLite işleminde yapar
//! (hata ya da panikte hiçbiri kalmaz); etkiler (`motor::Etkiler`) ancak işlem kalıcı olduktan sonra
//! yazılır. R3'ün alarm yazmaları savepoint'tir ve motor onları kendi işlemi bittikten SONRA çağırır.

mod alarmlar;
mod gorunen;
mod kopya;
mod kuyruk;
mod sema;
mod yerel;

pub use alarmlar::KuruluAlarm;
pub use gorunen::{GorunenKayit, GorunenSuzgec, TakvimAdayAraligi};
pub use kopya::{KopyaSatiri, KopyaTablosu};
pub use kuyruk::{KuyrukSatiri, RetSatiri};
pub use yerel::{KIP_BAGLI, KIP_YEREL};

use crate::hata::CekirdekHatasi;
use rusqlite::Connection;

/// `meta` anahtarları (tekil değerler).
pub mod anahtar {
    /// Sunucu kopyasının depo kimliği (`welcome.depo_id`).
    pub const DEPO_ID: &str = "depo_id";
    /// Sunucu kopyasının ulaştığı en büyük revizyon (`hello.son_rev`).
    pub const SON_REV: &str = "son_rev";
    /// Son `esitlendi`'nin yerel zamanı (ms).
    pub const SON_ESITLENME_MS: &str = "son_esitlenme_ms";
    /// Bitmiş eşleşme (JSON: `device_id`, `host`, `port`, `server_public_key`).
    pub const ESLESME: &str = "eslesme";
    /// Okunmuş, sonucu bekleyen eşleştirme QR'ı (JSON, `AjandaEslestirmeQr`).
    pub const ESLESTIRME_QR: &str = "eslestirme_qr";
    /// Son eşleştirmenin reddi (`pair_result.code`).
    pub const ESLESME_REDDI: &str = "eslesme_reddi";
    /// Alarm ufku (R3, `motor/alarm.rs`): bütçeyi aşan planda kurulan en uzak tetik (`"<tetik_ms> <kayit_id>"`);
    /// yoksa bütün plan kurulu, ertelenen tetik yok.
    pub const ALARM_UFKU: &str = "alarm_ufku";
    /// Çalışma kipi (göç 4): `yerel` ya da `bagli` (`depo/yerel.rs`).
    pub const KIP: &str = "kip";
    /// Yerel kipte son verilen revizyon (`depo/yerel.rs`, `yerel_rev_sonraki`).
    pub const YEREL_REV: &str = "yerel_rev";
    /// Bağlı kipten yerel kipe son geçişin özeti (D2, JSON; `motor/yerel.rs` `gecis_json`).
    pub const SON_GECIS: &str = "son_gecis";
    /// Açılış onarımının son hatası (JSON: `ts_ms`, `mesaj`; `motor/yerel.rs` `acilis_onarimi`). Onarım
    /// sonraki açılışta başarılı olunca silinir.
    pub const ONARIM_HATASI: &str = "onarim_hatasi";
}

pub struct Depo {
    baglanti: Connection,
}

/// Açık yazma işlemi; bırakılmadan düşerse (hata ya da panik) geri alınır.
struct YazmaIslemi<'a> {
    depo: &'a Depo,
    bitti: bool,
}

impl Drop for YazmaIslemi<'_> {
    fn drop(&mut self) {
        if !self.bitti {
            let _ = self.depo.baglanti.execute_batch("ROLLBACK");
        }
    }
}

impl Depo {
    /// `yol` bir dosya yolu ya da testler için `":memory:"`.
    pub fn ac(yol: &str) -> rusqlite::Result<Self> {
        let baglanti = Connection::open(yol)?;
        // WAL: arayüz okurken alarm alıcısı yazabilsin. Bellek içi veritabanında "memory" döner.
        let _mod: String = baglanti.query_row("PRAGMA journal_mode=WAL", [], |s| s.get(0))?;
        baglanti.pragma_update(None, "foreign_keys", true)?;
        // Aynı dosyaya ikinci bağlantı (okuyucu, test) varken kısa kilit çakışması hata olmasın.
        baglanti.busy_timeout(std::time::Duration::from_secs(5))?;
        let mut depo = Depo { baglanti };
        depo.goc_et()?;
        Ok(depo)
    }

    /// Aynı dosyaya ikinci (yalnız okuyan) bağlantı: arayüz sorguları yazma sürerken son kalıcı hali okur
    /// (WAL). Göç yapmaz; yazan bağlantı (`ac`) önce açılmış olmalıdır. Bellek içi veritabanında anlamsızdır
    /// (ikinci bağlantı başka bir veritabanı olur): `None`.
    pub fn okuyucu_ac(yol: &str) -> rusqlite::Result<Option<Self>> {
        if yol.is_empty() || yol == ":memory:" || yol.starts_with("file::memory:") {
            return Ok(None);
        }
        let baglanti = Connection::open(yol)?;
        baglanti.busy_timeout(std::time::Duration::from_secs(5))?;
        baglanti.pragma_update(None, "query_only", true)?;
        Ok(Some(Depo { baglanti }))
    }

    fn goc_et(&mut self) -> rusqlite::Result<()> {
        let mevcut: usize = self.baglanti.query_row("PRAGMA user_version", [], |s| s.get::<_, i64>(0))? as usize;
        if mevcut >= sema::GOCLER.len() {
            return Ok(());
        }
        let islem = self.baglanti.transaction()?;
        for sql in &sema::GOCLER[mevcut..] {
            islem.execute_batch(sql)?;
        }
        islem.pragma_update(None, "user_version", sema::GOCLER.len() as i64)?;
        islem.commit()
    }

    pub fn sema_surumu(&self) -> rusqlite::Result<i64> {
        self.baglanti.query_row("PRAGMA user_version", [], |s| s.get(0))
    }

    /// Bir yazma dizisini tek SQLite işleminde çalıştırır (hata olursa hiçbiri yazılmaz).
    pub fn islemde<T>(&mut self, f: impl FnOnce(&rusqlite::Transaction<'_>) -> rusqlite::Result<T>) -> rusqlite::Result<T> {
        let islem = self.baglanti.transaction()?;
        let sonuc = f(&islem)?;
        islem.commit()?;
        Ok(sonuc)
    }

    /// `f`'in bütün yazmalarını tek işlemde yapar (`BEGIN IMMEDIATE` .. `COMMIT`); `f` hata dönerse ya da
    /// paniklerse hiçbiri kalmaz. `f` `Depo` yöntemlerini çağırabilir; iç içe `yazma` açılmaz (SQLite
    /// iç içe `BEGIN`'i reddeder). Döndüğünde değişiklik kalıcıdır.
    pub fn yazma<T>(&self, f: impl FnOnce(&Depo) -> Result<T, CekirdekHatasi>) -> Result<T, CekirdekHatasi> {
        self.islem_baslat()?;
        let mut islem = YazmaIslemi { depo: self, bitti: false };
        let sonuc = f(self)?;
        self.baglanti.execute_batch("COMMIT")?;
        islem.bitti = true;
        Ok(sonuc)
    }

    /// Elle işlem başlatır (`BEGIN IMMEDIATE`). Yalnız `&Depo` dışında bir şeye (motorun kendisine)
    /// ihtiyaç duyan yazma dizileri için: çağıran `islem_bitir` ya da `islem_geri_al`'ı paniğe karşı da
    /// garanti etmelidir. Önceki bir panikten açık kalmış işlem varsa önce geri alınır.
    pub fn islem_baslat(&self) -> Result<(), CekirdekHatasi> {
        if !self.baglanti.is_autocommit() {
            self.baglanti.execute_batch("ROLLBACK")?;
        }
        self.baglanti.execute_batch("BEGIN IMMEDIATE")?;
        Ok(())
    }

    pub fn islem_bitir(&self) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute_batch("COMMIT")?;
        Ok(())
    }

    pub fn islem_geri_al(&self) {
        if !self.baglanti.is_autocommit() {
            let _ = self.baglanti.execute_batch("ROLLBACK");
        }
    }

    /// Tekil değer okur (`meta`).
    pub fn meta_oku(&self, anahtar: &str) -> rusqlite::Result<Option<String>> {
        use rusqlite::OptionalExtension;
        self.baglanti.query_row("SELECT deger FROM meta WHERE anahtar = ?1", [anahtar], |s| s.get(0)).optional()
    }

    /// Tekil değer yazar; `None` siler.
    pub fn meta_yaz(&self, anahtar: &str, deger: Option<&str>) -> rusqlite::Result<()> {
        match deger {
            Some(d) => self.baglanti.execute(
                "INSERT INTO meta (anahtar, deger) VALUES (?1, ?2) ON CONFLICT (anahtar) DO UPDATE SET deger = excluded.deger",
                [anahtar, d],
            )?,
            None => self.baglanti.execute("DELETE FROM meta WHERE anahtar = ?1", [anahtar])?,
        };
        Ok(())
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn goc_bir_kez_uygulanir_ve_dosyada_kalici() {
        let yol = std::env::temp_dir().join(format!(
            "ajanda-depo-test-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let yol_str = yol.to_str().unwrap();
        {
            let depo = Depo::ac(yol_str).unwrap();
            assert_eq!(depo.sema_surumu().unwrap(), sema::GOCLER.len() as i64);
            depo.meta_yaz("depo_id", Some("d_a")).unwrap();
        }
        let depo = Depo::ac(yol_str).unwrap();
        assert_eq!(depo.sema_surumu().unwrap(), sema::GOCLER.len() as i64);
        assert_eq!(depo.meta_oku("depo_id").unwrap().as_deref(), Some("d_a"));
        depo.meta_yaz("depo_id", None).unwrap();
        assert_eq!(depo.meta_oku("depo_id").unwrap(), None);
        drop(depo);
        for ek in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{yol_str}{ek}"));
        }
    }

    #[test]
    fn yazma_hatada_ve_panikte_geri_alinir() {
        let d = Depo::ac(":memory:").unwrap();
        let r: Result<(), CekirdekHatasi> = d.yazma(|d| {
            d.meta_yaz("a", Some("1"))?;
            Err(CekirdekHatasi::GecersizDurum { mesaj: "deneme".into() })
        });
        assert!(r.is_err());
        assert_eq!(d.meta_oku("a").unwrap(), None);
        let p = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = d.yazma(|d| -> Result<(), CekirdekHatasi> {
                d.meta_yaz("a", Some("1"))?;
                panic!("deneme");
            });
        }));
        assert!(p.is_err());
        assert_eq!(d.meta_oku("a").unwrap(), None);
        d.yazma(|d| Ok(d.meta_yaz("a", Some("2"))?)).unwrap();
        assert_eq!(d.meta_oku("a").unwrap().as_deref(), Some("2"));
    }
}
