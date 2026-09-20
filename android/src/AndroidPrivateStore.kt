package se.gitbsidian.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Private app preferences hold ciphertext; the AES key is non-exportable in Android Keystore. */
internal class AndroidPrivateStore(context: Context, suffix: String = "") : PrivateStore {
    private val prefs = context.getSharedPreferences("github-private$suffix", Context.MODE_PRIVATE)
    private val alias = "gitbsidian-github-v1$suffix"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(alias, null)
        if (existing != null) return existing as SecretKey
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    override fun read(name: String): JSONObject? {
        val encoded = prefs.getString(name, null) ?: return null
        val bytes = Base64.getDecoder().decode(encoded)
        require(bytes.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    }
    override fun write(name: String, value: JSONObject?) {
        val editor = prefs.edit()
        if (value == null) editor.remove(name) else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
            editor.putString(name, Base64.getEncoder().encodeToString(cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))))
        }
        if (!editor.commit()) throw BackendError(500, "credential-storage", "Inloggningen kunde inte sparas säkert på enheten.")
    }
}
