package dev.eren.ajanda.ekran.sahne.cizim

import dev.eren.ajanda.ekran.sahne.cizim.takim.ArabaCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.BankaCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.BitkiCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.CamasirCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.DisCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.DogumGunuCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.DoktorCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.EglenceCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.EvCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.EvcilCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.FaturaCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.GenelCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.IlacCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.IsCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.KahveCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.KampCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.KargoCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.KitapCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.MarketCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.MektupCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.OkulCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.SacCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.SeyahatCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.SporCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.TamirCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.TelefonCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.TemizlikCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.ToplantiCizimi
import dev.eren.ajanda.ekran.sahne.cizim.takim.YemekCizimi
import dev.eren.ajanda.ekran.sahne.tema.LevhaRengi

/**
 * Çizim kaydı: sözleşmedeki 29 simge anahtarı ve çizimleri (Kol C v3 `simge` alanı, `^[a-z][a-z0-9_]{0,31}$`).
 * Küme açıktır: bilinmeyen anahtar [GENEL_ANAHTAR] ile çizilir.
 *
 * Bu dosya değişmez. Her anahtarın çizimi `takim/<Anahtar>Cizimi.kt` dosyasındadır (anahtar deve biçiminde:
 * `dogum_gunu` → `DogumGunuCizimi.kt`); çizim eklemek yalnız o dosyayı değiştirmektir.
 */
internal val TUM_CIZIMLER: List<Cizim> = listOf(
    GenelCizimi,
    ArabaCizimi,
    BankaCizimi,
    DisCizimi,
    DogumGunuCizimi,
    DoktorCizimi,
    EvCizimi,
    FaturaCizimi,
    IlacCizimi,
    IsCizimi,
    KahveCizimi,
    KargoCizimi,
    KitapCizimi,
    MarketCizimi,
    OkulCizimi,
    SacCizimi,
    SeyahatCizimi,
    SporCizimi,
    TelefonCizimi,
    TemizlikCizimi,
    ToplantiCizimi,
    YemekCizimi,
    KampCizimi,
    EvcilCizimi,
    BitkiCizimi,
    TamirCizimi,
    CamasirCizimi,
    EglenceCizimi,
    MektupCizimi,
)

private val ANAHTARLA: Map<String, Cizim> = TUM_CIZIMLER.associateBy { it.anahtar }

/** Eşleşme olmayınca kullanılan anahtar. */
const val GENEL_ANAHTAR = "genel"

/** Sözleşmedeki 29 anahtar, sözleşme sırasıyla. */
val CIZIM_ANAHTARLARI: List<String> = TUM_CIZIMLER.map { it.anahtar }

/** Anahtarın çizimi; bilinmeyen ya da boş anahtar `genel`. Büyük/küçük harf ve baştaki/sondaki boşluk yok sayılır. */
fun cizimBul(anahtar: String?): Cizim =
    anahtar?.trim()?.lowercase()?.let { ANAHTARLA[it] } ?: ANAHTARLA.getValue(GENEL_ANAHTAR)

/** Anahtarın bu sürümde gerçekten çizilebilen karşılığı: bilinmeyen anahtar için [GENEL_ANAHTAR]. */
fun cizimAnahtari(anahtar: String?): String = cizimBul(anahtar).anahtar

/**
 * Anahtarın varsayılan levha takımı (kayıtta renk seçilmemişse). Temaya göre renkleri
 * `Sahne.levha(varsayilanLevhaRengi(anahtar))` verir. Bilinmeyen anahtar `genel`in rengini (kum) alır.
 */
fun varsayilanLevhaRengi(anahtar: String?): LevhaRengi = cizimBul(anahtar).renk
