//! SAHİBİ: D3 (dışa ve içe aktarma, `YOL-HARITASI.md` 3.3 "Servis olmadan deneyim"). Bağımsız kipte telefonun
//! tek yedeği: bütün kayıtlar (mezar taşları dahil) sürümlü bir JSON belgeye yazılır; Kotlin onu bir zip'e
//! koyar (`AktarmaBicimi`: kökte `ajanda.json`, ekler `ekler/<ozet>`). Çekirdek dosya sistemine dokunmaz:
//! belge metni girer ve çıkar.
//!
//! Belge (biçim sürümü 1, 2 ya da 3), anahtarlar sıralı, UTF-8:
//! - `bicim`: `"eren_ajanda_yedegi"` (başka bir JSON'u ajanda yedeği sanmamak için);
//! - `bicim_surumu`: kabın ve üst düzey alanların sürümü. Yazıcı içeriğin gerektirdiği en düşük sürümü yazar:
//!   ret girdisi yoksa 1 (eski uygulama da okur), varsa 2 (`retler`), bir ret öğesi biçim 2'nin taşıyamadığını
//!   taşıyorsa 3 (`ret_oku`). Okuyucu 3'e dek okur (`BICIM_SURUMU`);
//! - `sozlesme_surumu`: kayıtların sözleşme sürümü (`AJANDA_SURUMU`);
//! - `uygulama_surumu`: yazan çekirdeğin sürümü (yalnız tanı);
//! - `olusturma_ms`: dışa aktarma anı; `kip`: `yerel` ya da `bagli`;
//! - `kayitlar`: modelin kendi kayıt JSON'u (`AjandaKaydi::json`), mezar taşları dahil; sözleşmenin yeni
//!   kayıt alanları (v3 ekler) okuyucu/yazıcıyla kendiliğinden geçer;
//! - `ekler`: kaptaki ek dosyalarının dizini (`{ozet, bayt, mime}`; `ozet` sha256, küçük harf hex, dosya
//!   `ekler/<ozet>`). Ek üstverisi kaydın içindedir (v3 `ekler` alanı); bu dizi kaydın başvurduğu dosyaların
//!   tekil listesidir. Bugün hep boştur (`kayit_ekleri`: v3 alanları gelince doldurulacak bağlantı noktası);
//! - `bolgeler`: bölge tanımlarının yeri; hep boştur (öğesi tanımsız: dolu dizi reddedilir). Bölgeler gelince
//!   öğe şeması tanımlanır ve yeni bir biçim sürümü (4) ayrılır;
//! - `retler` (biçim 2 ve 3, orada zorunlu): ret listesinin girdileri. Biçim 2:
//!   `{govde, islem, islem_id, kayit_id, neden, ts_ms}` (`govde` `KayitGovdesi`; `islem` ve `neden` kapalı
//!   listelerin adları, ret listesinin gösterdiği gibi). Biçim 3 ret listesi satırını bütünüyle taşır: ayrıca
//!   `islem_json` (satırın metni bayt bayt: işlemin kendisi, atılmış ertelenen değişikliğin taban bilgili hali,
//!   okunamayan metin ya da kaydın hali; varsa `govde` isteğe bağlı) ve `kayit_sonra_degisti`; `neden` yerel ad
//!   da olabilir (`ertelenen_atildi` gibi; `ret_oku`). Biçim 1'de alan yoktur (katı okuyucu reddeder).
//!
//! Sürüm kuralı: `bicim` ve iki sürüm alanı katı okumadan önce bakılır. `bicim_surumu > BICIM_SURUMU` ya da
//! `sozlesme_surumu > AJANDA_SURUMU` ise belge bütünüyle reddedilir (`GecersizGirdi{alan:"bicim_surumu" |
//! "sozlesme_surumu", neden:"daha yeni..."}`): okuyamayacağı alanları sessizce atmasın. Biçim 1 okuyan eski
//! uygulama biçim 2 belgesini böyle açık bir hatayla reddeder. Daha eski sözleşme sürümleri okunur (yeni
//! alanlar isteğe bağlıdır). Kendi sürümünde şema katıdır (bilinmeyen alan reddedilir).
//!
//! Bellek (başkasından gelen dosya): belge bütünüyle bir JSON ağacına çevrilmez. Önce `yapi_tara` metni
//! ağaç kurmadan bir kez geçer (parantez dengesi, dizgiler, kökteki `kayitlar` ve `retler` dizilerinin öğe
//! aralıkları) ve sınırları uygular: belge `BELGE_AZAMI_BAYT`, `kayitlar` en çok `KAYIT_DIZISI_AZAMI`, `retler`
//! en çok `RET_DIZISI_AZAMI` öğe (sayım aşınca tarama durur), iki dizinin dışındaki bölüm en çok
//! `DIS_AZAMI_BAYT` (ağacı ve boşaltılmış kopyası kurulmadan önce; dizi olmayan `kayitlar` da bu bölümdedir)
//! ve en çok `DIS_SOZCUK_AZAMI` sözcük (anahtar ya da değer), iç içelik `DERINLIK_AZAMI`. Üst düzey
//! dizileri boşaltılmış metinden okunur; öğeler `plan_kur`'da tek tek çözülür (bir öğe en çok
//! `KAYIT_AZAMI_BAYT`; büyüğü yalnız kendini geçersiz kılar). Bellek: belge metni + öğe aralıkları + kimlik
//! kümeleri + o anki tek öğenin ağacı; önizleme ve uygulama aynı (uygulama planı iki kez geçer, yazılacakları
//! tutmaz). Öğenin içindeki sözdizimi hatası da bütün belgeyi reddeder (eski davranış: dosya bozuk); çok büyük
//! öğenin sözdizimini ağaç kurmayan `sozdizimi_denetle` denetler. Taramanın, boşaltılmış metnin ve öğelerin
//! birlikte kabul ettiği her metin serde_json'un da bütün belge olarak kabul ettiği metindir (testli: elle
//! bozulmuş örnekler, bulanıklaştırma ve iç içelik sınırının iki yanı).
//!
//! Sınırlar ve takas. Rust'ta ayırma hatası süreci düşürür (`catch_unwind` yakalamaz; Kotlin'in
//! `OutOfMemoryError` yakalaması yalnız Java yığınıdır), bu yüzden güvenilmeyen belgenin çekirdekteki bellek
//! payı belge sınırıyla sınırlıdır: belge + sabit pay (dış bölüm 4 MiB, öğe başına kimlik ve aralık). Belge
//! sınırı modelin izin verdiği en büyük belge değildir (`KAYIT_ADET` × `KAYIT_EN_BUYUK_BAYT` ≈ 1,77 GiB:
//! telefonun ne Java yığınına ne yerel belleğine sığar), gerçekçi en büyük yedektir: 64 MiB, dolu telefon
//! (`KAYIT_ADET`) için kayıt başına ortalama 1342 bayt (uygulamanın olağan kaydı 472 bayt). Takas: bu
//! ortalamanın üstündeki (modelce geçerli ama gerçekçi olmayan) telefonun yedeği bu sürümde içe aktarılamaz;
//! dışa aktarma onu yine yazar (veri yalnız telefonda kalmasın) ve `DisaAktarma.ice_aktarma_sinirini_asiyor`
//! ile söyler. Bunun dışında dışa aktarmanın yazdığı belge içe aktarmada bütünüyle reddedilmez: geçerli
//! kaydın sıkışık JSON'u en çok `KAYIT_EN_BUYUK_BAYT` (öğe sınırının altında), okunamayan satır belgenin iç
//! içelik sınırını aşacaksa metin olarak yazılır, ret öğesi içe aktarmanın okuyucusundan geçmeden yazılmaz,
//! dış bölüm (ek dizini ve üst düzey) sınırının altındadır. Dışa aktarma belgeyi ağaç kurmadan, kayıt kayıt
//! yazar.
//!
//! İçe aktarma (`plan_kur`): her kayıt ayrı sınıflanır; tek bozuk kayıt bütün aktarmayı düşürmez.
//! - geçersiz: modelin okuyucusundan ya da kurallarından geçmeyen, dosyada yinelenen `kayit_id`, dilimi
//!   bilinmeyen (`ZamanKabugu.andan_yerele`; yerel yazarın `ekle` denetimi), çok büyük öğe ve gelecek
//!   tarihli: `guncelleme_ms` şimdi + `GELECEK_TOLERANSI_MS`'ten büyük (model `olusturma_ms <=
//!   guncelleme_ms` ister, o da sınırlanmış olur). Gelecekteki an kırpılmaz, reddedilir: "daha yeni kazanır"
//!   kuralı bu anı her yerel kayda üstün sayar (9e15'li mezar taşı telefonu siler) ve servisin
//!   `max(önceki, şimdi)` kuralı onu yapışkan kılar; kırpılmış an da (şimdi) o anki her kaydı yenerdi ve
//!   dosyanın gerçek sırası zaten bilinemez;
//! - yeni: telefonda yok. Kayıt sınırı (`KAYIT_ADET`, mezar taşları dahil) dolunca `sinir_asan`;
//! - aynı: yerelde revizyon ve güncelleme anı dışında her alan eşit; bağlı kipte servise gidecek alanlar
//!   eşit (`icerik_ayni`) ya da gidecek işlem yok;
//! - güncellenecek: dosyadaki `guncelleme_ms` büyük; atlanacak: telefondaki büyük ya da eşit (telefon kalır).
//!   Telefondaki satır okunamıyorsa yerelde dosyadaki yazılır (onarır) ve telefondaki eski metin kaybolmasın
//!   diye ret listesine düşer (`okunamayan_ret_listesine`; D2'nin `tutarsiz_kayit` kalıbı: okunamama
//!   nedeni sürüm düşürmeyse eski metin oradan geri alınabilir); bağlı kipte atlanır. Güncellemenin
//!   içindeki silme (`silinecek`: canlı kayıt yerine daha yeni mezar taşı), geri yükleme (`geri_yuklenecek`)
//!   ve taslağın onaylanması (`taslak_onaylanacak`: telefonda taslak, dosyada daha yeni, onaylı ve canlı)
//!   ayrıca sayılır. Tersi de ayrı sayılır (`taslaga_donecek`: yerel kipte telefonda onaylı, dosyada daha
//!   yeni ve taslak). Bağlı kipte `taslaga_donecek` hep 0: dökme kuralı taslağa döndürmeyi göndermez, servis
//!   de döndürmez (kayıt onaylı kalır). Telefondaki satır okunamıyorsa önceki halin `silindi` ve `taslak`'ı
//!   metnin alanlarından okunur (doğru değilse canlı ve onaylı sayılır); dört sayı onunla da aynı kuralla
//!   sayılır.
//!
//! Taslağın içe aktarmayla onaylanması (karar): dosyadaki daha yeni onaylı hal uygulanır (bağlı kipte
//! `onayla` işlemi, yerel kipte doğrudan). Aynı `kayit_id`'nin taslaktan çıkmasının tek yolu bir insanın
//! `onayla`'sıdır (servis kaydı taslağa döndürmez); dosyadaki daha yeni onaylı hal o kararın kaydıdır ve
//! "daha yeni kazanır" kuralı bütün öteki alanlara da uygulanır. Elle düzenlenmiş dosya bunu taklit
//! edebilir: bu yüzden sayı önizlemede ayrıdır, kullanıcı onaylamadan uygulanmaz. Dosyadaki daha yeni hal
//! onaylı bir mezar taşıysa kayıt yalnız `silinecek` sayılır ve taslak kalır (iki kipte de; `taslagi_koru`):
//! silinmiş kaydın onayı görünür bir etki doğurmaz, önizleme onu "onaylanacak" diye söylemez, bağlı kipte
//! `onayla` gönderilmez (ardındaki `sil` reddedilirse kayıt kullanıcının görmediği bir onayla canlı ve onaylı
//! kalmasın). Geri yüklenirse yine taslaktır.
//!
//! Ret girdileri (biçim 2 ve 3 `retler`): her öğe ayrı okunur; geçersiz ya da dosyada yinelenen `islem_id`
//! `ret_gecersiz` sayılır, telefonun ret listesinde aynı `islem_id` varsa yinelenmez, ret listesi
//! `RET_DIZISI_AZAMI`'ya ulaşınca kalanlar alınmaz (`ret_sinir_asan`: liste içe aktarmalarla sınırsız
//! büyümesin, yedeği hep tam yazılabilsin). Kalanlar (`ret_listesine_gelecek`) iki kipte de ret listesine
//! `islem_id`, an, neden, gövde ve `islem_json`'la (biçim 2'de yalnız tür, biçim 3'te olduğu gibi) yazılır. Kaydı
//! dosyadan sonra değişmiş (ya da bu bilinemeyen: `kayit_sonra_degisti_mi`) girdi de alınır ama
//! `kayit_sonra_degisti` işaretiyle (`ret_sonra_degisen`; işaret yedekle taşınır): içeriği yalnız yedekte
//! olabilir, düzeltmesi (`ret_duzelt`) kaydın şimdiki halini ezmez, yeni kayıt ekler. Eskiden bayat girdi
//! alınmazdı (`ret_bayat`, artık hep 0): bağlı kipte servisin sonradan düzenlediği kaydın tek kopyası yedekteki
//! girdiyse ona ulaşmanın yolu kalmıyordu. Çözülmüş `ekle` reddi ayırt edilemez (düzeltmesi yeni kimlikle
//! eklenir, girdinin `kayit_id`'si hiçbir kayda bağlanmaz): geri gelirse yeniden düzeltilmesi kopya kayıt
//! doğurur, bir şey ezmez.
//!
//! Uygulama (`ice_aktar`) tek SQLite işlemidir: plan işlemin içinde yeniden kurulur, `iz` zorunludur: yoksa
//! ya da şimdiki planınkiyle tutmazsa hiçbir şey yazılmaz (`uygulandi` yanlış, şimdiki plan döner). İz: kip, ek
//! dizini, her öğenin (kayıt ve ret) metni ve sınıfı, güncellenecek kaydın telefondaki satırı (içerik ve
//! yazım kimliği): başka bir dosya ya da önizlemeden sonra değişen telefon kaydı eski izle uygulanmaz. Plan
//! iki kez geçilir: önce yalnız iz (önizlemenin belleğiyle), tutarsa aynı plan yeniden kurulurken her
//! yazılacak sınıflandığı anda yazılır (yazılacaklar bellekte birikmez). Bir yazım hata verirse işlem geri
//! alınır, hiçbir kayıt ve ret girdisi kalmaz.
//! - Yerel kip: kayıt alanları korunur (oluşturma ve güncelleme anı, kaynak izi, elle alanlar, örnekler,
//!   durum, taslak, silindi), revizyon yerel sayaçtan, yerel geçmişe bir satır (yeni: doğum parçası,
//!   güncelleme: fark; yazar insan elle, an içe aktarma anı); kalıcı olunca alarm senkronu.
//! - Bağlı kip: servis yazardır; D1'in dökme kuralıyla (`kuyruga_islemler`) görünen hal ile dosyadaki hal
//!   arasındaki işlemler kuyruğa girer (yeni: aynı kimlikle `ekle`, sonra durum, örnekler, `sil`; güncelleme:
//!   `geri_yukle`, `guncelle`, `durum`, örnekler, `onayla`, `sil`). Kaybolanlar: kaynak izi (servis
//!   `ekle`'yi bu telefonun elle/sesli not yazması sayar), oluşturma ve güncelleme anı (servisin), `elle_alanlar`
//!   (servis hesaplar), taslak olmayan kaydı taslağa döndürme, telefonda olmayan mezar taşları
//!   (`gonderilmeyecek`). Telefonda olmayan taslak gönderilmez (`taslak_gonderilmeyecek`): servis `ekle`'si
//!   onaylanmış kayıt doğurur, kullanıcının onaylamadığı öneri onaylanmış gibi gitmesin (dosyada kalır,
//!   yerel kipte taslak olarak alınabilir). Servisin reddettiği işlem bugünkü gibi ret listesine düşer.
//!
//! Kuyruk belgeye girmez: etkisi görünen kopyadadır (bağlı kipte iyimser hal aktarılır). Ret listesi girer
//! (karar, D3 gözden geçirmesi Y4; tam taşıma V1): birleştirmeden (D4) ya da içe aktarmadan sonra taslaklar,
//! okunamayan satırların metni ve servisin silip telefonun düzenlediği kayıtlar yalnız orada yaşar; yedeğe
//! girmeselerdi telefonla birlikte giderlerdi. Satır olduğu gibi gider (`islem_json` ve yerel neden bayt bayt;
//! v3 değişikliği, atılmış ertelenen değişiklik ve onu geri almanın bilgisi, okunamayan kaydın durumu,
//! örnekleri ve ileri sürüm alanları kaybolmaz); biçim 2 yalnız hiçbir şey kaybolmayacaksa yazılır
//! (`ret_ogesi`). Kimliği ya da anı okunamayan ve öğe sınırını (`RET_DIZISI_AZAMI`, `KAYIT_AZAMI_BAYT`) aşan
//! girmez; girmeyenlerin sayısı `DisaAktarma.ret_listesinde`'dir, girenlerinki `ret_yedekte` (belgenin biçim
//! sürümü `bicim_surumu`). Yerel geçmiş de girmez (yeni telefonda içe aktarma satırıyla başlar).
//!
//! Mahremiyet: belge içeriği (başlık, açıklama, ileride bölge) hata mesajına, `GecersizKayit`'e ya da
//! günlüğe girmez. Hatalar yalnız konum (şemanın alan adları ve sıra numaraları: `guvenli_yol`) ve sabit
//! neden taşır; JSON sözdizimi hatası yalnız satır ve sütun.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{Map, Value};

use super::iyimser::gorunen_yenile;
use super::kanal::gecmis_satiri;
use super::yerel::{dogum_parcasi, fark, icerik_ayni, kaydi_ret_listesine, kayit_coz, kuyruga_islemler};
use super::{Etkiler, Motor, Ortam, TELAFI_TAMPONU};
use crate::depo::{Depo, RetSatiri};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{
    AktarmaBicimi, CalismaKipi, DisaAktarma, EkDosyasi, GecersizKayit, IceAktarmaOnizlemesi, IceAktarmaSonucu,
};
use crate::model::json::{GUVENLI_TAM_SAYI, Nesne, SemaHatasi, Sonuc, Yazici, alt_yol, hata, mantik, metin, tam_sayi};
use crate::model::kayit::zaman_ms_oku;
use crate::model::metin::opak_id_oku;
use crate::model::{KayitGovdesi, KuyrukRetNedeni};
use crate::model::surum::AJANDA_SURUMU;
use crate::model::sinirlar::ajanda::{
    ACIKLAMA, ALINTI, BASLIK, HATIRLATMA_ADET, KAYIT_ADET, ORNEK_ADET, SAAT_DILIMI, TEKIL_ANAHTAR, ZAMAN_IFADESI,
};
use crate::model::sinirlar::genel::OPAK_ID;
use crate::model::{AjandaGecmisGirdisi, AjandaIslem, AjandaKaydi, AjandaParca, AjandaYazar, Hatirlatma, IslemTuru, KaynakYolu, TurKokeni};

pub(crate) const BELGE_ADI: &str = "ajanda.json";
pub(crate) const EKLER_DIZINI: &str = "ekler/";
pub(crate) const BICIM: &str = "eren_ajanda_yedegi";
/// Okunabilen en yeni biçim sürümü. 1: ilk biçim. 2: `retler` (ret listesinin düzeltme gövdesi olan
/// girdileri). 3: genişlemiş ret öğesi (`ret_oku`: işlemin kendisi, ham metin, atılmış ertelenen değişiklik,
/// "kayıt sonra değişti"). Yazıcı içeriğin gerektirdiği en düşüğünü yazar (`BICIM_RETLI` yalnız ret öğesi
/// varsa, `BICIM_GENIS_RET` yalnız bir öğe onu gerektiriyorsa).
pub(crate) const BICIM_SURUMU: i64 = 3;
/// `retler` alanının geldiği biçim sürümü.
const BICIM_RETLI: i64 = 2;
/// Genişlemiş ret öğesinin geldiği biçim sürümü.
const BICIM_GENIS_RET: i64 = 3;
/// Serbest metnin bir UTF-16 biriminin sıkışık JSON'daki en çok baytı. BMP karakteri UTF-8'de en çok 3
/// bayttır, vekil çifti 2 birimde 4 bayt; serde_json yalnız `"`, `\` ve U+0020 altını kaçışlar: ilk ikisi 2
/// bayt, U+0020 altından modelin kabul ettikleri (sekme, satır sonu, satır başı) 2 bayt. `\u00XX` (6 bayt)
/// gerektiren öteki denetim karakterleri modelce yasaktır (`metin::AJANDA_GORUNMEZ_ARALIKLARI`).
const METIN_BIRIMI_AZAMI_BAYT: usize = 3;
/// Geçerli bir kaydın sıkışık JSON'unun (dışa aktarmanın yazdığı) üst sınırı: 37 960 bayt. Modelin
/// sınırlarından: serbest metin (başlık, açıklama, zaman ifadesi, alıntı) birim başına 3 bayt; kimlikler
/// (`kayit_id` ve kaynağın en çok 3 kimliği) ve tekil anahtar ASCII; zaman ile 8 mutlak hatırlatmanın her biri
/// dilim (ASCII, 64) + 128 bayt (tarih, saat, süre, anahtarlar); 500 örnek, her biri en çok 39 bayt
/// (`{"durum":"tamam","tarih":"2199-12-31"},`); iskelet (anahtarlar, sabit listeler, sayılar, tekrar,
/// `elle_alanlar`) 2 KiB. En büyük geçerli kayıt testte kurulup ölçülür (`en_buyuk_kayit_sinirin_altinda`).
/// Bir ret öğesi (gövde + kimlikler + an) bunun altındadır.
pub(crate) const KAYIT_EN_BUYUK_BAYT: usize = METIN_BIRIMI_AZAMI_BAYT * (BASLIK + ACIKLAMA + ZAMAN_IFADESI + ALINTI)
    + 4 * OPAK_ID
    + TEKIL_ANAHTAR
    + (1 + HATIRLATMA_ADET) * (SAAT_DILIMI + 128)
    + 40 * ORNEK_ADET
    + 2048;
/// Ek dizininin bir öğesinin üst sınırı: `{"bayt":4194304,"mime":"<127>","ozet":"<64>"},` 228 bayt.
const EK_OGESI_AZAMI_BAYT: usize = 256;
/// Üst düzeyin kayıtlar ve ekler dışındaki payı (biçim alanları, sürümler, an, kip).
const UST_DUZEY_PAYI: usize = 4096;
/// Modelin izin verdiği en büyük belge (yalnız bilgi ve test): `KAYIT_ADET` × (`KAYIT_EN_BUYUK_BAYT` + virgül) +
/// `EK_AZAMI_ADET` × `EK_OGESI_AZAMI_BAYT` + `UST_DUZEY_PAYI` = 1 900 614 096 bayt (~1,77 GiB). İçe aktarmanın
/// sınırı bu değildir (`BELGE_AZAMI_BAYT`): o kadar bellek telefonda yoktur.
#[cfg(test)]
const MODEL_BELGE_EN_BUYUK_BAYT: usize =
    KAYIT_ADET * (KAYIT_EN_BUYUK_BAYT + 1) + EK_AZAMI_ADET * EK_OGESI_AZAMI_BAYT + UST_DUZEY_PAYI;
/// Belgenin üst sınırı (UTF-8 bayt), içe aktarmada bellek koruması: 64 MiB. Çekirdek belgeyi bir kez tutar,
/// ağacı tek öğe için kurar; tepe ayırma belge + sabit pay (`tests/aktarma_bellek.rs`). Kotlin kabı açarken
/// belgeyi bu sınırla sayar ve tutar (ölçü: 24,4 MB belgede tepe yığın 55 MB, ~2,25 kat; 64 MiB'ta ~150 MB:
/// olağan 192-256 MB yığın sınırının altında). Gerçekçi yedeğe yeter: dolu telefon (`KAYIT_ADET`) kayıt başına
/// ortalama 1342 bayta dek sığar; ölçü (`tests/aktarma_guveni.rs` `kendi_yedegi_boyutla_reddedilmez`):
/// uygulamanın olağan kaydı 472 bayt (sınıra 141 879 tane), ağır gerçekçi kayıt (300 karakter açıklama, iki
/// hatırlatma, 50 örnekli tekrar) 2875 bayt (23 334 tane).
/// Modelin izin verdiği daha büyük belge (`MODEL_BELGE_EN_BUYUK_BAYT`) dışa aktarılır ama içe aktarılamaz
/// (`DisaAktarma.ice_aktarma_sinirini_asiyor`). Eski sınırlar: 32 MiB (dolu telefona dar), modelden ~1,77 GiB
/// (güvenilmeyen dosyaya karşı koruma değildi).
pub(crate) const BELGE_AZAMI_BAYT: usize = 64 * 1024 * 1024;
/// İki kök dizinin (`kayitlar`, `retler`) dışındaki bölümün üst sınırı (UTF-8 bayt): 4 MiB. Dolu ek dizini
/// (`EK_AZAMI_ADET` × `EK_OGESI_AZAMI_BAYT`, 2,4 MiB) + üst düzey; girintili yazıma pay. Bu bölüm ağaca
/// çevrilir (boşaltılmış kopya + ağaç): sınır, ağaçtan önce, kopyasız uygulanır.
pub(crate) const DIS_AZAMI_BAYT: usize = 4 * 1024 * 1024;
/// `kayitlar` dizisinin öğe sınırı: `KAYIT_ADET`'in iki katı (telefon en çok `KAYIT_ADET` satır yazar;
/// yinelenen ya da bozuk öğelere pay). Aşan belge, dizi ağaca çevrilmeden reddedilir.
pub(crate) const KAYIT_DIZISI_AZAMI: usize = 2 * KAYIT_ADET;
/// `retler` dizisinin öğe sınırı (dışa aktarma da en çok bu kadar yazar; kalanı `ret_listesinde` sayılır).
pub(crate) const RET_DIZISI_AZAMI: usize = KAYIT_ADET;
/// Tek öğenin (kayıt ya da ret) metin sınırı: 256 KiB. En büyük geçerli kayıt `KAYIT_EN_BUYUK_BAYT` (~37 KB);
/// girintili yazıma pay. Aşan öğe geçersiz sayılır (sözdizimi yine denetlenir).
pub(crate) const KAYIT_AZAMI_BAYT: usize = 256 * 1024;
const _: () = assert!(KAYIT_EN_BUYUK_BAYT <= KAYIT_AZAMI_BAYT);
const _: () = assert!(EK_AZAMI_ADET * EK_OGESI_AZAMI_BAYT + UST_DUZEY_PAYI <= DIS_AZAMI_BAYT);
const _: () = assert!(DIS_AZAMI_BAYT < BELGE_AZAMI_BAYT && BELGE_AZAMI_BAYT <= i32::MAX as usize - 8);
/// İki kök dizinin dışındaki sözcüklerin (anahtar ya da değer) sınırı: `EK_AZAMI_ADET` ek × 7 sözcük + pay.
const DIS_SOZCUK_AZAMI: usize = 100_000;
/// Ek dizininin öğe sınırı (Kotlin `YedekKabi.AZAMI_EK_SAYISI`; `AktarmaBicimi.ek_azami_adet`).
const EK_AZAMI_ADET: usize = 10_000;
/// Kapta belleğe alınan bütün ek dosyalarının toplam sınırı (Kotlin): 16 MiB. Bugün hiçbir sürüm ek yazmaz
/// (`kayit_ekleri` boş); ekler gelip depolamaya akıtılınca yeniden bakılır.
const EKLER_TOPLAM_AZAMI_BAYT: usize = 16 * 1024 * 1024;
/// İç içeliğin sınırı: serde_json'unki (özyineleme sayacı 128'den başlar, 128. düzeyde reddeder; en çok 127).
/// Bütün belgede sayılır (kökteki nesne ve `kayitlar` dizisi dahil): çekirdeğin kabul ettiği belgeyi
/// serde_json da bütünüyle kabul eder (`derinlik_siniri_serde_json_ile_ayni`).
const DERINLIK_AZAMI: usize = 127;
/// Kaydın `guncelleme_ms`'inin şimdinin ötesinde kabul edilen payı: 1 gün. Cihaz saatleri arasındaki olağan
/// kayma ve yanlış dilimle elle kurulmuş saat (en çok ~14 saat) geçer; daha ilerisi bozuk saat ya da
/// düzenlenmiş dosyadır.
pub(crate) const GELECEK_TOLERANSI_MS: i64 = 24 * 60 * 60 * 1000;
/// Bir ekin tam boyunun üst sınırı (v3 taslağı: 4 MiB).
pub(crate) const EK_AZAMI_BAYT: i64 = 4 * 1024 * 1024;
/// Önizlemede konumu verilen geçersiz kayıt sayısı.
const GECERSIZ_ORNEK: usize = 20;

pub(crate) fn aktarma_bicimi() -> AktarmaBicimi {
    AktarmaBicimi {
        belge_adi: BELGE_ADI.into(),
        ekler_dizini: EKLER_DIZINI.into(),
        bicim_surumu: BICIM_SURUMU,
        belge_azami_bayt: BELGE_AZAMI_BAYT as u64,
        ek_azami_bayt: EK_AZAMI_BAYT as u64,
        ekler_toplam_azami_bayt: EKLER_TOPLAM_AZAMI_BAYT as u64,
        acilmis_toplam_azami_bayt: (BELGE_AZAMI_BAYT + EKLER_TOPLAM_AZAMI_BAYT) as u64,
        ek_azami_adet: EK_AZAMI_ADET as u32,
    }
}

/// Hata yollarında görünebilecek adlar: belgenin, kaydın ve parçalarının şema alanları (ve v3 ek alanları).
/// Bilinmeyen alan hatası alanın adını yolun sonuna koyar; ad dosyanın içeriğidir, mesaja girmez.
const SEMA_ADLARI: &[&str] = &[
    "bicim", "bicim_surumu", "sozlesme_surumu", "uygulama_surumu", "olusturma_ms", "kip", "kayitlar", "ekler", "bolgeler",
    "retler", "govde", "islem", "islem_id", "neden", "ts_ms", "ozet", "bayt", "mime", "ek_id", "genislik", "yukseklik", "kapak", "aciklama", "adet", "alinti", "aralik", "baslangic",
    "baslik", "bitis", "bitis_tarihi", "device_id", "dk", "durum", "elle_alanlar", "gun_bolumu", "guncelleme_ms", "gunler",
    "hatirlatmalar", "ifade", "kayit_id", "kaynak", "kaynak_msg_id", "kesinlik", "ornekler", "oturum_id", "revizyon", "saat",
    "saat_dilimi", "siklik", "silindi", "sohbet_id", "sure_dk", "tarih", "taslak", "tekil_anahtar", "tekrar", "tur", "tur_kokeni",
    "yol", "zaman",
];

/// Yolun yalnız şema adlarından ve sıra numaralarından oluşan başı (ilk yabancı parçada kesilir); boşsa
/// `belge`.
fn guvenli_yol(yol: &str) -> String {
    let parcalar: Vec<&str> = yol
        .split('.')
        .take_while(|p| !p.is_empty() && (p.bytes().all(|b| b.is_ascii_digit()) || SEMA_ADLARI.contains(p)))
        .collect();
    if parcalar.is_empty() { "belge".to_string() } else { parcalar.join(".") }
}

fn belge_hatasi(alan: &str, neden: &str) -> CekirdekHatasi {
    CekirdekHatasi::GecersizGirdi { alan: alan.to_string(), neden: neden.to_string() }
}

fn sema_hatasi(h: SemaHatasi) -> CekirdekHatasi {
    belge_hatasi(&guvenli_yol(&h.yol), h.neden)
}

/// Kaydın başvurduğu ek dosyaları. Bağlantı noktası: sözleşme v3'te kaydın `ekler` listesinden (`ozet`, `bayt`,
/// `mime`) doldurulur; bugün kayıtta ek alanı yoktur.
fn kayit_ekleri(_k: &AjandaKaydi) -> Vec<EkDosyasi> {
    Vec::new()
}

fn ek_dosyasi(ozet: String, bayt: i64, mime: String) -> EkDosyasi {
    EkDosyasi { yol: format!("{EKLER_DIZINI}{ozet}"), ozet, bayt, mime }
}

fn ek_json(e: &EkDosyasi) -> Value {
    serde_json::json!({ "ozet": e.ozet, "bayt": e.bayt, "mime": e.mime })
}

/// `type/subtype`, küçük harf ASCII, en çok 127 karakter.
fn mime_gecerli(s: &str) -> bool {
    let parca = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"+-.".contains(&b));
    s.len() <= 127 && s.split_once('/').is_some_and(|(a, b)| parca(a) && parca(b))
}

fn ek_oku(v: &Value, yol: &str) -> Sonuc<EkDosyasi> {
    let mut n = Nesne::ac(v, yol)?;
    let ozet = n.zorunlu("ozet", |v, y| {
        let s = metin(v, y)?;
        if s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            Ok(s.to_string())
        } else {
            hata(y, "sha256 küçük harf hex değil")
        }
    })?;
    let bayt = n.zorunlu("bayt", |v, y| tam_sayi(v, y, 1, EK_AZAMI_BAYT))?;
    let mime = n.zorunlu("mime", |v, y| {
        let s = metin(v, y)?;
        if mime_gecerli(s) { Ok(s.to_string()) } else { hata(y, "mime türü değil") }
    })?;
    n.bitir()?;
    Ok(ek_dosyasi(ozet, bayt, mime))
}

fn kip_adi(yerel: bool) -> &'static str {
    if yerel { "yerel" } else { "bagli" }
}

/// Çözülmüş belge: kayıt ve ret öğeleri henüz okunmamıştır (her biri `plan_kur`'da ayrı ayrı, metin
/// aralığından).
struct Belge<'a> {
    metin: &'a str,
    olusturma_ms: i64,
    /// `kayitlar` öğelerinin `metin`'deki (baş, son) aralıkları.
    kayitlar: Vec<(usize, usize)>,
    /// `retler` öğelerinin aralıkları (biçim 1'de boş).
    retler: Vec<(usize, usize)>,
    ekler: Vec<EkDosyasi>,
    /// `bicim_surumu` (ret öğesinin şeması ona bağlıdır: `ret_oku`).
    bicim: i64,
}

/// `ofset`'teki konum, serde_json'un sayışıyla (satır 1'den, sütun satırdaki bayt sayısı).
fn konum(metin_: &str, ofset: usize) -> (usize, usize) {
    let on = &metin_.as_bytes()[..ofset.min(metin_.len())];
    (1 + on.iter().filter(|&&b| b == b'\n').count(), on.iter().rev().take_while(|&&b| b != b'\n').count())
}

/// serde_json konumunun (satır, sütun) `metin`'deki ofseti (`konum`'un tersi).
fn ofset(metin_: &str, satir: usize, sutun: usize) -> usize {
    let bas = if satir <= 1 {
        0
    } else {
        metin_.bytes().enumerate().filter(|(_, b)| *b == b'\n').nth(satir - 2).map_or(metin_.len(), |(i, _)| i + 1)
    };
    (bas + sutun).min(metin_.len())
}

/// Sözdizimi hatası: yalnız satır ve sütun (içerik yok).
fn json_degil(metin_: &str, ofset_: usize) -> CekirdekHatasi {
    let (satir, sutun) = konum(metin_, ofset_);
    belge_hatasi("belge", &format!("JSON değil (satır {satir}, sütun {sutun})"))
}

fn cok_buyuk(azami: usize) -> CekirdekHatasi {
    belge_hatasi("belge", &format!("çok büyük (en çok {} MiB)", azami / (1024 * 1024)))
}

fn cok_fazla(alan: &str, azami: usize) -> CekirdekHatasi {
    belge_hatasi(alan, &format!("çok fazla öğe (en çok {azami})"))
}

/// Kökte ağaçsız okunan diziler (ad, öğe sınırı); `Tarama` dizinleri bu sıradadır.
const KOK_DIZILERI: [(&str, usize); 2] = [("kayitlar", KAYIT_DIZISI_AZAMI), ("retler", RET_DIZISI_AZAMI)];
const KAYITLAR: usize = 0;
const RETLER: usize = 1;
/// Kök dizi adlarından birine çözülebilecek kaçışlı anahtarın en uzun ham metni (tırnaklar dahil): en uzun
/// ad, her harfi altı baytlık `\uXXXX` kaçışıyla. ASCII harfin en uzun kaçışı budur (`\/` gibi iki baytlıklar
/// daha kısadır; vekil çifti ASCII'ye çözülmez).
const KOK_ADI_KACISLI_AZAMI: usize = {
    let (mut n, mut i) = (0, 0);
    while i < KOK_DIZILERI.len() {
        if KOK_DIZILERI[i].0.len() > n {
            n = KOK_DIZILERI[i].0.len();
        }
        i += 1;
    }
    2 + 6 * n
};

/// `yapi_tara`'nın sonucu.
#[derive(Debug, Default, PartialEq)]
struct Tarama {
    /// Kök dizilerin (`KOK_DIZILERI`) `[`'ından `]`'ının ardına (alan dizi değilse ya da yoksa `None`).
    diziler: [Option<(usize, usize)>; 2],
    /// Her kök dizinin öğelerinin (baş, son) aralıkları; baştaki ve sondaki boşluk dışarıda.
    ogeler: [Vec<(usize, usize)>; 2],
}

impl Tarama {
    /// Kök dizilerin aralıkları, metindeki sırayla (boşaltılacak kesikler).
    fn kesikler(&self) -> Vec<(usize, usize)> {
        let mut k: Vec<(usize, usize)> = self.diziler.iter().flatten().copied().collect();
        k.sort_unstable();
        k
    }
}

fn bosluk(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

/// Metni ağaç kurmadan bir kez geçer: parantez dengesi, dizgilerin sonu, kökteki `kayitlar` ve `retler`
/// dizilerinin öğe aralıkları ve sınırlar (`KOK_DIZILERI`'nin öğe sınırları: sayım aşınca hemen durur;
/// `DIS_SOZCUK_AZAMI`, `DERINLIK_AZAMI`). Sayılar, sabitler ve nesnelerin iç dizilişi burada denetlenmez: iki
/// dizinin dışını ve her öğeyi serde_json okur. Bellek: parantez yığını (en çok `DERINLIK_AZAMI`) ve öğe
/// aralıkları; anahtar ve dizgi kopyalanmaz (dış bölüm sınırı taramadan sonra uygulanır).
fn yapi_tara(metin_: &str) -> Result<Tarama, CekirdekHatasi> {
    let b = metin_.as_bytes();
    let mut t = Tarama::default();
    let mut yigin: Vec<u8> = Vec::new();
    let mut dis_sozcuk = 0usize;
    // Kök nesnede: sıradaki dizgi anahtar mı; son anahtar hangi kök dizinin adıydı; o adlar görüldü mü.
    let (mut anahtar_bekleniyor, mut hedef, mut goruldu) = (false, None::<usize>, [false; 2]);
    // İçinde bulunulan kök dizi; dizinin başı; süren öğenin başı; son ayraç virgül müydü.
    let (mut dizide, mut dizi_basi, mut oge_basi, mut virgulden_sonra) = (None::<usize>, 0usize, None::<usize>, false);
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if bosluk(c) {
            i += 1;
            continue;
        }
        // Bir değer (ya da kök dışında anahtar) başlıyor mu: kapanış ve ayraçlar dışında her sözcük.
        let anahtar = c == b'"' && anahtar_bekleniyor && yigin.len() == 1;
        if !matches!(c, b'}' | b']' | b',' | b':') && !anahtar {
            match dizide {
                Some(d) if yigin.len() == 2 => {
                    if oge_basi.is_some() {
                        return Err(json_degil(metin_, i + 1));
                    }
                    let (ad, azami) = KOK_DIZILERI[d];
                    if t.ogeler[d].len() >= azami {
                        return Err(cok_fazla(ad, azami));
                    }
                    oge_basi = Some(i);
                    virgulden_sonra = false;
                }
                Some(_) => {}
                None => dis_sozcuk += 1,
            }
        }
        if anahtar {
            dis_sozcuk += 1;
        }
        if dis_sozcuk > DIS_SOZCUK_AZAMI {
            return Err(cok_fazla("belge", DIS_SOZCUK_AZAMI));
        }
        match c {
            b'{' | b'[' => {
                if c == b'['
                    && yigin.len() == 1
                    && let Some(d) = hedef
                {
                    dizide = Some(d);
                    dizi_basi = i;
                    virgulden_sonra = false;
                }
                hedef = None;
                yigin.push(c);
                if yigin.len() > DERINLIK_AZAMI {
                    return Err(belge_hatasi("belge", &format!("çok derin (en çok {DERINLIK_AZAMI})")));
                }
                anahtar_bekleniyor = yigin.len() == 1 && c == b'{';
                i += 1;
            }
            b'}' | b']' => {
                let ac = if c == b'}' { b'{' } else { b'[' };
                if yigin.pop() != Some(ac) {
                    return Err(json_degil(metin_, i + 1));
                }
                if let Some(d) = dizide
                    && yigin.len() == 1
                {
                    // Kök dizinin kapanışı: süren öğe biter; boş öğe (`[1,]`) sözdizimi hatası.
                    match oge_basi.take() {
                        Some(bas) => t.ogeler[d].push((bas, oge_sonu(b, bas, i))),
                        None if virgulden_sonra => return Err(json_degil(metin_, i + 1)),
                        None => {}
                    }
                    dizide = None;
                    t.diziler[d] = Some((dizi_basi, i + 1));
                }
                i += 1;
            }
            b',' => {
                if let Some(d) = dizide
                    && yigin.len() == 2
                {
                    let Some(bas) = oge_basi.take() else { return Err(json_degil(metin_, i + 1)) };
                    t.ogeler[d].push((bas, oge_sonu(b, bas, i)));
                    virgulden_sonra = true;
                }
                if yigin.len() == 1 && yigin[0] == b'{' {
                    anahtar_bekleniyor = true;
                }
                hedef = None;
                i += 1;
            }
            b':' => {
                // Dizinin ayraç düzeyinde iki nokta hiçbir yerde geçerli değildir (`[:1]`, `[1,:2]`, `[:]`);
                // öğenin içindekini (daha derin) öğeyi okuyan serde_json, kökteki nesneninkini boşaltılmış
                // metni okuyan serde_json denetler.
                if dizide.is_some() && yigin.len() == 2 {
                    return Err(json_degil(metin_, i + 1));
                }
                i += 1;
            }
            b'"' => {
                let bas = i;
                i = dizgi_sonu(b, i).ok_or_else(|| json_degil(metin_, b.len()))?;
                hedef = None;
                if anahtar {
                    anahtar_bekleniyor = false;
                    let ham = &metin_[bas..i];
                    // Anahtar kopyalanmadan karşılaştırılır (dış bölüm sınırı taramadan sonradır: dev anahtar
                    // belgenin bir katı daha ayırmasın). Kaçışlı anahtar (bir harfi `\u` kaçışıyla yazılmış)
                    // serde_json onu da o adla okuduğu için çözülür, ama yalnız bir kök dizi adı olabilecek
                    // uzunluktaysa (`KOK_ADI_KACISLI_AZAMI`); daha uzunu o adlardan biri değildir.
                    let kok_dizisi = |ad: &str| KOK_DIZILERI.iter().position(|(a, _)| ad == *a);
                    let d = if !ham.contains('\\') {
                        kok_dizisi(&ham[1..ham.len() - 1])
                    } else if ham.len() <= KOK_ADI_KACISLI_AZAMI {
                        serde_json::from_str::<String>(ham).ok().and_then(|ad| kok_dizisi(&ad))
                    } else {
                        None
                    };
                    if let Some(d) = d {
                        if goruldu[d] {
                            return Err(belge_hatasi(KOK_DIZILERI[d].0, "yinelenen alan"));
                        }
                        goruldu[d] = true;
                        hedef = Some(d);
                    }
                }
            }
            _ => {
                hedef = None;
                while i < b.len() && !bosluk(b[i]) && !matches!(b[i], b',' | b':' | b'{' | b'[' | b'}' | b']' | b'"') {
                    i += 1;
                }
            }
        }
    }
    if !yigin.is_empty() {
        return Err(json_degil(metin_, b.len()));
    }
    Ok(t)
}

/// Boşaltılmış metnin (kesikler `[]` yapılmış) ofsetinin asıl metindeki karşılığı: `[]`'ın içinden sonraki
/// her konuma o kesiğin atılan uzunluğu eklenir.
fn kesik_ofseti(kesikler: &[(usize, usize)], o: usize) -> usize {
    let mut atilan = 0;
    for &(bas, son) in kesikler {
        if o > bas - atilan + 1 {
            atilan += son - bas - 2;
        } else {
            break;
        }
    }
    o + atilan
}

/// Dizginin kapanış tırnağının ardı (`i` açılış tırnağı); kapanmamışsa `None`.
fn dizgi_sonu(b: &[u8], mut i: usize) -> Option<usize> {
    i += 1;
    while i < b.len() {
        match b[i] {
            b'"' => return Some(i + 1),
            b'\\' => i += 2,
            _ => i += 1,
        }
    }
    None
}

/// `bas`'ta başlayıp `ayrac`'ta biten öğenin sonu (sondaki boşluk dışarıda).
fn oge_sonu(b: &[u8], bas: usize, ayrac: usize) -> usize {
    let mut son = ayrac;
    while son > bas && bosluk(b[son - 1]) {
        son -= 1;
    }
    son
}

/// Ağaç kurmadan tek bir JSON değerinin sözdizimi denetimi (önde ve arkada boşluk olabilir): ağacı kurulmayan
/// çok büyük kayıt öğesinde de (`KAYIT_AZAMI_BAYT` üstü) sözdizimi hatası bütün belgeyi reddetsin diye. serde_json'dan
/// gevşek değildir ve ondan katı da değildir: aynı metinleri kabul eder (iç içelik en çok `DERINLIK_AZAMI`,
/// eşsiz vekil kaçışı reddedilir, sayının kabulü serde_json'un kendisinden; testli: bulanıklaştırma ve f64
/// sınırının iki yanı). Bellek: parantez yığını. Hata: bozuk baytın ofseti.
fn sozdizimi_denetle(m: &str) -> Result<(), usize> {
    /// Sıradaki beklenen sözcük.
    #[derive(Clone, Copy, PartialEq)]
    enum Bek {
        Deger,
        /// `[`'dan sonra: değer ya da `]`.
        DegerYaDaKapanis,
        /// `{`'dan sonra: anahtar ya da `}`.
        AnahtarYaDaKapanis,
        /// Nesnede `,`'den sonra.
        Anahtar,
        IkiNokta,
        /// Bir değerden sonra: `,` ya da kapanış (kökte metnin sonu).
        Ayrac,
    }
    let b = m.as_bytes();
    let mut yigin: Vec<u8> = Vec::new();
    let mut bek = Bek::Deger;
    let mut i = 0;
    loop {
        while i < b.len() && bosluk(b[i]) {
            i += 1;
        }
        let c = b.get(i).copied();
        match bek {
            Bek::Ayrac => match (yigin.last(), c) {
                (None, None) => return Ok(()),
                (Some(&ac), Some(b',')) => {
                    i += 1;
                    bek = if ac == b'{' { Bek::Anahtar } else { Bek::Deger };
                }
                (Some(b'{'), Some(b'}')) | (Some(b'['), Some(b']')) => {
                    yigin.pop();
                    i += 1;
                }
                _ => return Err(i),
            },
            Bek::IkiNokta if c == Some(b':') => {
                i += 1;
                bek = Bek::Deger;
            }
            Bek::AnahtarYaDaKapanis | Bek::DegerYaDaKapanis if c == Some(if bek == Bek::AnahtarYaDaKapanis { b'}' } else { b']' }) => {
                yigin.pop();
                i += 1;
                bek = Bek::Ayrac;
            }
            Bek::AnahtarYaDaKapanis | Bek::Anahtar if c == Some(b'"') => {
                i = dizgi_denetle(b, i)?;
                bek = Bek::IkiNokta;
            }
            Bek::Deger | Bek::DegerYaDaKapanis => {
                match c {
                    Some(ac @ (b'{' | b'[')) => {
                        yigin.push(ac);
                        if yigin.len() > DERINLIK_AZAMI {
                            return Err(i);
                        }
                        i += 1;
                        bek = if ac == b'{' { Bek::AnahtarYaDaKapanis } else { Bek::DegerYaDaKapanis };
                        continue;
                    }
                    Some(b'"') => i = dizgi_denetle(b, i)?,
                    Some(b'-' | b'0'..=b'9') => i = sayi_denetle(m, i)?,
                    Some(b't' | b'f' | b'n') => {
                        let sabit: &[u8] = match c {
                            Some(b't') => b"true",
                            Some(b'f') => b"false",
                            _ => b"null",
                        };
                        if !b[i..].starts_with(sabit) {
                            return Err(i);
                        }
                        i += sabit.len();
                    }
                    _ => return Err(i),
                }
                bek = Bek::Ayrac;
            }
            _ => return Err(i),
        }
    }
}

/// Dizginin kapanış tırnağının ardı (`i` açılış tırnağı): kaçışlar ve vekil çiftleri denetlenir, U+0020
/// altı ham karakter reddedilir (serde_json gibi).
fn dizgi_denetle(b: &[u8], mut i: usize) -> Result<usize, usize> {
    let hex = |i: usize| -> Result<u32, usize> {
        let s = b.get(i..i + 4).ok_or(i)?;
        s.iter().try_fold(0u32, |n, &h| Ok(n * 16 + char::from(h).to_digit(16).ok_or(i)?))
    };
    i += 1;
    loop {
        match *b.get(i).ok_or(i)? {
            b'"' => return Ok(i + 1),
            c if c < 0x20 => return Err(i),
            b'\\' => match *b.get(i + 1).ok_or(i + 1)? {
                b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => i += 2,
                b'u' => {
                    let n = hex(i + 2)?;
                    i += 6;
                    if (0xdc00..=0xdfff).contains(&n) {
                        return Err(i);
                    }
                    if (0xd800..=0xdbff).contains(&n) {
                        if b.get(i..i + 2) != Some(b"\\u") || !(0xdc00..=0xdfff).contains(&hex(i + 2)?) {
                            return Err(i);
                        }
                        i += 6;
                    }
                }
                _ => return Err(i + 1),
            },
            _ => i += 1,
        }
    }
}

/// Sayının ardı (`i` ilk bayt): JSON dilbilgisi (`-?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)?`). Dilbilgisine
/// uyan sayının kabulü serde_json'un kendisinden: aynı ayrıştırıcı, f64 sınırında (en büyük sonlu değer ve
/// sonsuza yuvarlanan) aynı yuvarlama, özellik bayraklarından bağımsız. Ağaç ve ayırma yoktur (sayı değeri).
fn sayi_denetle(m: &str, bas: usize) -> Result<usize, usize> {
    let b = m.as_bytes();
    let mut i = bas;
    let rakamlar = |i: &mut usize| -> usize {
        let once = *i;
        while b.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i - once
    };
    if b[i] == b'-' {
        i += 1;
    }
    match b.get(i) {
        Some(b'0') => i += 1,
        Some(b'1'..=b'9') => {
            rakamlar(&mut i);
        }
        _ => return Err(i),
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
        if rakamlar(&mut i) == 0 {
            return Err(i);
        }
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(b.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if rakamlar(&mut i) == 0 {
            return Err(i);
        }
    }
    if serde_json::from_str::<Value>(&m[bas..i]).is_err() {
        return Err(bas);
    }
    Ok(i)
}

/// Belgenin üst düzeyini okur (kayıt ve ret öğeleri ayrı ayrı `plan_kur`'da). Hata: `GecersizGirdi{alan,
/// neden}`. Sınırlar ağaçtan ve kopyadan önce: belge `BELGE_AZAMI_BAYT`, tarama (`yapi_tara`), iki kök
/// dizinin dışı `DIS_AZAMI_BAYT`.
fn belge_coz(metin_: &str) -> Result<Belge<'_>, CekirdekHatasi> {
    if metin_.len() > BELGE_AZAMI_BAYT {
        return Err(cok_buyuk(BELGE_AZAMI_BAYT));
    }
    let mut tarama = yapi_tara(metin_)?;
    let kesikler = tarama.kesikler();
    let dis = metin_.len() - kesikler.iter().map(|(bas, son)| son - bas).sum::<usize>();
    if dis > DIS_AZAMI_BAYT {
        return Err(belge_hatasi("belge", &format!("çok büyük (kayıtlar dışı en çok {} MiB)", DIS_AZAMI_BAYT / (1024 * 1024))));
    }
    // Kök dizileri boşaltılmış metin (ağaç yalnız üst düzey için kurulur); hata konumu asıl metne çevrilir.
    let kirpik: std::borrow::Cow<str> = if kesikler.is_empty() {
        metin_.into()
    } else {
        let mut k = String::with_capacity(dis + 2 * kesikler.len());
        let mut once = 0;
        for &(bas, son) in &kesikler {
            k.push_str(&metin_[once..bas]);
            k.push_str("[]");
            once = son;
        }
        k.push_str(&metin_[once..]);
        k.into()
    };
    let mut v: Value = serde_json::from_str(&kirpik)
        .map_err(|e| json_degil(metin_, kesik_ofseti(&kesikler, ofset(&kirpik, e.line(), e.column()))))?;
    drop(kirpik);
    let Value::Object(harita) = &mut v else { return Err(belge_hatasi("belge", "nesne değil")) };
    if harita.get("bicim").and_then(Value::as_str) != Some(BICIM) {
        return Err(belge_hatasi("bicim", "ajanda yedeği değil"));
    }
    let surum = |h: &Map<String, Value>, ad: &'static str| -> Result<i64, CekirdekHatasi> {
        match h.get(ad) {
            Some(s) => tam_sayi(s, ad, 1, GUVENLI_TAM_SAYI).map_err(sema_hatasi),
            None => Err(belge_hatasi(ad, "zorunlu alan yok")),
        }
    };
    let bicim_surumu = surum(harita, "bicim_surumu")?;
    if bicim_surumu > BICIM_SURUMU {
        return Err(belge_hatasi("bicim_surumu", "daha yeni bir biçim: uygulamayı güncelleyin"));
    }
    if surum(harita, "sozlesme_surumu")? > AJANDA_SURUMU {
        return Err(belge_hatasi("sozlesme_surumu", "daha yeni bir sözleşme: uygulamayı güncelleyin"));
    }
    // Büyük diziler kopyalanmadan alınır; kalan üst düzey katı okunur.
    let mut dizi = |ad: &'static str| match harita.remove(ad) {
        Some(Value::Array(a)) => Ok(a),
        Some(_) => Err(belge_hatasi(ad, "dizi değil")),
        None => Err(belge_hatasi(ad, "zorunlu alan yok")),
    };
    // Kök diziler dizi ise tarama boşaltmıştır; öğeleri taramanın aralıklarıdır. Biçim 1'de `retler` yoktur:
    // kalırsa katı okuyucu bilinmeyen alan diye reddeder.
    dizi("kayitlar")?;
    let retler = if bicim_surumu >= BICIM_RETLI {
        dizi("retler")?;
        std::mem::take(&mut tarama.ogeler[RETLER])
    } else {
        Vec::new()
    };
    let ek_ogeleri = dizi("ekler")?;
    if !dizi("bolgeler")?.is_empty() {
        return Err(belge_hatasi("bolgeler", "bu biçim sürümünde bölge öğesi tanımsız"));
    }
    if ek_ogeleri.len() > EK_AZAMI_ADET {
        return Err(cok_fazla("ekler", EK_AZAMI_ADET));
    }
    let mut ekler = Vec::with_capacity(ek_ogeleri.len());
    let mut ozetler = HashSet::new();
    for (i, e) in ek_ogeleri.iter().enumerate() {
        let yol = format!("ekler.{i}");
        let ek = ek_oku(e, &yol).map_err(sema_hatasi)?;
        if !ozetler.insert(ek.ozet.clone()) {
            return Err(belge_hatasi(&format!("{yol}.ozet"), "yinelenen ozet"));
        }
        ekler.push(ek);
    }
    let mut n = Nesne::ac(&v, "").map_err(sema_hatasi)?;
    n.ham("bicim");
    n.ham("bicim_surumu");
    n.ham("sozlesme_surumu");
    let olusturma_ms = n.zorunlu("olusturma_ms", zaman_ms_oku).map_err(sema_hatasi)?;
    n.zorunlu("kip", |v, y| match metin(v, y)? {
        "yerel" | "bagli" => Ok(()),
        _ => hata(y, "kapalı listede yok"),
    })
    .map_err(sema_hatasi)?;
    n.zorunlu("uygulama_surumu", |v, y| {
        let s = metin(v, y)?;
        if (1..=64).contains(&s.len()) { Ok(()) } else { hata(y, "1-64 karakter") }
    })
    .map_err(sema_hatasi)?;
    n.bitir().map_err(sema_hatasi)?;
    Ok(Belge {
        metin: metin_,
        olusturma_ms,
        kayitlar: std::mem::take(&mut tarama.ogeler[KAYITLAR]),
        retler,
        ekler,
        bicim: bicim_surumu,
    })
}

/// Ret öğesinin `neden`'i biçim 3'te kapalı listenin dışında da olabilir: ret listesinin yerel adları
/// (`ertelenen_atildi`, `ertelenen_atildi_yollanmis` ve ileride eklenecekler) olduğu gibi taşınır. İçerik
/// taşımasın diye yalnız 1-64 küçük harf, rakam ve alt çizgi.
fn yerel_neden_mi(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// Yalnız türü taşıyan `islem_json` (biçim 2 içe aktarmasının yazdığı).
fn tur_ozeti(tur: IslemTuru) -> String {
    serde_json::json!({ "islem": tur.ad() }).to_string()
}

/// Bir ret öğesi (`retler`), katı. Biçim 2: `{govde, islem, islem_id, kayit_id, neden, ts_ms}`, `neden` kapalı
/// listenin adı; ret listesine `islem_json` olarak yalnız türü (`{"islem": tür}`) yazılır. Biçim 3 ret listesi
/// satırını bütünüyle taşır: ayrıca `islem_json` (satırın metni, bayt bayt: işlemin kendisi, kullanıcının
/// attığı ertelenen değişikliğin taban bilgisiyle hali, okunamayan kuyruk satırı ya da kaydın hali; v3
/// değişikliği, durum, örnekler ve ileri sürüm alanları kaybolmaz) ve `kayit_sonra_degisti` (yalnız `true`);
/// `neden` yerel ad da olabilir (`yerel_neden_mi`); `islem_json` varsa `govde` isteğe bağlıdır. `islem`
/// ret listesinin gösterdiği türdür. Döner: ret listesine yazılacak satır (gövde modelin yazımıyla) ve
/// "kayıt sonra değişti" işareti.
fn ret_oku(v: &Value, yol: &str, bicim: i64) -> Sonuc<(RetSatiri, bool)> {
    let genis = bicim >= BICIM_GENIS_RET;
    let mut n = Nesne::ac(v, yol)?;
    let govde_oku = |v: &Value, y: &str| -> Sonuc<KayitGovdesi> {
        let mut g = Nesne::ac(v, y)?;
        let govde = KayitGovdesi::alanlari_oku(&mut g)?;
        g.bitir()?;
        Ok(govde)
    };
    let govde = if genis { n.istege_bagli("govde", govde_oku)? } else { Some(n.zorunlu("govde", govde_oku)?) };
    let islem = n.zorunlu("islem", IslemTuru::oku)?;
    let islem_id = n.zorunlu("islem_id", opak_id_oku)?;
    let kayit_id = n.zorunlu("kayit_id", opak_id_oku)?;
    let neden = n.zorunlu("neden", |v, y| match metin(v, y)? {
        s if genis && yerel_neden_mi(s) => Ok(s.to_string()),
        _ => KuyrukRetNedeni::oku(v, y).map(|k| k.ad().to_string()),
    })?;
    let ts_ms = n.zorunlu("ts_ms", zaman_ms_oku)?;
    let (islem_json, sonra) = if genis {
        (
            n.istege_bagli("islem_json", |v, y| metin(v, y).map(str::to_string))?,
            n.istege_bagli("kayit_sonra_degisti", |v, y| if mantik(v, y)? { Ok(()) } else { hata(y, "yalnız true") })?.is_some(),
        )
    } else {
        (None, false)
    };
    n.bitir()?;
    if govde.is_none() && islem_json.is_none() {
        return hata(&alt_yol(yol, "govde"), "zorunlu alan yok");
    }
    let satir = RetSatiri {
        islem_id,
        kayit_id,
        islem_json: islem_json.unwrap_or_else(|| tur_ozeti(islem)),
        neden,
        ts_ms,
        govde_json: govde.map(|g| g.alanlari_yaz(Yazici::yeni()).bitir().to_string()),
        sira: 0,
    };
    Ok((satir, sonra))
}

/// Dışa aktarmanın ret öğesi (sıkışık JSON) ve gerektirdiği biçim sürümü, ya da `None` (yedeğe girmez,
/// `ret_listesinde` sayılır): kimliği ya da anı şemadan geçmiyor, ne gövdesi ne taşınacak işlem metni var, öğe
/// sınırını (`KAYIT_AZAMI_BAYT`) aşıyor. `sonra`: girdinin "kayıt sonra değişti" işareti
/// (`Depo::ret_sonra_degisenler`; yedekle taşınır). Biçim 2 yalnız hiçbir şey kaybolmayacaksa yazılır (gövde
/// var, neden kapalı listede, `islem_json` yalnız türü taşıyor, işaret yok); yoksa biçim 3: satırın
/// `islem_json`'u ve nedeni olduğu gibi (`ret_oku`). Tür ret listesinin gösterdiği gibidir
/// (`sorgu::ret_listesi`: okunamayan tür `guncelle`). Öğe yazılmadan içe aktarmanın okuyucusundan ve öğe
/// sınırından geçer: yazılan her ret öğesi geri okunur.
fn ret_ogesi(r: &RetSatiri, sonra: bool) -> Option<(String, i64)> {
    let govde: Option<Value> = r.govde_json.as_deref().and_then(|g| serde_json::from_str(g).ok());
    let tur = serde_json::from_str::<Value>(&r.islem_json)
        .ok()
        .and_then(|v| v.get("islem").and_then(Value::as_str).and_then(IslemTuru::coz))
        .unwrap_or(IslemTuru::Guncelle);
    let kapali = KuyrukRetNedeni::coz(&r.neden);
    let ozet = r.islem_json == tur_ozeti(tur);
    let genis = govde.is_none() || kapali.is_none() || !ozet || sonra;
    let mut m = Map::new();
    if let Some(g) = govde {
        m.insert("govde".into(), g);
    }
    m.insert("islem".into(), tur.ad().into());
    m.insert("islem_id".into(), r.islem_id.clone().into());
    m.insert("kayit_id".into(), r.kayit_id.clone().into());
    m.insert("ts_ms".into(), r.ts_ms.into());
    if genis {
        // Taşınamayan (biçimsiz) neden ret listesinin gösterdiği gibi.
        let neden = if yerel_neden_mi(&r.neden) { r.neden.as_str() } else { KuyrukRetNedeni::GecersizIslem.ad() };
        m.insert("neden".into(), neden.into());
        if !ozet {
            m.insert("islem_json".into(), r.islem_json.clone().into());
        }
        if sonra {
            m.insert("kayit_sonra_degisti".into(), true.into());
        }
    } else {
        m.insert("neden".into(), kapali.unwrap_or(KuyrukRetNedeni::GecersizIslem).ad().into());
    }
    let bicim = if genis { BICIM_GENIS_RET } else { BICIM_RETLI };
    let v = Value::Object(m);
    ret_oku(&v, "", bicim).ok()?;
    let metin_ = v.to_string();
    (metin_.len() <= KAYIT_AZAMI_BAYT).then_some((metin_, bicim))
}

/// Değerin iç içeliği (kap sayısı: sayı ve metin 0, boş dizi 1).
fn derinlik(v: &Value) -> usize {
    match v {
        Value::Array(a) => 1 + a.iter().map(derinlik).max().unwrap_or(0),
        Value::Object(o) => 1 + o.values().map(derinlik).max().unwrap_or(0),
        _ => 0,
    }
}

/// Bir kaydın sınıfı (`plan_kur`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sinif {
    Yeni,
    Guncellenecek,
    Ayni,
    Atlanacak,
    Gecersiz,
    SinirAsan,
    Gonderilmeyecek,
    /// Bağlı kipte telefonda olmayan taslak: servis taslak olarak alamaz, gönderilmez.
    Taslak,
}

/// Yazılacak kayıt: dosyadaki hal (`taslagi_koru`'dan geçmiş), telefondaki önceki hal (okunabildiyse) ve
/// bağlı kipte kuyruğa girecek işlemler.
struct Yazilacak {
    kayit: AjandaKaydi,
    onceki: Option<AjandaKaydi>,
    islemler: Vec<(AjandaIslem, i64)>,
    /// Yerel kipte telefondaki satır okunamıyorsa onun metni: ret listesine düşer (kaybolmasın).
    okunamayan: Option<String>,
}

/// Planın bir yazımı (uygulamanın ikinci geçişinde, sınıflandığı anda).
enum Yazim {
    Kayit(Box<Yazilacak>),
    /// Ret listesine geri yazılacak girdi (`retler`) ve "kayıt sonra değişti" işareti.
    Ret(RetSatiri, bool),
}

/// Bir ret öğesinin sınıfı (ize girer; kayıt sınıflarından ayrı değerler).
#[derive(Clone, Copy)]
enum RetSinifi {
    Gelecek = 0x40,
    /// Telefonun ret listesinde aynı `islem_id` var: yinelenmez.
    Var = 0x41,
    Gecersiz = 0x42,
    /// Kaydı yedekten sonra değişmiş (ya da bilinemiyor): işaretle gelir (`ret_sonra_degisen`).
    SonraDegisti = 0x43,
    /// Ret listesinin sınırı dolu: alınmaz (`ret_sinir_asan`).
    SinirAsan = 0x44,
}

/// FNV-1a 64: planın izi (aynı süreçte ve sürümde karşılaştırılır; güvenlik değil, tutarlılık içindir).
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

/// Revizyon ve güncelleme anı dışında eşit mi (yerel kipte "aynı").
fn yerelde_ayni(a: &AjandaKaydi, b: &AjandaKaydi) -> bool {
    let n = |k: &AjandaKaydi| AjandaKaydi { revizyon: 1, guncelleme_ms: 0, ..k.clone() };
    n(a) == n(b)
}

/// Dosyadaki onaylı mezar taşı telefondaki taslağın yerine geçiyorsa kayıt taslak kalır (`motor/aktarma.rs`
/// başı, taslağın onaylanması): silinmiş kaydın onayı görünmez, bağlı kipte `onayla` gitmez.
fn taslagi_koru(k: &AjandaKaydi, once_taslak: bool) -> AjandaKaydi {
    if once_taslak && k.silindi && !k.taslak { AjandaKaydi { taslak: true, ..k.clone() } } else { k.clone() }
}

/// Dilimi bilinmeyen alanın yolu (zamanın ya da `mutlak` hatırlatmanın dilimi), yoksa `None`.
fn dilim_sorunu(k: &AjandaKaydi, bilinir: &mut impl FnMut(&str) -> bool) -> Option<&'static str> {
    if let Some(d) = k.zaman.as_ref().and_then(|z| z.saat_dilimi())
        && !bilinir(d)
    {
        return Some("zaman.saat_dilimi");
    }
    for h in &k.hatirlatmalar {
        if let Hatirlatma::Mutlak { saat_dilimi, .. } = h
            && !bilinir(saat_dilimi)
        {
            return Some("hatirlatmalar");
        }
    }
    None
}

/// Öğenin ağacı: öğe sınırını aşan (`KAYIT_AZAMI_BAYT`) öğe ağaca çevrilmez (`Ok(None)`) ama sözdizimi yine
/// denetlenir; sözdizimi hatası bütün belgeyi reddeder (dosya bozuk), konum asıl metinde.
fn oge_agaci(metin_: &str, bas: usize, son: usize) -> Result<Option<Value>, CekirdekHatasi> {
    let ham = &metin_[bas..son];
    if ham.len() > KAYIT_AZAMI_BAYT {
        sozdizimi_denetle(ham).map_err(|o| json_degil(metin_, bas + o + 1))?;
        return Ok(None);
    }
    serde_json::from_str(ham).map(Some).map_err(|e| json_degil(metin_, bas + ofset(ham, e.line(), e.column())))
}

/// Telefonun şimdiki haline göre planı kurar. `yerel`: çalışma kipi. `yaz`: her yazılacak (kayıt ya da ret
/// girdisi) sınıflandığı anda verilir, hiçbiri bellekte tutulmaz; önizleme boş geri çağırımla kurar.
/// Önizleme ve uygulama aynı sınıflamayı, sayıları ve izi verir. Bellek: belge metni + öğe aralıkları +
/// kimlik kümeleri + telefonun satırları + o anki tek öğe (`tests/aktarma_bellek.rs`).
fn plan_kur(
    d: &Depo,
    o: &Ortam,
    belge: &Belge,
    yerel: bool,
    yaz: &mut dyn FnMut(Yazim) -> Result<(), CekirdekHatasi>,
) -> Result<IceAktarmaOnizlemesi, CekirdekHatasi> {
    let telefondaki: HashMap<String, String> = d.gorunen_ham_hepsi()?.into_iter().collect();
    let mut kalan_yer = (KAYIT_ADET as i64 - telefondaki.len() as i64).max(0);
    let mut dilimler: HashMap<String, bool> = HashMap::new();
    let simdi = o.simdi_ms();
    let mut bilinir = |dilim: &str| {
        *dilimler.entry(dilim.to_string()).or_insert_with(|| o.zaman.andan_yerele(simdi, dilim.to_string()).is_ok())
    };
    let gelecek_siniri = simdi.saturating_add(GELECEK_TOLERANSI_MS);
    let mut gorulen: HashSet<String> = HashSet::new();
    // Telefondaki (okunabilen) hali dosyadakinden farklı olup kalan kayıtlar: dosyadan sonra değişmişlerdir.
    // Yalnız ret öğesi varsa tutulur (bayat ret girdisi).
    let retler_var = !belge.retler.is_empty();
    let mut sonra_degisen: HashSet<String> = HashSet::new();
    let mut iz = Iz::yeni();
    iz.kat(kip_adi(yerel).as_bytes());
    for e in &belge.ekler {
        iz.kat(ek_json(e).to_string().as_bytes());
    }
    let mut p = IceAktarmaOnizlemesi {
        kip: if yerel { CalismaKipi::Yerel } else { CalismaKipi::Bagli },
        disa_aktarma_ms: belge.olusturma_ms,
        toplam: sayi(belge.kayitlar.len()),
        silinmis: 0,
        yeni: 0,
        guncellenecek: 0,
        ayni: 0,
        atlanacak: 0,
        gecersiz: 0,
        sinir_asan: 0,
        gonderilmeyecek: 0,
        kuyruga_girecek_islem: 0,
        gecersizler: Vec::new(),
        ekler: belge.ekler.clone(),
        iz: String::new(),
        silinecek: 0,
        geri_yuklenecek: 0,
        taslak_gonderilmeyecek: 0,
        taslak_onaylanacak: 0,
        okunamayan_ret_listesine: 0,
        taslaga_donecek: 0,
        ret_listesine_gelecek: 0,
        ret_gecersiz: 0,
        ret_bayat: 0,
        ret_sonra_degisen: 0,
        ret_sinir_asan: 0,
    };
    for (i, &(bas, son)) in belge.kayitlar.iter().enumerate() {
        // Dosyadaki içerik ize girer: aynı sınıflı başka bir dosya eski izle uygulanmaz.
        iz.kat(&belge.metin.as_bytes()[bas..son]);
        let kok = format!("kayitlar.{i}");
        let gecersiz = |alan: String, neden: &str| GecersizKayit { sira: sayi(i), alan, neden: neden.to_string() };
        let sonuc: Result<AjandaKaydi, GecersizKayit> = match oge_agaci(belge.metin, bas, son)? {
            None => Err(gecersiz(kok.clone(), "kayıt çok büyük")),
            Some(v) => AjandaKaydi::oku(&v, &kok).map_err(|h| gecersiz(guvenli_yol(&h.yol), h.neden)).and_then(|k| {
                if gorulen.contains(&k.kayit_id) {
                    return Err(gecersiz(format!("{kok}.kayit_id"), "dosyada yinelenen kayit_id"));
                }
                // `olusturma_ms <= guncelleme_ms` modelce zorunlu: ikisi de sınırlanır.
                if k.guncelleme_ms > gelecek_siniri {
                    return Err(gecersiz(format!("{kok}.guncelleme_ms"), "gelecekte (saat ileri ya da dosya bozuk)"));
                }
                match dilim_sorunu(&k, &mut bilinir) {
                    Some(alan) => Err(gecersiz(format!("{kok}.{alan}"), "saat dilimi bilinmiyor")),
                    None => Ok(k),
                }
            }),
        };
        let k = match sonuc {
            Ok(k) => k,
            Err(g) => {
                p.gecersiz += 1;
                if p.gecersizler.len() < GECERSIZ_ORNEK {
                    p.gecersizler.push(g);
                }
                iz.kat(&[Sinif::Gecersiz as u8]);
                continue;
            }
        };
        gorulen.insert(k.kayit_id.clone());
        if k.silindi {
            p.silinmis += 1;
        }
        let ayni = |t: &AjandaKaydi| if yerel { yerelde_ayni(t, &k) } else { icerik_ayni(t, &k) };
        // Telefondaki önceki halin (silindi, taslak) bayrakları: okunabildiyse kayıttan, okunamayan satırda
        // metnin alanlarından (doğru değilse canlı ve onaylı sayılır). Yeni kayıtta yok.
        let mut once: Option<(bool, bool)> = None;
        let (sinif, yazilacak) = match telefondaki.get(&k.kayit_id) {
            None if !yerel && k.silindi => (Sinif::Gonderilmeyecek, None),
            // Servis `ekle`'si onaylanmış kayıt doğurur: onaylanmamış öneri onaylanmış gibi gitmez.
            None if !yerel && k.taslak => (Sinif::Taslak, None),
            None if kalan_yer <= 0 => (Sinif::SinirAsan, None),
            None => {
                kalan_yer -= 1;
                let islemler = if yerel { Vec::new() } else { kuyruga_islemler(None, &k, false) };
                (Sinif::Yeni, Some(Yazilacak { kayit: k.clone(), onceki: None, islemler, okunamayan: None }))
            }
            Some(json) => match kayit_coz(json) {
                // Okunamayan telefon satırı: yerelde dosyadaki onu onarır, eski metin ret listesine düşer
                // (`ice_aktar`); bağlı kipte servise ne gideceği bilinemez, dokunulmaz.
                None if yerel => {
                    p.okunamayan_ret_listesine += 1;
                    let ham_v = serde_json::from_str::<Value>(json).ok();
                    let dogru = |alan: &str| ham_v.as_ref().and_then(|v| v.get(alan).and_then(Value::as_bool)) == Some(true);
                    once = Some((dogru("silindi"), dogru("taslak")));
                    let kayit = taslagi_koru(&k, dogru("taslak"));
                    (Sinif::Guncellenecek, Some(Yazilacak { kayit, onceki: None, islemler: Vec::new(), okunamayan: Some(json.clone()) }))
                }
                None => {
                    // Bağlı kipte okunamayan telefon satırı: ret girdisi için kaydın sonraki hali bilinemez.
                    if retler_var {
                        sonra_degisen.insert(k.kayit_id.clone());
                    }
                    (Sinif::Atlanacak, None)
                }
                Some(t) if ayni(&t) => (Sinif::Ayni, None),
                Some(t) if k.guncelleme_ms <= t.guncelleme_ms => {
                    if retler_var {
                        sonra_degisen.insert(k.kayit_id.clone());
                    }
                    (Sinif::Atlanacak, None)
                }
                Some(t) => {
                    once = Some((t.silindi, t.taslak));
                    let kayit = taslagi_koru(&k, t.taslak);
                    let islemler = if yerel { Vec::new() } else { kuyruga_islemler(Some(&t), &kayit, true) };
                    if !yerel && islemler.is_empty() {
                        (Sinif::Ayni, None)
                    } else {
                        (Sinif::Guncellenecek, Some(Yazilacak { kayit, onceki: Some(t), islemler, okunamayan: None }))
                    }
                }
            },
        };
        match sinif {
            Sinif::Yeni => p.yeni += 1,
            Sinif::Guncellenecek => p.guncellenecek += 1,
            Sinif::Ayni => p.ayni += 1,
            Sinif::Atlanacak => p.atlanacak += 1,
            Sinif::SinirAsan => p.sinir_asan += 1,
            Sinif::Gonderilmeyecek => p.gonderilmeyecek += 1,
            Sinif::Taslak => p.taslak_gonderilmeyecek += 1,
            Sinif::Gecersiz => unreachable!(),
        }
        iz.kat(&[sinif as u8]);
        iz.kat(k.kayit_id.as_bytes());
        if let Some(y) = yazilacak {
            // Etkilenecek kaydın telefondaki satırı (içerik ve yazım kimliği) ize girer: önizlemeden sonra
            // sınıfı değiştirmeden değişen telefon kaydı eski izle ezilmez.
            if let Some(json) = telefondaki.get(&k.kayit_id) {
                iz.kat(json.as_bytes());
            }
            if let Some((once_silindi, once_taslak)) = once {
                let sonra = &y.kayit;
                if !once_silindi && sonra.silindi {
                    p.silinecek += 1;
                }
                if once_silindi && !sonra.silindi {
                    p.geri_yuklenecek += 1;
                }
                // Telefondaki taslak dosyadaki daha yeni onaylı (ve canlı: `taslagi_koru`) halle onaylanır
                // (bağlı kipte `onayla` işlemi).
                if once_taslak && !sonra.taslak {
                    p.taslak_onaylanacak += 1;
                }
                // Telefondaki onaylı kayıt dosyadaki daha yeni taslak halle taslağa döner (yalnız yerel kipte:
                // bağlı kipte dökme kuralı bu farkı göndermez, `kuyruga_islemler`).
                if yerel && !once_taslak && sonra.taslak {
                    p.taslaga_donecek += 1;
                }
            }
            p.kuyruga_girecek_islem += sayi(y.islemler.len());
            yaz(Yazim::Kayit(Box::new(y)))?;
        }
    }
    // Ret girdileri: telefonda aynı `islem_id` varsa yinelenmez; dosyada yinelenen ve okunamayan geçersizdir;
    // kaydı dosyadan sonra değişmiş (ya da bu bilinemeyen) girdi işaretle gelir; ret listesi sınırı dolunca
    // kalanlar alınmaz.
    if retler_var {
        let telefondaki_retler: HashSet<String> = d.ret_islem_idleri()?.into_iter().collect();
        let mut ret_yeri = RET_DIZISI_AZAMI.saturating_sub(telefondaki_retler.len());
        let mut dosyadaki_retler: HashSet<String> = HashSet::new();
        for (i, &(bas, son)) in belge.retler.iter().enumerate() {
            iz.kat(&belge.metin.as_bytes()[bas..son]);
            let satir = oge_agaci(belge.metin, bas, son)?.and_then(|v| ret_oku(&v, &format!("retler.{i}"), belge.bicim).ok());
            let sinif = match satir {
                None => RetSinifi::Gecersiz,
                Some((r, _)) if !dosyadaki_retler.insert(r.islem_id.clone()) => RetSinifi::Gecersiz,
                Some((r, _)) if telefondaki_retler.contains(&r.islem_id) => RetSinifi::Var,
                Some(_) if ret_yeri == 0 => RetSinifi::SinirAsan,
                Some((r, dosyada_isaretli)) => {
                    ret_yeri -= 1;
                    let sonra = dosyada_isaretli || kayit_sonra_degisti_mi(&r, &sonra_degisen, &gorulen, &telefondaki);
                    p.ret_listesine_gelecek += 1;
                    if sonra {
                        p.ret_sonra_degisen += 1;
                    }
                    yaz(Yazim::Ret(r, sonra))?;
                    if sonra { RetSinifi::SonraDegisti } else { RetSinifi::Gelecek }
                }
            };
            match sinif {
                RetSinifi::Gecersiz => p.ret_gecersiz += 1,
                RetSinifi::SinirAsan => p.ret_sinir_asan += 1,
                RetSinifi::Gelecek | RetSinifi::Var | RetSinifi::SonraDegisti => {}
            }
            iz.kat(&[sinif as u8]);
        }
    }
    p.iz = format!("{:016x}", iz.0);
    Ok(p)
}

/// Ret girdisinin kaydı telefonda yedekten sonra değişmiş mi (ya da bu bilinemiyor mu): girdi kaydın eski bir
/// hali için yazılmıştı, düzeltmesi (gövde kaydın istenen tam hali) kaydın şimdiki halini ezerdi. Girdi yine
/// alınır (içeriği yalnız yedekte olabilir: D4'ün telefon hali, okunamayan satırın metni; bağlı kipte servis
/// kaydı yedekten sonra düzenlemiş olabilir), `kayit_sonra_degisti` işaretiyle: `ret_duzelt` onu var olan kayda
/// uygulamaz, yeni kayıt ekler. Girdi dosya yazılırken ret listesindeydi: kayıt dosyada geçerliyse telefondaki
/// hali dosyadakinden farklı olup kalıyorsa (`atlanacak`, bağlı kipte okunamayan telefon satırı da;
/// `sonra_degisen`) kayıt dosyadan, dolayısıyla girdiden sonra değişmiştir (iki an aynı kaydın anıdır: saat
/// kayması yanıltmaz). Dosyada geçerli hali yoksa ama kayıt telefonda varsa bilinemez (girdinin anı başka bir
/// telefonun, kaydınki servisin ya da bu telefonun saatindedir; ikisini karşılaştırmak saat kaymasıyla iki
/// yönde de yanılırdı): değişmiş sayılır, en kötü durumda yersiz bir uyarı ve kopya kayıt doğar, hiçbir şey
/// ezilmez. Kayıt telefonda yoksa ya da dosyadaki halle yazılacaksa (yeni, güncellenecek, aynı) girdi taze
/// sayılır: düzeltmesi girdinin yazıldığı halin üstüne gelir.
fn kayit_sonra_degisti_mi(r: &RetSatiri, sonra_degisen: &HashSet<String>, dosyada: &HashSet<String>, telefondaki: &HashMap<String, String>) -> bool {
    if dosyada.contains(&r.kayit_id) {
        return sonra_degisen.contains(&r.kayit_id);
    }
    telefondaki.contains_key(&r.kayit_id)
}

/// İçe aktarmanın yerel geçmiş satırı: yeni kayıtta doğum parçası (mezar taşı ve örnekler dahil), var olanda
/// servisin `fark`'ı. An içe aktarmanın anıdır (kaydın `guncelleme_ms`'i dosyadaki gibi kalır).
fn ice_aktarma_girdisi(onceki: Option<&AjandaKaydi>, yeni: &AjandaKaydi, yazar: AjandaYazar, ts_ms: i64) -> AjandaGecmisGirdisi {
    let (islem, temel_revizyon, onceki_p, sonraki_p) = match onceki {
        Some(o) => {
            let (a, b) = fark(o, yeni);
            (IslemTuru::Guncelle, Some(o.revizyon), a, b)
        }
        None => {
            let mut s = dogum_parcasi(yeni);
            if yeni.silindi {
                s.silindi = Some(true);
            }
            if !yeni.ornekler.is_empty() {
                s.ornekler = Some(yeni.ornekler.clone());
            }
            (IslemTuru::Ekle, None, AjandaParca::default(), s)
        }
    };
    AjandaGecmisGirdisi {
        rev: yeni.revizyon,
        ts_ms,
        islem,
        yazar,
        temel_revizyon,
        korunan_alanlar: None,
        ornek_tarihi: None,
        onceki: onceki_p,
        sonraki: sonraki_p,
    }
}

fn sayi(n: usize) -> i32 {
    i32::try_from(n).unwrap_or(i32::MAX)
}

impl Motor {
    /// Bayt olarak verilen belgenin metni (köprünün `_bayt` eşleri; kopyasız). Önce boyut (`belge_coz`'unkiyle
    /// aynı hata), sonra UTF-8: değilse `GecersizGirdi{alan: "belge", neden: "UTF-8 değil (bayt N)"}` (yalnız
    /// konum). Baştaki BOM ayıklanmaz: `String` yolundaki gibi JSON değildir.
    pub(crate) fn belge_utf8(baytlar: &[u8]) -> Result<&str, CekirdekHatasi> {
        if baytlar.len() > BELGE_AZAMI_BAYT {
            return Err(cok_buyuk(BELGE_AZAMI_BAYT));
        }
        std::str::from_utf8(baytlar).map_err(|e| belge_hatasi("belge", &format!("UTF-8 değil (bayt {})", e.valid_up_to())))
    }

    /// Dışa aktarma: görünen kopyanın bütün satırları (mezar taşları dahil; bağlı kipte gönderilmemiş
    /// değişiklikler dahil) ve ret listesinin düzeltme gövdesi ya da ham metni olan girdileri (varsa biçim 2,
    /// genişlemiş öğe varsa 3: `ret_ogesi`). Okunamayan satır kaybolmaz: JSON'u bayt bayt olduğu gibi (o da
    /// değilse ya da belgenin iç içelik sınırını aşacaksa metni)
    /// belgeye girer ve sayılır. Belge içe aktarmanın sınırlarını aşıyorsa yine yazılır ve söylenir
    /// (`ice_aktarma_sinirini_asiyor`). Hiçbir şey yazmaz.
    pub(crate) fn disa_aktar(&self, o: &Ortam) -> Result<DisaAktarma, CekirdekHatasi> {
        let yerel = self.yerel_mi()?;
        let satirlar = self.depo.gorunen_ham_hepsi()?;
        // Belge ağaç kurulmadan yazılır: her kaydın sıkışık metni satırın yerine geçer (bellek: satırlar +
        // belge + o anki kaydın ağacı), üst düzey sonra sıralı anahtarlarla eklenir. Okunamayan JSON satırı
        // yoksa çıktı `json!` ağacının `to_string`'iyle bayt bayt aynıdır (sıkışık yazım bileşimlidir);
        // okunamayan JSON satırı olduğu gibi girer.
        let mut kayitlar: Vec<String> = Vec::with_capacity(satirlar.len());
        let mut ekler: BTreeMap<String, EkDosyasi> = BTreeMap::new();
        let (mut silinmis, mut okunamayan) = (0, 0);
        for (_, json) in satirlar {
            match kayit_coz(&json) {
                Some(k) => {
                    silinmis += usize::from(k.silindi);
                    for e in kayit_ekleri(&k) {
                        ekler.entry(e.ozet.clone()).or_insert(e);
                    }
                    kayitlar.push(k.json().to_string());
                }
                None => {
                    okunamayan += 1;
                    // JSON'sa metin olduğu gibi (bayt bayt: yeniden yazım yinelenen anahtarı tekleştirir, büyük
                    // tam sayıyı yuvarlardı; JSON metni dizinin öğesi olarak olduğu gibi geçerlidir), değilse
                    // ya da belgenin iç içelik sınırını aşacaksa metin olarak. Kök nesne ve `kayitlar` dizisi iki
                    // düzeydir: daha derin öğe bütün belgeyi reddettirirdi.
                    let json_mu = serde_json::from_str::<Value>(&json).is_ok_and(|v| derinlik(&v) <= DERINLIK_AZAMI - 2);
                    kayitlar.push(if json_mu { json } else { Value::String(json).to_string() });
                }
            }
        }
        let ret_satirlari = self.depo.ret_listesi()?;
        let ret_toplam = ret_satirlari.len();
        let sonra_degisenler = self.depo.ret_sonra_degisenler()?;
        let mut bicim_surumu = 1;
        let retler: Vec<String> = ret_satirlari
            .iter()
            .filter_map(|r| ret_ogesi(r, sonra_degisenler.contains(&r.islem_id)))
            .take(RET_DIZISI_AZAMI)
            .map(|(m, b)| {
                bicim_surumu = bicim_surumu.max(b);
                m
            })
            .collect();
        drop(ret_satirlari);
        let ekler: Vec<EkDosyasi> = ekler.into_values().collect();
        let kayit = kayitlar.len();
        let alan = |ad: &str, deger: Value| format!("{}:{deger}", Value::from(ad));
        let bas = [
            alan("bicim", BICIM.into()),
            alan("bicim_surumu", bicim_surumu.into()),
            alan("bolgeler", Value::Array(Vec::new())),
            alan("ekler", Value::Array(ekler.iter().map(ek_json).collect())),
        ]
        .join(",");
        let mut son = vec![alan("kip", kip_adi(yerel).into()), alan("olusturma_ms", o.simdi_ms().into())];
        if bicim_surumu >= BICIM_RETLI {
            son.push(format!("\"retler\":[{}]", retler.join(",")));
        }
        son.push(alan("sozlesme_surumu", AJANDA_SURUMU.into()));
        son.push(alan("uygulama_surumu", env!("CARGO_PKG_VERSION").into()));
        let son = son.join(",");
        let govde: usize = kayitlar.iter().map(|k| k.len() + 1).sum();
        let mut belge = String::with_capacity(bas.len() + son.len() + govde + 16);
        belge.push('{');
        belge.push_str(&bas);
        belge.push_str(",\"kayitlar\":[");
        for (i, k) in kayitlar.into_iter().enumerate() {
            if i > 0 {
                belge.push(',');
            }
            belge.push_str(&k);
        }
        belge.push_str("],");
        belge.push_str(&son);
        belge.push('}');
        Ok(DisaAktarma {
            ice_aktarma_sinirini_asiyor: belge.len() > BELGE_AZAMI_BAYT || kayit > KAYIT_DIZISI_AZAMI,
            belge,
            kayit: sayi(kayit),
            silinmis: sayi(silinmis),
            okunamayan: sayi(okunamayan),
            ret_listesinde: sayi(ret_toplam - retler.len()),
            kip: if yerel { CalismaKipi::Yerel } else { CalismaKipi::Bagli },
            ekler,
            ret_yedekte: sayi(retler.len()),
            bicim_surumu,
        })
    }

    /// İçe aktarmanın önizlemesi (hiçbir şey yazmaz). Belge bütünüyle okunamazsa `GecersizGirdi`.
    pub(crate) fn ice_aktarma_onizlemesi(&self, o: &Ortam, belge: &str) -> Result<IceAktarmaOnizlemesi, CekirdekHatasi> {
        let belge = belge_coz(belge)?;
        plan_kur(&self.depo, o, &belge, self.yerel_mi()?, &mut |_| Ok(()))
    }

    /// İçe aktarma, tek SQLite işleminde (ya hepsi ya hiçbiri). Plan işlemin içinde yeniden kurulur; `iz`
    /// yoksa ya da tutmazsa hiçbir şey yazılmaz (şimdiki plan döner). Tutarsa plan ikinci kez kurulurken her
    /// yazılacak sınıflandığı anda yazılır (bellek önizlemeninki; yazımlardan biri hata verirse işlem geri
    /// alınır). Kalıcı olunca: alarm senkronu ve `Degisim` (çoksa `tumu`; ret listesine satır düştüyse
    /// `ret_listesi`), bağlı kipte kuyruk ilerler (`Degisim.baglanti`). Kalıcı işlemden sonraki adımların
    /// hatası çağrıyı başarısız yapmaz.
    pub(crate) fn ice_aktar(&mut self, o: &Ortam, e: &mut Etkiler, belge: &str, iz: Option<&str>) -> Result<IceAktarmaSonucu, CekirdekHatasi> {
        let belge = belge_coz(belge)?;
        let yerel = self.yerel_mi()?;
        let cevirici = o.cevirici();
        let b = self.iyimser_baglam(o, &cevirici)?;
        let yazar = AjandaYazar {
            yol: KaynakYolu::Elle,
            tur_kokeni: TurKokeni::Insan,
            device_id: Some(b.device_id.clone()),
            sohbet_id: None,
            oturum_id: None,
        };
        let ts_ms = o.simdi_ms();
        // Geçmiş satırı yalnız açık geçmiş sayfası olan kayıtlar için tutulur (yazılanların hepsi değil).
        let acik_sayfalar: HashSet<&String> = self.gecmis.keys().collect();
        let (plan, degisenler, girdiler) = self.depo.yazma(|d| {
            // İz zorunlu: kullanıcının görmediği plan uygulanmaz. Birinci geçiş yalnız izi kurar.
            let onizleme = plan_kur(d, o, &belge, yerel, &mut |_| Ok(()))?;
            if iz != Some(onizleme.iz.as_str()) {
                return Ok((IceAktarmaSonucu { uygulandi: false, plan: onizleme }, Vec::new(), Vec::new()));
            }
            let mut degisenler = Vec::new();
            let mut girdiler = Vec::new();
            let mut isaretli: Vec<String> = Vec::new();
            // İkinci geçiş: aynı işlemde aynı girdiyle aynı plan; telefonun satırları geçişin başında okunur,
            // yazımlar sınıflamayı değiştirmez.
            let plan = plan_kur(d, o, &belge, yerel, &mut |yazim| {
                let y = match yazim {
                    Yazim::Ret(r, sonra) => {
                        if sonra {
                            isaretli.push(r.islem_id.clone());
                        }
                        return d.ret_ekle(&r);
                    }
                    Yazim::Kayit(y) => *y,
                };
                let kayit_id = y.kayit.kayit_id.clone();
                if yerel {
                    if let Some(eski) = &y.okunamayan {
                        kaydi_ret_listesine(d, o, &kayit_id, eski, ts_ms)?;
                    }
                    let mut k = y.kayit;
                    k.revizyon = d.yerel_rev_sonraki(y.onceki.as_ref().map_or(0, |t| t.revizyon))?;
                    let girdi = ice_aktarma_girdisi(y.onceki.as_ref(), &k, yazar.clone(), ts_ms);
                    d.gorunen_yaz(&k, false)?;
                    d.yerel_rev_yaz(k.revizyon)?;
                    d.yerel_gecmis_ekle(&kayit_id, &girdi)?;
                    if acik_sayfalar.contains(&kayit_id) {
                        girdiler.push((kayit_id.clone(), girdi));
                    }
                    degisenler.push(kayit_id);
                } else {
                    for (islem, ts) in &y.islemler {
                        d.kuyruga_ekle(&Motor::yeni_kimlik(o, "i_")?, &kayit_id, &islem.json().to_string(), *ts)?;
                    }
                    if gorunen_yenile(d, &b, &kayit_id)? {
                        degisenler.push(kayit_id);
                    }
                }
                Ok(())
            })?;
            d.ret_sonra_degisti_isaretle(&isaretli)?;
            debug_assert_eq!(plan, onizleme, "iki geçiş aynı planı kurar");
            Ok((IceAktarmaSonucu { uygulandi: true, plan }, degisenler, girdiler))
        })?;
        if !plan.uygulandi {
            return Ok(plan);
        }
        if degisenler.len() > TELAFI_TAMPONU {
            self.hepsi_degisti(o, e);
        } else {
            self.gorunenler_degisti(o, e, &degisenler);
        }
        // Açık geçmiş sayfası (yerel tablodan) yeni satırı başta görsün.
        for (kayit_id, girdi) in girdiler {
            if let Some(sayfa) = self.gecmis.get_mut(&kayit_id) {
                sayfa.satirlar.insert(0, gecmis_satiri(girdi));
                e.degisim.gecmis.push(kayit_id);
            }
        }
        if plan.plan.okunamayan_ret_listesine > 0 || plan.plan.ret_listesine_gelecek > 0 {
            e.degisim.ret_listesi = true;
        }
        if !yerel && plan.plan.kuyruga_girecek_islem > 0 {
            e.degisim.baglanti = true;
            // Kalıcı işlemden sonra: kuyruğun hatası uygulanmışı geri almaz (sonraki tetikte yeniden dener).
            let _ = self.kuyruk_ilerlet(o, e);
        }
        Ok(plan)
    }
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::model::sinirlar::ajanda::SURE_DK;
    use crate::model::takvim::{gun_no, gun_no_tarih};

    /// Modelin izin verdiği en büyük kayıtlardan biri: her serbest metin sınırında ve birim başına 3 bayt
    /// (`€`), her isteğe bağlı alan dolu, 8 mutlak hatırlatma, 500 örnek, en uzun kimlikler ve sayılar.
    fn en_buyuk_kayit(dilim: &str) -> Value {
        let uc = |n: usize| "€".repeat(n);
        let kimlik = |c: &str| c.repeat(OPAK_ID);
        let bas = gun_no(2026, 1, 1);
        let ornekler: Vec<Value> =
            (0..ORNEK_ADET as i64).map(|i| serde_json::json!({"tarih": gun_no_tarih(bas + i), "durum": "tamam"})).collect();
        let hatirlatmalar: Vec<Value> = (0..HATIRLATMA_ADET)
            .map(|i| serde_json::json!({"tur": "mutlak", "tarih": "2199-12-31", "saat": format!("23:5{i}"), "saat_dilimi": dilim}))
            .collect();
        serde_json::json!({
            "kayit_id": kimlik("k"), "revizyon": GUVENLI_TAM_SAYI, "tur": "randevu",
            "baslik": uc(BASLIK), "aciklama": uc(ACIKLAMA),
            "zaman": {"kesinlik": "an", "tarih": "2026-01-01", "saat": "23:59", "sure_dk": SURE_DK, "saat_dilimi": dilim, "ifade": uc(ZAMAN_IFADESI)},
            "hatirlatmalar": hatirlatmalar,
            "tekrar": {"siklik": "gunluk", "aralik": 1, "bitis_tarihi": "2199-12-31"},
            "ornekler": ornekler, "durum": "tamam", "taslak": false, "silindi": false,
            "elle_alanlar": ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar", "tekrar", "durum"],
            "kaynak": {"yol": "sohbet_araci", "tur_kokeni": "insan", "sohbet_id": kimlik("s"), "oturum_id": kimlik("o"),
                "kaynak_msg_id": kimlik("m"), "alinti": uc(ALINTI), "tekil_anahtar": "t".repeat(TEKIL_ANAHTAR)},
            "olusturma_ms": GUVENLI_TAM_SAYI, "guncelleme_ms": GUVENLI_TAM_SAYI,
        })
    }

    /// En büyük geçerli kaydın dışa aktarmadaki metni `KAYIT_EN_BUYUK_BAYT`'ın altında (ve ona yakın: sınır
    /// gevşek değil); o da öğe sınırının (`KAYIT_AZAMI_BAYT`) altında. Modelin en büyük belgesi (~1,77 GiB)
    /// içe aktarma sınırının (64 MiB) çok üstündedir: sınır modelden değil, gerçekçi yedekten gelir.
    #[test]
    fn en_buyuk_kayit_sinirin_altinda() {
        let dilim = format!("America/{}", "A".repeat(SAAT_DILIMI - "America/".len()));
        let k = AjandaKaydi::oku(&en_buyuk_kayit(&dilim), "").expect("geçerli kayıt");
        assert_eq!(k.zaman.as_ref().and_then(|z| z.saat_dilimi()).map(str::len), Some(SAAT_DILIMI));
        let n = k.json().to_string().len();
        assert!(n <= KAYIT_EN_BUYUK_BAYT, "{n} > {KAYIT_EN_BUYUK_BAYT}");
        assert!(n * 10 >= KAYIT_EN_BUYUK_BAYT * 9, "sınır gevşek: {n} / {KAYIT_EN_BUYUK_BAYT}");
        let ek = ek_json(&ek_dosyasi("f".repeat(64), EK_AZAMI_BAYT, format!("a/{}", "b".repeat(125)))).to_string();
        assert!(ek.len() < EK_OGESI_AZAMI_BAYT, "{}", ek.len());
        assert_eq!(MODEL_BELGE_EN_BUYUK_BAYT, 1_900_614_096);
        assert_eq!(BELGE_AZAMI_BAYT, 64 * 1024 * 1024);
        // Dolu telefonun (`KAYIT_ADET`) sınıra sığan kayıt başına ortalaması.
        assert_eq!(BELGE_AZAMI_BAYT / KAYIT_ADET, 1342);
        let b = aktarma_bicimi();
        assert_eq!((b.belge_azami_bayt, b.ekler_toplam_azami_bayt), (BELGE_AZAMI_BAYT as u64, 16 * 1024 * 1024));
        assert_eq!((b.acilmis_toplam_azami_bayt, b.ek_azami_adet, b.bicim_surumu), (80 * 1024 * 1024, 10_000, 3));
    }

    /// En büyük ret öğesi (gövdenin her serbest metni sınırında, 8 mutlak hatırlatma, en uzun kimlikler) öğe
    /// sınırının altındadır ve dışa aktarmanın yazdığı hal içe aktarmanın okuyucusundan geçer.
    #[test]
    fn en_buyuk_ret_ogesi_okunur() {
        let dilim = format!("America/{}", "A".repeat(SAAT_DILIMI - "America/".len()));
        let mut kayit = en_buyuk_kayit(&dilim);
        let mut govde = Map::new();
        for ad in ["tur", "baslik", "aciklama", "zaman", "hatirlatmalar", "tekrar"] {
            govde.insert(ad.into(), kayit[ad].take());
        }
        let r = RetSatiri {
            islem_id: "i".repeat(OPAK_ID),
            kayit_id: "k".repeat(OPAK_ID),
            islem_json: "okunamayan metin".into(),
            neden: "tutarsiz_kayit".into(),
            ts_ms: GUVENLI_TAM_SAYI,
            govde_json: Some(Value::Object(govde).to_string()),
            sira: 3,
        };
        // Yalnız türü taşıyan, gövdeli, kapalı nedenli girdi biçim 2 öğesidir.
        let iki = RetSatiri { islem_json: tur_ozeti(IslemTuru::Guncelle), ..r.clone() };
        let (m, bicim) = ret_ogesi(&iki, false).expect("yazılır");
        assert!(m.len() < KAYIT_EN_BUYUK_BAYT, "{}", m.len());
        assert_eq!(bicim, BICIM_RETLI);
        let (geri, sonra) = ret_oku(&serde_json::from_str(&m).unwrap(), "", BICIM_RETLI).unwrap();
        assert_eq!((geri.islem_json.as_str(), geri.neden.as_str(), geri.ts_ms, sonra), (r#"{"islem":"guncelle"}"#, "tutarsiz_kayit", GUVENLI_TAM_SAYI, false));
        assert_eq!(geri.govde_json, r.govde_json);
        // Öteki her satır biçim 3: `islem_json` ve yerel neden bayt bayt, gövdesiz de, işaretiyle.
        for (satir, sonra) in [
            (r.clone(), false),
            (RetSatiri { govde_json: None, ..r.clone() }, false),
            (RetSatiri { neden: "ertelenen_atildi_yollanmis".into(), islem_json: r#"{"islem":"guncelle","x" : 1}"#.into(), ..r.clone() }, true),
            (RetSatiri { neden: "yeni_bir_yerel_ad".into(), ..iki.clone() }, false),
        ] {
            let (m, bicim) = ret_ogesi(&satir, sonra).expect("yazılır");
            assert_eq!(bicim, BICIM_GENIS_RET);
            assert!(ret_oku(&serde_json::from_str(&m).unwrap(), "", BICIM_RETLI).is_err(), "biçim 2 taşıyamaz");
            let (geri, geri_sonra) = ret_oku(&serde_json::from_str(&m).unwrap(), "", BICIM_GENIS_RET).unwrap();
            assert_eq!((&geri.islem_json, &geri.neden, &geri.govde_json, geri_sonra), (&satir.islem_json, &satir.neden, &satir.govde_json, sonra));
        }
        // Biçimsiz neden ret listesinin gösterdiği gibi (`gecersiz_islem`); içerik hiçbir yola girmez.
        let (m, _) = ret_ogesi(&RetSatiri { neden: "Gizli Başlık".into(), ..r.clone() }, false).unwrap();
        assert!(m.contains(r#""neden":"gecersiz_islem""#) && !m.contains("Gizli"));
        // Ne gövdesi ne taşınacak işlem metni olan, kimliği ya da anı şemadan geçmeyen girdi yazılmaz.
        for bozuk in [
            RetSatiri { govde_json: None, ..iki.clone() },
            RetSatiri { govde_json: Some("{}".into()), ..iki.clone() },
            RetSatiri { kayit_id: "gizli başlık".into(), ..r.clone() },
            RetSatiri { ts_ms: -1, ..r.clone() },
        ] {
            assert!(ret_ogesi(&bozuk, false).is_none());
        }
    }

    /// Gerçek sınırlar, tam sınırda ve bir bayt fazlasıyla: belge (64 MiB) ve iki kök dizinin dışı (4 MiB).
    /// Dizinin içindeki boşluk dış bölüme sayılmaz; dışarıdaki sayılır. Dış sınırı aşan belge ne
    /// boşaltılmış kopyası ne ağacı kurulmadan reddedilir (dizi olmayan `kayitlar` da dış bölümdür).
    #[test]
    fn belge_ve_dis_bolum_siniri_tam_sinirda_gecer() {
        let belge = |dizi_ici: usize, dis_dolgu: usize| {
            format!(
                r#"{{{}"bicim":"{BICIM}","bicim_surumu":1,"bolgeler":[],"ekler":[],"kayitlar":[{}],"kip":"yerel","olusturma_ms":1,"sozlesme_surumu":1,"uygulama_surumu":"x"}}"#,
                " ".repeat(dis_dolgu),
                " ".repeat(dizi_ici)
            )
        };
        let iskelet = belge(0, 0).len();
        let reddi = |m: &str| match belge_coz(m) {
            Err(CekirdekHatasi::GecersizGirdi { alan, neden }) => (alan, neden),
            Ok(_) => panic!("reddedilmedi"),
            Err(e) => panic!("{e:?}"),
        };
        let tam = belge(BELGE_AZAMI_BAYT - iskelet, 0);
        assert_eq!(tam.len(), BELGE_AZAMI_BAYT);
        assert!(belge_coz(&tam).is_ok());
        assert!(Motor::belge_utf8(tam.as_bytes()).is_ok());
        let fazla = belge(BELGE_AZAMI_BAYT - iskelet + 1, 0);
        assert_eq!(reddi(&fazla), ("belge".to_string(), "çok büyük (en çok 64 MiB)".to_string()));
        assert!(Motor::belge_utf8(fazla.as_bytes()).is_err());
        drop((tam, fazla));
        // Dış bölüm: iskeletin `[]` dışı + dolgu.
        let dis_iskelet = iskelet - 2;
        assert!(belge_coz(&belge(0, DIS_AZAMI_BAYT - dis_iskelet)).is_ok());
        let dis_reddi = ("belge".to_string(), "çok büyük (kayıtlar dışı en çok 4 MiB)".to_string());
        assert_eq!(reddi(&belge(0, DIS_AZAMI_BAYT - dis_iskelet + 1)), dis_reddi);
        let dizi_degil = belge(0, 0).replace(r#""kayitlar":[]"#, &format!(r#""kayitlar":"{}""#, "x".repeat(DIS_AZAMI_BAYT)));
        assert_eq!(reddi(&dizi_degil), dis_reddi);
        let dev_surum = belge(0, 0).replace(r#""uygulama_surumu":"x""#, &format!(r#""uygulama_surumu":"{}""#, "x".repeat(DIS_AZAMI_BAYT)));
        assert_eq!(reddi(&dev_surum), dis_reddi);
    }

    #[test]
    fn guvenli_yol_yalniz_sema_adlarini_ve_sirayi_tasir() {
        assert_eq!(guvenli_yol("kayitlar.3.zaman.saat_dilimi"), "kayitlar.3.zaman.saat_dilimi");
        assert_eq!(guvenli_yol("kayitlar.3.Gizli başlık"), "kayitlar.3");
        assert_eq!(guvenli_yol("kayitlar.3.zaman.gizli.baslik"), "kayitlar.3.zaman");
        assert_eq!(guvenli_yol("gizli"), "belge");
        assert_eq!(guvenli_yol(""), "belge");
    }

    /// Tarama kökteki `kayitlar` ve `retler` dizilerinin öğe aralıklarını verir: dizgideki ayraç ve parantez,
    /// kaçış, iç içe dizi ve başka anahtardaki ad yanıltmaz. Boşaltılmış metnin ofseti asıl metne çevrilir.
    #[test]
    fn tarama_kayit_ogelerini_ayirir() {
        let m = r#"{"a":"kayitlar","b":{"kayitlar":[9],"retler":[8]}, "kayitlar" : [ {"x":"],\"["} , [1,[2]] ,3 ],"retler":[ 4,{} ],"c":[]}"#;
        let t = yapi_tara(m).unwrap();
        let ogeler = |d: usize| -> Vec<&str> { t.ogeler[d].iter().map(|&(b, s)| &m[b..s]).collect() };
        assert_eq!(ogeler(KAYITLAR), [r#"{"x":"],\"["}"#, "[1,[2]]", "3"]);
        assert_eq!(ogeler(RETLER), ["4", "{}"]);
        let (b, s) = t.diziler[KAYITLAR].unwrap();
        assert_eq!(&m[b..s], r#"[ {"x":"],\"["} , [1,[2]] ,3 ]"#);
        assert_eq!(yapi_tara(r#"{"kayitlar":[]}"#).unwrap().ogeler, [vec![], vec![]]);
        assert_eq!(yapi_tara(r#"{"kayitlar":{"a":[1]}}"#).unwrap(), Tarama::default());
        for bozuk in [r#"{"kayitlar":[1,]}"#, r#"{"kayitlar":[,1]}"#, r#"{"kayitlar":[1 2]}"#, r#"{"retler":[1,]}"#, r#"{"a":[}"#, r#"{"a":"#, r#"{"a":"x"#] {
            assert!(yapi_tara(bozuk).is_err(), "{bozuk}");
        }
        assert!(matches!(yapi_tara(r#"{"retler":[],"retler":[]}"#), Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "retler"));
        // Her harfi kaçışlı ad (kök dizi adının en uzun kaçışlı yazımı) tanınır; daha uzun kaçışlı anahtar ad değildir.
        let kacisli = |s: &str| s.bytes().map(|b| format!("\\u{b:04x}")).collect::<String>();
        let ad = format!("\"{}\"", kacisli("kayitlar"));
        assert_eq!(ad.len(), KOK_ADI_KACISLI_AZAMI);
        let t = yapi_tara(&format!(r#"{{{ad}:[1,2],"{}etler":[3]}}"#, kacisli("r"))).unwrap();
        assert_eq!((t.ogeler[KAYITLAR].len(), t.ogeler[RETLER].len()), (2, 1));
        let uzun = format!(r#"{{"{}x":[1]}}"#, kacisli("kayitlar"));
        assert_eq!(yapi_tara(&uzun).unwrap(), Tarama::default());
        assert_eq!(yapi_tara(r#"{"kayitlarx":[1]}"#).unwrap(), Tarama::default());
        // Kesik ofseti: iki kesikten sonraki konum asıl metindeki yerine düşer.
        let m = r#"{"kayitlar":[1,2],"x":1,"retler":[3],"y":bozuk}"#;
        let k = yapi_tara(m).unwrap().kesikler();
        let kirpik = r#"{"kayitlar":[],"x":1,"retler":[],"y":bozuk}"#;
        let o = kirpik.find("bozuk").unwrap();
        assert_eq!(kesik_ofseti(&k, o), m.find("bozuk").unwrap());
        assert_eq!(kesik_ofseti(&k, kirpik.find(",\"x\"").unwrap()), m.find(",\"x\"").unwrap());
    }

    /// Dizinin ayraç düzeyindeki iki nokta (öğeden önce ya da tek başına) sözdizimi hatasıdır: serde_json
    /// bütün belgeyi reddeder, tarama da reddetmeli (eskiden atlanıyor, belge sessizce okunuyordu).
    #[test]
    fn dizideki_fazla_iki_nokta_reddedilir() {
        for bozuk in [r#"{"kayitlar":[:1]}"#, r#"{"kayitlar":[1,:2]}"#, r#"{"kayitlar":[:]}"#, r#"{"kayitlar":[1:,2]}"#, r#"{"kayitlar":[ : ]}"#] {
            assert!(serde_json::from_str::<Value>(bozuk).is_err(), "{bozuk}");
            assert!(!sozdizimi_kabul(bozuk, KAYIT_AZAMI_BAYT), "{bozuk}");
        }
    }

    /// xorshift64: bulanıklaştırmanın tekrarlanabilir rastgelesi.
    struct Zar(u64);

    impl Zar {
        fn sayi(&mut self, n: usize) -> usize {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 % n as u64) as usize
        }
    }

    /// Bulanıklaştırma: geçerli küçük belgelere ve parçalara rastgele bayt ekleme, silme, değiştirme ve
    /// dilim yineleme. Çekirdeğin kabul ettiği her metni serde_json da kabul eder; ters yönde tek ayrım
    /// yinelenen `kayitlar` anahtarıdır (serde_json sonuncuyu alır, çekirdek reddeder). İki yol da denenir:
    /// öğeler serde_json'la ve (sınır 0) ağaçsız `sozdizimi_denetle` ile.
    #[test]
    fn sozdizimi_serde_json_ile_ayni_kabul_eder() {
        let tohumlar = [
            r#"{"bicim":"x","kayitlar":[{"a":[1,-2.5e3,{"b":null}]},"s\"\\\u00e7",3,[],{},true,false],"z":{"kayitlar":[1]}}"#,
            r#"{"kayitlar":[ {"k":"],\"[","t":[[0]]} , "\ud83d\ude00" ,-0 ],"ekler":[]}"#,
            r#"{"a":"kayitlar","kayitlar":[],"b":[1,2]}"#,
            r#"{"kayitlar":[{"x":1e308,"y":[{},[],""]},{"q":"\n\t\/"}]}"#,
            r#"{"retler":[{"a":1},[2]],"kayitlar":[3],"b":"retler"}"#,
        ];
        let alfabe: &[u8] = b"{}[],:\"\\ 01-.eEtrufalsn/\n";
        let mut zar = Zar(0x9e37_79b9_7f4a_7c15);
        let (mut kabul, mut toplam) = (0, 0);
        for _ in 0..40_000 {
            let mut m = tohumlar[zar.sayi(tohumlar.len())].as_bytes().to_vec();
            for _ in 0..=zar.sayi(3) {
                let i = zar.sayi(m.len() + 1);
                match zar.sayi(4) {
                    0 => m.insert(i, alfabe[zar.sayi(alfabe.len())]),
                    1 if i < m.len() => {
                        m.remove(i);
                    }
                    2 if i < m.len() => m[i] = alfabe[zar.sayi(alfabe.len())],
                    _ => {
                        let son = (i + zar.sayi(12)).min(m.len());
                        let dilim = m[i..son].to_vec();
                        let yer = zar.sayi(m.len() + 1);
                        m.splice(yer..yer, dilim);
                    }
                }
            }
            let Ok(m) = String::from_utf8(m) else { continue };
            toplam += 1;
            let serde = serde_json::from_str::<Value>(&m).is_ok();
            for azami in [KAYIT_AZAMI_BAYT, 0] {
                let biz = sozdizimi_kabul(&m, azami);
                assert!(!biz || serde, "çekirdek kabul etti, serde_json etmedi: {m}");
                if serde && !biz {
                    let yinelenen = m.matches("\"kayitlar\"").count() > 1 || m.matches("\"retler\"").count() > 1;
                    assert!(yinelenen, "serde_json kabul etti, çekirdek etmedi: {m}");
                }
            }
            // Ağaçsız denetleyici tek başına (kök nesne değil, herhangi bir değer) serde_json'la aynıdır.
            assert_eq!(sozdizimi_denetle(&m).is_ok(), serde, "{m}");
            kabul += usize::from(serde);
        }
        // Bulanıklaştırma iki tarafa da düşsün (anlamlı bir karşılaştırma).
        assert!(kabul > toplam / 20 && kabul < toplam / 2, "{kabul}/{toplam}");
        for parca in ["\"\\ud800\"", "\"\\udc00\"", "\"\\ud800\\u0041\"", "\"a\u{1}\"", "1e400", "-1e400", "01", "1.", ".5", "[1,]", "{\"a\"}", "tru", "nul"] {
            assert!(serde_json::from_str::<Value>(parca).is_err() && sozdizimi_denetle(parca).is_err(), "{parca}");
        }
        for parca in ["\"\\ud83d\\ude00\"", "1e-400", "0e99999", "-0", "18446744073709551615", "1.5E+3", " [ ] ", "{\"a\":{}}"] {
            assert!(serde_json::from_str::<Value>(parca).is_ok() && sozdizimi_denetle(parca).is_ok(), "{parca}");
        }
    }

    /// f64 sınırının iki yanı (bulanıklaştırma bu aralığa düşmez): 1e308 ile en büyük sonlu değer arası
    /// serde_json'ca geçerlidir, ağaçsız denetleyici de kabul eder (eskiden 1e308 üstünü reddediyor, 256 KiB
    /// üstü öğede bütün belgeyi düşürüyordu); sonsuza yuvarlanan reddedilir. Sınırdaki yuvarlama serde_json'un
    /// kendisinden gelir: iki taraf her parçada aynıdır.
    #[test]
    fn sayi_siniri_serde_json_ile_ayni() {
        for parca in ["1.5e308", "-1.5e308", "1.7976931348623157e308", "-1.7976931348623157e308", "17976931348623157e292", "[1.6e308]"] {
            assert!(serde_json::from_str::<Value>(parca).is_ok(), "{parca}");
            assert!(sozdizimi_denetle(parca).is_ok(), "{parca}");
        }
        for parca in ["1.8e308", "-1.8e308", "1e309", "[1e309]"] {
            assert!(serde_json::from_str::<Value>(parca).is_err(), "{parca}");
            assert!(sozdizimi_denetle(parca).is_err(), "{parca}");
        }
        let en_buyuk_tam = "9".repeat(308);
        for parca in [
            "1.7976931348623158e308",
            "1.79769313486231580e308",
            "1.7976931348623159e308",
            "1.797693134862315807e308",
            "1.797693134862315808e308",
            en_buyuk_tam.as_str(),
            "4.9e-324",
            "2.4e-324",
        ] {
            assert_eq!(sozdizimi_denetle(parca).is_ok(), serde_json::from_str::<Value>(parca).is_ok(), "{parca}");
        }
    }

    /// Çekirdeğin sözdizimi yolunun bütünü (`belge_coz` + `plan_kur`): tarama, boşaltılmış metnin ağacı ve her
    /// öğe (`azami`'dan büyükse ağaçsız `sozdizimi_denetle`, değilse serde_json).
    fn sozdizimi_kabul(m: &str, azami: usize) -> bool {
        let Ok(t) = yapi_tara(m) else { return false };
        let (mut kirpik, mut once) = (String::new(), 0);
        for (b, s) in t.kesikler() {
            kirpik.push_str(&m[once..b]);
            kirpik.push_str("[]");
            once = s;
        }
        kirpik.push_str(&m[once..]);
        serde_json::from_str::<Value>(&kirpik).is_ok()
            && t.ogeler.iter().flatten().all(|&(b, s)| {
                let ham = &m[b..s];
                if ham.len() > azami { sozdizimi_denetle(ham).is_ok() } else { serde_json::from_str::<Value>(ham).is_ok() }
            })
    }

    /// İç içelik sınırı serde_json'unkiyle aynıdır, bütün belgede ve tek değerde: bulanıklaştırma bu derinliğe
    /// ulaşmaz, sınırın iki yanı burada denenir.
    #[test]
    fn derinlik_siniri_serde_json_ile_ayni() {
        for n in [DERINLIK_AZAMI - 2, DERINLIK_AZAMI - 1, DERINLIK_AZAMI, DERINLIK_AZAMI + 1] {
            let deger = format!("{}{}", "[".repeat(n), "]".repeat(n));
            let serde = serde_json::from_str::<Value>(&deger).is_ok();
            assert_eq!(sozdizimi_denetle(&deger).is_ok(), serde, "değer, derinlik {n}");
            // Kökteki nesne ve `kayitlar` dizisi iki düzeydir: öğenin içi `n - 2`.
            let ic = format!("{}{}", "[".repeat(n - 2), "]".repeat(n - 2));
            let belge = format!(r#"{{"kayitlar":[{ic}]}}"#);
            let serde = serde_json::from_str::<Value>(&belge).is_ok();
            for azami in [KAYIT_AZAMI_BAYT, 0] {
                assert_eq!(sozdizimi_kabul(&belge, azami), serde, "belge, derinlik {n}, öğe sınırı {azami}");
            }
        }
    }

    #[test]
    fn konum_ve_ofset_birbirinin_tersi() {
        let m = "ab\ncde\n\nf";
        for o in 0..=m.len() {
            let (satir, sutun) = konum(m, o);
            assert_eq!(ofset(m, satir, sutun), o, "{o}");
        }
    }

    #[test]
    fn mime_ve_ek_ogesi_denetlenir() {
        assert!(mime_gecerli("image/jpeg") && mime_gecerli("image/svg+xml"));
        assert!(!mime_gecerli("image") && !mime_gecerli("Image/JPEG") && !mime_gecerli("/x"));
        let ozet = "a".repeat(64);
        let ek = ek_oku(&serde_json::json!({"ozet": ozet, "bayt": 10, "mime": "image/jpeg"}), "ekler.0").unwrap();
        assert_eq!(ek.yol, format!("ekler/{ozet}"));
        let buyuk = serde_json::json!({"ozet": ozet, "bayt": EK_AZAMI_BAYT + 1, "mime": "image/jpeg"});
        assert_eq!(ek_oku(&buyuk, "ekler.0").unwrap_err().yol, "ekler.0.bayt");
        let buyuk_harf = serde_json::json!({"ozet": "A".repeat(64), "bayt": 1, "mime": "image/jpeg"});
        assert!(ek_oku(&buyuk_harf, "ekler.0").is_err());
    }
}
