import type { CmdPayload, CmdSonucu, Element, OnPlan } from "./cihaz.ts";
import { SINIRLAR } from "./sinirlar.ts";
import { gorunmezBirimMi } from "./temel.ts";

/** Telefondan okunan metnin modele giden dili. Köprü burayı kullanır, kablo yapısal kalır. */

function dortHane(birim: number): string {
  const onaltilik = birim.toString(16);
  return "\\u" + "0000".slice(onaltilik.length) + onaltilik;
}

/**
 * Tırnak içinde tek satır kalacak şekilde kaçırır ve kırpar. Satır sonu, kontrol ve yön
 * karakterleri `\uXXXX` olur: okunan metin sahte `[12] button` satırı üretemez.
 */
export function kacir(metin: string, boy: number = SINIRLAR.ELEMENT_METIN): string {
  const kirpildi = metin.length > boy;
  const uzunluk = kirpildi ? boy : metin.length;
  let cikti = "";
  for (let i = 0; i < uzunluk; i++) {
    const birim = metin.charCodeAt(i);
    if (birim === 0x5c) cikti += "\\\\";
    else if (birim === 0x22) cikti += '\\"';
    else if (birim === 0x0a) cikti += "\\n";
    else if (birim === 0x0d) cikti += "\\r";
    else if (birim === 0x09) cikti += "\\t";
    else if (gorunmezBirimMi(birim)) cikti += dortHane(birim);
    else if (birim >= 0xd800 && birim <= 0xdbff) {
      const sonraki = i + 1 < metin.length ? metin.charCodeAt(i + 1) : 0;
      if (i + 1 < uzunluk && sonraki >= 0xdc00 && sonraki <= 0xdfff) {
        cikti += metin.charAt(i) + metin.charAt(i + 1);
        i++;
      } else if (sonraki >= 0xdc00 && sonraki <= 0xdfff) {
        // Kırpma sınırı bir çiftin ortasına düştü, yarım karakter bırakma.
      } else {
        cikti += dortHane(birim);
      }
    } else if (birim >= 0xdc00 && birim <= 0xdfff) {
      cikti += dortHane(birim);
    } else {
      cikti += metin.charAt(i);
    }
  }
  return kirpildi ? cikti + "…" : cikti;
}

export function onPlanMetni(onPlan: OnPlan | null): string {
  if (onPlan === null) return "foreground: none";
  return `foreground: "${kacir(onPlan.baslik, SINIRLAR.ON_PLAN_BASLIK)}" (${onPlan.paket})`;
}

/** Önce ELEMENT_SATIR_METIN'e kırpar (vekil çifti bölmez), sonra kaçırır; sayaç kırpılan birim sayısıdır. */
function kirpKacir(metin: string): string {
  const sinir = SINIRLAR.ELEMENT_SATIR_METIN;
  if (metin.length <= sinir) return kacir(metin, sinir);
  let kes = sinir;
  const son = metin.charCodeAt(kes - 1);
  if (son >= 0xd800 && son <= 0xdbff) kes--;
  return kacir(metin.slice(0, kes), sinir) + `...[kirpildi ${metin.length - kes}]`;
}

/** `[id] rol "ad" = "değer" @x,y`, varsa ` (disabled)` ve ` (password)` ile. */
export function elementSatiri(e: Element): string {
  let satir = `[${e.id}] ${e.rol} "${kirpKacir(e.ad)}"`;
  if (e.deger !== undefined && e.password !== true) satir += ` = "${kirpKacir(e.deger)}"`;
  if (e.disabled === true) satir += " (disabled)";
  if (e.password === true) satir += " (password)";
  return satir + ` @${e.x},${e.y}`;
}

function payloadMetni(onPlan: OnPlan | null, payload: CmdPayload): string {
  if (payload.kind === "image") {
    return (
      `screen ${payload.width}x${payload.height} (scale ${payload.scale.toFixed(2)}) | ` +
      onPlanMetni(onPlan)
    );
  }
  const baslik =
    onPlan === null
      ? '"?" (?)'
      : `"${kacir(onPlan.baslik, SINIRLAR.ON_PLAN_BASLIK)}" (${onPlan.paket})`;
  const satirlar = [`window: ${baslik} — ${payload.elements.length} elements`];
  for (const e of payload.elements) satirlar.push(elementSatiri(e));
  if (payload.elements.length === 0) {
    satirlar.push("no accessible elements; use screenshot");
  } else if (payload.truncated) {
    satirlar.push(`… truncated at ${payload.elements.length}; use query to narrow`);
  }
  return satirlar.join("\n");
}

/**
 * Bir komut sonucunun modele giden metni. Çoğu komutta tek satır:
 * `ok | foreground: "Başlık" (paket)`, `denied: neden | ...`, `error: hata | ...`.
 * Resim metne girmez, MCP sonucuna ayrı içerik olarak eklenir.
 */
export function cmdSonucuMetni(sonuc: CmdSonucu): string {
  if (sonuc.denied !== undefined) {
    return `denied: ${sonuc.denied} | ${onPlanMetni(sonuc.foreground)}`;
  }
  if (sonuc.hata !== undefined) return `error: ${sonuc.hata} | ${onPlanMetni(sonuc.foreground)}`;
  if (sonuc.payload !== undefined) return payloadMetni(sonuc.foreground, sonuc.payload);
  return `ok | ${onPlanMetni(sonuc.foreground)}`;
}

/** Okunan metni çağrıya özel rastgele çitle sarar. `cit` her çağrıda yeniden üretilir. */
export function citleSar(cit: string, govde: string): string {
  return `<<<okunan-metin ${cit}>>>\n${govde}\n<<<okunan-metin-sonu ${cit}>>>`;
}
