const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

function randEmail() {
  const n = Math.floor(Math.random() * 1e9);
  return `smoke_${n}@example.com`;
}

async function postJson(path, body, cookie) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, ok: res.ok, json, text, setCookie };
}

function summarize(resp) {
  return {
    ok: resp.ok,
    status: resp.status,
    json: resp.json,
    text: resp.json ? undefined : resp.text?.slice(0, 400),
    setCookie: resp.setCookie ? resp.setCookie.split(';')[0] : undefined,
  };
}

async function main() {
  const email = randEmail();
  const password = 'Test12345!';

  console.log('Base URL:', baseUrl);
  console.log('Email:', email);

  const reg = await postJson('/api/auth/register', { email, password, name: 'Smoke User' });
  console.log('REGISTER', summarize(reg));

  const login = await postJson('/api/auth/login', { email, password });
  console.log('LOGIN', summarize(login));

  if (!login.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Smoke script failed:', e);
  process.exitCode = 1;
});
