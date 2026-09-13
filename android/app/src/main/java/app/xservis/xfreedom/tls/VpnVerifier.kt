package app.xservis.xfreedom.tls

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Process
import org.json.JSONObject
import java.net.URI
import java.net.URL
import java.security.SecureRandom
import javax.net.ssl.HttpsURLConnection

data class TunnelEvidence(val tunInterfaceUp:Boolean=false,val dnsOk:Boolean=false,val internetOk:Boolean=false,val engineHealthy:Boolean=false) {
    val connected:Boolean get()=tunInterfaceUp && dnsOk && internetOk && engineHealthy
    fun json()=JSONObject().put("tunInterfaceUp",tunInterfaceUp).put("dnsOk",dnsOk).put("internetOk",internetOk).put("engineHealthy",engineHealthy)
}
object VpnVerifier {
    fun network(context:Context):Network? {
        val manager=context.getSystemService(ConnectivityManager::class.java)
        return manager.allNetworks.firstOrNull {network->
            val caps=manager.getNetworkCapabilities(network)
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN)==true &&
                (Build.VERSION.SDK_INT<30 || caps.ownerUid==Process.myUid())
        }
    }
    fun verify(context:Context,origin:String,tunUp:Boolean,health:()->Boolean):TunnelEvidence {
        val vpn=network(context) ?: return TunnelEvidence(tunUp)
        if(!tunUp || !health())return TunnelEvidence(tunUp)
        val nonce=ByteArray(16).also(SecureRandom()::nextBytes).joinToString(""){"%02x".format(it)}
        val dns=runCatching{vpn.getAllByName(URI(origin).host).isNotEmpty()}.getOrDefault(false)
        val internet=if(dns)runCatching {
            val conn=vpn.openConnection(URL("$origin/api/native/verify?nonce=$nonce")) as HttpsURLConnection
            try {
                conn.connectTimeout=8000;conn.readTimeout=8000;conn.instanceFollowRedirects=false
                conn.setRequestProperty("Cache-Control","no-store")
                check(conn.responseCode==200)
                val json=JSONObject(conn.inputStream.use{String(it.readNBytesCompat(4096),Charsets.UTF_8)})
                json.optBoolean("ok") && json.optString("nonce")==nonce
            }finally{conn.disconnect()}
        }.getOrDefault(false) else false
        return TunnelEvidence(tunUp,dns,internet,health() && network(context)==vpn)
    }
}
