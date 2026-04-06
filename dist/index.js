const https = require("https");
const fs = require("fs");

// ---------- HTTP Helper ----------
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
    const openaiKey = process.env.INPUT_OPENAI_API_KEY;
    const model = process.env.INPUT_MODEL || "gpt-4o-mini";

    if (!githubToken || !openaiKey) {
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
        Authorization: `token ${githubToken}`, // ✅ FIXED
        "User-Agent": "ai-action"
      }
    });

    if (!Array.isArray(commits)) {
      console.error("❌ Commit fetch failed:", commits);
      throw new Error("Commits API failed");
    }

    console.log(`Total commits: ${commits.length}`);

    // ---------- LOOP ----------
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
          Authorization: `token ${githubToken}`, // ✅ FIXED
          "User-Agent": "ai-action"
        }
      });

      if (!commitData.files) {
        console.log("⚠️ No file changes");
        console.log("::endgroup::");
        continue;
      }

      let diff = commitData.files
        .map((f) => f.patch || "")
        .join("\n")
        .slice(0, 12000);

      if (!diff || diff.length < 20) {
        console.log("⚠️ Skipping small commit");
        console.log("::endgroup::");
        continue;
      }

      // ---------- OPENAI ----------
      const aiResponse = await request(
        {
          hostname: "api.openai.com",
          path: "/v1/chat/completions",
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          }
        },
        {
          model,
          messages: [
            {
              role: "system",
              content:
                "Summarize this git commit in 2-3 bullet points. Include impact and risks."
            },
            {
              role: "user",
              content: diff
            }
          ]
        }
      );

      // ---------- SUMMARY EXTRACTION ----------
      let summary = "⚠️ No summary generated";

      if (aiResponse?.choices?.[0]?.message?.content) {
        summary = aiResponse.choices[0].message.content.trim();
      } else {
        console.log("⚠️ OpenAI raw response:", JSON.stringify(aiResponse, null, 2));
      }

      // ---------- LOG SUMMARY ----------
      console.log(`🧠 Summary:\n${summary}`);

      // ---------- COMMENT ----------
      const comment = await request(
        {
          hostname: "api.github.com",
          path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
          method: "POST",
          headers: {
            Authorization: `token ${githubToken}`, // ✅ FIXED
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

      if (comment?.message) {
        console.log("⚠️ Comment API response:", comment);
      }

      console.log("::endgroup::");
    }

    console.log("\n✅ Done");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

run();
