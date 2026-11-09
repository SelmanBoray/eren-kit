/**
 * `olay_yazildi`'dan kısa bildirim: önce `/cihaz` `notify`, ack gelmezse yedek Telegram.
 * MODULLER.md, "bildirim".
 */
import type { BildirimFabrikasi, IptalEt } from "./sozlesme.ts";

type Tur = "plan" | "soru" | "is_bitti" | "sistem";

interface Not {
  tur: Tur;
  baslik: string;
  metin: string;
}

const TELEGRAM_ZAMAN_ASIMI_MS = 10_000;

// Kod -> sabit metin. Olayın kendi metni hiçbir yere gitmez. Görünen asistan adı `Ayar.asistanAdi`.
const sistemMetinleri = (asistanAdi: string): Readonly<Record<string, string>> => ({
  ram_dusuk: "Bellek az.",
  limit_kilit_aktif: "Limit kilidi açık.",
  limit_kilit_bitti: "Limit kilidi kalktı.",
  eren_yeniden_basladi: `${asistanAdi} yeniden başladı.`,
  servis_yeniden_basladi: "Servis yeniden başladı.",
  is_uzlastirildi: "Bir iş uzlaştırıldı.",
  diger: "Uygulamaya bak.",
});

export const bildirimKur: BildirimFabrikasi = ({
  ayar,
  cihaz,
  http,
  zamanlayici,
  veriyolu,
  gunluk,
}) => {
  const SISTEM_METINLERI = sistemMetinleri(ayar.asistanAdi);
  let dinleme: IptalEt | null = null;
  const bekleyenler = new Set<IptalEt>();
  let kapali = true;

  const yedekGonder = async (n: Not): Promise<void> => {
    try {
      const telegram = await ayar.telegram();
      if (!telegram) {
        gunluk.bilgi("bildirim", "telegram_ayari_yok", { tur: n.tur });
        return;
      }
      if (kapali) return;
      const url = `https://api.telegram.org/bot${telegram.jeton}/sendMessage`;
      const sonuc = await http.postJson(
        url,
        { chat_id: telegram.sohbetId, text: `${n.baslik}: ${n.metin}` },
        TELEGRAM_ZAMAN_ASIMI_MS,
      );
      if (sonuc.durum < 200 || sonuc.durum > 299) {
        gunluk.uyari("bildirim", "telegram_reddetti", { tur: n.tur, durum: sonuc.durum });
      }
    } catch (e) {
      // Hata iletisi URL (jeton) taşıyabilir: yalnız tür yazılır.
      try {
        gunluk.uyari("bildirim", "telegram_hata", {
          tur: n.tur,
          hata_turu: e instanceof Error ? e.name : typeof e,
        });
      } catch {
        // günlük de atarsa yutulur
      }
    }
  };

  const bildir = (n: Not): void => {
    const notify_id = cihaz.bildir({ tur: n.tur, baslik: n.baslik, metin: n.metin });
    if (notify_id === null) {
      void yedekGonder(n);
      return;
    }
    let iptal: IptalEt | null = null;
    iptal = zamanlayici.sonra(ayar.sureler.bildirimAckMs, () => {
      if (iptal) bekleyenler.delete(iptal);
      if (kapali) return;
      if (!cihaz.bildirimOnaylandiMi(notify_id)) void yedekGonder(n);
    });
    bekleyenler.add(iptal);
  };

  const esle = (olay: {
    type: string;
    is_id?: number;
    durum?: string;
    seviye?: string;
    kod?: string;
  }): Not | null => {
    switch (olay.type) {
      case "plan_proposed":
        return { tur: "plan", baslik: "Onay bekliyor", metin: "Yeni plan var." };
      case "question_asked":
        return { tur: "soru", baslik: "Soru var", metin: `İş ${olay.is_id} cevap bekliyor.` };
      case "job_finished":
        return { tur: "is_bitti", baslik: "İş bitti", metin: `İş ${olay.is_id}: ${olay.durum}.` };
      case "system_notice":
        if (olay.seviye !== "uyari" && olay.seviye !== "kritik") return null;
        return {
          tur: "sistem",
          baslik: "Sistem",
          metin: SISTEM_METINLERI[olay.kod ?? "diger"] ?? "Uygulamaya bak.",
        };
      default:
        return null;
    }
  };

  return {
    baslat(): void {
      if (dinleme) return;
      kapali = false;
      dinleme = veriyolu.dinle("olay_yazildi", ({ olay }) => {
        if (kapali) return;
        try {
          const n = esle(olay);
          if (n) bildir(n);
        } catch (e) {
          gunluk.hata("bildirim", "isleme_hata", {
            olay: olay.type,
            hata_turu: e instanceof Error ? e.name : typeof e,
          });
        }
      });
    },
    kapat(): void {
      kapali = true;
      dinleme?.();
      dinleme = null;
      for (const iptal of bekleyenler) iptal();
      bekleyenler.clear();
    },
  };
};
