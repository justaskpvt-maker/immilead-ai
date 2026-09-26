async function fetchLiveLeadsFromWeb() {
    const serperKey = process.env.SERPER_API_KEY;
    if (!serperKey) return [];

    const platformQueries = [
        "site:facebook.com \"want to go to\" OR \"visa for\" (Nepal OR India) (Canada OR UK OR Europe OR Australia OR Germany OR New Zealand)",
        "site:instagram.com \"#canadavisa\" OR \"#ukvisa\" OR \"#europeimmigration\" (Nepal OR India)",
        "site:linkedin.com \"visa sponsorship\" OR \"work permit\" (Nepal OR India) (Europe OR Canada OR UK OR Germany)",
        "site:quora.com OR site:reddit.com \"moving from Nepal to\" OR \"moving from India to\" (Canada OR Europe OR UK OR Australia)"
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
