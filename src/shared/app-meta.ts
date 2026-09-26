/**
 * 应用元数据的**单一来源**：显示名、公司、版权。
 *
 * 为什么需要这个文件：`MarkText 克隆版` 这个字面量原本在四处各写了一遍
 * （window.ts 的窗口标题、TitleBar.vue 的标题栏、index.html 的 <title>、
 * 以及 electron-builder.yml 的 productName）。改一处忘一处是迟早的事，
 * 而且已经真的发生过一次——帮助菜单里的「关于」用的是 `app.getName()`，
 * 而 `package.json` 没有 productName 字段，于是菜单上显示的是开发名
 * 「关于 marktext-clone」。`test/app-meta.test.ts` 现在把这几处钉在一起。
 *
 * 注意这里**刻意不通过 `app.getName()` 取名**：那个值同时也是
 * `app.getPath('userData')` 的目录名，改它会搬走配置/最近文件/崩溃恢复。
 * 显示名与存储目录名是两件事，不要合并。
 */

/** 显示用应用名。与 electron-builder.yml 的 productName、index.html 的 <title> 必须一致 */
export const APP_TITLE = 'MarkText 克隆版'

/** 版权持有方 */
export const COMPANY_NAME = '中色丝路资源科技（北京）有限公司'

/** 版权年份。写死而不是取当前年：版权所有年份指发布年，不该随构建时间漂移 */
export const COPYRIGHT_YEAR = '2026'

/** 完整的版权行，供关于对话框与打包元数据使用 */
export const COPYRIGHT = `版权所有 © ${COPYRIGHT_YEAR} ${COMPANY_NAME}`
