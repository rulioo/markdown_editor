/**
 * 命令注册表。
 *
 * 菜单、快捷键、工具栏、命令面板都只是「命令 ID 的来源」，
 * 真正的实现在这里统一注册与执行。这样同一功能只有一处实现，
 * 也方便在没有焦点文档时统一做可用性判断。
 */

export type CommandHandler = () => void | Promise<void>

const registry = new Map<string, CommandHandler>()

export function registerCommand(id: string, handler: CommandHandler): void {
  if (registry.has(id)) {
    console.warn(`[commands] 命令 ${id} 被重复注册，后者覆盖前者`)
  }
  registry.set(id, handler)
}

export function registerCommands(map: Record<string, CommandHandler>): void {
  for (const [id, handler] of Object.entries(map)) registerCommand(id, handler)
}

export function hasCommand(id: string): boolean {
  return registry.has(id)
}

/**
 * 执行命令。
 * 未注册的命令不抛错——主进程的菜单是静态的，某些命令（如未来才实现的导出）
 * 在早期阶段没有实现，静默忽略比弹一堆报错体验更好，但会留下控制台告警。
 */
export async function executeCommand(id: string): Promise<void> {
  const handler = registry.get(id)
  if (!handler) {
    console.warn(`[commands] 未实现的命令：${id}`)
    return
  }
  try {
    await handler()
  } catch (error) {
    console.error(`[commands] 命令 ${id} 执行失败：`, error)
  }
}
