import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { meshtasticService } from '../services/MeshtasticService';
import { GPS_ENABLED_KEY, GPS_INTERVAL_MS } from '../constants/meshtastic';

export interface GpsLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface UseGpsResult {
  gpsEnabled: boolean;
  currentLocation: GpsLocation | null;
  lastGpsSent: number | null;
  toggleGps: () => void;
  startGpsTracking: () => Promise<void>;
  stopGpsTracking: () => void;
}

export function useGps(isConnected: boolean): UseGpsResult {
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsPermissionGranted, setGpsPermissionGranted] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<GpsLocation | null>(null);
  const [lastGpsSent, setLastGpsSent] = useState<number | null>(null);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load saved GPS settings (default to enabled)
  useEffect(() => {
    const loadGpsSettings = async () => {
      try {
        const stored = await AsyncStorage.getItem(GPS_ENABLED_KEY);
        // Default to true if not set
        const shouldEnable = stored !== 'false';
        if (shouldEnable) {
          setGpsEnabled(true);
          const { status } = await Location.getForegroundPermissionsAsync();
          setGpsPermissionGranted(status === 'granted');
        }
      } catch {
        // Default to enabled on error
        setGpsEnabled(true);
      }
    };
    loadGpsSettings();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current);
      }
    };
  }, []);

  const requestGpsPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === 'granted';
      setGpsPermissionGranted(granted);
      return granted;
    } catch {
      return false;
    }
  }, []);

  const sendCurrentPosition = useCallback(async () => {
    if (!isConnected) return;

    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const newLocation: GpsLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        altitude: location.coords.altitude ?? undefined,
      };

      setCurrentLocation(newLocation);

      const success = await meshtasticService.sendPosition(
        newLocation.latitude,
        newLocation.longitude,
        newLocation.altitude
      );

      if (success) {
        setLastGpsSent(Date.now());
      }
    } catch {
      // Failed to get/send position
    }
  }, [isConnected]);

  // Auto-start GPS when connected and enabled
  useEffect(() => {
    if (isConnected && gpsEnabled && !gpsIntervalRef.current) {
      // Request permission and start tracking
      (async () => {
        let hasPermission = gpsPermissionGranted;
        if (!hasPermission) {
          const { status } = await Location.requestForegroundPermissionsAsync();
          hasPermission = status === 'granted';
          setGpsPermissionGranted(hasPermission);
        }

        if (hasPermission) {
          sendCurrentPosition();
          gpsIntervalRef.current = setInterval(sendCurrentPosition, GPS_INTERVAL_MS);
        }
      })();
    }
  }, [isConnected, gpsEnabled, gpsPermissionGranted, sendCurrentPosition]);

  const startGpsTracking = useCallback(async () => {
    let hasPermission = gpsPermissionGranted;
    if (!hasPermission) {
      hasPermission = await requestGpsPermission();
    }

    if (!hasPermission) {
      Alert.alert(
        'Доступ к GPS',
        'Для передачи позиции друзьям нужен доступ к геолокации.',
        [{ text: 'OK' }]
      );
      return;
    }

    setGpsEnabled(true);
    await AsyncStorage.setItem(GPS_ENABLED_KEY, 'true');

    // Send position immediately
    sendCurrentPosition();

    // Start periodic updates
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
    }
    gpsIntervalRef.current = setInterval(sendCurrentPosition, GPS_INTERVAL_MS);
  }, [gpsPermissionGranted, requestGpsPermission, sendCurrentPosition]);

  const stopGpsTracking = useCallback(() => {
    setGpsEnabled(false);
    AsyncStorage.setItem(GPS_ENABLED_KEY, 'false');

    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
  }, []);

  const toggleGps = useCallback(() => {
    if (gpsEnabled) {
      stopGpsTracking();
    } else {
      startGpsTracking();
    }
  }, [gpsEnabled, startGpsTracking, stopGpsTracking]);

  return {
    gpsEnabled,
    currentLocation,
    lastGpsSent,
    toggleGps,
    startGpsTracking,
    stopGpsTracking,
  };
}
