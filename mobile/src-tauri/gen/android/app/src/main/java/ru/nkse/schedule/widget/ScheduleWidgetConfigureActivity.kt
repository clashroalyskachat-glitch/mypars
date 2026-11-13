package ru.nkse.schedule.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import ru.nkse.schedule.R

class ScheduleWidgetConfigureActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        setContentView(R.layout.widget_config)

        widgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        val list = findViewById<ListView>(R.id.widget_config_list)
        val status = findViewById<TextView>(R.id.widget_config_status)
        status.text = "Загружаю группы…"

        Thread {
            val snapshot = WidgetData.load(this)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (snapshot == null) {
                    status.text = "Нет данных. Подключите интернет и попробуйте снова."
                    return@runOnUiThread
                }
                val groups = snapshot.groups.keys.sorted()
                status.text = "Выберите группу"
                list.adapter = ArrayAdapter(this, R.layout.widget_config_row, groups)
                list.setOnItemClickListener { _, _, position, _ ->
                    val group = groups[position]
                    getSharedPreferences(ScheduleWidgetProvider.PREFS, MODE_PRIVATE)
                        .edit()
                        .putString(ScheduleWidgetProvider.groupKey(widgetId), group)
                        .apply()
                    setResult(
                        RESULT_OK,
                        Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                    )
                    Thread {
                        ScheduleWidgetProvider.render(
                            this,
                            AppWidgetManager.getInstance(this),
                            widgetId,
                            snapshot
                        )
                    }.start()
                    finish()
                }
            }
        }.start()
    }
}
