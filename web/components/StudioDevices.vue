<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { UIButton, UICheckbox, UIInput, UISelect, UISpoiler, UIPropertyColumns, UIPropertyRow } from '@devline/ui-web/controls'
import type { useStudio } from '../useStudio'
import { sdk } from '../sdk'
const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n()
</script>
<template>
<UIPropertyColumns v-if="s.document.value" class="ui-form-properties studio-property-grid studio-devices" data-ui-hover-scope="properties" :label="t('resizeColumns')">
<UISpoiler :label="t('midi')" >
<UIPropertyRow :label="(t('input'))"><UISelect :aria-label="(t('input'))" v-model="s.midiInput.value" :options="s.devices.value.midi.map(device => ({ label: device.name, value: device.name }))" clearable :placeholder="t('none')" /></UIPropertyRow>
          <UIPropertyRow :label="(t('channel'))"><UISelect :aria-label="(t('channel'))" v-model="s.inputChannel.value" :options="Array.from({ length: 16 }, (_, value) => ({ label: String(value + 1), value }))" clearable :placeholder="t('allChannels')" /></UIPropertyRow>
          <UIPropertyRow :label="(t('track'))"><UISelect :aria-label="(t('track'))" v-model="s.midiTrack.value" :options="s.document.value.tracks.filter(track => track.kind === 'instrument').map(track => ({ label: track.name, value: track.id }))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('overdub'))"><UICheckbox v-model="s.overdub.value" :aria-label="(t('overdub'))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('recordQuantize'))"><UICheckbox v-model="s.recordQuantize.value" :aria-label="(t('recordQuantize'))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('stepInput'))"><UICheckbox v-model="s.stepInput.value" :aria-label="(t('stepInput'))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('countIn'))"><UICheckbox v-model="s.countIn.value" :aria-label="(t('countIn'))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('metronome'))"><UICheckbox v-model="s.metronome.value" :aria-label="(t('metronome'))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('midiOutput'))"><UISelect :aria-label="(t('midiOutput'))" v-model="s.midiOutput.value" :options="s.devices.value.midiOutputs.map(device => ({ label: device.name, value: device.index }))" clearable :placeholder="t('none')" /></UIPropertyRow>
          <UIPropertyRow :label="'MIDI Clock'"><UICheckbox v-model="s.midiClock.value" :disabled="s.midiOutput.value === null" :aria-label="'MIDI Clock'" /></UIPropertyRow>
          <div class="studio-midi-log is-selectable" role="log" :aria-label="t('midi')"><div v-for="(event, index) in s.status.value.midi.slice(-5)" :key="index">{{ event.status.toString(16).toUpperCase() }} {{ event.data1 }} {{ event.data2 }}</div></div>
</UISpoiler>
<UISpoiler label="WASAPI"><UIPropertyRow :label="(t('output'))"><UISelect :aria-label="(t('output'))" v-model="s.output.value" :options="s.devices.value.outputs.map(device => ({ label: device.name, value: device.index }))" clearable :placeholder="t('systemDefault')" /></UIPropertyRow>
          <UIPropertyRow :label="(t('input'))"><UISelect :aria-label="(t('input'))" v-model="s.input.value" :options="s.devices.value.inputs.map(device => ({ label: device.name, value: device.index }))" clearable :placeholder="t('none')" /></UIPropertyRow>
          <UIPropertyRow :label="(t('channel'))"><UISelect :aria-label="(t('channel'))" v-model="s.captureChannels.value" :options="[{ label: t('stereo'), value: 0 }, { label: 'Mono L', value: 1 }, { label: 'Mono R', value: 2 }]" /></UIPropertyRow>
          <UIPropertyRow :label="(t('sampleRate'))"><UISelect :aria-label="(t('sampleRate'))" v-model="s.sampleRate.value" :options="[44100,48000,96000].map(value => ({ label: `${value} Hz`, value }))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('buffer'))"><UISelect :aria-label="(t('buffer'))" v-model="s.blockSize.value" :options="[128,256,512,1024].map(value => ({ label: String(value), value }))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('exclusive'))"><UICheckbox v-model="s.exclusive.value" :aria-label="(t('exclusive'))" /></UIPropertyRow>
          <UIPropertyRow :label="(t('monitor'))"><UICheckbox v-model="s.monitoring.value" :aria-label="(t('monitor'))" /></UIPropertyRow>
          <UIPropertyRow :label="t('inputLevel')"><meter min="0" max="1" :value="s.status.value.inputPeak" :aria-label="t('inputLevel')"></meter></UIPropertyRow>
          <div class="studio-toolbar"><UIButton variant="property" @click="s.safe(s.configure)">{{ t('apply') }}</UIButton></div></UISpoiler>
<UISpoiler :label="t('export')" >
<UIPropertyRow :label="(t('saveAs'))"><UIInput variant="property" :aria-label="(t('saveAs'))" v-model="s.saveAsPath.value" :placeholder="sdk.getContext().document?.path.replace(/\.dlmusic$/i, '-copy.dlmusic')" /></UIPropertyRow><UIButton variant="property" :disabled="!s.saveAsPath.value || s.writeConflict.value" @click="s.safe(s.saveAs)">{{ t('saveAs') }}</UIButton>
          <UIPropertyRow :label="(t('exportRegion'))"><UISelect :aria-label="(t('exportRegion'))" v-model="s.exportRegion.value" :options="['song','loop','pattern','selection','stems'].map(value => ({ label: t(value === 'pattern' ? 'patternRender' : value === 'loop' ? 'loopRender' : value), value }))" /></UIPropertyRow>
          <template v-if="s.exportRegion.value === 'selection'"><UIPropertyRow :label="t('loopStart')"><UIInput variant="property" v-model="s.exportStart.value" type="number" :aria-label="t('loopStart')" /></UIPropertyRow><UIPropertyRow :label="t('loopEnd')"><UIInput variant="property" v-model="s.exportEnd.value" type="number" :aria-label="t('loopEnd')" /></UIPropertyRow></template>
          <UIPropertyRow :label="(t('format'))"><UISelect :aria-label="(t('format'))" v-model="s.exportFormat.value" :options="[{ label: 'WAV', value: 'wav' }, { label: 'OGG Vorbis', value: 'ogg' }]" /></UIPropertyRow>
          <UIPropertyRow v-if="s.exportFormat.value === 'wav'" label="WAV"><UISelect v-model="s.exportBits.value" :options="[{ label: 'PCM16', value: 16 }, { label: 'PCM24', value: 24 }, { label: 'Float32', value: 32 }]" aria-label="WAV" /></UIPropertyRow>
          <UIPropertyRow :label="(t('tail'))"><UIInput variant="property" :aria-label="(t('tail'))" v-model="s.exportTail.value" type="number" /></UIPropertyRow>
          <UIPropertyRow :label="(t('crossfade'))"><UIInput variant="property" :aria-label="(t('crossfade'))" v-model="s.exportCrossfade.value" type="number" /></UIPropertyRow>
          <UIPropertyRow :label="(t('overwrite'))"><UICheckbox v-model="s.exportOverwrite.value" :aria-label="(t('overwrite'))" /></UIPropertyRow>
          <UIPropertyRow :label="t('projectPath')"><UIInput variant="property" v-model="s.exportPath.value" :aria-label="t('projectPath')" :placeholder="sdk.getContext().document?.path.replace(/\.dlmusic$/i, '.wav')" /></UIPropertyRow>
          <UIButton variant="property" :disabled="['queued','running'].includes(s.job.value?.status ?? '') || !s.writable.value" @click="s.safe(s.render)">{{ t('exportToProject') }}</UIButton>
          <UIButton variant="property" :disabled="!s.writable.value" @click="s.safe(s.exportMidi)">{{ t('exportMidi') }}</UIButton>
          <div v-if="s.job.value" role="status">{{ t(s.job.value.status) }}<span v-if="s.job.value.output" class="is-selectable"> · {{ s.job.value.output }}</span></div>
          <UIButton variant="property" v-if="['queued','running'].includes(s.job.value?.status ?? '')" @click="s.safe(() => s.call('job', { id: s.job.value!.id, cancel: true }))">{{ t('cancel') }}</UIButton>
</UISpoiler>
<UISpoiler :label="t('assignToGame')" >
<UIPropertyRow :label="t('gameLevel')"><UIInput variant="property" v-model="s.gameLevel.value" :aria-label="t('gameLevel')" placeholder="src/app/levels/Level.dllevel" /></UIPropertyRow>
          <UIButton variant="property" :disabled="!s.gameLevel.value" @click="s.safe(s.readGameTargets)">{{ t('readGameObjects') }}</UIButton>
          <template v-if="s.gameTargets.value.length"><UIPropertyRow :label="t('gameObject')"><UISelect v-model="s.gameEntity.value" :options="s.gameTargets.value.map(entity => ({ label: entity.name, value: entity.id }))" :aria-label="t('gameObject')" /></UIPropertyRow><UIPropertyRow :label="t('gameEvent')"><UISelect v-model="s.gameEvent.value" :options="['ready','spawn','jump','collision-enter','collision-exit','trigger-enter','trigger-exit'].map(value => ({ label: t(value), value }))" :aria-label="t('gameEvent')" /></UIPropertyRow><UIPropertyRow :label="(t('loop'))"><UICheckbox v-model="s.gameLoop.value" :aria-label="(t('loop'))" /></UIPropertyRow><UIButton variant="property" :disabled="s.job.value?.status !== 'completed' || !s.writable.value" @click="s.safe(s.assignGameAudio)">{{ t('assignToGame') }}</UIButton><span v-if="s.gameAssigned.value">{{ t('assignedToDraft') }}</span></template>
</UISpoiler>
<UISpoiler v-if="s.recoveries.value.length" :label="t('recoverRecording')"><UIButton variant="property" v-for="recording in s.recoveries.value" :key="recording.path" @click="s.safe(() => s.recoverRecording(recording))">{{ recording.path.split('/').pop() }}</UIButton></UISpoiler>
</UIPropertyColumns>
</template>
