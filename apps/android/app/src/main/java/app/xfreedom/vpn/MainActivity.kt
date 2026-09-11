package app.xfreedom.vpn

import android.app.Activity
import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import app.xfreedom.vpn.vpn.XFreedomVpnService

class MainActivity : Activity() {
    private lateinit var statusView: TextView
    private lateinit var detailsView: TextView
    private lateinit var connectButton: Button

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != XFreedomVpnService.ACTION_STATE) return
            val state = intent.getStringExtra(XFreedomVpnService.EXTRA_STATE).orEmpty()
            val message = intent.getStringExtra(XFreedomVpnService.EXTRA_MESSAGE).orEmpty()
            renderState(state, message)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }

        renderState(
            XFreedomVpnService.STATE_DISCONNECTED,
            "Готов к системному разрешению VPN. Транспортное ядро подключается отдельным модулем.",
        )
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(XFreedomVpnService.ACTION_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stateReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(stateReceiver, filter)
        }
    }

    override fun onStop() {
        runCatching { unregisterReceiver(stateReceiver) }
        super.onStop()
    }

    @Deprecated("Deprecated in Android API; retained to keep this zero-dependency shell minimal.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_VPN && resultCode == RESULT_OK) {
            startVpnService()
        } else if (requestCode == REQUEST_VPN) {
            renderState(XFreedomVpnService.STATE_DISCONNECTED, "Разрешение VPN не выдано.")
        }
    }

    private fun requestVpnPermissionAndStart() {
        val prepareIntent = VpnService.prepare(this)
        if (prepareIntent != null) {
            @Suppress("DEPRECATION")
            startActivityForResult(prepareIntent, REQUEST_VPN)
        } else {
            startVpnService()
        }
    }

    private fun startVpnService() {
        val intent = Intent(this, XFreedomVpnService::class.java)
            .setAction(XFreedomVpnService.ACTION_START)
        startForegroundService(intent)
        renderState("STARTING", "Системное разрешение получено. Проверяем доступные транспортные ядра…")
    }

    private fun stopVpnService() {
        startService(
            Intent(this, XFreedomVpnService::class.java)
                .setAction(XFreedomVpnService.ACTION_STOP),
        )
    }

    private fun renderState(state: String, message: String) {
        statusView.text = when (state) {
            XFreedomVpnService.STATE_CONNECTED -> "ЗАЩИЩЕНО"
            XFreedomVpnService.STATE_ENGINE_REQUIRED -> "ТРЕБУЕТСЯ ЯДРО"
            "STARTING" -> "ПОДКЛЮЧЕНИЕ"
            else -> "ВЫКЛ"
        }
        detailsView.text = message
        connectButton.text = if (state == XFreedomVpnService.STATE_CONNECTED) "ОТКЛЮЧИТЬСЯ" else "ПОДКЛЮЧИТЬСЯ"
        connectButton.setOnClickListener {
            if (state == XFreedomVpnService.STATE_CONNECTED) stopVpnService() else requestVpnPermissionAndStart()
        }
    }

    private fun buildContent(): LinearLayout {
        val density = resources.displayMetrics.density
        fun dp(value: Int): Int = (value * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(64), dp(28), dp(32))
            setBackgroundColor(Color.rgb(5, 8, 16))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }

        root.addView(TextView(this).apply {
            text = "XFREEDOM"
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        root.addView(TextView(this).apply {
            text = "Adaptive Secure Connectivity"
            textSize = 14f
            setTextColor(Color.rgb(130, 150, 175))
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(52))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        statusView = TextView(this).apply {
            textSize = 22f
            setTextColor(Color.rgb(110, 220, 255))
            gravity = Gravity.CENTER
        }
        root.addView(statusView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        detailsView = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.rgb(180, 190, 205))
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, dp(36))
        }
        root.addView(detailsView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        connectButton = Button(this).apply {
            text = "ПОДКЛЮЧИТЬСЯ"
            textSize = 16f
            isAllCaps = false
            minHeight = dp(58)
        }
        root.addView(connectButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)))

        root.addView(TextView(this).apply {
            text = "AUTO · диагностика → выбор узла → выбор транспорта → проверка"
            textSize = 12f
            setTextColor(Color.rgb(105, 120, 145))
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, 0)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        return root
    }

    companion object {
        private const val REQUEST_VPN = 1001
        private const val REQUEST_NOTIFICATIONS = 1002
    }
}
