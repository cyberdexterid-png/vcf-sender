const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const pino = require("pino");
const mongoose = require("mongoose");

// --- GLOBAL ERROR HANDLING (CRASH PREVENTION) ---
process.on('uncaughtException', (err) => {
    console.error('🔥 [FATAL] Uncaught Exception globally caught:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 [FATAL] Unhandled Rejection globally caught:', reason);
});

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    delay,
    downloadMediaMessage,
    generateWAMessageFromContent,
    proto
} = require("@whiskeysockets/baileys");

const yts = require("yt-search");
const ytdl = require("@distube/ytdl-core");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

// --- SAAS CLOUD DATABASE SETUP (MongoDB) ---
// To connect your free remote DB, run this server with: 
// MONGO_URI="mongodb+srv://..." node server.js
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://cybereditzznew_db_user:FDwkCnIIEOmEsCw3@cluster0vcf.ogisxj8.mongodb.net/whatsapp_saas?retryWrites=true&w=majority";

// We wrap the connection so it doesn't crash the server if URI is empty
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB Cloud Database"))
    .catch(err => {
        console.error("❌ MongoDB Connection Error. Are you sure your MONGO_URI is correct?");
        console.error("Database connection failed. User accounts will not work until Database is linked.", err.message);
    });

// Define MongoDB Schemas
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    plan: { type: String, default: "free" },
    dailySent: { type: Number, default: 0 },
    lastReset: { type: String, default: () => new Date().toISOString().split('T')[0] },
    adminNumber: { type: String, default: "" },
    autoSaveEnabled: { type: Boolean, default: false },
    googleAccessToken: { type: String, default: "" },
    autoReplies: [{ keyword: String, reply: String, imageBase64: String, voiceBase64: String, imageUrl: String }]
});
const User = mongoose.model("User", userSchema);

const licenseSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }
});
const LicenseKey = mongoose.model("LicenseKey", licenseSchema);


// Track multi-tenant sessions in active memory (ephemeral)
const sessions = {}; 

// --- Utility Functions ---
function parseSpintax(text) {
    if (!text) return text;
    let matches, options, random;
    const regEx = /\{([^{}]+)\}/g;
    while ((matches = regEx.exec(text)) !== null) {
        options = matches[1].split("|");
        random = Math.floor(Math.random() * options.length);
        text = text.replace(matches[0], options[random]);
        regEx.lastIndex = 0;
    }
    return text;
}

function getInvisibleId(length = 3) {
   const zeroWidthSpaces = ["\u200B", "\u200C", "\u200D", "\uFEFF"];
   let str = "";
   for(let i=0; i<length; i++) {
       str += zeroWidthSpaces[Math.floor(Math.random() * zeroWidthSpaces.length)];
   }
   return str;
}

function extractNumbers(vcfText) {
    if (!vcfText) return [];
    const telRegex = /TEL;.*?:([+\d\s-]+)/g;
    let numbers = [];
    let match;
    while ((match = telRegex.exec(vcfText)) !== null) {
        let n = match[1].replace(/\D/g, "");
        if (n.length >= 9) numbers.push(n);
    }
    if (numbers.length === 0) {
        const rawMatches = vcfText.match(/\+?\d{9,15}/g);
        if (rawMatches) numbers = rawMatches.map(n => n.replace(/\D/g, ""));
    }
    return [...new Set(numbers)];
}

function getDefaultNumbers() {
    let text = "";
    if (fs.existsSync("contacts.vcf.vcf")) text = fs.readFileSync("contacts.vcf.vcf", "utf8");
    else if (fs.existsSync("contacts.vcf")) text = fs.readFileSync("contacts.vcf", "utf8");
    else if (fs.existsSync("numbers.json")) text = fs.readFileSync("numbers.json", "utf8");
    return extractNumbers(text);
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

// --- WhatsApp Core (Multi-Tenant) ---
async function startUserWA(email, socketIoClient) {
    if (sessions[email]) {
        sessions[email].socketIo = socketIoClient;
        if (sessions[email].sock?.authState?.creds?.registered) {
            socketIoClient.emit("info", { msg: "WhatsApp connection restored." });
        }
        return;
    }

    // Notice: Free cloud hosts (Render/Heroku) will wipe this folder when they deploy or sleep.
    // Ensure you use a free persistent disk OR a cheap VPS (Hostinger) so users don't get logged out!
    const folderName = "auth_data_" + email.replace(/[^a-zA-Z0-9]/g, '');
    const { state, saveCreds } = await useMultiFileAuthState(folderName);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" })
    });

    sessions[email] = { sock, socketIo: socketIoClient, isSending: false, paused: false, stopped: false };

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        const currentSocket = sessions[email]?.socketIo;
        
        if (connection === "open") {
            if (currentSocket) {
                currentSocket.emit("info", { msg: "WhatsApp connected successfully. Ready to broadcast." });
                currentSocket.emit("wa_connected");
            }
            if (sock && sock.user && sock.user.id) {
                sock.sendMessage(sock.user.id, { text: "🟢 *SYSTEM CONNECTED*\nYour WhatsApp device has been successfully paired to the Safe Sender PRO Engine." }).catch(console.error);
            }
        }

        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== 401;
            if (shouldReconnect) {
                if (currentSocket) currentSocket.emit("info", { msg: "Reconnecting WhatsApp..." });
                setTimeout(() => {
                    delete sessions[email];
                    startUserWA(email, currentSocket || socketIoClient);
                }, 4000);
            } else {
                if (currentSocket) currentSocket.emit("info", { msg: "WhatsApp logged out." });
                fs.rmSync(folderName, { recursive: true, force: true });
                delete sessions[email];
            }
        }
    });


    sock.ev.on("messages.upsert", async m => {
        try {
            const msg = m.messages[0];
            if (!msg.message) return;

            const isFromMe = msg.key.fromMe;
            
            const dbUser = await User.findOne({ email: email });
            if (!dbUser) return;

            // --- AUTO STATUS VIEWER & MEMORY CACHE ---
            if (msg.key.remoteJid === 'status@broadcast') {
                if (!isFromMe) {
                    try {
                        const targetParticipant = msg.key.participant || msg.participant;
                        if (!sessions[email].statusMem) sessions[email].statusMem = {};
                        if (!sessions[email].statusMem[targetParticipant]) sessions[email].statusMem[targetParticipant] = [];
                        
                        sessions[email].statusMem[targetParticipant].push(msg);
                        
                        // Prevent memory leak by capping statuses stored per person
                        if (sessions[email].statusMem[targetParticipant].length > 15) {
                            sessions[email].statusMem[targetParticipant].shift();
                        }
                        
                        await sock.readMessages([msg.key]);
                    } catch(e) {}
                }
                return;
            }
            // -------------------------------------

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            if (!text) return;
            
            const isAdmin = dbUser.adminNumber && msg.key.remoteJid === (dbUser.adminNumber + '@s.whatsapp.net');

            // --- GLOBAL EMOJI REACTION HACK ---
            const reactCmd = async (emoji="⚡") => {
                if(!isFromMe && !isAdmin) return;
                try { await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }); } catch(e){}
            };

            // --- AI BOT COMMANDS & MENU ---
            if (isFromMe || isAdmin) {
                if (text.toLowerCase().startsWith('.allstatus ')) {
                    await reactCmd("⬇️");
                    let rawNum = text.substring(11).trim().replace(/\D/g, '');
                    if (!rawNum) return;
                    if (!rawNum.includes('@s.whatsapp.net')) rawNum += '@s.whatsapp.net';
                    
                    const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const targetChat = isFromMe ? myJid : msg.key.remoteJid;
                    
                    if (!sessions[email].statusMem || !sessions[email].statusMem[rawNum] || sessions[email].statusMem[rawNum].length === 0) {
                        await sock.sendMessage(targetChat, { text: "❌ *No active status found in Memory Cache for this target.*" }, { quoted: msg });
                        return;
                    }
                    
                    await sock.sendMessage(targetChat, { text: `⏳ *Extracting ${sessions[email].statusMem[rawNum].length} Statuses from Memory Cache...*` });
                    
                    for (let statusMsg of sessions[email].statusMem[rawNum]) {
                        try {
                            const isImage = !!statusMsg.message.imageMessage;
                            const isVideo = !!statusMsg.message.videoMessage;
                            
                            if (isImage || isVideo) {
                                const buffer = await downloadMediaMessage(
                                    statusMsg, 'buffer', {}, { logger: pino({ level: 'silent' }) }
                                );
                                if (isImage) await sock.sendMessage(targetChat, { image: buffer, caption: "⬇️ *XHYPER EXTRACTION*" });
                                else await sock.sendMessage(targetChat, { video: buffer, caption: "⬇️ *XHYPER EXTRACTION*" });
                            } else if (statusMsg.message.extendedTextMessage || statusMsg.message.conversation) {
                                const statusText = statusMsg.message.extendedTextMessage?.text || statusMsg.message.conversation;
                                await sock.sendMessage(targetChat, { text: `⬇️ *XHYPER EXTRACTION*\n\n${statusText}` });
                            }
                        } catch (e) {
                            console.error("Historical Status Extractor Error", e.message);
                        }
                    }
                    return;
                } else if (text.toLowerCase() === '.menu' || text.toLowerCase() === '.cmd') {
                    await reactCmd("🤖");
                    const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const targetChat = isFromMe ? myJid : msg.key.remoteJid;
                    
                    const textMenu = `🤖 *XHYPER FX AI ENGINE*\n_System Online. Waiting for Commands..._\n\n`
                                       + `──────────────────────\n`
                                       + `🎵 *.song [name]*\n  ↳ _Search & Download Audio_\n\n`
                                       + `📸 *.dp [number]*\n  ↳ _Extract Target Profile Pic_\n\n`
                                       + `⬇️ *.save* (Reply to Status)\n  ↳ _Download Current Status_\n\n`
                                       + `📥 *.allstatus [number]*\n  ↳ _Extract All Cached Statuses_\n\n`
                                       + `👁️ *.vv* (Reply to View Once)\n  ↳ _Decrypt View-Once Payloads_\n`
                                       + `──────────────────────`;
                    await sock.sendMessage(targetChat, { text: textMenu }, { quoted: msg });
                    return;
                } else if (text.toLowerCase().startsWith('.song ')) {
                await reactCmd("🎵");
                const query = text.substring(6).trim();
                if (query) {
                    await sock.sendMessage(msg.key.remoteJid, { text: `🎵 *XHYPER FX AI BOT*\n\n🎧 _Searching YouTube for:_ *${query}*` }, { quoted: msg });
                    const { videos } = await yts(query);
                    if (videos && videos.length > 0) {
                        const video = videos[0];
                        await sock.sendMessage(msg.key.remoteJid, { 
                            image: { url: video.thumbnail }, 
                            caption: `🎵 *XHYPER FX AUDIO ENGINE*\n\n📌 *Target:* ${video.title}\n⏱️ *Duration:* ${video.timestamp}\n👀 *Views:* ${video.views}\n\n_⚡ Extracting neural payload... Please hold._` 
                        }, { quoted: msg });
                        try {
                            const apiUrl = `https://supunmd.vercel.app/api/download/ytmp3/dl?url=${video.url}&quality=320k&apikey=supunmd-5zcco8gcrsuxusei745h`;
                            const response = await axios.get(apiUrl);
                            
                            if (response.data && response.data.status && response.data.data && response.data.data.downloadUrl) {
                                const dlUrl = response.data.data.downloadUrl;
                                const audioResponse = await axios.get(dlUrl, { responseType: 'arraybuffer' });
                                const buffer = Buffer.from(audioResponse.data, 'binary');

                                await sock.sendMessage(msg.key.remoteJid, { 
                                    audio: buffer, 
                                    mimetype: 'audio/mpeg',
                                    ptt: false
                                }, { quoted: msg });
                            } else {
                                await sock.sendMessage(msg.key.remoteJid, { text: "❌ API failed to return a valid download URL." }, { quoted: msg });
                            }
                        } catch(e) {
                            await sock.sendMessage(msg.key.remoteJid, { text: "❌ Downloader encountered an API format error." }, { quoted: msg });
                        }
                    } else {
                        await sock.sendMessage(msg.key.remoteJid, { text: "❌ No results found on YouTube." }, { quoted: msg });
                    }
                }
                return;
            } else if (text.toLowerCase().startsWith('.dp ')) {
                await reactCmd("📸");
                let rawNum = text.substring(4).trim().replace(/\D/g, '');
                if (rawNum) {
                    if (!rawNum.includes('@s.whatsapp.net')) rawNum += '@s.whatsapp.net';
                    try {
                        const ppUrl = await sock.profilePictureUrl(rawNum, 'image');
                        await sock.sendMessage(msg.key.remoteJid, { image: { url: ppUrl }, caption: `📸 *XHYPER PROFILE EXTRACTOR*\n\n📌 *Target:* ${rawNum.split('@')[0]}\n_⚡ Extracted successfully via Neural DB._` }, { quoted: msg });
                    } catch(e) {
                        await sock.sendMessage(msg.key.remoteJid, { text: "❌ Could not retrieve profile picture. Number might be hidden, invalid, or no DP is set." }, { quoted: msg });
                    }
                }
                return;
            } else if (text.toLowerCase().startsWith('.get') || text.toLowerCase().startsWith('.save')) {
                await reactCmd("⬇️");
                const contextInfo = msg.message.extendedTextMessage?.contextInfo;
                if (contextInfo && contextInfo.remoteJid === 'status@broadcast') {
                    try {
                        const quotedMsg = {
                            key: {
                                remoteJid: contextInfo.remoteJid,
                                id: contextInfo.stanzaId,
                                participant: contextInfo.participant
                            },
                            message: contextInfo.quotedMessage
                        };
                        
                        const isImage = !!quotedMsg.message.imageMessage;
                        const isVideo = !!quotedMsg.message.videoMessage;
                        
                        const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                        const targetChat = isFromMe ? myJid : msg.key.remoteJid;
                        
                        if (isImage || isVideo) {
                            if (!isFromMe) await sock.sendMessage(msg.key.remoteJid, { text: "⏳ *Extracting Status...*" });
                            
                            const buffer = await downloadMediaMessage(
                                quotedMsg,
                                'buffer',
                                {},
                                { logger: pino({ level: 'silent' }) }
                            );
                            
                            if (isImage) {
                                await sock.sendMessage(targetChat, { image: buffer, caption: "✅ *XHYPER STATUS SAVER*\n\n_Media extracted and secured._" });
                            } else {
                                await sock.sendMessage(targetChat, { video: buffer, caption: "✅ *XHYPER STATUS SAVER*\n\n_Media extracted and secured._" });
                            }
                            if (isFromMe) await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                        } else if (quotedMsg.message.extendedTextMessage || quotedMsg.message.conversation) {
                            const statusText = quotedMsg.message.extendedTextMessage?.text || quotedMsg.message.conversation;
                            await sock.sendMessage(targetChat, { text: `✅ *XHYPER STATUS SAVER*\n\n${statusText}` });
                            if (isFromMe) await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                        }
                    } catch (e) {
                         if (!isFromMe) await sock.sendMessage(msg.key.remoteJid, { text: "❌ Failed to extract target status." });
                         console.error("Status DL Error", e);
                    }
                }
                return;
            } else if (text.toLowerCase() === '.vv' || text.toLowerCase() === '.getvv') {
                await reactCmd("👁️");
                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) {
                    await sock.sendMessage(msg.key.remoteJid, { text: "❌ Please reply to a View Once message with this command." }, { quoted: msg });
                    return;
                }
                
                const viewOnce = quotedMsg.viewOnceMessageV2 || quotedMsg.viewOnceMessage || quotedMsg.viewOnceMessageV2Extension;
                if (!viewOnce || !viewOnce.message) {
                    await sock.sendMessage(msg.key.remoteJid, { text: "❌ This is not a View Once message." }, { quoted: msg });
                    return;
                }
                
                try {
                    const mediaType = Object.keys(viewOnce.message)[0];
                    const buffer = await downloadMediaMessage(
                        { message: viewOnce.message },
                        'buffer',
                        {},
                        { logger: pino({ level: 'silent' }) }
                    );

                    let payload = {};
                    if (mediaType === 'imageMessage') payload = { image: buffer, caption: "👁️ *XHYPER ANTI-VV CAPTURED*\n\n_View-Once protocol bypassed successfully._" };
                    else if (mediaType === 'videoMessage') payload = { video: buffer, caption: "👁️ *XHYPER ANTI-VV CAPTURED*\n\n_View-Once protocol bypassed successfully._" };
                    else if (mediaType === 'audioMessage') payload = { audio: buffer, mimetype: 'audio/mp4', ptt: true };
                    
                    const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const targetChat = isFromMe ? myJid : msg.key.remoteJid;
                    await sock.sendMessage(targetChat, payload, { quoted: msg });
                } catch(e) {
                    await sock.sendMessage(msg.key.remoteJid, { text: "❌ Failed to decrypt View Once payload." }, { quoted: msg });
                }
                return;
            }
            // --- END BOT COMMANDS ---
            }
            
            if (isFromMe) return; // Prevent bot from triggering auto-replies to itself

            const contactJid = msg.key.remoteJid;
            
            // --- XHYPER CRM: GOOGLE AUTO-SAVER ---
            if (dbUser.autoSaveEnabled && contactJid.endsWith('@s.whatsapp.net') && !contactJid.includes('-')) {
                if (!sessions[email].crmState) sessions[email].crmState = {};
                const state = sessions[email].crmState[contactJid];
                
                if (state === "WAITING_DETAILS") {
                    if (text.length >= 2) {
                        try {
                            let parsedName = "New Lead";
                            let age = "N/A";
                            let town = "N/A";
                            
                            if (text.includes('/')) {
                                [parsedName, age, town] = text.split('/').map(t => t.trim());
                            } else if (text.includes(',')) {
                                [parsedName, age, town] = text.split(',').map(t => t.trim());
                            } else {
                                parsedName = text.trim();
                            }
                            
                            const finalName = parsedName || "New Lead";
                            const cleanPhone = contactJid.split('@')[0];
                            
                            sessions[email].socketIo?.emit("crm_log", `Target responded: [${text}]`);
                            sessions[email].socketIo?.emit("crm_log", `Extracting CRM Vector -> Name: ${finalName} | Age: ${age||'N/A'} | Town: ${town||'N/A'}`);
                            
                            let googleSuccess = false;
                            if (dbUser.googleAccessToken) {
                                try {
                                    const googleEndpoint = "https://people.googleapis.com/v1/people:createContact";
                                    await axios.post(googleEndpoint, {
                                        names: [{ givenName: finalName, familyName: "- XHYPER" }],
                                        phoneNumbers: [{ value: cleanPhone }],
                                        biographies: [{ value: `Age: ${age || 'N/A'}\nTown: ${town || 'N/A'}` }]
                                    }, { headers: { Authorization: `Bearer ${dbUser.googleAccessToken}` } });
                                    googleSuccess = true;
                                    sessions[email].socketIo?.emit("crm_log", `✅ System Sync: Bound [${cleanPhone}] to Google Contacts via Native Bearer.`);
                                } catch(e) {
                                    sessions[email].socketIo?.emit("crm_log", `⚠️ Google Sync Failure (Token Expired?): Deploying Fail-Safe VCF.`);
                                }
                            }

                            if (!googleSuccess && dbUser.adminNumber) {
                                const vcard = 'BEGIN:VCARD\n'
                                            + 'VERSION:3.0\n' 
                                            + `FN:${finalName} - XHYPER\n`
                                            + `TEL;type=CELL;type=VOICE;waid=${cleanPhone}:+${cleanPhone}\n`
                                            + `NOTE:Age: ${age || 'N/A'} | Town: ${town || 'N/A'}\n`
                                            + 'END:VCARD';
                                await sock.sendMessage(dbUser.adminNumber + '@s.whatsapp.net', { 
                                    contacts: { displayName: finalName, contacts: [{ vcard }] } 
                                });
                                sessions[email].socketIo?.emit("crm_log", `✅ Remote Sink Active: Uploaded VCF signature to Master Admin Number.`);
                            }
                            
                            sessions[email].crmState[contactJid] = "SAVED";
                            await sock.sendMessage(contactJid, { react: { text: "✅", key: msg.key } });
                            await sock.sendMessage(contactJid, { text: "✅ *Target Secured*\n\nYour details are successfully saved to my Database! 🚀\n_(Oyaage visthara mage Contacts walata save kala!)_" }, { quoted: msg });
                            sessions[email].socketIo?.emit("crm_log", `Target engagement completed. Secured in Database.`);
                        } catch (e) {
                            console.error("CRM Sync Error:", e.message);
                            sessions[email].socketIo?.emit("crm_log", `❌ Fatal Syntax parsing bypass. Error details buried.`);
                            sessions[email].crmState[contactJid] = "SAVED"; 
                        }
                    }
                    return; 
                }
                
                if (!state && text && !text.startsWith('.')) {
                    sessions[email].crmState[contactJid] = "WAITING_DETAILS";
                    sessions[email].socketIo?.emit("crm_log", `New Unsaved Lead Intercepted: +${contactJid.split('@')[0]}`);
                    sessions[email].socketIo?.emit("crm_log", `Executing Neural Probe (Name/Age/Town) request...`);
                    
                    await sock.sendMessage(contactJid, { react: { text: "👋", key: msg.key } });
                    await sock.sendMessage(contactJid, { 
                        text: "👋 *XHYPER SYSTEM INTERCEPT*\n\nHello! I am an Automated AI. Please provide your *Name / Age / Town* to formally save your contact to my database.\n\n_(Karunakara oyaage Nama / Wayasa / Gama evanna.)_" 
                    }, { quoted: msg });
                    return;
                }
            }

            if (!dbUser.autoReplies || dbUser.autoReplies.length === 0) return;

            for (let rule of dbUser.autoReplies) {
                 if (text.toLowerCase().includes(rule.keyword.toLowerCase())) {
                     await sock.readMessages([msg.key]);
                     try { await sock.sendMessage(contactJid, { react: { text: "⚡", key: msg.key } }); } catch(e){}
                     
                     if (rule.imageUrl) {
                         let finalImg = rule.imageUrl;
                         if (finalImg.includes('ibb.co') && !finalImg.match(/\.(jpeg|jpg|gif|png)$/i)) {
                             try {
                                 const res = await axios.get(finalImg);
                                 const metaMatch = res.data.match(/property="og:image" content="(.*?)"/);
                                 if (metaMatch && metaMatch[1]) finalImg = metaMatch[1];
                             } catch(e) { console.error("ImageBB Bypass failed"); }
                         }
                         await sock.sendMessage(msg.key.remoteJid, { image: { url: finalImg }, caption: rule.reply || "" });
                     } else if (rule.voiceUrl) {
                         await sock.sendMessage(msg.key.remoteJid, { audio: { url: rule.voiceUrl }, ptt: true, mimetype: 'audio/mp4' });
                     } else if (rule.imageBase64) {
                         const buffer = Buffer.from(rule.imageBase64.split(",")[1], 'base64');
                         await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: rule.reply || "" });
                     } else if (rule.voiceBase64) {
                         const buffer = Buffer.from(rule.voiceBase64.split(",")[1], 'base64');
                         await sock.sendMessage(msg.key.remoteJid, { audio: buffer, ptt: true, mimetype: 'audio/mp4' });
                     } else if (rule.reply) {
                         await sock.sendMessage(msg.key.remoteJid, { text: rule.reply });
                     }
                     break;
                 }
            }
        } catch(e) {
            console.error("AutoResponder Error:", e.message);
        }
    });
}

async function startSend({ email, vcfData, message, countryCode, minDelay, maxDelay }) {
    const session = sessions[email];
    if (!session || session.isSending) return;
    
    let currentSocket = session.socketIo;
    
    if (!session.sock) {
        currentSocket.emit("info", { msg: "Error: WhatsApp not connected yet." });
        currentSocket.emit("done");
        return;
    }

    // Refresh DB limits synchronously from MongoDB
    const user = await User.findOne({ email });
    if (!user) return;
    
    let numbers = [];
    if (vcfData && vcfData.length > 5) {
        currentSocket.emit("info", { msg: "Parsing uploaded VCF data..." });
        numbers = extractNumbers(vcfData);
    } else {
        currentSocket.emit("info", { msg: "No file uploaded. Reading default directory files..." });
        numbers = getDefaultNumbers();
    }

    if (numbers.length === 0) {
        currentSocket.emit("info", { msg: "Error: No valid numbers found." });
        currentSocket.emit("done");
        return;
    }
    
    // Enforce 50 Daily Limit for Free Users
    if (user.plan !== "premium") {
        if (user.dailySent >= 50) {
            currentSocket.emit("info", { msg: `ERROR: Daily Free Limit (50) reached! Please upgrade with a License Key.` });
            currentSocket.emit("done");
            return;
        }
        
        // Capping broadcast
        if ((user.dailySent + numbers.length) > 50) {
            let allowed = 50 - user.dailySent;
            numbers = numbers.slice(0, allowed);
            currentSocket.emit("info", { msg: `WARNING: Capping broadcast to ${allowed} messages to prevent exceeding your daily 50 limit.` });
        }
    }

    session.isSending = true;
    session.paused = false;
    session.stopped = false;

    currentSocket.emit("info", { msg: `Found ${numbers.length} valid unique contacts to broadcast.` });

    let count = 0;
    for (let num of numbers) {
        if (session.stopped) {
            currentSocket.emit("info", { msg: "Broadcast halted by user." });
            break;
        }
        while (session.paused) {
            await delay(2000);
        }

        count++;

        let targetNum = num;
        if (targetNum.startsWith("0")) targetNum = countryCode + targetNum.substring(1);
        else if (targetNum.length <= 10 && !targetNum.startsWith(countryCode) && !targetNum.startsWith("94") && !targetNum.startsWith("1")) {
            targetNum = countryCode + targetNum;
        }

        let jid = targetNum + "@s.whatsapp.net";

        try {
            const waResult = await session.sock.onWhatsApp(jid);
            if (!waResult || waResult.length === 0 || !waResult[0].exists) {
                console.log("skip", targetNum);
                currentSocket.emit("progress", { current: count, total: numbers.length, action: "skip", number: `${targetNum} (Invalid)` });
                continue; 
            }

            let parsedMessage = parseSpintax(message);
            let finalMsg = parsedMessage + getInvisibleId(Math.floor(Math.random() * 6) + 2);
            
            await session.sock.sendMessage(jid, { text: finalMsg });
            
            // Increment MongoDB Cloud Database Limits
            if (user.plan !== "premium") {
                user.dailySent += 1;
                await user.save();
                currentSocket.emit("update_user", { plan: user.plan, dailySent: user.dailySent });
            }
            
            currentSocket.emit("progress", { current: count, total: numbers.length, action: "sent", number: targetNum });

        } catch (err) {
            currentSocket.emit("progress", { current: count, total: numbers.length, action: "skip", number: targetNum });
        }

        if (count < numbers.length && !session.stopped) {
            let waitTime = randomDelay(minDelay, maxDelay);
            currentSocket.emit("info", { msg: `Waiting ${Math.floor(waitTime/1000)}s before next message...` });
            await delay(waitTime);
        }
    }

    currentSocket.emit("info", { msg: "Broadcast Cycle Completed!" });
    currentSocket.emit("done");
    session.isSending = false;
}

// --- Socket API ---
io.on("connection", (socket) => {
    let currentUser = null;

    socket.on("google_login", async ({ email }) => {
        try {
            let user = await User.findOne({ email });
            
            // Auto Register Google Users into MongoDB Database
            if (!user) {
                // Generate a random placeholder password since MongoDB schema requires it safely
                const randomPass = Math.random().toString(36).slice(-10);
                user = new User({ email, password: randomPass });
                await user.save();
            }

            currentUser = email;
            
            // Check midnight limit reset
            const today = new Date().toISOString().split('T')[0];
            if (user.lastReset !== today) {
                user.dailySent = 0;
                user.lastReset = today;
                await user.save();
            }
            
            socket.emit("login_success", { email: user.email, plan: user.plan, dailySent: user.dailySent, role: user.role });
            socket.emit("crm_status_sync", user.autoSaveEnabled);
            startUserWA(email, socket);
        } catch (err) {
            socket.emit("login_failed", "Database Google Sign-In Error. Verify MONGO_URI.");
        }
    });

    socket.on("bind_google_crm", async ({ email, googleAccessToken }) => {
        if (!currentUser) return;
        const dbUser = await User.findOne({ email: currentUser });
        if(dbUser) {
            dbUser.googleAccessToken = googleAccessToken;
            await dbUser.save();
            socket.emit("info", { msg: "✅ CRM Database securely linked to Google APIs." });
        }
    });

    socket.on("toggle_auto_save_crm", async () => {
        if (!currentUser) return;
        const dbUser = await User.findOne({ email: currentUser });
        if(dbUser) {
            dbUser.autoSaveEnabled = !dbUser.autoSaveEnabled;
            await dbUser.save();
            socket.emit("crm_status_sync", dbUser.autoSaveEnabled);
            socket.emit("info", { msg: `Auto-Saver CRM is now ${dbUser.autoSaveEnabled ? "ACTIVE (🟢)" : "OFF (🔴)"}` });
        }
    });

    socket.on("upgrade", async ({ key }) => {
        if (!currentUser) return;
        
        try {
            const validKey = await LicenseKey.findOne({ key: key });
            if (validKey) {
                await LicenseKey.deleteOne({ key: key }); // Burn the key
                
                const user = await User.findOne({ email: currentUser });
                user.plan = "premium";
                await user.save();

                socket.emit("upgrade_success", { plan: user.plan });
                socket.emit("info", { msg: "✨ Upgrade Successful! You now have PRO UNLIMITED access." });

                // Internal WhatsApp Auto-Sender
                if (sessions[currentUser] && sessions[currentUser].sock && sessions[currentUser].sock.user) {
                    try {
                        const userJid = sessions[currentUser].sock.user.id;
                        await sessions[currentUser].sock.sendMessage(userJid, { 
                            text: "💎 *PRO UNLIMITED DEPLOYED*\n\nCongratulations! Your Safe Sender account has been securely upgraded via License Key.\n\n🚀 Your 50-message daily limit has been destroyed.\n\n_System Admin_" 
                        });
                    } catch (e) {
                        console.error("Failed to send internal upgrade message:", e.message);
                    }
                }
            } else {
                socket.emit("upgrade_failed", "Invalid or Expired License Key Detected.");
                socket.emit("info", { msg: "Invalid or expired License Key." });
            }
        } catch (err) {
            socket.emit("info", { msg: "Database verification failed." });
        }
    });

    socket.on("get_auto_replies", async () => {
        if (!currentUser) return;
        const dbUser = await User.findOne({ email: currentUser });
        if(dbUser) {
            socket.emit("auto_replies_data", dbUser.autoReplies || []);
            socket.emit("admin_target_data", dbUser.adminNumber || "");
        }
    });

    socket.on("set_admin", async ({ adminNumber }) => {
        if (!currentUser) return;
        const dbUser = await User.findOne({ email: currentUser });
        if(dbUser.plan !== "premium") return socket.emit("info", { msg: "Admin Control is a PRO-Only feature!" });
        dbUser.adminNumber = adminNumber;
        await dbUser.save();
        socket.emit("info", { msg: `👑 Remote Bot Admin set successfully.` });
        socket.emit("admin_target_data", dbUser.adminNumber);
    });

    socket.on("add_auto_reply", async ({ keyword, reply, imageBase64, voiceBase64, imageUrl, voiceUrl }) => {
        if (!currentUser) return;
        const dbUser = await User.findOne({ email: currentUser });
        if(dbUser.plan !== "premium") return socket.emit("info", { msg: "AutoResponder is a PRO-Only feature!" });
        dbUser.autoReplies.push({ keyword, reply, imageBase64, voiceBase64, imageUrl, voiceUrl });
        await dbUser.save();
        socket.emit("auto_replies_data", dbUser.autoReplies);
        socket.emit("info", { msg: `Auto-Reply added for keyword: "${keyword}"` });
    });

    socket.on("remove_auto_reply", async ({ index }) => {
        if (!currentUser) return;
        const dbUser = await User.findOne({ email: currentUser });
        dbUser.autoReplies.splice(index, 1);
        await dbUser.save();
        socket.emit("auto_replies_data", dbUser.autoReplies);
    });

    socket.on("fetch_groups", async () => {
        if (!currentUser || !sessions[currentUser]) return;
        const dbUser = await User.findOne({ email: currentUser });
        if(dbUser.plan !== "premium") return socket.emit("info", { msg: "Group Scraper is a PRO-Only feature!" });
        
        let sock = sessions[currentUser].sock;
        socket.emit("info", { msg: "🕵️ Scanning WhatsApp metadata for your groups..." });
        try {
            const groups = await sock.groupFetchAllParticipating();
            let groupList = [];
            for (let jid in groups) {
                groupList.push({
                    id: jid,
                    subject: groups[jid].subject || "Unknown Group",
                    size: groups[jid].participants?.length || 0
                });
            }
            socket.emit("groups_data", groupList);
            socket.emit("info", { msg: `✅ Found ${groupList.length} groups connected to your device.` });
        } catch (e) {
            socket.emit("info", { msg: "Failed to fetch groups. " + e.message });
        }
    });

    socket.on("scrape_target_group", async ({ groupId }) => {
        if (!currentUser || !sessions[currentUser]) return;
        const dbUser = await User.findOne({ email: currentUser });
        if(dbUser.plan !== "premium") return socket.emit("info", { msg: "Access Denied." });
        
        let sock = sessions[currentUser].sock;
        socket.emit("info", { msg: "🕵️ Extracting isolated group architecture..." });
        try {
            const groupMetadata = await sock.groupMetadata(groupId);
            let extracted = [];
            groupMetadata.participants.forEach(p => {
                let num = p.id.split('@')[0];
                extracted.push(num);
            });
            extracted = [...new Set(extracted)];
            socket.emit("scraper_result", extracted.join('\n'));
            socket.emit("info", { msg: `🔥 Flawlessly extracted ${extracted.length} targets from [${groupMetadata.subject || "Group"}]!` });
        } catch (e) {
            socket.emit("info", { msg: "Failed to extract target group." });
        }
    });

    socket.on("create_bulk_group", async ({ groupName, vcfData }) => {
        if (!currentUser || !sessions[currentUser]) return;
        const dbUser = await User.findOne({ email: currentUser });
        if(dbUser.plan !== "premium") return socket.emit("info", { msg: "Group Architect is a PRO-Only feature!" });
        
        let sock = sessions[currentUser].sock;
        socket.emit("info", { msg: `🏛️ Constructing Group Framework: "${groupName}"...` });
        
        try {
            const numbers = [];
            const regex = /(?:TEL;.*?:|)(\+?\d+)/g;
            let match;
            while ((match = regex.exec(vcfData)) !== null) {
                let num = match[1].replace(/\D/g, '');
                if (num) numbers.push(num + '@s.whatsapp.net');
            }
            const uniqueJids = [...new Set(numbers)];
            
            if(uniqueJids.length === 0) {
                socket.emit("info", { msg: `❌ Protocol Failed: Could not identify any valid targets in the payload.` });
                return socket.emit("group_architect_done");
            }
            
            socket.emit("info", { msg: `Architecting Group with ${uniqueJids.length} identical constraints...` });
            await sock.groupCreate(groupName, uniqueJids);
            
            socket.emit("info", { msg: `✅ DEPLOYMENT SUCCESSFUL! Target Group "${groupName}" cleanly instantiated.` });
            socket.emit("group_architect_done");
            
        } catch (e) {
            socket.emit("info", { msg: `❌ Group Architect failure. WhatsApp blocked bulk injection. Err: ${e.message.substring(0, 50)}...` });
            socket.emit("group_architect_done");
        }
    });

    socket.on("request_pair", async ({ phone }) => {
        if (!currentUser || !sessions[currentUser]) return;
        let sock = sessions[currentUser].sock;
        
        if (!sock.authState.creds.registered) {
            try {
                let code = await sock.requestPairingCode(phone);
                socket.emit("pairing_code", code);
            } catch (e) {
                socket.emit("info", { msg: "Pairing error: " + e.message });
            }
        } else {
            socket.emit("wa_connected");
            socket.emit("info", { msg: "Already connected to WhatsApp!" });
        }
    });

    socket.on("start_broadcast", (data) => {
        if (!currentUser) return;
        data.email = currentUser;
        startSend(data);
    });

    socket.on("pause", () => {
        if (currentUser && sessions[currentUser]) {
            sessions[currentUser].paused = true;
            socket.emit("info", { msg: "System paused." });
        }
    });

    socket.on("resume", () => {
        if (currentUser && sessions[currentUser]) {
            sessions[currentUser].paused = false;
            socket.emit("info", { msg: "System resumed." });
        }
    });

    socket.on("stop", () => {
        if (currentUser && sessions[currentUser]) {
            sessions[currentUser].stopped = true;
            socket.emit("info", { msg: "System stopping..." });
        }
    });

    socket.on("logout", () => {
        if (currentUser && sessions[currentUser]) {
            sessions[currentUser].stopped = true;
        }
        currentUser = null;
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Cloud SaaS API Server Running on Port: ${PORT}`);
});