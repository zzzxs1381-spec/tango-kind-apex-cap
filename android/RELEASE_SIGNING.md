# Release signing guardrails

- Production signing material is never committed.
- CI uses an ephemeral key only to prove that release APK/AAB generation and signature verification work.
- The manual signed field-build workflow requires a persistent upload key from GitHub Secrets.
- A production update must use the same persistent upload key lineage expected by the selected distribution channel.
- Play Console upload is a separate external action and must not be reported as complete until Play Developer API access is actually connected and the upload succeeds.
