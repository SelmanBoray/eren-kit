package dev.eren.ajanda.kimlik

import dev.eren.ajanda.cekirdek.AjandaEslestirmeQr
import dev.eren.ajanda.cekirdek.AjandaKanalHatasi
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.eslestirmeQrCoz

/**
 * Eşleştirme ekranının durum makinesi: saf (Android yok), `EslestirmeEkrani` olayları buraya verir,
 * dönen durumu çizer ve komutları (çekirdek çağrısı, zamanlayıcı) arka iş parçacığında yürütür.
 *
 * Kaynak doğruluk çekirdektir (`eslesmeDurumu`): başarı ve PC'nin reddi `EslesmeDurumu`'ndan okunur
 * (gözlemci `Degisim.eslesme`/`baglanti` gelince yeniden okunur). Ağ katmanının "bağlanamadım" diye
 * bir sinyali yoktur; onu zaman aşımı ve cihazın ağ durumu ayırır.
 */
class EslestirmeMakinesi(
    private val coz: (String) -> AjandaEslestirmeQr = ::eslestirmeQrCoz,
    private val zamanAsimiMs: Long = ZAMAN_ASIMI_MS,
) {
    fun isle(d: EkranDurumu, o: Olay): Gecis = when (d) {
        is EkranDurumu.Yukleniyor -> yukleniyor(d, o)
        is EkranDurumu.Giris -> giris(d, o)
        is EkranDurumu.Baglaniyor -> baglaniyor(d, o)
        is EkranDurumu.Eslesti -> eslesti(d, o)
        is EkranDurumu.Kaldiriliyor -> kaldiriliyor(d, o)
        is EkranDurumu.Basarisiz -> basarisiz(d, o)
    }

    /**
     * Etkinlik yeniden yaratılınca (döndürme) saklanan durumdan devam. Yarım kalmış bir çekirdek
     * çağrısının sonucu eski etkinlikle kaybolmuş olabilir: yükleme ve kaldırma yeniden okunur,
     * eşleştirme bekleyişi zamanlayıcıyla sürer (başlatma çağrısı eski yürütücüde biter).
     */
    fun yenidenKur(d: EkranDurumu): Gecis = when (d) {
        is EkranDurumu.Kaldiriliyor -> Gecis(EkranDurumu.Yukleniyor(reddiGoster = false))
        is EkranDurumu.Baglaniyor -> Gecis(d.copy(baslatildi = true), listOf(Komut.ZamanlayiciKur(d.bitisMs)))
        else -> Gecis(d)
    }

    private fun yukleniyor(d: EkranDurumu.Yukleniyor, o: Olay): Gecis = when (o) {
        is Olay.DurumGeldi -> when (val e = o.eslesme) {
            is EslesmeDurumu.Yok -> Gecis(EkranDurumu.Giris())
            is EslesmeDurumu.Bekliyor -> {
                // Önceki bir eşleştirme yarım kalmış (ekran kapatılmış): bağlanıp sonucunu bekle.
                val bitis = o.simdiMs + zamanAsimiMs
                Gecis(
                    EkranDurumu.Baglaniyor(
                        host = e.host, port = e.port, parmakIzi = null, bitisMs = bitis,
                        asama = o.baglanti?.asama, sonHata = o.baglanti?.sonHata, baslatildi = true, donus = null,
                    ),
                    listOf(Komut.BaglantiyiBaslat, Komut.ZamanlayiciKur(bitis)),
                )
            }
            is EslesmeDurumu.Eslesti -> Gecis(EkranDurumu.Eslesti(e.deviceId, e.host, e.port, yeni = false))
            is EslesmeDurumu.Reddedildi ->
                if (d.reddiGoster) Gecis(EkranDurumu.Basarisiz(hataKoddan(e.kod), donus = EkranDurumu.Giris()))
                else Gecis(EkranDurumu.Giris())
        }
        is Olay.DurumOkunamadi -> Gecis(EkranDurumu.Basarisiz(EslestirmeHatasi.Cekirdek(o.mesaj), donus = null))
        else -> Gecis(d)
    }

    private fun giris(d: EkranDurumu.Giris, o: Olay): Gecis = when (o) {
        is Olay.VeriDegisti -> {
            val veri = EslestirmeVerisi.coz(o.metin, coz)
            Gecis(d.copy(veriMetni = o.metin, veri = veri, kodHatasi = kodHatasi(d.kodMetni, veri)))
        }
        is Olay.KodDegisti -> Gecis(d.copy(kodMetni = o.metin, kodHatasi = kodHatasi(o.metin, d.veri)))
        is Olay.EslestirIstendi -> {
            val veri = d.veri
            when {
                veri !is VeriCozumu.Gecerli || d.kodHatasi != null -> Gecis(d)
                !o.agVar -> Gecis(EkranDurumu.Basarisiz(EslestirmeHatasi.AgYok, donus = d))
                else -> {
                    val bitis = o.simdiMs + zamanAsimiMs
                    Gecis(
                        EkranDurumu.Baglaniyor(
                            host = veri.qr.host, port = veri.qr.port, parmakIzi = veri.parmakIzi, bitisMs = bitis,
                            asama = null, sonHata = null, baslatildi = false, donus = d,
                        ),
                        listOf(Komut.EslestirmeyiBaslat(veri.qr), Komut.ZamanlayiciKur(bitis)),
                    )
                }
            }
        }
        // Giriş ekranındayken gelen eşleşme yeni bir eşleşmedir (açılışta eşleşmişse bu ekrana gelinmez):
        // ör. zaman aşımından sonra arka planda tamamlanan eşleştirme.
        is Olay.DurumGeldi -> when (val e = o.eslesme) {
            is EslesmeDurumu.Eslesti -> Gecis(EkranDurumu.Eslesti(e.deviceId, e.host, e.port, yeni = true))
            else -> Gecis(d)
        }
        else -> Gecis(d)
    }

    private fun baglaniyor(d: EkranDurumu.Baglaniyor, o: Olay): Gecis = when (o) {
        is Olay.BaslatmaBitti ->
            if (o.hata == null) Gecis(d.copy(baslatildi = true), listOf(Komut.DurumuOku))
            else Gecis(EkranDurumu.Basarisiz(EslestirmeHatasi.Cekirdek(o.hata), donus = d.donus))
        // `eslestirmeBaslat` bitmeden okunan durum önceki denemenindir (ör. eski `Reddedildi`): yok sayılır.
        is Olay.DurumGeldi -> if (!d.baslatildi) Gecis(d) else when (val e = o.eslesme) {
            is EslesmeDurumu.Eslesti -> Gecis(EkranDurumu.Eslesti(e.deviceId, e.host, e.port, yeni = true))
            is EslesmeDurumu.Reddedildi -> Gecis(EkranDurumu.Basarisiz(hataKoddan(e.kod), donus = EkranDurumu.Giris()))
            is EslesmeDurumu.Bekliyor ->
                Gecis(d.copy(asama = o.baglanti?.asama ?: d.asama, sonHata = o.baglanti?.sonHata ?: d.sonHata))
            // Eşleştirme başka yerden iptal edildi (eşleşme kaldırıldı).
            is EslesmeDurumu.Yok -> Gecis(d.donus ?: EkranDurumu.Giris())
        }
        is Olay.ZamanDoldu ->
            if (o.simdiMs < d.bitisMs) Gecis(d)
            else {
                val hata = if (!o.agVar) EslestirmeHatasi.AgYok
                else EslestirmeHatasi.PcyeUlasilamadi(o.tailscaleVar, d.asama, d.sonHata)
                Gecis(EkranDurumu.Basarisiz(hata, donus = d.donus))
            }
        is Olay.Vazgec -> Gecis(d.donus ?: EkranDurumu.Giris())
        else -> Gecis(d)
    }

    private fun eslesti(d: EkranDurumu.Eslesti, o: Olay): Gecis = when (o) {
        is Olay.KaldirmaOnaylandi -> Gecis(EkranDurumu.Kaldiriliyor(d.deviceId), listOf(Komut.EslesmeyiKaldir))
        is Olay.DurumGeldi -> if (o.eslesme is EslesmeDurumu.Yok) Gecis(EkranDurumu.Giris()) else Gecis(d)
        else -> Gecis(d)
    }

    private fun kaldiriliyor(d: EkranDurumu.Kaldiriliyor, o: Olay): Gecis = when (o) {
        is Olay.KaldirmaBitti ->
            if (o.hata == null) Gecis(EkranDurumu.Giris(bilgi = Bilgi.Kaldirildi(d.deviceId)))
            else Gecis(EkranDurumu.Basarisiz(EslestirmeHatasi.Cekirdek(o.hata), donus = null))
        else -> Gecis(d)
    }

    private fun basarisiz(d: EkranDurumu.Basarisiz, o: Olay): Gecis = when (o) {
        is Olay.YenidenDene -> {
            val donus = d.donus
            if (donus != null) Gecis(donus)
            else Gecis(EkranDurumu.Yukleniyor(reddiGoster = false), listOf(Komut.DurumuOku))
        }
        // Zaman aşımı ya da ağ yüzünden vazgeçilen eşleştirme arka planda tamamlanabilir.
        is Olay.DurumGeldi -> {
            val e = o.eslesme
            val beklemeHatasi = d.hata is EslestirmeHatasi.PcyeUlasilamadi || d.hata is EslestirmeHatasi.AgYok
            if (beklemeHatasi && e is EslesmeDurumu.Eslesti) Gecis(EkranDurumu.Eslesti(e.deviceId, e.host, e.port, yeni = true))
            else Gecis(d)
        }
        else -> Gecis(d)
    }

    private fun kodHatasi(kodMetni: String, veri: VeriCozumu): KodHatasi? =
        EslestirmeVerisi.kodHatasi(EslestirmeVerisi.koduDuzelt(kodMetni), veri)

    companion object {
        /** PC'den sonuç bekleme süresi. Pencere 5 dakikadır; tek gidiş-dönüş saniyeler sürer. */
        const val ZAMAN_ASIMI_MS = 20_000L

        /** `pair_result.code` -> kullanıcıya anlatılan sonuç. */
        fun hataKoddan(kod: AjandaKanalHatasi): EslestirmeHatasi = when (kod) {
            AjandaKanalHatasi.ESLESTIRME_KODU_GECERSIZ -> EslestirmeHatasi.YanlisKod
            AjandaKanalHatasi.ESLESTIRME_KAPALI -> EslestirmeHatasi.PencereKapali
            AjandaKanalHatasi.KANAL_DESTEKLENMIYOR -> EslestirmeHatasi.YanlisKanal
            AjandaKanalHatasi.IP_UYUSMUYOR -> EslestirmeHatasi.IpUyusmuyor
            else -> EslestirmeHatasi.PcReddetti(kod)
        }
    }
}

data class Gecis(val durum: EkranDurumu, val komutlar: List<Komut> = emptyList())

sealed interface EkranDurumu {
    /** Çekirdekten eşleşme okunuyor. `reddiGoster`: çekirdekteki eski `Reddedildi` sonuç olarak gösterilsin mi. */
    data class Yukleniyor(val reddiGoster: Boolean = true) : EkranDurumu

    /**
     * Yapıştırma ve kod. Metinler yalnız bellekte (kalıcı depoya ve kayda girmez); `toString` onları
     * yazmaz. `kodHatasi` `null` ise kod biçimce doğru ve veriyle aynı.
     */
    data class Giris(
        val veriMetni: String = "",
        val kodMetni: String = "",
        val veri: VeriCozumu = VeriCozumu.Bos,
        val kodHatasi: KodHatasi? = KodHatasi.Bos,
        val bilgi: Bilgi? = null,
    ) : EkranDurumu {
        val eslestirilebilir: Boolean get() = veri is VeriCozumu.Gecerli && kodHatasi == null

        override fun toString() = "Giris(veri=$veri, kodHatasi=$kodHatasi, bilgi=$bilgi)"
    }

    /**
     * PC'nin sonucu bekleniyor. `baslatildi`: `eslestirmeBaslat` bitti (öncesinde okunan durum eskidir).
     * `donus`: başarısızlıkta ya da vazgeçince dönülecek giriş (veri hâlâ geçerli olabilir).
     */
    data class Baglaniyor(
        val host: String,
        val port: Int,
        val parmakIzi: String?,
        val bitisMs: Long,
        val asama: BaglantiAsamasi?,
        val sonHata: AjandaKanalHatasi?,
        val baslatildi: Boolean,
        val donus: Giris?,
    ) : EkranDurumu

    /** `yeni`: bu ekranda tamamlandı (açılışta zaten eşleşmiş değil). */
    data class Eslesti(val deviceId: String, val host: String, val port: Int, val yeni: Boolean) : EkranDurumu

    data class Kaldiriliyor(val deviceId: String) : EkranDurumu

    /** `donus`: "Yeniden dene"nin götüreceği giriş; `null` ise durum yeniden okunur. */
    data class Basarisiz(val hata: EslestirmeHatasi, val donus: Giris?) : EkranDurumu
}

sealed interface Bilgi {
    /** Eşleşme bu telefondan kaldırıldı; PC'deki kayıt ayrıca kaldırılmalı. */
    data class Kaldirildi(val deviceId: String) : Bilgi
}

/** Kullanıcıya gösterilen eşleştirme sonuçları (yerel giriş hataları `VeriHatasi`/`KodHatasi`'dadır). */
sealed interface EslestirmeHatasi {
    /** PC: `eslestirme_kodu_gecersiz`. */
    data object YanlisKod : EslestirmeHatasi

    /** PC: `eslestirme_kapali` (süresi dolmuş, kullanılmış ya da yenisiyle kapanmış pencere). */
    data object PencereKapali : EslestirmeHatasi

    /** PC: `kanal_desteklenmiyor` (pencere ajanda kapsamında açılmamış). */
    data object YanlisKanal : EslestirmeHatasi

    /** PC: `ip_uyusmuyor`. */
    data object IpUyusmuyor : EslestirmeHatasi

    /** Telefonda etkin ağ yok. */
    data object AgYok : EslestirmeHatasi

    /** Zaman aşımı: ağ var ama sonuç gelmedi. `asama`/`sonHata`: çekirdeğin son bildirdiği. */
    data class PcyeUlasilamadi(
        val tailscaleVar: Boolean,
        val asama: BaglantiAsamasi?,
        val sonHata: AjandaKanalHatasi?,
    ) : EslestirmeHatasi

    /** PC'nin öteki ret kodları. */
    data class PcReddetti(val kod: AjandaKanalHatasi) : EslestirmeHatasi

    /** Çekirdek çağrısı başarısız (depo, kabuk, yazılmamış parça). */
    data class Cekirdek(val mesaj: String) : EslestirmeHatasi
}

sealed interface Olay {
    /** Çekirdekten okunan durum (`baglanti` okunamadıysa `null`). `simdiMs`: monoton saat. */
    data class DurumGeldi(val eslesme: EslesmeDurumu, val baglanti: BaglantiDurumu?, val simdiMs: Long) : Olay
    data class DurumOkunamadi(val mesaj: String) : Olay
    data class VeriDegisti(val metin: String) : Olay {
        override fun toString() = "VeriDegisti(${metin.length} karakter)"
    }
    data class KodDegisti(val metin: String) : Olay {
        override fun toString() = "KodDegisti(${metin.length} karakter)"
    }
    data class EslestirIstendi(val simdiMs: Long, val agVar: Boolean) : Olay

    /** `eslestirmeBaslat` bitti; `hata` doluysa başarısız. */
    data class BaslatmaBitti(val hata: String?) : Olay
    data class ZamanDoldu(val simdiMs: Long, val agVar: Boolean, val tailscaleVar: Boolean) : Olay
    data object Vazgec : Olay
    data object KaldirmaOnaylandi : Olay
    data class KaldirmaBitti(val hata: String?) : Olay
    data object YenidenDene : Olay
}

/** Ekranın yürüteceği yan etkiler. Çekirdek çağrıları arka iş parçacığında, sonuçları olay olarak geri. */
sealed interface Komut {
    /** `eslestirmeBaslat(qr)`, sonra `BaglantiYoneticisi.simdiDene`; sonuç `BaslatmaBitti`. */
    data class EslestirmeyiBaslat(val qr: AjandaEslestirmeQr) : Komut {
        override fun toString() = "EslestirmeyiBaslat(${qr.host}:${qr.port})"
    }

    data object BaglantiyiBaslat : Komut

    /** `bitisMs`'te (monoton saat) `ZamanDoldu`. */
    data class ZamanlayiciKur(val bitisMs: Long) : Komut

    /** `eslesmeyiKaldir` (çekirdek cihaz anahtarını da siler); sonuç `KaldirmaBitti`. */
    data object EslesmeyiKaldir : Komut

    /** `eslesmeDurumu` + `baglantiDurumu`; sonuç `DurumGeldi`/`DurumOkunamadi`. */
    data object DurumuOku : Komut
}
