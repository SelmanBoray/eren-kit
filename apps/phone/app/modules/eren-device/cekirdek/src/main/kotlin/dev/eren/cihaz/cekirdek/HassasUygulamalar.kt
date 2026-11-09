package dev.eren.cihaz.cekirdek

import java.text.Normalizer

/**
 * Kullanıcı kararı olmayan bir uygulamanın kendiliğinden `HASSAS` başlayıp başlamayacağı.
 *
 * Kapsam: bankalar (katılım bankaları dahil), e-para ve ödeme cüzdanları, kripto borsaları ve cüzdanları,
 * aracı kurum ve borsa uygulamaları, iki adımlı doğrulama (2FA) uygulamaları, e-Devlet,
 * parola ve kimlik yöneticileri ve hesap güvenliği (uzaktan silme, sunucu kimlik bilgisi tutan SSH istemcisi).
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
        "com.kubi.kucoin",
        "com.ledger.live",
        "app.phantom",
        // Aracı kurum ve borsa
        "com.getmidas.app",
        "com.etoro.openbook",
        "org.dayup.stocks",
        // İki adımlı doğrulama
        "com.google.android.apps.authenticator2",
        "com.azure.authenticator",
        "com.authy.authy",
        "com.beemdevelopment.aegis",
        "org.fedorahosted.freeotp",
        "com.duosecurity.duomobile",
        "com.okta.android.auth",
        // Parola ve kimlik yöneticileri
        "com.x8bit.bitwarden",
        "com.agilebits.onepassword",
        "com.lastpass.lpandroid",
        "proton.android.pass",
        "com.callpod.android_apps.keeper",
        "io.enpass.app",
        // Hesap güvenliği: uzaktan silme yetkisi, sunucu kimlik bilgileri
        "com.google.android.apps.adm",
        "com.server.auditor.ssh.client",
        // e-Devlet
        "tr.gov.turkiye.edevlet.kapisi",
    )

    /** Sadeleştirilmiş paket adında aranır (küçük harf, Türkçe harfler ASCII'ye katlanmış). */
    private val PAKET_IPUCLARI: List<String> = listOf(
        "bank", "katilim", "cepsube", "mobilsube",
        "garanti", "ziraat", "vakif", "kuveyt", "albaraka", "turkiyefinans", "yapikredi", "hsbc", "qnb",
        "wallet", "papara", "paycell", "tosla", "ininal", "bkmexpress", "payfix", "juzdan",
        "kripto", "crypto", "bitcoin", "binance", "btcturk", "paribu", "coinbase",
        "kucoin", "bitget", "kraken", "bitpanda", "gateio", "icrypex", "exodusmovement",
        "borsa", "yatirim", "menkul", "etoro", "trading212", "webull", "robinhood",
        "authenticator", "authy", "freeotp", "duosecurity", "com.okta.",
        "bitwarden", "onepassword", "lastpass", "samsungpass", "keepass", "dashlane", "enpass", "nordpass", "proton.android.pass", "callpod", "keepersecurity",
        "termius",
        "edevlet",
    )

    /** Sadeleştirilmiş görünen adda aranır (küçük harf, Türkçe harfler ASCII'ye katlanmış, boşluk tek). */
    private val AD_IPUCLARI: List<String> = listOf(
        "bank", "katilim", "mobil sube", "cep sube", "subesi",
        "garanti", "ziraat", "vakif", "kuveyt", "albaraka", "turkiye finans", "yapi kredi", "hsbc", "qnb",
        "wallet", "cuzdan", "papara", "paycell", "tosla", "ininal", "bkm express",
        "kripto", "crypto.com", "bitcoin", "binance", "btcturk", "paribu", "coinbase", "gate.io",
        "borsa", "yatirim", "menkul", "araci kurum", "trading 212", "interactive brokers", "ledger live",
        "authenticator", "authy", "2fa", "duo mobile", "okta verify", "freeotp",
        "password manager", "parola yonetic", "sifre yonetic", "samsung pass", "proton pass", "enpass", "nordpass",
        "e-devlet", "edevlet",
    )

    /**
     * Sadeleştirilmiş görünen adın tam kelimeleriyle karşılaştırılır; alt dizgi olarak aranırsa
     * yanlış pozitif verecek kısa ya da genel adlar burada ("param", "crypto" gibi).
     */
    private val AD_KELIMELERI: Set<String> = setOf(
        "param", "payfix", "juzdan",
        "crypto", "kucoin", "bitget", "bitpanda", "icrypex",
        "etoro", "webull", "ibkr", "robinhood",
        "bitwarden", "1password", "lastpass", "keepass", "keepassdx", "dashlane", "enpass", "nordpass",
        "termius",
    )

    fun otomatikHassasMi(paket: String, ad: String): Boolean {
        if (paket in BILINEN) return true
        val p = sadelestir(paket)
        if (PAKET_IPUCLARI.any { it in p }) return true
        val a = sadelestir(ad)
        if (AD_IPUCLARI.any { it in a }) return true
        return a.split(KELIME_AYIRICI).any { it in AD_KELIMELERI }
    }

    /**
     * Dile bağlı olmayan küçültme: önce NFC'ye normalleştirilir (NFD "u + U+0308" gibi yazımlar tek harf olur),
     * Türkçe I/İ/ı elle `i` olur, sonra kalan Türkçe harfler katlanır.
     */
    private fun sadelestir(metin: String): String {
        val nfc = Normalizer.normalize(metin, Normalizer.Form.NFC)
        val sb = StringBuilder(nfc.length)
        for (c in nfc) {
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
    private val KELIME_AYIRICI = Regex("[^a-z0-9]+")
}
