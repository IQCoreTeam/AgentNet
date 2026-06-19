package com.iqlabs.agentnet

import android.content.Intent
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

// Owns the Google Identity Services authorization boundary. Node/proot never receives a
// client secret; it asks the Android side for short-lived Drive access tokens over the
// loopback token server. User consent is launched only through the Activity result path.
class GoogleDriveAuth(
    private val activity: AppCompatActivity,
    private val launcher: ActivityResultLauncher<IntentSenderRequest>,
) {
    companion object {
        private const val TAG = "AgentNet/GoogleDrive"
        private const val DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
        private const val AUTHORIZE_TIMEOUT_SECONDS = 30L
        private const val RESOLUTION_TIMEOUT_SECONDS = 180L
    }

    sealed class TokenResult {
        data class Token(val value: String) : TokenResult()
        data class Error(val status: Int, val message: String) : TokenResult()
    }

    @Volatile private var pendingResolution: CompletableFuture<AuthorizationResult>? = null

    fun accessToken(interactive: Boolean): TokenResult {
        return try {
            val request = AuthorizationRequest.builder()
                .setRequestedScopes(listOf(Scope(DRIVE_FILE_SCOPE)))
                .build()
            val result = Tasks.await(
                Identity.getAuthorizationClient(activity).authorize(request),
                AUTHORIZE_TIMEOUT_SECONDS,
                TimeUnit.SECONDS,
            )
            tokenFrom(result, interactive)
        } catch (e: Exception) {
            Log.w(TAG, "authorization failed", e)
            TokenResult.Error(500, e.message ?: "Google Drive authorization failed.")
        }
    }

    fun handleResolution(data: Intent?) {
        val future = pendingResolution
        if (future == null) {
            Log.w(TAG, "dropping Google auth resolution with no pending request")
            return
        }
        if (data == null) {
            future.completeExceptionally(IllegalStateException("Google Drive approval was canceled."))
            return
        }
        try {
            future.complete(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data))
        } catch (e: Exception) {
            future.completeExceptionally(e)
        }
    }

    private fun tokenFrom(result: AuthorizationResult, interactive: Boolean): TokenResult {
        if (result.hasResolution()) {
            val pendingIntent = result.pendingIntent
                ?: return TokenResult.Error(409, "Google Drive approval is required.")
            if (!interactive) {
                return TokenResult.Error(409, "Google Drive approval is required.")
            }
            return resolveWithUser(pendingIntent)
        }
        val token = result.accessToken
        if (token.isNullOrBlank()) {
            return TokenResult.Error(500, "Google Drive authorization did not return an access token.")
        }
        return TokenResult.Token(token)
    }

    private fun resolveWithUser(pendingIntent: android.app.PendingIntent): TokenResult {
        val future = CompletableFuture<AuthorizationResult>()
        synchronized(this) {
            if (pendingResolution != null) {
                return TokenResult.Error(409, "Google Drive approval is already in progress.")
            }
            pendingResolution = future
        }
        return try {
            activity.runOnUiThread {
                launcher.launch(IntentSenderRequest.Builder(pendingIntent.intentSender).build())
            }
            tokenFrom(future.get(RESOLUTION_TIMEOUT_SECONDS, TimeUnit.SECONDS), interactive = false)
        } catch (e: Exception) {
            Log.w(TAG, "approval failed", e)
            TokenResult.Error(409, e.message ?: "Google Drive approval was not completed.")
        } finally {
            synchronized(this) {
                if (pendingResolution === future) pendingResolution = null
            }
        }
    }
}
