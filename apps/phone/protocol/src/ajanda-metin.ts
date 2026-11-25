import type { AjandaKaydi } from "./ajanda.ts";
import type {
  AjandaEkleCikti,
  AjandaGuncelleCikti,
  AjandaKayitOzeti,
  AjandaListeleCikti,
  AjandaSimdi,
} from "./ajanda-arac.ts";
import { ajandaGorunmezMi, type AjandaZamani, haftaGunuNo } from "./ajanda-zaman.ts";
import { citleSar } from "./cihaz-metin.ts";
import { AJANDA_SINIRLARI } from "./sinirlar.ts";

/**
 * Ajanda araç sonuçlarının modele giden metni. Kayıt metni (başlık, açıklama, ifade, alıntı) veri
 * sayılır: her biri `ajandaKacir` ile tek satırda tırnak içinde kalır, liste gövdesi çağrıya özel
 * çitle (`citleSar`) sarılır. Kimlik, tür, durum ve tarih alanları şemadan geçmiş kapalı biçimlerdir.
 */

function kacisKodu(kodNoktasi: number): string {
  const onaltilik = kodNoktasi.toString(16);
  return kodNoktasi > 0xffff ? `\\u{${onaltilik}}` : "\\u" + "0000".slice(onaltilik.length) + onaltilik;
}

/**
 * `kacir`'ın ajanda hali: tırnak içinde tek satır kalacak şekilde kaçırır ve `boy` UTF-16 birimine
 * kırpar (vekil çiftini bölmez, kırpılınca `…`). Satır sonu ve sekme `\n \r \t`; ters bölü ve tırnak
 * kaçışlı; `AJANDA_GORUNMEZ_ARALIKLARI` (etiket ve değişken seçici dahil) ve eşsiz vekil `\uXXXX` ya da
 * `\u{XXXXX}` olur: kayıt metni modele görünmeden metin taşıyamaz. Eski kanalların `kacir`'ı değişmez.
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

/** `2026-11-25 Çarşamba 14:30 Europe/Istanbul` */
export function simdiMetni(s: AjandaSimdi): string {
  return `${s.tarih} ${GUN_ADLARI[haftaGunuNo(s.tarih)]} ${s.saat} ${s.saat_dilimi}`;
}

/**
 * Konuşma modülünün ana oturuma giden her kullanıcı rolündeki mesajın (insan ve sentetik) başına
 * koyduğu satır: `[simdi: 2026-11-25 Çarşamba 14:30 Europe/Istanbul]`. Telefona giden ve saklanan
 * mesaj metnine girmez; `alinti` denetimi damgasız metinle yapılır.
 */
export function simdiDamgasi(s: AjandaSimdi): string {
  return `[simdi: ${simdiMetni(s)}]`;
}

function zamanMetni(z: AjandaZamani, ifadeli = true): string {
  let metin: string;
  if (z.kesinlik === "an") {
    metin = `${z.tarih} ${z.saat} ${z.saat_dilimi}` + (z.sure_dk === undefined ? "" : ` sure=${z.sure_dk}dk`);
  } else if (z.kesinlik === "gun") {
    metin = `${z.tarih} saatsiz ${z.saat_dilimi}`;
  } else if (z.kesinlik === "donem") {
    metin = `${z.baslangic}..${z.bitis} ${z.saat_dilimi}`;
  } else {
    metin = "belirsiz";
  }
  if (!ifadeli || z.ifade === undefined) return metin;
  return `${metin} ifade="${ajandaKacir(z.ifade, AJANDA_SINIRLARI.ZAMAN_IFADESI)}"`;
}

/** `[kimlik] tur durum[ taslak] zaman=... baslik="..."[ aciklama="..."] hatirlatma=n kaynak=yol` */
export function ajandaKaydiSatiri(k: AjandaKaydi): string {
  let satir = `[${k.kayit_id}] ${k.tur} ${k.durum}${k.taslak ? " taslak" : ""}`;
  satir += ` zaman=${k.zaman === undefined ? "yok" : zamanMetni(k.zaman)}`;
  satir += ` baslik="${ajandaKacir(k.baslik, AJANDA_SINIRLARI.BASLIK)}"`;
  if (k.aciklama !== undefined) satir += ` aciklama="${ajandaKacir(k.aciklama, AJANDA_SINIRLARI.MODEL_ACIKLAMA)}"`;
  satir += ` hatirlatma=${k.hatirlatmalar.length}`;
  if (k.tekrar !== undefined) satir += ` tekrar=${k.tekrar.siklik}/${k.tekrar.aralik}`;
  if (k.elle_alanlar.length > 0) satir += ` elle=${k.elle_alanlar.join(",")}`;
  return satir + ` kaynak=${k.kaynak.yol}`;
}

/** `cit` her çağrıda güvenli üreteçten yeni üretilir ve gövdede geçmemelidir (köprü denetler). */
export function ajandaListesiMetni(cit: string, c: AjandaListeleCikti): string {
  const baslik = `ajanda: simdi=${simdiMetni(c.simdi)} gosterilen=${c.kayitlar.length} toplam=${c.toplam}`;
  if (c.kayitlar.length === 0) return `${baslik}\neslesen kayit yok`;
  const not = c.toplam > c.kayitlar.length ? "\nkesildi: daha fazlası var; tarih ya da ara ile daralt" : "";
  return `${baslik}${not}\n${citleSar(cit, c.kayitlar.map(ajandaKaydiSatiri).join("\n"))}`;
}

const TASLAK_NOTU =
  " Taslak: onaylanmadı, hatırlatma kurulmaz. Kullanıcı isterse onaylar (uygulamadan ya da sohbette " +
  "açıkça isteyince ajanda_guncelle onayla:true); kullanıcıya kaydedildi deme, taslak olduğunu söyle.";

/** Kayıt özetinin modele giden kısmı: durum, zaman (ifadesiz), hatırlatma hali, taslak uyarısı. */
function ozetMetni(k: AjandaKayitOzeti): string {
  let metin = `(kayit ${k.kayit_id}) durum=${k.durum}${k.taslak ? " taslak" : ""}`;
  metin += ` zaman=${k.zaman === undefined ? "yok" : zamanMetni(k.zaman, false)}`;
  const h = k.hatirlatma;
  if (h.toplam === 0) metin += " hatirlatma=yok.";
  else {
    metin += ` hatirlatma=${h.toplam} kurulacak=${h.kurulacak}`;
    if (h.saatsiz > 0) metin += ` saatsiz=${h.saatsiz} (saat verilince kurulur)`;
    if (h.gecmis > 0) metin += ` gecmis=${h.gecmis} (zamanı geçti, kurulmaz)`;
    metin += ".";
  }
  return k.taslak ? metin + TASLAK_NOTU : metin;
}

function retMetni(fiil: string, eylem: string, neden: string, simdi: AjandaSimdi): string {
  let ek = "";
  if (neden === "simdi_uyusmuyor") {
    ek = " Dayanak servisin şimdisiyle uyuşmuyor: göreli zamanı aşağıdaki şimdiye göre yeniden çöz, dayanak olarak onu ver ve yeniden dene.";
  } else if (neden === "tutarsiz_kayit") {
    ek = " Değişiklik kaydın kurallarını bozuyor: tekrar eden kayıtta zaman an ya da gun olmalı, tekrar bitişi çapadan önce olamaz.";
  } else if (neden === "ic_hata") {
    ek = " Geçici hata; biraz sonra yeniden dene.";
  }
  return `${fiil}: ${eylem}, neden=${neden}.${ek} simdi=${simdiMetni(simdi)}`;
}

export function ajandaEkleMetni(c: AjandaEkleCikti): string {
  const simdi = ` simdi=${simdiMetni(c.simdi)}`;
  if (c.sonuc === "ret") return retMetni("ajanda_ekle", "eklenmedi", c.neden, c.simdi);
  if (c.sonuc === "eklendi") return `ajanda_ekle: eklendi ${ozetMetni(c.kayit)}${simdi}`;
  if (c.sonuc === "onaylandi") {
    return `ajanda_ekle: aynı kayıt taslak olarak vardı, kullanıcının isteğiyle onaylandı; yeni kayıt açılmadı ${ozetMetni(c.kayit)}${simdi}`;
  }
  if (c.kayit.silindi) {
    return `ajanda_ekle: kullanıcı bu kaydı silmiş; yeniden eklenmedi (kayit ${c.kayit.kayit_id}).${simdi}`;
  }
  return `ajanda_ekle: zaten kayıtlı, yeni kayıt açılmadı ${ozetMetni(c.kayit)}${simdi}`;
}

export function ajandaGuncelleMetni(c: AjandaGuncelleCikti): string {
  if (c.sonuc === "ret") return retMetni("ajanda_guncelle", "uygulanmadı", c.neden, c.simdi);
  const korunan =
    c.korunan_alanlar.length === 0
      ? ""
      : ` Şu alanları kullanıcı kendisi belirlemiş; bu tur kullanıcının mesajıyla başlamadığı için ` +
        `uygulanmadı: ${c.korunan_alanlar.join(",")}. Değişmesi gerekiyorsa kullanıcıya sor.`;
  const ozet = c.sonuc === "guncellendi" ? "güncellendi" : "değişiklik yok";
  return `ajanda_guncelle: ${ozet} ${ozetMetni(c.kayit)}${korunan} simdi=${simdiMetni(c.simdi)}`;
}
