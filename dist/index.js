const https = require("https");

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
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

    const repoFull = process.env.GITHUB_REPOSITORY;
    const [owner, repo] = repoFull.split("/");

    const prNumber = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\/merge/)[1];

    console.log(`Fetching commits for PR #${prNumber}`);

    // Get commits
    const commits = await request({
      hostname: "api.github.com",
      path: `/repos/${owner}/${repo}/pulls/${prNumber}/commits`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "User-Agent": "ai-action"
      }
    });

    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit.commit.message;

      console.log(`Processing commit: ${sha}`);

      // Get commit details
      const commitsResponse = await request({
  hostname: "api.github.com",
  path: `/repos/${owner}/${repo}/pulls/${prNumber}/commits`,
  method: "GET",
  headers: {
    Authorization: `Bearer ${githubToken}`,
    "User-Agent": "ai-action"
  }
});

console.log("Commits API response:", JSON.stringify(commitsResponse, null, 2));

if (!Array.isArray(commitsResponse)) {
  throw new Error("Commits API did not return an array. Likely API error.");
}

const commits = commitsResponse;

      const files = commitData.files || [];
      let diff = files.map((f) => f.patch || "").join("\n");

      diff = diff.substring(0, 12000);

      if (!diff || diff.length < 20) {
        console.log(`Skipping small commit: ${sha}`);
        continue;
      }

      // OpenAI call
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
        aiResponse.choices?.[0]?.message?.content || "No summary generated";

      // Post PR comment
      await request(
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
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

run();
