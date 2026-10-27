<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UIIcon, UIInfoTip, UISelect, UISwitch } from '@devline/ui-web/controls'
import { sdk } from '../sdk'
import { defaultPreferences, type StudioPreferences } from '../preferences'

const { t, locale } = useI18n()
const draft = reactive(defaultPreferences()), baseline = ref(''), busy = ref(false), error = ref(''), devicesError = ref('')
type Device = { index: number; name: string }
const devices = ref<{ outputs: Device[]; inputs: Device[]; midi: Device[]; midiOutputs: Device[] }>({ outputs: [], inputs: [], midi: [], midiOutputs: [] })
const dirty = computed(() => baseline.value !== JSON.stringify(draft))
const unsubscribe = sdk.onContextChanged(context => { locale.value = context.locale.startsWith('ru') ? 'ru' : 'en' })
onBeforeUnmount(unsubscribe)
function options(values: Device[], selected: string | null) {
  const names = [...new Set(values.map(value => value.name))]
  if (selected && !names.includes(selected)) names.unshift(selected)
  return names.map(name => ({ label: name, value: name }))
}
async function load() {
  busy.value = true; error.value = ''
  try { Object.assign(draft, await sdk.call<StudioPreferences>('preferences')); baseline.value = JSON.stringify(draft) }
  catch { error.value = t('preferencesLoadFailed') }
  finally { busy.value = false }
}
async function refreshDevices() {
  devicesError.value = ''
  try { devices.value = await sdk.call<typeof devices.value>('devices') }
  catch { devicesError.value = t('preferencesDevicesFailed') }
}
async function save() {
  busy.value = true; error.value = ''
  try { Object.assign(draft, await sdk.call<StudioPreferences>('preferences', { value: { ...draft } })); baseline.value = JSON.stringify(draft) }
  catch { error.value = t('preferencesSaveFailed') }
  finally { busy.value = false }
}
void load(); void refreshDevices()
</script>

<template>
  <main class="studio-preferences">
    <div v-if="error" role="alert" class="studio-preferences-error">{{ error }}</div>
    <div class="studio-preferences-heading"><h2>{{ t('audioDevices') }}</h2><UIInfoTip :label="t('audioDevices')" :text="t('preferencesHint')" /><UIButton :aria-label="t('refreshDevices')" @click="refreshDevices"><UIIcon name="arrow-clockwise" /></UIButton></div>
    <div v-if="devicesError" role="status" class="studio-preferences-hint">{{ devicesError }}</div>
    <div class="studio-preferences-fields">
      <div class="studio-preferences-row"><label for="studio-settings-outputName">{{ t('output') }}</label><div class="studio-preferences-control"><UISelect input-id="studio-settings-outputName" v-model="draft.outputName" :disabled="busy" :options="options(devices.outputs, draft.outputName)" clearable :placeholder="t('systemDefault')" :aria-label="t('output')" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-inputName">{{ t('input') }}</label><div class="studio-preferences-control"><UISelect input-id="studio-settings-inputName" v-model="draft.inputName" :disabled="busy" :options="options(devices.inputs, draft.inputName)" clearable :placeholder="t('none')" :aria-label="t('input')" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-sampleRate">{{ t('sampleRate') }}</label><div class="studio-preferences-control"><UISelect input-id="studio-settings-sampleRate" v-model="draft.sampleRate" :disabled="busy" :options="[44100,48000,96000].map(value => ({ label: `${value} Hz`, value }))" :aria-label="t('sampleRate')" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-blockSize">{{ t('buffer') }}</label><div class="studio-preferences-control"><UISelect input-id="studio-settings-blockSize" v-model="draft.blockSize" :disabled="busy" :options="[128,256,512,1024].map(value => ({ label: String(value), value }))" :aria-label="t('buffer')" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-exclusive">{{ t('exclusive') }}</label><div class="studio-preferences-control"><UISwitch id="studio-settings-exclusive" v-model="draft.exclusive" :disabled="busy" :aria-label="t('exclusive')" /></div></div>
    </div>
    <h2>{{ t('midi') }}</h2>
    <div class="studio-preferences-fields">
      <div class="studio-preferences-row"><label for="studio-settings-midiName">{{ t('input') }}</label><div class="studio-preferences-control"><UISelect input-id="studio-settings-midiName" v-model="draft.midiName" :disabled="busy" :options="options(devices.midi, draft.midiName)" clearable :placeholder="t('none')" :aria-label="`${t('midi')} ${t('input')}`" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-midiOutputName">{{ t('midiOutput') }}</label><div class="studio-preferences-control"><UISelect input-id="studio-settings-midiOutputName" v-model="draft.midiOutputName" :disabled="busy" :options="options(devices.midiOutputs, draft.midiOutputName)" clearable :placeholder="t('none')" :aria-label="t('midiOutput')" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-inputChannel">{{ t('channel') }}</label><div class="studio-preferences-control"><UISelect input-id="studio-settings-inputChannel" v-model="draft.inputChannel" :disabled="busy" :options="Array.from({ length: 16 }, (_, value) => ({ label: String(value + 1), value }))" clearable :placeholder="t('allChannels')" :aria-label="t('channel')" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-countIn">{{ t('countIn') }}</label><div class="studio-preferences-control"><UISwitch id="studio-settings-countIn" v-model="draft.countIn" :disabled="busy" :aria-label="t('countIn')" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-metronome">{{ t('metronome') }}</label><div class="studio-preferences-control"><UISwitch id="studio-settings-metronome" v-model="draft.metronome" :disabled="busy" :aria-label="t('metronome')" /></div></div>
      <div class="studio-preferences-row"><label for="studio-settings-followPlayhead">{{ t('followPlayhead') }}</label><div class="studio-preferences-control"><UISwitch id="studio-settings-followPlayhead" v-model="draft.followPlayhead" :disabled="busy" :aria-label="t('followPlayhead')" /></div></div>
    </div>
    <div class="studio-preferences-actions studio-preferences-footer"><UIButton variant="primary" :disabled="busy || !baseline || !dirty" @click="save">{{ t('save') }}</UIButton><UIButton :disabled="busy || !baseline || !dirty" @click="Object.assign(draft, JSON.parse(baseline))">{{ t('cancel') }}</UIButton><UIButton v-if="!baseline" :disabled="busy" @click="load">{{ t('retry') }}</UIButton></div>
  </main>
</template>
