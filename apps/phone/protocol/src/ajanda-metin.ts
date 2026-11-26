import { z } from "zod";
import type { AjandaKaydi } from "./ajanda.ts";
import type {
  AjandaEkleCikti,
  AjandaGuncelleCikti,
  AjandaKayitOzeti,
  AjandaListeleCikti,
  AjandaYerelAn,
} from "./ajanda-arac.ts";
import { ajandaGorunmezMi, type AjandaZamani, type AjandaZamanOzeti, gunNoTarih, haftaGunuNo, tarihGunNo } from "./ajanda-zaman.ts";
import { citleSar } from "./cihaz-metin.ts";
import { GUVENILMEZ_META } from "./mcp.ts";
import { AJANDA_SINIRLARI } from "./sinirlar.ts";

/**
 * Ajanda araç sonuçlarının modele giden metni. Kayıt metni (başlık, açıklama, ifade, alıntı) veri
 * sayılır: her biri `ajandaKacir` ile tek satırda tırnak içinde kalır, liste gövdesi çağrıya özel
 * çitle (`citleSar`) sarılır. Kimlik, tür, durum ve tarih alanları şemadan geçmiş kapalı biçimlerdir.
 * Köprünün modele verdiği tek şey `ajandaMcpSonucu`'dur (yapılandırılmış içerik yok).
 */

function kacisKodu(kodNoktasi: number): string {
  const onaltilik = kodNoktasi.toString(16);
  return kodNoktasi > 0xffff ? `\\u{${onaltilik}}` : "\\u" + "0000".slice(onaltilik.length) + onaltilik;
}

/**
 * `kacir`'ın ajanda hali: tırnak içinde tek satır kalacak şekilde kaçırır ve `boy` UTF-16 birimine
 * kırpar (vekil çiftini bölmez, kırpılınca `…`). Satır sonu ve sekme `\n \r \t`; ters bölü ve tırnak
 * kaçışlı; `AJANDA_GORUNMEZ_ARALIKLARI`'nın tamamı (etiket, değişken seçici ve kayıtta kabul edilen
 * emoji birleştiricileri dahil) ve eşsiz vekil `\uXXXX` ya da `\u{XXXXX}` olur: kayıt metni modele
 * görünmeden metin taşıyamaz. Eski kanalların `kacir`'ı değişmez.
 */
export function ajandaKacir(metin: string, boy: number): string {
  const kirpildi = metin.length > boy;
  const uzunluk = kirpildi ? boy : metin.length;
  let cikti = "";
  for (let i = 0; i < uzunluk; i++) {
    const birim = metin.charCodeAt(i);
    let kodNoktasi = birim;
    let karakter = metin.charAt(i);
    if (birim >= 0xd800 && birim <= 0xdbff) {
      const sonraki = i + 1 < metin.length ? metin.charCodeAt(i + 1) : 0;
      if (sonraki >= 0xdc00 && sonraki <= 0xdfff) {
        if (i + 1 >= uzunluk) break; // kırpma sınırı çiftin ortasına düştü
        kodNoktasi = 0x10000 + ((birim - 0xd800) << 10) + (sonraki - 0xdc00);
        karakter = metin.slice(i, i + 2);
        i++;
      } else {
        cikti += kacisKodu(birim);
        continue;
      }
    } else if (birim >= 0xdc00 && birim <= 0xdfff) {
      cikti += kacisKodu(birim);
      continue;
    }
    if (kodNoktasi === 0x5c) cikti += "\\\\";
    else if (kodNoktasi === 0x22) cikti += '\\"';
    else if (kodNoktasi === 0x0a) cikti += "\\n";
    else if (kodNoktasi === 0x0d) cikti += "\\r";
    else if (kodNoktasi === 0x09) cikti += "\\t";
    else if (ajandaGorunmezMi(kodNoktasi)) cikti += kacisKodu(kodNoktasi);
    else cikti += karakter;
  }
  return kirpildi ? cikti + "…" : cikti;
}

const GUN_ADLARI = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"] as const;
/** Gün adının soru eki (ünlü uyumu): Pazartesi mi, Salı mı, ... */
const GUN_SORU_EKLERI = ["mi", "mı", "mı", "mi", "mı", "mi", "mı"] as const;
const AY_ADLARI =["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"] as const;

/** `2026-11-27 Cuma`: tarih ve gün adı (modelin okuduğu biçim). */
export function tarihGunMetni(tarih: string): string {
  return `${tarih} ${GUN_ADLARI[haftaGunuNo(tarih)]}`;
}

/** `27 Kasım Cuma`: kullanıcıya söylenecek biçim. */
export function insanTarihi(tarih: string): string {
  return `${Number(tarih.slice(8, 10))} ${AY_ADLARI[Number(tarih.slice(5, 7)) - 1]} ${GUN_ADLARI[haftaGunuNo(tarih)]}`;
}

const soruEki = (tarih: string): string => GUN_SORU_EKLERI[haftaGunuNo(tarih)]!;

/** `tarih`'in mesaj anının gününe göre adı: bugün, yarın, dün, `3 gün sonra`, `2 gün önce`. */
export function goreliGunMetni(tarih: string, mesajAniTarihi: string): string {
  const fark = tarihGunNo(tarih) - tarihGunNo(mesajAniTarihi);
  if (fark === 0) return "bugün";
  if (fark === 1) return "yarın";
  if (fark === -1) return "dün";
  return fark > 0 ? `${fark} gün sonra` : `${-fark} gün önce`;
}

/** `2026-11-25 Çarşamba 14:30 Europe/Istanbul` */
export function yerelAnMetni(s: AjandaYerelAn): string {
  return `${tarihGunMetni(s.tarih)} ${s.saat} ${s.saat_dilimi}`;
}

/**
 * Konuşma modülünün ana oturuma giden her kullanıcı rolündeki mesajın (insan ve sentetik) başına
 * koyduğu satır: `[mesaj_ani: 2026-11-25 Çarşamba 23:58 Europe/Istanbul]`. Değer mesajın servise
 * ulaştığı anın, varışta kullanıcının dilimiyle hesaplanıp saklanan yerel halidir; ana oturuma
 * iletildiği ya da aracın çağrıldığı an değildir (`dayanakGecerliMi` aynı değeri kullanır). Telefona
 * giden ve saklanan mesaj metnine girmez; `alinti` denetimi damgasız metinle yapılır.
 */
export function mesajAniDamgasi(an: AjandaYerelAn): string {
  return `[mesaj_ani: ${yerelAnMetni(an)}]`;
}

/**
 * Zamanın modele giden hali, günler adıyla: `2026-11-26 Perşembe 15:00 Europe/Istanbul`,
 * `2026-11-27 Cuma saatsiz aksam Europe/Istanbul`, `2026-11-30 Pazartesi..2026-12-06 Pazar Europe/Istanbul`.
 * `gun_bolumu` kapalı listedendir. `ifadeli` yanlışsa (özet) şemayı atlayan bir yoldan `ifade` gelse de yazılmaz.
 */
function zamanMetni(z: AjandaZamani | AjandaZamanOzeti, ifadeli: boolean): string {
  let metin: string;
  if (z.kesinlik === "an") {
    metin = `${tarihGunMetni(z.tarih)} ${z.saat} ${z.saat_dilimi}` + (z.sure_dk === undefined ? "" : ` sure=${z.sure_dk}dk`);
  } else if (z.kesinlik === "gun") {
    metin = `${tarihGunMetni(z.tarih)} saatsiz${z.gun_bolumu === undefined ? "" : ` ${z.gun_bolumu}`} ${z.saat_dilimi}`;
  } else if (z.kesinlik === "donem") {
    metin = `${tarihGunMetni(z.baslangic)}..${tarihGunMetni(z.bitis)} ${z.saat_dilimi}`;
  } else {
    metin = "belirsiz";
  }
  if (!ifadeli || !("ifade" in z) || z.ifade === undefined) return metin;
  return `${metin} ifade="${ajandaKacir(z.ifade, AJANDA_SINIRLARI.ZAMAN_IFADESI)}"`;
}

/** `[kimlik] tur durum[ taslak] zaman=... baslik="..."[ aciklama="..."] hatirlatma=n kaynak=yol` */
export function ajandaKaydiSatiri(k: AjandaKaydi): string {
  let satir = `[${k.kayit_id}] ${k.tur} ${k.durum}${k.taslak ? " taslak" : ""}`;
  satir += ` zaman=${k.zaman === undefined ? "yok" : zamanMetni(k.zaman, true)}`;
  satir += ` baslik="${ajandaKacir(k.baslik, AJANDA_SINIRLARI.BASLIK)}"`;
  if (k.aciklama !== undefined) satir += ` aciklama="${ajandaKacir(k.aciklama, AJANDA_SINIRLARI.MODEL_ACIKLAMA)}"`;
  satir += ` hatirlatma=${k.hatirlatmalar.length}`;
  if (k.tekrar !== undefined) satir += ` tekrar=${k.tekrar.siklik}/${k.tekrar.aralik}`;
  if (k.elle_alanlar.length > 0) satir += ` elle=${k.elle_alanlar.join(",")}`;
  return satir + ` kaynak=${k.kaynak.yol}`;
}

/** `cit` her çağrıda güvenli üreteçten yeni üretilir ve gövdede geçmemelidir (`ajandaMcpSonucu` denetler). */
export function ajandaListesiMetni(cit: string, c: AjandaListeleCikti): string {
  const baslik = `ajanda: mesaj_ani=${yerelAnMetni(c.mesaj_ani)} gosterilen=${c.kayitlar.length} toplam=${c.toplam}`;
  if (c.kayitlar.length === 0) return `${baslik}\neslesen kayit yok`;
  const not = c.toplam > c.kayitlar.length ? "\nkesildi: daha fazlası var; tarih ya da ara ile daralt" : "";
  return `${baslik}${not}\n${citleSar(cit, c.kayitlar.map(ajandaKaydiSatiri).join("\n"))}`;
}

const TASLAK_NOTU =
  " Taslak: onaylanmadı, hatırlatma kurulmaz. Kullanıcı isterse onaylar (uygulamadan ya da sohbette " +
  "açıkça isteyince ajanda_guncelle onayla:true); kullanıcıya kaydedildi deme, taslak olduğunu söyle.";

const BILDIRIM_YOK_NOTU =
  " Bu kayıt için şu an hiçbir bildirim gelmeyecek; bunu kullanıcıya söyle (isterse saat ya da hatırlatma verebilir).";

/** Kaydın gününün kullanıcıya söylenecek hali: `27 Kasım Cuma`, dönemde `30 Kasım Pazartesi - 6 Aralık Pazar`. */
function insanZamani(z: AjandaZamanOzeti): string | undefined {
  if (z.kesinlik === "an" || z.kesinlik === "gun") return insanTarihi(z.tarih);
  if (z.kesinlik === "donem") return `${insanTarihi(z.baslangic)} - ${insanTarihi(z.bitis)}`;
  return undefined;
}

/**
 * Kayıt özetinin modele giden kısmı: durum, zaman (ifadesiz, günler adıyla ve mesaj anına göre:
 * `(mesaj anına göre yarın)`), hatırlatma hali (gün hatırlatmasının günü ve saati dahil), hiç bildirim
 * gelmeyecekse uyarı, günü adıyla söyleme yönergesi, taslak uyarısı.
 */
function ozetMetni(k: AjandaKayitOzeti, an: AjandaYerelAn): string {
  let metin = `(kayit ${k.kayit_id}) durum=${k.durum}${k.taslak ? " taslak" : ""}`;
  metin += ` zaman=${k.zaman === undefined ? "yok" : zamanMetni(k.zaman, false)}`;
  const z = k.zaman;
  const gun = z === undefined ? undefined : z.kesinlik === "donem" ? z.baslangic : z.kesinlik === "belirsiz" ? undefined : z.tarih;
  if (gun !== undefined) metin += ` (mesaj anına göre ${goreliGunMetni(gun, an.tarih)})`;
  const h = k.hatirlatma;
  if (h.toplam === 0) metin += " hatirlatma=yok.";
  else {
    metin += ` hatirlatma=${h.toplam} kurulacak=${h.kurulacak}`;
    if (h.saatsiz > 0) metin += ` saatsiz=${h.saatsiz} (gün ya da saat verilince kurulur)`;
    if (h.gecmis > 0) metin += ` gecmis=${h.gecmis} (zamanı geçti, kurulmaz)`;
    const g = h.gun_hatirlatmasi;
    if (g !== undefined) {
      metin += ` gun_hatirlatmasi=${tarihGunMetni(g.tarih)} ${g.saat}`;
      metin += g.gecti ? " (geçti)" : " (saatsiz kayıt: günün yaklaşık saatinde)";
    }
    metin += ".";
    // Yalnız günü belli kayıtta (an, gun): orada hatırlatma beklenir; dönem, belirsiz ve zamansızda bekleyen yeter.
    const gunlu = z !== undefined && (z.kesinlik === "an" || z.kesinlik === "gun");
    if (gunlu && !k.taslak && !k.silindi && k.durum === "acik" && h.kurulacak === 0) metin += BILDIRIM_YOK_NOTU;
  }
  const insan = z === undefined ? undefined : insanZamani(z);
  if (insan !== undefined) {
    metin += ` Yanıtında kaydın gününü adıyla ve tarihiyle söyle (${insan}); göreli ifadeyi nasıl çözdüğün böyle görünür.`;
  }
  return k.taslak ? metin + TASLAK_NOTU : metin;
}

const anMetni = (an: AjandaYerelAn) => ` mesaj_ani=${yerelAnMetni(an)}`;

function geceNotu(an: AjandaYerelAn): string {
  const bugun = an.tarih;
  const yarin = gunNoTarih(tarihGunNo(bugun) + 1);
  return (
    ` Mesaj gece yarısından sonra yazıldı (${an.saat}): takvimde bugün ${tarihGunMetni(bugun)}, yarın ` +
    `${tarihGunMetni(yarin)}. Kullanıcı günü göreli söylediyse (yarın, bugün, bu akşam, bu gece) uyanınca ` +
    `başlayacak günü (${insanTarihi(bugun)}) kastediyor olabilir: kaydetmeden önce kısa bir soruyla hangi günü ` +
    `kastettiğini sor (ör. "${insanTarihi(bugun)} ${soruEki(bugun)}, ${insanTarihi(yarin)} ${soruEki(yarin)}?"), cevabından sonra ` +
    `dayanak.gece_teyidi:"soruldu" ile yeniden çağır. Günü tarihle ya da adıyla söylediyse ya da yalnız saati ` +
    `göreliyse (1 saat sonra) soru sormadan dayanak.gece_teyidi:"gun_acik" ile yeniden çağır.`
  );
}

function retMetni(fiil: string, eylem: string, neden: string, an: AjandaYerelAn): string {
  let ek = "";
  if (neden === "dayanak_uyusmuyor") {
    ek =
      " Dayanak bu turun mesaj anıyla uyuşmuyor: göreli zamanı kullanıcının mesajının ulaştığı ana " +
      "(aşağıdaki mesaj_ani; şimdiki saat değil) göre yeniden çöz, dayanak olarak onu ver ve yeniden dene.";
  } else if (neden === "gece_teyidi_gerekli") {
    ek = geceNotu(an);
  } else if (neden === "tutarsiz_kayit") {
    ek = " Değişiklik kaydın kurallarını bozuyor: tekrar eden kayıtta zaman an ya da gun olmalı, tekrar bitişi çapadan önce olamaz.";
  } else if (neden === "ic_hata") {
    ek = " Geçici hata; biraz sonra yeniden dene.";
  }
  return `${fiil}: ${eylem}, neden=${neden}.${ek}${anMetni(an)}`;
}

function uygulananMetni(alanlar: readonly string[]): string {
  return alanlar.length === 0 ? "" : ` Kullanıcının bu turda söylediği şu alanlar kayda işlendi: ${alanlar.join(",")}.`;
}

export function ajandaEkleMetni(c: AjandaEkleCikti): string {
  if (c.sonuc === "ret") return retMetni("ajanda_ekle", "eklenmedi", c.neden, c.mesaj_ani);
  const an = anMetni(c.mesaj_ani);
  if (c.sonuc === "eklendi") return `ajanda_ekle: eklendi ${ozetMetni(c.kayit, c.mesaj_ani)}${an}`;
  const uygulanan = uygulananMetni(c.uygulanan_alanlar);
  if (c.sonuc === "onaylandi") {
    return `ajanda_ekle: aynı kayıt taslak olarak vardı, kullanıcının isteğiyle onaylandı; yeni kayıt açılmadı ${ozetMetni(c.kayit, c.mesaj_ani)}${uygulanan}${an}`;
  }
  if (c.kayit.silindi) {
    return `ajanda_ekle: kullanıcı bu kaydı silmiş; yeniden eklenmedi (kayit ${c.kayit.kayit_id}).${an}`;
  }
  return `ajanda_ekle: zaten kayıtlı, yeni kayıt açılmadı ${ozetMetni(c.kayit, c.mesaj_ani)}${uygulanan}${an}`;
}

export function ajandaGuncelleMetni(c: AjandaGuncelleCikti): string {
  if (c.sonuc === "ret") return retMetni("ajanda_guncelle", "uygulanmadı", c.neden, c.mesaj_ani);
  const korunan =
    c.korunan_alanlar.length === 0
      ? ""
      : ` Şu alanları kullanıcı kendisi belirlemiş; bu tur kullanıcının mesajıyla başlamadığı için ` +
        `uygulanmadı: ${c.korunan_alanlar.join(",")}. Değişmesi gerekiyorsa kullanıcıya sor.`;
  const ozet = c.sonuc === "guncellendi" ? "güncellendi" : "değişiklik yok";
  return `ajanda_guncelle: ${ozet} ${ozetMetni(c.kayit, c.mesaj_ani)}${korunan}${anMetni(c.mesaj_ani)}`;
}

/**
 * Köprünün ajanda aracı için MCP'ye verdiği sonuç: tek metin içeriği; yapılandırılmış içerik
 * (`structuredContent`) ve araç tanımında `outputSchema` yoktur, böylece kayıt metni modele yalnız
 * kaçışlı ve (listede) çitli yoldan gider. Okunan kayıt metni taşıyan liste `GUVENILMEZ_META` taşır.
 */
export const AjandaMcpSonucu = z.strictObject({
  content: z.tuple([z.strictObject({ type: z.literal("text"), text: z.string() })]),
  _meta: z.strictObject({ "eren/untrusted_content": z.literal(true) }).optional(),
});
export type AjandaMcpSonucu = z.infer<typeof AjandaMcpSonucu>;

export type AjandaAracCiktisi =
  | { fiil: "ajanda_ekle"; cikti: AjandaEkleCikti }
  | { fiil: "ajanda_guncelle"; cikti: AjandaGuncelleCikti }
  | { fiil: "ajanda_listele"; cikti: AjandaListeleCikti };

const CIT_DENEME = 8;

/**
 * Araç çıktısından MCP sonucu. `citUret` her çağrıda güvenli üreteçten yeni çit verir (16-64,
 * `[A-Za-z0-9_-]`); çit liste gövdesinde geçerse yenisi denenir (`CIT_DENEME` kez, sonra atar).
 */
export function ajandaMcpSonucu(g: AjandaAracCiktisi, citUret: () => string): AjandaMcpSonucu {
  if (g.fiil === "ajanda_ekle") return { content: [{ type: "text", text: ajandaEkleMetni(g.cikti) }] };
  if (g.fiil === "ajanda_guncelle") return { content: [{ type: "text", text: ajandaGuncelleMetni(g.cikti) }] };
  const govde = g.cikti.kayitlar.map(ajandaKaydiSatiri).join("\n");
  for (let i = 0; i < CIT_DENEME; i++) {
    const cit = citUret();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(cit)) throw new RangeError("geçersiz çit");
    if (govde.includes(cit)) continue;
    return { content: [{ type: "text", text: ajandaListesiMetni(cit, g.cikti) }], _meta: { ...GUVENILMEZ_META } };
  }
  throw new RangeError("çit gövdeden ayrılamadı");
}
