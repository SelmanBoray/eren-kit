//! SAHİBİ: D1 (yerel kip, `YOL-HARITASI.md` 3.3 "Yetki"). Yerel kipte doğruluk kaynağı telefonun görünen
//! kopyasıdır (`gorunen`); kullanıcı işlemleri kuyruğa girmeden, servisin `islemCalistir` kurallarıyla
//! (`iyimser::islem_uygula`: iyimser uygulamanın kendisi) doğrudan ve kalıcı uygulanır.
//!
//! Yazar yolu (`yerel_yaz`), tek SQLite işleminde: görünen satır (`bekleyen` yanlış), yerel revizyon
//! (`depo::yerel`, monoton; PC revizyonlarının altına inmez), yerel geçmiş satırı (sözleşmenin
//! `AjandaGecmisGirdisi`'si; servisin `fark`/`dogumParcasi` anlamıyla). Kalıcı olduktan sonra alarm senkronu
//! ve `Degisim.kayitlar` (`Motor::gorunenler_degisti`). Yan etkisiz işlem (servis `ok`, revizyonsuz) hiçbir
//! şey yazmaz.
//!
//! Servisin yerelde ayrıca yapılan denetimleri: `ekle`'de `KAYIT_ADET` (mezar taşları dahil, `kayit_siniri`)
//! ve dilim (`saat_dilimi_bilinmiyor`: zamanın ve `mutlak` hatırlatmaların dilimi; `guncelle`'de değişen
//! zaman ve hatırlatmalar). Dilim, servisteki dilim veritabanının yerine `ZamanKabugu.andan_yerele` ile
//! (java.time) sınanır. Kimlik çakışması, olmayan ya da silinmiş kayıt, geçersiz örnek ve tutarsız sonuç
//! `islem_uygula`'dan gelir. Taslak ve sentetik tur kuralları yerelde yoktur: yerelde yalnız insan yazar
//! (bağlantıdan kalan taslak onaylanabilir).
//!
//! Geçişler (`YOL-HARITASI.md` 3.3):
//! - Bağlanma: yerel kipte QR ile eşleşince kip, servisin tam kopyası elde edilene dek `yerel` kalır. Bu
//!   sürede yerel yazmalar sürer; `hello` boş kopya gibi gider (`son_rev` 0, `depo_id` yok: servis hep tam
//!   telafi yapar), gelenler yalnız `telafi_kayitlari`'na toplanır; görünen kopya, alarmlar ve koparma
//!   anındaki PC temeli (`sunucu_kayitlari`, `depo_id`, `son_rev`) değişmez. Bağlantı yarıda koparsa
//!   toplanan atılır, sonraki bağlantı baştan dener. `esitlendi`'de plan (`dokme_plani`) kurulur; gidecek
//!   bir şey varsa kullanıcının onayı beklenir (D4, `birlestirme.rs`), onayda (ya da soru gerekmiyorsa hemen)
//!   tek işlemde `yereli_kuyruga_dok`: yerel kayıtlar fark olarak kuyruğa girer, kip `bagli` olur. Görünen kopya hiçbir zaman başka bir
//!   `depo_id`'nin tam telafisiyle değiştirilmez.
//! - Koparma (`Motor::baglantiyi_kopar`): bağlı kipten yerel kipe; görünen kopya o anki haliyle kalır.
//! - Veri koruması (D2): bağlı kipte `eslesmeyi_kaldir` koparmadır (`GecisNedeni::EslesmeKaldirildi`). Bağlı
//!   kipte `welcome` saklı `depo_id`'den farklı bir `depo_id` getirirse (başka servisle yeni QR ya da sıfırdan
//!   kurulmuş servis) `Motor::depo_degisti` koparmanın veri kısmını yapar, eşleşme kalır ve bağlantı yerel
//!   kipten bağlanma olarak sürer: servis değiştirme "koparma + bağlanma"dır. Yeni QR reddedilirse hiçbir
//!   şey değişmez (eski eşleşme ve bağlı kip sürer). Son geçişin özeti `meta.son_gecis`'tedir.
//! - Fark (D2 ikinci tur, "Alan alan birleşme" aşağıda): telefon koparma anındaki PC temelini
//!   (`sunucu_kayitlari`) depo değişse de bilir. Yalnız telefonun bu temelden farklı alanları telefonun
//!   değeriyle gider; telefonun dokunmadığı alanda PC kazanır. Aynı `depo_id`'de tam telafide PC yedekten
//!   dönmüşse (`DonusAnalizi`: yazım kimliği revizyon + PC saatiyle `guncelleme_ms`, revizyon büyüklüğü
//!   değil) PC'nin yitirdiği onaylı değerler de yeniden gider; hem yerel kipten bağlanmada hem bağlı kipte
//!   (`geri_donenleri_kuyruga_koy`).
//! - Bağlı kip + eşleşme yok açılışta yerel kipe çevrilir (`Motor::acilis_onarimi`); onarımın hatası açılışı
//!   düşürmez, izi `meta.onarim_hatasi`'na yazılır.
//! - Önizleme ve onay (D4): `birlestirme.rs`; iki tarafın da değiştirdiği alan önizlemede gösterilir, seçim yoktur.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use super::iyimser::{IyimserBaglam, Uygulama, gorunen_yenile, islem_coz, islem_uygula, iyimser_uygula, kayittan_govde, yazar};
use super::islem::kayit_farki;
use super::kanal::gecmis_satiri;
use super::{Asama, Etkiler, Motor, Ortam};
use crate::depo::{Depo, KopyaSatiri, KopyaTablosu, KuyrukSatiri, RetSatiri, anahtar};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{CalismaKipi, GecisNedeni, GecisOzeti, GecmisSayfasi, KoparmaSonucu};
use crate::model::sinirlar::ajanda::{GECMIS_SAYFA, KAYIT_ADET};
use crate::model::{
    AjandaGecmisGirdisi, AjandaIslem, AjandaKaydi, AjandaParca, AjandaRetNedeni, AjandaYazar, AjandaZamani, Alan,
    GirdiYolu, Hatirlatma, KayitDurumu, KaynakYolu, KuyrukRetNedeni, OrnekDurumu, TurKokeni, V3Alanlari, V3Degisikligi,
    ajanda_bolge_yeri_degisir_mi,
};

/// Servis retlerinin köprü hatası (yerelde kuyruk ve ret listesi yoktur: çağrı hata döner).
fn ret_hatasi(kayit_id: &str, n: AjandaRetNedeni) -> CekirdekHatasi {
    match n {
        AjandaRetNedeni::KayitBulunamadi => CekirdekHatasi::KayitYok { kayit_id: kayit_id.to_string() },
        AjandaRetNedeni::KayitSilinmis => CekirdekHatasi::GecersizDurum { mesaj: "kayıt silinmiş; önce geri yükle".into() },
        AjandaRetNedeni::OrnekGecersiz => CekirdekHatasi::GecersizGirdi {
            alan: "ornek_tarihi".into(),
            neden: "tekrarın örneği değil ya da örnek sınırı dolu".into(),
        },
        AjandaRetNedeni::SaatDilimiBilinmiyor => {
            CekirdekHatasi::GecersizGirdi { alan: "zaman.saat_dilimi".into(), neden: "saat dilimi bilinmiyor".into() }
        }
        AjandaRetNedeni::TutarsizKayit => {
            CekirdekHatasi::GecersizGirdi { alan: "kayit".into(), neden: "sonuç geçerli bir kayıt değil (tutarsiz_kayit)".into() }
        }
        n => CekirdekHatasi::GecersizDurum { mesaj: format!("işlem reddedildi: {}", n.ad()) },
    }
}

/// Dilim bilinmiyorsa `saat_dilimi_bilinmiyor` (servis `dilimlerBilinir`): `belirsiz` dışındaki zamanın ve
/// `mutlak` hatırlatmaların dilimi.
fn dilimler_bilinir(o: &Ortam, zaman: Option<&AjandaZamani>, hatirlatmalar: Option<&[Hatirlatma]>) -> Result<(), CekirdekHatasi> {
    let bilinir = |dilim: &str| o.zaman.andan_yerele(o.simdi_ms(), dilim.to_string()).is_ok();
    let zaman_dilimi = match zaman {
        Some(AjandaZamani::An { saat_dilimi, .. })
        | Some(AjandaZamani::Gun { saat_dilimi, .. })
        | Some(AjandaZamani::Donem { saat_dilimi, .. }) => Some(saat_dilimi.as_str()),
        Some(AjandaZamani::Belirsiz { .. }) | None => None,
    };
    if let Some(d) = zaman_dilimi
        && !bilinir(d)
    {
        return Err(CekirdekHatasi::GecersizGirdi { alan: "zaman.saat_dilimi".into(), neden: format!("saat dilimi bilinmiyor: {d}") });
    }
    for h in hatirlatmalar.unwrap_or(&[]) {
        if let Hatirlatma::Mutlak { saat_dilimi, .. } = h
            && !bilinir(saat_dilimi)
        {
            return Err(CekirdekHatasi::GecersizGirdi {
                alan: "hatirlatmalar".into(),
                neden: format!("saat dilimi bilinmiyor: {saat_dilimi}"),
            });
        }
    }
    Ok(())
}

/// `Option` alanın geçmiş parçası: yok `null` (`Kaldir`).
fn parca_alani<T: Clone>(v: &Option<T>) -> Alan<T> {
    v.clone().map_or(Alan::Kaldir, Alan::Deger)
}

/// Liste alanın geçmiş parçası: boş liste alan yoktur, `null` (`Kaldir`).
fn parca_listesi<T: Clone>(l: &[T]) -> Alan<Vec<T>> {
    if l.is_empty() { Alan::Kaldir } else { Alan::Deger(l.to_vec()) }
}

/// v3 alanlarının `fark` parçaları: yalnız değişenler, olmayan alan `null`.
fn v3_parcalari(o: &V3Alanlari, s: &V3Alanlari) -> (V3Degisikligi, V3Degisikligi) {
    let mut a = V3Degisikligi::default();
    let mut b = V3Degisikligi::default();
    if o.simge != s.simge {
        (a.simge, b.simge) = (parca_alani(&o.simge), parca_alani(&s.simge));
    }
    if o.bolge != s.bolge {
        (a.bolge, b.bolge) = (parca_alani(&o.bolge), parca_alani(&s.bolge));
    }
    if o.bolge_konumu != s.bolge_konumu {
        (a.bolge_konumu, b.bolge_konumu) = (parca_alani(&o.bolge_konumu), parca_alani(&s.bolge_konumu));
    }
    if o.varis != s.varis {
        (a.varis, b.varis) = (parca_alani(&o.varis), parca_alani(&s.varis));
    }
    if o.baglantilar != s.baglantilar {
        (a.baglantilar, b.baglantilar) = (parca_listesi(&o.baglantilar), parca_listesi(&s.baglantilar));
    }
    if o.ekler != s.ekler {
        (a.ekler, b.ekler) = (parca_listesi(&o.ekler), parca_listesi(&s.ekler));
    }
    (a, b)
}

/// Servisin `fark`'ı: izlenen alanlardan (kayıt alanları, v3 dahil, `taslak`, `silindi`) yalnız değişenlerin
/// öncesi ve sonrası; `ornekler` değiştiyse iki tam liste.
pub(super) fn fark(o: &AjandaKaydi, s: &AjandaKaydi) -> (AjandaParca, AjandaParca) {
    let mut a = AjandaParca::default();
    let mut b = AjandaParca::default();
    if o.tur != s.tur {
        (a.tur, b.tur) = (Some(o.tur), Some(s.tur));
    }
    if o.baslik != s.baslik {
        (a.baslik, b.baslik) = (Some(o.baslik.clone()), Some(s.baslik.clone()));
    }
    if o.aciklama != s.aciklama {
        (a.aciklama, b.aciklama) = (parca_alani(&o.aciklama), parca_alani(&s.aciklama));
    }
    if o.zaman != s.zaman {
        (a.zaman, b.zaman) = (parca_alani(&o.zaman), parca_alani(&s.zaman));
    }
    if o.hatirlatmalar != s.hatirlatmalar {
        (a.hatirlatmalar, b.hatirlatmalar) = (Some(o.hatirlatmalar.clone()), Some(s.hatirlatmalar.clone()));
    }
    if o.tekrar != s.tekrar {
        (a.tekrar, b.tekrar) = (parca_alani(&o.tekrar), parca_alani(&s.tekrar));
    }
    if o.durum != s.durum {
        (a.durum, b.durum) = (Some(o.durum), Some(s.durum));
    }
    if o.taslak != s.taslak {
        (a.taslak, b.taslak) = (Some(o.taslak), Some(s.taslak));
    }
    if o.silindi != s.silindi {
        (a.silindi, b.silindi) = (Some(o.silindi), Some(s.silindi));
    }
    if o.ornekler != s.ornekler {
        (a.ornekler, b.ornekler) = (Some(o.ornekler.clone()), Some(s.ornekler.clone()));
    }
    (a.v3, b.v3) = v3_parcalari(&o.v3, &s.v3);
    (a, b)
}

/// Servisin `dogumParcasi`'ı: kaydın var olan alanları (v3 dahil), durum ve taslak.
pub(super) fn dogum_parcasi(k: &AjandaKaydi) -> AjandaParca {
    AjandaParca {
        tur: Some(k.tur),
        baslik: Some(k.baslik.clone()),
        aciklama: k.aciklama.clone().map_or(Alan::Yok, Alan::Deger),
        zaman: k.zaman.clone().map_or(Alan::Yok, Alan::Deger),
        hatirlatmalar: Some(k.hatirlatmalar.clone()),
        tekrar: k.tekrar.clone().map_or(Alan::Yok, Alan::Deger),
        durum: Some(k.durum),
        taslak: Some(k.taslak),
        v3: k.v3.degisiklik(),
        ..Default::default()
    }
}

fn ornek_durumu(k: &AjandaKaydi, tarih: &str) -> Option<OrnekDurumu> {
    k.ornekler.iter().find(|o| o.tarih == tarih).map(|o| o.durum)
}

/// Bir yerel yazmanın geçmiş satırı (servisin `degistir`, `ekle`, `durumUygula` girdileriyle aynı anlam).
/// `yeni`'nin revizyonu ve `guncelleme_ms`'i satırın `rev`'i ve `ts_ms`'idir.
pub(crate) fn gecmis_girdisi(islem: &AjandaIslem, onceki: Option<&AjandaKaydi>, yeni: &AjandaKaydi, yazar: AjandaYazar) -> AjandaGecmisGirdisi {
    let mut temel_revizyon = None;
    let mut ornek_tarihi = None;
    let (onceki_p, sonraki_p) = match (islem, onceki) {
        (AjandaIslem::Ekle { .. }, _) | (_, None) => (AjandaParca::default(), dogum_parcasi(yeni)),
        (AjandaIslem::Durum { ornek_tarihi: Some(tarih), .. }, Some(o)) => {
            ornek_tarihi = Some(tarih.clone());
            // `ORNEK_ADET` için eski satır atıldıysa iki tam liste de girer.
            let atildi = o.ornekler.iter().any(|x| x.tarih != *tarih && !yeni.ornekler.iter().any(|y| y.tarih == x.tarih));
            let liste = |k: &AjandaKaydi| atildi.then(|| k.ornekler.clone());
            (
                AjandaParca { ornek_durumu: parca_alani(&ornek_durumu(o, tarih)), ornekler: liste(o), ..Default::default() },
                AjandaParca { ornek_durumu: parca_alani(&ornek_durumu(yeni, tarih)), ornekler: liste(yeni), ..Default::default() },
            )
        }
        (islem, Some(o)) => {
            if let AjandaIslem::Guncelle { temel_revizyon: t, .. } = islem {
                temel_revizyon = Some(*t);
            }
            fark(o, yeni)
        }
    };
    AjandaGecmisGirdisi {
        rev: yeni.revizyon,
        ts_ms: yeni.guncelleme_ms,
        islem: islem.tur(),
        yazar,
        temel_revizyon,
        korunan_alanlar: None,
        ornek_tarihi,
        onceki: onceki_p,
        sonraki: sonraki_p,
    }
}

impl Motor {
    pub(crate) fn yerel_mi(&self) -> Result<bool, CekirdekHatasi> {
        Ok(self.depo.yerel_kip_mi()?)
    }

    pub(crate) fn kip(&self) -> Result<CalismaKipi, CekirdekHatasi> {
        Ok(if self.yerel_mi()? { CalismaKipi::Yerel } else { CalismaKipi::Bagli })
    }

    /// Yerel kipin yazarı. Döner: bir şey yazıldı mı (yan etkisiz işlemde `false`).
    pub(crate) fn yerel_yaz(&mut self, o: &Ortam, e: &mut Etkiler, islem: AjandaIslem) -> Result<bool, CekirdekHatasi> {
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let kayit_id = islem.kayit_id().to_string();
        let onceki = self.depo.gorunen_kayit(&kayit_id)?.map(|g| g.kayit);
        match &islem {
            AjandaIslem::Ekle { govde, .. } => {
                dilimler_bilinir(o, govde.zaman.as_ref(), Some(&govde.hatirlatmalar))?;
                if self.depo.gorunen_sayisi()? >= KAYIT_ADET as i64 {
                    return Err(CekirdekHatasi::GecersizDurum {
                        mesaj: format!("kayit_siniri: en çok {KAYIT_ADET} kayıt (silinenler dahil)"),
                    });
                }
            }
            AjandaIslem::Guncelle { degisiklik, .. } if onceki.as_ref().is_some_and(|k| !k.silindi) => {
                let zaman = match &degisiklik.zaman {
                    Alan::Deger(z) => Some(z),
                    _ => None,
                };
                dilimler_bilinir(o, zaman, degisiklik.hatirlatmalar.as_deref())?;
            }
            _ => {}
        }
        let mut yeni = match islem_uygula(onceki.as_ref(), &islem, b.simdi_ms, &b) {
            Uygulama::Yeni(k) => *k,
            Uygulama::Etkisiz => return Ok(false),
            Uygulama::Ret(n) => return Err(ret_hatasi(&kayit_id, n)),
        };
        let yazan = yazar(&islem);
        let yazar = AjandaYazar {
            yol: yazan.yol,
            tur_kokeni: TurKokeni::Insan,
            device_id: Some(b.device_id.clone()),
            sohbet_id: None,
            oturum_id: None,
        };
        let girdi = self.depo.yazma(|d| {
            let rev = d.yerel_rev_sonraki(onceki.as_ref().map_or(0, |k| k.revizyon))?;
            yeni.revizyon = rev;
            let girdi = gecmis_girdisi(&islem, onceki.as_ref(), &yeni, yazar);
            d.gorunen_yaz(&yeni, false)?;
            d.yerel_rev_yaz(rev)?;
            d.yerel_gecmis_ekle(&kayit_id, &girdi)?;
            Ok(girdi)
        })?;
        self.gorunenler_degisti(o, e, std::slice::from_ref(&kayit_id));
        // Açık geçmiş sayfası yeni satırı (en büyük rev) başta görsün.
        if let Some(sayfa) = self.gecmis.get_mut(&kayit_id) {
            sayfa.satirlar.insert(0, gecmis_satiri(girdi));
            e.degisim.gecmis.push(kayit_id);
        }
        Ok(true)
    }

    /// Yerel kipte geçmiş: yerel tablodan hemen (bağlantısız) yüklenir, önbelleğe yazılır, `Degisim.gecmis`.
    /// Anlam servisin `gecmis`'idir: rev azalan, `GECMIS_SAYFA`'lık sayfalar, `once_rev` öncekilerin arkasına
    /// ekler; olmayan kayıt `kayit_bulunamadi`.
    pub(crate) fn yerel_gecmis_iste(&mut self, e: &mut Etkiler, kayit_id: &str, once_rev: Option<i64>) -> Result<(), CekirdekHatasi> {
        let var = self.depo.gorunen_ham(kayit_id)?.is_some();
        let mut girdiler = if var { self.depo.yerel_gecmis(kayit_id, once_rev, GECMIS_SAYFA + 1)? } else { Vec::new() };
        let devami = girdiler.len() > GECMIS_SAYFA;
        girdiler.truncate(GECMIS_SAYFA);
        let sayfa = self.gecmis.entry(kayit_id.to_string()).or_insert_with(|| GecmisSayfasi {
            kayit_id: kayit_id.to_string(),
            satirlar: Vec::new(),
            devami: false,
            yukleniyor: false,
            hata: None,
        });
        if once_rev.is_none() {
            sayfa.satirlar.clear();
        }
        sayfa.satirlar.extend(girdiler.into_iter().map(gecmis_satiri));
        sayfa.satirlar.sort_by_key(|s| std::cmp::Reverse(s.rev));
        sayfa.satirlar.dedup_by_key(|s| s.rev);
        sayfa.devami = devami && var;
        sayfa.yukleniyor = false;
        sayfa.hata = (!var).then_some(AjandaRetNedeni::KayitBulunamadi);
        e.degisim.gecmis.push(kayit_id.to_string());
        Ok(())
    }
}

/// Kaydın yerel hali `k`'yı PC'ye taşıyacak işlemler (`ts`: kuyruk satırının anı, iyimser hesap onu
/// kullanır). Temel (sunucu kopyası) yoksa telefonda doğmuştur: aynı kimlikle `ekle`, sonra durum, örnek
/// durumları ve silme. Temel varsa temel ile şimdiki hal arasındaki fark (`YOL-HARITASI.md` 3.3 "Bağlanma").
///
/// Gönderilmeyenler: temelsiz mezar taşı (PC'de hiç olmamış silinmiş kayıt; `ekle` + `sil` PC'nin
/// kayıt sınırını ölü kayıtla doldururdu) ve iki tarafta da silinmiş kayıt (alanlar farklı olsa da her
/// işlem `kayit_silinmis` alırdı). `geri_yukle_izni` yanlışsa temelde silinmiş kayıt geri yüklenmez (temel
/// servisin kendi kopyasıyken PC'nin silmesi meşrudur); öteki farklar yine gider ve servis onları
/// `kayit_silinmis` ile reddeder: telefonun hali düzeltme gövdesiyle ret listesine düşer. Silinecek (temelde
/// canlı, telefonda silinmiş) kaydın v3 farkı gönderilmez: v2 serviste ertelenip silmeyi bekletirdi.
pub(super) fn kuyruga_islemler(temel: Option<&AjandaKaydi>, k: &AjandaKaydi, geri_yukle_izni: bool) -> Vec<(AjandaIslem, i64)> {
    let kayit_id = || k.kayit_id.clone();
    let mut l = Vec::new();
    let ts = k.guncelleme_ms;
    let bos = AjandaKaydi { ornekler: vec![], durum: KayitDurumu::Acik, taslak: false, silindi: false, ..k.clone() };
    let t = match temel {
        None if k.silindi => return l,
        None => {
            let girdi_yolu = if k.kaynak.yol == KaynakYolu::SesliNot { GirdiYolu::SesliNot } else { GirdiYolu::Elle };
            l.push((AjandaIslem::Ekle { kayit_id: kayit_id(), govde: kayittan_govde(k), v3: k.v3.clone(), girdi_yolu }, k.olusturma_ms));
            &bos
        }
        Some(t) if t.silindi && k.silindi => return l,
        Some(t) => t,
    };
    if t.silindi && !k.silindi && geri_yukle_izni {
        l.push((AjandaIslem::GeriYukle { kayit_id: kayit_id() }, ts));
    }
    let mut degisiklik = kayit_farki(t, k);
    // Silinecek kaydın v3 farkı gitmez (R5): eski (v2) serviste ertelenir ve arkasındaki `sil`'in sırasını tutar
    // (`kanal.rs` "Sıra"), silme servis güncellenene dek süresiz beklerdi. Gövde farkı gider.
    if !t.silindi && k.silindi {
        degisiklik.v3 = V3Degisikligi::default();
    }
    if !degisiklik.bos_mu() {
        l.push((AjandaIslem::Guncelle { kayit_id: kayit_id(), temel_revizyon: t.revizyon, degisiklik }, ts));
    }
    if t.durum != k.durum {
        l.push((AjandaIslem::Durum { kayit_id: kayit_id(), durum: k.durum, ornek_tarihi: None }, ts));
    }
    let mut tarihler: Vec<&str> = t.ornekler.iter().chain(&k.ornekler).map(|o| o.tarih.as_str()).collect();
    tarihler.sort_unstable();
    tarihler.dedup();
    for tarih in tarihler {
        let (once, simdi) = (ornek_durumu(t, tarih), ornek_durumu(k, tarih));
        if once != simdi {
            let durum = match simdi {
                Some(OrnekDurumu::Tamam) => KayitDurumu::Tamam,
                Some(OrnekDurumu::Iptal) => KayitDurumu::Iptal,
                None => KayitDurumu::Acik,
            };
            l.push((AjandaIslem::Durum { kayit_id: kayit_id(), durum, ornek_tarihi: Some(tarih.to_string()) }, ts));
        }
    }
    if t.taslak && !k.taslak {
        l.push((AjandaIslem::Onayla { kayit_id: kayit_id() }, ts));
    }
    if !t.silindi && k.silindi {
        l.push((AjandaIslem::Sil { kayit_id: kayit_id() }, ts));
    }
    l
}

/// İki hal PC'ye gidecek her alanda aynı mı (gövde, v3 alanları, durum, örnekler, taslak, silindi; revizyon,
/// zaman damgaları ve kaynak sayılmaz).
pub(super) fn icerik_ayni(a: &AjandaKaydi, b: &AjandaKaydi) -> bool {
    kayittan_govde(a) == kayittan_govde(b)
        && a.v3 == b.v3
        && a.durum == b.durum
        && a.ornekler == b.ornekler
        && a.taslak == b.taslak
        && a.silindi == b.silindi
}

// ---------------------------------------------------------------------------------------------
// Yedekten dönme denetimi (D2 ikinci tur)
// ---------------------------------------------------------------------------------------------

/// Bir yazımın kimliği: revizyon ve PC saatiyle `guncelleme_ms` (servisin telafi izi `ajandaTelafiTamMi`
/// gibi). Yedekten dönen servis revizyon numaralarını yeniden verir: numaranın büyüklüğü tek başına ilerleme
/// demek değildir, aynı numara başka yazım olabilir.
type Iz = (i64, i64);

fn izler(satirlar: &[KopyaSatiri]) -> BTreeMap<String, Iz> {
    satirlar.iter().map(|s| (s.kayit_id.clone(), (s.revizyon, s.guncelleme_ms))).collect()
}

/// Telefonun bildiği yazımın (eski temel `o`) PC'nin yeni kopyasındaki (`n`) karşılığı.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Soy {
    /// Aynı yazım: PC telefonun bildiği hali taşıyor.
    Ayni,
    /// Telefonun bildiği yazım PC'de yok: kayıt yok (servis kayıt silmez), revizyonu küçük, aynı numarada
    /// başka yazım, ya da numarası büyük ama PC saatiyle daha eski (meşru ilerleme `guncelleme_ms`'i
    /// küçültmez: servis `max(şimdi, önceki)` yazar).
    Kayip,
    /// Numarası büyük, zamanı geride değil: meşru ilerleme ya da dönüşten sonra yeniden yazılmış;
    /// `DonusAnalizi` depo düzeyindeki kanıtla ayırır.
    Ileride,
}

/// `iyimser`: telefonun bildiği hal PC'den gelmedi, onaylanmış işlemin iyimser sonucudur (revizyonu
/// `son_rev`'in üstünde; `guncelleme_ms`'i telefon saatiyle): yalnız revizyonu karşılaştırılır, aynı
/// numara servisin gerçek sonucudur.
fn soy(o: Iz, iyimser: bool, n: Option<Iz>) -> Soy {
    let Some((n_rev, n_ms)) = n else { return Soy::Kayip };
    let (o_rev, o_ms) = o;
    if n_rev == o_rev {
        return if iyimser || n_ms == o_ms { Soy::Ayni } else { Soy::Kayip };
    }
    if n_rev < o_rev || (!iyimser && n_ms < o_ms) {
        return Soy::Kayip;
    }
    Soy::Ileride
}

/// Kaydın PC'deki yeni halinin telefonun bildiği son PC haline göre durumu (`hedef_hal`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct PcDurumu {
    /// PC telefonun bildiği yazımı yitirmiş (yedekten dönmüş): telefonun dokunmadığı ama PC'de farklı
    /// alanda telefonun bildiği değer yeniden gider.
    eksik: bool,
    /// PC kaydının son yazımı telefonun bildiğinden eski (PC saatiyle): PC'nin hali dönmüş bir haldir,
    /// dönüşten sonra yazılmamıştır.
    eskimis: bool,
}

/// Aynı `depo_id`'nin tam kopyasında PC yedekten dönmüş mü, döndüyse telefonun bildiği hangi yazımlar
/// kalmış. Temel: telefonun PC temeli (`sunucu_kayitlari`) servisin `son_rev` anındaki tam kopyasıdır
/// (onaylanmış işlemlerin iyimser sonuçları `son_rev`'in üstünde). Yedekten dönen servis bir `b < son_rev`
/// anına döner: revizyonu `b`'ye kadar olan yazımlar kalır, sonrakiler gider, dönüşten sonraki yazımlar
/// `b + 1`'den yeniden numara alır.
///
/// Kanıt: kalan yazım (aynı kimlik) `b`'nin alt sınırını (`korunan_ust`), kayıp yazım ve yeniden verilmiş
/// numara (yeni kopyada `son_rev`'e kadar numarası olup temelde o yazımı olmayan kayıt) üst sınırını verir.
/// Hiç kayıp kanıtı yoksa dönüş yoktur: her kayıt meşru ilerlemiştir. Kanıt varsa telefonun bildiği yazımı
/// kalmış sayılan kayıt yalnız `korunan_ust`'e kadar olandır; üstündeki `Ileride` kayıt yitirilmiş sayılır
/// (kanıtlanamayan kalış, iki yönde de iz bırakan yola, yeniden göndermeye gider: PC'nin değeri PC
/// geçmişinde kalır, telefonun yitirilen değeri ise başka hiçbir yerde yoktur).
struct DonusAnalizi {
    son_rev: i64,
    donmus: bool,
    korunan_ust: i64,
}

impl DonusAnalizi {
    /// `temeller`: telefonun bildiği haller (bağlı kipte onaylanmışlar uygulanmış); `sunucu`: PC temelinin
    /// satırları; `yeni`: servisin tam kopyası; `iz_kaybi`: servis aynı depoyla tam dedi ve telefon izini
    /// (revizyonu `son_rev` olan yazım) yollamıştı, yani o yazım PC'de yok (`kural::telafi`).
    fn kur(temeller: &BTreeMap<String, Iz>, sunucu: &BTreeMap<String, Iz>, yeni: &BTreeMap<String, Iz>, son_rev: i64, iz_kaybi: bool) -> Self {
        let mut korunan_ust = 0;
        let mut kayip_alt = if iz_kaybi { son_rev } else { i64::MAX };
        for (kayit_id, &o) in temeller {
            match soy(o, o.0 > son_rev, yeni.get(kayit_id).copied()) {
                Soy::Ayni => korunan_ust = korunan_ust.max(o.0),
                Soy::Kayip => kayip_alt = kayip_alt.min(o.0),
                Soy::Ileride => {}
            }
        }
        for (kayit_id, &(rev, ms)) in sunucu {
            if rev <= son_rev && yeni.get(kayit_id) == Some(&(rev, ms)) {
                korunan_ust = korunan_ust.max(rev);
            }
        }
        // `son_rev`'e kadar her yazım temelde vardır: temelin bu kayıt için daha küçük numarası (ya da hiç
        // kaydı) varsa yeni kopyadaki numara dönüşten sonra yeniden verilmiştir.
        for (kayit_id, &(rev, _)) in yeni {
            let bilinen = sunucu.get(kayit_id).or_else(|| temeller.get(kayit_id)).map(|i| i.0);
            if rev <= son_rev && bilinen.is_none_or(|b| b < rev) {
                kayip_alt = kayip_alt.min(rev);
            }
        }
        DonusAnalizi { son_rev, donmus: kayip_alt != i64::MAX, korunan_ust }
    }

    /// Telefonun bildiği yazım `o` PC'nin yeni kopyasında (`n`; yoksa kayıt PC'de yok) yitirilmiş mi.
    fn eksik(&self, o: Iz, n: Option<Iz>) -> bool {
        match soy(o, o.0 > self.son_rev, n) {
            Soy::Ayni => false,
            Soy::Kayip => true,
            Soy::Ileride => self.donmus && o.0 > self.korunan_ust,
        }
    }

    fn durum(&self, o: &AjandaKaydi, n: &AjandaKaydi) -> PcDurumu {
        let iyimser = o.revizyon > self.son_rev;
        let eksik = self.eksik((o.revizyon, o.guncelleme_ms), Some((n.revizyon, n.guncelleme_ms)));
        PcDurumu { eksik, eskimis: !iyimser && n.guncelleme_ms < o.guncelleme_ms }
    }
}

// ---------------------------------------------------------------------------------------------
// Alan alan birleşme
// ---------------------------------------------------------------------------------------------

/// Kayıt JSON'unun içerik dışı anahtarları (kimlik, revizyon, kaynak izi, zaman damgaları): birleşmeye
/// girmez. Geri kalan her anahtar (bugünküler ve şema genişleyince gelecekler) içerik alanıdır.
const ICERIK_DISI: [&str; 6] = ["kayit_id", "revizyon", "elle_alanlar", "kaynak", "olusturma_ms", "guncelleme_ms"];

/// Alanın değeri; "alan yok" (anahtar yok, `null`, boş liste ya da `false`) `None`'dır (Kol C kuralı).
fn alan<'a>(j: &'a Map<String, Value>, ad: &str) -> Option<&'a Value> {
    j.get(ad).filter(|v| !matches!(v, Value::Null | Value::Bool(false)) && v.as_array().is_none_or(|a| !a.is_empty()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Taraf {
    Telefon,
    Pc,
}

/// Bir alanda (ya da tekrarın bir örneğinde) kalacak taraf. `o` telefonun bildiği son PC değeri, `p`
/// telefonun değeri, `n` PC'nin yeni değeri.
/// - Telefon değiştirdiyse (`p != o`) telefonun değeri; iki taraf da değiştirdiyse de (önizlemede gösterilir, D4).
/// - Değiştirmediyse PC'nin değeri; PC telefonun bildiği yazımı yitirmişse (`eksik`) yitirilen değer
///   yeniden gider, ama temelde bulunmayan alan PC değişikliğidir, geri gönderilmez (yokluk hiçbir zaman
///   "kaldırıldı" sayılmaz). Silme ya da geri yükleme yalnız PC'nin hali dönmüş haldeyse (`eskimis`)
///   yeniden gider: dönüşten sonraki mezar taşı PC'nin kararıdır. Var olan kayıt taslağa dönmez: PC'deki
///   taslak işareti dönmüş haldir, onay yeniden gider.
fn taraf_sec(ad: &str, o: Option<&Value>, p: Option<&Value>, n: Option<&Value>, pc: PcDurumu) -> Taraf {
    if p != o {
        return Taraf::Telefon;
    }
    if n == o || !pc.eksik {
        return Taraf::Pc;
    }
    let geri_gider = match ad {
        "silindi" => pc.eskimis,
        "taslak" => true,
        _ => o.is_some(),
    };
    if geri_gider { Taraf::Telefon } else { Taraf::Pc }
}

/// Tekrarın örnekleri tarih tarih birleşir (`kuyruga_islemler` de örnek başına işlem yollar).
fn ornekleri_birlestir(o: &Map<String, Value>, p: &Map<String, Value>, n: &Map<String, Value>, pc: PcDurumu) -> Value {
    let (om, pm, nm) = (tarihli_ornekler(o), tarihli_ornekler(p), tarihli_ornekler(n));
    let tarihler: BTreeSet<&String> = om.keys().chain(pm.keys()).chain(nm.keys()).collect();
    let mut l = Vec::new();
    for t in tarihler {
        let secilen = match taraf_sec("ornek", om.get(t), pm.get(t), nm.get(t), pc) {
            Taraf::Telefon => pm.get(t),
            Taraf::Pc => nm.get(t),
        };
        l.extend(secilen.cloned());
    }
    Value::Array(l)
}

/// PC'nin yeni halinin (`n`) gideceği hal: alan alan `taraf_sec`; içerik dışı alanlar telefonun halinden
/// (`p`; işlemlerin anı onun `guncelleme_ms`'i). Birleşen hal geçerli bir kayıt değilse `None`
/// (alanlar birbirini tutmuyor, ör. PC tekrarı kaldırdı, telefon örnek işaretledi).
fn hedef_hal(o: &AjandaKaydi, p: &AjandaKaydi, n: &AjandaKaydi, pc: PcDurumu) -> Option<AjandaKaydi> {
    let (Value::Object(oj), Value::Object(pj), Value::Object(nj)) = (o.json(), p.json(), n.json()) else { return None };
    let adlar: BTreeSet<&String> = oj.keys().chain(pj.keys()).chain(nj.keys()).filter(|a| !ICERIK_DISI.contains(&a.as_str())).collect();
    let mut t = pj.clone();
    for ad in adlar {
        if ad == "ornekler" {
            t.insert(ad.clone(), ornekleri_birlestir(&oj, &pj, &nj, pc));
        } else if taraf_sec(ad, alan(&oj, ad), alan(&pj, ad), alan(&nj, ad), pc) == Taraf::Pc {
            match nj.get(ad) {
                Some(v) => t.insert(ad.clone(), v.clone()),
                None => t.remove(ad),
            };
        }
    }
    AjandaKaydi::oku(&Value::Object(t), "").ok()
}

/// `birlesme_islemleri`'nin sonucu.
#[derive(Debug, PartialEq)]
enum Birlesme {
    /// Kuyruğa girecek işlemler (boş olabilir).
    Islemler(Vec<(AjandaIslem, i64)>),
    /// Hiçbir işlem gitmez; telefonun hali düzeltme gövdesiyle ret listesine (`kaydi_ret_listesine`).
    RetListesine,
}

/// Bir kaydın yerel halini (`p`) PC'nin yeni kopyasına (`n`) taşıyacak işlemler; `o` telefonun bildiği son
/// PC hali (eski temel; depo değişse de). İşlemler `n`'den `hedef_hal`'e giden farktır: PC'de zaten olan
/// değer yeniden gitmez. `temel_revizyon` aynı depoda PC eski temeli taşıyorsa ondan, başka depoda ya da PC
/// yitirmişse yeni kopyadan.
/// - İki tarafta da silinmiş: hiçbir işlem.
/// - Eski temel kaydı bilmiyor (yolda kalmış ekleme): telefonun PC'den farklı her alanı gider, PC'de
///   silinmiş kayıt diriltilmez.
/// - PC telefonun bildiği yazımı taşıyor ya da başka depo (`!pc.eksik`): yalnız telefonun eski temelden
///   farklı alanları gider, telefonun dokunmadığı alanda PC kazanır. Temelde silinmiş kaydı telefon geri
///   yüklediyse yalnız aynı depoda `geri_yukle`.
/// - PC yitirmiş (`pc.eksik`, yalnız aynı depo): yitirilen değerler de gider (`taraf_sec`).
/// - PC'nin silmesi geçerli kalırsa telefonun öteki farkları `geri_yukle`'siz gider: servis `kayit_silinmis`
///   ile reddeder, telefonun hali düzeltme gövdesiyle ret listesine düşer (sessizce kaybolmaz).
/// - Birleşen hal geçerli bir kayıt değilse (alanlar birbirini tutmuyor): PC yitirmemişse yalnız telefonun
///   eski temelden değiştirdikleri gider (servis tutarsız sonucu `tutarsiz_kayit` ile reddeder, telefonun
///   hali ret listesine düşer); PC yitirmişse hiçbir işlem gitmez, PC'nin hali kalır ve telefonun hali
///   düzeltme gövdesiyle ret listesine girer (`Birlesme::RetListesine`): yitirilen değer kaybolmaz, PC'nin
///   dönüşten sonraki silmesi ve eklediği alan da (geri yükleme ya da kaldırma gitmez).
fn birlesme_islemleri(o: Option<&AjandaKaydi>, p: &AjandaKaydi, n: &AjandaKaydi, pc: PcDurumu, ayni_depo: bool) -> Birlesme {
    if p.silindi && n.silindi {
        return Birlesme::Islemler(Vec::new());
    }
    let Some(o) = o else { return Birlesme::Islemler(kuyruga_islemler(Some(n), &pc_v3_alanlariyla(p, n), false)) };
    // Aynı depoda PC eski temeli taşıyorsa fark ona göredir; başka depoda ya da PC yitirmişse yeni kopyaya.
    let temel_rev = if ayni_depo && !pc.eksik { o.revizyon } else { n.revizyon };
    let mut l = match hedef_hal(o, p, n, pc) {
        Some(mut t) => {
            let mut izin = ayni_depo;
            if t.silindi && n.silindi && !p.silindi {
                t.silindi = false;
                izin = false;
            }
            kuyruga_islemler(Some(n), &t, izin)
        }
        None if pc.eksik => return Birlesme::RetListesine,
        None => kuyruga_islemler(Some(o), p, ayni_depo),
    };
    for (islem, _) in &mut l {
        if let AjandaIslem::Guncelle { temel_revizyon, .. } = islem {
            *temel_revizyon = temel_rev;
        }
    }
    Birlesme::Islemler(l)
}

/// Temeli bilinmeyen kaydın (`birlesme_islemleri`) telefonda olmayıp PC'de olan v3 alanları PC'nin
/// değişikliğidir, geri gönderilmez (yokluk hiçbir zaman "kaldırıldı" sayılmaz, Kol C kuralı): fark bu alanlarda
/// PC'nin değeriyle hesaplanır. Telefonun bölgesi PC'ninkinden başka bir yerse PC'nin konumu alınmaz (o
/// yerin konumudur; servis yer değişince konumu zaten düşürür). `varis` bölgeye bağlıdır, bölgesinden kopmaz
/// (R10): PC'nin varışı yalnız bölge PC'den geliyorsa ya da aynı yerse alınır (telefonun başka bir bölgesine
/// taşınmaz); telefonda bölge yoksa PC'nin bölgesi, konumu ve varışı birlikte alınır. Bölge, konum ve varışın
/// tek birim olarak birleşmesi R2'dir (L1 ile).
pub(super) fn pc_v3_alanlariyla(p: &AjandaKaydi, n: &AjandaKaydi) -> AjandaKaydi {
    fn doldur<T: Clone>(p: &mut Option<T>, n: &Option<T>) {
        if p.is_none() {
            p.clone_from(n);
        }
    }
    let mut k = p.clone();
    let (v, pc) = (&mut k.v3, &n.v3);
    doldur(&mut v.simge, &pc.simge);
    if v.bolge.is_none() || !ajanda_bolge_yeri_degisir_mi(pc.bolge.as_deref(), v.bolge.as_deref()) {
        doldur(&mut v.bolge, &pc.bolge);
        doldur(&mut v.bolge_konumu, &pc.bolge_konumu);
        doldur(&mut v.varis, &pc.varis);
    }
    if v.baglantilar.is_empty() {
        v.baglantilar.clone_from(&pc.baglantilar);
    }
    if v.ekler.is_empty() {
        v.ekler.clone_from(&pc.ekler);
    }
    k
}

/// PC temelindeki kaydın hali. Satırı okunamayan temel (bozuk satır) bilinmiyor sayılır (`Err(())`, çağıran
/// sayar): tek kaydın sorunu geçişi kilitlemez. Depo hatası yukarı gider.
fn sunucu_temeli(d: &Depo, kayit_id: &str) -> Result<Result<Option<AjandaKaydi>, ()>, CekirdekHatasi> {
    Ok(match d.sunucu_ham(kayit_id)? {
        None => Ok(None),
        Some(json) => kayit_coz(&json).map(Some).ok_or(()),
    })
}

/// PC temelinin (sunucu kopyası) okunamayan satır sayısı.
fn okunamayan_temel_sayisi(d: &Depo) -> Result<usize, CekirdekHatasi> {
    Ok(d.kopya_satirlari(KopyaTablosu::Sunucu)?.iter().filter(|s| kayit_coz(&s.json).is_none()).count())
}

/// Okunamayan görünen satırın içerik alanları PC'deki kaydınkilerle aynı mı (yokluk Kol C kuralıyla): öyleyse
/// satırın bozukluğu içerik dışındadır, PC'nin hali hiçbir şey yitirmeden yerine geçer.
fn ham_icerik_ayni(json: &str, n: &AjandaKaydi) -> bool {
    let (Ok(Value::Object(a)), Value::Object(b)) = (serde_json::from_str::<Value>(json), n.json()) else { return false };
    a.keys().chain(b.keys()).filter(|k| !ICERIK_DISI.contains(&k.as_str())).all(|k| alan(&a, k) == alan(&b, k))
}

/// Görünen satırın kaydı (`kopya::kayit_json_oku` gibi); okunamazsa `None`.
pub(super) fn kayit_coz(json: &str) -> Option<AjandaKaydi> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    AjandaKaydi::oku(&v, "").ok()
}

/// Telefonun bir kayıt hali (okunamayan görünen satırın metni ya da birleşemeyen kaydın JSON'u) kaybolmadan
/// ret listesine düşer: metin olduğu gibi `islem_json`'da (ret listesi okunamayan işlemi `guncelle` sayıp
/// gösterir), okunabiliyorsa gövdesi düzeltme formunda, neden `tutarsiz_kayit`. Tek sonuç: kayıt PC'de varsa
/// görünen kopyada PC'nin hali durur ve girdi o kaydın düzeltmesidir (düzeltme aynı kayda uygulanır, Kotlin
/// `RetListesi.hedef` `MevcutKayit`; PC'de silinmişse yeni kayıt); PC'de yoksa (yalnız okunamayan satır)
/// kayıt görünen kopyadan çıkar, düzeltme yeni kayıt olarak eklenir.
pub(super) fn kaydi_ret_listesine(d: &Depo, o: &Ortam, kayit_id: &str, json: &str, ts_ms: i64) -> Result<(), CekirdekHatasi> {
    let govde_json = serde_json::from_str::<serde_json::Value>(json).ok().and_then(|v| {
        let mut n = crate::model::json::Nesne::ac(&v, "").ok()?;
        let g = crate::model::KayitGovdesi::alanlari_oku(&mut n).ok()?;
        Some(g.alanlari_yaz(crate::model::json::Yazici::yeni()).bitir().to_string())
    });
    d.ret_ekle(&RetSatiri {
        islem_id: Motor::yeni_kimlik(o, "i_")?,
        kayit_id: kayit_id.to_string(),
        islem_json: json.to_string(),
        neden: KuyrukRetNedeni::TutarsizKayit.ad().to_string(),
        ts_ms,
        govde_json,
        sira: 0,
    })
}

/// Bir görünen kaydın yerel kipten bağlanmadaki sınıfı (`dokme_plani`; önizlemesi `birlestirme.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DokmeSinifi {
    /// Servisin kopyasında yok, canlı: aynı kimlikle `ekle` (ardından durum, örnekler).
    Yeni,
    /// Servisin kopyasında var; telefonun farkı (aynı depoda PC'nin yitirdiği değerler de) gider.
    Degisen,
    /// Servisin kopyasında silinmiş (silme geçerli), telefonun farkları geri yüklemesiz gider: servis
    /// `kayit_silinmis` ile reddeder, telefonun hali düzeltme gövdesiyle ret listesine düşer.
    PcSilmis,
    /// Hiçbir işlem gitmez: iki taraf aynı, yalnız PC ilerlemiş (PC'nin hali görünür), iki tarafta silinmiş ya
    /// da okunamayan satırın içeriği PC'dekiyle aynı.
    Ayni,
    /// Dökmede hemen ret listesine: okunamayan satır ya da PC yitirmiş ama birleşen hal geçerli değil.
    RetListesine,
    /// Telefonda silinmiş, servisin kopyasında yok (temelsiz mezar taşı): gönderilmez, görünen kopyadan
    /// (Silinenler) düşer.
    DusecekMezar,
    /// Taslak, servisin kopyasında yok (bağlantıdan kalan öneri başka servise ya da PC'nin yitirdiği öneri):
    /// servis kaydı taslak olarak alamaz (`ekle` onaylanmış kayıt doğurur). Gönderilmez, kullanıcının
    /// onaylamadığı öneri onaylanmış sayılmaz; kaybolmaz da: ret listesine düşer (düzeltme yeni, onaylı kayıt
    /// ekler), görünen kopyadan çıkar (bağlı kipte sunucusuz ve kuyruksuz satır sahipsizdir).
    Taslak,
}

/// `dokme_plani`'nın bir kaydı.
pub(crate) struct KayitPlani {
    pub kayit_id: String,
    pub sinif: DokmeSinifi,
    /// Kuyruğa girecek işlemler (`Yeni`, `Degisen`, `PcSilmis`'te dolu).
    pub islemler: Vec<(AjandaIslem, i64)>,
    /// Ret listesine düşecek telefon hali (`kaydi_ret_listesine`'nin metni).
    pub ret_json: Option<String>,
    /// Görünen kopyadan çıkar (PC'de olmayan mezar taşı ya da okunamayan satır).
    pub cikar: bool,
    /// `Degisen`'de iki tarafın da (telefonun bildiği son PC halinden) değiştirdiği içerik alanları:
    /// telefonun değeri kazanır (`taraf_sec`).
    pub cakisan_alanlar: Vec<String>,
    /// Telefonun okunabilen hali.
    pub telefon: Option<AjandaKaydi>,
}

/// Yerel kipten bağlanmanın planı (salt okur): görünen kopyanın her satırı için ne olacağı.
pub(crate) struct DokmePlani {
    /// Servisin `depo_id`'si telefonun PC temelininkiyle aynı (aynı servise dönüş).
    pub ayni_depo: bool,
    pub kayitlar: Vec<KayitPlani>,
    /// Servisin kopyasında olan telefon kayıtlarından PC temeli satırı okunamayanlar (temel bilinmiyor
    /// sayıldı: telefonun servistekinden farklı her alanı gider).
    pub okunamayan_temel: usize,
}

/// Okunan JSON nesnesi (değilse boş).
fn nesne(k: &AjandaKaydi) -> Map<String, Value> {
    match k.json() {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// Tekrarın örnekleri tarihleriyle.
fn tarihli_ornekler(j: &Map<String, Value>) -> BTreeMap<String, Value> {
    j.get("ornekler")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|x| Some((x.get("tarih")?.as_str()?.to_string(), x.clone())))
        .collect()
}

/// İki tarafın da değiştirdiği içerik alanları: telefonun değeri (`p`) ve PC'nin yeni değeri (`n`) farklı ve
/// ikisi de telefonun bildiği son PC halinden (`o`) farklı (yokluk Kol C kuralıyla, örnekler tarih tarih).
/// Temel bilinmiyorsa (`o` yok) telefonun PC'den farklı her alanı sayılır: hepsi gider ve PC'ninkini ezer.
pub(crate) fn cakisan_alanlar(o: Option<&AjandaKaydi>, p: &AjandaKaydi, n: &AjandaKaydi) -> Vec<String> {
    let (pj, nj) = (nesne(p), nesne(n));
    let oj = o.map(nesne);
    let bos = Map::new();
    let tj = oj.as_ref().unwrap_or(&bos);
    let cakisir = |o: Option<&Value>, p: Option<&Value>, n: Option<&Value>| p != n && (oj.is_none() || (p != o && n != o));
    let adlar: BTreeSet<&String> = pj.keys().chain(nj.keys()).chain(tj.keys()).filter(|a| !ICERIK_DISI.contains(&a.as_str())).collect();
    adlar
        .into_iter()
        .filter(|ad| {
            if ad.as_str() == "ornekler" {
                let (om, pm, nm) = (tarihli_ornekler(tj), tarihli_ornekler(&pj), tarihli_ornekler(&nj));
                om.keys().chain(pm.keys()).chain(nm.keys()).any(|t| cakisir(om.get(t), pm.get(t), nm.get(t)))
            } else {
                cakisir(alan(tj, ad), alan(&pj, ad), alan(&nj, ad))
            }
        })
        .cloned()
        .collect()
}

/// Yerel kipten bağlı kipe geçişin planı (salt okur; `birlestirme.rs` önizler, onayda işlemin içinde yeniden
/// kurar). Servisin tam kopyası `telafi_kayitlari`'nda, koparma anındaki PC temeli `sunucu_kayitlari`'nda ve
/// `meta.depo_id`'dedir. Her görünen (yerel) kayıt için işlemler `birlesme_islemleri` ile (servisin kopyasında
/// yoksa `ekle`; varsa eski temele göre alan alan, aynı depoda `DonusAnalizi` ile) bulunur.
pub(crate) fn dokme_plani(d: &Depo, depo_id: &str) -> Result<DokmePlani, CekirdekHatasi> {
    let ayni_depo = d.depo_id()?.as_deref() == Some(depo_id);
    let analiz = if ayni_depo {
        let sunucu = izler(&d.kopya_satirlari(KopyaTablosu::Sunucu)?);
        let yeni = izler(&d.kopya_satirlari(KopyaTablosu::Telafi)?);
        // Yerel kipte `hello` boş gider: servisin iz kararı yoktur, kanıt yalnız kopyalardandır.
        Some(DonusAnalizi::kur(&sunucu, &sunucu, &yeni, d.son_rev()?, false))
    } else {
        None
    };
    let mut kayitlar = Vec::new();
    let mut okunamayan_temel = 0;
    for (kayit_id, json) in d.gorunen_ham_hepsi()? {
        let mut p = KayitPlani {
            kayit_id: kayit_id.clone(),
            sinif: DokmeSinifi::Ayni,
            islemler: Vec::new(),
            ret_json: None,
            cikar: false,
            cakisan_alanlar: Vec::new(),
            telefon: None,
        };
        let Some(k) = kayit_coz(&json) else {
            let pc_hali = d.telafi_kaydi(&kayit_id)?;
            if !pc_hali.as_ref().is_some_and(|n| ham_icerik_ayni(&json, n)) {
                p.sinif = DokmeSinifi::RetListesine;
                p.ret_json = Some(json);
            }
            // PC'de varsa satır dökmede PC'nin haliyle yeniden yazılır (`gorunenden_farkli_sunucu_kayitlari`).
            p.cikar = pc_hali.is_none();
            kayitlar.push(p);
            continue;
        };
        match d.telafi_kaydi(&kayit_id)? {
            // PC'de yok (telefonda doğdu ya da PC yitirdi): `ekle`; PC'de olmayan mezar taşı gitmez.
            None if k.silindi => {
                p.sinif = DokmeSinifi::DusecekMezar;
                p.cikar = true;
            }
            None if k.taslak => {
                p.sinif = DokmeSinifi::Taslak;
                p.ret_json = Some(k.json().to_string());
                p.cikar = true;
            }
            None => {
                p.sinif = DokmeSinifi::Yeni;
                p.islemler = kuyruga_islemler(None, &k, false);
            }
            Some(n) => {
                let temel = sunucu_temeli(d, &kayit_id)?.unwrap_or_else(|()| {
                    okunamayan_temel += 1;
                    None
                });
                let pc = match (&analiz, &temel) {
                    (Some(a), Some(t)) => a.durum(t, &n),
                    _ => PcDurumu::default(),
                };
                match birlesme_islemleri(temel.as_ref(), &k, &n, pc, ayni_depo) {
                    Birlesme::Islemler(l) if l.is_empty() => {}
                    Birlesme::Islemler(l) => {
                        let geri_yukle = l.iter().any(|(i, _)| matches!(i, AjandaIslem::GeriYukle { .. }));
                        if n.silindi && !k.silindi && !geri_yukle {
                            p.sinif = DokmeSinifi::PcSilmis;
                        } else {
                            p.sinif = DokmeSinifi::Degisen;
                            p.cakisan_alanlar = cakisan_alanlar(temel.as_ref(), &k, &n);
                        }
                        p.islemler = l;
                    }
                    // Görünen satır dökmede PC'nin haliyle yeniden yazılır; telefonun hali ret listesinde.
                    Birlesme::RetListesine => {
                        p.sinif = DokmeSinifi::RetListesine;
                        p.ret_json = Some(k.json().to_string());
                    }
                }
            }
        }
        p.telefon = Some(k);
        kayitlar.push(p);
    }
    Ok(DokmePlani { ayni_depo, kayitlar, okunamayan_temel })
}

/// Yerel kipten bağlı kipe: `dokme_plani`'nın uygulanması, çağıranın tek işleminde (`birlestirme.rs`: soru
/// gerekmeyen `esitlendi` ya da kullanıcının onayı). Plan aynı işlemde kurulmuş olmalıdır. Planın işlemleri
/// kuyruğa girer; ret halleri ret listesine (`kaydi_ret_listesine`; tek kaydın sorunu geçişi durdurmaz);
/// sonra toplanan kopya sunucu kopyasının yerine geçer, `depo_id` ve `son_rev` yazılır, kip `bagli` olur ve
/// görünen kopya bağlı kipin tam telafi sonundaki gibi sunucu + kuyruktan yeniden hesaplanır (yalnız PC'de
/// olanlar eklenir). İşlemler bugünkü kuyruğa koyma yoluyla (`kuyruga_ekle`) girer.
///
/// Değişmez: her canlı yerel kayıt ya görünen kopyada kalır (kuyruktaki işlemi iyimser görünür ya da kayıt
/// servisin kopyasında vardır) ya da ret listesine düşer (servis işlemi reddetti, satır okunamadı, PC
/// yitirmiş ama birleşen hal geçerli değil ya da serviste olmayan taslak). Kuyruğa hiçbir işlemi girmeyen
/// kayıt servisin kopyasındadır (temelsiz canlı onaylı kayıt hep `ekle` alır). Görünen kopyadan yalnız PC'de
/// olmayan mezar taşları, taslaklar ve okunamayan satırlar çıkar. Döner: ret listesine satır eklendi mi.
pub(crate) fn yereli_kuyruga_dok(
    d: &Depo,
    o: &Ortam,
    b: &IyimserBaglam,
    depo_id: &str,
    son_rev: i64,
    plan: &DokmePlani,
) -> Result<bool, CekirdekHatasi> {
    let ts_ms = o.simdi_ms();
    let mut ret = false;
    for p in &plan.kayitlar {
        if let Some(json) = &p.ret_json {
            kaydi_ret_listesine(d, o, &p.kayit_id, json, ts_ms)?;
            ret = true;
        }
    }
    for p in plan.kayitlar.iter().filter(|p| p.cikar) {
        d.gorunen_sil(&p.kayit_id)?;
    }
    d.telafiyi_sunucuya_gecir()?;
    d.depo_id_yaz(depo_id)?;
    d.son_rev_yaz(son_rev)?;
    d.kip_yaz(false)?;
    let dokulen: Vec<&KayitPlani> = plan.kayitlar.iter().filter(|p| !p.islemler.is_empty()).collect();
    for p in &dokulen {
        for (islem, ts) in &p.islemler {
            let islem_id = Motor::yeni_kimlik(o, "i_")?;
            d.kuyruga_ekle(&islem_id, &p.kayit_id, &islem.json().to_string(), *ts)?;
        }
    }
    // Yerel kipte kuyruk boştu: onaylanmış satır yoktur; sahipsiz görünen kayıt yukarıda çıkanlardır.
    for k in d.gorunenden_farkli_sunucu_kayitlari()? {
        d.gorunen_yaz(&k, false)?;
    }
    for p in &dokulen {
        gorunen_yenile(d, b, &p.kayit_id)?;
    }
    Ok(ret)
}

/// Bağlı kipte aynı `depo_id`'nin tam telafisinin sonu (`kanal.rs` `esitlendi`, toplanan kopya sunucu
/// kopyasının yerine geçmeden önce, aynı işlemde). Servis aynı depoyla tam telafi verdiyse büyük olasılıkla
/// yedekten dönmüştür (`kural::telafi`: telefon ileride ya da iz tutmuyor; iz yollandıysa revizyonu
/// `son_rev` olan yazım PC'de yoktur). Kayıt başına telefonun bildiği son onaylı hal (PC temeli +
/// onaylanmış kuyruk satırları, revizyonu onaylanan revizyon) `DonusAnalizi` ile denetlenir. PC o hali
/// yitirmişse (`PcDurumu::eksik`) yitirilen değerler alan alan fark olarak yeniden gönderilir
/// (`birlesme_islemleri`; `YOL-HARITASI.md` 3.3 "Aynı depo_id'de tam telafi"): fark işlemleri kaydın
/// bekleyen satırlarının önüne girer (bekleyenler aynı `islem_id`, deneme ve anla arkaya taşınır;
/// onaylanmışlar farkın içindedir; birleşen hal geçerli değilse fark yerine onaylı hal ret listesine).
/// Yitirmemişse kayda dokunulmaz: bekleyen satırlar taze kopya üstüne yeniden uygulanır (PC'de ilerlemiş
/// alanlar ezilmez). Saklı `depo_id` yoksa ya da başkaysa hiçbir şey yapmaz (başka depo `welcome`'da yerel
/// kip yoluna döner). PC'nin yitirdiği taslak `ekle` ile gitmez, onaylı hali ret listesine düşer; okunamayan
/// PC temeli satırı yazım kimliğiyle (sütunlar) denetlenir, PC o yazımı yitirmişse metni ret listesine düşer.
pub(crate) fn geri_donenleri_kuyruga_koy(
    d: &Depo,
    o: &Ortam,
    b: &IyimserBaglam,
    depo_id: &str,
    iz_yollandi: bool,
) -> Result<(), CekirdekHatasi> {
    if d.depo_id()?.as_deref() != Some(depo_id) {
        return Ok(());
    }
    let son_rev = d.son_rev()?;
    // `iz_yollandi` yanlış: `hello` izsiz gitti (`kanal.rs` kopya eski, ilk v3 bağlantının bir kezlik tam
    // telafisi); servisin iz kararı yoktur, kanıt yalnız kopyalardandır (`yereli_kuyruga_dok` gibi).
    let iz_kaybi = iz_yollandi && son_rev > 0 && d.hello_alanlari()?.son_rev_izi.is_some();
    let sunucu_satirlari = d.kopya_satirlari(KopyaTablosu::Sunucu)?;
    let sunucu = izler(&sunucu_satirlari);
    let yeni = izler(&d.kopya_satirlari(KopyaTablosu::Telafi)?);
    // Okunamayan PC temeli satırının hali bilinmez ama yazım kimliği (sütunlar) bilinir: kanıta girer,
    // aşağıda ayrıca denetlenir (sessizce atlanmaz).
    let mut onaylilar: BTreeMap<String, AjandaKaydi> = BTreeMap::new();
    let mut okunamayanlar: Vec<&KopyaSatiri> = Vec::new();
    for s in &sunucu_satirlari {
        match kayit_coz(&s.json) {
            Some(k) => {
                onaylilar.insert(s.kayit_id.clone(), k);
            }
            None => okunamayanlar.push(s),
        }
    }
    let mut onaylananlar: BTreeMap<String, Vec<KuyrukSatiri>> = BTreeMap::new();
    for s in d.kuyruk()?.into_iter().filter(|s| s.bekledigi_rev.is_some()) {
        onaylananlar.entry(s.kayit_id.clone()).or_default().push(s);
    }
    for (kayit_id, satirlar) in onaylananlar {
        let mut hal = onaylilar.remove(&kayit_id);
        let mut rev = hal.as_ref().map_or(0, |k| k.revizyon);
        for s in &satirlar {
            if let Some(islem) = islem_coz(&s.islem_json) {
                hal = iyimser_uygula(hal.as_ref(), &islem, s.olusturma_ms, b);
            }
            rev = rev.max(s.bekledigi_rev.unwrap_or(0));
        }
        if let Some(mut k) = hal {
            k.revizyon = rev;
            onaylilar.insert(kayit_id, k);
        }
    }
    okunamayanlar.retain(|s| !onaylilar.contains_key(&s.kayit_id));
    let mut temeller: BTreeMap<String, Iz> = onaylilar.iter().map(|(id, k)| (id.clone(), (k.revizyon, k.guncelleme_ms))).collect();
    temeller.extend(okunamayanlar.iter().map(|s| (s.kayit_id.clone(), (s.revizyon, s.guncelleme_ms))));
    let analiz = DonusAnalizi::kur(&temeller, &sunucu, &yeni, son_rev, iz_kaybi);
    // Okunamayan temel: PC o yazımı yitirmişse telefonun bildiği hal (satırın metni) ret listesine düşer
    // (D2'nin okunamayan görünen satır kuralı); yitirmemişse PC'nin hali yerine geçer, bir şey kaybolmaz.
    for s in &okunamayanlar {
        if analiz.eksik((s.revizyon, s.guncelleme_ms), yeni.get(&s.kayit_id).copied()) {
            kaydi_ret_listesine(d, o, &s.kayit_id, &s.json, o.simdi_ms())?;
        }
    }
    for (kayit_id, onayli) in &onaylilar {
        let islemler = match d.telafi_kaydi(kayit_id)? {
            // PC'nin yitirdiği taslak `ekle` ile onaylanmış gitmez: onaylı hal ret listesine (`DokmeSinifi::Taslak`).
            None if onayli.taslak && !onayli.silindi => {
                kaydi_ret_listesine(d, o, kayit_id, &onayli.json().to_string(), o.simdi_ms())?;
                Vec::new()
            }
            None => kuyruga_islemler(None, onayli, true),
            Some(n) => {
                let pc = analiz.durum(onayli, &n);
                if !pc.eksik {
                    continue;
                }
                match birlesme_islemleri(Some(onayli), onayli, &n, pc, true) {
                    Birlesme::Islemler(l) => l,
                    // Gözlemci ret listesini `tumu` ile yeniden okur (`kanal.rs` `hepsi_degisti`).
                    Birlesme::RetListesine => {
                        kaydi_ret_listesine(d, o, kayit_id, &onayli.json().to_string(), o.simdi_ms())?;
                        Vec::new()
                    }
                }
            }
        };
        let satirlar = d.kuyruk_kaydin(kayit_id)?;
        d.kaydin_kuyrugunu_sil(kayit_id)?;
        for (islem, ts) in islemler {
            d.kuyruga_ekle(&Motor::yeni_kimlik(o, "i_")?, kayit_id, &islem.json().to_string(), ts)?;
        }
        for s in satirlar.iter().filter(|s| s.bekledigi_rev.is_none()) {
            d.kuyruga_yeniden_ekle(s)?;
        }
    }
    Ok(())
}

/// Koparmada servisin kabul ettiği ama `kayit`'i gelmemiş (onaylanmış) satırlar PC'de uygulanmıştır: PC
/// temeline (sunucu kopyası) iyimser uygulanıp onaylanan revizyonla yazılırlar. Böylece temel görünen
/// kopyanın türetildiği halin PC tarafını taşır (görünen = temel + gönderilmemiş işlemler) ve sonraki
/// bağlanmada bu değişiklikler fark olarak yeniden gitmez (PC'de sonradan değişen alanı ezmesin).
fn onaylananlari_temele_kat(d: &Depo, b: &IyimserBaglam, kuyruk: &[KuyrukSatiri]) -> Result<(), CekirdekHatasi> {
    let mut kayitlar: BTreeMap<&str, Vec<&KuyrukSatiri>> = BTreeMap::new();
    for s in kuyruk.iter().filter(|s| s.bekledigi_rev.is_some()) {
        kayitlar.entry(s.kayit_id.as_str()).or_default().push(s);
    }
    for (kayit_id, satirlar) in kayitlar {
        // Okunamayan temel satırı olduğu gibi kalır (koparmayı düşürmez; `KoparmaSonucu.okunamayan_pc_temeli`).
        let Ok(mut hal) = sunucu_temeli(d, kayit_id)? else { continue };
        let mut rev = 0;
        for s in satirlar {
            if let Some(islem) = islem_coz(&s.islem_json) {
                hal = iyimser_uygula(hal.as_ref(), &islem, s.olusturma_ms, b);
            }
            rev = rev.max(s.bekledigi_rev.unwrap_or(0));
        }
        if let Some(mut k) = hal {
            k.revizyon = k.revizyon.max(rev);
            d.kopya_kaydi_uygula(KopyaTablosu::Sunucu, &k)?;
        }
    }
    Ok(())
}

/// Bağlı kipten yerel kipe geçişin veri kısmı (koparma ve `depo_id` değişimi), çağıranın tek işleminde:
/// görünen kopya o anki haliyle yerel gerçek olur (`bekleyen` düşer, metin aynı), onaylanmış satırlar PC
/// temeline katılır (`onaylananlari_temele_kat`), kuyruk ve süren tam telafinin toplananları atılır, kip
/// `yerel` olur. Ret listesi, PC temeli (`sunucu_kayitlari`, `depo_id`, `son_rev`), yerel geçmiş, alarm
/// planı ve eşleşme bilgisi kalır. Döner: koparmanın sayıları (kuyruk atılmadan önce sayılır).
fn bagli_kipten_cik(d: &Depo, b: &IyimserBaglam) -> Result<KoparmaSonucu, CekirdekHatasi> {
    let kuyruk = d.kuyruk()?;
    let gonderilmeyen: Vec<&KuyrukSatiri> = kuyruk.iter().filter(|s| s.bekledigi_rev.is_none()).collect();
    let mut kayitlar: Vec<&str> = gonderilmeyen.iter().map(|s| s.kayit_id.as_str()).collect();
    kayitlar.sort_unstable();
    kayitlar.dedup();
    let sonuc = KoparmaSonucu {
        onceki_kip: CalismaKipi::Bagli,
        gonderilmeyen_kayit: sayi(kayitlar.len() as i64),
        gonderilmeyen_islem: sayi(gonderilmeyen.len() as i64),
        yanitsiz_islem: sayi(gonderilmeyen.iter().filter(|s| s.yollandi).count() as i64),
        ret_listesinde: sayi(d.ret_sayisi()?),
        baglanma_iptal: false,
        okunamayan_pc_temeli: sayi(okunamayan_temel_sayisi(d)? as i64),
    };
    onaylananlari_temele_kat(d, b, &kuyruk)?;
    d.kuyrugu_bosalt()?;
    d.bekleyenleri_dusur()?;
    d.telafiyi_sil()?;
    d.kip_yaz(true)?;
    Ok(sonuc)
}

fn neden_adi(n: GecisNedeni) -> &'static str {
    match n {
        GecisNedeni::Koparma => "koparma",
        GecisNedeni::EslesmeKaldirildi => "eslesme_kaldirildi",
        GecisNedeni::DepoDegisti => "depo_degisti",
    }
}

/// `meta.son_gecis`'in JSON'u (`GecisOzeti`; `onceki_kip` ve `baglanma_iptal` yazılmaz: hep `Bagli`, yanlış).
/// `okunamayan_pc_temeli` sonradan eklendi: eski özette yoksa 0 okunur.
fn gecis_json(g: &GecisOzeti) -> String {
    let k = &g.koparma;
    serde_json::json!({
        "neden": neden_adi(g.neden),
        "ts_ms": g.ts_ms,
        "gonderilmeyen_kayit": k.gonderilmeyen_kayit,
        "gonderilmeyen_islem": k.gonderilmeyen_islem,
        "yanitsiz_islem": k.yanitsiz_islem,
        "ret_listesinde": k.ret_listesinde,
        "okunamayan_pc_temeli": k.okunamayan_pc_temeli,
        "eski_depo_id": g.eski_depo_id,
        "yeni_depo_id": g.yeni_depo_id,
    })
    .to_string()
}

/// `gecis_json`'un tersi; okunamayan değer yok sayılır (`None`).
fn gecis_coz(metin: &str) -> Option<GecisOzeti> {
    let v: serde_json::Value = serde_json::from_str(metin).ok()?;
    let neden = [GecisNedeni::Koparma, GecisNedeni::EslesmeKaldirildi, GecisNedeni::DepoDegisti]
        .into_iter()
        .find(|n| v.get("neden").and_then(|x| x.as_str()) == Some(neden_adi(*n)))?;
    let sayi_al = |ad: &str| v.get(ad)?.as_i64().and_then(|n| i32::try_from(n).ok());
    let metin_al = |ad: &str| v.get(ad).and_then(|x| x.as_str()).map(str::to_string);
    Some(GecisOzeti {
        neden,
        ts_ms: v.get("ts_ms")?.as_i64()?,
        koparma: KoparmaSonucu {
            onceki_kip: CalismaKipi::Bagli,
            gonderilmeyen_kayit: sayi_al("gonderilmeyen_kayit")?,
            gonderilmeyen_islem: sayi_al("gonderilmeyen_islem")?,
            yanitsiz_islem: sayi_al("yanitsiz_islem")?,
            ret_listesinde: sayi_al("ret_listesinde")?,
            baglanma_iptal: false,
            // Bu alandan önce yazılmış özette yoktur.
            okunamayan_pc_temeli: sayi_al("okunamayan_pc_temeli").unwrap_or(0),
        },
        eski_depo_id: metin_al("eski_depo_id"),
        yeni_depo_id: metin_al("yeni_depo_id"),
    })
}

/// Geçişi `bagli_kipten_cik` ile yapar ve özetini (`meta.son_gecis`) aynı işlemde yazar.
fn gecisi_yaz(d: &Depo, b: &IyimserBaglam, neden: GecisNedeni, ts_ms: i64, yeni_depo_id: Option<&str>) -> Result<KoparmaSonucu, CekirdekHatasi> {
    let eski_depo_id = d.depo_id()?;
    let koparma = bagli_kipten_cik(d, b)?;
    let ozet = GecisOzeti { neden, ts_ms, koparma: koparma.clone(), eski_depo_id, yeni_depo_id: yeni_depo_id.map(str::to_string) };
    d.meta_yaz(anahtar::SON_GECIS, Some(&gecis_json(&ozet)))?;
    Ok(koparma)
}

impl Motor {
    /// Bağlı kipten yerel kipe son geçişin özeti (`meta.son_gecis`); hiç geçiş olmadıysa `None`.
    pub(crate) fn son_gecis(&self) -> Result<Option<GecisOzeti>, CekirdekHatasi> {
        Ok(self.depo.meta_oku(anahtar::SON_GECIS)?.as_deref().and_then(gecis_coz))
    }

    /// Bağlı kipte servis saklı `depo_id`'den farklı bir `depo_id` getirdi (`welcome`; kesin kural: görünen
    /// kopya başka bir `depo_id`'nin tam telafisiyle değiştirilmez). Tek SQLite işleminde koparmanın veri
    /// kısmı (`bagli_kipten_cik`) ve özet (`DepoDegisti`); eşleşme, cihaz anahtarı ve bağlantı kalır. Çağıran
    /// (`kanal.rs`) bu bağlantıyı yerel kipten bağlanma olarak sürdürür: telafi toplanır, `esitlendi`'de
    /// önizleme ve onayla (D4, `birlestirme.rs`) `yereli_kuyruga_dok`. Bağlantı ondan önce koparsa kip yerel kalır, sonraki bağlantı boş `hello` ile
    /// baştan dener. Gözlemciye `tumu` ve `baglanti` (kip değişti), açık geçmiş sayfaları için `gecmis`.
    pub(crate) fn depo_degisti(&mut self, o: &Ortam, e: &mut Etkiler, yeni_depo_id: &str) -> Result<(), CekirdekHatasi> {
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let ts_ms = o.simdi_ms();
        self.depo.yazma(|d| gecisi_yaz(d, &b, GecisNedeni::DepoDegisti, ts_ms, Some(yeni_depo_id)))?;
        // Önbellekteki sayfalar eski servisin geçmişidir.
        self.gecmis_onbellegini_at(e);
        e.degisim.tumu = true;
        e.degisim.baglanti = true;
        Ok(())
    }

    /// Geçmiş önbelleği başka bir kaynağın (PC ya da yerel tablo) geçmişidir: atılır, yanıt bekleyen istekler
    /// düşer, açık sayfalar için gözlemciye `Degisim.gecmis` (arayüz yeniden ister).
    fn gecmis_onbellegini_at(&mut self, e: &mut Etkiler) {
        self.gecmis_istekleri.clear();
        for kayit_id in std::mem::take(&mut self.gecmis).into_keys() {
            e.degisim.gecmis.push(kayit_id);
        }
    }

    /// Yerel kipten bağlanma bitti (`birlestirme.rs`, `yereli_kuyruga_dok` kalıcı olduktan sonra): yerel
    /// geçmiş önbelleği atılır (açık sayfanın yerel `once_rev`'i PC'ye gitmesin, iki kaynağın satırları
    /// karışmasın), ret listesine satır düştüyse `Degisim.ret_listesi`.
    pub(crate) fn yerelden_baglandi(&mut self, e: &mut Etkiler, ret_eklendi: bool) {
        self.gecmis_onbellegini_at(e);
        if ret_eklendi {
            e.degisim.ret_listesi = true;
        }
    }

    /// Bağlı kip + eşleşme yok (ya da okunamıyor) çıkışsız bir durumdur: kuyruk hiç gitmez, bağlantı açılamaz,
    /// yeni QR'a dek her yazma "bekliyor" kalır (D1 öncesinin eşleşme kaldırması kipi `bagli` bırakıyordu; elle
    /// silinmiş meta da `bagli` sayılır). Açılışta (`Cekirdek::ac`) bağlı kipten yerel kipe veri kaybısız
    /// geçilir (`bagli_kipten_cik`: görünen kopya o anki haliyle yerel gerçek olur, onaylanmışlar PC temeline
    /// katılır, kuyruk atılır; ret listesi, PC temeli, alarmlar kalır), okunamayan eşleşme satırı silinir,
    /// özet `son_gecis`'e `EslesmeKaldirildi` ile yazılır. Bekleyen QR kalır (bağlanma yerel kipten sürer).
    /// Döner: geçiş yapıldı mı.
    fn cikissiz_bagli_kipi_onar(&mut self, o: &Ortam) -> Result<bool, CekirdekHatasi> {
        if self.yerel_mi()? || self.eslesme_oku()?.is_some() {
            return Ok(false);
        }
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let ts_ms = o.simdi_ms();
        self.depo.yazma(|d| {
            gecisi_yaz(d, &b, GecisNedeni::EslesmeKaldirildi, ts_ms, None)?;
            Ok(d.meta_yaz(anahtar::ESLESME, None)?)
        })?;
        Ok(true)
    }

    /// Açılış onarımı (`Cekirdek::ac`): `cikissiz_bagli_kipi_onar`. Hatası açılışı düşürmez (veri yerinde
    /// kalır: onarım tek işlemdir, yarım kalmaz; kip bağlı kalır, sonraki açılış yeniden dener): iz
    /// `meta.onarim_hatasi`'na (`ts_ms`, `mesaj`) yazılır, onarım sonra başarılı olunca (ya da gerekmeyince)
    /// silinir. İzin kendisi yazılamazsa (depo yazılamıyor) yalnız açılış sürer.
    pub(crate) fn acilis_onarimi(&mut self, o: &Ortam) {
        let iz = match self.cikissiz_bagli_kipi_onar(o) {
            Ok(_) => None,
            Err(h) => Some(serde_json::json!({ "ts_ms": o.simdi_ms(), "mesaj": h.to_string() }).to_string()),
        };
        if iz.is_some() || self.depo.meta_oku(anahtar::ONARIM_HATASI).ok().flatten().is_some() {
            let _ = self.depo.meta_yaz(anahtar::ONARIM_HATASI, iz.as_deref());
        }
    }

    /// Koparma (`YOL-HARITASI.md` 3.3 "Koparma"): bağlı kipten yerel kipe veri kaybı olmadan. Tek SQLite
    /// işleminde `bagli_kipten_cik` (görünen kopya o anki haliyle yerel gerçek olur, kuyruk atılır; ret
    /// listesi, PC temeli, yerel geçmiş ve alarm planı kalır: görünen kayıt değişmediği için alarm senkronu
    /// çağrılmaz), eşleşme bilgisi (eşleşme, bekleyen QR, son ret) silinir ve özet (`meta.son_gecis`,
    /// `GecisNedeni::Koparma`) yazılır. Sonra açık bağlantı kapatılır, geçmiş önbelleği (PC'nin geçmişi)
    /// atılır, cihaz anahtarı silinir.
    ///
    /// Yerel kipte kayıtlara dokunulmaz: süren bağlanma (eşleşme kayıtlı, servisin kopyası henüz gelmedi) ya
    /// da bekleyen eşleştirme iptal edilir (eşleşme bilgisi ve toplanan kopya silinir, bağlantı kapanır); PC
    /// temeli koparma anındaki haliyle kalır. Hiçbiri yoksa yalnız (zaten olmaması gereken) cihaz anahtarı
    /// silinir; çağrı yinelenebilir. Anahtar silinemezse hata döner ama veriler ve etkiler yazılmıştır
    /// (`eslesmeyi_kaldir` gibi); yinelenen çağrı anahtarı yeniden dener.
    pub(crate) fn baglantiyi_kopar(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<KoparmaSonucu, CekirdekHatasi> {
        self.kopar_nedeniyle(o, e, GecisNedeni::Koparma)
    }

    /// `baglantiyi_kopar`; bağlı kipte özete `neden` yazılır (`eslesmeyi_kaldir` `EslesmeKaldirildi` verir).
    pub(crate) fn kopar_nedeniyle(&mut self, o: &Ortam, e: &mut Etkiler, neden: GecisNedeni) -> Result<KoparmaSonucu, CekirdekHatasi> {
        let yerel = self.yerel_mi()?;
        let bagli_eslesme = [anahtar::ESLESME, anahtar::ESLESTIRME_QR, anahtar::ESLESME_REDDI];
        let sonuc = if yerel {
            let mut iptal = !matches!(self.asama, Asama::Kopuk);
            for a in bagli_eslesme {
                iptal |= self.depo.meta_oku(a)?.is_some();
            }
            self.depo.yazma(|d| {
                for a in bagli_eslesme {
                    d.meta_yaz(a, None)?;
                }
                d.telafiyi_sil()
            })?;
            KoparmaSonucu {
                onceki_kip: CalismaKipi::Yerel,
                gonderilmeyen_kayit: 0,
                gonderilmeyen_islem: 0,
                yanitsiz_islem: 0,
                ret_listesinde: sayi(self.depo.ret_sayisi()?),
                baglanma_iptal: iptal,
                okunamayan_pc_temeli: 0,
            }
        } else {
            let cevirici = o.cevirici();
            let b = self.iyimser_baglam(o, &cevirici)?;
            let ts_ms = o.simdi_ms();
            self.depo.yazma(|d| {
                let sonuc = gecisi_yaz(d, &b, neden, ts_ms, None)?;
                for a in bagli_eslesme {
                    d.meta_yaz(a, None)?;
                }
                Ok(sonuc)
            })?
        };
        let degisti = !yerel || sonuc.baglanma_iptal;
        self.son_hata = None;
        self.surum_uyusmazligi = None;
        self.gecmis_istekleri.clear();
        if !yerel {
            // Önbellekteki sayfalar PC'nin geçmişidir; yerel kipte geçmiş yerel tablodan yeniden yüklenir.
            self.gecmis_onbellegini_at(e);
            e.degisim.tumu = true;
        }
        if !matches!(self.asama, Asama::Kopuk | Asama::Kapaniyor) {
            self.kapat(e, "bağlantı koparıldı");
        }
        if degisti {
            e.degisim.eslesme = true;
            e.degisim.baglanti = true;
        }
        o.kimlik.anahtari_sil()?;
        Ok(sonuc)
    }
}

/// Köprünün sayı alanı (taşarsa en büyük).
fn sayi(n: i64) -> i32 {
    i32::try_from(n).unwrap_or(i32::MAX)
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::model::AjandaOrnegi;
    use serde_json::json;

    fn kayit(degistir: impl FnOnce(&mut serde_json::Value)) -> AjandaKaydi {
        let mut v = json!({
            "kayit_id": "k_a", "revizyon": 7, "tur": "gorev", "baslik": "x", "hatirlatmalar": [],
            "zaman": {"kesinlik": "gun", "tarih": "2026-11-23", "saat_dilimi": "Europe/Istanbul"},
            "tekrar": {"siklik": "gunluk", "aralik": 1},
            "ornekler": [], "durum": "acik", "taslak": false, "silindi": false, "elle_alanlar": [],
            "kaynak": {"yol": "sohbet_araci", "tur_kokeni": "sentetik", "sohbet_id": "ana"},
            "olusturma_ms": 100, "guncelleme_ms": 200
        });
        degistir(&mut v);
        AjandaKaydi::oku(&v, "").unwrap()
    }

    fn turler(l: &[(AjandaIslem, i64)]) -> Vec<String> {
        l.iter().map(|(i, _)| i.json().to_string()).collect()
    }

    /// Temeli olan kayıt: temel ile şimdiki hal arasındaki fark, servisin kabul edeceği sırayla.
    #[test]
    fn temelli_kaydin_farki_islemlere_doner() {
        let temel = kayit(|v| {
            v["taslak"] = json!(true);
            v["silindi"] = json!(true);
            v["ornekler"] = json!([{"tarih": "2026-11-24", "durum": "tamam"}]);
        });
        let k = kayit(|v| {
            v["revizyon"] = json!(9);
            v["baslik"] = json!("y");
            v["durum"] = json!("tamam");
            v["ornekler"] = json!([{"tarih": "2026-11-25", "durum": "iptal"}]);
            v["guncelleme_ms"] = json!(300);
        });
        let l = kuyruga_islemler(Some(&temel), &k, true);
        let sonrasi = [
            r#"{"degisiklik":{"baslik":"y"},"islem":"guncelle","kayit_id":"k_a","temel_revizyon":7}"#,
            r#"{"durum":"tamam","islem":"durum","kayit_id":"k_a"}"#,
            r#"{"durum":"acik","islem":"durum","kayit_id":"k_a","ornek_tarihi":"2026-11-24"}"#,
            r#"{"durum":"iptal","islem":"durum","kayit_id":"k_a","ornek_tarihi":"2026-11-25"}"#,
            r#"{"islem":"onayla","kayit_id":"k_a"}"#,
        ];
        let t = turler(&l);
        assert_eq!(t[0], r#"{"islem":"geri_yukle","kayit_id":"k_a"}"#);
        assert_eq!(&t[1..], sonrasi);
        assert!(l.iter().all(|(_, ts)| *ts == 300));
        assert!(kuyruga_islemler(Some(&k), &k, true).is_empty(), "fark yoksa işlem yok");
        // İzin yoksa (temel servisin kopyası) PC'nin silmesi geri alınmaz; öteki farklar gider (servis
        // `kayit_silinmis` ile reddeder, telefonun hali ret listesinde kalır).
        assert_eq!(turler(&kuyruga_islemler(Some(&temel), &k, false)), sonrasi);
        // İki tarafta da silinmiş: alanlar farklı olsa da hiçbir işlem.
        let silinmis = AjandaKaydi { silindi: true, ..k.clone() };
        assert!(kuyruga_islemler(Some(&temel), &silinmis, true).is_empty());
    }

    /// Telefonda doğan kayıt: aynı kimlikle `ekle` (oluşturma anıyla), sonra durum, örnekler. Temelsiz mezar
    /// taşı hiç gönderilmez.
    #[test]
    fn temelsiz_kayit_ekle_ile_baslar() {
        let k = kayit(|v| {
            v["kaynak"] = json!({"yol": "sesli_not", "tur_kokeni": "insan", "device_id": "yerel"});
            v["durum"] = json!("iptal");
            v["ornekler"] = json!([{"tarih": "2026-11-24", "durum": "tamam"}]);
        });
        let l = kuyruga_islemler(None, &k, false);
        let t = turler(&l);
        assert_eq!(t.len(), 3);
        assert!(t[0].contains(r#""girdi_yolu":"sesli_not""#) && t[0].contains(r#""islem":"ekle""#), "{}", t[0]);
        assert_eq!(l[0].1, 100);
        assert_eq!(&t[1..], [
            r#"{"durum":"iptal","islem":"durum","kayit_id":"k_a"}"#,
            r#"{"durum":"tamam","islem":"durum","kayit_id":"k_a","ornek_tarihi":"2026-11-24"}"#,
        ]);
        assert!(kuyruga_islemler(None, &AjandaKaydi { silindi: true, ..k }, true).is_empty());
    }

    fn izler_(l: &[(&str, i64, i64)]) -> BTreeMap<String, Iz> {
        l.iter().map(|(id, r, ms)| (id.to_string(), (*r, *ms))).collect()
    }

    /// Yazım kimliği revizyon + PC saatidir: numara büyük ama zaman geride, aynı numara başka zaman, kayıt
    /// yok ya da numara küçük kayıptır; iyimser (onaylanmış) halde yalnız revizyon sayılır.
    #[test]
    fn yazim_kimligi_revizyon_ve_pc_saatidir() {
        assert_eq!(soy((45, 4500), false, Some((45, 4500))), Soy::Ayni);
        assert_eq!(soy((45, 4500), false, Some((45, 9000))), Soy::Kayip, "çakışan numara");
        assert_eq!(soy((45, 4500), false, Some((41, 9000))), Soy::Kayip, "dönüşten sonra küçük numara");
        assert_eq!(soy((45, 4500), false, None), Soy::Kayip);
        assert_eq!(soy((45, 4500), false, Some((60, 4000))), Soy::Kayip, "numara büyük, zaman geride");
        assert_eq!(soy((45, 4500), false, Some((60, 4500))), Soy::Ileride);
        assert_eq!(soy((46, 100), true, Some((46, 9000))), Soy::Ayni, "iyimser: servisin gerçek sonucu");
        assert_eq!(soy((46, 100), true, Some((44, 9000))), Soy::Kayip);
    }

    /// Bulgu 1: telefon 45'e kadar biliyor, servis 40'a döndü. (a) X dönüşten sonra 41 aldı, (b) X 60'a gitti
    /// (arada başka kayıt 42'yi yeniden aldı), (c) X aynı numarayı (45) başka zamanda aldı: üçü de yitirilmiş.
    /// 40'ta kalmış, sonra ilerlemiş kayıt (W) yitirilmemiştir. Dönüş kanıtı yoksa hiçbiri.
    #[test]
    fn yedekten_donme_kayit_ve_depo_duzeyinde_bulunur() {
        let o = kayit(|v| {
            v["revizyon"] = json!(45);
            v["guncelleme_ms"] = json!(4500);
        });
        let n = |rev: i64, ms: i64| AjandaKaydi { revizyon: rev, guncelleme_ms: ms, ..o.clone() };
        let w = AjandaKaydi { kayit_id: "k_w".into(), revizyon: 30, guncelleme_ms: 3000, ..o.clone() };
        let temel = izler_(&[("k_a", 45, 4500), ("k_w", 30, 3000), ("k_s", 38, 3800)]);
        for (x, y, beklenen) in [((41, 9000), None, (true, false)), ((60, 9500), Some(("k_y", 42, 9100)), (true, false)), ((45, 9000), None, (true, false))] {
            let mut yeni = vec![("k_a", x.0, x.1), ("k_w", 50, 9200), ("k_s", 38, 3800)];
            yeni.extend(y);
            let a = DonusAnalizi::kur(&temel, &temel, &izler_(&yeni), 45, false);
            assert!(a.donmus, "{x:?}");
            assert_eq!(a.korunan_ust, 38);
            let d = a.durum(&o, &n(x.0, x.1));
            assert_eq!((d.eksik, d.eskimis), beklenen, "{x:?}");
            assert!(!a.durum(&w, &AjandaKaydi { revizyon: 50, guncelleme_ms: 9200, ..w.clone() }).eksik, "W kaldı");
        }
        // Dönmemiş servis: kayıt başka yazarca ilerletildi, öteki aynı: hiçbiri yitirilmemiş.
        let a = DonusAnalizi::kur(&temel, &temel, &izler_(&[("k_a", 60, 9000), ("k_w", 30, 3000), ("k_s", 38, 3800)]), 45, false);
        assert!(!a.donmus && !a.durum(&o, &n(60, 9000)).eksik);
        // Dönmüş ve hiç yazılmamış kayıt: PC'nin hali eskimiş (silme/geri yükleme de yeniden gider).
        let a = DonusAnalizi::kur(&temel, &temel, &izler_(&[("k_a", 33, 3300), ("k_w", 30, 3000), ("k_s", 38, 3800)]), 45, false);
        assert_eq!(a.durum(&o, &n(33, 3300)), PcDurumu { eksik: true, eskimis: true });
        // Bağlı kipte servisin iz kararı (`son_rev` yazımı PC'de yok) üst sınırdır: yalnız ilerlemiş X bile.
        let a = DonusAnalizi::kur(&temel, &temel, &izler_(&[("k_a", 60, 9500), ("k_w", 30, 3000), ("k_s", 38, 3800)]), 45, true);
        assert!(a.durum(&o, &n(60, 9500)).eksik);
    }

    /// Alan alan hedef hal: telefonun değiştirdiği alan telefondan; dokunmadığı alanda PC (yitirmemişse);
    /// yitirmişse bilinen değer geri gider ama temelde olmayan alan (yokluk) geri gitmez; silme yalnız PC'nin
    /// hali eskimişse geri alınır; örnekler tarih tarih.
    #[test]
    fn hedef_hal_alan_alan_birlesir() {
        let o = kayit(|v| v["ornekler"] = json!([{"tarih": "2026-11-24", "durum": "tamam"}]));
        let p = kayit(|v| {
            v["baslik"] = json!("telefon");
            v["ornekler"] = json!([{"tarih": "2026-11-24", "durum": "tamam"}, {"tarih": "2026-11-25", "durum": "iptal"}]);
        });
        let n = kayit(|v| {
            v["revizyon"] = json!(9);
            v["aciklama"] = json!("PC'de eklendi");
            v["hatirlatmalar"] = json!([{"tur": "once", "dk": 30}]);
            v["ornekler"] = json!([{"tarih": "2026-11-23", "durum": "iptal"}]);
            v["silindi"] = json!(true);
        });
        let ilerlemis = PcDurumu::default();
        let t = hedef_hal(&o, &p, &n, ilerlemis).unwrap();
        assert_eq!(t.baslik, "telefon");
        assert_eq!((t.aciklama.as_deref(), t.hatirlatmalar.len(), t.silindi), (Some("PC'de eklendi"), 1, true));
        let tarihler: Vec<_> = t.ornekler.iter().map(|x| (x.tarih.as_str(), x.durum)).collect();
        assert_eq!(tarihler, [("2026-11-23", OrnekDurumu::Iptal), ("2026-11-25", OrnekDurumu::Iptal)], "PC 24'ü açtı, telefon 25'i kapattı");

        // PC yitirmiş: telefonun bildiği hatırlatma boş listeydi (yok): PC'ninki kalır; dolu bilinen değer
        // (24'ün `tamam`'ı) geri gider; PC'nin açıklaması (temelde yok) kalır; dönüşten sonraki silme kalır.
        let yitik = PcDurumu { eksik: true, eskimis: false };
        let o2 = AjandaKaydi { hatirlatmalar: vec![], ..o.clone() };
        let p2 = AjandaKaydi { hatirlatmalar: vec![], ..o.clone() };
        let t = hedef_hal(&o2, &p2, &n, yitik).unwrap();
        assert_eq!((t.aciklama.as_deref(), t.hatirlatmalar.len(), t.silindi), (Some("PC'de eklendi"), 1, true));
        let tarihler: Vec<_> = t.ornekler.iter().map(|x| x.tarih.as_str()).collect();
        assert_eq!(tarihler, ["2026-11-23", "2026-11-24"]);
        // PC'nin hali eskimişse mezar taşı dönmüş haldir: telefonun canlı hali geri gider.
        assert!(!hedef_hal(&o2, &p2, &n, PcDurumu { eksik: true, eskimis: true }).unwrap().silindi);
        // Var olan kayıt taslağa dönmez: PC'deki taslak dönmüş haldir, onay geri gider.
        let taslak = AjandaKaydi { taslak: true, ..n.clone() };
        assert!(!hedef_hal(&o2, &p2, &taslak, yitik).unwrap().taslak);
        assert!(hedef_hal(&o2, &p2, &taslak, ilerlemis).unwrap().taslak);
    }

    /// PC'nin geçerli silmesi kalırken telefonun farkları `geri_yukle`'siz gider (servis reddeder, ret
    /// listesine düşer); iki tarafta silinmişse hiçbir işlem; PC yitirmemişse yalnız telefonun farkı, temel
    /// revizyonu yeni kopyadan.
    #[test]
    fn birlesme_islemleri_silmeyi_ve_temeli_korur() {
        let o = kayit(|_| {});
        let p = kayit(|v| v["baslik"] = json!("telefon"));
        let n = kayit(|v| {
            v["revizyon"] = json!(12);
            v["zaman"] = json!({"kesinlik": "gun", "tarih": "2026-11-24", "saat_dilimi": "Europe/Istanbul"});
        });
        assert_eq!(
            turler(&islemler(birlesme_islemleri(Some(&o), &p, &n, PcDurumu::default(), false))),
            [r#"{"degisiklik":{"baslik":"telefon"},"islem":"guncelle","kayit_id":"k_a","temel_revizyon":12}"#]
        );
        let silik = AjandaKaydi { silindi: true, ..n.clone() };
        let yitik = PcDurumu { eksik: true, eskimis: false };
        let l = turler(&islemler(birlesme_islemleri(Some(&o), &o, &silik, yitik, true)));
        assert_eq!(l, [r#"{"degisiklik":{"zaman":{"kesinlik":"gun","saat_dilimi":"Europe/Istanbul","tarih":"2026-11-23"}},"islem":"guncelle","kayit_id":"k_a","temel_revizyon":12}"#]);
        assert!(islemler(birlesme_islemleri(Some(&o), &AjandaKaydi { silindi: true, ..p.clone() }, &silik, yitik, true)).is_empty());
        let l = turler(&islemler(birlesme_islemleri(Some(&o), &o, &silik, PcDurumu { eksik: true, eskimis: true }, true)));
        assert_eq!(l[0], r#"{"islem":"geri_yukle","kayit_id":"k_a"}"#);
    }

    fn islemler(b: Birlesme) -> Vec<(AjandaIslem, i64)> {
        match b {
            Birlesme::Islemler(l) => l,
            Birlesme::RetListesine => panic!("ret listesi beklenmiyordu"),
        }
    }

    /// Birleşen hal geçerli bir kayıt değil. PC yitirmişse hiçbir işlem gitmez, telefonun hali ret listesine:
    /// yitirilen zamanı geri göndermek PC'nin dönüşten sonra eklediği tekrarı kaldırmayı ya da kaydı bozmayı
    /// gerektirirdi (eski fark `n → p` tekrarı kaldırır, silmeyi geri alırdı). PC yitirmemişse yalnız
    /// telefonun değiştirdiği gider (servis karar verir).
    #[test]
    fn birlesemeyen_hal_pc_yitirmisse_ret_listesine_gider() {
        let o = kayit(|v| {
            v["zaman"] = json!({"kesinlik": "belirsiz", "ifade": "bir ara"});
            v.as_object_mut().unwrap().remove("tekrar");
        });
        let n = kayit(|v| {
            v["revizyon"] = json!(12);
            v["aciklama"] = json!("PC");
        });
        let yitik = PcDurumu { eksik: true, eskimis: false };
        assert!(hedef_hal(&o, &o, &n, yitik).is_none(), "belirsiz zaman + PC'nin tekrarı");
        assert_eq!(birlesme_islemleri(Some(&o), &o, &n, yitik, true), Birlesme::RetListesine);
        let silik = AjandaKaydi { silindi: true, guncelleme_ms: 900, ..n.clone() };
        assert_eq!(birlesme_islemleri(Some(&o), &o, &silik, yitik, true), Birlesme::RetListesine, "mezar taşı diriltilmez");
        assert!(islemler(birlesme_islemleri(Some(&o), &o, &n, PcDurumu::default(), true)).is_empty(), "PC yitirmemiş: PC'nin hali");

        // PC yitirmemiş: telefon tekrarı kaldırdı, PC örnek işaretledi; birleşen hal geçersiz, telefonun farkı gider.
        let o = kayit(|_| {});
        let p = kayit(|v| {
            v.as_object_mut().unwrap().remove("tekrar");
        });
        let n = kayit(|v| {
            v["revizyon"] = json!(12);
            v["ornekler"] = json!([{"tarih": "2026-11-24", "durum": "iptal"}]);
        });
        assert!(hedef_hal(&o, &p, &n, PcDurumu::default()).is_none());
        assert_eq!(
            turler(&islemler(birlesme_islemleri(Some(&o), &p, &n, PcDurumu::default(), true))),
            [r#"{"degisiklik":{"tekrar":null},"islem":"guncelle","kayit_id":"k_a","temel_revizyon":7}"#]
        );
    }

    /// Geçmiş satırı servisin `fark`'ıyla: yalnız değişen izlenen alanlar; `ORNEK_ADET` atmasında iki tam liste.
    #[test]
    fn gecmis_girdisi_servis_farki_gibidir() {
        let yazar = AjandaYazar { yol: KaynakYolu::Elle, tur_kokeni: TurKokeni::Insan, device_id: None, sohbet_id: None, oturum_id: None };
        let once = kayit(|_| {});
        let sonra = kayit(|v| {
            v["revizyon"] = json!(8);
            v["baslik"] = json!("y");
            v.as_object_mut().unwrap().remove("zaman");
            v.as_object_mut().unwrap().remove("tekrar");
        });
        let islem = AjandaIslem::Guncelle { kayit_id: "k_a".into(), temel_revizyon: 5, degisiklik: Default::default() };
        let g = gecmis_girdisi(&islem, Some(&once), &sonra, yazar.clone());
        assert_eq!((g.rev, g.ts_ms, g.temel_revizyon), (8, 200, Some(5)));
        assert_eq!(g.onceki.json().to_string(), format!(r#"{{"baslik":"x","tekrar":{},"zaman":{}}}"#, once.tekrar.as_ref().unwrap().json(), once.zaman.as_ref().unwrap().json()));
        assert_eq!(g.sonraki.json().to_string(), r#"{"baslik":"y","tekrar":null,"zaman":null}"#);

        let dolu = kayit(|v| v["ornekler"] = json!([{"tarih": "2026-11-23", "durum": "tamam"}]));
        let atilmis = AjandaKaydi { ornekler: vec![AjandaOrnegi { tarih: "2026-11-24".into(), durum: OrnekDurumu::Iptal }], ..dolu.clone() };
        let islem = AjandaIslem::Durum { kayit_id: "k_a".into(), durum: KayitDurumu::Iptal, ornek_tarihi: Some("2026-11-24".into()) };
        let g = gecmis_girdisi(&islem, Some(&dolu), &atilmis, yazar);
        assert_eq!(g.ornek_tarihi.as_deref(), Some("2026-11-24"));
        assert_eq!(
            (g.onceki.json().to_string(), g.sonraki.json().to_string()),
            (
                r#"{"ornek_durumu":null,"ornekler":[{"durum":"tamam","tarih":"2026-11-23"}]}"#.to_string(),
                r#"{"ornek_durumu":"iptal","ornekler":[{"durum":"iptal","tarih":"2026-11-24"}]}"#.to_string()
            )
        );
    }

    /// R1: temeli bilinmeyen kayıtta PC'de olup telefonda olmayan v3 alanı PC'nin değişikliğidir, kaldırılmaz;
    /// telefonun v3 alanları gider. Başka bir yere değişen telefon bölgesine PC'nin konumu eklenmez.
    #[test]
    fn temelsiz_kayitta_pc_nin_v3_alani_kaldirilmaz() {
        let n = kayit(|v| {
            v["simge"] = json!("is");
            v["bolge"] = json!("Market");
            v["bolge_konumu"] = json!({"enlem_e6": 41_008_240, "boylam_e6": 28_978_359, "yaricap_m": 150});
        });
        let p = kayit(|v| v["baglantilar"] = json!([{"url": "https://ornek.com/a"}]));
        let l = islemler(birlesme_islemleri(None, &p, &n, PcDurumu::default(), true));
        let [(AjandaIslem::Guncelle { degisiklik, .. }, _)] = l.as_slice() else { panic!("tek guncelle: {l:?}") };
        let beklenen = V3Degisikligi { baglantilar: Alan::Deger(p.v3.baglantilar.clone()), ..Default::default() };
        assert_eq!(degisiklik.v3, beklenen);
        let p = kayit(|v| v["bolge"] = json!("Bakkal"));
        let l = islemler(birlesme_islemleri(None, &p, &n, PcDurumu::default(), true));
        let [(AjandaIslem::Guncelle { degisiklik, .. }, _)] = l.as_slice() else { panic!("tek guncelle: {l:?}") };
        assert_eq!((&degisiklik.v3.simge, &degisiklik.v3.bolge), (&Alan::Yok, &Alan::Deger("Bakkal".into())));
        assert_eq!(degisiklik.v3.bolge_konumu, Alan::Kaldir, "başka yerin konumu: PC'ninki düşer");
    }

    /// R1: yerel geçmiş servisin `fark`/`dogumParcasi`'ı gibi v3 alanlarını da yazar.
    #[test]
    fn yerel_gecmis_v3_alanlarini_yazar() {
        let o = kayit(|_| {});
        let s = kayit(|v| v["simge"] = json!("is"));
        let (a, b) = fark(&o, &s);
        assert_eq!((a.v3.simge, b.v3.simge), (Alan::Kaldir, Alan::Deger("is".into())));
        assert_eq!(dogum_parcasi(&s).v3.simge, Alan::Deger("is".into()));
        assert_eq!(dogum_parcasi(&o).v3, V3Degisikligi::default());
    }
}
