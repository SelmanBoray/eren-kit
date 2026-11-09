package dev.eren.cihaz.cekirdek

/*
 * `protocol/src/sinirlar.ts`'in birebir kopyası: adlar ve değerler aynı, fazla ya da eksik yok.
 * Elle değiştirilmez; protokol değişince yeniden kopyalanır. `SozlesmeTest` iki yönlü sınar.
 * Karakter sınırları UTF-16 birimidir (Kotlin `String.length`), adet sınırları öğe sayısı.
 */

const val PROTOKOL_SURUMU: Int = 1

object Sinirlar {
    const val OPAK_ID = 64
    const val JETON_MIN = 32
    const val JETON_MAX = 128
    const val NONCE_MIN = 24
    const val NONCE_MAX = 88
    const val ACIK_ANAHTAR_MAX = 256
    const val IMZA_MAX = 256
    const val ESLESTIRME_KODU_MIN = 6
    const val ESLESTIRME_KODU_MAX = 32
    const val CIHAZ_ETIKETI = 64
    const val HATA_DETAYI = 500
    const val YOL_SAYISI = 8
    const val YOL_UZUNLUGU = 128

    const val KULLANICI_METNI = 32_000
    const val ASISTAN_METNI = 256_000
    const val DELTA_METNI = 16_000
    const val SISTEM_NOTU = 1_000

    const val PLAN_BASLIK = 120
    const val PLAN_CWD = 1_024
    const val GOREV_METNI = 20_000
    const val PLAN_UYGULAMA_ADET = 16
    const val IZINLI_METIN = 4_000
    const val IZINLI_METIN_ADET = 16
    const val KIRLI_KAYNAK_ADET = 32

    const val RAPOR_MADDE = 1_000
    const val RAPOR_MADDE_ADET = 64
    const val RAPOR_DOSYA_YOLU = 512
    const val RAPOR_DOSYA_ADET = 256
    const val RAPOR_GOVDE = 64_000

    const val SORU_METNI = 4_000
    const val SECENEK_METNI = 200
    const val SECENEK_ADET = 8
    const val CEVAP_METNI = 8_000

    const val PAKET_ADI = 255
    const val UYGULAMA_ADI = 120
    const val UYGULAMA_LISTESI_ADET = 2_000
    const val ELEMENT_ROL = 64
    const val ELEMENT_METIN = 2_000
    const val ELEMENT_SATIR_METIN = 500
    const val ELEMENT_ADET = 500
    const val ELEMENT_SORGU = 200
    const val ON_PLAN_BASLIK = 256
    const val YAZILAN_METIN = 4_000
    const val KOORDINAT_MAX = 20_000
    const val TEKRAR_MAX = 10
    const val KAYDIRMA_MAX = 20
    const val BEKLEME_SANIYE_MAX = 30
    const val EKRAN_BASE64 = 8 * 1024 * 1024
    const val BILDIRIM_BASLIK = 120
    const val BILDIRIM_METIN = 500

    const val PROJE_ADI = 120
    const val PROJE_NOTU = 500
    const val PROJE_ADET = 512
    const val OTURUM_ADET = 256
    const val DEVIR_OZETI = 32_000
}

object AzamiCerceve {
    const val SOHBET = 2 * 1024 * 1024
    const val CIHAZ = 10 * 1024 * 1024
    const val KOPRU = 12 * 1024 * 1024
}
