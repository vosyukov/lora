import * as Notifications from 'expo-notifications';
import { Platform, AppState, AppStateStatus } from 'react-native';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false, // Don't show when app is active
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

class NotificationService {
  private isAppActive: boolean = true;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

  async initialize(): Promise<boolean> {
    // Request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return false;
    }

    // Configure notification channel for Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Сообщения',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2AABEE',
        sound: 'default',
      });
    }

    // Track app state
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    this.isAppActive = AppState.currentState === 'active';

    return true;
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    this.isAppActive = nextAppState === 'active';
  };

  async showMessageNotification(
    senderName: string,
    messageText: string,
    isChannel: boolean = false,
    channelName?: string
  ): Promise<void> {
    // Only show notification when app is in background
    if (this.isAppActive) {
      return;
    }

    const title = isChannel ? `#${channelName}` : senderName;
    const body = isChannel ? `${senderName}: ${messageText}` : messageText;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: body.length > 100 ? body.substring(0, 100) + '...' : body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null, // Show immediately
    });
  }

  cleanup(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }
}

export const notificationService = new NotificationService();
