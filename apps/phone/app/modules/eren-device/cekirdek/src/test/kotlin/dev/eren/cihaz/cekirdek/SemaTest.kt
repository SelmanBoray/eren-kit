package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * `Sema`: gelen sınıflandırma `protocol/vektorler/cihaz-mesaj.json`'daki Zod kararıyla aynı olmalı
 * (bilinçli farklar adla sabit); giden çerçeveler `eren.cikti` dosyasına yazılır, Node testi onları
 * `cihazYukariCoz` ile doğrular.
 */
class SemaTest {
    private data class Vektor(val ad: String, val ham: String, val gecerli: Boolean, val tur: String?, val kod: String?)

    private fun nesne(d: JsonDeger?): Map<String, JsonDeger> = (d as JsonDeger.Nesne).alanlar

    private fun metinDeger(d: JsonDeger?): String = (d as JsonDeger.Metin).deger

    private fun cozJson(s: String): JsonDeger = (Json.coz(s) as JsonSonucu.Tamam).deger

    private fun vektorler(): List<Vektor> {
        val depo = File(System.getProperty("eren.depo")).canonicalFile
        val metin = File(depo, "protocol/vektorler/cihaz-mesaj.json").readText(Charsets.UTF_8)
        val kok = nesne(cozJson(metin))
        val dizi = (kok["asagi"] as JsonDeger.Dizi).ogeler
        return dizi.map {
            val o = nesne(it)
            Vektor(
                ad = metinDeger(o["ad"]),
                ham = metinDeger(o["ham"]),
                gecerli = (o["gecerli"] as JsonDeger.Mantik).deger,
                tur = (o["tur"] as? JsonDeger.Metin)?.deger,
                kod = (o["kod"] as? JsonDeger.Metin)?.deger,
            )
        }
    }

    /** Çekirdeğin kararı Zod'un `(gecerli, tur, kod)` üçlüsüne eşlenir; `KomutReddi` ret sayılır. */
    private fun sinif(g: GelenCerceve): Triple<Boolean, String?, String?> = when (g) {
        is GelenCerceve.AuthChallenge -> Triple(true, "auth_challenge", null)
        is GelenCerceve.Welcome -> Triple(true, "welcome", null)
        is GelenCerceve.Komut -> Triple(true, "cmd", null)
        is GelenCerceve.Bildirim -> Triple(true, "notify", null)
        is GelenCerceve.IzinGeriCek -> Triple(true, "grant_revoke", null)
        is GelenCerceve.PcHatasi -> Triple(true, "error", null)
        is GelenCerceve.KomutReddi -> Triple(false, null, "gecersiz_mesaj")
        is GelenCerceve.Gecersiz -> Triple(false, null, g.neden.kod.kablo)
    }

    /** Yinelenen anahtar, `-0` ve eşsiz vekil: Zod kabul eder, çekirdek reddeder (bilinçli). */
    private fun bilincliFark(ad: String) =
        "yinelenen" in ad || "-0" in ad || "eşsiz vekil" in ad

    @Test
    fun `asagi vektorler Zod ile ayni siniflanir bilincli farklar disinda`() {
        val hepsi = vektorler()
        assertTrue(hepsi.size >= 80, "vektör sayısı: ${hepsi.size}")
        val sapanlar = mutableListOf<String>()
        for (v in hepsi) {
            val beklenen = Triple(v.gecerli, v.tur, v.kod)
            val gercek = sinif(Sema.gelen(v.ham))
            if (beklenen == gercek) {
                assertFalse(bilincliFark(v.ad) && v.gecerli, "bilinçli fark ama aynı çıktı: ${v.ad}")
                continue
            }
            assertTrue(bilincliFark(v.ad), "beklenmeyen fark: ${v.ad}: Zod=$beklenen çekirdek=$gercek")
            sapanlar.add(v.ad)
        }
        val kabulEdilenFarklar = hepsi.filter { bilincliFark(it.ad) && it.gecerli }
        assertTrue(kabulEdilenFarklar.isNotEmpty())
        for (v in kabulEdilenFarklar) {
            assertFalse(sinif(Sema.gelen(v.ham)).first, "çekirdek reddetmeli: ${v.ad}")
        }
        assertEquals(kabulEdilenFarklar.map { it.ad }.toSet(), sapanlar.toSet())
    }

    @Test
    fun `bilincli farklar adla sabit`() {
        val adlar = vektorler().filter { bilincliFark(it.ad) && it.gecerli }.map { it.ad }
        fun var_(parca: String) = adlar.any { parca in it }
        assertTrue(var_("yinelenen name"), "yinelenen name")
        assertTrue(var_("args içinde yinelenen"), "args yinelenen")
        assertTrue(var_("yinelenen v"), "yinelenen v")
        assertTrue(var_("koordinat -0"), "koordinat -0")
        assertTrue(var_("type_text eşsiz vekil"), "type_text vekil")
        assertTrue(var_("elements sorgu eşsiz vekil"), "sorgu vekil")
    }

    // ---------------------------------------------------------------------------------------------
    // Giden çerçeveler
    // ---------------------------------------------------------------------------------------------

    private val token = "TOKEN_gizli_abcdefghijklmnopqrstuvwxyz0123456789"
    private val parola = "parola-degeri-xyz-987"
    private val b64 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNA=="

    private fun yaz(kare: String): String {
        SahteCikti.ekle(kare)
        return kare
    }

    private fun alanlar(kare: String) = nesne(cozJson(kare))

    private val onPlan = OnPlan("Başlık", "com.ornek.uygulama")

    private fun el(id: Int, ad: String = "ad", deger: String? = null, parola: Boolean = false, rol: String = "Button") =
        Element(id, rol, ad, deger, 10, 20, false, parola)

    private fun izin() = IzinKaydi(
        grantId = "g1",
        planId = "plan_1",
        planHash = "a".repeat(64),
        token = token,
        mod = IzinModu.OKU,
        uygulamalar = listOf(IzinliUygulama("com.ornek.uygulama", "Örnek")),
        izinliMetin = emptyList(),
        serbestMetin = false,
        bitisMonotonikMs = 1_000_000L,
        kalanButce = 25,
    )

    @Test
    fun `giden ciktilar tur ve alanlari dogru`() {
        val hello = alanlar(yaz(Sema.hello("tel-1", b64)))
        assertEquals("hello", metinDeger(hello["type"]))
        assertEquals(JsonDeger.Tam(1), hello["v"])
        assertEquals("tel-1", metinDeger(hello["device_id"]))

        val auth = alanlar(yaz(Sema.authResponse(b64)))
        assertEquals("auth_response", metinDeger(auth["type"]))
        assertEquals(b64, metinDeger(auth["signature"]))

        val revoked = alanlar(yaz(Sema.grantRevoked("g1", GrantNedeni.LIMIT_KILIT)))
        assertEquals("grant_revoked", metinDeger(revoked["type"]))
        assertEquals("limit_kilit", metinDeger(revoked["neden"]))

        val durum = alanlar(yaz(Sema.deviceState(CihazDurumu(a11y = true, kilitli = false, adbAcik = true))))
        assertEquals(JsonDeger.Mantik(true), durum["a11y"])
        assertEquals(JsonDeger.Mantik(false), durum["kilitli"])
        assertEquals(JsonDeger.Mantik(true), durum["adb_enabled"])

        val ack = alanlar(yaz(Sema.notifyAck("n1")))
        assertEquals("notify_ack", metinDeger(ack["type"]))
        assertEquals("n1", metinDeger(ack["notify_id"]))

        // `error` kasıtlı olarak eren.cikti'ye yazılmaz: cihaz.ts `CihazYukari` telefondan `error`
        // kabul etmez (vektör "yukarı yönde error" gecerli:false), Sema.hata ise üretir. Çelişki raporda.
        for (kod in HataKodu.entries) {
            val h = alanlar(Sema.hata(kod))
            assertEquals("error", metinDeger(h["type"]))
            assertEquals(kod.kablo, metinDeger(h["code"]))
            assertFalse(h.containsKey("detail"))
        }
    }

    @Test
    fun `cmdResult ok denied hata ve foreground`() {
        val ok = alanlar(yaz(Sema.cmdResult("c1", CmdSonucu(true, onPlan, null, null, null))))
        assertEquals(JsonDeger.Mantik(true), ok["ok"])
        assertEquals("com.ornek.uygulama", metinDeger(nesne(ok["foreground"])["paket"]))
        assertFalse(ok.containsKey("denied"))
        assertFalse(ok.containsKey("hata"))

        val ret = alanlar(yaz(Sema.cmdResult("c2", CmdSonucu(false, null, null, DeniedNeden.IZIN_YOK, null))))
        assertEquals(JsonDeger.Mantik(false), ret["ok"])
        assertEquals(JsonDeger.Bos, ret["foreground"])
        assertEquals("izin_yok", metinDeger(ret["denied"]))
        assertFalse(ret.containsKey("hata"))

        val hata = alanlar(yaz(Sema.cmdResult("c3", CmdSonucu(false, onPlan, null, null, CihazHatasi.ZAMAN_ASIMI))))
        assertEquals("zaman_asimi", metinDeger(hata["hata"]))
        assertFalse(hata.containsKey("denied"))

        // Paket biçiminde olmayan ön plan null yazılır.
        val bozukOnPlan = alanlar(
            yaz(Sema.cmdResult("c4", CmdSonucu(true, OnPlan("b", "paket degil"), null, null, null))),
        )
        assertEquals(JsonDeger.Bos, bozukOnPlan["foreground"])

        for (n in DeniedNeden.entries) {
            yaz(Sema.cmdResult("c_${n.kablo}", CmdSonucu(false, null, null, n, null)))
        }
        for (h in CihazHatasi.entries) {
            yaz(Sema.cmdResult("h_${h.kablo}", CmdSonucu(false, onPlan, null, null, h)))
        }
    }

    @Test
    fun `cmdResult elements parola degeri cikmaz ve uzun alan kirpilir`() {
        val liste = listOf(
            el(0, ad = "Kullanıcı", deger = "kimse"),
            el(1, ad = "Parola", deger = parola, parola = true, rol = "EditText"),
            el(2, ad = "a".repeat(3_000), deger = "d".repeat(3_000)),
            el(3, rol = "weird role/!*"),
            el(4, rol = "!!!"),
        )
        val kare = yaz(
            Sema.cmdResult(
                "e1",
                CmdSonucu(true, OnPlan("b".repeat(300), "com.ornek.uygulama"), CmdPayload.Elementler(false, liste), null, null),
            ),
        )
        assertFalse(kare.contains(parola), "parola değeri çıktıda")
        val a = alanlar(kare)
        assertEquals(Sinirlar.ON_PLAN_BASLIK, metinDeger(nesne(a["foreground"])["baslik"]).length)
        val p = nesne(a["payload"])
        assertEquals("elements", metinDeger(p["kind"]))
        val ogeler = (p["elements"] as JsonDeger.Dizi).ogeler.map(::nesne)
        assertEquals(5, ogeler.size)
        assertEquals(JsonDeger.Mantik(true), ogeler[1]["password"])
        assertFalse(ogeler[1].containsKey("deger"))
        assertEquals("kimse", metinDeger(ogeler[0]["deger"]))
        assertEquals(Sinirlar.ELEMENT_METIN, metinDeger(ogeler[2]["ad"]).length)
        assertEquals(Sinirlar.ELEMENT_METIN, metinDeger(ogeler[2]["deger"]).length)
        assertTrue(metinDeger(ogeler[3]["rol"]).all { (it.isLetterOrDigit() && it.code < 128) || it in "_.-" })
        assertEquals("node", metinDeger(ogeler[4]["rol"]))
    }

    @Test
    fun `cmdResult elements adet siniri ve kirpildi`() {
        val cok = (0 until Sinirlar.ELEMENT_ADET + 100).map { el(it) }
        val a = alanlar(
            yaz(Sema.cmdResult("e2", CmdSonucu(true, onPlan, CmdPayload.Elementler(false, cok), null, null))),
        )
        val p = nesne(a["payload"])
        assertEquals(Sinirlar.ELEMENT_ADET, (p["elements"] as JsonDeger.Dizi).ogeler.size)
        assertEquals(JsonDeger.Mantik(true), p["truncated"])

        val az = alanlar(
            yaz(Sema.cmdResult("e3", CmdSonucu(true, onPlan, CmdPayload.Elementler(false, listOf(el(0))), null, null))),
        )
        assertEquals(JsonDeger.Mantik(false), nesne(az["payload"])["truncated"])
    }

    @Test
    fun `kirpma vekil ciftini ortadan bolmez`() {
        val ad = "x".repeat(Sinirlar.ELEMENT_METIN - 1) + "😀" + "son"
        val kare = yaz(
            Sema.cmdResult("e4", CmdSonucu(true, onPlan, CmdPayload.Elementler(false, listOf(el(0, ad = ad))), null, null)),
        )
        val o = nesne((nesne(alanlar(kare)["payload"])["elements"] as JsonDeger.Dizi).ogeler[0])
        val kirpik = metinDeger(o["ad"])
        assertTrue(kirpik.length <= Sinirlar.ELEMENT_METIN)
        assertFalse(kirpik.last().isHighSurrogate())
    }

    @Test
    fun `cmdResult goruntu`() {
        val tamam = CmdPayload.Goruntu("image/png", b64, 1080, 2400, 1.5)
        val a = alanlar(yaz(Sema.cmdResult("g1", CmdSonucu(true, onPlan, tamam, null, null))))
        val p = nesne(a["payload"])
        assertEquals("image", metinDeger(p["kind"]))
        assertEquals("image/png", metinDeger(p["mime"]))
        assertEquals(b64, metinDeger(p["image_base64"]))
        assertEquals(JsonDeger.Tam(1080), p["width"])

        // Kabloya sığmayan görüntü sahte başarı olmaz: ekran_alinamadi.
        val bozuk = CmdPayload.Goruntu("image/gif", b64, 10, 10, 1.0)
        val b = alanlar(yaz(Sema.cmdResult("g2", CmdSonucu(true, onPlan, bozuk, null, null))))
        assertEquals(JsonDeger.Mantik(false), b["ok"])
        assertEquals("ekran_alinamadi", metinDeger(b["hata"]))
        assertFalse(b.containsKey("payload"))
    }

    @Test
    fun `grantIssued jeton yalniz burada gecer`() {
        val g = yaz(Sema.grantIssued(izin(), 60_000L))
        assertTrue(g.contains(token))
        val a = alanlar(g)
        assertEquals(token, metinDeger(a["token"]))
        assertEquals(JsonDeger.Tam(25), a["butce"])
        assertEquals(JsonDeger.Tam(60_000), a["kalan_ms"])
        assertEquals("oku", metinDeger(a["mod"]))

        val digerleri = listOf(
            Sema.hello("tel-1", b64),
            Sema.authResponse(b64),
            Sema.cmdResult("c1", CmdSonucu(true, onPlan, null, null, null)),
            Sema.grantRevoked("g1", GrantNedeni.IS_BITTI),
            Sema.deviceState(CihazDurumu(true, false, false)),
            Sema.appList(listOf(UygulamaBilgisi("com.ornek.uygulama", "Örnek", UygulamaDurumu.ACIK))),
            Sema.notifyAck("n1"),
            Sema.hata(HataKodu.YETKISIZ),
        )
        for (d in digerleri) assertFalse(d.contains(token))
    }

    @Test
    fun `grantIssued kaynagi kabloya tasimaz`() {
        val onay = Sema.grantIssued(izin(), 60_000L)
        val oto = yaz(Sema.grantIssued(izin().copy(kaynak = IzinKaynagi.OTO), 60_000L))
        assertEquals(onay, oto, "kaynak kablo çerçevesini değiştirmemeli")
        assertEquals(
            setOf("v", "type", "grant_id", "token", "plan_id", "plan_hash", "mod", "uygulamalar", "kalan_ms", "butce"),
            alanlar(oto).keys,
        )
        for (k in listOf("kaynak", "ONAY", "OTO", "onay", "oto")) assertFalse(oto.contains("\"$k\""), k)
    }

    @Test
    fun `appList uzun ad ve adet kirpilir`() {
        val a = alanlar(
            yaz(Sema.appList(listOf(UygulamaBilgisi("com.ornek.uygulama", "u".repeat(300), UygulamaDurumu.HASSAS)))),
        )
        val ogeler = (a["uygulamalar"] as JsonDeger.Dizi).ogeler.map(::nesne)
        assertEquals(Sinirlar.UYGULAMA_ADI, metinDeger(ogeler[0]["ad"]).length)
        assertEquals("hassas", metinDeger(ogeler[0]["durum"]))

        val cok = (0 until Sinirlar.UYGULAMA_LISTESI_ADET + 50).map {
            UygulamaBilgisi("com.ornek.u$it", "Ad$it", UygulamaDurumu.entries[it % 4])
        }
        val b = alanlar(yaz(Sema.appList(cok)))
        assertEquals(Sinirlar.UYGULAMA_LISTESI_ADET, (b["uygulamalar"] as JsonDeger.Dizi).ogeler.size)

        val bos = alanlar(yaz(Sema.appList(emptyList())))
        assertEquals(0, (bos["uygulamalar"] as JsonDeger.Dizi).ogeler.size)
    }
}
