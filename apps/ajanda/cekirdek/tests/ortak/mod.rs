//! Uçtan uca testlerin ortak düzeneği (R4): Kotlin'in yerine geçen sahte kabuklar (kimlik, saat, alarm,
//! taşıma, gözlemci) ve `/ajanda` kanalını konuşan bir sahte PC servisi. Yalnız köprünün açık yüzeyi
//! (`Cekirdek`) kullanılır: Kotlin'in gördüğünün aynısı. Kişisel veri yoktur.
//!
//! Sahte PC servisin (`apps/phone/server/src/gateway-ajanda.ts`, `ajanda.ts`) davranışını kuralların
//! kendisiyle (`kural::birlesim`, `kural::ornek`, `kural::telafi`) yeniden kurar: tek sayaçtan revizyon,
//! `(device_id, islem_id)` tekrarsızlığı (geçici ret yazılmaz), telafi kararı, sayfa sayfa telafi, canlı
//! `kayit`. Gelen her çerçeveyi `ajanda_yukari_coz` ile denetler: uygulama geçersiz çerçeve yollarsa test
//! düşer.

#![allow(dead_code)]

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use ajanda_cekirdek::kopru::kabuklar::{AlarmKabugu, Gozlemci, KimlikKabugu, Tasima, ZamanKabugu};
use ajanda_cekirdek::kopru::tipler::{Degisim, KacirilanBildirimi, KurulacakAlarm};
use ajanda_cekirdek::kural::birlesim::ajanda_degisikligi_uygula;
use ajanda_cekirdek::kural::ornek::{OrnekDurumuSonucu, ajanda_ornek_durumu_uygula};
use ajanda_cekirdek::kural::telafi::{TelafiGirdisi, ajanda_telafi_tam_mi};
use ajanda_cekirdek::kural::{AnCevirici, SabitOfsetCevirici};
use ajanda_cekirdek::model::kanonik::{base64_coz, base64_yaz};
use ajanda_cekirdek::model::{
    AjandaAlani, AjandaAsagi, AjandaEslestirmeQr, AjandaGecmisGirdisi, AjandaIslem, AjandaKanalHatasi, AjandaKaydi,
    AjandaKaynagi, AjandaParca, AjandaRetNedeni, AjandaYazar, AjandaYukari, AjandaZamani, AlanDegisikligi, Hatirlatma,
    ImzaRolu, KayitDurumu, KayitGovdesi, KayitTuru, KaynakYolu, TurKokeni, YazarKimligi, YerelAn, ajanda_kimlik_imza_metni,
    ajanda_yukari_coz,
};
use ajanda_cekirdek::{Cekirdek, KabukHatasi};

/// 2026-11-25 14:30 Europe/Istanbul (UTC+3) = 11:30 UTC.
pub const SIMDI: i64 = 1_795_606_200_000;
pub const DK: i64 = 60_000;
pub const SAAT: i64 = 60 * DK;
pub const GUN: i64 = 24 * SAAT;
pub const IST: &str = "Europe/Istanbul";

/// Bugünün (25 Kasım) yerel `HH:MM`'inin anı.
pub fn bugun(saat: i64, dk: i64) -> i64 {
    SIMDI - (14 * SAAT + 30 * DK) + saat * SAAT + dk * DK
}

// ---------------------------------------------------------------------------------------------
// Sahte kabuklar
// ---------------------------------------------------------------------------------------------

/// İmza = verinin tersi; doğrulama = imza verinin tersi mi; rastgele = süreçler arası artan sayaç
/// (aynı `Arc` yeniden açılışta da verilir: kimlikler çakışmasın).
#[derive(Default)]
pub struct SahteKimlik {
    sayac: AtomicU64,
    pub silinen_anahtar: AtomicU64,
    /// Sonraki bu kadar `imzala` geçici hata versin (Keystore'un geçici hatası gibi).
    pub imza_hatasi: AtomicU64,
    /// Sonraki bu kadar `rastgele` hata versin.
    pub rastgele_hatasi: AtomicU64,
    /// `rastgele_hatasi` doluyken önce bu kadar çağrı hatasız geçsin (işlemin ortasında hata).
    pub rastgele_atla: AtomicU64,
}

/// Sayaç sıfır değilse bir azaltır ve `true` döner.
fn hata_sirasi(sayac: &AtomicU64) -> bool {
    let mut n = sayac.load(Ordering::SeqCst);
    while n > 0 {
        match sayac.compare_exchange(n, n - 1, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return true,
            Err(simdiki) => n = simdiki,
        }
    }
    false
}

impl KimlikKabugu for SahteKimlik {
    fn acik_anahtar(&self) -> Result<Vec<u8>, KabukHatasi> {
        Ok(vec![4; 65])
    }
    fn imzala(&self, mut veri: Vec<u8>) -> Result<Vec<u8>, KabukHatasi> {
        if hata_sirasi(&self.imza_hatasi) {
            return Err(KabukHatasi::Basarisiz { mesaj: "keystore geçici hata".into() });
        }
        veri.reverse();
        Ok(veri)
    }
    fn dogrula(&self, _acik: Vec<u8>, mut veri: Vec<u8>, imza: Vec<u8>) -> Result<bool, KabukHatasi> {
        veri.reverse();
        Ok(veri == imza)
    }
    fn rastgele(&self, uzunluk: u32) -> Result<Vec<u8>, KabukHatasi> {
        if self.rastgele_hatasi.load(Ordering::SeqCst) > 0 && !hata_sirasi(&self.rastgele_atla) && hata_sirasi(&self.rastgele_hatasi) {
            return Err(KabukHatasi::Basarisiz { mesaj: "rastgele üretilemedi".into() });
        }
        let n = self.sayac.fetch_add(1, Ordering::SeqCst) + 1;
        Ok((0..uzunluk as usize).map(|i| n.to_be_bytes()[i % 8] ^ (i as u8)).collect())
    }
    fn anahtari_sil(&self) -> Result<(), KabukHatasi> {
        self.silinen_anahtar.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

pub struct SahteZaman {
    pub simdi: AtomicI64,
    cevirici: SabitOfsetCevirici,
}

impl SahteZaman {
    pub fn yeni(simdi_ms: i64) -> Self {
        SahteZaman { simdi: AtomicI64::new(simdi_ms), cevirici: cevirici() }
    }
    pub fn ayarla(&self, ms: i64) {
        self.simdi.store(ms, Ordering::SeqCst);
    }
    pub fn ilerlet(&self, ms: i64) {
        self.simdi.fetch_add(ms, Ordering::SeqCst);
    }
}

pub fn cevirici() -> SabitOfsetCevirici {
    SabitOfsetCevirici::yeni([("UTC", 0), ("Etc/GMT-3", 180), (IST, 180)])
}

impl ZamanKabugu for SahteZaman {
    fn simdi_ms(&self) -> i64 {
        self.simdi.load(Ordering::SeqCst)
    }
    fn cihaz_dilimi(&self) -> String {
        IST.into()
    }
    fn yerelden_ana(&self, tarih: String, saat: String, saat_dilimi: String) -> Result<i64, KabukHatasi> {
        self.cevirici.ana_cevir(&tarih, &saat, &saat_dilimi).map_err(|e| KabukHatasi::Basarisiz { mesaj: e.mesaj })
    }
    fn andan_yerele(&self, an_ms: i64, saat_dilimi: String) -> Result<YerelAn, KabukHatasi> {
        self.cevirici.yerele_cevir(an_ms, &saat_dilimi).map_err(|e| KabukHatasi::Basarisiz { mesaj: e.mesaj })
    }
}

/// Android AlarmManager'ın yerine: kurulu alarmlar (`alarm_no` -> alarm), çağrı kayıtları.
#[derive(Default)]
pub struct SahteAlarm {
    pub kurulu: Mutex<BTreeMap<i64, KurulacakAlarm>>,
    pub kur_sayisi: AtomicU64,
    pub iptal_edilen: Mutex<Vec<i64>>,
    pub kacirilan: Mutex<Vec<KacirilanBildirimi>>,
    /// Kaçırılan özeti gösterilemesin (bildirim izni yok gibi).
    pub kacirilan_basarisiz: AtomicBool,
}

impl SahteAlarm {
    /// Kurulu alarmların `(kayit_id, tetik_ms)`'leri.
    pub fn kurulular(&self) -> Vec<(String, i64)> {
        let mut l: Vec<(String, i64)> = self.kurulu.lock().unwrap().values().map(|a| (a.kayit_id.clone(), a.tetik_ms)).collect();
        l.sort();
        l
    }
    pub fn kurulu_nolar(&self) -> Vec<i64> {
        self.kurulu.lock().unwrap().keys().copied().collect()
    }
}

impl AlarmKabugu for SahteAlarm {
    fn kur(&self, alarm: KurulacakAlarm) -> Result<(), KabukHatasi> {
        self.kur_sayisi.fetch_add(1, Ordering::SeqCst);
        self.kurulu.lock().unwrap().insert(alarm.alarm_no, alarm);
        Ok(())
    }
    fn iptal(&self, alarm_no: i64) -> Result<(), KabukHatasi> {
        self.kurulu.lock().unwrap().remove(&alarm_no);
        self.iptal_edilen.lock().unwrap().push(alarm_no);
        Ok(())
    }
    fn kacirilanlari_goster(&self, bildirim: KacirilanBildirimi) -> Result<(), KabukHatasi> {
        if self.kacirilan_basarisiz.load(Ordering::SeqCst) {
            return Err(KabukHatasi::Basarisiz { mesaj: "bildirim izni yok".into() });
        }
        self.kacirilan.lock().unwrap().push(bildirim);
        Ok(())
    }
}

#[derive(Default)]
pub struct SahteTasima {
    pub giden: Mutex<Vec<String>>,
    pub kapatildi: Mutex<Option<String>>,
}

impl Tasima for SahteTasima {
    fn gonder(&self, metin: String) -> bool {
        self.giden.lock().unwrap().push(metin);
        true
    }
    fn kapat(&self, neden: String) {
        *self.kapatildi.lock().unwrap() = Some(neden);
    }
}

#[derive(Default)]
pub struct SahteGozlemci {
    pub gelen: Mutex<Vec<Degisim>>,
}

impl SahteGozlemci {
    pub fn al(&self) -> Vec<Degisim> {
        std::mem::take(&mut *self.gelen.lock().unwrap())
    }
}

impl Gozlemci for SahteGozlemci {
    fn degisti(&self, degisim: Degisim) {
        self.gelen.lock().unwrap().push(degisim);
    }
}

// ---------------------------------------------------------------------------------------------
// Kayıt yardımcıları
// ---------------------------------------------------------------------------------------------

pub fn an(tarih: &str, saat: &str) -> AjandaZamani {
    AjandaZamani::An { tarih: tarih.into(), saat: saat.into(), sure_dk: None, saat_dilimi: IST.into(), ifade: None }
}

pub fn govde(baslik: &str, zaman: Option<AjandaZamani>) -> KayitGovdesi {
    KayitGovdesi {
        tur: KayitTuru::Randevu,
        baslik: baslik.into(),
        aciklama: None,
        zaman,
        hatirlatmalar: vec![Hatirlatma::Once { dk: 60 }],
        tekrar: None,
    }
}

// ---------------------------------------------------------------------------------------------
// Sahte PC servisi
// ---------------------------------------------------------------------------------------------

/// PC'nin açık anahtarı (QR'da): sahte kimlikte imza doğrulaması anahtara bakmaz.
pub const PC_ANAHTARI: [u8; 4] = [9, 9, 9, 9];
pub const ESLESTIRME_KODU: &str = "ABC123";
pub const CIHAZ: &str = "c_telefon1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sonuc {
    pub ok: bool,
    pub kayit_id: Option<String>,
    pub rev: Option<i64>,
    pub code: Option<AjandaRetNedeni>,
}

impl Sonuc {
    fn ok(kayit_id: &str, rev: Option<i64>) -> Self {
        Sonuc { ok: true, kayit_id: Some(kayit_id.into()), rev, code: None }
    }
    fn ret(kayit_id: Option<&str>, code: AjandaRetNedeni) -> Self {
        Sonuc { ok: false, kayit_id: kayit_id.map(str::to_string), rev: None, code: Some(code) }
    }
}

/// PC'nin bir bağlantı için tuttuğu.
pub enum PcAsama {
    HelloBekliyor,
    YanitBekliyor { hello_son_rev: i64, depo_id: Option<String>, iz: Option<(String, i64)>, client_nonce: String, server_nonce: String },
    Ajandada { son_rev: i64 },
}

pub struct PcCikti {
    pub cerceveler: Vec<String>,
    pub kapat: bool,
}

/// Servisin durumu. Alanlar testten değiştirilebilir (yedekten geri yükleme, hata enjeksiyonu).
#[derive(Clone)]
pub struct PcDurumu {
    pub depo_id: String,
    pub rev: i64,
    pub kayitlar: BTreeMap<String, AjandaKaydi>,
    /// Geçmiş: `rev` -> (kayit_id, ts): telafi izi.
    pub gecmis_izi: BTreeMap<i64, (String, i64)>,
    pub gecmis: BTreeMap<String, Vec<AjandaGecmisGirdisi>>,
    /// Tekrarsızlık: `islem_id` -> sonuç (geçici ret yazılmaz).
    pub sonuclar: HashMap<String, Sonuc>,
}

pub struct SahtePc {
    pub d: PcDurumu,
    pub zaman: Arc<SahteZaman>,
    pub cihaz_public_key: Option<String>,
    /// Gerçekten uygulanan (yan etkili ya da etkisiz) işlem kimlikleri, sırayla: çift uygulama denetimi.
    pub uygulanan: Vec<String>,
    // Hata enjeksiyonu
    /// Bu kayda işlem gelirse kaç kez daha `ic_hata` dönsün (`"*"`: her kayıt).
    pub ic_hata: HashMap<String, u32>,
    /// Bu kayıtlara gelen işlemin gövdesi "servisin şemasından geçmez": `gecersiz_islem`.
    pub gecersiz: HashSet<String>,
    /// `ekle` bu nedenle reddedilsin.
    pub ekle_reddi: Option<AjandaRetNedeni>,
    /// Sonraki bu kadar işlemi uygula ama yanıtlamadan bağlantıyı düşür.
    pub yanitsiz_kopar: u32,
    /// Sonraki bu kadar işlemi hiç işleme, yanıtlama (bağlantı açık kalır: telefon süreci yolda ölür).
    pub islem_yut: u32,
    /// Telafide bu kadar `kayit` yolladıktan sonra bağlantıyı düşür (bir kez).
    pub telafi_kes: Option<usize>,
    /// `islem_sonucu`'nu `kayit`'ten önce yolla.
    pub sonuc_once: bool,
    pub telafi_sayisi: u32,
    pub son_welcome_tam: Option<bool>,
}

impl SahtePc {
    pub fn yeni(depo_id: &str, zaman: Arc<SahteZaman>) -> Self {
        SahtePc {
            d: PcDurumu {
                depo_id: depo_id.into(),
                rev: 0,
                kayitlar: BTreeMap::new(),
                gecmis_izi: BTreeMap::new(),
                gecmis: BTreeMap::new(),
                sonuclar: HashMap::new(),
            },
            zaman,
            cihaz_public_key: None,
            uygulanan: Vec::new(),
            ic_hata: HashMap::new(),
            gecersiz: HashSet::new(),
            ekle_reddi: None,
            yanitsiz_kopar: 0,
            islem_yut: 0,
            telafi_kes: None,
            sonuc_once: false,
            telafi_sayisi: 0,
            son_welcome_tam: None,
        }
    }

    pub fn qr() -> AjandaEslestirmeQr {
        AjandaEslestirmeQr { host: "100.64.0.1".into(), port: 8787, kod: ESLESTIRME_KODU.into(), server_public_key: base64_yaz(&PC_ANAHTARI) }
    }

    fn simdi(&self) -> i64 {
        self.zaman.simdi_ms()
    }

    fn cerceve(m: AjandaAsagi) -> String {
        m.kodla()
    }

    /// Değişikliği tek sayaçtan revizyonla yazar; `kayit` çerçevesini döner.
    fn yaz(&mut self, mut k: AjandaKaydi, ts: i64, islem: ajanda_cekirdek::model::IslemTuru, yazar: AjandaYazar) -> AjandaKaydi {
        self.d.rev += 1;
        k.revizyon = self.d.rev;
        k.guncelleme_ms = ts;
        k.gecerli_mi().unwrap_or_else(|h| panic!("sahte PC bozuk kayıt yazdı: {} {}", h.yol, h.neden));
        self.d.gecmis_izi.insert(self.d.rev, (k.kayit_id.clone(), ts));
        self.d.gecmis.entry(k.kayit_id.clone()).or_default().insert(
            0,
            AjandaGecmisGirdisi {
                rev: self.d.rev,
                ts_ms: ts,
                islem,
                yazar,
                temel_revizyon: None,
                korunan_alanlar: None,
                ornek_tarihi: None,
                onceki: AjandaParca::default(),
                sonraki: AjandaParca { baslik: Some(k.baslik.clone()), ..Default::default() },
            },
        );
        self.d.kayitlar.insert(k.kayit_id.clone(), k.clone());
        k
    }

    fn arac_yazari() -> AjandaYazar {
        AjandaYazar { yol: KaynakYolu::SohbetAraci, tur_kokeni: TurKokeni::Insan, device_id: None, sohbet_id: Some("ana".into()), oturum_id: None }
    }

    /// Sohbet aracından (PC tarafında) yeni kayıt; `taslak`: sentetik turdan doğdu.
    pub fn disaridan_ekle(&mut self, kayit_id: &str, g: &KayitGovdesi, taslak: bool) -> AjandaKaydi {
        let ts = self.simdi();
        let k = AjandaKaydi {
            kayit_id: kayit_id.into(),
            revizyon: 1,
            tur: g.tur,
            baslik: g.baslik.clone(),
            aciklama: g.aciklama.clone(),
            zaman: g.zaman.clone(),
            hatirlatmalar: g.hatirlatmalar.clone(),
            tekrar: g.tekrar.clone(),
            ornekler: vec![],
            durum: KayitDurumu::Acik,
            taslak,
            silindi: false,
            elle_alanlar: vec![],
            kaynak: AjandaKaynagi {
                yol: KaynakYolu::SohbetAraci,
                tur_kokeni: if taslak { TurKokeni::Sentetik } else { TurKokeni::Insan },
                sohbet_id: Some("ana".into()),
                oturum_id: None,
                kaynak_msg_id: None,
                device_id: None,
                alinti: None,
                tekil_anahtar: None,
            },
            olusturma_ms: ts,
            guncelleme_ms: ts,
        };
        self.yaz(k, ts, ajanda_cekirdek::model::IslemTuru::Ekle, Self::arac_yazari())
    }

    /// PC tarafında var olan kaydı değiştirir (araç ya da başka cihaz).
    pub fn disaridan_degistir(&mut self, kayit_id: &str, f: impl FnOnce(&mut AjandaKaydi)) -> AjandaKaydi {
        let mut k = self.d.kayitlar[kayit_id].clone();
        f(&mut k);
        let ts = self.simdi().max(k.guncelleme_ms);
        self.yaz(k, ts, ajanda_cekirdek::model::IslemTuru::Guncelle, Self::arac_yazari())
    }

    /// Servis `islemCalistir`'inin karşılığı.
    fn islem_calistir(&mut self, islem: &AjandaIslem) -> (Sonuc, Option<AjandaKaydi>) {
        use ajanda_cekirdek::model::IslemTuru as T;
        let simdi = self.simdi();
        let yazar_yolu = match islem {
            AjandaIslem::Ekle { girdi_yolu, .. } => girdi_yolu.yol(),
            _ => KaynakYolu::Elle,
        };
        let yazar = AjandaYazar { yol: yazar_yolu, tur_kokeni: TurKokeni::Insan, device_id: Some(CIHAZ.into()), sohbet_id: None, oturum_id: None };
        let kimlik = YazarKimligi { yol: yazar_yolu, tur_kokeni: TurKokeni::Insan };
        let kayit_id = islem.kayit_id().to_string();
        if let AjandaIslem::Ekle { govde: g, girdi_yolu, .. } = islem {
            if self.d.kayitlar.contains_key(&kayit_id) {
                return (Sonuc::ret(Some(&kayit_id), AjandaRetNedeni::KimlikCakisiyor), None);
            }
            if let Some(n) = self.ekle_reddi {
                return (Sonuc::ret(Some(&kayit_id), n), None);
            }
            let mut elle = vec![AjandaAlani::Tur, AjandaAlani::Baslik];
            if g.aciklama.is_some() {
                elle.push(AjandaAlani::Aciklama);
            }
            if g.zaman.is_some() {
                elle.push(AjandaAlani::Zaman);
            }
            elle.push(AjandaAlani::Hatirlatmalar);
            if g.tekrar.is_some() {
                elle.push(AjandaAlani::Tekrar);
            }
            let k = AjandaKaydi {
                kayit_id: kayit_id.clone(),
                revizyon: 1,
                tur: g.tur,
                baslik: g.baslik.clone(),
                aciklama: g.aciklama.clone(),
                zaman: g.zaman.clone(),
                hatirlatmalar: g.hatirlatmalar.clone(),
                tekrar: g.tekrar.clone(),
                ornekler: vec![],
                durum: KayitDurumu::Acik,
                taslak: false,
                silindi: false,
                elle_alanlar: elle,
                kaynak: AjandaKaynagi {
                    yol: girdi_yolu.yol(),
                    tur_kokeni: TurKokeni::Insan,
                    sohbet_id: None,
                    oturum_id: None,
                    kaynak_msg_id: None,
                    device_id: Some(CIHAZ.into()),
                    alinti: None,
                    tekil_anahtar: None,
                },
                olusturma_ms: simdi,
                guncelleme_ms: simdi,
            };
            let k = self.yaz(k, simdi, T::Ekle, yazar);
            return (Sonuc::ok(&kayit_id, Some(k.revizyon)), Some(k));
        }
        let Some(k) = self.d.kayitlar.get(&kayit_id).cloned() else {
            return (Sonuc::ret(Some(&kayit_id), AjandaRetNedeni::KayitBulunamadi), None);
        };
        let yeni: Option<AjandaKaydi> = match islem {
            AjandaIslem::Sil { .. } => (!k.silindi).then(|| AjandaKaydi { silindi: true, ..k.clone() }),
            AjandaIslem::GeriYukle { .. } => k.silindi.then(|| AjandaKaydi { silindi: false, ..k.clone() }),
            _ if k.silindi => return (Sonuc::ret(Some(&kayit_id), AjandaRetNedeni::KayitSilinmis), None),
            AjandaIslem::Guncelle { degisiklik, .. } => {
                let b = ajanda_degisikligi_uygula(&k, &AlanDegisikligi::from(degisiklik.clone()), kimlik);
                (!b.uygulanan.is_empty()).then_some(b.kayit)
            }
            AjandaIslem::Durum { durum, ornek_tarihi: None, .. } => {
                let b = ajanda_degisikligi_uygula(&k, &AlanDegisikligi { durum: Some(*durum), ..Default::default() }, kimlik);
                (!b.uygulanan.is_empty()).then_some(b.kayit)
            }
            AjandaIslem::Durum { durum, ornek_tarihi: Some(t), .. } => {
                let dilim = match &k.zaman {
                    Some(AjandaZamani::An { saat_dilimi, .. }) | Some(AjandaZamani::Gun { saat_dilimi, .. }) => saat_dilimi.clone(),
                    _ => IST.into(),
                };
                let gun = cevirici().yerele_cevir(simdi, &dilim).unwrap().tarih;
                match ajanda_ornek_durumu_uygula(&k, t, *durum, &gun) {
                    OrnekDurumuSonucu::Gecersiz => return (Sonuc::ret(Some(&kayit_id), AjandaRetNedeni::OrnekGecersiz), None),
                    OrnekDurumuSonucu::Tamam { degisti: false, .. } => None,
                    OrnekDurumuSonucu::Tamam { ornekler, .. } => Some(AjandaKaydi { ornekler, ..k.clone() }),
                }
            }
            AjandaIslem::Onayla { .. } => k.taslak.then(|| AjandaKaydi { taslak: false, ..k.clone() }),
            AjandaIslem::Ekle { .. } => unreachable!(),
        };
        let Some(yeni) = yeni else { return (Sonuc::ok(&kayit_id, None), None) };
        if yeni.gecerli_mi().is_err() {
            return (Sonuc::ret(Some(&kayit_id), AjandaRetNedeni::TutarsizKayit), None);
        }
        let ts = simdi.max(k.guncelleme_ms);
        let tur = islem.tur();
        let y = self.yaz(yeni, ts, tur, yazar);
        (Sonuc::ok(&kayit_id, Some(y.revizyon)), Some(y))
    }

    fn sonuc_cercevesi(islem_id: &str, s: &Sonuc) -> String {
        Self::cerceve(AjandaAsagi::IslemSonucu {
            islem_id: islem_id.into(),
            ok: s.ok,
            kayit_id: s.kayit_id.clone(),
            rev: s.rev,
            korunan_alanlar: None,
            code: s.code,
        })
    }

    fn kayit_yolla(b: &mut PcAsama, k: &AjandaKaydi, cikti: &mut Vec<String>) {
        if let PcAsama::Ajandada { son_rev } = b
            && k.revizyon > *son_rev
        {
            cikti.push(Self::cerceve(AjandaAsagi::Kayit { kayit: k.clone() }));
            *son_rev = k.revizyon;
        }
    }

    /// Canlı yayın: bağlı telefona gidecek `kayit` (gateway `kayitYazildi`).
    pub fn yayin(b: &mut PcAsama, k: &AjandaKaydi) -> Vec<String> {
        let mut c = Vec::new();
        Self::kayit_yolla(b, k, &mut c);
        c
    }

    fn hata(code: AjandaKanalHatasi) -> PcCikti {
        PcCikti { cerceveler: vec![Self::cerceve(AjandaAsagi::Error { code, detail: None })], kapat: true }
    }

    /// Telefondan gelen bir çerçeve.
    pub fn isle(&mut self, b: &mut PcAsama, ham: &str) -> PcCikti {
        let m = ajanda_yukari_coz(ham).unwrap_or_else(|h| panic!("uygulama geçersiz çerçeve yolladı: {h:?} {ham}"));
        let mut c = Vec::new();
        match (&*b, m) {
            (PcAsama::HelloBekliyor, AjandaYukari::PairRequest { kod, public_key, .. }) => {
                if kod != ESLESTIRME_KODU {
                    let r = AjandaAsagi::PairResult { ok: false, device_id: None, server_public_key: None, code: Some(AjandaKanalHatasi::EslestirmeKoduGecersiz) };
                    return PcCikti { cerceveler: vec![Self::cerceve(r)], kapat: true };
                }
                self.cihaz_public_key = Some(public_key);
                let r = AjandaAsagi::PairResult {
                    ok: true,
                    device_id: Some(CIHAZ.into()),
                    server_public_key: Some(base64_yaz(&PC_ANAHTARI)),
                    code: None,
                };
                c.push(Self::cerceve(r));
            }
            (PcAsama::HelloBekliyor, AjandaYukari::Hello { device_id, son_rev, depo_id, son_rev_izi, client_nonce }) => {
                if device_id != CIHAZ || self.cihaz_public_key.is_none() {
                    return Self::hata(AjandaKanalHatasi::CihazBilinmiyor);
                }
                let server_nonce = base64_yaz(&[self.d.rev as u8 ^ 0x5a; 32]);
                let mut imza = ajanda_kimlik_imza_metni(ImzaRolu::Pc, CIHAZ, &client_nonce, &server_nonce).into_bytes();
                imza.reverse();
                c.push(Self::cerceve(AjandaAsagi::AuthChallenge { server_nonce: server_nonce.clone(), server_signature: base64_yaz(&imza) }));
                *b = PcAsama::YanitBekliyor {
                    hello_son_rev: son_rev,
                    depo_id,
                    iz: son_rev_izi.map(|i| (i.kayit_id, i.guncelleme_ms)),
                    client_nonce,
                    server_nonce,
                };
            }
            (PcAsama::YanitBekliyor { hello_son_rev, depo_id, iz, client_nonce, server_nonce }, AjandaYukari::AuthResponse { signature }) => {
                let mut beklenen = ajanda_kimlik_imza_metni(ImzaRolu::Telefon, CIHAZ, client_nonce, server_nonce).into_bytes();
                beklenen.reverse();
                if base64_coz(&signature) != Some(beklenen) {
                    return Self::hata(AjandaKanalHatasi::ImzaGecersiz);
                }
                let hello_son_rev = *hello_son_rev;
                let tam = ajanda_telafi_tam_mi(&TelafiGirdisi {
                    hello_son_rev,
                    hello_depo_id: depo_id.clone(),
                    hello_son_rev_izi: iz.clone().map(|(kayit_id, guncelleme_ms)| ajanda_cekirdek::model::AjandaRevIzi { kayit_id, guncelleme_ms }),
                    depo_id: self.d.depo_id.clone(),
                    bas_rev: self.d.rev,
                    izdeki: self.d.gecmis_izi.get(&hello_son_rev).cloned(),
                });
                self.telafi_sayisi += 1;
                self.son_welcome_tam = Some(tam);
                c.push(Self::cerceve(AjandaAsagi::Welcome { depo_id: self.d.depo_id.clone(), bas_rev: self.d.rev, tam, server_time_ms: self.simdi() }));
                let alt = if tam { 0 } else { hello_son_rev.min(self.d.rev) };
                let mut sirali: Vec<&AjandaKaydi> = self.d.kayitlar.values().filter(|k| k.revizyon > alt).collect();
                sirali.sort_by_key(|k| k.revizyon);
                for (i, k) in sirali.into_iter().enumerate() {
                    if self.telafi_kes == Some(i) {
                        self.telafi_kes = None;
                        return PcCikti { cerceveler: c, kapat: true };
                    }
                    c.push(Self::cerceve(AjandaAsagi::Kayit { kayit: k.clone() }));
                }
                c.push(Self::cerceve(AjandaAsagi::Esitlendi { rev: self.d.rev }));
                *b = PcAsama::Ajandada { son_rev: self.d.rev };
            }
            (PcAsama::Ajandada { .. }, AjandaYukari::Islem { islem_id, islem }) => {
                if self.islem_yut > 0 {
                    self.islem_yut -= 1;
                    return PcCikti { cerceveler: vec![], kapat: false };
                }
                if let Some(s) = self.d.sonuclar.get(&islem_id) {
                    c.push(Self::sonuc_cercevesi(&islem_id, s));
                    return PcCikti { cerceveler: c, kapat: false };
                }
                let kayit_id = islem.kayit_id().to_string();
                if self.gecersiz.contains(&kayit_id) {
                    let s = Sonuc::ret(None, AjandaRetNedeni::GecersizIslem);
                    self.d.sonuclar.insert(islem_id.clone(), s.clone());
                    c.push(Self::sonuc_cercevesi(&islem_id, &s));
                    return PcCikti { cerceveler: c, kapat: false };
                }
                for anahtar in [kayit_id.as_str(), "*"] {
                    if let Some(n) = self.ic_hata.get_mut(anahtar)
                        && *n > 0
                    {
                        *n -= 1;
                        c.push(Self::sonuc_cercevesi(&islem_id, &Sonuc::ret(None, AjandaRetNedeni::IcHata)));
                        return PcCikti { cerceveler: c, kapat: false };
                    }
                }
                let (s, kayit) = self.islem_calistir(&islem);
                self.uygulanan.push(islem_id.clone());
                self.d.sonuclar.insert(islem_id.clone(), s.clone());
                if self.yanitsiz_kopar > 0 {
                    self.yanitsiz_kopar -= 1;
                    return PcCikti { cerceveler: vec![], kapat: true };
                }
                let sonuc = Self::sonuc_cercevesi(&islem_id, &s);
                if self.sonuc_once {
                    c.push(sonuc.clone());
                }
                if let Some(k) = &kayit {
                    Self::kayit_yolla(b, k, &mut c);
                }
                if !self.sonuc_once {
                    c.push(sonuc);
                }
            }
            (PcAsama::Ajandada { .. }, AjandaYukari::GecmisIste { istek_id, kayit_id, once_rev }) => {
                let girdiler: Vec<AjandaGecmisGirdisi> = self
                    .d
                    .gecmis
                    .get(&kayit_id)
                    .map(|l| l.iter().filter(|g| once_rev.is_none_or(|r| g.rev < r)).take(2).cloned().collect())
                    .unwrap_or_default();
                let devami = self
                    .d
                    .gecmis
                    .get(&kayit_id)
                    .map(|l| l.iter().filter(|g| once_rev.is_none_or(|r| g.rev < r)).count() > 2)
                    .unwrap_or(false);
                c.push(Self::cerceve(AjandaAsagi::Gecmis { istek_id, kayit_id, girdiler, devami, code: None }));
            }
            (_, m) => panic!("sahte PC: beklenmeyen çerçeve {}", m.tur()),
        }
        PcCikti { cerceveler: c, kapat: false }
    }
}

// ---------------------------------------------------------------------------------------------
// Hat: çekirdek + sahteler + PC, çerçeveleri iki yöne taşır
// ---------------------------------------------------------------------------------------------

pub struct Baglanti {
    pub nesil: u64,
    pub tasima: Arc<SahteTasima>,
    pub pc: PcAsama,
}

pub struct Hat {
    pub c: Arc<Cekirdek>,
    pub yol: String,
    pub kimlik: Arc<SahteKimlik>,
    pub zaman: Arc<SahteZaman>,
    pub alarm: Arc<SahteAlarm>,
    pub gozlemci: Arc<SahteGozlemci>,
    pub pc: SahtePc,
    pub baglanti: Option<Baglanti>,
    /// D4: trafik durulunca onay bekleyen birleştirme kendiliğinden onaylanır (`pompala`). Yerel kipten
    /// bağlanmanın sonucunu (D1, D2 kuralları) sınayan testler için; önizleme testleri kapatır.
    pub otomatik_onay: bool,
    /// Son alan: çekirdek kapandıktan sonra düşer ve dosyaları siler.
    _dosya: GeciciDosya,
}

/// Düşünce veritabanı dosyalarını siler.
pub struct GeciciDosya(pub String);

impl Drop for GeciciDosya {
    fn drop(&mut self) {
        for ek in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ek}", self.0));
        }
    }
}

pub fn gecici_yol(ad: &str) -> String {
    let yol = std::env::temp_dir().join(format!(
        "ajanda-uctan-{ad}-{}-{}.sqlite3",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    yol.to_str().unwrap().to_string()
}

impl Hat {
    /// Dosyada (yeniden açılabilir) yeni hat.
    pub fn yeni(ad: &str) -> Hat {
        let zaman = Arc::new(SahteZaman::yeni(SIMDI));
        let kimlik = Arc::new(SahteKimlik::default());
        let alarm = Arc::new(SahteAlarm::default());
        let gozlemci = Arc::new(SahteGozlemci::default());
        let yol = gecici_yol(ad);
        let c = Cekirdek::ac(yol.clone(), kimlik.clone(), zaman.clone(), alarm.clone()).unwrap();
        c.gozlemci_ekle(gozlemci.clone());
        let pc = SahtePc::yeni("d_pc1", zaman.clone());
        Hat { c, yol: yol.clone(), kimlik, zaman, alarm, gozlemci, pc, baglanti: None, otomatik_onay: true, _dosya: GeciciDosya(yol) }
    }

    /// Var olan bir yerel veritabanının üstüne (yükseltme): `sql` dosyaya yazılır, sonra çekirdek açılır.
    pub fn sql_depoyla(ad: &str, sql: &str) -> Hat {
        let yol = gecici_yol(ad);
        let dosya = GeciciDosya(yol.clone());
        rusqlite::Connection::open(&yol).unwrap().execute_batch(sql).unwrap();
        let zaman = Arc::new(SahteZaman::yeni(SIMDI));
        let kimlik = Arc::new(SahteKimlik::default());
        let alarm = Arc::new(SahteAlarm::default());
        let gozlemci = Arc::new(SahteGozlemci::default());
        let c = Cekirdek::ac(yol.clone(), kimlik.clone(), zaman.clone(), alarm.clone()).unwrap();
        c.gozlemci_ekle(gozlemci.clone());
        let pc = SahtePc::yeni("d_pc1", zaman.clone());
        Hat { c, yol, kimlik, zaman, alarm, gozlemci, pc, baglanti: None, otomatik_onay: true, _dosya: dosya }
    }

    /// Süreç öldü ve yeniden açıldı: bağlantı kapanış haberi verilmeden çekirdek düşer. Android'in
    /// alarmları süreçten bağımsızdır (sahte alarm aynı kalır).
    pub fn sureci_oldur_ve_ac(&mut self) {
        self.baglanti = None;
        let c = Cekirdek::ac(self.yol.clone(), self.kimlik.clone(), self.zaman.clone(), self.alarm.clone()).unwrap();
        c.gozlemci_ekle(self.gozlemci.clone());
        self.c = c;
    }

    /// QR okut ve eşleştir (bağlanır, eşitler).
    pub fn eslestir(&mut self) {
        self.c.eslestirme_baslat(SahtePc::qr()).unwrap();
        self.baglan();
    }

    /// Yeni bağlantı açar ve trafik durulana dek çerçeveleri taşır.
    pub fn baglan(&mut self) {
        let tasima = Arc::new(SahteTasima::default());
        let nesil = self.c.baglanti_acildi(tasima.clone()).unwrap();
        self.baglanti = Some(Baglanti { nesil, tasima, pc: PcAsama::HelloBekliyor });
        self.pompala();
    }

    /// Bağlantı koptu (iki taraf da kapanışı görür).
    pub fn kopar(&mut self) {
        if let Some(b) = self.baglanti.take() {
            self.c.baglanti_kapandi(b.nesil, None).unwrap();
        }
    }

    /// Telefonun yolladıklarını PC'ye, PC'nin yanıtlarını telefona taşır; durulunca döner.
    pub fn pompala(&mut self) {
        for _ in 0..10_000 {
            let Some(b) = self.baglanti.as_mut() else { return };
            if b.tasima.kapatildi.lock().unwrap().take().is_some() {
                self.kopar();
                return;
            }
            let giden: Vec<String> = std::mem::take(&mut *b.tasima.giden.lock().unwrap());
            if giden.is_empty() {
                if self.otomatik_onay
                    && let Some(p) = self.c.birlestirme_onizlemesi().unwrap()
                {
                    assert!(self.c.birlestirmeyi_onayla(Some(p.iz)).unwrap().uygulandi);
                    continue;
                }
                return;
            }
            for f in giden {
                let b = self.baglanti.as_mut().unwrap();
                let cikti = self.pc.isle(&mut b.pc, &f);
                let nesil = b.nesil;
                for g in cikti.cerceveler {
                    self.c.cerceve_geldi(nesil, g).unwrap();
                }
                if cikti.kapat {
                    self.kopar();
                    return;
                }
            }
        }
        panic!("trafik durulmadı");
    }

    /// PC tarafında değişiklik; bağlıysa canlı yayın telefona gider.
    pub fn pc_degisti(&mut self, k: AjandaKaydi) {
        if let Some(b) = self.baglanti.as_mut() {
            let nesil = b.nesil;
            for f in SahtePc::yayin(&mut b.pc, &k) {
                self.c.cerceve_geldi(nesil, f).unwrap();
            }
        }
        self.pompala();
    }

    pub fn canli_mi(&self) -> bool {
        self.c.baglanti_durumu().unwrap().asama == ajanda_cekirdek::kopru::tipler::BaglantiAsamasi::Canli
    }

    /// Kullanıcının içe aktarma yolu: önizleme, sonra onun iziyle uygulama (iz zorunlu).
    pub fn ice_aktar_onayla(&self, belge: &str) -> ajanda_cekirdek::kopru::tipler::IceAktarmaSonucu {
        let on = self.c.ice_aktarma_onizlemesi(belge.to_string()).unwrap();
        self.c.ice_aktar(belge.to_string(), Some(on.iz)).unwrap()
    }
}
