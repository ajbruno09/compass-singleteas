# Compass · Single Teas

The operations portal for Single Teas: indents, store, purchasing, receiving, closing stock, vendor bills and payments.

## What is here

- `app/`: the web app (React + TypeScript), installable on phones. Built with `npm run build` inside `app/`; the result is in `app/dist`.
- `supabase/migrations/`: the database, in order. `0001` and `0002` are applied; `0003` is waiting for approval.
- `supabase/functions/staff-admin/`: the server function that creates staff logins (mobile number + 6-digit PIN) and resets PINs. Owner only.

## Hosting on Cloudflare Pages

Connect this repository in Cloudflare Pages with:

- Root directory: `app`
- Build command: `npm run build`
- Output directory: `dist`

The database address and publishable key are in `app/.env.production`. They are meant to be public; the database rules decide who can see what.

## Sign-in

- Owner: email and password (ajbruno09@gmail.com becomes owner automatically on first sign-up).
- Everyone else: mobile number and a 6-digit PIN, created by the owner under People.
