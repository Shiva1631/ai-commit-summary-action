const https = require("https");
const fs = require("fs");

// ---------- HTTP ----------
function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// ---------- ANALYSIS ----------
function analyzeCommit(diff, message, files) {
  const points = [];
  const lower = message.toLowerCase();

  let type = "chore";
  let risk = "Low";

  if (lower.includes("fix")) {
    type = "bug fix";
    points.push("- Bug fix implemented");
    risk = "Medium";
  }

  if (lower.includes("feat") || lower.includes("add")) {
    type = "feature";
    points.push("- New functionality added");
    risk = "Medium";
  }

  if (lower.includes("refactor")) {
    type = "refactor";
    points.push("- Code refactored");
  }

  if (diff.includes("fetch") || diff.includes("axios")) {
    points.push("- API/data fetching updated");
    risk = "Medium";
  }

  if (diff.includes("useEffect") || diff.includes("useState")) {
    points.push("- React logic updated");
  }

  if (files.length > 5) {
    points.push("- Multiple files impacted");
    risk = "High";
  }

  if (diff.length > 2000) {
    risk = "High";
  }

  if (points.length === 0) {
    points.push("- General improvements");
  }

  points.push(`- Risk Level: ${risk}`);

  return {
    summary: points.join("\n"),
    type,
    risk
  };
}

// ---------- MAIN ----------
async function run() {
  try {
    const githubToken = process.env.INPUT_GITHUB_TOKEN;
    if (!githubToken) throw new Error("Missing GitHub token");

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

    const eventData = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")
    );

    if (!eventData.pull_request) return;

    const prNumber = eventData.pull_request.number;

    console.log(`Processing PR #${prNumber}`);

    // ---------- GET COMMITS ----------
    const commits = await request({
      hostname: "api.github.com",
      path: `/repos/${owner}/${repo}/pulls/${prNumber}/commits`,
      method: "GET",
      headers: {
        Authorization: `token ${githubToken}`,
        "User-Agent": "ai-action"
      }
    });

    if (!Array.isArray(commits)) {
      console.error("Commit fetch failed:", commits);
      throw new Error("Commits API failed");
    }

    let fullSummary = `## 🤖 AI PR Summary\n\n`;
    let combinedRisk = "Low";

    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit.commit.message;

      console.log(`Processing ${sha}`);

      const commitData = await request({
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/commits/${sha}`,
        method: "GET",
        headers: {
          Authorization: `token ${githubToken}`,
          "User-Agent": "ai-action"
        }
      });

      if (!commitData.files) continue;

      const files = commitData.files;

      const diff = files
        .map((f) => f.patch || "")
        .join("\n")
        .slice(0, 3000);

      const { summary, type, risk } = analyzeCommit(diff, message, files);

      if (risk === "High") combinedRisk = "High";
      else if (risk === "Medium" && combinedRisk !== "High")
        combinedRisk = "Medium";

      fullSummary += `### 🔹 ${message}\n\n`;
      fullSummary += `${summary}\n\n`;
    }

    fullSummary += `---\n\n### ⚠️ Overall Risk: ${combinedRisk}\n`;

    // ---------- FIND EXISTING COMMENT ----------
    const comments = await request({
      hostname: "api.github.com",
      path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      method: "GET",
      headers: {
        Authorization: `token ${githubToken}`,
        "User-Agent": "ai-action"
      }
    });

    const existing = comments.find((c) =>
      c.body.includes("## 🤖 AI PR Summary")
    );

    if (existing) {
      // ---------- UPDATE ----------
      await request(
        {
          hostname: "api.github.com",
          path: `/repos/${owner}/${repo}/issues/comments/${existing.id}`,
          method: "PATCH",
          headers: {
            Authorization: `token ${githubToken}`,
            "User-Agent": "ai-action",
            "Content-Type": "application/json"
          }
        },
        { body: fullSummary }
      );

      console.log("Updated existing comment");
    } else {
      // ---------- CREATE ----------
      await request(
        {
          hostname: "api.github.com",
          path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
          method: "POST",
          headers: {
            Authorization: `token ${githubToken}`,
            "User-Agent": "ai-action",
            "Content-Type": "application/json"
          }
        },
        { body: fullSummary }
      );

      console.log("Created new summary comment");
    }

    console.log("✅ Done");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

run();
