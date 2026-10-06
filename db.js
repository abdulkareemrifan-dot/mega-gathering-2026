const { createClient } = require('@supabase/supabase-js');

let client = null;

// Server-side Supabase client. Uses the SECRET service_role key, which must
// only ever live in Vercel environment variables – never in the browser.
function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Server is not configured yet: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.');
    }
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

module.exports = { db };
