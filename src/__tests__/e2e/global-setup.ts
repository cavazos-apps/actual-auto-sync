import { setTimeout as delay } from 'node:timers/promises';

/**
 * Vitest globalSetup for E2E tests.
 *
 * Why: actualbudget/actual-server >= 26.5.0 hard-codes a 5-attempt / 15-minute
 * IP rate limit on /account/login (no opt-out env var). Across our e2e test
 * files, password-based api.init() calls easily exceed that — and a 15-min
 * window cannot be retried around. Instead, we log in exactly once here and
 * publish the resulting session token via process.env.ACTUAL_E2E_SESSION_TOKEN.
 * Forked test workers inherit the env, and initApi() passes it as
 * `sessionToken` to api.init(), bypassing the rate-limited /login path.
 */

const SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5006';
const SERVER_PASSWORD = process.env.ACTUAL_SERVER_PASSWORD || 'test-password-e2e';

// Server isn't necessarily ready when globalSetup starts; wait for it before logging in.
async function waitForServerReady(maxAttempts = 60, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${SERVER_URL}/`);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await delay(delayMs);
  }
  throw new Error(`globalSetup: server at ${SERVER_URL} not ready`);
}

async function ensureBootstrapped(): Promise<void> {
  const res = await fetch(`${SERVER_URL}/account/needs-bootstrap`);
  if (!res.ok) return;
  const body = (await res.json()) as { status?: string; data?: { bootstrapped?: boolean } };
  if (body.status === 'ok' && body.data?.bootstrapped === false) {
    const bootstrap = await fetch(`${SERVER_URL}/account/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: SERVER_PASSWORD }),
    });
    if (!bootstrap.ok) {
      const text = await bootstrap.text();
      throw new Error(`globalSetup: bootstrap failed: ${bootstrap.status} ${text}`);
    }
  }
}

async function fetchSessionToken(): Promise<string> {
  const response = await fetch(`${SERVER_URL}/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SERVER_PASSWORD, loginMethod: 'password' }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`globalSetup: /account/login returned ${response.status}: ${text}`);
  }

  const body = (await response.json()) as {
    status?: string;
    data?: { token?: string };
    reason?: string;
  };
  if (body.status !== 'ok' || !body.data?.token) {
    throw new Error(`globalSetup: unexpected /account/login body: ${JSON.stringify(body)}`);
  }
  return body.data.token;
}

export async function setup(): Promise<void> {
  await waitForServerReady();
  await ensureBootstrapped();
  const token = await fetchSessionToken();
  process.env.ACTUAL_E2E_SESSION_TOKEN = token;
  console.log('[E2E globalSetup] Captured shared session token (login rate limit consumed: 1)');
}

export async function teardown(): Promise<void> {
  delete process.env.ACTUAL_E2E_SESSION_TOKEN;
}
