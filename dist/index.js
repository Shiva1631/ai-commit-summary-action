const core = require("@actions/core");
const github = require("@actions/github");
const axios = require("axios");

async function run() {
  try {
    const githubToken = core.getInput("github_token");
    const openaiKey = core.getInput("openai_api_key");
    const model = core.getInput("model") || "gpt-4o-mini";

    const octokit = github.getOctokit(githubToken);
    const context = github.context;

    const prNumber = context.payload.pull_request.number;
    const { owner, repo } = context.repo;

    core.info(`Fetching commits for PR #${prNumber}`);

    // Get commits
    const commitsResponse = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: prNumber
    });

    const commits = commitsResponse.data;

    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit.commit.message;

      core.info(`Processing commit: ${sha}`);

      // Get commit diff
      const commitData = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: sha
      });

      const files = commitData.data.files || [];

      let diff = files.map(f => f.patch || "").join("\n");

      // limit size
      diff = diff.substring(0, 12000);

      if (!diff || diff.length < 20) {
        core.info(`Skipping small commit: ${sha}`);
        continue;
      }

      // Call OpenAI
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
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
        },
        {
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          }
        }
      );

      const summary = response.data.choices[0].message.content;

      // Post comment
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `### 🔹 Commit: ${sha}

🧾 Message:
${message}

🧠 AI Summary:
${summary}`
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
