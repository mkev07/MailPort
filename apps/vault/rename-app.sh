#!/bin/sh
# Rename the template app to your app name.
# Usage: ./rename-app.sh "Nova"
# Replaces the MailPort / mailport / MAILPORT placeholders throughout the repo.
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <AppName>   e.g. $0 Nova" >&2
  exit 1
fi

NAME="$1"
LOWER=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')
UPPER=$(printf '%s' "$NAME" | tr '[:lower:]' '[:upper:]')

echo "Renaming MailPort/mailport -> $NAME/$LOWER ..."

# Case-sensitive, most-specific first. -w is not portable; the three forms
# never overlap as substrings, so plain s/// is safe here.
find . -type f \
  -not -path "*/node_modules/*" -not -path "*/target/*" -not -path "*/.git/*" \
  -print0 | xargs -0 sed -i "" \
  -e "s/MailPort/$NAME/g" \
  -e "s/mailport/$LOWER/g" \
  -e "s/MAILPORT/$UPPER/g"

echo "Done. Rebuild: bun install && bun run tauri dev"
