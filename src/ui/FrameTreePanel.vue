<template>
  <div ref="panelRoot" class="frame-tree">
    <div class="frame-tree-head">
      <h2 class="frame-tree-title">{{ t('frameTree.title') }}</h2>
    </div>
    <div v-if="flatRows.length === 0" class="frame-tree-empty">
      {{ t('frameTree.empty') }}
    </div>
    <div v-else class="frame-tree-scroll">
      <div
        v-for="{ node, depth } in flatRows"
        :key="node.id"
        class="frame-tree-row"
        :style="{ paddingLeft: `${10 + depth * 14}px` }"
      >
        <input
          type="checkbox"
          class="frame-tree-cb"
          :data-node-id="node.id"
          :checked="rowChecked(node)"
          :disabled="!rowHasFrames(node)"
          @change="onToggle(node)"
        />
        <span class="frame-tree-name" :title="node.name">{{ node.name }}</span>
        <span class="frame-tree-type">{{ node.type }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { I18N_INJECT_KEY } from './i18n/injectionKey'
import type { FrameTreeNodeWire } from '../types/frameTree'

const i18n = inject(I18N_INJECT_KEY)!
const { t } = i18n

const props = defineProps<{
  roots: FrameTreeNodeWire[];
  modelValue: readonly string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [ids: string[]];
}>();

const panelRoot = ref<HTMLElement | null>(null);

/** node id -> 子树内所有 FRAME id（去重） */
const framesUnder = computed(() => {
  const map = new Map<string, string[]>();
  function collectUnique(n: FrameTreeNodeWire): Set<string> {
    const s = new Set<string>();
    if (n.isExportFrame) {
      s.add(n.id);
    }
    for (const c of n.children) {
      for (const id of collectUnique(c)) {
        s.add(id);
      }
    }
    return s;
  }
  function fill(n: FrameTreeNodeWire): void {
    map.set(n.id, Array.from(collectUnique(n)));
    for (const c of n.children) {
      fill(c);
    }
  }
  for (const r of props.roots) {
    fill(r);
  }
  return map;
});

const flatRows = computed(() => {
  const out: { node: FrameTreeNodeWire; depth: number }[] = [];
  function walk(n: FrameTreeNodeWire, depth: number): void {
    out.push({ node: n, depth });
    for (const c of n.children) {
      walk(c, depth + 1);
    }
  }
  for (const r of props.roots) {
    walk(r, 0);
  }
  return out;
});

const selectedSet = computed(() => new Set(props.modelValue));

function rowHasFrames(n: FrameTreeNodeWire): boolean {
  return (framesUnder.value.get(n.id) ?? []).length > 0;
}

function rowChecked(n: FrameTreeNodeWire): boolean {
  const ids = framesUnder.value.get(n.id) ?? [];
  if (ids.length === 0) {
    return false;
  }
  return ids.every((id) => selectedSet.value.has(id));
}

function rowIndeterminate(n: FrameTreeNodeWire): boolean {
  const ids = framesUnder.value.get(n.id) ?? [];
  if (ids.length === 0) {
    return false;
  }
  let c = 0;
  for (const id of ids) {
    if (selectedSet.value.has(id)) {
      c += 1;
    }
  }
  return c > 0 && c < ids.length;
}

function onToggle(n: FrameTreeNodeWire): void {
  const ids = framesUnder.value.get(n.id) ?? [];
  if (ids.length === 0) {
    return;
  }
  const allOn = ids.every((id) => selectedSet.value.has(id));
  const next = new Set(props.modelValue);
  if (allOn) {
    for (const id of ids) {
      next.delete(id);
    }
  } else {
    for (const id of ids) {
      next.add(id);
    }
  }
  emit('update:modelValue', Array.from(next));
}

function syncIndeterminate(): void {
  const root = panelRoot.value;
  if (!root) {
    return;
  }
  root.querySelectorAll<HTMLInputElement>('input.frame-tree-cb[data-node-id]').forEach((inp) => {
    const id = inp.getAttribute('data-node-id');
    if (!id) {
      return;
    }
    const node = findNodeById(id);
    if (!node) {
      return;
    }
    inp.indeterminate = rowIndeterminate(node);
  });
}

function findNodeById(id: string): FrameTreeNodeWire | null {
  function walk(n: FrameTreeNodeWire): FrameTreeNodeWire | null {
    if (n.id === id) {
      return n;
    }
    for (const c of n.children) {
      const f = walk(c);
      if (f) {
        return f;
      }
    }
    return null;
  }
  for (const r of props.roots) {
    const f = walk(r);
    if (f) {
      return f;
    }
  }
  return null;
}

watch(
  () => props.roots,
  () => {
    void nextTick(() => {
      syncIndeterminate();
    });
  },
  { deep: true },
);
watch(
  () => [...props.modelValue],
  () => {
    void nextTick(() => {
      syncIndeterminate();
    });
  },
);

onMounted(() => {
  void nextTick(() => {
    syncIndeterminate();
  });
});
</script>

<style scoped>
.frame-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fafafa;
  overflow: hidden;
}
.frame-tree-head {
  flex-shrink: 0;
  padding: 8px 10px;
  border-bottom: 1px solid #f0f0f0;
  background: #fff;
}
.frame-tree-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.frame-tree-empty {
  padding: 12px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.35);
}
.frame-tree-scroll {
  flex: 1;
  min-height: 120px;
  max-height: 420px;
  overflow: auto;
  background: #fff;
}
.frame-tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 5px 0;
  border-bottom: 1px solid #f5f5f5;
  font-size: 12px;
}
.frame-tree-row:hover {
  background: #fafafa;
}
.frame-tree-cb {
  flex-shrink: 0;
}
.frame-tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frame-tree-type {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(0, 0, 0, 0.45);
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
