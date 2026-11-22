# Sample inputs

Expected outcomes for each applicant live in `src/mocks/scenarios.ts`.

| Input | Applicant | Product | Path |
|---|---|---|---|
| `portal-form.json` | Jane Doe | personal | approve → FUNDED |
| `broker-email.txt` | Sam Patel | auto | missing bill of sale → AWAITING_DOCUMENTS → upload → FUNDED (run twice: duplicate rejected) |
| `aggregator-batch.json` rec-001 | Alex Nguyen | debt consolidation | approve → FUNDED |
| `aggregator-batch.json` rec-002 | Priya Shah | personal | borderline credit → IN_REVIEW |
| `aggregator-batch.json` rec-003 | Chris Martin | auto | poor credit → DECLINED |
| `aggregator-batch.json` rec-004 | Morgan Lee | debt consolidation | good credit, over product cap → DECLINED |
| `aggregator-batch.json` rec-005 | Taylor Brooks | personal | good credit, high fraud risk → IN_REVIEW |

Documents demo:

```bash
npm run broker
npm run upload-docs -- broker:ref-88412@northpoint-brokers.example vehicle_bill_of_sale
```

Failure demos (set when starting the worker):

- `FRAUD_OUTAGE=1 npm run worker`: fraud provider is down; enrichment retries until you restart without it
- `IDENTITY_NOT_FOUND=jane.doe@example.com npm run worker`: identity check fails permanently for Jane
