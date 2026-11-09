package dev.eren.cihaz.cekirdek

/*
 * `/cihaz` oturumu (CIHAZ.md "El sıkışma", "Saat", "İzinler", "Durum, uygulama listesi, bildirim").
 * Oturum eylem yapmaz, ekran içeriği okumaz: `cmd` yalnız `OturumCiktisi.komut` ile dışarı verilir.
 * Kapatan her yol durumu hemen `KAPALI` yapar ve bağlantı numarasını artırır; böylece kopmadan önce
 * başlamış komutun sonucu yeni bağlantıya gitmez (`KomutIsleyici` numarayı karşılaştırır).
 */

val cihazOturumuKur: CihazOturumuFabrikasi =
    CihazOturumuFabrikasi { eslesme, anahtar, rastgele, saat, ekran, izinler, listeler, denetim ->
        CihazOturumuGercek(eslesme, anahtar, rastgele, saat, ekran, izinler, listeler, denetim)
    }

// Yeniden oynatma denetimi için akılda tutulan `server_nonce` sayısı. İmza zaten taze
// `client_nonce`'a bağlı; bu liste ikinci bir kat, sınırsız büyümesin diye en eskisi düşer.
private const val GORULEN_NONCE_AZAMI = 1_024

// Gösterilmeyi bekleyen bildirim kimlikleri: `notify_ack` yalnız bu bağlantıda gelmiş olana gider.
private const val BEKLEYEN_BILDIRIM_AZAMI = 64

private const val BASE64_ABECE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

private class CihazOturumuGercek(
    private val eslesme: Eslesme,
    private val anahtar: AnahtarPortu,
    private val rastgele: RastgelePortu,
    private val saat: SaatPortu,
    private val ekran: EkranPortu,
    private val izinler: Izinler,
    private val listeler: Listeler,
    private val denetim: DenetimKaydi,
) : CihazOturumu {
    private val kilit = Any()

    // Komut işçisi bu üçünü kilitsiz okur; yazım hep kilit altında.
    @Volatile private var durumu: OturumDurumu = OturumDurumu.KAPALI

    @Volatile private var baglantiSayaci: Long = 0

    /** Yalnız `DOGRULANDI` iken dolu. */
    @Volatile private var farkMs: Long? = null

    private var clientNonce: String? = null
    private val gorulenSunucuNonceleri = LinkedHashSet<String>()
    private val bekleyenBildirimler = LinkedHashSet<String>()

    // ------------------------------------------------------------------------------------------
    // OturumBilgisi
    // ------------------------------------------------------------------------------------------

    override fun pcSimdiMs(): Long? {
        val fark = farkMs ?: return null
        return saat.duvarMs() + fark
    }

    override fun baglantiNo(): Long = baglantiSayaci

    override fun durum(): OturumDurumu = durumu

    // ------------------------------------------------------------------------------------------
    // Bağlantı
    // ------------------------------------------------------------------------------------------

    override fun baglandi(): OturumCiktisi = guvenli {
        kapan()
        val nonce = base64(rastgele.baytlar(CekirdekSinirlari.NONCE_BAYT))
        clientNonce = nonce
        durumu = OturumDurumu.SINAMA_BEKLENIYOR
        cikti(listOf(Sema.hello(eslesme.deviceId, nonce)))
    }

    override fun koptu() {
        synchronized(kilit) { kapan() }
    }

    override fun gelen(ham: String): OturumCiktisi = guvenli {
        if (durumu == OturumDurumu.KAPALI) {
            OturumCiktisi(emptyList(), emptyList(), null, true)
        } else {
            when (val c = Sema.gelen(ham)) {
                is GelenCerceve.Gecersiz -> yalnizKapat(c.neden.kod)
                is GelenCerceve.PcHatasi -> {
                    kapan()
                    OturumCiktisi(emptyList(), listOf(OturumOlayi.Kapaniyor(c.kod, true)), null, true)
                }
                is GelenCerceve.AuthChallenge -> sinama(c)
                is GelenCerceve.Welcome -> karsilama(c)
                is GelenCerceve.Komut, is GelenCerceve.KomutReddi ->
                    if (durumu == OturumDurumu.DOGRULANDI) {
                        OturumCiktisi(emptyList(), emptyList(), ham, false)
                    } else {
                        yalnizKapat(HataKodu.YETKISIZ)
                    }
                is GelenCerceve.Bildirim -> bildirim(c)
                is GelenCerceve.IzinGeriCek -> pcGeriCekti(c)
            }
        }
    }

    private fun sinama(c: GelenCerceve.AuthChallenge): OturumCiktisi {
        // İkinci `auth_challenge` da sıra dışıdır.
        if (durumu != OturumDurumu.SINAMA_BEKLENIYOR) return yalnizKapat(HataKodu.YETKISIZ)
        val cn = clientNonce ?: return yalnizKapat(HataKodu.YETKISIZ)
        if (c.serverNonce == cn) return sessizKapat()
        if (!gorulenSunucuNonceleri.sinirliEkle(c.serverNonce, GORULEN_NONCE_AZAMI)) return sessizKapat()

        val pcMetni = KimlikMetni.metin(ImzaRolu.PC, Kanal.CIHAZ, eslesme.deviceId, cn, c.serverNonce)
            ?: return sessizKapat()
        // Doğrulanmamış bilgisayara hiçbir çerçeve gitmez, `error` bile.
        if (!anahtar.dogrula(eslesme.pcAcikAnahtar, pcMetni, c.serverImza)) return sessizKapat()

        val telefonMetni = KimlikMetni.metin(ImzaRolu.TELEFON, Kanal.CIHAZ, eslesme.deviceId, cn, c.serverNonce)
            ?: return icHata()
        val imza = anahtar.imzala(telefonMetni)
        durumu = OturumDurumu.KARSILAMA_BEKLENIYOR
        return cikti(listOf(Sema.authResponse(imza)))
    }

    private fun karsilama(c: GelenCerceve.Welcome): OturumCiktisi {
        if (durumu != OturumDurumu.KARSILAMA_BEKLENIYOR) return yalnizKapat(HataKodu.YETKISIZ)
        val fark = c.sunucuZamaniMs - saat.duvarMs()

        // Çerçeveler durum değişmeden kurulur: biri atarsa oturum yarı doğrulanmış kalmaz.
        val giden = ArrayList<String>()
        giden += Sema.deviceState(ekran.durum())
        giden += Sema.appList(listeler.uygulamalar())
        val aktifler = izinler.aktifler()
        for (a in aktifler) {
            if (yayinlanabilir(a)) giden += Sema.grantIssued(a.kayit, a.kalanMs)
        }
        val aktifKimlikler = aktifler.mapTo(HashSet()) { it.kayit.grantId }
        val eskiler = izinler.eskiSurectenKalanlar().filter { it !in aktifKimlikler }
        giden += geriCekildiCerceveleri(eskiler, GrantNedeni.SURESI_BITTI)

        farkMs = fark
        durumu = OturumDurumu.DOGRULANDI
        baglantiSayaci += 1
        denetim.baglantiAcildi()
        return OturumCiktisi(giden, listOf(OturumOlayi.Dogrulandi), null, false)
    }

    private fun bildirim(c: GelenCerceve.Bildirim): OturumCiktisi {
        if (durumu != OturumDurumu.DOGRULANDI) return yalnizKapat(HataKodu.YETKISIZ)
        bekleyenBildirimler.sinirliEkle(c.notifyId, BEKLEYEN_BILDIRIM_AZAMI)
        val olay = OturumOlayi.Bildirim(
            c.notifyId,
            c.tur,
            bildirimMetni(c.baslik, Sinirlar.BILDIRIM_BASLIK),
            bildirimMetni(c.metin, Sinirlar.BILDIRIM_METIN),
        )
        return cikti(emptyList(), listOf(olay))
    }

    private fun pcGeriCekti(c: GelenCerceve.IzinGeriCek): OturumCiktisi {
        if (durumu != OturumDurumu.DOGRULANDI) return yalnizKapat(HataKodu.YETKISIZ)
        val kimlikler = izinler.geriCek(c.grantId, c.neden)
        return cikti(geriCekildiCerceveleri(kimlikler, c.neden), izinOlaylari(kimlikler))
    }

    // ------------------------------------------------------------------------------------------
    // Telefondan gelen değişimler: doğrulanmamışken yan etki olur, çerçeve olmaz
    // ------------------------------------------------------------------------------------------

    override fun izinEklendi(izin: IzinKaydi): OturumCiktisi = guvenli {
        val olaylar = listOf<OturumOlayi>(OturumOlayi.IzinlerDegisti)
        if (durumu != OturumDurumu.DOGRULANDI) {
            cikti(emptyList(), olaylar)
        } else {
            // Kümedeki güncel kayıt yollanır: arada geri çekilmiş ya da bitmiş izin yayınlanmaz.
            val a = izinler.aktifler().firstOrNull { it.kayit.grantId == izin.grantId }
            val giden = if (a != null && yayinlanabilir(a)) listOf(Sema.grantIssued(a.kayit, a.kalanMs)) else emptyList()
            cikti(giden, olaylar)
        }
    }

    override fun izinGeriCek(grantId: String?, neden: GrantNedeni): OturumCiktisi = guvenli {
        val kimlikler = izinler.geriCek(grantId, neden)
        val giden = if (durumu == OturumDurumu.DOGRULANDI) geriCekildiCerceveleri(kimlikler, neden) else emptyList()
        cikti(giden, izinOlaylari(kimlikler))
    }

    override fun tik(): OturumCiktisi = guvenli {
        val kimlikler = izinler.suresiGecenler()
        val giden = if (durumu == OturumDurumu.DOGRULANDI) {
            geriCekildiCerceveleri(kimlikler, GrantNedeni.SURESI_BITTI)
        } else {
            emptyList()
        }
        cikti(giden, izinOlaylari(kimlikler))
    }

    override fun cihazDurumuDegisti(): OturumCiktisi = guvenli {
        if (durumu == OturumDurumu.DOGRULANDI) cikti(listOf(Sema.deviceState(ekran.durum()))) else BOS
    }

    override fun uygulamalarDegisti(): OturumCiktisi = guvenli {
        if (durumu == OturumDurumu.DOGRULANDI) cikti(listOf(Sema.appList(listeler.uygulamalar()))) else BOS
    }

    override fun bildirimGosterildi(notifyId: String): OturumCiktisi = guvenli {
        if (durumu == OturumDurumu.DOGRULANDI && bekleyenBildirimler.remove(notifyId)) {
            cikti(listOf(Sema.notifyAck(notifyId)))
        } else {
            BOS
        }
    }

    // ------------------------------------------------------------------------------------------
    // Yardımcılar (hepsi kilit altında çağrılır)
    // ------------------------------------------------------------------------------------------

    /** Port ya da bağımlı birim atarsa istisna dışarı sızmaz: oturum kapanır. */
    private inline fun guvenli(blok: () -> OturumCiktisi): OturumCiktisi =
        synchronized(kilit) {
            try {
                blok()
            } catch (e: Exception) {
                icHata()
            }
        }

    private fun kapan() {
        if (durumu == OturumDurumu.KAPALI) return
        val dogrulanmisti = durumu == OturumDurumu.DOGRULANDI
        durumu = OturumDurumu.KAPALI
        farkMs = null
        clientNonce = null
        bekleyenBildirimler.clear()
        baglantiSayaci += 1
        if (dogrulanmisti) {
            try {
                denetim.baglantiKoptu()
            } catch (e: Exception) {
                // Denetim yazılamadı; kapanış yine tamamlanır.
            }
        }
    }

    private fun yalnizKapat(kod: HataKodu): OturumCiktisi {
        // Telefon `/cihaz`'da `error` yollamaz (CihazYukari'da yok): yalnız kapanır.
        kapan()
        return OturumCiktisi(emptyList(), listOf(OturumOlayi.Kapaniyor(kod, false)), null, true)
    }

    private fun sessizKapat(): OturumCiktisi {
        kapan()
        return OturumCiktisi(emptyList(), listOf(OturumOlayi.Kapaniyor(HataKodu.IMZA_GECERSIZ, false)), null, true)
    }

    // İç hatada da çerçeve yollanmaz: hatanın nedeni dışarı taşınmaz.
    private fun icHata(): OturumCiktisi {
        kapan()
        return OturumCiktisi(emptyList(), listOf(OturumOlayi.Kapaniyor(HataKodu.IC_HATA, false)), null, true)
    }

    private fun yayinlanabilir(a: AktifIzin): Boolean = a.kalanMs >= 1 && a.kayit.kalanButce >= 1

    private fun geriCekildiCerceveleri(kimlikler: List<String>, neden: GrantNedeni): List<String> =
        kimlikler.distinct().filter(::opakIdMi).map { Sema.grantRevoked(it, neden) }

    private fun izinOlaylari(kimlikler: List<String>): List<OturumOlayi> =
        if (kimlikler.isEmpty()) emptyList() else listOf(OturumOlayi.IzinlerDegisti)

    private fun cikti(giden: List<String>, olaylar: List<OturumOlayi> = emptyList()): OturumCiktisi =
        OturumCiktisi(giden, olaylar, null, false)

    private companion object {
        val BOS = OturumCiktisi(emptyList(), emptyList(), null, false)
    }
}

/** Eklenen öğe yeniyse doğru; sınır aşılınca en eski öğe düşer. */
private fun <T> LinkedHashSet<T>.sinirliEkle(oge: T, azami: Int): Boolean {
    val yeni = add(oge)
    while (size > azami) {
        val i = iterator()
        i.next()
        i.remove()
    }
    return yeni
}

// Diskteki eski kimlikler bozuk olabilir; kablo biçimine uymayan kimlik çerçeveye girmez.
private fun opakIdMi(s: String): Boolean =
    s.length in 1..Sinirlar.OPAK_ID &&
        s.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '-' }

private fun base64(bayt: ByteArray): String {
    val sb = StringBuilder((bayt.size + 2) / 3 * 4)
    var i = 0
    while (i < bayt.size) {
        val kalan = bayt.size - i
        val b0 = bayt[i].toInt() and 0xff
        val b1 = if (kalan > 1) bayt[i + 1].toInt() and 0xff else 0
        val b2 = if (kalan > 2) bayt[i + 2].toInt() and 0xff else 0
        val n = (b0 shl 16) or (b1 shl 8) or b2
        sb.append(BASE64_ABECE[(n shr 18) and 0x3f])
        sb.append(BASE64_ABECE[(n shr 12) and 0x3f])
        sb.append(if (kalan > 1) BASE64_ABECE[(n shr 6) and 0x3f] else '=')
        sb.append(if (kalan > 2) BASE64_ABECE[n and 0x3f] else '=')
        i += 3
    }
    return sb.toString()
}

/**
 * Bildirim metni: satır ve paragraf ayırıcıları boşluk olur; kontrol, biçim, yön, sıfır genişlik
 * karakterleri ve eşsiz vekiller atılır (temel.ts `gorunmezBirimMi` kümesi dahil); sonra vekil
 * çifti bölünmeden `azami` UTF-16 birimine kırpılır. Göstermelik ikinci satır kurulamaz.
 */
private fun bildirimMetni(ham: String, azami: Int): String {
    val sb = StringBuilder(minOf(ham.length, azami))
    var i = 0
    while (i < ham.length) {
        val cp = ham.codePointAt(i)
        i += Character.charCount(cp)
        val ayirici = satirAyiriciMi(cp)
        if (!ayirici && gorunmezMi(cp)) continue
        val uzunluk = if (ayirici) 1 else Character.charCount(cp)
        if (sb.length + uzunluk > azami) break
        if (ayirici) sb.append(' ') else sb.appendCodePoint(cp)
    }
    return sb.toString().trim()
}

private fun satirAyiriciMi(cp: Int): Boolean =
    cp == 0x09 || cp == 0x0a || cp == 0x0b || cp == 0x0c || cp == 0x0d || cp == 0x85 || cp == 0x2028 || cp == 0x2029

private fun gorunmezMi(cp: Int): Boolean {
    val tur = Character.getType(cp)
    return tur == Character.CONTROL.toInt() ||
        tur == Character.FORMAT.toInt() ||
        tur == Character.SURROGATE.toInt() ||
        cp == 0xad ||
        cp == 0x061c ||
        cp in 0x200b..0x200f ||
        cp in 0x2028..0x202e ||
        cp in 0x2060..0x206f ||
        cp == 0xfeff
}
