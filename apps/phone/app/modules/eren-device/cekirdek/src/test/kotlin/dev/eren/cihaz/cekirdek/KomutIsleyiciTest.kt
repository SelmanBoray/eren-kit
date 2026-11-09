package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.text.Normalizer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/*
 * KomutIsleyici uçtan uca: gerçek Sema, Izinler, Listeler, Kapi, DenetimKaydi; sahte portlar. Beklentiler
 * TASARIM.md "Kapı kural sırası", CIHAZ.md ve GUVENLIK.md'den yazıldı, üretimin o anki hâlinden değil.
 * Her `isle` çağrısı `KiOrtakDenetim`'den geçer: jeton, parola değeri, izin dışı başlık, sonuç tutarlılığı,
 * komut başına bir denetim satırı. "GIZLI" ve "PAROLA-DEGERI" içeren her metin hiçbir çıktıda görünmemelidir.
 */

// ---------------------------------------------------------------------------------------------
// Ortak düzenek (KomutIsleyiciMutasyonTest de kullanır)
// ---------------------------------------------------------------------------------------------

internal const val KI_GIZLI = "GIZLI"
internal const val KI_PAROLA = "PAROLA-DEGERI"

internal object KiPaket {
    const val MESAJ = "com.example.mesaj"
    const val HARITA = "com.example.harita"
    const val NOTLAR = "com.example.notlar"
    const val KLAVYE = "com.example.klavye"
    const val BANKA = "com.example.banka"
    const val YENI = "com.example.yeni"
    const val DEGISTI = "com.example.degisti"
    const val BASLATICI = "com.example.baslatici"
    const val KURULMAMIS = "com.example.kurulmamis"
    const val AYARLAR = "com.android.settings"
    const val SYSTEMUI = "com.android.systemui"
    const val KENDI = "dev.eren.app"

    /** Testin kendi durum modeli; üretimdeki `Listeler`'e bakmadan beklentiyi kurar. */
    val ACIKLAR: Set<String> = setOf(MESAJ, HARITA, NOTLAR, KLAVYE)
    val DEGISMEZLER: List<String> = listOf(
        AYARLAR, "com.android.vending", "com.google.android.packageinstaller", "com.android.packageinstaller",
        "com.google.android.permissioncontroller", "com.android.permissioncontroller", "com.miui.securitycenter",
        "com.tailscale.ipn", SYSTEMUI, KENDI, BASLATICI,
    )

    fun durum(paket: String?): UygulamaDurumu {
        if (paket == null) return UygulamaDurumu.YENI
        if (paket in DEGISMEZLER) return UygulamaDurumu.DEGISMEZ
        if (paket == BANKA) return UygulamaDurumu.HASSAS
        if (paket in ACIKLAR) return UygulamaDurumu.ACIK
        return UygulamaDurumu.YENI
    }

    fun girdi(): ListeGirdisi = ListeGirdisi(
        kurulu = listOf(
            KuruluUygulama(MESAJ, "Mesajlar", "i-mesaj"),
            KuruluUygulama(HARITA, "Harita", "i-harita"),
            KuruluUygulama(NOTLAR, "Notlar", "i-notlar"),
            KuruluUygulama(KLAVYE, "Klavye", "i-klavye"),
            KuruluUygulama(BANKA, "Banka", "i-banka"),
            KuruluUygulama(YENI, "Yeni", "i-yeni"),
            KuruluUygulama(DEGISTI, "Degisti", "i-degisti-yeni"),
            KuruluUygulama(BASLATICI, "Baslatici", "i-baslatici"),
        ),
        kararlar = mapOf(
            MESAJ to KullaniciKarari(UygulamaDurumu.ACIK, "i-mesaj"),
            HARITA to KullaniciKarari(UygulamaDurumu.ACIK, "i-harita"),
            NOTLAR to KullaniciKarari(UygulamaDurumu.ACIK, "i-notlar"),
            KLAVYE to KullaniciKarari(UygulamaDurumu.ACIK, "i-klavye"),
            BANKA to KullaniciKarari(UygulamaDurumu.HASSAS, "i-banka"),
            // Kullanıcı açık demiş ama imza o günden beri değişti: yeniden "yeni".
            DEGISTI to KullaniciKarari(UygulamaDurumu.ACIK, "i-degisti-eski"),
            // Intent çözümüyle değişmez: kullanıcı kararı bunu açamaz.
            BASLATICI to KullaniciKarari(UygulamaDurumu.ACIK, "i-baslatici"),
        ),
        cozulenDegismez = setOf(BASLATICI),
    )
}

internal object KiJson {
    fun metin(d: JsonDeger?): String? = (d as? JsonDeger.Metin)?.deger
    fun mantik(d: JsonDeger?): Boolean? = (d as? JsonDeger.Mantik)?.deger
    fun nesne(d: JsonDeger?): Map<String, JsonDeger>? = (d as? JsonDeger.Nesne)?.alanlar
    fun dizi(d: JsonDeger?): List<JsonDeger>? = (d as? JsonDeger.Dizi)?.ogeler
    fun tam(d: JsonDeger?): Long? = (d as? JsonDeger.Tam)?.deger
    fun sayi(d: JsonDeger?): Double? = when (d) {
        is JsonDeger.Tam -> d.deger.toDouble()
        is JsonDeger.Ondalik -> d.deger
        else -> null
    }
}

/** `isle`'nin döndürdüğü çerçeveler, çözülmüş. Çözülemeyen çerçeve test hatasıdır. */
internal class KiCikti(val ham: List<String>) {
    val kareler: List<Map<String, JsonDeger>> = ham.map { kare ->
        val s = Json.coz(kare)
        if (s !is JsonSonucu.Tamam) throw AssertionError("giden çerçeve geçerli JSON değil")
        KiJson.nesne(s.deger) ?: throw AssertionError("giden çerçeve nesne değil")
    }
    val turler: List<String?> = kareler.map { KiJson.metin(it["type"]) }
    val sonuclar: List<Map<String, JsonDeger>> = kareler.filter { KiJson.metin(it["type"]) == "cmd_result" }
    val sonuc: Map<String, JsonDeger>? = sonuclar.singleOrNull()
    val cmdId: String? = KiJson.metin(sonuc?.get("cmd_id"))
    val ok: Boolean? = KiJson.mantik(sonuc?.get("ok"))
    val denied: String? = KiJson.metin(sonuc?.get("denied"))
    val hata: String? = KiJson.metin(sonuc?.get("hata"))
    val deniedNeden: DeniedNeden? = DeniedNeden.entries.firstOrNull { it.kablo == denied }
    val hataNeden: CihazHatasi? = CihazHatasi.entries.firstOrNull { it.kablo == hata }
    val onPlan: Map<String, JsonDeger>? = KiJson.nesne(sonuc?.get("foreground"))
    val baslik: String? = KiJson.metin(onPlan?.get("baslik"))
    val paket: String? = KiJson.metin(onPlan?.get("paket"))
    val yuk: Map<String, JsonDeger>? = KiJson.nesne(sonuc?.get("payload"))
    val yukTuru: String? = KiJson.metin(yuk?.get("kind"))
    val geriCekilenler: List<Pair<String?, String?>> = kareler
        .filter { KiJson.metin(it["type"]) == "grant_revoked" }
        .map { KiJson.metin(it["grant_id"]) to KiJson.metin(it["neden"]) }
    val tumu: String = ham.joinToString("\n")

    fun elementler(): List<Map<String, JsonDeger>> =
        KiJson.dizi(yuk?.get("elements")).orEmpty().mapNotNull { KiJson.nesne(it) }

    override fun toString(): String = tumu
}

/** Her komutta geçerli olan iddialar; sorun listesi döner (boş = temiz). */
internal object KiOrtakDenetim {
    private val PAKET = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")
    private val TURLER: Set<String?> = setOf("cmd_result", "grant_revoked", "error")

    fun sorunlar(c: KiCikti, jetonlar: Collection<String>, yeniSatirlar: List<DenetimSatiri>): List<String> {
        val s = ArrayList<String>()
        for (t in c.turler) if (t !in TURLER) s += "beklenmeyen giden çerçeve türü: $t"
        if (c.sonuclar.size > 1) s += "birden çok cmd_result"
        for (j in jetonlar) if (j.isNotEmpty() && c.tumu.contains(j)) s += "giden çerçevede jeton var"
        if (c.tumu.contains(KI_GIZLI)) s += "giden çerçevede gizli metin (izin dışı başlık, istisna metni ya da düğüm)"
        if (c.tumu.contains(KI_PAROLA)) s += "giden çerçevede parola değeri"
        val r = c.sonuc
        if (r != null) {
            when (c.ok) {
                true -> if (c.denied != null || c.hata != null) s += "ok:true ile denied/hata"
                false -> {
                    if (r.containsKey("payload")) s += "ok:false ile payload"
                    if ((c.denied == null) == (c.hata == null)) s += "ok:false ama denied ile hata'dan tam biri yok"
                }
                null -> s += "cmd_result'ta ok yok"
            }
            if (c.denied != null && c.deniedNeden == null) s += "kapalı liste dışı denied: ${c.denied}"
            if (c.hata != null && c.hataNeden == null) s += "kapalı liste dışı hata: ${c.hata}"
            if (!r.containsKey("foreground")) s += "cmd_result'ta foreground alanı yok"
            if (c.baslik != null && c.baslik.isNotEmpty() && (c.paket == null || c.paket !in KiPaket.ACIKLAR)) {
                s += "açık olmayan pakette başlık dolu: ${c.paket}"
            }
        }
        for ((_, n) in c.geriCekilenler) if (GrantNedeni.entries.none { it.kablo == n }) s += "grant_revoked nedeni kapalı liste dışı"
        val komutlar = yeniSatirlar.filter { it.olay == DenetimOlayi.KOMUT }
        if (r != null) {
            // Eşzamanlı ikinci komutun satırı da bu aralığa düşebilir: yalnız bu komutunkiler sayılır.
            val benim = komutlar.filter { it.cmdId == c.cmdId }
            if (benim.size != 1) {
                s += "komut başına tam bir denetim satırı yok: ${benim.size}"
            } else {
                val d = benim[0]
                if (d.denied?.kablo != c.denied) s += "denetim satırının denied'ı sonuçla aynı değil: ${d.denied} / ${c.denied}"
                if (d.hata?.kablo != c.hata) s += "denetim satırının hata'sı sonuçla aynı değil: ${d.hata} / ${c.hata}"
            }
        } else if (komutlar.size > 1) {
            s += "bir çerçeve için birden çok denetim satırı"
        }
        for (d in yeniSatirlar) {
            val alanlar = listOf(d.grantId, d.cmdId, d.paket)
            for (j in jetonlar) if (j.isNotEmpty() && alanlar.any { it?.contains(j) == true }) s += "denetim satırında jeton"
            if (d.paket != null && !PAKET.matches(d.paket)) s += "denetim satırında paket adı olmayan metin"
        }
        return s
    }
}

/** `SahteEkran`'ın önüne: çağrı günlüğü, çağrı öncesi kanca, istisna enjeksiyonu, görüntü zamanları. */
internal class KiEkran(val ic: SahteEkran, private val saat: SaatPortu) : EkranPortu {
    private val kilit = Any()
    private val gecmis = ArrayList<String>()
    private val goruntuAnlari = ArrayList<Long>()

    /** Kayıttan sonra, gerçek okumadan önce çalışır (dünyayı değiştirmek için). */
    @Volatile
    var once: ((String) -> Unit)? = null

    @Volatile
    var istisna: (String) -> Throwable? = { null }

    /** `anlik` okuması döndükten hemen sonra: okunan anlık eskidir, dünya artık başkadır. */
    @Volatile
    var anlikSonrasi: (() -> Unit)? = null

    val olaylar: List<String> get() = synchronized(kilit) { ArrayList(gecmis) }

    val goruntuZamanlari: List<Long> get() = synchronized(kilit) { ArrayList(goruntuAnlari) }

    fun temizle() {
        synchronized(kilit) { gecmis.clear() }
    }

    private fun gir(ad: String) {
        val an = saat.monotonikMs()
        synchronized(kilit) {
            gecmis.add(ad)
            if (ad == "goruntu") goruntuAnlari.add(an)
        }
        once?.invoke(ad)
        istisna(ad)?.let { throw it }
    }

    override fun durum(): CihazDurumu {
        gir("durum")
        return ic.durum()
    }

    // Anlık her okumada taze damgalanır: bayat sayılıp reddedilmesin.
    override fun anlik(): AnlikDurum {
        gir("anlik")
        val a = ic.anlik().copy(alinmaMonotonikMs = saat.monotonikMs())
        anlikSonrasi?.invoke()
        return a
    }

    override fun elementler(): ElementOkumasi {
        gir("elementler")
        return ic.elementler()
    }

    override fun dugum(no: Int): DugumBaglami? {
        gir("dugum")
        return ic.dugum(no)
    }

    override fun odak(): DugumBaglami? {
        gir("odak")
        return ic.odak()
    }

    override fun goruntu(bolge: Dikdortgen?): GoruntuSonucu {
        gir("goruntu")
        return ic.goruntu(bolge)
    }
}

/** `SahteEylem`'in önüne: her eylemin monotonik anı. */
internal class KiEylem(val ic: SahteEylem, private val saat: SaatPortu) : EylemPortu {
    private val kilit = Any()
    private val anlar = ArrayList<Long>()

    val zamanlar: List<Long> get() = synchronized(kilit) { ArrayList(anlar) }

    private fun <T> kaydet(f: () -> T): T {
        val an = saat.monotonikMs()
        synchronized(kilit) { anlar.add(an) }
        return f()
    }

    override fun dugumeDokun(no: Int, tiklama: Int, uzun: Boolean): EylemSonucu = kaydet { ic.dugumeDokun(no, tiklama, uzun) }

    override fun noktayaDokun(nokta: Nokta, tiklama: Int, uzun: Boolean): EylemSonucu =
        kaydet { ic.noktayaDokun(nokta, tiklama, uzun) }

    override fun metinYaz(no: Int, metin: String): EylemSonucu = kaydet { ic.metinYaz(no, metin) }

    override fun tus(tus: Tus, tekrar: Int): EylemSonucu = kaydet { ic.tus(tus, tekrar) }

    override fun kaydir(yon: KaydirmaYonu, miktar: Int?, nokta: Nokta?): EylemSonucu = kaydet { ic.kaydir(yon, miktar, nokta) }

    override fun surukle(bas: Nokta, son: Nokta): EylemSonucu = kaydet { ic.surukle(bas, son) }

    override fun uygulamaAc(paket: String): EylemSonucu = kaydet { ic.uygulamaAc(paket) }
}

/** `SahteSaat`'in önüne: her `uyu`'dan sonra kanca (bekleme sırasında dünya değişir). */
internal class KiSaat(val ic: SahteSaat) : SaatPortu {
    @Volatile
    var kanca: ((Long) -> Unit)? = null

    override fun monotonikMs(): Long = ic.monotonikMs()

    override fun duvarMs(): Long = ic.duvarMs()

    override fun uyu(ms: Long) {
        ic.uyu(ms)
        kanca?.invoke(ms)
    }
}

/** Bir komut işleyici ve bütün bağımlılıkları; testler bunu kurar. */
internal class KiTezgah(tohum: Long = 1L) {
    val k = SahteKurulum(tohum)
    val saat: SahteSaat get() = k.saat
    val sahteEkran: SahteEkran get() = k.ekran
    val sahteEylem: SahteEylem get() = k.eylem
    val ekran = KiEkran(k.ekran, k.saat)
    val eylem = KiEylem(k.eylem, k.saat)
    val saatPortu = KiSaat(k.saat)
    val denetim: DenetimKaydi = denetimKaydiKur.kur(k.denetim, k.saat)
    val izinler: Izinler = izinlerKur.kur(k.saat, k.rastgele, k.denetim, denetim)
    val listeler: Listeler = listelerKur.kur(KiPaket.KENDI, KiPaket.girdi())

    @Volatile
    var pcFarki: Long? = 0L

    @Volatile
    var baglanti: Long = 1L

    val oturum = object : OturumBilgisi {
        override fun pcSimdiMs(): Long? = pcFarki?.let { k.saat.duvarMs() + it }

        override fun baglantiNo(): Long = baglanti
    }
    val isleyici: KomutIsleyici = komutIsleyiciKur.kur(ekran, eylem, saatPortu, izinler, listeler, denetim, oturum)
    private val verilenler = ArrayList<IzinKaydi>()
    private var sira = 0

    init {
        k.ekran.dugumler[5] = SahteEkran.baglam(SahteEkran.dugum(5, KiPaket.MESAJ, ad = "Gelen kutusu"))
        k.ekran.odakBaglami = SahteEkran.baglam(
            SahteEkran.dugum(7, KiPaket.MESAJ, rol = "edit", ad = "Mesaj", duzenlenebilir = true),
        )
    }

    val jetonlar: List<String> get() = verilenler.map { it.token } + SahtePc.JETON

    fun izinVer(
        mod: IzinModu = IzinModu.OKU,
        paketler: List<String> = listOf(KiPaket.MESAJ),
        metinler: List<String> = emptyList(),
        serbest: Boolean = false,
        sureMs: Long = CekirdekSinirlari.OKUMA_SURESI_MS,
        butce: Int = CekirdekSinirlari.OKUMA_BUTCESI,
    ): IzinKaydi {
        val onay = OnayliIzin(
            planId = "plan-1",
            planHash = "a".repeat(64),
            mod = mod,
            uygulamalar = paketler.map { IzinliUygulama(it, "Uygulama") },
            izinliMetin = metinler,
            serbestMetin = serbest,
            sureMs = sureMs,
            butce = butce,
        )
        val kayit = requireNotNull(izinler.ekle(onay)) { "test kurulumu: izin eklenemedi" }
        verilenler += kayit
        return kayit
    }

    fun pcSimdi(): Long = k.saat.duvarMs() + (pcFarki ?: 0L)

    fun cmd(
        izin: IzinKaydi?,
        name: String,
        args: String = "{}",
        cmdId: String = "c${++sira}",
        grantId: String = izin?.grantId ?: "gBilinmeyen",
        token: String = izin?.token ?: SahtePc.JETON,
        deadlineMs: Long = pcSimdi() + 30_000L,
        ekAlanlar: String = "",
    ): String = k.pc.cmd(cmdId, grantId, token, deadlineMs, name, args, ekAlanlar)

    fun isle(ham: String): KiCikti {
        val once = k.denetim.satirlar.size
        val c = KiCikti(isleyici.isle(ham))
        c.ham.forEach(SahteCikti::ekle)
        val sorunlar = KiOrtakDenetim.sorunlar(c, jetonlar, k.denetim.satirlar.drop(once))
        assertTrue(sorunlar.isEmpty()) { "ortak denetim: $sorunlar\nçıktı: $c" }
        return c
    }

    fun butce(izin: IzinKaydi): Int? =
        izinler.aktifler().firstOrNull { it.kayit.grantId == izin.grantId }?.kayit?.kalanButce

    private fun butceler(): Map<String, Int> = izinler.aktifler().associate { it.kayit.grantId to it.kayit.kalanButce }

    fun tamam(ham: String): KiCikti {
        val c = isle(ham)
        assertEquals(true, c.ok) { "ok:true beklendi: $c" }
        return c
    }

    /** Ret: `denied` verilenlerden biri, eylem portu çağrılmaz, hiçbir iznin bütçesi düşmez. */
    fun ret(ham: String, vararg nedenler: DeniedNeden): KiCikti {
        val eylemOnce = k.eylem.cagrilar.size
        val butceOnce = butceler()
        val c = isle(ham)
        assertEquals(false, c.ok) { "ret beklendi: $c" }
        val gelen = c.deniedNeden
        assertTrue(gelen != null && gelen in nedenler) { "beklenen ${nedenler.toList()}, gelen ${c.denied}/${c.hata}" }
        assertEquals(eylemOnce, k.eylem.cagrilar.size) { "ret dalında eylem portu çağrıldı: ${k.eylem.cagrilar}" }
        for ((g, b) in butceler()) butceOnce[g]?.let { assertEquals(it, b) { "ret bütçe yedi" } }
        return c
    }

    /** Nedeni ne olursa olsun: `ok:false`, eylem yok, bütçe düşmez. */
    fun olmaz(ham: String): KiCikti {
        val eylemOnce = k.eylem.cagrilar.size
        val butceOnce = butceler()
        val c = isle(ham)
        assertEquals(false, c.ok) { "ok:false beklendi: $c" }
        assertEquals(eylemOnce, k.eylem.cagrilar.size) { "eylem portu çağrıldı: ${k.eylem.cagrilar}" }
        for ((g, b) in butceler()) butceOnce[g]?.let { assertEquals(it, b) { "eylemsiz komut bütçe yedi" } }
        return c
    }

    /** Kural 1-7 reddi: ekran içeriği hiç okunmaz, `foreground` null. */
    fun erkenRet(ham: String, neden: DeniedNeden, durumOkunabilir: Boolean = false): KiCikti {
        ekran.temizle()
        val c = ret(ham, neden)
        val izinli = if (durumOkunabilir) setOf("durum") else emptySet()
        assertTrue(ekran.olaylar.all { it in izinli }) { "kural 1-7 reddinde ekran okundu: ${ekran.olaylar}" }
        assertNull(c.onPlan) { "kural 1-7 reddinde foreground dolu: $c" }
        return c
    }

    /** Sonraki görüntü 1:1 ölçekli; x,y koordinatı gerçek pikselle aynı olur. */
    fun olcekBirGoruntu(izin: IzinKaydi) {
        k.ekran.goruntuSenaryo(GoruntuSonucu.Tamam("image/jpeg", "QUJD", 1080, 2400, 1.0, 0.0))
        tamam(cmd(izin, "screenshot"))
    }
}

// ---------------------------------------------------------------------------------------------
// Testler
// ---------------------------------------------------------------------------------------------

class KomutIsleyiciTest {
    private val mesaj = KiPaket.MESAJ
    private val gizliBaslik = "$KI_GIZLI-BASLIK"

    private fun onPlan(paket: String?, baslik: String? = gizliBaslik, pencereler: List<Pencere>? = null) =
        SahteEkran.anlikDurum(paket, baslik, 0L, pencereler)

    private val izinliOnPlan: AnlikDurum get() = SahteEkran.anlikDurum(mesaj, "Mesajlar")

    private fun metinArg(m: String) = """{"text":${SahtePc.j(m)}}"""

    // --- İzinli yollar -----------------------------------------------------------------------

    @Test
    fun foregroundIzinliOnPlandaBaslikVerirButceYemez() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        val c = t.tamam(t.cmd(izin, "foreground"))
        assertEquals("Mesajlar", c.baslik)
        assertEquals(mesaj, c.paket)
        assertNull(c.yuk)
        assertTrue(t.sahteEylem.bos)
        assertEquals(5, t.butce(izin))
        val satir = t.k.denetim.olaylar(DenetimOlayi.KOMUT).single()
        assertEquals(CmdAdi.FOREGROUND, satir.komut)
        assertEquals(izin.grantId, satir.grantId)
        assertEquals(mesaj, satir.paket)
        assertNull(satir.denied)
        assertNull(satir.hata)
    }

    private class EylemDurumu(
        val ad: String,
        val mod: IzinModu,
        val name: String,
        val args: String,
        val beklenen: EylemCagrisi,
        val paketler: List<String> = listOf(KiPaket.MESAJ),
        val once: (KiTezgah, IzinKaydi) -> Unit = { _, _ -> },
    )

    @TestFactory
    fun izinliEylemTamBirKezCagrilirVeButceBirDuser(): List<DynamicTest> = listOf(
        EylemDurumu("oku: element tıklama", IzinModu.OKU, "click", """{"element":5}""", EylemCagrisi.DugumeDokun(5, 1, false)),
        EylemDurumu("oku: aşağı kaydırma", IzinModu.OKU, "scroll", """{"direction":"down"}""", EylemCagrisi.Kaydir(KaydirmaYonu.DOWN, null, null)),
        EylemDurumu("oku: yukarı 3", IzinModu.OKU, "scroll", """{"direction":"up","amount":3}""", EylemCagrisi.Kaydir(KaydirmaYonu.UP, 3, null)),
        EylemDurumu(
            "oku: izinli uygulamayı aç", IzinModu.OKU, "open_app", """{"package":"${KiPaket.HARITA}"}""",
            EylemCagrisi.UygulamaAc(KiPaket.HARITA), paketler = listOf(KiPaket.MESAJ, KiPaket.HARITA),
        ),
        EylemDurumu("yaz: izinli metin", IzinModu.YAZ, "type_text", """{"text":"Geliyorum"}""", EylemCagrisi.MetinYaz(7, "Geliyorum")),
        EylemDurumu("yaz: geri tuşu iki kez", IzinModu.YAZ, "key", """{"keys":"back","repeat":2}""", EylemCagrisi.TusBas(Tus.BACK, 2)),
        EylemDurumu("yaz: enter", IzinModu.YAZ, "key", """{"keys":"enter"}""", EylemCagrisi.TusBas(Tus.ENTER, 1)),
        EylemDurumu(
            "yaz: çift ve uzun dokunma", IzinModu.YAZ, "click", """{"element":5,"clicks":2,"long_press":true}""",
            EylemCagrisi.DugumeDokun(5, 2, true),
        ),
        EylemDurumu(
            "yaz: gönder etiketli düğüm (etiket yalnız okuda)", IzinModu.YAZ, "click", """{"element":6}""",
            EylemCagrisi.DugumeDokun(6, 1, false),
            once = { t, _ -> t.sahteEkran.dugumler[6] = SahteEkran.baglam(SahteEkran.dugum(6, KiPaket.MESAJ, ad = "Gönder")) },
        ),
        EylemDurumu(
            "yaz: x,y dokunma", IzinModu.YAZ, "click", """{"x":500,"y":1200}""",
            EylemCagrisi.NoktayaDokun(Nokta(500, 1200), 1, false), once = { t, i -> t.olcekBirGoruntu(i) },
        ),
        EylemDurumu(
            "yaz: sürükleme", IzinModu.YAZ, "drag", """{"x0":10,"y0":900,"x1":10,"y1":200}""",
            EylemCagrisi.Surukle(Nokta(10, 900), Nokta(10, 200)), once = { t, i -> t.olcekBirGoruntu(i) },
        ),
        EylemDurumu(
            "yaz: x,y'li yatay kaydırma", IzinModu.YAZ, "scroll", """{"direction":"left","x":540,"y":1200}""",
            EylemCagrisi.Kaydir(KaydirmaYonu.LEFT, null, Nokta(540, 1200)), once = { t, i -> t.olcekBirGoruntu(i) },
        ),
        EylemDurumu("yaz: kendi uygulamasını aç", IzinModu.YAZ, "open_app", """{"package":"${KiPaket.MESAJ}"}""", EylemCagrisi.UygulamaAc(KiPaket.MESAJ)),
    ).map { d ->
        DynamicTest.dynamicTest(d.ad) {
            val t = KiTezgah()
            val metinler = if (d.mod == IzinModu.YAZ) listOf("Geliyorum") else emptyList()
            val izin = t.izinVer(mod = d.mod, paketler = d.paketler, metinler = metinler, butce = 10)
            d.once(t, izin)
            val onceki = t.sahteEylem.cagrilar.size
            val c = t.tamam(t.cmd(izin, d.name, d.args))
            assertEquals(mesaj, c.paket)
            assertEquals("Mesajlar", c.baslik)
            assertNull(c.yuk)
            assertEquals(listOf(d.beklenen), t.sahteEylem.cagrilar.drop(onceki))
            assertEquals(9, t.butce(izin)) { "izinli eylem bütçeden tam 1 düşmeli" }
            val satir = t.k.denetim.olaylar(DenetimOlayi.KOMUT).last()
            assertEquals(CmdAdi.entries.first { it.kablo == d.name }, satir.komut)
            assertEquals(izin.grantId, satir.grantId)
        }
    }

    @TestFactory
    fun okumaKomutlariEylemPortunuCagirmazButceYemez(): List<DynamicTest> = listOf(
        "foreground" to "{}",
        "elements" to "{}",
        "screenshot" to "{}",
        "zoom" to """{"x0":0,"y0":100,"x1":360,"y1":400}""",
        "wait" to """{"seconds":1.5}""",
    ).map { (ad, args) ->
        DynamicTest.dynamicTest(ad) {
            val t = KiTezgah()
            val izin = t.izinVer(butce = 3)
            val c = t.tamam(t.cmd(izin, ad, args))
            assertTrue(t.sahteEylem.bos)
            assertEquals(3, t.butce(izin))
            when (ad) {
                "screenshot", "zoom" -> assertEquals("image", c.yukTuru)
                "elements" -> assertEquals("elements", c.yukTuru)
                else -> assertNull(c.yuk)
            }
        }
    }

    @Test
    fun waitIstenenSureKadarUyur() {
        val t = KiTezgah()
        val izin = t.izinVer()
        val bas = t.saat.monotonikMs()
        t.tamam(t.cmd(izin, "wait", """{"seconds":1.5}"""))
        assertTrue(t.saat.uyuyanlar.sum() >= 1_500) { "uyunan: ${t.saat.uyuyanlar}" }
        assertTrue(t.saat.monotonikMs() - bas >= 1_500)
        assertTrue(t.sahteEylem.bos)
    }

    // --- Adım 0: çerçeve (hiçbir port çağrılmaz) -----------------------------------------------

    @TestFactory
    fun cerceveRetleriHicbirPortuCagirmaz(): List<DynamicTest> {
        class D(val ad: String, val neden: DeniedNeden, val ham: (KiTezgah, IzinKaydi) -> String)
        return listOf(
            D("shell", DeniedNeden.DESTEKLENMEYEN_KOMUT) { t, i -> t.cmd(i, "shell", """{"cmd":"rm"}""") },
            D("open_url", DeniedNeden.DESTEKLENMEYEN_KOMUT) { t, i -> t.cmd(i, "open_url", """{"url":"https://ornek.com"}""") },
            D("install", DeniedNeden.DESTEKLENMEYEN_KOMUT) { t, i -> t.cmd(i, "install", """{"package":"${KiPaket.YENI}"}""") },
            D("zarfta fazladan url", DeniedNeden.GECERSIZ_ARG) { t, i -> t.cmd(i, "foreground", ekAlanlar = ""","url":"https://ornek.com"""") },
            D("argümanda fazladan alan", DeniedNeden.GECERSIZ_ARG) { t, i -> t.cmd(i, "click", """{"element":5,"url":"x"}""") },
            D("tam sayı alanında 12.5", DeniedNeden.GECERSIZ_ARG) { t, i -> t.cmd(i, "click", """{"element":12.5}""") },
            D("element ile x,y birlikte", DeniedNeden.GECERSIZ_ARG) { t, i -> t.cmd(i, "click", """{"element":5,"x":1,"y":2}""") },
            D("boş metin", DeniedNeden.GECERSIZ_ARG) { t, i -> t.cmd(i, "type_text", """{"text":""}""") },
            D("bilinmeyen tuş", DeniedNeden.GECERSIZ_ARG) { t, i -> t.cmd(i, "key", """{"keys":"power"}""") },
            D("biçimsiz jeton", DeniedNeden.GECERSIZ_ARG) { t, i -> t.cmd(i, "foreground", token = "kisa") },
            D("open_app https", DeniedNeden.URL_INTENT_YASAK) { t, i -> t.cmd(i, "open_app", """{"package":"https://ornek.com"}""") },
            D("open_app intent", DeniedNeden.URL_INTENT_YASAK) { t, i ->
                t.cmd(i, "open_app", """{"package":"intent:#Intent;component=com.example.banka/.Ana;end"}""")
            },
        ).map { d ->
            DynamicTest.dynamicTest(d.ad) {
                val t = KiTezgah()
                val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum"), butce = 4)
                t.ekran.temizle()
                val ham = d.ham(t, izin)
                val c = t.ret(ham, d.neden)
                assertTrue(t.ekran.olaylar.isEmpty()) { "adım 0'da port çağrıldı: ${t.ekran.olaylar}" }
                assertNull(c.onPlan)
                assertEquals(4, t.butce(izin))
            }
        }
    }

    @TestFactory
    fun bozukCercevePortCagirmazIstisnaSizdirmaz(): List<DynamicTest> {
        class D(val ad: String, val ham: (KiTezgah, IzinKaydi) -> String)
        return listOf(
            D("boş metin") { _, _ -> "" },
            D("yarım JSON") { _, _ -> "{" },
            D("sürüm 2") { t, i -> t.cmd(i, "click", """{"element":5}""").replaceFirst("\"v\":1", "\"v\":2") },
            D("yinelenen anahtar") { t, i -> t.cmd(i, "click", """{"element":5}""").dropLast(1) + ""","name":"click"}""" },
            D("1e400") { t, i -> t.cmd(i, "click", """{"element":1e400}""") },
            D("eksi sıfır") { t, i -> t.cmd(i, "click", """{"element":-0}""") },
            D("eşsiz vekil") { t, i -> t.cmd(i, "type_text", """{"text":"\ud800"}""") },
            D("okunamayan cmd_id") { t, i -> t.cmd(i, "click", """{"element":5}""", cmdId = "") },
            D("aşağı yönde grant_issued") { _, i ->
                """{"v":1,"type":"grant_issued","grant_id":"${i.grantId}","token":"${i.token}","plan_id":"plan-1",""" +
                    """"plan_hash":"${"a".repeat(64)}","mod":"yaz","uygulamalar":["${KiPaket.BANKA}"],"kalan_ms":3600000,"butce":300}"""
            },
        ).map { d ->
            DynamicTest.dynamicTest(d.ad) {
                val t = KiTezgah()
                val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum"), butce = 4)
                t.ekran.temizle()
                val c = t.isle(d.ham(t, izin))
                assertTrue(t.ekran.olaylar.isEmpty()) { "bozuk çerçevede port çağrıldı: ${t.ekran.olaylar}" }
                assertTrue(t.sahteEylem.bos)
                assertTrue(c.sonuclar.none { KiJson.mantik(it["ok"]) == true }) { "bozuk çerçeveye ok:true: $c" }
                assertEquals(4, t.butce(izin))
            }
        }
    }

    // --- Kural 1-5: yalnız bellek ve saat ------------------------------------------------------

    @Test
    fun deadlinePcSaatiyleVeYalnizTazelikIcinDenetlenir() {
        val t = KiTezgah()
        val izin = t.izinVer()
        // CIHAZ.md: pcSimdi > deadline ise reddedilir; eşitlik geçer.
        t.tamam(t.cmd(izin, "foreground", deadlineMs = t.pcSimdi()))
        t.erkenRet(t.cmd(izin, "click", """{"element":5}""", deadlineMs = t.pcSimdi() - 1), DeniedNeden.DEADLINE_GECTI)
        // Telefon saatine göre 30 sn var ama PC saati 60 sn ileride.
        t.pcFarki = 60_000L
        t.erkenRet(t.cmd(izin, "click", """{"element":5}""", deadlineMs = t.saat.duvarMs() + 30_000L), DeniedNeden.DEADLINE_GECTI)
        // Doğrulanmış bağlantı yok: PC saati bilinmiyor.
        t.pcFarki = null
        t.erkenRet(t.cmd(izin, "foreground", deadlineMs = t.saat.duvarMs() + 30_000L), DeniedNeden.DEADLINE_GECTI)
        t.pcFarki = 0L
        // Sıra: deadline izin_yok'tan önce.
        t.erkenRet(t.cmd(null, "click", """{"element":5}""", deadlineMs = t.pcSimdi() - 1), DeniedNeden.DEADLINE_GECTI)
        assertTrue(t.sahteEylem.bos)
    }

    @TestFactory
    fun izinRetleriEkranOkumadanDoner(): List<DynamicTest> {
        class D(val ad: String, val neden: DeniedNeden, val ham: (KiTezgah) -> String)
        fun harfCevir(s: String): String {
            val i = s.indexOfFirst { it.isLetter() }
            if (i < 0) return s + "A"
            val c = s[i]
            return s.substring(0, i) + (if (c.isUpperCase()) c.lowercaseChar() else c.uppercaseChar()) + s.substring(i + 1)
        }
        val tik = """{"element":5}"""
        return listOf(
            D("bilinmeyen izin", DeniedNeden.IZIN_YOK) { t -> t.izinVer(); t.cmd(null, "click", tik) },
            D("geri çekilmiş izin", DeniedNeden.IZIN_GERI_CEKILDI) { t ->
                val i = t.izinVer()
                t.izinler.geriCek(i.grantId, GrantNedeni.KULLANICI_DURDURDU)
                t.cmd(i, "click", tik)
            },
            D("hepsi geri çekildi (grant_id null)", DeniedNeden.IZIN_GERI_CEKILDI) { t ->
                t.izinVer()
                val i = t.izinVer()
                t.izinler.geriCek(null, GrantNedeni.LIMIT_KILIT)
                t.cmd(i, "click", tik)
            },
            D("başka iznin jetonu", DeniedNeden.JETON_YANLIS) { t ->
                val a = t.izinVer()
                val b = t.izinVer()
                t.cmd(a, "click", tik, token = b.token)
            },
            D("jetonun öneki", DeniedNeden.JETON_YANLIS) { t -> val a = t.izinVer(); t.cmd(a, "click", tik, token = a.token.dropLast(1)) },
            D("jetonda harf farkı", DeniedNeden.JETON_YANLIS) { t -> val a = t.izinVer(); t.cmd(a, "click", tik, token = harfCevir(a.token)) },
            D("jetonun sonuna ek", DeniedNeden.JETON_YANLIS) { t -> val a = t.izinVer(); t.cmd(a, "click", tik, token = a.token + "x") },
            D("CIHAZ.md örnek jetonu", DeniedNeden.JETON_YANLIS) { t -> val a = t.izinVer(); t.cmd(a, "click", tik, token = SahtePc.JETON) },
            D("süresi bitmiş", DeniedNeden.IZIN_SURESI_BITTI) { t ->
                val a = t.izinVer(sureMs = 60_000L)
                t.saat.ilerlet(60_000L)
                t.cmd(a, "click", tik)
            },
            D("duvar saati geri alınsa da süresi bitmiş", DeniedNeden.IZIN_SURESI_BITTI) { t ->
                val a = t.izinVer(sureMs = 60_000L)
                t.saat.ilerlet(60_001L)
                t.saat.duvarSapmasi(-3_600_000L)
                t.cmd(a, "click", tik)
            },
            D("jeton süreden önce", DeniedNeden.JETON_YANLIS) { t ->
                val a = t.izinVer(sureMs = 60_000L)
                t.saat.ilerlet(120_000L)
                t.cmd(a, "click", tik, token = a.token.dropLast(2))
            },
        ).map { d ->
            DynamicTest.dynamicTest(d.ad) {
                val t = KiTezgah()
                val ham = d.ham(t)
                t.erkenRet(ham, d.neden)
                assertTrue(t.sahteEylem.bos)
            }
        }
    }

    // --- Kural 6-7 ------------------------------------------------------------------------------

    @Test
    fun erisilebilirlikVeKilitYalnizDurumOkur() {
        val t = KiTezgah()
        val izin = t.izinVer()
        val tik = """{"element":5}"""
        t.sahteEkran.cihaz = CihazDurumu(a11y = false, kilitli = false, adbAcik = false)
        t.erkenRet(t.cmd(izin, "click", tik), DeniedNeden.ERISILEBILIRLIK_KAPALI, durumOkunabilir = true)
        t.sahteEkran.cihaz = CihazDurumu(a11y = true, kilitli = true, adbAcik = false)
        t.erkenRet(t.cmd(izin, "screenshot"), DeniedNeden.KILIT_EKRANI, durumOkunabilir = true)
        t.sahteEkran.cihaz = CihazDurumu(a11y = false, kilitli = true, adbAcik = true)
        t.erkenRet(t.cmd(izin, "elements"), DeniedNeden.ERISILEBILIRLIK_KAPALI, durumOkunabilir = true)
        assertTrue(t.sahteEylem.bos)
        assertEquals(CekirdekSinirlari.OKUMA_BUTCESI, t.butce(izin))
    }

    // --- Kural 8: ön plan ------------------------------------------------------------------------

    @TestFactory
    fun onPlanZinciriTazeAnliktaDenetlenir(): List<DynamicTest> {
        class D(val ad: String, val anlik: AnlikDurum, val neden: DeniedNeden, val paketler: List<String> = listOf(KiPaket.MESAJ))
        val durumlar = ArrayList<D>()
        durumlar += D("hassas", onPlan(KiPaket.BANKA), DeniedNeden.HASSAS_UYGULAMA)
        durumlar += D("hassas izinde olsa da", onPlan(KiPaket.BANKA), DeniedNeden.HASSAS_UYGULAMA, listOf(mesaj, KiPaket.BANKA))
        for (p in KiPaket.DEGISMEZLER) durumlar += D("değişmez $p", onPlan(p), DeniedNeden.DEGISMEZ_RET)
        durumlar += D("değişmez izinde olsa da", onPlan(KiPaket.AYARLAR), DeniedNeden.DEGISMEZ_RET, listOf(mesaj, KiPaket.AYARLAR))
        durumlar += D("yeni", onPlan(KiPaket.YENI), DeniedNeden.YENI_UYGULAMA)
        durumlar += D("imzası değişmiş", onPlan(KiPaket.DEGISTI), DeniedNeden.YENI_UYGULAMA)
        durumlar += D("kurulu değil", onPlan(KiPaket.KURULMAMIS), DeniedNeden.YENI_UYGULAMA)
        durumlar += D("açık ama izin dışı", onPlan(KiPaket.HARITA), DeniedNeden.ON_PLAN_IZIN_DISI)
        durumlar += D("aktif kök uyuşmuyor", onPlan(mesaj).copy(aktifKokPaketi = KiPaket.HARITA), DeniedNeden.ON_PLAN_IZIN_DISI)
        durumlar += D("odak uyuşmuyor", onPlan(mesaj).copy(odakPaketi = KiPaket.HARITA), DeniedNeden.ON_PLAN_IZIN_DISI)
        durumlar += D("son olay uyuşmuyor", onPlan(mesaj).copy(sonOlayPaketi = KiPaket.HARITA), DeniedNeden.ON_PLAN_IZIN_DISI)
        durumlar += D("uyuşmazlık hassastan önce", onPlan(mesaj).copy(aktifKokPaketi = KiPaket.BANKA), DeniedNeden.ON_PLAN_IZIN_DISI)
        durumlar += D("ön plan bilinmiyor", onPlan(null), DeniedNeden.ON_PLAN_IZIN_DISI)
        val testler = ArrayList<DynamicTest>()
        for (d in durumlar) {
            testler += DynamicTest.dynamicTest("click: ${d.ad}") {
                val t = KiTezgah()
                val izin = t.izinVer(paketler = d.paketler)
                t.sahteEkran.anlikSenaryo(d.anlik)
                val c = t.ret(t.cmd(izin, "click", """{"element":5}"""), d.neden)
                assertTrue(c.onPlan == null || c.baslik == "") { "izin dışı ön planda başlık dolu: $c" }
            }
            testler += DynamicTest.dynamicTest("elements: ${d.ad}") {
                val t = KiTezgah()
                val izin = t.izinVer(paketler = d.paketler)
                t.sahteEkran.anlikSenaryo(d.anlik)
                t.sahteEkran.okuma = ElementOkumasi(listOf(SahteEkran.dugum(1, d.anlik.aktifKokPaketi, ad = "$KI_GIZLI-OGE")), false)
                val c = t.ret(t.cmd(izin, "elements"), d.neden)
                assertFalse("elementler" in t.ekran.olaylar) { "izin dışı ön planda düğümler okundu" }
                assertNull(c.yuk)
            }
            testler += DynamicTest.dynamicTest("screenshot: ${d.ad}") {
                val t = KiTezgah()
                val izin = t.izinVer(paketler = d.paketler)
                t.sahteEkran.anlikSenaryo(d.anlik)
                // Ön plan zinciri ile pencere denetiminin göreli sırası belgede yok: ikisi de kabul.
                t.ret(t.cmd(izin, "screenshot"), d.neden, DeniedNeden.IZIN_DISI_PENCERE)
                assertEquals(0, t.sahteEkran.goruntuSayisi) { "reddedilen görüntü portu çağrıldı" }
            }
        }
        return testler
    }

    @TestFactory
    fun openAppZinciriHedefeUygulanir(): List<DynamicTest> = listOf(
        Triple("hassas hedef", KiPaket.BANKA, DeniedNeden.HASSAS_UYGULAMA),
        Triple("Ayarlar", KiPaket.AYARLAR, DeniedNeden.DEGISMEZ_RET),
        Triple("uygulamanın kendisi", KiPaket.KENDI, DeniedNeden.DEGISMEZ_RET),
        Triple("Play", "com.android.vending", DeniedNeden.DEGISMEZ_RET),
        Triple("yeni", KiPaket.YENI, DeniedNeden.YENI_UYGULAMA),
        Triple("imzası değişmiş", KiPaket.DEGISTI, DeniedNeden.YENI_UYGULAMA),
        Triple("kurulu değil", KiPaket.KURULMAMIS, DeniedNeden.YENI_UYGULAMA),
        Triple("açık ama izin dışı", KiPaket.HARITA, DeniedNeden.ON_PLAN_IZIN_DISI),
    ).map { (ad, hedef, neden) ->
        DynamicTest.dynamicTest(ad) {
            val t = KiTezgah()
            val izin = t.izinVer(butce = 5)
            t.ret(t.cmd(izin, "open_app", """{"package":"$hedef"}"""), neden)
            assertEquals(5, t.butce(izin))
        }
    }

    @Test
    fun openAppHassasHedefIzindeOlsaDaReddedilir() {
        val t = KiTezgah()
        val izin = t.izinVer(paketler = listOf(mesaj, KiPaket.BANKA))
        t.ret(t.cmd(izin, "open_app", """{"package":"${KiPaket.BANKA}"}"""), DeniedNeden.HASSAS_UYGULAMA)
    }

    private fun katmanli(vararg ek: Pencere): AnlikDurum =
        SahteEkran.anlikDurum(mesaj, "Mesajlar", 0L, listOf(SahteEkran.uygulamaPenceresi(mesaj, 1)) + ek)

    @TestFactory
    fun ekranGoruntusuIzinDisiPencerede(): List<DynamicTest> {
        val kesin = listOf(
            PencereTuru.PERDE to KiPaket.SYSTEMUI,
            PencereTuru.HEADS_UP to KiPaket.SYSTEMUI,
            PencereTuru.KLAVYE to KiPaket.KLAVYE,
            PencereTuru.BALON to KiPaket.SYSTEMUI,
            PencereTuru.PIP to KiPaket.HARITA,
        )
        val gevsek = listOf(
            PencereTuru.UYGULAMA to KiPaket.HARITA,
            PencereTuru.BILINMIYOR to null,
            PencereTuru.DIGER_SISTEM to KiPaket.SYSTEMUI,
            PencereTuru.ERISILEBILIRLIK_KATMANI to KiPaket.KLAVYE,
        )
        val testler = ArrayList<DynamicTest>()
        for ((tur, paket) in kesin) for (ad in listOf("screenshot", "zoom")) {
            testler += DynamicTest.dynamicTest("$ad: $tur") {
                val t = KiTezgah()
                val izin = t.izinVer()
                t.sahteEkran.anlikSenaryo(katmanli(SahteEkran.sistemPenceresi(tur, paket, 2)))
                val args = if (ad == "zoom") """{"x0":0,"y0":0,"x1":500,"y1":500}""" else "{}"
                t.ret(t.cmd(izin, ad, args), DeniedNeden.IZIN_DISI_PENCERE)
                assertEquals(0, t.sahteEkran.goruntuSayisi) { "izin dışı pencere varken görüntü alındı" }
            }
        }
        for ((tur, paket) in gevsek) {
            testler += DynamicTest.dynamicTest("screenshot: $tur ($paket)") {
                val t = KiTezgah()
                val izin = t.izinVer()
                t.sahteEkran.anlikSenaryo(katmanli(SahteEkran.sistemPenceresi(tur, paket, 2)))
                t.ret(t.cmd(izin, "screenshot"), DeniedNeden.IZIN_DISI_PENCERE, DeniedNeden.ON_PLAN_IZIN_DISI)
                assertEquals(0, t.sahteEkran.goruntuSayisi)
            }
        }
        return testler
    }

    @Test
    fun durumVeGezintiCubuguGoruntuyuEngellemez() {
        val t = KiTezgah()
        val izin = t.izinVer()
        t.sahteEkran.anlikSenaryo(
            katmanli(
                SahteEkran.sistemPenceresi(PencereTuru.DURUM_CUBUGU, KiPaket.SYSTEMUI, 2),
                Pencere(PencereTuru.GEZINTI_CUBUGU, KiPaket.SYSTEMUI, 2, Dikdortgen(0, 2280, 1080, 2400), false, false),
            ),
        )
        val c = t.tamam(t.cmd(izin, "screenshot"))
        assertEquals("image", c.yukTuru)
    }

    @Test
    fun noktaDokunmasiNoktadakiEnUstPencereyeBakar() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum"))
        val durumCubuklu = katmanli(SahteEkran.sistemPenceresi(PencereTuru.DURUM_CUBUGU, KiPaket.SYSTEMUI, 2))
        t.sahteEkran.anlikSenaryo(durumCubuklu)
        t.olcekBirGoruntu(izin)
        // Durum çubuğu (0..120 piksel) systemui'nin: oraya dokunulmaz.
        t.ret(
            t.cmd(izin, "click", """{"x":500,"y":50}"""),
            DeniedNeden.ON_PLAN_IZIN_DISI, DeniedNeden.IZIN_DISI_PENCERE, DeniedNeden.DEGISMEZ_RET,
        )
        // Altında uygulama penceresi var: dokunulur.
        t.tamam(t.cmd(izin, "click", """{"x":500,"y":1200}"""))
        assertEquals(listOf<EylemCagrisi>(EylemCagrisi.NoktayaDokun(Nokta(500, 1200), 1, false)), t.sahteEylem.cagrilar)
        // Heads-up bildirim dokunulan noktanın üstünde.
        t.sahteEkran.anlikSenaryo(
            katmanli(Pencere(PencereTuru.HEADS_UP, KiPaket.SYSTEMUI, 5, Dikdortgen(0, 0, 1080, 400), false, false)),
        )
        t.saat.ilerlet(1_000L)
        t.ret(
            t.cmd(izin, "click", """{"x":500,"y":200}"""),
            DeniedNeden.ON_PLAN_IZIN_DISI, DeniedNeden.IZIN_DISI_PENCERE, DeniedNeden.DEGISMEZ_RET,
        )
        assertEquals(1, t.sahteEylem.cagrilar.size)
    }

    @Test
    fun noktaKoordinatiSonGoruntununOlcegiyleGercekPiksele() {
        // CIHAZ.md: koordinatlar son ekran görüntüsünün pikselidir; Portlar.kt: port gerçek piksel alır.
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum"))
        t.sahteEkran.goruntuSenaryo(SahteEkran.goruntuTamam())
        t.tamam(t.cmd(izin, "screenshot"))
        t.tamam(t.cmd(izin, "click", """{"x":100,"y":200}"""))
        assertEquals(listOf<EylemCagrisi>(EylemCagrisi.NoktayaDokun(Nokta(150, 300), 1, false)), t.sahteEylem.cagrilar)
    }

    @Test
    fun elementDokunmasiTazelenmisDugumePaketiyleBakar() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        t.sahteEkran.dugumler[3] = SahteEkran.baglam(SahteEkran.dugum(3, KiPaket.KLAVYE, ad = "Profil"))
        t.ekran.temizle()
        t.ret(t.cmd(izin, "click", """{"element":3}"""), DeniedNeden.ON_PLAN_IZIN_DISI, DeniedNeden.IZIN_DISI_PENCERE)
        assertTrue("dugum" in t.ekran.olaylar) { "düğüm tazelenmedi" }
        t.sahteEkran.dugumler[4] = SahteEkran.baglam(SahteEkran.dugum(4, null, ad = "Profil"))
        t.ret(t.cmd(izin, "click", """{"element":4}"""), DeniedNeden.ON_PLAN_IZIN_DISI, DeniedNeden.IZIN_DISI_PENCERE)
        // Bayat element: elements'ta vardı, şimdi yok.
        t.sahteEkran.okuma = ElementOkumasi(listOf(SahteEkran.dugum(9, mesaj, ad = "Profil")), false)
        t.tamam(t.cmd(izin, "elements"))
        val c = t.olmaz(t.cmd(izin, "click", """{"element":9}"""))
        assertEquals(CihazHatasi.ELEMENT_BULUNAMADI.kablo, c.hata)
        assertEquals(5, t.butce(izin))
    }

    // --- Kural 9: mod -------------------------------------------------------------------------------

    @TestFactory
    fun yalnizOkuYazmaVeHamDokunmayiReddeder(): List<DynamicTest> {
        class D(val ad: String, val name: String, val args: String, val neden: DeniedNeden, val goruntu: Boolean = false)
        return listOf(
            D("type_text", "type_text", """{"text":"Geliyorum"}""", DeniedNeden.YALNIZ_OKU_YAZMA),
            D("key back", "key", """{"keys":"back"}""", DeniedNeden.YALNIZ_OKU_YAZMA),
            D("key home 3", "key", """{"keys":"home","repeat":3}""", DeniedNeden.YALNIZ_OKU_YAZMA),
            D("x,y dokunma", "click", """{"x":500,"y":1200}""", DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA, goruntu = true),
            D("sürükleme", "drag", """{"x0":10,"y0":900,"x1":10,"y1":200}""", DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA, goruntu = true),
            D("uzun basma", "click", """{"element":5,"long_press":true}""", DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA),
            D("çift dokunma", "click", """{"element":5,"clicks":2}""", DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA),
            D("sola kaydırma", "scroll", """{"direction":"left"}""", DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA),
            D("sağa kaydırma", "scroll", """{"direction":"right","amount":2}""", DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA),
            D("x,y'li aşağı kaydırma", "scroll", """{"direction":"down","x":540,"y":1200}""", DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA, goruntu = true),
        ).map { d ->
            DynamicTest.dynamicTest(d.ad) {
                val t = KiTezgah()
                val izin = t.izinVer(mod = IzinModu.OKU, butce = 5)
                if (d.goruntu) t.olcekBirGoruntu(izin)
                t.ret(t.cmd(izin, d.name, d.args), d.neden)
                assertEquals(5, t.butce(izin))
            }
        }
    }

    @TestFactory
    fun yalnizOkuEtiketliDugumeDokunmaz(): List<DynamicTest> {
        val nfd = Normalizer.normalize("Gönder", Normalizer.Form.NFD)
        val profil = { no: Int -> SahteEkran.dugum(no, KiPaket.MESAJ, ad = "Profil") }
        return listOf(
            "GÖNDER" to SahteEkran.baglam(SahteEkran.dugum(6, KiPaket.MESAJ, ad = "GÖNDER")),
            "görünmez karakterli Gönder" to SahteEkran.baglam(SahteEkran.dugum(6, KiPaket.MESAJ, ad = "Gö​nder")),
            "NFD Gönder" to SahteEkran.baglam(SahteEkran.dugum(6, KiPaket.MESAJ, ad = nfd)),
            "kaynak kimliği btnSend" to SahteEkran.baglam(SahteEkran.dugum(6, KiPaket.MESAJ, ad = "", kaynakId = "com.example.mesaj:id/btnSend")),
            "tıklanabilir atası Sil" to SahteEkran.baglam(profil(6), atalar = listOf(SahteEkran.dugum(60, KiPaket.MESAJ, ad = "Sil", tiklanabilir = true))),
            "torunu Öde" to SahteEkran.baglam(profil(6), torunlar = listOf(SahteEkran.dugum(61, KiPaket.MESAJ, ad = "Öde", tiklanabilir = false))),
        ).map { (ad, baglam) ->
            DynamicTest.dynamicTest(ad) {
                val t = KiTezgah()
                val izin = t.izinVer(mod = IzinModu.OKU, butce = 5)
                t.sahteEkran.dugumler[6] = baglam
                t.ret(t.cmd(izin, "click", """{"element":6}"""), DeniedNeden.YALNIZ_OKU_ETIKET)
                assertEquals(5, t.butce(izin))
            }
        }
    }

    @TestFactory
    fun yazmaParolaAlaninaYazmaz(): List<DynamicTest> {
        val alan = { ipucu: String?, kaynakId: String?, parola: Boolean ->
            SahteEkran.baglam(
                SahteEkran.dugum(7, KiPaket.MESAJ, rol = "edit", ad = "Alan", deger = null, duzenlenebilir = true, parola = parola, ipucu = ipucu, kaynakId = kaynakId),
            )
        }
        class D(val ad: String, val odak: DugumBaglami, val metin: String = "Geliyorum", val serbest: Boolean = false)
        return listOf(
            D("parola bayrağı", alan(null, null, true)),
            D("PIN ipucu", alan("PIN", null, false)),
            D("Şifre ipucu", alan("Şifre", null, false)),
            D("otp kaynak kimliği", alan(null, "com.example.mesaj:id/otp_input", false)),
            D("serbest metin parolayı açmaz", alan(null, null, true), metin = "herhangi", serbest = true),
            D("parola metin kilidinden önce", alan(null, null, true), metin = "izinli olmayan"),
        ).map { d ->
            DynamicTest.dynamicTest(d.ad) {
                val t = KiTezgah()
                val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum"), serbest = d.serbest, butce = 5)
                t.sahteEkran.odakBaglami = d.odak
                t.ret(t.cmd(izin, "type_text", metinArg(d.metin)), DeniedNeden.PAROLA_ALANI)
                assertEquals(5, t.butce(izin))
            }
        }
    }

    @Test
    fun metinKilidiBirebirVeTekKullanimlik() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum", "Görüşürüz"), butce = 10)
        val nfd = Normalizer.normalize("Görüşürüz", Normalizer.Form.NFD)
        assertFalse(nfd == "Görüşürüz")
        val yanlislar = listOf(
            "Geliyorum ", "Geliyorum\n", nfd, "Gеliyorum", "Geliyoru", "geliyorum", "Merhaba", "Geliyorum Görüşürüz",
        )
        for (m in yanlislar) t.ret(t.cmd(izin, "type_text", metinArg(m)), DeniedNeden.METIN_KILIDI)
        assertTrue(t.sahteEylem.bos)
        assertEquals(10, t.butce(izin))
        t.tamam(t.cmd(izin, "type_text", metinArg("Geliyorum")))
        t.saat.ilerlet(300L)
        t.ret(t.cmd(izin, "type_text", metinArg("Geliyorum")), DeniedNeden.METIN_KILIDI)
        t.tamam(t.cmd(izin, "type_text", metinArg("Görüşürüz")))
        assertEquals(
            listOf<EylemCagrisi>(EylemCagrisi.MetinYaz(7, "Geliyorum"), EylemCagrisi.MetinYaz(7, "Görüşürüz")),
            t.sahteEylem.cagrilar,
        )
        assertEquals(8, t.butce(izin))
    }

    @Test
    fun ayniMaddeIkiKezVarsaIkiKezYazilir() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Tamam", "Tamam"), butce = 10)
        t.tamam(t.cmd(izin, "type_text", metinArg("Tamam")))
        t.saat.ilerlet(300L)
        t.tamam(t.cmd(izin, "type_text", metinArg("Tamam")))
        t.saat.ilerlet(300L)
        t.ret(t.cmd(izin, "type_text", metinArg("Tamam")), DeniedNeden.METIN_KILIDI)
        assertEquals(2, t.sahteEylem.cagrilar.size)
    }

    @Test
    fun metinTasimayanYazmaIzniYazmaz() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, metinler = emptyList(), butce = 10)
        t.ret(t.cmd(izin, "type_text", metinArg("Tamam")), DeniedNeden.METIN_KILIDI)
        // Tuş ve dokunma yazma izninde metinsiz de serbest.
        t.tamam(t.cmd(izin, "key", """{"keys":"back"}"""))
    }

    @Test
    fun serbestMetinHerMetniYazar() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, serbest = true, butce = 10)
        t.tamam(t.cmd(izin, "type_text", metinArg("Herhangi bir metin")))
        t.saat.ilerlet(300L)
        t.tamam(t.cmd(izin, "type_text", metinArg("Herhangi bir metin")))
        assertEquals(2, t.sahteEylem.cagrilar.size)
    }

    @Test
    fun odakYoksaYaDaIzinDisiPakettesYazilmaz() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum", "Geliyorum"), butce = 5)
        t.sahteEkran.odakBaglami = null
        val c = t.olmaz(t.cmd(izin, "type_text", metinArg("Geliyorum")))
        assertEquals(CihazHatasi.ELEMENT_BULUNAMADI.kablo, c.hata)
        // Odak klavyenin kendi alanında (ör. klavye içi arama): izinli uygulamaya yazılmıyor.
        t.sahteEkran.odakBaglami = SahteEkran.baglam(
            SahteEkran.dugum(8, KiPaket.KLAVYE, rol = "edit", ad = "Ara", duzenlenebilir = true),
        )
        t.olmaz(t.cmd(izin, "type_text", metinArg("Geliyorum")))
        assertTrue(t.sahteEylem.bos)
        assertEquals(5, t.butce(izin))
    }

    // --- Kural 10: bütçe ----------------------------------------------------------------------------

    @Test
    fun butceBitinceEylemYapilmaz() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 2)
        val geriCekilenler = ArrayList<Pair<String?, String?>>()
        geriCekilenler += t.tamam(t.cmd(izin, "click", """{"element":5}""")).geriCekilenler
        t.saat.ilerlet(300L)
        geriCekilenler += t.tamam(t.cmd(izin, "click", """{"element":5}""")).geriCekilenler
        t.saat.ilerlet(300L)
        // Bütçe bitince izin geri çekilmiş de olabilir (grant_revoked{butce_bitti}); ikisi de ret.
        geriCekilenler += t.ret(t.cmd(izin, "click", """{"element":5}"""), DeniedNeden.BUTCE_DOLDU, DeniedNeden.IZIN_GERI_CEKILDI).geriCekilenler
        assertEquals(2, t.sahteEylem.cagrilar.size)
        for ((g, n) in geriCekilenler) {
            assertEquals(izin.grantId, g)
            assertEquals(GrantNedeni.BUTCE_BITTI.kablo, n)
        }
    }

    @Test
    fun retlerVeOkumalarButceYemez() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.OKU, butce = 3)
        val tik = """{"element":5}"""
        t.ret(t.cmd(izin, "type_text", metinArg("Geliyorum")), DeniedNeden.YALNIZ_OKU_YAZMA)
        t.ret(t.cmd(izin, "key", """{"keys":"back"}"""), DeniedNeden.YALNIZ_OKU_YAZMA)
        t.ret(t.cmd(izin, "click", """{"element":5,"long_press":true}"""), DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA)
        t.ret(t.cmd(izin, "click", tik, token = SahtePc.JETON), DeniedNeden.JETON_YANLIS)
        t.ret(t.cmd(izin, "click", tik, deadlineMs = t.pcSimdi() - 1), DeniedNeden.DEADLINE_GECTI)
        t.ret(t.cmd(izin, "open_app", """{"package":"${KiPaket.BANKA}"}"""), DeniedNeden.HASSAS_UYGULAMA)
        t.olmaz(t.cmd(izin, "click", """{"element":42}"""))
        t.sahteEkran.dugumler[6] = SahteEkran.baglam(SahteEkran.dugum(6, mesaj, ad = "Sil"))
        t.ret(t.cmd(izin, "click", """{"element":6}"""), DeniedNeden.YALNIZ_OKU_ETIKET)
        t.sahteEkran.anlikSenaryo(onPlan(KiPaket.BANKA))
        t.ret(t.cmd(izin, "click", tik), DeniedNeden.HASSAS_UYGULAMA)
        t.sahteEkran.anlikSenaryo(izinliOnPlan, onPlan(KiPaket.HARITA))
        t.ret(t.cmd(izin, "click", tik), DeniedNeden.ON_PLAN_IZIN_DISI)
        t.sahteEkran.anlikSenaryo(izinliOnPlan)
        t.tamam(t.cmd(izin, "foreground"))
        t.tamam(t.cmd(izin, "elements"))
        t.tamam(t.cmd(izin, "screenshot"))
        t.tamam(t.cmd(izin, "wait", """{"seconds":0.5}"""))
        assertTrue(t.sahteEylem.bos)
        assertEquals(3, t.butce(izin)) { "retler ve okumalar bütçe yemez" }
        repeat(3) {
            t.saat.ilerlet(300L)
            t.tamam(t.cmd(izin, "click", tik))
        }
        assertEquals(3, t.sahteEylem.cagrilar.size)
        val kalan = t.butce(izin)
        assertTrue(kalan == null || kalan == 0) { "üç eylemden sonra bütçe 0 olmalı: $kalan" }
    }

    @Test
    fun modDenetimiButcedenOnceGelir() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.OKU, butce = 1)
        t.tamam(t.cmd(izin, "click", """{"element":5}"""))
        t.saat.ilerlet(300L)
        val beklenen = if (t.butce(izin) != null) DeniedNeden.YALNIZ_OKU_YAZMA else DeniedNeden.IZIN_GERI_CEKILDI
        t.ret(t.cmd(izin, "type_text", metinArg("Geliyorum")), beklenen)
    }

    @Test
    fun eylemPortuBasarisizsaHataDonerButceDuser() {
        val t = KiTezgah()
        val izin = t.izinVer(paketler = listOf(mesaj, KiPaket.HARITA), butce = 5)
        t.sahteEylem.sonuc = { EylemSonucu.Basarisiz(CihazHatasi.UYGULAMA_BULUNAMADI) }
        val c = t.isle(t.cmd(izin, "open_app", """{"package":"${KiPaket.HARITA}"}"""))
        assertEquals(false, c.ok)
        assertEquals(CihazHatasi.UYGULAMA_BULUNAMADI.kablo, c.hata)
        assertEquals(1, t.sahteEylem.cagrilar.size)
        assertEquals(4, t.butce(izin)) { "kapıdan geçen eylem denendi: bütçe düşer" }
    }

    // --- Kural 11: eylemden hemen önce yeniden ---------------------------------------------------

    @TestFactory
    fun denetimIleEylemArasindaOnPlanDegisirseEylemYok(): List<DynamicTest> {
        class D(val ad: String, val mod: IzinModu, val name: String, val args: String)
        return listOf(
            D("oku element", IzinModu.OKU, "click", """{"element":5}"""),
            D("oku kaydırma", IzinModu.OKU, "scroll", """{"direction":"down"}"""),
            D("yaz metin", IzinModu.YAZ, "type_text", """{"text":"Geliyorum"}"""),
            D("yaz tuş", IzinModu.YAZ, "key", """{"keys":"back"}"""),
            D("yaz element", IzinModu.YAZ, "click", """{"element":5,"clicks":2}"""),
        ).map { d ->
            DynamicTest.dynamicTest(d.ad) {
                val t = KiTezgah()
                val izin = t.izinVer(mod = d.mod, metinler = if (d.mod == IzinModu.YAZ) listOf("Geliyorum") else emptyList(), butce = 5)
                // İlk okuma izinli, sonrakiler izin dışı paket.
                t.sahteEkran.anlikSenaryo(izinliOnPlan, onPlan(KiPaket.HARITA))
                t.ret(t.cmd(izin, d.name, d.args), DeniedNeden.ON_PLAN_IZIN_DISI)
                assertTrue(t.sahteEkran.anlikSayisi >= 2) { "eylemden önce ön plan yeniden okunmadı" }
                assertEquals(5, t.butce(izin))
            }
        }
    }

    @Test
    fun denetimIleEylemArasindaHedefDugumDegisirseEylemYok() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        var dugumOkuma = 0
        t.ekran.once = { ad ->
            if (ad == "dugum" && ++dugumOkuma == 2) {
                t.sahteEkran.dugumler[5] = SahteEkran.baglam(SahteEkran.dugum(5, KiPaket.KLAVYE, ad = "Profil"))
            }
        }
        t.olmaz(t.cmd(izin, "click", """{"element":5}"""))
        assertTrue(dugumOkuma >= 2) { "eylemden önce hedef düğüm yeniden okunmadı" }
    }

    @Test
    fun denetimIleEylemArasindaOdakParolayaDonerseYazilmaz() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum"), butce = 5)
        var odakOkuma = 0
        t.ekran.once = { ad ->
            if (ad == "odak" && ++odakOkuma == 2) {
                t.sahteEkran.odakBaglami = SahteEkran.baglam(
                    SahteEkran.dugum(7, mesaj, rol = "edit", ad = "Alan", duzenlenebilir = true, parola = true),
                )
            }
        }
        t.olmaz(t.cmd(izin, "type_text", metinArg("Geliyorum")))
        assertTrue(odakOkuma >= 2) { "yazmadan önce odak yeniden okunmadı" }
    }

    @Test
    fun eylemSirasindaDegisenOnPlanSonrakiKomuttaYakalanir() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        t.sahteEylem.sonra = { t.sahteEkran.anlikSenaryo(onPlan(KiPaket.HARITA)) }
        t.tamam(t.cmd(izin, "click", """{"element":5}"""))
        t.saat.ilerlet(300L)
        t.ret(t.cmd(izin, "click", """{"element":5}"""), DeniedNeden.ON_PLAN_IZIN_DISI)
        assertEquals(1, t.sahteEylem.cagrilar.size)
    }

    @Test
    fun eylemOncesiBeklemedeOnPlanDegisirseEylemYok() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        val tetik = AtomicBoolean(false)
        t.saatPortu.kanca = {
            if (t.sahteEylem.cagrilar.size == 1 && tetik.compareAndSet(false, true)) {
                t.sahteEkran.anlikSenaryo(onPlan(KiPaket.HARITA))
            }
        }
        t.tamam(t.cmd(izin, "click", """{"element":5}"""))
        t.ret(t.cmd(izin, "click", """{"element":5}"""), DeniedNeden.ON_PLAN_IZIN_DISI)
        assertTrue(tetik.get()) { "iki eylem arasında bekleme yok" }
        assertEquals(1, t.sahteEylem.cagrilar.size)
        assertEquals(4, t.butce(izin)) { "bekleme sonrası ret bütçe yemez" }
    }

    @Test
    fun eylemOncesiBeklemedeIzinGeriCekilirseEylemYok() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        val tetik = AtomicBoolean(false)
        t.saatPortu.kanca = {
            if (t.sahteEylem.cagrilar.size == 1 && tetik.compareAndSet(false, true)) {
                t.izinler.geriCek(izin.grantId, GrantNedeni.KULLANICI_DURDURDU)
            }
        }
        t.tamam(t.cmd(izin, "click", """{"element":5}"""))
        t.ret(t.cmd(izin, "click", """{"element":5}"""), DeniedNeden.IZIN_GERI_CEKILDI)
        assertTrue(tetik.get()) { "iki eylem arasında bekleme yok" }
        assertEquals(1, t.sahteEylem.cagrilar.size)
    }

    @Test
    fun komutSirasindaIzinGeriCekilirseEylemYok() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        t.ekran.once = { ad -> if (ad == "anlik") t.izinler.geriCek(izin.grantId, GrantNedeni.KULLANICI_DURDURDU) }
        t.ret(t.cmd(izin, "click", """{"element":5}"""), DeniedNeden.IZIN_GERI_CEKILDI)
    }

    // --- Kural 12: görüntüden sonra yeniden -------------------------------------------------------

    @TestFactory
    fun goruntudenSonraOnPlanDegisirseResimAtilir(): List<DynamicTest> = listOf("screenshot" to "{}", "zoom" to """{"x0":0,"y0":0,"x1":400,"y1":400}""")
        .flatMap { (ad, args) ->
            listOf(
                DynamicTest.dynamicTest("$ad: başka pakete geçti") {
                    val t = KiTezgah()
                    val izin = t.izinVer()
                    t.sahteEkran.goruntuSenaryo(SahteEkran.goruntuTamam(base64 = "R0laTElSRVNJTQ=="))
                    t.ekran.once = { o -> if (o == "anlik" && "goruntu" in t.ekran.olaylar) t.sahteEkran.anlikSenaryo(onPlan(KiPaket.HARITA)) }
                    val c = t.ret(t.cmd(izin, ad, args), DeniedNeden.ON_PLAN_IZIN_DISI)
                    assertNull(c.yuk)
                    assertFalse(c.tumu.contains("R0laTElSRVNJTQ==")) { "atılması gereken resim yollandı" }
                    assertEquals(1, t.sahteEkran.goruntuSayisi)
                },
                DynamicTest.dynamicTest("$ad: üstüne heads-up düştü") {
                    val t = KiTezgah()
                    val izin = t.izinVer()
                    t.sahteEkran.goruntuSenaryo(SahteEkran.goruntuTamam(base64 = "R0laTElSRVNJTQ=="))
                    t.ekran.once = { o ->
                        if (o == "anlik" && "goruntu" in t.ekran.olaylar) {
                            t.sahteEkran.anlikSenaryo(katmanli(SahteEkran.sistemPenceresi(PencereTuru.HEADS_UP, KiPaket.SYSTEMUI, 3)))
                        }
                    }
                    val c = t.ret(t.cmd(izin, ad, args), DeniedNeden.IZIN_DISI_PENCERE, DeniedNeden.ON_PLAN_IZIN_DISI)
                    assertFalse(c.tumu.contains("R0laTElSRVNJTQ=="))
                },
            )
        }

    @Test
    fun korumaliYaDaSiyahEkranResimDonmez() {
        val durumlar = listOf(
            GoruntuSonucu.Korumali to DeniedNeden.EKRAN_KORUMALI,
            SahteEkran.goruntuTamam(siyahOrani = 0.995) to DeniedNeden.EKRAN_KORUMALI,
            SahteEkran.goruntuTamam(siyahOrani = CekirdekSinirlari.SIYAH_ESIGI) to DeniedNeden.EKRAN_KORUMALI,
        )
        for ((g, neden) in durumlar) {
            val t = KiTezgah()
            val izin = t.izinVer()
            t.sahteEkran.goruntuSenaryo(g)
            t.ret(t.cmd(izin, "screenshot"), neden)
        }
        val t = KiTezgah()
        val izin = t.izinVer()
        t.sahteEkran.goruntuSenaryo(SahteEkran.goruntuTamam(siyahOrani = 0.5))
        assertEquals("image", t.tamam(t.cmd(izin, "screenshot")).yukTuru)
        t.sahteEkran.goruntuSenaryo(GoruntuSonucu.Basarisiz(CihazHatasi.EKRAN_ALINAMADI))
        t.saat.ilerlet(1_000L)
        val c = t.olmaz(t.cmd(izin, "screenshot"))
        assertEquals(CihazHatasi.EKRAN_ALINAMADI.kablo, c.hata)
    }

    @Test
    fun ekranGoruntusuYukuPortunkiyle() {
        val t = KiTezgah()
        val izin = t.izinVer()
        t.sahteEkran.goruntuSenaryo(GoruntuSonucu.Tamam("image/png", "UE5HVkVSSQ==", 720, 1600, 1.5, 0.0))
        val c = t.tamam(t.cmd(izin, "screenshot"))
        val y = c.yuk ?: throw AssertionError("payload yok: $c")
        assertEquals("image", KiJson.metin(y["kind"]))
        assertEquals("image/png", KiJson.metin(y["mime"]))
        assertEquals("UE5HVkVSSQ==", KiJson.metin(y["image_base64"]))
        assertEquals(720L, KiJson.tam(y["width"]))
        assertEquals(1600L, KiJson.tam(y["height"]))
        assertEquals(1.5, KiJson.sayi(y["scale"]))
        assertNull(t.sahteEkran.goruntuBolgeleri.last()) { "screenshot tam ekran istemeli" }
        t.saat.ilerlet(1_000L)
        t.tamam(t.cmd(izin, "zoom", """{"x0":0,"y0":100,"x1":360,"y1":400}"""))
        assertNotNull(t.sahteEkran.goruntuBolgeleri.last()) { "zoom bölge istemeli" }
    }

    // --- elements ---------------------------------------------------------------------------------

    @Test
    fun elementsIzinDisiPaketDugumleriniVeParolaDegerleriniDusurur() {
        val t = KiTezgah()
        val izin = t.izinVer()
        t.sahteEkran.okuma = ElementOkumasi(
            listOf(
                SahteEkran.dugum(1, mesaj, rol = "button", ad = "Gönder"),
                SahteEkran.dugum(2, mesaj, rol = "edit", ad = "Mesaj", deger = "Merhaba", duzenlenebilir = true),
                SahteEkran.dugum(3, mesaj, rol = "edit", ad = "Parola", deger = "$KI_PAROLA-1", duzenlenebilir = true, parola = true),
                SahteEkran.dugum(4, mesaj, rol = "edit", ad = "Kod", deger = "$KI_PAROLA-2", duzenlenebilir = true, ipucu = "PIN"),
                SahteEkran.dugum(5, KiPaket.KLAVYE, ad = "$KI_GIZLI-KLAVYE-TUSU"),
                SahteEkran.dugum(6, null, ad = "$KI_GIZLI-PAKETSIZ"),
                SahteEkran.dugum(8, mesaj, ad = "Pasif", etkin = false),
                SahteEkran.dugum(9, KiPaket.BANKA, ad = "$KI_GIZLI-BANKA-BAKIYE"),
            ),
            kirpildi = true,
        )
        val c = t.tamam(t.cmd(izin, "elements"))
        assertEquals("elements", c.yukTuru)
        assertEquals(true, KiJson.mantik(c.yuk?.get("truncated")))
        val es = c.elementler()
        val idler = es.map { KiJson.tam(it["id"]) }
        assertEquals(listOf(1L, 2L, 3L, 4L, 8L), idler) { "yalnız izinli paket düğümleri, düğüm numarasıyla" }
        fun e(id: Long) = es.first { KiJson.tam(it["id"]) == id }
        assertEquals("Merhaba", KiJson.metin(e(2)["deger"]))
        assertFalse(e(3).containsKey("deger"))
        assertEquals(true, KiJson.mantik(e(3)["password"]))
        assertFalse(e(4).containsKey("deger"))
        assertEquals(true, KiJson.mantik(e(8)["disabled"]))
        assertEquals("Mesajlar", c.baslik)
    }

    // --- Eşzamanlılık -------------------------------------------------------------------------------

    @Test
    fun eylemSirasindaGelenIkinciKomutBeklemedenMesgulAlir() {
        val t = KiTezgah()
        val izin = t.izinVer(mod = IzinModu.YAZ, metinler = listOf("Geliyorum"), butce = 5)
        val ikinci = AtomicReference<List<String>?>(null)
        val bekledi = AtomicBoolean(false)
        t.sahteEylem.sonra = {
            if (ikinci.get() == null && !bekledi.get()) {
                val ham = t.cmd(izin, "key", """{"keys":"back"}""", cmdId = "c-ikinci")
                val i = thread(isDaemon = true) { ikinci.set(t.isleyici.isle(ham)) }
                i.join(5_000L)
                if (i.isAlive) bekledi.set(true)
            }
        }
        t.tamam(t.cmd(izin, "click", """{"element":5}""", cmdId = "c-birinci"))
        assertFalse(bekledi.get()) { "ikinci komut çalışan komutu bekledi; beklemeden mesgul almalı" }
        val c = KiCikti(ikinci.get() ?: throw AssertionError("ikinci komut sonuç vermedi"))
        val ikinciSatirlar = t.k.denetim.satirlar.filter { it.cmdId == "c-ikinci" }
        val sorunlar = KiOrtakDenetim.sorunlar(c, t.jetonlar, ikinciSatirlar)
        assertTrue(sorunlar.isEmpty()) { "ikinci komut: $sorunlar" }
        assertEquals("c-ikinci", c.cmdId)
        assertEquals(DeniedNeden.MESGUL, c.deniedNeden)
        assertNull(c.onPlan)
        assertEquals(listOf<EylemCagrisi>(EylemCagrisi.DugumeDokun(5, 1, false)), t.sahteEylem.cagrilar)
        assertEquals(4, t.butce(izin)) { "mesgul bütçe yemez" }
        val mesgulSatiri = t.k.denetim.olaylar(DenetimOlayi.KOMUT).filter { it.cmdId == "c-ikinci" }
        assertEquals(listOf(DeniedNeden.MESGUL), mesgulSatiri.map { it.denied })
        // Meşgul bayrağı bırakıldı.
        t.sahteEylem.sonra = null
        t.tamam(t.cmd(izin, "foreground"))
    }

    @Test
    fun goruntuSirasindaGelenIkinciKomutMesgulAlir() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        val ikinci = AtomicReference<List<String>?>(null)
        t.ekran.once = { o ->
            if (o == "goruntu" && ikinci.get() == null) {
                val ham = t.cmd(izin, "click", """{"element":5}""", cmdId = "c-ikinci")
                val i = thread(isDaemon = true) { ikinci.set(t.isleyici.isle(ham)) }
                i.join(5_000L)
            }
        }
        assertEquals("image", t.tamam(t.cmd(izin, "screenshot")).yukTuru)
        val c = KiCikti(ikinci.get() ?: throw AssertionError("ikinci komut beklemeden dönmedi"))
        assertEquals(DeniedNeden.MESGUL, c.deniedNeden)
        assertTrue(t.sahteEylem.bos)
        assertEquals(5, t.butce(izin))
    }

    // --- Zamanlama ----------------------------------------------------------------------------------

    @Test
    fun eylemlerArasiEnAz250ms() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 10)
        t.tamam(t.cmd(izin, "click", """{"element":5}"""))
        t.tamam(t.cmd(izin, "click", """{"element":5}"""))
        t.tamam(t.cmd(izin, "scroll", """{"direction":"down"}"""))
        val z = t.eylem.zamanlar
        assertEquals(3, z.size)
        for (i in 1 until z.size) assertTrue(z[i] - z[i - 1] >= CekirdekSinirlari.EYLEM_ARASI_MS) { "eylemler arası: $z" }
        assertTrue(t.saat.uyuyanlar.sum() >= 2 * CekirdekSinirlari.EYLEM_ARASI_MS) { "uyunan: ${t.saat.uyuyanlar}" }
    }

    @Test
    fun goruntulerArasiEnAz1sn() {
        val t = KiTezgah()
        val izin = t.izinVer()
        t.tamam(t.cmd(izin, "screenshot"))
        t.tamam(t.cmd(izin, "screenshot"))
        t.tamam(t.cmd(izin, "zoom", """{"x0":0,"y0":0,"x1":100,"y1":100}"""))
        val z = t.ekran.goruntuZamanlari
        assertEquals(3, z.size)
        for (i in 1 until z.size) assertTrue(z[i] - z[i - 1] >= CekirdekSinirlari.GORUNTU_ARASI_MS) { "görüntüler arası: $z" }
        assertTrue(t.saat.uyuyanlar.sum() >= 2 * CekirdekSinirlari.GORUNTU_ARASI_MS) { "uyunan: ${t.saat.uyuyanlar}" }
    }

    // --- Port istisnası -----------------------------------------------------------------------------

    @TestFactory
    fun portIstisnasiCihazHatasiOlurDisariSizmaz(): List<DynamicTest> {
        class D(val ad: String, val olay: String?, val mod: IzinModu, val name: String, val args: String)
        return listOf(
            D("durum", "durum", IzinModu.OKU, "foreground", "{}"),
            D("anlik", "anlik", IzinModu.OKU, "click", """{"element":5}"""),
            D("elementler", "elementler", IzinModu.OKU, "elements", "{}"),
            D("dugum", "dugum", IzinModu.OKU, "click", """{"element":5}"""),
            D("odak", "odak", IzinModu.YAZ, "type_text", """{"text":"Geliyorum"}"""),
            D("goruntu", "goruntu", IzinModu.OKU, "screenshot", "{}"),
            D("eylem", null, IzinModu.YAZ, "key", """{"keys":"back"}"""),
        ).map { d ->
            DynamicTest.dynamicTest(d.ad) {
                val t = KiTezgah()
                val izin = t.izinVer(mod = d.mod, metinler = if (d.mod == IzinModu.YAZ) listOf("Geliyorum") else emptyList(), butce = 5)
                val firlat = AtomicBoolean(true)
                if (d.olay != null) {
                    t.ekran.istisna = { o -> if (o == d.olay && firlat.get()) IllegalStateException("$KI_GIZLI-ISTISNA-METNI") else null }
                } else {
                    t.sahteEylem.istisna = { if (firlat.get()) IllegalStateException("$KI_GIZLI-ISTISNA-METNI") else null }
                }
                val c = t.isle(t.cmd(izin, d.name, d.args))
                assertEquals(false, c.ok)
                assertNotNull(c.hataNeden) { "port istisnası CihazHatasi olmalı: $c" }
                if (d.olay != null) {
                    assertTrue(t.sahteEylem.bos)
                    assertEquals(5, t.butce(izin))
                } else {
                    assertEquals(1, t.sahteEylem.cagrilar.size)
                    assertEquals(4, t.butce(izin))
                }
                firlat.set(false)
                t.saat.ilerlet(1_000L)
                t.tamam(t.cmd(izin, "foreground"))
            }
        }
    }

    // --- Bağlantı -----------------------------------------------------------------------------------

    @Test
    fun baglantiDegisirseEylemYapilmazSonucAtilir() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        val tetik = AtomicBoolean(false)
        t.ekran.once = { o -> if (o == "anlik" && tetik.compareAndSet(false, true)) t.baglanti++ }
        val c = t.isle(t.cmd(izin, "click", """{"element":5}"""))
        assertTrue(c.ham.isEmpty()) { "bağlantı değişti, sonuç atılmalıydı: $c" }
        assertTrue(t.sahteEylem.bos) { "eski bağlantının komutu eylem yaptı" }
        t.ekran.once = null
        t.saat.ilerlet(300L)
        t.tamam(t.cmd(izin, "foreground"))
    }

    @Test
    fun eylemSirasindaBaglantiKoparsaSonucAtilir() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        t.sahteEylem.sonra = { t.baglanti++ }
        val c = t.isle(t.cmd(izin, "click", """{"element":5}"""))
        assertTrue(c.ham.isEmpty()) { "kopmadan sonra sonuç yollandı: $c" }
        assertEquals(1, t.sahteEylem.cagrilar.size)
    }

    // --- Denetim ------------------------------------------------------------------------------------

    @Test
    fun herKomutBirDenetimSatiriBirakir() {
        val t = KiTezgah()
        val izin = t.izinVer(butce = 5)
        val hamlar = listOf(
            t.cmd(izin, "foreground", cmdId = "d1"),
            t.cmd(izin, "click", """{"element":5}""", cmdId = "d2"),
            t.cmd(null, "click", """{"element":5}""", cmdId = "d3"),
            t.cmd(izin, "shell", cmdId = "d4"),
            t.cmd(izin, "click", """{"element":77}""", cmdId = "d5"),
            t.cmd(izin, "type_text", metinArg("Geliyorum"), cmdId = "d6"),
            t.cmd(izin, "click", """{"element":5}""", token = SahtePc.JETON, cmdId = "d7"),
        )
        for (h in hamlar) {
            t.saat.ilerlet(300L)
            t.isle(h)
        }
        val satirlar = t.k.denetim.olaylar(DenetimOlayi.KOMUT)
        assertEquals(listOf("d1", "d2", "d3", "d4", "d5", "d6", "d7"), satirlar.map { it.cmdId })
        assertEquals(CmdAdi.FOREGROUND, satirlar[0].komut)
        assertEquals(CmdAdi.CLICK, satirlar[1].komut)
        assertEquals(mesaj, satirlar[1].paket)
        assertEquals(izin.grantId, satirlar[1].grantId)
        assertEquals(DeniedNeden.IZIN_YOK, satirlar[2].denied)
        assertEquals(DeniedNeden.DESTEKLENMEYEN_KOMUT, satirlar[3].denied)
        assertEquals(CihazHatasi.ELEMENT_BULUNAMADI, satirlar[4].hata)
        assertEquals(DeniedNeden.YALNIZ_OKU_YAZMA, satirlar[5].denied)
        assertEquals(DeniedNeden.JETON_YANLIS, satirlar[6].denied)
    }
}
