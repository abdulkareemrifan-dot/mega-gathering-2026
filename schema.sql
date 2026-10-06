-- =====================================================================
-- MEGA YOUTH & FAMILY GATHERING 2026 – Supabase database setup
-- Run this whole file ONCE in Supabase → SQL Editor → New query → Run.
-- It is safe to run again (it only creates what is missing / replaces functions).
-- =====================================================================

-- ---------- Tables ----------
create table if not exists public.app_settings (
  id             int primary key default 1 check (id = 1),
  data           jsonb not null default '{}'::jsonb,   -- poster text, fees, seats ...
  admin_pin_hash text,                                 -- set when admin changes PIN
  updated_at     timestamptz not null default now()
);

create sequence if not exists public.registration_seq;

create table if not exists public.registrations (
  id                 bigint generated always as identity primary key,
  registration_id    text unique not null
                     default ('MYG26-' || lpad(nextval('public.registration_seq')::text, 5, '0')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  main_name          text not null,
  nationality        text,
  gender             text,
  age_group          text,
  mobile             text not null,
  email              text,
  participants       jsonb not null default '[]'::jsonb,  -- additional participants
  fee_breakdown      jsonb not null default '[]'::jsonb,
  total_participants int  not null,
  total_amount       numeric(10,2) not null default 0,
  payment_method     text not null default 'Cash',
  payment_status     text not null default 'Payment Pending'
                     check (payment_status in ('Payment Pending','Paid','Cancelled')),
  seat_status        text not null default 'Reserved'
                     check (seat_status in ('Reserved','Confirmed','Waiting','Released')),
  checked_in_at      timestamptz,
  admin_note         text
);

create index if not exists registrations_mobile_idx on public.registrations (mobile);
create index if not exists registrations_created_idx on public.registrations (created_at);

create table if not exists public.admin_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor      text not null default 'ADMIN',
  action     text not null,
  details    text
);

-- Public storage bucket for the uploaded poster image (created automatically on first upload too)
insert into storage.buckets (id, name, public)
values ('posters', 'posters', true)
on conflict (id) do nothing;

-- ---------- Security: nobody can read/write directly from the browser ----------
-- Row Level Security ON with no policies = the public "anon" key has zero access.
-- Only the Vercel API (using the secret service_role key) can touch the data.
alter table public.app_settings  enable row level security;
alter table public.registrations enable row level security;
alter table public.admin_log     enable row level security;
revoke all on public.app_settings, public.registrations, public.admin_log from anon, authenticated;

-- ---------- Seat availability ----------
create or replace function public.get_availability()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'totalSeats',    coalesce((select nullif(data->>'totalSeats','')::int from app_settings where id = 1), 0),
    'reserved',      coalesce(sum(total_participants) filter (where seat_status in ('Reserved','Confirmed')), 0),
    'confirmed',     coalesce(sum(total_participants) filter (where seat_status = 'Confirmed'), 0),
    'waiting',       coalesce(sum(total_participants) filter (where seat_status = 'Waiting'), 0),
    'registrations', count(*) filter (where seat_status <> 'Released'),
    'checkedIn',     coalesce(sum(total_participants) filter (where checked_in_at is not null), 0),
    'paidAmount',    coalesce(sum(total_amount) filter (where payment_status = 'Paid'), 0),
    'pendingAmount', coalesce(sum(total_amount) filter (where payment_status = 'Payment Pending' and seat_status <> 'Released'), 0)
  ) from registrations;
$$;

-- ---------- Create a registration (atomic: no double-booking of seats) ----------
create or replace function public.create_registration(p jsonb)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  s jsonb; v_fees jsonb; v_people jsonb; v_breakdown jsonb := '[]'::jsonb;
  v_total int; v_amount numeric := 0; v_reserved int; v_seats int; v_status text;
  v_existing text; person jsonb; i int := 0; fee numeric; r public.registrations;
begin
  -- one registration at a time → first come, first served
  perform pg_advisory_xact_lock(20261106);

  select data into s from app_settings where id = 1;
  if s is null then raise exception 'Event settings are missing. Please contact the organiser.'; end if;
  if coalesce((s->>'registrationOpen')::boolean, true) is false then
    raise exception 'Registration is currently closed.';
  end if;

  select registration_id into v_existing from registrations
   where mobile = p->>'mobile' and seat_status <> 'Released' limit 1;
  if v_existing is not null then
    raise exception 'This mobile number is already registered (ID %). Use "Check Registration" to view it.', v_existing;
  end if;

  v_fees   := coalesce(s->'fees', '{}'::jsonb);
  v_people := jsonb_build_array(jsonb_build_object('relation','Main Participant','ageGroup', p->>'age_group'))
              || coalesce(p->'participants', '[]'::jsonb);
  v_total  := jsonb_array_length(v_people);

  for person in select value from jsonb_array_elements(v_people) loop
    i := i + 1;
    fee := coalesce(nullif(v_fees->>(person->>'ageGroup'), '')::numeric, 0);
    v_amount := v_amount + fee;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object('no', i, 'ageGroup', person->>'ageGroup', 'amount', fee));
  end loop;

  select coalesce(sum(total_participants), 0) into v_reserved
    from registrations where seat_status in ('Reserved','Confirmed');
  v_seats  := coalesce(nullif(s->>'totalSeats','')::int, 0);
  v_status := case when v_reserved + v_total <= v_seats then 'Reserved' else 'Waiting' end;

  insert into registrations (main_name, nationality, gender, age_group, mobile, email,
                             participants, fee_breakdown, total_participants, total_amount, seat_status)
  values (p->>'main_name', p->>'nationality', p->>'gender', p->>'age_group', p->>'mobile', p->>'email',
          coalesce(p->'participants','[]'::jsonb), v_breakdown, v_total, v_amount, v_status)
  returning * into r;

  insert into admin_log (actor, action, details)
  values ('SYSTEM', case when v_status = 'Reserved' then 'NEW_REGISTRATION' else 'WAITING_LIST' end,
          r.registration_id || ' – ' || v_total || ' participant(s), SAR ' || v_amount);
  return r;
end $$;

-- ---------- Move waiting-list registrations into freed seats (oldest first) ----------
create or replace function public.promote_waitlist()
returns int language plpgsql security definer set search_path = public as $$
declare v_seats int; v_reserved int; rec record; n int := 0;
begin
  perform pg_advisory_xact_lock(20261106);
  select coalesce(nullif(data->>'totalSeats','')::int, 0) into v_seats from app_settings where id = 1;
  select coalesce(sum(total_participants), 0) into v_reserved
    from registrations where seat_status in ('Reserved','Confirmed');
  for rec in select id, registration_id, total_participants from registrations
              where seat_status = 'Waiting' order by created_at loop
    if v_reserved + rec.total_participants <= v_seats then
      update registrations set seat_status = 'Reserved', updated_at = now() where id = rec.id;
      v_reserved := v_reserved + rec.total_participants;
      n := n + 1;
      insert into admin_log (actor, action, details)
      values ('SYSTEM', 'WAITING_LIST_PROMOTED', rec.registration_id || ' moved from waiting list to reserved');
    end if;
  end loop;
  return n;
end $$;

-- Only the server (service_role) may call these functions.
revoke all on function public.get_availability()         from public, anon, authenticated;
revoke all on function public.create_registration(jsonb) from public, anon, authenticated;
revoke all on function public.promote_waitlist()         from public, anon, authenticated;
grant execute on function public.get_availability()         to service_role;
grant execute on function public.create_registration(jsonb) to service_role;
grant execute on function public.promote_waitlist()         to service_role;
