const core = require("@actions/core");
const github = require("@actions/github");
const { getCommits, getDiff } = require("./lib/github");
const { summarize } = require("./lib/summarizer");

async function run() {
  try {
    const token = core.getInput("github_token");
    const openaiKey = core.getInput("openai_api_key");
    const model = core.getInput("model");

    const octokit = github.getOctokit(token);
    const context = github.context;

    const prNumber = context.payload.pull_request.number;
    const { owner, repo } = context.repo;

    const commits = await getCommits(octokit, owner, repo, prNumber);

    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit.commit.message;

      core.info(`Processing commit: ${sha}`);

      const diff = await getDiff(octokit, owner, repo, sha);

      if (!diff) continue;

      const summary = await summarize(openaiKey, model, diff);

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `### 🔹 Commit: ${sha}

**Message:** ${message}

**AI Summary:**
${summary}`
      });
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
