"""bellek.asistan: gösterilen asistan adı ortamdan gelir, kodda sabit ad yoktur."""

from __future__ import annotations

import pytest

from bellek.asistan import AD_SINIRI, ORTAM_DEGISKENI, VARSAYILAN_AD, asistan_adi


def test_ortam_degiskeni_adi_sozlesmeye_uygun():
    assert ORTAM_DEGISKENI == "EREN_KIT_ASSISTANT_NAME"
    assert VARSAYILAN_AD == "Claude"


@pytest.mark.parametrize("env", [{}, {ORTAM_DEGISKENI: ""}, {ORTAM_DEGISKENI: "  \t "}])
def test_yoksa_ya_da_bossa_varsayilan(env):
    assert asistan_adi(env) == "Claude"


def test_ortamdaki_ad_kullanilir_ve_bosluk_toparlanir():
    assert asistan_adi({ORTAM_DEGISKENI: "  Nova   Yardımcı \n"}) == "Nova Yardımcı"


def test_kontrol_karakterleri_atilir_ve_uzunluk_sinirlanir():
    assert asistan_adi({ORTAM_DEGISKENI: "No\x00va\x1b"}) == "Nova"
    assert len(asistan_adi({ORTAM_DEGISKENI: "x" * 500})) == AD_SINIRI


def test_env_verilmezse_os_environ(monkeypatch):
    monkeypatch.setenv(ORTAM_DEGISKENI, "Nova")
    assert asistan_adi() == "Nova"
    monkeypatch.delenv(ORTAM_DEGISKENI)
    assert asistan_adi() == "Claude"
