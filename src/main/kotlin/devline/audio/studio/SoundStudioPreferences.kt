package devline.audio.studio

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/** Profile defaults are independent of projects and never open an audio device. */
internal class SoundStudioPreferences(private val directory: Path) {
    private val file get() = directory.resolve("preferences.json")
    companion object {
        val keys = setOf("outputName", "inputName", "midiName", "midiOutputName", "sampleRate", "blockSize", "exclusive", "inputChannel", "countIn", "metronome", "followPlayhead")
    }
    private fun defaults() = JsonParser.parseString("""{"outputName":null,"inputName":null,"midiName":null,"midiOutputName":null,"sampleRate":48000,"blockSize":256,"exclusive":false,"inputChannel":null,"countIn":false,"metronome":false,"followPlayhead":true}""").asJsonObject
    private fun readObject(path: Path): JsonObject? = if (Files.isRegularFile(path) && Files.size(path) <= 256 * 1024)
        runCatching { JsonParser.parseString(Files.readString(path, Charsets.UTF_8)).asJsonObject }.getOrNull() else null
    private fun validated(value: JsonObject): JsonObject = defaults().apply {
        require(value.keySet().all { it in keys }) { "Unknown studio preference." }
        value.entrySet().forEach { (key, item) ->
            when (key) {
                "outputName", "inputName", "midiName", "midiOutputName" -> require(item.isJsonNull || item.isJsonPrimitive && item.asJsonPrimitive.isString && item.asString.length in 1..512 && item.asString.none { it.isISOControl() })
                "sampleRate" -> require(item.toString() in setOf("44100", "48000", "96000"))
                "blockSize" -> require(item.toString() in setOf("128", "256", "512", "1024"))
                "inputChannel" -> require(item.isJsonNull || item.toString() in (0..15).map(Int::toString))
                else -> require(item.isJsonPrimitive && item.asJsonPrimitive.isBoolean)
            }
            add(key, item.deepCopy())
        }
    }
    @Synchronized fun read(): JsonObject {
        readObject(file)?.let { return validated(it) }
        // Old versions stored device defaults with each document. Keep UI data untouched,
        // promote the most recently saved compatible defaults once to the profile.
        val legacy = readObject(directory.resolve("settings.json"))
        val migrated = defaults()
        var found = false
        legacy?.entrySet()?.forEach { (_, entry) -> if (entry.isJsonObject) {
            entry.asJsonObject.entrySet().filter { it.key in keys }.forEach { (key, item) ->
                if (runCatching { validated(JsonObject().apply { add(key, item) }) }.isSuccess) { migrated.add(key, item.deepCopy()); found = true }
            }
        } }
        if (found) write(migrated)
        return migrated
    }
    @Synchronized fun write(value: JsonObject): JsonObject {
        val result = validated(value)
        Files.createDirectories(directory)
        val stage = Files.createTempFile(directory, ".preferences-", ".tmp")
        try { Files.writeString(stage, result.toString(), Charsets.UTF_8); Files.move(stage, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE) }
        finally { Files.deleteIfExists(stage) }
        return result
    }
    fun document(value: JsonObject): JsonObject = value.deepCopy().apply { keys.forEach { remove(it) } }
}
