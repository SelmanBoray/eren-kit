package dev.eren.ajanda.birlestirme

import dev.eren.ajanda.cekirdek.BirlestirmeOnizlemesi
import dev.eren.ajanda.cekirdek.BirlestirmeSonucu
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
}

/** Gerçek çekirdeğe bağlanış. */
class CekirdekBirlestirmesi(private val c: Cekirdek) : BirlestirmeCekirdegi {
    override fun birlestirmeOnizlemesi(): BirlestirmeOnizlemesi? = c.birlestirmeOnizlemesi()
    override fun birlestirmeyiOnayla(iz: String?): BirlestirmeSonucu = c.birlestirmeyiOnayla(iz)
    override fun birlestirmedenVazgec(): KoparmaSonucu = c.birlestirmedenVazgec()
}

/**
 * SAHİBİ: D4 (Android). Yerel kipten Eren servisine bağlanırken birleştirme önizlemesinin akışı (saf, ekransız;
 * görünüm yalnız [Adim]'ı gösterir ve düğmeleri iletir). `AktarmaAkisi` kalıbı.
 *
 * - Çekirdek önizleme hazır olunca gözlemciye `Degisim.baglanti` yollar: görünüm [ilgili] doğruysa (çekirdek
 *   iş parçacığı dışında) [denetle] çağırır. Dönen `null`: sorulacak bir şey yok (açık soru varsa kapatılır).
 * - [Adim.Onay]: olumlu düğme [onayla], olumsuz [vazgec], üçüncü [simdiDegil].
 * - [onayla]: plan önizlemeden sonra değiştiyse yeni planla yeniden [Adim.Onay]; bekleyen birleştirme kalmadıysa
 *   (bağlantı koptu) [Adim.Bilgi] "yeniden bağlanınca sorulacak"; uygulandıysa sonuç [Adim.Bilgi].
 * - [vazgec]: bağlanmayı iptal eder (eşleşme silinir, kayıtlar değişmez; yeniden bağlanmak için QR).
 * - [simdiDegil]: çekirdeğe gitmez; soru yanıtsız kalır. Bu bağlantı boyunca [denetle] yeniden sormaz
 *   (önizleme kalkınca, yani bağlantı kopunca sıfırlanır); [denetle] `zorla = true` ile yine sorar.
 *
 * İş parçacığı: bütün yöntemler eşzamanlıdır, çekirdeği çağırır; ana iş parçacığından çağrılmaz, aynı anda tek
 * iş parçacığından (durum tutar). Her [Exception] bir [Adim.Hata]'ya çevrilir.
 * Mahremiyet: metinler yalnız sayı taşır; kayıt başlığı ya da kimliği girmez.
 */
class BirlestirmeAkisi(
    private val c: BirlestirmeCekirdegi,
    private val metinler: BirlestirmeMetinleri = BirlestirmeMetinleri(),
) {
    /** Görünümün göstereceği adım. */
    sealed class Adim {
        abstract val baslik: String
        abstract val metin: String

        /** Soru: [onayDugmesi] -> [onayla], [vazgecDugmesi] -> [vazgec], [sonraDugmesi] -> [simdiDegil]. */
        data class Onay(
            override val baslik: String,
            override val metin: String,
            val onayDugmesi: String,
            val vazgecDugmesi: String,
            val sonraDugmesi: String,
        ) : Adim()

        /** Bilgi (sonuç ya da yapılacak bir şey yok); tek "Tamam". */
        data class Bilgi(override val baslik: String, override val metin: String) : Adim()

        /** Hata; tek "Tamam". */
        data class Hata(override val baslik: String, override val metin: String) : Adim()
    }

    /** Gösterilen planın izi (onayda çekirdeğe verilir). */
    private var bekleyenIz: String? = null

    /** Kullanıcı "Şimdi değil" dedi; önizleme kalkınca (bağlantı koptu) sıfırlanır. */
    private var ertelendi = false

    /** Onay bekleyen soru var mı (görünüm yeniden kurulunca). */
    val onayBekliyor: Boolean get() = bekleyenIz != null

    /**
     * Önizlemeyi okur. `null`: sorulacak bir şey yok (bekleyen birleştirme yok ya da bu bağlantıda ertelendi).
     * Plan değiştiyse (yeni `iz`) güncel planla yeni [Adim.Onay] döner.
     */
    fun denetle(zorla: Boolean = false): Adim? {
        return try {
            val p = c.birlestirmeOnizlemesi()
            if (p == null) {
                bekleyenIz = null
                ertelendi = false
                return null
            }
            if (ertelendi && !zorla) return null
            ertelendi = false
            onayAdimi(p, degisti = false)
        } catch (e: Exception) {
            bekleyenIz = null
            Adim.Hata(metinler.hataBaslik, metinler.hata(e))
        }
    }

    /** Kullanıcı birleştirmeyi onayladı. */
    fun onayla(): Adim {
        val iz = bekleyenIz ?: return Adim.Hata(metinler.hataBaslik, metinler.bekleyenYok)
        return try {
            val s = c.birlestirmeyiOnayla(iz)
            val plan = s.plan
            when {
                s.uygulandi -> {
                    bekleyenIz = null
                    Adim.Bilgi(metinler.sonucBaslik, metinler.sonuc(plan))
                }
                plan != null -> onayAdimi(plan, degisti = true)
                else -> {
                    bekleyenIz = null
                    Adim.Bilgi(metinler.koptuBaslik, metinler.koptu)
                }
            }
        } catch (e: Exception) {
            bekleyenIz = null
            Adim.Hata(metinler.hataBaslik, metinler.hata(e))
        }
    }

    /** Kullanıcı vazgeçti: bağlanma iptal edilir (eşleşme silinir; kayıtlar değişmez). */
    fun vazgec(): Adim {
        bekleyenIz = null
        ertelendi = false
        return try {
            val k = c.birlestirmedenVazgec()
            Adim.Bilgi(metinler.vazgecBaslik, metinler.vazgecSonucu(k))
        } catch (e: Exception) {
            Adim.Hata(metinler.hataBaslik, metinler.hata(e))
        }
    }

    /** "Şimdi değil": çekirdeğe gitmez; soru bağlantı yeniden kurulunca yeniden gelir. */
    fun simdiDegil() {
        bekleyenIz = null
        ertelendi = true
    }

    private fun onayAdimi(p: BirlestirmeOnizlemesi, degisti: Boolean): Adim {
        bekleyenIz = p.iz
        return Adim.Onay(
            baslik = if (degisti) metinler.degistiBaslik else metinler.baslik,
            metin = metinler.onizleme(p, degisti),
            onayDugmesi = metinler.onayDugmesi,
            vazgecDugmesi = metinler.vazgecDugmesi,
            sonraDugmesi = metinler.sonraDugmesi,
        )
    }

    companion object {
        /** Gözlemcinin bildirimi önizlemeyi ilgilendiriyor mu (görünüm o zaman [denetle] çağırır). */
        fun ilgili(d: Degisim): Boolean = d.baglanti || d.tumu || d.eslesme
    }
}
