async function getCommits(octokit, owner, repo, prNumber) {
  const res = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber
  });
  return res.data;
}

async function getDiff(octokit, owner, repo, sha) {
  const res = await octokit.rest.repos.getCommit({
    owner,
    repo,
    ref: sha
  });

  const files = res.data.files || [];

  return files
    .map(f => f.patch || "")
    .join("\n")
    .slice(0, 12000); // prevent token overflow
}

module.exports = { getCommits, getDiff };
