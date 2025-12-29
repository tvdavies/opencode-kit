import { tool } from "@opencode-ai/plugin"

/**
 * Parses a PR reference which can be:
 * - A full URL: https://github.com/owner/repo/pull/123
 * - Just a number: 123
 */
function parsePrReference(pr: string, repo?: string): { owner: string; repo: string; number: number } {
  const urlMatch = pr.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/)
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      number: parseInt(urlMatch[3], 10)
    }
  }

  const num = parseInt(pr, 10)
  if (!isNaN(num)) {
    if (repo) {
      const [owner, repoName] = repo.split("/")
      if (owner && repoName) {
        return { owner, repo: repoName, number: num }
      }
    }
    return { owner: "", repo: "", number: num }
  }

  throw new Error(`Invalid PR reference: ${pr}. Provide a PR URL or number.`)
}

/**
 * Determines if a comment is likely from a bot based on author login patterns
 */
function isLikelyBot(login: string): boolean {
  const botPatterns = [
    /\[bot\]$/i,
    /bot$/i,
    /^github-actions$/i,
    /^dependabot$/i,
    /^renovate$/i,
    /^codecov$/i,
    /^sonarcloud$/i,
    /^netlify$/i,
    /^vercel$/i,
  ]
  return botPatterns.some(pattern => pattern.test(login))
}

interface ReviewComment {
  id: number
  path: string
  line: number | null
  originalLine: number | null
  side: string
  body: string
  author: string
  isBot: boolean
  createdAt: string
  updatedAt: string
  inReplyToId: number | null
  diffHunk: string
  url: string
}

interface IssueComment {
  id: number
  body: string
  author: string
  isBot: boolean
  createdAt: string
  updatedAt: string
  url: string
}

interface Review {
  id: number
  state: string
  body: string
  author: string
  isBot: boolean
  submittedAt: string
  url: string
}

export default tool({
  description: "Fetch all existing comments on a GitHub pull request including review comments, issue comments, and review summaries",
  args: {
    pr: tool.schema.string().describe("PR number or full GitHub PR URL"),
    repo: tool.schema.string().optional().describe("Repository in owner/repo format. Optional if PR URL is provided."),
  },
  async execute(args) {
    const { pr, repo } = args
    const parsed = parsePrReference(pr, repo)
    
    // Determine repository context
    let repoContext: string
    if (parsed.owner && parsed.repo) {
      repoContext = `${parsed.owner}/${parsed.repo}`
    } else {
      // Try to get repo from current directory
      try {
        const repoResult = await Bun.$`gh repo view --json nameWithOwner -q .nameWithOwner`.text()
        repoContext = repoResult.trim()
      } catch {
        return JSON.stringify({
          error: "Could not determine repository. Please provide the full PR URL or run from within a git repository.",
        })
      }
    }

    try {
      // Fetch review comments (inline comments on diff)
      const reviewCommentsResult = await Bun.$`gh api repos/${repoContext}/pulls/${parsed.number}/comments --paginate`.text()
      const reviewCommentsRaw = JSON.parse(reviewCommentsResult || "[]")
      
      const reviewComments: ReviewComment[] = reviewCommentsRaw.map((c: {
        id: number
        path: string
        line: number | null
        original_line: number | null
        side: string
        body: string
        user: { login: string }
        created_at: string
        updated_at: string
        in_reply_to_id?: number
        diff_hunk: string
        html_url: string
      }) => ({
        id: c.id,
        path: c.path,
        line: c.line,
        originalLine: c.original_line,
        side: c.side,
        body: c.body,
        author: c.user.login,
        isBot: isLikelyBot(c.user.login),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        inReplyToId: c.in_reply_to_id || null,
        diffHunk: c.diff_hunk,
        url: c.html_url,
      }))

      // Fetch issue comments (general PR comments, not on specific lines)
      const issueCommentsResult = await Bun.$`gh api repos/${repoContext}/issues/${parsed.number}/comments --paginate`.text()
      const issueCommentsRaw = JSON.parse(issueCommentsResult || "[]")
      
      const issueComments: IssueComment[] = issueCommentsRaw.map((c: {
        id: number
        body: string
        user: { login: string }
        created_at: string
        updated_at: string
        html_url: string
      }) => ({
        id: c.id,
        body: c.body,
        author: c.user.login,
        isBot: isLikelyBot(c.user.login),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        url: c.html_url,
      }))

      // Fetch reviews (review summaries with APPROVED, CHANGES_REQUESTED, COMMENTED, etc.)
      const reviewsResult = await Bun.$`gh api repos/${repoContext}/pulls/${parsed.number}/reviews --paginate`.text()
      const reviewsRaw = JSON.parse(reviewsResult || "[]")
      
      const reviews: Review[] = reviewsRaw
        .filter((r: { state: string }) => r.state !== "PENDING") // Exclude pending reviews
        .map((r: {
          id: number
          state: string
          body: string
          user: { login: string }
          submitted_at: string
          html_url: string
        }) => ({
          id: r.id,
          state: r.state,
          body: r.body || "",
          author: r.user.login,
          isBot: isLikelyBot(r.user.login),
          submittedAt: r.submitted_at,
          url: r.html_url,
        }))

      // Group review comments by file for easier processing
      const commentsByFile: Record<string, ReviewComment[]> = {}
      for (const comment of reviewComments) {
        if (!commentsByFile[comment.path]) {
          commentsByFile[comment.path] = []
        }
        commentsByFile[comment.path].push(comment)
      }

      // Identify threads (comments and their replies)
      const topLevelComments = reviewComments.filter(c => !c.inReplyToId)
      const threads = topLevelComments.map(parent => ({
        parent,
        replies: reviewComments.filter(c => c.inReplyToId === parent.id),
      }))

      // Summary stats
      const stats = {
        totalReviewComments: reviewComments.length,
        totalIssueComments: issueComments.length,
        totalReviews: reviews.length,
        filesWithComments: Object.keys(commentsByFile).length,
        botComments: reviewComments.filter(c => c.isBot).length + issueComments.filter(c => c.isBot).length,
        unresolvedThreads: threads.length, // GitHub doesn't expose resolution status via REST API
      }

      const output = {
        stats,
        reviews,
        issueComments,
        reviewComments,
        commentsByFile,
        threads,
      }

      return JSON.stringify(output, null, 2)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("gh: command not found")) {
          return JSON.stringify({
            error: "GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/",
          })
        }
        if (error.message.includes("not logged in") || error.message.includes("401")) {
          return JSON.stringify({
            error: "Not authenticated with GitHub. Please run 'gh auth login' first.",
          })
        }
        return JSON.stringify({ error: error.message })
      }
      return JSON.stringify({ error: "An unknown error occurred" })
    }
  },
})
