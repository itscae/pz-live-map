/* ============================================================
   Knox Dispatch — cloud sync (runs on GitHub Actions, no PC)
   ------------------------------------------------------------
   Each run: pulls tracker.json off your PZ server over FTP,
   posts any NEW deaths to your Discord death-log channel, and
   saves tracker.json into the repo so the web map can read it.

   All secrets come from GitHub repo Secrets (never hard-coded):
     FTP_HOST  FTP_USER  FTP_PASS  FTP_PATH  DISCORD_WEBHOOK
   ============================================================ */

const ftp = require("basic-ftp");
const fs = require("fs");
const { Writable } = require("stream");

const FTP = {
  host: process.env.FTP_HOST,
  port: Number(process.env.FTP_PORT || 21),
  user: process.env.FTP_USER,
  password: process.env.FTP_PASS,
  secure: false,
};
const REMOTE = process.env.FTP_PATH || "Zomboid/Lua/KnoxDispatch/tracker.json";
const WEBHOOK = process.env.DISCORD_WEBHOOK || "";
const OUT = "tracker.json";
const SEEN = "posted.json";

const key = d => (d.name || "?") + "|" + (d.time || 0);

async function postDeath(d) {
  if (!WEBHOOK) return;
  const body = {
    embeds: [{
      title: "\u2620  " + (d.name || "A survivor") + " has fallen",
      color: 0xB5462F,
      fields: [
        { name: "Days survived", value: String(d.day ?? "?"), inline: true },
        { name: "Cause", value: String(d.cause || "unknown"), inline: true },
        { name: "Location", value: Math.round(d.x) + ", " + Math.round(d.y), inline: true },
      ],
      footer: { text: "Knox Dispatch \u00B7 Season 3" },
      timestamp: new Date((d.time || Date.now() / 1000) * 1000).toISOString(),
    }],
  };
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("Discord webhook error:", res.status, await res.text());
  else console.log("posted death:", d.name);
}

async function main() {
  // 1. pull the file over FTP
  const client = new ftp.Client(20000);
  let raw;
  try {
    await client.access(FTP);
    const chunks = [];
    const sink = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
    await client.downloadTo(sink, REMOTE);
    raw = Buffer.concat(chunks).toString("utf8");
  } finally {
    client.close();
  }
  fs.writeFileSync(OUT, raw);

  // 2. figure out which deaths are new
  let obj = {};
  try { obj = JSON.parse(raw); } catch { console.error("tracker.json did not parse"); }
  const deaths = Array.isArray(obj.deaths) ? obj.deaths : [];

  const firstRun = !fs.existsSync(SEEN);
  let seen = [];
  if (!firstRun) { try { seen = JSON.parse(fs.readFileSync(SEEN, "utf8")); } catch {} }
  const seenSet = new Set(seen);

  const fresh = deaths.filter(d => !seenSet.has(key(d)));

  // On the very first run, don't dump the whole history into Discord —
  // just record what already exists. Post only deaths that happen afterward.
  if (!firstRun) {
    for (const d of fresh) {
      try { await postDeath(d); } catch (e) { console.error("post failed:", e.message); }
    }
  } else {
    console.log("first run — recording " + deaths.length + " existing deaths, none posted");
  }

  deaths.forEach(d => seenSet.add(key(d)));
  fs.writeFileSync(SEEN, JSON.stringify([...seenSet]));
  console.log("done. players:", (obj.players || []).length, "deaths:", deaths.length);
}

main().catch(e => { console.error(e); process.exit(1); });
