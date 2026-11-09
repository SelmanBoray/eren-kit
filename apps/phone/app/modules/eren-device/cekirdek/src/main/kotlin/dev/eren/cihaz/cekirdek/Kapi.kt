package dev.eren.cihaz.cekirdek

/**
 * SystemUI'nin `TYPE_WINDOW_STATE_CHANGED` olayı (heads-up açılıp kapanması, bildirim perdesinin
 * toplanması, Dynamic Island) ön plan uygulamasının değiştiğini söylemez: SystemUI görev sahibi değildir.
 * Gerçekten öne geldiğinde (perde açık, SystemUI diyaloğu) aktif kök ve odak da SystemUI olur; o zaman
 * zincir `DEGISMEZ_RET` verir. Görünen SystemUI penceresini pencere denetimleri, görüntü sırasındaki
 * olayı kural 12 (`onPlanDegisti`, burada gevşetilmez) ayrıca yakalar. Gerileme: 0.4.3, HyperOS; PC
 * bildiriminin heads-up'ı kapanınca son olay SystemUI'de kaldı, izinli ön planda her okuma reddedildi.
 */
internal const val SISTEM_ARAYUZU_PAKETI = "com.android.systemui"

/**
 * Son olay, aktif kök ve odağın söylediği `paket` ile uyuşuyor mu: aynı paket ya da SystemUI olayı.
 * `null` uyuşmaz (kapı için; `KomutIsleyici` tabanı `null`'ı ayrıca kabul eder).
 */
internal fun sonOlayOnPlanla(sonOlay: String?, paket: String): Boolean =
    sonOlay == paket || sonOlay == SISTEM_ARAYUZU_PAKETI

/**
 * Telefon kapısının saf kararı (TASARIM.md "Kapı kural sırası"; ilk takılan döner). Girdinin hepsi
 * telefonun kendi okuduğu durum ve bellekteki izindir; PC tümüyle kandırılmış olsa da izin, ön plan
 * ve mod tutmuyorsa eylem burada durur. Belirsiz her durumda ret: kaynaklar uyuşmuyor, pencere türü
 * bilinmiyor, düğüm istenen düğüm değil.
 */
object Kapi : KapiIslemi {
    private val PAKET_BICIMI = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")

    /** `Izinler.bul`'un verebileceği nedenler; dışındaki bir neden hatalı bulgudur, `IZIN_YOK` sayılır. */
    private val IZIN_NEDENLERI: Set<DeniedNeden> = setOf(
        DeniedNeden.IZIN_YOK,
        DeniedNeden.IZIN_GERI_CEKILDI,
        DeniedNeden.JETON_YANLIS,
        DeniedNeden.IZIN_SURESI_BITTI,
    )

    private val CUBUKLAR: Set<PencereTuru> = setOf(PencereTuru.DURUM_CUBUGU, PencereTuru.GEZINTI_CUBUGU)

    /** Paketi ne olursa olsun görünmesi ya da dokunulması reddedilen türler. */
    private val YASAK_TURLER: Set<PencereTuru> = setOf(
        PencereTuru.PERDE,
        PencereTuru.HEADS_UP,
        PencereTuru.KLAVYE,
        PencereTuru.BALON,
        PencereTuru.PIP,
        PencereTuru.BILINMIYOR,
    )

    override fun izinDenetimi(
        cmd: Cmd,
        baskaKomutCalisiyor: Boolean,
        pcSimdiMs: Long?,
        izin: IzinBulgusu,
    ): Karar {
        if (baskaKomutCalisiyor) return ret(DeniedNeden.MESGUL)
        if (pcSimdiMs == null || pcSimdiMs > cmd.deadlineMs) return ret(DeniedNeden.DEADLINE_GECTI)
        return when (izin) {
            is IzinBulgusu.Gecersiz ->
                ret(if (izin.neden in IZIN_NEDENLERI) izin.neden else DeniedNeden.IZIN_YOK)
            // `Izinler.bul` zaten denetledi; bulgunun bu komuta ait olduğunu kapı yine kendisi görür.
            is IzinBulgusu.Gecerli -> when {
                izin.izin.grantId != cmd.grantId -> ret(DeniedNeden.IZIN_YOK)
                !sabitZamanliEsit(izin.izin.token, cmd.token) -> ret(DeniedNeden.JETON_YANLIS)
                else -> Karar.Izinli
            }
        }
    }

    override fun durumDenetimi(durum: CihazDurumu): Karar = when {
        !durum.a11y -> ret(DeniedNeden.ERISILEBILIRLIK_KAPALI)
        durum.kilitli -> ret(DeniedNeden.KILIT_EKRANI)
        else -> Karar.Izinli
    }

    override fun ekranDenetimi(girdi: EkranDenetimGirdisi): Karar = guvenli {
        cerceveYedegi(girdi.cmd.arg)
            ?: (if (girdi.izin.grantId != girdi.cmd.grantId) DeniedNeden.IZIN_YOK else null)
            ?: onPlan(girdi)
            ?: mod(girdi)
            ?: butce(girdi)
    }

    override fun goruntuDenetimi(
        girdi: EkranDenetimGirdisi,
        sonraki: AnlikDurum,
        goruntu: GoruntuSonucu,
    ): Karar = guvenli {
        if (onPlanDegisti(girdi.anlik, sonraki)) {
            DeniedNeden.ON_PLAN_IZIN_DISI
        } else {
            // Ön plan aynı; sonradan pencere belirdiyse ya da liste değiştiyse kural 8'in kendi nedeni.
            onPlan(girdi.copy(anlik = sonraki)) ?: korumaNedeni(goruntu)
        }
    }

    private fun korumaNedeni(goruntu: GoruntuSonucu): DeniedNeden? = when (goruntu) {
        // NaN da korumalı sayılır.
        is GoruntuSonucu.Tamam ->
            if (goruntu.siyahOrani < CekirdekSinirlari.SIYAH_ESIGI) null else DeniedNeden.EKRAN_KORUMALI
        GoruntuSonucu.Korumali -> DeniedNeden.EKRAN_KORUMALI
        // Sözleşmeye göre gelmez; gelirse verilecek resim yoktur.
        is GoruntuSonucu.Basarisiz -> DeniedNeden.EKRAN_KORUMALI
    }

    // -----------------------------------------------------------------------------------------
    // Kural 0 yedeği: `Sema` geçirmiş olmalı; geçirmediyse yine ilk kural olarak reddedilir.
    // -----------------------------------------------------------------------------------------

    private fun cerceveYedegi(arg: CmdArg): DeniedNeden? = when (arg) {
        is CmdArg.Click ->
            if ((arg.element == null) == (arg.nokta == null)) DeniedNeden.GECERSIZ_ARG else null
        is CmdArg.OpenApp -> if (paketBicimi(arg.paket)) null else DeniedNeden.URL_INTENT_YASAK
        else -> null
    }

    // -----------------------------------------------------------------------------------------
    // Kural 8: ön plan
    // -----------------------------------------------------------------------------------------

    private fun onPlan(g: EkranDenetimGirdisi): DeniedNeden? {
        val arg = g.cmd.arg
        // Şef kararı: açma ekranla etkileşmez, izinli uygulamayı öne getirir; ön plan şartı ana ekrandan
        // ya da onay ekranından ilk açılışı imkânsız kılardı. Zincir yalnız hedefe uygulanır.
        if (arg is CmdArg.OpenApp) return zincir(arg.paket, g)
        val paket = tutarliOnPlan(g.anlik) ?: return DeniedNeden.ON_PLAN_IZIN_DISI
        zincir(paket, g)?.let { return it }
        return when (arg) {
            is CmdArg.OpenApp -> null
            CmdArg.Screenshot, is CmdArg.Zoom -> gorunenPencereler(g)
            is CmdArg.Click -> if (arg.nokta != null) noktadakiPencere(arg.nokta, g) else hedefDugum(g, arg.element)
            // Klavye ya da başka pencere üstünde kaydırma/sürükleme metin kilidini aşan yazım olurdu.
            is CmdArg.Drag ->
                noktadakiPencere(Nokta(arg.x0, arg.y0), g) ?: noktadakiPencere(Nokta(arg.x1, arg.y1), g)
            is CmdArg.Scroll ->
                noktadakiPencere(arg.nokta ?: Nokta(g.anlik.ekranGenisligi / 2, g.anlik.ekranYuksekligi / 2), g)
            is CmdArg.TypeText -> hedefDugum(g, null)
            CmdArg.Foreground, is CmdArg.Elements, is CmdArg.Key, is CmdArg.Wait -> null
        }
    }

    /**
     * Aktif kök, son olay ve odak aynı (paket biçimli) paketi söylüyorsa o paket; yoksa null. Son olay
     * SystemUI ise (`sonOlayOnPlanla`) yalnız aktif kök ve odak yeter.
     */
    private fun tutarliOnPlan(a: AnlikDurum): String? {
        val p = a.aktifKokPaketi ?: return null
        return if (paketBicimi(p) && sonOlayOnPlanla(a.sonOlayPaketi, p) && a.odakPaketi == p) p else null
    }

    private fun zincir(paket: String, g: EkranDenetimGirdisi): DeniedNeden? =
        when (g.listeler.durum(paket)) {
            UygulamaDurumu.DEGISMEZ -> DeniedNeden.DEGISMEZ_RET
            UygulamaDurumu.HASSAS -> DeniedNeden.HASSAS_UYGULAMA
            UygulamaDurumu.YENI -> DeniedNeden.YENI_UYGULAMA
            UygulamaDurumu.ACIK ->
                if (g.izin.uygulamalar.any { it.paket == paket }) null else DeniedNeden.ON_PLAN_IZIN_DISI
        }

    private fun izinliPaket(paket: String?, g: EkranDenetimGirdisi): Boolean =
        paket != null &&
            g.izin.uygulamalar.any { it.paket == paket } &&
            g.listeler.durum(paket) == UygulamaDurumu.ACIK

    /** Çubuklar yalnız görüntüde serbesttir; dokunmada her pencere izinli pakette olmalı. */
    private fun izinliPencere(p: Pencere, g: EkranDenetimGirdisi, cubukSerbest: Boolean): Boolean = when {
        p.tur in CUBUKLAR -> cubukSerbest
        p.tur in YASAK_TURLER -> false
        else -> izinliPaket(p.paket, g)
    }

    /** Pencere listesi boşsa görüntüde ne olduğu bilinmez: ret. */
    private fun gorunenPencereler(g: EkranDenetimGirdisi): DeniedNeden? {
        val pencereler = g.anlik.pencereler
        val hepsiIzinli = pencereler.all { izinliPencere(it, g, cubukSerbest = true) }
        val icerikVar = pencereler.any { it.tur !in CUBUKLAR }
        return if (hepsiIzinli && icerikVar) null else DeniedNeden.IZIN_DISI_PENCERE
    }

    /** Noktadaki en üst pencere; nokta boşta ya da en üst katmanda birden çok pencere varsa ret. */
    private fun noktadakiPencere(n: Nokta, g: EkranDenetimGirdisi): DeniedNeden? {
        val icerenler = g.anlik.pencereler.filter {
            n.x >= it.sinir.sol && n.x < it.sinir.sag && n.y >= it.sinir.ust && n.y < it.sinir.alt
        }
        val ust = icerenler.maxByOrNull { it.katman } ?: return DeniedNeden.ON_PLAN_IZIN_DISI
        if (icerenler.count { it.katman == ust.katman } > 1) return DeniedNeden.ON_PLAN_IZIN_DISI
        return if (izinliPencere(ust, g, cubukSerbest = false)) null else DeniedNeden.ON_PLAN_IZIN_DISI
    }

    /** `beklenenNo` dolu ise tazelenen düğüm o numarada olmalı; başka düğüm bayat kimliktir. */
    private fun hedefDugum(g: EkranDenetimGirdisi, beklenenNo: Int?): DeniedNeden? {
        val h = g.hedef ?: return DeniedNeden.ON_PLAN_IZIN_DISI
        if (beklenenNo != null && h.dugum.no != beklenenNo) return DeniedNeden.ON_PLAN_IZIN_DISI
        return if (izinliPaket(h.dugum.paket, g)) null else DeniedNeden.ON_PLAN_IZIN_DISI
    }

    // -----------------------------------------------------------------------------------------
    // Kural 9: mod
    // -----------------------------------------------------------------------------------------

    private fun mod(g: EkranDenetimGirdisi): DeniedNeden? = when (g.izin.mod) {
        IzinModu.OKU -> okuModu(g)
        IzinModu.YAZ -> yazModu(g)
    }

    private fun okuModu(g: EkranDenetimGirdisi): DeniedNeden? = when (val arg = g.cmd.arg) {
        is CmdArg.TypeText, is CmdArg.Key -> DeniedNeden.YALNIZ_OKU_YAZMA
        is CmdArg.Drag -> DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA
        is CmdArg.Click -> when {
            arg.nokta != null || arg.tiklama != 1 || arg.uzunBasma -> DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA
            else -> {
                val h = g.hedef
                when {
                    h == null -> DeniedNeden.ON_PLAN_IZIN_DISI
                    Etiket.etiketli(h) -> DeniedNeden.YALNIZ_OKU_ETIKET
                    else -> null
                }
            }
        }
        is CmdArg.Scroll ->
            if (arg.nokta != null || arg.yon == KaydirmaYonu.LEFT || arg.yon == KaydirmaYonu.RIGHT) {
                DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA
            } else {
                null
            }
        CmdArg.Foreground, is CmdArg.Elements, CmdArg.Screenshot, is CmdArg.Zoom, is CmdArg.Wait,
        is CmdArg.OpenApp -> null
    }

    private fun yazModu(g: EkranDenetimGirdisi): DeniedNeden? {
        val arg = g.cmd.arg as? CmdArg.TypeText ?: return null
        val h = g.hedef ?: return DeniedNeden.ON_PLAN_IZIN_DISI
        if (h.dugum.parola || Etiket.parolaAlani(h.dugum)) return DeniedNeden.PAROLA_ALANI
        if (g.izin.serbestMetin) return null
        // Birebir: UTF-16 birim eşitliği, normalizasyon yok; kullanılmış madde bir daha geçmez.
        val maddeVar = g.izin.izinliMetin.indices.any {
            it !in g.kullanilanMaddeler && g.izin.izinliMetin[it] == arg.metin
        }
        return if (maddeVar) null else DeniedNeden.METIN_KILIDI
    }

    // -----------------------------------------------------------------------------------------
    // Kural 10: bütçe
    // -----------------------------------------------------------------------------------------

    private fun butce(g: EkranDenetimGirdisi): DeniedNeden? =
        if (g.cmd.arg.ad in CekirdekSinirlari.EYLEM_KOMUTLARI && g.izin.kalanButce < 1) {
            DeniedNeden.BUTCE_DOLDU
        } else {
            null
        }

    // -----------------------------------------------------------------------------------------
    // Kural 12 ve yardımcılar
    // -----------------------------------------------------------------------------------------

    /** Üç paket kaynağından biri değiştiyse; geriye giden alınma anı da "sonraki" değildir. */
    private fun onPlanDegisti(once: AnlikDurum, sonra: AnlikDurum): Boolean =
        once.aktifKokPaketi != sonra.aktifKokPaketi ||
            once.sonOlayPaketi != sonra.sonOlayPaketi ||
            once.odakPaketi != sonra.odakPaketi ||
            sonra.alinmaMonotonikMs < once.alinmaMonotonikMs

    private fun paketBicimi(p: String): Boolean = p.length <= Sinirlar.PAKET_ADI && PAKET_BICIMI.matches(p)

    /** Uzunluk farkında da bütün birimleri gezer: süre jetonun ne kadarının tuttuğunu söylemez. */
    private fun sabitZamanliEsit(a: String, b: String): Boolean {
        var fark = a.length xor b.length
        for (i in 0 until maxOf(a.length, b.length)) {
            val ca = if (i < a.length) a[i].code else 0
            val cb = if (i < b.length) b[i].code else 0
            fark = fark or (ca xor cb)
        }
        return fark == 0
    }

    private fun ret(neden: DeniedNeden): Karar = Karar.Reddedildi(neden)

    /** `Listeler`/`Etiket` istisnası dışarı sızmaz, ret olur. */
    private inline fun guvenli(blok: () -> DeniedNeden?): Karar =
        try {
            blok()?.let { Karar.Reddedildi(it) } ?: Karar.Izinli
        } catch (e: Exception) {
            Karar.Reddedildi(DeniedNeden.ON_PLAN_IZIN_DISI)
        }
}
