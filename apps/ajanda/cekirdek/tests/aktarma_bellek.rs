//! D3 bellek iddiası, ayırma ölçüsüyle: içe aktarma önizlemesi belgeyi ağaca çevirmez (tepe ayırma belge
//! metninin küçük bir kesridir), dışa aktarma belgeyi ağaçsız yazar (tepe: satırlar + belge). Süre ölçüsü
//! (`aktarma_guveni.rs` dev dizi) yerine Rust ayırıcısının kendisi sayılır. SQLite'ın kendi ayırmaları sayılmaz
//! (C ayırıcısı); ölçülen ağaçlar Rust'tadır.
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
    // Ağaç kurulsaydı tepe belgenin birkaç katı olurdu; ağaçsız: öğe aralıkları, kimlik kümesi, tek kaydın ağacı.
    assert!(agac_tepe > 2 * belge.len(), "ağaç {agac_tepe}, belge {}", belge.len());
    assert!(on_tepe * 5 < belge.len(), "önizleme tepesi {on_tepe}, belge {}", belge.len());

    // Dışa aktarma: satırlar + belge (+ tek kaydın ağacı); ağaçlı yazım bütün kayıtların ağacını tutardı.
    let c = Hat::yeni("bellek-c");
    assert!(c.ice_aktar_onayla(&belge).uygulandi);
    let (d, disa_tepe) = tepe(|| c.c.disa_aktar().unwrap());
    assert_eq!(d.kayit, adet);
    assert!(disa_tepe < 3 * d.belge.len(), "dışa aktarma tepesi {disa_tepe}, belge {}", d.belge.len());
    assert!(disa_tepe < agac_tepe, "dışa aktarma {disa_tepe}, ağaç {agac_tepe}");
}
