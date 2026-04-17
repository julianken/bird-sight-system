import {
  upsertHotspots, startIngestRun, finishIngestRun,
  type Pool, type HotspotInput,
} from '@bird-watch/db-client';
import { EbirdClient } from './ebird/client.js';

export interface RunHotspotOptions {
  pool: Pool;
  apiKey: string;
  regionCode: string;
  client?: EbirdClient;
}

export interface RunHotspotSummary {
  status: 'success' | 'failure';
  fetched: number;
  upserted: number;
  error?: string;
}

export async function runHotspotIngest(o: RunHotspotOptions): Promise<RunHotspotSummary> {
  const client = o.client ?? new EbirdClient({ apiKey: o.apiKey });
  const runId = await startIngestRun(o.pool, 'hotspots');
  try {
    const hotspots = await client.fetchHotspots(o.regionCode);
    const inputs: HotspotInput[] = hotspots.map(h => ({
      locId: h.locId,
      locName: h.locName,
      lat: h.lat,
      lng: h.lng,
      numSpeciesAlltime: h.numSpeciesAllTime ?? null,
      latestObsDt: h.latestObsDt ?? null,
    }));
    const upserted = await upsertHotspots(o.pool, inputs);
    await finishIngestRun(o.pool, runId, {
      status: 'success', obsFetched: hotspots.length, obsUpserted: upserted,
    });
    return { status: 'success', fetched: hotspots.length, upserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishIngestRun(o.pool, runId, { status: 'failure', errorMessage: msg });
    return { status: 'failure', fetched: 0, upserted: 0, error: msg };
  }
}
