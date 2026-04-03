const https = require("https");
const fs = require("fs");

// helper to make HTTPS requests
function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";

      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on("error", reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function run() {
  try {
    const githubToken = process.env.INPUT_GITHUB_TOKEN;
    const openaiKey = process.env.INPUT_OPENAI_API_KEY;
    const model = process.env.INPUT_MODEL || "gpt-4o-mini";

    if (!githubToken || !openaiKey) {
      throw new Error("Missing required inputs");
    }

    const repoFull = process.env.GITHUB_REPOSITORY;
    const [owner, repo] = repoFull.split("/");

    // ✅ robust PR extraction
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));

    if (!eventData.pull_request) {
      console.log("Not a pull request event. Exiting.");
      return;
    }

    const prNumber = eventData.pull_request.number;

    console.log(`Repo: ${owner}/${repo}`);
    console.log(`PR Number: ${prNumber}`);

    // 🔹 Fetch commits
    const commitsResponse = await request({
      hostname: "api.github.com",
      path: `/repos/${owner}/${repo}/pulls/${prNumber}/commits`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "User-Agent": "ai-action"
      }
    });

    if (!Array.isArray(commitsResponse)) {
      console.error("Commits API Error:", commitsResponse);
      throw new Error("Failed to fetch commits (not an array)");
    }

    const commits = commitsResponse;

    console.log(`Total commits: ${commits.length}`);

    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit.commit.message;

      console.log(`\nProcessing commit: ${sha}`);

      // 🔹 Fetch commit diff
      const commitData = await request({
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/commits/${sha}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "ai-action"
        }
      });

      if (!commitData.files) {
        console.log(`Skipping commit (no files): ${sha}`);
        continue;
      }

      let diff = commitData.files
        .map((f) => f.patch || "")
        .join("\n")
        .substring(0, 12000);

      if (!diff || diff.length < 20) {
        console.log(`Skipping small commit: ${sha}`);
        continue;
      }

      // 🔹 Call OpenAI
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

      const summary =
        aiResponse?.choices?.[0]?.message?.content ||
        "No summary generated";

      console.log(`Summary generated for ${sha}`);

      // 🔹 Post comment
      const commentResponse = await request(
        {
          hostname: "api.github.com",
          path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
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

      if (commentResponse.message === "Bad credentials") {
        throw new Error("GitHub token is invalid");
      }
    }

    console.log("\n✅ All commits processed successfully");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

run();
