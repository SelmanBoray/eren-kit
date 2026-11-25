//! Dil bağımsız vektör düzeneği (`harness = false`): `apps/phone/protocol/vektorler/` altındaki
//! `ajanda-mesaj.json` ve `ajanda-kurallar.json`'ın HER bölümünü Rust uygulamasına karşı çalıştırır.
//! Dosyalar kopyalanmaz; yol `AJANDA_VEKTOR_DIZINI` ile değiştirilebilir.
//!
//! Her vektör: GEÇTİ, KALDI (fark yazılır) ya da BEKLİYOR (kural `Yazilmadi` paniğiyle duruyor). Bölüm
//! tablosu her koşuda basılır; KALDI varsa ya da vektör dosyasında düzeneğin tanımadığı bir bölüm
//! varsa çıkış kodu 1'dir. BEKLİYOR başarısızlık değildir ama sayısı görünür ve kimin işi olduğu yazar.
//! Bu dosya ilk dalgada dondurulur: ikinci dalga yalnız kuralları doldurur, düzeneğe dokunmaz.

use ajanda_cekirdek::kural::{self, AnCevirici, SabitOfsetCevirici, Yazilmadi};
use ajanda_cekirdek::model::{
    self, AjandaEslestirmeQr, AjandaKaydi, AjandaOrnegi, AjandaRetNedeni, AjandaZamani, AlanDegisikligi, Hatirlatma,
    ImzaRolu, KayitDurumu, KayitTuru, KaynakYolu, Tekrar, TurKokeni, YazarKimligi, YerelAn,
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

fn mesaj_bolumu(dosya: &Value, yon: &str) -> Bolum {
    let mut b = Bolum::yeni(&format!("mesaj.{yon}"), "ilk dalga (model)");
    for v in dizi(dosya, yon) {
        let ham = metin(&v, "ham").to_string();
        b.dene(&ad(&v), || {
            let gecerli = mantik(&v, "gecerli");
            let (tur, kodla, hata) = if yon == "asagi" {
                match model::ajanda_asagi_coz(&ham) {
                    Ok(m) => (Some(m.tur()), Some(m.json()), None),
                    Err(h) => (None, None, Some(h)),
                }
            } else {
                match model::ajanda_yukari_coz(&ham) {
                    Ok(m) => (Some(m.tur()), Some(m.json()), None),
                    Err(h) => (None, None, Some(h)),
                }
            };
            if gecerli {
                if let Some(h) = hata {
                    return Err(format!("reddedildi: {} {:?}", h.kod.ad(), h.yollar));
                }
                esit("tür", tur, v["tur"].as_str())?;
                // Kodlayıcı eşliği: yeniden kodlanan değer gelen değerle aynı JSON.
                let gelen: Value = serde_json::from_str(&ham).expect("geçerli vektör JSON");
                esit("yeniden kodlama", kodla, Some(gelen))
            } else {
                let Some(h) = hata else { return Err(format!("kabul edildi (tür {tur:?})")) };
                esit("kod", h.kod.ad(), metin(&v, "kod"))?;
                esit("islem_id", h.islem_id.as_deref(), v["islem_id"].as_str())
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

fn birlestirme(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("birlestirme", "R2");
    for o in dizi(v, "birlestirme") {
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
            if let Some(h) = bek.get("hatirlatmalar") {
                esit("hatirlatmalar", &model::zaman::hatirlatmalari_yaz(&r.kayit.hatirlatmalar), h)?;
            }
            let sonuc = r.kayit.json();
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

fn tekil_anahtar(v: &Value) -> Bolum {
    let mut b = Bolum::yeni("tekil_anahtar", "R2");
    for o in dizi(v, "tekil_anahtar") {
        b.dene(&ad(&o), || {
            let g = &o["girdi"];
            let zaman = zaman_oku(&g["zaman"]);
            let tur = KayitTuru::coz(metin(g, "tur")).expect("tur");
            let a = kural::tekil::ajanda_tekil_anahtari(metin(g, "kapsam"), tur, metin(g, "baslik"), zaman.as_ref());
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

fn hal_json(h: &kural::hatirlatma::HatirlatmaHali) -> Value {
    use kural::hatirlatma::HatirlatmaHali as H;
    match h {
        H::Kurulur { sira, tetik_ms, ornek_tarihi: None } => json!({"sira": sira, "hal": "kurulur", "tetik_ms": tetik_ms}),
        H::Kurulur { sira, tetik_ms, ornek_tarihi: Some(o) } => {
            json!({"sira": sira, "hal": "kurulur", "tetik_ms": tetik_ms, "ornek_tarihi": o})
        }
        H::Saatsiz { sira } => json!({"sira": sira, "hal": "saatsiz"}),
        H::Gecmis { sira } => json!({"sira": sira, "hal": "gecmis"}),
    }
}

fn tetik_json(t: &kural::hatirlatma::HatirlatmaTetigi) -> Value {
    match &t.ornek_tarihi {
        None => json!({"sira": t.sira, "tetik_ms": t.tetik_ms}),
        Some(o) => json!({"sira": t.sira, "tetik_ms": t.tetik_ms, "ornek_tarihi": o}),
    }
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
            let oz = json!({"toplam": oz.toplam, "kurulacak": oz.kurulacak, "saatsiz": oz.saatsiz, "gecmis": oz.gecmis});
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
    let kurallar = dosya_oku("ajanda-kurallar.json");

    let mut bolumler = vec![mesaj_bolumu(&mesaj, "asagi"), mesaj_bolumu(&mesaj, "yukari")];
    bolumler.extend([
        imza_metni(&kurallar),
        imza(&kurallar),
        kapsam(&kurallar),
        qr(&kurallar),
        birlestirme(&kurallar),
        hatirlatma_etkin(&kurallar),
        tekil_anahtar(&kurallar),
        es_degisikligi(&kurallar),
    ]);
    let (g, gt) = gorunmez(&kurallar);
    bolumler.extend([g, gt, tekil_karar(&kurallar), telafi(&kurallar), dayanak(&kurallar), tekrar_ornekleri(&kurallar)]);
    let (hp, hk) = hatirlatma_plani(&kurallar);
    bolumler.extend([hp, hk, ornek_durumu(&kurallar), kuyruk_karari(&kurallar), esitleme(&kurallar)]);

    // Dosyada düzeneğin tanımadığı bölüm kalmasın (sözleşmeye eklenen bölüm sessizce atlanmasın).
    let bilinen_mesaj = ["surum", "asagi", "yukari"];
    let bilinen_kural = [
        "aciklama", "surum", "imza_metni", "imza", "kapsam", "qr", "birlestirme", "hatirlatma_etkin", "tekil_anahtar",
        "es_degisikligi", "gorunmez", "tekil_karar", "telafi", "dayanak", "tekrar_ornekleri", "hatirlatma_plani",
        "ornek_durumu", "kuyruk_karari", "esitleme",
    ];
    let mut tanimsiz: Vec<String> = Vec::new();
    for (dosya, bilinen, ad) in [(&mesaj, &bilinen_mesaj[..], "ajanda-mesaj.json"), (&kurallar, &bilinen_kural[..], "ajanda-kurallar.json")] {
        for k in dosya.as_object().expect("vektör dosyası nesne").keys() {
            if !bilinen.contains(&k.as_str()) {
                tanimsiz.push(format!("{ad}: {k}"));
            }
        }
    }
    for (ad, surum) in [("ajanda-mesaj.json", &mesaj["surum"]), ("ajanda-kurallar.json", &kurallar["surum"])] {
        if surum.as_i64() != Some(model::sinirlar::AJANDA_SURUMU) {
            tanimsiz.push(format!("{ad}: surum {surum} (düzenek {})", model::sinirlar::AJANDA_SURUMU));
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
    println!("\nvektörler: {tg} geçti, {tb} bekliyor (ikinci dalga), {td} Kotlin'e devredildi, 0 kaldı");
}
