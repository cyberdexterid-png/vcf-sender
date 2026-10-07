const mongoose = require('mongoose');

// Your securely hardcoded MongoDB Cloud Connection
const MONGO_URI = "mongodb+srv://cybereditzznew_db_user:FDwkCnIIEOmEsCw3@cluster0vcf.ogisxj8.mongodb.net/whatsapp_saas?retryWrites=true&w=majority";

// The Collection Schema inside MongoDB
const licenseSchema = new mongoose.Schema({
    key: String,
    created: { type: Date, default: Date.now } // Tracks when the key was created
});

const LicenseKey = mongoose.model('LicenseKey', licenseSchema);

async function generateKeys() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ Authenticated with MongoDB ATLAS.");
        console.log("🔥 Generating 5 New Admin PRO License Keys...\n");

        for(let i=0; i<5; i++) {
            // Generates a totally random key like: PRO-A1G7B-9XYZ
            const randomChunk1 = Math.random().toString(36).substring(2, 7).toUpperCase();
            const randomChunk2 = Math.random().toString(36).substring(2, 6).toUpperCase();
            const newKey = `PRO-${randomChunk1}-${randomChunk2}`;
            
            await LicenseKey.create({ key: newKey });
            console.log(`[+] SUCCESS: ${newKey}`);
        }

        console.log("\n✅ Keys successfully injected into your cloud database!");
        console.log("You can now give these to customers for them to paste into the 'Unlock Premium' tab.");
        process.exit(0);
        
    } catch (err) {
        console.error("Database Error:", err);
        process.exit(1);
    }
}

generateKeys();
