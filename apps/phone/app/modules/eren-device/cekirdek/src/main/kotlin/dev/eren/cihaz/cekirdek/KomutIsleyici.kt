package dev.eren.cihaz.cekirdek

import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.ceil
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/*
 * Tek bir `cmd`'nin yaşamı: çöz (adım 0) -> kapı 1-10 -> port -> kural 11/12 -> `cmd_result`.
 * Eylem portu yalnız bütün denetimler ve `Izinler.harca` geçtikten sonra çağrılır. Kapının
 * kararına ek olarak birkaç temel koşul burada da sınanır: kapı yanılsa bile izinsiz eylem olmasın.
 * Kurallar: ../../../TASARIM.md "Kapı kural sırası".
 */

private val PAKET_BICIMI = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")
private val RESIM_TURLERI: Set<String> = setOf("image/jpeg", "image/png")
private const val AZAMI_OLCEK = 16.0

private fun paketMi(paket: String?): Boolean =
    paket != null && paket.length <= Sinirlar.PAKET_ADI && PAKET_BICIMI.matches(paket)

/** cihaz.ts `image_base64` düzenli ifadesinin döngüyle denetimi (8 MiB metinde düzenli ifade yok). */
private fun base64Mu(metin: String): Boolean {
    if (metin.isEmpty() || metin.length > Sinirlar.EKRAN_BASE64) return false
    var dolgu = 0
    for (c in metin) {
        if (c == '=') {
            dolgu++
            if (dolgu > 2) return false
        } else {
            val alfabe = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '+' || c == '/'
            if (!alfabe || dolgu > 0) return false
        }
    }
    return dolgu < metin.length
}

private fun kesildiyse(e: Exception) {
    if (e is InterruptedException) Thread.currentThread().interrupt()
}

/** Bir komutun iç sonucu: `paket` denetim satırı için, `atilir` bağlantı değiştiyse. */
private class Islem(
    val sonuc: CmdSonucu,
    val paket: String? = null,
    val geriCekilen: List<String> = emptyList(),
    val atilir: Boolean = false,
)

private class KomutIsleyiciGercek(
    private val ekran: EkranPortu,
    private val eylem: EylemPortu,
    private val saat: SaatPortu,
    private val izinler: Izinler,
    private val listeler: Listeler,
    private val denetim: DenetimKaydi,
    private val oturum: OturumBilgisi,
    private val sema: SemaIslemi,
    private val kapi: KapiIslemi,
    private val etiket: EtiketIslemi,
) : KomutIsleyici {
    private val calisiyor = AtomicBoolean(false)

    // Aşağıdakiler yalnız `calisiyor` tutulurken okunur ve yazılır; CAS görünürlüğü sağlar.
    private var sonEylemMs: Long? = null
    private var sonGoruntuMs: Long? = null

    // Koordinatlar son ekran görüntüsünün pikselidir (CIHAZ.md); ölçek o bağlantıya aittir.
    private var olcekBaglantisi: Long? = null
    private var olcek: Double = 1.0

    override fun isle(ham: String): List<String> {
        val gelen = try {
            sema.gelen(ham)
        } catch (e: Exception) {
            kesildiyse(e)
            return emptyList()
        }
        return when (gelen) {
            is GelenCerceve.Komut -> komut(gelen.cmd)
            is GelenCerceve.KomutReddi -> reddi(gelen)
            // `CihazOturumu` buraya yalnız `cmd` verir; başka çerçeve hiçbir şey yaptırmaz.
            else -> emptyList()
        }
    }

    private fun reddi(r: GelenCerceve.KomutReddi): List<String> {
        val (metin, son) = cikis(r.cmdId, null, ret(r.neden))
        kaydet(r.cmdId, null, null, son, null)
        return if (metin == null) emptyList() else listOf(metin)
    }

    private fun komut(cmd: Cmd): List<String> {
        // Kural 1: ikinci komut hiçbir şey okumaz, beklemez, durumu değiştirmez.
        if (!calisiyor.compareAndSet(false, true)) return bitir(cmd, Islem(ret(DeniedNeden.MESGUL)), false)
        try {
            var baglanti: Long? = null
            val islem = try {
                val b = oturum.baglantiNo()
                baglanti = b
                calistir(cmd, b)
            } catch (e: Exception) {
                kesildiyse(e)
                Islem(hataSonucu(genelHata(cmd.arg.ad)))
            }
            val atilir = islem.atilir || baglanti == null || baglantiDegisti(baglanti)
            return bitir(cmd, islem, atilir)
        } finally {
            calisiyor.set(false)
        }
    }

    private fun bitir(cmd: Cmd, islem: Islem, atilir: Boolean): List<String> {
        val (metin, son) = cikis(cmd.cmdId, cmd.token, islem.sonuc)
        kaydet(cmd.cmdId, cmd.grantId, cmd.arg.ad, son, islem.paket)
        if (atilir) return emptyList()
        val giden = ArrayList<String>(1 + islem.geriCekilen.size)
        if (metin != null) giden.add(metin)
        for (id in islem.geriCekilen) {
            val iptal = try {
                sema.grantRevoked(id, GrantNedeni.BUTCE_BITTI)
            } catch (e: Exception) {
                kesildiyse(e)
                null
            }
            if (iptal != null) giden.add(iptal)
        }
        return giden
    }

    private fun calistir(cmd: Cmd, baglanti: Long): Islem {
        // Kural 1-5: yalnız bellek ve saat, ekran okunmadan.
        val pcSimdi = oturum.pcSimdiMs()
        val bulgu = izinler.bul(cmd.grantId, cmd.token)
        val k1 = kapi.izinDenetimi(cmd, false, pcSimdi, bulgu)
        if (k1 is Karar.Reddedildi) return Islem(ret(k1.neden))
        if (pcSimdi == null || pcSimdi > cmd.deadlineMs) return Islem(ret(DeniedNeden.DEADLINE_GECTI))
        val gecerli = when (bulgu) {
            is IzinBulgusu.Gecersiz -> return Islem(ret(bulgu.neden))
            is IzinBulgusu.Gecerli -> bulgu
        }
        val izin = gecerli.izin

        // Kural 6-7.
        val durum = ekran.durum()
        val k2 = kapi.durumDenetimi(durum)
        if (k2 is Karar.Reddedildi) return Islem(ret(k2.neden))
        if (!durum.a11y) return Islem(ret(DeniedNeden.ERISILEBILIRLIK_KAPALI))
        if (durum.kilitli) return Islem(ret(DeniedNeden.KILIT_EKRANI))

        // Aralık beklemesi ekran okunmadan önce: kural 8 ile port arasına uyku girmesin.
        val ad = cmd.arg.ad
        if (ad in CekirdekSinirlari.EYLEM_KOMUTLARI) aralikBekle(sonEylemMs, CekirdekSinirlari.EYLEM_ARASI_MS)
        if (ad == CmdAdi.SCREENSHOT || ad == CmdAdi.ZOOM) {
            aralikBekle(sonGoruntuMs, CekirdekSinirlari.GORUNTU_ARASI_MS)
        }

        // Kapı ve port aynı gerçek pikseli görsün diye koordinat kapıdan önce çevrilir.
        val o = olcekAl(baglanti)
        val gcmd = cmd.copy(arg = gercekKoordinat(cmd.arg, o))

        // Kural 8-10.
        val anlik = ekran.anlik()
        val gerekir = hedefGerekir(gcmd.arg)
        val hedef = if (gerekir) hedefOku(gcmd.arg) else null
        if (gerekir && hedef == null) {
            return Islem(hataSonucu(CihazHatasi.ELEMENT_BULUNAMADI, anlik, izin), anlik.aktifKokPaketi)
        }
        val girdi = EkranDenetimGirdisi(gcmd, izin, gecerli.kullanilanMaddeler, anlik, hedef, listeler)
        val k3 = kapi.ekranDenetimi(girdi)
        if (k3 is Karar.Reddedildi) return Islem(ret(k3.neden, anlik, izin), anlik.aktifKokPaketi)

        return when (val arg = gcmd.arg) {
            CmdArg.Foreground -> Islem(tamam(anlik, izin), anlik.aktifKokPaketi)
            is CmdArg.Wait -> bekle(cmd, arg, anlik, izin)
            is CmdArg.Elements -> elementler(arg, anlik, izin, o)
            CmdArg.Screenshot, is CmdArg.Zoom -> goruntu(girdi, baglanti)
            is CmdArg.Click,
            is CmdArg.TypeText,
            is CmdArg.Key,
            is CmdArg.Scroll,
            is CmdArg.Drag,
            is CmdArg.OpenApp,
            -> eyleme(girdi, baglanti)
        }
    }

    private fun bekle(cmd: Cmd, arg: CmdArg.Wait, anlik: AnlikDurum, izin: IzinKaydi): Islem {
        val ms = ceil(arg.saniye * 1000.0).toLong().coerceIn(1L, Sinirlar.BEKLEME_SANIYE_MAX * 1000L)
        saat.uyu(ms)
        // Uykuda izin bitmiş olabilir: o zaman ön plan yeniden okunmaz.
        val taze = izinler.bul(cmd.grantId, cmd.token)
        if (taze !is IzinBulgusu.Gecerli) return Islem(tamam(null, izin), anlik.aktifKokPaketi)
        val sonra = ekran.anlik()
        return Islem(tamam(sonra, taze.izin), sonra.aktifKokPaketi)
    }

    private fun elementler(arg: CmdArg.Elements, anlik: AnlikDurum, izin: IzinKaydi, o: Double): Islem {
        val okuma = ekran.elementler()
        val izinli = izin.uygulamalar.mapTo(HashSet()) { it.paket }
        val acikMi = HashMap<String, Boolean>()
        val sorgu = arg.sorgu?.let { etiket.katla(it) }?.takeIf { it.isNotEmpty() }
        val cikan = ArrayList<Element>()
        var kirpildi = okuma.kirpildi
        for (d in okuma.dugumler) {
            val paket = d.paket ?: continue
            if (d.no < 0) continue
            val acik = acikMi.getOrPut(paket) { paket in izinli && listeler.durum(paket) == UygulamaDurumu.ACIK }
            if (!acik) continue
            // Parola değeri ne çıkar ne de sorgu eşleşmesine katılır (varlığı da sızmasın).
            val parola = d.parola || etiket.parolaAlani(d)
            val deger = if (parola) null else d.deger
            if (sorgu != null &&
                !etiket.katla(d.ad).contains(sorgu) &&
                (deger == null || !etiket.katla(deger).contains(sorgu))
            ) {
                continue
            }
            if (cikan.size >= Sinirlar.ELEMENT_ADET) {
                kirpildi = true
                break
            }
            cikan.add(
                Element(
                    id = d.no,
                    rol = d.rol,
                    ad = d.ad,
                    deger = deger,
                    x = resimKoordinati(d.sinir.sol, d.sinir.sag, o),
                    y = resimKoordinati(d.sinir.ust, d.sinir.alt, o),
                    etkinDegil = !d.etkin,
                    parola = parola,
                ),
            )
        }
        return Islem(tamam(anlik, izin, CmdPayload.Elementler(kirpildi, cikan)), anlik.aktifKokPaketi)
    }

    private fun goruntu(girdi: EkranDenetimGirdisi, baglanti: Long): Islem {
        val izin = girdi.izin
        val once = girdi.anlik
        if (baglantiDegisti(baglanti)) {
            return Islem(hataSonucu(CihazHatasi.EKRAN_ALINAMADI, once, izin), once.aktifKokPaketi, atilir = true)
        }
        val bolge = (girdi.cmd.arg as? CmdArg.Zoom)?.let { Dikdortgen(it.x0, it.y0, it.x1, it.y1) }
        val resim = try {
            ekran.goruntu(bolge)
        } finally {
            sonGoruntuMs = simdiMs() ?: sonGoruntuMs
        }
        val tamamResim = when (resim) {
            is GoruntuSonucu.Basarisiz -> return Islem(hataSonucu(resim.hata, once, izin), once.aktifKokPaketi)
            GoruntuSonucu.Korumali -> null
            is GoruntuSonucu.Tamam -> resim
        }

        // Kural 12: görüntüden sonra ön plan yeniden; tutmazsa resim atılır.
        val sonra = ekran.anlik()
        val k = kapi.goruntuDenetimi(girdi, sonra, resim)
        if (k is Karar.Reddedildi) return Islem(ret(k.neden, sonra, izin), sonra.aktifKokPaketi)
        if (sonra.aktifKokPaketi != once.aktifKokPaketi || sonra.odakPaketi != once.odakPaketi) {
            return Islem(ret(DeniedNeden.ON_PLAN_IZIN_DISI, sonra, izin), sonra.aktifKokPaketi)
        }
        // `NaN` da korumalı sayılır.
        if (tamamResim == null || !(tamamResim.siyahOrani < CekirdekSinirlari.SIYAH_ESIGI)) {
            return Islem(ret(DeniedNeden.EKRAN_KORUMALI, sonra, izin), sonra.aktifKokPaketi)
        }
        if (!resimGecerli(tamamResim)) {
            return Islem(hataSonucu(CihazHatasi.EKRAN_ALINAMADI, sonra, izin), sonra.aktifKokPaketi)
        }
        if (girdi.cmd.arg == CmdArg.Screenshot) {
            olcekBaglantisi = baglanti
            olcek = tamamResim.olcek
        }
        val payload = CmdPayload.Goruntu(
            mime = tamamResim.mime,
            base64 = tamamResim.base64,
            genislik = tamamResim.genislik,
            yukseklik = tamamResim.yukseklik,
            olcek = tamamResim.olcek,
        )
        return Islem(tamam(sonra, izin, payload), sonra.aktifKokPaketi)
    }

    private fun eyleme(girdi: EkranDenetimGirdisi, baglanti: Long): Islem {
        val izin = girdi.izin
        val arg = girdi.cmd.arg

        // Kural 11: eylemden hemen önce ön plan ve hedef yeniden okunur, kapı yeniden sorulur.
        val anlik = ekran.anlik()
        val gerekir = hedefGerekir(arg)
        val hedef = if (gerekir) hedefOku(arg) else null
        if (gerekir && hedef == null) {
            return Islem(hataSonucu(CihazHatasi.ELEMENT_BULUNAMADI, anlik, izin), anlik.aktifKokPaketi)
        }
        val k = kapi.ekranDenetimi(girdi.copy(anlik = anlik, hedef = hedef))
        if (k is Karar.Reddedildi) return Islem(ret(k.neden, anlik, izin), anlik.aktifKokPaketi)
        if (!eylemYeriIzinli(arg, anlik, hedef, izin)) {
            return Islem(ret(DeniedNeden.ON_PLAN_IZIN_DISI, anlik, izin), anlik.aktifKokPaketi)
        }
        if (baglantiDegisti(baglanti)) {
            return Islem(hataSonucu(CihazHatasi.EYLEM_BASARISIZ, anlik, izin), anlik.aktifKokPaketi, atilir = true)
        }

        // Bütçe yalnız her şey geçtikten sonra, eylemden hemen önce düşer.
        val kalan = when (val harcama = izinler.harca(girdi.cmd.grantId, (arg as? CmdArg.TypeText)?.metin)) {
            is Harcama.Ret -> return Islem(ret(harcama.neden, anlik, izin), anlik.aktifKokPaketi)
            is Harcama.Tamam -> harcama.kalanButce
        }
        val sonuc = try {
            eylemCagir(arg, hedef)
        } catch (e: Exception) {
            kesildiyse(e)
            EylemSonucu.Basarisiz(CihazHatasi.EYLEM_BASARISIZ)
        } finally {
            sonEylemMs = simdiMs() ?: sonEylemMs
        }

        val geriCekilen = if (kalan > 0) {
            emptyList()
        } else {
            try {
                izinler.geriCek(girdi.cmd.grantId, GrantNedeni.BUTCE_BITTI)
            } catch (e: Exception) {
                kesildiyse(e)
                emptyList()
            }
        }
        val sonra = try {
            ekran.anlik()
        } catch (e: Exception) {
            kesildiyse(e)
            null
        }
        val cmdSonucu = when (sonuc) {
            EylemSonucu.Gonderildi -> tamam(sonra, izin)
            is EylemSonucu.Basarisiz -> hataSonucu(sonuc.hata, sonra, izin)
        }
        return Islem(cmdSonucu, anlik.aktifKokPaketi, geriCekilen)
    }

    private fun eylemCagir(arg: CmdArg, hedef: DugumBaglami?): EylemSonucu = when (arg) {
        is CmdArg.Click -> {
            val nokta = arg.nokta
            when {
                arg.element != null && hedef != null -> eylem.dugumeDokun(hedef.dugum.no, arg.tiklama, arg.uzunBasma)
                arg.element == null && nokta != null -> eylem.noktayaDokun(nokta, arg.tiklama, arg.uzunBasma)
                else -> EylemSonucu.Basarisiz(CihazHatasi.ELEMENT_BULUNAMADI)
            }
        }
        is CmdArg.TypeText ->
            if (hedef != null) {
                eylem.metinYaz(hedef.dugum.no, arg.metin)
            } else {
                EylemSonucu.Basarisiz(CihazHatasi.ELEMENT_BULUNAMADI)
            }
        is CmdArg.Key -> eylem.tus(arg.tus, arg.tekrar)
        is CmdArg.Scroll -> eylem.kaydir(arg.yon, arg.miktar, arg.nokta)
        is CmdArg.Drag -> eylem.surukle(Nokta(arg.x0, arg.y0), Nokta(arg.x1, arg.y1))
        is CmdArg.OpenApp -> eylem.uygulamaAc(arg.paket)
        CmdArg.Foreground,
        is CmdArg.Elements,
        CmdArg.Screenshot,
        is CmdArg.Zoom,
        is CmdArg.Wait,
        -> EylemSonucu.Basarisiz(CihazHatasi.EYLEM_BASARISIZ)
    }

    /** Kapıdan bağımsız taban: eylemin dokunduğu paket izinli ve açık olmalı. */
    private fun eylemYeriIzinli(arg: CmdArg, anlik: AnlikDurum, hedef: DugumBaglami?, izin: IzinKaydi): Boolean {
        if (arg is CmdArg.OpenApp) return izinliPaket(arg.paket, izin)
        if (!onPlanIzinli(anlik, izin)) return false
        return hedef == null || izinliPaket(hedef.dugum.paket, izin)
    }

    private fun hedefGerekir(arg: CmdArg): Boolean =
        (arg is CmdArg.Click && arg.element != null) || arg is CmdArg.TypeText

    private fun hedefOku(arg: CmdArg): DugumBaglami? = when (arg) {
        is CmdArg.Click -> arg.element?.let { no -> ekran.dugum(no)?.takeIf { it.dugum.no == no } }
        is CmdArg.TypeText -> ekran.odak()
        else -> null
    }

    private fun izinliPaket(paket: String?, izin: IzinKaydi): Boolean =
        paket != null &&
            izin.uygulamalar.any { it.paket == paket } &&
            listeler.durum(paket) == UygulamaDurumu.ACIK

    private fun onPlanIzinli(anlik: AnlikDurum, izin: IzinKaydi): Boolean {
        val aktif = anlik.aktifKokPaketi
        val sonOlay = anlik.sonOlayPaketi
        // SystemUI son olayı ön plan değişimi değildir (bkz. `SISTEM_ARAYUZU_PAKETI`).
        return izinliPaket(aktif, izin) && anlik.odakPaketi == aktif &&
            (sonOlay == null || (aktif != null && sonOlayOnPlanla(sonOlay, aktif)))
    }

    /** İzin dışı ya da tutarsız ön planda başlık boş; paket biçimsizse `foreground:null`. */
    private fun onPlan(anlik: AnlikDurum?, izin: IzinKaydi?): OnPlan? {
        if (anlik == null) return null
        val paket = anlik.aktifKokPaketi
        if (paket == null || !paketMi(paket)) return null
        val baslik = if (izin != null && onPlanIzinli(anlik, izin)) anlik.baslik.orEmpty() else ""
        return OnPlan(baslik, paket)
    }

    private fun ret(neden: DeniedNeden, anlik: AnlikDurum? = null, izin: IzinKaydi? = null): CmdSonucu =
        CmdSonucu(ok = false, foreground = onPlan(anlik, izin), payload = null, denied = neden, hata = null)

    private fun hataSonucu(hata: CihazHatasi, anlik: AnlikDurum? = null, izin: IzinKaydi? = null): CmdSonucu =
        CmdSonucu(ok = false, foreground = onPlan(anlik, izin), payload = null, denied = null, hata = hata)

    private fun tamam(anlik: AnlikDurum?, izin: IzinKaydi, payload: CmdPayload? = null): CmdSonucu =
        CmdSonucu(ok = true, foreground = onPlan(anlik, izin), payload = payload, denied = null, hata = null)

    private fun genelHata(ad: CmdAdi): CihazHatasi =
        if (ad == CmdAdi.SCREENSHOT || ad == CmdAdi.ZOOM) CihazHatasi.EKRAN_ALINAMADI else CihazHatasi.EYLEM_BASARISIZ

    private fun resimGecerli(r: GoruntuSonucu.Tamam): Boolean =
        r.mime in RESIM_TURLERI &&
            r.genislik in 1..Sinirlar.KOORDINAT_MAX &&
            r.yukseklik in 1..Sinirlar.KOORDINAT_MAX &&
            r.olcek.isFinite() && r.olcek > 0.0 && r.olcek <= AZAMI_OLCEK &&
            base64Mu(r.base64)

    /**
     * Çıkan çerçeve. Okunan ekran metni bu komutun jetonunu yansıtıyorsa (ör. bir alana yazılmışsa)
     * ön plan ve yük atılır; okuma komutu sonuçsuz kalır.
     */
    private fun cikis(cmdId: String, token: String?, sonuc: CmdSonucu): Pair<String?, CmdSonucu> {
        val metin = cmdResultYaz(cmdId, sonuc) ?: return null to sonuc
        if (token.isNullOrEmpty() || !metin.contains(token)) return metin to sonuc
        val temiz = if (sonuc.ok && sonuc.payload != null) {
            CmdSonucu(ok = false, foreground = null, payload = null, denied = null, hata = CihazHatasi.EYLEM_BASARISIZ)
        } else {
            sonuc.copy(foreground = null, payload = null)
        }
        return cmdResultYaz(cmdId, temiz) to temiz
    }

    private fun cmdResultYaz(cmdId: String, sonuc: CmdSonucu): String? = try {
        sema.cmdResult(cmdId, sonuc)
    } catch (e: Exception) {
        kesildiyse(e)
        null
    }

    private fun kaydet(cmdId: String, grantId: String?, komut: CmdAdi?, sonuc: CmdSonucu, paket: String?) {
        try {
            denetim.komut(cmdId, grantId, komut, sonuc.denied, sonuc.hata, paket?.takeIf { paketMi(it) })
        } catch (e: Exception) {
            kesildiyse(e)
        }
    }

    private fun baglantiDegisti(baglanti: Long): Boolean = try {
        oturum.baglantiNo() != baglanti
    } catch (e: Exception) {
        kesildiyse(e)
        true
    }

    private fun simdiMs(): Long? = try {
        saat.monotonikMs()
    } catch (e: Exception) {
        kesildiyse(e)
        null
    }

    private fun aralikBekle(son: Long?, aralik: Long) {
        if (son == null) return
        val kalan = (son + aralik - saat.monotonikMs()).coerceAtMost(aralik)
        if (kalan > 0) saat.uyu(kalan)
    }

    private fun olcekAl(baglanti: Long): Double = if (olcekBaglantisi == baglanti) olcek else 1.0

    private fun gercekKoordinat(arg: CmdArg, o: Double): CmdArg {
        if (o == 1.0) return arg
        return when (arg) {
            is CmdArg.Click -> arg.copy(nokta = arg.nokta?.let { Nokta(gercek(it.x, o), gercek(it.y, o)) })
            is CmdArg.Scroll -> arg.copy(nokta = arg.nokta?.let { Nokta(gercek(it.x, o), gercek(it.y, o)) })
            is CmdArg.Drag -> CmdArg.Drag(gercek(arg.x0, o), gercek(arg.y0, o), gercek(arg.x1, o), gercek(arg.y1, o))
            is CmdArg.Zoom -> {
                val x0 = gercek(arg.x0, o)
                val y0 = gercek(arg.y0, o)
                // Yuvarlama boş bölge üretmesin.
                CmdArg.Zoom(x0, y0, maxOf(gercek(arg.x1, o), x0 + 1), maxOf(gercek(arg.y1, o), y0 + 1))
            }
            CmdArg.Foreground,
            is CmdArg.Elements,
            CmdArg.Screenshot,
            is CmdArg.TypeText,
            is CmdArg.Key,
            is CmdArg.Wait,
            is CmdArg.OpenApp,
            -> arg
        }
    }

    private fun gercek(v: Int, o: Double): Int = (v * o).roundToInt()

    /** Gerçek pikselde iki kenarın ortası, resim pikseline; kablo aralığına sıkıştırılır. */
    private fun resimKoordinati(bas: Int, son: Int, o: Double): Int {
        val merkez = (bas.toLong() + son.toLong()) / 2
        return (merkez / o).roundToLong().coerceIn(0L, Sinirlar.KOORDINAT_MAX.toLong()).toInt()
    }
}

val komutIsleyiciKur: KomutIsleyiciFabrikasi =
    KomutIsleyiciFabrikasi { ekran, eylem, saat, izinler, listeler, denetim, oturum ->
        KomutIsleyiciGercek(ekran, eylem, saat, izinler, listeler, denetim, oturum, Sema, Kapi, Etiket)
    }
