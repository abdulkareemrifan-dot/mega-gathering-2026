const crypto = require('crypto');
const { db } = require('./db');
const { HttpError, check } = require('./util');

const TOKEN_HOURS = 8;

function secret(pinHash) {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, 'Server is not configured yet: set SESSION_SECRET (at least 16 characters) in Vercel.');
  // Including the PIN hash means every old login stops working after a PIN change.
  return s + '|' + (pinHash || 'env');
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return salt + ':' + hash;
}

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function pinMatches(pin, stored) {
  if (stored) {
    const [salt, hash] = stored.split(':');
    return same(crypto.scryptSync(String(pin), salt, 32).toString('hex'), hash);
  }
  const envPin = process.env.ADMIN_PIN;
  if (!envPin) throw new HttpError(500, 'Server is not configured yet: set ADMIN_PIN in Vercel.');
  return same(String(pin), envPin);
}

async function storedPinHash() {
  const row = check(await db().from('app_settings').select('admin_pin_hash').eq('id', 1).maybeSingle());
  return row ? row.admin_pin_hash : null;
}

function sign(payload, key) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(data).digest('base64url');
  return data + '.' + sig;
}

async function login(pin) {
  const stored = await storedPinHash();
  if (!pin || !pinMatches(pin, stored)) {
    await new Promise(r => setTimeout(r, 800)); // slow down guessing
    throw new HttpError(401, 'Incorrect admin PIN.');
  }
  return sign({ role: 'admin', exp: Date.now() + TOKEN_HOURS * 3600e3 }, secret(stored));
}

async function requireAdmin(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [data, sig] = token.split('.');
  if (!data || !sig) throw new HttpError(401, 'Please log in again.');
  const stored = await storedPinHash();
  const expected = crypto.createHmac('sha256', secret(stored)).update(data).digest('base64url');
  if (!same(sig, expected)) throw new HttpError(401, 'Session expired. Please log in again.');
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  if (!payload.exp || payload.exp < Date.now()) throw new HttpError(401, 'Session expired. Please log in again.');
  return payload;
}

async function changePin(current, next) {
  const stored = await storedPinHash();
  if (!pinMatches(current, stored)) throw new HttpError(400, 'Current PIN is incorrect.');
  if (!/^\d{6,12}$/.test(String(next || ''))) throw new HttpError(400, 'New PIN must be 6 to 12 digits.');
  check(await db().from('app_settings').update({ admin_pin_hash: hashPin(next) }).eq('id', 1));
}

module.exports = { login, requireAdmin, changePin };
