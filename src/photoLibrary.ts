import {
  AssetField,
  MediaType,
  Query,
  SortDescriptor,
} from 'expo-media-library';

import { GeoPhoto, ScanProgress } from './types';

const PAGE_SIZE = 250;
const PARALLEL_READS = 20;

export async function scanPhotoLibrary(
  onProgress: (progress: ScanProgress) => void,
): Promise<GeoPhoto[]> {
  const result: GeoPhoto[] = [];
  let offset = 0;
  let scanned = 0;

  while (true) {
    const sort: SortDescriptor = {
      key: AssetField.CREATION_TIME,
      ascending: false,
    };
    const assets = await new Query()
      .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
      .orderBy(sort)
      .limit(PAGE_SIZE)
      .offset(offset)
      .exe();

    if (assets.length === 0) {
      break;
    }

    for (let index = 0; index < assets.length; index += PARALLEL_READS) {
      const slice = assets.slice(index, index + PARALLEL_READS);
      const resolved = await Promise.all(
        slice.map(async (asset): Promise<GeoPhoto | null> => {
          try {
            const location = await asset.getLocation();
            if (!location || !isValidCoordinate(location.latitude, location.longitude)) {
              return null;
            }

            const [creationTime, uri] = await Promise.all([
              asset.getCreationTime(),
              asset.getUri(),
            ]);

            return {
              id: asset.id,
              uri,
              creationTime: creationTime ?? Date.now(),
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

    offset += assets.length;
    if (assets.length < PAGE_SIZE) {
      break;
    }
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
