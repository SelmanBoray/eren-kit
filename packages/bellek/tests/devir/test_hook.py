"""Devir hook'unun uctan uca testleri (gercek surec olarak, sozlesmeden)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

# Tanımsız değişken başvurusu: Windows'ta %AD%, POSIX'te ${AD} (POSIX'te %AD% bilerek literal kalır).
TANIMSIZ = ("%BELLEK_TEST_TANIMSIZ_DEGISKEN%" if os.name == "nt"
            else "${BELLEK_TEST_TANIMSIZ_DEGISKEN}")

# Paketin kendi hook'u (tests/devir/../../src/bellek/devir/hook.py); kurulu kopyaya bağlı değil.
HOOK = str(Path(__file__).resolve().parents[2] / "src" / "bellek" / "devir" / "hook.py")


@pytest.fixture
def ortam(tmp_path):
    notlar = tmp_path / "notlar"
    durum = tmp_path / "durum"
    notlar.mkdir()
    durum.mkdir()
    return {"notlar": notlar, "durum": durum, "tmp": tmp_path}


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def kayit_yaz(yol: Path, sid: str, *, onceki_dk, baglam: int,
              model: str = "claude-opus-5-5", cwd: str = "C:\\proje") -> Path:
    """Sahte Claude Code kaydi: kullanici + assistant satiri.

    onceki_dk: son assistant mesajinin kac dakika once oldugu (None -> az once).
    baglam: input + cache_read + cache_creation toplami.
    """
    simdi = datetime.now(timezone.utc)
    son = simdi - timedelta(minutes=onceki_dk if onceki_dk is not None else 0.1)
    girdi = max(baglam - 1000 - 2, 0)
    satirlar = [
        {"type": "user", "uuid": str(uuid.uuid4()), "timestamp": _iso(son - timedelta(seconds=30)),
         "sessionId": sid, "cwd": cwd,
         "message": {"role": "user", "content": "Bellek devir sistemini kuralim"}},
        {"type": "assistant", "uuid": str(uuid.uuid4()), "timestamp": _iso(son),
         "sessionId": sid, "cwd": cwd, "requestId": "req_" + uuid.uuid4().hex[:20],
         "message": {"id": "msg_" + uuid.uuid4().hex[:20], "type": "message", "role": "assistant",
                     "model": model,
                     "content": [{"type": "text", "text": "Tamam, basliyorum."}],
                     "usage": {"input_tokens": 2, "cache_read_input_tokens": girdi,
                               "cache_creation_input_tokens": 1000, "output_tokens": 50}}},
    ]
    yol.parent.mkdir(parents=True, exist_ok=True)
    yol.write_text("\n".join(json.dumps(s) for s in satirlar) + "\n", encoding="utf-8")
    return yol


def calistir(ortam, payload, *, uyari=None, ham=None):
    env = dict(os.environ)
    env["BELLEK_DEVIR_DIR"] = str(ortam["notlar"])
    env["BELLEK_DEVIR_STATE"] = str(ortam["durum"])
    env.pop("BELLEK_DEVIR_UYARI", None)
    if uyari is not None:
        env["BELLEK_DEVIR_UYARI"] = uyari
    girdi = ham if ham is not None else json.dumps(payload)
    t0 = time.monotonic()
    p = subprocess.run([sys.executable, "-I", HOOK], input=girdi, env=env,
                       capture_output=True, text=True, encoding="utf-8", timeout=10)
    sure = time.monotonic() - t0
    assert sure < 3, f"hook cok yavas: {sure:.2f}s"
    return p


def cikti(p):
    assert p.returncode == 0, p.stderr
    s = p.stdout.strip()
    return json.loads(s) if s else {}


def istem(ortam, sid, transcript, uyari=None, metin="devam"):
    return calistir(ortam, {"session_id": sid, "transcript_path": str(transcript),
                            "cwd": "C:\\proje", "hook_event_name": "UserPromptSubmit",
                            "prompt": metin}, uyari=uyari)


def not_yaz(ortam, sid, konu):
    d = ortam["notlar"] / "oto"
    d.mkdir(exist_ok=True)
    (d / f"{sid}.md").write_text(
        f"---\ntur: otomatik\noturum: {sid}\nkonu: {konu}\nproje: C:\\x\n"
        f"tarih: {_iso(datetime.now(timezone.utc))}\ndurum: bilinmiyor\n---\nGovde\n",
        encoding="utf-8")


# ---- Hata durumlari ----

@pytest.mark.parametrize("ham", ["", "bu json degil {{{", "[1,2,3]", "null",
                                 '{"hook_event_name": "Bilinmeyen"}'])
def test_bozuk_stdin_sessiz(ortam, ham):
    p = calistir(ortam, None, ham=ham)
    assert p.returncode == 0
    assert p.stdout.strip() == ""


def test_olmayan_transcript_sessiz(ortam):
    p = istem(ortam, "s1", ortam["tmp"] / "yok.jsonl")
    assert p.returncode == 0
    assert cikti(p).get("decision") != "block"


# ---- SessionStart ----

def _ss(ortam, sid, source):
    return calistir(ortam, {"session_id": sid, "hook_event_name": "SessionStart",
                            "source": source, "cwd": "C:\\proje"})


@pytest.mark.parametrize("source", ["startup", "clear", "compact"])
def test_sessionstart_kimlik_ve_dizin(ortam, source):
    not_yaz(ortam, "diger-oturum-1", "Telefon uygulamasi servis tasarimi")
    not_yaz(ortam, "mevcut-oturum", "Kendi notum olmamali ZZZ")
    c = cikti(_ss(ortam, "mevcut-oturum", source))
    h = c["hookSpecificOutput"]
    assert h["hookEventName"] == "SessionStart"
    metin = h["additionalContext"]
    assert "Oturum kimliği: mevcut-oturum" in metin
    assert "Telefon uygulamasi servis tasarimi" in metin
    assert "ZZZ" not in metin
    assert len(metin) <= 2000


def test_sessionstart_not_yoksa_yalniz_kimlik(ortam):
    c = cikti(_ss(ortam, "yalniz", "startup"))
    assert "Oturum kimliği: yalniz" in c["hookSpecificOutput"]["additionalContext"]


def test_sessionstart_cok_not_2000_siniri(ortam):
    for i in range(60):
        not_yaz(ortam, f"o{i}", f"Uzun konu numarasi {i} " + "x" * 100)
    c = cikti(_ss(ortam, "yeni", "startup"))
    metin = c["hookSpecificOutput"]["additionalContext"]
    assert len(metin) <= 2000
    assert "Oturum kimliği: yeni" in metin


def test_sessionstart_resume_dizinsiz(ortam):
    not_yaz(ortam, "diger", "Gizli dizin konusu QQQ")
    c = cikti(_ss(ortam, "r1", "resume"))
    metin = c["hookSpecificOutput"]["additionalContext"]
    assert "Oturum kimliği: r1" in metin
    assert "QQQ" not in metin


# ---- Stop ----

def test_stop_oto_not_yazar_ve_gunceller(ortam):
    sid = "stop-1"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=1, baglam=50_000)
    payload = {"session_id": sid, "transcript_path": str(tr), "cwd": "C:\\proje",
               "hook_event_name": "Stop", "stop_hook_active": False}
    p = calistir(ortam, payload)
    assert p.returncode == 0
    assert p.stdout.strip() == ""
    dosya = ortam["notlar"] / "oto" / f"{sid}.md"
    assert dosya.exists()
    m = dosya.read_text(encoding="utf-8")
    assert m.startswith("---")
    assert "tur: otomatik" in m
    assert f"oturum: {sid}" in m
    kayit_yaz(tr, sid, onceki_dk=0.5, baglam=60_000)
    p2 = calistir(ortam, payload)
    assert p2.stdout.strip() == ""
    m2 = dosya.read_text(encoding="utf-8")
    assert m2.startswith("---") and f"oturum: {sid}" in m2
    assert len(list((ortam["notlar"] / "oto").glob("*.md"))) == 1


def test_stop_asla_decision_donmez(ortam):
    sid = "stop-2"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=500, baglam=900_000)
    p = calistir(ortam, {"session_id": sid, "transcript_path": str(tr),
                         "hook_event_name": "Stop"})
    assert "decision" not in cikti(p)


# ---- UserPromptSubmit ----

def test_bosluk_ve_baglam_durdur_once_engel_sonra_gec(ortam):
    sid = "u1"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=90, baglam=200_000)
    c1 = cikti(istem(ortam, sid, tr))
    assert c1["decision"] == "block"
    r = c1["reason"]
    assert any(x in r for x in ("89", "90", "91"))  # dakika
    assert "200K" in r or "200 K" in r
    assert "additionalContext" not in json.dumps(c1)
    c2 = cikti(istem(ortam, sid, tr))
    assert c2.get("decision") != "block"
    assert "additionalContext" not in json.dumps(c2)


def test_durdur_acik_mod(ortam):
    sid = "u1b"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=120, baglam=180_000)
    assert cikti(istem(ortam, sid, tr, uyari="durdur"))["decision"] == "block"


def test_uyar_modu_engelsiz_systemmessage(ortam):
    sid = "u2"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=90, baglam=200_000)
    c = cikti(istem(ortam, sid, tr, uyari="uyar"))
    assert "decision" not in c
    assert c.get("systemMessage")
    assert "additionalContext" not in json.dumps(c)


def test_kapali_modu_uyarisiz(ortam):
    sid = "u3"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=90, baglam=200_000)
    c = cikti(istem(ortam, sid, tr, uyari="kapali"))
    assert "decision" not in c
    assert not c.get("systemMessage")


def test_bosluk_kisa_engel_yok(ortam):
    sid = "u4"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=30, baglam=200_000)
    assert "decision" not in cikti(istem(ortam, sid, tr))


def test_baglam_kucuk_engel_yok(ortam):
    sid = "u5"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=120, baglam=100_000)
    assert "decision" not in cikti(istem(ortam, sid, tr))


def test_baglam_300k_uyari_tekrarsiz_400k_tekrar(ortam):
    sid = "u6"
    tr = ortam["tmp"] / "t.jsonl"
    kayit_yaz(tr, sid, onceki_dk=None, baglam=320_000)
    c1 = cikti(istem(ortam, sid, tr))
    assert "decision" not in c1
    assert c1.get("systemMessage")
    c2 = cikti(istem(ortam, sid, tr))
    assert "decision" not in c2
    assert not c2.get("systemMessage")
    kayit_yaz(tr, sid, onceki_dk=None, baglam=420_000)
    c3 = cikti(istem(ortam, sid, tr))
    assert "decision" not in c3
    assert c3.get("systemMessage")
    assert "additionalContext" not in json.dumps(c3)


def test_baglam_300k_alti_bosluksuz_sessiz(ortam):
    sid = "u7"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=None, baglam=200_000)
    c = cikti(istem(ortam, sid, tr))
    assert "decision" not in c
    assert not c.get("systemMessage")


def test_durum_oturumlar_arasi_karismaz(ortam):
    tr1 = kayit_yaz(ortam["tmp"] / "a.jsonl", "ayri-a", onceki_dk=90, baglam=200_000)
    tr2 = kayit_yaz(ortam["tmp"] / "b.jsonl", "ayri-b", onceki_dk=90, baglam=200_000)
    assert cikti(istem(ortam, "ayri-a", tr1))["decision"] == "block"
    assert cikti(istem(ortam, "ayri-b", tr2))["decision"] == "block"


# ---- Regresyon: sıkıştırma sınırı ve "aşağıdaki" ifadesi ----

def _sikistirma_ekle(yol: Path, sid: str, tur: str) -> None:
    """Son assistant satirindan SONRA sikistirma siniri ekler."""
    simdi = _iso(datetime.now(timezone.utc) - timedelta(seconds=5))
    if tur == "sinir":
        satir = {"type": "system", "subtype": "compact_boundary", "content": "Conversation compacted",
                 "isMeta": False, "timestamp": simdi, "uuid": str(uuid.uuid4()), "level": "info",
                 "compactMetadata": {"trigger": "auto", "preTokens": 380000, "postTokens": 9800},
                 "sessionId": sid, "cwd": "C:\\proje"}
    else:
        satir = {"type": "user", "isCompactSummary": True, "isVisibleInTranscriptOnly": True,
                 "uuid": str(uuid.uuid4()), "timestamp": simdi, "sessionId": sid, "cwd": "C:\\proje",
                 "message": {"role": "user", "content": "Ozet metni"}}
    with open(yol, "a", encoding="utf-8") as f:
        f.write(json.dumps(satir) + "\n")


@pytest.mark.parametrize("tur", ["sinir", "ozet"])
@pytest.mark.parametrize("mod", [None, "durdur", "uyar", "kapali"])
def test_sikistirma_sonrasi_engel_ve_uyari_yok(ortam, tur, mod):
    sid = f"sk-{tur}-{mod}"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=120, baglam=250_000)
    _sikistirma_ekle(tr, sid, tur)
    c = cikti(istem(ortam, sid, tr, uyari=mod))
    assert "decision" not in c
    assert not c.get("systemMessage")
    assert "additionalContext" not in json.dumps(c)


def test_sikistirma_sonrasi_300k_uyarisi_da_yok(ortam):
    sid = "sk-300"
    tr = kayit_yaz(ortam["tmp"] / "t.jsonl", sid, onceki_dk=None, baglam=350_000)
    _sikistirma_ekle(tr, sid, "sinir")
    c = cikti(istem(ortam, sid, tr))
    assert "decision" not in c and not c.get("systemMessage")


def test_sessionstart_notsuz_asagidaki_yok(ortam):
    c = cikti(_ss(ortam, "bos-1", "startup"))
    metin = c["hookSpecificOutput"]["additionalContext"]
    assert "Oturum kimliği: bos-1" in metin
    assert "aşağıdaki" not in metin.lower()


@pytest.mark.parametrize("source", ["resume", "fork"])
def test_sessionstart_resume_fork_asagidaki_yok(ortam, source):
    not_yaz(ortam, "diger", "Baska oturum konusu")
    c = cikti(_ss(ortam, "rf-1", source))
    metin = c["hookSpecificOutput"]["additionalContext"]
    assert "Oturum kimliği: rf-1" in metin
    assert "aşağıdaki" not in metin.lower()
    assert "Baska oturum konusu" not in metin


# ---- devir klasörü ayardan ----

def _ss_ayarla(ortam, ayar_metni):
    """BELLEK_DEVIR_DIR olmadan, verilen ayar dosyasıyla SessionStart çalıştırır."""
    ayar = ortam["tmp"] / "ayar.toml"
    ayar.write_text(ayar_metni, encoding="utf-8")
    env = dict(os.environ)
    env.pop("BELLEK_DEVIR_DIR", None)
    env.pop("BELLEK_TEST_TANIMSIZ_DEGISKEN", None)
    env["BELLEK_CONFIG"] = str(ayar)
    env["BELLEK_DEVIR_STATE"] = str(ortam["durum"])
    payload = {"session_id": "s-ayar", "hook_event_name": "SessionStart", "source": "startup"}
    p = subprocess.run([sys.executable, "-I", HOOK], input=json.dumps(payload), env=env,
                       capture_output=True, text=True, encoding="utf-8", timeout=10)
    return p


def test_sessionstart_ilgisiz_ayar_hatasinda_vault_devir_kullanilir(ortam):
    kasa = ortam["tmp"] / "kasa"
    (kasa / "devir").mkdir(parents=True)
    not_yaz({**ortam, "notlar": kasa / "devir"}, "eski-oturum", "Kasadaki devir notu QQQ")
    p = _ss_ayarla(ortam, "[bellek]\nvault = 'kasa'\n[[source]]\nname = 'a'\n"
                          "path = '" + TANIMSIZ + "/x'\n")
    metin = cikti(p)["hookSpecificOutput"]["additionalContext"]
    assert "Kasadaki devir notu QQQ" in metin
    assert "Uyarı" not in metin


def test_sessionstart_vault_cozulemezse_uyari_baglamda_ve_logda(ortam):
    p = _ss_ayarla(ortam, "[bellek]\nvault = '" + TANIMSIZ + "/kasa'\n")
    assert "BELLEK_TEST_TANIMSIZ_DEGISKEN" in p.stderr  # stderr UTF-8 çözülebilir
    metin = cikti(p)["hookSpecificOutput"]["additionalContext"]
    assert "Uyarı (Bellek ayarı)" in metin and "BELLEK_TEST_TANIMSIZ_DEGISKEN" in metin
    log = (ortam["durum"] / "hook.log").read_text(encoding="utf-8")
    assert "BELLEK_TEST_TANIMSIZ_DEGISKEN" in log
