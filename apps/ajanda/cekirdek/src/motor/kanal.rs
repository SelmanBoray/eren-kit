//! SAHİBİ: R4. `/ajanda` kanal durum makinesi (sans-IO). Akış `docs/AJANDA.md` "Kanal akışı":
//! eşleştirme bekliyorsa `pair_request` -> `pair_result` (aynı bağlantıda sürer); eşleşmişse `hello` ->
//! `auth_challenge` (PC imzasını `KimlikKabugu.dogrula`) -> `auth_response` (`KimlikKabugu.imzala`) ->
//! `welcome` -> telafi (`kayit`...`esitlendi`) -> canlı; `esitlendi`'den sonra kuyruk birer birer.
//! Kurallar: `kural::{esitleme, kuyruk, birlesim, ornek}`.
//!
//! Çerçeve kuralı: her gelen çerçeve `ajanda_asagi_coz`'dan geçer; geçersiz ya da aşamaya uymayan çerçeve
//! (`welcome`'dan önce `kayit` gibi) bağlantıyı kapatır (`Etkiler.kapat`, aşama `Kapaniyor`: Kotlin
//! `baglanti_kapandi` diyene dek gelenler yok sayılır). `error` çerçevesi `son_hata`'ya yazılır, bağlantı
//! kapatılır. Çerçeve işlenirken depo hatası olursa da kapatılır: yarım telafi bir sonraki bağlantıda
//! baştan yapılır.
//!
//! Sürüm uyuşmazlığı (v2, `docs/AJANDA.md` "Sürüm 2"): başka `v`'li çerçeve (çözücüde `protokol_uyumsuz`),
//! `error{protokol_uyumsuz}` ya da kapanış kodu 1002 `son_hata = protokol_uyumsuz` ve `surum_uyusmazligi`
//! yazar (karşı `v` küçükse `ServisEski`, büyükse `UygulamaEski`, okunamıyorsa `Bilinmiyor`). Hiçbir kayıt,
//! kuyruk ya da alarm değişmez; yeniden bağlanmayı geri çekmek kabuğun işidir.
//!
//! Telafi (`kural::esitleme` ile aynı anlam, SQLite'ta: `depo/kopya.rs`):
//! - `welcome{tam:false}`: `depo_id` yazılır; gelen `kayit`'ler sunucu kopyasına (yalnız büyük revizyon)
//!   ve görünen kopyaya `TELAFI_TAMPONU`'luk işlemlerle yazılır, `son_rev` her işlemde ilerler (kesilen
//!   artımlı telafi kaldığı yerden sürer; tampondaki yazılmamışlar `son_rev`'i de ilerletmemiştir).
//! - `welcome{tam:true}`: gelenler `telafi_kayitlari`'na toplanır; görünen kopya, alarmlar, `son_rev`,
//!   `depo_id` değişmez. `esitlendi`'de tek işlemde toplanan kopya sunucu kopyasının yerine geçer, görünen
//!   kopya yeniden hesaplanır (kuyruk taze kopya üstüne yeniden uygulanır), sonra bütün alarmlar
//!   (`alarm_senkronu(&[])`) ve `Degisim.tumu`. Kopmada toplanan atılır.
//! - Canlı `kayit` hemen (tek işlem) uygulanır.
//! - Yerel kipte (bağlanma sürüyor, `yerel.rs` "Geçişler"): `hello` boş kopya gibi gider, telafi hep tam
//!   sayılıp toplanır; `esitlendi`'de `yereli_kuyruga_dok` yerel kayıtları kuyruğa döker ve kip `bagli` olur.
//!
//! Kuyruk (`kural::kuyruk::ajanda_kuyruk_karari`): yalnız `Canli`'da, en çok bir işlem yolda. Yollanan satır
//! kalıcı olarak `yollandi` işaretlenir; sonucu gelmeden bağlantı biterse (ya da süreç ölürse: sonraki
//! açılışta) `Kopma` sayılır. Yollanmadan kopmak olay değildir. Geçici ret (`ic_hata`) aynı `islem_id` ile
//! hemen yeniden yollanır (sınır `ISLEM_DENEME`). Başarıda servis bir revizyon verdiyse ve o `kayit` henüz
//! gelmediyse satır "onaylandı" olur (iyimser hal görünmeye devam eder; sıra garanti değil). Bozuk satır
//! (JSON çözülmüyor) yollanmadan `gecersiz_islem` ile ret listesine geçer: arkasındakileri tıkamaz.

use std::collections::BTreeSet;

use super::eslesme::Eslesme;
use super::iyimser::{gorunen_yenile, islem_coz, istenen_govde};
use super::{Etkiler, Motor, Ortam, TELAFI_TAMPONU};
use crate::depo::{KopyaTablosu, KuyrukSatiri, RetSatiri, anahtar};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{BaglantiAsamasi, BaglantiDurumu, GecmisSatiri, GecmisSayfasi, SurumUyusmazligi};
use crate::kural::esitleme::HelloAlanlari;
use crate::model::sinirlar::AJANDA_SURUMU;
use crate::kural::kuyruk::{KuyrukKarari, KuyrukOlayi, ajanda_kuyruk_karari};
use crate::model::json::Yazici;
use crate::model::kanonik::{base64_coz, base64_yaz};
use crate::model::{
    AjandaAsagi, AjandaEslestirmeQr, AjandaGecmisGirdisi, AjandaKanalHatasi, AjandaKaydi,
    AjandaRetNedeni, AjandaYukari, ImzaRolu, KuyrukRetNedeni, ajanda_asagi_coz, ajanda_kimlik_imza_metni,
};

/// WebSocket kapanış kodu 1002 (protokol hatası): servis bunu yalnız `protokol_uyumsuz` ile kullanır.
const KAPANIS_PROTOKOL_HATASI: i32 = 1002;

/// Sürüm uyuşmazlığının yönü: çözülemeyen çerçevenin `v`'si bizimkinden küçükse servis eski, büyükse
/// uygulama eski; okunamıyorsa bilinmez.
fn surum_yonu(metin: &str) -> SurumUyusmazligi {
    let v = serde_json::from_str::<serde_json::Value>(metin).ok().and_then(|d| d.get("v")?.as_f64());
    match v {
        Some(v) if v < AJANDA_SURUMU as f64 => SurumUyusmazligi::ServisEski,
        Some(v) if v > AJANDA_SURUMU as f64 => SurumUyusmazligi::UygulamaEski,
        _ => SurumUyusmazligi::Bilinmiyor,
    }
}

/// Bağlantının bellek içi aşaması.
pub(crate) enum Asama {
    Kopuk,
    /// Motor kapattı (`Etkiler.kapat`); Kotlin `baglanti_kapandi` diyene dek gelen çerçeveler yok sayılır.
    Kapaniyor,
    /// `pair_request` yollandı.
    Eslestirme { qr: AjandaEslestirmeQr },
    /// `hello` yollandı, `auth_challenge` bekleniyor.
    Hello { eslesme: Eslesme, client_nonce: String },
    /// `auth_response` yollandı, `welcome` bekleniyor.
    Yanit,
    Telafi(Telafi),
    Canli,
}

pub(crate) struct Telafi {
    /// `Some((depo_id, son_rev))`: tam telafi sürüyor; toplanan kopyanın kimliği ve ulaştığı revizyon.
    tam: Option<(String, i64)>,
    /// Henüz yazılmamış `kayit` çerçeveleri (en çok `TELAFI_TAMPONU`).
    tampon: Vec<AjandaKaydi>,
}

impl Asama {
    fn disari(&self) -> BaglantiAsamasi {
        match self {
            Asama::Kopuk | Asama::Kapaniyor => BaglantiAsamasi::Kopuk,
            Asama::Eslestirme { .. } => BaglantiAsamasi::Eslestirme,
            Asama::Hello { .. } | Asama::Yanit => BaglantiAsamasi::ElSikisma,
            Asama::Telafi(_) => BaglantiAsamasi::Telafi,
            Asama::Canli => BaglantiAsamasi::Canli,
        }
    }
}

/// Aşamanın kısa adı (çerçeve eşleştirmesi; `Asama`'yı ödünç almadan).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Tur {
    Kopuk,
    Eslestirme,
    Hello,
    Yanit,
    Telafi,
    Canli,
}

pub(super) fn gecmis_satiri(g: AjandaGecmisGirdisi) -> GecmisSatiri {
    let onceki = g.onceki.json();
    let sonraki = g.sonraki.json();
    let mut alanlar: BTreeSet<String> = BTreeSet::new();
    for v in [&onceki, &sonraki] {
        if let Some(n) = v.as_object() {
            alanlar.extend(n.keys().cloned());
        }
    }
    GecmisSatiri {
        rev: g.rev,
        ts_ms: g.ts_ms,
        islem: g.islem,
        yazar: g.yazar,
        ornek_tarihi: g.ornek_tarihi,
        alanlar: alanlar.into_iter().collect(),
        onceki_json: onceki.to_string(),
        sonraki_json: sonraki.to_string(),
    }
}

impl Motor {
    fn tur(&self) -> Tur {
        match self.asama {
            Asama::Kopuk | Asama::Kapaniyor => Tur::Kopuk,
            Asama::Eslestirme { .. } => Tur::Eslestirme,
            Asama::Hello { .. } => Tur::Hello,
            Asama::Yanit => Tur::Yanit,
            Asama::Telafi(_) => Tur::Telafi,
            Asama::Canli => Tur::Canli,
        }
    }

    /// Aşamayı değiştirir; dışarıdan görünen aşama değiştiyse `Degisim.baglanti`.
    fn asama_yaz(&mut self, e: &mut Etkiler, yeni: Asama) {
        if self.asama.disari() != yeni.disari() {
            e.degisim.baglanti = true;
        }
        self.asama = yeni;
    }

    /// Bağlantıyı kapatır: Kotlin soketi kapatıp `baglanti_kapandi`'yı çağırır.
    pub(crate) fn kapat(&mut self, e: &mut Etkiler, neden: &str) {
        e.kapat = Some(neden.to_string());
        self.asama_yaz(e, Asama::Kapaniyor);
    }

    fn kanal_hatasi(&mut self, e: &mut Etkiler, kod: AjandaKanalHatasi, neden: &str) {
        self.son_hata = Some(kod);
        if kod != AjandaKanalHatasi::ProtokolUyumsuz {
            self.surum_uyusmazligi = None;
        } else if self.surum_uyusmazligi.is_none() {
            self.surum_uyusmazligi = Some(SurumUyusmazligi::Bilinmiyor);
        }
        e.degisim.baglanti = true;
        self.kapat(e, neden);
    }

    /// Soket açıldı (köprü taşımayı kaydetti). Eşleştirme bekliyorsa `pair_request`, eşleşmişse `hello`.
    /// Önceki süreçten sonucu gelmeden kalmış işlem burada `Kopma` sayılır.
    pub(crate) fn baglanti_acildi(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        if !matches!(self.asama, Asama::Kopuk) {
            self.baglanti_kapandi(o, e, None)?;
        }
        self.kopmalari_isle(o, e)?;
        if let Some(qr) = self.bekleyen_qr()? {
            let public_key = base64_yaz(&o.kimlik.acik_anahtar()?);
            e.gonderilecek.push(AjandaYukari::PairRequest { kod: qr.kod.clone(), public_key, etiket: None }.kodla());
            self.asama_yaz(e, Asama::Eslestirme { qr });
            return Ok(());
        }
        match self.eslesme_oku()? {
            Some(eslesme) => self.hello_yolla(o, e, eslesme),
            None => Err(CekirdekHatasi::Eslesme { mesaj: "eşleşme yok; önce eslestirme_baslat".into() }),
        }
    }

    fn hello_yolla(&mut self, o: &Ortam, e: &mut Etkiler, eslesme: Eslesme) -> Result<(), CekirdekHatasi> {
        let client_nonce = base64_yaz(&o.kimlik.rastgele(32)?);
        // Yerel kipte boş kopya gibi (`son_rev` 0, `depo_id` yok): servis hep tam telafi yapar, koparma
        // anındaki PC temeli artımlı telafiyle ezilmez (`yerel.rs` "Geçişler").
        let h = if self.yerel_mi()? {
            HelloAlanlari { son_rev: 0, depo_id: None, son_rev_izi: None }
        } else {
            self.depo.hello_alanlari()?
        };
        e.gonderilecek.push(
            AjandaYukari::Hello {
                device_id: eslesme.device_id.clone(),
                son_rev: h.son_rev,
                depo_id: h.depo_id,
                son_rev_izi: h.son_rev_izi,
                client_nonce: client_nonce.clone(),
            }
            .kodla(),
        );
        self.asama_yaz(e, Asama::Hello { eslesme, client_nonce });
        Ok(())
    }

    /// Gelen metin çerçevesi (`ajanda_asagi_coz`'dan geçirilir; geçersizse kapat).
    pub(crate) fn cerceve_geldi(&mut self, o: &Ortam, e: &mut Etkiler, metin: &str) -> Result<(), CekirdekHatasi> {
        if self.tur() == Tur::Kopuk {
            return Ok(());
        }
        let m = match ajanda_asagi_coz(metin) {
            Ok(m) => m,
            Err(h) => {
                self.surum_uyusmazligi =
                    (h.kod.kanal_hatasi() == AjandaKanalHatasi::ProtokolUyumsuz).then(|| surum_yonu(metin));
                self.kanal_hatasi(e, h.kod.kanal_hatasi(), h.kod.ad());
                return Ok(());
            }
        };
        let sonuc = self.cerceveyi_isle(o, e, m);
        if sonuc.is_err() {
            // Depo ya da kabuk hatası: yarım kalan telafi/işlem sonraki bağlantıda baştan yapılır. Aşama
            // hangisi olursa olsun (işleyici hatadan önce `Kapaniyor`'a geçirmiş olabilir: o zaman taşımaya
            // henüz kapat gitmemiştir) taşıma kapattırılır; yoksa soket açık ama işlemez kalır. Buraya
            // girerken aşama `Kopuk`/`Kapaniyor` değildi (yukarıda dönülür), yani kapat bu çerçeveye aittir.
            self.kanal_hatasi(e, AjandaKanalHatasi::IcHata, "iç hata");
        }
        sonuc
    }

    fn cerceveyi_isle(&mut self, o: &Ortam, e: &mut Etkiler, m: AjandaAsagi) -> Result<(), CekirdekHatasi> {
        match (self.tur(), m) {
            (_, AjandaAsagi::Error { code, .. }) => {
                // Aynı sürümü konuşan karşı taraf uyuşmazlık diyorsa yön bilinmez.
                self.surum_uyusmazligi = None;
                self.kanal_hatasi(e, code, code.ad());
                Ok(())
            }
            (Tur::Eslestirme, AjandaAsagi::PairResult { ok, device_id, code, .. }) => {
                let Asama::Eslestirme { qr } = std::mem::replace(&mut self.asama, Asama::Kapaniyor) else { unreachable!() };
                e.degisim.eslesme = true;
                match (ok, device_id) {
                    (true, Some(device_id)) => {
                        let eslesme = self.eslesme_kaydet(&qr, &device_id)?;
                        // Bağlantı açık kalır: aynı bağlantıda kimlik doğrulamasıyla sürer.
                        self.hello_yolla(o, e, eslesme)
                    }
                    _ => {
                        let kod = code.unwrap_or(AjandaKanalHatasi::IcHata);
                        self.eslesme_reddedildi(kod)?;
                        self.kanal_hatasi(e, kod, "eşleştirme reddedildi");
                        Ok(())
                    }
                }
            }
            (Tur::Hello, AjandaAsagi::AuthChallenge { server_nonce, server_signature }) => {
                let Asama::Hello { eslesme, client_nonce } = std::mem::replace(&mut self.asama, Asama::Kapaniyor) else {
                    unreachable!()
                };
                self.sinamayi_yanitla(o, e, &eslesme, &client_nonce, &server_nonce, &server_signature)
            }
            (Tur::Yanit, AjandaAsagi::Welcome { depo_id, tam, .. }) => {
                // Tam telafi kuyruğa dokunmaz (`ajanda_kuyruk_karari(TamTelafi)` = `Bekle`, deneme aynı):
                // işlemler `esitlendi`'de taze kopya üstüne yeniden uygulanır ve sırayla yeniden gider.
                // Yerel kipte telafi hep toplanır (servis boş `hello`'ya zaten tam der): PC temeli bağlanma
                // bitene dek koparma anındaki haliyle kalmalı.
                let tam = if tam || self.yerel_mi()? {
                    self.depo.telafiyi_sil()?;
                    Some((depo_id, 0))
                } else {
                    self.depo.depo_id_yaz(&depo_id)?;
                    None
                };
                self.asama_yaz(e, Asama::Telafi(Telafi { tam, tampon: Vec::new() }));
                Ok(())
            }
            (Tur::Telafi, AjandaAsagi::Kayit { kayit }) => {
                let Asama::Telafi(t) = &mut self.asama else { unreachable!() };
                t.tampon.push(kayit);
                if t.tampon.len() >= TELAFI_TAMPONU {
                    self.telafi_tamponunu_yaz(o, e)?;
                }
                Ok(())
            }
            (Tur::Telafi, AjandaAsagi::Esitlendi { .. }) => self.esitlendi(o, e),
            (Tur::Canli, AjandaAsagi::Kayit { kayit }) => self.sunucu_kayitlarini_uygula(o, e, vec![kayit]),
            (Tur::Canli, AjandaAsagi::IslemSonucu { islem_id, ok, rev, code, .. }) => self.islem_sonucu(o, e, &islem_id, ok, rev, code),
            (Tur::Canli, AjandaAsagi::Gecmis { istek_id, kayit_id, girdiler, devami, code }) => {
                self.gecmis_geldi(e, &istek_id, &kayit_id, girdiler, devami, code);
                Ok(())
            }
            (_, m) => {
                self.kanal_hatasi(e, AjandaKanalHatasi::GecersizMesaj, &format!("beklenmeyen çerçeve: {}", m.tur()));
                Ok(())
            }
        }
    }

    /// `auth_challenge`: PC imzasını QR'daki anahtarla doğrula, telefonun imzasını yolla.
    fn sinamayi_yanitla(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        eslesme: &Eslesme,
        client_nonce: &str,
        server_nonce: &str,
        server_signature: &str,
    ) -> Result<(), CekirdekHatasi> {
        let pc_metni = ajanda_kimlik_imza_metni(ImzaRolu::Pc, &eslesme.device_id, client_nonce, server_nonce);
        let gecerli = match (base64_coz(&eslesme.server_public_key), base64_coz(server_signature)) {
            (Some(anahtar), Some(imza)) => o.kimlik.dogrula(anahtar, pc_metni.into_bytes(), imza)?,
            _ => false,
        };
        if !gecerli {
            self.kanal_hatasi(e, AjandaKanalHatasi::ImzaGecersiz, "PC imzası geçersiz");
            return Ok(());
        }
        let metin = ajanda_kimlik_imza_metni(ImzaRolu::Telefon, &eslesme.device_id, client_nonce, server_nonce);
        let imza = o.kimlik.imzala(metin.into_bytes())?;
        e.gonderilecek.push(AjandaYukari::AuthResponse { signature: base64_yaz(&imza) }.kodla());
        self.asama_yaz(e, Asama::Yanit);
        Ok(())
    }

    /// Tam telafi sürüyor mu (testler).
    #[cfg(test)]
    pub(super) fn tam_telafi_suruyor(&self) -> bool {
        matches!(&self.asama, Asama::Telafi(Telafi { tam: Some(_), .. }))
    }

    /// Telafi tamponunu yazar: tam telafide toplanan kopyaya, artımlıda sunucu ve görünen kopyaya.
    pub(super) fn telafi_tamponunu_yaz(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        let Asama::Telafi(t) = &mut self.asama else { return Ok(()) };
        let tampon = std::mem::take(&mut t.tampon);
        if t.tam.is_none() {
            return self.sunucu_kayitlarini_uygula(o, e, tampon);
        }
        self.depo.yazma(|d| {
            for k in &tampon {
                d.kopya_kaydi_uygula(KopyaTablosu::Telafi, k)?;
            }
            Ok(())
        })?;
        if let Asama::Telafi(Telafi { tam: Some((_, son_rev)), .. }) = &mut self.asama {
            *son_rev = tampon.iter().map(|k| k.revizyon).fold(*son_rev, i64::max);
        }
        Ok(())
    }

    /// Artımlı telafi ya da canlı `kayit`'ler: sunucu kopyasına (yalnız büyük revizyon), `son_rev`, görünen
    /// kopya; tek işlem. Kayıt geldiyse onun revizyonuna kadar onaylanmış kuyruk satırları gereksizdir.
    fn sunucu_kayitlarini_uygula(&mut self, o: &Ortam, e: &mut Etkiler, kayitlar: Vec<AjandaKaydi>) -> Result<(), CekirdekHatasi> {
        if kayitlar.is_empty() {
            return Ok(());
        }
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let degisen = self.depo.yazma(|d| {
            let onceki_rev = d.son_rev()?;
            let mut son_rev = onceki_rev;
            let mut dokunulan: BTreeSet<&str> = BTreeSet::new();
            for k in &kayitlar {
                son_rev = son_rev.max(k.revizyon);
                let yazildi = d.kopya_kaydi_uygula(KopyaTablosu::Sunucu, k)?;
                let rev = d.sunucu_revizyonu(&k.kayit_id)?.unwrap_or(k.revizyon);
                let onay_bitti = d.kaydin_onaylananlarini_sil(&k.kayit_id, rev)?;
                if yazildi || onay_bitti {
                    dokunulan.insert(&k.kayit_id);
                }
            }
            if son_rev != onceki_rev {
                d.son_rev_yaz(son_rev)?;
            }
            let mut degisen = Vec::new();
            for kayit_id in dokunulan {
                if gorunen_yenile(d, &b, kayit_id)? {
                    degisen.push(kayit_id.to_string());
                }
            }
            Ok(degisen)
        })?;
        self.gorunenler_degisti(o, e, &degisen);
        Ok(())
    }

    /// `esitlendi`: telafi biter, bağlantı canlı olur, kuyruk yollanmaya başlar.
    fn esitlendi(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        self.telafi_tamponunu_yaz(o, e)?;
        let Asama::Telafi(t) = std::mem::replace(&mut self.asama, Asama::Kapaniyor) else { unreachable!() };
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let simdi = o.simdi_ms().to_string();
        // Yerel kipte bağlanma burada biter: servisin tam kopyası elde edildi; tek işlemde yerel kayıtlar
        // kuyruğa dökülür ve kip `bagli` olur (`yerel.rs` `yereli_kuyruga_dok`). Yerel kipte telafi hep tamdır.
        let yerel = self.yerel_mi()?;
        match t.tam {
            Some((depo_id, son_rev)) if yerel => {
                self.depo.yazma(|d| {
                    super::yerel::yereli_kuyruga_dok(d, o, &b, &depo_id, son_rev)?;
                    d.meta_yaz(anahtar::SON_ESITLENME_MS, Some(&simdi))?;
                    Ok(())
                })?;
                self.hepsi_degisti(o, e);
            }
            Some((depo_id, son_rev)) => {
                self.depo.yazma(|d| {
                    d.telafiyi_sunucuya_gecir()?;
                    d.depo_id_yaz(&depo_id)?;
                    d.son_rev_yaz(son_rev)?;
                    // Telafi her onaylanmış işlemin sonucunu kapsar (`bas_rev` sonuçlardan sonra).
                    d.butun_onaylananlari_sil()?;
                    d.sahipsiz_gorunenleri_sil()?;
                    for k in d.gorunenden_farkli_sunucu_kayitlari()? {
                        d.gorunen_yaz(&k, false)?;
                    }
                    for kayit_id in d.kuyruktaki_kayitlar()? {
                        gorunen_yenile(d, &b, &kayit_id)?;
                    }
                    d.meta_yaz(anahtar::SON_ESITLENME_MS, Some(&simdi))?;
                    Ok(())
                })?;
                self.hepsi_degisti(o, e);
            }
            None => {
                let degisen = self.depo.yazma(|d| {
                    let mut degisen = Vec::new();
                    for kayit_id in d.butun_onaylananlari_sil()? {
                        if gorunen_yenile(d, &b, &kayit_id)? {
                            degisen.push(kayit_id);
                        }
                    }
                    d.meta_yaz(anahtar::SON_ESITLENME_MS, Some(&simdi))?;
                    Ok(degisen)
                })?;
                self.gorunenler_degisti(o, e, &degisen);
            }
        }
        self.son_hata = None;
        self.surum_uyusmazligi = None;
        e.degisim.baglanti = true;
        self.asama = Asama::Canli;
        self.kuyruk_ilerlet(o, e)
    }

    /// Canlıysa ve yolda işlem yoksa kuyruğun başını yollar. Çözülemeyen satır ret listesine geçer.
    pub(crate) fn kuyruk_ilerlet(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        if self.tur() != Tur::Canli || !self.depo.kuyruk_yollananlar()?.is_empty() {
            return Ok(());
        }
        while let Some(bas) = self.depo.kuyruk_basi()? {
            match islem_coz(&bas.islem_json) {
                Some(islem) => {
                    self.depo.kuyruk_yollandi_yaz(bas.sira, true)?;
                    e.gonderilecek.push(AjandaYukari::Islem { islem_id: bas.islem_id, islem }.kodla());
                    return Ok(());
                }
                None => self.ret_listesine_tasi(o, e, &bas, KuyrukRetNedeni::GecersizIslem)?,
            }
        }
        Ok(())
    }

    fn islem_sonucu(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        islem_id: &str,
        ok: bool,
        rev: Option<i64>,
        code: Option<AjandaRetNedeni>,
    ) -> Result<(), CekirdekHatasi> {
        // Yolda olmayan işlemin sonucu (eski ya da yinelenen): yok sayılır.
        let Some(s) = self.depo.kuyruk_yollananlar()?.into_iter().find(|s| s.islem_id == islem_id) else {
            return Ok(());
        };
        let olay = if ok { KuyrukOlayi::SonucOk } else { KuyrukOlayi::SonucRet(code.unwrap_or(AjandaRetNedeni::IcHata)) };
        match ajanda_kuyruk_karari(olay, s.deneme) {
            KuyrukKarari::Cikar => {
                let cevirici = o.cevirici();
                let b = self.iyimser_baglam(o, &cevirici)?;
                let degisti = self.depo.yazma(|d| {
                    let sunucu_rev = d.sunucu_revizyonu(&s.kayit_id)?;
                    match rev {
                        Some(r) if sunucu_rev.is_none_or(|sr| sr < r) => d.kuyruk_onaylandi_yaz(s.sira, r)?,
                        _ => d.kuyruk_sil(s.sira)?,
                    }
                    gorunen_yenile(d, &b, &s.kayit_id)
                })?;
                e.degisim.baglanti = true;
                if degisti {
                    self.gorunenler_degisti(o, e, std::slice::from_ref(&s.kayit_id));
                }
            }
            KuyrukKarari::Bekle { deneme } => {
                self.depo.kuyruk_deneme_yaz(s.sira, deneme)?;
            }
            KuyrukKarari::RetListesi { neden } => self.ret_listesine_tasi(o, e, &s, neden)?,
        }
        self.kuyruk_ilerlet(o, e)
    }

    /// İşlemi ret listesine taşır: kuyruktan çıkar, iyimser hali geri alınır (görünen kopya yeniden
    /// hesaplanır), içeriği ve nedeniyle kullanıcıya görünür.
    pub(crate) fn ret_listesine_tasi(
        &mut self,
        o: &Ortam,
        e: &mut Etkiler,
        s: &KuyrukSatiri,
        neden: KuyrukRetNedeni,
    ) -> Result<(), CekirdekHatasi> {
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let ts_ms = o.simdi_ms();
        let degisti = self.depo.yazma(|d| {
            let islem = islem_coz(&s.islem_json);
            let govde_json = istenen_govde(d, &b, &s.kayit_id, s.sira, islem.as_ref())?
                .map(|g| g.alanlari_yaz(Yazici::yeni()).bitir().to_string());
            d.ret_ekle(&RetSatiri {
                islem_id: s.islem_id.clone(),
                kayit_id: s.kayit_id.clone(),
                islem_json: s.islem_json.clone(),
                neden: neden.ad().to_string(),
                ts_ms,
                govde_json,
                sira: s.sira,
            })?;
            d.kuyruk_sil(s.sira)?;
            gorunen_yenile(d, &b, &s.kayit_id)
        })?;
        e.degisim.ret_listesi = true;
        e.degisim.baglanti = true;
        if degisti {
            self.gorunenler_degisti(o, e, std::slice::from_ref(&s.kayit_id));
        }
        Ok(())
    }

    /// Yollanmış ama sonucu gelmemiş satırlar: `Kopma` (bu bağlantı ya da ölen süreçten kalan).
    fn kopmalari_isle(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        for s in self.depo.kuyruk_yollananlar()? {
            e.degisim.baglanti = true;
            match ajanda_kuyruk_karari(KuyrukOlayi::Kopma, s.deneme) {
                KuyrukKarari::Bekle { deneme } => self.depo.kuyruk_deneme_yaz(s.sira, deneme)?,
                KuyrukKarari::RetListesi { neden } => self.ret_listesine_tasi(o, e, &s, neden)?,
                // Kopma hiçbir zaman çıkarmaz; yine de satır yollanmamış sayılsın.
                KuyrukKarari::Cikar => self.depo.kuyruk_yollandi_yaz(s.sira, false)?,
            }
        }
        Ok(())
    }

    /// Soket kapandı: süren tam telafi atılır, artımlı tampon yazılır (gelenler geçerli), yollanmış işlem
    /// `Kopma` sayılır (`kural::kuyruk`), bekleyen geçmiş istekleri düşer. `kapanis_kodu`: karşı tarafın
    /// kapanış çerçevesinin kodu (biliniyorsa). 1002 sürüm uyuşmazlığıdır (servis 1002'yi yalnız
    /// `protokol_uyumsuz`'da kullanır): `error` çerçevesi gelmemiş olsa da `son_hata`'ya yazılır.
    pub(crate) fn baglanti_kapandi(&mut self, o: &Ortam, e: &mut Etkiler, kapanis_kodu: Option<i32>) -> Result<(), CekirdekHatasi> {
        // Motor bu bağlantıyı kendisi kapattıysa (`Kapaniyor`: çözülen uyuşmazlık çerçevesi yönü zaten yazdı)
        // kapanış kodu yeni bilgi değildir; değilse bu bağlantının uyuşmazlığı yalnız koddan bilinir.
        if kapanis_kodu == Some(KAPANIS_PROTOKOL_HATASI) && !matches!(self.asama, Asama::Kapaniyor | Asama::Kopuk) {
            self.son_hata = Some(AjandaKanalHatasi::ProtokolUyumsuz);
            self.surum_uyusmazligi = Some(SurumUyusmazligi::Bilinmiyor);
            e.degisim.baglanti = true;
        }
        let eski = std::mem::replace(&mut self.asama, Asama::Kopuk);
        if eski.disari() != BaglantiAsamasi::Kopuk {
            e.degisim.baglanti = true;
        }
        let mut sonuc = Ok(());
        if let Asama::Telafi(t) = eski {
            sonuc = match t.tam {
                Some(_) => self.depo.telafiyi_sil(),
                None => self.sunucu_kayitlarini_uygula(o, e, t.tampon),
            };
        }
        let kopma = self.kopmalari_isle(o, e);
        for (kayit_id, sayfa) in self.gecmis.iter_mut() {
            if sayfa.yukleniyor {
                sayfa.yukleniyor = false;
                e.degisim.gecmis.push(kayit_id.clone());
            }
        }
        self.gecmis_istekleri.clear();
        sonuc.and(kopma)
    }

    pub(crate) fn baglanti_durumu(&self) -> Result<BaglantiDurumu, CekirdekHatasi> {
        // Yerel kipte kuyruk yoktur (göç 4 toplar, yerel yazar kullanmaz): gönderilecek iş sıfırdır.
        let kuyrukta = if self.yerel_mi()? { 0 } else { self.depo.kuyruk_sayisi()? };
        Ok(BaglantiDurumu {
            asama: self.asama.disari(),
            kuyrukta: i32::try_from(kuyrukta).unwrap_or(i32::MAX),
            ret_listesinde: i32::try_from(self.depo.ret_sayisi()?).unwrap_or(i32::MAX),
            son_esitlenme_ms: self.depo.meta_oku(anahtar::SON_ESITLENME_MS)?.and_then(|s| s.parse().ok()),
            son_hata: self.son_hata,
            surum_uyusmazligi: self.surum_uyusmazligi,
        })
    }

    pub(crate) fn canli_mi(&self) -> bool {
        self.tur() == Tur::Canli
    }

    fn gecmis_geldi(
        &mut self,
        e: &mut Etkiler,
        istek_id: &str,
        kayit_id: &str,
        girdiler: Vec<AjandaGecmisGirdisi>,
        devami: bool,
        code: Option<AjandaRetNedeni>,
    ) {
        // Bilinmeyen ya da başka kayda ait yanıt yok sayılır.
        if self.gecmis_istekleri.get(istek_id).is_none_or(|k| k != kayit_id) {
            return;
        }
        self.gecmis_istekleri.remove(istek_id);
        let sayfa = self.gecmis.entry(kayit_id.to_string()).or_insert_with(|| GecmisSayfasi {
            kayit_id: kayit_id.to_string(),
            satirlar: Vec::new(),
            devami: false,
            yukleniyor: false,
            hata: None,
        });
        sayfa.satirlar.extend(girdiler.into_iter().map(gecmis_satiri));
        sayfa.satirlar.sort_by_key(|s| std::cmp::Reverse(s.rev));
        sayfa.satirlar.dedup_by_key(|s| s.rev);
        sayfa.devami = devami && code.is_none();
        sayfa.yukleniyor = false;
        sayfa.hata = code;
        e.degisim.gecmis.push(kayit_id.to_string());
    }
}
