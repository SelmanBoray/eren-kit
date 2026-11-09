package dev.eren.cihaz.cekirdek

/**
 * Senaryolu ekran. `anlik()` her çağrıda `anlikSenaryo`dan sıradakini verir; sıra bitince sonuncuyu
 * tekrarlar ("ikinci okumada ön plan paketi değişir" = iki öğeli senaryo). `goruntu` için aynı mantık.
 * Çağrı sırası `olaylar`da tutulur (ör. ["anlik", "goruntu", "anlik"]).
 */
class SahteEkran(
    var cihaz: CihazDurumu = CihazDurumu(a11y = true, kilitli = false, adbAcik = false),
) : EkranPortu {
    private val kilit = Any()
    private val anlikSira = ArrayList<AnlikDurum>()
    private var anlikNo = 0
    private val goruntuSira = ArrayList<GoruntuSonucu>()
    private var goruntuNo = 0
    private val gecmis = ArrayList<String>()
    private val bolgeler = ArrayList<Dikdortgen?>()

    @Volatile
    var okuma: ElementOkumasi = ElementOkumasi(emptyList(), false)

    /** `dugum(no)` yanıtları; anahtar yoksa `null`. */
    val dugumler: MutableMap<Int, DugumBaglami> = HashMap()

    @Volatile
    var odakBaglami: DugumBaglami? = null

    /** Her `anlik()` çağrısından önce çalışır; sayacı (0 tabanlı) alır, ör. durumu kurcalamak için. */
    @Volatile
    var anlikOnce: ((Int) -> Unit)? = null

    init {
        anlikSenaryo(anlikDurum("com.example.mesaj", "Mesajlar"))
        goruntuSenaryo(goruntuTamam())
    }

    /** Çağrı olayları: "durum", "anlik", "elementler", "dugum", "odak", "goruntu". */
    val olaylar: List<String> get() = synchronized(kilit) { ArrayList(gecmis) }

    val anlikSayisi: Int get() = olaylar.count { it == "anlik" }

    val goruntuSayisi: Int get() = olaylar.count { it == "goruntu" }

    /** `goruntu` çağrılarının istediği bölgeler. */
    val goruntuBolgeleri: List<Dikdortgen?> get() = synchronized(kilit) { ArrayList(bolgeler) }

    fun anlikSenaryo(vararg durumlar: AnlikDurum) {
        require(durumlar.isNotEmpty())
        synchronized(kilit) {
            anlikSira.clear()
            anlikSira.addAll(durumlar)
            anlikNo = 0
        }
    }

    fun goruntuSenaryo(vararg sonuclar: GoruntuSonucu) {
        require(sonuclar.isNotEmpty())
        synchronized(kilit) {
            goruntuSira.clear()
            goruntuSira.addAll(sonuclar)
            goruntuNo = 0
        }
    }

    override fun durum(): CihazDurumu {
        synchronized(kilit) { gecmis.add("durum") }
        return cihaz
    }

    override fun anlik(): AnlikDurum {
        val sira = synchronized(kilit) { gecmis.add("anlik"); anlikNo }
        anlikOnce?.invoke(sira)
        return synchronized(kilit) {
            val d = anlikSira[minOf(anlikNo, anlikSira.size - 1)]
            anlikNo++
            d
        }
    }

    override fun elementler(): ElementOkumasi {
        synchronized(kilit) { gecmis.add("elementler") }
        return okuma
    }

    override fun dugum(no: Int): DugumBaglami? {
        synchronized(kilit) { gecmis.add("dugum") }
        return dugumler[no]
    }

    override fun odak(): DugumBaglami? {
        synchronized(kilit) { gecmis.add("odak") }
        return odakBaglami
    }

    override fun goruntu(bolge: Dikdortgen?): GoruntuSonucu = synchronized(kilit) {
        gecmis.add("goruntu")
        bolgeler.add(bolge)
        val s = goruntuSira[minOf(goruntuNo, goruntuSira.size - 1)]
        goruntuNo++
        s
    }

    companion object {
        const val GENISLIK = 1080
        const val YUKSEKLIK = 2400

        /** Tek uygulama penceresi, üç paket alanı da aynı; temiz bir ön plan. */
        fun anlikDurum(
            paket: String?,
            baslik: String? = "Başlık",
            monotonikMs: Long = 0L,
            pencereler: List<Pencere>? = null,
        ): AnlikDurum = AnlikDurum(
            aktifKokPaketi = paket,
            sonOlayPaketi = paket,
            odakPaketi = paket,
            baslik = baslik,
            pencereler = pencereler ?: listOf(uygulamaPenceresi(paket)),
            ekranGenisligi = GENISLIK,
            ekranYuksekligi = YUKSEKLIK,
            alinmaMonotonikMs = monotonikMs,
        )

        fun uygulamaPenceresi(paket: String?, katman: Int = 1): Pencere = Pencere(
            tur = PencereTuru.UYGULAMA,
            paket = paket,
            katman = katman,
            sinir = Dikdortgen(0, 0, GENISLIK, YUKSEKLIK),
            aktif = true,
            odakli = true,
        )

        fun sistemPenceresi(tur: PencereTuru, paket: String?, katman: Int = 2): Pencere = Pencere(
            tur = tur,
            paket = paket,
            katman = katman,
            sinir = Dikdortgen(0, 0, GENISLIK, 120),
            aktif = false,
            odakli = false,
        )

        fun dugum(
            no: Int,
            paket: String? = "com.example.mesaj",
            rol: String = "button",
            ad: String = "Düğme",
            deger: String? = null,
            tiklanabilir: Boolean = true,
            duzenlenebilir: Boolean = false,
            parola: Boolean = false,
            ipucu: String? = null,
            kaynakId: String? = null,
            etkin: Boolean = true,
            sinir: Dikdortgen = Dikdortgen(100, 100 + no * 10, 300, 160 + no * 10),
        ): Dugum = Dugum(
            no = no,
            paket = paket,
            rol = rol,
            ad = ad,
            deger = deger,
            ipucu = ipucu,
            kaynakId = kaynakId,
            sinir = sinir,
            tiklanabilir = tiklanabilir,
            duzenlenebilir = duzenlenebilir,
            etkin = etkin,
            parola = parola,
            odakli = false,
        )

        fun baglam(d: Dugum, atalar: List<Dugum> = emptyList(), torunlar: List<Dugum> = emptyList()) =
            DugumBaglami(d, atalar, torunlar)

        fun goruntuTamam(siyahOrani: Double = 0.0, base64: String = "QUJD"): GoruntuSonucu.Tamam =
            GoruntuSonucu.Tamam("image/jpeg", base64, 720, 1600, 1.5, siyahOrani)
    }
}
