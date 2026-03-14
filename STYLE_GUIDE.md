# RepoAuditor Engineering & Style Guide

This document outlines the standards and patterns required to maintain the high-performance, "Anti-AI-Slop" nature of the RepoAuditor application.

## 1. Error Handling (Resilience & Feedback)

All asynchronous operations must follow a strict "Notify, Log, Recover" pattern.

### Patterns:
- **Service Level:** Throw descriptive errors with context. Never return `null` for a failure that the UI needs to explain.
- **UI Level:** Use `try...catch` blocks around all dispatch actions.
- **User Feedback:** 
  - Use the `ActionStatus` type (`idle`, `loading`, `success`, `error`).
  - Display specific error messages (e.g., `errorMessages[id]`) rather than generic "Something went wrong".
  - Provide a "Retry" or "Fix in Settings" path for common failures (like 401 Unauthorized).

```typescript
// Good Pattern
try {
  await githubService.createIssue(...);
  setStatus('success');
} catch (e: any) {
  setStatus('error');
  setError(e.message || "Failed to sync with GitHub. Verify your token permissions.");
}
```

## 2. Caching & Persistence

To ensure instant loading and respect API rate limits, we use a multi-layered caching strategy.

### Local Storage vs. Cookies:
- **API Keys:** Use `localStorage` for persistence across sessions. In this iframe environment, `localStorage` is the most reliable way to keep the user "logged in" to their own credentials.
- **Data Caching:** Use the `storageService.ts` wrapper. 
  - **GitHub Data:** 15-minute TTL.
  - **Jules Data:** 10-minute TTL.
  - **Audit Results:** Persist indefinitely until the `head_sha` of the PR changes.

### Cache Invalidation:
- Mutations (POST/PATCH/DELETE) must trigger a cache clear for that specific resource or a global `storage.clearCaches()` if the state change is broad.

## 3. Workflow Pulse Logic

The CI Health Audit must maintain strict separation of concerns across its three modes:

1. **Recent Failures:** 
   - **Data:** Fetches runs with `conclusion: failure` or `timed_out`.
   - **Logic:** Must fetch technical `annotations` (compiler errors, test failures) to provide root cause analysis.
2. **Successes & Flakes:**
   - **Data:** Fetches runs with `conclusion: success`.
   - **Logic:** AI analyzes successful runs to find "silent flakes" (steps that failed but were retried, or jobs that are inconsistently slow).
3. **Qualitative Audit:**
   - **Data:** Full `.github/workflows/*.yml` content + Repository `package.json` + File list.
   - **Logic:** AI acts as a DevOps Architect to find gaps (e.g., "You have TypeScript files but no type-check workflow").

## 4. Link & Navigation Behavior

**Rule:** Never break the user's flow.

- **Internal Navigation:** Use `Link` from `react-router-dom` or `useNavigate`.
- **External Links (GitHub/Jules):** 
  - Always use `target="_blank"` and `rel="noopener noreferrer"`.
  - Use meaningful anchors (e.g., the Run ID or PR Number).
  - **Deep Linking:** When dispatching to Jules AI, open the session in a new tab immediately so the user can see the worker start without leaving the Auditor.
- **Avoid Page Refreshes:** Use React state and `useEffect` to update data. Only use `window.location` for hard resets if the app state is corrupted.

## 5. User Experience (UX) Assertions

- **Credentials Guard:** Every tool page must check for `repoName` and `token`. If missing, show the "Credentials Required" banner with a direct link to Settings.
- **Loading States:** Never show a blank screen. Use `Loader2` with descriptive "Loading Steps" (e.g., "Probing for technical annotations...").
- **Zero-Slop UI:** 
  - Keep the dashboard static and fast.
  - Use `lucide-react` icons consistently for visual cues.
  - Maintain a high-density, technical aesthetic (Slate/Zinc palette).

## 6. API Key Security

- **Server-Side Preference:** If we move to a custom backend, API keys should be moved to environment variables.
- **Client-Side Encryption:** For the current SPA architecture, keys are stored in the user's browser. Warn users not to use the tool on public machines.

## 7. State Synchronization & Persistence

To ensure a seamless experience across tabs and reloads:

- **Centralized Settings:** All API keys and repository configurations must be managed via `storageService.ts`.
- **Cross-Tab Sync:** Use the `storage` event listener in `App.tsx` to detect changes made in other tabs (e.g., if a user updates their token in one tab, all other open tabs should reflect the change immediately).
- **Initialization:** Always load settings from `localStorage` during the initial render of the root `App` component to avoid "flash of unconfigured state".
- **Cookie Fallback (Future):** If a backend is introduced, use `HttpOnly; SameSite=None; Secure` cookies to mirror the `localStorage` state for server-side authentication.
