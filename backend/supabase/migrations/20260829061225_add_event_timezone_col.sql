alter table events
add timezone text not null default 'UTC';

create index if not exists events_start_at_idx on events (start_at);
