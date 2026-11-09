import { useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { GonderSonucu, PlanKarti, Sohbet } from "../cekirdek/index.ts";
import type { ErenCihaz } from "../cihaz/erenDevice.ts";
import { BolumAdi, Dugme, DurumEtiketi, Duz, KartKabi, Serit } from "./Bilesenler.tsx";
import { otoIzinKartGorunumu, useOtoIzinDeneniyor, useOtoIzinDeposu, useOtoIzinNotu } from "./otoIzin.ts";
import { bosluk, renk, yazi } from "./tema.ts";
import type { RenkAdi } from "./tema.ts";

interface Not {
  metin: string;
  hata: boolean;
}

const DURUM_RENGI: Record<PlanKarti["durum"], RenkAdi> = {
  bekliyor: "vurgu",
  onaylandi: "basari",
  reddedildi: "metinSonuk",
  iptal: "metinSonuk",
};

const DURUM: Record<PlanKarti["durum"], string> = {
  bekliyor: "Onayını bekliyor",
  onaylandi: "Onaylandı",
  reddedildi: "Reddedildi",
  iptal: "İptal edildi",
};

const RED: Record<string, string> = {
  plan_sonuclandi: "Plan zaten sonuçlanmış.",
  zaten_yollandi: "Karar zaten gönderildi.",
  plan_yok: "Plan bulunamadı.",
  depo_hatasi: "Telefonda kayıt hatası.",
};

export function PlanKartiEkrani(p: { kart: PlanKarti; sohbet: Sohbet; cihaz: ErenCihaz }): ReactNode {
  const { kart, sohbet, cihaz } = p;
  const pl = kart.plan;
  const [not, setNot] = useState<Not | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const bekliyor = kart.durum === "bekliyor";
  const otoDepo = useOtoIzinDeposu();
  // Otomatik deneme sürerken "deneniyor" yazılır ve düğmeler kapanır; sonuçlanmış kartta not yok.
  const oto = otoIzinKartGorunumu(kart.durum, useOtoIzinNotu(kart), useOtoIzinDeneniyor(kart));
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
        <BolumAdi metin={pl.tur === "pc" ? "PC işi planı" : "Telefon işi planı"} />
        <DurumEtiketi metin={DURUM[kart.durum]} renkAdi={DURUM_RENGI[kart.durum]} />
      </View>
      <Text style={[yazi.baslik, { color: renk.metin }]} selectable>
        {pl.baslik}
      </Text>
      {pl.kirli_kaynak !== undefined && (
        <Serit
          tur="uyari"
          metin={`Kirli: bu plan, güvenilmeyen olabilecek rapor(lar)a dayanıyor (iş ${pl.kirli_kaynak.join(", ")}). Görev metnini dikkatle oku.`}
        />
      )}
      {pl.cwd !== "" && <Duz boyut="kod" metin={`Klasör: ${pl.cwd}`} />}
      <View style={bolum}>
        <BolumAdi metin="Görev metni" />
        <Duz metin={pl.gorev_metni} />
      </View>
      <View style={bolum}>
        <BolumAdi metin="Kesin yapılacaklar" />
        {pl.kesin_yapilacaklar.map((m, i) => (
          <Madde key={i} metin={m} />
        ))}
      </View>
      <View style={bolum}>
        <BolumAdi metin="Kesin yapılmayacaklar" />
        {pl.kesin_yapilmayacaklar.length === 0 ? (
          <Duz boyut="kucuk" renk="metinSonuk" metin="Belirtilmemiş" />
        ) : (
          pl.kesin_yapilmayacaklar.map((m, i) => <Madde key={i} metin={m} />)
        )}
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
      {oto.satir !== null && <Duz boyut="kucuk" renk="metinIkincil" metin={oto.satir} />}
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

/** Asılı girintili madde: 16 dp işaret sütunu + esnek metin (6.7). */
function Madde(p: { metin: string }): ReactNode {
  return (
    <View style={{ flexDirection: "row" }}>
      <Text style={[yazi.govde, { color: renk.metin, width: bosluk[4] }]}>•</Text>
      <View style={{ flex: 1 }}>
        <Duz metin={p.metin} />
      </View>
    </View>
  );
}
