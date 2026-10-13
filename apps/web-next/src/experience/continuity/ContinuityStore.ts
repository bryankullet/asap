import { emptyUiState, type ExperienceUiState, type SubjectRef } from "@asap/schema";

/**
 * The interface state of one experience — drafts, selections, disclosures, the unsent Ask text —
 * kept on the server per person and brokerage (0092) so refresh, Back and another device restore it.
 *
 * Writes are debounced and carry the version they were based on. A conflict (another tab saved
 * first) is merged: the server's state, with this tab's unsaved edits applied on top, then saved
 * again — the person's latest typing is never discarded.
 */
type Save = (baseVersion: number, ui: ExperienceUiState) => Promise<{ uiVersion: number; ui: ExperienceUiState; conflict: boolean }>;
type Edit = (ui: ExperienceUiState) => ExperienceUiState;

export class ContinuityStore {
  private ui: ExperienceUiState;
  private version: number;
  private dirty: Edit[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private saving: Promise<void> | null = null;

  constructor(
    readonly experienceId: string,
    ui: ExperienceUiState,
    version: number,
    private readonly save: Save,
    private readonly delayMs = 600,
  ) {
    this.ui = ui;
    this.version = version;
  }

  get state(): ExperienceUiState {
    return this.ui;
  }
  get uiVersion(): number {
    return this.version;
  }
  get hasUnsaved(): boolean {
    return this.dirty.length > 0;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): ExperienceUiState => this.ui;

  private apply(edit: Edit) {
    this.ui = edit(this.ui);
    this.dirty.push(edit);
    this.listeners.forEach((l) => l());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  setDraft(instance: string, field: string, value: string) {
    this.apply((u) => ({ ...u, drafts: { ...u.drafts, [instance]: { ...(u.drafts[instance] ?? {}), [field]: value.slice(0, 500) } } }));
  }
  clearDraft(instance: string) {
    this.apply((u) => {
      const drafts = { ...u.drafts };
      delete drafts[instance];
      return { ...u, drafts };
    });
  }
  select(instance: string, ref: SubjectRef | null) {
    this.apply((u) => ({ ...u, selection: { ...u.selection, [instance]: ref } }));
  }
  reveal(node: string) {
    this.apply((u) => ({ ...u, revealed: u.revealed.includes(node) ? u.revealed : [...u.revealed, node].slice(-40), dismissed: u.dismissed.filter((d) => d !== node) }));
  }
  dismiss(node: string) {
    this.apply((u) => ({ ...u, dismissed: u.dismissed.includes(node) ? u.dismissed : [...u.dismissed, node].slice(-40), revealed: u.revealed.filter((d) => d !== node) }));
  }
  setAsk(text: string) {
    this.apply((u) => ({ ...u, ask: text.slice(0, 500) }));
  }

  /**
   * A response from the server carries its own view of the state. Unsaved local edits are replayed
   * over it, so a recomposition never erases what the person is typing.
   */
  adopt(ui: ExperienceUiState, version: number) {
    if (version < this.version) return;
    let next = ui;
    for (const e of this.dirty) next = e(next);
    this.ui = next;
    this.version = version;
    this.listeners.forEach((l) => l());
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) await this.saving;
    if (!this.dirty.length) return;
    const edits = this.dirty;
    this.dirty = [];
    const run = async () => {
      try {
        let r = await this.save(this.version, this.ui);
        if (r.conflict) {
          let merged = r.ui;
          for (const e of edits) merged = e(merged);
          r = await this.save(r.uiVersion, merged);
          if (!r.conflict) this.ui = merged;
        }
        this.version = r.uiVersion;
        if (r.conflict) this.dirty = [...edits, ...this.dirty];
      } catch {
        // Not saved (offline, signed out): keep the edits and try again on the next change.
        this.dirty = [...edits, ...this.dirty];
      }
    };
    this.saving = run().finally(() => (this.saving = null));
    await this.saving;
    this.listeners.forEach((l) => l());
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    void this.flush();
  }
}

export const freshUi = emptyUiState;
