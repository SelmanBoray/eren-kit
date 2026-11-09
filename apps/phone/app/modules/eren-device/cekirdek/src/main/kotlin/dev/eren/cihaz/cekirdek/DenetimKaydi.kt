package dev.eren.cihaz.cekirdek

/*
 * Denetim günlüğünün satır üretimi ve dosya biçimi. Satıra yalnız kimlik, kapalı liste değeri, paket
 * adı ve zaman girer; ekran metni, plan metni, yazılan metin ve jeton bu dosyanın imzalarında yoktur,
 * yani girmesi derleme düzeyinde imkansızdır.
 */

/**
 * Port hatası yutulur: denetim yazılamadı diye kapı çökmez, satır düşer (`DenetimPortu.ekle` sözleşmesi).
 * `Error` (bellek taşması gibi) bilerek yakalanmaz.
 */
val denetimKaydiKur: DenetimKaydiFabrikasi = DenetimKaydiFabrikasi { port, saat ->
    PortluDenetimKaydi(port, saat)
}

private class PortluDenetimKaydi(
    private val port: DenetimPortu,
    private val saat: SaatPortu,
) : DenetimKaydi {
    override fun komut(
        cmdId: String,
        grantId: String?,
        komut: CmdAdi?,
        denied: DeniedNeden?,
        hata: CihazHatasi?,
        paket: String?,
    ) {
        yaz { zaman ->
            listOf(
                DenetimSatiri(
                    duvarMs = zaman,
                    olay = DenetimOlayi.KOMUT,
                    grantId = grantId,
                    cmdId = cmdId,
                    komut = komut,
                    denied = denied,
                    hata = hata,
                    grantNedeni = null,
                    paket = paket,
                ),
            )
        }
    }

    override fun izinVerildi(grantId: String, paketler: List<String>, kaynak: IzinKaynagi) {
        yaz { zaman ->
            paketler.map { paket ->
                satir(zaman, DenetimOlayi.IZIN_VERILDI, grantId = grantId, paket = paket, kaynak = kaynak)
            }
        }
    }

    override fun izinGeriCekildi(grantId: String, neden: GrantNedeni) {
        yaz { zaman ->
            listOf(satir(zaman, DenetimOlayi.IZIN_GERI_CEKILDI, grantId = grantId, neden = neden))
        }
    }

    override fun baglantiAcildi() {
        yaz { zaman -> listOf(satir(zaman, DenetimOlayi.BAGLANTI_ACILDI)) }
    }

    override fun baglantiKoptu() {
        yaz { zaman -> listOf(satir(zaman, DenetimOlayi.BAGLANTI_KOPTU)) }
    }

    private fun satir(
        zaman: Long,
        olay: DenetimOlayi,
        grantId: String? = null,
        neden: GrantNedeni? = null,
        paket: String? = null,
        kaynak: IzinKaynagi? = null,
    ): DenetimSatiri = DenetimSatiri(
        duvarMs = zaman,
        olay = olay,
        grantId = grantId,
        cmdId = null,
        komut = null,
        denied = null,
        hata = null,
        grantNedeni = neden,
        paket = paket,
        kaynak = kaynak,
    )

    /** Saat, satır kurma ve port tek korumada; ilk istisnada kalan satırlar da düşer. */
    private fun yaz(uret: (Long) -> List<DenetimSatiri>) {
        try {
            for (s in uret(saat.duvarMs())) port.ekle(s)
        } catch (_: Exception) {
            // Bilerek yutulur: denetim hatası kapıyı düşürmez.
        }
    }
}

/**
 * Tek satır, sürümlü, `|` ile ayrılmış sabit alanlar. Kaynaksız satır (`kaynak == null`) on alan:
 * `v1|duvarMs|olay|grantId|cmdId|komut|denied|hata|grantNedeni|paket`;
 * kaynaklı satır on bir alan: `v2|duvarMs|olay|grantId|cmdId|komut|denied|hata|grantNedeni|paket|kaynak`.
 * Sürümü `kaynak` belirler, böylece her satırın tek biçimi vardır (`~` kaynaklı `v2` geçersizdir)
 * ve eski dosyalardaki `v1` satırları aynen okunur, aynen yeniden yazılır.
 * Boş (`null`) alan `~`; metin alanları (kimlik, paket) UTF-16 biriminden `%XXXX` ile kaçırılır
 * (`A-Za-z0-9._:-` dışı), böylece her `String` kayıpsız gidip gelir ve satır sonu, `|`, `~`
 * metinden sızamaz. Kapalı liste alanları kablo adıyla, `olay` ve `kaynak` enum adıyla yazılır.
 */
object DenetimBicimi : DenetimBicimIslemi {
    private const val SURUM_KAYNAKSIZ = "v1"
    private const val SURUM_KAYNAKLI = "v2"
    private const val ALAN_KAYNAKSIZ = 10
    private const val ALAN_KAYNAKLI = 11
    private const val BOS = "~"
    private const val HEX = "0123456789ABCDEF"

    override fun yaz(satir: DenetimSatiri): String {
        val kaynak = satir.kaynak
        val alanlar = listOf(
            if (kaynak == null) SURUM_KAYNAKSIZ else SURUM_KAYNAKLI,
            satir.duvarMs.toString(),
            satir.olay.name,
            kacir(satir.grantId),
            kacir(satir.cmdId),
            satir.komut?.kablo ?: BOS,
            satir.denied?.kablo ?: BOS,
            satir.hata?.kablo ?: BOS,
            satir.grantNedeni?.kablo ?: BOS,
            kacir(satir.paket),
        )
        return (if (kaynak == null) alanlar else alanlar + kaynak.name).joinToString("|")
    }

    override fun coz(metin: String): DenetimSatiri? {
        try {
            val alanlar = metin.split('|')
            val kaynakli = when {
                alanlar.size == ALAN_KAYNAKSIZ && alanlar[0] == SURUM_KAYNAKSIZ -> false
                alanlar.size == ALAN_KAYNAKLI && alanlar[0] == SURUM_KAYNAKLI -> true
                else -> return null
            }

            val zaman = alanlar[1].toLongOrNull() ?: return null
            if (zaman.toString() != alanlar[1]) return null

            val olay = DenetimOlayi.entries.firstOrNull { it.name == alanlar[2] } ?: return null

            val grantId = ac(alanlar[3]) ?: return null
            val cmdId = ac(alanlar[4]) ?: return null
            val paket = ac(alanlar[9]) ?: return null

            val komut = acListe(alanlar[5], CmdAdi.entries) { it.kablo } ?: return null
            val denied = acListe(alanlar[6], DeniedNeden.entries) { it.kablo } ?: return null
            val hata = acListe(alanlar[7], CihazHatasi.entries) { it.kablo } ?: return null
            val neden = acListe(alanlar[8], GrantNedeni.entries) { it.kablo } ?: return null
            // `v2`'de kaynak zorunlu: `~` ya da bilinmeyen ad bozuk (kaynaksız satır `v1` yazılır).
            val kaynak = if (kaynakli) {
                IzinKaynagi.entries.firstOrNull { it.name == alanlar[10] } ?: return null
            } else {
                null
            }

            return DenetimSatiri(
                duvarMs = zaman,
                olay = olay,
                grantId = grantId.deger,
                cmdId = cmdId.deger,
                komut = komut.deger,
                denied = denied.deger,
                hata = hata.deger,
                grantNedeni = neden.deger,
                paket = paket.deger,
                kaynak = kaynak,
            )
        } catch (_: Exception) {
            return null
        }
    }

    private fun guvenli(c: Char): Boolean =
        c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '.' || c == '_' || c == ':' || c == '-'

    private fun kacir(deger: String?): String {
        if (deger == null) return BOS
        val sb = StringBuilder(deger.length)
        for (c in deger) {
            if (guvenli(c)) {
                sb.append(c)
            } else {
                val k = c.code
                sb.append('%')
                sb.append(HEX[(k shr 12) and 0xF]).append(HEX[(k shr 8) and 0xF])
                sb.append(HEX[(k shr 4) and 0xF]).append(HEX[k and 0xF])
            }
        }
        return sb.toString()
    }

    /** `null` alanı ile bozuk alanı ayırmak için sarmalayıcı: dış `null` bozuk demektir. */
    private class Alan<T>(val deger: T?)

    private fun ac(alan: String): Alan<String>? {
        if (alan == BOS) return Alan(null)
        val sb = StringBuilder(alan.length)
        var i = 0
        while (i < alan.length) {
            val c = alan[i]
            if (c == '%') {
                if (i + 5 > alan.length) return null
                var k = 0
                for (j in i + 1..i + 4) {
                    val h = HEX.indexOf(alan[j])
                    if (h < 0) return null
                    k = (k shl 4) or h
                }
                val ch = k.toChar()
                // Tek biçim: güvenli karakter kaçırılmış gelirse satırı biz yazmamışızdır.
                if (guvenli(ch)) return null
                sb.append(ch)
                i += 5
            } else if (guvenli(c)) {
                sb.append(c)
                i++
            } else {
                return null
            }
        }
        return Alan(sb.toString())
    }

    private fun <T> acListe(alan: String, degerler: List<T>, kablo: (T) -> String): Alan<T>? {
        if (alan == BOS) return Alan(null)
        val bulunan = degerler.firstOrNull { kablo(it) == alan } ?: return null
        return Alan(bulunan)
    }
}
