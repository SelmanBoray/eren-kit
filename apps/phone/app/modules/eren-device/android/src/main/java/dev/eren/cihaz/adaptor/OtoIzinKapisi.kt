package dev.eren.cihaz.adaptor

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import dev.eren.cihaz.cekirdek.CekirdekSinirlari
import dev.eren.cihaz.cekirdek.IsTuru
import dev.eren.cihaz.cekirdek.IzinKaynagi
import dev.eren.cihaz.cekirdek.IzinModu
import dev.eren.cihaz.cekirdek.IzinliUygulama
import dev.eren.cihaz.cekirdek.OnayliIzin
import dev.eren.cihaz.cekirdek.PlanHash
import dev.eren.cihaz.cekirdek.Sema
import dev.eren.cihaz.cekirdek.TelefonIzinIstegi
import dev.eren.cihaz.cekirdek.UygulamaDurumu

/** [OtoIzinKapisi.dene] sonucu. `neden` kapalı liste; köprü `onay_gerekli` ile aynen taşır. */
sealed interface OtoIzinSonucu {
    data class Verildi(val grantId: String) : OtoIzinSonucu

    /**
     * `neden` ∈ `tam_yetki_kapali`, `gecersiz`, `uygulama_listede_degil`, `hassas`,
     * `erisim_acilamadi`, `cekirdek_yok`. Kart kullanıcıya kalır (OnayActivity yolu).
     */
    data class OnayGerekli(val neden: String) : OtoIzinSonucu
}

/**
 * Tam yetki açıkken telefon planını onay ekranı olmadan izne çeviren kapı; `OnayActivity` dışında
 * `izinler.ekle`'yi çağıran TEK yer (yapısal değişmez). Plan çözme, özet doğrulama ve izin kaydı
 * `OnayActivity` ile aynı çekirdek işlevleriyle (`Sema.planCoz`, `PlanHash.planHash`) ve aynı
 * kurulumla yapılır; farklar: ekran yok, biyometri yok, `kaynak = IzinKaynagi.OTO`, paket listesi
 * denetimi, izin `ErisimAnahtari.ac` `ACIK`'tan sonra doğar, ardından son-olay tohumlanır.
 *
 * Sıra: tam yetki → sıkı çözüm + özet + tür → çekirdek → liste → erişilebilirlik → (taze yeniden
 * denetim) → aynı `plan_id` + `plan_hash` için etkin izin varsa yenisi doğmaz, onun `grant_id`'si →
 * yoksa `izinler.ekle` → `izinEklendi` → son-olay tohumu → `Verildi`. Liste karışıksa (hem
 * hassas/değişmez hem yeni paket) `hassas` önce gelir.
 *
 * İPLİK. Ana iplikte çağrılır (değilse kendini ana ipliğe aktarır). Denetimler, etkin izin araması
 * ve `izinler.ekle` ana iplikte (arama ile ekleme arasına başka `dene` giremez); yalnız tohumun
 * `anlik()` okuması işçi ipliğinde. Sonuç her zaman ana iplikte, ayrı iletiyle ve tam bir kez gelir.
 * Plan/görev metni günlüğe girmez; jeton dışarı çıkmaz.
 */
object OtoIzinKapisi {
    private const val TAM_YETKI_KAPALI = "tam_yetki_kapali"
    private const val GECERSIZ = "gecersiz"
    private const val LISTEDE_DEGIL = "uygulama_listede_degil"
    private const val HASSAS = "hassas"
    private const val ERISIM_ACILAMADI = "erisim_acilamadi"
    private const val CEKIRDEK_YOK = "cekirdek_yok"

    private val ana = Handler(Looper.getMainLooper())

    /** Tohumun erişilebilirlik IPC'si (`anlik()`) için; ana iplik bloklanmaz. */
    private val isci: Handler by lazy {
        Handler(HandlerThread("eren-oto-izin").apply { start() }.looper)
    }

    /** Sıkı çözülmüş ve özeti doğrulanmış telefon planı. */
    private class Hazir(val planId: String, val hash: String, val istek: TelefonIzinIstegi)

    /** Tek bir `dene` çağrısının durumu. Yalnız ana iplikte okunur/yazılır. */
    private class Deneme(private val sonuc: (OtoIzinSonucu) -> Unit) {
        var bitti = false
            private set

        fun ver(s: OtoIzinSonucu) {
            if (bitti) return
            bitti = true
            ana.post { sonuc(s) }
        }
    }

    fun dene(ctx: Context, planJson: String, planHash: String, sonuc: (OtoIzinSonucu) -> Unit) {
        val app = ctx.applicationContext ?: ctx
        if (Looper.myLooper() !== Looper.getMainLooper()) {
            ana.post { dene(app, planJson, planHash, sonuc) }
            return
        }
        val d = Deneme(sonuc)
        try {
            basla(app, d, planJson, planHash)
        } catch (_: Exception) {
            // İzin doğmadan önceki beklenmedik hata; geç gelen erişim yanıtı `bitti` ile düşer.
            d.ver(red(GECERSIZ))
        }
    }

    // ---------------------------------------------------------------------------------------------

    private fun basla(app: Context, d: Deneme, planJson: String, planHash: String) {
        if (!TamYetki.acik(app)) return d.ver(red(TAM_YETKI_KAPALI))
        val h = coz(planJson, planHash) ?: return d.ver(red(GECERSIZ))
        val c = Adaptor.cekirdek ?: return d.ver(red(CEKIRDEK_YOK))
        listeNedeni(c, h.istek)?.let { return d.ver(red(it)) }
        // Sözleşme: ana iplikte çağrılır; yanıt en geç ~4 sn içinde, bir kez, ana iplikte gelir.
        ErisimAnahtari.ac(app) { s -> erisimSonucu(app, d, h, s) }
    }

    /** `OnayActivity.onCreate` + `engeller()`'in yapısal kısmı: geçmeyen her şey `null` (gecersiz). */
    private fun coz(planJson: String, beklenen: String): Hazir? {
        val p = Sema.planCoz(planJson) ?: return null
        val h = PlanHash.planHash(p.ham) ?: return null
        if (h != beklenen) return null
        if (p.tur != IsTuru.TELEFON) return null
        val i = p.telefonIzinIstegi ?: return null
        if (i.uygulamalar.isEmpty()) return null
        if (i.mod == IzinModu.YAZ && i.uygulamalar.size != 1) return null
        return Hazir(p.planId, h, i)
    }

    /** Her paket `ACIK` olmalı. Hassas/değişmez varsa `hassas`, yoksa yeni varsa `uygulama_listede_degil`. */
    private fun listeNedeni(c: CekirdekErisimi, i: TelefonIzinIstegi): String? {
        var yeni = false
        for (paket in i.uygulamalar) {
            when (c.listeler.durum(paket)) {
                UygulamaDurumu.ACIK -> Unit
                UygulamaDurumu.HASSAS, UygulamaDurumu.DEGISMEZ -> return HASSAS
                UygulamaDurumu.YENI -> yeni = true
            }
        }
        return if (yeni) LISTEDE_DEGIL else null
    }

    private fun erisimSonucu(app: Context, d: Deneme, h: Hazir, s: AcmaSonucu) {
        if (d.bitti) return
        if (s != AcmaSonucu.ACIK) return d.ver(red(ERISIM_ACILAMADI))
        val c = Adaptor.cekirdek ?: return d.ver(red(CEKIRDEK_YOK))
        val sonuc = try {
            izinUret(app, c, h)
        } catch (_: Exception) {
            red(GECERSIZ)
        }
        if (sonuc !is OtoIzinSonucu.Verildi) return d.ver(sonuc)
        // İzin vardır (yeni ya da aynı planın etkin izni): tohum ne olursa olsun sonuç `Verildi`.
        try {
            tohumla(c, h.istek.uygulamalar) { d.ver(sonuc) }
        } catch (_: Exception) {
            d.ver(sonuc)
        }
    }

    /**
     * Yalnız `ACIK`'tan sonra, ana iplikte. Bekleme sırasında değişmiş olabilecek durum (çekirdek,
     * tam yetki, liste) `OnayActivity.izinUret` gibi bir kez daha taze okunur. Aynı plan (`plan_id`
     * + `plan_hash`) için etkin izin varsa (kaynağı ne olursa olsun) yenisi doğmaz: JS bağlamı
     * yeniden yüklenip aynı karta ikinci `otoIzin` gelse de süre/bütçe ikiye katlanmaz; `izinEklendi`
     * de yinelenmez (PC o izni zaten aldı ya da `welcome`'da eşitler). Süre/bütçe `OnayActivity`'nin
     * önceden seçili varsayılanlarıdır (moda göre).
     */
    private fun izinUret(app: Context, c: CekirdekErisimi, h: Hazir): OtoIzinSonucu {
        if (!TamYetki.acik(app)) return red(TAM_YETKI_KAPALI)
        listeNedeni(c, h.istek)?.let { return red(it) }
        c.izinler.aktifler()
            .firstOrNull { it.kayit.planId == h.planId && it.kayit.planHash == h.hash }
            ?.let { return OtoIzinSonucu.Verildi(it.kayit.grantId) }
        val i = h.istek
        val yaz = i.mod == IzinModu.YAZ
        val onay = OnayliIzin(
            planId = h.planId,
            planHash = h.hash,
            mod = i.mod,
            uygulamalar = i.uygulamalar.map { IzinliUygulama(it, c.paket.ad(it)) },
            izinliMetin = if (yaz) i.izinliMetin else emptyList(),
            serbestMetin = yaz && i.serbestMetin,
            sureMs = if (yaz) CekirdekSinirlari.YAZMA_SURESI_MS else CekirdekSinirlari.OKUMA_SURESI_MS,
            butce = if (yaz) CekirdekSinirlari.YAZMA_BUTCESI else CekirdekSinirlari.OKUMA_BUTCESI,
            kaynak = IzinKaynagi.OTO,
        )
        val kayit = c.izinler.ekle(onay) ?: return red(GECERSIZ)
        // Bu satırdan sonra izin vardır: aşağıdakiler ne olursa olsun sonuç `Verildi`.
        try {
            Adaptor.oturumGuncelle?.izinEklendi(kayit)
        } catch (_: Exception) {
            // PC sonraki `welcome`'da eşitler.
        }
        return OtoIzinSonucu.Verildi(kayit.grantId)
    }

    /**
     * Servis yeni bağlandıysa son-olay boştur ve kullanıcı zaten hedef uygulamadaysa pencere olayı
     * gelmez. Aktif kök ve odak aynı plan paketindeyse son-olay o paketle tohumlanır.
     *
     * `anlik()` erişilebilirlik IPC'si yapar (`windows`, pencere başına `getRoot`,
     * `rootInActiveWindow`; meşgul ön planda saniyeler sürebilir): `isci`'de okunur. `pencereOlayi`
     * (EkranOkuyucu iplik sözleşmesi) ve `sonra` ana iplikte, tohum olsa da olmasa da tam bir kez
     * (`Deneme.ver` ayrıca tekildir). Tohum önceki son-olayı koşulsuz ezer (eşzamanlı sürümde de
     * böyleydi); fark, ana iplik artık okuma sürerken pencere olayı işleyebilmesi. Ön planı
     * değiştiren böyle bir olayda kök/odak ya okumada tutarsız çıkar (tohum yok) ya da komut anında
     * tohumla uyuşmaz (kapı reddeder; güvenli yön). Tohum `postAtFrontOfQueue` ile girer: okuma
     * bittiğinde kuyrukta bekleyen olaylar tohumdan SONRA işlenir ve onu ezer.
     */
    private fun tohumla(c: CekirdekErisimi, paketler: List<String>, sonra: () -> Unit) {
        val okuyucu = c.ekran as? EkranOkuyucu ?: return sonra()
        val kuyrukta = isci.post {
            val paket = try {
                val a = okuyucu.anlik()
                a.aktifKokPaketi?.takeIf { it == a.odakPaketi && it in paketler }
            } catch (_: Exception) {
                null
            }
            ana.postAtFrontOfQueue {
                try {
                    if (paket != null) okuyucu.pencereOlayi(paket)
                } catch (_: Exception) {
                    // Tohum yalnız hızlandırıcı; yoksa ilk pencere olayı son-olayı kurar.
                }
                sonra()
            }
        }
        if (!kuyrukta) sonra()
    }

    private fun red(neden: String) = OtoIzinSonucu.OnayGerekli(neden)
}
