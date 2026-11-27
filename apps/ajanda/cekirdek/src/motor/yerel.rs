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
//!   toplanan atılır, sonraki bağlantı baştan dener. `esitlendi`'de tek işlemde `yereli_kuyruga_dok`:
//!   yerel kayıtlar fark olarak kuyruğa girer, kip `bagli` olur. Görünen kopya hiçbir zaman başka bir
//!   `depo_id`'nin tam telafisiyle değiştirilmez.
//! - Koparma (`Motor::baglantiyi_kopar`): bağlı kipten yerel kipe; görünen kopya o anki haliyle kalır.
//! - Önizlemeli birleştirme D4'tedir; bağlı kipte `eslesmeyi_kaldir` ve yeni QR'ın koparmaya dönmesi D2'de.

use std::collections::BTreeMap;

use super::iyimser::{IyimserBaglam, Uygulama, gorunen_yenile, islem_coz, islem_uygula, iyimser_uygula, kayittan_govde, yazar};
use super::islem::govde_farki;
use super::kanal::gecmis_satiri;
use super::{Asama, Etkiler, Motor, Ortam};
use crate::depo::{Depo, KopyaTablosu, KuyrukSatiri, anahtar};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{CalismaKipi, GecmisSayfasi, KoparmaSonucu};
use crate::model::sinirlar::ajanda::{GECMIS_SAYFA, KAYIT_ADET};
use crate::model::{
    AjandaGecmisGirdisi, AjandaIslem, AjandaKaydi, AjandaParca, AjandaRetNedeni, AjandaYazar, AjandaZamani, Alan,
    GirdiYolu, Hatirlatma, KayitDurumu, KaynakYolu, OrnekDurumu, TurKokeni,
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

/// Servisin `fark`'ı: izlenen alanlardan (kayıt alanları, `taslak`, `silindi`) yalnız değişenlerin öncesi ve
/// sonrası; `ornekler` değiştiyse iki tam liste.
fn fark(o: &AjandaKaydi, s: &AjandaKaydi) -> (AjandaParca, AjandaParca) {
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
    (a, b)
}

/// Servisin `dogumParcasi`'ı: kaydın var olan alanları, durum ve taslak.
fn dogum_parcasi(k: &AjandaKaydi) -> AjandaParca {
    AjandaParca {
        tur: Some(k.tur),
        baslik: Some(k.baslik.clone()),
        aciklama: k.aciklama.clone().map_or(Alan::Yok, Alan::Deger),
        zaman: k.zaman.clone().map_or(Alan::Yok, Alan::Deger),
        hatirlatmalar: Some(k.hatirlatmalar.clone()),
        tekrar: k.tekrar.clone().map_or(Alan::Yok, Alan::Deger),
        durum: Some(k.durum),
        taslak: Some(k.taslak),
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
fn kuyruga_islemler(temel: Option<&AjandaKaydi>, k: &AjandaKaydi) -> Vec<(AjandaIslem, i64)> {
    let kayit_id = || k.kayit_id.clone();
    let mut l = Vec::new();
    let ts = k.guncelleme_ms;
    let bos = AjandaKaydi { ornekler: vec![], durum: KayitDurumu::Acik, taslak: false, silindi: false, ..k.clone() };
    let t = match temel {
        None => {
            let girdi_yolu = if k.kaynak.yol == KaynakYolu::SesliNot { GirdiYolu::SesliNot } else { GirdiYolu::Elle };
            l.push((AjandaIslem::Ekle { kayit_id: kayit_id(), govde: kayittan_govde(k), v3: Default::default(), girdi_yolu }, k.olusturma_ms));
            &bos
        }
        Some(t) => t,
    };
    if t.silindi && !k.silindi {
        l.push((AjandaIslem::GeriYukle { kayit_id: kayit_id() }, ts));
    }
    let degisiklik = govde_farki(&kayittan_govde(t), &kayittan_govde(k));
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

/// Yerel kaydın fark temeli (`yereli_kuyruga_dok`). Servisin kopyasında aynı kimlikli kayıt yoksa temel
/// yoktur (kayıt `ekle` ile gider). Varsa: yeni kopya koparma anındaki temelle aynı depoya aitse ve o temel
/// kaydı biliyorsa eski temel (üç yollu: yalnız telefonda değişen alanlar gider, PC'de değişen dokunulmayan
/// alanlar PC'deki gibi kalır); değilse servisin kendi kopyası (yolda kalmış ekleme gibi: telefonun hali
/// fark olarak gider).
fn fark_temeli(d: &Depo, ayni_depo: bool, kayit_id: &str) -> Result<Option<AjandaKaydi>, CekirdekHatasi> {
    let Some(yeni) = d.telafi_kaydi(kayit_id)? else { return Ok(None) };
    if ayni_depo && let Some(eski) = d.sunucu_kaydi(kayit_id)? {
        return Ok(Some(eski));
    }
    Ok(Some(yeni))
}

/// Yerel kipten bağlı kipe: yerel kipte açılan bağlantının `esitlendi`'si (`kanal.rs`), çağıranın tek
/// işleminde. Servisin tam kopyası `telafi_kayitlari`'nda, koparma anındaki PC temeli `sunucu_kayitlari`'nda
/// ve `meta.depo_id`'dedir. Her görünen (yerel) kayıt için fark temeli (`fark_temeli`) ile yerel hal
/// arasındaki işlemler kuyruğa girer; sonra toplanan kopya sunucu kopyasının yerine geçer, `depo_id` ve
/// `son_rev` yazılır, kip `bagli` olur ve görünen kopya bağlı kipin tam telafi sonundaki gibi sunucu +
/// kuyruktan yeniden hesaplanır (yalnız PC'de olanlar eklenir; görünen kayıt silinmez).
///
/// Değişmez: her yerel kayıt ya görünen kopyada kalır (kuyruktaki işlemi iyimser görünür) ya da servis
/// işlemi reddedince ret listesine düşer. Kuyruğa hiçbir işlemi girmeyen kayıt servisin kopyasında vardır
/// (temelsiz kayıt hep `ekle` alır), yani görünen kopyadan düşmez. Döner: kuyruğa dökülen kayıtlar.
pub(crate) fn yereli_kuyruga_dok(
    d: &Depo,
    o: &Ortam,
    b: &IyimserBaglam,
    depo_id: &str,
    son_rev: i64,
) -> Result<Vec<String>, CekirdekHatasi> {
    let ayni_depo = d.depo_id()?.as_deref() == Some(depo_id);
    let mut dokulecek = Vec::new();
    for k in d.gorunen_hepsi()? {
        let temel = fark_temeli(d, ayni_depo, &k.kayit_id)?;
        let islemler = kuyruga_islemler(temel.as_ref(), &k);
        if !islemler.is_empty() {
            dokulecek.push((k.kayit_id, islemler));
        }
    }
    d.telafiyi_sunucuya_gecir()?;
    d.depo_id_yaz(depo_id)?;
    d.son_rev_yaz(son_rev)?;
    d.kip_yaz(false)?;
    let mut dokulen = Vec::new();
    for (kayit_id, islemler) in dokulecek {
        for (islem, ts) in islemler {
            let islem_id = Motor::yeni_kimlik(o, "i_")?;
            d.kuyruga_ekle(&islem_id, &kayit_id, &islem.json().to_string(), ts)?;
        }
        dokulen.push(kayit_id);
    }
    // Yerel kipte kuyruk boştu: sahipsiz görünen kayıt yoktur, onaylanmış satır yoktur; silme adımları gerekmez.
    for k in d.gorunenden_farkli_sunucu_kayitlari()? {
        d.gorunen_yaz(&k, false)?;
    }
    for kayit_id in &dokulen {
        gorunen_yenile(d, b, kayit_id)?;
    }
    Ok(dokulen)
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
        let mut hal = d.sunucu_kaydi(kayit_id)?;
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

impl Motor {
    /// Koparma (`YOL-HARITASI.md` 3.3 "Koparma"): bağlı kipten yerel kipe veri kaybı olmadan. Tek SQLite
    /// işleminde: görünen kopya o anki haliyle yerel gerçek olur (`bekleyen` düşer, metin aynı), onaylanmış
    /// satırlar PC temeline katılır (`onaylananlari_temele_kat`), kuyruk ve süren tam telafinin toplananları
    /// atılır, eşleşme bilgisi (eşleşme, bekleyen QR, son ret) silinir, kip `yerel` olur. Ret listesi, PC
    /// temeli (`sunucu_kayitlari`, `depo_id`, `son_rev`), yerel geçmiş ve alarm planı kalır (görünen kayıt
    /// değişmediği için alarm senkronu çağrılmaz). Sonra açık bağlantı kapatılır, geçmiş önbelleği (PC'nin
    /// geçmişi) atılır, cihaz anahtarı silinir.
    ///
    /// Yerel kipte kayıtlara dokunulmaz: süren bağlanma (eşleşme kayıtlı, servisin kopyası henüz gelmedi) ya
    /// da bekleyen eşleştirme iptal edilir (eşleşme bilgisi ve toplanan kopya silinir, bağlantı kapanır); PC
    /// temeli koparma anındaki haliyle kalır. Hiçbiri yoksa yalnız (zaten olmaması gereken) cihaz anahtarı
    /// silinir; çağrı yinelenebilir. Anahtar silinemezse hata döner ama veriler ve etkiler yazılmıştır
    /// (`eslesmeyi_kaldir` gibi); yinelenen çağrı anahtarı yeniden dener.
    pub(crate) fn baglantiyi_kopar(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<KoparmaSonucu, CekirdekHatasi> {
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
            }
        } else {
            let cevirici = o.cevirici();
            let b = self.iyimser_baglam(o, &cevirici)?;
            self.depo.yazma(|d| {
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
                };
                onaylananlari_temele_kat(d, &b, &kuyruk)?;
                d.kuyrugu_bosalt()?;
                d.bekleyenleri_dusur()?;
                d.telafiyi_sil()?;
                for a in bagli_eslesme {
                    d.meta_yaz(a, None)?;
                }
                d.kip_yaz(true)?;
                Ok(sonuc)
            })?
        };
        let degisti = !yerel || sonuc.baglanma_iptal;
        self.son_hata = None;
        self.surum_uyusmazligi = None;
        self.gecmis_istekleri.clear();
        if !yerel {
            // Önbellekteki sayfalar PC'nin geçmişidir; yerel kipte geçmiş yerel tablodan yeniden yüklenir.
            for kayit_id in std::mem::take(&mut self.gecmis).into_keys() {
                e.degisim.gecmis.push(kayit_id);
            }
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
        let l = kuyruga_islemler(Some(&temel), &k);
        assert_eq!(
            turler(&l),
            vec![
                r#"{"islem":"geri_yukle","kayit_id":"k_a"}"#,
                r#"{"degisiklik":{"baslik":"y"},"islem":"guncelle","kayit_id":"k_a","temel_revizyon":7}"#,
                r#"{"durum":"tamam","islem":"durum","kayit_id":"k_a"}"#,
                r#"{"durum":"acik","islem":"durum","kayit_id":"k_a","ornek_tarihi":"2026-11-24"}"#,
                r#"{"durum":"iptal","islem":"durum","kayit_id":"k_a","ornek_tarihi":"2026-11-25"}"#,
                r#"{"islem":"onayla","kayit_id":"k_a"}"#,
            ]
        );
        assert!(l.iter().all(|(_, ts)| *ts == 300));
        assert!(kuyruga_islemler(Some(&k), &k).is_empty(), "fark yoksa işlem yok");
    }

    /// Telefonda doğan kayıt: aynı kimlikle `ekle` (oluşturma anıyla), sonra durum, örnekler, silme.
    #[test]
    fn temelsiz_kayit_ekle_ile_baslar() {
        let k = kayit(|v| {
            v["kaynak"] = json!({"yol": "sesli_not", "tur_kokeni": "insan", "device_id": "yerel"});
            v["durum"] = json!("iptal");
            v["silindi"] = json!(true);
            v["ornekler"] = json!([{"tarih": "2026-11-24", "durum": "tamam"}]);
        });
        let l = kuyruga_islemler(None, &k);
        let t = turler(&l);
        assert_eq!(t.len(), 4);
        assert!(t[0].contains(r#""girdi_yolu":"sesli_not""#) && t[0].contains(r#""islem":"ekle""#), "{}", t[0]);
        assert_eq!(l[0].1, 100);
        assert_eq!(&t[1..], [
            r#"{"durum":"iptal","islem":"durum","kayit_id":"k_a"}"#,
            r#"{"durum":"tamam","islem":"durum","kayit_id":"k_a","ornek_tarihi":"2026-11-24"}"#,
            r#"{"islem":"sil","kayit_id":"k_a"}"#,
        ]);
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
}
