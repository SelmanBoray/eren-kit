import { useEffect } from "react";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import type { TuketimIkilisi, TuketimToplami } from "@eren/protocol";
import type { Cekirdek } from "../cekirdek/index.ts";
import { maliyetMetni, tokenKisalt, toplamToken } from "./tuketimMetni.ts";
import { ASISTAN_ADI } from "../platform/asistanAdi.ts";
import { BolumAdi, Dugme, Serit } from "./Bilesenler.tsx";
import { useCekirdekDurumu } from "./baglam.ts";
import { bosluk, cizgi, olcu, renk, yazi } from "./tema.ts";

const BAGLANTI = {
  kapali: "Kapalı",
  baglaniyor: "Bağlanıyor",
  el_sikisma: "Kimlik doğrulanıyor",
  bagli: "Bağlı",
} as const;

/** Sohbet başına asistan oturumu durumu (`server_status.sohbetler[].eren`). */
const ASISTAN_DURUMU = {
  baslatiliyor: "Başlatılıyor",
  hazir: "Hazır",
  tur_suruyor: "Yanıt yazıyor",
  kapali: "Kapalı",
  uyuyor: "Uyuyor",
  sirada: "Sırada",
} as const;

/** Bu orandan sonra limit değeri dikkat rengiyle gösterilir (TASARIM.md 6.19). */
const LIMIT_ESIGI = 0.9;

const yuzde = (x: number): string => `%${Math.round(x * 100)}`;

/** Servisin ne kadar önce başladığı: "5 dk", "2 sa 5 dk"; bir dakikadan azsa "az önce". */
function gecenSure(baslangicMs: number, simdiMs: number): string {
  const dk = Math.max(0, Math.floor((simdiMs - baslangicMs) / 60000));
  if (dk < 1) return "Servis az önce başladı";
  if (dk < 60) return `Servis ${dk} dk önce başladı`;
  const sa = Math.floor(dk / 60);
  const kalan = dk % 60;
  return kalan === 0 ? `Servis ${sa} sa önce başladı` : `Servis ${sa} sa ${kalan} dk önce başladı`;
}

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

function Ayrac(): ReactNode {
  return <View style={{ height: cizgi.ince, backgroundColor: renk.kenar }} />;
}

/** Ad solda, değer sağda; altında ayraç. `dikkat` değeri uyarı renginde gösterir. */
function Satir(p: { ad: string; deger: string; dikkat?: boolean; alt?: string }): ReactNode {
  return (
    <View>
      <View
        style={{
          minHeight: olcu.dokunma,
          paddingHorizontal: bosluk[4],
          paddingTop: bosluk[2],
          paddingBottom: p.alt === undefined ? bosluk[2] : 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: bosluk[3],
        }}
      >
        <Text style={[yazi.govde, { color: renk.metin }]}>{p.ad}</Text>
        <Text style={[yazi.govdeKalin, { color: p.dikkat === true ? renk.uyari : renk.metin, flexShrink: 1 }]} selectable>
          {p.deger}
        </Text>
      </View>
      {p.alt !== undefined && (
        <View style={{ paddingHorizontal: bosluk[4], paddingBottom: bosluk[2] }}>
          <Text style={[yazi.kucuk, { color: renk.metinIkincil }]} selectable>
            {p.alt}
          </Text>
        </View>
      )}
      <Ayrac />
    </View>
  );
}

/** Bir tüketim toplamının değeri: maliyet varsa "≈ $X · Y token", yoksa "Y token". */
function tuketimDegeri(t: TuketimToplami): string {
  return tuketimDegeriHam(maliyetMetni(t.maliyet_usd), toplamToken(t));
}

function tuketimDegeriHam(maliyet: string | null, token: number): string {
  const y = `${tokenKisalt(token)} token`;
  return maliyet === null ? y : `${maliyet} · ${y}`;
}

function tuketimAlt(t: TuketimToplami): string {
  return `girdi ${tokenKisalt(t.girdi)} · önbellek yazma ${tokenKisalt(t.cache_yazma)} · önbellek okuma ${tokenKisalt(t.cache_okuma)} · çıktı ${tokenKisalt(t.cikti)}`;
}

/** Sohbet + iş toplamı (maliyet, en az birinde varsa toplanır). */
function ikiliToplam(i: TuketimIkilisi): string {
  const a = i.sohbet.maliyet_usd;
  const b = i.is.maliyet_usd;
  const maliyet = a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return tuketimDegeriHam(maliyetMetni(maliyet), toplamToken(i.sohbet) + toplamToken(i.is));
}

/** Satırların altındaki yatay boşluklu not ya da şerit. */
function AltNot(p: { children: ReactNode }): ReactNode {
  return <View style={{ paddingHorizontal: bosluk[4], paddingTop: bosluk[2], gap: bosluk[2] }}>{p.children}</View>;
}

/** `tanilamaAc` verilmezse (modül yok ya da bağlanmamış) Tanılama bölümü görünmez. */
export function DurumEkrani(p: { cekirdek: Cekirdek; tanilamaAc?: () => void }): ReactNode {
  const d = useCekirdekDurumu(p.cekirdek);
  const s = d.sunucu;
  const bes = s?.limit?.bes_saat;
  const hafta = s?.limit?.haftalik;
  const sohbetler = s?.sohbetler ?? [];
  const adlar = new Map(d.sohbetler.map((o) => [o.sohbet_id, o.ad] as const));
  const canli = sohbetler.filter((x) => x.eren === "baslatiliyor" || x.eren === "hazir" || x.eren === "tur_suruyor").length;
  const kapaliVar = sohbetler.some((x) => x.eren === "kapali");
  const siradaVar = sohbetler.some((x) => x.eren === "sirada");
  const limitYuksek = (bes !== undefined && bes >= LIMIT_ESIGI) || (hafta !== undefined && hafta >= LIMIT_ESIGI);
  const cekirdek = p.cekirdek;
  // Ekran açılınca (bağlanınca) bir kez; dönüş değeri yok sayılır.
  useEffect(() => {
    void cekirdek.tuketimIste();
  }, [cekirdek]);
  const tk = d.tuketim;
  const rapor = tk.durum === "yok" ? null : tk.rapor;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: renk.zemin }} contentContainerStyle={{ paddingBottom: bosluk[6] }}>
      <Bolum ad="Bağlantı">
        <Ayrac />
        <Satir ad="Durum" deger={BAGLANTI[d.baglanti]} />
        {d.esitleniyor && <Satir ad="Eşitleme" deger="Eksik olaylar alınıyor" />}
        {d.sonrakiDenemeMs !== null && <Satir ad="Yeniden deneme" deger="Planlandı" />}
        {d.hata !== null && (
          <AltNot>
            <Serit tur="hata" metin={`Hata: ${d.hata}`} />
          </AltNot>
        )}
        <View style={{ paddingHorizontal: bosluk[4], paddingTop: bosluk[4] }}>
          <Dugme yazi="Şimdi bağlan" tur="ikincil" basinca={() => p.cekirdek.simdiBaglan()} />
        </View>
      </Bolum>

      <Bolum ad={ASISTAN_ADI}>
        {s === null ? (
          <View style={{ paddingHorizontal: bosluk[4] }}>
            <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>Bağlantı yok, durum bilinmiyor.</Text>
          </View>
        ) : (
          <>
            <Ayrac />
            <Satir ad="Canlı oturum" deger={String(canli)} />
            <Satir ad="Ekran kilidi (PC)" deger={s.kilitli ? "Kilitli" : "Açık"} />
            <Satir ad="Aktif iş" deger={String(s.aktif_is)} />
            <Satir ad="RAM boş" deger={`${s.ram_bos_mb} / ${s.ram_toplam_mb} MB`} dikkat={s.ram_dusuk} />
            {bes !== undefined && <Satir ad="5 saatlik limit" deger={yuzde(bes)} dikkat={bes >= LIMIT_ESIGI} />}
            {hafta !== undefined && <Satir ad="Haftalık limit" deger={yuzde(hafta)} dikkat={hafta >= LIMIT_ESIGI} />}
            {(s.ram_dusuk || limitYuksek || kapaliVar || siradaVar) && (
              <AltNot>
                {kapaliVar && <Serit tur="uyari" metin={`Bir sohbette ${ASISTAN_ADI} kapalı.`} />}
                {siradaVar && <Serit tur="uyari" metin="Bazı sohbetler sırada: canlı oturum sınırı ya da PC belleği." />}
                {s.ram_dusuk && <Serit tur="uyari" metin="PC'de bellek az." />}
                {limitYuksek && <Serit tur="uyari" metin="Kullanım limiti dolmak üzere." />}
              </AltNot>
            )}
          </>
        )}
      </Bolum>

      <Bolum ad="Tüketim">
        {rapor === null ? (
          <View style={{ paddingHorizontal: bosluk[4] }}>
            <Text style={[yazi.kucuk, { color: renk.metinSonuk }]}>
              {tk.durum === "yok" ? "Henüz ölçüm yok." : tk.durum === "bekleniyor" ? "Yükleniyor…" : "Tüketim alınamadı."}
            </Text>
          </View>
        ) : (
          <>
            {tk.durum === "hata" && (
              <AltNot>
                <Serit tur="uyari" metin="Güncellenemedi; son bilinen değerler." />
              </AltNot>
            )}
            <Ayrac />
            <Satir ad="Bugün · sohbet" deger={tuketimDegeri(rapor.bugun.sohbet)} alt={tuketimAlt(rapor.bugun.sohbet)} />
            <Satir ad="Bugün · iş" deger={tuketimDegeri(rapor.bugun.is)} alt={tuketimAlt(rapor.bugun.is)} />
            <Satir ad="Son 7 gün · sohbet" deger={tuketimDegeri(rapor.son_7_gun.sohbet)} alt={tuketimAlt(rapor.son_7_gun.sohbet)} />
            <Satir ad="Son 7 gün · iş" deger={tuketimDegeri(rapor.son_7_gun.is)} alt={tuketimAlt(rapor.son_7_gun.is)} />
            {(rapor.sohbetler.length > 0 || rapor.silinmis_sohbetler !== undefined) && (
              <>
                <View style={{ paddingTop: bosluk[4], paddingBottom: bosluk[2], paddingHorizontal: bosluk[4] }}>
                  <BolumAdi metin="Sohbet başına" />
                </View>
                <Ayrac />
                {rapor.sohbetler.map((x) => (
                  <Satir key={x.sohbet_id} ad={adlar.get(x.sohbet_id) ?? x.sohbet_id} deger={ikiliToplam(x.toplam)} />
                ))}
                {rapor.silinmis_sohbetler !== undefined && (
                  <Satir ad="Silinmiş sohbetler" deger={ikiliToplam(rapor.silinmis_sohbetler)} />
                )}
              </>
            )}
          </>
        )}
        <AltNot>
          <Text style={[yazi.kucuk, { color: renk.metinIkincil }]}>
            Maliyet, Claude Code'un liste fiyatıyla hesapladığı yaklaşık değerdir; abonelikte ayrıca ödenmez, karşılaştırma içindir.
          </Text>
        </AltNot>
      </Bolum>

      {s !== null && (
        <Bolum ad="Sohbetler">
          <Ayrac />
          {sohbetler.map((x) => (
            <Satir
              key={x.sohbet_id}
              ad={adlar.get(x.sohbet_id) ?? x.sohbet_id}
              deger={ASISTAN_DURUMU[x.eren]}
              dikkat={x.eren === "kapali" || x.eren === "sirada"}
            />
          ))}
        </Bolum>
      )}

      {s !== null && (
        <Bolum ad="Servis">
          <Ayrac />
          {s.servis.surum === null ? (
            <Satir ad="Servis" deger="Geliştirme kopyası" />
          ) : (
            <Satir ad="Servis sürümü" deger={s.servis.surum} />
          )}
          <Satir ad="Başlangıç" deger={gecenSure(s.servis.baslangic_ms, Date.now()).replace(/^Servis /, "")} />
        </Bolum>
      )}

      {p.tanilamaAc !== undefined && (
        <Bolum ad="Tanılama">
          <AltNot>
            <Text style={[yazi.kucuk, { color: renk.metinIkincil }]}>
              Çıkış nedenleri, ANR izleri ve ana iplik takılmaları.
            </Text>
            <Dugme yazi="Tanılamayı aç" tur="ikincil" basinca={p.tanilamaAc} />
          </AltNot>
        </Bolum>
      )}
    </ScrollView>
  );
}
