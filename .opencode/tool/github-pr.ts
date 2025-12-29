import { tool } from "@opencode-ai/plugin"

/**
 * Parses a PR reference which can be:
 * - A full URL: https://github.com/owner/repo/pull/123
 * - Just a number: 123
 * 
 * Returns { owner, repo, number } or throws if invalid
 */
function parsePrReference(pr: string, repo?: string): { owner: string; repo: string; number: number } {
  // Try to parse as URL first
  const urlMatch = pr.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/)
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      number: parseInt(urlMatch[3], 10)
    }
  }

  // Try to parse as just a number
  const num = parseInt(pr, 10)
  if (!isNaN(num)) {
    if (repo) {
      const [owner, repoName] = repo.split("/")
      if (owner && repoName) {
        return { owner, repo: repoName, number: num }
      }
    }
    // Will rely on gh CLI to use current repo context
    return { owner: "", repo: "", number: num }
  }

  throw new Error(`Invalid PR reference: ${pr}. Provide a PR URL or number.`)
}

export default tool({
  description: "Fetch GitHub pull request information including metadata, diff, and changed files",
  args: {
    pr: tool.schema.string().describe("PR number or full GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)"),
    repo: tool.schema.string().optional().describe("Repository in owner/repo format. Optional if PR URL is provided or if running from within a git repo."),
  },
  async execute(args) {
    const { pr, repo } = args
    const parsed = parsePrReference(pr, repo)
    
    // Build the PR reference for gh CLI
    const prRef = parsed.owner && parsed.repo 
      ? `${parsed.owner}/${parsed.repo}` 
      : undefined
    const repoFlag = prRef ? `-R ${prRef}` : ""
    
    try {
      // Fetch PR metadata
      const metadataResult = await Bun.$`gh pr view ${parsed.number} ${repoFlag} --json number,title,body,author,baseRefName,headRefName,state,isDraft,additions,deletions,changedFiles,commits,createdAt,updatedAt,url`.text()
      const metadata = JSON.parse(metadataResult.trim())

      // Fetch the diff
      const diffResult = await Bun.$`gh pr diff ${parsed.number} ${repoFlag}`.text()

      // Fetch list of changed files with their status
      const filesResult = await Bun.$`gh pr view ${parsed.number} ${repoFlag} --json files`.text()
      const filesData = JSON.parse(filesResult.trim())

      // Fetch commit messages for context
      const commitsResult = await Bun.$`gh pr view ${parsed.number} ${repoFlag} --json commits`.text()
      const commitsData = JSON.parse(commitsResult.trim())

      // Calculate total lines changed for size assessment
      const totalLinesChanged = metadata.additions + metadata.deletions

      // Determine PR size category
      let sizeCategory: string
      if (totalLinesChanged <= 100) {
        sizeCategory = "small"
      } else if (totalLinesChanged <= 500) {
        sizeCategory = "medium"
      } else if (totalLinesChanged <= 1000) {
        sizeCategory = "large"
      } else {
        sizeCategory = "very large"
      }

      // Format the output
      const output = {
        metadata: {
          number: metadata.number,
          title: metadata.title,
          description: metadata.body || "(no description)",
          author: metadata.author.login,
          baseRef: metadata.baseRefName,
          headRef: metadata.headRefName,
          state: metadata.state,
          isDraft: metadata.isDraft,
          url: metadata.url,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
        },
        stats: {
          additions: metadata.additions,
          deletions: metadata.deletions,
          totalLinesChanged,
          changedFiles: metadata.changedFiles,
          sizeCategory,
          commits: metadata.commits.length,
        },
        files: filesData.files.map((f: { path: string; additions: number; deletions: number }) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
        })),
        commitMessages: commitsData.commits.map((c: { messageHeadline: string; messageBody: string }) => ({
          headline: c.messageHeadline,
          body: c.messageBody || undefined,
        })),
        diff: diffResult.trim(),
      }

      return JSON.stringify(output, null, 2)
    } catch (error) {
      if (error instanceof Error) {
        // Check for common errors and provide helpful messages
        if (error.message.includes("gh: command not found")) {
          return JSON.stringify({
            error: "GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/",
          })
        }
        if (error.message.includes("not logged in")) {
          return JSON.stringify({
            error: "Not authenticated with GitHub. Please run 'gh auth login' first.",
          })
        }
        if (error.message.includes("Could not resolve")) {
          return JSON.stringify({
            error: `Could not find PR #${parsed.number}. Make sure you're in a git repository or provide the full PR URL.`,
          })
        }
        return JSON.stringify({ error: error.message })
      }
      return JSON.stringify({ error: "An unknown error occurred" })
    }
  },
})
