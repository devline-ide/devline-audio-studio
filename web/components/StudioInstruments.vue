<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UICheckbox, UIIcon, UIInput, UIPropertyColumns, UIPropertyRow, UISpoiler, vUITooltip as vTippy } from '@devline/ui-web'
import type { useStudio } from '../useStudio'
import { uid } from '../model'
const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n(), query = ref('')
const kinds = ['synth', 'sampler', 'drums', 'sfx'] as const
const plugins = computed(() => s.plugins.value.filter(plugin => plugin.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const scanning = computed(() => ['queued', 'running'].includes(s.scanJob.value?.status ?? ''))
const importValid = computed(() => /\.(wav|ogg|midi?)$/i.test(s.importPath.value.trim()))
function addPlugin(plugin: typeof s.plugins.value[number]) {
  if (plugin.instrument) void s.addTrack('instrument', 'vst3', plugin)
  else void s.edit(() => s.track.value?.effects.push({ id: uid('fx'), kind: 'vst3', plugin: plugin.id, bypass: false, parameters: {} }))
}
function drop(event: DragEvent) {
  try {
    const entry = JSON.parse(event.dataTransfer?.getData('application/x-devline-project-file') ?? '{}')
    if (typeof entry.path === 'string' && !/(^|\/)\.\.(\/|$)|[:\\]|^\//.test(entry.path) && /\.(wav|ogg|midi?)$/i.test(entry.path)) s.importPath.value = entry.path
  } catch { /* Other drag formats do not change the selected project asset. */ }
}
</script>

<template>
  <UIPropertyColumns class="ui-form-properties studio-property-grid studio-library" :label="t('resizeColumns')">
    <UISpoiler :label="t('builtInInstruments')">
      <UIButton v-for="kind in kinds" :key="kind" class="studio-library-item" variant="quiet" :disabled="!s.writable.value" :aria-label="t('addInstrument', { name: t(kind) })" @click="s.addTrack('instrument', kind)">
        <UIIcon :name="kind === 'drums' ? 'grid-3x3' : kind === 'sfx' ? 'soundwave' : 'music-note-beamed'" :size="14" /><span>{{ t(kind) }}</span><UIIcon name="plus" :size="13" />
      </UIButton>
    </UISpoiler>
    <UISpoiler label="VST3">
      <template #actions><UIButton variant="quiet" :aria-label="t('scanPlugins')" v-tippy="t('scanPlugins')" :disabled="scanning" @click="s.safe(s.scanPlugins)"><UIIcon name="arrow-clockwise" :size="14" /></UIButton><UIButton v-if="scanning" variant="quiet" :aria-label="t('cancel')" @click="s.safe(() => s.call('job', { id: s.scanJob.value!.id, cancel: true }))"><UIIcon name="x" :size="14" /></UIButton></template>
      <UIPropertyRow :label="t('pluginDirectory')"><UIInput v-model="s.scanDirectory.value" variant="property" :aria-label="t('pluginDirectory')" :placeholder="t('standardPluginDirectories')" /></UIPropertyRow>
      <UIPropertyRow :label="t('retryPlugins')"><UICheckbox v-model="s.retryPlugins.value" :aria-label="t('retryPlugins')" /></UIPropertyRow>
      <UIInput v-model="query" class="studio-library-search" type="search" :aria-label="t('searchPlugins')" :placeholder="t('searchPlugins')" />
      <div class="studio-plugin-list" role="group" aria-label="VST3">
        <UIButton v-for="plugin in plugins" :key="plugin.id" class="studio-library-item" variant="quiet" :disabled="!s.writable.value || !plugin.instrument && !s.track.value" :aria-label="t('addPlugin', { name: plugin.name })" @click="addPlugin(plugin)"><UIIcon name="puzzle" :size="14" /><span>{{ plugin.name }}</span><small>{{ t(plugin.instrument ? 'instrument' : 'effect') }}</small><UIIcon name="plus" :size="13" /></UIButton>
        <p v-if="!plugins.length" class="studio-library-hint">{{ t(query ? 'noPluginMatches' : 'scanPluginsHint') }}</p>
      </div>
      <output v-if="s.scanJob.value" class="studio-library-status" role="status">{{ t('scanStatus') }}: {{ t(s.scanJob.value.status) }}<span v-if="s.failedPlugins.value"> · {{ t('problemPlugins') }}: {{ s.failedPlugins.value }}</span></output>
    </UISpoiler>
    <UISpoiler :label="t('import')">
      <div @dragover.prevent @drop.prevent="drop">
        <UIPropertyRow :label="t('projectPath')"><UIInput v-model="s.importPath.value" variant="property" :aria-label="t('projectPath')" placeholder="src/resources/audio.wav" @keydown.enter="importValid && s.safe(s.importFile)" /></UIPropertyRow>
        <p class="studio-library-hint">{{ t('importProjectHint') }}</p>
        <UIButton class="studio-library-import" variant="quiet" :disabled="!importValid || !s.writable.value" @click="s.safe(s.importFile)"><UIIcon name="box-arrow-in-down" :size="14" />{{ t('importSelected') }}<small>WAV / OGG / MIDI</small></UIButton>
      </div>
    </UISpoiler>
  </UIPropertyColumns>
</template>
