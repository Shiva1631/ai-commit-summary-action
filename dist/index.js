const https = require("https");
const fs = require("fs");

// ---------- HTTP HELPER ----------
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

// ---------- SMART SUMMARY ----------
function generateSummary(diff, message, files) {
  const points = [];
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes("fix")) {
    points.push("- Bug fix implemented");
  }

  if (lowerMsg.includes("feat") || lowerMsg.includes("add")) {
    points.push("- New feature or functionality added");
  }

  if (lowerMsg.includes("refactor")) {
    points.push("- Code refactored for better structure");
  }

  if (diff.includes("fetch") || diff.includes("axios")) {
    points.push("- API integration or data fetching updated");
  }

  if (diff.includes("useEffect") || diff.includes("useState")) {
    points.push("- React state/lifecycle logic updated");
  }

  if (diff.includes(".css") || diff.includes("style")) {
    points.push("- UI/Styling changes made");
  }

  if (files.length > 5) {
    points.push("- Multiple files updated (broad impact)");
  }

  if (points.length === 0) {
    points.push("- General code changes and improvements");
  }

  points.push("- Review recommended for potential side effects");

  return points.join("\n");
}

// ---------- MAIN ----------
async function run() {
  try {
    const githubToken = process.env.INPUT_GITHUB_TOKEN;

    if (!githubToken) {
      throw new Error("Missing GitHub token");
    }

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

    const eventData = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")
    );

    if (!eventData.pull_request) {
      console.log("Not a PR event");
      return;
    }

    const prNumber = eventData.pull_request.number;

    console.log(`Repo: ${owner}/${repo}`);
    console.log(`PR: ${prNumber}`);

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

    console.log(`Total commits: ${commits.length}`);

    // ---------- LOOP ----------
    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit.commit.message;

      console.log(`\n::group::🔹 Commit ${sha}`);
      console.log(`🧾 Message: ${message}`);

      // ---------- FETCH DIFF ----------
      const commitData = await request({
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/commits/${sha}`,
        method: "GET",
        headers: {
          Authorization: `token ${githubToken}`,
          "User-Agent": "ai-action"
        }
      });

      if (!commitData.files) {
        console.log("No changes found");
        console.log("::endgroup::");
        continue;
      }

      const files = commitData.files;

      let diff = files
        .map((f) => f.patch || "")
        .join("\n")
        .slice(0, 3000);

      if (!diff || diff.length < 20) {
        console.log("Skipping small commit");
        console.log("::endgroup::");
        continue;
      }

      // ---------- GENERATE SUMMARY ----------
      const summary = generateSummary(diff, message, files);

      // ---------- LOG ----------
      console.log(`🧠 Summary:\n${summary}`);

      // ---------- POST COMMENT ----------
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
        {
          body: `### 🔹 Commit: ${sha}

🧾 Message:
${message}

🧠 Summary:
${summary}`
        }
      );

      console.log("::endgroup::");
    }

    console.log("\n✅ All commits processed successfully");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

run();
