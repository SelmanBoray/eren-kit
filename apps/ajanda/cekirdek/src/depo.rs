//! Yerel SQLite deposu. Köprüden bağımsızdır; yalnız Rust türleri konuşur.

use rusqlite::{Connection, OptionalExtension, params};

/// Şema sürümü `PRAGMA user_version` içinde tutulur. Yeni göç eklerken
/// `GOCLER` dizisinin sonuna bir SQL ekle; eski adımlar asla değişmez.
const GOCLER: &[&str] = &[
    // 1: iskelet tablosu (köprü kanıtı)
    "CREATE TABLE kayit (
        kimlik INTEGER PRIMARY KEY,
        metin  TEXT NOT NULL,
        imza   BLOB
    );",
];

pub struct Depo {
    baglanti: Connection,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DepoKaydi {
    pub kimlik: i64,
    pub metin: String,
    pub imza: Option<Vec<u8>>,
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
        let mevcut: usize = self
            .baglanti
            .query_row("PRAGMA user_version", [], |s| s.get::<_, i64>(0))? as usize;
        if mevcut >= GOCLER.len() {
            return Ok(());
        }
        let islem = self.baglanti.transaction()?;
        for sql in &GOCLER[mevcut..] {
            islem.execute_batch(sql)?;
        }
        islem.pragma_update(None, "user_version", GOCLER.len() as i64)?;
        islem.commit()
    }

    pub fn sema_surumu(&self) -> rusqlite::Result<i64> {
        self.baglanti.query_row("PRAGMA user_version", [], |s| s.get(0))
    }

    pub fn yaz(&self, metin: &str, imza: Option<&[u8]>) -> rusqlite::Result<i64> {
        self.baglanti.execute(
            "INSERT INTO kayit (metin, imza) VALUES (?1, ?2)",
            params![metin, imza],
        )?;
        Ok(self.baglanti.last_insert_rowid())
    }

    pub fn oku(&self, kimlik: i64) -> rusqlite::Result<Option<DepoKaydi>> {
        self.baglanti
            .query_row(
                "SELECT kimlik, metin, imza FROM kayit WHERE kimlik = ?1",
                params![kimlik],
                |s| {
                    Ok(DepoKaydi {
                        kimlik: s.get(0)?,
                        metin: s.get(1)?,
                        imza: s.get(2)?,
                    })
                },
            )
            .optional()
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn yazilan_okunur() {
        let depo = Depo::ac(":memory:").unwrap();
        let k = depo.yaz("merhaba", Some(&[1, 2, 3])).unwrap();
        let okunan = depo.oku(k).unwrap().unwrap();
        assert_eq!(okunan.metin, "merhaba");
        assert_eq!(okunan.imza.as_deref(), Some(&[1u8, 2, 3][..]));
        assert_eq!(depo.oku(k + 1).unwrap(), None);
    }

    #[test]
    fn goc_bir_kez_uygulanir_ve_dosyada_kalici() {
        let yol = std::env::temp_dir().join(format!(
            "ajanda-depo-test-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let yol_str = yol.to_str().unwrap();
        let k = {
            let depo = Depo::ac(yol_str).unwrap();
            assert_eq!(depo.sema_surumu().unwrap(), GOCLER.len() as i64);
            depo.yaz("kalıcı", None).unwrap()
        };
        let depo = Depo::ac(yol_str).unwrap();
        assert_eq!(depo.sema_surumu().unwrap(), GOCLER.len() as i64);
        assert_eq!(depo.oku(k).unwrap().unwrap().metin, "kalıcı");
        drop(depo);
        for ek in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{yol_str}{ek}"));
        }
    }
}
