package dev.eren.ajanda.aktarma

import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.IceAktarmaOnizlemesi
import dev.eren.ajanda.cekirdek.IceAktarmaSonucu
import dev.eren.ajanda.ekran.CekirdekYuzu

/**
 * SAHİBİ: D3. [AktarmaAkisi]'nın çekirdekten istediği. İçe aktarma belgeyi kaptan okunduğu gibi UTF-8 baytlarıyla
 * verir (`ice_aktarma_onizlemesi_bayt` / `ice_aktar_bayt`): Kotlin belgeyi UTF-16 `String`'e çevirip tutmaz, UniFFI
 * de onu yığında yeniden UTF-8'e kodlamaz (`ByteArray` doğrudan yerel belleğe yazılır). Sonuç, hatalar ve `iz`
 * `String` sürümüyle aynıdır; ek hata: UTF-8 değilse `GecersizGirdi{alan: "belge"}`.
 * Bütün yöntemler eşzamanlıdır: ana iş parçacığından çağrılmaz.
 */
interface AktarmaCekirdegi {
    fun aktarmaBicimi(): AktarmaBicimi
    fun disaAktar(): DisaAktarma
    fun iceAktarmaOnizlemesiBayt(belge: ByteArray): IceAktarmaOnizlemesi
    /** [iz]: önizlemenin izi; telefon o arada değiştiyse `uygulandi` yanlış, yeni plan döner. */
    fun iceAktarBayt(belge: ByteArray, iz: String?): IceAktarmaSonucu

    /** Üretim: UniFFI `Cekirdek`'in bayt API'si. */
    class Gercek(private val c: Cekirdek) : AktarmaCekirdegi {
        override fun aktarmaBicimi() = dev.eren.ajanda.cekirdek.aktarmaBicimi()
        override fun disaAktar() = c.disaAktar()
        override fun iceAktarmaOnizlemesiBayt(belge: ByteArray) = c.iceAktarmaOnizlemesiBayt(belge)
        override fun iceAktarBayt(belge: ByteArray, iz: String?) = c.iceAktarBayt(belge, iz)
    }

    /**
     * Ekran yüzü üstünden (eski kurulum ve sahteler): belge her çağrıda `String`'e çözülür, bellek kazancı yoktur.
     * Baytlar [YedekKabi.oku]'da UTF-8 diye doğrulanmıştır.
     */
    class Yuzden(private val y: CekirdekYuzu) : AktarmaCekirdegi {
        override fun aktarmaBicimi() = y.aktarmaBicimi()
        override fun disaAktar() = y.disaAktar()
        override fun iceAktarmaOnizlemesiBayt(belge: ByteArray) = y.iceAktarmaOnizlemesi(String(belge, Charsets.UTF_8))
        override fun iceAktarBayt(belge: ByteArray, iz: String?) = y.iceAktar(String(belge, Charsets.UTF_8), iz)
    }
}
