# Adaptive: Product and Architecture Research

## Scope

This document summarizes Adaptive’s publicly described product workflow for an accounting hackathon. It is an independent analysis, not a copy of Adaptive’s private implementation.

## What Adaptive is

Adaptive is an AI-native project-accounting platform for construction companies. It works alongside existing accounting and project-management systems instead of replacing the general ledger.

Its target customers include general contractors, specialty trades, developers, and accounting firms supporting construction businesses.

Public website: https://www.adaptive.build/

## Core product insight

Construction accountants need two continuously updated inputs:

1. **Financial numbers** — invoices, card charges, commitments, change orders, bank activity, budgets, and ledger data.
2. **Field context** — voice updates, text messages, emails, daily logs, meeting transcripts, and jobsite photos.

Adaptive combines those inputs to identify financial problems before the next month-end or WIP meeting.

## Main workflows

### AP Clerk

- Ingests vendor invoices.
- Assigns the correct project and cost code.
- Routes bills for approval.
- Detects duplicate or suspicious invoices.
- Sends reviewed data to the existing ERP.

### WIP and Forecasting Analyst

- Combines job costs, billings, commitments, and field updates.
- Tracks project margin and revenue.
- Forecasts cash and profitability.
- Flags delays, cost overruns, and missed change orders.

### Change Order Clerk

- Monitors emails, contracts, and field updates for changes.
- Drafts change-order documentation.
- Checks contract requirements and approval status.
- Tracks deadlines before work becomes unrecoverable.

### Billings Clerk

- Prepares cost-plus, fixed-price, and AIA-style billings.
- Uses approved job costs as supporting evidence.
- Routes billing for field or customer approval.

### Compliance Clerk

- Collects lien waivers, W-9s, and insurance certificates.
- Tracks missing or expired documents.
- Blocks payment when required compliance documents are missing.

### Field Coordinator

- Contacts supers and project managers by voice, text, or email.
- Collects structured updates without requiring field workers to learn another application.
- Converts informal updates into accounting-relevant facts.

## Publicly visible operating model

```text
ERP / bank / card / inbox data
                +
Voice / SMS / email / daily logs / photos
                ↓
        AI workflow agent
                ↓
Extraction, coding, matching, forecasting
                ↓
     Exceptions and recommended actions
                ↓
          Human review
                ↓
       ERP or payment workflow
```

The important control is that the AI prepares and checks work, while a human retains accounting judgment and approval authority before changes reach the books.

## Recommended accounting hackathon MVP

Build one narrow workflow instead of attempting to reproduce the entire Adaptive platform:

### Invoice Control Agent

The agent receives an approved quote or purchase order and a vendor invoice. It extracts the invoice data, compares it with the approved commitment, explains any mismatch, and requests human approval before payment.

### Demo flow

1. Upload or enter an approved quote.
2. Receive or upload a vendor invoice.
3. Extract vendor, line items, quantities, prices, tax, deposit, and total.
4. Compare the invoice with the approved quote.
5. Mark it as `matched` or `exception`.
6. Show the exact discrepancy and financial impact.
7. Ask an authorized person to approve, reject, or hold payment.
8. Record the complete audit trail.

### Example exception

```text
Invoice held

Approved quote: $4,500
Invoice total:  $5,200
Difference:     +$700

Deposit in quote:   $1,000
Deposit on invoice: $1,500

Reason: invoice does not match the approved commitment.
Required action: human approval.
```

## Suggested data model

```ts
type LineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
};

type Commitment = {
  id: string;
  vendor: string;
  project: string;
  lineItems: LineItem[];
  total: number;
  approvedAt?: string;
};

type Invoice = {
  id: string;
  vendor: string;
  commitmentId: string;
  lineItems: LineItem[];
  total: number;
  status: "received" | "matched" | "held" | "approved" | "paid";
};

type Exception = {
  field: string;
  expected: string | number;
  actual: string | number;
  difference?: number;
  reason: string;
};
```

## Agent design

Use a strict separation of responsibilities:

- **AI:** reads documents, extracts fields, classifies messages, summarizes discrepancies, and drafts communications.
- **Application code:** calculates totals, compares amounts, checks approval limits, prevents duplicate payments, and changes workflow state.
- **Human:** approves exceptions, releases payments, and applies accounting judgment.

This makes the demo safer, easier to explain, and easier to test.

## Hackathon feature priorities

### Must have

- Invoice and quote input.
- Structured extraction.
- Deterministic invoice matching.
- Exception dashboard.
- Human approval step.
- Audit log.

### Good additions

- Duplicate-invoice detection.
- Budget-versus-actual warning.
- SMS or email approval.
- PDF evidence attached to every extracted field.
- Simulated payment after approval.

### Avoid for the first version

- Full ERP replacement.
- Real banking or payment movement.
- Complex construction revenue recognition.
- Every Adaptive agent at once.
- Automatic posting to a general ledger.

## Reverse-engineering boundaries

Adaptive’s public website reveals its product concepts and customer workflow. It does not reveal private source code, internal prompts, backend services, databases, or production decision rules.

The REA project can analyze websites through page structure, scripts, network observations, and screenshots. Use it only for lawful research and only against systems you are authorized to examine.

REA repository: https://github.com/morluto/rea

## Sources

- Adaptive homepage: https://www.adaptive.build/
- Adaptive construction accounting product page: https://www.adaptive.build/construction-accounting-software
- Adaptive “How it works”: https://www.adaptive.build/product/how-it-works
- REA GitHub repository: https://github.com/morluto/rea
