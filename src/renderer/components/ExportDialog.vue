<script setup lang="ts">
/**
 * 导出选项对话框。
 *
 * 组件本身**不认识格式以外的业务**：它把 `draft` 摊开成控件，确认时交给
 * `exportDialog.confirm()`。真正的流程（选路径、调 IPC、报错）在 commands/index.ts 里。
 *
 * M4 加 DOCX 段的方式：复制「PDF 段」那块，`v-if="dialog.format === 'docx'"`，
 * 绑定 `draft.docx.*`。字段在 `DEFAULT_EXPORT_OPTIONS` 里已经存在，所以今天就能往返，
 * 不需要动 store 与命令实现。
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useExportDialogStore } from '../stores/exportDialog'

const dialog = useExportDialogStore()
const panel = ref<HTMLElement | null>(null)

const FORMAT_LABELS: Record<string, string> = {
  html: 'HTML',
  pdf: 'PDF',
  docx: 'DOCX'
}

const PAGE_SIZES = ['A4', 'A3', 'Letter', 'Legal'] as const

const title = computed(() => `导出为 ${FORMAT_LABELS[dialog.format] ?? ''}`)

/** 只在 PDF 段里有意义的开关，但对 HTML 也生效（外壳共用），所以不隐藏 */
const showPdfSection = computed(() => dialog.format === 'pdf')

/**
 * 三处非显然的耦合，直接写在界面上。
 *
 * 这些不是「帮助文本」，是**用户不被告知就会做出错误选择**的地方：
 * 选了暗色又不打印背景，出来的 PDF 是白纸上的浅灰字；边距小于页脚高度，
 * 页码会被裁掉；不内联图片，产物就只是一个引用了别处文件的 HTML。
 */
const hints = computed(() => {
  const list: string[] = []
  if (dialog.draft.theme === 'dark' && showPdfSection.value && !dialog.draft.pdf.printBackground) {
    list.push('已选暗色主题但关闭了「打印背景」：导出时会强制改用亮色，否则白纸上几乎看不见字。')
  }
  if (showPdfSection.value && dialog.draft.pdf.footer) {
    const min = Math.min(
      dialog.draft.pdf.margin.top,
      dialog.draft.pdf.margin.right,
      dialog.draft.pdf.margin.bottom,
      dialog.draft.pdf.margin.left
    )
    if (min < 10) list.push('页脚需要至少 10mm 的上下边距，否则页码可能被裁掉。')
  }
  if (!dialog.draft.embedImages) {
    list.push('未勾选「内联图片」：产物会有外部图片引用，移动到别处后图片会失效。')
  }
  return list
})

/**
 * Esc 关闭。
 *
 * 监听挂在 window 上而不是遮罩元素上：遮罩本身不参与 Tab 序列、拿不到焦点，
 * 挂在它上面的 `@keydown` 只有在「刚好点过它」之后才会触发——
 * 而用户更可能的操作是点开某个输入框再按 Esc，那时事件目标是 input。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    dialog.cancel()
  }
}

watch(
  () => dialog.visible,
  (visible) => {
    if (visible) {
      window.addEventListener('keydown', onKeydown)
      // 焦点移进面板，「取消」按钮上的默认焦点让 Tab 从对话框内开始
      void Promise.resolve().then(() => panel.value?.focus())
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  }
)

// 组件被卸载时对话框可能还开着（例如热更新），监听器不能留下
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="dialog.visible" class="modal-mask" @click.self="dialog.cancel()">
    <div ref="panel" class="modal" role="dialog" aria-modal="true" tabindex="-1" :aria-label="title">
      <header class="modal__header">{{ title }}</header>

      <div class="modal__body">
        <section class="modal__section">
          <h4 class="modal__section-title">通用</h4>

          <label class="field">
            <span class="field__label">主题</span>
            <select v-model="dialog.draft.theme" class="field__control">
              <option value="light">亮色</option>
              <option value="dark">暗色</option>
            </select>
          </label>

          <label class="field field--check">
            <input v-model="dialog.draft.embedImages" type="checkbox" />
            <span>内联图片（产出单文件，体积更大）</span>
          </label>

          <label class="field field--check">
            <input v-model="dialog.draft.includeToc" type="checkbox" />
            <span>在正文开头生成目录</span>
          </label>
        </section>

        <section v-if="showPdfSection" class="modal__section">
          <h4 class="modal__section-title">页面</h4>

          <label class="field">
            <span class="field__label">纸张</span>
            <select v-model="dialog.draft.pdf.pageSize" class="field__control">
              <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
            </select>
          </label>

          <label class="field field--check">
            <input v-model="dialog.draft.pdf.landscape" type="checkbox" />
            <span>横向</span>
          </label>

          <div class="field field--stack">
            <span class="field__label">页边距（毫米）</span>
            <div class="margin-grid">
              <label class="margin-grid__cell">
                <span>上</span>
                <input
                  v-model.number="dialog.draft.pdf.margin.top"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                />
              </label>
              <label class="margin-grid__cell">
                <span>下</span>
                <input
                  v-model.number="dialog.draft.pdf.margin.bottom"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                />
              </label>
              <label class="margin-grid__cell">
                <span>左</span>
                <input
                  v-model.number="dialog.draft.pdf.margin.left"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                />
              </label>
              <label class="margin-grid__cell">
                <span>右</span>
                <input
                  v-model.number="dialog.draft.pdf.margin.right"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                />
              </label>
            </div>
          </div>

          <label class="field field--check">
            <input v-model="dialog.draft.pdf.printBackground" type="checkbox" />
            <span>打印背景色</span>
          </label>

          <label class="field field--check">
            <input v-model="dialog.draft.pdf.footer" type="checkbox" />
            <span>页脚显示页码</span>
          </label>
        </section>

        <ul v-if="hints.length" class="modal__hints">
          <li v-for="hint in hints" :key="hint">{{ hint }}</li>
        </ul>
      </div>

      <footer class="modal__footer">
        <button type="button" class="btn" @click="dialog.cancel()">取消</button>
        <button type="button" class="btn btn--primary" @click="dialog.confirm()">导出</button>
      </footer>
    </div>
  </div>
</template>
