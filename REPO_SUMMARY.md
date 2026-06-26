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

## AI Model Management

The application intelligently manages AI model selection to balance cost, performance, and reliability.

### Model Usage
The application currently uses the following core Gemini models as defaults:
- **Pro**: `gemini-2.5-pro` (Complex reasoning tasks)
- **Flash**: `gemini-3.5-flash` (Balanced performance)
- **Lite**: `gemini-3.1-flash-lite` (Cost-optimized, high speed)

### Model Selection & "Auto" Picker
The application employs a dynamic "auto" selection logic within `services/geminiService.ts` to ensure stability:
1. **Manual Override**: If a user selects a specific model on the **Model Intel** page, that model takes precedence.
2. **Auto-Selection**: When set to 'auto', the service dynamically resolves the best model based on:
   - The user's preferred **Model Tier** (Lite, Flash, or Pro).
   - The **Health Status** of available models (via the connectivity diagnostic).
   - Filtering to exclude restricted, underpowered, or unstable models.

### Model Intel (GeminiStatus.tsx)
The "Model Intel" module serves as a diagnostic dashboard:
- **Connectivity Diagnostic**: Runs connectivity pings against available models, registering restricted/rate-limited models in local storage.
- **Model Override**: Allows users to manually pin a specific model if the auto-picker is not performing optimally for their specific use case or if specific model quota is exhausted.
- **Usage Tracking**: Displays real-time token consumption and estimated costs based on prompt/response activity.

---

## Cost & Infrastructure Analysis

### Cost Optimization Strategy
1.  **Caching**: Aggressive caching is the only way to make this scalable.
2.  **Model Selection**: Use the lightest model capable of the task.
3.  **Batching**: Batching operations is necessary to avoid API rate limits.

---

## Component & Hook Reuse Strategy
- **UI Components (`src/components/common/`)**: Refactor repetitive UI patterns into reusable components:
    - `CheckboxList`: Support multi-select, range selection (shift+click), and keyboard interaction.
    - `PRListItem`: Standardized display for PR titles, status, and activity indicators.
    - `StatusBadge`: Standardized color-coding and sizing for PR/CI statuses.
- **Data Hooks**: Move all manual `useEffect` data-fetching to TanStack Query hooks, centralizing loading/error handling.
- **Utilities (`src/lib/utils.ts`)**: Centralize complex logic (e.g., normalizing PR URLs, filtering session states, deduplication).

### Page-Specific Refactoring Plan
- `Dashboard.tsx`: Adopt `PRListItem` and session hooks for high-level summaries.
- `PullRequests.tsx`: Adopt `PRListItem` and `StatusBadge`; standardize data fetching with TanStack Query.
- `CodeReview.tsx`: Adopt `CheckboxList` for bulk operations, `PRListItem`, `StatusBadge`, and centralize complex session/review hooks.
- `WorkflowHealth.tsx`: Reuse `StatusBadge` and shared session hooks.
- `BatchCreate.tsx`: Adopt `CheckboxList`.
- `JulesManagement.tsx`, `GeminiStatus.tsx`, `UserGuide.tsx`: Standardize loading/error states using shared components.

---

## Next Steps & Future Work

1.  **Migrate remaining data-fetching hooks**:
    - **Execution**: Install `@tanstack/react-query`. Create a `QueryClient`. Refactor one hook as a proof-of-concept (e.g., `useJulesSessions`), then iterate across all remaining data-fetching hooks.
2.  **Centralize Error Handling**:
    - **Status**: Completed. Implemented `ErrorContext` and `ErrorBoundary` component.
3.  **Refactor Storage Abstraction**:
    - **Status**: Completed. Created `StorageProvider` interface, `LocalStorageProvider`, `MemoryProvider`, and `StorageManager`.
4.  **Fact-Based Grounding**:
    - **Execution**: Create a utility in `githubService.ts` to fetch current action version data. Inject this JSON into Gemini prompts.
5.  **Issue Triage & Dispatch Workflow**:
    - **Execution**: Update Gemini prompt to require JSON classification `{ type: 'PR_SCOPED' | 'GENERAL', ... }`. Add a deduplication check against existing GitHub issues before creating. Update `IssueBuilder` UI to handle these categories.
6.  **Advanced PR Status Management & Light Reviews**:
    - **Execution**: Add a backend API endpoint to aggregate PR statuses. Build a `PRStatusBoard` UI component in `pages/CodeReview.tsx`. Add "Light Review" mode logic with specialized, lightweight prompts.
7.  **Security, Privacy & Terms**:
    - **Execution**: Create `Terms.tsx`. Ensure all sensitive inputs (`GitHubToken`, `JulesApiKey`) have clear transparency/safety labels. Implement secure local state cleanup on logout.
8.  **"Lightweight" Mode**:
    - **Execution**: Add conditional checks (`if (!julesApiKey) ...`) across services. Implement UI transitions to gracefully disable unavailable features and show credential prompts.

---

## UX/UI Enhancements & Accessibility
9.  **Accessibility & Bulk Interactions**:
    - **Shift+Click Range Selection**: Implement range-based selection for checkboxes to allow bulk actions (select/deselect multiple items).
    - **Keyboard Navigation**: Enable keyboard arrow navigation (up/down) and selection triggers (Space/Enter) within the PR list.
    - **Visual Feedback**: Enhance focus states and contrast for interactive elements to improve accessibility.
10. **Auto-Send CI Fix Notifications**:
    - **Status**: Implemented, currently undergoing refinement.
    - **Issues**: Excessive polling logic, missing robust visual feedback, inconsistent state persistence, and performance degradation.
    - **Refactoring Roadmap**:
        1.  **Refactor `useAutoSendFix.ts`**: Extract business logic from `useEffect` into a dedicated service function to improve testability and reduce re-renders.
        2.  **State Management**: Implement structured state for "fix requested" and use TanStack Query for efficient caching and UI binding.
        3.  **UI Feedback**: Add a robust badge component reflecting 'pending', 'sent', or 'failed' states.
        4.  **Logging**: Remove remaining `console.log` statements in favor of a centralized, structured logging utility to aid debugging.
11. **Agent Handoff State Management**:
    - **Execution**: Ensure Agent Handoff UI clears stale data (PR status, general status, available actions) immediately upon triggering a data reload, preventing the display of outdated information while new data is being fetched.

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

