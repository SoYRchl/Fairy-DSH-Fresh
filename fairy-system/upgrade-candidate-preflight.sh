#!/bin/sh
set -eu

fail() {
  printf '%s\n' "Error: $*" >&2
  exit 2
}

[ "$#" -gt 0 ] || fail 'an isolated --profile and --runtime pair is required'
case " $* " in
  *' --allow-current '*) fail '--allow-current is forbidden for candidate upgrades' ;;
esac

profile=''
runtime=''
version=''
hash=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile) [ "$#" -ge 2 ] || fail '--profile requires a path'; profile=$2; shift 2 ;;
    --runtime) [ "$#" -ge 2 ] || fail '--runtime requires a path'; runtime=$2; shift 2 ;;
    --expected-version) [ "$#" -ge 2 ] || fail '--expected-version requires a value'; version=$2; shift 2 ;;
    --expected-sha256) [ "$#" -ge 2 ] || fail '--expected-sha256 requires a value'; hash=$2; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[ -n "$profile" ] || fail '--profile is required'
[ -n "$runtime" ] || fail '--runtime is required'
[ -n "$version" ] || fail '--expected-version is required'
[ -n "$hash" ] || fail '--expected-sha256 is required'

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$ROOT/upgrade-preflight.js" \
  --profile "$profile" \
  --runtime "$runtime" \
  --expected-version "$version" \
  --expected-sha256 "$hash"
