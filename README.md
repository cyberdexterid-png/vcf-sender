# XHYPER VCF SENDER V2

A local-first, phone-number-only contact workflow using the official WhatsApp Business Cloud API.

## Features
- Import multiple VCF/vCard files; **contact names are ignored** and never displayed or sent.
- Normalize and deduplicate phone numbers.
- Manually confirm recipient opt-in before a number enters the queue.
- Prepare a friendly Sinhala message without personalizing it with contact names.
- Start, pause, resume, and stop a queue for consent-confirmed recipients.
- Sends through the official WhatsApp Business Cloud API; no personal Linked Device automation.
- Local pacing limit of one message every 30 seconds and a per-session duplicate-recipient guard.
- Export a phone-only VCF file.
- Contact data stays in the browser; the server receives only the current recipient and message when sending.

## Requirements
- Node.js 20 or newer
- A Meta business app configured for WhatsApp Cloud API
- A WhatsApp Business sender phone-number ID and access token
- A supported Graph API version

Set these environment variables before starting the server:

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_API_VERSION` (for example, the currently supported version in your Meta app)

### Windows PowerShell example

```powershell
$env:WHATSAPP_TOKEN="YOUR_ACCESS_TOKEN"
$env:WHATSAPP_PHONE_NUMBER_ID="YOUR_PHONE_NUMBER_ID"
$env:WHATSAPP_GRAPH_API_VERSION="YOUR_SUPPORTED_GRAPH_VERSION"
npm install
npm start
```

Open http://127.0.0.1:3000

## WhatsApp policy and limitations
- Use only for people who explicitly opted in to receive messages from you.
- Do not import scraped, purchased, or unsolicited contact lists.
- Respect opt-outs immediately.
- The Cloud API may require an approved message template when messaging outside the 24-hour customer-service window.
- A phone-number format check does not establish whether the recipient uses WhatsApp.
- The local 30-second pacing limit is a conservative app guard, **not** a way to avoid enforcement or a guarantee against restrictions.
- This project does not automate a personal Linked Device, probe WhatsApp accounts, or randomize messages to disguise bulk outreach.

## Privacy and security
- Bind to 127.0.0.1 by default.
- Never commit access tokens to GitHub. Set secrets as environment variables.
- This minimal local app has no login; do not expose it publicly.
- The in-memory sending guard resets when the server restarts.
