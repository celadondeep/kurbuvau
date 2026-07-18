import { Region } from 'react-native-maps';

import { GeoPhoto, PhotoCluster } from './types';

export function clusterPhotos(photos: GeoPhoto[], longitudeDelta: number): PhotoCluster[] {
  const gridSize = getGridSize(longitudeDelta);
  const groups = new Map<string, GeoPhoto[]>();

  for (const photo of photos) {
    const latitudeCell = Math.round(photo.latitude / gridSize);
    const longitudeCell = Math.round(photo.longitude / gridSize);
    const key = `${gridSize}:${latitudeCell}:${longitudeCell}`;
    const group = groups.get(key);
    if (group) {
      group.push(photo);
    } else {
      groups.set(key, [photo]);
    }
  }

  return [...groups.entries()].map(([key, groupedPhotos]) => ({
    key,
    latitude:
      groupedPhotos.reduce((sum, photo) => sum + photo.latitude, 0) / groupedPhotos.length,
    longitude:
      groupedPhotos.reduce((sum, photo) => sum + photo.longitude, 0) / groupedPhotos.length,
    photos: groupedPhotos,
  }));
}

export function getRegionForPhotos(photos: GeoPhoto[]): Region {
  if (photos.length === 0) {
    return {
      latitude: 54.75,
      longitude: 23.9,
      latitudeDelta: 5,
      longitudeDelta: 5,
    };
  }

  let minLatitude = photos[0].latitude;
  let maxLatitude = photos[0].latitude;
  let minLongitude = photos[0].longitude;
  let maxLongitude = photos[0].longitude;

  for (const photo of photos.slice(1)) {
    minLatitude = Math.min(minLatitude, photo.latitude);
    maxLatitude = Math.max(maxLatitude, photo.latitude);
    minLongitude = Math.min(minLongitude, photo.longitude);
    maxLongitude = Math.max(maxLongitude, photo.longitude);
  }

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.35, 0.08),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.35, 0.08),
  };
}

function getGridSize(longitudeDelta: number) {
  if (longitudeDelta > 80) return 5;
  if (longitudeDelta > 40) return 2;
  if (longitudeDelta > 20) return 1;
  if (longitudeDelta > 8) return 0.4;
  if (longitudeDelta > 3) return 0.15;
  if (longitudeDelta > 1) return 0.05;
  if (longitudeDelta > 0.3) return 0.015;
  if (longitudeDelta > 0.1) return 0.005;
  return 0.001;
}
