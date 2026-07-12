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
class NativeProbeActivity : AppCompatActivity() {
    private lateinit var out: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runCatching { NativeProbe.selfCheck() }
            .onSuccess { Log.i(NativeProbe.TAG, "argv selfCheck OK") }
            .onFailure { Log.e(NativeProbe.TAG, "argv selfCheck FAILED", it) }

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

        runSweep()
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
