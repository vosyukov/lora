import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { OFFLINE_PACK_NAME, MAP_STYLE_URL } from '../constants/meshtastic';

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface UseOfflineMapResult {
  hasOfflinePack: boolean;
  isDownloading: boolean;
  offlineProgress: number | null;
  downloadOfflineRegion: (region: MapRegion) => Promise<void>;
  deleteOfflineRegion: () => Promise<void>;
  styleUrl: string;
}

export function useOfflineMap(): UseOfflineMapResult {
  const [hasOfflinePack, setHasOfflinePack] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState<number | null>(null);

  // Check for existing offline packs on mount
  useEffect(() => {
    const checkOfflinePacks = async () => {
      try {
        const packs = await MapLibreGL.offlineManager.getPacks();
        const hasPack = packs?.some(pack => pack.name === OFFLINE_PACK_NAME);
        setHasOfflinePack(!!hasPack);
      } catch {
        // Offline not available
      }
    };
    checkOfflinePacks();
  }, []);

  const downloadOfflineRegion = useCallback(async (region: MapRegion) => {
    if (isDownloading) return;

    setIsDownloading(true);
    setOfflineProgress(0);

    try {
      await MapLibreGL.offlineManager.createPack(
        {
          name: OFFLINE_PACK_NAME,
          styleURL: MAP_STYLE_URL,
          bounds: [
            [region.longitude - region.longitudeDelta, region.latitude - region.latitudeDelta],
            [region.longitude + region.longitudeDelta, region.latitude + region.latitudeDelta],
          ],
          minZoom: 10,
          maxZoom: 16,
        },
        (_pack, status) => {
          if (status.percentage) {
            setOfflineProgress(status.percentage);
          }
        },
        (_pack, err) => {
          if (err) {
            Alert.alert('Ошибка', 'Не удалось скачать карту');
          }
        }
      );

      setHasOfflinePack(true);
      setOfflineProgress(null);
      Alert.alert('Готово', 'Карта региона сохранена для офлайн использования');
    } catch {
      Alert.alert('Ошибка', 'Не удалось скачать карту');
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading]);

  const deleteOfflineRegion = useCallback(async () => {
    try {
      await MapLibreGL.offlineManager.deletePack(OFFLINE_PACK_NAME);
      setHasOfflinePack(false);
      Alert.alert('Готово', 'Офлайн карта удалена');
    } catch {
      // Ignore
    }
  }, []);

  return {
    hasOfflinePack,
    isDownloading,
    offlineProgress,
    downloadOfflineRegion,
    deleteOfflineRegion,
    styleUrl: MAP_STYLE_URL,
  };
}
