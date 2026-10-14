package co.umiconsulting.umi_pos

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The terminal's USB host port, for the receipt printer.
 *
 * Backs the `co.umiconsulting.umi_pos/usb_printer` MethodChannel that
 * `MethodChannelUsbPrinter` (Dart) calls. Android hands USB endpoints to an
 * *app* and to nobody else — the device nodes are root-only and a `user` build
 * has no `su` — so the till prints through here.
 *
 * Two things make this small rather than clever:
 *  - The printer is DISCOVERED, not configured: Epson's vendor id first, then
 *    any printer-class device. A till has one receipt printer.
 *  - Permission is Android's, asked once, on the first open. It shows the
 *    system prompt, which is why the result is posted from a worker thread but
 *    the request runs on the UI thread.
 *
 * Contract, matching `usb_printer_transport.dart`:
 *  - `attached` -> [{deviceId, vendorId, productId, productName}]
 *  - `open`     -> claims the printer-class interface and finds both endpoints
 *  - `write`    -> {bytes: byte[]} to the bulk OUT endpoint
 *  - `status`   -> `DLE EOT 1`, one byte back
 *  - `close`    -> releases the interface
 */
class UsbPrinterChannel(
  private val activity: Activity,
  channel: MethodChannel,
) {
  private val usbManager =
    activity.getSystemService(Context.USB_SERVICE) as UsbManager
  private val worker = Executors.newSingleThreadExecutor()
  private var device: UsbDevice? = null
  private var connection: UsbDeviceConnection? = null
  private var printerInterface: UsbInterface? = null
  private var outEndpoint: UsbEndpoint? = null
  private var inEndpoint: UsbEndpoint? = null

  init {
    channel.setMethodCallHandler { call, result ->
      when (call.method) {
        "attached" -> run(call, result) { attached() }
        "open" -> run(call, result) { open(); null }
        "write" -> {
          val bytes = call.argument<ByteArray>("bytes")
            ?: throw IllegalArgumentException("missing 'bytes'")
          run(call, result) { write(bytes); null }
        }
        "status" -> run(call, result) { status() }
        "close" -> run(call, result) { close(); null }
        else -> result.notImplemented()
      }
    }
  }

  private fun run(
    call: MethodCall,
    result: MethodChannel.Result,
    block: () -> Any?,
  ) {
    worker.execute {
      try {
        val value = block()
        activity.runOnUiThread { result.success(value) }
      } catch (error: Exception) {
        activity.runOnUiThread { result.error("USB_PRINTER_FAILED", error.message, null) }
      }
    }
  }

  private fun attached(): List<Map<String, Any?>> {
    val devices = mutableListOf<Map<String, Any?>>()
    for (candidate in usbManager.deviceList.values) {
      if (candidate.interfaceCount == 0) continue
      var isPrinter = false
      for (index in 0 until candidate.interfaceCount) {
        if (candidate.getInterface(index).interfaceClass == UsbConstants.USB_CLASS_PRINTER) {
          isPrinter = true
        }
      }
      if (!isPrinter && candidate.vendorId != EPSON_VENDOR_ID) continue
      devices.add(
        mapOf(
          "deviceId" to candidate.deviceName,
          "vendorId" to candidate.vendorId,
          "productId" to candidate.productId,
          "productName" to candidate.productName,
        ),
      )
    }
    return devices
  }

  private fun findPrinter(): UsbDevice {
    val devices = usbManager.deviceList.values
    devices.firstOrNull { it.vendorId == EPSON_VENDOR_ID }?.let { return it }
    for (candidate in devices) {
      for (index in 0 until candidate.interfaceCount) {
        if (candidate.getInterface(index).interfaceClass == UsbConstants.USB_CLASS_PRINTER) {
          return candidate
        }
      }
    }
    throw IllegalStateException("no printer-class USB device attached")
  }

  private fun open() {
    if (connection != null) return
    val target = findPrinter()
    if (!usbManager.hasPermission(target)) {
      if (!requestPermission(target)) {
        throw IllegalStateException("usb permission denied")
      }
    }

    var printer: UsbInterface? = null
    var out: UsbEndpoint? = null
    var incoming: UsbEndpoint? = null
    for (index in 0 until target.interfaceCount) {
      val candidate = target.getInterface(index)
      if (candidate.interfaceClass != UsbConstants.USB_CLASS_PRINTER) continue
      printer = candidate
      for (endpointIndex in 0 until candidate.endpointCount) {
        val endpoint = candidate.getEndpoint(endpointIndex)
        if (endpoint.direction == UsbConstants.USB_DIR_OUT) out = endpoint
        if (endpoint.direction == UsbConstants.USB_DIR_IN) incoming = endpoint
      }
    }
    val selectedInterface = printer
      ?: throw IllegalStateException("no printer-class interface on the device")
    val outSelected = out
      ?: throw IllegalStateException("no bulk OUT endpoint on the printer")

    val open = usbManager.openDevice(target)
      ?: throw IllegalStateException("could not open the USB device")
    if (!open.claimInterface(selectedInterface, true)) {
      open.close()
      throw IllegalStateException("could not claim the printer interface")
    }
    device = target
    connection = open
    printerInterface = selectedInterface
    outEndpoint = outSelected
    inEndpoint = incoming
  }

  private fun requestPermission(target: UsbDevice): Boolean {
    val latch = CountDownLatch(1)
    var granted = false
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_USB_PERMISSION) return
        granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
        latch.countDown()
      }
    }
    val filter = IntentFilter(ACTION_USB_PERMISSION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      activity.registerReceiver(receiver, filter)
    }
    try {
      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        PendingIntent.FLAG_MUTABLE
      } else {
        0
      }
      val intent = PendingIntent.getBroadcast(
        activity,
        0,
        Intent(ACTION_USB_PERMISSION),
        flags,
      )
      activity.runOnUiThread { usbManager.requestPermission(target, intent) }
      // The operator has to answer the system prompt; the till shows it once.
      latch.await(PERMISSION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    } finally {
      activity.unregisterReceiver(receiver)
    }
    return granted
  }

  private fun write(bytes: ByteArray) {
    val open = connection ?: throw IllegalStateException("the printer is not open")
    val endpoint = outEndpoint ?: throw IllegalStateException("the printer is not open")
    var offset = 0
    while (offset < bytes.size) {
      val chunk = minOf(bytes.size - offset, MAX_CHUNK_BYTES)
      val written = open.bulkTransfer(endpoint, bytes.copyOfRange(offset, offset + chunk), chunk, IO_TIMEOUT_MS)
      if (written < 0) throw IllegalStateException("the printer did not accept the bytes")
      offset += written
    }
  }

  private fun status(): Int {
    val open = connection ?: throw IllegalStateException("the printer is not open")
    val out = outEndpoint ?: throw IllegalStateException("the printer is not open")
    val incoming = inEndpoint ?: throw IllegalStateException("the printer has no status endpoint")
    val query = byteArrayOf(0x10, 0x04, 0x01) // DLE EOT 1
    val buffer = ByteArray(STATUS_BUFFER_BYTES)
    // Measured on the D3-504 with the TM-T20IIIL: the answer is not waiting the
    // instant the query is written — reading straight after returns nothing. A
    // short settle, and a retry, is what makes it answer. (`DLE EOT` returned
    // 0x16 here; that is the byte this reads.)
    repeat(STATUS_ATTEMPTS) {
      if (open.bulkTransfer(out, query, query.size, IO_TIMEOUT_MS) < 0) {
        throw IllegalStateException("the printer did not accept the status query")
      }
      Thread.sleep(STATUS_SETTLE_MS)
      val read = open.bulkTransfer(incoming, buffer, buffer.size, STATUS_READ_TIMEOUT_MS)
      if (read >= 1) return buffer[0].toInt() and 0xFF
    }
    throw IllegalStateException("the printer did not answer its status")
  }

  private fun close() {
    val open = connection
    val claimed = printerInterface
    if (open != null && claimed != null) {
      runCatching { open.releaseInterface(claimed) }
    }
    open?.close()
    connection = null
    device = null
    printerInterface = null
    outEndpoint = null
    inEndpoint = null
  }

  companion object {
    const val CHANNEL = "co.umiconsulting.umi_pos/usb_printer"
    private const val ACTION_USB_PERMISSION =
      "co.umiconsulting.umi_pos.USB_PRINTER_PERMISSION"
    private const val EPSON_VENDOR_ID = 0x04B8
    private const val PERMISSION_TIMEOUT_SECONDS = 30L
    private const val IO_TIMEOUT_MS = 5_000
    private const val MAX_CHUNK_BYTES = 16_384
    private const val STATUS_ATTEMPTS = 3
    private const val STATUS_SETTLE_MS = 250L
    private const val STATUS_READ_TIMEOUT_MS = 2_000
    private const val STATUS_BUFFER_BYTES = 16
  }
}
