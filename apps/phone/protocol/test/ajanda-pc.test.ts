import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import * as Kanca from "../src/ajanda-pc-kanca.ts";
import { kancaAsagiCoz, kancaHelloSatiri, kancaIstekSatiri, KANCA_AZAMI_SATIR, pcJetonuMu } from "../src/ajanda-pc-kanca.ts";
import {
  AJANDA_ARAC_ACIKLAMALARI,
  AJANDA_AZAMI_CERCEVE,
  AjandaKopruHello,
  cozumle,
  mesaj,
  PcEskiAracGirdi,
  AJANDA_BORU_ADI,
  AJANDA_FIILLERI,
  AJANDA_PC_ARAC_ACIKLAMALARI,
  AJANDA_PC_ROLLERI,
  AJANDA_PC_SINIRLARI,
  AJANDA_ROL_FIILLERI,
  AJANDA_SINIRLARI,
  AjandaKopruIstek,
  ajandaKopruYukariCoz,
  ajandaPcRoluMu,
  AracCagriId,
  CLAUDE_CODE_GIRIS_ORTAMI,
  CLAUDE_CODE_SUREC_ORTAMI,
  Jeton,
  KOPRU_FIILLERI,
  OpakId,
  PC_AKTORLER,
  PC_ETKILESIMLER,
  PC_ETKILESIMSIZ_GIRISLER,
  PC_UYARLAYICILARI,
  PC_VARSAYILAN_UYARLAYICI,
  pcUyarlayiciAdiMi,
  pcUyarlayiciTanindiMi,
  PC_KANCA_ARAC_FIILLERI,
  PC_KANCA_ARACLARI,
  PC_KANCA_FIILLERI,
  PC_KANCA_OLAYLARI,
  PC_TUR_KARARLARI,
  PC_TUR_NEDENI_METNI,
  PcAracSonucu,
  pcAracKancaGirdisi,
  pcEtkilesimsizMi,
  pcKancaYukariCoz,
  pcTurNotu,
  PROTOKOL_SURUMU,
} from "../src/index.ts";
import { JETON } from "./ornekler.ts";

const v = PROTOKOL_SURUMU;
const OTURUM = "3f1c2a9e-7b4d-4c1a-9e2f-0a1b2c3d4e5f";
const ARAC_ID = "toolu_01AbCdEfGhIjKlMnOpQrStUv";

test("PC rolleri: köprü ve kanca; ana oturum PC rolü değildir", () => {
  assert.deepEqual([...AJANDA_PC_ROLLERI], ["pc_oturumu", "pc_kanca"]);
  assert.equal(ajandaPcRoluMu("pc_oturumu"), true);
  assert.equal(ajandaPcRoluMu("pc_kanca"), true);
  assert.equal(ajandaPcRoluMu("ana_oturum"), false);
});

test("PC sınırları AJANDA_SINIRLARI'na girmez (uygulama ve /ajanda sürümü etkilenmez)", () => {
  for (const k of Object.keys(AJANDA_PC_SINIRLARI)) assert.equal(k in AJANDA_SINIRLARI, false, k);
});

test("istek isteğe bağlı cagri taşır; cagri katıdır", () => {
  const m = { v, type: "istek", istek_id: "i1", fiil: "ajanda_listele", girdi: {} };
  assert.equal(AjandaKopruIstek.safeParse(m).success, true, "cagri'siz (ana_oturum) istek bugünkü gibi");
  assert.equal(AjandaKopruIstek.safeParse({ ...m, cagri: { arac_cagri_id: ARAC_ID, oturum_id: OTURUM } }).success, true);
  assert.equal(AjandaKopruIstek.safeParse({ ...m, cagri: {} }).success, true);
  assert.equal(AjandaKopruIstek.safeParse({ ...m, cagri: { arac_cagri_id: ARAC_ID, tur_kokeni: "insan" } }).success, false);
  assert.equal(AjandaKopruIstek.safeParse({ ...m, cagri: { arac_cagri_id: "toolu bad" } }).success, false);
  assert.equal(AjandaKopruIstek.safeParse({ ...m, cagri: { arac_cagri_id: "x".repeat(129) } }).success, false);
});

test("kanca borusu: hello ve tek kanca isteği (pc_arac) çözülür; istem ve tur sonu kancası, araç fiili yok", () => {
  const hello = { v, type: "kopru_hello", rol: "pc_kanca", jeton: JETON };
  assert.equal(pcKancaYukariCoz(JSON.stringify(hello)).ok, true);
  assert.equal(ajandaKopruYukariCoz(JSON.stringify(hello)).ok, true);
  const arac = { v, type: "istek", istek_id: "i2", fiil: "pc_arac", girdi: { oturum_id: OTURUM, arac_cagri_id: ARAC_ID, alt_agent: false, etkilesimsiz: false } };
  assert.equal(pcKancaYukariCoz(JSON.stringify(arac)).ok, true);
  assert.equal(ajandaKopruYukariCoz(JSON.stringify(arac)).ok, false, "kanca isteği araç borusu çözücüsünde");
  assert.equal(pcKancaYukariCoz(JSON.stringify({ ...arac, girdi: { ...arac.girdi, istem_id: "p-1" } })).ok, true);
  // Yalın yol: istem metni ve tur sonu servise gidemez (şema yok).
  const istem = { v, type: "istek", istek_id: "i1", fiil: "pc_istem", girdi: { oturum_id: OTURUM, kaynak: "user", metin: "yarın 3'te dişçi" } };
  const son = { v, type: "istek", istek_id: "i3", fiil: "pc_tur_sonu", girdi: { oturum_id: OTURUM } };
  for (const m of [istem, son]) assert.equal(pcKancaYukariCoz(JSON.stringify(m)).ok, false, m.fiil);
  const listele = { v, type: "istek", istek_id: "i4", fiil: "ajanda_listele", girdi: {} };
  assert.equal(pcKancaYukariCoz(JSON.stringify(listele)).ok, false);
  // Kanca turu ilan edemez; alanlar katı ve eksiksiz.
  assert.equal(pcKancaYukariCoz(JSON.stringify({ ...arac, girdi: { ...arac.girdi, tur_kokeni: "insan" } })).ok, false);
  const { etkilesimsiz: _e, ...eksik } = arac.girdi;
  assert.equal(pcKancaYukariCoz(JSON.stringify({ ...arac, girdi: eksik })).ok, false, "etkilesimsiz zorunlu");
  assert.deepEqual([...PC_KANCA_OLAYLARI], ["arac"]);
});

test("kanca fiilleri araç ve eren fiilleriyle kesişmez", () => {
  assert.deepEqual([...PC_KANCA_FIILLERI], Object.keys(PC_KANCA_ARACLARI));
  for (const f of PC_KANCA_FIILLERI) {
    assert.equal((AJANDA_FIILLERI as readonly string[]).includes(f), false, f);
    assert.equal((KOPRU_FIILLERI as readonly string[]).includes(f), false, f);
  }
});

test("PC araç açıklamaları sözleşmedekilerin birebir devamıdır", () => {
  for (const f of AJANDA_FIILLERI) assert.ok(AJANDA_PC_ARAC_ACIKLAMALARI[f].startsWith(AJANDA_ARAC_ACIKLAMALARI[f]), f);
  assert.equal(AJANDA_PC_ARAC_ACIKLAMALARI.ajanda_listele, AJANDA_ARAC_ACIKLAMALARI.ajanda_listele);
  assert.match(AJANDA_PC_ARAC_ACIKLAMALARI.ajanda_ekle, /ajanda_listele\{en_fazla:1\}/);
  // Yalın yol: damga yok, "şimdi" araç çıktısından; bildirim/zamanlanmış turda kendiliğinden ekleme yok.
  for (const f of ["ajanda_ekle", "ajanda_guncelle"] as const) {
    assert.match(AJANDA_PC_ARAC_ACIKLAMALARI[f], /damgası yoktur/);
    assert.match(AJANDA_PC_ARAC_ACIKLAMALARI[f], /mesaj_ani şimdiki andır/);
    assert.match(AJANDA_PC_ARAC_ACIKLAMALARI[f], /zamanlanmış görev.*kendiliğinden ekleme/);
  }
});

/** Kanca çekirdeğinin ürettiği istek servisin şemasından geçer mi. */
const semadanGecer = (istek: NonNullable<ReturnType<typeof pcAracKancaGirdisi>>): boolean =>
  pcKancaYukariCoz(kancaIstekSatiri("kanca_1", istek)).ok;

/** Ölçülen Claude Code 2.1.332 `PreToolUse` girdisinin biçimi (ana ajan; değerler örnek). */
const ANA_ARAC = {
  session_id: OTURUM,
  transcript_path: "C:\\ornek\\transkript.jsonl",
  cwd: "C:\\ornek\\proje",
  prompt_id: "0f873fac-48ba-47b1-97c5-251ed969c351",
  permission_mode: "default",
  effort: { level: "medium" },
  hook_event_name: "PreToolUse",
  tool_name: "mcp__eren-ajanda__ajanda_ekle",
  tool_input: { tur: "not", baslik: "GIZLI-BASLIK" },
  tool_use_id: ARAC_ID,
  mcp_server: { name: "eren-ajanda", source: "user" },
};

test("araç öncesi kanca girdisi: servise yalnız gerekli alanlar; araç girdisi gitmez; hepsi şemadan geçer", () => {
  const a0 = pcAracKancaGirdisi(ANA_ARAC, "cli");
  assert.deepEqual(a0, {
    fiil: "pc_arac",
    girdi: {
      uyarlayici: { ad: "claude-code", surum: 1 },
      cagri_id: ARAC_ID,
      oturum_id: OTURUM,
      istem_id: ANA_ARAC.prompt_id,
      aktor: "ana",
      etkilesim: "etkilesimli",
    },
  });
  assert.ok(a0 !== null && semadanGecer(a0));
  assert.ok(!kancaIstekSatiri("kanca_1", a0).includes("GIZLI"), "araç girdisi servise gitti");
  // Alt agent (ön plan ya da arka plan): `agent_id` ve `agent_type` dolu (ölçüldü).
  const alt = pcAracKancaGirdisi({ ...ANA_ARAC, agent_id: "a690393e919d1ad35", agent_type: "general-purpose" }, "cli");
  assert.ok(alt !== null && alt.girdi.aktor === "alt" && semadanGecer(alt));
  // Beklenmeyen biçim güvenli tarafa düşer: iki alandan biri hangi değerle olursa olsun varsa alt agent.
  // (Ölçülen: ana ajanın girdisinde ikisi de hiç yoktur.)
  for (const ek of [
    { agent_id: "" },
    { agent_id: null },
    { agent_id: 0 },
    { agent_id: 42 },
    { agent_id: false },
    { agent_id: {} },
    { agent_id: [] },
    { agent_type: "general-purpose" },
    { agent_type: "" },
    { agent_id: "", agent_type: null },
  ]) {
    const r = pcAracKancaGirdisi({ ...ANA_ARAC, ...ek }, "cli");
    assert.ok(r !== null && r.girdi.aktor === "alt" && semadanGecer(r), JSON.stringify(ek));
  }
  assert.equal(a0.girdi.aktor, "ana", "iki alan da yoksa ana ajan");
  // İstem kimliği yoksa ya da geçersizse düşer (tasdik yine gider).
  const { prompt_id: _p, ...kimliksiz } = ANA_ARAC;
  assert.equal(pcAracKancaGirdisi(kimliksiz, "cli")?.girdi.istem_id, undefined);
  assert.equal(pcAracKancaGirdisi({ ...ANA_ARAC, prompt_id: "boşluklu id" }, "cli")?.girdi.istem_id, undefined);
  // Başka araç, başka sunucu, bozuk kimlik ya da girdi: tasdik yok.
  for (const kotu of [
    { ...ANA_ARAC, tool_name: "Bash" },
    { ...ANA_ARAC, tool_name: "mcp__eren-ajanda__ajanda_sil" },
    { ...ANA_ARAC, tool_name: "mcp__baska__ajanda_ekle" },
    { ...ANA_ARAC, tool_use_id: "boşluklu id" },
    { ...ANA_ARAC, tool_use_id: "x".repeat(129) },
    { ...ANA_ARAC, session_id: "geçersiz kimlik" },
    "metin",
    [ANA_ARAC],
    null,
  ]) {
    assert.equal(pcAracKancaGirdisi(kotu, "cli"), null, JSON.stringify(kotu).slice(0, 80));
  }
});

test("normalize tasdik çerçevesi: yeni ve eski çerçeve geçer, karışığı geçmez; bilinmiyor ve bilinmeyen uyarlayıcı biçimce geçer", () => {
  const yeni = {
    uyarlayici: { ad: "claude-code", surum: 1 },
    cagri_id: ARAC_ID,
    oturum_id: OTURUM,
    aktor: "ana",
    etkilesim: "etkilesimli",
  };
  const eski = { oturum_id: OTURUM, arac_cagri_id: ARAC_ID, alt_agent: false, etkilesimsiz: false };
  const satir = (girdi: unknown) => JSON.stringify({ v, type: "istek", istek_id: "i1", fiil: "pc_arac", girdi });
  assert.equal(pcKancaYukariCoz(satir(yeni)).ok, true);
  assert.equal(pcKancaYukariCoz(satir({ ...yeni, istem_id: "p-1", surec_id: "3060" })).ok, true);
  assert.equal(pcKancaYukariCoz(satir(eski)).ok, true, "eski kanca süreci");
  // Karışık ya da eksik çerçeve, tur ilanı, kapalı listede olmayan aktör/etkileşim: geçmez (kanca bağlantısı kapanır → taslak).
  for (const kotu of [
    { ...yeni, alt_agent: false },
    { ...eski, aktor: "ana" },
    { ...yeni, tur_kokeni: "insan" },
    { ...yeni, aktor: "insan" },
    { ...yeni, etkilesim: "evet" },
    { ...yeni, uyarlayici: "claude-code" },
    { ...yeni, uyarlayici: { ad: "claude-code" } },
    { ...yeni, uyarlayici: { ad: "claude-code", surum: 0 } },
    { ...yeni, uyarlayici: { ad: "claude code", surum: 1 } },
    { ...yeni, surec_id: "boş luk" },
    (({ aktor: _a, ...r }) => r)(yeni),
    (({ etkilesim: _e, ...r }) => r)(yeni),
  ]) {
    assert.equal(pcKancaYukariCoz(satir(kotu)).ok, false, JSON.stringify(kotu));
  }
  // `bilinmiyor` ve tanınmayan uyarlayıcı biçimce geçer; kararı servis verir (taslak).
  for (const iyi of [{ ...yeni, aktor: "bilinmiyor" }, { ...yeni, etkilesim: "bilinmiyor" }, { ...yeni, uyarlayici: { ad: "baska-harness", surum: 3 } }]) {
    assert.equal(pcKancaYukariCoz(satir(iyi)).ok, true, JSON.stringify(iyi));
  }
  assert.deepEqual([...PC_AKTORLER], ["ana", "alt", "bilinmiyor"]);
  assert.deepEqual([...PC_ETKILESIMLER], ["etkilesimli", "etkilesimsiz", "bilinmiyor"]);
});

test("uyarlayıcılar kapalı listedir: varsayılan claude-code; bilinmeyen ad ya da daha yeni sürüm tanınmaz", () => {
  assert.deepEqual(PC_UYARLAYICILARI, { "claude-code": 1 });
  assert.equal(PC_VARSAYILAN_UYARLAYICI, "claude-code");
  assert.equal(pcUyarlayiciTanindiMi("claude-code", 1), true);
  for (const [ad, surum] of [
    ["claude-code", 2],
    ["claude-code", 0],
    ["claude-code", 1.5],
    ["claude-code", "1"],
    ["codex", 1],
    ["toString", 1],
    ["__proto__", 1],
    ["", 1],
    [undefined, 1],
  ] as const) {
    assert.equal(pcUyarlayiciTanindiMi(ad, surum), false, `${String(ad)} ${String(surum)}`);
  }
  assert.equal(pcUyarlayiciAdiMi("claude-code"), true);
  assert.equal(pcUyarlayiciAdiMi("hasOwnProperty"), false);
});

test("T1: tasdik alanlarını model ya da araç girdisi belirleyemez; süreç kimliği yalnız kanca ortamından", () => {
  const temel = pcAracKancaGirdisi(ANA_ARAC, "cli");
  // Kanca JSON'una eklenmiş normalize alan adları ve araç girdisindeki taklitler çerçeveyi değiştirmez.
  const taklit = {
    ...ANA_ARAC,
    aktor: "ana",
    etkilesim: "etkilesimli",
    uyarlayici: { ad: "baska", surum: 9 },
    cagri_id: "toolu_SAHTE",
    surec_id: "1",
    alt_agent: false,
    etkilesimsiz: false,
    tool_input: { session_id: "sahte-oturum", tool_use_id: "toolu_SAHTE", agent_id: "x", aktor: "ana", surec_id: "1" },
  };
  assert.deepEqual(pcAracKancaGirdisi(taklit, "cli"), temel);
  // Alt agent'ın girdisindeki `aktor: ana` ana ajan yapmaz.
  assert.equal(pcAracKancaGirdisi({ ...taklit, agent_id: "a-1" }, "cli")?.girdi.aktor, "alt");
  // Süreç kimliği üçüncü argümandan (kanca sürecinin `CLAUDE_PID`'i); geçersizse çerçeveye girmez.
  assert.equal(CLAUDE_CODE_SUREC_ORTAMI, "CLAUDE_PID");
  const s = pcAracKancaGirdisi(ANA_ARAC, "cli", "3060");
  assert.ok(s !== null && s.girdi.surec_id === "3060" && semadanGecer(s));
  for (const kotu of [undefined, "", "boş luk", 3060, "x".repeat(65), {}]) {
    const r = pcAracKancaGirdisi(ANA_ARAC, "cli", kotu);
    assert.ok(r !== null && !("surec_id" in r.girdi), String(kotu));
  }
});

test("etkileşimsiz giriş: yalnız -p ve Agent SDK; etkileşimli ve bilinmeyen değerler etkileşimli sayılır", () => {
  assert.equal(CLAUDE_CODE_GIRIS_ORTAMI, "CLAUDE_CODE_ENTRYPOINT");
  assert.deepEqual([...PC_ETKILESIMSIZ_GIRISLER], ["sdk-cli", "sdk-ts", "sdk-py"]);
  for (const g of ["sdk-cli", "sdk-ts", "sdk-py"]) {
    assert.equal(pcEtkilesimsizMi(g), true, g);
    const r = pcAracKancaGirdisi(ANA_ARAC, g);
    assert.ok(r !== null && r.girdi.etkilesim === "etkilesimsiz" && semadanGecer(r), g);
  }
  for (const g of ["cli", "claude-desktop", "claude-vscode", "SDK-CLI", "", undefined, 3]) {
    assert.equal(pcEtkilesimsizMi(g), false, String(g));
    assert.equal(pcAracKancaGirdisi(ANA_ARAC, g)?.girdi.etkilesim, "etkilesimli", String(g));
  }
});

test("kanca çekirdeği bağımlılıksızdır ve şemalı eşleriyle aynıdır", () => {
  const kaynak = readFileSync(new URL("../src/ajanda-pc-kanca.ts", import.meta.url), "utf8");
  const aktarimlar = [...kaynak.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/gm)].map((e) => e[1]);
  assert.deepEqual(aktarimlar, ["./sinirlar.ts"]);
  const sinirlar = readFileSync(new URL("../src/sinirlar.ts", import.meta.url), "utf8");
  assert.equal(/\bimport\b/.test(sinirlar.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), false, "sinirlar.ts içe aktarma yapmaz");
  assert.equal(Kanca.AJANDA_BORU_ADI, AJANDA_BORU_ADI);
  assert.deepEqual([...PC_KANCA_ARAC_FIILLERI], [...AJANDA_ROL_FIILLERI.pc_oturumu]);
  // Kimlik ve jeton kalıpları: elle yazılmış denetim zod şemasıyla aynı kararı verir.
  const ornekler = ["a", "A-z_09", "x".repeat(32), "x".repeat(43), "x".repeat(64), "x".repeat(65), "x".repeat(128), "x".repeat(129), "", "boş luk", "ğ", "a.b", "toolu_01Ab"];
  for (const o of ornekler) {
    const opak = pcAracKancaGirdisi({ ...ANA_ARAC, session_id: o }, "cli") !== null;
    assert.equal(opak, OpakId.safeParse(o).success, `OpakId ${o}`);
    const istem = pcAracKancaGirdisi({ ...ANA_ARAC, prompt_id: o }, "cli")?.girdi.istem_id !== undefined;
    assert.equal(istem, OpakId.safeParse(o).success, `istem OpakId ${o}`);
    const arac = pcAracKancaGirdisi({ ...ANA_ARAC, tool_use_id: o }, "cli") !== null;
    assert.equal(arac, AracCagriId.safeParse(o).success, `AracCagriId ${o}`);
    assert.equal(pcJetonuMu(o), Jeton.safeParse(o).success, `Jeton ${o}`);
  }
});

test("kanca satırları: hello ve istek şemaya uyar; aşağı yön yalnız gereken kadar okunur", () => {
  assert.equal(pcKancaYukariCoz(kancaHelloSatiri(JETON)).ok, true);
  const id = "kanca_1";
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "kopru_welcome", rol: "pc_kanca" }), id), { tur: "karsilandi" });
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "kopru_welcome", rol: "pc_oturumu" }), id), { tur: "bozuk" });
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "kopru_ret", code: "jeton_gecersiz" }), id), { tur: "ret" });
  const sonuc = {};
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "yanit", istek_id: id, ok: true, sonuc }), id), { tur: "yanit", sonuc });
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "yanit", istek_id: id, ok: false, code: "ic_hata" }), id), { tur: "hata" });
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "yanit", istek_id: "baska", ok: true, sonuc }), id), { tur: "ilgisiz" });
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v: 2, type: "kopru_welcome", rol: "pc_kanca" }), id), { tur: "bozuk" });
  assert.deepEqual(kancaAsagiCoz("{bozuk", id), { tur: "bozuk" });
  assert.deepEqual(kancaAsagiCoz("x".repeat(KANCA_AZAMI_SATIR + 1), id), { tur: "bozuk" });
});

test("tur kararı: köprüye dönen sonuç katıdır; sentetik her karar sabit bir neden metni taşır", () => {
  assert.equal(PC_TUR_KARARLARI[0], "insan");
  assert.equal(PcAracSonucu.safeParse({ cikti: { sonuc: "eklendi" }, karar: "insan" }).success, true);
  assert.equal(PcAracSonucu.safeParse({ cikti: {}, karar: "insanmis" }).success, false);
  assert.equal(PcAracSonucu.safeParse({ cikti: {}, karar: "insan", tur_kokeni: "insan" }).success, false);
  assert.deepEqual([...PC_TUR_KARARLARI], ["insan", "cagri_kimligi_yok", "tasdik_yok", "alt_agent", "etkilesimsiz"]);
  assert.equal(pcTurNotu("insan"), null);
  for (const k of PC_TUR_KARARLARI.slice(1)) {
    const n = pcTurNotu(k);
    assert.ok(n !== null && n.startsWith(`pc_tur: sentetik (${k}).`), k);
    assert.ok(n.includes(PC_TUR_NEDENI_METNI[k as Exclude<typeof k, "insan">]), k);
    assert.ok(n.includes("--teshis"));
    assert.equal(/[\n\r]/.test(n), false, "tek satır");
  }
});

/**
 * Yükseltme penceresi (yeni kanca, eski servis). Kanca her ajanda çağrısında `guncel` junction'ından taze
 * başlar; `kurulum/kur.ts` junction'ı servisi yeniden başlatmadan ÖNCE çevirir. O arada yeni kanca hâlâ
 * çalışan H1 öncesi servise gider. Bu test o servisin yukarı şemasının SABİT KOPYASINI kullanır
 * (`git show 460ccbf^:apps/phone/protocol/src/ajanda-pc.ts`, `PcAracGirdi` → `PcKancaIstek` →
 * `PcKancaYukari`). Kopya bugünkü yapı taşlarıyla kurulur (`mesaj`, `OpakId`, `AracCagriId`,
 * `AjandaKopruHello`, `cozumle`, `AJANDA_AZAMI_CERCEVE`, `PROTOKOL_SURUMU`); bunlar 460ccbf^'dan bu yana
 * değişmedi (`git diff 460ccbf^ -- protocol/src/{temel,ajanda-arac,cozumle}.ts` boş, sınırlardaki ilgili
 * sabitler aynı).
 *
 * Kanıtlanan: (1) yeni kancanın ürettiği istek satırı (`pcAracKancaGirdisi` + `kancaIstekSatiri`, süreç
 * kimliğiyle de, onsuz da) eski şemadan GEÇMEZ; hello satırı geçer (anahtar kabul edilir, istek düşer);
 * (2) aynı çağrının eski çerçevesi eski şemadan geçer (kopya her şeyi reddetmiyor); (3) kopyanın alanları
 * bugünkü servisin kabul ettiği eski çerçeveyle (`PcEskiAracGirdi`) birebir aynı. Sonucun taslak olması
 * eski servisin kodundandır (460ccbf^ `ajanda-kopru-sunucu.ts` `kancaIsle`): şemadan geçmeyen satırda
 * `gecersiz_cerceve` yazar, bağlantıyı kapatır, `pc_arac` işleyicisini çağırmaz; tasdik kaydedilmez,
 * köprünün çağrısı `tasdik_yok` kararını alır (taslak). Kanca bağlantı kapanınca sessiz çıkar
 * (`server/test/ajanda-pc-yan.test.ts` "eski servis" sınar). Güvenli taraftır: pencere insan turu açamaz.
 */
test("yükseltme penceresi: yeni kancanın çerçevesi H1 öncesi servisin şemasından geçmez (taslak, güvenli taraf)", () => {
  const EskiPcAracGirdi = z.strictObject({
    oturum_id: OpakId,
    istem_id: OpakId.optional(),
    arac_cagri_id: AracCagriId,
    alt_agent: z.boolean(),
    etkilesimsiz: z.boolean(),
  });
  const EskiPcKancaIstek = mesaj("istek", { istek_id: OpakId, fiil: z.literal("pc_arac"), girdi: EskiPcAracGirdi });
  const EskiPcKancaYukari = z.discriminatedUnion("type", [AjandaKopruHello, EskiPcKancaIstek]);
  const eskiServisCoz = (ham: string) => cozumle(EskiPcKancaYukari, ham, AJANDA_AZAMI_CERCEVE.BORU, PROTOKOL_SURUMU);

  // (3) Kopya, bugünkü servisin eski çerçeve olarak kabul ettiğiyle aynı alanlar.
  assert.deepEqual(Object.keys(EskiPcAracGirdi.shape).sort(), Object.keys(PcEskiAracGirdi.shape).sort());

  const ham = { session_id: OTURUM, prompt_id: "p-1", tool_name: "mcp__eren-ajanda__ajanda_ekle", tool_use_id: ARAC_ID, tool_input: {} };
  assert.equal(eskiServisCoz(kancaHelloSatiri(JETON)).ok, true, "hello eski serviste de geçer");
  for (const surec of [undefined, "3060"]) {
    const istek = pcAracKancaGirdisi(ham, "cli", surec);
    assert.ok(istek !== null);
    const satir = kancaIstekSatiri("kanca_1", istek);
    // Yeni servis geçirir; eski servis geçirmez (bağlantıyı kapatır → tasdik yok → taslak).
    assert.equal(pcKancaYukariCoz(satir).ok, true, `yeni servis (surec ${String(surec)})`);
    const eski = eskiServisCoz(satir);
    assert.equal(eski.ok, false, `eski servis yeni çerçeveyi geçirdi (surec ${String(surec)})`);
  }
  // (2) Aynı çağrının H1 öncesi kancanın yolladığı çerçevesi eski şemadan geçer (ve bugünkü servisten de).
  const eskiCerceve = JSON.stringify({
    v,
    type: "istek",
    istek_id: "kanca_1",
    fiil: "pc_arac",
    girdi: { oturum_id: OTURUM, istem_id: "p-1", arac_cagri_id: ARAC_ID, alt_agent: false, etkilesimsiz: false },
  });
  assert.equal(eskiServisCoz(eskiCerceve).ok, true, "eski kopya her şeyi reddediyor");
  assert.equal(pcKancaYukariCoz(eskiCerceve).ok, true, "geri alma penceresi: yeni servis eski kancayı kabul eder");
});
