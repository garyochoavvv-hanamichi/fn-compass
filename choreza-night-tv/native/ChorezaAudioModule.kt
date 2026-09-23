package __PACKAGE__

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

class ChorezaAudioModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val REQUEST_CAPTURE_AUDIO = 49120
    private const val SAMPLE_RATE = 48000
    private const val CHANNELS = 2
    private const val BYTES_PER_SAMPLE = 2
    private const val CHUNK_MS = 20
    private const val CHUNK_BYTES =
      SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * CHUNK_MS / 1000
  }

  private val recording = AtomicBoolean(false)
  private var mediaProjection: MediaProjection? = null
  private var audioRecord: AudioRecord? = null
  private var playbackTrack: AudioTrack? = null
  private var pendingPromise: Promise? = null
  private val captureExecutor = Executors.newSingleThreadExecutor()
  private val playbackExecutor = Executors.newSingleThreadExecutor()

  private val activityListener: ActivityEventListener =
    object : BaseActivityEventListener() {
      override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
      ) {
        if (requestCode != REQUEST_CAPTURE_AUDIO) return

        val promise = pendingPromise
        pendingPromise = null

        if (resultCode != Activity.RESULT_OK || data == null) {
          promise?.reject("E_AUDIO_CAPTURE_DENIED", "Permiso de audio interno cancelado.")
          return
        }

        try {
          val serviceIntent = Intent(reactContext, ChorezaCaptureService::class.java)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(serviceIntent)
          } else {
            reactContext.startService(serviceIntent)
          }

          val manager =
            reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
          mediaProjection = manager.getMediaProjection(resultCode, data)
          startAudioRecord()
          promise?.resolve(true)
        } catch (e: Exception) {
          promise?.reject("E_AUDIO_CAPTURE_START", e.message, e)
        }
      }
    }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = "ChorezaAudio"

  @ReactMethod
  fun startSystemAudioCapture(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject(
        "E_ANDROID_TOO_OLD",
        "El audio interno requiere Android 10 o superior."
      )
      return
    }

    if (
      reactContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject(
        "E_RECORD_AUDIO",
        "Debes permitir el micrófono/audio antes de capturar audio interno."
      )
      return
    }

    if (recording.get()) {
      promise.resolve(true)
      return
    }

    val activity = currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No hay una actividad visible para solicitar captura.")
      return
    }

    pendingPromise = promise
    val manager =
      reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    activity.startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE_AUDIO)
  }

  private fun startAudioRecord() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val projection = mediaProjection ?: error("MediaProjection no disponible")

    val captureConfig =
      android.media.AudioPlaybackCaptureConfiguration.Builder(projection)
        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
        .addMatchingUsage(AudioAttributes.USAGE_GAME)
        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
        .excludeUid(reactContext.applicationInfo.uid)
        .build()

    val format =
      AudioFormat.Builder()
        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setSampleRate(SAMPLE_RATE)
        .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
        .build()

    val minBuffer =
      AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_STEREO,
        AudioFormat.ENCODING_PCM_16BIT
      )
    val bufferSize = maxOf(minBuffer * 2, CHUNK_BYTES * 4)

    audioRecord =
      AudioRecord.Builder()
        .setAudioFormat(format)
        .setBufferSizeInBytes(bufferSize)
        .setAudioPlaybackCaptureConfig(captureConfig)
        .build()

    mediaProjection?.registerCallback(
      object : MediaProjection.Callback() {
        override fun onStop() {
          stopSystemAudioCaptureInternal()
          emitState("stopped", 0.0)
        }
      },
      null
    )

    recording.set(true)
    audioRecord?.startRecording()
    emitState("capturing", 0.0)

    captureExecutor.execute {
      val buffer = ByteArray(CHUNK_BYTES)
      var levelAccumulator = 0L
      var samplesMeasured = 0
      var lastLevelEmit = System.currentTimeMillis()

      while (recording.get()) {
        val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
        if (read <= 0) continue

        var i = 0
        while (i + 1 < read) {
          val lo = buffer[i].toInt() and 0xff
          val hi = buffer[i + 1].toInt()
          val sample = (hi shl 8) or lo
          levelAccumulator += abs(sample)
          samplesMeasured++
          i += 2
        }

        val encoded = Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP)
        reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("ChorezaSystemAudio", encoded)

        val now = System.currentTimeMillis()
        if (now - lastLevelEmit >= 1000L && samplesMeasured > 0) {
          val normalized = (levelAccumulator.toDouble() / samplesMeasured.toDouble()) / 32768.0
          emitState("capturing", normalized.coerceIn(0.0, 1.0))
          levelAccumulator = 0L
          samplesMeasured = 0
          lastLevelEmit = now
        }
      }
    }
  }

  private fun emitState(state: String, level: Double) {
    val payload = Arguments.createMap().apply {
      putString("state", state)
      putDouble("level", level)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("ChorezaSystemAudioState", payload)
  }

  @ReactMethod
  fun stopSystemAudioCapture() {
    stopSystemAudioCaptureInternal()
  }

  private fun stopSystemAudioCaptureInternal() {
    recording.set(false)
    try { audioRecord?.stop() } catch (_: Exception) {}
    try { audioRecord?.release() } catch (_: Exception) {}
    audioRecord = null
    try { mediaProjection?.stop() } catch (_: Exception) {}
    mediaProjection = null
    try {
      reactContext.stopService(Intent(reactContext, ChorezaCaptureService::class.java))
    } catch (_: Exception) {}
  }

  @ReactMethod
  fun playPcmBase64(base64: String) {
    playbackExecutor.execute {
      try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        ensurePlaybackTrack()
        playbackTrack?.write(bytes, 0, bytes.size, AudioTrack.WRITE_BLOCKING)
      } catch (_: Exception) {}
    }
  }

  private fun ensurePlaybackTrack() {
    val existing = playbackTrack
    if (existing != null && existing.state == AudioTrack.STATE_INITIALIZED) return

    val minBuffer =
      AudioTrack.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_OUT_STEREO,
        AudioFormat.ENCODING_PCM_16BIT
      )

    playbackTrack =
      AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
            .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_NONE)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
            .build()
        )
        .setBufferSizeInBytes(maxOf(minBuffer * 4, CHUNK_BYTES * 8))
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
        .apply { play() }
  }

  @ReactMethod
  fun stopPlayback() {
    playbackExecutor.execute {
      try { playbackTrack?.pause() } catch (_: Exception) {}
      try { playbackTrack?.flush() } catch (_: Exception) {}
      try { playbackTrack?.release() } catch (_: Exception) {}
      playbackTrack = null
    }
  }

  override fun invalidate() {
    stopSystemAudioCaptureInternal()
    stopPlayback()
    reactContext.removeActivityEventListener(activityListener)
    super.invalidate()
  }
}
