/**
 * Local mirror of the production `Observation` shape
 * (@bird-watch/shared-types). Duplicated here so the prototype is a fully
 * standalone Vite entry with no dependency on the workspace's tsconfig
 * project graph — it only needs the fields the canned fixture carries.
 */
export interface Observation {
  subId: string;
  speciesCode: string;
  comName: string;
  lat: number;
  lng: number;
  obsDt: string;
  locId: string;
  locName: string | null;
  howMany: number | null;
  isNotable: boolean;
  silhouetteId: string | null;
  familyCode: string | null;
  taxonOrder?: number | null;
}

export interface ObservationsResponse {
  mode: 'observations';
  data: Observation[];
  meta: { freshestObservationAt: string | null };
}
