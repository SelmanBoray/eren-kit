"""web/gelen.js saf yardımcıları: karar isteğinin düzeltme gövdesi ve "zaten karara bağlanmış"
yanıtının yorumu (yeniden denemede aynı karar başarı sayılır). Node yoksa atlanır."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from bellek.beyin import yaz

GELEN = Path(__file__).resolve().parents[2] / "src" / "bellek" / "beyin" / "web" / "gelen.js"
NODE = shutil.which("node")

BETIK = r"""
const m = await import(process.argv[2]);
const d = m.duzeltmeKur, z = m.zatenKararli;
const gizli = {baslik: 'Eski', ebeveyn: null};
const acik = {baslik: 'Eski', ebeveyn: 'Okul/Dersler'};
const r = {
  sinir: m.BASLIK_SINIRI,
  bos: d(acik, '  ', ''),
  yalnizBaslikAcik: d(acik, ' Yeni ', ''),
  yalnizBaslikGizli: d(gizli, 'Yeni', ''),
  ikisiGizli: d(gizli, 'Yeni', 'Okul'),
  yalnizUstBasliksiz: d({baslik: null, ebeveyn: null}, '', 'Okul'),
  uzun: d(acik, 'x'.repeat(121), ''),
  tamSinir: d(acik, 'ç'.repeat(120), '').duzeltme.baslik.length,
  ayni: z({kod: 400, message: 'gelen #7 zaten karara bağlanmış (kabul).'}, 'kabul'),
  farkli: z({kod: 400, message: 'gelen #7 zaten karara bağlanmış (red).'}, 'kabul'),
  baska400: z({kod: 400, message: 'başlık 130 karakter, sınır 120.'}, 'kabul'),
  ag: z({kod: 0, message: 'İstek zaman aşımına uğradı.'}, 'red'),
  bosHata: z(null, 'red'),
};
console.log(JSON.stringify(r));
"""


@pytest.mark.skipif(NODE is None, reason="node yok")
def test_gelen_saf_yardimcilar(tmp_path):
    betik = tmp_path / "t.mjs"
    betik.write_text(BETIK, encoding="utf-8")
    p = subprocess.run([NODE, str(betik), GELEN.as_uri()],
                       capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout)
    assert r["sinir"] == yaz.BASLIK_SINIRI
    assert r["bos"] == {"duzeltme": None}
    assert r["yalnizBaslikAcik"] == {"duzeltme": {"ebeveyn": "Okul/Dersler", "baslik": "Yeni"}}
    # Gizli ebeveynde boş ebeveyn gönderilmez (sunucu 400 verirdi); eksik alan bildirilir.
    assert r["yalnizBaslikGizli"] == {"eksik": "ebeveyn"}
    assert r["ikisiGizli"] == {"duzeltme": {"ebeveyn": "Okul", "baslik": "Yeni"}}
    assert r["yalnizUstBasliksiz"] == {"eksik": "baslik"}
    assert r["uzun"] == {"eksik": "baslik_uzun"}
    assert r["tamSinir"] == 120
    assert r["ayni"] == {"mevcut": "kabul", "ayni": True}
    assert r["farkli"] == {"mevcut": "red", "ayni": False}
    assert r["baska400"] is None
    assert r["ag"] is None
    assert r["bosHata"] is None


def test_zaten_karar_mesaji_sunucuyla_uyumlu():
    """zatenKararli'nın aradığı kalıp yaz.gelen_karar'ın mesajında duruyor (sözleşme kayması)."""
    kaynak = Path(yaz.__file__).read_text(encoding="utf-8")
    assert "zaten karara bağlanmış ({gdurum})." in kaynak
    assert "zaten karara bağlanmış \\(" in GELEN.read_text(encoding="utf-8")
