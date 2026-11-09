package dev.eren.cihaz.cekirdek

/** Satırları ve yazılan kimlik listesini bellekte tutar. */
class SahteDenetim(baslangicKimlikleri: List<String> = emptyList()) : DenetimPortu {
    private val kilit = Any()
    private val liste = ArrayList<DenetimSatiri>()
    private var kimlikler: List<String> = baslangicKimlikleri.toList()
    private val yazimlar = ArrayList<List<String>>()

    val satirlar: List<DenetimSatiri> get() = synchronized(kilit) { ArrayList(liste) }

    /** `izinKimlikleriniYaz` çağrılarının her biri, sırayla. */
    val kimlikYazimlari: List<List<String>> get() = synchronized(kilit) { ArrayList(yazimlar) }

    override fun ekle(satir: DenetimSatiri) {
        synchronized(kilit) { liste.add(satir) }
    }

    override fun izinKimlikleri(): List<String> = synchronized(kilit) { kimlikler.toList() }

    override fun izinKimlikleriniYaz(kimlikler: List<String>) {
        synchronized(kilit) {
            this.kimlikler = kimlikler.toList()
            yazimlar.add(kimlikler.toList())
        }
    }

    fun olaylar(olay: DenetimOlayi): List<DenetimSatiri> = satirlar.filter { it.olay == olay }
}
