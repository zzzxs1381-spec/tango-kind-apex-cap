import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.zip.ZipInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val libXrayVersion = "v26.9.9"
val libXrayZipSha256 = "4998a8b56e4a78a164b5359d5690036f83da3b575465cea57ddf29c0149c345f"
val libXrayAar = layout.projectDirectory.file("libs/libXray.aar")

val fetchLibXray by tasks.registering {
    outputs.file(libXrayAar)
    doLast {
        val target = libXrayAar.asFile
        if (target.isFile) return@doLast

        val downloadDir = layout.buildDirectory.dir("downloads/libxray").get().asFile
        downloadDir.mkdirs()
        val archive = downloadDir.resolve("libxray-android-$libXrayVersion.zip")
        if (!archive.isFile) {
            val url = URI("https://github.com/XTLS/libXray/releases/download/$libXrayVersion/libxray-android.zip").toURL()
            url.openStream().use { input -> archive.outputStream().use { output -> input.copyTo(output) } }
        }

        val digest = MessageDigest.getInstance("SHA-256")
        archive.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        check(actual == libXrayZipSha256) {
            "libXray archive SHA-256 mismatch: $actual"
        }

        target.parentFile.mkdirs()
        var extracted = false
        ZipInputStream(archive.inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory && entry.name.substringAfterLast('/') == "libXray.aar") {
                    val temp = File(target.parentFile, target.name + ".tmp")
                    temp.outputStream().use { output -> zip.copyTo(output) }
                    check(temp.length() > 0) { "libXray.aar is empty" }
                    if (target.exists()) target.delete()
                    check(temp.renameTo(target)) { "Unable to install libXray.aar" }
                    extracted = true
                    break
                }
                zip.closeEntry()
            }
        }
        check(extracted && target.isFile) { "libXray.aar was not found in the verified release archive" }
        println("Verified libXray $libXrayVersion -> ${target.absolutePath}")
    }
}

tasks.configureEach {
    if (name == "preBuild") dependsOn(fetchLibXray)
}

android {
    namespace = "app.xservis.xfreedom"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.xservis.xfreedom"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0-alpha"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")

    // REALITY/VLESS production fallback. The pinned release archive is fetched
    // and SHA-256 verified by fetchLibXray before Android compilation.
    implementation(files("libs/libXray.aar"))

    // Compatibility backend only; it is not the default transport for Russia.
    implementation("com.wireguard.android:tunnel:1.0.20260102")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.3")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
}
