import AsyncStorage from '@react-native-async-storage/async-storage';
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

import { exportPhotosToKml } from './src/exportKml';
import { clusterPhotos, getRegionForPhotos } from './src/map';
import { scanPhotoLibrary } from './src/photoLibrary';
import { GeoPhoto, ScanProgress } from './src/types';

const CACHE_KEY = 'kur-buvau.photos.v1';

type AppStage = 'loading' | 'intro' | 'scanning' | 'map';

export default function App() {
  const mapRef = useRef<MapView>(null);
  const [stage, setStage] = useState<AppStage>('loading');
  const [photos, setPhotos] = useState<GeoPhoto[]>([]);
  const [permission, setPermission] = useState<MediaLibrary.PermissionResponse | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({ scanned: 0, found: 0 });
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);
  const [region, setRegion] = useState<Region>({
    latitude: 54.75,
    longitude: 23.9,
    latitudeDelta: 5,
    longitudeDelta: 5,
  });

  useEffect(() => {
    const restore = async () => {
      const [cached, currentPermission] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY),
        MediaLibrary.getPermissionsAsync(false, ['photo']),
      ]);

      setPermission(currentPermission);

      if (cached) {
        try {
          const restored = JSON.parse(cached) as GeoPhoto[];
          if (restored.length > 0) {
            setPhotos(restored);
            const restoredRegion = getRegionForPhotos(restored);
            setRegion(restoredRegion);
            setStage('map');
            return;
          }
        } catch {
          await AsyncStorage.removeItem(CACHE_KEY);
        }
      }

      setStage('intro');
    };

    restore().catch(() => setStage('intro'));
  }, []);

  const years = useMemo(
    () =>
      [...new Set(photos.map((photo) => new Date(photo.creationTime).getFullYear()))].sort(
        (a, b) => b - a,
      ),
    [photos],
  );

  const filteredPhotos = useMemo(
    () =>
      selectedYear === null
        ? photos
        : photos.filter(
            (photo) => new Date(photo.creationTime).getFullYear() === selectedYear,
          ),
    [photos, selectedYear],
  );

  const clusters = useMemo(
    () => clusterPhotos(filteredPhotos, region.longitudeDelta),
    [filteredPhotos, region.longitudeDelta],
  );

  const selectedCluster = useMemo(
    () => clusters.find((cluster) => cluster.key === selectedClusterKey) ?? null,
    [clusters, selectedClusterKey],
  );

  const startScan = useCallback(async () => {
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

      setStage('scanning');
      setScanProgress({ scanned: 0, found: 0 });

      const foundPhotos = await scanPhotoLibrary(setScanProgress);
      setPhotos(foundPhotos);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(foundPhotos));

      if (foundPhotos.length === 0) {
        setStage('intro');
        Alert.alert(
          'Vietų nerasta',
          'Pasirinktose nuotraukose nėra GPS duomenų. Jei leidai prieigą tik prie dalies nuotraukų, pasirink daugiau.',
        );
        return;
      }

      const nextRegion = getRegionForPhotos(foundPhotos);
      setRegion(nextRegion);
      setSelectedYear(null);
      setSelectedClusterKey(null);
      setStage('map');
    } catch (error) {
      setStage(photos.length > 0 ? 'map' : 'intro');
      Alert.alert(
        'Nepavyko nuskaityti',
        error instanceof Error ? error.message : 'Pabandyk dar kartą.',
      );
    }
  }, [permission, photos.length]);

  const chooseYear = useCallback(
    (year: number | null) => {
      setSelectedYear(year);
      setSelectedClusterKey(null);
      const nextPhotos =
        year === null
          ? photos
          : photos.filter((photo) => new Date(photo.creationTime).getFullYear() === year);
      const nextRegion = getRegionForPhotos(nextPhotos);
      setRegion(nextRegion);
      mapRef.current?.animateToRegion(nextRegion, 450);
    },
    [photos],
  );

  const exportMap = useCallback(async () => {
    try {
      await exportPhotosToKml(filteredPhotos, selectedYear);
    } catch (error) {
      Alert.alert(
        'Eksportuoti nepavyko',
        error instanceof Error ? error.message : 'Pabandyk dar kartą.',
      );
    }
  }, [filteredPhotos, selectedYear]);

  const openInGoogleMaps = useCallback(async (latitude: number, longitude: number) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    await Linking.openURL(url);
  }, []);

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
            Programėlė suras nuotraukas su vietos duomenimis ir parodys, kur esi buvęs.
          </Text>

          <View style={styles.privacyCard}>
            <View style={styles.privacyIcon}>
              <Text style={styles.privacyIconText}>✓</Text>
            </View>
            <View style={styles.privacyCopy}>
              <Text style={styles.privacyTitle}>Privatu pagal nutylėjimą</Text>
              <Text style={styles.privacyText}>
                Nuotraukos ir jų vietos lieka tavo telefone.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.introFooter}>
          <Pressable
            accessibilityRole="button"
            onPress={startScan}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>Rodyti mano vietas</Text>
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
        <Text style={styles.scanTitle}>Ieškome tavo vietų</Text>
        <Text style={styles.scanText}>Patikrinta nuotraukų: {scanProgress.scanned}</Text>
        <View style={styles.foundPill}>
          <Text style={styles.foundPillText}>Su vieta: {scanProgress.found}</Text>
        </View>
        <Text style={styles.scanHint}>
          Jei biblioteka didelė, pirmas nuskaitymas gali šiek tiek užtrukti.
        </Text>
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
        onPress={() => setSelectedClusterKey(null)}
        onRegionChangeComplete={setRegion}
        showsCompass={false}
        showsUserLocation={false}
      >
        {clusters.map((cluster) => (
          <Marker
            key={cluster.key}
            coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
            onPress={(event) => {
              event.stopPropagation();
              setSelectedClusterKey(cluster.key);
            }}
          >
            <View
              style={[
                styles.marker,
                selectedClusterKey === cluster.key && styles.markerSelected,
              ]}
            >
              <Text style={styles.markerText}>{cluster.photos.length}</Text>
            </View>
            <View
              style={[
                styles.markerTip,
                selectedClusterKey === cluster.key && styles.markerTipSelected,
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
              {clusters.length} vietų • {filteredPhotos.length} nuotraukų
            </Text>
          </View>
          <View style={styles.topActions}>
            <Pressable
              accessibilityLabel="Eksportuoti į Google Maps"
              onPress={exportMap}
              style={({ pressed }) => [styles.roundButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.roundButtonText}>↑</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Nuskaityti iš naujo"
              onPress={startScan}
              style={({ pressed }) => [styles.roundButton, pressed && styles.buttonPressed]}
            >
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
                <Text style={styles.detailTitle}>{selectedCluster.photos.length} nuotraukų</Text>
                <Text style={styles.detailDate}>{formatClusterDate(selectedCluster.photos)}</Text>
              </View>
              <Pressable
                onPress={() =>
                  openInGoogleMaps(selectedCluster.latitude, selectedCluster.longitude)
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
              {selectedCluster.photos.slice(0, 20).map((photo) => (
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
            <Text style={styles.mapHintText}>Paspausk tašką ir pamatysi nuotraukas</Text>
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
  const times = photos.map((photo) => photo.creationTime).sort((a, b) => a - b);
  const first = new Date(times[0]);
  const last = new Date(times[times.length - 1]);
  const format = new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'short', day: 'numeric' });
  const firstText = format.format(first);
  const lastText = format.format(last);
  return firstText === lastText ? firstText : `${firstText} – ${lastText}`;
}

const styles = StyleSheet.create({
  introRoot: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  introContent: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  logoMark: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#176BFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
    transform: [{ rotate: '45deg' }],
    borderBottomRightRadius: 8,
    shadowColor: '#176BFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
  },
  logoHole: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  eyebrow: {
    color: '#176BFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 2.2,
    marginBottom: 10,
  },
  introTitle: {
    color: '#101827',
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -1.4,
  },
  introDescription: {
    color: '#5E6878',
    fontSize: 17,
    lineHeight: 25,
    marginTop: 18,
    maxWidth: 330,
  },
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
  privacyIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E7F8EE',
    marginRight: 12,
  },
  privacyIconText: {
    color: '#178447',
    fontWeight: '900',
    fontSize: 18,
  },
  privacyCopy: {
    flex: 1,
  },
  privacyTitle: {
    color: '#172033',
    fontWeight: '700',
    fontSize: 15,
  },
  privacyText: {
    color: '#6A7484',
    fontSize: 13,
    marginTop: 3,
  },
  introFooter: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 16 : 24,
  },
  primaryButton: {
    height: 58,
    borderRadius: 18,
    backgroundColor: '#176BFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#176BFF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 13,
  },
  secondaryButtonText: {
    color: '#176BFF',
    fontSize: 14,
    fontWeight: '600',
  },
  footerNote: {
    textAlign: 'center',
    color: '#9099A7',
    fontSize: 12,
    marginTop: 12,
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  scanRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#F4F7FB',
  },
  scanOrb: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#176BFF',
    shadowColor: '#176BFF',
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
  },
  scanTitle: {
    marginTop: 34,
    color: '#111827',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  scanText: {
    marginTop: 12,
    color: '#687386',
    fontSize: 16,
  },
  foundPill: {
    marginTop: 16,
    backgroundColor: '#E8F0FF',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  foundPillText: {
    color: '#176BFF',
    fontWeight: '700',
    fontSize: 14,
  },
  scanHint: {
    marginTop: 24,
    color: '#9099A7',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 300,
  },
  mapRoot: {
    flex: 1,
    backgroundColor: '#DDE5EE',
  },
  mapOverlay: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 6 : 14,
  },
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
  mapTitle: {
    color: '#101827',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  mapSubtitle: {
    color: '#6F7888',
    fontSize: 12,
    marginTop: 2,
  },
  topActions: {
    flexDirection: 'row',
    gap: 7,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF3FB',
  },
  roundButtonText: {
    color: '#176BFF',
    fontSize: 23,
    lineHeight: 26,
    fontWeight: '700',
  },
  yearBar: {
    gap: 8,
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 2,
  },
  yearChip: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    shadowColor: '#28374F',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.09,
    shadowRadius: 10,
  },
  yearChipActive: {
    backgroundColor: '#176BFF',
  },
  yearChipText: {
    color: '#4D596B',
    fontSize: 13,
    fontWeight: '700',
  },
  yearChipTextActive: {
    color: '#FFFFFF',
  },
  overlaySpacer: {
    flex: 1,
  },
  marker: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#176BFF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
  },
  markerSelected: {
    backgroundColor: '#111827',
    transform: [{ scale: 1.14 }],
  },
  markerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  markerTip: {
    width: 9,
    height: 9,
    backgroundColor: '#176BFF',
    transform: [{ rotate: '45deg' }],
    alignSelf: 'center',
    marginTop: -7,
  },
  markerTipSelected: {
    backgroundColor: '#111827',
  },
  mapHint: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 17,
    paddingVertical: 11,
    marginBottom: Platform.OS === 'ios' ? 6 : 14,
    backgroundColor: 'rgba(17,24,39,0.86)',
  },
  mapHintText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  detailCard: {
    borderRadius: 26,
    paddingTop: 9,
    paddingBottom: 16,
    marginBottom: Platform.OS === 'ios' ? 4 : 10,
    backgroundColor: 'rgba(255,255,255,0.97)',
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.19,
    shadowRadius: 24,
  },
  detailHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: '#D9DEE6',
    marginBottom: 10,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  detailTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  detailDate: {
    color: '#7A8493',
    fontSize: 12,
    marginTop: 3,
    maxWidth: 210,
  },
  googleButton: {
    backgroundColor: '#E8F0FF',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  googleButtonText: {
    color: '#176BFF',
    fontSize: 12,
    fontWeight: '700',
  },
  photoStrip: {
    gap: 8,
    paddingTop: 13,
    paddingHorizontal: 16,
  },
  thumbnail: {
    width: 82,
    height: 82,
    borderRadius: 14,
    backgroundColor: '#E8ECF2',
  },
});
