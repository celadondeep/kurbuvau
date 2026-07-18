import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';

import {
  getClusters,
  getExportClusters,
  getPhotoCount,
  getPhotosForCluster,
  getRegionForYear,
  getScanState,
  getYears,
  initializeDatabase,
  resetScan,
  saveScanBatch,
} from './src/database';
import { exportClustersToKml } from './src/exportKml';
import { scanPhotoLibrary } from './src/photoLibrary';
import { GeoPhoto, MapCluster, ScanProgress, ScanState } from './src/types';

type AppStage = 'loading' | 'intro' | 'scanning' | 'map';

const DEFAULT_REGION: Region = {
  latitude: 54.75,
  longitude: 23.9,
  latitudeDelta: 5,
  longitudeDelta: 5,
};

const EMPTY_SCAN: ScanState = {
  afterCursor: null,
  scanned: 0,
  found: 0,
  total: 0,
  complete: false,
};

export default function App() {
  const mapRef = useRef<MapView>(null);
  const stopScanRef = useRef(false);
  const clusterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stage, setStage] = useState<AppStage>('loading');
  const [permission, setPermission] = useState<MediaLibrary.PermissionResponse | null>(null);
  const [scanState, setScanState] = useState<ScanState>(EMPTY_SCAN);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    scanned: 0,
    found: 0,
    total: 0,
    complete: false,
  });
  const [stopRequested, setStopRequested] = useState(false);
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [clusters, setClusters] = useState<MapCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<MapCluster | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<GeoPhoto[]>([]);

  const loadClusters = useCallback(async (nextRegion: Region, year: number | null) => {
    const nextClusters = await getClusters(nextRegion, year);
    setClusters(nextClusters);
  }, []);

  const loadMap = useCallback(
    async (year: number | null, animate = false) => {
      const [nextYears, nextCount, nextRegion] = await Promise.all([
        getYears(),
        getPhotoCount(year),
        getRegionForYear(year),
      ]);
      setYears(nextYears);
      setPhotoCount(nextCount);
      setRegion(nextRegion);
      await loadClusters(nextRegion, year);
      if (animate) mapRef.current?.animateToRegion(nextRegion, 450);
    },
    [loadClusters],
  );

  useEffect(() => {
    const restore = async () => {
      await initializeDatabase();
      const [currentPermission, currentScan, count] = await Promise.all([
        MediaLibrary.getPermissionsAsync(false, ['photo']),
        getScanState(),
        getPhotoCount(null),
      ]);

      setPermission(currentPermission);
      setScanState(currentScan);

      if (count > 0) {
        await loadMap(null);
        setStage('map');
      } else {
        setStage('intro');
      }
    };

    restore().catch(() => setStage('intro'));
    return () => {
      if (clusterTimerRef.current) clearTimeout(clusterTimerRef.current);
    };
  }, [loadMap]);

  const finishOrPauseScan = useCallback(
    async (progress: ScanProgress) => {
      const latestState = await getScanState();
      setScanState(latestState);
      setStopRequested(false);

      const count = await getPhotoCount(null);
      if (count > 0) {
        await loadMap(null);
        setSelectedYear(null);
        setSelectedCluster(null);
        setSelectedPhotos([]);
        setStage('map');
      } else {
        setStage('intro');
        if (progress.complete) {
          Alert.alert(
            'Vietų nerasta',
            'Pasirinktose nuotraukose nėra GPS duomenų. Jei leidai prieigą tik prie dalies nuotraukų, pasirink daugiau.',
          );
        }
      }
    },
    [loadMap],
  );

  const runScan = useCallback(
    async (fresh: boolean) => {
      try {
        let currentPermission = permission;
        if (currentPermission?.status !== 'granted') {
          currentPermission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
          setPermission(currentPermission);
        }

        if (currentPermission.status !== 'granted') {
          Alert.alert(
            'Reikia leidimo',
            'Be prieigos prie nuotraukų programėlė negali nuskaityti jų vietų.',
            [
              { text: 'Atšaukti', style: 'cancel' },
              { text: 'Atidaryti nustatymus', onPress: () => Linking.openSettings() },
            ],
          );
          return;
        }

        if (fresh) await resetScan();
        const startingState = await getScanState();
        stopScanRef.current = false;
        setStopRequested(false);
        setScanProgress({ ...startingState, complete: false });
        setStage('scanning');

        const result = await scanPhotoLibrary({
          afterCursor: startingState.afterCursor,
          scanned: startingState.scanned,
          found: startingState.found,
          shouldStop: () => stopScanRef.current,
          onBatch: async (photos, progress, endCursor) => {
            await saveScanBatch(photos, progress, endCursor);
            setScanProgress(progress);
          },
        });

        await finishOrPauseScan(result);
      } catch (error) {
        setStopRequested(false);
        const count = await getPhotoCount(null).catch(() => 0);
        setStage(count > 0 ? 'map' : 'intro');
        Alert.alert(
          'Nuskaitymas sustojo',
          `${error instanceof Error ? error.message : 'Nežinoma klaida.'}\n\nIšsaugota pažanga neprarasta.`,
        );
      }
    },
    [finishOrPauseScan, permission],
  );

  const startOrResumeScan = useCallback(() => {
    if (scanState.scanned > 0 && !scanState.complete) {
      runScan(false);
      return;
    }

    if (scanState.complete) {
      Alert.alert(
        'Nuskaityti iš naujo?',
        'Bus atnaujintas tik vietinis indeksas. Pačios nuotraukos nebus keičiamos.',
        [
          { text: 'Atšaukti', style: 'cancel' },
          { text: 'Nuskaityti', onPress: () => runScan(true) },
        ],
      );
      return;
    }

    runScan(false);
  }, [runScan, scanState.complete, scanState.scanned]);

  const chooseYear = useCallback(
    async (year: number | null) => {
      setSelectedYear(year);
      setSelectedCluster(null);
      setSelectedPhotos([]);
      await loadMap(year, true);
    },
    [loadMap],
  );

  const onRegionChanged = useCallback(
    (nextRegion: Region) => {
      setRegion(nextRegion);
      if (clusterTimerRef.current) clearTimeout(clusterTimerRef.current);
      clusterTimerRef.current = setTimeout(() => {
        loadClusters(nextRegion, selectedYear).catch(() => undefined);
      }, 180);
    },
    [loadClusters, selectedYear],
  );

  const selectCluster = useCallback(
    async (cluster: MapCluster) => {
      setSelectedCluster(cluster);
      const photos = await getPhotosForCluster(cluster, selectedYear);
      setSelectedPhotos(photos);
    },
    [selectedYear],
  );

  const exportMap = useCallback(async () => {
    try {
      const exportClusters = await getExportClusters(selectedYear);
      await exportClustersToKml(exportClusters, selectedYear);
    } catch (error) {
      Alert.alert(
        'Eksportuoti nepavyko',
        error instanceof Error ? error.message : 'Pabandyk dar kartą.',
      );
    }
  }, [selectedYear]);

  const progressPercent = useMemo(() => {
    if (scanProgress.total <= 0) return 0;
    return Math.min(100, Math.round((scanProgress.scanned / scanProgress.total) * 100));
  }, [scanProgress.scanned, scanProgress.total]);

  if (stage === 'loading') {
    return (
      <SafeAreaView style={styles.introRoot}>
        <StatusBar style="dark" />
        <ActivityIndicator color="#176BFF" size="large" />
      </SafeAreaView>
    );
  }

  if (stage === 'intro') {
    return (
      <SafeAreaView style={styles.introRoot}>
        <StatusBar style="dark" />
        <View style={styles.introContent}>
          <View style={styles.logoMark}>
            <View style={styles.logoHole} />
          </View>
          <Text style={styles.eyebrow}>KUR BUVAU</Text>
          <Text style={styles.introTitle}>Tavo kelionės.{`\n`}Viename žemėlapyje.</Text>
          <Text style={styles.introDescription}>
            Nuotraukos tikrinamos mažomis dalimis, todėl didelė galerija neperkraus telefono.
          </Text>
          <View style={styles.privacyCard}>
            <View style={styles.privacyIcon}>
              <Text style={styles.privacyIconText}>✓</Text>
            </View>
            <View style={styles.privacyCopy}>
              <Text style={styles.privacyTitle}>Privatu ir tęsiama</Text>
              <Text style={styles.privacyText}>Pažanga saugoma kas 200 nuotraukų.</Text>
            </View>
          </View>
        </View>
        <View style={styles.introFooter}>
          <Pressable
            onPress={startOrResumeScan}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>
              {scanState.scanned > 0 ? 'Tęsti nuskaitymą' : 'Rodyti mano vietas'}
            </Text>
          </Pressable>
          {permission?.accessPrivileges === 'limited' && (
            <Pressable
              onPress={() => MediaLibrary.presentPermissionsPickerAsync(['photo'])}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Pasirinkti daugiau nuotraukų</Text>
            </Pressable>
          )}
          <Text style={styles.footerNote}>Tik skaitymo prieiga • Nieko neištrinsime</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (stage === 'scanning') {
    return (
      <SafeAreaView style={styles.scanRoot}>
        <StatusBar style="dark" />
        <View style={styles.scanOrb}>
          <ActivityIndicator color="#FFFFFF" size="large" />
        </View>
        <Text style={styles.scanTitle}>Kuriamas vietų žemėlapis</Text>
        <Text style={styles.scanText}>
          {scanProgress.scanned.toLocaleString('lt-LT')} iš{' '}
          {scanProgress.total.toLocaleString('lt-LT')} nuotraukų
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <View style={styles.foundPill}>
          <Text style={styles.foundPillText}>
            {progressPercent}% • Su vieta: {scanProgress.found.toLocaleString('lt-LT')}
          </Text>
        </View>
        <Text style={styles.scanHint}>
          Rezultatai įrašomi po kiekvienų 200 nuotraukų. Sustabdęs galėsi tęsti nuo tos pačios vietos.
        </Text>
        <Pressable
          disabled={stopRequested}
          onPress={() => {
            stopScanRef.current = true;
            setStopRequested(true);
          }}
          style={styles.pauseButton}
        >
          <Text style={styles.pauseButtonText}>{stopRequested ? 'Stabdoma…' : 'Sustabdyti'}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.mapRoot}>
      <StatusBar style="dark" />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onPress={() => {
          setSelectedCluster(null);
          setSelectedPhotos([]);
        }}
        onRegionChangeComplete={onRegionChanged}
        showsCompass={false}
      >
        {clusters.map((cluster) => (
          <Marker
            key={cluster.key}
            coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
            onPress={(event) => {
              event.stopPropagation();
              selectCluster(cluster).catch(() => undefined);
            }}
          >
            <View
              style={[
                styles.marker,
                selectedCluster?.key === cluster.key && styles.markerSelected,
              ]}
            >
              <Text style={styles.markerText}>{cluster.count}</Text>
            </View>
            <View
              style={[
                styles.markerTip,
                selectedCluster?.key === cluster.key && styles.markerTipSelected,
              ]}
            />
          </Marker>
        ))}
      </MapView>

      <SafeAreaView pointerEvents="box-none" style={styles.mapOverlay}>
        <View style={styles.topCard}>
          <View>
            <Text style={styles.mapTitle}>Kur buvau</Text>
            <Text style={styles.mapSubtitle}>
              {clusters.length} vietų ekrane • {photoCount.toLocaleString('lt-LT')} nuotraukų
            </Text>
          </View>
          <View style={styles.topActions}>
            <Pressable onPress={exportMap} style={styles.roundButton}>
              <Text style={styles.roundButtonText}>↑</Text>
            </Pressable>
            <Pressable onPress={startOrResumeScan} style={styles.roundButton}>
              <Text style={styles.roundButtonText}>↻</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.yearBar}
        >
          <YearChip active={selectedYear === null} label="Visi" onPress={() => chooseYear(null)} />
          {years.map((year) => (
            <YearChip
              key={year}
              active={selectedYear === year}
              label={String(year)}
              onPress={() => chooseYear(year)}
            />
          ))}
        </ScrollView>

        <View style={styles.overlaySpacer} />

        {selectedCluster ? (
          <View style={styles.detailCard}>
            <View style={styles.detailHandle} />
            <View style={styles.detailHeader}>
              <View>
                <Text style={styles.detailTitle}>{selectedCluster.count} nuotraukų</Text>
                <Text style={styles.detailDate}>{formatClusterDate(selectedPhotos)}</Text>
              </View>
              <Pressable
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${selectedCluster.latitude},${selectedCluster.longitude}`,
                  )
                }
                style={styles.googleButton}
              >
                <Text style={styles.googleButtonText}>Google Maps</Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoStrip}
            >
              {selectedPhotos.slice(0, 20).map((photo) => (
                <Image
                  key={photo.id}
                  source={{ uri: photo.uri }}
                  style={styles.thumbnail}
                  contentFit="cover"
                  transition={160}
                />
              ))}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.mapHint}>
            <Text style={styles.mapHintText}>
              {scanState.complete
                ? 'Paspausk tašką ir pamatysi nuotraukas'
                : `Išsaugota ${scanState.scanned.toLocaleString('lt-LT')} iš ${scanState.total.toLocaleString('lt-LT')} • ↻ tęsti`}
            </Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function YearChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.yearChip,
        active && styles.yearChipActive,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.yearChipText, active && styles.yearChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function formatClusterDate(photos: GeoPhoto[]) {
  if (photos.length === 0) return 'Kraunama…';
  const times = photos.map((photo) => photo.creationTime).sort((a, b) => a - b);
  const format = new Intl.DateTimeFormat('lt-LT', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const first = format.format(new Date(times[0]));
  const last = format.format(new Date(times[times.length - 1]));
  return first === last ? first : `${first} – ${last}`;
}

const styles = StyleSheet.create({
  introRoot: { flex: 1, backgroundColor: '#F4F7FB', alignItems: 'center', justifyContent: 'center' },
  introContent: { flex: 1, width: '100%', paddingHorizontal: 28, justifyContent: 'center' },
  logoMark: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderBottomRightRadius: 8,
    backgroundColor: '#176BFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
    transform: [{ rotate: '45deg' }],
    shadowColor: '#176BFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
  },
  logoHole: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF' },
  eyebrow: { color: '#176BFF', fontWeight: '800', fontSize: 12, letterSpacing: 2.2, marginBottom: 10 },
  introTitle: { color: '#101827', fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1.4 },
  introDescription: { color: '#5E6878', fontSize: 17, lineHeight: 25, marginTop: 18, maxWidth: 340 },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginTop: 32,
    shadowColor: '#20304A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
  },
  privacyIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7F8EE', marginRight: 12 },
  privacyIconText: { color: '#178447', fontWeight: '900', fontSize: 18 },
  privacyCopy: { flex: 1 },
  privacyTitle: { color: '#172033', fontWeight: '700', fontSize: 15 },
  privacyText: { color: '#6A7484', fontSize: 13, marginTop: 3 },
  introFooter: { width: '100%', paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 16 : 24 },
  primaryButton: { height: 58, borderRadius: 18, backgroundColor: '#176BFF', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  secondaryButton: { alignItems: 'center', paddingVertical: 13 },
  secondaryButtonText: { color: '#176BFF', fontSize: 14, fontWeight: '600' },
  footerNote: { textAlign: 'center', color: '#9099A7', fontSize: 12, marginTop: 12 },
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  scanRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: '#F4F7FB' },
  scanOrb: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: '#176BFF' },
  scanTitle: { marginTop: 34, color: '#111827', fontSize: 27, fontWeight: '800', letterSpacing: -0.7, textAlign: 'center' },
  scanText: { marginTop: 12, color: '#687386', fontSize: 16 },
  progressTrack: { width: '100%', maxWidth: 320, height: 9, backgroundColor: '#DEE6F2', borderRadius: 99, overflow: 'hidden', marginTop: 20 },
  progressFill: { height: '100%', borderRadius: 99, backgroundColor: '#176BFF' },
  foundPill: { marginTop: 16, backgroundColor: '#E8F0FF', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  foundPillText: { color: '#176BFF', fontWeight: '700', fontSize: 14 },
  scanHint: { marginTop: 24, color: '#9099A7', fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 320 },
  pauseButton: { marginTop: 22, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14, backgroundColor: '#FFFFFF' },
  pauseButtonText: { color: '#4D596B', fontWeight: '700', fontSize: 14 },
  mapRoot: { flex: 1, backgroundColor: '#DDE5EE' },
  mapOverlay: { flex: 1, paddingHorizontal: 14, paddingTop: Platform.OS === 'ios' ? 6 : 14 },
  topCard: {
    minHeight: 72,
    borderRadius: 22,
    paddingLeft: 18,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.94)',
    shadowColor: '#233044',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.13,
    shadowRadius: 18,
  },
  mapTitle: { color: '#101827', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  mapSubtitle: { color: '#6F7888', fontSize: 12, marginTop: 2 },
  topActions: { flexDirection: 'row', gap: 7 },
  roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF3FB' },
  roundButtonText: { color: '#176BFF', fontSize: 23, lineHeight: 26, fontWeight: '700' },
  yearBar: { gap: 8, paddingTop: 10, paddingBottom: 6, paddingHorizontal: 2 },
  yearChip: { height: 38, paddingHorizontal: 16, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.94)' },
  yearChipActive: { backgroundColor: '#176BFF' },
  yearChipText: { color: '#4D596B', fontSize: 13, fontWeight: '700' },
  yearChipTextActive: { color: '#FFFFFF' },
  overlaySpacer: { flex: 1 },
  marker: { minWidth: 38, height: 38, paddingHorizontal: 8, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#176BFF', borderWidth: 3, borderColor: '#FFFFFF' },
  markerSelected: { backgroundColor: '#111827', transform: [{ scale: 1.14 }] },
  markerText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  markerTip: { width: 9, height: 9, backgroundColor: '#176BFF', transform: [{ rotate: '45deg' }], alignSelf: 'center', marginTop: -7 },
  markerTipSelected: { backgroundColor: '#111827' },
  mapHint: { alignSelf: 'center', borderRadius: 999, paddingHorizontal: 17, paddingVertical: 11, marginBottom: Platform.OS === 'ios' ? 6 : 14, backgroundColor: 'rgba(17,24,39,0.86)' },
  mapHintText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  detailCard: { borderRadius: 26, paddingTop: 9, paddingBottom: 16, marginBottom: Platform.OS === 'ios' ? 4 : 10, backgroundColor: 'rgba(255,255,255,0.97)' },
  detailHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: '#D9DEE6', marginBottom: 10 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  detailTitle: { color: '#111827', fontSize: 18, fontWeight: '800' },
  detailDate: { color: '#7A8493', fontSize: 12, marginTop: 3, maxWidth: 210 },
  googleButton: { backgroundColor: '#E8F0FF', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
  googleButtonText: { color: '#176BFF', fontSize: 12, fontWeight: '700' },
  photoStrip: { gap: 8, paddingTop: 13, paddingHorizontal: 16 },
  thumbnail: { width: 82, height: 82, borderRadius: 14, backgroundColor: '#E8ECF2' },
});
