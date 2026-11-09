package dev.eren.cihaz.cekirdek

/** plan.ts `planHash`: sha256Hex(UTF-8(kanonik(plan))). */
object PlanHash : PlanHashIslemi {
    override fun planHash(plan: JsonDeger): String? =
        when (val sonuc = Kanonik.kanonik(plan)) {
            is KanonikSonucu.Tamam -> Kanonik.sha256Hex(sonuc.metin.toByteArray(Charsets.UTF_8))
            is KanonikSonucu.Hata -> null
        }
}
