package app.xservis.xfreedom

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.xservis.xfreedom.network.DecisionAction
import app.xservis.xfreedom.network.DecisionEngine
import app.xservis.xfreedom.network.NetworkSnapshot
import app.xservis.xfreedom.network.PostConnectVerifier
import app.xservis.xfreedom.network.SystemProbeEngine
import app.xservis.xfreedom.network.TransportDecision
import app.xservis.xfreedom.network.TransportName
import app.xservis.xfreedom.network.VerificationAction
import app.xservis.xfreedom.vpn.WireGuardBackend
import app.xservis.xfreedom.vpn.XFreedomVpnService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    background = Color(0xFF05070A),
                    surface = Color(0xFF0B1018),
                    primary = Color(0xFF7DE8D8),
                ),
            ) {
                XFreedomScreen()
            }
        }
    }
}

@Composable
private fun XFreedomScreen() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val activity = context as? ComponentActivity
    val wireGuard = remember { WireGuardBackend(context.applicationContext) }

    var snapshot by remember { mutableStateOf<NetworkSnapshot?>(null) }
    var decision by remember { mutableStateOf<TransportDecision?>(null) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf(readRuntimeMessage(context)) }
    var verification by remember { mutableStateOf<String?>(null) }

    var wireGuardConfig by remember { mutableStateOf<String?>(null) }
    var xrayConfig by remember { mutableStateOf<String?>(null) }

    var wireGuardConnected by remember { mutableStateOf(false) }
    var xrayRequested by remember { mutableStateOf(false) }
    var xrayConnected by remember { mutableStateOf(false) }
    var activeTransport by remember { mutableStateOf<TransportName?>(null) }
    var pendingTransport by remember { mutableStateOf<TransportName?>(null) }

    fun availableTransports(): Set<TransportName> = buildSet {
        if (xrayConfig != null) add(TransportName.VLESS_REALITY)
        if (wireGuardConfig != null) add(TransportName.WIREGUARD)
    }

    fun stopReality() {
        context.startService(
            Intent(context, XFreedomVpnService::class.java)
                .setAction(XFreedomVpnService.ACTION_STOP),
        )
        xrayRequested = false
        xrayConnected = false
        if (activeTransport == TransportName.VLESS_REALITY) activeTransport = null
        status = "Останавливаю REALITY…"
    }

    fun startReality() {
        val config = xrayConfig ?: run {
            status = "Сначала импортируйте Xray REALITY JSON"
            return
        }
        xrayRequested = true
        xrayConnected = false
        verification = null
        status = "Запускаю Xray / REALITY…"
        val intent = Intent(context, XFreedomVpnService::class.java)
            .setAction(XFreedomVpnService.ACTION_START_XRAY)
            .putExtra(XFreedomVpnService.EXTRA_XRAY_CONFIG, config)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    fun connectWireGuard(before: NetworkSnapshot?) {
        val config = wireGuardConfig ?: run {
            status = "Сначала импортируйте WireGuard .conf"
            return
        }
        busy = true
        verification = null
        status = "Поднимаю WireGuard интерфейс…"
        Thread {
            val result = wireGuard.connect(config)
            if (result.isFailure) {
                activity?.runOnUiThread {
                    busy = false
                    wireGuardConnected = false
                    activeTransport = null
                    status = "WireGuard: ${result.exceptionOrNull()?.message ?: "ошибка подключения"}"
                }
                return@Thread
            }

            Thread.sleep(900)
            val check = before?.let {
                PostConnectVerifier.compare(it, SystemProbeEngine(context.applicationContext).collect())
            }

            if (check?.action == VerificationAction.TRY_FALLBACK) {
                wireGuard.disconnect()
            }

            activity?.runOnUiThread {
                busy = false
                if (check?.action == VerificationAction.TRY_FALLBACK) {
                    wireGuardConnected = false
                    activeTransport = null
                    verification = check.reason
                    status = "WireGuard отклонён post-connect проверкой"
                } else {
                    wireGuardConnected = true
                    activeTransport = TransportName.WIREGUARD
                    verification = check?.reason ?: "Post-connect сравнение не выполнялось."
                    status = when (check?.action) {
                        VerificationAction.KEEP_TUNNEL -> "WireGuard подтверждён post-connect проверкой"
                        VerificationAction.COLLECT_MORE_EVIDENCE -> "WireGuard поднят; результат проверки неоднозначен"
                        else -> "WireGuard интерфейс поднят"
                    }
                }
            }
        }.start()
    }

    fun startTransport(transport: TransportName) {
        when (transport) {
            TransportName.VLESS_REALITY -> startReality()
            TransportName.WIREGUARD -> connectWireGuard(snapshot)
            else -> {
                status = "${transport.name}: native backend ещё не встроен; запуск запрещён, чтобы не имитировать подключение."
            }
        }
    }

    val vpnPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val transport = pendingTransport
        pendingTransport = null
        if (result.resultCode == Activity.RESULT_OK && transport != null) {
            startTransport(transport)
        } else {
            status = "Системное разрешение VPN не выдано"
        }
    }

    fun requestOrStart(transport: TransportName) {
        pendingTransport = transport
        val prepareIntent = VpnService.prepare(context)
        if (prepareIntent != null) {
            vpnPermission.launch(prepareIntent)
        } else {
            pendingTransport = null
            startTransport(transport)
        }
    }

    val wireGuardImport = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openInputStream(uri)?.use { input ->
                val bytes = input.readBytes()
                require(bytes.size <= 64 * 1024) { "WireGuard config больше 64 KiB" }
                bytes.toString(Charsets.UTF_8)
            } ?: error("Не удалось открыть WireGuard config")
        }.onSuccess { text ->
            wireGuardConfig = text
            status = "WireGuard профиль импортирован в память · ключи не сохранены на диск"
        }.onFailure { error ->
            status = "Импорт WireGuard: ${error.message ?: "ошибка"}"
        }
    }

    val xrayImport = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openInputStream(uri)?.use { input ->
                val bytes = input.readBytes()
                require(bytes.size <= 256 * 1024) { "Xray config больше 256 KiB" }
                bytes.toString(Charsets.UTF_8).also(::requireRealityProfile)
            } ?: error("Не удалось открыть Xray config")
        }.onSuccess { text ->
            xrayConfig = text
            status = "Xray REALITY профиль импортирован в память · секреты не сохранены на диск"
        }.onFailure { error ->
            status = "Импорт REALITY: ${error.message ?: "ошибка"}"
        }
    }

    LaunchedEffect(xrayRequested) {
        if (!xrayRequested) return@LaunchedEffect
        var sawStartup = false
        repeat(40) {
            delay(500)
            val prefs = context.getSharedPreferences(XFreedomVpnService.PREFS, Context.MODE_PRIVATE)
            val connected = prefs.getBoolean(XFreedomVpnService.KEY_CONNECTED, false)
            val message = prefs.getString(XFreedomVpnService.KEY_MESSAGE, null).orEmpty()
            if (message.startsWith("Запуск Xray")) sawStartup = true

            if (connected) {
                xrayConnected = true
                activeTransport = TransportName.VLESS_REALITY
                status = message.ifBlank { "REALITY runtime запущен" }

                val before = snapshot
                if (before != null) {
                    delay(900)
                    val after = withContext(Dispatchers.IO) {
                        SystemProbeEngine(context.applicationContext).collect()
                    }
                    val check = PostConnectVerifier.compare(before, after)
                    verification = check.reason
                    if (check.action == VerificationAction.TRY_FALLBACK) {
                        stopReality()
                        status = "REALITY отклонён post-connect проверкой"
                    } else {
                        status = when (check.action) {
                            VerificationAction.KEEP_TUNNEL -> "REALITY подтверждён post-connect проверкой"
                            VerificationAction.COLLECT_MORE_EVIDENCE -> "REALITY подключён; результат проверки неоднозначен"
                            VerificationAction.TRY_FALLBACK -> status
                        }
                    }
                }
                return@LaunchedEffect
            }

            if (
                sawStartup &&
                (message.startsWith("REALITY:") || message.startsWith("Xray профиль") || message == "Отключено")
            ) {
                xrayRequested = false
                xrayConnected = false
                if (activeTransport == TransportName.VLESS_REALITY) activeTransport = null
                status = message
                return@LaunchedEffect
            }
        }

        xrayRequested = false
        xrayConnected = false
        if (activeTransport == TransportName.VLESS_REALITY) activeTransport = null
        status = "REALITY: запуск не подтвердился за контрольное окно"
    }

    Surface(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF05070A)),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("XFreedom", fontSize = 34.sp)
            Text(
                "Один клиент · диагностика → реальный backend → туннель → post-connect проверка",
                color = Color(0xFFA6B3C4),
            )

            StatusCard(title = "Состояние", text = status)

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Button(
                    modifier = Modifier.weight(1f),
                    enabled = !busy,
                    onClick = {
                        busy = true
                        status = "Проверяю DNS / TCP / TLS / HTTP…"
                        val available = availableTransports()
                        Thread {
                            val measured = SystemProbeEngine(context.applicationContext).collect()
                            val selected = DecisionEngine.decide(measured, available)
                            activity?.runOnUiThread {
                                snapshot = measured
                                decision = selected
                                busy = false
                                status = "Диагностика завершена: ${selected.reason}"
                            }
                        }.start()
                    },
                ) {
                    Text(if (busy) "Проверяю…" else "Проверить сеть")
                }

                Button(
                    modifier = Modifier.weight(1f),
                    enabled = !busy,
                    onClick = {
                        when {
                            wireGuardConnected -> {
                                busy = true
                                Thread {
                                    val result = wireGuard.disconnect()
                                    activity?.runOnUiThread {
                                        busy = false
                                        result
                                            .onSuccess {
                                                wireGuardConnected = false
                                                activeTransport = null
                                                status = "WireGuard отключён"
                                            }
                                            .onFailure { error ->
                                                status = "Отключение WireGuard: ${error.message ?: "ошибка"}"
                                            }
                                    }
                                }.start()
                            }
                            xrayRequested || xrayConnected -> stopReality()
                            else -> {
                                val available = availableTransports()
                                if (available.isEmpty()) {
                                    status = "Импортируйте REALITY JSON или WireGuard .conf"
                                } else {
                                    busy = true
                                    verification = null
                                    status = "Определяю сеть и выбираю реально доступный транспорт…"
                                    Thread {
                                        val measured = SystemProbeEngine(context.applicationContext).collect()
                                        val selected = DecisionEngine.decide(measured, available)
                                        activity?.runOnUiThread {
                                            snapshot = measured
                                            decision = selected
                                            busy = false
                                            if (selected.action == DecisionAction.CONNECT && selected.primary != null) {
                                                status = "Выбран ${selected.primary.name}; запрашиваю системный VPN"
                                                requestOrStart(selected.primary)
                                            } else {
                                                status = selected.reason
                                            }
                                        }
                                    }.start()
                                }
                            }
                        }
                    },
                ) {
                    Text(
                        if (wireGuardConnected || xrayRequested || xrayConnected) "Отключить" else "Подключить",
                    )
                }
            }

            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && !wireGuardConnected && !xrayRequested,
                onClick = { xrayImport.launch(arrayOf("application/json", "text/plain", "*/*")) },
            ) {
                Text(if (xrayConfig == null) "Импорт Xray REALITY JSON" else "Заменить REALITY профиль")
            }

            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && !wireGuardConnected && !xrayRequested,
                onClick = { wireGuardImport.launch(arrayOf("text/plain", "application/octet-stream", "*/*")) },
            ) {
                Text(if (wireGuardConfig == null) "Импорт WireGuard .conf" else "Заменить WireGuard профиль")
            }

            StatusCard(
                title = "Доступные backend",
                text = availableTransports().joinToString { it.name }.ifBlank { "нет загруженных профилей" },
            )

            activeTransport?.let {
                StatusCard(title = "Активный транспорт", text = it.name)
            }

            verification?.let {
                StatusCard(title = "Post-connect проверка", text = it)
            }

            decision?.let { selected ->
                StatusCard(
                    title = "Decision Engine",
                    text = buildString {
                        append("primary: ")
                        append(selected.primary?.name ?: "не выбран")
                        append("\naction: ")
                        append(selected.action.name)
                        append("\nconfidence: ")
                        append(String.format("%.0f%%", selected.confidence * 100))
                        if (selected.fallbacks.isNotEmpty()) {
                            append("\nfallbacks: ")
                            append(selected.fallbacks.joinToString { it.name })
                        }
                        append("\n")
                        append(selected.reason)
                    },
                )
            }

            snapshot?.let { measured ->
                StatusCard(
                    title = "Контрольный канал",
                    text = "${measured.accessType.name} · DNS ${measured.control.dns} · TCP443 ${measured.control.tcp443} · TLS ${measured.control.tls} · UDP443 ${measured.control.udp443} · QUIC ${measured.control.quic}",
                )

                Text("Приоритетные приложения", fontSize = 20.sp)
                measured.apps.forEach { app ->
                    StatusCard(
                        title = app.id,
                        text = "DNS ${app.dns} · TCP ${app.tcp443} · TLS ${app.tls} · HTTP ${app.http}",
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                "XFreedom выбирает только backend, который реально встроен и настроен. Hysteria2/TUIC не будут показываться как подключённые до добавления их native runtime. Один таймаут не считается доказательством DPI/ТСПУ.",
                color = Color(0xFF7F8C9F),
                fontSize = 12.sp,
            )
        }
    }
}

private fun requireRealityProfile(text: String) {
    val root = JSONObject(text)
    val outbounds = root.optJSONArray("outbounds") ?: error("Xray JSON не содержит outbounds")
    val hasReality = (0 until outbounds.length()).any { index ->
        val outbound = outbounds.optJSONObject(index) ?: return@any false
        if (outbound.optString("protocol") != "vless") return@any false
        outbound.optJSONObject("streamSettings")?.optString("security") == "reality"
    }
    require(hasReality) { "Нужен VLESS REALITY профиль" }
}

@Composable
private fun StatusCard(title: String, text: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1018)),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(title, color = Color(0xFF7DE8D8), fontSize = 13.sp)
            Text(text, color = Color(0xFFE7EDF5))
        }
    }
}

private fun readRuntimeMessage(context: Context): String =
    context.getSharedPreferences(XFreedomVpnService.PREFS, Context.MODE_PRIVATE)
        .getString(
            XFreedomVpnService.KEY_MESSAGE,
            "Готово. Импортируйте REALITY JSON или WireGuard .conf и нажмите «Подключить».",
        ) ?: "Готово к диагностике"
