package com.iqlabs.agentnet

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Encrypted-at-rest store for the wallet connect result: the account pubkey + the signature
// over the FIXED session-key message. Persisting these lets the app SILENTLY reconnect on a
// fresh process — re-deriving the (still memory-only) session key from the replayed signature
// — instead of relaunching the wallet app for another signature on every restart (the
// rotate/background/return-from-wallet "버벅임").
//
// What this is NOT: the wallet's private key (that never leaves the wallet). The stored
// signature is over an app-specific message, can't authorize any on-chain action, and only
// derives the chat-log encryption key — same data exposure as the session key itself.
//
// At rest the blob is AES/GCM-encrypted under a hardware-backed AndroidKeyStore key, so the
// plaintext signature never lands in normal app storage. clear() (explicit disconnect) wipes it.
class WalletVault(context: Context) {
    companion object {
        private const val TAG = "AgentNet/WalletVault"
        private const val PREFS = "agentnet.wallet.vault"
        private const val KEY_ALIAS = "agentnet.wallet.vault.key"
        private const val BLOB = "creds" // base64(iv || ciphertext+gcmTag)
        private const val GCM_TAG_BITS = 128
        private const val IV_LEN = 12
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // The AES key lives in the AndroidKeyStore (TEE / StrongBox where available); we never
    // see its bytes. Created on first use, reused after.
    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                // no setUserAuthenticationRequired: we want silent decrypt on launch, no biometric prompt.
                .build(),
        )
        return gen.generateKey()
    }

    // Persist {pubkey, signature} (raw bytes) encrypted. Best-effort: a keystore failure must
    // never break connect, so callers ignore the outcome.
    fun save(pubkey: ByteArray, signature: ByteArray) {
        try {
            val plain = JSONObject()
                .put("pubkey", Base64.encodeToString(pubkey, Base64.NO_WRAP))
                .put("signature", Base64.encodeToString(signature, Base64.NO_WRAP))
                .toString()
                .toByteArray(Charsets.UTF_8)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val iv = cipher.iv
            val ct = cipher.doFinal(plain)
            val blob = ByteArray(iv.size + ct.size)
            System.arraycopy(iv, 0, blob, 0, iv.size)
            System.arraycopy(ct, 0, blob, iv.size, ct.size)
            prefs.edit().putString(BLOB, Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
        } catch (e: Exception) {
            Log.w(TAG, "save failed; silent reconnect won't be available", e)
        }
    }

    // {pubkey, signature} if present and decryptable, else null (→ caller does a fresh connect).
    fun load(): Pair<ByteArray, ByteArray>? {
        return try {
            val b64 = prefs.getString(BLOB, null) ?: return null
            val blob = Base64.decode(b64, Base64.NO_WRAP)
            if (blob.size <= IV_LEN) return null
            val iv = blob.copyOfRange(0, IV_LEN)
            val ct = blob.copyOfRange(IV_LEN, blob.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            val obj = JSONObject(String(cipher.doFinal(ct), Charsets.UTF_8))
            Pair(
                Base64.decode(obj.getString("pubkey"), Base64.NO_WRAP),
                Base64.decode(obj.getString("signature"), Base64.NO_WRAP),
            )
        } catch (e: Exception) {
            Log.w(TAG, "load failed; will require a fresh wallet connect", e)
            null
        }
    }

    fun clear() {
        prefs.edit().remove(BLOB).apply()
    }
}
