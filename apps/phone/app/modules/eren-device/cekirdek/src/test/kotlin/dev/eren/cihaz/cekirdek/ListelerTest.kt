package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ListelerTest {
    private val kendi = "com.ornek.eren"

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
    fun bilinmeyenPaketYeni() {
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu("com.ornek.a"))))
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.a"))
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.hic"))
    }

    @Test
    fun kuruluOlmayanPaketinKarariYoksayilir() {
        val kararlar = mapOf("com.ornek.a" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"))
        val l = listelerKur.kur(kendi, girdi(emptyList(), kararlar))
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.a"))
    }

    @Test
    fun imzaDegisinceYeni() {
        val kararlar = mapOf("com.ornek.a" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1"))
        val l = listelerKur.kur(kendi, girdi(listOf(kurulu("com.ornek.a", "imza2")), kararlar))
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.a"))
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
    fun gecersizKararDurumuYeniOlur() {
        val l = listelerKur.kur(
            kendi,
            girdi(
                listOf(kurulu("com.ornek.a"), kurulu("com.ornek.b")),
                mapOf(
                    "com.ornek.a" to KullaniciKarari(UygulamaDurumu.DEGISMEZ, "imza1"),
                    "com.ornek.b" to KullaniciKarari(UygulamaDurumu.YENI, "imza1"),
                ),
            ),
        )
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.a"))
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.b"))
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
        assertEquals(UygulamaDurumu.YENI, l.durum("com.ornek.a"))
        assertEquals(UygulamaDurumu.HASSAS, l.durum("com.ornek.b"))
        assertEquals(UygulamaDurumu.DEGISMEZ, l.durum("com.ornek.c"))
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
                ),
                mapOf("com.ornek.a" to KullaniciKarari(UygulamaDurumu.ACIK, "imza1")),
            ),
        )
        assertEquals(
            listOf(
                UygulamaBilgisi("com.ornek.z", "Z", UygulamaDurumu.YENI),
                UygulamaBilgisi("com.android.settings", "Ayarlar", UygulamaDurumu.DEGISMEZ),
                UygulamaBilgisi("com.ornek.a", "A", UygulamaDurumu.ACIK),
            ),
            l.uygulamalar(),
        )
    }
}
