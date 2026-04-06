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

// ---------- MAIN ----------
async function run() {
  try {
    const githubToken = process.env.INPUT_GITHUB_TOKEN;
    const hfKey = process.env.INPUT_HUGGINGFACE_API_KEY;
    const model =
      process.env.INPUT_MODEL || "google/flan-t5-large";

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

    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit.commit.message;

      console.log(`\n::group::🔹 Commit ${sha}`);
      console.log(`🧾 Message: ${message}`);

      // ---------- DIFF ----------
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

      let diff = commitData.files
        .map((f) => f.patch || "")
        .join("\n")
        .slice(0, 4000); // keep smaller for HF

      if (!diff || diff.length < 20) {
        console.log("Skipping small commit");
        console.log("::endgroup::");
        continue;
      }

      // ---------- HUGGING FACE ----------
      const hfResponse = await request(
  {
    hostname: "router.huggingface.co",
    path: `/models/${model}`,   // ✅ FIXED PATH
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfKey}`,
      "Content-Type": "application/json"
    }
  },
  {
    inputs: `Summarize this git diff in 2-3 bullet points:\n\n${diff}`
  }
);

      let summary = "⚠️ No summary generated";

      if (Array.isArray(hfResponse) && hfResponse[0]?.generated_text) {
        summary = hfResponse[0].generated_text.trim();
      } else if (hfResponse?.error) {
        summary = `HF Error: ${hfResponse.error}`;
        console.log("HF error:", hfResponse);
      } else {
        console.log("HF raw response:", hfResponse);
      }

      // ---------- LOG ----------
      console.log(`🧠 Summary:\n${summary}`);

      // ---------- COMMENT ----------
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

    console.log("\n✅ Done");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

run();
