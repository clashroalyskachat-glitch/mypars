package ru.nkse.schedule.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import ru.nkse.schedule.MainActivity
import ru.nkse.schedule.R

class ScheduleWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val pending = goAsync()
        Thread {
            try {
                val snapshot = WidgetData.load(context)
                for (id in appWidgetIds) {
                    render(context, appWidgetManager, id, snapshot)
                }
            } finally {
                pending.finish()
            }
        }.start()
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        appWidgetIds.forEach { prefs.edit().remove(groupKey(it)).apply() }
    }

    companion object {
        const val PREFS = "nkse_widget"

        fun groupKey(id: Int) = "group_$id"

        fun render(
            context: Context,
            manager: AppWidgetManager,
            id: Int,
            snapshot: ScheduleSnapshot?
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_schedule)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val group = prefs.getString(groupKey(id), "") ?: ""

            val open = Intent(context, MainActivity::class.java)
            val openPending = PendingIntent.getActivity(
                context,
                id,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, openPending)

            if (group.isBlank()) {
                views.setTextViewText(R.id.widget_group, "НКСЭ")
                views.setTextViewText(R.id.widget_status, "Выберите группу")
                views.setTextViewText(R.id.widget_subject, "Настройте виджет")
                views.setTextViewText(R.id.widget_time, "")
                views.setTextViewText(R.id.widget_more, "")
                views.setTextViewText(R.id.widget_updated, "")
                manager.updateAppWidget(id, views)
                return
            }

            views.setTextViewText(R.id.widget_group, group)

            if (snapshot == null) {
                views.setTextViewText(R.id.widget_status, "Нет данных")
                views.setTextViewText(R.id.widget_subject, "Откройте приложение с интернетом")
                views.setTextViewText(R.id.widget_time, "")
                views.setTextViewText(R.id.widget_more, "")
                views.setTextViewText(R.id.widget_updated, "")
                manager.updateAppWidget(id, views)
                return
            }

            val day = WidgetData.todayName()
            val lessons = snapshot.groups[group]?.get(day) ?: emptyList()
            val now = WidgetData.nowMinutes()
            val current = lessons.firstOrNull {
                val r = WidgetData.range(it.time)
                r != null && now in r.first..r.second
            }
            val next = lessons.firstOrNull {
                val r = WidgetData.range(it.time)
                r != null && r.first > now
            }
            val focus = current ?: next
            val following = lessons
                .filter { it !== focus }
                .filter {
                    val r = WidgetData.range(it.time)
                    r != null && r.first > now
                }
                .take(2)

            if (focus == null) {
                views.setTextViewText(R.id.widget_status, "На сегодня пар нет")
                views.setTextViewText(R.id.widget_subject, "")
                views.setTextViewText(R.id.widget_time, "")
                views.setTextViewText(R.id.widget_more, "")
            } else {
                views.setTextViewText(
                    R.id.widget_status,
                    if (current != null) "Сейчас идёт" else "Следующая пара"
                )
                views.setTextViewText(R.id.widget_subject, focus.subject.ifBlank { "—" })
                val room = focus.room.ifBlank { "" }
                views.setTextViewText(
                    R.id.widget_time,
                    if (room.isNotBlank()) "${focus.time} · каб. $room" else focus.time
                )
                views.setTextViewText(
                    R.id.widget_more,
                    following.joinToString("\n") { lesson ->
                        val r = WidgetData.range(lesson.time)
                        val start = r?.let { "%02d:%02d".format(it.first / 60, it.first % 60) }
                            ?: lesson.time
                        "$start · ${lesson.subject}"
                    }
                )
            }

            val stamp = if (snapshot.updatedAt > 0) {
                "данные от ${WidgetData.fmtTime(snapshot.updatedAt)}"
            } else ""
            views.setTextViewText(
                R.id.widget_updated,
                if (snapshot.offline) "офлайн · $stamp" else stamp
            )
            manager.updateAppWidget(id, views)
        }
    }
}
