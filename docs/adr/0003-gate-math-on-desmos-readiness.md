# Gate Math on Desmos readiness

When an Attempt includes Math, the licensed Desmos API will be loaded from `desmos.com` after the learner clicks Start, and questions and timing will remain blocked behind the Attempt Loading Gate until the calculator is instantiated and usable. The client-visible API key is treated as configuration rather than a secret because the official embed places it in the script URL; a loading failure produces an explicit notification with Retry, Return to Setup, and local scientific-calculator fallback choices.

## Consequences

The application depends on Desmos and network availability for the graphing experience, uses one project-wide API key supplied through local environment configuration, exposes no key-management interface, stores no key in source control or backups, preserves calculator state throughout both Math Modules, and never consumes Math time while calculator readiness is unresolved.
