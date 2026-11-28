package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.AjandaKaynagi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.AlarmKabugu
import dev.eren.ajanda.cekirdek.BaglantiAsamasi
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.DuzenlemeTemeli
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.GecmisSayfasi
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.HatirlatmaOnizlemesi
import dev.eren.ajanda.cekirdek.IceAktarmaOnizlemesi
import dev.eren.ajanda.cekirdek.IceAktarmaSonucu
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
import dev.eren.ajanda.cekirdek.TakvimAyi
import dev.eren.ajanda.cekirdek.TakvimOgesi
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

fun gor(k: AjandaKaydi, bekleyen: Boolean = false, ertelenen: Boolean = false) = KayitGorunumu(k, bekleyen, ertelenen)

fun an(tarih: String, saat: String, dilim: String = "Europe/Istanbul", sure: Int? = null, ifade: String? = null) =
    AjandaZamani.An(tarih, saat, sure, dilim, ifade)

fun gun(tarih: String, dilim: String = "Europe/Istanbul", bolum: GunBolumu? = null) = AjandaZamani.Gun(tarih, bolum, dilim, null)

/** Çağrıları sayan sahte çekirdek yüzü: listeler bellekte, sekme süzgeci [Yenileme.uyeMi] ile. */
class SahteYuz : CekirdekYuzu {
    val kayitlar = linkedMapOf<String, AjandaKaydi>()
    val ret = mutableListOf<RetGirdisi>()
    val cagrilar = mutableListOf<String>()
    /** v3 değişikliği ertelenen kayıtlar (`KayitGorunumu.ertelenen`). */
    val ertelenenler = mutableSetOf<String>()
    var ekleHatasi: Exception? = null
    private var sayac = 0

    fun sifirla() = cagrilar.clear()

    override fun liste(sekme: Sekme, kapalilarDahil: Boolean): List<KayitGorunumu> {
        cagrilar += "liste:$sekme"
        return kayitlar.values.filter { Yenileme.uyeMi(sekme, it, kapalilarDahil) }.map { gor(it, ertelenen = it.kayitId in ertelenenler) }
    }

    override fun kayit(kayitId: String): KayitGorunumu? {
        cagrilar += "kayit:$kayitId"
        return kayitlar[kayitId]?.let { gor(it, ertelenen = it.kayitId in ertelenenler) }
    }

    override fun retListesi(): List<RetGirdisi> {
        cagrilar += "retListesi"
        return ret.toList()
    }

    override fun baglantiDurumu(): BaglantiDurumu {
        cagrilar += "baglantiDurumu"
        return BaglantiDurumu(BaglantiAsamasi.KOPUK, 0, ret.size, null, null, null)
    }

    override fun kip(): CalismaKipi = CalismaKipi.BAGLI

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

    override fun duzenle(kayitId: String, temel: DuzenlemeTemeli?, govde: KayitGovdesi) {
        cagrilar += "duzenle:$kayitId" + if (temel == null) "" else ":temelli"
        val k = kayitlar[kayitId] ?: throw CekirdekHatasi.KayitYok(kayitId)
        kayitlar[kayitId] = k.copy(baslik = govde.baslik, zaman = govde.zaman)
    }

    override fun durumDegistir(kayitId: String, durum: KayitDurumu, ornekTarihi: String?) {
        if (ornekTarihi != null) {
            // Örnek: kaydın kendisi değişmez (takvim sahtesi örnek durumunu tutmaz).
            cagrilar += "durum:$kayitId:$durum:$ornekTarihi"
            return
        }
        cagrilar += "durum:$kayitId:$durum"
        kayitlar[kayitId] = kayitlar.getValue(kayitId).copy(durum = durum)
    }

    /** Takvim: ay -> döndürülecek ay; gün -> öğeler. Tanımsızsa boş. */
    val takvimAylari = mutableMapOf<String, TakvimAyi>()
    val takvimGunleri = mutableMapOf<String, List<TakvimOgesi>>()
    var takvimHatasi: Exception? = null

    override fun takvimAyi(yil: Int, ay: Int, kapalilarDahil: Boolean): TakvimAyi {
        val anahtar = String.format(java.util.Locale.ROOT, "%04d-%02d", yil, ay)
        cagrilar += "takvimAyi:$anahtar" + if (kapalilarDahil) ":kapalilar" else ""
        takvimHatasi?.let { throw it }
        return takvimAylari[anahtar] ?: TakvimAyi(yil, ay, emptyList(), emptyList())
    }

    override fun takvimGunu(tarih: String, kapalilarDahil: Boolean): List<TakvimOgesi> {
        cagrilar += "takvimGunu:$tarih" + if (kapalilarDahil) ":kapalilar" else ""
        takvimHatasi?.let { throw it }
        return takvimGunleri[tarih].orEmpty()
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
    var onizleme = HatirlatmaOnizlemesi(0u, 0u, 0u, null, null)
    override fun hatirlatmaOnizlemesi(govde: KayitGovdesi): HatirlatmaOnizlemesi = onizleme

    // Dışa ve içe aktarma (D3): döndürülecekler testte kurulur; önizlemeler ve sonuçlar sırayla tüketilir.
    var bicim = AktarmaBicimi("ajanda.json", "ekler/", 1, 1024uL * 1024uL, 4096uL)
    var disa: DisaAktarma? = null
    val onizlemeler = ArrayDeque<Any>()
    val iceSonuclari = ArrayDeque<IceAktarmaSonucu>()
    /** `iceAktar`'a gelen belgeler (içerik denetimi için). */
    val iceBelgeleri = mutableListOf<String>()

    override fun aktarmaBicimi(): AktarmaBicimi = bicim

    override fun disaAktar(): DisaAktarma {
        cagrilar += "disaAktar"
        return disa ?: throw IllegalStateException("disa kurulmadı")
    }

    override fun iceAktarmaOnizlemesi(belge: String): IceAktarmaOnizlemesi {
        cagrilar += "iceAktarmaOnizlemesi"
        return when (val o = onizlemeler.removeFirst()) {
            is Exception -> throw o
            else -> o as IceAktarmaOnizlemesi
        }
    }

    override fun iceAktar(belge: String, iz: String?): IceAktarmaSonucu {
        cagrilar += "iceAktar:$iz"
        iceBelgeleri += belge
        return iceSonuclari.removeFirst()
    }
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
