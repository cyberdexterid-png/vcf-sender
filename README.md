# XHYPER VCF SENDER V2

Local-first VCF contact utility with WhatsApp Linked Device pairing by phone-number pairing code. No WhatsApp Business API key is required.

## Features
- Pair your own WhatsApp account using an 8-digit Linked Device pairing code (Baileys).
- Persist the linked-device session locally in `auth_data_local/`.
- Show connection status and disconnect the active socket.
- Import multiple VCF/vCard files; parse phone numbers only and ignore contact names.
- Normalize and deduplicate phone numbers.
- Manually mark recipients only after they explicitly opt in.
- Prepare friendly Sinhala message templates and open one approved WhatsApp chat at a time with a prefilled message.
- The user must review each message and press Send in WhatsApp.
- Export phone-only VCF files.

## Run locally
Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://127.0.0.1:3000

## Pair your phone
1. Start the local app.
2. Enter your own WhatsApp phone number with country code, digits only (Sri Lanka example: 947XXXXXXXX).
3. Click **Get pairing code**.
4. On your phone, open WhatsApp → Linked Devices → Link a Device → Link with phone number instead.
5. Enter the code displayed in the app.

The session is stored in `auth_data_local/` and reused after restart. Keep that folder private and never commit or share it. This is an unofficial WhatsApp Web client library, not the official WhatsApp Business API; WhatsApp may change or restrict unofficial clients.

## Responsible-use limits
- Pair only an account you own or are authorized to manage.
- This project does not provide bulk auto-sending, ban-evasion, contact scraping, or WhatsApp account probing.
- The message workflow opens a single chat for review; you press Send yourself.
- Only contact people who explicitly opted in, and respect opt-outs. No delay can guarantee an account will not be restricted.

## Privacy
- The server binds to 127.0.0.1 by default.
- Contact import and filtering run in the browser.
- WhatsApp session credentials are stored locally under `auth_data_local/`.
