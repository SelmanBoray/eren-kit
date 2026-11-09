/**
 * gorev-kaydet testleri: yalnız ortak sözleşmenin "Görev Zamanlayıcı" ve "kurulum/gorev-kaydet.ts"
 * bölümlerinden yazıldı. Her ölçülmüş ayar ayrı kilitlenir; biri yanlışsa servis sessizce durur.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const KULLANICI = "makine\\kisi";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const KOK = "C:\\ornek\\AppData\\Local\\eren-kit\\uygulama";

const BASLANGIC = "2026-11-08T14:30:05";

type Girdi = { kullanici: string; nodeExe: string; uygulamaKok: string; baslangic: string };

const girdi = (): Girdi => ({ kullanici: KULLANICI, nodeExe: NODE, uygulamaKok: KOK, baslangic: BASLANGIC });

// İçe aktarma yan etkisiz olmalı ve hızlı dönmeli (schtasks çalıştırmaz).
const t0 = Date.now();
const { gorevXml } = await import("../gorev-kaydet.ts");
const iceAktarmaMs = Date.now() - t0;

const xml = (o: Girdi = girdi()): string => gorevXml(o);

const kacir = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Etiketin (namespace önekli olabilir) iç metnini döner; yoksa null. */
function icerik(kaynak: string, etiket: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${etiket}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${etiket}\\s*>`);
  const m = re.exec(kaynak);
  return m ? m[1]! : null;
}

/** Etiketin iç metni; yoksa testi düşürür. */
function zorunlu(kaynak: string, etiket: string): string {
  const v = icerik(kaynak, etiket);
  assert.notEqual(v, null, `<${etiket}> bulunamadı`);
  return v!;
}

const metin = (kaynak: string, etiket: string): string | null => {
  const v = icerik(kaynak, etiket);
  return v === null ? null : v.trim();
};

/** Varlıkları çözer (XML okuyucunun göreceği değer). */
const coz = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");

test("içe aktarma yan etkisiz: hızlı ve hatasız döner", () => {
  assert.equal(typeof gorevXml, "function");
  assert.ok(iceAktarmaMs < 5000, `içe aktarma ${iceAktarmaMs} ms sürdü`);
});

test("saf: aynı girdiyle iki çağrı aynı çıktıyı verir", () => {
  assert.equal(xml(), xml());
  assert.equal(typeof xml(), "string");
});

test("Principal: LogonType InteractiveToken, RunLevel LeastPrivilege, UserId kullanıcı", () => {
  const p = zorunlu(xml(), "Principal");
  assert.equal(metin(p, "LogonType"), "InteractiveToken");
  assert.equal(metin(p, "RunLevel"), "LeastPrivilege");
  assert.equal(coz(metin(p, "UserId") ?? ""), KULLANICI);
});

test("LogonTrigger var, UserId kullanıcı", () => {
  const t = zorunlu(xml(), "LogonTrigger");
  assert.equal(coz(metin(t, "UserId") ?? ""), KULLANICI);
});

test("LogonTrigger tekrarsız: Repetition yok", () => {
  const t = zorunlu(xml(), "LogonTrigger");
  assert.equal(icerik(t, "Repetition"), null);
  assert.ok(!/Interval/.test(t));
});

test("TimeTrigger: StartBoundary birebir baslangic, 5 dakikalık süresiz tekrar", () => {
  const t = zorunlu(xml(), "TimeTrigger");
  assert.equal(metin(t, "StartBoundary"), BASLANGIC);
  const r = zorunlu(t, "Repetition");
  assert.equal(metin(r, "Interval"), "PT5M");
  const sure = metin(r, "Duration");
  assert.ok(sure === null || sure === "", `Duration sınırlı olmamalı: ${sure}`);
  const dur = metin(r, "StopAtDurationEnd");
  assert.ok(dur === null || dur === "false", `StopAtDurationEnd false/yok olmalı: ${dur}`);
  const e = metin(t, "Enabled");
  assert.ok(e === null || e === "true", `Enabled true/yok olmalı: ${e}`);
});

test("Settings: pil, süre, çoklu örnek, kaçırılan başlatma, gizlilik", () => {
  const s = zorunlu(xml(), "Settings");
  assert.equal(metin(s, "MultipleInstancesPolicy"), "IgnoreNew");
  assert.equal(metin(s, "DisallowStartIfOnBatteries"), "false");
  assert.equal(metin(s, "StopIfGoingOnBatteries"), "false");
  assert.equal(metin(s, "ExecutionTimeLimit"), "PT0S");
  assert.equal(metin(s, "StartWhenAvailable"), "true");
  assert.equal(metin(s, "Hidden"), "true");
  const e = metin(s, "Enabled");
  assert.ok(e === null || e === "true", `Enabled true/yok olmalı: ${e}`);
});

test("Exec: Command conhost.exe ile biter", () => {
  const e = zorunlu(xml(), "Exec");
  const komut = coz(metin(e, "Command") ?? "").replace(/^"|"$/g, "");
  assert.ok(/conhost\.exe$/i.test(komut), `Command: ${komut}`);
});

test("Exec: Arguments sırası --headless, node, uyarı bayrağı, bekçi, --ana, ana", () => {
  const e = zorunlu(xml(), "Exec");
  const a = coz(metin(e, "Arguments") ?? "");
  assert.ok(a.startsWith("--headless"), `Arguments: ${a}`);
  const parcalar = [
    "--headless",
    `"${NODE}"`,
    "--disable-warning=ExperimentalWarning",
    `"${KOK}\\guncel\\server\\src\\bekci-ana.ts"`,
    "--ana",
    `"${KOK}\\guncel\\server\\src\\ana.ts"`,
  ];
  let konum = 0;
  for (const p of parcalar) {
    const i = a.indexOf(p, konum);
    assert.ok(i >= 0, `${p} sırayla bulunamadı; Arguments: ${a}`);
    konum = i + p.length;
  }
});

test("Exec: WorkingDirectory uygulamaKok\\guncel", () => {
  const e = zorunlu(xml(), "Exec");
  assert.equal(coz(metin(e, "WorkingDirectory") ?? ""), `${KOK}\\guncel`);
});

test("XML kaçışı: &, <, ' içeren yol ham yazılmaz, çözülünce özgün değer çıkar", () => {
  const o: Girdi = {
    kullanici: "alan\\o'neil & <ben>",
    nodeExe: "C:\\Program Files\\a&b\\node.exe",
    uygulamaKok: "C:\\ornek\\a<b>&c's\\eren-kit\\uygulama",
    baslangic: BASLANGIC,
  };
  const x = xml(o);
  // Geçerli varlık olmayan ham & kalmamalı.
  assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(x), "ham & kalmış");
  assert.ok(x.includes("&amp;"));
  assert.ok(x.includes("&lt;"));
  // Etiket içeriklerinde ham < yok: iç metinler çözülünce özgün değerler gelir.
  assert.equal(coz(metin(zorunlu(x, "Principal"), "UserId") ?? ""), o.kullanici);
  assert.equal(coz(metin(zorunlu(x, "LogonTrigger"), "UserId") ?? ""), o.kullanici);
  const e = zorunlu(x, "Exec");
  const a = coz(metin(e, "Arguments") ?? "");
  assert.ok(a.includes(`"${o.nodeExe}"`), a);
  assert.ok(a.includes(`"${o.uygulamaKok}\\guncel\\server\\src\\bekci-ana.ts"`), a);
  assert.ok(a.includes(`"${o.uygulamaKok}\\guncel\\server\\src\\ana.ts"`), a);
  assert.equal(coz(metin(e, "WorkingDirectory") ?? ""), `${o.uygulamaKok}\\guncel`);
  // Belge hâlâ dengeli: kaçışsız '<' yalnız etiket başında olmalı.
  assert.ok(!new RegExp(`<[^<>]*${kacir("a<b")}`).test(x));
});

test("Settings/Priority normal sınıfta: 4, 5 ya da 6 (7 çocuk süreçlere miras kalır)", () => {
  const p = metin(zorunlu(xml(), "Settings"), "Priority");
  assert.notEqual(p, null, "Priority yok (varsayılan 7 olur)");
  assert.ok(["4", "5", "6"].includes(p!), `Priority: ${p}`);
});
