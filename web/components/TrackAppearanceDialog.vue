<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UIInput, UISelect, UIIcon, UIColorPicker, UIModal, UIPropertyColumns, UIPropertyRow } from '@devline/ui-web'
import { trackIcons, trackIcon } from '../trackAppearance'
import type { useStudio } from '../useStudio'
const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n(), id = useId(), name = ref(''), color = ref(''), icon = ref('')
const track = computed(() => s.document.value?.tracks.find(track => track.id === s.trackAppearance.value))
watch(() => s.trackAppearance.value, () => { if (track.value) { name.value = track.value.name; color.value = track.value.color ?? getComputedStyle(document.documentElement).getPropertyValue('--studio-track-default').trim(); icon.value = trackIcon(track.value) } })
const valid = computed(() => !!name.value.trim() && name.value.trim().length <= 200 && /^#[0-9a-f]{6}$/i.test(color.value))
async function save() {
  if (!valid.value || !track.value || !s.writable.value) return
  const target = track.value
  await s.edit(() => { target.name = name.value.trim(); target.color = color.value; target.icon = icon.value })
  s.trackAppearance.value = ''
}
</script>
<template>
  <UIModal :id="id" :open="!!track" :title="t('trackAppearance')" size="sm" @update:open="value => { if (!value) s.trackAppearance.value = '' }">
    <div class="studio-dialog-form" @keydown.enter.prevent="save">
      <UIPropertyColumns class="ui-form-properties" :label="t('resizeColumns')">
        <UIPropertyRow :label="t('name')"><UIInput v-model="name" variant="property" :aria-label="t('name')" :error-message="name && !name.trim() || name.length > 200 ? t('invalidTrackName') : undefined" /></UIPropertyRow>
        <UIPropertyRow :label="t('trackColor')"><UIColorPicker v-model="color" :aria-label="t('trackColor')" /><UIInput v-model="color" variant="property" :aria-label="t('trackColor')" /></UIPropertyRow>
        <UIPropertyRow :label="t('trackIcon')"><UIIcon :name="icon" /><UISelect v-model="icon" :options="trackIcons.map(value => ({ value, label: t(`icon-${value}`) }))" :aria-label="t('trackIcon')" /></UIPropertyRow>
      </UIPropertyColumns>
      <div class="studio-dialog-actions"><UIButton @click="s.trackAppearance.value = ''">{{ t('cancel') }}</UIButton><UIButton :disabled="!valid || !s.writable.value" @click="save">{{ t('save') }}</UIButton></div>
    </div>
  </UIModal>
</template>
