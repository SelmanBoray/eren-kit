package dev.eren.cihaz.cekirdek

/** Sabit değişmez ret adları. Ana ekran paketi bilerek yok: üreticiye göre değişir, intent çözümüyle gelir ya da gelmez. */
private val SABIT_DEGISMEZ: Set<String> = setOf(
    "com.android.settings",
    "com.google.android.packageinstaller",
    "com.android.packageinstaller",
    "com.android.vending",
    "com.google.android.permissioncontroller",
    "com.android.permissioncontroller",
    "com.miui.securitycenter",
    "com.tailscale.ipn",
    "com.android.systemui",
)

/** Değişmez görüntü; `guncelle` bütününü atomik değiştirir, okuyanlar yarım durum görmez. */
private class ListeGoruntusu(kendiPaketi: String, girdi: ListeGirdisi) {
    private val degismez: Set<String> = SABIT_DEGISMEZ + girdi.cozulenDegismez + kendiPaketi
    private val imzalar: Map<String, String> = girdi.kurulu.associate { it.paket to it.imzaOzeti }
    private val kararlar: Map<String, KullaniciKarari> = girdi.kararlar.toMap()
    private val kurulu: List<KuruluUygulama> = girdi.kurulu.toList()

    fun durum(paket: String): UygulamaDurumu {
        if (paket in degismez) return UygulamaDurumu.DEGISMEZ
        val imza = imzalar[paket] ?: return UygulamaDurumu.YENI
        val karar = kararlar[paket] ?: return UygulamaDurumu.YENI
        if (karar.imzaOzeti != imza) return UygulamaDurumu.YENI
        return when (karar.durum) {
            UygulamaDurumu.ACIK -> UygulamaDurumu.ACIK
            UygulamaDurumu.HASSAS -> UygulamaDurumu.HASSAS
            UygulamaDurumu.YENI, UygulamaDurumu.DEGISMEZ -> UygulamaDurumu.YENI
        }
    }

    fun uygulamalar(): List<UygulamaBilgisi> =
        kurulu.map { UygulamaBilgisi(it.paket, it.ad, durum(it.paket)) }
}

private class ListelerGercek(private val kendiPaketi: String, girdi: ListeGirdisi) : Listeler {
    @Volatile
    private var goruntu = ListeGoruntusu(kendiPaketi, girdi)

    override fun durum(paket: String): UygulamaDurumu = goruntu.durum(paket)

    override fun uygulamalar(): List<UygulamaBilgisi> = goruntu.uygulamalar()

    override fun guncelle(girdi: ListeGirdisi) {
        goruntu = ListeGoruntusu(kendiPaketi, girdi)
    }
}

val listelerKur: ListelerFabrikasi = ListelerFabrikasi { kendiPaketi, girdi ->
    ListelerGercek(kendiPaketi, girdi)
}
