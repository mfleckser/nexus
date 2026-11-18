-- apply_event_writes gains a stale-write guard. The backend reads a series
-- (its exdates, its overrides), computes the edit and only then sends it here;
-- another writer (Studio, another process) can change those rows in between.
-- An update / delete op may now carry expect_updated_at, the updated_at the
-- backend read; if that row's updated_at differs (or the row is gone), the
-- whole call fails with SQLSTATE PT409 (PostgREST: HTTP 409) and nothing is
-- written. Rows are locked and checked before any op runs.
-- Same signature, grants and behaviour for every op without the key.

-- ops: JSON array, applied in order:
--   {"op": "insert", "row": {col: value, ...}}        omitted columns take their defaults
--   {"op": "update", "id": uuid, "set": {col: value}, "expect_updated_at": ts?}
--       fails if no such row
--   {"op": "delete", "id": uuid, "expect_updated_at": ts?}
--   {"op": "delete_overrides", "master": uuid, "from": ts?, "at": ts?}
--       a master's overrides, optionally only original_start_at >= from / = at
--   {"op": "relink_tasks", "from": uuid, "to": uuid}
--       tasks time-blocked on event `from` move to event `to`; run it after `to`
--       is inserted and before `from` is deleted (whose FK would unlink them)
-- Returns row result_id as it stands afterwards (nothing if null or deleted).
create or replace function public.apply_event_writes(ops jsonb, result_id uuid default null)
returns setof public.events
language plpgsql
set search_path = ''
as $$
declare
    op jsonb;
    cols text;
    n bigint;
    stale text;
begin
    if jsonb_typeof(ops) is distinct from 'array' then
        raise exception 'ops must be a JSON array' using errcode = '22023';
    end if;

    -- Stale-write guard, before anything is written: lock the expected rows,
    -- masters first (the order a cascading master delete locks them in, so the
    -- two can't deadlock), then fail the whole call if any is gone or changed.
    perform 1 from public.events e
    where e.id in (
        select (o->>'id')::uuid from jsonb_array_elements(ops) o
        where o->>'op' in ('update', 'delete') and o->>'id' is not null and o->>'expect_updated_at' is not null
    )
    order by e.recurring_event_id is not null, e.id
    for update;

    select o->>'id' into stale from jsonb_array_elements(ops) o
    where o->>'op' in ('update', 'delete') and o->>'id' is not null and o->>'expect_updated_at' is not null
        and not exists (
            select 1 from public.events e
            where e.id = (o->>'id')::uuid and e.updated_at = (o->>'expect_updated_at')::timestamptz
        )
    limit 1;
    if stale is not null then
        raise exception 'event % was changed elsewhere', stale using errcode = 'PT409';
    end if;

    set constraints public.events_override_unique deferred;

    for op in select value from jsonb_array_elements(ops) loop
        if op->>'op' in ('insert', 'update') and (
            jsonb_typeof(coalesce(op->'row', op->'set')) is distinct from 'object'
            or coalesce(op->'row', op->'set') = '{}'::jsonb
        ) then
            raise exception '% needs a non-empty object of columns', op->>'op' using errcode = '22023';
        end if;

        case op->>'op'
        when 'insert' then
            select string_agg(format('%I', key), ', ') into cols from jsonb_object_keys(op->'row') as key;
            execute format(
                'insert into public.events (%1$s) select %1$s from jsonb_populate_record(null::public.events, $1)',
                cols
            ) using op->'row';

        when 'update' then
            select string_agg(format('%1$I = r.%1$I', key), ', ') into cols from jsonb_object_keys(op->'set') as key;
            execute format(
                'update public.events e set %s from jsonb_populate_record(null::public.events, $1) r where e.id = $2',
                cols
            ) using op->'set', (op->>'id')::uuid;
            get diagnostics n = row_count;
            if n = 0 then
                raise exception 'event % not found', op->>'id' using errcode = 'P0002';
            end if;

        when 'delete' then
            delete from public.events where id = (op->>'id')::uuid;

        when 'delete_overrides' then
            delete from public.events
            where recurring_event_id = (op->>'master')::uuid
                and (op->>'from' is null or original_start_at >= (op->>'from')::timestamptz)
                and (op->>'at' is null or original_start_at = (op->>'at')::timestamptz);

        when 'relink_tasks' then
            if op->>'from' is null or op->>'to' is null then
                raise exception 'relink_tasks needs from and to' using errcode = '22023';
            end if;
            update public.tasks set event_id = (op->>'to')::uuid where event_id = (op->>'from')::uuid;

        else
            raise exception 'unknown op: %', op->>'op' using errcode = '22023';
        end case;
    end loop;

    -- Surface a duplicate override slot here, as a normal error, not at commit.
    set constraints public.events_override_unique immediate;

    return query select * from public.events where id = result_id;
end;
$$;

-- Backend only (secret key = service_role); clients never call the Data API.
revoke execute on function public.apply_event_writes(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.apply_event_writes(jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
