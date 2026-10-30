# Deploying Rangoli ERP online (VPS + HTTPS)

Result: everyone opens `https://shop.yourdomain.com` on phone or PC and sees the same stock.

```
Phone / PC -> https://shop.yourdomain.com -> Caddy (HTTPS) -> Node server -> data/rangoli.db
```

## What you need
- A small Ubuntu VPS (1 GB RAM is enough), about Rs 300-500/month.
- A domain name, with an **A record** pointing to the VPS IP address.

## 1. Prepare the server
Log in over SSH, then:

```bash
sudo apt update && sudo apt install -y curl build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Upload and start the app
From your own computer (replace the IP):

```bash
scp rangoli-online.zip root@YOUR_SERVER_IP:/root/
```

On the server:

```bash
sudo apt install -y unzip
unzip rangoli-online.zip -d rangoli && cd rangoli
npm install --omit=dev
nano ecosystem.config.js        # optional: add Telegram alert details (step 5)
pm2 start ecosystem.config.js
pm2 save
pm2 startup                     # run the command it prints, so the app restarts after a reboot
```

If `npm install` fails on `better-sqlite3`, run `npm install better-sqlite3@latest` and try again.

## 3. Turn on HTTPS with Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Edit `/etc/caddy/Caddyfile` so it contains only:

```
shop.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Then:

```bash
sudo systemctl reload caddy
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

Caddy gets and renews the HTTPS certificate by itself.

## 4. First login
1. Open `https://shop.yourdomain.com`. The first screen says **Create Admin**. Choose a username and a password of 6+ characters.
2. Go to **Users** and add the other 4-5 people.
3. **Moving your existing data:** the old file kept its data inside the browser where you opened it, and the server cannot see that. In the **old** version click **Backup > Export JSON**, then in the **new** online version click **Backup > Import JSON**.
   Until you import, the app shows sample products.

## 5. Phones
- Open the web address, log in, then **Add to Home Screen** (Chrome: menu > Add to Home screen / Install app; iPhone Safari: Share > Add to Home Screen).
- Low-stock alerts from the server (5 PM and 1 AM, even when nobody has the app open) need a Telegram bot:
  1. In Telegram, message **@BotFather**, send `/newbot`, and copy the token.
  2. Create a group with your team, add the bot, send a message, then open
     `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the `chat` `id`.
  3. Put both values in `ecosystem.config.js` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`), then run
     `pm2 restart rangoli --update-env`.

## 6. Backups
- The server copies the database every night at 2 AM into `data/backups/` and keeps the last 14.
- That is on the same machine, so also turn on your VPS provider's snapshot/backup option, or download the folder now and then:
  `scp -r root@YOUR_SERVER_IP:/root/rangoli/data/backups ./`
- Anyone can also use **Backup > Export JSON** inside the app.

## How it behaves
- Changes appear on the screen instantly and are saved to the server. If two people change data at nearly the same moment, the second person sees "Someone else changed the data first" and repeats the change. Nothing is overwritten silently.
- Other people's changes show up within about 20 seconds, or immediately when the app is reopened.
- Wrong password 5 times locks that login for 15 minutes.
- To update the app later: replace `public/index.html` or `server.js`, then `pm2 restart rangoli`.
