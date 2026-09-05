#!/usr/bin/env bash
# Bumps the app's public release version everywhere it's hardcoded, in one shot.
# Usage: ./bump-version.sh [new-version]   e.g. ./bump-version.sh 1.0.7
# If no version is specified, it automatically increments the patch version from the latest git tag.
#
# Updates:
#   - pom.xml                                (version -> 1.0.x, assembly finalName -> MediaSteru-v1.0.x)
#   - src/main/resources/version.properties  (version -> 1.0.x)
#   - electron/package*.json                  (version -> 1.0.x)
#   - cli/Cargo.toml + Cargo.lock             (version -> 1.0.x)
#   - UpdateChecker.java                     (DEFAULT_FALLBACK_VERSION -> "v1.0.x")
#   - Installation.md                        (all MediaSteru-v*-<platform> filenames)
#   - README.md                              (version badge / info)
#   - companion-android/app/build.gradle.kts (versionName + versionCode+1)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ $# -eq 0 ]; then
    # Auto-detect latest git tag
    LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v1.0.6")
    LATEST_CLEAN="${LATEST_TAG#v}"
    
    if [[ "$LATEST_CLEAN" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        MAJOR="${BASH_REMATCH[1]}"
        MINOR="${BASH_REMATCH[2]}"
        PATCH="${BASH_REMATCH[3]}"
        NEW="$MAJOR.$MINOR.$((PATCH + 1))"
        echo "No version specified. Auto-bumping from $LATEST_TAG -> v$NEW"
    else
        echo "Error: Could not parse latest tag '$LATEST_TAG'. Please specify version explicitly."
        echo "Usage: $0 <new-version>   e.g. $0 1.0.7"
        exit 1
    fi
else
    NEW="${1#v}"
fi

if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must look like 1.0.7 or v1.0.7"
    exit 1
fi

echo "Bumping to v$NEW ..."

# --- Desktop ---
sed -i -E "s/(<finalName>MediaSteru-v)[0-9]+\.[0-9]+\.[0-9]+(<\/finalName>)/\1$NEW\2/" pom.xml
sed -i -E "1,15s/(<version>)[^<]+(<\/version>)/\1$NEW\2/" pom.xml

if [ -f src/main/resources/version.properties ]; then
    echo "version=$NEW" > src/main/resources/version.properties
fi

if [ -f electron/package.json ]; then
    sed -i -E "1,15s/(\"version\": \")[0-9]+\.[0-9]+\.[0-9]+(\")/\1$NEW\2/" electron/package.json
fi
if [ -f electron/package-lock.json ]; then
    sed -i -E "1,15s/(\"version\": \")[0-9]+\.[0-9]+\.[0-9]+(\")/\1$NEW\2/" electron/package-lock.json
fi

if [ -f cli/Cargo.toml ]; then
    sed -i -E "1,10s/(version = \")[0-9]+\.[0-9]+\.[0-9]+(\")/\1$NEW\2/" cli/Cargo.toml
    if command -v cargo >/dev/null 2>&1; then
        cargo update --manifest-path cli/Cargo.toml -p mediasteru-cli --precise "$NEW"
    else
        echo "Warning: cargo not found; regenerate cli/Cargo.lock before releasing."
    fi
fi

if grep -q "DEFAULT_FALLBACK_VERSION" src/main/java/com/mediasteru/controller/UpdateChecker.java 2>/dev/null; then
    sed -i -E "s/(DEFAULT_FALLBACK_VERSION = \")v[0-9]+\.[0-9]+\.[0-9]+(\")/\1v$NEW\2/" \
        src/main/java/com/mediasteru/controller/UpdateChecker.java
fi

sed -i -E "s/MediaSteru-v[0-9]+\.[0-9]+\.[0-9]+/MediaSteru-v$NEW/g" Installation.md

sed -i -E "s/(<!-- VERSION_START -->)[^<]+(<!-- VERSION_END -->)/\1$NEW\2/g" README.md

# --- Android (companion): versionName + versionCode+1 ---
bump_gradle() {
    local file="$1"
    if [ -f "$file" ]; then
        local old_code
        old_code=$(grep -oE "versionCode = [0-9]+" "$file" | grep -oE "[0-9]+" || echo "1")
        local new_code=$((old_code + 1))
        sed -i -E "s/versionCode = [0-9]+/versionCode = $new_code/" "$file"
        sed -i -E "s/versionName = \"[^\"]+\"/versionName = \"$NEW\"/" "$file"
        echo "  $file: versionCode $old_code -> $new_code, versionName -> $NEW"
    fi
}
bump_gradle companion-android/app/build.gradle.kts

echo ""
echo "Done! Review changes before committing:"
echo "  git diff --stat"
echo "To tag and release:"
echo "  git commit -am 'release: v$NEW'"
echo "  git tag v$NEW"
