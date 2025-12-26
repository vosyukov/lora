import React, { useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { EmptyState } from '../common/EmptyState';
import { useOfflineMap } from '../../hooks';
import type { NodeInfo } from '../../types';
import type { GpsLocation } from '../../hooks';

interface MapTabProps {
  nodes: NodeInfo[];
  friendIds: Set<number>;
  myNodeNum: number | null;
  currentLocation: GpsLocation | null;
  getNodeName: (node: NodeInfo) => string;
}

export function MapTab({
  nodes,
  friendIds,
  myNodeNum,
  currentLocation,
  getNodeName,
}: MapTabProps) {
  const mapRef = useRef<MapLibreGL.MapViewRef>(null);
  const {
    hasOfflinePack,
    isDownloading,
    offlineProgress,
    downloadOfflineRegion,
    deleteOfflineRegion,
    styleUrl,
  } = useOfflineMap();

  // Filter nodes with valid positions
  const nodesWithPosition = useMemo(() => {
    return nodes.filter(node => {
      if (!node.position) return false;
      const pos = node.position as { latitudeI?: number; longitudeI?: number };
      return pos.latitudeI && pos.longitudeI && pos.latitudeI !== 0 && pos.longitudeI !== 0;
    });
  }, [nodes]);

  // Calculate map region
  const mapRegion = useMemo(() => {
    const positions: { lat: number; lon: number }[] = [];

    nodesWithPosition.forEach(node => {
      const pos = node.position as { latitudeI: number; longitudeI: number };
      positions.push({
        lat: pos.latitudeI / 1e7,
        lon: pos.longitudeI / 1e7,
      });
    });

    if (currentLocation) {
      positions.push({
        lat: currentLocation.latitude,
        lon: currentLocation.longitude,
      });
    }

    if (positions.length === 0) {
      return {
        latitude: 55.7558,
        longitude: 37.6173,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      };
    }

    if (positions.length === 1) {
      return {
        latitude: positions[0].lat,
        longitude: positions[0].lon,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }

    const lats = positions.map(p => p.lat);
    const lons = positions.map(p => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.01),
      longitudeDelta: Math.max((maxLon - minLon) * 1.5, 0.01),
    };
  }, [nodesWithPosition, currentLocation]);

  const hasAnyPosition = nodesWithPosition.length > 0 || currentLocation;

  if (!hasAnyPosition) {
    return (
      <EmptyState
        icon="🗺️"
        title="Нет данных о позициях"
        description="Включите GPS или дождитесь, когда друзья передадут свои координаты"
      />
    );
  }

  const friendsCount = nodesWithPosition.filter(
    n => friendIds.has(n.nodeNum) && n.nodeNum !== myNodeNum
  ).length;
  const othersCount = nodesWithPosition.filter(
    n => !friendIds.has(n.nodeNum) && n.nodeNum !== myNodeNum
  ).length;

  const handleOfflinePress = () => {
    if (hasOfflinePack) {
      deleteOfflineRegion();
    } else {
      downloadOfflineRegion(mapRegion);
    }
  };

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={styleUrl}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <MapLibreGL.Camera
          centerCoordinate={[mapRegion.longitude, mapRegion.latitude]}
          zoomLevel={12}
        />

        {/* Current user location */}
        {currentLocation && (
          <MapLibreGL.PointAnnotation
            id="user-location"
            coordinate={[currentLocation.longitude, currentLocation.latitude]}
            title="Вы"
          >
            <View style={styles.markerMe}>
              <View style={styles.markerMeInner} />
            </View>
          </MapLibreGL.PointAnnotation>
        )}

        {/* Friends and other nodes */}
        {nodesWithPosition.map(node => {
          const isMe = node.nodeNum === myNodeNum;
          if (isMe && currentLocation) return null;

          const pos = node.position as { latitudeI: number; longitudeI: number };
          const isFriend = friendIds.has(node.nodeNum);

          return (
            <MapLibreGL.PointAnnotation
              key={`node-${node.nodeNum}`}
              id={`node-${node.nodeNum}`}
              coordinate={[pos.longitudeI / 1e7, pos.latitudeI / 1e7]}
              title={getNodeName(node)}
            >
              <View
                style={[
                  styles.marker,
                  { backgroundColor: isMe ? '#2AABEE' : isFriend ? '#31B545' : '#8E8E93' },
                ]}
              />
            </MapLibreGL.PointAnnotation>
          );
        })}
      </MapLibreGL.MapView>

      {/* Offline download button */}
      <View style={styles.controls}>
        {isDownloading ? (
          <View style={styles.downloadProgress}>
            <ActivityIndicator size="small" color="#2AABEE" />
            <Text style={styles.downloadProgressText}>
              {offlineProgress !== null ? `${Math.round(offlineProgress)}%` : 'Загрузка...'}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.offlineButton}
            onPress={handleOfflinePress}
            activeOpacity={0.7}
          >
            <Text style={styles.offlineButtonIcon}>{hasOfflinePack ? '✓' : '↓'}</Text>
            <Text style={styles.offlineButtonText}>
              {hasOfflinePack ? 'Офлайн' : 'Скачать'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#2AABEE' }]} />
          <Text style={styles.legendText}>Вы</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#31B545' }]} />
          <Text style={styles.legendText}>Друзья ({friendsCount})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#8E8E93' }]} />
          <Text style={styles.legendText}>Другие ({othersCount})</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  markerMe: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(42, 171, 238, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerMeInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2AABEE',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  controls: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  offlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  offlineButtonIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  offlineButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000000',
  },
  downloadProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  downloadProgressText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2AABEE',
    marginLeft: 8,
  },
  legend: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: '#000000',
  },
});
