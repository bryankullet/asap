-- 0027 — Pin search_path on the clients trigger function (advisor function_search_path_mutable, 0026).
alter function app.clients_land_not_started() set search_path = public, pg_temp;
