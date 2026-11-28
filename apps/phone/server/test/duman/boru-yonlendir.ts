/**
 * Duman koşusunun boru adı yönlendirmesi (önyükleme; `node --import <bu dosyanın URL'si>?onek=<belirteç>`).
 *
 * Servisin boru adları sabittir (`\\.\pipe\eren-servis-tekil`, `eren-kopru`, `eren-ajanda`, `eren-bekci`;
 * kaynakta ayar yok) ve canlı servis bunları tutar. Bu önyükleme yüklendiği süreçte her boru adını
 * `boru-kural.ts` `hedefCoz` ile çözer: canlı ad alanı `eren-*` → `eren-duman-<belirteç>-*`, zaten
 * yönlendirilmiş ad aynen, başka her boru adı HATA (bağlantı ya da dinleme kurulmaz, çağrı atar).
 * Yönlendirmesiz bir duman süreci canlı borulara bağlanmamalı.
 *
 * İki katman: `net.Socket#connect` / `net.Server#listen` (`kopru.ts`'in yolu) ve altlarındaki yerel tanıtıcı
 * `pipe_wrap.Pipe#connect` / `#bind` (her adlı boru bağlantısı ve dinlemesi buradan geçer; üst katmanı atlayan
 * bir yol da aynı kurala takılır). Boru dışı hedefler (TCP) bu önyüklemenin kapsamı dışında.
 *
 * Denetim günlüğü: `%TEMP%\eren-duman-<belirteç>\boru\<pid>.jsonl` (kök varsa; `kosu.ts` kurar). Olaylar:
 * `yuklendi` (betik adı, `--rol`), `baglan` / `dinle` (istenen ve çözülen ad), `kabul` (dinlenen boruya gelen
 * bağlantı), `red` (kurala takılan ad). Jeton, içerik ya da ortam değeri yazılmaz. `kosu.ts` bu günlükten canlı
 * boruya bağlantı olmadığını ve köprülerin duman borusuna bağlandığını gösterir.
 *
 * Belirteç yoksa süreç hemen düşer (97). Yüklendiğinin işareti: `globalThis[Symbol.for("eren-duman-boru-yonlendir")]`.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { boruAdi, hedefCoz } from "./boru-kural.ts";

const belirtec = new URL(import.meta.url).searchParams.get("onek") ?? "";
if (!/^[0-9a-f]{8,32}$/.test(belirtec)) {
  process.stderr.write("boru-yonlendir: onek belirteci yok ya da gecersiz\n");
  process.exit(97);
}

// ---- denetim günlüğü ----

const gunlukYolu = ((): string | null => {
  const kok = join(tmpdir(), `eren-duman-${belirtec}`);
  if (!existsSync(kok)) return null;
  try {
    mkdirSync(join(kok, "boru"), { recursive: true });
    return join(kok, "boru", `${process.pid}.jsonl`);
  } catch {
    return null;
  }
})();
const kaydet = (o: Record<string, unknown>): void => {
  if (gunlukYolu === null) return;
  try {
    appendFileSync(gunlukYolu, `${JSON.stringify({ ms: Date.now(), pid: process.pid, ...o })}\n`);
  } catch {
    // denetim kaybı akışı değiştirmez; kosu.ts eksik günlüğü kanıt yokluğu sayar
  }
};

/** Boru değilse aynen; boruysa çözülen ad. Kurala takılanı kaydedip atar. */
function coz(yol: string, islem: "baglan" | "dinle", katman: "net" | "yerel"): string {
  let hedef: string | null;
  try {
    hedef = hedefCoz(yol, belirtec);
  } catch (e) {
    kaydet({ t: "red", islem, katman, istenen: yol });
    throw e;
  }
  if (hedef === null) return yol;
  // Üst katman çevirdiyse alt katman aynı adı görür; olay bir kez, yerel katmanın gördüğü adla yazılır.
  if (katman === "yerel") kaydet({ t: islem, hedef });
  else if (hedef !== yol) kaydet({ t: `${islem}_cevrildi`, istenen: yol, hedef });
  return hedef;
}

const yolCevir = (o: unknown, islem: "baglan" | "dinle"): void => {
  if (o !== null && typeof o === "object" && "path" in o) {
    const k = o as { path?: unknown };
    if (typeof k.path === "string") k.path = coz(k.path, islem, "net");
  }
};

type Kayitsiz = (...a: unknown[]) => unknown;

// ---- üst katman: net ----

// Bağlanan taraf: `net.connect(yol)` ve `createConnection` normalleştirilmiş [seçenek, geri çağrı] dizisiyle,
// doğrudan çağrı dize ya da seçenek nesnesiyle gelir.
const asilConnect = net.Socket.prototype.connect as unknown as Kayitsiz;
(net.Socket.prototype as unknown as { connect: Kayitsiz }).connect = function (this: unknown, ...a: unknown[]): unknown {
  if (Array.isArray(a[0])) yolCevir(a[0][0], "baglan");
  else if (typeof a[0] === "string") a[0] = coz(a[0], "baglan", "net");
  else yolCevir(a[0], "baglan");
  return asilConnect.apply(this, a);
};

// Dinleyen taraf: `listen(yol, cb)` ya da `listen({ path })`. Gelen bağlantılar günlüğe (yalnız ad).
const asilListen = net.Server.prototype.listen as unknown as Kayitsiz;
(net.Server.prototype as unknown as { listen: Kayitsiz }).listen = function (this: net.Server, ...a: unknown[]): unknown {
  if (typeof a[0] === "string") a[0] = coz(a[0], "dinle", "net");
  else yolCevir(a[0], "dinle");
  const ad = typeof a[0] === "string" ? a[0] : (a[0] as { path?: unknown } | null)?.path;
  if (typeof ad === "string" && boruAdi(ad) !== null) this.on("connection", () => kaydet({ t: "kabul", hedef: ad }));
  return asilListen.apply(this, a);
};

// ---- alt katman: yerel boru tanıtıcısı ----

interface BoruTanitici {
  prototype: { connect: Kayitsiz; bind: Kayitsiz };
}
const pipeWrap = (process as unknown as { binding(ad: string): { Pipe?: BoruTanitici } }).binding("pipe_wrap");
if (pipeWrap.Pipe === undefined) {
  process.stderr.write("boru-yonlendir: pipe_wrap bulunamadi\n");
  process.exit(97);
}
const yerel = pipeWrap.Pipe.prototype;
const asilYerelConnect = yerel.connect;
const asilYerelBind = yerel.bind;
// `connect(req, ad, ...)` ve `bind(ad, ...)`: ad dizedir.
yerel.connect = function (this: unknown, ...a: unknown[]): unknown {
  if (typeof a[1] === "string") a[1] = coz(a[1], "baglan", "yerel");
  return asilYerelConnect.apply(this, a);
};
yerel.bind = function (this: unknown, ...a: unknown[]): unknown {
  if (typeof a[0] === "string") a[0] = coz(a[0], "dinle", "yerel");
  return asilYerelBind.apply(this, a);
};

const rolIndeksi = process.argv.indexOf("--rol");
kaydet({
  t: "yuklendi",
  betik: process.argv[1] === undefined ? null : basename(process.argv[1]),
  rol: rolIndeksi >= 0 ? (process.argv[rolIndeksi + 1] ?? null) : null,
  ppid: process.ppid,
});
(globalThis as Record<symbol, unknown>)[Symbol.for("eren-duman-boru-yonlendir")] = belirtec;
