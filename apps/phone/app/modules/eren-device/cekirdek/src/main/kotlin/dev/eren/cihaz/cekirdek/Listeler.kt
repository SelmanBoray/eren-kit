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

    /** Kararı olmayan (ya da açık kararının imzası değişmiş) kurulu uygulamanın varsayılanı; görüntüyle bir kez hesaplanır. */
    private val varsayilan: Map<String, UygulamaDurumu> = girdi.kurulu.associate {
        it.paket to if (HassasUygulamalar.otomatikHassasMi(it.paket, it.ad)) UygulamaDurumu.HASSAS else UygulamaDurumu.ACIK
    }

    fun durum(paket: String): UygulamaDurumu {
        // 1. Değişmez her kararın önündedir.
        if (paket in degismez) return UygulamaDurumu.DEGISMEZ
        // 2. Kurulu değil: imza bilgisi yok, kapı reddeder.
        val imza = imzalar[paket] ?: return UygulamaDurumu.YENI
        val karar = kararlar[paket]
        // 3. Kullanıcının HASSAS kararı imza değişse de geçerli: daha kısıtlayıcı olan güvenlidir.
        if (karar?.durum == UygulamaDurumu.HASSAS) return UygulamaDurumu.HASSAS
        // 4. Kullanıcının ACIK kararı yalnız aynı imzayla geçerli (bilerek açılmış banka dahil).
        if (karar?.durum == UygulamaDurumu.ACIK && karar.imzaOzeti == imza) return UygulamaDurumu.ACIK
        // 5. Karar yok ya da açık kararın imzası değişmiş: banka ve benzeri hassas, kalanı açık.
        return varsayilan[paket] ?: UygulamaDurumu.HASSAS
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
