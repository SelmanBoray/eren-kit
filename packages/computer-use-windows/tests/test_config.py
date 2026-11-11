"""Unit tests for computer_use_windows.config (pure, no Windows calls)."""

from __future__ import annotations

import dataclasses

import pytest

from computer_use_windows.config import Config, load_config


def load(argv: list[str] | None = None, env: dict[str, str] | None = None) -> Config:
    return load_config(argv if argv is not None else [], env if env is not None else {})


# --- defaults ---------------------------------------------------------------------------


def test_defaults_from_load_config() -> None:
    cfg = load()
    assert cfg.max_size == 1280
    assert cfg.image_format == "png"
    assert cfg.jpeg_quality == 80
    assert cfg.monitor is None
    assert cfg.max_elements == 80
    assert cfg.blocked_processes == ()
    assert cfg.failsafe is True
    assert cfg.allow_terminal_input is False


def test_config_dataclass_defaults_match() -> None:
    assert Config() == load()


def test_config_is_frozen() -> None:
    cfg = Config()
    with pytest.raises(dataclasses.FrozenInstanceError):
        cfg.max_size = 100  # type: ignore[misc]


def test_version_flag_exits() -> None:
    with pytest.raises(SystemExit):
        load(["--version"])


# --- CLI flags --------------------------------------------------------------------------


def test_cli_max_size() -> None:
    assert load(["--max-size", "1920"]).max_size == 1920


def test_cli_format_jpeg() -> None:
    assert load(["--format", "jpeg"]).image_format == "jpeg"


def test_cli_jpeg_quality() -> None:
    assert load(["--jpeg-quality", "60"]).jpeg_quality == 60


def test_cli_monitor() -> None:
    assert load(["--monitor", "2"]).monitor == 2


def test_cli_max_elements() -> None:
    assert load(["--max-elements", "200"]).max_elements == 200


def test_cli_no_failsafe() -> None:
    assert load(["--no-failsafe"]).failsafe is False


def test_cli_allow_terminal_input() -> None:
    assert load(["--allow-terminal-input"]).allow_terminal_input is True


def test_cli_block_single() -> None:
    assert load(["--block", "keepass.exe"]).blocked_processes == ("keepass.exe",)


# --- env vars ---------------------------------------------------------------------------


def test_env_max_size() -> None:
    assert load(env={"CUW_MAX_SIZE": "2048"}).max_size == 2048


def test_env_format() -> None:
    assert load(env={"CUW_FORMAT": "jpeg"}).image_format == "jpeg"


def test_env_jpeg_quality() -> None:
    assert load(env={"CUW_JPEG_QUALITY": "50"}).jpeg_quality == 50


def test_env_monitor() -> None:
    assert load(env={"CUW_MONITOR": "3"}).monitor == 3


def test_env_max_elements() -> None:
    assert load(env={"CUW_MAX_ELEMENTS": "10"}).max_elements == 10


def test_env_block() -> None:
    cfg = load(env={"CUW_BLOCK": "keepass.exe,1password"})
    assert cfg.blocked_processes == ("keepass.exe", "1password")


def test_unrelated_env_ignored() -> None:
    assert load(env={"PATH": "x", "HOME": "y"}) == Config()


# --- precedence -------------------------------------------------------------------------


def test_cli_overrides_env_scalars() -> None:
    env = {
        "CUW_MAX_SIZE": "2000",
        "CUW_FORMAT": "jpeg",
        "CUW_JPEG_QUALITY": "50",
        "CUW_MONITOR": "3",
        "CUW_MAX_ELEMENTS": "10",
    }
    argv = [
        "--max-size", "1500",
        "--format", "png",
        "--jpeg-quality", "90",
        "--monitor", "1",
        "--max-elements", "20",
    ]  # fmt: skip
    cfg = load(argv, env)
    assert cfg.max_size == 1500
    assert cfg.image_format == "png"
    assert cfg.jpeg_quality == 90
    assert cfg.monitor == 1
    assert cfg.max_elements == 20


def test_env_overrides_defaults_but_unset_keeps_default() -> None:
    cfg = load(env={"CUW_MAX_SIZE": "2000"})
    assert cfg.max_size == 2000
    assert cfg.max_elements == 80


def test_cli_no_failsafe_overrides_env_truthy() -> None:
    assert load(["--no-failsafe"], {"CUW_FAILSAFE": "1"}).failsafe is False


def test_cli_block_replaces_env_list() -> None:
    cfg = load(["--block", "a.exe"], {"CUW_BLOCK": "b.exe,c.exe"})
    assert cfg.blocked_processes == ("a.exe",)


def test_env_block_used_when_no_cli_block() -> None:
    cfg = load(["--max-size", "1000"], {"CUW_BLOCK": "b.exe,c.exe"})
    assert cfg.blocked_processes == ("b.exe", "c.exe")


# --- validation: ranges -----------------------------------------------------------------


@pytest.mark.parametrize("value", ["255", "2577", "4096", "4097", "0", "-5"])
def test_cli_max_size_out_of_range(value: str) -> None:
    with pytest.raises(ValueError):
        load(["--max-size", value])


@pytest.mark.parametrize("value", ["256", "2576"])
def test_max_size_boundaries_ok(value: str) -> None:
    assert load(["--max-size", value]).max_size == int(value)


@pytest.mark.parametrize("value", ["255", "2577", "4096", "4097"])
def test_env_max_size_out_of_range(value: str) -> None:
    with pytest.raises(ValueError):
        load(env={"CUW_MAX_SIZE": value})


@pytest.mark.parametrize("value", ["0", "96"])
def test_cli_jpeg_quality_out_of_range(value: str) -> None:
    with pytest.raises(ValueError):
        load(["--jpeg-quality", value])


@pytest.mark.parametrize("value", ["1", "95"])
def test_jpeg_quality_boundaries_ok(value: str) -> None:
    assert load(["--jpeg-quality", value]).jpeg_quality == int(value)


@pytest.mark.parametrize("value", ["0", "96"])
def test_env_jpeg_quality_out_of_range(value: str) -> None:
    with pytest.raises(ValueError):
        load(env={"CUW_JPEG_QUALITY": value})


@pytest.mark.parametrize("value", ["0", "501"])
def test_cli_max_elements_out_of_range(value: str) -> None:
    with pytest.raises(ValueError):
        load(["--max-elements", value])


@pytest.mark.parametrize("value", ["1", "500"])
def test_max_elements_boundaries_ok(value: str) -> None:
    assert load(["--max-elements", value]).max_elements == int(value)


@pytest.mark.parametrize("value", ["0", "501"])
def test_env_max_elements_out_of_range(value: str) -> None:
    with pytest.raises(ValueError):
        load(env={"CUW_MAX_ELEMENTS": value})


def test_cli_monitor_zero_invalid() -> None:
    with pytest.raises(ValueError):
        load(["--monitor", "0"])


def test_env_monitor_zero_invalid() -> None:
    with pytest.raises(ValueError):
        load(env={"CUW_MONITOR": "0"})


# --- max_image_tokens -------------------------------------------------------------------


def test_max_image_tokens_default() -> None:
    assert load().max_image_tokens == 1568
    assert Config().max_image_tokens == 1568


def test_cli_max_image_tokens() -> None:
    assert load(["--max-image-tokens", "3000"]).max_image_tokens == 3000


def test_env_max_image_tokens() -> None:
    assert load(env={"CUW_MAX_IMAGE_TOKENS": "2500"}).max_image_tokens == 2500


def test_max_image_tokens_cli_overrides_env() -> None:
    cfg = load(["--max-image-tokens", "1000"], {"CUW_MAX_IMAGE_TOKENS": "2500"})
    assert cfg.max_image_tokens == 1000


@pytest.mark.parametrize("value", ["100", "4784"])
def test_max_image_tokens_boundaries_ok(value: str) -> None:
    assert load(["--max-image-tokens", value]).max_image_tokens == int(value)
    assert load(env={"CUW_MAX_IMAGE_TOKENS": value}).max_image_tokens == int(value)


@pytest.mark.parametrize("value", ["99", "4785", "0", "abc", "1.5"])
def test_cli_max_image_tokens_invalid(value: str) -> None:
    with pytest.raises(ValueError):
        load(["--max-image-tokens", value])


@pytest.mark.parametrize("value", ["99", "4785", "0", "abc", "1.5"])
def test_env_max_image_tokens_invalid(value: str) -> None:
    with pytest.raises(ValueError):
        load(env={"CUW_MAX_IMAGE_TOKENS": value})


# --- validation: format / non-numeric ---------------------------------------------------


def test_cli_format_gif_invalid() -> None:
    with pytest.raises(ValueError):
        load(["--format", "gif"])


def test_env_format_gif_invalid() -> None:
    with pytest.raises(ValueError):
        load(env={"CUW_FORMAT": "gif"})


@pytest.mark.parametrize("raw", ["JPEG", "Jpeg", "PNG"])
def test_format_case_insensitive_cli(raw: str) -> None:
    assert load(["--format", raw]).image_format == raw.lower()


def test_format_case_insensitive_env() -> None:
    assert load(env={"CUW_FORMAT": "JPEG"}).image_format == "jpeg"


@pytest.mark.parametrize(
    "name",
    ["CUW_MAX_SIZE", "CUW_JPEG_QUALITY", "CUW_MONITOR", "CUW_MAX_ELEMENTS"],
)
def test_env_non_numeric_raises_value_error(name: str) -> None:
    with pytest.raises(ValueError):
        load(env={name: "abc"})


# --- --block normalization --------------------------------------------------------------


def test_block_repeatable() -> None:
    cfg = load(["--block", "a.exe", "--block", "b.exe"])
    assert cfg.blocked_processes == ("a.exe", "b.exe")


def test_block_comma_separated() -> None:
    assert load(["--block", "a.exe,b.exe"]).blocked_processes == ("a.exe", "b.exe")


def test_block_repeat_and_comma_mixed() -> None:
    cfg = load(["--block", "a,b", "--block", "c"])
    assert cfg.blocked_processes == ("a", "b", "c")


def test_block_normalization_cli() -> None:
    cfg = load(["--block", " KeePass.EXE , ,1Password,", "--block", "KEEPASS.exe"])
    assert cfg.blocked_processes == ("keepass.exe", "1password")


def test_block_normalization_env() -> None:
    cfg = load(env={"CUW_BLOCK": " Foo.exe ,,BAR, foo.EXE ,"})
    assert cfg.blocked_processes == ("foo.exe", "bar")


def test_block_dedupe_keeps_first_order() -> None:
    cfg = load(["--block", "c,a,b,a,c"])
    assert cfg.blocked_processes == ("c", "a", "b")


def test_block_empty_env_gives_empty_tuple() -> None:
    assert load(env={"CUW_BLOCK": " , ,"}).blocked_processes == ()


def test_block_is_tuple() -> None:
    assert isinstance(load(["--block", "a"]).blocked_processes, tuple)


# --- CUW_FAILSAFE / CUW_ALLOW_TERMINAL_INPUT --------------------------------------------


@pytest.mark.parametrize("value", ["0", "false", "no", "off", "FALSE", "Off", " no "])
def test_env_failsafe_falsy_disables(value: str) -> None:
    assert load(env={"CUW_FAILSAFE": value}).failsafe is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "on"])
def test_env_failsafe_truthy_keeps_enabled(value: str) -> None:
    assert load(env={"CUW_FAILSAFE": value}).failsafe is True


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "TRUE", "On"])
def test_env_allow_terminal_input_truthy(value: str) -> None:
    assert load(env={"CUW_ALLOW_TERMINAL_INPUT": value}).allow_terminal_input is True


@pytest.mark.parametrize("value", ["0", "false", "no", "off"])
def test_env_allow_terminal_input_falsy(value: str) -> None:
    assert load(env={"CUW_ALLOW_TERMINAL_INPUT": value}).allow_terminal_input is False


def test_cli_flags_combined() -> None:
    cfg = load(["--no-failsafe", "--allow-terminal-input"], {})
    assert cfg.failsafe is False
    assert cfg.allow_terminal_input is True


# --- argv / env explicit use ------------------------------------------------------------


def test_explicit_empty_env_ignores_process_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUW_MAX_SIZE", "2222")
    assert load_config([], {}).max_size == 1280


def test_none_env_reads_process_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUW_MAX_SIZE", "2222")
    assert load_config([], None).max_size == 2222


def test_none_argv_reads_sys_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.argv", ["prog", "--max-size", "999"])
    assert load_config(None, {}).max_size == 999
