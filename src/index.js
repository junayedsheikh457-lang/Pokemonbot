require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
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
  [Markup.button.callback('💸 Sell Cards', 'sell')],
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
  await pool.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS listed_for_sale BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS listing_price NUMERIC(12,2)");
  await pool.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''");
  await pool.query("CREATE INDEX IF NOT EXISTS deposits_status_created_idx ON deposits(status, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS transactions_user_created_idx ON transactions(telegram_id, created_at DESC)");
  const existingCards = await pool.query('SELECT COUNT(*)::int AS count FROM cards');
  if (existingCards.rows[0].count === 0) {
    const seedCards = [
      ['Charizard',4500,'https://images.pokemontcg.io/base1/4.png','Fire-type collectible card'],
      ['Pikachu',2800,'https://images.pokemontcg.io/base1/58.png','Electric-type collectible card'],
      ['Mewtwo',5200,'https://images.pokemontcg.io/base1/10.png','Psychic-type collectible card'],
      ['Blastoise',3900,'https://images.pokemontcg.io/base1/2.png','Water-type collectible card'],
      ['Lugia',6300,'https://images.pokemontcg.io/neo1/9.png','Legendary guardian collectible card'],
      ['Gengar',3200,'https://images.pokemontcg.io/fossil/5.png','Ghost-type collectible card'],
      ['Dragonite',2700,'https://images.pokemontcg.io/fossil/4.png','Dragon-type collectible card'],
      ['Mew',4800,'https://images.pokemontcg.io/blackstar/8.png','Mythical collectible card'],
      ['Zapdos',2200,'https://images.pokemontcg.io/base1/16.png','Electric bird collectible card'],
      ['Venusaur',4100,'https://images.pokemontcg.io/base1/15.png','Grass-type collectible card'],
      ['Arcanine',1900,'https://images.pokemontcg.io/gym2/12.png','Fire-type collectible card'],
      ['Gyarados',2400,'https://images.pokemontcg.io/base1/6.png','Water-type collectible card'],
      ['Alakazam',2600,'https://images.pokemontcg.io/base1/1.png','Psychic-type collectible card'],
      ['Snorlax',2100,'https://images.pokemontcg.io/jungle/11.png','Normal-type collectible card'],
      ['Ninetales',1700,'https://images.pokemontcg.io/base1/12.png','Fire-type collectible card'],
      ['Machamp',1600,'https://images.pokemontcg.io/base1/8.png','Fighting-type collectible card'],
      ['Clefairy',1400,'https://images.pokemontcg.io/base1/5.png','Moonlit collectible card'],
      ['Jolteon',1800,'https://images.pokemontcg.io/jungle/4.png','Electric-type collectible card'],
      ['Vaporeon',1800,'https://images.pokemontcg.io/jungle/12.png','Water-type collectible card'],
      ['Flareon',1800,'https://images.pokemontcg.io/jungle/3.png','Fire-type collectible card'],
      ['Eevee',900,'https://images.pokemontcg.io/jungle/51.png','Evolution collectible card'],
      ['Butterfree',750,'https://images.pokemontcg.io/base1/33.png','Grass-type collectible card'],
      ['Onix',800,'https://images.pokemontcg.io/base1/56.png','Rock-type collectible card'],
      ['Poliwhirl',850,'https://images.pokemontcg.io/base1/33.png','Water-type collectible card']
    ];
    for (const c of seedCards) await pool.query('INSERT INTO cards(title,price,image_file_id,description) VALUES($1,$2,$3,$4)', c);
  }
  for (const item of [["usdt_trc20",""],["usdt_erc20",""],["usdt_bep20",""],["usdt_polygon",""],["usdt_arbitrum",""],["usdt_optimism",""],["usdt_solana",""],["usdt_ton",""],["usdt_avalanche",""],["usdt_base",""]]) {
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
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Telegram Mini App API — all account actions require validated Telegram initData.
function verifyTelegramInitData(initData) {
  if (!initData || !process.env.BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const authDate = Number(params.get('auth_date'));
    if (!hash || !authDate || Math.abs(Date.now()/1000 - authDate) > 86400) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => k + '=' + v).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    const a = Buffer.from(calculated, 'hex'), b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) return null;
    return { id: String(user.id), username: user.username || null, first_name: user.first_name || '' };
  } catch (_) { return null; }
}
async function apiAuth(req,res,next) {
  if (!hasDb) return res.status(503).json({error:'Database is not connected.'});
  const initData = req.get('x-telegram-init-data') || '';
  const user = verifyTelegramInitData(initData);
  if (!user) return res.status(401).json({error:'Open this app from the Telegram bot to sign in.'});
  req.tgUser = user;
  try {
    await pool.query('INSERT INTO users(telegram_id,username) VALUES($1,$2) ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username',[user.id,user.username]);
    next();
  } catch(e) { console.error('API auth DB error',e.message); res.status(500).json({error:'Could not load your account.'}); }
}
function apiAdmin(req,res,next) {
  if (!admins.has(String(req.tgUser.id))) return res.status(403).json({error:'Admin access only.'});
  next();
}
const publicCard = c => ({id:Number(c.id),title:c.title,price:Number(c.listing_price ?? c.price),originalPrice:Number(c.price),image:c.image_file_id || null,description:c.description || '',active:c.active,ownerId:c.owner_id ? String(c.owner_id) : null,listedForSale:Boolean(c.listed_for_sale)});
app.get('/api/config', async (_req,res) => {
  if (!hasDb) return res.json({mode:'preview',database:false,payments:{networks:{}}});
  try { const entries=await Promise.all(["trc20","erc20","bep20","polygon","arbitrum","optimism","solana","ton","avalanche","base"].map(async k=>[k,await setting('usdt_'+k)])); res.json({mode:'live',database:true,payments:{networks:Object.fromEntries(entries)}}); }
  catch(e) { res.status(500).json({error:'Unable to load settings.'}); }
});
app.get('/api/me',apiAuth,async(req,res)=>{
  const [u,t]=await Promise.all([
    pool.query('SELECT telegram_id,username,balance FROM users WHERE telegram_id=$1',[req.tgUser.id]),
    pool.query('SELECT type,amount,details,created_at FROM transactions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 20',[req.tgUser.id])
  ]);
  res.json({user:{id:req.tgUser.id,username:req.tgUser.username,admin:admins.has(req.tgUser.id),balance:Number(u.rows[0]?.balance||0)},transactions:t.rows.map(x=>({...x,amount:Number(x.amount)}))});
});
app.get('/api/cards',apiAuth,async(req,res)=>{
  const r=await pool.query('SELECT * FROM cards WHERE active=TRUE AND (owner_id IS NULL OR listed_for_sale=TRUE) ORDER BY id DESC');
  res.json({cards:r.rows.map(publicCard)});
});
app.get('/api/collection',apiAuth,async(req,res)=>{
  const r=await pool.query('SELECT * FROM cards WHERE owner_id=$1 ORDER BY id DESC',[req.tgUser.id]);
  res.json({cards:r.rows.map(publicCard)});
});
app.post('/api/deposits',apiAuth,async(req,res)=>{
  const amount=Number(req.body.amount), method=String(req.body.method||'').toLowerCase(), txid=String(req.body.transactionId||'').trim();
  if(!Number.isFinite(amount)||amount<10||amount>1000000) return res.status(400).json({error:'Deposit amount must be between 1 and 1,000,000 USDT.'});
  const supportedNetworks=["trc20","erc20","bep20","polygon","arbitrum","optimism","solana","ton","avalanche","base"];
  if(!supportedNetworks.includes(method)) return res.status(400).json({error:'Choose a supported USDT network.'});
  if(!(await setting('usdt_'+method))) return res.status(400).json({error:'Admin has not configured a wallet for this network yet.'});
  if(txid.length<20||txid.length>150) return res.status(400).json({error:'Enter the blockchain transaction hash.'});
  try {
    const r=await pool.query('INSERT INTO deposits(telegram_id,amount,method,transaction_id) VALUES($1,$2,$3,$4) RETURNING id,amount,method,transaction_id,status,created_at',[req.tgUser.id,amount,method,txid]);
    for(const adminId of admins) bot.telegram.sendMessage(adminId,'⏳ New Deposit #'+r.rows[0].id+'\nUser: '+req.tgUser.id+'\nAmount: '+money(amount)+'\nMethod: '+method+'\nTXID: '+txid,Markup.inlineKeyboard([[Markup.button.callback('✅ Approve','approve:'+r.rows[0].id),Markup.button.callback('❌ Reject','reject:'+r.rows[0].id)]])).catch(()=>{});
    res.status(201).json({deposit:r.rows[0]});
  } catch(e) { if(e.code==='23505') return res.status(409).json({error:'This transaction ID has already been submitted.'}); console.error(e); res.status(500).json({error:'Deposit request could not be saved.'}); }
});
app.post('/api/buy/:id',apiAuth,async(req,res)=>{
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const cr=await client.query('SELECT * FROM cards WHERE id=$1 AND active=TRUE AND (owner_id IS NULL OR listed_for_sale=TRUE) FOR UPDATE',[req.params.id]);
    if(!cr.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({error:'This card is no longer available.'}); }
    const card=cr.rows[0], price=Number(card.listed_for_sale?card.listing_price:card.price);
    if(card.owner_id && String(card.owner_id)===req.tgUser.id) { await client.query('ROLLBACK'); return res.status(400).json({error:'You already own this card.'}); }
    const ur=await client.query('SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE',[req.tgUser.id]);
    if(Number(ur.rows[0]?.balance||0)<price) { await client.query('ROLLBACK'); return res.status(400).json({error:'Insufficient wallet balance. Please deposit first.'}); }
    await client.query('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2',[price,req.tgUser.id]);
    if(card.owner_id) {
      await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',[price,card.owner_id]);
      await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'sale',$2,$3)",[card.owner_id,price,'Card sold: '+card.title+' (#'+card.id+')']);
    }
    await client.query('UPDATE cards SET owner_id=$1,listed_for_sale=FALSE,listing_price=NULL WHERE id=$2',[req.tgUser.id,card.id]);
    await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'card_purchase',$2,$3)",[req.tgUser.id,-price,'Purchased '+card.title+' (#'+card.id+')']);
    await client.query('COMMIT');
    res.json({ok:true,message:'Purchase complete.',card:publicCard({...card,owner_id:req.tgUser.id,listed_for_sale:false,listing_price:null}),balance:Number(ur.rows[0].balance)-price});
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error('API buy failed',e); res.status(500).json({error:'Purchase failed. Please try again.'}); }
  finally { client.release(); }
});
app.post('/api/sell/:id',apiAuth,async(req,res)=>{
  const price=Number(req.body.price);
  if(!Number.isFinite(price)||price<=0||price>10000000) return res.status(400).json({error:'Enter a valid selling price.'});
  const r=await pool.query('UPDATE cards SET listed_for_sale=TRUE,listing_price=$1 WHERE id=$2 AND owner_id=$3 AND active=TRUE RETURNING *',[price,req.params.id,req.tgUser.id]);
  if(!r.rows.length) return res.status(404).json({error:'Owned card not found.'});
  res.json({ok:true,card:publicCard(r.rows[0])});
});
app.post('/api/sell/:id/cancel',apiAuth,async(req,res)=>{
  const r=await pool.query('UPDATE cards SET listed_for_sale=FALSE,listing_price=NULL WHERE id=$1 AND owner_id=$2 RETURNING id',[req.params.id,req.tgUser.id]);
  if(!r.rows.length) return res.status(404).json({error:'Listing not found.'});
  res.json({ok:true});
});
app.get('/api/admin/summary',apiAuth,apiAdmin,async(_req,res)=>{
  const [u,c,d,s]=await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM users'),
    pool.query('SELECT COUNT(*)::int AS count FROM cards WHERE active=TRUE'),
    pool.query("SELECT status,COUNT(*)::int AS count,COALESCE(SUM(amount),0)::numeric AS total FROM deposits GROUP BY status"),
    pool.query("SELECT COALESCE(SUM(balance),0)::numeric AS total FROM users")
  ]);
  res.json({users:u.rows[0].count,cards:c.rows[0].count,walletLiability:Number(s.rows[0].total),deposits:d.rows.map(x=>({...x,total:Number(x.total)}))});
});
app.get('/api/admin/deposits',apiAuth,apiAdmin,async(req,res)=>{
  const status=['pending','approved','rejected'].includes(req.query.status)?req.query.status:'pending';
  const r=await pool.query('SELECT d.*,u.username FROM deposits d LEFT JOIN users u ON u.telegram_id=d.telegram_id WHERE d.status=$1 ORDER BY d.created_at DESC LIMIT 100',[status]);
  res.json({deposits:r.rows.map(d=>({...d,amount:Number(d.amount),telegram_id:String(d.telegram_id)}))});
});
app.post('/api/admin/deposits/:id/:action',apiAuth,apiAdmin,async(req,res)=>{
  const action=req.params.action;
  if(!['approve','reject'].includes(action)) return res.status(400).json({error:'Invalid action.'});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const r=await client.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!r.rows.length||r.rows[0].status!=='pending') { await client.query('ROLLBACK'); return res.status(409).json({error:'Deposit already processed or not found.'}); }
    const d=r.rows[0],status=action==='approve'?'approved':'rejected';
    await client.query('UPDATE deposits SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3',[status,req.tgUser.id,d.id]);
    if(action==='approve') {
      await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',[d.amount,d.telegram_id]);
      await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'deposit',$2,$3)",[d.telegram_id,d.amount,'Deposit #'+d.id+' approved']);
    }
    await client.query('COMMIT');
    bot.telegram.sendMessage(String(d.telegram_id),action==='approve'?'🎉 আপনার '+money(d.amount)+' deposit approve হয়েছে। Wallet update করা হয়েছে।':'আপনার Deposit #'+d.id+' reject হয়েছে। পেমেন্টের তথ্য Admin-এর সঙ্গে যাচাই করুন।').catch(()=>{});
    res.json({ok:true,status});
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error(e); res.status(500).json({error:'Could not process deposit.'}); }
  finally { client.release(); }
});
app.get('/api/admin/cards',apiAuth,apiAdmin,async(_req,res)=>{
  const r=await pool.query('SELECT * FROM cards ORDER BY id DESC LIMIT 200');
  res.json({cards:r.rows.map(publicCard)});
});
app.post('/api/admin/cards',apiAuth,apiAdmin,async(req,res)=>{
  const title=String(req.body.title||'').trim(),price=Number(req.body.price),image=String(req.body.image||'').trim(),description=String(req.body.description||'').trim();
  if(!title||title.length>120||!Number.isFinite(price)||price<0||price>10000000) return res.status(400).json({error:'Enter a card name and valid price.'});
  if(image.length>2000||description.length>1000) return res.status(400).json({error:'Image URL or description is too long.'});
  const r=await pool.query('INSERT INTO cards(title,price,description,image_file_id) VALUES($1,$2,$3,$4) RETURNING *',[title,price,description,image||null]);
  res.status(201).json({card:publicCard(r.rows[0])});
});
app.patch('/api/admin/cards/:id',apiAuth,apiAdmin,async(req,res)=>{
  const price=req.body.price===undefined?null:Number(req.body.price),active=req.body.active;
  if(price!==null&&(!Number.isFinite(price)||price<0)) return res.status(400).json({error:'Invalid price.'});
  const r=await pool.query('UPDATE cards SET price=COALESCE($1,price),active=COALESCE($2,active) WHERE id=$3 RETURNING *',[price,typeof active==='boolean'?active:null,req.params.id]);
  if(!r.rows.length) return res.status(404).json({error:'Card not found.'});
  res.json({card:publicCard(r.rows[0])});
});
app.get('/api/admin/users',apiAuth,apiAdmin,async(_req,res)=>{
  const r=await pool.query('SELECT u.telegram_id,u.username,u.balance,COUNT(c.id)::int AS owned FROM users u LEFT JOIN cards c ON c.owner_id=u.telegram_id GROUP BY u.telegram_id ORDER BY u.telegram_id DESC LIMIT 200');
  res.json({users:r.rows.map(u=>({...u,telegram_id:String(u.telegram_id),balance:Number(u.balance)}))});
});
app.get('/api/admin/settings',apiAuth,apiAdmin,async(_req,res)=>{
  const entries=await Promise.all(["trc20","erc20","bep20","polygon","arbitrum","optimism","solana","ton","avalanche","base"].map(async k=>[k,await setting('usdt_'+k)])); res.json({networks:Object.fromEntries(entries)});
});
app.put('/api/admin/settings',apiAuth,apiAdmin,async(req,res)=>{
  const allowed=["trc20","erc20","bep20","polygon","arbitrum","optimism","solana","ton","avalanche","base"];
  if(!req.body.networks||typeof req.body.networks!=='object') return res.status(400).json({error:'USDT wallet addresses are required.'});
  for(const key of allowed) { const value=String(req.body.networks[key]||'').trim(); if(value.length>180) return res.status(400).json({error:'Wallet address is too long for '+key+'.'}); await pool.query('INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',['usdt_'+key,value]); }
  res.json({ok:true});
});

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
  const r = await pool.query('SELECT * FROM cards WHERE active=TRUE AND (owner_id IS NULL OR listed_for_sale=TRUE) ORDER BY id LIMIT 5 OFFSET $1', [offset]);
  if (!r.rows.length) return ctx.reply('এখনো কার্ড যোগ করা হয়নি। Admin /addcard দিয়ে যোগ করতে পারবেন।', menu);
  for (const c of r.rows) {
    const caption = '✨ ' + c.title + '\n🆔 Card #' + c.id + '\n💰 দাম: ' + money(c.listed_for_sale ? c.listing_price : c.price) + (c.listed_for_sale ? '\n♻️ Player resale' : '');
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
bot.action('sell', async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT id,title,price,listing_price,listed_for_sale FROM cards WHERE owner_id=$1 ORDER BY id', [String(ctx.from.id)]);
  if (!r.rows.length) return ctx.reply('আপনার Collection খালি। আগে Marketplace থেকে কার্ড কিনুন।', menu);
  for (const c of r.rows) await ctx.reply('💸 ' + c.title + ' (#' + c.id + ')' + (c.listed_for_sale ? '\nListed at ' + money(c.listing_price) : '\nOriginal price: ' + money(c.price)),
    Markup.inlineKeyboard([[Markup.button.callback(c.listed_for_sale ? 'Cancel Listing' : 'Sell this card', 'sellcard:' + c.id)]]));
});
bot.action(/^sellcard:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT id,title,listed_for_sale FROM cards WHERE id=$1 AND owner_id=$2', [ctx.match[1], String(ctx.from.id)]);
  if (!r.rows.length) return ctx.reply('এই কার্ডটি আপনার Collection-এ নেই।');
  if (r.rows[0].listed_for_sale) {
    await pool.query('UPDATE cards SET listed_for_sale=FALSE,listing_price=NULL WHERE id=$1 AND owner_id=$2', [ctx.match[1], String(ctx.from.id)]);
    return ctx.reply('✅ ' + r.rows[0].title + ' এর sale listing বাতিল হয়েছে।', menu);
  }
  await setState(ctx.from.id, 'sell_price', { cardId: Number(ctx.match[1]), title: r.rows[0].title });
  await ctx.reply('💸 ' + r.rows[0].title + ' কোন দামে বিক্রি করবেন? শুধু টাকার পরিমাণ লিখুন।');
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
    const cr = await client.query('SELECT * FROM cards WHERE id=$1 AND active=TRUE AND (owner_id IS NULL OR listed_for_sale=TRUE) FOR UPDATE', [ctx.match[1]]);
    if (!cr.rows.length) { await client.query('ROLLBACK'); return ctx.reply('কার্ডটি আর বিক্রির জন্য নেই।'); }
    const card = cr.rows[0];
    const salePrice = Number(card.listed_for_sale ? card.listing_price : card.price);
    if (card.owner_id && String(card.owner_id) === String(ctx.from.id)) { await client.query('ROLLBACK'); return ctx.reply('এই কার্ডটি ইতিমধ্যে আপনার।'); }
    const ur = await client.query('SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE', [String(ctx.from.id)]);
    if (!ur.rows.length || Number(ur.rows[0].balance) < salePrice) {
      await client.query('ROLLBACK');
      return ctx.reply('পর্যাপ্ত ব্যালেন্স নেই। কার্ডের দাম ' + money(salePrice), Markup.inlineKeyboard([[Markup.button.callback('➕ Deposit', 'deposit')]]));
    }
    await client.query('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2', [salePrice, String(ctx.from.id)]);
    if (card.owner_id) { await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [salePrice, card.owner_id]); await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'sale',$2,$3)", [card.owner_id, salePrice, 'Card sold: ' + card.title]); }
    await client.query('UPDATE cards SET owner_id=$1,listed_for_sale=FALSE,listing_price=NULL WHERE id=$2', [String(ctx.from.id), card.id]);
    await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'card_purchase',$2,$3)", [String(ctx.from.id), -salePrice, 'Card #' + card.id + ' কেনা হয়েছে']);
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
  if (st.state === 'sell_price') {
    const price = Number(value);
    if (!Number.isFinite(price) || price <= 0 || price > 10000000) return ctx.reply('সঠিক বিক্রয়মূল্য লিখুন।');
    const r = await pool.query('UPDATE cards SET listed_for_sale=TRUE,listing_price=$1 WHERE id=$2 AND owner_id=$3 RETURNING title', [price, st.data.cardId, String(ctx.from.id)]);
    if (!r.rows.length) { await clearState(ctx.from.id); return ctx.reply('কার্ডটি আর আপনার Collection-এ নেই।'); }
    await clearState(ctx.from.id);
    return ctx.reply('✅ ' + r.rows[0].title + ' ' + money(price) + ' দামে Marketplace-এ তালিকাভুক্ত হয়েছে।', menu);
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
