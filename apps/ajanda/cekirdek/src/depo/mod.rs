//! SAHİBİ: R4. Yerel SQLite deposu (tek bağlantı, WAL). Köprüden habersizdir; model tipleri konuşur.
//! Alt dosyalar `impl Depo` bloklarıdır, her biri bir tabloya bakar:
//! - `gorunen.rs` (R4): görünen kopya (arayüz ve alarmlar yalnız bunu okur). Okuma imzaları sabittir.
//! - `alarmlar.rs` (R3): kurulu alarmlar.
//!
//! R4 sunucu kopyası, telafi, kuyruk, ret listesi ve meta için yeni dosyalar ekleyebilir (bu dosya R4'ün).

mod alarmlar;
mod gorunen;
mod sema;

pub use alarmlar::KuruluAlarm;
pub use gorunen::{GorunenKayit, GorunenSuzgec};

use rusqlite::Connection;

pub struct Depo {
    baglanti: Connection,
}

impl Depo {
    /// `yol` bir dosya yolu ya da testler için `":memory:"`.
    pub fn ac(yol: &str) -> rusqlite::Result<Self> {
        let baglanti = Connection::open(yol)?;
        // WAL: arayüz okurken alarm alıcısı yazabilsin. Bellek içi veritabanında "memory" döner.
        let _mod: String = baglanti.query_row("PRAGMA journal_mode=WAL", [], |s| s.get(0))?;
        baglanti.pragma_update(None, "foreign_keys", true)?;
        let mut depo = Depo { baglanti };
        depo.goc_et()?;
        Ok(depo)
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
}
