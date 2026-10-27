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

val panelInstall = tasks.register<Exec>("panelInstall") {
    workingDir(projectDir)
    commandLine("node", rootProject.file("tools/extensions/frontend.mjs").absolutePath, "extension", projectDir.absolutePath)
    inputs.files("package.json", "package-lock.json")
    inputs.dir("vendor")
    outputs.dir(layout.projectDirectory.dir("node_modules/@devline/extension-devkit"))
    outputs.dir(layout.projectDirectory.dir("node_modules/@devline/ui-web"))
    outputs.dir(layout.projectDirectory.dir("node_modules/@devline/animgraph"))
    outputs.dir(layout.projectDirectory.dir("node_modules/@devline/game-render-web"))
}
val panelBuild = tasks.register<Exec>("panelBuild") {
    dependsOn(panelInstall)
    workingDir(rootProject.projectDir)
    commandLine("node", rootProject.file("tools/extensions/frontend.mjs").absolutePath, "panel", projectDir.absolutePath)
    inputs.dir("web")
    inputs.files("package.json", "package-lock.json")
    inputs.dir("vendor")
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
