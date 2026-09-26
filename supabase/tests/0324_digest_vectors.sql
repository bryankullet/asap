-- pgTAP: the digest functions produce exactly these values, for exactly these inputs.
--
-- The API computes the same three digests in TypeScript (0049, 0050). If the two implementations
-- ever disagree, an approval fails its check constraint and every comparison is born stale — and
-- both failures would look like something else entirely. So the agreement is pinned as fixed
-- vectors, asserted here against the database and in `apps/api/test/digest-vectors.test.ts`
-- against the TypeScript. Neither side can drift without one of the two suites going red.
--
-- Changing a vector is changing the wire format. It is allowed, but it invalidates every stored
-- digest, so it needs a migration that recomputes them — not an edited constant.
begin;
select plan(3);

select is(app.quote_request_digest('Quotation request', 'Body one'),
  '9921624dbd579974c0904a36767a2a94d4233c5d8c01b1acb8b900d31ec40d76',
  'the quotation-request digest is stable');

/*
 * Cast, deliberately. `premium_amount` is numeric(14,2), so the text the digest sees is
 * "5310000.00" — an untyped literal would hash "5310000" and agree with nothing real. This is
 * the one place that scale is written down.
 */
select is(app.insurer_response_digest('quoted', 5310000::numeric(14,2), 'KES', '2027-01-31'),
  '0871f7dca71ecf2d67cd2d198dd745116f80db6abf0429051323441784f8dc3b',
  'the insurer-response digest is stable');

select is(app.quote_term_digest('excess', 'Own damage', '5% min 30,000', null, null, null, false),
  '5122fa7c612d5acb582db6e3daf80c83129e1a56cabbeb5f6d96d4bc2d9141b0',
  'the quote-term digest is stable');

select * from finish();
rollback;
