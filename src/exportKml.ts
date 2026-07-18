import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { clusterPhotos } from './map';
import { GeoPhoto } from './types';

export async function exportPhotosToKml(photos: GeoPhoto[], year: number | null) {
  if (photos.length === 0) {
    throw new Error('Nėra vietų, kurias būtų galima eksportuoti.');
  }

  const exportClusters = clusterPhotos(photos, 0.05);
  const placemarks = exportClusters
    .map((cluster, index) => {
      const dates = cluster.photos.map((photo) => photo.creationTime).sort((a, b) => a - b);
      const firstDate = new Date(dates[0]).toISOString().slice(0, 10);
      const lastDate = new Date(dates[dates.length - 1]).toISOString().slice(0, 10);
      const dateText = firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;

      return `
    <Placemark>
      <name>${xmlEscape(`Vieta ${index + 1} • ${cluster.photos.length} nuotraukų`)}</name>
      <description>${xmlEscape(dateText)}</description>
      <Point><coordinates>${cluster.longitude},${cluster.latitude},0</coordinates></Point>
    </Placemark>`;
    })
    .join('');

  const documentName = year === null ? 'Kur buvau' : `Kur buvau • ${year}`;
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(documentName)}</name>${placemarks}
  </Document>
</kml>`;

  const filename = year === null ? 'kur-buvau.kml' : `kur-buvau-${year}.kml`;
  const file = new File(Paths.cache, filename);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(kml);

  const sharingAvailable = await Sharing.isAvailableAsync();
  if (!sharingAvailable) {
    throw new Error('Šiame įrenginyje bendrinimas nepasiekiamas.');
  }

  await Sharing.shareAsync(file.uri, {
    dialogTitle: 'Eksportuoti aplankytas vietas',
    mimeType: 'application/vnd.google-earth.kml+xml',
    UTI: 'com.google.earth.kml',
  });
}

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
