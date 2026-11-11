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
        "com.ornek.klavye" to "Klavye",
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

    private val genisHassaslar = listOf(
        "com.kubi.kucoin" to "KuCoin",
        "com.x8bit.bitwarden" to "Bitwarden",
        "com.agilebits.onepassword" to "1Password",
        "com.lastpass.lpandroid" to "LastPass",
        "com.beemdevelopment.aegis" to "Aegis",
        "org.fedorahosted.freeotp" to "FreeOTP",
        "com.duosecurity.duomobile" to "Duo Mobile",
        "com.etoro.openbook" to "eToro",
        "com.ledger.live" to "Ledger Live",
        "app.phantom" to "Phantom",
        "com.google.android.apps.adm" to "Find Hub",
        "com.server.auditor.ssh.client" to "Termius",
        "org.dayup.stocks" to "Webull",
        "com.ornek.a" to "Crypto Wallet",
        "com.ornek.b" to "Kripto Borsası",
        "com.ornek.c" to "Parola Yöneticisi",
        "com.ornek.d" to "Password Manager",
        "com.ornek.e" to "Cüzdan",
    )

    private val genisSiradanlar = listOf(
        "com.microsoft.office.outlook" to "Outlook",
        "com.google.android.gm" to "Gmail",
        "com.valvesoftware.android.steam.community" to "Steam",
        "com.candywriter.bitlife" to "BitLife",
        "com.fut.market.alert" to "FUT Market Alert",
        "com.sofascore.results" to "Sofascore",
        "com.kokteyl.mackolik" to "Mackolik",
        "com.chess" to "Chess",
        "com.ttterbagames.businesssimulator" to "Business Empire",
        "com.miui.notes" to "Notlar",
        "com.spotify.music" to "Spotify",
    )

    @Test
    fun genisletilmisKapsamHassasUygulamalarYakalanir() {
        for ((p, ad) in genisHassaslar) assertTrue(HassasUygulamalar.otomatikHassasMi(p, ad), "$p / $ad")
    }

    @Test
    fun genisletilmisKapsamSiradanUygulamalarHassasDegil() {
        for ((p, ad) in genisSiradanlar) assertFalse(HassasUygulamalar.otomatikHassasMi(p, ad), "$p / $ad")
    }

    private val parolaYoneticileri = listOf(
        "proton.android.pass" to "Proton Pass",
        "com.callpod.android_apps.keeper" to "Keeper",
        "io.enpass.app" to "Enpass",
        "com.ornek.f" to "NordPass",
    )

    private val parolaYoneticisiBenzerleri = listOf(
        "com.ornek.g" to "Zookeeper",
        "com.ornek.h" to "Bookkeeper Pro",
        "com.ornek.i" to "Boarding Pass",
        "com.ornek.j" to "Passport Photo",
    )

    @Test
    fun parolaYoneticileriHassasYakalanir() {
        for ((p, ad) in parolaYoneticileri) assertTrue(HassasUygulamalar.otomatikHassasMi(p, ad), "$p / $ad")
    }

    @Test
    fun parolaYoneticisineBenzeyenSiradanUygulamalarHassasDegil() {
        for ((p, ad) in parolaYoneticisiBenzerleri) assertFalse(HassasUygulamalar.otomatikHassasMi(p, ad), "$p / $ad")
    }

    @Test
    fun bilinenKumeBosDegilVeHepsiHassas() {
        assertTrue(HassasUygulamalar.BILINEN.isNotEmpty())
        for (p in HassasUygulamalar.BILINEN) assertTrue(HassasUygulamalar.otomatikHassasMi(p, ""), p)
    }
}
