package com.iqlabs.agentnet

import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

// T0 in-app probe screen (issue #115). Dev/diagnostic only — not in the boot flow, not a
// launcher icon. Reach it two ways on a test device:
//   adb shell am start -n com.iqlabs.agentnet/.NativeProbeActivity
//   long-press the boot logo (debug builds) — see MainActivity.
// It runs NativeProbe.sweep() (both linker routes, per binary) and dumps the report. Same text
// goes to logcat (tag AgentNet/Probe) so a run over adb needs no eyes on the phone.
//
// GUEST-SCRIPT MODE (issue #115 root-cause probes, e.g. probe9/probe10): pass
//   -e guestScript /root/probe10.sh
// and instead of the linker sweep it runs that script INSIDE proot via DirectProotExec. The key
// property: this Activity is the app process (SELinux untrusted_app), and a proot it spawns —
// and the git under it — inherit untrusted_app. That is the EXACT domain + proot path the bug
// needs (Zo's hard rule: run-as = runas_app does NOT reproduce). So this reproduces the git
// object-loss headless over adb, no in-app chat and no agent auth required:
//   adb shell am start -n com.iqlabs.agentnet/.NativeProbeActivity -e guestScript /root/probe10.sh
//   adb logcat -d AgentNet/Probe:I '*:S'      # full output, tee'd here
class NativeProbeActivity : AppCompatActivity() {
    private lateinit var out: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()

        val guestScript = intent.getStringExtra("guestScript")
        if (guestScript != null) { runGuestScript(guestScript); return }

        runCatching { NativeProbe.selfCheck() }
            .onSuccess { Log.i(NativeProbe.TAG, "argv selfCheck OK") }
            .onFailure { Log.e(NativeProbe.TAG, "argv selfCheck FAILED", it) }
        runSweep()
    }

    private fun buildUi() {

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val rerun = Button(this).apply {
            text = "Re-run probe"
            setOnClickListener { runSweep() }
        }
        out = TextView(this).apply {
            typeface = android.graphics.Typeface.MONOSPACE
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTextIsSelectable(true)
            text = "Running…"
        }
        root.addView(rerun, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply {
            gravity = Gravity.END
        })
        val scroll = ScrollView(this).apply { addView(out) }
        root.addView(scroll, LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(root, LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    }

    // Run a shell script inside the proot guest, spawned from THIS app process → the guest git
    // runs in untrusted_app (the domain that reproduces the #115 object-loss). Output is merged
    // (DirectProotExec sets redirectErrorStream) and tee'd to logcat + the screen.
    private fun runGuestScript(scriptPath: String) {
        out.text = "Running $scriptPath in guest…"
        val layout = Paths.layout(this)
        // Minimal guest env for git — mirrors the load-bearing bits of ServerManager.buildGuestEnv.
        val env = listOf(
            "HOME=/root", "USER=root",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "TERM=xterm-256color", "LANG=C.UTF-8", "TMPDIR=/tmp",
            "GLIBC_TUNABLES=glibc.pthread.rseq=0",
        )
        thread {
            val sb = StringBuilder()
            val text = runCatching {
                val proc = DirectProotExec(layout).launch(env, "sh '$scriptPath'; echo GUEST_EXIT=\$?")
                proc.inputStream.bufferedReader().forEachLine { sb.appendLine(it) }
                proc.waitFor()
                sb.toString().ifBlank { "(no output — script/guest produced nothing)" }
            }.getOrElse { "guest run crashed: ${it.message}\n${Log.getStackTraceString(it)}" }
            Log.i(NativeProbe.TAG, "\n=== guest $scriptPath ===\n$text")
            runOnUiThread { out.text = text }
        }
    }

    private fun runSweep() {
        out.text = "Running probe…"
        val rootfs = Paths.layout(this).rootfs
        thread {
            val text = runCatching { NativeProbe.format(NativeProbe.sweep(rootfs)) }
                .getOrElse { "probe crashed: ${it.message}\n${Log.getStackTraceString(it)}" }
            Log.i(NativeProbe.TAG, "\n$text")
            runOnUiThread { out.text = text }
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
