# Draft browser authentication repair

The failing job 9373d91d-2b13-4c1e-bd77-3d73ac1a3099 recorded HTTP 403, authenticated=false, loginConfigured=false, and a browser-security-check title. This establishes missing worker authentication, not that the user never entered credentials.

Changes:
- Browser access preflight runs before AI normalization and draft creation, and before production verification retry writes.
- A saved session is checked against wp-admin. Stale sessions no longer suppress configured password login.
- Integrations exposes only boolean password/session-loaded status, never credentials.
- Saving the connections vault includes the connected browser session encrypted inside it. Unlock restores it with the new process's session-encryption key. Existing vaults without a session still work.
- Security challenges still require the user-operated sign-in browser. Application passwords are never substituted for browser passwords.

Validation: production UI build passed; real Chromium fixture verifies stale-session fallback through a login form and cookie, with no external WordPress writes. Full test results: `.review-work/browser-auth-full.log`.

Activation: restart Studio once to load server changes, unlock the saved connections vault, and inspect the browser-password/session indicators. If the vault predates session retention and no password is loaded, connect using the sign-in browser, then save the vault. Retry job for draft 5076, not the manually edited reference 4955. The site's security challenge may still require manual interaction; a local fixture is not proof of live authentication.

No live pages were changed and no AI conversion was started during this repair.
