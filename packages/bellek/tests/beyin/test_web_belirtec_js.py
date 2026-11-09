"""web/api.js belirteç saklama: tarayıcı sekmesinde yalnız sessionStorage, ana ekran
uygulamasında (standalone) localStorage; yapıştırılan anahtar/adres ayrıştırılır.
Node yoksa atlanır (çekirdek yalnız stdlib; bu test yalnız istemci JS'ini sınar)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

API = Path(__file__).resolve().parents[2] / "src" / "bellek" / "beyin" / "web" / "api.js"
NODE = shutil.which("node")

BETIK = r"""
const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),_m:m}};
globalThis.sessionStorage=mk(); globalThis.localStorage=mk();
globalThis.matchMedia=()=>({matches:process.argv[3]==='1'});
globalThis.location={hash:'',pathname:'/',search:''}; globalThis.history={replaceState(){}};
const url=process.argv[2];
const m=await import(url);
const t='a1'.repeat(32);
const r={standalone:m.bagimsizMod, kotu:m.belirtecKaydet('merhaba'), kisa:m.belirtecKaydet('#t=abc')};
r.adres=m.belirtecKaydet('http://mac.ts.net/#t='+t);
r.var=m.belirtecVar();
r.kalici=localStorage.getItem('beyin_arayuz')===t;
sessionStorage._m.clear();
const m2=await import(url+'?yeniden');
r.yenidenAcilis=m2.belirtecVar();
m.belirtecSil();
r.silindi=localStorage.getItem('beyin_arayuz')===null && sessionStorage.getItem('beyin_arayuz')===null;
console.log(JSON.stringify(r));
"""


def _calistir(tmp_path, bagimsiz: bool) -> dict:
    betik = tmp_path / "t.mjs"
    betik.write_text(BETIK, encoding="utf-8")
    p = subprocess.run([NODE, str(betik), API.as_uri(), "1" if bagimsiz else "0"],
                       capture_output=True, text=True, timeout=30)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


@pytest.mark.skipif(NODE is None, reason="node yok")
def test_sekmede_belirtec_kalici_degil(tmp_path):
    r = _calistir(tmp_path, False)
    assert r == {"standalone": False, "kotu": False, "kisa": False, "adres": True, "var": True,
                 "kalici": False, "yenidenAcilis": False, "silindi": True}


@pytest.mark.skipif(NODE is None, reason="node yok")
def test_ana_ekran_uygulamasinda_belirtec_kalici(tmp_path):
    r = _calistir(tmp_path, True)
    assert r == {"standalone": True, "kotu": False, "kisa": False, "adres": True, "var": True,
                 "kalici": True, "yenidenAcilis": True, "silindi": True}
