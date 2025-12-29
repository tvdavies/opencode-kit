# opencode-kit

A collection of agents, skills, and tools for [OpenCode](https://opencode.ai).

## What's included

### Agents

| Agent | Description |
|-------|-------------|
| `code-review` | Reviews GitHub PRs for code quality, bugs, and security issues |

### Skills

| Skill | Description |
|-------|-------------|
| `pr-review` | Guidelines for conducting thorough pull request code reviews |
| `security-review` | Security-focused code review guidelines for identifying vulnerabilities |

### Tools

| Tool | Description |
|------|-------------|
| `github-pr` | Fetch PR information including metadata, diff, and changed files |
| `github-pr-comments` | Fetch existing comments on a PR (review comments, issue comments, reviews) |
| `github-pr-review` | Submit a code review with inline comments and suggested changes |

## Installation

### Per-project

Clone or copy the `.opencode` directory into your project:

```bash
cp -r .opencode /path/to/your/project/
```

### Global

Copy to your global OpenCode config:

```bash
cp -r .opencode/agent/* ~/.config/opencode/agent/
cp -r .opencode/skill/* ~/.config/opencode/skill/
cp -r .opencode/tool/* ~/.config/opencode/tool/
```

Then merge the agent configuration from `opencode.json` into your global config at `~/.config/opencode/config.json`.

## Usage

### Code Review Agent

Review a PR by URL:

```
@code-review https://github.com/owner/repo/pull/123
```

Preview what would be posted without submitting (dry-run):

```
@code-review https://github.com/owner/repo/pull/123 --dry-run
```

The agent will:

1. Fetch the PR diff, metadata, and existing comments
2. Automatically load the `security-review` skill if the PR touches security-sensitive code
3. Analyse the code for quality issues, bugs, and security vulnerabilities
4. Submit a review with inline comments and suggested fixes
5. Return a summary with a link to the review

### Prerequisites

- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- Run `gh auth login` if you haven't already

## Configuration

The `opencode.json` file configures the agents. Key settings:

```json
{
  "agent": {
    "code-review": {
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.1,
      "tools": {
        "write": false,
        "edit": false,
        "bash": true
      },
      "permission": {
        "bash": {
          "gh *": "allow",
          "*": "deny"
        }
      }
    }
  }
}
```

The code-review agent:
- Cannot write or edit local files
- Can only run `gh` commands (GitHub CLI)
- Uses a low temperature for consistent, focused analysis

## Customisation

### Changing the model

Edit `opencode.json` or `.opencode/agent/code-review.md` to use a different model:

```json
"model": "openai/gpt-4o"
```

### Adjusting review style

Edit `.opencode/skill/pr-review/SKILL.md` to change the review guidelines, add project-specific conventions, or adjust the tone.

### Adding security checks

Edit `.opencode/skill/security-review/SKILL.md` to add domain-specific security concerns or remove irrelevant ones.

## Licence

MIT
