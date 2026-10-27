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
