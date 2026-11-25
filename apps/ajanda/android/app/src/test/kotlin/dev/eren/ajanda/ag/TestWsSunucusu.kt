package dev.eren.ajanda.ag

import java.io.DataInputStream
import java.io.EOFException
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Süreç içi, yalnız geri döngü adresinde dinleyen en küçük WebSocket sunucusu (RFC 6455; parçalı çerçeve
 * yok). Gerçek OkHttp istemcisini sınamak için: gelen metin çerçevelerini ve kapanış kodlarını sıraya
 * yazar, test istediğini yollar. Her bağlantıyı kabul eder; [baglantiSayisi] sayar.
 */
class TestWsSunucusu : AutoCloseable {
    private val sunucu = ServerSocket(0, 8, InetAddress.getLoopbackAddress())
    val port: Int get() = sunucu.localPort
    val adres: String get() = "ws://127.0.0.1:$port/ajanda"

    val gelenler = LinkedBlockingQueue<String>()
    val kapanisKodlari = LinkedBlockingQueue<Int>()
    val baglantiSayisi = AtomicInteger(0)

    /** `false`: ping'e pong verilmez (istemcinin ping zaman aşımını sınamak için). */
    @Volatile
    var pongVer = true

    @Volatile
    private var istemci: Socket? = null
    private val yaziKilidi = Any()
    private val hazir = LinkedBlockingQueue<Socket>()

    init {
        thread(isDaemon = true, name = "test-ws-kabul") {
            while (!sunucu.isClosed) {
                val s = try {
                    sunucu.accept()
                } catch (_: Exception) {
                    break
                }
                baglantiSayisi.incrementAndGet()
                thread(isDaemon = true, name = "test-ws-oku") { hizmet(s) }
            }
        }
    }

    /** İstemci bağlanıp yükseltme tamamlanana dek bekler. */
    fun baglantiyiBekle(sureMs: Long = 5_000): Boolean {
        val s = hazir.poll(sureMs, TimeUnit.MILLISECONDS) ?: return false
        istemci = s
        return true
    }

    fun gonder(metin: String) = yaz(0x1, metin.toByteArray(Charsets.UTF_8))

    fun ikiliGonder() = yaz(0x2, byteArrayOf(1, 2, 3))

    fun kapat(kod: Int = 1000) = yaz(0x8, byteArrayOf((kod shr 8).toByte(), kod.toByte()))

    /** Kapanış el sıkışmasız TCP kesimi. */
    fun kes() {
        istemci?.close()
    }

    fun gelen(sureMs: Long = 5_000): String? = gelenler.poll(sureMs, TimeUnit.MILLISECONDS)

    override fun close() {
        sunucu.close()
        istemci?.close()
    }

    private fun hizmet(s: Socket) {
        try {
            val giris = DataInputStream(s.getInputStream())
            val cikis = s.getOutputStream()
            elSikis(giris, cikis)
            hazir += s
            while (true) {
                val b0 = giris.readUnsignedByte()
                val b1 = giris.readUnsignedByte()
                val kod = b0 and 0x0F
                var uzunluk = (b1 and 0x7F).toLong()
                if (uzunluk == 126L) uzunluk = giris.readUnsignedShort().toLong()
                if (uzunluk == 127L) uzunluk = giris.readLong()
                val maske = ByteArray(4)
                if (b1 and 0x80 != 0) giris.readFully(maske)
                val yuk = ByteArray(uzunluk.toInt())
                giris.readFully(yuk)
                if (b1 and 0x80 != 0) for (i in yuk.indices) yuk[i] = (yuk[i].toInt() xor maske[i % 4].toInt()).toByte()
                when (kod) {
                    0x1 -> gelenler += String(yuk, Charsets.UTF_8)
                    0x8 -> {
                        val k = if (yuk.size >= 2) ((yuk[0].toInt() and 0xFF) shl 8) or (yuk[1].toInt() and 0xFF) else 1005
                        kapanisKodlari += k
                        runCatching { yazSokete(cikis, 0x8, yuk.copyOf(minOf(2, yuk.size))) }
                        s.close()
                        return
                    }
                    0x9 -> if (pongVer) yazSokete(cikis, 0xA, yuk)
                }
            }
        } catch (_: EOFException) {
        } catch (_: Exception) {
        } finally {
            runCatching { s.close() }
        }
    }

    private fun elSikis(giris: DataInputStream, cikis: OutputStream) {
        val satirlar = mutableListOf<String>()
        val sb = StringBuilder()
        while (true) {
            val c = giris.readUnsignedByte()
            if (c == '\n'.code) {
                val satir = sb.toString().trimEnd('\r')
                sb.setLength(0)
                if (satir.isEmpty()) break
                satirlar += satir
            } else {
                sb.append(c.toChar())
            }
        }
        val anahtar = satirlar.first { it.startsWith("Sec-WebSocket-Key:", ignoreCase = true) }
            .substringAfter(':').trim()
        val kabul = Base64.getEncoder().encodeToString(
            MessageDigest.getInstance("SHA-1").digest((anahtar + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray()),
        )
        val yanit = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: $kabul\r\n\r\n"
        cikis.write(yanit.toByteArray(Charsets.US_ASCII))
        cikis.flush()
    }

    private fun yaz(kod: Int, yuk: ByteArray) {
        val s = istemci ?: error("istemci yok")
        yazSokete(s.getOutputStream(), kod, yuk)
    }

    private fun yazSokete(cikis: OutputStream, kod: Int, yuk: ByteArray) {
        synchronized(yaziKilidi) {
            cikis.write(0x80 or kod)
            when {
                yuk.size < 126 -> cikis.write(yuk.size)
                yuk.size <= 0xFFFF -> {
                    cikis.write(126)
                    cikis.write(yuk.size shr 8)
                    cikis.write(yuk.size and 0xFF)
                }
                else -> {
                    cikis.write(127)
                    val n = yuk.size.toLong()
                    for (i in 7 downTo 0) cikis.write(((n shr (8 * i)) and 0xFF).toInt())
                }
            }
            cikis.write(yuk)
            cikis.flush()
        }
    }
}
