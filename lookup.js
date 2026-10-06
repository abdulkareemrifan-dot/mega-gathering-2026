// POST /api/lookup { query } → find a registration by ID or mobile number
const { db } = require('../lib/db');
const { handler, HttpError, body, normalizeMobile, extractRegId, check, toClient } = require('../lib/util');

module.exports = handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
  const q = String(body(req).query || '').trim();
  if (!q) throw new HttpError(400, 'Enter your Registration ID or mobile number.');

  let query = db().from('registrations').select('*');
  const id = extractRegId(q);
  if (id) query = query.eq('registration_id', id);
  else {
    const mobile = normalizeMobile(q);
    if (!/^0\d{9}$/.test(mobile)) throw new HttpError(400, 'Enter a valid Registration ID (MYG26-00001) or 10-digit mobile number.');
    query = query.eq('mobile', mobile);
  }
  const rows = check(await query.order('created_at', { ascending: false }).limit(1));
  if (!rows.length) throw new HttpError(404, 'No registration found. Please check the ID or mobile number.');
  return { ok: true, registration: toClient(rows[0]) };
});
