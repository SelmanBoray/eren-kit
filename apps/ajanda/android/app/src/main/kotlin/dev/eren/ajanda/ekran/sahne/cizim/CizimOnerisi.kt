package dev.eren.ajanda.ekran.sahne.cizim

/**
 * Kayıt başlığından çizim anahtarı önerir ("Arabayı yıkat" -> `araba`).
 *
 * Eşleme kuralları (ayrıntı ve gerekçe: `apps/ajanda/tasarim/SIMGELER.md`):
 * - Başlık sözcüklere bölünür; anahtar sözcük yalnız bir sözcüğün **başından** aranır
 *   ("fotoğraf" içindeki "oto" eşleşmez).
 * - Küçük harfe çevirme Türkçe kurala göredir (İ -> i). Büyük `I` hem `ı` hem `i` sayılır
 *   (Türkçe olmayan klavyeyle büyük harf yazan kullanıcı için).
 * - Kullanıcı Türkçe harfi düz yazabilir ("dis" -> diş, "sac" -> saç) ama tersi geçmez:
 *   "dış" diş değildir. Yani başlıktaki `c` sözcükteki `ç` ile eşleşir, `ı` ise `i` ile eşleşmez.
 * - Kısa ya da başka sözcüğün başı olan sözcükler "tam" kiptedir: arkasından yalnız ad çekim
 *   ekleri gelebilir ("kirayı" evet, "kiraz" hayır). Öteki sözcükler "önek" kiptedir: arkası serbesttir
 *   ("dişçiye", "markete", "temizlikçi").
 * - Tam kipte ek, adlarla karışmasın diye sıkıdır (G9):
 *   - Kesme işareti kökü ayırır: kesmeden önceki kısım sözcüğün kendisi olmalı ("PTT'ye" evet; "Asım'ı" aşı,
 *     "Romanya'ya" roman değil). Kesmeden sonraki ek ünlü uyumuna bakılmadan kabul edilir (kısaltma okunuşa uyar).
 *   - Kesme yoksa ek ünlü uyumuna uyar (kökün son ünlüsü kalınsa ekte `e`, inceyse `a` yok: "Asiye" aşı değil) ve
 *     kaynaştırma `y`'si yalnız ünlüyle biten köke gelir ("romanya" roman+ya değil).
 *   - Başlıkta düz yazılmış `ı` (`i`) yalnız yalın hâlde eşleşir ("hali" halı) ama ekle eşleşmez: "Halim",
 *     "Halime" ad, halı+m değil. Önek kipinde düz `i` serbesttir ("toplantiya").
 * - Birden çok eşleşmede: önce güçlü anahtar (bağlam anahtarları `is`, `ev`, `okul`, `telefon`
 *   zayıftır), sonra başlıkta önce geçen, aynı yerden başlıyorsa daha uzun eşleşme kazanır.
 *
 * Klavye her harfte çağırır: başlık bir kez taranır, sözcükler ilk harfe göre dizinlidir;
 * düzenli ifade yalnız tam kipte, kalan ekin üstünde koşar.
 */
object CizimOnerisi {

    /** Eşleşme yoksa çağıranın kullandığı anahtar. */
    const val GENEL = "genel"

    /** Sözleşmedeki 29 anahtarın tamamı (`genel` dahil), sözleşme sırasıyla. */
    val ANAHTARLAR: List<String> = listOf(
        "genel", "araba", "banka", "dis", "dogum_gunu", "doktor", "ev", "fatura", "ilac", "is",
        "kahve", "kargo", "kitap", "market", "okul", "sac", "seyahat", "spor", "telefon", "temizlik",
        "toplanti", "yemek", "kamp", "evcil", "bitki", "tamir", "camasir", "eglence", "mektup",
    )

    /** Bağlam anahtarları: başka bir anahtar da eşleşirse ona yer verir ("iş yerinde toplantı" -> toplanti). */
    val ZAYIF: Set<String> = setOf("is", "ev", "okul", "telefon")

    /**
     * Ham tablo. Yazım: `*` sonda = önek kipi; `+` sonda = tam kip ama yalın hâli eşleşmez
     * (yalnız ekli: "pazara", "pazardan"); işaretsiz = tam kip. Boşluk içeren giriş sözcük öbeğidir:
     * son parça dışındaki parçalar ekisiz tam eşleşmelidir.
     */
    private val HAM: Map<String, List<String>> = linkedMapOf(
        "araba" to listOf(
            "araba*", "otomobil*", "oto", "araç", "otopark*", "tüvtürk*", "egzoz*", "lastik*", "lastiğ*",
            "benzin*", "mazot*", "yakıt*", "kaporta*", "ehliyet*", "kasko*", "plaka",
        ),
        "banka" to listOf(
            "banka*", "atm", "kredi*", "kart", "havale*", "eft", "iban", "maaş", "borç", "faiz*", "döviz*", "dekont*",
        ),
        "dis" to listOf("diş", "dişçi*", "ortodont*", "implant*"),
        "dogum_gunu" to listOf("doğum gün*", "yaş gün*", "doğumgün*", "yaşgün*", "yıldönüm*", "pasta"),
        "doktor" to listOf(
            "doktor*", "dr", "hastane*", "hekim*", "klinik*", "poliklinik*", "muayene*", "tahlil*", "aşı",
            "röntgen*", "mr", "psikolog*", "terapi*", "tedavi*",
        ),
        "ev" to listOf("ev", "taşın*", "anahtar*"),
        "fatura" to listOf(
            "fatura*", "kira", "aidat*", "ödeme*", "elektrik*", "doğalgaz*", "doğal gaz*", "vergi*", "taksit*",
            "sigorta*", "harç", "abonelik*",
        ),
        "ilac" to listOf("ilaç*", "eczane*", "vitamin*", "reçete*", "hap", "şurup*", "antibiyotik*", "takviye*"),
        "is" to listOf("iş", "işyeri*", "mesai*", "vardiya*", "ofis*", "büro", "rapor*", "imza*"),
        "kahve" to listOf("kahve*", "kahvaltı*", "çay", "kafe*", "cafe*"),
        "kargo" to listOf("kargo*", "paket*", "koli", "hediye*", "teslimat*", "sipariş*", "iade*", "kurye*"),
        "kitap" to listOf("kitap*", "kitab*", "kütüphane*", "roman", "dergi*", "okuma*"),
        "market" to listOf(
            "market*", "alışveriş*", "bakkal*", "pazar+", "manav*", "ekmek", "ekmeğ", "süt", "yumurta*", "sebze*",
            "meyve*", "erzak*", "migros*", "bim", "a101", "carrefour*",
        ),
        "okul" to listOf(
            "okul*", "ders", "dershane*", "dersane*", "sınav*", "ödev", "üniversite*", "kampüs*", "kurs",
            "kırtasiye*", "lise", "fakülte*", "tez",
        ),
        "sac" to listOf("saç", "kuaför*", "berber*", "sakal", "tıraş*", "traş*", "manikür*", "pedikür*", "röfle*"),
        "seyahat" to listOf(
            "seyahat*", "gezi*", "tatil*", "uçak*", "uçağ*", "uçuş*", "bilet*", "otel", "valiz*", "bavul*",
            "pasaport*", "havalimanı*", "havaalanı*", "otobüs*", "tren", "gar", "feribot*", "yolculuk*",
            "rezervasyon*", "taksi", "plaj*",
        ),
        "spor" to listOf(
            "spor*", "gym", "fitness*", "antrenman*", "idman*", "koşu", "yürüyüş*", "yüzme*", "havuz", "pilates*",
            "yoga", "maç", "futbol*", "basketbol*", "voleybol*", "tenis*", "bisiklet*", "halısaha*", "halı saha*",
            "egzersiz*", "maraton*",
        ),
        "telefon" to listOf("telefon*", "mesaj*", "şarj", "operatör*", "turkcell*", "vodafone*", "görüntülü*"),
        "temizlik" to listOf("temiz*", "süpür*", "toz", "bulaşık*", "paspas*", "çöp", "halı", "banyo*"),
        "toplanti" to listOf(
            "toplantı*", "görüşme*", "zoom", "teams", "sunum*", "mülakat*", "seminer*", "konferans*", "webinar*",
        ),
        "yemek" to listOf(
            "yemek*", "yemeğ*", "restoran*", "lokanta*", "tarif*", "pişir*", "mutfak*", "makarna*", "pizza*",
            "çorba*", "brunch", "kek", "mangal*",
        ),
        "kamp" to listOf("kamp", "kamping*", "çadır*", "doğa", "piknik*", "pikniğ*", "orman*", "dağ", "trekking*", "karavan*"),
        "evcil" to listOf(
            "evcil*", "kedi", "köpek", "köpeğ", "veteriner*", "mama", "kuş", "tasma*", "hamster*", "papağan*",
            "akvaryum*",
        ),
        "bitki" to listOf(
            "bitki*", "çiçek", "çiçeğ", "çiçekçi*", "saksı*", "fide", "fidan*", "bahçe*", "gübre*", "ağaç", "sula",
            "orkide*",
        ),
        "tamir" to listOf(
            "tamir*", "tadilat*", "onar*", "usta", "tesisat*", "musluk*", "musluğ*", "arıza*", "kombi", "elektrikçi*",
            "çilingir*", "hırdavat*", "montaj*", "kurulum*",
        ),
        "camasir" to listOf(
            "çamaşır*", "ütü*", "deterjan*", "yumuşatıcı*", "çarşaf*", "nevresim*", "kuru temizle*",
        ),
        "eglence" to listOf(
            "eğlence*", "sinema*", "film", "konser*", "tiyatro*", "parti", "oyun", "festival*", "gösteri*", "dizi",
            "müze*", "sergi*", "davet*", "düğün", "kına", "kutlama*", "bowling*", "lunapark*", "buluşma*",
            "belgesel*",
        ),
        "mektup" to listOf(
            "mektup*", "mektub*", "posta*", "eposta*", "mail", "email", "zarf*", "kartpostal*", "pul", "ptt",
            "noter*", "dilekçe*", "evrak*", "tebligat*", "başvuru*", "belge*",
        ),
    )

    /** Sözcüğün başında olsa da o anahtarı getirmeyen sözcükler (tam kipte ekle karışanlar). */
    private val HARIC: Map<String, List<String>> = mapOf(
        "iş" to listOf("isim", "ism", "ise"), // "isim", "ismi", düz yazılmış "ise" (bağlaç)
        "maç" to listOf("macun", "macer"),
        "doğa" to listOf("doğan"), // ad: "Doğan'ı ara"
        "taksi" to listOf("taksim"),
        "süt" to listOf("sütun"),
        "kombi" to listOf("kombine"),
        "dizi" to listOf("dizim", "dizin"), // "Dizim ağrıyor": diz (dizi+m de olabilir ama ajandada diz çoktur)
        "tarif" to listOf("tarife"), // "Telefon tarifesi"
        "konser" to listOf("konserve"),
    )

    /** Anahtar -> anahtar sözcükleri (işaretsiz, okunur biçim). Belge ve asistan aracı açıklaması için. */
    val SOZCUKLER: Map<String, List<String>> =
        HAM.mapValues { (_, liste) -> liste.map { it.trimEnd('*', '+') } }

    fun oner(baslik: String): String? {
        val kesmeler = ArrayList<Int>(8)
        val sozcukler = parcala(baslik, kesmeler)
        var enIyi: Kelime? = null
        var enIyiYer = -1
        for (i in sozcukler.indices) {
            val aday = dizin[katla(sozcukler[i][0])] ?: continue
            for (k in aday) {
                if (!eslesir(sozcukler, kesmeler, i, k)) continue
                val e = enIyi
                val daha = when {
                    e == null -> true
                    k.guclu != e.guclu -> k.guclu
                    // Sözcükler sırayla tarandığı için burada i >= enIyiYer.
                    i == enIyiYer -> k.uzunluk > e.uzunluk
                    else -> false
                }
                if (daha) {
                    enIyi = k
                    enIyiYer = i
                }
            }
        }
        return enIyi?.anahtar
    }

    // --- iç ---

    private class Kelime(
        val anahtar: String,
        val parcalar: List<String>,
        val onek: Boolean,
        val yalinOlmaz: Boolean,
        val haric: List<String>,
    ) {
        val guclu = anahtar !in ZAYIF
        val uzunluk = parcalar.sumOf { it.length }
    }

    /** Büyük `I`: Türkçede `ı`dır ama Türkçe olmayan klavyede `i` olabilir; ikisiyle de eşleşir. */
    private const val BUYUK_I = ''

    private val dizin: Map<Char, List<Kelime>> = HAM.flatMap { (anahtar, liste) ->
        liste.map { ham ->
            val onek = ham.endsWith('*')
            val yalinOlmaz = ham.endsWith('+')
            val sade = ham.trimEnd('*', '+')
            Kelime(anahtar, sade.split(' '), onek, yalinOlmaz, HARIC[sade].orEmpty())
        }
    }.groupBy { katla(it.parcalar[0][0]) }

    /**
     * Tam kipte sözcükten sonra gelebilecek ad çekim ekleri (Türkçe harfler düzleştirilmiş hâlde):
     * çoğul? + iyelik? + hâl?. Örnek: -ı, -yı, -e, -ye, -de, -den, -deki, -in, -nin, -si, -leri, -imiz, -le.
     */
    private val EK = Regex(
        "^(?:l[ae]r)?" +
            "(?:[iu]?m[iu]z|[iu]?n[iu]z|[iu]?m|[iu]?n|s[iu]|[iu]|l[ae]r[iu])?" +
            "(?:y?[aeiu]|n?[dt][ae](?:n|ki)?|n?[iu]n|n[aeiu]|y?l[ae]|ki)?$",
    )

    private const val UNLU = "aeiou"
    private const val KALIN = "aıou"
    private const val INCE = "eiöü"

    /** [kesme]: sözcük başına kesme işaretinden önceki harf sayısı (kesme yoksa -1). */
    private fun eslesir(s: List<String>, kesme: List<Int>, i: Int, k: Kelime): Boolean {
        val n = k.parcalar.size
        if (i + n > s.size) return false
        for (j in 0 until n - 1) {
            val t = s[i + j]
            val p = k.parcalar[j]
            if (t.length != p.length || !basiUyar(t, p)) return false
        }
        val t = s[i + n - 1]
        val p = k.parcalar[n - 1]
        if (!basiUyar(t, p)) return false
        if (k.haric.any { basiUyar(t, it) }) return false
        if (k.onek) return true
        val kes = kesme[i + n - 1]
        // Kesmeden önceki kök sözcüğün kendisi olmalı: "Asım'ı" aşı+mı değil, "Romanya'ya" roman+ya değil.
        if (kes >= 0 && kes != p.length) return false
        if (t.length == p.length) return !k.yalinOlmaz
        val ek = katla(t.substring(p.length))
        val unluyleBiter = katla(p.last()) in UNLU
        // Ünsüzle biten köke m/n/s ile başlayan ek doğrudan gelmez ("saçma" saç+ma değildir; doğrusu "saçıma").
        if (!unluyleBiter && ek[0] in "mns") return false
        if (kes < 0) {
            // Kesmesiz ekte: düz yazılmış ı ("Halim", "Halime" halı değil), kaynaştırma y'si yalnız ünlüden sonra
            // ("romanya"), ünlü uyumu ("Asiye" aşı+ye değil). Kesmeli ekte ("PTT'ye", "ATM'ye") bunlar aranmaz:
            // kısaltma okunuşuna göre ek alır.
            if (duzI(t, p)) return false
            if (ek[0] == 'y' && !unluyleBiter) return false
            if (!uyumlu(p, ek)) return false
        }
        return EK.matches(ek)
    }

    /** Sözcükteki `ı` başlıkta düz `i` yazılmış mı (büyük `I` belirsizdir, sayılmaz). */
    private fun duzI(t: String, p: String): Boolean {
        for (x in p.indices) if (p[x] == 'ı' && t[x] == 'i') return true
        return false
    }

    /**
     * Ekin ünlüleri kökün son ünlüsüne uyuyor mu (yalnız a/e ayrımı: düz yazımda ı/i ve ö/o seçilemez).
     * Ünlüsüz kök (kısaltma: "dr", "ptt") her eki alır.
     */
    private fun uyumlu(p: String, ek: String): Boolean {
        for (x in p.indices.reversed()) {
            val c = p[x]
            if (c in KALIN) return 'e' !in ek
            if (c in INCE) return 'a' !in ek
        }
        return true
    }

    /** `t` sözcüğü `p` ile başlıyor mu (başlıkta Türkçe harf düz yazılmış olabilir, tersi olamaz). */
    private fun basiUyar(t: String, p: String): Boolean {
        if (t.length < p.length) return false
        for (x in p.indices) if (!harfUyar(t[x], p[x])) return false
        return true
    }

    private fun harfUyar(t: Char, k: Char): Boolean =
        t == k || t == katla(k) || (t == BUYUK_I && (k == 'i' || k == 'ı'))

    private fun katla(c: Char): Char = when (c) {
        'ç' -> 'c'
        'ğ' -> 'g'
        'ı', BUYUK_I -> 'i'
        'ö' -> 'o'
        'ş' -> 's'
        'ü' -> 'u'
        else -> c
    }

    private fun katla(s: String): String {
        val b = CharArray(s.length)
        for (x in s.indices) b[x] = katla(s[x])
        return String(b)
    }

    /**
     * Türkçe küçük harfe çevirip harf/rakam dizilerine böler; kesme işareti sözcüğü bölmez ("kargo'yu") ama yeri
     * [kesmeler]'e yazılır (sözcük başına ilk kesmeden önceki harf sayısı, yoksa -1).
     */
    private fun parcala(baslik: String, kesmeler: MutableList<Int>): List<String> {
        val sonuc = ArrayList<String>(8)
        val b = StringBuilder()
        var kesme = -1
        for (c in baslik) {
            val h = when (c) {
                'I' -> BUYUK_I
                'İ' -> 'i'
                'â', 'Â' -> 'a'
                'î', 'Î' -> 'i'
                'û', 'Û' -> 'u'
                else -> c.lowercaseChar()
            }
            when {
                h == BUYUK_I || h.isLetterOrDigit() -> b.append(h)
                h == '̇' -> Unit
                h == '\'' || h == '’' || h == '‘' || h == '`' -> if (kesme < 0 && b.isNotEmpty()) kesme = b.length
                b.isNotEmpty() -> {
                    sonuc.add(b.toString())
                    kesmeler.add(kesme)
                    b.setLength(0)
                    kesme = -1
                }
                else -> kesme = -1
            }
        }
        if (b.isNotEmpty()) {
            sonuc.add(b.toString())
            kesmeler.add(kesme)
        }
        return sonuc
    }
}
