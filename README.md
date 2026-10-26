# Pokemonbot — Golden Card Marketplace

Telegram bot starter with card browsing, wallet, manual bKash/Nagad deposit requests, admin approval/rejection, duplicate Transaction ID protection, and wallet card purchases.

## Setup
1. Create a Telegram bot using @BotFather and copy its token.
2. Create a PostgreSQL database.
3. Copy .env.example to .env and set BOT_TOKEN, ADMIN_IDS (your numeric Telegram user ID), and DATABASE_URL.
4. Run `npm install` then `npm start` with Node.js 20+.
5. In Telegram, use `/admin`. Add a card with `/addcard`, then follow prompts. Configure numbers with `/setbkash 01XXXXXXXXX` and `/setnagad 01XXXXXXXXX`.
6. Deploy to a Node.js host with build command `npm install`, start command `npm start`, and all environment variables configured.

## Deposit safety
Users submit amount, payment method, and Transaction ID. Admin must independently verify the payment in the actual account before approval. Only approval credits the wallet. Duplicate Transaction IDs are blocked by a unique database constraint.

## Current limitations
Starter MVP only: user-to-user resale, withdrawals, a full web admin dashboard, bulk image upload, and production security review are not implemented. The initial 40 card images/prices have not been populated; add images you own or have permission to use. Do not use real funds before thorough testing. Pokémon is a third-party trademark; check rights before public/commercial launch.
