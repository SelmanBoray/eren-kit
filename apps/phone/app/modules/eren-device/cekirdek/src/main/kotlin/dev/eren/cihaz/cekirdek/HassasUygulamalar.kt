package dev.eren.cihaz.cekirdek

/**
 * Kullanıcı kararı olmayan bir uygulamanın kendiliğinden `HASSAS` başlayıp başlamayacağı.
 *
 * Kapsam: bankalar (katılım bankaları dahil), e-para ve ödeme cüzdanları, kripto borsaları ve cüzdanları,
 * aracı kurum ve borsa uygulamaları, iki adımlı doğrulama (2FA) uygulamaları ve e-Devlet.
 * `BILINEN` yalnız paket adından emin olunanlardır; geri kalanı ipuçlarına bırakılır.
 * İpuçları yanlış pozitife karşı seçildi: "bank" bilet uygulaması gibi bir yan ürünü de yakalayabilir
 * (kabul edilebilir), ama "wall" ya da "pay" gibi "wallpaper"/"display" yakalayacak kısa parçalar yok.
 */
object HassasUygulamalar {
    val BILINEN: Set<String> = setOf(
        // Bankalar
        "com.akbank.android.apps.akbank_direkt",
        "com.aktifbank.nkolay",
        "com.enparabank.retail",
        "finansbank.enpara",
        "com.finansbank.mobile.cepsube",
        "com.tmobtech.halkbank",
        "com.ykb.android",
        "com.ziraat.ziraatmobil",
        "com.garanti.cepsubesi",
        "com.pozitron.iscep",
        "com.vakifbank.mobile",
        "com.denizbank.mobildeniz",
        "com.teb",
        "com.ingbanktr.ingmobil",
        "com.kuveytturk.mobil",
        // E-para, ödeme ve cüzdan
        "com.ininal.wallet",
        "com.mobillium.papara",
        "com.turkcell.paycell",
        "com.google.android.apps.walletnfcrel",
        "com.paypal.android.p2pmobile",
        "com.revolut.revolut",
        "com.transferwise.android",
        // Kripto borsaları ve cüzdanları
        "com.binance.dev",
        "com.bitlo.bitloandroid",
        "com.okinc.okex.gp",
        "com.coinbase.android",
        "com.bybit.app",
        "co.mona.android",
        "io.metamask",
        "com.wallet.crypto.trustapp",
        // Aracı kurum ve borsa
        "com.getmidas.app",
        // İki adımlı doğrulama
        "com.google.android.apps.authenticator2",
        "com.azure.authenticator",
        "com.authy.authy",
        // e-Devlet
        "tr.gov.turkiye.edevlet.kapisi",
    )

    /** Sadeleştirilmiş paket adında aranır (küçük harf, Türkçe harfler ASCII'ye katlanmış). */
    private val PAKET_IPUCLARI: List<String> = listOf(
        "bank", "katilim", "cepsube", "mobilsube",
        "garanti", "ziraat", "vakif", "kuveyt", "albaraka", "turkiyefinans", "yapikredi", "hsbc", "qnb",
        "wallet", "papara", "paycell", "tosla", "ininal",
        "kripto", "bitcoin", "binance", "btcturk", "paribu", "coinbase",
        "borsa", "yatirim", "menkul",
        "authenticator", "authy",
        "edevlet",
    )

    /** Sadeleştirilmiş görünen adda aranır (küçük harf, Türkçe harfler ASCII'ye katlanmış, boşluk tek). */
    private val AD_IPUCLARI: List<String> = listOf(
        "bank", "katilim", "mobil sube", "cep sube", "subesi",
        "garanti", "ziraat", "vakif", "kuveyt", "albaraka", "turkiye finans", "yapi kredi", "hsbc", "qnb",
        "wallet", "cuzdan", "papara", "paycell", "tosla", "ininal",
        "kripto", "crypto.com", "bitcoin", "binance", "btcturk", "paribu", "coinbase",
        "borsa", "yatirim", "menkul",
        "authenticator", "authy", "2fa",
        "e-devlet", "edevlet",
    )

    fun otomatikHassasMi(paket: String, ad: String): Boolean {
        if (paket in BILINEN) return true
        val p = sadelestir(paket)
        if (PAKET_IPUCLARI.any { it in p }) return true
        val a = sadelestir(ad)
        return AD_IPUCLARI.any { it in a }
    }

    /** Dile bağlı olmayan küçültme: Türkçe I/İ/ı önce elle `i` olur, sonra kalan Türkçe harfler katlanır. */
    private fun sadelestir(metin: String): String {
        val sb = StringBuilder(metin.length)
        for (c in metin) {
            when (c) {
                'I', 'İ', 'ı' -> sb.append('i')
                '̇' -> Unit
                else -> sb.append(c.lowercaseChar())
            }
        }
        return sb.toString()
            .replace('ş', 's')
            .replace('ğ', 'g')
            .replace('ü', 'u')
            .replace('ö', 'o')
            .replace('ç', 'c')
            .replace(BOSLUK, " ")
            .trim()
    }

    private val BOSLUK = Regex("\\s+")
}
