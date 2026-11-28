package dev.eren.ajanda.ekran.sahne.tema

import androidx.compose.ui.unit.dp
import dev.eren.ajanda.ekran.sahne.bilesen.YUVARLAK_DUGME_GORUNUR
import org.junit.Assert.assertEquals
import org.junit.Test

/** Ölçülerin tek kaynağı: yuvarlak düğmenin görünür boyu temada da düğmede de aynı (46 dp), dokunma alanı 48 dp. */
class SahneOlcuTest {
    @Test
    fun yuvarlakDugmeOlcusuTekKaynaktan() {
        val o = SahneOlculer()
        assertEquals(46.dp, o.yuvarlakDugme)
        assertEquals(o.yuvarlakDugme, YUVARLAK_DUGME_GORUNUR)
        assertEquals(48.dp, o.dokunma)
    }
}
