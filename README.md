# RepoAuditor AI

**AI-assisted repository review, workflow triage, and coding-agent handoff.**

RepoAuditor AI is a GitHub-focused DevAI workflow console for inspecting pull requests, analyzing workflow health, generating structured AI-assisted review output, creating follow-up issues, and coordinating Jules coding-agent sessions.

This project was originally named `hrm-project-management` because it began as a tool for workflows around the `arii/hrm` repository. The current app is better described as a repository review and workflow-auditing tool that can be configured for other GitHub repositories.

## What It Does

RepoAuditor AI helps developers:

- Review GitHub pull requests with AI-assisted code review prompts.
- Inspect pull request status, checks, merge state, changed files, and review status.
- Analyze GitHub Actions workflow runs, jobs, annotations, and workflow YAML.
- Generate structured findings and suggested GitHub issue content.
- Create or update GitHub issues from review and workflow findings.
- Coordinate Jules sessions for branch-based coding-agent handoff.
- Store repository, GitHub, Gemini, Jules, and model-tier settings locally.

## Why It Exists

AI-assisted development creates a new coordination problem: developers need to inspect repository signals, understand CI failures, review AI-generated changes, create precise follow-up specs, and hand targeted work to coding agents without losing context.

RepoAuditor AI explores that workflow by combining GitHub repository data, Gemini-assisted analysis, and Jules session coordination in one developer-facing interface.

## Core Workflows

### Pull Request Review

Inspect open pull requests, check status, merge state, changed files, and review signals. Use AI-assisted review to generate structured feedback and suggested follow-up issues.

### Workflow Health

Inspect GitHub Actions workflow runs, jobs, annotations, and workflow files to help identify likely failure causes and workflow coverage gaps.

### Issue Builder

Create structured GitHub issues from AI-assisted findings, review comments, workflow analysis, or raw notes.

### Agent Handoff

Coordinate Jules sessions using repository and branch context. Use this for targeted coding-agent follow-up, not as a replacement for human review.

## What It Is Not

RepoAuditor AI is not a generic project-management app.

It is not an HRM-only tool.

It is not a fully autonomous software engineer.

It is not a guaranteed root-cause analysis engine.

It does not replace human code review.

It is a DevAI workflow console for making repository review, CI triage, issue creation, and coding-agent handoff more structured and easier to manage.

## DevAI Skills Demonstrated

- GitHub API integration
- Pull request enrichment
- GitHub Actions workflow inspection
- AI-assisted code review
- Structured LLM output design
- Prompt design for actionable engineering feedback
- Typed TypeScript data modeling
- Gemini model-tier selection
- Jules coding-agent session coordination
- Branch-aware agent handoff
- React / TypeScript / Vite application architecture
- Developer workflow UX

## Tech Stack

- React
- TypeScript
- Vite
- React Router
- Gemini API
- GitHub API
- Jules API
- Express server
- Local settings storage

## Project History

This project was originally named `hrm-project-management` because it was first developed around workflows for the `arii/hrm` repository.

The name no longer describes the application well. The current app is better positioned as **RepoAuditor AI**: a repository-focused DevAI console for pull request review, workflow health analysis, structured issue generation, and coding-agent handoff.

## Local Setup

### Prerequisites

- Node.js
- Gemini API key
- GitHub token for GitHub-powered workflows
- Jules API key for Jules-powered workflows

### Install Dependencies

```bash
npm install
```

### Configure Credentials

Set your Gemini key through `.env.local` or the app settings.

```bash
GEMINI_API_KEY=your_gemini_key
```

GitHub and Jules credentials can be configured through the app settings panel.

### Run Locally

```bash
npm run dev
```

## Recommended Repository Description

AI-assisted GitHub repository review, workflow triage, issue generation, and Jules coding-agent handoff.
