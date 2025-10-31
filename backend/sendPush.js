const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');

// VAPID keys provided by user
const VAPID_PUBLIC = 'BN4Lxx-qlP5F9r13FQv_JXZAISKtwmsC28LrwpH5Dhy-A5luWaA_iPN8-xi4zuzKrUkcNqFMkgj4YSsUdT6QEHQ';
const VAPID_PRIVATE = 'iuBoyap_McadpvbwLgX-4Y2pgmXlkFKQQleFAFD8aMg';

webpush.setVapidDetails('mailto:admin@yourdomain.com', VAPID_PUBLIC, VAPID_PRIVATE);

function loadSubscriptions() {
  if (!fs.existsSync(SUBS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')) || [];
  } catch (e) {
    console.warn('Failed to load subscriptions', e);
    return [];
  }
}

async function sendNotificationToAll(payload) {
  const subs = loadSubscriptions();
  if (!subs || subs.length === 0) {
    console.log('No subscriptions found.');
    return;
  }
  const promises = subs.map((sub, idx) => {
    return webpush.sendNotification(sub, JSON.stringify(payload))
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, err: err && err.message ? err.message : String(err) }));
  });
  const results = await Promise.all(promises);
  console.log('Push results:', results);
}

// CLI: node sendPush.js "Title" "Body" 
(async () => {
  const title = process.argv[2] || 'Study Streak Reminder';
  const body = process.argv[3] || 'Keep your streak going today!';
  const payload = { title, body, icon: 'https://via.placeholder.com/192.png?text=Streak', url: '/' };
  try {
    await sendNotificationToAll(payload);
    console.log('Done sending push notifications.');
  } catch (e) {
    console.error('Error sending pushes', e);
  }
})();
