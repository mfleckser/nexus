create table if not exists events (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz default now(),
    updated_at timestamptz default now(),

    title text not null,
    description text,
    start_at timestamptz not null,
    end_at timestamptz not null,
    all_day boolean
);

create trigger events_updated_at
before update on events
for each row
execute function set_updated_at();

alter table tasks
    add constraint tasks_event_id_fkey
    foreign key (event_id) references events(id) on delete set null;

create index on tasks (event_id);