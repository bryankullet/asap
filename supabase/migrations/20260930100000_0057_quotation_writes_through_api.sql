-- 0057 — Quotation and opportunity records: written through the API only.
--
-- 4B-4B closed the placement tables to direct browser writes (0056). The tables of 0048–0053 were
-- left open: a browser session holds the anon key and the person's JWT, and with the INSERT and
-- UPDATE grants those tables carry, it could write an opportunity, a quote, a term, a comparison, a
-- company rule or a reviewed proposal directly — skipping the API's permission checks, validation,
-- frozen digests, approval rules, idempotency, evidence requirements and audit.
--
-- The browser keeps SELECT, as RLS allows. Every insert, update or delete from `authenticated` or
-- `anon` now requires the server-held API key (the same gate as 0056). The worker role, the
-- internal service-role dispatcher and owner sessions are not browser sessions and are unaffected.
--
-- Classification (documented, and asserted in pgTAP 0330):
--
--   mutable only through a controlled API action
--     requirement_templates, opportunities, opportunity_requirements, opportunity_insurers,
--     quote_requests, insurer_responses, quote_terms, quote_comparisons, company_rules,
--     document_term_proposals
--   append-only through a controlled API action (no UPDATE a person may make; a trigger may
--   supersede)
--     quote_request_approvals, quote_comparison_inputs, quote_comparison_terms,
--     company_rule_versions
--   engine-owned: written only by triggers, inside an API-gated write
--     insurer_response_revisions, quote_term_revisions
--
-- None is browser-writable. None may be deleted by anyone but an owner session (no DELETE grant
-- exists; the gate refuses a delete too, so a future grant cannot quietly reopen it).

do $$
declare t text;
begin
  foreach t in array array[
    'requirement_templates','opportunities','opportunity_requirements','opportunity_insurers',
    'quote_requests','insurer_responses','quote_terms','quote_request_approvals',
    'quote_comparisons','quote_comparison_inputs','quote_comparison_terms',
    'insurer_response_revisions','quote_term_revisions','company_rules','company_rule_versions',
    'document_term_proposals']
  loop
    /*
     * Named to sort first: triggers fire in name order, and the gate must refuse a browser write
     * before any validation trigger answers it with a different reason.
     */
    execute format(
      'create trigger "000_through_api" before insert or update or delete on %I for each row execute function app.placement_writes_through_api()',
      t);
  end loop;
end $$;

comment on function app.placement_writes_through_api() is
  'Refuses a write from authenticated or anon without the server-held API key. Guards the placement tables (0056) and the quotation tables (0057).';
