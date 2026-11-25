package dev.eren.olcum.ajanda

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

/**
 * Dışa verilen dosyayı paylaşım hedeflerine (e-posta, mesajlaşma, Drive...) vermek için en küçük
 * sağlayıcı. Dışa açık değil; erişim yalnız paylaşım niyetinin verdiği geçici izinle olur.
 */
class PaylasimSaglayici : ContentProvider() {
    companion object {
        fun yetki(ctx: Context) = ctx.packageName + ".paylasim"
        fun klasor(ctx: Context) = File(ctx.cacheDir, "paylasim").apply { mkdirs() }
        fun uri(ctx: Context, f: File): Uri =
            Uri.Builder().scheme("content").authority(yetki(ctx)).appendPath(f.name).build()
    }

    private fun dosya(uri: Uri): File? {
        val ad = uri.lastPathSegment ?: return null
        if (ad.contains('/') || ad.contains("..")) return null
        val f = File(klasor(context!!), ad)
        return if (f.isFile) f else null
    }

    override fun onCreate() = true

    override fun getType(uri: Uri) = "text/plain"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val f = dosya(uri) ?: throw java.io.FileNotFoundException(uri.toString())
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(uri: Uri, projection: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor {
        val f = dosya(uri)
        val sutunlar = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val c = MatrixCursor(sutunlar)
        if (f != null) {
            c.addRow(sutunlar.map {
                when (it) {
                    OpenableColumns.DISPLAY_NAME -> f.name
                    OpenableColumns.SIZE -> f.length()
                    else -> null
                }
            })
        }
        return c
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}
