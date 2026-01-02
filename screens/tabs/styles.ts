import { StyleSheet, Platform, StatusBar } from 'react-native';

// Shared colors
export const COLORS = {
  primary: '#2AABEE',
  primaryDark: '#229ED9',
  secondary: '#5856D6',
  success: '#31B545',
  warning: '#FF9500',
  error: '#FF3B30',
  text: '#000000',
  textSecondary: '#8E8E93',
  textHint: '#999999',
  background: '#F4F4F5',
  cardBackground: '#FFFFFF',
  border: '#E5E5EA',
  white: '#FFFFFF',
};

// Shared styles used across multiple tabs
export const sharedStyles = StyleSheet.create({
  // Section styles
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 16,
  },

  // Node styles
  nodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBackground,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  nodeAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  friendAvatar: {
    backgroundColor: COLORS.primary,
  },
  channelAvatar: {
    backgroundColor: COLORS.secondary,
  },
  nodeAvatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
  },
  nodeInfo: {
    flex: 1,
  },
  nodeName: {
    fontSize: 17,
    color: COLORS.text,
    marginBottom: 2,
  },
  nodeDetail: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  // Status card styles
  nodeStatusCard: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 12,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  nodeStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  nodeStatusLabel: {
    fontSize: 16,
    color: COLORS.text,
  },
  nodeStatusValue: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Buttons
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },

  // Badges
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },

  // List
  nodesList: {
    flex: 1,
  },
  bottomPadding: {
    height: 100,
  },
});

// Chat-specific styles
export const chatStyles = StyleSheet.create({
  chatListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBackground,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  chatListInfo: {
    flex: 1,
  },
  chatListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatListName: {
    fontSize: 17,
    fontWeight: '500',
    color: COLORS.text,
  },
  chatListNameUnread: {
    fontWeight: '600',
  },
  chatListTime: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  chatListPreview: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  chatListPreviewUnread: {
    color: COLORS.text,
    fontWeight: '500',
  },

  // Chat container
  chatContainer: {
    flex: 1,
    backgroundColor: COLORS.cardBackground,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : (StatusBar.currentHeight || 24) + 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.cardBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  chatBackButton: {
    width: 30,
    marginRight: 8,
  },
  chatHeaderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  chatHeaderAvatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  chatHeaderStatus: {
    fontSize: 13,
    color: COLORS.success,
  },
  encryptedStatus: {
    color: COLORS.secondary,
  },

  // Messages
  messagesContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  messagesContent: {
    padding: 16,
  },
  emptyChatState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyChatText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  channelSenderName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.secondary,
    marginBottom: 4,
    marginTop: 8,
  },

  // Message bubbles
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    marginBottom: 8,
  },
  incomingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.cardBackground,
    borderBottomLeftRadius: 4,
  },
  outgoingBubble: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  incomingText: {
    color: COLORS.text,
  },
  outgoingText: {
    color: COLORS.white,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  messageTime: {
    fontSize: 11,
  },
  incomingTime: {
    color: COLORS.textSecondary,
  },
  outgoingTime: {
    color: 'rgba(255,255,255,0.7)',
  },
  statusIcon: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginLeft: 2,
    fontWeight: '600',
  },
  statusFailed: {
    color: '#FF6B6B',
    fontWeight: '700',
  },
  statusPending: {
    color: 'rgba(255,255,255,0.4)',
  },
  statusDelivered: {
    color: '#4CD964',
  },
  // Dual status display (📡 + 🌐)
  dualStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
    gap: 6,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 9,
    marginRight: 1,
  },

  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    backgroundColor: COLORS.cardBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    marginBottom: 3,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 5,
  },
  sendButtonDisabled: {
    backgroundColor: '#D1D1D6',
    shadowColor: '#000',
    shadowOpacity: 0,
    elevation: 0,
  },
  sendButtonText: {
    fontSize: 17,
    color: COLORS.white,
    fontWeight: '700',
  },
  locationButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  locationButtonText: {
    fontSize: 20,
  },

  // Location message
  locationBubble: {
    minWidth: 200,
  },
  locationContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  locationIcon: {
    fontSize: 28,
    marginRight: 10,
  },
  locationInfo: {
    flex: 1,
  },
  locationTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  locationCoords: {
    fontSize: 13,
    marginBottom: 4,
  },
  incomingCoords: {
    color: '#666666',
  },
  outgoingCoords: {
    color: 'rgba(255,255,255,0.85)',
  },
  locationHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },

  // Groups
  groupButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  createGroupButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  createGroupButtonText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  emptyGroupsHint: {
    backgroundColor: COLORS.cardBackground,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  emptyGroupsText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  // Section hint
  sectionHint: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sectionHintText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  // Add button
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 24,
    color: COLORS.white,
    fontWeight: '300',
    marginTop: -2,
  },

  // Share button
  shareButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.secondary,
    borderRadius: 14,
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },

  // Lock icon
  lockIcon: {
    fontSize: 16,
    marginLeft: 8,
  },

  // Back button
  backButtonText: {
    fontSize: 17,
    color: COLORS.primary,
  },
});

// Map-specific styles
export const mapStyles = StyleSheet.create({
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  mapLegend: {
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
    color: COLORS.text,
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: COLORS.white,
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
    backgroundColor: COLORS.primary,
    borderWidth: 3,
    borderColor: COLORS.white,
  },
  sharedLocationMarker: {
    alignItems: 'center',
  },
  sharedLocationIcon: {
    fontSize: 36,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  sharedLocationLabel: {
    backgroundColor: 'rgba(42, 171, 238, 0.95)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: -4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
    maxWidth: 120,
  },
  sharedLocationName: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  mapControls: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  centerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  centerButtonIcon: {
    fontSize: 22,
    color: COLORS.primary,
  },
  friendsButtonIcon: {
    fontSize: 18,
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
    color: COLORS.text,
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
    color: COLORS.primary,
    marginLeft: 8,
  },
});

// Settings-specific styles
export const settingsStyles = StyleSheet.create({
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  phoneInput: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: COLORS.text,
    minWidth: 140,
    textAlign: 'right',
  },
  phoneSaveButton: {
    marginLeft: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  phoneSaveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  phoneEmpty: {
    color: COLORS.primary,
  },
  editableField: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editIcon: {
    marginLeft: 6,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  connectionStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  settingsButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  settingsButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
