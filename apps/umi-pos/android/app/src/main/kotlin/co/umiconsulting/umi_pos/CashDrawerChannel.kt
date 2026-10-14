package co.umiconsulting.umi_pos

import android.app.Activity
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

/**
 * The terminal's own cash-drawer port.
 *
 * Backs the `co.umiconsulting.umi_pos/cash_drawer` MethodChannel that
 * `MethodChannelTerminalCashbox` (Dart) calls. An iMin D3/D1/D2/D4 counter till
 * carries the drawer on an RJ11 socket on the terminal itself, and that pulse is
 * not an ESC/POS byte stream: it is a write to the board's cashbox GPIO. There is
 * no USB interface to claim and no socket to open, which is why this is a
 * platform channel rather than a link in `usb_printer_transport.dart`.
 *
 * The mechanism is the vendor's own, read out of the SDK that drove the drawer on
 * this very terminal before Umi (`IminLibs.jar` v2.0.88, `com.imin.library.a`):
 *
 *  - Android 13 and newer: `openCashBox()` on the `iminservice` system service,
 *    reflected out of `android.app.iMinServiceManager`.
 *  - Below that: `echo <value> > /sys/class/neostra_gpioctl/dev/gpioctl`, where
 *    `<value>` is `persist.sys.CASHBOX_ENABLE` when it is set and `1` otherwise.
 *    The vendor ships three shapes of that node; which one exists is a property
 *    of the board, so the node is discovered rather than configured.
 *
 * Two things are worth writing down because they cost time to learn:
 *
 *  - **No root and no vendor jar is needed.** On the pilot D3-504 the node is mode
 *    `0666` and an app-domain process can write it (measured 2026-10-14:
 *    `run-as co.umiconsulting.umi_pos.estacion sh -c 'echo 1 > /sys/class/neostra_gpioctl/dev/gpioctl'`
 *    returned 0). `/dev/imin/cashbox_ctl` is that same node under a friendlier
 *    name, and `/dev/imin/cashbox_det` is its drawer-detect pin.
 *  - **The value is the vendor's setting, not a constant.** A drawer wired for
 *    24 V and a terminal set to 12 V does not open, and the terminal says nothing
 *    when it does not. What is reported here is the board's own value.
 *
 * The pulse leaves no acknowledgement: the operator looking at the drawer is the
 * only proof that it opened, which is why the result this channel returns is "the
 * write was accepted", never "the drawer opened".
 */
class CashDrawerChannel(
  private val activity: Activity,
  channel: MethodChannel,
) {
  private val worker = Executors.newSingleThreadExecutor()

  init {
    channel.setMethodCallHandler { call, result ->
      when (call.method) {
        "available" -> run(result) { port() }
        "pulse" -> run(result) { pulse() }
        else -> result.notImplemented()
      }
    }
  }

  private fun run(result: MethodChannel.Result, block: () -> Any?) {
    worker.execute {
      try {
        val value = block()
        activity.runOnUiThread { result.success(value) }
      } catch (absent: NoCashboxPort) {
        activity.runOnUiThread { result.error("CASHBOX_ABSENT", absent.message, null) }
      } catch (error: Exception) {
        activity.runOnUiThread { result.error("CASHBOX_FAILED", error.message, null) }
      }
    }
  }

  /** Whether the port is there and this app can reach it, without pulsing it. */
  private fun port(): Map<String, Any?>? {
    if (service() != null) return mapOf("path" to "service", "node" to SERVICE_NAME)
    val node = nodePath() ?: return null
    return mapOf(
      "path" to "sysfs",
      "node" to node,
      "sensorReading" to sensorReading(),
    )
  }

  /** One pulse, and nothing else. */
  private fun pulse(): Map<String, Any?> {
    if (service() != null) {
      openCashBoxThroughService()
      return mapOf("path" to "service", "node" to SERVICE_NAME)
    }
    val node = nodePath() ?: throw NoCashboxPort("this terminal has no cash drawer port")
    val value = pulseValue()
    FileOutputStream(File(node)).use { stream ->
      stream.write(value.toByteArray())
      stream.flush()
    }
    return mapOf(
      "path" to "sysfs",
      "node" to node,
      "value" to value,
      "sensorReading" to sensorReading(),
    )
  }

  private fun service(): Any? =
    runCatching { activity.getSystemService(SERVICE_NAME) }.getOrNull()

  private fun openCashBoxThroughService() {
    val service = service() ?: throw NoCashboxPort("this terminal has no cash drawer port")
    val method = Class.forName("android.app.iMinServiceManager").getMethod("openCashBox")
    method.invoke(service)
  }

  private fun nodePath(): String? =
    CASHBOX_NODES.firstOrNull { File(it).exists() && File(it).canWrite() }

  /**
   * The value the vendor's own SDK would write: the configured one when the board
   * has it, `1` otherwise. Read reflectively because the property is a hidden API;
   * when the platform refuses the read, the SDK's own fallback is what this
   * returns.
   */
  private fun pulseValue(): String {
    val configured = runCatching {
      val properties = Class.forName("android.os.SystemProperties")
      val get = properties.getMethod("get", String::class.java)
      (get.invoke(null, CASHBOX_VALUE_PROPERTY) as? String)?.trim()
    }.getOrNull()
    return if (configured.isNullOrEmpty()) DEFAULT_PULSE_VALUE else configured
  }

  /**
   * The drawer-detect pin, as the vendor's SDK reads it. Its polarity is not
   * documented, so this is reported next to the pulse rather than interpreted: the
   * reading with the drawer attached and the reading without it are what turn it
   * into a fact.
   */
  private fun sensorReading(): Int? = runCatching {
    File(SENSOR_NODE).readText().trim().toInt()
  }.getOrNull()

  private class NoCashboxPort(message: String) : Exception(message)

  companion object {
    const val CHANNEL = "co.umiconsulting.umi_pos/cash_drawer"
    private const val SERVICE_NAME = "iminservice"
    private const val CASHBOX_VALUE_PROPERTY = "persist.sys.CASHBOX_ENABLE"
    private const val DEFAULT_PULSE_VALUE = "1"
    private const val SENSOR_NODE = "/sys/class/neostra_gpioctl/dev/gpioctl_sns"

    /** The three shapes the vendor's boards use, in the SDK's own order. */
    private val CASHBOX_NODES = listOf(
      "/sys/class/neostra_gpioctl/dev/gpioctl",
      "/sys/extcon-usb-gpio/cashbox_en",
      "/sys/devices/platform/112b1000.usb/cashbox_en",
    )
  }
}
