-- Atomic multi-row event writes. A recurring edit (this / following / all)
-- touches a master, its overrides and maybe a split-off series; the backend
-- computes every row change and sends them here in one call. PostgREST runs an
-- RPC in a single transaction, so the edit lands whole or not at all.

-- Shifting a series moves every override's original_start_at by the same
-- amount, which can collide transiently (e.g. +1 week onto the next override's
-- old slot). Deferrable lets apply_event_writes check uniqueness at commit;
-- plain statements still check immediately.
alter table events
    drop constraint events_override_unique,
    add constraint events_override_unique
        unique (recurring_event_id, original_start_at) deferrable initially immediate;

-- ops: JSON array, applied in order:
--   {"op": "insert", "row": {col: value, ...}}        omitted columns take their defaults
--   {"op": "update", "id": uuid, "set": {col: value}}  fails if no such row
--   {"op": "delete", "id": uuid}
--   {"op": "delete_overrides", "master": uuid, "from": ts?, "at": ts?}
--       a master's overrides, optionally only original_start_at >= from / = at
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
begin
    if jsonb_typeof(ops) is distinct from 'array' then
        raise exception 'ops must be a JSON array' using errcode = '22023';
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
