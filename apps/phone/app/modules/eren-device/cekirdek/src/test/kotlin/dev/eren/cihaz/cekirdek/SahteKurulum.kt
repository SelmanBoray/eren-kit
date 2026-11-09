package dev.eren.cihaz.cekirdek

/** Bütün sahteleri bir arada tutar; testler bunu fabrikalara dağıtır. */
class SahteKurulum(tohum: Long = 1L) {
    val saat = SahteSaat()
    val rastgele = SahteRastgele(tohum)
    val ekran = SahteEkran()
    val eylem = SahteEylem()
    val denetim = SahteDenetim()
    val anahtar = SahteAnahtar()
    val pc = SahtePc()
}
