package devline.audio.studio

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import devline.audio.MusicComposition
import devline.audio.MusicDocument
import devline.extensions.IdeExtensionContext
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path

/** Versioned composition authoring owned by Sound Studio, without starting an audio device. */
internal class SoundStudioDocuments(private val context: IdeExtensionContext,
    private val beforeWrite: (String, String, String) -> Unit = { _, _, _ -> }) {
    private val gson = Gson()
    private val editable = setOf("name", "tempos", "patterns", "tracks", "loop", "markers", "masterGain")
    fun request(action: String, params: JsonObject): JsonObject {
        val project = text(params, "expectedProjectFile")
        val root = Path.of(context.projectRoot(project)).toRealPath()
        val relative = text(params, "path")
        require(relative.endsWith(".dlmusic", true)) { "Choose a .dlmusic document." }
        scoped(root, relative)
        if (action == "documentCreate") {
            val document = params["document"]?.let { MusicDocument.read(it.toString()) }
                ?: MusicDocument.template(params["name"]?.asString ?: relative.substringAfterLast('/').removeSuffix(".dlmusic"))
            assets(root, document, requireExisting = true)
            val content = MusicDocument.write(document)
            context.callProject(project, "project.entry.create", JsonObject().apply {
                addProperty("kind", "file"); addProperty("parent", relative.substringBeforeLast('/', ""))
                addProperty("name", relative.substringAfterLast('/')); addProperty("content", content)
            })
            return receipt(relative, read(project, relative), document, created = true)
        }
        val source = read(project, relative)
        val content = text(source, "content")
        val document = MusicDocument.read(content)
        if (action == "documentRead") {
            val section = params["section"]?.asString ?: "summary"
            val offset = params["offset"]?.asInt ?: 0
            val limit = params["limit"]?.asInt ?: 16
            require(offset >= 0 && limit in 1..128)
            return receipt(relative, source, document).apply {
                add("missingAssets", gson.toJsonTree(assets(root, document, requireExisting = false).filter { !Files.isRegularFile(scoped(root, it), NOFOLLOW_LINKS) }))
                if (section != "summary") {
                    val json = gson.toJsonTree(document).asJsonObject
                    val values = if (section == "notes") json.getAsJsonArray("patterns").single { it.asJsonObject["id"].asString == text(params, "pattern") }.asJsonObject.getAsJsonArray("notes")
                        else { require(section in setOf("tracks", "patterns", "tempos", "markers")); json.getAsJsonArray(section) }
                    addProperty("section", section); addProperty("offset", offset); addProperty("total", values.size())
                    add("items", JsonArray().apply { values.drop(offset).take(limit).forEach { add(it) } })
                }
            }
        }
        require(action == "documentEdit") { "Unknown document action." }
        require(text(params, "expectedVersion") == text(source, "version")) { "The music document changed. Read it again before editing." }
        require(source["writable"]?.asBoolean == true) { "Music document is read only." }
        beforeWrite(project, relative, content)
        val edited = JsonParser.parseString(MusicDocument.write(document)).asJsonObject
        val patches = params.getAsJsonArray("patches") ?: error("Provide patches.")
        require(patches.size() in 1..64)
        for ((index, entry) in patches.withIndex()) try { patch(edited, entry.asJsonObject) }
            catch (cause: Exception) { throw IllegalArgumentException("Patch $index (${entry.takeIf { it.isJsonObject }?.asJsonObject?.get("path")?.toString()?.take(200) ?: "unknown path"}) rejected: ${cause.message}. No document changes saved.", cause) }
        val result = try { MusicDocument.read(edited.toString()) }
            catch (cause: Exception) { throw IllegalArgumentException("Invalid composition: ${cause.message}. No document changes saved; inspect the affected section with documentRead before retrying.", cause) }
        assets(root, result, requireExisting = true)
        val saved = context.callProject(project, "file.save", JsonObject().apply {
            addProperty("path", relative); addProperty("expectedVersion", text(source, "version")); addProperty("content", MusicDocument.write(result))
        }).asJsonObject
        return receipt(relative, saved, result)
    }
    private fun read(project: String, path: String): JsonObject = context.callProject(project, "file.read", JsonObject().apply { addProperty("path", path) }).asJsonObject.also {
        require(it["truncated"]?.asBoolean != true) { "Music document exceeds the project text-tool limit. Use its editor." }
    }
    private fun receipt(path: String, source: JsonObject, document: MusicComposition, created: Boolean = false) = JsonObject().apply {
        addProperty("path", path); addProperty("version", text(source, "version")); addProperty("created", created)
        addProperty("writable", source["writable"]?.asBoolean == true)
        add("summary", JsonObject().apply {
            addProperty("name", document.name); addProperty("ppq", document.ppq); addProperty("tracks", document.tracks.size); addProperty("patterns", document.patterns.size)
            add("tempos", gson.toJsonTree(document.tempos.take(16))); add("trackIds", gson.toJsonTree(document.tracks.map { it.id })); add("patternIds", gson.toJsonTree(document.patterns.map { it.id }))
        })
        add("assets", gson.toJsonTree(assetNames(document).take(128)))
    }
    private fun assetNames(value: MusicComposition): List<String> = value.tracks.flatMap { track ->
        listOfNotNull(track.instrument.asset, track.instrument.state) + track.instrument.pads.values + track.clips.mapNotNull { it.asset } + track.effects.mapNotNull { it.state }
    }.distinct()
    private fun assets(root: Path, document: MusicComposition, requireExisting: Boolean): List<String> = assetNames(document).also { names ->
        names.forEach { relative -> val file = scoped(root, relative); if (requireExisting) require(Files.isRegularFile(file, NOFOLLOW_LINKS)) { "Missing related audio asset: $relative" } }
    }
    private fun scoped(root: Path, relative: String): Path {
        MusicDocument.assetPath(relative)
        val file = root.resolve(relative).normalize()
        require(file.startsWith(root))
        var current: Path? = file
        while (current != null && current.startsWith(root)) {
            require(!Files.isSymbolicLink(current)) { "Symbolic links are not supported for studio assets." }
            if (Files.exists(current, NOFOLLOW_LINKS)) require(current.toRealPath().startsWith(root))
            current = current.parent
        }
        return file
    }
    private fun patch(root: JsonObject, patch: JsonObject) {
        require(patch.keySet().all { it in setOf("op", "path", "value") })
        val operation = text(patch, "op"); require(operation in setOf("add", "replace", "remove")) { "op must be add, replace or remove." }
        val pointer = text(patch, "path"); require(pointer.startsWith('/') && pointer.length <= 1000 && !Regex("~(?![01])").containsMatchIn(pointer))
        val keys = pointer.drop(1).split('/').map { it.replace("~1", "/").replace("~0", "~") }
        require(keys.first() in editable && keys.all { it.isNotEmpty() }) { "Editable roots: ${editable.joinToString()}; empty path segments are invalid." }
        fun index(value: String, size: Int, append: Boolean = false): Int {
            if (append && value == "-") return size
            require(value.matches(Regex("0|[1-9][0-9]{0,8}")))
            return value.toInt().also { require(it >= 0 && if (append) it <= size else it < size) { "Array index $it is outside size $size; use '-' with add to append." } }
        }
        var parent: JsonElement = root
        for (key in keys.dropLast(1)) parent = if (parent.isJsonObject) parent.asJsonObject[key] ?: error("Missing patch parent")
            else { require(parent.isJsonArray); parent.asJsonArray[index(key, parent.asJsonArray.size())] }
        val key = keys.last()
        val value = if (operation == "remove") null else patch["value"]?.deepCopy() ?: error("Patch value required")
        if (parent.isJsonObject) {
            if (operation != "add") require(parent.asJsonObject.has(key)) { "Field $key does not exist; inspect documentRead and use add for a new field." }
            if (operation == "remove") parent.asJsonObject.remove(key) else parent.asJsonObject.add(key, value)
        } else {
            require(parent.isJsonArray); val values = parent.asJsonArray.asList()
            val at = index(key, values.size, operation == "add")
            when (operation) { "add" -> values.add(at, value!!); "replace" -> values[at] = value!!; else -> values.removeAt(at) }
        }
    }
    private fun text(value: JsonObject, key: String): String = value[key]?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString ?: error("Missing $key")
}
