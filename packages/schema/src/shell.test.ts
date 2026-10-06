import { describe, expect, it } from "vitest";
import { conversationPurpose, deriveConversationStatus, deriveConversationTitle, kindOfRef, refKey } from "./shell.js";

describe("conversation titles (D-155)", () => {
  it("names the work and the record it is about", () => {
    expect(deriveConversationTitle({ text: "renew acme's motor policy", clientName: "Acme Limited" })).toBe("Renew Acme motor policy");
    expect(deriveConversationTitle({ text: "Compare the CIC and Jubilee quotes for Acme", insurerNames: ["CIC General", "Jubilee Insurance"] })).toBe("Compare CIC General and Jubilee Insurance quotations");
    expect(deriveConversationTitle({ text: "Jane had an accident this morning on Mombasa Road", clientName: "Jane Wanjiku" })).toBe("Jane Wanjiku accident claim");
    expect(deriveConversationTitle({ text: "Import the October policy schedules" })).toBe("Import October policy schedules");
    expect(deriveConversationTitle({ text: "Add Acme Limited as a new client" })).toBe("Add Acme");
    expect(deriveConversationTitle({ text: "Investigate why Jubilee claims are delayed" })).toBe("Investigate jubilee claims are delayed");
  });
  it("never leaves an empty title", () => {
    for (const text of ["hi", "?", "New chat", "Client question", "What can I help with?"])
      expect(deriveConversationTitle({ text, brokerageName: "ASAP Brokers Ltd" })).toBe("Ask about ASAP Brokers");
    expect(deriveConversationTitle({ text: "ok", clientName: "Acme Ltd" })).toBe("Ask about Acme");
  });
  it("a question keeps its own words, trimmed", () => {
    expect(deriveConversationTitle({ text: "Can you tell me which policies expire next month?" })).toBe("Which policies expire next month");
  });
  it("a question from a workflow's Space is named after the workflow", () => {
    expect(deriveConversationTitle({ text: "Assign this to Kamau", recordLabel: "Acme Motors — renewal terms from Jubilee" })).toBe("Acme Motors — renewal terms from Jubilee");
  });
  it("is deterministic", () => {
    expect(conversationPurpose("Get a quotation for Acme's fleet")).toBe("quotation");
    expect(deriveConversationTitle({ text: "Get a quotation for Acme's fleet", clientName: "Acme" })).toBe(deriveConversationTitle({ text: "Get a quotation for Acme's fleet", clientName: "Acme" }));
  });
});

describe("conversation status is derived, never authored", () => {
  it("follows the linked work", () => {
    expect(deriveConversationStatus({ turns: 0, workItem: null, runState: null })).toBe("draft");
    expect(deriveConversationStatus({ turns: 2, workItem: null, runState: null })).toBe("completed");
    expect(deriveConversationStatus({ turns: 4, purpose: "renewal", workItem: null, runState: null })).toBe("draft");
    const w = (taskStatus: string, exception = false) => ({ taskStatus, exception, completed: false });
    expect(deriveConversationStatus({ turns: 2, workItem: w("in_progress"), runState: "waiting_approval" })).toBe("needs_approval");
    expect(deriveConversationStatus({ turns: 2, workItem: w("with_party"), runState: "waiting_party" })).toBe("waiting");
    expect(deriveConversationStatus({ turns: 2, workItem: w("needs_you"), runState: null })).toBe("needs_information");
    expect(deriveConversationStatus({ turns: 2, workItem: w("in_progress", true), runState: null })).toBe("blocked");
    expect(deriveConversationStatus({ turns: 2, workItem: w("done"), runState: null })).toBe("completed");
    expect(deriveConversationStatus({ turns: 2, workItem: w("in_progress"), runState: "running" })).toBe("working");
    expect(deriveConversationStatus({ turns: 2, workItem: w("in_progress"), runState: null })).toBe("draft");
  });
});

describe("Recent keys", () => {
  it("the same record is one key, whatever was typed into it", () => {
    expect(refKey({ ws: "client", clientId: "c1", query: "x" })).toBe(refKey({ clientId: "c1", ws: "client" }));
    expect(kindOfRef({ ws: "quotecompare" })).toBe("comparison");
    expect(kindOfRef({ ws: "renewal", runId: "r" })).toBe("workflow");
  });
});
