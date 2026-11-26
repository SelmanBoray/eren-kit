package dev.eren.ajanda.ekran

import dev.eren.ajanda.cekirdek.AjandaKaydi
import dev.eren.ajanda.cekirdek.AjandaZamani
import dev.eren.ajanda.cekirdek.CekirdekHatasi
import dev.eren.ajanda.cekirdek.GunBolumu
import dev.eren.ajanda.cekirdek.Hatirlatma
import dev.eren.ajanda.cekirdek.HatirlatmaOnizlemesi
import dev.eren.ajanda.cekirdek.KayitGovdesi
import dev.eren.ajanda.cekirdek.KayitTuru
import dev.eren.ajanda.cekirdek.Tekrar
import java.time.LocalDate
import java.time.LocalTime

/** Formun bir alanı (sorun mesajı o alanın altında gösterilir). */
enum class FormAlani { TUR, BASLIK, ACIKLAMA, ZAMAN, DILIM, HATIRLATMA, TEKRAR, GENEL }

data class FormSorunu(val alan: FormAlani, val mesaj: String)

/**
 * Elle ekleme/düzenleme formunun durumu (saf). Zaman düzenlenmediyse kaydın özgün zamanı (kullanıcının
 * sözü `ifade`, dönem, belirsiz, süre) aynen korunur; düzenlenince tarih + isteğe bağlı saatten yeniden
 * kurulur ve `ifade` düşer (artık kullanıcının sözünü anlatmaz). Tekrar arayüzü yok: varsa korunur.
 *
 * Gün bölümü (v2, `GunBolumu`): saat seçilmemiş günlü kayıtta isteğe bağlıdır; kayıt yine saatsizdir,
 * bölüm yalnız gün hatırlatmasının saatini ve listedeki etiketi belirler. Saat seçilince bölüm kalkar.
 */
data class KayitFormu(
    val tur: KayitTuru = KayitTuru.GOREV,
    val baslik: String = "",
    val aciklama: String = "",
    val tarih: LocalDate? = null,
    val saat: LocalTime? = null,
    val hatirlatmalar: List<Hatirlatma> = emptyList(),
    /** Yeni zamanın dilimi: yeni kayıtta cihazınki, düzenlemede kaydınki. */
    val dilim: String = "",
    val ozgunZaman: AjandaZamani? = null,
    val zamanDegisti: Boolean = false,
    val tekrar: Tekrar? = null,
    /** Saatsiz günde kullanıcının seçtiği gün bölümü (v2); saat varken ya da tarih yokken null. */
    val gunBolumu: GunBolumu? = null,
) {
    /** Formun gösterdiği zaman (özgün korunuyorsa o). */
    val zaman: AjandaZamani?
        get() {
            if (!zamanDegisti && ozgunZaman != null) return ozgunZaman
            val t = tarih ?: return null
            val s = saat ?: return AjandaZamani.Gun(t.toString(), gunBolumu, dilim, null)
            val sure = (ozgunZaman as? AjandaZamani.An)?.sureDk
            return AjandaZamani.An(t.toString(), EkranMetinleri.saat(s), sure, dilim, null)
        }

    fun govde(): KayitGovdesi = KayitGovdesi(
        tur = tur,
        baslik = baslik,
        aciklama = aciklama.ifBlank { null },
        zaman = zaman,
        hatirlatmalar = hatirlatmalar,
        tekrar = tekrar,
    )

    fun tarihVer(t: LocalDate?): KayitFormu =
        copy(tarih = t, saat = if (t == null) null else saat, gunBolumu = if (t == null) null else gunBolumu, zamanDegisti = true)

    /** Saat seçilince gün bölümü kalkar (saat bölümün yerine geçer); saat kalkınca bölüm seçilebilir. */
    fun saatVer(s: LocalTime?): KayitFormu = copy(saat = s, gunBolumu = if (s != null) null else gunBolumu, zamanDegisti = true)

    /** Gün bölümü seçimi (aynısına yeniden dokunmak kaldırır). Yalnız tarihli ve saatsiz formda anlamlıdır. */
    fun bolumVer(b: GunBolumu?): KayitFormu =
        if (tarih == null || saat != null) this else copy(gunBolumu = if (b == gunBolumu) null else b, zamanDegisti = true)

    /** Gün bölümü seçimi gösterilir mi: gün seçilmiş, saat seçilmemiş. */
    val bolumSecilebilir: Boolean
        get() = zaman is AjandaZamani.Gun

    fun hatirlatmaDegistir(h: Hatirlatma): KayitFormu =
        copy(hatirlatmalar = if (h in hatirlatmalar) hatirlatmalar - h else hatirlatmalar + h)

    /**
     * "Önce" hatırlatması bekler (çalmaz): zaman yok, belirsiz ya da dönem. Saatsiz günde beklemez (v2):
     * o günün gün hatırlatması saatinde çalar.
     */
    val hatirlatmaBekler: Boolean
        get() = (zaman == null || zaman is AjandaZamani.Belirsiz || zaman is AjandaZamani.Donem) &&
            hatirlatmalar.any { it is Hatirlatma.Once }

    companion object {
        const val BASLIK_SINIRI = 200
        const val ACIKLAMA_SINIRI = 4000
        const val HATIRLATMA_SINIRI = 8

        /** Hatırlatma seçeneklerinde hep görünenler (dakika). */
        val HAZIR_ONCELER = listOf(0, 10, 60, 1440)

        /**
         * Saatsiz günde hazır seçenekler: dakika öne alış saat olmadığı için aynı güne düşer (sözleşme), bu
         * yüzden yalnız "o gün" (60: varsayılanla aynı) ve "1 gün önce" sunulur.
         */
        val SAATSIZ_HAZIR_ONCELER = listOf(60, 1440)

        /** Yeni kayıt: varsayılan hatırlatmalar çekirdekten (`varsayilanHatirlatmalar`). */
        fun yeni(tur: KayitTuru, tarih: LocalDate?, dilim: String, varsayilan: List<Hatirlatma>) =
            KayitFormu(tur = tur, tarih = tarih, hatirlatmalar = varsayilan, dilim = dilim, zamanDegisti = true)

        /** Var olan kaydın ya da ret girdisinin gövdesinden form. */
        fun govdeden(g: KayitGovdesi, cihazDilimi: String): KayitFormu {
            val z = g.zaman
            val (tarih, saat) = when (z) {
                is AjandaZamani.An -> runCatching { LocalDate.parse(z.tarih) }.getOrNull() to
                    runCatching { LocalTime.parse(z.saat) }.getOrNull()
                is AjandaZamani.Gun -> runCatching { LocalDate.parse(z.tarih) }.getOrNull() to null
                is AjandaZamani.Donem -> runCatching { LocalDate.parse(z.baslangic) }.getOrNull() to null
                is AjandaZamani.Belirsiz, null -> null to null
            }
            val dilim = when (z) {
                is AjandaZamani.An -> z.saatDilimi
                is AjandaZamani.Gun -> z.saatDilimi
                is AjandaZamani.Donem -> z.saatDilimi
                else -> cihazDilimi
            }
            return KayitFormu(
                tur = g.tur,
                baslik = g.baslik,
                aciklama = g.aciklama ?: "",
                tarih = tarih,
                saat = saat,
                hatirlatmalar = g.hatirlatmalar,
                dilim = dilim,
                ozgunZaman = z,
                zamanDegisti = false,
                tekrar = g.tekrar,
                gunBolumu = (z as? AjandaZamani.Gun)?.gunBolumu,
            )
        }

        fun kayittan(k: AjandaKaydi, cihazDilimi: String) = govdeden(
            KayitGovdesi(k.tur, k.baslik, k.aciklama, k.zaman, k.hatirlatmalar, k.tekrar), cihazDilimi,
        )

        /** Hatırlatma seçenekleri: hazır olanlar + formda olup hazır olmayanlar (mutlak dahil), sırayla. */
        fun hatirlatmaSecenekleri(f: KayitFormu): List<Hatirlatma> {
            val hazir = (if (f.zaman is AjandaZamani.Gun) SAATSIZ_HAZIR_ONCELER else HAZIR_ONCELER).map { Hatirlatma.Once(it) }
            val ek = f.hatirlatmalar.filter { it !in hazir }
            return hazir + ek
        }

        /**
         * Çekirdeğe gitmeden görülebilen sorunlar (anında gösterilir). Son söz çekirdeğindir
         * (`govdeyiHazirla`); onun sorunu [cekirdekSorunu] ile çevrilir. Uzunluk UTF-16 birimidir
         * (Kotlin `String.length` ile aynı); kenar boşlukları çekirdek kırptığı için sayılmaz.
         */
        fun onDenetim(f: KayitFormu): List<FormSorunu> = buildList {
            val b = f.baslik.trim()
            if (b.isEmpty()) add(FormSorunu(FormAlani.BASLIK, "Başlık boş olamaz."))
            else if (b.length > BASLIK_SINIRI) add(FormSorunu(FormAlani.BASLIK, uzunMesaj("Başlık", BASLIK_SINIRI, b.length)))
            val a = f.aciklama.trim()
            if (a.length > ACIKLAMA_SINIRI) add(FormSorunu(FormAlani.ACIKLAMA, uzunMesaj("Açıklama", ACIKLAMA_SINIRI, a.length)))
            if (f.hatirlatmalar.size > HATIRLATMA_SINIRI) {
                add(FormSorunu(FormAlani.HATIRLATMA, "En çok $HATIRLATMA_SINIRI hatırlatma seçilebilir."))
            }
            if (f.tekrar != null && f.zaman !is AjandaZamani.An && f.zaman !is AjandaZamani.Gun) {
                add(FormSorunu(FormAlani.TEKRAR, "Bu kayıt tekrar ediyor; bir gün seçilmeli."))
            }
        }

        /** Hatırlatma seçeneğinin yongadaki adı: saatsiz günde dakika öne alış "O gün" (aynı güne düşer). */
        fun hatirlatmaAdi(h: Hatirlatma, f: KayitFormu, bugun: LocalDate): String {
            if (f.zaman is AjandaZamani.Gun && h is Hatirlatma.Once) {
                val gun = h.dk / 1440
                return if (gun == 0) "O gün" else EkranMetinleri.onceMetni(gun * 1440)
            }
            return EkranMetinleri.hatirlatma(h, bugun)
        }

        /** Kaydın hatırlatma bakımından hali (form ve ayrıntı): yeni kayıt ve açık kayıt `ETKIN`. */
        enum class Etkinlik { ETKIN, TASLAK, KAPALI }

        /**
         * Hatırlatma notu (saf): hatırlatmanın gerçekte ne zaman çalacağı. [o]: çekirdeğin önizlemesi
         * (`hatirlatmaOnizlemesi`, formun gövdesiyle); gelmediyse null (o zaman yalnız önizlemesiz bilinenler).
         * Saatsiz günde gün hatırlatmasının günü ve saati yazılır: "Cuma 19:00'da hatırlatılır", bölüm yoksa
         * "O gün 09:00'da hatırlatılır (Cuma)"; geçmişte kalıyorsa "bildirim gelmeyecek". Kaydın saati değildir.
         */
        fun hatirlatmaNotu(f: KayitFormu, o: HatirlatmaOnizlemesi?, bugun: LocalDate, etkinlik: Etkinlik = Etkinlik.ETKIN): String? {
            if (f.hatirlatmalar.isEmpty()) return "Hatırlatma kurulmayacak."
            val z = f.zaman
            val yalnizOnce = f.hatirlatmalar.all { it is Hatirlatma.Once }
            if ((z == null || z is AjandaZamani.Belirsiz) && yalnizOnce) {
                return "Tarih yokken hatırlatma bekler; gün seçilince kurulur."
            }
            if (z is AjandaZamani.Donem && yalnizOnce) return "Dönem kaydında hatırlatma bekler; tek gün seçilince kurulur."
            if (etkinlik == Etkinlik.KAPALI) return "Kayıt açık değil; hatırlatma kurulmaz."
            val on = if (etkinlik == Etkinlik.TASLAK) "Taslak onaylanınca: " else ""
            o ?: return null
            val g = o.gunHatirlatmasi
            if (z is AjandaZamani.Gun && g != null) {
                val gun = runCatching { LocalDate.parse(g.tarih) }.getOrNull()
                val gunAdi = gun?.let { EkranMetinleri.hatirlatmaGunu(it, bugun) } ?: g.tarih
                if (g.gecti) {
                    return if (o.kurulacak == 0u) {
                        "Bu kayıt için bildirim gelmeyecek: hatırlatma zamanı ($gunAdi ${g.saat}) geçti."
                    } else {
                        "${on}Gün hatırlatması ($gunAdi ${g.saat}) geçti; öteki hatırlatma kurulacak."
                    }
                }
                val ek = EkranMetinleri.bulunmaEki(g.saat)
                val cumle = if (z.gunBolumu == null && g.tarih == z.tarih) {
                    "O gün ${g.saat}$ek hatırlatılır ($gunAdi)."
                } else {
                    "${gunAdi.replaceFirstChar { it.uppercase() }} ${g.saat}$ek hatırlatılır."
                }
                val dahasi = if (o.kurulacak > 1u) " Toplam ${o.kurulacak} hatırlatma." else ""
                return on + cumle + dahasi
            }
            if (o.kurulacak == 0u && o.gecmis > 0u) return "Bu kayıt için bildirim gelmeyecek: hatırlatma zamanı geçti."
            return null
        }

        private fun uzunMesaj(ad: String, sinir: Int, uzunluk: Int) =
            "$ad çok uzun: en çok $sinir karakter olabilir, şu an $uzunluk."

        /** Çekirdeğin form sorununu (`GecersizGirdi{alan, neden}`) alanına ve Türkçe mesaja çevirir. */
        fun cekirdekSorunu(alan: String, neden: String, f: KayitFormu? = null): FormSorunu {
            val formAlani = when {
                alan == "baslik" -> FormAlani.BASLIK
                alan == "aciklama" -> FormAlani.ACIKLAMA
                alan == "tur" -> FormAlani.TUR
                alan.endsWith("saat_dilimi") && alan.startsWith("zaman") -> FormAlani.DILIM
                alan.startsWith("zaman") -> FormAlani.ZAMAN
                alan.startsWith("hatirlatmalar") -> FormAlani.HATIRLATMA
                alan.startsWith("tekrar") -> FormAlani.TEKRAR
                else -> FormAlani.GENEL
            }
            val ad = when (formAlani) {
                FormAlani.BASLIK -> "Başlık"
                FormAlani.ACIKLAMA -> "Açıklama"
                FormAlani.TUR -> "Tür"
                FormAlani.DILIM -> "Saat dilimi"
                FormAlani.ZAMAN -> if (alan.endsWith("ifade")) "Zaman ifadesi" else "Zaman"
                FormAlani.HATIRLATMA -> "Hatırlatma"
                FormAlani.TEKRAR -> "Tekrar"
                FormAlani.GENEL -> "Kayıt"
            }
            val mesaj = when {
                neden == "çok kısa" || neden == "boş" || neden == "yalnız boşluk" || neden == "zorunlu alan yok" ->
                    "$ad boş olamaz."
                neden.startsWith("çok uzun") -> {
                    val sinir = when (formAlani) {
                        FormAlani.BASLIK -> BASLIK_SINIRI
                        FormAlani.ACIKLAMA -> ACIKLAMA_SINIRI
                        else -> null
                    }
                    val uzunluk = when (formAlani) {
                        FormAlani.BASLIK -> f?.baslik?.trim()?.length
                        FormAlani.ACIKLAMA -> f?.aciklama?.trim()?.length
                        else -> null
                    }
                    if (sinir != null && uzunluk != null) uzunMesaj(ad, sinir, uzunluk) else "$ad çok uzun."
                }
                neden.startsWith("görünmez") -> "$ad görünmeyen bir karakter içeriyor; o kısmı silip yeniden yazın."
                neden.startsWith("satır sonu") -> "$ad tek satır olmalı."
                neden.startsWith("baştaki ya da sondaki") -> "$ad başında ya da sonunda boşluk olmamalı."
                neden == "IANA dilim biçimi değil" -> "Saat dilimi tanınmadı; listeden bir dilim seçin."
                neden.startsWith("takvimde olmayan") -> "Tarih geçersiz (1900-2199 arasında gerçek bir gün olmalı)."
                neden == "saat biçimi değil" -> "Saat geçersiz."
                neden == "yinelenen hatırlatma" -> "Aynı hatırlatma iki kez seçilmiş."
                neden == "dizi çok uzun" && formAlani == FormAlani.HATIRLATMA ->
                    "En çok $HATIRLATMA_SINIRI hatırlatma seçilebilir."
                neden.startsWith("bitis baslangictan") -> "Dönemin bitişi başlangıcından önce ya da dönem bir yıldan uzun."
                neden.startsWith("tekrar zaman") -> "Bu kayıt tekrar ediyor; bir gün seçilmeli."
                neden.startsWith("tekrar bitişi") -> "Tekrarın bitişi başlangıçtan önce."
                neden == "sınır dışı" -> "$ad izin verilen aralığın dışında."
                else -> "$ad kabul edilmedi ($neden)."
            }
            return FormSorunu(formAlani, mesaj)
        }

        /** Herhangi bir çekirdek hatasının kullanıcı mesajı (form dışı işlemler dahil). */
        fun hataMesaji(e: Throwable, f: KayitFormu? = null): FormSorunu = when (e) {
            is CekirdekHatasi.GecersizGirdi -> cekirdekSorunu(e.alan, e.neden, f)
            is CekirdekHatasi.KayitYok -> FormSorunu(FormAlani.GENEL, "Kayıt artık yok; başka yerden silinmiş olabilir.")
            is CekirdekHatasi.GecersizDurum ->
                FormSorunu(FormAlani.GENEL, "Silinmiş kayıtta bu yapılamaz; önce geri yükleyin.")
            is CekirdekHatasi.Depo -> FormSorunu(FormAlani.GENEL, "Telefondaki kayıt deposu yazılamadı. Yeniden deneyin.")
            is CekirdekHatasi.KabukCagrisi -> FormSorunu(FormAlani.GENEL, "Telefon bir işlemi tamamlayamadı. Yeniden deneyin.")
            is CekirdekHatasi.Eslesme -> FormSorunu(FormAlani.GENEL, "PC eşleşmesi yok.")
            is CekirdekHatasi.Yazilmadi -> FormSorunu(FormAlani.GENEL, "Bu işlem henüz yapılamıyor.")
            else -> FormSorunu(FormAlani.GENEL, "Beklenmeyen hata: ${e.javaClass.simpleName}")
        }
    }
}
