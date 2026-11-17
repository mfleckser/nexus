-- "blocked": the task needs Mark's attention before work can continue.
alter table tasks drop constraint status_check;
alter table tasks add constraint status_check
    check (status in ('todo', 'active', 'blocked', 'complete', 'cancelled'));
