// pm2 config: edit the env values, then run:  pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'rangoli',
    script: 'server.js',
    env: {
      PORT: 3000,
      TZ: 'Asia/Kolkata',
      // Optional low-stock alerts to your phone via a Telegram bot (see DEPLOY.md):
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      // Optional: any URL that accepts a JSON POST {text, items}
      NOTIFY_WEBHOOK: ''
    }
  }]
};
