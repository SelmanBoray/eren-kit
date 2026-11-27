package dev.eren.ajanda.ekran.sahne.cizim

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class CizimOnerisiTest {
    private val tr = Locale.forLanguageTag("tr")

    private fun hepsi(anahtar: String?, vararg basliklar: String) {
        for (b in basliklar) assertEquals("\"$b\"", anahtar, CizimOnerisi.oner(b))
    }

    private fun duzlestir(s: String) = s.map {
        when (it) {
            'ç' -> 'c'; 'ğ' -> 'g'; 'ı' -> 'i'; 'ö' -> 'o'; 'ş' -> 's'; 'ü' -> 'u'; else -> it
        }
    }.joinToString("")

    // --- sözleşme ---

    @Test fun anahtarKumesiSozlesmedekiYirmiDokuz() {
        val beklenen = setOf(
            "genel", "araba", "banka", "dis", "dogum_gunu", "doktor", "ev", "fatura", "ilac", "is",
            "kahve", "kargo", "kitap", "market", "okul", "sac", "seyahat", "spor", "telefon", "temizlik",
            "toplanti", "yemek", "kamp", "evcil", "bitki", "tamir", "camasir", "eglence", "mektup",
        )
        assertEquals(29, CizimOnerisi.ANAHTARLAR.size)
        assertEquals(beklenen, CizimOnerisi.ANAHTARLAR.toSet())
        val bicim = Regex("^[a-z][a-z0-9_]{0,31}$")
        CizimOnerisi.ANAHTARLAR.forEach { assertTrue(it, bicim.matches(it)) }
        assertEquals("genel", CizimOnerisi.GENEL)
    }

    @Test fun tablodakiHerAnahtarKumede() {
        assertTrue(CizimOnerisi.SOZCUKLER.keys.all { it in CizimOnerisi.ANAHTARLAR })
        assertTrue(CizimOnerisi.ZAYIF.all { it in CizimOnerisi.ANAHTARLAR })
    }

    @Test fun genelDisindakiHerAnahtarinSozcuguVarGenelinYok() {
        assertEquals(CizimOnerisi.ANAHTARLAR.toSet() - "genel", CizimOnerisi.SOZCUKLER.keys)
        CizimOnerisi.SOZCUKLER.forEach { (k, v) -> assertTrue(k, v.isNotEmpty()) }
    }

    @Test fun birSozcukIkiAnahtardaYok() {
        val tum = CizimOnerisi.SOZCUKLER.values.flatten()
        assertEquals(tum.groupBy { it }.filterValues { it.size > 1 }.keys.toString(), tum.size, tum.toSet().size)
    }

    // --- tablonun kendisi: her sözcük yalnız, düz yazılmış ve büyük harfle kendi anahtarını getirir ---

    private fun ornek(s: String) = if (s == "pazar") "pazara" else s

    @Test fun herSozcukKendiAnahtariniGetirir() {
        CizimOnerisi.SOZCUKLER.forEach { (k, liste) -> liste.forEach { hepsi(k, ornek(it)) } }
    }

    @Test fun herSozcukTurkceHarfsizYazilincaDaGelir() {
        CizimOnerisi.SOZCUKLER.forEach { (k, liste) -> liste.forEach { hepsi(k, duzlestir(ornek(it))) } }
    }

    @Test fun herSozcukTurkceBuyukHarfleDeGelir() {
        CizimOnerisi.SOZCUKLER.forEach { (k, liste) -> liste.forEach { hepsi(k, ornek(it).uppercase(tr)) } }
    }

    // --- her anahtar için cümle içinde olumlu örnekler ---

    @Test fun araba() = hepsi("araba", "Arabayı yıkat", "Arabanın lastiklerini değiştir", "Oto yıkamaya git",
        "Lastiği şişir", "Aracı TÜVTÜRK'e götür", "Benzin al", "Ehliyet yenile", "Kasko yenile")

    @Test fun banka() = hepsi("banka", "Bankaya git", "ATM'den para çek", "Kredi kartı borcunu öde",
        "Ahmet'e havale yap", "IBAN'ı gönder", "Maaşı kontrol et")

    @Test fun dis() = hepsi("dis", "Dişçiye git", "Diş hekimi randevusu", "dis hekimi", "Dişlerimi fırçala",
        "Ortodontist kontrolü")

    @Test fun dogumGunu() = hepsi("dogum_gunu", "Annemin doğum günü", "Ali'nin doğum gününe hediye al",
        "Yaş günü pastası", "dogum gunu", "Evlilik yıldönümü")

    @Test fun doktor() = hepsi("doktor", "Doktora git", "Hastaneye uğra", "Kan tahlili", "Grip aşısı",
        "Dr. Yılmaz randevu", "Psikolog seansı", "Göz muayenesi")

    @Test fun ev() = hepsi("ev", "Eve erken dön", "Evde misafir var", "Yeni eve taşınma", "Anahtarı çoğalt")

    @Test fun fatura() = hepsi("fatura", "Faturayı öde", "Kirayı yatır", "Aidat ödemesi", "Elektrik faturası",
        "Doğal gaz", "dogalgaz", "Vergi borcu", "Telefon faturası", "Su faturasının son günü")

    @Test fun ilac() = hepsi("ilac", "İlaç al", "ilacımı iç", "Eczaneye uğra", "Vitamin al", "Reçeteyi yazdır",
        "ILAÇ")

    @Test fun isAnahtari() = hepsi("is", "İşe git", "işten çık", "Mesai bitince ara", "Gece vardiyası",
        "Ofise uğra", "Raporu bitir", "Sözleşmeyi imzala")

    @Test fun kahve() = hepsi("kahve", "Kahve iç", "Ayşe ile kahvaltı", "Çay demle", "cay al", "Kafede buluşma")

    @Test fun kargo() = hepsi("kargo", "Kargoyu al", "kargo'yu teslim et", "Paketi gönder", "Koliyi kapat",
        "Siparişi iade et", "Hediye paketi")

    @Test fun kitap() = hepsi("kitap", "Kitap oku", "Kitabı iade et", "Kütüphaneye git", "Romanı bitir",
        "Dergi al")

    @Test fun market() = hepsi("market", "Markete git", "Marketten süt al", "Alışveriş listesi", "alisveris yap",
        "Bakkaldan ekmek", "Pazara git", "Pazardan meyve al", "Ekmeği unutma", "Yumurta al")

    @Test fun okul() = hepsi("okul", "Okula git", "Ders çalış", "Matematik sınavı", "Ödevi teslim et",
        "Üniversite kaydı", "Kırtasiyeden defter")

    @Test fun sac() = hepsi("sac", "Saç kestir", "sac kestir", "Kuaföre git", "Berbere uğra", "Sakal tıraşı",
        "Saçımı boyat")

    @Test fun seyahat() = hepsi("seyahat", "İzmir seyahati", "Tatil planı", "Uçak bileti al", "Uçağa bin",
        "Otel rezervasyonu", "Valizi hazırla", "Pasaportu yenile", "Havalimanına git", "Trene bin")

    @Test fun spor() = hepsi("spor", "Spora git", "Sabah koşusu", "Akşam yürüyüşü", "Yüzmeye git", "Pilates dersi",
        "Maç izle", "Bisiklet sür", "Halı saha maçı", "Halısaha")

    @Test fun telefon() = hepsi("telefon", "Annemi telefonla ara", "Telefonu şarj et", "Mesajlara bak",
        "Görüntülü arama")

    @Test fun temizlik() = hepsi("temizlik", "Evi temizle", "Ev temizliği", "Bulaşıkları yıka", "Toz al",
        "Çöpü çıkar", "Halıyı süpür", "Banyoyu ov")

    @Test fun toplanti() = hepsi("toplanti", "Toplantıya katıl", "toplanti 15:00", "Müşteri görüşmesi",
        "Zoom'a gir", "Sunumu hazırla", "İş yerinde toplantı", "Okul toplantısı")

    @Test fun yemek() = hepsi("yemek", "Akşam yemeği", "Yemek yap", "Restoranda rezervasyon", "Tarifi dene",
        "Makarna pişir", "Çorba yap")

    @Test fun kamp() = hepsi("kamp", "Kamp malzemesi", "Kampa git", "Çadırı kur", "Doğa yürüyüşü", "Pikniğe git",
        "Dağa tırman")

    @Test fun evcil() = hepsi("evcil", "Kediyi besle", "Köpeği gezdir", "Köpeğe mama al", "Veterinere götür",
        "Kuşun yemini al", "Evcil hayvan aşısı")

    @Test fun bitki() = hepsi("bitki", "Çiçekleri sula", "Bitkilere bak", "Saksı al", "Bahçeyi düzenle",
        "Ağacı buda", "cicekleri sula")

    @Test fun tamir() = hepsi("tamir", "Musluğu tamir ettir", "Ustayı ara", "Kombi bakımı", "Tesisatçı çağır",
        "Elektrikçi çağır", "Arızayı bildir", "Çilingir")

    @Test fun camasir() = hepsi("camasir", "Çamaşırları yıka", "camasir as", "Gömlekleri ütüle", "Ütü yap",
        "Kuru temizlemeden al", "Çarşafları değiştir")

    @Test fun eglence() = hepsi("eglence", "Sinemaya git", "Film izle", "Konser bileti", "Tiyatro", "Parti hazırlığı",
        "Düğüne git", "Müzeyi gez", "Belgesel izle")

    @Test fun mektup() = hepsi("mektup", "Mektup yaz", "Postaneye uğra", "PTT'ye git", "E-posta gönder",
        "Maile cevap ver", "Dilekçe ver", "Evrakları topla", "Kartpostal gönder")

    // --- prototipin bilinen yanlışları: sözcük içinde arama yok ---

    @Test fun sozcukIcindeAramaYok() {
        hepsi(null, "Vesikalık fotoğraf çektir", "Pazartesi annemi ara", "Pazar günü annemi ara",
            "Fotokopi çek", "Otomatik kapı")
    }

    // --- tuzaklar ---

    @Test fun kiraVeKiraz() {
        hepsi("fatura", "Kira", "Kirayı öde", "Ev kirası", "kiralar")
        hepsi(null, "Kiraz al", "kirazları yıka")
    }

    @Test fun evVeEvrakEvet() {
        hepsi("mektup", "Evrakları imzalat")
        hepsi(null, "Evet de", "Evlenme teklifi", "Evren'i ara", "Evvelsi gün")
        hepsi("evcil", "Evcil hayvan")
    }

    @Test fun isVeIsim() {
        hepsi(null, "İsim listesi", "isim yaz", "İsmini sor", "ISIM", "gelirse ise")
        hepsi("is", "İşim var", "İşimi bitir", "is cikisi")
    }

    @Test fun kampVeKampanya() {
        hepsi(null, "Kampanyaya bak", "kampanya kodu")
        hepsi("okul", "Kampüse git")
        hepsi("kamp", "Kampa git", "kamping")
    }

    @Test fun sacVeSacma() {
        hepsi(null, "Saçma sapan şey", "sacma")
        hepsi("sac", "sac", "SAÇ", "Saçları kestir")
    }

    @Test fun disVeDis() {
        hepsi(null, "Dış kapıyı boya", "dışarı çık", "Dışişleri")
        hepsi("dis", "diş", "dis", "Dişçi", "disci", "Dişçiye", "DİŞ")
    }

    @Test fun ekliBicimler() {
        hepsi("dis", "dişçiye", "dişçiden")
        hepsi("market", "markete", "marketten", "marketteki")
        hepsi("fatura", "faturayı", "faturasını", "faturaların")
        hepsi("ev", "evimize", "evdeki", "evlerine")
        hepsi("ilac", "ilacı", "ilaçlarını")
    }

    @Test fun baskaTuzaklar() {
        hepsi(null, "Doğan'ı ara", "Taksim'e uğra", "Sütun ölç", "Hata ayıkla",
            "Koşulları oku", "Saçak", "Ödenek", "Aşırı yorgun", "Macun al",
            "Otomasyon kur", "Diskoya git", "Trend ölç", "Garson", "Kartal")
        hepsi("seyahat", "Otobüs bileti", "Taksiye bin")
        hepsi("banka", "ATM'ye uğra")
        hepsi(null, "Saçsız", "Dişsiz")
    }

    // --- öncelik ---

    @Test fun oncelikIlkGecenKazanir() {
        hepsi("doktor", "Doktora git, ilaç al")
        hepsi("ilac", "İlaç al, doktora git")
        hepsi("araba", "Araba tamiri")
        hepsi("dogum_gunu", "Doğum günü kartı")
    }

    @Test fun oncelikZayifBaglamAnahtarlariYerVerir() {
        hepsi("toplanti", "iş yerinde toplantı", "Ofiste sunum")
        hepsi("temizlik", "Ev temizliği")
        hepsi("fatura", "Ev kirası", "Telefon faturası")
        hepsi("tamir", "Telefonu tamir ettir")
        hepsi("toplanti", "Okul toplantısı")
        hepsi("is", "İş yeri")
    }

    @Test fun oncelikAyniYerdeUzunEslesme() {
        hepsi("tamir", "Elektrikçi")
        hepsi("fatura", "Elektrik")
        hepsi("spor", "Halı saha")
        hepsi("temizlik", "Halı yıkat")
        hepsi("camasir", "Kuru temizleme")
        hepsi("eglence", "Belgesel")
        hepsi("mektup", "Belge")
    }

    // --- büyük/küçük harf ve Türkçe karakter ---

    @Test fun buyukKucukHarf() {
        hepsi("araba", "ARABAYI YIKAT", "arabayı yıkat", "ArAbA")
        hepsi("is", "İŞE GİT")
        hepsi("toplanti", "TOPLANTI", "TOPLANTIYA KATIL")
        hepsi("ilac", "ILAC", "İLAÇ")
        hepsi("okul", "SINAV")
        hepsi("kahve", "KAHVALTI")
    }

    @Test fun turkceKarakterSizYazim() {
        hepsi("dis", "dis hekimi", "disciye git")
        hepsi("sac", "sac kestir", "kuafore git")
        hepsi("toplanti", "toplantiya katil")
        hepsi("camasir", "camasirlari yika")
        hepsi("evcil", "kopegi gezdir", "kopek mamasi")
        hepsi("market", "alisveris")
        hepsi("seyahat", "ucak bileti")
    }

    @Test fun ekkisiTersineGecmez() {
        // Başlıkta Türkçe harf varsa sözcükte de olmalı: "dış" diş değildir, "saç" sözcüğü "sac" yazımıyla gelir ama tersi değil.
        hepsi(null, "dış")
        hepsi("sac", "sac")
    }

    @Test fun bosVeEslesmeyen() {
        hepsi(null, "", "   ", "...", "Bugün", "Annemi ara", "x", "123")
    }

    @Test fun noktalamaVeKesme() {
        hepsi("kargo", "(kargo)", "kargo!", "Kargo’yu al")
        hepsi("market", "süt,ekmek,yumurta")
    }

    @Test fun hizli() {
        val basliklar = listOf("Arabayı yıkat", "Doktora git, ilaç al", "Pazartesi toplantı hazırlığı ve sunum",
            "Vesikalık fotoğraf çektir", "çok uzun ama hiçbir şeyle eşleşmeyen bir başlık yazıyorum şimdi")
        repeat(2_000) { basliklar.forEach { CizimOnerisi.oner(it) } } // ısınma
        val bas = System.nanoTime()
        val n = 20_000
        repeat(n) { basliklar.forEach { CizimOnerisi.oner(it) } }
        val ortMikro = (System.nanoTime() - bas) / 1_000.0 / (n * basliklar.size)
        assertTrue("çağrı başına $ortMikro µs", ortMikro < 200.0)
    }
}
