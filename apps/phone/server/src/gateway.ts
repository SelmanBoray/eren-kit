/**
 * Telefonun bilgisayara tek kapısı: tek port, `/sohbet` ve `/cihaz`. El sıkışma, eşleştirme, `ack`,
 * `seq` telafisi, akış, `server_status`. MODULLER.md, "gateway"; dilim 2 (çoklu sohbet): "Dilim 2" >
 * "Modül maddeleri" > "gateway". `/sohbet` sürümü `SOHBET_SURUMU`'dur (v4: kısayol `baglam`'ı).
 */
import {
  AZAMI_CERCEVE,
  cihazYukariCoz,
  EslestirmeQr,
  kimlikImzaMetni,
  PROTOKOL_SURUMU,
  sha256Hex,
  SOHBET_SINIRLARI,
  SOHBET_SURUMU,
  sohbetYukariCoz,
  utf8Bayt,
} from "@eren/protocol";
import type {
  CihazAsagi,
  CihazYukari,
  HataKodu,
  HataKoduV1,
  Kanal,
  Olay,
  SohbetAsagi,
  SohbetYukari,
} from "@eren/protocol";
import type {
  AckGovdesi,
  ChatClearMesaji,
  ChatCreateMesaji,
  ChatDeleteMesaji,
  ChatRenameMesaji,
  CihazKaydi,
  DogrulanmisCihazBaglantisi,
  DogrulanmisInsanMesaji,
  GatewayFabrikasi,
  InterruptMesaji,
  IptalEt,
  JobCancelMesaji,
  KapatilabilirSunucu,
  LimitDolulugu,
  PairRequestMesaji,
  PlanDecisionMesaji,
  QuestionAnswerMesaji,
  ServerStatusMesaji,
  ServisOlaylari,
  SohbetIslemSonucu,
  Sonuc,
  UserMessageMesaji,
  WsBaglantisi,
} from "./sozlesme.ts";
import { gunSinirlari } from "./tuketim.ts";

const EL_SIKISMA_MS = 10_000;
const ADRES_DENEME_MS = 30_000;
const AZAMI_YANLIS_KOD = 5;
const TELAFI_PARTISI = 200;
/**
 * Eşleşmesi kaldırılan cihazın açık bağlantıları bu aralıkla yoklanır ve kapatılır. Kaldırma ayrı
 * süreçtir (`eslestir --kaldir`), servise ayrı kanal yok: ortak SQLite yeterli (eşleştirme gibi).
 */
const YETKI_YOKLAMA_MS = 2_000;
const IC_HATA_ACK: AckGovdesi = { ok: false, code: "ic_hata" };
const BULUNAMADI_ACK: AckGovdesi = { ok: false, code: "sohbet_bulunamadi" };

type Gelen = SohbetYukari | CihazYukari;
type Hello = Extract<Gelen, { type: "hello" }>;
type KisaIs = UserMessageMesaji | InterruptMesaji | QuestionAnswerMesaji;
type UzunIs = PlanDecisionMesaji | JobCancelMesaji;
/** Kendi işlemlerini açan sohbet işleri: `ackYaz` onlarla aynı işleme alınmaz (aşağıda `sohbetIsiYap`). */
type SohbetIsi = ChatClearMesaji | ChatCreateMesaji | ChatRenameMesaji | ChatDeleteMesaji;
type EslestirmeSonucu = Sonuc<string, "eslestirme_kapali" | "eslestirme_kodu_gecersiz" | "ip_uyusmuyor">;

interface SohbetBaglantisi {
  readonly b: WsBaglantisi;
  readonly device_id: string;
  sonSeq: number;
  /** Telafi kendi sırasıyla yollarken canlı olay araya girmez; sonraki sorgu onu da getirir. */
  olayAcik: boolean;
  /** Telafi bitmeden delta ve durum gitmez: snapshot'ın üstüne oturmayan delta metni bozar. */
  akisAcik: boolean;
}

type Asama =
  | { ad: "hello_bekliyor" }
  | { ad: "yanit_bekliyor"; cihaz: CihazKaydi; client_nonce: string; server_nonce: string; last_seq: number }
  | { ad: "sohbette"; sohbet: SohbetBaglantisi }
  /** `/cihaz` kimliği bitti: sonraki çerçeveler `cihaz` modülünündür. */
  | { ad: "devredildi" }
  | { ad: "kapali" };

/** Kimliği biten bağlantının dayanağı: kayıt silinir ya da anahtarı değişirse yetki kalkar. */
interface Kimlik {
  readonly device_id: string;
  readonly public_key: string;
}

interface Baglanti {
  readonly b: WsBaglantisi;
  readonly kanal: Kanal;
  asama: Asama;
  sureIptal: IptalEt | null;
  /** `auth_response` doğrulanınca dolar (`/sohbet` ve devredilen `/cihaz`); yoklama buna bakar. */
  kimlik: Kimlik | null;
}

const tailscaleAdresiMi = (adres: string): boolean => EslestirmeQr.shape.host.safeParse(adres).success;

const kapanisKodu = (code: HataKodu): number => {
  if (code === "mesaj_cok_buyuk") return 1009;
  if (code === "protokol_uyumsuz") return 1002;
  if (code === "ic_hata") return 1011;
  return 1008;
};

const sonucAck = (s: Sonuc<unknown>): AckGovdesi => (s.ok ? { ok: true } : { ok: false, code: s.code });

/** `chat_create`/`chat_rename`: yan etkisiz `ok`'ta (`seq: null`) `ack`'te `seq` yoktur (protokol `Ack`). */
const islemAck = (s: Sonuc<SohbetIslemSonucu>): AckGovdesi => {
  if (!s.ok) return { ok: false, code: s.code };
  return s.deger.seq === null ? { ok: true } : { ok: true, seq: s.deger.seq };
};

const tamSayi = (n: number): number => Math.max(0, Math.trunc(n));
const oran = (yuzde: number): number => Math.min(1, Math.max(0, yuzde / 100));

function limitKur(d: LimitDolulugu | null): ServerStatusMesaji["limit"] {
  if (d === null || (d.besSaat === null && d.yediGun === null)) return undefined;
  return {
    ...(d.besSaat !== null && {
      bes_saat: oran(d.besSaat.yuzde),
      bes_saat_sifirlanma_ms: tamSayi(d.besSaat.sifirlanmaMs),
    }),
    ...(d.yediGun !== null && {
      haftalik: oran(d.yediGun.yuzde),
      haftalik_sifirlanma_ms: tamSayi(d.yediGun.sifirlanmaMs),
    }),
  };
}

export const gatewayKur: GatewayFabrikasi = ({
  ayar,
  depo,
  sohbetler,
  planlar,
  isler,
  temizlik,
  cihaz,
  kilit,
  sistem,
  ws,
  anahtar,
  rastgele,
  saat,
  zamanlayici,
  veriyolu,
  gunluk,
}) => {
  const baglantilar = new Set<Baglanti>();
  // Kimliği bitmiş `/sohbet` bağlantıları (sohbet yöneticisi `sohbetler` bağımlılığıdır, bu değil).
  const sohbetBaglantilari = new Set<SohbetBaglantisi>();
  // Bitmemiş uzun iş: aynı kimlik `ack` yazılmadan yeniden gelirse ikinci kez işlenmez, sonucu bekler.
  const surenIsler = new Map<string, Set<SohbetBaglantisi>>();
  const veriyoluIptalleri: IptalEt[] = [];
  let calisiyor = false;
  let sunucu: KapatilabilirSunucu | null = null;
  let dinlenenAdres: string | null = null;
  let deneniyor = false;
  let denemeIptal: IptalEt | null = null;
  let sonDoluluk: LimitDolulugu | null = null;
  let yoklamaIptal: IptalEt | null = null;

  // Hata iletisi güvenilmez değer taşıyabilir: yalnız türü yazılır.
  const hataYaz = (olay: string, e: unknown): void => {
    gunluk.hata("gateway", olay, { hata_turu: e instanceof Error ? e.name : typeof e });
  };

  // Sürüm kanal başınadır (genel kural 5): `/sohbet`'te `v` = `sohbetSurumu(type)` (yalnız `pair_result`
  // v1), `/cihaz`'da hep v1. İki ayrı gönderici, tip denetiminin bunu yakalaması içindir: ortak
  // `SohbetAsagi | CihazAsagi` tipinde `/sohbet`'e v1 `auth_challenge` ya da v1 `error` `/cihaz`
  // şemasına uyduğu için derlenirdi.
  const sohbetYolla = (b: WsBaglantisi, m: SohbetAsagi): void => b.gonder(JSON.stringify(m));
  const cihazYolla = (b: WsBaglantisi, m: CihazAsagi): void => b.gonder(JSON.stringify(m));

  const birak = (g: Baglanti): void => {
    if (g.asama.ad === "sohbette") sohbetBaglantilari.delete(g.asama.sohbet);
    g.asama = { ad: "kapali" };
    g.sureIptal?.();
    g.sureIptal = null;
    baglantilar.delete(g);
  };

  const baglantiKapat = (g: Baglanti, kod: number, neden: string): void => {
    birak(g);
    g.b.kapat(kod, neden);
  };

  // Ret kodu v1 kümesindedir: aynı kod `/cihaz`'a da gidebilir, orada `sohbet_mesgul` yoktur.
  const reddet = (g: Baglanti, code: HataKoduV1): void => {
    if (g.asama.ad === "kapali") return;
    gunluk.uyari("gateway", "baglanti_ret", { kanal: g.kanal, code });
    if (g.kanal === "sohbet") sohbetYolla(g.b, { v: SOHBET_SURUMU, type: "error", code });
    else cihazYolla(g.b, { v: PROTOKOL_SURUMU, type: "error", code });
    baglantiKapat(g, kapanisKodu(code), code);
  };

  // Tailscale dışı adres de reddedilir: kayda geçen IP sonraki kimlik denetiminin dayanağıdır.
  const uzakIzinli = (ip: string): boolean =>
    tailscaleAdresiMi(ip) && ip !== dinlenenAdres && ip !== sistem.tailscaleAdresi();

  // Eşleşme hâlâ geçerli mi: kayıt var (iptal süzgeci `depo.cihazGetir`'de) ve anahtar aynı. Kimlik
  // anında okunan kayıt yetmez; kaldırma servisin dışından (ayrı süreç) gelir.
  const yetkiSuruyor = (k: Kimlik): boolean => depo.cihazGetir(k.device_id)?.public_key === k.public_key;

  // Kaldırılan cihazın açık bağlantıları: `/sohbet` (kimlik sonrası) ve `cihaz`'a devredilmiş `/cihaz`.
  // Kapanış mevcut kodla: `error{cihaz_bilinmiyor}` + 1008. Depo hatasında bağlantı bu turda kapanmaz,
  // sonraki tur yeniden dener (gelen her `/sohbet` çerçevesi ayrıca denetlenir, hata orada kapatır).
  const yetkiYokla = (): void => {
    for (const g of [...baglantilar]) {
      if (g.kimlik === null || g.asama.ad === "kapali") continue;
      let suruyor: boolean;
      try {
        suruyor = yetkiSuruyor(g.kimlik);
      } catch (e) {
        hataYaz("yetki_yoklama_hatasi", e);
        continue;
      }
      if (suruyor) continue;
      gunluk.uyari("gateway", "yetki_kalkti", { kanal: g.kanal, device_id: g.kimlik.device_id });
      reddet(g, "cihaz_bilinmiyor");
    }
  };

  // ------------------------------------------------------------------------------------------
  // server_status
  // ------------------------------------------------------------------------------------------

  const durumKur = (): ServerStatusMesaji => {
    const ram = isler.ram();
    return {
      v: SOHBET_SURUMU,
      type: "server_status",
      // Dilim 2: silinmemiş her sohbetin ana oturum durumu, yönetici kurar (`ana` her zaman var); ad yok.
      sohbetler: sohbetler.durumlar(),
      kilitli: kilit.durum().tur !== "serbest",
      aktif_is: tamSayi(isler.aktifSayisi()),
      ram_bos_mb: tamSayi(ram.bosMb),
      ram_toplam_mb: tamSayi(ram.toplamMb),
      ram_dusuk: ram.dusuk,
      // Alan alan kopya: şema katıdır, `ayar.servis`'e eklenen fazla alan bütün durumu geçersiz kılardı.
      servis: { surum: ayar.servis.surum, baslangic_ms: ayar.servis.baslangic_ms },
      limit: limitKur(sonDoluluk),
    };
  };

  const durumYay = (): void => {
    if (sohbetBaglantilari.size === 0) return;
    const metin = JSON.stringify(durumKur());
    for (const s of sohbetBaglantilari) {
      if (s.akisAcik) s.b.gonder(metin);
    }
  };

  // ------------------------------------------------------------------------------------------
  // Olaylar ve telafi
  // ------------------------------------------------------------------------------------------

  const olayYolla = (s: SohbetBaglantisi, olay: Olay): void => {
    if (olay.seq <= s.sonSeq) return;
    sohbetYolla(s.b, { v: SOHBET_SURUMU, type: "event", event: olay });
    s.sonSeq = olay.seq;
  };

  const eksikleriYolla = (s: SohbetBaglantisi): void => {
    s.olayAcik = false;
    for (;;) {
      const parti = depo.olaylariGetir(s.sonSeq, TELAFI_PARTISI);
      if (parti.length === 0) break;
      for (const olay of parti) olayYolla(s, olay);
    }
    s.olayAcik = true;
  };

  // Olay yazan bir dinleyici varsa yeni olay eskisinden önce ulaşabilir. Atlamadan önce boşluk
  // depodan doldurulur, yoksa eski olay `sonSeq` denetimine takılıp telefona hiç gitmezdi.
  const canliOlay = (olay: Olay): void => {
    for (const s of sohbetBaglantilari) {
      if (!s.olayAcik || olay.seq <= s.sonSeq) continue;
      if (olay.seq > s.sonSeq + 1) eksikleriYolla(s);
      olayYolla(s, olay);
    }
  };

  const canliDelta = (d: ServisOlaylari["tur_delta"]): void => {
    const m: SohbetAsagi = {
      v: SOHBET_SURUMU,
      type: "assistant_delta",
      sohbet_id: d.sohbet_id,
      turn_id: d.turn_id,
      offset: d.offset,
      text: d.text,
    };
    const metin = JSON.stringify(m);
    for (const s of sohbetBaglantilari) {
      if (s.akisAcik) s.b.gonder(metin);
    }
  };

  const telafiYap = (s: SohbetBaglantisi, last_seq: number): void => {
    const head_seq = depo.basSeq();
    sohbetYolla(s.b, { v: SOHBET_SURUMU, type: "welcome", head_seq, server_time_ms: saat.simdiMs() });
    // Baştan ileri bir `last_seq` kabul edilseydi bağlantı canlı olayların hepsini atlardı.
    s.sonSeq = Math.min(last_seq, head_seq);
    eksikleriYolla(s);
    // Her canlı tur için (sohbet başına en çok bir) bir snapshot. `aktifTur` tamponu boşaltır: o anda
    // yayınlanan delta dönen metnin içindedir ve `akisAcik` henüz kapalı olduğu için atılır.
    for (const tur of sohbetler.aktifTurlar()) {
      sohbetYolla(s.b, {
        v: SOHBET_SURUMU,
        type: "stream_snapshot",
        sohbet_id: tur.sohbet_id,
        turn_id: tur.turn_id,
        text: tur.text,
      });
    }
    s.akisAcik = true;
    sohbetYolla(s.b, durumKur());
  };

  // ------------------------------------------------------------------------------------------
  // Kimlik
  // ------------------------------------------------------------------------------------------

  const helloAl = (g: Baglanti, m: Hello): void => {
    // Erken: yerel oturum sunucudan imza alamaz, cihaz kaydının varlığını da öğrenemez.
    if (!uzakIzinli(g.b.uzakIp)) return reddet(g, "ip_uyusmuyor");
    const kayit = depo.cihazGetir(m.device_id);
    if (kayit === null) return reddet(g, "cihaz_bilinmiyor");
    if (g.kanal === "cihaz" && kayit.platform === "ipad") return reddet(g, "kanal_desteklenmiyor");

    const server_nonce = Buffer.from(rastgele.baytlar(32)).toString("base64");
    const server_signature = anahtar.imzala(
      kimlikImzaMetni({
        rol: "pc",
        kanal: g.kanal,
        device_id: kayit.device_id,
        client_nonce: m.client_nonce,
        server_nonce,
      }),
    );
    // İmza metninin öneki iki kanalda da v1'dir (`kimlikImzaMetni`); çerçevenin `v`'si kanalınki.
    if (g.kanal === "sohbet") {
      sohbetYolla(g.b, { v: SOHBET_SURUMU, type: "auth_challenge", server_nonce, server_signature });
    } else {
      cihazYolla(g.b, { v: PROTOKOL_SURUMU, type: "auth_challenge", server_nonce, server_signature });
    }
    g.asama = {
      ad: "yanit_bekliyor",
      cihaz: kayit,
      client_nonce: m.client_nonce,
      server_nonce,
      last_seq: "last_seq" in m ? m.last_seq : 0,
    };
  };

  const yanitAl = (g: Baglanti, a: Extract<Asama, { ad: "yanit_bekliyor" }>, signature: string): void => {
    const metin = kimlikImzaMetni({
      rol: "telefon",
      kanal: g.kanal,
      device_id: a.cihaz.device_id,
      client_nonce: a.client_nonce,
      server_nonce: a.server_nonce,
    });
    if (!anahtar.dogrula(a.cihaz.public_key, metin, signature)) return reddet(g, "imza_gecersiz");
    if (g.b.uzakIp !== a.cihaz.tailscale_ip) return reddet(g, "ip_uyusmuyor");
    // `hello` ile `auth_response` arasında (en çok 10 sn) eşleşme kaldırılmış olabilir: kayıt yeniden okunur.
    const kimlik: Kimlik = { device_id: a.cihaz.device_id, public_key: a.cihaz.public_key };
    if (!yetkiSuruyor(kimlik)) return reddet(g, "cihaz_bilinmiyor");

    g.sureIptal?.();
    g.sureIptal = null;
    g.kimlik = kimlik;
    const device_id = a.cihaz.device_id;
    gunluk.bilgi("gateway", "kimlik_tamam", { kanal: g.kanal, device_id });

    if (g.kanal === "cihaz") {
      g.asama = { ad: "devredildi" };
      cihazYolla(g.b, { v: PROTOKOL_SURUMU, type: "welcome", server_time_ms: saat.simdiMs() });
      cihaz.baglandi({ baglanti: g.b, device_id } as DogrulanmisCihazBaglantisi);
      return;
    }
    const sohbet: SohbetBaglantisi = { b: g.b, device_id, sonSeq: 0, olayAcik: false, akisAcik: false };
    g.asama = { ad: "sohbette", sohbet };
    sohbetBaglantilari.add(sohbet);
    telafiYap(sohbet, a.last_seq);
  };

  // ------------------------------------------------------------------------------------------
  // Eşleştirme
  // ------------------------------------------------------------------------------------------

  const eslestir = (uzakIp: string, m: PairRequestMesaji): EslestirmeSonucu =>
    // Tek işlem: `eslestir` komutu aynı dosyaya yazabilir, kod iki bağlantıya birden harcanamaz.
    depo.islem((): EslestirmeSonucu => {
      const kayit = depo.eslestirmeOku();
      if (kayit === null || saat.simdiMs() >= kayit.son_ms) return { ok: false, code: "eslestirme_kapali" };
      if (!anahtar.sabitZamanEsit(sha256Hex(utf8Bayt(m.kod)), kayit.kod_ozeti)) {
        if (kayit.yanlis_deneme + 1 >= AZAMI_YANLIS_KOD) depo.eslestirmeSil();
        else depo.eslestirmeYanlisSay();
        return { ok: false, code: "eslestirme_kodu_gecersiz" };
      }
      depo.eslestirmeSil();
      const device_id = rastgele.opakId("cihaz");
      depo.cihazEkle({
        device_id,
        public_key: m.public_key,
        tailscale_ip: uzakIp,
        platform: m.platform,
        etiket: m.etiket ?? null,
        eslesme_ms: saat.simdiMs(),
      });
      return { ok: true, deger: device_id };
    });

  const eslestirmeAl = (g: Baglanti, m: PairRequestMesaji): void => {
    const sonuc: EslestirmeSonucu = uzakIzinli(g.b.uzakIp)
      ? eslestir(g.b.uzakIp, m)
      : { ok: false, code: "ip_uyusmuyor" };
    if (!sonuc.ok) {
      gunluk.uyari("gateway", "eslestirme_ret", { code: sonuc.code });
      // Eşleştirme `/sohbet`'te de v1'dir: Kotlin `pair_result`'u `v == 1` ve v1 kod kümesiyle doğrular.
      sohbetYolla(g.b, { v: PROTOKOL_SURUMU, type: "pair_result", ok: false, code: sonuc.code });
      baglantiKapat(g, kapanisKodu(sonuc.code), sonuc.code);
      return;
    }
    gunluk.bilgi("gateway", "eslestirme_tamam", { device_id: sonuc.deger, platform: m.platform });
    // Bağlantı açık kalır: telefon aynı el sıkışma süresi içinde `hello` ile sürdürebilir.
    sohbetYolla(g.b, {
      v: PROTOKOL_SURUMU,
      type: "pair_result",
      ok: true,
      device_id: sonuc.deger,
      server_public_key: anahtar.acikAnahtar(),
    });
  };

  // ------------------------------------------------------------------------------------------
  // Kimlik sonrası mesajlar
  // ------------------------------------------------------------------------------------------

  const ackYolla = (b: WsBaglantisi, client_msg_id: string, ack: AckGovdesi): void => {
    sohbetYolla(b, { v: SOHBET_SURUMU, type: "ack", client_msg_id, ...ack });
  };

  // Bilinmeyen ya da silinmiş sohbet: örnek yok, `sohbet_bulunamadi`; insan mesajı hiçbir yere yazılmaz.
  const kisaIsYap = (device_id: string, m: KisaIs): AckGovdesi => {
    switch (m.type) {
      case "user_message": {
        const ornek = sohbetler.konusma({ sohbet_id: m.sohbet_id });
        if (ornek === null) return BULUNAMADI_ACK;
        // `DogrulanmisInsanMesaji` yalnız burada üretilir: kimliği bitmiş `/sohbet` bağlantısı. v4: `baglam`
        // yalnız `input:"kisayol"` ile şemadan geçer (`yalnizKisayolda`); yoksa alan hiç konmaz.
        const { seq } = ornek.insanMesajiAl({
          device_id,
          client_msg_id: m.client_msg_id,
          sohbet_id: m.sohbet_id,
          input: m.input,
          text: m.text,
          ...(m.baglam !== undefined && { baglam: { paket: m.baglam.paket, ad: m.baglam.ad } }),
        } as DogrulanmisInsanMesaji);
        return { ok: true, seq };
      }
      case "interrupt": {
        const ornek = sohbetler.konusma({ sohbet_id: m.sohbet_id });
        if (ornek === null) return BULUNAMADI_ACK;
        return sonucAck(ornek.kes(m.turn_id));
      }
      case "question_answer":
        return sonucAck(isler.soruCevapla(m.soru_id, m.cevap));
    }
  };

  const uzunIsYap = async (m: UzunIs): Promise<AckGovdesi> => {
    if (m.type === "plan_decision") return sonucAck(await planlar.karar(m));
    const sonuc = await isler.durdur(m.is_id, "kullanici");
    if (!sonuc.ok) return sonucAck(sonuc);
    return sonuc.deger.sonuc === "zaten_bitmis" ? { ok: false, code: "is_zaten_bitti" } : { ok: true };
  };

  const ackSakla = (device_id: string, client_msg_id: string, ack: AckGovdesi): void => {
    try {
      depo.ackYaz(device_id, client_msg_id, ack);
    } catch (e) {
      hataYaz("ack_yazilamadi", e);
    }
  };

  // Dördü de eşzamanlıdır ve kendi işlemlerini açar; `ackYaz` onlarla aynı işleme alınmaz:
  // - `gecmisiSil`/`sohbetiSil` işlemden sonra `walDaralt` der; o işlem içinde atar ve WAL'daki
  //   silinmiş sayfalar kalırdı.
  // - `olustur`/`adlandir` işlem bitince örneği kurar ve `sohbet_listesi_degisti` yayınlar; dış işlem
  //   olsaydı durum olaydan önce giderdi, içerideki hata da dış işlemi geri almazdı (iç içe işlem düzdür).
  // `ack`'i yazılamayan istek yeniden gelirse: `chat_clear` ikinci bir mezar taşı yazar (geçmiş zaten
  // boş, zararsız); `chat_create`/`chat_rename` yan etkisiz `ok` alır; `chat_delete` `sohbet_bulunamadi`
  // alır (telefon onu kopunca yeniden yollamaz; yalnız `ackYaz` hatasında olur).
  const sohbetIsiYap = (m: SohbetIsi): AckGovdesi => {
    const sohbet = { sohbet_id: m.sohbet_id };
    switch (m.type) {
      case "chat_clear": {
        const sonuc = temizlik.gecmisiSil(sohbet);
        return sonuc.ok ? { ok: true, seq: sonuc.deger.mezar_seq } : { ok: false, code: sonuc.code };
      }
      case "chat_delete": {
        const sonuc = temizlik.sohbetiSil(sohbet);
        return sonuc.ok ? { ok: true, seq: sonuc.deger.seq } : { ok: false, code: sonuc.code };
      }
      // Ad kullanıcı metnidir: günlüğe yazılmaz, yalnız yöneticiye geçer.
      case "chat_create":
        return islemAck(sohbetler.olustur(sohbet, m.ad));
      case "chat_rename":
        return islemAck(sohbetler.adlandir(sohbet, m.ad));
    }
  };

  const isMesajiAl = (s: SohbetBaglantisi, m: KisaIs | UzunIs | SohbetIsi): void => {
    const { device_id } = s;
    const { client_msg_id } = m;
    const kayitli = depo.ackBul(device_id, client_msg_id);
    if (kayitli !== null) return ackYolla(s.b, client_msg_id, kayitli);

    const kimlik = `${device_id}\n${client_msg_id}`;
    const bekleyenler = surenIsler.get(kimlik);
    if (bekleyenler !== undefined) {
      bekleyenler.add(s);
      return;
    }

    if (m.type === "plan_decision" || m.type === "job_cancel") {
      const yeni = new Set([s]);
      surenIsler.set(kimlik, yeni);
      void uzunIsYap(m)
        .catch((e: unknown): AckGovdesi => {
          hataYaz("is_hatasi", e);
          return IC_HATA_ACK;
        })
        .then((ack) => {
          surenIsler.delete(kimlik);
          ackSakla(device_id, client_msg_id, ack);
          for (const x of yeni) ackYolla(x.b, client_msg_id, ack);
        });
      return;
    }

    if (
      m.type === "chat_clear" ||
      m.type === "chat_create" ||
      m.type === "chat_rename" ||
      m.type === "chat_delete"
    ) {
      let ack: AckGovdesi;
      try {
        ack = sohbetIsiYap(m);
      } catch (e) {
        hataYaz("sohbet_isi_hatasi", e);
        ack = IC_HATA_ACK;
      }
      ackSakla(device_id, client_msg_id, ack);
      // Olay (`chat_cleared`/`chat_created`/`chat_renamed`/`chat_deleted`) `olay_yazildi` ile, yeni
      // `server_status` `sohbet_listesi_degisti` ile işleyici dönmeden yayınlandı: telefon ikisini de
      // `ack`'ten önce alır.
      return ackYolla(s.b, client_msg_id, ack);
    }

    let ack: AckGovdesi;
    try {
      // İş ve `ack` tek işlemde: kabul edilip `ack`'i kaybolan mesaj yeniden gelince ikinci kez işlenirdi.
      ack = depo.islem(() => {
        const sonuc = kisaIsYap(device_id, m);
        depo.ackYaz(device_id, client_msg_id, sonuc);
        return sonuc;
      });
    } catch (e) {
      hataYaz("is_hatasi", e);
      ack = IC_HATA_ACK;
      ackSakla(device_id, client_msg_id, ack);
    }
    ackYolla(s.b, client_msg_id, ack);
  };

  // Salt okunur istek-yanıt çifti: `ack` yok, `client_msg_id` yok, tekilleştirme defterine girmez. Hata
  // bağlantıyı kapatmaz ve çerçeve göndermez; yalnız günlüğe yazılır.
  const tuketimYanitla = (b: WsBaglantisi, istek_id: string): void => {
    try {
      const simdi = saat.simdiMs();
      const gun = gunSinirlari(simdi);
      const ozet = depo.tuketimOzeti({ ...gun, isAdet: SOHBET_SINIRLARI.TUKETIM_IS_ADET });
      sohbetYolla(b, {
        v: SOHBET_SURUMU,
        type: "usage_report",
        istek_id,
        olcum_ms: simdi,
        gun_baslangic_ms: gun.gunBaslangicMs,
        ...ozet,
      });
    } catch (e) {
      hataYaz("tuketim_hatasi", e);
    }
  };

  // ------------------------------------------------------------------------------------------
  // Çerçeve
  // ------------------------------------------------------------------------------------------

  const cerceveIsle = (g: Baglanti, ham: string): void => {
    const sonuc = g.kanal === "sohbet" ? sohbetYukariCoz(ham) : cihazYukariCoz(ham);
    const asama = g.asama;
    if (!sonuc.ok) {
      gunluk.uyari("gateway", "cozum_hatasi", { kanal: g.kanal, code: sonuc.kod, yollar: sonuc.yollar.join(",") });
      if (asama.ad === "sohbette" && sonuc.kod === "gecersiz_mesaj") {
        // `sohbette` yalnız `/sohbet` bağlantısında olur.
        sohbetYolla(g.b, { v: SOHBET_SURUMU, type: "error", code: sonuc.kod });
      } else {
        reddet(g, sonuc.kod);
      }
      return;
    }
    const m = sonuc.mesaj;
    switch (asama.ad) {
      case "hello_bekliyor":
        if (m.type === "hello") return helloAl(g, m);
        if (m.type === "pair_request") return eslestirmeAl(g, m);
        return reddet(g, "yetkisiz");
      case "yanit_bekliyor":
        if (m.type === "auth_response") return yanitAl(g, asama, m.signature);
        return reddet(g, "yetkisiz");
      case "sohbette":
        // Kimlik sonrası her çerçeve: kaldırılan cihazın oturumu yoklamayı beklemeden ilk çerçevede kapanır.
        if (g.kimlik === null || !yetkiSuruyor(g.kimlik)) return reddet(g, "cihaz_bilinmiyor");
        switch (m.type) {
          case "user_message":
          case "interrupt":
          case "plan_decision":
          case "question_answer":
          case "job_cancel":
          case "chat_clear":
          case "chat_create":
          case "chat_rename":
          case "chat_delete":
            return isMesajiAl(asama.sohbet, m);
          case "usage_request":
            return tuketimYanitla(asama.sohbet.b, m.istek_id);
          default:
            return reddet(g, "yetkisiz");
        }
      case "devredildi":
      case "kapali":
        return;
    }
  };

  const baglantiAl = (b: WsBaglantisi): void => {
    if (!calisiyor) {
      b.kapat(1001, "kapaniyor");
      return;
    }
    const g: Baglanti = {
      b,
      kanal: b.yol === "/sohbet" ? "sohbet" : "cihaz",
      asama: { ad: "hello_bekliyor" },
      sureIptal: null,
      kimlik: null,
    };
    baglantilar.add(g);
    g.sureIptal = zamanlayici.sonra(EL_SIKISMA_MS, () => reddet(g, "zaman_asimi"));
    b.kapanisDinle(() => birak(g));
    b.mesajDinle((ham) => {
      if (g.asama.ad === "kapali" || g.asama.ad === "devredildi") return;
      try {
        cerceveIsle(g, ham);
      } catch (e) {
        hataYaz("cerceve_hatasi", e);
        reddet(g, "ic_hata");
      }
    });
  };

  // ------------------------------------------------------------------------------------------
  // Dinleme
  // ------------------------------------------------------------------------------------------

  const dinlemeyiDene = async (): Promise<void> => {
    if (!calisiyor || sunucu !== null || deneniyor) return;
    deneniyor = true;
    try {
      const adres = sistem.tailscaleAdresi();
      if (adres === null || !tailscaleAdresiMi(adres)) return;
      const yeni = await ws.dinle({
        host: adres,
        port: ayar.wsPort,
        azamiCerceve: { "/sohbet": AZAMI_CERCEVE.SOHBET, "/cihaz": AZAMI_CERCEVE.CIHAZ },
        baglanti: baglantiAl,
      });
      if (!calisiyor) {
        await yeni.kapat();
        return;
      }
      sunucu = yeni;
      dinlenenAdres = adres;
      denemeIptal?.();
      denemeIptal = null;
      gunluk.bilgi("gateway", "dinliyor", { port: ayar.wsPort });
    } catch (e) {
      hataYaz("dinleme_hatasi", e);
    } finally {
      deneniyor = false;
    }
  };

  return {
    baslat: async () => {
      if (calisiyor) return;
      calisiyor = true;
      veriyoluIptalleri.push(
        veriyolu.dinle("olay_yazildi", ({ olay }) => canliOlay(olay)),
        veriyolu.dinle("tur_delta", canliDelta),
        veriyolu.dinle("eren_durumu", durumYay),
        veriyolu.dinle("kilit_degisti", durumYay),
        veriyolu.dinle("is_sayisi_degisti", durumYay),
        veriyolu.dinle("ram_degisti", durumYay),
        veriyolu.dinle("sohbet_listesi_degisti", durumYay),
        veriyolu.dinle("limit_dolulugu", ({ doluluk }) => {
          sonDoluluk = doluluk;
        }),
      );
      yoklamaIptal = zamanlayici.herAralik(YETKI_YOKLAMA_MS, yetkiYokla);
      await dinlemeyiDene();
      if (calisiyor && sunucu === null) {
        gunluk.uyari("gateway", "dinlemiyor", { yeniden_deneme_ms: ADRES_DENEME_MS });
        denemeIptal = zamanlayici.herAralik(ADRES_DENEME_MS, () => void dinlemeyiDene());
      }
    },
    kapat: async () => {
      calisiyor = false;
      denemeIptal?.();
      denemeIptal = null;
      yoklamaIptal?.();
      yoklamaIptal = null;
      for (const iptal of veriyoluIptalleri.splice(0)) iptal();
      for (const g of [...baglantilar]) baglantiKapat(g, 1001, "kapaniyor");
      const eski = sunucu;
      sunucu = null;
      dinlenenAdres = null;
      await eski?.kapat();
    },
  };
};
