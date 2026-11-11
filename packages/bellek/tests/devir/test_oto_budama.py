"""devir otomatik not budama, yazma ve boşluk engeli muafiyeti testleri (sözleşmeden yazıldı)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from bellek.devir import notlar
from bellek.devir.notlar import OTO_MAX_GUN, oto_not_yaz

SIMDI = datetime(2026, 11, 8, 12, 0, 0, tzinfo=timezone.utc)
HOOK = str(Path(__file__).resolve().parents[2] / "src" / "bellek" / "devir" / "hook.py")


def _iso(gun_once=0.0):
    return (SIMDI - timedelta(days=gun_once)).isoformat()


def _not_yaz(yol: Path, tur, oturum, gun_once, durum):
    yol.parent.mkdir(parents=True, exist_ok=True)
    yol.write_text(
        f"---\ntur: {tur}\noturum: {oturum}\nkonu: k {oturum}\nproje: C:\\X\n"
        f"tarih: {_iso(gun_once)}\ndurum: {durum}\n---\ngovde\n",
        encoding="utf-8",
    )
    return yol


def _oto(kok, oturum, gun_once):
    return _not_yaz(kok / "oto" / f"{oturum}.md", "otomatik", oturum, gun_once, "bilinmiyor")


def _ozet(**kw):
    o = dict(
        oturum="abc123", cwd="C:\\Proje", baslik="Devir sistemi", ilk_istem="ilk",
        son_istem="son", duzenlenen=["a.py"], son_baglam=1234,
        son_model="opus", son_zaman=_iso(0.5), istek_sayisi=7,
    )
    o.update(kw)
    return o


# ---------- budama ----------

def test_oto_budama_gun_sabiti():
    assert notlar.OTO_BUDAMA_GUN == 2 * OTO_MAX_GUN


def test_eski_oto_not_silinir(tmp_path):
    yol = _oto(tmp_path, "eski", notlar.OTO_BUDAMA_GUN + 1)
    assert notlar.oto_notlari_buda(tmp_path, simdi=SIMDI) == 1
    assert not yol.exists()


def test_siniri_altindaki_kalir(tmp_path):
    a = _oto(tmp_path, "a", notlar.OTO_BUDAMA_GUN - 1)
    b = _oto(tmp_path, "b", 1)
    assert notlar.oto_notlari_buda(tmp_path, simdi=SIMDI) == 0
    assert a.exists() and b.exists()


def test_zengin_notlara_dokunulmaz(tmp_path):
    z = _not_yaz(tmp_path / "zengin.md", "devir", "z", 1000, "bitti")
    _oto(tmp_path, "eski", notlar.OTO_BUDAMA_GUN + 5)
    notlar.oto_notlari_buda(tmp_path, simdi=SIMDI)
    assert z.exists()


def test_oto_klasoru_yoksa_sifir(tmp_path):
    assert notlar.oto_notlari_buda(tmp_path, simdi=SIMDI) == 0
    assert notlar.oto_notlari_buda(tmp_path / "yok", simdi=SIMDI) == 0


def test_beklenmeyen_icerik_silinmez_istisna_yok(tmp_path):
    oto = tmp_path / "oto"
    oto.mkdir()
    bozuk = oto / "bozuk.md"
    bozuk.write_text("on bilgisi olmayan metin\n", encoding="utf-8")
    alt = oto / "alt"
    alt.mkdir()
    (alt / "ic.md").write_text("x", encoding="utf-8")
    sonuc = notlar.oto_notlari_buda(tmp_path, simdi=SIMDI)
    assert isinstance(sonuc, int)
    assert bozuk.exists() and alt.is_dir() and (alt / "ic.md").exists()


def test_karisik_uc_eski_iki_yeni(tmp_path):
    eskiler = [_oto(tmp_path, f"e{i}", notlar.OTO_BUDAMA_GUN + 1 + i) for i in range(3)]
    yeniler = [_oto(tmp_path, f"y{i}", 1 + i) for i in range(2)]
    assert notlar.oto_notlari_buda(tmp_path, simdi=SIMDI) == 3
    assert all(not e.exists() for e in eskiler)
    kalan = sorted(p.name for p in (tmp_path / "oto").iterdir())
    assert kalan == sorted(y.name for y in yeniler)


# ---------- oto_not_yaz ----------

def test_ayni_icerik_yeniden_yazilmaz(tmp_path):
    yol = oto_not_yaz(tmp_path, _ozet())
    eski = 1_600_000_000_000_000_000  # sabit eski mtime (ns)
    os.utime(yol, ns=(eski, eski))
    yol2 = oto_not_yaz(tmp_path, _ozet())
    assert Path(yol2) == Path(yol)
    assert Path(yol).stat().st_mtime_ns == eski


def test_farkli_icerik_dosyayi_gunceller(tmp_path):
    yol = oto_not_yaz(tmp_path, _ozet(baslik="Eski baslik"))
    yol2 = oto_not_yaz(tmp_path, _ozet(baslik="Yeni baslik"))
    assert Path(yol2) == Path(yol)
    metin = Path(yol).read_text(encoding="utf-8")
    assert "Yeni baslik" in metin and "Eski baslik" not in metin


# ---------- hook: /devir boşluk engeli muafiyeti ----------

def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _kayit_yaz(yol: Path, sid: str, *, onceki_dk, baglam, cwd="C:\\proje"):
    son = datetime.now(timezone.utc) - timedelta(minutes=onceki_dk)
    girdi = max(baglam - 1000 - 2, 0)
    satirlar = [
        {"type": "user", "uuid": str(uuid.uuid4()), "timestamp": _iso_z(son - timedelta(seconds=30)),
         "sessionId": sid, "cwd": cwd,
         "message": {"role": "user", "content": "Bellek devir sistemini kuralim"}},
        {"type": "assistant", "uuid": str(uuid.uuid4()), "timestamp": _iso_z(son),
         "sessionId": sid, "cwd": cwd, "requestId": "req_" + uuid.uuid4().hex[:20],
         "message": {"id": "msg_" + uuid.uuid4().hex[:20], "type": "message", "role": "assistant",
                     "model": "claude-opus-5-5",
                     "content": [{"type": "text", "text": "Tamam."}],
                     "usage": {"input_tokens": 2, "cache_read_input_tokens": girdi,
                               "cache_creation_input_tokens": 1000, "output_tokens": 50}}},
    ]
    yol.write_text("\n".join(json.dumps(s) for s in satirlar) + "\n", encoding="utf-8")
    return yol


def _istem(tmp_path: Path, sid: str, metin: str) -> dict:
    notlar_dir = tmp_path / "notlar"
    durum = tmp_path / "durum"
    notlar_dir.mkdir(exist_ok=True)
    durum.mkdir(exist_ok=True)
    tr = _kayit_yaz(tmp_path / "t.jsonl", sid, onceki_dk=90, baglam=200_000)
    env = dict(os.environ)
    env["BELLEK_DEVIR_DIR"] = str(notlar_dir)
    env["BELLEK_DEVIR_STATE"] = str(durum)
    env.pop("BELLEK_DEVIR_UYARI", None)
    payload = {"session_id": sid, "transcript_path": str(tr), "cwd": "C:\\proje",
               "hook_event_name": "UserPromptSubmit", "prompt": metin}
    p = subprocess.run([sys.executable, "-I", HOOK], input=json.dumps(payload), env=env,
                       capture_output=True, text=True, encoding="utf-8", timeout=10)
    assert p.returncode == 0, p.stderr
    s = p.stdout.strip()
    return json.loads(s) if s else {}


@pytest.mark.parametrize("metin,engellenir", [
    ("/devir", False),
    ("  /devir notu yaz", False),
    ("merhaba", True),
])
def test_bosluk_engeli_devir_muafiyeti(tmp_path, metin, engellenir):
    c = _istem(tmp_path, "m1", metin)
    assert (c.get("decision") == "block") is engellenir
