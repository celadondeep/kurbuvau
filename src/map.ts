export function getGridSize(longitudeDelta: number) {
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
