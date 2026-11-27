import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AJANDA_ARAC_ACIKLAMALARI,
  AJANDA_FIILLERI,
  AJANDA_PC_ARAC_ACIKLAMALARI,
  AJANDA_PC_ROLLERI,
  AJANDA_PC_SINIRLARI,
  AJANDA_SINIRLARI,
  AjandaKopruIstek,
  ajandaKopruYukariCoz,
  ajandaPcRoluMu,
  KOPRU_FIILLERI,
  PC_KANCA_ARACLARI,
  PC_KANCA_FIILLERI,
  pcKancaGirdisi,
  pcKancaYukariCoz,
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
  const istem = { v, type: "istek", istek_id: "i1", fiil: "pc_istem", girdi: { oturum_id: OTURUM, metin: "yarın 3'te dişçi" } };
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

test("kanca girdisi: Claude Code JSON'undan servise giden yalnız gerekli alanlar", () => {
  const fiiller = [...AJANDA_FIILLERI];
  assert.deepEqual(pcKancaGirdisi("istem", { session_id: OTURUM, prompt: "yarın 3'te dişçi", prompt_id: "p-1", cwd: "C:\\x" }, fiiller), {
    fiil: "pc_istem",
    girdi: { oturum_id: OTURUM, istem_id: "p-1", metin: "yarın 3'te dişçi" },
  });
  // Alt agent bağlamındaki istem insan mesajı değildir.
  assert.equal(pcKancaGirdisi("istem", { session_id: OTURUM, prompt: "x", agent_id: "a1" }, fiiller), null);
  assert.equal(pcKancaGirdisi("istem", { prompt: "x" }, fiiller), null);
  assert.equal(pcKancaGirdisi("istem", { session_id: "geçersiz kimlik", prompt: "x" }, fiiller), null);
  assert.equal(pcKancaGirdisi("istem", "metin", fiiller), null);
  // Uzun istem kırpılır, yarım vekil kalmaz.
  const uzun = `${"a".repeat(AJANDA_PC_SINIRLARI.ISTEM_METNI - 1)}😀sonu`;
  const r = pcKancaGirdisi("istem", { session_id: OTURUM, prompt: uzun }, fiiller);
  assert.ok(r !== null && r.fiil === "pc_istem");
  assert.equal(r.girdi.metin, "a".repeat(AJANDA_PC_SINIRLARI.ISTEM_METNI - 1));

  const arac = { session_id: OTURUM, tool_use_id: ARAC_ID, tool_name: "mcp__eren-ajanda__ajanda_ekle", prompt_id: "p-1" };
  assert.deepEqual(pcKancaGirdisi("arac", arac, fiiller), {
    fiil: "pc_arac",
    girdi: { oturum_id: OTURUM, istem_id: "p-1", arac_cagri_id: ARAC_ID, alt_agent: false },
  });
  const alt = pcKancaGirdisi("arac", { ...arac, agent_id: "agent-7" }, fiiller);
  assert.ok(alt !== null && alt.fiil === "pc_arac" && alt.girdi.alt_agent === true);
  // Başka araç ya da başka sunucu adı tasdik edilmez.
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_name: "Bash" }, fiiller), null);
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_name: "mcp__eren-ajanda__ajanda_sil" }, fiiller), null);
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_name: "mcp__baska__ajanda_ekle" }, fiiller), null);
  assert.equal(pcKancaGirdisi("arac", { ...arac, tool_use_id: "boşluklu id" }, fiiller), null);

  assert.deepEqual(pcKancaGirdisi("tur_sonu", { session_id: OTURUM, stop_hook_active: false }, fiiller), {
    fiil: "pc_tur_sonu",
    girdi: { oturum_id: OTURUM },
  });
});
