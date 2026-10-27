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
const currency = '$';
const miniAppUrl = process.env.MINI_APP_URL || 'https://pokemonbot-g5x1.onrender.com';
let botUsername = process.env.BOT_USERNAME || '';
const money = n => currency + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const isAdmin = ctx => admins.has(String(ctx.from && ctx.from.id || ''));
const menu = Markup.inlineKeyboard([
  [Markup.button.webApp('✨ Open Golden Card Mini App', miniAppUrl)],
  [Markup.button.callback('🎴 Browse Cards', 'cards:0'), Markup.button.callback('💰 Wallet', 'wallet')],
  [Markup.button.callback('➕ Deposit', 'deposit'), Markup.button.callback('🗂 My Collection', 'collection')],
  [Markup.button.callback('💸 Sell Cards', 'sell')],
  [Markup.button.callback('👥 Refer & Earn', 'referral'), Markup.button.callback('🪪 KYC Verify', 'kyc:start')],
  [Markup.button.callback('ℹ️ Help', 'help')]
]);
const adminMenu = Markup.inlineKeyboard([
  [Markup.button.callback('⏳ Pending Deposits', 'admin:pending')],
  [Markup.button.callback('➕ Add Card', 'admin:addcard')],
  [Markup.button.callback('⚙️ Payment Settings', 'admin:settings')],
  [Markup.button.callback('🪪 KYC Reviews', 'admin:kyc')]
]);
async function initDb() {
  await pool.query('CREATE TABLE IF NOT EXISTS users (telegram_id BIGINT PRIMARY KEY, username TEXT, balance NUMERIC(12,2) NOT NULL DEFAULT 0)');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS first_fast_buy_done BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query("CREATE TABLE IF NOT EXISTS cards (id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, price NUMERIC(12,2) NOT NULL CHECK(price >= 0), image_file_id TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, owner_id BIGINT)");
  await pool.query("CREATE TABLE IF NOT EXISTS deposits (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), amount NUMERIC(12,2) NOT NULL CHECK(amount > 0), method TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reviewed_by BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query('ALTER TABLE deposits ADD COLUMN IF NOT EXISTS review_due_at TIMESTAMPTZ');
  await pool.query("CREATE TABLE IF NOT EXISTS referral_commissions (id BIGSERIAL PRIMARY KEY, referrer_id BIGINT NOT NULL REFERENCES users(telegram_id), referred_user_id BIGINT NOT NULL UNIQUE REFERENCES users(telegram_id), card_id BIGINT NOT NULL, purchase_amount NUMERIC(12,2) NOT NULL, commission_amount NUMERIC(12,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS withdrawals (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), amount NUMERIC(12,2) NOT NULL CHECK(amount > 0), method TEXT NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reviewed_by BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS kyc_submissions (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), front_file_id TEXT NOT NULL, back_file_id TEXT NOT NULL, selfie_file_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reviewed_by BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
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
  await pool.query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Other'");
  await pool.query("UPDATE cards SET category = CASE WHEN description ILIKE '%fire%' THEN 'Fire' WHEN description ILIKE '%water%' THEN 'Water' WHEN description ILIKE '%electric%' THEN 'Electric' WHEN description ILIKE '%psychic%' THEN 'Psychic' WHEN description ILIKE '%grass%' THEN 'Grass' WHEN description ILIKE '%dragon%' THEN 'Dragon' WHEN description ILIKE '%ghost%' THEN 'Ghost' WHEN description ILIKE '%fighting%' THEN 'Fighting' WHEN description ILIKE '%ice%' THEN 'Ice' WHEN description ILIKE '%dark%' THEN 'Dark' WHEN description ILIKE '%steel%' OR description ILIKE '%metal%' THEN 'Metal' WHEN description ILIKE '%bug%' THEN 'Bug' WHEN description ILIKE '%poison%' THEN 'Poison' WHEN description ILIKE '%ground%' THEN 'Ground' WHEN description ILIKE '%rock%' THEN 'Rock' WHEN description ILIKE '%fairy%' THEN 'Fairy' WHEN description ILIKE '%normal%' THEN 'Normal' ELSE category END WHERE category='Other'");
  // Add a curated catalogue of 120 distinct Pokémon from the public card database.
  // The price is an illustrative marketplace estimate, not a live market quote.
  try {
    const catalog = [];
    for (let page = 1; page <= 5; page++) {
      const response = await fetch('https://pokemontcg.jacobcorbett.com/api/v1/cards?language=en&limit=100&page=' + page + '', { signal: AbortSignal.timeout(7000) });
      if (!response.ok) break;
      const payload = await response.json();
      const rows = Array.isArray(payload.data) ? payload.data : [];
      if (!rows.length) break;
      catalog.push(...rows);
      if (rows.length < 100) break;
    }
    const seen = new Set();
    const additions = [];
    for (const card of catalog) {
      const title = String(card.name || '').trim();
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const category = (Array.isArray(card.types) && card.types[0]) || card.element || card.type || 'Other';
      const image = card.originalImageUrl || card.imageUrl || card.image || null;
      const setName = card.set?.name || card.setName || 'Pokémon TCG';
      const number = card.number ? ' #' + card.number : '';
      const rarity = card.rarity ? ' Rarity: ' + card.rarity + '.' : '';
      const hash = [...key].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 1000003, 7);
      const price = 20 + (hash % 781);
      additions.push({title,category:String(category).replace(/-type$/i,''),price,image,description:title + ' Pokémon Trading Card Game collectible from ' + setName + number + '.' + rarity});
      if (additions.length >= 150) break;
    }
    for (const card of additions) {
      await pool.query("INSERT INTO cards(title,price,image_file_id,description,category) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM cards WHERE LOWER(title)=LOWER($1) AND owner_id IS NULL)",[card.title,card.price,card.image,card.description,card.category]);
    }
    await pool.query("UPDATE cards SET price = 20 + (id * 37 % 781) WHERE owner_id IS NULL AND listed_for_sale=FALSE");
    console.log('Pokémon catalogue import checked:', additions.length, 'unique names.');
  } catch (e) {
    console.warn('Pokémon catalogue import skipped; existing catalogue remains available:', e.message);
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
app.use(express.json({ limit: '18mb' }));
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
const publicCard = c => ({id:Number(c.id),title:c.title,price:Number(c.listing_price ?? c.price),originalPrice:Number(c.price),image:c.image_file_id || null,description:c.description || '',category:c.category || 'Other',type:c.category || 'Other',active:c.active,ownerId:c.owner_id ? String(c.owner_id) : null,listedForSale:Boolean(c.listed_for_sale)});
app.post('/api/kyc',apiAuth,async(req,res)=>{
 try{
  const images=[req.body.front,req.body.back,req.body.selfie];
  const labels=['ID FRONT','ID BACK','SELFIE HOLDING ID'];
  const valid=x=>typeof x==='string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x);
  if(images.some(x=>!valid(x)))return res.status(400).json({error:'Choose all 3 JPG, PNG or WEBP photos.'});
  if(images.some(x=>Buffer.byteLength(x.split(',')[1],'base64')>5*1024*1024))return res.status(400).json({error:'Each photo must be 5 MB or smaller.'});
  const existing=await pool.query("SELECT id,status FROM kyc_submissions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 1",[req.tgUser.id]);
  if(existing.rows.length)return res.status(409).json({error:existing.rows[0].status==='pending'?'Your KYC is already pending admin review.':existing.rows[0].status==='approved'?'Your KYC is already approved. You cannot upload it again.':'Your KYC has already been submitted and reviewed. Contact support if you need help.'});
  const firstAdmin=[...admins][0];
  if(!firstAdmin)return res.status(503).json({error:'KYC review is not configured. Contact support.'});
  const ids=[];
  for(let i=0;i<images.length;i++){
   const m=images[i].match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
   const ext=m[1].split('/')[1]==='jpeg'?'jpg':m[1].split('/')[1];
   const sent=await bot.telegram.sendPhoto(firstAdmin,{source:Buffer.from(m[2],'base64'),filename:'kyc-'+labels[i].toLowerCase().replace(/ /g,'-')+'.'+ext},{caption:'KYC upload · '+labels[i]+' · Telegram user '+req.tgUser.id});
   ids.push(sent.photo[sent.photo.length-1].file_id);
  }
  const saved=await pool.query("INSERT INTO kyc_submissions(telegram_id,front_file_id,back_file_id,selfie_file_id) VALUES($1,$2,$3,$4) RETURNING id",[req.tgUser.id,...ids]);
  for(const adminId of admins){
   if(String(adminId)!==String(firstAdmin))for(let i=0;i<ids.length;i++)await bot.telegram.sendPhoto(adminId,ids[i],{caption:'KYC #'+saved.rows[0].id+' · '+labels[i]+' · User '+req.tgUser.id}).catch(()=>{});
   await bot.telegram.sendMessage(adminId,'🪪 New Mini App KYC #'+saved.rows[0].id+' · User '+req.tgUser.id,Markup.inlineKeyboard([[Markup.button.callback('✅ Approve','kyc:approve:'+saved.rows[0].id),Markup.button.callback('❌ Reject','kyc:reject:'+saved.rows[0].id)]])).catch(()=>{});
  }
  res.status(201).json({ok:true,id:saved.rows[0].id});
 }catch(e){console.error('Mini App KYC upload failed',e.message);res.status(500).json({error:'KYC upload failed. Check your connection and try again.'});}
});
app.get('/api/referrals',apiAuth,async(req,res)=>{
  const [u,c]=await Promise.all([pool.query('SELECT COUNT(*)::int AS count FROM users WHERE referred_by=$1',[req.tgUser.id]),pool.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(commission_amount),0)::numeric AS total FROM referral_commissions WHERE referrer_id=$1',[req.tgUser.id])]);
  const pending=await pool.query("SELECT COALESCE(SUM(amount),0)::numeric AS total FROM withdrawals WHERE telegram_id=$1 AND status='pending'",[req.tgUser.id]);
  const balance=await pool.query('SELECT balance FROM users WHERE telegram_id=$1',[req.tgUser.id]);
  res.json({referralLink:botUsername?'https://t.me/'+botUsername+'?start=ref_'+req.tgUser.id:'',invited:u.rows[0].count,commissionCount:c.rows[0].count,earned:Number(c.rows[0].total),balance:Number(balance.rows[0]?.balance||0),pendingWithdrawals:Number(pending.rows[0].total)});
});
app.post('/api/withdrawals',apiAuth,async(req,res)=>{
  const amount=Number(req.body.amount),method=String(req.body.method||'').trim().slice(0,40),destination=String(req.body.destination||'').trim();
  if(!Number.isFinite(amount)||amount<5||amount>1000000)return res.status(400).json({error:'Withdrawal amount must be at least $5.'});
  if(!method||!destination||destination.length>180)return res.status(400).json({error:'Enter a withdrawal method and valid destination address.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const u=await client.query('SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE',[req.tgUser.id]);
    if(!u.rows.length||Number(u.rows[0].balance)<amount){await client.query('ROLLBACK');return res.status(400).json({error:'Insufficient wallet balance.'});}
    await client.query('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2',[amount,req.tgUser.id]);
    const w=await client.query("INSERT INTO withdrawals(telegram_id,amount,method,destination) VALUES($1,$2,$3,$4) RETURNING id",[req.tgUser.id,amount,method,destination]);
    await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'withdrawal_pending',$2,$3)",[req.tgUser.id,-amount,'Withdrawal request #'+w.rows[0].id+' pending admin review']);
    await client.query('COMMIT');
    for(const adminId of admins)bot.telegram.sendMessage(adminId,'💸 Withdrawal request #'+w.rows[0].id+'\nUser: '+req.tgUser.id+'\nAmount: '+money(amount)+'\nMethod: '+method+'\nDestination: '+destination,Markup.inlineKeyboard([[Markup.button.callback('✅ Approve withdrawal','withdraw:approve:'+w.rows[0].id),Markup.button.callback('❌ Reject & refund','withdraw:reject:'+w.rows[0].id)]])).catch(()=>{});
    res.status(201).json({ok:true,id:w.rows[0].id});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Withdrawal request failed',e.message);res.status(500).json({error:'Could not submit withdrawal request.'});}
  finally{client.release();}
});
app.get('/api/config', async (_req,res) => {
  if (!hasDb) return res.json({mode:'preview',database:false,payments:{networks:{}}});
  try { const entries=await Promise.all(["trc20","erc20","bep20","polygon","arbitrum","optimism","solana","ton","avalanche","base"].map(async k=>[k,await setting('usdt_'+k)])); res.json({mode:'live',database:true,botUsername,payments:{networks:Object.fromEntries(entries)}}); }
  catch(e) { res.status(500).json({error:'Unable to load settings.'}); }
});
app.get('/api/me',apiAuth,async(req,res)=>{
  const [u,t,k] = await Promise.all([
    pool.query('SELECT telegram_id,username,balance FROM users WHERE telegram_id=$1',[req.tgUser.id]),
    pool.query('SELECT type,amount,details,created_at FROM transactions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 20',[req.tgUser.id]),
    pool.query("SELECT status FROM kyc_submissions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 1",[req.tgUser.id])
  ]);
  res.json({user:{id:req.tgUser.id,first_name:req.tgUser.first_name||'',username:req.tgUser.username,admin:admins.has(req.tgUser.id),balance:Number(u.rows[0]?.balance||0),kycStatus:k.rows[0]?.status||'not_submitted'},transactions:t.rows.map(x=>({...x,amount:Number(x.amount)}))});
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
  const kyc=await pool.query("SELECT status FROM kyc_submissions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 1",[req.tgUser.id]);
  if(kyc.rows[0]?.status!=='approved')return res.status(403).json({error:'KYC approval is required before you can deposit. Submit your KYC and wait for admin approval.'});
  const amount=Number(req.body.amount), method=String(req.body.method||'').toLowerCase(), txid=String(req.body.transactionId||'').trim();
  if(!Number.isFinite(amount)||amount<1||amount>1000000) return res.status(400).json({error:'Deposit amount must be between 1 and 1,000,000 USDT.'});
  const supportedNetworks=["trc20","erc20","bep20","polygon","arbitrum","optimism","solana","ton","avalanche","base"];
  if(!supportedNetworks.includes(method)) return res.status(400).json({error:'Choose a supported USDT network.'});
  if(!(await setting('usdt_'+method))) return res.status(400).json({error:'Admin has not configured a wallet for this network yet.'});
  if(txid.length<20||txid.length>150) return res.status(400).json({error:'Enter the blockchain transaction hash.'});
  try {
    const r=await pool.query("INSERT INTO deposits(telegram_id,amount,method,transaction_id,review_due_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes') RETURNING id,amount,method,transaction_id,status,created_at,review_due_at",[req.tgUser.id,amount,method,txid]);
    for(const adminId of admins) bot.telegram.sendMessage(adminId,'⏳ New Deposit #'+r.rows[0].id+'\nUser: '+req.tgUser.id+'\nAmount: '+money(amount)+'\nMethod: '+method+'\nTXID: '+txid+'\nAdmin review target: 10 minutes',Markup.inlineKeyboard([[Markup.button.callback('✅ Approve','approve:'+r.rows[0].id),Markup.button.callback('❌ Reject','reject:'+r.rows[0].id)]])).catch(()=>{});
    res.status(201).json({deposit:r.rows[0]});
  } catch(e) { if(e.code==='23505') return res.status(409).json({error:'This transaction ID has already been submitted.'}); console.error(e); res.status(500).json({error:'Deposit request could not be saved.'}); }
});
async function processCardPurchase(req,res,fastBuy){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const cr=await client.query('SELECT * FROM cards WHERE id=$1 AND active=TRUE AND (owner_id IS NULL OR listed_for_sale=TRUE) FOR UPDATE',[req.params.id]);
    if(!cr.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'This card is no longer available.'});}
    const card=cr.rows[0],price=Number(card.listed_for_sale?card.listing_price:card.price),fee=Number((price*0.005).toFixed(2)),total=Number((price+fee).toFixed(2));
    if(card.owner_id&&String(card.owner_id)===req.tgUser.id){await client.query('ROLLBACK');return res.status(400).json({error:'You already own this card.'});}
    const ur=await client.query('SELECT balance,referred_by,first_fast_buy_done FROM users WHERE telegram_id=$1 FOR UPDATE',[req.tgUser.id]);
    if(!ur.rows.length||Number(ur.rows[0].balance)<total){await client.query('ROLLBACK');return res.status(400).json({error:'Insufficient wallet balance. Card price plus the 0.5% purchase fee is '+money(total)+'. Please deposit first.'});}
    await client.query('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2',[total,req.tgUser.id]);
    if(card.owner_id){await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',[price,card.owner_id]);await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'sale',$2,$3)",[card.owner_id,price,'Card sold: '+card.title+' (#'+card.id+')']);}
    await client.query('UPDATE cards SET owner_id=$1,listed_for_sale=FALSE,listing_price=NULL WHERE id=$2',[req.tgUser.id,card.id]);
    await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'card_purchase',$2,$3)",[req.tgUser.id,-total,(fastBuy?'Fast Buy: ':'Purchased ')+card.title+' (#'+card.id+') including 0.5% fee']);
    let commission=0;
    if(fastBuy&&!ur.rows[0].first_fast_buy_done){
      await client.query('UPDATE users SET first_fast_buy_done=TRUE WHERE telegram_id=$1',[req.tgUser.id]);
      const referrer=ur.rows[0].referred_by?String(ur.rows[0].referred_by):'';
      if(referrer&&referrer!==req.tgUser.id){
        const amount=Number((price*0.10).toFixed(2));
        const ins=await client.query('INSERT INTO referral_commissions(referrer_id,referred_user_id,card_id,purchase_amount,commission_amount) VALUES($1,$2,$3,$4,$5) ON CONFLICT(referred_user_id) DO NOTHING RETURNING id',[referrer,req.tgUser.id,card.id,price,amount]);
        if(ins.rows.length){commission=amount;await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',[commission,referrer]);await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'referral_commission',$2,$3)",[referrer,commission,'10% first Fast Buy referral commission']);}
      }
    }
    await client.query('COMMIT');
    const balance=await pool.query('SELECT balance FROM users WHERE telegram_id=$1',[req.tgUser.id]);
    res.json({ok:true,message:fastBuy?'Fast Buy complete.':'Purchase complete.',card:publicCard({...card,owner_id:req.tgUser.id,listed_for_sale:false,listing_price:null}),balance:Number(balance.rows[0]?.balance||0),referralCommission:commission,price,fee,total});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('API purchase failed',e);res.status(500).json({error:'Purchase failed. Please try again.'});}
  finally{client.release();}
}
app.post('/api/buy/:id',apiAuth,async(req,res)=>processCardPurchase(req,res,false));
app.post('/api/fast-buy/:id',apiAuth,async(req,res)=>processCardPurchase(req,res,true));
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
app.get('/api/admin/kyc',apiAuth,apiAdmin,async(req,res)=>{
  const status=['pending','approved','rejected'].includes(req.query.status)?req.query.status:'pending';
  const r=await pool.query('SELECT k.id,k.telegram_id,k.status,k.created_at,k.reviewed_at,u.username FROM kyc_submissions k LEFT JOIN users u ON u.telegram_id=k.telegram_id WHERE k.status=$1 ORDER BY k.created_at DESC LIMIT 100',[status]);
  res.json({submissions:r.rows.map(k=>({...k,telegram_id:String(k.telegram_id)}))});
});
app.post('/api/admin/kyc/:id/:action',apiAuth,apiAdmin,async(req,res)=>{
  const action=req.params.action;
  if(!['approve','reject'].includes(action))return res.status(400).json({error:'Invalid action.'});
  const status=action==='approve'?'approved':'rejected';
  const r=await pool.query("UPDATE kyc_submissions SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3 AND status='pending' RETURNING telegram_id",[status,req.tgUser.id,req.params.id]);
  if(!r.rows.length)return res.status(409).json({error:'KYC request already processed or not found.'});
  const message=status==='approved'?'✅ Your KYC has been approved.':'KYC review rejected. Contact support if needed.';
  bot.telegram.sendMessage(String(r.rows[0].telegram_id),message).catch(()=>{});
  res.json({ok:true,status});
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
      await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'deposit',$2,$3)",[d.telegram_id,d.amount,'Deposit #'+d.id+' USDT approved']);
    }
    await client.query('COMMIT');
    bot.telegram.sendMessage(String(d.telegram_id),action==='approve'?'🎉 Your deposit of '+money(d.amount)+' has been approved. Your wallet has been updated.':'Your Deposit #'+d.id+' was rejected. Please verify your payment details with support.').catch(()=>{});
    res.json({ok:true,status});
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error(e); res.status(500).json({error:'Could not process deposit.'}); }
  finally { client.release(); }
});
app.get('/api/admin/cards',apiAuth,apiAdmin,async(_req,res)=>{
  const r=await pool.query('SELECT * FROM cards ORDER BY id DESC LIMIT 200');
  res.json({cards:r.rows.map(publicCard)});
});
app.post('/api/admin/cards/upload',apiAuth,apiAdmin,async(req,res)=>{
 try{
  const title=String(req.body.title||'').trim(),price=Number(req.body.price),description=String(req.body.description||'').trim();
  const imageData=String(req.body.imageData||'');
  if(!title||title.length>120||!Number.isFinite(price)||price<0||price>10000000)return res.status(400).json({error:'Enter a card name and valid price.'});
  if(description.length>1000)return res.status(400).json({error:'Description is too long.'});
  const match=imageData.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if(!match)return res.status(400).json({error:'Choose a JPG, PNG, WEBP or GIF photo from your gallery.'});
  if(Buffer.byteLength(match[2],'base64')>5*1024*1024)return res.status(400).json({error:'Image must be 5 MB or smaller.'});
  const r=await pool.query('INSERT INTO cards(title,price,description,image_file_id) VALUES($1,$2,$3,$4) RETURNING *',[title,price,description,imageData]);
  res.status(201).json({card:publicCard(r.rows[0])});
 }catch(e){console.error('Gallery card upload failed',e.message);res.status(500).json({error:'Could not save card photo. Please try again.'});}
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
  if (ctx.callbackQuery) { await ctx.answerCbQuery('Preview mode. Connect a database to enable all features.').catch(() => {}); return; }
  if (text) return ctx.reply('👀 Golden Card Market is running in preview mode. Cards, wallet, deposits, and admin data are disabled until a database is connected. Add your DATABASE_URL and redeploy to enable these features.');
  return next();
});

bot.start(async ctx => {
  if (!hasDb) return ctx.reply('✨ Golden Card Market Preview\\n\\nTap the button below to open the premium black-and-gold Mini App.', menu);
  await ensureUser(ctx);
  const m=String(ctx.startPayload||'').match(/^ref_(\\d{1,20})$/);
  if(m&&m[1]!==String(ctx.from.id)) await pool.query('UPDATE users SET referred_by=$1 WHERE telegram_id=$2 AND referred_by IS NULL',[m[1],String(ctx.from.id)]);
  await ctx.reply('✨ Welcome to Golden Card Market!\\n\\n🎴 Marketplace • 💰 USDT Wallet • 👥 Refer & Earn • 🪪 KYC Verification',menu);
});
bot.command('menu', async ctx => { if (hasDb) await ensureUser(ctx); await ctx.reply(hasDb ? 'Main menu:' : '👀 Preview Mode — Connect a database to enable all menu features.', menu); });
bot.command('app', async ctx => { await ctx.reply('✨ Golden Card Market Mini App', menu); });
bot.command('admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  await ctx.reply('🔐 Admin Panel', adminMenu);
});
bot.command('setbkash', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  const value = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
  if (!value) return ctx.reply('Usage: /setbkash 01XXXXXXXXX');
  await pool.query("INSERT INTO app_settings(key,value) VALUES('bkash_number',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [value]);
  await ctx.reply('bKash number saved successfully.');
});
bot.command('setnagad', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  const value = ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
  if (!value) return ctx.reply('Usage: /setnagad 01XXXXXXXXX');
  await pool.query("INSERT INTO app_settings(key,value) VALUES('nagad_number',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [value]);
  await ctx.reply('Nagad number saved successfully.');
});
bot.command('addcard', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  await setState(ctx.from.id, 'card_title', {});
  await ctx.reply('Enter the card name.');
});
bot.action(/^cards:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const offset = Number(ctx.match[1]);
  const r = await pool.query('SELECT * FROM cards WHERE active=TRUE AND (owner_id IS NULL OR listed_for_sale=TRUE) ORDER BY id LIMIT 5 OFFSET $1', [offset]);
  if (!r.rows.length) return ctx.reply('No cards have been added yet. An admin can add cards using /addcard.', menu);
  for (const c of r.rows) {
    const caption = '✨ ' + c.title + '\n🆔 Card #' + c.id + '\n💰 Price: ' + money(c.listed_for_sale ? c.listing_price : c.price) + (c.listed_for_sale ? '\n♻️ Player resale' : '');
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('🛒 Buy ' + money(c.price), 'buy:' + c.id)]]);
    if (c.image_file_id) await ctx.replyWithPhoto(c.image_file_id, { caption: caption, ...keyboard });
    else await ctx.reply(caption, keyboard);
  }
  const nav = [];
  if (offset > 0) nav.push(Markup.button.callback('⬅️ Previous', 'cards:' + Math.max(0, offset - 5)));
  if (r.rows.length === 5) nav.push(Markup.button.callback('Next ➡️', 'cards:' + (offset + 5)));
  if (nav.length) await ctx.reply('More cards:', Markup.inlineKeyboard([nav]));
});
bot.action('wallet', async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT balance FROM users WHERE telegram_id=$1', [String(ctx.from.id)]);
  await ctx.reply('💰 Wallet Balance: ' + money(r.rows[0] ? r.rows[0].balance : 0), Markup.inlineKeyboard([[Markup.button.callback('➕ Deposit', 'deposit')], [Markup.button.callback('📜 Transactions', 'transactions')]]));
});
bot.action('deposit', async ctx => {
  await ctx.answerCbQuery();
  if (!hasDb) return ctx.reply('A database connection is required to use deposits.');
  const kyc = await pool.query("SELECT status FROM kyc_submissions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 1", [String(ctx.from.id)]);
  if (kyc.rows[0]?.status !== 'approved') return ctx.reply('🔒 Deposit is locked. You must submit KYC and wait for admin approval before depositing.', Markup.inlineKeyboard([[Markup.button.callback('🪪 Start KYC Verification', 'kyc:start')]]));
  await setState(ctx.from.id, 'deposit_amount', {});
  const bkash = await setting('bkash_number');
  const nagad = await setting('nagad_number');
  await ctx.reply('➕ Deposit\n\nbKash: ' + (bkash || 'Not configured by admin yet') + '\nNagad: ' + (nagad || 'Not configured by admin yet') + '\n\nAfter sending the payment, enter the amount you deposited. An admin will verify your transaction ID.');
});
bot.action('sell', async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT id,title,price,listing_price,listed_for_sale FROM cards WHERE owner_id=$1 ORDER BY id', [String(ctx.from.id)]);
  if (!r.rows.length) return ctx.reply('Your collection is empty. Buy a card from the marketplace to get started.', menu);
  for (const c of r.rows) await ctx.reply('💸 ' + c.title + ' (#' + c.id + ')' + (c.listed_for_sale ? '\nListed at ' + money(c.listing_price) : '\nOriginal price: ' + money(c.price)),
    Markup.inlineKeyboard([[Markup.button.callback(c.listed_for_sale ? 'Cancel Listing' : 'Sell this card', 'sellcard:' + c.id)]]));
});
bot.action(/^sellcard:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT id,title,listed_for_sale FROM cards WHERE id=$1 AND owner_id=$2', [ctx.match[1], String(ctx.from.id)]);
  if (!r.rows.length) return ctx.reply('This card is not in your collection.');
  if (r.rows[0].listed_for_sale) {
    await pool.query('UPDATE cards SET listed_for_sale=FALSE,listing_price=NULL WHERE id=$1 AND owner_id=$2', [ctx.match[1], String(ctx.from.id)]);
    return ctx.reply('✅ The sale listing for ' + r.rows[0].title + ' has been cancelled.', menu);
  }
  await setState(ctx.from.id, 'sell_price', { cardId: Number(ctx.match[1]), title: r.rows[0].title });
  await ctx.reply('💸 ' + r.rows[0].title + ' What price would you like to sell it for? Enter the amount only.');
});
bot.action('collection', async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT id,title,price FROM cards WHERE owner_id=$1 ORDER BY id', [String(ctx.from.id)]);
  await ctx.reply(r.rows.length ? '🎴 Your Collection:\n' + r.rows.map(c => '#' + c.id + ' ' + c.title + ' — ' + money(c.price)).join('\n') : 'Your collection is empty.', menu);
});
bot.action('transactions', async ctx => {
  await ctx.answerCbQuery();
  const r = await pool.query('SELECT type,amount,details FROM transactions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 10', [String(ctx.from.id)]);
  await ctx.reply(r.rows.length ? '📜 Transaction History:\n' + r.rows.map(t => t.type + ': ' + money(t.amount) + ' — ' + t.details).join('\n') : 'No completed transactions yet.');
});
bot.action(/^withdraw:(approve|reject):(\d+)$/,async ctx=>{
  if(!isAdmin(ctx)){await ctx.answerCbQuery('Admin only.');return;}
  await ctx.answerCbQuery();
  const action=ctx.match[1],id=ctx.match[2],client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE',[id]);
    if(!r.rows.length||r.rows[0].status!=='pending'){await client.query('ROLLBACK');return ctx.reply('Withdrawal already processed or not found.');}
    const w=r.rows[0],status=action==='approve'?'approved':'rejected';
    await client.query('UPDATE withdrawals SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3',[status,ctx.from.id,id]);
    if(action==='reject'){
      await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',[w.amount,w.telegram_id]);
      await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'withdrawal_refund',$2,$3)",[w.telegram_id,w.amount,'Refund for rejected withdrawal #'+id]);
    }else await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'withdrawal_paid',$2,$3)",[w.telegram_id,0,'Withdrawal #'+id+' approved by admin']);
    await client.query('COMMIT');
    bot.telegram.sendMessage(String(w.telegram_id),action==='approve'?'Your withdrawal #'+id+' was approved. Please allow time for the payout to arrive.':'Your withdrawal #'+id+' was rejected and the amount has been refunded to your wallet.').catch(()=>{});
    await ctx.reply('Withdrawal #'+id+' '+status+'.');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error(e);await ctx.reply('Could not process withdrawal.');}
  finally{client.release();}
});
bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply('Browse Cards to explore the marketplace. Use Deposit to submit a funding request. Card purchases include a 0.5% fee. Use Refer & Earn to invite friends and request wallet withdrawals from the Mini App.', menu);
});
bot.action(/^buy:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cr = await client.query('SELECT * FROM cards WHERE id=$1 AND active=TRUE AND (owner_id IS NULL OR listed_for_sale=TRUE) FOR UPDATE', [ctx.match[1]]);
    if (!cr.rows.length) { await client.query('ROLLBACK'); return ctx.reply('This card is no longer available for sale.'); }
    const card = cr.rows[0];
    const salePrice = Number(card.listed_for_sale ? card.listing_price : card.price);
    if (card.owner_id && String(card.owner_id) === String(ctx.from.id)) { await client.query('ROLLBACK'); return ctx.reply('You already own this card.'); }
    const ur = await client.query('SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE', [String(ctx.from.id)]);
    if (!ur.rows.length || Number(ur.rows[0].balance) < salePrice) {
      await client.query('ROLLBACK');
      return ctx.reply('Insufficient balance. Card price: ' + money(salePrice), Markup.inlineKeyboard([[Markup.button.callback('➕ Deposit', 'deposit')]]));
    }
    await client.query('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2', [salePrice, String(ctx.from.id)]);
    if (card.owner_id) { await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [salePrice, card.owner_id]); await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'sale',$2,$3)", [card.owner_id, salePrice, 'Card sold: ' + card.title]); }
    await client.query('UPDATE cards SET owner_id=$1,listed_for_sale=FALSE,listing_price=NULL WHERE id=$2', [String(ctx.from.id), card.id]);
    await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'card_purchase',$2,$3)", [String(ctx.from.id), -salePrice, 'Card #' + card.id + ' purchased']);
    await client.query('COMMIT');
    await ctx.reply('✅ Purchase complete! ' + card.title + ' has been added to your collection.', menu);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('purchase error', e);
    await ctx.reply('Purchase failed. Please try again.');
  } finally { client.release(); }
});
bot.action('admin:addcard', async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  await setState(ctx.from.id, 'card_title', {});
  await ctx.reply('Enter the card name.');
});
bot.action('admin:settings', async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  await ctx.reply('Configure payment numbers:\n/setbkash 01XXXXXXXXX\n/setnagad 01XXXXXXXXX');
});
bot.action('referral',async ctx=>{
  await ctx.answerCbQuery();
  if(!hasDb)return ctx.reply('A database connection is required to use referrals.');
  const username=botUsername||((await bot.telegram.getMe()).username),link='https://t.me/'+username+'?start=ref_'+ctx.from.id;
  const [u,c]=await Promise.all([pool.query('SELECT COUNT(*)::int AS invited FROM users WHERE referred_by=$1',[String(ctx.from.id)]),pool.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(commission_amount),0)::numeric AS earned FROM referral_commissions WHERE referrer_id=$1',[String(ctx.from.id)])]);
  return ctx.reply('👥 GOLDEN REFER & EARN\\n\\nYour invite link:\\n'+link+'\\n\\nInvited: '+u.rows[0].invited+'\\nFirst Fast Buys: '+c.rows[0].count+'\\nEarned: '+money(c.rows[0].earned)+'\\n\\n10% commission applies only to each referred user’s first Fast Buy.',Markup.inlineKeyboard([[Markup.button.callback('🪪 Start KYC','kyc:start')],[Markup.button.webApp('Open Mini App',miniAppUrl)]]));
});
bot.command('kyc',async ctx=>{
  if(!hasDb)return ctx.reply('A database connection is required to use KYC verification.');
  await ensureUser(ctx);
  await setState(ctx.from.id,'kyc_front',{});
  return ctx.reply('🪪 GOLDEN CARD MARKET — KYC\\n\\nStep 1/3: Send a clear photo of the FRONT of your own NID or passport. Then send the back, followed by a selfie holding the same ID.\\n\\nID photos are sensitive. Submit only your own documents if you agree to share them with this service.');
});
bot.action('kyc:start',async ctx=>{
  await ctx.answerCbQuery();if(!hasDb)return ctx.reply('A database connection is required to use KYC verification.');await ensureUser(ctx);await setState(ctx.from.id,'kyc_front',{});
  return ctx.reply('🪪 GOLDEN CARD MARKET — KYC\\n\\nStep 1/3: Send a clear photo of the FRONT of your own NID or passport. Then send the back, followed by a selfie holding the same ID.\\n\\nID photos are sensitive. Submit only your own documents if you agree to share them with this service.');
});
bot.action('admin:kyc',async ctx=>{
  await ctx.answerCbQuery();if(!isAdmin(ctx))return ctx.reply('⛔ Access denied. Admin privileges are required.');
  const r=await pool.query("SELECT id,telegram_id,created_at FROM kyc_submissions WHERE status='pending' ORDER BY id LIMIT 20");
  if(!r.rows.length)return ctx.reply('No pending KYC submissions.');
  for(const k of r.rows)await ctx.reply('🪪 KYC #'+k.id+'\\nUser: '+k.telegram_id+'\\nSubmitted: '+new Date(k.created_at).toLocaleString(),Markup.inlineKeyboard([[Markup.button.callback('✅ Approve','kyc:approve:'+k.id),Markup.button.callback('❌ Reject','kyc:reject:'+k.id)]]));
});
bot.action(/^kyc:(approve|reject):(\\d+)$/,async ctx=>{
  await ctx.answerCbQuery();if(!isAdmin(ctx))return ctx.reply('⛔ Access denied. Admin privileges are required.');
  const status=ctx.match[1]==='approve'?'approved':'rejected';
  const r=await pool.query("UPDATE kyc_submissions SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3 AND status='pending' RETURNING telegram_id",[status,String(ctx.from.id),ctx.match[2]]);
  if(!r.rows.length)return ctx.reply('KYC request already processed or not found.');
  await bot.telegram.sendMessage(String(r.rows[0].telegram_id),status==='approved'?'✅ Your KYC has been approved.':'KYC review rejected. Contact support if needed.').catch(()=>{});
  return ctx.reply('KYC '+status+'.');
});
bot.action('admin:pending', async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  const r = await pool.query("SELECT * FROM deposits WHERE status='pending' ORDER BY id LIMIT 20");
  if (!r.rows.length) return ctx.reply('No pending deposits.');
  for (const d of r.rows) {
    await ctx.reply('Deposit #' + d.id + '\nUser: ' + d.telegram_id + '\nAmount: ' + money(d.amount) + '\nMethod: ' + d.method + '\nTransaction ID: ' + d.transaction_id,
      Markup.inlineKeyboard([[Markup.button.callback('✅ Approve', 'approve:' + d.id), Markup.button.callback('❌ Reject', 'reject:' + d.id)]]));
  }
});
bot.action(/^approve:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE', [ctx.match[1]]);
    if (!r.rows.length || r.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return ctx.reply('This request has already been processed or could not be found.'); }
    const d = r.rows[0];
    await client.query("UPDATE deposits SET status='approved',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2", [String(ctx.from.id), d.id]);
    await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [d.amount, d.telegram_id]);
    await client.query("INSERT INTO transactions(telegram_id,type,amount,details) VALUES($1,'deposit',$2,$3)", [d.telegram_id, d.amount, 'Deposit #' + d.id + ' USDT approved']);
    await client.query('COMMIT');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await ctx.reply('Deposit #' + d.id + ' approved. ' + money(d.amount) + ' has been added to the wallet.');
    await bot.telegram.sendMessage(String(d.telegram_id), '🎉 Your ' + money(d.amount) + ' deposit has been approved.').catch(() => {});
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('approve error', e);
    await ctx.reply('Approval failed. Please try again.');
  } finally { client.release(); }
});
bot.action(/^reject:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access denied. Admin privileges are required.');
  const r = await pool.query("UPDATE deposits SET status='rejected',reviewed_by=$1,reviewed_at=NOW() WHERE id=$2 AND status='pending' RETURNING *", [String(ctx.from.id), ctx.match[1]]);
  if (!r.rows.length) return ctx.reply('This request has already been processed or could not be found.');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply('Deposit #' + ctx.match[1] + ' was rejected.');
  await bot.telegram.sendMessage(String(r.rows[0].telegram_id), 'Your Deposit Request was rejected. Please verify your payment details with support.').catch(() => {});
});
bot.on('text', async ctx => {
  await ensureUser(ctx);
  const st = await getState(ctx.from.id);
  if (!st) return;
  const value = ctx.message.text.trim();
  if (st.state === 'deposit_amount') {
    const kyc = await pool.query("SELECT status FROM kyc_submissions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 1", [String(ctx.from.id)]);
    if (kyc.rows[0]?.status !== 'approved') { await clearState(ctx.from.id); return ctx.reply('🔒 Deposit is locked until your KYC is approved by admin.', Markup.inlineKeyboard([[Markup.button.callback('🪪 Start KYC Verification', 'kyc:start')]])); }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) return ctx.reply('Enter a valid USDT amount, for example: 10.');
    await setState(ctx.from.id, 'deposit_method', { amount });
    return ctx.reply('Which USDT network did you use? Enter one of: TRC20, ERC20, BEP20, Polygon, Arbitrum, Optimism, Solana, TON, Avalanche, or Base.');
  }
  if (st.state === 'deposit_method') {
    const method = value.toLowerCase();
    if (!['trc20','erc20','bep20','polygon','arbitrum','optimism','solana','ton','avalanche','base'].includes(method)) return ctx.reply('Enter a supported USDT network, such as TRC20.');
    if (!(await setting('usdt_'+method))) return ctx.reply('The admin has not configured a wallet address for this network yet.');
    await setState(ctx.from.id, 'deposit_txid', { amount: st.data.amount, method: method });
    return ctx.reply('Now enter the blockchain transaction hash.');
  }
  if (st.state === 'deposit_txid') {
    const kyc = await pool.query("SELECT status FROM kyc_submissions WHERE telegram_id=$1 ORDER BY id DESC LIMIT 1", [String(ctx.from.id)]);
    if (kyc.rows[0]?.status !== 'approved') { await clearState(ctx.from.id); return ctx.reply('🔒 Deposit is locked until your KYC is approved by admin.'); }
    const txid = value.replace(/\s+/g, '');
    if (txid.length < 20 || txid.length > 150) return ctx.reply('Enter a valid blockchain transaction hash.');
    try {
      const r = await pool.query('INSERT INTO deposits(telegram_id,amount,method,transaction_id) VALUES($1,$2,$3,$4) RETURNING id', [String(ctx.from.id), st.data.amount, st.data.method, txid]);
      await clearState(ctx.from.id);
      await ctx.reply('✅ Deposit Request #' + r.rows[0].id + ' submitted successfully. An admin will verify it before funds are added to your wallet.', menu);
      for (const adminId of admins) {
        await bot.telegram.sendMessage(adminId, '⏳ Deposit #' + r.rows[0].id + '\nUser: ' + ctx.from.id + '\nAmount: ' + money(st.data.amount) + '\nMethod: ' + st.data.method + '\nTXID: ' + txid,
          Markup.inlineKeyboard([[Markup.button.callback('✅ Approve', 'approve:' + r.rows[0].id), Markup.button.callback('❌ Reject', 'reject:' + r.rows[0].id)]])).catch(e => console.error('admin notification error', e.message));
      }
    } catch (e) {
      if (e.code === '23505') return ctx.reply('This transaction ID has already been submitted.');
      console.error(e);
      await ctx.reply('Your request could not be submitted. Please try again later.');
    }
    return;
  }
  if (st.state === 'sell_price') {
    const price = Number(value);
    if (!Number.isFinite(price) || price <= 0 || price > 10000000) return ctx.reply('Enter a valid sale price.');
    const r = await pool.query('UPDATE cards SET listed_for_sale=TRUE,listing_price=$1 WHERE id=$2 AND owner_id=$3 RETURNING title', [price, st.data.cardId, String(ctx.from.id)]);
    if (!r.rows.length) { await clearState(ctx.from.id); return ctx.reply('This card is no longer in your collection.'); }
    await clearState(ctx.from.id);
    return ctx.reply('✅ ' + r.rows[0].title + ' has been listed on the marketplace for ' + money(price) + '.', menu);
  }
  if (st.state === 'card_title' && isAdmin(ctx)) {
    await setState(ctx.from.id, 'card_price', { title: value });
    return ctx.reply('Enter the card price, for example: 450.');
  }
  if (st.state === 'card_price' && isAdmin(ctx)) {
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) return ctx.reply('Enter a valid price.');
    await setState(ctx.from.id, 'card_photo', { title: st.data.title, price: price });
    return ctx.reply('Now send the card image as a photo.');
  }
});
bot.on('photo',async ctx=>{
  if(!hasDb)return;
  const st=await getState(ctx.from.id),photos=ctx.message.photo,fileId=photos[photos.length-1].file_id;
  if(st&&['kyc_front','kyc_back','kyc_selfie'].includes(st.state)){
    if(st.state==='kyc_front'){await setState(ctx.from.id,'kyc_back',{front:fileId});return ctx.reply('Front received. Send the BACK of the same ID.');}
    if(st.state==='kyc_back'){await setState(ctx.from.id,'kyc_selfie',{front:st.data.front,back:fileId});return ctx.reply('Back received. Send a selfie holding the same ID clearly beside your face.');}
    try{
      const r=await pool.query("INSERT INTO kyc_submissions(telegram_id,front_file_id,back_file_id,selfie_file_id) VALUES($1,$2,$3,$4) RETURNING id",[String(ctx.from.id),st.data.front,st.data.back,fileId]);
      await clearState(ctx.from.id);await ctx.reply('✅ KYC submitted. Admin will review your photos.');
      for(const adminId of admins){await bot.telegram.sendPhoto(adminId,st.data.front,{caption:'KYC #'+r.rows[0].id+' FRONT · User '+ctx.from.id}).catch(()=>{});await bot.telegram.sendPhoto(adminId,st.data.back,{caption:'KYC #'+r.rows[0].id+' BACK · User '+ctx.from.id}).catch(()=>{});await bot.telegram.sendPhoto(adminId,fileId,{caption:'KYC #'+r.rows[0].id+' SELFIE HOLDING ID · User '+ctx.from.id,reply_markup:{inline_keyboard:[[{text:'Approve',callback_data:'kyc:approve:'+r.rows[0].id},{text:'Reject',callback_data:'kyc:reject:'+r.rows[0].id}]]}}).catch(()=>{});}
    }catch(e){console.error('KYC submit failed',e);return ctx.reply('KYC submission failed. Please try again.');}
    return;
  }
  if(!st||st.state!=='card_photo'||!isAdmin(ctx))return;
  const r=await pool.query('INSERT INTO cards(title,price,image_file_id) VALUES($1,$2,$3) RETURNING id',[st.data.title,st.data.price,fileId]);
  await clearState(ctx.from.id);await ctx.reply('✅ Card #'+r.rows[0].id+' has been added successfully.',adminMenu);
});

bot.catch(err => console.error('Telegram bot error', err));
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || crypto.createHash('sha256').update(process.env.BOT_TOKEN).digest('hex').slice(0, 32);
const webhookPath = '/telegram-webhook/' + webhookSecret;
app.use(bot.webhookCallback(webhookPath, { secretToken: webhookSecret }));
(async () => {
  if (hasDb) await initDb();
  else console.log('Starting in preview mode: DATABASE_URL is not set');
  app.listen(Number(process.env.PORT || 3000), () => console.log('Health server listening; Telegram webhook route ready at ' + webhookPath));
  try { botUsername=(await bot.telegram.getMe()).username||botUsername; } catch(e) { console.error('Could not read bot username',e.message); }
  await bot.telegram.setWebhook(miniAppUrl + webhookPath, { secret_token: webhookSecret, drop_pending_updates: false });
  console.log('Golden Card Market bot started (webhook mode)');
})().catch(err => { console.error('Startup failed', err); process.exit(1); });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
