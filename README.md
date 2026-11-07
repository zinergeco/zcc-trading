# ZCC Trading — Quant Nexus (trading.z-cc.link)

AI futures signal desk for the ZCC portfolio. It covers 15 Binance USDⓈ-M perpetuals
(USDC pairs where listed) in three leverage tiers: 15x BTC ETH XRP SOL LTC BNB ·
10x ARB AAVE SUI NEAR · 5x ADA AVAX PEPE NEO HYPE.

Eight agents feed one decision: Chief Strategist, Market Analyst, Derivatives Analyst,
Macro & Flow, Quant Momentum, News Sentiment, Risk Manager (veto) and Financial Expert.
The output for each coin is LONG / SHORT / HOLD with a market or limit entry,
a TP1/TP2/TP3 ladder, a stop-loss, liquidation price and position size.

## Data: all real, nothing simulated in production
| Source | How | Refresh |
|---|---|---|
| Binance USDⓈ-M WebSocket (@ticker) | browser → Binance | real-time |
| Binance klines 15m/1h/4h, premiumIndex, 24h ticker | browser → Binance REST | 60 s |
| Binance OI history, global L/S ratio, taker buy/sell | browser → Binance REST | 5 min |
| Fear & Greed (alternative.me), CoinGecko global | server `/api/macro` | 2 min |
| News: CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, CryptoSlate RSS + CryptoCompare | server `/api/news` | 4 min |
| US spot ETF flows BTC/ETH/SOL (Farside) | server `/api/etf` | 30 min |

If Binance is unreachable, the page shows **UPLINK DOWN** and retries; it never
falls back to fake data. The simulated feed only runs when the file is opened
without this server (e.g. as a claude.ai artifact preview).

Binance data comes from the **viewer's** browser, so it works from the UK.
US IP addresses get HTTP 451 from Binance.

## Stack
This follows the same structure as zcc-central-dashboard: a single self-contained
`index.html` plus a vanilla Node `server.js` (no dependencies; Node 20 for global fetch)
and a Dockerfile. `GET /api/health` is the health check.

## Deploy (same as z-cc.link)
1. Create the GitHub repo `zinergeco/zcc-trading` and push this folder to `main`.
2. Coolify: New Resource → this repo → Dockerfile build → server `turingminds-live-p16g`.
   In Network → Port mapping set `3008:3000`. Pick any free host port, but don't reuse
   3003, which z-cc.link uses.
3. DNS (Route 53, z-cc.link zone): add A record `trading` → the server IP.
4. On the server: copy `nginx-trading.z-cc.link.conf` to `/etc/nginx/conf.d/`,
   `nginx -t && systemctl reload nginx`, then `certbot --nginx -d trading.z-cc.link`.
5. Push to `main` and Coolify redeploys automatically.

## Local
`node server.js` → http://localhost:3000

Signals are rule-based and not financial advice. Paper-trade them before you use real size.
