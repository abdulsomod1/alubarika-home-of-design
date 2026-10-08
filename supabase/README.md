# Supabase database setup

The initial schema is in `migrations/202610050001_initial_schema.sql`; the follow-up `202610070001_supabase_auth_rls.sql` links profiles to Supabase Auth and adds access policies/functions. Together, they create:

- `users` for customer, staff, and admin accounts
- `categories` and `products` for the catalog
- `site_settings` for the storefront logo and hero image
- `orders` and `order_items` for checkout and fulfillment

Product gallery images, sizes, and colors use `jsonb`; prices use fixed-precision `numeric`; role, inventory, and order status constraints are enforced in PostgreSQL. Row-level security distinguishes public catalog reads, customer-owned records, staff operations, and admin role assignment. Orders and inventory changes run through database functions so stock changes are atomic. The Express server uses only the Supabase project URL and anon/publishable key; each authenticated request forwards the user's Supabase Auth token so RLS applies. No service-role key is used by the app.

## Create and initialize the project

1. Create a Supabase project from the Supabase dashboard.
2. Open **SQL Editor** and run `migrations/202610050001_initial_schema.sql`, then `migrations/202610070001_supabase_auth_rls.sql`, then `seed.sql`, in that order.
3. In local `.env`, set `SUPABASE_URL` to the Project URL and `SUPABASE_ANON_KEY` to the publishable/anon key. Keep the file out of source control. The anon key is designed for client use; database RLS is what protects the data.
4. In **Authentication > URL Configuration**, allow the local redirect URL, for example `http://localhost:3000/#auth` or the port used by this app, and set `PASSWORD_RESET_REDIRECT` to match.
5. Start the app with `npm run dev`. `/api/health` checks whether the app can query the Supabase schema.
6. Register the owner account through the website, then promote that email to admin from the Supabase SQL Editor: `UPDATE public.users SET role = 'admin' WHERE email = 'owner@example.com';`. Keep admin promotion out of public signup.

## Deploy on Netlify

The repository includes `netlify.toml`, which publishes `public/`, rewrites `/api/*` to the Express Netlify Function, and falls back to `index.html` for client-side routes. In Netlify, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` under **Site configuration > Environment variables**, then deploy. The browser assets are served from `public/`; server API routes run through `netlify/functions/api.js`.

The Express API now uses Supabase Auth and PostgREST through the anon key and per-user access tokens. The old SQLite file is no longer read by the running app. Existing account passwords are not automatically transferred into Supabase Auth; customers must sign up/reset their password, or accounts can be linked by email when users sign up. A legacy SQLite importer is provided for catalog, settings, and order data, but it requires a direct PostgreSQL URL configured as `SUPABASE_DB_URL` and should only be run after applying the migrations.

To import local legacy rows, back up `alubarika.db`, set `SUPABASE_DB_URL` privately, apply the schema first, and then run `npm run db:supabase:import-sqlite`. The importer preserves IDs and upserts rows; run only against the intended project. Legacy password hashes are retained as unused migration data and are not used by Supabase Auth.