package ru.nkse.schedule

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Полноэкранная оболочка. Камера в экране не «съедает» верх страницы:
 * вырез измеряется здесь и отдаётся в WebView, а каждая страница сайта
 * сама продлевает свою шапку под камеру и опускает содержимое ниже неё.
 */
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var cutoutTopDp = 0f

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Разрешаем окну рисовать в зоне выреза — иначе Android оставит
    // сверху чёрную полосу и страница не сможет её перекрыть.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }

    hideSystemBars()

    // Слушаем вырез на корне окна: значение нужно и до загрузки страницы
    // (для моста NKSEInsets), и после поворота экрана.
    val root = window.decorView
    ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      cutoutTopDp = cutout.top / resources.displayMetrics.density
      pushCutout()
      insets
    }
    ViewCompat.requestApplyInsets(root)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.setBackgroundColor(Color.BLACK)
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    // Мост для раннего чтения выреза из CSS/JS страницы.
    webView.addJavascriptInterface(CutoutBridge(), "NKSEInsets")
    pushCutout()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  /** Отдаёт странице высоту выреза в dp. */
  private fun pushCutout() {
    val view = webView ?: return
    val dp = cutoutTopDp
    view.post {
      view.evaluateJavascript(
        "window.__nkseApplyCutout && window.__nkseApplyCutout($dp)",
        null
      )
    }
  }

  inner class CutoutBridge {
    @JavascriptInterface
    fun top(): Float = cutoutTopDp
  }

  private fun hideSystemBars() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.hide(WindowInsetsCompat.Type.systemBars())
    controller.systemBarsBehavior =
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
  }
}
