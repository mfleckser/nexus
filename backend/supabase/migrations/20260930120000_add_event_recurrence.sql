-- Recurring events.
--   master row:   rrule is not null. start_at/end_at = first occurrence.
--   override row: recurring_event_id + original_start_at set; a concrete,
--                 modified copy of one occurrence of its master.
alter table events
    add column rrule text,
    add column recurrence_end_at timestamptz,
    add column exdates timestamptz[] not null default '{}',
    add column recurring_event_id uuid references events(id) on delete cascade,
    add column original_start_at timestamptz;

alter table events
    add constraint events_override_pair_check
        check ((recurring_event_id is null) = (original_start_at is null)),
    add constraint events_master_not_override_check
        check (not (rrule is not null and recurring_event_id is not null)),
    -- The unique index also serves lookups by recurring_event_id (leading column).
    add constraint events_override_unique
        unique (recurring_event_id, original_start_at);

create index if not exists events_masters_start_at_idx
    on events (start_at) where rrule is not null;
