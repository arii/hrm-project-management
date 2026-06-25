# Repository Summary: RepoAuditor AI

RepoAuditor AI is a full-stack web application designed to automate and augment GitHub repository maintenance, code reviews, and workflow health monitoring. It leverages Gemini (for AI-powered code analysis) and Google Cloud Vertex AI (Jules, an internal agent) to provide insights into pull requests, CI/CD health, and overall code quality.

## Repository Overview

- **Architecture**: Full-stack SPA with an Express backend (proxied).
- **Core Functionality**:
  - **AI Code Review**: Analyzes pull requests against set guidelines.
  - **Workflow Monitoring**: Checks GitHub Actions health and status.
  - **Agent Interaction**: Integrates with Jules agent via Vertex AI.
  - **Intelligent Caching**: Complex storage layer (LocalStorage + IndexedDB) to manage large data sets, minimize API costs, and improve performance.

### Key File Breakdown

*   **/server.ts**: The backend entry point. Acts as a secure proxy to hide API keys from the browser. Mounts Vite middleware for frontend serving.
*   **/services/**: Contains business logic.
    *   `geminiService.ts`: Manages communication with Gemini API.
    *   `julesService.ts`: Manages interactions with Vertex AI/Jules agent.
    *   `githubService.ts`: Wraps GitHub API calls (GraphQL/REST).
    *   `storageService.ts`: Complex caching mechanism to balance performance and storage limits.
*   **/pages/**: UI components representing the application modules.
*   **/types.ts**: Global type definitions.

---

## Strategy for Implementation & Retrospective

Having completed the initial implementation, I can refine the strategy for building such an application:

1.  **Architecture First**: The proxy pattern (`server.ts`) is non-negotiable for security. This was correctly prioritized.
2.  **Service-UI Decoupling**: Services are effectively decoupled. However, the manual management of loading/error states in components is now becoming complex.
3.  **Storage Abstraction**: The layered storage approach is critical.

### What I Would Implement Differently Next Time

1.  **Data Fetching Library**: I implemented custom hooks like `useEnrichedPr` to handle data fetching, deduplication, and caching. For a more robust app, I would use **React Query (or SWR)** from the start. It handles race conditions, caching, revalidation, and loading/error states significantly better than manual `useEffect` management.
2.  **Centralized Error Handling**: Currently, services and components are manually checking error messages (e.g., `e.message.includes('404')`). I would implement a standardized error response object from the backend proxy and a centralized Error Boundary component on the frontend to catch and gracefully handle API failures.
3.  **Declarative State Machines**: For complex, multi-step asynchronous processes (like the discovery logic in `julesService.ts` or multi-stage audits), imperative `for` loops with `try/catch` become hard to manage. Using a lightweight state machine (like `XState`) would make these flows more predictable and easier to debug.

---

## Configuration & Secrets Management

The application requires several secrets to function correctly. These should be managed via environment variables on the server.

| Variable | Usage | How to setup |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Code reviews/AI Analysis | Generate via Google AI Studio. |
| `GITHUB_TOKEN` | GitHub API access | Create a Fine-grained PAT. |
| `GOOGLE_CLOUD_PROJECT` | Vertex AI (Jules) | Set in GCP; requires Vertex AI API enablement. |

---

## Cost & Infrastructure Analysis

### Cost Optimization Strategy
1.  **Caching**: Aggressive caching is the only way to make this scalable.
2.  **Model Selection**: Use the lightest model capable of the task.
3.  **Batching**: Batching operations is necessary to avoid API rate limits.

---

## Next Steps & Future Work

1.  **Migrate remaining data-fetching hooks**: Continue migrating existing data-fetching logic (e.g., `useJulesSessions`, `useRepoSettings`) from manual `useEffect` management to `react-query` to improve consistency, caching, and loading state management.
2.  **Centralize Error Handling**: Implement a standardized error response format from the backend proxy and create a global React Error Boundary component to catch and gracefully handle API failures.
3.  **Refactor Storage Abstraction**: Re-engineer `storageService.ts` to use a formal `Strategy` pattern, making the fallback logic (LocalStorage -> IndexedDB -> Memory) more robust and easier to maintain.
4.  **Fact-Based Grounding**: Implement real-time GitHub Action version checking to prevent hallucinations. Inject live release data into Gemini review prompts.

---

## Architectural Flow (Text-Based)

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

