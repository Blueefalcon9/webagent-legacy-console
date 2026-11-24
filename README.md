# WebAgent Legacy Console

The original single-page dashboard for **WebAgent**, a locally hosted, AI-assisted platform for authorized web
application security assessments. This console has since been replaced by a newer operator UI; it is published
here as a self-contained reference implementation.

> **This repository is the front end only.** It is three static files that talk to a `/api/*` backend which is
> not part of this repository. Opening `index.html` on its own renders the shell and then fails every fetch.
> It is useful as a UI reference, not as a runnable application.

## Why it might interest you

No build step, no framework, no dependencies — 1,228 lines of vanilla JavaScript and CSS implementing a
16-view operator console with client-side routing. There is no `package.json` because there is nothing to
install.

| File | Lines | Purpose |
|---|---|---|
| `app.js` | 1,097 | Hyperscript helper, router, API client, all 16 views |
| `app.css` | 118 | Full stylesheet |
| `index.html` | 13 | Mount point |

## Views

**Assessment lifecycle** — Overview, Assessments, Scope, Approvals, Coverage
**Agent** — Agent (run timeline), Jobs, Tools
**Results** — Findings, Attack paths, Positive findings, Attack surface, Evidence
**Integration & audit** — Burp, Audit log, System

## Design notes

A few patterns worth lifting:

- **`h()` hyperscript.** A ~10-line `h(tag, attrs, ...children)` builds the entire UI. No JSX, no virtual DOM,
  no diffing — views re-render wholesale on navigation.
- **Hash routing via `go(view, id)`.** A single `NAV` table drives both the sidebar and the router.
- **CSRF on every mutation.** `api()` attaches `X-CSRF-Token` to anything that is not a `GET` and sends
  `credentials: "same-origin"`.
- **Approval gating in the UI.** Credential-sending and out-of-scope actions surface as explicit operator
  approvals rather than silently proceeding — the interface is built around the assumption that the agent is
  not trusted to decide scope for itself.

## Status

Superseded and unmaintained. Kept public as a reference; issues and PRs are not monitored.

## Authorized use only

The platform this console belongs to is for security testing of systems you own or have **written**
authorization to test. Unauthorized scanning is illegal in most jurisdictions.

## License

MIT — see [LICENSE](LICENSE).
