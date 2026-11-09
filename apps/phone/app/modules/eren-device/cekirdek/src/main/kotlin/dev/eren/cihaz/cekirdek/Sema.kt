package dev.eren.cihaz.cekirdek

/*
 * `/cihaz` kablosunun Kotlin tarafı: gelen çerçevenin sınıfı (`protocol/src/cihaz.ts`, `temel.ts`,
 * `plan.ts`, `cozumle.ts` karşılığı) ve giden çerçeve kurucuları. Gelen her alan düşman girdidir:
 * burada elle yazılmış katı denetimler Zod şemalarıyla aynı kabul/ret kümesini verir. Yinelenen
 * anahtar, `-0` ve eşsiz vekili `Json` zaten reddeder.
 */

object Sema : SemaIslemi {
    private val CMD_ZARFI = setOf("v", "type", "cmd_id", "grant_id", "token", "deadline_ms", "name", "args")

    // -----------------------------------------------------------------------------------------
    // Gelen çerçeve
    // -----------------------------------------------------------------------------------------

    override fun gelen(ham: String): GelenCerceve {
        if (ham.length > AzamiCerceve.CIHAZ) return GelenCerceve.Gecersiz(CerceveHatasi.COK_BUYUK)
        val kok = when (val s = Json.coz(ham)) {
            is JsonSonucu.Hata -> return GelenCerceve.Gecersiz(CerceveHatasi.BOZUK)
            is JsonSonucu.Tamam -> s.deger
        }
        if (kok !is JsonDeger.Nesne) return GelenCerceve.Gecersiz(CerceveHatasi.BOZUK)
        val a = kok.alanlar
        when (val v = a["v"]) {
            is JsonDeger.Tam -> if (v.deger != PROTOKOL_SURUMU.toLong()) {
                return GelenCerceve.Gecersiz(CerceveHatasi.SURUM)
            }
            is JsonDeger.Ondalik -> return GelenCerceve.Gecersiz(CerceveHatasi.SURUM)
            else -> return GelenCerceve.Gecersiz(CerceveHatasi.BOZUK)
        }
        val tur = (a["type"] as? JsonDeger.Metin)?.deger
            ?: return GelenCerceve.Gecersiz(CerceveHatasi.BOZUK)
        return gelenTur(tur, a) ?: GelenCerceve.Gecersiz(CerceveHatasi.BOZUK)
    }

    /** Geçersizse null (çağıran `BOZUK` yapar); `cmd` kendi ret sınıfını döner. */
    private fun gelenTur(tur: String, a: Map<String, JsonDeger>): GelenCerceve? {
        return when (tur) {
            "auth_challenge" -> {
                if (!yalnizca(a, "v", "type", "server_nonce", "server_signature")) return null
                val nonce = nonce(a["server_nonce"]) ?: return null
                val imza = base64(a["server_signature"], 1, Sinirlar.IMZA_MAX) ?: return null
                GelenCerceve.AuthChallenge(nonce, imza)
            }
            "welcome" -> {
                if (!yalnizca(a, "v", "type", "server_time_ms")) return null
                GelenCerceve.Welcome(zaman(a["server_time_ms"]) ?: return null)
            }
            "cmd" -> komut(a)
            "notify" -> {
                if (!yalnizca(a, "v", "type", "notify_id", "tur", "baslik", "metin")) return null
                val id = opakId(a["notify_id"]) ?: return null
                val ad = (a["tur"] as? JsonDeger.Metin)?.deger
                val bildirim = BildirimTuru.entries.firstOrNull { it.kablo == ad } ?: return null
                val baslik = metin(a["baslik"], 0, Sinirlar.BILDIRIM_BASLIK) ?: return null
                val govde = metin(a["metin"], 0, Sinirlar.BILDIRIM_METIN) ?: return null
                GelenCerceve.Bildirim(id, bildirim, baslik, govde)
            }
            "grant_revoke" -> {
                if (!yalnizca(a, "v", "type", "grant_id", "neden")) return null
                val gid = when (val g = a["grant_id"]) {
                    JsonDeger.Bos -> null
                    else -> opakId(g) ?: return null
                }
                val ad = (a["neden"] as? JsonDeger.Metin)?.deger
                val neden = GrantNedeni.entries.firstOrNull { it.kablo == ad } ?: return null
                GelenCerceve.IzinGeriCek(gid, neden)
            }
            "error" -> {
                if (!yalnizca(a, "v", "type", "code", "detail")) return null
                val ad = (a["code"] as? JsonDeger.Metin)?.deger
                val kod = HataKodu.entries.firstOrNull { it.kablo == ad } ?: return null
                if (a.containsKey("detail") && metin(a["detail"], 0, Sinirlar.HATA_DETAYI) == null) return null
                GelenCerceve.PcHatasi(kod)
            }
            else -> null
        }
    }

    private fun komut(a: Map<String, JsonDeger>): GelenCerceve {
        val cmdId = opakId(a["cmd_id"]) ?: return GelenCerceve.Gecersiz(CerceveHatasi.BOZUK)
        fun ret(neden: DeniedNeden) = GelenCerceve.KomutReddi(cmdId, neden)
        val grantId = opakId(a["grant_id"])
        val token = jeton(a["token"])
        val deadline = zaman(a["deadline_ms"])
        if (grantId == null || token == null || deadline == null || !CMD_ZARFI.containsAll(a.keys)) {
            return ret(DeniedNeden.GECERSIZ_ARG)
        }
        val adMetni = (a["name"] as? JsonDeger.Metin)?.deger
        val ad = CmdAdi.entries.firstOrNull { it.kablo == adMetni }
            ?: return ret(DeniedNeden.DESTEKLENMEYEN_KOMUT)
        val args = (a["args"] as? JsonDeger.Nesne)?.alanlar ?: return ret(DeniedNeden.GECERSIZ_ARG)
        return when (val s = argCoz(ad, args)) {
            is ArgSonucu.Ret -> ret(s.neden)
            is ArgSonucu.Tamam -> GelenCerceve.Komut(Cmd(cmdId, grantId, token, deadline, s.arg))
        }
    }

    private sealed interface ArgSonucu {
        data class Tamam(val arg: CmdArg) : ArgSonucu

        data class Ret(val neden: DeniedNeden) : ArgSonucu
    }

    private val GECERSIZ = ArgSonucu.Ret(DeniedNeden.GECERSIZ_ARG)

    private fun argCoz(ad: CmdAdi, a: Map<String, JsonDeger>): ArgSonucu {
        return when (ad) {
            CmdAdi.FOREGROUND -> if (a.isEmpty()) ArgSonucu.Tamam(CmdArg.Foreground) else GECERSIZ
            CmdAdi.SCREENSHOT -> if (a.isEmpty()) ArgSonucu.Tamam(CmdArg.Screenshot) else GECERSIZ
            CmdAdi.ELEMENTS -> {
                if (!yalnizca(a, "query")) return GECERSIZ
                val sorgu = a["query"]?.let { metin(it, 0, Sinirlar.ELEMENT_SORGU) ?: return GECERSIZ }
                ArgSonucu.Tamam(CmdArg.Elements(sorgu))
            }
            CmdAdi.ZOOM -> {
                if (!tamAnahtar(a, "x0", "y0", "x1", "y1")) return GECERSIZ
                val x0 = koordinat(a["x0"]) ?: return GECERSIZ
                val y0 = koordinat(a["y0"]) ?: return GECERSIZ
                val x1 = koordinat(a["x1"]) ?: return GECERSIZ
                val y1 = koordinat(a["y1"]) ?: return GECERSIZ
                if (x1 <= x0 || y1 <= y0) return GECERSIZ
                ArgSonucu.Tamam(CmdArg.Zoom(x0, y0, x1, y1))
            }
            CmdAdi.CLICK -> {
                if (!yalnizca(a, "element", "x", "y", "clicks", "long_press")) return GECERSIZ
                val element = a["element"]?.let { tamSayi(it, 0, Int.MAX_VALUE.toLong())?.toInt() ?: return GECERSIZ }
                val x = a["x"]?.let { koordinat(it) ?: return GECERSIZ }
                val y = a["y"]?.let { koordinat(it) ?: return GECERSIZ }
                val tiklama = a["clicks"]?.let { tamSayi(it, 1, 2)?.toInt() ?: return GECERSIZ } ?: 1
                val uzun = a["long_press"]?.let { (it as? JsonDeger.Mantik)?.deger ?: return GECERSIZ } ?: false
                if ((x == null) != (y == null)) return GECERSIZ
                if ((element != null) == (x != null)) return GECERSIZ
                val nokta = if (x != null && y != null) Nokta(x, y) else null
                ArgSonucu.Tamam(CmdArg.Click(element, nokta, tiklama, uzun))
            }
            CmdAdi.TYPE_TEXT -> {
                if (!tamAnahtar(a, "text")) return GECERSIZ
                val m = metin(a["text"], 1, Sinirlar.YAZILAN_METIN) ?: return GECERSIZ
                ArgSonucu.Tamam(CmdArg.TypeText(m))
            }
            CmdAdi.KEY -> {
                if (!yalnizca(a, "keys", "repeat") || !a.containsKey("keys")) return GECERSIZ
                val adi = (a["keys"] as? JsonDeger.Metin)?.deger
                val tus = Tus.entries.firstOrNull { it.kablo == adi } ?: return GECERSIZ
                val tekrar = a["repeat"]?.let { tamSayi(it, 1, Sinirlar.TEKRAR_MAX.toLong())?.toInt() ?: return GECERSIZ } ?: 1
                ArgSonucu.Tamam(CmdArg.Key(tus, tekrar))
            }
            CmdAdi.SCROLL -> {
                if (!yalnizca(a, "direction", "amount", "x", "y") || !a.containsKey("direction")) return GECERSIZ
                val adi = (a["direction"] as? JsonDeger.Metin)?.deger
                val yon = KaydirmaYonu.entries.firstOrNull { it.kablo == adi } ?: return GECERSIZ
                val miktar = a["amount"]?.let { tamSayi(it, 1, Sinirlar.KAYDIRMA_MAX.toLong())?.toInt() ?: return GECERSIZ }
                val x = a["x"]?.let { koordinat(it) ?: return GECERSIZ }
                val y = a["y"]?.let { koordinat(it) ?: return GECERSIZ }
                if ((x == null) != (y == null)) return GECERSIZ
                val nokta = if (x != null && y != null) Nokta(x, y) else null
                ArgSonucu.Tamam(CmdArg.Scroll(yon, miktar, nokta))
            }
            CmdAdi.DRAG -> {
                if (!tamAnahtar(a, "x0", "y0", "x1", "y1")) return GECERSIZ
                val x0 = koordinat(a["x0"]) ?: return GECERSIZ
                val y0 = koordinat(a["y0"]) ?: return GECERSIZ
                val x1 = koordinat(a["x1"]) ?: return GECERSIZ
                val y1 = koordinat(a["y1"]) ?: return GECERSIZ
                ArgSonucu.Tamam(CmdArg.Drag(x0, y0, x1, y1))
            }
            CmdAdi.WAIT -> {
                if (!tamAnahtar(a, "seconds")) return GECERSIZ
                val sn = when (val d = a["seconds"]) {
                    is JsonDeger.Tam -> d.deger.toDouble()
                    is JsonDeger.Ondalik -> d.deger
                    else -> return GECERSIZ
                }
                if (!(sn > 0.0 && sn <= Sinirlar.BEKLEME_SANIYE_MAX.toDouble())) return GECERSIZ
                ArgSonucu.Tamam(CmdArg.Wait(sn))
            }
            CmdAdi.OPEN_APP -> {
                if (!tamAnahtar(a, "package")) return GECERSIZ
                val paket = (a["package"] as? JsonDeger.Metin)?.deger ?: return GECERSIZ
                if (!paketMi(paket)) return ArgSonucu.Ret(DeniedNeden.URL_INTENT_YASAK)
                ArgSonucu.Tamam(CmdArg.OpenApp(paket))
            }
        }
    }

    // -----------------------------------------------------------------------------------------
    // Plan
    // -----------------------------------------------------------------------------------------

    private val PLAN_ANAHTARLARI = setOf(
        "plan_id", "baslik", "tur", "cwd", "gorev_metni", "kesin_yapilacaklar",
        "kesin_yapilmayacaklar", "mcp_profili", "telefon_izin_istegi", "kirli_kaynak",
    )

    override fun planCoz(ham: String): Plan? {
        if (ham.length > AzamiCerceve.KOPRU) return null
        val kok = (Json.coz(ham) as? JsonSonucu.Tamam)?.deger as? JsonDeger.Nesne ?: return null
        val a = kok.alanlar
        if (!PLAN_ANAHTARLARI.containsAll(a.keys)) return null
        val planId = opakId(a["plan_id"]) ?: return null
        val baslik = planSatiri(a["baslik"], 1, Sinirlar.PLAN_BASLIK) ?: return null
        val turAdi = (a["tur"] as? JsonDeger.Metin)?.deger
        val tur = IsTuru.entries.firstOrNull { it.kablo == turAdi } ?: return null
        val cwd = planSatiri(a["cwd"], 0, Sinirlar.PLAN_CWD) ?: return null
        val gorev = planMetni(a["gorev_metni"], 1, Sinirlar.GOREV_METNI) ?: return null
        val yapilacak = liste(a["kesin_yapilacaklar"], 1, Sinirlar.PLAN_MADDE_ADET) {
            planSatiri(it, 1, Sinirlar.PLAN_MADDE)
        } ?: return null
        val yapilmayacak = liste(a["kesin_yapilmayacaklar"], 0, Sinirlar.PLAN_MADDE_ADET) {
            planSatiri(it, 1, Sinirlar.PLAN_MADDE)
        } ?: return null
        val mcp = a["mcp_profili"]?.let { d ->
            val ad = (d as? JsonDeger.Metin)?.deger
            McpProfili.entries.firstOrNull { it.kablo == ad } ?: return null
        }
        val izin = a["telefon_izin_istegi"]?.let { izinIstegi(it) ?: return null }
        val kirli = a["kirli_kaynak"]?.let { d ->
            liste(d, 1, Sinirlar.KIRLI_KAYNAK_ADET) { tamSayi(it, 1, Long.MAX_VALUE) } ?: return null
        }
        if (tur == IsTuru.PC) {
            if (!(cwd.length >= 3 && cwd[0].isAsciiHarf() && cwd[1] == ':' && (cwd[2] == '\\' || cwd[2] == '/'))) {
                return null
            }
            if (izin != null) return null
        } else {
            if (cwd != "" || izin == null || mcp != null) return null
        }
        return Plan(
            planId = planId,
            baslik = baslik,
            tur = tur,
            cwd = cwd,
            gorevMetni = gorev,
            kesinYapilacaklar = yapilacak,
            kesinYapilmayacaklar = yapilmayacak,
            mcpProfili = mcp,
            telefonIzinIstegi = izin,
            kirliKaynak = kirli.orEmpty(),
            ham = kok,
        )
    }

    private fun izinIstegi(d: JsonDeger): TelefonIzinIstegi? {
        val a = (d as? JsonDeger.Nesne)?.alanlar ?: return null
        if (!setOf("uygulamalar", "mod", "izinli_metin", "serbest_metin").containsAll(a.keys)) return null
        val uygulamalar = liste(a["uygulamalar"], 1, Sinirlar.PLAN_UYGULAMA_ADET) { paket(it) } ?: return null
        val modAdi = (a["mod"] as? JsonDeger.Metin)?.deger
        val mod = IzinModu.entries.firstOrNull { it.kablo == modAdi } ?: return null
        val izinli = a["izinli_metin"]?.let { x ->
            liste(x, 1, Sinirlar.IZINLI_METIN_ADET) { planMetni(it, 1, Sinirlar.IZINLI_METIN) } ?: return null
        }
        val serbest = a["serbest_metin"]?.let { (it as? JsonDeger.Mantik)?.deger ?: return null }
        if (uygulamalar.toSet().size != uygulamalar.size) return null
        if (mod == IzinModu.OKU && (izinli != null || serbest == true)) return null
        if (mod == IzinModu.YAZ && uygulamalar.size != 1) return null
        if (izinli != null && serbest == true) return null
        return TelefonIzinIstegi(uygulamalar, mod, izinli.orEmpty(), serbest ?: false)
    }

    // -----------------------------------------------------------------------------------------
    // Alan denetimleri (temel.ts)
    // -----------------------------------------------------------------------------------------

    private fun Char.isAsciiHarf() = this in 'A'..'Z' || this in 'a'..'z'

    private fun Char.isAsciiRakam() = this in '0'..'9'

    private fun kimlikKarakteri(c: Char) = c.isAsciiHarf() || c.isAsciiRakam() || c == '_' || c == '-'

    private fun opakMi(s: String) = s.length in 1..Sinirlar.OPAK_ID && s.all(::kimlikKarakteri)

    private fun opakId(d: JsonDeger?): String? =
        (d as? JsonDeger.Metin)?.deger?.takeIf(::opakMi)

    private fun jeton(d: JsonDeger?): String? =
        (d as? JsonDeger.Metin)?.deger?.takeIf { it.length in Sinirlar.JETON_MIN..Sinirlar.JETON_MAX && it.all(::kimlikKarakteri) }

    private fun base64Mi(s: String): Boolean {
        var i = 0
        while (i < s.length && (s[i].isAsciiHarf() || s[i].isAsciiRakam() || s[i] == '+' || s[i] == '/')) i++
        if (i == 0) return false
        val kalan = s.length - i
        return kalan <= 2 && (i until s.length).all { s[it] == '=' }
    }

    private fun base64(d: JsonDeger?, en: Int, boy: Int): String? =
        (d as? JsonDeger.Metin)?.deger?.takeIf { it.length in en..boy && base64Mi(it) }

    private fun nonce(d: JsonDeger?): String? = base64(d, Sinirlar.NONCE_MIN, Sinirlar.NONCE_MAX)

    private fun paketMi(s: String): Boolean {
        if (s.length !in 1..Sinirlar.PAKET_ADI) return false
        val parcalar = s.split('.')
        if (parcalar.size < 2) return false
        return parcalar.all { p ->
            p.isNotEmpty() && p[0].isAsciiHarf() &&
                p.all { it.isAsciiHarf() || it.isAsciiRakam() || it == '_' }
        }
    }

    private fun paket(d: JsonDeger?): String? = (d as? JsonDeger.Metin)?.deger?.takeIf(::paketMi)

    private fun metin(d: JsonDeger?, en: Int, boy: Int): String? =
        (d as? JsonDeger.Metin)?.deger?.takeIf { it.length in en..boy }

    /** Yalnız `Tam`: `12.5` ve metin geçersizdir. */
    private fun tamSayi(d: JsonDeger?, en: Long, boy: Long): Long? =
        (d as? JsonDeger.Tam)?.deger?.takeIf { it in en..boy }

    private fun zaman(d: JsonDeger?): Long? = tamSayi(d, 0, Long.MAX_VALUE)

    private fun koordinat(d: JsonDeger?): Int? = tamSayi(d, 0, Sinirlar.KOORDINAT_MAX.toLong())?.toInt()

    /** Anahtarlar `izinli` içinde (hepsi isteğe bağlı). */
    private fun yalnizca(a: Map<String, JsonDeger>, vararg izinli: String) = izinli.toSet().containsAll(a.keys)

    /** Anahtarlar tam olarak `gerekli`. */
    private fun tamAnahtar(a: Map<String, JsonDeger>, vararg gerekli: String) =
        a.size == gerekli.size && gerekli.all(a::containsKey)

    private inline fun <T : Any> liste(d: JsonDeger?, en: Int, boy: Int, oge: (JsonDeger) -> T?): List<T>? {
        val dizi = (d as? JsonDeger.Dizi)?.ogeler ?: return null
        if (dizi.size !in en..boy) return null
        val sonuc = ArrayList<T>(dizi.size)
        for (o in dizi) sonuc.add(oge(o) ?: return null)
        return sonuc
    }

    /** temel.ts `gorunmezBirimMi`. */
    private fun gorunmezMi(c: Char): Boolean {
        val b = c.code
        return (b < 0x20 && b != 0x09 && b != 0x0a && b != 0x0d) ||
            (b in 0x7f..0x9f) || b == 0xad || b == 0x061c ||
            (b in 0x200b..0x200f) || (b in 0x2028..0x202e) ||
            (b in 0x2060..0x206f) || b == 0xfeff
    }

    private fun iyiBicimliMi(s: String): Boolean {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c.isHighSurrogate()) {
                if (i + 1 >= s.length || !s[i + 1].isLowSurrogate()) return false
                i += 2
            } else if (c.isLowSurrogate()) {
                return false
            } else {
                i++
            }
        }
        return true
    }

    private fun planMetni(d: JsonDeger?, en: Int, boy: Int): String? =
        metin(d, en, boy)?.takeIf { s -> s.none(::gorunmezMi) && iyiBicimliMi(s) }

    private fun planSatiri(d: JsonDeger?, en: Int, boy: Int): String? =
        planMetni(d, en, boy)?.takeIf { s -> s.none { it == '\t' || it == '\n' || it == '\r' } }

    // -----------------------------------------------------------------------------------------
    // Giden çerçeveler
    // -----------------------------------------------------------------------------------------

    private fun m(s: String): JsonDeger = JsonDeger.Metin(s)

    private fun n(i: Long): JsonDeger = JsonDeger.Tam(i)

    private fun b(v: Boolean): JsonDeger = JsonDeger.Mantik(v)

    private fun nesne(vararg alanlar: Pair<String, JsonDeger>): JsonDeger.Nesne =
        JsonDeger.Nesne(linkedMapOf(*alanlar))

    private fun cerceve(tur: String, vararg alanlar: Pair<String, JsonDeger>): String {
        val tum = LinkedHashMap<String, JsonDeger>()
        tum["v"] = n(PROTOKOL_SURUMU.toLong())
        tum["type"] = m(tur)
        for ((k, v) in alanlar) tum[k] = v
        return Json.yaz(JsonDeger.Nesne(tum))
    }

    /** UTF-16 sınırına kırpar; çift vekili ortadan bölmez. */
    private fun kirp(s: String, sinir: Int): String {
        if (s.length <= sinir) return s
        val son = if (s[sinir - 1].isHighSurrogate()) sinir - 1 else sinir
        return s.substring(0, son)
    }

    override fun hello(deviceId: String, clientNonce: String): String =
        cerceve("hello", "device_id" to m(deviceId), "client_nonce" to m(clientNonce))

    override fun authResponse(imza: String): String = cerceve("auth_response", "signature" to m(imza))

    override fun cmdResult(cmdId: String, sonuc: CmdSonucu): String {
        val foreground: JsonDeger = sonuc.foreground
            ?.takeIf { paketMi(it.paket) }
            ?.let { nesne("baslik" to m(kirp(it.baslik, Sinirlar.ON_PLAN_BASLIK)), "paket" to m(it.paket)) }
            ?: JsonDeger.Bos
        var ok = sonuc.ok
        var payload: JsonDeger? = if (ok) sonuc.payload?.let { payloadYaz(it) } else null
        var denied = sonuc.denied
        var hata = sonuc.hata
        if (ok && sonuc.payload != null && payload == null) {
            // Görüntü kabloya sığmıyor: sahte başarı yerine eylemin alınamadığını bildir.
            ok = false
            denied = null
            hata = CihazHatasi.EKRAN_ALINAMADI
        }
        if (ok) {
            denied = null
            hata = null
        } else {
            payload = null
            if (denied != null && hata != null) hata = null
            if (denied == null && hata == null) hata = CihazHatasi.EYLEM_BASARISIZ
        }
        val alanlar = ArrayList<Pair<String, JsonDeger>>()
        alanlar.add("cmd_id" to m(cmdId))
        alanlar.add("ok" to b(ok))
        alanlar.add("foreground" to foreground)
        if (payload != null) alanlar.add("payload" to payload)
        if (denied != null) alanlar.add("denied" to m(denied.kablo))
        if (hata != null) alanlar.add("hata" to m(hata.kablo))
        return cerceve("cmd_result", *alanlar.toTypedArray())
    }

    private fun payloadYaz(p: CmdPayload): JsonDeger? = when (p) {
        is CmdPayload.Elementler -> {
            val kirpildi = p.kirpildi || p.elementler.size > Sinirlar.ELEMENT_ADET
            nesne(
                "kind" to m("elements"),
                "truncated" to b(kirpildi),
                "elements" to JsonDeger.Dizi(p.elementler.take(Sinirlar.ELEMENT_ADET).map(::elementYaz)),
            )
        }
        is CmdPayload.Goruntu -> {
            val mimeTamam = p.mime == "image/jpeg" || p.mime == "image/png"
            val b64 = p.base64
            val olcekTamam = p.olcek.isFinite() && p.olcek > 0.0 && p.olcek <= 16.0
            if (!mimeTamam || b64.length > Sinirlar.EKRAN_BASE64 || !base64Mi(b64) || !olcekTamam) {
                null
            } else {
                nesne(
                    "kind" to m("image"),
                    "mime" to m(p.mime),
                    "image_base64" to m(b64),
                    "width" to n(p.genislik.coerceIn(1, Sinirlar.KOORDINAT_MAX).toLong()),
                    "height" to n(p.yukseklik.coerceIn(1, Sinirlar.KOORDINAT_MAX).toLong()),
                    "scale" to JsonDeger.Ondalik(p.olcek),
                )
            }
        }
    }

    private fun elementYaz(e: Element): JsonDeger {
        val rol = e.rol.filter { it.isAsciiHarf() || it.isAsciiRakam() || it == '_' || it == '.' || it == '-' }
            .take(Sinirlar.ELEMENT_ROL)
            .ifEmpty { "node" }
        val alanlar = ArrayList<Pair<String, JsonDeger>>()
        alanlar.add("id" to n(e.id.coerceAtLeast(0).toLong()))
        alanlar.add("rol" to m(rol))
        alanlar.add("ad" to m(kirp(e.ad, Sinirlar.ELEMENT_METIN)))
        // Parola alanının değeri hiçbir koşulda kabloya çıkmaz.
        if (e.deger != null && !e.parola) alanlar.add("deger" to m(kirp(e.deger, Sinirlar.ELEMENT_METIN)))
        alanlar.add("x" to n(e.x.coerceIn(0, Sinirlar.KOORDINAT_MAX).toLong()))
        alanlar.add("y" to n(e.y.coerceIn(0, Sinirlar.KOORDINAT_MAX).toLong()))
        if (e.etkinDegil) alanlar.add("disabled" to b(true))
        if (e.parola) alanlar.add("password" to b(true))
        return nesne(*alanlar.toTypedArray())
    }

    override fun grantIssued(izin: IzinKaydi, kalanMs: Long): String =
        cerceve(
            "grant_issued",
            "grant_id" to m(izin.grantId),
            "token" to m(izin.token),
            "plan_id" to m(izin.planId),
            "plan_hash" to m(izin.planHash),
            "mod" to m(izin.mod.kablo),
            "uygulamalar" to JsonDeger.Dizi(
                izin.uygulamalar.map { it.paket }.filter(::paketMi).take(Sinirlar.PLAN_UYGULAMA_ADET).map(::m),
            ),
            "kalan_ms" to n(kalanMs.coerceIn(1L, MAX_GUVENLI)),
            "butce" to n(izin.kalanButce.coerceAtLeast(1).toLong()),
        )

    private const val MAX_GUVENLI: Long = 9_007_199_254_740_991L

    override fun grantRevoked(grantId: String, neden: GrantNedeni): String =
        cerceve("grant_revoked", "grant_id" to m(grantId), "neden" to m(neden.kablo))

    override fun deviceState(durum: CihazDurumu): String =
        cerceve(
            "device_state",
            "a11y" to b(durum.a11y),
            "adb_enabled" to b(durum.adbAcik),
            "kilitli" to b(durum.kilitli),
        )

    override fun appList(uygulamalar: List<UygulamaBilgisi>): String {
        val liste = uygulamalar.asSequence()
            .filter { paketMi(it.paket) }
            .take(Sinirlar.UYGULAMA_LISTESI_ADET)
            .map {
                nesne(
                    "paket" to m(it.paket),
                    "ad" to m(kirp(it.ad, Sinirlar.UYGULAMA_ADI)),
                    "durum" to m(it.durum.kablo),
                )
            }
            .toList()
        return cerceve("app_list", "uygulamalar" to JsonDeger.Dizi(liste))
    }

    override fun notifyAck(notifyId: String): String = cerceve("notify_ack", "notify_id" to m(notifyId))

    override fun hata(kod: HataKodu): String = cerceve("error", "code" to m(kod.kablo))
}
