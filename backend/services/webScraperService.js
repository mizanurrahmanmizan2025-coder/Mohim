/**
 * Fetches a public web page and extracts readable text.
 * Includes SSRF protection: refuses localhost / private network addresses.
 */
const dns = require('dns').promises;
const net = require('net');
const cheerio = require('cheerio');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 24000;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.');
}

async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('Invalid URL'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('Only http/https URLs are allowed'), { status: 400 });
  const { address } = await dns.lookup(url.hostname);
  if (isPrivateIp(address)) throw Object.assign(new Error('That address is not allowed'), { status: 400 });
  return url;
}

async function scrape(rawUrl) {
  let url = await assertPublicUrl(rawUrl);

  // Follow up to 3 redirects manually so each hop is SSRF-checked
  let res;
  for (let hop = 0; hop < 4; hop += 1) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CustomAISuiteBot/1.0)', Accept: 'text/html,*/*' },
      });
    } finally { clearTimeout(t); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    break;
  }
  if (!res.ok) throw Object.assign(new Error(`Could not fetch page (HTTP ${res.status})`), { status: 400 });

  const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
  const html = buf.toString('utf8');
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, nav, footer, form').remove();

  const title = $('title').first().text().trim();
  const description = $('meta[name="description"]').attr('content') || '';
  const text = $('article').text() || $('main').text() || $('body').text();
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);

  return { url: url.toString(), title, description, text: clean };
}

const URL_REGEX = /https?:\/\/[^\s<>"')]+/gi;
const extractUrls = (s) => [...new Set((s || '').match(URL_REGEX) || [])].slice(0, 3);

module.exports = { scrape, extractUrls };
