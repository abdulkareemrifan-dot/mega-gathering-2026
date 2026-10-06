const { db } = require('./db');
const { check, str } = require('./util');

const AGE_GROUPS = ['Infant', 'Child', 'Teenager', 'Adult', 'Senior'];

// Everything the poster and the form show. All of it is editable in Admin → Event & Poster.
const DEFAULTS = {
  posterStyle: 'classic',   // 'image' (your uploaded poster), 'classic' (light, sectioned) or 'modern' (dark)
  posterImageUrl: '',       // set by Admin → Upload poster image
  qrPosition: 'band',       // band | bottom-right | bottom-left | top-right
  community: 'JEDDAH COMMUNITY GROUP',
  titleTop: 'MEGA YOUTH & FAMILY',
  titleMain: 'GATHERING 2026',
  date: 'Friday, 06 November 2026',
  time: '10:00 AM – 11:00 PM',
  venue: 'Best Patch – Hello Hill Istaraha',
  tagline: 'COME TOGETHER • LEARN TOGETHER • PLAY TOGETHER • GROW TOGETHER',
  motto: 'ONE COMMUNITY • ONE FAMILY • ONE FUTURE',
  // Classic poster: three programme columns
  sections: [
    { icon: '🕌', title: 'SPIRITUAL & EDUCATIONAL', items: ['Qur’an Recitation & Du’a', 'Islamic Reminder / Bayan', 'Youth Guidance Programs',
      'Youth Development Seminars', 'Islamic Quiz & Q&A', 'Character Building & Leadership', 'Family & Parenting Guidance'] },
    { icon: '⚽', title: 'SPORTS & FUN', items: ['Football ⚽', 'Volleyball 🏐', 'Swimming 🏊', 'Badminton 🏸', 'Team & Family Games',
      'Kids’ Games & Fun Activities', 'Competitions & Prizes 🏆'] },
    { icon: '🎤', title: 'ENTERTAINMENT', items: ['Cultural Programs', 'Youth Presentations', 'Stage Entertainment',
      'Quiz & Fun Challenges', 'Lucky Draw & Prize Distribution 🎁'] }
  ],
  foodTitle: 'FOOD & REFRESHMENTS',
  foodIcons: '🍛 🍗 🥘 🫖 🥟 🧃',
  aimTitle: 'OUR AIM',
  aimText: 'Bringing our community together through faith, learning, friendship, culture and sports – building strong family bonds and inspiring our youth.',
  seatsNote: 'Registration will be accepted on a First Come, First Served basis.',
  linkLabel: 'REGISTER NOW USING THE LINK BELOW:',
  warningLine: '⚠️ Seats are limited, so please register early to secure your place.',
  activitiesTitle: 'PROGRAMME HIGHLIGHTS',
  activities: [
    '🕌 Qur’an Recitation & Du’a',
    '🕌 Islamic Reminder / Bayan',
    '🌟 Youth Guidance & Development',
    '📚 Educational Seminars',
    '🧠 Islamic Quiz & Q&A',
    '⚽ Football',
    '🏐 Volleyball',
    '🏊 Swimming',
    '🏸 Badminton',
    '🎯 Team & Family Games',
    '🏆 Competitions & Prizes',
    '🎤 Youth Presentations',
    '🎉 Stage Entertainment',
    '🎁 Lucky Draw',
    '🍽️ Food, Tea & Refreshments'
  ],
  seatsLine: 'LIMITED SEATS AVAILABLE!',
  seatsSub: 'FIRST COME • FIRST SERVED',
  buttonText: 'REGISTER NOW',
  qrCaption: '📱 Scan QR Code to Register',
  registerUrl: '',          // leave blank → uses <your-site>/register automatically
  contactLine: '',          // e.g. "Info: 05XXXXXXXX"
  showSeatsLeft: true,
  registrationOpen: true,
  totalSeats: 500,
  fees: { Infant: 0, Child: 10, Teenager: 10, Adult: 10, Senior: 10 },
  nationalities: ['Sri Lankan', 'Indian', 'Other'],
  whatsappGroupLink: '',
  paymentNote: 'Payment is CASH only and will be collected by the organisers. Your seats are reserved while payment is pending.'
};

function sanitize(input) {
  const s = Object.assign({}, DEFAULTS, input || {});
  const out = {};
  for (const k of ['community', 'titleTop', 'titleMain', 'date', 'time', 'venue', 'tagline', 'motto',
                   'activitiesTitle', 'seatsLine', 'seatsSub', 'buttonText', 'qrCaption', 'contactLine',
                   'foodTitle', 'foodIcons', 'aimTitle', 'seatsNote', 'linkLabel', 'warningLine']) {
    out[k] = str(s[k], 160);
  }
  out.posterStyle = ['image', 'modern'].includes(s.posterStyle) ? s.posterStyle : 'classic';
  out.posterImageUrl = /^https:\/\//i.test(str(s.posterImageUrl, 500)) ? str(s.posterImageUrl, 500) : '';
  out.qrPosition = ['band', 'bottom-right', 'bottom-left', 'top-right'].includes(s.qrPosition) ? s.qrPosition : 'band';
  out.aimText = str(s.aimText, 400);
  out.sections = (Array.isArray(s.sections) ? s.sections : []).slice(0, 3).map(x => ({
    icon: str(x && x.icon, 8),
    title: str(x && x.title, 40),
    items: (Array.isArray(x && x.items) ? x.items : String((x && x.items) || '').split('\n')).map(i => str(i, 60)).filter(Boolean).slice(0, 10)
  }));
  while (out.sections.length < 3) out.sections.push({ icon: '', title: '', items: [] });
  out.paymentNote = str(s.paymentNote, 600);
  out.registerUrl = /^https?:\/\//i.test(str(s.registerUrl, 300)) ? str(s.registerUrl, 300) : '';
  out.whatsappGroupLink = /^https?:\/\//i.test(str(s.whatsappGroupLink, 300)) ? str(s.whatsappGroupLink, 300) : '';
  out.activities = (Array.isArray(s.activities) ? s.activities : String(s.activities || '').split('\n'))
    .map(a => str(a, 80)).filter(Boolean).slice(0, 24);
  out.nationalities = (Array.isArray(s.nationalities) ? s.nationalities : String(s.nationalities || '').split(/[\n,]/))
    .map(a => str(a, 40)).filter(Boolean).slice(0, 20);
  if (!out.nationalities.length) out.nationalities = DEFAULTS.nationalities.slice();
  out.showSeatsLeft = s.showSeatsLeft !== false && s.showSeatsLeft !== 'false';
  out.registrationOpen = s.registrationOpen !== false && s.registrationOpen !== 'false';
  out.totalSeats = Math.max(0, Math.floor(Number(s.totalSeats) || 0));
  out.fees = {};
  AGE_GROUPS.forEach(a => { out.fees[a] = Math.max(0, Math.round((Number((s.fees || {})[a]) || 0) * 100) / 100); });
  return out;
}

async function getSettings() {
  const row = check(await db().from('app_settings').select('data').eq('id', 1).maybeSingle());
  if (!row) {
    const data = sanitize({});
    check(await db().from('app_settings').upsert({ id: 1, data }));
    return data;
  }
  return sanitize(row.data);
}

async function saveSettings(input) {
  const data = sanitize(input);
  check(await db().from('app_settings').upsert({ id: 1, data, updated_at: new Date().toISOString() }));
  return data;
}

async function getAvailability() {
  const a = check(await db().rpc('get_availability')) || {};
  a.available = Math.max(0, (a.totalSeats || 0) - (a.reserved || 0));
  return a;
}

async function log(action, details, actor = 'ADMIN') {
  await db().from('admin_log').insert({ actor, action, details: String(details || '').slice(0, 500) });
}

module.exports = { AGE_GROUPS, DEFAULTS, sanitize, getSettings, saveSettings, getAvailability, log };
