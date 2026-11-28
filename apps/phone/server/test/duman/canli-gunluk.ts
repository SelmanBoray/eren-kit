/**
 * Canlı servis günlüğünde el sıkışma sayımı (HARNESS-H4-PLAN.md bölüm 8, "Önyüklemesiz alt süreçler").
 *
 * Neden: önyükleme (`boru-yonlendir.ts`) süreç başınadır ve `NODE_OPTIONS` silinir; modelin
 * `--dangerously-skip-permissions` altında PowerShell ya da Bash ile başlattığı bir `node` ya da `eren` süreci
 * yönlendirilmeden canlı borulara bağlanabilir. Önyüklemenin denetim günlüğü bu süreçleri görmez. Canlı servis
 * ise her bağlantının el sıkışmasını kendi günlüğüne yazar (`kopru-sunucu`, `ajanda-kopru-sunucu`: `el_sikisma`,
 * `el_sikisma_ret`). Koşu penceresinde bu olaylar sayılır.
 *
 * SALT OKUMA: dosya `readFileSync` ile okunur (libuv okuma/yazma/silme paylaşımıyla açar, okuma süresince ms
 * düzeyinde açık kalır; servisin eklemesini ve döndürmesini engellemez). Hiçbir şey yazılmaz. Satırlardan
 * yalnız `ts_ms`, `modul`, `olay` ve `rol` alınır; başka alan belleğe de alınmaz, rapora yalnız olay, rol ve sayı.
 *
 * Kök: kalıcı kullanıcı ortamındaki `EREN_KIT_DATA_DIR` (`HKCU\Environment`, canlı servis bununla açılır) ve
 * bu sürecin ortamı; ikisi de `veri-koku.ts` kuralıyla çözülür (yoksa `%LOCALAPPDATA%\eren-kit`). Farklıysa
 * ikisi de okunur. Günlük `<kök>\logs\servis.log` ve döndürülmüşleri `servis.<n>.log` (`dis-dunya.ts`
 * `kayitKur`). Önce `servis.log`, sonra numaralılar okunur: okuma sırasında döndürme olursa bir satır iki kez
 * sayılabilir (fazla sayım, temkinli yön), hiç sayılmaması olmaz.
 *
 * Ölçüt (pencere: duman servisinden hemen önce → temizlikten sonra):
 * - `el_sikisma_ret`: 0 olmalı. Duman süreçlerinin jetonu canlı serviste geçersizdir; sızan bağlantı ret olur.
 * - `el_sikisma`, rol `eren` / `ana_oturum` / `soru` / `telefon` / bilinmeyen: 0 olmalı.
 * - `el_sikisma`, rol `pc_oturumu` / `pc_kanca`: bilgi. Canlı Claude Code oturumları (MCP `eren-ajanda` ve
 *   kancalar) gün boyu bağlanır; duman süreçlerinin ortamı duman köküne çevrili olduğu için bu rollerin anahtarı
 *   (`ajanda-pc.anahtar`) onlarda yoktur. Koşuya atfedilmez.
 * Atfetme yoktur: pencerede canlı taraftan gelen bir ret ya da telefonun ana oturumu da koşuyu başarısız yapar
 * (yanlış alarm; koşu yinelenir). Ters yön (sızıntının görülmemesi) olmasın diye ölçüt geniştir.
 *
 *   node --disable-warning=ExperimentalWarning test/duman/canli-gunluk.ts     bugünkü sayılar
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import win32 from "node:path/win32";
import { ortamDegeri, VERI_KOKU_ORTAMI, veriKokuCoz } from "../../src/veri-koku.ts";
import type { Sonuc } from "./karsilastir.ts";

export const CANLI_OLAYLAR: ReadonlySet<string> = new Set(["el_sikisma", "el_sikisma_ret"]);
/** Canlı Claude Code oturumlarının arka plan rolleri: pencerede görülmesi koşuya atfedilmez. */
export const ARKA_PLAN_ROLLERI: ReadonlySet<string> = new Set(["pc_oturumu", "pc_kanca"]);
/** Döndürülmüş dosya taraması üst sınırı (servis 5 dosya tutar: `servis.log` + `.1`…`.4`). */
const AZAMI_NUMARA = 9;

export interface CanliOlay {
  ms: number;
  modul: string;
  olay: string;
  rol: string | null;
}

export interface CanliGunlukAnligi {
  ms: number;
  /** Okunan kökler (kaynak: `kalici` = HKCU\Environment, `surec` = bu sürecin ortamı). */
  kokler: Array<{ kaynak: string; kok: string }>;
  dosyalar: number;
  okunamayan: number;
  olaylar: CanliOlay[];
  /** Kök çözülemediyse ya da hiç günlük dosyası yoksa. */
  hata: string | null;
}

/** `HKCU\Environment`'ten bir değer (salt okuma, `reg query`). Yoksa `null`. `REG_EXPAND_SZ` açılır. */
export function kaliciOrtamDegeri(ad: string): string | null {
  if (process.platform !== "win32") return null;
  const r = spawnSync("reg.exe", ["query", "HKCU\\Environment", "/v", ad], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  for (const satir of r.stdout.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+(REG_SZ|REG_EXPAND_SZ)\s+(.*)$/.exec(satir);
    if (m === null || m[1]?.toUpperCase() !== ad.toUpperCase()) continue;
    const deger = (m[3] ?? "").trim();
    if (deger === "") return null;
    return m[2] === "REG_EXPAND_SZ" ? deger.replace(/%([^%]+)%/g, (t, v: string) => ortamDegeri(process.env, v) ?? t) : deger;
  }
  return null;
}

/** Canlı veri kökü adayları (yinelenmeyen). */
export function canliKokler(ortam: NodeJS.ProcessEnv = process.env, kalici: string | null = kaliciOrtamDegeri(VERI_KOKU_ORTAMI)): Array<{ kaynak: string; kok: string }> {
  const la = ortamDegeri(ortam, "LOCALAPPDATA");
  const adaylar: Array<{ kaynak: string; sonuc: ReturnType<typeof veriKokuCoz> }> = [
    { kaynak: "kalici", sonuc: veriKokuCoz({ ...(kalici === null ? {} : { [VERI_KOKU_ORTAMI]: kalici }), ...(la === undefined ? {} : { LOCALAPPDATA: la }) }) },
    { kaynak: "surec", sonuc: veriKokuCoz(ortam) },
  ];
  const cikti: Array<{ kaynak: string; kok: string }> = [];
  for (const a of adaylar) {
    if (!a.sonuc.ok) continue;
    const kok = a.sonuc.kok;
    const var_ = cikti.find((c) => c.kok.toLowerCase() === kok.toLowerCase());
    if (var_ !== undefined) var_.kaynak += `+${a.kaynak}`;
    else cikti.push({ kaynak: a.kaynak, kok });
  }
  return cikti;
}

/** `servis.log`, sonra `servis.1.log` … (var olanlar). */
export function gunlukDosyalari(kok: string): string[] {
  const ana = win32.join(kok, "logs", "servis.log");
  const liste = [ana];
  for (let n = 1; n <= AZAMI_NUMARA; n++) liste.push(win32.join(kok, "logs", `servis.${n}.log`));
  return liste.filter((y) => existsSync(y));
}

/** Satırlardan yalnız el sıkışma olayları; başka alan alınmaz. */
export function olaylariAyikla(metin: string): CanliOlay[] {
  const cikti: CanliOlay[] = [];
  for (const satir of metin.split("\n")) {
    if (!satir.includes('"el_sikisma')) continue;
    let o: unknown;
    try {
      o = JSON.parse(satir);
    } catch {
      continue; // yazılmakta olan yarım son satır
    }
    if (o === null || typeof o !== "object") continue;
    const k = o as Record<string, unknown>;
    if (typeof k["olay"] !== "string" || !CANLI_OLAYLAR.has(k["olay"]) || typeof k["ts_ms"] !== "number") continue;
    cikti.push({ ms: k["ts_ms"], modul: typeof k["modul"] === "string" ? k["modul"] : "?", olay: k["olay"], rol: typeof k["rol"] === "string" ? k["rol"] : null });
  }
  return cikti;
}

export function canliGunlukAnligiAl(kokler: Array<{ kaynak: string; kok: string }> = canliKokler()): CanliGunlukAnligi {
  const a: CanliGunlukAnligi = { ms: Date.now(), kokler, dosyalar: 0, okunamayan: 0, olaylar: [], hata: null };
  if (kokler.length === 0) {
    a.hata = "canlı veri kökü çözülemedi";
    return a;
  }
  for (const { kok } of kokler) {
    for (const yol of gunlukDosyalari(kok)) {
      let metin: string;
      try {
        metin = readFileSync(yol, "utf8");
      } catch {
        a.okunamayan++;
        continue;
      }
      a.dosyalar++;
      a.olaylar.push(...olaylariAyikla(metin));
    }
  }
  if (a.dosyalar === 0) a.hata = a.okunamayan > 0 ? "canlı günlük okunamadı" : "canlı günlük dosyası yok";
  return a;
}

const anahtar = (o: CanliOlay): string => `${o.modul} ${o.olay} rol=${o.rol ?? "-"}`;

/** Olay, rol ve sayı (çoktan aza). */
export function sayim(olaylar: readonly CanliOlay[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const o of olaylar) m.set(anahtar(o), (m.get(anahtar(o)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

const maskele = (s: string, ev = homedir()): string => (s.toLowerCase().startsWith(ev.toLowerCase()) ? `~${s.slice(ev.length)}` : s);

/** Bugünkü durum (kuru kip): kökler, dosya sayısı, olay başına toplam ve son 24 saat. */
export function canliGunlukOzeti(a: CanliGunlukAnligi): string[] {
  const satirlar = [
    `canlı kök: ${a.kokler.map((k) => `${maskele(k.kok)} (${k.kaynak})`).join(", ") || "yok"}; günlük dosyası ${a.dosyalar}, okunamayan ${a.okunamayan}${a.hata === null ? "" : ` (${a.hata})`}`,
  ];
  const gun = a.olaylar.filter((o) => a.ms - o.ms <= 86_400_000);
  const saat = a.olaylar.filter((o) => a.ms - o.ms <= 3_600_000);
  const gunM = new Map(sayim(gun));
  const saatM = new Map(sayim(saat));
  satirlar.push(`el sıkışma olayları: toplam ${a.olaylar.length}, son 24 sa ${gun.length}, son 1 sa ${saat.length}`);
  for (const [k, n] of sayim(a.olaylar)) satirlar.push(`  ${k}: toplam ${n}, son 24 sa ${gunM.get(k) ?? 0}, son 1 sa ${saatM.get(k) ?? 0}`);
  return satirlar;
}

/**
 * Koşu penceresinin denetimi. `basMs`: duman servisinden önce; `bitMs`: temizlikten sonra. `canliBoruVar`:
 * koşu başında canlı `eren-*` borusu listelendi mi (yoksa canlı servis yok; günlüğün olmaması kanıt eksikliği
 * sayılmaz).
 */
export function canliGunlukDenetle(once: CanliGunlukAnligi, sonra: CanliGunlukAnligi, basMs: number, bitMs: number, canliBoruVar: boolean): Sonuc {
  const denetimler: Sonuc["denetimler"] = [];
  const bilgiler: string[] = [];
  const okundu = once.hata === null && sonra.hata === null;
  denetimler.push({
    ad: "canlı servis günlüğü koşudan önce ve sonra okundu (salt okuma)",
    gecti: okundu || (!canliBoruVar && once.dosyalar === 0 && sonra.dosyalar === 0),
    detay: okundu ? "" : `önce: ${once.hata ?? "tamam"}, sonra: ${sonra.hata ?? "tamam"}; canlı boru ${canliBoruVar ? "var" : "yok"}`,
  });
  const pencere = sonra.olaylar.filter((o) => o.ms >= basMs && o.ms <= bitMs);
  const ret = pencere.filter((o) => o.olay === "el_sikisma_ret");
  const kabul = pencere.filter((o) => o.olay === "el_sikisma");
  const arkaPlan = kabul.filter((o) => o.rol !== null && ARKA_PLAN_ROLLERI.has(o.rol));
  const supheli = kabul.filter((o) => o.rol === null || !ARKA_PLAN_ROLLERI.has(o.rol));
  const yaz = (l: readonly CanliOlay[]): string => sayim(l).map(([k, n]) => `${k}: ${n}`).join(", ");
  denetimler.push({ ad: "pencerede canlı serviste el_sikisma_ret: 0", gecti: ret.length === 0, detay: yaz(ret) });
  denetimler.push({ ad: "pencerede canlı serviste el_sikisma (rol eren, ana_oturum, soru, telefon, bilinmeyen): 0", gecti: supheli.length === 0, detay: yaz(supheli) });
  bilgiler.push(
    `pencere ${Math.round((bitMs - basMs) / 1000)} sn; arka plan el_sikisma (pc_oturumu, pc_kanca; canlı Claude Code oturumları, koşuya atfedilmez): ${arkaPlan.length}${arkaPlan.length > 0 ? ` (${yaz(arkaPlan)})` : ""}`,
  );
  bilgiler.push(
    `günlükteki toplam el sıkışma: önce ${once.olaylar.length}, sonra ${sonra.olaylar.length} (döndürme ve okuma sırası farkı oluşturabilir; ölçüt pencere içi zaman damgasıdır)`,
  );
  bilgiler.push(
    "kapsam: canlı servisin günlüğe yazdığı el sıkışmalar; açık kalan sessiz bağlantı süre dolunca ret (sure_doldu) olarak görünür, süre dolmadan kapanan sessiz bağlantı görünmez",
  );
  return { farklar: [], denetimler, bilgiler };
}

if (import.meta.main) {
  for (const s of canliGunlukOzeti(canliGunlukAnligiAl())) process.stdout.write(`${s}\n`);
}
