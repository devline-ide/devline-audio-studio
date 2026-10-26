package devline.audio.studio

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import devline.audio.MidiTake
import devline.audio.MusicClock
import devline.audio.MusicComposition
import devline.audio.MusicDocument
import devline.audio.MusicMidi
import devline.audio.MusicPlayback
import devline.extensions.IdeExtensionContext
import devline.extensions.IdeExtensionManifest
import devline.extensions.IdeExtensionProvider
import devline.extensions.IdeExtensionRuntime
import devline.extensions.IdeExtensionException
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

class SoundStudioExtension : IdeExtensionProvider {
    override val manifest: IdeExtensionManifest = javaClass.getResourceAsStream("/devline/soundstudio/extension.json")!!.reader(Charsets.UTF_8).use {
        Gson().fromJson(it, IdeExtensionManifest::class.java)
    }
    override fun activate(context: IdeExtensionContext): IdeExtensionRuntime = StudioRuntime(context)
}

private class StudioRuntime(private val context: IdeExtensionContext) : IdeExtensionRuntime {
    private val gson = Gson()
    private data class Gesture(val track: String, val target: String, val mode: String, var value: Double,
        val points: java.util.TreeMap<Long, devline.audio.MusicParameterPoint> = java.util.TreeMap())
    private data class Session(val project: String, val path: String, val root: Path, val engine: AudioProcess,
        var document: MusicComposition, var take: MidiTake? = null, var takeStart: Long = 0, var sampleRate: Int = 48000,
        var documentRevision: Long = 0, val transfers: MutableMap<String, Pair<Long, StringBuilder>> = mutableMapOf(), var status: JsonObject? = null,
        val midi: java.util.ArrayDeque<JsonElement> = java.util.ArrayDeque(), val gestures: MutableMap<String, Gesture> = mutableMapOf(),
        val pluginRevisions: MutableMap<String, Long> = mutableMapOf(), val dirtyPlugins: MutableSet<String> = mutableSetOf(), var renderStale: Boolean = false,
        var playbackTrack: String? = null, var playbackPattern: String? = null, var songFrame: Long = 0)
    private data class RenderJob(val id: String, val project: String, @Volatile var status: String = "queued", @Volatile var error: String? = null,
        @Volatile var output: String? = null, @Volatile var process: Process? = null, @Volatile var future: Future<*>? = null)
    private val sessions = java.util.concurrent.ConcurrentHashMap<String, Session>()
    private val jobs = java.util.concurrent.ConcurrentHashMap<String, RenderJob>()
    private val executor = Executors.newSingleThreadExecutor { Thread(it, "devline-audio-render").apply { isDaemon = true } }
    private val polling = Executors.newSingleThreadScheduledExecutor { Thread(it, "devline-audio-events").apply { isDaemon = true } }
    private val executable get() = Path.of(context.nativeArtifact("engine"))
    private val plugins = PluginCatalog(context.profileDirectory) { Path.of(context.nativeArtifact("pluginWorker")) }
    private val preferences = SoundStudioPreferences(context.profileDirectory.resolve("sound-studio"))
    private val documents = SoundStudioDocuments(context) { project, path, saved ->
        sessions.values.filter { it.project == project && it.path == path }.forEach { s -> synchronized(s) {
            check(s.take == null && s.status?.get("recording")?.asBoolean != true && s.gestures.isEmpty() && s.dirtyPlugins.isEmpty()) { "Finish recording and save plugin changes before editing the music document." }
            check(MusicDocument.write(s.document) == MusicDocument.write(MusicDocument.read(saved))) { "The music editor has unsaved changes. Save it before external editing." }
        } }
    }
    init {
        polling.scheduleWithFixedDelay({ sessions.values.forEach { s ->
            synchronized(s) {
                if (s.status?.has("engineError") != true) runCatching { refresh(s) }.onFailure { cause ->
                    val status = s.status ?: JsonObject().also { s.status = it }
                    status.addProperty("engineError", cause.message ?: "Audio engine stopped.")
                    status.addProperty("playing", false); status.addProperty("recording", false)
                }
            }
        } }, 50, 50, TimeUnit.MILLISECONDS)
    }
    private fun refresh(s: Session): JsonObject = synchronized(s) {
        val result = s.engine.call("poll")
        val clock = MusicClock(s.document.tempos, s.sampleRate)
        if (s.playbackTrack == null) s.songFrame = maxOf(0, result["frame"].asLong)
        result.addProperty("arrangementFrame", s.songFrame)
        result.getAsJsonArray("plugins")?.forEach { entry ->
            val item = entry.asJsonObject
            if (item.has("id") && item.has("edits")) {
                val id = item["id"].asString; val revision = item["edits"].asLong
                if ((s.pluginRevisions.put(id, revision) ?: revision) != revision) s.dirtyPlugins.add(id)
            }
        }
        result.addProperty("pluginDirty", s.dirtyPlugins.isNotEmpty()); result.addProperty("renderStale", s.renderStale)
        if (result["playing"].asBoolean && result["frame"].asLong >= 0) {
            val tick = clock.tick(result["frame"].asLong)
            s.gestures.values.filter { it.mode != "read" }.forEach { gesture ->
                if (gesture.points.size < 100000 || gesture.points.containsKey(tick)) gesture.points[tick] = devline.audio.MusicParameterPoint(tick, gesture.value)
            }
        }
        result.getAsJsonArray("midi").forEach { entry ->
            val event = entry.asJsonObject
            val tick = event["recordTick"]?.asDouble?.let(Math::round) ?: clock.tick(maxOf(0, event["frame"].asLong))
            if (tick >= s.takeStart && event["frame"].asLong >= 0) s.take?.receive(tick - s.takeStart, event["status"].asInt, event["data1"].asInt, event["data2"].asInt)
            if (s.midi.size >= 256) s.midi.removeFirst()
            s.midi.addLast(entry.deepCopy())
        }
        result.add("midi", com.google.gson.JsonArray()); s.status = result; result
    }
    private fun text(args: JsonObject, key: String): String = args[key]?.asString ?: error("Missing $key")
    private fun assets(s: Session): String {
        val current = devline.api.ProjectDocumentAssets.musicDirectory(s.path)
        val legacy = devline.api.ProjectDocumentAssets.legacyMusicDirectory(s.path)
        // Old documents retain valid paths until the workspace renames the score and directory together.
        return if (!Files.exists(path(s.root, current), NOFOLLOW_LINKS) && Files.isDirectory(path(s.root, legacy), NOFOLLOW_LINKS)) legacy else current
    }
    private fun playbackComposition(s: Session, document: MusicComposition): MusicComposition =
        if (s.playbackTrack != null && s.playbackPattern != null &&
            document.tracks.any { it.id == s.playbackTrack && it.kind == "instrument" } && document.patterns.any { it.id == s.playbackPattern })
            MusicPlayback.pattern(document, s.playbackTrack!!, s.playbackPattern!!) else document
    private fun playbackDocument(s: Session, document: MusicComposition): JsonObject =
        plugins.project(gson.toJsonTree(playbackComposition(s, document)).asJsonObject)
    private fun path(root: Path, relative: String): Path {
        MusicDocument.assetPath(relative)
        val target = root.resolve(relative).normalize()
        require(target.startsWith(root))
        var current: Path? = target
        while (current != null && current.startsWith(root)) {
            require(!Files.isSymbolicLink(current)) { "Symbolic links are not supported for studio assets." }
            if (Files.exists(current, NOFOLLOW_LINKS)) require(current.toRealPath().startsWith(root)) { "Asset escapes the project." }
            current = current.parent
        }
        return target
    }
    private fun writable(s: Session) {
        val source = context.callProject(s.project, "file.read", JsonObject().apply { addProperty("path", s.path) }).asJsonObject
        check(source["writable"]?.asBoolean == true && source["truncated"]?.asBoolean != true) { "Music document is read only." }
    }
    private fun session(args: JsonObject): Session {
        val session = sessions[text(args, "session")] ?: error("Studio session expired.")
        check(session.project == text(args, "expectedProjectFile")) { "Studio project changed." }
        context.projectRoot(session.project)
        return session
    }
    @Synchronized override fun request(method: String, params: JsonObject): JsonElement {
        try {
        check(context.enabled())
        return when (method.removePrefix("soundStudio.")) {
            "preferences" -> if (params.has("value")) preferences.write(params.getAsJsonObject("value")) else preferences.read()
            "devices" -> {
                val root = context.profileDirectory.resolve("sound-studio/device-enumeration")
                Files.createDirectories(root)
                AudioProcess(executable, root, root.resolve("devices.log")).use { it.call("devices") }
            }
            "documentRead", "documentCreate", "documentEdit" -> documents.request(method.removePrefix("soundStudio."), params).also { receipt ->
                if (method.removePrefix("soundStudio.") == "documentEdit") {
                    val project = text(params, "expectedProjectFile"); val relative = text(params, "path")
                    // beforeWrite already verified these sessions against the saved source and dirty-state guards.
                    sessions.values.filter { it.project == project && it.path == relative }.forEach { s -> synchronized(s) {
                        try {
                            val source = context.callProject(project, "file.read", JsonObject().apply { addProperty("path", relative) }).asJsonObject
                            val document = MusicDocument.read(text(source, "content"))
                            check(s.dirtyPlugins.isEmpty() && s.take == null && s.gestures.isEmpty()) { "Live changes arrived after the save. Preserve them before reloading." }
                            val loaded = s.engine.call("load", JsonObject().apply { add("document", playbackDocument(s, document)) })
                            s.document = document; s.sampleRate = loaded["sampleRate"].asInt; s.pluginRevisions.clear(); s.renderStale = true
                            receipt.addProperty("runtimeLoaded", true)
                        } catch (cause: Exception) {
                            // The versioned file write succeeded even when its existing engine cannot reload.
                            receipt.addProperty("runtimeLoaded", false); receipt.addProperty("runtimeWarning", cause.message?.take(512) ?: "Could not reload the saved composition.")
                        }
                    } }
                }
            }
            "template" -> gson.toJsonTree(MusicDocument.template(params["name"]?.asString ?: "Untitled"))
            "openSaved" -> {
                val project = text(params, "expectedProjectFile"); val relative = text(params, "path")
                val source = context.callProject(project, "file.read", JsonObject().apply { addProperty("path", relative) }).asJsonObject
                require(source["truncated"]?.asBoolean != true) { "Music document exceeds the project text-tool limit." }
                val document = MusicDocument.read(text(source, "content"))
                val existing = sessions.entries.firstOrNull { it.value.project == project && it.value.path == relative }
                if (existing != null) synchronized(existing.value) {
                    check(existing.value.take == null && refresh(existing.value)["recording"]?.asBoolean != true && existing.value.gestures.isEmpty()) { "Finish recording and automation gestures before opening the saved composition." }
                    check(existing.value.dirtyPlugins.isEmpty() && MusicDocument.write(existing.value.document) == MusicDocument.write(document)) { "Save the music editor and plugin changes before opening the saved composition." }
                }
                val opened = request("soundStudio.open", params).asJsonObject
                val id = text(opened, "session"); val s = sessions.getValue(id)
                try { synchronized(s) {
                    // The catalog may have changed since the editor first opened this score.
                    val result = s.engine.call("load", JsonObject().apply { add("document", playbackDocument(s, document)) })
                    s.document = document; s.sampleRate = result["sampleRate"].asInt; s.pluginRevisions.clear()
                    opened.add("plugins", refresh(s).getAsJsonArray("plugins").deepCopy())
                } } catch (cause: Exception) { if (existing == null) { sessions.remove(id); s.engine.close() }; throw cause }
                opened.apply { addProperty("path", relative); addProperty("version", text(source, "version")); addProperty("loaded", true) }
            }
            "open" -> {
                val project = text(params, "expectedProjectFile")
                val root = Path.of(context.projectRoot(project)).toRealPath()
                val relative = params["documentPath"]?.asString ?: text(params, "path"); require(relative.endsWith(".dlmusic", true))
                path(root, relative)
                val existing = sessions.entries.firstOrNull { it.value.project == project && it.value.path == relative }
                val id = existing?.key ?: UUID.randomUUID().toString().also { token ->
                    check(sessions.size < 8)
                    val engine = AudioProcess(executable, root, context.profileDirectory.resolve("sound-studio/logs/$token.log"))
                    sessions[token] = Session(project, relative, root, engine, MusicDocument.template())
                }
                JsonObject().apply { addProperty("session", id) }
            }
            "load" -> {
                val s = session(params)
                when (text(params, "action")) {
                    "begin" -> {
                        check(s.transfers.size < 4) { "Too many document transfers." }
                        val id = UUID.randomUUID().toString()
                        s.transfers[id] = (params["revision"]?.asLong ?: 0) to StringBuilder()
                        JsonObject().apply { addProperty("transfer", id) }
                    }
                    "chunk" -> {
                        val pending = s.transfers[text(params, "transfer")]?.second ?: error("Start the document transfer first.")
                        val chunk = text(params, "text"); check(pending.length + chunk.length <= 16 * 1024 * 1024)
                        pending.append(chunk); JsonObject()
                    }
                    "commit" -> {
                        val transfer = s.transfers.remove(text(params, "transfer")) ?: error("Missing document transfer.")
                        if (params["draft"]?.asBoolean == true) {
                            writable(s); MusicDocument.read(transfer.second.toString())
                            val relative = assets(s) + "/conflicts/" + UUID.randomUUID() + ".json"
                            val target = path(s.root, relative); Files.createDirectories(target.parent)
                            val stage = Files.createTempFile(target.parent, ".draft-", ".tmp")
                            try { Files.writeString(stage, transfer.second.toString(), Charsets.UTF_8); Files.move(stage, target, StandardCopyOption.ATOMIC_MOVE) }
                            finally { Files.deleteIfExists(stage) }
                            return JsonObject().apply { addProperty("path", relative) }
                        }
                        check(transfer.first >= s.documentRevision) { "Stale music document." }
                        val document = MusicDocument.read(transfer.second.toString())
                        val result = s.engine.call("load", JsonObject().apply { add("document", playbackDocument(s, document)) })
                        synchronized(s) { s.gestures.values.forEach { gesture -> s.engine.call("parameter", JsonObject().apply { addProperty("track", gesture.track); addProperty("target", gesture.target); addProperty("value", gesture.value) }) } }
                        synchronized(s) { s.document = document; s.documentRevision = transfer.first; s.sampleRate = result["sampleRate"].asInt }
                        val receipt = path(s.root, assets(s) + "/render.json")
                        synchronized(s) { s.renderStale = if (Files.isRegularFile(receipt, NOFOLLOW_LINKS) && Files.size(receipt) <= 128 * 1024) runCatching { gson.fromJson(Files.readString(receipt), JsonObject::class.java)["compositionHash"]?.asString != hash(MusicDocument.write(document).toByteArray(Charsets.UTF_8)) }.getOrDefault(true) else false }
                        result
                    }
                    else -> error("Unknown load action")
                }
            }
            "engine" -> {
                val s = session(params); val command = text(params, "command")
                if (command == "mix") return synchronized(s) {
                    writable(s)
                    val values = params["arguments"].asJsonObject.getAsJsonArray("tracks")
                    require(values.size() <= 256)
                    val states = values.associate { entry ->
                        val value = entry.asJsonObject
                        require(value["muted"].isJsonPrimitive && value["muted"].asJsonPrimitive.isBoolean && value["solo"].isJsonPrimitive && value["solo"].asJsonPrimitive.isBoolean)
                        text(value, "id") to (value["muted"].asBoolean to value["solo"].asBoolean)
                    }
                    val document = s.document.copy(tracks = s.document.tracks.map { track -> states[track.id]?.let { track.copy(muted = it.first, solo = it.second) } ?: track })
                    val tracks = playbackComposition(s, document).tracks
                    val result = s.engine.call("mix", JsonObject().apply { add("tracks", com.google.gson.JsonArray().apply {
                        tracks.forEach { track -> add(JsonObject().apply { addProperty("id", track.id); addProperty("muted", track.muted); addProperty("solo", track.solo) }) }
                    }) })
                    s.document = document; s.renderStale = true
                    result
                }
                if (command == "playback") return synchronized(s) {
                    val args = params["arguments"]?.asJsonObject ?: JsonObject()
                    check(s.take == null && refresh(s)["recording"]?.asBoolean != true && s.gestures.isEmpty()) { "Finish recording before changing playback mode." }
                    val mode = args["mode"]?.asString ?: "song"
                    require(mode in setOf("song", "pattern"))
                    val track = if (mode == "pattern") text(args, "track") else null
                    val pattern = if (mode == "pattern") text(args, "pattern") else null
                    if (track != null && pattern != null) MusicPlayback.pattern(s.document, track, pattern)
                    if (track != s.playbackTrack || pattern != s.playbackPattern) {
                        val playing = s.status?.get("playing")?.asBoolean == true
                        s.engine.call("stop")
                        val previousTrack = s.playbackTrack; val previousPattern = s.playbackPattern
                        s.playbackTrack = track; s.playbackPattern = pattern
                        try { s.engine.call("load", JsonObject().apply { add("document", playbackDocument(s, s.document)) }) }
                        catch (cause: Exception) { s.playbackTrack = previousTrack; s.playbackPattern = previousPattern; throw cause }
                        if (track == null) s.engine.call("seek", JsonObject().apply { addProperty("frame", s.songFrame) })
                        if (playing) s.engine.call("play")
                        refresh(s)
                    }
                    JsonObject().apply { addProperty("mode", mode); addProperty("frame", s.status?.get("frame")?.asLong ?: 0); addProperty("arrangementFrame", s.songFrame) }
                }
                require(command in setOf("devices", "configure", "play", "pause", "stop", "seek", "panic", "midi", "midiOpen", "midiClose", "midiSelectName", "midiClock", "transport", "monitor", "liveTrack", "inspect", "parameter"))
                if (command in setOf("midiOpen", "midiSelectName")) sessions.values.filter { it !== s && it.status?.get("midiConnected")?.asBoolean == true }.forEach { other -> other.engine.call("midiClose") }
                if (command == "seek" && params["arguments"]?.asJsonObject?.get("arrangement")?.asBoolean == true) return synchronized(s) {
                    val frame = params["arguments"].asJsonObject["frame"].asLong
                    require(frame in 0..s.sampleRate.toLong() * 60 * 60 * 24)
                    s.songFrame = frame
                    if (s.playbackTrack == null) s.engine.call("seek", JsonObject().apply { addProperty("frame", frame) })
                    refresh(s)
                    JsonObject().apply { addProperty("arrangementFrame", s.songFrame) }
                }
                val result = s.engine.call(command, params["arguments"]?.asJsonObject ?: JsonObject())
                if (command == "configure") synchronized(s) { s.sampleRate = result["sampleRate"].asInt }
                result
            }
            "poll" -> {
                val s = session(params)
                synchronized(s) {
                    val result = (s.status ?: refresh(s)).deepCopy()
                    result.add("midi", com.google.gson.JsonArray().apply { while (s.midi.isNotEmpty()) add(s.midi.removeFirst()) })
                    result
                }
            }
            "take" -> {
                val s = session(params)
                if (text(params, "action") == "start") {
                    synchronized(s) {
                        val status = refresh(s)
                        s.take = MidiTake(params["channel"]?.takeUnless { it.isJsonNull }?.asInt)
                        val countIn = params["countIn"]?.asBoolean == true
                        s.takeStart = if (countIn) 0 else status["recordTick"]?.asDouble?.let(Math::round) ?: MusicClock(s.document.tempos, s.sampleRate).tick(maxOf(0, status["frame"].asLong))
                        s.engine.call("transport", JsonObject().apply { addProperty("recordMidi", true) })
                        s.engine.call("play", JsonObject().apply { addProperty("countIn", countIn) }); JsonObject()
                    }
                } else {
                    synchronized(s) {
                        val status = if (s.status?.has("engineError") == true) s.status!! else refresh(s)
                        val tick = (status["recordTick"]?.asDouble?.let(Math::round) ?: MusicClock(s.document.tempos, s.sampleRate).tick(maxOf(0, status["frame"].asLong))) - s.takeStart
                        val recorder = s.take ?: error("No active MIDI take.")
                        val take = recorder.finish(maxOf(1, tick))
                        s.take = null
                        if (!status.has("engineError")) {
                            s.engine.call("panic")
                            s.engine.call("transport", JsonObject().apply { addProperty("recordMidi", false) })
                        }
                        JsonObject().apply { add("notes", gson.toJsonTree(take.first)); add("controllers", gson.toJsonTree(take.second)); add("events", gson.toJsonTree(recorder.events())) }
                    }
                }
            }
            "record" -> {
                val s = session(params)
                if (text(params, "action") == "list") {
                    val directory = path(s.root, assets(s) + "/recordings")
                    JsonObject().apply { add("recordings", com.google.gson.JsonArray().apply {
                        if (Files.isDirectory(directory, NOFOLLOW_LINKS)) Files.list(directory).use { files -> files.filter { it.fileName.toString().endsWith(".recovery.json") && Files.isRegularFile(it, NOFOLLOW_LINKS) && Files.size(it) <= 8192 }.limit(32).forEach { file ->
                            runCatching { gson.fromJson(Files.readString(file), JsonObject::class.java) }.getOrNull()?.let { add(it) }
                        } }
                    }) }
                } else if (text(params, "action") == "recover") {
                    writable(s)
                    val relative = text(params, "path"); require(relative.startsWith(assets(s) + "/recordings/"))
                    val journal = path(s.root, relative + ".recovery.json")
                    require(Files.isRegularFile(journal, NOFOLLOW_LINKS) && Files.size(journal) <= 8192)
                    val metadata = gson.fromJson(Files.readString(journal), JsonObject::class.java)
                    require(metadata["path"].asString == relative)
                    s.engine.call("recover", metadata)
                } else if (text(params, "action") == "start") {
                    writable(s)
                    val relative = assets(s) + "/recordings/" + UUID.randomUUID() + ".wav"
                    s.engine.call("recordStart", JsonObject().apply { addProperty("path", relative); addProperty("channels", params["channels"]?.asInt ?: 0) })
                } else s.engine.call("recordStop")
            }
            "render" -> render(session(params), params)
            "plugins" -> {
                if (params["action"]?.asString == "scan") {
                    val s = session(params)
                    val id = UUID.randomUUID().toString(); val job = RenderJob(id, s.project); jobs[id] = job
                    val directories = params["directories"]?.asJsonArray?.map { Path.of(it.asString) } ?: plugins.standardDirectories()
                    job.future = executor.submit {
                        try { job.status = "running"; plugins.scan(directories, params["retry"]?.asBoolean == true) { job.status == "cancelled" || Thread.currentThread().isInterrupted }; job.status = "completed" }
                        catch (cause: Exception) { job.error = cause.message; if (job.status != "cancelled") job.status = "failed" }
                    }
                    JsonObject().apply { addProperty("id", id) }
                } else plugins.page(params["offset"]?.asInt ?: 0)
            }
            "plugin" -> {
                val s = session(params)
                return synchronized(s) {
                val track = text(params, "track"); val effect = params["effect"]?.asString ?: "instrument"
                val plugin = studioPluginId(s.document, track, effect)
                check(s.playbackTrack == null || s.playbackTrack == track) { "The engine is previewing a pattern on track '${s.playbackTrack}'. Use engine command playback with arguments {\"mode\":\"song\"} before controlling another track's plugin." }
                studioPluginReady(refresh(s).getAsJsonArray("plugins"), track, effect, plugin)
                val arguments = params.getAsJsonObject("arguments").deepCopy()
                when (arguments["command"].asString) {
                    "presetSave", "presetLoad" -> {
                        writable(s)
                        val relative = arguments["path"].asString; require(relative.endsWith(".dlpreset", true))
                        val target = path(s.root, relative)
                        if (arguments["command"].asString == "presetSave") { require(!Files.exists(target, NOFOLLOW_LINKS)) { "Preset already exists" }; Files.createDirectories(target.parent) }
                        else require(Files.isRegularFile(target, NOFOLLOW_LINKS) && Files.size(target) <= 128 * 1024 * 1024)
                        arguments.addProperty("command", if (arguments["command"].asString == "presetSave") "save" else "restore"); arguments.addProperty("path", target.toString())
                    }
                    "parameters", "parameter", "editor" -> Unit
                    else -> error("Unsupported plugin command")
                }
                s.engine.call("plugin", JsonObject().apply { addProperty("track", text(params, "track")); addProperty("effect", params["effect"]?.asString ?: "instrument"); add("arguments", arguments) })
                }
            }
            "state" -> {
                val s = session(params)
                synchronized(s) {
                writable(s)
                val directory = assets(s) + "/plugin-states/" + UUID.randomUUID()
                val only = text(params, "track") + "/" + (params["effect"]?.asString ?: "instrument")
                val states = s.engine.call("pluginStates", JsonObject().apply { addProperty("directory", directory); addProperty("only", only) }).getAsJsonArray("states")
                for (entry in states) {
                    val item = entry.asJsonObject; val stage = path(s.root, item["state"].asString)
                    val relative = assets(s) + "/plugin-states/" + hash(Files.readAllBytes(stage)) + ".state"
                    val destination = path(s.root, relative)
                    if (!Files.exists(destination, NOFOLLOW_LINKS)) Files.move(stage, destination, StandardCopyOption.ATOMIC_MOVE) else Files.delete(stage)
                    item.addProperty("state", relative)
                    s.engine.call("plugin", JsonObject().apply { addProperty("track", item["track"].asString); addProperty("effect", item["effect"].asString); add("arguments", JsonObject().apply { addProperty("command", "adoptState"); addProperty("state", relative) }) })
                }
                Files.deleteIfExists(path(s.root, directory))
                states.firstOrNull()?.asJsonObject?.get("edits")?.asLong?.let { s.pluginRevisions[only] = it }
                s.dirtyPlugins.remove(only)
                JsonObject().apply { add("states", states) }
                }
            }
            "job" -> {
                val s = session(params)
                val job = jobs[text(params, "id")] ?: error("Unknown render job")
                check(job.project == s.project)
                if (params["cancel"]?.asBoolean == true) {
                    job.status = "cancelled"; job.process?.let { process -> process.descendants().forEach { it.destroyForcibly() }; process.destroyForcibly() }; job.future?.cancel(true)
                }
                JsonObject().apply { addProperty("id", job.id); addProperty("status", job.status); job.error?.let { addProperty("error", it) }; job.output?.let { addProperty("output", it) } }
            }
            "midiFile" -> {
                val s = session(params); val target = path(s.root, text(params, "path"))
                if (text(params, "action") == "import") {
                    require(Files.isRegularFile(target, NOFOLLOW_LINKS) && Files.size(target) <= 16 * 1024 * 1024)
                    gson.toJsonTree(MusicMidi.read(Files.readAllBytes(target)))
                } else {
                    writable(s)
                    require(!Files.exists(target) || params["overwrite"]?.asBoolean == true)
                    Files.createDirectories(target.parent)
                    val staged = Files.createTempFile(target.parent, ".midi-", ".tmp")
                    try { Files.write(staged, MusicMidi.write(s.document)); Files.move(staged, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE) }
                    finally { Files.deleteIfExists(staged) }
                    JsonObject()
                }
            }
            "settings" -> {
                val s = session(params)
                val defaults = preferences.read()
                val file = context.profileDirectory.resolve("sound-studio/settings.json")
                val settings = if (Files.isRegularFile(file) && Files.size(file) <= 256 * 1024) runCatching { gson.fromJson(Files.readString(file), JsonObject::class.java) }.getOrNull() ?: JsonObject() else JsonObject()
                val key = java.security.MessageDigest.getInstance("SHA-256").digest((s.project + "/" + s.path).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
                if (params.has("value")) {
                    val value = preferences.document(params.getAsJsonObject("value"))
                    require(value.toString().length <= 16 * 1024)
                    settings.remove(key)
                    settings.add(key, value.deepCopy())
                    while (settings.size() > 32 || settings.toString().toByteArray(Charsets.UTF_8).size > 256 * 1024) settings.remove(settings.keySet().first())
                    Files.createDirectories(file.parent)
                    val staged = Files.createTempFile(file.parent, ".settings-", ".tmp")
                    try { Files.writeString(staged, settings.toString(), Charsets.UTF_8); Files.move(staged, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE) }
                    finally { Files.deleteIfExists(staged) }
                }
                defaults.apply { settings[key]?.takeIf { it.isJsonObject }?.asJsonObject?.let { preferences.document(it).entrySet().forEach { (key, value) -> add(key, value.deepCopy()) } } }
            }
            "gesture" -> {
                val s = session(params)
                synchronized(s) {
                    when (text(params, "action")) {
                        "begin" -> {
                            writable(s); require(s.gestures.size < 256)
                            val track = s.document.tracks.first { it.id == text(params, "track") }
                            val target = text(params, "target"); val value = params["value"].asDouble; require(value.isFinite())
                            val mode = track.automation.firstOrNull { it.target == target }?.mode ?: "read"
                            val id = UUID.randomUUID().toString()
                            s.engine.call("parameter", JsonObject().apply { addProperty("track", track.id); addProperty("target", target); addProperty("value", value) })
                            s.gestures[id] = Gesture(track.id, target, mode, value).also { gesture -> if (mode != "read") {
                                val status = s.status ?: refresh(s)
                                val tick = MusicClock(s.document.tempos, s.sampleRate).tick(maxOf(0, status["frame"].asLong))
                                gesture.points[tick] = devline.audio.MusicParameterPoint(tick, value)
                            } }
                            JsonObject().apply { addProperty("id", id); addProperty("mode", mode) }
                        }
                        "change" -> {
                            val gesture = s.gestures[text(params, "id")] ?: error("Gesture expired")
                            val value = params["value"].asDouble; require(value.isFinite())
                            if (s.status?.has("engineError") != true) s.engine.call("parameter", JsonObject().apply { addProperty("track", gesture.track); addProperty("target", gesture.target); addProperty("value", value) })
                            gesture.value = value; JsonObject()
                        }
                        "end", "cancel" -> {
                            if (s.status?.has("engineError") != true) refresh(s)
                            val gesture = s.gestures.remove(text(params, "id")) ?: error("Gesture expired")
                            if (s.status?.has("engineError") != true) s.engine.call("parameter", JsonObject().apply { addProperty("track", gesture.track); addProperty("target", gesture.target); addProperty("value", gesture.value); addProperty("active", false); addProperty("commit", text(params, "action") == "end") })
                            gson.toJsonTree(gesture).asJsonObject.apply { add("points", gson.toJsonTree(gesture.points.values.toList())) }
                        }
                        else -> error("Unknown gesture action")
                    }
                }
            }
            else -> error("Unknown studio method")
        }
        } catch (cause: IdeExtensionException) { throw cause }
          catch (cause: Exception) { throw IdeExtensionException("AUDIO_STUDIO_ERROR", cause.message?.take(1000) ?: "Sound Studio operation failed.") }
    }
    private fun render(s: Session, params: JsonObject): JsonObject {
        writable(s)
        val format = params["format"]?.asString ?: "wav"; require(format in setOf("wav", "ogg"))
        val bits = params["bits"]?.asInt ?: 16; require(bits in setOf(16, 24, 32))
        val relative = params["path"]?.asString ?: s.path.removeSuffix(".dlmusic") + ".$format"
        val destination = path(s.root, relative)
        require(!Files.exists(destination) || params["overwrite"]?.asBoolean == true) { "Export target exists. Choose another name or confirm replacement." }
        val id = UUID.randomUUID().toString(); val job = RenderJob(id, s.project); jobs[id] = job
        val projected = plugins.project(gson.toJsonTree(s.document).asJsonObject)
        val options = JsonObject().apply {
            addProperty("sampleRate", params["sampleRate"]?.asInt ?: 48000)
            addProperty("tail", params["tail"]?.asDouble ?: 2.0)
            addProperty("crossfadeMs", params["crossfadeMs"]?.asInt ?: 0)
            addProperty("quality", (params["quality"]?.asDouble ?: 5.0) / 10)
            when (params["region"]?.asString ?: "song") {
                "song", "stems" -> Unit
                "loop" -> { addProperty("startTick", s.document.loop.start); addProperty("endTick", s.document.loop.end) }
                "selection" -> { addProperty("startTick", params["startTick"].asLong); addProperty("endTick", params["endTick"].asLong) }
                "pattern" -> { addProperty("pattern", text(params, "pattern")); addProperty("track", text(params, "track")) }
                else -> error("Unknown render region")
            }
        }
        require(options["sampleRate"].asInt in 8000..192000 && options["tail"].asDouble in 0.0..60.0 && options["crossfadeMs"].asInt in 0..1000)
        val targets = if (params["region"]?.asString == "stems") s.document.tracks.filter { it.kind != "bus" && !it.muted }.map { track ->
            val target = relative.substringBeforeLast('.') + "-stems/" + track.id + ".$format"
            target to options.deepCopy().apply { addProperty("stem", track.id) }
        } else listOf(relative to options)
        require(targets.isNotEmpty()) { "Nothing to render." }
        targets.forEach { (target, _) -> require(!Files.exists(path(s.root, target)) || params["overwrite"]?.asBoolean == true) { "An export target exists." } }
        val sourceHash = hash(Files.readAllBytes(path(s.root, s.path)))
        val compositionHash = hash(MusicDocument.write(s.document).toByteArray(Charsets.UTF_8))
        val engine = executable
        job.future = executor.submit {
            val stageDirectory = context.profileDirectory.resolve("sound-studio/render/$id")
            val staged = mutableListOf<Pair<Path, Path>>()
            val backups = mutableMapOf<Path, Path>()
            val installed = mutableListOf<Path>()
            try {
                job.status = "running"; Files.createDirectories(stageDirectory); Files.createDirectories(destination.parent)
                for ((index, target) in targets.withIndex()) {
                    check(job.status != "cancelled" && !Thread.currentThread().isInterrupted)
                    val final = path(s.root, target.first); Files.createDirectories(final.parent)
                    val stage = final.resolveSibling(final.fileName.toString() + ".$id.partial"); staged += stage to final
                    val document = stageDirectory.resolve("snapshot-$index.dlmusic")
                    Files.writeString(document, projected.deepCopy().apply { add("_render", target.second) }.toString(), Charsets.UTF_8)
                    val log = stageDirectory.resolve("render-$index.log")
                    val process = ProcessBuilder(engine.toString(), "--render", s.root.toString(), document.toString(), stage.toString(), format, bits.toString())
                        .redirectError(log.toFile()).redirectOutput(stageDirectory.resolve("output-$index.log").toFile()).start()
                    job.process = process
                    while (!process.waitFor(200, TimeUnit.MILLISECONDS)) {
                        if (Thread.currentThread().isInterrupted || job.status == "cancelled" || !context.enabled()) { process.descendants().forEach { it.destroyForcibly() }; process.destroyForcibly(); error("Render cancelled") }
                    }
                    check(process.exitValue() == 0 && Files.isRegularFile(stage) && Files.size(stage) > 44) { "Audio render failed: " + Files.readString(log).take(1000) }
                }
                check(job.status != "cancelled" && context.enabled())
                for ((stage, final) in staged) {
                    if (Files.exists(final)) {
                        check(params["overwrite"]?.asBoolean == true)
                        val backup = final.resolveSibling(final.fileName.toString() + ".$id.backup")
                        Files.move(final, backup, StandardCopyOption.ATOMIC_MOVE); backups[final] = backup
                    }
                    Files.move(stage, final, StandardCopyOption.ATOMIC_MOVE); installed.add(final)
                }
                val receipt = JsonObject().apply { addProperty("schemaVersion", 1); addProperty("source", s.path); addProperty("sourceHash", sourceHash); addProperty("compositionHash", compositionHash); add("outputs", gson.toJsonTree(targets.map { it.first })); add("options", options) }
                devline.extensions.IdeExtensionFiles.writeAtomic(path(s.root, assets(s) + "/render.json"), receipt.toString())
                backups.values.forEach { Files.deleteIfExists(it) }; backups.clear()
                job.output = targets.joinToString("; ") { it.first }; job.status = "completed"
                synchronized(s) { s.renderStale = hash(MusicDocument.write(s.document).toByteArray(Charsets.UTF_8)) != compositionHash }
            } catch (cause: Exception) {
                installed.forEach { Files.deleteIfExists(it) }
                backups.forEach { (final, backup) -> if (Files.exists(backup)) Files.move(backup, final, StandardCopyOption.REPLACE_EXISTING) }
                job.error = cause.message; if (job.status != "cancelled") job.status = "failed"
            } finally {
                job.process?.let { if (it.isAlive) { it.descendants().forEach { child -> child.destroyForcibly() }; it.destroyForcibly() } }
                staged.forEach { Files.deleteIfExists(it.first) }
            }
        }
        return JsonObject().apply { addProperty("id", id) }
    }
    @Synchronized override fun projectClosed() {
        jobs.values.forEach { it.status = "cancelled"; it.process?.destroy(); it.future?.cancel(true) }
        sessions.values.forEach { runCatching { it.engine.close() } }; sessions.clear()
    }
    override fun close() { polling.shutdownNow(); projectClosed(); executor.shutdownNow() }
    @Synchronized override fun documentClosed(projectFile: String, path: String) {
        sessions.entries.filter { it.value.project == projectFile && it.value.path == path }.forEach { (id, session) ->
            runCatching { session.engine.close() }; sessions.remove(id)
        }
    }
    private fun hash(bytes: ByteArray) = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
