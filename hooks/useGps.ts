import { useState, useRef, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { meshtasticService } from '../services/MeshtasticService';
import { GPS_INTERVAL_MS } from '../constants/meshtastic';

export interface GpsLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface UseGpsResult {
  currentLocation: GpsLocation | null;
  lastGpsSent: number | null;
}

export function useGps(isConnected: boolean): UseGpsResult {
  const [currentLocation, setCurrentLocation] = useState<GpsLocation | null>(null);
  const [lastGpsSent, setLastGpsSent] = useState<number | null>(null);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current);
      }
    };
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

  // Auto-start GPS when connected
  useEffect(() => {
    if (isConnected && !gpsIntervalRef.current) {
      (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          sendCurrentPosition();
          gpsIntervalRef.current = setInterval(sendCurrentPosition, GPS_INTERVAL_MS);
        }
      })();
    }

    // Stop when disconnected
    if (!isConnected && gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
  }, [isConnected, sendCurrentPosition]);

  return {
    currentLocation,
    lastGpsSent,
  };
}
