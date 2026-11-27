/**
 * Medya dalgası (S5): `/sohbet`'in `medya1` yolu (MODULLER.md "Medya dalgası" > "S5 gateway", akışlar
 * "Yükleme" ve "Telafi"). `gateway.ts` yalnız `GatewayBagimliliklari.medya` verilmişse bunu kurar ve
 * kimliği bitmiş, `sohbette` aşamasındaki, `medya1` isteyen bağlantının `media_*` çerçevelerini buraya
 * yollar; yetki (`yetkiSuruyor`) çerçeve buraya gelmeden her seferinde denetlenmiştir.
 *
 * - `media_begin`/`media_chunk` → `GatewayMedyaYuzu` → dönen gövde YALNIZ isteyen bağlantıya
 *   `media_state`. Dönüş geldiğinde bağlantı kapanmış ya da yetkisi kalkmışsa (kümeden çıkmış) gitmez.
 * - `media_cancel` → `iptal`, yanıtsız.
 * - `veriyolu` `medya_durumu` → o `device_id`'nin bütün `medya1` bağlantılarına `media_state`; başka
 *   cihaza ve jetonsuz bağlantıya hiç gitmez.
 * Günlüğe yalnız hata türü yazılır (yol, ad, içerik yok).
 */
import { SOHBET_SURUMU, SOHBET_YETENEKLERI } from "@eren/protocol";
import type { MediaBegin, MediaCancel, MediaChunk, SohbetAsagi, YetenekJetonu } from "@eren/protocol";
import type { GatewayMedyaYuzu, Gunluk, MediaStateGovdesi, ServisOlaylari, WsBaglantisi } from "./sozlesme.ts";

export type MedyaCercevesi = MediaBegin | MediaChunk | MediaCancel;

/** Medya yolunun gördüğü bağlantı. `gateway`'in `SohbetBaglantisi`'i buna yapısal olarak uyar. */
export interface MedyaUcu {
  readonly b: WsBaglantisi;
  readonly device_id: string;
  /** `medya1` istendi VE medya bağımlılığı var (`medyaIsterMi`). */
  readonly medyaIster: boolean;
}

export interface GatewayMedyaBagimliliklari {
  medya: GatewayMedyaYuzu;
  gunluk: Gunluk;
  /** Kimliği bitmiş, açık `/sohbet` bağlantıları (gateway'in canlı kümesi; kapanan ve yetkisi kalkan çıkar). */
  baglantilar: ReadonlySet<MedyaUcu>;
}

export interface GatewayMedya {
  /** Yalnız `medyaIster` bağlantının çerçevesi; ayrımı gateway yapar (jetonsuz bağlantı `yetkisiz`). */
  cerceve(u: MedyaUcu, m: MedyaCercevesi): void;
  /** Ekli `user_message`'ın ön denetimi, olduğu gibi (eşzamanlı, yazmaz). */
  ekleriDenetle: GatewayMedyaYuzu["ekleriDenetle"];
  /** `veriyolu` `medya_durumu`. */
  durumYay(e: ServisOlaylari["medya_durumu"]): void;
}

/** `SohbetBaglantisi.medyaIster`: bağlantı `?yetenek=medya1` istedi ve servis medyayı destekliyor. */
export const medyaIsterMi = (yetenekler: ReadonlySet<string>, medyaVar: boolean): boolean =>
  medyaVar && yetenekler.has(SOHBET_YETENEKLERI.MEDYA);

/**
 * `welcome`'a yayılacak alan (protokol `Welcome`). Yalnız `medya1` İSTEYEN bağlantıya yazılır: medya varsa
 * `["medya1"]`, yoksa `[]`. İstemeyenin (jetonsuz ya da yalnız `etkinlik1`) `welcome`'ı alansız, bugünkü
 * gibi kalır; `etkinlik1` hiç yazılmaz.
 */
export const welcomeYetenekleri = (
  yetenekler: ReadonlySet<string>,
  medyaVar: boolean,
): { yetenekler?: YetenekJetonu[] } => {
  if (!yetenekler.has(SOHBET_YETENEKLERI.MEDYA)) return {};
  return { yetenekler: medyaVar ? [SOHBET_YETENEKLERI.MEDYA] : [] };
};

/**
 * Alan alan kopya: `media_state` şeması katıdır; yöneticinin gövdesine eklenen fazla bir alan çerçeveyi
 * telefonda geçersiz kılardı (`server_status.servis` ile aynı gerekçe).
 */
const durumCercevesi = (d: MediaStateGovdesi): SohbetAsagi => ({
  v: SOHBET_SURUMU,
  type: "media_state",
  medya_id: d.medya_id,
  durum: d.durum,
  ...(d.alinan !== undefined && { alinan: d.alinan }),
  ...(d.isleme !== undefined && { isleme: d.isleme }),
  ...(d.code !== undefined && { code: d.code }),
});

export function gatewayMedyaKur({ medya, gunluk, baglantilar }: GatewayMedyaBagimliliklari): GatewayMedya {
  // Hata iletisi güvenilmez değer taşıyabilir: yalnız türü yazılır.
  const hataYaz = (olay: string, e: unknown): void => {
    gunluk.hata("gateway", olay, { hata_turu: e instanceof Error ? e.name : typeof e });
  };

  // Dönüş geldiğinde bağlantı hâlâ kümede değilse (kapandı, cihazın eşleşmesi kaldırıldı) hiçbir şey gitmez.
  const yolla = (u: MedyaUcu, d: MediaStateGovdesi): void => {
    if (!baglantilar.has(u)) return;
    u.b.gonder(JSON.stringify(durumCercevesi(d)));
  };

  // Yönetici sözleşmece atmaz; yine de atarsa ya da reddederse telefon pencereyi sonsuza dek beklemesin:
  // o ek için `reddedildi{ic_hata}`. Çağrı eşzamanlı yapılır: çerçeveler geliş sırasıyla yöneticiye ulaşır.
  const yanitla = (u: MedyaUcu, medya_id: string, is: () => Promise<MediaStateGovdesi>): void => {
    let p: Promise<MediaStateGovdesi>;
    try {
      p = is();
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (d) => yolla(u, d),
      (e: unknown) => {
        hataYaz("medya_hatasi", e);
        yolla(u, { medya_id, durum: "reddedildi", code: "ic_hata" });
      },
    ).catch((e: unknown) => hataYaz("medya_gonderim_hatasi", e));
  };

  return {
    cerceve: (u, m) => {
      switch (m.type) {
        case "media_begin": {
          const { v: _v, type: _t, ...govde } = m;
          return yanitla(u, m.medya_id, () => medya.yuklemeBaslat(u.device_id, govde));
        }
        case "media_chunk": {
          const { v: _v, type: _t, ...govde } = m;
          return yanitla(u, m.medya_id, () => medya.parca(u.device_id, govde));
        }
        case "media_cancel":
          try {
            medya.iptal(u.device_id, { medya_id: m.medya_id });
          } catch (e) {
            hataYaz("medya_hatasi", e);
          }
          return;
      }
    },
    ekleriDenetle: (device_id, sohbet, ekler) => medya.ekleriDenetle(device_id, sohbet, ekler),
    durumYay: (e) => {
      let metin: string | null = null;
      for (const u of baglantilar) {
        if (u.device_id !== e.device_id || !u.medyaIster) continue;
        metin ??= JSON.stringify(durumCercevesi(e.durum));
        u.b.gonder(metin);
      }
    },
  };
}
