<script setup>
import { ref, watch, computed } from 'vue'
import {
  createDefaultContactRule,
  DEFAULT_CONTACT_SYSTEM_PROMPT,
} from '../constants/blueBubblesContactRules.js'
import {
  getOrCreateContactRule,
  persistContactRule,
} from '../utils/blueBubblesContactRulesStore.js'
import OpenRouterModelPicker from './OpenRouterModelPicker.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  chatGuid: { type: String, default: '' },
  handle: { type: String, default: '' },
  contactLabel: { type: String, default: '' },
})

const emit = defineEmits(['close', 'saved'])

/** @type {import('vue').Ref<import('../constants/blueBubblesContactRules.js').ContactRule>} */
const rule = ref(createDefaultContactRule())

const saveMsg = ref('')
const saving = ref(false)

const keywordText = computed({
  get: () => (rule.value.keywordTriggers || []).join(', '),
  set: (v) => {
    rule.value.keywordTriggers = String(v)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  },
})

const ignoreText = computed({
  get: () => (rule.value.ignoreKeywords || []).join(', '),
  set: (v) => {
    rule.value.ignoreKeywords = String(v)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  },
})

function loadRule() {
  rule.value = getOrCreateContactRule({
    chatGuid: props.chatGuid,
    handle: props.handle,
    label: props.contactLabel,
  })
  saveMsg.value = ''
}

watch(
  () => [props.open, props.chatGuid, props.handle],
  ([open]) => {
    if (open) loadRule()
  },
  { immediate: true },
)

async function onSave() {
  saving.value = true
  saveMsg.value = 'Saving…'
  try {
    rule.value.chatGuid = props.chatGuid
    rule.value.handle = props.handle || rule.value.handle
    rule.value.label = props.contactLabel || rule.value.label
    await persistContactRule(rule.value)
    saveMsg.value = 'Saved for this contact.'
    emit('saved', rule.value)
    setTimeout(() => emit('close'), 600)
  } catch (e) {
    saveMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

function onBackdrop(e) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="im-auto-backdrop" @click="onBackdrop">
      <div class="im-auto-sheet" role="dialog" aria-labelledby="im-auto-title" @click.stop>
        <header class="im-auto-head">
          <h2 id="im-auto-title" class="im-auto-title">Automation</h2>
          <p class="im-auto-sub">{{ contactLabel || handle || chatGuid }}</p>
          <button type="button" class="im-auto-close tap" aria-label="Close" @click="emit('close')">×</button>
        </header>

        <div class="im-auto-body">
          <p class="im-auto-intro">
            Speech and OpenRouter auto-replies for this conversation only. Requires OpenRouter key in
            Settings → General → API.
          </p>

          <label class="im-toggle-row">
            <span class="toggle-switch">
              <input v-model="rule.ttsEnabled" type="checkbox" />
              <span class="toggle-slider"></span>
            </span>
            <span>Read new messages aloud</span>
          </label>

          <label class="im-toggle-row">
            <span class="toggle-switch">
              <input v-model="rule.autoReplyEnabled" type="checkbox" />
              <span class="toggle-slider"></span>
            </span>
            <span>OpenRouter auto-reply</span>
          </label>

          <label class="im-toggle-row">
            <input v-model="rule.includeTripContext" type="checkbox" />
            <span>Include trip context in prompt</span>
          </label>

          <label class="lbl">Reply instructions (system prompt)</label>
          <textarea
            v-model="rule.systemPrompt"
            class="inp tap im-prompt"
            rows="5"
            :placeholder="DEFAULT_CONTACT_SYSTEM_PROMPT"
          />

          <label class="lbl">Reply model (optional)</label>
          <OpenRouterModelPicker v-model="rule.replyModel" />

          <label class="lbl">Keyword triggers (comma-separated, empty = all messages)</label>
          <input v-model="keywordText" class="inp tap" type="text" placeholder="eta, where, help" />

          <label class="lbl">Ignore keywords</label>
          <input v-model="ignoreText" class="inp tap" type="text" placeholder="spam" />

          <div class="im-auto-row2">
            <div>
              <label class="lbl">Quiet start</label>
              <input v-model="rule.quietHoursStart" class="inp tap" type="time" />
            </div>
            <div>
              <label class="lbl">Quiet end</label>
              <input v-model="rule.quietHoursEnd" class="inp tap" type="time" />
            </div>
          </div>

          <div class="im-auto-row2">
            <div>
              <label class="lbl">Cooldown (sec)</label>
              <input v-model.number="rule.cooldownSeconds" class="inp tap" type="number" min="0" max="600" />
            </div>
            <div>
              <label class="lbl">Max replies / hr</label>
              <input v-model.number="rule.maxRepliesPerHour" class="inp tap" type="number" min="0" max="120" />
            </div>
          </div>
        </div>

        <footer class="im-auto-foot">
          <p v-if="saveMsg" class="im-auto-msg">{{ saveMsg }}</p>
          <button type="button" class="btn tap" @click="emit('close')">Cancel</button>
          <button type="button" class="btn primary tap" :disabled="saving" @click="onSave">
            {{ saving ? 'Saving…' : 'Save for contact' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.im-auto-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
}
.im-auto-sheet {
  width: 100%;
  max-width: 32rem;
  max-height: min(88dvh, 88vh);
  background: var(--color-bg-surface, #16161d);
  border-radius: 1rem 1rem 0 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.im-auto-head {
  position: relative;
  padding: 1rem 1rem 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.im-auto-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}
.im-auto-sub {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  opacity: 0.7;
}
.im-auto-close {
  position: absolute;
  top: 0.65rem;
  right: 0.65rem;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font-size: 1.25rem;
  line-height: 1;
}
.im-auto-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.im-auto-intro {
  font-size: 0.72rem;
  opacity: 0.75;
  margin: 0 0 0.35rem;
  line-height: 1.4;
}
.im-toggle-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.82rem;
  margin: 0.15rem 0;
}
.im-prompt {
  min-height: 5.5rem;
  resize: vertical;
  font-family: inherit;
}
.im-auto-row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.im-auto-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.65rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.im-auto-msg {
  flex: 1 1 100%;
  margin: 0 0 0.25rem;
  font-size: 0.72rem;
  opacity: 0.85;
}
@media (min-width: 640px) {
  .im-auto-backdrop {
    align-items: center;
    padding: 1rem;
  }
  .im-auto-sheet {
    border-radius: 1rem;
    max-height: 85vh;
  }
}
</style>
