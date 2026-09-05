#!/usr/bin/env bash
set -euo pipefail

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$OS" = "Darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
        PLATFORM="mac-arm"
        ADOPTIUM_OS="mac"
        ADOPTIUM_ARCH="aarch64"
    else
        PLATFORM="mac-x64"
        ADOPTIUM_OS="mac"
        ADOPTIUM_ARCH="x64"
    fi
else
    if [[ "$ARCH" == "aarch64" || "$ARCH" == arm* ]]; then
        PLATFORM="linux-arm"
        ADOPTIUM_OS="linux"
        ADOPTIUM_ARCH="aarch64"
    else
        PLATFORM="linux-x64"
        ADOPTIUM_OS="linux"
        ADOPTIUM_ARCH="x64"
    fi
fi

JRE_DIR="$SCRIPT_DIR/jre-$PLATFORM"
JAVA_BIN="$JRE_DIR/bin/java"
JAR="$SCRIPT_DIR/MediaSteru.jar"

# Download JRES
download_jre() {
    local api_url="https://api.adoptium.net/v3/assets/latest/21/hotspot?os=${ADOPTIUM_OS}&architecture=${ADOPTIUM_ARCH}&image_type=jre"

    echo "[Bootstrapper] JRE not found for platform: $PLATFORM"
    echo "[Bootstrapper] Fetching download URL from Adoptium..."

    # Check for curl or wget
    if command -v curl &>/dev/null; then
        DOWNLOADER="curl"
    elif command -v wget &>/dev/null; then
        DOWNLOADER="wget"
    else
        echo "[Bootstrapper] ERROR: Neither curl nor wget found. Cannot auto-download JRE."
        echo "Please install curl or wget, or manually place a JRE 21 at: $JRE_DIR"
        exit 1
    fi

    # Download metadata JSON
    if [ "$DOWNLOADER" = "curl" ]; then
        JSON=$(curl -fsSL "$api_url")
        DOWNLOAD_URL=$(echo "$JSON" | grep -o '"link":"[^"]*"' | head -1 | cut -d'"' -f4)
        FILE_NAME=$(echo "$JSON" | grep -o '"name":"[^"]*\.tar\.gz"' | head -1 | cut -d'"' -f4)
    else
        JSON=$(wget -qO- "$api_url")
        DOWNLOAD_URL=$(echo "$JSON" | grep -o '"link":"[^"]*"' | head -1 | cut -d'"' -f4)
        FILE_NAME=$(echo "$JSON" | grep -o '"name":"[^"]*\.tar\.gz"' | head -1 | cut -d'"' -f4)
    fi

    if [ -z "$DOWNLOAD_URL" ]; then
        echo "[Bootstrapper] ERROR: Could not parse download URL from Adoptium API."
        echo "Please download JRE 21 manually from https://adoptium.net and extract to: $JRE_DIR"
        exit 1
    fi

    local TMP_DIR
    TMP_DIR=$(mktemp -d)
    local TMP_FILE="$TMP_DIR/$FILE_NAME"

    echo "[Bootstrapper] Downloading $FILE_NAME..."
    if [ "$DOWNLOADER" = "curl" ]; then
        curl -fL --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE"
    else
        wget --show-progress -q "$DOWNLOAD_URL" -O "$TMP_FILE"
    fi

    echo "[Bootstrapper] Extracting JRE..."
    local EXTRACT_DIR="$TMP_DIR/extracted"
    mkdir -p "$EXTRACT_DIR"
    tar -xzf "$TMP_FILE" -C "$EXTRACT_DIR"

    local EXTRACTED_JRE
    EXTRACTED_JRE=$(find "$EXTRACT_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)

    if [ -z "$EXTRACTED_JRE" ]; then
        echo "[Bootstrapper] ERROR: Could not find extracted JRE directory."
        rm -rf "$TMP_DIR"
        exit 1
    fi

    # Moving to the right dir destination
    mkdir -p "$(dirname "$JRE_DIR")"
    mv "$EXTRACTED_JRE" "$JRE_DIR"
    rm -rf "$TMP_DIR"

    echo "[Bootstrapper] JRE installed to: $JRE_DIR"
}

# Check and download if that hasnt existed yet
if [ ! -x "$JAVA_BIN" ]; then
    download_jre
fi

if [ ! -x "$JAVA_BIN" ]; then
    echo "[Bootstrapper] ERROR: JRE installation succeeded but java binary not found at:"
    echo "  $JAVA_BIN"
    exit 1
fi

# Launch
echo "[System] Detected platform: $PLATFORM — launching..."
"$JAVA_BIN" -jar "$JAR" &