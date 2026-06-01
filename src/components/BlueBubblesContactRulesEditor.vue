<script setup>
import { ref, watch } from 'vue'
import { createDefaultContactRule, DEFAULT_CONTACT_SYSTEM_PROMPT } from '../constants/blueBubblesContactRules.js'
import OpenRouterModelPicker from './OpenRouterModelPicker.vue'

const props = defineProps({
  rules: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:rules'])

/** @type {import('vue').Ref<import('../constants/blueBubblesContactRules.js').ContactRule[]>} */
const localRules = ref([])

watch(
  () => props.rules,
  (v) => {
    localRules.value = Array.isArray(v) ? v.map((r) => createDefaultContactRule(r)) : []
  },
  { immediate: true, deep: true },
)

function emitUpdate() {
  emit('update:rules', localRules.value.map((r) => ({ ...r })))
}

function addRule() {
  localRules.value.push(createDefaultContactRule({ label: 'New contact' }))
  emitUpdate()
}

/** @param {number} idx */
function removeRule(idx) {
  localRules.value.splice(idx, 1)
  emitUpdate()
}

/** @param {number} idx */
function duplicateRule(idx) {
  const src = localRules.value[idx]
  if (!src) return
  localRules.value.push(
    createDefaultContactRule({
      ...src,
      id: `rule-${Date.now()}`,
      label: `${src.label || 'Contact'} (copy)`,
    }),
  )
  emitUpdate()
}

/** @param {number} idx */
function onFieldChange(idx) {
  void idx
  emitUpdate()
}

/** @param {number} idx */
function onAiMediumChange(idx) {
  const rule = localRules.value[idx]
  if (rule?.aiMediumEnabled) rule.autoReplyEnabled = false
  emitUpdate()
}

/** @param {number} idx */
function onAutoReplyChange(idx) {
  const rule = localRules.value[idx]
  if (rule?.autoReplyEnabled) rule.aiMediumEnabled = false
  emitUpdate()
}

/** @param {number} idx */
function triggersText(idx) {
  return (localRules.value[idx]?.keywordTriggers || []).join(', ')
}

/** @param {number} idx @param {string} val */
function setTriggers(idx, val) {
  const rule = localRules.value[idx]
  if (!rule) return
  rule.keywordTriggers = String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  emitUpdate()
}

/** @param {number} idx */
function ignoreText(idx) {
  return (localRules.value[idx]?.ignoreKeywords || []).join(', ')
}

/** @param {number} idx @param {string} val */
function setIgnore(idx, val) {
  const rule = localRules.value[idx]
  if (!rule) return
  rule.ignoreKeywords = String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  emitUpdate()
}
</script>

<template>
  <div class="bb-rules">
    <p class="bb-rules-intro">
      Per-contact automation: read messages aloud, AI chat medium (direct OpenRouter passthrough),
      assistant auto-replies, keyword filters, quiet hours, and rate limits.
      Match by phone/email handle or chat GUID.
    </p>
    <div v-if="!localRules.length" class="bb-rules-empty">
      <p>No contact rules yet. Add one to enable tailored TTS and AI replies.</p>
    </div>
    <article
      v-for="(rule, idx) in localRules"
      :key="rule.id"
      class="bb-rule-card"
    >
      <header class="bb-rule-head">
        <label class="toggle-switch" :title="rule.enabled ? 'Rule enabled' : 'Rule disabled'">
          <input v-model="rule.enabled" type="checkbox" @change="onFieldChange(idx)" />
          <span class="toggle-slider"></span>
        </label>
        <input
          v-model="rule.label"
          class="inp tap bb-rule-label-inp"
          type="text"
          placeholder="Contact label"
          @change="onFieldChange(idx)"
        />
        <div class="bb-rule-actions">
          <button type="button" class="btn tap bb-rule-btn" @click="duplicateRule(idx)">Copy</button>
          <button type="button" class="btn tap bb-rule-btn bb-rule-btn-danger" @click="removeRule(idx)">Remove</button>
        </div>
      </header>

      <div class="bb-rule-grid">
        <label class="lbl">Handle (phone / email)</label>
        <input
          v-model="rule.handle"
          class="inp tap"
          type="text"
          placeholder="+15551234567 or name@icloud.com"
          @change="onFieldChange(idx)"
        />

        <label class="lbl">Chat GUID (optional)</label>
        <input
          v-model="rule.chatGuid"
          class="inp tap"
          type="text"
          placeholder="any;-;+15551234567"
          @change="onFieldChange(idx)"
        />

        <div class="bb-rule-toggles">
          <label class="bb-toggle-row bb-toggle-feature">
            <input
              v-model="rule.aiMediumEnabled"
              type="checkbox"
              @change="onAiMediumChange(idx)"
            />
            <span class="bb-toggle-label">
              <strong>AI chat medium</strong>
              <small>Incoming message → OpenRouter → reply sent back (no rate limits)</small>
            </span>
          </label>
          <label class="bb-toggle-row">
            <input
              v-model="rule.autoReplyEnabled"
              type="checkbox"
              @change="onAutoReplyChange(idx)"
            />
            <span>OpenRouter auto-reply (assistant)</span>
          </label>
          <label class="bb-toggle-row">
            <span>TTS:</span>
            <select v-model="rule.ttsEnabled" class="inp tap bb-tts-select" @change="onFieldChange(idx)">
              <option :value="null">Use global</option>
              <option :value="true">Always read aloud</option>
              <option :value="false">Never read aloud</option>
            </select>
          </label>
          <template v-if="!rule.aiMediumEnabled">
            <label class="bb-toggle-row">
              <input v-model="rule.includeTripContext" type="checkbox" @change="onFieldChange(idx)" />
              <span>Include trip context in prompt</span>
            </label>
            <label class="bb-toggle-row">
              <input v-model="rule.onlyWhenMonitoredChat" type="checkbox" @change="onFieldChange(idx)" />
              <span>Only in monitored chat</span>
            </label>
          </template>
        </div>

        <template v-if="rule.aiMediumEnabled">
          <label class="lbl">Model (optional — uses Settings default if empty)</label>
          <OpenRouterModelPicker
            :model-value="rule.replyModel"
            input-id="bb-rule-ai-medium-model"
            optional
            preload-catalog
            @update:model-value="(v) => { rule.replyModel = v; onFieldChange(idx) }"
          />
        </template>

        <template v-else>
        <label class="lbl">System prompt (OpenRouter)</label>
        <textarea
          v-model="rule.systemPrompt"
          class="inp tap bb-prompt-area"
          rows="4"
          :placeholder="DEFAULT_CONTACT_SYSTEM_PROMPT"
          @change="onFieldChange(idx)"
        />

        <label class="lbl">Reply model (optional)</label>
        <OpenRouterModelPicker
          :model-value="rule.replyModel"
          input-id="bb-rule-reply-model"
          optional
          preload-catalog
          @update:model-value="(v) => { rule.replyModel = v; onFieldChange(idx) }"
        />

        <label class="lbl">Keyword triggers (comma-separated, empty = all)</label>
        <input
          class="inp tap"
          type="text"
          :value="triggersText(idx)"
          placeholder="eta, where, help"
          @input="setTriggers(idx, $event.target.value)"
        />

        <label class="lbl">Ignore keywords</label>
        <input
          class="inp tap"
          type="text"
          :value="ignoreText(idx)"
          placeholder="spam, unsubscribe"
          @input="setIgnore(idx, $event.target.value)"
        />

        <div class="bb-rule-row-2">
          <div>
            <label class="lbl">Quiet hours start</label>
            <input v-model="rule.quietHoursStart" class="inp tap" type="time" @change="onFieldChange(idx)" />
          </div>
          <div>
            <label class="lbl">Quiet hours end</label>
            <input v-model="rule.quietHoursEnd" class="inp tap" type="time" @change="onFieldChange(idx)" />
          </div>
        </div>

        <div class="bb-rule-row-2">
          <div>
            <label class="lbl">Cooldown (seconds)</label>
            <input v-model.number="rule.cooldownSeconds" class="inp tap" type="number" min="0" max="600" @change="onFieldChange(idx)" />
          </div>
          <div>
            <label class="lbl">Max replies / hour</label>
            <input v-model.number="rule.maxRepliesPerHour" class="inp tap" type="number" min="0" max="120" @change="onFieldChange(idx)" />
          </div>
        </div>
        </template>
      </div>
    </article>

    <button type="button" class="btn primary tap bb-add-rule" @click="addRule">Add contact rule</button>
  </div>
</template>

<style scoped>
.bb-rules-intro {
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.45;
  color: var(--color-text-tertiary, #6e6e7e);
  margin: 0 0 0.75rem;
  max-width: 40rem;
}
.bb-rules-empty {
  padding: 0.75rem 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #a8a8b8);
}
.bb-rule-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md, 0.5rem);
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  background: rgba(255, 255, 255, 0.02);
}
.bb-rule-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}
.bb-rule-label-inp {
  flex: 1 1 8rem;
  min-width: 0;
  font-weight: 600;
}
.bb-rule-actions {
  display: flex;
  gap: 0.35rem;
  margin-left: auto;
}
.bb-rule-btn {
  min-height: 2rem;
  padding: 0.25rem 0.55rem;
  font-size: 0.72rem;
}
.bb-rule-btn-danger {
  color: #ffb4b4;
}
.bb-rule-grid {
  display: grid;
  gap: 0.35rem;
}
.bb-rule-toggles {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0.35rem 0;
}
.bb-toggle-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #c4c4d4);
}
.bb-toggle-feature {
  align-items: flex-start;
}
.bb-toggle-label {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  line-height: 1.35;
}
.bb-toggle-label small {
  font-size: 0.68rem;
  opacity: 0.72;
  font-weight: 400;
}
.bb-tts-select {
  width: auto;
  min-width: 9rem;
}
.bb-prompt-area {
  min-height: 5rem;
  resize: vertical;
  font-family: inherit;
  line-height: 1.4;
}
.bb-rule-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.bb-add-rule {
  margin-top: 0.25rem;
}
@media (max-width: 520px) {
  .bb-rule-row-2 {
    grid-template-columns: 1fr;
  }
}
</style>
