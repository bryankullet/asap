-- 0064 — a quotation term can be confirmed against its document before the quotation is linked
-- to an insurer's answer (D-138).
--
-- 0053 required every accepted or corrected proposal to point at a `quote_terms` row, and a
-- `quote_terms` row needs an insurer response. So a quotation uploaded on its own — the ordinary
-- case — could be read but never confirmed: the review screen had no controls to offer. A person's
-- decision about what a document says does not depend on which answer it is filed against.
--
-- What stays true: a rejected proposal still carries no term (0053), a decision still has a person
-- (0053), and a correction still has a value (0053). When the quotation is linked to an answer, the
-- API writes each confirmed term to `quote_terms` and records the link on the proposal.
alter table document_term_proposals
  drop constraint document_term_proposals_applied_has_a_term;

comment on column document_term_proposals.quote_term_id is
  'The confirmed term this became on an insurer answer. Null while the quotation is not yet linked '
  'to an answer, even when a person has accepted or corrected the reading (D-138).';
