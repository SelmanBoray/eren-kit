package dev.eren.ajanda.ekran.sahne.veri

/**
 * Bir kaydın durumunu değiştiren işlemler. Bugün, Takvim ve Tarihsizler depoları aynı yüzü verir; ekranın hareket
 * sürücüsü ([dev.eren.ajanda.ekran.sahne.ekranlar.BugunHareketleri]) hareketi oynatır, sonra bunları çağırır.
 *
 * [bitince] ana iş parçacığında ve yeni model yazıldıktan sonra çağrılır: kaydın kilidi o zaman açılır, levha
 * eski hâline bir an dönmez.
 */
interface KayitIslemleri {
    /** Tamamlar ([tamam]) ya da yeniden açar; tekrarın örneğinde yalnız o gün ([BugunKaydi.ornekTarihi]). */
    fun tamamla(k: BugunKaydi, tamam: Boolean = true, bitince: () -> Unit = {})

    /** Taslağı onaylar (karakalemden boyamaya). */
    fun onayla(id: String, bitince: () -> Unit = {})

    fun hepsiniOnayla(idler: List<String>, bitince: () -> Unit = {})

    /** Öneriden vazgeçer: taslak silinir, tostla geri yüklenebilir. */
    fun vazgec(id: String, bitince: () -> Unit = {})

    /** Bir kez oynayan imza (SAHNE.md §5.15) bu gösterimde oynasın mı. Canlı çizimi olmayan ekranda hep `false`. */
    fun imzaOynasin(anahtar: String): Boolean
}
