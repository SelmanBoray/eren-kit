//! SAHİBİ: R4. Sunucu kopyası (`sunucu_kayitlari`: PC'den gelen son haller, mezar taşları dahil), süren
//! tam telafinin topladıkları (`telafi_kayitlari`) ve kopyanın `depo_id`/`son_rev`'i (`meta`).
//!
//! `kural::esitleme` (`ajandaEsitlemeAdimi`) bellek içi başvurudur; buradaki karşılıkları:
//! - `kayit` uygulaması (`kopya_kaydi_uygula`): yalnız revizyonu yereldekinden büyükse yazılır; `son_rev`
//!   her çerçevede ilerler (çağıran `son_rev_ilerlet` ile).
//! - tam telafi: gelenler `telafi_kayitlari`'na toplanır; `esitlendi`'de `telafiyi_sunucuya_gecir` sunucu
//!   kopyasının yerine geçirir (gelmeyen kayıt düşer); kopmada `telafiyi_sil` atar.
//! - `hello` alanları (`hello_alanlari`): yalnız sunucu kopyasından; revizyonu `son_rev` olan kayıtların
//!   anahtar sırasıyla sonuncusunun izi (başvurunun `values().rev().find`'ı).
//!
//! Kayıt satırı `AjandaKaydi::json()`'ın metnidir (anahtarlar sıralı): aynı kayıt aynı metni verir, görünen
//! kopyayla metin karşılaştırması bu yüzden geçerlidir.

use super::{Depo, anahtar};
use crate::hata::CekirdekHatasi;
use crate::kural::esitleme::HelloAlanlari;
use crate::model::{AjandaKaydi, AjandaRevIzi};
use rusqlite::{OptionalExtension, params};

/// Kopyanın iki tablosu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KopyaTablosu {
    Sunucu,
    Telafi,
}

impl KopyaTablosu {
    fn ad(self) -> &'static str {
        match self {
            KopyaTablosu::Sunucu => "sunucu_kayitlari",
            KopyaTablosu::Telafi => "telafi_kayitlari",
        }
    }
}

/// Kopya tablosunun ham satırı (`kopya_satirlari`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KopyaSatiri {
    pub kayit_id: String,
    pub revizyon: i64,
    pub guncelleme_ms: i64,
    pub json: String,
}

pub(crate) fn kayit_json_oku(json: &str) -> Result<AjandaKaydi, CekirdekHatasi> {
    let deger: serde_json::Value =
        serde_json::from_str(json).map_err(|e| CekirdekHatasi::Depo { mesaj: format!("kayıt JSON'u bozuk: {e}") })?;
    AjandaKaydi::oku(&deger, "")
        .map_err(|h| CekirdekHatasi::Depo { mesaj: format!("kayıt şemadan geçmedi: {} ({})", h.yol, h.neden) })
}

impl Depo {
    /// `kayit` çerçevesinin kopyaya uygulanması: yalnız revizyonu tablodakinden büyükse yazılır.
    /// Döner: yazıldı mı. (`son_rev`'i çağıran ilerletir.)
    pub fn kopya_kaydi_uygula(&self, tablo: KopyaTablosu, kayit: &AjandaKaydi) -> Result<bool, CekirdekHatasi> {
        let sql = format!(
            "INSERT INTO {t} (kayit_id, revizyon, guncelleme_ms, json) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (kayit_id) DO UPDATE SET revizyon = excluded.revizyon,
               guncelleme_ms = excluded.guncelleme_ms, json = excluded.json
             WHERE excluded.revizyon > {t}.revizyon",
            t = tablo.ad()
        );
        let n = self.baglanti.execute(
            &sql,
            params![kayit.kayit_id, kayit.revizyon, kayit.guncelleme_ms, kayit.json().to_string()],
        )?;
        Ok(n > 0)
    }

    pub fn sunucu_kaydi(&self, kayit_id: &str) -> Result<Option<AjandaKaydi>, CekirdekHatasi> {
        let json: Option<String> = self
            .baglanti
            .query_row("SELECT json FROM sunucu_kayitlari WHERE kayit_id = ?1", [kayit_id], |s| s.get(0))
            .optional()?;
        json.map(|j| kayit_json_oku(&j)).transpose()
    }

    /// Sunucu kopyasındaki satırın metni, çözülmeden (okunamayan satırı depo hatasından ayırmak için).
    pub fn sunucu_ham(&self, kayit_id: &str) -> Result<Option<String>, CekirdekHatasi> {
        Ok(self
            .baglanti
            .query_row("SELECT json FROM sunucu_kayitlari WHERE kayit_id = ?1", [kayit_id], |s| s.get(0))
            .optional()?)
    }

    pub fn sunucu_revizyonu(&self, kayit_id: &str) -> Result<Option<i64>, CekirdekHatasi> {
        Ok(self
            .baglanti
            .query_row("SELECT revizyon FROM sunucu_kayitlari WHERE kayit_id = ?1", [kayit_id], |s| s.get(0))
            .optional()?)
    }

    pub fn sunucu_kaydi_sayisi(&self) -> Result<i64, CekirdekHatasi> {
        Ok(self.baglanti.query_row("SELECT COUNT(*) FROM sunucu_kayitlari", [], |s| s.get(0))?)
    }

    /// Süren tam telafinin topladıklarını atar (kopma, süreç yeniden açıldı, yeni tam telafi). Onay bekleyen
    /// birleştirmenin işareti (D4, `anahtar::BIRLESTIRME`) de gider: o, toplanan kopyanın önizlemesidir.
    pub fn telafiyi_sil(&self) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute("DELETE FROM telafi_kayitlari", [])?;
        self.meta_yaz(anahtar::BIRLESTIRME, None)?;
        Ok(())
    }

    /// Tam telafinin sonu: toplanan kopya sunucu kopyasının yerine geçer (gelmeyen kayıt düşer); onay
    /// bekleyen birleştirmenin işareti (D4) gider.
    pub fn telafiyi_sunucuya_gecir(&self) -> Result<(), CekirdekHatasi> {
        self.baglanti.execute_batch(
            "DELETE FROM sunucu_kayitlari;
             INSERT INTO sunucu_kayitlari (kayit_id, revizyon, guncelleme_ms, json)
               SELECT kayit_id, revizyon, guncelleme_ms, json FROM telafi_kayitlari;
             DELETE FROM telafi_kayitlari;",
        )?;
        self.meta_yaz(anahtar::BIRLESTIRME, None)?;
        Ok(())
    }

    /// Toplanan kopyanın ulaştığı revizyon (en büyük kayıt revizyonu; boşsa 0): süren tam telafinin
    /// `son_rev`'i (`kanal.rs` `Telafi.tam` aynı değeri tamponla biriktirir).
    pub fn telafi_son_rev(&self) -> Result<i64, CekirdekHatasi> {
        Ok(self.baglanti.query_row("SELECT COALESCE(MAX(revizyon), 0) FROM telafi_kayitlari", [], |s| s.get(0))?)
    }

    pub fn son_rev(&self) -> Result<i64, CekirdekHatasi> {
        Ok(self.meta_oku(anahtar::SON_REV)?.and_then(|s| s.parse().ok()).unwrap_or(0))
    }

    /// `son_rev`'i `rev`'e yükseltir (küçükse dokunmaz).
    pub fn son_rev_ilerlet(&self, rev: i64) -> Result<(), CekirdekHatasi> {
        if rev > self.son_rev()? {
            self.son_rev_yaz(rev)?;
        }
        Ok(())
    }

    pub fn son_rev_yaz(&self, rev: i64) -> Result<(), CekirdekHatasi> {
        Ok(self.meta_yaz(anahtar::SON_REV, Some(&rev.to_string()))?)
    }

    pub fn depo_id(&self) -> Result<Option<String>, CekirdekHatasi> {
        Ok(self.meta_oku(anahtar::DEPO_ID)?)
    }

    pub fn depo_id_yaz(&self, depo_id: &str) -> Result<(), CekirdekHatasi> {
        Ok(self.meta_yaz(anahtar::DEPO_ID, Some(depo_id))?)
    }

    /// `ajandaHelloAlanlari`'nın SQLite karşılığı (süren tam telafinin topladığı girmez).
    pub fn hello_alanlari(&self) -> Result<HelloAlanlari, CekirdekHatasi> {
        let son_rev = self.son_rev()?;
        let son_rev_izi = if son_rev > 0 {
            self.baglanti
                .query_row(
                    "SELECT kayit_id, guncelleme_ms FROM sunucu_kayitlari WHERE revizyon = ?1
                     ORDER BY kayit_id DESC LIMIT 1",
                    [son_rev],
                    |s| Ok(AjandaRevIzi { kayit_id: s.get(0)?, guncelleme_ms: s.get(1)? }),
                )
                .optional()?
        } else {
            None
        };
        Ok(HelloAlanlari { son_rev, depo_id: self.depo_id()?, son_rev_izi })
    }

    /// Sunucu kopyasının bütün kayıtları (`kayit_id` sırasıyla; testler ve tanı).
    pub fn sunucu_kayitlari(&self) -> Result<Vec<AjandaKaydi>, CekirdekHatasi> {
        let mut sorgu = self.baglanti.prepare("SELECT json FROM sunucu_kayitlari ORDER BY kayit_id")?;
        let satirlar = sorgu.query_map([], |s| s.get::<_, String>(0))?;
        satirlar.map(|j| kayit_json_oku(&j?)).collect()
    }

    /// Görünen satırı sunucu satırıyla aynı olmayan (yok, metni farklı ya da bekleyen işaretli) ve
    /// kuyrukta işlemi olmayan sunucu kayıtları: tam telafinin sonunda yalnız bunlar yeniden yazılır.
    pub fn gorunenden_farkli_sunucu_kayitlari(&self) -> Result<Vec<AjandaKaydi>, CekirdekHatasi> {
        let mut sorgu = self.baglanti.prepare(
            "SELECT s.json FROM sunucu_kayitlari s LEFT JOIN gorunen g ON g.kayit_id = s.kayit_id
             WHERE s.kayit_id NOT IN (SELECT kayit_id FROM kuyruk)
               AND (g.json IS NULL OR g.json != s.json OR g.bekleyen != 0)",
        )?;
        let satirlar = sorgu.query_map([], |s| s.get::<_, String>(0))?;
        satirlar.map(|j| kayit_json_oku(&j?)).collect()
    }

    /// Tablonun bütün satırları ham (`kayit_id` sırasıyla): yazım izi (revizyon, `guncelleme_ms`) sütunlardan,
    /// kayıt metni çözülmeden. Satırı okunamayan kayıt da izini verir (`motor/yerel.rs` yedekten dönme
    /// denetimi yalnız izlere bakar).
    pub fn kopya_satirlari(&self, tablo: KopyaTablosu) -> Result<Vec<KopyaSatiri>, CekirdekHatasi> {
        let sql = format!("SELECT kayit_id, revizyon, guncelleme_ms, json FROM {} ORDER BY kayit_id", tablo.ad());
        let mut sorgu = self.baglanti.prepare(&sql)?;
        let satirlar = sorgu.query_map([], |s| {
            Ok(KopyaSatiri { kayit_id: s.get(0)?, revizyon: s.get(1)?, guncelleme_ms: s.get(2)?, json: s.get(3)? })
        })?;
        Ok(satirlar.collect::<rusqlite::Result<_>>()?)
    }

    /// Görünen kopyada olup sunucu kopyasında ve kuyrukta olmayan kayıtları siler. Döner: silinenler.
    pub fn sahipsiz_gorunenleri_sil(&self) -> Result<Vec<String>, CekirdekHatasi> {
        let mut sorgu = self.baglanti.prepare(
            "DELETE FROM gorunen WHERE kayit_id NOT IN (SELECT kayit_id FROM sunucu_kayitlari)
               AND kayit_id NOT IN (SELECT kayit_id FROM kuyruk) RETURNING kayit_id",
        )?;
        let satirlar = sorgu.query_map([], |s| s.get::<_, String>(0))?;
        Ok(satirlar.collect::<rusqlite::Result<_>>()?)
    }
}
