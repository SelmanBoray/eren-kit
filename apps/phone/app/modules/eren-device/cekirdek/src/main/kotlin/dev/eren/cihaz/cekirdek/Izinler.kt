package dev.eren.cihaz.cekirdek

import java.util.Base64

private const val MEZAR_TASI_SINIRI = 10_000
private const val KIMLIK_BAYT = 16
private const val KIMLIK_DENEME = 8
private val BASE64_URL: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()

/** Bellekteki bir izin; jeton yalnız burada durur. Erişimi `IzinlerGercek.kilit` korur. */
private class Kayit(val sabit: IzinKaydi) {
    var kalanButce: Int = sabit.kalanButce
    val kullanilan: MutableSet<Int> = linkedSetOf()

    fun anlik(): IzinKaydi = sabit.copy(kalanButce = kalanButce)
}

private class IzinlerGercek(
    private val saat: SaatPortu,
    private val rastgele: RastgelePortu,
    private val denetimPortu: DenetimPortu,
    private val denetim: DenetimKaydi,
) : Izinler {
    private val kilit = Any()
    private val aktif = LinkedHashMap<String, Kayit>()

    /** Süresi dolduğu bildirilmiş kimlikler: `izin_suresi_bitti` ayrımı için. */
    private val dolmus = LinkedHashSet<String>()

    /** Geri çekilen ve eski süreçten kalan kimlikler: `izin_geri_cekildi` ayrımı için. */
    private val mezarTasi = LinkedHashSet<String>()
    private val eski: List<String> = denetimPortu.izinKimlikleri().distinct()

    init {
        mezarTasi.addAll(eski)
    }

    private fun bilinen(id: String): Boolean = id in aktif || id in dolmus || id in mezarTasi

    private fun rastgeleMetin(bayt: Int): String? {
        val ham = rastgele.baytlar(bayt)
        if (ham.size != bayt) return null
        return BASE64_URL.encodeToString(ham)
    }

    private fun mezarEkle(id: String) {
        mezarTasi.add(id)
        while (mezarTasi.size > MEZAR_TASI_SINIRI) {
            val ilk = mezarTasi.iterator()
            ilk.next()
            ilk.remove()
        }
    }

    private fun diskeYaz() {
        denetimPortu.izinKimlikleriniYaz(aktif.keys.toList())
    }

    private fun sureBitti(k: Kayit, simdi: Long): Boolean = simdi >= k.sabit.bitisMonotonikMs

    /** Kural 3-5; başarıda kaydı, yoksa nedeni döndürür. Jeton `null` ise karşılaştırma yapılmaz. */
    private fun denetle(grantId: String, token: String?): Pair<Kayit?, DeniedNeden?> {
        val k = aktif[grantId]
        if (k == null) {
            val neden = when {
                grantId in mezarTasi -> DeniedNeden.IZIN_GERI_CEKILDI
                grantId in dolmus -> DeniedNeden.IZIN_SURESI_BITTI
                else -> DeniedNeden.IZIN_YOK
            }
            return null to neden
        }
        if (token != null && !sabitZamanliEsit(k.sabit.token, token)) return null to DeniedNeden.JETON_YANLIS
        if (sureBitti(k, saat.monotonikMs())) return null to DeniedNeden.IZIN_SURESI_BITTI
        return k to null
    }

    override fun ekle(onay: OnayliIzin): IzinKaydi? {
        if (onay.sureMs !in 1..CekirdekSinirlari.AZAMI_SURE_MS) return null
        if (onay.butce !in 1..CekirdekSinirlari.AZAMI_BUTCE) return null
        if (onay.uygulamalar.isEmpty()) return null
        if (onay.mod == IzinModu.YAZ && onay.uygulamalar.size != 1) return null
        val jeton = rastgeleMetin(CekirdekSinirlari.JETON_BAYT) ?: return null
        synchronized(kilit) {
            var grantId: String? = null
            for (deneme in 0 until KIMLIK_DENEME) {
                val aday = "g" + (rastgeleMetin(KIMLIK_BAYT) ?: return null)
                if (!bilinen(aday)) {
                    grantId = aday
                    break
                }
            }
            if (grantId == null) return null
            val kayit = IzinKaydi(
                grantId = grantId,
                planId = onay.planId,
                planHash = onay.planHash,
                token = jeton,
                mod = onay.mod,
                uygulamalar = onay.uygulamalar.toList(),
                izinliMetin = onay.izinliMetin.toList(),
                serbestMetin = onay.serbestMetin,
                bitisMonotonikMs = saat.monotonikMs() + onay.sureMs,
                kalanButce = onay.butce,
                kaynak = onay.kaynak,
            )
            val k = Kayit(kayit)
            aktif[grantId] = k
            denetim.izinVerildi(grantId, kayit.uygulamalar.map { it.paket }, kayit.kaynak)
            diskeYaz()
            return k.anlik()
        }
    }

    override fun bul(grantId: String, token: String): IzinBulgusu = synchronized(kilit) {
        val (k, neden) = denetle(grantId, token)
        if (k == null) IzinBulgusu.Gecersiz(neden ?: DeniedNeden.IZIN_YOK)
        else IzinBulgusu.Gecerli(k.anlik(), k.kullanilan.toSet())
    }

    override fun harca(grantId: String, metinMaddesi: String?): Harcama = synchronized(kilit) {
        val (k, neden) = denetle(grantId, null)
        if (k == null) return@synchronized Harcama.Ret(neden ?: DeniedNeden.IZIN_YOK)
        var madde = -1
        if (metinMaddesi != null && !k.sabit.serbestMetin) {
            madde = k.sabit.izinliMetin.indices.firstOrNull {
                it !in k.kullanilan && k.sabit.izinliMetin[it] == metinMaddesi
            } ?: return@synchronized Harcama.Ret(DeniedNeden.METIN_KILIDI)
        }
        if (k.kalanButce <= 0) return@synchronized Harcama.Ret(DeniedNeden.BUTCE_DOLDU)
        k.kalanButce -= 1
        if (madde >= 0) k.kullanilan.add(madde)
        Harcama.Tamam(k.kalanButce)
    }

    override fun geriCek(grantId: String?, neden: GrantNedeni): List<String> = synchronized(kilit) {
        val hedef = if (grantId == null) aktif.keys.toList() else listOfNotNull(grantId.takeIf { it in aktif })
        if (hedef.isEmpty()) return@synchronized emptyList()
        for (id in hedef) {
            aktif.remove(id)
            mezarEkle(id)
            denetim.izinGeriCekildi(id, neden)
        }
        diskeYaz()
        hedef
    }

    override fun suresiGecenler(): List<String> = synchronized(kilit) {
        val simdi = saat.monotonikMs()
        val bitenler = aktif.filterValues { sureBitti(it, simdi) }.keys.toList()
        if (bitenler.isEmpty()) return@synchronized emptyList()
        for (id in bitenler) {
            aktif.remove(id)
            dolmus.add(id)
            denetim.izinGeriCekildi(id, GrantNedeni.SURESI_BITTI)
        }
        diskeYaz()
        bitenler
    }

    override fun aktifler(): List<AktifIzin> = synchronized(kilit) {
        val simdi = saat.monotonikMs()
        aktif.values.filter { !sureBitti(it, simdi) }
            .map { AktifIzin(it.anlik(), it.sabit.bitisMonotonikMs - simdi) }
    }

    override fun eskiSurectenKalanlar(): List<String> = eski
}

/** Uzunluk dahil her bayta bakar; ilk farkta çıkmaz. */
private fun sabitZamanliEsit(a: String, b: String): Boolean {
    val x = a.toByteArray(Charsets.UTF_8)
    val y = b.toByteArray(Charsets.UTF_8)
    var fark = x.size xor y.size
    val uzun = maxOf(x.size, y.size)
    for (i in 0 until uzun) {
        val p = if (i < x.size) x[i].toInt() else 0
        val q = if (i < y.size) y[i].toInt() else 0
        fark = fark or (p xor q)
    }
    return fark == 0
}

val izinlerKur: IzinlerFabrikasi = IzinlerFabrikasi { saat, rastgele, denetimPortu, denetim ->
    IzinlerGercek(saat, rastgele, denetimPortu, denetim)
}
