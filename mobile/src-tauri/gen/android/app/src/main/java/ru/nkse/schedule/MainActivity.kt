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
 * вырез измеряется здесь при каждом изменении (поворот, складывание,
 * смена ориентации) и отдаётся в WebView. Страница сама решает, что
 * продлить под камеру — шапку или фон, — поэтому статичного кружка нет.
 */
class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var cutoutTopDp = 0f
  private var cutoutLeftDp = 0f
  private var cutoutRightDp = 0f
  private var cutoutBottomDp = 0f

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

    // Слушаем вырез на корне окна: значения нужны и до загрузки страницы
    // (для моста NKSEInsets), и после каждого поворота/изменения окна.
    val root = window.decorView
    ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      val density = resources.displayMetrics.density
      cutoutTopDp = cutout.top / density
      cutoutLeftDp = cutout.left / density
      cutoutRightDp = cutout.right / density
      cutoutBottomDp = cutout.bottom / density
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

  /** Отдаёт странице вырез в dp по всем четырём сторонам. */
  private fun pushCutout() {
    val view = webView ?: return
    val top = cutoutTopDp
    val left = cutoutLeftDp
    val right = cutoutRightDp
    val bottom = cutoutBottomDp
    view.post {
      view.evaluateJavascript(
        "window.__nkseApplyCutout && window.__nkseApplyCutout($top,$left,$right,$bottom)",
        null
      )
    }
  }

  inner class CutoutBridge {
    @JavascriptInterface
    fun top(): Float = cutoutTopDp

    @JavascriptInterface
    fun left(): Float = cutoutLeftDp

    @JavascriptInterface
    fun right(): Float = cutoutRightDp

    @JavascriptInterface
    fun bottom(): Float = cutoutBottomDp
  }

  private fun hideSystemBars() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.hide(WindowInsetsCompat.Type.systemBars())
    controller.systemBarsBehavior =
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
  }
}
