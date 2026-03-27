#!/usr/bin/env bash
# Migrate a single wopr-plugin repo into the monorepo packages/ directory.
# Usage: ./scripts/migrate-plugin.sh <source-dir> [package-name-override]
#
# Copies src/, tests/, package.json, tsconfig.json, and any manifest/config files.
# Rewrites package.json for monorepo conventions:
#   - plugin-types → workspace:*
#   - tsconfig extends base
#   - hoists shared devDeps to root
#   - standardizes scripts

set -euo pipefail

SRC_DIR="$1"
MONOREPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES_DIR="$MONOREPO_ROOT/packages"

if [ ! -d "$SRC_DIR" ] || [ ! -f "$SRC_DIR/package.json" ]; then
  echo "ERROR: $SRC_DIR does not exist or has no package.json"
  exit 1
fi

# Derive package dir name from source dir
DIR_NAME="$(basename "$SRC_DIR")"
# Strip "wopr-" prefix if present, keep "plugin-" prefix
PKG_DIR="${DIR_NAME#wopr-}"
DEST="$PACKAGES_DIR/$PKG_DIR"

if [ -d "$DEST" ]; then
  echo "SKIP: $DEST already exists"
  exit 0
fi

echo "Migrating $DIR_NAME → packages/$PKG_DIR"
mkdir -p "$DEST"

# Copy source files
[ -d "$SRC_DIR/src" ] && cp -r "$SRC_DIR/src" "$DEST/"
[ -d "$SRC_DIR/tests" ] && cp -r "$SRC_DIR/tests" "$DEST/"
[ -d "$SRC_DIR/test" ] && cp -r "$SRC_DIR/test" "$DEST/"
cp "$SRC_DIR/package.json" "$DEST/"

# Copy any extra config files that aren't hoisted
for f in vitest.config.ts vitest.config.mts; do
  [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$DEST/"
done

# Create standardized tsconfig.json
cat > "$DEST/tsconfig.json" << 'TSEOF'
{
  "extends": "../../tooling/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
TSEOF

# Rewrite package.json with jq
TEMP_PKG=$(mktemp)
jq '
  # Fix scope if missing
  (if (.name | startswith("@wopr-network/")) then .name else "@wopr-network/" + .name end) as $name |

  # Standardize scripts
  .scripts = {
    "lint": "biome check src/",
    "build": "tsc",
    "test": "vitest run",
    "prepublishOnly": "npm run build"
  } |

  # Replace plugin-types dep with workspace:*
  (if .dependencies["@wopr-network/plugin-types"] then
    .dependencies["@wopr-network/plugin-types"] = "workspace:*"
  else . end) |
  (if .peerDependencies["@wopr-network/plugin-types"] then
    .peerDependencies["@wopr-network/plugin-types"] = "workspace:*"
  else . end) |
  (if .devDependencies["@wopr-network/plugin-types"] then
    .devDependencies["@wopr-network/plugin-types"] = "workspace:*"
  else . end) |

  # Replace other @wopr-network plugin deps with workspace:*
  (if .dependencies then
    .dependencies |= with_entries(
      if (.key | startswith("@wopr-network/wopr-plugin-")) then .value = "workspace:*" else . end
    )
  else . end) |
  (if .peerDependencies then
    .peerDependencies |= with_entries(
      if (.key | startswith("@wopr-network/wopr-plugin-")) then .value = "workspace:*" else . end
    )
  else . end) |

  # Remove devDeps that are hoisted to root
  (if .devDependencies then
    .devDependencies |= with_entries(
      select(.key | IN("@biomejs/biome", "vitest", "typescript", "@vitest/coverage-v8", "@vitest/coverage-istanbul", "turbo", "tsx") | not)
    )
  else . end) |

  # Remove empty dep objects
  (if .devDependencies == {} then del(.devDependencies) else . end) |
  (if .peerDependencies == {} then del(.peerDependencies) else . end) |

  # Remove per-repo release config (changesets handles this now)
  del(.release) |

  # Remove packageManager (root handles this)
  del(.packageManager) |

  # Ensure required fields
  .name = $name |
  .type = "module" |
  .main = "dist/index.js" |
  .types = "dist/index.d.ts" |

  # Keep publishConfig
  .publishConfig = { "access": "public" }
' "$DEST/package.json" > "$TEMP_PKG"

mv "$TEMP_PKG" "$DEST/package.json"

echo "  ✓ $PKG_DIR migrated"
