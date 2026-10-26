package devline.audio.studio

import com.google.gson.JsonArray
import devline.audio.MusicComposition

/** Resolve the actual saved/draft slot before addressing a native worker. Never guess by track name. */
internal fun studioPluginId(document: MusicComposition, trackId: String, effectId: String): String {
    val track = document.tracks.singleOrNull { it.id == trackId }
        ?: error("Unknown track '$trackId'. Read documentRead section tracks and copy its actual id.")
    val kind: String
    val plugin: String?
    if (effectId == "instrument") { kind = track.instrument.kind; plugin = track.instrument.plugin }
    else {
        val effect = track.effects.singleOrNull { it.id == effectId }
            ?: error("Unknown effect '$effectId' on track '$trackId'. Copy the effect id from documentRead tracks.")
        kind = effect.kind; plugin = effect.plugin
    }
    check(kind == "vst3" && !plugin.isNullOrBlank()) {
        "Track '$trackId', slot '$effectId' uses '$kind', not a VST3 instance. Assign a discovered plugin id to that slot with documentEdit, then openSaved."
    }
    return plugin
}

internal fun studioPluginReady(status: JsonArray, track: String, effect: String, plugin: String) {
    val key = "$track/$effect"
    val entries = status.map { it.asJsonObject }
    val warning = entries.firstOrNull { it["plugin"]?.asString == key }?.get("error")?.asString
    check(warning == null) { "VST3 '$plugin' in '$key' could not load: $warning. Inspect the plugin catalog; after correcting it, call openSaved to reload the clean saved score." }
    val instance = entries.firstOrNull { it["id"]?.asString == key }
    check(instance != null && instance["failed"]?.asBoolean != true) {
        "VST3 '$plugin' in '$key' has no active worker. Call openSaved to reload the clean saved score; preserve unsaved editor/plugin changes first."
    }
}
