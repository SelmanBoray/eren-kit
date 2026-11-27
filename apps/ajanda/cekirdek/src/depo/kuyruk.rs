//! SAHİBİ: R4. Kalıcı işlem kuyruğu (`kuyruk`) ve kullanıcının ret listesi (`ret_listesi`).
//!
//! Kuyruk satırının üç hali:
//! - bekliyor (`yollandi` 0, `bekledigi_rev` boş): sırası gelince yollanır;
//! - yollandı (`yollandi` 1): bu bağlantıda yollandı, sonucu bekleniyor; bağlantı sonucu getirmeden
//!   biterse (kopma ya da süreç ölümü) `Kopma` sayılır (`kural::kuyruk`);
//! - onaylandı (`bekledigi_rev` dolu): servis kabul etti, `kayit` çerçevesi bekleniyor; yollanmaz,
//!   yalnız iyimser hali görünür tutar.
//!
//! Sıra `sira`'dır (AUTOINCREMENT). Satırın işlemi `AjandaIslem::json()` metnidir.

use super::Depo;
use crate::hata::CekirdekHatasi;
use rusqlite::{OptionalExtension, Row, params};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KuyrukSatiri {
    pub sira: i64,
    pub islem_id: String,
    pub kayit_id: String,
    pub islem_json: String,
    /// Sonuçsuz deneme sayısı (geçici ret ya da sonucu gelmeden kopma).
    pub deneme: u32,
    pub yollandi: bool,
    pub olusturma_ms: i64,
    pub bekledigi_rev: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetSatiri {
    pub islem_id: String,
    pub kayit_id: String,
    pub islem_json: String,
    /// `KuyrukRetNedeni`'nin adı.
    pub neden: String,
    pub ts_ms: i64,
    /// Düzeltme formunun gövdesi (`KayitGovdesi` JSON'u), biliniyorsa.
    pub govde_json: Option<String>,
    /// İşlemin kuyruktaki sırası (aynı anda reddedilenler bu sırayla görünür).
    pub sira: i64,
}

const KUYRUK_SUTUNLARI: &str = "sira, islem_id, kayit_id, islem_json, deneme, yollandi, olusturma_ms, bekledigi_rev";

fn kuyruk_satiri(r: &Row<'_>) -> rusqlite::Result<KuyrukSatiri> {
    Ok(KuyrukSatiri {
        sira: r.get(0)?,
        islem_id: r.get(1)?,
        kayit_id: r.get(2)?,
        islem_json: r.get(3)?,
        // Bozuk (negatif ya da taşan) deneme sayısı sınırın üstü sayılır: kural ilk olayda ret listesine yollar.
        deneme: u32::try_from(r.get::<_, i64>(4)?).unwrap_or(u32::MAX),
        yollandi: r.get(5)?,
        olusturma_ms: r.get(6)?,
        bekledigi_rev: r.get(7)?,
    })
}

impl Depo {
    fn kuyruk_sorgusu(&self, kosul: &str, p: impl rusqlite::Params) -> Result<Vec<KuyrukSatiri>, CekirdekHatasi> {
        let sql = format!("SELECT {KUYRUK_SUTUNLARI} FROM kuyruk WHERE {kosul} ORDER BY sira");
        let mut sorgu = self.baglanti.prepare(&sql)?;
        let satirlar = sorgu.query_map(p, kuyruk_satiri)?;
        Ok(satirlar.collect::<rusqlite::Result<_>>()?)
    }

    pub fn kuyruga_ekle(&self, islem_id: &str, kayit_id: &str, islem_json: &str, olusturma_ms: i64) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute(
            "INSERT INTO kuyruk (islem_id, kayit_id, islem_json, olusturma_ms) VALUES (?1, ?2, ?3, ?4)",
            params![islem_id, kayit_id, islem_json, olusturma_ms],
        )?;
        Ok(())
    }

    /// Sırası gelen (onaylanmamış en eski) satır.
    pub fn kuyruk_basi(&self) -> Result<Option<KuyrukSatiri>, CekirdekHatasi> {
        Ok(self
            .baglanti
            .query_row(
                &format!("SELECT {KUYRUK_SUTUNLARI} FROM kuyruk WHERE bekledigi_rev IS NULL ORDER BY sira LIMIT 1"),
                [],
                kuyruk_satiri,
            )
            .optional()?)
    }

    /// Yollanmış, sonucu beklenen satırlar (en çok bir tane olmalı; süreç ölümünden kalan da dahil).
    pub fn kuyruk_yollananlar(&self) -> Result<Vec<KuyrukSatiri>, CekirdekHatasi> {
        self.kuyruk_sorgusu("yollandi != 0", [])
    }

    /// Kaydın bütün satırları, sırayla (iyimser yeniden uygulama).
    pub fn kuyruk_kaydin(&self, kayit_id: &str) -> Result<Vec<KuyrukSatiri>, CekirdekHatasi> {
        self.kuyruk_sorgusu("kayit_id = ?1", [kayit_id])
    }

    /// Kuyrukta satırı olan kayıtlar.
    pub fn kuyruktaki_kayitlar(&self) -> Result<Vec<String>, CekirdekHatasi> {
        let mut sorgu = self.baglanti.prepare("SELECT DISTINCT kayit_id FROM kuyruk ORDER BY kayit_id")?;
        let satirlar = sorgu.query_map([], |r| r.get(0))?;
        Ok(satirlar.collect::<rusqlite::Result<_>>()?)
    }

    /// Bütün satırlar (testler ve tanı).
    pub fn kuyruk(&self) -> Result<Vec<KuyrukSatiri>, CekirdekHatasi> {
        self.kuyruk_sorgusu("1", [])
    }

    pub fn kuyruk_yollandi_yaz(&self, sira: i64, yollandi: bool) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("UPDATE kuyruk SET yollandi = ?2 WHERE sira = ?1", params![sira, yollandi])?;
        Ok(())
    }

    /// Sonuçsuz deneme: sayı yazılır, satır yeniden "bekliyor" olur.
    pub fn kuyruk_deneme_yaz(&self, sira: i64, deneme: u32) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("UPDATE kuyruk SET deneme = ?2, yollandi = 0 WHERE sira = ?1", params![sira, deneme])?;
        Ok(())
    }

    /// Servis kabul etti ama `rev`'in `kayit`'i gelmedi: satır onaylandı haline geçer.
    pub fn kuyruk_onaylandi_yaz(&self, sira: i64, rev: i64) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("UPDATE kuyruk SET bekledigi_rev = ?2, yollandi = 0 WHERE sira = ?1", params![sira, rev])?;
        Ok(())
    }

    pub fn kuyruk_sil(&self, sira: i64) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("DELETE FROM kuyruk WHERE sira = ?1", [sira])?;
        Ok(())
    }

    /// Kaydın, sunucu kopyası `rev`'e ulaştığı için artık gereksiz onaylanmış satırları. Döner: silinen var mı.
    pub fn kaydin_onaylananlarini_sil(&self, kayit_id: &str, rev: i64) -> Result<bool, CekirdekHatasi> {
        let n = self.baglanti.execute(
            "DELETE FROM kuyruk WHERE kayit_id = ?1 AND bekledigi_rev IS NOT NULL AND bekledigi_rev <= ?2",
            params![kayit_id, rev],
        )?;
        Ok(n > 0)
    }

    /// Kaydın bütün satırlarını siler (aynı depo tam telafisinde satırlar yeniden dizilir: `motor/yerel.rs`).
    pub fn kaydin_kuyrugunu_sil(&self, kayit_id: &str) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("DELETE FROM kuyruk WHERE kayit_id = ?1", [kayit_id])?;
        Ok(())
    }

    /// Satırı aynı `islem_id`, deneme ve anla kuyruğun sonuna yeniden koyar (yeni `sira`, bekliyor hali).
    pub fn kuyruga_yeniden_ekle(&self, s: &KuyrukSatiri) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute(
            "INSERT INTO kuyruk (islem_id, kayit_id, islem_json, deneme, olusturma_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![s.islem_id, s.kayit_id, s.islem_json, s.deneme, s.olusturma_ms],
        )?;
        Ok(())
    }

    /// Telafi bitti: bütün onaylanmış satırlar gereksizdir (sunucu kopyası onları kapsar). Döner: kayıtları.
    pub fn butun_onaylananlari_sil(&self) -> Result<Vec<String>, CekirdekHatasi> {
        let mut sorgu =
            self.baglanti.prepare("DELETE FROM kuyruk WHERE bekledigi_rev IS NOT NULL RETURNING kayit_id")?;
        let mut kayitlar: Vec<String> = sorgu.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        kayitlar.sort();
        kayitlar.dedup();
        Ok(kayitlar)
    }

    /// Sonucu gelmemiş (onaylanmamış) satır sayısı.
    pub fn kuyruk_sayisi(&self) -> Result<i64, CekirdekHatasi> {
        Ok(self.baglanti.query_row("SELECT COUNT(*) FROM kuyruk WHERE bekledigi_rev IS NULL", [], |s| s.get(0))?)
    }

    pub fn ret_ekle(&self, r: &RetSatiri) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute(
            "INSERT INTO ret_listesi (islem_id, kayit_id, islem_json, neden, ts_ms, govde_json, sira) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (islem_id) DO NOTHING",
            params![r.islem_id, r.kayit_id, r.islem_json, r.neden, r.ts_ms, r.govde_json, r.sira],
        )?;
        Ok(())
    }

    /// Ret listesi, eskiden yeniye.
    pub fn ret_listesi(&self) -> Result<Vec<RetSatiri>, CekirdekHatasi> {
        let mut sorgu = self.baglanti.prepare(
            "SELECT islem_id, kayit_id, islem_json, neden, ts_ms, govde_json, sira FROM ret_listesi ORDER BY ts_ms, sira, islem_id",
        )?;
        let satirlar = sorgu.query_map([], |r| {
            Ok(RetSatiri {
                islem_id: r.get(0)?,
                kayit_id: r.get(1)?,
                islem_json: r.get(2)?,
                neden: r.get(3)?,
                ts_ms: r.get(4)?,
                govde_json: r.get(5)?,
                sira: r.get(6)?,
            })
        })?;
        Ok(satirlar.collect::<rusqlite::Result<_>>()?)
    }

    /// Döner: silindi mi.
    pub fn ret_sil(&self, islem_id: &str) -> Result<bool, CekirdekHatasi> {
        Ok(self.baglanti.execute("DELETE FROM ret_listesi WHERE islem_id = ?1", [islem_id])? > 0)
    }

    pub fn ret_sayisi(&self) -> Result<i64, CekirdekHatasi> {
        Ok(self.baglanti.query_row("SELECT COUNT(*) FROM ret_listesi", [], |s| s.get(0))?)
    }

    /// Yalnız testler: satırın işlemini bozar (bozuk kuyruk satırı senaryosu).
    #[cfg(test)]
    pub fn kuyruk_islemini_boz(&self, sira: i64, islem_json: &str) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("UPDATE kuyruk SET islem_json = ?2 WHERE sira = ?1", params![sira, islem_json])?;
        Ok(())
    }
}
