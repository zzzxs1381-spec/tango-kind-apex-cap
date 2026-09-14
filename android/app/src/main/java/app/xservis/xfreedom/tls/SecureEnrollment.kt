package app.xservis.xfreedom.tls

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

object SecureEnrollment {
    private const val ALIAS="xfreedom-native-enrollment-v1"
    private fun key():SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey(ALIAS,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(context:Context,enrollment:JSONObject) {
        val origin=enrollment.getString("apiOrigin").trimEnd('/')
        NativeApi(origin,enrollment.getString("probeToken")).close()
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key())
        val data=cipher.doFinal(enrollment.toString().toByteArray())
        check(context.getSharedPreferences("native_enrollment",Context.MODE_PRIVATE).edit()
            .putString("iv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP))
            .putString("data",Base64.encodeToString(data,Base64.NO_WRAP)).commit())
    }
    fun load(context:Context):JSONObject? {
        val prefs=context.getSharedPreferences("native_enrollment",Context.MODE_PRIVATE)
        val data=prefs.getString("data",null)?:return null
        val iv=prefs.getString("iv",null)?:return null
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(iv,Base64.NO_WRAP)))
        return JSONObject(String(cipher.doFinal(Base64.decode(data,Base64.NO_WRAP)),Charsets.UTF_8))
    }
}
