package app.xservis.xfreedom.tls

import java.io.Closeable
import java.io.DataInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.Executors

/** Loopback-only, per-engine authenticated SOCKS5 CONNECT. UDP ASSOCIATE is rejected. */
class LoopbackSocks(private val tls: XfTlsClient) : Closeable {
    private val random = SecureRandom()
    val username = ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }
    val password = ByteArray(24).also(random::nextBytes).joinToString("") { "%02x".format(it) }
    private val server = ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = server.localPort
    private val clients = ConcurrentHashMap.newKeySet<Socket>()
    private val permits = Semaphore(48)
    private val workers = Executors.newCachedThreadPool()
    @Volatile private var closed = false

    init {
        workers.execute {
            while (!closed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                if (!permits.tryAcquire()) { socket.close(); continue }
                clients.add(socket)
                workers.execute { try { serve(socket) } finally {clients.remove(socket); socket.close(); permits.release()} }
            }
        }
    }
    private fun serve(socket: Socket) {
        runCatching {
            socket.soTimeout = 10000
            val input = DataInputStream(socket.inputStream); val output = socket.outputStream
            check(input.readUnsignedByte() == 5)
            val methods = ByteArray(input.readUnsignedByte()); input.readFully(methods)
            if (!methods.contains(2.toByte())) { output.write(byteArrayOf(5,-1)); return }
            output.write(byteArrayOf(5,2)); output.flush()
            check(input.readUnsignedByte() == 1)
            val user = ByteArray(input.readUnsignedByte()); input.readFully(user)
            val pass = ByteArray(input.readUnsignedByte()); input.readFully(pass)
            val accepted = MessageDigest.isEqual(user,username.toByteArray()) && MessageDigest.isEqual(pass,password.toByteArray())
            output.write(byteArrayOf(1,if(accepted) 0 else 1)); output.flush(); check(accepted)
            check(input.readUnsignedByte() == 5)
            val command=input.readUnsignedByte(); check(input.readUnsignedByte()==0)
            val host=when(input.readUnsignedByte()) {
                1 -> ByteArray(4).also(input::readFully).joinToString(".") { (it.toInt() and 255).toString() }
                3 -> ByteArray(input.readUnsignedByte()).also(input::readFully).toString(Charsets.US_ASCII)
                else -> { output.write(reply(8)); return }
            }
            val port=input.readUnsignedShort()
            if(command!=1) { output.write(reply(7)); return }
            val stream=runCatching {tls.open(host,port)}.getOrElse {output.write(reply(5)); return}
            stream.use {
                output.write(reply(0));output.flush(); socket.soTimeout=0
                val upload=workers.submit {
                    try {
                        val buffer=ByteArray(16384)
                        while(true) {val n=input.read(buffer); if(n<0) break; if(n>0)stream.write(buffer,n)}
                        stream.finishOutput()
                    } catch (_:Exception) {stream.close()}
                }
                try { stream.copyTo(output); runCatching { socket.shutdownOutput() }; upload.get(10,java.util.concurrent.TimeUnit.SECONDS) }
                finally {socket.close();upload.cancel(true)}
            }
        }
    }
    private fun reply(code:Int)=byteArrayOf(5,code.toByte(),0,1,0,0,0,0,0,0)
    override fun close() {
        closed=true;server.close();clients.toList().forEach{runCatching{it.close()}};workers.shutdownNow()
    }
}
