package app.xservis.xfreedom.tls

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.xservis.xfreedom.vpn.XFreedomVpnService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

object Neon {
    val black=Color(0xFF05070A)
    val surface=Color(0xFF0D1419)
    val cyan=Color(0xFF56E5D4)
    val silver=Color(0xFFD9E2E8)
    val gray=Color(0xFF829099)
}
data class VpnUiState(val stage:TunnelStage=TunnelStage.IDLE,val receivedAt:Long=0)
@Composable fun rememberVpnState():VpnUiState {
    val context=LocalContext.current
    var state by remember{mutableStateOf(VpnUiState())}
    DisposableEffect(context) {
        val receiver=object:BroadcastReceiver(){override fun onReceive(c:Context?,intent:Intent?){
            val stage=runCatching{TunnelStage.valueOf(intent?.getStringExtra(XFreedomVpnService.EXTRA_STAGE).orEmpty())}.getOrDefault(TunnelStage.IDLE)
            state=VpnUiState(stage,System.currentTimeMillis())
        }}
        val filter=IntentFilter(XFreedomVpnService.ACTION_STATUS)
        if(Build.VERSION.SDK_INT>=33)context.registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED)
        else {@Suppress("DEPRECATION") context.registerReceiver(receiver,filter)}
        runCatching{context.startService(Intent(context,XFreedomVpnService::class.java).setAction(XFreedomVpnService.ACTION_QUERY))}
        onDispose{context.unregisterReceiver(receiver)}
    }
    LaunchedEffect(Unit){while(true){delay(5000);if(state.stage==TunnelStage.CONNECTED && System.currentTimeMillis()-state.receivedAt>45000)state=state.copy(stage=TunnelStage.DEGRADED)}}
    return state
}
@Composable fun NeonScreen(onDiagnostics:()->Unit) {
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    val runtime=rememberVpnState()
    var linked by remember{mutableStateOf(false)}
    var settings by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var starting by remember{mutableStateOf(false)}
    LaunchedEffect(Unit){linked=withContext(Dispatchers.IO){runCatching{SecureEnrollment.load(context)!=null}.getOrDefault(false)}}
    LaunchedEffect(runtime){if(runtime.receivedAt>0)starting=false}
    val active=runtime.stage!=TunnelStage.IDLE
    fun start(){
        starting=true
        context.startForegroundService(Intent(context,XFreedomVpnService::class.java).setAction(XFreedomVpnService.ACTION_START_TLS))
    }
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
        if(result.resultCode==Activity.RESULT_OK)start() else error="Разрешение VPN не выдано"
    }
    val notificationPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){}
    val importer=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->
        if(uri!=null)scope.launch {
            val result=withContext(Dispatchers.IO){runCatching {
                val text=context.contentResolver.openInputStream(uri)?.use{String(it.readNBytesCompat(8192),Charsets.UTF_8)}?:error("Файл недоступен")
                SecureEnrollment.save(context,JSONObject(text))
            }}
            result.onSuccess{linked=true;error=null;settings=false}.onFailure{error="Не удалось прочитать привязку устройства"}
        }
    }
    Surface(color=Neon.black,contentColor=Neon.silver,modifier=Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(horizontal=24.dp,vertical=20.dp),horizontalAlignment=Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) {
                Column {
                    Text("XFREEDOM",fontSize=20.sp,fontWeight=FontWeight.Bold,letterSpacing=3.sp)
                    Text("ЛИЧНЫЙ КАНАЛ",color=Neon.gray,fontSize=10.sp,letterSpacing=2.sp)
                }
                TextButton(onClick={settings=true}){Text("Настройки",color=Neon.silver)}
            }
            Spacer(Modifier.height(36.dp))
            Text(if(runtime.stage==TunnelStage.CONNECTED)"ВЫ В СЕТИ" else "ВАШЕ СОЕДИНЕНИЕ",color=Neon.cyan,fontSize=11.sp,letterSpacing=2.sp)
            Spacer(Modifier.height(12.dp))
            Text(XFreedomVpnService.stageLabel(runtime.stage),textAlign=TextAlign.Center,fontSize=26.sp,lineHeight=32.sp,fontWeight=FontWeight.Medium)
            Spacer(Modifier.height(12.dp))
            Text(if(linked)"Защищённый маршрут для вашего устройства" else "Свяжите устройство с кабинетом, чтобы начать",color=Neon.gray,textAlign=TextAlign.Center,fontSize=14.sp,lineHeight=21.sp)
            Box(Modifier.padding(vertical=20.dp).sizeIn(maxWidth=300.dp,maxHeight=300.dp).fillMaxWidth().aspectRatio(1f),contentAlignment=Alignment.Center) {
                NeonLens(runtime.stage)
                Column(horizontalAlignment=Alignment.CenterHorizontally) {
                    Text("X",fontSize=64.sp,fontWeight=FontWeight.Light,color=Neon.silver)
                    Text(if(runtime.stage==TunnelStage.CONNECTED)"ПРОВЕРЕНО" else "NEON LENS",fontSize=9.sp,letterSpacing=3.sp,color=Neon.cyan)
                }
            }
            Button(onClick={
                when {
                    active -> context.startService(Intent(context,XFreedomVpnService::class.java).setAction(XFreedomVpnService.ACTION_STOP))
                    !linked -> settings=true
                    else -> {
                        error=null
                        if(Build.VERSION.SDK_INT>=33)notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                        val intent=VpnService.prepare(context)
                        if(intent==null)start() else permission.launch(intent)
                    }
                }
            },enabled=!starting,shape=RoundedCornerShape(20.dp),colors=ButtonDefaults.buttonColors(containerColor=Neon.cyan,contentColor=Neon.black),
                modifier=Modifier.fillMaxWidth().heightIn(min=60.dp).border(1.dp,Neon.silver.copy(alpha=.35f),RoundedCornerShape(20.dp))) {
                Text(if(starting)"Подготовка…" else if(active)"Отключить" else "Подключить",fontSize=18.sp,fontWeight=FontWeight.Medium)
            }
            Spacer(Modifier.height(24.dp))
            Surface(color=Neon.surface,shape=RoundedCornerShape(20.dp),modifier=Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("Маршрут",color=Neon.gray,fontSize=13.sp);Text(if(active)"Защищённый TLS" else "После проверки",fontSize=13.sp)}
                    HorizontalDivider(color=Neon.gray.copy(alpha=.15f))
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("Интернет",color=Neon.gray,fontSize=13.sp);Text(if(runtime.stage==TunnelStage.CONNECTED)"Подтверждён" else "Не подтверждён",color=if(runtime.stage==TunnelStage.CONNECTED)Neon.cyan else Neon.silver,fontSize=13.sp)}
                }
            }
            error?.let{Spacer(Modifier.height(12.dp));Text(it,color=Neon.silver,textAlign=TextAlign.Center)}
            Spacer(Modifier.height(16.dp))
            TextButton(onClick=onDiagnostics){Text("Диагностика и другие профили",color=Neon.gray)}
        }
    }
    if(settings)AlertDialog(onDismissRequest={settings=false},containerColor=Neon.surface,title={Text("Настройки подключения")},text={
        Column(verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text(if(linked)"Устройство связано с кабинетом." else "Импортируйте файл привязки, выданный вашим кабинетом.")
            Text("Этот маршрут передаёт TCP. UDP, QUIC и IPv6 пока не поддерживаются.",color=Neon.gray)
            TextButton(onClick={context.startActivity(Intent(Settings.ACTION_VPN_SETTINGS))}){Text("Всегда включённый VPN и блокировка")}
            Text("Защита при остановке приложения включается в системных настройках VPN.",color=Neon.gray,fontSize=12.sp)
        }
    },confirmButton={TextButton(onClick={importer.launch(arrayOf("application/json","text/plain"))},enabled=!active){Text(if(linked)"Обновить привязку" else "Связать устройство")}},dismissButton={TextButton(onClick={settings=false}){Text("Закрыть")}})
}
@Composable private fun NeonLens(stage:TunnelStage) {
    val connected=stage==TunnelStage.CONNECTED
    val tint=if(connected)Neon.cyan else Neon.silver
    Canvas(Modifier.fillMaxSize().semantics{contentDescription="Индикатор: ${XFreedomVpnService.stageLabel(stage)}"}) {
        val r=size.minDimension*.40f
        drawCircle(Brush.radialGradient(listOf(Neon.cyan.copy(alpha=if(connected).22f else .09f),Color.Transparent),center,r*1.22f),r*1.22f)
        drawCircle(Brush.radialGradient(listOf(Neon.surface,Neon.black),Offset(center.x-r*.3f,center.y-r*.4f),r*1.7f),r)
        drawCircle(Neon.silver.copy(alpha=.15f),r,style=Stroke(1.dp.toPx()))
        drawCircle(Neon.cyan.copy(alpha=.08f),r*.88f,style=Stroke(16.dp.toPx()))
        drawCircle(Neon.cyan.copy(alpha=.35f),r*.88f,style=Stroke(1.dp.toPx()))
        val origin=Offset(center.x-r,center.y-r)
        drawArc(Brush.sweepGradient(listOf(Color.Transparent,tint,Color.Transparent)),210f,110f,false,origin,Size(r*2,r*2),style=Stroke(2.dp.toPx(),cap=StrokeCap.Round))
        drawCircle(Neon.silver.copy(alpha=.04f),r*.66f,style=Stroke(1.dp.toPx()))
    }
}
