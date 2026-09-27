# Vesper

An open personal agent for macOS and Android, with a Muse-style interface, a shared browser and vault, interchangeable agents, and automation that runs only when asked or scheduled. An independent shared host keeps Mac and Android synced and works while the Mac is off.

This repository currently contains product research and development setup. There is no application yet.

- [Final architecture](docs/final-architecture.md)
- [Claude architecture review](docs/architecture-review.md)
- [Product specification](docs/product-spec.md)
- [Muse observation record](docs/muse-observations.md)
- [Technology research and sources](docs/research.md)
- [Architecture and concrete code reuse](docs/architecture-and-reuse.md)
- [Interchangeable providers and subscriptions](docs/providers.md)
- [Engineering backlog](docs/backlog.md)
- [Agent handoff](HANDOFF.md)
- [Development workflow](docs/workflow.md)

Start with `HANDOFF.md`. Run `node scripts/check-repository.mjs` to check the planning repository. Application tests will be introduced with the first implementation issues.

After editing `docs/backlog.json`, run `node scripts/backlog-document.mjs` to regenerate the readable backlog, then rerun the repository check.

Vesper uses original branding and assets. It is independent of Meta and Muse. The target is close visual and behavioral parity, with explicit differences in scheduling, providers, and feed recommendations.
