import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { BackHandler, Keyboard, SafeAreaView, Text, View } from "react-native";
import { cekirdekKur } from "./src/cekirdek/index.ts";
import type { SohbetAcSonucu, SohbetId } from "./src/cekirdek/index.ts";
import { erenCihazKur } from "./src/cihaz/erenDevice.ts";
import { dosyaDepoKur } from "./src/depo/dosyaDepo.ts";
import { useCekirdekDurumu } from "./src/ekranlar/baglam.ts";
import { altBaslikHesapla, hatHesapla } from "./src/ekranlar/baglantiDurumu.ts";
import { Cekmece, cekmeceSohbetleri } from "./src/ekranlar/Cekmece.tsx";
import { DurumEkrani } from "./src/ekranlar/DurumEkrani.tsx";
import { useKisayol } from "./src/ekranlar/kisayol.ts";
import { KurulumEkrani } from "./src/ekranlar/KurulumEkrani.tsx";
import { OtoIzinBaglami, useOtoIzin } from "./src/ekranlar/otoIzin.ts";
import { SohbetYonetimi } from "./src/ekranlar/SohbetDiyaloglari.tsx";
import { SohbetEkrani } from "./src/ekranlar/SohbetEkrani.tsx";
import { UstCubuk } from "./src/ekranlar/UstCubuk.tsx";
import { stil, yazi, renk, bosluk } from "./src/ekranlar/tema.ts";
import { ASISTAN_ADI } from "./src/platform/asistanAdi.ts";
import { saatKur } from "./src/platform/saat.ts";
import { wsPortuKur } from "./src/platform/ws.ts";

type Ekran = "sohbet" | "durum" | "kurulum";

// Çekmecedeki "Yeni sohbet" retleri (SohbetEkrani'ndaki "Yeni sohbet" düğmesiyle aynı metinler).
const SOHBET_AC_RED: Record<Extract<SohbetAcSonucu, { ok: false }>["neden"], string> = {
  sohbet_siniri: "En çok 8 sohbet açılabilir. Birini sil.",
  baslamadi: "Uygulama henüz hazır değil, biraz sonra yeniden dene.",
  gecersiz: "Yeni sohbet açılamadı.",
  depo_hatasi: "Yeni sohbet açılamadı: telefonda kayıt hatası.",
};

export default function App() {
  const cihaz = useMemo(() => erenCihazKur(), []);
  const cekirdek = useMemo(
    () =>
      cekirdekKur(
        { ws: wsPortuKur(), kimlik: cihaz.kimlikPortu(), depo: dosyaDepoKur(), saat: saatKur(), ses: cihaz.sesPortu() },
        { asistanAdi: ASISTAN_ADI },
      ),
    [cihaz],
  );
  const cd = useCekirdekDurumu(cekirdek);
  // Uygulama ömrü boyunca: tam yetkide telefon planlarına oto izin, kısayol mesajları "Telefon" sohbetine.
  // Oto iznin kullanıcıya kalan kart notları `OtoIzinBaglami` ile kartlara iner (`useOtoIzinNotu`).
  const otoIzin = useOtoIzin(cekirdek, cihaz);
  useKisayol(cekirdek, cihaz);
  // Seçili sohbetin tutamacı; çekirdek aynı kimliğe hep aynı nesneyi verir.
  const sohbet = cekirdek.sohbet(cd.secili);
  const [ekran, setEkran] = useState<Ekran>("sohbet");
  const [cekmeceAcik, setCekmeceAcik] = useState(false);
  const [yeniSohbetNotu, setYeniSohbetNotu] = useState<string | null>(null);
  // Tek `SohbetYonetimi`'nin hedefi: çekmece satırı da sohbet ekranının "seçenekleri" de bunu atar.
  const [menuHedefi, setMenuHedefi] = useState<SohbetId | null>(null);
  const [acilisHatasi, setAcilisHatasi] = useState(false);

  // Klavyenin kök görünümü ne kadar örttüğü. Pencere kendiliğinden küçüldüyse örtme 0 çıkar,
  // küçülmediyse (edge-to-edge) boşluk burada verilir; ikisi birden çift boşluk yapmaz.
  const kok = useRef<ComponentRef<typeof View>>(null);
  const [klavye, setKlavye] = useState(0);
  useEffect(() => {
    const ac = (e: { endCoordinates: { screenY: number } }): void => {
      kok.current?.measureInWindow((_x, y, _w, h) => setKlavye(Math.max(0, Math.round(y + h - e.endCoordinates.screenY))));
    };
    const a = Keyboard.addListener("keyboardDidShow", ac);
    const b = Keyboard.addListener("keyboardDidChangeFrame", ac);
    const c = Keyboard.addListener("keyboardDidHide", () => setKlavye(0));
    return () => {
      a.remove();
      b.remove();
      c.remove();
    };
  }, []);

  useEffect(() => {
    cekirdek.baslat().catch(() => setAcilisHatasi(true));
    return () => cekirdek.kapat();
  }, [cekirdek]);

  // İlk açılışta eşleşme yoksa Kurulum açılır (yalnız cihaz modülü varsa; yoksa eşleşme zaten olamaz).
  useEffect(() => {
    if (!cihaz.desteklenir) return;
    let iptal = false;
    cihaz
      .eslesme()
      .then((e) => {
        if (!iptal && e === null) setEkran("kurulum");
      })
      .catch(() => {});
    return () => {
      iptal = true;
    };
  }, [cihaz]);

  // Çekmece her kapanışta "Yeni sohbet" notunu da temizler.
  const cekmeceKapat = useCallback(() => {
    setCekmeceAcik(false);
    setYeniSohbetNotu(null);
  }, []);
  const cekmeceAc = useCallback(() => setCekmeceAcik(true), []);
  const sohbeteDon = useCallback(() => setEkran("sohbet"), []);

  // Geri tuşu (Dilim 1 sırası): önce çekmece kapanır, sonra sohbete dönülür; sohbette sistemin işine
  // bırakılır. Eylem menüsü ve diyaloglar kendi `Modal`'larıyla geri tuşunu kendileri karşılar.
  useEffect(() => {
    const abone = BackHandler.addEventListener("hardwareBackPress", () => {
      if (cekmeceAcik) {
        cekmeceKapat();
        return true;
      }
      if (ekran !== "sohbet") {
        setEkran("sohbet");
        return true;
      }
      return false;
    });
    return () => abone.remove();
  }, [cekmeceAcik, ekran, cekmeceKapat]);

  // Menü varsayılan olarak açık çekmecenin üstünde (iç içe Modal) açılır; app/TASARIM.md yolu.
  // Telefonda üst üste binme sorun çıkarırsa (dokunuş, geri tuşu, animasyon) burada önce çekmeceyi
  // kapat: `cekmeceKapat(); setMenuHedefi(id);`.
  const secenekler = useCallback((id: SohbetId) => setMenuHedefi(id), []);
  const menuKapat = useCallback(() => setMenuHedefi(null), []);

  // Çekmece önce kendini kapatır, sonra bunu çağırır.
  const sohbetSec = useCallback(
    (id: SohbetId) => {
      cekirdek.sec(id);
      setEkran("sohbet");
    },
    [cekirdek],
  );

  // Söz döner: Cekmece çözülene dek düğmeyi kapalı tutar (çift dokunuş iki sohbet açmasın).
  // Başarıda çekirdek yeni sohbeti seçer; sohbet ekranı açılır, çekmece kapanır.
  const yeniSohbet = useCallback(async (): Promise<void> => {
    let s: SohbetAcSonucu;
    try {
      s = await cekirdek.sohbetAc();
    } catch {
      s = { ok: false, neden: "depo_hatasi" };
    }
    if (s.ok) {
      setEkran("sohbet");
      cekmeceKapat();
      return;
    }
    setYeniSohbetNotu(SOHBET_AC_RED[s.neden]);
  }, [cekirdek, cekmeceKapat]);

  const sohbetler = useMemo(() => cekmeceSohbetleri(cd), [cd.sohbetler, cd.secili]); // eslint-disable-line react-hooks/exhaustive-deps

  const hat = hatHesapla(cd);
  const surum = cd.sunucu?.servis?.surum;
  const altBilgi = useMemo(() => {
    const a = altBaslikHesapla(cd);
    return {
      metin: cd.sunucu?.servis ? `${a.metin}, servis ${surum ?? "geliştirme"}` : a.metin,
      renk: a.metinRenk ?? a.renk,
    };
  }, [cd, surum]);

  const sol = { simge: "geri" as const, etiket: "Sohbete dön", basinca: sohbeteDon };

  return (
    <OtoIzinBaglami value={otoIzin}>
      <SafeAreaView style={stil.ekran}>
        <View ref={kok} collapsable={false} style={{ flex: 1, paddingBottom: klavye }}>
          <StatusBar style="light" />
          {acilisHatasi && ekran !== "sohbet" && (
            <Text style={[yazi.kucuk, { color: renk.hata, padding: bosluk[3] }]}>
              Yerel kayıt okunamadı. Uygulamayı kapatıp yeniden aç.
            </Text>
          )}
          {ekran === "sohbet" && (
            <View style={{ flex: 1 }}>
              <SohbetEkrani
                key={cd.secili}
                cekirdek={cekirdek}
                sohbet={sohbet}
                cihaz={cihaz}
                onCekmece={cekmeceAc}
                onSecenekler={secenekler}
                onKurulum={() => setEkran("kurulum")}
              />
            </View>
          )}
          {ekran === "durum" && (
            <View style={{ flex: 1 }}>
              <UstCubuk baslik="Durum" sol={sol} hat={hat} />
              <DurumEkrani cekirdek={cekirdek} tanilamaAc={cihaz.desteklenir ? () => void cihaz.tanilamaAc() : undefined} />
            </View>
          )}
          {ekran === "kurulum" && (
            <View style={{ flex: 1 }}>
              <UstCubuk baslik="Kurulum" sol={sol} hat={hat} />
              <KurulumEkrani cihaz={cihaz} cekirdek={cekirdek} />
            </View>
          )}
          <Cekmece
            acik={cekmeceAcik}
            onKapat={cekmeceKapat}
            sohbetler={sohbetler}
            onSohbetSec={sohbetSec}
            onSecenekler={secenekler}
            onYeniSohbet={yeniSohbet}
            yeniSohbetNotu={yeniSohbetNotu}
            onDurum={() => {
              setEkran("durum");
              cekmeceKapat();
            }}
            onKurulum={() => {
              setEkran("kurulum");
              cekmeceKapat();
            }}
            altBilgi={altBilgi}
          />
          <SohbetYonetimi cekirdek={cekirdek} hedef={menuHedefi} onKapat={menuKapat} />
        </View>
      </SafeAreaView>
    </OtoIzinBaglami>
  );
}
