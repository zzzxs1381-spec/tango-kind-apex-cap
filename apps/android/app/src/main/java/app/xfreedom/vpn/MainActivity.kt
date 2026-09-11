package app.xfreedom.vpn

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import app.xfreedom.vpn.profile.ProfileStore
import app.xfreedom.vpn.vpn.XFreedomVpnService
import java.io.ByteArrayOutputStream

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
            if (ProfileStore.hasProfile(this)) {
                "Профиль Xray загружен. Можно подключаться."
            } else {
                "Сначала импортируйте клиентский xray-client.json из XFreedom."
            },
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

    @Deprecated("Deprecated Android result API retained for a dependency-free bootstrap UI.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_VPN -> {
                if (resultCode == RESULT_OK) {
                    startVpnService()
                } else {
                    renderState(XFreedomVpnService.STATE_DISCONNECTED, "Разрешение VPN не выдано.")
                }
            }

            REQUEST_PROFILE -> {
                if (resultCode != RESULT_OK) return
                val uri = data?.data ?: return
                val result = runCatching { readLimitedUtf8(uri, MAX_PROFILE_BYTES) }
                    .flatMap { ProfileStore.importClientJson(this, it) }
                result.onSuccess {
                    renderState(
                        XFreedomVpnService.STATE_DISCONNECTED,
                        "Клиентский профиль проверен и сохранён в приватном хранилище приложения.",
                    )
                }.onFailure {
                    renderState(
                        XFreedomVpnService.STATE_ERROR,
                        "Профиль отклонён: ${it.message ?: it.javaClass.simpleName}",
                    )
                }
            }
        }
    }

    private fun requestVpnPermissionAndStart() {
        if (!ProfileStore.hasProfile(this)) {
            renderState(
                XFreedomVpnService.STATE_ERROR,
                "Нет клиентского профиля. Нажмите «Импортировать Xray JSON».",
            )
            return
        }

        val prepareIntent = VpnService.prepare(this)
        if (prepareIntent != null) {
            @Suppress("DEPRECATION")
            startActivityForResult(prepareIntent, REQUEST_VPN)
        } else {
            startVpnService()
        }
    }

    private fun chooseProfile() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json")
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQUEST_PROFILE)
    }

    private fun startVpnService() {
        val intent = Intent(this, XFreedomVpnService::class.java)
            .setAction(XFreedomVpnService.ACTION_START)
        startForegroundService(intent)
        renderState(
            XFreedomVpnService.STATE_STARTING,
            "Системное разрешение получено. Проверяем Xray и маршрут…",
        )
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
            XFreedomVpnService.STATE_STARTING -> "ПОДКЛЮЧЕНИЕ"
            XFreedomVpnService.STATE_ERROR -> "ОШИБКА"
            else -> "ВЫКЛ"
        }
        detailsView.text = message
        connectButton.text = if (state == XFreedomVpnService.STATE_CONNECTED) "ОТКЛЮЧИТЬСЯ" else "ПОДКЛЮЧИТЬСЯ"
        connectButton.setOnClickListener {
            if (state == XFreedomVpnService.STATE_CONNECTED) stopVpnService() else requestVpnPermissionAndStart()
        }
    }

    private fun readLimitedUtf8(uri: Uri, limit: Int): String {
        val input = contentResolver.openInputStream(uri) ?: error("Не удалось открыть файл")
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8 * 1024)
            var total = 0
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                total += count
                require(total <= limit) { "Профиль больше ${limit / 1024} KiB" }
                output.write(buffer, 0, count)
            }
            return output.toString(Charsets.UTF_8.name())
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

        root.addView(Button(this).apply {
            text = "Импортировать Xray JSON"
            textSize = 14f
            isAllCaps = false
            setOnClickListener { chooseProfile() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply {
            topMargin = dp(12)
        })

        root.addView(TextView(this).apply {
            text = "AUTO · профиль → TUN → Xray → проверка выхода"
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
        private const val REQUEST_PROFILE = 1003
        private const val MAX_PROFILE_BYTES = 2 * 1024 * 1024
    }
}
