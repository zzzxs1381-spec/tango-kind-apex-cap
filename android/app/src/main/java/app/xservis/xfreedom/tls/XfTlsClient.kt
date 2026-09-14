package app.xservis.xfreedom.tls

import android.net.VpnService
import android.os.Build
import java.io.Closeable
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** One TCP stream per TLS connection: the framing protocol is shared with native-edge. */
class XfTlsClient(private val service: VpnService, private val profile: NativeProfile) : Closeable {
    private val sockets = ConcurrentHashMap.newKeySet<Socket>()
    private val random = SecureRandom()
    private val ticker = Executors.newSingleThreadScheduledExecutor()
    private val streams = ConcurrentHashMap.newKeySet<Stream>()
    private val uploaded = AtomicLong()
    private val downloaded = AtomicLong()
    @Volatile private var closed = false

    init {
        ticker.scheduleAtFixedRate({
            streams.forEach { stream ->
                runCatching { stream.ping() }.onFailure { stream.close() }
            }
        }, 15, 15, TimeUnit.SECONDS)
    }

    fun open(host: String, port: Int): Stream {
        val stream = handshake()
        return try {
            val bytes = host.toByteArray(Charsets.US_ASCII)
            require(bytes.size in 1..253 && host.matches(Regex("[a-zA-Z0-9.:-]+")) && port in 1..65535)
            val body = java.io.ByteArrayOutputStream()
            DataOutputStream(body).use { it.writeInt(1); it.writeShort(bytes.size); it.write(bytes); it.writeShort(port) }
            stream.send(1, body.toByteArray())
            val response = stream.next()
            check(response.first == 2 && response.second.size == 4 && DataInputStream(response.second.inputStream()).readInt() == 1) { "Edge отклонил TCP-соединение" }
            streams.add(stream)
            stream
        } catch (error: Throwable) { stream.close(); throw error }
    }

    fun check(): Double {
        val start = System.nanoTime()
        handshake().use { stream ->
            val nonce = ByteArray(8).also(random::nextBytes)
            stream.send(6, nonce)
            val answer = stream.next()
            check(answer.first == 7 && answer.second.contentEquals(nonce)) { "Проверка edge не пройдена" }
        }
        return (System.nanoTime() - start) / 1_000_000.0
    }

    private fun handshake(): Stream {
        check(!closed && Build.VERSION.SDK_INT >= 29) { "TLS 1.3 требует Android 10 или новее" }
        check(profile.expiresAt > System.currentTimeMillis() / 1000) { "Профиль истёк" }
        val raw = Socket()
        sockets.add(raw)
        try {
            check(service.protect(raw)) { "Не удалось защитить сокет туннеля" }
            raw.connect(InetSocketAddress(profile.host, profile.port), 10_000)
            raw.soTimeout = 10_000
            val trust = object : X509TrustManager {
                override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
                override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) = throw java.security.cert.CertificateException("Client certificates unsupported")
                override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
                    if (chain.isEmpty()) throw java.security.cert.CertificateException("Empty certificate chain")
                    chain[0].checkValidity()
                    val actual = MessageDigest.getInstance("SHA-256").digest(chain[0].encoded)
                    if (!MessageDigest.isEqual(actual, profile.pin)) throw java.security.cert.CertificateException("Certificate pin mismatch")
                }
            }
            val context = SSLContext.getInstance("TLSv1.3")
            context.init(null, arrayOf<TrustManager>(trust), random)
            val tls = context.socketFactory.createSocket(raw, profile.sni, profile.port, true) as SSLSocket
            sockets.add(tls)
            tls.enabledProtocols = arrayOf("TLSv1.3")
            tls.sslParameters = tls.sslParameters.apply {
                serverNames = listOf(SNIHostName(profile.sni))
                applicationProtocols = arrayOf("xf-tls1")
            }
            tls.startHandshake()
            check(tls.session.protocol == "TLSv1.3" && tls.applicationProtocol == "xf-tls1") { "Неверный TLS/ALPN" }
            val stream = Stream(tls, raw)
            stream.output.write(("AUTH " + profile.authToken + "\n").toByteArray(Charsets.US_ASCII))
            stream.output.flush()
            check(stream.input.readByte().toInt() == 79 && stream.input.readByte().toInt() == 75 && stream.input.readByte().toInt() == 10) { "Edge не подтвердил AUTH" }
            tls.soTimeout = 45_000
            if (closed) { stream.close(); error("Отменено") }
            return stream
        } catch (error: Throwable) { sockets.remove(raw); raw.close(); throw error }
    }

    fun stats(): Pair<Long, Long> = uploaded.get() to downloaded.get()
    override fun close() {
        closed = true
        ticker.shutdownNow()
        streams.toList().forEach { it.close() }
        sockets.toList().forEach { runCatching { it.close() } }
        sockets.clear()
    }

    inner class Stream(private val socket: SSLSocket, private val raw: Socket) : Closeable {
        val input = DataInputStream(socket.inputStream)
        val output = DataOutputStream(socket.outputStream)
        @Volatile private var stopped = false
        private var pendingPing: ByteArray? = null
        private var pingAt = 0L
        @Synchronized fun send(type: Int, payload: ByteArray) {
            check(!stopped && payload.size <= 65535)
            output.writeInt(payload.size + 1); output.writeByte(type); output.write(payload); output.flush()
        }
        @Synchronized fun ping() {
            if (pendingPing != null) {
                check(System.nanoTime() - pingAt < 30_000_000_000L) { "PONG timeout" }
                return
            }
            pendingPing = ByteArray(8).also(random::nextBytes)
            pingAt = System.nanoTime()
            send(6, pendingPing!!)
        }
        fun next(): Pair<Int, ByteArray> {
            val length = input.readInt()
            check(length in 1..65536) { "Неверная длина frame" }
            val type = input.readUnsignedByte()
            check(type in 1..7) { "Неизвестный тип frame" }
            val payload = ByteArray(length - 1); input.readFully(payload)
            return type to payload
        }
        fun write(data: ByteArray, size: Int) {
            require(size in 1..16384)
            val bytes = java.nio.ByteBuffer.allocate(size + 4).putInt(1).put(data, 0, size).array()
            send(4, bytes); uploaded.addAndGet(size.toLong())
        }
        fun finishOutput() = send(5, byteArrayOf(0,0,0,1))
        fun copyTo(destination: java.io.OutputStream) {
            while (!stopped) {
                val (type, payload) = next()
                when(type) {
                    4 -> {
                        check(payload.size in 5..16388 && java.nio.ByteBuffer.wrap(payload).int == 1)
                        destination.write(payload, 4, payload.size - 4)
                        destination.flush()
                        downloaded.addAndGet((payload.size - 4).toLong())
                    }
                    5 -> {check(payload.contentEquals(byteArrayOf(0,0,0,1))); return}
                    6 -> {check(payload.size <= 32); send(7, payload)}
                    7 -> synchronized(this) {
                        check(payload.size <= 32 && pendingPing?.contentEquals(payload) == true) { "Unexpected PONG" }
                        pendingPing = null
                    }
                    else -> error("Неожиданный frame")
                }
            }
        }
        override fun close() {
            stopped = true; streams.remove(this); sockets.remove(socket); sockets.remove(raw)
            runCatching { socket.close() }; runCatching { raw.close() }
        }
    }
}
