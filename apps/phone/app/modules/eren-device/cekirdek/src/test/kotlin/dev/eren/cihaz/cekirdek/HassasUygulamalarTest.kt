package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HassasUygulamalarTest {
    private val hassaslar = listOf(
        "com.akbank.android.apps.akbank_direkt",
        "com.aktifbank.nkolay",
        "com.enparabank.retail",
        "com.finansbank.mobile.cepsube",
        "finansbank.enpara",
        "com.ininal.wallet",
        "com.mobillium.papara",
        "com.tmobtech.halkbank",
        "com.ykb.android",
        "com.ziraat.ziraatmobil",
        "com.binance.dev",
        "com.bitlo.bitloandroid",
        "com.okinc.okex.gp",
        "com.getmidas.app",
        "com.google.android.apps.authenticator2",
        "tr.gov.turkiye.edevlet.kapisi",
    )

    private val siradanlar = listOf(
        "com.whatsapp" to "WhatsApp",
        "com.instagram.android" to "Instagram",
        "org.telegram.messenger" to "Telegram",
        "org.thoughtcrime.securesms" to "Signal",
        "com.spotify.music" to "Spotify",
        "trendyol.com" to "Trendyol",
        "com.getir" to "Getir",
        "com.sahibinden" to "sahibinden.com",
        "com.pozitron.hepsiburada" to "Hepsiburada",
        "com.amazon.mShop.android.shopping" to "Amazon Alışveriş",
        "com.netflix.mediaclient" to "Netflix",
        "com.duolingo" to "Duolingo",
        "com.inovel.app.yemeksepeti" to "Yemeksepeti",
        "com.twitter.android" to "X",
        "com.reddit.frontpage" to "Reddit",
        "com.linkedin.android" to "LinkedIn",
        "com.google.android.apps.nbu.files" to "Files by Google",
        "io.wallpaperengine.weclient" to "Wallpaper Engine",
        "com.selman.klavye" to "Klavye",
        "com.github.android" to "GitHub",
        "com.openai.chatgpt" to "ChatGPT",
        "com.anthropic.claude" to "Claude",
    )

    @Test
    fun bilinenBankaParaKimlikPaketleriHassas() {
        for (p in hassaslar) assertTrue(HassasUygulamalar.otomatikHassasMi(p, ""), p)
    }

    @Test
    fun siradanUygulamalarHassasDegil() {
        for ((p, ad) in siradanlar) assertFalse(HassasUygulamalar.otomatikHassasMi(p, ad), "$p / $ad")
    }

    @Test
    fun bilinmeyenPaketGorunenAdiBankaysaHassas() {
        assertTrue(HassasUygulamalar.otomatikHassasMi("com.ornek.bilinmeyen", "Örnek Bankası"))
    }

    @Test
    fun buyukHarfliPaketAdiYakalanir() {
        assertTrue(HassasUygulamalar.otomatikHassasMi("COM.ZIRAAT.ZIRAATMOBIL", ""))
        assertTrue(HassasUygulamalar.otomatikHassasMi("COM.BINANCE.DEV", ""))
    }

    @Test
    fun bilinenKumeBosDegilVeHepsiHassas() {
        assertTrue(HassasUygulamalar.BILINEN.isNotEmpty())
        for (p in HassasUygulamalar.BILINEN) assertTrue(HassasUygulamalar.otomatikHassasMi(p, ""), p)
    }
}
