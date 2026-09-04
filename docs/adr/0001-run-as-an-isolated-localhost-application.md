# Run as an isolated localhost application

The application will use a browser client and a local API bound only to `127.0.0.1`, with an operating-system-assigned free port, a per-launch capability token, a single-instance lock scoped to its own data directory, and no attempt to terminate, reconfigure, or attach to other processes. This provides transparent local storage and dependable PDF processing without the quota limits of a browser-only application or the early packaging complexity of a desktop shell.

## Consequences

Runtime data stays within the application's configured local data directory, non-loopback connections are rejected, and desktop packaging remains a later delivery concern rather than a different application architecture.
