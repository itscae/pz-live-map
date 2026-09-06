const SftpClient = require("ssh2-sftp-client");
const fs = require("fs");

const CFG = {
  host: process.env.FTP_HOST,
  port: Number(process.env.FTP_PORT || 22),
  username: process.env.FTP_USER,
  password: process.env.FTP_PASS,
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
  const sftp = new SftpClient();
  let raw;
  try {
    await sftp.connect(CFG);
    const buf = await sftp.get(REMOTE);
    raw = buf.toString("utf8");
  } finally {
    sftp.end().catch(() => {});
  }
  fs.writeFileSync(OUT, raw);

  let obj = {};
  try { obj = JSON.parse(raw); } catch { console.error("tracker.json did not parse"); }
  const deaths = Array.isArray(obj.deaths) ? obj.deaths : [];

  const firstRun = !fs.existsSync(SEEN);
  let seen = [];
  if (!firstRun) { try { seen = JSON.parse(fs.readFileSync(SEEN, "utf8")); } catch {} }
  const seenSet = new Set(seen);
  const fresh = deaths.filter(d => !seenSet.has(key(d)));

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
