import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = path.join(process.cwd(), "verified_real_leads");
const MASTER_DB_PATH = path.join(OUTPUT_DIR, "permanent_master_leads.json");
const ARCHIVE_DIR = path.join(OUTPUT_DIR, "daily_archives");

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

const apiKey = process.env.GEMINI_API_KEY;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchLiveLeadsFromWeb() {
    const serperKey = process.env.SERPER_API_KEY;
    if (!serperKey) return [];

    const platformQueries = [
        "site:facebook.com \"want to go to canada\" OR \"uk study visa\" OR \"australia work permit\" (Nepal OR India)",
        "site:instagram.com \"#canadavisa\" OR \"#ukvisa\" OR \"#australiaimmigration\" (Nepal OR India)",
        "site:linkedin.com \"visa sponsorship canada\" OR \"europe work visa requirement\" (Nepal OR India)",
        "site:quora.com OR site:reddit.com \"moving to canada\" OR \"study in uk\" OR \"europe work permit\" Nepal India"
    ];

    const randomQuery = platformQueries[Math.floor(Math.random() * platformQueries.length)];

    try {
        const response = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
                "X-API-KEY": serperKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ q: randomQuery, num: 20, tbs: "qdr:d" })
        });

        const data = await response.json();
        if (data && data.organic) {
            return data.organic.map(item => ({
                title: item.title,
                snippet: item.snippet,
                link: item.link,
                sourcePlatform: new URL(item.link).hostname.replace('www.', ''),
                publishedTime: item.date || "Recent / Just now"
            }));
        }
    } catch (err) {
        console.error("[ERROR] Serper fetch failed:", err.message);
    }
    return [];
}

function saveUniqueLeads(newLeads) {
    let existingLeads = [];
    if (fs.existsSync(MASTER_DB_PATH)) {
        try {
            existingLeads = JSON.parse(fs.readFileSync(MASTER_DB_PATH, "utf8"));
        } catch (e) {
            existingLeads = [];
        }
    }

    const existingContacts = new Set(existingLeads.map(l => l.contactDetails));

    newLeads.forEach(lead => {
        if (lead.contactDetails && !existingContacts.has(lead.contactDetails)) {
            existingLeads.unshift({
                ...lead,
                dateAdded: new Date().toISOString(),
                status: "Qualified (New)"
            });
            existingContacts.add(lead.contactDetails);
        }
    });

    fs.writeFileSync(MASTER_DB_PATH, JSON.stringify(existingLeads, null, 2));
    
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyPath = path.join(ARCHIVE_DIR, `leads_${todayStr}.json`);
    fs.writeFileSync(dailyPath, JSON.stringify(existingLeads, null, 2));

    return existingLeads;
}

async function qualifyLeadsWithGemini(rawSnippets) {
    if (!apiKey) return [];

    const prompt = `You are a strict lead extraction agent for an overseas immigration and visa consultancy. 
    Target Markets: Nepal (Priority 1) and India (Priority 2).
    CRITICAL EXCLUSION: Do not include Gulf countries. Only Western destinations (Canada, Australia, UK, Europe, etc.).
    Analyze these raw snippets:
    ${JSON.stringify(rawSnippets, null, 2)}
    Return strictly as a JSON array of objects with keys: 
    fullName, location, desiredDestination, visaType, contactDetails, conversionScore, sourceLink, sourcePlatform, publishedTime, aiReasoning. If none, return [].`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        const data = await response.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            let rawText = data.candidates[0].content.parts[0].text.trim();
            const leads = JSON.parse(rawText);
            if (Array.isArray(leads)) return leads;
        }
    } catch (err) {
        console.error("[ERROR] Gemini fetch failed:", err.message);
    }
    return [];
}

async function startAutonomousPipeline() {
    console.log("🚀 ImmiLeadAI Autonomous Background Pipeline Active...");
    while (true) {
        try {
            const rawSnippets = await fetchLiveLeadsFromWeb();
            if (rawSnippets.length > 0) {
                const qualifiedLeads = await qualifyLeadsWithGemini(rawSnippets);
                if (qualifiedLeads.length > 0) {
                    saveUniqueLeads(qualifiedLeads);
                }
            }
        } catch (err) {
            console.error("[ERROR] Pipeline loop error:", err.message);
        }
        await sleep(120000);
    }
}

app.get("/", (req, res) => {
    try {
        if (fs.existsSync(MASTER_DB_PATH)) {
            const leads = JSON.parse(fs.readFileSync(MASTER_DB_PATH, "utf8"));
            return res.json({ 
                success: true, 
                service: "ImmiLeadAI Autonomous Agent", 
                count: leads.length, 
                leads 
            });
        } else {
            return res.json({ 
                success: true, 
                service: "ImmiLeadAI Autonomous Agent", 
                count: 0, 
                leads: [], 
                message: "Initializing first live batch, please refresh in a minute..." 
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ ImmiLeadAI Server running on port ${PORT}`);
    startAutonomousPipeline();
});
