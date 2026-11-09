import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { GonderSonucu, PlanKarti, Sohbet } from "../cekirdek/index.ts";
import type { ErenCihaz } from "../cihaz/erenDevice.ts";
import { BolumAdi, Dugme, DurumEtiketi, Duz, KartKabi, Serit } from "./Bilesenler.tsx";
import { otoIzinKartGorunumu, useOtoIzinDeneniyor, useOtoIzinDeposu, useOtoIzinNotu } from "./otoIzin.ts";
import {
  isDurumuBul,
  izinBeklemesiKalanMs,
  izinGorulmeleriniKaydet,
  planKartiDurumu,
  yoldakiKarar,
} from "./planKartiDurumu.ts";
import type { IzinGorulmeleri, YoldakiKarar } from "./planKartiDurumu.ts";
import { bosluk, renk, yazi } from "./tema.ts";

interface Not {
  metin: string;
  hata: boolean;
}

const RED: Record<string, string> = {
  plan_sonuclandi: "Bu iş zaten sonuçlanmış.",
  zaten_yollandi: "Karar zaten gönderildi.",
  plan_yok: "İş kartı bulunamadı.",
  depo_hatasi: "Telefonda kayıt hatası.",
};

export function PlanKartiEkrani(p: { kart: PlanKarti; sohbet: Sohbet; cihaz: ErenCihaz }): ReactNode {
  const { kart, sohbet, cihaz } = p;
  const pl = kart.plan;
  const [not, setNot] = useState<Not | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const otoDepo = useOtoIzinDeposu();
  // Otomatik deneme sürerken "deneniyor" yazılır ve düğmeler kapanır; sonuçlanmış kartta not yok.
  const oto = otoIzinKartGorunumu(kart.durum, useOtoIzinNotu(kart), useOtoIzinDeneniyor(kart));
  const { isDurumu, karar: yoldaki } = useSohbettekiPlanBilgisi(sohbet, kart);
  // "Onay" dili ve karar düğmeleri yalnız gerçekten karar beklenirken (planKartiDurumu.ts).
  const durum = planKartiDurumu(kart.durum, isDurumu, yoldaki, oto.kilitli);
  const bekliyor = durum.onayBekleniyor;
  const kapali = mesgul || oto.kilitli;

  const sonucNotu = (s: GonderSonucu): void =>
    setNot(
      s.ok ? { metin: "Karar gönderildi.", hata: false } : { metin: RED[s.neden] ?? "Karar gönderilemedi.", hata: true },
    );

  const karar = async (k: "onay" | "ret"): Promise<void> => {
    // Ya otomatik ya elle: deneme sürüyorsa elle yol başlamaz; başlarsa kart otomatik denenmez.
    if (!otoDepo.elleBasla(kart)) return;
    setMesgul(true);
    try {
      sonucNotu(await sohbet.planKarari(kart.plan_id, kart.plan_hash, k));
    } finally {
      setMesgul(false);
    }
  };

  const telefondaIzinIste = async (): Promise<void> => {
    if (!otoDepo.elleBasla(kart)) return;
    setMesgul(true);
    try {
      const r = await cihaz.izinIste(kart.plan_json, kart.plan_hash);
      if (!r.ok) {
        setNot({
          metin: r.neden === "desteklenmiyor" ? "Bu cihazda telefon izni desteklenmiyor." : "İzin ekranı açılamadı.",
          hata: true,
        });
        return;
      }
      switch (r.deger.sonuc) {
        case "onaylandi":
          sonucNotu(await sohbet.planKarari(kart.plan_id, kart.plan_hash, "onay"));
          break;
        case "reddedildi":
          sonucNotu(await sohbet.planKarari(kart.plan_id, kart.plan_hash, "ret"));
          break;
        case "iptal":
          setNot({ metin: "İzin ekranı kapatıldı, karar verilmedi.", hata: false });
          break;
        case "gecersiz":
          setNot({ metin: "Plan telefonda doğrulanamadı.", hata: true });
          break;
      }
    } finally {
      setMesgul(false);
    }
  };

  const hataNotu = not !== null && not.hata;

  return (
    <KartKabi bekliyor={bekliyor}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: bosluk[2] }}>
        <BolumAdi metin={pl.tur === "pc" ? "PC işi" : "Telefon işi"} />
        <DurumEtiketi metin={durum.metin} renkAdi={durum.renk} />
      </View>
      <Text style={[yazi.baslik, { color: renk.metin }]} selectable>
        {pl.baslik}
      </Text>
      {pl.kirli_kaynak !== undefined && (
        <Serit
          tur="uyari"
          metin={`Kirli: bu iş, güvenilmeyen olabilecek rapor(lar)a dayanıyor (iş ${pl.kirli_kaynak.join(", ")}). Görev metnini dikkatle oku.`}
        />
      )}
      {pl.cwd !== "" && <Duz boyut="kod" metin={`Klasör: ${pl.cwd}`} />}
      <View style={bolum}>
        <BolumAdi metin="Görev metni" />
        <Duz metin={pl.gorev_metni} />
      </View>
      {pl.telefon_izin_istegi !== undefined && (
        <View style={bolum}>
          <BolumAdi metin={`İstenen telefon izni (${pl.telefon_izin_istegi.mod === "yaz" ? "yazma" : "okuma"})`} />
          <Duz boyut="kod" metin={pl.telefon_izin_istegi.uygulamalar.join("\n")} />
          {pl.telefon_izin_istegi.serbest_metin === true && (
            <Serit tur="uyari" metin="Serbest metin girişi isteniyor." />
          )}
        </View>
      )}
      {bekliyor && oto.satir !== null && <Duz boyut="kucuk" renk="metinIkincil" metin={oto.satir} />}
      {bekliyor && (
        <View style={{ flexDirection: "row", gap: bosluk[2], marginTop: bosluk[2] }}>
          <Dugme yazi="Reddet" tur="ikincil" esnek kapali={kapali} basinca={() => void karar("ret")} />
          {pl.tur === "telefon" ? (
            <Dugme
              yazi={mesgul ? "Gönderiliyor" : "Telefonda izin iste"}
              esnek
              kapali={kapali}
              basinca={() => void telefondaIzinIste()}
            />
          ) : (
            <Dugme
              yazi={mesgul ? "Gönderiliyor" : "Onayla"}
              esnek
              kapali={kapali}
              basinca={() => void karar("onay")}
            />
          )}
        </View>
      )}
      {not !== null && (
        <Duz boyut="kucuk" renk={hataNotu ? "hata" : "metinIkincil"} metin={not.metin} />
      )}
    </KartKabi>
  );
}

const bolum = { gap: bosluk[2], marginTop: bosluk[2] } as const;

/**
 * `izin_bekleniyor` kararlarının telefonda ilk görüldüğü an (kayıtta zaman yok). Modül düzeyinde:
 * liste kartı yeniden bağlasa da süre sıfırlanmaz; uygulama yeniden açılınca süre baştan işler.
 */
const izinGorulmeleri: IzinGorulmeleri = new Map();

/**
 * Kartın sohbetten okuduğu iki bilgi: `is_id`'sinin iş durumu ve bu planın yoldaki kararı. Kart
 * nesnesi iş bitince değişmez; bu yüzden sohbete abone olunur. Anlık görüntü düz metindir (sabit).
 * İzin bekleyen karar süre dolunca kendiliğinden düşer: o an için bir zamanlayıcı yeniden çizdirir.
 */
function useSohbettekiPlanBilgisi(
  sohbet: Sohbet,
  kart: PlanKarti,
): { isDurumu: ReturnType<typeof isDurumuBul>; karar: YoldakiKarar } {
  const [tik, setTik] = useState(0);
  const abone = useCallback((f: () => void) => sohbet.abone(() => f()), [sohbet]);
  const anlik = useSyncExternalStore(abone, () => {
    const d = sohbet.durum();
    const simdi = Date.now();
    izinGorulmeleriniKaydet(kart.plan_id, d.hatalar, izinGorulmeleri, simdi);
    const karar = yoldakiKarar(kart.plan_id, d.bekleyenler, d.hatalar, izinGorulmeleri, simdi);
    const kalan = izinBeklemesiKalanMs(kart.plan_id, d.hatalar, izinGorulmeleri, simdi);
    return `${isDurumuBul(d.ogeler, kart.is_id) ?? ""}|${karar ?? ""}|${kalan === null ? "" : "z"}`;
  });
  const [is, karar, zamanli] = anlik.split("|");
  const izinliMi = zamanli === "z";
  useEffect(() => {
    if (!izinliMi) return;
    const kalan = izinBeklemesiKalanMs(kart.plan_id, sohbet.durum().hatalar, izinGorulmeleri, Date.now());
    if (kalan === null) return;
    const t = setTimeout(() => setTik((n) => n + 1), kalan + 50);
    return () => clearTimeout(t);
    // `tik`: zamanlayıcı düştüğünde başka bir izin kaydı hâlâ geçerliyse onun için yeniden kurulur.
  }, [izinliMi, kart.plan_id, sohbet, tik]);
  return {
    isDurumu: is === "" || is === undefined ? null : (is as NonNullable<ReturnType<typeof isDurumuBul>>),
    karar: karar === "onay" || karar === "ret" ? karar : null,
  };
}
