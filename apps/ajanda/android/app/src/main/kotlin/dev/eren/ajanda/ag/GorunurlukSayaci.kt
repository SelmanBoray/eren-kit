package dev.eren.ajanda.ag

/**
 * Ön plan bağlantısının TEK kuralı: uygulamanın herhangi bir etkinliği başlamışken (kullanıcıya görünür:
 * `onStart` .. `onStop`) bağlantı istenir, hiçbiri görünmezken bırakılır. Bırakmanın kısa beklemesi ve
 * kuyruk boşaltması [BaglantiDenetcisi.birak]'tadır ([AgAyarlari.birakmaGecikmesiMs]).
 *
 * Neden sayaç: Android ekrandan ekrana geçişte önce yeni etkinliği başlatır, sonra eskisini durdurur
 * (A.onPause, B.onStart, A.onStop); sayaç sıfıra inmez, bağlantı geçişte düşmez (ana ekran -> kayıt
 * ekranı -> geri). Döndürme ve tema değişiminde aynı etkinlik durup yeniden başlar: sayaç bir an sıfıra
 * iner, yeniden başlama bırakma beklemesi içinde olduğundan bağlantı kapanmaz. Ana ekran tuşu ya da başka
 * uygulamaya geçiş: son görünen etkinlik durur, sayaç sıfır, bekleme sonrası bağlantı kapanır (eşleştirme
 * ekranı dahil: orada bırakılmayan bağlantı arka planda süresiz tutuluyordu).
 *
 * Etkinlikler [BaglantiYoneticisi]'ni kendileri çağırmaz; sayaç uygulamanın yaşam döngüsü geri
 * çağrısından beslenir ([BaglantiYoneticisi.izle]). Yalnız ana iş parçacığından çağrılır; Android'e bağlı
 * değildir (JVM testinde sürülür).
 */
class GorunurlukSayaci(
    private val gorundu: () -> Unit,
    private val gizlendi: () -> Unit,
) {
    // Yazan ana iş parçacığı; `gorunur`'u arka plan işi de okur.
    @Volatile
    private var sayi = 0

    val gorunur: Boolean get() = sayi > 0

    /** Bir etkinlik başladı (`onActivityStarted`). */
    fun basladi() {
        sayi++
        if (sayi == 1) gorundu()
    }

    /** Bir etkinlik durdu (`onActivityStopped`). Fazla çağrı sayacı eksiye düşürmez. */
    fun durdu() {
        if (sayi == 0) return
        sayi--
        if (sayi == 0) gizlendi()
    }
}
