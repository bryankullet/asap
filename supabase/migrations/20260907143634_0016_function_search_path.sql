-- 0016 — Work item 5b: pin search_path on the two non-definer helper functions
--
-- app.worker_org() and app.can_access() run with the caller's search_path (advisor:
-- function_search_path_mutable). Both reference only pg_catalog builtins and schema-qualified
-- app.* functions, so an empty search_path is correct and removes the hijack surface.
alter function app.worker_org() set search_path = '';
alter function app.can_access(uuid) set search_path = '';
