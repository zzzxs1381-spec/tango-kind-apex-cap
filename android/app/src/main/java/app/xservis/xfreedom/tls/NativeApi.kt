package app.xservis.xfreedom.tls

import android.net.Network
import org.json.JSONObject
import java.net.URL
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class NativeApi(val origin:String,private val probeToken:String) : java.io.Closeable {
    private val queue=ArrayBlockingQueue<JSONObject>(128)
    private val worker=Executors.newSingleThreadScheduledExecutor()
    init {
        val uri=URI(origin)
        require(uri.scheme=="https" && uri.host!=null && uri.userInfo==null && uri.path.orEmpty().isEmpty() && uri.rawQuery==null && uri.rawFragment==null)
        require(probeToken.matches(Regex("[A-Za-z0-9_.-]{32,4000}")))
        worker.scheduleWithFixedDelay({flush()},0,2,TimeUnit.SECONDS)
    }
    fun config():NativeProfile = NativeProfile.parse(request("/api/native/config"),origin)
    fun stage(event:JSONObject) {
        // Preserve current lifecycle ordering; report no success when the telemetry queue is full.
        if(!queue.offer(event)) {queue.poll();queue.offer(event)}
    }
    private fun flush() {
        val event=queue.peek() ?: return
        runCatching {request("/api/native/stage",event)}.onSuccess{queue.poll()}
    }
    private fun request(path:String,body:JSONObject?=null):JSONObject {
        val conn=URL(origin+path).openConnection() as HttpsURLConnection
        try {
            conn.connectTimeout=8000;conn.readTimeout=8000;conn.instanceFollowRedirects=false
            conn.setRequestProperty("Authorization","Bearer $probeToken")
            conn.setRequestProperty("Cache-Control","no-store")
            if(body!=null) {
                conn.requestMethod="POST";conn.doOutput=true;conn.setRequestProperty("Content-Type","application/json")
                conn.outputStream.use{it.write(body.toString().toByteArray())}
            }
            check(conn.responseCode==200) {"Native API недоступен (${conn.responseCode})"}
            val text=conn.inputStream.use{String(it.readNBytesCompat(65536),Charsets.UTF_8)}
            return JSONObject(text)
        } finally {conn.disconnect()}
    }
    override fun close(){worker.shutdownNow()}
}
fun java.io.InputStream.readNBytesCompat(limit:Int):ByteArray {
    val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(4096)
    while(true){val n=read(buffer);if(n<0)break;check(output.size()+n<=limit){"Response too large"};output.write(buffer,0,n)}
    return output.toByteArray()
}
