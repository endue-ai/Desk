#!/usr/bin/env bash
# Every check of the spike against a throwaway PostgreSQL 17 with TLS: ./run.sh [check ...]
# Needs docker, openssl, cargo, and psql 17.6 or later on PATH for the psql check.
# SPIKE_PG_URI points the plain checks at another server's database instead (they create and drop
# tables named spike_*); SPIKE_TLS_CONTAINER names the container (pg-session-spike).
set -euo pipefail
cd "$(dirname "$0")"
name="${SPIKE_TLS_CONTAINER:-pg-session-spike}"
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# A throwaway authority, a server certificate it signs for localhost (ECDSA P-256, SHA-256) and an
# authority that signed nothing, for the refusal. They live two days and go with $work.
key() { openssl ecparam -name prime256v1 -genkey -noout -out "$work/$1.key"; }
key ca; key other; key server
openssl req -x509 -new -key "$work/ca.key" -sha256 -days 2 -subj "/CN=spike CA" -out "$work/ca.crt"
openssl req -x509 -new -key "$work/other.key" -sha256 -days 2 -subj "/CN=other CA" -out "$work/other.crt"
openssl req -new -key "$work/server.key" -subj "/CN=localhost" -out "$work/server.csr"
printf 'subjectAltName=DNS:localhost\n' >"$work/ext"
openssl x509 -req -in "$work/server.csr" -CA "$work/ca.crt" -CAkey "$work/ca.key" -CAcreateserial \
  -sha256 -days 2 -extfile "$work/ext" -out "$work/server.crt" 2>/dev/null
chmod 644 "$work"/*

# The image signs in with SCRAM-SHA-256 over TCP; the key must belong to postgres, hence install.
password="$(openssl rand -hex 16)"
data=/var/lib/postgresql
docker run -d --name "$name" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD="$password" \
  -v "$work:/certs:ro" postgres:17 bash -c "
    install -o postgres -m 600 /certs/server.key $data/server.key &&
    install -o postgres -m 644 /certs/server.crt $data/server.crt &&
    exec docker-entrypoint.sh postgres -c ssl=on \
      -c ssl_cert_file=$data/server.crt -c ssl_key_file=$data/server.key" >/dev/null
port="$(docker port "$name" 5432/tcp | head -1 | sed 's/.*://')"
until docker exec "$name" pg_isready -q -U postgres -h 127.0.0.1; do sleep 0.5; done

export SPIKE_TLS_URI="postgresql://postgres:$password@localhost:$port/postgres?sslmode=verify-full&sslrootcert=$work/ca.crt"
export SPIKE_TLS_OTHER_CA="$work/other.crt"
export SPIKE_PG_URI="${SPIKE_PG_URI:-postgresql://postgres:$password@127.0.0.1:$port/postgres?sslmode=disable}"

cargo build --release --bins --quiet
checks=("$@")
[[ ${#checks[@]} -gt 0 ]] || checks=(signin tls columns text errors cancel notify stream copy netpath driver psql)
status=0
for check in "${checks[@]}"; do
  ./target/release/"$check" || status=1
done
exit "$status"
