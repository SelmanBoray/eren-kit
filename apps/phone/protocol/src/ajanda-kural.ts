import {
  AJANDA_RET_NEDENLERI,
  type AjandaKaydi,
  type AjandaRetNedeni,
  type AjandaRevIzi,
  ajandaRetGeciciMi,
  hatirlatmaEtkinMi,
  type KayitDurumu,
  kullaniciEmriMi,
  type KaynakYolu,
  type TurKokeni,
} from "./ajanda.ts";
import { type AjandaZamani, type GunBolumu, gunHatirlatmaSaati, gunNoTarih, ornekGunuMu, tarihGunNo, tekrarOrnekleri } from "./ajanda-zaman.ts";
import { AJANDA_SINIRLARI } from "./sinirlar.ts";

/**
 * Ajandanın servis ve uygulamada aynı sonucu vermesi gereken saf kararları: hangi hatırlatmanın
 * kurulacağı (saatsiz gün kaydının gün hatırlatması dahil), tekilleştirme, telafi kipi, modelin
 * "şimdi" dayanağı ve gece aralığı, örnek durumu. Saat dilimi
 * veritabanı kullanılmaz: duvar saatinden ana çeviri çağırandan gelir (`AnCevirici`; uygulamada
 * java.time `ZonedDateTime.of`, serviste aynı kural). Vektörler sabit ofsetli dilimlerle sınar.
 */

/** Yerel duvar saatini (`tarih`, `saat`, IANA dilimi) epoch milisaniyesine çevirir. */
export type AnCevirici = (tarih: string, saat: string, saat_dilimi: string) => number;

const DAKIKA_MS = 60_000;
const GUN_MS = 86_400_000;
const GUN_DK = 1_440;

/** Gün hatırlatmasının yerel tetik günü ve saati (kaydın diliminde). */
export type GunHatirlatmasiYereli = { tarih: string; saat: string };

/**
 * Bir hatırlatmanın şimdiye göre hali: kurulur (tetik gelecekte), saatsiz (bekler), geçmiş (çalmaz).
 * `gun_hatirlatmasi` yalnız saatsiz gün kaydındaki `once`'ta vardır: tetiğin yerel günü ve saati
 * (tekrarda geçmiş halde yoktur, çünkü tek bir gün yoktur).
 */
export type HatirlatmaHali =
  | { sira: number; hal: "kurulur"; tetik_ms: number; ornek_tarihi?: string; gun_hatirlatmasi?: GunHatirlatmasiYereli }
  | { sira: number; hal: "saatsiz" }
  | { sira: number; hal: "gecmis"; gun_hatirlatmasi?: GunHatirlatmasiYereli };

/**
 * Saatsiz gün kaydında `once{dk}`'nin yerel tetiği (v2): `gun`'den ⌊dk / 1440⌋ gün önce, gün bölümünün
 * saatinde (`gunHatirlatmaSaati`). Gün içi öne alış (dk < 1440) saat olmadığı için anlamsızdır ve
 * aynı güne düşer: kayıtta saat uydurulmaz, hatırlatma günün kendisine bağlanır. Gün sayısı kadar öne
 * alış ("bir gün önce") korunur.
 */
export function gunHatirlatmasiYereli(gun: string, dk: number, gun_bolumu?: GunBolumu | undefined): GunHatirlatmasiYereli {
  return { tarih: gunNoTarih(tarihGunNo(gun) - Math.floor(dk / GUN_DK)), saat: gunHatirlatmaSaati(gun_bolumu) };
}

type OnceZamani = Extract<AjandaZamani, { kesinlik: "an" | "gun" }>;

/** `once{dk}`'nin `gun` günündeki örnek için tetiği; saatsiz gün kaydında yerel hali de. */
function onceTetigi(
  z: OnceZamani,
  gun: string,
  dk: number,
  anCevir: AnCevirici,
): { tetik_ms: number; gun_hatirlatmasi?: GunHatirlatmasiYereli } {
  if (z.kesinlik === "an") return { tetik_ms: anCevir(gun, z.saat, z.saat_dilimi) - dk * DAKIKA_MS };
  const y = gunHatirlatmasiYereli(gun, dk, z.gun_bolumu);
  return { tetik_ms: anCevir(y.tarih, y.saat, z.saat_dilimi), gun_hatirlatmasi: y };
}

/** `once` hatırlatmasının çalabildiği zaman: `an` ya da (v2) `gun`. Ötekilerde bekler. */
function onceZamani(kayit: AjandaKaydi): OnceZamani | undefined {
  const z = kayit.zaman;
  return z !== undefined && (z.kesinlik === "an" || z.kesinlik === "gun") ? z : undefined;
}

/**
 * Tekrar taramasının alt günü: tetiği `altMs`'den sonra olabilecek ilk örnek bundan önce olamaz
 * (örnek günü tetiğin gününden önce değildir; dilim ofseti ve gün saati için 3 gün pay). Pay sonucu
 * değiştirmez, yalnız taramayı kısaltır.
 */
function taramaAlti(altMs: number): string | undefined {
  return gunAlti(Math.floor(altMs / GUN_MS) - 3);
}

function seriSonrakiTetik(
  kayit: AjandaKaydi,
  dk: number,
  simdiMs: number,
  anCevir: AnCevirici,
): { tetik_ms: number; ornek_tarihi: string; gun_hatirlatmasi?: GunHatirlatmasiYereli } | undefined {
  const z = onceZamani(kayit);
  if (z === undefined || kayit.tekrar === undefined) return undefined;
  const kapali = new Set(kayit.ornekler.map((o) => o.tarih));
  for (const gun of tekrarOrnekleri(z.tarih, kayit.tekrar, taramaAlti(simdiMs))) {
    if (kapali.has(gun)) continue;
    const t = onceTetigi(z, gun, dk, anCevir);
    if (t.tetik_ms > simdiMs) return { tetik_ms: t.tetik_ms, ornek_tarihi: gun, ...(t.gun_hatirlatmasi && { gun_hatirlatmasi: t.gun_hatirlatmasi }) };
  }
  return undefined;
}

/**
 * Kaydın her hatırlatmasının şimdiye göre hali (etkinlikten bağımsız). Kural tek anlamlıdır:
 * - `mutlak`: tetik kendi anı; tetik > şimdi ise kurulur, değilse geçmiş (bir kez, tekrarda da).
 * - `once`, zaman `an`: tetik = olayın anı − dk.
 * - `once`, zaman `gun` (v2, gün hatırlatması): tetik = `gunHatirlatmasiYereli(gün, dk, gun_bolumu)`
 *   yerel anı, kaydın diliminde; hal `gun_hatirlatmasi`'nı taşır. Kayıt saatsiz kalır.
 * - `once`, zaman `donem`, `belirsiz` ya da yok: saatsiz, bekler.
 * - Tekrarsızda tetik > şimdi ise kurulur, değilse geçmiş. Tekrarlıda `ornekler`'de kapalı olmayan,
 *   tetiği şimdiden sonraki ilk örnek (`ornek_tarihi`); yoksa geçmiş.
 * Hatırlatma kaydın zamanından her çağrıda yeniden hesaplanır: gün ya da gün bölümü değişince yeni
 * güne gider, saat gelince saatli kurala, saat kalkınca gün hatırlatmasına döner.
 * `gecmis` kurulmaz. Kurulmuş ama teslim edilmemiş bir alarmın tetiği geçtiyse (telefon kapalıydı,
 * yeniden başladı, kurulum tam o anda yenilendi) onu `kacirilanHatirlatmalar` söyler; hiç kurulmamış
 * (doğduğunda ya da değiştiğinde tetiği zaten geçmiş: öğleden sonra eklenen "bugün"ün 09:00'u) hiç çalmaz.
 */
export function hatirlatmaHalleri(kayit: AjandaKaydi, simdiMs: number, anCevir: AnCevirici): HatirlatmaHali[] {
  return kayit.hatirlatmalar.map((h, sira): HatirlatmaHali => {
    if (h.tur === "mutlak") {
      const tetik = anCevir(h.tarih, h.saat, h.saat_dilimi);
      return tetik > simdiMs ? { sira, hal: "kurulur", tetik_ms: tetik } : { sira, hal: "gecmis" };
    }
    const z = onceZamani(kayit);
    if (z === undefined) return { sira, hal: "saatsiz" };
    if (kayit.tekrar !== undefined) {
      const s = seriSonrakiTetik(kayit, h.dk, simdiMs, anCevir);
      return s === undefined ? { sira, hal: "gecmis" } : { sira, hal: "kurulur", ...s };
    }
    const t = onceTetigi(z, z.tarih, h.dk, anCevir);
    const yerel = t.gun_hatirlatmasi === undefined ? {} : { gun_hatirlatmasi: t.gun_hatirlatmasi };
    return t.tetik_ms > simdiMs ? { sira, hal: "kurulur", tetik_ms: t.tetik_ms, ...yerel } : { sira, hal: "gecmis", ...yerel };
  });
}

/**
 * Uygulamanın kurduğu alarmlar: `hatirlatmaEtkinMi` doğruysa `kurulur` halindekiler, değilse hiçbiri.
 * Uygulama her kayıt değişikliğinde, tam eşitlemenin sonunda, açılışta, yeniden başlatmada ve saat ya
 * da dilim değişiminde kaydın alarmlarını bununla yeniden kurar; tekrarda bir örnek çalınca sıradakine
 * geçer. Alarmın kimliği `(kayit_id, tetik_ms)`'dir (aynı tetikli iki hatırlatma tek bildirim); uygulama
 * kurduğu kimlikleri teslim edilene dek kalıcı saklar (`kacirilanHatirlatmalar`).
 */
export function kurulacakHatirlatmalar(
  kayit: AjandaKaydi,
  simdiMs: number,
  anCevir: AnCevirici,
): Extract<HatirlatmaHali, { hal: "kurulur" }>[] {
  if (!hatirlatmaEtkinMi(kayit)) return [];
  return hatirlatmaHalleri(kayit, simdiMs, anCevir).filter((h) => h.hal === "kurulur");
}

export type KacirilanHatirlatma = { sira: number; tetik_ms: number; ornek_tarihi?: string };

/**
 * Kaçırılan hatırlatmalar: tetiği `(şimdi − KACIRILAN_PENCERE_DK, şimdi]` içinde olan ve `kurulanlar`da
 * bulunan (uygulamanın bu kayıt için kurup henüz teslim etmediği alarmların `tetik_ms`'i) her tetik;
 * `hatirlatmaEtkinMi` yanlışsa hiçbiri. Tekrarda kapalı örnek atlanır, pencereye düşen her örnek ayrı
 * satırdır. Uygulama yeniden kurulumda (açılış, yeniden başlatma, kayıt değişikliği, tam eşitlemenin
 * sonu) bunları hemen bir kez gösterir (birden çoksa tek özet bildirimde), teslim edildi işaretler;
 * pencereden eski ya da artık kayıtta olmayan kurulu kimlikleri sessizce siler. Böylece yeniden
 * kurulumda bildirim yağmuru olmaz, hiç kurulmamış geçmiş hatırlatma çalmaz, kurulmuş olan kaybolmaz.
 * `şimdi`den sonraki tetik `kurulacakHatirlatmalar`'ındır: iki işlev aynı tetiği iki kez vermez.
 */
export function kacirilanHatirlatmalar(
  kayit: AjandaKaydi,
  simdiMs: number,
  anCevir: AnCevirici,
  kurulanlar: readonly number[],
): KacirilanHatirlatma[] {
  if (!hatirlatmaEtkinMi(kayit) || kurulanlar.length === 0) return [];
  const kurulu = new Set(kurulanlar);
  const altMs = simdiMs - AJANDA_SINIRLARI.KACIRILAN_PENCERE_DK * DAKIKA_MS;
  const sonuc: KacirilanHatirlatma[] = [];
  const dene = (sira: number, tetik_ms: number, ornek_tarihi?: string) => {
    if (tetik_ms <= altMs || tetik_ms > simdiMs || !kurulu.has(tetik_ms)) return;
    sonuc.push(ornek_tarihi === undefined ? { sira, tetik_ms } : { sira, tetik_ms, ornek_tarihi });
  };
  const z = onceZamani(kayit);
  kayit.hatirlatmalar.forEach((h, sira) => {
    if (h.tur === "mutlak") return dene(sira, anCevir(h.tarih, h.saat, h.saat_dilimi));
    if (z === undefined) return;
    if (kayit.tekrar === undefined) return dene(sira, onceTetigi(z, z.tarih, h.dk, anCevir).tetik_ms);
    const kapali = new Set(kayit.ornekler.map((o) => o.tarih));
    for (const gun of tekrarOrnekleri(z.tarih, kayit.tekrar, taramaAlti(altMs))) {
      const tetik = onceTetigi(z, gun, h.dk, anCevir).tetik_ms;
      if (tetik > simdiMs) break;
      if (!kapali.has(gun)) dene(sira, tetik, gun);
    }
  });
  return sonuc;
}

/** Tekrar taramasının alt günü; `YIL_MIN`'den önceyse sınırsız (çapadan). */
function gunAlti(gunNo: number): string | undefined {
  return gunNo < tarihGunNo(`${AJANDA_SINIRLARI.YIL_MIN}-01-01`) ? undefined : gunNoTarih(gunNo);
}

/** Özetin gün hatırlatması: sıradaki (`gecti` yanlış) ya da hepsi geçtiyse en son geçen (`gecti` doğru). */
export type GunHatirlatmasiOzeti = GunHatirlatmasiYereli & { gecti: boolean };

export type HatirlatmaOzeti = {
  toplam: number;
  kurulacak: number;
  saatsiz: number;
  gecmis: number;
  gun_hatirlatmasi?: GunHatirlatmasiOzeti;
};

/**
 * Araç çıktısının hatırlatma özeti: `kurulacak` etkinlik dahil, öteki sayılar etkinlikten bağımsız.
 * `gun_hatirlatmasi` (v2) yalnız `hatirlatmaEtkinMi` iken ve halinde `gun_hatirlatmasi` olan bir
 * hatırlatma varsa: tetiği en erken kurulacak olanın yerel günü ve saati (`gecti:false`), kurulacak yoksa
 * tetiği en geç geçmiş olanınki (`gecti:true`). Model kullanıcıya "Cuma 19:00'da hatırlatırım" ya da
 * "sabah hatırlatması geçti, bildirim gelmeyecek" diyebilsin diye. Alan yoksa anahtar da yoktur.
 */
export function hatirlatmaOzeti(kayit: AjandaKaydi, simdiMs: number, anCevir: AnCevirici): HatirlatmaOzeti {
  const haller = hatirlatmaHalleri(kayit, simdiMs, anCevir);
  const say = (hal: HatirlatmaHali["hal"]) => haller.filter((h) => h.hal === hal).length;
  const etkin = hatirlatmaEtkinMi(kayit);
  const ozet: HatirlatmaOzeti = {
    toplam: haller.length,
    kurulacak: etkin ? say("kurulur") : 0,
    saatsiz: say("saatsiz"),
    gecmis: say("gecmis"),
  };
  if (!etkin) return ozet;
  let sonraki: { tetik: number; y: GunHatirlatmasiYereli } | undefined;
  let gecen: { tetik: number; y: GunHatirlatmasiYereli } | undefined;
  for (const h of haller) {
    if (h.hal === "saatsiz" || h.gun_hatirlatmasi === undefined) continue;
    const y = h.gun_hatirlatmasi;
    if (h.hal === "kurulur") {
      if (sonraki === undefined || h.tetik_ms < sonraki.tetik) sonraki = { tetik: h.tetik_ms, y };
    } else {
      // Geçmiş halin tetiği yoktur: yerel gün ve saat sözlük sırası takvim sırasıdır (aynı dilim).
      const t = tarihGunNo(y.tarih) * GUN_DK + Number(y.saat.slice(0, 2)) * 60 + Number(y.saat.slice(3, 5));
      if (gecen === undefined || t > gecen.tetik) gecen = { tetik: t, y };
    }
  }
  if (sonraki !== undefined) ozet.gun_hatirlatmasi = { ...sonraki.y, gecti: false };
  else if (gecen !== undefined) ozet.gun_hatirlatmasi = { ...gecen.y, gecti: true };
  return ozet;
}

// Tekilleştirme

export type TekilKarari = { karar: "ekle" } | { karar: "zaten_var"; sira: number } | { karar: "onayla"; sira: number };

/**
 * Otomatik eklemede aynı tekil anahtarlı eşler (`esler`, oluşturma sırasıyla) varken ne yapılır.
 * - Kullanıcı emri (`kullaniciEmriMi`): yalnız açık (`acik`, silinmemiş) eş engeller. Eş taslaksa
 *   kullanıcı aynı şeyi sohbetten istemiştir: taslak onaylanır (`onayla`). Bitmiş, iptal ya da
 *   silinmiş eş yeni isteği engellemez (`ekle`).
 * - Emir olmayan otomasyon (sentetik tur, arka plan çıkarımı): her eş engeller, silinmiş ve bitmiş
 *   olan da: kullanıcının sildiği ya da bitirdiği kaydı otomasyon yeniden yaratmaz. Hiçbir şeyi onaylamaz.
 */
export function ajandaTekilKarari(
  esler: readonly Pick<AjandaKaydi, "silindi" | "durum" | "taslak">[],
  yazar: { yol: KaynakYolu; tur_kokeni: TurKokeni },
): TekilKarari {
  const acik = esler.findIndex((e) => !e.silindi && e.durum === "acik");
  if (kullaniciEmriMi(yazar)) {
    if (acik < 0) return { karar: "ekle" };
    return esler[acik]!.taslak ? { karar: "onayla", sira: acik } : { karar: "zaten_var", sira: acik };
  }
  if (esler.length === 0) return { karar: "ekle" };
  return { karar: "zaten_var", sira: acik < 0 ? 0 : acik };
}

// Telafi

/**
 * `welcome.tam`. Doğru ise uygulama sunucu kopyasını atar. Tam telafi şu hallerde:
 * `depo_id` yok ya da farklı; `son_rev > bas_rev`; `son_rev` > 0 iken iz yok; servisin geçmişinde
 * `son_rev` satırı yok (`izdeki` yok) ya da satırın kaydı ve zamanı izle tutmuyor. Son koşul, aynı
 * `depo_id`'yle yedekten geri yüklenip revizyon numaraları yeniden kullanılınca ayrışmayı yakalar.
 */
export function ajandaTelafiTamMi(g: {
  hello: { son_rev: number; depo_id?: string | undefined; son_rev_izi?: AjandaRevIzi | undefined };
  depo_id: string;
  bas_rev: number;
  /** Servis geçmişinde `rev` = `hello.son_rev` satırının kaydı ve `ts_ms`'i. */
  izdeki?: { kayit_id: string; ts_ms: number } | undefined;
}): boolean {
  const { hello } = g;
  if (hello.depo_id === undefined || hello.depo_id !== g.depo_id) return true;
  if (hello.son_rev > g.bas_rev) return true;
  if (hello.son_rev === 0) return false;
  const iz = hello.son_rev_izi;
  if (iz === undefined || g.izdeki === undefined) return true;
  return iz.kayit_id !== g.izdeki.kayit_id || iz.guncelleme_ms !== g.izdeki.ts_ms;
}

// Modelin dayanağı: turun mesaj anı

/** Yerel an: tarih, duvar saati ve IANA dilimi (`AjandaYerelAn` ile aynı biçim). */
export type YerelAn = { tarih: string; saat: string; saat_dilimi: string };

const dakikaNo = (saat: string) => Number(saat.slice(0, 2)) * 60 + Number(saat.slice(3, 5));

/**
 * Modelin göreli zamanı çözerken dayandığı an (`dayanak`) kabul edilir mi. Göreli ifade ("yarın",
 * "bu akşam", "1 saat sonra") kullanıcının mesajının servise ulaştığı ana göre çözülür: oturum meşgul
 * ya da uykudaysa mesaj ana oturuma geç iletilebilir, araç çağrısı daha da sonra gelir; ikisi de
 * dayanak olamaz. `mesajAni`, turun mesaj anının kullanıcının dilimindeki yerel halidir (varışta bir
 * kez hesaplanıp saklanır; damga da aynı değerden yazılır: `mesajAniDamgasi`).
 * Kural duvar saatiyle, dilim veritabanısız: `dayanak.saat_dilimi` verilmişse mesaj anınınkiyle aynı,
 * `dayanak.tarih` mesaj anının yerel günüyle aynı ve saat farkı en çok `DAYANAK_SAPMA_DK`. Gün
 * eşitliği şarttır: 23:58'de yazılıp 00:01'de iletilen mesajda 00:01 dayanağı (ertesi gün) reddedilir.
 * Değilse servis kayıt yazmaz, `dayanak_uyusmuyor` ve mesaj anını döner.
 */
export function dayanakGecerliMi(
  dayanak: { tarih: string; saat: string; saat_dilimi?: string | undefined },
  mesajAni: YerelAn,
): boolean {
  if (dayanak.saat_dilimi !== undefined && dayanak.saat_dilimi !== mesajAni.saat_dilimi) return false;
  if (dayanak.tarih !== mesajAni.tarih) return false;
  return Math.abs(dakikaNo(dayanak.saat) - dakikaNo(mesajAni.saat)) <= AJANDA_SINIRLARI.DAYANAK_SAPMA_DK;
}

/**
 * Mesaj anı gece aralığında mı (v2): yerel saat 00:00 ≤ saat < 00:00 + `GECE_ARALIGI_DK` (04:00).
 * Bu aralıkta kullanıcının "yarın"ı çoğu zaman uyanınca başlayacak günü, yani takvimde bugünü
 * gösterir; "bugün" de belirsizdir. Duvar saatiyle, dilim veritabanısız.
 */
export function geceAraligindaMi(mesajAni: { saat: string }): boolean {
  return dakikaNo(mesajAni.saat) < AJANDA_SINIRLARI.GECE_ARALIGI_DK;
}

// Örnek durumu

export type OrnekDurumuSonucu =
  | { ok: true; ornekler: AjandaKaydi["ornekler"]; degisti: boolean; atilan: AjandaKaydi["ornekler"] }
  | { ok: false; neden: "ornek_gecersiz" };

/**
 * `durum` işleminin `ornek_tarihi`'li hali (servis ve uygulamanın iyimser uygulaması). Tekrarsız
 * kayıtta ya da serinin günü olmayan tarihte `ornek_gecersiz`. `acik` satırı kaldırır; `tamam`/`iptal`
 * ekler ya da değiştirir. Satır sayısı `ORNEK_ADET`'i aşarsa `bugun`'den (kaydın dilimindeki yerel gün)
 * önceki en eski satırlar atılır: geçmiş örneğin hatırlatması zaten çalmaz, değişiklik geçmişte durur.
 * Yine aşılıyorsa (hepsi bugün ya da sonrası) `ornek_gecersiz`.
 */
export function ajandaOrnekDurumuUygula(
  kayit: AjandaKaydi,
  ornek_tarihi: string,
  durum: KayitDurumu,
  bugun: string,
): OrnekDurumuSonucu {
  const z = kayit.zaman;
  if (kayit.tekrar === undefined || z === undefined || !("tarih" in z) || !ornekGunuMu(z.tarih, kayit.tekrar, ornek_tarihi)) {
    return { ok: false, neden: "ornek_gecersiz" };
  }
  const simdiki = kayit.ornekler.find((o) => o.tarih === ornek_tarihi);
  if (durum === "acik") {
    if (simdiki === undefined) return { ok: true, ornekler: [...kayit.ornekler], degisti: false, atilan: [] };
    return { ok: true, ornekler: kayit.ornekler.filter((o) => o !== simdiki), degisti: true, atilan: [] };
  }
  if (simdiki?.durum === durum) return { ok: true, ornekler: [...kayit.ornekler], degisti: false, atilan: [] };
  const ornekler = [...kayit.ornekler.filter((o) => o.tarih !== ornek_tarihi), { tarih: ornek_tarihi, durum }].sort(
    (a, b) => (a.tarih < b.tarih ? -1 : a.tarih > b.tarih ? 1 : 0),
  );
  // Az önce değişen satır atılmaz; ondan başka, bugünden önceki en eski satırlar atılır.
  const atilan: AjandaKaydi["ornekler"] = [];
  for (let i = 0; ornekler.length - atilan.length > AJANDA_SINIRLARI.ORNEK_ADET && i < ornekler.length; i++) {
    const o = ornekler[i]!;
    if (o.tarih >= bugun) break;
    if (o.tarih !== ornek_tarihi) atilan.push(o);
  }
  if (ornekler.length - atilan.length > AJANDA_SINIRLARI.ORNEK_ADET) return { ok: false, neden: "ornek_gecersiz" };
  return { ok: true, ornekler: ornekler.filter((o) => !atilan.includes(o)), degisti: true, atilan };
}

// Uygulamanın işlem kuyruğu

/** Uygulamanın ret listesindeki nedenler: servisin retleri ve deneme sınırında `teslim_edilemedi`. */
export const AJANDA_KUYRUK_RET_NEDENLERI = [...AJANDA_RET_NEDENLERI, "teslim_edilemedi"] as const;
export type AjandaKuyrukRetNedeni = (typeof AJANDA_KUYRUK_RET_NEDENLERI)[number];

/**
 * Kuyruğun başındaki işlemin başına gelen:
 * - `sonuc`: `islem_sonucu` geldi.
 * - `kopma`: işlem yollandı, sonucu gelmeden bağlantı koptu (servis çerçeveyi reddedip kapatsa da).
 *   Yollanmadan kopmak olay değildir.
 * - `tam_telafi`: `welcome.tam` geldi.
 */
export type AjandaKuyrukOlayi =
  | { olay: "sonuc"; ok: true }
  | { olay: "sonuc"; ok: false; code: AjandaRetNedeni }
  | { olay: "kopma" }
  | { olay: "tam_telafi" };

/**
 * - `cikar`: kuyruktan çıkar; iyimser değişiklik ilgili `kayit` gelince yerini gerçeğe bırakır.
 * - `bekle`: kuyruğun başında kalır, `deneme` saklanır, sonra aynı `islem_id` ile yeniden yollanır.
 * - `ret_listesi`: kuyruktan çıkar, iyimser değişiklik geri alınır, işlem içeriği ve nedeniyle
 *   kullanıcının gördüğü ret listesine geçer (düzeltip yeniden ekler ya da atar); arkasındakiler gider.
 */
export type AjandaKuyrukKarari =
  | { karar: "cikar" }
  | { karar: "bekle"; deneme: number }
  | { karar: "ret_listesi"; neden: AjandaKuyrukRetNedeni };

/**
 * Kuyruğun başındaki işlemle ne yapılır. `deneme`: işlemin şimdiye dek sonuçsuz (geçici ret ya da
 * kopma) denemesi, kuyrukla birlikte kalıcı saklanır. Kural:
 * - Başarı çıkarır; kalıcı ret (`gecersiz_islem` dahil) ret listesine yollar.
 * - Geçici ret ve kopma denemeyi artırır; `ISLEM_DENEME`'ye varınca işlem ret listesine geçer (geçici
 *   retle `ic_hata`, kopmayla `teslim_edilemedi`). Tek işlem kuyruğu kalıcı olarak tıkayamaz.
 * - Tam telafi hiçbir işlemi atmaz: yollanmış ama sonucu gelmemiş işlem de kuyrukta kalır, taze
 *   kopya üstüne yeniden iyimser uygulanır ve `esitlendi`'den sonra aynı `islem_id` ile yollanır
 *   (servis tekrarsızdır: uygulanmışsa aynı sonucu döner). İşlem kuyruktan yalnız `cikar` ya da
 *   `ret_listesi` ile çıkar; hiçbir yolda sessizce kaybolmaz.
 */
export function ajandaKuyrukKarari(olay: AjandaKuyrukOlayi, deneme: number): AjandaKuyrukKarari {
  if (olay.olay === "tam_telafi") return { karar: "bekle", deneme };
  if (olay.olay === "sonuc" && olay.ok) return { karar: "cikar" };
  if (olay.olay === "sonuc" && !olay.ok && !ajandaRetGeciciMi(olay.code)) return { karar: "ret_listesi", neden: olay.code };
  const neden: AjandaKuyrukRetNedeni = olay.olay === "kopma" ? "teslim_edilemedi" : olay.code;
  return deneme + 1 >= AJANDA_SINIRLARI.ISLEM_DENEME ? { karar: "ret_listesi", neden } : { karar: "bekle", deneme: deneme + 1 };
}

// Uygulamanın sunucu kopyası ve eşitleme

/** Eşitlemenin baktığı alanlar (kopya tam `AjandaKaydi` tutar). */
export type AjandaKopyaKaydi = Pick<AjandaKaydi, "kayit_id" | "revizyon" | "guncelleme_ms">;

/**
 * Uygulamanın sunucu kopyası. `kayitlar` görünen ve alarmları kurulan kopyadır. `tam`: süren tam
 * telafinin topladıkları; `esitlendi`'de kopyanın yerine geçer, kopmada atılır.
 */
export type AjandaKopya<K extends AjandaKopyaKaydi = AjandaKaydi> = {
  depo_id?: string;
  son_rev: number;
  kayitlar: ReadonlyMap<string, K>;
  tam?: { depo_id: string; son_rev: number; kayitlar: ReadonlyMap<string, K> };
};

export type AjandaEsitlemeOlayi<K extends AjandaKopyaKaydi = AjandaKaydi> =
  | { olay: "welcome"; depo_id: string; tam: boolean }
  | { olay: "kayit"; kayit: K }
  | { olay: "esitlendi" }
  | { olay: "kopma" };

function kopyaKur<K extends AjandaKopyaKaydi>(
  depo_id: string | undefined,
  son_rev: number,
  kayitlar: ReadonlyMap<string, K>,
  tam?: AjandaKopya<K>["tam"],
): AjandaKopya<K> {
  const k: AjandaKopya<K> = { son_rev, kayitlar };
  if (depo_id !== undefined) k.depo_id = depo_id;
  if (tam !== undefined) k.tam = tam;
  return k;
}

/** `kayit` çerçevesi: yalnız revizyonu yereldekinden büyükse uygulanır; `son_rev` her çerçevede ilerler. */
function kayitUygula<K extends AjandaKopyaKaydi>(
  kayitlar: ReadonlyMap<string, K>,
  son_rev: number,
  kayit: K,
): { kayitlar: ReadonlyMap<string, K>; son_rev: number } {
  const yeniRev = Math.max(son_rev, kayit.revizyon);
  const eski = kayitlar.get(kayit.kayit_id);
  if (eski !== undefined && eski.revizyon >= kayit.revizyon) return { kayitlar, son_rev: yeniRev };
  const yeni = new Map(kayitlar);
  yeni.set(kayit.kayit_id, kayit);
  return { kayitlar: yeni, son_rev: yeniRev };
}

/**
 * Uygulamanın `/ajanda` eşitlemesinin bir adımı (girdi değişmez, yeni kopya döner).
 * - `welcome` `tam` değil: kopya sürer, `kayit`'ler doğrudan uygulanır (kopma ortada olsa da sürer).
 * - `welcome` `tam`: kopya, kurulu alarmlar, `son_rev`, `depo_id` olduğu gibi kalır; gelenler `tam`'da
 *   toplanır. `esitlendi`'de toplanan kopyanın yerine geçer (gelmeyen kayıt düşer), alarmlar yeniden
 *   kurulur. Kopma toplananı atar: telafi yarıda kesilse de görünen kayıtlar ve kurulu hatırlatmalar
 *   kaybolmaz, sonraki `hello` eski kopyanın iziyle gider ve servis tam telafiyi yeniden başlatır.
 */
export function ajandaEsitlemeAdimi<K extends AjandaKopyaKaydi>(
  d: AjandaKopya<K>,
  o: AjandaEsitlemeOlayi<K>,
): AjandaKopya<K> {
  switch (o.olay) {
    case "welcome":
      return o.tam
        ? kopyaKur(d.depo_id, d.son_rev, d.kayitlar, { depo_id: o.depo_id, son_rev: 0, kayitlar: new Map() })
        : kopyaKur(o.depo_id, d.son_rev, d.kayitlar);
    case "kayit": {
      if (d.tam === undefined) {
        const s = kayitUygula(d.kayitlar, d.son_rev, o.kayit);
        return kopyaKur(d.depo_id, s.son_rev, s.kayitlar);
      }
      const s = kayitUygula(d.tam.kayitlar, d.tam.son_rev, o.kayit);
      return kopyaKur(d.depo_id, d.son_rev, d.kayitlar, { depo_id: d.tam.depo_id, son_rev: s.son_rev, kayitlar: s.kayitlar });
    }
    case "esitlendi":
      return d.tam === undefined ? d : kopyaKur(d.tam.depo_id, d.tam.son_rev, d.tam.kayitlar);
    case "kopma":
      return kopyaKur(d.depo_id, d.son_rev, d.kayitlar);
  }
}

/**
 * `hello`'nun telafi alanları, yalnız görünen kopyadan (süren tam telafinin topladığı girmez):
 * `son_rev`, varsa `depo_id`, `son_rev` > 0 iken revizyonu `son_rev` olan kaydın izi.
 */
export function ajandaHelloAlanlari(d: AjandaKopya<AjandaKopyaKaydi>): {
  son_rev: number;
  depo_id?: string;
  son_rev_izi?: AjandaRevIzi;
} {
  const alanlar: { son_rev: number; depo_id?: string; son_rev_izi?: AjandaRevIzi } = { son_rev: d.son_rev };
  if (d.depo_id !== undefined) alanlar.depo_id = d.depo_id;
  if (d.son_rev > 0) {
    for (const k of d.kayitlar.values()) {
      if (k.revizyon === d.son_rev) alanlar.son_rev_izi = { kayit_id: k.kayit_id, guncelleme_ms: k.guncelleme_ms };
    }
  }
  return alanlar;
}
