import java.security.MessageDigest

plugins { kotlin("jvm") }

dependencies {
    compileOnly(project(":devline-ide-extensions"))
    compileOnly(project(":devline-api"))
    implementation(project(":devline-audio-core"))
    implementation("com.google.code.gson:gson:2.13.2")
    testImplementation(project(":devline-ide-extensions"))
    testImplementation(project(":devline-api"))
}

val panelBuild = tasks.register<Exec>("panelBuild") {
    workingDir(rootProject.projectDir)
    commandLine("node", "node_modules/vite/bin/vite.js", "build", "--config", project.file("web/vite.config.ts").absolutePath, "--outDir", layout.buildDirectory.dir("panel").get().asFile.absolutePath)
    inputs.dir("web")
    inputs.dir(rootProject.file("devline-ui-web/src"))
    outputs.dir(layout.buildDirectory.dir("panel"))
}
val prepareExtension = tasks.register<Exec>("prepareExtension") {
    dependsOn(panelBuild, ":devline-audio-engine:nativeBuild", tasks.jar)
    workingDir(rootProject.projectDir)
    val nativeBuild = project(":devline-audio-engine").layout.buildDirectory
    commandLine("node", project.file("web/pack.mjs").absolutePath, layout.buildDirectory.dir("panel").get().asFile.absolutePath, layout.buildDirectory.dir("extension-payload").get().asFile.absolutePath, nativeBuild.dir("native/bin").get().asFile.absolutePath)
    inputs.file("web/pack.mjs")
    inputs.file("src/main/resources/devline/soundstudio/branding/icon.png")
    inputs.file("src/main/resources/devline/soundstudio/branding/file-dlmusic.png")
    inputs.file("src/main/resources/devline/soundstudio/extension.json")
    inputs.dir(layout.buildDirectory.dir("panel"))
    inputs.dir(nativeBuild.dir("native/bin"))
    inputs.dir(nativeBuild.dir("native/licenses"))
    outputs.dir(layout.buildDirectory.dir("extension-payload"))
}
val extensionArchive = tasks.register<Zip>("extensionArchive") {
    group = "distribution"
    dependsOn(prepareExtension)
    archiveFileName.set("devline-sound-studio-0.1.8.dlextension")
    destinationDirectory.set(layout.buildDirectory.dir("extension"))
    from(prepareExtension)
    into("lib") {
        from(tasks.jar)
        from(configurations.runtimeClasspath) { exclude("kotlin-stdlib-*.jar", "annotations-*.jar", "error_prone_annotations-*.jar") }
    }
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

configurations.create("bundledExtension") {
    isCanBeConsumed = true
    isCanBeResolved = false
}
artifacts.add("bundledExtension", extensionArchive)

tasks.register<JavaExec>("documentToolsCheck") {
    group = "verification"
    dependsOn(tasks.testClasses)
    classpath = sourceSets.test.get().runtimeClasspath
    mainClass.set("devline.audio.studio.SoundStudioDocumentsCheckKt")
}
