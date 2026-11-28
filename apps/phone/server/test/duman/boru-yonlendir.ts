/**
 * Duman koşusunun boru adı yönlendirmesi (önyükleme; `node --import <bu dosyanın URL'si>?onek=<belirteç>`).
 *
 * Servisin boru adları sabittir (`\\.\pipe\eren-servis-tekil`, `eren-kopru`, `eren-ajanda`; kaynakta ayar
 * yok) ve canlı servis bunları tutar. Bu önyükleme yüklendiği süreçte `\\.\pipe\eren-` ile başlayan her
 * adı `\\.\pipe\eren-duman-<belirteç>-` önekine çevirir: hem dinleyen (`net.Server#listen`: tekil kilit,
 * köprü ve ajanda boruları) hem bağlanan (`net.Socket#connect`: `kopru.ts`) taraf. Servis kodu değişmez;
 * yalnız adlar ayrışır. Belirteç yoksa süreç hemen düşer: yönlendirmesiz bir duman süreci canlı borulara
 * bağlanmamalı.
 *
 * Yüklendiği süreçler: duman servisi (`servis.ts`) ve kaydedicinin mcp kopyasında `--import` alan köprüler.
 */
import net from "node:net";

const ONEK = "\\\\.\\pipe\\eren-";
const belirtec = new URL(import.meta.url).searchParams.get("onek") ?? "";
if (!/^[0-9a-f]{8,32}$/.test(belirtec)) {
  process.stderr.write("boru-yonlendir: onek belirteci yok ya da gecersiz\n");
  process.exit(97);
}
const HEDEF = `\\\\.\\pipe\\eren-duman-${belirtec}-`;

/** `\\.\pipe\eren-x` → `\\.\pipe\eren-duman-<b>-x`; zaten çevrilmişse ya da başka adsa olduğu gibi. */
function boruAdiCevir(ad: string): string {
  if (!ad.toLowerCase().startsWith(ONEK)) return ad;
  if (ad.toLowerCase().startsWith(HEDEF.toLowerCase())) return ad;
  return HEDEF + ad.slice(ONEK.length);
}

type Kayitsiz = (...a: unknown[]) => unknown;

const yolCevir = (o: unknown): void => {
  if (o !== null && typeof o === "object" && "path" in o) {
    const k = o as { path?: unknown };
    if (typeof k.path === "string") k.path = boruAdiCevir(k.path);
  }
};

// Bağlanan taraf: `net.connect(yol)` ve `createConnection` normalleştirilmiş [seçenek, geri çağrı] dizisiyle,
// doğrudan çağrı dize ya da seçenek nesnesiyle gelir.
const asilConnect = net.Socket.prototype.connect as unknown as Kayitsiz;
(net.Socket.prototype as unknown as { connect: Kayitsiz }).connect = function (this: unknown, ...a: unknown[]): unknown {
  if (Array.isArray(a[0])) yolCevir(a[0][0]);
  else if (typeof a[0] === "string") a[0] = boruAdiCevir(a[0]);
  else yolCevir(a[0]);
  return asilConnect.apply(this, a);
};

// Dinleyen taraf: `listen(yol, cb)` ya da `listen({ path })`.
const asilListen = net.Server.prototype.listen as unknown as Kayitsiz;
(net.Server.prototype as unknown as { listen: Kayitsiz }).listen = function (this: unknown, ...a: unknown[]): unknown {
  if (typeof a[0] === "string") a[0] = boruAdiCevir(a[0]);
  else yolCevir(a[0]);
  return asilListen.apply(this, a);
};
