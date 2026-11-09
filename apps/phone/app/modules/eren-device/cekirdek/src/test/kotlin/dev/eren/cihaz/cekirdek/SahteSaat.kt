package dev.eren.cihaz.cekirdek

/** İlerletilebilir saat. Monotonik ve duvar saati birlikte ilerler; `duvarSapmasi` yalnız duvarı oynatır. */
class SahteSaat(
    monotonikBas: Long = 1_000_000L,
    duvarBas: Long = 1_790_000_000_000L,
) : SaatPortu {
    private val kilit = Any()
    private var mono = monotonikBas
    private var duvar = duvarBas
    private val uyumalar = ArrayList<Long>()

    /** `uyu` çağrılarının süreleri, sırayla. */
    val uyuyanlar: List<Long> get() = synchronized(kilit) { ArrayList(uyumalar) }

    override fun monotonikMs(): Long = synchronized(kilit) { mono }

    override fun duvarMs(): Long = synchronized(kilit) { duvar }

    override fun uyu(ms: Long) {
        synchronized(kilit) { uyumalar.add(ms) }
        ilerlet(ms)
    }

    /** İkisini birden ilerletir. */
    fun ilerlet(ms: Long) {
        synchronized(kilit) {
            mono += ms
            duvar += ms
        }
    }

    /** Yalnız duvar saatini oynatır (kullanıcı saati değiştirdi / saat farkı saldırısı). */
    fun duvarSapmasi(ms: Long) {
        synchronized(kilit) { duvar += ms }
    }

    fun monotonikKur(ms: Long) {
        synchronized(kilit) { mono = ms }
    }

    fun duvarKur(ms: Long) {
        synchronized(kilit) { duvar = ms }
    }
}
