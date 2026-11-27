//! SAHİBİ: D1 (yerel kip). Kip durumu (`meta.kip`), yerel revizyon sayacı (`meta.yerel_rev`) ve yerel
//! geçmiş (`yerel_gecmis`). Göç 4 (`sema.rs`) kurar; yazar yolu `motor/yerel.rs`'tedir.
//!
//! - Kip yoksa (göç 4'ten önce yazılmış olamaz; elle silinmiş meta) `bagli` sayılır: bugünkü davranış.
//! - Yerel revizyon: her yerel yazma `yerel_rev_sonraki` ile yeni ve monoton artan bir revizyon alır. Sayaç
//!   yoksa (ilk yerel yazma) var olan en büyük revizyonun (görünen kopya, sunucu kopyası, `son_rev`) üstünden
//!   başlar: PC'den gelmiş revizyonlarla çakışıp geri gitmez.
//! - Yerel geçmiş satırı sözleşmenin `AjandaGecmisGirdisi` JSON'udur; köprü onu `GecmisSatiri`'na çevirir.

use super::{Depo, anahtar};
use crate::hata::CekirdekHatasi;
use crate::model::{AjandaGecmisGirdisi, AjandaKaydi};
use rusqlite::{OptionalExtension, params};

/// `meta.kip` değerleri.
pub const KIP_YEREL: &str = "yerel";
pub const KIP_BAGLI: &str = "bagli";

impl Depo {
    /// Yerel kip mi (`meta.kip` = `yerel`).
    pub fn yerel_kip_mi(&self) -> rusqlite::Result<bool> {
        Ok(self.meta_oku(anahtar::KIP)?.as_deref() == Some(KIP_YEREL))
    }

    pub fn kip_yaz(&self, yerel: bool) -> rusqlite::Result<()> {
        self.meta_yaz(anahtar::KIP, Some(if yerel { KIP_YEREL } else { KIP_BAGLI }))
    }

    /// Bütün görünen kayıtlar (mezar taşları dahil), oluşturma sırasıyla.
    pub fn gorunen_hepsi(&self) -> Result<Vec<AjandaKaydi>, CekirdekHatasi> {
        let mut s = self.baglanti.prepare("SELECT json FROM gorunen ORDER BY olusturma_ms, kayit_id")?;
        let satirlar = s.query_map([], |r| r.get::<_, String>(0))?;
        let mut sonuc = Vec::new();
        for json in satirlar {
            sonuc.push(super::kopya::kayit_json_oku(&json?)?);
        }
        Ok(sonuc)
    }

    /// Görünen kopyadaki kayıt sayısı, mezar taşları dahil (servisin `ajandaKayitSayisi`'nin yerel karşılığı).
    pub fn gorunen_sayisi(&self) -> rusqlite::Result<i64> {
        self.baglanti.query_row("SELECT COUNT(*) FROM gorunen", [], |s| s.get(0))
    }

    /// Sonraki yerel revizyon: sayaç, `son_rev` ve kaydın şimdiki revizyonundan büyük. Yazmaz; çağıran aynı
    /// işlemde `yerel_rev_yaz` der.
    pub fn yerel_rev_sonraki(&self, kaydin_revizyonu: i64) -> Result<i64, CekirdekHatasi> {
        let sayac = match self.meta_oku(anahtar::YEREL_REV)?.and_then(|s| s.parse::<i64>().ok()) {
            Some(r) => r,
            None => {
                let sunucu: Option<i64> = self.baglanti.query_row("SELECT MAX(revizyon) FROM sunucu_kayitlari", [], |s| s.get(0))?;
                let gorunen: Option<i64> =
                    self.baglanti.query_row("SELECT MAX(json_extract(json, '$.revizyon')) FROM gorunen", [], |s| s.get(0))?;
                sunucu.unwrap_or(0).max(gorunen.unwrap_or(0))
            }
        };
        Ok(sayac.max(self.son_rev()?).max(kaydin_revizyonu) + 1)
    }

    pub fn yerel_rev_yaz(&self, rev: i64) -> rusqlite::Result<()> {
        self.meta_yaz(anahtar::YEREL_REV, Some(&rev.to_string()))
    }

    pub fn yerel_gecmis_ekle(&self, kayit_id: &str, g: &AjandaGecmisGirdisi) -> rusqlite::Result<()> {
        self.baglanti.execute(
            "INSERT INTO yerel_gecmis (kayit_id, rev, ts_ms, json) VALUES (?1, ?2, ?3, ?4)",
            params![kayit_id, g.rev, g.ts_ms, g.json().to_string()],
        )?;
        Ok(())
    }

    /// Kaydın yerel geçmişi, rev azalan; `once_rev` verilirse yalnız ondan küçükler; en çok `adet`.
    /// Çözülemeyen satır atlanmaz: hata döner (satırları yalnız bu modül yazar).
    pub fn yerel_gecmis(&self, kayit_id: &str, once_rev: Option<i64>, adet: usize) -> Result<Vec<AjandaGecmisGirdisi>, CekirdekHatasi> {
        let mut s = self.baglanti.prepare(
            "SELECT json FROM yerel_gecmis WHERE kayit_id = ?1 AND (?2 IS NULL OR rev < ?2) ORDER BY rev DESC LIMIT ?3",
        )?;
        let satirlar = s.query_map(params![kayit_id, once_rev, adet as i64], |r| r.get::<_, String>(0))?;
        let mut sonuc = Vec::new();
        for json in satirlar {
            let json = json?;
            let v: serde_json::Value = serde_json::from_str(&json)
                .map_err(|h| CekirdekHatasi::Depo { mesaj: format!("yerel geçmiş satırı çözülmedi: {h}") })?;
            let g = AjandaGecmisGirdisi::oku(&v, "")
                .map_err(|h| CekirdekHatasi::Depo { mesaj: format!("yerel geçmiş satırı şemadan geçmedi: {} {}", h.yol, h.neden) })?;
            sonuc.push(g);
        }
        Ok(sonuc)
    }

    /// Kaydın yerel geçmiş satırı sayısı (testler ve tanı).
    pub fn yerel_gecmis_sayisi(&self, kayit_id: &str) -> rusqlite::Result<i64> {
        self.baglanti.query_row("SELECT COUNT(*) FROM yerel_gecmis WHERE kayit_id = ?1", [kayit_id], |s| s.get(0))
    }

    /// Yerel sayaç (yoksa `None`; testler).
    pub fn yerel_rev(&self) -> rusqlite::Result<Option<i64>> {
        Ok(self
            .baglanti
            .query_row("SELECT deger FROM meta WHERE anahtar = ?1", [anahtar::YEREL_REV], |s| s.get::<_, String>(0))
            .optional()?
            .and_then(|s| s.parse().ok()))
    }
}
