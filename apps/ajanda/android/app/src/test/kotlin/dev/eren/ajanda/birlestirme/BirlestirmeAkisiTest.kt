package dev.eren.ajanda.birlestirme

import dev.eren.ajanda.cekirdek.BirlestirmeOnizlemesi
import dev.eren.ajanda.cekirdek.BirlestirmeSonucu
import dev.eren.ajanda.cekirdek.CakisanKayit
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.KoparmaSonucu
import dev.eren.ajanda.cekirdek.OlasiCift
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Birleştirme akışı sahte çekirdek yüzüyle: soru, yeniden önizleme, kopma, vazgeç, erteleme, hatalar. */
class BirlestirmeAkisiTest {
    /** Sırayla tüketilen yanıtlar; [Exception] ise atılır. */
    private class SahteBirlestirme : BirlestirmeCekirdegi {
        val onizlemeler = ArrayDeque<Any?>()
        val onaySonuclari = ArrayDeque<Any>()
        var vazgecSonucu: Any = koparma(true)
        val cagrilar = mutableListOf<String>()

        override fun birlestirmeOnizlemesi(): BirlestirmeOnizlemesi? {
            cagrilar += "onizleme"
            val o = onizlemeler.removeFirst()
            if (o is Exception) throw o
            return o as BirlestirmeOnizlemesi?
        }

        override fun birlestirmeyiOnayla(iz: String?): BirlestirmeSonucu {
            cagrilar += "onayla:$iz"
            val o = onaySonuclari.removeFirst()
            if (o is Exception) throw o
            return o as BirlestirmeSonucu
        }

        override fun birlestirmedenVazgec(): KoparmaSonucu {
            cagrilar += "vazgec"
            val o = vazgecSonucu
            if (o is Exception) throw o
            return o as KoparmaSonucu
        }
    }

    private val yuz = SahteBirlestirme()
    private val akis = BirlestirmeAkisi(yuz)

    private fun plan(
        iz: String = "iz1",
        yeni: Int = 3,
        degisen: Int = 2,
        cakisan: Int = 1,
        islem: Int = 5,
        ayniDepo: Boolean = false,
        cift: Int = 1,
    ) = BirlestirmeOnizlemesi(
        depoId = "depo_ornek",
        ayniDepo = ayniDepo,
        yeni = yeni,
        degisen = degisen,
        cakisanlar = List(cakisan) { CakisanKayit("k_gizli_$it", listOf("baslik")) },
        pcSilmisler = listOf("k_gizli_silinmis"),
        retListesine = emptyList(),
        dusecekMezar = 2,
        ayni = 4,
        servistenGelecek = 6,
        islem = islem,
        olasiCiftler = List(cift) { OlasiCift("k_gizli_tel_$it", "k_gizli_srv_$it") },
        iz = iz,
    )

    private fun temiz(a: BirlestirmeAkisi.Adim) {
        val t = "${a.baslik}\n${a.metin}"
        assertFalse(t, t.contains("k_gizli"))
        assertFalse(t, t.contains("depo_ornek"))
        assertFalse(t, Regex("\\bPC\\b").containsMatchIn(t))
    }

    @Test
    fun onizlemeSorulurOnaylaninceSonucGelir() {
        yuz.onizlemeler += plan()
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan())
        val o = akis.denetle()
        assertTrue(o.toString(), o is BirlestirmeAkisi.Adim.Onay)
        o as BirlestirmeAkisi.Adim.Onay
        assertEquals("Kayıtlar Eren servisiyle birleştirilsin mi?", o.baslik)
        assertEquals(
            "Bu telefondaki kayıtlar Eren servisindekilerle birleştirilecek.\n" +
                "• 3 kayıt Eren servisine yeni kayıt olarak gidecek\n" +
                "• 2 kayıttaki değişiklik Eren servisine gidecek\n" +
                "• 1 kayıtta iki tarafta da aynı bilgi değişmiş: telefondaki geçerli olacak (Eren servisindeki önceki hali geçmişte kalır)\n" +
                "• 1 kayıt Eren servisinde silinmiş ama telefonda değişmiş: gönderilemeyenler listesine düşecek\n" +
                "• Telefonda silinmiş 2 kayıt gönderilmeyecek, Silinenler'den kalkacak\n" +
                "• 4 kayıt Eren servisindekiyle aynı\n" +
                "• 6 kayıt Eren servisinden telefona gelecek\n" +
                "• 1 kayıt Eren servisindeki bir kayda benziyor (aynı tür, başlık ve zaman): ikisi de tutulacak, listede işaretlenecek\n" +
                "Onaylarsanız değişiklikler Eren servisine 5 işlem olarak gönderilir.\n" +
                "Bundan sonra kayıtları Eren servisi tutar; bu telefon ona bağlı çalışır.\n" +
                "Vazgeçerseniz hiçbir kayıt değişmez; eşleşme silinir, yeniden bağlanmak için QR kodu yeniden okutulur.\n" +
                "Şimdi değil derseniz bağlantı yeniden kurulunca yeniden sorulur.",
            o.metin,
        )
        assertEquals(listOf("Birleştir", "Vazgeç", "Şimdi değil"), listOf(o.onayDugmesi, o.vazgecDugmesi, o.sonraDugmesi))
        assertTrue(akis.onayBekliyor)
        temiz(o)

        val s = akis.onayla()
        assertTrue(s is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals("Birleştirildi", s.baslik)
        assertEquals(
            "Bu telefon artık Eren servisine bağlı.\n" +
                "5 işlem Eren servisine gönderilmek üzere sıraya alındı.\n" +
                "1 kayıt gönderilemeyenler listesine düşebilir; oradan düzeltilebilir.\n" +
                "1 olası çift listede işaretlendi.",
            s.metin,
        )
        assertFalse(akis.onayBekliyor)
        assertEquals(listOf("onizleme", "onayla:iz1"), yuz.cagrilar)
        temiz(s)
    }

    @Test
    fun bekleyenYoksaSorulmaz() {
        yuz.onizlemeler += null
        assertNull(akis.denetle())
        assertFalse(akis.onayBekliyor)
        val a = akis.onayla()
        assertTrue(a is BirlestirmeAkisi.Adim.Hata)
        assertEquals("Onay bekleyen bir birleştirme yok.", a.metin)
        assertFalse(yuz.cagrilar.any { it.startsWith("onayla") })
    }

    @Test
    fun planDegistiyseYeniPlanYeniIzleOnaylanir() {
        yuz.onizlemeler += plan(iz = "iz1")
        yuz.onaySonuclari += BirlestirmeSonucu(false, plan(iz = "iz2", yeni = 4))
        yuz.onaySonuclari += BirlestirmeSonucu(true, plan(iz = "iz2", yeni = 4))
        akis.denetle()
        val yeniden = akis.onayla()
        assertTrue(yeniden is BirlestirmeAkisi.Adim.Onay)
        assertEquals("Kayıtlar bu arada değişti", yeniden.baslik)
        assertTrue(yeniden.metin, yeniden.metin.startsWith("Önizlemeden sonra kayıtlar değişti; plan yenilendi.\n"))
        assertTrue(yeniden.metin, yeniden.metin.contains("• 4 kayıt Eren servisine yeni kayıt olarak gidecek"))
        assertTrue(akis.onayla() is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals(listOf("onizleme", "onayla:iz1", "onayla:iz2"), yuz.cagrilar)
    }

    @Test
    fun planBossaBaglantiKoptuYenidenSorulacak() {
        yuz.onizlemeler += plan()
        yuz.onaySonuclari += BirlestirmeSonucu(false, null)
        akis.denetle()
        val a = akis.onayla()
        assertTrue(a is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals("Birleştirilemedi", a.baslik)
        assertEquals("Eren servisiyle bağlantı koptu; hiçbir kayıt değişmedi. Yeniden bağlanınca yeniden sorulacak.", a.metin)
        assertFalse(akis.onayBekliyor)
        temiz(a)
    }

    @Test
    fun vazgecBaglanmayiIptalEder() {
        yuz.onizlemeler += plan()
        akis.denetle()
        val a = akis.vazgec()
        assertTrue(a is BirlestirmeAkisi.Adim.Bilgi)
        assertEquals("Bağlanma iptal edildi", a.baslik)
        assertTrue(a.metin, a.metin.contains("QR kodunu yeniden okutun"))
        assertFalse(akis.onayBekliyor)
        assertEquals(listOf("onizleme", "vazgec"), yuz.cagrilar)
        temiz(a)

        yuz.vazgecSonucu = koparma(false)
        assertEquals("Süren bir bağlanma yoktu; hiçbir şey değişmedi.", akis.vazgec().metin)
        yuz.vazgecSonucu = CekirdekHatasi.GecersizDurum("bağlı kipte")
        val h = akis.vazgec()
        assertTrue(h is BirlestirmeAkisi.Adim.Hata)
        assertEquals("Bu telefon zaten Eren servisine bağlı; sorulacak bir şey yok.", h.metin)
    }

    @Test
    fun simdiDegilBuBaglantidaYenidenSormazKopunculaSifirlanir() {
        yuz.onizlemeler += plan()
        assertTrue(akis.denetle() is BirlestirmeAkisi.Adim.Onay)
        akis.simdiDegil()
        assertFalse(akis.onayBekliyor)
        // Aynı bağlantıda yeni bildirim: sorulmaz.
        yuz.onizlemeler += plan(iz = "iz2")
        assertNull(akis.denetle())
        // Kullanıcı kendisi açarsa sorulur.
        yuz.onizlemeler += plan(iz = "iz2")
        assertTrue(akis.denetle(zorla = true) is BirlestirmeAkisi.Adim.Onay)
        akis.simdiDegil()
        // Bağlantı koptu (önizleme kalktı), sonraki bağlantıda yeniden sorulur.
        yuz.onizlemeler += null
        assertNull(akis.denetle())
        yuz.onizlemeler += plan(iz = "iz3")
        assertTrue(akis.denetle() is BirlestirmeAkisi.Adim.Onay)
        assertFalse(yuz.cagrilar.any { it.startsWith("onayla") || it == "vazgec" })
    }

    @Test
    fun ayniDepoVeYalnizSayilar() {
        yuz.onizlemeler += plan(ayniDepo = true, islem = 0, cakisan = 0, cift = 0, yeni = 0, degisen = 0)
        val o = akis.denetle()!!
        assertTrue(o.metin, o.metin.startsWith("Bu telefon daha önce bu Eren servisine bağlıydı."))
        assertFalse(o.metin, o.metin.contains("işlem olarak"))
        assertFalse(o.metin, o.metin.contains("benziyor"))
        temiz(o)
    }

    @Test
    fun hatalarAdimaCevrilir() {
        yuz.onizlemeler += CekirdekHatasi.Depo("k_gizli içerik")
        val a = akis.denetle()
        assertTrue(a is BirlestirmeAkisi.Adim.Hata)
        assertEquals("Birleştirme yapılamadı", a!!.baslik)
        assertEquals("Telefondaki kayıt deposu kullanılamadı. Yeniden deneyin.", a.metin)
        temiz(a)

        yuz.onizlemeler += plan()
        yuz.onaySonuclari += IllegalStateException("k_gizli")
        akis.denetle()
        val h = akis.onayla()
        assertEquals("Beklenmeyen bir sorun oldu. Yeniden deneyin.", h.metin)
        assertFalse(akis.onayBekliyor)
        temiz(h)
    }

    @Test
    fun ilgiliBildirimler() {
        fun d(tumu: Boolean = false, baglanti: Boolean = false, eslesme: Boolean = false, kayitlar: List<String> = emptyList()) =
            Degisim(kayitlar, tumu, false, baglanti, eslesme, emptyList())
        assertTrue(BirlestirmeAkisi.ilgili(d(baglanti = true)))
        assertTrue(BirlestirmeAkisi.ilgili(d(tumu = true)))
        assertTrue(BirlestirmeAkisi.ilgili(d(eslesme = true)))
        assertFalse(BirlestirmeAkisi.ilgili(d(kayitlar = listOf("k1"))))
    }

    private companion object {
        fun koparma(iptal: Boolean) = KoparmaSonucu(CalismaKipi.YEREL, 0, 0, 0, 0, iptal)
    }
}
