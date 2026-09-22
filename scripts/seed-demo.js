// Optional demo: ensures a flappable, public API exists for the admin, so the
// public status page has something interesting to show.
//
//   PULSE_BASE_URL=http://localhost:3000 \
//   PULSE_ADMIN_EMAIL=you@example.com PULSE_ADMIN_PASSWORD=... \
//   node scripts/seed-demo.js
//
// Uses the same REST API as the web app (the frontend proxies /api/*).
'use strict';

const BASE = process.env.PULSE_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.PULSE_ADMIN_EMAIL;
const PASSWORD = process.env.PULSE_ADMIN_PASSWORD;

async function call(path, { method = 'GET', token, teamId, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (teamId) headers['x-team-id'] = teamId;
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.error?.message ?? res.statusText}`);
  return json;
}

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error('Set PULSE_ADMIN_EMAIL and PULSE_ADMIN_PASSWORD (an existing admin account), then run again.');
    process.exit(2);
  }

  const login = await call('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  const token = login.token;
  const teams = await call('/teams', { token });
  if (!teams.length) {
    console.error('The admin owns no teams. Create one in the UI first.');
    process.exit(2);
  }
  const team = teams[0];
  console.log(`Using team "${team.name}" (slug: ${team.slug ?? 'n/a'} / id: ${team.id})`);

  const apiInput = {
    name: 'PayApi (flappy)',
    url: 'https://httpbin.org/get',
    method: 'GET',
    expectedStatus: 200,
    latencyThresholdMs: 1000,
    intervalSeconds: 60,
    isActive: true,
    isPublic: true,
  };

  const existing = await call(`/apis?teamId=${team.id}`, { token });
  const found = existing.find((a) => a.name === apiInput.name);
  let api = found;
  if (api) {
    console.log(`API "${apiInput.name}" already exists (${api.id}); skipping create.`);
  } else {
    api = await call('/apis', { method: 'POST', token, teamId: team.id, body: apiInput });
    console.log(`Created "${apiInput.name}" (${api.id}).`);
  }

  if (!api.isPublic || api.slug !== 'payapi-flappy') {
    api = await call(`/apis/${api.id}`, {
      method: 'PATCH',
      token,
      teamId: team.id,
      body: { isPublic: true, name: apiInput.name, slug: 'payapi-flappy' },
    });
    console.log('Marked public with slug payapi-flappy.');
  }

  const teamSlug = team.slug ?? 'dev';
  console.log(`Public status page: ${BASE}/status/${teamSlug}/${api.slug}`);
  console.log('Done. Give httpbin a minute to alternate between UP and DEGRADED.');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});