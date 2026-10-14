import groovy.json.JsonSlurper
import java.io.File
import java.util.Base64

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val dartDefines =
    (project.findProperty("dart-defines") as String?)
        ?.split(",")
        ?.mapNotNull { encoded ->
            runCatching {
                String(Base64.getDecoder().decode(encoded), Charsets.UTF_8)
            }.getOrNull()
        }
        .orEmpty()
val umiEnvironment =
    dartDefines.firstOrNull { it.startsWith("UMIPOS_ENVIRONMENT=") }?.substringAfter("=")
val flutterFlavor =
    dartDefines.firstOrNull { it.startsWith("FLUTTER_APP_FLAVOR=") }?.substringAfter("=")
val requestedFlavor =
    listOf("development", "staging", "production").singleOrNull { flavor ->
        gradle.startParameter.taskNames.any { task ->
            task.contains(flavor, ignoreCase = true)
        }
    }
val selectedFlavor = flutterFlavor ?: requestedFlavor
if (selectedFlavor != null && umiEnvironment != selectedFlavor) {
    throw GradleException(
        "Android flavor $selectedFlavor requires UMIPOS_ENVIRONMENT=$selectedFlavor."
    )
}
if (umiEnvironment in setOf("staging", "production") && selectedFlavor != umiEnvironment) {
    throw GradleException(
        "UMIPOS_ENVIRONMENT=$umiEnvironment requires --flavor $umiEnvironment."
    )
}
if (selectedFlavor in setOf("staging", "production")) {
    val firebaseFile = file("src/$selectedFlavor/google-services.json")
    if (!firebaseFile.isFile) {
        throw GradleException("Missing Firebase config for Android flavor $selectedFlavor.")
    }
    val firebaseProject =
        ((JsonSlurper().parse(firebaseFile) as Map<*, *>)["project_info"] as? Map<*, *>)
            ?.get("project_id")
    val expectedProject =
        "umiconsulting-pos-${if (selectedFlavor == "production") "prod" else "staging"}"
    if (firebaseProject != expectedProject) {
        throw GradleException("Firebase project does not match Android flavor $selectedFlavor.")
    }
}

val releaseRequested = gradle.startParameter.taskNames.any { task ->
    task.contains("Release", ignoreCase = true)
}
val signingStorePath = System.getenv("UMIPOS_ANDROID_KEYSTORE_PATH")
val signingAlias = System.getenv("UMIPOS_ANDROID_KEY_ALIAS")
val signingStorePassword = System.getenv("UMIPOS_ANDROID_KEYSTORE_PASSWORD")
val signingKeyPassword = System.getenv("UMIPOS_ANDROID_KEY_PASSWORD")
if (releaseRequested) {
    if (listOf(signingStorePath, signingAlias, signingStorePassword, signingKeyPassword)
            .any { it.isNullOrBlank() }
    ) {
        throw GradleException("Android release signing requires all UMIPOS_ANDROID_KEY* variables.")
    }
    val store = File(signingStorePath!!)
    val repository = rootProject.projectDir.parentFile.parentFile.parentFile.canonicalFile
    if (!store.isAbsolute ||
        !store.isFile ||
        store.canonicalPath.startsWith(repository.path + File.separator)
    ) {
        throw GradleException("Android release keystore must exist outside the repository.")
    }
}

android {
    namespace = "co.umiconsulting.umi_pos"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        //
        // THE IDENTITY THE TILL IS ENROLLED UNDER IS A BUILD DECISION, NOT A
        // FORK OF THE TREE.
        //
        // The counter terminal at the café runs `co.umiconsulting.umi_pos.estacion`
        // — the estación identity the Linux runner also takes when
        // `UMIPOS_ESTACION_PREVIEW=1` (linux/CMakeLists.txt) — while a plain
        // `flutter build apk` is the generic app. That difference used to be a
        // hand-edited line inside a throwaway copy of the repository, which meant
        // the build that reached the device was not the tree anyone was reading:
        // the owner asked for one directory, so the id is a property now and both
        // builds come from here.
        //
        //   flutter build apk --profile --flavor development --target-platform android-arm64 \
        //     -PumiposApplicationId=co.umiconsulting.umi_pos.estacion
        applicationId =
            (project.findProperty("umiposApplicationId") as String?)
                ?: "co.umiconsulting.umi_pos"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    flavorDimensions += "environment"
    productFlavors {
        create("development") { dimension = "environment" }
        create("staging") { dimension = "environment" }
        create("production") { dimension = "environment" }
    }

    signingConfigs {
        create("umiRelease") {
            storeFile = signingStorePath?.let { File(it) }
            keyAlias = signingAlias
            storePassword = signingStorePassword
            keyPassword = signingKeyPassword
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("umiRelease")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
