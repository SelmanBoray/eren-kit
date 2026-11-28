//! Dil bağımsız vektör düzeneği (`harness = false`): `apps/phone/protocol/vektorler/` altındaki
//! `ajanda-mesaj.json`, `ajanda-mesaj-v3.json`, `ajanda-kurallar.json`, `ajanda-surum.json` ve
//! `ajanda-v3.json`'ın HER bölümünü Rust uygulamasına karşı çalıştırır. Dosyalar kopyalanmaz; yol
//! `AJANDA_VEKTOR_DIZINI` ile değiştirilebilir.
//!
//! Sürüm denetimi dosya başınadır: her dosyanın `surum`'u `AJANDA_SURUMLERI`'nde olmalı; mesaj
//! dosyaları o sürümün bağlantısında okunur ve yeniden kodlanır (`ajanda-mesaj.json` v2,
//! `ajanda-mesaj-v3.json` v3). `ajanda-surum.json`'ın `surumler`/`qr_surumu`'su sabitlerle karşılaştırılır.
//!
//! Her vektör: GEÇTİ, KALDI (fark yazılır) ya da BEKLİYOR (kural `Yazilmadi` paniğiyle duruyor). Bölüm
//! tablosu her koşuda basılır; KALDI varsa ya da vektör dosyasında düzeneğin tanımadığı bir bölüm
//! varsa çıkış kodu 1'dir. BEKLİYOR başarısızlık değildir ama sayısı görünür ve kimin işi olduğu yazar.
//! Sözleşmeye bölüm eklenince (v2: `gun_hatirlatmasi`, `gece_teyidi`) düzenek de eklenir; tanınmayan bölüm
//! çıkışı 1 yapar, bölüm sessizce atlanmaz.

use ajanda_cekirdek::kural::{self, AnCevirici, SabitOfsetCevirici, Yazilmadi};
use ajanda_cekirdek::model::{
    self, AjandaAlani, AjandaAsagi, AjandaEslestirmeQr, AjandaKaydi, AjandaOrnegi, AjandaRetNedeni, AjandaZamani,
    AlanDegisikligi, CozumHatasi, GeriDusus, Hatirlatma, ImzaRolu, KayitDurumu, KayitTuru, KaynakYolu, Surum, Tekrar,
    TurKokeni, YazarKimligi, YerelAn,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;

// Düzenek

enum Sonuc {
    Gecti,
    Kaldi(String),
    Bekliyor(&'static str),
}

struct Bolum {
    ad: String,
    sahip: &'static str,
    gecti: usize,
    kaldi: Vec<String>,
    bekliyor: usize,
    bekleyen_parca: Option<&'static str>,
    devredildi: Option<(usize, &'static str)>,
}

impl Bolum {
    fn yeni(ad: &str, sahip: &'static str) -> Self {
        Bolum { ad: ad.to_string(), sahip, gecti: 0, kaldi: vec![], bekliyor: 0, bekleyen_parca: None, devredildi: None }
    }

    /// `f`: `Ok(())` eşleşti, `Err(fark)` eşleşmedi. `Yazilmadi` paniği BEKLİYOR, öteki panik KALDI.
    fn dene(&mut self, vektor: &str, f: impl FnOnce() -> Result<(), String>) {
        let sonuc = match catch_unwind(AssertUnwindSafe(f)) {
            Ok(Ok(())) => Sonuc::Gecti,
            Ok(Err(fark)) => Sonuc::Kaldi(fark),
            Err(yuk) => match yuk.downcast_ref::<Yazilmadi>() {
                Some(y) => Sonuc::Bekliyor(y.0),
                None => Sonuc::Kaldi(format!(
                    "panik: {}",
                    yuk.downcast_ref::<String>().cloned().or_else(|| yuk.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
                )),
            },
        };
        match sonuc {
            Sonuc::Gecti => self.gecti += 1,
            Sonuc::Kaldi(fark) => self.kaldi.push(format!("{vektor}: {fark}")),
            Sonuc::Bekliyor(parca) => {
                self.bekliyor += 1;
                self.bekleyen_parca.get_or_insert(parca);
            }
        }
    }
}

fn esit<T: PartialEq + std::fmt::Debug>(ne: &str, gelen: T, beklenen: T) -> Result<(), String> {
    if gelen == beklenen { Ok(()) } else { Err(format!("{ne}: gelen {gelen:?}, beklenen {beklenen:?}")) }
}

fn vektor_dizini() -> PathBuf {
    std::env::var_os("AJANDA_VEKTOR_DIZINI").map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../phone/protocol/vektorler")
    })
}

fn dosya_oku(ad: &str) -> Value {
    let yol = vektor_dizini().join(ad);
    let metin = std::fs::read_to_string(&yol).unwrap_or_else(|e| panic!("vektör dosyası okunamadı: {} ({e})", yol.display()));
    serde_json::from_str(&metin).unwrap_or_else(|e| panic!("vektör dosyası JSON değil: {} ({e})", yol.display()))
}

// Vektör girdisi yardımcıları (vektör bozuksa düzenek paniklemeli: KALDI olarak görünür)

fn metin<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or_else(|| panic!("vektörde metin yok: {k}"))
}
fn sayi(v: &Value, k: &str) -> i64 {
    v[k].as_i64().unwrap_or_else(|| panic!("vektörde sayı yok: {k}"))
}
fn mantik(v: &Value, k: &str) -> bool {
    v[k].as_bool().unwrap_or_else(|| panic!("vektörde mantıksal yok: {k}"))
}
fn ad(v: &Value) -> String {
    v["ad"].as_str().unwrap_or("?").to_string()
}
fn kayit_oku(v: &Value) -> AjandaKaydi {
    AjandaKaydi::oku(v, "").unwrap_or_else(|h| panic!("vektör kaydı şemadan geçmedi: {} {}", h.yol, h.neden))
}
fn zaman_oku(v: &Value) -> Option<AjandaZamani> {
    (!v.is_null()).then(|| AjandaZamani::oku(v, "").unwrap_or_else(|h| panic!("vektör zamanı: {} {}", h.yol, h.neden)))
}
fn yazar_oku(v: &Value) -> YazarKimligi {
    YazarKimligi {
        yol: KaynakYolu::coz(metin(v, "yol")).expect("yol"),
        tur_kokeni: TurKokeni::coz(metin(v, "tur_kokeni")).expect("tur_kokeni"),
    }
}
fn ornekler_json(l: &[AjandaOrnegi]) -> Value {
    Value::Array(l.iter().map(AjandaOrnegi::json).collect())
}
fn dizi(v: &Value, k: &str) -> Vec<Value> {
    v[k].as_array().cloned().unwrap_or_default()
}

// Bölümler: mesaj

/// Dosyanın `surum`'u (desteklenen bir sürüm olmalı; değilse dosya bölümü tanımsız sayılır).
fn dosya_surumu(dosya: &Value) -> Option<Surum> {
    dosya["surum"].as_i64().and_then(Surum::coz)
}

/// Çözüm sonucu: (tür, yeniden kodlama) ya da hata. `baglanti`: bağlantının sabitlenmiş sürümü.
fn coz(yon: &str, ham: &str, baglanti: Option<Surum>) -> Result<(&'static str, Value), CozumHatasi> {
    if yon == "asagi" {
        model::ajanda_asagi_coz_surum(ham, baglanti).map(|(s, m)| (m.tur(), m.json_surum(s)))
    } else {
        model::ajanda_yukari_coz_surum(ham, baglanti).map(|(s, m)| (m.tur(), m.json_surum(s)))
    }
}

/// `ajanda-mesaj.json` biçimindeki bir vektör: `gecerli` ise tür ve yeniden kodlama aynı JSON, değilse kod
/// (ve gövdesi geçersiz `islem`'de `islem_id`).
fn mesaj_vektoru(v: &Value, yon: &str, baglanti: Option<Surum>) -> Result<(), String> {
    let ham = metin(v, "ham");
    let gecerli = mantik(v, "gecerli");
    match coz(yon, ham, baglanti) {
        Ok((tur, kodla)) if gecerli => {
            esit("tür", Some(tur), v["tur"].as_str())?;
            // Kodlayıcı eşliği: yeniden kodlanan değer gelen değerle aynı JSON.
            let gelen: Value = serde_json::from_str(ham).expect("geçerli vektör JSON");
            esit("yeniden kodlama", kodla, gelen)
        }
        Ok((tur, _)) => Err(format!("kabul edildi (tür {tur})")),
        Err(h) if gecerli => Err(format!("reddedildi: {} {:?}", h.kod.ad(), h.yollar)),
        Err(h) => {
            esit("kod", h.kod.ad(), metin(v, "kod"))?;
            esit("islem_id", h.islem_id.as_deref(), v["islem_id"].as_str())
        }
    }
}

fn mesaj_bolumu(dosya: &Value, onek: &str, yon: &str) -> Bolum {
    let mut b = Bolum::yeni(&format!("{onek}.{yon}"), "ilk dalga (model)");
    let surum = dosya_surumu(dosya);
    for v in dizi(dosya, yon) {
        b.dene(&ad(&v), || mesaj_vektoru(&v, yon, Some(surum.ok_or("dosya sürümü desteklenmiyor")?)));
    }
    b
}

// Bölümler: sürüm uyumu (`ajanda-surum.json`)

fn surum_sabitleri(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("surum.sabitler", "D5 (model)");
    b.dene("surumler", || esit("surumler", json!(model::AJANDA_SURUMLERI), v["surumler"].clone()));
    b.dene("qr_surumu", || esit("qr_surumu", json!(model::AJANDA_QR_SURUMU), v["qr_surumu"].clone()));
    b.dene("en yüksek", || esit("AJANDA_SURUMU", model::AJANDA_SURUMLERI.last().copied(), Some(model::AJANDA_SURUMU)));
    b
}

fn surum_cozum(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("surum.cozum", "D5 (model)");
    for o in dizi(v, "cozum") {
        b.dene(&ad(&o), || {
            let baglanti = match &o["baglanti"] {
                Value::Null => None,
                n => Some(n.as_i64().and_then(Surum::coz).ok_or("vektörde desteklenmeyen bağlantı sürümü")?),
            };
            mesaj_vektoru(&o, metin(&o, "yon"), baglanti)
        });
    }
    b
}

fn ret_surumu(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("surum.ret_surumu", "D5 (model)");
    for o in dizi(v, "ret_surumu") {
        b.dene(&ad(&o), || esit("sürüm", model::ajanda_ret_surumu_oku(metin(&o, "ham")), o["surum"].as_i64()));
    }
    b
}

fn geri_dusus(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("surum.geri_dusus", "D5 (model)");
    for o in dizi(v, "geri_dusus") {
        b.dene(&ad(&o), || {
            let kume: Vec<i64> = dizi(&o, "kume").iter().map(|x| x.as_i64().expect("küme")).collect();
            let karar = match model::ajanda_geri_dusus(sayi(&o, "denenen"), o["ret"].as_i64(), &kume) {
                GeriDusus::YenidenDene { surum } => json!({"karar": "yeniden_dene", "surum": surum}),
                GeriDusus::UygulamaEski => json!({"karar": "uygulama_eski"}),
                GeriDusus::ServisEski => json!({"karar": "servis_eski"}),
                GeriDusus::Bilinmiyor => json!({"karar": "bilinmiyor"}),
            };
            esit("karar", karar, o["karar"].clone())
        });
    }
    b
}

fn donmus_hata(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("surum.donmus_hata", "D5 (model)");
    for o in dizi(v, "donmus_hata") {
        b.dene(&ad(&o), || {
            let h = model::ajanda_donmus_hata_oku(metin(&o, "ham")).map(|h| {
                let mut j = json!({"v": h.v, "code": h.code});
                if let Some(d) = h.detail {
                    j["detail"] = json!(d);
                }
                j
            });
            esit("hata", h.unwrap_or(Value::Null), o["hata"].clone())
        });
    }
    b
}

// Bölümler: sürüm 3 (`ajanda-v3.json`)

fn v3_sabitleri(v: &Value) -> Bolum {
    use model::sinirlar::ajanda as s;
    let mut b = Bolum::yeni("v3.sabitler", "v3 (model)");
    let sinirlar: Vec<(&str, i64)> = vec![
        ("SIMGE", s::SIMGE as i64),
        ("BOLGE", s::BOLGE as i64),
        ("BOLGE_YARICAP_MIN", s::BOLGE_YARICAP_MIN),
        ("BOLGE_YARICAP_MAX", s::BOLGE_YARICAP_MAX),
        ("KAYIT_BAGLANTI_ADET", s::KAYIT_BAGLANTI_ADET as i64),
        ("BAGLANTI_URL", s::BAGLANTI_URL as i64),
        ("BAGLANTI_BASLIK", s::BAGLANTI_BASLIK as i64),
        ("EK_ADET", s::EK_ADET as i64),
        ("EK_BAYT", s::EK_BAYT),
        ("EK_KENAR", s::EK_KENAR),
        ("EK_MIME", s::EK_MIME as i64),
        ("EK_PARCA", s::EK_PARCA),
        ("EK_PENCERE", s::EK_PENCERE as i64),
        ("EK_TOPLAM_BAYT", s::EK_TOPLAM_BAYT),
        ("EK_SAKLAMA_GUN", s::EK_SAKLAMA_GUN),
        ("YETENEK_ADET", s::YETENEK_ADET as i64),
        ("YETENEK_ADI", s::YETENEK_ADI as i64),
    ];
    let tablo: serde_json::Map<String, Value> = sinirlar.iter().map(|(k, d)| (k.to_string(), json!(d))).collect();
    b.dene("sinirlar", || esit("sinirlar", Value::Object(tablo), v["sinirlar"].clone()));
    b.dene("simgeler", || esit("simgeler", json!(model::alan::AJANDA_SIMGELERI), v["simgeler"].clone()));
    b.dene("yetenekler", || esit("yetenekler", json!(model::alan::AJANDA_YETENEKLERI), v["yetenekler"].clone()));
    b.dene("ek_ret_kodlari", || {
        let l: Vec<&str> = model::AjandaEkRetKodu::HEPSI.iter().map(|k| k.ad()).collect();
        esit("ek_ret_kodlari", json!(l), v["ek_ret_kodlari"].clone())
    });
    b
}

fn bolge_anahtari(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("v3.bolge_anahtari", "v3 (model)");
    for o in dizi(v, "bolge_anahtari") {
        b.dene(&ad(&o), || esit("anahtar", model::ajanda_bolge_anahtari(metin(&o, "girdi")).as_str(), metin(&o, "anahtar")));
    }
    b
}

fn url(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("v3.url", "v3 (model)");
    for o in dizi(v, "url") {
        b.dene(&ad(&o), || {
            let alan_adi = model::ajanda_url_alan_adi(metin(&o, "url"));
            esit("geçerli", model::ajanda_url_gecerli_mi(metin(&o, "url")), mantik(&o, "gecerli"))?;
            esit("alan adı", alan_adi.as_deref(), o["alan_adi"].as_str())
        });
    }
    b
}

fn yetenek_kesisimi(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("v3.yetenek_kesisimi", "v3 (model)");
    let liste = |x: &Value| -> Vec<String> { x.as_array().map(|a| a.iter().map(|s| s.as_str().unwrap_or("").to_string()).collect()).unwrap_or_default() };
    for o in dizi(v, "yetenek_kesisimi") {
        b.dene(&ad(&o), || {
            let istenen = (!o["istenen"].is_null()).then(|| liste(&o["istenen"]));
            let k = model::ajanda_yetenek_kesisimi(istenen.as_deref(), &liste(&o["sunulan"]));
            esit("kesişim", k, liste(&o["kesisim"]))
        });
    }
    b
}

/// `ajandaAsagiSurume(girdi, surum)`: `cikti` `null` ise ret (o sürümde karşılığı yok), değilse uyarlanan
/// çerçeve. Alan sırası sınanmaz: `serde_json::Value` nesneleri sırasızdır (Rust yazıcısının sırası
/// sabittir; sıra JSON anlamına girmez).
fn asagi_uyarlama(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("v3.asagi_uyarlama", "v3 (servis kuralı)");
    for o in dizi(v, "asagi_uyarlama") {
        b.dene(&ad(&o), || {
            let girdi = &o["girdi"];
            let kaynak = girdi["v"].as_i64().and_then(Surum::coz).ok_or("girdinin sürümü desteklenmiyor")?;
            let hedef = o["surum"].as_i64().and_then(Surum::coz).ok_or("hedef sürüm desteklenmiyor")?;
            let m = AjandaAsagi::oku(girdi, kaynak).map_err(|h| format!("girdi şemadan geçmedi: {} {}", h.yol, h.neden))?;
            match (model::ajanda_asagi_surume(&m, hedef), &o["cikti"]) {
                (Err(h), Value::Null) => esit("kod", h.kod.ad(), "protokol_uyumsuz"),
                (Err(h), _) => Err(format!("reddedildi: {} {:?}", h.kod.ad(), h.yollar)),
                (Ok(c), Value::Null) => Err(format!("uyarlandı: {c}")),
                (Ok(c), beklenen) => esit("çıktı", &c, beklenen),
            }
        });
    }
    b
}

// Bölümler: kurallar

fn imza_metni(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("imza_metni", "ilk dalga (model)");
    for o in dizi(v, "imza_metni") {
        b.dene(&ad(&o), || {
            let g = &o["girdi"];
            let rol = if metin(g, "rol") == "pc" { ImzaRolu::Pc } else { ImzaRolu::Telefon };
            let m = model::ajanda_kimlik_imza_metni(rol, metin(g, "device_id"), metin(g, "client_nonce"), metin(g, "server_nonce"));
            esit("metin", m.as_str(), metin(&o, "metin"))?;
            let hex: String = m.bytes().map(|b| format!("{b:02x}")).collect();
            esit("utf8", hex.as_str(), metin(&o, "utf8_hex"))
        });
    }
    b
}

fn imza(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("imza", "K1 (Kotlin)");
    // ECDSA doğrulaması Rust'ta yok: KimlikKabugu.dogrula (java.security). Vektörü Kotlin'de K1 sınar.
    let adet = usize::from(v.get("imza").is_some());
    b.devredildi = Some((adet, "KimlikKabugu.dogrula: Kotlin birim testi (K1)"));
    b
}

fn kapsam(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("kapsam", "ilk dalga (model)");
    for o in dizi(v, "kapsam") {
        let n = format!("{}/{}", metin(&o, "kapsam"), metin(&o, "kanal"));
        b.dene(&n, || esit("izinli", model::kanal_kapsamda_mi(metin(&o, "kapsam"), metin(&o, "kanal")), mantik(&o, "izinli")));
    }
    b
}

fn qr(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("qr", "ilk dalga (model)");
    for (i, q) in dizi(&v["qr"], "gecerli").into_iter().enumerate() {
        b.dene(&format!("geçerli {i}"), || match AjandaEslestirmeQr::oku(&q, "") {
            Ok(k) => esit("yeniden kodlama", k.json(), q.clone()),
            Err(h) => Err(format!("reddedildi: {} {}", h.yol, h.neden)),
        });
    }
    for o in dizi(&v["qr"], "gecersiz") {
        b.dene(&ad(&o), || match AjandaEslestirmeQr::oku(&o["qr"], "") {
            Ok(_) => Err("kabul edildi".into()),
            Err(_) => Ok(()),
        });
    }
    b
}

/// `birlestirme` ve `bolge_konumu` (aynı biçim): `beklenen.<alan>` verilmişse sonuçtaki değer.
fn birlestirme(v: &Value) -> Bolum {
    birlestirme_bolumu(v, "birlestirme", "birlestirme", "R2")
}

fn birlestirme_bolumu(v: &Value, anahtar: &str, bolum: &str, sahip: &'static str) -> Bolum {
    let mut b = Bolum::yeni(bolum, sahip);
    for o in dizi(v, anahtar) {
        b.dene(&ad(&o), || {
            let kayit = kayit_oku(&o["kayit"]);
            let d = AlanDegisikligi::oku(&o["degisiklik"], "").map_err(|h| format!("vektör değişikliği: {} {}", h.yol, h.neden))?;
            let r = kural::birlesim::ajanda_degisikligi_uygula(&kayit, &d, yazar_oku(&o["yazar"]));
            let bek = &o["beklenen"];
            let adlar = |l: &[model::AjandaAlani]| l.iter().map(|a| a.ad().to_string()).collect::<Vec<_>>();
            let liste = |k: &str| bek[k].as_array().map(|a| a.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect::<Vec<_>>());
            esit("uygulanan", Some(adlar(&r.uygulanan)), liste("uygulanan"))?;
            esit("korunan", Some(adlar(&r.korunan)), liste("korunan"))?;
            esit("elle_alanlar", Some(adlar(&r.kayit.elle_alanlar)), liste("elle_alanlar"))?;
            if let Some(o) = bek.get("ornekler") {
                esit("ornekler", &ornekler_json(&r.kayit.ornekler), o)?;
            }
            if let Some(o) = bek.get("budanan_ornekler") {
                esit("budanan_ornekler", &ornekler_json(&r.budanan_ornekler), o)?;
            }
            let sonuc = r.kayit.json();
            for (k, deger) in bek.as_object().into_iter().flatten() {
                if AjandaAlani::coz(k).is_some() {
                    esit(k, sonuc.get(k), Some(deger))?;
                }
            }
            for k in liste("kaldirilan").unwrap_or_default() {
                if sonuc.get(&k).is_some() {
                    return Err(format!("kaldırılmalıydı: {k}"));
                }
            }
            Ok(())
        });
    }
    b
}

fn hatirlatma_etkin(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("hatirlatma_etkin", "ilk dalga (model)");
    for o in dizi(v, "hatirlatma_etkin") {
        let durum = KayitDurumu::coz(metin(&o, "durum")).expect("durum");
        b.dene(&format!("{o}"), || {
            esit("etkin", model::hatirlatma_etkin_mi(mantik(&o, "taslak"), mantik(&o, "silindi"), durum), mantik(&o, "etkin"))
        });
    }
    b
}

/// `ajandaTekilAnahtari`; v3 dosyasında `bolge` de (yalnız verilmişse).
fn tekil_anahtar(v: &Value, bolum: &str) -> Bolum {
    let mut b = Bolum::yeni(bolum, "R2");
    for o in dizi(v, "tekil_anahtar") {
        b.dene(&ad(&o), || {
            let g = &o["girdi"];
            let zaman = zaman_oku(&g["zaman"]);
            let tur = KayitTuru::coz(metin(g, "tur")).expect("tur");
            let a = kural::tekil::ajanda_tekil_anahtari(metin(g, "kapsam"), tur, metin(g, "baslik"), zaman.as_ref(), g["bolge"].as_str());
            esit("anahtar", a.as_str(), metin(&o, "anahtar"))
        });
    }
    b
}

fn es_degisikligi(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("es_degisikligi", "R2");
    for o in dizi(v, "es_degisikligi") {
        b.dene(&ad(&o), || {
            let g = &o["girdi"];
            let es_zaman = zaman_oku(&o["es"]["zaman"]);
            let zaman = zaman_oku(&g["zaman"]);
            let hatirlatmalar: Option<Vec<Hatirlatma>> = g.get("hatirlatmalar").map(|h| {
                model::zaman::hatirlatmalari_oku(h, "").unwrap_or_else(|h| panic!("vektör hatırlatması: {}", h.neden))
            });
            let d = kural::tekil::ajanda_es_degisikligi(es_zaman.as_ref(), g["aciklama"].as_str(), zaman.as_ref(), hatirlatmalar.as_deref());
            esit("değişiklik", d.json(), o["degisiklik"].clone())
        });
    }
    b
}

fn gorunmez(v: &Value) -> (Bolum, Bolum) {
    let g = &v["gorunmez"];
    let mut b = Bolum::yeni("gorunmez", "ilk dalga (model)");
    b.dene("araliklar", || {
        let tablo: Vec<Value> = model::metin::AJANDA_GORUNMEZ_ARALIKLARI.iter().map(|(a, z)| json!([a, z])).collect();
        esit("araliklar", Value::Array(tablo), g["araliklar"].clone())
    });
    b.dene("emoji_birlestiricileri", || {
        esit("emoji", json!(model::metin::AJANDA_EMOJI_BIRLESTIRICILERI), g["emoji_birlestiricileri"].clone())
    });
    for o in dizi(g, "ornekler") {
        let k = sayi(&o, "kod_noktasi") as u32;
        b.dene(&format!("U+{k:04X}"), || esit("görünmez", model::metin::ajanda_gorunmez_mi(k), mantik(&o, "gorunmez")));
    }
    let kod_noktalari = |o: &Value, k: &str| -> Result<String, String> {
        dizi(o, k)
            .iter()
            .map(|x| x.as_u64().and_then(|n| char::from_u32(n as u32)).ok_or_else(|| format!("Rust char olamayan kod noktası: {x}")))
            .collect()
    };
    let mut temiz = Bolum::yeni("gorunmez.temiz", "R1");
    for o in dizi(g, "metinler") {
        b.dene(&ad(&o), || esit("geçerli", !model::metin::ajanda_gorunmez_var_mi(&kod_noktalari(&o, "kod_noktalari")?), mantik(&o, "gecerli")));
        temiz.dene(&ad(&o), || {
            let t = kural::metin::ajanda_metni_temizle(&kod_noktalari(&o, "kod_noktalari")?);
            esit("temiz", t, kod_noktalari(&o, "temiz")?)
        });
    }
    (b, temiz)
}

fn tekil_karar(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("tekil_karar", "R2");
    for o in dizi(v, "tekil_karar") {
        b.dene(&ad(&o), || {
            let esler: Vec<kural::tekil::EsDurumu> = dizi(&o, "esler")
                .iter()
                .map(|e| kural::tekil::EsDurumu {
                    silindi: mantik(e, "silindi"),
                    durum: KayitDurumu::coz(metin(e, "durum")).expect("durum"),
                    taslak: mantik(e, "taslak"),
                })
                .collect();
            let karar = match kural::tekil::ajanda_tekil_karari(&esler, yazar_oku(&o["yazar"])) {
                kural::tekil::TekilKarari::Ekle => "ekle",
                kural::tekil::TekilKarari::ZatenVar { .. } => "zaten_var",
                kural::tekil::TekilKarari::Onayla { .. } => "onayla",
            };
            esit("karar", karar, metin(&o, "karar"))
        });
    }
    b
}

fn iz_oku(v: &Value) -> Option<model::AjandaRevIzi> {
    (!v.is_null()).then(|| model::AjandaRevIzi { kayit_id: metin(v, "kayit_id").into(), guncelleme_ms: sayi(v, "guncelleme_ms") })
}

fn telafi(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("telafi", "R2");
    for o in dizi(v, "telafi") {
        b.dene(&ad(&o), || {
            let h = &o["hello"];
            let g = kural::telafi::TelafiGirdisi {
                hello_son_rev: sayi(h, "son_rev"),
                hello_depo_id: h["depo_id"].as_str().map(str::to_string),
                hello_son_rev_izi: iz_oku(&h["son_rev_izi"]),
                depo_id: metin(&o, "depo_id").into(),
                bas_rev: sayi(&o, "bas_rev"),
                izdeki: o.get("izdeki").filter(|i| !i.is_null()).map(|i| (metin(i, "kayit_id").to_string(), sayi(i, "ts_ms"))),
            };
            esit("tam", kural::telafi::ajanda_telafi_tam_mi(&g), mantik(&o, "tam"))
        });
    }
    b
}

fn dayanak(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("dayanak", "R1");
    for o in dizi(v, "dayanak") {
        b.dene(&ad(&o), || {
            let d = &o["dayanak"];
            let m = &o["mesaj_ani"];
            let an = YerelAn { tarih: metin(m, "tarih").into(), saat: metin(m, "saat").into(), saat_dilimi: metin(m, "saat_dilimi").into() };
            let r = kural::dayanak::dayanak_gecerli_mi(metin(d, "tarih"), metin(d, "saat"), d["saat_dilimi"].as_str(), &an);
            esit("geçerli", r, mantik(&o, "gecerli"))
        });
    }
    b
}

fn tekrar_oku(v: &Value) -> Tekrar {
    Tekrar::oku(v, "").unwrap_or_else(|h| panic!("vektör tekrarı: {} {}", h.yol, h.neden))
}

fn tekrar_ornekleri(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("tekrar_ornekleri", "ilk dalga (model)");
    for o in dizi(v, "tekrar_ornekleri") {
        b.dene(&ad(&o), || {
            let t = tekrar_oku(&o["tekrar"]);
            let beklenen: Vec<String> = dizi(&o, "beklenen").iter().map(|x| x.as_str().unwrap_or("").to_string()).collect();
            let gelen: Vec<String> = model::tekrar_ornekleri(metin(&o, "capa"), &t, o["en_az"].as_str()).take(beklenen.len() + 1).collect();
            esit("günler", &gelen[..gelen.len().min(beklenen.len())], &beklenen[..])?;
            esit("devami", gelen.len() > beklenen.len(), mantik(&o, "devami"))
        });
    }
    b
}

fn yerel_json(y: &kural::hatirlatma::GunHatirlatmasiYereli) -> Value {
    json!({"tarih": y.tarih, "saat": y.saat})
}

/// Var olan isteğe bağlı alanları nesneye ekler (TS: alan yoksa anahtar da yok).
fn ekle(mut v: Value, ornek_tarihi: &Option<String>, gun: &Option<kural::hatirlatma::GunHatirlatmasiYereli>) -> Value {
    let n = v.as_object_mut().unwrap();
    if let Some(o) = ornek_tarihi {
        n.insert("ornek_tarihi".into(), json!(o));
    }
    if let Some(y) = gun {
        n.insert("gun_hatirlatmasi".into(), yerel_json(y));
    }
    v
}

fn hal_json(h: &kural::hatirlatma::HatirlatmaHali) -> Value {
    use kural::hatirlatma::HatirlatmaHali as H;
    match h {
        H::Kurulur { sira, tetik_ms, ornek_tarihi, gun_hatirlatmasi } => {
            ekle(json!({"sira": sira, "hal": "kurulur", "tetik_ms": tetik_ms}), ornek_tarihi, gun_hatirlatmasi)
        }
        H::Saatsiz { sira } => json!({"sira": sira, "hal": "saatsiz"}),
        H::Gecmis { sira, gun_hatirlatmasi } => ekle(json!({"sira": sira, "hal": "gecmis"}), &None, gun_hatirlatmasi),
    }
}

fn tetik_json(t: &kural::hatirlatma::HatirlatmaTetigi) -> Value {
    ekle(json!({"sira": t.sira, "tetik_ms": t.tetik_ms}), &t.ornek_tarihi, &t.gun_hatirlatmasi)
}

fn hatirlatma_plani(v: &Value) -> (Bolum, Bolum) {
    let p = &v["hatirlatma_plani"];
    let ofsetler: Vec<(String, i64)> = p["ofset_dk"].as_object().expect("ofset_dk").iter().map(|(k, o)| (k.clone(), o.as_i64().unwrap())).collect();
    let cevirici = SabitOfsetCevirici::yeni(ofsetler);
    let an: &dyn AnCevirici = &cevirici;
    let mut b = Bolum::yeni("hatirlatma_plani", "R3");
    for o in dizi(p, "vakalar") {
        b.dene(&ad(&o), || {
            let k = kayit_oku(&o["kayit"]);
            let simdi = sayi(&o, "simdi_ms");
            let haller = kural::hatirlatma::hatirlatma_halleri(&k, simdi, an).map_err(|e| e.mesaj)?;
            esit("haller", Value::Array(haller.iter().map(hal_json).collect()), o["haller"].clone())?;
            let oz = kural::hatirlatma::hatirlatma_ozeti(&k, simdi, an).map_err(|e| e.mesaj)?;
            let mut oz_j = json!({"toplam": oz.toplam, "kurulacak": oz.kurulacak, "saatsiz": oz.saatsiz, "gecmis": oz.gecmis});
            if let Some(g) = &oz.gun_hatirlatmasi {
                oz_j["gun_hatirlatmasi"] = json!({"tarih": g.tarih, "saat": g.saat, "gecti": g.gecti});
            }
            let oz = oz_j;
            esit("özet", oz, o["ozet"].clone())?;
            // `kurulacakHatirlatmalar` = etkinse `kurulur` halleri (tanım gereği).
            let beklenen: Vec<Value> = if k.hatirlatma_etkin_mi() {
                dizi(&o, "haller")
                    .into_iter()
                    .filter(|h| h["hal"] == "kurulur")
                    .map(|mut h| {
                        h.as_object_mut().unwrap().remove("hal");
                        h
                    })
                    .collect()
            } else {
                vec![]
            };
            let kurulacak = kural::hatirlatma::kurulacak_hatirlatmalar(&k, simdi, an).map_err(|e| e.mesaj)?;
            esit("kurulacak", Value::Array(kurulacak.iter().map(tetik_json).collect()), Value::Array(beklenen))
        });
    }
    let mut kb = Bolum::yeni("hatirlatma_plani.kacirilan", "R3");
    for o in dizi(p, "kacirilan") {
        kb.dene(&ad(&o), || {
            let k = kayit_oku(&o["kayit"]);
            let kurulanlar: Vec<i64> = dizi(&o, "kurulanlar").iter().map(|x| x.as_i64().unwrap()).collect();
            let r = kural::hatirlatma::kacirilan_hatirlatmalar(&k, sayi(&o, "simdi_ms"), an, &kurulanlar).map_err(|e| e.mesaj)?;
            esit("kaçırılan", Value::Array(r.iter().map(tetik_json).collect()), o["beklenen"].clone())
        });
    }
    (b, kb)
}

/// v2: `GUN_HATIRLATMA_SAATLERI`, `GUN_HATIRLATMA_VARSAYILAN_SAATI`, `gunHatirlatmasiYereli`.
fn gun_hatirlatmasi(v: &Value) -> Bolum {
    let g = &v["gun_hatirlatmasi"];
    let mut b = Bolum::yeni("gun_hatirlatmasi", "v2 (R3)");
    b.dene("saatler", || {
        let tablo: serde_json::Map<String, Value> =
            model::GunBolumu::HEPSI.iter().map(|b| (b.ad().to_string(), json!(b.hatirlatma_saati()))).collect();
        esit("saatler", Value::Object(tablo), g["saatler"].clone())
    });
    b.dene("varsayilan", || esit("varsayilan", model::GUN_HATIRLATMA_VARSAYILAN_SAATI, metin(g, "varsayilan")));
    for o in dizi(g, "vakalar") {
        b.dene(&ad(&o), || {
            let bolum = o["gun_bolumu"].as_str().map(|s| model::GunBolumu::coz(s).expect("gun_bolumu"));
            let y = kural::hatirlatma::gun_hatirlatmasi_yereli(metin(&o, "gun"), sayi(&o, "dk"), bolum).ok_or("gün geçersiz")?;
            esit("yerel", yerel_json(&y), o["beklenen"].clone())
        });
    }
    b
}

/// v2: `geceTeyidiEksikMi(girdi, mesaj_ani, tur_kokeni)`. Servis kuralıdır; uygulama aynı kuralı sınar.
/// Girdi araç şemasının (uygulamada yok) gerektirdiği kadarıyla okunur: kesinlik, mutlak hatırlatma, teyit.
fn gece_teyidi(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("gece_teyidi", "v2 (servis kuralı)");
    for o in dizi(v, "gece_teyidi") {
        b.dene(&ad(&o), || {
            let g = &o["girdi"];
            let alanlar = if metin(&o, "fiil") == "ajanda_guncelle" { &g["degisiklik"] } else { g };
            let kesinlik = alanlar["zaman"]["kesinlik"].as_str().map(|k| model::ZamanKesinligi::coz(k).expect("kesinlik"));
            let mutlak = dizi(alanlar, "hatirlatmalar").iter().any(|h| h["tur"] == "mutlak");
            let tarihli = kural::dayanak::tarihli_girdi_mi(kesinlik, mutlak);
            let teyit = !g["dayanak"]["gece_teyidi"].is_null();
            let kok = TurKokeni::coz(metin(&o, "tur_kokeni")).expect("tur_kokeni");
            let eksik = kural::dayanak::gece_teyidi_eksik_mi(tarihli, teyit, metin(&o["mesaj_ani"], "saat"), kok);
            esit("eksik", eksik, mantik(&o, "eksik"))
        });
    }
    b
}

/// `ornekler_gunluk {bas, adet, durum}`: `bas`'tan başlayan ardışık günlük satırlar.
fn ornek_kaydi(v: &Value) -> AjandaKaydi {
    let mut v = v.clone();
    let h = v.as_object_mut().unwrap();
    if let Some(g) = h.remove("ornekler_gunluk") {
        let bas = model::takvim::tarih_gun_no(metin(&g, "bas")).expect("bas");
        let satirlar: Vec<Value> = (0..sayi(&g, "adet"))
            .map(|i| json!({"tarih": model::takvim::gun_no_tarih(bas + i), "durum": g["durum"]}))
            .collect();
        h.insert("ornekler".into(), Value::Array(satirlar));
    }
    kayit_oku(&v)
}

fn ornek_durumu(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("ornek_durumu", "R1");
    for o in dizi(v, "ornek_durumu") {
        b.dene(&ad(&o), || {
            let k = ornek_kaydi(&o["kayit"]);
            let durum = KayitDurumu::coz(metin(&o, "durum")).expect("durum");
            let r = kural::ornek::ajanda_ornek_durumu_uygula(&k, metin(&o, "ornek_tarihi"), durum, metin(&o, "bugun"));
            let s = &o["sonuc"];
            match r {
                kural::ornek::OrnekDurumuSonucu::Gecersiz => {
                    esit("ok", false, mantik(s, "ok"))?;
                    esit("neden", "ornek_gecersiz", metin(s, "neden"))
                }
                kural::ornek::OrnekDurumuSonucu::Tamam { ornekler, degisti, atilan } => {
                    esit("ok", true, mantik(s, "ok"))?;
                    esit("degisti", degisti, mantik(s, "degisti"))?;
                    esit("atilan", &ornekler_json(&atilan), &s["atilan"])?;
                    if let Some(l) = s.get("ornekler") {
                        esit("ornekler", &ornekler_json(&ornekler), l)?;
                    }
                    if let Some(n) = s.get("ornek_sayisi") {
                        esit("ornek_sayisi", ornekler.len() as i64, n.as_i64().unwrap())?;
                        esit("ilk", ornekler.first().map(|o| o.tarih.as_str()), s["ilk"].as_str())?;
                        esit("son", ornekler.last().map(|o| o.tarih.as_str()), s["son"].as_str())?;
                    }
                    Ok(())
                }
            }
        });
    }
    b
}

fn kuyruk_karari(v: &Value) -> Bolum {
    use kural::kuyruk::{KuyrukKarari, KuyrukOlayi};
    let mut b = Bolum::yeni("kuyruk_karari", "R2");
    for o in dizi(v, "kuyruk_karari") {
        b.dene(&ad(&o), || {
            let ol = &o["olay"];
            let olay = match metin(ol, "olay") {
                "sonuc" if mantik(ol, "ok") => KuyrukOlayi::SonucOk,
                "sonuc" => KuyrukOlayi::SonucRet(AjandaRetNedeni::coz(metin(ol, "code")).expect("code")),
                "kopma" => KuyrukOlayi::Kopma,
                "tam_telafi" => KuyrukOlayi::TamTelafi,
                d => panic!("bilinmeyen olay {d}"),
            };
            let karar = match kural::kuyruk::ajanda_kuyruk_karari(olay, sayi(&o, "deneme") as u32) {
                KuyrukKarari::Cikar => json!({"karar": "cikar"}),
                KuyrukKarari::Bekle { deneme } => json!({"karar": "bekle", "deneme": deneme}),
                KuyrukKarari::RetListesi { neden } => json!({"karar": "ret_listesi", "neden": neden.ad()}),
            };
            esit("karar", karar, o["karar"].clone())
        });
    }
    b
}

fn kopya_kaydi(v: &Value) -> kural::esitleme::KayitIzi {
    kural::esitleme::KayitIzi { kayit_id: metin(v, "kayit_id").into(), revizyon: sayi(v, "revizyon"), guncelleme_ms: sayi(v, "guncelleme_ms") }
}

fn esitleme(v: &Value) -> Bolum {
    use kural::esitleme::{AjandaKopya, EsitlemeOlayi, KayitIzi};
    let mut b = Bolum::yeni("esitleme", "R2");
    for o in dizi(v, "esitleme") {
        b.dene(&ad(&o), || {
            let bas = &o["baslangic"];
            let mut d: AjandaKopya<KayitIzi> = AjandaKopya {
                depo_id: bas["depo_id"].as_str().map(str::to_string),
                son_rev: sayi(bas, "son_rev"),
                kayitlar: dizi(bas, "kayitlar").iter().map(|k| (metin(k, "kayit_id").to_string(), kopya_kaydi(k))).collect::<BTreeMap<_, _>>(),
                tam: None,
            };
            for ol in dizi(&o, "olaylar") {
                let olay = match metin(&ol, "olay") {
                    "welcome" => EsitlemeOlayi::Welcome { depo_id: metin(&ol, "depo_id").into(), tam: mantik(&ol, "tam") },
                    "kayit" => EsitlemeOlayi::Kayit(kopya_kaydi(&ol["kayit"])),
                    "esitlendi" => EsitlemeOlayi::Esitlendi,
                    "kopma" => EsitlemeOlayi::Kopma,
                    x => panic!("bilinmeyen olay {x}"),
                };
                d = kural::esitleme::ajanda_esitleme_adimi(&d, olay);
            }
            let bek = &o["beklenen"];
            esit("depo_id", d.depo_id.as_deref(), bek["depo_id"].as_str())?;
            esit("son_rev", d.son_rev, sayi(bek, "son_rev"))?;
            let kayitlar: Vec<Value> = d
                .kayitlar
                .values()
                .map(|k| json!({"kayit_id": k.kayit_id, "revizyon": k.revizyon, "guncelleme_ms": k.guncelleme_ms}))
                .collect();
            esit("kayitlar", Value::Array(kayitlar), bek["kayitlar"].clone())?;
            esit("tam_suruyor", d.tam.is_some(), mantik(bek, "tam_suruyor"))?;
            let h = kural::esitleme::ajanda_hello_alanlari(&d);
            let bh = &bek["hello"];
            esit("hello.son_rev", h.son_rev, sayi(bh, "son_rev"))?;
            esit("hello.depo_id", h.depo_id.as_deref(), bh["depo_id"].as_str())?;
            esit("hello.son_rev_izi", h.son_rev_izi, iz_oku(&bh["son_rev_izi"]))
        });
    }
    b
}

fn main() {
    // `Yazilmadi` paniklerini sessiz geç (BEKLİYOR sayılır); ötekiler her zamanki gibi yazılsın.
    let onceki = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |bilgi| {
        if bilgi.payload().downcast_ref::<Yazilmadi>().is_none() {
            onceki(bilgi);
        }
    }));

    println!("vektör dizini: {}", vektor_dizini().display());
    let mesaj = dosya_oku("ajanda-mesaj.json");
    let mesaj_v3 = dosya_oku("ajanda-mesaj-v3.json");
    let kurallar = dosya_oku("ajanda-kurallar.json");
    let surum = dosya_oku("ajanda-surum.json");
    let v3 = dosya_oku("ajanda-v3.json");

    let mut bolumler = vec![
        mesaj_bolumu(&mesaj, "mesaj", "asagi"),
        mesaj_bolumu(&mesaj, "mesaj", "yukari"),
        mesaj_bolumu(&mesaj_v3, "mesaj_v3", "asagi"),
        mesaj_bolumu(&mesaj_v3, "mesaj_v3", "yukari"),
    ];
    bolumler.extend([surum_sabitleri(&surum), surum_cozum(&surum), ret_surumu(&surum), geri_dusus(&surum), donmus_hata(&surum)]);
    bolumler.extend([
        v3_sabitleri(&v3),
        bolge_anahtari(&v3),
        url(&v3),
        tekil_anahtar(&v3, "v3.tekil_anahtar"),
        birlestirme_bolumu(&v3, "bolge_konumu", "v3.bolge_konumu", "v3 (R2)"),
        yetenek_kesisimi(&v3),
        asagi_uyarlama(&v3),
    ]);
    bolumler.extend([
        imza_metni(&kurallar),
        imza(&kurallar),
        kapsam(&kurallar),
        qr(&kurallar),
        birlestirme(&kurallar),
        hatirlatma_etkin(&kurallar),
        tekil_anahtar(&kurallar, "tekil_anahtar"),
        es_degisikligi(&kurallar),
    ]);
    let (g, gt) = gorunmez(&kurallar);
    bolumler.extend([g, gt, tekil_karar(&kurallar), telafi(&kurallar), dayanak(&kurallar), tekrar_ornekleri(&kurallar)]);
    let (hp, hk) = hatirlatma_plani(&kurallar);
    bolumler.extend([hp, hk, ornek_durumu(&kurallar), kuyruk_karari(&kurallar), esitleme(&kurallar)]);
    bolumler.extend([gun_hatirlatmasi(&kurallar), gece_teyidi(&kurallar)]);

    // Dosyada düzeneğin tanımadığı bölüm kalmasın (sözleşmeye eklenen bölüm sessizce atlanmasın).
    let bilinen_mesaj = ["aciklama", "surum", "asagi", "yukari"];
    let bilinen_kural = [
        "aciklama", "surum", "imza_metni", "imza", "kapsam", "qr", "birlestirme", "hatirlatma_etkin", "tekil_anahtar",
        "es_degisikligi", "gorunmez", "tekil_karar", "telafi", "dayanak", "tekrar_ornekleri", "hatirlatma_plani",
        "ornek_durumu", "kuyruk_karari", "esitleme", "gun_hatirlatmasi", "gece_teyidi",
    ];
    let bilinen_surum = ["aciklama", "surumler", "qr_surumu", "cozum", "ret_surumu", "geri_dusus", "donmus_hata"];
    let bilinen_v3 = [
        "aciklama", "surum", "sinirlar", "simgeler", "yetenekler", "ek_ret_kodlari", "bolge_anahtari", "url",
        "tekil_anahtar", "bolge_konumu", "yetenek_kesisimi", "asagi_uyarlama",
    ];
    let mut tanimsiz: Vec<String> = Vec::new();
    for (dosya, bilinen, ad) in [
        (&mesaj, &bilinen_mesaj[..], "ajanda-mesaj.json"),
        (&mesaj_v3, &bilinen_mesaj[..], "ajanda-mesaj-v3.json"),
        (&kurallar, &bilinen_kural[..], "ajanda-kurallar.json"),
        (&surum, &bilinen_surum[..], "ajanda-surum.json"),
        (&v3, &bilinen_v3[..], "ajanda-v3.json"),
    ] {
        for k in dosya.as_object().expect("vektör dosyası nesne").keys() {
            if !bilinen.contains(&k.as_str()) {
                tanimsiz.push(format!("{ad}: {k}"));
            }
        }
    }
    // Dosya başına sürüm: her dosya desteklenen bir sürümdedir; mesaj dosyaları o sürümün bağlantısında okunur
    // (v2 dosyası v2'de, v3 dosyası v3'te), v3 kural dosyası v3'tür.
    for (ad, dosya, beklenen) in [
        ("ajanda-mesaj.json", &mesaj, None),
        ("ajanda-mesaj-v3.json", &mesaj_v3, Some(Surum::V3)),
        ("ajanda-kurallar.json", &kurallar, None),
        ("ajanda-v3.json", &v3, Some(Surum::V3)),
    ] {
        match dosya_surumu(dosya) {
            Some(s) if beklenen.is_none_or(|b| b == s) => {}
            _ => tanimsiz.push(format!("{ad}: surum {} (düzenek {:?})", dosya["surum"], model::AJANDA_SURUMLERI)),
        }
    }

    println!();
    println!("{:<28} {:>6} {:>6} {:>8}  sahip / bekleyen parça", "bölüm", "geçti", "kaldı", "bekliyor");
    let (mut tg, mut tk, mut tb, mut td) = (0, 0, 0, 0);
    for b in &bolumler {
        let not = match (&b.devredildi, b.bekleyen_parca) {
            (Some((n, neden)), _) => {
                td += n;
                format!("{} — DEVREDİLDİ {n}: {neden}", b.sahip)
            }
            (None, Some(p)) => format!("{} — {p}", b.sahip),
            (None, None) => b.sahip.to_string(),
        };
        println!("{:<28} {:>6} {:>6} {:>8}  {not}", b.ad, b.gecti, b.kaldi.len(), b.bekliyor);
        tg += b.gecti;
        tk += b.kaldi.len();
        tb += b.bekliyor;
    }
    println!("{:<28} {:>6} {:>6} {:>8}  (devredilen {td})", "TOPLAM", tg, tk, tb);

    for b in &bolumler {
        for k in &b.kaldi {
            println!("KALDI {}: {k}", b.ad);
        }
    }
    for t in &tanimsiz {
        println!("TANIMSIZ BÖLÜM {t}");
    }
    if tk > 0 || !tanimsiz.is_empty() {
        std::process::exit(1);
    }
    println!("\nvektörler: {tg} geçti, {tb} bekliyor, {td} Kotlin'e devredildi, 0 kaldı");
}
