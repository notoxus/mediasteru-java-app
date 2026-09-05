package com.mediasteru.companion

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

/** Settings screen: enter the PC's LAN IP once, test it, done. */
class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val pad = (16 * resources.displayMetrics.density).toInt()

        val title = TextView(this).apply {
            text = getString(R.string.setup_title)
            textSize = 20f
        }
        val hintView = TextView(this).apply {
            text = getString(R.string.setup_hint)
            setPadding(0, pad / 2, 0, pad)
        }
        val input = EditText(this).apply {
            hint = "192.168.1.10"
            setText(PcClient.getHost(this@MainActivity))
        }
        val status = TextView(this).apply { setPadding(0, pad / 2, 0, 0) }
        val saveBtn = Button(this).apply { text = getString(R.string.save_and_test) }

        saveBtn.setOnClickListener {
            val host = input.text.toString().trim()
            if (host.isEmpty()) {
                Toast.makeText(this, R.string.enter_ip_first, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            PcClient.saveHost(this, host)
            status.text = getString(R.string.testing)
            thread {
                val ok = PcClient.ping(host)
                runOnUiThread {
                    status.text = getString(if (ok) R.string.test_ok else R.string.test_fail)
                }
            }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
            addView(title)
            addView(hintView)
            addView(input)
            addView(saveBtn)
            addView(status)
        }
        setContentView(root)
    }
}
