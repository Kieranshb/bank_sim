// Signal and query definitions, imported by both the workflow and the clients.
import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { ApplicationState, LoanDocument, ReviewDecision } from './types';

// Reviewer decision (human-in-the-loop)
export const submitDecisionSignal = defineSignal<[ReviewDecision]>('submitDecision');

// Applicant uploaded missing documents
export const documentsUploadedSignal = defineSignal<[LoanDocument[]]>('documentsUploaded');

// Current state for the console / CLI
export const getStatusQuery = defineQuery<ApplicationState>('getStatus');

// Next step: use an Update instead of a signal for submitDecision so the
// reviewer gets a validated response (e.g. reject a decision if not IN_REVIEW).
