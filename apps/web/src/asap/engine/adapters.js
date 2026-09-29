// ============================================================================
// PRODUCTION BOUNDARY
// Every external dependency of ASAP passes through this file. The UI and the
// intent layer never talk to a network, a mailbox or a model directly.
//
// In this build all adapters are local fakes over the normalized record store
// (asap-store.js) with durable browser storage. To go to production, replace
// the bodies below — no UI change is required.
//
// Required in production (none of these exist in browser code here, by design):
//   RECORDS_API_BASE_URL     brokerage record service (clients, policies, work…)
//   DOCUMENTS_API_BASE_URL   document storage + extraction service
//   MAIL_API_BASE_URL        connected-mailbox service (OAuth server side)
//   ASAP_AI_ENDPOINT         server-side model endpoint that exposes ONLY the
//                            controlled ASAP tools below. The model must never
//                            write records directly and no API key may ever be
//                            present in browser code.
// ============================================================================
import * as S from './store.js';
import { interpret, buildWorkspace, parseDate } from './intent.js';

/** Persistence — durable browser storage today, server session in production. */
export const persistence = {
  init: () => S.init(),
  reset: () => S.resetDb(),
  resetSummary: () => S.resetSummary(),
  snapshot: () => S.getDb()
};

/** Records — normalized store. Swap for RECORDS_API_BASE_URL. */
export const records = {
  sel: S.sel, all: S.all, byId: S.byId, where: S.where,
  /** The single mutation entry point. `actionId` makes every write idempotent. */
  act: (type, payload, actionId) => S.dispatch(type, payload, actionId),
  can: S.can, roles: S.ROLES, approverFor: S.approverFor,
  session: S.session, actor: S.actor, setUser: S.setUser
};

/** Documents — real local file reads today; DOCUMENTS_API_BASE_URL in production. */
export const documents = {
  /** Reads a real File from the user's device and returns extractable text lines. */
  async read(file) {
    const isText = /csv|text|json|xml/.test(file.type) || /\.(csv|txt|json)$/i.test(file.name);
    let lines;
    if (isText) {
      const text = await file.text();
      lines = text.split(/\r?\n/).filter(Boolean).slice(0, 12);
    } else {
      lines = ['Binary file read from your device: ' + file.name,
        'Type: ' + (file.type || 'unknown') + ' · Size: ' + Math.round(file.size / 1024) + ' KB',
        'No extraction service is configured, so ASAP shows the file as evidence without claiming extracted values.'];
    }
    return { name: file.name, kind: (file.type || 'file') + ' · ' + Math.round(file.size / 1024) + ' KB',
      bytes: file.size, lines, extracted: isText ? lines.length + ' rows read' : 'stored without extraction' };
  },
  classify(file) {
    const n = file.name.toLowerCase();
    if (/\.(xlsx|xls|csv)$/.test(n)) return 'Spreadsheet';
    if (/\.pdf$/.test(n)) return 'PDF';
    if (/\.(png|jpe?g|heic)$/.test(n)) return 'Image';
    if (/\.eml$/.test(n)) return 'Email';
    return 'File';
  }
};

/** Email — sending always originates from a human click in the UI. */
export const email = {
  connected: () => S.sel.connections().some(c => c.kind === 'Gmail' && c.status === 'connected'),
  /** Fails honestly when the connection is not live, so retry states are real. */
  async send(payload, actionId) {
    if (!this.connected()) return { ok: false, error: 'The mailbox connection is not live. The draft is saved — reconnect in Connections and retry.' };
    return S.dispatch('email.send', payload, actionId);
  }
};

/** AI — built-in intent layer. ASAP_AI_ENDPOINT would replace `route` only. */
export const ai = {
  latencyMs: 520,
  configured: () => S.sel.connections().some(c => c.kind === 'AI model' && c.status === 'connected'),
  route: interpret,
  workspace: buildWorkspace,
  parseDate,
  /** The only writes a model is ever allowed to request. */
  tools: ['records.import', 'opportunity.create', 'quote.prepare', 'email.send', 'quote.reply',
    'quote.choice', 'placement.create', 'placement.approve', 'approval.invalidate', 'policy.issue',
    'servicing.create', 'tor.request', 'cover.change', 'claim.register', 'claim.document', 'claim.update',
    'payment.match', 'reconcile.run', 'reconcile.resolve', 'renewal.create', 'work.assign', 'work.create',
    'document.upload', 'document.version', 'automation.save', 'automation.toggle', 'automation.run',
    'user.role', 'connection.set', 'conversation.save', 'draft.save']
};
