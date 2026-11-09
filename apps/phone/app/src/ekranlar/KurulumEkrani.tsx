import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import type { AyarHedefi, CihazDurumu } from "../../modules/eren-device/src/ErenDevice.types.ts";
import type { Cekirdek } from "../cekirdek/index.ts";
import type { ErenCihaz } from "../cihaz/erenDevice.ts";
import { ASISTAN_ADI } from "../platform/asistanAdi.ts";
import { BolumAdi, Dugme, DurumEtiketi, Serit } from "./Bilesenler.tsx";
import { bosluk, cizgi, olcu, renk, yazi } from "./tema.ts";

const AYARLAR: { hedef: AyarHedefi; ad: string; tamam: (d: CihazDurumu) => boolean }[] = [
  { hedef: "pil", ad: "Pil kısıtlaması muafiyeti", tamam: (d) => d.pil_muaf },
  { hedef: "bildirim", ad: "Bildirim izni", tamam: (d) => d.bildirim_izni },
  { hedef: "vpn", ad: "VPN (Tailscale) açık", tamam: (d) => d.vpn_aktif },
];

/** Bölüm başlığı: üstü 24, altı 8 (TASARIM.md 6.19). */
function Bolum(p: { ad: string; children?: ReactNode }): ReactNode {
  return (
    <View>
      <View style={{ paddingTop: bosluk[6], paddingBottom: bosluk[2], paddingHorizontal: bosluk[4] }}>
        <BolumAdi metin={p.ad} />
      </View>
      {p.children}
    </View>
  );
}

type Etiket = { metin: string; renkAdi: "basari" | "hata" | "uyari" | "metinSonuk" };

const KURULUM_ACIKLAMA =
  "PC'de node kurulum/telefon.ts çalıştır (telefon USB ile bağlı; \"USB hata ayıklama\" ve \"USB hata ayıklama (Güvenlik ayarları)\" açık olmalı).";

function Satir(p: { ad: string; etiket?: Etiket; aciklama?: string; dugme?: ReactNode }): ReactNode {
  return (
    <View>
      <View
        style={{
          paddingHorizontal: bosluk[4],
          minHeight: olcu.dokunma + bosluk[4],
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: bosluk[3],
          paddingVertical: bosluk[2],
        }}
      >
        <View style={{ flex: 1, gap: bosluk[1] }}>
          <Text style={[yazi.govde, { color: renk.metin }]}>{p.ad}</Text>
          {p.etiket !== undefined && <DurumEtiketi metin={p.etiket.metin} renkAdi={p.etiket.renkAdi} />}
          {p.aciklama !== undefined && <Text style={[yazi.kucuk, { color: renk.metinIkincil }]}>{p.aciklama}</Text>}
        </View>
        {p.dugme}
      </View>
      <View style={{ height: cizgi.ince, backgroundColor: renk.kenar }} />
    </View>
  );
}

export function KurulumEkrani(p: { cihaz: ErenCihaz; cekirdek: Cekirdek }): ReactNode {
  const { cihaz, cekirdek } = p;
  const [durum, setDurum] = useState<CihazDurumu | null>(null);
  const [not, setNot] = useState<string | null>(null);

  const yenile = useCallback(async (): Promise<void> => {
    const r = await cihaz.durum();
    setDurum(r.ok ? r.deger : null);
  }, [cihaz]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  const eslestir = async (): Promise<void> => {
    const r = await cihaz.eslestir();
    if (!r.ok) {
      setNot(r.neden === "desteklenmiyor" ? "Bu cihazda eşleşme desteklenmiyor." : "Eşleşme başlatılamadı.");
      return;
    }
    setNot(r.deger.sonuc === "tamam" ? "Eşleşildi." : r.deger.sonuc === "iptal" ? "Eşleşme iptal edildi." : "Eşleşme başarısız.");
    await yenile();
    if (r.deger.sonuc === "tamam") cekirdek.simdiBaglan();
  };

  const ayar = async (h: AyarHedefi): Promise<void> => {
    await cihaz.ayarAc(h);
    // Ayar ekranından dönüşte durum değişmiş olabilir; kısa gecikmeyle yeniden oku.
    setTimeout(() => void yenile(), 1500);
  };

  const [yetkiNotu, setYetkiNotu] = useState<string | null>(null);
  const [kisayolNotu, setKisayolNotu] = useState<string | null>(null);

  const tamYetkiAc = async (): Promise<void> => {
    const r = await cihaz.tamYetkiAc();
    setYetkiNotu(
      !r.ok
        ? "Tam yetki açılamadı."
        : r.deger === "acildi"
          ? "Tam yetki açıldı."
          : "Tam yetki açılmadı (iptal edildi).",
    );
    await yenile();
  };

  const tamYetkiKapat = async (): Promise<void> => {
    const r = await cihaz.tamYetkiKapat();
    setYetkiNotu(r.ok ? "Tam yetki kapatıldı." : "Tam yetki kapatılamadı.");
    await yenile();
  };

  const sesKisayoluKur = async (): Promise<void> => {
    const r = await cihaz.sesKisayoluKur();
    if (!r.ok || r.deger === "hata") {
      setKisayolNotu(
        "Kısayol kurulamadı. Ayarlar > Erişilebilirlik > Erişilebilirlik kısayolundan elle \"Ses tuşu kısayolu\" seçebilirsin.",
      );
    } else if (r.deger === "yetki_yok") {
      setKisayolNotu("Kurulum adımı eksik: telefonu USB ile bağlayıp `node kurulum/telefon.ts` çalıştır.");
    } else {
      setKisayolNotu("Kısayol kuruldu. İlk kullanımda telefon bir kez onay isteyebilir.");
    }
    await yenile();
  };

  const [ekranNotu, setEkranNotu] = useState<string | null>(null);

  const ekranAc = async (hangisi: "uygulamalar" | "denetim"): Promise<void> => {
    const r = hangisi === "uygulamalar" ? await cihaz.uygulamaListesiAc() : await cihaz.denetimAc();
    if (r.ok) {
      setEkranNotu(null);
      return;
    }
    setEkranNotu(r.neden === "desteklenmiyor" ? "Bu cihazda bu ekran desteklenmiyor." : "Ekran açılamadı.");
  };

  const eslesmis = durum?.eslesmis === true;
  const yatay = { paddingHorizontal: bosluk[4] } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: renk.zemin }}
      contentContainerStyle={{ paddingBottom: bosluk[6] }}
    >
      {!cihaz.desteklenir && (
        <View style={{ ...yatay, paddingTop: bosluk[4] }}>
          <Serit tur="uyari" metin="Bu cihazda yerel modül yok (iPad ya da geliştirme). Kurulum adımları çalışmaz." />
        </View>
      )}

      <Bolum ad="Eşleşme">
        <View style={{ ...yatay, gap: bosluk[2], paddingBottom: bosluk[2] }}>
          <DurumEtiketi
            metin={eslesmis ? "PC ile eşleşilmiş" : "Eşleşme yok"}
            renkAdi={eslesmis ? "basari" : "hata"}
          />
          {!eslesmis && (
            <Text style={[yazi.kucuk, { color: renk.metinIkincil }]}>
              PC'de <Text style={[yazi.kod, { color: renk.metin }]}>eren eslestir</Text> çalıştır, sonra aşağıdaki düğmeye bas.
            </Text>
          )}
          <Dugme yazi="Eşleştir" kapali={!cihaz.desteklenir} basinca={() => void eslestir()} />
          {not !== null && <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>{not}</Text>}
        </View>
      </Bolum>

      <Bolum ad="Tam yetki">
        <View style={{ height: cizgi.ince, backgroundColor: renk.kenar }} />
        <Satir
          ad="Tam yetki"
          etiket={
            durum === null
              ? { metin: "Bilinmiyor", renkAdi: "metinSonuk" }
              : durum.tam_yetki
                ? { metin: "Açık", renkAdi: "uyari" }
                : { metin: "Kapalı", renkAdi: "metinSonuk" }
          }
          aciklama={`Açıkken ${ASISTAN_ADI} telefonda onay sormadan okur, yazar, gönderir. Banka/hassas uygulamalar, Ayarlar ve parola alanları yine yasak; kalıcı bildirimdeki Durdur o anki işleri keser ve tam yetkiyi de kapatır; yeniden açmak için buradan Aç (kimlik doğrulama).`}
          dugme={
            durum?.tam_yetki === true ? (
              <Dugme yazi="Kapat" tur="ikincil" kapali={!cihaz.desteklenir} basinca={() => void tamYetkiKapat()} />
            ) : (
              <Dugme yazi="Aç" tur="ikincil" kapali={!cihaz.desteklenir || durum === null} basinca={() => void tamYetkiAc()} />
            )
          }
        />
        {yetkiNotu !== null && (
          <View style={{ ...yatay, paddingTop: bosluk[2] }}>
            <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>{yetkiNotu}</Text>
          </View>
        )}
      </Bolum>

      <Bolum ad="Uygulamalar ve denetim">
        <View style={{ height: cizgi.ince, backgroundColor: renk.kenar }} />
        <Satir
          ad="Uygulamalar"
          aciklama={`${ASISTAN_ADI} telefonda hangi uygulamaları kullanabilir, seç; yeni uygulamalar sen seçene kadar kapalı kalır.`}
          dugme={<Dugme yazi="Uygulamalar" tur="ikincil" kapali={!cihaz.desteklenir} basinca={() => void ekranAc("uygulamalar")} />}
        />
        <Satir
          ad="Denetim günlüğü"
          aciklama={`${ASISTAN_ADI} telefonda ne yaptı, kaydı.`}
          dugme={<Dugme yazi="Denetim günlüğü" tur="ikincil" kapali={!cihaz.desteklenir} basinca={() => void ekranAc("denetim")} />}
        />
        {ekranNotu !== null && (
          <View style={{ ...yatay, paddingTop: bosluk[2] }}>
            <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>{ekranNotu}</Text>
          </View>
        )}
      </Bolum>

      <Bolum ad="Telefon ayarları">
        <View style={{ height: cizgi.ince, backgroundColor: renk.kenar }} />
        <Satir
          ad="Erişilebilirlik servisi"
          etiket={
            durum === null
              ? { metin: "Bilinmiyor", renkAdi: "metinSonuk" }
              : durum.erisim_yetkisi
                ? { metin: "Hazır (iş varken açılır)", renkAdi: "basari" }
                : durum.a11y
                  ? { metin: "Elle açık", renkAdi: "uyari" }
                  : { metin: "Kurulum adımı eksik", renkAdi: "uyari" }
          }
          aciklama={
            durum !== null && !durum.erisim_yetkisi
              ? `${KURULUM_ACIKLAMA} Ya da Ayarlar'dan elle aç.`
              : undefined
          }
          dugme={
            durum !== null && durum.erisim_yetkisi ? undefined : (
              <Dugme yazi="Aç" tur="ikincil" kapali={!cihaz.desteklenir} basinca={() => void ayar("erisilebilirlik")} />
            )
          }
        />
        <Satir
          ad="Kullanım erişimi"
          etiket={
            durum === null
              ? { metin: "Bilinmiyor", renkAdi: "metinSonuk" }
              : durum.kullanim_erisimi
                ? { metin: "Hazır", renkAdi: "basari" }
                : { metin: "Kurulum adımı eksik", renkAdi: "uyari" }
          }
          aciklama={
            durum !== null && !durum.kullanim_erisimi
              ? `Kısayolda ön plandaki uygulamayı görmek için gerekir. ${KURULUM_ACIKLAMA}`
              : "Kısayolda ön plandaki uygulamayı görmek için."
          }
        />
        <Satir
          ad="Ses tuşu kısayolu"
          etiket={
            durum === null
              ? { metin: "Bilinmiyor", renkAdi: "metinSonuk" }
              : durum.ses_kisayolu
                ? { metin: "Kurulu", renkAdi: "basari" }
                : { metin: "Kurulu değil", renkAdi: "uyari" }
          }
          aciklama={`Ses açma ve kısma tuşlarını birlikte yaklaşık 3 saniye basılı tut: ${ASISTAN_ADI} dinlemeye başlar, baktığın uygulamayı bağlam olarak alır.`}
          dugme={<Dugme yazi="Kur" tur="ikincil" kapali={!cihaz.desteklenir} basinca={() => void sesKisayoluKur()} />}
        />
        {kisayolNotu !== null && <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>{kisayolNotu}</Text>}
        {AYARLAR.map((a) => {
          const tamam = durum === null ? null : a.tamam(durum);
          return (
            <View key={a.hedef}>
              <View
                style={{
                  ...yatay,
                  minHeight: olcu.dokunma + bosluk[4],
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: bosluk[3],
                  paddingVertical: bosluk[2],
                }}
              >
                <View style={{ flex: 1, gap: bosluk[1] }}>
                  <Text style={[yazi.govde, { color: renk.metin }]}>{a.ad}</Text>
                  <DurumEtiketi
                    metin={tamam === null ? "Bilinmiyor" : tamam ? "Açık" : "Kapalı"}
                    renkAdi={tamam === null ? "metinSonuk" : tamam ? "basari" : "hata"}
                  />
                </View>
                <Dugme yazi="Aç" tur="ikincil" kapali={!cihaz.desteklenir} basinca={() => void ayar(a.hedef)} />
              </View>
              <View style={{ height: cizgi.ince, backgroundColor: renk.kenar }} />
            </View>
          );
        })}
        <View style={{ ...yatay, paddingTop: bosluk[4], gap: bosluk[2] }}>
          <Dugme yazi="Durumu yenile" tur="ikincil" basinca={() => void yenile()} />
        </View>
      </Bolum>
    </ScrollView>
  );
}
