import {
  SEARCH_HIT_LABELS,
  SEARCH_NOT_YET_SEARCHABLE,
  type SearchHitKind,
  type SearchResponse,
  type SpaceFilter,
  type SpaceFrame,
  type SpaceFrameBlock,
  type SpaceRef,
  type SpaceRow,
} from "@asap/schema";

/**
 * Search, as a Space.
 *
 * One `rows` block per kind, in a fixed order, each row opening the record's own Space at the
 * route the **server** named. The browser never composes a destination: a route built here is a
 * route that drifts from the one the API serves, and a result that goes nowhere is what makes
 * search feel like a lie.
 *
 * The kinds that cannot be searched yet are named rather than left out. An empty result for a
 * registration should say that vehicles are not recorded as their own records yet — not imply
 * that no such vehicle exists.
 */

/** The order results are shown in: the record a person most likely meant, first. */
const ORDER: SearchHitKind[] = [
  "client",
  "policy",
  "work",
  "claim",
  "document",
  "email",
  "insurer",
  "run",
];

/**
 * Which Space a hit opens as.
 *
 * The kind is part of the identity, not decoration: the same client opened as a client and as the
 * subject of a claim is two pieces of work, and one tab cannot be both.
 */
const SPACE_KIND: Readonly<Record<SearchHitKind, SpaceRef["spaceKind"]>> = {
  client: "client",
  policy: "policy",
  work: "work_item",
  claim: "claim",
  document: "document",
  email: "communication",
  insurer: "report",
  run: "activity",
};

const RECORD_TYPE: Readonly<Record<SearchHitKind, string>> = {
  client: "client",
  policy: "policy",
  work: "work_item",
  claim: "claim",
  document: "document",
  email: "email_thread",
  insurer: "insurer",
  run: "run",
};

export function searchSpace(
  query: string,
  response: SearchResponse | undefined,
  state: { typing: boolean; loading: boolean; error: string | null },
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "route",
    recordType: "search",
    recordId: null,
    workflowId: null,
    path: "/search",
    title: "Search",
    label: "SEARCH",
  };
  const results = response?.results ?? [];
  const base = {
    self,
    title: query.trim() === "" ? "Search everything" : `Results for “${query.trim()}”`,
    context:
      "Clients, policies, work, claims, documents, email, insurers and runs — everything your role can see, and nothing it cannot.",
    filters: [] as SpaceFilter[],
    related: [] as SpaceRef[],
    actions: [],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
  };

  if (state.error !== null) {
    return {
      ...base,
      status: { label: "Could not search", tone: "attention" },
      blocks: [],
      state: "error",
      degraded: [],
      emptyState: { heading: "We could not search.", body: state.error, actions: [] },
    };
  }

  /* Nothing typed is not an empty result, and must not read like one. */
  if (query.trim() === "") {
    return {
      ...base,
      status: { label: "Nothing typed", tone: "neutral" },
      blocks: [notYetSearchable()],
      state: "ready",
      degraded: [],
      emptyState: null,
    };
  }

  if (state.typing || state.loading || !response) {
    return {
      ...base,
      status: { label: "Searching", tone: "active" },
      blocks: [
        {
          id: "searching",
          type: "rows",
          label: "Across your records",
          rows: [],
          evidence: [],
          actions: [],
          state: "loading",
          stateNote: "Searching this brokerage's records.",
        },
      ],
      state: "ready",
      degraded: [],
      emptyState: null,
    };
  }

  if (results.length === 0) {
    return {
      ...base,
      status: { label: "0 results", tone: "waiting" },
      blocks: [notYetSearchable()],
      state: "ready",
      degraded: response.degraded,
      emptyState: null,
    };
  }

  const blocks: SpaceFrameBlock[] = ORDER.filter((kind) => results.some((r) => r.kind === kind)).map(
    (kind) => ({
      id: `hits-${kind}`,
      type: "rows" as const,
      label: `${SEARCH_HIT_LABELS[kind]}${countOf(results, kind) === 1 ? "" : "s"}`,
      rows: results.filter((r) => r.kind === kind).map(rowFor),
      evidence: [],
      actions: [],
      state: "ready" as const,
      stateNote: null,
    }),
  );
  blocks.push(notYetSearchable());

  return {
    ...base,
    status: {
      label: `${results.length} ${results.length === 1 ? "result" : "results"}`,
      tone: "active",
    },
    blocks,
    state: "ready",
    degraded: response.degraded,
    emptyState: null,
  };
}

const countOf = (results: SearchResponse["results"], kind: SearchHitKind) =>
  results.filter((r) => r.kind === kind).length;

function rowFor(hit: SearchResponse["results"][number]): SpaceRow {
  const ref: SpaceRef = {
    spaceKind: SPACE_KIND[hit.kind],
    recordType: RECORD_TYPE[hit.kind],
    recordId: hit.id,
    workflowId: null,
    /* The route the server named. Never one composed here. */
    path: hit.to,
    title: hit.title,
    label: SEARCH_HIT_LABELS[hit.kind].toUpperCase(),
  };
  return {
    id: `${hit.kind}-${hit.id}`,
    title: hit.title,
    note: hit.clientName === null ? hit.subtitle : `${hit.clientName} · ${hit.subtitle}`,
    badge: SEARCH_HIT_LABELS[hit.kind],
    badgeTone: "neutral",
    why: null,
    related: ref,
    actions: [
      {
        verb: "open",
        label: "Open →",
        to: ref,
        stepId: null,
        disabledReason: null,
        notPermittedReason: null,
      },
    ],
    evidence: [],
  };
}

/**
 * What a person may reasonably look for and cannot find yet.
 *
 * Shown under the results, always — including when there are none. Silence here is the difference
 * between "there is no such vehicle" and "vehicles are not on file yet", and only one of those is
 * true.
 */
function notYetSearchable(): SpaceFrameBlock {
  return {
    id: "not-yet-searchable",
    type: "missing",
    label: "NOT SEARCHABLE YET",
    items: SEARCH_NOT_YET_SEARCHABLE.map((n) => ({ text: `${n.what} — ${n.because}` })),
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}
