package devline.audio.studio

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import devline.extensions.IdeExtensionFiles
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

internal class PluginCatalog(private val profile: Path, private val worker: () -> Path) {
    private val file = profile.resolve("sound-studio/plugins.json")
    private val entries = ConcurrentHashMap<String, JsonObject>()
    private val badFile = profile.resolve("sound-studio/problem-plugins.json")
    private val bad = ConcurrentHashMap<String, JsonObject>()
    init {
        if (Files.isRegularFile(file, NOFOLLOW_LINKS) && Files.size(file) <= 1024 * 1024) runCatching {
            JsonParser.parseString(Files.readString(file)).asJsonArray.forEach { entry ->
                val value = entry.asJsonObject
                if (value["id"].asString.matches(Regex("[a-fA-F0-9]{32}"))) entries[value["id"].asString] = value
            }
        }
        if (Files.isRegularFile(badFile, NOFOLLOW_LINKS) && Files.size(badFile) <= 1024 * 1024) runCatching {
            JsonParser.parseString(Files.readString(badFile)).asJsonArray.forEach { entry -> val item = entry.asJsonObject; bad[item["path"].asString] = item }
        }
    }
    fun list(): JsonArray = Gson().toJsonTree(entries.values.sortedBy { it["name"].asString }).asJsonArray
    fun page(offset: Int): JsonObject {
        require(offset >= 0)
        val all = entries.values.sortedBy { it["name"].asString }; val page = JsonArray(); var bytes = 0
        for (item in all.drop(offset).take(32)) { val size = item.toString().length; if (bytes + size > 96 * 1024) break; page.add(item); bytes += size }
        return JsonObject().apply { add("plugins", page); addProperty("total", all.size); addProperty("nextOffset", offset + page.size()); addProperty("failed", bad.size) }
    }
    fun resolve(id: String): String? = entries[id]?.get("path")?.asString?.takeIf { Files.exists(Path.of(it), NOFOLLOW_LINKS) }
    fun standardDirectories(): List<Path> = when {
        System.getProperty("os.name").startsWith("Windows") -> listOfNotNull(
            System.getenv("CommonProgramFiles")?.let { Path.of(it, "VST3") },
            System.getenv("LOCALAPPDATA")?.let { Path.of(it, "Programs", "Common", "VST3") })
        System.getProperty("os.name").contains("Mac") -> listOf(Path.of("/Library/Audio/Plug-Ins/VST3"), Path.of(System.getProperty("user.home"), "Library/Audio/Plug-Ins/VST3"))
        else -> listOf(Path.of("/usr/lib/vst3"), Path.of("/usr/local/lib/vst3"), Path.of(System.getProperty("user.home"), ".vst3"))
    }
    fun scan(directories: List<Path>, retry: Boolean = false, cancelled: () -> Boolean): JsonObject {
        val failures = JsonArray(); var scanned = 0
        val candidates = linkedSetOf<Path>()
        directories.forEach { directory ->
            if (Files.isDirectory(directory, NOFOLLOW_LINKS)) Files.walk(directory, 6).use { paths ->
                paths.filter { it.fileName.toString().endsWith(".vst3", true) && !it.toString().substringBeforeLast(".vst3").contains(".vst3") }
                    .limit(4096).forEach { candidates.add(it.toAbsolutePath().normalize()) }
            } else if (directory.fileName.toString().endsWith(".vst3", true) && Files.exists(directory, NOFOLLOW_LINKS)) candidates.add(directory.toAbsolutePath().normalize())
        }
        candidates.forEach { plugin ->
            check(!cancelled()) { "Scan cancelled" }
            val rawStamp = if (Files.isRegularFile(plugin, NOFOLLOW_LINKS)) "${Files.size(plugin)}:${Files.getLastModifiedTime(plugin)}" else Files.walk(plugin, 4).use { files -> files.filter { Files.isRegularFile(it, NOFOLLOW_LINKS) }.limit(256).map { "${plugin.relativize(it)}:${Files.size(it)}:${Files.getLastModifiedTime(it)}" }.sorted().toList().joinToString("|") }
            val stamp = java.security.MessageDigest.getInstance("SHA-256").digest(rawStamp.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
            if (!retry && bad[plugin.toString()]?.get("stamp")?.asString == stamp) return@forEach
            val output = Files.createTempFile(profile.also { Files.createDirectories(it) }, "vst3-scan-", ".json")
            val log = output.resolveSibling(output.fileName.toString() + ".log")
            var process: Process? = null
            try {
                process = ProcessBuilder(worker().toString(), "--scan", plugin.toString()).redirectOutput(output.toFile()).redirectError(log.toFile()).start()
                val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
                while (!process.waitFor(100, TimeUnit.MILLISECONDS)) check(!cancelled() && System.nanoTime() < end) { "Plugin scan timed out" }
                check(process.exitValue() == 0 && Files.size(output) <= 128 * 1024) { "Plugin could not be scanned" }
                val result = Files.readAllLines(output).lastOrNull { it.startsWith('[') } ?: error("Invalid plugin metadata")
                JsonParser.parseString(result).asJsonArray.forEach { entry ->
                    val value = entry.asJsonObject
                    require(value["id"].asString.matches(Regex("[a-fA-F0-9]{32}")))
                    require(value.toString().length <= 64 * 1024 && entries.values.sumOf { it.toString().length } + value.toString().length <= 1024 * 1024) { "Plugin catalog is full" }
                    entries[value["id"].asString] = value
                }
                bad.remove(plugin.toString())
                scanned++
            } catch (cause: Exception) {
                if (cancelled()) throw cause
                val failure = JsonObject().apply { addProperty("path", plugin.toString()); addProperty("error", cause.message?.take(1000)); addProperty("stamp", stamp.take(16000)) }
                failures.add(failure); if (bad.size < 256) bad[plugin.toString()] = failure
            }
            finally {
                process?.let { if (it.isAlive) { it.descendants().forEach { child -> child.destroyForcibly() }; it.destroyForcibly() } }
                Files.deleteIfExists(output); Files.deleteIfExists(log)
            }
        }
        IdeExtensionFiles.writeAtomic(file, list().toString())
        IdeExtensionFiles.writeAtomic(badFile, Gson().toJson(bad.values.toList()))
        return JsonObject().apply { addProperty("scanned", scanned); add("failures", failures) }
    }
    fun project(document: JsonObject): JsonObject = document.deepCopy().also { projected ->
        projected.getAsJsonArray("tracks").forEach { entry ->
            val track = entry.asJsonObject
            fun plugin(value: JsonObject) {
                if (value["kind"]?.asString == "vst3") value["plugin"]?.takeUnless { it.isJsonNull }?.asString?.let { id ->
                    resolve(id)?.let { value.addProperty("pluginPath", it) }
                }
            }
            plugin(track.getAsJsonObject("instrument"))
            track.getAsJsonArray("effects").forEach { plugin(it.asJsonObject) }
        }
    }
}
