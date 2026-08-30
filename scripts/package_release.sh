#!/usr/bin/env bash
# Package TERRA release zips (lite | full) after `wails build`.
#
# Usage:
#   scripts/package_release.sh --flavor lite|full --os darwin|linux|windows \
#       --artifact TERRA-macOS-arm64-full.zip [--arch aarch64|x86_64]
#
# Expects repo root as cwd. Copies sidecar/ and model/ into the app bundle
# or beside the binary. FULL also embeds python-build-standalone + requirements.txt.
set -euo pipefail

FLAVOR=""
OS_NAME=""
ARTIFACT=""
ARCH=""
PBS_TAG="${PBS_TAG:-20260728}"
PBS_PY="${PBS_PY:-3.12.13}"

usage() {
  echo "usage: $0 --flavor lite|full --os darwin|linux|windows --artifact NAME.zip [--arch aarch64|x86_64]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --flavor) FLAVOR="$2"; shift 2 ;;
    --os) OS_NAME="$2"; shift 2 ;;
    --artifact) ARTIFACT="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$FLAVOR" && -n "$OS_NAME" && -n "$ARTIFACT" ]] || usage
[[ "$FLAVOR" == "lite" || "$FLAVOR" == "full" ]] || usage

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BIN_DIR="$ROOT/build/bin"
DIST_DIR="$ROOT/dist"
mkdir -p "$DIST_DIR"
STAGE="$ROOT/build/stage-$FLAVOR"
rm -rf "$STAGE"
mkdir -p "$STAGE"

copy_assets() {
  local dest="$1"
  mkdir -p "$dest"
  cp -R "$ROOT/sidecar" "$dest/"
  cp -R "$ROOT/model" "$dest/"
  # Drop Python caches from the tree
  find "$dest/sidecar" -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
}

pbs_triple() {
  local arch="$1" osn="$2"
  case "$osn" in
    darwin)
      case "$arch" in
        aarch64|arm64) echo "aarch64-apple-darwin" ;;
        x86_64|amd64) echo "x86_64-apple-darwin" ;;
        *) echo "unsupported darwin arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    linux)
      case "$arch" in
        aarch64|arm64) echo "aarch64-unknown-linux-gnu" ;;
        x86_64|amd64) echo "x86_64-unknown-linux-gnu" ;;
        *) echo "unsupported linux arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    windows)
      case "$arch" in
        aarch64|arm64) echo "aarch64-pc-windows-msvc" ;;
        x86_64|amd64) echo "x86_64-pc-windows-msvc" ;;
        *) echo "unsupported windows arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    *) echo "unsupported os: $osn" >&2; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo "aarch64" ;;
    x86_64|amd64) echo "x86_64" ;;
    *) uname -m ;;
  esac
}

install_bundled_python() {
  local dest="$1"
  local arch="${ARCH:-$(detect_arch)}"
  local triple
  triple="$(pbs_triple "$arch" "$OS_NAME")"
  local name="cpython-${PBS_PY}+${PBS_TAG}-${triple}-install_only.tar.gz"
  local url="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${name}"
  local cache="$ROOT/build/cache"
  mkdir -p "$cache"
  local tarball="$cache/$name"
  if [[ ! -f "$tarball" ]]; then
    echo "downloading $url"
    curl -fL --retry 3 -o "$tarball" "$url"
  fi
  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "$tarball" -C "$tmp"
  # install_only extracts a top-level python/ directory
  if [[ -d "$tmp/python" ]]; then
    rm -rf "$dest/python"
    mv "$tmp/python" "$dest/python"
  else
    echo "unexpected python-build-standalone layout" >&2
    ls -la "$tmp" >&2
    exit 1
  fi
  rm -rf "$tmp"

  local py=""
  if [[ -x "$dest/python/bin/python3" ]]; then
    py="$dest/python/bin/python3"
  elif [[ -x "$dest/python/python.exe" ]]; then
    py="$dest/python/python.exe"
  elif [[ -x "$dest/python/python" ]]; then
    py="$dest/python/python"
  else
    echo "bundled python binary not found under $dest/python" >&2
    exit 1
  fi

  echo "pip install -r requirements.txt into bundled python"
  "$py" -m pip install --upgrade pip
  "$py" -m pip install -r "$ROOT/requirements.txt"
}

case "$OS_NAME" in
  darwin)
    APP=$(ls -d "$BIN_DIR"/*.app 2>/dev/null | head -n1 || true)
    [[ -n "$APP" ]] || { echo "no .app in $BIN_DIR" >&2; exit 1; }
    APP_NAME=$(basename "$APP")
    cp -R "$APP" "$STAGE/"
    RES="$STAGE/$APP_NAME/Contents/Resources"
    mkdir -p "$RES"
    copy_assets "$RES"
    if [[ "$FLAVOR" == "full" ]]; then
      ARCH="${ARCH:-$(detect_arch)}"
      install_bundled_python "$RES"
    fi
    (
      cd "$STAGE"
      ditto -c -k --keepParent "$APP_NAME" "$DIST_DIR/$ARTIFACT"
    )
    ;;
  linux)
    BIN=$(find "$BIN_DIR" -maxdepth 1 -type f ! -name "*.*" | head -n1 || true)
    [[ -n "$BIN" ]] || { echo "no linux binary in $BIN_DIR" >&2; exit 1; }
    mkdir -p "$STAGE/TERRA"
    cp "$BIN" "$STAGE/TERRA/Terra"
    chmod +x "$STAGE/TERRA/Terra"
    copy_assets "$STAGE/TERRA"
    if [[ "$FLAVOR" == "full" ]]; then
      ARCH="${ARCH:-x86_64}"
      install_bundled_python "$STAGE/TERRA"
    fi
    (
      cd "$STAGE"
      zip -r "$DIST_DIR/$ARTIFACT" TERRA
    )
    ;;
  windows)
    # Prefer PowerShell script on Windows runners; this branch supports Git Bash.
    EXE=$(find "$BIN_DIR" -maxdepth 1 -type f -name "*.exe" | head -n1 || true)
    [[ -n "$EXE" ]] || { echo "no .exe in $BIN_DIR" >&2; exit 1; }
    mkdir -p "$STAGE/TERRA"
    cp "$EXE" "$STAGE/TERRA/Terra.exe"
    copy_assets "$STAGE/TERRA"
    if [[ "$FLAVOR" == "full" ]]; then
      ARCH="${ARCH:-x86_64}"
      install_bundled_python "$STAGE/TERRA"
    fi
    (
      cd "$STAGE"
      if command -v zip >/dev/null 2>&1; then
        zip -r "$DIST_DIR/$ARTIFACT" TERRA
      else
        powershell.exe -NoProfile -Command "Compress-Archive -Path TERRA -DestinationPath '$DIST_DIR/$ARTIFACT' -Force"
      fi
    )
    ;;
  *)
    usage
    ;;
esac

echo "wrote $DIST_DIR/$ARTIFACT"
ls -lh "$DIST_DIR/$ARTIFACT"
