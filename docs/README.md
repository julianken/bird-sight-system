# docs/ — index

Documentation for bird-maps.com. Everything here is meant to be readable cold.

## Buckets

| Directory | What it is |
|---|---|
| `plans/` | **FROZEN historical archive.** Plans now live in GitHub issues. These files document implementation plans authored before the issue-driven workflow was established. Do not add new plans here. |
| `specs/` | Design and architecture contracts — the authoritative source for API shapes, data models, and system topology. |
| `design/` | The Sky Atlas redesign documentation (numbered `00-overview` through `05-archive`) plus `standalone/` one-off design docs. The `design/README.md` is the entry point. |
| `analyses/` | Dated research studies and investigation reports. Named `YYYY-MM-DD-<topic>/`. |
| `runbooks/` | Operator procedures for production tasks (cache purge, monitoring, silhouette override, photo curation). |
| `notes/` | Misc short-lived notes that don't fit another bucket: one-off decisions, performance baselines, research drafts. |
| `migrations.md` | SQL migration epoch map — naming convention, sequence numbers, and the gap rationale. |

## Key entry points

- **System architecture:** [`specs/2026-04-16-bird-watch-design.md`](./specs/2026-04-16-bird-watch-design.md)
- **Redesign overview:** [`design/README.md`](./design/README.md)
- **Floating-UI anchor contract:** [`design/standalone/2026-05-30-floating-ui-design-spec.md`](./design/standalone/2026-05-30-floating-ui-design-spec.md) (also cited in root `CLAUDE.md`)
- **Migration sequence:** [`migrations.md`](./migrations.md)
- **Repo conventions (PR workflow, viewports, testing protocol):** [`../CLAUDE.md`](../CLAUDE.md)
