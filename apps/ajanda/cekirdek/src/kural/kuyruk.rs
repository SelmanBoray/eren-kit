//! SAHİBİ: R2. Uygulamanın işlem kuyruğu kararı (`ajanda-kural.ts` `ajandaKuyrukKarari`).
//! Motor (`motor::kanal`) kuyruğun başındaki işlemle ne yapacağını buna sorar. Vektör: `kuyruk_karari`.

use crate::model::sinirlar::ajanda::ISLEM_DENEME;
use crate::model::{AjandaRetNedeni, KuyrukRetNedeni};

/// Kuyruğun başındaki işlemin başına gelen. `Kopma`: yollandı, sonucu gelmeden koptu (yollanmadan
/// kopmak olay değildir). `TamTelafi`: `welcome.tam` geldi.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KuyrukOlayi {
    SonucOk,
    SonucRet(AjandaRetNedeni),
    Kopma,
    TamTelafi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KuyrukKarari {
    /// Kuyruktan çıkar; iyimser değişiklik `kayit` gelince yerini gerçeğe bırakır.
    Cikar,
    /// Başta kalır, `deneme` kalıcı saklanır, aynı `islem_id` ile yeniden yollanır.
    Bekle { deneme: u32 },
    /// Kuyruktan çıkar, iyimser değişiklik geri alınır, kullanıcının ret listesine geçer.
    RetListesi { neden: KuyrukRetNedeni },
}

/// Başarı çıkarır; kalıcı ret ret listesine; geçici ret ve kopma denemeyi artırır, `ISLEM_DENEME`'de
/// ret listesi (`ic_hata` / `teslim_edilemedi`); tam telafi hiçbir şeyi değiştirmez.
///
/// Tek işlem kuyruğu kalıcı olarak tıkayamaz: sonuçsuz her olay `deneme`'yi bir artırır ve sınırda
/// işlem ret listesine geçer (bozuk saklanmış `deneme` sınırın üstündeyse de ilk olayda). İşlem
/// kuyruktan yalnız `Cikar` ya da `RetListesi` ile çıkar; hiçbir yolda sessizce kaybolmaz.
pub fn ajanda_kuyruk_karari(olay: KuyrukOlayi, deneme: u32) -> KuyrukKarari {
    let neden = match olay {
        KuyrukOlayi::TamTelafi => return KuyrukKarari::Bekle { deneme },
        KuyrukOlayi::SonucOk => return KuyrukKarari::Cikar,
        KuyrukOlayi::SonucRet(n) if !n.gecici_mi() => return KuyrukKarari::RetListesi { neden: n.into() },
        KuyrukOlayi::SonucRet(n) => KuyrukRetNedeni::from(n),
        KuyrukOlayi::Kopma => KuyrukRetNedeni::TeslimEdilemedi,
    };
    let sonraki = deneme.saturating_add(1);
    if sonraki >= ISLEM_DENEME { KuyrukKarari::RetListesi { neden } } else { KuyrukKarari::Bekle { deneme: sonraki } }
}

#[cfg(test)]
mod testler {
    use super::*;
    use std::collections::VecDeque;

    struct Islenmis {
        gidenler: Vec<&'static str>,
        ret: Vec<(&'static str, KuyrukRetNedeni)>,
        adim: u32,
    }

    /// Uygulamanın kuyruğunu ve servisi taklit eder (senaryo testindeki `kuyruguIslet`).
    fn kuyrugu_islet(islemler: &[&'static str], sunucu: impl Fn(&str, u32) -> KuyrukOlayi) -> Islenmis {
        let mut kuyruk: VecDeque<(&'static str, u32)> = islemler.iter().map(|&i| (i, 0)).collect();
        let mut s = Islenmis { gidenler: vec![], ret: vec![], adim: 0 };
        while let Some(bas) = kuyruk.front_mut() {
            s.adim += 1;
            assert!(s.adim < 100, "kuyruk ilerlemeli");
            match ajanda_kuyruk_karari(sunucu(bas.0, bas.1), bas.1) {
                KuyrukKarari::Bekle { deneme } => bas.1 = deneme,
                KuyrukKarari::Cikar => s.gidenler.push(kuyruk.pop_front().unwrap().0),
                KuyrukKarari::RetListesi { neden } => s.ret.push((kuyruk.pop_front().unwrap().0, neden)),
            }
        }
        s
    }

    #[test]
    fn kalici_ret_ret_listesine_arkasi_gider() {
        let r = kuyrugu_islet(&["i_bozuk", "i_1", "i_2"], |i, _| {
            if i == "i_bozuk" { KuyrukOlayi::SonucRet(AjandaRetNedeni::GecersizIslem) } else { KuyrukOlayi::SonucOk }
        });
        assert_eq!(r.gidenler, vec!["i_1", "i_2"]);
        assert_eq!(r.ret, vec![("i_bozuk", KuyrukRetNedeni::GecersizIslem)]);
        // Her kalıcı ret ilk sonuçta ret listesine (deneme ne olursa olsun).
        for &n in AjandaRetNedeni::HEPSI.iter().filter(|n| !n.gecici_mi()) {
            assert_eq!(ajanda_kuyruk_karari(KuyrukOlayi::SonucRet(n), 0), KuyrukKarari::RetListesi { neden: n.into() });
        }
    }

    #[test]
    fn hep_gecici_ret_ya_da_kopma_kuyrugu_tikayamaz() {
        for (olay, neden) in [
            (KuyrukOlayi::SonucRet(AjandaRetNedeni::IcHata), KuyrukRetNedeni::IcHata),
            (KuyrukOlayi::Kopma, KuyrukRetNedeni::TeslimEdilemedi),
        ] {
            let r = kuyrugu_islet(&["i_kotu", "i_1"], |i, _| if i == "i_kotu" { olay } else { KuyrukOlayi::SonucOk });
            assert_eq!(r.gidenler, vec!["i_1"]);
            assert_eq!(r.ret, vec![("i_kotu", neden)]);
            assert_eq!(r.adim, ISLEM_DENEME + 1);
        }
        // Ara sıra geçici hata: sınırdan önce başarı gelirse işlem gider.
        let r = kuyrugu_islet(&["i_1"], |_, d| if d < 2 { KuyrukOlayi::SonucRet(AjandaRetNedeni::IcHata) } else { KuyrukOlayi::SonucOk });
        assert_eq!(r.gidenler, vec!["i_1"]);
        assert!(r.ret.is_empty());
        // Karışık geçici ret ve kopma da aynı sayaca yazılır.
        let r = kuyrugu_islet(&["i_k"], |_, d| if d % 2 == 0 { KuyrukOlayi::Kopma } else { KuyrukOlayi::SonucRet(AjandaRetNedeni::IcHata) });
        assert_eq!(r.ret.len(), 1);
        assert_eq!(r.adim, ISLEM_DENEME);
    }

    #[test]
    fn bozuk_saklanmis_deneme_de_tikayamaz() {
        assert_eq!(ajanda_kuyruk_karari(KuyrukOlayi::Kopma, 40), KuyrukKarari::RetListesi { neden: KuyrukRetNedeni::TeslimEdilemedi });
        assert_eq!(
            ajanda_kuyruk_karari(KuyrukOlayi::SonucRet(AjandaRetNedeni::IcHata), u32::MAX),
            KuyrukKarari::RetListesi { neden: KuyrukRetNedeni::IcHata }
        );
    }

    #[test]
    fn yaniti_gelmeden_kopan_islem_kaybolmaz() {
        // Yollandı, sonuç gelmeden koptu: başta kalır.
        assert_eq!(ajanda_kuyruk_karari(KuyrukOlayi::Kopma, 0), KuyrukKarari::Bekle { deneme: 1 });
        // Yeniden bağlanınca tam telafi: yollanmış işlem de atılmaz, deneme sayılmaz.
        assert_eq!(ajanda_kuyruk_karari(KuyrukOlayi::TamTelafi, 1), KuyrukKarari::Bekle { deneme: 1 });
        // Tam telafi ne kadar tekrarlanırsa tekrarlansın işlem ret listesine itilmez.
        let mut d = 1;
        for _ in 0..(ISLEM_DENEME * 3) {
            match ajanda_kuyruk_karari(KuyrukOlayi::TamTelafi, d) {
                KuyrukKarari::Bekle { deneme } => d = deneme,
                k => panic!("tam telafi işlemi çıkardı: {k:?}"),
            }
        }
        assert_eq!(d, 1);
        // Aynı islem_id ile yeniden gider; servis tekrarsızdır, başarı çıkarır.
        assert_eq!(ajanda_kuyruk_karari(KuyrukOlayi::SonucOk, d), KuyrukKarari::Cikar);
    }
}
