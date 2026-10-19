# Custom AI Suite — Setup & Hostinger Deployment

One Node.js app does everything: Express serves the API under `/api/*` **and** the built React app for every other URL. That means one domain, no CORS issues, and no hand-written proxy rules.

```
custom-ai-suite/
├── package.json        ← root: install / build / start scripts Hostinger runs
├── server.js           ← Hostinger entry file (loads backend/server.js)
├── backend/            ← Express API (config, controllers, middleware, models, routes, services)
├── frontend/           ← React + Vite + Tailwind (builds to frontend/dist)
└── deploy/             ← optional .htaccess for split hosting
```

---

## 1. What you need first

| Item | Where |
|---|---|
| Hostinger plan with **Node.js Web Apps** | Business Web Hosting or any Cloud plan (Premium/Single shared hosting can't run Node) |
| MongoDB Atlas free cluster (M0) | https://cloud.mongodb.com |
| API keys | Groq: console.groq.com · Gemini: aistudio.google.com · OpenRouter: openrouter.ai · Mistral: console.mistral.ai |

You don't need all four providers — the cascade skips any provider with no keys. **Gemini is required for image/PDF vision (OCR).**

### MongoDB Atlas
1. Create a free M0 cluster.
2. **Database Access** → add a user + password.
3. **Network Access** → *Add IP Address* → `0.0.0.0/0` (Hostinger's outbound IP isn't fixed; the password protects the DB).
4. **Connect → Drivers** → copy the `mongodb+srv://…` string, insert your password, and add a DB name before `?`, e.g. `…mongodb.net/custom-ai-suite?retryWrites=true&w=majority`.

---

## 2. Run it locally (optional but recommended)

```bash
cd custom-ai-suite
cp backend/.env.example backend/.env      # then fill in the values
npm install                               # installs backend + frontend
npm run build                             # builds frontend/dist
npm start                                 # → http://localhost:3000
```

For live-reload development use two terminals: `npm run dev:api` and `npm run dev:web` (Vite on :5173 proxies `/api` to :3000).

---

## 3. Build the frontend for production

Hostinger runs this for you, but the command is:

```bash
npm run build        # = npm --prefix frontend run build → frontend/dist
```

Express automatically serves `frontend/dist` when it exists.

---

## 4. Deploy on Hostinger (Option A — recommended)

1. **Zip the project** *without* `node_modules`, `frontend/dist` and `.env` (the zip you received is already clean). Or push it to a GitHub repo.
2. hPanel → **Websites → Add website → Node.js web app**.
3. Choose **Upload files** (the `.zip`) or **Import from GitHub**.
4. On the deploy-settings screen set:

   | Field | Value |
   |---|---|
   | Framework preset | **Express** (or *Other*) |
   | Node.js version | **22** |
   | Root directory | `/` (the folder containing the root `package.json`) |
   | Build command | `npm run build` |
   | Entry file | `server.js` |

   Hostinger runs `npm install` (our `postinstall` installs both `backend/` and `frontend/`), then `npm run build`, then starts `server.js`.
5. **Environment variables** (same screen, or later under the app's *Settings → Environment variables*). Add every key from `backend/.env.example`. The essentials:

   ```
   NODE_ENV=production
   CLIENT_URL=https://yourdomain.com
   MONGODB_URI=mongodb+srv://...
   JWT_SECRET=<64+ random characters>
   ADMIN_EMAIL=you@yourdomain.com
   GROQ_API_KEYS=key1,key2,key3
   GEMINI_API_KEYS=key1,key2
   OPENROUTER_API_KEYS=key1
   MISTRAL_API_KEYS=key1
   ```

   - Key pools are **comma-separated** — add as many as you have.
   - Do **not** set `PORT`; Hostinger provides it.
   - Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
6. Click **Deploy** and watch the build log. When it's green, open the temporary URL and check `https://<url>/api/health` — it lists each provider and how many keys it loaded.
7. **Connect your domain**: in the app dashboard → *Domains* → connect your custom domain, then enable the free SSL.
8. **Create the admin**: open your site, **Register** with the exact email you put in `ADMIN_EMAIL`. That account becomes super admin automatically and gets the **Admin dashboard** link in the sidebar (`/admin`).
   - Alternatively, from Hostinger's SSH terminal inside the app folder: `node backend/scripts/createAdmin.js you@domain.com "StrongPass123" "Your Name"`

After any env-variable change, **redeploy/restart** the app so it picks up the new values.

### `.htaccess` in Option A
You don't write one. When a Node.js web app is deployed, Hostinger generates the `.htaccess` in `public_html` that forwards **all** requests to the Node process. Express then routes them:

| Request | Handled by |
|---|---|
| `/api/*` | Express API routes |
| `/assets/*`, `/favicon.svg` … | static files from `frontend/dist` |
| anything else (`/c/123`, `/admin`, `/share/abc`) | `index.html` → React Router |

Don't edit or replace Hostinger's generated `.htaccess`, or routing to your app will break.

---

## 5. Option B — split hosting (only if you can't run Node on the main domain)

Use this if your main domain is on a plan without Node.js, and the API runs elsewhere (another Hostinger Node app on `api.yourdomain.com`, a VPS, etc.).

1. Deploy the API as in Option A on `api.yourdomain.com`, with `CLIENT_URL=https://yourdomain.com`.
2. Build the frontend locally pointing at that API:
   ```bash
   cd frontend
   VITE_API_URL=https://api.yourdomain.com npm run build
   ```
   (Windows PowerShell: `$env:VITE_API_URL="https://api.yourdomain.com"; npm run build`)
3. Upload the **contents** of `frontend/dist/` to `public_html` with File Manager.
4. Rename `deploy/htaccess-split-hosting.txt` to `.htaccess` and upload it to `public_html` too. It forces HTTPS, sends unknown URLs to `index.html` for React Router, and sets caching.

---

## 6. Admin dashboard cheat-sheet (`/admin`)

- **Status buttons**: ✓ Active · ⏸ Suspend · ⛔ Block · 🗑 Delete (deletes the user and their chats).
- **✏ Edit** → set an exact expiry date, *Lifetime*, or quick ±7/30/90/365 days; set hourly/daily request limits (0 = unlimited); reset usage counters; change role.
- Expired users can still log in and read/export old chats, but sending is blocked with: *"Your account subscription has expired. Please contact the administrator to renew."*
- New sign-ups get `DEFAULT_VALIDITY_DAYS` (default 7). Set it to `0` if every new account should wait for you to activate it. Set `ALLOW_REGISTRATION=false` to close sign-ups.
- **Key pools** card shows keys loaded, keys cooling down after a 429, and success/fail counts per provider.

---

## 7. How the AI engine works

- **Round-robin**: every request (from any user) takes the next key in that provider's pool.
- **Cooldown**: a key that returns `429` is parked for `KEY_COOLDOWN_MS` (or the provider's `Retry-After`); a `401/403` key is parked for an hour.
- **Cascade**: `groq → gemini → openrouter → mistral` (change with `PROVIDER_ORDER`). On 429/5xx/timeout it immediately tries another key, then the next provider — no delay, no error shown to the user unless *everything* fails.
- **Vision**: images and scanned PDFs go to Gemini; text PDFs are extracted on the server and can be answered by any provider.
- **Images**: Pollinations URLs are built server-side; the user's browser loads them directly.
- **Models** are env variables — when a provider retires a model, change `GROQ_MODEL` etc. and restart. No code change.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails on `vite: not found` | Make sure the root `package.json` (with `postinstall`) is at the app root you selected. |
| App crashes: `JWT_SECRET is missing` | Add `JWT_SECRET` (32+ chars) in env vars, redeploy. |
| `failed to start: … ENOTFOUND / timed out` | Wrong `MONGODB_URI`, or Atlas Network Access doesn't allow `0.0.0.0/0`. |
| "All AI providers are busy" | `/api/health` shows 0 keys → env var name typo, or every model name is invalid. Check the build/runtime logs for `[fallback]` lines. |
| A provider always fails with HTTP 400/404 | Its model was retired — update `*_MODEL`. Check the provider's model list. |
| Voice button missing | Speech recognition needs Chrome/Edge/Safari over HTTPS. Firefox has no Web Speech recognition. |
| Images don't download, only open | Some browsers block cross-site downloads; the open-in-tab fallback still lets users save them. |
