-- 033: offline sending (2.0). The app may choose a new message's id (a random UUID) so that a
-- message sent while the connection drops can be retried safely: if the first try reached the
-- server, the retry fails on the duplicate id instead of posting the message twice.
-- Ids are still unique (primary key) and every other rule (RLS, AutoMod, rate limits) applies.
grant insert (id) on public.messages to authenticated;
