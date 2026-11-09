import { useState } from "react";
import type { ReactNode } from "react";
import { TextInput, View } from "react-native";
import type { Sohbet, SoruKarti } from "../cekirdek/index.ts";
import { Dugme, Duz, DurumEtiketi, KartKabi } from "./Bilesenler.tsx";
import { bosluk, cizgi, olcu, renk, yaricap, yazi } from "./tema.ts";
import type { RenkAdi } from "./tema.ts";

function durumEtiketi(durum: string): { metin: string; renk: RenkAdi } {
  switch (durum) {
    case "bekliyor":
      return { metin: "Cevap bekliyor", renk: "vurgu" };
    case "cevaplandi":
      return { metin: "Cevaplandı", renk: "basari" };
    case "zaman_asimi":
      return { metin: "Zaman aşımı", renk: "uyari" };
    case "iptal":
      return { metin: "İptal edildi", renk: "metinSonuk" };
    default:
      return { metin: durum, renk: "metinSonuk" };
  }
}

export function SoruKartiEkrani(p: { kart: SoruKarti; sohbet: Sohbet }): ReactNode {
  const { kart, sohbet } = p;
  const [cevap, setCevap] = useState("");
  const [not, setNot] = useState<string | null>(null);
  const [odak, setOdak] = useState(false);
  const bekliyor = kart.durum === "bekliyor";
  const d = durumEtiketi(kart.durum);

  const yolla = async (metin: string): Promise<void> => {
    const t = metin.trim();
    if (t === "") return;
    const s = await sohbet.soruCevapla(kart.soru_id, t);
    if (s.ok) setCevap("");
    setNot(s.ok ? "Cevap gönderildi." : s.neden === "zaten_yollandi" ? "Cevap zaten gönderildi." : "Cevap gönderilemedi.");
  };

  return (
    <KartKabi bekliyor={bekliyor}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: bosluk[2] }}>
        <View style={{ flexShrink: 1 }}>
          <Duz metin={`İş ${kart.is_id} sorusu`} boyut="kucukKalin" renk="metinIkincil" />
        </View>
        <DurumEtiketi metin={d.metin} renkAdi={d.renk} />
      </View>
      <Duz metin={kart.soru} />
      {!bekliyor && kart.cevap !== null && <Duz metin={`Cevap: ${kart.cevap}`} boyut="kucuk" renk="metinIkincil" />}
      {bekliyor && (
        <View style={{ gap: bosluk[2] }}>
          {kart.secenekler.map((s) => (
            <Dugme key={s} yazi={s} tur="ikincil" basinca={() => void yolla(s)} />
          ))}
          <TextInput
            style={[
              yazi.govde,
              {
                minHeight: olcu.girdiEnAz,
                maxHeight: olcu.girdiEnCok,
                color: renk.metin,
                backgroundColor: renk.zemin,
                borderWidth: cizgi.normal,
                borderColor: odak ? renk.vurgu : renk.kenarGuclu,
                borderRadius: yaricap.orta,
                paddingHorizontal: 14,
                paddingVertical: bosluk[3],
              },
            ]}
            value={cevap}
            onChangeText={setCevap}
            onFocus={() => setOdak(true)}
            onBlur={() => setOdak(false)}
            placeholder="Cevabını yaz"
            placeholderTextColor={renk.metinSonuk}
            cursorColor={renk.vurgu}
            selectionColor={renk.vurguSecim}
            selectionHandleColor={renk.vurgu}
            multiline
          />
          <Dugme yazi="Cevabı gönder" kapali={cevap.trim() === ""} basinca={() => void yolla(cevap)} />
        </View>
      )}
      {not !== null && (
        <Duz metin={not} boyut="kucuk" renk={not === "Cevap gönderilemedi." ? "hata" : "metinIkincil"} />
      )}
    </KartKabi>
  );
}
