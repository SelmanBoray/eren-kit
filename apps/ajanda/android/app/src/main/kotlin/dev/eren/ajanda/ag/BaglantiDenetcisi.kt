package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.CalismaKipi
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

    /** Uygulama ile servis farklı sürümde (`protokol_uyumsuz`): yeniden denemek boşuna, sıradaki dönem beklenir. */
    SURUM_UYUSMAZ,

    /**
     * Yerel kipte eşleşme var: bağlanılmadı. Gönderilecek kuyruk yok; bağlanmak her seferinde servisin tam
     * kopyasını indirir ve çekirdek birleştirme onayı bekler (onu yalnız ön plandaki arayüz sorabilir).
     */
    YEREL_KIP,
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
 *
 * Sürüm uyuşmazlığı (v2; çekirdek `BaglantiDurumu.surumUyusmazligi`): artan beklemeli yeniden deneme yapılmaz
 * (sürüm kendiliğinden değişmez). Arayüz görünürken yalnız [AgAyarlari.surumBeklemeMs]'de bir dener; `basla`
 * (uygulama yeniden öne geldi, kullanıcı belki güncelledi) ve `hemenDene` hemen bir kez dener; ağ değişimi
 * denemez. Arka plan oturumu `SURUM_UYUSMAZ` ile hemen biter. `CANLI`'ya ulaşınca durum kalkar.
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
    /** Çekirdeğe verilen saat (`JavaZaman.simdiMs`, duvar saati): `BaglantiDurumu.yukariDenemeMs` bununla ölçülür. */
    private val duvarSaati: () -> Long = { System.currentTimeMillis() },
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

    /**
     * Durum yoklaması ([yukariDenemesiniKur]): düşülen alt sürümdeki canlı bağlantının yukarı deneme anı ve
     * yanıtı beklenen geçmiş isteğinin zaman aşımı anı, tek zamanlayıcıda; [yukariAni] kurulduğu (yukarı, geçmiş) çifti.
     */
    private var yukariZamani: Iptal? = null
    private var yukariAni: Pair<Long?, Long?>? = null

    /** Art arda başarısız bağlantı sayısı; `CANLI`'da ve yeni ağda sıfırlanır. */
    private var deneme = 0

    /** Son kapanış sürüm uyuşmazlığıydı (çekirdekten okundu); `CANLI`'da kalkar. */
    private var surumUyusmaz = false
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
            yukariDenemesiniIptal()
            gunluk.bilgi("bağlantı bitti: $tur")
            if (tur == KapanisTuru.BIZ_KAPATTIK) return@korumali
            if (surumUyusmazligiOku()) {
                // Yeniden denemek boşuna: arka plan oturumları biter, arayüz "güncelle" der, uzun bekleme.
                gunluk.bilgi("sürüm uyuşmazlığı: yeniden bağlanma geri çekildi")
                oturumlariBitir(ArkaPlanSonucu.SURUM_UYUSMAZ)
                if (bosaltiliyor) bosaltmayiBitir(kapat = true)
                degerlendir()
                return@korumali
            }
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
        val ms = when {
            hemen -> 0
            surumUyusmaz -> ayar.surumBeklemeMs
            else -> ayar.bekleme(deneme, rastgele())
        }
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
        BaglantiKusagi.yeni()
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
        yukariDenemesiniIptal()
        s.birak(KapanisTuru.BIZ_KAPATTIK)
    }

    /**
     * Düşülen alt sürümde (`protokol_uyumsuz` sonrası) canlı bağlantıda çekirdek yukarı denemeyi ancak bir köprü
     * çağrısında yapar: bağlantı boşta açık kalırsa deneme ilk olaya kalırdı. `yukariDenemeMs` anına bir
     * `baglantiDurumu()` yoklaması kurulur (o çağrıda çekirdek, yolda işlem yoksa, bağlantıyı kapatır; kapanış
     * sıradan kopma gibi yeniden bağlanır). An geçmişse (yolda işlem vardı, kapatılmadı) [AgAyarlari.yukariTekrarMs]
     * sonra yeniden yoklanır: döngü dönmez. An kalkınca ya da soket kapanınca yoklama iptal edilir.
     */
    /**
     * Aynı kalıpla geçmiş isteğinin zaman aşımı: `gecmisBeklemeMs` doluysa (soket açıkken, aşamadan bağımsız;
     * kapanışta çekirdek istekleri temizler) o ana da yoklama gerekir. İki an tek zamanlayıcıda birleşir: en
     * yakın olan kurulur, yoklamadan sonra okunan durum bir sonrakini kurar (ikisi ayrı ayrı yarışmaz).
     */
    private fun yukariDenemesiniKur(d: BaglantiDurumu) {
        val yukari = d.yukariDenemeMs.takeIf { d.asama == BaglantiAsamasi.CANLI && soket != null }
        val gecmis = d.gecmisBeklemeMs.takeIf { soket != null }
        if (yukari == null && gecmis == null) {
            yukariDenemesiniIptal()
            return
        }
        val anlar = Pair(yukari, gecmis)
        if (anlar == yukariAni && yukariZamani != null) return
        yukariZamani?.iptal()
        yukariAni = anlar
        val simdi = duvarSaati()
        val ms = listOfNotNull(yukari, gecmis).minOf { an ->
            val kalan = an - simdi
            if (kalan > 0) kalan else ayar.yukariTekrarMs
        }
        yukariZamani = zaman.sonra(ms) {
            korumali {
                yukariZamani = null
                yukariAni = null
                if (soket != null) durumuOku()
            }
        }
    }

    private fun yukariDenemesiniIptal() {
        yukariZamani?.iptal()
        yukariZamani = null
        yukariAni = null
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
        yukariDenemesiniKur(d)
        if (d.asama == BaglantiAsamasi.CANLI) {
            deneme = 0
            surumUyusmaz = false
        }
        if (d.asama == BaglantiAsamasi.CANLI && d.kuyrukta == 0) {
            if (oturumlar.isNotEmpty()) oturumlariBitir(ArkaPlanSonucu.ESITLENDI)
            if (bosaltiliyor) bosaltmayiBitir(kapat = true)
            degerlendir()
        }
        return d
    }

    /** Çekirdeğe göre son kapanış sürüm uyuşmazlığı mı; [surumUyusmaz]'ı günceller. */
    private fun surumUyusmazligiOku(): Boolean {
        val d = try {
            cekirdek?.baglantiDurumu()
        } catch (e: Exception) {
            gunluk.uyari("bağlantı durumu okunamadı", e)
            null
        }
        surumUyusmaz = d?.surumUyusmazligi != null
        return surumUyusmaz
    }

    private fun agDegisti(var_: Boolean) {
        agVar = var_
        if (var_) {
            // Yeni ya da değişen ağ: eski bekleme anlamını yitirdi (sürüm uyuşmazlığı ağla değişmez: uzun bekleme sürer).
            deneme = 0
            degerlendir(hemen = !surumUyusmaz)
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
        if (yerelKipteEslesmeli()) {
            // Ön plandaki bağlantıya dokunulmaz (açıksa sürer; önizlemeyi kullanıcı orada görür).
            oturumuBitir(o, ArkaPlanSonucu.YEREL_KIP)
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

    /**
     * Yerel kip ve eşleşme var mı. Okunamazsa `false`: eski yol sürer (çekirdek yoksa `HATA`, eşleşme yoksa
     * `ESLESME_YOK` ve periyodik iş kaldırılır).
     */
    private fun yerelKipteEslesmeli(): Boolean {
        val c = cekirdekHazir() ?: return false
        return try {
            c.kip() == CalismaKipi.YEREL && c.baglantiAdresi() != null
        } catch (e: Exception) {
            gunluk.uyari("kip okunamadı", e)
            false
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
