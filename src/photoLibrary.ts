import * as MediaLibrary from 'expo-media-library';

import { GeoPhoto, ScanProgress } from './types';

const PAGE_SIZE = 200;
const PARALLEL_READS = 8;

type ScanOptions = {
  afterCursor: string | null;
  scanned: number;
  found: number;
  shouldStop: () => boolean;
  onBatch: (photos: GeoPhoto[], progress: ScanProgress, endCursor: string | null) => Promise<void>;
};

export async function scanPhotoLibrary(options: ScanOptions): Promise<ScanProgress> {
  let after = options.afterCursor ?? undefined;
  let scanned = options.scanned;
  let found = options.found;

  while (!options.shouldStop()) {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after,
      mediaType: [MediaLibrary.MediaType.photo],
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    });

    if (page.assets.length === 0) {
      const progress = { scanned, found, total: page.totalCount, complete: true };
      await options.onBatch([], progress, null);
      return progress;
    }

    const locatedPhotos: GeoPhoto[] = [];

    for (let index = 0; index < page.assets.length; index += PARALLEL_READS) {
      const slice = page.assets.slice(index, index + PARALLEL_READS);
      const resolved = await Promise.all(
        slice.map(async (asset): Promise<GeoPhoto | null> => {
          try {
            const info = await MediaLibrary.getAssetInfoAsync(asset, {
              shouldDownloadFromNetwork: false,
            });
            const location = info.location;
            if (!location || !isValidCoordinate(location.latitude, location.longitude)) {
              return null;
            }

            return {
              id: asset.id,
              uri: info.localUri ?? asset.uri,
              creationTime: asset.creationTime,
              latitude: location.latitude,
              longitude: location.longitude,
            };
          } catch {
            return null;
          }
        }),
      );

      locatedPhotos.push(...resolved.filter((photo): photo is GeoPhoto => photo !== null));
    }

    scanned += page.assets.length;
    found += locatedPhotos.length;
    const complete = !page.hasNextPage;
    const progress = { scanned, found, total: page.totalCount, complete };
    await options.onBatch(locatedPhotos, progress, complete ? null : page.endCursor);

    if (complete) {
      return progress;
    }

    after = page.endCursor;
  }

  return { scanned, found, total: Math.max(scanned, options.scanned), complete: false };
}

function isValidCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}
