/**
 * Tiny fetch wrapper.
 * - Same-origin by default (frontend + API on one domain).
 * - Set VITE_API_URL at build time if the API lives elsewhere, e.g. https://api.yourdomain.com
 */
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'cas_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, form, signal } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !form) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      signal,
      body: form || (body ? JSON.stringify(body) : undefined),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Network error — check your connection.', 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event('auth:logout'));
    }
    throw new ApiError(data.message || `Request failed (${res.status})`, res.status, data.code);
  }
  return data;
}

/**
 * POST multipart form and read Server-Sent Events as they arrive.
 * onEvent(eventName, data) is called for each event (step, delta, image_progress, done, …).
 * Non-SSE replies (validation, quota, expired account) are thrown as ApiError.
 */
export async function streamRequest(path, form, { onEvent, signal } = {}) {
  const headers = { Accept: 'text/event-stream' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, { method: 'POST', headers, body: form, signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Network error — check your connection.', 0);
  }

  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event('auth:logout'));
    }
    throw new ApiError(data.message || `Request failed (${res.status})`, res.status, data.code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finished = false;
  const SEP = /\r?\n\r?\n/;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let m;
    while ((m = SEP.exec(buf))) {
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      let event = 'message';
      let data = '';
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue; // heartbeat comments
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (event === 'done' || event === 'error') finished = true;
      onEvent?.(event, parsed);
    }
  }
  if (!finished) throw new ApiError('Connection lost before the answer finished. Please try again.', 0);
}

export const api = {
  get: (p, o) => request(p, o),
  post: (p, body, o) => request(p, { ...o, method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: (p, form, o) => request(p, { ...o, method: 'POST', form }),
};
