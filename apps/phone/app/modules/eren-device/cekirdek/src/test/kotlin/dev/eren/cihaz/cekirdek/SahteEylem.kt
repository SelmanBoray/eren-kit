package dev.eren.cihaz.cekirdek

/** `SahteEylem`'in kaydettiği çağrılar: port yöntemi başına bir tür. */
sealed interface EylemCagrisi {
    data class DugumeDokun(val no: Int, val tiklama: Int, val uzun: Boolean) : EylemCagrisi
    data class NoktayaDokun(val nokta: Nokta, val tiklama: Int, val uzun: Boolean) : EylemCagrisi
    data class MetinYaz(val no: Int, val metin: String) : EylemCagrisi
    data class TusBas(val tus: Tus, val tekrar: Int) : EylemCagrisi
    data class Kaydir(val yon: KaydirmaYonu, val miktar: Int?, val nokta: Nokta?) : EylemCagrisi
    data class Surukle(val bas: Nokta, val son: Nokta) : EylemCagrisi
    data class UygulamaAc(val paket: String) : EylemCagrisi
}

/** Her eylem çağrısını sırasıyla kaydeder; sonucu ve istisnayı testten yönetilir. */
class SahteEylem : EylemPortu {
    private val kilit = Any()
    private val kayit = ArrayList<EylemCagrisi>()

    /** Kayıttan sonra, sonuç dönmeden çalışır (ör. eylem sırasında ön planı değiştirmek için). */
    @Volatile
    var sonra: ((EylemCagrisi) -> Unit)? = null

    /** Çağrıya göre sonuç; varsayılan `Gonderildi`. */
    @Volatile
    var sonuc: (EylemCagrisi) -> EylemSonucu = { EylemSonucu.Gonderildi }

    /** `null` dönmezse atılır (çağrı yine kaydedilmiştir). */
    @Volatile
    var istisna: (EylemCagrisi) -> Throwable? = { null }

    val cagrilar: List<EylemCagrisi> get() = synchronized(kilit) { ArrayList(kayit) }

    val bos: Boolean get() = synchronized(kilit) { kayit.isEmpty() }

    fun temizle() {
        synchronized(kilit) { kayit.clear() }
    }

    private fun isle(c: EylemCagrisi): EylemSonucu {
        synchronized(kilit) { kayit.add(c) }
        sonra?.invoke(c)
        istisna(c)?.let { throw it }
        return sonuc(c)
    }

    override fun dugumeDokun(no: Int, tiklama: Int, uzun: Boolean): EylemSonucu =
        isle(EylemCagrisi.DugumeDokun(no, tiklama, uzun))

    override fun noktayaDokun(nokta: Nokta, tiklama: Int, uzun: Boolean): EylemSonucu =
        isle(EylemCagrisi.NoktayaDokun(nokta, tiklama, uzun))

    override fun metinYaz(no: Int, metin: String): EylemSonucu = isle(EylemCagrisi.MetinYaz(no, metin))

    override fun tus(tus: Tus, tekrar: Int): EylemSonucu = isle(EylemCagrisi.TusBas(tus, tekrar))

    override fun kaydir(yon: KaydirmaYonu, miktar: Int?, nokta: Nokta?): EylemSonucu =
        isle(EylemCagrisi.Kaydir(yon, miktar, nokta))

    override fun surukle(bas: Nokta, son: Nokta): EylemSonucu = isle(EylemCagrisi.Surukle(bas, son))

    override fun uygulamaAc(paket: String): EylemSonucu = isle(EylemCagrisi.UygulamaAc(paket))
}
