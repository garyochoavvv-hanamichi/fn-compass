package __PACKAGE__

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class ChorezaCaptureService : Service() {
  companion object {
    private const val CHANNEL_ID = "choreza_capture"
    private const val NOTIFICATION_ID = 7091
  }

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "CHOREZA NIGHT · Captura",
          NotificationManager.IMPORTANCE_LOW
        )
      )
    }

    val notification =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_ID)
          .setContentTitle("CHOREZA NIGHT")
          .setContentText("Compartiendo pantalla y audio interno")
          .setSmallIcon(android.R.drawable.presence_video_online)
          .setOngoing(true)
          .build()
      } else {
        Notification.Builder(this)
          .setContentTitle("CHOREZA NIGHT")
          .setContentText("Compartiendo pantalla y audio interno")
          .setSmallIcon(android.R.drawable.presence_video_online)
          .setOngoing(true)
          .build()
      }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
