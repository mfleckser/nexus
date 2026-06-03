create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz default now(),
    updated_at timestamptz default now(),

    title text not null,
    description text not null,
    type text,
    status text,
    notes text,
    notes_updated_at timestamptz
);

create table if not exists features (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    project_id uuid not null,
    name text not null,
    notes text,
    notes_updated_at timestamptz,

    constraint features_project_id_fkey
    foreign key (project_id) references projects(id) on delete cascade
);

create or replace function set_notes_updated_at()
returns trigger as $$
begin
    if new.notes is distinct from old.notes then
        new.notes_updated_at := now();
    end if;

    return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
before update on projects
for each row
execute function set_updated_at();

create trigger projects_notes_updated_at
before update of notes on projects
for each row
execute function set_notes_updated_at();

create trigger features_updated_at
before update on features
for each row
execute function set_updated_at();

create trigger features_notes_updated_at
before update of notes on features
for each row
execute function set_notes_updated_at();

alter table tasks
    add constraint tasks_project_id_fkey
    foreign key (project_id) references projects(id) on delete set null;

alter table tasks
add feature_id uuid;

alter table tasks
    add constraint tasks_feature_id_fkey
    foreign key (feature_id) references features(id) on delete set null;

create index on tasks (project_id);
create index on tasks (feature_id);
create index on features (project_id);
