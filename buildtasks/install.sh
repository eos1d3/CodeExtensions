#!/bin/sh
# Copies this extension into the extensions folders of VS Code and Cursor and
# registers it in each editor's extensions.json (Cursor does not auto-discover
# manually copied folders). No build step needed: plain JavaScript.
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
ID="eos1d3.build-buttons"
VERSION="$(grep -m1 '"version"' "$SRC/package.json" | sed 's/.*"version": *"\([^"]*\)".*/\1/')"

for DEST_ROOT in "$HOME/.vscode/extensions" "$HOME/.cursor/extensions"; do
  mkdir -p "$DEST_ROOT"
  DEST="$DEST_ROOT/$ID-$VERSION"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp "$SRC/package.json" "$SRC/extension.js" "$SRC/jsonc.js" "$SRC/README.md" "$SRC/icon.png" "$DEST/"
  echo "Installed: $DEST"

  python3 - "$DEST_ROOT" "$ID" "$VERSION" <<'EOF'
import json, os, shutil, sys, time

root, ext_id, version = sys.argv[1], sys.argv[2], sys.argv[3]
p = os.path.join(root, "extensions.json")
entries = []
if os.path.exists(p):
    try:
        entries = json.load(open(p))
    except Exception:
        backup = p + ".bak." + str(int(time.time()))
        shutil.copy(p, backup)
        print(f"  (unreadable extensions.json backed up to {backup})")
        entries = []

folder = os.path.join(root, f"{ext_id}-{version}")
# drop stale entries of this extension (other versions / duplicates)
entries = [e for e in entries if (e.get("identifier") or {}).get("id") != ext_id]
entries.append({
    "identifier": {"id": ext_id},
    "version": version,
    "location": {"$mid": 1, "path": folder, "scheme": "file"},
    "relativeLocation": os.path.basename(folder),
    "metadata": {
        "installedTimestamp": int(time.time() * 1000),
        "pinned": True,
        "source": "vsix",
        "private": False,
        "isPreReleaseVersion": False,
        "hasPreReleaseVersion": False,
    },
})
json.dump(entries, open(p, "w"), indent=0)
print(f"  Registered in {p}")

# Remove any .obsolete marks for this extension (editors flag unregistered
# folders as garbage; that flag would exclude the folder from scanning).
ob = os.path.join(root, ".obsolete")
if os.path.exists(ob):
    try:
        marks = json.load(open(ob))
        cleaned = {k: v for k, v in marks.items() if not k.startswith(ext_id)}
        if cleaned != marks:
            if cleaned:
                json.dump(cleaned, open(ob, "w"))
            else:
                os.remove(ob)
            print(f"  Cleaned obsolete marks in {ob}")
    except Exception as e:
        print(f"  (could not clean .obsolete: {e})")
EOF
done

echo
echo "Done. Reload windows to activate."
echo "If an editor was running during this install, QUIT IT FULLY (Cmd+Q) and"
echo "reopen — a running editor may hold a stale extension list."
