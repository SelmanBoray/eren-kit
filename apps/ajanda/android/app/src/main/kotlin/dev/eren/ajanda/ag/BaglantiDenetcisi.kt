package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.Gozlemci
import java.util.concurrent.atomic.AtomicBoolean

/** Arka plan oturumunun nasıl bittiği. */
enum class ArkaPlanSonucu {
    /** `CANLI` ve kuyruk boş: eşitlendi. */
    ESITLENDI,

    /** Eşleşme yok (`baglantiAdresi() == null`): bağlanılmadı, periyodik iş kaldırıldı. */
    ESLESME_YOK,

    /** Oturum başında ağ yoktu. */
    AG_YOK,

    /** [AgAyarlari.arkaPlanDeneme] bağlantı denemesi başarısız (PC kapalı, Tailscale kopuk). */
    ULASILAMADI,

    /** [AgAyarlari.arkaPlanSuresiMs] doldu. */
    SURE_DOLDU,

    /** Sistem işi durdurdu (`onStopJob`). */
    IPTAL,

    /** Çekirdek açılamadı ya da okunamadı. */
    HATA,
}

/**
 * Bağlantının yaşam döngüsü (strateji ve sayılar: `AgStratejisi.kt`). Ne zaman bağlanılacağına karar
 * verir; tek seferde en çok TEK soket açar. Bağlantı talebi üç kaynaktan gelir: arayüz (`basla`/`birak`),
 * bırakma sonrası kısa bekleme ve boşaltma, arka plan oturumları (`arkaPlanOturumu`). Talep varken kopuk
 * kalınmaz (ağ ve eşleşme varsa), talep bitince bağlantı kapatılır.
 *
 * Bütün durum yalnız [zaman]'ın tek iş parçacığında değişir; dış çağrılar oraya iş bırakıp hemen döner
 * (her iş parçacığından çağrılabilir, bloklamaz, tekrarlı ve eşzamanlı çağrıya dayanıklı). Çekirdek
 * çağrıları o iş parçacığında ve soketin okuma iş parçacığında yapılır; ana iş parçacığında hiç.
 */
class BaglantiDenetcisi(
    private val cekirdekAl: () -> KanalCekirdegi,
    private val acici: SoketAcici,
    private val zaman: Zamanlayici,
    private val ag: AgIzleyici,
    private val isler: IsPlanlayici,
    private val gunluk: Gunluk,
    private val ayar: AgAyarlari = AgAyarlari.VARSAYILAN,
    private val rastgele: () -> Double = { Math.random() },
) {
    // ---------------------------------------------------------------------------------------------
    // Dış yüz (her iş parçacığı)
    // ---------------------------------------------------------------------------------------------

    /** Arayüz görünür ya da eşleştirme başladı: bağlı kal. Kopuksa beklemeyi atlayıp hemen dener. */
    fun basla() = isle {
        hazirla()
        onPlanda = true
        birakmaZamani?.iptal()
        birakmaZamani = null
        bosaltmayiBitir(kapat = false)
        degerlendir(hemen = true)
    }

    /** Talep sürüyorsa (arayüz görünür) ve kopuksa beklemeyi atlayıp hemen dener; talebi değiştirmez. */
    fun hemenDene() = isle {
        if (onPlanda) degerlendir(hemen = true)
    }

    /** Arayüz görünmez oldu: kısa bekleme (ve gerekirse kuyruk boşaltma) sonra bağlantıyı bırak. */
    fun birak() = isle {
        if (!onPlanda) return@isle
        onPlanda = false
        birakmaZamani?.iptal()
        birakmaZamani = zaman.sonra(ayar.birakmaGecikmesiMs) {
            korumali {
                birakmaZamani = null
                birakmaBekledi()
            }
        }
    }

    /**
     * Arka plan eşitleme oturumu: bağlan, eşitlen, kuyruğu boşalt; [bitti] tam bir kez, yöneticinin
     * iş parçacığında çağrılır (içinde uzun iş yapma). Dönen [Iptal] oturumu `IPTAL` ile bitirir.
     */
    fun arkaPlanOturumu(bitti: (ArkaPlanSonucu) -> Unit): Iptal {
        val o = Oturum(bitti)
        isle { oturumBasla(o) }
        return Iptal {
            isle {
                oturumuBitir(o, ArkaPlanSonucu.IPTAL)
                degerlendir()
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Durum (yalnız zaman iş parçacığı)
    // ---------------------------------------------------------------------------------------------

    private inner class Oturum(val geri: (ArkaPlanSonucu) -> Unit) {
        var basarisiz = 0
        var sure: Iptal? = null
        var bitti = false
    }

    private var hazir = false
    private var cekirdek: KanalCekirdegi? = null
    private var agVar = false
    private var onPlanda = false
    private var birakmaZamani: Iptal? = null
    private var bosaltiliyor = false
    private var bosaltmaZamani: Iptal? = null
    private var soket: AjandaSoketi? = null
    private var acilisZamani: Iptal? = null
    private var bekleme: Iptal? = null

    /** Art arda başarısız bağlantı sayısı; `CANLI`'da ve yeni ağda sıfırlanır. */
    private var deneme = 0
    private var periyodikKuruldu = false
    private val oturumlar = ArrayList<Oturum>()

    private val okumaBekliyor = AtomicBoolean(false)
    private val eslesmeDegisti = AtomicBoolean(false)

    /** Çekirdeğin etki kilidi altında çağrılır: yalnız iş bırakır. */
    private val gozlemci = object : Gozlemci {
        override fun degisti(degisim: Degisim) {
            if (degisim.eslesme) eslesmeDegisti.set(true)
            if (!(degisim.baglanti || degisim.eslesme || degisim.tumu)) return
            if (okumaBekliyor.compareAndSet(false, true)) {
                isle {
                    okumaBekliyor.set(false)
                    durumuOku()
                    if (eslesmeDegisti.getAndSet(false) && soket == null) degerlendir(hemen = true)
                }
            }
        }
    }

    private val soketOlaylari = object : AjandaSoketi.Olaylar {
        override fun acildi(soket: AjandaSoketi) = korumali {
            if (soket !== this@BaglantiDenetcisi.soket) return@korumali
            acilisZamani?.iptal()
            acilisZamani = null
            durumuOku()
        }

        override fun kapandi(soket: AjandaSoketi, tur: KapanisTuru) = korumali {
            if (soket !== this@BaglantiDenetcisi.soket) return@korumali
            this@BaglantiDenetcisi.soket = null
            acilisZamani?.iptal()
            acilisZamani = null
            gunluk.bilgi("bağlantı bitti: $tur")
            if (tur == KapanisTuru.BIZ_KAPATTIK) return@korumali
            deneme++
            for (o in oturumlar.toList()) {
                o.basarisiz++
                if (o.basarisiz >= ayar.arkaPlanDeneme) oturumuBitir(o, ArkaPlanSonucu.ULASILAMADI)
            }
            // Bağlantı kopunca boşaltma beklenmez; kalan kuyruk ağ koşullu işe devredilir.
            if (bosaltiliyor) bosaltmayiBitir(kapat = true)
            degerlendir()
        }
    }

    private fun hazirla() {
        if (hazir) return
        hazir = true
        agVar = try {
            ag.baslat { var_ -> isle { agDegisti(var_) } }
        } catch (e: Exception) {
            gunluk.uyari("ağ izlenemiyor", e)
            true
        }
    }

    private fun cekirdekHazir(): KanalCekirdegi? {
        cekirdek?.let { return it }
        return try {
            cekirdekAl().also {
                it.gozlemciEkle(gozlemci)
                cekirdek = it
            }
        } catch (e: Exception) {
            gunluk.uyari("çekirdek açılamadı", e)
            null
        }
    }

    private fun talepVar() = onPlanda || birakmaZamani != null || bosaltiliyor || oturumlar.isNotEmpty()

    /**
     * Tek karar noktası. Talep yoksa kapat; varsa ve kopuksa, ağ varken bağlan: [hemen] ya da ilk denemede
     * şimdi, değilse artan beklemeyle.
     */
    private fun degerlendir(hemen: Boolean = false) {
        if (!talepVar()) {
            beklemeyiIptal()
            soketiBirak()
            return
        }
        if (soket != null) return
        if (!agVar) {
            beklemeyiIptal()
            return
        }
        if (hemen) beklemeyiIptal()
        if (bekleme != null) return
        val ms = if (hemen) 0 else ayar.bekleme(deneme, rastgele())
        if (ms <= 0) {
            bagla()
        } else {
            bekleme = zaman.sonra(ms) {
                korumali {
                    bekleme = null
                    degerlendir(hemen = true)
                }
            }
        }
    }

    private fun bagla() {
        val c = cekirdekHazir() ?: run {
            oturumlariBitir(ArkaPlanSonucu.HATA)
            return
        }
        val adres = try {
            c.baglantiAdresi()
        } catch (e: Exception) {
            gunluk.uyari("adres okunamadı", e)
            oturumlariBitir(ArkaPlanSonucu.HATA)
            return
        }
        if (adres == null) {
            // Eşleşme yok: hiçbir şey açılmaz; eşleşme gelince gözlemci ya da `basla` yeniden değerlendirir.
            if (oturumlar.isNotEmpty() || periyodikKuruldu) {
                periyodikKuruldu = false
                tamamla("periyodik iş kaldırılamadı") { isler.periyodikIptal() }
            }
            oturumlariBitir(ArkaPlanSonucu.ESLESME_YOK)
            return
        }
        if (!periyodikKuruldu) {
            periyodikKuruldu = true
            tamamla("periyodik iş kurulamadı") { isler.periyodikKur() }
        }
        val s = AjandaSoketi(c, zaman, gunluk, ayar, soketOlaylari)
        soket = s
        acilisZamani = zaman.sonra(ayar.acilisSuresiMs) {
            korumali {
                if (soket === s && !s.acik) {
                    gunluk.bilgi("açılış süresi doldu")
                    s.birak(KapanisTuru.ZAMAN_ASIMI)
                }
            }
        }
        s.bagla(acici, adres)
    }

    private fun soketiBirak() {
        val s = soket ?: return
        soket = null
        acilisZamani?.iptal()
        acilisZamani = null
        s.birak(KapanisTuru.BIZ_KAPATTIK)
    }

    private fun beklemeyiIptal() {
        bekleme?.iptal()
        bekleme = null
    }

    private fun durumuOku(): BaglantiDurumu? {
        val c = cekirdek ?: return null
        val d = try {
            c.baglantiDurumu()
        } catch (e: Exception) {
            gunluk.uyari("bağlantı durumu okunamadı", e)
            return null
        }
        if (d.asama == BaglantiAsamasi.CANLI) deneme = 0
        if (d.asama == BaglantiAsamasi.CANLI && d.kuyrukta == 0) {
            if (oturumlar.isNotEmpty()) oturumlariBitir(ArkaPlanSonucu.ESITLENDI)
            if (bosaltiliyor) bosaltmayiBitir(kapat = true)
            degerlendir()
        }
        return d
    }

    private fun agDegisti(var_: Boolean) {
        agVar = var_
        if (var_) {
            // Yeni ya da değişen ağ: eski bekleme anlamını yitirdi.
            deneme = 0
            degerlendir(hemen = true)
        } else {
            beklemeyiIptal()
        }
    }

    // --- bırakma ve boşaltma ---

    private fun birakmaBekledi() {
        if (onPlanda) return
        val d = if (soket != null) durumuOku() else null
        if (soket != null && d != null && d.kuyrukta > 0 && d.asama != BaglantiAsamasi.KOPUK) {
            bosaltiliyor = true
            bosaltmaZamani = zaman.sonra(ayar.bosaltmaSuresiMs) {
                korumali {
                    bosaltmaZamani = null
                    if (bosaltiliyor) bosaltmayiBitir(kapat = true)
                }
            }
            return
        }
        talepBitti()
    }

    private fun bosaltmayiBitir(kapat: Boolean) {
        val surdu = bosaltiliyor
        bosaltiliyor = false
        bosaltmaZamani?.iptal()
        bosaltmaZamani = null
        if (kapat && surdu) talepBitti()
    }

    /** Arayüz talebi bitti: talep kalmadıysa kapat; kuyrukta işlem kaldıysa ağ koşullu işe devret. */
    private fun talepBitti() {
        degerlendir()
        if (talepVar()) return
        val kalan = try {
            cekirdek?.baglantiDurumu()?.kuyrukta ?: 0
        } catch (e: Exception) {
            gunluk.uyari("kuyruk okunamadı", e)
            0
        }
        if (kalan > 0) tamamla("kuyruk işi kurulamadı") { isler.kuyrukIsiKur() }
    }

    // --- arka plan oturumları ---

    private fun oturumBasla(o: Oturum) {
        hazirla()
        if (!agVar) {
            oturumuBitir(o, ArkaPlanSonucu.AG_YOK)
            return
        }
        oturumlar += o
        o.sure = zaman.sonra(ayar.arkaPlanSuresiMs) {
            korumali {
                oturumuBitir(o, ArkaPlanSonucu.SURE_DOLDU)
                degerlendir()
            }
        }
        if (soket != null) {
            // Zaten bağlı (arayüz açık): eşitlenmişse oturum hemen biter.
            if (cekirdekHazir() != null) durumuOku()
        } else {
            degerlendir(hemen = true)
        }
    }

    private fun oturumuBitir(o: Oturum, sonuc: ArkaPlanSonucu) {
        if (o.bitti) return
        o.bitti = true
        oturumlar.remove(o)
        o.sure?.iptal()
        o.sure = null
        gunluk.bilgi("arka plan oturumu: $sonuc")
        try {
            o.geri(sonuc)
        } catch (e: Exception) {
            gunluk.uyari("oturum geri çağrısı başarısız", e)
        }
    }

    private fun oturumlariBitir(sonuc: ArkaPlanSonucu) {
        for (o in oturumlar.toList()) oturumuBitir(o, sonuc)
    }

    // --- yardımcılar ---

    private fun isle(is_: () -> Unit) {
        try {
            zaman.execute { korumali(is_) }
        } catch (e: Exception) {
            gunluk.uyari("ağ işi sıraya konamadı", e)
        }
    }

    private inline fun korumali(is_: () -> Unit) {
        try {
            is_()
        } catch (e: Exception) {
            gunluk.uyari("ağ işi başarısız", e)
        }
    }

    private inline fun tamamla(hataMesaji: String, is_: () -> Unit) {
        try {
            is_()
        } catch (e: Exception) {
            gunluk.uyari(hataMesaji, e)
        }
    }
}
