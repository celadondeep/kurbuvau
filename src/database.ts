import { Region } from 'react-native-maps';
import * as SQLite from 'expo-sqlite';

import { getGridSize } from './map';
import { ExportCluster, GeoPhoto, MapCluster, ScanProgress, ScanState } from './types';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('kur-buvau.db');
  }
  return databasePromise;
}

export async function initializeDatabase() {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY NOT NULL,
      uri TEXT NOT NULL,
      creation_time INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS photos_creation_time_idx ON photos(creation_time);
    CREATE INDEX IF NOT EXISTS photos_location_idx ON photos(latitude, longitude);
    CREATE TABLE IF NOT EXISTS scan_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      after_cursor TEXT,
      scanned INTEGER NOT NULL DEFAULT 0,
      found INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      complete INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO scan_state (id) VALUES (1);
  `);
}

export async function getScanState(): Promise<ScanState> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    after_cursor: string | null;
    scanned: number;
    found: number;
    total: number;
    complete: number;
  }>('SELECT after_cursor, scanned, found, total, complete FROM scan_state WHERE id = 1');

  return {
    afterCursor: row?.after_cursor ?? null,
    scanned: row?.scanned ?? 0,
    found: row?.found ?? 0,
    total: row?.total ?? 0,
    complete: row?.complete === 1,
  };
}

export async function resetScan() {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync('DELETE FROM photos;');
    await txn.runAsync(
      'UPDATE scan_state SET after_cursor = NULL, scanned = 0, found = 0, total = 0, complete = 0 WHERE id = 1',
    );
  });
}

export async function saveScanBatch(
  photos: GeoPhoto[],
  progress: ScanProgress,
  endCursor: string | null,
) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const statement = await txn.prepareAsync(
      `INSERT OR REPLACE INTO photos
       (id, uri, creation_time, latitude, longitude)
       VALUES (?, ?, ?, ?, ?)`,
    );

    try {
      for (const photo of photos) {
        await statement.executeAsync([
          photo.id,
          photo.uri,
          photo.creationTime,
          photo.latitude,
          photo.longitude,
        ]);
      }
    } finally {
      await statement.finalizeAsync();
    }

    await txn.runAsync(
      `UPDATE scan_state
       SET after_cursor = ?, scanned = ?, found = ?, total = ?, complete = ?
       WHERE id = 1`,
      endCursor,
      progress.scanned,
      progress.found,
      progress.total,
      progress.complete ? 1 : 0,
    );
  });
}

export async function getYears() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ year: string }>(
    `SELECT DISTINCT strftime('%Y', creation_time / 1000, 'unixepoch') AS year
     FROM photos
     ORDER BY year DESC`,
  );
  return rows.map((row) => Number(row.year)).filter(Number.isFinite);
}

export async function getPhotoCount(year: number | null) {
  const db = await getDatabase();
  const { clause, params } = yearFilter(year);
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM photos ${clause}`,
    params,
  );
  return row?.count ?? 0;
}

export async function getRegionForYear(year: number | null): Promise<Region> {
  const db = await getDatabase();
  const { clause, params } = yearFilter(year);
  const row = await db.getFirstAsync<{
    min_latitude: number | null;
    max_latitude: number | null;
    min_longitude: number | null;
    max_longitude: number | null;
  }>(
    `SELECT
       MIN(latitude) AS min_latitude,
       MAX(latitude) AS max_latitude,
       MIN(longitude) AS min_longitude,
       MAX(longitude) AS max_longitude
     FROM photos ${clause}`,
    params,
  );

  if (
    row?.min_latitude == null ||
    row.max_latitude == null ||
    row.min_longitude == null ||
    row.max_longitude == null
  ) {
    return defaultRegion();
  }

  return {
    latitude: (row.min_latitude + row.max_latitude) / 2,
    longitude: (row.min_longitude + row.max_longitude) / 2,
    latitudeDelta: Math.max((row.max_latitude - row.min_latitude) * 1.35, 0.08),
    longitudeDelta: Math.max((row.max_longitude - row.min_longitude) * 1.35, 0.08),
  };
}

export async function getClusters(region: Region, year: number | null): Promise<MapCluster[]> {
  const db = await getDatabase();
  const gridSize = getGridSize(region.longitudeDelta);
  const latitudePadding = region.latitudeDelta * 0.65;
  const longitudePadding = region.longitudeDelta * 0.65;
  const minLatitude = Math.max(-90, region.latitude - latitudePadding);
  const maxLatitude = Math.min(90, region.latitude + latitudePadding);
  const minLongitude = Math.max(-180, region.longitude - longitudePadding);
  const maxLongitude = Math.min(180, region.longitude + longitudePadding);
  const { start, end } = yearRange(year);
  const yearClause = year === null ? '' : 'AND creation_time >= ? AND creation_time < ?';
  const params: (number | string)[] = [
    gridSize,
    gridSize,
    minLatitude,
    maxLatitude,
    minLongitude,
    maxLongitude,
  ];
  if (year !== null) params.push(start, end);

  const rows = await db.getAllAsync<{
    cell_latitude: number;
    cell_longitude: number;
    latitude: number;
    longitude: number;
    count: number;
  }>(
    `SELECT
       ROUND(latitude / ?) AS cell_latitude,
       ROUND(longitude / ?) AS cell_longitude,
       AVG(latitude) AS latitude,
       AVG(longitude) AS longitude,
       COUNT(*) AS count
     FROM photos
     WHERE latitude BETWEEN ? AND ?
       AND longitude BETWEEN ? AND ?
       ${yearClause}
     GROUP BY cell_latitude, cell_longitude
     LIMIT 1200`,
    params,
  );

  return rows.map((row) => ({
    key: `${gridSize}:${row.cell_latitude}:${row.cell_longitude}`,
    latitude: row.latitude,
    longitude: row.longitude,
    count: row.count,
    cellLatitude: row.cell_latitude,
    cellLongitude: row.cell_longitude,
    gridSize,
  }));
}

export async function getPhotosForCluster(cluster: MapCluster, year: number | null) {
  const db = await getDatabase();
  const { start, end } = yearRange(year);
  const yearClause = year === null ? '' : 'AND creation_time >= ? AND creation_time < ?';
  const params: number[] = [
    cluster.gridSize,
    cluster.cellLatitude,
    cluster.gridSize,
    cluster.cellLongitude,
  ];
  if (year !== null) params.push(start, end);

  const rows = await db.getAllAsync<{
    id: string;
    uri: string;
    creation_time: number;
    latitude: number;
    longitude: number;
  }>(
    `SELECT id, uri, creation_time, latitude, longitude
     FROM photos
     WHERE ROUND(latitude / ?) = ?
       AND ROUND(longitude / ?) = ?
       ${yearClause}
     ORDER BY creation_time DESC
     LIMIT 50`,
    params,
  );

  return rows.map(rowToPhoto);
}

export async function getExportClusters(year: number | null): Promise<ExportCluster[]> {
  const db = await getDatabase();
  const gridSize = 0.001;
  const { clause, params } = yearFilter(year);
  const rows = await db.getAllAsync<{
    latitude: number;
    longitude: number;
    count: number;
    first_time: number;
    last_time: number;
  }>(
    `SELECT
       AVG(latitude) AS latitude,
       AVG(longitude) AS longitude,
       COUNT(*) AS count,
       MIN(creation_time) AS first_time,
       MAX(creation_time) AS last_time
     FROM photos
     ${clause}
     GROUP BY ROUND(latitude / ${gridSize}), ROUND(longitude / ${gridSize})`,
    params,
  );

  return rows.map((row) => ({
    latitude: row.latitude,
    longitude: row.longitude,
    count: row.count,
    firstTime: row.first_time,
    lastTime: row.last_time,
  }));
}

function rowToPhoto(row: {
  id: string;
  uri: string;
  creation_time: number;
  latitude: number;
  longitude: number;
}): GeoPhoto {
  return {
    id: row.id,
    uri: row.uri,
    creationTime: row.creation_time,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

function yearFilter(year: number | null) {
  if (year === null) return { clause: '', params: [] as number[] };
  const { start, end } = yearRange(year);
  return { clause: 'WHERE creation_time >= ? AND creation_time < ?', params: [start, end] };
}

function yearRange(year: number | null) {
  if (year === null) return { start: 0, end: Number.MAX_SAFE_INTEGER };
  return {
    start: new Date(year, 0, 1).getTime(),
    end: new Date(year + 1, 0, 1).getTime(),
  };
}

function defaultRegion(): Region {
  return {
    latitude: 54.75,
    longitude: 23.9,
    latitudeDelta: 5,
    longitudeDelta: 5,
  };
}
