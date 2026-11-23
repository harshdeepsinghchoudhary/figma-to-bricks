# Draft access failure and retry

Run e6ddbcff-b0a5-4428-bf64-a278510d88ee successfully created WordPress draft 4771, with 353 elements and no asset failures. First frontend capture returned 403, before any AI visual review. User confirmed separate browser login configured and the draft opens in their own logged-in Chrome. Cause is not yet proven: automation authentication, account permissions, or site security denial.

Changes: capture now checks login endpoint status and WordPress logged-in cookie presence; failures save access-error.json and (when no password field is displayed) access-error.png. No credentials/cookie values recorded. Identical initial/restoration trees avoid redundant draft writes. App Retry uses resume-verification.js for jobs with existing injection records, copies their artifacts and resumes on the SAME draft. Cross-site retries are rejected.

Validation: existing 104 tests pass; new resume test independently passes. No remote page modified in this repair. Existing running Studio at port4320 has not been restarted: in-memory connection settings may be lost on restart, so save connections to the encrypted vault first. New access diagnostics and retry route take effect after restarting. Do not instruct a retry on the old server, which would still create another draft.

Next: save/unlock connection vault across restart, retry the existing job, inspect access-error.json to distinguish missing auth from post-login denial. No security protections were disabled; do not automatically bypass WAF or authentication challenges.
