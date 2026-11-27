package dev.eren.olcum.bolge.cekirdek

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Özetin insan okunur Türkçe metni (ekranda ve dışa verilen dosyanın başında).
 * Bölgeler yalnız "bölge N" etiketiyle anılır; koordinat ve ad bu nesneye hiç ulaşmaz.
 */
object Rapor {
    const val BASLIK = "AJANDA BÖLGE ÖLÇÜMÜ RAPORU"

    fun sure(ms: Long?): String {
        if (ms == null) return "-"
        val isaret = if (ms < 0) "-" else ""
        val a = Math.abs(ms)
        return isaret + when {
            a < 1_000 -> "$a ms"
            a < 60_000 -> "${a / 1000},${(a % 1000) / 100} sn"
            a < 3_600_000 -> "${a / 60_000} dk ${(a % 60_000) / 1000} sn"
            else -> "${a / 3_600_000} sa ${(a % 3_600_000) / 60_000} dk"
        }
    }

    fun an(t: Long, bolge: ZoneId): String =
        DateTimeFormatter.ofPattern("dd.MM HH:mm").withZone(bolge).format(Instant.ofEpochMilli(t))

    fun yuzde(x: Double?): String =
        if (x == null) "-" else "%" + String.format(Locale.ROOT, "%.1f", x * 100).replace('.', ',')

    private fun ondalik(x: Double, h: Int = 2) = String.format(Locale.ROOT, "%.${h}f", x).replace('.', ',')

    private fun gecikmeSatiri(g: GecikmeIst): String =
        "n=${g.n}  ortanca ${sure(g.ortanca)}  p95 ${sure(g.p95)}  en kötü ${sure(g.enKotu)}"

    private fun kovaSatiri(g: GecikmeIst): String =
        GecikmeIst.KOVA_ADLARI.zip(g.kovalar).joinToString("  ") { (a, n) -> "$a:$n" }

    /**
     * Dışa verilen dosya: özet satırları '#' ile yorum yapılır, ardından ham günlük gelir.
     * Dosya olduğu gibi yeniden ayrıştırılabilir (GunlukBicimi '#' satırlarını atlar).
     */
    fun disaAktarim(ozetMetni: String, hamGunluk: String, olusturma: Long): String = buildString {
        appendLine("# ajanda-bolge-olcum dışa aktarım; oluşturma (epoch ms): $olusturma")
        appendLine("# Bu dosyada koordinat, bölge adı, Wi-Fi ağ adı ve cihaz kimliği yoktur.")
        for (s in ozetMetni.lines()) appendLine("# $s")
        appendLine("#")
        append(hamGunluk)
        if (hamGunluk.isNotEmpty() && !hamGunluk.endsWith("\n")) appendLine()
    }

    private fun StringBuilder.satirYaz(s: SatirOzeti, karar: Boolean) {
        appendLine("▸ ${s.satir.ad}")
        val yonAdi = if (s.satir.yon == Yon.GIRIS) "varış" else "çıkış"
        appendLine("  gerçek $yonAdi ${s.eslesen + s.kacan}: yakalanan ${s.eslesen}, kaçan ${s.kacan}, bekleyen ${s.bekleyen}" +
            "  → kaçırma ${yuzde(s.kacirmaOrani)} (${s.kacirmaPay}/${s.kacirmaPayda})")
        if (s.kacanNedenleri.isNotEmpty()) {
            appendLine("  kaçanların nedeni: " + s.kacanNedenleri.entries.joinToString(", ") { "${it.key} ${it.value}" })
        }
        appendLine("  gecikme: ${gecikmeSatiri(s.gecikme)}")
        if (s.gecikme.n > 0) appendLine("  dağılım: ${kovaSatiri(s.gecikme)}" + if (s.erken > 0) "  (etiket tahmininden erken: ${s.erken})" else "")
        appendLine("  yanlış tetik: " + s.yanlis.entries.joinToString(", ") { "${it.key} ${it.value}" } +
            "  → yanlış oranı ${yuzde(s.yanlisOrani)}")
        appendLine("  diğer algı: kurulum tetiği ${s.kurulum}, tekrar ${s.tekrar}, etiketsiz ${s.etiketsiz}")
        if (s.gecisToplam > 0) appendLine("  bildirilen önünden geçmelerde tetiklendi: ${s.gecisTetik}/${s.gecisToplam}")
        for ((k, g) in s.kosulGecikme) appendLine("   · gecikme, $k: ${gecikmeSatiri(g)}")
        for ((k, p) in s.kosulKacirma) appendLine("   · kaçırma, $k: ${p.first}/${p.second}")
        if (karar) appendLine("  KARAR: ${s.karar}")
    }

    fun metin(o: Ozet, bolge: ZoneId): String = buildString {
        appendLine(BASLIK)
        if (o.bas == null) {
            appendLine("Ölçüm henüz başlatılmadı.")
        } else {
            val bitis = o.durdurma
            appendLine("Ölçüm: ${an(o.bas, bolge)} → " + (bitis?.let { "${an(it, bolge)} (durduruldu)" } ?: "sürüyor"))
            appendLine("Geçen süre: ${sure((minOf(o.simdi, bitis ?: Long.MAX_VALUE) - o.bas).coerceAtLeast(0))}")
        }
        if (o.bolgeler.isEmpty()) appendLine("Bölge tanımlanmadı.")
        for (b in o.bolgeler) {
            appendLine("  bölge ${b.id}: yarıçap ${b.yaricap ?: "?"} m, Wi-Fi ${if (b.wifi) "eşli" else "eşsiz"}, " +
                "kayıt doğruluğu ±${b.dogruluk ?: "?"} m" + if (b.silindi) " (silindi)" else "")
        }
        appendLine("Gerçek olaylar: varış ${o.gercekGiris}, çıkış ${o.gercekCikis}, önünden geçme ${o.gecisSayisi}; " +
            "etiketlenmemiş bildirim ${o.etiketsizBolum}")
        appendLine("Karar ölçütü (giriş kolları): kaçırma < %5 ve gecikme p95 < 5 dk, en az ${Sabit.MIN_ORNEK} gerçek varış.")
        appendLine()

        for (d in o.donemler) {
            appendLine("■ ${d.ad}")
            for (s in d.satirlar.filter { it.satir.yon == Yon.GIRIS }) satirYaz(s, karar = true)
            for (s in d.satirlar.filter { it.satir.yon == Yon.CIKIS }) satirYaz(s, karar = false)
            appendLine()
        }

        appendLine("■ Yeniden başlatmalar: ${o.bootlar.size}")
        for (b in o.bootlar) {
            appendLine("  ${an(b.acilis, bolge)}: kapanış yayını ${if (b.kapanisYayini) "var" else "yok"}, " +
                "açılış yayını ${b.yayin?.let { "geldi (+${sure(it)})" } ?: "GELMEDİ"}, " +
                "ilk canlanma ${b.ilkCanlanma ?: "-"}${b.ilkCanlanmaMs?.let { " (+${sure(it)})" } ?: ""}")
            val kurlar = Kol.HEPSI.joinToString(", ") { k ->
                val v = b.kurlar[k]
                "${Kol.ad(k)} " + (v?.let { "+${sure(it.first)} (${it.second})" } ?: "KURULMADI")
            }
            appendLine("    yeniden kurulum: $kurlar")
            if (b.kurulumTetikleri.isNotEmpty()) appendLine("    kurulum tetikleri: " + b.kurulumTetikleri.joinToString("; "))
        }
        appendLine()

        appendLine("■ Konum kapatıp açma: ${o.konumDongu.size}")
        for (k in o.konumDongu) {
            val acik = k.acilma
            appendLine("  ${an(k.kapanma, bolge)}: kapalı kaldı ${acik?.let { sure(it - k.kapanma) } ?: "(hâlâ kapalı ya da açılış görülmedi)"}, " +
                "Play hata olayı ${if (k.gmsHata) "geldi" else "gelmedi"}")
            if (acik != null) appendLine("    yeniden kurulum: " + Kol.HEPSI.joinToString(", ") { kol ->
                "${Kol.ad(kol)} " + (k.kurlar[kol]?.let { "+${sure(it.first)} (${it.second})" } ?: "KURULMADI")
            })
        }
        appendLine()

        appendLine("■ Konum alma (bulunduğum yeri kaydet / sına): ${o.konumAlma.size}")
        for (k in o.konumAlma) {
            val amac = when (k.metin("amac")) { "kayit" -> "kayıt"; "sina" -> "sınama"; "vazgecildi" -> "vazgeçilen kayıt"; else -> k.metin("amac") }
            val kaynaklar = k.alan.keys.filter { it.startsWith("k_") && it.endsWith("_n") }.map { it.removePrefix("k_").removeSuffix("_n") }
            appendLine("  ${an(k.duvar, bolge)} $amac, ${if (k.bayrak("kapali") == true) "kapalı alan" else "açık alan/belirtilmedi"}: " +
                "ilk konum ${sure(k.sayi("ilk"))}, ±50 m ${sure(k.sayi("ilk50"))}, ±20 m ${sure(k.sayi("ilk20"))}, " +
                "en iyi ±${k.metin("enIyi") ?: "-"} m (${k.metin("secilen") ?: "-"}), süre ${sure(k.sayi("toplam"))}, örnek ${k.metin("n")}")
            if (kaynaklar.isNotEmpty()) appendLine("    kaynaklar: " + kaynaklar.joinToString("; ") { a ->
                "$a ilk ${sure(k.sayi("k_${a}_ilk"))} en iyi ±${k.metin("k_${a}_enIyi") ?: "-"} m"
            })
            if (k.metin("amac") == "sina") {
                appendLine("    en yakın bölge ${k.metin("bolge") ?: "-"}: merkeze ${k.metin("uzaklik") ?: "-"} m, " +
                    "içeride ${if (k.bayrak("icinde") == true) "evet" else "hayır"}")
            }
        }
        appendLine()

        appendLine("■ Pil (kaba; şarjsız aralıklarda toplam düşüş, bütün telefonun tüketimi)")
        if (o.pil.isEmpty()) appendLine("  yeterli örnek yok")
        for (p in o.pil) appendLine("  ${p.ad}: ${ondalik(p.saat, 1)} saat, düşüş %${p.dusus} → " +
            (p.oran?.let { "%${ondalik(it)}/saat" } ?: "-"))
        appendLine()

        appendLine("■ Sistem izleri")
        appendLine("  Wi-Fi olayları: " + o.wifi.entries.joinToString(", ") { "${it.key} ${it.value}" })
        if (o.denetim.isNotEmpty()) appendLine("  soğuk girişte iz denetimi: " +
            o.denetim.entries.joinToString(", ") { "${Kol.ad(it.key)} ${it.value.first} (iz yok ${it.value.second})" })
        if (o.kurHatalari.isNotEmpty()) appendLine("  kurulum hataları: " + o.kurHatalari.entries.joinToString(", ") { "${it.key} ${it.value}" })
        if (o.gmsHatalari.isNotEmpty()) appendLine("  Play hata olayları (kod): " + o.gmsHatalari.entries.joinToString(", ") { "${it.key} ${it.value}" })
        if (o.cikislar.isNotEmpty()) appendLine("  süreç çıkışları: " + o.cikislar.entries.joinToString(", ") { "${it.key} ${it.value}" })
        if (o.beyanlar.isNotEmpty()) appendLine("  kullanıcı beyanı (son): " + o.beyanlar.entries.joinToString(", ") { "${it.key}=${it.value}" })
        appendLine("  olay ${o.olaySayisi}" + if (o.hataliSatir > 0) ", BOZUK SATIR ${o.hataliSatir}" else "")
        if (o.olgular.isNotEmpty()) {
            appendLine()
            appendLine("■ Cihaz olguları (son görüntü)")
            for ((k, v) in o.olgular) appendLine("  $k: $v")
        }
    }
}
