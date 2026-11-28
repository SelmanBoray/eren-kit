package dev.eren.ajanda.birlestirme

import dev.eren.ajanda.ag.BaglantiKusagi
import dev.eren.ajanda.cekirdek.BirlestirmeOnizlemesi
import dev.eren.ajanda.cekirdek.BirlestirmeSonucu
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.KoparmaSonucu

/**
 * Birleştirme akışının çekirdekten gördüğü dar yüz (D4; kurallar `cekirdek/src/motor/birlestirme.rs`
 * başında). Çağrılar eşzamanlıdır, SQLite'a dokunur: ana iş parçacığından yapılmaz.
 */
interface BirlestirmeCekirdegi {
    fun birlestirmeOnizlemesi(): BirlestirmeOnizlemesi?
    fun birlestirmeyiOnayla(iz: String?): BirlestirmeSonucu
    fun birlestirmedenVazgec(): KoparmaSonucu

    /** Onay "bekleyen yok" dönünce birleştirmenin uygulanıp uygulanmadığını ayırmak için. */
    fun kip(): CalismaKipi
}

/** Gerçek çekirdeğe bağlanış. */
class CekirdekBirlestirmesi(private val c: Cekirdek) : BirlestirmeCekirdegi {
    override fun birlestirmeOnizlemesi(): BirlestirmeOnizlemesi? = c.birlestirmeOnizlemesi()
    override fun birlestirmeyiOnayla(iz: String?): BirlestirmeSonucu = c.birlestirmeyiOnayla(iz)
    override fun birlestirmedenVazgec(): KoparmaSonucu = c.birlestirmedenVazgec()
    override fun kip(): CalismaKipi = c.kip()
}

/**
 * SAHİBİ: D4 (Android). Yerel kipten Eren servisine bağlanırken birleştirme önizlemesinin akışı (saf, ekransız;
 * görünüm yalnız [Adim]'ı gösterir ve düğmeleri iletir). `AktarmaAkisi` kalıbı.
 *
 * - Çekirdek önizleme hazır olunca gözlemciye `Degisim.baglanti` yollar: görünüm [ilgili] doğruysa (çekirdek
 *   iş parçacığı dışında) [denetle] çağırır. Dönen `null`: sorulacak bir şey yok (açık soru varsa kapatılır).
 *   Görünüm açılışta (onStart) da [denetle] çağırır: arada kaçırılan bildirim olabilir.
 * - [Adim.Onay] gösterilen planın izini ([Adim.Onay.iz]) taşır. Düğmeler o adımı geri verir: olumlu
 *   [onayla]`(adim)`, olumsuz [vazgec], üçüncü [simdiDegil]`(adim)`. Onay hep o adımın iziyle yapılır: ekranda
 *   eski plan kaldıysa (arada [denetle] yeni plan getirdi, görünüm yenilemedi) çekirdek uygulamaz, yeni planla
 *   yeniden [Adim.Onay] döner.
 * - [onayla]: plan önizlemeden sonra değiştiyse yeni planla yeniden [Adim.Onay]; uygulandıysa sonuç [Adim.Bilgi];
 *   çekirdek "bekleyen yok" derse kip okunur: `BAGLI` ise birleştirme uygulanmıştır ("zaten bağlı"); çekirdek bu
 *   izin daha önce uygulandığını söylediyse (`zatenUygulandi`; ör. birleştirme, sonra koparma, sonra gecikmiş onay)
 *   kip yerel olsa da "daha önce tamamlanmıştı" denir; değilse `YEREL` bağlantı kopmuştur, hiçbir şey yazılmamıştır
 *   ("yeniden bağlanınca sorulacak"); kip de okunamazsa durum belirsizdir ve öyle söylenir. Aynı adımla ikinci onay (çift dokunma, iki iş
 *   parçacığı) çekirdeğe gitmez, ilk onayın sonucunu yeniden döner.
 * - [vazgec]: bağlanmayı iptal eder (eşleşme silinir, kayıtlar değişmez; yeniden bağlanmak için QR).
 * - [simdiDegil]: çekirdeğe gitmez; birleştirme onay beklemeyi sürdürür ([bekleyen], [ertelendi]: görünüm
 *   "bekleyen birleştirme" şeridi gösterebilir). Erteleme o plana (iz) ve o bağlantıya ([BaglantiKusagi]) bağlıdır:
 *   [denetle] plan değişince ya da yeni bir bağlantıda yeniden sorar (aradaki kopmayı görmemiş olsa da);
 *   `zorla = true` ile (şeride dokunuldu) her zaman sorar.
 *
 * İş parçacığı: bütün yöntemler eşzamanlıdır, çekirdeği çağırır; ana iş parçacığından çağrılmaz. Her iş
 * parçacığından çağrılabilir: durum ve çekirdek çağrıları tek kilit altında sıralanır (gözlemciden gelen
 * [denetle] ile düğmeden gelen [onayla] birbirinin ortasına girmez). Her [Exception] bir [Adim.Hata]'ya çevrilir.
 * Mahremiyet: metinler yalnız sayı taşır; kayıt başlığı ya da kimliği girmez (iz yalnız [Adim.Onay.iz]'dedir,
 * gösterilmez).
 */
class BirlestirmeAkisi(
    private val c: BirlestirmeCekirdegi,
    private val metinler: BirlestirmeMetinleri = BirlestirmeMetinleri(),
    /** Bağlantı kuşağı (testte elle). */
    private val kusak: () -> Long = { BaglantiKusagi.simdiki },
) {
    /** Görünümün göstereceği adım. */
    sealed class Adim {
        abstract val baslik: String
        abstract val metin: String

        /**
         * Soru: [onayDugmesi] -> [onayla]`(bu)`, [vazgecDugmesi] -> [vazgec], [sonraDugmesi] -> [simdiDegil]`(bu)`.
         * [iz]: gösterilen planın izi (görünüm göstermez, yalnız geri verir).
         */
        data class Onay(
            override val baslik: String,
            override val metin: String,
            val onayDugmesi: String,
            val vazgecDugmesi: String,
            val sonraDugmesi: String,
            val iz: String,
        ) : Adim()

        /** Bilgi (sonuç ya da yapılacak bir şey yok); tek "Tamam". */
        data class Bilgi(override val baslik: String, override val metin: String) : Adim()

        /** Hata; tek "Tamam". */
        data class Hata(override val baslik: String, override val metin: String) : Adim()
    }

    /** Ekranın sorguladığı bekleyen birleştirme ([bekleyen]); şerit metni ve düğmesi hazır. */
    data class Bekleyen(val ertelendi: Boolean, val serit: String, val dugme: String)

    /** Akışın bildiği son hal (kilit altında değişir). */
    private sealed interface Hal {
        data object Yok : Hal

        /** [iz]'li plan sorulmuş ([kusak] bağlantısında). */
        data class Soruldu(val iz: String, val kusak: Long) : Hal

        data class Ertelendi(val iz: String, val kusak: Long) : Hal

        /** [izler]'den biriyle uygulandı; aynı izle gelen onay [sonuc]'u yeniden alır. */
        data class Uygulandi(val izler: Set<String>, val sonuc: Adim.Bilgi) : Hal
    }

    private val kilit = Any()

    @Volatile
    private var hal: Hal = Hal.Yok

    /** Son bilinen: çekirdek onay bekliyor (soru ekranda ya da ertelendi). Canlı sorgu: [bekleyen]. */
    val onayBekliyor: Boolean get() = hal.let { it is Hal.Soruldu || it is Hal.Ertelendi }

    /** Son bilinen: kullanıcı "Şimdi değil" dedi, birleştirme hâlâ onay bekliyor. Canlı sorgu: [bekleyen]. */
    val ertelendi: Boolean get() = hal is Hal.Ertelendi

    /**
     * Önizlemeyi okur. `null`: sorulacak bir şey yok (bekleyen birleştirme yok ya da aynı plan bu bağlantıda
     * ertelendi). Plan değiştiyse (yeni `iz`) ya da bağlantı yenilendiyse güncel planla yeni [Adim.Onay] döner.
     */
    fun denetle(zorla: Boolean = false): Adim? = synchronized(kilit) {
        try {
            val p = c.birlestirmeOnizlemesi()
            if (p == null) {
                if (hal !is Hal.Uygulandi) hal = Hal.Yok
                return null
            }
            if (!zorla && ayniErteleme(p)) return null
            onayAdimi(p, degisti = false)
        } catch (e: Exception) {
            Adim.Hata(metinler.hataBaslik, metinler.hata(e))
        }
    }

    /**
     * Canlı sorgu (çekirdeği okur; ana iş parçacığından değil): onay bekleyen birleştirme var mı, kullanıcı onu
     * erteledi mi. `null`: bekleyen yok ya da okunamadı (okuma hatasını [denetle] söyler). `ertelendi` yanlışsa
     * soru açık ya da yeniden sorulmalı: görünüm [denetle] çağırır.
     */
    fun bekleyen(): Bekleyen? = synchronized(kilit) {
        val p = try {
            c.birlestirmeOnizlemesi()
        } catch (_: Exception) {
            return null
        }
        if (p == null) {
            if (hal !is Hal.Uygulandi) hal = Hal.Yok
            return null
        }
        Bekleyen(ayniErteleme(p), metinler.bekleyenSeridi, metinler.bekleyenDugmesi)
    }

    /** Kullanıcı [adim]'daki planı onayladı (onay o adımın iziyle yapılır). */
    fun onayla(adim: Adim.Onay): Adim = synchronized(kilit) {
        val h = hal
        if (h is Hal.Uygulandi && adim.iz in h.izler) return h.sonuc
        val s = try {
            c.birlestirmeyiOnayla(adim.iz)
        } catch (e: Exception) {
            return Adim.Hata(metinler.hataBaslik, metinler.hata(e))
        }
        val plan = s.plan
        when {
            s.uygulandi -> uygulandi(setOfNotNull(adim.iz, plan?.iz), metinSonuc { metinler.sonuc(plan) })
            plan != null -> try {
                onayAdimi(plan, degisti = true)
            } catch (e: Exception) {
                // Hiçbir şey yazılmadı (uygulandi yanlış); soru sürer, görünüm denetle ile yeniden alır.
                Adim.Hata(metinler.hataBaslik, metinler.hata(e))
            }
            else -> bekleyenYok(adim.iz, s.zatenUygulandi)
        }
    }

    /** Kullanıcı vazgeçti: bağlanma iptal edilir (eşleşme silinir; kayıtlar değişmez). */
    fun vazgec(): Adim = synchronized(kilit) {
        hal = Hal.Yok
        try {
            val k = c.birlestirmedenVazgec()
            Adim.Bilgi(metinler.vazgecBaslik, metinler.vazgecSonucu(k))
        } catch (e: Exception) {
            Adim.Hata(metinler.hataBaslik, metinler.hata(e))
        }
    }

    /**
     * "Şimdi değil" ([adim]'daki plan için): çekirdeğe gitmez; birleştirme onay bekler. Aynı plan aynı bağlantıda
     * yeniden sorulmaz; plan değişince ya da yeni bağlantıda yeniden sorulur.
     */
    fun simdiDegil(adim: Adim.Onay) = synchronized(kilit) {
        val h = hal
        if (h is Hal.Uygulandi) return@synchronized
        val k = if (h is Hal.Soruldu && h.iz == adim.iz) h.kusak else kusak()
        hal = Hal.Ertelendi(adim.iz, k)
    }

    private fun ayniErteleme(p: BirlestirmeOnizlemesi): Boolean {
        val h = hal
        return h is Hal.Ertelendi && h.iz == p.iz && h.kusak == kusak()
    }

    private fun onayAdimi(p: BirlestirmeOnizlemesi, degisti: Boolean): Adim.Onay {
        val a = Adim.Onay(
            baslik = if (degisti) metinler.degistiBaslik else metinler.baslik,
            metin = metinler.onizleme(p, degisti),
            onayDugmesi = metinler.onayDugmesi,
            vazgecDugmesi = metinler.vazgecDugmesi,
            sonraDugmesi = metinler.sonraDugmesi,
            iz = p.iz,
        )
        hal = Hal.Soruldu(p.iz, kusak())
        return a
    }

    private fun uygulandi(izler: Set<String>, metin: String): Adim.Bilgi {
        val b = Adim.Bilgi(metinler.sonucBaslik, metin)
        hal = Hal.Uygulandi(izler, b)
        return b
    }

    /** Uygulanmış birleştirmenin metni kurulamazsa da "uygulandı" denir (yazılmış olanı yapılamadı saymaz). */
    private inline fun metinSonuc(kur: () -> String): String = try {
        kur()
    } catch (_: Exception) {
        metinler.sonucKisa
    }

    /**
     * Çekirdek "onay bekleyen birleştirme yok" dedi (`uygulandi` yanlış, `plan` yok).
     * - [zatenUygulandi] (köprünün `BirlestirmeSonucu.zatenUygulandi`): bu iz daha önce uygulandı (gecikmiş ya da
     *   ikinci onay). Birleştirme yapılmıştır; "koptu" denmez. Kip yine okunur: bağlıysa "zaten bağlı", değilse
     *   (birleştirmeden sonra bağlantı koparılmış, kip yerel) ya da okunamazsa yalnız "daha önce tamamlanmıştı".
     * - Değilse ya bağlantı koptu (hiçbir şey yazılmadı; kip yerel) ya da birleştirme başka bir izle uygulandı
     *   (kip bağlı); kip okunamazsa durum belirsizdir.
     */
    private fun bekleyenYok(iz: String, zatenUygulandi: Boolean): Adim.Bilgi {
        val kip = try {
            c.kip()
        } catch (_: Exception) {
            null
        }
        return when {
            kip == CalismaKipi.BAGLI -> Adim.Bilgi(metinler.zatenBaslik, metinler.zaten).also { hal = Hal.Uygulandi(setOf(iz), it) }
            zatenUygulandi -> Adim.Bilgi(metinler.oncedenBaslik, metinler.onceden).also { hal = Hal.Uygulandi(setOf(iz), it) }
            kip == CalismaKipi.YEREL -> Adim.Bilgi(metinler.koptuBaslik, metinler.koptu).also { hal = Hal.Yok }
            else -> Adim.Bilgi(metinler.belirsizBaslik, metinler.belirsiz).also { hal = Hal.Yok }
        }
    }

    companion object {
        /** Gözlemcinin bildirimi önizlemeyi ilgilendiriyor mu (görünüm o zaman [denetle] çağırır). */
        fun ilgili(d: Degisim): Boolean = d.baglanti || d.tumu || d.eslesme
    }
}
