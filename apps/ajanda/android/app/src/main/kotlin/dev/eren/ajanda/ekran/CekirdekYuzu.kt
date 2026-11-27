package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.DuzenlemeTemeli
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.GecmisSayfasi
import dev.eren.ajanda.cekirdek.GirdiYolu
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.HatirlatmaOnizlemesi
import dev.eren.ajanda.cekirdek.IslemTuru
import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.ListeSorgusu
import dev.eren.ajanda.cekirdek.RetGirdisi
import dev.eren.ajanda.cekirdek.Sekme
import dev.eren.ajanda.cekirdek.TakvimAyi
import dev.eren.ajanda.cekirdek.TakvimOgesi

/**
 * Ekranların kullandığı çekirdek yüzü. Üretimde [Gercek] (UniFFI `Cekirdek`); testte sahtesi, böylece
 * yenileme ve ret akışı hangi çağrıyı kaç kez yaptığıyla sınanır. Bütün yöntemler eşzamanlıdır: ana
 * iş parçacığından çağrılmaz.
 */
interface CekirdekYuzu {
    fun liste(sekme: Sekme, kapalilarDahil: Boolean): List<KayitGorunumu>
    fun kayit(kayitId: String): KayitGorunumu?
    fun retListesi(): List<RetGirdisi>
    fun baglantiDurumu(): BaglantiDurumu
    fun kip(): CalismaKipi
    fun eslesmeDurumu(): EslesmeDurumu
    fun baglantiAdresi(): String?
    fun ekle(govde: KayitGovdesi): String
    /** [temel]: formun açıldığı hal (yalnız ondan değişen alanlar gider); `null`: gövdenin tamamı istenen hal. */
    fun duzenle(kayitId: String, temel: DuzenlemeTemeli?, govde: KayitGovdesi)
    /** [ornekTarihi]: tekrarın yalnız o örneği (takvim); `null`: kaydın kendisi. */
    fun durumDegistir(kayitId: String, durum: KayitDurumu, ornekTarihi: String? = null)
    /** Takvim ayı (gün özetleri + şeritler; cihaz günleri). Motor kilidini almaz. */
    fun takvimAyi(yil: Int, ay: Int, kapalilarDahil: Boolean): TakvimAyi
    /** Seçili günün öğeleri, çekirdeğin sırasıyla. */
    fun takvimGunu(tarih: String, kapalilarDahil: Boolean): List<TakvimOgesi>
    fun onayla(kayitId: String)
    fun sil(kayitId: String)
    fun geriYukle(kayitId: String)
    fun retAt(islemId: String)
    fun gecmisIste(kayitId: String, onceRev: Long?)
    fun gecmis(kayitId: String): GecmisSayfasi?
    fun govdeyiHazirla(govde: KayitGovdesi): KayitGovdesi
    fun varsayilanHatirlatmalar(): List<Hatirlatma>
    /** Gövde şimdi kaydedilse hatırlatması ne zaman çalar (v2; form notu). Çekirdeğin kuralıyla. */
    fun hatirlatmaOnizlemesi(govde: KayitGovdesi): HatirlatmaOnizlemesi

    class Gercek(private val c: Cekirdek) : CekirdekYuzu {
        override fun liste(sekme: Sekme, kapalilarDahil: Boolean) = c.liste(ListeSorgusu(sekme, kapalilarDahil))
        override fun kayit(kayitId: String) = c.kayit(kayitId)
        override fun retListesi() = c.retListesi()
        override fun baglantiDurumu() = c.baglantiDurumu()
        override fun kip() = c.kip()
        override fun eslesmeDurumu() = c.eslesmeDurumu()
        override fun baglantiAdresi() = c.baglantiAdresi()
        override fun ekle(govde: KayitGovdesi) = c.ekle(govde, GirdiYolu.ELLE)
        override fun duzenle(kayitId: String, temel: DuzenlemeTemeli?, govde: KayitGovdesi) = c.duzenle(kayitId, temel, govde)
        override fun durumDegistir(kayitId: String, durum: KayitDurumu, ornekTarihi: String?) = c.durumDegistir(kayitId, durum, ornekTarihi)
        override fun takvimAyi(yil: Int, ay: Int, kapalilarDahil: Boolean) = c.takvimAyi(yil, ay, kapalilarDahil)
        override fun takvimGunu(tarih: String, kapalilarDahil: Boolean) = c.takvimGunu(tarih, kapalilarDahil)
        override fun onayla(kayitId: String) = c.onayla(kayitId)
        override fun sil(kayitId: String) = c.sil(kayitId)
        override fun geriYukle(kayitId: String) = c.geriYukle(kayitId)
        override fun retAt(islemId: String) = c.retAt(islemId)
        override fun gecmisIste(kayitId: String, onceRev: Long?) = c.gecmisIste(kayitId, onceRev)
        override fun gecmis(kayitId: String) = c.gecmis(kayitId)
        override fun govdeyiHazirla(govde: KayitGovdesi) = dev.eren.ajanda.cekirdek.govdeyiHazirla(govde)
        override fun varsayilanHatirlatmalar() = dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar()
        override fun hatirlatmaOnizlemesi(govde: KayitGovdesi) = c.hatirlatmaOnizlemesi(govde)
    }
}

/**
 * Gözlemci bildiriminde yalnız gerekenin yenilenmesi (saf).
 *
 * - `tumu`: yüklü bütün listeler, ret listesi, bağlantı ve eşleşme.
 * - `eslesme`: eşleşme + bağlantı; `baglanti`: yalnız bağlantı; `retListesi`: ret listesi + bağlantı
 *   (ret sayısı oradadır).
 * - `kayitlar`: önce değişen kayıtlar tek tek okunur (`kayit`, ~1 ms); bir liste yalnız değişen kayıt
 *   ondaysa ya da yeni hali ona giriyorsa yeniden sorgulanır. Yüklü olmayan liste yalnız "bayat"
 *   işaretlenir, gösterilince sorgulanır.
 */
object Yenileme {
    /** Çekirdek bildirimleri arka arkaya gelir: bekleyen işe katılır, tek yenileme yapılır. */
    fun birlestir(a: Degisim?, b: Degisim): Degisim = if (a == null) b else Degisim(
        kayitlar = (a.kayitlar + b.kayitlar).distinct(),
        tumu = a.tumu || b.tumu,
        retListesi = a.retListesi || b.retListesi,
        baglanti = a.baglanti || b.baglanti,
        eslesme = a.eslesme || b.eslesme,
        gecmis = (a.gecmis + b.gecmis).distinct(),
    )

    /** Kaydın yeni hali bu sekmenin sorgusuna girer mi (çekirdeğin süzgeci, `motor/sorgu.rs`). */
    fun uyeMi(sekme: Sekme, k: AjandaKaydi, kapalilarDahil: Boolean): Boolean {
        val kapaliDisarida = !kapalilarDahil && k.durum != KayitDurumu.ACIK
        val tarihli = k.zaman != null && k.zaman !is AjandaZamani.Belirsiz
        return when (sekme) {
            Sekme.SILINENLER -> k.silindi
            Sekme.TASLAKLAR -> !k.silindi && k.taslak && !kapaliDisarida
            Sekme.TARIHLI -> !k.silindi && tarihli && !kapaliDisarida
            Sekme.TARIHSIZ -> !k.silindi && !tarihli && !kapaliDisarida
        }
    }

    data class Plan(
        val listeler: Set<Sekme>,
        val ret: Boolean,
        val baglanti: Boolean,
        val eslesme: Boolean,
        /** Değişen kayıtlar (açık ayrıntı ekranı ve liste kararı için tek tek okunur). */
        val kayitlar: List<String>,
        val gecmis: List<String>,
    ) {
        val bos get() = listeler.isEmpty() && !ret && !baglanti && !eslesme && kayitlar.isEmpty() && gecmis.isEmpty()
    }

    /** Birinci adım: değişen kayıtlar okunmadan önce bilinenler. */
    fun plan(d: Degisim, yukluListeler: Set<Sekme>): Plan = Plan(
        listeler = if (d.tumu) yukluListeler else emptySet(),
        ret = d.tumu || d.retListesi,
        baglanti = d.tumu || d.baglanti || d.eslesme || d.retListesi,
        eslesme = d.tumu || d.eslesme,
        kayitlar = if (d.tumu) emptyList() else d.kayitlar,
        gecmis = d.gecmis,
    )

    /**
     * İkinci adım: değişen kayıtların yeni hali okunduktan sonra hangi listeler yeniden sorgulanır.
     * @param uyeler yüklü listelerdeki kayıt kimlikleri.
     * @param yeniHaller değişen kayıtların yeni hali (`null`: artık yok).
     */
    fun etkilenenListeler(
        uyeler: Map<Sekme, Set<String>>,
        yeniHaller: Map<String, AjandaKaydi?>,
        kapalilarDahil: Boolean,
    ): Set<Sekme> = uyeler.filter { (sekme, idler) ->
        yeniHaller.any { (id, k) ->
            id in idler || (k != null && uyeMi(sekme, k, kapalilarDahil))
        }
    }.keys
}

/** Ret listesi gösterimi ve "düzelt" akışı (saf; çekirdek [CekirdekYuzu] üzerinden). */
object RetListesi {
    data class RetSatiri(
        val islemId: String,
        val baslik: String,
        val islemMetni: String,
        val neden: String,
        val zaman: String,
        val duzeltilebilir: Boolean,
        val aciklama: String,
    )

    fun satir(r: RetGirdisi, simdiMs: Long, dilim: java.time.ZoneId): RetSatiri {
        val baslik = r.govde?.baslik ?: "Kayıt ${r.kayitId.takeLast(6)}"
        val islem = EkranMetinleri.islem(r.islem)
        val neden = EkranMetinleri.retNedeni(r.neden)
        val zaman = EkranMetinleri.goreliAn(r.tsMs, simdiMs, dilim)
        return RetSatiri(
            islemId = r.islemId,
            baslik = baslik,
            islemMetni = islem,
            neden = neden,
            zaman = zaman,
            duzeltilebilir = r.govde != null,
            aciklama = "$islem gönderilemedi: $baslik. $neden",
        )
    }

    /** Düzeltilen gövde nereye yazılır. */
    sealed class Hedef {
        /** Yeni kayıt olarak eklenir (yeni kimlik). */
        object YeniKayit : Hedef()

        /** Kayıt telefonda duruyor: düzeltme ona uygulanır (aynı kaydın kopyası doğmasın). */
        data class MevcutKayit(val kayitId: String) : Hedef()
    }

    /**
     * Ekleme reddi ya da kaydı artık olmayan/silinmiş düzenleme: yeni kayıt. Duran kaydın düzenlemesi:
     * o kayda (sözleşmenin "düzeltip yeniden ekler" yolu; çift kaydı önler).
     */
    fun hedef(r: RetGirdisi, mevcut: AjandaKaydi?): Hedef =
        if (r.islem == IslemTuru.GUNCELLE && mevcut != null && !mevcut.silindi) Hedef.MevcutKayit(r.kayitId) else Hedef.YeniKayit

    /**
     * Düzeltmeyi uygular: önce yaz (`ekle` ya da `duzenle`), ancak başarılıysa ret girdisini at. Yazma
     * hata verirse girdi durur (kaybolmaz), hata çağırana gider. Döner: yazılan kaydın kimliği.
     */
    fun duzelt(c: CekirdekYuzu, islemId: String, govde: KayitGovdesi): String {
        val girdi = c.retListesi().firstOrNull { it.islemId == islemId }
            ?: throw IllegalStateException("ret girdisi artık yok")
        val id = when (val h = hedef(girdi, c.kayit(girdi.kayitId)?.kayit)) {
            is Hedef.YeniKayit -> c.ekle(govde)
            is Hedef.MevcutKayit -> {
                // Ret girdisinin gövdesi istenen tam haldir: görünen halle farkı gider.
                c.duzenle(h.kayitId, null, govde)
                h.kayitId
            }
        }
        c.retAt(islemId)
        return id
    }
}
