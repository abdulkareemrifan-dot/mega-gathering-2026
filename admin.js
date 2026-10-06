// POST /api/admin { action, ... } → everything the admin dashboard does.
// Every action except "login" requires the Bearer token returned by login.
const { db } = require('../lib/db');
const { handler, HttpError, body, extractRegId, check, toClient, ticketStatus, str } = require('../lib/util');
const { getSettings, saveSettings, getAvailability, log } = require('../lib/settings');
const auth = require('../lib/auth');

const PAYMENT = ['Payment Pending', 'Paid', 'Cancelled'];

async function findReg(idInput) {
  const id = extractRegId(idInput);
  if (!id) throw new HttpError(400, 'Invalid Registration ID.');
  const r = check(await db().from('registrations').select('*').eq('registration_id', id).maybeSingle());
  if (!r) throw new HttpError(404, 'Registration ' + id + ' not found.');
  return r;
}

async function update(r, fields) {
  return check(await db().from('registrations')
    .update(Object.assign({ updated_at: new Date().toISOString() }, fields))
    .eq('id', r.id).select('*').single());
}

const actions = {
  async dashboard() {
    const [settings, availability, regs, logs] = await Promise.all([
      getSettings(),
      getAvailability(),
      db().from('registrations').select('*').order('created_at', { ascending: false }).limit(5000),
      db().from('admin_log').select('*').order('created_at', { ascending: false }).limit(150)
    ]);
    return {
      settings,
      availability,
      registrations: check(regs).map(r => toClient(r, { full: true })),
      log: check(logs)
    };
  },

  async saveSettings(b) {
    const settings = await saveSettings(b.settings);
    const promoted = check(await db().rpc('promote_waitlist'));
    await log('SETTINGS_UPDATED', 'Event / poster settings saved' + (promoted ? '; ' + promoted + ' promoted from waiting list' : ''));
    return { settings, availability: await getAvailability() };
  },

  async setPayment(b) {
    const status = String(b.status || '');
    if (!PAYMENT.includes(status)) throw new HttpError(400, 'Invalid payment status.');
    const r = await findReg(b.id);
    const a = await getAvailability();
    const holdsSeat = r.seat_status === 'Reserved' || r.seat_status === 'Confirmed';
    const fits = holdsSeat || r.total_participants <= a.available;
    let seat;
    if (status === 'Paid') {
      if (!fits) throw new HttpError(400, 'Not enough free seats to confirm this registration. Increase Total Seats first.');
      seat = 'Confirmed';
    } else if (status === 'Payment Pending') {
      seat = r.seat_status === 'Waiting' ? 'Waiting' : (fits ? 'Reserved' : 'Waiting');
    } else {
      seat = 'Released';
    }
    const fields = { payment_status: status, seat_status: seat };
    if (status === 'Cancelled') fields.checked_in_at = null;
    const updated = await update(r, fields);
    await log('PAYMENT_STATUS', r.registration_id + ' → ' + status);
    if (seat === 'Released') await db().rpc('promote_waitlist');
    return { registration: toClient(updated, { full: true }) };
  },

  async saveNote(b) {
    const r = await findReg(b.id);
    const updated = await update(r, { admin_note: str(b.note, 500) });
    return { registration: toClient(updated, { full: true }) };
  },

  async verify(b) {
    const r = await findReg(b.id);
    return { registration: toClient(r, { full: true }) };
  },

  async checkIn(b) {
    const r = await findReg(b.id);
    if (ticketStatus(r) !== 'Valid') {
      return { ok: false, registration: toClient(r, { full: true }), message: 'Ticket NOT valid – payment status is "' + r.payment_status + '".' };
    }
    if (r.checked_in_at) {
      return { ok: true, already: true, registration: toClient(r, { full: true }), message: 'Already checked in.' };
    }
    const updated = await update(r, { checked_in_at: new Date().toISOString() });
    await log('CHECK_IN', r.registration_id + ' – ' + r.total_participants + ' participant(s)');
    return { ok: true, registration: toClient(updated, { full: true }), message: 'Checked in successfully.' };
  },

  async undoCheckIn(b) {
    const r = await findReg(b.id);
    const updated = await update(r, { checked_in_at: null });
    await log('CHECK_IN_UNDONE', r.registration_id);
    return { registration: toClient(updated, { full: true }) };
  },

  async remove(b) {
    const r = await findReg(b.id);
    check(await db().from('registrations').delete().eq('id', r.id));
    await log('DELETE_REGISTRATION', r.registration_id + ' (' + r.main_name + ')');
    await db().rpc('promote_waitlist');
    return { deleted: r.registration_id };
  },

  async exportCsv() {
    const rows = check(await db().from('registrations').select('*').order('created_at', { ascending: true }).limit(10000));
    const head = ['Registration ID', 'Date', 'Main Participant', 'Nationality', 'Gender', 'Age Group', 'Mobile', 'Email',
      'Total Participants', 'Additional Participants', 'Total Amount (SAR)', 'Payment Method', 'Payment Status',
      'Seat Status', 'Ticket', 'Checked In', 'Admin Note'];
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = rows.map(r => [
      r.registration_id, r.created_at, r.main_name, r.nationality, r.gender, r.age_group, r.mobile, r.email,
      r.total_participants,
      (r.participants || []).map(p => [p.name, p.relation, p.gender, p.ageGroup].filter(Boolean).join(' / ')).join(' | '),
      r.total_amount, r.payment_method, r.payment_status, r.seat_status, ticketStatus(r), r.checked_in_at || '', r.admin_note || ''
    ].map(q).join(','));
    return { filename: 'MYFG2026-registrations.csv', csv: '﻿' + [head.map(q).join(',')].concat(lines).join('\r\n') };
  },

  // Poster image upload → Supabase Storage (public "posters" bucket)
  async uploadPoster(b) {
    const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw new HttpError(400, 'Please choose a JPG, PNG or WEBP image.');
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 3.5 * 1024 * 1024) throw new HttpError(400, 'Image is too large (max 3.5 MB).');
    const name = 'poster-' + Date.now() + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2]);
    const opts = { contentType: m[1], upsert: false, cacheControl: '31536000' };
    const bucket = () => db().storage.from('posters');
    let r = await bucket().upload(name, buf, opts);
    if (r.error && /bucket|not found/i.test(r.error.message || '')) {
      await db().storage.createBucket('posters', { public: true });
      r = await bucket().upload(name, buf, opts);
    }
    if (r.error) throw new HttpError(500, 'Upload failed: ' + r.error.message);
    const url = bucket().getPublicUrl(name).data.publicUrl;
    await log('POSTER_UPLOADED', name + ' (' + Math.round(buf.length / 1024) + ' KB)');
    return { url };
  },

  async changePin(b) {
    await getSettings(); // make sure the settings row exists
    await auth.changePin(b.current, b.next);
    await log('PIN_CHANGED', 'Admin PIN changed');
    return { message: 'PIN changed. Please log in again with the new PIN.' };
  }
};

module.exports = handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
  const b = body(req);
  if (b.action === 'login') {
    await getSettings();
    const token = await auth.login(String(b.pin || ''));
    await log('LOGIN', 'Admin logged in');
    return { ok: true, token };
  }
  await auth.requireAdmin(req);
  const fn = actions[b.action];
  if (!fn) throw new HttpError(400, 'Unknown action.');
  return Object.assign({ ok: true }, await fn(b));
});
