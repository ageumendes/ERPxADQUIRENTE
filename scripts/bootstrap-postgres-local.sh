#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-erpxadquirente}"
DB_USER="${DB_USER:-erpxadquirente}"
DB_PASS="${DB_PASS:-}"

if [[ ! "${DB_NAME}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || [[ ! "${DB_USER}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "DB_NAME e DB_USER devem ser identificadores PostgreSQL válidos." >&2
  exit 1
fi

if [[ ${#DB_PASS} -lt 16 ]]; then
  echo "Defina DB_PASS com pelo menos 16 caracteres antes de executar este script." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "PostgreSQL/psql não encontrado. Instale com: sudo apt install postgresql postgresql-contrib -y" >&2
  exit 1
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 --set=db_user="${DB_USER}" --set=db_pass="${DB_PASS}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_user') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'db_user', :'db_pass')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_user') \gexec
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 --set=db_name="${DB_NAME}" --set=db_user="${DB_USER}" <<'SQL'
SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'db_name', :'db_user') \gexec
SELECT format('GRANT ALL ON SCHEMA public TO %I', :'db_user') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'db_user') \gexec
SQL

echo "Banco PostgreSQL pronto: ${DB_NAME} / usuário: ${DB_USER}"
echo "Configure DATABASE_URL no .env do backend. A senha não será exibida neste terminal."
