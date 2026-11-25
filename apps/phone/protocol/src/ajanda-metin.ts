import type { AjandaKaydi } from "./ajanda.ts";
import type { AjandaEkleCikti, AjandaGuncelleCikti, AjandaListeleCikti } from "./ajanda-arac.ts";
import type { AjandaZamani } from "./ajanda-zaman.ts";
import { citleSar, kacir } from "./cihaz-metin.ts";
import { AJANDA_SINIRLARI } from "./sinirlar.ts";

/**
 * Ajanda araç sonuçlarının modele giden metni. Kayıt metni (başlık, açıklama, ifade, alıntı) veri
 * sayılır: her biri `kacir` ile tek satırda tırnak içinde kalır, liste gövdesi çağrıya özel çitle
 * (`citleSar`) sarılır. Kimlik, tür, durum ve tarih alanları şemadan geçmiş kapalı biçimlerdir.
 */

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
  return `${metin} ifade="${kacir(z.ifade, AJANDA_SINIRLARI.ZAMAN_IFADESI)}"`;
}

/** `[kimlik] tur durum[ taslak] zaman=... baslik="..."[ aciklama="..."] hatirlatma=n kaynak=yol` */
export function ajandaKaydiSatiri(k: AjandaKaydi): string {
  let satir = `[${k.kayit_id}] ${k.tur} ${k.durum}${k.taslak ? " taslak" : ""}`;
  satir += ` zaman=${k.zaman === undefined ? "yok" : zamanMetni(k.zaman)}`;
  satir += ` baslik="${kacir(k.baslik, AJANDA_SINIRLARI.BASLIK)}"`;
  if (k.aciklama !== undefined) satir += ` aciklama="${kacir(k.aciklama, AJANDA_SINIRLARI.MODEL_ACIKLAMA)}"`;
  satir += ` hatirlatma=${k.hatirlatmalar.length}`;
  if (k.tekrar !== undefined) satir += ` tekrar=${k.tekrar.siklik}/${k.tekrar.aralik}`;
  if (k.elle_alanlar.length > 0) satir += ` elle=${k.elle_alanlar.join(",")}`;
  return satir + ` kaynak=${k.kaynak.yol}`;
}

/** `cit` her çağrıda güvenli üreteçten yeni üretilir ve gövdede geçmemelidir (köprü denetler). */
export function ajandaListesiMetni(cit: string, c: AjandaListeleCikti): string {
  const baslik =
    `ajanda: simdi=${c.simdi.tarih} ${c.simdi.saat} ${c.simdi.saat_dilimi} ` +
    `gosterilen=${c.kayitlar.length} toplam=${c.toplam}`;
  if (c.kayitlar.length === 0) return `${baslik}\neslesen kayit yok`;
  const not = c.toplam > c.kayitlar.length ? "\nkesildi: daha fazlası var; tarih ya da ara ile daralt" : "";
  return `${baslik}${not}\n${citleSar(cit, c.kayitlar.map(ajandaKaydiSatiri).join("\n"))}`;
}

export function ajandaEkleMetni(c: AjandaEkleCikti): string {
  if (c.sonuc === "ret") return `ajanda_ekle: eklenmedi, neden=${c.neden}`;
  if (c.sonuc === "zaten_var") return `ajanda_ekle: zaten kayıtlı (kayit ${c.kayit_id}), yeni kayıt açılmadı.`;
  const zaman = c.zaman === undefined ? "yok" : zamanMetni(c.zaman, false);
  const taslak = c.taslak
    ? " Taslak: kullanıcı uygulamada onaylayınca hatırlatma kurulur."
    : "";
  return `ajanda_ekle: eklendi (kayit ${c.kayit_id}) zaman=${zaman} hatirlatma=${c.hatirlatma_sayisi}.${taslak}`;
}

export function ajandaGuncelleMetni(c: AjandaGuncelleCikti): string {
  if (c.sonuc === "ret") return `ajanda_guncelle: uygulanmadı, neden=${c.neden}`;
  const korunan =
    c.korunan_alanlar.length === 0
      ? ""
      : ` Kullanıcı şu alanları elle değiştirmiş, uygulanmadı: ${c.korunan_alanlar.join(",")}. ` +
        "Değiştirmek isterse uygulamadan değiştirmesini söyle.";
  const ozet = c.sonuc === "guncellendi" ? `güncellendi (kayit ${c.kayit_id})` : `değişiklik yok (kayit ${c.kayit_id})`;
  return `ajanda_guncelle: ${ozet}.${korunan}`;
}
