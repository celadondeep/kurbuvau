export type GeoPhoto = {
  id: string;
  uri: string;
  creationTime: number;
  latitude: number;
  longitude: number;
};

export type PhotoCluster = {
  key: string;
  latitude: number;
  longitude: number;
  photos: GeoPhoto[];
};

export type ScanProgress = {
  scanned: number;
  found: number;
};
