import React, { useRef, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';

import type { NodeInfo } from '../../types';
import { MAP_STYLE_URL } from '../../constants/meshtastic';
import { sharedStyles, mapStyles, COLORS } from './styles';
import type { MapTabProps } from './types';

export default function MapTab({
  myNodeNum,
  nodes,
  friendIds,
  getNodeName,
  currentLocation,
  hasOfflinePack,
  isDownloading,
  offlineProgress,
  downloadOfflineRegion,
  targetMapLocation,
  setTargetMapLocation,
}: MapTabProps) {
  const mapRef = useRef<MapLibreGL.MapViewRef>(null);
  const cameraRef = useRef<MapLibreGL.CameraRef>(null);
  const [mapCameraSet, setMapCameraSet] = useState(false);

  // Get nodes with valid positions
  const nodesWithPosition = useMemo(() => {
    return nodes.filter(node => {
      if (!node.position) return false;
      const pos = node.position as { latitudeI?: number; longitudeI?: number };
      return pos.latitudeI && pos.longitudeI && pos.latitudeI !== 0 && pos.longitudeI !== 0;
    });
  }, [nodes]);

  // Calculate map region
  const getMapRegion = () => {
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

    const latDelta = Math.max((maxLat - minLat) * 1.5, 0.01);
    const lonDelta = Math.max((maxLon - minLon) * 1.5, 0.01);

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lonDelta,
    };
  };

  // Navigate to target location
  useEffect(() => {
    if (targetMapLocation && cameraRef.current) {
      const timer = setTimeout(() => {
        cameraRef.current?.setCamera({
          centerCoordinate: [targetMapLocation.longitude, targetMapLocation.latitude],
          zoomLevel: 15,
          animationDuration: 500,
          animationMode: 'flyTo',
        });
        setTargetMapLocation(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [targetMapLocation]);

  const handleDownloadOffline = () => {
    const region = getMapRegion();
    downloadOfflineRegion(region);
  };

  const handleCenterOnMe = () => {
    if (currentLocation && cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [currentLocation.longitude, currentLocation.latitude],
        zoomLevel: 14,
        animationDuration: 500,
        animationMode: 'flyTo',
      });
    }
  };

  const handleShowAllFriends = () => {
    if (!cameraRef.current) return;

    const positions: [number, number][] = [];

    if (currentLocation) {
      positions.push([currentLocation.longitude, currentLocation.latitude]);
    }

    nodesWithPosition.forEach(node => {
      if (friendIds.has(node.nodeNum) && node.nodeNum !== myNodeNum) {
        const pos = node.position as { latitudeI: number; longitudeI: number };
        positions.push([pos.longitudeI / 1e7, pos.latitudeI / 1e7]);
      }
    });

    if (positions.length === 0) return;

    if (positions.length === 1) {
      cameraRef.current.setCamera({
        centerCoordinate: positions[0],
        zoomLevel: 14,
        animationDuration: 500,
        animationMode: 'flyTo',
      });
      return;
    }

    const lngs = positions.map(p => p[0]);
    const lats = positions.map(p => p[1]);
    const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
    const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];

    cameraRef.current.fitBounds(ne, sw, 50, 500);
  };

  const hasAnyPosition = nodesWithPosition.length > 0 || currentLocation;

  if (!hasAnyPosition) {
    return (
      <View style={sharedStyles.emptyState}>
        <Text style={sharedStyles.emptyIcon}></Text>
        <Text style={sharedStyles.emptyTitle}>No position data</Text>
        <Text style={sharedStyles.emptyText}>
          Enable GPS or wait for friends to share their coordinates
        </Text>
      </View>
    );
  }

  const region = getMapRegion();
  const friendsCount = nodesWithPosition.filter(n => friendIds.has(n.nodeNum) && n.nodeNum !== myNodeNum).length;
  const othersCount = nodesWithPosition.filter(n => !friendIds.has(n.nodeNum) && n.nodeNum !== myNodeNum).length;

  return (
    <View style={mapStyles.mapContainer}>
      <MapLibreGL.MapView
        ref={mapRef}
        style={mapStyles.map}
        mapStyle={MAP_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={false}
        onDidFinishLoadingMap={() => setMapCameraSet(true)}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          centerCoordinate={!mapCameraSet ? [region.longitude, region.latitude] : undefined}
          zoomLevel={!mapCameraSet ? 12 : undefined}
          animationMode="moveTo"
          animationDuration={0}
        />

        {/* Current user location */}
        {currentLocation && (
          <MapLibreGL.PointAnnotation
            id="user-location"
            coordinate={[currentLocation.longitude, currentLocation.latitude]}
            title="You"
          >
            <View style={mapStyles.markerMe}>
              <View style={mapStyles.markerMeInner} />
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
              <View style={[
                mapStyles.marker,
                { backgroundColor: isMe ? COLORS.primary : (isFriend ? COLORS.success : COLORS.textSecondary) }
              ]} />
            </MapLibreGL.PointAnnotation>
          );
        })}

        {/* Shared location marker */}
        {targetMapLocation && (
          <MapLibreGL.PointAnnotation
            id="shared-location"
            coordinate={[targetMapLocation.longitude, targetMapLocation.latitude]}
            title={targetMapLocation.senderName || 'Location'}
          >
            <View style={mapStyles.sharedLocationMarker}>
              <Text style={mapStyles.sharedLocationIcon}></Text>
              {targetMapLocation.senderName && (
                <View style={mapStyles.sharedLocationLabel}>
                  <Text style={mapStyles.sharedLocationName} numberOfLines={1}>
                    {targetMapLocation.senderName}
                  </Text>
                </View>
              )}
            </View>
          </MapLibreGL.PointAnnotation>
        )}
      </MapLibreGL.MapView>

      {/* Map controls */}
      <View style={mapStyles.mapControls}>
        {currentLocation && (
          <TouchableOpacity
            style={mapStyles.centerButton}
            onPress={handleCenterOnMe}
            activeOpacity={0.7}
          >
            <Text style={mapStyles.centerButtonIcon}></Text>
          </TouchableOpacity>
        )}

        {friendsCount > 0 && (
          <TouchableOpacity
            style={mapStyles.centerButton}
            onPress={handleShowAllFriends}
            activeOpacity={0.7}
          >
            <Text style={mapStyles.friendsButtonIcon}></Text>
          </TouchableOpacity>
        )}

        {isDownloading ? (
          <View style={mapStyles.downloadProgress}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={mapStyles.downloadProgressText}>
              {offlineProgress ? `${Math.round(offlineProgress)}%` : 'Loading...'}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={mapStyles.offlineButton}
            onPress={handleDownloadOffline}
            activeOpacity={0.7}
          >
            <Text style={mapStyles.offlineButtonIcon}>{hasOfflinePack ? '' : ''}</Text>
            <Text style={mapStyles.offlineButtonText}>
              {hasOfflinePack ? 'Saved' : 'Offline'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Legend */}
      <View style={mapStyles.mapLegend}>
        <View style={mapStyles.legendItem}>
          <View style={[mapStyles.legendDot, { backgroundColor: COLORS.primary }]} />
          <Text style={mapStyles.legendText}>You</Text>
        </View>
        {friendsCount > 0 && (
          <View style={mapStyles.legendItem}>
            <View style={[mapStyles.legendDot, { backgroundColor: COLORS.success }]} />
            <Text style={mapStyles.legendText}>Friends ({friendsCount})</Text>
          </View>
        )}
        {othersCount > 0 && (
          <View style={mapStyles.legendItem}>
            <View style={[mapStyles.legendDot, { backgroundColor: COLORS.textSecondary }]} />
            <Text style={mapStyles.legendText}>Others ({othersCount})</Text>
          </View>
        )}
      </View>
    </View>
  );
}
