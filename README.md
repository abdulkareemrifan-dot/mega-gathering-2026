# Mega Youth & Family Gathering 2026 – Registration System

Poster website, registration form and admin panel for the **Sri Lankan Community – Jeddah**.
Runs on **GitHub + Vercel + Supabase**, all on free plans.

| Page | Address | Who |
|---|---|---|
| Poster + Register Now button + QR | `/` | Everyone |
| Registration form | `/register` | Everyone |
| Check registration / ticket | `/check` | Everyone |
| Admin dashboard | `/admin` | Organisers (PIN) |

---

## Setup (about 20 minutes, one time)

### Step 1 – Supabase (the database)
1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub.
2. **New project** → name it `mega-gathering-2026`, choose a strong database password, Region: **closest to Saudi Arabia** (e.g. Frankfurt or Mumbai) → **Create**.
3. When it's ready, open **SQL Editor** → **New query**.
4. Open the file `supabase/schema.sql` from this project, copy **everything**, paste it, click **Run**. You should see "Success".
5. Go to **Project Settings → API** (or **API Keys**) and copy:
   - **Project URL** → looks like `https://abcd1234.supabase.co`
   - **service_role** key (secret key) → long text. ⚠️ Never share this or put it in any web page.

### Step 2 – GitHub (store the code)
1. Go to <https://github.com/new> → repository name `mega-gathering-2026` → **Private** → **Create repository**.
2. On the new repo page click **uploading an existing file**.
3. Unzip this project on your computer and drag **all files and folders inside** `mega-gathering-2026` (`api`, `lib`, `public`, `supabase`, `package.json`, `vercel.json`, …) into the page. Do **not** upload `node_modules` if it exists.
4. Click **Commit changes**.

### Step 3 – Vercel (put it online)
1. Go to <https://vercel.com> → sign up with GitHub → **Add New… → Project** → **Import** `mega-gathering-2026`.
2. Framework Preset: **Other**. Leave build settings as they are.
3. Open **Environment Variables** and add these four:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL from Step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role key from Step 1 |
   | `ADMIN_PIN` | your first admin PIN, digits only, e.g. `544170199` |
   | `SESSION_SECRET` | any long random text, e.g. `myfg-2026-k3j9x-Qp7v-tA2m-jeddah` |

4. Click **Deploy**. After ~1 minute you get a link like `https://mega-gathering-2026.vercel.app`.
5. Open it – the poster appears with a working **Register Now** button and QR code.

> If you change environment variables later, go to **Deployments → ⋯ → Redeploy** for them to take effect.

---

## Using the admin panel (`/admin`)

Log in with your `ADMIN_PIN`.

- **📋 Registrations** – search, filter, see family members, set **Payment Pending / Paid / Cancelled**, add notes, WhatsApp the guest, delete, **Export CSV** (opens in Excel).
- **🎨 Event & Poster** – choose the poster style (**Classic**: light design with 3 programme columns, 1080×1920 – ideal for WhatsApp status; or **Modern**: dark, 1080×1350), then change every word on the poster (title, date, time, venue, highlights, button, QR caption, contact), total seats, fees per age group, nationality list, payment note, WhatsApp group link, and open/close registration. The preview updates while you type; **Save & publish** updates the live site immediately – no code changes. **Download poster PNG** gives a 1080×1350 image for WhatsApp / Instagram.
- **🎫 Entry Check-in** – on event day, open `/admin` on an Android phone in Chrome → **Start camera** → scan guest tickets. Green = welcome, red = not paid, orange = already checked in. You can also type the ID.
- **🔐 Security & Log** – change the admin PIN (6–12 digits) and see every action taken.

### How seats and payment work
1. A family registers → seats are **Reserved – Payment Pending** (counted against the total).
2. They pay cash → admin sets **Paid** → ticket becomes **Valid**.
3. Admin sets **Cancelled** (or deletes) → seats are released, and the oldest **waiting list** families are moved in automatically.
4. When seats are full, new registrations go to the **waiting list**. Increasing *Total seats* also moves waiting families in.
5. One active registration per mobile number (stops double bookings).

---

## Security notes
- The database rejects all direct access from browsers (Row Level Security on, no public policies). Only the Vercel server functions, holding the secret key, can read or write.
- Admin PIN is checked on the server, slowed down on wrong attempts, and stored hashed after you change it. Changing the PIN logs out every other session.
- The public "Check Registration" page masks mobile numbers and never shows emails.
- Keep the GitHub repository **Private**.

## Custom domain or short link (optional)
Vercel → Project → **Settings → Domains** to add your own domain. If you use a short link (e.g. bit.ly), put it in Admin → Event & Poster → *Registration link* so the button and QR use it.

## Project structure
```
api/            Vercel serverless functions (settings, register, lookup, admin)
lib/            Shared server code (database, auth, default poster text)
public/         Website pages, styles and scripts
supabase/       schema.sql – run once in Supabase SQL Editor
```

## Troubleshooting
| Problem | Fix |
|---|---|
| "Server is not configured yet…" | An environment variable is missing in Vercel → add it → Redeploy. |
| "Event settings are missing" | Open the home page once (it creates the default settings), then try again. |
| "relation … does not exist" | `schema.sql` wasn't run in Supabase – run it (Step 1.4). |
| Camera scanner not available | Use Chrome on Android, or type the Registration ID. |
| Forgot admin PIN | In Supabase → Table Editor → `app_settings` → set `admin_pin_hash` to empty (NULL). The `ADMIN_PIN` from Vercel works again. |
| Supabase project paused | Free projects pause after ~1 week with no activity – open the Supabase dashboard and click **Restore**. |
