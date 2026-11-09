package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.text.Normalizer
import java.util.Base64
import java.util.TreeMap
import java.util.concurrent.atomic.AtomicReference
import kotlin.random.Random

/*
 * Tohumlu 10.000 adım. Her adım taze bir evrende (izinler, ön plan, pencereler, düğümler, cihaz durumu)
 * geçerli bir başlangıçtan mutasyonlu bir komut dizisi işler. Değişmez: `SahteEylem`'e bir eylem ulaştıysa
 * o anda geçerli izin (bilinen, geri çekilmemiş, jetonu birebir, monotonik süresi dolmamış), izinli ön plan,
 * sıfırdan büyük bütçe vardı, mod eyleme izin veriyordu ve yazma ise metin kullanılmamış izinli bir maddeydi.
 *
 * Model üretimden bağımsızdır (KiPaket.durum, kendi bütçe/madde sayımı). Dünya yalnız kapının görebileceği
 * anlarda değişir: bir ön plan okumasının başında, bir beklemenin (`uyu`) sonunda ya da eylem komutunda ilk
 * okumanın hemen ardından (kural 11'in eylemden önceki yeniden okuması bunu görmeli); düğüm, odak ve cihaz
 * durumu bir komut boyunca sabittir. İhlal "tohum=T adım=A komut#N" ile raporlanır; aynı adımı yeniden
 * üretmek için `MtEvren(T, A, MtSayac()).calistir()`.
 */
class KomutIsleyiciMutasyonTest {
    @Test
    fun onBinAdimdaEylemYalnizGecerliKosuldaPortaUlasir() {
        val sayac = MtSayac()
        val ihlaller = ArrayList<String>()
        for (adim in 0 until ADIM_SAYISI) {
            val e = MtEvren(TOHUM, adim, sayac)
            e.calistir()
            ihlaller += e.ihlaller
            if (ihlaller.size >= 40) break
        }
        assertTrue(ihlaller.isEmpty()) {
            "${ihlaller.size} ihlal (en çok 40 toplanır), ilk 15:\n" + ihlaller.take(15).joinToString("\n") + "\n$sayac"
        }
        // Koşu anlamlı mı: her şey reddedilse değişmez boşuna tutardı.
        assertTrue(sayac.adim == ADIM_SAYISI) { "adım sayısı: $sayac" }
        assertTrue(sayac.eylem >= 300) { "porta az eylem ulaştı: $sayac" }
        assertTrue(sayac.goruntu >= 50) { "az resim döndü: $sayac" }
        assertTrue(sayac.elementler >= 50) { "az elements döndü: $sayac" }
        assertTrue(sayac.ret >= 1_000) { "az ret: $sayac" }
        assertTrue(sayac.bankaDenemesi >= 100) { "kararsız banka az denendi: $sayac" }
    }

    private companion object {
        const val TOHUM = 20_261_107L
        const val ADIM_SAYISI = 10_000
    }
}

internal class MtSayac {
    var adim = 0
    var komut = 0
    var eylem = 0
    var goruntu = 0
    var elementler = 0
    var ret = 0
    var hata = 0
    var eszamanli = 0

    /** İzni kararsız bankayı (otomatik hassas) içeren ve ön planı ya da open_app hedefi o banka olan komutlar. */
    var bankaDenemesi = 0

    @Volatile
    var eszamanliKapali = false
    val nedenler = TreeMap<String, Int>()

    override fun toString(): String =
        "adım=$adim komut=$komut eylem=$eylem resim=$goruntu elements=$elementler ret=$ret hata=$hata " +
            "eşzamanlı=$eszamanli banka=$bankaDenemesi nedenler=$nedenler"
}

private class MtIzin(
    val kayit: IzinKaydi,
    val butce: Int,
    val bitis: Long,
    val paketler: Set<String>,
    val mod: IzinModu,
    val metinler: List<String>,
    val serbest: Boolean,
) {
    var geriCekildi = false
    var suresiBildirildi = false
    var eylem = 0
    val kullanilan = HashSet<Int>()
}

private data class MtDunya(
    val kok: String?,
    val olay: String?,
    val odak: String?,
    val baslik: String?,
    val pencereler: List<Pencere>,
) {
    fun anlik(): AnlikDurum =
        AnlikDurum(kok, olay, odak, baslik, pencereler, SahteEkran.GENISLIK, SahteEkran.YUKSEKLIK, 0L)

    fun ozet(): String = "$kok/$olay/$odak"
}

private class MtPlan {
    var degisimOkumaNo = -1

    /** Yalnız eylem komutlarında: ilk ön plan okuması döner dönmez dünya değişir; eylemden önceki yeniden okuma görmeli. */
    var degisimIlkOkumaSonrasi = false
    var degisimGoruntuSonrasi = false
    var degisimUykuda = false
    var geriCekOkumaNo = -1
    var geriCekUykuda = false
    var baglantiOkumaNo = -1
    var baglantiUykuda = false
    var baglantiEylemde = false
    var istisnaOlay: String? = null
    var istisnaNo = 1
    var eylemBasarisiz = false
    var eylemIstisna = false
    var uykuEk = 0L
    var eszamanliOlayNo = -1
}

private class MtBaglam(
    val no: Int,
    val cmdId: String,
    val ad: CmdAdi?,
    val arg: CmdArg?,
    val gecersiz: Boolean,
    val cmdIdOkunur: Boolean,
    val beklenenRet: DeniedNeden?,
    val model: MtIzin?,
    val token: String,
    val deadlineOk: Boolean,
    val erken: DeniedNeden?,
    val plan: MtPlan,
    val mutasyonlar: List<String>,
) {
    private val kilit = Any()
    private val gecmis = ArrayList<String>()

    val olaylar: List<String> get() = synchronized(kilit) { ArrayList(gecmis) }

    val toplamOlay: Int get() = synchronized(kilit) { gecmis.size }

    /** Kaydeder, bu türün kaçıncı çağrısı olduğunu döner (1'den). */
    fun olay(ad: String): Int = synchronized(kilit) {
        gecmis.add(ad)
        gecmis.count { it == ad }
    }

    var eylemSayisi = 0
    var baglantiDegisti = false
    var istisnaOldu = false
    var uykuSayisi = 0
    var goruntuDunyasi: MtDunya? = null
    var goruntuSonrasiDunya: MtDunya? = null
    var elementlerDunyasi: MtDunya? = null

    val baslangicGecerli: Boolean get() = !gecersiz && erken == null
}

internal class MtEvren(private val tohum: Long, private val adim: Int, private val sayac: MtSayac) {
    private val r = Random(tohum * 1_000_003L + adim)
    val ihlaller = ArrayList<String>()

    private val saat = SahteSaat()
    private val sahteEkran = SahteEkran()
    private val sahteEylem = SahteEylem()
    private val denetimPortu = SahteDenetim()
    private val ekran = KiEkran(sahteEkran, saat)
    private val eylem = KiEylem(sahteEylem, saat)
    private val saatPortu = KiSaat(saat)
    private val denetim = denetimKaydiKur.kur(denetimPortu, saat)
    private val izinler = izinlerKur.kur(saat, SahteRastgele(r.nextLong()), denetimPortu, denetim)
    private val listeler = listelerKur.kur(KiPaket.KENDI, KiPaket.girdi())

    @Volatile
    private var pcFarki: Long? = r.nextLong(-120_000L, 120_000L)

    @Volatile
    private var baglanti = 1L

    private val oturum = object : OturumBilgisi {
        override fun pcSimdiMs(): Long? = pcFarki?.let { saat.duvarMs() + it }

        override fun baglantiNo(): Long = baglanti
    }
    private val isleyici = komutIsleyiciKur.kur(ekran, eylem, saatPortu, izinler, listeler, denetim, oturum)

    private val modeller = LinkedHashMap<String, MtIzin>()
    private val jetonlar = ArrayList<String>()

    @Volatile
    private var dunya = MtDunya(
        KiPaket.MESAJ, KiPaket.MESAJ, KiPaket.MESAJ, "Baslik ${KiPaket.MESAJ}",
        listOf(SahteEkran.uygulamaPenceresi(KiPaket.MESAJ)),
    )
    private var dugumler: Map<Int, DugumBaglami> = emptyMap()
    private var odakBag: DugumBaglami? = null
    private var okuma = ElementOkumasi(emptyList(), false)
    private var goruntu: GoruntuSonucu = SahteEkran.goruntuTamam()

    @Volatile
    private var aktif: MtBaglam? = null

    @Volatile
    private var ikinciIplik: Thread? = null
    private var baglantiOynadi = false
    private var butceIhlaliVar = false
    private var komutNo = 0

    init {
        ekran.once = { ad -> ekranOlayi(ad) }
        ekran.istisna = { ad -> ekranIstisnasi(ad) }
        ekran.anlikSonrasi = { anlikSonrasi() }
        saatPortu.kanca = { uykuOlayi() }
        sahteEylem.sonra = { c -> eylemOlayi(c) }
        sahteEylem.sonuc = {
            if (aktif?.plan?.eylemBasarisiz == true) EylemSonucu.Basarisiz(CihazHatasi.EYLEM_BASARISIZ) else EylemSonucu.Gonderildi
        }
        sahteEylem.istisna = { if (aktif?.plan?.eylemIstisna == true) IllegalStateException("$KI_GIZLI-ISTISNA-EYLEM") else null }
    }

    private fun ihlal(b: MtBaglam?, metin: String) {
        synchronized(ihlaller) {
            if (ihlaller.size >= 20) return
            val baglam = b?.let { " komut#${it.no} ${it.ad?.kablo ?: "?"} ${it.arg ?: ""} mutasyon=${it.mutasyonlar}" } ?: ""
            ihlaller += "tohum=$tohum adım=$adim$baglam: $metin"
        }
    }

    fun calistir() {
        sayac.adim++
        try {
            izinleriKur()
            val n = 1 + r.nextInt(6)
            repeat(n) { komutCalistir() }
            zamanlamaDenetimi()
        } catch (t: Throwable) {
            ihlal(aktif, "test düzeneği istisnası: ${t::class.java.name}: ${t.message} @ ${t.stackTrace.take(4).joinToString(" < ")}")
        }
    }

    // --- Kurulum -------------------------------------------------------------------------------

    private fun izinleriKur() {
        repeat(1 + r.nextInt(2)) {
            val mod = if (r.nextBoolean()) IzinModu.OKU else IzinModu.YAZ
            val paketler: List<String> = if (mod == IzinModu.OKU) {
                val secim = ACIK_HAVUZ.filter { r.nextBoolean() }.ifEmpty { listOf(ACIK_HAVUZ.random(r)) }.toMutableList()
                if (r.nextInt(100) < 10) secim += listOf(KiPaket.BANKA, KiPaket.ZIRAAT, KiPaket.YENI, KiPaket.DEGISTI).random(r)
                secim
            } else {
                listOf(if (r.nextInt(100) < 10) listOf(KiPaket.BANKA, KiPaket.ZIRAAT).random(r) else ACIK_HAVUZ.random(r))
            }
            val metinler = if (mod == IzinModu.YAZ) List(r.nextInt(4)) { METIN_HAVUZU.random(r) } else emptyList()
            val serbest = mod == IzinModu.YAZ && r.nextInt(10) == 0
            val sure = if (r.nextInt(4) == 0) r.nextLong(100L, 1_500L) else r.nextLong(60_000L, CekirdekSinirlari.AZAMI_SURE_MS + 1)
            val butce = 1 + r.nextInt(4)
            val bitis = saat.monotonikMs() + sure
            val onay = OnayliIzin(
                "plan-$adim", "a".repeat(64), mod, paketler.map { IzinliUygulama(it, "Uygulama") }, metinler, serbest, sure, butce,
            )
            val kayit = izinler.ekle(onay) ?: throw IllegalStateException("test kurulumu: izin eklenemedi")
            modeller[kayit.grantId] = MtIzin(kayit, butce, bitis, paketler.toSet(), mod, metinler, serbest)
            jetonlar += kayit.token
        }
        if (r.nextInt(100) < 15) {
            izinler.geriCek(modeller.keys.random(r), GrantNedeni.KULLANICI_DURDURDU).forEach { modeller[it]?.geriCekildi = true }
        }
    }

    private fun dunyaUygula(d: MtDunya) {
        dunya = d
        sahteEkran.anlikSenaryo(d.anlik())
    }

    private fun rastgeleDunya(m: MtIzin?): MtDunya {
        val p: String? = if (m != null && r.nextInt(100) < 65) m.paketler.random(r) else ON_PLAN_HAVUZU.random(r)
        var kok = p
        var olay = p
        var odak = p
        if (p != null && r.nextInt(100) < 7) {
            val baska = UYUSMAZ_HAVUZU.filter { it != p }.random(r)
            when (r.nextInt(3)) {
                0 -> kok = baska
                1 -> olay = baska
                else -> odak = baska
            }
        }
        val tutarli = p != null && kok == olay && olay == odak
        val baslik = if (tutarli) "Baslik $p" else "$KI_GIZLI-UYUSMAZ"
        val pencereler = ArrayList<Pencere>()
        pencereler += Pencere(PencereTuru.UYGULAMA, kok, 1, Dikdortgen(0, 0, G, Y), true, true)
        if (r.nextBoolean()) pencereler += Pencere(PencereTuru.DURUM_CUBUGU, KiPaket.SYSTEMUI, 3, Dikdortgen(0, 0, G, 100), false, false)
        if (r.nextBoolean()) pencereler += Pencere(PencereTuru.GEZINTI_CUBUGU, KiPaket.SYSTEMUI, 3, Dikdortgen(0, Y - 100, G, Y), false, false)
        if (r.nextInt(100) < 20) pencereler += rastgeleKatman()
        pencereler.sortByDescending { it.katman }
        return MtDunya(kok, olay, odak, baslik, pencereler)
    }

    private fun rastgeleKatman(): Pencere {
        val x0 = r.nextInt(0, 900)
        val y0 = r.nextInt(0, 2_200)
        return Pencere(
            KATMAN_TURLERI.random(r),
            listOf(KiPaket.SYSTEMUI, KiPaket.KLAVYE, KiPaket.HARITA, KiPaket.MESAJ, KiPaket.NOTLAR, null).random(r),
            listOf(2, 4, 5, 6).random(r),
            Dikdortgen(x0, y0, minOf(G, x0 + r.nextInt(100, G + 1)), minOf(Y, y0 + r.nextInt(100, 801))),
            false,
            false,
        )
    }

    private fun dugumYap(no: Int, paket: String?, ad: String, tiklanabilir: Boolean): Dugum = Dugum(
        no = no, paket = paket, rol = "button", ad = ad, deger = null, ipucu = null, kaynakId = null,
        sinir = Dikdortgen(100, 100 + no * 50, 600, 140 + no * 50), tiklanabilir = tiklanabilir,
        duzenlenebilir = false, etkin = true, parola = false, odakli = false,
    )

    private fun dugumleriKur(onPlanPaketi: String?) {
        val ana = onPlanPaketi ?: KiPaket.MESAJ
        val d = HashMap<Int, DugumBaglami>()
        for (no in 0..7) {
            if (r.nextInt(100) < 15) continue
            val paket = if (r.nextInt(100) < 85) ana else listOf(KiPaket.KLAVYE, KiPaket.HARITA, null).random(r)
            val ad = if (r.nextInt(100) < 25) TEHLIKELI.random(r) else GUVENLI.random(r)
            val atalar = when (r.nextInt(10)) {
                0 -> listOf(dugumYap(100 + no, paket, TEHLIKELI.random(r), tiklanabilir = true))
                1 -> listOf(dugumYap(100 + no, paket, GUVENLI.random(r), tiklanabilir = true))
                else -> emptyList()
            }
            val torunlar = if (r.nextInt(10) == 0) listOf(dugumYap(200 + no, paket, TEHLIKELI.random(r), tiklanabilir = false)) else emptyList()
            d[no] = DugumBaglami(dugumYap(no, paket, ad, tiklanabilir = true), atalar, torunlar)
        }
        dugumler = d
        sahteEkran.dugumler.clear()
        sahteEkran.dugumler.putAll(d)

        odakBag = if (r.nextInt(100) < 85) {
            val parola = r.nextInt(100) < 10
            val ipucu = if (r.nextInt(100) < 10) PAROLA_IPUCLARI.random(r) else null
            val paket = if (r.nextInt(100) < 85) ana else KiPaket.KLAVYE
            val deger = if (parola || ipucu != null) "$KI_PAROLA-odak" else "Taslak"
            val dugum = Dugum(
                no = 20 + r.nextInt(3), paket = paket, rol = "edit", ad = "Mesaj alanı", deger = deger, ipucu = ipucu,
                kaynakId = null, sinir = Dikdortgen(0, 2_000, G, 2_100), tiklanabilir = true, duzenlenebilir = true,
                etkin = true, parola = parola, odakli = true,
            )
            DugumBaglami(dugum, emptyList(), emptyList())
        } else {
            null
        }
        sahteEkran.odakBaglami = odakBag

        val liste = (0 until 2 + r.nextInt(5)).map { i ->
            val paket = if (r.nextInt(100) < 70) ana else listOf(KiPaket.KLAVYE, KiPaket.HARITA, KiPaket.NOTLAR, null).random(r)
            val gizli = r.nextInt(100) < 15
            val parola = gizli && r.nextBoolean()
            val deger = when {
                gizli -> "$KI_PAROLA-$i"
                r.nextBoolean() -> "Deger$i"
                else -> null
            }
            Dugum(
                no = 30 + i, paket = paket, rol = "text", ad = "Oge$i-${paket ?: "yok"}", deger = deger,
                ipucu = if (gizli && !parola) "PIN" else null, kaynakId = null,
                sinir = Dikdortgen(0, 300 + i * 60, G, 350 + i * 60), tiklanabilir = false, duzenlenebilir = gizli,
                etkin = true, parola = parola, odakli = false,
            )
        }
        okuma = ElementOkumasi(liste, r.nextInt(10) == 0)
        sahteEkran.okuma = okuma
    }

    private fun goruntuKur(no: Int) {
        val b64 = Base64.getEncoder().encodeToString("IMG-$adim-$no".toByteArray(Charsets.UTF_8))
        goruntu = when (r.nextInt(100)) {
            in 0..4 -> GoruntuSonucu.Korumali
            in 5..9 -> GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI)
            in 10..19 -> GoruntuSonucu.Tamam("image/jpeg", b64, G, Y, 1.0, 0.995)
            else -> GoruntuSonucu.Tamam(if (r.nextBoolean()) "image/jpeg" else "image/png", b64, G, Y, 1.0, r.nextDouble(0.0, 0.9))
        }
        sahteEkran.goruntuSenaryo(goruntu)
    }

    // --- Komut üretimi ------------------------------------------------------------------------

    private fun rastgeleAd(): CmdAdi {
        var x = r.nextInt(AD_AGIRLIK.sumOf { it.second })
        for ((a, w) in AD_AGIRLIK) {
            if (x < w) return a
            x -= w
        }
        return CmdAdi.FOREGROUND
    }

    private fun rastgeleMetin(m: MtIzin?): String {
        val taban = (m?.metinler.orEmpty() + METIN_HAVUZU).random(r)
        return when (r.nextInt(10)) {
            in 0..4 -> taban
            5 -> "$taban "
            6 -> taban + "\n"
            7 -> Normalizer.normalize(taban, Normalizer.Form.NFD)
            8 -> taban.replace('e', 'е')
            else -> if (r.nextBoolean()) taban.dropLast(1) else "Serbest ${r.nextInt(100)}"
        }
    }

    private fun nokta(): Nokta = Nokta(r.nextInt(0, G), r.nextInt(0, Y))

    private fun rastgeleArg(ad: CmdAdi, m: MtIzin?): CmdArg = when (ad) {
        CmdAdi.FOREGROUND -> CmdArg.Foreground
        CmdAdi.ELEMENTS -> CmdArg.Elements(if (r.nextInt(5) == 0) "oge" else null)
        CmdAdi.SCREENSHOT -> CmdArg.Screenshot
        CmdAdi.ZOOM -> {
            val x0 = r.nextInt(0, 1_000)
            val y0 = r.nextInt(0, 2_300)
            CmdArg.Zoom(x0, y0, x0 + r.nextInt(1, 500), y0 + r.nextInt(1, 500))
        }
        CmdAdi.CLICK -> {
            val tiklama = if (r.nextInt(100) < 12) 2 else 1
            val uzun = r.nextInt(100) < 12
            if (r.nextInt(100) < 70) CmdArg.Click(r.nextInt(0, 10), null, tiklama, uzun) else CmdArg.Click(null, nokta(), tiklama, uzun)
        }
        CmdAdi.TYPE_TEXT -> CmdArg.TypeText(rastgeleMetin(m))
        CmdAdi.KEY -> CmdArg.Key(Tus.entries.random(r), r.nextInt(1, 4))
        CmdAdi.SCROLL -> CmdArg.Scroll(
            KaydirmaYonu.entries.random(r),
            if (r.nextInt(100) < 40) r.nextInt(1, Sinirlar.KAYDIRMA_MAX + 1) else null,
            if (r.nextInt(100) < 30) nokta() else null,
        )
        CmdAdi.DRAG -> CmdArg.Drag(r.nextInt(0, G), r.nextInt(0, Y), r.nextInt(0, G), r.nextInt(0, Y))
        CmdAdi.WAIT -> CmdArg.Wait(listOf(0.25, 0.5, 1.0, 1.5).random(r))
        CmdAdi.OPEN_APP -> CmdArg.OpenApp(ACILACAK_HAVUZ.random(r))
    }

    private fun argAlanlari(a: CmdArg): LinkedHashMap<String, String> {
        val m = LinkedHashMap<String, String>()
        when (a) {
            is CmdArg.Foreground, is CmdArg.Screenshot -> Unit
            is CmdArg.Elements -> a.sorgu?.let { m["query"] = j(it) }
            is CmdArg.Zoom -> {
                m["x0"] = "${a.x0}"
                m["y0"] = "${a.y0}"
                m["x1"] = "${a.x1}"
                m["y1"] = "${a.y1}"
            }
            is CmdArg.Click -> {
                a.element?.let { m["element"] = "$it" }
                a.nokta?.let {
                    m["x"] = "${it.x}"
                    m["y"] = "${it.y}"
                }
                if (a.tiklama != 1 || r.nextInt(10) == 0) m["clicks"] = "${a.tiklama}"
                if (a.uzunBasma || r.nextInt(10) == 0) m["long_press"] = "${a.uzunBasma}"
            }
            is CmdArg.TypeText -> m["text"] = j(a.metin)
            is CmdArg.Key -> {
                m["keys"] = j(a.tus.kablo)
                if (a.tekrar != 1 || r.nextInt(10) == 0) m["repeat"] = "${a.tekrar}"
            }
            is CmdArg.Scroll -> {
                m["direction"] = j(a.yon.kablo)
                a.miktar?.let { m["amount"] = "$it" }
                a.nokta?.let {
                    m["x"] = "${it.x}"
                    m["y"] = "${it.y}"
                }
            }
            is CmdArg.Drag -> {
                m["x0"] = "${a.x0}"
                m["y0"] = "${a.y0}"
                m["x1"] = "${a.x1}"
                m["y1"] = "${a.y1}"
            }
            is CmdArg.Wait -> m["seconds"] = "${a.saniye}"
            is CmdArg.OpenApp -> m["package"] = j(a.paket)
        }
        return m
    }

    private fun rastgeleJeton(): String = (1..43).map { JETON_ALFABESI[r.nextInt(JETON_ALFABESI.length)] }.joinToString("")

    private fun jetonMutasyonu(t: String, muts: MutableList<String>): String {
        val secim = r.nextInt(5)
        muts += "jeton:" + listOf("başka", "önek", "harf", "ek", "rastgele")[secim]
        return when (secim) {
            0 -> modeller.values.map { it.kayit.token }.filter { it != t }.let { if (it.isEmpty()) t + "A" else it.random(r) }
            1 -> t.dropLast(1 + r.nextInt(3)).let { if (it.length >= Sinirlar.JETON_MIN) it else t + "B" }
            2 -> {
                val i = t.indexOfFirst { it.isLetter() }
                if (i < 0) t + "C" else t.substring(0, i) + (if (t[i].isUpperCase()) t[i].lowercaseChar() else t[i].uppercaseChar()) + t.substring(i + 1)
            }
            3 -> t + "x"
            else -> rastgeleJeton()
        }
    }

    private fun planKur(ad: CmdAdi, muts: MutableList<String>): MtPlan {
        val p = MtPlan()
        if (r.nextInt(100) < 10) {
            p.degisimOkumaNo = 1 + r.nextInt(3)
            muts += "değişim:okuma${p.degisimOkumaNo}"
        }
        // Okuma komutlarında okumadan sonraki değişimi görme şartı yok (elements'ta sonradan okuma kuralı yok).
        if (ad in CekirdekSinirlari.EYLEM_KOMUTLARI && r.nextInt(100) < 10) {
            p.degisimIlkOkumaSonrasi = true
            muts += "değişim:ilk-okumadan-sonra"
        }
        if (r.nextInt(100) < 8) {
            p.degisimGoruntuSonrasi = true
            muts += "değişim:görüntü-sonrası"
        }
        if (r.nextInt(100) < 8) {
            p.degisimUykuda = true
            muts += "değişim:uyku"
        }
        if (r.nextInt(100) < 4) {
            p.geriCekOkumaNo = 1 + r.nextInt(3)
            muts += "geriÇek:okuma${p.geriCekOkumaNo}"
        }
        if (r.nextInt(100) < 4) {
            p.geriCekUykuda = true
            muts += "geriÇek:uyku"
        }
        if (r.nextInt(100) < 3) {
            p.baglantiOkumaNo = 1 + r.nextInt(3)
            muts += "bağlantı:okuma${p.baglantiOkumaNo}"
        }
        if (r.nextInt(100) < 3) {
            p.baglantiUykuda = true
            muts += "bağlantı:uyku"
        }
        if (r.nextInt(100) < 3) {
            p.baglantiEylemde = true
            muts += "bağlantı:eylem"
        }
        if (r.nextInt(100) < 5) {
            p.istisnaOlay = EKRAN_OLAYLARI.random(r)
            p.istisnaNo = 1 + r.nextInt(2)
            muts += "istisna:${p.istisnaOlay}${p.istisnaNo}"
        }
        when (r.nextInt(100)) {
            in 0..4 -> {
                p.eylemBasarisiz = true
                muts += "eylem:başarısız"
            }
            in 5..8 -> {
                p.eylemIstisna = true
                muts += "eylem:istisna"
            }
        }
        if (r.nextInt(100) < 15) {
            p.uykuEk = r.nextLong(1L, 2_000L)
            muts += "uyku+${p.uykuEk}"
        }
        if (r.nextInt(100) < 1) {
            p.eszamanliOlayNo = 1 + r.nextInt(3)
            muts += "eşzamanlı${p.eszamanliOlayNo}"
        }
        return p
    }

    // --- Bir komut ----------------------------------------------------------------------------

    private fun komutCalistir() {
        val no = ++komutNo
        sayac.komut++
        val muts = ArrayList<String>()
        if (r.nextInt(100) < 30) {
            val ms = r.nextLong(0L, 2_000L)
            saat.ilerlet(ms)
            muts += "zaman+$ms"
        }
        if (r.nextInt(100) < 5) {
            val ms = r.nextLong(-600_000L, 600_000L)
            saat.duvarSapmasi(ms)
            muts += "duvar$ms"
        }
        if (r.nextInt(100) < 5 && modeller.isNotEmpty()) {
            val hepsi = r.nextInt(3) == 0
            izinler.geriCek(if (hepsi) null else modeller.keys.random(r), GrantNedeni.LIMIT_KILIT)
                .forEach { modeller[it]?.geriCekildi = true }
            muts += if (hepsi) "geriÇek(hepsi)" else "geriÇek"
        }
        if (r.nextInt(100) < 3) {
            baglanti++
            muts += "bağlantı(arada)"
        }
        val cihaz = when (r.nextInt(100)) {
            in 0..5 -> CihazDurumu(a11y = false, kilitli = false, adbAcik = false)
            in 6..11 -> CihazDurumu(a11y = true, kilitli = true, adbAcik = false)
            in 12..13 -> CihazDurumu(a11y = false, kilitli = true, adbAcik = false)
            else -> CihazDurumu(a11y = true, kilitli = false, adbAcik = r.nextInt(10) == 0)
        }
        if (!cihaz.a11y || cihaz.kilitli) muts += "cihaz(a11y=${cihaz.a11y},kilit=${cihaz.kilitli})"
        sahteEkran.cihaz = cihaz

        val secilen = if (modeller.isNotEmpty() && r.nextInt(100) < 88) modeller.values.random(r) else null
        var grantId = secilen?.kayit?.grantId ?: "gYok${r.nextInt(1_000)}"
        var token = secilen?.kayit?.token ?: rastgeleJeton()
        if (secilen == null) muts += "izin:bilinmeyen"
        if (modeller.size > 1 && r.nextInt(100) < 5) {
            val eski = grantId
            grantId = modeller.keys.filter { it != eski }.random(r)
            muts += "grant:başka"
        }
        if (r.nextInt(100) < 12) token = jetonMutasyonu(token, muts)
        val model = modeller[grantId]

        dunyaUygula(rastgeleDunya(model))
        dugumleriKur(dunya.kok)
        goruntuKur(no)

        val ad = rastgeleAd()
        val arg = rastgeleArg(ad, model)
        if (model != null && KiPaket.ZIRAAT in model.paketler &&
            (dunya.kok == KiPaket.ZIRAAT || (arg as? CmdArg.OpenApp)?.paket == KiPaket.ZIRAAT)
        ) {
            sayac.bankaDenemesi++
        }
        val args = argAlanlari(arg)
        val pc = oturum.pcSimdiMs()
        val taban = pc ?: saat.duvarMs()
        var deadline = taban + r.nextLong(1_000L, 60_000L)
        var pcGecici = false
        when (r.nextInt(100)) {
            in 0..5 -> {
                deadline = taban - r.nextLong(1L, 10_000L)
                muts += "deadline:geçti"
            }
            in 6..8 -> {
                deadline = taban
                muts += "deadline:eşit"
            }
            in 9..11 -> {
                pcGecici = true
                muts += "pc:null"
            }
        }
        val cmdId = "m$no"
        val zarf = linkedMapOf(
            "v" to "1",
            "type" to j("cmd"),
            "cmd_id" to j(cmdId),
            "grant_id" to j(grantId),
            "token" to j(token),
            "deadline_ms" to "$deadline",
            "name" to j(ad.kablo),
        )

        // Adım 0 mutasyonu: en çok bir tane, beklenen neden belli.
        var gecersiz = false
        var okunur = true
        var beklenenRet: DeniedNeden? = null
        var sonIslem: ((String) -> String)? = null
        if (r.nextInt(100) < 8) {
            gecersiz = true
            beklenenRet = DeniedNeden.GECERSIZ_ARG
            val sayisal = args.keys.filter { SAYI.matches(args.getValue(it)) }
            val tur = r.nextInt(18)
            muts += "adım0:$tur"
            when (tur) {
                0 -> {
                    zarf["name"] = j(listOf("shell", "open_url", "install", "tap").random(r))
                    beklenenRet = DeniedNeden.DESTEKLENMEYEN_KOMUT
                }
                1 -> zarf["url"] = j("https://ornek.com")
                2 -> args["url"] = j("x")
                3 -> {
                    val k = sayisal.randomOrNull(r)
                    if (k == null) {
                        args["url"] = j("x")
                    } else {
                        args[k] = (if (k == "seconds") listOf("-1", "\"3\"", "true") else listOf("12.5", "-1", "\"3\"", "true")).random(r)
                    }
                }
                4 -> {
                    val k = (sayisal + "deadline_ms").random(r)
                    val v = listOf("1e400", "-0").random(r)
                    if (k == "deadline_ms") zarf[k] = v else args[k] = v
                    okunur = false
                }
                5 -> {
                    zarf["v"] = "2"
                    okunur = false
                }
                6 -> {
                    val adMetni = zarf.getValue("name")
                    sonIslem = { it.dropLast(1) + ",\"name\":$adMetni}" }
                    okunur = false
                }
                7 -> {
                    val kes = 1 + r.nextInt(4)
                    sonIslem = { it.dropLast(kes) }
                    okunur = false
                }
                8 -> {
                    zarf["name"] = j("open_app")
                    args.clear()
                    args["package"] = j(URL_HAVUZU.random(r))
                    beklenenRet = DeniedNeden.URL_INTENT_YASAK
                }
                9 -> {
                    zarf["name"] = j("type_text")
                    args.clear()
                    args["text"] = j("")
                }
                10 -> {
                    zarf["name"] = j("key")
                    args.clear()
                    args["keys"] = j("power")
                }
                11 -> {
                    zarf["name"] = j("scroll")
                    args.clear()
                    args["direction"] = j("diagonal")
                }
                12 -> {
                    zarf["name"] = j("zoom")
                    args.clear()
                    args["x0"] = "10"; args["y0"] = "10"; args["x1"] = "10"; args["y1"] = "20"
                }
                13 -> {
                    zarf["name"] = j("click")
                    args.clear()
                    args["element"] = "1"; args["x"] = "1"; args["y"] = "1"
                }
                14 -> {
                    zarf["name"] = j("wait")
                    args.clear()
                    args["seconds"] = listOf("0", "31").random(r)
                }
                15 -> zarf["token"] = j(listOf("kisa", token + "+", token.take(31)).random(r))
                16 -> {
                    zarf["cmd_id"] = j(listOf("", "a".repeat(65), "c/1").random(r))
                    okunur = false
                }
                else -> zarf["grant_id"] = j("g/1")
            }
            if (!okunur) beklenenRet = null
        }
        zarf["args"] = nesne(args)
        var ham = nesne(zarf)
        sonIslem?.let { ham = it(ham) }

        val plan = if (gecersiz) MtPlan() else planKur(ad, muts)
        izinleriEsitle()
        val pcEski = pcFarki
        if (pcGecici) pcFarki = null
        val pcBas = oturum.pcSimdiMs()
        val deadlineOk = pcBas != null && pcBas <= deadline
        val erken = if (gecersiz) null else erkenNeden(model, token, deadlineOk, cihaz)
        val b = MtBaglam(
            no = no, cmdId = cmdId, ad = if (gecersiz) null else ad, arg = if (gecersiz) null else arg,
            gecersiz = gecersiz, cmdIdOkunur = okunur, beklenenRet = beklenenRet, model = model, token = token,
            deadlineOk = deadlineOk, erken = erken, plan = plan, mutasyonlar = muts,
        )
        val satirOnce = denetimPortu.satirlar.size
        aktif = b
        val ciktiHam: List<String>? = try {
            isleyici.isle(ham)
        } catch (t: Throwable) {
            ihlal(b, "[istisna] isle dışarı istisna sızdırdı: ${t::class.java.name}")
            null
        }
        aktif = null
        if (pcGecici) pcFarki = pcEski
        if (ciktiHam == null) return
        val c = try {
            KiCikti(ciktiHam)
        } catch (e: AssertionError) {
            ihlal(b, e.message ?: "giden çerçeve çözülemedi")
            return
        }
        if (adim % 50 == 0) c.ham.forEach(SahteCikti::ekle)
        sonrasi(b, c, denetimPortu.satirlar.drop(satirOnce))
    }

    /** Üretimin kendi kararıyla (bütçe/süre) kapattığı izinleri modele işler; jeton denetiminden önce gelen durumlar. */
    private fun izinleriEsitle() {
        for (m in modeller.values) {
            if (m.geriCekildi || m.suresiBildirildi) continue
            val d = izinler.bul(m.kayit.grantId, YANLIS_JETON)
            if (d is IzinBulgusu.Gecersiz) {
                when (d.neden) {
                    DeniedNeden.IZIN_GERI_CEKILDI -> m.geriCekildi = true
                    DeniedNeden.IZIN_SURESI_BITTI -> m.suresiBildirildi = true
                    else -> Unit
                }
            }
        }
    }

    /** Kural 1-7'nin modele göre beklenen sonucu; `null` = geçmeli. */
    private fun erkenNeden(m: MtIzin?, token: String, deadlineOk: Boolean, cihaz: CihazDurumu): DeniedNeden? {
        if (!deadlineOk) return DeniedNeden.DEADLINE_GECTI
        if (m == null) return DeniedNeden.IZIN_YOK
        if (m.geriCekildi) return DeniedNeden.IZIN_GERI_CEKILDI
        if (m.suresiBildirildi) return DeniedNeden.IZIN_SURESI_BITTI
        if (token != m.kayit.token) return DeniedNeden.JETON_YANLIS
        if (saat.monotonikMs() >= m.bitis) return DeniedNeden.IZIN_SURESI_BITTI
        if (!cihaz.a11y) return DeniedNeden.ERISILEBILIRLIK_KAPALI
        if (cihaz.kilitli) return DeniedNeden.KILIT_EKRANI
        return null
    }

    // --- Kancalar -----------------------------------------------------------------------------

    private fun ekranOlayi(ad: String) {
        if (Thread.currentThread() === ikinciIplik) return
        val b = aktif ?: return
        val kacinci = b.olay(ad)
        val p = b.plan
        when (ad) {
            "anlik" -> {
                if (kacinci == p.degisimOkumaNo) dunyaUygula(rastgeleDunya(b.model))
                if (kacinci == p.geriCekOkumaNo) komuttaGeriCek(b)
                if (kacinci == p.baglantiOkumaNo) baglantiKopar(b)
                if (b.goruntuDunyasi != null && b.goruntuSonrasiDunya == null) {
                    if (p.degisimGoruntuSonrasi) dunyaUygula(rastgeleDunya(b.model))
                    b.goruntuSonrasiDunya = dunya
                }
            }
            "goruntu" -> {
                b.goruntuDunyasi = dunya
                b.goruntuSonrasiDunya = null
            }
            "elementler" -> b.elementlerDunyasi = dunya
        }
        if (b.toplamOlay == p.eszamanliOlayNo) eszamanli(b)
    }

    private fun anlikSonrasi() {
        if (Thread.currentThread() === ikinciIplik) return
        val b = aktif ?: return
        if (b.plan.degisimIlkOkumaSonrasi && b.olaylar.count { it == "anlik" } == 1) dunyaUygula(rastgeleDunya(b.model))
    }

    private fun ekranIstisnasi(ad: String): Throwable? {
        if (Thread.currentThread() === ikinciIplik) return null
        val b = aktif ?: return null
        val p = b.plan
        if (ad != p.istisnaOlay || b.istisnaOldu) return null
        if (b.olaylar.count { it == ad } != p.istisnaNo) return null
        b.istisnaOldu = true
        return IllegalStateException("$KI_GIZLI-ISTISNA-EKRAN")
    }

    private fun uykuOlayi() {
        if (Thread.currentThread() === ikinciIplik) return
        val b = aktif ?: return
        b.uykuSayisi++
        if (b.uykuSayisi != 1) return
        val p = b.plan
        if (p.uykuEk > 0) saat.ilerlet(p.uykuEk)
        if (p.degisimUykuda) dunyaUygula(rastgeleDunya(b.model))
        if (p.geriCekUykuda) komuttaGeriCek(b)
        if (p.baglantiUykuda) baglantiKopar(b)
    }

    private fun komuttaGeriCek(b: MtBaglam) {
        val m = b.model ?: return
        izinler.geriCek(m.kayit.grantId, GrantNedeni.KULLANICI_DURDURDU).forEach { modeller[it]?.geriCekildi = true }
    }

    private fun baglantiKopar(b: MtBaglam) {
        baglanti++
        b.baglantiDegisti = true
        baglantiOynadi = true
    }

    private fun eszamanli(b: MtBaglam) {
        if (sayac.eszamanliKapali) return
        val m = modeller.values.firstOrNull() ?: return
        val id = "ikinci-${b.no}"
        val ham = nesne(
            linkedMapOf(
                "v" to "1", "type" to j("cmd"), "cmd_id" to j(id), "grant_id" to j(m.kayit.grantId),
                "token" to j(m.kayit.token), "deadline_ms" to "${(oturum.pcSimdiMs() ?: saat.duvarMs()) + 30_000L}",
                "name" to j("foreground"), "args" to "{}",
            ),
        )
        val sonuc = AtomicReference<List<String>?>(null)
        val hata = AtomicReference<Throwable?>(null)
        val ip = Thread {
            try {
                sonuc.set(isleyici.isle(ham))
            } catch (t: Throwable) {
                hata.set(t)
            }
        }
        ip.isDaemon = true
        ikinciIplik = ip
        ip.start()
        ip.join(3_000L)
        if (ip.isAlive) {
            ihlal(b, "[mesgul] ikinci komut çalışan komutu bekledi, beklemeden mesgul almalıydı")
            sayac.eszamanliKapali = true
            return
        }
        ikinciIplik = null
        sayac.eszamanli++
        hata.get()?.let {
            ihlal(b, "[mesgul] ikinci komut istisna sızdırdı: ${it::class.java.name}")
            return
        }
        val c = try {
            KiCikti(sonuc.get().orEmpty())
        } catch (e: AssertionError) {
            ihlal(b, "[mesgul] ${e.message}")
            return
        }
        for (s in KiOrtakDenetim.sorunlar(c, jetonlar, denetimPortu.satirlar.filter { it.cmdId == id })) ihlal(b, "[mesgul] $s")
        if (c.cmdId != id || c.deniedNeden != DeniedNeden.MESGUL) ihlal(b, "[mesgul] ikinci komut mesgul almadı: ${c.denied}/${c.hata}")
        if (c.onPlan != null) ihlal(b, "[mesgul] mesgul yanıtında foreground dolu")
    }

    // --- Değişmez: eylem anında --------------------------------------------------------------

    private fun izinli(p: String?, m: MtIzin): Boolean = p != null && p in m.paketler

    /** Modelden bağımsız: banka (kararlı ya da kararsız) ön planda, odakta, son olayda ya da bir pencerede. */
    private fun bankaGorunur(w: MtDunya): Boolean =
        w.kok in BANKALAR || w.olay in BANKALAR || w.odak in BANKALAR || w.pencereler.any { it.paket in BANKALAR }

    private fun onPlanUygun(w: MtDunya, m: MtIzin): Boolean {
        val p = w.kok ?: return false
        return p == w.olay && p == w.odak && p in m.paketler && KiPaket.durum(p) == UygulamaDurumu.ACIK
    }

    private fun pencerelerUygun(w: MtDunya, m: MtIzin): Boolean = w.pencereler.all {
        it.tur == PencereTuru.DURUM_CUBUGU || it.tur == PencereTuru.GEZINTI_CUBUGU ||
            (it.tur !in YASAK_PENCERELER && izinli(it.paket, m))
    }

    private fun enUstPencere(w: MtDunya, n: Nokta): Pencere? = w.pencereler
        .filter { n.x >= it.sinir.sol && n.x < it.sinir.sag && n.y >= it.sinir.ust && n.y < it.sinir.alt }
        .maxByOrNull { it.katman }

    private fun etiketli(bag: DugumBaglami): Boolean =
        bag.dugum.ad in TEHLIKELI ||
            bag.atalar.any { it.tiklanabilir && it.ad in TEHLIKELI } ||
            bag.torunlar.any { it.ad in TEHLIKELI }

    private fun parolaMi(d: Dugum): Boolean = d.parola || d.ipucu != null

    private fun eylemOlayi(c: EylemCagrisi) {
        if (Thread.currentThread() === ikinciIplik) {
            ihlal(aktif, "[mesgul] eşzamanlı ikinci komut eyleme ulaştı: $c")
            return
        }
        sayac.eylem++
        val b = aktif ?: run {
            ihlal(null, "[değişmez] komut dışında eylem: $c")
            return
        }
        b.eylemSayisi++
        val s = ArrayList<String>()
        if (b.eylemSayisi > 1) s += "bir komutta birden çok eylem"
        if (b.gecersiz) s += "adım 0'da reddedilmesi gereken çerçeve eyleme ulaştı"
        if (b.baglantiDegisti) s += "bağlantı no değiştikten sonra eylem"
        if (!b.deadlineOk) s += "deadline geçmişken eylem"
        val m = b.model
        if (m == null) {
            s += "bilinmeyen izinle eylem"
        } else {
            if (m.geriCekildi) s += "geri çekilmiş izinle eylem"
            if (m.suresiBildirildi) s += "süresi bildirilmiş izinle eylem"
            if (b.token != m.kayit.token) s += "jeton birebir değilken eylem"
            val simdi = saat.monotonikMs()
            if (simdi >= m.bitis) s += "süresi bitmiş izinle eylem (${simdi - m.bitis} ms geçmiş)"
            if (m.eylem >= m.butce) s += "bütçe sıfırken eylem"
            val cihaz = sahteEkran.cihaz
            if (!cihaz.a11y) s += "erişilebilirlik kapalıyken eylem"
            if (cihaz.kilitli) s += "kilit ekranında eylem"
            argDenetimi(b, m, c, s)
            m.eylem++
        }
        for (x in s) ihlal(b, "[değişmez] $x")
        if (b.plan.baglantiEylemde) baglantiKopar(b)
    }

    private fun argDenetimi(b: MtBaglam, m: MtIzin, c: EylemCagrisi, s: MutableList<String>) {
        val w = dunya
        val arg = b.arg
        if (arg is CmdArg.OpenApp) {
            if (c != EylemCagrisi.UygulamaAc(arg.paket)) s += "eylem komutla uyuşmuyor: $c"
            if (arg.paket !in m.paketler || KiPaket.durum(arg.paket) != UygulamaDurumu.ACIK) s += "izin dışı uygulama açıldı: ${arg.paket}"
            if (arg.paket in BANKALAR) s += "[banka] hassas banka uygulaması açıldı: ${arg.paket}"
            return
        }
        if (!onPlanUygun(w, m)) s += "izin dışı ön planda eylem: ${w.ozet()}"
        if (bankaGorunur(w)) s += "[banka] banka ön plandayken eylem: ${w.ozet()}"
        when (arg) {
            is CmdArg.Click -> {
                val el = arg.element
                if (el != null) {
                    if (c != EylemCagrisi.DugumeDokun(el, arg.tiklama, arg.uzunBasma)) s += "eylem komutla uyuşmuyor: $c"
                    val bag = dugumler[el]
                    if (bag == null) {
                        s += "olmayan düğüme dokunuldu"
                    } else {
                        if (!izinli(bag.dugum.paket, m)) s += "izin dışı paket düğümüne dokunuldu: ${bag.dugum.paket}"
                        if (m.mod == IzinModu.OKU && etiketli(bag)) s += "yalnız okuda gönder/sil/öde etiketli düğüme dokunuldu"
                    }
                    if (m.mod == IzinModu.OKU && (arg.tiklama != 1 || arg.uzunBasma)) s += "yalnız okuda çift ya da uzun dokunma"
                } else {
                    if (m.mod == IzinModu.OKU) s += "yalnız okuda x,y dokunma"
                    if (c !is EylemCagrisi.NoktayaDokun || c.tiklama != arg.tiklama || c.uzun != arg.uzunBasma) {
                        s += "eylem komutla uyuşmuyor: $c"
                    } else {
                        val ust = enUstPencere(w, c.nokta)
                        if (ust == null || !izinli(ust.paket, m)) s += "dokunulan noktadaki en üst pencere izin dışı: ${ust?.tur}/${ust?.paket}"
                    }
                }
            }
            is CmdArg.TypeText -> {
                if (m.mod == IzinModu.OKU) s += "yalnız okuda yazma"
                val od = odakBag
                if (od == null) {
                    s += "odak yokken yazıldı"
                } else {
                    if (c != EylemCagrisi.MetinYaz(od.dugum.no, arg.metin)) s += "eylem komutla uyuşmuyor: $c"
                    if (!izinli(od.dugum.paket, m)) s += "izin dışı paketteki alana yazıldı: ${od.dugum.paket}"
                    if (parolaMi(od.dugum)) s += "parola alanına yazıldı"
                }
                if (!m.serbest) {
                    val i = m.metinler.indices.firstOrNull { it !in m.kullanilan && m.metinler[it] == arg.metin }
                    if (i == null) s += "izinli olmayan ya da kullanılmış metin yazıldı" else m.kullanilan += i
                }
            }
            is CmdArg.Key -> {
                if (m.mod == IzinModu.OKU) s += "yalnız okuda tuş"
                if (c != EylemCagrisi.TusBas(arg.tus, arg.tekrar)) s += "eylem komutla uyuşmuyor: $c"
            }
            is CmdArg.Scroll -> {
                val ham = arg.yon == KaydirmaYonu.LEFT || arg.yon == KaydirmaYonu.RIGHT || arg.nokta != null
                if (m.mod == IzinModu.OKU && ham) s += "yalnız okuda yatay ya da x,y'li kaydırma"
                if (c !is EylemCagrisi.Kaydir || c.yon != arg.yon || c.miktar != arg.miktar || (c.nokta == null) != (arg.nokta == null)) {
                    s += "eylem komutla uyuşmuyor: $c"
                }
            }
            is CmdArg.Drag -> {
                if (m.mod == IzinModu.OKU) s += "yalnız okuda sürükleme"
                if (c !is EylemCagrisi.Surukle) s += "eylem komutla uyuşmuyor: $c"
            }
            else -> s += "eylemsiz komutta eylem: ${arg?.ad}"
        }
    }

    // --- Komuttan sonra -----------------------------------------------------------------------

    private fun sonrasi(b: MtBaglam, c: KiCikti, satirlar: List<DenetimSatiri>) {
        val benim = satirlar.filter { it.cmdId?.startsWith("ikinci-") != true }
        val gizliler = (jetonlar + b.token + SahtePc.JETON).filter { it.length >= Sinirlar.JETON_MIN }
        for (s in KiOrtakDenetim.sorunlar(c, gizliler, benim)) ihlal(b, "[ortak] $s")
        c.deniedNeden?.let {
            sayac.ret++
            sayac.nedenler.merge(it.kablo, 1, Int::plus)
        }
        if (c.hata != null) sayac.hata++
        if (b.baglantiDegisti) {
            if (c.ham.isNotEmpty()) ihlal(b, "[bağlantı] bağlantı no değişti, sonuç atılmadı")
            return
        }
        if (b.cmdIdOkunur) {
            if (c.sonuc == null) {
                ihlal(b, "cmd_result yok")
                return
            }
            if (c.cmdId != b.cmdId) ihlal(b, "cmd_id uyuşmuyor: ${c.cmdId}")
        } else if (c.ok == true) {
            ihlal(b, "[adım 0] bozuk çerçeveye ok:true")
        }
        val olaylar = b.olaylar
        val erken = b.erken
        if (b.gecersiz) {
            if (olaylar.isNotEmpty()) ihlal(b, "[adım 0] port çağrıldı: $olaylar")
            val beklenen = b.beklenenRet
            if (beklenen != null && c.denied != beklenen.kablo) ihlal(b, "[adım 0] beklenen ${beklenen.kablo}, gelen ${c.denied}/${c.hata}")
            if (c.onPlan != null) ihlal(b, "[adım 0] foreground dolu")
        } else if (erken != null) {
            val durumda = erken == DeniedNeden.ERISILEBILIRLIK_KAPALI || erken == DeniedNeden.KILIT_EKRANI
            if (!(b.istisnaOldu && durumda) && c.denied != erken.kablo) {
                ihlal(b, "[sıra] beklenen ${erken.kablo}, gelen ${c.denied}/${c.hata}")
            }
            val izinliOlaylar = if (durumda) setOf("durum") else emptySet()
            if (olaylar.any { it !in izinliOlaylar }) ihlal(b, "[sıra] kural 1-7 reddinde ekran okundu: $olaylar")
            if (c.onPlan != null) ihlal(b, "[sıra] kural 1-7 reddinde foreground dolu")
        } else {
            val dn = c.deniedNeden
            if (dn != null && dn in ERKEN_OLMAZ) ihlal(b, "[sıra] kural 1-7'yi geçmesi gereken komut ${dn.kablo} aldı")
        }
        if (c.denied != null && b.eylemSayisi > 0) ihlal(b, "[değişmez] ret dalında eylem portu çağrıldı")
        val ad = b.ad
        val eylemKomutu = ad != null && ad in CekirdekSinirlari.EYLEM_KOMUTLARI
        if (c.ok == true && eylemKomutu && b.eylemSayisi != 1) ihlal(b, "izinli eylem ${b.eylemSayisi} kez çağrıldı")
        if (c.ok == true && !eylemKomutu && b.eylemSayisi != 0) ihlal(b, "eylemsiz komut eylem portunu çağırdı")
        when (c.yukTuru) {
            "image" -> goruntuDenetimi(b, c)
            "elements" -> elementlerDenetimi(b, c)
        }
        baslikDenetimi(b, c)
        for ((g, n) in c.geriCekilenler) grantRevokedIsle(b, g, n)
        if (!baglantiOynadi && !butceIhlaliVar) butceDenetimi(b)
        if (b.cmdIdOkunur && !b.gecersiz) {
            val satir = benim.firstOrNull { it.olay == DenetimOlayi.KOMUT && it.cmdId == b.cmdId }
            if (satir != null && satir.komut != b.ad) ihlal(b, "denetim satırında komut adı yanlış: ${satir.komut}")
        }
    }

    private fun goruntuDenetimi(b: MtBaglam, c: KiCikti) {
        sayac.goruntu++
        val m = b.model
        if (!b.baslangicGecerli || m == null) {
            ihlal(b, "[değişmez] geçersiz izinle resim döndü")
            return
        }
        val wg = b.goruntuDunyasi ?: run {
            ihlal(b, "görüntü portu çağrılmadan resim döndü")
            return
        }
        if (!onPlanUygun(wg, m)) ihlal(b, "[değişmez] görüntü anında ön plan izin dışıydı: ${wg.ozet()}")
        if (bankaGorunur(wg)) ihlal(b, "[değişmez] [banka] banka görünürken resim döndü: ${wg.ozet()}")
        if (!pencerelerUygun(wg, m)) ihlal(b, "[değişmez] görüntü anında izin dışı pencere vardı: ${wg.pencereler.map { it.tur to it.paket }}")
        val wp = b.goruntuSonrasiDunya
        if (wp == null) {
            ihlal(b, "[kural 12] görüntüden sonra ön plan yeniden okunmadı")
        } else if (!onPlanUygun(wp, m) || !pencerelerUygun(wp, m) || wp.kok != wg.kok) {
            ihlal(b, "[kural 12] görüntüden sonra ön plan ya da pencere değişti, resim atılmadı: ${wg.ozet()} -> ${wp.ozet()}")
        }
        val g = goruntu
        if (g !is GoruntuSonucu.Tamam || g.siyahOrani >= CekirdekSinirlari.SIYAH_ESIGI) {
            ihlal(b, "[değişmez] korumalı, siyah ya da başarısız görüntü resim olarak döndü")
        } else if (KiJson.metin(c.yuk?.get("image_base64")) != g.base64) {
            ihlal(b, "dönen resim porttan gelen değil")
        }
    }

    private fun elementlerDenetimi(b: MtBaglam, c: KiCikti) {
        sayac.elementler++
        val m = b.model
        if (!b.baslangicGecerli || m == null) {
            ihlal(b, "[değişmez] geçersiz izinle düğümler döndü")
            return
        }
        val we = b.elementlerDunyasi ?: run {
            ihlal(b, "elementler okunmadan düğüm döndü")
            return
        }
        if (!onPlanUygun(we, m)) ihlal(b, "[değişmez] izin dışı ön planda düğümler döndü: ${we.ozet()}")
        if (bankaGorunur(we)) ihlal(b, "[değişmez] [banka] banka ön plandayken düğümler döndü: ${we.ozet()}")
        for (e in c.elementler()) {
            val ad = KiJson.metin(e["ad"])
            val d = okuma.dugumler.firstOrNull { it.ad == ad }
            if (d == null) {
                ihlal(b, "tanınmayan düğüm döndü")
                continue
            }
            if (!izinli(d.paket, m)) ihlal(b, "[değişmez] izin dışı paket düğümü döndü: ${d.paket}")
            if (d.paket in BANKALAR) ihlal(b, "[değişmez] [banka] banka düğümü döndü: ${d.paket}")
            if (parolaMi(d) && e.containsKey("deger")) ihlal(b, "[değişmez] parola alanının değeri döndü")
            if (d.parola && KiJson.mantik(e["password"]) != true) ihlal(b, "parola alanı password:true değil")
        }
    }

    private fun baslikDenetimi(b: MtBaglam, c: KiCikti) {
        val bs = c.baslik ?: return
        if (bs.isEmpty()) return
        val m = b.model
        val p = c.paket
        val uygun = b.baslangicGecerli && m != null && izinli(p, m) && KiPaket.durum(p) == UygulamaDurumu.ACIK && bs == "Baslik $p"
        if (!uygun) ihlal(b, "[değişmez] izin dışı ön planın başlığı yollandı: paket=$p")
        if (p in BANKALAR) ihlal(b, "[değişmez] [banka] banka başlığı yollandı: paket=$p")
    }

    private fun grantRevokedIsle(b: MtBaglam, g: String?, n: String?) {
        val m = g?.let { modeller[it] }
        if (m == null) {
            ihlal(b, "bilinmeyen izin için grant_revoked")
            return
        }
        when (n) {
            GrantNedeni.BUTCE_BITTI.kablo -> if (m.eylem < m.butce) ihlal(b, "[bütçe] eylemler bütçeyi bitirmeden butce_bitti (${m.eylem}/${m.butce})")
            GrantNedeni.SURESI_BITTI.kablo -> if (saat.monotonikMs() < m.bitis) ihlal(b, "süresi dolmadan suresi_bitti")
            else -> ihlal(b, "komut işleyiciden beklenmeyen grant_revoked nedeni: $n")
        }
    }

    private fun butceDenetimi(b: MtBaglam) {
        for (a in izinler.aktifler()) {
            val m = modeller[a.kayit.grantId] ?: continue
            val beklenen = m.butce - m.eylem
            if (a.kayit.kalanButce != beklenen) {
                ihlal(b, "[bütçe] kalan ${a.kayit.kalanButce}, beklenen $beklenen (${m.butce} bütçe, ${m.eylem} eylem): ret/okuma bütçe yedi ya da eylem düşmedi")
                butceIhlaliVar = true
                return
            }
        }
    }

    private fun zamanlamaDenetimi() {
        val ez = eylem.zamanlar
        for (i in 1 until ez.size) {
            if (ez[i] - ez[i - 1] < CekirdekSinirlari.EYLEM_ARASI_MS) {
                ihlal(null, "[aralık] iki eylem arası ${ez[i] - ez[i - 1]} ms")
                break
            }
        }
        val gz = ekran.goruntuZamanlari
        for (i in 1 until gz.size) {
            if (gz[i] - gz[i - 1] < CekirdekSinirlari.GORUNTU_ARASI_MS) {
                ihlal(null, "[aralık] iki görüntü arası ${gz[i] - gz[i - 1]} ms")
                break
            }
        }
    }

    private companion object {
        const val G = SahteEkran.GENISLIK
        const val Y = SahteEkran.YUKSEKLIK
        const val JETON_ALFABESI = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        const val YANLIS_JETON = "yanlisJetonYanlisJetonYanlisJetonYanlis0000"
        val SAYI = Regex("^-?\\d+(\\.\\d+)?$")
        val ACIK_HAVUZ = listOf(KiPaket.MESAJ, KiPaket.HARITA, KiPaket.NOTLAR)

        /** Fikstürde hiçbir bankanın aynı imzalı ACIK kararı yok: kural 3 ve 5'le ikisi de hiç porta ulaşmamalı. */
        val BANKALAR = setOf(KiPaket.BANKA, KiPaket.ZIRAAT)
        val METIN_HAVUZU = listOf("Geliyorum", "Görüşürüz", "Tamam", "Yolda")
        val ON_PLAN_HAVUZU = listOf(
            KiPaket.MESAJ, KiPaket.HARITA, KiPaket.NOTLAR, KiPaket.BANKA, KiPaket.ZIRAAT, KiPaket.YENI, KiPaket.DEGISTI,
            KiPaket.KLAVYE, KiPaket.BASLATICI, KiPaket.AYARLAR, KiPaket.SYSTEMUI, KiPaket.KENDI, KiPaket.KURULMAMIS, null,
        )
        val UYUSMAZ_HAVUZU = listOf(
            KiPaket.MESAJ, KiPaket.HARITA, KiPaket.NOTLAR, KiPaket.BANKA, KiPaket.ZIRAAT, KiPaket.KLAVYE, KiPaket.SYSTEMUI,
        )
        val ACILACAK_HAVUZ = listOf(
            KiPaket.MESAJ, KiPaket.HARITA, KiPaket.NOTLAR, KiPaket.BANKA, KiPaket.ZIRAAT, KiPaket.YENI, KiPaket.DEGISTI,
            KiPaket.AYARLAR, KiPaket.KENDI, KiPaket.KLAVYE, KiPaket.KURULMAMIS, KiPaket.BASLATICI,
        )
        val URL_HAVUZU = listOf(
            "https://ornek.com/x", "intent:#Intent;component=com.example.banka/.Ana;end", "market://details?id=com.example.yeni",
            "com.example.mesaj/.Ana", "file:///sdcard/x",
        )
        val TEHLIKELI = listOf("Gönder", "GÖNDER", "Gö​nder", "Sil", "Öde", "Send", "Delete")
        val GUVENLI = listOf("Gelen kutusu", "Profil", "Menü", "Liste")
        val PAROLA_IPUCLARI = listOf("PIN", "Şifre", "OTP kodu")
        val KATMAN_TURLERI = PencereTuru.entries.filter { it != PencereTuru.DURUM_CUBUGU && it != PencereTuru.GEZINTI_CUBUGU }
        val YASAK_PENCERELER = setOf(
            PencereTuru.PERDE, PencereTuru.HEADS_UP, PencereTuru.KLAVYE, PencereTuru.BALON, PencereTuru.PIP, PencereTuru.BILINMIYOR,
        )
        val EKRAN_OLAYLARI = listOf("durum", "anlik", "elementler", "dugum", "odak", "goruntu")
        val ERKEN_OLMAZ = setOf(
            DeniedNeden.IZIN_YOK, DeniedNeden.JETON_YANLIS, DeniedNeden.ERISILEBILIRLIK_KAPALI, DeniedNeden.KILIT_EKRANI,
            DeniedNeden.MESGUL, DeniedNeden.GECERSIZ_ARG, DeniedNeden.DESTEKLENMEYEN_KOMUT, DeniedNeden.URL_INTENT_YASAK,
        )
        val AD_AGIRLIK = listOf(
            CmdAdi.FOREGROUND to 6, CmdAdi.ELEMENTS to 8, CmdAdi.SCREENSHOT to 8, CmdAdi.ZOOM to 4, CmdAdi.CLICK to 20,
            CmdAdi.TYPE_TEXT to 14, CmdAdi.KEY to 8, CmdAdi.SCROLL to 10, CmdAdi.DRAG to 5, CmdAdi.WAIT to 3, CmdAdi.OPEN_APP to 8,
        )

        fun j(s: String): String = SahtePc.j(s)

        fun nesne(alanlar: Map<String, String>): String =
            "{" + alanlar.entries.joinToString(",") { "\"${it.key}\":${it.value}" } + "}"
    }
}
