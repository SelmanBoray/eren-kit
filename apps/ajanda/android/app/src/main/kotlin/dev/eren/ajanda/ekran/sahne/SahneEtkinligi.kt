package dev.eren.ajanda.ekran.sahne

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.remember
import dev.eren.ajanda.ekran.sahne.tema.SahneTema
import java.time.LocalDate

/**
 * Sahne arayüzünün etkinliği (Jetpack Compose). Eski ekranlar (`ekran/AnaEkran` ...) yeni ekranlar hazır
 * olana kadar başlatıcı girişi olarak kalır; bu etkinlik yalnız debug derlemede ikinci bir başlatıcı
 * girişiyle ("Ajanda Sahne", `src/debug/AndroidManifest.xml`) açılır.
 *
 * Kenardan kenara çizer (Android 15+ zorunlu, öncesinde de aynı); sistem çubuklarının payını ekranlar
 * `WindowInsets` ile kendileri bırakır. Ön plan bağlantısı her etkinlik gibi bunun yaşam döngüsünü de
 * kendiliğinden sayar (`ag/GorunurlukSayaci.kt`); burada bağlantı açılıp kapatılmaz.
 */
class SahneEtkinligi : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContent {
            // Gün değişimini izlemek gerçek Bugün ekranının işi (sonraki dilim); iskelet açılış gününü kullanır.
            val bugun = remember { LocalDate.now() }
            SahneTema {
                SahneKok(bugun = bugun)
            }
        }
    }
}
