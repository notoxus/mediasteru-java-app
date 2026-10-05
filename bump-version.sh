#!/usr/bin/env bash
# Bumps the Swing app's public release version everywhere it's hardcoded, in one shot.
# (The Electron app, Rust CLI and Android companion live in their own repositories
#  and are versioned there.)
# Usage: ./bump-version.sh [new-version]   e.g. ./bump-version.sh 1.0.7
# If no version is specified, it automatically increments the patch version from the latest git tag.
#
# Updates:
#   - pom.xml                                (version -> 1.0.x, assembly finalName -> MediaSteru-v1.0.x)
#   - src/main/resources/version.properties  (version -> 1.0.x)
#   - UpdateChecker.java                     (DEFAULT_FALLBACK_VERSION -> "v1.0.x")
#   - Installation.md                        (all MediaSteru-v*-<platform> filenames)
#   - README.md                              (version badge / info)

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

# --- Swing app ---
sed -i -E "s/(<finalName>MediaSteru-v)[0-9]+\.[0-9]+\.[0-9]+(<\/finalName>)/\1$NEW\2/" pom.xml
sed -i -E "1,15s/(<version>)[^<]+(<\/version>)/\1$NEW\2/" pom.xml

if [ -f src/main/resources/version.properties ]; then
    echo "version=$NEW" > src/main/resources/version.properties
fi

if grep -q "DEFAULT_FALLBACK_VERSION" src/main/java/com/mediasteru/controller/UpdateChecker.java 2>/dev/null; then
    sed -i -E "s/(DEFAULT_FALLBACK_VERSION = \")v[0-9]+\.[0-9]+\.[0-9]+(\")/\1v$NEW\2/" \
        src/main/java/com/mediasteru/controller/UpdateChecker.java
fi

sed -i -E "s/MediaSteru-v[0-9]+\.[0-9]+\.[0-9]+/MediaSteru-v$NEW/g" Installation.md

sed -i -E "s/(<!-- VERSION_START -->)[^<]+(<!-- VERSION_END -->)/\1$NEW\2/g" README.md

echo ""
echo "Done! Review changes before committing:"
echo "  git diff --stat"
echo "To tag and release:"
echo "  git commit -am 'release: v$NEW'"
echo "  git tag v$NEW"