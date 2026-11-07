// ZCC Trading — Quant Nexus server (trading.z-cc.link)
// Serves the single-file dashboard and a small same-origin API that fetches
// sources the browser can't reach directly (no CORS / HTML-only): spot ETF
// flows, multi-outlet RSS news, Fear & Greed and CoinGecko global, cached.
// Binance market data is streamed by the browser straight from Binance.
// No dependencies: Node 20+ (global fetch).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const html = fs.readFileSync(path.join(__dirname, 'index.html'));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 ZCC-Trading/1.0';

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.val;
  try {
    const val = await fn();
    cache.set(key, { at: Date.now(), val });
    return val;
  } catch (e) {
    if (hit) return { ...hit.val, stale: true, error: String(e.message || e) };
    throw e;
  }
}
async function get(url, type = 'json', ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : 'text/html,application/xml,*/*' } });
    if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
    return type === 'json' ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}

/* ---------- Spot ETF flows (Farside, daily, US$m) ---------- */
function parseFarside(page) {
  const rows = page.split(/<tr[\s>]/i).slice(1);
  const out = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    if (cells.length < 3) continue;
    const d = cells[0];
    if (!/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(d)) continue;
    const raw = cells[cells.length - 1].replace(/,/g, '');
    if (!raw || raw === '-') continue;
    const neg = /^\(.*\)$/.test(raw);
    const n = parseFloat(raw.replace(/[()]/g, ''));
    if (isNaN(n)) continue;
    out.push({ date: d, total: neg ? -n : n });
  }
  return out;
}
async function etf() {
  return cached('etf', 30 * 60e3, async () => {
    const res = { source: 'farside.co.uk', at: Date.now() };
    for (const [k, u] of [['BTC', 'https://farside.co.uk/btc/'], ['ETH', 'https://farside.co.uk/eth/'], ['SOL', 'https://farside.co.uk/sol/']]) {
      try {
        const rows = parseFarside(await get(u, 'text'));
        if (rows.length) { const last = rows[rows.length - 1]; res[k] = { net: last.total, date: last.date, last5: rows.slice(-5) }; }
      } catch (e) { res[k] = { error: String(e.message || e) }; }
    }
    if (!res.BTC || res.BTC.error) throw new Error('ETF flow source unavailable');
    return res;
  });
}

/* ---------- News (RSS from major outlets + CryptoCompare) ---------- */
const FEEDS = [
  ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/'],
  ['Cointelegraph', 'https://cointelegraph.com/rss'],
  ['Decrypt', 'https://decrypt.co/feed'],
  ['The Block', 'https://www.theblock.co/rss.xml'],
  ['Bitcoin Magazine', 'https://bitcoinmagazine.com/feed'],
  ['CryptoSlate', 'https://cryptoslate.com/feed/']
];
const unCdata = s => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8217;|&#039;|&apos;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
function parseRss(xml, src) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].slice(0, 25).map(m => {
    const it = m[0];
    const tag = n => { const r = it.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)<\\/' + n + '>', 'i')); return r ? unCdata(r[1]) : ''; };
    const t = Date.parse(tag('pubDate') || tag('dc:date')) || Date.now();
    return { title: tag('title'), url: tag('link') || (it.match(/<guid[^>]*>([^<]+)/i) || [])[1], src, t, body: tag('description').slice(0, 400) };
  }).filter(x => x.title && x.url);
}
async function news() {
  return cached('news', 4 * 60e3, async () => {
    const results = await Promise.allSettled(FEEDS.map(([n, u]) => get(u, 'text').then(x => parseRss(x, n))));
    let items = []; const status = {};
    results.forEach((r, i) => { status[FEEDS[i][0]] = r.status === 'fulfilled' ? r.value.length : 'error'; if (r.status === 'fulfilled') items.push(...r.value); });
    try {
      const cc = await get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');
      if (Array.isArray(cc.Data)) { cc.Data.slice(0, 40).forEach(x => items.push({ title: x.title, url: x.url, src: (x.source_info && x.source_info.name) || x.source, t: x.published_on * 1000, body: (x.body || '').slice(0, 400) })); status.CryptoCompare = cc.Data.length; }
    } catch (e) { status.CryptoCompare = 'error'; }
    const seen = new Set();
    items = items.filter(x => { const k = x.title.toLowerCase().slice(0, 70); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.t - a.t).slice(0, 90);
    if (!items.length) throw new Error('all news feeds failed');
    return { items, status, at: Date.now() };
  });
}

/* ---------- Macro ---------- */
const macro = () => cached('macro', 2 * 60e3, async () => {
  const [f, g] = await Promise.allSettled([get('https://api.alternative.me/fng/?limit=2'), get('https://api.coingecko.com/api/v3/global')]);
  const out = { at: Date.now() };
  if (f.status === 'fulfilled') out.fng = { now: +f.value.data[0].value, label: f.value.data[0].value_classification, prev: +f.value.data[1].value };
  if (g.status === 'fulfilled') { const d = g.value.data; out.global = { mcap: d.total_market_cap.usd, mchg: d.market_cap_change_percentage_24h_usd, dom: d.market_cap_percentage.btc, ethDom: d.market_cap_percentage.eth, vol: d.total_volume.usd }; }
  if (!out.fng && !out.global) throw new Error('macro sources unavailable');
  return out;
});

/* ---------- HTTP ---------- */
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const routes = { '/api/etf': etf, '/api/news': news, '/api/macro': macro };
http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/health') return send(res, 200, { ok: true, app: 'zcc-trading', at: Date.now() });
  if (routes[url]) {
    try { return send(res, 200, await routes[url]()); }
    catch (e) { return send(res, 502, { error: String(e.message || e) }); }
  }
  send(res, 200, html, 'text/html');
}).listen(PORT, () => console.log(`ZCC Trading (Quant Nexus) running on port ${PORT}`));
