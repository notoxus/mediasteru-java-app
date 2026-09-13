#!/usr/bin/env sh
set -eu

download_uid=$(stat -c '%u' /downloads)
download_gid=$(stat -c '%g' /downloads)
if [ "$download_uid" = 0 ]; then download_uid=1000; fi
if [ "$download_gid" = 0 ]; then download_gid=1000; fi

runtime_uid=${MEDIASTERU_UID:-$download_uid}
runtime_gid=${MEDIASTERU_GID:-$download_gid}

case "$runtime_uid" in
  ''|*[!0-9]*)
    echo "MediaSteru: MEDIASTERU_UID and MEDIASTERU_GID must be numeric." >&2
    exit 64
    ;;
esac
case "$runtime_gid" in
  ''|*[!0-9]*)
    echo "MediaSteru: MEDIASTERU_UID and MEDIASTERU_GID must be numeric." >&2
    exit 64
    ;;
esac

for directory in /data /downloads; do
  if [ "$directory" = /data ]; then
    chown -R "$runtime_uid:$runtime_gid" "$directory" || {
      echo "MediaSteru: cannot assign $directory to UID $runtime_uid:GID $runtime_gid." >&2
      exit 73
    }
  else
    chown "$runtime_uid:$runtime_gid" "$directory" || {
      echo "MediaSteru: cannot assign $directory to UID $runtime_uid:GID $runtime_gid." >&2
      exit 73
    }
  fi
  if ! setpriv --reuid="$runtime_uid" --regid="$runtime_gid" --clear-groups \
    sh -c '[ -w "$1" ]' mediasteru "$directory"; then
    echo "MediaSteru: $directory is not writable by UID $runtime_uid:GID $runtime_gid." >&2
    echo "Set MEDIASTERU_UID/MEDIASTERU_GID to the owner of the mounted folder." >&2
    exit 73
  fi
done

exec setpriv --reuid="$runtime_uid" --regid="$runtime_gid" --clear-groups "$@"
