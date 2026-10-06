class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Wraps an API handler: JSON in, JSON out, friendly errors.
function handler(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.status(200).json(out ?? { ok: true });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      res.status(status).json({ ok: false, error: err.message || 'Unexpected error' });
    }
  };
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

function str(v, max = 200) { return String(v ?? '').trim().slice(0, max); }

function normalizeMobile(v) {
  let s = String(v ?? '').replace(/\D/g, '');
  if (s.startsWith('966') && s.length === 12) s = '0' + s.slice(3);
  if (s.length === 9 && s.startsWith('5')) s = '0' + s;
  return s;
}

function extractRegId(v) {
  const m = String(v ?? '').toUpperCase().match(/MYG26-\d{1,6}/);
  return m ? m[0] : '';
}

// Throws the Supabase error as a readable message.
function check({ data, error }) {
  if (error) {
    const msg = error.message || 'Database error';
    // Messages raised by our own SQL functions are meant for the user.
    throw new HttpError(error.code === 'P0001' ? 400 : 500, msg);
  }
  return data;
}

function ticketStatus(r) {
  if (r.seat_status === 'Released') return 'Cancelled';
  if (r.payment_status === 'Paid' && r.seat_status === 'Confirmed') return 'Valid';
  return 'Not Valid';
}

function registrationStatus(r) {
  if (r.seat_status === 'Released') return 'Cancelled';
  if (r.seat_status === 'Waiting') return 'Waiting List';
  if (r.seat_status === 'Confirmed') return 'Confirmed & Paid';
  return 'Seat Reserved – Payment Pending';
}

function toClient(r, { full = false } = {}) {
  const out = {
    registrationId: r.registration_id,
    createdAt: r.created_at,
    mainName: r.main_name,
    nationality: r.nationality,
    gender: r.gender,
    ageGroup: r.age_group,
    mobile: r.mobile,
    participants: r.participants || [],
    totalParticipants: r.total_participants,
    totalAmount: Number(r.total_amount || 0),
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    seatStatus: r.seat_status,
    registrationStatus: registrationStatus(r),
    ticketStatus: ticketStatus(r),
    checkedInAt: r.checked_in_at
  };
  if (full) {
    out.email = r.email;
    out.feeBreakdown = r.fee_breakdown || [];
    out.adminNote = r.admin_note || '';
    out.updatedAt = r.updated_at;
  } else {
    out.mobile = r.mobile ? r.mobile.slice(0, 3) + '****' + r.mobile.slice(-3) : '';
  }
  return out;
}

module.exports = { HttpError, handler, body, str, normalizeMobile, extractRegId, check, toClient, ticketStatus };
