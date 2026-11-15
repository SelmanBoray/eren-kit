package dev.eren.cihaz.cekirdek

/**
 * Ses tuşu kısayolunun hedef listesi: `Settings.Secure.accessibility_shortcut_target_service`
 * (Android 11+, minSdk 30). Değer ':' ile ayrılmış bileşen adları (`paket/Sinif` ya da kısa
 * `paket/.Sinif`) ve sistem özelliği adlarıdır.
 *
 * Kural: kullanıcının önceki hedefleri (TalkBack, Büyütme...) SİLİNMEZ; bu uygulamanın hedefi
 * listede yoksa sona eklenir. Birden çok hedef varken tuşlara basınca Android hangisinin açılacağını
 * sorar (AOSP `AccessibilityManagerService`). Saf mantık; ayar okuma/yazma `ErisimAnahtari`'nda.
 */
object KisayolHedefleri {

    /**
     * [ekle] sonucu. [degisti] yanlışsa hedef zaten listededir, yazmaya gerek yok.
     * [digerHedefler]: listede kalan, bu uygulamaya ait olmayan hedefler (sıraları korunur).
     */
    class Ekleme(val yeniDeger: String, val digerHedefler: List<String>, val degisti: Boolean)

    /** Bizim hedefimizi ([biz], `flattenToString` biçimi) ekler; başka hedeflere dokunmaz. */
    fun ekle(mevcut: String?, biz: String): Ekleme {
        val liste = parcalar(mevcut)
        val bizimAnahtar = anahtar(biz)
        val digerleri = liste.filter { anahtar(it) != bizimAnahtar }
        val zatenVar = digerleri.size != liste.size
        val yeni = if (zatenVar) liste else liste + biz.trim()
        return Ekleme(yeni.joinToString(":"), digerleri, degisti = !zatenVar)
    }

    /** Liste [biz]'i içeriyor mu (uzun ve kısa bileşen biçimi aynı sayılır). */
    fun iceriyor(mevcut: String?, biz: String): Boolean {
        val bizimAnahtar = anahtar(biz)
        return parcalar(mevcut).any { anahtar(it) == bizimAnahtar }
    }

    private fun parcalar(deger: String?): List<String> =
        deger?.split(':')?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()

    /**
     * `ComponentName.unflattenFromString` ile aynı eşitlik: `paket/.Sinif` → `paket/paket.Sinif`.
     * Bileşen biçiminde olmayan girdi (sistem özelliği adı) olduğu gibi karşılaştırılır.
     */
    private fun anahtar(girdi: String): String {
        val t = girdi.trim()
        val ayrac = t.indexOf('/')
        if (ayrac <= 0 || ayrac + 1 >= t.length) return t
        val paket = t.substring(0, ayrac)
        val sinif = t.substring(ayrac + 1)
        return "$paket/" + if (sinif.startsWith(".")) paket + sinif else sinif
    }
}
