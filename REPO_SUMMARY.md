# Repository Summary: RepoAuditor AI

RepoAuditor AI is a full-stack web application designed to automate and augment GitHub repository maintenance, code reviews, and workflow health monitoring. It leverages Gemini (for AI-powered code analysis) and Google Cloud Vertex AI (Jules, an internal agent) to provide insights into pull requests, CI/CD health, and overall code quality.

## Repository Overview

- **Architecture**: Full-stack SPA with an Express backend (proxied).
- **Core Functionality**:
  - **AI Code Review**: Analyzes pull requests against set guidelines (Anti-AI-Slop, best practices).
  - **Workflow Monitoring**: Checks GitHub Actions health and status.
  - **Agent Interaction**: Integrates with Jules agent via Vertex AI.
  - **Intelligent Caching**: Complex storage layer (LocalStorage + IndexedDB) to manage large data sets, minimize API costs, and improve performance.

### Key File Breakdown

*   **/server.ts**: The backend entry point. Acts as a secure proxy to hide API keys from the browser. Mounts Vite middleware for frontend serving.
*   **/services/**: Contains business logic.
    *   `geminiService.ts`: Manages communication with Gemini API, including JSON parsing, prompt management, and review logic.
    *   `julesService.ts`: Manages interactions with Vertex AI/Jules agent.
    *   `githubService.ts`: Wraps GitHub API calls (GraphQL/REST).
    *   `storageService.ts`: Complex caching mechanism to balance performance and storage limits.
*   **/pages/**: UI components representing the application modules (CodeReview, PullRequests, Dashboard, etc.).
*   **/types.ts**: Global type definitions to ensure data consistency across services and UI.

---

## Strategy for Re-creation

If I were to rebuild this repository from scratch, I would focus on modularization from day one:

1.  **Architecture First**: Establish the Express backend (`server.ts`) as a robust proxy for *all* external API interactions immediately. Never let client-side code touch API secrets.
2.  **Type Safety**: Define `types.ts` early. Rigid typing prevents runtime errors when handling complex JSON responses from AI models.
3.  **Storage Abstraction**: The most crucial component for user experience is `storageService.ts`. Recreating this *before* building the UI is key. I would use a `Strategy` pattern to handle falling back from LocalStorage -> IndexedDB -> Memory to avoid quota-exceeded errors.
4.  **Service Layer**: Keep services decoupled from the UI. Services should only know how to fetch/parse/transform data; they should not care about component state.

---

## Configuration & Secrets Management

The application requires several secrets to function correctly. These should be managed via environment variables (in `.env` and `process.env`) on the server, *never* exposed to the client.

| Variable | Usage | How to setup |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Code reviews/AI Analysis | Generate via Google AI Studio. |
| `GITHUB_TOKEN` | GitHub API access | Create a Fine-grained PAT with repo read/write access. |
| `GOOGLE_CLOUD_PROJECT` | Vertex AI (Jules) | Set in GCP; requires Vertex AI API enablement. |

*   **Setup Workflow**: Ensure these are defined in `.env.example`. The platform infrastructure will prompt for values upon deployment. For local development, manage locally in a `.env` file (ignored by git).

---

## Cost & Infrastructure Analysis

### Infrastructure Costs (GCP)
- **Cloud Run**: Scales to zero. Costs are purely request/duration based.
- **Vertex AI (Jules)**: Costs based on model usage and session duration.
- **Gemini API**: Cost per token (input/output).

### Important vs. Unimportant
*   **Highly Important**: **Caching (`storageService.ts`)**. This is the single biggest factor in both cost and speed. AI calls are expensive and slow; hitting the cache instead of the API saves both.
*   **Highly Important**: **Strict JSON Parsing**. AI responses are brittle. Robust error handling (as implemented in `geminiService.ts` for HTML vs JSON detection) is critical.
*   **Less Important (for MVP)**: Complex UI telemetry (animations, exhaustive logging). Focus on the core functionality first before worrying about highly detailed progress tracking.

### Cost Optimization Strategy
1.  **Caching**: Aggressive caching is the only way to make this scalable.
2.  **Model Selection**: Use the lightest model capable of the task (e.g., Flash for basic health checks, Pro for deep reviews).
3.  **Batching**: As seen in `PullRequests.tsx`, batching operations is necessary to avoid API rate limits and improve user-perceived performance.

---

## Redundancy & Optimization Analysis

### Identified Redundancies
1.  **Logging**: Excessive `console.log` statements in `storageService.ts` and `githubService.ts` are redundant. They clog the console (445+ messages) and hurt performance in production.
2.  **Storage Logic**: The fallback and scavenger logic for caching is duplicated and scattered across `storageService.ts`. It could be abstracted into a unified `StorageStrategy` class.
3.  **Data Enrichment**: `enrichSinglePr` is being called across three different components (`PullRequests`, `JulesManagement`, `CodeReview`) with slight variations in cache parameters. This should be moved into a single hook, e.g., `useEnrichedPr(prId)`.

### Architectural Flow (Text-Based)

#### 1. Data Retrieval Flow (Proxy Pattern)
`[User UI]` -> `[Proxy: server.ts]` -> `[External API: GitHub/Gemini]`
*   UI makes request to `/api/*`.
*   `server.ts` validates authorization.
*   `server.ts` calls external API with secure server-side secrets.
*   `server.ts` returns JSON to UI.

#### 2. Caching Flow (Layered Storage)
`[UI Request]` -> `[StorageService]`
1.  **Check Memory Cache**: (Fastest).
2.  **Check LocalStorage**: (If not in memory).
3.  **Check IndexedDB**: (If too large for LocalStorage).
4.  **Fetch from Proxy**: (If all cache misses).
5.  **Update Caches**: (If fetch succeeds).

