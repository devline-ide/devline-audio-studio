package devline.audio.studio

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import devline.audio.MusicDocument
import devline.extensions.IdeExtensionContext
import java.nio.file.Files
import java.security.MessageDigest

/** Real filesystem compositions; the owned project bridge fixture enforces optimistic versions. No engine/device. */
fun main() {
    val root = Files.createTempDirectory("devline-music-authoring-")
    fun version(content: String) = MessageDigest.getInstance("SHA-256").digest(content.toByteArray()).joinToString("") { "%02x".format(it) }
    var guard = 0
    var nativeArtifacts = 0
    val context = object : IdeExtensionContext {
        override val profileDirectory = root.resolve("profile")
        override fun enabled() = true
        override fun nativeArtifact(id: String): String { nativeArtifacts++; error("No native engine is allowed in document authoring checks") }
        override fun projectRoot(projectFile: String) = root.toString().also { check(projectFile == "fixture") }
        override fun callProject(projectFile: String, method: String, arguments: JsonObject): JsonElement {
            check(projectFile == "fixture")
            val relative = if (method == "project.entry.create") listOf(arguments["parent"].asString, arguments["name"].asString).filter(String::isNotEmpty).joinToString("/") else arguments["path"].asString
            val file = root.resolve(relative)
            if (method == "project.entry.create") { check(!Files.exists(file)); Files.writeString(file, arguments["content"].asString) }
            if (method == "file.save") { check(version(Files.readString(file)) == arguments["expectedVersion"].asString); Files.writeString(file, arguments["content"].asString) }
            return JsonObject().apply { val content = Files.readString(file); addProperty("path", relative); addProperty("version", version(content)); addProperty("content", content); addProperty("writable", true); addProperty("truncated", false) }
        }
    }
    val documents = SoundStudioDocuments(context) { _, path, _ -> check(path == "Theme.dlmusic"); guard++ }
    fun args(json: String) = JsonParser.parseString(json).asJsonObject.apply { addProperty("expectedProjectFile", "fixture") }
    val created = documents.request("documentCreate", args("""{"path":"Theme.dlmusic","name":"Мелодия 😄"}"""))
    check(created["created"].asBoolean && MusicDocument.read(Files.readString(root.resolve("Theme.dlmusic"))).name == "Мелодия 😄")
    val before = Files.readString(root.resolve("Theme.dlmusic"))
    check(runCatching { documents.request("documentCreate", args("""{"path":"Theme.dlmusic"}""")) }.isFailure)
    val read = documents.request("documentRead", args("""{"path":"Theme.dlmusic","section":"notes","pattern":"pattern1","offset":0,"limit":1}"""))
    check(read.has("version") && read.getAsJsonArray("items").size() <= 1)
    val edit = args("""{"path":"Theme.dlmusic","expectedVersion":"${created["version"].asString}","patches":[{"op":"replace","path":"/tempos/0/bpm","value":128},{"op":"replace","path":"/name","value":"Готово"}]}""")
    val saved = documents.request("documentEdit", edit)
    check(guard == 1 && saved["version"].asString != created["version"].asString)
    check(MusicDocument.read(Files.readString(root.resolve("Theme.dlmusic"))).tempos.single().bpm == 128.0)
    check(runCatching { documents.request("documentEdit", edit) }.isFailure)
    val invalid = edit.deepCopy().apply { addProperty("expectedVersion", saved["version"].asString); add("patches", JsonParser.parseString("""[{"op":"replace","path":"/tempos/0/bpm","value":0}]""")) }
    val good = Files.readString(root.resolve("Theme.dlmusic"))
    val invalidError = runCatching { documents.request("documentEdit", invalid) }.exceptionOrNull()!!
    check(invalidError.message!!.contains("BPM must be 20..999") && Files.readString(root.resolve("Theme.dlmusic")) == good)
    val wrongIndex = invalid.deepCopy().apply { add("patches", JsonParser.parseString("""[{"op":"replace","path":"/tracks/999/name","value":"x"}]""")) }
    check(runCatching { documents.request("documentEdit", wrongIndex) }.exceptionOrNull()!!.message!!.contains("Patch 0"))
    check(runCatching { documents.request("documentRead", args("""{"path":"../outside.dlmusic"}""")) }.isFailure)
    check(runCatching { documents.request("documentEdit", invalid.deepCopy().apply { add("patches", JsonParser.parseString("""[{"op":"replace","path":"/ppq","value":120}]""")) }) }.isFailure)
    val dirty = SoundStudioDocuments(context) { _, _, _ -> error("Unsaved engine score") }
    check(runCatching { dirty.request("documentEdit", edit.deepCopy().apply { addProperty("expectedVersion", saved["version"].asString) }) }.isFailure)
    check(Files.readString(root.resolve("Theme.dlmusic")) == good)
    val synth = MusicDocument.template()
    check(runCatching { studioPluginId(synth, "missing", "instrument") }.exceptionOrNull()!!.message!!.contains("Unknown track"))
    check(runCatching { studioPluginId(synth, synth.tracks.first().id, "instrument") }.exceptionOrNull()!!.message!!.contains("uses 'synth'"))
    val vst = synth.copy(tracks = listOf(synth.tracks.first().copy(instrument = devline.audio.MusicInstrument(kind = "vst3", plugin = "fixture-vst"))))
    check(studioPluginId(vst, vst.tracks.first().id, "instrument") == "fixture-vst")
    check(runCatching { studioPluginId(vst, vst.tracks.first().id, "bad-effect") }.exceptionOrNull()!!.message!!.contains("Unknown effect"))
    val status = JsonParser.parseString("""[{"plugin":"track1/instrument","error":"VST3 plugin is missing"}]""").asJsonArray
    check(runCatching { studioPluginReady(status, "track1", "instrument", "fixture-vst") }.exceptionOrNull()!!.message!!.contains("VST3 plugin is missing"))
    check(runCatching { studioPluginReady(com.google.gson.JsonArray(), "track1", "instrument", "fixture-vst") }.exceptionOrNull()!!.message!!.contains("openSaved"))
    studioPluginReady(JsonParser.parseString("""[{"id":"track1/instrument","failed":false}]""").asJsonArray, "track1", "instrument", "fixture-vst")
    SoundStudioExtension().activate(context).use { runtime ->
        val catalog = runtime.request("soundStudio.plugins", args("""{"offset":0}""")).asJsonObject
        check(catalog.getAsJsonArray("plugins").isEmpty && catalog["total"].asInt == 0)
        val directory = root.resolve("preferences-fixture")
        Files.createDirectories(directory)
        val legacy = """{"first":{"dock":{"position":"left"},"sampleRate":44100,"midiName":"Синтезатор 🎹","selectedTrack":"track1"},"last":{"blockSize":512,"exclusive":true}}"""
        Files.writeString(directory.resolve("settings.json"), legacy)
        val preferences = SoundStudioPreferences(directory)
        val migrated = preferences.read()
        check(migrated["sampleRate"].asInt == 44100 && migrated["blockSize"].asInt == 512 && migrated["midiName"].asString == "Синтезатор 🎹")
        check(!migrated.has("dock") && Files.readString(directory.resolve("settings.json")) == legacy)
        val changed = migrated.deepCopy().apply { addProperty("sampleRate", 96000); add("inputChannel", com.google.gson.JsonNull.INSTANCE) }
        preferences.write(changed)
        check(SoundStudioPreferences(directory).read() == changed)
        val savedPreferences = Files.readString(directory.resolve("preferences.json"))
        listOf("""{"sampleRate":0}""", """{"sampleRate":48000.5}""", """{"inputChannel":16}""", """{"exclusive":"yes"}""", """{"unknown":true}""").forEach { invalid ->
            check(runCatching { preferences.write(JsonParser.parseString(invalid).asJsonObject) }.isFailure)
            check(Files.readString(directory.resolve("preferences.json")) == savedPreferences)
        }
        check(preferences.document(JsonParser.parseString("""{"dock":{"tools":{}},"selectedTrack":"track1","sampleRate":44100}""").asJsonObject).toString() == """{"dock":{"tools":{}},"selectedTrack":"track1"}""")
        check(runtime.request("soundStudio.preferences", JsonObject()).asJsonObject["sampleRate"].asInt == 48000)
        check(runtime.request("soundStudio.preferences", JsonObject().apply { add("value", changed) }).asJsonObject == changed)
        check(runtime.request("soundStudio.documentRead", args("""{"path":"Theme.dlmusic"}""")).asJsonObject.getAsJsonObject("summary")["name"].asString == "Готово")
    }
    check(nativeArtifacts == 0)
    check(before != good)
    println("PASS Sound Studio owner: real create/read/edit/save, Unicode, no overwrite, optimistic version, validation rollback, restricted patches and path guard; no audio engine started")
}
