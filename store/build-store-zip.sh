#!/usr/bin/env bash
# Builds the Chrome Web Store upload: same extension, minus the "key" field (the store assigns its own
# ID and rejects uploads that contain a key). Usage: store/build-store-zip.sh  ->  store/fredver-store.zip
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); cp -r extension "$tmp/fredver"
python3 - "$tmp/fredver/manifest.json" <<'PY'
import json,sys;p=sys.argv[1];m=json.load(open(p));m.pop('key',None);json.dump(m,open(p,'w'),indent=1)
PY
rm -f store/fredver-store.zip; (cd "$tmp/fredver" && zip -qr "$OLDPWD/store/fredver-store.zip" .)
rm -rf "$tmp"; echo "store/fredver-store.zip (version $(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])"))"
