package expo.modules.arsessionguard

import android.content.Context
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.Locale
import kotlin.concurrent.thread

private const val TAG = "ArSessionGuard"

/**
 * Guards around Viro's AR engine that Viro itself does not offer (Track A, ticket 04 of
 * .scratch/measure-with-ar-reliability):
 * - awaitBackCameraAvailable: lets the AR engine open the camera after expo-camera has
 *   released it, instead of CameraService evicting expo-camera's client (ticket 03).
 * - startLogWatch: Viro discards ARCore's session statuses and reports its startup
 *   failures only to logcat, so the app's own log is the one place a failure reason
 *   exists. Matching lines are forwarded to JS, which owns the signatures.
 */
class ArSessionGuardModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  @Volatile
  private var logcat: Process? = null

  override fun definition() = ModuleDefinition {
    Name("ArSessionGuard")
    Events("onArLog")

    Constant("packageName") { appContext.reactContext?.packageName }

    // Resolves once no client holds the primary back camera (the one ARCore opens), or
    // when timeoutMs elapses first. Never rejects: a timeout still lets AR start.
    AsyncFunction("awaitBackCameraAvailable") { timeoutMs: Int, promise: Promise ->
      val manager =
        appContext.reactContext?.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
      val cameraId = manager?.let { primaryBackCamera(it) }
      if (manager == null || cameraId == null) {
        promise.resolve(mapOf("available" to false, "waitedMs" to 0, "cameraId" to null))
        return@AsyncFunction
      }
      val started = SystemClock.elapsedRealtime()
      // Registration, both callbacks and the timeout all run on the main looper, so
      // `settled` needs no locking.
      var settled = false
      lateinit var callback: CameraManager.AvailabilityCallback
      fun settle(available: Boolean) {
        if (settled) return
        settled = true
        manager.unregisterAvailabilityCallback(callback)
        promise.resolve(
          mapOf(
            "available" to available,
            "waitedMs" to (SystemClock.elapsedRealtime() - started).toInt(),
            "cameraId" to cameraId,
          ),
        )
      }
      callback = object : CameraManager.AvailabilityCallback() {
        // Also delivered right after registration when the camera is already free.
        override fun onCameraAvailable(id: String) {
          if (id == cameraId) settle(true)
        }
      }
      mainHandler.post {
        manager.registerAvailabilityCallback(callback, mainHandler)
        mainHandler.postDelayed({ settle(false) }, timeoutMs.toLong())
      }
    }

    Function("startLogWatch") { filter: String -> startLogWatch(Regex(filter)) }

    Function("stopLogWatch") { stopLogWatch() }

    OnDestroy { stopLogWatch() }
  }

  private fun primaryBackCamera(manager: CameraManager): String? =
    try {
      manager.cameraIdList.firstOrNull {
        manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) ==
          CameraCharacteristics.LENS_FACING_BACK
      }
    } catch (e: CameraAccessException) {
      Log.w(TAG, "Camera list unavailable", e)
      null
    }

  // Reads this process's log from now on (an app may read its own log without
  // READ_LOGS). ReactNativeJS is silenced so a console line can never feed back.
  private fun startLogWatch(filter: Regex) {
    stopLogWatch()
    val since = String.format(Locale.US, "%.3f", System.currentTimeMillis() / 1000.0)
    val process =
      try {
        ProcessBuilder(
          "logcat",
          "--pid=${android.os.Process.myPid()}",
          "-T",
          since,
          "-v",
          "brief",
          "ReactNativeJS:S",
          "*:V",
        )
          .redirectErrorStream(true)
          .start()
      } catch (e: IOException) {
        Log.w(TAG, "logcat could not start", e)
        return
      }
    logcat = process
    thread(name = "ArSessionGuard-logcat", isDaemon = true) {
      try {
        process.inputStream.bufferedReader().forEachLine { line ->
          if (filter.containsMatchIn(line)) sendEvent("onArLog", mapOf("line" to line))
        }
      } catch (e: IOException) {
        // stopLogWatch() destroyed the process.
      }
    }
  }

  private fun stopLogWatch() {
    logcat?.destroy()
    logcat = null
  }
}
