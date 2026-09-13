#!/usr/bin/env sh
set -eu

if [ "$(id -u)" = 0 ]; then
  exec /usr/local/bin/mediasteru-entrypoint /usr/local/libexec/mediasteru "$@"
fi
exec /usr/local/libexec/mediasteru "$@"
