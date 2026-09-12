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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.xservis.xfreedom.network.DecisionEngine
import app.xservis.xfreedom.network.NetworkSnapshot
import app.xservis.xfreedom.network.SystemProbeEngine
import app.xservis.xfreedom.network.TransportDecision
import app.xservis.xfreedom.vpn.TunnelCoreRegistry
import app.xservis.xfreedom.vpn.XFreedomVpnService

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
    var snapshot by remember { mutableStateOf<NetworkSnapshot?>(null) }
    var decision by remember { mutableStateOf<TransportDecision?>(null) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf(readRuntimeMessage(context)) }

    fun startVpnService() {
        val intent = Intent(context, XFreedomVpnService::class.java)
            .setAction(XFreedomVpnService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        status = if (TunnelCoreRegistry.backend.ready) {
            "Запуск VPN…"
        } else {
            "VPN-разрешение получено; native tunnel core ещё не подключён"
        }
    }

    val vpnPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            startVpnService()
        } else {
            status = "Системное разрешение VPN не выдано"
        }
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
                "Один клиент · диагностика → решение → туннель → проверка приложений",
                color = Color(0xFFA6B3C4),
            )

            StatusCard(
                title = "Состояние",
                text = status,
            )

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
                        Thread {
                            val measured = SystemProbeEngine(context.applicationContext).collect()
                            val selected = DecisionEngine.decide(measured)
                            (context as? ComponentActivity)?.runOnUiThread {
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
                    onClick = {
                        val prepareIntent = VpnService.prepare(context)
                        if (prepareIntent != null) {
                            vpnPermission.launch(prepareIntent)
                        } else {
                            startVpnService()
                        }
                    },
                ) {
                    Text("Подключить")
                }
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
                "Важно: эта сборка не объявляет DPI/ТСПУ по одному таймауту. UDP/QUIC остаются UNKNOWN до подключения настоящего QUIC probe/core.",
                color = Color(0xFF7F8C9F),
                fontSize = 12.sp,
            )
        }
    }
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
            "Готово к диагностике. Native tunnel core ещё не подключён.",
        ) ?: "Готово к диагностике"
