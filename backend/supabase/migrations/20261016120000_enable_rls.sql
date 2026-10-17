-- Close the Data API to the publishable (anon) key: RLS on with no policies
-- means anon/authenticated roles see and change nothing. The backend uses the
-- secret key, which bypasses RLS; clients only talk to the Flask API.
alter table tasks enable row level security;
alter table events enable row level security;
alter table projects enable row level security;
alter table features enable row level security;
