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

  let risk = "Low";

  if (lower.includes("fix")) {
    points.push("• Bug fix implemented");
    risk = "Medium";
  }

  if (lower.includes("feat") || lower.includes("add")) {
    points.push("• New functionality added");
    risk = "Medium";
  }

  if (lower.includes("refactor")) {
    points.push("• Code refactored");
  }

  if (diff.includes("fetch") || diff.includes("axios")) {
    points.push("• API/data fetching updated");
    risk = "Medium";
  }

  if (diff.includes("useEffect") || diff.includes("useState")) {
    points.push("• React logic updated");
  }

  if (files.length > 5 || diff.length > 2000) {
    risk = "High";
  }

  if (points.length === 0) {
    points.push("• General improvements");
  }

  return {
    summary: points.join("\n"),
    risk
  };
}

// ---------- COMMENT HANDLER ----------
async function postOrUpdateComment(owner, repo, prNumber, githubToken, fullSummary) {
  const comments = await request({
    hostname: "api.github.com",
    path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      "User-Agent": "ai-action"
    }
  });

  console.log("Fetched comments:", comments?.length || 0);

  const existing = Array.isArray(comments)
    ? comments.find((c) => c.body && c.body.includes("## 🤖 AI Commit Summary"))
    : null;

  let response;

  if (existing) {
    console.log("Updating existing comment:", existing.id);

    response = await request(
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
  } else {
    console.log("Creating new PR comment");

    response = await request(
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
  }

  console.log("Comment API response:", JSON.stringify(response, null, 2));

  if (!response || response.message) {
    console.error("❌ Comment failed:", response);

    if (response?.message === "Bad credentials") {
      throw new Error("Invalid GitHub token");
    }

    if (response?.message === "Resource not accessible by integration") {
      throw new Error("Permission issue → use pull_request_target + issues: write");
    }
  } else {
    console.log("✅ Comment posted/updated successfully");
  }
}

// ---------- MAIN ----------
async function run() {
  try {
    const githubToken = process.env.INPUT_GITHUB_TOKEN;
    if (!githubToken) throw new Error("Missing GitHub token");

    console.log("Token present:", !!githubToken);

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

    const eventData = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")
    );

    if (!eventData.pull_request) {
      console.log("Not a PR event");
      return;
    }

    const prNumber = eventData.pull_request.number;

    console.log(`Processing PR #${prNumber}`);

    // ---------- FETCH COMMITS ----------
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

    let fullSummary = `## 🤖 AI Commit Summary\n\n`;
    let overallRisk = "Low";

    // ---------- LOOP ----------
    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit?.commit?.message || "No commit message";

      console.log(`Processing ${sha} - ${message}`);

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

      const { summary, risk } = analyzeCommit(diff, message, files);

      if (risk === "High") overallRisk = "High";
      else if (risk === "Medium" && overallRisk !== "High")
        overallRisk = "Medium";

      fullSummary += `### 🔹 Commit\n`;
      fullSummary += `**Message:** ${message}\n`;
      fullSummary += `**SHA:** \`${sha.substring(0, 7)}\`\n\n`;
      fullSummary += `${summary}\n\n`;
      fullSummary += `**Risk:** ${risk}\n\n---\n\n`;
    }

    fullSummary += `### ⚠️ Overall PR Risk: ${overallRisk}\n`;

    // ---------- COMMENT ----------
    await postOrUpdateComment(owner, repo, prNumber, githubToken, fullSummary);

    console.log("✅ Done");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

run();
