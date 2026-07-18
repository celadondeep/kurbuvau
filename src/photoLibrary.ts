import * as MediaLibrary from 'expo-media-library';

import { GeoPhoto, ScanProgress } from './types';

const PAGE_SIZE = 250;
const PARALLEL_READS = 20;

export async function scanPhotoLibrary(
  onProgress: (progress: ScanProgress) => void,
): Promise<GeoPhoto[]> {
  const result: GeoPhoto[] = [];
  let after: string | undefined;
  let scanned = 0;

  while (true) {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after,
      mediaType: [MediaLibrary.MediaType.photo],
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    });

    if (page.assets.length === 0) {
      break;
    }

    for (let index = 0; index < page.assets.length; index += PARALLEL_READS) {
      const slice = page.assets.slice(index, index + PARALLEL_READS);
      const resolved = await Promise.all(
        slice.map(async (asset): Promise<GeoPhoto | null> => {
          try {
            const info = await MediaLibrary.getAssetInfoAsync(asset);
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

      result.push(...resolved.filter((photo): photo is GeoPhoto => photo !== null));
      scanned += slice.length;
      onProgress({ scanned, found: result.length });
    }

    if (!page.hasNextPage) {
      break;
    }
    after = page.endCursor;
  }

  return result;
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
