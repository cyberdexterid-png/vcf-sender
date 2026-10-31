# XHYPER VCF SENDER V2

A local-only, phone-number-only VCF utility with manual WhatsApp chat handoff. No API credentials are required.

## Features
- Import multiple VCF/vCard files; contact names are ignored and never shown or inserted into messages.
- Normalize and deduplicate phone numbers.
- Manually confirm recipient opt-in.
- Prepare friendly Sinhala messages with emojis.
- Open one WhatsApp chat at a time with a prefilled message.
- If WhatsApp Web is already linked in the browser, you can use that existing session.
- You review the message and press Send yourself.
- Export a phone-only VCF file.
- Contact data stays in the browser; server serves static files only.

## Run locally
Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://127.0.0.1:3000

## Limitations and responsible use
- No WhatsApp API credentials are needed.
- This app does not pair or control a personal Linked Device, automate WhatsApp Web, or send messages in the background.
- It opens a chat handoff only; you must press Send yourself.
- A valid phone format does not confirm a WhatsApp account.
- Only message people who explicitly agreed to receive your messages. Do not use scraped, purchased, or unsolicited lists; respect opt-outs.
- Message variations are for natural wording, not to disguise spam or evade enforcement. No delay guarantees that an account will not be restricted.

## Privacy
- VCF parsing, contact selection, previews, and export run in the browser.
- The server does not receive or store contacts, message contents, or API credentials.
- Server binds to 127.0.0.1 by default.
