package dev.eren.ajanda.ekran.sahne.veri

import dev.eren.ajanda.cekirdek.KayitDurumu
import dev.eren.ajanda.cekirdek.KayitGorunumu
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.ekran.CekirdekYuzu
import dev.eren.ajanda.ekran.EkranMetinleri
import dev.eren.ajanda.ekran.GeriAlma
import dev.eren.ajanda.ekran.IslemSonucu
import dev.eren.ajanda.ekran.KayitFormu
import dev.eren.ajanda.ekran.Liste

/**
 * Bugün, Takvim ve Tarihsizler'in ortak kayıt kurucusu ve durum işlemi (saf; arka iş parçacığında çağrılır).
 * Ekranlar aynı kaydı aynı renk, çizim ve okunuşla çizsin diye tek yerde.
 */
internal object KayitKurucu {

    /**
     * Çekirdek görünümünden ekran kaydı. [zaman] ekranın zaman metni (günü kendisi seçer). [bolge]: v3 BAĞLANTI
     * NOKTASI: kaydın bölge alanı gelince yalnız adı verilir; zaman satırına "@ ⟨ad⟩" olarak eklenir (YOL-HARITASI 4.3).
     */
    fun kur(
        g: KayitGorunumu,
        anahtar: String,
        zaman: String?,
        hal: LevhaHali,
        gecti: Boolean,
        ornekTarihi: String?,
        gonderim: Liste.Gonderim,
        durumMetni: String?,
        iptal: Boolean = false,
        bolge: String? = null,
    ): BugunKaydi {
        val k = g.kayit
        val bekleyen = gonderim.okunus.takeIf { g.bekleyen }
        // v3 BAĞLANTI NOKTASI: kaydın simge alanı gelince `simge = k.simge` olur; öneriden önce gelir.
        val cizim = Gorunus.cizim(simge = null, baslik = k.baslik)
        val zamanSatiri = bolgeli(zaman, bolge)
        val ham = BugunKaydi(
            anahtar = anahtar,
            kayitId = k.kayitId,
            baslik = k.baslik,
            zaman = zamanSatiri,
            renk = Gorunus.renkAnahtardan(cizim),
            cizim = cizim,
            hal = hal,
            gecti = gecti,
            tamamlanabilir = k.tur != KayitTuru.NOT && !k.silindi,
            ornekTarihi = ornekTarihi,
            bekleyen = bekleyen,
            tekrar = k.tekrar != null,
            asistan = Liste.otomatikMi(k.kaynak),
            iptal = iptal,
        )
        val aciklama = buildString {
            append(k.baslik)
            zamanSatiri?.let { append(", ").append(it) }
            if (k.tur != KayitTuru.GOREV) append(", ").append(Gorunus.kucuk(EkranMetinleri.tur(k.tur)))
            durumMetni?.let { append(", ").append(it) }
            append(Gorunus.isaretOkunusu(ham))
        }
        return ham.copy(aciklama = aciklama)
    }

    /** Zaman satırı ve bölge etiketi: "13:00–21:00 @ İş yeri"; zamansızda yalnız "@ İş yeri". */
    fun bolgeli(zaman: String?, bolge: String?): String? = when {
        bolge.isNullOrBlank() -> zaman
        zaman == null -> "@ $bolge"
        else -> "$zaman @ $bolge"
    }

    fun durumMetni(d: KayitDurumu): String? = when (d) {
        KayitDurumu.TAMAM -> "tamamlandı"
        KayitDurumu.IPTAL -> "iptal edildi"
        KayitDurumu.ACIK -> null
    }

    fun hal(durum: KayitDurumu, taslak: Boolean): LevhaHali = when {
        durum != KayitDurumu.ACIK -> LevhaHali.BITTI
        taslak -> LevhaHali.TASLAK
        else -> LevhaHali.ACIK
    }

    private fun kisalt(s: String) = if (s.length > 40) s.take(39) + "…" else s

    inline fun yap(blok: () -> IslemSonucu): IslemSonucu = try {
        blok()
    } catch (e: Exception) {
        IslemSonucu(KayitFormu.hataMesaji(e).mesaj, hata = true)
    }

    /** Örneği belli olmayan tekrarlı kayıt: durumu değiştirmek bütün seriyi kapatırdı. */
    const val SERI_UYARISI = "Tekrarlayan işin hangi günü olduğu belli değil; günü takvimden seç."

    /**
     * Tamamlar ([tamam]) ya da yeniden açar. Tost: "Bitti: ⟨başlık⟩" + Geri al; tekrarın bugün olmayan örneğinde
     * günü de söyler ("Bitti: Ders (13 Mar)"). Geri alma kaydın önceki durumuna döner (iptal edilmiş iş yeniden
     * açılıp geri alınınca iptal kalır). Örnekte yalnız o gün değişir.
     *
     * Tekrarlı kaydın örnek tarihi yoksa **hiçbir şey yapılmaz** (hata tostu): çekirdek örneksiz durum değişikliğini
     * kaydın kendisine uygular, seri kapanır ve gelecekteki bütün örnekler kaybolur. Ekranlar böyle kaydı zaten
     * tamamlanamaz kurar ([BugunKaydi.tamamlanabilir]); bu son savunma.
     */
    fun tamamla(c: CekirdekYuzu, k: BugunKaydi, tamam: Boolean, bugun: java.time.LocalDate? = null): IslemSonucu =
        if (k.tekrar && k.ornekTarihi == null) IslemSonucu(SERI_UYARISI, hata = true) else durumuDegistir(c, k, tamam, bugun)

    private fun durumuDegistir(c: CekirdekYuzu, k: BugunKaydi, tamam: Boolean, bugun: java.time.LocalDate?): IslemSonucu = yap {
        val yeni = if (tamam) KayitDurumu.TAMAM else KayitDurumu.ACIK
        val onceki = when {
            k.hal != LevhaHali.BITTI -> KayitDurumu.ACIK
            k.iptal -> KayitDurumu.IPTAL
            else -> KayitDurumu.TAMAM
        }
        c.durumDegistir(k.kayitId, yeni, k.ornekTarihi)
        val gun = k.ornekTarihi?.let { runCatching { java.time.LocalDate.parse(it) }.getOrNull() }
            ?.takeIf { bugun == null || it != bugun }
            ?.let { " (${EkranMetinleri.kisaTarih(it, bugun ?: it)})" } ?: ""
        val b = kisalt(k.baslik) + gun
        IslemSonucu(
            if (tamam) "Bitti: $b" else "Yeniden açıldı: $b",
            GeriAlma.Durum(k.kayitId, onceki, k.ornekTarihi).takeIf { onceki != yeni },
        )
    }

    fun onayla(c: CekirdekYuzu, id: String): IslemSonucu = yap {
        c.onayla(id)
        IslemSonucu("Onaylandı")
    }

    fun hepsiniOnayla(c: CekirdekYuzu, idler: List<String>): IslemSonucu = yap {
        idler.forEach { c.onayla(it) }
        IslemSonucu(if (idler.size == 1) "Onaylandı" else "${idler.size} öneri onaylandı")
    }

    fun vazgec(c: CekirdekYuzu, id: String): IslemSonucu = yap {
        c.sil(id)
        IslemSonucu("Öneriden vazgeçildi", GeriAlma.GeriYukle(id))
    }

    fun geriAl(c: CekirdekYuzu, g: GeriAlma): IslemSonucu = yap {
        when (g) {
            is GeriAlma.Durum -> c.durumDegistir(g.kayitId, g.durum, g.ornekTarihi)
            is GeriAlma.GeriYukle -> c.geriYukle(g.kayitId)
            is GeriAlma.Sil -> c.sil(g.kayitId)
        }
        IslemSonucu("Geri alındı")
    }

    fun kimlik(g: GeriAlma): String = when (g) {
        is GeriAlma.Durum -> g.kayitId
        is GeriAlma.GeriYukle -> g.kayitId
        is GeriAlma.Sil -> g.kayitId
    }
}
