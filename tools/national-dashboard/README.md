# national-dashboard

Local, read-only status dashboard for the going-national rollout
(`docs/plans/2026-05-17-going-national.md`). Polls GitHub (via `gh`), live
production endpoints (`api.bird-maps.com`, `bird-maps.com`), and GCP (via
`gcloud`) every 30s server-side; the browser refreshes every 5s and shows
color-coded status pills per phase item.

## Run

```sh
cd tools/national-dashboard
npm install
npm start
# open http://localhost:7777
```

Uses your existing `gh` + `gcloud` auth. No secrets are read, written, or
committed. Listens only on `127.0.0.1:7777`. Not deployed; not in CI; not
shipped to production.
