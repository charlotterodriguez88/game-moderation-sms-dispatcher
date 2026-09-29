# A Guide to SMS Alerts API (Sender Registration and Compliance)

Short answer: keep message templates and routing rules in the dispatch application, then place a narrow sending adapter between that application and any SMS API. For a startup operating in the US and EU, “easy integration” should mean that sender registration, consent evidence, regional identity rules, and delivery events fit this boundary. A five-line send call is not the deciding factor.

Consider a marketplace contact form that says, “Boiler leaking, tenant home after 17:30.” The useful outcome is not an accepted API request. It is the correct support queue receiving the request, the assigned technician getting an appropriate alert, and operations being able to tell what happened without exposing the customer’s message in logs. **The dispatch system should own the meaning of the message.** The transport should carry it and report its status.

## How should an SMS alerts API handle sender registration and compliance?

The plain-language flow is short. Validate the contact form, classify it into a queue, select a versioned template for the recipient’s region and language, resolve an approved sender identity, submit the message through an adapter, and store the provider-neutral message ID. Delivery callbacks then update the same record. If SMS cannot be used for that recipient, the application follows an explicitly configured fallback policy rather than improvising one during an outage.

This split matters in a notebook-to-production workflow. A classifier can improve independently through an evaluation set, while message wording remains reviewable by support and compliance owners. It also prevents a prompt change from silently rewriting an urgent dispatch alert.

That boundary is the test.

Here is a small runnable example. The transport is deliberately fake: the valuable part is the contract around it.

```python
from dataclasses import dataclass
from enum import Enum
from hashlib import sha256
from typing import Protocol


class DeliveryState(str, Enum):
    QUEUED = "queued"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"


@dataclass(frozen=True)
class DispatchRequest:
    request_id: str
    country_code: str
    issue: str
    technician_phone: str


@dataclass(frozen=True)
class SendResult:
    external_id: str
    state: DeliveryState


class SmsTransport(Protocol):
    def send(self, *, sender_key: str, recipient: str, body: str) -> SendResult:
        ...


TEMPLATES = {
    "urgent_plumbing:v3": (
        "Urgent job {request_id}: possible water leak. "
        "Open the dispatch app for customer details."
    ),
    "standard:v2": (
        "New job {request_id} is ready. Open the dispatch app for details."
    ),
}


def choose_queue(issue: str) -> str:
    normalized = issue.casefold()
    urgent_terms = ("leak", "flood", "no heat")
    return "urgent_plumbing" if any(term in normalized for term in urgent_terms) else "standard"


def sender_key_for(country_code: str) -> str:
    # Configuration maps these stable keys to registered regional identities.
    return "us_dispatch" if country_code == "US" else "eu_dispatch"


def notify(request: DispatchRequest, transport: SmsTransport) -> SendResult:
    queue = choose_queue(request.issue)
    template_key = "urgent_plumbing:v3" if queue == "urgent_plumbing" else "standard:v2"
    body = TEMPLATES[template_key].format(request_id=request.request_id)
    return transport.send(
        sender_key=sender_key_for(request.country_code),
        recipient=request.technician_phone,
        body=body,
    )


def idempotency_key(request_id: str, template_key: str, recipient: str) -> str:
    material = f"{request_id}|{template_key}|{recipient}".encode("utf-8")
    return sha256(material).hexdigest()
```

Two details are easy to miss. The SMS contains a request ID but no address, phone number, or free-form issue text; the authenticated dispatch app can reveal those details. Also, `sender_key_for` returns an internal key, not a literal sender ID. Deployment configuration must map that key to an identity valid for the destination and traffic type.

The keyword rule is intentionally modest. If an AI classifier replaces it, I would keep the function boundary and build an eval set from labeled routing examples before changing production behavior. False “standard” classifications matter more than an impressive aggregate score, so the test report should show errors by queue. Prompt tokens also have a cost; there is little reason to send a full customer narrative when a compact, redacted feature set is sufficient.

## Template ownership is the real selection test

Templates carry operational policy. They decide which facts appear on a lock screen, how an urgent job differs from routine work, what localized text is sent, and which version produced a disputed notification. Those decisions belong beside application review, tests, and release history.

A transport-managed template can still be useful where a channel or jurisdiction requires pre-approval. The trade-off is that the API account becomes part of the content deployment process. Teams then need a mapping from an application template version to the corresponding remote template identifier, plus a promotion check that fails before traffic is sent with a missing or stale mapping.

I would evaluate an API with one uncomfortable exercise: change `urgent_plumbing:v3` to `v4`, keep `v3` available for rollback, and explain who approves, deploys, audits, and retires each version. If the answer depends on editing production text in a dashboard with no application-level record, template ownership is in the wrong place for this system.

**Keep one canonical template catalog even when delivery requires a registered copy elsewhere.** The catalog can store the text, version, locale, purpose, expected variables, and the external identifier used in each region. That makes drift detectable.

## Registration and consent are workflow states

US application-to-person messaging over 10-digit long-code numbers has a registration workflow covering the brand and campaign, as documented in the A2P 10DLC reference below. Registration is therefore not a string field labeled `from`. It is release state with owners, evidence, and lead time. EU delivery cannot be represented by one universal “EU sender” assumption. The deployment needs a country-by-country matrix reviewed against the intended traffic and current rules. Store the approved sender key and allowed use case as configuration; reject an unsupported combination before calling the transport. Consent deserves the same treatment. Record what the person agreed to, when, through which surface, and which recipient address or number was involved. Keep that evidence separate from delivery logs, because “the carrier accepted this message” does not establish why it was permissible to send. Transactional dispatch alerts and promotional campaigns should also have distinct purposes and paths. Do not let a marketing import reuse a transactional sender merely because both ultimately produce SMS. For a marketplace contact form, the contact itself may be the customer while the SMS recipient is a technician. That distinction changes the evidence question: the system needs authorization and preferences for the actual recipient, not a consent flag copied from the customer record.

Recipient identity wins.

## Delivery tracking needs a state machine

An API acceptance response means the transport accepted a submission. It is not proof that a handset received or displayed the alert. Normalize callback events into a small internal state machine and retain the raw event outside the hot path for investigation. State transitions should be monotonic: a delayed `sent` callback must not move an already `delivered` record backward.

Accepted is not delivered.

Callbacks need authentication according to the transport’s documented mechanism, replay resistance, idempotent processing, and correlation to the stored external ID. Respond quickly, then process asynchronously. A callback containing an unknown ID should be quarantined for inspection instead of creating a new dispatch record.

Retries are where duplicate technician alerts appear. Use a stable idempotency key derived from the dispatch request, template version, and recipient. Retry only outcomes classified as retryable by the adapter, with bounded attempts and jitter. After the limit, put the job in an operator-visible state. Never switch sender identities or channels silently just to turn the dashboard green.

The useful observability view joins business and transport signals without copying message bodies into telemetry. Track queue, region, template version, submission state, final known state, callback age, attempt count, and time from contact-form receipt to assignment. Hash or tokenize recipient identifiers. **Alert on stuck transitions and dispatch latency, not raw send volume alone.**

## How I would compare integrations

Start with a test account and one registered production path, but score the boundary that remains after the demo. Can the adapter accept an application idempotency key? Are status meanings documented well enough to normalize? Can callbacks be verified and replayed in a test harness? Can sender configuration be separated by environment and destination? Can delivery data be exported without message content?

Then exercise failure cases: duplicate callbacks, callbacks arriving out of order, an unknown external ID, a disabled regional sender, a timeout after submission, and a template mapping that has not reached production. One happy-path message proves very little.

The final check is organizational. Name the owner for templates, registration evidence, consent records, routing evaluations, delivery investigations, and credential rotation. A startup can assign several roles to one person, but the responsibilities still need names. Before launch, run the routing eval suite, verify template hashes and regional mappings, send controlled probes, confirm callback authentication, inspect redacted logs, and rehearse rollback to the previous template version. Revisit the country matrix and sender registrations when traffic purpose or geography changes.

This produces a less flashy integration and a much more useful dispatch system. The application controls intent; replaceable adapters control transport. That boundary keeps compliance evidence, model evaluation, prompt cost, content review, and delivery operations visible to the people accountable for them.

## Further reading

- Google, “Email sender guidelines”: https://support.google.com/a/answer/81126
- Twilio, “US A2P 10DLC compliance documentation”: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
