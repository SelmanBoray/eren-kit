package dev.eren.cihaz.cekirdek

/*
 * temel.ts `kimlikImzaMetni` portu. Biçim denetimi döngüyle yapılır (regex'in `$`'ı sondaki
 * satır sonunu kabul edebilir); alanlar satır sonu içeremeyeceği için birleştirme tek anlamlıdır.
 */
object KimlikMetni : KimlikMetniIslemi {
    override fun metin(
        rol: ImzaRolu,
        kanal: Kanal,
        deviceId: String,
        clientNonce: String,
        serverNonce: String,
    ): String? {
        if (!opakIdMi(deviceId) || !nonceMi(clientNonce) || !nonceMi(serverNonce)) return null
        return listOf("eren-auth-v$PROTOKOL_SURUMU", rol.kablo, kanal.kablo, deviceId, clientNonce, serverNonce)
            .joinToString("\n")
    }

    // /^[A-Za-z0-9_-]+$/, 1..OPAK_ID
    private fun opakIdMi(s: String): Boolean =
        s.length in 1..Sinirlar.OPAK_ID && s.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '-' }

    // /^[A-Za-z0-9+/]+={0,2}$/, NONCE_MIN..NONCE_MAX
    private fun nonceMi(s: String): Boolean {
        if (s.length !in Sinirlar.NONCE_MIN..Sinirlar.NONCE_MAX) return false
        val govdeSonu = s.trimEnd('=').length
        if (s.length - govdeSonu > 2 || govdeSonu == 0) return false
        return (0 until govdeSonu).all { i ->
            val c = s[i]
            c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '+' || c == '/'
        }
    }

}
