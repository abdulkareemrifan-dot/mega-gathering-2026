// POST /api/register → saves a family registration
const { db } = require('../lib/db');
const { handler, HttpError, body, str, normalizeMobile, check, toClient } = require('../lib/util');
const { AGE_GROUPS, getSettings, getAvailability } = require('../lib/settings');

const GENDERS = ['Male', 'Female'];
const RELATIONS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Grandfather',
  'Grandmother', 'Uncle', 'Aunt', 'Cousin', 'Relative', 'Friend', 'Other'];
const MAX_EXTRA = 30;

module.exports = handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
  const b = body(req);
  if (b.website) throw new HttpError(400, 'Invalid submission.'); // hidden honeypot field for bots

  const settings = await getSettings();
  if (!settings.registrationOpen) throw new HttpError(400, 'Registration is currently closed.');

  const name = str(b.mainName, 120);
  const nationality = str(b.nationality, 40);
  const gender = str(b.gender, 10);
  const ageGroup = str(b.ageGroup, 20);
  const mobile = normalizeMobile(b.mobile);
  const email = str(b.email, 160).toLowerCase();

  if (name.length < 2) throw new HttpError(400, 'Please enter the main participant name.');
  if (!settings.nationalities.includes(nationality)) throw new HttpError(400, 'Please select nationality.');
  if (!GENDERS.includes(gender)) throw new HttpError(400, 'Please select gender.');
  if (!AGE_GROUPS.includes(ageGroup)) throw new HttpError(400, 'Please select the age group.');
  if (!/^0\d{9}$/.test(mobile)) throw new HttpError(400, 'Mobile number must be 10 digits and start with 0 (e.g. 05XXXXXXXX).');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (b.cashConfirmed !== true) throw new HttpError(400, 'Please confirm the cash payment.');

  const extra = Array.isArray(b.participants) ? b.participants : [];
  if (extra.length > MAX_EXTRA) throw new HttpError(400, 'Maximum ' + MAX_EXTRA + ' additional participants per registration.');
  const participants = extra.map((p, i) => {
    const row = {
      name: str(p.name, 120),
      relation: str(p.relation, 30),
      gender: str(p.gender, 10),
      ageGroup: str(p.ageGroup, 20)
    };
    if (!RELATIONS.includes(row.relation)) throw new HttpError(400, 'Select a relation for participant ' + (i + 2) + '.');
    if (!GENDERS.includes(row.gender)) throw new HttpError(400, 'Select gender for participant ' + (i + 2) + '.');
    if (!AGE_GROUPS.includes(row.ageGroup)) throw new HttpError(400, 'Select age group for participant ' + (i + 2) + '.');
    return row;
  });

  const reg = check(await db().rpc('create_registration', {
    p: { main_name: name, nationality, gender, age_group: ageGroup, mobile, email: email || null, participants }
  }));
  const a = await getAvailability();
  return { ok: true, registration: toClient(reg), availability: { available: a.available } };
});
