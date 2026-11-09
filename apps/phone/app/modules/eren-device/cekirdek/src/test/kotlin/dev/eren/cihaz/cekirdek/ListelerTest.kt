package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ListelerTest {
    private val kendi = "com.ornek.eren"
    private val banka = "com.ziraat.ziraatmobil"

    private val sabitler = listOf(
        kendi,
        "com.android.settings",
        "com.google.android.packageinstaller",
        "com.android.packageinstaller",
        "com.android.vending",
        "com.google.android.permissioncontroller",
        "com.android.permissioncontroller",
        "com.miui.securitycenter",
        "com.tailscale.ipn",
        "com.android.systemui",
    )

    private fun kurulu(paket: String, imza: String = "imza1", ad: String = "Ad $paket") =
        KuruluUygulama(paket, ad, imza)

    private fun girdi(
        kurulu: List<KuruluUygulama> = emptyList(),
        kararlar: Map<String, KullaniciKarari> = emptyMap(),
        cozulen: Set<String> = emptySet(),
    ) = ListeGirdisi(kurulu, kararlar, cozulen)

    @Test
    fun sabitPaketlerKullaniciAcikDeseDeDegismez() {
        val kararlar = sabitler.associateWith { KullaniciKarari(UygulamaDurumu.ACIK, "imza1") }
        val l = listelerKur.kur(kendi, girdi(sabitler.map { kurulu(it) }, kararlar))
        for (p in sabitler) assertEquals(UygulamaDurumu.DEGISMEZ, l.durum(p), p)
    }

    @Test
    fun sabitPaketKuruluOlmasaDaDegismez() {
        val l = listelerKur.kur(kendi, girdi())
        for (p in sabitler) assertEquals(UygulamaDurumu.DEGISMEZ, l.durum(p), p)
    }

    @Test
    fun cozulenEkAdlarDegismez() {
        val cozulen = setOf("com.ornek.ev", "com.ornek.kilit")
        val kararlar = cozulen.associateWith { KullaniciKarari(UygulamaDurumu.HASSAS, "imza1") }
        val l = listelerKur.kur(kendi, girdi(cozulen.map { kurulu(it) }, kararlar, cozulen))
        for (p in cozulen) assertEquals(UygulamaDurumu.DEGISMEZ, l.durum(p), p)
    }

    @Test
    fun cozulenDegismezKararsizVeBankaAdliOlsaDaDegismez() {
        val l = listelerKur.kur(
            kendi,
            girdi(listOf(kurulu("com.ornek.ev"), kurulu(banka)), cozulen = setOf("com.ornek.ev", banka)),
        )
        assertEquals(UygulamaDurumu.DEGISMEZ, l.durum("com.ornek.ev"))
        assertEquals(UygulamaDurumu.DEGISMEZ, l.durum(banka))
    }

    @Test
    fun kararsizSiradanUygulamaAcik() {
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu("com.ornek.a"))))
        assertEquals(UygulamaDurumu.ACIK, l.durum("com.ornek.a"))
    }

    @Test
    fun kararsizBankaHassas() {
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu(banka, ad = "Ziraat Mobil"))))
        assertEquals(UygulamaDurumu.HASSAS, l.durum(banka))
    }

    @Test
    fun adiBankaIpucuVerenBilinmeyenPaketHassas() {
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu("com.ornek.xyz", ad = "Örnek Bankası"))))
        assertEquals(UygulamaDurumu.HASSAS, l.durum("com.ornek.xyz"))
    }

    @Test
    fun kuruluOlmayanPaketYeni() {
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu("com.ornek.a"))))
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.hic"))
        assertEquals(UygulamaDurumu.YENI, l.durum(banka))
    }

    @Test
    fun kuruluOlmayanPaketinKarariYoksayilir() {
        val kararlar = mapOf(
            "com.ornek.a" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"),
            banka to KullaniciKarari(UygulamaDurumu.HASSAS, "imza1"),
        )
        val l = listelerKur.kur(kendi, girdi(emptyList(), kararlar))
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.a"))
        assertEquals(UygulamaDurumu.YENI, l.durum(banka))
    }

    @Test
    fun hassasKarariImzaDegisinceDeHassas() {
        val kararlar = mapOf(
            "com.ornek.a" to KullaniciKarari(UygulamaDurumu.HASSAS, "imza1"),
            banka to KullaniciKarari(UygulamaDurumu.HASSAS, "imza1"),
        )
        val l = listelerKur.kur(
            kendi,
            girdi(listOf(kurulu("com.ornek.a", "imza2"), kurulu(banka, "imza2", "Ziraat")), kararlar),
        )
        assertEquals(UygulamaDurumu.HASSAS, l.durum("com.ornek.a"))
        assertEquals(UygulamaDurumu.HASSAS, l.durum(banka))
    }

    @Test
    fun bankaIcinAcikKarariAyniImzadaAcik() {
        val kararlar = mapOf(banka to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"))
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu(banka, "imza1", "Ziraat Mobil")), kararlar))
        assertEquals(UygulamaDurumu.ACIK, l.durum(banka))
    }

    @Test
    fun bankaIcinAcikKarariImzaDegisinceHassas() {
        val kararlar = mapOf(banka to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"))
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu(banka, "imza2", "Ziraat Mobil")), kararlar))
        assertEquals(UygulamaDurumu.HASSAS, l.durum(banka))
    }

    @Test
    fun siradanUygulamaIcinAcikKarariImzaDegisinceAcik() {
        val kararlar = mapOf("com.ornek.a" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"))
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu("com.ornek.a", "imza2")), kararlar))
        assertEquals(UygulamaDurumu.ACIK, l.durum("com.ornek.a"))
    }

    @Test
    fun acikVeHassasKararlari() {
        val l = listelerKur.kur(
            kendi,
            girdi(
                listOf(kurulu("com.ornek.a"), kurulu("com.ornek.b")),
                mapOf(
                    "com.ornek.a" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"),
                    "com.ornek.b" to KullaniciKarari(UygulamaDurumu.HASSAS, "imza1"),
                ),
            ),
        )
        assertEquals(UygulamaDurumu.ACIK, l.durum("com.ornek.a"))
        assertEquals(UygulamaDurumu.HASSAS, l.durum("com.ornek.b"))
    }

    @Test
    fun gecersizKararKararYokSayilir() {
        val l = listelerKur.kur(
            kendi,
            girdi(
                listOf(kurulu("com.ornek.a"), kurulu("com.ornek.b"), kurulu(banka, ad = "Ziraat")),
                mapOf(
                    "com.ornek.a" to KullaniciKarari(UygulamaDurumu.DEGISMEZ, "imza1"),
                    "com.ornek.b" to KullaniciKarari(UygulamaDurumu.YENI, "imza1"),
                    banka to KullaniciKarari(UygulamaDurumu.DEGISMEZ, "imza1"),
                ),
            ),
        )
        assertEquals(UygulamaDurumu.ACIK, l.durum("com.ornek.a"))
        assertEquals(UygulamaDurumu.ACIK, l.durum("com.ornek.b"))
        assertEquals(UygulamaDurumu.HASSAS, l.durum(banka))
    }

    @Test
    fun guncelleSonrasiTutarli() {
        val ilk = mapOf("com.ornek.a" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"))
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu("com.ornek.a")), ilk))
        assertEquals(UygulamaDurumu.ACIK, l.durum("com.ornek.a"))
        l.guncelle(
            girdi(
                listOf(kurulu("com.ornek.a", "imza9"), kurulu("com.ornek.b")),
                mapOf("com.ornek.b" to KullaniciKarari(UygulamaDurumu.HASSAS, "imza1")),
                setOf("com.ornek.c"),
            ),
        )
        assertEquals(UygulamaDurumu.ACIK, l.durum("com.ornek.a"))
        assertEquals(UygulamaDurumu.HASSAS, l.durum("com.ornek.b"))
        assertEquals(UygulamaDurumu.DEGISMEZ, l.durum("com.ornek.c"))
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.d"))
        assertEquals(listOf("com.ornek.a", "com.ornek.b"), l.uygulamalar().map { it.paket })
        assertEquals(UygulamaDurumu.DEGISMEZ, l.durum(kendi))
    }

    @Test
    fun uygulamalarSiraVeDurumlari() {
        val l = listelerKur.kur(
            kendi,
            girdi(
                listOf(
                    kurulu("com.ornek.z", ad = "Z"),
                    kurulu("com.android.settings", ad = "Ayarlar"),
                    kurulu("com.ornek.a", ad = "A"),
                    kurulu(banka, ad = "Ziraat Mobil"),
                    kurulu("com.ornek.h", ad = "H"),
                ),
                mapOf(
                    "com.ornek.a" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"),
                    "com.ornek.h" to KullaniciKarari(UygulamaDurumu.HASSAS, "imza1"),
                ),
            ),
        )
        assertEquals(
            listOf(
                UygulamaBilgisi("com.ornek.z", "Z", UygulamaDurumu.ACIK),
                UygulamaBilgisi("com.android.settings", "Ayarlar", UygulamaDurumu.DEGISMEZ),
                UygulamaBilgisi("com.ornek.a", "A", UygulamaDurumu.ACIK),
                UygulamaBilgisi(banka, "Ziraat Mobil", UygulamaDurumu.HASSAS),
                UygulamaBilgisi("com.ornek.h", "H", UygulamaDurumu.HASSAS),
            ),
            l.uygulamalar(),
        )
    }
}
