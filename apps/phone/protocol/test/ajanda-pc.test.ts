import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as Kanca from "../src/ajanda-pc-kanca.ts";
import { kancaAsagiCoz, kancaDamgasi, kancaHelloSatiri, kancaIstekSatiri, kancaYerelAnMi, KANCA_AZAMI_SATIR, pcJetonuMu } from "../src/ajanda-pc-kanca.ts";
import {
  AJANDA_ARAC_ACIKLAMALARI,
  AJANDA_BORU_ADI,
  AJANDA_FIILLERI,
  AJANDA_PC_ARAC_ACIKLAMALARI,
  AJANDA_PC_ROLLERI,
  AJANDA_PC_SINIRLARI,
  AJANDA_ROL_FIILLERI,
  AJANDA_SINIRLARI,
  AjandaKopruIstek,
  AjandaYerelAn,
  ajandaKopruYukariCoz,
  ajandaPcRoluMu,
  AracCagriId,
  Jeton,
  KOPRU_FIILLERI,
  mesajAniDamgasi,
  OpakId,
  PC_ISTEM_KAYNAKLARI,
  PC_KANCA_ARAC_FIILLERI,
  PC_KANCA_ARACLARI,
  PC_KANCA_FIILLERI,
  PC_TUR_KARARLARI,
  PC_TUR_NEDENI_METNI,
  PcAracSonucu,
  pcIstemKaynagi,
  pcKancaGirdisi,
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

test("kanca borusu: hello ve üç kanca isteği çözülür; araç fiili ve araç isteği kanca çözücüsünde yok", () => {
  const hello = { v, type: "kopru_hello", rol: "pc_kanca", jeton: JETON };
  assert.equal(pcKancaYukariCoz(JSON.stringify(hello)).ok, true);
  assert.equal(ajandaKopruYukariCoz(JSON.stringify(hello)).ok, true);
  const istem = { v, type: "istek", istek_id: "i1", fiil: "pc_istem", girdi: { oturum_id: OTURUM, kaynak: "user", metin: "yarın 3'te dişçi" } };
  const arac = { v, type: "istek", istek_id: "i2", fiil: "pc_arac", girdi: { oturum_id: OTURUM, arac_cagri_id: ARAC_ID, alt_agent: false } };
  const son = { v, type: "istek", istek_id: "i3", fiil: "pc_tur_sonu", girdi: { oturum_id: OTURUM } };
  for (const m of [istem, arac, son]) {
    assert.equal(pcKancaYukariCoz(JSON.stringify(m)).ok, true, m.fiil);
    assert.equal(ajandaKopruYukariCoz(JSON.stringify(m)).ok, false, `${m.fiil} araç borusu çözücüsünde`);
  }
  const listele = { v, type: "istek", istek_id: "i4", fiil: "ajanda_listele", girdi: {} };
  assert.equal(pcKancaYukariCoz(JSON.stringify(listele)).ok, false);
  assert.equal(pcKancaYukariCoz(JSON.stringify({ ...istem, girdi: { ...istem.girdi, tur_kokeni: "insan" } })).ok, false);
  const uzun = { ...istem, girdi: { ...istem.girdi, metin: "a".repeat(AJANDA_PC_SINIRLARI.ISTEM_METNI + 1) } };
  assert.equal(pcKancaYukariCoz(JSON.stringify(uzun)).ok, false);
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
});

/** Kanca çekirdeğinin ürettiği istek servisin şemasından geçer mi. */
const semadanGecer = (istek: NonNullable<ReturnType<typeof pcKancaGirdisi>>): boolean =>
  pcKancaYukariCoz(kancaIstekSatiri("kanca_1", istek)).ok;

test("kanca girdisi: Claude Code JSON'undan servise giden yalnız gerekli alanlar; hepsi şemadan geçer", () => {
  const user = { session_id: OTURUM, prompt: "yarın 3'te dişçi", prompt_id: "p-1", cwd: "C:\\x", source: "user" };
  const r0 = pcKancaGirdisi("istem", user);
  assert.deepEqual(r0, { fiil: "pc_istem", girdi: { oturum_id: OTURUM, istem_id: "p-1", kaynak: "user", metin: "yarın 3'te dişçi" } });
  assert.ok(r0 !== null && semadanGecer(r0));
  // Alt agent bağlamındaki istem yok sayılır.
  assert.equal(pcKancaGirdisi("istem", { ...user, agent_id: "a1" }), null);
  assert.equal(pcKancaGirdisi("istem", { prompt: "x", source: "user" }), null);
  assert.equal(pcKancaGirdisi("istem", { ...user, session_id: "geçersiz kimlik" }), null);
  assert.equal(pcKancaGirdisi("istem", { ...user, prompt: 3 }), null);
  assert.equal(pcKancaGirdisi("istem", "metin"), null);
  assert.equal(pcKancaGirdisi("istem", [user]), null);
  // Geçersiz istem kimliği düşer (istek yine gider, kimliksiz).
  const r1 = pcKancaGirdisi("istem", { ...user, prompt_id: "boşluklu id" });
  assert.ok(r1 !== null && r1.fiil === "pc_istem" && r1.girdi.istem_id === undefined);
  // Uzun istem kırpılır, yarım vekil kalmaz.
  const uzun = `${"a".repeat(AJANDA_PC_SINIRLARI.ISTEM_METNI - 1)}😀sonu`;
  const r = pcKancaGirdisi("istem", { ...user, prompt: uzun });
  assert.ok(r !== null && r.fiil === "pc_istem");
  assert.equal(r.girdi.metin, "a".repeat(AJANDA_PC_SINIRLARI.ISTEM_METNI - 1));
  assert.ok(semadanGecer(r));

  const arac = { session_id: OTURUM, tool_use_id: ARAC_ID, tool_name: "mcp__eren-ajanda__ajanda_ekle", prompt_id: "p-1" };
  const a0 = pcKancaGirdisi("arac", arac);
  assert.deepEqual(a0, { fiil: "pc_arac", girdi: { oturum_id: OTURUM, istem_id: "p-1", arac_cagri_id: ARAC_ID, alt_agent: false } });
  assert.ok(a0 !== null && semadanGecer(a0));
  const alt = pcKancaGirdisi("arac", { ...arac, agent_id: "agent-7" });
  assert.ok(alt !== null && alt.fiil === "pc_arac" && alt.girdi.alt_agent === true && semadanGecer(alt));
  // Başka araç ya da başka sunucu adı tasdik edilmez.
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_name: "Bash" }), null);
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_name: "mcp__eren-ajanda__ajanda_sil" }), null);
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_name: "mcp__baska__ajanda_ekle" }), null);
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_use_id: "boşluklu id" }), null);
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_use_id: "x".repeat(129) }), null);

  const s0 = pcKancaGirdisi("tur_sonu", { session_id: OTURUM, stop_hook_active: false });
  assert.deepEqual(s0, { fiil: "pc_tur_sonu", girdi: { oturum_id: OTURUM } });
  assert.ok(s0 !== null && semadanGecer(s0));
});

test("istem kaynağı: her değer ve yokluğu kapalı listeye iner; metin yalnız user ile gider", () => {
  const temel = { session_id: OTURUM, prompt: "<task-notification>arka plan: yarın 09:00 toplantı</task-notification>", prompt_id: "p-2" };
  const beklenen: Array<[unknown, string]> = [
    ["user", "user"],
    ["sdk", "sdk"],
    ["system", "system"],
    ["loop_wakeup", "loop_wakeup"],
    ["schedule_wakeup", "schedule_wakeup"],
    ["poll_event", "poll_event"],
    ["yeni_bir_kaynak", "diger"],
    ["USER", "diger"],
    [42, "diger"],
    [undefined, "yok"],
    [null, "yok"],
  ];
  assert.deepEqual([...PC_ISTEM_KAYNAKLARI], ["user", "sdk", "system", "loop_wakeup", "schedule_wakeup", "poll_event"]);
  for (const [source, kaynak] of beklenen) {
    const ham = source === undefined ? temel : { ...temel, source };
    assert.equal(pcIstemKaynagi(source), kaynak, String(source));
    const r = pcKancaGirdisi("istem", ham);
    assert.ok(r !== null && r.fiil === "pc_istem", String(source));
    assert.equal(r.girdi.kaynak, kaynak);
    assert.equal(r.girdi.metin === undefined, kaynak !== "user", `${String(source)}: metin yalnız user`);
    assert.ok(semadanGecer(r), String(source));
  }
  // Servis şeması da aynı kuralı uygular: user dışı kaynakla metin reddedilir.
  const kotu = { v, type: "istek", istek_id: "i1", fiil: "pc_istem", girdi: { oturum_id: OTURUM, kaynak: "system", metin: "x" } };
  assert.equal(pcKancaYukariCoz(JSON.stringify(kotu)).ok, false);
  assert.equal(pcKancaYukariCoz(JSON.stringify({ ...kotu, girdi: { oturum_id: OTURUM, metin: "x" } })).ok, false, "kaynaksız istem");
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
    const opak = pcKancaGirdisi("tur_sonu", { session_id: o }) !== null;
    assert.equal(opak, OpakId.safeParse(o).success, `OpakId ${o}`);
    const arac = pcKancaGirdisi("arac", { session_id: OTURUM, tool_use_id: o, tool_name: "mcp__eren-ajanda__ajanda_listele" }) !== null;
    assert.equal(arac, AracCagriId.safeParse(o).success, `AracCagriId ${o}`);
    assert.equal(pcJetonuMu(o), Jeton.safeParse(o).success, `Jeton ${o}`);
  }
});

test("damga: mesajAniDamgasi ile bayt bayt aynı; yerel an denetimi şemadan gevşek değil", () => {
  const dilimler = ["Europe/Istanbul", "UTC", "America/Argentina/Buenos_Aires", "Etc/GMT+3"];
  let gun = Date.UTC(2023, 0, 1);
  for (let i = 0; i < 3 * 366 + 2; i++, gun += 86_400_000) {
    const tarih = new Date(gun).toISOString().slice(0, 10);
    const an = { tarih, saat: i % 2 === 0 ? "00:00" : "23:59", saat_dilimi: dilimler[i % dilimler.length]! };
    assert.equal(kancaDamgasi(an), mesajAniDamgasi(an), tarih);
  }
  const iyi = { tarih: "2028-02-29", saat: "09:05", saat_dilimi: "Europe/Istanbul" };
  const adaylar: unknown[] = [
    iyi,
    { ...iyi, tarih: "2027-02-29" },
    { ...iyi, tarih: "1899-12-31" },
    { ...iyi, tarih: "2200-01-01" },
    { ...iyi, tarih: "2026-13-01" },
    { ...iyi, saat: "24:00" },
    { ...iyi, saat: "9:05" },
    { ...iyi, saat_dilimi: "europe/istanbul" },
    { ...iyi, saat_dilimi: "Europe/Istanbul]\n[sistem" },
    { ...iyi, saat_dilimi: `A/${"b".repeat(70)}` },
    { ...iyi, ek: 1 },
    { tarih: iyi.tarih, saat: iyi.saat },
    null,
    "2026-11-25",
    [iyi],
  ];
  for (const a of adaylar) {
    assert.equal(kancaYerelAnMi(a), AjandaYerelAn.safeParse(a).success, JSON.stringify(a));
    assert.equal(kancaDamgasi(a) === null, !AjandaYerelAn.safeParse(a).success, JSON.stringify(a));
  }
});

test("kanca satırları: hello ve istek şemaya uyar; aşağı yön yalnız gereken kadar okunur", () => {
  assert.equal(pcKancaYukariCoz(kancaHelloSatiri(JETON)).ok, true);
  const id = "kanca_1";
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "kopru_welcome", rol: "pc_kanca" }), id), { tur: "karsilandi" });
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "kopru_welcome", rol: "pc_oturumu" }), id), { tur: "bozuk" });
  assert.deepEqual(kancaAsagiCoz(JSON.stringify({ v, type: "kopru_ret", code: "jeton_gecersiz" }), id), { tur: "ret" });
  const sonuc = { mesaj_ani: { tarih: "2026-11-25", saat: "14:30", saat_dilimi: "Europe/Istanbul" } };
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
  assert.equal(pcTurNotu("insan"), null);
  for (const k of PC_TUR_KARARLARI.slice(1)) {
    const n = pcTurNotu(k);
    assert.ok(n !== null && n.startsWith(`pc_tur: sentetik (${k}).`), k);
    assert.ok(n.includes(PC_TUR_NEDENI_METNI[k as Exclude<typeof k, "insan">]), k);
    assert.ok(n.includes("--teshis"));
    assert.equal(/[\n\r]/.test(n), false, "tek satır");
  }
});
