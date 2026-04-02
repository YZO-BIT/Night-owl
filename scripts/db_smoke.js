const fs = require('fs');
const path = require('path');

function readEnvVarFromDotEnv(dotEnvPath, key) {
  const raw = fs.readFileSync(dotEnvPath, 'utf8');
  const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`, 'm'));
  if (!match) return null;

  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function describeConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      port: url.port || '(default)',
      database: url.pathname?.replace(/^\//, '') || '(none)',
      username: decodeURIComponent(url.username || ''),
    };
  } catch {
    return { host: '(unparseable)', port: '(unparseable)', database: '(unparseable)', username: '(unparseable)' };
  }
}

async function tryConnect(label, connectionString) {
  const { Client } = require('pg');
  const desc = describeConnectionString(connectionString);
  console.log(`${label}: trying host=${desc.host} port=${desc.port} db=${desc.database} user=${desc.username}`);

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
    const r = await client.query('select 1 as ok');
    console.log(`${label}: CONNECT OK; select1=`, r.rows?.[0]?.ok);
    await client.end();
    return true;
  } catch (e) {
    const safe = {
      name: e?.name,
      code: e?.code,
      message: e?.message,
    };
    console.error(`${label}: CONNECT FAILED`, JSON.stringify(safe));
    try {
      await client.end();
    } catch {
      // ignore
    }
    return false;
  }
}

async function main() {
  const dotEnvPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(dotEnvPath)) {
    console.error('.env not found');
    process.exit(2);
  }

  const directUrl = readEnvVarFromDotEnv(dotEnvPath, 'DIRECT_URL');
  const databaseUrl = readEnvVarFromDotEnv(dotEnvPath, 'DATABASE_URL');
  if (!directUrl && !databaseUrl) {
    console.error('DIRECT_URL and DATABASE_URL not found in .env');
    process.exit(2);
  }

  let ok = false;
  if (directUrl) ok = (await tryConnect('DIRECT_URL', directUrl)) || ok;
  if (!ok && databaseUrl) ok = (await tryConnect('DATABASE_URL', databaseUrl)) || ok;

  if (!ok) process.exitCode = 1;
}

main();
