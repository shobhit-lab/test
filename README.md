# Rangoli ERP (Dhanlaxmi Enterprises)

Single-file static web app (`index.html`). No build step.

## Deploy
1. Push this folder to a GitHub repo.
2. On vercel.com: **Add New → Project → Import** the repo.
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty. Click **Deploy**.

## Notes
- All data is stored in the browser's `localStorage`, so it is per-device and per-browser. It is not shared between users or devices.
- Optional settings (`notifyUrl`, `googleClientId`) are in the `CFG` object near the bottom of `index.html`.
