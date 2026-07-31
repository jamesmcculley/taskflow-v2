#!/usr/bin/env bash
#
# Updates TaskFlow v2 in place from the latest GitHub release.
#
# Copy this into your vault's plugin folder and run it from there:
#
#   cd /path/to/vault/.obsidian/plugins/taskflow-v2
#   ./update-plugin.sh          # update to the latest release
#   ./update-plugin.sh --check  # report versions, download nothing
#
# Everything is downloaded to a temp directory and validated before anything
# in the plugin folder is touched, because the failure that actually bites is
# a download that "succeeds" and writes a GitHub error page over main.js —
# leaving a plugin that won't load. If any check fails, nothing is replaced.
#
# data.json is never touched: it holds your sort order, History, saved
# filters, and review highlights.

set -euo pipefail

REPO="${TASKFLOW_REPO:-jamesmcculley/taskflow-v2}"
FILES=(main.js manifest.json styles.css)
BASE="https://github.com/${REPO}/releases/latest/download"

# Work relative to the script, not the caller's cwd, so it behaves the same
# whether it's run from inside the folder or by absolute path.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

version_of() {
	# Reads "version" out of a manifest without needing jq installed.
	sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1
}

command -v curl >/dev/null || die "curl not found"

current="unknown"
[ -f "$DIR/manifest.json" ] && current="$(version_of "$DIR/manifest.json")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'Fetching latest release of %s…\n' "$REPO"
for f in "${FILES[@]}"; do
	# --fail turns a 404 into a non-zero exit instead of a saved error page.
	curl -fsSL --retry 2 -o "$tmp/$f" "$BASE/$f" \
		|| die "download failed: $f (no files were changed)"
done

# Validate before touching anything in place.
[ -s "$tmp/manifest.json" ] || die "manifest.json is empty"
grep -q '"id"[[:space:]]*:[[:space:]]*"taskflow-v2"' "$tmp/manifest.json" \
	|| die "manifest.json is not TaskFlow v2 — refusing to install"
latest="$(version_of "$tmp/manifest.json")"
[ -n "$latest" ] || die "could not read a version from the downloaded manifest"

# main.js is a ~600KB esbuild bundle; anything tiny is an error page, and the
# banner confirms it's the bundle rather than arbitrary HTML.
size=$(wc -c < "$tmp/main.js")
[ "$size" -gt 100000 ] || die "main.js is only ${size} bytes — that's not the bundle"
head -c 200 "$tmp/main.js" | grep -q 'GENERATED/BUNDLED FILE BY ESBUILD' \
	|| die "main.js doesn't look like the plugin bundle"
[ -s "$tmp/styles.css" ] || die "styles.css is empty"

if [ "$current" = "$latest" ]; then
	printf 'Already on %s — nothing to do.\n' "$current"
	exit 0
fi

if [ "${1:-}" = "--check" ]; then
	printf 'Installed: %s\nLatest:    %s\nRun without --check to update.\n' "$current" "$latest"
	exit 0
fi

for f in "${FILES[@]}"; do
	cp "$tmp/$f" "$DIR/$f"
done

printf 'Updated %s -> %s\n' "$current" "$latest"
printf 'Restart Obsidian (or use the reload button in the TaskFlow sidebar footer).\n'
