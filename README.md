# XHYPER VCF SENDER V2

A free, local-first VCF contact utility. No account, login, database, or remote contact storage.

## Features
- Import multiple VCF/vCard files in the browser
- Parse contact names and phone numbers
- Detect duplicate phone numbers and remove duplicates from the working list
- Validate phone-number format (format validation is **not** WhatsApp account detection)
- Manually mark contacts only when you have permission to message them
- Personalize a message with the `{name}` placeholder
- Open one approved contact's WhatsApp chat at a time; review and press Send yourself
- Export a cleaned VCF file
- Contact data remains in the browser tab and is not sent to this server

## Run locally
Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://127.0.0.1:3000

## Important limitations
- The app cannot reliably determine whether a phone number has a WhatsApp account.
- It does not automate sending, probe accounts, randomize messages to evade anti-spam systems, or promise ban avoidance.
- Only message people who have clearly agreed to receive your messages. Respect opt-outs.
- The default server binds to 127.0.0.1. Do not expose this local utility publicly without adding appropriate security controls.

## Privacy
VCF parsing, contact selection, previews, and export run in the browser. The server only serves the static application and a health endpoint.
