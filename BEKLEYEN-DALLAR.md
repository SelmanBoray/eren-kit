# İncelenmeyi bekleyen dallar

Aşağıdaki dallar main'e alınmadan önce incelenmeyi bekliyor. Beğendiğiniz kısımları main'e alın; her PR'ın açıklamasında ne değiştiği ve nasıl doğrulandığı yazılı.

| Dal | PR | İçerik | Durum |
| --- | --- | --- | --- |
| `macos-ios` | [#1](https://github.com/SelmanBoray/eren-kit/pull/1) | macOS ve iOS desteği: `install.sh` (launchd servisi, kapi dahil), platform veri yolları, iPhone/iPad ana ekran web uygulaması, macOS CI. Windows davranışı değişmedi | CI yeşil (Windows + macOS), main ile çakışmasız |
| `orkestra-verim` | [#3](https://github.com/SelmanBoray/eren-kit/pull/3) | Opus Orkestra çekirdek modu (oturum başı bağlam ~33 KB → ~2,9 KB) ve bağlam defteri (`defter`: özet + yalnız fark) | #1'in üzerine kurulu; önce #1 incelenmeli |
| `oneriler` | [#4](https://github.com/SelmanBoray/eren-kit/pull/4) | `docs/ONERILER.md`: etki/maliyet tablosuyla 19 öneri | Yalnız belge |

Özet ve bağlam: [#2](https://github.com/SelmanBoray/eren-kit/issues/2).

Bu dosya, dallar main'e alındığında ya da kapatıldığında silinebilir.
