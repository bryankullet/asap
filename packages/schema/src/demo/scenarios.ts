import type { DemoScenario } from "./contracts.js";

/**
 * The 32 approved scenarios, extracted from the interactive demo and normalised (D-064).
 *
 * This is fixture data, not product logic. Every client name, figure and message lives here
 * so that no reusable component ever hardcodes one. Each scenario carries what a person asked,
 * the one-sentence answer, the reasoning, follow-up questions and the generated panel.
 *
 * Nothing here asserts a cover outcome, an approval or a payment. The approved demo is careful
 * about that — a request is not a confirmation, an offer is not a payment — and so is this.
 */
export const DEMO_SCENARIOS: readonly DemoScenario[] =  [
    {
      "id": "policy-overview",
      "name": "Policy overview",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "What's happening with Acme's motor policy?",
      "lead": "The policy is active, but three things need attention.",
      "text": "Acme’s 42-vehicle fleet is covered through 31 December 2026. The premium position is now understood. The immediate risk is a new vehicle requested on cover without recorded insurer confirmation.",
      "suggest": [
        "How do you know?",
        "Prepare a client update"
      ],
      "panel": {
        "type": "POLICY INTELLIGENCE WORK",
        "title": "What matters now",
        "desc": "A live view of the policy—not another dashboard.",
        "facts": [
          [
            "Policy",
            "Active · Comprehensive"
          ],
          [
            "Current premium",
            "KES 8,634,200"
          ],
          [
            "Open claim",
            "CLM-082 · Waiting"
          ],
          [
            "Open servicing",
            "KDN 482Q · Urgent"
          ]
        ],
        "issues": [
          [
            "red",
            "KDN 482Q has been requested on cover, but no insurer confirmation is recorded.",
            "HIGH · Effective-date risk"
          ],
          [
            "",
            "Claim CLM-082 is waiting for assessor allocation.",
            "MEDIUM · 5 days"
          ],
          [
            "green",
            "The KES 214,200 premium variance is explained by Endorsements 03 and 04.",
            "RESOLVED"
          ]
        ],
        "actions": [
          "Review urgent servicing",
          "Open policy history"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "coverage-check",
      "name": "Coverage check",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "Is vehicle KDN 482Q currently covered?",
      "lead": "I cannot confirm that KDN 482Q is currently covered.",
      "text": "The client requested cover effective today, but the latest schedule and certificate do not list the vehicle. An insurer confirmation has not been found. Treating it as covered would be unsafe.",
      "suggest": [
        "How do you know?",
        "Prepare insurer request"
      ],
      "panel": {
        "type": "COVERAGE EVIDENCE WORK",
        "title": "KDN 482Q · Coverage check",
        "desc": "Answer grounded in the latest policy evidence.",
        "facts": [
          [
            "Answer",
            "Not yet confirmed"
          ],
          [
            "Requested effective",
            "10 Sep 2026"
          ],
          [
            "Confidence",
            "High"
          ],
          [
            "Evidence state",
            "Conflicting / missing"
          ]
        ],
        "issues": [],
        "actions": [
          "Open servicing Work",
          "Request confirmation"
        ],
        "warning": "Coverage was requested by the client. A request is not proof of cover. Meridian confirmation is still missing.",
        "evidence": [
          {
            "source": "Client email · 10 Sep",
            "finding": "Cover requested",
            "state": "known",
            "freshness": "Known"
          },
          {
            "source": "Latest schedule · End. 04",
            "finding": "Vehicle absent",
            "state": "known",
            "freshness": "Known"
          },
          {
            "source": "Certificate register",
            "finding": "No certificate",
            "state": "known",
            "freshness": "Known"
          },
          {
            "source": "Insurer correspondence",
            "finding": "No confirmation found",
            "state": "missing",
            "freshness": "Missing"
          }
        ],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "servicing-tor",
      "name": "Servicing / TOR",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "We've bought KDN 482Q. Add it to Acme's cover effective today.",
      "lead": "I’ve prepared an urgent temporary-cover request for review.",
      "text": "I matched the request to Acme’s Commercial Motor policy and extracted the vehicle details from the logbook. The insurer has not yet confirmed cover, and the vehicle value is still missing.",
      "suggest": [
        "Show missing information",
        "How do you know?"
      ],
      "panel": {
        "type": "SERVICING / TOR WORK",
        "title": "Add KDN 482Q to cover",
        "desc": "Immediate cover requested · Human review required",
        "facts": [
          [
            "Vehicle",
            "Toyota Hilux · KDN 482Q"
          ],
          [
            "Requested effective",
            "10 Sep 2026 · Today"
          ],
          [
            "Logbook",
            "Received"
          ],
          [
            "Vehicle value",
            "Missing"
          ]
        ],
        "issues": [],
        "actions": [
          "Review & open in email",
          "Ask client for value",
          "View logbook"
        ],
        "warning": "Effective-date risk: the client requested immediate cover, but no confirmation has been received from Meridian.",
        "evidence": [],
        "draft": {
          "to": "motor.underwriting@meridiangeneral.co.ke",
          "subject": "Urgent TOR — Acme Manufacturing Ltd",
          "body": "Please hold covered vehicle KDN 482Q under policy ASAP-MTR-2026-00418 effective 10 September 2026, subject to your confirmation. Logbook attached. Vehicle value to follow."
        },
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "endorsement",
      "name": "Endorsement",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "Replace KDA 214P with KDN 482Q.",
      "lead": "I’ve prepared the vehicle substitution. It is not yet a confirmed policy change.",
      "text": "KDA 214P will come off cover and KDN 482Q will go on. The supporting logbook is available, but Meridian’s confirmation and final premium adjustment are still pending.",
      "suggest": [
        "Show policy impact",
        "Open evidence"
      ],
      "panel": {
        "type": "ENDORSEMENT WORK",
        "title": "Vehicle substitution",
        "desc": "Replace one fleet vehicle · Pending insurer confirmation",
        "facts": [
          [
            "Off cover",
            "KDA 214P · KES 3.1M"
          ],
          [
            "Onto cover",
            "KDN 482Q · Value missing"
          ],
          [
            "Effective date",
            "10 Sep 2026"
          ],
          [
            "Premium impact",
            "Awaiting insurer"
          ]
        ],
        "issues": [],
        "actions": [
          "Review endorsement request",
          "Add vehicle value",
          "View comparison"
        ],
        "warning": "Requested change ≠ confirmed cover. The current schedule remains authoritative until the insurer confirms the endorsement.",
        "evidence": [
          {
            "source": "Vehicle schedule",
            "finding": "KDA 214P currently listed",
            "state": "known",
            "freshness": "Known"
          },
          {
            "source": "KDN 482Q logbook",
            "finding": "Ownership verified",
            "state": "known",
            "freshness": "Known"
          },
          {
            "source": "Client instruction",
            "finding": "Substitution requested",
            "state": "known",
            "freshness": "Known"
          }
        ],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "claim",
      "name": "Claim",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "Jane was involved in an accident this morning in KDM 811A. Help me handle it.",
      "lead": "The policy and vehicle were active at the reported loss time. I’ve prepared the claim work, but coverage and acceptance remain for Meridian to decide.",
      "text": "KDM 811A appears on the latest schedule. Comprehensive cover and a KES 50,000 own-damage excess apply. I still need the accident location, driver licence, police abstract, photos and repair estimate.",
      "suggest": [
        "Prepare client instructions",
        "Show policy evidence"
      ],
      "panel": {
        "type": "CLAIM WORK",
        "title": "Jane Wanjiku · KDM 811A",
        "desc": "Accident today · Notification ready for review",
        "facts": [
          [
            "Policy on loss date",
            "Active"
          ],
          [
            "Vehicle scheduled",
            "Yes"
          ],
          [
            "Relevant cover",
            "Comprehensive"
          ],
          [
            "Policy excess",
            "KES 50,000"
          ]
        ],
        "issues": [
          [
            "",
            "Missing accident location and circumstances.",
            "Required"
          ],
          [
            "",
            "Police abstract, photos and estimate not received.",
            "Documents"
          ],
          [
            "green",
            "Policy and vehicle checks completed.",
            "Evidence found"
          ]
        ],
        "actions": [
          "Review insurer notice",
          "Send checklist to client",
          "Open evidence"
        ],
        "warning": null,
        "evidence": [],
        "draft": {
          "to": null,
          "subject": null,
          "body": "Meridian Claims,\n\nPlease note a motor accident involving KDM 811A under Acme policy ASAP-MTR-2026-00418 on 10 September 2026. Initial notification only; supporting documents will follow."
        },
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "claim-investigation",
      "name": "Claim investigation",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "Why hasn't Jane's claim moved?",
      "lead": "This appears to be waiting on assessor allocation.",
      "text": "The client supplied the police abstract and the broker forwarded it. Meridian then requested assessor allocation, but no appointment or further response has been recorded for five days.",
      "suggest": [
        "Prepare next follow-up",
        "How do you know?"
      ],
      "panel": {
        "type": "INVESTIGATION WORK",
        "title": "Claim CLM-082 · Bottleneck",
        "desc": "Timeline reconstructed from email, documents and claim records.",
        "facts": [],
        "issues": [],
        "actions": [
          "Review follow-up email",
          "Open insurer thread",
          "Assign owner"
        ],
        "warning": null,
        "evidence": [
          {
            "source": "Fact",
            "finding": "Waiting on assessor allocation",
            "state": "inferred",
            "freshness": "Inferred"
          },
          {
            "source": "Source",
            "finding": "Meridian email · 7 Sep",
            "state": "known",
            "freshness": "Known"
          },
          {
            "source": "Confidence",
            "finding": "High",
            "state": "known",
            "freshness": "91%"
          }
        ],
        "draft": null,
        "timeline": [
          [
            "2 Sep",
            "Claim notified"
          ],
          [
            "2 Sep",
            "Meridian requested police abstract"
          ],
          [
            "3 Sep",
            "Broker asked client"
          ],
          [
            "5 Sep",
            "Client sent police abstract"
          ],
          [
            "5 Sep",
            "Broker forwarded document"
          ],
          [
            "7 Sep",
            "Meridian requested assessor allocation"
          ],
          [
            "Now",
            "No assessor appointment recorded"
          ]
        ],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "reconciliation",
      "name": "Reconciliation",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "Why does Meridian say Acme owes KES 8,634,200 when our records say KES 8,420,000?",
      "lead": "The KES 214,200 difference is fully explained by two endorsements.",
      "text": "Meridian’s balance is correct based on the documents currently available. Endorsement 03 added KES 286,000 and Endorsement 04 credited KES 71,800.",
      "suggest": [
        "Show source documents",
        "Mark resolved"
      ],
      "panel": {
        "type": "RECONCILIATION WORK",
        "title": "Premium variance explained",
        "desc": "Every amount traced back to its source document.",
        "facts": [],
        "issues": [],
        "actions": [
          "Mark reconciled",
          "View all sources",
          "Prepare note"
        ],
        "warning": null,
        "evidence": [
          {
            "source": "Policy invoice INV-418",
            "finding": "KES 8,420,000",
            "state": "known",
            "freshness": "Verified"
          },
          {
            "source": "Debit note DN-03",
            "finding": "KES 286,000",
            "state": "known",
            "freshness": "Verified"
          },
          {
            "source": "Credit note CN-04",
            "finding": "KES 71,800",
            "state": "known",
            "freshness": "Verified"
          }
        ],
        "draft": null,
        "timeline": [],
        "calc": [
          [
            "Original annual premium",
            "KES 8,420,000"
          ],
          [
            "Endorsement 03 · debit",
            "+ KES 286,000"
          ],
          [
            "Endorsement 04 · credit",
            "− KES 71,800"
          ],
          [
            "Expected total",
            "KES 8,634,200"
          ]
        ],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "document-comparison",
      "name": "Document comparison",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "Show me the latest schedule and what changed from the original.",
      "lead": "The latest endorsed schedule has five meaningful changes from the original.",
      "text": "Two vehicles were added, one was removed, the declared fleet value increased, the annual premium changed, and the windscreen excess was revised.",
      "suggest": [
        "Open Endorsement 04",
        "Show sources"
      ],
      "panel": {
        "type": "DOCUMENT COMPARISON WORK",
        "title": "Original → Latest schedule",
        "desc": "Policy Schedule v1 compared with Endorsed Schedule v4",
        "facts": [],
        "issues": [],
        "actions": [
          "View side by side",
          "Open Endorsement 04",
          "Show source"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": [
          [
            "Vehicles",
            "41 → 42 · 2 added, 1 removed"
          ],
          [
            "Fleet value",
            "KES 186.4M → KES 190.8M"
          ],
          [
            "Annual premium",
            "KES 8.42M → KES 8.6342M"
          ],
          [
            "Windscreen excess",
            "KES 25,000 → KES 35,000"
          ],
          [
            "Effective version",
            "1 Jan → 22 Aug 2026"
          ]
        ]
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "client-update",
      "name": "Client update",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "Prepare an update for Acme on everything outstanding.",
      "lead": "I’ve drafted a short client update covering the four current items.",
      "text": "It includes the pending new-vehicle endorsement, Jane’s claim delay, the resolved premium variance and the certificate that cannot be issued yet.",
      "suggest": [
        "Make it friendlier",
        "Show evidence"
      ],
      "panel": {
        "type": "COMMUNICATION WORK",
        "title": "Policy update for Acme",
        "desc": "Prepared from the current policy state · Not sent",
        "facts": [],
        "issues": [],
        "actions": [
          "Copy",
          "Open in email",
          "Edit"
        ],
        "warning": null,
        "evidence": [],
        "draft": {
          "to": null,
          "subject": null,
          "body": "Hi Peter,\n\nA quick update on your motor policy:\n\n• KDN 482Q: we are awaiting Meridian’s cover confirmation. Please don’t assume cover until we confirm.\n• Jane’s claim: we are following up on assessor allocation.\n• Premium: the KES 214,200 variance is resolved and reflects Endorsements 03 and 04.\n• Certificate: KDN 482Q’s certificate will follow once the endorsement is confirmed.\n\nRegards,\nGrace"
        },
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "policy-risk-scan",
      "name": "Policy risk scan",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "Is there anything on this policy I should be worried about?",
      "lead": "Yes. One issue is urgent and two need follow-up.",
      "text": "The highest risk is the new vehicle requested on cover today without insurer confirmation. I found no other high-severity issue in the current records.",
      "suggest": [
        "Handle the urgent item",
        "How do you know?"
      ],
      "panel": {
        "type": "POLICY RISK WORK",
        "title": "3 issues worth your attention",
        "desc": "Only meaningful risks found across the complete policy record.",
        "facts": [],
        "issues": [
          [
            "red",
            "KDN 482Q requested on cover today, but insurer confirmation has not been recorded.",
            "HIGH · Cover uncertainty"
          ],
          [
            "",
            "Claim CLM-082 has waited five days for assessor allocation.",
            "MEDIUM · Client delay"
          ],
          [
            "",
            "Certificate for KDN 482Q cannot be issued until confirmation.",
            "MEDIUM · Compliance"
          ],
          [
            "green",
            "Premium discrepancy was caused by Endorsements 03 and 04.",
            "RESOLVED"
          ]
        ],
        "actions": [
          "Handle urgent servicing",
          "Prepare all follow-ups",
          "Open evidence"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "evidence",
      "name": "Evidence",
      "group": "Active policy — Acme Manufacturing",
      "clientId": "acme",
      "ask": "How do you know?",
      "lead": "I separated what the records prove from what is inferred or still missing.",
      "text": "Each conclusion links back to the exact document, email or system record. Uncertainty stays visible and can be challenged before you act.",
      "suggest": [
        "Open source document",
        "What is missing?"
      ],
      "panel": {
        "type": "EVIDENCE WORK",
        "title": "Why ASAP reached this answer",
        "desc": "Fact · Source · Confidence · Meaning · Available action",
        "facts": [],
        "issues": [],
        "actions": [
          "Open source bundle",
          "Request verification",
          "Correct evidence"
        ],
        "warning": "Records are current through 10 Sep 2026, 16:42. If Meridian confirmed outside connected email, this answer may be stale.",
        "evidence": [
          {
            "source": "KDN 482Q requested",
            "finding": "Client email · 10 Sep",
            "state": "known",
            "freshness": "Known"
          },
          {
            "source": "Vehicle not scheduled",
            "finding": "Endorsed Schedule v4",
            "state": "known",
            "freshness": "Known"
          },
          {
            "source": "No cover confirmation",
            "finding": "Meridian email search",
            "state": "missing",
            "freshness": "Missing"
          },
          {
            "source": "Cover therefore uncertain",
            "finding": "Combined evidence",
            "state": "inferred",
            "freshness": "Inferred"
          },
          {
            "source": "Certificate cannot issue",
            "finding": "Certificate rules + no confirmation",
            "state": "waiting",
            "freshness": "Waiting"
          }
        ],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "policy-history",
      "name": "Policy history",
      "group": "Active policy · Acme",
      "clientId": "acme",
      "ask": "Show me everything important that's happened on this policy this year.",
      "lead": "Here is the policy’s important history—from placement to today’s open issue.",
      "text": "I’ve left out routine messages and duplicates, keeping only events that changed the policy, money, claim or servicing state.",
      "suggest": [
        "Filter to claims",
        "Show documents"
      ],
      "panel": {
        "type": "POLICY HISTORY WORK",
        "title": "Commercial Motor · 2026 timeline",
        "desc": "The policy as an evolving business state.",
        "facts": [],
        "issues": [],
        "actions": [
          "Open full audit trail",
          "Export timeline"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [
          [
            "1 Jan",
            "Policy placed · 41 vehicles"
          ],
          [
            "2 Jan",
            "Premium invoiced · KES 8.42M"
          ],
          [
            "18 Jan",
            "Payment received"
          ],
          [
            "14 Apr",
            "Vehicle added · Endorsement 03"
          ],
          [
            "22 Aug",
            "Vehicle removed · Endorsement 04"
          ],
          [
            "2 Sep",
            "Claim CLM-082 reported"
          ],
          [
            "5 Sep",
            "Police abstract received"
          ],
          [
            "7 Sep",
            "Assessor allocation requested"
          ],
          [
            "9 Sep",
            "Premium variance explained"
          ],
          [
            "10 Sep",
            "KDN 482Q requested on cover · Open"
          ]
        ],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AM",
        "client": "ACME MANUFACTURING LTD",
        "title": "Commercial Motor Fleet",
        "number": "ASAP-MTR-2026-00418",
        "insurer": "Meridian General Insurance",
        "period": "1 Jan – 31 Dec 2026",
        "facts": [
          [
            "Status",
            "Active"
          ],
          [
            "Vehicles",
            "42"
          ],
          [
            "Annual premium",
            "KES 8.42M"
          ]
        ]
      }
    },
    {
      "id": "create-opportunity-from-email",
      "name": "Create opportunity from email",
      "group": "New business · Karibu Logistics",
      "clientId": "karibu",
      "ask": "What does Karibu Logistics need from this email?",
      "lead": "Karibu needs commercial motor quotations for a 27-truck fleet starting 1 October.",
      "text": "I identified a new-business opportunity, extracted the fleet request and separated known information from what must be confirmed before insurers are approached.",
      "suggest": [
        "What information is missing?",
        "Prepare the quote request"
      ],
      "panel": {
        "type": "OPPORTUNITY WORK",
        "title": "Karibu fleet insurance",
        "desc": "Created from an incoming client email · Owner: Grace",
        "facts": [
          [
            "Fleet",
            "27 trucks"
          ],
          [
            "Cover requested",
            "Comprehensive"
          ],
          [
            "Target start",
            "1 Oct 2026"
          ],
          [
            "Mandate",
            "Email instruction received"
          ]
        ],
        "issues": [
          [
            "",
            "Driver history and claims experience are missing.",
            "2 requirements"
          ],
          [
            "green",
            "Fleet schedule and logbooks were attached.",
            "Documents found"
          ]
        ],
        "actions": [
          "Review opportunity",
          "Request missing information",
          "Choose insurers"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "KL",
        "client": "KARIBU LOGISTICS LTD",
        "title": "Commercial Motor Fleet · New business",
        "number": "Opportunity ASAP-QT-2026-091",
        "insurer": "Insurer not selected",
        "period": "Proposed: 1 Oct 2026",
        "facts": [
          [
            "Stage",
            "Qualification"
          ],
          [
            "Vehicles",
            "27"
          ],
          [
            "Target start",
            "1 Oct 2026"
          ]
        ]
      }
    },
    {
      "id": "quote-readiness",
      "name": "Quote readiness",
      "group": "New business · Karibu Logistics",
      "clientId": "karibu",
      "ask": "Are we ready to approach insurers for Karibu?",
      "lead": "Almost. Two material facts are still missing.",
      "text": "The fleet schedule, logbooks and requested cover are available. Claims experience and the overnight parking arrangements are required before the submission will be complete.",
      "suggest": [
        "Prepare the client request",
        "Show what we have"
      ],
      "panel": {
        "type": "QUOTE READINESS WORK",
        "title": "Karibu · Ready with 2 gaps",
        "desc": "Submission quality checked against commercial motor requirements.",
        "facts": [
          [
            "Fleet schedule",
            "Complete"
          ],
          [
            "Logbooks",
            "27 received"
          ],
          [
            "Claims experience",
            "Missing"
          ],
          [
            "Parking details",
            "Missing"
          ]
        ],
        "issues": [],
        "actions": [
          "Request missing information",
          "Prepare draft pack",
          "View sources"
        ],
        "warning": "ASAP can prepare the pack now, but approaching insurers before these facts arrive may produce conditional or incomparable terms.",
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "KL",
        "client": "KARIBU LOGISTICS LTD",
        "title": "Commercial Motor Fleet · New business",
        "number": "Opportunity ASAP-QT-2026-091",
        "insurer": "Insurer not selected",
        "period": "Proposed: 1 Oct 2026",
        "facts": [
          [
            "Readiness",
            "82%"
          ],
          [
            "Insurers",
            "0 approached"
          ],
          [
            "Missing",
            "2 items"
          ]
        ]
      }
    },
    {
      "id": "compare-quotations",
      "name": "Compare quotations",
      "group": "New business · Karibu Logistics",
      "clientId": "karibu",
      "ask": "Compare the quotations we received for Karibu.",
      "lead": "APA offers the strongest overall protection; Jubilee is cheapest but has two material restrictions.",
      "text": "I normalised premiums, excesses, limits, exclusions and conditions across all three quotes. The recommendation is based on protection and fit, not price alone.",
      "suggest": [
        "Why APA?",
        "Prepare client recommendation"
      ],
      "panel": {
        "type": "QUOTE COMPARISON WORK",
        "title": "3 options · 5 meaningful differences",
        "desc": "APA, Jubilee and CIC compared on a like-for-like basis.",
        "facts": [
          [
            "APA",
            "KES 5.84M · Best fit"
          ],
          [
            "Jubilee",
            "KES 5.51M · Lowest"
          ],
          [
            "CIC",
            "KES 6.02M"
          ],
          [
            "Quote validity",
            "12 days remaining"
          ]
        ],
        "issues": [],
        "actions": [
          "Prepare recommendation",
          "Show all differences",
          "Request clarification"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": [
          [
            "Own-damage excess",
            "APA 2.5% · Jubilee 5%"
          ],
          [
            "Authorised drivers",
            "Jubilee restricted"
          ],
          [
            "Windscreen limit",
            "APA KES 250K · others 150K"
          ],
          [
            "Courtesy vehicle",
            "APA included"
          ],
          [
            "Tracking condition",
            "CIC mandatory"
          ]
        ]
      },
      "context": {
        "initials": "KL",
        "client": "KARIBU LOGISTICS LTD",
        "title": "Commercial Motor Fleet · Quotations",
        "number": "Opportunity ASAP-QT-2026-091",
        "insurer": "3 insurer responses",
        "period": "Proposed: 1 Oct 2026",
        "facts": [
          [
            "Quotes",
            "3 usable"
          ],
          [
            "Best fit",
            "APA"
          ],
          [
            "Lowest price",
            "Jubilee"
          ]
        ]
      }
    },
    {
      "id": "placement-blocker",
      "name": "Placement blocker",
      "group": "New business · Karibu Logistics",
      "clientId": "karibu",
      "ask": "Karibu chose APA. What is blocking policy issuance?",
      "lead": "Client choice is recorded. Two underwriting requirements still block issuance.",
      "text": "APA requires completed driver declarations and proof of tracker installation for five high-value trucks. The placement request is prepared but has not been submitted.",
      "suggest": [
        "Prepare the submission",
        "What did the client choose?"
      ],
      "panel": {
        "type": "PLACEMENT WORK",
        "title": "Karibu placement · 2 blockers",
        "desc": "Chosen terms and underwriting conditions tracked separately.",
        "facts": [
          [
            "Client choice",
            "APA · Confirmed by email"
          ],
          [
            "Driver declarations",
            "7 of 27 missing"
          ],
          [
            "Tracker evidence",
            "5 vehicles missing"
          ],
          [
            "Insurer confirmation",
            "Not received"
          ]
        ],
        "issues": [],
        "actions": [
          "Request requirements",
          "Review submission",
          "Open client instruction"
        ],
        "warning": "Internal approval permits submission. It does not mean APA has confirmed cover.",
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "KL",
        "client": "KARIBU LOGISTICS LTD",
        "title": "Commercial Motor Fleet · Placement",
        "number": "Placement ASAP-PL-2026-038",
        "insurer": "APA Insurance",
        "period": "1 Oct 2026 – 30 Sep 2027",
        "facts": [
          [
            "Stage",
            "Underwriting"
          ],
          [
            "Requirements",
            "2 open"
          ],
          [
            "Cover",
            "Not confirmed"
          ]
        ]
      }
    },
    {
      "id": "renewal-risk",
      "name": "Renewal risk",
      "group": "Renewal · Bluewave Properties",
      "clientId": "bluewave",
      "ask": "Is Bluewave’s property renewal at risk?",
      "lead": "Yes. It expires in 34 days and updated property values are still missing.",
      "text": "Two insurers have asked for the current valuation and fire-protection inspection. Without them, usable renewal terms are unlikely to arrive on time.",
      "suggest": [
        "Start the renewal",
        "Request missing documents"
      ],
      "panel": {
        "type": "RENEWAL WORK",
        "title": "Bluewave renewal · At risk",
        "desc": "34 days to expiry · Missing evidence is holding up the market.",
        "facts": [
          [
            "Current premium",
            "KES 3,240,000"
          ],
          [
            "Updated valuation",
            "Missing"
          ],
          [
            "Fire inspection",
            "Out of date"
          ],
          [
            "Insurers approached",
            "2"
          ]
        ],
        "issues": [
          [
            "red",
            "No usable renewal terms have been received.",
            "HIGH · Timing"
          ],
          [
            "",
            "Valuation and fire inspection are holding up both insurers.",
            "CLIENT ACTION"
          ]
        ],
        "actions": [
          "Prepare client request",
          "View renewal plan",
          "Assign owner"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "BP",
        "client": "BLUEWAVE PROPERTIES LTD",
        "title": "Property Owners Combined · Renewal",
        "number": "Policy BW-POC-2025-117",
        "insurer": "Jubilee Allianz",
        "period": "Expires 14 Oct 2026",
        "facts": [
          [
            "Status",
            "At risk"
          ],
          [
            "Days left",
            "34"
          ],
          [
            "Terms",
            "0 usable"
          ]
        ]
      }
    },
    {
      "id": "explain-premium-increase",
      "name": "Explain premium increase",
      "group": "Renewal · Bluewave Properties",
      "clientId": "bluewave",
      "ask": "Why did Bluewave’s renewal premium increase?",
      "lead": "Most of the 21% increase comes from higher declared property values—not claims.",
      "text": "Declared values increased 16.4%, the insurer rate increased 3.2%, and the flood excess changed. Claims experience contributed only a small loading.",
      "suggest": [
        "Compare cover changes",
        "Prepare recommendation"
      ],
      "panel": {
        "type": "RENEWAL ANALYSIS WORK",
        "title": "Premium change explained",
        "desc": "KES 680,000 increase separated into its real drivers.",
        "facts": [],
        "issues": [],
        "actions": [
          "Prepare client explanation",
          "Compare other terms",
          "Open sources"
        ],
        "warning": null,
        "evidence": [
          {
            "source": "2025 schedule",
            "finding": "Prior values and rate",
            "state": "known",
            "freshness": "Verified"
          },
          {
            "source": "2026 valuation",
            "finding": "Values +16.4%",
            "state": "known",
            "freshness": "Verified"
          },
          {
            "source": "Renewal quote v2",
            "finding": "Premium and excess",
            "state": "known",
            "freshness": "Verified"
          }
        ],
        "draft": null,
        "timeline": [],
        "calc": [
          [
            "Current premium",
            "KES 3,240,000"
          ],
          [
            "Higher declared values",
            "+ KES 531,000"
          ],
          [
            "Rate and claims loading",
            "+ KES 112,000"
          ],
          [
            "Levies and rounding",
            "+ KES 37,000"
          ],
          [
            "Renewal premium",
            "KES 3,920,000"
          ]
        ],
        "diff": []
      },
      "context": {
        "initials": "BP",
        "client": "BLUEWAVE PROPERTIES LTD",
        "title": "Property Owners Combined · Renewal",
        "number": "Policy BW-POC-2025-117",
        "insurer": "Jubilee Allianz",
        "period": "Renews 14 Oct 2026",
        "facts": [
          [
            "Increase",
            "21%"
          ],
          [
            "New premium",
            "KES 3.92M"
          ],
          [
            "Main driver",
            "Values"
          ]
        ]
      }
    },
    {
      "id": "property-claim",
      "name": "Property claim",
      "group": "Claims · GreenCare Clinics",
      "clientId": "greencare",
      "ask": "Create a claim from GreenCare’s equipment damage email.",
      "lead": "I found the policy and prepared a machinery-breakdown claim for review.",
      "text": "The reported loss date falls inside the active period. The affected MRI cooling unit appears in the equipment schedule, but cause and repair evidence are incomplete.",
      "suggest": [
        "What documents are missing?",
        "Prepare insurer notice"
      ],
      "panel": {
        "type": "CLAIM WORK",
        "title": "MRI cooling unit failure",
        "desc": "Detected from client email · Claim not yet submitted",
        "facts": [
          [
            "Policy on loss date",
            "Active"
          ],
          [
            "Equipment scheduled",
            "Yes"
          ],
          [
            "Relevant cover",
            "Machinery breakdown"
          ],
          [
            "Estimated loss",
            "KES 4,800,000"
          ]
        ],
        "issues": [
          [
            "",
            "Engineer’s cause report has not been received.",
            "REQUIRED"
          ],
          [
            "",
            "Repair quotation is marked preliminary.",
            "CHECK"
          ],
          [
            "green",
            "Policy, equipment and loss date matched.",
            "EVIDENCE FOUND"
          ]
        ],
        "actions": [
          "Review claim notice",
          "Send client checklist",
          "Open policy evidence"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "GC",
        "client": "GREENCARE CLINICS LTD",
        "title": "Machinery Breakdown · Claim",
        "number": "Draft claim GC-MB-094",
        "insurer": "Old Mutual General",
        "period": "Policy active to 31 Dec 2026",
        "facts": [
          [
            "Stage",
            "Draft claim"
          ],
          [
            "Loss",
            "9 Sep 2026"
          ],
          [
            "Estimate",
            "KES 4.8M"
          ]
        ]
      }
    },
    {
      "id": "settlement-status",
      "name": "Settlement status",
      "group": "Claims · GreenCare Clinics",
      "clientId": "greencare",
      "ask": "Has GreenCare’s claim been settled?",
      "lead": "An offer was made and accepted, but payment has not been received.",
      "text": "Old Mutual offered KES 3,650,000 on 6 September. GreenCare accepted on 7 September. There is no bank receipt or remittance advice proving settlement payment.",
      "suggest": [
        "How do you know?",
        "Prepare payment follow-up"
      ],
      "panel": {
        "type": "CLAIM SETTLEMENT WORK",
        "title": "Accepted · Waiting for payment",
        "desc": "Offer, acceptance and receipt remain separate facts.",
        "facts": [
          [
            "Offer made",
            "6 Sep · KES 3.65M"
          ],
          [
            "Client accepted",
            "7 Sep · Email"
          ],
          [
            "Discharge voucher",
            "Signed"
          ],
          [
            "Money received",
            "No evidence"
          ]
        ],
        "issues": [],
        "actions": [
          "Prepare insurer follow-up",
          "View settlement evidence",
          "Record payment"
        ],
        "warning": "Do not mark this claim paid or closed until bank or remittance evidence is matched.",
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "GC",
        "client": "GREENCARE CLINICS LTD",
        "title": "Machinery Breakdown · Claim",
        "number": "Claim OM-CLM-44108",
        "insurer": "Old Mutual General",
        "period": "Loss date: 18 Jul 2026",
        "facts": [
          [
            "Offer",
            "Accepted"
          ],
          [
            "Payment",
            "Not received"
          ],
          [
            "Net amount",
            "KES 3.65M"
          ]
        ]
      }
    },
    {
      "id": "client-balance",
      "name": "Client balance",
      "group": "Money · Mara Foods",
      "clientId": "mara",
      "ask": "What does Mara Foods currently owe?",
      "lead": "Mara Foods owes KES 1,184,600 across two active policies.",
      "text": "KES 860,000 is overdue on the Marine Cargo policy. KES 324,600 is due in six days on Fire and Perils. I excluded an unmatched receipt from the balance.",
      "suggest": [
        "Show the calculation",
        "Prepare a reminder"
      ],
      "panel": {
        "type": "MONEY WORK",
        "title": "Mara Foods · KES 1,184,600 due",
        "desc": "Balance assembled from invoices, endorsements, payments and receipts.",
        "facts": [],
        "issues": [],
        "actions": [
          "Prepare payment reminder",
          "Match receipt",
          "View ledger evidence"
        ],
        "warning": "Receipt RC-882 for KES 400,000 is not included because its policy reference is unclear.",
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [
          [
            "Marine Cargo invoice",
            "KES 2,360,000"
          ],
          [
            "Payment matched",
            "− KES 1,500,000"
          ],
          [
            "Fire & Perils balance",
            "+ KES 324,600"
          ],
          [
            "Current balance",
            "KES 1,184,600"
          ]
        ],
        "diff": []
      },
      "context": {
        "initials": "MF",
        "client": "MARA FOODS EXPORTERS LTD",
        "title": "Account balance",
        "number": "2 active policies",
        "insurer": "Multiple insurers",
        "period": "As at 10 Sep 2026",
        "facts": [
          [
            "Outstanding",
            "KES 1.185M"
          ],
          [
            "Overdue",
            "KES 860K"
          ],
          [
            "Unmatched",
            "1 receipt"
          ]
        ]
      }
    },
    {
      "id": "commission-outstanding",
      "name": "Commission outstanding",
      "group": "Money · Brokerage",
      "clientId": null,
      "ask": "Which insurers owe us commission?",
      "lead": "KES 3.74M of expected commission is outstanding from four insurers.",
      "text": "Meridian accounts for the largest amount. KES 1.12M is more than 45 days old and should be prioritised for reconciliation.",
      "suggest": [
        "Show Meridian’s balance",
        "Prepare reconciliation"
      ],
      "panel": {
        "type": "COMMISSION WORK",
        "title": "Outstanding insurer commission",
        "desc": "Expected, received and disputed amounts kept separate.",
        "facts": [
          [
            "Meridian",
            "KES 1,460,000"
          ],
          [
            "Jubilee Allianz",
            "KES 980,000"
          ],
          [
            "APA",
            "KES 760,000"
          ],
          [
            "Old Mutual",
            "KES 540,000"
          ]
        ],
        "issues": [
          [
            "red",
            "Meridian has KES 620,000 outstanding for more than 45 days.",
            "PRIORITY"
          ],
          [
            "",
            "Three payments lack policy-level allocation.",
            "RECONCILE"
          ]
        ],
        "actions": [
          "Open Meridian reconciliation",
          "Prepare statements",
          "Export evidence"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AS",
        "client": "ASAP BROKERAGE BOOK",
        "title": "Commission receivables",
        "number": "September 2026 review",
        "insurer": "8 insurer accounts",
        "period": "Year to date",
        "facts": [
          [
            "Outstanding",
            "KES 3.74M"
          ],
          [
            "Over 45 days",
            "KES 1.12M"
          ],
          [
            "Insurers",
            "4"
          ]
        ]
      }
    },
    {
      "id": "brokerage-priorities",
      "name": "Brokerage priorities",
      "group": "Management · Brokerage",
      "clientId": null,
      "ask": "What needs my attention across the brokerage today?",
      "lead": "Seven things need attention. These three have the highest business impact.",
      "text": "I ranked verified deadlines, uncertain cover, client decisions and trapped money. Routine activity and already-owned follow-ups were left out.",
      "suggest": [
        "Which renewals are at risk?",
        "Who is overloaded?"
      ],
      "panel": {
        "type": "MANAGEMENT WORK",
        "title": "What matters today",
        "desc": "Ranked across policies, claims, renewals and money.",
        "facts": [],
        "issues": [
          [
            "red",
            "Acme vehicle requested on cover without confirmation.",
            "HIGH · COVER"
          ],
          [
            "red",
            "Bluewave renewal has no usable terms with 34 days left.",
            "HIGH · RENEWAL"
          ],
          [
            "",
            "Mara Foods has KES 860,000 overdue.",
            "MONEY"
          ],
          [
            "",
            "GreenCare settlement payment is still unverified.",
            "CLAIM"
          ]
        ],
        "actions": [
          "Prepare a morning plan",
          "Assign work",
          "Open Discover"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AS",
        "client": "ASAP BROKERAGE",
        "title": "Brokerage operations",
        "number": "Today · 10 Sep 2026",
        "insurer": "All connected markets",
        "period": "Current book",
        "facts": [
          [
            "Priorities",
            "7"
          ],
          [
            "High",
            "2"
          ],
          [
            "For review",
            "3"
          ]
        ]
      }
    },
    {
      "id": "team-workload",
      "name": "Team workload",
      "group": "Management · Brokerage",
      "clientId": null,
      "ask": "Who is overloaded this week?",
      "lead": "James is carrying the highest risk-adjusted workload, mainly from renewals.",
      "text": "He owns 14 active items, including four time-sensitive renewals. Grace has more total items, but fewer deadlines inside the next seven days.",
      "suggest": [
        "Show James’s work",
        "Reassign the urgent renewals"
      ],
      "panel": {
        "type": "TEAM OPERATIONS WORK",
        "title": "Workload and deadline pressure",
        "desc": "Counts are weighted by urgency, dependency and economic impact.",
        "facts": [
          [
            "James",
            "14 active · 4 urgent"
          ],
          [
            "Grace",
            "18 active · 2 urgent"
          ],
          [
            "Amina",
            "9 active · 1 urgent"
          ],
          [
            "Unassigned",
            "5 items"
          ]
        ],
        "issues": [
          [
            "red",
            "Two of James’s renewals expire inside 30 days without terms.",
            "REASSIGNMENT SUGGESTED"
          ],
          [
            "",
            "Three approvals are waiting for Grace.",
            "FOR REVIEW"
          ]
        ],
        "actions": [
          "Review assignments",
          "Open James’s work",
          "Prepare handoff"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AS",
        "client": "ASAP BROKERAGE",
        "title": "Team operations",
        "number": "6 team members",
        "insurer": "All connected markets",
        "period": "This week",
        "facts": [
          [
            "Most exposed",
            "James Mwangi"
          ],
          [
            "At-risk renewals",
            "4"
          ],
          [
            "Approvals",
            "3"
          ]
        ]
      }
    },
    {
      "id": "import-brokerage-records",
      "name": "Import brokerage records",
      "group": "Setup · Connected records",
      "clientId": null,
      "ask": "Import these client and policy files.",
      "lead": "I classified 63 records and found eight that need your review.",
      "text": "ASAP matched clients, grouped policy documents and proposed links without saving uncertain records. Fifty-two are ready, three failed to extract and eight need a human choice.",
      "suggest": [
        "Show the uncertain matches",
        "What failed?"
      ],
      "panel": {
        "type": "IMPORT REVIEW WORK",
        "title": "63 records · 8 need review",
        "desc": "Mixed Excel and PDF import · Nothing uncertain saved automatically.",
        "facts": [
          [
            "Clients found",
            "18"
          ],
          [
            "Policies found",
            "27"
          ],
          [
            "Claims found",
            "9"
          ],
          [
            "Other documents",
            "9"
          ]
        ],
        "issues": [
          [
            "",
            "Acme Manufacturing may duplicate Acme Manufacturing Ltd.",
            "DUPLICATE"
          ],
          [
            "",
            "Four policy numbers are unreadable in scanned schedules.",
            "CHECK SOURCE"
          ],
          [
            "red",
            "Three encrypted PDFs could not be opened.",
            "FAILED"
          ]
        ],
        "actions": [
          "Review 8 exceptions",
          "Commit 52 ready records",
          "Download failure list"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AS",
        "client": "NEW BROKERAGE SETUP",
        "title": "Records import",
        "number": "Batch IMP-2026-009",
        "insurer": "Mixed records",
        "period": "First import",
        "facts": [
          [
            "Ready",
            "52"
          ],
          [
            "Check",
            "8"
          ],
          [
            "Failed",
            "3"
          ]
        ]
      }
    },
    {
      "id": "email-connection",
      "name": "Email connection",
      "group": "Setup · Connected records",
      "clientId": null,
      "ask": "What did ASAP find after connecting our email?",
      "lead": "The first sync linked 1,284 messages and left 37 for review.",
      "text": "ASAP connected client, policy, claim and quotation threads using permitted mailbox folders. Uncertain matches remain separate and have not changed any business record.",
      "suggest": [
        "Show unhandled emails",
        "What needs checking?"
      ],
      "panel": {
        "type": "EMAIL SYNC WORK",
        "title": "Mailbox connected safely",
        "desc": "Read access only · External sending remains human-controlled.",
        "facts": [
          [
            "Messages scanned",
            "1,407"
          ],
          [
            "Safely linked",
            "1,284"
          ],
          [
            "Need review",
            "37"
          ],
          [
            "Unmatched",
            "86"
          ]
        ],
        "issues": [
          [
            "",
            "Nine emails contain conflicting client references.",
            "CHECK"
          ],
          [
            "",
            "Six claim notifications appear unhandled.",
            "NEW WORK"
          ],
          [
            "green",
            "No external message was sent.",
            "HUMAN CONTROL"
          ]
        ],
        "actions": [
          "Review 37 matches",
          "Open unhandled emails",
          "Connection settings"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AS",
        "client": "BROKERAGE CONNECTIONS",
        "title": "Operations inbox",
        "number": "grace@asapbrokers.co.ke",
        "insurer": "Google Workspace",
        "period": "Synced 4 min ago",
        "facts": [
          [
            "Linked",
            "1,284"
          ],
          [
            "Review",
            "37"
          ],
          [
            "Unmatched",
            "86"
          ]
        ]
      }
    },
    {
      "id": "create-claim-automation",
      "name": "Create claim automation",
      "group": "Automations · Teach ASAP",
      "clientId": null,
      "ask": "When a client emails an accident notification, prepare a claim for review.",
      "lead": "I’ve drafted the automation with human approval before insurer notification.",
      "text": "It will identify the client and policy, extract incident facts, check the loss date and vehicle, then create Claim Work. Missing or conflicting matches will be routed for review.",
      "suggest": [
        "Test it with Jane’s email",
        "Show exception handling"
      ],
      "panel": {
        "type": "AUTOMATION WORK",
        "title": "Client accident email → Draft claim",
        "desc": "Natural-language rule converted into a safe, testable workflow.",
        "facts": [
          [
            "Trigger",
            "Accident email detected"
          ],
          [
            "Skills",
            "6 selected"
          ],
          [
            "External action",
            "Never automatic"
          ],
          [
            "Duplicates",
            "Reuse existing claim"
          ]
        ],
        "issues": [],
        "actions": [
          "Test with sample email",
          "Review approval rule",
          "Activate automation"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [
          [
            "1",
            "Identify client and active policy"
          ],
          [
            "2",
            "Extract loss date, vehicle and incident"
          ],
          [
            "3",
            "Check coverage evidence and missing facts"
          ],
          [
            "4",
            "Create Claim Work for human review"
          ]
        ],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AS",
        "client": "ASAP BROKERAGE",
        "title": "Automation builder",
        "number": "Draft automation",
        "insurer": "All connected inboxes",
        "period": "Runs on new email",
        "facts": [
          [
            "Trigger",
            "Email received"
          ],
          [
            "Action",
            "Prepare claim"
          ],
          [
            "Approval",
            "Required"
          ]
        ]
      }
    },
    {
      "id": "find-a-client",
      "name": "Find a client",
      "group": "Search · Records and relationships",
      "clientId": "karibu",
      "ask": "Find everything connected to Karibu Logistics.",
      "lead": "I found one client, one active opportunity and 18 connected records.",
      "text": "Results are grouped by relationship rather than file type, so you can move straight into the useful task.",
      "suggest": [
        "Show policies",
        "Show recent emails"
      ],
      "panel": {
        "type": "SEARCH WORK",
        "title": "Karibu Logistics · Connected results",
        "desc": "Records, documents, email and relationships searched together.",
        "facts": [
          [
            "Opportunity",
            "Fleet insurance · Active"
          ],
          [
            "Documents",
            "11 connected"
          ],
          [
            "Email threads",
            "5 connected"
          ],
          [
            "People",
            "2 contacts"
          ]
        ],
        "issues": [],
        "actions": [
          "Open client summary",
          "Open quote Work",
          "Refine search"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "KL",
        "client": "KARIBU LOGISTICS LTD",
        "title": "Client relationship",
        "number": "Client KL-0028",
        "insurer": "3 markets approached",
        "period": "Relationship since Sep 2026",
        "facts": [
          [
            "Results",
            "18"
          ],
          [
            "Active work",
            "3"
          ],
          [
            "Owner",
            "Grace"
          ]
        ]
      }
    },
    {
      "id": "unhandled-communication",
      "name": "Unhandled communication",
      "group": "Communication · Email",
      "clientId": null,
      "ask": "Which client emails have not been dealt with?",
      "lead": "Six client emails appear to need action; two are urgent.",
      "text": "I excluded newsletters, acknowledgements and threads already linked to completed work.",
      "suggest": [
        "Open the urgent emails",
        "Assign them"
      ],
      "panel": {
        "type": "COMMUNICATION WORK",
        "title": "6 emails need attention",
        "desc": "Classified by client, policy, intent and urgency.",
        "facts": [],
        "issues": [
          [
            "red",
            "Acme requested same-day cover for KDN 482Q.",
            "SERVICING"
          ],
          [
            "red",
            "GreenCare reported equipment damage.",
            "CLAIM"
          ],
          [
            "",
            "Karibu sent updated fleet schedule.",
            "QUOTE"
          ],
          [
            "",
            "One sender could not be matched safely.",
            "CHECK IDENTITY"
          ]
        ],
        "actions": [
          "Open first email",
          "Assign all",
          "Review uncertain match"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AS",
        "client": "ASAP BROKERAGE",
        "title": "Unhandled communication",
        "number": "Operations inbox",
        "insurer": "Connected email",
        "period": "Last 7 days",
        "facts": [
          [
            "Unhandled",
            "6"
          ],
          [
            "Urgent",
            "2"
          ],
          [
            "Uncertain",
            "1"
          ]
        ]
      }
    },
    {
      "id": "document-conflict",
      "name": "Document conflict",
      "group": "Documents · Evidence",
      "clientId": "bluewave",
      "ask": "Do the latest Bluewave schedule and renewal quote agree?",
      "lead": "No. I found one material conflict in the property value.",
      "text": "The latest schedule shows KES 462M, while the renewal quote uses KES 438M. The quote may therefore be based on an older valuation.",
      "suggest": [
        "Show the source pages",
        "Prepare clarification"
      ],
      "panel": {
        "type": "DOCUMENT REVIEW WORK",
        "title": "Property value conflict",
        "desc": "Exact fields compared across two versioned documents.",
        "facts": [],
        "issues": [],
        "actions": [
          "View source pages",
          "Prepare clarification",
          "Mark expected value"
        ],
        "warning": "Do not recommend or place these terms until Jubilee confirms which declared value it priced.",
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": [
          [
            "Schedule v3",
            "KES 462,000,000"
          ],
          [
            "Renewal quote v2",
            "KES 438,000,000"
          ],
          [
            "Difference",
            "KES 24,000,000"
          ],
          [
            "Likely cause",
            "Quote used older valuation"
          ]
        ]
      },
      "context": {
        "initials": "BP",
        "client": "BLUEWAVE PROPERTIES LTD",
        "title": "Document comparison",
        "number": "Schedule v3 ↔ Quote v2",
        "insurer": "Jubilee Allianz",
        "period": "Renewal 2026",
        "facts": [
          [
            "Conflict",
            "KES 24M"
          ],
          [
            "Confidence",
            "High"
          ],
          [
            "Action",
            "Clarify quote"
          ]
        ]
      }
    },
    {
      "id": "insurer-performance-report",
      "name": "Insurer performance report",
      "group": "Reports · Analysis",
      "clientId": null,
      "ask": "Which insurers take longest to respond to commercial motor quotes?",
      "lead": "Meridian has the slowest median response time this quarter.",
      "text": "I compared 84 quote requests and separated initial acknowledgements from usable terms. The pattern is evidence-backed but does not prove future performance.",
      "suggest": [
        "Why is Meridian slower?",
        "Save this report"
      ],
      "panel": {
        "type": "REPORT WORK",
        "title": "Commercial motor response times",
        "desc": "Usable terms received · Median calendar days.",
        "facts": [
          [
            "Meridian",
            "6.8 days"
          ],
          [
            "Jubilee Allianz",
            "4.9 days"
          ],
          [
            "CIC",
            "4.2 days"
          ],
          [
            "APA",
            "3.7 days"
          ]
        ],
        "issues": [
          [
            "",
            "Meridian delays are concentrated in fleets above 20 vehicles.",
            "PATTERN"
          ],
          [
            "green",
            "APA returned usable terms fastest in 71% of requests.",
            "OBSERVED"
          ]
        ],
        "actions": [
          "Open investigation",
          "Save report",
          "Create monitoring rule"
        ],
        "warning": null,
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "AS",
        "client": "ASAP BROKERAGE",
        "title": "Insurer response analysis",
        "number": "84 quote requests",
        "insurer": "Commercial motor markets",
        "period": "Q3 2026",
        "facts": [
          [
            "Slowest",
            "Meridian"
          ],
          [
            "Median",
            "6.8 days"
          ],
          [
            "Sample",
            "84"
          ]
        ]
      }
    },
    {
      "id": "cancellation-and-closure",
      "name": "Cancellation and closure",
      "group": "Exceptions · Closure",
      "clientId": "northstar",
      "ask": "The client wants to cancel this policy. What must happen?",
      "lead": "I’ve prepared the cancellation case, but it cannot be treated as closed yet.",
      "text": "Client instruction is available. Insurer confirmation, return-premium calculation, certificate recovery and commission adjustment remain separate dependencies.",
      "suggest": [
        "Prepare insurer request",
        "Show closure checks"
      ],
      "panel": {
        "type": "EXCEPTION WORK",
        "title": "Policy cancellation · 4 open checks",
        "desc": "Intent, insurer confirmation, money and documents kept separate.",
        "facts": [
          [
            "Client instruction",
            "Verified"
          ],
          [
            "Insurer confirmation",
            "Missing"
          ],
          [
            "Return premium",
            "Not calculated"
          ],
          [
            "Certificates",
            "2 outstanding"
          ]
        ],
        "issues": [],
        "actions": [
          "Review cancellation request",
          "Open closure checklist",
          "Assign certificate recovery"
        ],
        "warning": "The client’s request does not cancel cover. The policy remains active until valid insurer evidence is recorded.",
        "evidence": [],
        "draft": null,
        "timeline": [],
        "calc": [],
        "diff": []
      },
      "context": {
        "initials": "NT",
        "client": "NORTHSTAR TRADERS LTD",
        "title": "Goods in Transit · Cancellation",
        "number": "Policy GIT-2026-088",
        "insurer": "CIC General",
        "period": "Requested effective 30 Sep",
        "facts": [
          [
            "Status",
            "Cancellation requested"
          ],
          [
            "Cover",
            "Still active"
          ],
          [
            "Closure",
            "Blocked"
          ]
        ]
      }
    }
  ] as const;

export function scenarioById(id: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((s) => s.id === id);
}

/** Scenarios grouped for the presenter picker, in the approved catalogue order. */
export function scenarioGroups(): { group: string; scenarios: DemoScenario[] }[] {
  const out: { group: string; scenarios: DemoScenario[] }[] = [];
  for (const s of DEMO_SCENARIOS) {
    const found = out.find((g) => g.group === s.group);
    if (found) found.scenarios.push(s);
    else out.push({ group: s.group, scenarios: [s] });
  }
  return out;
}
