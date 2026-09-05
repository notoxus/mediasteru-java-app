package com.mediasteru.companion

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

/**
 * Invisible activity that receives links from the Android Share sheet,
 * forwards them to the PC, shows a toast, and finishes immediately.
 */
class ShareActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val shared = intent?.takeIf { it.action == Intent.ACTION_SEND }
            ?.getStringExtra(Intent.EXTRA_TEXT)
        val url = shared?.let { PcClient.extractUrl(it) }

        if (url == null) {
            Toast.makeText(this, R.string.no_link_found, Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val host = PcClient.getHost(this)
        if (host.isEmpty()) {
            Toast.makeText(this, R.string.setup_first, Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }

        Toast.makeText(this, R.string.sending, Toast.LENGTH_SHORT).show()
        thread {
            val ok = PcClient.sendLink(host, url)
            runOnUiThread {
                Toast.makeText(
                    this,
                    if (ok) R.string.sent_ok else R.string.sent_fail,
                    Toast.LENGTH_LONG
                ).show()
                finish()
            }
        }
    }
}
