import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { geotagProblem, type Geotag } from '@voltneo/shared';

export type GeoState =
  | { status: 'locating' }
  | { status: 'ok'; geo: Geotag }
  | { status: 'denied' }
  | { status: 'off' }
  | { status: 'rough'; geo: Geotag }
  | { status: 'error' };

/**
 * The phone's location, for registration and installation records (founder,
 * 1 Nov 2026). Saving is blocked until a usable fix is found.
 */
export function useGeotag() {
  const [state, setState] = useState<GeoState>({ status: 'locating' });

  const locate = useCallback(async () => {
    setState({ status: 'locating' });
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setState({ status: 'denied' });
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setState({ status: 'off' });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const geo: Geotag = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy ?? 9999,
      };
      setState(geotagProblem(geo) ? { status: 'rough', geo } : { status: 'ok', geo });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void locate();
  }, [locate]);

  return { state, geo: state.status === 'ok' ? state.geo : null, retry: locate };
}
