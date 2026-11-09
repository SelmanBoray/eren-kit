#!/usr/bin/env bash
# eren-kit macOS kurulumu: Python 3.11+ bulur ve scripts/installer/install_macos.py'yi çalıştırır.
#   ./install.sh --dry-run            # ne değişeceğini göster, hiçbir şeyi değiştirme
#   ./install.sh --assistant-name Ada # varsayılan bileşenleri kur (beyin, devir, orkestra)
#   ./install.sh --help
set -euo pipefail
cd "$(dirname "$0")"
have_clt() { xcode-select -p >/dev/null 2>&1; }
for c in python3 python3.14 python3.13 python3.12 python3.11 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  p=$(command -v "$c" 2>/dev/null) || continue
  # /usr/bin/python3 Command Line Tools yoksa kurulum penceresi açar: dokunma.
  if [ "$p" = /usr/bin/python3 ] && ! have_clt; then continue; fi
  "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null || continue
  hook_py=$p
  # pyenv/asdf shim'i hook'lara yazılırsa sürüm her projenin .python-version'ına göre değişir:
  # gerçek yorumlayıcı yolu kullanılır.
  case "$p" in */shims/*) hook_py=$("$p" -c 'import sys; print(sys.executable)') ;; esac
  exec "$p" -I scripts/installer/install_macos.py --hook-python "$hook_py" "$@"
done
echo "Python 3.11+ bulunamadı. Kur: brew install python@3.13  (ya da https://www.python.org/downloads/macos/)" >&2
exit 1
