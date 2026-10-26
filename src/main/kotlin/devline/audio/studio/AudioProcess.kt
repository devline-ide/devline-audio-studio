package devline.audio.studio

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

internal class AudioProcess(executable: Path, root: Path, log: Path) : AutoCloseable {
    private val process: Process
    private val input: java.io.BufferedWriter
    private val output: java.io.BufferedReader
    private val reader = Executors.newSingleThreadExecutor { Thread(it, "devline-audio-replies").apply { isDaemon = true } }
    private val sequence = AtomicLong()
    private val closed = java.util.concurrent.atomic.AtomicBoolean()
    init {
        require(Files.isRegularFile(executable)) { "Audio engine is missing." }
        Files.createDirectories(log.parent)
        process = ProcessBuilder(executable.toString(), "--root", root.toString()).directory(root.toFile()).redirectError(log.toFile()).start()
        input = process.outputStream.bufferedWriter(Charsets.UTF_8)
        output = process.inputStream.bufferedReader(Charsets.UTF_8)
    }
    @Synchronized fun call(method: String, arguments: JsonObject = JsonObject()): JsonObject {
        check(!closed.get() && process.isAlive) { "Audio engine stopped. Reopen the studio session." }
        val id = sequence.incrementAndGet()
        val request = JsonObject().apply { addProperty("id", id); addProperty("method", method); add("arguments", arguments) }
        input.write(request.toString()); input.newLine(); input.flush()
        val future = reader.submit<JsonObject> {
            val line = StringBuilder()
            while (true) {
                val char = output.read()
                check(char >= 0) { "Audio engine disconnected." }
                if (char == 10) break
                check(line.length < 128 * 1024) { "Audio engine response exceeds limit." }
                line.append(char.toChar())
            }
            JsonParser.parseString(line.toString()).asJsonObject
        }
        val response = try { future.get(15, TimeUnit.SECONDS) }
        catch (cause: Exception) { future.cancel(true); close(); throw IllegalStateException("Audio engine did not respond.", cause) }
        response["error"]?.let { throw IllegalStateException(it.asString) }
        check(response["id"]?.asLong == id) { "Audio engine response mismatch." }
        return response.getAsJsonObject("result")
    }
    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        runCatching { process.outputStream.close() }
        if (!process.waitFor(500, TimeUnit.MILLISECONDS)) {
            process.descendants().forEach { it.destroy() }; process.destroy()
            if (!process.waitFor(1000, TimeUnit.MILLISECONDS)) process.destroyForcibly()
        }
        reader.shutdownNow(); runCatching { output.close() }
    }
}
