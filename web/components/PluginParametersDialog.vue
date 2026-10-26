<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UIIcon, UIInput, UIModal, UIPropertyColumns, UIPropertyRow, UISlider } from '@devline/ui-web'
import type { useStudio } from '../useStudio'
const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n(), id = useId(), search = ref(''), offset = ref(0), loading = ref(false)
const descriptor = computed(() => s.pluginParametersEffect.value === 'instrument' ? s.track.value?.instrument : s.track.value?.effects.find(effect => effect.id === s.pluginParametersEffect.value))
const title = computed(() => `${t('parameters')}: ${s.plugins.value.find(plugin => plugin.id === descriptor.value?.plugin)?.name ?? s.track.value?.name ?? 'VST3'}`)
const target = (parameter: number) => s.pluginParametersEffect.value === 'instrument' ? `instrument/${parameter}` : `fx/${s.pluginParametersEffect.value}/${parameter}`
let timer: ReturnType<typeof setTimeout> | undefined, generation = 0
async function load() {
  const request = ++generation
  loading.value = true
  await s.safe(async () => { await s.finishGesture(); await s.readPluginParameters(s.pluginParametersEffect.value, offset.value, search.value.trim()) })
  if (request === generation) loading.value = false
}
function close() { s.parameterDialog.value = false; generation++; clearTimeout(timer); void s.safe(() => s.finishGesture()) }
watch(() => s.parameterDialog.value, open => { if (open) { search.value = ''; offset.value = 0; void load() } else { generation++; clearTimeout(timer); void s.safe(() => s.finishGesture()) } })
watch(search, () => { clearTimeout(timer); offset.value = 0; timer = setTimeout(() => { if (s.parameterDialog.value) void load() }, 200) })
watch([s.selectedTrack, () => descriptor.value?.plugin, s.pluginParametersEffect], () => { if (s.parameterDialog.value) close() }, { flush: 'sync' })
async function page(delta: number) { if (loading.value) return; offset.value = Math.max(0, offset.value + delta * 64); await load() }
onBeforeUnmount(() => { clearTimeout(timer); generation++ })
</script>
<template>
  <UIModal :id="id" :open="s.parameterDialog.value" :title="title" size="md" @update:open="value => { if (!value) close() }">
    <div class="studio-parameter-dialog" :aria-busy="loading">
      <div class="studio-toolbar"><UIInput v-model="search" :placeholder="t('searchParameters')" :aria-label="t('searchParameters')" /><span class="studio-spacer"></span><output>{{ s.pluginParameterTotal.value }}</output></div>
      <div class="studio-parameter-list">
        <UIPropertyColumns class="ui-form-properties" :label="t('resizeColumns')">
          <UIPropertyRow v-for="parameter in s.pluginParameters.value" :key="parameter.id" :label="parameter.name">
            <UISlider :model-value="s.displayParameter(s.track.value!, target(parameter.id))" :min="0" :max="1" :step=".001" :disabled="parameter.readOnly || !s.writable.value || loading" :aria-label="parameter.name" @pointerdown="s.beginGesture(s.track.value!, target(parameter.id))" @update:model-value="value => s.previewParameter(s.track.value!, target(parameter.id), value)" @change="s.safe(() => s.finishGesture())" @keydown.esc.stop="s.safe(() => s.finishGesture(true))" @pointercancel="s.safe(() => s.finishGesture(true))" />
            <output>{{ Math.round(s.displayParameter(s.track.value!, target(parameter.id)) * 1000) / 10 }}%</output>
          </UIPropertyRow>
        </UIPropertyColumns>
        <p v-if="!loading && !s.pluginParameters.value.length" class="studio-library-hint">{{ t('noParameters') }}</p>
      </div>
      <div class="studio-toolbar"><UIButton :disabled="loading || offset === 0" :aria-label="t('previousPage')" @click="page(-1)"><UIIcon name="chevron-left" /></UIButton><span>{{ s.pluginParameterTotal.value ? offset + 1 : 0 }}–{{ Math.min(offset + 64, s.pluginParameterTotal.value) }} / {{ s.pluginParameterTotal.value }}</span><UIButton :disabled="loading || offset + 64 >= s.pluginParameterTotal.value" :aria-label="t('nextPage')" @click="page(1)"><UIIcon name="chevron-right" /></UIButton><span class="studio-spacer"></span><UIButton @click="close">{{ t('close') }}</UIButton></div>
    </div>
  </UIModal>
</template>
