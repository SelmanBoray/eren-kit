package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class KimlikMetniTest {
    private val cn = "A".repeat(24)
    private val sn = "B".repeat(22) + "=="

    private fun metin(
        rol: ImzaRolu = ImzaRolu.PC,
        kanal: Kanal = Kanal.CIHAZ,
        id: String = "tel-1",
        c: String = cn,
        s: String = sn,
    ): String? = KimlikMetni.metin(rol, kanal, id, c, s)

    // protocol/src/temel.ts kimlikImzaMetni: ["eren-auth-v1", rol, kanal, device_id, client_nonce, server_nonce].join("\n")
    @Test
    fun temelTsIleBaytBaytAyni() {
        assertEquals(
            "eren-auth-v1\npc\ncihaz\ntel-1\n" + "A".repeat(24) + "\n" + "B".repeat(22) + "==",
            metin(),
        )
        assertEquals(
            "eren-auth-v1\ntelefon\nsohbet\nAb_9-Z\nab+/cdefghijklmnopqrstuvwx\nQUJDREVGR0hJSktMTU5PUFFSU1RVVldY",
            metin(ImzaRolu.TELEFON, Kanal.SOHBET, "Ab_9-Z", "ab+/cdefghijklmnopqrstuvwx", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldY"),
        )
        val d64 = "x".repeat(64)
        val n88 = "Q".repeat(88)
        assertEquals("eren-auth-v1\npc\nsohbet\n$d64\n$n88\n${"R".repeat(23)}=", metin(ImzaRolu.PC, Kanal.SOHBET, d64, n88, "R".repeat(23) + "="))
    }

    @Test
    fun bagimsizKopyaylaAyni() {
        // SahtePc.imzaMetni'nin biçimi: sabit sürüm ön eki, alanlar \n ile
        for (rol in ImzaRolu.entries) for (kanal in Kanal.entries) {
            val beklenen = listOf("eren-auth-v1", rol.kablo, kanal.kablo, "tel-1", cn, sn).joinToString("\n")
            assertEquals(beklenen, metin(rol, kanal))
        }
    }

    @Test
    fun sondaSatirSonuYokVeBesSatirAyiriciVar() {
        val m = metin()!!
        assertEquals(false, m.endsWith("\n"))
        assertEquals(5, m.count { it == '\n' })
        assertEquals(false, m.contains('\r'))
    }

    @Test
    fun rolVeKanalMetneGirerDortFarkliMetin() {
        val hepsi = ImzaRolu.entries.flatMap { r -> Kanal.entries.map { k -> metin(r, k) } }
        assertEquals(4, hepsi.size)
        hepsi.forEach { assertNotNull(it) }
        assertEquals(4, hepsi.toSet().size)
        assertEquals("pc", metin(ImzaRolu.PC)!!.split("\n")[1])
        assertEquals("sohbet", metin(kanal = Kanal.SOHBET)!!.split("\n")[2])
    }

    @Test
    fun nonceGecerliBicimler() {
        assertNotNull(metin(c = "A".repeat(24)))
        assertNotNull(metin(c = "A".repeat(88)))
        assertNotNull(metin(c = "A".repeat(23) + "="))
        assertNotNull(metin(c = "A".repeat(22) + "=="))
        assertNotNull(metin(c = "+".repeat(12) + "/".repeat(12)))
    }

    @Test
    fun nonceSatirSonuReddedilir() {
        for (kotu in listOf("\n", "\r", "\r\n")) {
            assertNull(metin(c = cn + kotu))
            assertNull(metin(s = sn + kotu))
            assertNull(metin(c = "A".repeat(12) + kotu + "A".repeat(12)))
            assertNull(metin(s = kotu + "B".repeat(24)))
        }
        // "eren-auth-v1\n..." enjeksiyonu: nonce'a ek satır sokma
        assertNull(metin(c = "A".repeat(24) + "\ntelefon"))
    }

    @Test
    fun nonceEsittirYanlisYerde() {
        assertNull(metin(c = "=" + "A".repeat(23)))
        assertNull(metin(c = "A".repeat(10) + "=" + "A".repeat(13)))
        assertNull(metin(c = "A".repeat(21) + "==="))
        assertNull(metin(c = "A".repeat(20) + "=A=="))
        assertNull(metin(c = "=".repeat(24)))
        assertNull(metin(s = "=" .repeat(88)))
    }

    @Test
    fun nonceUzunlukSiniri() {
        assertNull(metin(c = "A".repeat(23)))
        assertNull(metin(c = ""))
        assertNull(metin(c = "A".repeat(89)))
        assertNull(metin(s = "A".repeat(87) + "=="))
        assertNull(metin(s = "A".repeat(23)))
    }

    @Test
    fun nonceBase64DisiKarakter() {
        for (c in listOf("-", "_", " ", "\t", "ç", "İ", "é", ".", "%", "\u0000", "😀", " ")) {
            assertNull(metin(c = "A".repeat(23) + c), "client '$c'")
            assertNull(metin(s = "A".repeat(12) + c + "A".repeat(12)), "server '$c'")
        }
        assertNull(metin(c = " " + "A".repeat(24)))
        assertNull(metin(c = "A".repeat(24) + " "))
    }

    @Test
    fun deviceIdKotuKarakterVeUzunluk() {
        assertNull(metin(id = ""))
        assertNull(metin(id = "x".repeat(65)))
        for (kotu in listOf("tel\n1", "tel-1\n", "\ntel-1", "tel 1", " tel-1", "tel-1 ", "tel\r1", "tel\t1", "tel|1", "tel.1", "tel/1", "teı", "tel\u0000", "😀", "tel:1")) {
            assertNull(metin(id = kotu), "'$kotu'")
        }
        // satır enjeksiyonu: id içine rol/kanal sokmaya çalışma
        assertNull(metin(id = "tel-1\ntelefon\nsohbet"))
    }

    @Test
    fun ucDegerleriGecerli() {
        assertNotNull(metin(id = "a"))
        assertNotNull(metin(id = "_-"))
        assertNotNull(metin(id = "Z".repeat(64)))
    }

    @Test
    fun istisnaYok() {
        val girdiler = listOf("", "\n", "=", "%", "\uD800", "\uDC00x", "A".repeat(100_000), "\u0000".repeat(30))
        for (g in girdiler) for (h in girdiler) {
            // yalnız çökmemesi ve null dönmesi beklenir
            assertNull(KimlikMetni.metin(ImzaRolu.PC, Kanal.SOHBET, g, h, cn))
            assertNull(KimlikMetni.metin(ImzaRolu.TELEFON, Kanal.CIHAZ, "tel-1", cn, g))
        }
    }
}
