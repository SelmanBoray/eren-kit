package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AjandaKaynagi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.AlarmKabugu
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.GecmisSayfasi
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.KacirilanBildirimi
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.KaynakYolu
import dev.eren.ajanda.cekirdek.KimlikKabugu
import dev.eren.ajanda.cekirdek.KurulacakAlarm
import dev.eren.ajanda.cekirdek.RetGirdisi
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.cekirdek.TurKokeni

/** Örnek kayıt (kişisel veri yok). */
fun kayit(
    id: String,
    baslik: String = "Örnek $id",
    zaman: AjandaZamani? = null,
    tur: KayitTuru = KayitTuru.GOREV,
    durum: KayitDurumu = KayitDurumu.ACIK,
    taslak: Boolean = false,
    silindi: Boolean = false,
    yol: KaynakYolu = KaynakYolu.ELLE,
    kokeni: TurKokeni = TurKokeni.INSAN,
    alinti: String? = null,
    aciklama: String? = null,
    olusturma: Long = 1_000L,
) = AjandaKaydi(
    kayitId = id,
    revizyon = 1,
    tur = tur,
    baslik = baslik,
    aciklama = aciklama,
    zaman = zaman,
    hatirlatmalar = emptyList(),
    tekrar = null,
    ornekler = emptyList(),
    durum = durum,
    taslak = taslak,
    silindi = silindi,
    elleAlanlar = emptyList(),
    kaynak = AjandaKaynagi(
        yol = yol,
        turKokeni = kokeni,
        sohbetId = if (yol == KaynakYolu.SOHBET_ARACI) "s_ornek" else null,
        oturumId = null,
        kaynakMsgId = null,
        deviceId = if (yol == KaynakYolu.ELLE) "d_ornek" else null,
        alinti = alinti,
        tekilAnahtar = null,
    ),
    olusturmaMs = olusturma,
    guncellemeMs = olusturma,
)

fun gor(k: AjandaKaydi, bekleyen: Boolean = false) = KayitGorunumu(k, bekleyen)

fun an(tarih: String, saat: String, dilim: String = "Europe/Istanbul", sure: Int? = null, ifade: String? = null) =
    AjandaZamani.An(tarih, saat, sure, dilim, ifade)

fun gun(tarih: String, dilim: String = "Europe/Istanbul") = AjandaZamani.Gun(tarih, dilim, null)

/** Çağrıları sayan sahte çekirdek yüzü: listeler bellekte, sekme süzgeci [Yenileme.uyeMi] ile. */
class SahteYuz : CekirdekYuzu {
    val kayitlar = linkedMapOf<String, AjandaKaydi>()
    val ret = mutableListOf<RetGirdisi>()
    val cagrilar = mutableListOf<String>()
    var ekleHatasi: Exception? = null
    private var sayac = 0

    fun sifirla() = cagrilar.clear()

    override fun liste(sekme: Sekme, kapalilarDahil: Boolean): List<KayitGorunumu> {
        cagrilar += "liste:$sekme"
        return kayitlar.values.filter { Yenileme.uyeMi(sekme, it, kapalilarDahil) }.map { gor(it) }
    }

    override fun kayit(kayitId: String): KayitGorunumu? {
        cagrilar += "kayit:$kayitId"
        return kayitlar[kayitId]?.let { gor(it) }
    }

    override fun retListesi(): List<RetGirdisi> {
        cagrilar += "retListesi"
        return ret.toList()
    }

    override fun baglantiDurumu(): BaglantiDurumu {
        cagrilar += "baglantiDurumu"
        return BaglantiDurumu(BaglantiAsamasi.KOPUK, 0, ret.size, null, null)
    }

    override fun eslesmeDurumu(): EslesmeDurumu {
        cagrilar += "eslesmeDurumu"
        return EslesmeDurumu.Yok
    }

    override fun baglantiAdresi(): String? {
        cagrilar += "baglantiAdresi"
        return null
    }

    override fun ekle(govde: KayitGovdesi): String {
        cagrilar += "ekle"
        ekleHatasi?.let { throw it }
        val id = "k_y${++sayac}"
        kayitlar[id] = kayit(id, govde.baslik, govde.zaman, govde.tur)
        return id
    }

    override fun duzenle(kayitId: String, govde: KayitGovdesi) {
        cagrilar += "duzenle:$kayitId"
        val k = kayitlar[kayitId] ?: throw CekirdekHatasi.KayitYok(kayitId)
        kayitlar[kayitId] = k.copy(baslik = govde.baslik, zaman = govde.zaman)
    }

    override fun durumDegistir(kayitId: String, durum: KayitDurumu) {
        cagrilar += "durum:$kayitId:$durum"
        kayitlar[kayitId] = kayitlar.getValue(kayitId).copy(durum = durum)
    }

    override fun onayla(kayitId: String) {
        cagrilar += "onayla:$kayitId"
        kayitlar[kayitId] = kayitlar.getValue(kayitId).copy(taslak = false)
    }

    override fun sil(kayitId: String) {
        cagrilar += "sil:$kayitId"
        kayitlar[kayitId] = kayitlar.getValue(kayitId).copy(silindi = true)
    }

    override fun geriYukle(kayitId: String) {
        cagrilar += "geriYukle:$kayitId"
        kayitlar[kayitId] = kayitlar.getValue(kayitId).copy(silindi = false)
    }

    override fun retAt(islemId: String) {
        cagrilar += "retAt:$islemId"
        ret.removeAll { it.islemId == islemId }
    }

    override fun gecmisIste(kayitId: String, onceRev: Long?) {
        cagrilar += "gecmisIste:$kayitId"
    }

    override fun gecmis(kayitId: String): GecmisSayfasi? = null
    override fun govdeyiHazirla(govde: KayitGovdesi): KayitGovdesi = govde
    override fun varsayilanHatirlatmalar(): List<Hatirlatma> = listOf(Hatirlatma.Once(60))
}

/** Gerçek çekirdek için sahte kabuklar (JVM'de Keystore ve AlarmManager yok). */
class TestKimlik : KimlikKabugu {
    private var n = 0
    override fun acikAnahtar(): ByteArray = ByteArray(91) { 1 }
    override fun imzala(veri: ByteArray): ByteArray = ByteArray(70) { 2 }
    override fun dogrula(acikAnahtar: ByteArray, veri: ByteArray, imza: ByteArray): Boolean = true
    override fun rastgele(uzunluk: UInt): ByteArray = ByteArray(uzunluk.toInt()) { (it + 31 * ++n).toByte() }
    override fun anahtariSil() {}
}

class TestAlarm : AlarmKabugu {
    val kurulan = mutableListOf<KurulacakAlarm>()
    override fun kur(alarm: KurulacakAlarm) {
        kurulan += alarm
    }
    override fun iptal(alarmNo: Long) {}
    override fun kacirilanlariGoster(bildirim: KacirilanBildirimi) {}
}
