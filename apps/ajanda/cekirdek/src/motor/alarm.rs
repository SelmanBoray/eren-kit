//! SAHİBİ: R3 (hatırlatma planı). Alarm planını Android'e uygular: görünen kopyadaki kayıtlar
//! (`Depo::gorunen_kayit`, `Depo::etkin_kayitlar`) + `kural::hatirlatma` + kurulu alarmlar
//! (`depo/alarmlar.rs`) -> `Etkiler.alarm_kur` / `alarm_iptal` / `kacirilan`.
//! Kurulum stratejisi (hangi AlarmManager çağrısı) burada değil Kotlin `AlarmKabugu`'ndadır.
//!
//! Tek çekirdek işlem: bir kaydın planını kurulu satırlarıyla karşılaştırmak (`kaydi_esitle`). Plan
//! `şimdi`ye göre gelecek tetiklerdir (`kurulacakHatirlatmalar`), kaçırılan teslim edilmemiş kurulu
//! satırlardan pencereye düşenlerdir (`kacirilanHatirlatmalar`). Fark:
//! - planda olup satırı olmayan tetik: satır açılır, `kur` (yeni `alarm_no`);
//! - planda olup teslim edilmemiş satırı olan: dokunulmaz (`zorla`da yeniden `kur`, aynı numarayla);
//! - planda olup teslim edilmiş satırı olan (saat geri alındı): kurulmaz, ikinci kez çalmaz;
//! - kaçırılan: teslim edildi işaretlenir, `iptal` (geç gelen PendingIntent susar), tek özete eklenir;
//! - planda ve kaçırılanda olmayan teslim edilmemiş satır (kayıt değişti, kapandı, silindi, pencereden
//!   eski): `iptal`, satır silinir;
//! - teslim edilmiş satır pencereden eskiyse ya da kayıt artık etkin değilse silinir.
//!
//! Yazmalar kayıt başına tek savepoint'tir; etkiler yalnız savepoint bırakıldıktan sonra `Etkiler`'e
//! yazılır (motorun etki kuralı). Çeviri hatası (bilinmeyen dilim) yalnız o hatırlatmayı düşürür.
//!
//! Alarm bütçesi ve ufuk: Android uygulama başına en çok 500 alarm tutar (aşılınca kurma reddedilir).
//! Aynı anda en çok `ALARM_BUTCESI` teslim edilmemiş satır (= Android'de kurulu alarm) olur: bütün
//! kayıtların gelecek tetikleri `(tetik_ms, kayit_id)` sırasıyla dizilir, en yakın `ALARM_BUTCESI`
//! tanesi kurulur; en uzak kurulanın anahtarı `meta.alarm_ufku`'ya yazılır, ötesindekiler ertelenir
//! (satırı açılmaz; kuruluysa iptal edilip silinir). Teslim edilmiş satırı olan tetik kurulmayacağı
//! için bütçeden yer tutmaz. Tek kaydın senkronu yalnız ufkun içindeki tetikleri kurar; ardından
//! bütçe denetlenir (`butceyi_denetle`): bütçe aşıldıysa ya da ertelenen varken yer açıldıysa (alarm
//! çaldı, kayıt kapandı/silindi) bütün plan yeniden dizilir. Böylece en yakın hatırlatmalar hep
//! kurulu kalır, uzaktakiler yaklaştıkça kurulur.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::{Etkiler, Motor, Ortam};
use crate::depo::{KuruluAlarm, anahtar};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{HatirlatmaBildirimi, KacirilanBildirimi, KurulacakAlarm, YenidenKurmaNedeni};
use crate::kural::AnCevirici;
use crate::kural::hatirlatma::{HatirlatmaHali, KACIRILAN_PENCERE_MS, hatirlatma_hali, hatirlatma_kacirilanlari};
use crate::model::AjandaKaydi;

/// Aynı anda Android'e kurulu tutulan en çok alarm. Android'in uygulama başına sınırı 500'dür; pay:
/// iptali henüz işlenmemiş ya da çalıp henüz teslim işaretlenmemiş satırlar, sayım farkları.
pub const ALARM_BUTCESI: usize = 400;

/// Ufkun anahtarı: önce tetik zamanı, eşitlikte kayıt kimliği (toplam sıra; bir kaydın aynı tetikli iki
/// hatırlatması zaten tek alarmdır).
type Ufuk = (i64, String);

fn ufuk_icinde(tetik_ms: i64, kayit_id: &str, ufuk: Option<&Ufuk>) -> bool {
    ufuk.is_none_or(|(t, k)| (tetik_ms, kayit_id) <= (*t, k.as_str()))
}

/// Bir kaydın şimdiki planı: gelecek tetikler ve kaçırılanlar (`tetik_ms -> ornek_tarihi`).
/// Aynı tetikli iki hatırlatma tek alarmdır; örnek tarihi ilk hatırlatmanınkidir.
#[derive(Default)]
struct KayitPlani {
    gelecek: BTreeMap<i64, Option<String>>,
    kacirilan: BTreeMap<i64, Option<String>>,
}

fn plan_hesapla(kayit: Option<&AjandaKaydi>, satirlar: &[KuruluAlarm], simdi_ms: i64, an: &dyn AnCevirici) -> KayitPlani {
    let mut plan = KayitPlani::default();
    let Some(k) = kayit.filter(|k| k.hatirlatma_etkin_mi()) else {
        return plan;
    };
    let kurulu: HashSet<i64> = satirlar.iter().filter(|s| s.teslim_ms.is_none()).map(|s| s.tetik_ms).collect();
    for sira in 0..k.hatirlatmalar.len() {
        // Çeviri hatası: bu hatırlatma kurulmaz, ötekiler sürer (MIMARI.md R3).
        if let Ok(HatirlatmaHali::Kurulur { tetik_ms, ornek_tarihi, .. }) = hatirlatma_hali(k, sira, simdi_ms, an) {
            plan.gelecek.entry(tetik_ms).or_insert(ornek_tarihi);
        }
        if !kurulu.is_empty() {
            for t in hatirlatma_kacirilanlari(k, sira, simdi_ms, an, &kurulu).unwrap_or_default() {
                plan.kacirilan.entry(t.tetik_ms).or_insert(t.ornek_tarihi);
            }
        }
    }
    plan
}

fn bildirim(kayit: &AjandaKaydi, s: &KuruluAlarm) -> HatirlatmaBildirimi {
    HatirlatmaBildirimi {
        alarm_no: s.alarm_no,
        kayit_id: kayit.kayit_id.clone(),
        baslik: kayit.baslik.clone(),
        tur: kayit.tur,
        zaman: kayit.zaman.clone(),
        ornek_tarihi: s.ornek_tarihi.clone(),
        tetik_ms: s.tetik_ms,
    }
}

/// İptal: aynı `Etkiler`'de henüz uygulanmamış `kur` varsa düşer (köprü iptali kurdan önce uygular;
/// aynı çağrıda önce kurulup sonra iptal edilen alarm Android'de kalmasın).
pub(super) fn iptal_yaz(e: &mut Etkiler, alarm_no: i64) {
    e.alarm_kur.retain(|a| a.alarm_no != alarm_no);
    if !e.alarm_iptal.contains(&alarm_no) {
        e.alarm_iptal.push(alarm_no);
    }
}

/// Kur: aynı numara bu `Etkiler`'de bir kez (aynı planın iki kez kurulmaması).
pub(super) fn kur_yaz(e: &mut Etkiler, alarm: KurulacakAlarm) {
    e.alarm_kur.retain(|a| a.alarm_no != alarm.alarm_no);
    e.alarm_kur.push(alarm);
}

/// Kaçırılanlar tek özettir: aynı çağrıda birden çok kayıt (ya da birden çok senkron) birleşir.
pub(super) fn kacirilan_yaz(e: &mut Etkiler, satirlar: Vec<HatirlatmaBildirimi>) {
    if satirlar.is_empty() {
        return;
    }
    let ozet = e.kacirilan.get_or_insert_with(|| KacirilanBildirimi { satirlar: Vec::new() });
    for s in satirlar {
        if !ozet.satirlar.iter().any(|v| v.alarm_no == s.alarm_no) {
            ozet.satirlar.push(s);
        }
    }
    ozet.satirlar.sort_by_key(|s| (s.tetik_ms, s.alarm_no));
}

/// Ayrı toplanmış alarm etkilerini `e`'ye katar (R4 `Motor::alarm_isleminde`: işlem kalıcı olunca).
/// Aynı yazma kuralları geçerlidir: iptal bekleyen kuru düşürür, numara başına tek kur, tek özet.
pub(super) fn alarm_etkilerini_kat(e: &mut Etkiler, ek: Etkiler) {
    for no in ek.alarm_iptal {
        iptal_yaz(e, no);
    }
    for a in ek.alarm_kur {
        kur_yaz(e, a);
    }
    if let Some(k) = ek.kacirilan {
        kacirilan_yaz(e, k.satirlar);
    }
}

/// Gövdenin hatırlatmalarının şimdiye göre önizlemesi (v2; form ve ayrıntı görünümü): gövde açık ve taslak
/// olmayan bir kayıtmış gibi `hatirlatma_ozeti` + ilk kurulacak tetik. Kural alarm planınınkiyle aynıdır
/// (`kural::hatirlatma`); kayıt saklanmaz. Çeviri hatası (bilinmeyen dilim) döner.
pub(crate) fn hatirlatma_onizlemesi(
    govde: &crate::model::KayitGovdesi,
    simdi_ms: i64,
    an: &dyn AnCevirici,
) -> Result<crate::kopru::tipler::HatirlatmaOnizlemesi, crate::kural::ZamanHatasi> {
    use crate::kopru::tipler::{GunHatirlatmasi, HatirlatmaOnizlemesi};
    use crate::model::{AjandaKaynagi, KayitDurumu, KaynakYolu, TurKokeni};
    let kayit = AjandaKaydi {
        kayit_id: "k_onizleme".into(),
        revizyon: 1,
        tur: govde.tur,
        baslik: govde.baslik.clone(),
        aciklama: None,
        zaman: govde.zaman.clone(),
        hatirlatmalar: govde.hatirlatmalar.clone(),
        tekrar: govde.tekrar.clone(),
        ornekler: vec![],
        durum: KayitDurumu::Acik,
        taslak: false,
        silindi: false,
        elle_alanlar: vec![],
        kaynak: AjandaKaynagi {
            yol: KaynakYolu::Elle,
            tur_kokeni: TurKokeni::Insan,
            sohbet_id: None,
            oturum_id: None,
            kaynak_msg_id: None,
            device_id: None,
            alinti: None,
            tekil_anahtar: None,
        },
        olusturma_ms: simdi_ms,
        guncelleme_ms: simdi_ms,
        v3: Default::default(),
    };
    let oz = crate::kural::hatirlatma::hatirlatma_ozeti(&kayit, simdi_ms, an)?;
    let ilk = crate::kural::hatirlatma::kurulacak_hatirlatmalar(&kayit, simdi_ms, an)?.iter().map(|t| t.tetik_ms).min();
    Ok(HatirlatmaOnizlemesi {
        kurulacak: oz.kurulacak,
        saatsiz: oz.saatsiz,
        gecmis: oz.gecmis,
        ilk_tetik_ms: ilk,
        gun_hatirlatmasi: oz.gun_hatirlatmasi.map(|g| GunHatirlatmasi { tarih: g.tarih, saat: g.saat, gecti: g.gecti }),
    })
}

impl Motor {
    /// R4'ün her görünen kopya değişikliğinden sonra çağırdığı giriş: yalnız bu kayıtların alarmlarını
    /// plana göre düzeltir (yeni tetik kur, artık olmayanı iptal et ve sil, kaçırılanı göster).
    /// `kayitlar` boşsa bütün kopya (tam telafinin sonu). Kilit altında, etkileri `e`'ye yazar.
    ///
    /// R4 bunu kendi SQLite işlemini bitirdikten (commit) sonra çağırmalı: yazmalar savepoint'tir, dış
    /// işlem sonradan geri alınırsa `Etkiler`'e yazılmış kur/iptal gerçek hale karşılık gelmez.
    pub(crate) fn alarm_senkronu(&mut self, o: &Ortam, e: &mut Etkiler, kayitlar: &[String]) -> Result<(), CekirdekHatasi> {
        let simdi = o.simdi_ms();
        if kayitlar.is_empty() {
            return self.hepsini_esitle(o, e, simdi, false);
        }
        let tekil: BTreeSet<&str> = kayitlar.iter().map(String::as_str).collect();
        let ufuk = self.ufuk_oku()?;
        for kayit_id in tekil {
            let kayit = self.depo.gorunen_kayit(kayit_id)?.map(|g| g.kayit);
            self.kaydi_esitle(o, e, kayit_id, kayit.as_ref(), simdi, false, ufuk.as_ref())?;
        }
        self.butceyi_denetle(o, e, simdi)
    }

    fn ufuk_oku(&self) -> Result<Option<Ufuk>, CekirdekHatasi> {
        Ok(self.depo.meta_oku(anahtar::ALARM_UFKU)?.and_then(|s| {
            let (t, k) = s.split_once(' ')?;
            Some((t.parse().ok()?, k.to_string()))
        }))
    }

    /// Bütçe aşıldıysa ya da ertelenen tetik varken yer açıldıysa bütün planı yeniden dizer.
    fn butceyi_denetle(&mut self, o: &Ortam, e: &mut Etkiler, simdi: i64) -> Result<(), CekirdekHatasi> {
        let sayi = self.depo.kurulu_alarm_sayisi()?;
        if sayi > ALARM_BUTCESI || (sayi < ALARM_BUTCESI && self.ufuk_oku()?.is_some()) {
            self.hepsini_esitle(o, e, simdi, false)?;
        }
        Ok(())
    }

    /// Açılış, saat/dilim değişimi, paket güncellemesi, uygulama açılışı: bütün alarmları yeniden kur.
    ///
    /// Her nedende teslim edilmemiş bütün gelecek alarmlar aynı numarayla yeniden `kur`ulur (Android
    /// aynı istek kodunu değiştirir, çift alarm olmaz): yeniden başlatma AlarmManager'ı boşaltır, MIUI
    /// gibi sistemlerin zorla durdurması da haber vermeden boşaltabilir; elimizdeki tek kanıt kendi
    /// kaydımızdır. Geçmiş tetikler yağmur olmaz: yalnız kurulmuş ve teslim edilmemiş, pencere içindeki
    /// satırlar tek özette bir kez gösterilir.
    pub(crate) fn alarmlari_yeniden_kur(&mut self, o: &Ortam, e: &mut Etkiler, neden: YenidenKurmaNedeni) -> Result<(), CekirdekHatasi> {
        let _ = neden;
        let simdi = o.simdi_ms();
        self.hepsini_esitle(o, e, simdi, true)
    }

    /// Alarm çaldı: hâlâ geçerliyse bildirim içeriği (teslim edildi işaretlenir; tekrarda sıradaki kurulur),
    /// değilse `None` (kayıt arada değişti ya da silindi: susar).
    ///
    /// Geçerli: satır teslim edilmemiş, kayıt etkin ve tetik kaydın şimdiki hatırlatmalarından birinin
    /// (kapalı olmayan örneğin) tetiği, pencere içinde. Alarm erken çalarsa şimdi tetik kabul edilir.
    pub(crate) fn alarm_caldi(&mut self, o: &Ortam, e: &mut Etkiler, alarm_no: i64) -> Result<Option<HatirlatmaBildirimi>, CekirdekHatasi> {
        let Some(satir) = self.depo.alarm_no_ile(alarm_no)? else {
            return Ok(None);
        };
        if satir.teslim_ms.is_some() {
            return Ok(None);
        }
        let simdi = o.simdi_ms().max(satir.tetik_ms);
        let kayit = self.depo.gorunen_kayit(&satir.kayit_id)?.map(|g| g.kayit).filter(|k| k.hatirlatma_etkin_mi());
        let an = o.cevirici();
        let gecerli = kayit.as_ref().is_some_and(|k| {
            let kurulu = HashSet::from([satir.tetik_ms]);
            (0..k.hatirlatmalar.len())
                .any(|sira| hatirlatma_kacirilanlari(k, sira, simdi, &an, &kurulu).is_ok_and(|l| !l.is_empty()))
        });
        let sonuc = match (&kayit, gecerli) {
            (Some(k), true) => {
                self.depo.alarm_teslim_edildi(alarm_no, o.simdi_ms())?;
                Some(bildirim(k, &satir))
            }
            _ => None,
        };
        // Geçersizse satır burada iptal edilip silinir; geçerliyse tekrarda sıradaki örnek kurulur.
        let ufuk = self.ufuk_oku()?;
        self.kaydi_esitle(o, e, &satir.kayit_id, kayit.as_ref(), simdi, false, ufuk.as_ref())?;
        // Çalan alarm bütçede yer açtı: ertelenen varsa en yakını kurulur.
        self.butceyi_denetle(o, e, simdi)?;
        Ok(sonuc)
    }

    /// Köprü `AlarmKabugu.kur` başarısız olunca çağırır: kurulu sayılmasın (kaçırılan olarak da
    /// gösterilmez; sonraki senkron ya da yeniden kurulum yeni numarayla yeniden dener).
    pub(crate) fn alarm_kurulamadi(&mut self, alarm_no: i64, neden: &str) -> Result<(), CekirdekHatasi> {
        let _ = neden;
        if self.depo.alarm_no_ile(alarm_no)?.is_some_and(|s| s.teslim_ms.is_none()) {
            self.depo.alarm_sil(alarm_no)?;
        }
        Ok(())
    }

    /// Köprü `AlarmKabugu.kacirilanlari_goster` başarısız olunca çağırır (R4): gösterilemeyen satırların
    /// teslim işareti kaldırılır, satır yeniden "kurulu, teslim edilmemiş" olur; sonraki senkron ya da
    /// yeniden kurulum tetiği pencere içindeyse onu yeniden kaçırılan olarak gösterir, değilse sessizce
    /// düşürür (`kaydi_esitle`'nin fark tablosu). Böylece gösterim hatası bilgiyi kaybettirmez.
    pub(crate) fn kacirilan_gosterilemedi(&mut self, alarm_nolari: &[i64]) -> Result<(), CekirdekHatasi> {
        self.depo.alarm_islemi(|d| {
            for &no in alarm_nolari {
                d.alarm_teslimi_geri_al(no)?;
            }
            Ok(())
        })
    }

    /// Eşleşme kaldırılınca (R4 `motor/eslesme.rs`): bütün alarmları iptal eder, satırları siler.
    pub(crate) fn tum_alarmlari_kaldir(&mut self, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        let satirlar = self.depo.alarm_islemi(|d| {
            let mut silinen = Vec::new();
            for kayit_id in d.alarmli_kayitlar()? {
                for s in d.kaydin_alarm_satirlari(&kayit_id)? {
                    d.alarm_sil(s.alarm_no)?;
                    silinen.push(s);
                }
            }
            Ok(silinen)
        })?;
        for s in satirlar.into_iter().filter(|s| s.teslim_ms.is_none()) {
            iptal_yaz(e, s.alarm_no);
        }
        Ok(())
    }

    /// Etkin kayıtlar ve satırı olan her kayıt (görünen kopyadan düşmüş ya da kapanmış olanlar dahil).
    fn hepsini_esitle(&mut self, o: &Ortam, e: &mut Etkiler, simdi: i64, zorla: bool) -> Result<(), CekirdekHatasi> {
        let mut kayitlar: BTreeMap<String, Option<AjandaKaydi>> =
            self.depo.etkin_kayitlar()?.into_iter().map(|k| (k.kayit_id.clone(), Some(k))).collect();
        for kayit_id in self.depo.alarmli_kayitlar()? {
            if let std::collections::btree_map::Entry::Vacant(yer) = kayitlar.entry(kayit_id) {
                let kayit = self.depo.gorunen_kayit(yer.key())?.map(|g| g.kayit);
                yer.insert(kayit);
            }
        }
        let an = o.cevirici();
        let mut hazir: Vec<(String, Option<AjandaKaydi>, Vec<KuruluAlarm>, KayitPlani)> = Vec::with_capacity(kayitlar.len());
        for (kayit_id, kayit) in kayitlar {
            let satirlar = self.depo.kaydin_alarm_satirlari(&kayit_id)?;
            let plan = plan_hesapla(kayit.as_ref(), &satirlar, simdi, &an);
            hazir.push((kayit_id, kayit, satirlar, plan));
        }
        // Bütçe: kurulabilecek gelecek tetikler (teslim edilmiş satırı olan kurulmaz, yer tutmaz).
        let ufuk: Option<Ufuk> = {
            let mut adaylar: Vec<(i64, &str)> = hazir
                .iter()
                .flat_map(|(kayit_id, _, satirlar, plan)| {
                    plan.gelecek
                        .keys()
                        .filter(|t| !satirlar.iter().any(|s| s.tetik_ms == **t && s.teslim_ms.is_some()))
                        .map(move |t| (*t, kayit_id.as_str()))
                })
                .collect();
            (adaylar.len() > ALARM_BUTCESI).then(|| {
                let (_, sinir, _) = adaylar.select_nth_unstable(ALARM_BUTCESI - 1);
                (sinir.0, sinir.1.to_string())
            })
        };
        for (kayit_id, kayit, satirlar, mut plan) in hazir {
            plan.gelecek.retain(|t, _| ufuk_icinde(*t, &kayit_id, ufuk.as_ref()));
            self.plani_uygula(e, &kayit_id, kayit.as_ref(), &satirlar, &plan, simdi, zorla)?;
        }
        let ufuk_metni = ufuk.map(|(t, k)| format!("{t} {k}"));
        self.depo.meta_yaz(anahtar::ALARM_UFKU, ufuk_metni.as_deref())?;
        self.depo.eski_teslimleri_sil(simdi - KACIRILAN_PENCERE_MS)?;
        Ok(())
    }

    /// Bir kaydın planını kurulu satırlarıyla eşitler (dosya başındaki fark tablosu); yalnız `ufuk`
    /// içindeki gelecek tetikler kurulur. `kayit`: görünen hali (`None`: görünen kopyada yok). `zorla`:
    /// plandaki kurulu alarmları yeniden kur.
    #[allow(clippy::too_many_arguments)]
    fn kaydi_esitle(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        kayit_id: &str,
        kayit: Option<&AjandaKaydi>,
        simdi: i64,
        zorla: bool,
        ufuk: Option<&Ufuk>,
    ) -> Result<(), CekirdekHatasi> {
        let satirlar = self.depo.kaydin_alarm_satirlari(kayit_id)?;
        let mut plan = plan_hesapla(kayit, &satirlar, simdi, &o.cevirici());
        plan.gelecek.retain(|t, _| ufuk_icinde(*t, kayit_id, ufuk));
        self.plani_uygula(e, kayit_id, kayit, &satirlar, &plan, simdi, zorla)
    }

    #[allow(clippy::too_many_arguments)]
    fn plani_uygula(
        &mut self,
        e: &mut Etkiler,
        kayit_id: &str,
        kayit: Option<&AjandaKaydi>,
        satirlar: &[KuruluAlarm],
        plan: &KayitPlani,
        simdi: i64,
        zorla: bool,
    ) -> Result<(), CekirdekHatasi> {
        if satirlar.is_empty() && plan.gelecek.is_empty() {
            return Ok(());
        }
        let etkin = kayit.filter(|k| k.hatirlatma_etkin_mi());
        let mut kurulacak: Vec<KuruluAlarm> = Vec::new();
        let mut iptal: Vec<i64> = Vec::new();
        let mut kacirilan: Vec<KuruluAlarm> = Vec::new();
        self.depo.alarm_islemi(|d| {
            for s in satirlar {
                if s.teslim_ms.is_some() {
                    // Android'de artık yok; yalnız çift teslimi önlüyordu.
                    if etkin.is_none() || s.tetik_ms <= simdi - KACIRILAN_PENCERE_MS {
                        d.alarm_sil(s.alarm_no)?;
                    }
                } else if plan.gelecek.contains_key(&s.tetik_ms) {
                    if zorla {
                        kurulacak.push(s.clone());
                    }
                } else if plan.kacirilan.contains_key(&s.tetik_ms) {
                    d.alarm_teslim_edildi(s.alarm_no, simdi)?;
                    iptal.push(s.alarm_no);
                    kacirilan.push(s.clone());
                } else {
                    d.alarm_sil(s.alarm_no)?;
                    iptal.push(s.alarm_no);
                }
            }
            for (tetik_ms, ornek_tarihi) in &plan.gelecek {
                if !satirlar.iter().any(|s| s.tetik_ms == *tetik_ms) {
                    kurulacak.push(d.alarm_kaydet(kayit_id, *tetik_ms, ornek_tarihi.as_deref())?);
                }
            }
            Ok(())
        })?;
        for no in iptal {
            iptal_yaz(e, no);
        }
        if let Some(k) = etkin {
            for s in kurulacak {
                kur_yaz(
                    e,
                    KurulacakAlarm {
                        alarm_no: s.alarm_no,
                        kayit_id: s.kayit_id,
                        tetik_ms: s.tetik_ms,
                        ornek_tarihi: s.ornek_tarihi,
                        tur: k.tur,
                    },
                );
            }
            kacirilan_yaz(e, kacirilan.iter().map(|s| bildirim(k, s)).collect());
        }
        Ok(())
    }
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::depo::Depo;
    use crate::hata::KabukHatasi;
    use crate::kopru::kabuklar::{AlarmKabugu, ZamanKabugu};
    use crate::kopru::sahte::{SahteAlarm, SahteKimlik, SahteZaman};
    use crate::kural::SabitOfsetCevirici;
    use crate::model::YerelAn;
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};

    /// 2026-11-25 14:30 UTC+3 = 11:30 UTC.
    const SIMDI: i64 = 1_795_606_200_000;
    const DK: i64 = 60_000;
    const SAAT: i64 = 60 * DK;
    const GUN: i64 = 24 * SAAT;
    /// Bugün (25 Kasım) yerel `HH:MM`'in anı (UTC+3).
    fn bugun(saat: i64, dk: i64) -> i64 {
        SIMDI - (14 * SAAT + 30 * DK) + saat * SAAT + dk * DK
    }

    struct Duzen {
        motor: Motor,
        kimlik: SahteKimlik,
        zaman: SahteZaman,
    }

    impl Duzen {
        fn yeni() -> Self {
            Duzen::yolla(":memory:")
        }
        fn yolla(yol: &str) -> Self {
            Duzen { motor: Motor::ac(yol).unwrap(), kimlik: SahteKimlik::default(), zaman: SahteZaman::yeni(SIMDI) }
        }
        fn saat(&self, ms: i64) {
            self.zaman.ayarla(ms);
        }
        fn yaz(&self, k: &AjandaKaydi) {
            self.motor.depo.gorunen_yaz(k, false).unwrap();
        }
        fn senkron(&mut self, kayitlar: &[&str]) -> Etkiler {
            let mut e = Etkiler::default();
            let o = Ortam { kimlik: &self.kimlik, zaman: &self.zaman };
            let k: Vec<String> = kayitlar.iter().map(|s| s.to_string()).collect();
            self.motor.alarm_senkronu(&o, &mut e, &k).unwrap();
            e
        }
        fn yeniden(&mut self, neden: YenidenKurmaNedeni) -> Etkiler {
            let mut e = Etkiler::default();
            let o = Ortam { kimlik: &self.kimlik, zaman: &self.zaman };
            self.motor.alarmlari_yeniden_kur(&o, &mut e, neden).unwrap();
            e
        }
        fn caldi(&mut self, no: i64) -> (Option<HatirlatmaBildirimi>, Etkiler) {
            let mut e = Etkiler::default();
            let o = Ortam { kimlik: &self.kimlik, zaman: &self.zaman };
            let b = self.motor.alarm_caldi(&o, &mut e, no).unwrap();
            (b, e)
        }
        fn kurulu(&self) -> Vec<KuruluAlarm> {
            self.motor.depo.tum_kurulu_alarmlar().unwrap()
        }
    }

    fn kayit(id: &str, ek: Value) -> AjandaKaydi {
        let mut v = json!({
            "kayit_id": id, "revizyon": 1, "tur": "randevu", "baslik": "Dişçi", "ornekler": [],
            "durum": "acik", "taslak": false, "silindi": false, "elle_alanlar": [],
            "kaynak": {"yol": "sohbet_araci", "tur_kokeni": "insan", "sohbet_id": "ana"},
            "olusturma_ms": 1_795_000_000_000i64, "guncelleme_ms": 1_795_000_000_000i64,
            "hatirlatmalar": [{"tur": "once", "dk": 60}]
        });
        for (k, d) in ek.as_object().unwrap() {
            v[k] = d.clone();
        }
        AjandaKaydi::oku(&v, "").unwrap_or_else(|h| panic!("{} {}", h.yol, h.neden))
    }

    fn an(tarih: &str, saat: &str) -> Value {
        json!({"kesinlik": "an", "tarih": tarih, "saat": saat, "saat_dilimi": "Europe/Istanbul"})
    }

    fn tetikler(e: &Etkiler) -> Vec<i64> {
        e.alarm_kur.iter().map(|a| a.tetik_ms).collect()
    }
    fn kacirilan_tetikleri(e: &Etkiler) -> Vec<i64> {
        e.kacirilan.as_ref().map(|k| k.satirlar.iter().map(|s| s.tetik_ms).collect()).unwrap_or_default()
    }

    #[test]
    fn degisiklik_farki_kurar_iptal_eder_ayni_plani_iki_kez_kurmaz() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "18:00"),
            "hatirlatmalar": [{"tur": "once", "dk": 60}, {"tur": "once", "dk": 15}]})));
        let e = d.senkron(&["k_a"]);
        assert_eq!(tetikler(&e), vec![bugun(17, 0), bugun(17, 45)]);
        assert!(e.alarm_iptal.is_empty() && e.kacirilan.is_none());
        assert!(e.alarm_kur.iter().all(|a| a.kayit_id == "k_a" && a.tur == crate::model::KayitTuru::Randevu));
        let ilk: Vec<i64> = e.alarm_kur.iter().map(|a| a.alarm_no).collect();

        // Aynı plan: hiçbir şey (ne kayıt değişikliğinde ne tam eşitlemenin sonunda).
        let e = d.senkron(&["k_a"]);
        assert!(e.alarm_kur.is_empty() && e.alarm_iptal.is_empty());
        let e = d.senkron(&[]);
        assert!(e.alarm_kur.is_empty() && e.alarm_iptal.is_empty());

        // Saat 18:00 -> 19:00 ve 15 dk önceki kaldırıldı: iki eski iptal, bir yeni kur.
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "19:00"), "hatirlatmalar": [{"tur": "once", "dk": 60}]})));
        let e = d.senkron(&["k_a", "k_a"]);
        assert_eq!(e.alarm_iptal, ilk);
        assert_eq!(tetikler(&e), vec![bugun(18, 0)]);
        assert!(!ilk.contains(&e.alarm_kur[0].alarm_no), "silinen numara yeniden kullanılmaz");
        assert_eq!(d.kurulu().len(), 1);

        // Yalnız 15 dk önceki eklendi: var olan dokunulmaz, yalnız yeni kurulur.
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "19:00"),
            "hatirlatmalar": [{"tur": "once", "dk": 60}, {"tur": "once", "dk": 15}]})));
        let e = d.senkron(&["k_a"]);
        assert!(e.alarm_iptal.is_empty());
        assert_eq!(tetikler(&e), vec![bugun(18, 45)]);
    }

    #[test]
    fn ayni_tetikli_iki_hatirlatma_tek_alarm() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "18:00"), "hatirlatmalar": [
            {"tur": "once", "dk": 60},
            {"tur": "mutlak", "tarih": "2026-11-25", "saat": "17:00", "saat_dilimi": "Europe/Istanbul"}]})));
        let e = d.senkron(&["k_a"]);
        assert_eq!(tetikler(&e), vec![bugun(17, 0)]);
        assert_eq!(d.kurulu().len(), 1);
    }

    #[test]
    fn taslak_silinmis_tamamlanmis_ve_dusen_kaydin_alarmi_iptal_edilir() {
        for degisim in ["taslak", "silindi", "tamam", "iptal", "gorunenden_dustu"] {
            let mut d = Duzen::yeni();
            let zaman = an("2026-11-25", "18:00");
            d.yaz(&kayit("k_a", json!({"zaman": zaman})));
            let no = d.senkron(&["k_a"]).alarm_kur[0].alarm_no;
            match degisim {
                "taslak" => d.yaz(&kayit("k_a", json!({"zaman": zaman, "taslak": true}))),
                "silindi" => d.yaz(&kayit("k_a", json!({"zaman": zaman, "silindi": true}))),
                "tamam" | "iptal" => d.yaz(&kayit("k_a", json!({"zaman": zaman, "durum": degisim}))),
                _ => d.motor.depo.gorunen_sil("k_a").unwrap(),
            }
            let e = d.senkron(&["k_a"]);
            assert_eq!(e.alarm_iptal, vec![no], "{degisim}");
            assert!(e.alarm_kur.is_empty() && e.kacirilan.is_none(), "{degisim}");
            assert!(d.motor.depo.alarmli_kayitlar().unwrap().is_empty(), "{degisim}");
            // Çalsa da susar.
            assert_eq!(d.caldi(no).0, None, "{degisim}");
        }
        // Taslak hiç kurulmaz; onaylanınca kurulur.
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_t", json!({"zaman": an("2026-11-25", "18:00"), "taslak": true})));
        assert!(d.senkron(&["k_t"]).alarm_kur.is_empty());
        d.yaz(&kayit("k_t", json!({"zaman": an("2026-11-25", "18:00")})));
        assert_eq!(tetikler(&d.senkron(&["k_t"])), vec![bugun(17, 0)]);
    }

    #[test]
    fn tam_esitleme_ve_acilis_gecmis_hatirlatmalari_caldirmaz() {
        let mut d = Duzen::yeni();
        // Tam eşitlemede gelen, tetiği geçmiş açık kayıtlar (hiç kurulmamış): ne kur ne kaçırılan.
        d.yaz(&kayit("k_dun", json!({"zaman": an("2026-11-24", "15:00")})));
        d.yaz(&kayit("k_bugun", json!({"zaman": an("2026-11-25", "15:00")}))); // 14:00 tetiği 30 dk önce
        d.yaz(&kayit("k_mutlak", json!({"hatirlatmalar": [
            {"tur": "mutlak", "tarih": "2026-11-25", "saat": "14:29", "saat_dilimi": "Europe/Istanbul"}]})));
        let e = d.senkron(&[]);
        assert!(e.alarm_kur.is_empty() && e.alarm_iptal.is_empty() && e.kacirilan.is_none());
        for neden in [YenidenKurmaNedeni::Acilis, YenidenKurmaNedeni::UygulamaAcildi, YenidenKurmaNedeni::SaatDegisti] {
            let e = d.yeniden(neden);
            assert!(e.alarm_kur.is_empty() && e.kacirilan.is_none(), "{neden:?}");
        }
        assert!(d.kurulu().is_empty());
    }

    #[test]
    fn kurulmus_teslim_edilmemis_yakin_gecmis_tam_bir_kez_kacirilan() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")}))); // 15:00
        d.yaz(&kayit("k_b", json!({"zaman": an("2026-11-25", "17:00")}))); // 16:00
        d.yaz(&kayit("k_c", json!({"zaman": an("2026-11-26", "10:00")}))); // yarın 09:00
        let e = d.senkron(&[]);
        assert_eq!(e.alarm_kur.len(), 3);
        let c_no = e.alarm_kur.iter().find(|a| a.kayit_id == "k_c").unwrap().alarm_no;

        // Telefon 14:40'ta kapandı, 16:30'da açıldı: iki tetik geçti, hiçbiri çalmadı.
        d.saat(bugun(16, 30));
        let e = d.yeniden(YenidenKurmaNedeni::Acilis);
        let k = e.kacirilan.as_ref().unwrap();
        assert_eq!(k.satirlar.iter().map(|s| s.kayit_id.as_str()).collect::<Vec<_>>(), vec!["k_a", "k_b"]);
        assert_eq!(kacirilan_tetikleri(&e), vec![bugun(15, 0), bugun(16, 0)]);
        assert_eq!(k.satirlar[0].baslik, "Dişçi");
        // Gelecekteki aynı numarayla yeniden kurulur (açılış AlarmManager'ı boşaltır); kaçırılanlar iptal.
        assert_eq!(e.alarm_kur.iter().map(|a| a.alarm_no).collect::<Vec<_>>(), vec![c_no]);
        assert_eq!(e.alarm_iptal.len(), 2);

        // İkinci kez gösterilmez: ne yeniden kurulumda ne senkronda ne geç gelen alarmda.
        assert!(d.yeniden(YenidenKurmaNedeni::UygulamaAcildi).kacirilan.is_none());
        assert!(d.senkron(&[]).kacirilan.is_none());
        let a_no = k.satirlar[0].alarm_no;
        assert_eq!(d.caldi(a_no).0, None);
        assert_eq!(d.kurulu().len(), 1);
    }

    #[test]
    fn kayit_degisikliginde_de_kacirilan_gosterilir_ve_kurulmamis_gosterilmez() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")})));
        d.senkron(&["k_a"]);
        d.saat(bugun(15, 10));
        // Başlık değişti; 15:00 tetiği kurulu ve teslim edilmemişti.
        let mut k = kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")}));
        k.baslik = "Dişçi (Ayşe)".into();
        d.yaz(&k);
        let e = d.senkron(&["k_a"]);
        assert_eq!(kacirilan_tetikleri(&e), vec![bugun(15, 0)]);
        assert_eq!(e.kacirilan.unwrap().satirlar[0].baslik, "Dişçi (Ayşe)");

        // Hiç kurulmamış: 15:10'da eklenen bugün 15:30 (14:30 varsayılanı geçmiş) çalmaz, kaçırılan da değil.
        d.yaz(&kayit("k_b", json!({"zaman": an("2026-11-25", "15:30")})));
        let e = d.senkron(&["k_b"]);
        assert!(e.alarm_kur.is_empty() && e.kacirilan.is_none());
        assert!(d.yeniden(YenidenKurmaNedeni::Acilis).kacirilan.is_none());
    }

    #[test]
    fn pencereden_eski_kurulu_alarm_sessizce_duser() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")}))); // 15:00
        let no = d.senkron(&[]).alarm_kur[0].alarm_no;
        // Tam 6 saat sonra: pencerenin dışı.
        d.saat(bugun(21, 0));
        let e = d.yeniden(YenidenKurmaNedeni::Acilis);
        assert!(e.kacirilan.is_none() && e.alarm_kur.is_empty());
        assert_eq!(e.alarm_iptal, vec![no]);
        assert!(d.motor.depo.alarmli_kayitlar().unwrap().is_empty());
        assert_eq!(d.caldi(no).0, None);
    }

    #[test]
    fn alarm_caldi_bildirir_bir_kez_ve_tekrarda_siradakini_kurar() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_g", json!({"tur": "gorev", "zaman": an("2026-11-25", "16:00"),
            "tekrar": {"siklik": "gunluk", "aralik": 1}, "ornekler": [{"tarih": "2026-11-26", "durum": "iptal"}]})));
        let e = d.senkron(&["k_g"]);
        assert_eq!(tetikler(&e), vec![bugun(15, 0)]);
        assert_eq!(e.alarm_kur[0].ornek_tarihi.as_deref(), Some("2026-11-25"));
        let no = e.alarm_kur[0].alarm_no;

        d.saat(bugun(15, 0) + 2_000);
        let (b, e) = d.caldi(no);
        let b = b.unwrap();
        assert_eq!((b.alarm_no, b.kayit_id.as_str(), b.tetik_ms), (no, "k_g", bugun(15, 0)));
        assert_eq!(b.ornek_tarihi.as_deref(), Some("2026-11-25"));
        assert_eq!(b.tur, crate::model::KayitTuru::Gorev);
        // 26'sı kapalı: sıradaki 27'si.
        assert_eq!(tetikler(&e), vec![bugun(15, 0) + 2 * GUN]);
        assert_eq!(e.alarm_kur[0].ornek_tarihi.as_deref(), Some("2026-11-27"));
        assert!(e.alarm_iptal.is_empty() && e.kacirilan.is_none());

        // Aynı alarm ikinci kez (Android'in yinelediği yayın): susar, başka bir şey olmaz.
        let (b, e) = d.caldi(no);
        assert!(b.is_none() && e.alarm_kur.is_empty() && e.alarm_iptal.is_empty());
        // Çalan teslim edildi: yeniden kurulum kaçırılan saymaz, geri kurmaz.
        let e = d.yeniden(YenidenKurmaNedeni::UygulamaAcildi);
        assert!(e.kacirilan.is_none());
        assert_eq!(tetikler(&e), vec![bugun(15, 0) + 2 * GUN]);
        // Bilinmeyen numara.
        assert_eq!(d.caldi(9_999).0, None);
    }

    #[test]
    fn erken_calan_alarm_ayni_ornegi_yeniden_kurmaz_siradakine_gecer() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_g", json!({"zaman": an("2026-11-25", "16:00"), "tekrar": {"siklik": "gunluk", "aralik": 1}})));
        let no = d.senkron(&["k_g"]).alarm_kur[0].alarm_no;
        d.saat(bugun(15, 0) - 3_000);
        let (b, e) = d.caldi(no);
        assert!(b.is_some());
        assert_eq!(tetikler(&e), vec![bugun(15, 0) + GUN]);
        assert!(e.alarm_iptal.is_empty());
    }

    #[test]
    fn kayit_arada_degistiyse_calan_alarm_susar_yenisi_kurulur() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")})));
        let no = d.senkron(&["k_a"]).alarm_kur[0].alarm_no;
        // R4 senkronu çağırmadan önce alarm geldi (yarış): kayıt 17:00'ye taşınmış.
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "17:00")})));
        d.saat(bugun(15, 0));
        let (b, e) = d.caldi(no);
        assert!(b.is_none());
        assert_eq!(e.alarm_iptal, vec![no]);
        assert_eq!(tetikler(&e), vec![bugun(16, 0)]);
        assert!(e.kacirilan.is_none());
    }

    #[test]
    fn saat_geri_alininca_teslim_edilen_ikinci_kez_kurulmaz() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")})));
        let no = d.senkron(&["k_a"]).alarm_kur[0].alarm_no;
        d.saat(bugun(15, 0));
        assert!(d.caldi(no).0.is_some());
        d.saat(bugun(14, 0));
        let e = d.yeniden(YenidenKurmaNedeni::SaatDegisti);
        assert!(e.alarm_kur.is_empty() && e.kacirilan.is_none());
        // Pencere geçince teslim satırı da temizlenir.
        d.saat(bugun(21, 1));
        d.yeniden(YenidenKurmaNedeni::Periyodik);
        assert!(d.motor.depo.alarmli_kayitlar().unwrap().is_empty());
    }

    #[test]
    fn saat_ileri_atlayinca_aradakiler_tek_ozet() {
        let mut d = Duzen::yeni();
        for (id, saat) in [("k_1", "15:10"), ("k_2", "15:20"), ("k_3", "15:30"), ("k_4", "23:00")] {
            d.yaz(&kayit(id, json!({"zaman": an("2026-11-25", saat), "hatirlatmalar": [{"tur": "once", "dk": 0}]})));
        }
        assert_eq!(d.senkron(&[]).alarm_kur.len(), 4);
        d.saat(bugun(16, 0));
        let e = d.yeniden(YenidenKurmaNedeni::SaatDegisti);
        assert_eq!(kacirilan_tetikleri(&e), vec![bugun(15, 10), bugun(15, 20), bugun(15, 30)]);
        assert_eq!(tetikler(&e), vec![bugun(23, 0)]);
    }

    /// Dilim kuralı değişebilen saat (tz verisi güncellendi ya da kullanıcı dilimi değişti).
    struct DegisenZaman {
        simdi: i64,
        cevirici: Mutex<SabitOfsetCevirici>,
    }
    impl DegisenZaman {
        fn ofset(&self, dk: i64) {
            *self.cevirici.lock().unwrap() = SabitOfsetCevirici::yeni([("UTC", 0), ("Europe/Istanbul", dk)]);
        }
    }
    impl ZamanKabugu for DegisenZaman {
        fn simdi_ms(&self) -> i64 {
            self.simdi
        }
        fn cihaz_dilimi(&self) -> String {
            "Europe/Istanbul".into()
        }
        fn yerelden_ana(&self, tarih: String, saat: String, saat_dilimi: String) -> Result<i64, KabukHatasi> {
            self.cevirici.lock().unwrap().ana_cevir(&tarih, &saat, &saat_dilimi).map_err(|e| KabukHatasi::Basarisiz { mesaj: e.mesaj })
        }
        fn andan_yerele(&self, an_ms: i64, saat_dilimi: String) -> Result<YerelAn, KabukHatasi> {
            self.cevirici.lock().unwrap().yerele_cevir(an_ms, &saat_dilimi).map_err(|e| KabukHatasi::Basarisiz { mesaj: e.mesaj })
        }
    }

    fn sirali(e: &Etkiler) -> Vec<i64> {
        let mut t = tetikler(e);
        t.sort();
        t
    }

    #[test]
    fn dilim_kurali_degisince_tetik_tasinir_gecmise_dusen_yagmur_olmaz() {
        let mut motor = Motor::ac(":memory:").unwrap();
        let kimlik = SahteKimlik::default();
        let zaman = DegisenZaman { simdi: SIMDI, cevirici: Mutex::new(SabitOfsetCevirici::default()) };
        zaman.ofset(180);
        motor.depo.gorunen_yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "18:00")})), false).unwrap();
        motor.depo.gorunen_yaz(&kayit("k_b", json!({"zaman": an("2026-11-25", "15:45")})), false).unwrap(); // 14:45
        let o = Ortam { kimlik: &kimlik, zaman: &zaman };
        let mut e = Etkiler::default();
        motor.alarm_senkronu(&o, &mut e, &[]).unwrap();
        let eski: Vec<i64> = e.alarm_kur.iter().map(|a| a.alarm_no).collect();
        assert_eq!(sirali(&e), vec![bugun(14, 45), bugun(17, 0)]);

        // Ofset +3 -> +2: yerel 17:00 bir saat sonraya, 14:45 de 15:45 UTC+3'e (gelecek) kayar.
        zaman.ofset(120);
        let mut e = Etkiler::default();
        motor.alarmlari_yeniden_kur(&o, &mut e, YenidenKurmaNedeni::DilimDegisti).unwrap();
        assert_eq!(e.alarm_iptal, eski);
        assert_eq!(sirali(&e), vec![bugun(15, 45), bugun(18, 0)]);
        assert!(e.kacirilan.is_none());

        // Ofset +2 -> +4: 15:45 tetiği 13:45'e (geçmiş) kayar; kurulu tetik artık kayıtta yok: düşer, çalmaz.
        zaman.ofset(240);
        let mut e = Etkiler::default();
        motor.alarmlari_yeniden_kur(&o, &mut e, YenidenKurmaNedeni::DilimDegisti).unwrap();
        assert!(e.kacirilan.is_none());
        assert_eq!(e.alarm_iptal.len(), 2);
        assert_eq!(e.alarm_kur.iter().map(|a| a.tetik_ms).collect::<Vec<_>>(), vec![bugun(16, 0)]);
    }

    #[test]
    fn bilinmeyen_dilimli_hatirlatma_yutulur_otekiler_kurulur() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "18:00"), "hatirlatmalar": [
            {"tur": "mutlak", "tarih": "2026-11-25", "saat": "20:00", "saat_dilimi": "Asia/Tokyo"},
            {"tur": "once", "dk": 30}]})));
        d.yaz(&kayit("k_b", json!({"zaman": {"kesinlik": "an", "tarih": "2026-11-25", "saat": "18:00", "saat_dilimi": "America/Lima"}})));
        d.yaz(&kayit("k_c", json!({"zaman": an("2026-11-25", "19:00")})));
        let e = d.senkron(&[]);
        assert_eq!(tetikler(&e), vec![bugun(17, 30), bugun(18, 0)]);
        assert!(d.yeniden(YenidenKurmaNedeni::Acilis).kacirilan.is_none());
    }

    #[test]
    fn ayni_etkilerde_kurulup_iptal_edilen_alarm_kurulmaz() {
        let mut d = Duzen::yeni();
        let o = Ortam { kimlik: &d.kimlik, zaman: &d.zaman };
        let mut e = Etkiler::default();
        d.motor.depo.gorunen_yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "18:00")})), false).unwrap();
        d.motor.alarm_senkronu(&o, &mut e, &["k_a".into()]).unwrap();
        let no = e.alarm_kur[0].alarm_no;
        // R4 aynı çağrıda kaydı sildi ve yeniden senkronladı.
        d.motor.depo.gorunen_yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "18:00"), "silindi": true})), false).unwrap();
        d.motor.alarm_senkronu(&o, &mut e, &["k_a".into()]).unwrap();
        assert!(e.alarm_kur.is_empty());
        assert_eq!(e.alarm_iptal, vec![no]);
        // Kaçırılanlar aynı çağrıda birleşir (tek özet).
        let mut e = Etkiler::default();
        for id in ["k_x", "k_y"] {
            d.motor.depo.gorunen_yaz(&kayit(id, json!({"zaman": an("2026-11-25", "16:00")})), false).unwrap();
        }
        d.motor.alarm_senkronu(&o, &mut e, &["k_x".into()]).unwrap();
        d.motor.alarm_senkronu(&o, &mut e, &["k_y".into()]).unwrap();
        d.zaman.ayarla(bugun(15, 5));
        let mut e = Etkiler::default();
        d.motor.alarm_senkronu(&o, &mut e, &["k_x".into()]).unwrap();
        d.motor.alarm_senkronu(&o, &mut e, &["k_y".into(), "k_x".into()]).unwrap();
        assert_eq!(e.kacirilan.unwrap().satirlar.len(), 2);
    }

    #[test]
    fn kurulamayan_alarm_kurulu_sayilmaz_sonra_yeniden_denenir() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")})));
        let no = d.senkron(&["k_a"]).alarm_kur[0].alarm_no;
        d.motor.alarm_kurulamadi(no, "izin yok").unwrap();
        assert!(d.kurulu().is_empty());
        // Kurulamadığı için tetik geçince kaçırılan da sayılmaz; tetikten önce yeniden denenir.
        let e = d.yeniden(YenidenKurmaNedeni::UygulamaAcildi);
        assert_eq!(tetikler(&e), vec![bugun(15, 0)]);
        let yeni = e.alarm_kur[0].alarm_no;
        assert_ne!(yeni, no);
        d.motor.alarm_kurulamadi(yeni, "izin yok").unwrap();
        d.saat(bugun(15, 30));
        assert!(d.yeniden(YenidenKurmaNedeni::UygulamaAcildi).kacirilan.is_none());
        // Teslim edilmiş satır kurulamadı sayılmaz (geç gelen hata).
        d.yaz(&kayit("k_b", json!({"zaman": an("2026-11-25", "17:00")})));
        let no_b = d.senkron(&["k_b"]).alarm_kur[0].alarm_no;
        d.saat(bugun(16, 0));
        assert!(d.caldi(no_b).0.is_some());
        d.motor.alarm_kurulamadi(no_b, "geç").unwrap();
        assert!(d.motor.depo.alarm_no_ile(no_b).unwrap().unwrap().teslim_ms.is_some());
    }

    #[test]
    fn eslesme_kalkinca_hepsi_iptal() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")})));
        d.yaz(&kayit("k_b", json!({"zaman": an("2026-11-25", "18:00")})));
        let nolar: Vec<i64> = d.senkron(&[]).alarm_kur.iter().map(|a| a.alarm_no).collect();
        let mut e = Etkiler::default();
        d.motor.tum_alarmlari_kaldir(&mut e).unwrap();
        assert_eq!(e.alarm_iptal, nolar);
        assert!(d.motor.depo.alarmli_kayitlar().unwrap().is_empty());
    }

    /// `i` arttıkça tetiği sonraki: 26 Kasım'dan başlayarak günde 100 kayıt, 08:00'den 5'er dakika.
    fn butce_kaydi(i: usize) -> AjandaKaydi {
        let tarih = format!("2026-11-{:02}", 26 + i / 100);
        let saat = format!("{:02}:{:02}", 8 + (i % 100) / 10, (i % 10) * 5);
        kayit(&format!("k_{i:03}"), json!({"zaman": an(&tarih, &saat), "hatirlatmalar": [{"tur": "once", "dk": 0}]}))
    }

    fn kurulu_kayitlar(d: &Duzen) -> BTreeSet<String> {
        d.kurulu().into_iter().map(|a| a.kayit_id).collect()
    }

    fn kurulu_no(d: &Duzen, kayit_id: &str) -> i64 {
        d.kurulu().into_iter().find(|a| a.kayit_id == kayit_id).unwrap().alarm_no
    }

    /// Android'in 500 alarm sınırı: bütçeyi aşan planda en yakınlar kurulur, uzaktakiler yer açıldıkça.
    #[test]
    fn alarm_butcesi_en_yakinlari_kurar_uzaktakiler_yer_acildikca_kurulur() {
        let mut d = Duzen::yeni();
        let n = ALARM_BUTCESI + 10;
        for i in 0..n {
            d.yaz(&butce_kaydi(i));
        }
        let ilk: BTreeSet<String> = (0..ALARM_BUTCESI).map(|i| format!("k_{i:03}")).collect();
        let e = d.senkron(&[]);
        assert_eq!(e.alarm_kur.len(), ALARM_BUTCESI);
        assert_eq!(kurulu_kayitlar(&d), ilk, "en yakın bütçe kadarı");

        // Yeniden kurulum bütçeyi aşmaz, aynı kümeyi aynı numaralarla kurar.
        let e = d.yeniden(YenidenKurmaNedeni::Acilis);
        assert_eq!(e.alarm_kur.len(), ALARM_BUTCESI);
        assert!(e.alarm_iptal.is_empty());

        // Bugüne yeni kayıt: kurulur; en uzak kurulan (k_399) iptal edilir. Bütçe aşılmaz.
        let son = kurulu_no(&d, "k_399");
        d.yaz(&kayit("k_yakin", json!({"zaman": an("2026-11-25", "18:00"), "hatirlatmalar": [{"tur": "once", "dk": 0}]})));
        let e = d.senkron(&["k_yakin"]);
        assert_eq!(e.alarm_kur.iter().map(|a| a.kayit_id.as_str()).collect::<Vec<_>>(), vec!["k_yakin"]);
        assert_eq!(e.alarm_iptal, vec![son]);
        assert_eq!(d.kurulu().len(), ALARM_BUTCESI);

        // Ufkun ötesine yeni kayıt: kurulmaz, hiçbir şey değişmez.
        d.yaz(&kayit("k_uzak", json!({"zaman": an("2026-12-20", "10:00"), "hatirlatmalar": [{"tur": "once", "dk": 0}]})));
        let e = d.senkron(&["k_uzak"]);
        assert!(e.alarm_kur.is_empty() && e.alarm_iptal.is_empty());

        // Alarm çalınca yer açılır: ertelenenlerin en yakını (k_399) kurulur.
        let yakin = kurulu_no(&d, "k_yakin");
        d.saat(bugun(18, 0));
        let (b, e) = d.caldi(yakin);
        assert!(b.is_some());
        assert_eq!(e.alarm_kur.iter().map(|a| a.kayit_id.as_str()).collect::<Vec<_>>(), vec!["k_399"]);
        assert_eq!(d.kurulu().len(), ALARM_BUTCESI);

        // Kayıt silinince (görünen kopyadan düştü) yer açılır: sıradaki (k_400) kurulur.
        let ilk_no = kurulu_no(&d, "k_000");
        d.motor.depo.gorunen_sil("k_000").unwrap();
        let e = d.senkron(&["k_000"]);
        assert_eq!(e.alarm_iptal, vec![ilk_no]);
        assert_eq!(e.alarm_kur.iter().map(|a| a.kayit_id.as_str()).collect::<Vec<_>>(), vec!["k_400"]);
        assert_eq!(d.kurulu().len(), ALARM_BUTCESI);

        // Plan bütçeye sığınca ufuk kalkar: hepsi kurulur.
        for i in 1..60 {
            d.motor.depo.gorunen_sil(&format!("k_{i:03}")).unwrap();
        }
        d.senkron(&[]);
        assert_eq!(d.kurulu().len(), n + 1 - 60, "k_001..k_059 ve k_000 düştü, k_yakin teslim edildi, k_uzak eklendi");
        assert!(kurulu_kayitlar(&d).contains("k_uzak"));
        assert_eq!(d.motor.depo.meta_oku(anahtar::ALARM_UFKU).unwrap(), None);
    }

    fn gecici_yol(ad: &str) -> String {
        let yol = std::env::temp_dir().join(format!(
            "ajanda-alarm-{ad}-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        yol.to_str().unwrap().to_string()
    }
    fn gecici_sil(yol: &str) {
        for ek in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{yol}{ek}"));
        }
    }

    #[test]
    fn surec_olup_yeniden_acilinca_kayitlar_tutarli() {
        let yol = gecici_yol("surec");
        let (a_no, c_no) = {
            let mut d = Duzen::yolla(&yol);
            d.yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")}))); // 15:00
            d.yaz(&kayit("k_c", json!({"zaman": an("2026-11-26", "10:00")}))); // yarın 09:00
            let e = d.senkron(&[]);
            (e.alarm_kur[0].alarm_no, e.alarm_kur[1].alarm_no)
            // Süreç burada ölür (bağlantı kapanır).
        };
        {
            let mut d = Duzen::yolla(&yol);
            // Yeniden başlatma: aynı numaralar yeniden kurulur, yeni satır açılmaz.
            let e = d.yeniden(YenidenKurmaNedeni::Acilis);
            assert_eq!(e.alarm_kur.iter().map(|a| a.alarm_no).collect::<Vec<_>>(), vec![a_no, c_no]);
            assert!(e.kacirilan.is_none() && e.alarm_iptal.is_empty());
            assert_eq!(d.kurulu().len(), 2);
            // Alarm 15:00'te çalacakken süreç öldü; 15:20'de yeniden açılış: bir kez kaçırılan.
            d.saat(bugun(15, 20));
            let e = d.yeniden(YenidenKurmaNedeni::Acilis);
            assert_eq!(kacirilan_tetikleri(&e), vec![bugun(15, 0)]);
        }
        {
            let mut d = Duzen::yolla(&yol);
            d.saat(bugun(15, 25));
            let e = d.yeniden(YenidenKurmaNedeni::Acilis);
            assert!(e.kacirilan.is_none(), "teslim işareti kalıcı");
            assert_eq!(e.alarm_kur.iter().map(|a| a.alarm_no).collect::<Vec<_>>(), vec![c_no]);
            assert_eq!(d.caldi(a_no).0, None);
        }
        gecici_sil(&yol);
    }

    /// `kur` her zaman başarısız olan kabuk (izin geri alındı).
    #[derive(Default)]
    struct KurmayanAlarm {
        denenen: Mutex<Vec<i64>>,
    }
    impl AlarmKabugu for KurmayanAlarm {
        fn kur(&self, alarm: KurulacakAlarm) -> Result<(), KabukHatasi> {
            self.denenen.lock().unwrap().push(alarm.alarm_no);
            Err(KabukHatasi::Basarisiz { mesaj: "SCHEDULE_EXACT_ALARM yok".into() })
        }
        fn iptal(&self, _: i64) -> Result<(), KabukHatasi> {
            Ok(())
        }
        fn kacirilanlari_goster(&self, _: KacirilanBildirimi) -> Result<(), KabukHatasi> {
            Ok(())
        }
    }

    /// Köprü üzerinden (Kotlin'in göreceği yol): görünen kopyayı ayrı bir bağlantı yazar (R4 yerine).
    #[test]
    fn cekirdek_uzerinden_yeniden_kur_caldi_ve_kurulamadi() {
        use crate::kopru::Cekirdek;
        let yol = gecici_yol("cekirdek");
        let zaman = Arc::new(SahteZaman::yeni(SIMDI));
        let alarm = Arc::new(SahteAlarm::default());
        let c = Cekirdek::ac(yol.clone(), Arc::new(SahteKimlik::default()), zaman.clone(), alarm.clone()).unwrap();
        let yazici = Depo::ac(&yol).unwrap();
        yazici.gorunen_yaz(&kayit("k_a", json!({"zaman": an("2026-11-25", "16:00")})), false).unwrap();
        yazici.gorunen_yaz(&kayit("k_b", json!({"zaman": an("2026-11-25", "18:00")})), false).unwrap();

        c.alarmlari_yeniden_kur(YenidenKurmaNedeni::UygulamaAcildi).unwrap();
        let kurulan = alarm.kurulan.lock().unwrap().clone();
        assert_eq!(kurulan.iter().map(|a| a.tetik_ms).collect::<Vec<_>>(), vec![bugun(15, 0), bugun(17, 0)]);
        zaman.ayarla(bugun(15, 0));
        let b = c.alarm_caldi(kurulan[0].alarm_no).unwrap().unwrap();
        assert_eq!(b.kayit_id, "k_a");
        assert_eq!(c.alarm_caldi(kurulan[0].alarm_no).unwrap(), None);
        zaman.ayarla(bugun(17, 30));
        c.alarmlari_yeniden_kur(YenidenKurmaNedeni::Acilis).unwrap();
        let kac = alarm.kacirilan.lock().unwrap().clone();
        assert_eq!(kac.len(), 1);
        assert_eq!(kac[0].satirlar.iter().map(|s| s.alarm_no).collect::<Vec<_>>(), vec![kurulan[1].alarm_no]);
        drop(c);

        // Kabuk kuramazsa köprü `alarm_kurulamadi` ile bildirir: satır kalmaz.
        let kurmayan = Arc::new(KurmayanAlarm::default());
        let c = Cekirdek::ac(yol.clone(), Arc::new(SahteKimlik::default()), Arc::new(SahteZaman::yeni(SIMDI)), kurmayan.clone()).unwrap();
        yazici.gorunen_yaz(&kayit("k_c", json!({"zaman": an("2026-11-25", "20:00")})), false).unwrap();
        c.alarmlari_yeniden_kur(YenidenKurmaNedeni::Acilis).unwrap();
        assert!(!kurmayan.denenen.lock().unwrap().is_empty());
        assert!(yazici.tum_kurulu_alarmlar().unwrap().is_empty());
        drop((c, yazici));
        gecici_sil(&yol);
    }

    fn gun(tarih: &str, bolum: Option<&str>) -> Value {
        let mut z = json!({"kesinlik": "gun", "tarih": tarih, "saat_dilimi": "Europe/Istanbul"});
        if let Some(b) = bolum {
            z["gun_bolumu"] = json!(b);
        }
        z
    }

    #[test]
    fn saatsiz_gun_kaydi_gun_hatirlatmasini_kurar_bolume_gore_ya_da_sabah() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_aksam", json!({"tur": "gorev", "zaman": gun("2026-11-26", Some("aksam"))})));
        d.yaz(&kayit("k_bolumsuz", json!({"tur": "gorev", "zaman": gun("2026-11-26", None)})));
        d.yaz(&kayit("k_gece", json!({"tur": "gorev", "zaman": gun("2026-11-26", Some("gece")),
            "hatirlatmalar": [{"tur": "once", "dk": 1440}, {"tur": "once", "dk": 60}, {"tur": "once", "dk": 5}]})));
        let e = d.senkron(&[]);
        let mut kurulan: Vec<(String, i64)> = e.alarm_kur.iter().map(|a| (a.kayit_id.clone(), a.tetik_ms)).collect();
        kurulan.sort();
        assert_eq!(
            kurulan,
            vec![
                ("k_aksam".into(), bugun(19, 0) + GUN),
                ("k_bolumsuz".into(), bugun(9, 0) + GUN),
                // "1 gün önce" önceki günün 20:00'ı; 60 ve 5 dk aynı günün 20:00'ına düşer (tek alarm).
                ("k_gece".into(), bugun(20, 0)),
                ("k_gece".into(), bugun(20, 0) + GUN),
            ]
        );
    }

    #[test]
    fn gun_degisince_alarm_tasinir_saat_gelince_ve_kalkinca_kural_degisir() {
        let mut d = Duzen::yeni();
        // Gerçek örnek: 28'i akşam -> 27'si akşam (bugün 25; tarihleri iki gün kaydırılmış biçimi).
        d.yaz(&kayit("k_a", json!({"tur": "gorev", "zaman": gun("2026-11-27", Some("aksam"))})));
        let e = d.senkron(&["k_a"]);
        assert_eq!(tetikler(&e), vec![bugun(19, 0) + 2 * GUN]);
        let ilk = e.alarm_kur[0].alarm_no;

        d.yaz(&kayit("k_a", json!({"tur": "gorev", "zaman": gun("2026-11-26", Some("aksam"))})));
        let e = d.senkron(&["k_a"]);
        assert_eq!(e.alarm_iptal, vec![ilk], "eski günün alarmı iptal");
        assert_eq!(tetikler(&e), vec![bugun(19, 0) + GUN]);
        let ikinci = e.alarm_kur[0].alarm_no;

        // Saat geldi (19:00): saatli kural, 1 saat önce.
        d.yaz(&kayit("k_a", json!({"tur": "gorev", "zaman": an("2026-11-26", "19:00")})));
        let e = d.senkron(&["k_a"]);
        assert_eq!(e.alarm_iptal, vec![ikinci]);
        assert_eq!(tetikler(&e), vec![bugun(18, 0) + GUN]);
        let ucuncu = e.alarm_kur[0].alarm_no;

        // Saat kalktı, bölüm yok: o günün 09:00'ı.
        d.yaz(&kayit("k_a", json!({"tur": "gorev", "zaman": gun("2026-11-26", None)})));
        let e = d.senkron(&["k_a"]);
        assert_eq!(e.alarm_iptal, vec![ucuncu]);
        assert_eq!(tetikler(&e), vec![bugun(9, 0) + GUN]);
        assert_eq!(d.kurulu().len(), 1);
    }

    #[test]
    fn gecmiste_kalan_gun_hatirlatmasi_calmaz_kapatilan_kurulmaz_donem_bekler() {
        let mut d = Duzen::yeni();
        // 14:30'da eklenen bölümsüz "bugün": 09:00 geçti, hiç kurulmaz, kaçırılan da değil.
        d.yaz(&kayit("k_bugun", json!({"tur": "gorev", "zaman": gun("2026-11-25", None)})));
        // Kullanıcı hatırlatmayı kapattı: hiç kurulmaz.
        d.yaz(&kayit("k_kapali", json!({"tur": "gorev", "zaman": gun("2026-11-26", Some("aksam")), "hatirlatmalar": []})));
        // Dönem: once bekler.
        d.yaz(&kayit("k_donem", json!({"tur": "gorev",
            "zaman": {"kesinlik": "donem", "baslangic": "2026-11-26", "bitis": "2026-11-28", "saat_dilimi": "Europe/Istanbul"}})));
        let e = d.senkron(&[]);
        assert!(e.alarm_kur.is_empty() && e.kacirilan.is_none());
        assert!(d.yeniden(YenidenKurmaNedeni::PaketGuncellendi).alarm_kur.is_empty());
        // Aynı gün akşama alınınca 19:00 gelecekte: kurulur.
        d.yaz(&kayit("k_bugun", json!({"tur": "gorev", "zaman": gun("2026-11-25", Some("aksam"))})));
        assert_eq!(tetikler(&d.senkron(&["k_bugun"])), vec![bugun(19, 0)]);
    }

    #[test]
    fn kurulu_gun_hatirlatmasi_telefon_kapaliyken_kacirilan_ve_bildirim_saat_uydurmaz() {
        let mut d = Duzen::yeni();
        d.yaz(&kayit("k_a", json!({"tur": "gorev", "baslik": "Araba yıkama", "zaman": gun("2026-11-25", Some("aksam"))})));
        let no = d.senkron(&["k_a"]).alarm_kur[0].alarm_no;
        d.saat(bugun(19, 30));
        let e = d.yeniden(YenidenKurmaNedeni::Acilis);
        let k = e.kacirilan.unwrap();
        assert_eq!((k.satirlar[0].alarm_no, k.satirlar[0].tetik_ms), (no, bugun(19, 0)));
        // Bildirim içeriği kaydın zamanını taşır (saatsiz, bölümlü): Kotlin "Bugün akşam" yazar.
        assert!(matches!(&k.satirlar[0].zaman, Some(crate::model::AjandaZamani::Gun { gun_bolumu: Some(crate::model::GunBolumu::Aksam), .. })));
    }

    #[test]
    fn onizleme_formun_soyleyecegini_verir() {
        use crate::model::{GunBolumu, KayitGovdesi, KayitTuru};
        let c = SabitOfsetCevirici::yeni([("Europe/Istanbul", 180)]);
        let govde = |zaman, hatirlatmalar| KayitGovdesi { tur: KayitTuru::Gorev, baslik: "x".into(), aciklama: None, zaman, hatirlatmalar, tekrar: None };
        let gunz = |t: &str, b| Some(crate::model::AjandaZamani::Gun { tarih: t.into(), gun_bolumu: b, saat_dilimi: "Europe/Istanbul".into(), ifade: None });
        let o = hatirlatma_onizlemesi(&govde(gunz("2026-11-27", Some(GunBolumu::Aksam)), crate::model::varsayilan_hatirlatmalar()), SIMDI, &c).unwrap();
        let g = o.gun_hatirlatmasi.unwrap();
        assert_eq!((g.tarih.as_str(), g.saat.as_str(), g.gecti, o.ilk_tetik_ms), ("2026-11-27", "19:00", false, Some(bugun(19, 0) + 2 * GUN)));
        let o = hatirlatma_onizlemesi(&govde(gunz("2026-11-25", None), crate::model::varsayilan_hatirlatmalar()), SIMDI, &c).unwrap();
        let g = o.gun_hatirlatmasi.unwrap();
        assert_eq!((g.saat.as_str(), g.gecti, o.kurulacak, o.gecmis, o.ilk_tetik_ms), ("09:00", true, 0, 1, None));
        let o = hatirlatma_onizlemesi(&govde(gunz("2026-11-27", None), vec![]), SIMDI, &c).unwrap();
        assert_eq!((o.kurulacak, o.gun_hatirlatmasi), (0, None));
        let o = hatirlatma_onizlemesi(&govde(None, crate::model::varsayilan_hatirlatmalar()), SIMDI, &c).unwrap();
        assert_eq!((o.saatsiz, o.gun_hatirlatmasi), (1, None));
    }
}
