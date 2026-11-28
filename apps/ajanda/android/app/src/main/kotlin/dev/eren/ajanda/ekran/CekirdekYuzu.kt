package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AktarmaBicimi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.BaglantiDurumu
import dev.eren.ajanda.cekirdek.CalismaKipi
import dev.eren.ajanda.cekirdek.Cekirdek
import dev.eren.ajanda.cekirdek.Degisim
import dev.eren.ajanda.cekirdek.DisaAktarma
import dev.eren.ajanda.cekirdek.DuzenlemeTemeli
import dev.eren.ajanda.cekirdek.ErtelenenGeriAlma
import dev.eren.ajanda.cekirdek.EslesmeDurumu
import dev.eren.ajanda.cekirdek.GecmisSayfasi
import dev.eren.ajanda.cekirdek.GirdiYolu
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.HatirlatmaOnizlemesi
import dev.eren.ajanda.cekirdek.IceAktarmaOnizlemesi
import dev.eren.ajanda.cekirdek.IceAktarmaSonucu
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
    /**
     * Ret listesinden "düzelt" (çekirdek `ret_duzelt`): gövdeyi yazar, işlemin v3 kısmını korur, başarılıysa
     * girdiyi listeden çıkarır (hata verirse girdi kalır). Hedefi çekirdek seçer: duran kaydın düzenleme reddi
     * o kayda, öteki girdiler (ve "kayıt sonra değişti" işaretliler) yeni kayıt. `ertelenenAtildi` girdisinde
     * `GecersizGirdi`. Döner: yazılan kaydın kimliği.
     */
    fun retDuzelt(islemId: String, govde: KayitGovdesi): String
    /**
     * Eski servise bağlıyken ertelenen v3 değişikliklerini atar (`kayitId`: o kayıt; `null`: hepsi); her biri
     * ret listesine `ertelenenAtildi` girdisi olarak geçer. Döner: geçen girdi sayısı. Ekrana bağlı değil.
     */
    fun ertelenenleriAt(kayitId: String?): Int
    /**
     * Ret listesindeki atılmış ertelenen değişikliği (`ertelenenAtildi` girdisi) kaydın şimdiki haline yeniden
     * uygular (çekirdek `ertelenen_geri_al_denetimli`, C1). Atıldıktan sonra değişmiş alan varsa ve [zorla]
     * yanlışsa hiçbir şey yapılmaz, `cakisan` dolu döner (girdi kalır); [zorla] doğruysa o alanlar da yazılır.
     * Girdi listede yoksa `bulundu` yanlış. Ekrana bağlı değil.
     */
    fun ertelenenGeriAlDenetimli(islemId: String, zorla: Boolean): ErtelenenGeriAlma
    fun gecmisIste(kayitId: String, onceRev: Long?)
    fun gecmis(kayitId: String): GecmisSayfasi?
    fun govdeyiHazirla(govde: KayitGovdesi): KayitGovdesi
    fun varsayilanHatirlatmalar(): List<Hatirlatma>
    /** Gövde şimdi kaydedilse hatırlatması ne zaman çalar (v2; form notu). Çekirdeğin kuralıyla. */
    fun hatirlatmaOnizlemesi(govde: KayitGovdesi): HatirlatmaOnizlemesi
    /** Yedek kabının düzeni (D3; `aktarma/YedekKabi`). */
    fun aktarmaBicimi(): AktarmaBicimi
    fun disaAktar(): DisaAktarma
    fun iceAktarmaOnizlemesi(belge: String): IceAktarmaOnizlemesi
    /** [iz]: önizlemenin izi; telefon o arada değiştiyse `uygulandi` yanlış, yeni plan döner. */
    fun iceAktar(belge: String, iz: String?): IceAktarmaSonucu

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
        override fun retDuzelt(islemId: String, govde: KayitGovdesi) = c.retDuzelt(islemId, govde)
        override fun ertelenenleriAt(kayitId: String?) = c.ertelenenleriAt(kayitId)
        override fun ertelenenGeriAlDenetimli(islemId: String, zorla: Boolean) = c.ertelenenGeriAlDenetimli(islemId, zorla)
        override fun gecmisIste(kayitId: String, onceRev: Long?) = c.gecmisIste(kayitId, onceRev)
        override fun gecmis(kayitId: String) = c.gecmis(kayitId)
        override fun govdeyiHazirla(govde: KayitGovdesi) = dev.eren.ajanda.cekirdek.govdeyiHazirla(govde)
        override fun varsayilanHatirlatmalar() = dev.eren.ajanda.cekirdek.varsayilanHatirlatmalar()
        override fun hatirlatmaOnizlemesi(govde: KayitGovdesi) = c.hatirlatmaOnizlemesi(govde)
        override fun aktarmaBicimi() = dev.eren.ajanda.cekirdek.aktarmaBicimi()
        override fun disaAktar() = c.disaAktar()
        override fun iceAktarmaOnizlemesi(belge: String) = c.iceAktarmaOnizlemesi(belge)
        override fun iceAktar(belge: String, iz: String?) = c.iceAktar(belge, iz)
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
        /** Düzeltme formu sunulur mu: gövdesi var ve atılmış ertelenen değişiklik değil. */
        val duzeltilebilir: Boolean,
        val aciklama: String,
        /** Satırın alt yazısı: "Ekleme gönderilemedi" ya da (atılmış ertelenen değişiklikte) "Düzenleme atıldı". */
        val durum: String = "$islemMetni gönderilemedi",
        /** "Kayıt bu yedekten sonra değişti" uyarısı (`kayitSonraDegisti`); yoksa `null`. */
        val uyari: String? = null,
    )

    /** Atılmış ertelenen değişikliğin nedeni (çekirdeğin `TeslimEdilemedi`'si bu girdide bağlantı kopması değil). */
    fun ertelenenNedeni(ulasmisOlabilir: Boolean): String =
        if (ulasmisOlabilir) "Eren servisi eski olduğu için atıldı. Eren servisine ulaşmış olabilir."
        else "Eren servisi eski olduğu için gönderilmeden atıldı."

    /**
     * Yedekten gelen, kaydı sonra değişmiş girdinin uyarısı. Çekirdek böyle girdinin düzeltmesini var olan kayda
     * uygulamaz, yeni kayıt ekler (`ret_duzelt`); atılmış ertelenen değişiklik geri alınırsa güncel kaydın üstüne gelir.
     */
    fun sonraDegistiUyarisi(r: RetGirdisi): String? = when {
        !r.kayitSonraDegisti -> null
        r.ertelenenAtildi -> "Kayıt bu yedekten sonra değişti; bu değişiklik yeniden uygulanırsa güncel kaydın üstüne gelir."
        r.govde != null -> "Kayıt bu yedekten sonra değişti; düzeltme güncel kaydın üstüne yazılmaz, yeni bir kayıt olarak eklenir."
        else -> "Kayıt bu yedekten sonra değişti."
    }

    fun satir(r: RetGirdisi, simdiMs: Long, dilim: java.time.ZoneId): RetSatiri {
        val baslik = r.govde?.baslik ?: "Kayıt ${r.kayitId.takeLast(6)}"
        val islem = EkranMetinleri.islem(r.islem)
        val neden = if (r.ertelenenAtildi) ertelenenNedeni(r.ulasmisOlabilir) else EkranMetinleri.retNedeni(r.neden)
        val zaman = EkranMetinleri.goreliAn(r.tsMs, simdiMs, dilim)
        val durum = if (r.ertelenenAtildi) "$islem atıldı" else "$islem gönderilemedi"
        val uyari = sonraDegistiUyarisi(r)
        return RetSatiri(
            islemId = r.islemId,
            baslik = baslik,
            islemMetni = islem,
            neden = neden,
            zaman = zaman,
            duzeltilebilir = r.govde != null && !r.ertelenenAtildi,
            aciklama = "$durum: $baslik. $neden" + (uyari?.let { " $it" } ?: ""),
            durum = durum,
            uyari = uyari,
        )
    }

    /**
     * Düzeltmeyi uygular ([CekirdekYuzu.retDuzelt]; hedefi çekirdek seçer, v3 kısmı korunur). Yazma hata verirse
     * girdi durur (kaybolmaz), hata çağırana gider. Döner: yazılan kaydın kimliği.
     */
    fun duzelt(c: CekirdekYuzu, islemId: String, govde: KayitGovdesi): String = c.retDuzelt(islemId, govde)
}
