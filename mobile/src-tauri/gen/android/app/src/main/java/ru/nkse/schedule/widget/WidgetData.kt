package ru.nkse.schedule.widget

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class Lesson(
    val number: String,
    val time: String,
    val subject: String,
    val room: String,
    val teacher: String
)

data class ScheduleSnapshot(
    val groups: Map<String, Map<String, List<Lesson>>>,
    val updatedAt: Long,
    val offline: Boolean
)

/**
 * Данные для виджета: тот же schedule.json с GitHub, что и у сайта.
 * Кэш в filesDir — виджет работает и без сети, показывая последние данные.
 */
object WidgetData {
    private const val BASE = "https://clashroalyskachat-glitch.github.io/mypars/"
    private const val CACHE = "widget-schedule.json"
    private const val META_CACHE = "widget-meta.json"

    @Synchronized
    fun load(context: Context): ScheduleSnapshot? {
        val dir = context.filesDir
        val cache = File(dir, CACHE)
        val metaCache = File(dir, META_CACHE)
        var updatedAt = 0L

        try {
            val metaText = http(BASE + "schedule-meta.json?t=" + System.currentTimeMillis())
            if (metaText != null) {
                val meta = JSONObject(metaText)
                updatedAt = meta.optLong("updated_at", 0L)
                if (cache.exists() && metaCache.exists()) {
                    val cachedMeta = runCatching { JSONObject(metaCache.readText()) }.getOrNull()
                    if (cachedMeta != null && cachedMeta.optLong("updated_at", -1L) == updatedAt) {
                        val parsed = parse(cache.readText())
                        if (parsed != null) return ScheduleSnapshot(parsed, updatedAt, false)
                    }
                }
            }

            val text = http(BASE + "schedule.json?t=" + System.currentTimeMillis())
            if (text != null) {
                val parsed = parse(text)
                if (parsed != null) {
                    runCatching {
                        cache.writeText(text)
                        metaCache.writeText(JSONObject().put("updated_at", updatedAt).toString())
                    }
                    return ScheduleSnapshot(parsed, updatedAt, false)
                }
            }
        } catch (_: Exception) {
        }

        if (cache.exists()) {
            val parsed = runCatching { parse(cache.readText()) }.getOrNull()
            if (parsed != null) {
                val meta = runCatching { JSONObject(metaCache.readText()) }.getOrNull()
                return ScheduleSnapshot(parsed, meta?.optLong("updated_at", 0L) ?: 0L, true)
            }
        }
        return null
    }

    private fun http(url: String): String? {
        val conn = URL(url).openConnection() as HttpURLConnection
        return try {
            conn.connectTimeout = 8000
            conn.readTimeout = 15000
            conn.requestMethod = "GET"
            conn.setRequestProperty("Cache-Control", "no-cache")
            if (conn.responseCode !in 200..299) null
            else conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun parse(text: String): Map<String, Map<String, List<Lesson>>>? {
        return runCatching {
            val root = JSONObject(text)
            val out = LinkedHashMap<String, Map<String, List<Lesson>>>()
            for (group in root.keys()) {
                val daysObj = root.optJSONObject(group) ?: continue
                val days = LinkedHashMap<String, List<Lesson>>()
                for (day in daysObj.keys()) {
                    val arr = daysObj.optJSONArray(day) ?: continue
                    val lessons = ArrayList<Lesson>()
                    for (i in 0 until arr.length()) {
                        val o = arr.optJSONObject(i) ?: continue
                        lessons.add(
                            Lesson(
                                number = o.optString("number", ""),
                                time = o.optString("time", ""),
                                subject = o.optString("subject", ""),
                                room = o.optString("room", ""),
                                teacher = o.optString("teacher", "")
                            )
                        )
                    }
                    days[day] = lessons
                }
                out[group] = days
            }
            out
        }.getOrNull()
    }

    fun todayName(): String = when (Calendar.getInstance().get(Calendar.DAY_OF_WEEK)) {
        Calendar.MONDAY -> "Понедельник"
        Calendar.TUESDAY -> "Вторник"
        Calendar.WEDNESDAY -> "Среда"
        Calendar.THURSDAY -> "Четверг"
        Calendar.FRIDAY -> "Пятница"
        Calendar.SATURDAY -> "Суббота"
        else -> "Воскресенье"
    }

    fun nowMinutes(): Int {
        val c = Calendar.getInstance()
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
    }

    fun range(time: String): Pair<Int, Int>? {
        val m = Regex("(\\d{1,2})\\s*[:.]\\s*(\\d{2})\\s*[-–—]\\s*(\\d{1,2})\\s*[:.]\\s*(\\d{2})").find(time)
            ?: return null
        val (h1, m1, h2, m2) = m.destructured
        return (h1.toInt() * 60 + m1.toInt()) to (h2.toInt() * 60 + m2.toInt())
    }

    fun fmtTime(ms: Long): String {
        if (ms <= 0) return ""
        return SimpleDateFormat("dd.MM HH:mm", Locale("ru")).format(Date(ms))
    }
}
