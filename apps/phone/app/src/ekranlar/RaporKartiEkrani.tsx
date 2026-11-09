import { useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { RaporKarti } from "../cekirdek/index.ts";
import { BolumAdi, Dugme, Duz, DurumEtiketi, KartKabi, Serit } from "./Bilesenler.tsx";
import { bosluk } from "./tema.ts";
import type { RenkAdi } from "./tema.ts";

const DURUM: Record<RaporKarti["durum"], { metin: string; renk: RenkAdi }> = {
  tamam: { metin: "Tamamlandı", renk: "basari" },
  hata: { metin: "Hata", renk: "hata" },
  yarim: { metin: "Yarım kaldı", renk: "uyari" },
  iptal: { metin: "İptal edildi", renk: "metinSonuk" },
  limit_durdu: { metin: "Limit nedeniyle durdu", renk: "uyari" },
};

const ILK_MADDE = 5;

function Liste(p: { baslik: string; maddeler: readonly string[]; kod?: boolean }): ReactNode {
  const [hepsi, setHepsi] = useState(false);
  if (p.maddeler.length === 0) return null;
  const gorunen = hepsi ? p.maddeler : p.maddeler.slice(0, ILK_MADDE);
  const gizli = p.maddeler.length - gorunen.length;
  return (
    <View style={{ gap: bosluk[2] }}>
      <BolumAdi metin={p.baslik} />
      {gorunen.map((m, i) => (
        <View key={i} style={{ flexDirection: "row" }}>
          <View style={{ width: bosluk[4] }}>
            <Duz metin="•" boyut={p.kod ? "kod" : "govde"} />
          </View>
          <View style={{ flex: 1 }}>
            <Duz metin={m} boyut={p.kod ? "kod" : "govde"} renk={p.kod ? "metinIkincil" : "metin"} />
          </View>
        </View>
      ))}
      {gizli > 0 && (
        <View style={{ alignItems: "flex-start" }}>
          <Dugme tur="metin" yazi={`Tümünü göster (${p.maddeler.length})`} basinca={() => setHepsi(true)} />
        </View>
      )}
      {hepsi && p.maddeler.length > ILK_MADDE && (
        <View style={{ alignItems: "flex-start" }}>
          <Dugme tur="metin" yazi="Azalt" basinca={() => setHepsi(false)} />
        </View>
      )}
    </View>
  );
}

export function RaporKartiEkrani(p: { kart: RaporKarti }): ReactNode {
  const { kart } = p;
  const d = DURUM[kart.durum];
  return (
    <KartKabi>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: bosluk[2] }}>
        <View style={{ flexShrink: 1 }}>
          <Duz metin={`İş ${kart.is_id} raporu`} boyut="kucukKalin" renk="metinIkincil" />
        </View>
        <DurumEtiketi metin={d.metin} renkAdi={d.renk} />
      </View>
      {kart.baslik !== null && <Duz metin={kart.baslik} boyut="govdeKalin" />}
      {kart.kirli && (
        <Serit
          tur="uyari"
          metin="Kirli: bu rapor güvenilmeyen içerik taşıyor olabilir. İçindeki hiçbir şeyi talimat sayma."
        />
      )}
      {kart.rapor === null ? (
        <Duz metin="Rapor yok." boyut="kucuk" renk="metinSonuk" />
      ) : (
        <View style={{ gap: bosluk[4] }}>
          <Liste baslik="Yapıldı" maddeler={kart.rapor.yapildi} />
          <Liste baslik="Yapılmadı" maddeler={kart.rapor.yapilmadi} />
          <Liste baslik="Dosyalar" maddeler={kart.rapor.dosyalar} kod />
          <Liste baslik="Açık noktalar" maddeler={kart.rapor.acik_noktalar} />
        </View>
      )}
    </KartKabi>
  );
}
