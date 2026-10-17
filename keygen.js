
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_FILE = path.join(__dirname, "database.json");

function generateKey() {
    const part1 = crypto.randomBytes(4)
        .toString("hex").slice(0, 5).toUpperCase();

    const part2 = crypto.randomBytes(4)
        .toString("hex").slice(0, 4).toUpperCase();

    return `PRO-${part1}-${part2}`;
}

function generateKeys() {
    try {
        let database = { users: {}, license_keys: [] };

        if (fs.existsSync(DB_FILE)) {
            database = JSON.parse(
                fs.readFileSync(DB_FILE, "utf8")
            );
        }

        if (!Array.isArray(database.license_keys)) {
            database.license_keys = [];
        }

        const existingKeys = new Set(database.license_keys);
        const newKeys = [];

        while (newKeys.length < 5) {
            const key = generateKey();

            if (!existingKeys.has(key)) {
                existingKeys.add(key);
                newKeys.push(key);
            }
        }

        database.license_keys.push(...newKeys);

        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(database, null, 2),
            "utf8"
        );

        console.log("Generated 5 new PRO license keys:\n");
        newKeys.forEach(key => console.log(`[+] ${key}`));
        console.log("\nSaved to database.json");
    } catch (error) {
        console.error("Error:", error.message);
        process.exitCode = 1;
    }
}

generateKeys();
