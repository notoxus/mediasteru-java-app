package com.mediasteru.companion

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

/** Talks to the desktop MediaSteru's local HTTP server. */
object PcClient {

    private const val PREFS = "companion"
    private const val KEY_HOST = "pc_host"
    const val PORT = 8765

    fun getHost(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_HOST, "") ?: ""

    fun saveHost(context: Context, host: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_HOST, host.trim()).apply()
    }

    /** GET /ping — returns true if the desktop app answered. Blocking; call off the main thread. */
    fun ping(host: String): Boolean = try {
        val conn = URI("http://$host:$PORT/ping").toURL().openConnection() as HttpURLConnection
        conn.connectTimeout = 3000
        conn.readTimeout = 3000
        val ok = conn.responseCode == 200 &&
                conn.inputStream.bufferedReader().readText().contains("MediaSteru")
        conn.disconnect()
        ok
    } catch (e: Exception) {
        false
    }

    /** POST /add with {"url": ...}. Blocking; call off the main thread. */
    fun sendLink(host: String, url: String): Boolean = try {
        val conn = URI("http://$host:$PORT/add").toURL().openConnection() as HttpURLConnection
        conn.connectTimeout = 4000
        conn.readTimeout = 4000
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use {
            it.write(JSONObject().put("url", url).toString().toByteArray())
        }
        val ok = conn.responseCode == 200
        conn.disconnect()
        ok
    } catch (e: Exception) {
        false
    }

    /** Pulls the first http(s) URL out of shared text (share sheets often add extra words). */
    fun extractUrl(text: String): String? =
        Regex("https?://\\S+").find(text)?.value
}
