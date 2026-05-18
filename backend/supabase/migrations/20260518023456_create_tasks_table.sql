create table if not exists tasks (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz default now(),
    updated_at timestamptz default now(),

    title text not null,
    description text,
    status text default 'todo',
    due_at timestamptz,
    completed_at timestamptz,
    project_id uuid,
    event_id uuid,

    constraint status_check
        check (status in ('todo', 'active', 'complete', 'cancelled'))
);

create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger tasks_updated_at
before update on tasks
for each row
execute function set_updated_at();