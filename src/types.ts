export type GeoPhoto = {
  id: string;
  uri: string;
  creationTime: number;
  latitude: number;
  longitude: number;
};

export type MapCluster = {
  key: string;
  latitude: number;
  longitude: number;
  count: number;
  cellLatitude: number;
  cellLongitude: number;
  gridSize: number;
};

export type ExportCluster = {
  latitude: number;
  longitude: number;
  count: number;
  firstTime: number;
  lastTime: number;
};

export type ScanProgress = {
  scanned: number;
  found: number;
  total: number;
  complete: boolean;
};

export type ScanState = {
  afterCursor: string | null;
  scanned: number;
  found: number;
  total: number;
  complete: boolean;
};
