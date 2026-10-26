require('dotenv').config();
const express = require('express');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

for (const key of ['BOT_TOKEN', 'ADMIN_IDS']) {
  if (!process.env[key]) { console.error('Missing environment variable: ' + key); process.exit(1); }
}
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = new Set(process.env.ADMIN_IDS.split(',').map(s => s.trim()).filter(Boolean));
const hasDb = Boolean(process.env.DATABASE_URL);
const pool = hasDb ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined }) : null;
const app = express();
const currency = process.env.CURRENCY || '৳';
const miniAppUrl = process.env.MINI_APP_URL || 'https://pokemonbot-g5x1.onrender.com';
const money = n => currency + Number(n).toLocaleString('en-BD', { maximumFractionDigits: 2 });
const isAdmin = ctx => admins.has(String(ctx.from && ctx.from.id || ''));
const menu = Markup.inlineKeyboard([
  [Markup.button.webApp('✨ Open Golden Card Mini App', miniAppUrl)],
  [Markup.button.callback('🎴 Browse Cards', 'cards:0'), Markup.button.callback('💰 Wallet', 'wallet')],
  [Markup.button.callback('➕ Deposit', 'deposit'), Markup.button.callback('🗂 My Collection', 'collection')],
  [Markup.button.callback('ℹ️ Help', 'help')]
]);
const adminMenu = Markup.inlineKeyboard([
  [Markup.button.callback('⏳ Pending Deposits', 'admin:pending')],
  [Markup.button.callback('➕ Add Card', 'admin:addcard')],
  [Markup.button.callback('⚙️ Payment Settings', 'admin:settings')]
]);
async function initDb() {
  await pool.query('CREATE TABLE IF NOT EXISTS users (telegram_id BIGINT PRIMARY KEY, username TEXT, balance NUMERIC(12,2) NOT NULL DEFAULT 0)');
  await pool.query("CREATE TABLE IF NOT EXISTS cards (id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, price NUMERIC(12,2) NOT NULL CHECK(price >= 0), image_file_id TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, owner_id BIGINT)");
  await pool.query("CREATE TABLE IF NOT EXISTS deposits (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), amount NUMERIC(12,2) NOT NULL CHECK(amount > 0), method TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reviewed_by BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS transactions (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), type TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, details TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS user_states (telegram_id BIGINT PRIMARY KEY, state TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}'::jsonb)");
  await pool.query('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const item of [['bkash_number', process.env.BKASH_NUMBER || ''], ['nagad_number', process.env.NAGAD_NUMBER || '']]) {
    if (item[1]) await pool.query('INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', item);
  }
}
async function ensureUser(ctx) {
  await pool.query('INSERT INTO users(telegram_id,username) VALUES($1,$2) ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username', [String(ctx.from.id), ctx.from.username || null]);
}
async function setState(id, state, data) {
  await pool.query('INSERT INTO user_states(telegram_id,state,data) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET state=EXCLUDED.state,data=EXCLUDED.data', [String(id), state, JSON.stringify(data || {})]);
}
async function getState(id) {
  const r = await pool.query('SELECT state,data FROM user_states WHERE telegram_id=$1', [String(id)]);
  return r.rows[0] || null;
}
async function clearState(id) { await pool.query('DELETE FROM user_states WHERE telegram_id=$1', [String(id)]); }
async function setting(key) {
  const r = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : '';
}
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/health', async (_req, res) => {
  if (!hasDb) return res.json({ ok: true, mode: 'preview', database: 'not_configured' });
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'connected' }); }
  catch (_e) { res.status(503).json({ ok: false, database: 'unavailable' }); }
});

bot.use(async (ctx, next) => {
  if (hasDb) return next();
  const text = ctx.message && ctx.message.text;
  if (text && (text.startsWith('/start') || text.startsWith('/menu'))) return next();
  if (ctx.callbackQuery) { await ctx.answerCbQuery('এটি Preview Mode। Database connect করলে সব ফিচার চালু হবে।').catch(() => {}); return; }
  if (text) return ctx.reply('👀 Golden Card Market এখন Preview Mode-এ চলছে। Database connect না করা পর্যন্ত Card, Wallet, Deposit ও Admin data ফিচার বন্ধ থাকবে। পরে Database URL যোগ করে redeploy করুন।');
  return next();
});

bot.start(async ctx => {
  if (!hasDb) return ctx.reply('✨ Golden Card Market Preview\n\nPremium Black & Gold Mini App খুলতে নিচের বাটনে চাপ দিন।\n\nএটি এখন Demo UI—real wallet, payment ও purchase চালু করতে পরে PostgreSQL Database connect করতে হবে।', menu);
  await ensureUser(ctx);
  await ctx.reply('✨ Golden Card Market-এ স্বাগতম!\n\n🎴 কার্ড দেখুন, 💰 ওয়ালেট পরিচালনা করুন এবং ডিপোজিট জমা দিন।\n\nAdmin পেমেন্ট যাচাই করে Approve না করা পর্যন্ত ব্যালেন্স যোগ হবে না।', menu);
});
bot.command('menu', async ctx => { if (hasDb) await ensureUser(ctx); await ctx.reply(hasDb ? 'Main menu:' : '👀 Preview Mode — Database connect করলে menu-এর সব feature কাজ করবে।', menu); });
bot.command('app', async ctx => { await ctx.reply('✨ Golden Card Market Mini App', menu); });
bot.command('admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  await ctx.reply('🔐 Admin Panel', adminMenu);
});
bot.command('setbkash', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  const value = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
  if (!value) return ctx.reply('ব্যবহার: /setbkash 01XXXXXXXXX');
  await pool.query("INSERT INTO app_settings(key,value) VALUES('bkash_number',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [value]);
  await ctx.reply('bKash নম্বর সংরক্ষণ হয়েছে।');
});
bot.command('setnagad', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  const value = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
  if (!value) return ctx.reply('ব্যবহার: /setnagad 01XXXXXXXXX');
  await pool.query("INSERT INTO app_settings(key,value) VALUES('nagad_number',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [value]);
  await ctx.reply('Nagad নম্বর সংরক্ষণ হয়েছে।');
});
bot.command('addcard', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  await setState(ctx.from.id, 'card_title', {});
  await ctx.reply('কার্ডের নাম লিখুন।');
});
bot.action(/^cards:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const offset = Number(ctx.match[1]);
  const r = await pool.query('SELECT * FROM cards WHERE active=TRUE AND owner_id IS NULL ORDER BY id LIMIT 5 OFFSET $1', [offset]);
  if (!r.rows.length) return ctx.reply('এখনো কার্ড যোগ করা হয়নি। Admin /addcard দিয়ে যোগ করতে পারবেন।', menu);
  for (const c of r.rows) {
    const caption = '✨ ' + c.title + '\n🆔 Card #' + c.id + '\n💰 দাম: ' + money(c.price);
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('🛒 Buy ' + money(c.price), 'buy:' + c.id)]]);
    if (c.image_file_id) await ctx.replyWithPhoto(c.image_file_id, { caption: caption, ...keyboard });
    else await ctx.reply(caption, keyboard);
  }
  const nav = [];
  if (offset > 0) nav.push(Markup.button.callback('⬅️ আগের', 'cards:' + Math.max(0, offset - 5)));
  if (r.rows.length === 5) nav.push(Markup.button.callback('পরের ➡️', 'cards:' + (offset + 5)));
  if (nav.length) await ctx.reply('আরও কার্ড:', Markup.inlineKeyboard([nav]));
});
bot.action('wallet', async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT balance FROM users WHERE telegram_id=$1', [String(ctx.from.id)]);
  await ctx.reply('💰 Wallet Balance: ' + money(r.rows[0] ? r.rows[0].balance : 0), Markup.inlineKeyboard([[Markup.button.callback('➕ Deposit', 'deposit')], [Markup.button.callback('📜 Transactions', 'transactions')]]));
});
bot.action('deposit', async ctx => {
  await ctx.answerCbQuery();
  await setState(ctx.from.id, 'deposit_amount', {});
  const bkash = await setting('bkash_number');
  const nagad = await setting('nagad_number');
  await ctx.reply('➕ Deposit\n\nbKash: ' + (bkash || 'Admin এখনো নম্বর দেননি') + '\nNagad: ' + (nagad || 'Admin এখনো নম্বর দেননি') + '\n\nটাকা পাঠানোর পর কত টাকা ডিপোজিট করেছেন লিখুন। Transaction ID দেওয়ার পর Admin যাচাই করবেন।');
});
bot.action('collection', async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT id,title,price FROM cards WHERE owner_id=$1 ORDER BY id', [String(ctx.from.id)]);
  await ctx.reply(r.rows.length ? '🎴 আপনার Collection:\n' + r.rows.map(c => '#' + c.id + ' ' + c.title + ' — ' + money(c.price)).join('\n') : 'আপনার Collection খালি।', menu);
});
bot.action('transactions', async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT type,amount,details FROM transactions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 10', [String(ctx.from.id)]);
  await ctx.reply(r.rows.length ? '📜 লেনদেন:\n' + r.rows.map(t => t.type + ': ' + money(t.amount) + ' — ' + t.details).join('\n') : 'এখনো কোনো সম্পন্ন লেনদেন নেই।');
});
bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply('Browse Cards দিয়ে কার্ড দেখুন। Deposit দিয়ে টাকা জমার রিকোয়েস্ট পাঠান। এই MVP-তে resale ও withdrawal এখনো যোগ হয়নি।', menu);
});
bot.action(/^buy:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cr = await client.query('SELECT * FROM cards WHERE id=$1 AND active=TRUE AND owner_id IS NULL FOR UPDATE', [ctx.match[1]]);
    if (!cr.rows.length) { await client.query('ROLLBACK'); return ctx.reply('কার্ডটি আর বিক্রির জন্য নেই।'); }
    const card = cr.rows[0];
    const ur = await client.query('SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE', [String(ctx.from.id)]);
    if (!ur.rows.length || Number(ur.rows[0].balance) < Number(card.price)) {
      await client.query('ROLLBACK');
      return ctx.reply('পর্যাপ্ত ব্যালেন্স নেই। কার্ডের দাম ' + money(card.price), Markup.inlineKeyboard([[Markup.button.callback('➕ Deposit', 'deposit')]]));
    }
    await client.query('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2', [card.price, String(ctx.from.id)]);
    await client.query('UPDATE cards SET owner_id=$1 WHERE id=$2', [String(ctx.from.id), card.id]);
    await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'card_purchase',$2,$3)", [String(ctx.from.id), -Number(card.price), 'Card #' + card.id + ' কেনা হয়েছে']);
    await client.query('COMMIT');
    await ctx.reply('✅ কেনা সম্পন্ন! ' + card.title + ' আপনার Collection-এ যোগ হয়েছে।', menu);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('purchase error', e);
    await ctx.reply('কেনাকাটা ব্যর্থ হয়েছে। আবার চেষ্টা করুন।');
  } finally { client.release(); }
});
bot.action('admin:addcard', async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  await setState(ctx.from.id, 'card_title', {});
  await ctx.reply('কার্ডের নাম লিখুন।');
});
bot.action('admin:settings', async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  await ctx.reply('নম্বর সেট করুন:\n/setbkash 01XXXXXXXXX\n/setnagad 01XXXXXXXXX');
});
bot.action('admin:pending', async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  const r = await pool.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id LIMIT 20");
  if (!r.rows.length) return ctx.reply('Pending Deposit নেই।');
  for (const d of r.rows) {
    await ctx.reply('Deposit #' + d.id + '\nUser: ' + d.telegram_id + '\nAmount: ' + money(d.amount) + '\nMethod: ' + d.method + '\nTransaction ID: ' + d.transaction_id,
      Markup.inlineKeyboard([[Markup.button.callback('✅ Approve', 'approve:' + d.id), Markup.button.callback('❌ Reject', 'reject:' + d.id)]]));
  }
});
bot.action(/^approve:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE', [ctx.match[1]]);
    if (!r.rows.length || r.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return ctx.reply('রিকোয়েস্টটি আগে প্রসেস করা হয়েছে বা পাওয়া যায়নি।'); }
    const d = r.rows[0];
    await client.query("UPDATE deposits SET status='approved',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2", [String(ctx.from.id), d.id]);
    await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [d.amount, d.telegram_id]);
    await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'deposit',$2,$3)", [d.telegram_id, d.amount, 'Deposit #' + d.id + ' approved']);
    await client.query('COMMIT');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await ctx.reply('Deposit #' + d.id + ' approve হয়েছে। ' + money(d.amount) + ' যোগ হয়েছে।');
    await bot.telegram.sendMessage(String(d.telegram_id), '🎉 আপনার ' + money(d.amount) + ' ডিপোজিট approve হয়েছে।').catch(() => {});
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('approve error', e);
    await ctx.reply('Approve ব্যর্থ হয়েছে।');
  } finally { client.release(); }
});
bot.action(/^reject:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin access নেই।');
  const r = await pool.query("UPDATE deposits SET status='rejected',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2 AND status='pending' RETURNING *", [String(ctx.from.id), ctx.match[1]]);
  if (!r.rows.length) return ctx.reply('রিকোয়েস্টটি আগে প্রসেস করা হয়েছে বা পাওয়া যায়নি।');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply('Deposit #' + ctx.match[1] + ' reject হয়েছে।');
  await bot.telegram.sendMessage(String(r.rows[0].telegram_id), 'আপনার Deposit Request reject হয়েছে। পেমেন্টের তথ্য Admin-এর সঙ্গে যাচাই করুন।').catch(() => {});
});
bot.on('text', async ctx => {
  await ensureUser(ctx);
  const st = await getState(ctx.from.id);
  if (!st) return;
  const value = ctx.message.text.trim();
  if (st.state === 'deposit_amount') {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return ctx.reply('সঠিক টাকার পরিমাণ লিখুন, যেমন 500।');
    await setState(ctx.from.id, 'deposit_method', { amount });
    return ctx.reply('কোন মাধ্যমে টাকা পাঠিয়েছেন? bKash অথবা Nagad লিখুন।');
  }
  if (st.state === 'deposit_method') {
    const method = value.toLowerCase();
    if (method !== 'bkash' && method !== 'nagad') return ctx.reply('bKash অথবা Nagad লিখুন।');
    await setState(ctx.from.id, 'deposit_txid', { amount: st.data.amount, method: method });
    return ctx.reply('এবার Transaction ID লিখুন।');
  }
  if (st.state === 'deposit_txid') {
    const txid = value.replace(/\s+/g, '');
    if (txid.length < 6 || txid.length > 100) return ctx.reply('সঠিক Transaction ID লিখুন।');
    try {
      const r = await pool.query('INSERT INTO deposits(telegram_id,amount,method,transaction_id) VALUES($1,$2,$3,$4) RETURNING id', [String(ctx.from.id), st.data.amount, st.data.method, txid]);
      await clearState(ctx.from.id);
      await ctx.reply('✅ Deposit Request #' + r.rows[0].id + ' জমা হয়েছে। Admin যাচাই করে approve করলে টাকা যোগ হবে।', menu);
      for (const adminId of admins) {
        await bot.telegram.sendMessage(adminId, '⏳ Deposit #' + r.rows[0].id + '\nUser: ' + ctx.from.id + '\nAmount: ' + money(st.data.amount) + '\nMethod: ' + st.data.method + '\nTXID: ' + txid,
          Markup.inlineKeyboard([[Markup.button.callback('✅ Approve', 'approve:' + r.rows[0].id), Markup.button.callback('❌ Reject', 'reject:' + r.rows[0].id)]])).catch(e => console.error('admin notification error', e.message));
      }
    } catch (e) {
      if (e.code === '23505') return ctx.reply('এই Transaction ID আগে জমা দেওয়া হয়েছে।');
      console.error(e);
      await ctx.reply('রিকোয়েস্ট জমা হয়নি। পরে আবার চেষ্টা করুন।');
    }
    return;
  }
  if (st.state === 'card_title' && isAdmin(ctx)) {
    await setState(ctx.from.id, 'card_price', { title: value });
    return ctx.reply('কার্ডের দাম লিখুন, যেমন 450।');
  }
  if (st.state === 'card_price' && isAdmin(ctx)) {
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) return ctx.reply('সঠিক দাম লিখুন।');
    await setState(ctx.from.id, 'card_photo', { title: st.data.title, price: price });
    return ctx.reply('এবার কার্ডের ছবি Photo হিসেবে পাঠান।');
  }
});
bot.on('photo', async ctx => {
  const st = await getState(ctx.from.id);
  if (!st || st.state !== 'card_photo' || !isAdmin(ctx)) return;
  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id;
  const r = await pool.query('INSERT INTO cards(title,price,image_file_id) VALUES($1,$2,$3) RETURNING id', [st.data.title, st.data.price, fileId]);
  await clearState(ctx.from.id);
  await ctx.reply('✅ Card #' + r.rows[0].id + ' যোগ হয়েছে।', adminMenu);
});
bot.catch(err => console.error('Telegram bot error', err));
(async () => {
  if (hasDb) await initDb();
  else console.log('Starting in preview mode: DATABASE_URL is not set');
  app.listen(Number(process.env.PORT || 3000), () => console.log('Health server listening'));
  await bot.launch();
  console.log('Golden Card Market bot started');
})().catch(err => { console.error('Startup failed', err); process.exit(1); });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
