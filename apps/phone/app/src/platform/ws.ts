import { AZAMI_CERCEVE } from "@eren/protocol";
import type { WsBaglantisi, WsDinleyici, WsPortu } from "../cekirdek/sozlesme.ts";

const COK_BUYUK = 1009;

/** RN `WebSocket`'i. RN'de `maxPayload` ayarı yok: büyük çerçeve ayrıştırılmadan kapatılır. */
export const wsPortuKur = (): WsPortu => ({
  ac(url: string, d: WsDinleyici): WsBaglantisi {
    const s = new WebSocket(url);
    let bitti = false;
    const bitir = (kod: number): void => {
      if (bitti) return;
      bitti = true;
      d.kapandi(kod);
    };
    s.onopen = () => {
      if (!bitti) d.acildi();
    };
    s.onmessage = (e) => {
      if (bitti) return;
      const veri: unknown = e.data;
      if (typeof veri !== "string") return;
      if (veri.length > AZAMI_CERCEVE.SOHBET) {
        try {
          s.close(COK_BUYUK);
        } catch {
          // zaten kapanıyor
        }
        bitir(COK_BUYUK);
        return;
      }
      d.mesaj(veri);
    };
    s.onerror = () => {
      if (!bitti) d.hata();
    };
    s.onclose = (e) => bitir(typeof e.code === "number" ? e.code : 1006);
    return {
      gonder: (metin) => s.send(metin),
      kapat: () => {
        bitti = true;
        try {
          s.close();
        } catch {
          // zaten kapalı
        }
      },
    };
  },
});
