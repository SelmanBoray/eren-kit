package dev.eren.cihaz.cekirdek

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.text.Normalizer

/*
 * Kapının saldırı testleri. PC tümüyle kandırılmış varsayılır: kapı yalnız TASARIM.md "Kapı kural
 * sırası"na göre karar verir. Beklentiler üretimin o anki halinden değil, kural metninden gelir.
 * Her ret testinin karşısında bir pozitif test var: kapı her şeyi reddederek geçemez.
 */
class KapiTest {
    private val kendi = "dev.eren.mobil"
    private val mesaj = "com.example.mesaj"
    private val notlar = "com.example.notlar"
    private val banka = "com.example.banka"
    private val yeniPaket = "com.example.yeni"
    private val imzaDegisen = "com.example.imza"
    private val diger = "com.example.diger"
    private val ev = "com.ornek.anaekran"
    private val klavyePaketi = "com.example.klavye"

    private val sabitDegismez = listOf(
        kendi,
        ev,
        "com.android.settings",
        "com.google.android.packageinstaller",
        "com.android.packageinstaller",
        "com.android.vending",
        "com.google.android.permissioncontroller",
        "com.android.permissioncontroller",
        "com.miui.securitycenter",
        "com.tailscale.ipn",
        "com.android.systemui",
    )

    private val listeler: Listeler = listelerKur.kur(
        kendi,
        ListeGirdisi(
            kurulu = listOf(
                KuruluUygulama(mesaj, "Mesaj", "imza-m"),
                KuruluUygulama(notlar, "Notlar", "imza-n"),
                KuruluUygulama(banka, "Banka", "imza-b"),
                KuruluUygulama(yeniPaket, "Yeni", "imza-y"),
                KuruluUygulama(imzaDegisen, "Imza", "imza-yeni"),
                KuruluUygulama(diger, "Diger", "imza-d"),
            ),
            kararlar = mapOf(
                mesaj to KullaniciKarari(UygulamaDurumu.ACIK, "imza-m"),
                notlar to KullaniciKarari(UygulamaDurumu.ACIK, "imza-n"),
                banka to KullaniciKarari(UygulamaDurumu.HASSAS, "imza-b"),
                imzaDegisen to KullaniciKarari(UygulamaDurumu.ACIK, "imza-eski"),
                diger to KullaniciKarari(UygulamaDurumu.ACIK, "imza-d"),
            ),
            cozulenDegismez = setOf(ev),
        ),
    )

    // ---- yardımcılar ----------------------------------------------------------------------

    private fun izin(
        mod: IzinModu = IzinModu.OKU,
        paketler: List<String> = listOf(mesaj),
        izinliMetin: List<String> = emptyList(),
        serbest: Boolean = false,
        butce: Int = 10,
    ) = IzinKaydi(
        grantId = "grant-1",
        planId = "plan-1",
        planHash = "a".repeat(64),
        token = "jeton",
        mod = mod,
        uygulamalar = paketler.map { IzinliUygulama(it, it) },
        izinliMetin = izinliMetin,
        serbestMetin = serbest,
        bitisMonotonikMs = 1_000_000L,
        kalanButce = butce,
    )

    private fun cmd(arg: CmdArg, deadline: Long = 10_000L) = Cmd("cmd-1", "grant-1", "jeton", deadline, arg)

    private fun temiz(paket: String = mesaj, pencereler: List<Pencere>? = null) =
        SahteEkran.anlikDurum(paket, pencereler = pencereler)

    private fun cubuklu(paket: String = mesaj) = temiz(
        paket,
        listOf(
            SahteEkran.uygulamaPenceresi(paket, katman = 1),
            SahteEkran.sistemPenceresi(PencereTuru.DURUM_CUBUGU, "com.android.systemui", katman = 2),
            SahteEkran.sistemPenceresi(PencereTuru.GEZINTI_CUBUGU, null, katman = 3),
        ),
    )

    private fun girdi(
        arg: CmdArg,
        izin: IzinKaydi = izin(),
        anlik: AnlikDurum = temiz(),
        hedef: DugumBaglami? = null,
        kullanilan: Set<Int> = emptySet(),
    ) = EkranDenetimGirdisi(cmd(arg), izin, kullanilan, anlik, hedef, listeler)

    private fun ret(neden: DeniedNeden, karar: Karar) = assertEquals(Karar.Reddedildi(neden), karar)

    private fun izinli(karar: Karar) = assertEquals(Karar.Izinli, karar)

    private fun dugumBaglam(
        paket: String? = mesaj,
        ad: String = "Alan",
        parola: Boolean = false,
        ipucu: String? = null,
        duzenlenebilir: Boolean = true,
        tiklanabilir: Boolean = true,
        atalar: List<Dugum> = emptyList(),
        torunlar: List<Dugum> = emptyList(),
    ) = SahteEkran.baglam(
        SahteEkran.dugum(
            1, paket = paket, ad = ad, parola = parola, ipucu = ipucu,
            duzenlenebilir = duzenlenebilir, tiklanabilir = tiklanabilir,
        ),
        atalar,
        torunlar,
    )

    private val ekranNoktasi = Nokta(500, 1000)
    private val durumCubuguNoktasi = Nokta(500, 50)

    private fun elementTikla() = CmdArg.Click(element = 1, nokta = null, tiklama = 1, uzunBasma = false)

    private fun noktaTikla(n: Nokta = ekranNoktasi, tiklama: Int = 1, uzun: Boolean = false) =
        CmdArg.Click(element = null, nokta = n, tiklama = tiklama, uzunBasma = uzun)

    // ---- kural 1-5: izinDenetimi ------------------------------------------------------------

    private val gecerliBulgu get() = IzinBulgusu.Gecerli(izin(), emptySet())

    @Test
    fun izinDenetimiPozitif() {
        izinli(Kapi.izinDenetimi(cmd(CmdArg.Screenshot), false, 1_000L, gecerliBulgu))
    }

    @Test
    fun mesgulIlkGelir() {
        ret(DeniedNeden.MESGUL, Kapi.izinDenetimi(cmd(CmdArg.Screenshot), true, 1_000L, gecerliBulgu))
        // mesgul + deadline + izin yok birlikte: mesgul
        ret(
            DeniedNeden.MESGUL,
            Kapi.izinDenetimi(cmd(CmdArg.Screenshot, deadline = 1L), true, null, IzinBulgusu.Gecersiz(DeniedNeden.IZIN_YOK)),
        )
    }

    @Test
    fun deadlineGectiIzinHatalarindanOnceGelir() {
        ret(DeniedNeden.DEADLINE_GECTI, Kapi.izinDenetimi(cmd(CmdArg.Screenshot, deadline = 999L), false, 1_000L, gecerliBulgu))
        ret(
            DeniedNeden.DEADLINE_GECTI,
            Kapi.izinDenetimi(cmd(CmdArg.Screenshot, deadline = 999L), false, 1_000L, IzinBulgusu.Gecersiz(DeniedNeden.JETON_YANLIS)),
        )
    }

    @Test
    fun pcSaatiYoksaDeadlineGecti() {
        ret(DeniedNeden.DEADLINE_GECTI, Kapi.izinDenetimi(cmd(CmdArg.Screenshot), false, null, gecerliBulgu))
    }

    @Test
    fun izinBulgusuNedenleriAynenDoner() {
        for (n in listOf(
            DeniedNeden.IZIN_YOK,
            DeniedNeden.IZIN_GERI_CEKILDI,
            DeniedNeden.JETON_YANLIS,
            DeniedNeden.IZIN_SURESI_BITTI,
        )) {
            ret(n, Kapi.izinDenetimi(cmd(CmdArg.Screenshot), false, 1_000L, IzinBulgusu.Gecersiz(n)))
        }
    }

    // ---- kural 6-7: durumDenetimi -----------------------------------------------------------

    @Test
    fun durumDenetimi() {
        izinli(Kapi.durumDenetimi(CihazDurumu(a11y = true, kilitli = false, adbAcik = false)))
        ret(DeniedNeden.ERISILEBILIRLIK_KAPALI, Kapi.durumDenetimi(CihazDurumu(false, false, false)))
        ret(DeniedNeden.KILIT_EKRANI, Kapi.durumDenetimi(CihazDurumu(true, true, false)))
        // ikisi birlikte: erişilebilirlik (6) önce
        ret(DeniedNeden.ERISILEBILIRLIK_KAPALI, Kapi.durumDenetimi(CihazDurumu(false, true, false)))
    }

    // ---- kural 8: ön plan -------------------------------------------------------------------

    private val okuCmdleri: List<CmdArg> = listOf(
        CmdArg.Screenshot,
        CmdArg.Zoom(0, 0, 100, 100),
        CmdArg.Click(1, null, 1, false),
        CmdArg.Click(null, Nokta(500, 1000), 1, false),
        CmdArg.TypeText("x"),
        CmdArg.Key(Tus.BACK, 1),
        CmdArg.Scroll(KaydirmaYonu.DOWN, null, null),
        CmdArg.Drag(1, 1, 2, 2),
        CmdArg.OpenApp(mesaj),
    )

    private fun hedefli() = dugumBaglam()

    @Test
    fun izinDisiPaketHerKomutuReddeder() {
        for (mod in IzinModu.entries) {
            for (arg in okuCmdleri.filter { it !is CmdArg.OpenApp }) {
                val k = Kapi.ekranDenetimi(
                    girdi(arg, izin = izin(mod, izinliMetin = listOf("x")), anlik = temiz(diger), hedef = hedefli()),
                )
                assertTrue(k is Karar.Reddedildi, "izin dışı pakette izinli geçti: $mod $arg")
            }
        }
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = temiz(diger))))
    }

    @Test
    fun degismezListedekiHerPaketIzinListesindeOlsaBileRet() {
        for (p in sabitDegismez) {
            ret(
                DeniedNeden.DEGISMEZ_RET,
                Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, izin = izin(paketler = listOf(mesaj, p)), anlik = temiz(p))),
            )
            // listede olmasa da: değişmez, izin dışından önce gelir
            ret(DeniedNeden.DEGISMEZ_RET, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = temiz(p))))
            // open_app hedefi olarak
            ret(
                DeniedNeden.DEGISMEZ_RET,
                Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(p), izin = izin(paketler = listOf(mesaj, p)))),
            )
        }
    }

    @Test
    fun hassasYeniVeImzasiDegisenPaketListedeOlsaBileRet() {
        val hepsi = listOf(mesaj, banka, yeniPaket, imzaDegisen)
        ret(DeniedNeden.HASSAS_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, izin(paketler = hepsi), temiz(banka))))
        ret(DeniedNeden.YENI_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, izin(paketler = hepsi), temiz(yeniPaket))))
        ret(DeniedNeden.YENI_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, izin(paketler = hepsi), temiz(imzaDegisen))))
        ret(DeniedNeden.HASSAS_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(banka), izin(paketler = hepsi))))
        ret(DeniedNeden.YENI_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(yeniPaket), izin(paketler = hepsi))))
        ret(DeniedNeden.YENI_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(imzaDegisen), izin(paketler = hepsi))))
        // listede olmayan hassas / yeni: durum nedeni izin dışından önce gelir
        ret(DeniedNeden.HASSAS_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = temiz(banka))))
        ret(DeniedNeden.YENI_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = temiz(yeniPaket))))
    }

    @Test
    fun izinDisiAmaAcikPaketOnPlanIzinDisi() {
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = temiz(notlar))))
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(notlar))))
    }

    @Test
    fun openAppOnPlanZinciriniUygulamazYalnizHedefi() {
        val hepsi = listOf(mesaj, notlar, banka, yeniPaket, imzaDegisen, diger)
        // ön plan ana ekran (YENI) ya da uygulamanın kendi paketi: izinli hedefe açılabilir
        for (on in listOf(ev, kendi)) {
            izinli(Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(mesaj), izin(paketler = hepsi), temiz(on))))
        }
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(mesaj), anlik = temiz(yeniPaket))))
        // ön plan izinliyken kötü hedefler reddedilir
        for (p in sabitDegismez) {
            ret(DeniedNeden.DEGISMEZ_RET, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(p), izin(paketler = hepsi + p))))
        }
        ret(DeniedNeden.HASSAS_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(banka), izin(paketler = hepsi))))
        ret(DeniedNeden.YENI_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(yeniPaket), izin(paketler = hepsi))))
        ret(DeniedNeden.YENI_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(imzaDegisen), izin(paketler = hepsi))))
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(notlar))))
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(diger))))
        // ön plan ana ekranken de kötü hedef reddedilir
        ret(DeniedNeden.HASSAS_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(banka), izin(paketler = hepsi), temiz(ev))))
        // K10: bütçe open_app için de geçerli
        ret(DeniedNeden.BUTCE_DOLDU, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(mesaj), izin(butce = 0), temiz(ev))))
    }

    @Test
    fun openAppIcinIzinVeDurumKurallariGecerli() {
        val bulgu = IzinBulgusu.Gecerli(izin(), emptySet())
        val c = cmd(CmdArg.OpenApp(mesaj))
        ret(DeniedNeden.MESGUL, Kapi.izinDenetimi(c, true, 1_000L, bulgu))
        ret(DeniedNeden.DEADLINE_GECTI, Kapi.izinDenetimi(cmd(CmdArg.OpenApp(mesaj), 1L), false, 1_000L, bulgu))
        ret(DeniedNeden.JETON_YANLIS, Kapi.izinDenetimi(c, false, 1_000L, IzinBulgusu.Gecersiz(DeniedNeden.JETON_YANLIS)))
        ret(DeniedNeden.IZIN_SURESI_BITTI, Kapi.izinDenetimi(c, false, 1_000L, IzinBulgusu.Gecersiz(DeniedNeden.IZIN_SURESI_BITTI)))
        izinli(Kapi.izinDenetimi(c, false, 1_000L, bulgu))
        ret(DeniedNeden.ERISILEBILIRLIK_KAPALI, Kapi.durumDenetimi(CihazDurumu(false, false, false)))
        ret(DeniedNeden.KILIT_EKRANI, Kapi.durumDenetimi(CihazDurumu(true, true, false)))
    }

    @Test
    fun onPlanPozitifler() {
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Screenshot)))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(mesaj))))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(notlar), izin(paketler = listOf(mesaj, notlar)))))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, izin(paketler = listOf(mesaj, notlar)), temiz(notlar))))
    }

    @Test
    fun openAppUrlVeIntentHicbirZamanIzinliDegil() {
        val saldirilar = listOf(
            "https://example.com",
            "http://example.com",
            "intent:#Intent;action=android.intent.action.VIEW;end",
            "intent://x#Intent;scheme=https;end",
            "javascript:alert(1)",
            "file:///sdcard/x",
            "",
            "com.example.mesaj;com.android.settings",
        )
        for (s in saldirilar) {
            val k = Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(s), izin(paketler = listOf(mesaj, s))))
            assertTrue(k is Karar.Reddedildi, "open_app izinli geçti: $s")
        }
    }

    @Test
    fun aktifKokSonOlayVeOdakUyusmazsaRet() {
        val izn = izin(paketler = listOf(mesaj, notlar))
        val d = temiz(mesaj)
        val uyusmayanlar = listOf(
            d.copy(aktifKokPaketi = notlar),
            d.copy(sonOlayPaketi = notlar),
            d.copy(odakPaketi = notlar),
            d.copy(aktifKokPaketi = diger),
            d.copy(sonOlayPaketi = diger),
            d.copy(odakPaketi = diger),
            d.copy(odakPaketi = klavyePaketi),
            d.copy(odakPaketi = null),
            d.copy(aktifKokPaketi = null),
        )
        for (u in uyusmayanlar) {
            ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, izn, u)))
            ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.Key(Tus.BACK, 1), izin(IzinModu.YAZ, listOf(mesaj, notlar)), u)))
        }
        // uyuşmazlık değişmez listeden önce: bir köşe değişmez, diğeri izinli olsa da ilk kural
        ret(
            DeniedNeden.ON_PLAN_IZIN_DISI,
            Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, izn, d.copy(aktifKokPaketi = "com.android.settings"))),
        )
    }

    // ---- kural 8: pencereler ----------------------------------------------------------------

    private fun pencereli(vararg ek: Pencere) = temiz(
        mesaj,
        listOf(SahteEkran.uygulamaPenceresi(mesaj, katman = 1)) + ek.toList(),
    )

    @Test
    fun durumVeGeziniCubuguPaketsizKabulEdilir() {
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = cubuklu())))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Zoom(0, 0, 10, 10), anlik = cubuklu())))
    }

    @Test
    fun gecersizPencereGoruntudeIzinDisiPencere() {
        val yabanci = "com.example.yabanci"
        val sorunlular = listOf(
            SahteEkran.sistemPenceresi(PencereTuru.PERDE, "com.android.systemui"),
            SahteEkran.sistemPenceresi(PencereTuru.PERDE, null),
            SahteEkran.sistemPenceresi(PencereTuru.HEADS_UP, "com.android.systemui"),
            SahteEkran.sistemPenceresi(PencereTuru.HEADS_UP, yabanci),
            SahteEkran.sistemPenceresi(PencereTuru.KLAVYE, klavyePaketi),
            SahteEkran.sistemPenceresi(PencereTuru.BALON, yabanci),
            SahteEkran.sistemPenceresi(PencereTuru.PIP, yabanci),
            SahteEkran.sistemPenceresi(PencereTuru.UYGULAMA, yabanci),
            SahteEkran.sistemPenceresi(PencereTuru.UYGULAMA, diger),
            SahteEkran.sistemPenceresi(PencereTuru.UYGULAMA, null),
            SahteEkran.sistemPenceresi(PencereTuru.BILINMIYOR, null),
        )
        for (p in sorunlular) {
            ret(DeniedNeden.IZIN_DISI_PENCERE, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = pencereli(p))))
            ret(DeniedNeden.IZIN_DISI_PENCERE, Kapi.ekranDenetimi(girdi(CmdArg.Zoom(0, 0, 10, 10), anlik = pencereli(p))))
        }
    }

    @Test
    fun izinliIkinciUygulamaPenceresiGoruntudeGecer() {
        val ikinci = SahteEkran.uygulamaPenceresi(notlar, katman = 2)
        izinli(
            Kapi.ekranDenetimi(
                girdi(CmdArg.Screenshot, izin(paketler = listOf(mesaj, notlar)), pencereli(ikinci)),
            ),
        )
        // aynı pencere izin listesinde değilse
        ret(DeniedNeden.IZIN_DISI_PENCERE, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = pencereli(ikinci))))
    }

    @Test
    fun onPlanUyusmazligiPenceredenOnceGelir() {
        val perde = SahteEkran.sistemPenceresi(PencereTuru.PERDE, "com.android.systemui")
        ret(
            DeniedNeden.ON_PLAN_IZIN_DISI,
            Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = pencereli(perde).copy(odakPaketi = diger))),
        )
        ret(
            DeniedNeden.DEGISMEZ_RET,
            Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, anlik = SahteEkran.anlikDurum("com.android.settings", pencereler = listOf(
                SahteEkran.uygulamaPenceresi("com.android.settings"), perde,
            )))),
        )
    }

    // ---- kural 8: x,y ve element ------------------------------------------------------------

    @Test
    fun durumCubuguneXyTiklamaRet() {
        for (mod in IzinModu.entries) {
            ret(
                DeniedNeden.ON_PLAN_IZIN_DISI,
                Kapi.ekranDenetimi(girdi(noktaTikla(durumCubuguNoktasi), izin(mod), cubuklu())),
            )
        }
    }

    @Test
    fun heftenUstPenceredeXyTiklamaIzinliDegil() {
        val headsUp = SahteEkran.sistemPenceresi(PencereTuru.HEADS_UP, "com.android.systemui", katman = 5)
        val k = Kapi.ekranDenetimi(girdi(noktaTikla(Nokta(500, 50)), izin(IzinModu.YAZ), pencereli(headsUp)))
        assertTrue(k is Karar.Reddedildi)
    }

    @Test
    fun xyTiklamaIzinliUygulamadaGecerYazModunda() {
        izinli(Kapi.ekranDenetimi(girdi(noktaTikla(ekranNoktasi), izin(IzinModu.YAZ), cubuklu())))
    }

    @Test
    fun elementTiklamaBayatYaDaIzinDisiDugumReddedilir() {
        val yaz = izin(IzinModu.YAZ)
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(elementTikla(), yaz, hedef = dugumBaglam(paket = diger))))
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(elementTikla(), yaz, hedef = dugumBaglam(paket = notlar))))
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(elementTikla(), yaz, hedef = dugumBaglam(paket = null))))
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(elementTikla(), yaz, hedef = dugumBaglam(paket = klavyePaketi))))
        // oku modunda da
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(elementTikla(), hedef = dugumBaglam(paket = diger))))
        // pozitif
        izinli(Kapi.ekranDenetimi(girdi(elementTikla(), yaz, hedef = dugumBaglam(paket = mesaj, ad = "Kaydet"))))
        izinli(Kapi.ekranDenetimi(girdi(elementTikla(), hedef = dugumBaglam(paket = mesaj, ad = "Kaydet"))))
    }

    // ---- kural 9: okuma modu ----------------------------------------------------------------

    @Test
    fun okumaModundaYazmaVeTusRet() {
        ret(DeniedNeden.YALNIZ_OKU_YAZMA, Kapi.ekranDenetimi(girdi(CmdArg.TypeText("merhaba"), hedef = dugumBaglam())))
        ret(DeniedNeden.YALNIZ_OKU_YAZMA, Kapi.ekranDenetimi(girdi(CmdArg.Key(Tus.BACK, 1))))
        for (t in Tus.entries) {
            ret(DeniedNeden.YALNIZ_OKU_YAZMA, Kapi.ekranDenetimi(girdi(CmdArg.Key(t, 1))))
        }
        // izinli metin listesinde olsa bile oku modunda yazılmaz
        ret(
            DeniedNeden.YALNIZ_OKU_YAZMA,
            Kapi.ekranDenetimi(girdi(CmdArg.TypeText("merhaba"), izin(izinliMetin = listOf("merhaba")), hedef = dugumBaglam())),
        )
    }

    @Test
    fun okumaModundaHamDokunmaRet() {
        val hamlar = listOf(
            noktaTikla(),
            noktaTikla(tiklama = 2),
            noktaTikla(uzun = true),
            CmdArg.Click(1, null, 2, false),
            CmdArg.Click(1, null, 1, true),
            CmdArg.Drag(100, 500, 100, 900),
            CmdArg.Scroll(KaydirmaYonu.LEFT, null, null),
            CmdArg.Scroll(KaydirmaYonu.RIGHT, 3, null),
            CmdArg.Scroll(KaydirmaYonu.DOWN, null, Nokta(500, 1000)),
            CmdArg.Scroll(KaydirmaYonu.UP, 2, Nokta(500, 1000)),
        )
        for (arg in hamlar) {
            ret(DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA, Kapi.ekranDenetimi(girdi(arg, hedef = dugumBaglam())))
        }
    }

    @Test
    fun okumaModuPozitifler() {
        izinli(Kapi.ekranDenetimi(girdi(elementTikla(), hedef = dugumBaglam(ad = "Kaydet"))))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Scroll(KaydirmaYonu.DOWN, null, null))))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Scroll(KaydirmaYonu.UP, 3, null))))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Screenshot)))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Zoom(0, 0, 10, 10))))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Elements(null))))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Wait(1.0))))
    }

    @Test
    fun okumaModundaGonderSilDugumuRet() {
        val gonder = listOf(
            "GÖNDER", "Gönder", "gönder ", "Gö​nder", "Gö­nder", "GONDER", "Send", "SEND",
            Normalizer.normalize("Gönder", Normalizer.Form.NFD), "Sil", "SİL", "Delete", "Öde",
        )
        for (ad in gonder) {
            ret(
                DeniedNeden.YALNIZ_OKU_ETIKET,
                Kapi.ekranDenetimi(girdi(elementTikla(), hedef = dugumBaglam(ad = ad))),
            )
        }
    }

    @Test
    fun okumaModundaAtasiSilOlanDugumRet() {
        val ata = SahteEkran.dugum(9, ad = "Sil", tiklanabilir = true)
        ret(
            DeniedNeden.YALNIZ_OKU_ETIKET,
            Kapi.ekranDenetimi(girdi(elementTikla(), hedef = dugumBaglam(ad = "Simge", atalar = listOf(ata)))),
        )
        val torun = SahteEkran.dugum(10, ad = "GÖNDER", tiklanabilir = false)
        ret(
            DeniedNeden.YALNIZ_OKU_ETIKET,
            Kapi.ekranDenetimi(girdi(elementTikla(), hedef = dugumBaglam(ad = "Simge", torunlar = listOf(torun)))),
        )
        // zararsız atası ve torunu varsa geçer
        val zararsiz = SahteEkran.dugum(11, ad = "Liste")
        izinli(
            Kapi.ekranDenetimi(
                girdi(elementTikla(), hedef = dugumBaglam(ad = "Simge", atalar = listOf(zararsiz), torunlar = listOf(zararsiz))),
            ),
        )
    }

    @Test
    fun yazModundaGonderDugumuEtiketNedeniyleReddedilmez() {
        izinli(Kapi.ekranDenetimi(girdi(elementTikla(), izin(IzinModu.YAZ), hedef = dugumBaglam(ad = "Gönder"))))
    }

    // ---- kural 9: yazma modu ----------------------------------------------------------------

    private fun yaz(metin: String, izinli: List<String> = listOf("Merhaba"), hedef: DugumBaglami? = dugumBaglam(), kullanilan: Set<Int> = emptySet(), serbest: Boolean = false, anlik: AnlikDurum = temiz()) =
        Kapi.ekranDenetimi(girdi(CmdArg.TypeText(metin), izin(IzinModu.YAZ, izinliMetin = izinli, serbest = serbest), anlik, hedef, kullanilan))

    @Test
    fun yazModuBirebirMetinGecer() {
        izinli(yaz("Merhaba"))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Key(Tus.BACK, 1), izin(IzinModu.YAZ))))
    }

    @Test
    fun yazModuMetinKilidi() {
        val nfdKaynak = "Çay içelim"
        val nfd = Normalizer.normalize(nfdKaynak, Normalizer.Form.NFD)
        assertNotEquals(nfdKaynak, nfd)
        val kiril = "Mеrhaba"
        assertNotEquals("Merhaba", kiril)
        val saldirilar = listOf(
            "Merhaba ", " Merhaba", "Merhaba\n", "Merhaba\r\n", "Merhaba\t", "merhaba", "MERHABA",
            "Merha", "Merhabaa", "", kiril, "Merhaba​", "Merhaba\u0000",
        )
        for (s in saldirilar) ret(DeniedNeden.METIN_KILIDI, yaz(s))
        ret(DeniedNeden.METIN_KILIDI, yaz(nfd, izinli = listOf(nfdKaynak)))
        izinli(yaz(nfdKaynak, izinli = listOf(nfdKaynak)))
        // boş izinli metin listesi
        ret(DeniedNeden.METIN_KILIDI, yaz("Merhaba", izinli = emptyList()))
    }

    @Test
    fun yazModuAyniMaddeIkiKezYazilamaz() {
        izinli(yaz("Merhaba", kullanilan = emptySet()))
        ret(DeniedNeden.METIN_KILIDI, yaz("Merhaba", kullanilan = setOf(0)))
        // iki özdeş madde: ilk kullanılmışsa ikincisi kalır
        izinli(yaz("Merhaba", izinli = listOf("Merhaba", "Merhaba"), kullanilan = setOf(0)))
        ret(DeniedNeden.METIN_KILIDI, yaz("Merhaba", izinli = listOf("Merhaba", "Merhaba"), kullanilan = setOf(0, 1)))
        // başka madde kullanılmış olması bu maddeyi etkilemez
        izinli(yaz("Merhaba", izinli = listOf("Başka", "Merhaba"), kullanilan = setOf(0)))
    }

    @Test
    fun serbestMetinHerMetniKabulEderAmaParolayiDegil() {
        izinli(yaz("herhangi bir şey", izinli = emptyList(), serbest = true))
        ret(
            DeniedNeden.PAROLA_ALANI,
            yaz("herhangi", izinli = emptyList(), serbest = true, hedef = dugumBaglam(parola = true)),
        )
    }

    @Test
    fun yazModuParolaAlaniRet() {
        ret(DeniedNeden.PAROLA_ALANI, yaz("Merhaba", hedef = dugumBaglam(parola = true)))
        ret(DeniedNeden.PAROLA_ALANI, yaz("Merhaba", hedef = dugumBaglam(ipucu = "Şifre")))
        ret(DeniedNeden.PAROLA_ALANI, yaz("Merhaba", hedef = dugumBaglam(ipucu = "PIN kodu")))
        ret(DeniedNeden.PAROLA_ALANI, yaz("Merhaba", hedef = dugumBaglam(ipucu = "OTP")))
        ret(DeniedNeden.PAROLA_ALANI, yaz("Merhaba", hedef = dugumBaglam(ipucu = "SIFRE")))
        // parola + izinli olmayan metin: parola önce
        ret(DeniedNeden.PAROLA_ALANI, yaz("yanlış", hedef = dugumBaglam(parola = true)))
        // zararsız ipucu geçer
        izinli(yaz("Merhaba", hedef = dugumBaglam(ipucu = "Mesajınız")))
    }

    @Test
    fun yazModundaOdakKlavyedeyseRet() {
        // düğümün sahibi klavye paketi
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, yaz("Merhaba", hedef = dugumBaglam(paket = klavyePaketi)))
        // ön planda odak klavyede
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, yaz("Merhaba", anlik = temiz().copy(odakPaketi = klavyePaketi)))
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, yaz("Merhaba", hedef = dugumBaglam(paket = diger)))
    }

    // ---- kural 10 ve sıra çiftleri ----------------------------------------------------------

    @Test
    fun butceDoldu() {
        val bos = izin(IzinModu.YAZ, butce = 0)
        ret(DeniedNeden.BUTCE_DOLDU, Kapi.ekranDenetimi(girdi(CmdArg.Key(Tus.BACK, 1), bos)))
        ret(DeniedNeden.BUTCE_DOLDU, Kapi.ekranDenetimi(girdi(noktaTikla(), bos)))
        ret(DeniedNeden.BUTCE_DOLDU, Kapi.ekranDenetimi(girdi(CmdArg.OpenApp(mesaj), bos)))
        ret(DeniedNeden.BUTCE_DOLDU, Kapi.ekranDenetimi(girdi(CmdArg.Scroll(KaydirmaYonu.DOWN, null, null), bos)))
        // okuma komutları bütçe yemez
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, bos)))
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Elements(null), bos)))
        // bütçe varken geçer
        izinli(Kapi.ekranDenetimi(girdi(CmdArg.Key(Tus.BACK, 1), izin(IzinModu.YAZ, butce = 1))))
    }

    @Test
    fun kuralSirasiCiftleri() {
        val sifir = izin(IzinModu.OKU, butce = 0)
        // 9 (mod) önce, 10 (bütçe) sonra
        ret(DeniedNeden.YALNIZ_OKU_YAZMA, Kapi.ekranDenetimi(girdi(CmdArg.Key(Tus.BACK, 1), sifir)))
        ret(DeniedNeden.YALNIZ_OKU_HAM_DOKUNMA, Kapi.ekranDenetimi(girdi(noktaTikla(), sifir)))
        // 8 (ön plan) önce, 9 (mod) sonra
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.Key(Tus.BACK, 1), anlik = temiz(diger))))
        ret(DeniedNeden.DEGISMEZ_RET, Kapi.ekranDenetimi(girdi(CmdArg.TypeText("x"), anlik = temiz("com.android.settings"), hedef = dugumBaglam())))
        ret(DeniedNeden.HASSAS_UYGULAMA, Kapi.ekranDenetimi(girdi(noktaTikla(), anlik = temiz(banka))))
        ret(DeniedNeden.YENI_UYGULAMA, Kapi.ekranDenetimi(girdi(CmdArg.Drag(1, 1, 2, 2), anlik = temiz(yeniPaket))))
        // 8 (ön plan) önce, 10 (bütçe) sonra
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(CmdArg.Key(Tus.BACK, 1), izin(IzinModu.YAZ, butce = 0), temiz(diger))))
        // durum çubuğuna x,y: ön plan (8) ham dokunmadan (9) önce
        ret(DeniedNeden.ON_PLAN_IZIN_DISI, Kapi.ekranDenetimi(girdi(noktaTikla(durumCubuguNoktasi), anlik = cubuklu())))
        // parola (9) önce, bütçe (10) sonra
        ret(DeniedNeden.PAROLA_ALANI, yazButceSifir())
        // mod (9): oku + parola alanı -> yazma yasağı
        ret(DeniedNeden.YALNIZ_OKU_YAZMA, Kapi.ekranDenetimi(girdi(CmdArg.TypeText("Merhaba"), izin(IzinModu.OKU, izinliMetin = listOf("Merhaba")), hedef = dugumBaglam(parola = true))))
        // pencere + mod: ön plan kuralı (8) mod (9) kuralından önce
        val perde = SahteEkran.sistemPenceresi(PencereTuru.PERDE, "com.android.systemui")
        ret(DeniedNeden.IZIN_DISI_PENCERE, Kapi.ekranDenetimi(girdi(CmdArg.Screenshot, izin(IzinModu.OKU, butce = 0), pencereli(perde))))
    }

    private fun yazButceSifir() = Kapi.ekranDenetimi(
        girdi(CmdArg.TypeText("Merhaba"), izin(IzinModu.YAZ, izinliMetin = listOf("Merhaba"), butce = 0), hedef = dugumBaglam(parola = true)),
    )

    // ---- kural 12: görüntüden sonra ---------------------------------------------------------

    private fun goruntu(sonraki: AnlikDurum, sonuc: GoruntuSonucu, arg: CmdArg = CmdArg.Screenshot, izn: IzinKaydi = izin()) =
        Kapi.goruntuDenetimi(girdi(arg, izn), sonraki, sonuc)

    @Test
    fun goruntuSonrasiPozitifler() {
        izinli(goruntu(temiz(), SahteEkran.goruntuTamam(0.0)))
        izinli(goruntu(cubuklu(), SahteEkran.goruntuTamam(0.5)))
        izinli(goruntu(temiz(), SahteEkran.goruntuTamam(0.98)))
        izinli(goruntu(temiz(), SahteEkran.goruntuTamam(0.0), arg = CmdArg.Zoom(0, 0, 10, 10)))
    }

    @Test
    fun goruntuSonrasiOnPlanDegistiyseRet() {
        val iki = izin(paketler = listOf(mesaj, notlar))
        val d = temiz()
        val degisenler = listOf(
            temiz(diger),
            temiz(notlar),
            temiz("com.android.settings"),
            temiz(banka),
            d.copy(aktifKokPaketi = diger),
            d.copy(sonOlayPaketi = diger),
            d.copy(odakPaketi = diger),
            d.copy(odakPaketi = klavyePaketi),
        )
        for (s in degisenler) {
            ret(DeniedNeden.ON_PLAN_IZIN_DISI, goruntu(s, SahteEkran.goruntuTamam(0.0), izn = iki))
            // resim ne olursa olsun: değişim, koruma ve siyahlıktan önce gelir
            ret(DeniedNeden.ON_PLAN_IZIN_DISI, goruntu(s, GoruntuSonucu.Korumali, izn = iki))
            ret(DeniedNeden.ON_PLAN_IZIN_DISI, goruntu(s, SahteEkran.goruntuTamam(1.0), izn = iki))
        }
    }

    @Test
    fun goruntuSonrasiPencereBelirdiyseRet() {
        val perde = SahteEkran.sistemPenceresi(PencereTuru.PERDE, "com.android.systemui")
        ret(DeniedNeden.IZIN_DISI_PENCERE, goruntu(pencereli(perde), SahteEkran.goruntuTamam(0.0)))
        val klavye = SahteEkran.sistemPenceresi(PencereTuru.KLAVYE, klavyePaketi)
        ret(DeniedNeden.IZIN_DISI_PENCERE, goruntu(pencereli(klavye), SahteEkran.goruntuTamam(0.0), CmdArg.Zoom(0, 0, 10, 10)))
    }

    @Test
    fun ekranKorumali() {
        ret(DeniedNeden.EKRAN_KORUMALI, goruntu(temiz(), GoruntuSonucu.Korumali))
        ret(DeniedNeden.EKRAN_KORUMALI, goruntu(temiz(), SahteEkran.goruntuTamam(0.99)))
        ret(DeniedNeden.EKRAN_KORUMALI, goruntu(temiz(), SahteEkran.goruntuTamam(CekirdekSinirlari.SIYAH_ESIGI)))
        ret(DeniedNeden.EKRAN_KORUMALI, goruntu(temiz(), SahteEkran.goruntuTamam(0.995)))
        ret(DeniedNeden.EKRAN_KORUMALI, goruntu(temiz(), SahteEkran.goruntuTamam(1.0)))
        ret(DeniedNeden.EKRAN_KORUMALI, goruntu(temiz(), GoruntuSonucu.Korumali, arg = CmdArg.Zoom(0, 0, 10, 10)))
    }

    // ---- saflık -----------------------------------------------------------------------------

    @Test
    fun kapiSaftirAyniGirdiAyniKarar() {
        val g = girdi(CmdArg.Key(Tus.BACK, 1))
        val ilk = Kapi.ekranDenetimi(g)
        repeat(5) { assertEquals(ilk, Kapi.ekranDenetimi(g)) }
        val gecerli = girdi(CmdArg.Screenshot)
        repeat(5) { izinli(Kapi.ekranDenetimi(gecerli)) }
    }
}
