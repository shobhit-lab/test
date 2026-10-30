# Deploying Rangoli ERP on Railway

Result: a web address like `https://rangoli-erp-production.up.railway.app` that works on phones and PCs, with HTTPS included. You need a paid Railway plan (Hobby) because the database file needs a persistent Volume. Menu names below may differ slightly as Railway updates its dashboard.

## Option A: with GitHub (easiest to update later)

1. Create a free GitHub account and a new **private** repository.
2. Unzip `rangoli-online.zip` and upload all its files to that repository (GitHub's "Add file > Upload files" works). Do not upload `node_modules` or `data`.
3. On railway.com: **New Project > Deploy from GitHub repo** and pick your repository. Railway detects Node.js and builds it.

## Option B: with the Railway CLI (no GitHub)

```bash
npm install -g @railway/cli
railway login
cd rangoli-online          # the unzipped folder
railway init               # create a new project
railway up                 # uploads and deploys
```

## Then, for either option

1. **Add a Volume** (this keeps your data safe across restarts and updates):
   open the service, add a **Volume**, and set the mount path to `/data`.
   The app detects the volume automatically. If you prefer, also set the variable `DATA_DIR=/data`.
2. **Variables** tab, add:
   - `TZ` = `Asia/Kolkata`   (so the 5 PM / 1 AM alerts use Indian time)
   - `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`   (optional, for low-stock alerts; see DEPLOY.md step 5)
3. **Settings > Networking > Generate Domain** to get your public web address.
   (You can attach your own domain here later.)
4. Wait for the deployment to show **Active**, then open the address.

## First login: do this straight away
The first screen says **Create Admin**. Whoever opens the page first becomes the admin, so create your admin account immediately after the deployment is live. Then add your team under **Users**.

To bring your old data: in the old version use **Backup > Export JSON**, then in the new one use **Backup > Import JSON**.

## Phones
Open the address, log in, then **Add to Home Screen** (Chrome: menu > Install app; iPhone Safari: Share > Add to Home Screen).

## Backups
- The server saves a copy every night at 2 AM into the volume (last 14 kept). That is on the same volume, so also download a backup now and then using **Backup > Export JSON** in the app.
- Railway can also back up volumes from the volume's **Backups** tab on supported plans. Check what your plan includes.

## Updating the app later
- GitHub option: change the file in the repository. Railway redeploys automatically.
- CLI option: run `railway up` again.
Your data stays on the volume.

## If something goes wrong
- **Build fails on better-sqlite3:** in `package.json` change `"better-sqlite3": "^12.0.0"` to `"latest"` and redeploy.
- **Data disappears after a deploy:** the Volume is not attached at `/data`. Check the mount path.
- **Site shows an error:** open the service's **Logs** tab and read the last lines.
