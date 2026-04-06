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

// ---------- FALLBACK SUMMARY ----------
function fallbackSummary(message, filesCount) {
  return `- ${message}
- Modified ${filesCount} file(s)
- Review recommended for potential side effects`;
}

// ---------- MAIN ----------
async function run() {
  try {
    const githubToken = process.env.INPUT_GITHUB_TOKEN;
    const hfKey = process.env.INPUT_HUGGINGFACE_API_KEY;
    const model = process.env.INPUT_MODEL || "google/flan-t5-base";

    if (!githubToken || !hfKey) {
      throw new Error("Missing required inputs");
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

      // ---------- GET DIFF ----------
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
      let diff = files.map((f) => f.patch || "").join("\n").slice(0, 3000);

      if (!diff || diff.length < 20) {
        console.log("Skipping small commit");
        console.log("::endgroup::");
        continue;
      }

      // ---------- HUGGING FACE ----------
      let summary = "";

      try {
        const hfResponse = await request(
          {
            hostname: "router.huggingface.co",
            path: `/hf-inference/models/${model}`,
            method: "POST",
            headers: {
              Authorization: `Bearer ${hfKey}`,
              "Content-Type": "application/json",
              "X-Wait-For-Model": "true"
            }
          },
          {
            inputs: `Summarize this git diff in 2-3 bullet points:
- What changed
- Why it matters
- Risks

Diff:
${diff}`
          }
        );

        // ---------- HANDLE RESPONSE ----------
        if (Array.isArray(hfResponse) && hfResponse[0]?.generated_text) {
          summary = hfResponse[0].generated_text.trim();
        } else if (hfResponse?.error) {
          console.log("HF error:", hfResponse.error);
          summary = fallbackSummary(message, files.length);
        } else {
          console.log("HF raw response:", hfResponse);
          summary = fallbackSummary(message, files.length);
        }
      } catch (e) {
        console.log("HF request failed:", e.message);
        summary = fallbackSummary(message, files.length);
      }

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

🧠 AI Summary:
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
