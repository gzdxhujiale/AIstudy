# Assistant Module

## Scope

Assistant owns the chat UI that sends prompts to already logged-in AI web sessions through fixed Chrome debugging ports.

Current files:

- `AiAssistantPanel.tsx`: chat history, provider switch, quick prompts, compact document popover mode, and local conversation persistence.

## Boundaries

- The renderer does not automate web pages directly.
- Sending, login checks, and page scraping are owned by Electron main through `window.aistudyAssistant.send`.
- Chat history is a convenience layer in `localStorage`; it is not course or document storage.
- AI responses must not become source-of-truth document data unless a caller explicitly saves generated content through the document path.

## User Flow

1. User chooses 豆包 or ChatGPT.
2. User sends a prompt from the assistant page or compact document panel.
3. Main process checks the matching Chrome port and login state.
4. Main process injects provider-specific page automation and returns the cleaned reply.
5. The panel appends the reply and preserves recent local chat state.

## Extension Rules

- Add provider-specific automation in main process, not in this renderer component.
- Keep user-visible failures plain-language and reusable with the error-log layer.
- Do not persist credentials, cookies, or raw page internals in renderer storage.
- If a future provider uses an API key, add it as a separate optional provider boundary.
