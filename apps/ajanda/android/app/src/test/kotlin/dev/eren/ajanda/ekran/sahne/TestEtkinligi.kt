package dev.eren.ajanda.ekran.sahne

import android.content.ComponentName
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.rules.ActivityScenarioRule
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import org.robolectric.Shadows.shadowOf

/**
 * Compose test kuralı, boş bir [ComponentActivity] içinde çizer. O etkinlik genelde `ui-test-manifest`
 * bağımlılığıyla debug APK'ya eklenir; biz APK'ya dışa açık bir etkinlik sokmamak için onu yalnız test
 * sırasında Robolectric'in paket yöneticisine kaydediyoruz.
 */
class TestEtkinligi {
    val compose: AndroidComposeTestRule<ActivityScenarioRule<ComponentActivity>, ComponentActivity> =
        createAndroidComposeRule<ComponentActivity>()

    val zincir: TestRule = RuleChain.outerRule(object : TestWatcher() {
        override fun starting(description: Description) {
            val uygulama = ApplicationProvider.getApplicationContext<android.app.Application>()
            shadowOf(uygulama.packageManager).addActivityIfNotPresent(ComponentName(uygulama, ComponentActivity::class.java))
        }
    }).around(compose)
}
