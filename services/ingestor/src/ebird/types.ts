// Shapes returned by https://api.ebird.org/v2/data/obs/{regionCode}/recent
// Reference: https://documenter.getpostman.com/view/664302/S1ENwy59

export interface EbirdObservation {
  speciesCode: string;
  comName: string;
  sciName: string;
  locId: string;
  locName: string;
  obsDt: string;            // "YYYY-MM-DD HH:MM"
  howMany?: number;
  lat: number;
  lng: number;
  obsValid: boolean;
  obsReviewed: boolean;
  locationPrivate: boolean;
  subId: string;
  subnational1Code?: string;
  subnational2Code?: string;
}

export interface EbirdHotspot {
  locId: string;
  locName: string;
  countryCode: string;
  subnational1Code: string;
  subnational2Code?: string;
  lat: number;
  lng: number;
  latestObsDt?: string;     // ISO-ish or absent
  numSpeciesAllTime?: number;
}
