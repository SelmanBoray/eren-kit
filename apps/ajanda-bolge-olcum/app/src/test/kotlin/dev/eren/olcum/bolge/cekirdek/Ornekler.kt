package dev.eren.olcum.bolge.cekirdek

/** Testlerde günlük olayı kurmak için kısa yardımcılar. Bütün değerler uydurmadır. */
object Ornekler {
    const val T0 = 1_800_000_000_000L
    const val DK = Sabit.DK
    const val SA = Sabit.SAAT

    /** boot -> açılışın duvar saati. 1. açılış ölçümden 1 saat önce. */
    val acilislar = HashMap<Int, Long>().apply { put(1, T0 - SA) }

    fun o(tur: String, t: Long, alan: Map<String, String> = emptyMap(), boot: Int = 1): Olay =
        Olay(tur, t, t - (acilislar[boot] ?: (T0 - SA)), boot, alan)

    fun baslangic(wifi2: Boolean = true): MutableList<Olay> = mutableListOf(
        o(Tur.BASLA, T0),
        o(Tur.BOLGE, T0, mapOf("id" to "1", "r" to "150", "wifi" to "0", "dogruluk" to "12")),
        o(Tur.BOLGE, T0, mapOf("id" to "2", "r" to "100", "wifi" to if (wifi2) "1" else "0", "dogruluk" to "30")),
        kur(T0, Kol.GMS), kur(T0, Kol.CERCEVE), kur(T0, Kol.WIFI),
    )

    fun kur(t: Long, kol: String, ok: Boolean = true, boot: Int = 1, neden: String = "basla") =
        o(Tur.KUR, t, mapOf("kol" to kol, "sonuc" to if (ok) "ok" else "hata", "neden" to neden), boot)

    fun algi(
        t: Long, kol: String, gecis: String, bolge: Int, bolum: Int,
        kurSonrasi: Long = 10 * SA, ekran: String = "0", boot: Int = 1, soguk: String = "0",
    ) = o(
        Tur.ALGI, t,
        mapOf(
            "kol" to kol, "gecis" to gecis, "bolge" to "$bolge", "bolum" to "$bolum",
            "kurSonrasi" to "$kurSonrasi", "ekran" to ekran, "soguk" to soguk, "tasarruf" to "0",
        ),
        boot,
    )

    fun elle(t: Long, bolge: Int, gecis: String, dk: Int = 0, boot: Int = 1) =
        o(Tur.ELLE, t, mapOf("bolge" to "$bolge", "gecis" to gecis, "dk" to "$dk"), boot)

    fun etiket(t: Long, bolum: Int, cevap: String, dk: Int = 0) =
        o(Tur.ETIKET, t, mapOf("bolum" to "$bolum", "cevap" to cevap, "dk" to "$dk"))

    fun satir(oz: Ozet, kol: String, gecis: String, donem: Int = 0): SatirOzeti =
        oz.donemler[donem].satirlar.first { it.satir.kol == kol && it.satir.gecis == gecis }
}
