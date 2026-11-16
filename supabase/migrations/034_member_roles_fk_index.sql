-- 034: cover the composite foreign key member_roles (role_id, server_id) -> roles, so deleting or
-- changing a role doesn't scan member_roles (flagged by the database advisor). The new index starts
-- with role_id, so it also replaces the single-column one.
create index if not exists member_roles_role_server_idx on public.member_roles (role_id, server_id);
drop index if exists public.member_roles_role_idx;
