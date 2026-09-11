// XFreedom integration; derivative distribution retains the upstream GPL notices.
package io.nekohasekai.sfa.vendor

import android.app.Activity
import androidx.camera.core.ImageAnalysis
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import io.nekohasekai.sfa.compose.screen.qrscan.QRCodeCropArea

object Vendor : VendorInterface {
    override val hasCustomUpdate = false

    override fun checkUpdate(activity: Activity, byUser: Boolean) {
        if (byUser) activity.runOnUiThread {
            MaterialAlertDialogBuilder(activity)
                .setTitle("XFreedom")
                .setMessage("Автообновление этой тестовой сборки ещё не подключено. Устанавливайте обновления XFreedom из того же источника.")
                .setPositiveButton(android.R.string.ok, null)
                .show()
        }
    }

    override fun createQRCodeAnalyzer(
        onSuccess: (String) -> Unit,
        onFailure: (Exception) -> Unit,
        onCropArea: ((QRCodeCropArea?) -> Unit)?,
    ): ImageAnalysis.Analyzer? = null
}
