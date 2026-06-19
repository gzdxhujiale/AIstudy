# Chrome Ports Module

## Scope

Chrome Ports owns the UI for fixed Chrome debugging-port login and status checks used by the assistant.

Current files:

- `ChromePortManager.tsx`: port status cards, refresh, login-window opening, and temporary login monitoring.

## Boundaries

- Renderer UI must not launch Chrome directly.
- Port probing, profile paths, CDP checks, and login-state detection are owned by Electron main.
- Saved status is metadata only; cookies and secrets are not stored by this module.
- Port failures affect AI features only and must not block course, mind-map, or document editing.

## User Flow

1. User opens the Chrome port page.
2. The UI loads current port status from `window.aistudyChromePorts.status`.
3. User opens a provider login window.
4. Main process starts or reuses Chrome with the provider's fixed profile and port.
5. The UI monitors for login recognition and lets the user refresh later if needed.

## Extension Rules

- Add new providers by extending the main-process port definitions and this typed UI surface together.
- Keep port numbers stable once released so saved profiles remain reusable.
- Do not expose Chrome profile paths or technical CDP errors in product-facing text.
- Add runtime diagnostics for every new provider dependency.
