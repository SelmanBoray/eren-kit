// Saf Kotlin çekirdek: Android eklentisi yok, android.jar yok. Kurallar: ../../../TASARIM.md.
pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "eren-cekirdek"
