package dev.eren.ajanda.ag

import dev.eren.ajanda.cekirdek.Tasima

/**
 * SAHİBİ: K2 (ağ taşıması). Tek OkHttp WebSocket'in yazma ucu (`Tasima`): `gonder` = `webSocket.send`,
 * `kapat` = `webSocket.close`. Dinleyici: `onOpen` -> `cekirdek.baglantiAcildi(this)` (nesli sakla),
 * `onMessage` -> `cekirdek.cerceveGeldi(nesil, metin)`, `onClosed`/`onFailure` ->
 * `cekirdek.baglantiKapandi(nesil)`. Çekirdek çağrıları OkHttp'nin iş parçacığında yapılabilir
 * (ana iş parçacığı değil); geri çağrının içinden çekirdeğe eşzamanlı yeniden girme.
 * İSKELET.
 */
class AjandaSoketi : Tasima {
    override fun gonder(metin: String): Boolean = false

    override fun kapat(neden: String) {}
}
