import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { ExportCluster } from './types';

export async function exportClustersToKml(clusters: ExportCluster[], year: number | null) {
  if (clusters.length === 0) {
    throw new Error('Nėra vietų, kurias būtų galima eksportuoti.');
  }

  const placemarks = clusters
    .map((cluster, index) => {
      const firstDate = new Date(cluster.firstTime).toISOString().slice(0, 10);
      const lastDate = new Date(cluster.lastTime).toISOString().slice(0, 10);
      const dateText = firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;

      return `
    <Placemark>
      <name>${xmlEscape(`Vieta ${index + 1} • ${cluster.count} nuotraukų`)}</name>
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
  if (file.exists) file.delete();
  file.create();
  file.write(kml);

  if (!(await Sharing.isAvailableAsync())) {
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
