//! R4 motor testleri (iç durum gerektirenler). Uçtan uca senaryolar `tests/uctan_uca.rs`'tedir.
//!
//! - `esitleme` vektörleri SQLite uygulamasına karşı (`kural::esitleme` bellek modeliyle aynı anlam).
//! - Kuyruğun başındaki çözülemeyen (bozuk) satır yollanmaz, ret listesine geçer, arkasını tıkamaz.
//! - Telafi tamponu: binlerce kayıt sayfa sayfa yazılır, `son_rev` yalnız yazılanla ilerler.

use super::*;
use crate::depo::anahtar;
use crate::kopru::sahte::{SahteKimlik, SahteZaman};
use crate::model::kanonik::{base64_yaz, base64url_yaz};
use crate::model::{
    AjandaAsagi, AjandaKaydi, AjandaYukari, ImzaRolu, KuyrukRetNedeni, ajanda_kimlik_imza_metni, ajanda_yukari_coz,
};
use serde_json::{Value, json};

const SIMDI: i64 = 1_795_606_200_000;

struct Duzen {
    m: Motor,
    kimlik: SahteKimlik,
    zaman: SahteZaman,
}

impl Duzen {
    fn yeni() -> Self {
        let m = Motor::ac(":memory:").unwrap();
        let e = json!({"device_id": "c_t", "host": "100.64.0.1", "port": 8787, "server_public_key": base64_yaz(&[9; 4])});
        m.depo.meta_yaz(anahtar::ESLESME, Some(&e.to_string())).unwrap();
        // Eşleşmiş kurulum bağlı kiptedir (göç 4 eşleşmesiz yeni veritabanını yerel sınıflar).
        m.depo.kip_yaz(false).unwrap();
        Duzen { m, kimlik: SahteKimlik::default(), zaman: SahteZaman::yeni(SIMDI) }
    }

    fn calistir<T>(&mut self, f: impl FnOnce(&mut Motor, &Ortam, &mut Etkiler) -> T) -> (T, Etkiler) {
        let o = Ortam { kimlik: &self.kimlik, zaman: &self.zaman };
        let mut e = Etkiler::default();
        let t = f(&mut self.m, &o, &mut e);
        (t, e)
    }

    fn cerceve(&mut self, m: AjandaAsagi) -> Etkiler {
        let metin = m.kodla();
        let (r, e) = self.calistir(|m, o, e| m.cerceve_geldi(o, e, &metin));
        r.unwrap();
        e
    }

    /// Bağlanır, kimliği doğrular; `welcome` bekleyen aşamada bırakır.
    fn el_sikis(&mut self) {
        let (r, e) = self.calistir(|m, o, e| m.baglanti_acildi(o, e));
        r.unwrap();
        let AjandaYukari::Hello { client_nonce, .. } = ajanda_yukari_coz(&e.gonderilecek[0]).unwrap() else { panic!("hello") };
        let server_nonce = base64_yaz(&[3; 32]);
        let mut imza = ajanda_kimlik_imza_metni(ImzaRolu::Pc, "c_t", &client_nonce, &server_nonce).into_bytes();
        imza.reverse();
        let e = self.cerceve(AjandaAsagi::AuthChallenge { server_nonce, server_signature: base64_yaz(&imza) });
        assert!(matches!(ajanda_yukari_coz(&e.gonderilecek[0]), Ok(AjandaYukari::AuthResponse { .. })));
    }

    fn bagli_mi(&self) -> bool {
        !matches!(self.m.asama, Asama::Kopuk | Asama::Kapaniyor)
    }

    fn kopar(&mut self) {
        let (r, _) = self.calistir(|m, o, e| m.baglanti_kapandi(o, e, None));
        r.unwrap();
    }
}

fn kayit(kayit_id: &str, revizyon: i64, guncelleme_ms: i64) -> AjandaKaydi {
    let v = json!({
        "kayit_id": kayit_id, "revizyon": revizyon, "tur": "gorev", "baslik": "x", "hatirlatmalar": [],
        "ornekler": [], "durum": "acik", "taslak": false, "silindi": false, "elle_alanlar": [],
        "kaynak": {"yol": "sohbet_araci", "tur_kokeni": "insan", "sohbet_id": "ana"},
        "olusturma_ms": 0, "guncelleme_ms": guncelleme_ms
    });
    AjandaKaydi::oku(&v, "").unwrap()
}

fn iz_kaydi(v: &Value) -> AjandaKaydi {
    kayit(v["kayit_id"].as_str().unwrap(), v["revizyon"].as_i64().unwrap(), v["guncelleme_ms"].as_i64().unwrap())
}

/// `esitleme` vektörleri SQLite'a karşı: olaylar gerçek çerçevelerle sürülür. Bağlantı başına bir
/// `welcome` olduğundan, bağlıyken gelen `welcome` olayı "kopma + yeni bağlantı" olarak sürülür (bellek
/// modelinde de süren tam telafiyi atar); canlıyken gelen `esitlendi` (bellek modelinde değişiklik yok)
/// sürülmez. Karşılaştırmadan önce tampondaki `kayit`'ler yazılır (bellek modeli her çerçeveyi hemen
/// uygular; motor `TELAFI_TAMPONU`'luk işlemlerle).
#[test]
fn esitleme_vektorleri_sqlite_uygulamasinda() {
    let yol = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../phone/protocol/vektorler/ajanda-kurallar.json");
    let kurallar: Value = serde_json::from_str(&std::fs::read_to_string(yol).unwrap()).unwrap();
    let vektorler = kurallar["esitleme"].as_array().unwrap();
    assert!(!vektorler.is_empty());
    for v in vektorler {
        let ad = v["ad"].as_str().unwrap();
        let mut d = Duzen::yeni();
        let bas = &v["baslangic"];
        d.m.depo
            .yazma(|depo| {
                if let Some(id) = bas["depo_id"].as_str() {
                    depo.depo_id_yaz(id)?;
                }
                depo.son_rev_yaz(bas["son_rev"].as_i64().unwrap())?;
                for k in bas["kayitlar"].as_array().unwrap() {
                    depo.kopya_kaydi_uygula(crate::depo::KopyaTablosu::Sunucu, &iz_kaydi(k))?;
                }
                Ok(())
            })
            .unwrap();
        for ol in v["olaylar"].as_array().unwrap() {
            match ol["olay"].as_str().unwrap() {
                "welcome" => {
                    if d.bagli_mi() {
                        d.kopar();
                    }
                    d.el_sikis();
                    d.cerceve(AjandaAsagi::Welcome {
                        depo_id: ol["depo_id"].as_str().unwrap().into(),
                        bas_rev: 1_000,
                        tam: ol["tam"].as_bool().unwrap(),
                        server_time_ms: SIMDI,
                    });
                }
                "kayit" => {
                    d.cerceve(AjandaAsagi::Kayit { kayit: iz_kaydi(&ol["kayit"]) });
                }
                "esitlendi" => {
                    if matches!(d.m.asama, Asama::Telafi(_)) {
                        d.cerceve(AjandaAsagi::Esitlendi { rev: 1_000 });
                    }
                }
                "kopma" => {
                    if d.bagli_mi() {
                        d.kopar();
                    }
                }
                x => panic!("{ad}: bilinmeyen olay {x}"),
            }
        }
        let tam_suruyor = d.m.tam_telafi_suruyor();
        let (r, _) = d.calistir(|m, o, e| m.telafi_tamponunu_yaz(o, e));
        r.unwrap();
        let bek = &v["beklenen"];
        assert_eq!(d.m.depo.depo_id().unwrap().as_deref(), bek["depo_id"].as_str(), "{ad}: depo_id");
        assert_eq!(d.m.depo.son_rev().unwrap(), bek["son_rev"].as_i64().unwrap(), "{ad}: son_rev");
        let kayitlar: Vec<Value> = d
            .m
            .depo
            .sunucu_kayitlari()
            .unwrap()
            .iter()
            .map(|k| json!({"kayit_id": k.kayit_id, "revizyon": k.revizyon, "guncelleme_ms": k.guncelleme_ms}))
            .collect();
        assert_eq!(Value::Array(kayitlar), bek["kayitlar"], "{ad}: kayıtlar");
        assert_eq!(tam_suruyor, bek["tam_suruyor"].as_bool().unwrap(), "{ad}: tam_suruyor");
        let h = d.m.depo.hello_alanlari().unwrap();
        let bh = &bek["hello"];
        assert_eq!(h.son_rev, bh["son_rev"].as_i64().unwrap(), "{ad}: hello.son_rev");
        assert_eq!(h.depo_id.as_deref(), bh["depo_id"].as_str(), "{ad}: hello.depo_id");
        let iz = h.son_rev_izi.map(|i| json!({"kayit_id": i.kayit_id, "guncelleme_ms": i.guncelleme_ms})).unwrap_or(Value::Null);
        assert_eq!(iz, bh["son_rev_izi"], "{ad}: hello.son_rev_izi");
    }
}

#[test]
fn bozuk_kuyruk_satiri_yollanmaz_ret_listesine_gecer_arkasi_gider() {
    let mut d = Duzen::yeni();
    let govde = |b: &str| crate::model::KayitGovdesi {
        tur: crate::model::KayitTuru::Gorev,
        baslik: b.into(),
        aciklama: None,
        zaman: None,
        hatirlatmalar: vec![],
        tekrar: None,
    };
    let (a, _) = d.calistir(|m, o, e| m.ekle(o, e, govde("bozulacak"), crate::model::GirdiYolu::Elle));
    let (b, _) = d.calistir(|m, o, e| m.ekle(o, e, govde("sağlam"), crate::model::GirdiYolu::Elle));
    let (a, b) = (a.unwrap(), b.unwrap());
    let ilk = d.m.depo.kuyruk().unwrap()[0].sira;
    d.m.depo.kuyruk_islemini_boz(ilk, "{bozuk").unwrap();
    d.el_sikis();
    d.cerceve(AjandaAsagi::Welcome { depo_id: "d_a".into(), bas_rev: 0, tam: true, server_time_ms: SIMDI });
    let e = d.cerceve(AjandaAsagi::Esitlendi { rev: 0 });
    // Bozuk satır ret listesinde; yollanan tek işlem sağlam olanın.
    assert_eq!(e.gonderilecek.len(), 1);
    let AjandaYukari::Islem { islem, .. } = ajanda_yukari_coz(&e.gonderilecek[0]).unwrap() else { panic!() };
    assert_eq!(islem.kayit_id(), b);
    let ret = sorgu::ret_listesi(&d.m.depo).unwrap();
    assert_eq!(ret.len(), 1);
    assert_eq!((ret[0].kayit_id.as_str(), ret[0].neden), (a.as_str(), KuyrukRetNedeni::GecersizIslem));
    assert!(e.degisim.ret_listesi && e.degisim.tumu);
    // Bozuk satırın iyimser hali hiç uygulanmamıştı; tam telafi sonrası görünen kopyada yok.
    assert_eq!(sorgu::kayit(&d.m.depo, &a).unwrap(), None);
    assert!(sorgu::kayit(&d.m.depo, &b).unwrap().unwrap().bekleyen);
}

/// Binlerce kayıtlık telafi `TELAFI_TAMPONU`'luk işlemlerle yazılır; kopmada tampondaki yazılır, `son_rev`
/// yalnız yazılanla ilerler (kesilen artımlı telafi kaldığı yerden sürer).
#[test]
fn artimli_telafi_tamponlu_yazilir_kopmada_ilerleme_kalir() {
    let mut d = Duzen::yeni();
    d.el_sikis();
    d.cerceve(AjandaAsagi::Welcome { depo_id: "d_a".into(), bas_rev: 450, tam: false, server_time_ms: SIMDI });
    for rev in 1..=450 {
        let id = format!("k_{}", base64url_yaz(&(rev as u32).to_be_bytes()));
        let e = d.cerceve(AjandaAsagi::Kayit { kayit: kayit(&id, rev, rev) });
        let yazilan = (rev as usize / TELAFI_TAMPONU) * TELAFI_TAMPONU;
        assert_eq!(d.m.depo.son_rev().unwrap(), yazilan as i64, "tampon dolunca yazılır");
        assert_eq!(e.degisim.kayitlar.len(), if (rev as usize).is_multiple_of(TELAFI_TAMPONU) { TELAFI_TAMPONU } else { 0 });
    }
    d.kopar();
    assert_eq!(d.m.depo.son_rev().unwrap(), 450, "kopmada tampon yazıldı");
    assert_eq!(d.m.depo.sunucu_kaydi_sayisi().unwrap(), 450);
}

/// Yerel kipte bağlanma (eşleşme kayıtlı, kip yerel): `hello` boş kopya gibi gider; servis artımlı dese de
/// telafi toplanır ve `esitlendi`'ye dek görünen kopya, PC temeli (`sunucu_kayitlari`, `depo_id`, `son_rev`)
/// ve alarmlar değişmez. `esitlendi`'de tek işlemde yerel kayıtlar fark olarak kuyruğa dökülür, kip bağlı
/// olur, kuyruk yollanmaya başlar.
#[test]
fn yerel_kipte_baglanma_temeli_korur_esitlendide_doker() {
    let mut d = Duzen::yeni();
    d.m.depo.kip_yaz(true).unwrap();
    let yerel = kayit("k_yerel", 3, 3);
    let temel = kayit("k_ortak", 2, 2);
    let ortak = AjandaKaydi { baslik: "telefonda".into(), revizyon: 3, ..temel.clone() };
    d.m.depo
        .yazma(|depo| {
            depo.gorunen_yaz(&yerel, false)?;
            depo.gorunen_yaz(&ortak, false)?;
            depo.kopya_kaydi_uygula(crate::depo::KopyaTablosu::Sunucu, &temel)?;
            depo.depo_id_yaz("d_a")?;
            depo.son_rev_yaz(2)?;
            Ok(())
        })
        .unwrap();
    let (r, e) = d.calistir(|m, o, e| m.baglanti_acildi(o, e));
    r.unwrap();
    let Ok(AjandaYukari::Hello { son_rev, depo_id, son_rev_izi, .. }) = ajanda_yukari_coz(&e.gonderilecek[0]) else { panic!("hello") };
    assert_eq!((son_rev, depo_id, son_rev_izi), (0, None, None), "yerel kipte boş kopya gibi");
    d.kopar();
    d.el_sikis();
    // Servis artımlı dese de toplanır: temel ezilmez.
    d.cerceve(AjandaAsagi::Welcome { depo_id: "d_a".into(), bas_rev: 5, tam: false, server_time_ms: SIMDI });
    let pc_ortak = AjandaKaydi { aciklama: Some("PC'de".into()), ..kayit("k_ortak", 4, 4) };
    for k in [pc_ortak.clone(), kayit("k_pc", 5, 5)] {
        let e = d.cerceve(AjandaAsagi::Kayit { kayit: k });
        assert!(e.degisim.bos_mu() && e.alarm_kur.is_empty());
    }
    d.m.telafi_tamponunu_yaz(&Ortam { kimlik: &d.kimlik, zaman: &d.zaman }, &mut Etkiler::default()).unwrap();
    assert!(d.m.tam_telafi_suruyor());
    assert_eq!(d.m.depo.sunucu_kayitlari().unwrap(), vec![temel.clone()], "temel koparma anındaki gibi");
    assert_eq!((d.m.depo.son_rev().unwrap(), d.m.depo.depo_id().unwrap().as_deref()), (2, Some("d_a")));
    assert!(d.m.yerel_mi().unwrap());
    assert!(d.m.depo.kuyruk().unwrap().is_empty());
    assert_eq!(d.m.depo.gorunen_kayit("k_ortak").unwrap().unwrap().kayit, ortak);

    // D4: gidecek değişiklik var, önce onay beklenir (telafi aşaması, kip yerel, hiçbir şey dökülmedi).
    let e = d.cerceve(AjandaAsagi::Esitlendi { rev: 5 });
    assert!(e.degisim.baglanti && !e.degisim.tumu && e.gonderilecek.is_empty());
    assert!(d.m.tam_telafi_suruyor() && d.m.yerel_mi().unwrap() && d.m.depo.kuyruk().unwrap().is_empty());
    // İzsiz onay hiçbir şey yazmaz, şimdiki planı verir; onun iziyle uygulanır.
    let (r, _) = d.calistir(|m, o, e| m.birlestirmeyi_onayla(o, e, None));
    let r = r.unwrap();
    assert!(!r.uygulandi && !r.zaten_uygulandi && d.m.yerel_mi().unwrap() && d.m.depo.kuyruk().unwrap().is_empty());
    let iz = r.plan.expect("şimdiki plan").iz;
    let (r, e) = d.calistir(|m, o, e| m.birlestirmeyi_onayla(o, e, Some(&iz)));
    assert!(r.unwrap().uygulandi);
    assert!(d.m.canli_mi() && !d.m.yerel_mi().unwrap());
    assert!(e.degisim.tumu && e.degisim.baglanti);
    assert_eq!((d.m.depo.son_rev().unwrap(), d.m.depo.depo_id().unwrap().as_deref()), (5, Some("d_a")));
    assert_eq!(d.m.depo.sunucu_kayitlari().unwrap().len(), 2, "temel servisin kopyası oldu");
    let kuyruk: Vec<Value> = d.m.depo.kuyruk().unwrap().iter().map(|s| serde_json::from_str(&s.islem_json).unwrap()).collect();
    // Aynı depo: `k_ortak`'ın farkı eski temele göre (yalnız başlık; PC'nin açıklaması kalır); `k_yerel` ekle.
    assert_eq!(kuyruk.len(), 2);
    assert_eq!((kuyruk[1]["islem"].as_str(), kuyruk[1]["kayit_id"].as_str()), (Some("ekle"), Some("k_yerel")));
    assert_eq!(kuyruk[0], json!({"islem": "guncelle", "kayit_id": "k_ortak", "temel_revizyon": 2, "degisiklik": {"baslik": "telefonda"}}));
    let g = d.m.depo.gorunen_kayit("k_ortak").unwrap().unwrap();
    assert!(g.bekleyen);
    assert_eq!((g.kayit.baslik.as_str(), g.kayit.aciklama.as_deref()), ("telefonda", Some("PC'de")));
    assert_eq!(d.m.depo.gorunen_kayit("k_yerel").unwrap().unwrap().kayit.baslik, "x");
    assert!(d.m.depo.gorunen_kayit("k_pc").unwrap().is_some(), "PC'de olan eklendi");
    // Kuyruğun başı yollandı.
    assert!(matches!(ajanda_yukari_coz(&e.gonderilecek[0]), Ok(AjandaYukari::Islem { .. })));
}
