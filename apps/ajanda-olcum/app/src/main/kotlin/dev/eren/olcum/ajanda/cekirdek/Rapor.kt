package dev.eren.olcum.ajanda.cekirdek

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Özetin insan okunur Türkçe metni. Hem ekranda hem dışa verilen dosyanın başında kullanılır. */
object Rapor {

    private val SERI_ADI = mapOf(
        Plan.KESIN to "Kesin alarm (setExactAndAllowWhileIdle)",
        Plan.CALAR to "Çalar saat alarmı (setAlarmClock)",
    )

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

    private fun yuzde(x: Double?): String =
        if (x == null) "-" else "%" + String.format(java.util.Locale.ROOT, "%.1f", x * 100).replace('.', ',')

    private fun gecikmeSatiri(g: GecikmeIst): String =
        "n=${g.n}  ortanca ${sure(g.ortanca)}  p95 ${sure(g.p95)}  en kötü ${sure(g.enKotu)}"

    private fun kovaSatiri(g: GecikmeIst): String =
        GecikmeIst.KOVA_ADLARI.zip(g.kovalar).joinToString("  ") { (a, n) -> "$a:$n" }

    /**
     * Dışa verilen dosya: özet satırları '#' ile yorum yapılır, ardından ham günlük gelir.
     * Böylece dosya olduğu gibi yeniden ayrıştırılabilir (GunlukBicimi '#' satırlarını atlar).
     */
    fun disaAktarim(ozetMetni: String, hamGunluk: String, olusturma: Long): String = buildString {
        appendLine("# ajanda-olcum dışa aktarım; oluşturma (epoch ms): $olusturma")
        for (s in ozetMetni.lines()) appendLine("# $s")
        appendLine("#")
        append(hamGunluk)
        if (hamGunluk.isNotEmpty() && !hamGunluk.endsWith("\n")) appendLine()
    }

    fun metin(o: Ozet, bolge: ZoneId): String = buildString {
        val p = o.plan
        if (p == null) {
            appendLine("Ölçüm henüz başlatılmadı.")
        } else {
            appendLine("Ölçüm: ${an(p.bas, bolge)} → ${an(p.son, bolge)}" +
                (o.durdurma?.let { "  (durduruldu ${an(it, bolge)})" } ?: ""))
            val gecen = (minOf(o.simdi, o.durdurma ?: Long.MAX_VALUE) - p.bas).coerceAtLeast(0)
            appendLine("Geçen süre: ${sure(gecen)}")
        }
        appendLine()
        for (s in o.seriler) {
            appendLine("■ ${SERI_ADI[s.kod] ?: s.kod}")
            appendLine("  planlanan ${s.beklenen}  çalan ${s.calan}  kaçan ${s.kacan}  bekleyen ${s.bekleyen}" +
                (if (s.cift > 0) "  çift ${s.cift}" else ""))
            appendLine("  kaçırma oranı (telefon kapalıyken hariç): ${yuzde(s.kacanOrani)}")
            appendLine("  gecikme: ${gecikmeSatiri(s.gecikme)}")
            if (s.gecikme.n > 0) appendLine("  dağılım: ${kovaSatiri(s.gecikme)}")
            for ((k, g) in s.kosula) appendLine("   · $k: ${gecikmeSatiri(g)}")
            if (s.kacanNedenleri.isNotEmpty()) {
                appendLine("  kaçanların nedeni:")
                for ((n, c) in s.kacanNedenleri) appendLine("   · $n: $c")
            }
            if (s.saatPenceresinde > 0) {
                appendLine("  saat değişimi penceresinde (yukarıya katılmadı): ${s.saatPenceresinde}, çalan ${s.saatPenceresindeCalan}")
            }
            if (s.aciklanamayan.isNotEmpty()) {
                appendLine("  açıklanamayan kaçırmalar: " + s.aciklanamayan.joinToString(", ") { an(it, bolge) })
            }
            appendLine()
        }
        if (o.bootlar.isNotEmpty()) {
            appendLine("■ Yeniden başlatmalar: ${o.bootlar.size}")
            for (b in o.bootlar) {
                appendLine("  ${an(b.acilisDuvar, bolge)}: kapanış yayını ${if (b.kapanisYayini) "var" else "yok"}, " +
                    "açılış yayını ${if (b.acilisYayini) "geldi (+${sure(b.yayinGecikme)})" else "GELMEDİ"}, " +
                    "alarmlar ${if (b.kurGecikme != null) "yeniden kuruldu (+${sure(b.kurGecikme)}, ${b.kurKaynak})" else "KURULMADI"}")
            }
            appendLine()
        }
        val dolu = o.pencereler.filter { it.olay > 0 }
        if (dolu.isNotEmpty()) {
            appendLine("■ Olay sonrası pencereler (tüm seriler)")
            for (w in dolu) {
                appendLine("  ${w.ad}: olay ${w.olay}, planlanan ${w.planli}, çalan ${w.calan}; ${gecikmeSatiri(w.gecikme)}")
            }
            appendLine()
        }
        appendLine("■ Periyodik iş (JobScheduler, 15 dk istendi)")
        if (o.isler.isEmpty()) appendLine("  hiç çalışmadı")
        for (i in o.isler) {
            val ad = when (i.id) { "1" -> "kısıtsız"; "2" -> "ağ koşullu"; else -> i.id }
            appendLine("  iş ${i.id} ($ad): ${i.n} kez; aralık ortanca ${sure(i.ortanca)}, p90 ${sure(i.p90)}, en uzun ${sure(i.enUzun)}")
        }
        appendLine()
        appendLine("■ Sistem izleri")
        appendLine("  alarm niyeti denetimi: ${o.piKontrol}, kayıp bulunan: ${o.piKayip}")
        appendLine("  iş kaydı denetimi: ${o.isKontrol}, kayıp bulunan: ${o.isKayip}")
        appendLine("  saat değişimi: ${o.saatOlay}, saat dilimi değişimi: ${o.dilimOlay}")
        if (o.cikislar.isNotEmpty()) {
            appendLine("  süreç çıkışları: " + o.cikislar.entries.joinToString(", ") { "${it.key} ${it.value}" })
        }
        appendLine("  olay ${o.olaySayisi}, olgu görüntüsü ${o.olguSayisi}" +
            (if (o.hataliSatir > 0) ", BOZUK SATIR ${o.hataliSatir}" else ""))
        if (o.olgular.isNotEmpty()) {
            appendLine()
            appendLine("■ Cihaz olguları (son)")
            for ((k, v) in o.olgular) appendLine("  $k: $v")
        }
    }
}
