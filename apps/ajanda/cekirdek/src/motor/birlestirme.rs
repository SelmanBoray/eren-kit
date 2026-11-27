//! SAHİBİ: D4 (birleştirme önizlemesi, `YOL-HARITASI.md` 3.3 "Bağlanma", 3.4 madde 3). Yerel kipten servise
//! bağlanırken (yeni eşleşme, koparmadan sonra yeniden eşleşme, bağlı kipte farklı `depo_id`'li `welcome`:
//! hepsi yerel kipten bağlanmadır) yerel kayıtlar kullanıcıya sorulmadan servise dökülmez.
//!
//! Durum makinesi:
//! - Servisin tam kopyası toplanır (`kanal.rs`, `telafi_kayitlari`); `esitlendi`'de plan kurulur
//!   (`yerel::dokme_plani`, salt okur). Planda her telefon kaydı `Ayni` ise (telefonda kayıt yok ya da hepsi
//!   servistekiyle aynı ya da yalnız servis ilerlemiş) soru sorulmaz: dökme hemen, bugünkü gibi.
//! - Yoksa **onay bekleniyor**: kip `Yerel` kalır, bağlantı açık ve aşaması `Telafi` (Kotlin'in gördüğü
//!   `BaglantiAsamasi.Telafi`; servis telefonu canlı sayar, gelen canlı `kayit`'ler toplanan kopyaya yazılır),
//!   `meta.birlestirme_bekliyor` servisin `depo_id`'sini taşır. Gözlemciye `Degisim.baglanti`; arayüz
//!   `birlestirme_onizlemesi()` ile planı okur. Yerel yazmalar sürer (kip yerel).
//! - Onay (`birlestirmeyi_onayla(iz)`): tek SQLite işleminde plan yeniden kurulur; `iz` zorunludur: yoksa ya da
//!   şimdiki planınkiyle tutmuyorsa (önizlemeden sonra telefon ya da servisin kopyası planı değiştirdi) hiçbir
//!   şey yazılmaz, şimdiki plan döner (D3 `ice_aktar` kalıbı). Tutuyorsa dökme (`yerel::yereli_kuyruga_dok`, D2
//!   kuralları; işlemler bugünkü kuyruğa koyma yoluyla girer), olası çiftler ve iz (`meta.son_birlestirme_izi`)
//!   kaydedilir, kip `Bagli`, bağlantı `Canli`, kuyruk yollanmaya başlar. Dökme kalıcı olduktan sonra
//!   kuyruğun hatası çağrıyı başarısız yapmaz. Bekleyen yokken aynı izle gelen onay `zaten_uygulandi`'dır
//!   (ikinci ya da gecikmiş çağrı "bağlantı koptu" ile karışmaz).
//! - Bağlantı onaydan önce koparsa ya da süreç ölürse toplanan kopya ve işaret atılır (`telafiyi_sil`: kopma,
//!   `Motor::ac`, yeni `welcome`): hiçbir kayıt değişmemiştir, kip yerel kalır, sonraki bağlantı servisin
//!   kopyasını yeniden alır ve yeniden sorar. Kopya saklanmaz: onay her zaman servisin o anki kopyasına
//!   göre olmalıdır (saklı kopya servisin bu arada sildiği ya da eklediği kaydı, olası çifti göremez) ve
//!   yerel kipte `hello` hep boş gittiğinden yeniden alma zaten olacaktır.
//! - Vazgeç (`birlestirmeden_vazgec`): yerel kipte süren bağlanmanın iptalidir (`kopar_nedeniyle`'nin yerel
//!   kip yolu): eşleşme bilgisi, cihaz anahtarı ve toplanan kopya silinir, bağlantı kapanır; hiçbir kayıt, ret
//!   listesi girdisi, PC temeli ya da alarm değişmez. Eşleşme tutulsaydı bağlantı denetçisi yeniden bağlanır,
//!   her bağlantıda tam telafiyle aynı soru gelirdi; yeniden bağlanmak için QR yeniden okutulur ve yine
//!   sorulur. "Şimdi değil" ayrı bir çağrı değildir: soru yanıtsız kalır, bağlantı kopunca sonraki bağlantıda
//!   yeniden sorulur.
//!
//! Olası çift (`OlasiCift`): planda `Yeni` (servise `ekle` ile gidecek) bir telefon kaydı ile servisin
//! kopyasında olup telefonda bulunmayan bir kayıt, ikisi de silinmemiş, kimlikleri farklı ve tekil anahtarları
//! (`kural::tekil::ajanda_tekil_anahtari`: tür, başlık, zaman çekirdeği; kapsamsız) aynı. Durum (açık,
//! tamam), `ifade`, süre, açıklama ve hatırlatmalar anahtara girmez. İkisi de tutulur, birleştirilmez;
//! onayda `meta.olasi_ciftler`'e yazılır, `olasi_ciftler()` yalnız ikisi de görünen kopyada canlı olanları
//! döndürür (biri silinir ya da `ekle`'si reddedilirse işaret kendiliğinden düşer).
//!
//! Taslak (`DokmeSinifi::Taslak`, önizlemede `taslaklar`): servisin kopyasında olmayan yerel taslak (bağlı
//! kipten kalan öneri başka servise bağlanırken) `ekle` ile gitmez: servis kaydı taslak olarak alamaz,
//! `ekle` kullanıcının onaylamadığı öneriyi onaylanmış kayıt yapardı. Kaybolmaz: ret listesine düşer, görünen
//! kopyadan çıkar; kullanıcı düzeltirse yeni (onaylı) kayıt olur, atarsa gider. Servisin kopyasında olan
//! taslak alan alan birleşir (`yerel.rs` `taraf_sec`).
//!
//! İz: sınıflar, işlemler (içerikleriyle), ret metinleri, çakışan alanlar, telefonun her kaydının hali,
//! okunamayan PC temeli sayısı, servisten gelecekler ve olası çiftler.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::iyimser::IyimserBaglam;
use super::yerel::{DokmePlani, DokmeSinifi, dokme_plani, kayit_coz, yereli_kuyruga_dok};
use super::{Asama, Etkiler, Motor, Ortam};
use crate::depo::{Depo, KopyaTablosu, anahtar};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{BirlestirmeOnizlemesi, BirlestirmeSonucu, CakisanKayit, GecisNedeni, KoparmaSonucu, OlasiCift};
use crate::kural::tekil::ajanda_tekil_anahtari;
use crate::model::AjandaKaydi;

/// Kapsamsız tekil anahtar (tür, başlık, zaman çekirdeği).
fn tekil_anahtar(k: &AjandaKaydi) -> String {
    ajanda_tekil_anahtari("", k.tur, &k.baslik, k.zaman.as_ref())
}

/// FNV-1a 64: planın izi (D3'teki gibi; güvenlik değil, tutarlılık içindir).
struct Iz(u64);

impl Iz {
    fn yeni() -> Iz {
        Iz(0xcbf2_9ce4_8422_2325)
    }
    fn kat(&mut self, baytlar: &[u8]) {
        for b in baytlar {
            self.0 ^= u64::from(*b);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
        self.0 ^= 0xff;
        self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
    }
}

fn sayi(n: usize) -> i32 {
    i32::try_from(n).unwrap_or(i32::MAX)
}

/// Kullanıcıya sorulmalı mı: telefonun en az bir satırı servise gidecek, ret listesine ya da görünen
/// kopyadan düşecek. Değilse (her satır `Ayni`) geçiş sorusuzdur: telefon hiçbir şey göndermez ve yitirmez.
fn soru_gerekli(p: &DokmePlani) -> bool {
    p.kayitlar.iter().any(|k| k.sinif != DokmeSinifi::Ayni)
}

/// Planın önizlemesi ve izi (salt okur; `d` planın kurulduğu depo).
fn onizleme_kur(d: &Depo, depo_id: &str, plan: &DokmePlani) -> Result<BirlestirmeOnizlemesi, CekirdekHatasi> {
    let telefondaki: HashSet<&str> = plan.kayitlar.iter().map(|k| k.kayit_id.as_str()).collect();
    // Servisin telefonda olmayan canlı kayıtları, tekil anahtarlarıyla. Okunamayan servis satırı sayılmaz.
    let mut servistekiler: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut gelecekler = Vec::new();
    for s in d.kopya_satirlari(KopyaTablosu::Telafi)? {
        if telefondaki.contains(s.kayit_id.as_str()) {
            continue;
        }
        if let Some(n) = kayit_coz(&s.json).filter(|n| !n.silindi) {
            servistekiler.entry(tekil_anahtar(&n)).or_default().push(n.kayit_id);
            gelecekler.push(s.kayit_id);
        }
    }
    let mut o = BirlestirmeOnizlemesi {
        depo_id: depo_id.to_string(),
        ayni_depo: plan.ayni_depo,
        yeni: 0,
        degisen: 0,
        cakisanlar: Vec::new(),
        pc_silmisler: Vec::new(),
        ret_listesine: Vec::new(),
        dusecek_mezar: 0,
        ayni: 0,
        servisten_gelecek: sayi(gelecekler.len()),
        islem: 0,
        olasi_ciftler: Vec::new(),
        iz: String::new(),
        taslaklar: Vec::new(),
        okunamayan_pc_temeli: sayi(plan.okunamayan_temel),
    };
    let mut iz = Iz::yeni();
    iz.kat(depo_id.as_bytes());
    iz.kat(&[u8::from(plan.ayni_depo)]);
    iz.kat(&plan.okunamayan_temel.to_le_bytes());
    let mut islem = 0;
    for k in &plan.kayitlar {
        let id = || k.kayit_id.clone();
        // Telefonun hali (içerik ve yazım kimliği) ize girer, sınıf `Ayni` olsa da: işlemler zaten
        // içeriği taşır, bu da işlemi olmayan sınıflarda önizlemeden sonraki telefon değişikliğini yakalar.
        if let Some(t) = &k.telefon {
            iz.kat(t.json().to_string().as_bytes());
        }
        match k.sinif {
            DokmeSinifi::Yeni => o.yeni += 1,
            DokmeSinifi::Degisen => {
                o.degisen += 1;
                if !k.cakisan_alanlar.is_empty() {
                    o.cakisanlar.push(CakisanKayit { kayit_id: id(), alanlar: k.cakisan_alanlar.clone() });
                }
            }
            DokmeSinifi::PcSilmis => o.pc_silmisler.push(id()),
            DokmeSinifi::RetListesine => o.ret_listesine.push(id()),
            DokmeSinifi::Taslak => o.taslaklar.push(id()),
            DokmeSinifi::DusecekMezar => o.dusecek_mezar += 1,
            DokmeSinifi::Ayni => {
                o.ayni += 1;
                continue;
            }
        }
        islem += k.islemler.len();
        if k.sinif == DokmeSinifi::Yeni
            && let Some(t) = &k.telefon
            && let Some(esler) = servistekiler.get(&tekil_anahtar(t))
        {
            for s in esler {
                o.olasi_ciftler.push(OlasiCift { telefondaki: id(), servisteki: s.clone() });
            }
        }
        iz.kat(&[k.sinif as u8]);
        iz.kat(k.kayit_id.as_bytes());
        for (i, ts) in &k.islemler {
            iz.kat(i.json().to_string().as_bytes());
            iz.kat(&ts.to_le_bytes());
        }
        if let Some(j) = &k.ret_json {
            iz.kat(j.as_bytes());
        }
        for a in &k.cakisan_alanlar {
            iz.kat(a.as_bytes());
        }
    }
    o.islem = sayi(islem);
    iz.kat(&o.ayni.to_le_bytes());
    for g in &gelecekler {
        iz.kat(g.as_bytes());
    }
    for c in &o.olasi_ciftler {
        iz.kat(c.telefondaki.as_bytes());
        iz.kat(c.servisteki.as_bytes());
    }
    o.iz = format!("{:016x}", iz.0);
    Ok(o)
}

/// Kayıt görünen kopyada var ve silinmemiş mi (okunamayan satır sayılmaz).
fn canli(d: &Depo, kayit_id: &str) -> bool {
    d.gorunen_kayit(kayit_id).ok().flatten().is_some_and(|g| !g.kayit.silindi)
}

fn ciftleri_coz(metin: &str) -> Vec<(String, String)> {
    serde_json::from_str(metin).unwrap_or_default()
}

/// Onaylanan planın olası çiftlerini öncekilere katar (yinelenen ve artık canlı olmayan çiftler düşer).
fn ciftleri_yaz(d: &Depo, yeni: &[OlasiCift]) -> Result<(), CekirdekHatasi> {
    if yeni.is_empty() {
        return Ok(());
    }
    let mut hepsi: BTreeSet<(String, String)> = d.meta_oku(anahtar::OLASI_CIFTLER)?.as_deref().map(ciftleri_coz).unwrap_or_default().into_iter().collect();
    hepsi.extend(yeni.iter().map(|c| (c.telefondaki.clone(), c.servisteki.clone())));
    let kalan: Vec<(String, String)> = hepsi.into_iter().filter(|(a, b)| canli(d, a) && canli(d, b)).collect();
    let metin = serde_json::to_string(&kalan).map_err(|h| CekirdekHatasi::Depo { mesaj: h.to_string() })?;
    Ok(d.meta_yaz(anahtar::OLASI_CIFTLER, (!kalan.is_empty()).then_some(metin.as_str()))?)
}

/// Olası çiftler (onaylanmış birleştirmelerden), yalnız ikisi de görünen kopyada canlı olanlar.
pub(crate) fn olasi_ciftler(d: &Depo) -> Result<Vec<OlasiCift>, CekirdekHatasi> {
    let Some(metin) = d.meta_oku(anahtar::OLASI_CIFTLER)? else { return Ok(Vec::new()) };
    Ok(ciftleri_coz(&metin)
        .into_iter()
        .filter(|(a, b)| canli(d, a) && canli(d, b))
        .map(|(telefondaki, servisteki)| OlasiCift { telefondaki, servisteki })
        .collect())
}

/// Bir kaydın olası çiftleri (öteki kayıtların kimlikleri; yoksa boş).
pub(crate) fn olasi_ciftleri(d: &Depo, kayit_id: &str) -> Result<Vec<String>, CekirdekHatasi> {
    Ok(olasi_ciftler(d)?
        .into_iter()
        .filter_map(|c| {
            if c.telefondaki == kayit_id {
                Some(c.servisteki)
            } else if c.servisteki == kayit_id {
                Some(c.telefondaki)
            } else {
                None
            }
        })
        .collect())
}

/// Planı uygular (çağıranın işleminde): dökme, olası çiftler, son eşitlenme anı. Döner: ret listesine satır
/// eklendi mi.
fn uygula(
    d: &Depo,
    o: &Ortam,
    b: &IyimserBaglam,
    depo_id: &str,
    son_rev: i64,
    plan: &DokmePlani,
    ciftler: &[OlasiCift],
) -> Result<bool, CekirdekHatasi> {
    let ret = yereli_kuyruga_dok(d, o, b, depo_id, son_rev, plan)?;
    ciftleri_yaz(d, ciftler)?;
    d.meta_yaz(anahtar::SON_ESITLENME_MS, Some(&o.simdi_ms().to_string()))?;
    Ok(ret)
}

impl Motor {
    /// Onay bekleyen birleştirmenin servis `depo_id`'si: yerel kip, bağlantı telafi aşamasında (`esitlendi`
    /// geldi, onay bekleniyor) ve işaret var. Toplama sürerken işaret yoktur.
    fn bekleyen_birlestirme(&self) -> Result<Option<String>, CekirdekHatasi> {
        if !matches!(self.asama, Asama::Telafi(_)) || !self.yerel_mi()? {
            return Ok(None);
        }
        Ok(self.depo.meta_oku(anahtar::BIRLESTIRME)?)
    }

    /// Yerel kipte açılan bağlantının `esitlendi`'si (`kanal.rs`; tampon yazılmış). Soru gerekmiyorsa tek
    /// işlemde dökme yapılır ve `true` döner (çağıran bağlantıyı canlıya geçirir). Gerekiyorsa yalnız işaret
    /// yazılır, gözlemciye `Degisim.baglanti` gider ve `false` döner: çağıran telafi aşamasında kalır.
    pub(super) fn yerelden_baglan(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        b: &IyimserBaglam,
        depo_id: &str,
        son_rev: i64,
    ) -> Result<bool, CekirdekHatasi> {
        let ret = self.depo.yazma(|d| {
            let plan = dokme_plani(d, depo_id)?;
            if soru_gerekli(&plan) {
                d.meta_yaz(anahtar::BIRLESTIRME, Some(depo_id))?;
                return Ok(None);
            }
            uygula(d, o, b, depo_id, son_rev, &plan, &[]).map(Some)
        })?;
        match ret {
            Some(ret) => {
                self.yerelden_baglandi(e, ret);
                self.hepsi_degisti(o, e);
                Ok(true)
            }
            None => {
                e.degisim.baglanti = true;
                Ok(false)
            }
        }
    }

    /// Onay bekleyen birleştirmenin önizlemesi; bekleyen yoksa `None`. Tampondaki canlı `kayit`'ler önce
    /// toplanan kopyaya yazılır (plan servisin şimdiki kopyasına göre). Kayıtlara dokunmaz.
    pub(crate) fn birlestirme_onizlemesi(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<Option<BirlestirmeOnizlemesi>, CekirdekHatasi> {
        let Some(depo_id) = self.bekleyen_birlestirme()? else { return Ok(None) };
        self.telafi_tamponunu_yaz(o, e)?;
        let plan = dokme_plani(&self.depo, &depo_id)?;
        Ok(Some(onizleme_kur(&self.depo, &depo_id, &plan)?))
    }

    /// Onay: tek SQLite işleminde plan yeniden kurulur; `iz` zorunludur: yoksa ya da tutmuyorsa hiçbir şey
    /// yazılmaz (`uygulandi` yanlış, şimdiki plan). Tutuyorsa dökme ve izin kaydı; kalıcı olunca `esitlendi`
    /// sonundaki gibi: geçmiş önbelleği atılır, alarmlar ve `Degisim.tumu` (ret düştüyse `ret_listesi`),
    /// bağlantı canlı, kuyruk ilerler. Kalıcı işlemden sonraki adımın (kuyruğun) hatası çağrıyı başarısız
    /// yapmaz: birleştirme uygulanmıştır, kuyruk sonraki tetikte (sonuç, yeni bağlantı) yeniden dener.
    /// Bekleyen birleştirme yoksa hiçbir şey yazılmaz, `plan` `None`; iz en son uygulanan birleştirmeninkiyse
    /// `zaten_uygulandi` (ikinci ya da gecikmiş onay), değilse bağlantı koptu.
    pub(crate) fn birlestirmeyi_onayla(&mut self, o: &Ortam, e: &mut Etkiler, iz: Option<&str>) -> Result<BirlestirmeSonucu, CekirdekHatasi> {
        let Some(depo_id) = self.bekleyen_birlestirme()? else {
            let son = self.depo.meta_oku(anahtar::SON_BIRLESTIRME_IZI)?;
            let zaten_uygulandi = iz.is_some() && son.as_deref() == iz;
            return Ok(BirlestirmeSonucu { uygulandi: false, plan: None, zaten_uygulandi });
        };
        self.telafi_tamponunu_yaz(o, e)?;
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let (sonuc, ret) = self.depo.yazma(|d| {
            let son_rev = d.telafi_son_rev()?;
            let plan = dokme_plani(d, &depo_id)?;
            let onizleme = onizleme_kur(d, &depo_id, &plan)?;
            // İz zorunlu: kullanıcının görmediği plan uygulanmaz.
            if iz != Some(onizleme.iz.as_str()) {
                return Ok((BirlestirmeSonucu { uygulandi: false, plan: Some(onizleme), zaten_uygulandi: false }, false));
            }
            let ret = uygula(d, o, &b, &depo_id, son_rev, &plan, &onizleme.olasi_ciftler)?;
            d.meta_yaz(anahtar::SON_BIRLESTIRME_IZI, Some(&onizleme.iz))?;
            Ok((BirlestirmeSonucu { uygulandi: true, plan: Some(onizleme), zaten_uygulandi: false }, ret))
        })?;
        if !sonuc.uygulandi {
            return Ok(sonuc);
        }
        self.yerelden_baglandi(e, ret);
        self.hepsi_degisti(o, e);
        // `kanal.rs` `esitlendi`'nin sonu: bağlantı canlı, kuyruk yollanmaya başlar.
        self.son_hata = None;
        self.surum_uyusmazligi = None;
        e.degisim.baglanti = true;
        self.asama = Asama::Canli;
        let _ = self.kuyruk_ilerlet(o, e);
        Ok(sonuc)
    }

    /// Vazgeç: yerel kipte süren bağlanmanın iptali (`kopar_nedeniyle`'nin yerel kip yolu; kayıtlara
    /// dokunulmaz). Bağlı kipte `GecersizDurum` (koparma değildir; o `baglantiyi_kopar`).
    pub(crate) fn birlestirmeden_vazgec(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<KoparmaSonucu, CekirdekHatasi> {
        if !self.yerel_mi()? {
            return Err(CekirdekHatasi::GecersizDurum { mesaj: "bağlı kipte bekleyen birleştirme yok".into() });
        }
        self.kopar_nedeniyle(o, e, GecisNedeni::Koparma)
    }
}
