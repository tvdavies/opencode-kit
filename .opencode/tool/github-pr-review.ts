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

// Schema for inline comments
const commentSchema = tool.schema.object({
  path: tool.schema.string().describe("The relative path to the file being commented on"),
  line: tool.schema.number().describe("The line number in the new version of the file to comment on"),
  side: tool.schema.enum(["LEFT", "RIGHT"]).optional().describe("Which side of the diff to comment on. RIGHT (default) for additions/unchanged, LEFT for deletions"),
  startLine: tool.schema.number().optional().describe("For multi-line comments, the first line of the range"),
  startSide: tool.schema.enum(["LEFT", "RIGHT"]).optional().describe("The side for the start of a multi-line comment"),
  body: tool.schema.string().describe("The comment text. Can include GitHub suggestion blocks for proposed changes"),
})

export default tool({
  description: "Submit a code review on a GitHub pull request with optional inline comments and suggestions",
  args: {
    pr: tool.schema.string().describe("PR number or full GitHub PR URL"),
    repo: tool.schema.string().optional().describe("Repository in owner/repo format. Optional if PR URL is provided."),
    body: tool.schema.string().describe("The overall review summary comment"),
    event: tool.schema.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]).optional().describe("The review action. Defaults to COMMENT. Use COMMENT to leave feedback without approving or requesting changes."),
    comments: tool.schema.array(commentSchema).optional().describe("Array of inline comments to add to specific lines in the diff"),
    dryRun: tool.schema.boolean().optional().describe("If true, return what would be submitted without actually posting the review"),
  },
  async execute(args) {
    const { pr, repo, body, event = "COMMENT", comments = [], dryRun = false } = args
    const parsed = parsePrReference(pr, repo)
    
    // Determine repository context
    let repoContext: string
    if (parsed.owner && parsed.repo) {
      repoContext = `${parsed.owner}/${parsed.repo}`
    } else {
      try {
        const repoResult = await Bun.$`gh repo view --json nameWithOwner -q .nameWithOwner`.text()
        repoContext = repoResult.trim()
      } catch {
        return JSON.stringify({
          error: "Could not determine repository. Please provide the full PR URL or run from within a git repository.",
        })
      }
    }

    // Get the latest commit SHA for the PR (required for creating review comments)
    let commitId: string
    try {
      const prResult = await Bun.$`gh api repos/${repoContext}/pulls/${parsed.number} --jq .head.sha`.text()
      commitId = prResult.trim()
    } catch (error) {
      return JSON.stringify({
        error: `Could not fetch PR details: ${error instanceof Error ? error.message : "unknown error"}`,
      })
    }

    // Build the review payload
    const reviewPayload: {
      commit_id: string
      body: string
      event: string
      comments?: Array<{
        path: string
        line: number
        side?: string
        start_line?: number
        start_side?: string
        body: string
      }>
    } = {
      commit_id: commitId,
      body,
      event,
    }

    // Add comments if provided
    if (comments.length > 0) {
      reviewPayload.comments = comments.map(c => {
        const comment: {
          path: string
          line: number
          side?: string
          start_line?: number
          start_side?: string
          body: string
        } = {
          path: c.path,
          line: c.line,
          body: c.body,
        }
        if (c.side) comment.side = c.side
        if (c.startLine) comment.start_line = c.startLine
        if (c.startSide) comment.start_side = c.startSide
        return comment
      })
    }

    // If dry run, just return what would be submitted
    if (dryRun) {
      const [owner, repoName] = repoContext.split("/")
      const prUrl = `https://github.com/${repoContext}/pull/${parsed.number}`
      
      return JSON.stringify({
        dryRun: true,
        wouldSubmit: {
          repository: repoContext,
          pullRequest: parsed.number,
          prUrl,
          event,
          reviewBody: body,
          inlineComments: comments.map(c => ({
            file: c.path,
            line: c.line,
            startLine: c.startLine,
            body: c.body,
          })),
          totalInlineComments: comments.length,
        },
        message: "Dry run complete. No review was submitted. Remove --dry-run to submit the review.",
      }, null, 2)
    }

    // Submit the review
    try {
      const payloadJson = JSON.stringify(reviewPayload)
      
      // Use gh api to submit the review
      const result = await Bun.$`gh api repos/${repoContext}/pulls/${parsed.number}/reviews -X POST --input - <<< ${payloadJson}`.text()
      
      const response = JSON.parse(result)
      
      return JSON.stringify({
        success: true,
        reviewId: response.id,
        reviewUrl: response.html_url,
        state: response.state,
        submittedAt: response.submitted_at,
        summary: {
          repository: repoContext,
          pullRequest: parsed.number,
          event,
          inlineCommentsPosted: comments.length,
        },
        message: `Review submitted successfully. View it at: ${response.html_url}`,
      }, null, 2)
    } catch (error) {
      if (error instanceof Error) {
        // Try to parse GitHub API error response
        const errorMatch = error.message.match(/\{[\s\S]*\}/)
        if (errorMatch) {
          try {
            const apiError = JSON.parse(errorMatch[0])
            return JSON.stringify({
              error: "Failed to submit review",
              message: apiError.message,
              errors: apiError.errors,
            }, null, 2)
          } catch {
            // Fall through to generic error
          }
        }
        
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
        if (error.message.includes("422")) {
          return JSON.stringify({
            error: "Invalid review submission. This often means a comment references a line that doesn't exist in the diff. Check that all line numbers are correct.",
            details: error.message,
          })
        }
        return JSON.stringify({ error: error.message })
      }
      return JSON.stringify({ error: "An unknown error occurred" })
    }
  },
})
