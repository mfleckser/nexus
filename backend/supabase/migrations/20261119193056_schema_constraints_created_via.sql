-- Constraints matching the API's checks (app/validation.py and the services'
-- _validate), so a writer that skips them (Studio, a future client) can't store
-- rows the app can't handle. Rows that would fail are backfilled first.
-- Titles: a string with something other than whitespace (check_title).

-- ---- backfill --------------------------------------------------------------

update tasks set created_at = coalesce(updated_at, now()) where created_at is null;
update tasks set updated_at = created_at where updated_at is null;
update tasks set status = 'todo' where status is null;
update tasks set title = '(untitled)' where title !~ '\S';

update events set created_at = coalesce(updated_at, now()) where created_at is null;
update events set updated_at = created_at where updated_at is null;
update events set title = '(untitled)' where title !~ '\S';
-- An all-day row keeps its midnight end; a timed one gets an hour.
update events
set end_at = start_at + case when all_day then interval '1 day' else interval '1 hour' end
where end_at <= start_at;

update projects set created_at = coalesce(updated_at, now()) where created_at is null;
update projects set updated_at = created_at where updated_at is null;
update projects set title = '(untitled)' where title !~ '\S';
update projects set type = null where type = '';
update projects set type = 'other' where type not in ('coding', 'learning', 'fitness', 'other');
update projects set status = null where status = '';
update projects set status = 'active' where status not in ('planning', 'active', 'paused', 'complete', 'archived');

update features set created_at = coalesce(updated_at, now()) where created_at is null;
update features set updated_at = created_at where updated_at is null;
update features set name = '(untitled)' where name !~ '\S';

-- ---- constraints -----------------------------------------------------------

alter table tasks
    alter column created_at set not null,
    alter column updated_at set not null,
    alter column status set not null,
    add constraint tasks_title_check check (title ~ '\S');

alter table events
    alter column created_at set not null,
    alter column updated_at set not null,
    add constraint events_title_check check (title ~ '\S'),
    add constraint events_end_after_start_check check (end_at > start_at);

-- type / status stay nullable: "" from the project form means none.
alter table projects
    alter column created_at set not null,
    alter column updated_at set not null,
    add constraint projects_title_check check (title ~ '\S'),
    add constraint projects_type_check check (type in ('coding', 'learning', 'fitness', 'other')),
    add constraint projects_status_check
        check (status in ('planning', 'active', 'paused', 'complete', 'archived'));

alter table features
    alter column created_at set not null,
    alter column updated_at set not null,
    add constraint features_name_check check (name ~ '\S');

-- ---- created_via -------------------------------------------------------------
-- The client that created the row, from the request's X-Nexus-Client header.
-- NULL: created before this column, or by a client that didn't say.

alter table tasks
    add column created_via text,
    add constraint tasks_created_via_check check (created_via in ('desktop', 'mobile', 'agent'));
alter table events
    add column created_via text,
    add constraint events_created_via_check check (created_via in ('desktop', 'mobile', 'agent'));
alter table projects
    add column created_via text,
    add constraint projects_created_via_check check (created_via in ('desktop', 'mobile', 'agent'));
alter table features
    add column created_via text,
    add constraint features_created_via_check check (created_via in ('desktop', 'mobile', 'agent'));

notify pgrst, 'reload schema';
