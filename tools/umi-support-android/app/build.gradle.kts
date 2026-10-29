import java.io.File

plugins { id("com.android.application") }

val storePath = System.getenv("UMI_SUPPORT_KEYSTORE_PATH")
val passwordPath = System.getenv("UMI_SUPPORT_KEYSTORE_PASSWORD_FILE")
val releaseRequested = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
if (releaseRequested) {
    require(!storePath.isNullOrBlank() && !passwordPath.isNullOrBlank()) {
        "Release requires an external signing store and password file."
    }
}

android {
    namespace = "co.umiconsulting.umi_support"
    compileSdk = 36
    defaultConfig {
        applicationId = "co.umiconsulting.umi_support"
        minSdk = 30
        targetSdk = 36
        versionCode = 2
        versionName = "1.0.1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    signingConfigs {
        create("supportRelease") {
            if (storePath != null && passwordPath != null) {
                require(File(storePath).isAbsolute && File(passwordPath).isAbsolute)
                val store = file(storePath)
                val password = file(passwordPath)
                val workspace = rootDir.resolve("../..").canonicalPath + "/"
                require(store.isFile && password.isFile)
                require(!store.canonicalPath.startsWith(workspace))
                require(!password.canonicalPath.startsWith(workspace))
                storeFile = store
                storePassword = password.readText().trim()
                keyAlias = "umi-support"
                keyPassword = storePassword
            }
        }
    }
    buildTypes {
        release {
            isDebuggable = false
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("supportRelease")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    lint {
        abortOnError = true
        warningsAsErrors = true
        lintConfig = rootProject.file("lint.xml")
    }
}
dependencies { testImplementation("junit:junit:4.13.2") }

// También protege las tareas agregadas y las abreviaturas de Gradle.
tasks.configureEach {
    if (name in listOf("packageRelease", "bundleRelease")) {
        doFirst {
            require(!storePath.isNullOrBlank() && !passwordPath.isNullOrBlank()) {
                "Release requires an external signing store and password file."
            }
        }
    }
}
