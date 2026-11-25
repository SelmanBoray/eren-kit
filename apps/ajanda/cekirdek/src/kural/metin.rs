//! SAHİBİ: R1 (metin ve zaman kuralları). Uygulamanın giriş temizliği ve form hazırlığı.
//! Başvuru: `ajanda-zaman.ts` `ajandaMetniTemizle`; `docs/AJANDA.md` "Uygulama" → "Metin girişi".
//! Vektör: `ajanda-kurallar.json` `gorunmez.metinler[].temiz`.
//!
//! Form kuralı (`govdeyi_hazirla`), alan alan:
//! - Her metin alanı önce `ajanda_metni_temizle`'den geçer (gizli karakter atılır, emoji korunur).
//! - Tek satırlık alanlar (`baslik`, `zaman.ifade`): satır sonu ya da sekme içeren her boşluk öbeği
//!   tek bir boşluğa iner (yapıştırılan çok satırlı başlık reddedilmez, tek satır olur); sonra kenar
//!   boşluğu JS `trim()` anlamıyla kırpılır.
//! - Çok satırlı alan (`aciklama`): `\r\n` ve tek `\r` -> `\n` (sekme kalır), kenar boşluğu kırpılır.
//! - Kırpma sonrası boş kalan isteğe bağlı alan (`aciklama`, `an`/`gun`/`donem` `ifade`'si) yok sayılır:
//!   formdaki boş kutu "alan yok" demektir. Zorunlu alanın (`baslik`, `belirsiz` `ifade`) boşluğu sorundur.
//! - Uzunluk aşımı kesilmez, sorun olarak döner (sessiz veri kaybı yerine kullanıcı düzeltir).
//! - Son söz `KayitGovdesi::dogrula`'nındır: ilk şema hatası `GirdiSorunu` olur.
//!
//! Kırpma, sunum seçicisinin ya da birleştiricinin tabanını götürebilir: `emoji_tabani_mi` yalnız
//! ASCII boşluğu taban saymaz, JS `trim()` ise U+00A0, U+3000 gibi boşlukları da atar. Bu yüzden kırpma
//! ve temizlik değişiklik kalmayana dek sırayla yinelenir (her tur kısaltır, biter).

use crate::model::metin::{ajanda_gorunmez_mi, emoji_tabani_mi, js_kirp};
use crate::model::{AjandaZamani, KayitGovdesi};

/// Formdaki bir alanın neden kabul edilmediği. `alan`: `baslik`, `aciklama`, `zaman.ifade` gibi yol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GirdiSorunu {
    pub alan: String,
    pub neden: String,
}

const ZWJ: u32 = 0x200d;
const VS15: u32 = 0xfe0e;
const VS16: u32 = 0xfe0f;

/// `ajandaMetniTemizle`: `ajanda_gorunmez_var_mi`'nin kabul etmediği her kod noktasını atar, bağlamındaki
/// emoji birleştiricilerini korur. Çıktıda `ajanda_gorunmez_var_mi` yanlıştır; geçerli metinde kimliktir.
/// Satır sonu, sekme ve kenar boşluğu bu işin dışındadır. (Eşsiz vekil Rust `&str`'de bulunamaz.)
pub fn ajanda_metni_temizle(metin: &str) -> String {
    let mut cikti = String::with_capacity(metin.len());
    // Son eklenen U+200D: arkasından taban gelmezse atılır.
    let mut bekleyen_zwj = false;
    for c in metin.chars() {
        let k = c as u32;
        if bekleyen_zwj && !emoji_tabani_mi(Some(k)) {
            cikti.pop();
        }
        bekleyen_zwj = false;
        let son = cikti.chars().next_back().map(|s| s as u32);
        if !ajanda_gorunmez_mi(k) || ((k == VS15 || k == VS16) && emoji_tabani_mi(son)) {
            cikti.push(c);
        } else if k == ZWJ && (emoji_tabani_mi(son) || son == Some(VS16)) {
            cikti.push(c);
            bekleyen_zwj = true;
        }
    }
    if bekleyen_zwj {
        cikti.pop();
    }
    cikti
}

/// Kenar boşluğunu kırpar; kırpmanın açığa çıkardığı bağlamsız seçici/birleştiriciyi de atar.
fn kenarlari_kirp(metin: String) -> String {
    let mut s = metin;
    loop {
        let yeni = ajanda_metni_temizle(js_kirp(&s));
        if yeni == s {
            return s;
        }
        s = yeni;
    }
}

/// Tek satırlık alan: temizle, satır sonu/sekme içeren boşluk öbeğini tek boşluğa indir, kırp.
fn satiri_hazirla(metin: &str) -> String {
    let temiz = ajanda_metni_temizle(metin);
    let mut cikti = String::with_capacity(temiz.len());
    let mut obek = String::new();
    let mut obekte_satir_sonu = false;
    let obegi_bosalt = |cikti: &mut String, obek: &mut String, satir_sonu: &mut bool| {
        if *satir_sonu {
            cikti.push(' ');
        } else {
            cikti.push_str(obek);
        }
        obek.clear();
        *satir_sonu = false;
    };
    for c in temiz.chars() {
        match c {
            ' ' => obek.push(c),
            '\t' | '\n' | '\r' => {
                obek.push(c);
                obekte_satir_sonu = true;
            }
            _ => {
                obegi_bosalt(&mut cikti, &mut obek, &mut obekte_satir_sonu);
                cikti.push(c);
            }
        }
    }
    obegi_bosalt(&mut cikti, &mut obek, &mut obekte_satir_sonu);
    kenarlari_kirp(cikti)
}

/// Çok satırlı alan: temizle, satır sonlarını `\n`'ye indir, kırp.
fn cok_satiri_hazirla(metin: &str) -> String {
    let temiz = ajanda_metni_temizle(metin).replace("\r\n", "\n").replace('\r', "\n");
    kenarlari_kirp(temiz)
}

/// İsteğe bağlı tek satırlık alan: boş kalırsa yok.
fn istege_bagli_satir(alan: &mut Option<String>) {
    *alan = alan.as_deref().map(satiri_hazirla).filter(|s| !s.is_empty());
}

/// Elle ekleme/düzenleme formunun gövdesini kabloya hazırlar: her metin alanına `ajanda_metni_temizle`,
/// sonra alanın kuralı (dosya başındaki "Form kuralı"). Sonuç `KayitGovdesi::dogrula`'dan geçmeli;
/// geçmiyorsa ilk sorun döner. Motor (`ekle`, `duzenle`) kuyruğa koymadan önce bunu çağırır.
pub fn govdeyi_hazirla(mut govde: KayitGovdesi) -> Result<KayitGovdesi, GirdiSorunu> {
    govde.baslik = satiri_hazirla(&govde.baslik);
    govde.aciklama = govde.aciklama.as_deref().map(cok_satiri_hazirla).filter(|s| !s.is_empty());
    match govde.zaman.as_mut() {
        Some(AjandaZamani::An { ifade, .. } | AjandaZamani::Gun { ifade, .. } | AjandaZamani::Donem { ifade, .. }) => {
            istege_bagli_satir(ifade)
        }
        Some(AjandaZamani::Belirsiz { ifade }) => *ifade = satiri_hazirla(ifade),
        None => {}
    }
    govde.dogrula().map_err(|h| GirdiSorunu { alan: h.yol, neden: h.neden.to_string() })?;
    Ok(govde)
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::model::metin::ajanda_gorunmez_var_mi;
    use crate::model::{Hatirlatma, KayitTuru};

    fn govde(baslik: &str) -> KayitGovdesi {
        KayitGovdesi {
            tur: KayitTuru::Gorev,
            baslik: baslik.into(),
            aciklama: None,
            zaman: None,
            hatirlatmalar: vec![],
            tekrar: None,
        }
    }

    /// Küçük bir abecenin 4 uzunluğa dek bütün dizileri: çıktı hep geçerli, girdinin alt dizisi,
    /// geçerli girdide kimlik ve temizlik idempotent.
    #[test]
    fn temizle_her_dizide_gecerli_ve_kimlik() {
        let abece = ['a', ' ', '\n', '\u{200d}', '\u{fe0f}', '\u{fe0e}', '\u{fe00}', '\u{e0041}', '\u{200b}', '😀', '\u{3000}'];
        let mut dizi = vec![String::new()];
        for _ in 0..4 {
            let mut yeni = Vec::new();
            for s in &dizi {
                for c in abece {
                    let mut t = s.clone();
                    t.push(c);
                    yeni.push(t);
                }
            }
            for s in &yeni {
                let t = ajanda_metni_temizle(s);
                assert!(!ajanda_gorunmez_var_mi(&t), "{s:?} -> {t:?}");
                if !ajanda_gorunmez_var_mi(s) {
                    assert_eq!(&t, s);
                }
                assert_eq!(ajanda_metni_temizle(&t), t);
                let mut girdi = s.chars();
                assert!(t.chars().all(|c| girdi.any(|g| g == c)), "alt dizi değil: {s:?} -> {t:?}");
            }
            dizi = yeni;
        }
    }

    #[test]
    fn temizle_dallari() {
        assert_eq!(ajanda_metni_temizle(""), "");
        // Taban + ZWJ + satır sonu: ZWJ'nin arkası taban değil, atılır; satır sonu kalır.
        assert_eq!(ajanda_metni_temizle("a\u{200d}\nb"), "a\nb");
        // Atılan ZWJ'den sonra gelen VS16'nın önü yine taban: kalır.
        assert_eq!(ajanda_metni_temizle("a\u{200d}\u{fe0f}"), "a\u{fe0f}");
        // U+3000 taban sayılır (yalnız ASCII boşluk sayılmaz): seçici kalır.
        assert_eq!(ajanda_metni_temizle("\u{3000}\u{fe0f}"), "\u{3000}\u{fe0f}");
        // C1, BOM, LRM, etiket ve değişken seçici: her bağlamda atılır.
        assert_eq!(ajanda_metni_temizle("\u{feff}a\u{85}\u{200e}b\u{e0062}\u{fe01}"), "ab");
    }

    #[test]
    fn baslik_tek_satira_iner_ve_kirpilir() {
        let g = govdeyi_hazirla(govde("  Market\r\n\talışverişi \u{200b} ☕\u{fe0f} \n")).unwrap();
        assert_eq!(g.baslik, "Market alışverişi  ☕\u{fe0f}");
        // Yalnız ASCII boşluk öbeği olduğu gibi kalır.
        assert_eq!(govdeyi_hazirla(govde("a   b")).unwrap().baslik, "a   b");
    }

    #[test]
    fn kirpma_aciga_cikan_seciciyi_de_atar() {
        // U+3000 taban sayıldığı için temizlikte seçici kalır, kırpma tabanı götürünce atılmalı;
        // atılınca yeniden kenara gelen U+3000 da kırpılmalı.
        let g = govdeyi_hazirla(govde("\u{3000}\u{fe0f}\u{3000}Toplantı\u{3000}")).unwrap();
        assert_eq!(g.baslik, "Toplantı");
    }

    #[test]
    fn bos_baslik_sorun() {
        let s = govdeyi_hazirla(govde(" \u{200b}\n ")).unwrap_err();
        assert_eq!(s.alan, "baslik");
    }

    #[test]
    fn uzun_baslik_kesilmez_sorun_doner() {
        let s = govdeyi_hazirla(govde(&"ç".repeat(201))).unwrap_err();
        assert_eq!(s.alan, "baslik");
        assert!(govdeyi_hazirla(govde(&"ç".repeat(200))).is_ok());
    }

    #[test]
    fn aciklama_satir_sonlari_ve_bos_alan() {
        let mut g = govde("Not");
        g.aciklama = Some("\r\n birinci\r\n\tikinci\rüçüncü\u{2028} \n".into());
        assert_eq!(govdeyi_hazirla(g).unwrap().aciklama.as_deref(), Some("birinci\n\tikinci\nüçüncü"));
        let mut g = govde("Not");
        g.aciklama = Some(" \n\u{200b}\t".into());
        assert_eq!(govdeyi_hazirla(g).unwrap().aciklama, None);
    }

    #[test]
    fn zaman_ifadesi() {
        let mut g = govde("Doktor");
        g.zaman = Some(AjandaZamani::An {
            tarih: "2026-11-26".into(),
            saat: "10:00".into(),
            sure_dk: None,
            saat_dilimi: "Europe/Istanbul".into(),
            ifade: Some(" yarın\n10'da\u{200f} ".into()),
        });
        g.hatirlatmalar = vec![Hatirlatma::Once { dk: 15 }];
        let h = govdeyi_hazirla(g.clone()).unwrap();
        assert!(matches!(h.zaman, Some(AjandaZamani::An { ifade: Some(ref i), .. }) if i == "yarın 10'da"));

        if let Some(AjandaZamani::An { ifade, .. }) = g.zaman.as_mut() {
            *ifade = Some("\u{200b} ".into());
        }
        let h = govdeyi_hazirla(g).unwrap();
        assert!(matches!(h.zaman, Some(AjandaZamani::An { ifade: None, .. })));

        let mut g = govde("Bir ara");
        g.zaman = Some(AjandaZamani::Belirsiz { ifade: " \u{feff} ".into() });
        assert_eq!(govdeyi_hazirla(g).unwrap_err().alan, "zaman.ifade");
        let mut g = govde("Bir ara");
        g.zaman = Some(AjandaZamani::Belirsiz { ifade: "\tbir ara\t".into() });
        assert!(matches!(govdeyi_hazirla(g).unwrap().zaman, Some(AjandaZamani::Belirsiz { ref ifade }) if ifade == "bir ara"));
    }

    #[test]
    fn sema_sorunu_alan_yoluyla_doner() {
        let mut g = govde("Doktor");
        g.zaman = Some(AjandaZamani::An {
            tarih: "2026-02-30".into(),
            saat: "10:00".into(),
            sure_dk: None,
            saat_dilimi: "Europe/Istanbul".into(),
            ifade: None,
        });
        assert_eq!(govdeyi_hazirla(g).unwrap_err().alan, "zaman.tarih");
    }
}
