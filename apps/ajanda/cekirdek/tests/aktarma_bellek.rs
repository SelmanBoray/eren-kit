//! D3 bellek iddiası, ayırma ölçüsüyle: içe aktarma önizlemesi belgeyi ağaca çevirmez (tepe ayırma belge
//! metninin küçük bir kesridir), uygulama yazılacakları biriktirmez (tepe: alarm senkronu + önizlemenin payı),
//! kayıtlar dışındaki dev değer ve dev kök anahtarı kopyalanmadan reddedilir, dışa aktarma belgeyi ağaçsız
//! yazar (tepe: satırlar + belge). Süre ölçüsü (`aktarma_guveni.rs` dev dizi) yerine Rust ayırıcısının kendisi sayılır. SQLite'ın
//! kendi ayırmaları sayılmaz (C ayırıcısı); ölçülen ağaçlar Rust'tadır.
//!
//! Sayaç süreç genelidir: bu dosyada tek test vardır (paralel test ölçüyü bozmasın).

mod ortak;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use ajanda_cekirdek::model::GirdiYolu;
use ortak::*;
use serde_json::{Value, json};

struct Sayac;

static SIMDIKI: AtomicUsize = AtomicUsize::new(0);
static TEPE: AtomicUsize = AtomicUsize::new(0);

fn artir(n: usize) {
    let s = SIMDIKI.fetch_add(n, Ordering::SeqCst) + n;
    TEPE.fetch_max(s, Ordering::SeqCst);
}

unsafe impl GlobalAlloc for Sayac {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(l) };
        if !p.is_null() {
            artir(l.size());
        }
        p
    }

    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) };
        SIMDIKI.fetch_sub(l.size(), Ordering::SeqCst);
    }

    unsafe fn realloc(&self, p: *mut u8, l: Layout, yeni: usize) -> *mut u8 {
        let q = unsafe { System.realloc(p, l, yeni) };
        if !q.is_null() {
            if yeni >= l.size() {
                artir(yeni - l.size());
            } else {
                SIMDIKI.fetch_sub(l.size() - yeni, Ordering::SeqCst);
            }
        }
        q
    }
}

#[global_allocator]
static AYIRICI: Sayac = Sayac;

/// `f` sürerken başlangıcın üstüne çıkılan en yüksek ayırma (bayt).
fn tepe<T>(f: impl FnOnce() -> T) -> (T, usize) {
    let bas = SIMDIKI.load(Ordering::SeqCst);
    TEPE.store(bas, Ordering::SeqCst);
    let r = f();
    (r, TEPE.load(Ordering::SeqCst).saturating_sub(bas))
}

#[test]
fn aktarma_belgeyi_agaca_cevirmez() {
    let a = Hat::yeni("bellek-a");
    a.c.ekle(govde("Örnek", Some(an("2026-11-26", "10:00"))), GirdiYolu::Elle).unwrap();
    let mut v: Value = serde_json::from_str(&a.c.disa_aktar().unwrap().belge).unwrap();
    let ornek = v["kayitlar"][0].clone();
    let adet = 20_000;
    v["kayitlar"] = json!(
        (0..adet)
            .map(|i| {
                let mut k = ornek.clone();
                k["kayit_id"] = json!(format!("k_{i:05}"));
                k["aciklama"] = json!("açıklama ".repeat(20));
                k
            })
            .collect::<Vec<_>>()
    );
    let belge = v.to_string();
    drop(v);
    // Karşılaştırma: aynı belgenin bütün ağacı.
    let (agac, agac_tepe) = tepe(|| serde_json::from_str::<Value>(&belge).unwrap());
    drop(agac);

    let b = Hat::yeni("bellek-b");
    let girdi = belge.clone();
    let (on, on_tepe) = tepe(move || b.c.ice_aktarma_onizlemesi(girdi).unwrap());
    assert_eq!(on.yeni, adet);
    // Ağaç kurulsaydı tepe belgenin birkaç katı olurdu (ölçü: ~6,9 kat).
    assert!(agac_tepe > 2 * belge.len(), "ağaç {agac_tepe}, belge {}", belge.len());
    // Önizleme kayıtları tutmaz (`PlanKullanimi::Onizleme`); kalan, kayıt başına sabit bir paydır, kaydın
    // içeriğinden bağımsız: öğe aralığı (16 bayt; `Vec` büyürken eski ve yeni tampon birlikte, ~40) ve
    // görülen kimlik kümesi (`String` + kova; büyürken iki tablo, ~70 + kimliğin kendisi). Kayıt başına 128
    // bayt + tek kaydın ağacı ve küçük haritalar için 256 KiB bu payı taşır; çözülmüş kaydı tutan önizleme
    // (eski hal: 42 MB, kayıt başına ~2 KB) ikisini de aşar. Ölçü (2026-11-28): 1,85 MB, belge 13,6 MB.
    let pay = adet as usize * 128 + 256 * 1024;
    assert!(on_tepe < pay, "önizleme tepesi {on_tepe}, kayıt başına pay {pay}");
    assert!(on_tepe * 5 < belge.len(), "önizleme tepesi {on_tepe}, belge {}", belge.len());

    // Uygulama da yazılacakları tutmaz (iki geçiş: önce iz, sonra her kayıt sınıflandığı anda yazılır); eski
    // hal (yazılacakların hepsi bellekte) önizlemenin eski tepesi gibi belgenin ~3 katıydı. Ölçülen: yalnız
    // planın uygulanması (`ice_aktar`; alarm senkronu dahil, SQLite'ın kendi ayırmaları hariç).
    let c = Hat::yeni("bellek-c");
    let iz = c.c.ice_aktarma_onizlemesi(belge.clone()).unwrap().iz;
    let girdi = belge.clone();
    let (s, uygulama_tepe) = tepe(|| c.c.ice_aktar(girdi, Some(iz)).unwrap());
    assert!(s.uygulandi && s.plan.yeni == adet);
    // Uygulamanın sonundaki alarm senkronu telefonun bütün kayıtlarını okur (içe aktarmadan bağımsız, her tam
    // eşitlemede de); planın kendi payı önizlemeninkidir.
    let ((), alarm_tepe) = tepe(|| c.c.alarmlari_yeniden_kur(ajanda_cekirdek::kopru::tipler::YenidenKurmaNedeni::UygulamaAcildi).unwrap());
    eprintln!("belge {} bayt; önizleme tepesi {on_tepe}, uygulama tepesi {uygulama_tepe}, alarm senkronu {alarm_tepe}, ağaç {agac_tepe}", belge.len());
    assert!(uygulama_tepe < alarm_tepe + pay, "uygulama tepesi {uygulama_tepe}, alarm senkronu {alarm_tepe}");

    // Güvenilmeyen dosya: kayıtlar dışındaki dev değer (20 MiB'lık `uygulama_surumu`, ~20 KB'lık zip'ten)
    // boşaltılmış kopyası ve ağacı kurulmadan reddedilir (eskiden kopya + ağaç: belgenin ~2 katı ayırma).
    let dev = belge.replacen("\"uygulama_surumu\":\"", &format!("\"uygulama_surumu\":\"{}", "x".repeat(20 << 20)), 1);
    let (sonuc, dev_tepe) = tepe(|| c.c.ice_aktarma_onizlemesi(dev));
    assert!(matches!(sonuc, Err(ajanda_cekirdek::CekirdekHatasi::GecersizGirdi { ref neden, .. }) if neden.contains("kayıtlar dışı")), "{sonuc:?}");
    eprintln!("dev kayıtlar dışı değer: tepe {dev_tepe}");
    assert!(dev_tepe < 4 << 20, "dev değerin tepesi {dev_tepe}");
    // Kökteki dev anahtar (~60 MB, kaçışsız ve kaçışlı): adı kök dizilerin adlarıyla kopyası çıkarılmadan
    // karşılaştırılır, belge dış bölüm sınırında reddedilir (eskiden anahtarın kopyası: belge + ~1 kat).
    for kacis in ["", "\\u0078"] {
        let dev = format!(r#"{{"{kacis}{}":1,"bicim":"eren_ajanda_yedegi","kayitlar":[]}}"#, "x".repeat(60_000_000));
        let (sonuc, anahtar_tepe) = tepe(|| c.c.ice_aktarma_onizlemesi(dev));
        assert!(matches!(sonuc, Err(ajanda_cekirdek::CekirdekHatasi::GecersizGirdi { ref neden, .. }) if neden.contains("kayıtlar dışı")), "{sonuc:?}");
        eprintln!("dev kök anahtar (kaçış {kacis:?}): tepe {anahtar_tepe}");
        assert!(anahtar_tepe < 4 << 20, "dev anahtarın tepesi {anahtar_tepe}");
    }

    // Dışa aktarma: satırlar + belge (+ tek kaydın ağacı); ağaçlı yazım bütün kayıtların ağacını tutardı.
    let (d, disa_tepe) = tepe(|| c.c.disa_aktar().unwrap());
    assert_eq!(d.kayit, adet);
    assert!(disa_tepe < 3 * d.belge.len(), "dışa aktarma tepesi {disa_tepe}, belge {}", d.belge.len());
    assert!(disa_tepe < agac_tepe, "dışa aktarma {disa_tepe}, ağaç {agac_tepe}");
}
