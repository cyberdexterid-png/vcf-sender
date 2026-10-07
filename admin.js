const mongoose = require("mongoose");

const MONGO_URI = "mongodb+srv://cybereditzznew_db_user:FDwkCnIIEOmEsCw3@cluster0vcf.ogisxj8.mongodb.net/whatsapp_saas?retryWrites=true&w=majority";

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    plan: { type: String, default: "free" }
});

const User = mongoose.model("User", userSchema);

async function makeAdmin() {
    try {
        console.log("🔄 Connecting to MongoDB...");
        await mongoose.connect(MONGO_URI);
        
        const targetEmail = "ashensamarasinghe3@gmail.com";
        let user = await User.findOne({ email: targetEmail });
        
        if (!user) {
            console.log("⚠️ User not found. Forcing account creation for Admin...");
            user = new User({ email: targetEmail, password: "admin_oauth_bypass", role: "admin", plan: "premium" });
            await user.save();
            console.log(`✅ SUCCESS! ${targetEmail} artificially injected as PRO UNLIMITED Admin!`);
        } else {
            user.role = "admin";
            user.plan = "premium";
            await user.save();
            console.log(`✅ SUCCESS! ${targetEmail} upgraded to PRO UNLIMITED Admin!`);
        }
        
    } catch (e) {
        console.error("Error: ", e.message);
    } finally {
        mongoose.connection.close();
    }
}

makeAdmin();
